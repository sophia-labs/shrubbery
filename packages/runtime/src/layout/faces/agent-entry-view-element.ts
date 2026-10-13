/**
 * agent-entry-view-element.ts — `<sh-agent-entry-view>`, the body of the
 * `card.agent` face (el Despacho W11, the roster pokédex). A seat of the
 * correo canon is rendered as a CATALOGUE ENTRY: a dex band (type, habitat,
 * the status stamped honestly with its basis), the name carrying the page,
 * an identity block (the IRI, the slug, the agent identity the host minted),
 * a stat block (runs by state, letters in/out/awaiting, moves, beads held),
 * the entry text (the card, verbatim), the moves with their contracts and
 * confidences, the rules (never / seals), the lineage (parent, ancestor,
 * heirs, provenance), and the attestation said plainly. In `tile` mode it is
 * one tile of the gallery: name, type chip, status chip, one line of scope,
 * moves, last run in plain words — the whole tile a focus link.
 *
 * Dumb about data (every face/view split in this directory): renders an
 * already-folded `AgentEntry`; the queries live in ../../despacho/. Every
 * kinded element is stamped `data-kind` from the nucleus DisplayKind register
 * and the stage is stamped `data-stance="dispatch"`; the kind rules are
 * reproduced against the same `--mn-kind-*` tokens because `kind.css` does not
 * light inside a shadow root (object-card-view-element.ts's header).
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { AgentEntry } from '../../despacho/agent-reading.js'
import { formatAgo } from './seat-character-view-element.js'

export type AgentViewStatus = 'loading' | 'ready' | 'error'
export type AgentViewMode = 'chapter' | 'tile'

function formatWhen(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/** The entry's slug: the last segment of a `…:seat:<id>` IRI, else the IRI's tail. */
export function entrySlug(iri: string): string {
  const at = iri.lastIndexOf(':seat:')
  if (at >= 0) return iri.slice(at + ':seat:'.length)
  return iri.split(/[:/#]/).pop() ?? iri
}

@customElement('sh-agent-entry-view')
export class ShAgentEntryView extends LitElement {
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
    :host([mode='tile']) .stage {
      padding: 0;
      overflow: hidden;
    }
    .entry {
      max-width: 72ch;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-4, 16px);
    }
    /* ── the dex band ── */
    .band {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-2, 8px) 0;
      border-top: 3px solid var(--mn-kind-identity-text, var(--mn-color-text-primary));
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      font-variant-caps: all-small-caps;
      letter-spacing: var(--mn-tracking-label, 0.06em);
    }
    .band .type {
      color: var(--mn-color-text-primary);
    }
    .band .habitat {
      font-variant-caps: normal;
      font-weight: 500;
      letter-spacing: 0;
      flex-basis: 100%;
    }
    .title {
      margin: 0;
      font-family: var(--mn-font-display, var(--mn-font-chrome, serif));
      font-size: clamp(1.5rem, 1.1rem + 1.8vw, 2.5rem);
      font-weight: 600;
      line-height: 1.1;
      letter-spacing: -0.015em;
      text-wrap: balance;
      overflow-wrap: anywhere;
    }
    .identity {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.15em var(--mn-space-3, 12px);
      color: var(--mn-color-text-muted);
      font-family: var(--mn-font-mono, monospace);
      font-size: var(--mn-text-xs, 12px);
      overflow-wrap: anywhere;
    }
    .identity dt {
      color: var(--mn-color-text-tertiary);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-variant-caps: all-small-caps;
      letter-spacing: 0.06em;
    }
    .identity dd {
      margin: 0;
    }
    /* ── the stat block ── */
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
      gap: var(--mn-space-3, 12px) var(--mn-space-4, 16px);
      padding: var(--mn-space-3, 12px) 0;
      border-top: 1px solid var(--mn-color-border-subtle);
      border-bottom: 1px solid var(--mn-color-border-subtle);
    }
    .stat {
      display: flex;
      flex-direction: column;
      gap: 0.1em;
    }
    .stat .n {
      font-family: var(--mn-font-display, var(--mn-font-chrome, serif));
      font-size: 1.6rem;
      font-weight: 600;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .stat .label {
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
      font-variant-caps: all-small-caps;
      letter-spacing: 0.06em;
    }
    .stat .detail {
      color: var(--mn-color-text-tertiary);
      font-size: var(--mn-text-xs, 12px);
    }
    .pill {
      display: inline-block;
      padding: 0.1em 0.6em;
      border-radius: 999px;
      border: 1px solid var(--mn-color-border-subtle);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: lowercase;
      font-variant-caps: normal;
    }
    .pill[data-dormancy='retired'],
    .pill[data-dormancy='dormant'] {
      color: var(--mn-color-danger-strong, currentColor);
      border-color: currentColor;
    }
    .pill[data-dormancy='silent'] {
      color: var(--mn-color-warning-strong, currentColor);
      border-color: currentColor;
    }
    .basis {
      color: var(--mn-color-text-tertiary);
      font-variant-caps: normal;
      font-weight: 500;
      letter-spacing: 0;
    }
    h2 {
      margin: 0 0 var(--mn-space-2, 8px);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      color: var(--mn-color-text-muted);
      font-variant-caps: all-small-caps;
      letter-spacing: var(--mn-tracking-label, 0.06em);
    }
    .verbatim {
      margin: 0;
      padding: var(--mn-space-3, 12px) var(--mn-space-4, 16px);
      border-left: 3px solid var(--mn-kind-prose-text, var(--mn-color-border-subtle));
      font-family: var(--mn-font-display, var(--mn-font-chrome, serif));
      font-size: var(--mn-text-md, 1rem);
      line-height: 1.55;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    p {
      margin: 0;
      overflow-wrap: anywhere;
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-2, 8px);
    }
    .moves li {
      padding-left: var(--mn-space-3, 12px);
      border-left: 2px solid var(--mn-color-border-subtle);
    }
    .move-head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 8px);
      align-items: baseline;
    }
    .move-text {
      overflow-wrap: anywhere;
    }
    .muted {
      color: var(--mn-color-text-muted);
    }
    .lineage li,
    .lineage a {
      overflow-wrap: anywhere;
    }
    .lineage a,
    .tile a {
      color: var(--mn-kind-reference-text, var(--mn-color-text-primary));
      text-decoration: underline;
      text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
      text-underline-offset: 0.14em;
    }
    .attestation {
      color: var(--mn-kind-testimony-text, var(--mn-color-text-muted));
      font-size: var(--mn-text-xs, 12px);
    }
    .state {
      display: grid;
      flex: 1 1 auto;
      place-content: center;
      padding: var(--mn-space-4, 16px);
      color: var(--mn-color-text-tertiary);
      text-align: center;
    }
    .state[data-tone='danger'] {
      color: var(--mn-color-danger-strong);
    }
    /* ── the tile ── */
    .tile {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-1, 4px);
      height: 100%;
      box-sizing: border-box;
      padding: var(--mn-space-3, 12px) var(--mn-space-4, 16px);
      border-top: 3px solid var(--mn-kind-identity-text, var(--mn-color-text-primary));
    }
    .tile a.name {
      display: block;
      text-decoration: none;
      color: inherit;
      font-family: var(--mn-font-display, var(--mn-font-chrome, serif));
      font-size: var(--mn-text-md, 1rem);
      font-weight: 600;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .tile a.name:hover,
    .tile a.name:focus-visible {
      text-decoration: underline;
      text-underline-offset: 0.12em;
    }
    .tile .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-1, 4px) var(--mn-space-2, 8px);
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      font-variant-caps: all-small-caps;
      letter-spacing: 0.06em;
    }
    .tile .scope {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
    }
    .tile .foot {
      margin-top: auto;
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 8px);
      color: var(--mn-color-text-tertiary);
      font-size: var(--mn-text-xs, 12px);
      font-variant-numeric: tabular-nums;
    }
    .mn-kind[data-kind='identity'] { --mn-kind-register-current: identity; }
    .mn-kind[data-kind='state'] { --mn-kind-register-current: state; }
    .mn-kind[data-kind='metric'] { --mn-kind-register-current: metric; }
    .mn-kind[data-kind='prose'] { --mn-kind-register-current: prose; }
    .mn-kind[data-kind='reference'] { --mn-kind-register-current: reference; }
    .mn-kind[data-kind='testimony'] { --mn-kind-register-current: testimony; }
  `

  @property({ type: String, reflect: true }) mode: AgentViewMode = 'chapter'
  @property({ type: String }) status: AgentViewStatus = 'loading'
  @property({ type: String }) error = ''
  @property({ type: String }) subjectIri = ''
  @property({ attribute: false }) entry: AgentEntry | null = null
  @property({ attribute: false }) focusHref: (iri: string) => string = (iri) => `?focus=${encodeURIComponent(iri)}`
  /** Injected clock for deterministic relative times in tests. */
  @property({ attribute: false }) now: () => Date = () => new Date()

  private _state(message: string, tone: 'neutral' | 'danger' = 'neutral'): TemplateResult {
    return html`<div class="state" data-tone=${tone}>${message}</div>`
  }

  private _lastRun(entry: AgentEntry): { readonly when: string | null; readonly claimed: boolean } {
    const recorded = entry.runStats.lastAt ?? entry.seat.recentRuns[0]?.at ?? null
    if (recorded) return { when: recorded, claimed: false }
    return { when: entry.seat.lastRunAt, claimed: entry.seat.lastRunAt !== null }
  }

  private _tile(entry: AgentEntry): TemplateResult {
    const seat = entry.seat
    const last = this._lastRun(entry)
    return html`<div class="tile" data-dormancy=${entry.dormancy}>
      <div class="chips mn-kind" data-kind="identity">
        <span class="type">${seat.seatKind ?? 'seat'}</span>
        <span class="pill mn-kind" data-kind="state" data-dormancy=${entry.dormancy}>${entry.dormancy}</span>
      </div>
      <a class="name mn-kind" data-kind="identity" href=${this.focusHref(seat.subject)} data-entry=${seat.subject}>${seat.title}</a>
      ${seat.mandate || seat.scope ? html`<div class="scope mn-kind" data-kind="prose">${seat.mandate ?? seat.scope}</div>` : nothing}
      <div class="foot mn-kind" data-kind="metric">
        ${seat.capabilities.length > 0 ? html`<span>${seat.capabilities.length} moves</span>` : nothing}
        ${seat.lettersIn + seat.lettersOut > 0 ? html`<span>${seat.lettersIn} in · ${seat.lettersOut} out</span>` : nothing}
        ${last.when ? html`<span title=${last.claimed ? 'as its source claimed at fold time' : 'recorded run'}>ran ${formatAgo(last.when, this.now())}${last.claimed ? ' (claimed)' : ''}</span>` : html`<span>no run recorded</span>`}
      </div>
    </div>`
  }

  private _stats(entry: AgentEntry): TemplateResult {
    const seat = entry.seat
    const runs = entry.runStats
    const last = this._lastRun(entry)
    return html`<div class="stats mn-kind" data-kind="metric">
      <div class="stat" data-stat="runs">
        <span class="n">${runs.total}</span>
        <span class="label">runs recorded</span>
        <span class="detail">${runs.completed} completed · ${runs.failed} failed · ${runs.open} open</span>
      </div>
      <div class="stat" data-stat="last-run">
        <span class="n">${last.when ? formatAgo(last.when, this.now()) : '—'}</span>
        <span class="label">last run</span>
        <span class="detail">${last.when ? `${formatWhen(last.when)}${last.claimed ? ' · as its source claimed at fold time' : ''}` : 'none recorded'}</span>
      </div>
      <div class="stat" data-stat="letters">
        <span class="n">${seat.lettersIn}</span>
        <span class="label">letters in</span>
        <span class="detail">${seat.lettersOut} out · ${seat.unacknowledged} awaiting its acknowledgement</span>
      </div>
      <div class="stat" data-stat="moves">
        <span class="n">${seat.capabilities.length}</span>
        <span class="label">moves</span>
        <span class="detail">${seat.seals.length} seal${seat.seals.length === 1 ? '' : 's'}${seat.jail ? ' · one never' : ''}</span>
      </div>
      <div class="stat" data-stat="beads">
        <span class="n">${seat.heldBeads.length}</span>
        <span class="label">beads held</span>
        <span class="detail">${seat.heldBeads.length === 0 ? 'beads name holders by office, not by seat, today' : `${seat.heldBeads.filter((b) => b.status === 'done').length} done`}</span>
      </div>
    </div>`
  }

  private _chapter(entry: AgentEntry): TemplateResult {
    const seat = entry.seat
    const slug = entrySlug(seat.subject)
    return html`<div class="entry">
      <div class="band mn-kind" data-kind="identity">
        <span class="type">${seat.seatKind ?? 'seat'}</span>
        <span class="pill mn-kind" data-kind="state" data-dormancy=${entry.dormancy}>${entry.dormancy}</span>
        <span class="basis mn-kind" data-kind="testimony">${entry.dormancyBasis}</span>
        <span class="habitat mn-kind" data-kind="reference" data-habitat>${entry.habitat}</span>
      </div>
      <h1 class="title mn-kind" data-kind="identity">${seat.title}</h1>
      <dl class="identity mn-kind" data-kind="identity">
        <dt>entry</dt><dd>${slug}</dd>
        <dt>iri</dt><dd>${seat.subject}</dd>
        ${seat.agentUri ? html`<dt>agent</dt><dd data-agent-uri>${seat.agentUri}</dd>` : nothing}
        ${seat.model ? html`<dt>model</dt><dd>${seat.model}</dd>` : nothing}
        ${seat.trigger ? html`<dt>woken by</dt><dd>${seat.trigger}</dd>` : nothing}
        ${seat.parent ? html`<dt>under</dt><dd><a href=${this.focusHref(seat.parent.iri)} data-parent=${seat.parent.iri}>${seat.parent.seatId}</a></dd>` : nothing}
      </dl>
      ${this._stats(entry)}
      ${seat.mandate ? html`<p class="mn-kind" data-kind="prose" data-mandate>${seat.mandate}</p>` : nothing}
      ${seat.scope && seat.scope !== seat.mandate ? html`<p class="muted mn-kind" data-kind="prose">${seat.scope}</p>` : nothing}
      ${seat.card
        ? html`<section class="mn-kind" data-kind="prose" aria-labelledby="entry-text-heading">
            <h2 id="entry-text-heading">The entry, in its own words</h2>
            <blockquote class="verbatim">${seat.card}</blockquote>
          </section>`
        : nothing}
      <section class="moves mn-kind" data-kind="reference" aria-labelledby="moves-heading">
        <h2 id="moves-heading">${seat.capabilities.length === 0 ? 'Moves' : seat.capabilities.length === 1 ? 'One move' : `${seat.capabilities.length} moves`}</h2>
        ${seat.capabilities.length > 0
          ? html`<ul>
              ${seat.capabilities.map(
                (move) => html`<li data-capability=${move.iri}>
                  <div class="move-head"><strong>${move.name}</strong>${move.confidence ? html`<span class="muted">confidence ${move.confidence}</span>` : nothing}${move.mergeVerdict ? html`<span class="pill">${move.mergeVerdict}</span>` : nothing}</div>
                  ${move.definition ? html`<div class="move-text">${move.definition}</div>` : nothing}
                  ${move.contract ? html`<div class="move-text muted"><em>Contract:</em> ${move.contract}</div>` : nothing}
                </li>`,
              )}
            </ul>`
          : html`<p class="muted" data-moves="none">No move is recorded for this entry. Moves come from the swarm graph's capabilities and, later, from a tool manifest.</p>`}
      </section>
      ${seat.jail || seat.seals.length > 0
        ? html`<section class="rules mn-kind" data-kind="prose" aria-labelledby="rules-heading">
            <h2 id="rules-heading">Rules</h2>
            ${seat.jail ? html`<p data-jail><strong>Never:</strong> ${seat.jail}</p>` : nothing}
            ${seat.seals.length > 0 ? html`<ul>${seat.seals.map((seal) => html`<li data-seal>${seal}</li>`)}</ul>` : nothing}
          </section>`
        : nothing}
      <section class="lineage mn-kind" data-kind="reference" aria-labelledby="lineage-heading">
        <h2 id="lineage-heading">Lineage and evolutions</h2>
        <ul>
          ${entry.lineage.ancestor ? html`<li data-ancestor=${entry.lineage.ancestor.iri}>supersedes <a href=${this.focusHref(entry.lineage.ancestor.iri)}>${entry.lineage.ancestor.title ?? entrySlug(entry.lineage.ancestor.iri)}</a>${entry.lineage.ancestor.status ? html` <span class="pill">${entry.lineage.ancestor.status}</span>` : nothing}</li>` : nothing}
          ${entry.lineage.heirs.map((heir) => html`<li data-heir=${heir.iri}>superseded by <a href=${this.focusHref(heir.iri)}>${heir.title ?? entrySlug(heir.iri)}</a>${heir.status ? html` <span class="pill">${heir.status}</span>` : nothing}</li>`)}
          ${seat.parent ? html`<li>under <a href=${this.focusHref(seat.parent.iri)}>${seat.parent.seatId}</a></li>` : nothing}
          ${seat.foldedFrom.map((src) => html`<li data-folded-from=${src}>folded from <span class="muted">${src}</span></li>`)}
          ${seat.definitions.map((doc) => html`<li data-definition>defined in <span class="muted">${doc}</span></li>`)}
          ${!entry.lineage.ancestor && entry.lineage.heirs.length === 0 && !seat.parent && seat.foldedFrom.length === 0 && seat.definitions.length === 0
            ? html`<li class="muted" data-lineage="none">No lineage recorded: a first of its kind, as far as the register knows.</li>`
            : nothing}
        </ul>
      </section>
      ${seat.correspondents.length > 0
        ? html`<section class="lineage mn-kind" data-kind="reference" aria-labelledby="peers-heading">
            <h2 id="peers-heading">Corresponds most with</h2>
            <ul>${seat.correspondents.map((peer) => html`<li><a href=${this.focusHref(peer.iri)} data-peer=${peer.iri}>${peer.title ?? peer.iri}</a> <span class="muted">${peer.letters} letters</span></li>`)}</ul>
          </section>`
        : nothing}
      ${seat.heldBeads.length > 0
        ? html`<section class="lineage mn-kind" data-kind="reference" aria-labelledby="beads-heading">
            <h2 id="beads-heading">Beads it holds</h2>
            <ul>${seat.heldBeads.map((bead) => html`<li><a href=${this.focusHref(bead.iri)} data-bead=${bead.iri}>${bead.title}</a> <span class="pill">${bead.status.replace('_', ' ')}</span></li>`)}</ul>
          </section>`
        : nothing}
      <div class="attestation mn-kind" data-kind="testimony">
        ${seat.attestation === 'operator-attested-local'
          ? 'Operator testimony from the Demi register, not an authenticated receipt.'
          : seat.attestation === 'swarm-graph'
            ? 'Folded from the swarm graph: a facility as its keeper described it, not a running body.'
            : seat.attestation === 'choreograph-host'
              ? 'Folded from the choreograph host as la Regidora probed it; runs from its own store.'
              : seat.attestation === 'house-graph'
                ? 'Folded from the Sirin house graph.'
                : (seat.attestation ?? 'attestation unknown')}
      </div>
    </div>`
  }

  private _body(): TemplateResult {
    if (this.status === 'loading') return this._state(this.mode === 'tile' ? '…' : 'Opening the entry…')
    if (this.status === 'error') return this._state(this.error || 'This entry could not be opened.', 'danger')
    const entry = this.entry
    if (!entry) return this._state('Nothing to show.')
    if (!entry.seat.found) return this._state(`No record in this graph for ${entry.seat.subject}.`, 'danger')
    if (!entry.seat.isSeat) return this._state(`${entry.seat.subject} is not a seat of the correo canon.`, 'danger')
    return this.mode === 'tile' ? this._tile(entry) : this._chapter(entry)
  }

  render(): TemplateResult {
    return html`<div class="stage" role="region" data-stance="dispatch" data-subject=${this.subjectIri} data-dormancy=${this.entry?.dormancy ?? ''} aria-label=${this.entry?.seat.title || this.subjectIri || 'Entry'}>
      ${this._body()}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-agent-entry-view': ShAgentEntryView
  }
}
