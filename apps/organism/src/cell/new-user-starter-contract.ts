import { STARTER_EDITION, STARTER_MANIFEST_SHA256, STARTER_PAGES } from './new-user-starter-content.js'

export const STARTER_API = '/me/starter-workspace'
export interface StarterWorkspace { readonly owner: string; readonly graphId: string; readonly generation: number }
export type StarterPageState = 'unattempted' | 'attempted' | 'observed-present' | 'attention'
export type StarterSeedState = 'pending' | 'client-observed-complete' | 'attention'
export interface StarterPageRecord { readonly documentId: string; readonly state: StarterPageState; readonly attemptId?: string }
export interface StarterSeed {
  readonly edition: string
  readonly manifestSha256: string
  readonly state: StarterSeedState
  readonly pages: readonly StarterPageRecord[]
}
export interface StarterRegistered {
  readonly schema: 'sophia.account-starter.v1'
  readonly subject: string
  readonly status: 'registered' | 'retained-unavailable'
  readonly workspace: StarterWorkspace
  readonly seed: StarterSeed
}
export interface StarterNotApplicable {
  readonly schema: 'sophia.account-starter.v1'
  readonly subject: string
  readonly status: 'not-applicable'
  readonly reason: 'pre-cutoff-account' | 'pre-cutoff-principal' | 'deliberate-work'
}
export interface StarterAuthorityResponse { readonly status: number; readonly body: unknown }
export interface StarterAuthority {
  /** One request; transport must not retry an ambiguous claim. */
  post(path: string, body: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<StarterAuthorityResponse>
}
export class StarterProtocolError extends Error {
  constructor(readonly reason: string, readonly httpStatus?: number, readonly code?: string, readonly retainedWorkspace?: StarterWorkspace) { super(reason); this.name = 'StarterProtocolError' }
}
export function starterRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new StarterProtocolError('invalid-response')
  const record = value as Record<string, unknown>
  if (record.isError === true || record.error !== undefined) throw new StarterProtocolError('refused-response')
  return record
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim() && !/[\u0000-\u0020\u007f]/.test(value)
}
export function decodeStarterResponse(
  response: StarterAuthorityResponse,
  subject: string,
  expected?: StarterRegistered,
): StarterRegistered | StarterNotApplicable {
  if (response.status !== 200 && response.status !== 201) {
    const error = response.body && typeof response.body === 'object' ? response.body as Record<string, unknown> : null
    const code = error?.schema === 'sophia.account-starter.v1' && error.subject === subject
      && typeof error.code === 'string'
      && ['starter_disabled', 'starter_authority_unavailable'].includes(error.code) ? error.code : undefined
    throw new StarterProtocolError('authority-unavailable', response.status, code)
  }
  const raw = starterRecord(response.body)
  if (raw.schema !== 'sophia.account-starter.v1' || raw.subject !== subject) throw new StarterProtocolError('identity-mismatch')
  if (raw.status === 'not-applicable') {
    if (expected || raw.workspace !== undefined || raw.seed !== undefined
      || typeof raw.reason !== 'string'
      || !['pre-cutoff-account', 'pre-cutoff-principal', 'deliberate-work'].includes(raw.reason)) {
      throw new StarterProtocolError('invalid-disposition')
    }
    return raw as unknown as StarterNotApplicable
  }
  if (raw.status !== 'registered' && raw.status !== 'retained-unavailable') throw new StarterProtocolError('invalid-disposition')
  const workspace = starterRecord(raw.workspace)
  if (workspace.owner !== `user:${subject}` || !nonempty(workspace.graphId)
    || !Number.isSafeInteger(workspace.generation) || (workspace.generation as number) < 1) {
    throw new StarterProtocolError('identity-mismatch')
  }
  const seed = starterRecord(raw.seed)
  if (seed.edition !== STARTER_EDITION || seed.manifestSha256 !== STARTER_MANIFEST_SHA256) {
    throw new StarterProtocolError('unsupported-edition', undefined, undefined, workspace as unknown as StarterWorkspace)
  }
  if (typeof seed.state !== 'string' || !['pending', 'client-observed-complete', 'attention'].includes(seed.state)
    || !Array.isArray(seed.pages) || seed.pages.length !== STARTER_PAGES.length) throw new StarterProtocolError('invalid-journal')
  const ids = new Set<string>()
  for (const value of seed.pages) {
    const page = starterRecord(value)
    if (!STARTER_PAGES.some(item => item.documentId === page.documentId) || ids.has(String(page.documentId))
      || typeof page.state !== 'string' || !['unattempted', 'attempted', 'observed-present', 'attention'].includes(page.state)
      || (page.state === 'unattempted' ? page.attemptId !== undefined : !nonempty(page.attemptId))) {
      throw new StarterProtocolError('invalid-journal')
    }
    ids.add(String(page.documentId))
  }
  const complete = seed.pages.every(value => starterRecord(value).state === 'observed-present')
  if ((seed.state === 'client-observed-complete') !== complete) throw new StarterProtocolError('invalid-journal')
  if (expected && (workspace.owner !== expected.workspace.owner || workspace.graphId !== expected.workspace.graphId
    || workspace.generation !== expected.workspace.generation || seed.edition !== expected.seed.edition
    || seed.manifestSha256 !== expected.seed.manifestSha256)) throw new StarterProtocolError('identity-mismatch')
  if (expected) {
    for (const previous of expected.seed.pages) {
      const next = seed.pages.map(starterRecord).find(page => page.documentId === previous.documentId)!
      if (previous.attemptId !== undefined && next.attemptId !== previous.attemptId
        || previous.state === 'observed-present' && next.state !== 'observed-present') {
        throw new StarterProtocolError('journal-regression')
      }
    }
  }
  return raw as unknown as StarterRegistered
}

/** Captured credential, no cookie/login, redirects or retries, no raw error-body exposure. */
export function createStarterAuthority(options: {
  readonly gatewayBaseUrl: string
  readonly token: string
  readonly isCurrent: () => boolean
  readonly fetch?: typeof fetch
}): StarterAuthority {
  const base = new URL(options.gatewayBaseUrl)
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || !options.token) {
    throw new StarterProtocolError('invalid-authority')
  }
  const root = base.toString().replace(/\/+$/, '')
  const fetcher = options.fetch ?? globalThis.fetch
  return {
    async post(path, body, signal) {
      if (!(path === STARTER_API || STARTER_PAGES.some(page => path === `${STARTER_API}/pages/${page.documentId}/claim`
        || path === `${STARTER_API}/pages/${page.documentId}/report`))) throw new StarterProtocolError('invalid-endpoint')
      if (!options.isCurrent() || signal.aborted) throw new StarterProtocolError('stale-session')
      const response = await fetcher(`${root}${path}`, {
        method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error', signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${options.token}` },
        body: JSON.stringify(body),
      })
      if (!options.isCurrent() || signal.aborted) throw new StarterProtocolError('stale-session')
      // Error bodies can contain provider detail: retain only the status class.
      if (!response.ok) {
        let error: unknown
        try { error = await response.json() } catch { error = null }
        if (!options.isCurrent() || signal.aborted) throw new StarterProtocolError('stale-session')
        const raw = error && typeof error === 'object' ? error as Record<string, unknown> : null
        const safe = raw?.schema === 'sophia.account-starter.v1' && typeof raw.subject === 'string'
          && typeof raw.code === 'string' && ['starter_disabled', 'starter_authority_unavailable'].includes(raw.code)
          ? { schema: raw.schema, subject: raw.subject, code: raw.code } : null
        return { status: response.status, body: safe }
      }
      let result: unknown
      try { result = await response.json() } catch { throw new StarterProtocolError('invalid-json') }
      if (!options.isCurrent() || signal.aborted) throw new StarterProtocolError('stale-session')
      return { status: response.status, body: result }
    },
  }
}
