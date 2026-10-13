import { describe, expect, it, vi } from 'vitest'
import { HostedBilling } from '../hosted-billing.js'
import { createDefaultSettingsService } from '../settings-service.js'

const balance = { userId: 'alice', balanceMicroUsd: 12_340_000, lifetimeUsageMicroUsd: 1_234, initialized: true }
const subscription = { userId: 'alice', tier: 'free', accountTier: 'pro', status: 'none', currentPeriodEnd: null, canManage: true }
const usage = { userId: 'alice', totalMicroUsd: 123, eventCount: 1, fromTs: 1, toTs: 2, lifetime_usage_usd: null }
function fixture(handler?: (url: string) => Response | Promise<Response>) {
  let subject = 'alice'
  const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input)
    return handler ? handler(url) : Response.json(url.includes('/balance') ? balance : url.includes('/subscription') ? subscription : usage)
  })
  const navigate = vi.fn()
  const billing = new HostedBilling({ userId: () => subject, token: () => 'id-token' }, 'https://gateway.example', fetcher as typeof fetch, navigate)
  const service = createDefaultSettingsService({ runtimeMode: 'hosted', billing })
  return { billing, service, fetcher, navigate, switchUser: () => { subject = 'bob' } }
}
const section = (snapshot: Awaited<ReturnType<ReturnType<typeof createDefaultSettingsService>['load']>>, id: string) => snapshot.sections.find(s => s.id === id)!

describe('hosted billing settings through account transport', () => {
  it.each([false, undefined, null])('hides an unavailable or unverified portal instead of showing a dead button (%s)', async canManage => {
    const { billing } = fixture(url => Response.json(url.includes('/balance') ? balance : url.includes('/subscription') ? { ...subscription, canManage } : usage))
    await billing.refresh()
    const view = billing.decorate({ id: 'billing', title: 'Billing' })
    expect(view.actions ?? []).toEqual([])
    expect(view.notes?.join(' ') ?? '').not.toMatch(/portal/i)
  })
  it('explains a missing customer without exposing the upstream response', async () => {
    const { billing, navigate } = fixture(() => new Response('private upstream diagnostic', { status: 409 }))
    await billing.action('manage-billing')
    const notes = billing.decorate({ id: 'billing', title: 'Billing' }).notes?.join(' ')
    expect(notes).toContain('No billing portal is available for this account yet.')
    expect(notes).not.toContain('private upstream')
    expect(navigate).not.toHaveBeenCalled()
  })
  it('uses the browser receiver for default fetch on account reads and portal actions', async () => {
    // Native Window.fetch rejects an arbitrary receiver. Arrow-function mocks
    // otherwise hide a failure that happens before any HTTP request is sent.
    const fetcher = vi.fn(async function (this: unknown, input: RequestInfo | URL) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      const url = String(input)
      return Response.json(url.endsWith('/portal') ? { url: 'https://billing.stripe.com/p/session' }
        : url.includes('/balance') ? balance : url.includes('/subscription') ? subscription : usage)
    })
    vi.stubGlobal('fetch', fetcher)
    try {
      const navigate = vi.fn()
      const billing = new HostedBilling({ userId: () => 'alice', token: () => 'id-token' },
        'https://gateway.example', undefined, navigate)
      const service = createDefaultSettingsService({ runtimeMode: 'hosted', billing })
      await billing.refresh()
      const result = await service.load()
      expect(section(result, 'billing').metrics).toContainEqual(expect.objectContaining({ id: 'balance', value: '$12.34' }))
      expect(section(result, 'usage').metrics).toContainEqual(expect.objectContaining({ id: 'cost', value: '$0.000123' }))
      expect(section(result, 'usage').notes?.join(' ')).not.toContain('could not be reached')
      expect(fetcher).toHaveBeenCalledTimes(3)
      expect(navigate).not.toHaveBeenCalled()
      await service.action({ sectionId: 'billing', actionId: 'manage-billing' })
      expect(fetcher).toHaveBeenCalledTimes(4)
      expect(navigate).toHaveBeenCalledWith('https://billing.stripe.com/p/session')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reads account endpoints with bearer and projects micro-USD without inventing payment totals', async () => {
    const { billing, service, fetcher, navigate } = fixture()
    await billing.refresh()
    const result = await service.load()
    expect(section(result, 'billing').metrics).toContainEqual(expect.objectContaining({ id: 'balance', value: '$12.34' }))
    expect(section(result, 'billing').metrics).toContainEqual(expect.objectContaining({ id: 'tier', value: 'pro' }))
    expect(section(result, 'billing').metrics).toContainEqual(expect.objectContaining({ id: 'subscription', value: 'No subscription' }))
    expect(section(result, 'usage').metrics).toContainEqual(expect.objectContaining({ id: 'lifetime', value: '$0.001234' }))
    expect(section(result, 'usage').metrics).toContainEqual(expect.objectContaining({ id: 'cost', value: '$0.000123' }))
    expect(section(result, 'billing').actions?.[0].disabled).toBe(false)
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['https://gateway.example/billing/balance', 'https://gateway.example/billing/subscription', 'https://gateway.example/billing/usage?days=30'])
    expect(fetcher.mock.calls.every(call => call[1]?.headers && (call[1].headers as Record<string,string>).Authorization === 'Bearer id-token' && call[1].cache === 'no-store' && call[1].credentials === 'omit' && call[1].redirect === 'error')).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
  })
  it.each([undefined, 'unknown', { tier: 'pro' }])('does not substitute Stripe tier when account entitlement is unavailable (%s)', async accountTier => {
    const { billing } = fixture(url => Response.json(url.includes('/subscription') ? { ...subscription, tier: 'pro', accountTier } : url.includes('/balance') ? balance : usage))
    await billing.refresh()
    const metrics = billing.decorate({ id: 'billing', title: 'Billing' }).metrics
    expect(metrics).toContainEqual(expect.objectContaining({ id: 'tier', value: 'Unavailable' }))
    expect(metrics).toContainEqual(expect.objectContaining({ id: 'subscription', value: 'No subscription' }))
  })
  it('surfaces 502 without exposing upstream text or showing zero, then refreshes successfully', async () => {
    let failing = true
    const { billing, service } = fixture(url => failing ? new Response('secret internal detail', { status: 502 }) : Response.json(url.includes('/balance') ? balance : url.includes('/subscription') ? subscription : { ...usage, totalMicroUsd: 0, eventCount: 0 }))
    await billing.refresh()
    let result = await service.load()
    expect(section(result, 'billing').notes?.join(' ')).toContain('temporarily unavailable')
    expect(JSON.stringify(result)).not.toContain('secret internal detail')
    expect(section(result, 'usage').metrics?.[0].value).toBe('Unavailable')
    failing = false
    await service.action({ sectionId: 'usage', actionId: 'refresh-usage' })
    result = await service.load()
    expect(section(result, 'usage').notes).toContain('No usage events recorded in this period.')
    expect(section(result, 'usage').metrics?.[0].value).toBe('$0.00')
  })
  it('keeps local mode free of hosted calls and billing sections', async () => {
    const { billing, fetcher } = fixture()
    const service = createDefaultSettingsService({ runtimeMode: 'local', billing })
    expect((await service.load()).sections.some(s => s.id === 'billing' || s.id === 'usage')).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
    await expect(service.action({ sectionId: 'billing', actionId: 'manage-billing' })).rejects.toThrow('unavailable')
  })
  it('posts an empty portal request only on explicit action and validates the redirect', async () => {
    const { service, fetcher, navigate } = fixture(() => Response.json({ url: 'https://billing.stripe.com/p/session' }))
    expect(fetcher).not.toHaveBeenCalled()
    await service.action({ sectionId: 'billing', actionId: 'manage-billing' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('https://gateway.example/billing/portal')
    expect(fetcher.mock.calls[0][1]?.method).toBe('POST')
    expect(fetcher.mock.calls[0][1]?.body).toBeUndefined()
    expect(navigate).toHaveBeenCalledWith('https://billing.stripe.com/p/session')
  })
  it.each([new Response('private', { status: 502 }), Response.json({ url: 'https://evil.example/steal' }), Response.json({ url: 'javascript:alert(1)' })])('keeps portal failures visible and does not navigate', async response => {
    const { billing, service, navigate } = fixture(() => response.clone())
    await service.action({ sectionId: 'billing', actionId: 'manage-billing' })
    expect(billing.decorate({ id: 'billing', title: 'Billing' }).notes?.join(' ')).toContain('could not be opened')
    expect(navigate).not.toHaveBeenCalled()
  })
  it('shows loading, suppresses duplicate requests, and discards old-account responses', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const { billing, fetcher, switchUser } = fixture(async url => { await gate; return Response.json(url.includes('/balance') ? balance : url.includes('/subscription') ? subscription : usage) })
    const first = billing.refresh()
    await Promise.resolve()
    expect(billing.decorate({ id: 'usage', title: 'Usage' }).actions?.[0]).toMatchObject({ label: 'Refreshing…', disabled: true })
    const second = billing.refresh()
    switchUser(); release()
    await Promise.all([first, second])
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(billing.decorate({ id: 'billing', title: 'Billing' }).metrics?.[0].value).toBe('Unavailable')
  })
  it('rejects malformed money rather than rounding unsafe ledger integers', async () => {
    const { billing } = fixture(() => Response.json({ ...balance, balanceMicroUsd: Number.MAX_SAFE_INTEGER + 1 }))
    await billing.refresh()
    expect(billing.decorate({ id: 'billing', title: 'Billing' }).metrics?.[0].value).toBe('Unavailable')
  })
})
