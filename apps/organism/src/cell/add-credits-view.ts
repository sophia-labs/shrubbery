import { LocaleController, t } from '@shrubbery/nucleus'
import { LitElement, css, html, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import {
  TOPUP_MAX_USD,
  TOPUP_MIN_USD,
  TOPUP_PRESETS_USD,
  checkTopUpUsd,
  parseTopUpAmount,
  type BillingCreditsPort,
} from './add-credits.js'
import { feeNote } from './billing-copy.js'

/**
 * The Add credits panel of Settings, Billing. It is controlled chrome over a
 * BillingCreditsPort: it owns what is typed and which preset is armed, and
 * nothing about URLs, tokens or Stripe. Choosing an amount and pressing the
 * button is the whole flow; the port sends the browser to Stripe.
 */
@customElement('mn-add-credits')
export class AddCreditsView extends LitElement {
  protected readonly _locale = new LocaleController(this)

  @property({ attribute: false }) port: BillingCreditsPort | null = null
  /** An amount to open on (the refusal banner's link carries one). Unusable amounts are ignored. */
  @property({ attribute: false }) preselect: number | null = null
  @state() private selected: number | null = null
  @state() private customText = ''
  private unsubscribe: (() => void) | null = null
  private subscribedTo: BillingCreditsPort | null = null

  static styles = css`
    :host{display:block;color:var(--mn-color-text-primary,#20252b);font:var(--mn-text-sm,13px)/1.5 var(--mn-font-utility,system-ui,sans-serif)}
    .panel{display:grid;gap:var(--mn-space-3,12px);padding:var(--mn-space-5,20px);border:1px solid var(--mn-color-border-subtle,#e5e7eb);border-radius:var(--mn-radius-surface,10px);background:var(--mn-color-surface-raised,#fff);box-sizing:border-box;min-width:0}
    h3{margin:0;font-family:var(--mn-font-serif,Georgia,serif);font-size:var(--mn-text-lg,18px);font-weight:600}
    .fine,.hint{margin:0;color:var(--mn-color-text-secondary,#4b5563);font-size:var(--mn-text-xs,12px)}
    .notice{display:grid;gap:var(--mn-space-2,8px);padding:var(--mn-space-4,16px);border:1px solid var(--mn-color-border-accent,var(--mn-color-border-subtle,#d1d5db));border-radius:var(--mn-radius-control,6px);background:var(--mn-color-surface-accent-subtle,var(--mn-color-surface-sunken,#f8fafc))}
    .notice h4{margin:0;font-size:var(--mn-text-sm,13px);font-weight:650}
    .notice p{margin:0}
    .presets{display:flex;flex-wrap:wrap;gap:var(--mn-space-2,8px)}
    button,input{font:inherit;color:inherit;box-sizing:border-box;min-height:40px;border:1px solid var(--mn-color-border-subtle,#d1d5db);border-radius:var(--mn-radius-control,6px);background:var(--mn-color-surface-raised,#fff)}
    button{padding:0 var(--mn-space-4,16px);font-weight:600;cursor:pointer}
    button:hover:not(:disabled){background:var(--mn-color-surface-hover,#f3f4f6)}
    button:disabled{opacity:.5;cursor:default}
    button:focus-visible,input:focus-visible{outline:none;box-shadow:var(--mn-focus-ring,0 0 0 2px currentColor)}
    .preset{min-width:64px}
    .preset[aria-pressed='true']{border-color:var(--mn-color-accent,#4f46e5);background:var(--mn-color-surface-accent-subtle,#eef2ff);color:var(--mn-color-text-accent-strong,#312e81)}
    .custom{display:flex;align-items:center;gap:var(--mn-space-2,8px);max-width:220px}
    .custom input{flex:1;min-width:0;padding:0 var(--mn-space-3,12px)}
    .custom .dollar{color:var(--mn-color-text-secondary,#4b5563)}
    .custom input::placeholder{color:var(--mn-color-text-secondary,#4b5563);opacity:1}
    .primary{justify-self:start;border-color:var(--mn-color-accent,#4f46e5);background:var(--mn-color-accent,#4f46e5);color:var(--mn-color-text-on-accent,#fff)}
    .primary:hover:not(:disabled){background:var(--mn-color-accent-active,var(--mn-color-accent,#4f46e5));filter:brightness(1.08)}
    .error{margin:0;color:var(--mn-color-text-danger,var(--mn-color-danger,#b91c1c))}
    @media(max-width:520px){.primary{justify-self:stretch}.custom{max-width:none}}
  `

  override connectedCallback(): void {
    super.connectedCallback()
    this.bind()
  }

  override disconnectedCallback(): void {
    this.release()
    super.disconnectedCallback()
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('port')) this.bind()
    if (changed.has('preselect')) this.applyPreselect()
  }

  /** Repaint whenever the port says its state moved (a checkout started, failed, or finished). */
  private bind(): void {
    if (!this.isConnected || this.subscribedTo === this.port) return
    this.release()
    const port = this.port
    if (!port) return
    this.subscribedTo = port
    this.unsubscribe = port.subscribe(() => this.requestUpdate())
  }

  private release(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.subscribedTo = null
  }

  private applyPreselect(): void {
    const amount = this.preselect
    if (amount === null) return
    const check = checkTopUpUsd(amount)
    if (!check.ok) return
    if (TOPUP_PRESETS_USD.includes(check.amountUsd)) {
      this.selected = check.amountUsd
      this.customText = ''
    } else {
      this.selected = null
      this.customText = String(check.amountUsd)
    }
  }

  private choose(amount: number): void {
    this.selected = amount
    this.customText = ''
  }

  private typed(text: string): void {
    this.selected = null
    this.customText = text
  }

  /** The amount that would be sent, or why not. An empty field is not an error yet. */
  private chosen(): { readonly amountUsd: number | null; readonly problem: string } {
    if (this.selected !== null) return { amountUsd: this.selected, problem: '' }
    const check = parseTopUpAmount(this.customText)
    return check.ok ? { amountUsd: check.amountUsd, problem: '' } : { amountUsd: null, problem: check.message }
  }

  private submit(amountUsd: number | null): void {
    if (amountUsd === null || !this.port) return
    void this.port.startTopUp(amountUsd)
  }

  override render() {
    const port = this.port
    if (!port) return nothing
    const { amountUsd, problem } = this.chosen()
    const { pending, error } = port.topUpState()
    const notice = port.notice()
    return html`
      <section class="panel" data-add-credits aria-labelledby="add-credits-title">
        <h3 id="add-credits-title">${t('Add credits')}</h3>
        ${notice ? html`<aside class="notice" data-credits-notice role="note" aria-label=${t('About credits')}>
          <h4>${notice.title}</h4>
          ${notice.paragraphs.map(paragraph => html`<p>${paragraph}</p>`)}
        </aside>` : nothing}
        <p class="fine" data-fee-note>${feeNote(port.feePercent())}</p>
        <div class="presets" role="group" aria-label=${t('Amount')}>
          ${TOPUP_PRESETS_USD.map(amount => html`<button type="button" class="preset" data-amount=${String(amount)} aria-pressed=${this.selected === amount ? 'true' : 'false'} @click=${() => this.choose(amount)}>$${amount}</button>`)}
        </div>
        <label class="custom">
          <span class="dollar" aria-hidden="true">$</span>
          <input data-custom-amount type="text" inputmode="numeric" autocomplete="off" placeholder=${t('Other amount')} aria-label=${t('Other amount in dollars')} .value=${this.customText} @input=${(event: Event) => this.typed((event.target as HTMLInputElement).value)}>
        </label>
        ${problem
          ? html`<p class="error" role="alert" data-amount-error>${problem}</p>`
          : html`<p class="hint">Whole dollars, $${TOPUP_MIN_USD} to $${TOPUP_MAX_USD}.</p>`}
        <button type="button" class="primary" data-add-credits-submit ?disabled=${amountUsd === null || pending} @click=${() => this.submit(amountUsd)}>${pending ? 'Opening checkout…' : amountUsd === null ? t('Add credits') : `Add $${amountUsd} in credits`}</button>
        ${error ? html`<p class="error" role="alert" data-checkout-error>${error}</p>` : nothing}
        <p class="fine">${t('You will pay on Stripe\'s secure checkout page, then come back here.')}</p>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-add-credits': AddCreditsView
  }
}
