/**
 * letter-page-view-element.ts — `<sh-letter-page-view>`, the body of the
 * `card.letter` face (el Despacho W2). A letter is rendered as a PAGE: an
 * eyebrow (its kind, its conversation, when), the parties as hyperlinks that
 * move the room's focus, the excerpt set as the page's text, the letter it
 * answers and the letters that answer it, whether and when it was
 * acknowledged and by whom, and its provenance — the body's path and digest
 * in the sophia repository, because the body never enters the graph — with
 * the attestation said plainly: operator testimony, not an authenticated
 * receipt.
 *
 * Dumb about data (renders an already-folded `LetterReading`); kinds stamped
 * from the nucleus DisplayKind register; stage stamped `data-stance="dispatch"`.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { LetterParty, LetterReading, LetterRef } from '../../despacho/letter-reading.js'

export type LetterViewStatus = 'loading' | 'ready' | 'error'
export type LetterViewMode = 'chapter' | 'entry'

const KIND_LABELS: Readonly<Record<string, string>> = {
  question: 'a question',
  request: 'a request',
  answer: 'an answer',
  observation: 'an observation',
}

function formatWhen(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

@customElement('sh-letter-page-view')
export class ShLetterPageView extends LitElement {
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
    .page {
      max-width: 68ch;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-4, 16px);
    }
    :host([mode='entry']) .page {
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
    .parties {
      margin: 0;
      font-family: var(--mn-font-display, var(--mn-font-chrome, serif));
      font-size: clamp(1.15rem, 1rem + 0.9vw, 1.6rem);
      font-weight: 600;
      line-height: 1.2;
      letter-spacing: -0.01em;
      text-wrap: balance;
      overflow-wrap: anywhere;
    }
    :host([mode='entry']) .parties {
      font-size: var(--mn-text-md, 1rem);
      line-height: 1.3;
    }
    .parties a,
    .thread a,
    .acks a {
      color: var(--mn-kind-reference-text, var(--mn-color-text-primary));
      text-decoration: underline;
      text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
      text-underline-offset: 0.14em;
    }
    .parties .arrow {
      color: var(--mn-color-text-muted);
      margin: 0 0.3em;
    }
    .excerpt {
      margin: 0;
      font-family: var(--mn-font-display, var(--mn-font-chrome, serif));
      font-size: var(--mn-text-md, 1rem);
      line-height: 1.55;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    :host([mode='entry']) .excerpt {
      font-size: var(--mn-text-sm, 13px);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      white-space: normal;
    }
    :host([mode='entry']) .excerpt a {
      color: inherit;
      text-decoration: none;
    }
    .excerpt .ellipsis {
      color: var(--mn-color-text-muted);
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
    .thread li,
    .acks li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 8px);
      align-items: baseline;
      overflow-wrap: anywhere;
    }
    .muted {
      color: var(--mn-color-text-muted);
    }
    .provenance {
      color: var(--mn-color-text-muted);
      font-family: var(--mn-font-mono, monospace);
      font-size: var(--mn-text-xs, 12px);
      overflow-wrap: anywhere;
      display: flex;
      flex-direction: column;
      gap: 2px;
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
    .mn-kind[data-kind='prose'] { --mn-kind-register-current: prose; }
    .mn-kind[data-kind='reference'] { --mn-kind-register-current: reference; }
    .mn-kind[data-kind='testimony'] { --mn-kind-register-current: testimony; }
  `

  @property({ type: String, reflect: true }) mode: LetterViewMode = 'chapter'
  @property({ type: String }) status: LetterViewStatus = 'loading'
  @property({ type: String }) error = ''
  @property({ type: String }) subjectIri = ''
  @property({ attribute: false }) reading: LetterReading | null = null
  @property({ attribute: false }) focusHref: (iri: string) => string = (iri) => `?focus=${encodeURIComponent(iri)}`

  private _state(message: string, tone: 'neutral' | 'danger' = 'neutral'): TemplateResult {
    return html`<div class="state" data-tone=${tone}>${message}</div>`
  }

  private _party(party: LetterParty | null, role: 'from' | 'to'): TemplateResult {
    if (!party) return html`<span class="muted">${role === 'from' ? 'an unnamed sender' : 'an unnamed recipient'}</span>`
    return html`<a href=${this.focusHref(party.iri)} data-party=${role} data-seat=${party.iri}>${party.title ?? party.iri}</a>`
  }

  private _ref(ref: LetterRef, role: 'parent' | 'reply'): TemplateResult {
    const label = `${ref.kind ? KIND_LABELS[ref.kind] ?? ref.kind : 'a letter'}${ref.from ? ` from ${ref.from.title ?? ref.from.iri}` : ''}`
    return html`<li data-ref=${role} data-letter=${ref.iri}>
      <a href=${this.focusHref(ref.iri)}>${label}</a>
      ${ref.at ? html`<span class="muted">${formatWhen(ref.at)}</span>` : nothing}
      ${ref.excerpt ? html`<span class="muted">— ${ref.excerpt.length > 120 ? `${ref.excerpt.slice(0, 120)}…` : ref.excerpt}</span>` : nothing}
    </li>`
  }

  private _entry(reading: LetterReading): TemplateResult {
    return html`<div class="page">
      <div class="eyebrow mn-kind" data-kind="identity">
        <span class="kind">${reading.kind ? KIND_LABELS[reading.kind] ?? reading.kind : 'letter'}</span>
        ${reading.at ? html`<span>${formatWhen(reading.at)}</span>` : nothing}
        ${reading.acks.length === 0 ? html`<span class="mn-kind" data-kind="state">unacknowledged</span>` : nothing}
      </div>
      <div class="parties mn-kind" data-kind="reference">${this._party(reading.from, 'from')}<span class="arrow">→</span>${this._party(reading.to, 'to')}</div>
      ${reading.excerpt ? html`<p class="excerpt mn-kind" data-kind="prose"><a href=${this.focusHref(reading.subject)}>${reading.excerpt}</a></p>` : nothing}
    </div>`
  }

  private _chapter(reading: LetterReading): TemplateResult {
    return html`<div class="page">
      <div class="eyebrow mn-kind" data-kind="identity">
        <span class="kind">${reading.kind ? KIND_LABELS[reading.kind] ?? reading.kind : 'letter'}</span>
        ${reading.conversation ? html`<span>in ${reading.conversation}</span>` : nothing}
        ${reading.at ? html`<span>· ${formatWhen(reading.at)}</span>` : nothing}
      </div>
      <h1 class="parties mn-kind" data-kind="reference">${this._party(reading.from, 'from')}<span class="arrow">→</span>${this._party(reading.to, 'to')}</h1>
      ${reading.excerpt
        ? html`<p class="excerpt mn-kind" data-kind="prose">${reading.excerpt}</p>`
        : html`<p class="excerpt muted">No excerpt was carried for this letter; the body is in the repository below.</p>`}
      ${reading.replyTo
        ? html`<section class="thread mn-kind" data-kind="reference" aria-labelledby="answers-heading">
            <h2 id="answers-heading">Answers</h2>
            <ul>${this._ref(reading.replyTo, 'parent')}</ul>
          </section>`
        : nothing}
      ${reading.replies.length > 0
        ? html`<section class="thread mn-kind" data-kind="reference" aria-labelledby="replies-heading">
            <h2 id="replies-heading">${reading.replies.length === 1 ? 'Answered by' : `Answered by ${reading.replies.length} letters`}</h2>
            <ul>${reading.replies.map((reply) => this._ref(reply, 'reply'))}</ul>
          </section>`
        : nothing}
      <section class="acks mn-kind" data-kind="state" aria-labelledby="acks-heading">
        <h2 id="acks-heading">Acknowledgement</h2>
        ${reading.acks.length > 0
          ? html`<ul>
              ${reading.acks.map(
                (ack) => html`<li data-ack=${ack.iri}>acknowledged by <a href=${this.focusHref(ack.actor.iri)}>${ack.actor.title ?? ack.actor.iri}</a><span class="muted">${formatWhen(ack.at)}</span></li>`,
              )}
            </ul>`
          : html`<p class="muted" data-acks="none">Not yet acknowledged by its recipient.</p>`}
      </section>
      <section class="provenance mn-kind" data-kind="reference" aria-labelledby="prov-heading">
        <h2 id="prov-heading">Provenance</h2>
        <div>The body lives in the sophia repository; the graph carries this excerpt, the path and the digest.</div>
        ${reading.bodyPath ? html`<div data-body-path=${reading.bodyPath}>${reading.bodyPath}</div>` : nothing}
        ${reading.bodySha256 ? html`<div>sha256 ${reading.bodySha256}</div>` : nothing}
        ${reading.messageId ? html`<div>register id ${reading.messageId}</div>` : nothing}
        ${reading.provenance.length > 0 ? html`<div>provenance ${reading.provenance.join(' · ')}</div>` : nothing}
      </section>
      ${reading.attestation
        ? html`<div class="attestation mn-kind" data-kind="testimony">${reading.attestation === 'operator-attested-local' ? 'Operator testimony from the Demi register, not an authenticated receipt: the sender, the recipient and the time are as the operator recorded them.' : reading.attestation}</div>`
        : nothing}
    </div>`
  }

  private _body(): TemplateResult {
    if (this.status === 'loading') return this._state('Opening the letter…')
    if (this.status === 'error') return this._state(this.error || 'This letter could not be opened.', 'danger')
    const reading = this.reading
    if (!reading) return this._state('Nothing to show.')
    if (!reading.found) return this._state(`No record in this graph for ${reading.subject}.`, 'danger')
    if (!reading.isLetter) return this._state(`${reading.subject} is not a letter of the Demi register.`, 'danger')
    return this.mode === 'entry' ? this._entry(reading) : this._chapter(reading)
  }

  render(): TemplateResult {
    return html`<div class="stage" role="region" data-stance="dispatch" data-subject=${this.subjectIri} aria-label=${this.reading?.messageId || this.subjectIri || 'Letter'}>
      ${this._body()}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-letter-page-view': ShLetterPageView
  }
}
