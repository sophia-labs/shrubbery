/**
 * mn-research-source-chip - small controlled source/status atom for research UI.
 *
 * It carries paper/source adapter identity without owning retrieval. Hosts pass a
 * resolved label/kind/status/score and listen for the composed select intent.
 */

import { LitElement, css, html, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { ifDefined } from 'lit/directives/if-defined.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles, type IconName } from './icons.js'

export type MnResearchSourceKind =
  | 'paper'
  | 'preprint'
  | 'book'
  | 'dataset'
  | 'web'
  | 'workspace'
  | 'zotero'
  | 'other'

export type MnResearchSourceStatus = 'queued' | 'searching' | 'ready' | 'selected' | 'error'

export interface MnResearchSourceChipDetail {
  readonly id: string
  readonly label: string
  readonly kind: MnResearchSourceKind
  readonly status: MnResearchSourceStatus
}

function iconForKind(kind: MnResearchSourceKind): IconName {
  switch (kind) {
    case 'book':
      return 'book-open'
    case 'dataset':
      return 'database'
    case 'web':
      return 'external-link'
    case 'workspace':
      return 'network'
    case 'zotero':
      return 'package'
    case 'preprint':
      return 'file-text'
    case 'paper':
    case 'other':
    default:
      return 'file-text'
  }
}

function cleanScore(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score)) return ''
  const normalized = score > 1 ? score / 100 : score
  return `${Math.round(Math.max(0, Math.min(1, normalized)) * 100)}%`
}

@customElement('mn-research-source-chip')
export class MnResearchSourceChip extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: inline-flex;
      max-width: 100%;
      color: var(--mn-color-text-secondary, #374151);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 12px);
    }

    .chip {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      min-height: 24px;
      gap: var(--mn-space-1-5, 6px);
      box-sizing: border-box;
      padding: 0 var(--mn-space-2, 8px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-full, 999px);
      background: var(--mn-color-surface-raised, #fff);
      color: inherit;
      font: inherit;
      white-space: nowrap;
    }

    button.chip {
      cursor: pointer;
    }

    button.chip:hover {
      border-color: var(--mn-color-border-default, #d1d5db);
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
    }

    button.chip:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, #2563eb);
      outline-offset: 2px;
    }

    .kind-icon,
    .dot {
      display: inline-flex;
      flex: 0 0 auto;
    }

    .kind-icon {
      color: var(--mn-color-text-tertiary, #6b7280);
      line-height: 0;
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--mn-color-text-tertiary, #9ca3af);
    }

    .label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .score {
      flex: 0 0 auto;
      color: var(--mn-color-text-tertiary, #6b7280);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
    }

    .status-ready .dot {
      background: var(--mn-color-success, #16a34a);
    }

    .status-selected {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent, #2563eb));
      color: var(--mn-color-text-accent, var(--mn-color-accent, #2563eb));
    }

    .status-selected .kind-icon,
    .status-selected .dot {
      color: var(--mn-color-accent, #2563eb);
      background: var(--mn-color-accent, #2563eb);
    }

    .status-searching .dot {
      background: var(--mn-color-warning, #d97706);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--mn-color-warning, #d97706) 16%, transparent);
    }

    .status-error {
      border-color: var(--mn-color-danger, #be123c);
      color: var(--mn-color-danger, #be123c);
    }

    .status-error .dot {
      background: var(--mn-color-danger, #be123c);
    }

    :host([data-skin='emporium']) .chip {
      border-radius: var(--mn-radius-surface, 4px);
      text-transform: uppercase;
    }
  `

  @property({ type: String }) sourceId = ''
  @property({ type: String }) label = ''
  @property({ type: String }) kind: MnResearchSourceKind = 'paper'
  @property({ type: String }) status: MnResearchSourceStatus = 'ready'
  @property({ type: Number }) score: number | null = null
  @property({ type: Boolean, reflect: true }) interactive = false

  private detail(): MnResearchSourceChipDetail {
    return {
      id: this.sourceId,
      label: this.label,
      kind: this.kind,
      status: this.status,
    }
  }

  private select(): void {
    if (!this.interactive) return
    this.dispatchEvent(
      new CustomEvent<MnResearchSourceChipDetail>('mn-research-source-chip-select', {
        detail: this.detail(),
        bubbles: true,
        composed: true,
      }),
    )
  }

  private body() {
    const score = cleanScore(this.score)
    return html`
      <span class="kind-icon" aria-hidden="true">${icon(iconForKind(this.kind), { size: 13 })}</span>
      <span class="dot" aria-hidden="true"></span>
      <span class="label">${this.label || this.kind}</span>
      <span class="score" ?hidden=${!score}>${score}</span>
    `
  }

  override render() {
    const classes = {
      chip: true,
      [`status-${this.status}`]: true,
    }
    const title = `${this.label || this.kind} - ${this.status}`

    return this.interactive
      ? html`
          <button
            class=${classMap(classes)}
            type="button"
            title=${title}
            aria-label=${title}
            @click=${this.select}
          >
            ${this.body()}
          </button>
        `
      : html`
          <span class=${classMap(classes)} title=${ifDefined(title)}>
            ${this.body()}
          </span>
        `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-research-source-chip': MnResearchSourceChip
  }
}
