/**
 * mn-wikilink-picker - Garden's wikilink quick-picker surface, shell-neutral.
 *
 * Garden's original component owned filesystem lookups and block fetches. This
 * lift keeps the popup, phases, keyboard behavior, and events, while receiving
 * documents/blocks/predicates as controlled data from a shell.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnWikiLinkPickerPhase = 'document' | 'block' | 'predicate'

export interface MnWikiLinkDocumentItem {
  readonly id: string
  readonly label: string
  readonly type?: 'document' | 'artifact'
  readonly parentId?: string | null
}

export interface MnWikiLinkBlockItem {
  readonly id: string
  readonly type: 'heading' | 'paragraph' | 'listItem' | 'blockquote' | 'codeBlock'
  readonly level?: number
  readonly text: string
  readonly preview?: string
}

export interface MnWikiLinkPredicateItem {
  readonly uri: string
  readonly label: string
  readonly category?: string
  readonly icon?: string
}

export interface MnWikiLinkPickerSelectDetail {
  readonly document: MnWikiLinkDocumentItem
  readonly block?: MnWikiLinkBlockItem
  readonly predicate?: MnWikiLinkPredicateItem
}

export interface MnWikiLinkPickerQueryDetail {
  readonly query: string
  readonly phase: MnWikiLinkPickerPhase
}

export interface MnWikiLinkPickerPhaseRequestDetail {
  readonly phase: MnWikiLinkPickerPhase
  readonly document?: MnWikiLinkDocumentItem
  readonly block?: MnWikiLinkBlockItem
}

function stop(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
}

@customElement('mn-wikilink-picker')
export class MnWikiLinkPicker extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: none;
      color: var(--mn-color-text-primary, #111827);
      font: var(--mn-type-ui-size, 13px) / 1.35 var(--mn-font-chrome, system-ui, sans-serif);
    }

    :host([open]) {
      display: block;
    }

    .overlay {
      position: fixed;
      inset: 0;
      z-index: var(--mn-z-dropdown-backdrop, 900);
      background: transparent;
    }

    .container {
      position: fixed;
      z-index: var(--mn-z-dropdown, 1000);
      width: 360px;
      max-width: min(90vw, calc(100vw - var(--mn-space-4, 16px)));
      overflow: hidden;
      border: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.12));
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-base, #fff);
      box-shadow: var(--mn-shadow-modal, 0 24px 64px rgba(15, 23, 42, 0.18));
      animation: picker-slide-in var(--mn-transition-fast, 150ms) ease-out;
    }

    @keyframes picker-slide-in {
      from {
        opacity: 0;
        transform: translateY(-8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .header {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.1));
    }

    .header-icon {
      display: inline-flex;
      flex: 0 0 auto;
      color: var(--mn-color-text-accent, #2563eb);
    }

    .phase-badge {
      flex: 0 0 auto;
      padding: 2px var(--mn-space-1-5, 6px);
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-accent, #e0ecff);
      color: var(--mn-color-text-accent-strong, #1d4ed8);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .phase-badge.block,
    .phase-badge.predicate {
      background: var(--mn-color-warning-surface, #fff7ed);
      color: var(--mn-color-warning-strong, #c2410c);
    }

    .selected-predicate {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      flex: 0 1 auto;
      min-width: 0;
      max-width: 112px;
      overflow: hidden;
      color: var(--mn-color-text-accent, #2563eb);
      font-size: var(--mn-text-2xs, 10px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .search {
      flex: 1 1 auto;
      min-width: 0;
      border: 0;
      outline: none;
      background: transparent;
      color: var(--mn-color-text-primary, #111827);
      font: inherit;
      font-size: var(--mn-type-ui-md-size, 14px);
    }

    .search::placeholder {
      color: var(--mn-color-text-muted, #6b7280);
    }

    .context {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.1));
      background: var(--mn-color-surface-accent, #e0ecff);
      color: var(--mn-color-text-accent-strong, #1d4ed8);
    }

    .context.predicate {
      background: var(--mn-color-warning-surface, #fff7ed);
      color: var(--mn-color-warning-strong, #c2410c);
    }

    .context-label {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .context-back {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: currentColor;
      cursor: pointer;
    }

    .context-back:hover,
    .context-back:focus-visible {
      background: var(--mn-color-surface-hover, rgba(15, 23, 42, 0.08));
      outline: none;
    }

    .results {
      max-height: 300px;
      overflow-y: auto;
    }

    .empty,
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 72px;
      padding: var(--mn-space-5, 20px);
      box-sizing: border-box;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-type-ui-size, 13px);
      text-align: center;
    }

    .loading {
      gap: var(--mn-space-2, 8px);
    }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.12));
      border-top-color: var(--mn-color-border-accent, #2563eb);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .section-label,
    .predicate-group-label {
      display: flex;
      align-items: center;
      gap: var(--mn-space-1-5, 6px);
      padding: var(--mn-space-1-5, 6px) var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.08));
      background: var(--mn-color-surface-subtle, rgba(15, 23, 42, 0.035));
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .item {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2-5, 10px);
      width: 100%;
      min-height: 38px;
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      text-align: left;
      box-sizing: border-box;
    }

    .item:hover,
    .item.selected {
      background: var(--mn-color-surface-hover, rgba(15, 23, 42, 0.06));
    }

    .item.selected {
      background: var(--mn-color-surface-accent, #e0ecff);
    }

    .item:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, #2563eb);
      outline-offset: -2px;
    }

    .item-icon,
    .chevron {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 18px;
      color: var(--mn-color-text-muted, #6b7280);
    }

    .item-content {
      flex: 1 1 auto;
      min-width: 0;
    }

    .item-label {
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-preview {
      overflow: hidden;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-type-ui-xs-size, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .badge {
      flex: 0 0 auto;
      padding: 2px var(--mn-space-1-5, 6px);
      border-radius: var(--mn-radius-sm, 4px);
      background: var(--mn-color-surface-sunken, #f3f4f6);
      color: var(--mn-color-text-secondary, #374151);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 650;
    }

    .badge.h1 {
      background: var(--mn-color-surface-accent, #e0ecff);
      color: var(--mn-color-text-accent-strong, #1d4ed8);
    }

    .badge.h2 {
      background: var(--mn-color-surface-accent, #e0ecff);
      color: var(--mn-color-text-accent, #2563eb);
    }

    .hint {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: var(--mn-space-3, 12px);
      padding: var(--mn-space-1-5, 6px) var(--mn-space-3, 12px);
      border-top: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.1));
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
    }

    kbd {
      display: inline-block;
      padding: 1px var(--mn-space-1, 4px);
      border-radius: 3px;
      background: var(--mn-color-surface-sunken, #f3f4f6);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
    }
  `

  @property({ type: Boolean, reflect: true }) open = false
  @property({ type: String }) phase: MnWikiLinkPickerPhase = 'document'
  @property({ type: String }) query = ''
  @property({ type: Number }) selectedIndex = 0
  @property({ type: Number }) x = 0
  @property({ type: Number }) y = 0
  @property({ type: Boolean }) loading = false
  @property({ attribute: false }) documents: readonly MnWikiLinkDocumentItem[] = []
  @property({ attribute: false }) blocks: readonly MnWikiLinkBlockItem[] = []
  @property({ attribute: false }) predicates: readonly MnWikiLinkPredicateItem[] = []
  @property({ attribute: false }) selectedDocument: MnWikiLinkDocumentItem | null = null
  @property({ attribute: false }) selectedBlock: MnWikiLinkBlockItem | null = null
  @property({ attribute: false }) selectedPredicate: MnWikiLinkPredicateItem | null = null

  @query('[data-wikilink-search]') private searchInput?: HTMLInputElement

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
    if (changed.has('open') && this.open) this.focusPending = true
    if (
      changed.has('documents') ||
      changed.has('blocks') ||
      changed.has('predicates') ||
      changed.has('phase')
    ) {
      this.clampSelectedIndex()
    }
    if (this.focusPending) {
      this.focusPending = false
      window.setTimeout(() => this.searchInput?.focus(), 0)
    }
  }

  show(): void {
    this.open = true
  }

  hide(): void {
    this.close()
  }

  private get items(): readonly (MnWikiLinkDocumentItem | MnWikiLinkBlockItem | MnWikiLinkPredicateItem)[] {
    if (this.phase === 'block') return this.blocks
    if (this.phase === 'predicate') return this.predicates
    return this.documents
  }

  private get placeholder(): string {
    if (this.phase === 'block') return 'Search blocks...'
    if (this.phase === 'predicate') return 'Search predicates...'
    return 'Search documents...'
  }

  private get phaseLabel(): string {
    if (this.phase === 'block') return 'Block'
    if (this.phase === 'predicate') return 'Predicate'
    return 'Wire to'
  }

  private get emptyLabel(): string {
    if (this.phase === 'block') return this.blocks.length === 0 ? 'No blocks in document. Press Enter to link to document.' : 'No matching blocks'
    if (this.phase === 'predicate') return 'No predicates found'
    return 'No documents found'
  }

  private clampSelectedIndex(): void {
    const max = Math.max(0, this.items.length - 1)
    if (this.selectedIndex > max) this.selectedIndex = max
    if (this.selectedIndex < 0) this.selectedIndex = 0
  }

  private handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (!this.open) return
    this.handleKeyDown(event)
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const items = this.items
    switch (event.key) {
      case 'ArrowDown':
        stop(event)
        this.selectedIndex = Math.min(this.selectedIndex + 1, Math.max(0, items.length - 1))
        this.scrollToSelected()
        break
      case 'ArrowUp':
        stop(event)
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
        this.scrollToSelected()
        break
      case 'ArrowRight':
        if (this.phase === 'document') {
          stop(event)
          this.requestPhase('block')
        }
        break
      case 'ArrowLeft':
        if (this.phase !== 'document') {
          stop(event)
          this.requestPhase('document')
        }
        break
      case 'Tab':
        stop(event)
        this.requestPhase(event.shiftKey ? 'predicate' : 'block')
        break
      case 'Enter':
        stop(event)
        this.selectCurrent()
        break
      case 'Escape':
        stop(event)
        if (this.phase === 'document') this.close()
        else this.requestPhase('document')
        break
      default:
        break
    }
  }

  private scrollToSelected(): void {
    window.requestAnimationFrame(() => {
      this.shadowRoot
        ?.querySelector<HTMLElement>(`[data-picker-index="${this.selectedIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
  }

  private close(): void {
    if (!this.open) return
    this.open = false
    this.dispatchEvent(new CustomEvent('mn-close', { bubbles: true, composed: true }))
  }

  private setQuery(value: string): void {
    this.query = value
    this.selectedIndex = 0
    this.dispatchEvent(
      new CustomEvent<MnWikiLinkPickerQueryDetail>('mn-wikilink-query', {
        detail: { query: value, phase: this.phase },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private requestPhase(phase: MnWikiLinkPickerPhase): void {
    const document = this.phase === 'document'
      ? this.documents[this.selectedIndex]
      : this.selectedDocument ?? undefined
    const block = this.phase === 'block' ? this.blocks[this.selectedIndex] : this.selectedBlock ?? undefined
    this.dispatchEvent(
      new CustomEvent<MnWikiLinkPickerPhaseRequestDetail>('mn-wikilink-phase-request', {
        detail: { phase, document, block },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private selectCurrent(): void {
    if (this.phase === 'document') {
      const document = this.documents[this.selectedIndex]
      if (!document) return
      this.dispatchSelect({ document, predicate: this.selectedPredicate ?? undefined })
      return
    }
    if (this.phase === 'block') {
      const document = this.selectedDocument
      if (!document) return
      const block = this.blocks[this.selectedIndex]
      this.dispatchSelect({
        document,
        block: block ?? undefined,
        predicate: this.selectedPredicate ?? undefined,
      })
      return
    }
    const predicate = this.predicates[this.selectedIndex]
    if (!predicate) return
    if (this.selectedDocument) {
      this.dispatchSelect({
        document: this.selectedDocument,
        block: this.selectedBlock ?? undefined,
        predicate,
      })
      return
    }
    this.selectedPredicate = predicate
    this.requestPhase('document')
  }

  private dispatchSelect(detail: MnWikiLinkPickerSelectDetail): void {
    this.dispatchEvent(
      new CustomEvent<MnWikiLinkPickerSelectDetail>('mn-wikilink-select', {
        detail,
        bubbles: true,
        composed: true,
      }),
    )
  }

  private iconForBlock(block: MnWikiLinkBlockItem): TemplateResult | unknown {
    if (block.type === 'heading') return icon(`heading-${block.level ?? 1}`, { size: 14 })
    if (block.type === 'listItem') return icon('list', { size: 14 })
    if (block.type === 'blockquote') return icon('quote', { size: 14 })
    if (block.type === 'codeBlock') return icon('code', { size: 14 })
    return icon('type', { size: 14 })
  }

  private renderContext(): TemplateResult | typeof nothing {
    if (this.phase === 'block' && this.selectedDocument) {
      return html`
        <div class="context">
          ${icon('file-text', { size: 14 })}
          <span class="context-label">${this.selectedDocument.label}</span>
          <button type="button" class="context-back" title="Back to documents" @click=${() => this.requestPhase('document')}>
            ${icon('x', { size: 14 })}
          </button>
        </div>
      `
    }
    if (this.phase === 'predicate' && this.selectedDocument) {
      return html`
        <div class="context predicate">
          ${icon('file-text', { size: 14 })}
          <span class="context-label">${this.selectedDocument.label}</span>
          ${this.selectedBlock
            ? html`<span class="badge">${this.selectedBlock.preview?.slice(0, 20) || this.selectedBlock.text.slice(0, 20)}</span>`
            : nothing}
        </div>
      `
    }
    return nothing
  }

  private renderDocument(doc: MnWikiLinkDocumentItem, index: number): TemplateResult {
    return html`
      <button
        type="button"
        class=${index === this.selectedIndex ? 'item selected' : 'item'}
        role="option"
        aria-selected=${index === this.selectedIndex ? 'true' : 'false'}
        data-picker-index=${index}
        data-wikilink-candidate
        data-doc-id=${doc.id}
        @mouseenter=${() => {
          this.selectedIndex = index
        }}
        @mousedown=${(event: Event) => {
          stop(event)
          this.selectedIndex = index
          this.selectCurrent()
        }}
      >
        <span class="item-icon">${icon(doc.type === 'artifact' ? 'package' : 'file-text', { size: 14 })}</span>
        <span class="item-content">
          <span class="item-label">${doc.label}</span>
        </span>
        ${index === this.selectedIndex ? html`<span class="chevron">${icon('chevron-right', { size: 14 })}</span>` : nothing}
      </button>
    `
  }

  private renderBlock(block: MnWikiLinkBlockItem, index: number): TemplateResult {
    return html`
      <button
        type="button"
        class=${index === this.selectedIndex ? 'item selected' : 'item'}
        role="option"
        aria-selected=${index === this.selectedIndex ? 'true' : 'false'}
        data-picker-index=${index}
        data-wikilink-block
        data-block-id=${block.id}
        @mouseenter=${() => {
          this.selectedIndex = index
        }}
        @mousedown=${(event: Event) => {
          stop(event)
          this.selectedIndex = index
          this.selectCurrent()
        }}
      >
        <span class="item-icon">${this.iconForBlock(block)}</span>
        <span class="item-content">
          <span class="item-label">${block.text}</span>
          ${block.preview && block.preview !== block.text ? html`<span class="item-preview">${block.preview}</span>` : nothing}
        </span>
        ${block.type === 'heading' && block.level ? html`<span class=${`badge h${block.level}`}>H${block.level}</span>` : nothing}
      </button>
    `
  }

  private renderPredicateGroups(): TemplateResult[] {
    const out: TemplateResult[] = []
    let current = ''
    this.predicates.forEach((predicate, index) => {
      const category = predicate.category || 'Default'
      if (category !== current) {
        current = category
        out.push(html`
          <div class="predicate-group-label">
            ${icon(predicate.icon || 'zap', { size: 12 })}
            ${category}
          </div>
        `)
      }
      out.push(html`
        <button
          type="button"
          class=${index === this.selectedIndex ? 'item selected' : 'item'}
          role="option"
          aria-selected=${index === this.selectedIndex ? 'true' : 'false'}
          data-picker-index=${index}
          data-wikilink-predicate
          data-predicate-uri=${predicate.uri}
          @mouseenter=${() => {
            this.selectedIndex = index
          }}
          @mousedown=${(event: Event) => {
            stop(event)
            this.selectedIndex = index
            this.selectCurrent()
          }}
        >
          <span class="item-content">
            <span class="item-label">${predicate.label}</span>
          </span>
        </button>
      `)
    })
    return out
  }

  private renderResults(): TemplateResult | TemplateResult[] {
    if (this.loading) {
      return html`<div class="loading"><span class="spinner" aria-hidden="true"></span>Loading...</div>`
    }
    if (this.items.length === 0) {
      return html`<div class="empty">${this.emptyLabel}</div>`
    }
    if (this.phase === 'block') return this.blocks.map((block, index) => this.renderBlock(block, index))
    if (this.phase === 'predicate') return this.renderPredicateGroups()
    return this.documents.map((doc, index) => this.renderDocument(doc, index))
  }

  private renderHint(): TemplateResult {
    return html`
      <div class="hint">
        <span><kbd>↑↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> select</span>
        ${this.phase === 'document'
          ? html`<span><kbd>→</kbd><kbd>Tab</kbd> block</span><span><kbd>⇧Tab</kbd> predicate</span>`
          : this.phase === 'block'
            ? html`<span><kbd>←</kbd><kbd>Esc</kbd> back</span><span><kbd>⇧Tab</kbd> predicate</span>`
            : html`<span><kbd>Esc</kbd> back</span>`}
      </div>
    `
  }

  override render() {
    if (!this.open) return nothing
    const style = `left: ${this.x}px; top: ${this.y}px;`
    return html`
      <div class="overlay" @mousedown=${() => this.close()}></div>
      <section
        class="container"
        style=${style}
        role="dialog"
        aria-label="Wikilink picker"
        data-wikilink-picker
        @mousedown=${(event: Event) => event.stopPropagation()}
      >
        <header class="header">
          <span class="header-icon" aria-hidden="true">${icon('git-branch', { size: 16 })}</span>
          <span class=${`phase-badge ${this.phase}`}>${this.phaseLabel}</span>
          ${this.selectedPredicate && this.phase !== 'predicate'
            ? html`<span class="selected-predicate">${icon('zap', { size: 10 })}${this.selectedPredicate.label}</span>`
            : nothing}
          <input
            class="search"
            type="text"
            data-wikilink-search
            placeholder=${this.placeholder}
            .value=${this.query}
            @input=${(event: Event) => this.setQuery((event.target as HTMLInputElement).value)}
          />
        </header>
        ${this.renderContext()}
        <div class="results" role="listbox" aria-label=${this.phaseLabel} data-wikilink-results>
          ${this.renderResults()}
        </div>
        ${this.renderHint()}
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-wikilink-picker': MnWikiLinkPicker
  }
}
