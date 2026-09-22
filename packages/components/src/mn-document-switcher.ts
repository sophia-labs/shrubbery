/**
 * mn-document-switcher - controlled global search / command palette.
 *
 * Garden's original switcher owns filesystem-store subscriptions, block search,
 * semantic index setup, command-registry execution, and wire completion. This
 * Shrubbery lift keeps the palette UI and keyboard behavior only: callers provide
 * document/block/action rows and receive composed intents for all host work.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import type { MenuEntry, MenuSelectDetail } from '@shrubbery/nucleus'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import './mn-context-menu.js'
import type { MnContextMenu } from './mn-context-menu.js'

export type MnDocumentSwitcherScope = 'all' | 'documents' | 'blocks' | 'actions'
export type MnDocumentSwitcherSort = 'smart' | 'exact' | 'alphabetical'
export type MnDocumentSwitcherStatus = 'idle' | 'loading' | 'indexing' | 'wiring' | 'error'
export type MnDocumentSwitcherMatchSource = 'lexical' | 'semantic' | 'both' | 'hybrid' | string

export interface MnDocumentSwitcherDocumentItem {
  readonly kind: 'document'
  readonly id: string
  readonly documentId?: string | null
  readonly graphId?: string | null
  readonly label: string
  readonly path?: string | null
  readonly readOnly?: boolean
  readonly score?: number
  readonly compositeScore?: number
}

export interface MnDocumentSwitcherBlockItem {
  readonly kind: 'block'
  readonly id: string
  readonly documentId: string
  readonly blockId: string
  readonly graphId?: string | null
  readonly label: string
  readonly snippet?: string | null
  readonly path?: string | null
  readonly matchSource?: MnDocumentSwitcherMatchSource | null
  readonly score?: number
  readonly compositeScore?: number
}

export type MnDocumentSwitcherItem = MnDocumentSwitcherDocumentItem | MnDocumentSwitcherBlockItem

export interface MnDocumentSwitcherAction {
  readonly id: string
  readonly label: string
  readonly category?: string | null
  readonly icon?: string | null
  readonly shortcut?: string | null
  readonly disabled?: boolean
}

export interface MnDocumentSwitcherQueryDetail {
  readonly query: string
  readonly scope: MnDocumentSwitcherScope
}

export interface MnDocumentSwitcherScopeDetail {
  readonly scope: MnDocumentSwitcherScope
}

export interface MnDocumentSwitcherSortDetail {
  readonly sort: MnDocumentSwitcherSort
}

export interface MnDocumentSwitcherOpenDocumentDetail {
  readonly graphId: string | null
  readonly documentId: string
  readonly item: MnDocumentSwitcherDocumentItem | MnDocumentSwitcherBlockItem
}

export interface MnDocumentSwitcherOpenBlockDetail extends MnDocumentSwitcherOpenDocumentDetail {
  readonly blockId: string
}

export interface MnDocumentSwitcherIntentDetail {
  readonly graphId: string | null
  readonly documentId: string
  readonly item: MnDocumentSwitcherItem
}

export interface MnDocumentSwitcherActionDetail {
  readonly actionId: string
  readonly action: MnDocumentSwitcherAction
}

export interface MnDocumentSwitcherWireTargetDetail {
  readonly graphId: string | null
  readonly documentId: string
  readonly blockId?: string
  readonly item: MnDocumentSwitcherItem
}

function trimmed(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function itemKey(item: MnDocumentSwitcherItem, index: number): string {
  return item.id || `${item.kind}-${index}`
}

function badgeFor(item: MnDocumentSwitcherItem): string {
  if (item.kind === 'document') return 'doc'
  const source = trimmed(item.matchSource).toLowerCase()
  if (source === 'both') return 'hybrid'
  if (source === 'semantic' || source === 'hybrid') return source
  return 'block'
}

@customElement('mn-document-switcher')
export class MnDocumentSwitcher extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: none;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    :host([open]) {
      display: block;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      z-index: var(--mn-z-modal-backdrop, 1300);
      background: var(--mn-color-surface-overlay, rgba(15, 23, 42, 0.34));
    }

    .container {
      position: fixed;
      top: 12%;
      left: 50%;
      z-index: var(--mn-z-modal, 1400);
      display: flex;
      width: min(92vw, 740px);
      max-height: min(72vh, 680px);
      min-height: 240px;
      overflow: hidden;
      flex-direction: column;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-base, #fff);
      box-shadow: var(--mn-shadow-xl, 0 24px 80px rgba(15, 23, 42, 0.24));
      transform: translateX(-50%);
      box-sizing: border-box;
    }

    .input-row {
      display: flex;
      min-height: 58px;
      flex: 0 0 auto;
      align-items: center;
      gap: var(--mn-space-3, 12px);
      padding: 0 var(--mn-space-4, 16px);
      border-bottom: 1px solid var(--mn-color-border-default, #d1d5db);
      box-sizing: border-box;
    }

    .leading-icon {
      display: inline-flex;
      width: 22px;
      flex: 0 0 auto;
      justify-content: center;
      color: var(--mn-color-text-muted, #6b7280);
    }

    .semantic-button,
    .scope-button,
    .sort-button {
      display: inline-flex;
      min-height: 28px;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-control, 6px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-secondary, #374151);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      box-sizing: border-box;
    }

    .semantic-button {
      width: 30px;
      padding: 0;
    }

    .scope-button,
    .sort-button {
      padding: 0 9px;
    }

    .semantic-button:hover,
    .scope-button:hover,
    .sort-button:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    .semantic-button[aria-pressed='true'],
    .scope-button[data-active='true'],
    .sort-button[data-active='true'] {
      border-color: var(--mn-color-border-accent, #93c5fd);
      background: var(--mn-color-surface-accent, #eff6ff);
      color: var(--mn-color-text-accent, #1d4ed8);
      font-weight: 700;
    }

    .input {
      flex: 1 1 auto;
      min-width: 0;
      border: 0;
      outline: none;
      background: transparent;
      color: var(--mn-color-text-primary, #111827);
      font: inherit;
      font-size: var(--mn-text-md, 15px);
    }

    .input::placeholder {
      color: var(--mn-color-text-tertiary, #9ca3af);
    }

    .controls {
      display: flex;
      min-height: 48px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-2, 8px) var(--mn-space-4, 16px);
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-sunken, #f8fafc);
      box-sizing: border-box;
    }

    .scope-group,
    .sort-group {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
    }

    .status {
      min-width: 120px;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-align: right;
      white-space: nowrap;
    }

    .status[data-tone='error'] {
      color: var(--mn-color-danger, #dc2626);
    }

    .results {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
    }

    .empty {
      display: grid;
      min-height: 160px;
      align-content: center;
      justify-content: center;
      padding: var(--mn-space-6, 24px);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-md, 15px);
      text-align: center;
    }

    .row {
      display: flex;
      min-height: 56px;
      align-items: flex-start;
      gap: var(--mn-space-3, 12px);
      padding: 10px 14px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: transparent;
      cursor: pointer;
      box-sizing: border-box;
    }

    .row:hover,
    .row[data-selected='true'] {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }

    .row[data-selected='true'] {
      background: var(--mn-color-surface-accent, #eff6ff);
    }

    .row-icon {
      display: inline-flex;
      width: 20px;
      height: 20px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      margin-top: 1px;
      color: var(--mn-color-text-muted, #6b7280);
    }

    .row-content {
      display: flex;
      min-width: 0;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 2px;
    }

    .row-top {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: var(--mn-space-2, 8px);
    }

    .row-label {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .badge {
      display: inline-flex;
      min-height: 20px;
      flex: 0 0 auto;
      align-items: center;
      padding: 0 6px;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: 999px;
      background: var(--mn-color-surface-sunken, #f8fafc);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-2xs, 11px);
      font-weight: 700;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .badge[data-tone='semantic'] {
      border-color: var(--mn-color-border-accent, #93c5fd);
      background: var(--mn-color-surface-accent, #eff6ff);
      color: var(--mn-color-text-accent, #1d4ed8);
    }

    .row-snippet,
    .row-path {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row-path {
      color: var(--mn-color-text-tertiary, #6b7280);
    }

    .hint {
      display: flex;
      flex: 0 0 auto;
      flex-wrap: wrap;
      justify-content: center;
      gap: var(--mn-space-4, 16px);
      padding: 9px 16px;
      border-top: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
    }

    kbd {
      display: inline-flex;
      min-height: 18px;
      align-items: center;
      padding: 0 5px;
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-sunken, #f8fafc);
      color: var(--mn-color-text-secondary, #374151);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 11px);
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    :host([data-skin='emporium']) .container {
      border-radius: var(--mn-radius-control, 4px);
    }

    :host([data-skin='emporium']) .semantic-button,
    :host([data-skin='emporium']) .scope-button,
    :host([data-skin='emporium']) .sort-button {
      border-radius: var(--mn-radius-control, 4px);
    }

    @media (max-width: 760px) {
      .container {
        top: 0;
        left: 0;
        width: 100vw;
        max-height: 70vh;
        min-height: 240px;
        border-radius: 0 0 var(--mn-radius-lg, 8px) var(--mn-radius-lg, 8px);
        transform: none;
      }

      .controls {
        align-items: flex-start;
        flex-direction: column;
      }

      .status {
        width: 100%;
        min-width: 0;
        text-align: left;
      }

      .hint {
        display: none;
      }
    }
  `

  @property({ type: Boolean, reflect: true }) open = false
  @property({ type: String }) query = ''
  @property({ type: String }) scope: MnDocumentSwitcherScope = 'all'
  @property({ type: String }) sort: MnDocumentSwitcherSort = 'smart'
  @property({ type: Boolean, attribute: 'semantic-enabled' }) semanticEnabled = true
  @property({ type: Boolean, attribute: 'wire-mode' }) wireMode = false
  @property({ type: String }) status: MnDocumentSwitcherStatus = 'idle'
  @property({ type: String }) statusText = ''
  @property({ type: String }) graphId = ''
  @property({ type: Number }) selectedIndex = 0
  @property({ attribute: false }) items: readonly MnDocumentSwitcherItem[] = []
  @property({ attribute: false }) actions: readonly MnDocumentSwitcherAction[] = []

  @state() private _contextItem: MnDocumentSwitcherItem | null = null

  @query('.input') private inputEl?: HTMLInputElement
  @query('mn-context-menu') private contextMenu?: MnContextMenu

  protected updated(changed: PropertyValues<this>): void {
    if (changed.has('open') && this.open) {
      void this.updateComplete.then(() => this.inputEl?.focus())
    }
    if (changed.has('items') || changed.has('actions') || changed.has('scope')) {
      this.selectedIndex = this._clampedIndex(this.selectedIndex)
    }
    if (
      this.open
      && this.scope !== 'actions'
      && (
        changed.has('open')
        || changed.has('items')
        || changed.has('selectedIndex')
        || changed.has('scope')
      )
    ) {
      this._intentItem(this.items[this.selectedIndex])
    }
  }

  private _emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }))
  }

  private _graphIdFor(item?: MnDocumentSwitcherItem): string | null {
    return trimmed(item?.graphId) || trimmed(this.graphId) || null
  }

  private _visibleActions(): readonly MnDocumentSwitcherAction[] {
    return this.actions.filter((action) => !action.disabled)
  }

  private _listLength(): number {
    return this.scope === 'actions' ? this._visibleActions().length : this.items.length
  }

  private _clampedIndex(index: number): number {
    const length = this._listLength()
    if (length <= 0) return 0
    return Math.max(0, Math.min(index, length - 1))
  }

  private _statusText(): string {
    if (this.statusText) return this.statusText
    switch (this.status) {
      case 'loading':
        return 'Searching blocks...'
      case 'indexing':
        return 'Indexing local embeddings...'
      case 'wiring':
        return 'Creating wire...'
      case 'error':
        return 'Search failed'
      default:
        return ''
    }
  }

  private _emptyText(): string {
    if (this.scope === 'actions') return 'No matching actions'
    if (trimmed(this.query).length < 2 && this.scope !== 'documents') return 'Type at least 2 characters to search blocks'
    return 'No results found'
  }

  private _close(): void {
    if (this.scope !== 'actions') this._endIntentItem(this.items[this.selectedIndex])
    this.open = false
    this._emit('mn-document-switcher-close', {})
  }

  private _queryChanged(event: Event): void {
    this.query = (event.target as HTMLInputElement).value
    this.selectedIndex = 0
    this._emit<MnDocumentSwitcherQueryDetail>('mn-document-switcher-query-change', {
      query: this.query,
      scope: this.scope,
    })
  }

  private _setScope(scope: MnDocumentSwitcherScope): void {
    if (this.scope === scope) return
    this.scope = scope
    this.selectedIndex = 0
    this._emit<MnDocumentSwitcherScopeDetail>('mn-document-switcher-scope-change', { scope })
  }

  private _setSort(sort: MnDocumentSwitcherSort): void {
    if (this.sort === sort) return
    this.sort = sort
    this._emit<MnDocumentSwitcherSortDetail>('mn-document-switcher-sort-change', { sort })
  }

  private _toggleSemantic(): void {
    this.semanticEnabled = !this.semanticEnabled
    this.selectedIndex = 0
    this._emit('mn-document-switcher-semantic-toggle', { enabled: this.semanticEnabled })
  }

  private _selectAction(action: MnDocumentSwitcherAction | undefined): void {
    if (!action || action.disabled) return
    this._emit<MnDocumentSwitcherActionDetail>('mn-document-switcher-run-action', {
      actionId: action.id,
      action,
    })
    this._close()
  }

  private _intentItem(item: MnDocumentSwitcherItem | undefined): void {
    if (!item) return
    this._emit<MnDocumentSwitcherIntentDetail>('mn-document-switcher-document-intent', {
      graphId: this._graphIdFor(item),
      documentId: item.kind === 'document'
        ? trimmed(item.documentId) || item.id
        : item.documentId,
      item,
    })
  }

  private _endIntentItem(item: MnDocumentSwitcherItem | undefined): void {
    if (!item) return
    this._emit<MnDocumentSwitcherIntentDetail>('mn-document-switcher-document-intent-end', {
      graphId: this._graphIdFor(item),
      documentId: item.kind === 'document'
        ? trimmed(item.documentId) || item.id
        : item.documentId,
      item,
    })
  }

  private _openItem(item: MnDocumentSwitcherItem | undefined, split = false): void {
    if (!item) return
    if (item.kind === 'document') {
      const documentId = trimmed(item.documentId) || item.id
      const detail: MnDocumentSwitcherOpenDocumentDetail = {
        graphId: this._graphIdFor(item),
        documentId,
        item,
      }
      this._emit<MnDocumentSwitcherOpenDocumentDetail>(
        split ? 'mn-document-switcher-open-document-split' : 'mn-document-switcher-open-document',
        detail,
      )
      this._emit('document-open', detail)
      if (split) this._emit('document-open-split', { graphId: detail.graphId, docId: documentId, documentId })
    } else {
      const detail: MnDocumentSwitcherOpenBlockDetail = {
        graphId: this._graphIdFor(item),
        documentId: item.documentId,
        blockId: item.blockId,
        item,
      }
      this._emit<MnDocumentSwitcherOpenBlockDetail>('mn-document-switcher-open-block', detail)
      this._emit('document-open', detail)
    }
    this._close()
  }

  private _wireItem(item: MnDocumentSwitcherItem | undefined): void {
    if (!item) return
    const detail: MnDocumentSwitcherWireTargetDetail = item.kind === 'document'
      ? {
          graphId: this._graphIdFor(item),
          documentId: trimmed(item.documentId) || item.id,
          item,
        }
      : {
          graphId: this._graphIdFor(item),
          documentId: item.documentId,
          blockId: item.blockId,
          item,
        }
    this._emit<MnDocumentSwitcherWireTargetDetail>('mn-document-switcher-wire-target', detail)
  }

  private _selectItem(item: MnDocumentSwitcherItem | undefined, forceOpen = false): void {
    if (!item) return
    if (this.wireMode && !forceOpen) {
      this._wireItem(item)
      return
    }
    this._openItem(item)
  }

  private _handleKeydown(event: KeyboardEvent): void {
    if (!this.open) return

    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 's' && this.scope !== 'actions') {
      event.preventDefault()
      this._toggleSemantic()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      this._close()
      return
    }

    const length = this._listLength()
    if (length <= 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.selectedIndex = this._clampedIndex(this.selectedIndex + 1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      this.selectedIndex = this._clampedIndex(this.selectedIndex - 1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (this.scope === 'actions') {
        this._selectAction(this._visibleActions()[this.selectedIndex])
      } else {
        this._selectItem(this.items[this.selectedIndex], event.metaKey || event.ctrlKey)
      }
    }
  }

  private _itemIcon(item: MnDocumentSwitcherItem): string {
    if (item.kind === 'block') return 'hash'
    return 'file-text'
  }

  private _renderItem(item: MnDocumentSwitcherItem, index: number): TemplateResult {
    const selected = index === this.selectedIndex
    const badge = badgeFor(item)
    const semanticBadge = badge === 'semantic' || badge === 'hybrid'
    return html`
      <div
        class="row"
        role="option"
        data-selected=${selected ? 'true' : 'false'}
        aria-selected=${selected ? 'true' : 'false'}
        data-item-id=${item.id}
        @click=${() => this._selectItem(item)}
        @mouseenter=${() => {
          this.selectedIndex = index
          this._intentItem(item)
        }}
        @contextmenu=${(event: MouseEvent) => this._openContextMenu(event, item)}
      >
        <span class="row-icon" aria-hidden="true">${icon(this._itemIcon(item), { size: 16 })}</span>
        <span class="row-content">
          <span class="row-top">
            <span class="row-label">${item.label}</span>
            <span class="badge" data-tone=${semanticBadge ? 'semantic' : 'default'}>${badge}</span>
          </span>
          ${item.kind === 'block' && trimmed(item.snippet)
            ? html`<span class="row-snippet">${item.snippet}</span>`
            : nothing}
          ${trimmed(item.path) ? html`<span class="row-path">${item.path}</span>` : nothing}
        </span>
      </div>
    `
  }

  private _renderAction(action: MnDocumentSwitcherAction, index: number): TemplateResult {
    const selected = index === this.selectedIndex
    return html`
      <div
        class="row"
        role="option"
        data-selected=${selected ? 'true' : 'false'}
        aria-selected=${selected ? 'true' : 'false'}
        data-action-id=${action.id}
        @click=${() => this._selectAction(action)}
        @mouseenter=${() => { this.selectedIndex = index }}
      >
        <span class="row-icon" aria-hidden="true">${icon(action.icon || 'zap', { size: 16 })}</span>
        <span class="row-content">
          <span class="row-top">
            <span class="row-label">${action.label}</span>
            ${trimmed(action.category) ? html`<span class="badge">${action.category}</span>` : nothing}
            ${trimmed(action.shortcut) ? html`<span class="badge">${action.shortcut}</span>` : nothing}
          </span>
        </span>
      </div>
    `
  }

  private _openContextMenu(event: MouseEvent, item: MnDocumentSwitcherItem): void {
    event.preventDefault()
    event.stopPropagation()
    this._contextItem = item
    const entries: MenuEntry[] = [
      { id: 'open', label: 'Open', icon: 'file-text' },
      { id: 'open-split', label: 'Open in split view', icon: 'panel-left', disabled: item.kind !== 'document' },
      { type: 'divider' },
      { id: 'wire-to', label: 'Wire to this item', icon: 'wire' },
    ]
    if (!this.contextMenu) return
    this.contextMenu.items = entries
    this.contextMenu.show({ x: event.clientX, y: event.clientY })
  }

  private _handleContextSelect(event: CustomEvent<MenuSelectDetail>): void {
    const item = this._contextItem
    if (!item) return
    switch (event.detail.id) {
      case 'open':
        this._openItem(item)
        break
      case 'open-split':
        this._openItem(item, true)
        break
      case 'wire-to':
        this._wireItem(item)
        break
    }
  }

  private _renderScopeButton(scope: MnDocumentSwitcherScope, label: string): TemplateResult {
    return html`
      <button
        type="button"
        class="scope-button"
        data-active=${this.scope === scope ? 'true' : 'false'}
        @click=${() => this._setScope(scope)}
      >${label}</button>
    `
  }

  private _renderSortButton(sort: MnDocumentSwitcherSort, label: string): TemplateResult {
    return html`
      <button
        type="button"
        class="sort-button"
        data-active=${this.sort === sort ? 'true' : 'false'}
        @click=${() => this._setSort(sort)}
      >${label}</button>
    `
  }

  render(): TemplateResult | typeof nothing {
    if (!this.open) return nothing
    const actionsMode = this.scope === 'actions'
    const statusText = this._statusText()
    const resultCount = actionsMode ? this._visibleActions().length : this.items.length
    return html`
      <div class="backdrop" @click=${this._close}></div>
      <section
        class="container"
        role="dialog"
        aria-modal="true"
        aria-label=${actionsMode ? 'Run a command' : 'Search graph'}
        @keydown=${this._handleKeydown}
      >
        <div class="input-row">
          <span class="leading-icon" aria-hidden="true">${icon(actionsMode ? 'zap' : 'search', { size: 18 })}</span>
          ${actionsMode
            ? nothing
            : html`
                <button
                  type="button"
                  class="semantic-button"
                  title="Fuzzy search"
                  aria-label="Fuzzy search"
                  aria-pressed=${this.semanticEnabled ? 'true' : 'false'}
                  @click=${this._toggleSemantic}
                >${icon('search', { size: 14 })}</button>
              `}
          <input
            class="input"
            type="text"
            placeholder=${actionsMode ? 'Run a command...' : 'Search graph...'}
            aria-label=${actionsMode ? 'Run a command' : 'Search graph'}
            .value=${this.query}
            @input=${this._queryChanged}
            autofocus
          />
        </div>

        <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          ${resultCount > 0 ? `${resultCount} result${resultCount === 1 ? '' : 's'}` : this._emptyText()}
        </div>

        <div class="controls">
          <div class="scope-group" role="group" aria-label="Search scope">
            ${this._renderScopeButton('actions', 'Actions')}
            ${this._renderScopeButton('all', 'All')}
            ${this._renderScopeButton('documents', 'Documents')}
            ${this._renderScopeButton('blocks', 'Blocks')}
          </div>
          <div class="sort-group" role="group" aria-label="Sort results">
            ${actionsMode
              ? nothing
              : html`
                  ${this._renderSortButton('smart', 'Smart')}
                  ${this._renderSortButton('exact', 'Exact')}
                  ${this._renderSortButton('alphabetical', 'A-Z')}
                `}
            <span class="status" data-tone=${this.status === 'error' ? 'error' : 'default'}>${statusText}</span>
          </div>
        </div>

        <div class="results" role="listbox" aria-label=${actionsMode ? 'Actions' : 'Search results'}>
          ${resultCount === 0
            ? html`<div class="empty" role="status">${this._emptyText()}</div>`
            : actionsMode
              ? this._visibleActions().map((action, index) => this._renderAction(action, index))
              : repeat(this.items, itemKey, (item, index) => this._renderItem(item, index))}
        </div>

        <div class="hint">
          <span><kbd>Up/Down</kbd> navigate</span>
          <span><kbd>Enter</kbd> ${actionsMode ? 'run' : (this.wireMode ? 'wire' : 'open')}</span>
          ${!actionsMode && this.wireMode ? html`<span><kbd>Mod+Enter</kbd> open</span>` : nothing}
          <span><kbd>Esc</kbd> close</span>
          ${!actionsMode ? html`<span><kbd>Mod+Shift+S</kbd> fuzzy</span>` : nothing}
        </div>
      </section>
      <mn-context-menu @mn-select=${this._handleContextSelect}></mn-context-menu>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-document-switcher': MnDocumentSwitcher
  }
}
