/**
 * mn-tooltip — Garden's small delayed tooltip primitive.
 *
 * The tooltip can wrap its anchor or target an external element by id. In a real
 * browser it uses the Popover API; in DOM runtimes without popovers it toggles a
 * `popover-open` attribute so behavior remains testable and layout-stable.
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'

const DEFAULT_SHOW_DELAY_MS = 600
const HIDE_DELAY_MS = 80

let nextTooltipId = 0

function byId(root: Document | ShadowRoot, id: string): Element | null {
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/["\\#.:]/g, '\\$&')
  return root.querySelector(`#${escaped}`)
}

@customElement('mn-tooltip')
export class MnTooltip extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: contents;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    [popover] {
      position: fixed;
      inset: unset;
      z-index: var(--mn-z-tooltip, 1200);
      margin: 0;
      padding: 4px 8px;
      overflow: visible;
      border: 0;
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-text-primary, #111827);
      color: var(--mn-color-text-inverse, #fff);
      box-shadow: var(--mn-shadow-raised, 0 4px 12px rgba(15, 23, 42, 0.18));
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.2;
      pointer-events: none;
      white-space: nowrap;
    }

    [popover]:not([popover-open]):not(:popover-open) {
      display: none;
    }

    .tip-inner {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .tip-shortcut {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 1px 4px;
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-secondary, #4b5563);
      font-family: var(--mn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: var(--mn-text-2xs, 11px);
      opacity: 0.86;
    }
  `

  @property({ type: String }) label = ''
  @property({ type: String }) shortcut: string | null = null
  @property({ type: String, attribute: 'for' }) targetId = ''
  @property({ type: String }) placement: 'top' | 'bottom' = 'bottom'
  @property({ type: Number }) delay = DEFAULT_SHOW_DELAY_MS

  @state() private visible = false

  @query('[popover]') private popoverEl!: HTMLElement

  private readonly tooltipId = `mn-tooltip-${++nextTooltipId}`
  private anchor: Element | null = null
  private showTimer: ReturnType<typeof setTimeout> | null = null
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  override connectedCallback(): void {
    super.connectedCallback()
    void this.updateComplete.then(() => this.attachAnchor())
  }

  override disconnectedCallback(): void {
    this.detachAnchor()
    this.clearTimers()
    super.disconnectedCallback()
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('targetId')) {
      this.detachAnchor()
      this.attachAnchor()
    }
    if (changed.has('visible')) {
      if (this.visible) this.showTooltipPopover()
      else this.hideTooltipPopover()
    }
  }

  private attachAnchor(): void {
    const anchor = this.resolveAnchor()
    if (!anchor || anchor === this.anchor) return
    this.anchor = anchor
    anchor.setAttribute('aria-describedby', this.tooltipId)
    anchor.addEventListener('mouseenter', this.onEnter)
    anchor.addEventListener('mouseleave', this.onLeave)
    anchor.addEventListener('focus', this.onEnter)
    anchor.addEventListener('blur', this.onLeave)
    anchor.addEventListener('keydown', this.onKeyDown)
  }

  private detachAnchor(): void {
    if (!this.anchor) return
    this.anchor.removeEventListener('mouseenter', this.onEnter)
    this.anchor.removeEventListener('mouseleave', this.onLeave)
    this.anchor.removeEventListener('focus', this.onEnter)
    this.anchor.removeEventListener('blur', this.onLeave)
    this.anchor.removeEventListener('keydown', this.onKeyDown)
    this.anchor.removeAttribute('aria-describedby')
    this.anchor = null
  }

  private resolveAnchor(): Element | null {
    const root = this.getRootNode() as Document | ShadowRoot
    if (this.targetId) return byId(root, this.targetId) ?? document.getElementById(this.targetId)
    const slot = this.shadowRoot?.querySelector('slot') as HTMLSlotElement | null
    const assigned = slot?.assignedElements({ flatten: true }) ?? []
    if (assigned.length > 0) return assigned[0]
    return this.previousElementSibling
  }

  private readonly onEnter = (): void => {
    this.clearTimers()
    if (!this.label) return
    this.showTimer = setTimeout(() => {
      this.visible = true
    }, this.delay)
  }

  private readonly onLeave = (): void => {
    this.clearTimers()
    this.hideTimer = setTimeout(() => {
      this.visible = false
    }, HIDE_DELAY_MS)
  }

  private readonly onKeyDown = (event: Event): void => {
    if ((event as KeyboardEvent).key !== 'Escape') return
    this.clearTimers()
    this.visible = false
  }

  private clearTimers(): void {
    if (this.showTimer) clearTimeout(this.showTimer)
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.showTimer = null
    this.hideTimer = null
  }

  private showTooltipPopover(): void {
    const tip = this.popoverEl
    if (!tip) return
    const api = tip as HTMLElement & { showPopover?: () => void }
    try {
      api.showPopover?.()
    } catch {
      // Native popover can throw if already open; attribute fallback below is enough.
    }
    tip.setAttribute('popover-open', '')
    this.position()
  }

  private hideTooltipPopover(): void {
    const tip = this.popoverEl
    if (!tip) return
    const api = tip as HTMLElement & { hidePopover?: () => void }
    try {
      api.hidePopover?.()
    } catch {
      // Attribute fallback below remains authoritative in test DOMs.
    }
    tip.removeAttribute('popover-open')
  }

  private position(): void {
    const anchor = this.anchor
    const tip = this.popoverEl
    const view = this.ownerDocument.defaultView ?? window
    if (!anchor || !tip) return

    const anchorRect = anchor.getBoundingClientRect()
    const tipRect = tip.getBoundingClientRect()
    const gap = 6
    let top = this.placement === 'top' ? anchorRect.top - tipRect.height - gap : anchorRect.bottom + gap
    if (this.placement === 'top' && top < 0) top = anchorRect.bottom + gap
    if (this.placement === 'bottom' && top + tipRect.height > view.innerHeight) {
      top = anchorRect.top - tipRect.height - gap
    }
    let left = anchorRect.left + anchorRect.width / 2 - tipRect.width / 2
    left = Math.max(4, Math.min(left, view.innerWidth - tipRect.width - 4))
    tip.style.top = `${top}px`
    tip.style.left = `${left}px`
  }

  override render() {
    return html`
      <slot></slot>
      <div id=${this.tooltipId} popover="manual" role="tooltip" aria-live="polite">
        <span class="tip-inner">
          <span class="tip-label">${this.label}</span>
          ${this.shortcut ? html`<span class="tip-shortcut" aria-hidden="true">${this.shortcut}</span>` : nothing}
        </span>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-tooltip': MnTooltip
  }
}
