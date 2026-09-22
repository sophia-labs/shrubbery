/**
 * mn-dropdown-button — Garden's anchored menu button over Shrubbery's pure menu model.
 *
 * The component owns only transient UI state: open/closed, focus, and viewport
 * positioning. Menu data arrives as @shrubbery/nucleus MenuEntry values and
 * selection leaves as a composed `mn-select` event.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
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
import { PopoverController } from './popover.js'

export type MnDropdownEntry = MenuEntry
export type MnDropdownItem = MenuItemEntry
export type MnDropdownSelectDetail = MenuSelectDetail
export type MnDropdownPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'
export type MnDropdownVariant = 'default' | 'ghost' | 'toolbar'
export type MnDropdownSize = 'xs' | 'sm' | 'md' | 'lg'

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

@customElement('mn-dropdown-button')
export class MnDropdownButton extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: inline-block;
      position: relative;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    .trigger {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      max-width: 100%;
      gap: var(--mn-space-2, 8px);
      box-sizing: border-box;
      border: 1px solid transparent;
      border-radius: var(--mn-radius-md, 6px);
      background: transparent;
      color: var(--mn-color-text-primary, #111827);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-sm, 13px);
      line-height: 1;
      outline: none;
      white-space: nowrap;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        border-color var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease);
    }

    .trigger:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, #2563eb);
      outline-offset: 2px;
    }

    .trigger:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .variant-default {
      min-height: 32px;
      padding: var(--mn-space-1, 4px) var(--mn-space-3, 12px);
      border-color: var(--mn-color-border-default, #d1d5db);
      background: var(--mn-color-surface-raised, #fff);
    }

    .variant-default:hover:not(:disabled),
    .variant-default[aria-expanded='true'] {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .variant-ghost {
      min-height: 30px;
      padding: var(--mn-space-1, 4px) var(--mn-space-2, 8px);
    }

    .variant-ghost:hover:not(:disabled),
    .variant-ghost[aria-expanded='true'] {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .variant-toolbar {
      min-height: 28px;
      padding: var(--mn-space-1, 4px) var(--mn-space-2, 8px);
      border-radius: var(--mn-radius-sm, 4px);
      color: var(--mn-color-text-secondary, #4b5563);
    }

    .variant-toolbar:hover:not(:disabled),
    .variant-toolbar[aria-expanded='true'] {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .size-xs {
      min-height: 24px;
      padding-inline: var(--mn-space-2, 8px);
      font-size: var(--mn-text-xs, 12px);
    }

    .size-sm {
      min-height: 28px;
    }

    .size-md {
      min-height: 32px;
    }

    .size-lg {
      min-height: 38px;
      font-size: var(--mn-text-base, 15px);
    }

    .trigger-label {
      display: var(--mn-label-display, inline);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .trigger-icon,
    .trigger-caret {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
    }

    .trigger-caret {
      color: var(--mn-color-text-tertiary, #6b7280);
    }

    .menu-popover {
      position: fixed;
      inset: unset;
      z-index: var(--mn-z-dropdown, 1000);
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
    }

    [popover]:not([popover-open]):not(:popover-open) {
      display: none;
    }

    .menu-panel {
      min-width: var(--mn-dropdown-min-width, 180px);
      max-width: var(--mn-dropdown-max-width, 320px);
      box-sizing: border-box;
      overflow: hidden;
      padding: var(--mn-space-1, 4px);
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #111827);
      box-shadow: var(--mn-shadow-lg, 0 18px 40px rgba(15, 23, 42, 0.16));
      transform-origin: top left;
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
    .menu-item.focused {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .menu-item:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, #2563eb);
      outline-offset: -1px;
    }

    .menu-item.selected {
      background: var(--mn-color-interactive-selected, #eef2ff);
      color: var(--mn-color-text-accent, #4338ca);
      font-weight: 550;
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
      cursor: default;
      opacity: 0.55;
    }

    .item-icon,
    .item-check,
    .submenu-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      flex: 0 0 auto;
      color: var(--mn-color-text-muted, #6b7280);
    }

    .menu-item.danger .item-icon {
      color: var(--mn-color-danger-700, #b91c1c);
    }

    .item-check.empty {
      visibility: hidden;
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

    .divider {
      height: 1px;
      margin: var(--mn-space-1, 4px) 0;
      background: var(--mn-color-border-subtle, #e5e7eb);
    }

    .menu-header {
      display: flex;
      align-items: center;
      padding: 7px var(--mn-space-2, 8px) 5px;
      color: var(--mn-color-text-muted, #6b7280);
      cursor: default;
      font-size: var(--mn-text-2xs, 11px);
      font-weight: 650;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      user-select: none;
    }

    .menu-custom {
      padding: var(--mn-space-2, 8px);
    }
  `

  @property({ type: String }) label = ''
  @property({ type: String, attribute: 'icon-name' }) iconName: string | undefined
  @property({ type: Array }) entries: readonly MnDropdownEntry[] = []
  @property({ type: String, attribute: 'selected-id' }) selectedId: string | undefined
  @property({ type: String }) variant: MnDropdownVariant = 'default'
  @property({ type: String }) size: MnDropdownSize = 'md'
  @property({ type: Boolean }) disabled = false
  @property({ type: String }) placement: MnDropdownPlacement = 'bottom-start'
  @property({ type: Boolean, reflect: true }) open = false

  @state() private focusedIndex = -1

  @query('.trigger') private triggerEl?: HTMLButtonElement
  @query('.menu-popover') private popoverEl?: HTMLElement

  private listenersAttached = false
  private readonly keyDownHandler = this.handleDocumentKeyDown.bind(this)
  private readonly pointerDownHandler = this.handlePointerDownOutside.bind(this)

  /**
   * Promotes `.menu-popover` to the native top layer (Popover API) so it
   * escapes whatever stacking context its host forms — see the
   * layer-contract campaign diagnosis. Subsumes the old `positionMenu()`
   * clamp/flip math (moved into popover.ts's shared `positionPopover`).
   */
  private readonly menuPopover = new PopoverController(this, {
    anchor: () => this.triggerEl,
    popover: () => this.popoverEl,
    placement: () => this.placement,
    gap: 4,
  })

  override disconnectedCallback(): void {
    // Reconcile `open` before the controller's own hostDisconnected() (fired
    // by super.disconnectedCallback() below) hides the top-layer surface —
    // a disconnected-while-open button must not stay flagged open, or
    // reinsertion would resurrect a stale menu outside the normal
    // trigger-click flow.
    this.closeMenu()
    this.detachListeners()
    super.disconnectedCallback()
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (!changed.has('open')) return
    if (this.open) {
      this.attachListeners()
      this.menuPopover.show()
      if (this.focusedIndex >= 0) void this.updateComplete.then(() => this.focusCurrentItem())
    } else {
      this.detachListeners()
      this.menuPopover.hide()
    }
  }

  private selectableItems(): MenuItemEntry[] {
    return this.entries.filter(isSelectable)
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

  private openMenu(focus: 'none' | 'first' | 'last' = 'none'): void {
    if (this.disabled) return
    const selectable = this.selectableItems()
    if (focus === 'first') this.focusedIndex = selectable.length > 0 ? 0 : -1
    else if (focus === 'last') this.focusedIndex = selectable.length > 0 ? selectable.length - 1 : -1
    else this.focusedIndex = -1
    this.open = true
  }

  private closeMenu(options: { restoreFocus?: boolean } = {}): void {
    if (!this.open) return
    this.open = false
    this.focusedIndex = -1
    this.dispatchEvent(new CustomEvent('mn-close', { bubbles: true, composed: true }))
    if (options.restoreFocus) this.triggerEl?.focus()
  }

  private toggleMenu(event: MouseEvent): void {
    event.stopPropagation()
    if (this.open) this.closeMenu()
    else this.openMenu()
  }

  private handleTriggerKeyDown(event: KeyboardEvent): void {
    if (this.disabled) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.openMenu('first')
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      this.openMenu('last')
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (this.open) this.closeMenu()
      else this.openMenu('first')
    }
  }

  private handleDocumentKeyDown(event: KeyboardEvent): void {
    if (!this.open) return

    const items = this.selectableItems()
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.closeMenu({ restoreFocus: true })
      return
    }
    if (event.key === 'Tab') {
      this.closeMenu()
      return
    }
    if (items.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const current = Math.max(0, this.focusedIndex)
      this.focusedIndex = (current + 1) % items.length
      void this.updateComplete.then(() => this.focusCurrentItem())
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      this.focusedIndex = this.focusedIndex <= 0 ? items.length - 1 : this.focusedIndex - 1
      void this.updateComplete.then(() => this.focusCurrentItem())
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const item = items[this.focusedIndex]
      if (item) this.selectItem(item, modifiersFrom(event))
    }
  }

  private handlePointerDownOutside(event: Event): void {
    if (!this.open) return
    if ((event.composedPath?.() ?? []).includes(this)) return
    this.closeMenu()
  }

  private focusCurrentItem(): void {
    const button = this.renderRoot?.querySelector<HTMLButtonElement>(
      `[data-actionable-index="${this.focusedIndex}"]`,
    )
    button?.focus()
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
    this.closeMenu({ restoreFocus: true })
  }

  private handleItemClick(event: MouseEvent, item: MenuItemEntry): void {
    event.preventDefault()
    event.stopPropagation()
    this.selectItem(item, modifiersFrom(event))
  }

  private handleItemMouseEnter(actionableIndex: number): void {
    if (actionableIndex >= 0) this.focusedIndex = actionableIndex
  }

  private renderDivider(_entry: MenuDivider) {
    return html`<div class="divider" role="separator"></div>`
  }

  private renderHeader(entry: MenuHeader) {
    return html`<div class="menu-header" role="presentation">${entry.content}</div>`
  }

  private renderCustom(entry: MenuCustomEntry) {
    return html`<div class="menu-custom" role="presentation">${entry.render()}</div>`
  }

  private renderItem(item: MenuItemEntry, actionableIndex: number) {
    const focused = actionableIndex >= 0 && actionableIndex === this.focusedIndex
    const selected = item.id === this.selectedId
    const role = item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'

    return html`
      <button
        class=${classMap({
          'menu-item': true,
          focused,
          selected,
          danger: item.variant === 'danger',
          disabled: !!item.disabled,
        })}
        role=${role}
        data-menu-item-id=${item.id}
        data-actionable-index=${item.disabled ? '' : String(actionableIndex)}
        tabindex=${focused ? 0 : -1}
        ?disabled=${item.disabled}
        aria-current=${selected ? 'true' : nothing}
        aria-checked=${item.checked === undefined ? nothing : String(item.checked)}
        @click=${(event: MouseEvent) => this.handleItemClick(event, item)}
        @mouseenter=${() => this.handleItemMouseEnter(actionableIndex)}
      >
        ${item.checked !== undefined
          ? html`
              <span class=${classMap({ 'item-check': true, empty: !item.checked })} aria-hidden="true">
                ${item.checked ? icon('check', { size: 14 }) : nothing}
              </span>
            `
          : nothing}
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
  }

  private renderEntry(entry: MenuEntry, index: number) {
    if (isDivider(entry)) return this.renderDivider(entry)
    if (isHeader(entry)) return this.renderHeader(entry)
    if (isCustom(entry)) return this.renderCustom(entry)

    let actionableIndex = -1
    if (!entry.disabled) {
      actionableIndex = this.entries.slice(0, index + 1).filter(isSelectable).length - 1
    }
    return this.renderItem(entry, actionableIndex)
  }

  override render() {
    const triggerClasses = {
      trigger: true,
      [`variant-${this.variant}`]: true,
      [`size-${this.size}`]: true,
    }

    return html`
      <button
        class=${classMap(triggerClasses)}
        type="button"
        ?disabled=${this.disabled}
        aria-haspopup="menu"
        aria-expanded=${String(this.open)}
        @click=${this.toggleMenu}
        @keydown=${this.handleTriggerKeyDown}
      >
        ${this.iconName
          ? html`<span class="trigger-icon" aria-hidden="true">${icon(this.iconName, { size: 14 })}</span>`
          : nothing}
        ${this.label ? html`<span class="trigger-label">${this.label}</span>` : nothing}
        <span class="trigger-caret" aria-hidden="true">${icon('chevron-down', { size: 14 })}</span>
      </button>

      <div class="menu-popover" popover="manual" aria-hidden=${String(!this.open)}>
        <div class="menu-panel" role="menu" aria-label=${this.label || 'Menu'}>
          ${this.entries.map((entry, index) => this.renderEntry(entry, index))}
        </div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-dropdown-button': MnDropdownButton
  }
}
