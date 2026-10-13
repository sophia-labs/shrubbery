/**
 * cuenta-chapter-view-element.ts — `<sh-cuenta-chapter-view>`, the body of
 * the `card.cuenta` face (el Despacho W1, plans/2026-09-15-despacho-design.md
 * §7). A bead is rendered as a CHAPTER with one act, not a form and not a
 * dashboard tile: an eyebrow of identity, the title carrying the page, the
 * bead's state, its edges as real hyperlinks that move the room's focus, the
 * accounts already rendered for it as testimony (a word's utterance set as a
 * pull-quote), and — for an open gate only — one large affordance: give your
 * word.
 *
 * Deliberately dumb about data (mirrors every face/view split in this
 * directory): it renders an already-folded `CuentaReading` and emits typed
 * intents (`cuenta-word`); the queries, the planner and the cell live in
 * card-cuenta-face.ts and ../../despacho/. Every kinded element is stamped
 * `data-kind` from the nucleus DisplayKind register and the stage is stamped
 * `data-stance="dispatch"` — the room posture the nucleus names for a
 * directing surface — so the DOM manner of this resource is legible to the
 * same eye that reads its turtle.
 *
 * `.mn-kind[data-kind=…]` markup does NOT light `kind.css` inside a shadow
 * root (object-card-view-element.ts's own header), so the kind rules this
 * element emits are reproduced here, token-driven against the SAME
 * `--mn-kind-*` custom properties.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { CuentaReading, CuentaRendicion } from '../../despacho/cuenta-reading.js'
import { cuentaAwaitsWord } from '../../despacho/cuenta-reading.js'
import { CUENTA_WORDS, type CuentaWord } from '../../despacho/cuenta-verbs.js'

export type CuentaChapterViewStatus = 'loading' | 'ready' | 'error'
export type CuentaChapterMode = 'chapter' | 'entry'

/** The live state of the one act — mirrors the executor's phases; `refused` carries the refusing party's words verbatim. */
export type CuentaVerbViewState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'dry-run' }
  | { readonly phase: 'apply' }
  | { readonly phase: 'refused'; readonly at: string; readonly message: string }
  | { readonly phase: 'applied'; readonly subjects: readonly string[] }

export interface CuentaWordDetail {
  readonly word: CuentaWord
  readonly utterance: string
}

const WORD_LABELS: Readonly<Record<CuentaWord, string>> = {
  yes: 'Yes',
  no: 'No',
  defer: 'Not yet',
  amend: 'Yes, with a change',
}

const EDGE_LABELS: Readonly<Record<string, string>> = {
  needs: 'needs',
  gatedBy: 'gated by',
  partOf: 'part of',
  discoveredFrom: 'discovered while doing',
  supersedes: 'supersedes',
}

function formatWhen(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

@customElement('sh-cuenta-chapter-view')
export class ShCuentaChapterView extends LitElement {
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
    .chapter {
      max-width: 68ch;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-4, 16px);
    }
    /* ── identity: the eyebrow and the title carry the page ── */
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
    .title a {
      color: inherit;
      text-decoration: none;
    }
    .title a:hover,
    .title a:focus-visible {
      text-decoration: underline;
      text-underline-offset: 0.12em;
    }
    /* ── state ── */
    .status-line {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--mn-space-2, 8px);
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
    .pill[data-status='open'] {
      border-color: color-mix(in srgb, var(--mn-color-accent, currentColor) 45%, transparent);
    }
    .pill[data-status='done'] {
      color: var(--mn-color-text-muted);
      text-decoration: line-through;
      text-decoration-thickness: 1px;
    }
    .ready {
      color: var(--mn-color-accent, inherit);
      font-weight: 600;
    }
    .note {
      margin: 0;
      color: var(--mn-color-text-secondary, var(--mn-color-text-primary));
      line-height: 1.55;
    }
    /* ── reference: the edges are the room's doors ── */
    .edges {
      display: grid;
      grid-template-columns: max-content 1fr;
      column-gap: var(--mn-space-3, 12px);
      row-gap: var(--mn-space-1, 4px);
      margin: 0;
    }
    .edges dt {
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
      font-variant-caps: all-small-caps;
      letter-spacing: var(--mn-tracking-label, 0.05em);
      padding-top: 0.2em;
      white-space: nowrap;
    }
    .edges dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .edges dd a {
      color: var(--mn-kind-reference-text, var(--mn-color-text-primary));
      text-decoration: underline;
      text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
      text-underline-offset: 0.14em;
    }
    .edges dd .edge-status {
      margin-inline-start: 0.4em;
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
    }
    /* ── testimony: the accounts already rendered ── */
    .accounts {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-3, 12px);
      padding-top: var(--mn-space-3, 12px);
      border-top: 1px solid var(--mn-color-border-subtle);
    }
    .accounts h2,
    .act h2 {
      margin: 0;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      font-variant-caps: all-small-caps;
      letter-spacing: var(--mn-tracking-label, 0.06em);
      color: var(--mn-color-text-muted);
    }
    .account {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-1, 4px);
    }
    .account .verdict {
      font-weight: 650;
    }
    .account .utterance {
      margin: var(--mn-space-1, 4px) 0;
      padding-inline-start: var(--mn-space-3, 12px);
      border-inline-start: 3px solid color-mix(in srgb, var(--mn-color-accent, currentColor) 60%, transparent);
      font-family: var(--mn-font-display, var(--mn-font-chrome, serif));
      font-size: var(--mn-text-md, 1rem);
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .account .attribution {
      color: var(--mn-kind-testimony-text, var(--mn-color-text-muted));
      font-size: var(--mn-text-xs, 12px);
    }
    .account .attribution::before {
      content: '— ';
    }
    .account .evidence {
      color: var(--mn-color-text-muted);
      font-family: var(--mn-font-mono, monospace);
      font-size: var(--mn-text-xs, 12px);
      overflow-wrap: anywhere;
    }
    /* ── affordance: the one act ── */
    .act {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-3, 12px);
      margin-top: var(--mn-space-2, 8px);
      padding: var(--mn-space-4, 16px);
      border: 1px solid color-mix(in srgb, var(--mn-color-accent, currentColor) 35%, var(--mn-color-border-subtle));
      border-radius: var(--mn-radius-surface, 8px);
      background: color-mix(in srgb, var(--mn-color-accent, transparent) 6%, var(--mn-color-surface-raised, transparent));
    }
    .act .ask {
      margin: 0;
      font-family: var(--mn-font-display, var(--mn-font-chrome, serif));
      font-size: var(--mn-text-lg, 1.2rem);
      line-height: 1.3;
      text-wrap: balance;
    }
    .words {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mn-space-2, 8px);
    }
    .words label {
      display: inline-flex;
      align-items: center;
      gap: 0.4em;
      padding: 0.35em 0.8em;
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: 999px;
      cursor: pointer;
      user-select: none;
    }
    .words label:has(input:checked) {
      border-color: var(--mn-color-accent, currentColor);
      background: color-mix(in srgb, var(--mn-color-accent, currentColor) 12%, transparent);
      font-weight: 600;
    }
    .words input {
      margin: 0;
    }
    textarea {
      width: 100%;
      min-height: 5.5em;
      box-sizing: border-box;
      resize: vertical;
      padding: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-base);
      color: inherit;
      font: inherit;
      font-family: var(--mn-font-display, var(--mn-font-chrome, serif));
      font-size: var(--mn-text-md, 1rem);
      line-height: 1.45;
    }
    textarea:focus-visible,
    button:focus-visible,
    .words input:focus-visible + span {
      outline: 2px solid var(--mn-color-accent, currentColor);
      outline-offset: 2px;
    }
    .act-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--mn-space-2, 8px);
    }
    .act-row .witness {
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
    }
    button.give {
      padding: 0.6em 1.4em;
      border: 0;
      border-radius: 999px;
      background: var(--mn-color-accent, var(--mn-color-text-primary));
      color: var(--mn-color-on-accent, var(--mn-color-surface-base));
      font: inherit;
      font-weight: 650;
      letter-spacing: 0.01em;
      cursor: pointer;
    }
    button.give:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .verb-state {
      margin: 0;
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-muted);
    }
    .verb-state[data-tone='danger'] {
      color: var(--mn-color-danger-strong);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .verb-state[data-tone='good'] {
      color: var(--mn-color-success-strong, var(--mn-color-text-primary));
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
    /* ── kind register (kind.css duplication, see header) ── */
    .mn-kind[data-kind='identity'] {
      --mn-kind-register-current: identity;
    }
    .mn-kind[data-kind='state'] {
      --mn-kind-register-current: state;
    }
    .mn-kind[data-kind='prose'] {
      --mn-kind-register-current: prose;
    }
    .mn-kind[data-kind='reference'] {
      --mn-kind-register-current: reference;
    }
    .mn-kind[data-kind='testimony'] {
      --mn-kind-register-current: testimony;
    }
    .mn-kind[data-kind='affordance'] {
      --mn-kind-register-current: affordance;
    }
  `

  @property({ type: String, reflect: true }) mode: CuentaChapterMode = 'chapter'
  @property({ type: String }) status: CuentaChapterViewStatus = 'loading'
  @property({ type: String }) error = ''
  @property({ type: String }) subjectIri = ''
  @property({ attribute: false }) reading: CuentaReading | null = null
  /** True when the session can carry a verb to the cell; false renders the ask without a button and says why. */
  @property({ type: Boolean }) canAct = false
  /** Who the session says the viewer is — shown beside the act so the witness of a word is never hidden. */
  @property({ type: String }) witness = ''
  /** Builds the hyperlink that moves the room's focus to another bead. */
  @property({ attribute: false }) focusHref: (iri: string) => string = (iri) => `?focus=${encodeURIComponent(iri)}`
  @property({ attribute: false }) verbState: CuentaVerbViewState = { phase: 'idle' }

  @state() private _word: CuentaWord = 'yes'
  @state() private _utterance = ''

  private _state(message: string, tone: 'neutral' | 'danger' = 'neutral'): TemplateResult {
    return html`<div class="state" data-tone=${tone}>${message}</div>`
  }

  private _onWordChange(event: Event): void {
    const input = event.target as HTMLInputElement
    if ((CUENTA_WORDS as readonly string[]).includes(input.value)) this._word = input.value as CuentaWord
  }

  private _onUtteranceInput(event: Event): void {
    this._utterance = (event.target as HTMLTextAreaElement).value
  }

  private _give(): void {
    const utterance = this._utterance.trim()
    if (!utterance) return
    this.dispatchEvent(
      new CustomEvent<CuentaWordDetail>('cuenta-word', {
        detail: { word: this._word, utterance },
        bubbles: true,
        composed: true,
      }),
    )
  }

  /** Resets the draft after a word landed — the utterance is now testimony in the graph, not a draft in a box. */
  clearDraft(): void {
    this._utterance = ''
    this._word = 'yes'
  }

  private _account(account: CuentaRendicion): TemplateResult {
    return html`<div class="account mn-kind" data-kind="testimony" data-rendicion=${account.iri}>
      <div>
        <span class="verdict">${account.word ? WORD_LABELS[account.word as CuentaWord] ?? account.word : account.verdict}</span>
        ${account.renderedAt ? html`<span class="attribution">${formatWhen(account.renderedAt)}</span>` : nothing}
      </div>
      ${account.utterance ? html`<blockquote class="utterance">${account.utterance}</blockquote>` : nothing}
      ${account.summary && account.summary !== account.utterance ? html`<div>${account.summary}</div>` : nothing}
      <div class="attribution">${account.witness}</div>
      ${account.evidence.length > 0 ? html`<div class="evidence">${account.evidence.join(' · ')}</div>` : nothing}
    </div>`
  }

  private _verbStateLine(): TemplateResult | typeof nothing {
    const vs = this.verbState
    switch (vs.phase) {
      case 'idle':
        return nothing
      case 'dry-run':
        return html`<p class="verb-state" data-verb-phase="dry-run">Asking the cell to check the word (nothing written yet)…</p>`
      case 'apply':
        return html`<p class="verb-state" data-verb-phase="apply">The check passed. Writing the word…</p>`
      case 'refused':
        return html`<p class="verb-state" data-tone="danger" data-verb-phase="refused">Refused at ${vs.at}: ${vs.message}</p>`
      case 'applied':
        return html`<p class="verb-state" data-tone="good" data-verb-phase="applied">Your word is in the graph: ${vs.subjects.join(', ')}</p>`
    }
  }

  private _act(reading: CuentaReading): TemplateResult {
    const busy = this.verbState.phase === 'dry-run' || this.verbState.phase === 'apply'
    const owner = reading.owner ? `${reading.owner}’s word` : 'a word'
    return html`<section class="act mn-kind" data-kind="affordance" aria-labelledby="act-heading">
      <h2 id="act-heading">The act</h2>
      <p class="ask">This gate waits for ${owner}. Give yours.</p>
      <div class="words" role="radiogroup" aria-label="Your word">
        ${CUENTA_WORDS.map(
          (word) => html`<label>
            <input type="radio" name="word" value=${word} .checked=${this._word === word} @change=${this._onWordChange} ?disabled=${busy} />
            <span>${WORD_LABELS[word]}</span>
          </label>`,
        )}
      </div>
      <label>
        <span class="visually-hidden" hidden>Your words, verbatim</span>
        <textarea
          id="cuenta-utterance"
          placeholder="Your words, verbatim. They are kept exactly as written."
          .value=${this._utterance}
          @input=${this._onUtteranceInput}
          ?disabled=${busy}
        ></textarea>
      </label>
      <div class="act-row">
        <span class="witness">${this.canAct ? html`witnessed as <strong>${this.witness || 'an unnamed viewer'}</strong>` : 'this session cannot carry a word to the cell'}</span>
        <button class="give" type="button" @click=${this._give} ?disabled=${!this.canAct || busy || this._utterance.trim().length === 0}>
          Give my word
        </button>
      </div>
      ${this._verbStateLine()}
    </section>`
  }

  private _entry(reading: CuentaReading): TemplateResult {
    return html`<div class="chapter">
      <div class="eyebrow mn-kind" data-kind="identity">
        <span class="kind">${reading.beadKind ?? 'bead'}</span>
        ${reading.status ? html`<span class="pill mn-kind" data-kind="state" data-status=${reading.status}>${reading.status.replace('_', ' ')}</span>` : nothing}
        ${reading.owner ? html`<span>${reading.owner}</span>` : nothing}
      </div>
      <h1 class="title mn-kind" data-kind="identity"><a href=${this.focusHref(reading.subject)}>${reading.title}</a></h1>
    </div>`
  }

  private _chapter(reading: CuentaReading): TemplateResult {
    const awaits = cuentaAwaitsWord(reading)
    return html`<div class="chapter">
      <div class="eyebrow mn-kind" data-kind="identity">
        <span class="kind">${reading.beadKind ?? 'bead'}</span>
        ${reading.owner ? html`<span>held by ${reading.owner}</span>` : nothing}
        ${reading.venue ? html`<span>· ${reading.venue}</span>` : nothing}
        ${reading.priority !== null ? html`<span>· priority ${reading.priority}</span>` : nothing}
      </div>
      <h1 class="title mn-kind" data-kind="identity">${reading.title}</h1>
      <div class="status-line mn-kind" data-kind="state">
        ${reading.status ? html`<span class="pill" data-status=${reading.status}>${reading.status.replace('_', ' ')}</span>` : nothing}
        ${reading.ready ? html`<span class="ready">ready — nothing blocks it</span>` : nothing}
        ${reading.createdAt ? html`<span class="attribution">strung ${formatWhen(reading.createdAt)}</span>` : nothing}
      </div>
      ${reading.note ? html`<p class="note mn-kind" data-kind="prose">${reading.note}</p>` : nothing}
      ${reading.edges.length > 0
        ? html`<dl class="edges mn-kind" data-kind="reference">
            ${reading.edges.map(
              (edge) => html`<dt>${EDGE_LABELS[edge.edge] ?? edge.edge}</dt>
                <dd>
                  <a href=${this.focusHref(edge.target)} data-edge=${edge.edge} data-target=${edge.target}>${edge.title ?? edge.target}</a>
                  ${edge.status ? html`<span class="edge-status">${edge.status.replace('_', ' ')}</span>` : nothing}
                </dd>`,
            )}
          </dl>`
        : nothing}
      ${reading.evidence.length > 0
        ? html`<div class="evidence mn-kind" data-kind="reference">${reading.evidence.join(' · ')}</div>`
        : nothing}
      ${reading.rendiciones.length > 0
        ? html`<section class="accounts" aria-labelledby="accounts-heading">
            <h2 id="accounts-heading">${reading.rendiciones.length === 1 ? 'The account rendered' : 'The accounts rendered'}</h2>
            ${reading.rendiciones.map((account) => this._account(account))}
          </section>`
        : nothing}
      ${awaits ? this._act(reading) : nothing}
      ${this.verbState.phase === 'applied' && !awaits ? this._verbStateLine() : nothing}
    </div>`
  }

  private _body(): TemplateResult {
    if (this.status === 'loading') return this._state('Opening the bead…')
    if (this.status === 'error') return this._state(this.error || 'This bead could not be opened.', 'danger')
    const reading = this.reading
    if (!reading) return this._state('Nothing to show.')
    if (!reading.found) return this._state(`No record in this graph for ${reading.subject}.`, 'danger')
    return this.mode === 'entry' ? this._entry(reading) : this._chapter(reading)
  }

  render(): TemplateResult {
    return html`<div
      class="stage"
      role="region"
      data-stance="dispatch"
      data-subject=${this.subjectIri}
      aria-label=${this.reading?.title || this.subjectIri || 'Bead'}
    >
      ${this._body()}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-cuenta-chapter-view': ShCuentaChapterView
  }
}
