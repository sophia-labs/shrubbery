// @vitest-environment node
/**
 * Add credits, from the SPA's account transport to a real gateway-shaped server.
 * Node environment on purpose: a real fetch sends the bearer, which happy-dom's
 * fetch would strip under `credentials: 'omit'`, and these tests assert it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { takePendingCheckout, type PendingCheckoutStorage } from '../checkout-return.js'
import { HostedBilling, type HostedBillingOptions } from '../hosted-billing.js'
import { BillingGateway, DEFAULT_CHECKOUT_URL } from './support/billing-gateway.js'

class MemoryStorage implements PendingCheckoutStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const gateway = new BillingGateway()
beforeAll(async () => { await gateway.start() })
afterAll(async () => { await gateway.stop() })
beforeEach(() => { gateway.reset() })

function billingOn(base: string, options: HostedBillingOptions = { storage: null }, subject: () => string = () => 'alice') {
  const navigated: string[] = []
  const billing = new HostedBilling(
    { userId: subject, token: () => 'id-token' },
    base,
    undefined,
    url => { navigated.push(url) },
    options,
  )
  return { billing, navigated }
}

describe('Add credits: the checkout request', () => {
  it('posts the closed top-up body with the bearer, then goes to Stripe', async () => {
    const { billing, navigated } = billingOn(gateway.base)
    await billing.startTopUp(25)

    // One checkout is created; the balance is also read as the person leaves (see the marker tests).
    const posts = gateway.requests.filter(candidate => candidate.method === 'POST')
    expect(posts).toHaveLength(1)
    const request = posts[0]!
    expect(request.method).toBe('POST')
    expect(request.path).toBe('/billing/checkout')
    expect(request.authorization).toBe('Bearer id-token')
    expect(request.contentType).toContain('application/json')
    expect(request.body).toEqual({ kind: 'topup', amountCents: 2500 })
    expect([...request.query.keys()]).toEqual([])
    expect(navigated).toEqual([DEFAULT_CHECKOUT_URL])
    expect(billing.topUpState()).toEqual({ pending: false, error: '' })
  })

  it('sends nothing, and says why, for an amount outside the policy', async () => {
    const { billing, navigated } = billingOn(gateway.base)
    await billing.startTopUp(4)
    expect(billing.topUpState().error).toBe('The minimum top-up is $5.')
    await billing.startTopUp(201)
    expect(billing.topUpState().error).toBe('The most you can add at once is $200.')
    await billing.startTopUp(12.5)
    expect(billing.topUpState().error).toBe('Enter a whole-dollar amount.')
    expect(gateway.requests).toHaveLength(0)
    expect(navigated).toEqual([])
  })

  it('clears the last error when the next attempt starts', async () => {
    gateway.checkout = () => ({ status: 502, text: 'private upstream diagnostic' })
    const { billing } = billingOn(gateway.base)
    await billing.startTopUp(10)
    expect(billing.topUpState().error).not.toBe('')
    gateway.checkout = undefined
    await billing.startTopUp(10)
    expect(billing.topUpState().error).toBe('')
  })

  it.each([
    'http://checkout.stripe.com/c/pay/x',
    'https://checkout.stripe.com.evil.example/c/pay/x',
    'https://evil.example/steal',
    'https://billing.stripe.com/p/session',
    'https://checkout.stripe.com:8443/c/pay/x',
    'https://user@checkout.stripe.com/c/pay/x',
    'javascript:alert(1)',
  ])('does not navigate to %s', async destination => {
    gateway.checkout = () => ({ status: 200, body: { url: destination, checkout_url: destination } })
    const storage = new MemoryStorage()
    const { billing, navigated } = billingOn(gateway.base, { storage })
    await billing.startTopUp(10)
    expect(navigated).toEqual([])
    expect(billing.topUpState().error).toBe('The checkout page could not be opened. Try again or contact support.')
    // Nothing was remembered for a checkout that never started.
    expect(takePendingCheckout(storage, Date.now())).toBeNull()
  })

  it('does not navigate when the answer carries no destination at all', async () => {
    gateway.checkout = () => ({ status: 200, body: {} })
    const { billing, navigated } = billingOn(gateway.base)
    await billing.startTopUp(10)
    expect(navigated).toEqual([])
    expect(billing.topUpState().error).toBe('The checkout page could not be opened. Try again or contact support.')
  })

  it.each([
    [400, "That amount can't be charged. Choose a whole-dollar amount from $5 to $200."],
    [401, 'Billing requires an authorized signed-in account.'],
    [403, 'Billing requires an authorized signed-in account.'],
    [429, 'Too many attempts. Wait a minute and try again.'],
    [502, 'Checkout could not be started. Try again.'],
    [503, 'Checkout could not be started. Try again.'],
  ])('answers %i with an honest line and never the upstream text', async (status, line) => {
    gateway.checkout = () => ({ status, text: 'private upstream diagnostic' })
    const { billing, navigated } = billingOn(gateway.base)
    await billing.startTopUp(10)
    expect(billing.topUpState().error).toBe(line)
    expect(billing.topUpState().error).not.toContain('private upstream')
    expect(navigated).toEqual([])
  })

  // The gateway's error shape is {"error": "<text>", "code": "<code>"} (GB-gateway-billing-return.md
  // 2.4). The SPA reads the CODE and speaks its own words; the gateway's prose is never shown.
  it.each([
    [400, 'topup_amount_out_of_range', "That amount can't be charged. Choose a whole-dollar amount from $5 to $200."],
    [503, 'subscriptions_unavailable', 'Subscriptions are not available yet.'],
    [503, 'billing_not_configured', 'Checkout is not available right now. Try again later.'],
    [403, 'billing_human_auth_required', 'Billing requires an authorized signed-in account.'],
    [502, 'billing_authority_unavailable', 'Checkout could not be started. Try again.'],
    [409, 'billing_conflict', 'Checkout could not be started. Try again.'],
    [503, 'something_new', 'Checkout could not be started. Try again.'],
  ])('answers %i %s in its own honest words, never the gateway’s', async (status, code, line) => {
    gateway.checkout = () => ({ status, body: { error: 'private upstream diagnostic', code } })
    const { billing, navigated } = billingOn(gateway.base)
    await billing.startTopUp(10)
    expect(billing.topUpState().error).toBe(line)
    expect(billing.topUpState().error).not.toContain('private upstream')
    expect(navigated).toEqual([])
  })

  it('says so when billing cannot be reached', async () => {
    const { billing, navigated } = billingOn('http://127.0.0.1:1')
    await billing.startTopUp(10)
    expect(billing.topUpState().error).toBe('Billing could not be reached. Try again.')
    expect(navigated).toEqual([])
  })

  it('does not follow a checkout that was created for a different session', async () => {
    let subject = 'alice'
    gateway.checkout = () => {
      subject = 'bob'
      return { status: 200, body: { url: DEFAULT_CHECKOUT_URL } }
    }
    const { billing, navigated } = billingOn(gateway.base, { storage: null }, () => subject)
    await billing.startTopUp(10)
    expect(navigated).toEqual([])
    expect(billing.topUpState().error).toBe('Your session changed. Refresh billing.')
  })

  it('starts one checkout at a time', async () => {
    const { billing, navigated } = billingOn(gateway.base)
    const first = billing.startTopUp(10)
    expect(billing.topUpState().pending).toBe(true)
    const second = billing.startTopUp(10)
    await Promise.all([first, second])
    expect(gateway.requests.filter(request => request.path === '/billing/checkout')).toHaveLength(1)
    expect(navigated).toHaveLength(1)
    expect(billing.topUpState().pending).toBe(false)
  })

  it('tells its subscribers when it starts and when it finishes', async () => {
    const { billing } = billingOn(gateway.base)
    const states: boolean[] = []
    billing.subscribe(() => { states.push(billing.topUpState().pending) })
    await billing.startTopUp(10)
    expect(states[0]).toBe(true)
    expect(states.at(-1)).toBe(false)
  })
})

describe('Add credits: what the return needs to remember', () => {
  it('records the balance before checkout, so a credit that lands early is not mistaken for none', async () => {
    const storage = new MemoryStorage()
    const { billing } = billingOn(gateway.base, { storage, now: () => 1_700_000_000_000 })
    await billing.refresh()
    await billing.startTopUp(10)
    expect(takePendingCheckout(storage, 1_700_000_060_000)).toEqual({
      kind: 'topup', amountUsd: 10, baselineMicroUsd: 12_340_000, at: 1_700_000_000_000,
    })
    // Taking it consumes it: a reload must not replay the return.
    expect(takePendingCheckout(storage, 1_700_000_060_000)).toBeNull()
  })

  it('reads the balance as the person leaves, even if Settings never did', async () => {
    const storage = new MemoryStorage()
    const { billing } = billingOn(gateway.base, { storage, now: () => 1_700_000_000_000 })
    await billing.startTopUp(10)
    expect(takePendingCheckout(storage, 1_700_000_000_500)).toEqual({
      kind: 'topup', amountUsd: 10, baselineMicroUsd: 12_340_000, at: 1_700_000_000_000,
    })
  })

  it('does not trust a balance cached when Settings opened: the person may have spent since', async () => {
    const storage = new MemoryStorage()
    const { billing } = billingOn(gateway.base, { storage, now: () => 1_700_000_000_000 })
    await billing.refresh()
    expect(billing.balanceMicroUsd()).toBe(12_340_000)
    // Spent in another tab after Settings opened; more than the top-up will add back.
    gateway.balanceMicroUsd = 2_000_000
    await billing.startTopUp(5)
    expect(takePendingCheckout(storage, 1_700_000_000_500)?.baselineMicroUsd).toBe(2_000_000)
  })

  it('records an unknown baseline, never a stale one, when that read fails', async () => {
    const storage = new MemoryStorage()
    const { billing, navigated } = billingOn(gateway.base, { storage, now: () => 1_700_000_000_000 })
    await billing.refresh()
    gateway.balanceStatus = 503
    await billing.startTopUp(10)
    // The checkout itself still went ahead: only the balance read failed.
    expect(navigated).toHaveLength(1)
    expect(takePendingCheckout(storage, 1_700_000_000_500)).toEqual({
      kind: 'topup', amountUsd: 10, baselineMicroUsd: null, at: 1_700_000_000_000,
    })
  })

  it('asks for the checkout and the balance together, and for nothing else', async () => {
    // Both leave at once, so a slow ledger read cannot hold the payment page back beyond itself.
    const { billing } = billingOn(gateway.base)
    await billing.startTopUp(10)
    const kinds = gateway.requests.map(candidate => `${candidate.method} ${candidate.path}`).sort()
    expect(kinds).toEqual(['GET /billing/balance', 'POST /billing/checkout'])
  })
})

describe('the balance, on its own', () => {
  it('is null until read, then the ledger number, and re-reads only the balance', async () => {
    const { billing } = billingOn(gateway.base)
    expect(billing.balanceMicroUsd()).toBeNull()
    await billing.refreshBalance()
    expect(billing.balanceMicroUsd()).toBe(12_340_000)
    gateway.balanceMicroUsd = 22_340_000
    await billing.refreshBalance()
    expect(billing.balanceMicroUsd()).toBe(22_340_000)
    expect(gateway.paths()).toEqual(['GET /billing/balance', 'GET /billing/balance'])
  })

  it('is null, and never a made-up zero, when the read fails', async () => {
    const { billing } = billingOn('http://127.0.0.1:1')
    await billing.refreshBalance()
    expect(billing.balanceMicroUsd()).toBeNull()
  })

  it('tells its subscribers when the balance moved', async () => {
    const { billing } = billingOn(gateway.base)
    let notified = 0
    billing.subscribe(() => { notified += 1 })
    await billing.refreshBalance()
    expect(notified).toBeGreaterThan(0)
  })

  it('discards a balance answered for a session that has since changed', async () => {
    let subject = 'alice'
    gateway.onBalanceRead = () => { subject = 'bob' }
    const { billing } = billingOn(gateway.base, { storage: null }, () => subject)
    await billing.refreshBalance()
    expect(billing.balanceMicroUsd()).toBeNull()
  })
})
