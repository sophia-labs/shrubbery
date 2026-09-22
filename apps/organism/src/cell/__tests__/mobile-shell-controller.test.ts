import { afterEach, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import type {
  EditorHostState,
  RenderWorkspaceOptions,
  SidebarActionDetail,
  SidebarNodeDetail,
  WorkspaceHomeDocument,
  WorkspaceSummary,
} from '@shrubbery/runtime'
import { createShellContext } from '../shell-context.js'
import {
  OrganismMobileShellController,
  projectMobileContinuity,
  type MobileShellEnvironment,
} from '../mobile-shell-controller.js'

class TestMediaQueryList extends EventTarget {
  readonly media: string
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null = null
  matches: boolean

  constructor(matches: boolean, media = '(max-width: 1024px)') {
    super()
    this.matches = matches
    this.media = media
  }

  setMatches(matches: boolean): void {
    if (matches === this.matches) return
    this.matches = matches
    this.dispatchEvent(new Event('change'))
  }

  addListener(callback: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null): void {
    if (callback) this.addEventListener('change', callback as EventListener)
  }

  removeListener(callback: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null): void {
    if (callback) this.removeEventListener('change', callback as EventListener)
  }

  dispatchEvent(event: Event): boolean {
    return super.dispatchEvent(event)
  }
}

class TestVisualViewport extends EventTarget {
  height = 800
  width = 390
  offsetTop = 0
  offsetLeft = 0

  setRect(
    rect: {
      height?: number
      width?: number
      offsetTop?: number
      offsetLeft?: number
    },
    eventType: 'resize' | 'scroll' = 'resize',
  ): void {
    if (rect.height !== undefined) this.height = rect.height
    if (rect.width !== undefined) this.width = rect.width
    if (rect.offsetTop !== undefined) this.offsetTop = rect.offsetTop
    if (rect.offsetLeft !== undefined) this.offsetLeft = rect.offsetLeft
    this.dispatchEvent(new Event(eventType))
  }
}

function fixtureHost(): HTMLElement {
  const host = document.createElement('main')
  host.innerHTML = `
    <div class="app-container">
      <header></header>
      <div class="main">
        <sl-split-panel>
          <div class="split-pane" data-role="sidebar"></div>
          <div class="split-pane" data-role="center">
            <div id="mn-main-editor"></div>
          </div>
          <div class="split-pane" data-role="right">
            <section class="right-panel" data-panel="chat">
              <sh-chat-host data-identity="chat"></sh-chat-host>
            </section>
          </div>
        </sl-split-panel>
        <sh-editor-host id="mn-editor-host" data-identity="editor"></sh-editor-host>
      </div>
      <footer></footer>
    </div>
  `
  document.body.append(host)
  return host
}

function environment(
  media: TestMediaQueryList,
  viewport: TestVisualViewport,
  compactMedia = media,
): MobileShellEnvironment {
  return {
    matchMedia: query => (
      query.includes('600px') ? compactMedia : media
    ) as unknown as MediaQueryList,
    visualViewport: viewport,
    innerHeight: () => 800,
    innerWidth: () => 390,
    requestAnimationFrame: (callback) => {
      callback(0)
      return 1
    },
    vibrate: () => true,
  }
}

function context(host: HTMLElement, documentId: string | null = 'doc-a') {
  return createShellContext({
    host,
    graphId: 'garden-lab',
    documentId,
    app: 'garden',
    source: 'CELL_LIVE',
    deploymentMode: 'playground',
    contract: null,
    location: new URL('http://localhost/'),
    rerender: () => undefined,
  })
}

function workspace(onNodeOpen?: (detail: SidebarNodeDetail) => void): RenderWorkspaceOptions {
  return {
    chrome: {
      breadcrumbs: [
        { id: 'garden-lab', label: 'Garden Lab', kind: 'graph' },
        { id: 'doc-a', label: 'Architecture', kind: 'document' },
      ],
      syncState: 'connecting',
    },
    sidebar: {
      sections: [{
        id: 'documents',
        label: 'Documents',
        nodes: [
          { id: 'doc-a', label: 'Architecture', kind: 'document' },
          { id: 'doc-b', label: 'Research Notes', kind: 'document' },
        ],
      }],
      activeId: 'doc-a',
      selectedId: 'doc-a',
      onNodeOpen,
    },
    mobileHome: {
      status: 'ready',
      graphId: 'garden-lab',
      graphTitle: 'Garden Lab',
      resume: { graphId: 'garden-lab', documentId: 'doc-a', title: 'Architecture' },
      pinned: [{ graphId: 'garden-lab', documentId: 'doc-b', title: 'Research Notes' }],
      recent: [{
        graphId: 'garden-lab',
        documentId: 'doc-a',
        title: 'Architecture',
        timestamp: Date.now() - 60_000,
      }],
    },
  }
}

function withEditorState(
  snapshot: RenderWorkspaceOptions,
  state: EditorHostState,
): RenderWorkspaceOptions {
  return {
    ...snapshot,
    editorHost: {
      get: () => state,
      subscribe: () => () => undefined,
    },
  }
}

async function settled(controller: OrganismMobileShellController): Promise<void> {
  const portal = document.querySelector('.organism-mobile-shell')!
  const tabs = portal.querySelector('mn-mobile-tabs')!
  const files = portal.querySelector('mn-mobile-file-list')!
  const home = portal.querySelector('mn-home-view')!
  const continuity = portal.querySelector('mn-continuity-status')!
  await Promise.all([
    (tabs as { updateComplete: Promise<unknown> }).updateComplete,
    (files as { updateComplete: Promise<unknown> }).updateComplete,
    (home as { updateComplete: Promise<unknown> }).updateComplete,
    (continuity as { updateComplete: Promise<unknown> }).updateComplete,
  ])
  expect(controller.state.mobile).toBe(true)
}

function touchEvent(type: 'touchstart' | 'touchend', x: number, y: number): TouchEvent {
  const event = new Event(type, { bubbles: true, composed: true }) as TouchEvent
  Object.defineProperty(event, type === 'touchstart' ? 'touches' : 'changedTouches', {
    configurable: true,
    value: [{ clientX: x, clientY: y }],
  })
  Object.defineProperty(event, type === 'touchstart' ? 'changedTouches' : 'touches', {
    configurable: true,
    value: [],
  })
  return event
}

afterEach(() => {
  document.querySelectorAll('.organism-mobile-shell').forEach((node) => node.remove())
  document.querySelectorAll('main').forEach((node) => node.remove())
  document.body.removeAttribute('data-organism-mobile-shell-active')
  document.documentElement.style.removeProperty('--organism-vvh')
  document.documentElement.style.removeProperty('--organism-vvw')
})

describe('OrganismMobileShellController', () => {
  it('restores the same document projection after a transient home context', async () => {
    const media = new TestMediaQueryList(true)
    const viewport = new TestVisualViewport()
    const host = fixtureHost()
    const controller = new OrganismMobileShellController(environment(media, viewport))

    controller.update(context(host, 'doc-a'), workspace())
    await settled(controller)
    expect(controller.state.view).toBe('document')

    // A shell refresh may briefly project Home while preserving the live
    // editor claim, then restore the same document id. `lastDocumentId` alone
    // cannot prove the per-root route still exists after that gap.
    controller.update(context(host, null), workspace())
    expect(controller.state.view).toBe('root')
    controller.update(context(host, 'doc-a'), workspace())
    expect(controller.state.view).toBe('document')
    controller.destroy()
  })

  it('projects responsive files and routes a mobile document click through the existing sidebar intent', async () => {
    const media = new TestMediaQueryList(false)
    const viewport = new TestVisualViewport()
    const host = fixtureHost()
    const opens: SidebarNodeDetail[] = []
    const controller = new OrganismMobileShellController(environment(media, viewport))
    controller.update(context(host), workspace((detail) => opens.push(detail)))

    expect(host.dataset.organismMobileShell).toBe('false')
    media.setMatches(true)
    await settled(controller)

    const portal = document.querySelector('.organism-mobile-shell')!
    expect(portal.getAttribute('data-active')).toBe('true')
    const continuity = portal.querySelector('mn-continuity-status') as HTMLElement & {
      state: string
      label: string
    }
    expect(portal.querySelector('.organism-mobile-continuity')?.getAttribute('data-visible')).toBe('true')
    expect(continuity.state).toBe('loading')
    expect(continuity.label).toBe('Connecting to Garden')
    const mobileCss = document.querySelector<HTMLStyleElement>('#organism-mobile-shell-styles')?.textContent ?? ''
    expect(mobileCss).toContain("sl-split-panel::part(divider)")
    expect(mobileCss).toContain(".main > .collapse-rail")
    expect(mobileCss).toContain(".main .panel-edge-btns")
    expect(mobileCss).toContain('z-index: var(--mn-z-delivery-shell, 700)')

    const tabs = portal.querySelector('mn-mobile-tabs')!
    const destinationButtons = tabs.shadowRoot!.querySelectorAll('button')
    ;(destinationButtons[1] as HTMLButtonElement).click()
    await (tabs as { updateComplete: Promise<unknown> }).updateComplete
    expect((portal.querySelector('.organism-mobile-search') as HTMLButtonElement).hidden).toBe(true)

    const files = portal.querySelector('mn-mobile-file-list')!
    await (files as { updateComplete: Promise<unknown> }).updateComplete
    await Promise.resolve()
    await (files as { updateComplete: Promise<unknown> }).updateComplete
    expect(Array.from(files.shadowRoot!.querySelectorAll('[data-node-id]')).map((node) => node.getAttribute('data-node-id'))).toContain('doc-b')
    ;(files.shadowRoot!.querySelector('[data-node-id="doc-b"]') as HTMLButtonElement).click()

    expect(opens.map((detail) => detail.id)).toEqual(['doc-b'])
    expect(controller.state.activeRoot).toBe('browse')
    expect(controller.state.activeTab).toBe('browse')
    expect(controller.state.view).toBe('document')
    expect(controller.state.centerMode).toBe('document')
    expect((portal.querySelector('.organism-mobile-search') as HTMLButtonElement).hidden).toBe(false)
    controller.destroy()
  })

  it('forwards controlled file-operation feedback and keeps reconciliation distinct from replay', async () => {
    const media = new TestMediaQueryList(true)
    const viewport = new TestVisualViewport()
    const host = fixtureHost()
    const recoveries: Array<{ operationId: string; action: 'retry' | 'reconcile' }> = []
    const base = workspace()
    const controller = new OrganismMobileShellController(environment(media, viewport))
    controller.update(context(host), {
      ...base,
      sidebar: {
        ...base.sidebar,
        operation: {
          id: 'rename-doc-a-1',
          action: 'rename',
          state: 'indeterminate',
          nodeId: 'doc-a',
          graphId: 'garden-lab',
          label: 'Architecture',
          message: 'Garden may still finish this rename.',
          retryable: false,
        },
        onOperationRecovery: detail => recoveries.push(detail),
      },
    })
    await settled(controller)

    const fileList = document.querySelector('mn-mobile-file-list') as HTMLElement & {
      operation: { id: string; state: string } | null
    }
    expect(fileList.operation).toMatchObject({
      id: 'rename-doc-a-1',
      state: 'indeterminate',
    })

    fileList.dispatchEvent(new CustomEvent('mn-mobile-file-retry', {
      bubbles: true,
      composed: true,
      detail: { target: 'reconcile', operationId: 'rename-doc-a-1' },
    }))
    expect(recoveries).toEqual([{ operationId: 'rename-doc-a-1', action: 'reconcile' }])
    controller.destroy()
  })

  it('uses explicit detail Back, makes active-root retaps inert, and preserves editor/chat identity', async () => {
    const media = new TestMediaQueryList(true)
    const viewport = new TestVisualViewport()
    const host = fixtureHost()
    const editor = host.querySelector('#mn-editor-host')
    const chat = host.querySelector('sh-chat-host')
    const controller = new OrganismMobileShellController(environment(media, viewport))
    controller.update(context(host), workspace())
    await settled(controller)

    const portal = document.querySelector('.organism-mobile-shell')!
    const tabs = portal.querySelector('mn-mobile-tabs')!
    const buttons = tabs.shadowRoot!.querySelectorAll('button')
    ;(buttons[0] as HTMLButtonElement).click()
    expect(controller.state.view).toBe('document')

    ;(portal.querySelector('.organism-mobile-back') as HTMLButtonElement).click()
    expect(controller.state.activeRoot).toBe('home')
    expect(controller.state.view).toBe('root')
    expect(controller.state.centerMode).toBe('home')
    expect(portal.querySelector('.organism-mobile-home')?.getAttribute('data-visible')).toBe('true')
    const home = portal.querySelector('mn-home-view')!
    await (home as { updateComplete: Promise<unknown> }).updateComplete
    expect(home.shadowRoot?.querySelector('main')?.getAttribute('aria-label')).toBe('Garden home')
    expect(home.shadowRoot?.textContent).toContain('Research Notes')
    expect(portal.querySelector('.organism-mobile-resume')).toBeNull()

    ;(buttons[0] as HTMLButtonElement).click()
    expect(controller.state.view).toBe('root')
    ;(home.shadowRoot!.querySelector('button.resume') as HTMLButtonElement).click()
    expect(controller.state.activeRoot).toBe('home')
    expect(controller.state.centerMode).toBe('document')
    ;(buttons[2] as HTMLButtonElement).click()
    expect(controller.state.activeRoot).toBe('sophia')
    expect(portal.getAttribute('data-root')).toBe('sophia')
    expect((portal.querySelector('.organism-mobile-search') as HTMLButtonElement).hidden).toBe(true)
    const mobileCss = document.querySelector<HTMLStyleElement>('#organism-mobile-shell-styles')?.textContent ?? ''
    expect(mobileCss).toContain("[data-mobile-root='sophia'] > .app-container")
    expect(mobileCss).toContain("[data-root='sophia'] .organism-mobile-top-bar")
    expect(host.querySelector('sh-chat-host')).toBe(chat)

    media.setMatches(false)
    expect(host.dataset.organismMobileShell).toBe('false')
    expect(document.body.hasAttribute('data-organism-mobile-shell-active')).toBe(false)
    expect(host.querySelector('#mn-editor-host')).toBe(editor)
    expect(host.querySelector('sh-chat-host')).toBe(chat)
    expect(editor?.isConnected).toBe(true)
    expect(chat?.isConnected).toBe(true)
    controller.destroy()
  })

  it('uses the shared controlled home projection and forwards its document, pin, create, and daily-note intents', async () => {
    const media = new TestMediaQueryList(true)
    const viewport = new TestVisualViewport()
    const host = fixtureHost()
    const opened: WorkspaceHomeDocument[] = []
    const pinned: Array<{ readonly id: string; readonly value: boolean }> = []
    const dailyNotes: string[] = []
    let created = 0
    const base = workspace()
    const snapshot: RenderWorkspaceOptions = {
      ...base,
      mobileHome: {
        ...base.mobileHome!,
        onNewDocument: () => { created += 1 },
        onOpenDocument: document => opened.push(document),
        onPinDocument: (document, value) => pinned.push({ id: document.documentId, value }),
      },
      dailyNotes: {
        todayKey: '2026-07-14',
        todayDoc: { id: 'daily-note-2026-07-14' },
        onOpenDate: detail => dailyNotes.push(detail.dateKey),
      },
    }
    const controller = new OrganismMobileShellController(environment(media, viewport))
    controller.update(context(host), snapshot)
    await settled(controller)

    const portal = document.querySelector('.organism-mobile-shell')!
    ;(portal.querySelector('.organism-mobile-back') as HTMLButtonElement).click()
    const home = portal.querySelector('mn-home-view')!
    await (home as { updateComplete: Promise<unknown> }).updateComplete

    ;(home.shadowRoot!.querySelector('.new-document') as HTMLButtonElement).click()
    ;(home.shadowRoot!.querySelector('section[aria-label="Pinned"] .pin') as HTMLButtonElement).click()
    const daily = home.shadowRoot!.querySelector('mn-daily-note-row')!
    await (daily as { updateComplete: Promise<unknown> }).updateComplete
    ;(daily.shadowRoot!.querySelector('.row') as HTMLElement).click()
    ;(home.shadowRoot!.querySelector('section[aria-label="Pinned"] .open') as HTMLButtonElement).click()

    expect(created).toBe(1)
    expect(pinned).toEqual([{ id: 'doc-b', value: false }])
    expect(dailyNotes).toEqual(['2026-07-14'])
    expect(opened.map(document => document.documentId)).toEqual(['doc-b'])
    expect(controller.state.centerMode).toBe('document')
    controller.destroy()
  })

  it('routes mobile file actions and workspace selection through the desktop-controlled shell callbacks', async () => {
    const media = new TestMediaQueryList(true)
    const viewport = new TestVisualViewport()
    const host = fixtureHost()
    const actions: SidebarActionDetail[] = []
    const selected: WorkspaceSummary[] = []
    let refreshes = 0
    let creates = 0
    const base = workspace()
    const snapshot: RenderWorkspaceOptions = {
      ...base,
      chrome: {
        ...base.chrome,
        workspaceStatus: 'ready',
        workspaces: [
          { graphId: 'garden-lab', title: 'Garden Lab', role: 'owner', cellState: 'running' },
          { graphId: 'research', title: 'Research', role: 'editor', cellState: 'stopped' },
          {
            graphId: 'viewer',
            title: 'Viewer',
            role: 'viewer',
            cellState: 'running',
            disabled: true,
            disabledReason: 'Read-only gateway unavailable',
          },
        ],
        onWorkspaceRefresh: () => { refreshes += 1 },
        onWorkspaceSelect: detail => selected.push(detail),
        onWorkspaceCreate: () => { creates += 1 },
      },
      sidebar: { ...base.sidebar, onAction: detail => actions.push(detail) },
    }
    const controller = new OrganismMobileShellController(environment(media, viewport))
    controller.update(context(host), snapshot)
    await settled(controller)

    const portal = document.querySelector('.organism-mobile-shell')!
    const tabs = portal.querySelector('mn-mobile-tabs')!
    ;(tabs.shadowRoot!.querySelectorAll('button')[1] as HTMLButtonElement).click()
    const files = portal.querySelector('mn-mobile-file-list')!
    await (files as { updateComplete: Promise<unknown> }).updateComplete

    let documentRow = files.shadowRoot!.querySelector('[data-node-id="doc-b"]')!
    documentRow.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      composed: true,
      clientX: 20,
      clientY: 20,
    }))
    await (files as { updateComplete: Promise<unknown> }).updateComplete
    ;(files.shadowRoot!.querySelector('.ctx-item') as HTMLButtonElement).click()
    await (files as { updateComplete: Promise<unknown> }).updateComplete
    const renameInput = files.shadowRoot!.querySelector<HTMLInputElement>('.rename-input')!
    renameInput.value = '  Field notes revised  '
    renameInput.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }))
    ;(files.shadowRoot!.querySelector('.rename-save') as HTMLButtonElement).click()
    await (files as { updateComplete: Promise<unknown> }).updateComplete
    documentRow = files.shadowRoot!.querySelector('[data-node-id="doc-b"]')!
    documentRow.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      composed: true,
      clientX: 20,
      clientY: 20,
    }))
    await (files as { updateComplete: Promise<unknown> }).updateComplete
    ;(files.shadowRoot!.querySelectorAll('.ctx-item')[1] as HTMLButtonElement).click()
    await (files as { updateComplete: Promise<unknown> }).updateComplete
    expect(actions.map(action => `${action.action}:${action.nodeId}`)).toEqual([
      'rename:doc-b',
      'move:doc-b',
    ])
    expect(actions[0]?.proposedLabel).toBe('Field notes revised')

    ;(files.shadowRoot!.querySelector('.workspace-btn') as HTMLButtonElement).click()
    await (files as { updateComplete: Promise<unknown> }).updateComplete
    expect(refreshes).toBe(1)
    const disabled = files.shadowRoot!.querySelector('[data-graph-id="viewer"]') as HTMLButtonElement
    expect(disabled.disabled).toBe(true)
    ;(files.shadowRoot!.querySelector('[data-graph-id="research"]') as HTMLButtonElement).click()
    expect(selected.map(workspace => workspace.graphId)).toEqual(['research'])

    ;(files.shadowRoot!.querySelector('.workspace-btn') as HTMLButtonElement).click()
    await (files as { updateComplete: Promise<unknown> }).updateComplete
    ;(files.shadowRoot!.querySelector('.ws-new') as HTMLButtonElement).click()
    expect(creates).toBe(1)
    await (files as { updateComplete: Promise<unknown> }).updateComplete
    expect(files.shadowRoot!.querySelector('.ws-sheet')).toBeNull()
    controller.destroy()
  })

  it('preserves a detail path per root and never claims system-edge swipe gestures', async () => {
    const media = new TestMediaQueryList(true)
    const viewport = new TestVisualViewport()
    const host = fixtureHost()
    const controller = new OrganismMobileShellController(environment(media, viewport))
    controller.update(context(host), workspace())
    await settled(controller)
    const portal = document.querySelector('.organism-mobile-shell')!
    const tabs = portal.querySelector('mn-mobile-tabs')!
    const buttons = tabs.shadowRoot!.querySelectorAll('button')

    expect(controller.state.activeRoot).toBe('home')
    expect(controller.state.view).toBe('document')

    ;(buttons[1] as HTMLButtonElement).click()
    expect(controller.state.activeRoot).toBe('browse')
    expect(controller.state.view).toBe('root')

    const files = portal.querySelector('mn-mobile-file-list')!
    await (files as { updateComplete: Promise<unknown> }).updateComplete
    ;(files.shadowRoot!.querySelector('[data-node-id="doc-b"]') as HTMLButtonElement).click()
    expect(controller.state.view).toBe('document')

    ;(buttons[0] as HTMLButtonElement).click()
    expect(controller.state.activeRoot).toBe('home')
    expect(controller.state.view).toBe('document')
    ;(portal.querySelector('.organism-mobile-back') as HTMLButtonElement).click()
    expect(controller.state.view).toBe('root')

    ;(buttons[1] as HTMLButtonElement).click()
    expect(controller.state.activeRoot).toBe('browse')
    expect(controller.state.view).toBe('document')

    // The portal intentionally owns no edge-swipe listener. Platform Back and
    // predictive-Back gestures remain available to the native WebView shell.
    portal.dispatchEvent(touchEvent('touchstart', 388, 100))
    portal.dispatchEvent(touchEvent('touchend', 270, 102))
    expect(controller.state.activeRoot).toBe('browse')
    expect(controller.state.view).toBe('document')
    controller.destroy()
  })

  it('keeps a newly selected root visible across same-document snapshot updates', async () => {
    const media = new TestMediaQueryList(true)
    const viewport = new TestVisualViewport()
    const host = fixtureHost()
    const controller = new OrganismMobileShellController(environment(media, viewport))
    const initial = workspace()
    controller.update(context(host), initial)
    await settled(controller)

    const portal = document.querySelector('.organism-mobile-shell')!
    const tabs = portal.querySelector('mn-mobile-tabs')!
    ;(tabs.shadowRoot!.querySelectorAll('button')[1] as HTMLButtonElement).click()
    expect(controller.state.activeRoot).toBe('browse')
    expect(controller.state.view).toBe('root')

    controller.update(context(host), {
      ...initial,
      sidebar: { ...initial.sidebar, status: 'disconnected' },
    })
    const filesPanel = portal.querySelector('.organism-mobile-files')!
    const files = portal.querySelector('mn-mobile-file-list') as HTMLElement & {
      status: string
      updateComplete: Promise<unknown>
    }
    await files.updateComplete

    expect(controller.state.view).toBe('root')
    expect(filesPanel.getAttribute('data-visible')).toBe('true')
    expect(files.status).toBe('offline')
    controller.destroy()
  })

  it('exposes compact, medium, and expanded postures without replacing resources', async () => {
    const adaptive = new TestMediaQueryList(true, '(max-width: 1024px)')
    const compact = new TestMediaQueryList(false, '(max-width: 600px)')
    const viewport = new TestVisualViewport()
    const host = fixtureHost()
    const editor = host.querySelector('#mn-editor-host')
    const chat = host.querySelector('sh-chat-host')
    const controller = new OrganismMobileShellController(
      environment(adaptive, viewport, compact),
    )
    controller.update(context(host), workspace())
    await settled(controller)

    const portal = document.querySelector('.organism-mobile-shell')!
    expect(controller.state.posture).toBe('medium')
    expect(portal.getAttribute('data-posture')).toBe('medium')
    expect(host.dataset.mobilePosture).toBe('medium')

    compact.setMatches(true)
    expect(controller.state.posture).toBe('compact')
    expect(portal.getAttribute('data-posture')).toBe('compact')

    adaptive.setMatches(false)
    expect(controller.state.posture).toBe('expanded')
    expect(controller.state.mobile).toBe(false)
    expect(host.querySelector('#mn-editor-host')).toBe(editor)
    expect(host.querySelector('sh-chat-host')).toBe(chat)
    controller.destroy()
  })

  it('uses the visual viewport size while the keyboard is open and keeps the layout root stable', async () => {
    const media = new TestMediaQueryList(true)
    const viewport = new TestVisualViewport()
    const host = fixtureHost()
    let editorUpdateCount = 0
    const requestUpdate = (): void => { editorUpdateCount += 1 }
    ;(host.querySelector('#mn-editor-host') as HTMLElement & { requestUpdate?: () => void }).requestUpdate = requestUpdate
    const controller = new OrganismMobileShellController(environment(media, viewport))
    controller.update(context(host), workspace())
    await settled(controller)
    const updatesBeforeKeyboard = editorUpdateCount

    viewport.setRect({
      height: 520,
      width: 388,
      offsetTop: 96,
      offsetLeft: 1,
    })
    const portal = document.querySelector('.organism-mobile-shell')!
    expect(controller.state.keyboardOpen).toBe(true)
    expect(host.dataset.mobileKeyboard).toBe('true')
    expect(portal.getAttribute('data-keyboard')).toBe('true')
    expect(document.documentElement.style.getPropertyValue('--organism-vvh')).toBe('520px')
    expect(document.documentElement.style.getPropertyValue('--organism-vvw')).toBe('388px')
    expect(editorUpdateCount).toBe(updatesBeforeKeyboard + 1)

    viewport.setRect({
      height: 500,
      width: 386,
      offsetTop: 120,
      offsetLeft: 2,
    }, 'scroll')
    expect(document.documentElement.style.getPropertyValue('--organism-vvh')).toBe('500px')
    expect(document.documentElement.style.getPropertyValue('--organism-vvw')).toBe('386px')
    expect(editorUpdateCount).toBe(updatesBeforeKeyboard + 1)

    const mobileCss = document.querySelector<HTMLStyleElement>('#organism-mobile-shell-styles')?.textContent ?? ''
    expect(mobileCss).toContain('--organism-safe-area-top')
    expect(mobileCss).toContain('--organism-mobile-content-bottom')
    expect(mobileCss).toContain('var(--organism-vvh, 100dvh)')
    expect(mobileCss).toMatch(
      /body\[data-organism-mobile-shell-active\]\s*\{[^}]*height: 100% !important;[^}]*overflow: hidden !important;/s,
    )
    expect(mobileCss).not.toMatch(
      /body\[data-organism-mobile-shell-active\]\s*\{[^}]*position: fixed/s,
    )
    expect(mobileCss).not.toMatch(
      /body\[data-organism-mobile-shell-active\]\s*\{[^}]*height: var\(--organism-vvh/s,
    )
    expect(mobileCss).toContain('var(--organism-vvw, 100vw)')
    expect(mobileCss).not.toContain('--organism-vv-top')
    expect(mobileCss).not.toContain('--organism-vv-left')
    expect(mobileCss).toContain('inset: 0 auto auto 0')
    expect(mobileCss).toContain("body[data-organism-mobile-shell-active] > .shell-pane {\n    position: fixed")
    expect(mobileCss).toContain('.organism-mobile-shell {\n    position: fixed')
    expect(mobileCss).toContain("[data-organism-mobile-shell='true'] {\n    position: absolute")

    // Recent iOS versions can retain a small visual-viewport offset after the
    // keyboard closes. Above the keyboard threshold the pixel override is
    // DROPPED entirely: the 100dvh/100vw fallbacks return geometry to the
    // layout viewport and track Safari's toolbar animation natively, instead
    // of freezing a sampled height that drags the bottom chrome on scroll.
    viewport.setRect({
      height: 776,
      width: 386,
      offsetTop: 24,
      offsetLeft: 2,
    }, 'scroll')
    expect(controller.state.keyboardOpen).toBe(false)
    expect(portal.getAttribute('data-keyboard')).toBe('false')
    expect(document.documentElement.style.getPropertyValue('--organism-vvh')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--organism-vvw')).toBe('')
    controller.destroy()
  })

  it('coalesces visual viewport event storms and samples their settled second frame', async () => {
    const media = new TestMediaQueryList(true)
    const viewport = new TestVisualViewport()
    const host = fixtureHost()
    const frames: FrameRequestCallback[] = []
    const controller = new OrganismMobileShellController({
      ...environment(media, viewport),
      requestAnimationFrame: (callback) => {
        frames.push(callback)
        return frames.length
      },
    })
    controller.update(context(host, null), workspace())
    await settled(controller)

    viewport.setRect({ height: 520, width: 388 })
    viewport.dispatchEvent(new Event('scroll'))
    viewport.dispatchEvent(new Event('resize'))

    expect(frames).toHaveLength(1)
    expect(controller.state.keyboardOpen).toBe(false)
    frames.shift()!(0)
    // WebKit may publish its settled keyboard height only after the first frame.
    viewport.height = 500
    viewport.width = 386
    expect(frames).toHaveLength(1)
    expect(controller.state.keyboardOpen).toBe(false)
    frames.shift()!(16)
    expect(controller.state.keyboardOpen).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--organism-vvh')).toBe('500px')
    expect(document.documentElement.style.getPropertyValue('--organism-vvw')).toBe('386px')
    controller.destroy()
  })

  it('lets modal component intents suppress delivery-form navigation until every sheet closes', async () => {
    const media = new TestMediaQueryList(true)
    const viewport = new TestVisualViewport()
    const host = fixtureHost()
    const controller = new OrganismMobileShellController(environment(media, viewport))
    controller.update(context(host), workspace())
    await settled(controller)

    const portal = document.querySelector('.organism-mobile-shell')!
    const editor = host.querySelector('#mn-editor-host')!
    editor.dispatchEvent(new CustomEvent('mn-overlay-state-change', {
      bubbles: true,
      composed: true,
      detail: { id: 'editor-formatting-test', open: true, modality: 'modal' },
    }))
    expect(controller.state.modalOpen).toBe(true)
    expect(portal.getAttribute('data-modal')).toBe('true')

    editor.dispatchEvent(new CustomEvent('mn-overlay-state-change', {
      bubbles: true,
      composed: true,
      detail: { id: 'chat-model-test', open: true, modality: 'modal' },
    }))
    editor.dispatchEvent(new CustomEvent('mn-overlay-state-change', {
      bubbles: true,
      composed: true,
      detail: { id: 'editor-formatting-test', open: false, modality: 'modal' },
    }))
    expect(controller.state.modalOpen).toBe(true)

    editor.dispatchEvent(new CustomEvent('mn-overlay-state-change', {
      bubbles: true,
      composed: true,
      detail: { id: 'chat-model-test', open: false, modality: 'modal' },
    }))
    expect(controller.state.modalOpen).toBe(false)
    expect(portal.getAttribute('data-modal')).toBe('false')
    const mobileCss = document.querySelector<HTMLStyleElement>('#organism-mobile-shell-styles')?.textContent ?? ''
    expect(mobileCss).toContain("[data-modal='true'] > mn-mobile-tabs")
    controller.destroy()
  })

  it('projects honest loading, empty, offline, unsynced, and error states from the controlled snapshot', () => {
    const base = workspace()
    const empty: RenderWorkspaceOptions = {
      ...base,
      chrome: { ...base.chrome, syncState: 'synced' },
      mobileHome: {
        status: 'ready',
        graphId: 'garden-lab',
        graphTitle: 'Garden Lab',
        pinned: [],
        newlyCreated: [],
        recent: [],
      },
    }
    expect(projectMobileContinuity(empty, 'home', 'root', 'Garden Lab')).toMatchObject({
      visible: false,
      state: 'ready',
    })

    const retainedLoading: RenderWorkspaceOptions = {
      ...base,
      mobileHome: { ...base.mobileHome!, status: 'loading' },
    }
    expect(projectMobileContinuity(retainedLoading, 'home', 'root', 'Garden Lab')).toMatchObject({
      visible: true,
      state: 'loading',
      retainHomeContent: true,
      label: 'Refreshing Home',
    })

    const readyEditor: EditorHostState = {
      centerMode: 'document',
      graphId: 'garden-lab',
      documentId: 'doc-a',
      status: 'ready',
      error: null,
      provider: null,
    }
    expect(projectMobileContinuity(
      withEditorState(base, readyEditor),
      'home',
      'document',
      'Architecture',
    )).toMatchObject({ state: 'loading', label: 'Connecting to Garden' })
    expect(projectMobileContinuity(
      withEditorState({ ...base, chrome: { ...base.chrome, syncState: 'reconnecting' } }, readyEditor),
      'home',
      'document',
      'Architecture',
    )).toMatchObject({
      state: 'reconnecting',
      label: 'Reconnecting to Garden',
      detail: 'Your document stays in place while Garden reconnects.',
    })
    expect(projectMobileContinuity(
      withEditorState({ ...base, chrome: { ...base.chrome, syncState: 'disconnected' } }, readyEditor),
      'home',
      'document',
      'Architecture',
    )).toMatchObject({
      state: 'offline',
      label: 'Garden is disconnected',
    })
    expect(projectMobileContinuity(
      withEditorState({ ...base, chrome: { ...base.chrome, syncState: 'error' } }, readyEditor),
      'home',
      'document',
      'Architecture',
    )).toMatchObject({ state: 'error', label: 'Sync unavailable' })

    const binding = withEditorState(base, readyEditor).editorHost!
    const centerPanes = {
      projection: { activePaneId: 'center-primary' },
      editorHosts: new Map([['center-primary', { binding }]]),
    } as unknown as NonNullable<RenderWorkspaceOptions['centerPanes']>
    expect(projectMobileContinuity(
      {
        ...base,
        chrome: { ...base.chrome, syncState: 'error' },
        centerPanes,
      },
      'home',
      'document',
      'Architecture',
    )).toMatchObject({ state: 'error', label: 'Sync unavailable' })

    const loadingEditor: EditorHostState = { ...readyEditor, status: 'loading' }
    expect(projectMobileContinuity(
      withEditorState(base, loadingEditor),
      'home',
      'document',
      'Architecture',
    )).toMatchObject({ state: 'loading', label: 'Opening Architecture' })

    const failedEditor: EditorHostState = {
      ...readyEditor,
      status: 'error',
      error: 'Room unavailable',
    }
    expect(projectMobileContinuity(
      withEditorState(base, failedEditor),
      'home',
      'document',
      'Architecture',
    )).toMatchObject({
      state: 'error',
      detail: 'Room unavailable',
      action: 'back',
    })
  })

  it('keeps retained Home resources interactive through an error and forwards recovery through refresh', async () => {
    const media = new TestMediaQueryList(true)
    const viewport = new TestVisualViewport()
    const host = fixtureHost()
    const editor = host.querySelector('#mn-editor-host')
    const refreshes: SidebarActionDetail[] = []
    const base = workspace()
    const failed: RenderWorkspaceOptions = {
      ...base,
      chrome: { ...base.chrome, syncState: 'synced' },
      sidebar: {
        ...base.sidebar,
        status: 'error',
        error: 'Cell unavailable',
        onAction: detail => refreshes.push(detail),
      },
      mobileHome: {
        ...base.mobileHome!,
        status: 'error',
        error: 'Cell unavailable',
      },
    }
    const controller = new OrganismMobileShellController(environment(media, viewport))
    controller.update(context(host), failed)
    await settled(controller)

    const portal = document.querySelector('.organism-mobile-shell')!
    ;(portal.querySelector('.organism-mobile-back') as HTMLButtonElement).click()
    const home = portal.querySelector('mn-home-view') as HTMLElement & {
      status: string
      updateComplete: Promise<unknown>
    }
    const continuity = portal.querySelector('mn-continuity-status') as HTMLElement & {
      state: string
      updateComplete: Promise<unknown>
      shadowRoot: ShadowRoot
    }
    await Promise.all([home.updateComplete, continuity.updateComplete])

    expect(host.dataset.mobileContinuity).toBe('true')
    expect(portal.getAttribute('data-continuity')).toBe('true')
    expect(continuity.state).toBe('error')
    expect(home.status).toBe('ready')
    expect(home.shadowRoot?.textContent).toContain('Research Notes')
    expect(host.querySelector('#mn-editor-host')).toBe(editor)

    ;(continuity.shadowRoot.querySelector('button') as HTMLButtonElement).click()
    expect(refreshes).toEqual([{ action: 'refresh' }])

    const tabs = portal.querySelector('mn-mobile-tabs')!
    ;(tabs.shadowRoot!.querySelectorAll('button')[1] as HTMLButtonElement).click()
    const files = portal.querySelector('mn-mobile-file-list') as HTMLElement & {
      status: string
      updateComplete: Promise<unknown>
      shadowRoot: ShadowRoot
    }
    await files.updateComplete
    expect(portal.getAttribute('data-continuity')).toBe('false')
    expect(files.status).toBe('error')
    expect(files.shadowRoot.textContent).toContain('Research Notes')
    const fileStatus = files.shadowRoot.querySelector('mn-continuity-status') as HTMLElement & {
      updateComplete: Promise<unknown>
      shadowRoot: ShadowRoot
    }
    await fileStatus.updateComplete
    ;(fileStatus.shadowRoot.querySelector('button') as HTMLButtonElement).click()
    expect(refreshes).toEqual([{ action: 'refresh' }, { action: 'refresh' }])

    controller.update(context(host, ''), {
      ...failed,
      sidebar: { ...failed.sidebar, status: 'disconnected' },
    })
    await files.updateComplete
    expect(files.status).toBe('offline')
    await fileStatus.updateComplete
    ;(fileStatus.shadowRoot.querySelector('button') as HTMLButtonElement).click()
    expect(refreshes).toEqual([
      { action: 'refresh' },
      { action: 'refresh' },
      { action: 'refresh' },
    ])

    controller.update(context(host, ''), {
      ...failed,
      sidebar: { ...failed.sidebar, status: 'ready', error: '' },
      mobileHome: { ...failed.mobileHome!, status: 'ready', error: '' },
    })
    await Promise.all([continuity.updateComplete, files.updateComplete])
    expect(host.dataset.mobileContinuity).toBe('false')
    expect(portal.getAttribute('data-continuity')).toBe('false')
    expect(files.status).toBe('ready')
    expect(host.querySelector('#mn-editor-host')).toBe(editor)
    controller.destroy()
  })
})
