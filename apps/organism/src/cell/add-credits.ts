/**
 * Add credits, without any DOM: the top-up policy, what a person may type, the
 * request the gateway accepts, the Stripe destination check, and the two seams
 * other surfaces use (the refusal banner's link and its suggested amount).
 *
 * Policy, Vera 2026-09-29: presets $5, $10, $25, $50; whole dollars only; at
 * least $5; at most $200 until a month of clean reconciliation.
 */

import type { CreditHistoryReader } from './credit-history.js'
import type { CreditsNoticeView } from './credits-notice.js'

export const TOPUP_PRESETS_USD: readonly number[] = Object.freeze([5, 10, 25, 50])
export const TOPUP_MIN_USD = 5
export const TOPUP_MAX_USD = 200
/** What most people should start on when nothing better is known. */
export const TOPUP_DEFAULT_USD = 10
/** The settings URL parameter that opens Billing on an amount. */
export const TOPUP_PARAM = 'topup'

export type TopUpAmountCheck =
  | { readonly ok: true; readonly amountUsd: number }
  | { readonly ok: false; readonly reason: 'empty' | 'not-whole' | 'below-min' | 'above-max'; readonly message: string }

const NOT_WHOLE = 'Enter a whole-dollar amount.'
const BELOW_MIN = `The minimum top-up is $${TOPUP_MIN_USD}.`
const ABOVE_MAX = `The most you can add at once is $${TOPUP_MAX_USD}.`

/** Is this many dollars something the gateway will be asked for? */
export function checkTopUpUsd(amountUsd: number): TopUpAmountCheck {
  if (typeof amountUsd !== 'number' || !Number.isInteger(amountUsd)) {
    return { ok: false, reason: 'not-whole', message: NOT_WHOLE }
  }
  if (amountUsd < TOPUP_MIN_USD) return { ok: false, reason: 'below-min', message: BELOW_MIN }
  if (amountUsd > TOPUP_MAX_USD) return { ok: false, reason: 'above-max', message: ABOVE_MAX }
  return { ok: true, amountUsd }
}

/** What a person typed: digits, optionally led by a dollar sign; nothing else is an amount. */
export function parseTopUpAmount(text: string): TopUpAmountCheck {
  const digits = text.trim().replace(/^\$\s*/, '')
  if (digits === '') return { ok: false, reason: 'empty', message: '' }
  if (!/^\d+$/.test(digits)) return { ok: false, reason: 'not-whole', message: NOT_WHOLE }
  return checkTopUpUsd(Number(digits))
}

/**
 * The body of `POST /billing/checkout` for a top-up. The live gateway
 * (`b75333258e36`, `normalize_checkout`) accepts `{kind:"topup", amountCents}`
 * and `{amount_usd}` with no `kind`; the pair `{kind:"topup", amount_usd}` falls
 * through to 400 `invalid_billing_request`. Whole dollars times 100 is exact.
 */
export function topUpRequestBody(amountUsd: number): { readonly kind: 'topup'; readonly amountCents: number } {
  const check = checkTopUpUsd(amountUsd)
  if (!check.ok) throw new RangeError(check.message)
  return { kind: 'topup', amountCents: check.amountUsd * 100 }
}

/** Where Stripe Checkout may take the browser: https, exactly checkout.stripe.com, no port, no credentials. */
export function stripeCheckoutUrl(value: unknown): URL {
  let url: URL
  try {
    url = new URL(typeof value === 'string' ? value : '')
  } catch {
    throw new Error('Invalid checkout destination.')
  }
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.port || url.username || url.password) {
    throw new Error('Invalid checkout destination.')
  }
  return url
}

/** The link the refusal banner's Add credits button follows: Billing, on an amount when it is a valid one. */
export function addCreditsHref(amountUsd?: number | null): string {
  const base = '/settings?settings=billing'
  if (typeof amountUsd !== 'number' || !checkTopUpUsd(amountUsd).ok) return base
  return `${base}&${TOPUP_PARAM}=${amountUsd}`
}

/** The amount a settings URL asks Billing to open on; null when it names none or an unusable one. */
export function topUpPreselectFromUrl(url: URL): number | null {
  const raw = url.searchParams.get(TOPUP_PARAM)
  if (!raw) return null
  const check = parseTopUpAmount(raw)
  return check.ok ? check.amountUsd : null
}

/**
 * What to preselect when a message was refused for want of credits: the default,
 * or the smallest preset that covers the shortfall, or the shortfall itself in
 * whole dollars (never more than the maximum). Unknown numbers: the default.
 */
export function suggestTopUpUsd(input: {
  readonly balanceMicroUsd?: number | null
  readonly requiredMicroUsd?: number | null
}): number {
  const balance = input.balanceMicroUsd
  const required = input.requiredMicroUsd
  if (typeof balance !== 'number' || typeof required !== 'number'
    || !Number.isSafeInteger(balance) || !Number.isSafeInteger(required)) return TOPUP_DEFAULT_USD
  const shortfallUsd = Math.ceil(Math.max(0, required - balance) / 1_000_000)
  const wanted = Math.max(TOPUP_DEFAULT_USD, shortfallUsd)
  const preset = TOPUP_PRESETS_USD.find(amount => amount >= wanted)
  return preset ?? Math.min(TOPUP_MAX_USD, wanted)
}

export interface TopUpState {
  readonly pending: boolean
  readonly error: string
}

/**
 * What the Billing panel needs from the account transport. HostedBilling is the
 * one implementation; the panel never sees a URL, a token or a fetch.
 */
export interface BillingCreditsPort {
  subscribe(callback: () => void): () => void
  topUpState(): TopUpState
  /** Create a Checkout Session for this many dollars and send the browser to Stripe. Never rejects. */
  startTopUp(amountUsd: number): Promise<void>
  /** Re-read the ledger balance alone. Never rejects; a failed read leaves the balance unknown. */
  refreshBalance(): Promise<void>
  /** The last balance read for this session, or null when unread or unavailable. */
  balanceMicroUsd(): number | null
  /** The service fee the backend charges, in percent (15 today, 20 after the flip); null while it names none: the copy then leaves the fee out. */
  feePercent(): number | null
  /** The credits notice the backend's facts make (Billing shows the same words as the chat), or null while it names no date. */
  notice(): CreditsNoticeView | null
  /** What came in and what was adjusted, for the same account. */
  readonly history: CreditHistoryReader
}
