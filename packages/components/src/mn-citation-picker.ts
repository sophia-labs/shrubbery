/**
 * mn-citation-picker - controlled citation search modal for Garden's /cite flow.
 *
 * Garden's original picker queried Zotero through ApiClient and handed the
 * result to document-editor. Shrubbery keeps the modal and keyboard behavior
 * here, while the shell owns search, source materialization, grounding wires,
 * and editor insertion.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'

export interface MnCitationItem {
  readonly key: string
  readonly title: string
  readonly citation?: string
  readonly itemType?: string
  readonly creatorSummary?: string
  readonly year?: string
}

export interface MnCitationSearchDetail {
  readonly query: string
}

export interface MnCitationPickDetail {
  readonly item: MnCitationItem
}

function stop(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
}

function itemMeta(item: MnCitationItem): string {
  return [
    item.citation?.trim(),
    item.itemType?.trim(),
  ].filter(Boolean).join(' - ')
}

@customElement('mn-citation-picker')
export class MnCitationPicker extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      position: fixed;
      inset: 0;
      z-index: var(--mn-z-modal, 1400);
      display: none;
      align-items: flex-start;
      justify-content: center;
      padding: 18vh var(--mn-space-4, 16px) var(--mn-space-4, 16px);
      box-sizing: border-box;
      color: var(--mn-color-text-primary, #18181b);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
    }

    :host([open]) {
      display: flex;
    }

    .backdrop {
      position: absolute;
      inset: 0;
      background: transparent;
    }

    .panel {
      position: relative;
      display: flex;
      width: min(560px, 92vw);
      max-height: min(62vh, calc(100dvh - 96px));
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--mn-color-border-default, rgba(0, 0, 0, 0.13));
      border-radius: var(--mn-radius-xl, 12px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #18181b);
      box-shadow: var(--mn-shadow-modal, 0 12px 40px rgba(0, 0, 0, 0.18));
      font: inherit;
    }

    .search {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-3, 12px) var(--mn-space-3-5, 14px);
      border-bottom: 1px solid var(--mn-color-border-subtle, rgba(0, 0, 0, 0.08));
    }

    .search-icon {
      display: inline-flex;
      flex: 0 0 auto;
      color: var(--mn-color-text-muted, #71717a);
    }

    input {
      flex: 1 1 auto;
      min-width: 0;
      border: 0;
      outline: none;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: var(--mn-text-md, 15px);
    }

    input::placeholder {
      color: var(--mn-color-text-muted, #71717a);
    }

    .hint {
      flex: 0 0 auto;
      color: var(--mn-color-text-muted, #71717a);
      font-size: var(--mn-text-2xs, 10px);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      flex: 0 0 auto;
      padding: 0;
      border: 0;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: inherit;
      cursor: pointer;
    }

    .close:hover,
    .close:focus-visible {
      background: var(--mn-color-surface-hover, rgba(0, 0, 0, 0.06));
      outline: none;
    }

    .results {
      min-height: 0;
      overflow-y: auto;
      padding: var(--mn-space-1, 4px);
    }

    .item {
      display: flex;
      width: 100%;
      flex-direction: column;
      gap: 2px;
      padding: var(--mn-space-2-5, 10px) var(--mn-space-3, 12px);
      border: 0;
      border-radius: var(--mn-radius-lg, 8px);
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      text-align: left;
    }

    .item:hover,
    .item.selected {
      background: var(--mn-color-surface-sunken, rgba(0, 0, 0, 0.05));
    }

    .item:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, #2563eb);
      outline-offset: -2px;
    }

    .title {
      overflow: hidden;
      color: var(--mn-color-text-primary, #18181b);
      font-size: var(--mn-text-sm, 14px);
      font-weight: 550;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta {
      overflow: hidden;
      color: var(--mn-color-text-secondary, #71717a);
      font-size: var(--mn-text-xs, 12px);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .state {
      padding: var(--mn-space-5, 20px);
      color: var(--mn-color-text-secondary, #71717a);
      font-size: var(--mn-text-sm, 13px);
      text-align: center;
    }

    .state.error {
      color: var(--mn-color-danger-700, #b91c1c);
    }
  `

  @property({ type: Boolean, reflect: true }) open = false
  @property({ type: String }) query = ''
  @property({ type: Boolean }) loading = false
  @property({ type: String }) error = ''
  @property({ type: Number }) selectedIndex = 0
  @property({ attribute: false }) results: readonly MnCitationItem[] = []

  @query('[data-citation-search]') private searchInput?: HTMLInputElement

  private focusPending = false

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('results') || changed.has('selectedIndex')) this.clampSelectedIndex()
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('open') && this.open) this.focusPending = true
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

  private clampSelectedIndex(): void {
    const max = Math.max(0, this.results.length - 1)
    if (this.selectedIndex > max) this.selectedIndex = max
    if (this.selectedIndex < 0) this.selectedIndex = 0
  }

  private close(): void {
    if (!this.open) return
    this.open = false
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
    this.dispatchEvent(new CustomEvent('mn-close', { bubbles: true, composed: true }))
  }

  private search(value: string): void {
    this.query = value
    this.selectedIndex = 0
    this.dispatchEvent(new CustomEvent<MnCitationSearchDetail>('mn-citation-search', {
      detail: { query: value },
      bubbles: true,
      composed: true,
    }))
  }

  private pick(item: MnCitationItem): void {
    this.dispatchEvent(new CustomEvent<MnCitationPickDetail>('mn-citation-pick', {
      detail: { item },
      bubbles: true,
      composed: true,
    }))
    this.close()
  }

  private handleKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        stop(event)
        this.close()
        break
      case 'ArrowDown':
        stop(event)
        this.selectedIndex = Math.min(this.selectedIndex + 1, Math.max(0, this.results.length - 1))
        break
      case 'ArrowUp':
        stop(event)
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
        break
      case 'Enter': {
        const item = this.results[this.selectedIndex] ?? this.results[0]
        if (!item) return
        stop(event)
        this.pick(item)
        break
      }
      default:
        break
    }
  }

  private renderItem(item: MnCitationItem, index: number): TemplateResult {
    return html`
      <button
        type="button"
        class=${index === this.selectedIndex ? 'item selected' : 'item'}
        data-citation-row
        data-citation-key=${item.key}
        aria-selected=${index === this.selectedIndex ? 'true' : 'false'}
        @mouseenter=${() => {
          this.selectedIndex = index
        }}
        @click=${() => this.pick(item)}
      >
        <span class="title">${item.title || item.key}</span>
        <span class="meta">${itemMeta(item) || item.creatorSummary || item.year || item.itemType || 'reference'}</span>
      </button>
    `
  }

  private renderResults(): unknown {
    if (this.loading) return html`<div class="state">Searching...</div>`
    if (this.error) return html`<div class="state error">${this.error}</div>`
    if (!this.query.trim()) return html`<div class="state">Type to search the library.</div>`
    if (this.results.length === 0) return html`<div class="state">No matches.</div>`
    return this.results.map((item, index) => this.renderItem(item, index))
  }

  override render() {
    if (!this.open) return nothing
    return html`
      <div class="backdrop" @click=${() => this.close()}></div>
      <section
        class="panel"
        data-citation-picker
        role="dialog"
        aria-label="Search citation sources"
        @keydown=${this.handleKeydown}
      >
        <header class="search">
          <span class="search-icon" aria-hidden="true">${icon('search', { size: 16 })}</span>
          <input
            data-citation-search
            type="text"
            placeholder="Search your Zotero library..."
            .value=${this.query}
            @input=${(event: Event) => this.search((event.target as HTMLInputElement).value)}
          />
          <span class="hint">Arrows / Enter</span>
          <button type="button" class="close" title="Cancel" data-citation-close @click=${() => this.close()}>
            ${icon('x', { size: 16 })}
          </button>
        </header>
        <div class="results" role="listbox">
          ${this.renderResults()}
        </div>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-citation-picker': MnCitationPicker
  }
}
