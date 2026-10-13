import { STARTER_API, StarterProtocolError, decodeStarterResponse, starterRecord, type StarterAuthority, type StarterRegistered, type StarterWorkspace } from './new-user-starter-contract.js'
import { STARTER_MANIFEST_SHA256, STARTER_PAGE_HASHES, STARTER_PAGES, starterCanonicalJson, starterManifestBytes, starterSha256 } from './new-user-starter-content.js'

export interface StarterMcp {
  /** Canonical routing identity is separate from the exact tool arguments. */
  callTool(workspace: StarterWorkspace, name: 'list_documents' | 'read_document' | 'create_document_once', args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<unknown>
}

export interface NewUserStarterInput {
  readonly subject: string
  readonly authority: StarterAuthority
  /** Authoritative MCP, bound by the caller to this captured subject AND token. */
  readonly mcp: StarterMcp
  readonly isCurrent: () => boolean
  readonly signal?: AbortSignal
  /** Whole invocation bound. No background retry or timer loop is installed. */
  readonly timeoutMs?: number
  readonly onState?: (state: { readonly phase: 'registering' | 'preparing'; readonly workspace?: StarterWorkspace }) => void
}
export type NewUserStarterResult =
  | { readonly status: 'not-applicable'; readonly reason: string }
  | { readonly status: 'stale' }
  | { readonly status: 'unavailable'; readonly reason: string; readonly httpStatus?: number; readonly code?: string }
  | { readonly status: 'attention' | 'retained-unavailable'; readonly workspace: StarterWorkspace; readonly reason: string; readonly observedDocumentIds: readonly string[] }
  | { readonly status: 'preserved' | 'client-observed-complete'; readonly workspace: StarterWorkspace; readonly observedDocumentIds: readonly string[]; readonly contentObservedThisRun: boolean; readonly durabilityConfirmed: false }

function census(value: unknown): readonly string[] {
  try {
    const raw = starterRecord(value); const page = starterRecord(raw.page)
    if (!Array.isArray(raw.documents) || raw.count !== raw.documents.length || page.complete !== true
      || page.nextCursor !== null || page.returned !== raw.documents.length) throw new Error()
    const ids = raw.documents.map(value => {
      const id = starterRecord(value).documentId
      if (typeof id !== 'string' || !id.trim() || id !== id.trim()) throw new Error()
      return id
    })
    if (new Set(ids).size !== ids.length) throw new Error()
    return ids
  } catch { throw new StarterProtocolError('incomplete-census') }
}

type Observation = { readonly kind: 'template-present'; readonly revision: number; readonly pageHash: string }
  | { readonly kind: 'different' | 'missing' | 'unknown'; readonly reason: string }

function identity(raw: Record<string, unknown>, keys: readonly string[], expected: string): boolean {
  const present = keys.filter(key => raw[key] !== undefined)
  return present.length > 0 && present.every(key => raw[key] === expected)
}

function inspectPage(value: unknown, workspace: StarterWorkspace, page: (typeof STARTER_PAGES)[number], minimumRevision: number): Observation {
  try {
    const raw = starterRecord(value)
    if (!identity(raw, ['graphId', 'graph_id'], workspace.graphId) || !identity(raw, ['documentId', 'document_id'], page.documentId)
      || raw.format !== 'json' || raw.complete !== true || raw.fragment !== false || raw.offset !== 0
      || raw.nextOffset !== null || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < minimumRevision
      || typeof raw.content !== 'string') return { kind: 'unknown', reason: 'incomplete-readback' }
    const projection = starterRecord(JSON.parse(raw.content))
    const actual = { documentId: page.documentId, title: raw.title, tiptapJson: projection.tiptapJson }
    if (starterCanonicalJson(actual) !== starterCanonicalJson(page)) return { kind: 'different', reason: 'different-content' }
    return { kind: 'template-present', revision: raw.revision as number, pageHash: STARTER_PAGE_HASHES[page.documentId] }
  } catch { return { kind: 'unknown', reason: 'invalid-readback' } }
}

/**
 * Finite, server-targeted bootstrap. No eligibility inference, navigation, old
 * opt-in seeder, background retry, grant, or document repair. Only a fresh
 * durable page claim may send create_document_once once. Ordinary write_document
 * is deliberately not part of StarterMcp's surface.
 */
export async function ensureNewUserStarter(input: NewUserStarterInput): Promise<NewUserStarterResult> {
  let bound: StarterRegistered | undefined
  const observed: string[] = []
  const controller = new AbortController()
  const timeoutMs = input.timeoutMs ?? 60_000
  let stoppedReason = 'aborted'
  let active = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectStop!: (error: unknown) => void
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject })
  // The invocation may finish before any operation consumes the stop promise.
  void stopped.catch(() => {})
  const stop = (reason: string) => {
    if (controller.signal.aborted) return
    stoppedReason = reason
    controller.abort()
    rejectStop(new StarterProtocolError(reason))
  }
  const onAbort = () => stop('aborted')
  const current = () => {
    if (!input.isCurrent()) throw new StarterProtocolError('stale-session')
    if (!active || controller.signal.aborted) throw new StarterProtocolError(stoppedReason)
  }
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    current()
    const value = await Promise.race([Promise.resolve().then(() => { current(); return operation() }), stopped])
    current()
    return value
  }
  const attention = (reason: string): NewUserStarterResult => ({
    status: 'attention', workspace: bound!.workspace, reason, observedDocumentIds: observed.slice(),
  })
  try {
    if (!/^[^\s:]+$/.test(input.subject) || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
      throw new StarterProtocolError('invalid-input')
    }
    if (input.signal?.aborted) stop('aborted')
    input.signal?.addEventListener('abort', onAbort, { once: true })
    current()
    timer = setTimeout(() => stop('budget-exhausted'), timeoutMs)
    // Source drift cannot reuse an old server manifest merely by copying its constant.
    if (await run(() => starterSha256(starterManifestBytes())) !== STARTER_MANIFEST_SHA256) throw new StarterProtocolError('unsupported-edition')
    input.onState?.({ phase: 'registering' })
    const registration = decodeStarterResponse(await run(() => input.authority.post(STARTER_API, {}, controller.signal)), input.subject)
    if (registration.status === 'not-applicable') return { status: 'not-applicable', reason: registration.reason }
    bound = registration
    if (bound.status === 'retained-unavailable') return { status: 'retained-unavailable', workspace: bound.workspace, reason: 'retained-target-unavailable', observedDocumentIds: [] }
    if (bound.seed.state === 'client-observed-complete') return { status: 'preserved', workspace: bound.workspace, observedDocumentIds: [], contentObservedThisRun: false, durabilityConfirmed: false }
    input.onState?.({ phase: 'preparing', workspace: bound.workspace })
    const call = (name: Parameters<StarterMcp['callTool']>[1], args: Readonly<Record<string, unknown>>) =>
      run(() => input.mcp.callTool(bound!.workspace, name, args, controller.signal))
    const ids = census(await call('list_documents', { graphId: bound.workspace.graphId, limit: 100, maxBytes: 262144 }))
    if (ids.some(id => !STARTER_PAGES.some(page => page.documentId === id))) return attention('existing-work')

    const read = async (page: (typeof STARTER_PAGES)[number], minimumRevision = 1): Promise<Observation> => {
      try {
        return inspectPage(await call('read_document', { graphId: bound!.workspace.graphId, documentId: page.documentId, format: 'json', offset: 0, maxChars: 262144 }), bound!.workspace, page, minimumRevision)
      } catch (error) {
        current()
        const message = error instanceof Error ? error.message : ''
        // These exact current engine strings are not a generic lifecycle schema.
        // Unknown/refused/malformed responses must never authorize a create.
        if ([`document not found: ${page.documentId}`, `Gateway MCP error for read_document: document not found: ${page.documentId}`].includes(message)) {
          return { kind: 'missing', reason: 'missing' }
        }
        if ([`document tombstoned: ${page.documentId}`, `Gateway MCP error for read_document: document tombstoned: ${page.documentId}`].includes(message)) {
          return { kind: 'different', reason: 'deleted-content' }
        }
        return { kind: 'unknown', reason: 'unreadable-content' }
      }
    }

    for (const [index, page] of STARTER_PAGES.entries()) {
      current()
      const claimResponse = await run(() => input.authority.post(`${STARTER_API}/pages/${page.documentId}/claim`, {}, controller.signal))
      const claim = decodeStarterResponse(claimResponse, input.subject, bound)
      if (claim.status !== 'registered') return attention('retained-target-unavailable')
      const rawClaim = starterRecord(claimResponse.body)
      const row = claim.seed.pages.find(item => item.documentId === page.documentId)!
      if (rawClaim.documentId !== page.documentId || rawClaim.attemptId !== row.attemptId || !row.attemptId
        || typeof rawClaim.freshGrant !== 'boolean' || rawClaim.freshGrant !== (claimResponse.status === 201)
        || (rawClaim.freshGrant && row.state !== 'attempted')) throw new StarterProtocolError('invalid-claim')
      bound = claim
      // Another tab may have completed the entire edition while we were waiting.
      if (bound.seed.state === 'client-observed-complete') return { status: 'preserved', workspace: bound.workspace, observedDocumentIds: observed.slice(), contentObservedThisRun: false, durabilityConfirmed: false }
      let observation = await read(page)
      let uncertainCreate = false
      if (observation.kind === 'missing' && rawClaim.freshGrant === true) {
        let minimumRevision = 1
        try {
          const created = starterRecord(await call('create_document_once', {
            graph_id: bound.workspace.graphId, document_id: page.documentId, title: page.title,
            tiptapJson: page.tiptapJson, order: (index + 1) * 10, parentId: null, awaitDurable: true,
          }))
          if (created.success !== true || created.outcome !== 'created'
            || !identity(created, ['graphId', 'graph_id'], bound.workspace.graphId)
            || !identity(created, ['documentId', 'document_id'], page.documentId)
            || !Number.isSafeInteger(created.revision) || (created.revision as number) < 1) uncertainCreate = true
          else minimumRevision = created.revision as number
        } catch { current(); uncertainCreate = true }
        // Acknowledgement alone is neither rendered, projected nor durable proof.
        observation = await read(page, minimumRevision)
      }
      if (observation.kind === 'template-present') observed.push(page.documentId)
      const report: Record<string, unknown> = { attemptId: row.attemptId, observation: observation.kind }
      if (observation.kind === 'template-present') { report.observedPageHash = observation.pageHash; report.observedRevision = observation.revision }
      const reportResponse = await run(() => input.authority.post(`${STARTER_API}/pages/${page.documentId}/report`, report, controller.signal))
      const reported = decodeStarterResponse(reportResponse, input.subject, bound)
      const rawReport = starterRecord(reportResponse.body)
      if (reported.status !== 'registered') return attention('retained-target-unavailable')
      if (reportResponse.status !== 200 || rawReport.documentId !== page.documentId || rawReport.attemptId !== row.attemptId
        || rawReport.freshGrant !== undefined) throw new StarterProtocolError('invalid-report')
      bound = reported
      if (uncertainCreate) return attention('unconfirmed-create')
      if (observation.kind !== 'template-present') return attention(observation.reason)
      if (reported.seed.pages.find(item => item.documentId === page.documentId)?.state !== 'observed-present') throw new StarterProtocolError('unconfirmed-report')
    }
    if (bound.seed.state !== 'client-observed-complete' || observed.length !== STARTER_PAGES.length) return attention('unconfirmed-report')
    return { status: 'client-observed-complete', workspace: bound.workspace, observedDocumentIds: observed.slice(), contentObservedThisRun: true, durabilityConfirmed: false }
  } catch (error) {
    if (!input.isCurrent() || error instanceof StarterProtocolError && error.reason === 'stale-session') return { status: 'stale' }
    const reason = error instanceof StarterProtocolError ? error.reason : 'operation-unavailable'
    if (bound) return attention(reason)
    if (error instanceof StarterProtocolError && error.retainedWorkspace) {
      return { status: 'attention', workspace: error.retainedWorkspace, reason, observedDocumentIds: [] }
    }
    return { status: 'unavailable', reason, ...(error instanceof StarterProtocolError ? { httpStatus: error.httpStatus, code: error.code } : {}) }
  } finally {
    active = false
    if (timer !== undefined) clearTimeout(timer)
    input.signal?.removeEventListener('abort', onAbort)
    controller.abort()
  }
}
