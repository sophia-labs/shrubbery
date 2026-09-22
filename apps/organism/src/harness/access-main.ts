import '@shrubbery/tokens/tokens.css'
import '@shrubbery/components'

import { GARDEN_DEFAULT, type AuthProvider } from '@shrubbery/nucleus'
import { renderWorkspace, type RenderWorkspaceOptions } from '@shrubbery/runtime'
import { GardenUiServices } from '../cell/gardend-contract.js'
import { GatewayTransport, type GatewayAccessGrant } from '../cell/gateway-transport.js'
import { createOrganismShellFeatureHost } from '../cell/shell-features.js'
import { createShellContext } from '../cell/shell-context.js'

const GRAPH_ID = 'graph-a'
const root = document.querySelector<HTMLElement>('#access-harness-root')!
const failure = document.querySelector<HTMLElement>('#access-harness-failure')!

let ready = false
let error: string | null = null
let authenticatedRequests = 0
const requestedRoutes: string[] = []
const grants = new Map<string, GatewayAccessGrant>([
  ['owner-1', {
    userId: 'owner-1',
    role: 'owner',
    grantedAt: '2026-07-10T12:00:00Z',
    grantedBy: 'owner-1',
    email: 'owner@example.test',
    displayName: 'Vera Owner',
  }],
  ['editor-2', {
    userId: 'editor-2',
    role: 'editor',
    grantedAt: '2026-07-10T12:01:00Z',
    grantedBy: 'owner-1',
    email: 'editor@example.test',
    displayName: 'Eddie Editor',
  }],
])

interface AccessHarnessState {
  readonly ready: boolean
  readonly error: string | null
  readonly authenticatedRequests: number
  readonly requestedRoutes: readonly string[]
  readonly grants: readonly GatewayAccessGrant[]
}

declare global {
  interface Window {
    readonly __accessHarness?: { readonly state: AccessHarnessState }
  }
}

function state(): AccessHarnessState {
  return Object.freeze({
    ready,
    error,
    authenticatedRequests,
    requestedRoutes: Object.freeze([...requestedRoutes]),
    grants: Object.freeze([...grants.values()].map(grant => Object.freeze({ ...grant }))),
  })
}

const bridge = {} as { readonly state: AccessHarnessState }
Object.defineProperty(bridge, 'state', { enumerable: true, get: state })
Object.freeze(bridge)
Object.defineProperty(window, '__accessHarness', { value: bridge })

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const backendFetch: typeof fetch = async (input, init = {}) => {
  const url = new URL(String(input), window.location.href)
  const method = init.method ?? 'GET'
  const authorization = new Headers(init.headers).get('authorization')
  if (authorization !== 'Bearer hosted-access-browser-token') {
    return json({ error: 'Hosted access harness requires bearer authentication' }, 401)
  }
  authenticatedRequests += 1
  requestedRoutes.push(`${method} ${url.pathname}`)
  const match = url.pathname.match(/^\/access-harness\/gateway\/graphs\/graph-a\/access(?:\/([^/]+))?$/u)
  if (!match) return json({ error: `Unhandled access harness route: ${url.pathname}` }, 404)
  const userId = match[1] ? decodeURIComponent(match[1]) : null
  if (method === 'GET' && !userId) return json([...grants.values()])
  if (method === 'PUT' && userId) {
    if (userId === 'denied-user') return json({ error: 'only the graph owner may manage access' }, 403)
    const body = JSON.parse(String(init.body ?? '{}')) as {
      role?: unknown
      email?: unknown
      displayName?: unknown
    }
    if (body.role !== 'viewer' && body.role !== 'editor') return json({ error: 'invalid role' }, 400)
    grants.set(userId, {
      userId,
      role: body.role,
      grantedAt: '2026-07-10T13:00:00Z',
      grantedBy: 'owner-1',
      ...(typeof body.email === 'string' ? { email: body.email } : {}),
      ...(typeof body.displayName === 'string' ? { displayName: body.displayName } : {}),
    })
    return json({ graphId: GRAPH_ID, userId, role: body.role })
  }
  if (method === 'DELETE' && userId) {
    grants.delete(userId)
    return new Response(null, { status: 204 })
  }
  return json({ error: 'method not allowed' }, 405)
}

class HarnessAuth implements AuthProvider {
  token(): string { return 'hosted-access-browser-token' }
  userId(): string { return 'owner-1' }
  isAuthenticated(): boolean { return true }
  whenReady(): Promise<void> { return Promise.resolve() }
  onChange(): () => void { return () => undefined }
}

const gateway = new GatewayTransport({
  gatewayBaseUrl: `${window.location.origin}/access-harness/gateway`,
  auth: new HarnessAuth(),
  fetch: backendFetch,
})
const contract = {
  auth: new HarnessAuth(),
  gateway,
  ui: new GardenUiServices(),
}
const features = createOrganismShellFeatureHost<typeof contract>()

function shellContext() {
  return createShellContext({
    host: root,
    graphId: GRAPH_ID,
    documentId: null,
    app: 'garden' as const,
    source: 'CELL_LIVE' as const,
    deploymentMode: 'hosted' as const,
    contract,
    location: window.location,
    rerender: renderApp,
  })
}

function renderApp(): void {
  const context = shellContext()
  const base: RenderWorkspaceOptions = {
    app: 'garden',
    chrome: {
      activeApp: 'garden',
      workspaces: [{
        graphId: GRAPH_ID,
        title: 'Research Garden',
        role: 'owner',
        cellState: 'running',
      }],
      workspaceStatus: 'ready',
      activeWorkspaceId: GRAPH_ID,
    },
  }
  const snapshot = features.workspaceSnapshot(context, base)
  renderWorkspace(GARDEN_DEFAULT, { container: root, ...snapshot })
  features.afterWorkspaceRender(context, snapshot)
}

try {
  renderApp()
  ready = true
} catch (cause) {
  error = cause instanceof Error ? cause.stack ?? cause.message : String(cause)
  failure.hidden = false
  failure.textContent = error
}
