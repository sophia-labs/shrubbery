/** Real hosted-access composition; independently synthetic producer is in the loopback runner. */
import '@shrubbery/tokens/tokens.css'
import '@shrubbery/components'
import { GARDEN_DEFAULT, type AuthProvider } from '@shrubbery/nucleus'
import { renderWorkspace, type RenderWorkspaceOptions } from '@shrubbery/runtime'
import { GardenUiServices } from '../cell/gardend-contract.js'
import { GatewayTransport, type GatewayGraphInfo } from '../cell/gateway-transport.js'
import { createOrganismShellFeatureHost } from '../cell/shell-features.js'
import { createShellContext } from '../cell/shell-context.js'
import appShellHtml from '../../index.html?raw'

const root = document.querySelector<HTMLElement>('#access-harness-root')!
const failure = document.querySelector<HTMLElement>('#access-harness-failure')!
const framing = new URLSearchParams(window.location.search).get('framing') === 'app' ? 'app' : 'bare'
const renderer = new URLSearchParams(window.location.search).get('renderer') === 'surface' ? 'surface' : 'legacy'
if (framing === 'app') {
  // Use the actual app-owned styles and shell scaffold, without running its
  // main.ts or any cloud/bootstrap work. Bare mode is retained as the control.
  const source = new DOMParser().parseFromString(appShellHtml, 'text/html')
  const shell = source.querySelector<HTMLElement>('.shell-pane')
  const host = shell?.querySelector<HTMLElement>('#host')
  const styles = source.querySelectorAll('head style')
  if (!shell || !host || styles.length === 0) throw new Error('AppFramingSourceMissing')
  for (const style of styles) document.head.append(document.importNode(style, true))
  root.id = 'host'
  host.replaceWith(root)
  document.body.prepend(document.adoptNode(shell))
  document.documentElement.dataset.theme = source.documentElement.dataset.theme ?? 'light'
}
let ready = false
let error: string | null = null
let graphId = 'graph-a'
let directory: readonly GatewayGraphInfo[] = []
declare global {
  interface Window {
    readonly __accessHarness?: { readonly state: { readonly ready: boolean; readonly error: string | null; readonly graphId: string; readonly framing: string; readonly renderer: string } }
  }
}
const bridge = {}
Object.defineProperty(bridge, 'state', { enumerable: true, get: () => Object.freeze({ ready, error, graphId, framing, renderer }) })
Object.freeze(bridge)
Object.defineProperty(window, '__accessHarness', { value: bridge })

class HarnessAuth implements AuthProvider {
  // Fake test literal, not a deployed credential or personal session.
  token(): string { return 'synthetic-access-owner-id-token' }
  userId(): string { return 'owner-a' }
  isAuthenticated(): boolean { return true }
  whenReady(): Promise<void> { return Promise.resolve() }
  onChange(): () => void { return () => undefined }
}
const gateway = new GatewayTransport({ gatewayBaseUrl: `${window.location.origin}/access-harness/gateway`, auth: new HarnessAuth() })
const contract = { auth: new HarnessAuth(), gateway, ui: new GardenUiServices() }
const features = createOrganismShellFeatureHost<typeof contract>()
function renderApp(): void {
  const context = createShellContext({
    host: root, graphId, documentId: null, app: 'garden' as const, source: 'CELL_LIVE' as const,
    deploymentMode: 'hosted' as const, contract, location: window.location, rerender: renderApp,
  })
  const base: RenderWorkspaceOptions = { app: 'garden', chrome: {
    activeApp: 'garden', workspaces: directory, workspaceStatus: 'ready', activeWorkspaceId: graphId,
  } }
  const snapshot = features.workspaceSnapshot(context, base)
  renderWorkspace(GARDEN_DEFAULT, { container: root, ...snapshot, surface: renderer === 'surface' })
  features.afterWorkspaceRender(context, snapshot)
}
try {
  // Real directory parsing binds slug -> typed owner. No caller-as-owner fallback.
  directory = await gateway.graphs()
  // Visible fixture control supplies host navigation while a real modal is pending.
  // It does not call component/controller internals.
  const controls = document.createElement('label')
  controls.textContent = 'Fixture workspace '
  controls.style.cssText = 'position:fixed;bottom:6px;left:6px;z-index:2147483647;padding:6px;background:white;color:black;border:1px solid #777;font:12px system-ui'
  const selector = document.createElement('select')
  selector.setAttribute('aria-label', 'Fixture workspace')
  for (const graph of directory) {
    const option = document.createElement('option')
    option.value = graph.graphId
    option.textContent = graph.title
    selector.append(option)
  }
  selector.value = graphId
  selector.addEventListener('change', () => { graphId = selector.value; renderApp() })
  controls.append(selector)
  document.body.append(controls)
  renderApp()
  ready = true
} catch (cause) {
  error = cause instanceof Error ? cause.stack ?? cause.message : String(cause)
  failure.hidden = false
  failure.textContent = error
}
