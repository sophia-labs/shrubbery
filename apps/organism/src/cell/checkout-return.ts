/**
 * Stripe Checkout return: `/settings?settings=billing&checkout=success|cancel`.
 *
 * Choreograph sends the browser back here after a hosted Checkout session.
 * The shell reports the outcome once (in words that say what was bought: credits
 * by default, a plan when this tab said it started one), scrubs `checkout` from
 * history so a reload does not repeat it, and — on success — re-reads billing a
 * few times until Stripe's webhook has landed server-side: the BALANCE for a
 * top-up (against the balance from before the payment, which the tab remembers in
 * a marker), the plan tier and status for a plan.
 */

import type { MnToast } from '@shrubbery/components'
import type { MnSettingsSection } from '@shrubbery/components'
import { formatMicroUsd } from './billing-copy.js'

export type CheckoutReturn = 'success' | 'cancel'

/** What was being bought: credits (the only thing on sale at launch) or a plan. */
export type CheckoutKind = 'topup' | 'plan'

export const CHECKOUT_PARAM = 'checkout'

/**
 * A checkout the SPA started in this tab, remembered across the Stripe round
 * trip. The return URL is fixed by a server parameter and cannot say what was
 * bought or what the balance was, so the SPA leaves that here itself.
 *
 * `baselineMicroUsd` is the balance from BEFORE the payment: Stripe's webhook can
 * land before the browser is back, and a poll that baselined on the first read
 * after the return would then wait for a rise that had already happened.
 */
export interface PendingCheckout {
  readonly kind: CheckoutKind
  readonly amountUsd: number | null
  readonly baselineMicroUsd: number | null
  readonly at: number
}

export type PendingCheckoutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const PENDING_CHECKOUT_KEY = 'shrubbery.checkout.pending.v1'
/** A payment page left open longer than this is not the return we are waiting for. */
export const PENDING_CHECKOUT_MAX_AGE_MS = 30 * 60 * 1000
const PENDING_CHECKOUT_CLOCK_SKEW_MS = 60 * 1000

/** This tab's session storage (the redirect returns to the same tab), or null when there is none or it refuses. */
export function defaultCheckoutStorage(): PendingCheckoutStorage | null {
  try {
    const storage = globalThis.sessionStorage
    return storage && typeof storage.getItem === 'function' ? storage : null
  } catch {
    return null
  }
}

export function rememberPendingCheckout(
  storage: PendingCheckoutStorage | null | undefined,
  value: PendingCheckout,
): void {
  if (!storage) return
  try {
    storage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(value))
  } catch {
    // Private windows and blocked site data refuse. The return then falls back
    // to its own first read, which is the behaviour before this marker existed.
  }
}

/**
 * Read the marker and forget it, so a reload cannot replay a return. A marker
 * that is stale, from the future, or not the shape this module writes reads as
 * absent (and is still forgotten).
 */
export function takePendingCheckout(
  storage: PendingCheckoutStorage | null | undefined,
  now: number = Date.now(),
): PendingCheckout | null {
  if (!storage) return null
  let raw: string | null
  try {
    raw = storage.getItem(PENDING_CHECKOUT_KEY)
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    storage.removeItem(PENDING_CHECKOUT_KEY)
  } catch {
    // Consumed as far as this storage allows.
  }
  return parsePendingCheckout(raw, now)
}

function parsePendingCheckout(raw: string, now: number): PendingCheckout | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const { kind, amountUsd, baselineMicroUsd, at } = row
  if (kind !== 'topup' && kind !== 'plan') return null
  if (amountUsd !== null && !(typeof amountUsd === 'number' && Number.isInteger(amountUsd))) return null
  if (baselineMicroUsd !== null && !(typeof baselineMicroUsd === 'number' && Number.isSafeInteger(baselineMicroUsd))) return null
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  if (now - at > PENDING_CHECKOUT_MAX_AGE_MS || at > now + PENDING_CHECKOUT_CLOCK_SKEW_MS) return null
  return { kind, amountUsd: amountUsd as number | null, baselineMicroUsd: baselineMicroUsd as number | null, at }
}

/** Null when the location carries no recognised checkout outcome. */
export function checkoutReturnFrom(url: URL): CheckoutReturn | null {
  const value = url.searchParams.get(CHECKOUT_PARAM)?.trim().toLowerCase()
  return value === 'success' || value === 'cancel' ? value : null
}

/** True when the URL carries any `checkout` param, recognised or not. */
export function hasCheckoutParam(url: URL): boolean {
  return url.searchParams.has(CHECKOUT_PARAM)
}

/** The same URL minus `checkout`; every other param and the fragment survive. */
export function withoutCheckoutParam(url: URL): URL {
  const next = new URL(url.href)
  next.searchParams.delete(CHECKOUT_PARAM)
  return next
}

/**
 * A body-owned toast: route re-renders must not take it down. The words say what
 * was bought: credits by default (what is on sale), a plan when the tab that
 * started the checkout said so.
 */
export function showCheckoutReturnToast(doc: Document, outcome: CheckoutReturn, kind: CheckoutKind = 'topup'): MnToast {
  const toast = doc.createElement('mn-toast')
  toast.setAttribute('data-checkout-return', outcome)
  toast.position = 'top-right'
  toast.closable = true
  toast.autoShow = false
  if (outcome === 'success') {
    toast.type = 'success'
    if (kind === 'plan') {
      toast.message = 'Payment received — your plan is updating'
      toast.description = 'Your new plan appears here as soon as Stripe confirms it.'
    } else {
      toast.message = 'Payment received. Your credits are on the way.'
    }
    toast.duration = 10_000
  } else {
    toast.type = 'info'
    toast.message = 'Checkout cancelled'
    toast.duration = 4_000
  }
  doc.body.append(toast)
  toast.show()
  return toast
}

/** How a top-up ended, once the wait for the balance is over. */
export type CheckoutResult = 'credited' | 'late' | 'unreadable'

/**
 * The follow-up to "your credits are on the way": they arrived (with the balance),
 * the wait ran out with the balance readable and unchanged, or the balance could not
 * be read at all (which is not the same as "not arrived", and is not claimed to be).
 * Tagged `data-checkout-result`, not `data-checkout-return`, so it never counts as
 * the return's own toast.
 */
export function showCheckoutResultToast(doc: Document, result: CheckoutResult, balanceMicroUsd: number | null): MnToast {
  // One message at a time. Toasts share a corner, so a second one shown over the first covers it (a stub of
  // "Payment received" peeked out from under "Credits added"); the result is the end of what the first said.
  for (const onTheWay of doc.body.querySelectorAll<MnToast>('mn-toast[data-checkout-return]')) onTheWay.dismiss()
  const toast = doc.createElement('mn-toast')
  toast.setAttribute('data-checkout-result', result)
  toast.position = 'top-right'
  toast.closable = true
  toast.autoShow = false
  if (result === 'credited') {
    toast.type = 'success'
    toast.message = 'Credits added'
    if (balanceMicroUsd !== null) toast.description = `Your balance is ${formatMicroUsd(balanceMicroUsd)}.`
    toast.duration = 8_000
  } else if (result === 'unreadable') {
    toast.type = 'info'
    toast.message = 'We could not check your balance'
    toast.description = 'Reload this page in a moment to see it.'
    toast.duration = 12_000
  } else {
    toast.type = 'info'
    toast.message = 'Your credits have not arrived yet'
    toast.description = 'Payments can take a minute to clear. Reload this page in a moment to check again.'
    toast.duration = 12_000
  }
  doc.body.append(toast)
  toast.show()
  return toast
}

/**
 * The plan as the Billing section shows it (tier + subscription status).
 * Empty when the section has not loaded a plan yet.
 */
export function billingPlanSignature(sections: readonly MnSettingsSection[]): string {
  const billing = sections.find(section => section.id === 'billing')
  const read = (id: string) => billing?.metrics?.find(metric => metric.id === id)?.value
  const tier = read('tier'), status = read('subscription')
  if (tier == null && status == null) return ''
  return `${String(tier ?? '')}|${String(status ?? '')}`
}

export interface CheckoutPlanPollOptions {
  /** Re-read billing and return the plan signature it now shows. */
  readonly refresh: () => Promise<string>
  /** The plan shown before polling started. */
  readonly baseline: string
  readonly intervalMs: number
  readonly attempts: number
  readonly isActive: () => boolean
  readonly sleep?: (ms: number) => Promise<void>
}

export type CheckoutPlanPollResult = 'changed' | 'unchanged' | 'stopped'

/**
 * Stripe's webhook, not the redirect, moves the plan; the redirect can beat
 * it. Re-read until the plan differs from the baseline, the budget runs out,
 * or the route goes away.
 */
export async function pollPlanAfterCheckout(options: CheckoutPlanPollOptions): Promise<CheckoutPlanPollResult> {
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    await sleep(options.intervalMs)
    if (!options.isActive()) return 'stopped'
    let plan: string
    try { plan = await options.refresh() } catch { continue }
    if (!options.isActive()) return 'stopped'
    if (plan && plan !== options.baseline) return 'changed'
  }
  return 'unchanged'
}

export interface CheckoutBalancePollOptions {
  /** Re-read the balance; null when it could not be read. */
  readonly read: () => Promise<number | null>
  /** The balance from before the payment (or, without a marker, the first read after the return). */
  readonly baseline: number
  readonly intervalMs: number
  readonly attempts: number
  readonly isActive: () => boolean
  readonly sleep?: (ms: number) => Promise<void>
}

/** `unreadable`: not one read succeeded, so nothing is known about whether the credit arrived. */
export type CheckoutBalancePollResult = CheckoutPlanPollResult | 'unreadable'

/**
 * Stripe's webhook, not the redirect, moves the balance; the redirect can beat
 * it. Re-read until the balance is ABOVE the baseline (a lower or unknown read is
 * not a payment), the budget runs out, or the route goes away. A wait in which no
 * read succeeded says `unreadable`, never `unchanged`: it did not see nothing arrive,
 * it saw nothing.
 */
export async function pollBalanceAfterCheckout(options: CheckoutBalancePollOptions): Promise<CheckoutBalancePollResult> {
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  let readable = false
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    await sleep(options.intervalMs)
    if (!options.isActive()) return 'stopped'
    let balance: number | null
    try { balance = await options.read() } catch { continue }
    if (!options.isActive()) return 'stopped'
    if (balance === null) continue
    readable = true
    if (balance > options.baseline) return 'changed'
  }
  return options.attempts > 0 && !readable ? 'unreadable' : 'unchanged'
}

/** What a Stripe return turned out to be: the outcome, what was bought, and the balance from before. */
export interface CheckoutReturnState {
  readonly outcome: CheckoutReturn
  readonly kind: CheckoutKind
  /** Known only from this tab's own marker, and only for a successful top-up. */
  readonly baselineMicroUsd: number | null
}
