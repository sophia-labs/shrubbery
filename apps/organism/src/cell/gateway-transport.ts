import {
  API_KEY_PATH,
  ApiKeyError,
  isApiKeyScope,
  isValidApiKeyIdempotencyKey,
  validateApiKeyCreateRequest,
  validateApiKeyGraphKey,
  type ApiKeyCreateRequest,
  type ApiKeyCreateResponse,
  type ApiKeyDeleteResponse,
  type ApiKeyMetadata,
} from './api-key-contract.js'
/**
 * Hosted gateway HTTP/MCP transport.
 *
 * The gateway has two distinct authorities:
 *   - control plane: GET {gatewayRoot}/graphs
 *   - graph cell:    POST {gatewayRoot}/o/{owner}/g/{graphId}/mcp
 *
 * Authentication is deliberately resolved for every request. Cognito refresh
 * replaces the session's ID token in-place; capturing it in this transport's
 * constructor would make the next request use stale credentials.
 */

import type { AuthProvider } from '@shrubbery/nucleus/contract'
import {
  accessUserPrincipal,
  createControlAccessClient,
  type ControlMintedShareLink,
  type ControlRedeemedShareLink,
  type ControlShareLinkCreate,
  type ControlSharingState,
} from '@shrubbery/source/access-control'
import type { MnWorkspaceLifetimeState } from '@shrubbery/components'

export type GatewayGraphRole = 'viewer' | 'editor' | 'owner'
export type GatewayCellState = 'running' | 'stopped'

/** Current platform-next GET /graphs response row. */
export interface GatewayGraphInfo {
  /** Stable typed owner from canonical cloud-2 graph metadata. */
  readonly owner?: string
  /** Canonical gateway generation when the directory supplies it; never inferred. */
  readonly generation?: number
  readonly graphId: string
  readonly title: string
  readonly cellState: GatewayCellState
  readonly role: GatewayGraphRole
  readonly lifecycleState?: string
  /**
   * Present only for the OFFLINE source-mirror fallback row (master §3
   * Slice 7, WS3 §4.6) — the live gateway's own `/graphs` response never
   * carries this; a graph fenced against a REACHABLE gateway is a Law IV/VI
   * distinction the gateway itself resolves, not a mirror lifetime.
   */
  readonly lifetime?: MnWorkspaceLifetimeState | null
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

export type GatewayProviderCredentialSource = 'user' | 'platform' | 'none'

export interface GatewayProviderCredentialStatus {
  readonly provider: 'openrouter'
  readonly configured: boolean
  readonly effectiveSource: GatewayProviderCredentialSource
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
  /** Cognito-backed AuthProvider. Its token() is read afresh per request. */
  readonly auth: AuthProvider
  /** Browser fetch by default; injectable for deterministic shell tests. */
  readonly fetch?: typeof fetch
  /** Maximum cold-cell activation wait. Defaults to 90 seconds. */
  readonly activationTimeoutMs?: number
  /** Activation polling cadence. Defaults to 500ms; zero is useful in tests. */
  readonly activationPollIntervalMs?: number
}

function apiKeyInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function exactApiKeyKeys(row: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(row).sort()
  const canonical = [...expected].sort()
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new ApiKeyError('invalid_json', 502)
  }
}

/** JSON.parse intentionally collapses duplicate keys. Detect them in the raw
 * response first so a rolling or compromised gateway cannot smuggle an
 * ambiguous success envelope into API-key state. JSON.parse remains the
 * grammar authority; this scanner only classifies already-valid tokens. */
function parseStrictApiKeyJson(raw: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new ApiKeyError('invalid_json', 502)
  }
  type Frame = { kind: 'object'; phase: 'keyOrEnd' | 'colon' | 'value' | 'commaOrEnd'; keys: Set<string> }
    | { kind: 'array'; phase: 'valueOrEnd' | 'commaOrEnd' }
  const frames: Frame[] = []
  const token = /\s*("(?:\\["\\/bfnrt]|\\u[0-9a-fA-F]{4}|[^"\\\u0000-\u001f])*"|[{}\[\],:]|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/gy
  let offset = 0
  const beginValue = (value: string): void => {
    const parent = frames.at(-1)
    if (parent?.kind === 'object') parent.phase = 'commaOrEnd'
    if (parent?.kind === 'array') parent.phase = 'commaOrEnd'
    if (value === '{') frames.push({ kind: 'object', phase: 'keyOrEnd', keys: new Set() })
    if (value === '[') frames.push({ kind: 'array', phase: 'valueOrEnd' })
  }
  while (offset < raw.length) {
    if (!raw.slice(offset).trim()) break
    token.lastIndex = offset
    const match = token.exec(raw)
    if (!match) throw new ApiKeyError('invalid_json', 502)
    offset = token.lastIndex
    const value = match[1]!
    const frame = frames.at(-1)
    if (!frame) {
      beginValue(value)
      continue
    }
    if (frame.kind === 'object') {
      if (frame.phase === 'keyOrEnd') {
        if (value === '}') { frames.pop(); continue }
        if (!value.startsWith('"')) throw new ApiKeyError('invalid_json', 502)
        const key = JSON.parse(value) as string
        if (frame.keys.has(key)) throw new ApiKeyError('invalid_json', 502)
        frame.keys.add(key)
        frame.phase = 'colon'
      } else if (frame.phase === 'colon') {
        if (value !== ':') throw new ApiKeyError('invalid_json', 502)
        frame.phase = 'value'
      } else if (frame.phase === 'value') {
        beginValue(value)
      } else if (value === ',') {
        frame.phase = 'keyOrEnd'
      } else if (value === '}') {
        frames.pop()
      } else {
        throw new ApiKeyError('invalid_json', 502)
      }
      continue
    }
    if (frame.phase === 'valueOrEnd') {
      if (value === ']') { frames.pop(); continue }
      beginValue(value)
    } else if (value === ',') {
      frame.phase = 'valueOrEnd'
    } else if (value === ']') {
      frames.pop()
    } else {
      throw new ApiKeyError('invalid_json', 502)
    }
  }
  return parsed
}

/** Parse only the list-safe management projection, never an authority record. */
function parseApiKeyMetadata(value: unknown): ApiKeyMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiKeyError('invalid_json', 502)
  }
  const row = value as Record<string, unknown>
  exactApiKeyKeys(row, [
    'keyId', 'displayLabel', 'createdAtUnixSeconds', 'expiresAtUnixSeconds',
    'lastUsedAtUnixSeconds', 'lastUsedOutcome', 'status', 'scopes',
    'graphAllowlist', 'credentialVersion', 'terminalAtUnixSeconds',
    ...(Object.hasOwn(row, 'graphAccess') ? ['graphAccess'] : []),
  ])
  const keyId = typeof row.keyId === 'string' && row.keyId.trim() ? row.keyId : null
  const displayLabel = typeof row.displayLabel === 'string' ? row.displayLabel : null
  const createdAtUnixSeconds = apiKeyInteger(row.createdAtUnixSeconds)
  const expiresAtUnixSeconds = apiKeyInteger(row.expiresAtUnixSeconds)
  const credentialVersion = apiKeyInteger(row.credentialVersion)
  if (
    !keyId || displayLabel === null || createdAtUnixSeconds === null || expiresAtUnixSeconds === null
    || credentialVersion === null
    || (row.status !== 'active' && row.status !== 'revoked' && row.status !== 'deleted')
    || !Array.isArray(row.scopes) || !Array.isArray(row.graphAllowlist)
    || (row.lastUsedAtUnixSeconds !== null && apiKeyInteger(row.lastUsedAtUnixSeconds) === null)
    || (row.lastUsedOutcome !== null && row.lastUsedOutcome !== 'authorized')
    || (row.terminalAtUnixSeconds !== null && apiKeyInteger(row.terminalAtUnixSeconds) === null)
  ) {
    throw new ApiKeyError('invalid_json', 502)
  }
  const scopes = row.scopes.map(scope => {
    if (!isApiKeyScope(scope)) throw new ApiKeyError('invalid_json', 502)
    return scope
  })
  if (!scopes.length || new Set(scopes).size !== scopes.length) throw new ApiKeyError('invalid_json', 502)
  const graphAccess = row.graphAccess === undefined ? 'selected' : row.graphAccess
  if (graphAccess !== 'selected' && graphAccess !== 'all_accessible') throw new ApiKeyError('invalid_json', 502)
  const graphAllowlist = row.graphAllowlist.map(graph => {
    try {
      if (!graph || typeof graph !== 'object' || Array.isArray(graph)) throw new Error('invalid graph')
      exactApiKeyKeys(graph as Record<string, unknown>, ['owner', 'graphId'])
      return validateApiKeyGraphKey(graph as { owner: string; graphId: string })
    } catch {
      throw new ApiKeyError('invalid_json', 502)
    }
  })
  const graphKeys = graphAllowlist.map(graph => `${graph.owner}\u0000${graph.graphId}`)
  if ((graphAccess === 'selected' ? !graphAllowlist.length : graphAllowlist.length !== 0) || new Set(graphKeys).size !== graphKeys.length) {
    throw new ApiKeyError('invalid_json', 502)
  }
  return {
    keyId,
    displayLabel,
    createdAtUnixSeconds,
    expiresAtUnixSeconds,
    lastUsedAtUnixSeconds: row.lastUsedAtUnixSeconds === null ? null : apiKeyInteger(row.lastUsedAtUnixSeconds)!,
    lastUsedOutcome: row.lastUsedOutcome === null ? null : 'authorized',
    status: row.status,
    scopes,
    graphAllowlist,
    ...(graphAccess === 'all_accessible' ? { graphAccess } : {}),
    credentialVersion,
    terminalAtUnixSeconds: row.terminalAtUnixSeconds === null ? null : apiKeyInteger(row.terminalAtUnixSeconds)!,
  }
}

function parseApiKeyList(value: unknown): readonly ApiKeyMetadata[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiKeyError('invalid_json', 502)
  const envelope = value as Record<string, unknown>
  exactApiKeyKeys(envelope, ['apiKeys'])
  const rows = envelope.apiKeys
  if (!Array.isArray(rows)) throw new ApiKeyError('invalid_json', 502)
  const apiKeys = rows.map(parseApiKeyMetadata)
  if (new Set(apiKeys.map(key => key.keyId)).size !== apiKeys.length) {
    throw new ApiKeyError('invalid_json', 502)
  }
  return apiKeys
}

function parseApiKeyCreate(value: unknown): ApiKeyCreateResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiKeyError('invalid_json', 502)
  const row = value as Record<string, unknown>
  exactApiKeyKeys(row, ['apiKey', 'secret', 'replayed'])
  const secret = row.secret === null ? null : typeof row.secret === 'string' && row.secret ? row.secret : null
  if (typeof row.replayed !== 'boolean' || (row.secret !== null && secret === null)) {
    throw new ApiKeyError('invalid_json', 502)
  }
  // A replay cannot truthfully re-deliver the original secret.
  if (row.replayed && secret !== null) throw new ApiKeyError('invalid_json', 502)
  return { apiKey: parseApiKeyMetadata(row.apiKey), secret, replayed: row.replayed }
}

function parseApiKeyDelete(value: unknown): ApiKeyDeleteResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiKeyError('invalid_json', 502)
  const row = value as Record<string, unknown>
  exactApiKeyKeys(row, ['apiKey', 'deleted', 'revocationEpoch'])
  const revocationEpoch = apiKeyInteger(row.revocationEpoch)
  if (typeof row.deleted !== 'boolean' || revocationEpoch === null) throw new ApiKeyError('invalid_json', 502)
  return { apiKey: parseApiKeyMetadata(row.apiKey), deleted: row.deleted, revocationEpoch }
}

function safeApiKeyErrorCode(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const candidate = typeof row.code === 'string'
    ? row.code
    : typeof row.error === 'string'
      ? row.error
      : null
  return new Set([
    'cognito_human_required', 'idempotency_key_required', 'application_json_required',
    'api_key_payload_too_large', 'invalid_json', 'duplicate_field', 'invalid_api_key_request',
    'invalid_scope', 'invalid_graph_allowlist', 'duplicate_graph', 'idempotency_key_reused',
    'api_key_quota_exceeded', 'api_keys_erased', 'api_key_not_found', 'api_key_inactive',
    'api_key_authority_unavailable',
  ]).has(candidate ?? '') ? candidate! : null
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

export function gatewayGraphBaseUrl(
  gatewayBaseUrl: string,
  graphId: string,
  owner?: string | null,
): string {
  if (!graphId.trim()) throw new Error('Gateway graph id must not be empty')
  const graphPath = `/g/${encodeURIComponent(graphId)}`
  return owner?.trim()
    ? `${normalizeGatewayBaseUrl(gatewayBaseUrl)}/o/${encodeURIComponent(owner.trim())}${graphPath}`
    : `${normalizeGatewayBaseUrl(gatewayBaseUrl)}${graphPath}`
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
  if (row.generation !== undefined && (!Number.isSafeInteger(row.generation) || (row.generation as number) < 1)) {
    throw new Error(`Gateway GET /graphs row ${index} has an invalid generation`)
  }
  return {
    ...(owner ? { owner } : {}),
    ...(row.generation !== undefined ? { generation: row.generation as number } : {}),
    graphId: row.graphId,
    title: row.title,
    cellState,
    role: row.role,
    ...(lifecycleState ? { lifecycleState } : {}),
    ...(row.lifetime !== undefined ? { lifetime: row.lifetime as MnWorkspaceLifetimeState | null } : {}),
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

function providerCredentialStatus(value: unknown): GatewayProviderCredentialStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Gateway provider-credential status is not an object')
  }
  const row = value as Record<string, unknown>
  if (
    row.provider !== 'openrouter'
    || typeof row.configured !== 'boolean'
    || (row.effectiveSource !== 'user' && row.effectiveSource !== 'platform' && row.effectiveSource !== 'none')
  ) {
    throw new Error('Gateway provider-credential status has an invalid shape')
  }
  return row as unknown as GatewayProviderCredentialStatus
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

export function gatewayMcpText(result: GatewayMcpResult): string {
  if (!Array.isArray(result.content)) return JSON.stringify(result)
  return result.content
    .filter(item => item?.type === 'text' && typeof item.text === 'string')
    .map(item => item.text as string)
    .join('')
}

/** Token-fresh gateway client shared by the hosted RestClient and WireWriter. */
export class GatewayTransport {
  readonly gatewayBaseUrl: string
  private readonly fetchImpl: typeof fetch
  private graphOwners = new Map<string, string | null>()
  private explicitGraphOwners = new Map<string, string>()
  private nextId = 1
  private readonly accessControl = createControlAccessClient({
    resolveOwner: async (graphId: string) => {
      if (!this.graphOwners.has(graphId)) await this.graphs()
      const owner = this.graphOwners.get(graphId)
      if (owner === null) throw new Error('Access graph identity is ambiguous across owners')
      if (!owner) throw new Error('Access owner binding is unavailable; refresh the workspace directory.')
      return owner
    },
    request: body => this.requestJson('POST', `${this.gatewayBaseUrl}/control/mcp`, body),
  })

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

  /** Bind a trusted host's exact owner; never derive access authority from the caller. */
  bindGraphOwner(graphId: string, owner: string): void {
    if (!graphId || graphId !== graphId.trim()) throw new Error('Gateway graph id must be nonempty without surrounding whitespace')
    const exactOwner = accessUserPrincipal(owner)
    const prior = this.explicitGraphOwners.get(graphId)
    if (prior !== undefined && prior !== exactOwner) throw new Error('Gateway graph is already bound to a different owner identity')
    this.explicitGraphOwners.set(graphId, exactOwner)
    this.graphOwners.set(graphId, exactOwner)
  }

  async graphs(): Promise<readonly GatewayGraphInfo[]> {
    const graphs = graphList(await this.requestJson('GET', `${this.gatewayBaseUrl}/graphs`))
    this.adoptGraphDirectory(graphs)
    return graphs
  }

  /** Replace ordinary routing hints from a validated, current account directory. */
  adoptGraphDirectory(graphs: readonly GatewayGraphInfo[]): void {
    const owners = new Map<string, string | null>()
    for (const graph of graphs) {
      if (!graph.owner) continue
      if (!owners.has(graph.graphId)) {
        owners.set(graph.graphId, graph.owner)
        continue
      }
      if (owners.get(graph.graphId) !== graph.owner) owners.set(graph.graphId, null)
    }
    for (const [graphId, owner] of this.explicitGraphOwners) owners.set(graphId, owner)
    this.graphOwners = owners
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
      this.graphOwners.delete(id)
    } catch (error) {
      if (request && error instanceof GatewayHttpError && error.status === 404) return
      throw error
    }
  }

  async access(graphId: string): Promise<readonly GatewayAccessGrant[]> {
    return this.accessControl.list(graphId)
  }

  async putAccess(
    graphId: string,
    userId: string,
    request: GatewayPutAccessRequest,
  ): Promise<void> {
    await this.accessControl.put(graphId, userId, request)
  }

  async deleteAccess(graphId: string, userId: string): Promise<void> {
    await this.accessControl.remove(graphId, userId)
  }

  /** Owner sharing view: everyone-signed-in and share links (never tokens). */
  async sharing(graphId: string): Promise<ControlSharingState> {
    return this.accessControl.sharing(graphId)
  }

  async setEveryoneAccess(graphId: string, enabled: boolean): Promise<void> {
    await this.accessControl.setEveryone(graphId, enabled)
  }

  async createShareLink(graphId: string, request: ControlShareLinkCreate): Promise<ControlMintedShareLink> {
    return this.accessControl.createLink(graphId, request)
  }

  async revokeShareLink(graphId: string, linkId: string): Promise<void> {
    await this.accessControl.revokeLink(graphId, linkId)
  }

  /** Join through a share link; the gateway grants the link's role to this account. */
  async redeemShareLink(token: string): Promise<ControlRedeemedShareLink> {
    const redeemed = await this.accessControl.redeem(token)
    this.graphOwners.delete(redeemed.graphId)
    return redeemed
  }

  async providerCredentialStatus(provider: 'openrouter'): Promise<GatewayProviderCredentialStatus> {
    return providerCredentialStatus(await this.requestJson(
      'GET',
      `${this.gatewayBaseUrl}/me/provider-credentials/${provider}`,
    ))
  }

  async putProviderCredential(provider: 'openrouter', apiKey: string): Promise<void> {
    if (!apiKey.trim()) throw new Error('Provider credential must not be empty')
    await this.requestJson(
      'PUT',
      `${this.gatewayBaseUrl}/me/provider-credentials/${provider}`,
      { apiKey },
    )
  }

  async deleteProviderCredential(provider: 'openrouter'): Promise<void> {
    await this.requestJson(
      'DELETE',
      `${this.gatewayBaseUrl}/me/provider-credentials/${provider}`,
    )
  }

  async toolsCall(
    graphId: string,
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<GatewayMcpResult> {
    return this.graphRpc(graphId, 'tools/call', { name, arguments: args }, name)
  }

  /** The cell's advertised MCP tool surface (`tools/list`) for one graph. */
  async toolsList(graphId: string): Promise<readonly Record<string, unknown>[]> {
    const result = await this.graphRpc(graphId, 'tools/list', {}, 'tools/list')
    const tools = (result as { readonly tools?: unknown }).tools
    if (!Array.isArray(tools)) {
      throw new Error('Gateway MCP response for tools/list has no tools array')
    }
    return tools.filter((tool): tool is Record<string, unknown> =>
      Boolean(tool) && typeof tool === 'object' && !Array.isArray(tool))
  }

  private async graphRpc(
    graphId: string,
    method: 'tools/call' | 'tools/list',
    params: Readonly<Record<string, unknown>>,
    name: string,
  ): Promise<GatewayMcpResult> {
    const url = `${this.graphBaseUrl(graphId)}/mcp`
    const request = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method,
      params,
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

  /** Authenticated raw Y.Doc snapshot read; does not create a live room. */
  async documentSnapshot(
    graphId: string,
    documentId: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<{ readonly update: Uint8Array; readonly incarnation: string | null }> {
    const graph = graphId.trim()
    const document = documentId.trim()
    if (!graph || !document) {
      throw new Error('GatewayTransport.documentSnapshot(): graphId and documentId are required')
    }
    const url = `${this.graphBaseUrl(graph)}/documents/${encodeURIComponent(graph)}/${encodeURIComponent(document)}/blob`
    await this.options.auth.whenReady()
    const token = this.options.auth.token()
    if (!token) throw new Error(`Gateway GET ${url}: authentication token is unavailable`)
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/octet-stream',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
      signal: options.signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new GatewayHttpError('GET', url, response.status, body)
    }
    return {
      update: new Uint8Array(await response.arrayBuffer()),
      incarnation: response.headers.get('x-document-incarnation')?.trim() || null,
    }
  }

  /**
   * Read one coherent workspace source snapshot and graph-incarnation fence.
   * The gateway route is graph-prefixed, while the cell route retains the
   * graph id in the hosted-compatible document path.
   */
  async workspaceSnapshot(
    graphId: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<{ readonly update: Uint8Array; readonly incarnation: string }> {
    const graph = graphId.trim()
    if (!graph) throw new Error('GatewayTransport.workspaceSnapshot(): graphId is required')
    const url = `${this.graphBaseUrl(graph)}/documents/${encodeURIComponent(graph)}/workspace/blob`
    await this.options.auth.whenReady()
    const token = this.options.auth.token()
    if (!token) throw new Error(`Gateway GET ${url}: authentication token is unavailable`)
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/octet-stream',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
      signal: options.signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new GatewayHttpError('GET', url, response.status, body)
    }
    const incarnation = response.headers.get('x-graph-incarnation')?.trim()
    if (!incarnation) {
      throw new GatewayHttpError(
        'GET',
        url,
        502,
        'workspace snapshot response omitted x-graph-incarnation',
      )
    }
    return {
      update: new Uint8Array(await response.arrayBuffer()),
      incarnation,
    }
  }

  async documentUpdate(
    graphId: string,
    documentId: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<Uint8Array> {
    return (await this.documentSnapshot(graphId, documentId, options)).update
  }

  /**
   * GET a graph-scoped gateway path OUTSIDE the MCP JSON-RPC envelope, for a
   * REST route that has no MCP tool wrapping it (see `putJson` below).
   */
  async getJson<T>(graphId: string, path: string): Promise<T> {
    return this.requestJson('GET', `${this.graphBaseUrl(graphId)}${path}`) as Promise<T>
  }

  /**
   * PUT arbitrary JSON to a graph-scoped gateway path OUTSIDE the MCP JSON-RPC
   * envelope, for a REST route that has no MCP tool wrapping it (mirrors the
   * curated `putAccess`/`putProviderCredential` calls above, generalized to an
   * arbitrary path under `/g/{graphId}`).
   */
  async putJson<T>(graphId: string, path: string, body: unknown): Promise<T> {
    return this.requestJson('PUT', `${this.graphBaseUrl(graphId)}${path}`, body) as Promise<T>
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
      throw new Error(
        `Gateway activation '${activation.activationId}' returned an unsafe poll URL`,
      )
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

  async listApiKeys(options: { readonly signal?: AbortSignal } = {}): Promise<readonly ApiKeyMetadata[]> {
    return parseApiKeyList(await this.requestApiKeyJson(
      'GET', `${new URL(this.gatewayBaseUrl).origin}${API_KEY_PATH}`, undefined, undefined, options.signal,
    ))
  }

  /** Fresh Cognito bearer on every create; the idempotency key is caller-owned. */
  async createApiKey(
    request: ApiKeyCreateRequest,
    idempotencyKey: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<ApiKeyCreateResponse> {
    if (!isValidApiKeyIdempotencyKey(idempotencyKey)) {
      throw new ApiKeyError('idempotency_key_required', 428)
    }
    return parseApiKeyCreate(await this.requestApiKeyJson(
      'POST',
      `${new URL(this.gatewayBaseUrl).origin}${API_KEY_PATH}`,
      validateApiKeyCreateRequest(request),
      idempotencyKey,
      options.signal,
    ))
  }

  /** Deletion is an idempotent root-only revocation lifecycle operation. */
  async deleteApiKey(
    keyId: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<ApiKeyDeleteResponse> {
    const id = keyId.trim()
    if (!id) throw new ApiKeyError('api_key_not_found', 404)
    return parseApiKeyDelete(await this.requestApiKeyJson(
      'DELETE', `${new URL(this.gatewayBaseUrl).origin}${API_KEY_PATH}/${encodeURIComponent(id)}`, undefined, undefined, options.signal,
    ))
  }

  private async requestApiKeyJson(
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    body: ApiKeyCreateRequest | undefined,
    idempotencyKey: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    try {
      await this.options.auth.whenReady()
    } catch {
      throw new ApiKeyError('api_key_authority_unavailable', 503)
    }
    const subject = this.options.auth.userId()
    const token = this.options.auth.token()
    if (!subject || !token) throw new ApiKeyError('authentication', 401)
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    }
    let encodedBody: string | undefined
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      headers['Idempotency-Key'] = idempotencyKey!
      encodedBody = JSON.stringify(body)
    }
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method, headers, ...(encodedBody === undefined ? {} : { body: encodedBody }), cache: 'no-store', signal,
      })
    } catch {
      throw new ApiKeyError('api_key_authority_unavailable', 503)
    }
    const raw = await response.text().catch(() => '')
    if (this.options.auth.userId() !== subject) throw new ApiKeyError('authentication', 401)
    if (!response.ok) {
      let parsed: unknown = null
      try { parsed = raw ? JSON.parse(raw) as unknown : null } catch { /* stable fallback below */ }
      const reported = safeApiKeyErrorCode(parsed)
      const code = reported
        ?? (response.status === 401
          ? 'authentication'
          : response.status === 403
            ? 'authorization'
            : response.status >= 500
              ? 'api_key_authority_unavailable'
              : 'invalid_api_key_request')
      throw new ApiKeyError(code, response.status)
    }
    if (!raw) throw new ApiKeyError('invalid_json', 502)
    try {
      return parseStrictApiKeyJson(raw)
    } catch (error) {
      if (error instanceof ApiKeyError) throw error
      throw new ApiKeyError('invalid_json', 502)
    }
  }

  private async requestJson(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<unknown> {
    await this.options.auth.whenReady()
    const token = this.options.auth.token()
    if (!token) throw new Error(`Gateway ${method} ${url}: authentication token is unavailable`)

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    }
    let encodedBody: string | undefined
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      encodedBody = JSON.stringify(body)
    }
    const response = await this.fetchImpl(url, { method, headers, body: encodedBody, cache: 'no-store' })
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
