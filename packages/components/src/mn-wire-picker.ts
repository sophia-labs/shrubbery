/**
 * mn-wire-picker - Garden's three-phase wire creation picker, made shell-neutral.
 *
 * Garden's picker owned stores, block fetches, auth headers, direct wire creation,
 * source highlighting, and flash animations. Shrubbery keeps only the picker UI
 * and keyboard flow: callers provide documents, blocks, predicates, source
 * context, and receive composed intents for every host-owned effect.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export type MnWirePickerPhase = 'options' | 'predicate' | 'document' | 'block'
export type MnWirePickerDirection = 'forward' | 'reverse' | 'bidirectional'
export type MnWirePickerGranularity = 'document' | 'block'
export type MnWirePickerOptionsField = 'predicate' | 'direction' | 'from'

export interface MnWirePickerDocumentItem {
  readonly id: string
  readonly label: string
  readonly graphId?: string | null
  readonly path?: string | null
}

export interface MnWirePickerBlockItem {
  readonly id: string
  readonly type: 'heading' | 'paragraph' | 'listItem' | 'blockquote' | 'codeBlock'
  readonly level?: number
  readonly text: string
  readonly preview?: string
}

export interface MnWirePickerPredicateItem {
  readonly uri: string
  readonly label: string
  readonly category?: string
  readonly icon?: string
}

export interface MnWirePickerSource {
  readonly graphId?: string | null
  readonly documentId?: string | null
  readonly blockId?: string | null
  readonly label?: string | null
  readonly text?: string | null
}

export interface MnWirePickerQueryDetail {
  readonly query: string
  readonly phase: MnWirePickerPhase
}

export interface MnWirePickerPhaseRequestDetail {
  readonly phase: MnWirePickerPhase
  readonly document?: MnWirePickerDocumentItem
  readonly block?: MnWirePickerBlockItem
}

export interface MnWirePickerOptionChangeDetail {
  readonly predicate: MnWirePickerPredicateItem
  readonly direction: MnWirePickerDirection
  readonly granularity: MnWirePickerGranularity
  readonly field?: MnWirePickerOptionsField
}

export interface MnWirePickerSelectDetail extends MnWirePickerOptionChangeDetail {
  readonly source: MnWirePickerSource | null
  readonly document: MnWirePickerDocumentItem
  readonly block?: MnWirePickerBlockItem
  readonly bidirectional: boolean
}

const DIRECTION_ORDER: readonly MnWirePickerDirection[] = ['forward', 'reverse', 'bidirectional']

const DIRECTION_LABELS: Record<MnWirePickerDirection, string> = {
  forward: 'A to B',
  reverse: 'B to A',
  bidirectional: 'Both',
}

function stop(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
}

function trimmed(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function defaultPredicate(): MnWirePickerPredicateItem {
  return { uri: 'http://mnemosyne.ai/vocab#relatedTo', label: 'is related to', category: 'Default', icon: 'wire' }
}

@customElement('mn-wire-picker')
export class MnWirePicker extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: none;
      color: var(--mn-color-text-primary, #111827);
      font: var(--mn-text-sm, 13px) / 1.35 var(--mn-font-chrome, system-ui, sans-serif);
    }

    :host([open]) {
      display: block;
    }

    .overlay {
      position: fixed;
      inset: 0;
      z-index: var(--mn-z-dropdown-backdrop, 900);
      background: var(--mn-color-surface-overlay, rgba(15, 23, 42, 0.24));
    }

    .container {
      position: fixed;
      top: 50%;
      left: 50%;
      z-index: var(--mn-z-dropdown, 1000);
      display: flex;
      width: min(420px, calc(100vw - var(--mn-space-6, 24px)));
      max-height: min(80vh, 620px);
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.12));
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-base, #fff);
      box-shadow: var(--mn-shadow-modal, 0 24px 64px rgba(15, 23, 42, 0.2));
      transform: translate(-50%, -50%);
      box-sizing: border-box;
    }

    .source {
      display: flex;
      min-height: 34px;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-1-5, 6px) var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.1));
      background: var(--mn-color-surface-subtle, #f8fafc);
      box-sizing: border-box;
    }

    .source-label {
      flex: 0 0 auto;
      color: var(--mn-color-text-accent, #2563eb);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 750;
      text-transform: uppercase;
    }

    .source-text {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .header {
      display: flex;
      min-height: 42px;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.1));
      box-sizing: border-box;
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
      font-weight: 750;
      text-transform: uppercase;
    }

    .phase-badge.alt {
      background: var(--mn-color-warning-surface, #fff7ed);
      color: var(--mn-color-warning-strong, #c2410c);
    }

    .search {
      flex: 1 1 auto;
      min-width: 0;
      border: 0;
      outline: none;
      background: transparent;
      color: var(--mn-color-text-primary, #111827);
      font: inherit;
      font-size: var(--mn-text-base, 14px);
    }

    .search::placeholder {
      color: var(--mn-color-text-muted, #6b7280);
    }

    .options {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-3, 12px);
    }

    .option-row {
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr) auto;
      gap: var(--mn-space-2, 8px);
      align-items: center;
      min-height: 42px;
      padding: 0 var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-lg, 8px);
      background: var(--mn-color-surface-sunken, #f8fafc);
      color: inherit;
      cursor: pointer;
      font: inherit;
      text-align: left;
      box-sizing: border-box;
    }

    .option-row.focused,
    .option-row:hover {
      border-color: var(--mn-color-border-accent, #93c5fd);
      background: var(--mn-color-surface-accent, #eff6ff);
    }

    .option-label {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 750;
      text-transform: uppercase;
    }

    .option-value {
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-style: italic;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .option-hint {
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
    }

    .context {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.1));
      background: var(--mn-color-surface-accent, #eff6ff);
      color: var(--mn-color-text-accent-strong, #1d4ed8);
    }

    .context-label {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .back {
      display: inline-flex;
      width: 24px;
      height: 24px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: currentColor;
      cursor: pointer;
    }

    .back:hover,
    .back:focus-visible {
      background: var(--mn-color-surface-hover, rgba(15, 23, 42, 0.08));
      outline: none;
    }

    .results {
      flex: 1 1 auto;
      overflow-y: auto;
      min-height: 0;
      max-height: 320px;
    }

    .empty,
    .loading {
      display: flex;
      min-height: 78px;
      align-items: center;
      justify-content: center;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-5, 20px);
      color: var(--mn-color-text-muted, #6b7280);
      text-align: center;
      box-sizing: border-box;
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

    .group-label {
      display: flex;
      align-items: center;
      gap: var(--mn-space-1-5, 6px);
      padding: var(--mn-space-1-5, 6px) var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, rgba(15, 23, 42, 0.08));
      background: var(--mn-color-surface-subtle, rgba(15, 23, 42, 0.035));
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 750;
      text-transform: uppercase;
    }

    .item {
      display: flex;
      width: 100%;
      min-height: 40px;
      align-items: center;
      gap: var(--mn-space-2-5, 10px);
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
      width: 18px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      color: var(--mn-color-text-muted, #6b7280);
    }

    .item-content {
      flex: 1 1 auto;
      min-width: 0;
    }

    .item-label {
      display: block;
      overflow: hidden;
      color: var(--mn-color-text-primary, #111827);
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-preview {
      display: block;
      overflow: hidden;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
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

    .footer {
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
  @property({ type: String }) phase: MnWirePickerPhase = 'options'
  @property({ type: String }) query = ''
  @property({ type: Number }) selectedIndex = 0
  @property({ type: String }) direction: MnWirePickerDirection = 'forward'
  @property({ type: String }) granularity: MnWirePickerGranularity = 'block'
  @property({ type: String, attribute: 'focused-field' }) focusedField: MnWirePickerOptionsField = 'predicate'
  @property({ type: Boolean }) loading = false
  @property({ attribute: false }) source: MnWirePickerSource | null = null
  @property({ attribute: false }) documents: readonly MnWirePickerDocumentItem[] = []
  @property({ attribute: false }) blocks: readonly MnWirePickerBlockItem[] = []
  @property({ attribute: false }) predicates: readonly MnWirePickerPredicateItem[] = []
  @property({ attribute: false }) selectedDocument: MnWirePickerDocumentItem | null = null
  @property({ attribute: false }) selectedBlock: MnWirePickerBlockItem | null = null
  @property({ attribute: false }) selectedPredicate: MnWirePickerPredicateItem | null = null

  @query('[data-wire-picker-search]') private searchInput?: HTMLInputElement

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
      changed.has('phase') ||
      changed.has('selectedIndex')
    ) {
      this.clampSelectedIndex()
    }
    if (this.focusPending && this.phase !== 'options') {
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

  private get predicate(): MnWirePickerPredicateItem {
    return this.selectedPredicate ?? this.predicates[0] ?? defaultPredicate()
  }

  private get items(): readonly (MnWirePickerDocumentItem | MnWirePickerBlockItem | MnWirePickerPredicateItem)[] {
    if (this.phase === 'block') return this.blocks
    if (this.phase === 'predicate') return this.predicates
    return this.documents
  }

  private get optionFields(): readonly MnWirePickerOptionsField[] {
    return this.source?.blockId ? ['predicate', 'direction', 'from'] : ['predicate', 'direction']
  }

  private get phaseLabel(): string {
    if (this.phase === 'predicate') return 'Predicate'
    if (this.phase === 'document') return 'Wire to'
    if (this.phase === 'block') return 'Block'
    return 'Options'
  }

  private get placeholder(): string {
    if (this.phase === 'predicate') return 'Search predicates...'
    if (this.phase === 'block') return 'Search blocks...'
    return 'Search documents...'
  }

  private get emptyLabel(): string {
    if (this.phase === 'predicate') return 'No predicates found'
    if (this.phase === 'block') return this.blocks.length === 0 ? 'No blocks in document. Press Enter to link the document.' : 'No matching blocks'
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
    if (this.phase === 'options') {
      this.handleOptionsKeydown(event)
      return
    }
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
        stop(event)
        this.requestPhase(this.phase === 'document' ? 'options' : 'document')
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

  private handleOptionsKeydown(event: KeyboardEvent): void {
    const navKeys = ['Tab', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']
    if (!navKeys.includes(event.key)) return
    stop(event)
    const fields = this.optionFields
    const index = Math.max(0, fields.indexOf(this.focusedField))
    if (event.key === 'Escape' || event.key === 'ArrowLeft') {
      this.close()
      return
    }
    if (event.key === 'Enter') {
      this.requestPhase('document')
      return
    }
    if ((event.key === 'Tab' && !event.shiftKey) || event.key === 'ArrowDown') {
      this.focusedField = fields[(index + 1) % fields.length]
      return
    }
    if ((event.key === 'Tab' && event.shiftKey) || event.key === 'ArrowUp') {
      this.focusedField = fields[(index - 1 + fields.length) % fields.length]
      return
    }
    if (event.key === ' ' || event.key === 'ArrowRight') this.activateOption(this.focusedField)
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
      new CustomEvent<MnWirePickerQueryDetail>('mn-wire-picker-query', {
        detail: { query: value, phase: this.phase },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private requestPhase(phase: MnWirePickerPhase): void {
    const document = this.phase === 'document'
      ? this.documents[this.selectedIndex]
      : this.selectedDocument ?? undefined
    const block = this.phase === 'block' ? this.blocks[this.selectedIndex] : this.selectedBlock ?? undefined
    this.dispatchEvent(
      new CustomEvent<MnWirePickerPhaseRequestDetail>('mn-wire-picker-phase-request', {
        detail: { phase, document, block },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private emitOptions(field?: MnWirePickerOptionsField): void {
    this.dispatchEvent(
      new CustomEvent<MnWirePickerOptionChangeDetail>('mn-wire-picker-option-change', {
        detail: {
          predicate: this.predicate,
          direction: this.direction,
          granularity: this.granularity,
          field,
        },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private activateOption(field: MnWirePickerOptionsField): void {
    if (field === 'predicate') {
      this.requestPhase('predicate')
      return
    }
    if (field === 'direction') {
      const index = DIRECTION_ORDER.indexOf(this.direction)
      this.direction = DIRECTION_ORDER[(index + 1) % DIRECTION_ORDER.length]
      this.emitOptions('direction')
      return
    }
    this.granularity = this.granularity === 'block' ? 'document' : 'block'
    this.emitOptions('from')
  }

  private selectCurrent(): void {
    if (this.phase === 'document') {
      const document = this.documents[this.selectedIndex]
      if (!document) return
      this.dispatchSelect({ document })
      return
    }
    if (this.phase === 'block') {
      const document = this.selectedDocument
      if (!document) return
      const block = this.blocks[this.selectedIndex]
      this.dispatchSelect({ document, block: block ?? undefined })
      return
    }
    if (this.phase === 'predicate') {
      const predicate = this.predicates[this.selectedIndex]
      if (!predicate) return
      this.selectedPredicate = predicate
      this.emitOptions('predicate')
      this.requestPhase('options')
    }
  }

  private dispatchSelect(base: { document: MnWirePickerDocumentItem; block?: MnWirePickerBlockItem }): void {
    const detail: MnWirePickerSelectDetail = {
      source: this.source,
      document: base.document,
      block: base.block,
      predicate: this.predicate,
      direction: this.direction,
      granularity: this.granularity,
      bidirectional: this.direction === 'bidirectional',
    }
    this.dispatchEvent(new CustomEvent<MnWirePickerSelectDetail>('mn-wire-picker-select', {
      detail,
      bubbles: true,
      composed: true,
    }))
    this.dispatchEvent(new CustomEvent<MnWirePickerSelectDetail>('wire-picker-select', {
      detail,
      bubbles: true,
      composed: true,
    }))
  }

  private iconForBlock(block: MnWirePickerBlockItem): TemplateResult | unknown {
    if (block.type === 'heading') return icon(`heading-${block.level ?? 1}`, { size: 14 })
    if (block.type === 'listItem') return icon('list', { size: 14 })
    if (block.type === 'blockquote') return icon('quote', { size: 14 })
    if (block.type === 'codeBlock') return icon('code', { size: 14 })
    return icon('type', { size: 14 })
  }

  private renderSource(): TemplateResult | typeof nothing {
    const text = trimmed(this.source?.text) || trimmed(this.source?.label)
    if (!text) return nothing
    return html`
      <div class="source">
        <span class="source-label">Source</span>
        <span class="source-text">${text}</span>
      </div>
    `
  }

  private renderHeader(): TemplateResult {
    return html`
      <div class="header">
        <span class="header-icon" aria-hidden="true">${icon('git-branch', { size: 16 })}</span>
        <span class=${this.phase === 'options' || this.phase === 'document' ? 'phase-badge' : 'phase-badge alt'}>${this.phaseLabel}</span>
        ${this.phase === 'options'
          ? html`<span class="search">${this.predicate.label} / ${DIRECTION_LABELS[this.direction]}</span>`
          : html`
              <input
                class="search"
                data-wire-picker-search
                type="text"
                placeholder=${this.placeholder}
                .value=${this.query}
                @input=${(event: Event) => this.setQuery((event.target as HTMLInputElement).value)}
              />
            `}
      </div>
    `
  }

  private renderOptionRows(): TemplateResult {
    return html`
      <div class="options" data-wire-picker-options>
        ${this.renderOption('predicate', 'Predicate', this.predicate.label, 'Space')}
        ${this.renderOption('direction', 'Direction', DIRECTION_LABELS[this.direction], 'Space')}
        ${this.source?.blockId ? this.renderOption('from', 'From', this.granularity === 'block' ? 'Selected block' : 'Whole document', 'Space') : nothing}
      </div>
    `
  }

  private renderOption(field: MnWirePickerOptionsField, label: string, value: string, hint: string): TemplateResult {
    return html`
      <button
        type="button"
        class=${this.focusedField === field ? 'option-row focused' : 'option-row'}
        data-wire-option=${field}
        @click=${() => {
          this.focusedField = field
          this.activateOption(field)
        }}
      >
        <span class="option-label">${label}</span>
        <span class="option-value">${value}</span>
        <span class="option-hint">${hint}</span>
      </button>
    `
  }

  private renderContext(): TemplateResult | typeof nothing {
    if (this.phase === 'block' && this.selectedDocument) {
      return html`
        <div class="context">
          ${icon('file-text', { size: 14 })}
          <span class="context-label">${this.selectedDocument.label}</span>
          <button type="button" class="back" title="Back to documents" @click=${() => this.requestPhase('document')}>
            ${icon('x', { size: 14 })}
          </button>
        </div>
      `
    }
    return nothing
  }

  private renderDocument(doc: MnWirePickerDocumentItem, index: number): TemplateResult {
    return html`
      <button
        type="button"
        class=${index === this.selectedIndex ? 'item selected' : 'item'}
        role="option"
        aria-selected=${index === this.selectedIndex ? 'true' : 'false'}
        data-picker-index=${index}
        data-wire-document
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
        <span class="item-icon">${icon('file-text', { size: 14 })}</span>
        <span class="item-content">
          <span class="item-label">${doc.label}</span>
          ${trimmed(doc.path) ? html`<span class="item-preview">${doc.path}</span>` : nothing}
        </span>
        ${index === this.selectedIndex ? html`<span class="chevron">${icon('chevron-right', { size: 14 })}</span>` : nothing}
      </button>
    `
  }

  private renderBlock(block: MnWirePickerBlockItem, index: number): TemplateResult {
    return html`
      <button
        type="button"
        class=${index === this.selectedIndex ? 'item selected' : 'item'}
        role="option"
        aria-selected=${index === this.selectedIndex ? 'true' : 'false'}
        data-picker-index=${index}
        data-wire-block
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
        ${block.type === 'heading' && block.level ? html`<span class="badge">H${block.level}</span>` : nothing}
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
          <div class="group-label">
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
          data-wire-predicate
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
          <span class="item-content"><span class="item-label">${predicate.label}</span></span>
        </button>
      `)
    })
    return out
  }

  private renderResults(): TemplateResult | TemplateResult[] {
    if (this.loading) return html`<div class="loading"><span class="spinner" aria-hidden="true"></span>Loading...</div>`
    if (this.items.length === 0) return html`<div class="empty">${this.emptyLabel}</div>`
    if (this.phase === 'block') return this.blocks.map((block, index) => this.renderBlock(block, index))
    if (this.phase === 'predicate') return this.renderPredicateGroups()
    return this.documents.map((doc, index) => this.renderDocument(doc, index))
  }

  private renderFooter(): TemplateResult {
    if (this.phase === 'options') {
      return html`<div class="footer"><span><kbd>Tab</kbd> move</span><span><kbd>Space</kbd> change</span><span><kbd>Enter</kbd> search</span></div>`
    }
    if (this.phase === 'document') {
      return html`<div class="footer"><span><kbd>Enter</kbd> link document</span><span><kbd>Tab</kbd> blocks</span><span><kbd>Esc</kbd> close</span></div>`
    }
    if (this.phase === 'block') {
      return html`<div class="footer"><span><kbd>Enter</kbd> link block</span><span><kbd>Left</kbd> documents</span></div>`
    }
    return html`<div class="footer"><span><kbd>Enter</kbd> choose predicate</span><span><kbd>Esc</kbd> back</span></div>`
  }

  render(): TemplateResult | typeof nothing {
    if (!this.open) return nothing
    return html`
      <div class="overlay" data-wire-picker-overlay @mousedown=${() => this.close()}></div>
      <section class="container" data-wire-picker role="dialog" aria-label="Create wire">
        ${this.renderSource()}
        ${this.renderHeader()}
        ${this.renderContext()}
        ${this.phase === 'options'
          ? this.renderOptionRows()
          : html`<div class="results" role="listbox">${this.renderResults()}</div>`}
        ${this.renderFooter()}
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-wire-picker': MnWirePicker
  }
}
