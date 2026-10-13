/**
 * `<mn-add-credits>` in a real DOM, wired to a real HostedBilling that talks to
 * a real loopback server. The click that matters (an amount, then Add credits)
 * must reach the gateway as the closed top-up body and end in a Stripe URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import '../add-credits-view.js'
import type { AddCreditsView } from '../add-credits-view.js'
import { HostedBilling } from '../hosted-billing.js'
import { BillingGateway, DEFAULT_CHECKOUT_URL } from './support/billing-gateway.js'

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

async function mount(preselect: number | null = null) {
  const navigated: string[] = []
  const billing = new HostedBilling(
    { userId: () => 'alice', token: () => 'id-token' },
    gateway.base,
    undefined,
    url => { navigated.push(url) },
    { storage: null },
  )
  const view = document.createElement('mn-add-credits') as AddCreditsView
  view.port = billing
  view.preselect = preselect
  document.body.append(view)
  await view.updateComplete
  return { view, billing, navigated }
}

const shadow = (view: AddCreditsView): ShadowRoot => view.shadowRoot!
const preset = (view: AddCreditsView, amount: number): HTMLButtonElement =>
  shadow(view).querySelector<HTMLButtonElement>(`button[data-amount="${amount}"]`)!
const custom = (view: AddCreditsView): HTMLInputElement =>
  shadow(view).querySelector<HTMLInputElement>('input[data-custom-amount]')!
const submit = (view: AddCreditsView): HTMLButtonElement =>
  shadow(view).querySelector<HTMLButtonElement>('button[data-add-credits-submit]')!
const amountError = (view: AddCreditsView): string | null =>
  shadow(view).querySelector('[data-amount-error]')?.textContent?.trim() ?? null
const checkoutError = (view: AddCreditsView): string | null =>
  shadow(view).querySelector('[data-checkout-error]')?.textContent?.trim() ?? null
const label = (button: HTMLButtonElement): string => button.textContent!.trim()

async function type(view: AddCreditsView, text: string): Promise<void> {
  const input = custom(view)
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await view.updateComplete
}
async function choose(view: AddCreditsView, amount: number): Promise<void> {
  preset(view, amount).click()
  await view.updateComplete
}

describe('Add credits (the Billing panel)', () => {
  it('offers $5, $10, $25 and $50 and a custom amount, with nothing chosen yet', async () => {
    const { view } = await mount()
    const presets = [...shadow(view).querySelectorAll<HTMLButtonElement>('button[data-amount]')]
    expect(presets.map(button => button.dataset.amount)).toEqual(['5', '10', '25', '50'])
    expect(presets.map(label)).toEqual(['$5', '$10', '$25', '$50'])
    expect(presets.every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true)
    expect(custom(view)).not.toBeNull()
    expect(submit(view).disabled).toBe(true)
    expect(label(submit(view))).toBe('Add credits')
    expect(amountError(view)).toBeNull()
  })

  it('names its controls for assistive technology', async () => {
    const { view } = await mount()
    expect(shadow(view).querySelector('[role="group"][aria-label="Amount"]')).not.toBeNull()
    expect(custom(view).getAttribute('aria-label')).toBe('Other amount in dollars')
  })

  it('arms the button with the chosen preset', async () => {
    const { view } = await mount()
    await choose(view, 25)
    expect(preset(view, 25).getAttribute('aria-pressed')).toBe('true')
    expect(preset(view, 10).getAttribute('aria-pressed')).toBe('false')
    expect(submit(view).disabled).toBe(false)
    expect(label(submit(view))).toBe('Add $25 in credits')
  })

  it('sends the chosen amount to the gateway and hands the browser to Stripe', async () => {
    const { view, navigated } = await mount()
    await choose(view, 25)
    submit(view).click()
    await until(() => navigated.length === 1)
    const posts = gateway.requests.filter(request => request.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0]!.path).toBe('/billing/checkout')
    expect(posts[0]!.body).toEqual({ kind: 'topup', amountCents: 2500 })
    expect(navigated).toEqual([DEFAULT_CHECKOUT_URL])
  })

  it('takes a custom whole-dollar amount', async () => {
    const { view, navigated } = await mount()
    await type(view, '7')
    expect(amountError(view)).toBeNull()
    expect(submit(view).disabled).toBe(false)
    expect(label(submit(view))).toBe('Add $7 in credits')
    submit(view).click()
    await until(() => navigated.length === 1)
    expect(gateway.requests.find(request => request.method === 'POST')!.body).toEqual({ kind: 'topup', amountCents: 700 })
  })

  it('says why it will not send an amount, and keeps the button off', async () => {
    const { view } = await mount()
    await type(view, '4')
    expect(amountError(view)).toBe('The minimum top-up is $5.')
    expect(submit(view).disabled).toBe(true)
    await type(view, '201')
    expect(amountError(view)).toBe('The most you can add at once is $200.')
    expect(submit(view).disabled).toBe(true)
    await type(view, '12.5')
    expect(amountError(view)).toBe('Enter a whole-dollar amount.')
    expect(submit(view).disabled).toBe(true)
    await type(view, '')
    expect(amountError(view)).toBeNull()
    expect(submit(view).disabled).toBe(true)
    expect(gateway.requests).toHaveLength(0)
  })

  it('lets a typed amount replace a preset, and a preset replace a typed amount', async () => {
    const { view } = await mount()
    await choose(view, 10)
    await type(view, '7')
    expect(preset(view, 10).getAttribute('aria-pressed')).toBe('false')
    expect(label(submit(view))).toBe('Add $7 in credits')
    await choose(view, 25)
    expect(custom(view).value).toBe('')
    expect(preset(view, 25).getAttribute('aria-pressed')).toBe('true')
    expect(label(submit(view))).toBe('Add $25 in credits')
  })

  it('opens with the amount the refusal banner suggested', async () => {
    const preset50 = await mount(50)
    expect(preset(preset50.view, 50).getAttribute('aria-pressed')).toBe('true')
    expect(label(submit(preset50.view))).toBe('Add $50 in credits')
    expect(custom(preset50.view).value).toBe('')
    document.body.replaceChildren()

    const typed = await mount(7)
    expect(custom(typed.view).value).toBe('7')
    expect(label(submit(typed.view))).toBe('Add $7 in credits')
    document.body.replaceChildren()

    const outOfPolicy = await mount(3)
    expect(submit(outOfPolicy.view).disabled).toBe(true)
    expect(custom(outOfPolicy.view).value).toBe('')
  })

  it('shows what went wrong in plain words, then lets the person try again', async () => {
    gateway.checkout = () => ({ status: 502, text: 'private upstream diagnostic' })
    const { view, navigated } = await mount()
    await choose(view, 10)
    submit(view).click()
    await until(() => checkoutError(view) !== null)
    expect(checkoutError(view)).toBe('Checkout could not be started. Try again.')
    expect(shadow(view).textContent).not.toContain('private upstream')
    expect(shadow(view).querySelector('[data-checkout-error]')!.getAttribute('role')).toBe('alert')
    expect(submit(view).disabled).toBe(false)
    expect(navigated).toEqual([])

    gateway.checkout = undefined
    submit(view).click()
    await until(() => navigated.length === 1)
    await until(() => checkoutError(view) === null)
  })

  it('says the service fee out loud, the fee the backend charges: 15% today', async () => {
    gateway.feeBps = 1500
    const { view, billing } = await mount()
    await billing.refreshBalance()
    await until(() => shadow(view).querySelector('[data-fee-note]')?.textContent?.includes('15% service fee') === true)
    expect(shadow(view).querySelector('[data-fee-note]')!.textContent!.trim())
      .toBe("You pay the model's price plus a 15% service fee. Credits are prepaid and non-refundable.")
  })

  it('says 20% once the backend says 20%, with no rebuild and no reload: the number is the backend’s', async () => {
    gateway.feeBps = 1500
    const { view, billing } = await mount()
    await billing.refreshBalance()
    await until(() => shadow(view).textContent!.includes('15% service fee'))
    gateway.feeBps = 2000
    await billing.refreshBalance()
    await until(() => shadow(view).textContent!.includes('20% service fee'))
    expect(shadow(view).textContent).not.toContain('15% service fee')
  })

  it('leaves the fee out, and guesses none, until the backend names it, and from an older backend that never does', async () => {
    const { view, billing } = await mount()
    // Before the balance is read, and after a read that names no fee: the same words, without a number.
    expect(shadow(view).querySelector('[data-fee-note]')!.textContent!.trim()).toBe('Credits are prepaid and non-refundable.')
    await billing.refreshBalance()
    await view.updateComplete
    expect(shadow(view).querySelector('[data-fee-note]')!.textContent!.trim()).toBe('Credits are prepaid and non-refundable.')
    expect(shadow(view).textContent).not.toMatch(/service fee|\d+%/)
  })

  it('does not take a fee that is not whole basis points for one: a nonsense number is no number', async () => {
    gateway.feeBps = 1500.5
    const { view, billing } = await mount()
    await billing.refreshBalance()
    await view.updateComplete
    expect(shadow(view).textContent).not.toMatch(/service fee|\d+%/)
  })

  it('shows nothing when the account has no billing transport', async () => {
    const view = document.createElement('mn-add-credits') as AddCreditsView
    document.body.append(view)
    await view.updateComplete
    expect(shadow(view).querySelector('button[data-amount]')).toBeNull()
  })
})
