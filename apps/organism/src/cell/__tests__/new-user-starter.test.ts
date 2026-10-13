import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureNewUserStarter, type NewUserStarterInput } from '../new-user-starter.js'
import { createStarterAuthority, decodeStarterResponse, type StarterAuthorityResponse } from '../new-user-starter-contract.js'
import { STARTER_MANIFEST_SHA256, STARTER_PAGE_HASHES, starterCanonicalJson, starterManifestBytes } from '../new-user-starter-content.js'
import { GARDEN_ONBOARDING_PAGES, gardenOnboardingDocument } from '../garden-onboarding-content.js'

const subject = 'fixture-new-native-subject'
const workspace = { owner: `user:${subject}`, graphId: 'starter-fixture', generation: 1 }
const base = '/me/starter-workspace'
const pages = GARDEN_ONBOARDING_PAGES.map(page => ({ documentId: page.documentId, title: page.title, tiptapJson: gardenOnboardingDocument(page) }))
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
function independentlySorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(independentlySorted)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, independentlySorted((value as Record<string, unknown>)[key])]))
  return value
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(independentlySorted(value))).digest('hex')
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

/** Independent finite server/cell fixture. No network, account, or browser. */
function fixture() {
  const docs = new Map<string, { title: string; tiptapJson: unknown; revision: number }>()
  const tombstones = new Set<string>()
  const journal = new Map(pages.map(page => [page.documentId, { state: 'unattempted', attemptId: undefined as string | undefined }]))
  const calls: { kind: 'authority' | 'mcp'; name: string; body: Readonly<Record<string, unknown>> }[] = []
  let current = true
  let disposition = 'registered'
  let completed = false
  const snapshot = () => ({
    schema: 'sophia.account-starter.v1', subject, status: disposition, workspace: { ...workspace },
    seed: {
      edition: '2026-09-06', manifestSha256: 'b6b781c0b096e89bc7962939fa3a569796d83322e18e6eadb56e4706efef9c3f',
      state: completed ? 'client-observed-complete' : [...journal.values()].some(page => page.state === 'attention') ? 'attention' : 'pending',
      pages: [...journal].map(([documentId, page]) => ({ documentId, ...page })),
    },
  })
  const authority: NewUserStarterInput['authority'] = {
    async post(path, body) {
      calls.push({ kind: 'authority', name: path, body })
      if (path === base) return { status: 200, body: disposition === 'not-applicable'
        ? { schema: 'sophia.account-starter.v1', subject, status: disposition, reason: 'pre-cutoff-account' } : snapshot() }
      const id = path.split('/').at(-2)!
      const row = journal.get(id)
      if (!row) throw new Error('Unknown fixture page')
      if (path.endsWith('/claim')) {
        expect(body).toEqual({})
        const fresh = row.state === 'unattempted'
        if (fresh) { row.state = 'attempted'; row.attemptId = `attempt-${id}` }
        return { status: fresh ? 201 : 200, body: { ...snapshot(), documentId: id, attemptId: row.attemptId, freshGrant: fresh } }
      }
      expect(path).toBe(`${base}/pages/${id}/report`)
      expect(body.attemptId).toBe(row.attemptId)
      if (!completed) {
        if (body.observation === 'template-present') {
          expect(body.observedPageHash).toBe(hash(pages.find(page => page.documentId === id)))
          expect(Number.isSafeInteger(body.observedRevision)).toBe(true)
          row.state = 'observed-present'
        } else if (row.state !== 'observed-present') row.state = 'attention'
        completed = [...journal.values()].every(page => page.state === 'observed-present')
      }
      return { status: 200, body: { ...snapshot(), documentId: id, attemptId: row.attemptId } }
    },
  }
  const mcp: NewUserStarterInput['mcp'] = {
    async callTool(target, name, body) {
      expect(target).toEqual(workspace)
      calls.push({ kind: 'mcp', name, body })
      expect(body.graphId ?? body.graph_id).toBe(workspace.graphId)
      if (name === 'list_documents') return {
        documents: [...docs].map(([documentId, doc]) => ({ documentId, title: doc.title })), count: docs.size,
        page: { complete: true, returned: docs.size, nextCursor: null },
      }
      const id = String(body.documentId ?? body.document_id)
      if (name === 'read_document') {
        if (tombstones.has(id)) throw new Error(`Gateway MCP error for read_document: document tombstoned: ${id}`)
        const doc = docs.get(id)
        if (!doc) throw new Error(`Gateway MCP error for read_document: document not found: ${id}`)
        return {
          graphId: workspace.graphId, documentId: id, title: doc.title, revision: doc.revision,
          format: 'json', complete: true, fragment: false, offset: 0, nextOffset: null,
          content: JSON.stringify({ tiptapJson: doc.tiptapJson, blocks: [], tree: null }),
        }
      }
      expect(name).toBe('create_document_once')
      expect(body.expectedRevision).toBeUndefined()
      expect(body.graphId).toBeUndefined()
      expect(body.documentId).toBeUndefined()
      expect(body.parentId).toBeNull()
      expect(body.order).toBe((pages.findIndex(page => page.documentId === id) + 1) * 10)
      expect(body.awaitDurable).toBe(true)
      // A second tab can observe missing/attention while the first granted
      // attempt is still in flight. That never creates a second grant, and does
      // not revoke the first caller's single already-authorized send.
      expect(journal.get(id)?.state).not.toBe('unattempted')
      expect(journal.get(id)?.attemptId).toBeTruthy()
      // New engine predicate must refuse current/prior authority at execution.
      if (docs.has(id) || tombstones.has(id)) throw new Error('create_document_once refused')
      tombstones.delete(id)
      docs.set(id, { title: String(body.title), tiptapJson: body.tiptapJson, revision: 1 })
      return { success: true, outcome: 'created', graphId: workspace.graphId, documentId: id, revision: 1, durability: 'pending', durabilityChecked: false }
    },
  }
  const input: NewUserStarterInput = { subject, authority, mcp, isCurrent: () => current, timeoutMs: 5000 }
  return {
    input, docs, tombstones, journal, calls, snapshot,
    setDisposition(value: string) { disposition = value },
    loseIdentity() { current = false },
    writes: () => calls.filter(call => call.name === 'create_document_once'),
    installPage(index: number, revision = 1) { const page = pages[index]; docs.set(page.documentId, { title: page.title, tiptapJson: copy(page.tiptapJson), revision }) },
  }
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('starter immutable content and journal decoder', () => {
  const enumLookalikes = (value: string) => [
    { kind: 'array', value: [value] },
    { kind: 'object', value: { value } },
    { kind: 'number', value: 0 },
  ]

  it.each(enumLookalikes('starter_disabled'))('does not decode a $kind error-code lookalike as quiet disabled', ({ value }) => {
    let failure: unknown
    try {
      decodeStarterResponse({ status: 503, body: { schema: 'sophia.account-starter.v1', subject, code: value } }, subject)
    } catch (error) { failure = error }
    expect(failure).toMatchObject({ name: 'StarterProtocolError', reason: 'authority-unavailable', httpStatus: 503, code: undefined })
  })

  it.each(enumLookalikes('starter_disabled'))('filters a $kind error-code lookalike out of the HTTP authority response', async ({ value }) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ schema: 'sophia.account-starter.v1', subject, code: value }), { status: 503 }))
    const authority = createStarterAuthority({ gatewayBaseUrl: 'https://example.invalid', token: 'synthetic-token', isCurrent: () => true, fetch: fetcher as typeof fetch })
    expect(await authority.post(base, {}, new AbortController().signal)).toEqual({ status: 503, body: null })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each(enumLookalikes('pre-cutoff-account'))('rejects a $kind not-applicable reason lookalike', ({ value }) => {
    const body = { schema: 'sophia.account-starter.v1', subject, status: 'not-applicable', reason: value }
    expect(() => decodeStarterResponse({ status: 200, body }, subject)).toThrow('invalid-disposition')
  })

  it.each(enumLookalikes('pending'))('rejects a $kind seed-state lookalike', ({ value }) => {
    const body = fixture().snapshot()
    ;(body.seed as Record<string, unknown>).state = value
    expect(() => decodeStarterResponse({ status: 200, body }, subject)).toThrow('invalid-journal')
  })

  it.each(enumLookalikes('attempted'))('rejects a $kind page-state lookalike before casting it as a string', ({ value }) => {
    const f = fixture()
    f.journal.set(pages[0].documentId, { state: 'attempted', attemptId: 'original-attempt' })
    const body = f.snapshot()
    ;(body.seed.pages[0] as Record<string, unknown>).state = value
    expect(() => decodeStarterResponse({ status: 200, body }, subject)).toThrow('invalid-journal')
  })

  it('pins manifest bytes and separate complete-JSON page hashes', () => {
    expect(Buffer.byteLength(starterManifestBytes())).toBe(17919)
    expect(createHash('sha256').update(starterManifestBytes()).digest('hex')).toBe(STARTER_MANIFEST_SHA256)
    for (const page of pages) expect(STARTER_PAGE_HASHES[page.documentId]).toBe(hash(page))
    expect(starterCanonicalJson({ b: [2, 1], a: ' exact\ntext ' })).toBe('{"a":" exact\\ntext ","b":[2,1]}')
    expect(() => starterCanonicalJson({ a: undefined })).toThrow()
  })

  it.each([
    (body: any) => { body.subject = 'another' },
    (body: any) => { body.workspace.owner = 'user:another' },
    (body: any) => { body.workspace.generation = '1' },
    (body: any) => { body.workspace.generation = Number.MAX_SAFE_INTEGER + 1 },
    (body: any) => { body.seed.edition = 'future-edition' },
    (body: any) => { body.seed.manifestSha256 = 'a'.repeat(64) },
    (body: any) => { body.seed.pages[1] = body.seed.pages[0] },
    (body: any) => { body.seed.state = 'client-observed-complete' },
  ])('rejects mismatched/unrepresentable authority identity or journal', corrupt => {
    const f = fixture(); const body = f.snapshot(); corrupt(body)
    expect(() => decodeStarterResponse({ status: 200, body }, subject)).toThrow()
  })

  it('uses only captured bearer, strict endpoints, no cookies, redirects or error-body disclosure', async () => {
    let current = true
    const fetcher = vi.fn(async () => new Response('private-provider-detail', { status: 503 }))
    const authority = createStarterAuthority({ gatewayBaseUrl: 'https://example.invalid', token: 'synthetic-token', isCurrent: () => current, fetch: fetcher as typeof fetch })
    expect(await authority.post(base, {}, new AbortController().signal)).toEqual({ status: 503, body: null })
    expect(fetcher.mock.calls[0]).toEqual(['https://example.invalid/me/starter-workspace', expect.objectContaining({
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', body: '{}',
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-token' }),
    })])
    current = false
    await expect(authority.post(base, {}, new AbortController().signal)).rejects.toThrow('stale-session')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('finite one-starter client preparation', () => {
  it('performs nine first claims, one send each and fresh body readback; never calls old creation/tour producers', async () => {
    const f = fixture(); const states: string[] = []
    const result = await ensureNewUserStarter({ ...f.input, onState: state => states.push(state.phase) })
    expect(result).toMatchObject({ status: 'client-observed-complete', workspace, contentObservedThisRun: true, durabilityConfirmed: false })
    expect(f.docs.size).toBe(9)
    expect(f.writes()).toHaveLength(9)
    expect(f.calls.filter(call => call.name.endsWith('/claim'))).toHaveLength(9)
    expect(f.calls.filter(call => call.name.endsWith('/report'))).toHaveLength(9)
    expect(f.calls.filter(call => call.name === 'read_document')).toHaveLength(18)
    expect(states[0]).toBe('registering'); expect(states).toContain('preparing')
    expect(f.calls[0].body).toEqual({})
    for (const page of pages) {
      const relevant = f.calls.filter(call => call.name.includes(page.documentId) || (call.body.documentId ?? call.body.document_id) === page.documentId)
      expect(relevant.map(call => call.name)).toEqual([`${base}/pages/${page.documentId}/claim`, 'read_document', 'create_document_once', 'read_document', `${base}/pages/${page.documentId}/report`])
    }
  })

  it('leaves existing accounts completely outside graph/MCP seeding', async () => {
    const f = fixture(); f.setDisposition('not-applicable')
    expect(await ensureNewUserStarter(f.input)).toEqual({ status: 'not-applicable', reason: 'pre-cutoff-account' })
    expect(f.calls).toHaveLength(1)
  })

  it.each([401, 403, 409, 503])('returns HTTP %s as unavailable, not ineligible/empty or fallback creation', async status => {
    const f = fixture(); f.input.authority.post = async () => ({ status, body: { status: 'not-applicable' } })
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'unavailable', httpStatus: status })
    expect(f.calls).toHaveLength(0)
  })

  it('retains a deleted/unavailable registered graph and does not request a replacement', async () => {
    const f = fixture(); f.setDisposition('retained-unavailable')
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'retained-unavailable', workspace })
    expect(f.calls).toHaveLength(1)
  })

  it('does not revisit, compare or repair a historically completed copy after user edits/deletes', async () => {
    const f = fixture(); await ensureNewUserStarter(f.input)
    f.docs.delete(pages[0].documentId); f.calls.length = 0
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'preserved', contentObservedThisRun: false, durabilityConfirmed: false })
    expect(f.calls).toHaveLength(1)
    expect(f.docs.size).toBe(8)
  })

  it('resumes only unattempted missing pages after reading matching partial content', async () => {
    const f = fixture(); f.installPage(0)
    f.journal.set(pages[0].documentId, { state: 'attempted', attemptId: 'earlier-attempt' })
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'client-observed-complete' })
    expect(f.writes()).toHaveLength(8)
    expect(f.writes().some(call => (call.body.documentId ?? call.body.document_id) === pages[0].documentId)).toBe(false)
  })

  it('settles exact existing unattempted content without a write, ignoring only object-key order', async () => {
    const f = fixture(); pages.forEach((_, i) => f.installPage(i))
    for (const doc of f.docs.values()) doc.tiptapJson = independentlySorted(doc.tiptapJson)
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'client-observed-complete' })
    expect(f.writes()).toHaveLength(0)
  })

  it.each(['changed-title', 'changed-text', 'added-property', 'changed-order', 'tombstoned', 'attempted-missing'])('preserves %s and stops automatic preparation', async variant => {
    const f = fixture(); const id = pages[0].documentId
    if (variant === 'tombstoned') f.tombstones.add(id)
    else if (variant === 'attempted-missing') f.journal.set(id, { state: 'attempted', attemptId: 'earlier-attempt' })
    else {
      f.installPage(0); const doc = f.docs.get(id)!; const tiptap = doc.tiptapJson as any
      if (variant === 'changed-title') doc.title = 'My own title'
      if (variant === 'changed-text') tiptap.content[0].content[0].text += ' My words.'
      if (variant === 'added-property') tiptap.content[0].attrs.myAttribute = 'keep'
      if (variant === 'changed-order') tiptap.content.reverse()
    }
    const before = JSON.stringify([...f.docs])
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention', workspace })
    expect(f.writes()).toHaveLength(0)
    expect(JSON.stringify([...f.docs])).toBe(before)
    expect(f.tombstones.has(id)).toBe(variant === 'tombstoned')
  })

  it('requires a fresh complete census and refuses unrelated user documents before any claim', async () => {
    const f = fixture(); f.docs.set('my-document', { title: 'Keep', tiptapJson: {}, revision: 1 })
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention', reason: 'existing-work' })
    expect(f.calls.map(call => call.name)).toEqual([base, 'list_documents'])
  })

  it('does not reinterpret an incomplete census as an empty graph', async () => {
    const f = fixture(); f.input.mcp.callTool = async () => ({ documents: [], count: 0, page: { complete: false, returned: 0, nextCursor: 'next' } })
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention', reason: 'incomplete-census' })
    expect(f.writes()).toHaveLength(0)
  })

  it('stops this invocation on lost create reply, then settles exact content on a later invocation without resending', async () => {
    const f = fixture(); const original = f.input.mcp.callTool; let lost = false
    f.input.mcp.callTool = async (target, name, args, signal) => { const result = await original(target, name, args, signal); if (name === 'create_document_once' && !lost) { lost = true; throw new Error('reply lost after commit') }; return result }
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention', reason: 'unconfirmed-create' })
    expect(f.writes()).toHaveLength(1)
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'client-observed-complete', durabilityConfirmed: false })
    expect(f.writes()).toHaveLength(9)
  })

  it('never resends attempted+missing after a lost write or subsequent invocation', async () => {
    const f = fixture(); const original = f.input.mcp.callTool; let sends = 0
    f.input.mcp.callTool = async (target, name, args, signal) => { if (name === 'create_document_once') { sends++; throw new Error('reply lost, outcome unknown') }; return original(target, name, args, signal) }
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention' })
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention' })
    expect(sends).toBe(1)
  })

  it('does not use a lost first-claim response as authority to write, even on a later invocation', async () => {
    const f = fixture(); const original = f.input.authority.post; let lost = false
    f.input.authority.post = async (path, body, signal) => { const result = await original(path, body, signal); if (!lost && path.endsWith('/claim')) { lost = true; throw new Error('response lost') }; return result }
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention' })
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention' })
    expect(f.writes()).toHaveLength(0)
  })

  it('concurrent tabs get only one first send, and first-writer readback can settle earlier attention', async () => {
    const f = fixture(); const original = f.input.mcp.callTool; const held = deferred<void>(); let reached = false
    f.input.mcp.callTool = async (target, name, args, signal) => { if (name === 'create_document_once' && !reached) { reached = true; await held.promise }; return original(target, name, args, signal) }
    const first = ensureNewUserStarter(f.input)
    await vi.waitFor(() => expect(reached).toBe(true))
    const second = await ensureNewUserStarter({ ...f.input, authority: { post: (...args) => f.input.authority.post(...args) } })
    expect(second.status).toBe('attention')
    held.resolve()
    expect(await first).toMatchObject({ status: 'client-observed-complete' })
    expect(f.writes()).toHaveLength(9)
  })

  it('rejects changed canonical generation in a claim before any page operation', async () => {
    const f = fixture(); const original = f.input.authority.post
    f.input.authority.post = async (...args) => { const result = await original(...args); if (args[0].endsWith('/claim')) (result.body as any).workspace.generation = 2; return result }
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention', reason: 'identity-mismatch' })
    expect(f.writes()).toHaveLength(0)
  })

  it('rejects HTTP200 freshGrant true rather than believing an uncommitted/duplicate claim', async () => {
    const f = fixture(); const original = f.input.authority.post
    f.input.authority.post = async (...args) => { const result = await original(...args); return args[0].endsWith('/claim') ? { ...result, status: 200 } : result }
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention', reason: 'invalid-claim' })
    expect(f.writes()).toHaveLength(0)
  })

  it('drops an old subject/token completion before sending another operation', async () => {
    const f = fixture(); const held = deferred<StarterAuthorityResponse>(); let reached = false
    f.input.authority.post = async () => { reached = true; return held.promise }
    const running = ensureNewUserStarter(f.input)
    await vi.waitFor(() => expect(reached).toBe(true)); f.loseIdentity(); held.resolve({ status: 200, body: f.snapshot() })
    expect(await running).toEqual({ status: 'stale' })
    expect(f.calls).toHaveLength(0)
  })

  it('stops after identity changes during the first write; already-sent work remains retained', async () => {
    const f = fixture(); const original = f.input.mcp.callTool
    f.input.mcp.callTool = async (target, name, args, signal) => { const result = await original(target, name, args, signal); if (name === 'create_document_once') f.loseIdentity(); return result }
    expect(await ensureNewUserStarter(f.input)).toEqual({ status: 'stale' })
    expect(f.writes()).toHaveLength(1)
    expect(f.calls.at(-1)?.name).toBe('create_document_once')
  })

  it('returns within a finite budget and ignores late transport/body work without retrying', async () => {
    const f = fixture(); const held = deferred<StarterAuthorityResponse>()
    f.input.authority.post = async () => held.promise
    expect(await ensureNewUserStarter({ ...f.input, timeoutMs: 20 })).toMatchObject({ status: 'unavailable', reason: 'budget-exhausted' })
    held.resolve({ status: 200, body: f.snapshot() }); await Promise.resolve()
    expect(f.calls).toHaveLength(0)
  })

  it('an aborted invocation performs no operation and leaves no automatic retry', async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort()
    expect(await ensureNewUserStarter({ ...f.input, signal: controller.signal })).toMatchObject({ status: 'unavailable', reason: 'aborted' })
    expect(f.calls).toHaveLength(0)
  })

  it('keeps an unsupported create-once tool at attention with no legacy-write fallback or later resend', async () => {
    const f = fixture(); const original = f.input.mcp.callTool; const dispatched: string[] = []
    f.input.mcp.callTool = async (target, name, args, signal) => {
      dispatched.push(name)
      if (name === 'create_document_once') throw new Error('Method not found: create_document_once')
      return original(target, name, args, signal)
    }
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention', reason: 'unconfirmed-create' })
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention' })
    expect(dispatched.filter(name => name === 'create_document_once')).toHaveLength(1)
    expect(dispatched).not.toContain('write_document')
    expect(f.docs.size).toBe(0)
  })

  it('keeps genuine missing-read lookalikes/refusals unknown instead of granting a write', async () => {
    const f = fixture(); const original = f.input.mcp.callTool
    f.input.mcp.callTool = async (target, name, args, signal) => {
      if (name === 'read_document') throw new Error('document not found: unrelated-id')
      return original(target, name, args, signal)
    }
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention', reason: 'unreadable-content' })
    expect(f.writes()).toHaveLength(0)
  })

  it('only a subject-bound typed disabled response may be treated quietly by the caller', async () => {
    const f = fixture()
    f.input.authority.post = async () => ({ status: 503, body: { schema: 'sophia.account-starter.v1', subject, code: 'starter_disabled' } })
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'unavailable', httpStatus: 503, code: 'starter_disabled' })
    f.input.authority.post = async () => ({ status: 503, body: { schema: 'sophia.account-starter.v1', subject: 'another', code: 'starter_disabled' } })
    expect((await ensureNewUserStarter(f.input)) as { code?: string }).not.toHaveProperty('code', 'starter_disabled')
    expect(f.calls).toHaveLength(0)
  })

  it('reads after a first-write execution-time refusal without touching newly created/deleted user work', async () => {
    const f = fixture(); const original = f.input.mcp.callTool; const id = pages[0].documentId
    f.input.mcp.callTool = async (target, name, args, signal) => {
      if (name === 'create_document_once') f.tombstones.add(id)
      return original(target, name, args, signal)
    }
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention', reason: 'unconfirmed-create' })
    expect(f.tombstones.has(id)).toBe(true)
    expect(f.docs.size).toBe(0)
    expect(f.writes()).toHaveLength(1)
  })

  it('times out after a claimed never-settling send, retaining its page and ignoring the late result', async () => {
    const f = fixture(); const original = f.input.mcp.callTool; const held = deferred<unknown>(); let sends = 0
    f.input.mcp.callTool = async (target, name, args, signal) => {
      if (name === 'create_document_once') { sends++; return held.promise }
      return original(target, name, args, signal)
    }
    expect(await ensureNewUserStarter({ ...f.input, timeoutMs: 30 })).toMatchObject({ status: 'attention', workspace, reason: 'budget-exhausted' })
    held.resolve({ success: true, outcome: 'created' }); await Promise.resolve()
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention' })
    expect(sends).toBe(1)
    expect(f.docs.size).toBe(0)
  })

  it('retains a confirmed owned target when this client cannot understand its edition', async () => {
    const f = fixture(); const body = f.snapshot(); body.seed.edition = 'a-future-edition'
    f.input.authority.post = async () => ({ status: 200, body })
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention', workspace, reason: 'unsupported-edition' })
    expect(f.calls).toHaveLength(0)
  })

  it('does not accept a matching projected body at a revision older than its create acknowledgement', async () => {
    const f = fixture(); const original = f.input.mcp.callTool
    f.input.mcp.callTool = async (...args) => { const value = await original(...args); return args[1] === 'create_document_once' ? { ...(value as object), revision: 2 } : value }
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'attention', reason: 'incomplete-readback' })
    expect(f.writes()).toHaveLength(1)
  })

  it('refuses a regressed original attempt identity in a subsequent snapshot', () => {
    const f = fixture(); const id = pages[0].documentId
    f.journal.set(id, { state: 'attempted', attemptId: 'original-attempt' })
    const original = decodeStarterResponse({ status: 200, body: f.snapshot() }, subject)
    if (original.status === 'not-applicable') throw new Error('fixture')
    f.journal.set(id, { state: 'attempted', attemptId: 'replacement-attempt' })
    expect(() => decodeStarterResponse({ status: 200, body: f.snapshot() }, subject, original)).toThrow('journal-regression')
  })

  it('does not downgrade an observed page on stale negative client reports', async () => {
    const f = fixture(); f.installPage(0)
    const claim = await f.input.authority.post(`${base}/pages/${pages[0].documentId}/claim`, {}, new AbortController().signal)
    const attemptId = (claim.body as { attemptId: string }).attemptId
    await f.input.authority.post(`${base}/pages/${pages[0].documentId}/report`, { attemptId, observation: 'template-present', observedPageHash: hash(pages[0]), observedRevision: 1 }, new AbortController().signal)
    await f.input.authority.post(`${base}/pages/${pages[0].documentId}/report`, { attemptId, observation: 'missing' }, new AbortController().signal)
    expect(f.journal.get(pages[0].documentId)?.state).toBe('observed-present')
    expect(await ensureNewUserStarter(f.input)).toMatchObject({ status: 'client-observed-complete' })
    expect(f.writes()).toHaveLength(8)
  })
})
