import { describe, expect, it } from 'vitest'
import {
  TOPUP_DEFAULT_USD,
  TOPUP_MAX_USD,
  TOPUP_MIN_USD,
  TOPUP_PRESETS_USD,
  addCreditsHref,
  checkTopUpUsd,
  parseTopUpAmount,
  stripeCheckoutUrl,
  suggestTopUpUsd,
  topUpPreselectFromUrl,
  topUpRequestBody,
} from '../add-credits.js'

describe('the top-up policy (Vera, 2026-09-29)', () => {
  it('offers $5, $10, $25 and $50, whole dollars, from $5 to $200', () => {
    expect([...TOPUP_PRESETS_USD]).toEqual([5, 10, 25, 50])
    expect(TOPUP_MIN_USD).toBe(5)
    expect(TOPUP_MAX_USD).toBe(200)
    expect(TOPUP_DEFAULT_USD).toBe(10)
  })

  it('accepts the whole dollars in range and nothing else', () => {
    expect(checkTopUpUsd(5)).toEqual({ ok: true, amountUsd: 5 })
    expect(checkTopUpUsd(200)).toEqual({ ok: true, amountUsd: 200 })
    expect(checkTopUpUsd(4)).toMatchObject({ ok: false, reason: 'below-min', message: 'The minimum top-up is $5.' })
    expect(checkTopUpUsd(201)).toMatchObject({ ok: false, reason: 'above-max', message: 'The most you can add at once is $200.' })
    for (const bad of [5.5, 12.99, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(checkTopUpUsd(bad)).toMatchObject({ ok: false, reason: 'not-whole' })
    }
    // A negative or zero amount is an integer below the minimum, not a fraction.
    for (const low of [0, -10]) expect(checkTopUpUsd(low)).toMatchObject({ ok: false, reason: 'below-min' })
  })

  it('reads what a person types, tolerating a dollar sign and spaces', () => {
    expect(parseTopUpAmount('10')).toEqual({ ok: true, amountUsd: 10 })
    expect(parseTopUpAmount('  $25 ')).toEqual({ ok: true, amountUsd: 25 })
    expect(parseTopUpAmount('$ 50')).toEqual({ ok: true, amountUsd: 50 })
    expect(parseTopUpAmount('')).toEqual({ ok: false, reason: 'empty', message: '' })
    expect(parseTopUpAmount('   ')).toEqual({ ok: false, reason: 'empty', message: '' })
    expect(parseTopUpAmount('4')).toMatchObject({ ok: false, reason: 'below-min' })
    expect(parseTopUpAmount('004')).toMatchObject({ ok: false, reason: 'below-min' })
    // Leading zeros are still a whole number of dollars: 007 is 7.
    expect(parseTopUpAmount('007')).toEqual({ ok: true, amountUsd: 7 })
    expect(parseTopUpAmount('201')).toMatchObject({ ok: false, reason: 'above-max' })
    for (const bad of ['12.50', '5.', '.5', '1e2', '-5', '+5', '0x10', 'ten', '10 dollars', '5,00']) {
      expect(parseTopUpAmount(bad)).toEqual({ ok: false, reason: 'not-whole', message: 'Enter a whole-dollar amount.' })
    }
  })
})

describe('the checkout request the live gateway accepts', () => {
  // gateway b75333258e36 `normalize_checkout` accepts {kind:"subscription"},
  // {kind:"topup", amountCents} and {amount_usd} WITHOUT a kind. The brief's
  // {kind:"topup", amount_usd} falls through to 400 invalid_billing_request.
  it('is {kind:"topup", amountCents}, exact integer cents', () => {
    expect(topUpRequestBody(5)).toEqual({ kind: 'topup', amountCents: 500 })
    expect(topUpRequestBody(25)).toEqual({ kind: 'topup', amountCents: 2500 })
    expect(topUpRequestBody(200)).toEqual({ kind: 'topup', amountCents: 20_000 })
  })

  it('never carries amount_usd next to a kind (the gateway refuses that pair)', () => {
    const body = topUpRequestBody(10)
    expect(Object.keys(body).sort()).toEqual(['amountCents', 'kind'])
    expect('amount_usd' in body).toBe(false)
  })

  it('refuses to build a body outside the policy', () => {
    expect(() => topUpRequestBody(4)).toThrow(RangeError)
    expect(() => topUpRequestBody(201)).toThrow(RangeError)
    expect(() => topUpRequestBody(12.5)).toThrow(RangeError)
    expect(() => topUpRequestBody(Number.NaN)).toThrow(RangeError)
  })
})

describe('the Stripe destination', () => {
  it('admits only https://checkout.stripe.com', () => {
    expect(stripeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_live_a1#frag').href)
      .toBe('https://checkout.stripe.com/c/pay/cs_live_a1#frag')
  })

  it.each([
    'http://checkout.stripe.com/c/pay/x',
    'https://checkout.stripe.com.evil.example/c/pay/x',
    'https://evil.example/checkout.stripe.com',
    'https://billing.stripe.com/p/session',
    'https://checkout.stripe.com:8443/c/pay/x',
    'https://user@checkout.stripe.com/c/pay/x',
    'https://user:pass@checkout.stripe.com/c/pay/x',
    'javascript:alert(1)',
    '//checkout.stripe.com/x',
    '',
  ])('refuses %s', value => {
    expect(() => stripeCheckoutUrl(value)).toThrow('Invalid checkout destination.')
  })

  it('refuses a value that is not text', () => {
    for (const value of [undefined, null, 42, {}, ['https://checkout.stripe.com/x']]) {
      expect(() => stripeCheckoutUrl(value)).toThrow('Invalid checkout destination.')
    }
  })
})

describe('the seam the refusal banner uses', () => {
  it('links to Billing, with the amount preselected when it is a valid one', () => {
    expect(addCreditsHref()).toBe('/settings?settings=billing')
    expect(addCreditsHref(null)).toBe('/settings?settings=billing')
    expect(addCreditsHref(10)).toBe('/settings?settings=billing&topup=10')
    expect(addCreditsHref(200)).toBe('/settings?settings=billing&topup=200')
    for (const bad of [3, 3.5, 250, Number.NaN]) expect(addCreditsHref(bad)).toBe('/settings?settings=billing')
  })

  it('reads the preselected amount back from the settings URL', () => {
    expect(topUpPreselectFromUrl(new URL('https://garden.test/settings?settings=billing&topup=25'))).toBe(25)
    expect(topUpPreselectFromUrl(new URL('https://garden.test/settings?settings=billing&topup=7'))).toBe(7)
    expect(topUpPreselectFromUrl(new URL('https://garden.test/settings?settings=billing&topup=3'))).toBeNull()
    expect(topUpPreselectFromUrl(new URL('https://garden.test/settings?settings=billing&topup=abc'))).toBeNull()
    expect(topUpPreselectFromUrl(new URL('https://garden.test/settings?settings=billing'))).toBeNull()
    expect(topUpPreselectFromUrl(new URL(`https://garden.test${addCreditsHref(50)}`))).toBe(50)
  })

  it('suggests the smallest sensible amount that covers the shortfall', () => {
    // A cheap message on an empty balance: the default, not the bare minimum.
    expect(suggestTopUpUsd({ balanceMicroUsd: 30_000, requiredMicroUsd: 93_600 })).toBe(10)
    // Past the default: the next preset that covers it.
    expect(suggestTopUpUsd({ balanceMicroUsd: 0, requiredMicroUsd: 11_000_000 })).toBe(25)
    expect(suggestTopUpUsd({ balanceMicroUsd: 0, requiredMicroUsd: 26_000_000 })).toBe(50)
    // Beyond the presets: whole dollars, capped at the maximum.
    expect(suggestTopUpUsd({ balanceMicroUsd: 0, requiredMicroUsd: 60_000_000 })).toBe(60)
    expect(suggestTopUpUsd({ balanceMicroUsd: 0, requiredMicroUsd: 999_000_000 })).toBe(200)
    // Unknown numbers: the default.
    expect(suggestTopUpUsd({})).toBe(10)
    expect(suggestTopUpUsd({ balanceMicroUsd: null, requiredMicroUsd: 5_000_000 })).toBe(10)
    expect(suggestTopUpUsd({ balanceMicroUsd: 5.5, requiredMicroUsd: 5_000_000 })).toBe(10)
  })
})
