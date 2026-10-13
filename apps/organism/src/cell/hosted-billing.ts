import type { MnSettingsSection } from '@shrubbery/components'
import {
  TOPUP_MAX_USD,
  TOPUP_MIN_USD,
  checkTopUpUsd,
  stripeCheckoutUrl,
  topUpRequestBody,
  type BillingCreditsPort,
  type TopUpState,
} from './add-credits.js'
import {
  BILLING_DESCRIPTION,
  STARTER_CREDIT_LABEL,
  STARTER_CREDIT_MICRO_USD,
  USAGE_SUMMARY_NOTE,
  formatMicroUsd,
} from './billing-copy.js'
import {
  defaultCheckoutStorage,
  rememberPendingCheckout,
  type PendingCheckoutStorage,
} from './checkout-return.js'
import { HostedCreditHistory, type CreditHistoryReader } from './credit-history.js'
import { feePercentOf, parseCreditsFacts, type CreditsFacts } from '@shrubbery/runtime/chat-services/credits-facts'
import { defaultCreditsNotice, type CreditsNoticeView } from './credits-notice.js'

interface BillingAuth {
  userId(): string
  token(): string | null | undefined
  whenReady?(): Promise<void>
}
type Row = Record<string, unknown>
type ReadState = { value?: Row; error?: string }
type ReadKind = 'balance' | 'subscription' | 'usage'
const money = formatMicroUsd
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)
/** An account with no ledger row yet holds the starter credit; say that, not "Not initialized". */
function balanceLabel(balance: Row | undefined): string {
  if (balance?.initialized === false && integer(balance.balanceMicroUsd)) {
    return balance.balanceMicroUsd === STARTER_CREDIT_MICRO_USD ? STARTER_CREDIT_LABEL : `${money(balance.balanceMicroUsd)} starter credit`
  }
  return money(balance?.balanceMicroUsd)
}

export interface HostedBillingOptions {
  /** Where the pre-checkout marker lives. Default: this tab's session storage; null: nowhere. */
  readonly storage?: PendingCheckoutStorage | null
  /** The clock the pre-checkout marker is stamped with. */
  readonly now?: () => number
  /**
   * The credits notice Billing shows, given what the backend said on the balance it read (Vera,
   * 2026-10-03: the day and the fee are the backend's). Default: built from those facts and the build's own
   * settings, so there is none until the backend names a date.
   */
  readonly notice?: (facts: CreditsFacts | null) => CreditsNoticeView | null
}

interface RequestExtras {
  readonly body?: unknown
  /**
   * Lines keyed by the gateway's error CODE (`{"error": "<prose>", "code": "<code>"}`). The SPA
   * speaks its own words for a code it knows; the gateway's prose is never shown.
   */
  readonly codes?: Readonly<Record<string, string>>
  /** Status-specific lines; a status that is not listed uses `fallback`, then the account default. */
  readonly messages?: Readonly<Record<number, string>>
  readonly fallback?: string
}

const AMOUNT_REFUSED = `That amount can't be charged. Choose a whole-dollar amount from $${TOPUP_MIN_USD} to $${TOPUP_MAX_USD}.`
const CHECKOUT_START_FAILED = 'Checkout could not be started. Try again.'
const CHECKOUT_OPEN_FAILED = 'The checkout page could not be opened. Try again or contact support.'
const CHECKOUT_CODES: Readonly<Record<string, string>> = {
  topup_amount_out_of_range: AMOUNT_REFUSED,
  subscriptions_unavailable: 'Subscriptions are not available yet.',
  billing_not_configured: 'Checkout is not available right now. Try again later.',
}
const CHECKOUT_MESSAGES: Readonly<Record<number, string>> = {
  400: AMOUNT_REFUSED,
  401: 'Billing requires an authorized signed-in account.',
  403: 'Billing requires an authorized signed-in account.',
  429: 'Too many attempts. Wait a minute and try again.',
}

/** The `code` of a gateway error body, or '' when the answer is not one (prose, empty, not JSON). */
async function errorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    const code = body && typeof body === 'object' ? (body as Record<string, unknown>).code : undefined
    return typeof code === 'string' ? code : ''
  } catch {
    return ''
  }
}

/** Account-only gateway calls: never a graph/cell endpoint or a stored credential. */
export class HostedBilling implements BillingCreditsPort {
  /** Credit history for this same account and gateway, read with the same session. */
  readonly history: CreditHistoryReader
  private readonly base: URL
  private readonly fetchImpl: typeof fetch
  private readonly listeners = new Set<() => void>()
  private subject = ''
  private token = ''
  private reads: Record<string, ReadState> = {}
  private pending: Promise<void> | null = null
  private loaded = false
  private portalPending = false
  private portalError = ''
  private topUpPending = false
  private topUpError = ''

  constructor(
    private readonly auth: BillingAuth,
    gatewayBaseUrl: string,
    fetchImpl: typeof fetch = globalThis.fetch,
    private readonly navigate: (url: string) => void = url => globalThis.location.assign(url),
    private readonly options: HostedBillingOptions = {},
  ) {
    // Native browser fetch requires the Window receiver, not this service.
    this.fetchImpl = fetchImpl.bind(globalThis) as typeof fetch
    this.base = new URL(gatewayBaseUrl)
    if (!['https:', 'http:'].includes(this.base.protocol) || this.base.username || this.base.password || this.base.search || this.base.hash) {
      throw new Error('Invalid billing gateway URL')
    }
    this.history = new HostedCreditHistory(auth, gatewayBaseUrl, fetchImpl)
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback)
    return () => { this.listeners.delete(callback) }
  }
  private emit(): void { for (const listener of this.listeners) listener() }
  private current(subject: string, token: string): boolean {
    return subject === this.auth.userId() && token === this.auth.token()
  }
  private syncIdentity(): void {
    const subject = this.auth.userId(), token = this.auth.token() ?? ''
    if (this.subject !== subject || this.token !== token) {
      this.subject = subject; this.token = token; this.reads = {}; this.loaded = false; this.portalError = ''; this.topUpError = ''
    }
  }
  ensureLoaded(): void {
    this.syncIdentity()
    if (!this.loaded && !this.pending) void this.refresh()
  }
  private async failure(response: Response, extras: RequestExtras): Promise<string> {
    if (extras.codes) {
      const code = await errorCode(response)
      if (code && Object.hasOwn(extras.codes, code)) return extras.codes[code] as string
    }
    const specific = extras.messages?.[response.status]
    if (specific) return specific
    if (extras.fallback) return extras.fallback
    return response.status === 401 || response.status === 403
      ? 'Billing requires an authorized signed-in account.'
      : response.status === 409 ? 'No billing portal is available for this account yet.'
      : 'Billing is temporarily unavailable. Try again.'
  }
  private async request(path: string, method: 'GET' | 'POST', subject: string, token: string, extras: RequestExtras = {}): Promise<Row> {
    if (!subject || !token) throw new Error('Sign in to view billing.')
    const hasBody = extras.body !== undefined
    let response: Response
    try {
      response = await this.fetchImpl(new URL(path, this.base).href, {
        method,
        headers: hasBody
          ? { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' }
          : { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        body: hasBody ? JSON.stringify(extras.body) : undefined,
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000),
      })
    } catch { throw new Error('Billing could not be reached. Try again.') }
    if (!this.current(subject, token)) throw new Error('Your session changed. Refresh billing.')
    if (!response.ok) throw new Error(await this.failure(response, extras))
    let value: unknown
    try { value = await response.json() } catch { throw new Error('Billing returned an invalid response.') }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Billing returned an invalid response.')
    return value as Row
  }
  /** One account read, checked against the session it was asked for. Never throws: a failure is its state. */
  private async readKind(kind: ReadKind, subject: string, token: string): Promise<ReadState> {
    try {
      const value = await this.request(`/billing/${kind}${kind === 'usage' ? '?days=30' : ''}`, 'GET', subject, token)
      if (value.userId !== subject
        || (kind === 'balance' && (!integer(value.balanceMicroUsd) || !integer(value.lifetimeUsageMicroUsd) || (value.lifetimeUsageMicroUsd as number) < 0 || typeof value.initialized !== 'boolean'))
        || (kind === 'subscription' && (typeof value.tier !== 'string' || typeof value.status !== 'string'))
        || (kind === 'usage' && (!integer(value.totalMicroUsd) || value.totalMicroUsd < 0 || !integer(value.eventCount) || value.eventCount < 0 || !integer(value.fromTs) || !integer(value.toTs) || value.fromTs >= value.toTs))) {
        throw new Error('Billing returned an invalid response.')
      }
      return { value }
    } catch (error) { return { error: error instanceof Error ? error.message : 'Billing is unavailable.' } }
  }
  async refresh(): Promise<void> {
    if (this.pending) return this.pending
    const work = async () => {
      try { await this.auth.whenReady?.() } catch { /* request reports absent session */ }
      this.syncIdentity()
      const { subject, token } = this
      this.reads = {}; this.loaded = true; this.emit()
      await Promise.all((['balance', 'subscription', 'usage'] as const).map(async kind => {
        const state = await this.readKind(kind, subject, token)
        if (this.current(subject, token)) this.reads[kind] = state
      }))
    }
    this.pending = work()
    this.emit()
    try { await this.pending } finally { this.pending = null; this.emit() }
  }
  /** The ledger balance alone, for a return that is waiting for a payment to land. */
  async refreshBalance(): Promise<void> {
    try { await this.auth.whenReady?.() } catch { /* request reports absent session */ }
    this.syncIdentity()
    const { subject, token } = this
    const state = await this.readKind('balance', subject, token)
    if (!this.current(subject, token)) return
    this.reads.balance = state
    this.emit()
  }
  balanceMicroUsd(): number | null {
    this.syncIdentity()
    const value = this.reads.balance?.value?.balanceMicroUsd
    return integer(value) ? value : null
  }
  topUpState(): TopUpState {
    return { pending: this.topUpPending, error: this.topUpError }
  }
  /**
   * What the backend said of the credits regime (the fee, the gate's mode, the day credits start) on the
   * balance it last answered, or null before one, after a failed one, and from an older backend that says
   * none of it. The same balance read Billing already makes: no second request.
   */
  facts(): CreditsFacts | null {
    this.syncIdentity()
    const row = this.reads.balance?.value
    return row ? parseCreditsFacts(row) : null
  }
  /** The service fee the backend charges, in percent (15 today, 20 after the flip); null when it names none. */
  feePercent(): number | null {
    return feePercentOf(this.facts())
  }
  notice(): CreditsNoticeView | null {
    return (this.options.notice ?? defaultCreditsNotice)(this.facts())
  }
  async startTopUp(amountUsd: number): Promise<void> {
    if (this.topUpPending) return
    const check = checkTopUpUsd(amountUsd)
    if (!check.ok) { this.topUpError = check.message; this.emit(); return }
    this.topUpPending = true; this.topUpError = ''; this.emit()
    try {
      try { await this.auth.whenReady?.() } catch { /* request reports absent session */ }
      this.syncIdentity()
      const subject = this.auth.userId(), token = this.auth.token() ?? ''
      const [, value] = await Promise.all([
        // The marker's baseline must be the balance from BEFORE the payment, not one cached when Settings
        // opened (the person may have spent since). Asked together with the checkout, it adds no wait, and
        // it never rejects: a failed read leaves the baseline unknown rather than stale.
        this.refreshBalance(),
        this.request('/billing/checkout', 'POST', subject, token, {
          body: topUpRequestBody(check.amountUsd), codes: CHECKOUT_CODES, messages: CHECKOUT_MESSAGES, fallback: CHECKOUT_START_FAILED,
        }),
      ])
      let destination: URL
      try { destination = stripeCheckoutUrl(value.url ?? value.checkout_url) } catch { throw new Error(CHECKOUT_OPEN_FAILED) }
      if (!this.current(subject, token)) throw new Error('Your session changed. Refresh billing.')
      // The return URL cannot say what was bought or what the balance was.
      rememberPendingCheckout(
        this.options.storage === undefined ? defaultCheckoutStorage() : this.options.storage,
        { kind: 'topup', amountUsd: check.amountUsd, baselineMicroUsd: this.balanceMicroUsd(), at: (this.options.now ?? Date.now)() },
      )
      this.navigate(destination.href)
    } catch (error) {
      this.topUpError = error instanceof Error ? error.message : CHECKOUT_START_FAILED
    } finally { this.topUpPending = false; this.emit() }
  }
  async action(actionId: string): Promise<void> {
    if (actionId === 'refresh-usage') return this.refresh()
    if (actionId !== 'manage-billing') throw new Error('Unknown billing action.')
    if (this.portalPending) return
    this.syncIdentity()
    this.portalPending = true; this.portalError = ''; this.emit()
    try {
      await this.auth.whenReady?.()
      this.syncIdentity()
      const subject = this.auth.userId(), token = this.auth.token() ?? ''
      const value = await this.request('/billing/portal', 'POST', subject, token)
      const url = new URL(typeof value.url === 'string' ? value.url : '')
      if (url.protocol !== 'https:' || url.hostname !== 'billing.stripe.com' || url.port || url.username || url.password || !this.current(subject, token)) {
        throw new Error('Invalid billing portal destination.')
      }
      this.navigate(url.href)
    } catch (error) {
      this.portalError = error instanceof Error && error.message === 'No billing portal is available for this account yet.'
        ? error.message
        : 'The billing portal could not be opened. Try again or contact support.'
    } finally { this.portalPending = false; this.emit() }
  }
  decorate(section: MnSettingsSection): MnSettingsSection {
    this.syncIdentity()
    const balance = this.reads.balance?.value, subscription = this.reads.subscription?.value, usage = this.reads.usage?.value
    const loading = Boolean(this.pending)
    if (section.id === 'billing') return {
      ...section,
      description: BILLING_DESCRIPTION,
      contentSlot: 'billing-credits',
      metrics: [
        { id: 'balance', label: 'Credit balance', value: balanceLabel(balance) },
        { id: 'tier', label: 'Account tier', value: typeof subscription?.accountTier === 'string' && ['free', 'pro', 'supporter', 'visionary', 'dev'].includes(subscription.accountTier) ? subscription.accountTier : 'Unavailable' },
        { id: 'subscription', label: 'Subscription status', value: subscription?.status === 'none' ? 'No subscription' : String(subscription?.status ?? 'Unavailable') },
      ],
      // A portal that cannot work is not shown: a disabled button and an apology are noise.
      actions: subscription?.canManage === true
        ? [{ id: 'manage-billing', label: this.portalPending ? 'Opening billing…' : 'Manage billing', disabled: this.portalPending || !this.subject || !this.token, description: 'Open the Stripe billing portal for this account.' }]
        : [],
      notes: [
        ...(loading ? ['Loading account billing…'] : []),
        ...['balance', 'subscription'].flatMap(kind => this.reads[kind]?.error ? [`${kind === 'balance' ? 'Balance' : 'Subscription'}: ${this.reads[kind].error}`] : []),
        ...(this.portalError ? [this.portalError] : []),
      ],
    }
    if (section.id === 'usage') return {
      ...section, description: 'Account inference usage recorded by the hosted billing ledger.',
      metrics: [
        { id: 'cost', label: 'Usage cost (last 30 days)', value: money(usage?.totalMicroUsd) },
        { id: 'events', label: 'Recorded usage events', value: usage ? String(usage.eventCount) : 'Unavailable' },
        { id: 'lifetime', label: 'Lifetime credit usage', value: money(balance?.lifetimeUsageMicroUsd) },
      ],
      actions: [{ id: 'refresh-usage', label: loading ? 'Refreshing…' : 'Refresh usage', disabled: loading }],
      notes: [
        USAGE_SUMMARY_NOTE,
        ...(usage?.eventCount === 0 ? ['No usage events recorded in this period.'] : []),
        ...(this.reads.usage?.error ? [this.reads.usage.error] : []),
        ...(this.reads.balance?.error ? ['Lifetime usage is unavailable.'] : []),
      ],
    }
    return section
  }
}
