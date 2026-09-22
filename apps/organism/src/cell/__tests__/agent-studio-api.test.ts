import {
  agentStudioVersionedDocumentIds,
  canonicalJson,
  createSophiaClusterLeadProfile,
} from '@shrubbery/domain-kit/agent-studio'
import { describe, expect, it } from 'vitest'
import {
  AGENT_STUDIO_DEFINITION_DOCUMENT_ID,
  AGENT_STUDIO_GRAPH_ID,
  AGENT_STUDIO_PROFILE_DOCUMENT_ID,
  AgentStudioApi,
  AgentStudioConflictError,
} from '../agent-studio-api.js'

const runtimeDigest = `sha256:${'a'.repeat(64)}`

class Cell {
  readonly documents = new Map<string, { content: string; revision: number; updatedAt: string }>()
  readonly writes: Array<{ graphId: string; documentId: string }> = []
  failDocumentId: string | null = null

  constructor(profile = createSophiaClusterLeadProfile({ ownerPrincipal: 'user:vera', runtimeBundleDigest: runtimeDigest })) {
    this.documents.set(key(AGENT_STUDIO_GRAPH_ID, AGENT_STUDIO_PROFILE_DOCUMENT_ID), {
      content: canonicalJson(profile),
      revision: 1,
      updatedAt: '1',
    })
  }

  async callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    const graphId = String(args.graphId)
    const documentId = String(args.documentId)
    const coordinate = key(graphId, documentId)
    if (name === 'read_document') {
      const current = this.documents.get(coordinate)
      if (!current) throw new Error(`document not found: ${coordinate}`)
      return {
        graph_id: graphId,
        document_id: documentId,
        content: current.content,
        revision: current.revision,
        updated_at: current.updatedAt,
        change_id: `change-${current.revision}`,
      }
    }
    if (name === 'write_document') {
      if (documentId === this.failDocumentId) throw new Error(`forced failure: ${documentId}`)
      const current = this.documents.get(coordinate)
      const currentRevision = current?.revision ?? 0
      if (args.expectedRevision !== undefined && args.expectedRevision !== currentRevision) {
        throw new Error(`revision mismatch: expected ${String(args.expectedRevision)}, actual ${currentRevision}`)
      }
      const revision = currentRevision + 1
      const tiptap = args.tiptapJson as { content?: Array<{ content?: Array<{ text?: string }> }> } | undefined
      const jsonText = tiptap?.content?.[0]?.content?.[0]?.text
      this.documents.set(coordinate, {
        content: jsonText === undefined ? String(args.content) : `\`\`\`json\n${jsonText}\n\`\`\``,
        revision,
        updatedAt: String(revision),
      })
      this.writes.push({ graphId, documentId })
      return { success: true }
    }
    throw new Error(`unexpected tool: ${name}`)
  }
}

describe('AgentStudioApi', () => {
  it('saves a validated source draft with revision fencing and reread verification', async () => {
    const cell = new Cell()
    const api = new AgentStudioApi(cell, () => 1_800_000_000_000)
    const before = await api.load()
    const next = { ...before.profile.profile, displayName: 'Sophia Cluster Lead — Vera’s desk' }
    const after = await api.saveDraft(next, before.profile)
    expect(after.profile.profile.displayName).toBe(next.displayName)
    expect(after.profile.revision).toBe(2)
    await expect(api.saveDraft(before.profile.profile, before.profile)).rejects.toBeInstanceOf(AgentStudioConflictError)
  })

  it('publishes versioned dependencies and writes the stable executable definition last', async () => {
    const cell = new Cell()
    const api = new AgentStudioApi(cell, () => 1_800_000_000_000)
    const before = await api.load()
    const result = await api.publish(before.profile)

    expect(result.publication.definition).toMatchObject({ schema: 'sophia.domain-agent-definition.v2' })
    expect(cell.writes.at(-1)).toEqual({
      graphId: AGENT_STUDIO_GRAPH_ID,
      documentId: AGENT_STUDIO_DEFINITION_DOCUMENT_ID,
    })
    expect(cell.writes.find(write => write.documentId === result.publication.activeDocumentIds.grant)?.graphId).toBe('observatory')
    expect(result.snapshot.activeDefinition?.canonicalContent).toBe(canonicalJson(result.publication.definition))
    for (const id of Object.values(result.publication.activeDocumentIds)) {
      expect(id).toContain('-')
    }
  })

  it('cannot activate a partial publication when a dependency write fails', async () => {
    const cell = new Cell()
    const api = new AgentStudioApi(cell, () => 1_800_000_000_000)
    const before = await api.load()
    const ids = await agentStudioVersionedDocumentIds(before.profile.profile, {
      promotedBy: 'user:vera',
      promotedAt: 1_800_000_000_000,
    })
    cell.failDocumentId = ids.toolManifest
    await expect(api.publish(before.profile)).rejects.toThrow(/forced failure/)
    expect(cell.documents.has(key(AGENT_STUDIO_GRAPH_ID, AGENT_STUDIO_DEFINITION_DOCUMENT_ID))).toBe(false)
  })

  it('publishes a later immutable version by CAS-advancing the existing definition pointer', async () => {
    const cell = new Cell()
    let now = 1_800_000_000_000
    const api = new AgentStudioApi(cell, () => now)
    const first = await api.publish((await api.load()).profile)
    now += 1
    const second = await api.publish(first.snapshot.profile)
    expect(second.publication.publicationId).not.toBe(first.publication.publicationId)
    expect(second.snapshot.activeDefinition?.revision).toBe(2)
    expect(cell.writes.at(-1)).toEqual({
      graphId: AGENT_STUDIO_GRAPH_ID,
      documentId: AGENT_STUDIO_DEFINITION_DOCUMENT_ID,
    })
  })
})

function key(graphId: string, documentId: string): string {
  return `${graphId}\0${documentId}`
}
