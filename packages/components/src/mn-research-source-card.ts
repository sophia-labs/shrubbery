/**
 * mn-research-source-card - controlled paper/source candidate molecule.
 *
 * Hosts own search/retrieval and pass resolved source records. The card renders
 * provenance-friendly metadata and emits select/open/promote intents.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import './mn-chip.js'
import './mn-research-source-chip.js'
import type { MnResearchSourceKind, MnResearchSourceStatus } from './mn-research-source-chip.js'

export interface MnResearchSource {
  readonly id: string
  readonly title: string
  readonly kind?: MnResearchSourceKind
  readonly status?: MnResearchSourceStatus
  readonly adapter?: string | null
  readonly authors?: readonly string[]
  readonly year?: string | null
  readonly venue?: string | null
  readonly abstract?: string | null
  readonly tags?: readonly string[]
  readonly score?: number | null
  readonly citationCount?: number | null
  readonly url?: string | null
  readonly note?: string | null
}

export interface MnResearchSourceCardDetail {
  readonly sourceId: string
  readonly source: MnResearchSource
}

function text(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function byline(source: MnResearchSource): string {
  return [
    source.authors?.filter(Boolean).join(', '),
    text(source.year),
    text(source.venue),
  ].filter(Boolean).join(' - ')
}

@customElement('mn-research-source-card')
export class MnResearchSourceCard extends SkinAware(LitElement) {
  static styles = css`
    ${unsafeCSS(iconStyles)}

    :host {
      display: block;
      min-width: 0;
      color: var(--mn-color-text-primary, #111827);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-sm, 13px);
    }

    article {
      display: grid;
      gap: var(--mn-space-3, 12px);
      min-width: 0;
      box-sizing: border-box;
      padding: var(--mn-space-4, 16px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-surface, var(--mn-radius-lg, 8px));
      background: var(--mn-color-surface-raised, #fff);
      box-shadow: var(--mn-shadow-card, none);
    }

    article.selected {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent, #2563eb));
      box-shadow:
        inset 3px 0 0 var(--mn-color-accent, #2563eb),
        var(--mn-shadow-card, 0 0 0 rgba(0, 0, 0, 0));
    }

    header {
      display: grid;
      min-width: 0;
      gap: var(--mn-space-2, 8px);
    }

    .topline,
    .actions,
    .metrics,
    .tags {
      display: flex;
      align-items: center;
      min-width: 0;
      gap: var(--mn-space-2, 8px);
    }

    .topline {
      justify-content: space-between;
    }

    .actions {
      flex: 0 0 auto;
    }

    h3 {
      margin: 0;
      color: var(--mn-color-text-primary, #111827);
      font-size: var(--mn-text-base, 15px);
      font-weight: 650;
      letter-spacing: 0;
      line-height: 1.35;
    }

    .meta,
    .abstract,
    .note,
    .metric {
      color: var(--mn-color-text-secondary, #4b5563);
      line-height: 1.45;
    }

    .meta {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .abstract {
      display: -webkit-box;
      overflow: hidden;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
    }

    .note {
      padding-inline-start: var(--mn-space-3, 12px);
      border-inline-start: 2px solid var(--mn-color-border-accent, var(--mn-color-accent, #2563eb));
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
    }

    .metric {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      color: var(--mn-color-text-tertiary, #6b7280);
      font-size: var(--mn-text-xs, 12px);
    }

    .tags {
      flex-wrap: wrap;
    }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--mn-control-height, 28px);
      height: var(--mn-control-height, 28px);
      padding: 0;
      border: 1px solid transparent;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
      cursor: pointer;
      font: inherit;
    }

    button:hover:not(:disabled),
    button:focus-visible:not(:disabled) {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111827);
      outline: none;
    }

    button:focus-visible {
      outline: 2px solid var(--mn-focus-ring-color, #2563eb);
      outline-offset: 2px;
    }

    button.primary {
      border-color: var(--mn-color-border-default, #d1d5db);
    }

    :host([compact]) article {
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-3, 12px);
    }

    :host([compact]) .abstract,
    :host([compact]) .note {
      display: none;
    }

    :host([data-skin='emporium']) article {
      border-radius: var(--mn-radius-surface, 4px);
    }
  `

  @property({ attribute: false }) source: MnResearchSource | null = null
  @property({ type: Boolean, reflect: true }) selected = false
  @property({ type: Boolean, reflect: true }) compact = false
  @property({ type: Boolean, attribute: 'hide-actions' }) hideActions = false

  private detail(source: MnResearchSource): MnResearchSourceCardDetail {
    return { sourceId: source.id, source }
  }

  private emit(name: string, source: MnResearchSource): void {
    this.dispatchEvent(
      new CustomEvent<MnResearchSourceCardDetail>(name, {
        detail: this.detail(source),
        bubbles: true,
        composed: true,
      }),
    )
  }

  private status(source: MnResearchSource): MnResearchSourceStatus {
    return this.selected ? 'selected' : source.status ?? 'ready'
  }

  override render() {
    const source = this.source
    if (!source) return html`<article><mn-research-source-chip label="No source" status="queued"></mn-research-source-chip></article>`

    const tags = source.tags ?? []
    const meta = byline(source)
    const abstract = text(source.abstract)
    const note = text(source.note)

    return html`
      <article class=${classMap({ selected: this.selected })} data-source-id=${source.id}>
        <header>
          <div class="topline">
            <mn-research-source-chip
              .sourceId=${source.id}
              .label=${source.adapter || source.kind || 'source'}
              .kind=${source.kind ?? 'paper'}
              .status=${this.status(source)}
              .score=${source.score ?? null}
              interactive
              @mn-research-source-chip-select=${() => this.emit('mn-research-source-select', source)}
            ></mn-research-source-chip>
            ${this.hideActions ? nothing : html`
              <div class="actions">
                <button
                  class="primary"
                  type="button"
                  title="Select source"
                  aria-label="Select source"
                  @click=${() => this.emit('mn-research-source-select', source)}
                >
                  ${icon('check', { size: 14 })}
                </button>
                <button
                  type="button"
                  title="Open source"
                  aria-label="Open source"
                  @click=${() => this.emit('mn-research-source-open', source)}
                >
                  ${icon(source.url ? 'external-link' : 'corner-up-right', { size: 14 })}
                </button>
                <button
                  type="button"
                  title="Promote to brief"
                  aria-label="Promote to brief"
                  @click=${() => this.emit('mn-research-source-promote', source)}
                >
                  ${icon('bookmark', { size: 14 })}
                </button>
              </div>
            `}
          </div>
          <h3>${source.title}</h3>
          ${meta ? html`<div class="meta">${meta}</div>` : nothing}
        </header>

        ${abstract ? html`<div class="abstract">${abstract}</div>` : nothing}
        ${note ? html`<div class="note">${note}</div>` : nothing}

        <div class="metrics">
          ${source.citationCount !== null && source.citationCount !== undefined
            ? html`<span class="metric">${icon('quote', { size: 13 })}${source.citationCount} cites</span>`
            : nothing}
          ${source.url ? html`<span class="metric">${icon('link', { size: 13 })}source URL</span>` : nothing}
        </div>

        ${tags.length > 0
          ? html`
              <div class="tags">
                ${repeat(tags, (tag) => tag, (tag) => html`<mn-chip tone="muted" .label=${tag}></mn-chip>`)}
              </div>
            `
          : nothing}
      </article>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-research-source-card': MnResearchSourceCard
  }
}
