/**
 * Gateway services for the reusable workspace picker and access-manager face.
 * Catalog operations retain the gateway /graphs REST surface. Member grants
 * use the shared canonical POST /control/mcp manage_access decoder, with exact
 * owner discovery and fresh authentication supplied by the host. The owner is
 * graph identity, not a synthetic ACL row; email invitations are not provided.
 */

import { accessOwnerFromDirectory, createControlAccessClient } from '@shrubbery/source/access-control'

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

/** UI projection of a canonical control-MCP grant; compatibility metadata may be displayed, not written. */
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
  /** Canonical owner is graph identity, never a fabricated member-grant row. */
  owner?(graphId: string): Promise<string>
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

/** Canonical control-MCP grants; resolve exact owner from the directory, with fresh request headers. */
export function createAccessGrantService(
  transport: WorkspaceGatewayTransport,
  fetchImpl: typeof fetch = fetch,
): AccessGrantService {
  return createControlAccessClient({
    resolveOwner: async graphId => accessOwnerFromDirectory(await requestJson(
      transport, fetchImpl, 'GET', `${trimTrailingSlash(transport.resolveGatewayBaseUrl())}/graphs`,
    ), graphId),
    request: body => requestJson(
      transport, fetchImpl, 'POST', `${trimTrailingSlash(transport.resolveGatewayBaseUrl())}/control/mcp`, body,
    ),
  })
}
