/**
 * mn-zotero-library-panel - controlled Zotero library browser.
 *
 * Garden's original panel queried Zotero through ApiClient, managed debounce,
 * lazy-loaded collection items, and dispatched a global open-source event.
 * Shrubbery keeps the browsable panel only: callers provide search results,
 * top-level items, collections, expanded state, and collection rows, then handle
 * query/toggle/open intents outside this component.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export interface MnZoteroLibraryItem {
  readonly key: string
  readonly title: string
  readonly citation?: string
  readonly itemType?: string
  readonly creatorSummary?: string
  readonly year?: string
}

export interface MnZoteroCollection {
  readonly key: string
  readonly name: string
  readonly parentKey?: string | null
  readonly itemCount?: number | null
}

export interface MnZoteroLibrarySearchDetail {
  readonly query: string
}

export interface MnZoteroLibraryToggleCollectionDetail {
  readonly key: string
  readonly collection: MnZoteroCollection
  readonly expanded: boolean
}

export type MnZoteroLibraryOpenSourceOrigin = 'search' | 'top' | 'collection'

export interface MnZoteroLibraryOpenSourceDetail {
  readonly item: MnZoteroLibraryItem
  readonly zoteroKey: string
  readonly artifactId: string
  readonly origin: MnZoteroLibraryOpenSourceOrigin
  readonly collectionKey?: string
}

function itemMeta(item: MnZoteroLibraryItem): string {
  return [item.creatorSummary, item.year].filter(Boolean).join(' - ') || item.itemType || item.citation || ''
}

function asKeySet(value: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return value instanceof Set ? value : new Set(value)
}

@customElement('mn-zotero-library-panel')
export class MnZoteroLibraryPanel extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      min-width: 0;
      height: 100%;
      flex-direction: column;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      background: var(--mn-color-panel-bg, var(--mn-color-surface-base, #fff));
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    .search {
      position: relative;
      display: flex;
      align-items: center;
      flex: 0 0 auto;
      padding: var(--mn-space-1-5, 6px) var(--mn-space-2, 8px);
      border-bottom: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.08));
      box-sizing: border-box;
    }

    .search-icon {
      position: absolute;
      left: 16px;
      display: inline-flex;
      color: var(--mn-color-text-tertiary, #9ca3af);
      pointer-events: none;
    }

    input {
      width: 100%;
      min-width: 0;
      height: var(--mn-control-height, 30px);
      padding: 0 var(--mn-space-2, 8px) 0 30px;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-base, #fff);
      color: inherit;
      font: inherit;
      box-sizing: border-box;
    }

    input:focus {
      outline: 2px solid var(--mn-focus-ring-color, #2563eb);
      outline-offset: 1px;
    }

    input::placeholder {
      color: var(--mn-color-text-muted, #6b7280);
    }

    .body {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: var(--mn-space-1, 4px) 0 var(--mn-space-2, 8px);
    }

    .group-label {
      display: flex;
      align-items: center;
      gap: var(--mn-space-1-5, 6px);
      padding: var(--mn-space-2, 8px) var(--mn-space-2-5, 10px) var(--mn-space-1, 4px);
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .row,
    .collection {
      display: flex;
      width: calc(100% - var(--mn-space-2, 8px));
      min-width: 0;
      margin: 0 var(--mn-space-1, 4px);
      padding: var(--mn-space-1-5, 6px) var(--mn-space-2-5, 10px);
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      text-align: left;
      box-sizing: border-box;
    }

    .row {
      flex-direction: column;
      gap: 1px;
    }

    .collection {
      align-items: center;
      gap: var(--mn-space-1-5, 6px);
    }

    .row:hover,
    .row:focus-visible,
    .collection:hover,
    .collection:focus-visible {
      background: var(--mn-color-surface-hover, #f3f4f6);
      outline: none;
    }

    .title,
    .collection-name {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .title {
      font-size: var(--mn-text-sm, 13px);
      font-weight: 500;
    }

    .meta {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 11px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .caret,
    .collection-icon {
      display: inline-flex;
      flex: 0 0 auto;
      color: var(--mn-color-text-muted, #6b7280);
    }

    .collection-name {
      flex: 1 1 auto;
      font-size: var(--mn-text-sm, 13px);
      font-weight: 500;
    }

    .count {
      flex: 0 0 auto;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 700;
    }

    .collection-items {
      padding-left: var(--mn-space-3, 12px);
    }

    .collection-branch {
      min-width: 0;
    }

    .state {
      padding: var(--mn-space-2-5, 10px);
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-sm, 13px);
      font-style: italic;
    }

    .state.error {
      color: var(--mn-color-danger-700, #b91c1c);
    }
  `

  @property({ type: String }) query = ''
  @property({ type: Boolean }) loading = false
  @property({ type: Boolean }) searching = false
  @property({ type: String }) error = ''
  @property({ attribute: false }) searchResults: readonly MnZoteroLibraryItem[] = []
  @property({ attribute: false }) topItems: readonly MnZoteroLibraryItem[] = []
  @property({ attribute: false }) collections: readonly MnZoteroCollection[] = []
  @property({ attribute: false }) collectionItems:
    | ReadonlyMap<string, readonly MnZoteroLibraryItem[]>
    | Record<string, readonly MnZoteroLibraryItem[]> = new Map()
  @property({ attribute: false }) expandedCollectionKeys: ReadonlySet<string> | readonly string[] = []

  private emitSearch(query: string): void {
    this.query = query
    this.dispatchEvent(new CustomEvent<MnZoteroLibrarySearchDetail>('mn-zotero-library-search', {
      detail: { query },
      bubbles: true,
      composed: true,
    }))
  }

  private emitToggle(collection: MnZoteroCollection): void {
    const expanded = !asKeySet(this.expandedCollectionKeys).has(collection.key)
    this.dispatchEvent(new CustomEvent<MnZoteroLibraryToggleCollectionDetail>('mn-zotero-library-toggle-collection', {
      detail: { key: collection.key, collection, expanded },
      bubbles: true,
      composed: true,
    }))
  }

  private emitOpenSource(item: MnZoteroLibraryItem, origin: MnZoteroLibraryOpenSourceOrigin, collectionKey?: string): void {
    this.dispatchEvent(new CustomEvent<MnZoteroLibraryOpenSourceDetail>('mn-zotero-library-open-source', {
      detail: {
        item,
        zoteroKey: item.key,
        artifactId: `zot-${item.key}`,
        origin,
        ...(collectionKey ? { collectionKey } : {}),
      },
      bubbles: true,
      composed: true,
    }))
  }

  private collectionChildren(parentKey: string | null): readonly MnZoteroCollection[] {
    return this.collections.filter(collection => (collection.parentKey ?? null) === parentKey)
  }

  private itemsForCollection(key: string): readonly MnZoteroLibraryItem[] {
    if (this.collectionItems instanceof Map) return this.collectionItems.get(key) ?? []
    const collectionItems = this.collectionItems as Record<string, readonly MnZoteroLibraryItem[]>
    return collectionItems[key] ?? []
  }

  private renderItem(
    item: MnZoteroLibraryItem,
    origin: MnZoteroLibraryOpenSourceOrigin,
    collectionKey?: string,
  ): TemplateResult {
    return html`
      <button
        type="button"
        class="row"
        data-zotero-item
        data-zotero-key=${item.key}
        title=${item.citation || item.title || item.key}
        @click=${() => this.emitOpenSource(item, origin, collectionKey)}
      >
        <span class="title">${item.title || item.key}</span>
        <span class="meta">${itemMeta(item) || 'reference'}</span>
      </button>
    `
  }

  private renderCollection(collection: MnZoteroCollection): TemplateResult {
    const expanded = asKeySet(this.expandedCollectionKeys).has(collection.key)
    const children = this.collectionChildren(collection.key)
    const items = this.itemsForCollection(collection.key)
    return html`
      <div class="collection-branch">
        <button
          type="button"
          class="collection"
          data-zotero-collection
          data-zotero-collection-key=${collection.key}
          aria-expanded=${expanded ? 'true' : 'false'}
          @click=${() => this.emitToggle(collection)}
        >
          <span class="caret" aria-hidden="true">${icon(expanded ? 'chevron-down' : 'chevron-right', { size: 14 })}</span>
          <span class="collection-icon" aria-hidden="true">${icon('folder', { size: 14 })}</span>
          <span class="collection-name">${collection.name}</span>
          ${typeof collection.itemCount === 'number' ? html`<span class="count">${collection.itemCount}</span>` : nothing}
        </button>
        ${expanded
          ? html`
              <div class="collection-items">
                ${children.map(child => this.renderCollection(child))}
                ${items.map(item => this.renderItem(item, 'collection', collection.key))}
                ${children.length === 0 && items.length === 0 ? html`<div class="state">Empty.</div>` : nothing}
              </div>
            `
          : nothing}
      </div>
    `
  }

  private renderBrowse(): readonly unknown[] {
    const roots = this.collectionChildren(null)
    const parts: unknown[] = []

    if (this.error) parts.push(html`<div class="state error">${this.error}</div>`)
    if (roots.length) {
      parts.push(html`<div class="group-label">${icon('folder', { size: 12 })}<span>Collections</span></div>`)
      parts.push(...roots.map(collection => this.renderCollection(collection)))
    }

    parts.push(html`<div class="group-label">${icon('book-open', { size: 12 })}<span>All items</span></div>`)
    if (this.loading) {
      parts.push(html`<div class="state">Loading...</div>`)
    } else if (this.topItems.length) {
      parts.push(...this.topItems.map(item => this.renderItem(item, 'top')))
    } else {
      parts.push(html`<div class="state">Library is empty.</div>`)
    }

    return parts
  }

  private renderSearch(): unknown {
    if (this.searching) return html`<div class="state">Searching...</div>`
    if (this.searchResults.length === 0) return html`<div class="state">No matches.</div>`
    return this.searchResults.map(item => this.renderItem(item, 'search'))
  }

  override render() {
    const q = this.query.trim()
    return html`
      <div class="search">
        <span class="search-icon" aria-hidden="true">${icon('search', { size: 14 })}</span>
        <input
          data-zotero-search
          type="text"
          placeholder="Search library..."
          .value=${this.query}
          @input=${(event: Event) => this.emitSearch((event.target as HTMLInputElement).value)}
        />
      </div>
      <div class="body" data-zotero-library-panel>
        ${q ? this.renderSearch() : this.renderBrowse()}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-zotero-library-panel': MnZoteroLibraryPanel
  }
}
