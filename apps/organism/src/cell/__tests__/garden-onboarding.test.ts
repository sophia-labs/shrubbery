import { describe, expect, it, vi } from 'vitest'
import {
  seedGardenOnboarding,
  type GardenOnboardingInput,
  type GardenOnboardingMcp,
} from '../garden-onboarding.js'
import {
  GARDEN_ONBOARDING_EDITION,
  GARDEN_ONBOARDING_PAGES,
  gardenOnboardingDocument,
} from '../garden-onboarding-content.js'

type StoredDocument = { title: string; revision: number; tiptapJson: unknown }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(settle => { resolve = settle })
  return { promise, resolve }
}

/** Independent canonical shapes copied from the Garden producer, not its caller decoder. */
function fixture() {
  const documents = new Map<string, StoredDocument>()
  const requests: { name: string; args: Readonly<Record<string, unknown>> }[] = []
  let current = true
  let durability = 'published'
  const mcp: GardenOnboardingMcp = {
    async callTool(name, args) {
      requests.push({ name, args })
      if (name === 'list_documents') {
        return {
          documents: [...documents].map(([documentId, document]) => ({ documentId, title: document.title })),
          count: documents.size,
          page: { complete: true, returned: documents.size, nextCursor: null },
        }
      }
      const id = String(args.documentId)
      if (name === 'write_document') {
        expect(args.graphId).toBe('tour-new')
        expect(args.expectedRevision).toBe(0)
        expect(args.awaitDurable).toBe(true)
        if (documents.has(id)) throw new Error('revision conflict: expected 0, actual 1')
        documents.set(id, { title: String(args.title), revision: 1, tiptapJson: args.tiptapJson })
        return {
          success: true, graph_id: 'tour-new', graphId: 'tour-new', document_id: id, documentId: id,
          revision: 1, durability, durabilityChecked: durability === 'published' || durability === 'local',
        }
      }
      if (name === 'read_document') {
        const document = documents.get(id)
        if (!document) throw new Error('document not found')
        return {
          graph_id: 'tour-new', document_id: id, title: document.title, revision: document.revision,
          format: 'json', complete: true, fragment: false, offset: 0, nextOffset: null,
          content: JSON.stringify({ tiptapJson: document.tiptapJson, tree: null, blocks: [] }),
        }
      }
      throw new Error(`Unsupported fixture tool ${name}`)
    },
  }
  const input: GardenOnboardingInput = {
    mcp,
    workspace: { graphId: 'tour-new', title: 'Tour', role: 'owner', owner: 'user:current', cellState: 'running' },
    expectedOwner: 'user:current',
    isCurrent: () => current,
  }
  return {
    input, mcp, documents, requests,
    loseAuthority() { current = false },
    setDurability(value: string) { durability = value },
  }
}

describe('authored Garden onboarding edition', () => {
  it('has stable unique document/block IDs, a purposeful project, and no private operator feature', () => {
    expect(GARDEN_ONBOARDING_EDITION).toBe('2026-09-06')
    expect(GARDEN_ONBOARDING_PAGES).toHaveLength(9)
    expect(new Set(GARDEN_ONBOARDING_PAGES.map(page => page.documentId)).size).toBe(9)
    const blockIds = GARDEN_ONBOARDING_PAGES.flatMap(page =>
      (gardenOnboardingDocument(page).content as { attrs: { 'data-block-id': string } }[])
        .map(block => block.attrs['data-block-id']))
    expect(new Set(blockIds).size).toBe(blockIds.length)
    const text = JSON.stringify(GARDEN_ONBOARDING_PAGES)
    for (const topic of ['My field notes', 'One useful finding', 'Embeddings', 'typed user ID', 'source', 'semantic_search']) {
      expect(text).toContain(topic)
    }
    expect(text).not.toMatch(/phanes|https?:\/\/api\.|e9b9590e/i)
    expect(text).toContain('not an email lookup')
    expect(text).toContain('not a desktop model picker')
    const sharing = GARDEN_ONBOARDING_PAGES.find(page => page.documentId.endsWith('-sharing'))
    expect(JSON.stringify(sharing)).toContain('The full hosted Viewer workspace and Settings journey is not yet available end to end.')
  })
})

describe('guarded fresh hosted tour seeding', () => {
  it('writes each page once and verifies exact content separately from published durability', async () => {
    const { input, documents, requests } = fixture()
    const report = await seedGardenOnboarding(input)
    expect(report).toMatchObject({ status: 'created', contentVerified: true, durabilityConfirmed: true, graphId: 'tour-new' })
    expect(report.firstDocumentId).toBe(GARDEN_ONBOARDING_PAGES[0].documentId)
    expect(documents.size).toBe(9)
    expect(requests.filter(request => request.name === 'write_document')).toHaveLength(9)
    expect(requests.filter(request => request.name === 'read_document')).toHaveLength(9)
    expect(new Set(requests.map(request => request.name))).toEqual(new Set(['list_documents', 'write_document', 'read_document']))
  })

  it.each(['pending', 'unchecked', 'local'])('does not turn %s durability into an off-host claim', async durability => {
    const { input, setDurability } = fixture()
    setDurability(durability)
    const report = await seedGardenOnboarding(input)
    expect(report.contentVerified).toBe(true)
    expect(report.durabilityConfirmed).toBe(false)
  })

  it.each([
    { role: 'viewer' },
    { role: 'editor' },
    { owner: 'user:somebody-else' },
    { owner: undefined },
    { localCreation: { status: 'pending' } },
  ])('refuses unconfirmed or non-owned workspace %j before any call', async workspacePatch => {
    const { input, requests } = fixture()
    const workspace = { ...input.workspace, ...workspacePatch } as GardenOnboardingInput['workspace']
    await expect(seedGardenOnboarding({ ...input, workspace })).rejects.toThrow('directory-confirmed')
    expect(requests).toHaveLength(0)
  })

  it('does not overwrite even an empty existing user document or fill a partial tour', async () => {
    const { input, documents, requests } = fixture()
    documents.set(GARDEN_ONBOARDING_PAGES[0].documentId, { title: 'My own title', revision: 0, tiptapJson: { type: 'doc', content: [] } })
    await expect(seedGardenOnboarding(input)).rejects.toThrow('partial tour')
    expect(requests.map(request => request.name)).toEqual(['list_documents'])
    expect(documents.get(GARDEN_ONBOARDING_PAGES[0].documentId)?.title).toBe('My own title')
  })

  it('preserves a complete existing edition, including user edits, without claiming new verification', async () => {
    const { input, documents, requests } = fixture()
    await seedGardenOnboarding(input)
    const id = GARDEN_ONBOARDING_PAGES[0].documentId
    documents.set(id, { title: 'A title I changed', revision: 2, tiptapJson: { type: 'doc', content: [] } })
    requests.length = 0
    const report = await seedGardenOnboarding(input)
    expect(report).toMatchObject({ status: 'preserved', contentVerified: false, durabilityConfirmed: false })
    expect(requests.map(request => request.name)).toEqual(['list_documents'])
    expect(documents.get(id)?.title).toBe('A title I changed')
  })

  it.each([
    undefined,
    { documents: [], count: 0 },
    { documents: [], count: 1, page: { complete: false, returned: 0, nextCursor: '0' } },
    { documents: [], count: '0', page: { complete: true, returned: 0, nextCursor: null } },
  ])('never interprets malformed/incomplete census %j as empty', async response => {
    const { input } = fixture()
    const callTool = vi.fn(async () => response)
    await expect(seedGardenOnboarding({ ...input, mcp: { callTool } })).rejects.toThrow('census')
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it.each([
    (response: Record<string, unknown>) => ({ ...response, success: false }),
    (response: Record<string, unknown>) => ({ ...response, graph_id: 'wrong-graph' }),
    (response: Record<string, unknown>) => ({ ...response, documentId: 'wrong-document' }),
    (response: Record<string, unknown>) => ({ ...response, durability: 'revoked', durabilityChecked: false }),
    // Observed in the existing, source-unbound local binary: an echoed check
    // flag alone is not the current engine's real durability classification.
    (response: Record<string, unknown>) => ({ ...response, durability: undefined, durabilityChecked: true, durability_checked: true }),
    (response: Record<string, unknown>) => ({ ...response, durabilityChecked: true, durability_checked: false }),
    (response: Record<string, unknown>) => ({ ...response, durability: 'pending', durabilityChecked: true }),
  ])('stops at a refused or mismatched write acknowledgement without retrying', async corrupt => {
    const { input, mcp, requests } = fixture()
    const original = mcp.callTool
    mcp.callTool = async (name, args) => {
      const response = await original(name, args)
      return name === 'write_document' ? corrupt(response as Record<string, unknown>) : response
    }
    await expect(seedGardenOnboarding(input)).rejects.toThrow('retained graph tour-new')
    expect(requests.map(request => request.name)).toEqual(['list_documents', 'write_document'])
  })

  it('retains an uncertain applied write and refuses to blindly retry its partial graph', async () => {
    const { input, mcp, documents, requests } = fixture()
    const original = mcp.callTool
    mcp.callTool = async (name, args) => {
      const response = await original(name, args)
      if (name === 'write_document') throw new Error('connection ended after sending')
      return response
    }
    await expect(seedGardenOnboarding(input)).rejects.toThrow('No automatic retry or deletion')
    expect(documents.size).toBe(1)
    await expect(seedGardenOnboarding(input)).rejects.toThrow('partial tour')
    expect(requests.filter(request => request.name === 'write_document')).toHaveLength(1)
  })

  it('rejects stale/malformed readback instead of navigating on a successful HTTP-shaped reply', async () => {
    const { input, mcp, requests } = fixture()
    const original = mcp.callTool
    mcp.callTool = async (name, args) => {
      const response = await original(name, args)
      return name === 'read_document' ? { ...(response as object), content: '{"tiptapJson":{"type":"doc","content":[]}}' } : response
    }
    await expect(seedGardenOnboarding(input)).rejects.toThrow('does not match the tour')
    expect(requests.filter(request => request.name === 'write_document')).toHaveLength(1)
  })

  it('stops after identity changes while a response is held and rejects a duplicate in-flight seed', async () => {
    const { input, mcp, requests, loseAuthority } = fixture()
    const census = deferred<unknown>()
    const original = mcp.callTool
    mcp.callTool = (name, args) => name === 'list_documents' ? census.promise : original(name, args)
    const first = seedGardenOnboarding(input)
    await expect(seedGardenOnboarding(input)).rejects.toThrow('already in flight')
    loseAuthority()
    census.resolve({ documents: [], count: 0, page: { complete: true, nextCursor: null, returned: 0 } })
    await expect(first).rejects.toThrow('account or session changed')
    expect(requests).toHaveLength(0)
  })

  it('retains acknowledged pages when identity changes after the first write instead of writing the rest', async () => {
    const { input, mcp, requests, documents, loseAuthority } = fixture()
    const original = mcp.callTool
    mcp.callTool = async (name, args) => {
      const response = await original(name, args)
      if (name === 'write_document') loseAuthority()
      return response
    }
    await expect(seedGardenOnboarding(input)).rejects.toThrow('account or session changed')
    expect(documents.size).toBe(1)
    expect(requests.map(request => request.name)).toEqual(['list_documents', 'write_document'])
  })

  it('uses a revision-zero guard when another writer wins after the empty census', async () => {
    const { input, mcp, documents } = fixture()
    const id = GARDEN_ONBOARDING_PAGES[0].documentId
    const original = mcp.callTool
    mcp.callTool = async (name, args) => {
      const response = await original(name, args)
      if (name === 'list_documents') documents.set(id, { title: 'A real concurrent edit', revision: 1, tiptapJson: {} })
      return response
    }
    await expect(seedGardenOnboarding(input)).rejects.toThrow('revision conflict')
    expect(documents.get(id)?.title).toBe('A real concurrent edit')
  })
})
