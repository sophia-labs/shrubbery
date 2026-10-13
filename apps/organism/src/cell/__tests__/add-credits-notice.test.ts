/**
 * Settings, Billing carries the credits notice ("the same text" as the chat's notice slot,
 * E-billing-enforce.md 4.5.6): there as soon as the BACKEND names the day credits start (the balance
 * answer's `creditsStartDate`, Vera 2026-10-03), never dismissible here (Billing is where the reference
 * lives), and shown as text, never as markup. The fee it states is the backend's `feeBps`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import '../add-credits-view.js'
import type { AddCreditsView } from '../add-credits-view.js'
import { buildCreditsNotice, creditsNoticeSettingsFromEnv, noticeFromFacts, type CreditsNoticeView } from '../credits-notice.js'
import { HostedBilling } from '../hosted-billing.js'
import { BillingGateway } from './support/billing-gateway.js'

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

function billingWith(notice?: () => CreditsNoticeView | null): HostedBilling {
  return new HostedBilling(
    { userId: () => 'alice', token: () => 'id-token' },
    gateway.base,
    undefined,
    undefined,
    { storage: null, ...(notice ? { notice } : {}) },
  )
}

async function mount(billing: HostedBilling): Promise<AddCreditsView> {
  const view = document.createElement('mn-add-credits') as AddCreditsView
  view.port = billing
  document.body.append(view)
  await view.updateComplete
  return view
}

const shadow = (view: AddCreditsView): ShadowRoot => view.shadowRoot!
const aside = (view: AddCreditsView): Element | null => shadow(view).querySelector('[data-credits-notice]')

describe('the notice on Settings, Billing, from what the backend says', () => {
  it('shows the notice, title and paragraphs, once the balance names the day credits start', async () => {
    gateway.creditsStartDate = '2026-10-12'
    gateway.feeBps = 1500
    gateway.gateMode = 'observe'
    const billing = billingWith()
    const view = await mount(billing)
    await billing.refreshBalance()
    await until(() => aside(view) !== null)

    const notice = aside(view)!
    expect(notice.getAttribute('role')).toBe('note')
    expect(notice.querySelector('h4')!.textContent!.trim()).toBe('Credits start on October 12, 2026.')
    const paragraphs = [...notice.querySelectorAll('p')].map(paragraph => paragraph.textContent!.trim())
    expect(paragraphs[0]).toContain('from October 12, 2026 each message')
    expect(paragraphs[0]).toContain('a 15% service fee')
    expect(paragraphs.at(-1)).toBe('Questions or problems: vera@sophia-labs.com.')
  })

  it('states the fee the backend states: 20% after the flip', async () => {
    gateway.creditsStartDate = '2026-10-12'
    gateway.feeBps = 2000
    const billing = billingWith()
    const view = await mount(billing)
    await billing.refreshBalance()
    await until(() => aside(view) !== null)
    expect(aside(view)!.textContent).toContain('a 20% service fee')
    expect(aside(view)!.textContent).not.toContain('15%')
  })

  it('is not dismissible here', async () => {
    gateway.creditsStartDate = '2026-10-12'
    const billing = billingWith()
    const view = await mount(billing)
    await billing.refreshBalance()
    await until(() => aside(view) !== null)
    expect(shadow(view).querySelector('[data-credits-notice] button')).toBeNull()
  })

  it('shows nothing while the backend names no date (absent until it is set), and Add credits is unaffected', async () => {
    gateway.feeBps = 1500
    const billing = billingWith()
    const view = await mount(billing)
    await billing.refreshBalance()
    await view.updateComplete
    expect(aside(view)).toBeNull()
    expect(shadow(view).querySelector('button[data-amount="10"]')).not.toBeNull()
  })

  it('shows nothing from an older backend that says none of it', async () => {
    const billing = billingWith()
    const view = await mount(billing)
    await billing.refreshBalance()
    await view.updateComplete
    expect(aside(view)).toBeNull()
    expect(billing.facts()).toBeNull()
  })

  it('follows the backend as it names the date, without remounting', async () => {
    const billing = billingWith()
    const view = await mount(billing)
    await billing.refreshBalance()
    await view.updateComplete
    expect(aside(view)).toBeNull()

    gateway.creditsStartDate = '2026-10-12'
    await billing.refreshBalance()
    await until(() => aside(view) !== null)

    gateway.creditsStartDate = undefined
    await billing.refreshBalance()
    await until(() => aside(view) === null)
  })

  it('shows no notice, and no markup, for a date it cannot read as one: text the backend sent is never shown', async () => {
    gateway.creditsStartDate = '<b>soon</b> <img src=x onerror=alert(1)>'
    gateway.feeBps = 1500
    const billing = billingWith()
    const view = await mount(billing)
    await billing.refreshBalance()
    await view.updateComplete
    expect(aside(view)).toBeNull()
    expect(shadow(view).querySelector('b, img')).toBeNull()
    expect(shadow(view).textContent).not.toContain('soon')
  })

  it('renders the build’s contact as text, never as markup', async () => {
    const hostile = buildCreditsNotice({ startDate: 'October 12, 2026', contact: '<i>me</i>' })!
    const view = await mount(billingWith(() => hostile))
    const notice = aside(view)!
    expect(notice.querySelector('b, i, img')).toBeNull()
    expect(notice.textContent).toContain('<i>me</i>')
  })
})

describe('where the port gets the notice', () => {
  it('uses the one it was given', () => {
    const notice = buildCreditsNotice({ startDate: 'October 12, 2026' })
    expect(billingWith(() => notice).notice()).toBe(notice)
  })

  it('otherwise builds it from the backend’s facts and the build’s settings, and has none before the balance is read', async () => {
    const billing = billingWith()
    expect(billing.notice()).toBeNull()
    gateway.creditsStartDate = '2026-10-12'
    gateway.feeBps = 1500
    await billing.refreshBalance()
    expect(billing.notice()).toEqual(noticeFromFacts(billing.facts(), creditsNoticeSettingsFromEnv({})))
    expect(billing.notice()?.title).toBe('Credits start on October 12, 2026.')
  })
})
