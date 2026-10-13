/**
 * popover.ts — the native top-layer helper (Popover API wrapper).
 *
 * Non-element utility modeled on mn-tooltip.ts's Popover-API usage (`popover`
 * attribute, `showPopover`/`hidePopover`, `:popover-open` styling with a
 * `popover-open` attribute fallback for DOM runtimes without popovers, e.g.
 * happy-dom). Promotes floating UI (dropdowns/menus/popovers) into the
 * browser's native top layer, which escapes ancestor z-index/overflow/
 * transform stacking-context traps — see the layer-contract campaign
 * diagnosis (workspace-selector clip-under-doc-bar).
 *
 * Exports three pure primitives (unit-testable without a real popover
 * implementation) plus a `PopoverController` — a Lit `ReactiveController`
 * that is the ergonomic adoption surface for components migrating off
 * in-shadow `position: absolute|fixed` + local z-index.
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit'

export type PopoverPlacement =
  | 'bottom-start' | 'bottom-end' | 'bottom'
  | 'top-start'    | 'top-end'    | 'top'

type PopoverCapableElement = HTMLElement & {
  showPopover?: () => void
  hidePopover?: () => void
}

/**
 * Show `el` in the native top layer. Wraps `showPopover` in try/catch (it
 * throws if already open / unsupported) and ALWAYS sets the `popover-open`
 * attribute so behavior stays observable + layout-stable in DOM runtimes
 * without popovers (happy-dom) — the exact fallback mn-tooltip uses.
 */
export function showPopover(el: HTMLElement): void {
  const api = el as PopoverCapableElement
  try {
    api.showPopover?.()
  } catch {
    // Native popover can throw if already open or unsupported; the
    // popover-open attribute fallback below keeps behavior deterministic.
  }
  el.setAttribute('popover-open', '')
}

/** Hide `el`: `hidePopover` in try/catch, then remove the `popover-open` attribute. */
export function hidePopover(el: HTMLElement): void {
  const api = el as PopoverCapableElement
  try {
    api.hidePopover?.()
  } catch {
    // Attribute fallback below remains authoritative in test DOMs.
  }
  el.removeAttribute('popover-open')
}

/** True if open via the native pseudo-class OR the attribute fallback. */
export function isPopoverOpen(el: HTMLElement): boolean {
  let matchedNative = false
  try {
    matchedNative = el.matches(':popover-open')
  } catch {
    // DOM runtimes without popover support (happy-dom) don't recognize the
    // pseudo-class; the attribute fallback below is authoritative there.
  }
  return matchedNative || el.hasAttribute('popover-open')
}

export interface PositionOptions {
  /** default 'bottom-start' */
  placement?: PopoverPlacement
  /** px between anchor edge and popover, default 6 */
  gap?: number
  /** viewport clamp inset, default 8 */
  padding?: number
}

/**
 * Anchor `popoverEl` to `anchor` via `getBoundingClientRect`, clamped to the
 * viewport; writes inline `left`/`top` (px). Flips bottom<->top if it would
 * overflow the chosen edge. Reads the popover's own rect for width/height.
 * No-op if either element is missing. Uses `popoverEl.ownerDocument.defaultView`.
 */
export function positionPopover(anchor: Element, popoverEl: HTMLElement, opts: PositionOptions = {}): void {
  if (!anchor || !popoverEl) return

  const placement = opts.placement ?? 'bottom-start'
  const gap = opts.gap ?? 6
  const padding = opts.padding ?? 8
  const view = popoverEl.ownerDocument.defaultView ?? window

  const anchorRect = anchor.getBoundingClientRect()
  const popoverRect = popoverEl.getBoundingClientRect()

  const wantsTop = placement.startsWith('top')
  const wantsEnd = placement.endsWith('end')
  const centered = placement === 'top' || placement === 'bottom'

  let left = centered
    ? anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2
    : wantsEnd
      ? anchorRect.right - popoverRect.width
      : anchorRect.left

  let top = wantsTop ? anchorRect.top - popoverRect.height - gap : anchorRect.bottom + gap

  // Flip if it would overflow the chosen edge.
  if (!wantsTop && top + popoverRect.height > view.innerHeight - padding) {
    top = anchorRect.top - popoverRect.height - gap
  } else if (wantsTop && top < padding) {
    top = anchorRect.bottom + gap
  }

  left = Math.max(padding, Math.min(left, view.innerWidth - popoverRect.width - padding))
  top = Math.max(padding, Math.min(top, view.innerHeight - popoverRect.height - padding))

  popoverEl.style.left = `${left}px`
  popoverEl.style.top = `${top}px`
}

export interface PopoverControllerOptions {
  /** Live getter for the anchor (e.g. the trigger button). */
  anchor: () => Element | null | undefined
  /** Live getter for the popover element (e.g. `.menu`). */
  popover: () => HTMLElement | null | undefined
  /** default 'bottom-start' */
  placement?: PopoverPlacement | (() => PopoverPlacement)
  gap?: number
  padding?: number
  /**
   * Return false to SKIP JS positioning (e.g. a mobile bottom-sheet placed by
   * CSS `inset`). When false, show() clears inline left/top so CSS wins and
   * does NOT attach reposition listeners. Default: always position.
   */
  shouldPosition?: () => boolean
}

/**
 * Ergonomic lifecycle wrapper. Instantiate as a field; drive from the host's
 * own open/close logic. `show()`: showPopover + position (if shouldPosition)
 * + attach scroll/resize reposition listeners. `hide()`: hidePopover +
 * detach. `reposition()`: re-run positionPopover.
 *
 * `hostDisconnected()` HIDES the popover (native `hidePopover()` + clears
 * the `popover-open` fallback attribute), not just detaches listeners: the
 * native Popover API itself auto-closes an open popover when it's removed
 * from the document, so the attribute fallback must mirror that or a
 * disconnected-while-open element would keep reporting `open` and, if ever
 * reinserted, would resurface pre-opened and un-positioned outside the
 * normal show() flow. Reinsertion never auto-reopens — the host's own
 * open/close state (which the host must reconcile on its own
 * disconnectedCallback; the controller cannot see it) governs whether
 * show() runs again. Guards null elements (safe when the host conditionally
 * renders the popover).
 */
export class PopoverController implements ReactiveController {
  private readonly opts: PopoverControllerOptions
  private listenersAttached = false
  private attachedView: (Window & typeof globalThis) | null = null
  private readonly onReposition = (): void => this.reposition()

  constructor(host: ReactiveControllerHost, opts: PopoverControllerOptions) {
    this.opts = opts
    host.addController(this)
  }

  hostDisconnected(): void {
    const popover = this.opts.popover()
    if (popover) hidePopover(popover)
    this.detachListeners()
  }

  get open(): boolean {
    const popover = this.opts.popover()
    return popover ? isPopoverOpen(popover) : false
  }

  show(): void {
    const popover = this.opts.popover()
    if (!popover) return
    showPopover(popover)
    if (this.shouldPosition()) {
      this.reposition()
      this.attachListeners()
    } else {
      popover.style.left = ''
      popover.style.top = ''
      this.detachListeners()
    }
  }

  hide(): void {
    this.detachListeners()
    const popover = this.opts.popover()
    if (!popover) return
    hidePopover(popover)
  }

  reposition(): void {
    const anchor = this.opts.anchor()
    const popover = this.opts.popover()
    if (!anchor || !popover) return
    positionPopover(anchor, popover, {
      placement: this.placement(),
      gap: this.opts.gap,
      padding: this.opts.padding,
    })
  }

  private placement(): PopoverPlacement {
    const configured = this.opts.placement
    return typeof configured === 'function' ? configured() : configured ?? 'bottom-start'
  }

  private shouldPosition(): boolean {
    return this.opts.shouldPosition ? this.opts.shouldPosition() : true
  }

  /**
   * Resolves the popover's OWN document view, matching `positionPopover`'s
   * `popoverEl.ownerDocument.defaultView` — not the global `window`. A
   * popover hosted in another document (an iframe, most concretely) must
   * observe scroll/resize on the viewport it actually renders against;
   * listening on the top-level `window` would reposition against the wrong
   * viewport (or never fire at all).
   */
  private resolveView(): Window & typeof globalThis {
    const popover = this.opts.popover()
    return (popover?.ownerDocument?.defaultView as (Window & typeof globalThis) | null | undefined) ?? window
  }

  private attachListeners(): void {
    if (this.listenersAttached) return
    const view = this.resolveView()
    view.addEventListener('scroll', this.onReposition, true)
    view.addEventListener('resize', this.onReposition)
    this.attachedView = view
    this.listenersAttached = true
  }

  private detachListeners(): void {
    if (!this.listenersAttached) return
    // Detach from the SAME view object that was attached to — resolving
    // fresh here could disagree if the popover moved documents or was
    // already unrendered by the time detach runs.
    const view = this.attachedView ?? window
    view.removeEventListener('scroll', this.onReposition, true)
    view.removeEventListener('resize', this.onReposition)
    this.attachedView = null
    this.listenersAttached = false
  }
}
