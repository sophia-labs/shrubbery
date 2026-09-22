/**
 * mn-node-link-picker - Garden's whiteboard node-link modal, shell-neutral.
 *
 * Garden collected documents/artifacts from filesystemStore. Shrubbery keeps
 * lookup in the shell: callers pass candidates and receive pick/close intents.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles, type IconName } from './icons.js'

export type MnNodeLinkKind = 'document' | 'artifact'

export interface MnNodeLinkCandidate {
  readonly kind: MnNodeLinkKind
  readonly id: string
  readonly title: string
  readonly mimeType?: string
  readonly iconName?: string
  readonly readOnly?: boolean
}

export interface MnNodeLinkPickDetail {
  readonly kind: MnNodeLinkKind
  readonly id: string
  readonly title: string
  readonly mimeType?: string
}

function eventModifiers(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

@customElement('mn-node-link-picker')
export class MnNodeLinkPicker extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      position: fixed;
      inset: 0;
      z-index: var(--mn-z-modal, 1400);
      display: none;
      align-items: center;
      justify-content: center;
      padding: var(--mn-space-4, 16px);
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
      display: flex;
      align-items: center;
      justify-content: center;
      padding: inherit;
      background: var(--mn-color-surface-overlay, rgba(0, 0, 0, 0.35));
      box-sizing: border-box;
    }

    .panel {
      position: relative;
      display: flex;
      width: min(520px, 92vw);
      max-height: min(70vh, calc(100dvh - var(--mn-space-8, 32px)));
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--mn-color-border-default, rgba(0, 0, 0, 0.13));
      border-radius: var(--mn-radius-xl, 12px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-primary, #18181b);
      box-shadow: var(--mn-shadow-modal, 0 12px 40px rgba(0, 0, 0, 0.25));
      font: inherit;
    }

    .head {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-2-5, 10px) var(--mn-space-3, 12px);
      border-bottom: 1px solid var(--mn-color-border-subtle, rgba(0, 0, 0, 0.07));
    }

    .head-icon {
      display: inline-flex;
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
      font-size: var(--mn-text-sm, 14px);
    }

    input::placeholder {
      color: var(--mn-color-text-muted, #71717a);
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

    .list {
      min-height: 0;
      overflow: auto;
      padding: var(--mn-space-1, 4px);
    }

    .row {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2-5, 10px);
      width: 100%;
      min-height: 36px;
      padding: var(--mn-space-2, 8px) var(--mn-space-2-5, 10px);
      border: 0;
      border-radius: var(--mn-radius-lg, 8px);
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      text-align: left;
      box-sizing: border-box;
    }

    .row:hover,
    .row.selected {
      background: var(--mn-color-surface-sunken, rgba(0, 0, 0, 0.05));
    }

    .row:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, #2563eb);
      outline-offset: -2px;
    }

    .row-icon {
      display: inline-flex;
      flex: 0 0 auto;
      color: var(--mn-color-text-muted, #71717a);
    }

    .title {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      color: var(--mn-color-text-primary, #18181b);
      font-size: var(--mn-text-sm, 13px);
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .badge {
      flex: 0 0 auto;
      color: var(--mn-color-text-secondary, #71717a);
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .empty {
      padding: var(--mn-space-5, 20px);
      color: var(--mn-color-text-secondary, #71717a);
      font-size: var(--mn-text-sm, 13px);
      text-align: center;
    }
  `

  @property({ type: Boolean, reflect: true }) open = false
  @property({ type: String }) query = ''
  @property({ type: Number }) selectedIndex = 0
  @property({ attribute: false }) candidates: readonly MnNodeLinkCandidate[] = []

  @query('[data-node-link-search]') private searchInput?: HTMLInputElement

  private focusPending = false

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('query') || changed.has('candidates')) this.clampSelectedIndex()
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

  private get filtered(): readonly MnNodeLinkCandidate[] {
    const q = normalize(this.query)
    const list = q
      ? this.candidates.filter(candidate => normalize(candidate.title).includes(q))
      : this.candidates
    return list.slice(0, 100)
  }

  private clampSelectedIndex(): void {
    const max = Math.max(0, this.filtered.length - 1)
    if (this.selectedIndex > max) this.selectedIndex = max
    if (this.selectedIndex < 0) this.selectedIndex = 0
  }

  private close(): void {
    if (!this.open) return
    this.open = false
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
    this.dispatchEvent(new CustomEvent('mn-close', { bubbles: true, composed: true }))
  }

  private pick(candidate: MnNodeLinkCandidate): void {
    const detail: MnNodeLinkPickDetail = {
      kind: candidate.kind,
      id: candidate.id,
      title: candidate.title,
      mimeType: candidate.mimeType,
    }
    this.dispatchEvent(new CustomEvent<MnNodeLinkPickDetail>('node-pick', { detail, bubbles: true, composed: true }))
    this.dispatchEvent(new CustomEvent<MnNodeLinkPickDetail>('mn-node-link-pick', { detail, bubbles: true, composed: true }))
  }

  private iconName(candidate: MnNodeLinkCandidate): IconName | string {
    if (candidate.iconName) return candidate.iconName
    if (candidate.kind === 'artifact') return 'package'
    return 'file-text'
  }

  private handleKeydown(event: KeyboardEvent): void {
    const items = this.filtered
    switch (event.key) {
      case 'Escape':
        eventModifiers(event)
        this.close()
        break
      case 'ArrowDown':
        eventModifiers(event)
        this.selectedIndex = Math.min(this.selectedIndex + 1, Math.max(0, items.length - 1))
        break
      case 'ArrowUp':
        eventModifiers(event)
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0)
        break
      case 'Enter': {
        const selected = items[this.selectedIndex] ?? items[0]
        if (!selected) return
        eventModifiers(event)
        this.pick(selected)
        break
      }
      default:
        break
    }
  }

  private renderRow(candidate: MnNodeLinkCandidate, index: number): TemplateResult {
    return html`
      <button
        type="button"
        class=${index === this.selectedIndex ? 'row selected' : 'row'}
        data-node-link-row
        data-node-link-kind=${candidate.kind}
        data-node-link-id=${candidate.id}
        aria-selected=${index === this.selectedIndex ? 'true' : 'false'}
        @mouseenter=${() => {
          this.selectedIndex = index
        }}
        @click=${() => this.pick(candidate)}
      >
        <span class="row-icon" aria-hidden="true">${icon(this.iconName(candidate), { size: 16 })}</span>
        <span class="title">${candidate.title}</span>
        <span class="badge">${candidate.kind}</span>
      </button>
    `
  }

  override render() {
    if (!this.open) return nothing
    const items = this.filtered
    return html`
      <div
        class="backdrop"
        data-node-link-picker
        @click=${(event: MouseEvent) => {
          if (event.target === event.currentTarget) this.close()
        }}
      >
        <section class="panel" role="dialog" aria-label="Link to a document or artifact" @keydown=${this.handleKeydown}>
          <header class="head">
            <span class="head-icon" aria-hidden="true">${icon('search', { size: 16 })}</span>
            <input
              data-node-link-search
              type="text"
              placeholder="Link to a document or artifact..."
              .value=${this.query}
              @input=${(event: Event) => {
                this.query = (event.target as HTMLInputElement).value
              }}
            />
            <button type="button" class="close" data-node-link-close title="Cancel" @click=${() => this.close()}>
              ${icon('x', { size: 16 })}
            </button>
          </header>
          <div class="list" role="listbox">
            ${items.length === 0
              ? html`<div class="empty">No matching nodes</div>`
              : items.map((candidate, index) => this.renderRow(candidate, index))}
          </div>
        </section>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-node-link-picker': MnNodeLinkPicker
  }
}
