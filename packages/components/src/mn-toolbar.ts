/**
 * mn-toolbar / mn-toolbar-group / mn-toolbar-overflow — Garden toolbar
 * semantics, lifted without the Garden roving-tabindex controller.
 *
 * These are layout/ARIA primitives for editor controls. They deliberately do not
 * execute commands; child controls own their click events and the host owns all
 * editor state.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import { PopoverController } from './popover.js'

export type MnToolbarOrientation = 'horizontal' | 'vertical' | 'both'
export type MnToolbarVariant = 'default' | 'compact'
export interface MnToolbarOverflowSelectDetail {
  item: HTMLElement
  label: string
}

@customElement('mn-toolbar')
export class MnToolbar extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: var(--mn-toolbar-gap, var(--mn-space-1, 4px));
      min-width: 0;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    :host([orientation='vertical']) {
      flex-direction: column;
      align-items: stretch;
    }

    :host([variant='compact']) {
      gap: 0;
    }

    :host([data-skin='emporium']) {
      gap: var(--mn-toolbar-gap, 2px);
    }

    :host([data-skin='98']) {
      gap: var(--mn-toolbar-gap, 3px);
    }
  `

  @property({ type: String, reflect: true }) label = ''
  @property({ type: String, reflect: true }) orientation: MnToolbarOrientation = 'horizontal'
  @property({ type: String, reflect: true }) variant: MnToolbarVariant = 'default'

  connectedCallback(): void {
    super.connectedCallback()
    this.setAttribute('role', 'toolbar')
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has('label')) {
      if (this.label) this.setAttribute('aria-label', this.label)
      else this.removeAttribute('aria-label')
    }
    if (changed.has('orientation')) {
      this.setAttribute('aria-orientation', this.orientation === 'vertical' ? 'vertical' : 'horizontal')
    }
  }

  override render() {
    return html`<slot></slot>`
  }
}

@customElement('mn-toolbar-group')
export class MnToolbarGroup extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-toolbar-gap, var(--mn-space-1, 4px));
      min-width: 0;
      width: var(--mn-toolbar-group-width, auto);
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    :host([divider]) {
      margin-inline-end: var(--mn-space-1, 4px);
      padding-inline-end: var(--mn-space-2, 8px);
      border-inline-end: var(--mn-toolbar-group-rule, 1px solid var(--mn-color-border-subtle, #e5e7eb));
    }

    .group {
      display: inline-flex;
      align-items: center;
      flex-wrap: var(--mn-toolbar-group-wrap, nowrap);
      gap: var(--mn-toolbar-gap, var(--mn-space-1, 4px));
      min-width: 0;
      width: var(--mn-toolbar-group-width, auto);
    }

    .label {
      /* Falls back through the shared skin-wide token so Emporium's
         icon-only mode still works, but a narrower
         --mn-toolbar-group-label-display lets a specific host (e.g. the
         editor toolbar) hide JUST group captions without also hiding
         --mn-label-display-driven labels on other controls (mn-button,
         etc.) nested in the same subtree. */
      display: var(--mn-toolbar-group-label-display, var(--mn-label-display, inline));
      flex: 0 0 auto;
      min-width: var(--mn-toolbar-group-label-width, auto);
      padding-inline-end: var(--mn-space-1, 4px);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1;
      pointer-events: none;
      user-select: none;
      white-space: nowrap;
    }
  `

  @property({ type: String }) label = ''
  @property({ type: Boolean, reflect: true }) divider = false

  override render() {
    return html`
      <span class="group" role="group" aria-label=${this.label || nothing}>
        ${this.label ? html`<span class="label" aria-hidden="true">${this.label}</span>` : nothing}
        <slot></slot>
      </span>
    `
  }
}

@customElement('mn-toolbar-overflow')
export class MnToolbarOverflow extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-toolbar-gap, var(--mn-space-1, 4px));
      min-width: 0;
      position: relative;
      flex: 1 1 auto;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    slot {
      display: contents;
    }

    ::slotted([data-overflow-hidden]) {
      display: none !important;
    }

    .overflow-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 28px;
      height: 28px;
      padding: 0;
      border: 1px solid transparent;
      border-radius: var(--mn-radius-sm, 4px);
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
      cursor: pointer;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease);
    }

    .overflow-button[hidden] {
      display: none;
    }

    .overflow-button:hover,
    .overflow-button[aria-expanded='true'] {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .overflow-button:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, #2563eb);
      outline-offset: 2px;
    }

    [popover] {
      position: fixed;
      inset: unset;
      margin: 0;
      z-index: var(--mn-z-dropdown, 1000);
    }

    [popover]:not([popover-open]):not(:popover-open) {
      display: none;
    }

    .menu {
      min-width: var(--mn-toolbar-overflow-min-width, 168px);
      max-width: min(320px, calc(100vw - 24px));
      box-sizing: border-box;
      padding: var(--mn-space-1, 4px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #111827);
      box-shadow: var(--mn-shadow-lg, 0 18px 40px rgba(15, 23, 42, 0.16));
    }

    .menu-item {
      display: flex;
      align-items: center;
      width: 100%;
      min-height: 30px;
      box-sizing: border-box;
      gap: var(--mn-space-2, 8px);
      padding: 0 var(--mn-space-2, 8px);
      border: 0;
      border-radius: var(--mn-radius-md, 6px);
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-sm, 13px);
      outline: none;
      text-align: left;
      white-space: nowrap;
    }

    .menu-item:hover,
    .menu-item:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    :host([data-skin='98']) .overflow-button {
      border: 0;
      border-radius: 0;
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='98']) .overflow-button:active,
    :host([data-skin='98']) .overflow-button[aria-expanded='true'] {
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-sunken);
    }
    :host([data-skin='98']) .menu {
      border: 0;
      border-radius: 0;
      background: var(--mn-98-face, #c0c0c0);
      box-shadow: var(--mn-shadow-popover);
    }
    :host([data-skin='98']) .menu-item {
      border-radius: 0;
    }
    :host([data-skin='98']) .menu-item:hover,
    :host([data-skin='98']) .menu-item:focus-visible {
      background: var(--mn-98-selection, #000080);
      color: #fff;
    }
    :host([data-skin='glass']) .overflow-button {
      border: var(--mn-control-border);
      background: var(--mn-control-background);
      box-shadow: var(--mn-control-shadow);
    }
    :host([data-skin='glass']) .overflow-button:hover {
      background: var(--mn-control-background-hover);
    }
    :host([data-skin='glass']) .overflow-button:active,
    :host([data-skin='glass']) .overflow-button[aria-expanded='true'] {
      background: var(--mn-control-background-active);
      box-shadow: var(--mn-control-shadow-active);
    }
    :host([data-skin='glass']) .menu {
      border: var(--mn-control-border);
      background: var(--mn-color-surface-elevated);
      box-shadow: var(--mn-shadow-popover);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) .menu-item:hover,
    :host([data-skin='glass']) .menu-item:focus-visible {
      background: var(--mn-color-interactive-selected);
    }

    .item-label {
      min-width: 0;
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .item-shortcut {
      flex: 0 0 auto;
      margin-left: var(--mn-space-3, 12px);
      color: var(--mn-color-text-tertiary, #9ca3af);
      font-family: var(--mn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: var(--mn-text-xs, 12px);
      white-space: nowrap;
    }
  `

  @property({ type: String, attribute: 'overflow-label' }) overflowLabel = 'More actions'

  @state() private overflowItems: HTMLElement[] = []
  @state() private overflowCount = 0
  @state() private open = false

  @query('slot') private defaultSlot?: HTMLSlotElement
  @query('.overflow-button') private overflowButton?: HTMLButtonElement

  private resizeObserver?: ResizeObserver
  private measureFrame = 0
  private listenersAttached = false
  private readonly keyDownHandler = this.handleDocumentKeyDown.bind(this)
  private readonly pointerDownHandler = this.handlePointerDownOutside.bind(this)

  /**
   * Promotes `.menu` to the native top layer (Popover API) so it escapes
   * whatever stacking context the host toolbar forms — see the
   * layer-contract campaign diagnosis. `.menu` is unconditionally rendered
   * (visibility was previously `[hidden]`, now the popover-open contract),
   * so the popover getter always resolves; driven directly from
   * openMenu()/closeMenu() rather than an `updated()` override because
   * `open` is private @state here (same `keyof this` pitfall documented on
   * mn-workspace-selector).
   */
  private readonly menuPopover = new PopoverController(this, {
    anchor: () => this.overflowButton,
    popover: () => this.shadowRoot?.querySelector('.menu'),
    placement: 'bottom-end',
    gap: 4,
  })

  override connectedCallback(): void {
    super.connectedCallback()
    if ('ResizeObserver' in globalThis) {
      this.resizeObserver = new ResizeObserver(() => this.requestMeasure())
      this.resizeObserver.observe(this)
    }
    this.requestMeasure()
  }

  override disconnectedCallback(): void {
    this.resizeObserver?.disconnect()
    this.cancelMeasure()
    // Reconcile `open` (and hide the top-layer surface, which closeMenu()
    // already does directly) before the controller's own hostDisconnected()
    // (fired by super.disconnectedCallback() below) runs too — a
    // disconnected-while-open overflow menu must not stay flagged open, or
    // reinsertion would resurrect a stale menu outside the normal
    // trigger-click flow.
    this.closeMenu()
    this.detachListeners()
    super.disconnectedCallback()
  }

  private assignedItems(): HTMLElement[] {
    return (this.defaultSlot?.assignedElements({ flatten: true }) ?? []).filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    )
  }

  private itemLabel(item: HTMLElement): string {
    return item.getAttribute('aria-label') || item.textContent?.trim() || ''
  }

  private itemShortcut(item: HTMLElement): string {
    return item.dataset.shortcut || item.getAttribute('aria-keyshortcuts') || ''
  }

  private itemPriority(item: HTMLElement): number {
    const raw = Number.parseInt(item.dataset.priority ?? '0', 10)
    return Number.isFinite(raw) ? raw : 0
  }

  private gapWidth(): number {
    const styles = getComputedStyle(this)
    const raw = Number.parseFloat(styles.columnGap || styles.gap)
    return Number.isFinite(raw) ? raw : 4
  }

  private requestMeasure(): void {
    this.cancelMeasure()
    this.measureFrame = requestAnimationFrame(() => {
      this.measureFrame = 0
      void this.updateComplete.then(() => this.measure())
    })
  }

  private cancelMeasure(): void {
    if (this.measureFrame) cancelAnimationFrame(this.measureFrame)
    this.measureFrame = 0
  }

  private measure(): void {
    const items = this.assignedItems()
    for (const item of items) item.removeAttribute('data-overflow-hidden')

    if (items.length === 0) {
      this.setOverflowItems([])
      return
    }

    const hostWidth = this.offsetWidth
    const widths = new Map(items.map((item) => [item, item.offsetWidth]))
    const gap = this.gapWidth()
    const totalWidth = items.reduce((sum, item) => sum + (widths.get(item) ?? 0), 0) + gap * Math.max(0, items.length - 1)

    if (totalWidth <= hostWidth) {
      this.setOverflowItems([])
      return
    }

    const availableWidth = Math.max(0, hostWidth - 36)
    const sorted = items
      .map((item, index) => ({ item, index, priority: this.itemPriority(item) }))
      .sort((a, b) => a.priority - b.priority || a.index - b.index)
    const hidden = new Set<HTMLElement>()
    let visibleWidth = totalWidth
    let visibleCount = items.length

    for (const { item } of sorted) {
      if (visibleWidth <= availableWidth) break
      hidden.add(item)
      visibleWidth -= (widths.get(item) ?? 0) + (visibleCount > 1 ? gap : 0)
      visibleCount -= 1
    }

    for (const item of items) item.toggleAttribute('data-overflow-hidden', hidden.has(item))
    this.setOverflowItems(items.filter((item) => hidden.has(item)))
  }

  private setOverflowItems(items: HTMLElement[]): void {
    for (const item of this.overflowItems) {
      if (!items.includes(item)) item.removeAttribute('data-overflow-hidden')
    }
    const previous = this.overflowItems
    const previousCount = this.overflowCount
    this.overflowItems = items
    this.overflowCount = items.length
    this.requestUpdate('overflowItems', previous)
    this.requestUpdate('overflowCount', previousCount)
    if (items.length === 0) this.closeMenu()
  }

  private attachListeners(): void {
    if (this.listenersAttached) return
    this.ownerDocument.addEventListener('keydown', this.keyDownHandler, true)
    this.ownerDocument.addEventListener('pointerdown', this.pointerDownHandler, true)
    this.listenersAttached = true
  }

  private detachListeners(): void {
    if (!this.listenersAttached) return
    this.ownerDocument.removeEventListener('keydown', this.keyDownHandler, true)
    this.ownerDocument.removeEventListener('pointerdown', this.pointerDownHandler, true)
    this.listenersAttached = false
  }

  private openMenu(): void {
    if (this.overflowItems.length === 0) return
    const previous = this.open
    this.open = true
    this.requestUpdate('open', previous)
    this.attachListeners()
    this.menuPopover.show()
  }

  private closeMenu(options: { restoreFocus?: boolean } = {}): void {
    if (!this.open) return
    const previous = this.open
    this.open = false
    this.requestUpdate('open', previous)
    this.detachListeners()
    this.menuPopover.hide()
    if (options.restoreFocus) this.overflowButton?.focus()
  }

  private toggleMenu(event: MouseEvent): void {
    event.stopPropagation()
    if (this.open) this.closeMenu()
    else this.openMenu()
  }

  private handleDocumentKeyDown(event: KeyboardEvent): void {
    if (!this.open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.closeMenu({ restoreFocus: true })
    }
  }

  private handlePointerDownOutside(event: PointerEvent): void {
    if (!this.open) return
    const path = event.composedPath()
    if (!path.includes(this)) this.closeMenu()
  }

  private selectOverflowItem(item: HTMLElement): void {
    const label = this.itemLabel(item)
    this.dispatchEvent(new CustomEvent<MnToolbarOverflowSelectDetail>('mn-overflow-select', {
      detail: { item, label },
      bubbles: true,
      composed: true,
    }))
    item.click()
    this.closeMenu({ restoreFocus: true })
  }

  override render() {
    return html`
      <slot @slotchange=${() => this.requestMeasure()}></slot>
      <button
        class="overflow-button"
        type="button"
        ?hidden=${this.overflowCount === 0}
        aria-label=${this.overflowLabel}
        aria-haspopup="menu"
        aria-expanded=${String(this.open)}
        @click=${(event: MouseEvent) => this.toggleMenu(event)}
      >
        ${icon('more-horizontal', { size: 16 })}
      </button>
      <div class="menu" popover="manual" role="menu">
        ${this.overflowItems.map((item) => html`
          <button
            class="menu-item"
            role="menuitem"
            type="button"
            @click=${() => this.selectOverflowItem(item)}
          >
            <span class="item-label">${this.itemLabel(item)}</span>
            ${this.itemShortcut(item)
              ? html`<span class="item-shortcut">${this.itemShortcut(item)}</span>`
              : nothing}
          </button>
        `)}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-toolbar': MnToolbar
    'mn-toolbar-group': MnToolbarGroup
    'mn-toolbar-overflow': MnToolbarOverflow
  }
}
