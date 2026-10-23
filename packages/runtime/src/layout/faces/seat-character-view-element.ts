/**
 * seat-character-view-element.ts — `<sh-seat-character-view>`, the body of
 * the `card.seat` face (el Despacho W2). A seat is rendered as a CHARACTER
 * WITH A HEARTBEAT: an eyebrow of identity, the title carrying the page, the
 * heartbeat (its last run, how long ago, and what it was), the counts of
 * letters in and out and the ones still waiting on its acknowledgement, the
 * scope it was charged with, its correspondents as hyperlinks that move the
 * room's focus, and the beads it holds — with an honest line when no bead
 * names it, because today beads name "demi" and "vera", not seats.
 *
 * Dumb about data (every face/view split in this directory): renders an
 * already-folded `SeatReading`; the queries live in ../../despacho/. Every
 * kinded element is stamped `data-kind` from the nucleus DisplayKind register
 * and the stage is stamped `data-stance="dispatch"`. The kind rules are
 * reproduced here against the same `--mn-kind-*` tokens because `kind.css`
 * does not light inside a shadow root (object-card-view-element.ts's header).
 */
import { LocaleController, localeSource, t } from '@shrubbery/nucleus'
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { SeatReading } from '../../despacho/seat-reading.js'

export type SeatViewStatus = 'loading' | 'ready' | 'error'
export type SeatViewMode = 'chapter' | 'entry'

function formatWhen(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(localeSource.get(), { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/** Relative time in plain words (Intl, no invented calendar math); exported for tests. */
export function formatAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 60) return rtf.format(seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return rtf.format(days, 'day')
  return rtf.format(Math.round(days / 30), 'month')
}

@customElement('sh-seat-character-view')
export class ShSeatCharacterView extends LitElement {
  protected readonly _locale = new LocaleController(this)

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
    :host([mode='entry']) .stage {
      padding: var(--mn-space-3, 12px) var(--mn-space-4, 16px);
    }
    .character {
      max-width: 68ch;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-4, 16px);
    }
    :host([mode='entry']) .character {
      gap: var(--mn-space-1, 4px);
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
      overflow-wrap: anywhere;
    }
    :host([mode='entry']) .title {
      font-size: var(--mn-text-md, 1rem);
      line-height: 1.3;
    }
    .title a,
    .heartbeat a,
    .peers a,
    .beads a,
    .parent a {
      color: inherit;
      text-decoration: none;
    }
    .title a:hover,
    .title a:focus-visible,
    .peers a:hover,
    .beads a:hover,
    .parent a:hover {
      text-decoration: underline;
      text-underline-offset: 0.12em;
    }
    /* ── the heartbeat ── */
    .heartbeat {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--mn-space-2, 8px);
    }
    .pulse {
      display: inline-block;
      width: 0.6em;
      height: 0.6em;
      border-radius: 50%;
      background: var(--mn-color-text-muted);
      vertical-align: middle;
      margin-inline-end: 0.3em;
    }
    .pulse[data-state='completed'] {
      background: var(--mn-color-success-strong, var(--mn-color-accent, currentColor));
    }
    .pulse[data-state='started'] {
      background: var(--mn-color-accent, currentColor);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--mn-color-accent, currentColor) 25%, transparent);
    }
    .pulse[data-state='failed'] {
      background: var(--mn-color-danger-strong, currentColor);
    }
    .pulse[data-state='claimed'] {
      background: transparent;
      border: 1.5px solid var(--mn-color-text-muted);
    }
    .pill[data-seat-status='dormant'],
    .pill[data-seat-status='retired'] {
      color: var(--mn-color-text-muted);
      text-decoration: line-through;
      text-decoration-thickness: 1px;
    }
    .pill[data-seat-status='active'] {
      border-color: color-mix(in srgb, var(--mn-color-accent, currentColor) 45%, transparent);
    }
    .verbatim {
      margin: 0;
      padding-inline-start: var(--mn-space-3, 12px);
      border-inline-start: 3px solid color-mix(in srgb, var(--mn-color-accent, currentColor) 60%, transparent);
      font-family: var(--mn-font-display, var(--mn-font-chrome, serif));
      font-size: var(--mn-text-md, 1rem);
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .moves li {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-bottom: var(--mn-space-2, 8px);
    }
    .move-head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 8px);
      align-items: baseline;
    }
    .move-text {
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .jail {
      margin: 0;
      line-height: 1.5;
    }
    .seals li {
      line-height: 1.5;
    }
    .heartbeat .ago {
      font-weight: 650;
    }
    .heartbeat .detail,
    .counts .label,
    .muted {
      color: var(--mn-color-text-muted);
    }
    .counts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-4, 16px);
      font-variant-numeric: tabular-nums;
    }
    .counts .n {
      font-family: var(--mn-font-display, var(--mn-font-chrome, serif));
      font-size: var(--mn-text-lg, 1.2rem);
      font-weight: 650;
      margin-inline-end: 0.3em;
    }
    .counts .waiting .n {
      color: var(--mn-color-accent, inherit);
    }
    .scope {
      margin: 0;
      color: var(--mn-color-text-secondary, var(--mn-color-text-primary));
      line-height: 1.55;
    }
    h2 {
      margin: 0;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      font-variant-caps: all-small-caps;
      letter-spacing: var(--mn-tracking-label, 0.06em);
      color: var(--mn-color-text-muted);
    }
    section {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-2, 8px);
      padding-top: var(--mn-space-3, 12px);
      border-top: 1px solid var(--mn-color-border-subtle);
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-1, 4px);
    }
    .peers li,
    .runs li,
    .beads li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 8px);
      align-items: baseline;
      overflow-wrap: anywhere;
    }
    .peers a,
    .beads a,
    .parent a {
      color: var(--mn-kind-reference-text, var(--mn-color-text-primary));
      text-decoration: underline;
      text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
      text-underline-offset: 0.14em;
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
    }
    .refs {
      color: var(--mn-color-text-muted);
      font-family: var(--mn-font-mono, monospace);
      font-size: var(--mn-text-xs, 12px);
      overflow-wrap: anywhere;
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
    .mn-kind[data-kind='identity'] { --mn-kind-register-current: identity; }
    .mn-kind[data-kind='state'] { --mn-kind-register-current: state; }
    .mn-kind[data-kind='metric'] { --mn-kind-register-current: metric; }
    .mn-kind[data-kind='prose'] { --mn-kind-register-current: prose; }
    .mn-kind[data-kind='reference'] { --mn-kind-register-current: reference; }
    .mn-kind[data-kind='testimony'] { --mn-kind-register-current: testimony; }
  `

  @property({ type: String, reflect: true }) mode: SeatViewMode = 'chapter'
  @property({ type: String }) status: SeatViewStatus = 'loading'
  @property({ type: String }) error = ''
  @property({ type: String }) subjectIri = ''
  @property({ attribute: false }) reading: SeatReading | null = null
  @property({ attribute: false }) focusHref: (iri: string) => string = (iri) => `?focus=${encodeURIComponent(iri)}`
  /** Injected clock for deterministic relative times in tests. */
  @property({ attribute: false }) now: () => Date = () => new Date()

  private _state(message: string, tone: 'neutral' | 'danger' = 'neutral'): TemplateResult {
    return html`<div class="state" data-tone=${tone}>${message}</div>`
  }

  private _heartbeat(reading: SeatReading): TemplateResult {
    const last = reading.recentRuns[0] ?? null
    if (!last) {
      // correo v0.2.0: a folded seat may carry the latest run its SOURCE knew
      // at fold time — a dated claim, shown as such, never as a recorded run.
      if (reading.lastRunAt) {
        return html`<div class="heartbeat mn-kind" data-kind="state" data-last-run-claim=${reading.lastRunAt}>
          <span class="pulse" data-state="claimed"></span>
          <span class="ago">last run ${formatAgo(reading.lastRunAt, this.now())}</span>
          <span class="detail">as its source claimed at fold time · ${formatWhen(reading.lastRunAt)}; no run recorded in the register</span>
        </div>`
      }
      return html`<div class="heartbeat mn-kind" data-kind="state"><span class="pulse" data-state="none"></span><span class="muted">${t('no run recorded for this seat')}</span></div>`
    }
    return html`<div class="heartbeat mn-kind" data-kind="state" data-last-run=${last.iri}>
      <span class="pulse" data-state=${last.state}></span>
      <span class="ago">${last.state} ${formatAgo(last.at, this.now())}</span>
      <span class="detail">${last.runtime}${last.bodyIdentity ? html` · ${last.bodyIdentity}` : nothing} · ${formatWhen(last.at)}</span>
    </div>`
  }

  private _counts(reading: SeatReading): TemplateResult {
    return html`<div class="counts mn-kind" data-kind="metric">
      <span><span class="n">${reading.lettersIn}</span><span class="label">${t('letters in')}</span></span>
      <span><span class="n">${reading.lettersOut}</span><span class="label">${t('letters out')}</span></span>
      <span class="waiting"><span class="n">${reading.unacknowledged}</span><span class="label">${t('awaiting its acknowledgement')}</span></span>
    </div>`
  }

  private _entry(reading: SeatReading): TemplateResult {
    const last = reading.recentRuns[0] ?? null
    return html`<div class="character">
      <div class="eyebrow mn-kind" data-kind="identity">
        <span class="kind">${reading.seatKind ?? 'seat'}</span>
        ${reading.seatStatus ? html`<span class="pill mn-kind" data-kind="state" data-seat-status=${reading.seatStatus}>${reading.seatStatus.replace(/-/g, ' ')}</span>` : nothing}
        ${reading.capabilities.length > 0 ? html`<span>· ${reading.capabilities.length} moves</span>` : nothing}
        ${reading.unacknowledged > 0 ? html`<span class="pill mn-kind" data-kind="state">${reading.unacknowledged} awaiting</span>` : nothing}
      </div>
      <h1 class="title mn-kind" data-kind="identity"><a href=${this.focusHref(reading.subject)}>${reading.title}</a></h1>
      ${last
        ? html`<div class="heartbeat mn-kind" data-kind="state"><span class="pulse" data-state=${last.state}></span><span class="detail">${last.state} ${formatAgo(last.at, this.now())}</span></div>`
        : nothing}
    </div>`
  }

  private _chapter(reading: SeatReading): TemplateResult {
    return html`<div class="character">
      <div class="eyebrow mn-kind" data-kind="identity">
        <span class="kind">${reading.seatKind ?? 'seat'}</span>
        ${reading.seatStatus ? html`<span class="pill mn-kind" data-kind="state" data-seat-status=${reading.seatStatus}>${reading.seatStatus.replace(/-/g, ' ')}</span>` : nothing}
        ${reading.seatId ? html`<span>· ${reading.seatId}</span>` : nothing}
        ${reading.parent ? html`<span class="parent">· under <a href=${this.focusHref(reading.parent.iri)} data-parent=${reading.parent.iri}>${reading.parent.seatId}</a></span>` : nothing}
        ${reading.model ? html`<span>· ${reading.model}</span>` : nothing}
      </div>
      <h1 class="title mn-kind" data-kind="identity">${reading.title}</h1>
      ${this._heartbeat(reading)}
      ${this._counts(reading)}
      ${reading.mandate ? html`<p class="scope mn-kind" data-kind="prose" data-mandate>${reading.mandate}</p>` : nothing}
      ${reading.scope ? html`<p class="scope mn-kind" data-kind="prose">${reading.scope}</p>` : nothing}
      ${reading.card
        ? html`<section class="card mn-kind" data-kind="prose" aria-labelledby="card-heading">
            <h2 id="card-heading">${t('The card, verbatim')}</h2>
            <blockquote class="verbatim">${reading.card}</blockquote>
          </section>`
        : nothing}
      ${reading.capabilities.length > 0
        ? html`<section class="moves mn-kind" data-kind="reference" aria-labelledby="moves-heading">
            <h2 id="moves-heading">${reading.capabilities.length === 1 ? 'The move it holds' : `The ${reading.capabilities.length} moves it holds`}</h2>
            <ul>
              ${reading.capabilities.map(
                (move) => html`<li data-capability=${move.iri}>
                  <div class="move-head"><strong>${move.name}</strong>${move.confidence ? html`<span class="muted">confidence ${move.confidence}</span>` : nothing}${move.mergeVerdict ? html`<span class="pill">${move.mergeVerdict}</span>` : nothing}</div>
                  ${move.definition ? html`<div class="move-text">${move.definition}</div>` : nothing}
                  ${move.contract ? html`<div class="move-text muted"><em>${t('Contract:')}</em> ${move.contract}</div>` : nothing}
                  ${move.attestation ? html`<div class="attestation">${move.attestation}</div>` : nothing}
                </li>`,
              )}
            </ul>
          </section>`
        : nothing}
      ${reading.jail || reading.seals.length > 0
        ? html`<section class="rules mn-kind" data-kind="prose" aria-labelledby="rules-heading">
            <h2 id="rules-heading">${t('Its rules')}</h2>
            ${reading.jail ? html`<p class="jail" data-jail><strong>${t('Never:')}</strong> ${reading.jail}</p>` : nothing}
            ${reading.seals.length > 0
              ? html`<ul class="seals">
                  ${reading.seals.map((seal) => html`<li data-seal>${seal}</li>`)}
                </ul>`
              : nothing}
          </section>`
        : nothing}
      ${reading.handoff || reading.evidence.length > 0 || reading.agentUri || reading.trigger || reading.definitions.length > 0 || reading.foldedFrom.length > 0 || reading.supersedes || reading.confidence
        ? html`<div class="refs mn-kind" data-kind="reference">
            ${reading.handoff ? html`<div>handoff: ${reading.handoff}</div>` : nothing}
            ${reading.evidence.length > 0 ? html`<div>evidence: ${reading.evidence.join(' · ')}</div>` : nothing}
            ${reading.agentUri ? html`<div data-agent-uri>agent: ${reading.agentUri}</div>` : nothing}
            ${reading.trigger ? html`<div>trigger: ${reading.trigger}</div>` : nothing}
            ${reading.definitions.length > 0 ? html`<div>defined in: ${reading.definitions.join(' · ')}</div>` : nothing}
            ${reading.confidence ? html`<div>source confidence: ${reading.confidence}</div>` : nothing}
            ${reading.supersedes ? html`<div>${t('supersedes:')} <a href=${this.focusHref(reading.supersedes)}>${reading.supersedes}</a></div>` : nothing}
            ${reading.foldedFrom.length > 0 ? html`<div>folded from: ${reading.foldedFrom.join(' · ')}</div>` : nothing}
          </div>`
        : nothing}
      ${reading.correspondents.length > 0
        ? html`<section class="peers mn-kind" data-kind="reference" aria-labelledby="peers-heading">
            <h2 id="peers-heading">${t('Corresponds most with')}</h2>
            <ul>
              ${reading.correspondents.map(
                (peer) => html`<li><a href=${this.focusHref(peer.iri)} data-peer=${peer.iri}>${peer.title ?? peer.iri}</a><span class="muted">${peer.letters} letters</span></li>`,
              )}
            </ul>
          </section>`
        : nothing}
      ${reading.recentRuns.length > 1
        ? html`<section class="runs mn-kind" data-kind="state" aria-labelledby="runs-heading">
            <h2 id="runs-heading">${t('Recent runs')}</h2>
            <ul>
              ${reading.recentRuns.map(
                (run) => html`<li data-run=${run.iri}><span class="pulse" data-state=${run.state}></span><span>${run.state}</span><span class="muted">${run.runtime} · ${formatWhen(run.at)}</span></li>`,
              )}
            </ul>
          </section>`
        : nothing}
      <section class="beads mn-kind" data-kind="reference" aria-labelledby="beads-heading">
        <h2 id="beads-heading">${t('Beads it holds')}</h2>
        ${reading.heldBeads.length > 0
          ? html`<ul>
              ${reading.heldBeads.map(
                (bead) => html`<li><a href=${this.focusHref(bead.iri)} data-bead=${bead.iri}>${bead.title}</a><span class="pill" data-status=${bead.status}>${bead.status.replace('_', ' ')}</span><span class="muted">${bead.beadKind}</span></li>`,
              )}
            </ul>`
          : html`<p class="muted" data-held-beads="none">No bead names this seat as its holder. Beads name their holder by office (today: demi, vera), not by seat; the join is by ${reading.seatId ? html`<code>${reading.seatId}</code>` : 'seat id'} and lights up the day a bead names it.</p>`}
      </section>
      ${reading.attestation
        ? html`<div class="attestation mn-kind" data-kind="testimony">${reading.attestation === 'operator-attested-local' ? 'Operator testimony from the Demi register, not an authenticated receipt.' : reading.attestation}</div>`
        : nothing}
    </div>`
  }

  private _body(): TemplateResult {
    if (this.status === 'loading') return this._state(t('Finding the seat…'))
    if (this.status === 'error') return this._state(this.error || 'This seat could not be opened.', 'danger')
    const reading = this.reading
    if (!reading) return this._state(t('Nothing to show.'))
    if (!reading.found) return this._state(`No record in this graph for ${reading.subject}.`, 'danger')
    if (!reading.isSeat) return this._state(`${reading.subject} is not a seat of the Demi register.`, 'danger')
    return this.mode === 'entry' ? this._entry(reading) : this._chapter(reading)
  }

  render(): TemplateResult {
    return html`<div class="stage" role="region" data-stance="dispatch" data-subject=${this.subjectIri} aria-label=${this.reading?.title || this.subjectIri || 'Seat'}>
      ${this._body()}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-seat-character-view': ShSeatCharacterView
  }
}
