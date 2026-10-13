/**
 * my-work-view-element.ts — `<sh-my-work-view>`, the body of the
 * `card.my-work` face (el Despacho W4, plans/2026-09-15-despacho-operational-memo.md
 * §2 "Do", §3 W4): the beads an office holds, grouped by status in the
 * ontology's own order, plus the beads gated on that office's open gates.
 * A room in the `dispatch` stance: every row a hyperlink that moves the
 * focus; counts as one honest line; no tiles. Read-only this wave (claim
 * and close are S6).
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { MyWorkBead, MyWorkGatedBead, MyWorkReading } from '../../despacho/mywork-reading.js'

export type MyWorkViewStatus = 'loading' | 'ready' | 'error'

const STATUS_LABELS: Readonly<Record<string, string>> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  composted: 'Composted',
}
const DONE_SHOWN = 20

function formatWhen(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(date)
}

@customElement('sh-my-work-view')
export class ShMyWorkView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      width: 100%;
      height: 100%;
      overflow: hidden;
      box-sizing: border-box;
      background: var(--mn-color-surface-base);
      color: var(--mn-color-text-primary);
      font: var(--mn-text-sm, 13px) / 1.5 var(--mn-font-chrome, system-ui, sans-serif);
    }
    .stage {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      overflow: auto;
      box-sizing: border-box;
      padding: clamp(16px, 4vw, 40px) clamp(16px, 5vw, 56px);
    }
    .room {
      max-width: 72ch;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-5, 20px);
    }
    .eyebrow {
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--mn-space-2, 8px);
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      font-variant-caps: all-small-caps;
      letter-spacing: var(--mn-tracking-label, 0.06em);
    }
    .eyebrow .kind {
      color: var(--mn-color-text-primary);
    }
    .title {
      margin: 0;
      font-family: var(--mn-font-display, var(--mn-font-chrome, serif));
      font-size: clamp(1.4rem, 1.1rem + 1.6vw, 2.3rem);
      font-weight: 600;
      line-height: 1.12;
      letter-spacing: -0.015em;
      text-wrap: balance;
    }
    .counts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 8px) var(--mn-space-4, 16px);
      font-variant-numeric: tabular-nums;
      color: var(--mn-color-text-secondary, var(--mn-color-text-muted));
    }
    .counts strong {
      color: var(--mn-color-text-primary);
      font-size: 1.15em;
    }
    section h2 {
      margin: 0 0 var(--mn-space-2, 8px);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      font-variant-caps: all-small-caps;
      letter-spacing: var(--mn-tracking-label, 0.06em);
      color: var(--mn-color-text-muted);
    }
    .rows {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: var(--mn-space-1, 4px) var(--mn-space-3, 12px);
      padding: var(--mn-space-2, 8px) 0;
      border-top: 1px solid var(--mn-color-border-subtle, var(--mn-color-border, #ddd));
      align-items: baseline;
    }
    .row:last-child {
      border-bottom: 1px solid var(--mn-color-border-subtle, var(--mn-color-border, #ddd));
    }
    .row a {
      color: inherit;
      text-decoration: none;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .row a:hover,
    .row a:focus-visible {
      text-decoration: underline;
    }
    .kindtag {
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
      font-variant-caps: all-small-caps;
      letter-spacing: 0.04em;
      min-width: 5.5ch;
    }
    .meta {
      grid-column: 2;
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--mn-space-2, 8px);
    }
    .empty {
      color: var(--mn-color-text-muted);
      font-style: italic;
    }
    .state {
      color: var(--mn-color-text-muted);
    }
    .state[data-tone='danger'] {
      color: var(--mn-color-status-danger, #a33);
    }
    .more {
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
    }
  `

  @property({ type: String }) status: MyWorkViewStatus = 'loading'
  @property({ type: String }) error = ''
  @property({ attribute: false }) reading: MyWorkReading | null = null
  @property({ attribute: false }) focusHref: (iri: string) => string = (iri) => `?focus=${encodeURIComponent(iri)}`

  private _state(message: string, tone: 'neutral' | 'danger' = 'neutral'): TemplateResult {
    return html`<div class="state" data-tone=${tone}>${message}</div>`
  }

  private _bead(bead: MyWorkBead): TemplateResult {
    return html`<li class="row mn-kind" data-kind="reference" data-bead=${bead.iri} data-status=${bead.status}>
      <span class="kindtag">${bead.kind ?? 'bead'}</span>
      <a href=${this.focusHref(bead.iri)}>${bead.title}</a>
      <div class="meta">
        ${bead.priority !== null ? html`<span>priority ${bead.priority}</span>` : nothing}
        ${bead.partTitle ? html`<span>in <a href=${this.focusHref(bead.partOf ?? '')}>${bead.partTitle}</a></span>` : nothing}
        ${bead.createdAt ? html`<span>strung ${formatWhen(bead.createdAt)}</span>` : nothing}
      </div>
    </li>`
  }

  private _gated(bead: MyWorkGatedBead): TemplateResult {
    return html`<li class="row mn-kind" data-kind="reference" data-bead=${bead.iri} data-gate=${bead.gate}>
      <span class="kindtag">${bead.kind ?? 'bead'}</span>
      <a href=${this.focusHref(bead.iri)}>${bead.title}</a>
      <div class="meta">
        <span>${bead.status.replace('_', ' ')}</span>
        <span>waits on <a href=${this.focusHref(bead.gate)}>${bead.gateTitle}</a></span>
      </div>
    </li>`
  }

  private _group(status: string, beads: readonly MyWorkBead[]): TemplateResult {
    const shown = status === 'done' ? beads.slice(0, DONE_SHOWN) : beads
    return html`<section aria-labelledby=${`group-${status}`} data-group=${status}>
      <h2 id=${`group-${status}`}>${STATUS_LABELS[status] ?? status} <span class="mn-kind" data-kind="metric">(${beads.length})</span></h2>
      <ul class="rows">${shown.map((b) => this._bead(b))}</ul>
      ${shown.length < beads.length ? html`<p class="more">${beads.length - shown.length} more, older.</p>` : nothing}
    </section>`
  }

  private _room(reading: MyWorkReading): TemplateResult {
    return html`<div class="room">
      <div class="eyebrow mn-kind" data-kind="identity">
        <span class="kind">my work</span>
        <span>held by ${reading.owner}</span>
      </div>
      <h1 class="title mn-kind" data-kind="identity">Held by ${reading.owner}</h1>
      <div class="counts mn-kind" data-kind="metric">
        <span><strong>${reading.counts.held}</strong> held</span>
        <span><strong>${reading.counts.open}</strong> open</span>
        <span><strong>${reading.counts.inProgress}</strong> in progress</span>
        <span><strong>${reading.counts.gatedOn}</strong> gated on ${reading.owner}</span>
      </div>
      ${reading.groups.length === 0 ? html`<p class="empty">${reading.owner} holds no beads in this graph.</p>` : reading.groups.map((g) => this._group(g.status, g.beads))}
      <section aria-labelledby="gated-heading" data-group="gated-on">
        <h2 id="gated-heading">Gated on ${reading.owner}</h2>
        ${reading.gatedOn.length === 0
          ? html`<p class="empty">Nothing waits on a word from ${reading.owner}.</p>`
          : html`<ul class="rows">${reading.gatedOn.map((b) => this._gated(b))}</ul>`}
      </section>
    </div>`
  }

  private _body(): TemplateResult {
    if (this.status === 'loading') return this._state('Gathering the work…')
    if (this.status === 'error') return this._state(this.error || 'The work could not be gathered.', 'danger')
    if (!this.reading) return this._state('Nothing to show.')
    return this._room(this.reading)
  }

  render(): TemplateResult {
    return html`<div class="stage" role="region" data-stance="dispatch" aria-label=${this.reading ? `Work held by ${this.reading.owner}` : 'My work'}>
      ${this._body()}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-my-work-view': ShMyWorkView
  }
}
