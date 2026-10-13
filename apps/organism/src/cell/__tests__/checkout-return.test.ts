import { afterEach, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import type { MnSettingsPage, MnToast } from '@shrubbery/components'
import { mountOrganismAppRoute } from '../app-routes.js'
import {
  billingPlanSignature,
  checkoutReturnFrom,
  pollPlanAfterCheckout,
  rememberPendingCheckout,
  withoutCheckoutParam,
  type PendingCheckoutStorage,
} from '../checkout-return.js'
import { HostedBilling } from '../hosted-billing.js'
import { createDefaultSettingsService } from '../settings-service.js'

/**
 * A gateway twin speaking the real /billing/* wire. The subscription row
 * flips to the paid plan after `flipAfter` reads — the webhook landing
 * some time after Stripe redirected the browser back.
 */
function billingGateway(flipAfter: number) {
  let subscriptionReads = 0
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input))
    if (url.pathname === '/billing/balance') {
      return Response.json({ userId: 'alice', balanceMicroUsd: 0, lifetimeUsageMicroUsd: 0, initialized: true })
    }
    if (url.pathname === '/billing/subscription') {
      subscriptionReads += 1
      const paid = subscriptionReads > flipAfter
      return Response.json({
        userId: 'alice', tier: paid ? 'pro' : 'free', accountTier: paid ? 'pro' : 'free',
        status: paid ? 'active' : 'none', currentPeriodEnd: null, canManage: paid,
      })
    }
    if (url.pathname === '/billing/usage') {
      return Response.json({ userId: 'alice', totalMicroUsd: 0, eventCount: 0, fromTs: 1, toTs: 2 })
    }
    return new Response('not found', { status: 404 })
  }
  const billing = new HostedBilling({ userId: () => 'alice', token: () => 'id-token' }, 'https://gateway.test', fetcher as typeof fetch)
  return { billing, reads: () => subscriptionReads }
}

/**
 * Credits are what is on sale at launch, so a return with no marker is a top-up.
 * A PLAN return needs the tab to say so, the way a plan checkout would.
 */
function tabThatStartedPlanCheckout(): PendingCheckoutStorage {
  const values = new Map<string, string>()
  const storage: PendingCheckoutStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
  }
  rememberPendingCheckout(storage, { kind: 'plan', amountUsd: null, baselineMicroUsd: null, at: Date.now() })
  return storage
}

async function until(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const settle = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const toast = () => document.body.querySelector<MnToast>('mn-toast[data-checkout-return]')
const tierShown = (host: HTMLElement) => {
  const page = host.querySelector('mn-settings-page') as MnSettingsPage | null
  return page?.sections.find(s => s.id === 'billing')?.metrics?.find(m => m.id === 'tier')?.value
}

afterEach(() => document.body.replaceChildren())

describe('checkout return URL handling', () => {
  it('recognises only the two Stripe outcomes', () => {
    expect(checkoutReturnFrom(new URL('https://g.test/settings?settings=billing&checkout=success'))).toBe('success')
    expect(checkoutReturnFrom(new URL('https://g.test/settings?settings=billing&checkout=cancel'))).toBe('cancel')
    expect(checkoutReturnFrom(new URL('https://g.test/settings?checkout=%20Success%20'))).toBe('success')
    expect(checkoutReturnFrom(new URL('https://g.test/settings?checkout=paid'))).toBeNull()
    expect(checkoutReturnFrom(new URL('https://g.test/settings?settings=billing'))).toBeNull()
  })

  it('drops checkout and keeps every other param and the fragment', () => {
    const cleaned = withoutCheckoutParam(new URL('https://g.test/settings?settings=billing&checkout=success&x=1#usage'))
    expect(cleaned.href).toBe('https://g.test/settings?settings=billing&x=1#usage')
    expect(withoutCheckoutParam(new URL('https://g.test/settings?checkout=cancel')).href).toBe('https://g.test/settings')
  })

  it('reads the plan the Billing section shows', () => {
    expect(billingPlanSignature([])).toBe('')
    expect(billingPlanSignature([{ id: 'billing', title: 'Billing' }])).toBe('')
    expect(billingPlanSignature([{ id: 'billing', title: 'Billing', metrics: [
      { id: 'tier', label: 'Account tier', value: 'pro' },
      { id: 'subscription', label: 'Subscription status', value: 'active' },
    ] }])).toBe('pro|active')
  })

  it('stops polling as soon as the plan changes, and when the route goes away', async () => {
    const plans = ['free|none', 'free|none', 'pro|active', 'pro|active']
    let calls = 0
    const changed = await pollPlanAfterCheckout({
      baseline: 'free|none', intervalMs: 0, attempts: 10, isActive: () => true,
      refresh: async () => plans[calls++]!,
    })
    expect(changed).toBe('changed')
    expect(calls).toBe(3)

    let active = true, stoppedCalls = 0
    const stopped = await pollPlanAfterCheckout({
      baseline: 'free|none', intervalMs: 0, attempts: 10, isActive: () => active,
      refresh: async () => { stoppedCalls += 1; if (stoppedCalls === 2) active = false; return 'free|none' },
    })
    expect(stopped).toBe('stopped')
    expect(stoppedCalls).toBe(2)

    let unchangedCalls = 0
    const unchanged = await pollPlanAfterCheckout({
      baseline: 'free|none', intervalMs: 0, attempts: 3, isActive: () => true,
      refresh: async () => { unchangedCalls += 1; return 'free|none' },
    })
    expect(unchanged).toBe('unchanged')
    expect(unchangedCalls).toBe(3)
  })
})

describe('settings route on a Stripe checkout return', () => {
  it('a plan checkout: toasts, scrubs the URL, and re-reads billing until the paid plan shows', async () => {
    const { billing, reads } = billingGateway(3)
    const replaced: string[] = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    const mount = mountOrganismAppRoute(host, {
      location: new URL('https://garden.test/settings?settings=billing&checkout=success'),
      settingsService: createDefaultSettingsService({ runtimeMode: 'hosted', billing }),
      replaceUrl: url => { replaced.push(url.href) },
      checkoutPlanPoll: { intervalMs: 10, attempts: 20 },
      checkoutStorage: tabThatStartedPlanCheckout(),
    })
    expect(mount?.route).toEqual({ kind: 'settings', sectionId: 'billing' })
    // Scrubbed before anything async: a reload mid-poll must not re-toast.
    expect(replaced).toEqual(['https://garden.test/settings?settings=billing'])
    expect(toast()?.message).toBe('Payment received — your plan is updating')
    expect(toast()?.type).toBe('success')

    await mount!.ready
    await until(() => tierShown(host) === 'pro')
    const readsWhenPaid = reads()
    await settle(100)
    expect(reads()).toBe(readsWhenPaid)
    expect(reads()).toBeLessThanOrEqual(5)
    expect(document.body.querySelectorAll('mn-toast[data-checkout-return]')).toHaveLength(1)

    mount!.destroy()
    host.remove()
  })

  it('cancel: a quiet toast, the URL scrubbed, and no extra billing reads', async () => {
    const { billing, reads } = billingGateway(0)
    const replaced: string[] = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    const mount = mountOrganismAppRoute(host, {
      location: new URL('https://garden.test/settings?settings=billing&checkout=cancel'),
      settingsService: createDefaultSettingsService({ runtimeMode: 'hosted', billing }),
      replaceUrl: url => { replaced.push(url.href) },
      checkoutPlanPoll: { intervalMs: 10, attempts: 20 },
    })
    expect(replaced).toEqual(['https://garden.test/settings?settings=billing'])
    expect(toast()?.message).toBe('Checkout cancelled')
    expect(toast()?.type).toBe('info')
    await mount!.ready
    await settle(100)
    expect(reads()).toBe(1)
    mount!.destroy()
    host.remove()
  })

  it('a plan checkout stops re-reading billing once the route is destroyed', async () => {
    const { billing, reads } = billingGateway(1_000)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const mount = mountOrganismAppRoute(host, {
      location: new URL('https://garden.test/settings?settings=billing&checkout=success'),
      settingsService: createDefaultSettingsService({ runtimeMode: 'hosted', billing }),
      replaceUrl: () => undefined,
      checkoutPlanPoll: { intervalMs: 10, attempts: 1_000 },
      checkoutStorage: tabThatStartedPlanCheckout(),
    })
    await mount!.ready
    await until(() => reads() >= 3)
    mount!.destroy()
    host.remove()
    await settle(30)
    const afterDestroy = reads()
    await settle(100)
    expect(reads()).toBe(afterDestroy)
  })

  it('leaves an ordinary settings URL alone, and scrubs an unknown outcome silently', async () => {
    for (const [href, expected] of [
      ['https://garden.test/settings?settings=billing', []],
      ['https://garden.test/settings?settings=billing&checkout=paid', ['https://garden.test/settings?settings=billing']],
    ] as const) {
      const replaced: string[] = []
      const host = document.createElement('div')
      document.body.appendChild(host)
      const mount = mountOrganismAppRoute(host, {
        location: new URL(href),
        settingsService: createDefaultSettingsService({ runtimeMode: 'hosted', billing: billingGateway(0).billing }),
        replaceUrl: url => { replaced.push(url.href) },
      })
      await mount!.ready
      expect(replaced).toEqual(expected)
      expect(toast()).toBeNull()
      mount!.destroy()
      host.remove()
    }
  })

  it('local runtime: toasts and scrubs, but has no hosted billing to poll', async () => {
    const replaced: string[] = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    const mount = mountOrganismAppRoute(host, {
      location: new URL('https://garden.test/settings?settings=billing&checkout=success'),
      settingsService: createDefaultSettingsService({ runtimeMode: 'local' }),
      replaceUrl: url => { replaced.push(url.href) },
      checkoutPlanPoll: { intervalMs: 10, attempts: 5 },
    })
    await mount!.ready
    await settle(80)
    expect(replaced).toEqual(['https://garden.test/settings?settings=billing'])
    expect(toast()?.message).toBe('Payment received. Your credits are on the way.')
    const page = host.querySelector('mn-settings-page') as MnSettingsPage
    expect(page.status).toBe('ready')
    mount!.destroy()
    host.remove()
  })
})
