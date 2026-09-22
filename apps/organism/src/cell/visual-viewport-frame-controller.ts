/**
 * One full-screen viewport contract for adaptive workspaces and app routes.
 *
 * The two actual screen roots (`.shell-pane` and the mobile delivery portal)
 * are fixed at CSS (0, 0). While an IME is visible, both document roots are
 * collapsed to the settled visual-viewport height and their captured scroll
 * position is reasserted. This contains WebKit's otherwise-unavoidable root
 * pan without fixing the body (which can leave stale iPad hit-test geometry).
 *
 * Two containment strategies coexist: `follow` (default — the on-device
 * winner, 2026-07-20 iPhone 12 Pro Max / iOS 27) re-anchors the roots to the
 * visual viewport's reported offset while the keyboard is open, so a pan
 * WebKit refuses to flush moves the roots with the glass instead of leaving
 * them behind it; `pin` (`?viewport-strategy=pin`, the escape hatch) holds
 * the roots at layout-viewport (0, 0) and only reasserts the root scroll
 * plane. If on-device geometry shows a pan with `offsetTop` still 0, neither
 * strategy can see it (compositor-level keyboard push, WebKit 292603) and
 * containment must move to avoiding the caret-reveal trigger instead.
 */

const FRAME_STYLE_ID = 'organism-visual-viewport-frame-styles'
const DEBUG_OUTPUT_ID = 'organism-visual-viewport-debug'
const ADAPTIVE_BREAKPOINT = '(max-width: 1024px)'
const KEYBOARD_THRESHOLD_PX = 150

export const ORGANISM_ROUTE_VIEWPORT_FRAME_ATTRIBUTE = 'data-organism-route-viewport-frame'

export const VISUAL_VIEWPORT_FRAME_CSS = `
  html[data-organism-visual-viewport-frame='true'],
  html[data-organism-visual-viewport-frame='true'] > body {
    /* Any residual compositor band (WebKit 292603) exposes the root canvas;
       paint it as surface so an un-fixable strip reads as chrome, not void. */
    background: var(--mn-color-surface-canvas, var(--mn-color-surface-base, #fff));
  }
  html[data-organism-visual-viewport-frame='true'] {
    width: 100%;
    height: 100%;
    overflow: hidden !important;
    overscroll-behavior: none;
    overflow-anchor: none;
  }
  html[data-organism-visual-viewport-frame='true'][data-organism-viewport-keyboard] {
    height: var(--organism-vvh, 100dvh) !important;
    min-height: 0 !important;
  }
  html[data-organism-visual-viewport-frame='true'] > body:is(
    [data-organism-mobile-shell-active],
    [data-organism-route-viewport-frame]
  ) {
    width: 100% !important;
    height: 100% !important;
    min-height: 0 !important;
    overflow: hidden !important;
    overscroll-behavior: none;
    overflow-anchor: none;
  }
  html[data-organism-visual-viewport-frame='true'][data-organism-viewport-keyboard]
    > body:is(
      [data-organism-mobile-shell-active],
      [data-organism-route-viewport-frame]
    ) {
    height: var(--organism-vvh, 100dvh) !important;
  }
  html[data-organism-visual-viewport-frame='true']
    > body[data-organism-route-viewport-frame]
    > .shell-pane {
    position: fixed !important;
    inset: 0 auto auto 0 !important;
    width: var(--organism-vvw, 100vw) !important;
    height: var(--organism-vvh, 100dvh) !important;
    overflow-anchor: none;
  }
  html[data-organism-visual-viewport-frame='true']
    > body[data-organism-mobile-shell-active]
    > .organism-mobile-shell {
    overflow-anchor: none;
  }
  html[data-organism-visual-viewport-frame='true'][data-organism-viewport-strategy='follow']
    > body[data-organism-route-viewport-frame]
    > .shell-pane,
  html[data-organism-visual-viewport-frame='true'][data-organism-viewport-strategy='follow']
    > body[data-organism-mobile-shell-active]
    > .shell-pane,
  html[data-organism-visual-viewport-frame='true'][data-organism-viewport-strategy='follow']
    > body[data-organism-mobile-shell-active]
    > .organism-mobile-shell {
    inset: var(--organism-vv-top, 0px) auto auto var(--organism-vv-left, 0px) !important;
  }
  html[data-organism-visual-viewport-frame='true']
    > body[data-organism-route-viewport-frame]
    > .shell-pane
    > #host {
    width: 100% !important;
    height: 100% !important;
    min-height: 0 !important;
  }
  #${DEBUG_OUTPUT_ID} {
    position: fixed;
    z-index: 2147483647;
    inset: max(4px, env(safe-area-inset-top)) 4px auto;
    box-sizing: border-box;
    max-width: calc(100vw - 8px);
    padding: 5px 7px;
    border-radius: 5px;
    background: rgba(0, 0, 0, 0.82);
    color: #b7ffbd;
    font: 10px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap;
    pointer-events: none;
  }
`

interface VisualViewportLike extends EventTarget {
  readonly width: number
  readonly height: number
  readonly offsetLeft?: number
  readonly offsetTop?: number
  readonly pageLeft?: number
  readonly pageTop?: number
}

export interface VisualViewportFrameEnvironment {
  readonly document?: Document
  readonly matchMedia?: (query: string) => MediaQueryList
  readonly visualViewport?: VisualViewportLike | null
  readonly innerWidth?: () => number
  readonly innerHeight?: () => number
  readonly scrollX?: () => number
  readonly scrollY?: () => number
  readonly scrollTo?: (x: number, y: number) => void
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number
  readonly debug?: boolean
  readonly strategy?: 'pin' | 'follow'
}

interface RootScrollPosition {
  readonly x: number
  readonly y: number
}

function frameRequested(body: HTMLElement): boolean {
  return body.hasAttribute('data-organism-mobile-shell-active')
    || body.hasAttribute(ORGANISM_ROUTE_VIEWPORT_FRAME_ATTRIBUTE)
}

function editableFromEvent(event: Event): HTMLElement | null {
  // Happy DOM and a few older WebKit event paths can omit the leaf from
  // composedPath(); target is the authoritative fallback.
  for (const candidate of [event.target, ...event.composedPath()]) {
    if (!(candidate instanceof HTMLElement)) continue
    if (candidate.isContentEditable || candidate.getAttribute('contenteditable') === 'true') {
      return candidate
    }
    if (candidate instanceof HTMLTextAreaElement) return candidate
    if (candidate instanceof HTMLInputElement && ![
      'button',
      'checkbox',
      'color',
      'file',
      'hidden',
      'image',
      'radio',
      'range',
      'reset',
      'submit',
    ].includes(candidate.type)) return candidate
  }
  return null
}

export class OrganismVisualViewportFrameController {
  private readonly doc: Document
  private readonly media: MediaQueryList
  private readonly viewport: VisualViewportLike | null
  private readonly innerWidth: () => number
  private readonly innerHeight: () => number
  private readonly scrollX: () => number
  private readonly scrollY: () => number
  private readonly scrollTo: (x: number, y: number) => void
  private readonly requestAnimationFrame: (callback: FrameRequestCallback) => number
  private readonly observer: MutationObserver
  private readonly debug: boolean
  private readonly strategy: 'pin' | 'follow'
  private debugOutput: HTMLOutputElement | null = null
  private active = false
  private keyboardOpen = false
  private savedScroll: RootScrollPosition = { x: 0, y: 0 }
  private updateScheduled = false
  private destroyed = false

  constructor(environment: VisualViewportFrameEnvironment = {}) {
    const doc = environment.document ?? globalThis.document
    const win = doc.defaultView ?? globalThis.window
    this.doc = doc
    this.media = (environment.matchMedia ?? ((query) => win.matchMedia(query)))(ADAPTIVE_BREAKPOINT)
    this.viewport = environment.visualViewport === undefined
      ? (win.visualViewport as VisualViewportLike | null)
      : environment.visualViewport
    this.innerWidth = environment.innerWidth ?? (() => win.innerWidth)
    this.innerHeight = environment.innerHeight ?? (() => win.innerHeight)
    this.scrollX = environment.scrollX ?? (() => win.scrollX)
    this.scrollY = environment.scrollY ?? (() => win.scrollY)
    this.scrollTo = environment.scrollTo ?? ((x, y) => win.scrollTo(x, y))
    this.requestAnimationFrame = environment.requestAnimationFrame
      ?? ((callback) => win.requestAnimationFrame(callback))
    const params = new URL(win.location.href).searchParams
    this.debug = environment.debug ?? params.has('viewport-debug')
    this.strategy = environment.strategy
      ?? (params.get('viewport-strategy') === 'pin' ? 'pin' : 'follow')
    this.observer = new MutationObserver(() => this.refresh())

    this.ensureStyle()
    if (this.debug) this.ensureDebugOutput()
    this.media.addEventListener('change', this.onMediaChange)
    this.viewport?.addEventListener('resize', this.onViewportChange)
    this.viewport?.addEventListener('scroll', this.onViewportChange)
    this.doc.addEventListener('pointerdown', this.onEditablePointerDown, true)
    this.doc.addEventListener('focusin', this.onEditableFocus, true)
    this.observer.observe(this.doc.body, {
      attributes: true,
      attributeFilter: [
        'data-organism-mobile-shell-active',
        ORGANISM_ROUTE_VIEWPORT_FRAME_ATTRIBUTE,
      ],
    })
    this.refresh()
  }

  get isActive(): boolean {
    return this.active
  }

  get isKeyboardOpen(): boolean {
    return this.keyboardOpen
  }

  private ensureStyle(): void {
    if (this.doc.getElementById(FRAME_STYLE_ID)) return
    const style = this.doc.createElement('style')
    style.id = FRAME_STYLE_ID
    style.textContent = VISUAL_VIEWPORT_FRAME_CSS
    this.doc.head.append(style)
  }

  private ensureDebugOutput(): void {
    const existing = this.doc.getElementById(DEBUG_OUTPUT_ID)
    if (existing instanceof HTMLOutputElement) {
      this.debugOutput = existing
      return
    }
    const output = this.doc.createElement('output')
    output.id = DEBUG_OUTPUT_ID
    output.setAttribute('aria-label', 'Viewport diagnostics')
    this.doc.body.append(output)
    this.debugOutput = output
  }

  private updateDebugOutput(): void {
    const output = this.debugOutput
    if (!output) return
    const viewport = this.viewport
    const screenRoot = this.doc.querySelector<HTMLElement>(
      '.organism-mobile-shell[data-active="true"], .shell-pane',
    )
    const rootRect = screenRoot?.getBoundingClientRect()
    let focused = this.doc.activeElement as HTMLElement | null
    while (focused?.shadowRoot?.activeElement) {
      focused = focused.shadowRoot.activeElement as HTMLElement
    }
    const focusRect = focused?.getBoundingClientRect()
    const format = (value: number | undefined): string => Math.round(value ?? 0).toString()
    const shellHost = this.doc.querySelector<HTMLElement>("[data-organism-mobile-shell='true']")
    const appContainer = shellHost?.querySelector<HTMLElement>(':scope > .app-container')
    const editorHost = this.doc.getElementById('mn-editor-host')
    const vvBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? 0)
    output.value = [
      `keyboard=${this.keyboardOpen} strategy=${this.strategy} inner=${format(this.innerWidth())}x${format(this.innerHeight())}`,
      `vv=${format(viewport?.width)}x${format(viewport?.height)} off=${format(viewport?.offsetLeft)},${format(viewport?.offsetTop)} page=${format(viewport?.pageLeft)},${format(viewport?.pageTop)}`,
      `scroll win=${format(this.scrollX())},${format(this.scrollY())} html=${format(this.doc.documentElement.scrollLeft)},${format(this.doc.documentElement.scrollTop)} body=${format(this.doc.body.scrollLeft)},${format(this.doc.body.scrollTop)}`,
      `root=${screenRoot?.className || screenRoot?.localName || 'none'} rect=${format(rootRect?.left)},${format(rootRect?.top)} ${format(rootRect?.width)}x${format(rootRect?.height)}`,
      `focus=${focused?.localName ?? 'none'} rect=${format(focusRect?.left)},${format(focusRect?.top)} ${format(focusRect?.width)}x${format(focusRect?.height)}`,
      // Document-chain bottoms vs the glass: the dead band lives wherever
      // appB/edB stop short of vvB while shellKb disagrees with keyboard=.
      `doc shellKb=${shellHost?.dataset.mobileKeyboard ?? '-'} appB=${format(appContainer?.getBoundingClientRect().bottom)} edB=${format(editorHost?.getBoundingClientRect().bottom)} vvB=${format(vvBottom)}`,
    ].join('\n')
  }

  private readonly onMediaChange = (): void => this.refresh()

  private readonly onEditablePointerDown = (event: Event): void => {
    if (!this.active || this.destroyed) return
    const editable = editableFromEvent(event)
    if (!editable || editable.matches(':focus')) return
    // Run inside the trusted pointer gesture so iOS still opens its keyboard,
    // but make the first focus scroll-free. The untouched pointer default then
    // places the caret at the tapped position inside the already-focused node.
    editable.focus({ preventScroll: true })
    this.pinRootScroll()
    this.updateDebugOutput()
  }

  private readonly onEditableFocus = (event: Event): void => {
    if (!this.active || this.destroyed || !editableFromEvent(event)) return
    this.pinRootScroll()
    this.onViewportChange()
    this.updateDebugOutput()
  }

  private readonly onViewportChange = (): void => {
    if (!this.active || this.updateScheduled || this.destroyed) return
    this.updateScheduled = true
    this.requestAnimationFrame(() => {
      if (this.destroyed) {
        this.updateScheduled = false
        return
      }
      this.requestAnimationFrame(() => {
        this.updateScheduled = false
        if (!this.destroyed) this.applyViewportSize()
      })
    })
  }

  private captureScroll(): void {
    this.savedScroll = { x: this.scrollX(), y: this.scrollY() }
  }

  private pinRootScroll(): void {
    const { x, y } = this.savedScroll
    // Assign all three scroll owners even if their reported values already
    // match. On iOS that no-op write also flushes stale visual-viewport pan.
    this.doc.documentElement.scrollLeft = x
    this.doc.documentElement.scrollTop = y
    this.doc.body.scrollLeft = x
    this.doc.body.scrollTop = y
    this.scrollTo(x, y)
  }

  private applyViewportSize(): void {
    if (!this.active) return
    const innerHeight = this.innerHeight()
    const innerWidth = this.innerWidth()
    const viewportHeight = this.viewport?.height ?? innerHeight
    const viewportWidth = this.viewport?.width ?? innerWidth
    const keyboardOpen = viewportHeight < innerHeight - KEYBOARD_THRESHOLD_PX
    const keyboardClosed = this.keyboardOpen && !keyboardOpen
    this.keyboardOpen = keyboardOpen

    const style = this.doc.documentElement.style
    if (keyboardOpen) {
      style.setProperty('--organism-vvh', `${viewportHeight}px`)
      style.setProperty('--organism-vvw', `${viewportWidth}px`)
    } else {
      // With no IME to contain, the 100dvh/100vw fallbacks track Safari's
      // toolbar animation in the compositor; a sampled pixel height lags it
      // and drags the bottom chrome around on every scroll.
      style.removeProperty('--organism-vvh')
      style.removeProperty('--organism-vvw')
    }
    if (this.strategy === 'follow') {
      // Re-anchor the screen roots to the glass. Offsets are consumed only
      // while the keyboard is open so pinch-zoom pans keep native behavior.
      style.setProperty('--organism-vv-top', `${keyboardOpen ? this.viewport?.offsetTop ?? 0 : 0}px`)
      style.setProperty('--organism-vv-left', `${keyboardOpen ? this.viewport?.offsetLeft ?? 0 : 0}px`)
    }
    // The home indicator sits beneath the keyboard while it is open, so any
    // env(safe-area-inset-bottom) clearance would float as a blank strip at
    // the keyboard seam. Consumers read this var with the env() as fallback.
    if (keyboardOpen) {
      style.setProperty('--mn-viewport-inset-bottom', '0px')
    } else {
      style.removeProperty('--mn-viewport-inset-bottom')
    }
    this.doc.body.toggleAttribute('data-organism-viewport-keyboard', keyboardOpen)
    this.doc.documentElement.toggleAttribute('data-organism-viewport-keyboard', keyboardOpen)

    // WebKit intentionally permits root scrolling once the visual viewport is
    // smaller than the layout viewport, even when body overflow is hidden.
    // Constrain the roots in CSS and reassert their scroll plane while open;
    // repeat after close to restore both pixels and hit-test coordinates.
    if (keyboardOpen || keyboardClosed) this.pinRootScroll()
    this.updateDebugOutput()
  }

  refresh(): void {
    if (this.destroyed) return
    const requested = this.media.matches && frameRequested(this.doc.body)
    if (requested === this.active) {
      if (requested) this.applyViewportSize()
      return
    }

    this.active = requested
    if (requested) {
      this.captureScroll()
      this.doc.documentElement.dataset.organismVisualViewportFrame = 'true'
      this.doc.documentElement.dataset.organismViewportStrategy = this.strategy
      this.applyViewportSize()
      return
    }

    this.pinRootScroll()
    this.keyboardOpen = false
    this.doc.body.removeAttribute('data-organism-viewport-keyboard')
    this.doc.documentElement.removeAttribute('data-organism-viewport-keyboard')
    delete this.doc.documentElement.dataset.organismVisualViewportFrame
    delete this.doc.documentElement.dataset.organismViewportStrategy
    this.doc.documentElement.style.removeProperty('--organism-vv-top')
    this.doc.documentElement.style.removeProperty('--organism-vv-left')
    this.doc.documentElement.style.removeProperty('--mn-viewport-inset-bottom')
    this.doc.documentElement.style.removeProperty('--organism-vvh')
    this.doc.documentElement.style.removeProperty('--organism-vvw')
    this.updateDebugOutput()
  }

  destroy(): void {
    if (this.destroyed) return
    if (this.active) this.pinRootScroll()
    this.destroyed = true
    this.observer.disconnect()
    this.media.removeEventListener('change', this.onMediaChange)
    this.viewport?.removeEventListener('resize', this.onViewportChange)
    this.viewport?.removeEventListener('scroll', this.onViewportChange)
    this.doc.removeEventListener('pointerdown', this.onEditablePointerDown, true)
    this.doc.removeEventListener('focusin', this.onEditableFocus, true)
    this.doc.body.removeAttribute('data-organism-viewport-keyboard')
    this.doc.documentElement.removeAttribute('data-organism-viewport-keyboard')
    delete this.doc.documentElement.dataset.organismVisualViewportFrame
    delete this.doc.documentElement.dataset.organismViewportStrategy
    this.doc.documentElement.style.removeProperty('--organism-vv-top')
    this.doc.documentElement.style.removeProperty('--organism-vv-left')
    this.doc.documentElement.style.removeProperty('--mn-viewport-inset-bottom')
    this.doc.documentElement.style.removeProperty('--organism-vvh')
    this.doc.documentElement.style.removeProperty('--organism-vvw')
    this.debugOutput?.remove()
    this.debugOutput = null
  }
}
