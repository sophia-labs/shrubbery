import type { TripleSource } from '@shrubbery/nucleus'
import {
  GatewayTransport,
  McpClient,
  createCognitoAuthSession,
  createGardendLocalSource,
  createHostedGatewaySource,
  type CognitoAuthSession,
  type GatewayAccessGrant,
  type GatewayGraphInfo,
  type GatewayGraphRole,
} from '@shrubbery/source'
import { normalizeActorId, normalizeDisplayName, type KochActor } from './actor.js'
import type { KochMutationClient } from './progress.js'

export type KochBackendMode = 'local' | 'hosted'

export type KochRoomRole = GatewayGraphRole

export interface KochRoom {
  readonly graphId: string
  readonly title: string
  readonly role: KochRoomRole
  readonly cellState: 'running' | 'stopped'
}

export type KochRoomAccessGrant = GatewayAccessGrant

export interface KochRoomAccessService {
  readonly list: () => Promise<readonly KochRoomAccessGrant[]>
  readonly put: (
    userId: string,
    request: { readonly role: 'viewer' | 'editor'; readonly email?: string; readonly displayName?: string },
  ) => Promise<void>
  readonly remove: (userId: string) => Promise<void>
}

export interface KochBackend {
  readonly mode: KochBackendMode
  readonly source: TripleSource
  readonly writer: KochMutationClient
  readonly auth: CognitoAuthSession | null
  readonly listRooms: () => Promise<readonly KochRoom[]>
  readonly createRoom: (title: string) => Promise<KochRoom>
  /** Local profiles have no remote membership plane; hosted graphs use gateway ACLs. */
  readonly roomAccess: KochRoomAccessService | null
  readonly ready: () => Promise<KochActor>
  readonly close: () => Promise<void>
}

function roomTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, ' ')
  if (!title) throw new Error('Give the graph room a title.')
  return title.slice(0, 120)
}

export function graphIdFromRoomTitle(value: string): string {
  const id = roomTitle(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  if (!id) throw new Error('The graph room title needs at least one letter or number.')
  return id
}

function localRoom(value: unknown, index = 0): KochRoom {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Garden graph catalog row ${index} is not an object.`)
  }
  const row = value as Record<string, unknown>
  const graphId = typeof row.graph_id === 'string'
    ? row.graph_id
    : typeof row.graphId === 'string'
      ? row.graphId
      : ''
  if (!graphId || typeof row.title !== 'string') {
    throw new Error(`Garden graph catalog row ${index} has no graph id or title.`)
  }
  const role = row.role === 'viewer' || row.role === 'editor' || row.role === 'owner'
    ? row.role
    : 'owner'
  return { graphId, title: row.title, role, cellState: 'running' }
}

export function localRoomCatalog(value: unknown): readonly KochRoom[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { graphs?: unknown }).graphs)
      ? (value as { graphs: unknown[] }).graphs
      : null
  if (!rows) throw new Error('Garden list_graphs returned neither an array nor a { graphs } catalog.')
  return rows.map(localRoom).sort((left, right) => left.title.localeCompare(right.title))
}

function hostedRoom(graph: GatewayGraphInfo): KochRoom {
  return {
    graphId: graph.graphId,
    title: graph.title,
    role: graph.role,
    cellState: graph.cellState,
  }
}

function browserValue(key: string): string {
  try { return window.localStorage.getItem(key)?.trim() ?? '' } catch { return '' }
}

function queryValue(key: string): string {
  try { return new URL(window.location.href).searchParams.get(key)?.trim() ?? '' } catch { return '' }
}

function localActor(): KochActor {
  const id = normalizeActorId(
    queryValue('actor') || import.meta.env.VITE_KOCH_USER_ID?.trim() || 'local',
  )
  const displayName = normalizeDisplayName(
    queryValue('name')
      || import.meta.env.VITE_KOCH_DISPLAY_NAME?.trim()
      || browserValue(`koch.actor.name.v1:${id}`),
    id,
  )
  return { id, displayName }
}

function requiredHostedSetting(name: string, value: string | undefined): string {
  const normalized = value?.trim() ?? ''
  if (!normalized) throw new Error(`${name} is required for a hosted Koch deployment.`)
  return normalized
}

/**
 * One deployment composition point for Koch. Local development keeps the
 * server-side /cell proxy; hosted deployments use the same Cognito and gateway
 * transports as Garden without allowing Morse domain code to learn either.
 */
export function createKochBackend(graphId: string): KochBackend {
  const gatewayBaseUrl = import.meta.env.VITE_KOCH_GATEWAY_BASE_URL?.trim()
  if (!gatewayBaseUrl) {
    const writer = new McpClient({ mcpUrl: '/cell/mcp' })
    const source = createGardendLocalSource({ mcpUrl: '/cell/mcp', graphId })
    const actor = localActor()
    return {
      mode: 'local',
      source,
      writer,
      auth: null,
      listRooms: async () => localRoomCatalog(await writer.callTool('list_graphs', {})),
      createRoom: async (value) => {
        const title = roomTitle(value)
        return localRoom(await writer.callTool('create_graph', {
          graph_id: graphIdFromRoomTitle(title),
          title,
        }))
      },
      roomAccess: null,
      ready: async () => actor,
      close: () => source.close(),
    }
  }

  const auth = createCognitoAuthSession({
    config: {
      region: requiredHostedSetting('VITE_COGNITO_REGION', import.meta.env.VITE_COGNITO_REGION),
      clientId: requiredHostedSetting('VITE_COGNITO_CLIENT_ID', import.meta.env.VITE_COGNITO_CLIENT_ID),
      ...(import.meta.env.VITE_COGNITO_USER_POOL_ID?.trim()
        ? { userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID.trim() }
        : {}),
    },
    storageKey: 'shrubbery.cognito.tokens.v1',
  })
  const gateway = new GatewayTransport({ gatewayBaseUrl, auth })
  const source = createHostedGatewaySource({
    endpoint: gatewayBaseUrl,
    graph: graphId,
    auth,
    // platform-next intentionally reserves POST /mcp for editors. The hosted
    // SPARQL job route is Viewer-eligible, so spectators can read the graph's
    // curriculum, people, and standings without being granted write access.
    readPath: 'sparql',
  })
  const writer: KochMutationClient = {
    callTool: (name, args) => gateway.toolsCall(graphId, name, args),
  }
  const stopAuthRefresh = auth.startAutoRefresh()

  return {
    mode: 'hosted',
    source,
    writer,
    auth,
    listRooms: async () => (await gateway.graphs()).map(hostedRoom),
    createRoom: async (value) => {
      const created = await gateway.createGraph({ title: roomTitle(value) })
      return { ...created, role: 'owner', cellState: 'running' }
    },
    roomAccess: {
      list: () => gateway.access(graphId),
      put: (userId, request) => gateway.putAccess(graphId, userId, request),
      remove: (userId) => gateway.deleteAccess(graphId, userId),
    },
    ready: async () => {
      await auth.whenReady()
      if (!auth.isAuthenticated() || !auth.userId()) {
        throw new Error('Sign in to Garden before opening this hosted Koch room.')
      }
      const id = normalizeActorId(auth.userId())
      const configuredName = browserValue(`koch.actor.name.v1:${id}`)
      return { id, displayName: normalizeDisplayName(configuredName, id) }
    },
    close: async () => {
      stopAuthRefresh()
      await source.close()
    },
  }
}

export function rememberActorName(actor: KochActor): void {
  try { window.localStorage.setItem(`koch.actor.name.v1:${actor.id}`, actor.displayName) } catch { /* best effort */ }
}
