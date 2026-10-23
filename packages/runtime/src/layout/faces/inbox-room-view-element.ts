/**
 * inbox-room-view-element.ts — `<sh-inbox-room-view>`, the body of the
 * `card.inbox` face (el Despacho W4, plans/2026-09-15-despacho-operational-memo.md
 * §3 W4). A person's inbox rendered as a ROOM in the `dispatch` stance, not
 * a dashboard: an eyebrow naming whose inbox and who is reading, a title
 * carrying the page, one honest count line, and three sections — the gates
 * awaiting the viewer's word (ready ones first), the letters nobody has
 * answered, the returns the viewer has not yet read. Every row is a
 * hyperlink that moves the room's focus. The ONE act here is `read`: the
 * viewer's own dated testimony that they read an account (never a flag).
 *
 * Deliberately dumb about data: renders an already-folded `InboxReading`
 * and emits typed intents (`inbox-read`); queries, planner and cell live in
 * card-inbox-face.ts and ../../despacho/. Kinds are stamped `data-kind` from
 * the nucleus DisplayKind register; the stage is `data-stance="dispatch"`.
 * Kind rules are reproduced here token-driven (shadow roots do not see
 * kind.css — object-card-view-element.ts's own header).
 */
import { LocaleController, localeSource, t } from '@shrubbery/nucleus'
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { InboxGate, InboxLetter, InboxReading, InboxReturn } from '../../despacho/inbox-reading.js'

export type InboxRoomViewStatus = 'loading' | 'ready' | 'error'

/** The state of one `read` act, keyed by the account's IRI; `refused` carries the refusing party's words verbatim. */
export type InboxReadState =
  | { readonly phase: 'dry-run' }
  | { readonly phase: 'apply' }
  | { readonly phase: 'refused'; readonly at: string; readonly message: string }
  | { readonly phase: 'applied'; readonly subjects: readonly string[] }

export interface InboxReadDetail {
  readonly rendicion: string
}

function formatWhen(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(localeSource.get(), { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function tail(iri: string): string {
  return iri.split(':').pop() ?? iri
}

const WORD_LABELS: Readonly<Record<string, string>> = { yes: 'Yes', no: 'No', defer: 'Not yet', amend: 'Yes, with a change' }

@customElement('sh-inbox-room-view')
export class ShInboxRoomView extends LitElement {
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
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--mn-space-1, 4px) var(--mn-space-3, 12px);
      padding: var(--mn-space-3, 12px) 0;
      border-top: 1px solid var(--mn-color-border-subtle, var(--mn-color-border, #ddd));
      align-items: start;
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
    .meta {
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--mn-space-2, 8px);
    }
    .pill {
      display: inline-block;
      padding: 0 0.5em;
      border-radius: 999px;
      border: 1px solid var(--mn-color-border, currentColor);
      font-size: var(--mn-text-xs, 12px);
      font-variant-caps: all-small-caps;
      letter-spacing: 0.04em;
      line-height: 1.6;
    }
    .pill[data-ready='true'] {
      color: var(--mn-kind-state-good, var(--mn-color-status-good, #2b6e3f));
      border-color: currentColor;
    }
    .excerpt,
    .summary {
      margin: 0;
      color: var(--mn-color-text-secondary, var(--mn-color-text-primary));
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .empty {
      color: var(--mn-color-text-muted);
      font-style: italic;
    }
    .act {
      grid-row: span 3;
      align-self: center;
    }
    button.read {
      font: inherit;
      padding: var(--mn-space-1, 4px) var(--mn-space-3, 12px);
      border-radius: var(--mn-radius-control, 6px);
      border: 1px solid var(--mn-color-border, currentColor);
      background: var(--mn-color-surface-raised, transparent);
      color: inherit;
      cursor: pointer;
    }
    button.read:disabled {
      opacity: 0.6;
      cursor: default;
    }
    .verb-state {
      grid-column: 1 / -1;
      margin: 0;
      font-size: var(--mn-text-xs, 12px);
    }
    .verb-state[data-tone='danger'] {
      color: var(--mn-color-status-danger, #a33);
    }
    .verb-state[data-tone='good'] {
      color: var(--mn-color-status-good, #2b6e3f);
    }
    .state {
      color: var(--mn-color-text-muted);
    }
    .state[data-tone='danger'] {
      color: var(--mn-color-status-danger, #a33);
    }
    .note {
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-muted);
    }
  `

  @property({ type: String }) status: InboxRoomViewStatus = 'loading'
  @property({ type: String }) error = ''
  @property({ attribute: false }) reading: InboxReading | null = null
  /** True when the session can carry a reading to the cell. */
  @property({ type: Boolean }) canAct = false
  /** Who the session says the viewer is — the reader of any `read` given here. */
  @property({ type: String }) witness = ''
  @property({ attribute: false }) focusHref: (iri: string) => string = (iri) => `?focus=${encodeURIComponent(iri)}`
  /** Per-account act state, keyed by the Rendición IRI. */
  @property({ attribute: false }) readStates: ReadonlyMap<string, InboxReadState> = new Map()
  /** Seat titles for the convened seats, when the face learned them; falls back to the IRI tail. */
  @property({ attribute: false }) seatTitles: ReadonlyMap<string, string> = new Map()

  @state() private _nothing = 0

  private _read(rendicion: string): void {
    this.dispatchEvent(new CustomEvent<InboxReadDetail>('inbox-read', { detail: { rendicion }, bubbles: true, composed: true }))
  }

  private _state(message: string, tone: 'neutral' | 'danger' = 'neutral'): TemplateResult {
    return html`<div class="state" data-tone=${tone}>${message}</div>`
  }

  private _gate(gate: InboxGate): TemplateResult {
    const blockers = gate.blockers.filter((b) => b.status !== 'done')
    return html`<li class="row mn-kind" data-kind="reference" data-gate=${gate.iri} data-ready=${String(gate.ready)}>
      <a href=${this.focusHref(gate.iri)}>${gate.title}</a>
      <span class="pill mn-kind" data-kind="state" data-ready=${String(gate.ready)}>${gate.ready ? 'ready for your word' : 'waits on others'}</span>
      <div class="meta">
        ${gate.priority !== null ? html`<span>priority ${gate.priority}</span>` : nothing}
        ${gate.createdAt ? html`<span>strung ${formatWhen(gate.createdAt)}</span>` : nothing}
        ${blockers.length > 0 ? html`<span>waits on ${blockers.map((b) => `${tail(b.target)} (${b.status ?? 'unknown'})`).join(', ')}</span>` : nothing}
      </div>
    </li>`
  }

  private _letter(letter: InboxLetter): TemplateResult {
    return html`<li class="row mn-kind" data-kind="reference" data-letter=${letter.iri}>
      <a href=${this.focusHref(letter.iri)}>${letter.excerpt ?? letter.iri}</a>
      <span class="pill mn-kind" data-kind="state">${letter.kind}</span>
      <div class="meta">
        <span>from ${letter.fromTitle ?? tail(letter.from)}</span>
        <span>to ${this.seatTitles.get(letter.to) ?? tail(letter.to)}</span>
        <span>${formatWhen(letter.at)}</span>
        ${letter.conversation ? html`<span>in ${letter.conversation}</span>` : nothing}
      </div>
    </li>`
  }

  private _readStateLine(iri: string): TemplateResult | typeof nothing {
    const vs = this.readStates.get(iri)
    if (!vs) return nothing
    switch (vs.phase) {
      case 'dry-run':
        return html`<p class="verb-state" data-verb-phase="dry-run">${t('Asking the cell to check the reading (nothing written yet)…')}</p>`
      case 'apply':
        return html`<p class="verb-state" data-verb-phase="apply">${t('The check passed. Writing your reading…')}</p>`
      case 'refused':
        return html`<p class="verb-state" data-tone="danger" data-verb-phase="refused">Refused at ${vs.at}: ${vs.message}</p>`
      case 'applied':
        return html`<p class="verb-state" data-tone="good" data-verb-phase="applied">Your reading is in the graph: ${vs.subjects.join(', ')}</p>`
    }
  }

  private _return(account: InboxReturn): TemplateResult {
    const vs = this.readStates.get(account.iri)
    const busy = vs?.phase === 'dry-run' || vs?.phase === 'apply'
    const done = vs?.phase === 'applied'
    return html`<li class="row mn-kind" data-kind="testimony" data-rendicion=${account.iri}>
      <a href=${this.focusHref(account.forCuenta)}>${account.forTitle ?? tail(account.forCuenta)}</a>
      <span class="act mn-kind" data-kind="affordance">
        <button class="read" type="button" @click=${() => this._read(account.iri)} ?disabled=${!this.canAct || busy || done}>
          ${done ? 'Read' : t('Mark read')}
        </button>
      </span>
      <div class="meta">
        <span class="pill">${account.word ? (WORD_LABELS[account.word] ?? account.word) : account.verdict}</span>
        <span>${account.witness}</span>
        ${account.renderedAt ? html`<span>${formatWhen(account.renderedAt)}</span>` : nothing}
      </div>
      <p class="summary mn-kind" data-kind="prose">${account.summary}</p>
      ${this._readStateLine(account.iri)}
    </li>`
  }

  private _room(reading: InboxReading): TemplateResult {
    const seats = reading.seats.map((s) => this.seatTitles.get(s) ?? tail(s)).join(', ')
    return html`<div class="room">
      <div class="eyebrow mn-kind" data-kind="identity">
        <span class="kind">${t('inbox')}</span>
        <span>for ${reading.owner}</span>
        ${seats ? html`<span>· convenes ${seats}</span>` : nothing}
        ${reading.reader ? html`<span>· reading as ${reading.reader}</span>` : html`<span>· no viewer identity: returns cannot be cleared here</span>`}
      </div>
      <h1 class="title mn-kind" data-kind="identity">${t('What waits on you')}</h1>
      <div class="counts mn-kind" data-kind="metric">
        <span><strong>${reading.counts.gates}</strong> ${reading.counts.gates === 1 ? 'gate' : 'gates'} awaiting your word${reading.counts.gates > 0 ? html` (<strong>${reading.counts.ready}</strong> ready)` : nothing}</span>
        <span><strong>${reading.counts.letters}</strong> unanswered</span>
        <span><strong>${reading.counts.returns}</strong> ${reading.counts.returns === 1 ? 'return' : 'returns'} to read</span>
      </div>
      <section aria-labelledby="gates-heading">
        <h2 id="gates-heading">${t('Awaiting your word')}</h2>
        ${reading.gates.length === 0
          ? html`<p class="empty">${t('Nothing waits on your word.')}</p>`
          : html`<ul class="rows">${reading.gates.map((g) => this._gate(g))}</ul>`}
      </section>
      <section aria-labelledby="letters-heading">
        <h2 id="letters-heading">${t('Unanswered')}</h2>
        <p class="note">${t('Questions and requests to the seats you convene with no reply and no acknowledgement in the register.')}</p>
        ${reading.letters.length === 0
          ? html`<p class="empty">${t('Every question and request has been answered or acknowledged.')}</p>`
          : html`<ul class="rows">${reading.letters.map((l) => this._letter(l))}</ul>`}
      </section>
      <section aria-labelledby="returns-heading">
        <h2 id="returns-heading">${t('Returns to read')}</h2>
        <p class="note">${t('Accounts rendered by others. Marking one read records your own dated reading; nothing else clears it.')}</p>
        ${reading.returns.length === 0
          ? html`<p class="empty">${t('You have read every return.')}</p>`
          : html`<ul class="rows">${reading.returns.map((r) => this._return(r))}</ul>`}
      </section>
    </div>`
  }

  private _body(): TemplateResult {
    if (this.status === 'loading') return this._state(t('Opening your inbox…'))
    if (this.status === 'error') return this._state(this.error || 'The inbox could not be opened.', 'danger')
    if (!this.reading) return this._state(t('Nothing to show.'))
    return this._room(this.reading)
  }

  render(): TemplateResult {
    void this._nothing
    return html`<div class="stage" role="region" data-stance="dispatch" aria-label=${this.reading ? `Inbox for ${this.reading.owner}` : 'Inbox'}>
      ${this._body()}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-inbox-room-view': ShInboxRoomView
  }
}
