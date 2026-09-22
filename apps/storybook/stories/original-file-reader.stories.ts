/** Real-Chromium acceptance for the authenticated original-file/e-reader flow. */

import type { Meta, StoryObj } from '@storybook/web-components'
import '@shrubbery/components'
import {
  GARDEN_DEFAULT,
  type ProviderHandle,
} from '@shrubbery/nucleus'
import {
  renderWorkspace,
  type EditorHostBinding,
  type EditorHostState,
  type RenderWorkspaceOptions,
  type ShEditorHost,
  type SidebarSection,
} from '@shrubbery/runtime'
import { createOrganismShellFeatureHost } from '../../organism/src/cell/shell-features.js'
import { createShellContext } from '../../organism/src/cell/shell-context.js'
import { loadSidebarSections } from '../../organism/src/cell/sidebar-documents.js'
import { BROWSER_HARNESS_SEED } from '../../organism/src/harness/fixture.js'
import { InMemoryCellContract } from '../../organism/src/harness/in-memory-cell-contract.js'

const meta: Meta = {
  title: 'Editor/OriginalFileReader',
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj

interface SettableBinding extends EditorHostBinding {
  set(next: EditorHostState): void
}

interface ReaderHarness extends HTMLElement {
  __reader?: {
    readonly contract: InMemoryCellContract
    readonly downloads: string[]
    switchDocument(documentId: string): Promise<void>
  }
}

function binding(initial: EditorHostState): SettableBinding {
  let value = initial
  const subscribers = new Set<(state: EditorHostState) => void>()
  return {
    get: () => value,
    subscribe(callback) {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    set(next) {
      value = next
      for (const callback of subscribers) callback(next)
    },
  }
}

async function settle(host: ShEditorHost): Promise<void> {
  await host.updateComplete
  await Promise.resolve()
  await Promise.resolve()
  await host.updateComplete
}

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  for (let frame = 0; frame < 180; frame += 1) {
    if (predicate()) return
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
  throw new Error(`OriginalFileReader: timed out waiting for ${label}`)
}

async function toolbarShadow(host: ShEditorHost): Promise<ShadowRoot> {
  const toolbar = host.shadowRoot?.querySelector('mn-editor-toolbar') as
    | (HTMLElement & { updateComplete?: Promise<unknown>; shadowRoot: ShadowRoot })
    | null
  if (!toolbar) throw new Error('OriginalFileReader: editor toolbar is unavailable')
  await toolbar.updateComplete
  return toolbar.shadowRoot
}

async function toolbarButton(host: ShEditorHost, selector: string): Promise<HTMLButtonElement> {
  const root = await toolbarShadow(host)
  const control = root.querySelector(selector) as
    | (HTMLElement & { updateComplete?: Promise<unknown>; shadowRoot: ShadowRoot })
    | null
  if (!control) throw new Error(`OriginalFileReader: missing toolbar control ${selector}`)
  await control.updateComplete
  const button = control.shadowRoot.querySelector('button')
  if (!button) throw new Error(`OriginalFileReader: ${selector} has no native button`)
  return button
}

function mountReaderHarness(): ReaderHarness {
  const wrapper = document.createElement('section') as ReaderHarness
  wrapper.style.cssText = 'position:relative;width:100%;height:100vh;overflow:hidden;'
  const workspace = document.createElement('main')
  workspace.dataset.readerWorkspace = ''
  workspace.style.cssText = 'width:100%;height:100%;'
  const switcher = document.createElement('button')
  switcher.type = 'button'
  switcher.dataset.readerSwitchDocument = ''
  switcher.textContent = 'Switch to document without an original'
  switcher.style.cssText = 'position:fixed;right:12px;bottom:38px;z-index:10000;padding:8px;'
  wrapper.append(workspace, switcher)

  const contract = new InMemoryCellContract(BROWSER_HARNESS_SEED)
  const graphId = BROWSER_HARNESS_SEED.graphId
  let activeDocumentId = 'architecture'
  let sidebarSections: SidebarSection[] = []
  let provider: ProviderHandle = contract.crdt.open({ kind: 'doc', graphId, docId: activeDocumentId }, undefined)
  const editorBinding = binding({
    centerMode: 'document', graphId, documentId: activeDocumentId,
    status: 'ready', error: null, provider,
  })
  const featureHost = createOrganismShellFeatureHost<InMemoryCellContract>()
  let unbind: () => void = () => undefined

  const context = () => createShellContext({
    host: workspace,
    graphId,
    documentId: activeDocumentId,
    app: 'garden' as const,
    source: 'CELL_LIVE' as const,
    deploymentMode: 'playground' as const,
    contract,
    location: window.location,
    rerender: renderApp,
  })
  function renderApp(): void {
    const shellContext = context()
    const base: RenderWorkspaceOptions = {
      app: 'garden',
      editorHost: editorBinding,
      rightCollapsed: true,
      chrome: { activeApp: 'garden', rightPanel: 'none' },
      sidebar: { sections: sidebarSections },
    }
    const options = featureHost.workspaceSnapshot(shellContext, base)
    renderWorkspace(GARDEN_DEFAULT, { container: workspace, ...options })
    featureHost.afterWorkspaceRender(shellContext, options)
  }
  async function switchDocument(documentId: string): Promise<void> {
    const previous = provider
    const previousEditor = workspace.querySelector<ShEditorHost>('#mn-editor-host')?.liveEditor ?? null
    unbind()
    activeDocumentId = documentId
    provider = contract.crdt.open({ kind: 'doc', graphId, docId: documentId }, undefined)
    editorBinding.set({
      centerMode: 'document', graphId, documentId,
      status: 'ready', error: null, provider,
    })
    unbind = featureHost.bindProvider(provider, context())
    sidebarSections = await loadSidebarSections(contract.rest, graphId, activeDocumentId)
    renderApp()
    const switchedHost = workspace.querySelector<ShEditorHost>('#mn-editor-host')
    if (switchedHost) await settle(switchedHost)
    await waitUntil(
      () => {
        const nextEditor = workspace.querySelector<ShEditorHost>('#mn-editor-host')?.liveEditor ?? null
        return nextEditor !== null && nextEditor !== previousEditor
      },
      `editor ${documentId}`,
    )
    previous.destroy()
  }

  unbind = featureHost.bindProvider(provider, context())
  renderApp()
  void loadSidebarSections(contract.rest, graphId, activeDocumentId).then((sections) => {
    sidebarSections = sections
    renderApp()
  })
  switcher.addEventListener('click', () => { void switchDocument('research-notes') })
  const downloads: string[] = []
  wrapper.ownerDocument.addEventListener('click', event => {
    const anchor = event.target as HTMLAnchorElement | null
    if (anchor?.matches('a[download][href^="blob:"]')) downloads.push(anchor.download)
  }, { capture: true })
  wrapper.__reader = { contract, downloads, switchDocument }
  return wrapper
}

export const AuthenticatedTextOriginal: Story = {
  render: () => mountReaderHarness(),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const wrapper = canvasElement.querySelector<ReaderHarness>('section')
    const workspace = wrapper?.querySelector<HTMLElement>('[data-reader-workspace]')
    const harness = wrapper?.__reader
    if (!wrapper || !workspace || !harness) throw new Error('OriginalFileReader: harness did not mount')
    const host = workspace.querySelector<ShEditorHost>('#mn-editor-host')
    if (!host) throw new Error('OriginalFileReader: live editor host did not mount')
    await settle(host)
    await waitUntil(() => host.liveEditor != null, 'live CRDT editor')
    await waitUntil(() => host.originalFileView?.available === true, 'original-file availability')
    await settle(host)

    const editorHandle = host.liveEditor
    const editorMount = host.shadowRoot?.querySelector('.editor-mount')
    const proseMirror = host.shadowRoot?.querySelector('.ProseMirror')
    const hostNode = host
    if (!editorHandle || !editorMount || !proseMirror) throw new Error('OriginalFileReader: live editor body is incomplete')

    ;(await toolbarButton(host, '[data-original-view-toggle]')).click()
    await waitUntil(() => host.originalFileView?.status === 'ready', 'authenticated original bytes')
    await settle(host)
    const viewer = host.shadowRoot?.querySelector('mn-original-viewer') as
      | (HTMLElement & { updateComplete?: Promise<unknown>; shadowRoot: ShadowRoot })
      | null
    if (!viewer) throw new Error('OriginalFileReader: controlled viewer did not mount')
    await viewer.updateComplete
    const originalText = viewer.shadowRoot.querySelector('.source-pre')?.textContent ?? ''
    if (!originalText.includes('authenticated original-file fixture')) {
      throw new Error(`OriginalFileReader: wrong original text: ${originalText}`)
    }
    if (!host.shadowRoot?.querySelector('.editor-mount[hidden][inert]')) {
      throw new Error('OriginalFileReader: editor was not inert while original view was active')
    }
    if (!(await toolbarShadow(host)).querySelector('[data-original-annotation-unavailable]')) {
      throw new Error('OriginalFileReader: annotation limitation was not surfaced')
    }
    const download = viewer.shadowRoot.querySelector<HTMLButtonElement>('[aria-label="Download original file"]')
    if (!download || download.disabled) throw new Error('OriginalFileReader: download is unavailable')
    download.click()
    await waitUntil(() => harness.downloads.includes('architecture-source.md'), 'Blob download intent')

    ;(await toolbarButton(host, '[data-original-view-toggle]')).click()
    await waitUntil(() => host.originalFileView?.active === false, 'Document View')
    await settle(host)
    if (workspace.querySelector('#mn-editor-host') !== hostNode
      || host.liveEditor !== editorHandle
      || host.shadowRoot?.querySelector('.editor-mount') !== editorMount
      || host.shadowRoot?.querySelector('.ProseMirror') !== proseMirror) {
      throw new Error('OriginalFileReader: original toggle remounted the keyed CRDT editor')
    }

    ;(await toolbarButton(host, '[data-original-view-toggle]')).click()
    await waitUntil(() => host.originalFileView?.status === 'ready', 'second original load')
    // Await the real switch operation rather than racing its intentionally
    // fire-and-forget demo button handler; the contract under test is provider
    // cleanup and keyed-host survival, not the decorative trigger itself.
    await harness.switchDocument('research-notes')
    await waitUntil(
      () => {
        const nextHost = workspace.querySelector<ShEditorHost>('#mn-editor-host')
        return nextHost === hostNode
          && nextHost.liveEditor !== null
          && nextHost.liveEditor !== editorHandle
          && nextHost.originalFileView?.active !== true
      },
      'document/provider swap cleanup',
    )
    const swappedHost = workspace.querySelector<ShEditorHost>('#mn-editor-host')!
    if (swappedHost !== hostNode || swappedHost.originalFileView?.active) {
      throw new Error('OriginalFileReader: document swap lost the host or retained the old viewer')
    }
    await settle(swappedHost)
    if ((await toolbarShadow(swappedHost)).querySelector('[data-original-view-toggle]')) {
      throw new Error('OriginalFileReader: ordinary document advertised an unavailable original-file action')
    }
    if (swappedHost.originalFileView?.available) {
      throw new Error('OriginalFileReader: ordinary document retained source-file availability')
    }
    if (harness.contract.snapshot().authenticatedOriginalFetchCount !== 2) {
      throw new Error('OriginalFileReader: original requests did not all use fixture authentication')
    }
  },
}
