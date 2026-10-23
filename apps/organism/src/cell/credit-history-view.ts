import { LocaleController, localeSource, t } from '@shrubbery/nucleus'
import { LitElement, css, html, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { formatMicroUsd } from './billing-copy.js'
import type { CreditHistoryEntry, CreditHistoryReader } from './credit-history.js'

const dateFormat = (date: Date): string => new Intl.DateTimeFormat(localeSource.get(), { dateStyle: 'medium' }).format(date)
/** The sign is words as well as colour: a person who cannot see the red still reads "-". */
const signed = (microUsd: number): string => `${microUsd < 0 ? '-' : '+'}${formatMicroUsd(Math.abs(microUsd))}`

/**
 * The credit history of Settings, Billing: what came in and what was adjusted,
 * newest first, one line each (date, words, signed amount). Controlled chrome over
 * a CreditHistoryReader. A deployment without the route shows nothing at all; a
 * failure says so and offers to try again.
 */
@customElement('mn-credit-history')
export class CreditHistoryView extends LitElement {
  protected readonly _locale = new LocaleController(this)

  @property({ attribute: false }) reader: CreditHistoryReader | null = null
  /** Change it to reload the list (the return bumps it when a top-up lands). */
  @property({ type: Number }) refreshKey = 0
  @state() private entries: readonly CreditHistoryEntry[] = []
  @state() private cursor: string | null = null
  @state() private phase: 'idle' | 'loading' | 'ready' | 'absent' | 'error' = 'idle'
  @state() private error = ''
  @state() private busy = false
  private generation = 0

  static styles = css`
    :host{display:block;color:var(--mn-color-text-primary,#20252b);font:var(--mn-text-sm,13px)/1.5 var(--mn-font-utility,system-ui,sans-serif)}
    .history{display:grid;gap:var(--mn-space-3,12px);padding:var(--mn-space-5,20px);border:1px solid var(--mn-color-border-subtle,#e5e7eb);border-radius:var(--mn-radius-surface,10px);background:var(--mn-color-surface-raised,#fff);box-sizing:border-box;min-width:0}
    h3{margin:0;font-family:var(--mn-font-serif,Georgia,serif);font-size:var(--mn-text-lg,18px);font-weight:600}
    p{margin:0}
    .muted{color:var(--mn-color-text-secondary,#4b5563)}
    .error{color:var(--mn-color-text-danger,var(--mn-color-danger,#b91c1c))}
    .entries{list-style:none;margin:0;padding:0;display:grid}
    .entry{display:grid;grid-template-columns:minmax(6.5rem,auto) minmax(0,1fr) auto;align-items:baseline;gap:var(--mn-space-3,12px);padding:var(--mn-space-3,12px) 0;border-top:1px solid var(--mn-color-border-subtle,#e5e7eb)}
    .entry:first-child{border-top:0}
    .when{color:var(--mn-color-text-secondary,#4b5563);font-size:var(--mn-text-xs,12px);white-space:nowrap}
    .what{min-width:0;overflow-wrap:anywhere}
    .amount{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
    .entry[data-direction='out'] .amount{color:var(--mn-color-danger,#b91c1c)}
    button{font:inherit;color:inherit;min-height:40px;padding:0 var(--mn-space-4,16px);border:1px solid var(--mn-color-border-subtle,#d1d5db);border-radius:var(--mn-radius-control,6px);background:var(--mn-color-surface-raised,#fff);font-weight:600;cursor:pointer;box-sizing:border-box}
    button:hover:not(:disabled){background:var(--mn-color-surface-hover,#f3f4f6)}
    button:disabled{opacity:.5;cursor:default}
    button:focus-visible{outline:none;box-shadow:var(--mn-focus-ring,0 0 0 2px currentColor)}
    .more{justify-self:start}
    @media(max-width:520px){.entry{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:'what amount' 'when when'}.what{grid-area:what}.amount{grid-area:amount}.when{grid-area:when}.more{justify-self:stretch}}
  `

  protected override updated(changed: PropertyValues): void {
    if (changed.has('reader') || changed.has('refreshKey')) void this.load(true)
  }

  override disconnectedCallback(): void {
    // Anything still in flight belongs to a list nobody is looking at.
    this.generation += 1
    super.disconnectedCallback()
  }

  private async load(reset: boolean): Promise<void> {
    const reader = this.reader
    if (!reader) return
    const generation = ++this.generation
    const after = reset ? undefined : this.cursor ?? undefined
    if (reset && this.entries.length === 0) this.phase = 'loading'
    this.busy = true
    try {
      const page = await reader.page(after)
      if (generation !== this.generation) return
      if (page === null) {
        this.phase = 'absent'
        this.entries = []
        this.cursor = null
        return
      }
      const known = new Set(reset ? [] : this.entries.map(entry => entry.id))
      this.entries = reset ? page.entries : [...this.entries, ...page.entries.filter(entry => !known.has(entry.id))]
      this.cursor = page.nextCursor
      this.phase = 'ready'
      this.error = ''
    } catch (error) {
      if (generation !== this.generation) return
      // What was already listed stays; only the failure is added to it.
      this.phase = 'error'
      this.error = error instanceof Error ? error.message : 'Credit history could not be loaded.'
    } finally {
      if (generation === this.generation) this.busy = false
    }
  }

  private renderEntry(entry: CreditHistoryEntry) {
    const when = entry.at === null
      ? 'Date unknown'
      : html`<time datetime=${new Date(entry.at).toISOString()}>${dateFormat(new Date(entry.at))}</time>`
    return html`<li class="entry" data-credit-entry data-kind=${entry.kind} data-direction=${entry.amountMicroUsd < 0 ? 'out' : 'in'}>
      <span class="when">${when}</span>
      <span class="what">${entry.label}</span>
      <span class="amount">${signed(entry.amountMicroUsd)}</span>
    </li>`
  }

  override render() {
    if (!this.reader || this.phase === 'absent') return nothing
    return html`
      <section class="history" data-credit-history aria-labelledby="credit-history-title">
        <h3 id="credit-history-title">${t('Credit history')}</h3>
        ${this.phase === 'loading' ? html`<p class="muted" role="status" data-history-loading>${t('Loading credit history…')}</p>` : nothing}
        ${this.phase === 'error'
          ? html`<p class="error" role="alert" data-history-error>${this.error} <button type="button" data-history-retry ?disabled=${this.busy} @click=${() => void this.load(true)}>${t('Try again')}</button></p>`
          : nothing}
        ${this.phase === 'ready' && this.entries.length === 0 ? html`<p class="muted" data-history-empty>${t('No credit activity yet.')}</p>` : nothing}
        ${this.entries.length ? html`<ol class="entries">${this.entries.map(entry => this.renderEntry(entry))}</ol>` : nothing}
        ${this.cursor ? html`<button type="button" class="more" data-history-more ?disabled=${this.busy} @click=${() => void this.load(false)}>${t('Show earlier')}</button>` : nothing}
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-credit-history': CreditHistoryView
  }
}
