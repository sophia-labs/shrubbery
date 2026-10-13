/**
 * The notice that credits are starting (`E-billing-enforce.md` 5.6, adapted to Vera's rulings of
 * 2026-09-29 and 2026-10-03). The text lives here as the host's source for the chat kernel's notice
 * slot and for Settings, Billing.
 *
 * Vera, 2026-10-03: the day credits start and the fee are the BACKEND's (the balance answer's
 * `creditsStartDate` and `feeBps`), not the build's. There is no notice until the backend names a date,
 * and no fee sentence where it names no fee: a fact the SPA cannot read is not guessed. What the build
 * still carries is the contact line (default vera@sophia-labs.com) and whether the top-up clause is said.
 */
import { describe, expect, it } from 'vitest'
import {
  CREDITS_NOTICE_TEMPLATE,
  DEFAULT_CREDITS_CONTACT,
  FEE_SENTENCE_TEMPLATE,
  buildCreditsNotice,
  createCreditsNoticeSource,
  creditsNoticeSettingsFromEnv,
  noticeFromFacts,
  type CreditsNoticeConfig,
  type CreditsNoticeStorage,
  type CreditsNoticeView,
} from '../credits-notice.js'

const DATE = 'October 12, 2026'
const facts = (overrides: { feeBps?: number | null; startDate?: string | null; gateMode?: 'observe' | 'enforce' | null } = {}) => ({
  feeBps: overrides.feeBps === undefined ? 1500 : overrides.feeBps,
  gateMode: overrides.gateMode === undefined ? ('observe' as const) : overrides.gateMode,
  startDate: overrides.startDate === undefined ? DATE : overrides.startDate,
})

describe('the words', () => {
  it('reads as E-billing-enforce.md 5.6 with the rulings put in, and the backend’s fee', () => {
    const notice = buildCreditsNotice({ startDate: DATE, feePercent: 15 })!
    expect(notice.title).toBe('Credits start on October 12, 2026.')
    expect(notice.paragraphs).toEqual([
      "Sophia's chat and agents run on AI models that cost real money, so from October 12, 2026 each message uses credits from your balance. You pay the model's price plus a 15% service fee. You will see the balance next to the chat and in Settings, Billing, and each message shows what it cost.",
      'Most messages cost a fraction of a cent to a few cents; conversations that read many documents cost more, and larger voices cost more per message. Every voice shows its price before you pick it.',
      'Your account keeps the balance it already has, and we have topped every account up to at least $1.00. When it reaches zero, chat pauses: your writing and your graphs are never touched. Add credits any time in Settings, Billing, from $5. Credits are prepaid and non-refundable.',
    ])
    expect(notice.id).toBe('credits-start:October 12, 2026')
    expect(notice.text).toBe([notice.title, ...notice.paragraphs].join('\n\n'))
  })

  it('says the fee the backend says: 15% today, 20% after the flip, 17.5% if that is what it charges', () => {
    expect(buildCreditsNotice({ startDate: DATE, feePercent: 15 })!.paragraphs[0]).toContain('a 15% service fee')
    expect(buildCreditsNotice({ startDate: DATE, feePercent: 20 })!.paragraphs[0]).toContain('a 20% service fee')
    expect(buildCreditsNotice({ startDate: DATE, feePercent: 17.5 })!.paragraphs[0]).toContain('a 17.5% service fee')
  })

  it('leaves the fee sentence out, and guesses no number, where the backend names none', () => {
    for (const config of [{ startDate: DATE }, { startDate: DATE, feePercent: null }, { startDate: DATE, feePercent: Number.NaN }, { startDate: DATE, feePercent: -5 }]) {
      const notice = buildCreditsNotice(config)!
      expect(notice.paragraphs[0]).toBe(
        "Sophia's chat and agents run on AI models that cost real money, so from October 12, 2026 each message uses credits from your balance. You will see the balance next to the chat and in Settings, Billing, and each message shows what it cost.",
      )
      expect(notice.text).not.toMatch(/service fee|\d+%/)
    }
  })

  it('does not promise what Vera has not decided: nothing expires (decision 5), nothing is refunded, nothing is free', () => {
    const { text } = buildCreditsNotice({ startDate: DATE, feePercent: 15, contact: DEFAULT_CREDITS_CONTACT })!
    expect(text).not.toMatch(/expire/i)
    expect(text).not.toMatch(/refund(?!able)/i)
    expect(text).not.toMatch(/free/i)
  })

  it('leaves out the top-up sentence when no account was topped up', () => {
    const notice = buildCreditsNotice({ startDate: DATE, starterTopUp: false })!
    expect(notice.paragraphs[2]).toBe(
      'Your account keeps the balance it already has. When it reaches zero, chat pauses: your writing and your graphs are never touched. Add credits any time in Settings, Billing, from $5. Credits are prepaid and non-refundable.',
    )
  })

  it('says where questions go only when it knows', () => {
    expect(buildCreditsNotice({ startDate: DATE })!.paragraphs).toHaveLength(3)
    const withContact = buildCreditsNotice({ startDate: DATE, contact: ' help@example.test ' })!
    expect(withContact.paragraphs).toHaveLength(4)
    expect(withContact.paragraphs[3]).toBe('Questions or problems: help@example.test.')
  })

  it('keeps {date} and {fee} as placeholders in the source, and the fee sentence’s own {markup}', () => {
    expect(CREDITS_NOTICE_TEMPLATE.title).toBe('Credits start on {date}.')
    expect(CREDITS_NOTICE_TEMPLATE.paragraphs[0]).toContain('from {date} each message')
    expect(CREDITS_NOTICE_TEMPLATE.paragraphs[0]).toContain('{fee}')
    expect(FEE_SENTENCE_TEMPLATE).toContain('{markup}%')
    expect(CREDITS_NOTICE_TEMPLATE.paragraphs.join(' ')).toContain('from {min}')
  })
})

const UNFILLED: Array<[string, CreditsNoticeConfig | null | undefined]> = [
  ['no configuration', null],
  ['no configuration at all', undefined],
  ['an empty date', { startDate: '' }],
  ['a blank date', { startDate: '   ' }],
  ['the raw placeholder', { startDate: '{date}' }],
  ['a half-filled date', { startDate: 'October {day}' }],
  ['a half-filled contact', { startDate: DATE, contact: '{contact}' }],
]

describe('no notice until it is filled in', () => {
  it.each(UNFILLED)('shows nothing for %s', (_name, config) => {
    expect(buildCreditsNotice(config)).toBeNull()
  })

  it('never lets a brace through when it does show', () => {
    const { text } = buildCreditsNotice({ startDate: DATE, feePercent: 15, contact: 'help@example.test' })!
    expect(text).not.toMatch(/[{}]/)
  })
})

describe('the notice from what the backend said', () => {
  const settings = { contact: null, starterTopUp: true } as const

  it('is the backend’s date and the backend’s fee', () => {
    const notice = noticeFromFacts(facts({ feeBps: 2000 }), settings)!
    expect(notice.title).toBe('Credits start on October 12, 2026.')
    expect(notice.paragraphs[0]).toContain('a 20% service fee')
    expect(noticeFromFacts(facts({ feeBps: 1500 }), settings)!.paragraphs[0]).toContain('a 15% service fee')
  })

  it('is no notice at all until the backend names a date: absent until it is set', () => {
    expect(noticeFromFacts(null, settings)).toBeNull()
    expect(noticeFromFacts(undefined, settings)).toBeNull()
    expect(noticeFromFacts(facts({ startDate: null }), settings)).toBeNull()
    expect(noticeFromFacts(facts({ startDate: '' }), settings)).toBeNull()
  })

  it('is a notice without a fee sentence from a backend that names a date and no fee', () => {
    const notice = noticeFromFacts(facts({ feeBps: null }), settings)!
    expect(notice.text).not.toMatch(/service fee/)
    expect(notice.title).toBe('Credits start on October 12, 2026.')
  })

  it('does not depend on the gate’s mode: observe, enforce or none, the date is the date', () => {
    for (const gateMode of ['observe', 'enforce', null] as const) {
      expect(noticeFromFacts(facts({ gateMode }), settings)?.title).toBe('Credits start on October 12, 2026.')
    }
  })

  it('names a new date as a new notice, so a person who put the old one away is told again', () => {
    expect(noticeFromFacts(facts({ startDate: 'October 19, 2026' }), settings)!.id).toBe('credits-start:October 19, 2026')
    expect(noticeFromFacts(facts({ startDate: 'October 12, 2026' }), settings)!.id).toBe('credits-start:October 12, 2026')
  })

  it('carries the build’s contact and top-up settings', () => {
    const notice = noticeFromFacts(facts(), { contact: 'help@example.test', starterTopUp: false })!
    expect(notice.paragraphs).toHaveLength(4)
    expect(notice.paragraphs[2]).not.toContain('topped every account up')
    expect(notice.paragraphs[3]).toBe('Questions or problems: help@example.test.')
  })
})

describe('what the build still carries', () => {
  it('the contact line says vera@sophia-labs.com unless the build says otherwise (decision 6)', () => {
    expect(DEFAULT_CREDITS_CONTACT).toBe('vera@sophia-labs.com')
    expect(creditsNoticeSettingsFromEnv(undefined)).toEqual({ contact: 'vera@sophia-labs.com', starterTopUp: true })
    expect(creditsNoticeSettingsFromEnv({})).toEqual({ contact: 'vera@sophia-labs.com', starterTopUp: true })
    const notice = noticeFromFacts(facts(), creditsNoticeSettingsFromEnv({}))!
    expect(notice.paragraphs.at(-1)).toBe('Questions or problems: vera@sophia-labs.com.')
  })

  it('takes another contact from VITE_SHRUBBERY_CREDITS_CONTACT, trimmed, and none when it is set to nothing', () => {
    expect(creditsNoticeSettingsFromEnv({ VITE_SHRUBBERY_CREDITS_CONTACT: ' help@example.test ' }).contact).toBe('help@example.test')
    expect(creditsNoticeSettingsFromEnv({ VITE_SHRUBBERY_CREDITS_CONTACT: '' }).contact).toBeNull()
    expect(creditsNoticeSettingsFromEnv({ VITE_SHRUBBERY_CREDITS_CONTACT: '   ' }).contact).toBeNull()
    expect(creditsNoticeSettingsFromEnv({ VITE_SHRUBBERY_CREDITS_CONTACT: 42 }).contact).toBe('vera@sophia-labs.com')
  })

  it('drops the top-up clause only when VITE_SHRUBBERY_CREDITS_STARTER_TOPUP is "false"', () => {
    expect(creditsNoticeSettingsFromEnv({ VITE_SHRUBBERY_CREDITS_STARTER_TOPUP: 'false' }).starterTopUp).toBe(false)
    expect(creditsNoticeSettingsFromEnv({ VITE_SHRUBBERY_CREDITS_STARTER_TOPUP: 'true' }).starterTopUp).toBe(true)
    expect(creditsNoticeSettingsFromEnv({}).starterTopUp).toBe(true)
  })

  it('no longer carries the date: VITE_SHRUBBERY_CREDITS_START_DATE is gone (one SPA publish, no republish at the flip)', () => {
    const settings = creditsNoticeSettingsFromEnv({ VITE_SHRUBBERY_CREDITS_START_DATE: DATE })
    expect(settings).toEqual(creditsNoticeSettingsFromEnv({}))
    expect(Object.keys(settings).sort()).toEqual(['contact', 'starterTopUp'])
  })
})

class MemoryStorage implements CreditsNoticeStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

class RefusingStorage implements CreditsNoticeStorage {
  getItem(): string | null { throw new DOMException('denied', 'SecurityError') }
  setItem(): void { throw new DOMException('denied', 'QuotaExceededError') }
}

/** The notice as the source builds it from a read of the backend, with the settings the tests fix. */
const built = (found: ReturnType<typeof facts> | null): CreditsNoticeView | null =>
  noticeFromFacts(found, { contact: null, starterTopUp: true })

describe('the source the chat notice slot reads', () => {
  const FACTS = facts()

  it('shows the notice until the person dismisses it, and remembers that', () => {
    const storage = new MemoryStorage()
    const first = createCreditsNoticeSource({ notice: built, storage, userId: () => 'alice' })
    expect(first.current(FACTS)?.title).toBe('Credits start on October 12, 2026.')
    first.dismiss(FACTS)
    expect(first.current(FACTS)).toBeNull()
    // Another visit, same person.
    const later = createCreditsNoticeSource({ notice: built, storage, userId: () => 'alice' })
    expect(later.current(FACTS)).toBeNull()
  })

  it('remembers per person, so a shared browser still tells the next one', () => {
    const storage = new MemoryStorage()
    createCreditsNoticeSource({ notice: built, storage, userId: () => 'alice' }).dismiss(FACTS)
    const bob = createCreditsNoticeSource({ notice: built, storage, userId: () => 'bob' })
    expect(bob.current(FACTS)).not.toBeNull()
  })

  it('shows a notice with new wording (a new date) even to someone who dismissed the old one', () => {
    const storage = new MemoryStorage()
    const source = createCreditsNoticeSource({ notice: built, storage, userId: () => 'alice' })
    source.dismiss(FACTS)
    expect(source.current(FACTS)).toBeNull()
    expect(source.current(facts({ startDate: 'October 19, 2026' }))?.title).toBe('Credits start on October 19, 2026.')
  })

  it('dismisses the notice it was shown under, not whichever one the backend names later', () => {
    const storage = new MemoryStorage()
    const source = createCreditsNoticeSource({ notice: built, storage, userId: () => 'alice' })
    source.dismiss(facts({ startDate: 'October 12, 2026' }))
    expect(source.current(facts({ startDate: 'October 12, 2026' }))).toBeNull()
    expect(source.current(facts({ startDate: 'October 26, 2026' }))).not.toBeNull()
  })

  it('tells its subscribers when it is dismissed, and only until they leave', () => {
    const source = createCreditsNoticeSource({ notice: built, storage: new MemoryStorage(), userId: () => 'alice' })
    let heard = 0
    const stop = source.subscribe(() => { heard += 1 })
    source.dismiss(FACTS)
    expect(heard).toBe(1)
    stop()
    source.dismiss(FACTS)
    expect(heard).toBe(1)
  })

  it('has nothing to show until the backend names a date, and dismissing nothing is harmless', () => {
    const source = createCreditsNoticeSource({ notice: built, storage: new MemoryStorage(), userId: () => 'alice' })
    expect(source.current(null)).toBeNull()
    expect(source.current(facts({ startDate: null }))).toBeNull()
    expect(() => source.dismiss(null)).not.toThrow()
    expect(() => source.dismiss(facts({ startDate: null }))).not.toThrow()
  })

  it('builds its words from the backend’s facts and the build’s settings when it is not told how', () => {
    const source = createCreditsNoticeSource({ storage: new MemoryStorage(), userId: () => 'alice' })
    const view = source.current(facts({ feeBps: 2000 }))!
    expect(view.title).toBe('Credits start on October 12, 2026.')
    expect(view.paragraphs[0]).toContain('a 20% service fee')
    expect(view.paragraphs.at(-1)).toBe('Questions or problems: vera@sophia-labs.com.')
    expect(source.current(null)).toBeNull()
  })

  it('still works, in memory, when storage refuses or is absent', () => {
    for (const storage of [new RefusingStorage(), null]) {
      const source = createCreditsNoticeSource({ notice: built, storage, userId: () => 'alice' })
      expect(source.current(FACTS)).not.toBeNull()
      expect(() => source.dismiss(FACTS)).not.toThrow()
      expect(source.current(FACTS)).toBeNull()
    }
  })

  it('appears when the backend later names the date, with no reload of the source', () => {
    const source = createCreditsNoticeSource({ notice: built, storage: new MemoryStorage(), userId: () => 'alice' })
    expect(source.current(facts({ startDate: null }))).toBeNull()
    expect(source.current(FACTS)?.id).toBe('credits-start:October 12, 2026')
  })
})
