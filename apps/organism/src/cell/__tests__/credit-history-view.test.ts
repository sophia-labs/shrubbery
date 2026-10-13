/**
 * `<mn-credit-history>` in a real DOM over a real HostedBilling and a real loopback
 * gateway: each entry with its date, its words and its signed amount, and every
 * honest state around them (loading, empty, absent, failed, more). The envelope is
 * the ASSUMED one pinned in credit-history.test.ts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import { mountOrganismAppRoute } from '../app-routes.js'
import { rememberPendingCheckout, type PendingCheckoutStorage } from '../checkout-return.js'
import '../credit-history-view.js'
import type { CreditHistoryView } from '../credit-history-view.js'
import { HostedBilling } from '../hosted-billing.js'
import { createDefaultSettingsService } from '../settings-service.js'
import { BillingGateway, type RecordedRequest } from './support/billing-gateway.js'

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

const TOPUP_AT = Date.parse('2026-09-30T18:00:00.000Z')
const GIFT_AT = Date.parse('2026-10-01T09:30:00.000Z')
const REFUND_AT = Date.parse('2026-10-02T00:00:00.000Z')
const day = (ms: number): string => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(ms))

const topUp = { id: 'g1', kind: 'grant', source: 'stripe', amountMicroUsd: 10_000_000, createdAt: TOPUP_AT }
const gift = { id: 'a1', kind: 'adjustment', reason: 'credits start', amountMicroUsd: 850_000, createdAt: GIFT_AT }
const refund = { id: 'a2', kind: 'adjustment', reason: 'refund of a top-up', amountMicroUsd: -5_000_000, createdAt: REFUND_AT }
const envelope = (items: unknown[], nextCursor: string | null = null) => ({ userId: 'alice', items, nextCursor })

function billing(): HostedBilling {
  return new HostedBilling({ userId: () => 'alice', token: () => 'id-token' }, gateway.base, undefined, undefined, { storage: null })
}

async function mount(): Promise<CreditHistoryView> {
  const view = document.createElement('mn-credit-history') as CreditHistoryView
  view.reader = billing().history
  document.body.append(view)
  await view.updateComplete
  return view
}

const shadow = (view: CreditHistoryView): ShadowRoot => view.shadowRoot!
const entries = (view: CreditHistoryView): Element[] => [...shadow(view).querySelectorAll('[data-credit-entry]')]
const cell = (row: Element, selector: string): string => row.querySelector(selector)!.textContent!.trim()
const errorText = (view: CreditHistoryView): string | null => shadow(view).querySelector('[data-history-error]')?.textContent ?? null
const historyRequests = (): RecordedRequest[] => gateway.requests.filter(request => request.path === '/billing/credits/history')

describe('the credit history list', () => {
  it('shows each entry with its date, its words and its signed amount, newest first', async () => {
    gateway.history = () => ({ status: 200, body: envelope([topUp, gift, refund]) })
    const view = await mount()
    await until(() => entries(view).length === 3)
    expect(shadow(view).querySelector('h3')!.textContent!.trim()).toBe('Credit history')
    const rows = entries(view)
    expect(rows.map(row => cell(row, '.what'))).toEqual(['Refund of a top-up', 'Credits start', 'Top-up'])
    expect(rows.map(row => cell(row, '.amount'))).toEqual(['-$5.00', '+$0.85', '+$10.00'])
    expect(rows.map(row => cell(row, '.when'))).toEqual([day(REFUND_AT), day(GIFT_AT), day(TOPUP_AT)])
  })

  it('marks what took credit away apart from what added it, without colour alone', async () => {
    gateway.history = () => ({ status: 200, body: envelope([topUp, refund]) })
    const view = await mount()
    await until(() => entries(view).length === 2)
    const [taken, added] = entries(view)
    expect(taken!.getAttribute('data-direction')).toBe('out')
    expect(added!.getAttribute('data-direction')).toBe('in')
    expect(cell(taken!, '.amount').startsWith('-')).toBe(true)
    expect(cell(added!, '.amount').startsWith('+')).toBe(true)
  })

  it('says there is nothing yet', async () => {
    gateway.history = () => ({ status: 200, body: envelope([]) })
    const view = await mount()
    await until(() => shadow(view).querySelector('[data-history-empty]') !== null)
    expect(shadow(view).querySelector('[data-history-empty]')!.textContent!.trim()).toBe('No credit activity yet.')
    expect(entries(view)).toHaveLength(0)
  })

  it.each([404, 502, 503])('shows nothing at all when there is no history to show (%i)', async status => {
    // 404 is a gateway without the route, 502 a Choreograph without it (the gateway's answer for that),
    // 503 billing not configured: none of them is the person's to read.
    gateway.history = () => ({ status, body: { error: 'x', code: 'billing_authority_unavailable' } })
    const view = await mount()
    await until(() => historyRequests().length === 1)
    await view.updateComplete
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(shadow(view).querySelector('[data-credit-history]')).toBeNull()
    expect(shadow(view).querySelector('h3')).toBeNull()
  })

  it('says what went wrong, keeps no half-list, and lets the person try again', async () => {
    gateway.history = () => ({ status: 500, text: 'private upstream diagnostic' })
    const view = await mount()
    await until(() => errorText(view) !== null)
    expect(errorText(view)).toContain('Credit history could not be loaded (500).')
    expect(shadow(view).textContent).not.toContain('private upstream')
    expect(shadow(view).querySelector('[data-history-error]')!.getAttribute('role')).toBe('alert')
    expect(entries(view)).toHaveLength(0)

    gateway.history = () => ({ status: 200, body: envelope([topUp]) })
    shadow(view).querySelector<HTMLButtonElement>('[data-history-retry]')!.click()
    await until(() => entries(view).length === 1)
    expect(errorText(view)).toBeNull()
  })

  it('shows earlier entries on request, once each', async () => {
    const older = { id: 'g0', kind: 'grant', source: 'starter', amountMicroUsd: 1_000_000, createdAt: Date.parse('2026-08-01T00:00:00Z') }
    gateway.history = (request: RecordedRequest) => request.query.get('after') === 'c2'
      ? { status: 200, body: envelope([topUp, older]) }
      : { status: 200, body: envelope([topUp], 'c2') }
    const view = await mount()
    await until(() => entries(view).length === 1)
    const more = shadow(view).querySelector<HTMLButtonElement>('[data-history-more]')!
    expect(more.textContent!.trim()).toBe('Show earlier')
    more.click()
    await until(() => entries(view).length === 2)
    // The second page repeated the first entry; it is listed once.
    expect(entries(view).map(row => cell(row, '.what'))).toEqual(['Top-up', 'Starter credit'])
    expect(historyRequests().map(request => request.query.get('after'))).toEqual([null, 'c2'])
    expect(shadow(view).querySelector('[data-history-more]')).toBeNull()
  })

  it('reloads when told to, without remounting', async () => {
    gateway.history = () => ({ status: 200, body: envelope([topUp]) })
    const view = await mount()
    await until(() => entries(view).length === 1)
    gateway.history = () => ({ status: 200, body: envelope([topUp, gift]) })
    view.refreshKey = 1
    await until(() => entries(view).length === 2)
    expect(historyRequests()).toHaveLength(2)
  })

  it('renders an operator’s words as text, never as markup', async () => {
    gateway.history = () => ({ status: 200, body: envelope([{ id: 'a9', kind: 'adjustment', reason: '<img src=x onerror=alert(1)> sorry', amountMicroUsd: 1_000_000, createdAt: GIFT_AT }]) })
    const view = await mount()
    await until(() => entries(view).length === 1)
    expect(shadow(view).querySelector('img')).toBeNull()
    expect(cell(entries(view)[0]!, '.what')).toContain('<img src=x onerror=alert(1)> sorry')
  })

  it('shows nothing without a reader', async () => {
    const view = document.createElement('mn-credit-history') as CreditHistoryView
    document.body.append(view)
    await view.updateComplete
    expect(shadow(view).querySelector('[data-credit-history]')).toBeNull()
  })
})

describe('on the Billing page after a top-up', () => {
  class MemoryStorage implements PendingCheckoutStorage {
    private readonly values = new Map<string, string>()
    getItem(key: string): string | null { return this.values.get(key) ?? null }
    setItem(key: string, value: string): void { this.values.set(key, value) }
    removeItem(key: string): void { this.values.delete(key) }
  }

  it('the credit that lands refreshes the list, once', async () => {
    gateway.balanceMicroUsd = 3_760
    gateway.history = () => ({ status: 200, body: envelope([topUp]) })
    gateway.onBalanceRead = reads => { if (reads >= 3) gateway.balanceMicroUsd = 5_003_760 }
    const storage = new MemoryStorage()
    rememberPendingCheckout(storage, { kind: 'topup', amountUsd: 5, baselineMicroUsd: 3_760, at: Date.now() })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const mount = mountOrganismAppRoute(host, {
      location: new URL('https://garden.test/settings?settings=billing&checkout=success'),
      settingsService: createDefaultSettingsService({ runtimeMode: 'hosted', billing: new HostedBilling({ userId: () => 'alice', token: () => 'id-token' }, gateway.base, undefined, undefined, { storage }) }),
      replaceUrl: () => undefined,
      checkoutPlanPoll: { intervalMs: 10, attempts: 20 },
      checkoutStorage: storage,
    })!
    await mount.ready
    await until(() => document.body.querySelector('mn-toast[data-checkout-result="credited"]') !== null)
    await until(() => historyRequests().length >= 2)
    const settled = historyRequests().length
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(historyRequests()).toHaveLength(settled)
    expect(settled).toBe(2)

    mount.destroy()
    host.remove()
  })
})
