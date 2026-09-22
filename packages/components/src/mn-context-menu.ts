/**
 * mn-context-menu — Garden's viewport-aware context menu, made backend-free.
 *
 * Garden's original component was already mostly presentational. This lift binds
 * it to Shrubbery's pure MenuEntry model so command registry projections,
 * sidebar row menus, palettes, and inspectors can share one command surface.
 * The component owns only transient UI state: position, open/closed, and
 * keyboard focus. Selection leaves as a composed event.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { repeat } from 'lit/directives/repeat.js'
import type {
  MenuCustomEntry,
  MenuDivider,
  MenuEntry,
  MenuHeader,
  MenuItemEntry,
  MenuSelectDetail,
  MenuSelectModifiers,
} from '@shrubbery/nucleus'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import { hidePopover, showPopover } from './popover.js'

export type MnContextMenuEntry = MenuEntry
export type MnContextMenuItem = MenuItemEntry
export type MnContextMenuSelectDetail = MenuSelectDetail
export type MnContextMenuModifiers = MenuSelectModifiers
export type MnContextMenuAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

function modifiersFrom(event: MouseEvent | KeyboardEvent): MenuSelectModifiers {
  return {
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  }
}

function isDivider(entry: MenuEntry): entry is MenuDivider {
  return 'type' in entry && entry.type === 'divider'
}

function isHeader(entry: MenuEntry): entry is MenuHeader {
  return 'type' in entry && entry.type === 'header'
}

function isCustom(entry: MenuEntry): entry is MenuCustomEntry {
  return 'type' in entry && entry.type === 'custom'
}

function isItem(entry: MenuEntry): entry is MenuItemEntry {
  return !('type' in entry)
}

function isSelectable(entry: MenuEntry): entry is MenuItemEntry {
  return isItem(entry) && !entry.disabled
}

@customElement('mn-context-menu')
export class MnContextMenu extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      position: fixed;
      inset: unset;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      z-index: var(--mn-z-dropdown, 1000);
      display: block;
      opacity: 0;
      transform: scale(0.97);
      transform-origin: top left;
      pointer-events: none;
      transition:
        opacity var(--mn-transition-fast, 120ms) ease,
        transform var(--mn-transition-fast, 120ms) ease;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    :host([open]) {
      opacity: 1;
      transform: scale(1);
      pointer-events: auto;
    }

    .menu {
      min-width: var(--mn-context-menu-min-width, 180px);
      max-width: var(--mn-context-menu-max-width, 300px);
      padding: var(--mn-space-1, 4px);
      overflow: hidden;
      box-sizing: border-box;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-surface, var(--mn-radius-lg, 8px));
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #111827);
      box-shadow: var(--mn-shadow-lg, 0 18px 40px rgba(15, 23, 42, 0.16));
      backdrop-filter: var(--mn-window-backdrop-filter, none);
    }

    .menu-item {
      display: flex;
      width: 100%;
      min-height: 30px;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: 0 var(--mn-space-2, 8px);
      border: 0;
      border-radius: var(--mn-radius-control, var(--mn-radius-md, 6px));
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-sm, 13px);
      text-align: left;
      outline: none;
      box-sizing: border-box;
    }

    .menu-item:hover,
    .menu-item.focused {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .menu-item:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, #2563eb);
      outline-offset: -1px;
    }

    .menu-item.danger {
      color: var(--mn-color-danger-700, #b91c1c);
    }

    .menu-item.danger:hover,
    .menu-item.danger.focused {
      background: var(--mn-color-danger-50, #fef2f2);
    }

    .menu-item:disabled,
    .menu-item.disabled {
      opacity: 0.5;
      cursor: default;
    }

    .item-icon,
    .item-check,
    .submenu-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 16px;
      color: var(--mn-color-text-muted, #6b7280);
    }

    .menu-item.danger .item-icon {
      color: var(--mn-color-danger-700, #b91c1c);
    }

    .item-label {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-shortcut {
      flex: 0 0 auto;
      margin-left: var(--mn-space-3, 12px);
      color: var(--mn-color-text-tertiary, #9ca3af);
      font-size: var(--mn-text-xs, 12px);
      white-space: nowrap;
    }

    .divider {
      height: 1px;
      margin: var(--mn-space-1, 4px) 0;
      background: var(--mn-color-border-subtle, #e5e7eb);
    }

    .menu-header {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: 7px var(--mn-space-2, 8px) 5px;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 11px);
      font-weight: 650;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      user-select: none;
    }

    .menu-header-icon {
      display: inline-flex;
      flex: 0 0 auto;
      opacity: 0.7;
    }

    :host([data-skin='98']) .menu {
      border: 0;
      background: var(--mn-98-face);
      box-shadow: var(--mn-shadow-popover);
    }
    :host([data-skin='98']) .menu-item:hover,
    :host([data-skin='98']) .menu-item.focused {
      background: var(--mn-98-selection);
      color: #fff;
    }
    :host([data-skin='glass']) .menu {
      border: var(--mn-control-border);
      background: var(--mn-color-surface-elevated);
    }
    :host([data-skin='glass']) .menu-item:hover,
    :host([data-skin='glass']) .menu-item.focused {
      background: var(--mn-color-interactive-selected);
    }

    .menu-header-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .menu-custom {
      padding: var(--mn-space-2, 8px);
    }
  `

  @property({ type: Array }) items: readonly MnContextMenuEntry[] = []
  @property({ type: Boolean, reflect: true }) open = false

  @state() private focusedIndex = -1

  @query('.menu') private menuElement?: HTMLElement

  private position = { x: 0, y: 0 }
  private anchor: MnContextMenuAnchor = 'top-left'
  private outsideArmed = false
  private readonly clickOutsideHandler = this.handleClickOutside.bind(this)
  private readonly touchOutsideHandler = this.handleTouchOutside.bind(this)

  connectedCallback(): void {
    super.connectedCallback()
    document.addEventListener('keydown', this.handleKeyDown)
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    document.removeEventListener('keydown', this.handleKeyDown)
    this.disarmOutsideListeners()
    // The host IS the popover (no PopoverController here — see show()'s
    // doc comment), so nothing else clears its top-layer state on removal.
    // hide() is idempotent (no-ops when already closed) and reconciles both
    // the native/attribute popover-open state AND `open`, matching the
    // native Popover API's own auto-close-on-disconnect behavior.
    this.hide()
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('open') && this.open && this.focusedIndex === -1) {
      this.focusedIndex = this.firstSelectableIndex()
    }
  }

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has('open')) {
      if (this.open) {
        this.adjustPosition()
        this.focusCurrentItem()
      } else {
        this.disarmOutsideListeners()
      }
    }
  }

  /**
   * The host element itself is the floating surface (no inner wrapper), so
   * the host is the popover — promotes it into the native top layer via the
   * raw showPopover()/hidePopover() functions (a PopoverController targets a
   * *child* element via getters, which doesn't fit the host-as-popover
   * shape; see the layer-contract campaign diagnosis + plan §3.3).
   */
  show(position: { readonly x: number; readonly y: number }, anchor: MnContextMenuAnchor = 'top-left'): void {
    this.setAttribute('popover', 'manual')
    this.position = { x: position.x, y: position.y }
    this.anchor = anchor
    this.focusedIndex = this.firstSelectableIndex()
    this.open = true
    showPopover(this)
    window.setTimeout(() => this.armOutsideListeners(), 0)
  }

  hide(): void {
    if (!this.open) return
    this.open = false
    this.focusedIndex = -1
    this.disarmOutsideListeners()
    hidePopover(this)
    this.emitClose()
  }

  private firstSelectableIndex(): number {
    return this.items.some(isSelectable) ? 0 : -1
  }

  private selectableItems(): MenuItemEntry[] {
    return this.items.filter(isSelectable)
  }

  private focusCurrentItem(): void {
    const button = this.renderRoot?.querySelector<HTMLButtonElement>(
      `[data-actionable-index="${this.focusedIndex}"]`,
    )
    button?.focus()
  }

  private armOutsideListeners(): void {
    if (this.outsideArmed || !this.open) return
    document.addEventListener('mousedown', this.clickOutsideHandler)
    document.addEventListener('touchstart', this.touchOutsideHandler, { passive: true })
    this.outsideArmed = true
  }

  private disarmOutsideListeners(): void {
    if (!this.outsideArmed) return
    document.removeEventListener('mousedown', this.clickOutsideHandler)
    document.removeEventListener('touchstart', this.touchOutsideHandler)
    this.outsideArmed = false
  }

  private adjustPosition(): void {
    if (!this.menuElement) return

    const rect = this.menuElement.getBoundingClientRect()
    const padding = 8
    let { x, y } = this.position

    if (this.anchor.includes('right')) x -= rect.width
    if (this.anchor.includes('bottom')) y -= rect.height

    if (x + rect.width > window.innerWidth - padding) {
      x = Math.max(padding, window.innerWidth - rect.width - padding)
    }
    if (x < padding) x = padding

    if (y + rect.height > window.innerHeight - padding) {
      y = Math.max(padding, window.innerHeight - rect.height - padding)
    }
    if (y < padding) y = padding

    this.style.left = `${x}px`
    this.style.top = `${y}px`
  }

  private handleClickOutside(event: MouseEvent): void {
    if (!event.composedPath().includes(this)) this.hide()
  }

  private handleTouchOutside(event: TouchEvent): void {
    if (!event.composedPath().includes(this)) this.hide()
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.open) return

    const actionable = this.selectableItems()
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.hide()
      return
    }
    if (event.key === 'Tab') {
      this.hide()
      return
    }
    if (actionable.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const current = Math.max(0, this.focusedIndex)
      this.focusedIndex = (current + 1) % actionable.length
      void this.updateComplete.then(() => this.focusCurrentItem())
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      this.focusedIndex = this.focusedIndex <= 0 ? actionable.length - 1 : this.focusedIndex - 1
      void this.updateComplete.then(() => this.focusCurrentItem())
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const item = actionable[this.focusedIndex]
      if (item) this.selectItem(item, modifiersFrom(event))
    }
  }

  private selectItem(item: MenuItemEntry, modifiers: MenuSelectModifiers): void {
    if (item.disabled) return
    this.dispatchEvent(
      new CustomEvent<MenuSelectDetail>('mn-select', {
        detail: { id: item.id, item, modifiers },
        bubbles: true,
        composed: true,
      }),
    )
    this.hide()
  }

  private emitClose(): void {
    this.dispatchEvent(new CustomEvent('mn-close', { bubbles: true, composed: true }))
  }

  private handleItemClick(event: MouseEvent, item: MenuItemEntry): void {
    event.preventDefault()
    event.stopPropagation()
    this.selectItem(item, modifiersFrom(event))
  }

  private handleItemMouseEnter(actionableIndex: number): void {
    this.focusedIndex = actionableIndex
  }

  render() {
    if (!this.open) return nothing

    let actionableIndex = 0
    return html`
      <div class="menu" role="menu" aria-label="Context menu">
        ${repeat(
          this.items,
          (entry, index) => (isItem(entry) ? entry.id : `${entry.type}-${index}`),
          (entry) => {
            if (isDivider(entry)) {
              return html`<div class="divider" role="separator"></div>`
            }
            if (isHeader(entry)) {
              return html`
                <div class="menu-header" role="presentation">
                  <span class="menu-header-icon" aria-hidden="true">${icon('folder', { size: 12 })}</span>
                  <span class="menu-header-text">${entry.content}</span>
                </div>
              `
            }
            if (isCustom(entry)) {
              return html`<div class="menu-custom">${entry.render()}</div>`
            }

            const item = entry
            const currentIndex = actionableIndex
            if (!item.disabled) actionableIndex += 1
            const focused = !item.disabled && currentIndex === this.focusedIndex

            return html`
              <button
                class=${classMap({
                  'menu-item': true,
                  focused,
                  danger: item.variant === 'danger',
                  disabled: !!item.disabled,
                })}
                role="menuitem"
                data-menu-item-id=${item.id}
                data-actionable-index=${item.disabled ? '' : String(currentIndex)}
                tabindex=${focused ? 0 : -1}
                ?disabled=${item.disabled}
                aria-checked=${item.checked === undefined ? nothing : String(item.checked)}
                @click=${(event: MouseEvent) => this.handleItemClick(event, item)}
                @mouseenter=${() => {
                  if (!item.disabled) this.handleItemMouseEnter(currentIndex)
                }}
              >
                <span class="item-check" aria-hidden="true">
                  ${item.checked ? icon('check', { size: 14 }) : nothing}
                </span>
                ${item.icon
                  ? html`<span class="item-icon" aria-hidden="true">${icon(item.icon, { size: 14 })}</span>`
                  : nothing}
                <span class="item-label">${item.label}</span>
                ${item.shortcut ? html`<span class="item-shortcut">${item.shortcut}</span>` : nothing}
                ${item.submenu?.length
                  ? html`<span class="submenu-icon" aria-hidden="true">${icon('chevron-right', { size: 14 })}</span>`
                  : nothing}
              </button>
            `
          },
        )}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-context-menu': MnContextMenu
  }
}
