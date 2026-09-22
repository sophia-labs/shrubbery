/**
 * gateway-transport.ts — hosted gateway HTTP/MCP transport.
 *
 * HOISTED near-as-is from apps/organism/src/cell/gateway-transport.ts
 * @ b2f408e (design §2.2 hoist map: "as-is") — organism's copy is frozen
 * under active swarm ownership; @shrubbery/source is the sole external
 * adapter-consumption convention.
 *
 * The gateway has two distinct authorities:
 *   - control plane: GET {gatewayRoot}/graphs
 *   - graph cell:    POST {gatewayRoot}/o/{owner}/g/{graphId}/mcp (canonical)
 *                    or the rolling-deploy legacy /g/{graphId} alias
 *
 * Authentication is deliberately resolved for every request. Cognito refresh
 * replaces the session's ID token in-place; capturing it in this transport's
 * constructor would make the next request use stale credentials.
 *
 * Two DOCUMENTED deltas from the organism original (design §2.7 / R8):
 *   1. ANONYMOUS requests: when the AuthProvider carries no token (auth mode
 *      'none' → AnonymousAuth, or a signed-out CognitoAuthSession), the
 *      request is sent WITHOUT an Authorization header instead of throwing
 *      locally. The gateway answers with an honest 401 whose body rides
 *      verbatim in GatewayHttpError — never a silent downgrade, never a
 *      locally-fabricated refusal that hides the server's own testimony.
 *   2. `cellJson()`: a generic JSON request against a CELL route under
 *      /g/{graphId} (used by the hosted adapter's Viewer-eligible 'sparql'
 *      readPath: POST {cellQueryRoute} + GET the job result_url).
 *
 * Browser-safe: global fetch only.
 */

import type { AuthProvider } from '@shrubbery/nucleus'

export type GatewayGraphRole = 'viewer' | 'editor' | 'owner'
export type GatewayCellState = 'running' | 'stopped'

/** Current platform-next GET /graphs response row. */
export interface GatewayGraphInfo {
  /** Stable typed owner from canonical cloud-2 graph metadata. */
  readonly owner?: string
  readonly graphId: string
  readonly title: string
  readonly cellState: GatewayCellState
  readonly role: GatewayGraphRole
  readonly lifecycleState?: string
}

export interface GatewayCreateGraphRequest {
  /** Optional stable slug. When omitted, the gateway mints a collision-safe id. */
  readonly graphId?: string
  readonly title?: string
  readonly graphIncarnation?: string
  readonly operationId?: string
}

export interface GatewayCreatedGraph {
  readonly owner?: string
  readonly graphId: string
  readonly title: string
  readonly graphIncarnation?: string
  readonly operationId?: string
  readonly duplicate?: boolean
}

export interface GatewayDeleteGraphRequest {
  readonly expectedGraphIncarnation: string
  readonly operationId: string
}

export interface GatewayAccessGrant {
  readonly userId: string
  readonly role: GatewayGraphRole
  readonly grantedAt: string
  readonly grantedBy: string
  readonly email?: string
  readonly displayName?: string
}

export interface GatewayPutAccessRequest {
  readonly role: Exclude<GatewayGraphRole, 'owner'>
  readonly email?: string
  readonly displayName?: string
}

export interface GatewayTransportOptions {
  /** Gateway root, e.g. https://api.canary.sophia-labs.com. */
  readonly gatewayBaseUrl: string
  /** AuthProvider. Its token() is read afresh per request; when it returns
   *  undefined the request goes out WITHOUT an Authorization header (honest
   *  anonymous — the gateway's 401 body then rides verbatim). */
  readonly auth: AuthProvider
  /** Browser fetch by default; injectable for Node test harnesses. */
  readonly fetch?: typeof fetch
  /** Maximum cold-cell activation wait. Defaults to 90 seconds. */
  readonly activationTimeoutMs?: number
  /** Activation polling cadence. Defaults to 500ms; zero is useful in tests. */
  readonly activationPollIntervalMs?: number
}

interface McpContentItem {
  readonly type?: string
  readonly text?: string
}

export interface GatewayMcpResult {
  readonly content?: readonly McpContentItem[]
  readonly [k: string]: unknown
}

interface McpResponse {
  readonly result?: GatewayMcpResult
  readonly error?: {
    readonly code?: number
    readonly message?: string
    readonly data?: unknown
  }
}

interface GatewayActivationEnvelope {
  readonly code: 'graph_activating'
  readonly activationId: string
  readonly pollUrl: string
}

type GatewayActivationPhase =
  | 'scheduling'
  | 'scaling'
  | 'hydrating'
  | 'repairing'
  | 'ready'
  | 'failed'

interface GatewayActivationRecord {
  readonly activationId: string
  readonly phase: GatewayActivationPhase
  readonly error?: string | null
}

export class GatewayHttpError extends Error {
  constructor(
    readonly method: string,
    readonly url: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`Gateway ${method} ${url} failed with HTTP ${status}: ${responseBody.slice(0, 500)}`)
    this.name = 'GatewayHttpError'
  }
}

export class GatewayMcpError extends Error {
  constructor(
    readonly tool: string,
    readonly code: number | undefined,
    readonly data: unknown,
    message: string,
  ) {
    super(`Gateway MCP error for ${tool}: ${message}`)
    this.name = 'GatewayMcpError'
  }
}

export function normalizeGatewayBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error('Gateway base URL must be an absolute http(s) URL')
  }
  return trimmed
}

/** Validate the exact typed principal grammar enforced by platform-next's
 * `PrincipalId`. Keeping this at the transport boundary prevents an owner
 * supplied by a host from degrading into the ownerless `/g/{slug}` alias. */
export function normalizeGatewayOwnerPrincipal(value: string): string {
  const separator = value.indexOf(':')
  const exactKind = separator >= 0 ? value.slice(0, separator) : ''
  const exactSubject = separator >= 0 ? value.slice(separator + 1) : ''
  if (
    !['user', 'agent', 'service', 'organization'].includes(exactKind)
    || exactSubject.length === 0
    || exactSubject.length > 192
    || !/^[A-Za-z0-9_.@:-]+$/.test(exactSubject)
  ) {
    throw new Error(`Gateway owner principal '${value}' is invalid`)
  }
  return value
}

export function gatewayGraphBaseUrl(
  gatewayBaseUrl: string,
  graphId: string,
  owner?: string | null,
): string {
  if (!graphId.trim()) throw new Error('Gateway graph id must not be empty')
  const graphPath = `/g/${encodeURIComponent(graphId)}`
  return owner === undefined || owner === null
    ? `${normalizeGatewayBaseUrl(gatewayBaseUrl)}${graphPath}`
    : `${normalizeGatewayBaseUrl(gatewayBaseUrl)}/o/${encodeURIComponent(normalizeGatewayOwnerPrincipal(owner))}${graphPath}`
}

function graphInfo(value: unknown, index: number): GatewayGraphInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Gateway GET /graphs row ${index} is not an object`)
  }
  const row = value as Record<string, unknown>
  const owner = typeof row.owner === 'string' && row.owner.trim() ? row.owner.trim() : undefined
  const lifecycleState = typeof row.lifecycleState === 'string' ? row.lifecycleState : undefined
  const cellState = row.cellState === 'running' || row.cellState === 'stopped'
    ? row.cellState
    : lifecycleState === 'active'
      ? 'running'
      : lifecycleState === 'provisioning' || lifecycleState === 'repairing'
        ? 'stopped'
        : undefined
  if (
    typeof row.graphId !== 'string' || !row.graphId ||
    typeof row.title !== 'string' ||
    !cellState ||
    (row.role !== 'viewer' && row.role !== 'editor' && row.role !== 'owner')
  ) {
    throw new Error(`Gateway GET /graphs row ${index} has an invalid graphId/title/cellState/role shape`)
  }
  return {
    ...(owner ? { owner } : {}),
    graphId: row.graphId,
    title: row.title,
    cellState,
    role: row.role,
    ...(lifecycleState ? { lifecycleState } : {}),
  }
}

function graphList(value: unknown): readonly GatewayGraphInfo[] {
  // Current platform-next returns a bare array. Accept `{items}` as a rolling-
  // deploy compatibility envelope because the shipped Garden API client has
  // historically seen that gateway shape; always expose one stable array.
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : null
  if (!rows) throw new Error('Gateway GET /graphs returned neither an array nor an { items } envelope')
  return rows.map(graphInfo)
}

function createdGraph(value: unknown): GatewayCreatedGraph {
  const envelope = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
  const row = envelope?.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
    ? envelope.data as Record<string, unknown>
    : envelope
  const graphId = typeof row?.graphId === 'string'
    ? row.graphId
    : typeof row?.graph_id === 'string'
      ? row.graph_id
      : ''
  const title = typeof row?.title === 'string' ? row.title : graphId
  const owner = typeof row?.owner === 'string' && row.owner.trim() ? row.owner.trim() : undefined
  if (!graphId.trim()) throw new Error('Gateway POST /graphs returned no graph id')
  const graphIncarnation = typeof row?.graphIncarnation === 'string'
    ? row.graphIncarnation
    : typeof row?.graph_incarnation === 'string'
      ? row.graph_incarnation
      : undefined
  const operationId = typeof row?.operationId === 'string'
    ? row.operationId
    : typeof row?.operation_id === 'string'
      ? row.operation_id
      : undefined
  return {
    ...(owner ? { owner } : {}),
    graphId,
    title,
    ...(graphIncarnation ? { graphIncarnation } : {}),
    ...(operationId ? { operationId } : {}),
    ...(row?.duplicate === true ? { duplicate: true } : {}),
  }
}

function activationEnvelope(value: unknown): GatewayActivationEnvelope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (
    row.code !== 'graph_activating'
    || typeof row.activationId !== 'string'
    || !row.activationId.trim()
    || typeof row.pollUrl !== 'string'
    || !row.pollUrl.trim()
  ) return null
  return {
    code: 'graph_activating',
    activationId: row.activationId.trim(),
    pollUrl: row.pollUrl.trim(),
  }
}

function activationRecord(value: unknown, expectedId: string): GatewayActivationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Gateway activation '${expectedId}' returned a non-object record`)
  }
  const row = value as Record<string, unknown>
  const phases = new Set<GatewayActivationPhase>([
    'scheduling', 'scaling', 'hydrating', 'repairing', 'ready', 'failed',
  ])
  if (
    row.activationId !== expectedId
    || typeof row.phase !== 'string'
    || !phases.has(row.phase as GatewayActivationPhase)
    || (row.error !== undefined && row.error !== null && typeof row.error !== 'string')
  ) {
    throw new Error(`Gateway activation '${expectedId}' returned an invalid record`)
  }
  return {
    activationId: expectedId,
    phase: row.phase as GatewayActivationPhase,
    ...(row.error === undefined ? {} : { error: row.error as string | null }),
  }
}

function accessGrant(value: unknown, index: number): GatewayAccessGrant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Gateway GET /graphs/{id}/access row ${index} is not an object`)
  }
  const row = value as Record<string, unknown>
  if (
    typeof row.userId !== 'string' || !row.userId.trim()
    || (row.role !== 'viewer' && row.role !== 'editor' && row.role !== 'owner')
    || typeof row.grantedAt !== 'string'
    || typeof row.grantedBy !== 'string'
    || (row.email !== undefined && typeof row.email !== 'string')
    || (row.displayName !== undefined && typeof row.displayName !== 'string')
  ) {
    throw new Error(`Gateway GET /graphs/{id}/access row ${index} has an invalid grant shape`)
  }
  return row as unknown as GatewayAccessGrant
}

function accessList(value: unknown): readonly GatewayAccessGrant[] {
  if (!Array.isArray(value)) throw new Error('Gateway GET /graphs/{id}/access returned a non-array')
  return value.map(accessGrant)
}

export function gatewayMcpText(result: GatewayMcpResult): string {
  if (!Array.isArray(result.content)) return JSON.stringify(result)
  return result.content
    .filter(item => item?.type === 'text' && typeof item.text === 'string')
    .map(item => item.text as string)
    .join('')
}

/** Token-fresh gateway client shared by the hosted TripleSource and any
 *  future hosted writer. */
export class GatewayTransport {
  readonly gatewayBaseUrl: string
  private readonly fetchImpl: typeof fetch
  private graphOwners = new Map<string, string | null>()
  private explicitGraphOwners = new Map<string, string>()
  private nextId = 1

  constructor(private readonly options: GatewayTransportOptions) {
    this.gatewayBaseUrl = normalizeGatewayBaseUrl(options.gatewayBaseUrl)
    const fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('GatewayTransport requires fetch')
    this.fetchImpl = fetchImpl.bind(globalThis) as typeof fetch
  }

  graphBaseUrl(graphId: string): string {
    const owner = this.graphOwners.get(graphId)
    if (owner === null) {
      throw new Error(`Gateway graph id '${graphId}' is ambiguous across owners`)
    }
    return gatewayGraphBaseUrl(this.gatewayBaseUrl, graphId, owner)
  }

  /** Bind one graph slug to the exact owner asserted by the trusted host.
   * Explicit bindings survive control-plane discovery and conflicting host
   * bindings refuse instead of silently retargeting subsequent requests. */
  bindGraphOwner(graphId: string, owner: string): void {
    const id = graphId.trim()
    if (!id) throw new Error('Gateway graph id must not be empty')
    if (id !== graphId) throw new Error('Gateway graph id must not have surrounding whitespace')
    const exactOwner = normalizeGatewayOwnerPrincipal(owner)
    const alreadyBound = this.explicitGraphOwners.get(id)
    if (alreadyBound !== undefined && alreadyBound !== exactOwner) {
      throw new Error(
        `Gateway graph id '${id}' is already bound to owner '${alreadyBound}', not '${exactOwner}'`,
      )
    }
    this.explicitGraphOwners.set(id, exactOwner)
    this.graphOwners.set(id, exactOwner)
  }

  async graphs(): Promise<readonly GatewayGraphInfo[]> {
    const graphs = graphList(await this.requestJson('GET', `${this.gatewayBaseUrl}/graphs`))
    const owners = new Map<string, string | null>()
    for (const graph of graphs) {
      if (!graph.owner) continue
      if (!owners.has(graph.graphId)) {
        owners.set(graph.graphId, graph.owner)
      } else if (owners.get(graph.graphId) !== graph.owner) {
        owners.set(graph.graphId, null)
      }
    }
    for (const [graphId, owner] of this.explicitGraphOwners) owners.set(graphId, owner)
    this.graphOwners = owners
    return graphs
  }

  async createGraph(request: GatewayCreateGraphRequest = {}): Promise<GatewayCreatedGraph> {
    const graphId = request.graphId?.trim()
    const title = request.title?.trim()
    const graphIncarnation = request.graphIncarnation?.trim()
    const operationId = request.operationId?.trim()
    const created = createdGraph(await this.requestJson('POST', `${this.gatewayBaseUrl}/graphs`, {
      ...(graphId ? { graphId } : {}),
      ...(title ? { title } : {}),
      ...(graphIncarnation ? { graphIncarnation } : {}),
      ...(operationId ? { operationId } : {}),
    }))
    if (created.owner) this.graphOwners.set(created.graphId, created.owner)
    return created
  }

  async deleteGraph(graphId: string, request?: GatewayDeleteGraphRequest): Promise<void> {
    const id = graphId.trim()
    if (!id) throw new Error('Gateway graph id must not be empty')
    const query = request
      ? `?${new URLSearchParams({
          expectedGraphIncarnation: request.expectedGraphIncarnation,
          operationId: request.operationId,
        }).toString()}`
      : ''
    try {
      await this.requestJson(
        'DELETE',
        `${this.gatewayBaseUrl}/graphs/${encodeURIComponent(id)}${query}`,
      )
    } catch (error) {
      // A fenced retry after the gateway already completed deletion has no
      // remaining grant to inspect and correctly returns 404. The stable local
      // intent makes that terminal state convergent, not ambiguous.
      if (request && error instanceof GatewayHttpError && error.status === 404) return
      throw error
    }
  }

  async access(graphId: string): Promise<readonly GatewayAccessGrant[]> {
    const id = graphId.trim()
    if (!id) throw new Error('Gateway graph id must not be empty')
    return accessList(await this.requestJson(
      'GET',
      `${this.gatewayBaseUrl}/graphs/${encodeURIComponent(id)}/access`,
    ))
  }

  async putAccess(
    graphId: string,
    userId: string,
    request: GatewayPutAccessRequest,
  ): Promise<void> {
    const graph = graphId.trim()
    const user = userId.trim()
    if (!graph) throw new Error('Gateway graph id must not be empty')
    if (!user) throw new Error('Gateway access user id must not be empty')
    if (request.role !== 'viewer' && request.role !== 'editor') {
      throw new Error('Gateway access role must be viewer or editor')
    }
    const email = request.email?.trim()
    const displayName = request.displayName?.trim()
    await this.requestJson(
      'PUT',
      `${this.gatewayBaseUrl}/graphs/${encodeURIComponent(graph)}/access/${encodeURIComponent(user)}`,
      {
        role: request.role,
        ...(email ? { email } : {}),
        ...(displayName ? { displayName } : {}),
      },
    )
  }

  async deleteAccess(graphId: string, userId: string): Promise<void> {
    const graph = graphId.trim()
    const user = userId.trim()
    if (!graph) throw new Error('Gateway graph id must not be empty')
    if (!user) throw new Error('Gateway access user id must not be empty')
    await this.requestJson(
      'DELETE',
      `${this.gatewayBaseUrl}/graphs/${encodeURIComponent(graph)}/access/${encodeURIComponent(user)}`,
    )
  }

  /**
   * Generic JSON request against a CELL route under /g/{graphId} — the
   * gateway strips the /g/{id} prefix and forwards `route` to the cell.
   * Used by the hosted adapter's Viewer-eligible 'sparql' readPath
   * (POST {cellQueryRoute}; GET the returned job result_url, which the cell
   * emits cell-root-relative, e.g. '/graphs/jobs/{id}/result').
   */
  async cellJson(
    graphId: string,
    method: 'GET' | 'POST',
    route: string,
    body?: unknown,
  ): Promise<unknown> {
    if (!route.startsWith('/')) {
      throw new Error(`Gateway cell route must be cell-root-relative (got '${route}')`)
    }
    return this.requestJson(method, `${this.graphBaseUrl(graphId)}${route}`, body)
  }

  async toolsCall(
    graphId: string,
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<GatewayMcpResult> {
    const url = `${this.graphBaseUrl(graphId)}/mcp`
    const request = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: { name, arguments: args },
    }
    let rawResponse = await this.requestJson('POST', url, request)
    for (let activationRound = 0; ; activationRound += 1) {
      const activation = activationEnvelope(rawResponse)
      if (!activation) break
      if (activationRound >= 1) {
        throw new Error(
          `Gateway graph remained unavailable after activation '${activation.activationId}' completed`,
        )
      }
      await this.waitForActivation(activation)
      rawResponse = await this.requestJson('POST', url, request)
    }
    if (!rawResponse || typeof rawResponse !== 'object' || Array.isArray(rawResponse)) {
      throw new Error(`Gateway MCP response for ${name} is not a JSON-RPC object`)
    }
    const response = rawResponse as McpResponse
    if (response.error) {
      throw new GatewayMcpError(
        name,
        response.error.code,
        response.error.data,
        response.error.message ?? 'unknown MCP error',
      )
    }
    if (!response.result || typeof response.result !== 'object' || Array.isArray(response.result)) {
      throw new Error(`Gateway MCP response for ${name} has neither an error nor a result object`)
    }
    return response.result
  }

  private async waitForActivation(activation: GatewayActivationEnvelope): Promise<void> {
    const gateway = new URL(this.gatewayBaseUrl)
    const poll = new URL(activation.pollUrl, `${gateway.origin}/`)
    if (
      poll.origin !== gateway.origin
      || !poll.pathname.startsWith('/activations/')
      || poll.search
      || poll.hash
    ) {
      throw new Error(`Gateway activation '${activation.activationId}' returned an unsafe poll URL`)
    }
    const timeoutMs = this.options.activationTimeoutMs ?? 90_000
    const intervalMs = this.options.activationPollIntervalMs ?? 500
    const deadline = Date.now() + timeoutMs
    while (true) {
      const record = activationRecord(
        await this.requestJson('GET', poll.toString()),
        activation.activationId,
      )
      if (record.phase === 'ready') return
      if (record.phase === 'failed') {
        throw new Error(
          `Gateway activation '${activation.activationId}' failed${record.error ? `: ${record.error}` : ''}`,
        )
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Gateway activation '${activation.activationId}' timed out after ${timeoutMs}ms (last phase: ${record.phase})`,
        )
      }
      await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, intervalMs)))
    }
  }

  private async requestJson(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
  ): Promise<unknown> {
    await this.options.auth.whenReady()
    const token = this.options.auth.token()

    const headers: Record<string, string> = {
      Accept: 'application/json',
      // No token → no Authorization header: the honest anonymous request.
      // The gateway's 401 (body verbatim in GatewayHttpError) is the answer —
      // never a silent downgrade, never a locally-fabricated refusal.
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
    let encodedBody: string | undefined
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      encodedBody = JSON.stringify(body)
    }
    // Built as a loose local (not a fresh literal at the call site): this
    // package's tsconfig has no DOM lib (browser-safety doctrine), so the
    // ambient fetch types come from undici's RequestInit, which — unlike
    // the DOM lib's — doesn't declare `cache`. The property is real and
    // honored by both runtimes; only the excess-property literal check
    // would object.
    const init = { method, headers, body: encodedBody, cache: 'no-store' as const }
    const response = await this.fetchImpl(url, init)
    const responseBody = await response.text()
    if (!response.ok) throw new GatewayHttpError(method, url, response.status, responseBody)
    if (!responseBody) return null
    try {
      return JSON.parse(responseBody) as unknown
    } catch (error) {
      throw new Error(
        `Gateway ${method} ${url} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
