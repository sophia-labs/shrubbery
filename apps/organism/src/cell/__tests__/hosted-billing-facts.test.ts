// @vitest-environment node
/**
 * What Settings, Billing knows of the credits regime (Vera, 2026-10-03): the fee, the gate's mode and
 * the day credits start are read off the SAME balance answer Billing already reads (no second request),
 * over a real socket, and are forgotten with the session. An older backend says none of it, and then
 * Billing knows none of it and guesses none.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { HostedBilling } from '../hosted-billing.js'
import { BillingGateway } from './support/billing-gateway.js'

const gateway = new BillingGateway()
beforeAll(async () => { await gateway.start() })
afterAll(async () => { await gateway.stop() })
beforeEach(() => { gateway.reset() })

function billing(auth = { subject: 'alice', token: 'id-token' }): HostedBilling {
  return new HostedBilling(
    { userId: () => auth.subject, token: () => auth.token },
    gateway.base,
    undefined,
    undefined,
    { storage: null },
  )
}

describe('the facts Billing reads off the balance', () => {
  it('knows nothing before the balance is read', () => {
    const subject = billing()
    expect(subject.facts()).toBeNull()
    expect(subject.feePercent()).toBeNull()
    expect(subject.notice()).toBeNull()
  })

  it('reads the fee, the mode and the date off the one balance answer, with no second request', async () => {
    gateway.feeBps = 1500
    gateway.gateMode = 'observe'
    gateway.creditsStartDate = '2026-10-12'
    const subject = billing()
    await subject.refreshBalance()
    expect(gateway.paths()).toEqual(['GET /billing/balance'])
    expect(subject.facts()).toEqual({ feeBps: 1500, gateMode: 'observe', startDate: 'October 12, 2026' })
    expect(subject.feePercent()).toBe(15)
  })

  it('reads them on a full refresh too, the one Settings makes when it opens', async () => {
    gateway.feeBps = 2000
    gateway.gateMode = 'enforce'
    const subject = billing()
    await subject.refresh()
    expect(subject.facts()).toEqual({ feeBps: 2000, gateMode: 'enforce', startDate: null })
    expect(subject.feePercent()).toBe(20)
  })

  it('follows the backend: a later read replaces what the earlier one said', async () => {
    gateway.feeBps = 1500
    gateway.gateMode = 'observe'
    const subject = billing()
    await subject.refreshBalance()
    expect(subject.feePercent()).toBe(15)
    gateway.feeBps = 2000
    gateway.gateMode = 'enforce'
    await subject.refreshBalance()
    expect(subject.feePercent()).toBe(20)
    expect(subject.facts()?.gateMode).toBe('enforce')
  })

  it('knows none of it from an older backend that says none, and a read that failed leaves it knowing none', async () => {
    const subject = billing()
    await subject.refreshBalance()
    expect(subject.facts()).toBeNull()
    expect(subject.feePercent()).toBeNull()
    gateway.balanceStatus = 503
    await subject.refreshBalance()
    expect(subject.facts()).toBeNull()
  })

  it('forgets them with the session: the next person is not told the first person’s regime', async () => {
    gateway.feeBps = 1500
    gateway.creditsStartDate = '2026-10-12'
    const auth = { subject: 'alice', token: 'id-token' }
    const subject = billing(auth)
    await subject.refreshBalance()
    expect(subject.feePercent()).toBe(15)
    auth.subject = 'bob'
    auth.token = 'bobs-token'
    expect(subject.facts()).toBeNull()
    expect(subject.feePercent()).toBeNull()
  })
})
