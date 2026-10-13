/** Hosted startup orchestration. Eligibility and content authority live elsewhere. */
import type { AuthProvider } from '@shrubbery/nucleus/contract'
import type { CognitoAuthConfig } from './cognito-auth-session.js'
import { GatewayTransport, gatewayMcpText, type GatewayGraphInfo } from './gateway-transport.js'
import { createStarterAuthority, StarterProtocolError, type StarterWorkspace } from './new-user-starter-contract.js'
import { ensureNewUserStarter, type NewUserStarterResult, type StarterMcp } from './new-user-starter.js'

export const STARTER_GENERATION_HEADER = 'X-Sophia-Graph-Generation'

/** A finite directory read with one captured account, also used by Home refresh. */
export async function readCapturedHostedDirectory(options: {
  readonly gatewayBaseUrl: string
  readonly auth: AuthProvider
  readonly isCurrent: () => boolean
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
}): Promise<readonly GatewayGraphInfo[]> {
  const subject = options.auth.userId()
  const token = options.auth.token()
  const controller = new AbortController()
  const endpoint = `${options.gatewayBaseUrl.replace(/\/+$/, '')}/graphs`
  const fetcher = options.fetch ?? globalThis.fetch
  const isCurrent = () => options.isCurrent() && options.auth.isAuthenticated()
    && options.auth.userId() === subject && options.auth.token() === token && !controller.signal.aborted
  const ensureCurrent = () => { if (!token || !isCurrent()) throw new StarterProtocolError('stale-session') }
  let rejectStopped!: (error: Error) => void
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject })
  const stop = (reason: string) => { rejectStopped(new StarterProtocolError(reason)); controller.abort() }
  const unsubscribe = options.auth.onChange(() => { if (!isCurrent()) stop('stale-session') })
  const timer = setTimeout(() => stop('directory-timeout'), Math.min(10_000, Math.max(1, options.timeoutMs ?? 10_000)))
  const gateway = new GatewayTransport({
    gatewayBaseUrl: options.gatewayBaseUrl,
    auth: {
      whenReady: async () => { ensureCurrent() }, token: () => { ensureCurrent(); return token },
      userId: () => subject, isAuthenticated: isCurrent, onChange: () => () => {},
    },
    fetch: async (input, init = {}) => {
      ensureCurrent()
      if (String(input) !== endpoint || init.method !== 'GET') throw new StarterProtocolError('invalid-directory-endpoint')
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${token}`)
      ensureCurrent()
      const response = await fetcher(input, { ...init, headers, signal: controller.signal, credentials: 'omit', redirect: 'error' })
      ensureCurrent()
      return response
    },
  })
  try {
    ensureCurrent()
    const rows = await Promise.race([gateway.graphs(), stopped])
    ensureCurrent()
    return rows
  } finally {
    clearTimeout(timer)
    unsubscribe()
    controller.abort()
  }
}

/** A transport-class check only. The server alone verifies identity and newness. */
export function isNativeStarterSession(auth: AuthProvider, config: CognitoAuthConfig): boolean {
  const token = auth.token()
  if (!auth.isAuthenticated() || !token || !config.userPoolId) return false
  try {
    const part = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/') ?? ''
    const claims = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '='))) as Record<string, unknown>
    return claims.sub === auth.userId()
      && claims.iss === `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`
      && claims.aud === config.clientId && claims.token_use === 'id'
      && claims.identities === undefined
  } catch { return false }
}

function targetKey(workspace: StarterWorkspace, subject: string): string {
  if (workspace.owner !== `user:${subject}` || !workspace.graphId || workspace.graphId !== workspace.graphId.trim()
    || /[\s\u0000-\u001f\u007f]/.test(workspace.graphId)
    || !Number.isSafeInteger(workspace.generation) || workspace.generation < 1) {
    throw new StarterProtocolError('invalid-routing-identity')
  }
  return JSON.stringify([workspace.owner, workspace.graphId, workspace.generation])
}

/**
 * An isolated, captured-credential transport, not the ordinary token-fresh
 * contract or source mirror. Activation retries keep the SAME precondition.
 */
export function createCapturedStarterMcp(options: {
  readonly gatewayBaseUrl: string
  readonly subject: string
  readonly token: string
  readonly isCurrent: () => boolean
  readonly fetch?: typeof fetch
}): StarterMcp {
  let boundKey: string | undefined
  const base = new URL(options.gatewayBaseUrl)
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new StarterProtocolError('invalid-authority')
  }
  const fetcher = options.fetch ?? globalThis.fetch
  return {
    async callTool(workspace, name, args, signal) {
      const key = targetKey(workspace, options.subject)
      if (boundKey !== undefined && boundKey !== key) throw new StarterProtocolError('routing-identity-changed')
      boundKey = key
      const target = Object.freeze({ ...workspace })
      const ensureCurrent = () => {
        if (!options.token || !options.isCurrent() || signal.aborted) throw new StarterProtocolError('stale-session')
      }
      const mcpPath = `${base.pathname.replace(/\/+$/, '')}/o/${encodeURIComponent(target.owner)}/g/${encodeURIComponent(target.graphId)}/mcp`
      const gateway = new GatewayTransport({
        gatewayBaseUrl: options.gatewayBaseUrl,
        activationPollIntervalMs: 250,
        auth: {
          whenReady: async () => { ensureCurrent() },
          token: () => { ensureCurrent(); return options.token },
          userId: () => options.subject,
          isAuthenticated: () => options.isCurrent() && !signal.aborted,
          onChange: () => () => {},
        },
        fetch: async (input, init = {}) => {
          ensureCurrent()
          const url = new URL(String(input))
          if (url.origin !== base.origin || url.search || url.hash) throw new StarterProtocolError('invalid-mcp-endpoint')
          if (init.method === 'POST' && url.pathname === mcpPath) {
            const request = JSON.parse(String(init.body)) as { params?: { name?: unknown; arguments?: Record<string, unknown> } }
            const requestArgs = request.params?.arguments
            const ids = [requestArgs?.graphId, requestArgs?.graph_id].filter(value => value !== undefined)
            if (request.params?.name !== name || !['list_documents', 'read_document', 'create_document_once'].includes(name)
              || ids.length === 0 || ids.some(id => id !== target.graphId)) throw new StarterProtocolError('mcp-target-mismatch')
          } else if (!(init.method === 'GET' && url.pathname.startsWith('/activations/'))) {
            throw new StarterProtocolError('invalid-mcp-endpoint')
          }
          const headers = new Headers(init.headers)
          headers.set('Authorization', `Bearer ${options.token}`)
          headers.set(STARTER_GENERATION_HEADER, String(target.generation))
          // No async gap between this final identity check and dispatch.
          ensureCurrent()
          const response = await fetcher(input, { ...init, headers, signal, credentials: 'omit', redirect: 'error' })
          ensureCurrent()
          return response
        },
      })
      ensureCurrent()
      gateway.bindGraphOwner(target.graphId, target.owner)
      const result = await gateway.toolsCall(target.graphId, name, args)
      ensureCurrent()
      if (result.isError) {
        const message = gatewayMcpText(result)
        const documentId = args.documentId
        if (name === 'read_document' && typeof documentId === 'string'
          && [`document not found: ${documentId}`, `document tombstoned: ${documentId}`].includes(message)) throw new Error(message)
        throw new StarterProtocolError('mcp-tool-refused')
      }
      if (result.structuredContent !== undefined) return result.structuredContent
      const text = gatewayMcpText(result)
      return text ? JSON.parse(text) as unknown : undefined
    },
  }
}

export interface StarterStartupNotice {
  readonly kind: 'preparing' | 'prepared' | 'attention' | 'unavailable'
  readonly message: string
  readonly description: string
  readonly workspace?: StarterWorkspace
}

export type StarterStartupResult = NewUserStarterResult | { readonly status: 'skipped' }
export interface StarterStartupPreference {
  readonly workspace: StarterWorkspace
  /** Must still hold after the caller's fresh directory read, before selection. */
  readonly isCurrent: () => boolean
}
export interface HostedStarterStartup {
  readonly done: Promise<StarterStartupResult>
  /** Only an undirected root waits, for at most two seconds. No later navigation. */
  readonly initial: Promise<StarterStartupPreference | null>
  /** Retained after completion for a bounded catalog refresh, not navigation. */
  readonly isCurrent: () => boolean
  cancel(): void
}

export function starterNotice(result: StarterStartupResult): StarterStartupNotice | null {
  if (result.status === 'skipped' || result.status === 'stale' || result.status === 'not-applicable'
    || result.status === 'preserved'
    || result.status === 'unavailable' && result.httpStatus === 503 && result.code === 'starter_disabled') return null
  // Only an initial registration failure has this unbound result shape.
  // A missing page/claim after registration stays attention, never absence.
  if (result.status === 'unavailable' && result.reason === 'authority-unavailable' && result.httpStatus === 404) return {
    kind: 'unavailable', message: 'Automatic starter setup is unavailable',
    description: 'The starter setup endpoint returned HTTP 404. No starter completion was confirmed; your existing workspaces remain available.',
  }
  if (result.status === 'client-observed-complete') return {
    kind: 'prepared', message: 'Your starter pages are available', workspace: result.workspace,
    description: 'Open My Garden from Workspaces to explore and make it your own.',
  }
  return {
    kind: 'attention', message: result.status === 'retained-unavailable' ? 'My Garden is currently unavailable' : 'Starter setup could not finish',
    description: 'Your existing work was not overwritten. Workspaces is still available, and any starter work already saved is kept.',
    ...('workspace' in result ? { workspace: result.workspace } : {}),
  }
}

/** No graph/cell launch, provider job, fallback seeder or navigation lives here. */
export function startHostedStarter(options: {
  readonly mode: 'hosted' | 'local' | 'playground'
  readonly auth: AuthProvider
  readonly cognito: CognitoAuthConfig
  readonly gatewayBaseUrl: string
  readonly serviceProxySubject?: string
  readonly location: () => URL
  readonly isHostCurrent?: () => boolean
  readonly signal?: AbortSignal
  readonly fetch?: typeof fetch
  readonly runStarter?: typeof ensureNewUserStarter
  readonly timeoutMs?: number
  readonly initialWaitMs?: number
  readonly onNotice?: (notice: StarterStartupNotice | null) => void
}): HostedStarterStartup {
  if (options.mode !== 'hosted' || options.serviceProxySubject || !isNativeStarterSession(options.auth, options.cognito)) {
    return { done: Promise.resolve({ status: 'skipped' }), initial: Promise.resolve(null), isCurrent: () => false, cancel() {} }
  }
  const subject = options.auth.userId()
  const token = options.auth.token()!
  const entryHref = options.location().href
  const initialUrl = new URL(entryHref)
  const isRoot = initialUrl.pathname === '/' && !initialUrl.search && !initialUrl.hash
  const controller = new AbortController()
  let bound: StarterWorkspace | undefined
  let initialClosed = false
  const isSameSession = () => options.auth.isAuthenticated()
    && options.auth.userId() === subject && options.auth.token() === token && (options.isHostCurrent?.() ?? true)
  const isCurrent = () => !controller.signal.aborted && isSameSession()
  const isEntryCurrent = () => isCurrent() && !initialClosed && options.location().href === entryHref
  let resolveStopped!: (result: StarterStartupResult) => void
  const stopped = new Promise<StarterStartupResult>(resolve => { resolveStopped = resolve })
  const stop = (result: StarterStartupResult) => {
    resolveStopped(result)
    controller.abort()
    options.onNotice?.(isSameSession() ? starterNotice(result) : null)
  }
  const onAbort = () => stop({ status: 'stale' })
  const unsubscribe = options.auth.onChange(() => { if (!isCurrent()) onAbort() })
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) onAbort()
  const timeoutMs = Math.min(60_000, Math.max(1, options.timeoutMs ?? 60_000))
  const deadline = setTimeout(() => stop(bound
    ? { status: 'attention', workspace: bound, reason: 'budget-exhausted', observedDocumentIds: [] }
    : { status: 'unavailable', reason: 'budget-exhausted' }), timeoutMs)
  const run = options.runStarter ?? ensureNewUserStarter
  const done = Promise.race([
    Promise.resolve().then(() => {
      if (!isCurrent()) return { status: 'stale' } as const
      return run({
        subject, isCurrent, signal: controller.signal, timeoutMs,
        authority: createStarterAuthority({ gatewayBaseUrl: options.gatewayBaseUrl, token, isCurrent, fetch: options.fetch }),
        mcp: createCapturedStarterMcp({ gatewayBaseUrl: options.gatewayBaseUrl, subject, token, isCurrent, fetch: options.fetch }),
        onState(state) {
          if (!isCurrent() || state.phase !== 'preparing' || !state.workspace) return
          targetKey(state.workspace, subject)
          bound = Object.freeze({ ...state.workspace })
          options.onNotice?.({ kind: 'preparing', message: 'Preparing My Garden', workspace: bound,
            description: 'You can keep working while we prepare your starter pages.' })
        },
      })
    }).catch((): StarterStartupResult => isCurrent() ? { status: 'unavailable', reason: 'operation-unavailable' } : { status: 'stale' }),
    stopped,
  ]).then(result => {
    clearTimeout(deadline)
    if (isCurrent() || result.status === 'stale') options.onNotice?.(starterNotice(result))
    return result
  })
  const initial = isRoot ? new Promise<StarterStartupPreference | null>(resolve => {
    const timer = setTimeout(() => { initialClosed = true; resolve(null) }, Math.min(2_000, Math.max(0, options.initialWaitMs ?? 2_000)))
    void done.then(result => {
      clearTimeout(timer)
      if (result.status === 'client-observed-complete' && result.contentObservedThisRun && isEntryCurrent()) {
        // Keep the identity check live through the caller's directory read.
        resolve({ workspace: result.workspace, isCurrent: () => isCurrent() && options.location().href === entryHref })
      } else resolve(null)
    })
  }) : Promise.resolve(null)
  return {
    done, initial, isCurrent,
    cancel() {
      onAbort()
      unsubscribe()
      options.signal?.removeEventListener('abort', onAbort)
      clearTimeout(deadline)
    },
  }
}

/** Fresh directory confirmation, not a newness test or an inferred generation. */
export function confirmedStarterPreference(
  preference: StarterStartupPreference | null | undefined,
  graphs: readonly GatewayGraphInfo[],
  storedGraphId: string,
): string | null {
  if (!preference?.isCurrent() || graphs.some(graph => graph.graphId === storedGraphId)) return null
  const target = preference.workspace
  const matches = graphs.filter(graph => graph.graphId === target.graphId)
  if (matches.length !== 1) return null
  const graph = matches[0]
  return graph.owner === target.owner && graph.role === 'owner' && graph.generation === target.generation
    && !('localCreation' in graph && graph.localCreation) && !graph.lifetime
    ? target.graphId : null
}
