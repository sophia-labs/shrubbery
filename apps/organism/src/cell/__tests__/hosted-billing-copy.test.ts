// @vitest-environment node
/**
 * What Settings, Billing and the usage summary SAY, in the exact words
 * `E-billing-enforce.md` 4.5.5 settled on, read from a real HostedBilling that has
 * read a real gateway-shaped server. The strings are spelled out here on purpose:
 * a test that imported them would pin nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { HostedBilling } from '../hosted-billing.js'
import { BillingGateway } from './support/billing-gateway.js'

const gateway = new BillingGateway()
beforeAll(async () => { await gateway.start() })
afterAll(async () => { await gateway.stop() })
beforeEach(() => { gateway.reset() })

async function loaded(): Promise<HostedBilling> {
  const billing = new HostedBilling({ userId: () => 'alice', token: () => 'id-token' }, gateway.base, undefined, undefined, { storage: null })
  await billing.refresh()
  return billing
}
const billingSection = (billing: HostedBilling) => billing.decorate({ id: 'billing', title: 'Billing', description: 'Plan and subscription controls.' })
const usageSection = (billing: HostedBilling) => billing.decorate({ id: 'usage', title: 'Usage' })
const metric = (billing: HostedBilling, id: string) => billingSection(billing).metrics?.find(row => row.id === id)?.value

describe('Settings, Billing: the balance', () => {
  it('shows the starter credit, not "Not initialized", for an account with no ledger row yet', async () => {
    gateway.initialized = false
    gateway.balanceMicroUsd = 1_000_000
    gateway.lifetimeUsageMicroUsd = 0
    const billing = await loaded()
    expect(metric(billing, 'balance')).toBe('$1.00 starter credit')
    expect(JSON.stringify(billingSection(billing))).not.toContain('Not initialized')
  })

  it('shows an ordinary balance as money', async () => {
    const billing = await loaded()
    expect(metric(billing, 'balance')).toBe('$12.34')
  })

  it('shows Unavailable, never a made-up zero, when the read failed', async () => {
    const billing = new HostedBilling({ userId: () => 'alice', token: () => 'id-token' }, 'http://127.0.0.1:1', undefined, undefined, { storage: null })
    await billing.refresh()
    expect(metric(billing, 'balance')).toBe('Unavailable')
  })
})

describe('Settings, Billing: the portal is hidden until it can work', () => {
  it.each([false, null, undefined])('has no Manage billing action while canManage is %s', async canManage => {
    gateway.canManage = canManage
    const billing = await loaded()
    const view = billingSection(billing)
    expect(view.actions ?? []).toEqual([])
    // Neither the dead button nor its apology is shown.
    const notes = (view.notes ?? []).join(' ')
    expect(notes).not.toMatch(/portal/i)
  })

  it('offers Manage billing, enabled, once the portal can work', async () => {
    gateway.canManage = true
    const billing = await loaded()
    const actions = billingSection(billing).actions ?? []
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ id: 'manage-billing', label: 'Manage billing', disabled: false })
  })

  it('still says why when someone does reach the portal action and there is no portal', async () => {
    gateway.canManage = false
    // The gateway answers 409 when there is no customer to open a portal for.
    gateway.portal = () => ({ status: 409, text: 'private upstream diagnostic' })
    const billing = await loaded()
    await billing.action('manage-billing')
    const view = billingSection(billing)
    const notes = (view.notes ?? []).join(' ')
    expect(notes).toContain('No billing portal is available for this account yet.')
    expect(notes).not.toContain('private upstream')
    expect(view.actions ?? []).toEqual([])
  })

  it('projects the credits panel into the section', async () => {
    const billing = await loaded()
    expect(billingSection(billing).contentSlot).toBe('billing-credits')
  })

  it('describes Billing as credits, not as plan and subscription controls', async () => {
    const billing = await loaded()
    expect(billingSection(billing).description).toBe('Your credit balance and how to add credits.')
  })
})

describe('Settings, Usage summary: the copy no longer contradicts the ledger', () => {
  it('says calls are deducted unless they used your own key, and that history was imported', async () => {
    const billing = await loaded()
    const notes = usageSection(billing).notes ?? []
    expect(notes).toContain(
      'Costs shown here are deducted from your credit balance unless the call used your own provider key. Earlier history was imported and was not deducted from this balance.',
    )
  })

  it('no longer says usage is not a credit deduction', async () => {
    const billing = await loaded()
    const text = (usageSection(billing).notes ?? []).join(' ')
    expect(text).not.toContain('not payment totals')
    expect(text).not.toContain('not the amount deducted from credits')
    expect(text).not.toContain('may be incomplete during migration')
  })

  it('keeps the honest figures and the honest error note', async () => {
    const billing = await loaded()
    expect(usageSection(billing).metrics?.find(row => row.id === 'cost')?.value).toBe('$0.000123')
    const failing = new HostedBilling({ userId: () => 'alice', token: () => 'id-token' }, 'http://127.0.0.1:1', undefined, undefined, { storage: null })
    await failing.refresh()
    expect((usageSection(failing).notes ?? []).join(' ')).toContain('Billing could not be reached')
  })
})
