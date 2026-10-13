/**
 * chat-billing.ts — the words and the arithmetic of credits in the chat.
 *
 * PURE. No DOM, no fetch, no store: plain data in, plain data out, so every sentence a
 * person reads about money, and every number behind it, can be tested without a panel
 * or a host. The kernel computes no money; it is handed the results of these functions
 * (a note, a notice, a multiple, a flag) and renders them.
 *
 * WHERE THE NUMBERS COME FROM. The billing design (`E-billing-enforce.md`):
 *   - minimum admit (4.1): the cost of the smallest viable call, 15,000 tokens in and 256
 *     out on the voice's rates, never under 1,000 µUSD. The gate refuses a call the balance
 *     cannot pay for at that size, so this is the number the balance line measures "out" against.
 *   - a short reply (4.6): 2,500 tokens in, 300 out. The multiple of House and the
 *     premium line (above $0.05) are measured on it.
 *   - low (4.5.1): at or below $0.25.
 *   - the service fee: Vera's ruling of 2026-09-29, 20%. CONFIRMED by the Choreograph return
 *     (`C-choreograph-return.md` 1.7): every price the catalogue lists is what the PERSON PAYS,
 *     the provider's price and the fee in one number, rounded up to a micro-dollar. So the
 *     numbers below are computed from those prices as they stand and add no fee: a second 20%
 *     on top made the balance line and the premium note 20% dearer than any call is billed.
 *     The fee is named only in the picker's footnote, from the catalogue's own `markupPercent`.
 *
 * HONESTY RULES. An amount is cut down, never rounded up, wherever it says what a person
 * has or what they need at the least ($0.995440 is $0.99, not a dollar in hand); a balance
 * that could not be read is "unavailable", never $0; a refusal for credit is the only thing
 * that may borrow the out-of-credits banner.
 */

import type {
  ChatAccountNote,
  ChatComposerNotice,
  ChatMessage,
  ChatModelOption,
} from '@shrubbery/chat-kernel'
import { formatVoiceMultiple } from '@shrubbery/chat-kernel'
import type { ChatBalance, ChatBillingDetail } from './chat-service.js'
import type { CreditsFacts } from './credits-facts.js'

// ── the constants ──

/**
 * Vera's ruling (2026-09-29): a 20% markup on the model's price. Already IN every listed price;
 * the number is only what the picker's footnote says when the catalogue names no fee itself.
 */
export const SERVICE_FEE_PERCENT = 20
/** At or below this the balance line says "Running low" ($0.25). */
export const LOW_BALANCE_MICRO_USD = 250_000
/** No call is cheaper than this to admit, whatever the voice. */
export const MIN_ADMIT_FLOOR_MICRO_USD = 1_000
/** A short reply dearer than this ($0.05) marks a premium voice. */
export const PREMIUM_SHORT_TURN_MICRO_USD = 50_000

const MIN_ADMIT_INPUT_TOKENS = 15_000
const MIN_ADMIT_OUTPUT_TOKENS = 256
const SHORT_TURN_INPUT_TOKENS = 2_500
const SHORT_TURN_OUTPUT_TOKENS = 300

/** The action ids the host routes. Kernel-side they are opaque strings. */
export const ADD_CREDITS_ACTION = 'add-credits'
export const NEW_CHAT_ACTION = 'new-chat'
export const BILLING_NOTICE_ID = 'billing-refusal'
export const BUDGET_NOTICE_ID = 'budget-exhausted'
/** The heads-up that credits are starting: its slot id, and the two controls it carries. */
export const CREDITS_NOTICE_ID = 'credits-notice'
export const CREDITS_NOTICE_DETAILS_ACTION = 'credits-notice-details'
export const CREDITS_NOTICE_DISMISS_ACTION = 'dismiss-credits-notice'

// ── money, as it is worded ──

/**
 * What an account holds, cut down to the cent from a cent up and to four decimals under
 * one, so a small balance is not mistaken for none. Zero, and anything below, is `$0.00`.
 */
export function formatCredit(microUsd: number): string {
  if (!Number.isFinite(microUsd) || microUsd <= 0) return '$0.00'
  if (microUsd < 100) return '<$0.0001'
  if (microUsd < 10_000) return `$${(Math.floor(microUsd / 100) / 10_000).toFixed(4)}`
  return `$${(Math.floor(microUsd / 10_000) / 100).toFixed(2)}`
}

/**
 * What one reply settled at, for the chip beside it: four decimals under ten cents,
 * cents from there. Null for no cost (an unmetered or free call has nothing to show, and
 * `$0.0000` would claim a measurement).
 */
export function formatCost(microUsd: number): string | null {
  if (!Number.isFinite(microUsd) || microUsd <= 0) return null
  if (microUsd < 50) return '<$0.0001'
  if (microUsd < 100_000) return `$${(microUsd / 1_000_000).toFixed(4)}`
  return `$${(microUsd / 1_000_000).toFixed(2)}`
}

/** The host's per-message annotation for the kernel: the settled cost of a finished reply. */
export function costAnnotation(message: ChatMessage): string | null {
  if (message.role !== 'assistant' || message.isStreaming || message.origin === 'window') return null
  return message.costMicroUsd === undefined ? null : formatCost(message.costMicroUsd)
}

// ── what a voice costs ──

type Priced = Pick<ChatModelOption, 'priceInPerMTok' | 'priceOutPerMTok'>

/** A voice's rates as the person pays them, USD per million tokens (which is µUSD per token); null unless BOTH are known. */
function ratesOf(voice: Priced | null | undefined): { readonly input: number; readonly output: number } | null {
  if (!voice) return null
  const input = voice.priceInPerMTok
  const output = voice.priceOutPerMTok
  if (typeof input !== 'number' || typeof output !== 'number') return null
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null
  return { input, output }
}

/** A cost in whole micro-dollars, rounded up once. The float dust of a price times a token count is shaken off first. */
function roundUp(microUsd: number): number {
  return Math.ceil(Number(microUsd.toFixed(6)))
}

function shortTurnCost(rates: { readonly input: number; readonly output: number }): number {
  return SHORT_TURN_INPUT_TOKENS * rates.input + SHORT_TURN_OUTPUT_TOKENS * rates.output
}

/** What the gate needs the balance to hold to take one call in this voice (at the prices the person pays); null when the voice is not priced. */
export function minAdmitMicroUsd(voice: Priced | null | undefined): number | null {
  const rates = ratesOf(voice)
  if (!rates) return null
  return Math.max(
    MIN_ADMIT_FLOOR_MICRO_USD,
    roundUp(MIN_ADMIT_INPUT_TOKENS * rates.input + MIN_ADMIT_OUTPUT_TOKENS * rates.output),
  )
}

/** What a short reply in this voice costs, at the prices the person pays; null when the voice is not priced. */
export function shortTurnMicroUsd(voice: Priced | null | undefined): number | null {
  const rates = ratesOf(voice)
  return rates ? roundUp(shortTurnCost(rates)) : null
}

/** How many times House's short reply this voice's costs; null when either is not priced. */
export function multipleOfHouse(voice: Priced | null | undefined, house: Priced | null | undefined): number | null {
  const own = ratesOf(voice)
  const base = ratesOf(house)
  if (!own || !base) return null
  const measure = shortTurnCost(base)
  return measure > 0 ? shortTurnCost(own) / measure : null
}

function premiumNoteFor(shortTurn: number, multiple: number | null): string {
  const cost = formatCost(shortTurn)
  const times = formatVoiceMultiple(multiple)
  return times
    ? `A short reply costs about ${cost}, roughly ${times}.`
    : `A short reply costs about ${cost}.`
}

/**
 * The roster as the picker is told it: every priced voice but House with its multiple
 * of House, and a premium one flagged with the line its confirmation shows. House is the
 * measure and is left as it was. A voice the catalogue did not price is left alone: no
 * multiple is invented for it. The roster it was given is not changed.
 */
export function annotateVoices(roster: readonly ChatModelOption[]): ChatModelOption[] {
  const house = roster.find(model => model.house)
  return roster.map(model => {
    const shortTurn = shortTurnMicroUsd(model)
    if (shortTurn === null || model.house) return model
    const multiple = multipleOfHouse(model, house)
    const premium = shortTurn > PREMIUM_SHORT_TURN_MICRO_USD
    if (multiple === null && !premium) return model
    return {
      ...model,
      ...(multiple !== null ? { multipleOfHouse: multiple } : {}),
      ...(premium ? { premium: true, premiumNote: premiumNoteFor(shortTurn, multiple) } : {}),
    }
  })
}

/**
 * What the picker's foot says about the prices: what they are, and that the service fee is in
 * them. Null when nothing on it is priced. `feePercent` is the catalogue's own word for the
 * fee; when it names none the sentence still says there is one, and gives no number.
 */
export function priceFootnote(
  roster: readonly ChatModelOption[],
  feePercent: number | null = SERVICE_FEE_PERCENT,
): string | null {
  if (!roster.some(model => ratesOf(model) !== null)) return null
  const fee = feePercent !== null && Number.isFinite(feePercent) && feePercent > 0 ? `${feePercent}% ` : ''
  return `Prices are US dollars per million tokens, with the ${fee}service fee included.`
}

// ── a refusal, read off the wire ──

/** A coded error envelope's error, with whatever else it carries beside `code` and `message`. */
export interface CodedErrorFields {
  readonly code: string
  readonly message: string
  readonly [key: string]: unknown
}

function amountOf(error: CodedErrorFields | undefined, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = error?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  }
  return null
}

/**
 * Read a refusal the platform gave on a request (`POST /invocations`, `POST …/commands`).
 * A 402, or the code `insufficient_credit` anywhere, is a refusal for credit; a voice that
 * cannot be priced (`model_unpriced`, or `pricing_unavailable`, which means the same to
 * the person: it cannot be priced right now) and a provider that is down
 * (`provider_unavailable`) have their own kinds. Anything else is not about credits and
 * gets no say here: null, and the caller's ordinary handling.
 */
export function billingRefusalOfResponse(status: number, error: CodedErrorFields | undefined): ChatBillingDetail | null {
  const code = error?.code
  if (code === 'insufficient_credit' || (status === 402 && code === undefined)) {
    const required = amountOf(error, 'requiredMicroUsd', 'required_micro_usd')
    return {
      kind: 'insufficient_credit',
      balanceMicroUsd: amountOf(error, 'balanceMicroUsd', 'balance_micro_usd'),
      requiredMicroUsd: required !== null && required > 0 ? required : null,
    }
  }
  if (code === 'model_unpriced' || code === 'pricing_unavailable') {
    return { kind: 'model_unpriced', balanceMicroUsd: null, requiredMicroUsd: null }
  }
  if (code === 'provider_unavailable') {
    return { kind: 'provider_unavailable', balanceMicroUsd: null, requiredMicroUsd: null }
  }
  return null
}

/**
 * Read a turn the host failed for credit in the middle of a run: the failure's message
 * STARTS with `insufficient_credit:`. Nothing that merely mentions it, and nothing else,
 * may borrow the banner.
 */
export function billingRefusalOfTurnFailure(message: string): ChatBillingDetail | null {
  return /^\s*insufficient_credit:/.test(message)
    ? { kind: 'insufficient_credit', balanceMicroUsd: null, requiredMicroUsd: null }
    : null
}

// ── the words ──

const OUT_OF_CREDITS = "You're out of credits."
const MESSAGE_SAVED = 'Your message is saved. Add credits to continue.'
const MODEL_UNPRICED = "This voice can't be priced right now, so Sophia won't run it. Pick another."
const PROVIDER_UNAVAILABLE = 'The model provider is unavailable. This is not about your balance. Try again shortly.'
const SIZE_LIMIT = 'This chat reached its size limit. Start a new chat.'

/** One plain line for a kind, for anywhere that can only show a message. */
export function billingFailureMessage(refusal: ChatBillingDetail): string {
  switch (refusal.kind) {
    case 'insufficient_credit': return `${OUT_OF_CREDITS} ${MESSAGE_SAVED}`
    case 'model_unpriced': return MODEL_UNPRICED
    case 'provider_unavailable': return PROVIDER_UNAVAILABLE
    case 'budget_exhausted': return SIZE_LIMIT
  }
}

/** What the banner needs to know beyond the refusal itself. */
export interface NoticeContext {
  /**
   * Whether the shell can take the person to add credits. Default true. Where it cannot, the refusal
   * is said in the same words and offers no button: a button that goes nowhere is dead UI.
   */
  readonly addCredits?: boolean
  /** The balance the balance line last read; the fallback where a refusal names none (a call refused mid-run). */
  readonly balanceMicroUsd: number | null
  /** The voice in use. */
  readonly voice: ChatModelOption | null
  /** The House default, if the roster has one. */
  readonly house: ChatModelOption | null
}

const ADD_CREDITS = { id: ADD_CREDITS_ACTION, label: 'Add credits' } as const

/** The notice for a chat that reached its size limit, with the way out. */
export function budgetNotice(): ChatComposerNotice {
  return {
    id: BUDGET_NOTICE_ID,
    tone: 'warning',
    title: SIZE_LIMIT,
    action: { id: NEW_CHAT_ACTION, label: 'New chat' },
  }
}

// ── the heads-up that credits are starting ──

/**
 * The shell's notice that credits are starting, as the chat is told it: an id naming these words (new
 * words, a new id), a title, and the paragraphs it says. The shell owns all of it (the date, the
 * wording, who has dismissed it); the chat only shows what it is given.
 */
export interface ChatCreditsNoticeView {
  readonly id: string
  readonly title: string
  readonly paragraphs: readonly string[]
}

/**
 * Where the shell's notice comes from. The chat reads `current(facts)` each time it projects, listens
 * through `subscribe` so a dismissal or new words show at once, and reports Dismiss through
 * `dismiss(facts)`. A source that has nothing to say, or whose person put the notice away, answers null.
 *
 * `facts` is what the backend said of the credits regime on the chat's last read of the balance (the
 * fee, the gate's mode, the day credits start), or null before the first read and for good from an
 * older backend that says none of it. The date and the fee are the backend's, not the build's (Vera,
 * 2026-10-03), so the source builds its words from them and has nothing to show without them. The same
 * facts come back with `dismiss`, so the source knows WHICH notice the person put away.
 */
export interface ChatCreditsNoticeSource {
  current(facts: CreditsFacts | null): ChatCreditsNoticeView | null
  dismiss(facts: CreditsFacts | null): void
  subscribe(callback: () => void): () => void
}

/**
 * The heads-up in the chat's one notice slot: a pointer, not the whole notice. It carries the title and
 * the first paragraph (what changes and when); the rest is on Settings, Billing, which "Details" opens
 * (the same seam as "Add credits", so only where the shell can take the person there). It can always be
 * put away, and it never carries a number: it is not a refusal and names no shortfall.
 */
export function creditsNoticeFor(view: ChatCreditsNoticeView, context: { readonly details: boolean }): ChatComposerNotice {
  const first = view.paragraphs[0]
  return {
    id: CREDITS_NOTICE_ID,
    tone: 'info',
    title: view.title,
    ...(first ? { body: first } : {}),
    ...(context.details ? { action: { id: CREDITS_NOTICE_DETAILS_ACTION, label: 'Details' } } : {}),
    dismiss: { id: CREDITS_NOTICE_DISMISS_ACTION, label: 'Dismiss' },
  }
}

/**
 * The one banner above the composer, in the billing report's exact words. A refusal for
 * credit says the person is out of credits, that their message is saved, and how to add
 * some; when the balance would still run House but not the voice they chose, it says so
 * with the numbers, and tells them to switch. Everything else has its own honest line,
 * and none of them offers credits: a provider outage is not about the balance.
 */
export function billingNotice(refusal: ChatBillingDetail, context: NoticeContext): ChatComposerNotice {
  switch (refusal.kind) {
    case 'insufficient_credit': return creditNotice(refusal, context)
    case 'model_unpriced': return { id: BILLING_NOTICE_ID, tone: 'warning', title: MODEL_UNPRICED }
    case 'provider_unavailable': return { id: BILLING_NOTICE_ID, tone: 'warning', title: PROVIDER_UNAVAILABLE }
    case 'budget_exhausted': return budgetNotice()
  }
}

function creditNotice(refusal: ChatBillingDetail, context: NoticeContext): ChatComposerNotice {
  const { balanceMicroUsd: refusedAt, requiredMicroUsd: required } = refusal
  const action = context.addCredits === false ? undefined : ADD_CREDITS
  // Would switching to House help? Only where the balance would still run it, and only
  // from a voice that is not House already. Without a House price to compare, a voice the
  // catalogue marked premium is taken to be the dearer one.
  const houseMinimum = minAdmitMicroUsd(context.house)
  const houseWouldGo = refusedAt !== null && houseMinimum !== null
    ? refusedAt >= houseMinimum
    : context.voice?.premium === true
  if (context.voice !== null && !context.voice.house && refusedAt !== null && required !== null && houseWouldGo) {
    return {
      id: BILLING_NOTICE_ID,
      tone: 'blocked',
      title: `This voice needs at least ${formatCredit(required)} for one message and your balance is ${formatCredit(refusedAt)}.`,
      body: 'Switch to House or add credits.',
      ...(action ? { action } : {}),
    }
  }
  const balance = refusedAt ?? context.balanceMicroUsd
  return {
    id: BILLING_NOTICE_ID,
    tone: 'blocked',
    title: OUT_OF_CREDITS,
    body: MESSAGE_SAVED,
    ...(balance !== null ? { detail: `Balance ${formatCredit(balance)}` } : {}),
    ...(action ? { action } : {}),
  }
}

// ── the balance line ──

/**
 * What the store knows of the balance: not yet read (null), read, or a read that failed.
 * A failed read is `unavailable`: a balance line that printed $0 for it would tell a
 * person with credit that they had none.
 */
export type BalanceReading = ChatBalance | 'unavailable' | null

const BALANCE_HINT = 'Your credit balance. It is the same figure as Settings, Billing.'

/**
 * The balance line: normal, "Running low" (at or below $0.25), "Out of credits" (at or
 * below the smallest call the voice in use needs, or when the gateway itself says it would
 * refuse), a starter credit for an account with no ledger row, and unavailable.
 *
 * "Out of credits" is said only where the gate REFUSES: the backend's `gateMode` is `enforce`
 * (Vera, 2026-10-03). Where it only observes, and where the backend names no mode (an older one),
 * nothing refuses anyone, so the line never predicts a refusal, neither from the balance against the
 * voice's smallest call nor from the gateway's own "would refuse". It shows the balance, and where
 * enforcement would have said out it is "Running low" with a way to add credits.
 */
export function accountNoteFor(
  read: BalanceReading,
  voice: ChatModelOption | null,
  options: { readonly canAddCredits?: boolean; readonly showBalance?: boolean } = {},
): ChatAccountNote | null {
  const canAddCredits = options.canAddCredits !== false
  // A release that shows no balance (voices-first, Vera 2026-09-30) still says when the gate itself
  // refuses a request: a refusal is never hidden.
  const showBalance = options.showBalance !== false
  if (read === null) return null
  if (read === 'unavailable') {
    if (!showBalance) return null
    return {
      label: 'Credit',
      value: 'unavailable',
      hint: 'The balance could not be read just now. This is not a zero balance.',
    }
  }
  const balance = read.balanceMicroUsd
  const enforcing = read.facts?.gateMode === 'enforce'
  const refuses = enforcing && read.canMakeRequests === false
  if (!showBalance && !refuses) return null
  if (!refuses && !read.initialized) {
    return {
      label: '',
      value: '$1.00 starter credit',
      tone: 'ok',
      hint: 'This account has no credit record yet, so it starts with a $1.00 credit.',
    }
  }
  const minimum = minAdmitMicroUsd(voice) ?? MIN_ADMIT_FLOOR_MICRO_USD
  const cannotPayForOne = balance <= 0 || balance <= minimum
  // "Out" is what an enforcing gate says (it would refuse a request now) or a balance that cannot pay
  // for one message in this voice. That second is a prediction of the gate, so it holds only where the
  // gate enforces, and only where the shell can take the person to add credits.
  if (refuses || (enforcing && canAddCredits && cannotPayForOne)) {
    return {
      label: 'Out of credits',
      value: '',
      tone: 'out',
      ...(canAddCredits ? { action: ADD_CREDITS } : {}),
      hint: refuses
        ? `Balance ${formatCredit(balance)}. The service would refuse a request now.`
        : `Balance ${formatCredit(balance)}. Not enough for one message.`,
    }
  }
  if (balance <= LOW_BALANCE_MICRO_USD) {
    // Where the gate does not refuse, a balance that could not pay for one message is still the moment a
    // person may want to add credits: the way is offered, and no claim is made about what will happen.
    const wantsCredits = !enforcing && canAddCredits && cannotPayForOne
    return {
      label: 'Running low',
      value: formatCredit(balance),
      tone: 'low',
      hint: BALANCE_HINT,
      ...(wantsCredits ? { action: ADD_CREDITS } : {}),
    }
  }
  return { label: 'Credit', value: formatCredit(balance), tone: 'ok', hint: BALANCE_HINT }
}
