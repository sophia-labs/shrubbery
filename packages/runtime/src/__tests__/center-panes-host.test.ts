import { afterEach, describe, expect, it } from 'vitest'
import type { ProviderHandle } from '@shrubbery/nucleus'
import type { ShEditorHost } from '../editor-host.js'
import {
  CENTER_PANE_CLOSE_EVENT,
  CENTER_PANE_FOCUS_EVENT,
  CENTER_PANE_NAVIGATE_EVENT,
  CENTER_PANE_OPEN_EVENT,
  CENTER_PANE_RESIZE_EVENT,
  type CenterPaneDocumentLocation,
} from '../center-panes-contract.js'
import { CenterPanesController } from '../center-panes-controller.js'
import {
  navigateCenterPane,
  openCenterPane,
  resizeCenterPanes,
  setCenterPanesPosture,
} from '../center-panes-model.js'
import '../center-panes-host.js'
import type { ShCenterPanes } from '../center-panes-host.js'
import { InProcessCrdtBackend } from '../harness/in-process-crdt-backend.js'

const documentLocation = (documentId: string): CenterPaneDocumentLocation => ({
  kind: 'document',
  graphId: 'garden',
  documentId,
  title: `Document ${documentId}`,
})

const readyState = (location: CenterPaneDocumentLocation, provider: ProviderHandle) => ({
  centerMode: 'document' as const,
  graphId: location.graphId,
  documentId: location.documentId,
  status: 'ready' as const,
  error: null,
  provider,
})

async function settle(element: ShCenterPanes): Promise<ShEditorHost[]> {
  await element.updateComplete
  const hosts = Array.from(element.shadowRoot!.querySelectorAll('sh-editor-host')) as ShEditorHost[]
  for (const host of hosts) {
    await host.updateComplete
    await Promise.resolve()
    await Promise.resolve()
    await host.updateComplete
  }
  return hosts
}

function mount(controller: CenterPanesController): ShCenterPanes {
  const element = document.createElement('sh-center-panes') as ShCenterPanes
  element.projection = controller.projection
  element.editorHosts = new Map(
    Array.from(controller.bindings, ([paneId, binding]) => [paneId, { binding }]),
  )
  element.style.cssText = 'display:block;width:1200px;height:700px'
  document.body.append(element)
  return element
}

const backends: InProcessCrdtBackend[] = []

afterEach(() => {
  for (const backend of backends) backend.destroyAll()
  backends.length = 0
})

describe('sh-center-panes controlled component', () => {
  it('renders controlled state and emits explicit open/focus/close/navigate/resize intents', async () => {
    const controller = new CenterPanesController({
      primaryLocation: documentLocation('alpha'),
      secondaryLocation: documentLocation('beta'),
      activePaneId: 'center-primary',
    })
    const element = mount(controller)
    await element.updateComplete

    const seen: Array<{ name: string; detail: unknown }> = []
    for (const name of [
      CENTER_PANE_OPEN_EVENT,
      CENTER_PANE_FOCUS_EVENT,
      CENTER_PANE_CLOSE_EVENT,
      CENTER_PANE_NAVIGATE_EVENT,
      CENTER_PANE_RESIZE_EVENT,
    ]) {
      element.addEventListener(name, (event) => {
        seen.push({ name, detail: (event as CustomEvent).detail })
      })
    }

    const root = element.shadowRoot!
    ;(root.querySelector('[data-pane-open="center-primary"]') as HTMLButtonElement).click()
    ;(root.querySelector('[data-pane-id="center-secondary"]') as HTMLElement)
      .dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }))
    ;(root.querySelector('[data-pane-close="center-secondary"]') as HTMLButtonElement).click()

    const divider = root.querySelector('[data-center-divider]') as HTMLElement
    divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))

    expect(seen).toContainEqual({
      name: CENTER_PANE_OPEN_EVENT,
      detail: {
        paneId: 'center-primary',
        placement: 'active',
        reason: 'choose-document',
        activate: true,
      },
    })
    expect(seen).toContainEqual({
      name: CENTER_PANE_FOCUS_EVENT,
      detail: { paneId: 'center-secondary', reason: 'focus' },
    })
    expect(seen).toContainEqual({
      name: CENTER_PANE_CLOSE_EVENT,
      detail: { paneId: 'center-secondary', reason: 'pane-command' },
    })
    expect(seen).toContainEqual({
      name: CENTER_PANE_RESIZE_EVENT,
      detail: { dividerPercent: 51, source: 'keyboard' },
    })
    expect(element.projection.dividerPercent).toBe(50)

    let navigationDetail: unknown = null
    element.addEventListener(CENTER_PANE_NAVIGATE_EVENT, (event) => {
      navigationDetail = (event as CustomEvent).detail
    })
    element.projection = {
      ...element.projection,
      panes: element.projection.panes.map((pane) => pane.position === 'primary'
        ? { ...pane, canGoBack: true }
        : pane),
    }
    await element.updateComplete
    ;(root.querySelector('[data-pane-back="center-primary"]') as HTMLButtonElement).click()
    expect(navigationDetail).toEqual({ paneId: 'center-primary', direction: 'back' })
  })

  it('mounts two independent real editors and preserves Class-B pane hosts', async () => {
    const backend = new InProcessCrdtBackend()
    backends.push(backend)
    const alpha = documentLocation('alpha')
    const beta = documentLocation('beta')
    const gamma = documentLocation('gamma')
    const providers = new Map([
      ['alpha', backend.open({ kind: 'doc', graphId: 'garden', docId: 'alpha' })],
      ['beta', backend.open({ kind: 'doc', graphId: 'garden', docId: 'beta' })],
      ['gamma', backend.open({ kind: 'doc', graphId: 'garden', docId: 'gamma' })],
    ])
    const controller = new CenterPanesController({
      primaryLocation: alpha,
      secondaryLocation: beta,
    })
    controller.setEditorState(controller.state.primary.id, readyState(alpha, providers.get('alpha')!))
    controller.setEditorState(controller.state.secondary!.id, readyState(beta, providers.get('beta')!))

    const element = mount(controller)
    let hosts = await settle(element)
    expect(hosts).toHaveLength(2)
    const primaryHost = hosts.find((host) => host.getAttribute('data-center-pane-host') === 'center-primary')!
    const secondaryHost = hosts.find((host) => host.getAttribute('data-center-pane-host') === 'center-secondary')!
    expect(primaryHost.liveEditor).not.toBeNull()
    expect(secondaryHost.liveEditor).not.toBeNull()
    expect(primaryHost.liveEditor).not.toBe(secondaryHost.liveEditor)

    const primaryRaw = primaryHost as unknown as {
      _editor: { commands: { insertContent(value: string): boolean } }
    }
    const secondaryRaw = secondaryHost as unknown as {
      _editor: { commands: { insertContent(value: string): boolean } }
    }
    primaryRaw._editor.commands.insertContent('Alpha is independent')
    secondaryRaw._editor.commands.insertContent('Beta is independent')
    expect(primaryHost.liveEditor!.getText()).toContain('Alpha is independent')
    expect(primaryHost.liveEditor!.getText()).not.toContain('Beta is independent')
    expect(secondaryHost.liveEditor!.getText()).toContain('Beta is independent')
    expect(secondaryHost.liveEditor!.getText()).not.toContain('Alpha is independent')

    const primaryEditor = primaryHost.liveEditor
    const secondaryEditor = secondaryHost.liveEditor
    const primaryRoot = primaryHost.shadowRoot!.querySelector('.ProseMirror')
    const secondaryRoot = secondaryHost.shadowRoot!.querySelector('.ProseMirror')

    controller.replaceState(resizeCenterPanes(controller.state, 63))
    controller.replaceState(setCenterPanesPosture(controller.state, 'left-collapsed'))
    element.projection = controller.projection
    hosts = await settle(element)
    expect(hosts[0]).toBe(primaryHost)
    expect(hosts[1]).toBe(secondaryHost)
    expect(primaryHost.liveEditor).toBe(primaryEditor)
    expect(secondaryHost.liveEditor).toBe(secondaryEditor)
    expect(primaryHost.shadowRoot!.querySelector('.ProseMirror')).toBe(primaryRoot)
    expect(secondaryHost.shadowRoot!.querySelector('.ProseMirror')).toBe(secondaryRoot)

    controller.replaceState(openCenterPane(controller.state, {
      paneId: controller.state.primary.id,
      placement: 'active',
      location: gamma,
    }))
    controller.setEditorState(controller.state.primary.id, readyState(gamma, providers.get('gamma')!))
    element.projection = controller.projection
    hosts = await settle(element)
    expect(hosts[0]).toBe(primaryHost)
    expect(hosts[1]).toBe(secondaryHost)
    expect(primaryHost.liveEditor).not.toBe(primaryEditor)
    expect(secondaryHost.liveEditor).toBe(secondaryEditor)

    controller.replaceState(navigateCenterPane(controller.state, controller.state.primary.id, 'back'))
    controller.setEditorState(controller.state.primary.id, readyState(alpha, providers.get('alpha')!))
    element.projection = controller.projection
    hosts = await settle(element)
    expect(hosts[0]).toBe(primaryHost)
    expect(hosts[1]).toBe(secondaryHost)
    expect(primaryHost.liveEditor!.getText()).toContain('Alpha is independent')
    expect(secondaryHost.liveEditor).toBe(secondaryEditor)
    expect(secondaryHost.shadowRoot!.querySelector('.ProseMirror')).toBe(secondaryRoot)
  })

  it('shows a per-pane mini table-of-contents once that pane\'s document has headings, jumps on click, and closes on outside pointerdown', async () => {
    const backend = new InProcessCrdtBackend()
    backends.push(backend)
    const alpha = documentLocation('alpha')
    const beta = documentLocation('beta')
    const providers = new Map([
      ['alpha', backend.open({ kind: 'doc', graphId: 'garden', docId: 'alpha' })],
      ['beta', backend.open({ kind: 'doc', graphId: 'garden', docId: 'beta' })],
    ])
    const controller = new CenterPanesController({ primaryLocation: alpha, secondaryLocation: beta })
    controller.setEditorState(controller.state.primary.id, readyState(alpha, providers.get('alpha')!))
    controller.setEditorState(controller.state.secondary!.id, readyState(beta, providers.get('beta')!))

    const element = mount(controller)
    const hosts = await settle(element)
    const primaryHost = hosts.find((host) => host.getAttribute('data-center-pane-host') === 'center-primary')!
    const secondaryHost = hosts.find((host) => host.getAttribute('data-center-pane-host') === 'center-secondary')!
    const root = element.shadowRoot!

    expect(root.querySelectorAll('.toc-wrap')).toHaveLength(0)
    expect(secondaryHost.liveEditor!.getHeadings()).toEqual([])

    const primaryRaw = primaryHost as unknown as {
      _editor: { commands: { setContent(html: string): boolean } }
    }
    primaryRaw._editor.commands.setContent(
      '<h1 data-block-id="block-h1">Intro</h1>'
      + '<p data-block-id="block-p1">body text</p>'
      + '<h2 data-block-id="block-h2">Details</h2>',
    )
    await element.updateComplete

    // Only the primary pane (the one with headings) shows a trigger.
    expect(root.querySelectorAll('.toc-wrap')).toHaveLength(1)
    const primaryPane = root.querySelector('[data-position="primary"]') as HTMLElement
    const secondaryPane = root.querySelector('[data-position="secondary"]') as HTMLElement
    const tocBtn = primaryPane.querySelector('.toc-btn') as HTMLButtonElement
    expect(secondaryPane.querySelector('.toc-btn')).toBeNull()
    expect(tocBtn.textContent).toContain('Intro')
    expect(root.querySelector('.toc-dropdown')).toBeNull()

    tocBtn.click()
    await element.updateComplete
    const items = Array.from(primaryPane.querySelectorAll('.toc-item')) as HTMLButtonElement[]
    expect(items.map((item) => item.textContent)).toEqual(['Intro', 'Details'])

    // Clicking a dropdown entry jumps the real selection and closes the popup.
    items[1].click()
    await element.updateComplete
    expect(primaryHost.liveEditor!.getActiveBlockId()).toBe('block-h2')
    expect(root.querySelector('.toc-dropdown')).toBeNull()

    // Reopen, then confirm an outside click (not inside the trigger/dropdown) closes it.
    tocBtn.click()
    await element.updateComplete
    expect(root.querySelector('.toc-dropdown')).not.toBeNull()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    await element.updateComplete
    expect(root.querySelector('.toc-dropdown')).toBeNull()
  })

  // diff-review r2 WRONG "render organism center via the layout vehicle" /
  // "flat-grid-remains": once a real container measurement lands, geometry
  // MUST come from the shared Phase-1 `solveLayout`
  // (`split-tree-renderer.ts`'s `solveCenterPaneSplit`), not the `calc()`
  // fallback CSS. happy-dom never reports a real `getBoundingClientRect`, so
  // this test drives the same private measurement path production's
  // `ResizeObserver` callback drives, with a stubbed non-zero rect standing
  // in for a real browser's real box.
  it('applies REAL solver-computed pixel geometry once the container is measured (not the calc() fallback)', async () => {
    const backend = new InProcessCrdtBackend()
    backends.push(backend)
    const alpha = documentLocation('alpha')
    const beta = documentLocation('beta')
    const providers = new Map([
      ['alpha', backend.open({ kind: 'doc', graphId: 'garden', docId: 'alpha' })],
      ['beta', backend.open({ kind: 'doc', graphId: 'garden', docId: 'beta' })],
    ])
    const controller = new CenterPanesController({ primaryLocation: alpha, secondaryLocation: beta })
    controller.setEditorState(controller.state.primary.id, readyState(alpha, providers.get('alpha')!))
    controller.setEditorState(controller.state.secondary!.id, readyState(beta, providers.get('beta')!))
    controller.replaceState(resizeCenterPanes(controller.state, 30, 1, 99))

    const element = mount(controller)
    element.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, width: 1012, height: 600, right: 1012, bottom: 600,
      toJSON: () => ({}),
    }) as DOMRect
    // Same private path production's ResizeObserver callback invokes.
    ;(element as unknown as { _scheduleMeasure(): void })._scheduleMeasure()
    await settle(element)

    const primaryPane = element.shadowRoot!.querySelector('[data-position="primary"]') as HTMLElement
    const secondaryPane = element.shadowRoot!.querySelector('[data-position="secondary"]') as HTMLElement
    const divider = element.shadowRoot!.querySelector('[data-center-divider]') as HTMLElement

    // available = 1012 - 12 = 1000; 30% -> 300 / 700 (matches split-tree-
    // renderer.test.ts's own direct solveLayout cross-check for this input).
    expect(primaryPane.style.position).toBe('absolute')
    expect(primaryPane.style.left).toBe('0px')
    expect(primaryPane.style.width).toBe('300px')
    expect(primaryPane.style.height).toBe('600px')
    expect(secondaryPane.style.left).toBe('312px')
    expect(secondaryPane.style.width).toBe('700px')
    expect(divider.style.left).toBe('300px')
    expect(divider.style.width).toBe('12px')
    expect(divider.style.height).toBe('600px')
  })
})
