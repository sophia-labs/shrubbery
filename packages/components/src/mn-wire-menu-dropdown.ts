/**
 * mn-wire-menu-dropdown - Garden's existing-wire dropdown, shell-neutral.
 *
 * The component owns only the transient surface: rows, focus, and local close
 * behavior. Runtime/store concerns stay outside and arrive as controlled data.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnWireMenuType = 'block' | 'document'
export type MnWireMenuDirection = 'flat' | 'outgoing' | 'incoming'

export interface MnWireMenuWire {
  readonly id: string
  readonly predicate?: string
  readonly predicateLabel?: string
  readonly otherDocumentId: string
  readonly otherGraphId?: string
  readonly otherBlockId?: string
  readonly localBlockId?: string
  readonly otherTitle?: string
  readonly otherSnippet?: string
  readonly localSnippet?: string
  readonly bidirectional?: boolean
  readonly snapshotAt?: string
}

export interface MnWireMenuActionDetail {
  readonly wire: MnWireMenuWire
  readonly direction: MnWireMenuDirection
}

export interface MnWireMenuAddDetail {
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}

interface WireSection {
  readonly label: string
  readonly direction: MnWireMenuDirection
  readonly wires: readonly MnWireMenuWire[]
}

function stop(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
}

@customElement('mn-wire-menu-dropdown')
export class MnWireMenuDropdown extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: none;
      min-width: var(--mn-wire-menu-min-width, 280px);
      max-width: min(var(--mn-wire-menu-max-width, 420px), calc(100vw - var(--mn-space-4, 16px)));
      box-sizing: border-box;
      color: var(--mn-color-text-primary, #111827);
      font: var(--mn-text-sm, 13px) / 1.35 var(--mn-font-chrome, system-ui, sans-serif);
    }

    :host([open]) {
      display: block;
    }

    .menu {
      width: 100%;
      max-height: min(68vh, calc(100dvh - var(--mn-space-6, 24px)));
      padding: var(--mn-space-1, 4px);
      overflow: auto;
      box-sizing: border-box;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-raised, #fff);
      box-shadow: var(--mn-shadow-lg, 0 18px 40px rgba(15, 23, 42, 0.16));
    }

    .header {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      min-height: 30px;
      padding: 0 var(--mn-space-2, 8px);
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 700;
    }

    .header-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .header-actions {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      margin-left: auto;
    }

    .icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-muted, #6b7280);
      cursor: pointer;
    }

    .icon-button:hover,
    .icon-button:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }

    .icon-button.danger {
      color: var(--mn-color-danger-700, #b91c1c);
    }

    .icon-button.danger:hover,
    .icon-button.danger:focus-visible {
      background: var(--mn-color-danger-50, #fef2f2);
      color: var(--mn-color-danger-700, #b91c1c);
    }

    .section {
      display: grid;
      gap: 1px;
      margin-top: var(--mn-space-1, 4px);
    }

    .section:first-of-type {
      margin-top: 0;
    }

    .section-title {
      padding: var(--mn-space-1, 4px) var(--mn-space-2, 8px);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-type-ui-xs-size, 11px);
      font-weight: 700;
    }

    .list {
      display: grid;
      gap: 1px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      min-height: 42px;
      padding: 2px;
      border-radius: var(--mn-radius-md, 6px);
    }

    .item:hover,
    .item:focus-within {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .navigate {
      display: grid;
      grid-template-columns: 16px minmax(0, 1fr);
      align-items: center;
      gap: var(--mn-space-2, 8px);
      min-width: 0;
      width: 100%;
      min-height: 38px;
      padding: var(--mn-space-1, 4px) var(--mn-space-2, 8px);
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      text-align: left;
    }

    .navigate:hover,
    .navigate:focus-visible {
      background: var(--mn-color-surface-active, rgba(15, 23, 42, 0.08));
      outline: none;
    }

    .link-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--mn-color-text-muted, #6b7280);
    }

    .copy {
      min-width: 0;
    }

    .title {
      display: block;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta {
      display: flex;
      min-width: 0;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      margin-top: 1px;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
    }

    .predicate {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .direction {
      color: var(--mn-color-text-muted, #6b7280);
      font-weight: 650;
    }

    .snippet {
      margin-top: 2px;
      overflow: hidden;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      font-style: italic;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .empty,
    .loading {
      padding: var(--mn-space-4, 16px) var(--mn-space-2, 8px);
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-align: center;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  `

  @property({ type: Boolean, reflect: true }) open = false
  @property({ type: String }) menuType: MnWireMenuType = 'block'
  @property({ type: Boolean }) loading = false
  @property({ type: Boolean }) showAdd = false
  @property({ type: String }) hereTitle = 'Current document'
  @property({ type: String }) emptyLabel = ''
  @property({ attribute: false }) wires: readonly MnWireMenuWire[] = []
  @property({ attribute: false }) outgoingWires: readonly MnWireMenuWire[] = []
  @property({ attribute: false }) incomingWires: readonly MnWireMenuWire[] = []

  @query('[data-wire-navigate]') private firstNavigateButton?: HTMLButtonElement

  private focusPending = false

  override connectedCallback(): void {
    super.connectedCallback()
    document.addEventListener('keydown', this.handleDocumentKeydown, true)
  }

  override disconnectedCallback(): void {
    document.removeEventListener('keydown', this.handleDocumentKeydown, true)
    super.disconnectedCallback()
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (
      (changed.has('open') || changed.has('wires') || changed.has('outgoingWires') || changed.has('incomingWires')) &&
      this.open
    ) {
      this.focusPending = true
    }
    if (this.focusPending) {
      this.focusPending = false
      window.setTimeout(() => this.firstNavigateButton?.focus(), 0)
    }
  }

  show(): void {
    this.open = true
  }

  hide(): void {
    this.close()
  }

  private get totalWires(): number {
    return this.wires.length + this.outgoingWires.length + this.incomingWires.length
  }

  private get sections(): readonly WireSection[] {
    if (this.wires.length > 0) {
      return [{ label: 'Existing wires', direction: 'flat', wires: this.wires }]
    }
    const sections: WireSection[] = []
    if (this.outgoingWires.length > 0) {
      sections.push({ label: `Outgoing (${this.outgoingWires.length})`, direction: 'outgoing', wires: this.outgoingWires })
    }
    if (this.incomingWires.length > 0) {
      sections.push({ label: `Incoming (${this.incomingWires.length})`, direction: 'incoming', wires: this.incomingWires })
    }
    return sections
  }

  private get headerLabel(): string {
    if (this.loading && this.menuType === 'block') return 'Wires'
    const count = this.totalWires
    return this.menuType === 'document' ? `Document Wires (${count})` : `Wires (${count})`
  }

  private get resolvedEmptyLabel(): string {
    if (this.emptyLabel) return this.emptyLabel
    return this.menuType === 'document' ? 'No document-level wires' : 'No wires from this block'
  }

  private handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (!this.open) return
    if (event.key === 'Escape') {
      stop(event)
      this.close()
    }
  }

  private close(): void {
    if (!this.open) return
    this.open = false
    this.dispatchEvent(new CustomEvent('mn-close', { bubbles: true, composed: true }))
  }

  private add(event: MouseEvent): void {
    stop(event)
    this.dispatchEvent(
      new CustomEvent<MnWireMenuAddDetail>('mn-wire-menu-add', {
        detail: {
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
        },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private navigate(wire: MnWireMenuWire, direction: MnWireMenuDirection, event: Event): void {
    stop(event)
    this.dispatchEvent(
      new CustomEvent<MnWireMenuActionDetail>('mn-wire-menu-navigate', {
        detail: { wire, direction },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private delete(wire: MnWireMenuWire, direction: MnWireMenuDirection, event: Event): void {
    stop(event)
    this.dispatchEvent(
      new CustomEvent<MnWireMenuActionDetail>('mn-wire-menu-delete', {
        detail: { wire, direction },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private wireTitle(wire: MnWireMenuWire): string {
    return wire.otherTitle?.trim() || wire.otherDocumentId || wire.id
  }

  private wirePredicate(wire: MnWireMenuWire): string {
    return wire.predicateLabel?.trim() || wire.predicate?.trim() || 'related'
  }

  private directionLabel(direction: MnWireMenuDirection): string | null {
    if (direction === 'outgoing') return 'To'
    if (direction === 'incoming') return 'From'
    return null
  }

  private renderHeader(): TemplateResult {
    return html`
      <div class="header">
        <span class="link-icon" aria-hidden="true">${icon('git-branch', { size: 14 })}</span>
        <span class="header-label">${this.headerLabel}</span>
        <div class="header-actions">
          ${this.showAdd
            ? html`
                <button
                  type="button"
                  class="icon-button"
                  title="Add wire"
                  aria-label="Add wire"
                  data-wire-menu-add
                  @click=${(event: MouseEvent) => this.add(event)}
                  @mousedown=${stop}
                >
                  ${icon('plus', { size: 14 })}
                </button>
              `
            : nothing}
        </div>
      </div>
    `
  }

  private renderWire(wire: MnWireMenuWire, direction: MnWireMenuDirection): TemplateResult {
    const label = this.directionLabel(direction)
    const snippet = wire.otherSnippet || wire.localSnippet || ''
    const title = this.wireTitle(wire)
    return html`
      <li class="item" role="none" data-wire-menu-item data-wire-id=${wire.id}>
        <button
          type="button"
          class="navigate"
          role="menuitem"
          data-wire-navigate
          @click=${(event: Event) => this.navigate(wire, direction, event)}
          @mousedown=${stop}
        >
          <span class="link-icon" aria-hidden="true">${icon('wire', { size: 14 })}</span>
          <span class="copy">
            <span class="title">${title}</span>
            <span class="meta">
              ${label ? html`<span class="direction">${label}</span>` : nothing}
              <span class="predicate">${this.wirePredicate(wire)}</span>
              ${wire.otherBlockId ? html`<span>Block</span>` : html`<span>Document</span>`}
            </span>
            ${snippet ? html`<span class="snippet">${snippet}</span>` : nothing}
          </span>
        </button>
        <button
          type="button"
          class="icon-button danger"
          title=${`Delete wire ${wire.id}`}
          aria-label=${`Delete wire ${title}`}
          data-wire-delete
          @click=${(event: Event) => this.delete(wire, direction, event)}
          @mousedown=${stop}
        >
          ${icon('trash', { size: 14 })}
          <span class="sr-only">Delete</span>
        </button>
      </li>
    `
  }

  private renderSection(section: WireSection): TemplateResult {
    return html`
      <section class="section">
        ${this.wires.length === 0 ? html`<div class="section-title">${section.label}</div>` : nothing}
        <ul class="list" role="menu" aria-label=${section.label}>
          ${section.wires.map(wire => this.renderWire(wire, section.direction))}
        </ul>
      </section>
    `
  }

  override render() {
    if (!this.open) return nothing
    const sections = this.sections
    return html`
      <div class="menu" data-wire-menu-dropdown @mousedown=${(event: Event) => event.stopPropagation()}>
        ${this.renderHeader()}
        ${this.loading
          ? html`<div class="loading">Loading wires...</div>`
          : sections.length === 0
            ? html`<div class="empty">${this.resolvedEmptyLabel}</div>`
            : sections.map(section => this.renderSection(section))}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-wire-menu-dropdown': MnWireMenuDropdown
  }
}
