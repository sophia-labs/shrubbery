/**
 * The words and the arithmetic of credits in the chat (NO MOCKS, no DOM, no service):
 * pure functions over plain data, held to the billing report's acceptance
 * (`E-billing-enforce.md` 4.5.1, 4.5.2, 4.5.7) and to Vera's rulings (a 20% service
 * fee; the balance is never shown as $0 when it could not be read).
 *
 * Every price used is what the PERSON PAYS, per million tokens: the catalogue lists the
 * provider's price with the service fee already in it (`C-choreograph-return.md` 1.7), so
 * nothing here adds a fee again. They are the ones the reports read from the live catalogue on
 * 2026-09-28/29 and the fee on top: House $0.30 / $2.50 is $0.36 / $3 billed; Kimi K2.6
 * $0.65 / $3.41 is $0.78 / $4.092; GPT-5.4 Pro $30 / $180 is $36 / $216.
 */
import type { ChatMessage, ChatModelOption } from '@shrubbery/chat-kernel'
import { describe, expect, it } from 'vitest'
import {
  ADD_CREDITS_ACTION,
  CREDITS_NOTICE_DETAILS_ACTION,
  CREDITS_NOTICE_DISMISS_ACTION,
  CREDITS_NOTICE_ID,
  LOW_BALANCE_MICRO_USD,
  NEW_CHAT_ACTION,
  SERVICE_FEE_PERCENT,
  accountNoteFor,
  annotateVoices,
  billingFailureMessage,
  billingNotice,
  billingRefusalOfResponse,
  billingRefusalOfTurnFailure,
  budgetNotice,
  costAnnotation,
  creditsNoticeFor,
  formatCost,
  formatCredit,
  minAdmitMicroUsd,
  multipleOfHouse,
  priceFootnote,
  shortTurnMicroUsd,
} from '../chat-billing.js'

const HOUSE: ChatModelOption = { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', house: true, priceInPerMTok: 0.36, priceOutPerMTok: 3 }
const KIMI: ChatModelOption = { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6', priceInPerMTok: 0.78, priceOutPerMTok: 4.092 }
const PRO: ChatModelOption = { id: 'openai/gpt-5.4-pro', label: 'GPT-5.4 Pro', priceInPerMTok: 36, priceOutPerMTok: 216 }
const UNPRICED: ChatModelOption = { id: 'openrouter/auto', label: 'Auto', priceInPerMTok: null, priceOutPerMTok: null }

const EXPLAINS_ZERO = /not a zero balance/i

/**
 * The credits regime a balance was read under, as the backend says it (`facts.gateMode`). The tests of the
 * balance line's five states are about the ENFORCED regime, so their helpers default to it; observe mode
 * and a backend that says nothing have their own describes below.
 */
type GateMode = 'observe' | 'enforce' | null
const regime = (gateMode: GateMode) => (gateMode === null ? {} : { facts: { feeBps: null, gateMode, startDate: null } })

describe('the constants Vera ruled on', () => {
  it('has a 20% service fee, and a low-balance line at $0.25', () => {
    expect(SERVICE_FEE_PERCENT).toBe(20)
    expect(LOW_BALANCE_MICRO_USD).toBe(250_000)
  })
})

describe('formatCredit — what an account holds, never rounded up', () => {
  it('shows cents from a cent up, cut down rather than rounded up', () => {
    expect(formatCredit(970_000)).toBe('$0.97')
    expect(formatCredit(250_000)).toBe('$0.25')
    expect(formatCredit(1_000_000)).toBe('$1.00')
    expect(formatCredit(12_345_678)).toBe('$12.34')
    // Defect avoided: $0.995440 shown as $1.00 reads as a dollar in hand.
    expect(formatCredit(995_440)).toBe('$0.99')
  })

  it('shows four decimals under a cent, so a small balance is not mistaken for none', () => {
    expect(formatCredit(3_800)).toBe('$0.0038')
    expect(formatCredit(3_876)).toBe('$0.0038')
    expect(formatCredit(500)).toBe('$0.0005')
  })

  it('shows zero as zero, and an overdraft as no more than that', () => {
    expect(formatCredit(0)).toBe('$0.00')
    expect(formatCredit(-30_000)).toBe('$0.00')
  })
})

describe('formatCost — the chip beside a reply', () => {
  it('shows what a reply settled at, to four decimals, as the billing report’s example does', () => {
    expect(formatCost(848)).toBe('$0.0008')
    expect(formatCost(3_100)).toBe('$0.0031')
    expect(formatCost(93_600)).toBe('$0.0936')
  })

  it('shows cents from ten cents up', () => {
    expect(formatCost(148_350)).toBe('$0.15')
    expect(formatCost(12_340_000)).toBe('$12.34')
  })

  it('does not print a zero for a cost too small to show', () => {
    expect(formatCost(40)).toBe('<$0.0001')
    expect(formatCost(100)).toBe('$0.0001')
  })

  it('says nothing for no cost, a negative one, or a number that is not one', () => {
    expect(formatCost(0)).toBeNull()
    expect(formatCost(-5)).toBeNull()
    expect(formatCost(Number.NaN)).toBeNull()
  })
})

describe('costAnnotation — the host’s formatter for the kernel', () => {
  const reply = (extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id: 'a1', role: 'assistant', content: 'hello', parts: [], isStreaming: false, toolCalls: [], createdAt: 1, ...extra,
  })

  it('words the settled cost of a reply', () => {
    expect(costAnnotation(reply({ costMicroUsd: 848 }))).toBe('$0.0008')
  })

  it('says nothing about a reply with no settled cost, a reply still streaming, a person’s own message or an earlier conversation’s', () => {
    expect(costAnnotation(reply())).toBeNull()
    expect(costAnnotation(reply({ costMicroUsd: 848, isStreaming: true }))).toBeNull()
    expect(costAnnotation(reply({ role: 'user', costMicroUsd: 848 }))).toBeNull()
    expect(costAnnotation(reply({ costMicroUsd: 848, origin: 'window' }))).toBeNull()
  })
})

describe('what a voice costs', () => {
  it('prices the smallest call the gate will take: 15,000 tokens in, 256 out, at the prices the person pays, at least 1,000 µUSD', () => {
    // 15,000 × 0.36 + 256 × 3 = 6,168 µUSD (the number the Choreograph return gives for House at 20%).
    expect(minAdmitMicroUsd(HOUSE)).toBe(6_168)
    // 15,000 × 0.78 + 256 × 4.092 = 12,747.55, rounded up.
    expect(minAdmitMicroUsd(KIMI)).toBe(12_748)
    // 15,000 × 36 + 256 × 216 = 595,296.
    expect(minAdmitMicroUsd(PRO)).toBe(595_296)
    // No fee is added: the prices already carry it. Defect avoided: a second 20% on top made the
    // "out of credits" line and the premium note 20% dearer than any call is ever billed.
    expect(minAdmitMicroUsd({ priceInPerMTok: 1, priceOutPerMTok: 0 })).toBe(15_000)
    expect(minAdmitMicroUsd({ priceInPerMTok: 0.001, priceOutPerMTok: 0.001 })).toBe(1_000)
  })

  it('does not price a voice the catalogue did not, or half of one', () => {
    expect(minAdmitMicroUsd(UNPRICED)).toBeNull()
    expect(minAdmitMicroUsd({ priceInPerMTok: 1, priceOutPerMTok: null })).toBeNull()
    expect(minAdmitMicroUsd(null)).toBeNull()
    expect(shortTurnMicroUsd(UNPRICED)).toBeNull()
  })

  it('prices a short reply: 2,500 tokens in, 300 out, at the prices the person pays', () => {
    expect(shortTurnMicroUsd(HOUSE)).toBe(1_800)
    expect(shortTurnMicroUsd(KIMI)).toBe(3_178)
    expect(shortTurnMicroUsd(PRO)).toBe(154_800)
  })

  it('compares a short reply with House’s', () => {
    expect(multipleOfHouse(KIMI, HOUSE)).toBeCloseTo(3_177.6 / 1_800, 4)
    expect(multipleOfHouse(HOUSE, HOUSE)).toBeCloseTo(1, 6)
    expect(multipleOfHouse(UNPRICED, HOUSE)).toBeNull()
    expect(multipleOfHouse(KIMI, null)).toBeNull()
    expect(multipleOfHouse(KIMI, UNPRICED)).toBeNull()
  })
})

describe('annotateVoices — what the picker is told', () => {
  it('gives every priced voice but House its multiple, and flags a premium one with a note that says why', () => {
    const roster = annotateVoices([HOUSE, KIMI, PRO, UNPRICED])
    const byId = new Map(roster.map(model => [model.id, model]))
    expect(byId.get(HOUSE.id)!.multipleOfHouse).toBeUndefined()
    expect(byId.get(HOUSE.id)!.premium).toBeUndefined()
    expect(byId.get(KIMI.id)!.multipleOfHouse).toBeCloseTo(1.7653, 3)
    expect(byId.get(KIMI.id)!.premium).toBeUndefined()
    expect(byId.get(PRO.id)!.premium).toBe(true)
    expect(byId.get(PRO.id)!.multipleOfHouse).toBeCloseTo(154_800 / 1_800, 3)
    expect(byId.get(PRO.id)!.premiumNote).toBe('A short reply costs about $0.15, roughly 86× House.')
    expect(byId.get(UNPRICED.id)!.multipleOfHouse).toBeUndefined()
  })

  it('draws the premium line at a short reply above five cents', () => {
    // Above: a short reply is 2,500 tokens in and 300 out, so at $0 out it costs 2,500 × the in price.
    const near = (shortReply: number): ChatModelOption => ({ id: 'x/y', label: 'Y', priceInPerMTok: shortReply / 2_500, priceOutPerMTok: 0 })
    expect(annotateVoices([HOUSE, near(50_000)]).find(model => model.id === 'x/y')!.premium).toBeUndefined()
    expect(annotateVoices([HOUSE, near(50_100)]).find(model => model.id === 'x/y')!.premium).toBe(true)
  })

  it('still flags a premium voice when there is no House row to compare with, and then names no multiple', () => {
    const roster = annotateVoices([PRO])
    expect(roster[0].premium).toBe(true)
    expect(roster[0].multipleOfHouse).toBeUndefined()
    expect(roster[0].premiumNote).toBe('A short reply costs about $0.15.')
  })

  it('leaves the roster it was given alone', () => {
    const before = JSON.stringify([HOUSE, KIMI, PRO])
    annotateVoices([HOUSE, KIMI, PRO])
    expect(JSON.stringify([HOUSE, KIMI, PRO])).toBe(before)
  })

  it('says how the prices are charged: what the person pays, the service fee already in it', () => {
    expect(priceFootnote([HOUSE, KIMI])).toBe('Prices are US dollars per million tokens, with the 20% service fee included.')
    expect(priceFootnote([HOUSE, KIMI], 25)).toBe('Prices are US dollars per million tokens, with the 25% service fee included.')
    // A catalogue that names no fee: the sentence says there is one, and no number.
    expect(priceFootnote([HOUSE, KIMI], null)).toBe('Prices are US dollars per million tokens, with the service fee included.')
    expect(priceFootnote([UNPRICED])).toBeNull()
    expect(priceFootnote([])).toBeNull()
  })
})

describe('a refusal as the host words it', () => {
  it('reads the 402 the gateway gave, with what it says of the balance and of the need', () => {
    expect(billingRefusalOfResponse(402, {
      code: 'insufficient_credit',
      message: "You're out of credits.",
      balanceMicroUsd: 30_000,
      requiredMicroUsd: 93_600,
    })).toEqual({ kind: 'insufficient_credit', balanceMicroUsd: 30_000, requiredMicroUsd: 93_600 })
  })

  it('reads the same numbers spelled the other way, and an overdraft', () => {
    expect(billingRefusalOfResponse(402, {
      code: 'insufficient_credit',
      message: '',
      balance_micro_usd: -1_250,
      required_micro_usd: 6_168,
    })).toEqual({ kind: 'insufficient_credit', balanceMicroUsd: -1_250, requiredMicroUsd: 6_168 })
  })

  it('takes a 402 that names no numbers as a refusal for credit, with no numbers', () => {
    expect(billingRefusalOfResponse(402, undefined)).toEqual({ kind: 'insufficient_credit', balanceMicroUsd: null, requiredMicroUsd: null })
    expect(billingRefusalOfResponse(402, { code: 'insufficient_credit', message: '' }))
      .toEqual({ kind: 'insufficient_credit', balanceMicroUsd: null, requiredMicroUsd: null })
  })

  it('does not trust a number that is not one', () => {
    expect(billingRefusalOfResponse(402, {
      code: 'insufficient_credit', message: '', balanceMicroUsd: 'lots', requiredMicroUsd: Number.NaN,
    })).toEqual({ kind: 'insufficient_credit', balanceMicroUsd: null, requiredMicroUsd: null })
  })

  it('gives a voice that cannot be priced, and a provider that is down, their own kinds', () => {
    expect(billingRefusalOfResponse(422, { code: 'model_unpriced', message: '' }))
      .toEqual({ kind: 'model_unpriced', balanceMicroUsd: null, requiredMicroUsd: null })
    expect(billingRefusalOfResponse(503, { code: 'pricing_unavailable', message: '' })?.kind).toBe('model_unpriced')
    expect(billingRefusalOfResponse(503, { code: 'provider_unavailable', message: '' })?.kind).toBe('provider_unavailable')
    expect(billingRefusalOfResponse(502, { code: 'provider_unavailable', message: '' })?.kind).toBe('provider_unavailable')
  })

  it('lets nothing else borrow the credit banner', () => {
    expect(billingRefusalOfResponse(402, { code: 'subscription_required', message: '' })).toBeNull()
    expect(billingRefusalOfResponse(404, { code: 'domain_agent_not_provisioned', message: '' })).toBeNull()
    expect(billingRefusalOfResponse(503, { code: 'workspace_unavailable', message: '' })).toBeNull()
    expect(billingRefusalOfResponse(403, { code: 'graph_access_denied', message: '' })).toBeNull()
    expect(billingRefusalOfResponse(500, undefined)).toBeNull()
    expect(billingRefusalOfResponse(202, undefined)).toBeNull()
  })

  it('reads a turn the host failed for credit, and only that: the message must start `insufficient_credit:`', () => {
    expect(billingRefusalOfTurnFailure('insufficient_credit: balance is below what this call needs'))
      .toEqual({ kind: 'insufficient_credit', balanceMicroUsd: null, requiredMicroUsd: null })
    expect(billingRefusalOfTurnFailure('  insufficient_credit: x')?.kind).toBe('insufficient_credit')
    expect(billingRefusalOfTurnFailure('insufficient_credit')).toBeNull()
    expect(billingRefusalOfTurnFailure('Insufficient_credit: x')).toBeNull()
    expect(billingRefusalOfTurnFailure('agent failed: insufficient_credit: x')).toBeNull()
    expect(billingRefusalOfTurnFailure('provider exploded')).toBeNull()
    expect(billingRefusalOfTurnFailure('')).toBeNull()
  })

  it('has one plain line for every kind, for a place that can only show a message', () => {
    expect(billingFailureMessage({ kind: 'insufficient_credit', balanceMicroUsd: null, requiredMicroUsd: null }))
      .toBe("You're out of credits. Your message is saved. Add credits to continue.")
    expect(billingFailureMessage({ kind: 'model_unpriced', balanceMicroUsd: null, requiredMicroUsd: null }))
      .toBe("This voice can't be priced right now, so Sophia won't run it. Pick another.")
    expect(billingFailureMessage({ kind: 'provider_unavailable', balanceMicroUsd: null, requiredMicroUsd: null }))
      .toBe('The model provider is unavailable. This is not about your balance. Try again shortly.')
    expect(billingFailureMessage({ kind: 'budget_exhausted', balanceMicroUsd: null, requiredMicroUsd: null }))
      .toBe('This chat reached its size limit. Start a new chat.')
  })
})

describe('the banner above the composer — the exact words', () => {
  const HOUSE_MIN_AND_ABOVE = { house: HOUSE }

  it('says the person is out of credits, that the message is saved, and offers to add credits', () => {
    const notice = billingNotice(
      { kind: 'insufficient_credit', balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 },
      { balanceMicroUsd: 3_800, voice: HOUSE, ...HOUSE_MIN_AND_ABOVE },
    )
    expect(notice).toEqual({
      id: 'billing-refusal',
      tone: 'blocked',
      title: "You're out of credits.",
      body: 'Your message is saved. Add credits to continue.',
      detail: 'Balance $0.0038',
      action: { id: ADD_CREDITS_ACTION, label: 'Add credits' },
    })
  })

  it('falls back on the balance the account line last read when the refusal names none (a call refused mid-run)', () => {
    const notice = billingNotice(
      { kind: 'insufficient_credit', balanceMicroUsd: null, requiredMicroUsd: null },
      { balanceMicroUsd: 3_800, voice: HOUSE, house: HOUSE },
    )
    expect(notice.detail).toBe('Balance $0.0038')
    expect(billingNotice(
      { kind: 'insufficient_credit', balanceMicroUsd: null, requiredMicroUsd: null },
      { balanceMicroUsd: null, voice: HOUSE, house: HOUSE },
    ).detail).toBeUndefined()
  })

  it('names the need and the balance when the voice costs more than the balance holds but House would still go through', () => {
    const notice = billingNotice(
      { kind: 'insufficient_credit', balanceMicroUsd: 30_000, requiredMicroUsd: 93_600 },
      { balanceMicroUsd: 30_000, voice: PRO, house: HOUSE },
    )
    expect(notice.title).toBe('This voice needs at least $0.09 for one message and your balance is $0.03.')
    expect(notice.body).toBe('Switch to House or add credits.')
    expect(notice.tone).toBe('blocked')
    expect(notice.detail).toBeUndefined()
    expect(notice.action).toEqual({ id: ADD_CREDITS_ACTION, label: 'Add credits' })
  })

  it('does not tell someone to switch to House when House would be refused too', () => {
    const notice = billingNotice(
      { kind: 'insufficient_credit', balanceMicroUsd: 3_800, requiredMicroUsd: 93_600 },
      { balanceMicroUsd: 3_800, voice: PRO, house: HOUSE },
    )
    expect(notice.title).toBe("You're out of credits.")
  })

  it('never tells someone to switch to the voice they are already on', () => {
    const notice = billingNotice(
      { kind: 'insufficient_credit', balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 },
      { balanceMicroUsd: 3_800, voice: HOUSE, house: HOUSE },
    )
    expect(notice.body).not.toMatch(/switch to house/i)
  })

  it('gives a voice that cannot be priced, and a provider that is down, their own honest lines', () => {
    const context = { balanceMicroUsd: 970_000, voice: KIMI, house: HOUSE }
    const unpriced = billingNotice({ kind: 'model_unpriced', balanceMicroUsd: null, requiredMicroUsd: null }, context)
    expect(unpriced).toMatchObject({
      tone: 'warning',
      title: "This voice can't be priced right now, so Sophia won't run it. Pick another.",
    })
    expect(unpriced.action).toBeUndefined()
    const down = billingNotice({ kind: 'provider_unavailable', balanceMicroUsd: null, requiredMicroUsd: null }, context)
    expect(down).toMatchObject({
      tone: 'warning',
      title: 'The model provider is unavailable. This is not about your balance. Try again shortly.',
    })
    // Not about the balance: it must not mention credits or offer to add any.
    expect(down.action).toBeUndefined()
    expect(down.detail).toBeUndefined()
  })

  it('has a notice for a chat that reached its size limit, with a way out', () => {
    expect(budgetNotice()).toEqual({
      id: 'budget-exhausted',
      tone: 'warning',
      title: 'This chat reached its size limit. Start a new chat.',
      action: { id: NEW_CHAT_ACTION, label: 'New chat' },
    })
  })
})

describe('a release that shows no balance (voices-first, Vera 2026-09-30)', () => {
  const ok = (balanceMicroUsd: number, extra: { initialized?: boolean; canMakeRequests?: boolean | null; gateMode?: GateMode } = {}) => ({
    initialized: extra.initialized ?? true,
    balanceMicroUsd,
    canMakeRequests: extra.canMakeRequests === undefined ? true : extra.canMakeRequests,
    ...regime(extra.gateMode === undefined ? 'enforce' : extra.gateMode),
  })

  it('hides the balance in every state the person can still send from', () => {
    expect(accountNoteFor(ok(970_000), HOUSE, { showBalance: false })).toBeNull()
    expect(accountNoteFor(ok(210_000), HOUSE, { showBalance: false })).toBeNull()
    expect(accountNoteFor(ok(3_800), HOUSE, { showBalance: false })).toBeNull()
    expect(accountNoteFor(ok(970_000, { initialized: false }), HOUSE, { showBalance: false })).toBeNull()
    expect(accountNoteFor('unavailable', HOUSE, { showBalance: false })).toBeNull()
  })

  it('never hides a refusal the gateway itself announces, where the gate refuses', () => {
    expect(accountNoteFor(ok(900_000, { canMakeRequests: false }), HOUSE, { showBalance: false }))
      .toMatchObject({ label: 'Out of credits', tone: 'out' })
  })

  it('has no refusal to announce where the gate only observes, or where the backend does not say: the line stays hidden', () => {
    expect(accountNoteFor(ok(900_000, { canMakeRequests: false, gateMode: 'observe' }), HOUSE, { showBalance: false })).toBeNull()
    expect(accountNoteFor(ok(900_000, { canMakeRequests: false, gateMode: null }), HOUSE, { showBalance: false })).toBeNull()
  })
})

describe('the balance line — its five states, where the gate enforces', () => {
  const ok = (balanceMicroUsd: number, extra: { initialized?: boolean; canMakeRequests?: boolean | null; gateMode?: GateMode } = {}) => ({
    initialized: extra.initialized ?? true,
    balanceMicroUsd,
    canMakeRequests: extra.canMakeRequests === undefined ? true : extra.canMakeRequests,
    ...regime(extra.gateMode === undefined ? 'enforce' : extra.gateMode),
  })

  it('shows nothing until the balance has been read', () => {
    expect(accountNoteFor(null, HOUSE)).toBeNull()
  })

  it('shows the balance when it is comfortably enough', () => {
    expect(accountNoteFor(ok(970_000), HOUSE)).toEqual({
      label: 'Credit',
      value: '$0.97',
      tone: 'ok',
      hint: 'Your credit balance. It is the same figure as Settings, Billing.',
    })
  })

  it('says "Running low" at or below $0.25', () => {
    expect(accountNoteFor(ok(210_000), HOUSE)).toMatchObject({ label: 'Running low', value: '$0.21', tone: 'low' })
    expect(accountNoteFor(ok(250_000), HOUSE)).toMatchObject({ label: 'Running low', tone: 'low' })
    expect(accountNoteFor(ok(250_001), HOUSE)).toMatchObject({ label: 'Credit', tone: 'ok' })
    expect(accountNoteFor(ok(210_000), HOUSE)!.action).toBeUndefined()
  })

  it('says "Out of credits", with a way to add some, at or below the current voice’s minimum', () => {
    const note = accountNoteFor(ok(3_800), HOUSE)!
    expect(note).toMatchObject({
      label: 'Out of credits',
      value: '',
      tone: 'out',
      action: { id: ADD_CREDITS_ACTION, label: 'Add credits' },
    })
    expect(note.hint).toContain('Balance $0.0038')
    expect(accountNoteFor(ok(6_168), HOUSE)).toMatchObject({ tone: 'out' })
    expect(accountNoteFor(ok(6_169), HOUSE)).toMatchObject({ tone: 'low' })
  })

  it('measures "out" against the voice in use: a balance that runs House is out for a dearer voice', () => {
    expect(accountNoteFor(ok(8_000), HOUSE)).toMatchObject({ tone: 'low' })
    expect(accountNoteFor(ok(8_000), KIMI)).toMatchObject({ tone: 'out' })
  })

  it('is out when the gateway itself says it would refuse a request, and when nothing is left', () => {
    expect(accountNoteFor(ok(900_000, { canMakeRequests: false }), HOUSE)).toMatchObject({ tone: 'out' })
    expect(accountNoteFor(ok(0), HOUSE)).toMatchObject({ tone: 'out' })
    expect(accountNoteFor(ok(-50_000), HOUSE)).toMatchObject({ tone: 'out' })
  })

  it('has only the smallest possible call to measure by when it does not know the voice', () => {
    expect(accountNoteFor(ok(1_000), null)).toMatchObject({ tone: 'out' })
    expect(accountNoteFor(ok(1_001), null)).toMatchObject({ tone: 'low' })
    expect(accountNoteFor(ok(1_001), UNPRICED)).toMatchObject({ tone: 'low' })
  })

  it('says a starter credit when the account has no ledger row yet, never "not initialized"', () => {
    const note = accountNoteFor(ok(0, { initialized: false }), HOUSE)!
    expect(note.value).toBe('$1.00 starter credit')
    expect(note.label).toBe('')
    expect(note.tone).toBe('ok')
    expect(JSON.stringify(note)).not.toMatch(/initiali[sz]ed/i)
  })

  it('says it could not read the balance, and never shows zero for a read that failed', () => {
    const note = accountNoteFor('unavailable', HOUSE)!
    expect(note.label).toBe('Credit')
    expect(note.value).toBe('unavailable')
    expect(note.tone).toBeUndefined()
    expect(note.hint).toMatch(EXPLAINS_ZERO)
    expect(JSON.stringify(note)).not.toContain('$0')
    expect(note.action).toBeUndefined()
  })
})

describe('credits where the shell has no way to take the person to add some', () => {
  // The release that ships the picker ships no purchase and enforces nothing: a button that goes
  // nowhere is dead, and "Out of credits" said of an account whose message still goes through is
  // untrue. Both wait for the shell that can take the person to Billing (`canAddCredits`).
  const read = (balanceMicroUsd: number, extra: { canMakeRequests?: boolean | null; initialized?: boolean; gateMode?: GateMode } = {}) => ({
    initialized: extra.initialized ?? true,
    balanceMicroUsd,
    canMakeRequests: extra.canMakeRequests === undefined ? true : extra.canMakeRequests,
    ...regime(extra.gateMode === undefined ? 'enforce' : extra.gateMode),
  })
  const NO = { canAddCredits: false }

  it('offers no action on any state of the balance line', () => {
    for (const balance of [970_000, 210_000, 3_800, 0, -700_000]) {
      const note = accountNoteFor(read(balance, { canMakeRequests: balance > -500_000 }), HOUSE, NO)
      expect(note).not.toBeNull()
      expect(note!.action).toBeUndefined()
    }
  })

  it('does not say "Out of credits" of a balance that is merely at or below the smallest call: nothing refuses it here', () => {
    // Defect guarded: 3,800 µUSD is under the 6,168 one message on House needs once credits are
    // enforced; until then the message goes through, and the line says what is held.
    expect(accountNoteFor(read(3_800), HOUSE, NO)).toMatchObject({ label: 'Running low', value: '$0.0038', tone: 'low' })
    expect(accountNoteFor(read(0), HOUSE, NO)).toMatchObject({ label: 'Running low', value: '$0.00', tone: 'low' })
    expect(accountNoteFor(read(8_000), KIMI, NO)).toMatchObject({ label: 'Running low', tone: 'low' })
  })

  it('still says "Out of credits" when the gateway itself says a request would be refused', () => {
    expect(accountNoteFor(read(-700_000, { canMakeRequests: false }), HOUSE, NO)).toMatchObject({
      label: 'Out of credits',
      tone: 'out',
    })
    expect(accountNoteFor(read(-700_000, { canMakeRequests: false }), HOUSE, NO)!.action).toBeUndefined()
  })

  it('leaves every other state as it was', () => {
    expect(accountNoteFor(read(970_000), HOUSE, NO)).toEqual(accountNoteFor(read(970_000), HOUSE))
    expect(accountNoteFor(read(210_000), HOUSE, NO)).toEqual(accountNoteFor(read(210_000), HOUSE))
    expect(accountNoteFor(read(0, { initialized: false }), HOUSE, NO)).toEqual(accountNoteFor(read(0, { initialized: false }), HOUSE))
    expect(accountNoteFor('unavailable', HOUSE, NO)).toEqual(accountNoteFor('unavailable', HOUSE))
    expect(accountNoteFor(null, HOUSE, NO)).toBeNull()
  })

  it('says a refusal for credit in the same words, with no button, and keeps every other action', () => {
    const refusal = { kind: 'insufficient_credit' as const, balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 }
    const notice = billingNotice(refusal, { balanceMicroUsd: 3_800, voice: HOUSE, house: HOUSE, addCredits: false })
    expect(notice).toMatchObject({ tone: 'blocked', title: "You're out of credits.", body: 'Your message is saved. Add credits to continue.' })
    expect(notice.action).toBeUndefined()
    const switchTo = billingNotice(
      { kind: 'insufficient_credit', balanceMicroUsd: 30_000, requiredMicroUsd: 93_600 },
      { balanceMicroUsd: 30_000, voice: PRO, house: HOUSE, addCredits: false },
    )
    expect(switchTo.title).toBe('This voice needs at least $0.09 for one message and your balance is $0.03.')
    expect(switchTo.action).toBeUndefined()
    // The size limit's way out is the chat's own, not the shell's.
    expect(billingNotice({ kind: 'budget_exhausted', balanceMicroUsd: null, requiredMicroUsd: null }, { balanceMicroUsd: null, voice: HOUSE, house: HOUSE, addCredits: false }).action)
      .toEqual({ id: NEW_CHAT_ACTION, label: 'New chat' })
  })
})

describe('observe mode: the gate records and refuses nothing, so the balance line never predicts a refusal (Vera, 2026-10-03)', () => {
  const read = (balanceMicroUsd: number, extra: { canMakeRequests?: boolean | null; initialized?: boolean; gateMode?: GateMode } = {}) => ({
    initialized: extra.initialized ?? true,
    balanceMicroUsd,
    canMakeRequests: extra.canMakeRequests === undefined ? true : extra.canMakeRequests,
    ...regime(extra.gateMode === undefined ? 'observe' : extra.gateMode),
  })
  const ADD = { id: ADD_CREDITS_ACTION, label: 'Add credits' }

  it('shows the balance, with a way to add credits, where enforcement would have said "Out of credits"', () => {
    const note = accountNoteFor(read(3_800), HOUSE)!
    expect(note).toMatchObject({ label: 'Running low', value: '$0.0038', tone: 'low', action: ADD })
    // Not a prediction of the gate, and not a claim about one message: it is a balance.
    expect(note.hint).not.toMatch(/not enough|refuse|out of credits/i)
    expect(JSON.stringify(note)).not.toMatch(/out of credits/i)
  })

  it('does the same at zero, below zero, and for a voice dearer than the balance', () => {
    expect(accountNoteFor(read(6_168), HOUSE)).toMatchObject({ label: 'Running low', value: '$0.0061', action: ADD })
    expect(accountNoteFor(read(0), HOUSE)).toMatchObject({ label: 'Running low', value: '$0.00', action: ADD })
    expect(accountNoteFor(read(-50_000), HOUSE)).toMatchObject({ label: 'Running low', value: '$0.00', action: ADD })
    expect(accountNoteFor(read(8_000), KIMI)).toMatchObject({ label: 'Running low', action: ADD })
    for (const balance of [3_800, 0, -50_000]) expect(accountNoteFor(read(balance), HOUSE)).not.toMatchObject({ tone: 'out' })
  })

  it('ignores the gateway’s own "would refuse a request": nothing refuses one in observe mode', () => {
    const note = accountNoteFor(read(-700_000, { canMakeRequests: false }), HOUSE)!
    expect(note).toMatchObject({ label: 'Running low', value: '$0.00', tone: 'low', action: ADD })
    expect(accountNoteFor(read(900_000, { canMakeRequests: false }), HOUSE)).toMatchObject({ label: 'Credit', value: '$0.90', tone: 'ok' })
  })

  it('keeps the states above the smallest call as they are: low has no button, enough is just the balance', () => {
    expect(accountNoteFor(read(210_000), HOUSE)).toMatchObject({ label: 'Running low', value: '$0.21', tone: 'low' })
    expect(accountNoteFor(read(210_000), HOUSE)!.action).toBeUndefined()
    expect(accountNoteFor(read(970_000), HOUSE)).toMatchObject({ label: 'Credit', value: '$0.97', tone: 'ok' })
    expect(accountNoteFor(read(970_000), HOUSE)!.action).toBeUndefined()
  })

  it('offers no button where the shell cannot take the person to Billing', () => {
    expect(accountNoteFor(read(3_800), HOUSE, { canAddCredits: false })).toMatchObject({ label: 'Running low', value: '$0.0038' })
    expect(accountNoteFor(read(3_800), HOUSE, { canAddCredits: false })!.action).toBeUndefined()
  })

  it('says a starter credit and an unreadable balance as it always did', () => {
    expect(accountNoteFor(read(0, { initialized: false }), HOUSE)).toMatchObject({ value: '$1.00 starter credit', tone: 'ok' })
    expect(accountNoteFor('unavailable', HOUSE)).toMatchObject({ label: 'Credit', value: 'unavailable' })
  })

  it('is hidden with the balance line where the release shows none, whatever the gateway says', () => {
    expect(accountNoteFor(read(3_800), HOUSE, { showBalance: false })).toBeNull()
    expect(accountNoteFor(read(-700_000, { canMakeRequests: false }), HOUSE, { showBalance: false })).toBeNull()
  })
})

describe('a backend that does not say (an older one): treated as observe, and never as a gate that refuses', () => {
  const read = (balanceMicroUsd: number, extra: { canMakeRequests?: boolean | null } = {}) => ({
    initialized: true,
    balanceMicroUsd,
    canMakeRequests: extra.canMakeRequests === undefined ? true : extra.canMakeRequests,
  })

  it('never says "Out of credits": there is no gate to refuse anyone', () => {
    for (const balance of [3_800, 0, -50_000]) {
      expect(accountNoteFor(read(balance), HOUSE)).toMatchObject({ label: 'Running low', tone: 'low', action: { id: ADD_CREDITS_ACTION } })
    }
    expect(accountNoteFor(read(-700_000, { canMakeRequests: false }), HOUSE)).toMatchObject({ label: 'Running low', tone: 'low' })
  })

  it('has facts that do not name a mode: the same', () => {
    const noMode = { ...read(3_800), facts: { feeBps: 1500, gateMode: null, startDate: null } }
    expect(accountNoteFor(noMode, HOUSE)).toMatchObject({ label: 'Running low' })
  })
})

describe('the credits notice, in the chat’s notice slot', () => {
  const FIRST = "Sophia's chat and agents run on AI models that cost real money, so from October 12, 2026 each message uses credits from your balance."
  const view = {
    id: 'credits-start:October 12, 2026',
    title: 'Credits start on October 12, 2026.',
    paragraphs: [FIRST, 'Most messages cost a fraction of a cent to a few cents.', 'Credits are prepaid and non-refundable.'],
  }

  it('is a quiet heads-up: the title, the first paragraph only, a way to the details, a way to put it away', () => {
    expect(creditsNoticeFor(view, { details: true })).toEqual({
      id: CREDITS_NOTICE_ID,
      tone: 'info',
      title: 'Credits start on October 12, 2026.',
      body: FIRST,
      action: { id: CREDITS_NOTICE_DETAILS_ACTION, label: 'Details' },
      dismiss: { id: CREDITS_NOTICE_DISMISS_ACTION, label: 'Dismiss' },
    })
  })

  it('keeps the rest for Billing, where the whole notice is, and says nothing the notice does not say', () => {
    const notice = creditsNoticeFor(view, { details: true })
    const spoken = [notice.title, notice.body].join(' ')
    expect(spoken).not.toContain('non-refundable')
    expect(spoken).not.toContain('a fraction of a cent')
  })

  it('offers no Details where the shell cannot take the person to Billing, and can still be put away', () => {
    const notice = creditsNoticeFor(view, { details: false })
    expect(notice.action).toBeUndefined()
    expect(notice.dismiss).toEqual({ id: CREDITS_NOTICE_DISMISS_ACTION, label: 'Dismiss' })
  })

  it('is still a notice when it is only a title', () => {
    const notice = creditsNoticeFor({ id: 'x', title: 'Credits start soon.', paragraphs: [] }, { details: true })
    expect(notice.title).toBe('Credits start soon.')
    expect(notice.body).toBeUndefined()
  })

  it('is told apart from a refusal and from the size limit by its id', () => {
    expect(new Set([CREDITS_NOTICE_ID, 'billing-refusal', 'budget-exhausted']).size).toBe(3)
  })
})
