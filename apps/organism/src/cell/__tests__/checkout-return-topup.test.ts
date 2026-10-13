/**
 * The Stripe return for a top-up: `/settings?settings=billing&checkout=success|cancel`.
 *
 * The person paid for credits, so the return says so, and then watches the
 * BALANCE (not the plan tier and subscription status, which a top-up never
 * changes) until it rises. Real route, real settings service, real HostedBilling
 * and a real loopback gateway; the only thing set up by hand is the moment the
 * webhook lands (`onBalanceRead`).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import type { MnSettingsPage, MnToast } from '@shrubbery/components'
import { mountOrganismAppRoute } from '../app-routes.js'
import {
  pollBalanceAfterCheckout,
  rememberPendingCheckout,
  showCheckoutResultToast,
  showCheckoutReturnToast,
  takePendingCheckout,
  type PendingCheckout,
  type PendingCheckoutStorage,
} from '../checkout-return.js'
import { HostedBilling } from '../hosted-billing.js'
import { createDefaultSettingsService } from '../settings-service.js'
import { BillingGateway } from './support/billing-gateway.js'

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
afterEach(() => document.body.replaceChildren())

async function until(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
const settle = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const returnToast = () => document.body.querySelector<MnToast>('mn-toast[data-checkout-return]')
const resultToast = (result: string) => document.body.querySelector<MnToast>(`mn-toast[data-checkout-result="${result}"]`)
const balanceShown = (host: HTMLElement) => {
  const page = host.querySelector('mn-settings-page') as MnSettingsPage | null
  return page?.sections.find(section => section.id === 'billing')?.metrics?.find(metric => metric.id === 'balance')?.value
}

/** A tab that started a top-up when its balance was `baselineMicroUsd`. */
function tabThatStartedTopUp(baselineMicroUsd: number | null): PendingCheckoutStorage {
  const storage = new MemoryStorage()
  const marker: PendingCheckout = { kind: 'topup', amountUsd: 5, baselineMicroUsd, at: Date.now() }
  rememberPendingCheckout(storage, marker)
  return storage
}

function mountReturn(outcome: 'success' | 'cancel', storage: PendingCheckoutStorage | null, poll = { intervalMs: 10, attempts: 20 }) {
  const billing = new HostedBilling({ userId: () => 'alice', token: () => 'id-token' }, gateway.base, undefined, undefined, { storage })
  const replaced: string[] = []
  const host = document.createElement('div')
  document.body.appendChild(host)
  const mount = mountOrganismAppRoute(host, {
    location: new URL(`https://garden.test/settings?settings=billing&checkout=${outcome}`),
    settingsService: createDefaultSettingsService({ runtimeMode: 'hosted', billing }),
    replaceUrl: url => { replaced.push(url.href) },
    checkoutPlanPoll: poll,
    checkoutStorage: storage,
  })
  return { host, mount: mount!, replaced, billing }
}

describe('the return toast says what was bought', () => {
  it('a top-up says the credits are on the way', () => {
    const toast = showCheckoutReturnToast(document, 'success', 'topup')
    expect(toast.message).toBe('Payment received. Your credits are on the way.')
    expect(toast.type).toBe('success')
    expect(toast.duration).toBe(10_000)
    expect(toast.getAttribute('data-checkout-return')).toBe('success')
  })

  it('a top-up is the default, because credits are what is on sale', () => {
    expect(showCheckoutReturnToast(document, 'success').message).toBe('Payment received. Your credits are on the way.')
  })

  it('a plan checkout keeps its own words', () => {
    expect(showCheckoutReturnToast(document, 'success', 'plan').message).toBe('Payment received — your plan is updating')
  })

  it('a cancelled checkout is quiet, whatever it was for', () => {
    for (const kind of ['topup', 'plan'] as const) {
      const toast = showCheckoutReturnToast(document, 'cancel', kind)
      expect(toast.message).toBe('Checkout cancelled')
      expect(toast.type).toBe('info')
      expect(toast.duration).toBe(4_000)
    }
  })

  it('a credit that arrived says so, with the balance', () => {
    const toast = showCheckoutResultToast(document, 'credited', 5_003_760)
    expect(toast.message).toBe('Credits added')
    expect(toast.description).toBe('Your balance is $5.00376.')
    expect(toast.type).toBe('success')
    expect(toast.getAttribute('data-checkout-result')).toBe('credited')
    expect(showCheckoutResultToast(document, 'credited', null).description).toBe('')
  })

  it('a balance that could not be read says that, and does not claim the credit is late', () => {
    const toast = showCheckoutResultToast(document, 'unreadable', null)
    expect(toast.message).toBe('We could not check your balance')
    expect(toast.description).toBe('Reload this page in a moment to see it.')
    expect(toast.type).toBe('info')
    expect(toast.getAttribute('data-checkout-result')).toBe('unreadable')
  })

  it('a credit that has not arrived says that, and how to check again', () => {
    const toast = showCheckoutResultToast(document, 'late', null)
    expect(toast.message).toBe('Your credits have not arrived yet')
    expect(toast.description).toBe('Payments can take a minute to clear. Reload this page in a moment to check again.')
    expect(toast.type).toBe('info')
    expect(toast.getAttribute('data-checkout-result')).toBe('late')
  })
})

describe('waiting for the balance to rise', () => {
  it('stops as soon as the balance is above the baseline', async () => {
    const balances = [3_760, 3_760, 5_003_760, 5_003_760]
    let calls = 0
    const result = await pollBalanceAfterCheckout({
      baseline: 3_760, intervalMs: 0, attempts: 10, isActive: () => true,
      read: async () => balances[calls++] ?? null,
    })
    expect(result).toBe('changed')
    expect(calls).toBe(3)
  })

  it('does not take a lower or an unknown balance for a payment', async () => {
    const balances: Array<number | null> = [null, 3_000, 3_760, null]
    let calls = 0
    const result = await pollBalanceAfterCheckout({
      baseline: 3_760, intervalMs: 0, attempts: 4, isActive: () => true,
      read: async () => balances[calls++] ?? null,
    })
    expect(result).toBe('unchanged')
    expect(calls).toBe(4)
  })

  it('keeps waiting when a read fails', async () => {
    let calls = 0
    const result = await pollBalanceAfterCheckout({
      baseline: 100, intervalMs: 0, attempts: 5, isActive: () => true,
      read: async () => { calls += 1; if (calls === 1) throw new Error('reset'); return 900 },
    })
    expect(result).toBe('changed')
    expect(calls).toBe(2)
  })

  it('says the balance was unreadable when no read ever succeeded, not that nothing arrived', async () => {
    let calls = 0
    const nulls = await pollBalanceAfterCheckout({
      baseline: 100, intervalMs: 0, attempts: 3, isActive: () => true,
      read: async () => { calls += 1; return null },
    })
    expect(nulls).toBe('unreadable')
    expect(calls).toBe(3)
    const throws = await pollBalanceAfterCheckout({
      baseline: 100, intervalMs: 0, attempts: 2, isActive: () => true,
      read: async () => { throw new Error('reset') },
    })
    expect(throws).toBe('unreadable')
  })

  it('still says unchanged when a read succeeded and showed no rise', async () => {
    const balances: Array<number | null> = [null, 100, null]
    let calls = 0
    const result = await pollBalanceAfterCheckout({
      baseline: 100, intervalMs: 0, attempts: 3, isActive: () => true,
      read: async () => balances[calls++] ?? null,
    })
    expect(result).toBe('unchanged')
  })

  it('stops when the route goes away', async () => {
    let active = true, calls = 0
    const result = await pollBalanceAfterCheckout({
      baseline: 100, intervalMs: 0, attempts: 10, isActive: () => active,
      read: async () => { calls += 1; if (calls === 2) active = false; return 100 },
    })
    expect(result).toBe('stopped')
    expect(calls).toBe(2)
  })
})

describe('the settings route on a top-up return', () => {
  it('success: says credits are on the way, scrubs the URL, and re-reads the balance until it rises', async () => {
    gateway.balanceMicroUsd = 3_760
    gateway.onBalanceRead = reads => { if (reads >= 4) gateway.balanceMicroUsd = 5_003_760 }
    const { host, mount, replaced } = mountReturn('success', tabThatStartedTopUp(3_760))
    expect(mount.route).toEqual({ kind: 'settings', sectionId: 'billing' })
    // Scrubbed before anything async: a reload mid-wait must not re-toast.
    expect(replaced).toEqual(['https://garden.test/settings?settings=billing'])
    expect(returnToast()?.message).toBe('Payment received. Your credits are on the way.')
    expect(returnToast()?.type).toBe('success')

    await mount.ready
    await until(() => balanceShown(host) === '$5.00376')
    await until(() => resultToast('credited') !== null)
    expect(resultToast('credited')?.description).toBe('Your balance is $5.00376.')
    const readsWhenCredited = gateway.balanceReads
    await settle(100)
    expect(gateway.balanceReads).toBe(readsWhenCredited)
    // Only the balance was polled: the plan was never re-read for a top-up.
    expect(gateway.paths().filter(path => path === 'GET /billing/subscription')).toHaveLength(1)
    expect(document.body.querySelectorAll('mn-toast[data-checkout-return]')).toHaveLength(1)

    mount.destroy()
    host.remove()
  })

  it('success, when the credit landed before the browser was back: credited at once, no waiting', async () => {
    // The webhook beat the redirect. The tab remembered the balance from before
    // the payment, so the first read after the return already shows the rise.
    gateway.balanceMicroUsd = 5_003_760
    const { host, mount } = mountReturn('success', tabThatStartedTopUp(3_760))
    await mount.ready
    await until(() => resultToast('credited') !== null)
    expect(resultToast('credited')?.description).toBe('Your balance is $5.00376.')
    const reads = gateway.balanceReads
    expect(reads).toBeLessThanOrEqual(2)
    await settle(80)
    expect(gateway.balanceReads).toBe(reads)
    expect(resultToast('late')).toBeNull()

    mount.destroy()
    host.remove()
  })

  it('success, with no marker: baselines on the first read and stays quiet if nothing rises', async () => {
    // Another tab, or storage that refused: nothing says what the balance was.
    const { host, mount } = mountReturn('success', null, { intervalMs: 10, attempts: 3 })
    expect(returnToast()?.message).toBe('Payment received. Your credits are on the way.')
    await mount.ready
    await settle(150)
    expect(resultToast('credited')).toBeNull()
    // Not knowing the balance from before, it cannot claim the credit is late.
    expect(resultToast('late')).toBeNull()
    expect(gateway.balanceReads).toBeGreaterThanOrEqual(3)

    mount.destroy()
    host.remove()
  })

  it('success, with no marker, still notices a rise after the first read', async () => {
    gateway.balanceMicroUsd = 1_000_000
    gateway.onBalanceRead = reads => { if (reads >= 4) gateway.balanceMicroUsd = 6_000_000 }
    const { host, mount } = mountReturn('success', null)
    await mount.ready
    await until(() => resultToast('credited') !== null)
    expect(resultToast('credited')?.description).toBe('Your balance is $6.00.')

    mount.destroy()
    host.remove()
  })

  it('success, when the credit never arrives: says so, and how to check again', async () => {
    gateway.balanceMicroUsd = 3_760
    const { host, mount } = mountReturn('success', tabThatStartedTopUp(3_760), { intervalMs: 10, attempts: 3 })
    await mount.ready
    await until(() => resultToast('late') !== null)
    expect(resultToast('late')?.message).toBe('Your credits have not arrived yet')
    expect(resultToast('credited')).toBeNull()

    mount.destroy()
    host.remove()
  })

  it('success, when the balance cannot be read at all: says so, and never claims the credit is late', async () => {
    gateway.balanceStatus = 503
    const { host, mount } = mountReturn('success', tabThatStartedTopUp(3_760), { intervalMs: 10, attempts: 3 })
    await mount.ready
    await until(() => resultToast('unreadable') !== null)
    expect(resultToast('unreadable')?.message).toBe('We could not check your balance')
    expect(resultToast('late')).toBeNull()
    expect(resultToast('credited')).toBeNull()

    mount.destroy()
    host.remove()
  })

  it('success, when the balance was read once and then failed: it has not arrived as far as anyone can tell', async () => {
    // Reads 1 and 2 (the settings load and the first read after the return) succeed and show no rise;
    // everything after them fails. The last thing known is that nothing had arrived.
    gateway.balanceMicroUsd = 3_760
    gateway.onBalanceRead = reads => { if (reads >= 3) gateway.balanceStatus = 503 }
    const { host, mount } = mountReturn('success', tabThatStartedTopUp(3_760), { intervalMs: 10, attempts: 3 })
    await mount.ready
    await until(() => resultToast('late') !== null)
    expect(resultToast('unreadable')).toBeNull()

    mount.destroy()
    host.remove()
  })

  it('cancel: a quiet toast, the marker discarded, and no balance polling', async () => {
    const storage = tabThatStartedTopUp(3_760)
    const { host, mount, replaced } = mountReturn('cancel', storage)
    expect(replaced).toEqual(['https://garden.test/settings?settings=billing'])
    expect(returnToast()?.message).toBe('Checkout cancelled')
    expect(returnToast()?.type).toBe('info')
    await mount.ready
    await settle(100)
    // The initial load reads the balance once; nothing more.
    expect(gateway.balanceReads).toBe(1)
    expect(takePendingCheckout(storage, Date.now())).toBeNull()
    expect(resultToast('credited')).toBeNull()
    expect(resultToast('late')).toBeNull()

    mount.destroy()
    host.remove()
  })

  it('consumes the marker on the return, so a reload cannot replay it', async () => {
    const storage = tabThatStartedTopUp(3_760)
    const first = mountReturn('success', storage, { intervalMs: 10, attempts: 1 })
    await first.mount.ready
    expect(takePendingCheckout(storage, Date.now())).toBeNull()
    first.mount.destroy()
    first.host.remove()
  })

  it('stops re-reading the balance once the route is destroyed', async () => {
    gateway.balanceMicroUsd = 3_760
    const { host, mount } = mountReturn('success', tabThatStartedTopUp(3_760), { intervalMs: 10, attempts: 1_000 })
    await mount.ready
    await until(() => gateway.balanceReads >= 4)
    mount.destroy()
    host.remove()
    await settle(30)
    const afterDestroy = gateway.balanceReads
    await settle(100)
    expect(gateway.balanceReads).toBe(afterDestroy)
    expect(resultToast('late')).toBeNull()
  })
})
