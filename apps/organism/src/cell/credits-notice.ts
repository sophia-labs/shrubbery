/**
 * The notice that credits are starting: the host's TEXT SOURCE for the chat
 * kernel's notice slot, and the same words for Settings, Billing.
 *
 * The draft is `E-billing-enforce.md` 5.6, with Vera's rulings of 2026-09-29 put
 * in: a $5 minimum, ONE notice (no second reminder), every account below $1.00
 * topped up to $1.00.
 *
 * VERA, 2026-10-03: THE DAY AND THE FEE ARE THE BACKEND'S. The balance answer
 * carries `creditsStartDate` (absent until it is set) and `feeBps` (15% today, 20%
 * after the flip); the notice is built from what the backend says, so there is one
 * SPA publish and nothing is rebuilt at the flip. There is NO notice until the
 * backend names a date, and no fee sentence where it names no fee: a fact the SPA
 * cannot read is not guessed, and a raw brace must never reach a person. What the
 * build still carries is the contact line (`VITE_SHRUBBERY_CREDITS_CONTACT`; unset
 * means vera@sophia-labs.com, set to nothing means no line) and whether the
 * top-up clause is said (`VITE_SHRUBBERY_CREDITS_STARTER_TOPUP=false` drops it).
 *
 * Left out on purpose: that credits do not expire (Vera, 2026-10-03: no), and any
 * promise of refunds. "Non-refundable" is what the Terms already say.
 *
 * How the chat reads it: `createCreditsNoticeSource(...)`; the chat hands
 * `current(facts)` what the backend said on its last balance read, `dismiss(facts)`
 * the same when the person puts it away, and `subscribe(...)` repaints.
 */

import { feePercentOf, formatFeePercent, type CreditsFacts } from '@shrubbery/runtime/chat-services/credits-facts'
import { TOPUP_MIN_USD } from './add-credits.js'
import { STARTER_CREDIT_MICRO_USD, formatMicroUsd } from './billing-copy.js'

/** Where questions go unless the build says otherwise (Vera, 2026-10-03). */
export const DEFAULT_CREDITS_CONTACT = 'vera@sophia-labs.com'

export interface CreditsNoticeConfig {
  /** When credits start, as a person reads it ("October 12, 2026"): the backend's `creditsStartDate`, formatted. */
  readonly startDate: string
  /** The service fee in percent as the backend charges it (15 today); absent leaves the fee sentence out. */
  readonly feePercent?: number | null
  /** Where questions go; the line is left out when this is unset. */
  readonly contact?: string
  /** Say that every account was topped up to the starter credit (Vera's default). Default true. */
  readonly starterTopUp?: boolean
}

export interface CreditsNoticeView {
  /** Names this wording: a new date is a new id, so a person who dismissed the old one is told again. */
  readonly id: string
  readonly title: string
  readonly paragraphs: readonly string[]
  /** The whole notice as plain text, for a slot that takes a string. */
  readonly text: string
}

/** The fee sentence, said only where the backend names a fee. */
export const FEE_SENTENCE_TEMPLATE = " You pay the model's price plus a {markup}% service fee."

/** The source text. Placeholders: {date}, {fee}, {min}, {topup}, {contact}. */
export const CREDITS_NOTICE_TEMPLATE = {
  title: 'Credits start on {date}.',
  paragraphs: [
    "Sophia's chat and agents run on AI models that cost real money, so from {date} each message uses credits from your balance.{fee} You will see the balance next to the chat and in Settings, Billing, and each message shows what it cost.",
    'Most messages cost a fraction of a cent to a few cents; conversations that read many documents cost more, and larger voices cost more per message. Every voice shows its price before you pick it.',
    'Your account keeps the balance it already has{topup}. When it reaches zero, chat pauses: your writing and your graphs are never touched. Add credits any time in Settings, Billing, from {min}. Credits are prepaid and non-refundable.',
  ],
  contact: 'Questions or problems: {contact}.',
} as const

const STARTER_TOP_UP_CLAUSE = `, and we have topped every account up to at least ${formatMicroUsd(STARTER_CREDIT_MICRO_USD)}`

/** Fill every {name}; null if any is left unfilled (values are inserted literally, never re-read). */
function fill(template: string, values: Readonly<Record<string, string>>): string | null {
  const names = [...template.matchAll(/\{([a-zA-Z]+)\}/g)].map(match => match[1] ?? '')
  if (names.some(name => values[name] === undefined)) return null
  return template.replace(/\{([a-zA-Z]+)\}/g, (_placeholder, name: string) => values[name] ?? '')
}

const hasBrace = (text: string): boolean => /[{}]/.test(text)

/** The notice for these facts, or null while the backend has not named a date. */
export function buildCreditsNotice(config: CreditsNoticeConfig | null | undefined): CreditsNoticeView | null {
  if (!config) return null
  const date = config.startDate?.trim() ?? ''
  const contact = config.contact?.trim() ?? ''
  // An empty or half-filled value is not a date or a contact: no notice beats a brace on screen.
  if (!date || hasBrace(date) || hasBrace(contact)) return null
  const fee = config.feePercent
  // A fee the backend did not name, or named as nonsense, is left out: no number is guessed.
  const feeSentence = typeof fee === 'number' && Number.isFinite(fee) && fee >= 0
    ? fill(FEE_SENTENCE_TEMPLATE, { markup: formatFeePercent(fee) }) ?? ''
    : ''
  const values = {
    date,
    fee: feeSentence,
    min: `$${TOPUP_MIN_USD}`,
    topup: config.starterTopUp === false ? '' : STARTER_TOP_UP_CLAUSE,
    contact,
  }
  const title = fill(CREDITS_NOTICE_TEMPLATE.title, values)
  const templates: readonly string[] = [
    ...CREDITS_NOTICE_TEMPLATE.paragraphs,
    ...(contact ? [CREDITS_NOTICE_TEMPLATE.contact] : []),
  ]
  const filled = templates.map(template => fill(template, values))
  const paragraphs = filled.filter((paragraph): paragraph is string => paragraph !== null)
  if (title === null || paragraphs.length !== filled.length) return null
  return { id: `credits-start:${date}`, title, paragraphs, text: [title, ...paragraphs].join('\n\n') }
}

/** What the build still carries of the notice: where questions go, and whether the top-up clause is said. */
export interface CreditsNoticeSettings {
  /** Where questions go; null leaves the line out. */
  readonly contact: string | null
  readonly starterTopUp: boolean
}

/**
 * The build's settings for the notice. The contact is vera@sophia-labs.com unless
 * `VITE_SHRUBBERY_CREDITS_CONTACT` says otherwise (set to nothing: no line); the top-up clause is said
 * unless `VITE_SHRUBBERY_CREDITS_STARTER_TOPUP` is `false`. The DATE is not here: it is the backend's.
 */
export function creditsNoticeSettingsFromEnv(env: Readonly<Record<string, unknown>> | undefined): CreditsNoticeSettings {
  const rawContact = env?.VITE_SHRUBBERY_CREDITS_CONTACT
  const contact = typeof rawContact === 'string' ? rawContact.trim() || null : DEFAULT_CREDITS_CONTACT
  const topUp = env?.VITE_SHRUBBERY_CREDITS_STARTER_TOPUP
  return { contact, starterTopUp: !(typeof topUp === 'string' && topUp.trim() === 'false') }
}

/** The notice for what the backend said on a balance read: none until it names a date, the fee only if it names one. */
export function noticeFromFacts(
  facts: Pick<CreditsFacts, 'feeBps' | 'startDate'> | null | undefined,
  settings: CreditsNoticeSettings,
): CreditsNoticeView | null {
  if (!facts?.startDate) return null
  return buildCreditsNotice({
    startDate: facts.startDate,
    feePercent: feePercentOf(facts),
    ...(settings.contact ? { contact: settings.contact } : {}),
    starterTopUp: settings.starterTopUp,
  })
}

/** The notice this build would show for these facts, with the build's own settings. */
export function defaultCreditsNotice(facts: CreditsFacts | null | undefined): CreditsNoticeView | null {
  return noticeFromFacts(facts, creditsNoticeSettingsFromEnv(import.meta.env as Readonly<Record<string, unknown>> | undefined))
}

export interface CreditsNoticeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface CreditsNoticeSource {
  /** The notice to show now, given what the backend last said: null when there is none, or this person dismissed this wording. */
  current(facts: CreditsFacts | null): CreditsNoticeView | null
  /** Dismiss the notice as it reads under these facts. Harmless when there is none. */
  dismiss(facts: CreditsFacts | null): void
  subscribe(callback: () => void): () => void
}

export interface CreditsNoticeSourceOptions {
  /** Where the words come from, given the backend's facts; default: built from them and the build's settings. */
  readonly notice?: (facts: CreditsFacts | null) => CreditsNoticeView | null
  /** Where dismissal is remembered; default: this browser's local storage; null: in memory only. */
  readonly storage?: CreditsNoticeStorage | null
  /** Whose dismissal it is, so a shared browser still tells the next person. */
  readonly userId?: () => string
}

const DISMISSED_KEY = 'shrubbery.credits-notice.dismissed.v1'

function browserNoticeStorage(): CreditsNoticeStorage | null {
  try {
    const storage = globalThis.localStorage
    return storage && typeof storage.getItem === 'function' ? storage : null
  } catch {
    return null
  }
}

export function createCreditsNoticeSource(options: CreditsNoticeSourceOptions = {}): CreditsNoticeSource {
  const notice = options.notice ?? defaultCreditsNotice
  const storage = options.storage === undefined ? browserNoticeStorage() : options.storage
  const listeners = new Set<() => void>()
  // Dismissals made in this page, whether or not storage took them.
  const dismissedHere = new Set<string>()
  const storageKey = (): string => `${DISMISSED_KEY}:${options.userId?.() ?? ''}`
  const dismissed = (view: CreditsNoticeView): boolean => {
    const key = storageKey()
    if (dismissedHere.has(`${key}|${view.id}`)) return true
    try {
      return storage?.getItem(key) === view.id
    } catch {
      return false
    }
  }
  return {
    current(facts) {
      const view = notice(facts)
      return view && !dismissed(view) ? view : null
    },
    dismiss(facts) {
      const view = notice(facts)
      if (!view) return
      const key = storageKey()
      dismissedHere.add(`${key}|${view.id}`)
      try {
        storage?.setItem(key, view.id)
      } catch {
        // Private windows and blocked site data refuse; the dismissal then lasts this page.
      }
      for (const listener of listeners) listener()
    },
    subscribe(callback) {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
  }
}
