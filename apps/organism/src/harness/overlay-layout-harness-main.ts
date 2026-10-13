/**
 * Exact app frame + real Share/surface/resize consumers. Directory and grants
 * come only from the runner's loopback fixture. No main.ts, room or live auth.
 */
import '@shrubbery/tokens/tokens.css'
import '@shrubbery/components'
import { GARDEN_DEFAULT, type AuthProvider } from '@shrubbery/nucleus'
import { renderWorkspace, workspaceSurfaceReady, type RenderWorkspaceOptions, type WorkspacePanelRepositionDetail } from '@shrubbery/runtime'
import { GardenUiServices } from '../cell/gardend-contract.js'
import { GatewayTransport, type GatewayGraphInfo } from '../cell/gateway-transport.js'
import { createOrganismShellFeatureHost } from '../cell/shell-features.js'
import { createShellContext } from '../cell/shell-context.js'
import appShellHtml from '../../index.html?raw'

const root = document.querySelector<HTMLElement>('#overlay-layout-root')!
const failure = document.querySelector<HTMLElement>('#overlay-layout-error')!
const source = new DOMParser().parseFromString(appShellHtml, 'text/html')
const shell = source.querySelector<HTMLElement>('.shell-pane')
const host = shell?.querySelector<HTMLElement>('#host')
const styles = source.querySelectorAll('head style')
if (!shell || !host || styles.length === 0) throw new Error('ExactAppFrameMissing')
for (const style of styles) document.head.append(document.importNode(style, true))
root.id = 'host'
host.replaceWith(root)
document.body.prepend(document.adoptNode(shell))
document.documentElement.dataset.theme = source.documentElement.dataset.theme ?? 'light'

let ready = false, error: string | null = null
let leftWidth = 280, rightWidth = 420
const resizeEvents: WorkspacePanelRepositionDetail[] = []
declare global {
  interface Window {
    readonly __overlayLayout: { readonly state: {
      readonly ready: boolean; readonly error: string | null;
      readonly leftWidth: number; readonly rightWidth: number;
      readonly resizeEvents: readonly WorkspacePanelRepositionDetail[];
    } }
  }
}
const bridge = {}
Object.defineProperty(bridge, 'state', { enumerable: true, get: () => Object.freeze({ ready, error, leftWidth, rightWidth, resizeEvents: [...resizeEvents] }) })
Object.defineProperty(window, '__overlayLayout', { value: Object.freeze(bridge) })

class FixtureAuth implements AuthProvider {
  token(): string { return 'synthetic-access-owner-id-token' }
  userId(): string { return 'owner-a' }
  isAuthenticated(): boolean { return true }
  whenReady(): Promise<void> { return Promise.resolve() }
  onChange(): () => void { return () => undefined }
}
const auth = new FixtureAuth()
const gateway = new GatewayTransport({ gatewayBaseUrl: `${window.location.origin}/access-harness/gateway`, auth })
const contract = { auth, gateway, ui: new GardenUiServices() }
const features = createOrganismShellFeatureHost<typeof contract>()
let directory: readonly GatewayGraphInfo[] = []
function renderApp(): void {
  const context = createShellContext({
    host: root, graphId: 'graph-a', documentId: null, app: 'garden' as const, source: 'CELL_LIVE' as const,
    deploymentMode: 'hosted' as const, contract, location: window.location, rerender: renderApp,
  })
  const base: RenderWorkspaceOptions = {
    app: 'garden', surface: true,
    chrome: { activeApp: 'garden', workspaces: directory, workspaceStatus: 'ready', activeWorkspaceId: 'graph-a', rightPanels: ['chat'] },
    panelLayout: { leftWidth, rightWidth, onReposition(detail) {
      resizeEvents.push(detail)
      if (detail.role === 'left') leftWidth = detail.width
      else rightWidth = detail.width
      renderApp()
    } },
  }
  const snapshot = features.workspaceSnapshot(context, base)
  renderWorkspace(GARDEN_DEFAULT, { container: root, ...snapshot, surface: true })
  features.afterWorkspaceRender(context, snapshot)
}
try {
  directory = await gateway.graphs()
  renderApp()
  await workspaceSurfaceReady(root)
  ready = true
} catch (cause) {
  error = cause instanceof Error ? cause.stack ?? cause.message : String(cause)
  failure.hidden = false; failure.textContent = error
}
