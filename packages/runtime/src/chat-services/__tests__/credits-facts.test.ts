/**
 * What the backend says about the credits regime on the balance answer it already gives (NO MOCKS, no
 * DOM, no service: pure functions over plain data).
 *
 * Vera's decision of 2026-10-03: the fee, whether the gate refuses, and the day credits start come from
 * the backend, not from the build. Choreograph's balance answer carries `feeBps`, `gateMode`
 * (`observe` | `enforce`) and `creditsStartDate` (absent until it is set). An older backend says none
 * of it, and an SPA that cannot read a fact must not guess one: no fee line, no notice, no refusal
 * prediction.
 */
import { describe, expect, it } from 'vitest'
import { feePercentOf, formatFeePercent, parseCreditsFacts, parseCreditsStartDate } from '../credits-facts.js'

describe('parseCreditsFacts', () => {
  it('reads all three as the backend spells them', () => {
    expect(parseCreditsFacts({ feeBps: 1500, gateMode: 'observe', creditsStartDate: '2026-10-12' })).toEqual({
      feeBps: 1500,
      gateMode: 'observe',
      startDate: 'October 12, 2026',
    })
    expect(parseCreditsFacts({ feeBps: 2000, gateMode: 'enforce' })).toEqual({ feeBps: 2000, gateMode: 'enforce', startDate: null })
  })

  it('reads them in the gateway’s snake_case too (the live gateway answers in both spellings)', () => {
    expect(parseCreditsFacts({ fee_bps: 1500, gate_mode: 'enforce', credits_start_date: '2026-10-12' })).toEqual({
      feeBps: 1500,
      gateMode: 'enforce',
      startDate: 'October 12, 2026',
    })
  })

  it('says nothing when the backend says nothing: an older backend has no facts, and none are made up', () => {
    expect(parseCreditsFacts({})).toBeNull()
    expect(parseCreditsFacts({ balanceMicroUsd: 970_000, initialized: true, can_make_requests: true })).toBeNull()
  })

  it('keeps the facts it can read when it cannot read the others', () => {
    expect(parseCreditsFacts({ feeBps: 'fifteen', gateMode: 'observe' })).toEqual({ feeBps: null, gateMode: 'observe', startDate: null })
    expect(parseCreditsFacts({ feeBps: 1500, gateMode: 'later' })).toEqual({ feeBps: 1500, gateMode: null, startDate: null })
    expect(parseCreditsFacts({ feeBps: 1500, creditsStartDate: 'soonish' })).toEqual({ feeBps: 1500, gateMode: null, startDate: null })
  })

  it('refuses a fee that is not a share of a whole: a fraction of a basis point, a negative, more than 100%', () => {
    for (const bad of [-1, 1500.5, 10_001, Number.NaN, Number.POSITIVE_INFINITY, null, '1500', {}]) {
      expect(parseCreditsFacts({ feeBps: bad, gateMode: 'observe' })?.feeBps).toBeNull()
    }
    expect(parseCreditsFacts({ feeBps: 0, gateMode: 'observe' })?.feeBps).toBe(0)
    expect(parseCreditsFacts({ feeBps: 10_000, gateMode: 'observe' })?.feeBps).toBe(10_000)
  })

  it('takes the gate mode only as the two words it is documented to be', () => {
    for (const bad of ['Enforce', 'ENFORCE', 'enforced', 'on', '', true, 1, null]) {
      expect(parseCreditsFacts({ gateMode: bad, feeBps: 1500 })?.gateMode).toBeNull()
    }
  })
})

describe('parseCreditsStartDate: a day a person can read, or nothing', () => {
  it('reads a calendar date as that day, in every time zone (a date is not an instant)', () => {
    for (const timeZone of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Tokyo']) {
      expect(parseCreditsStartDate('2026-10-12', { timeZone })).toBe('October 12, 2026')
    }
    expect(parseCreditsStartDate('2026-01-01')).toBe('January 1, 2026')
    expect(parseCreditsStartDate('2028-02-29')).toBe('February 29, 2028')
  })

  it('refuses a date that is not on the calendar', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-10-32', '2027-02-29', '0000-00-00']) {
      expect(parseCreditsStartDate(bad)).toBeNull()
    }
  })

  it('reads an instant as the day it is for the person: the same instant is two days in two places', () => {
    const instant = '2026-10-12T03:00:00Z'
    expect(parseCreditsStartDate(instant, { timeZone: 'UTC' })).toBe('October 12, 2026')
    expect(parseCreditsStartDate(instant, { timeZone: 'America/Los_Angeles' })).toBe('October 11, 2026')
    expect(parseCreditsStartDate('2026-10-12T00:00:00-07:00', { timeZone: 'America/Los_Angeles' })).toBe('October 12, 2026')
  })

  it('reads epoch milliseconds and epoch seconds, as a number or as digits', () => {
    const ms = Date.UTC(2026, 9, 12, 12, 0, 0)
    expect(parseCreditsStartDate(ms, { timeZone: 'UTC' })).toBe('October 12, 2026')
    expect(parseCreditsStartDate(ms / 1000, { timeZone: 'UTC' })).toBe('October 12, 2026')
    expect(parseCreditsStartDate(String(ms), { timeZone: 'UTC' })).toBe('October 12, 2026')
  })

  it('reads the long English form a person might have typed into a setting', () => {
    expect(parseCreditsStartDate('October 12, 2026')).toBe('October 12, 2026')
    expect(parseCreditsStartDate('Oct 12 2026')).toBe('October 12, 2026')
  })

  it('shows only a date it understood, never the text it was given', () => {
    for (const hostile of ['<b>October 12</b>', 'October 12, 2026 <script>x</script>', '{date}', '2026-10-12; drop table', 'soon', '12', '1', '', '   ']) {
      expect(parseCreditsStartDate(hostile)).toBeNull()
    }
    for (const notADate of [null, undefined, true, {}, [], Number.NaN, -1, 0, Number.POSITIVE_INFINITY, 9e18]) {
      expect(parseCreditsStartDate(notADate)).toBeNull()
    }
  })
})

describe('the fee as a person reads it', () => {
  it('is basis points divided by a hundred', () => {
    expect(feePercentOf({ feeBps: 1500 })).toBe(15)
    expect(feePercentOf({ feeBps: 2000 })).toBe(20)
    expect(feePercentOf({ feeBps: 1750 })).toBe(17.5)
    expect(feePercentOf({ feeBps: 0 })).toBe(0)
  })

  it('is nothing when the backend names none: the fee line is left out, not guessed', () => {
    expect(feePercentOf(null)).toBeNull()
    expect(feePercentOf(undefined)).toBeNull()
    expect(feePercentOf({ feeBps: null })).toBeNull()
  })

  it('prints a whole percent whole and a fractional one with what it needs', () => {
    expect(formatFeePercent(15)).toBe('15')
    expect(formatFeePercent(20)).toBe('20')
    expect(formatFeePercent(17.5)).toBe('17.5')
    expect(formatFeePercent(19.99)).toBe('19.99')
    expect(formatFeePercent(0)).toBe('0')
  })
})
