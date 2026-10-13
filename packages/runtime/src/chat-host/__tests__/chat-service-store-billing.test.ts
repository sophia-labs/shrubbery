/**
 * Credits in the chat, through the real store over the real hosted service and a
 * scripted Choreograph and gateway (NO MOCKS): the balance line's five states, the one
 * refusal banner and its two sources, the draft kept, the chip beside each reply.
 *
 * Acceptance is `E-billing-enforce.md` 4.5.1, 4.5.2 and 4.5.7 with Vera's rulings (a 20%
 * service fee, a $5 minimum top-up). The store decides nothing about money except what to
 * SAY: the gateway and the host decide what is refused.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeHostedChatService } from '../../chat-services/hosted-chat-service.js'
import { makeLocalChatService } from '../../chat-services/local-chat-service.js'
import {
  ChoreographSim,
  DOMAIN_WORKFLOW,
  completed,
  costedTurn,
  delta,
  failingTurn,
  plainTurn,
  started,
  turnDone,
  workspaceWorkflow,
  type Received,
} from '../../chat-services/__tests__/fixtures/choreograph-sim.js'
import { SobremesaRoutes, premiumVoiceRow, voiceCatalogue } from '../../chat-services/__tests__/fixtures/sobremesa-routes.js'
import { createChatServiceStore, type ChatServiceStore, type ChatServiceStoreOptions } from '../chat-service-store.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const USER = '4999d9ce-3091-70d0-9c80-7bed4a0fc77d'
const KIMI = 'moonshotai/kimi-k2.6'
const PRO = 'openai/gpt-5.4-pro'
const ADD_CREDITS = { id: 'add-credits', label: 'Add credits' }

async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('store test timed out')
    await new Promise(resolve => setTimeout(resolve, 2))
  }
}

const idle = (store: ChatServiceStore): boolean => !store.getState().streaming

/**
 * A balance as the gateway answers it. These tests are about the ENFORCED regime unless they say otherwise
 * (`gateMode: 'observe'`), or say the backend is an older one that names no mode (`gateMode: undefined`).
 */
const balanceOf = (micro: number, extra: { initialized?: boolean; canMakeRequests?: boolean; gateMode?: 'observe' | 'enforce' } = {}) => ({
  status: 200,
  body: SobremesaRoutes.balanceBody(USER, micro, { gateMode: 'enforce', ...extra }),
})

describe('credits in the chat store', () => {
  let sim: ChoreographSim
  let routes: SobremesaRoutes
  let store: ChatServiceStore

  async function open(options: { premium?: boolean; store?: ChatServiceStoreOptions } = {}): Promise<void> {
    if (options.premium) routes.catalogue = { models: [...voiceCatalogue(), premiumVoiceRow()] }
    const service = makeHostedChatService({
      gatewayBaseUrl: sim.base,
      graphBaseUrl: (graph: string) => sim.graphBase(graph),
      graphId: () => 'atelier-20260929',
      userId: () => USER,
      token: () => 'jwt',
      storage: new MemoryStorage(),
      resolveAttempts: 3,
      resolveDelayMs: 0,
      sleep: async () => undefined,
    })
    await service.probeCapabilities!()
    const created = await service.createSession()
    service.bindSlotSession(0, created.id)
    // The shell that can take the person to Billing says so; these tests are about that shell.
    store = createChatServiceStore(service, { canAddCredits: () => true, ...options.store })
    store.setSession(created.id)
    await until(() => store.getState().conversationState === 'ready')
  }

  beforeEach(async () => {
    sim = new ChoreographSim()
    routes = new SobremesaRoutes(sim)
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true })]
    routes.balance = balanceOf(970_000)
    await sim.start()
  })
  afterEach(async () => {
    store?.dispose()
    await sim.stop()
  })

  describe('a shell that cannot take the person to add credits (the default)', () => {
    // The release that ships the picker ships no purchase and enforces nothing. A button that goes
    // nowhere is dead; "Out of credits" said of an account whose message still goes through is untrue.
    const without = { store: { canAddCredits: () => false } }

    it('shows the plain balance, with no button, at or below the smallest call', async () => {
      routes.balance = balanceOf(3_800)
      await open(without)
      await until(() => store.getState().accountNote !== null)
      const note = store.getState().accountNote!
      expect(note).toMatchObject({ label: 'Running low', value: '$0.0038', tone: 'low' })
      expect(note.action).toBeUndefined()
    })

    it('is the default: a store that is not told the shell can add credits offers none', async () => {
      routes.balance = balanceOf(900_000, { canMakeRequests: false })
      const service = makeHostedChatService({
        gatewayBaseUrl: sim.base,
        graphBaseUrl: (graph: string) => sim.graphBase(graph),
        graphId: () => 'atelier-20260929',
        userId: () => USER,
        token: () => 'jwt',
        storage: new MemoryStorage(),
        resolveAttempts: 3,
        resolveDelayMs: 0,
        sleep: async () => undefined,
      })
      const created = await service.createSession()
      service.bindSlotSession(0, created.id)
      const plain = createChatServiceStore(service)
      plain.setSession(created.id)
      await until(() => plain.getState().accountNote !== null)
      // The gateway says it would refuse: that is said, as it is, and there is nowhere to send the person.
      expect(plain.getState().accountNote).toMatchObject({ label: 'Out of credits', tone: 'out' })
      expect(plain.getState().accountNote!.action).toBeUndefined()
      plain.dispose()
    })

    it('says a refusal for credit in the same words with no button, and keeps the person’s words', async () => {
      await open(without)
      sim.invocation = () => ({
        status: 402,
        body: { error: { code: 'insufficient_credit', message: '', balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 } },
      })
      store.send('Hello there')
      await until(() => idle(store) && store.getState().composerNotice !== null)
      const notice = store.getState().composerNotice!
      expect(notice).toMatchObject({ title: "You're out of credits.", body: 'Your message is saved. Add credits to continue.' })
      expect(notice.action).toBeUndefined()
      expect(store.getState().retainedDraft).toBe('Hello there')
    })

    it('still gives the size limit its way out: a new chat is the chat’s own, not the shell’s', async () => {
      await open(without)
      sim.queueTurn({
        answer: 'A cut reply.',
        stages: [[started(), { type: 'budget.exhausted', value: { output: 'A cut reply.', turns: 24 } }, completed('A cut reply.')]],
      })
      store.send('Long one')
      await until(() => idle(store) && store.getState().composerNotice !== null)
      expect(store.getState().composerNotice!.action).toEqual({ id: 'new-chat', label: 'New chat' })
    })
  })

  describe('the balance line', () => {
    it('shows the balance, normally, as it is', async () => {
      await open()
      await until(() => store.getState().accountNote !== null)
      expect(store.getState().accountNote).toEqual({
        label: 'Credit',
        value: '$0.97',
        tone: 'ok',
        hint: 'Your credit balance. It is the same figure as Settings, Billing.',
      })
    })

    it('says "Running low" at or below $0.25', async () => {
      routes.balance = balanceOf(210_000)
      await open()
      await until(() => store.getState().accountNote !== null)
      expect(store.getState().accountNote).toMatchObject({ label: 'Running low', value: '$0.21', tone: 'low' })
    })

    it('says "Out of credits", with the way to add some, when the balance cannot pay for one message in the voice in use', async () => {
      routes.balance = balanceOf(3_800)
      await open()
      await until(() => store.getState().accountNote !== null)
      expect(store.getState().accountNote).toMatchObject({
        label: 'Out of credits',
        value: '',
        tone: 'out',
        action: ADD_CREDITS,
      })
    })

    it('measures "out" against the voice the person picks: House runs on what a dearer voice cannot', async () => {
      routes.balance = balanceOf(8_000)
      await open()
      await until(() => store.getState().accountNote !== null && store.getState().models.length > 0)
      expect(store.getState().accountNote).toMatchObject({ tone: 'low' })
      store.setModel!(KIMI)
      expect(store.getState().currentModel).toBe(KIMI)
      expect(store.getState().accountNote).toMatchObject({ label: 'Out of credits', tone: 'out' })
    })

    it('marks the line "out" when the gateway itself says a request would be refused', async () => {
      routes.balance = balanceOf(900_000, { canMakeRequests: false })
      await open()
      await until(() => store.getState().accountNote !== null)
      expect(store.getState().accountNote).toMatchObject({ tone: 'out', action: ADD_CREDITS })
    })

    describe('where the gate only observes (Vera, 2026-10-03: never a refusal prediction)', () => {
      it('shows the balance with a way to add credits, not "Out of credits", where enforcement would have said out', async () => {
        routes.balance = balanceOf(3_800, { gateMode: 'observe' })
        await open()
        await until(() => store.getState().accountNote !== null)
        expect(store.getState().accountNote).toMatchObject({ label: 'Running low', value: '$0.0038', tone: 'low', action: ADD_CREDITS })
        expect(JSON.stringify(store.getState().accountNote)).not.toMatch(/out of credits/i)
      })

      it('measures nothing against the voice in use: a dearer voice does not turn the line into a refusal', async () => {
        routes.balance = balanceOf(8_000, { gateMode: 'observe' })
        await open()
        await until(() => store.getState().accountNote !== null && store.getState().models.length > 0)
        store.setModel!(KIMI)
        expect(store.getState().accountNote).toMatchObject({ label: 'Running low', tone: 'low' })
        expect(store.getState().accountNote).not.toMatchObject({ tone: 'out' })
      })

      it('does not call the gateway’s own "would refuse" a refusal: nothing refuses in observe mode', async () => {
        routes.balance = balanceOf(900_000, { gateMode: 'observe', canMakeRequests: false })
        await open()
        await until(() => store.getState().accountNote !== null)
        expect(store.getState().accountNote).toMatchObject({ label: 'Credit', value: '$0.90', tone: 'ok' })
      })

      it('says the same of a backend that names no mode at all (an older one)', async () => {
        routes.balance = balanceOf(3_800, { gateMode: undefined })
        await open()
        await until(() => store.getState().accountNote !== null)
        expect(store.getState().accountNote).toMatchObject({ label: 'Running low', tone: 'low', action: ADD_CREDITS })
      })

      it('still shows a refusal the platform really gives: that is the platform’s word, not a prediction', async () => {
        routes.balance = balanceOf(3_800, { gateMode: 'observe' })
        await open()
        sim.invocation = () => ({
          status: 402,
          body: { error: { code: 'insufficient_credit', message: '', balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 } },
        })
        store.send('Hello there')
        await until(() => store.getState().composerNotice?.id === 'billing-refusal')
        expect(store.getState().composerNotice?.title).toBe("You're out of credits.")
      })
    })

    it('says a starter credit for an account without a ledger row, and never "not initialized"', async () => {
      routes.balance = balanceOf(0, { initialized: false })
      await open()
      await until(() => store.getState().accountNote !== null)
      const note = store.getState().accountNote!
      expect(note.value).toBe('$1.00 starter credit')
      expect(note.tone).toBe('ok')
      expect(JSON.stringify(note)).not.toMatch(/initiali[sz]ed/i)
    })

    it('says the balance is unavailable when the read failed, and never shows zero for it', async () => {
      routes.balance = { status: 503, body: { error: 'warming up' } }
      await open()
      await until(() => store.getState().accountNote !== null)
      const note = store.getState().accountNote!
      expect(note.value).toBe('unavailable')
      expect(note.tone).toBeUndefined()
      expect(JSON.stringify(note)).not.toContain('$0')
      expect(routes.asked.balance).toBeGreaterThan(0)
    })

    it('says it is unavailable, too, of a gateway that has no such route', async () => {
      routes.balance = null
      await open()
      await until(() => store.getState().accountNote !== null)
      expect(store.getState().accountNote!.value).toBe('unavailable')
    })

    it('replaces "unavailable" with the balance once a later read succeeds', async () => {
      routes.balance = { status: 503, body: { error: 'warming up' } }
      await open()
      await until(() => store.getState().accountNote?.value === 'unavailable')
      routes.balance = balanceOf(970_000)
      sim.queueTurn(plainTurn('Hello.'))
      store.send('Hi')
      await until(() => store.getState().accountNote?.value === '$0.97')
    })

    it('reads again after each settled turn, and keeps looking until a debit that has not landed does', async () => {
      // The debit is delivered after the turn settles; a read at the end of the turn can
      // be one debit behind. The chip says what the turn cost, so the line must catch up.
      await open({ store: { balanceSettleMs: 60 } })
      await until(() => store.getState().accountNote?.value === '$0.97')
      sim.queueTurn(costedTurn('Hello.', 848))
      const before = routes.asked.balance
      store.send('Hi')
      await until(() => idle(store) && store.getState().messages.length >= 2)
      // The first read after the turn still says $0.97: the debit has not landed.
      await until(() => routes.asked.balance >= before + 1)
      expect(store.getState().accountNote?.value).toBe('$0.97')
      routes.balance = balanceOf(969_152)
      await until(() => store.getState().accountNote?.value === '$0.96')
    })

    it('does not go on reading forever for a debit that never lands', async () => {
      await open({ store: { balanceSettleMs: 2 } })
      await until(() => store.getState().accountNote?.value === '$0.97')
      sim.queueTurn(costedTurn('Hello.', 848))
      store.send('Hi')
      await until(() => idle(store) && store.getState().messages.length >= 2)
      await new Promise(resolve => setTimeout(resolve, 200))
      const settledReads = routes.asked.balance
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(routes.asked.balance).toBe(settledReads)
    })

    it('says how the prices are charged at the foot of the picker', async () => {
      await open()
      await until(() => store.getState().models.length > 0)
      expect(store.getState().voiceFootnote).toBe('Prices are US dollars per million tokens, with the 20% service fee included.')
    })
  })

  describe('the refusal banner', () => {
    it('answers a first message the gateway refuses for credit with one banner, the words kept, and no error line', async () => {
      routes.balance = balanceOf(3_800)
      sim.invocation = () => ({
        status: 402,
        body: { error: { code: 'insufficient_credit', message: "You're out of credits.", balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 } },
      })
      await open()
      store.send('Hello there')
      await until(() => idle(store) && store.getState().composerNotice !== null)
      const state = store.getState()

      expect(state.composerNotice).toEqual({
        id: 'billing-refusal',
        tone: 'blocked',
        title: "You're out of credits.",
        body: 'Your message is saved. Add credits to continue.',
        detail: 'Balance $0.0038',
        action: ADD_CREDITS,
      })
      // The draft is kept and the person is not shown an unsent message or an error line.
      expect(state.retainedDraft).toBe('Hello there')
      expect(state.sendState).toBe('ready')
      expect(state.sendRecovery).toBe('none')
      expect(state.sendError).toBeNull()
      expect(state.error).toBeNull()
      expect(state.messages).toEqual([])
      expect(JSON.stringify(state.composerNotice)).not.toContain('insufficient_credit')
    })

    it('gives the banner once, and takes it down when the message goes', async () => {
      let refuse = true
      sim.invocation = () => (refuse
        ? { status: 402, body: { error: { code: 'insufficient_credit', message: '', balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 } } }
        : undefined)
      await open()
      store.send('Hello there')
      await until(() => idle(store) && store.getState().composerNotice !== null)

      refuse = false
      routes.balance = balanceOf(5_000_000)
      store.send('Hello there')
      await until(() => idle(store) && store.getState().messages.length >= 2)
      const state = store.getState()
      expect(state.composerNotice).toBeNull()
      expect(state.retainedDraft).toBeNull()
      expect(state.messages.map(message => [message.role, message.content])[0]).toEqual(['user', 'Hello there'])
    })

    it('answers a refused follow-up the same way, keeps the conversation as it was, and lets the same words go after a top-up', async () => {
      let refuse = false
      sim.extraRoutes.push((request: Received) => (
        refuse && request.method === 'POST' && request.route.endsWith('/commands')
          ? { status: 402, body: { error: { code: 'insufficient_credit', message: '', balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 } } }
          : undefined))
      await open()
      store.send('First')
      await until(() => idle(store) && store.getState().messages.length >= 2)

      refuse = true
      store.send('Second')
      await until(() => idle(store) && store.getState().composerNotice !== null)
      let state = store.getState()
      expect(state.composerNotice).toMatchObject({ title: "You're out of credits.", action: ADD_CREDITS })
      expect(state.retainedDraft).toBe('Second')
      expect(state.sendState).toBe('ready')
      expect(state.sendRecovery).toBe('none')
      expect(state.messages.map(message => message.role)).toEqual(['user', 'assistant'])
      expect(state.messages[0].content).toBe('First')

      refuse = false
      store.send('Second')
      await until(() => idle(store) && store.getState().messages.length >= 4)
      state = store.getState()
      expect(state.composerNotice).toBeNull()
      expect(state.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    })

    it('tells someone whose balance still runs House that the voice they chose is the problem, in the words of the report', async () => {
      routes.balance = balanceOf(30_000)
      let refuse = false
      sim.extraRoutes.push((request: Received) => (
        refuse && request.method === 'POST' && request.route.endsWith('/commands')
          ? { status: 402, body: { error: { code: 'insufficient_credit', message: '', balanceMicroUsd: 30_000, requiredMicroUsd: 93_600 } } }
          : undefined))
      await open({ premium: true })
      await until(() => store.getState().models.length > 0)
      store.setModel!(PRO)
      store.send('First')
      await until(() => idle(store) && store.getState().messages.length >= 2)

      refuse = true
      store.send('Second')
      await until(() => idle(store) && store.getState().composerNotice !== null)
      expect(store.getState().composerNotice).toEqual({
        id: 'billing-refusal',
        tone: 'blocked',
        title: 'This voice needs at least $0.09 for one message and your balance is $0.03.',
        body: 'Switch to House or add credits.',
        action: ADD_CREDITS,
      })
      expect(store.getState().retainedDraft).toBe('Second')
    })

    it('answers a call the host refuses mid-run with the same banner, without the raw code, and without an empty reply', async () => {
      routes.balance = balanceOf(3_800)
      await open()
      sim.queueTurn(plainTurn('First reply.'))
      sim.queueTurn(failingTurn('insufficient_credit: balance 3800 is below the 6168 this call needs'))
      store.send('First')
      await until(() => idle(store) && store.getState().messages.length >= 2)
      store.send('Second')
      await until(() => idle(store) && store.getState().composerNotice !== null)
      const state = store.getState()

      expect(state.composerNotice).toMatchObject({
        tone: 'blocked',
        title: "You're out of credits.",
        body: 'Your message is saved. Add credits to continue.',
        detail: 'Balance $0.0038',
        action: ADD_CREDITS,
      })
      // The turn was accepted, so its message is in the conversation; the reply that never came is not.
      expect(state.messages.map(message => [message.role, message.content])).toEqual([
        ['user', 'First'],
        ['assistant', 'First reply.'],
        ['user', 'Second'],
      ])
      expect(state.retainedDraft).toBe('Second')
      expect(state.sendState).toBe('ready')
      expect(state.sendError).toBeNull()
      expect(state.error).toBeNull()
      expect(JSON.stringify(state)).not.toContain('insufficient_credit:')
    })

    it('does not let a different failure borrow the credit banner', async () => {
      await open()
      sim.queueTurn(plainTurn('First reply.'))
      sim.queueTurn(failingTurn('the provider closed the connection'))
      store.send('First')
      await until(() => idle(store) && store.getState().messages.length >= 2)
      store.send('Second')
      await until(() => idle(store) && store.getState().sendState === 'error')
      expect(store.getState().composerNotice).toBeNull()
      expect(store.getState().sendError).toBe('the provider closed the connection')
    })

    it('gives a voice that cannot be priced its own line, and keeps the words', async () => {
      sim.invocation = () => ({ status: 422, body: { error: { code: 'model_unpriced', message: 'no price' } } })
      await open()
      store.send('Hello')
      await until(() => idle(store) && store.getState().composerNotice !== null)
      expect(store.getState().composerNotice).toEqual({
        id: 'billing-refusal',
        tone: 'warning',
        title: "This voice can't be priced right now, so Sophia won't run it. Pick another.",
      })
      expect(store.getState().retainedDraft).toBe('Hello')
      expect(store.getState().sendError).toBeNull()
    })

    it('says a provider outage is not about the balance, and offers no credits', async () => {
      sim.invocation = () => ({ status: 503, body: { error: { code: 'provider_unavailable', message: 'down' } } })
      await open()
      store.send('Hello')
      await until(() => idle(store) && store.getState().composerNotice !== null)
      const notice = store.getState().composerNotice!
      expect(notice.title).toBe('The model provider is unavailable. This is not about your balance. Try again shortly.')
      expect(notice.action).toBeUndefined()
      expect(notice.tone).toBe('warning')
      expect(store.getState().retainedDraft).toBe('Hello')
    })

    it('is gone when the person moves to another conversation', async () => {
      sim.invocation = () => ({ status: 402, body: { error: { code: 'insufficient_credit', message: '', balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 } } })
      await open()
      store.send('Hello')
      await until(() => idle(store) && store.getState().composerNotice !== null)
      const other = await store.service.createSession()
      store.setSession(other.id)
      await until(() => store.getState().conversationState === 'ready')
      expect(store.getState().composerNotice).toBeNull()
      expect(store.getState().retainedDraft).toBeNull()
    })
  })

  describe('the size limit', () => {
    it('says a chat that reached its size limit is over, in its own line, with a way to a new one', async () => {
      // `budget.exhausted` today is shown as "truncated": a reply cut short with no word about why.
      sim.queueTurn({
        answer: 'A long answer that was',
        stages: [[
          started(),
          delta('A long answer that was'),
          { type: 'budget.exhausted', value: { output: 'A long answer that was', turns: 24 } },
          turnDone(),
          completed('A long answer that was'),
        ]],
      })
      await open()
      store.send('Tell me everything')
      await until(() => idle(store) && store.getState().composerNotice !== null)
      const state = store.getState()
      expect(state.composerNotice).toEqual({
        id: 'budget-exhausted',
        tone: 'warning',
        title: 'This chat reached its size limit. Start a new chat.',
        action: { id: 'new-chat', label: 'New chat' },
      })
      expect(state.sendState).toBe('ready')
      expect(state.retainedDraft).toBeNull()
      expect(state.messages.at(-1)!.content).toBe('A long answer that was')
    })

    it('does not show the notice for a chat that ended in the ordinary way', async () => {
      sim.queueTurn(plainTurn('All done.'))
      await open()
      store.send('Hello')
      await until(() => idle(store) && store.getState().messages.length >= 2)
      expect(store.getState().composerNotice).toBeNull()
    })
  })

  describe('the chip beside each reply', () => {
    it('carries what the reply settled at, and only that reply’s', async () => {
      sim.queueTurn(costedTurn('First.', 848))
      sim.queueTurn(costedTurn('Second.', 1_200))
      await open()
      store.send('One')
      await until(() => idle(store) && store.getState().messages.length >= 2)
      store.send('Two')
      await until(() => idle(store) && store.getState().messages.length >= 4)
      expect(store.getState().messages.map(message => message.costMicroUsd)).toEqual([undefined, 848, undefined, 1_200])
    })

    it('keeps it when the conversation is loaded again', async () => {
      sim.queueTurn(costedTurn('First.', 848))
      await open()
      store.send('One')
      await until(() => idle(store) && store.getState().messages.length >= 2)
      const id = store.getState().sessionId!
      store.setSession(id)
      await until(() => store.getState().conversationState === 'ready' && store.getState().messages.length >= 2)
      expect(store.getState().messages.at(-1)!.costMicroUsd).toBe(848)
    })
  })
})

describe('a service that cannot say what an account holds (the local control)', () => {
  it('has no line and no notice, and offers no footnote', async () => {
    const service = makeLocalChatService()
    const created = await service.createSession({ title: 't' })
    const store = createChatServiceStore(service)
    store.setSession(created.id)
    await until(() => store.getState().conversationState === 'ready')
    expect(store.getState().accountNote).toBeNull()
    expect(store.getState().composerNotice).toBeNull()
    expect(store.getState().voiceFootnote ?? null).toBeNull()
    store.dispose()
  })
})
