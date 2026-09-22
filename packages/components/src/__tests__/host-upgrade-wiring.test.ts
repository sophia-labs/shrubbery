/**
 * WIRING test — the render host upgrades backend-free components where
 * config.renderedByComponent names them; un-lifted panels stay inert.
 *
 * This is the integration the organism relies on, exercised headlessly with the
 * REAL pieces:
 *   - the REAL committed seed .nt (nucleus) → parseNT → parseTriplesToConfig
 *   - the REAL render host (@shrubbery/runtime) renderWorkspace → DOM
 *   - the REAL backend-free components (this package), imported for their side
 *     effect of registering the lifted mn-* chrome/panel tags.
 *
 * It asserts the seam from BOTH sides:
 *   1. The seed config NAMES mn-top-bar / mn-bottom-bar via renderedByComponent,
 *      so the host stamps those tags into the chrome <header>/<footer>.
 *   2. Because this package registered those tags, the stamped elements UPGRADE
 *      into real MnTopBar / MnBottomBar with shadow roots.
 *   3. A panel the config names but this package does NOT define (e.g.
 *      mn-document-editor) stays an inert, un-upgraded placeholder — never faked.
 *
 * NO MOCKS.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { parseNT, parseTriplesToConfig, type WorkspaceConfig } from '@shrubbery/nucleus'
import { renderWorkspace } from '@shrubbery/runtime'
// Side-effect: register mn-top-bar / mn-bottom-bar (the upgrade seam).
import '../index.js'
import { MnTopBar } from '../mn-top-bar.js'
import { MnBottomBar } from '../mn-bottom-bar.js'
import { MnSidebarPanel } from '../mn-sidebar-panel.js'
import { MnGraphPanel } from '../mn-graph-panel.js'
import { MnArtifactView } from '../mn-artifact-view.js'
import { MnDocHistoryPanel } from '../mn-doc-history-panel.js'
import { MnCommentsPanel } from '../mn-comments-panel.js'
import { MnInspector } from '../mn-inspector.js'
import { MnContextMenu } from '../mn-context-menu.js'
import { MnInputDialog } from '../mn-input-dialog.js'
import { MnConfirmationDialog } from '../mn-confirmation-dialog.js'
import { MnDialog } from '../mn-dialog.js'

// Resolve the REAL committed seed alongside the linked nucleus package.
const require_ = createRequire(import.meta.url)
const nucleusEntry = require_.resolve('@shrubbery/nucleus')
const SEED_NT_PATH = resolve(dirname(nucleusEntry), 'workspace/__generated__/garden-default.ux.nt')

function loadSeedConfig(): WorkspaceConfig {
  return parseTriplesToConfig(parseNT(readFileSync(SEED_NT_PATH, 'utf8')))
}

/**
 * Render the seed into a container CONNECTED to the document. Custom elements
 * only upgrade + run connectedCallback (→ first render → shadowRoot) when they
 * are in the document tree — exactly as in the organism, where the host renders
 * into a mounted #host element. (A detached container constructs but never
 * connects them.)
 */
function renderSeedConnected(config: WorkspaceConfig): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  renderWorkspace(config, { container })
  return container
}

describe('WIRING — host upgrades chrome where config names it; panels stay inert', () => {
  beforeAll(() => {
    expect(customElements.get('mn-top-bar')).toBe(MnTopBar)
    expect(customElements.get('mn-bottom-bar')).toBe(MnBottomBar)
    expect(customElements.get('mn-sidebar-panel')).toBe(MnSidebarPanel)
    expect(customElements.get('mn-graph-panel')).toBe(MnGraphPanel)
    expect(customElements.get('mn-artifact-view')).toBe(MnArtifactView)
    expect(customElements.get('mn-doc-history-panel')).toBe(MnDocHistoryPanel)
    expect(customElements.get('mn-comments-panel')).toBe(MnCommentsPanel)
    expect(customElements.get('mn-inspector')).toBe(MnInspector)
    expect(customElements.get('mn-context-menu')).toBe(MnContextMenu)
    expect(customElements.get('mn-input-dialog')).toBe(MnInputDialog)
    expect(customElements.get('mn-confirmation-dialog')).toBe(MnConfirmationDialog)
    expect(customElements.get('mn-dialog')).toBe(MnDialog)
  })

  it('the seed config names mn-top-bar / mn-bottom-bar (the chrome tags)', () => {
    const config = loadSeedConfig()
    expect(config.regions['region-top-bar'].renderedByComponent).toBe('mn-top-bar')
    expect(config.regions['region-bottom-bar'].renderedByComponent).toBe('mn-bottom-bar')
  })

  it('the host stamps the chrome tags and they UPGRADE to real elements', () => {
    const config = loadSeedConfig()
    const container = renderSeedConnected(config)
    const top = container.querySelector('mn-top-bar')
    const bottom = container.querySelector('mn-bottom-bar')
    expect(top).not.toBeNull()
    expect(bottom).not.toBeNull()
    // Upgraded: real instances with shadow roots (not bare unknown elements).
    expect(top).toBeInstanceOf(MnTopBar)
    expect(bottom).toBeInstanceOf(MnBottomBar)
    expect(top!.shadowRoot).not.toBeNull()
    expect(bottom!.shadowRoot).not.toBeNull()
  })

  it('the upgraded top bar renders its real chrome shell (masthead + app switcher)', async () => {
    const config = loadSeedConfig()
    const container = renderSeedConnected(config)
    const top = container.querySelector('mn-top-bar') as MnTopBar
    await top.updateComplete
    expect(top.shadowRoot!.querySelector('.masthead-name')).not.toBeNull()
    expect(top.shadowRoot!.querySelectorAll('.app-switcher-btn').length).toBe(2)
  })

  it('the upgraded bottom bar renders its real 3-section grid', async () => {
    const config = loadSeedConfig()
    const container = renderSeedConnected(config)
    const bottom = container.querySelector('mn-bottom-bar') as MnBottomBar
    await bottom.updateComplete
    expect(bottom.shadowRoot!.querySelector('.left-section')).not.toBeNull()
    expect(bottom.shadowRoot!.querySelector('.center-section')).not.toBeNull()
    expect(bottom.shadowRoot!.querySelector('.right-section')).not.toBeNull()
  })

  it('the Garden sidebar panel upgrades to the real controlled shell', async () => {
    const config = loadSeedConfig()
    // The config names mn-sidebar-panel for the left rail; this package now
    // defines the backend-free controlled shell, so the stamped tag upgrades.
    expect(config.panels['panel-sidebar']?.renderedByComponent ?? config.regions['region-left-rail']).toBeTruthy()
    const container = renderSeedConnected(config)
    const sidebar = container.querySelector('mn-sidebar-panel') as MnSidebarPanel | null
    expect(sidebar).not.toBeNull()
    expect(sidebar).toBeInstanceOf(MnSidebarPanel)
    await sidebar!.updateComplete
    expect(sidebar!.shadowRoot!.querySelector('.sidebar-header')).not.toBeNull()
    expect(sidebar!.shadowRoot!.querySelector('.section[data-section-id="documents"]')).not.toBeNull()
  })

  it('the Garden comments panel upgrades when the right rail selects panel-comments', async () => {
    const config = loadSeedConfig()
    expect(config.panels['panel-comments'].renderedByComponent).toBe('mn-comments-panel')
    const container = document.createElement('div')
    document.body.appendChild(container)
    renderWorkspace(config, { container, chrome: { rightPanel: 'comments' } })
    const comments = container.querySelector('mn-comments-panel') as MnCommentsPanel | null
    expect(comments).not.toBeNull()
    expect(comments).toBeInstanceOf(MnCommentsPanel)
    await comments!.updateComplete
    expect(comments!.shadowRoot!.querySelector('.header-title')?.textContent).toBe('Comments')
    expect(comments!.shadowRoot!.querySelector('.empty-state-title')?.textContent).toBe('No comments yet')
  })

  it('the Garden inspector panel upgrades when the right rail selects panel-inspector', async () => {
    const config = loadSeedConfig()
    expect(config.panels['panel-inspector'].renderedByComponent).toBe('mn-inspector')
    const container = document.createElement('div')
    document.body.appendChild(container)
    renderWorkspace(config, { container, chrome: { rightPanel: 'inspector' } })
    const inspector = container.querySelector('mn-inspector') as MnInspector | null
    expect(inspector).not.toBeNull()
    expect(inspector).toBeInstanceOf(MnInspector)
    await inspector!.updateComplete
    expect(inspector!.shadowRoot!.querySelector('.header-title')?.textContent).toBe('Inspector')
    expect(inspector!.shadowRoot!.querySelector('[data-empty-state="nothing-selected"]')).not.toBeNull()
  })

  it('the registered chrome/sidebar regions upgrade; unlifted content panels do not', () => {
    const config = loadSeedConfig()
    const container = renderSeedConnected(config)
    const upgraded = Array.from(container.querySelectorAll('*'))
      .filter(el => el.tagName.includes('-') && customElements.get(el.tagName.toLowerCase()))
      .map(el => el.tagName.toLowerCase())
      .sort()
    expect(upgraded).toEqual(['mn-bottom-bar', 'mn-sidebar-panel', 'mn-top-bar', 'sh-graph-host'])
    const editor = container.querySelector('mn-document-editor')
    expect(editor).not.toBeNull()
    expect(customElements.get('mn-document-editor')).toBeUndefined()
    expect(editor!.shadowRoot).toBeNull()
  })
})
