/**
 * credits-facts.ts — what the backend says about the credits regime, on the balance answer it already gives.
 *
 * PURE. No DOM, no fetch: a plain body in, plain facts out.
 *
 * Vera's decision of 2026-10-03: the service fee, whether the gate refuses, and the day credits start
 * are the BACKEND's to say, not the build's. Choreograph's balance answer carries `feeBps` (basis
 * points: 1500 is 15%, the flip makes it 2000), `gateMode` (`observe`: the gate records and refuses
 * nothing; `enforce`: it refuses) and `creditsStartDate` (absent until it is set). One publish of the
 * SPA then serves the whole run: nothing is rebuilt at the flip.
 *
 * AN OLDER BACKEND SAYS NONE OF IT, and an SPA that cannot read a fact must not guess one: with no fee
 * the fee line is left out, with no start date there is no notice, and with no gate mode "out of
 * credits" is never predicted (see `accountNoteFor`). A fact that is present but unreadable is as good
 * as absent. Nothing here ever returns text the backend sent: a date is shown only as the date it
 * parsed to.
 *
 * The names are read as the backend spells them (camelCase) and in the gateway's snake_case too: the
 * live gateway answers its balance in both spellings.
 */

export type CreditsGateMode = 'observe' | 'enforce'

export interface CreditsFacts {
  /** The service fee as the backend charges it, in basis points (1500 is 15%); null when it does not say. */
  readonly feeBps: number | null
  /** Whether the gate only records (`observe`) or refuses (`enforce`); null when it does not say (an older backend). */
  readonly gateMode: CreditsGateMode | null
  /** The day credits start, as a person reads it ("October 12, 2026"); null while the backend names none. */
  readonly startDate: string | null
}

/** The fee as a share of the price, in percent: 1500 basis points is 15. Null when the backend names no fee. */
export function feePercentOf(facts: { readonly feeBps?: number | null } | null | undefined): number | null {
  const bps = facts?.feeBps
  return typeof bps === 'number' && Number.isFinite(bps) ? bps / 100 : null
}

/** A percent as it prints: whole when whole ("15"), else with the digits it has ("17.5", "19.99"). */
export function formatFeePercent(percent: number): string {
  return Number.isInteger(percent) ? String(percent) : String(Number(percent.toFixed(2)))
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
/** An ISO date and time: the date, a `T` or space, the clock, and an offset or `Z` (or none). */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i
/** The long English form a person might type: "October 12, 2026", "Oct 12 2026". */
const LONG_ENGLISH = /^[A-Za-z]{3,9}\.? \d{1,2},? \d{4}$/
const EPOCH_DIGITS = /^\d{9,13}$/
/** The largest time a Date can hold. */
const MAX_TIME_MS = 8.64e15
/** Below this a number is epoch SECONDS (1e11 ms is 1973; seconds today are about 1.8e9). */
const SECONDS_BELOW = 1e11

function longDate(ms: number, timeZone?: string): string | null {
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_TIME_MS) return null
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', ...(timeZone ? { timeZone } : {}) }).format(new Date(ms))
  } catch {
    return null
  }
}

/**
 * The day credits start, as a person reads it, or null. A calendar date ("2026-10-12") is that day
 * wherever the person is: a date is not an instant. An instant (an ISO date and time, epoch
 * milliseconds or seconds) is the day it is where the person is, unless `timeZone` says otherwise
 * (for tests). The long English form is read as that day. Anything else is not a date.
 */
export function parseCreditsStartDate(value: unknown, options: { readonly timeZone?: string } = {}): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null
    return longDate(value < SECONDS_BELOW ? value * 1000 : value, options.timeZone)
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return null
  const dateOnly = DATE_ONLY.exec(text)
  if (dateOnly) {
    const year = Number(dateOnly[1])
    const month = Number(dateOnly[2])
    const day = Number(dateOnly[3])
    const day0 = new Date(Date.UTC(year, month - 1, day))
    // Date rolls 2026-02-30 over into March: a day that is not on the calendar is not a day.
    if (year < 1 || day0.getUTCFullYear() !== year || day0.getUTCMonth() !== month - 1 || day0.getUTCDate() !== day) return null
    return longDate(day0.getTime(), 'UTC')
  }
  if (EPOCH_DIGITS.test(text)) return parseCreditsStartDate(Number(text), options)
  if (ISO_INSTANT.test(text) || LONG_ENGLISH.test(text)) return longDate(Date.parse(text), options.timeZone)
  return null
}

function pick(row: Record<string, unknown>, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake]
}

/**
 * What a balance answer says of the credits regime, or null when it says none of it (an older
 * backend). Each fact is read on its own: one that cannot be read is null and does not take the others
 * with it.
 */
export function parseCreditsFacts(row: Record<string, unknown>): CreditsFacts | null {
  const rawFee = pick(row, 'feeBps', 'fee_bps')
  const feeBps = typeof rawFee === 'number' && Number.isInteger(rawFee) && rawFee >= 0 && rawFee <= 10_000 ? rawFee : null
  const rawMode = pick(row, 'gateMode', 'gate_mode')
  const gateMode: CreditsGateMode | null = rawMode === 'observe' || rawMode === 'enforce' ? rawMode : null
  const startDate = parseCreditsStartDate(pick(row, 'creditsStartDate', 'credits_start_date'))
  return feeBps === null && gateMode === null && startDate === null ? null : { feeBps, gateMode, startDate }
}
