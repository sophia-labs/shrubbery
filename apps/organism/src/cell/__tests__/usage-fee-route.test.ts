/**
 * The Usage page's note about the service fee states the fee the backend charges (Vera, 2026-10-03):
 * the same number Billing states, from the same balance read, through the real Settings route, the real
 * settings service and HostedBilling over a real loopback gateway. Where the backend names no fee the
 * note is said without one.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import { mountOrganismAppRoute } from '../app-routes.js'
import { HostedBilling } from '../hosted-billing.js'
import { createDefaultSettingsService } from '../settings-service.js'
import type { UsageReader } from '../usage-explorer.js'
import '../usage-explorer-view.js'
import { BillingGateway } from './support/billing-gateway.js'

const gateway = new BillingGateway()
beforeAll(async () => { await gateway.start() })
afterAll(async () => { await gateway.stop() })
beforeEach(() => { gateway.reset() })
afterEach(() => document.body.replaceChildren())

async function until(check: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const reader: UsageReader = { page: async () => ({ items: [], nextCursor: null, coverage: [] }) }

function mountUsage() {
  const billing = new HostedBilling({ userId: () => 'alice', token: () => 'id-token' }, gateway.base, undefined, undefined, { storage: null })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const mount = mountOrganismAppRoute(host, {
    location: new URL('https://garden.test/settings?settings=usage'),
    settingsService: createDefaultSettingsService({ runtimeMode: 'hosted', billing, usageExplorer: reader }),
  })
  return { host, mount: mount!, billing }
}

const note = (host: HTMLElement): string | null =>
  host.querySelector('mn-usage-explorer')?.shadowRoot?.querySelector('[data-usage-note]')?.textContent?.trim() ?? null

describe('the Usage note, through the Settings route', () => {
  it('says the fee the backend charges once Settings has read the balance', async () => {
    gateway.feeBps = 1500
    const { host, mount } = mountUsage()
    await mount.ready
    await until(() => note(host)?.includes('plus a 15% service fee') === true)
    expect(note(host)).toBe(
      "Calls Sophia paid for are deducted from your credits at the cost shown: the model's price plus a 15% service fee. Calls that ran on your own provider key are not deducted. History imported from the earlier service is shown for reference and was not deducted from this balance.",
    )
    mount.destroy()
  })

  it('says 20% when the backend says 20%', async () => {
    gateway.feeBps = 2000
    const { host, mount } = mountUsage()
    await mount.ready
    await until(() => note(host)?.includes('plus a 20% service fee') === true)
    mount.destroy()
  })

  it('says the deduction without a fee where the backend names none', async () => {
    const { host, mount, billing } = mountUsage()
    await mount.ready
    await until(() => gateway.balanceReads > 0 && billing.facts() === null && note(host) !== null)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(note(host)).toBe(
      'Calls Sophia paid for are deducted from your credits at the cost shown. Calls that ran on your own provider key are not deducted. History imported from the earlier service is shown for reference and was not deducted from this balance.',
    )
    mount.destroy()
  })
})
