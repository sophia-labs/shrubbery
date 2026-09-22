/**
 * Editor Host (LIVE) — the rung B2 probeable organism.
 *
 * This story mounts the REAL Class-B `<sh-editor-host>` (@shrubbery/runtime)
 * carrying a LIVE collaborative TipTap body over a REAL Y.Doc. It is the live
 * twin of editor-kernel.stories.ts: the kernel story proves the pure standalone
 * editor; THIS proves the HOST element graduating from its honest placeholder to
 * a real collaborative editor when its binding carries an open CRDT room.
 *
 * NO MOCKS (Vera's standing rule):
 *   - the CRDT plane is a REAL `new Y.Doc()` wrapped in a real contract.crdt
 *     ProviderHandle (whenSynced resolved — local authority, the in-process plane
 *     minus the network, which is exactly what "in-process" means);
 *   - the binding is a REAL reactive object (get/subscribe), not a vi.fn;
 *   - the body is the REAL pure kernel roster + REAL @tiptap/extension-collaboration
 *     (history owned EXACTLY once: the kernel drops StarterKit undoRedo, Collaboration
 *     owns it) composed by the host through createLiveCollabEditor;
 *   - play() drives the REAL editor commands to type into the live document and
 *     asserts the live host.liveEditor reflects it. Errors surface verbatim.
 *
 * THE ORGANISM: render() returns the connected `<sh-editor-host>` element with the
 * live editor already mounted; type into it via play(). It is probeable — the live
 * EditorView is reachable as `host.liveEditor`.
 *
 * Browser-only checks live here too: real geometry (`getBoundingClientRect`) and
 * the OS-level Mod-z/Ctrl-z undo keystroke are covered by Storybook's Chromium
 * lane. The content + collab-undo SEMANTICS over a real Y.Doc remain proven at the
 * COMMAND level in packages/runtime's happy-dom tests.
 */
import type { Meta, StoryObj } from '@storybook/web-components'

import * as Y from 'yjs'
import { synchronizedCrdtProviderLifecycle } from '@shrubbery/nucleus'
import {
  ShEditorHost,
  createLiveAwareness,
  mountEditorHost,
  NULL_EDITOR_HOST_STATE,
  type EditorHostState,
  type EditorHostBinding,
  type EditorKernelOptions,
} from '@shrubbery/runtime'
import { render } from 'lit'

const meta: Meta = {
  title: 'Editor/HostLive',
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj

const OUTLINE_SEED =
  '<p data-block-id="block-a">Parent</p>' +
  '<p data-block-id="block-b" data-indent="1">Hidden child</p>' +
  '<p data-block-id="block-c">Leaf</p>'

const INTERACTION_SEED =
  '<p data-block-id="block-a">Parent</p>' +
  '<p data-block-id="block-b" data-indent="1">Child</p>' +
  '<p data-block-id="block-c">Middle</p>' +
  '<p data-block-id="block-d">Leaf</p>'

const DRAG_GEOMETRY_SEED = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { indent: 0, collapsed: false, 'data-block-id': 'block-a' },
      content: [{ type: 'text', text: 'Root A' }],
    },
    {
      type: 'paragraph',
      attrs: { indent: 1, collapsed: false, 'data-block-id': 'block-b' },
      content: [{ type: 'text', text: 'child A1' }],
    },
    {
      type: 'paragraph',
      attrs: { indent: 2, collapsed: false, 'data-block-id': 'block-c' },
      content: [{ type: 'text', text: 'grandchild A1a' }],
    },
    {
      type: 'paragraph',
      attrs: { indent: 1, collapsed: false, 'data-block-id': 'block-d' },
      content: [{ type: 'text', text: 'child A2' }],
    },
    {
      type: 'listItem',
      attrs: { listType: 'bullet', indent: 0, collapsed: false, checked: false, 'data-block-id': 'block-e' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item B' }] }],
    },
    {
      type: 'paragraph',
      attrs: { indent: 1, collapsed: false, 'data-block-id': 'block-f' },
      content: [{ type: 'text', text: 'Item B1' }],
    },
    {
      type: 'paragraph',
      attrs: { indent: 0, collapsed: false, 'data-block-id': 'block-g' },
      content: [{ type: 'text', text: 'Leaf C' }],
    },
  ],
}

/** A REAL reactive binding (get/subscribe) — not a mock. */
function makeBinding(state: EditorHostState): EditorHostBinding {
  const subs = new Set<(v: EditorHostState) => void>()
  return {
    get: () => state,
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
  }
}

/**
 * A REAL contract.crdt ProviderHandle over a REAL local Y.Doc. The doc IS the
 * authority (no network), so whenSynced resolves immediately. This is the genuine
 * CRDT plane minus the websocket — not a stub.
 */
function liveProvider(): NonNullable<EditorHostState['provider']> {
  const doc = new Y.Doc()
  const awareness = createLiveAwareness(doc)
  return {
    doc,
    awareness,
    lifecycle: synchronizedCrdtProviderLifecycle(),
    whenRenderable: Promise.resolve(),
    whenEditable: Promise.resolve(),
    whenSynced: Promise.resolve(),
    renderSource: Promise.resolve('live'),
    destroy: () => { awareness.destroy(); doc.destroy() },
  }
}

/**
 * Mount the REAL `<sh-editor-host>` (via the same keyed mount glue the workspace
 * uses) into an imperative container and return it. The host's binding carries an
 * open provider on a ready document center, so the host graduates from placeholder
 * to a live collaborative editor.
 */
function mountLiveHost(kernelOptions?: EditorKernelOptions): HTMLElement {
  // Touch the class so the side-effect @customElement registration is retained by
  // the bundler (the host registers `sh-editor-host` on import).
  void ShEditorHost

  const container = document.createElement('div')
  container.className = 'main' // the host floats relative to `.main`
  container.style.position = 'relative'
  container.style.height = '100vh'
  container.style.boxSizing = 'border-box'
  container.style.background = 'var(--mn-color-surface-base, #fff)'
  container.style.color = 'var(--mn-color-text-primary, #111)'
  container.style.fontFamily = 'var(--mn-font-chrome, system-ui, sans-serif)'

  const state: EditorHostState = {
    centerMode: 'document',
    graphId: 'g-tlon',
    documentId: 'd-uqbar',
    status: 'ready',
    error: null,
    provider: liveProvider(),
  }
  render(mountEditorHost(makeBinding(state), kernelOptions), container)
  return container
}

/** Resolve the live host element from whatever node Storybook hands play(). */
function hostOf(canvasElement: HTMLElement): ShEditorHost {
  const direct = canvasElement.querySelector<ShEditorHost>('#mn-editor-host')
  if (direct) return direct
  if (canvasElement instanceof ShEditorHost) return canvasElement
  throw new Error('editor-host-live: no <sh-editor-host> found on the canvas')
}

async function settleHost(host: ShEditorHost): Promise<void> {
  await host.updateComplete
  await Promise.resolve()
  await Promise.resolve()
  await host.updateComplete
}

interface RawStoryEditor {
  commands: {
    focus(): boolean
    insertContent(text: string): boolean
    setContent(content: string | Record<string, unknown>): boolean
    setTextSelection(pos: number): boolean
  }
  state: {
    doc: {
      childCount: number
    }
  }
  view: {
    dom: HTMLElement
    focus(): void
    posAtDOM(node: Node, offset: number): number
  }
}

function rawEditor(host: ShEditorHost): RawStoryEditor {
  return (host as unknown as {
    _editor: RawStoryEditor
  })._editor
}

function editorCommands(host: ShEditorHost): RawStoryEditor['commands'] {
  return rawEditor(host).commands
}

function blockById(host: ShEditorHost, blockId: string): HTMLElement {
  const block = host.shadowRoot?.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`)
  if (!block) throw new Error(`editor-host-live: missing block ${blockId}`)
  return block
}

function foldButton(host: ShEditorHost): HTMLButtonElement {
  const button = host.shadowRoot?.querySelector<HTMLButtonElement>('.outliner-fold-button')
  if (!button) throw new Error('editor-host-live: missing outliner fold button')
  return button
}

function assertPositiveRect(name: string, rect: DOMRect): void {
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error(`${name} did not receive a real browser layout rect (${rect.width}x${rect.height})`)
  }
}

function assertEqual<T>(name: string, actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`${name}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function assertClassState(el: HTMLElement, className: string, expected: boolean, label: string): void {
  const actual = el.classList.contains(className)
  if (actual !== expected) {
    throw new Error(`${label}: expected class ${className}=${String(expected)}, got ${String(actual)}`)
  }
}

function dispatchKey(target: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  }))
}

function selectedCount(host: ShEditorHost): number {
  return host.shadowRoot?.querySelectorAll('.ProseMirror .block-selected').length ?? 0
}

function blockTexts(host: ShEditorHost): string[] {
  return Array.from(host.shadowRoot?.querySelectorAll('.ProseMirror > [data-block-id]') ?? [])
    .map((el) => (el as HTMLElement).innerText.trim())
    .filter((text) => text.length > 0)
}

function blockIds(host: ShEditorHost): string[] {
  return Array.from(host.shadowRoot?.querySelectorAll('.ProseMirror > [data-block-id]') ?? [])
    .map((el) => (el as HTMLElement).getAttribute('data-block-id') ?? '')
    .filter((id) => id.length > 0)
}

function setCaretInsideBlock(host: ShEditorHost, blockId: string): void {
  const editor = rawEditor(host)
  const block = blockById(host, blockId)
  const pos = editor.view.posAtDOM(block, 0)
  editor.commands.focus()
  editor.commands.setTextSelection(pos + 1)
  editor.view.focus()
}

function clickDragHandle(host: ShEditorHost, blockId: string, shiftKey = false): void {
  const block = blockById(host, blockId)
  const handle = block.querySelector<HTMLElement>('.block-drag-handle')
  if (!handle) throw new Error(`editor-host-live: missing drag handle for ${blockId}`)
  handle.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    composed: true,
    shiftKey,
  }))
  rawEditor(host).view.focus()
}

type DropMode = 'before' | 'after' | 'child'

function dragBlock(host: ShEditorHost, sourceId: string, targetId: string, mode: DropMode): {
  indicatorMode: string | null
  indicatorCount: number
  indicatorTagName: string | null
} {
  const source = blockById(host, sourceId)
  const target = blockById(host, targetId)
  const handle = source.querySelector<HTMLElement>('.block-drag-handle')
  if (!handle) throw new Error(`editor-host-live: missing drag handle for ${sourceId}`)

  const rect = target.getBoundingClientRect()
  assertPositiveRect(`drop target ${targetId}`, rect)

  let clientX = rect.left + 5
  let clientY = rect.top + rect.height * 0.5
  if (mode === 'before') {
    clientY = rect.top + rect.height * 0.1
  } else if (mode === 'after') {
    clientY = rect.top + rect.height * 0.9
  } else {
    clientX = rect.left + 40
  }

  const dt = new DataTransfer()
  const fire = (type: string, el: Element, x: number, y: number): void => {
    const event = new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
    })
    Object.defineProperty(event, 'dataTransfer', { value: dt, configurable: true })
    el.dispatchEvent(event)
  }

  const handleRect = handle.getBoundingClientRect()
  assertPositiveRect(`drag handle ${sourceId}`, handleRect)
  fire('dragstart', handle, handleRect.left + 2, handleRect.top + 2)
  fire('dragover', target, clientX, clientY)

  const indicator = host.shadowRoot?.querySelector('.ProseMirror .block-drop-indicator')
  const indicatorMode = indicator?.getAttribute('data-mode') ?? null
  const indicatorCount = host.shadowRoot?.querySelectorAll('.ProseMirror .block-drop-indicator').length ?? 0
  const indicatorTagName = indicator?.tagName ?? null

  fire('drop', target, clientX, clientY)
  fire('dragend', handle, clientX, clientY)
  return { indicatorMode, indicatorCount, indicatorTagName }
}

function shiftClickGutter(host: ShEditorHost, blockId: string, xOffset: number): void {
  const block = blockById(host, blockId)
  const rect = block.getBoundingClientRect()
  assertPositiveRect(`gutter block ${blockId}`, rect)
  block.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    composed: true,
    shiftKey: true,
    clientX: rect.left + xOffset,
    clientY: rect.top + Math.min(rect.height / 2, 12),
  }))
}

/**
 * The live host editor. play() waits for the sync-gated mount, then types into the
 * REAL collaborative editor and asserts the live host reflects it — probeable.
 */
export const LiveHost: Story = {
  render: () => mountLiveHost(),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const host = hostOf(canvasElement)
    // The host mounts the editor in a whenSynced.then() microtask; let it settle.
    await settleHost(host)

    const editor = host.liveEditor
    if (!editor) throw new Error('LiveHost.play: the live editor did not mount')

    // Drive the REAL editor through the host's command surface (the same path a
    // Playwright keystroke would, but environment-independent). The structural
    // handle is read-only by design; reach the real TipTap commands via _editor.
    editorCommands(host).insertContent('Tlön Uqbar')

    const text = editor.getText()
    if (!text.includes('Tlön Uqbar')) {
      throw new Error(`LiveHost.play: expected live host editor text to contain "Tlön Uqbar", got: ${text}`)
    }
  },
}

/**
 * Real-browser keyboard audit. The story's play() only proves the live editor is
 * mounted; the Storybook test-runner then drives page.keyboard.type() and the
 * platform undo chord against Chromium.
 */
export const UndoKeystrokeAudit: Story = {
  render: () => mountLiveHost(),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const host = hostOf(canvasElement)
    await settleHost(host)

    if (!host.liveEditor) throw new Error('UndoKeystrokeAudit.play: live editor did not mount')
    if (!host.shadowRoot?.querySelector('.ProseMirror')) {
      throw new Error('UndoKeystrokeAudit.play: missing ProseMirror surface')
    }
  },
}

/**
 * Browser-only affordance audit for the Garden PR #4 live bugs:
 * fold controls must have real geometry, collapsed-count stays inline, and the
 * parent fold strip must not leak into the wire hotspot.
 */
export const OutlinerAffordanceAudit: Story = {
  render: () => mountLiveHost(),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const host = hostOf(canvasElement)
    await settleHost(host)

    if (!host.liveEditor) throw new Error('OutlinerAffordanceAudit.play: live editor did not mount')
    if (!editorCommands(host).setContent(OUTLINE_SEED)) {
      throw new Error('OutlinerAffordanceAudit.play: failed to seed outliner content')
    }
    await settleHost(host)

    const parent = blockById(host, 'block-a')
    const leaf = blockById(host, 'block-c')
    assertPositiveRect('parent block', parent.getBoundingClientRect())
    assertPositiveRect('leaf block', leaf.getBoundingClientRect())

    const fold = foldButton(host)
    const foldRect = fold.getBoundingClientRect()
    assertPositiveRect('fold button', foldRect)
    if (fold.getAttribute('aria-expanded') !== 'true') {
      throw new Error(`OutlinerAffordanceAudit.play: fold button should start expanded, got ${fold.getAttribute('aria-expanded')}`)
    }

    const wireRequests = { count: 0 }
    host.addEventListener('mn-block-wire-request', () => {
      wireRequests.count += 1
    })
    const wireRequestCount = (): number => wireRequests.count

    const parentRect = parent.getBoundingClientRect()
    parent.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: parentRect.left + 6,
      clientY: parentRect.top + parentRect.height / 2,
    }))
    if (wireRequestCount() !== 0) {
      throw new Error('OutlinerAffordanceAudit.play: parent fold strip leaked into wire request handling')
    }
    await settleHost(host)
    if (!blockById(host, 'block-a').classList.contains('outliner-collapsed')) {
      throw new Error('OutlinerAffordanceAudit.play: parent fold strip did not toggle collapse')
    }

    blockById(host, 'block-a').dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: parentRect.left + 6,
      clientY: parentRect.top + parentRect.height / 2,
    }))
    await settleHost(host)
    if (blockById(host, 'block-a').classList.contains('outliner-collapsed')) {
      throw new Error('OutlinerAffordanceAudit.play: parent fold strip did not toggle expansion')
    }

    const expandedParent = blockById(host, 'block-a')
    const expandedParentRect = expandedParent.getBoundingClientRect()
    expandedParent.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: expandedParentRect.left + 22,
      clientY: expandedParentRect.top + expandedParentRect.height / 2,
    }))
    if (wireRequestCount() !== 1) {
      throw new Error(`OutlinerAffordanceAudit.play: parent wire strip did not dispatch exactly once (got ${wireRequestCount()})`)
    }

    // Collapse/expand is a real ProseMirror transaction and may replace a block
    // DOM node. Reacquire the leaf instead of dispatching through a stale,
    // detached element that can no longer bubble to the editor host.
    const expandedLeaf = blockById(host, 'block-c')
    const leafRect = expandedLeaf.getBoundingClientRect()
    expandedLeaf.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: leafRect.left + 6,
      clientY: leafRect.top + leafRect.height / 2,
    }))
    if (wireRequestCount() !== 2) {
      throw new Error(`OutlinerAffordanceAudit.play: leaf wire gutter did not dispatch (got ${wireRequestCount()})`)
    }

    fold.click()
    await settleHost(host)

    const collapsedParent = blockById(host, 'block-a')
    const hiddenChild = blockById(host, 'block-b')
    if (!collapsedParent.classList.contains('outliner-collapsed')) {
      throw new Error('OutlinerAffordanceAudit.play: parent did not receive outliner-collapsed')
    }
    if (!hiddenChild.classList.contains('outliner-hidden')) {
      throw new Error('OutlinerAffordanceAudit.play: collapsed child did not receive outliner-hidden')
    }

    const count = host.shadowRoot?.querySelector<HTMLElement>('.outliner-collapsed-count')
    if (!count) throw new Error('OutlinerAffordanceAudit.play: missing collapsed-count pill')
    const countDisplay = getComputedStyle(count).display
    if (countDisplay !== 'inline-flex') {
      throw new Error(`OutlinerAffordanceAudit.play: collapsed-count display should be inline-flex, got ${countDisplay}`)
    }
    const countRect = count.getBoundingClientRect()
    const collapsedRect = collapsedParent.getBoundingClientRect()
    assertPositiveRect('collapsed-count pill', countRect)
    if (countRect.top > collapsedRect.bottom || countRect.bottom < collapsedRect.top) {
      throw new Error('OutlinerAffordanceAudit.play: collapsed-count pill rendered outside the parent block row')
    }

    if (!host.liveEditor.zoomIntoBlock('block-a')) {
      throw new Error('OutlinerAffordanceAudit.play: zoomIntoBlock(block-a) returned false')
    }
    await settleHost(host)

    const breadcrumb = host.shadowRoot?.querySelector<HTMLElement>('.zoom-breadcrumb:not([hidden])')
    if (!breadcrumb) throw new Error('OutlinerAffordanceAudit.play: zoom breadcrumb did not render')
    assertPositiveRect('zoom breadcrumb', breadcrumb.getBoundingClientRect())
    if (!breadcrumb.textContent?.includes('Parent')) {
      throw new Error(`OutlinerAffordanceAudit.play: breadcrumb did not include Parent (${breadcrumb.textContent ?? ''})`)
    }
  },
}

/**
 * Browser-only interaction audit for the Garden PR #4 local Playwright gaps:
 * keyboard fold activation, mouse block selection, Escape block-selection
 * semantics, drag/drop indicator + reparenting, and shift-gutter zoom + crumb
 * navigation. The unit tests prove the pure plans; this story proves the real
 * host/editor DOM wiring in Chromium.
 */
export const OutlinerInteractionAudit: Story = {
  render: () => mountLiveHost(),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const host = hostOf(canvasElement)
    await settleHost(host)

    if (!host.liveEditor) throw new Error('OutlinerInteractionAudit.play: live editor did not mount')
    if (!editorCommands(host).setContent(INTERACTION_SEED)) {
      throw new Error('OutlinerInteractionAudit.play: failed to seed outliner content')
    }
    await settleHost(host)

    const initialBlockCount = host.shadowRoot?.querySelectorAll('.ProseMirror > [data-block-id]').length ?? 0
    assertEqual('OutlinerInteractionAudit block count before fold-keyboard path', initialBlockCount, 4)

    const fold = foldButton(host)
    fold.focus()
    dispatchKey(fold, 'Enter')
    await settleHost(host)
    assertEqual(
      'OutlinerInteractionAudit fold button aria-expanded after Enter',
      foldButton(host).getAttribute('aria-expanded'),
      'false',
    )
    assertClassState(blockById(host, 'block-b'), 'outliner-hidden', true, 'OutlinerInteractionAudit child hidden after Enter')
    assertEqual(
      'OutlinerInteractionAudit block count after Enter on fold button',
      host.shadowRoot?.querySelectorAll('.ProseMirror > [data-block-id]').length ?? 0,
      initialBlockCount,
    )

    const refocusedFold = foldButton(host)
    refocusedFold.focus()
    dispatchKey(refocusedFold, ' ')
    await settleHost(host)
    assertEqual(
      'OutlinerInteractionAudit fold button aria-expanded after Space',
      foldButton(host).getAttribute('aria-expanded'),
      'true',
    )
    assertClassState(blockById(host, 'block-b'), 'outliner-hidden', false, 'OutlinerInteractionAudit child visible after Space')

    clickDragHandle(host, 'block-a')
    await settleHost(host)
    assertEqual('OutlinerInteractionAudit parent handle selects subtree', selectedCount(host), 2)
    dispatchKey(rawEditor(host).view.dom, 'Escape')
    await settleHost(host)
    assertEqual('OutlinerInteractionAudit Escape clears active block selection', selectedCount(host), 0)

    setCaretInsideBlock(host, 'block-d')
    dispatchKey(rawEditor(host).view.dom, 'Escape')
    await settleHost(host)
    assertEqual('OutlinerInteractionAudit Escape enters block selection when clear', selectedCount(host), 1)
    dispatchKey(rawEditor(host).view.dom, 'Escape')
    await settleHost(host)
    assertEqual('OutlinerInteractionAudit second Escape clears block selection', selectedCount(host), 0)

    const dropResult = dragBlock(host, 'block-d', 'block-c', 'child')
    assertEqual('OutlinerInteractionAudit drag indicator count', dropResult.indicatorCount, 1)
    assertEqual('OutlinerInteractionAudit drag indicator mode', dropResult.indicatorMode, 'child')
    await settleHost(host)
    assertEqual('OutlinerInteractionAudit drag child reindent', blockById(host, 'block-d').getAttribute('data-indent'), '1')
    if (blockTexts(host).join('|') !== 'Parent|Child|Middle|Leaf') {
      throw new Error(`OutlinerInteractionAudit: unexpected block order after drag: ${blockTexts(host).join('|')}`)
    }

    if (!editorCommands(host).setContent(INTERACTION_SEED)) {
      throw new Error('OutlinerInteractionAudit.play: failed to reset outliner content before zoom audit')
    }
    await settleHost(host)
    shiftClickGutter(host, 'block-c', 6)
    await settleHost(host)
    assertClassState(blockById(host, 'block-c'), 'outliner-zoom-root', true, 'OutlinerInteractionAudit shift-gutter zoom root')
    const zoomHiddenCount = host.shadowRoot?.querySelectorAll('.ProseMirror .outliner-zoom-hidden').length ?? 0
    assertEqual('OutlinerInteractionAudit shift-gutter zoom hides non-subtree blocks', zoomHiddenCount, 3)
    const homeCrumb = host.shadowRoot?.querySelector<HTMLButtonElement>('.zoom-breadcrumb .zoom-breadcrumb-crumb')
    if (!homeCrumb) throw new Error('OutlinerInteractionAudit: missing Home zoom crumb')
    homeCrumb.click()
    await settleHost(host)
    assertEqual(
      'OutlinerInteractionAudit Home crumb clears zoom root',
      host.shadowRoot?.querySelectorAll('.ProseMirror .outliner-zoom-root').length ?? 0,
      0,
    )
    assertEqual(
      'OutlinerInteractionAudit Home crumb clears zoom-hidden blocks',
      host.shadowRoot?.querySelectorAll('.ProseMirror .outliner-zoom-hidden').length ?? 0,
      0,
    )
  },
}

/**
 * Browser-only drag/drop geometry audit for the remaining Garden PR #4 local
 * Playwright coverage: every drop mode gets a real widget span, after-mode lands
 * past the target subtree, invalid own-subtree drops are no-ops, and a listItem
 * target resolves geometry from the top-level block rect.
 */
export const OutlinerDragDropGeometryAudit: Story = {
  render: () => mountLiveHost(),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const host = hostOf(canvasElement)
    await settleHost(host)

    if (!host.liveEditor) throw new Error('OutlinerDragDropGeometryAudit.play: live editor did not mount')

    const seed = async (): Promise<void> => {
      if (!editorCommands(host).setContent(DRAG_GEOMETRY_SEED)) {
        throw new Error('OutlinerDragDropGeometryAudit.play: failed to seed drag geometry content')
      }
      await settleHost(host)
      assertEqual(
        'OutlinerDragDropGeometryAudit seeded block count',
        blockIds(host).length,
        7,
      )
    }

    const assertDrop = (label: string, sourceId: string, targetId: string, mode: DropMode) => {
      const result = dragBlock(host, sourceId, targetId, mode)
      assertEqual(`${label} indicator count`, result.indicatorCount, 1)
      assertEqual(`${label} indicator mode`, result.indicatorMode, mode)
      assertEqual(`${label} indicator element`, result.indicatorTagName, 'SPAN')
    }

    await seed()
    assertDrop('before-mode paragraph target', 'block-g', 'block-d', 'before')
    await settleHost(host)
    assertEqual(
      'OutlinerDragDropGeometryAudit before-mode order',
      blockIds(host).join('|'),
      'block-a|block-b|block-c|block-g|block-d|block-e|block-f',
    )

    await seed()
    assertDrop('after-mode subtree target', 'block-g', 'block-a', 'after')
    await settleHost(host)
    assertEqual(
      'OutlinerDragDropGeometryAudit after-mode lands past target subtree',
      blockIds(host).join('|'),
      'block-a|block-b|block-c|block-d|block-g|block-e|block-f',
    )

    await seed()
    assertDrop('child-mode listItem target', 'block-g', 'block-e', 'child')
    await settleHost(host)
    assertEqual(
      'OutlinerDragDropGeometryAudit child-mode order',
      blockIds(host).join('|'),
      'block-a|block-b|block-c|block-d|block-e|block-g|block-f',
    )
    assertEqual(
      'OutlinerDragDropGeometryAudit child-mode reindent',
      blockById(host, 'block-g').getAttribute('data-indent'),
      '1',
    )

    await seed()
    assertDrop('listItem before-mode geometry', 'block-g', 'block-e', 'before')
    await settleHost(host)
    assertEqual(
      'OutlinerDragDropGeometryAudit listItem before-mode order',
      blockIds(host).join('|'),
      'block-a|block-b|block-c|block-d|block-g|block-e|block-f',
    )

    await seed()
    const beforeInvalidDrop = blockIds(host).join('|')
    dragBlock(host, 'block-a', 'block-b', 'child')
    await settleHost(host)
    assertEqual(
      'OutlinerDragDropGeometryAudit invalid own-subtree drop is a no-op',
      blockIds(host).join('|'),
      beforeInvalidDrop,
    )
  },
}

/**
 * Browser-only guard for the host-owned overlay Escape gate. The real organism
 * passes this callback when the wikilink/tag picker glue is open; the pure kernel
 * must then let Escape fall through instead of entering block selection.
 */
export const OutlinerEscapeGateAudit: Story = {
  render: () => mountLiveHost({ isOverlayOpen: () => true }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const host = hostOf(canvasElement)
    await settleHost(host)

    if (!host.liveEditor) throw new Error('OutlinerEscapeGateAudit.play: live editor did not mount')
    if (!editorCommands(host).setContent(OUTLINE_SEED)) {
      throw new Error('OutlinerEscapeGateAudit.play: failed to seed outliner content')
    }
    await settleHost(host)

    setCaretInsideBlock(host, 'block-c')
    dispatchKey(rawEditor(host).view.dom, 'Escape')
    await settleHost(host)
    assertEqual('OutlinerEscapeGateAudit Escape does not enter block selection while overlay gate is open', selectedCount(host), 0)
  },
}

/** The honest placeholder state (no open provider) — the pre-lift organism. */
export const PlaceholderHost: Story = {
  render: () => {
    void ShEditorHost
    const container = document.createElement('div')
    container.className = 'main'
    container.style.position = 'relative'
    container.style.height = '100vh'
    render(mountEditorHost(makeBinding(NULL_EDITOR_HOST_STATE)), container)
    return container
  },
}
