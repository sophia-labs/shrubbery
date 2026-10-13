/**
 * The private, self-only Cloud-2 API-key management contract.
 *
 * This is deliberately restricted to the authenticated gateway-root
 * `/me/api-keys` surface. It contains no bearer verification, graph routing,
 * cell activation, MCP transport, or WebSocket implementation.
 */

export const API_KEY_PATH = '/me/api-keys'
export const API_KEY_LABEL_MAX_CHARS = 100
export const API_KEY_MAX_GRAPHS = 128

export const API_KEY_SCOPES = ['graphs.read', 'graphs.write', 'mcp.read', 'mcp.write'] as const
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]
export type ApiKeyGraphAccess = 'selected' | 'all_accessible'

export interface ApiKeyGraphKey {
  readonly owner: string
  readonly graphId: string
}

export type ApiKeyStatus = 'active' | 'revoked' | 'deleted'
export type ApiKeyLastUsedOutcome = 'authorized'

/** Safe list/create/delete metadata. It never has an owner sub, verifier, or secret. */
export interface ApiKeyMetadata {
  readonly keyId: string
  readonly displayLabel: string
  readonly createdAtUnixSeconds: number
  readonly expiresAtUnixSeconds: number
  readonly lastUsedAtUnixSeconds: number | null
  readonly lastUsedOutcome: ApiKeyLastUsedOutcome | null
  readonly status: ApiKeyStatus
  readonly scopes: readonly ApiKeyScope[]
  /** Omitted on legacy records/requests means selected, never global. */
  readonly graphAccess?: ApiKeyGraphAccess
  readonly graphAllowlist: readonly ApiKeyGraphKey[]
  readonly credentialVersion: number
  readonly terminalAtUnixSeconds: number | null
}

export interface ApiKeyCreateRequest {
  readonly displayLabel: string
  readonly expiresAtUnixSeconds: number
  readonly scopes: readonly ApiKeyScope[]
  /** Omitted on legacy records/requests means selected, never global. */
  readonly graphAccess?: ApiKeyGraphAccess
  readonly graphAllowlist: readonly ApiKeyGraphKey[]
}

export interface ApiKeyCreateResponse {
  readonly apiKey: ApiKeyMetadata
  /** A non-null value exists only in the original creation response. */
  readonly secret: string | null
  readonly replayed: boolean
}

export interface ApiKeyDeleteResponse {
  readonly apiKey: ApiKeyMetadata
  readonly deleted: boolean
  readonly revocationEpoch: number
}

export type ApiKeyErrorCode =
  | 'authentication'
  | 'authorization'
  | 'cognito_human_required'
  | 'api_key_authority_unavailable'
  | 'idempotency_key_required'
  | 'application_json_required'
  | 'api_key_payload_too_large'
  | 'invalid_json'
  | 'duplicate_field'
  | 'invalid_api_key_request'
  | 'invalid_scope'
  | 'invalid_graph_allowlist'
  | 'duplicate_graph'
  | 'idempotency_key_reused'
  | 'api_key_quota_exceeded'
  | 'api_keys_erased'
  | 'api_key_not_found'
  | 'api_key_inactive'

export class ApiKeyError extends Error {
  constructor(
    readonly code: ApiKeyErrorCode | string,
    readonly status: number,
  ) {
    super(`API key request failed: ${code}`)
    this.name = 'ApiKeyError'
  }
}

function scalarLength(value: string): number {
  return Array.from(value).length
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

const PRINCIPAL = /^(?:user|agent|service|organization):[A-Za-z0-9_.@:-]{1,192}$/
// This deliberately accepts the gateway's documented stable slug vocabulary
// only. In particular neither a URL path nor `*` can become an allowlist row.
function isGraphId(value: string): boolean {
  return value.length >= 1
    && value.length <= 40
    && /^[a-z0-9-]+$/.test(value)
    && !value.startsWith('-')
    && !value.endsWith('-')
}

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return value === 'graphs.read' || value === 'graphs.write' || value === 'mcp.read' || value === 'mcp.write'
}

/** Mirrors the durable GraphKey shape without projecting a route or graph-wide grant. */
export function validateApiKeyGraphKey(value: ApiKeyGraphKey): ApiKeyGraphKey {
  if (!value || typeof value !== 'object') throw new ApiKeyError('invalid_graph_allowlist', 422)
  const owner = typeof value.owner === 'string' ? value.owner.trim() : ''
  const graphId = typeof value.graphId === 'string' ? value.graphId.trim() : ''
  if (!PRINCIPAL.test(owner) || !isGraphId(graphId) || owner.includes('*') || graphId.includes('*')) {
    throw new ApiKeyError('invalid_graph_allowlist', 422)
  }
  return { owner, graphId }
}

/**
 * Exact client-side preflight for the management route. Server policy remains
 * authoritative for expiry limits and quotas; this only refuses values that
 * cannot ever express the closed v1 request vocabulary.
 */
export function validateApiKeyCreateRequest(value: ApiKeyCreateRequest): ApiKeyCreateRequest {
  if (!value || typeof value !== 'object') throw new ApiKeyError('invalid_api_key_request', 422)
  const displayLabel = typeof value.displayLabel === 'string' ? value.displayLabel.normalize('NFC').trim() : ''
  if (!displayLabel || scalarLength(displayLabel) > API_KEY_LABEL_MAX_CHARS) {
    throw new ApiKeyError('invalid_api_key_request', 422)
  }
  if (!positiveSafeInteger(value.expiresAtUnixSeconds)) {
    throw new ApiKeyError('invalid_api_key_request', 422)
  }
  if (!Array.isArray(value.scopes) || !value.scopes.length || value.scopes.length > API_KEY_SCOPES.length) {
    throw new ApiKeyError('invalid_scope', 422)
  }
  const scopes = value.scopes.map(scope => {
    if (!isApiKeyScope(scope)) throw new ApiKeyError('invalid_scope', 422)
    return scope
  })
  if (scopes.includes('mcp.write') && !scopes.includes('mcp.read')) throw new ApiKeyError('invalid_scope', 422)
  if (new Set(scopes).size !== scopes.length) throw new ApiKeyError('invalid_scope', 422)
  const graphAccess = value.graphAccess === undefined ? 'selected' : value.graphAccess
  if (graphAccess !== 'selected' && graphAccess !== 'all_accessible') throw new ApiKeyError('invalid_graph_allowlist', 422)
  if (!Array.isArray(value.graphAllowlist) || value.graphAllowlist.length > API_KEY_MAX_GRAPHS
    || (graphAccess === 'selected' ? !value.graphAllowlist.length : value.graphAllowlist.length !== 0)) {
    throw new ApiKeyError('invalid_graph_allowlist', 422)
  }
  const graphAllowlist = value.graphAllowlist.map(validateApiKeyGraphKey)
  const graphKeys = graphAllowlist.map(graph => `${graph.owner}\u0000${graph.graphId}`)
  if (new Set(graphKeys).size !== graphKeys.length) throw new ApiKeyError('duplicate_graph', 422)
  return { displayLabel, expiresAtUnixSeconds: value.expiresAtUnixSeconds, scopes, graphAllowlist, ...(graphAccess === 'all_accessible' ? { graphAccess } : {}) }
}

/** platform-next accepts this exact, bounded Idempotency-Key grammar. */
export function isValidApiKeyIdempotencyKey(value: string): boolean {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 128
    && /^[A-Za-z0-9._~-]+$/.test(value)
}
