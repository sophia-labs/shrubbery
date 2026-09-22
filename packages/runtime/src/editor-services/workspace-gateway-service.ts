/**
 * workspace-gateway-service.ts — the gateway CONTROL-PLANE REST transport
 * for `workspace.picker` (`GET`/`POST /graphs`, `DELETE /graphs/{id}`) and
 * `access.manager` (`GET`/`PUT`/`DELETE /graphs/{id}/access`) (Wave 1, north
 * star §2.2/§3: elevate the 5 trapped faces).
 *
 * WHY THIS FILE EXISTS: `apps/organism/src/cell/gateway-transport.ts`
 * (`GatewayTransport`) already implements this EXACT route surface —
 * `.graphs()`, `.createGraph()`, `.deleteGraph()`, `.access()`,
 * `.putAccess()`, `.deleteAccess()` — real, validated production traffic
 * against the gateway CONTROL plane (`{gatewayRoot}/graphs`, NOT a per-graph
 * CELL route — that file's own header: "control plane: GET
 * {gatewayRoot}/graphs") — but only as a class closed over an app-level
 * `AuthProvider` + `fetch` inside `apps/organism`, an app `packages/runtime`
 * cannot import (wrong dependency direction — apps depend on packages, never
 * the reverse; `hosted-viewer-rest-client.ts`'s own header documents the
 * identical constraint for its own transport). The two P2 faces this module
 * backs need the SAME transport from inside `@shrubbery/runtime`, so this
 * file hoists it — same real routes, same response validation
 * (`catalogEntry`/`createdGraph`/`accessGrantEntry` below mirror
 * `gateway-transport.ts`'s own `graphInfo`/`createdGraph`/`accessGrant`
 * row-shape guards field-for-field) — decoupled from any one app's
 * `AuthProvider`/contract type via a minimal `WorkspaceGatewayTransport` (a
 * base-URL resolver + a headers() supplier), exactly mirroring
 * `document-snapshot-service.ts`'s own `DocumentSnapshotTransport` seam
 * (that file's header: "any caller ... can satisfy it without a new nucleus
 * contract field").
 *
 * `WorkspaceCatalogService.create`/`.remove` (wave1 review r1 WRONG fix):
 * the wave-1 review found `workspace.picker` was silently missing these two
 * routes even though `GatewayTransport.createGraph`/`.deleteGraph` — the
 * exact production routes this file already hoists validation for on the
 * access side — were sitting right there unused. Added here, same
 * validation/error-envelope tolerance as every other method in this file.
 *
 * `apps/organism/src/cell/gateway-transport.ts` is UNTOUCHED by this file
 * (this wave's rule is "change of mount, not rewrite" — de-duplicating the
 * app's own copy is a later cleanup, not attempted here, same disclaimer
 * `document-snapshot-service.ts` itself carries).
 */

export interface WorkspaceGatewayTransport {
  /** Gateway control-plane root, e.g. https://api.canary.sophia-labs.com — NO trailing slash guaranteed by the caller. */
  resolveGatewayBaseUrl(): string
  /** Extra request headers (auth) — called fresh per request, never cached. */
  headers(): Record<string, string>
}

export type WorkspaceGraphRole = 'viewer' | 'editor' | 'owner'
export type WorkspaceGraphCellState = 'running' | 'stopped'

/** One `GET /graphs` catalog row — mirrors `GatewayGraphInfo` field-for-field. */
export interface WorkspaceCatalogEntry {
  readonly graphId: string
  readonly title: string
  readonly cellState: WorkspaceGraphCellState
  readonly role: WorkspaceGraphRole
}

export interface WorkspaceCreatedGraph {
  readonly graphId: string
  readonly title: string
}

export interface CreateWorkspaceRequest {
  readonly title?: string
}

/**
 * `create`/`remove` — wave1 review r1 WRONG fix: `workspace.picker` used to
 * supply `capabilities: {}` and `createCapability: { available: false }`
 * unconditionally (`workspace-picker-face.ts`'s own header), silently
 * reducing the face below `mn-workspace-selector`'s own default (owner-
 * delete inferred when `capabilities` is omitted) even though production
 * ALREADY has both real routes wired (`apps/organism/src/main.ts`'s
 * `createHostedWorkspace`/`deleteHostedWorkspace`, over the SAME
 * `POST /graphs` / `DELETE /graphs/{id}` this file's own header describes).
 * Byte-for-byte the same routes/response-shape as `apps/organism/src/cell/
 * gateway-transport.ts`'s own `createGraph`/`deleteGraph`.
 */
export interface WorkspaceCatalogService {
  list(): Promise<readonly WorkspaceCatalogEntry[]>
  create(request?: CreateWorkspaceRequest): Promise<WorkspaceCreatedGraph>
  remove(graphId: string): Promise<void>
}

/** One `GET /graphs/{id}/access` grant row — mirrors `GatewayAccessGrant` field-for-field. */
export interface AccessGrantEntry {
  readonly userId: string
  readonly role: WorkspaceGraphRole
  readonly grantedAt: string
  readonly grantedBy: string
  readonly email?: string
  readonly displayName?: string
}

export interface PutAccessGrantRequest {
  readonly role: Exclude<WorkspaceGraphRole, 'owner'>
  readonly email?: string
  readonly displayName?: string
}

export interface AccessGrantService {
  list(graphId: string): Promise<readonly AccessGrantEntry[]>
  put(graphId: string, userId: string, request: PutAccessGrantRequest): Promise<void>
  remove(graphId: string, userId: string): Promise<void>
}

export class WorkspaceGatewayHttpError extends Error {
  constructor(
    readonly method: string,
    readonly url: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`Workspace gateway ${method} ${url} failed with HTTP ${status}: ${responseBody.slice(0, 500)}`)
    this.name = 'WorkspaceGatewayHttpError'
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function catalogEntry(value: unknown, index: number): WorkspaceCatalogEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Gateway GET /graphs row ${index} is not an object`)
  }
  const row = value as Record<string, unknown>
  if (
    typeof row.graphId !== 'string' || !row.graphId
    || typeof row.title !== 'string'
    || (row.cellState !== 'running' && row.cellState !== 'stopped')
    || (row.role !== 'viewer' && row.role !== 'editor' && row.role !== 'owner')
  ) {
    throw new Error(`Gateway GET /graphs row ${index} has an invalid graphId/title/cellState/role shape`)
  }
  return row as unknown as WorkspaceCatalogEntry
}

// Byte-for-byte the same envelope tolerance as `gateway-transport.ts`'s own
// `createdGraph` — accepts a bare row OR a `{data: row}` envelope, and either
// `graphId` or `graph_id`.
function createdGraph(value: unknown): WorkspaceCreatedGraph {
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
  if (!graphId.trim()) throw new Error('Gateway POST /graphs returned no graph id')
  return { graphId, title }
}

function catalogList(value: unknown): readonly WorkspaceCatalogEntry[] {
  // Current platform-next returns a bare array. Accept `{items}` as a rolling-
  // deploy compatibility envelope, mirroring `gateway-transport.ts`'s own
  // `graphList` — same real-world tolerance, not a speculative addition.
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : null
  if (!rows) throw new Error('Gateway GET /graphs returned neither an array nor an { items } envelope')
  return rows.map(catalogEntry)
}

function accessGrantEntry(value: unknown, index: number): AccessGrantEntry {
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
  return row as unknown as AccessGrantEntry
}

function accessGrantList(value: unknown): readonly AccessGrantEntry[] {
  if (!Array.isArray(value)) throw new Error('Gateway GET /graphs/{id}/access returned a non-array')
  return value.map(accessGrantEntry)
}

async function requestJson(
  transport: WorkspaceGatewayTransport,
  fetchImpl: typeof fetch,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json', ...transport.headers() }
  let encodedBody: string | undefined
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    encodedBody = JSON.stringify(body)
  }
  const response = await fetchImpl(url, { method, headers, body: encodedBody, cache: 'no-store' })
  const responseBody = await response.text()
  if (!response.ok) throw new WorkspaceGatewayHttpError(method, url, response.status, responseBody)
  if (!responseBody) return null
  try {
    return JSON.parse(responseBody) as unknown
  } catch (error) {
    throw new Error(
      `Workspace gateway ${method} ${url} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Build the real `workspace.picker` `WorkspaceCatalogService` over `transport` — a real `GET /graphs`, no caching. */
export function createWorkspaceCatalogService(
  transport: WorkspaceGatewayTransport,
  fetchImpl: typeof fetch = fetch,
): WorkspaceCatalogService {
  return {
    async list() {
      const base = trimTrailingSlash(transport.resolveGatewayBaseUrl())
      return catalogList(await requestJson(transport, fetchImpl, 'GET', `${base}/graphs`))
    },
    async create(request = {}) {
      const base = trimTrailingSlash(transport.resolveGatewayBaseUrl())
      const title = request.title?.trim()
      return createdGraph(await requestJson(transport, fetchImpl, 'POST', `${base}/graphs`, {
        ...(title ? { title } : {}),
      }))
    },
    async remove(graphId) {
      const id = graphId.trim()
      if (!id) throw new Error('WorkspaceCatalogService.remove: graphId must not be empty')
      const base = trimTrailingSlash(transport.resolveGatewayBaseUrl())
      await requestJson(transport, fetchImpl, 'DELETE', `${base}/graphs/${encodeURIComponent(id)}`)
    },
  }
}

/** Build the real `access.manager` `AccessGrantService` over `transport` — real `GET`/`PUT`/`DELETE /graphs/{id}/access`, no caching. */
export function createAccessGrantService(
  transport: WorkspaceGatewayTransport,
  fetchImpl: typeof fetch = fetch,
): AccessGrantService {
  function accessUrl(graphId: string, userId?: string): string {
    const base = trimTrailingSlash(transport.resolveGatewayBaseUrl())
    const id = graphId.trim()
    if (!id) throw new Error('AccessGrantService: graphId must not be empty')
    const suffix = userId ? `/${encodeURIComponent(userId.trim())}` : ''
    return `${base}/graphs/${encodeURIComponent(id)}/access${suffix}`
  }
  return {
    async list(graphId) {
      return accessGrantList(await requestJson(transport, fetchImpl, 'GET', accessUrl(graphId)))
    },
    async put(graphId, userId, request) {
      const user = userId.trim()
      if (!user) throw new Error('AccessGrantService: userId must not be empty')
      if (request.role !== 'viewer' && request.role !== 'editor') {
        throw new Error('AccessGrantService: role must be viewer or editor')
      }
      const email = request.email?.trim()
      const displayName = request.displayName?.trim()
      await requestJson(transport, fetchImpl, 'PUT', accessUrl(graphId, user), {
        role: request.role,
        ...(email ? { email } : {}),
        ...(displayName ? { displayName } : {}),
      })
    },
    async remove(graphId, userId) {
      const user = userId.trim()
      if (!user) throw new Error('AccessGrantService: userId must not be empty')
      await requestJson(transport, fetchImpl, 'DELETE', accessUrl(graphId, user))
    },
  }
}
