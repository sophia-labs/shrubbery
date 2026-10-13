/**
 * The hosted chat where credits meet a conversation, against a scripted Choreograph
 * and gateway over a real socket (NO MOCKS).
 *
 * The refusal codes and the ledger events below are the billing design's contract
 * (`E-billing-enforce.md` 4.1 and 4.5.2) and what the live host wrote for the probe's
 * two turns (F-step-zero): a coded envelope on the 402, `budget.ledger_updated` events
 * whose fields ride the payload, a settle before `message.completed`.
 *
 * Defects guarded: a refusal for credit that leaves the conversation "still starting";
 * a refused follow-up parked as an unreconciled command; a raw `insufficient_credit:`
 * string on the screen; a cost added to the wrong reply, or lost on reload; a provider
 * outage blamed on the workspace.
 */
import type { ChatEvent, ChatMessage } from '@shrubbery/chat-kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChatBillingFailure, ChatServiceFailure, type ChatService } from '../chat-service.js'
import { makeHostedChatService } from '../hosted-chat-service.js'
import {
  ChoreographSim,
  DOMAIN_WORKFLOW,
  costedTurn,
  delta,
  failingTurn,
  plainTurn,
  reserved,
  settled,
  started,
  toolCompleted,
  toolStarted,
  turnDone,
  turnFailed,
  completed,
  workspaceWorkflow,
  type Received,
} from './fixtures/choreograph-sim.js'
import { CONVERSATION_ID, MemoryArchive, REVISION_ID, turn } from './fixtures/memory-archive.js'
import { SobremesaRoutes, premiumVoiceRow, voiceCatalogue } from './fixtures/sobremesa-routes.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const GRAPH = 'atelier-20260929'
const KIMI = 'moonshotai/kimi-k2.6'
const PRO = 'openai/gpt-5.4-pro'
const T0 = Date.UTC(2026, 0, 5, 12, 0)

const OUT_OF_CREDITS = (balanceMicroUsd: number, requiredMicroUsd: number) => ({
  error: {
    code: 'insufficient_credit',
    message: "You're out of credits.",
    balanceMicroUsd,
    requiredMicroUsd,
  },
})

async function collect(handle: Awaited<ReturnType<ChatService['startTurn']>>) {
  const events: ChatEvent[] = []
  for await (const item of handle.events) events.push(item)
  return { events, outcome: await handle.done }
}

async function refusal(promise: Promise<unknown>): Promise<ChatBillingFailure> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ChatBillingFailure)
    return error as ChatBillingFailure
  }
  throw new Error('expected the turn to be refused, and it was not')
}

describe('credits in the hosted chat', () => {
  let sim: ChoreographSim
  let routes: SobremesaRoutes
  let chat: ChatService

  function open(options: { premium?: boolean; archive?: MemoryArchive } = {}): ChatService {
    if (options.premium) routes.catalogue = { models: [...voiceCatalogue(), premiumVoiceRow()] }
    return makeHostedChatService({
      ...(options.archive ? { archive: options.archive } : {}),
      gatewayBaseUrl: sim.base,
      graphBaseUrl: (graph: string) => sim.graphBase(graph),
      graphId: () => GRAPH,
      userId: () => 'probe',
      token: () => 'jwt',
      storage: new MemoryStorage(),
      resolveAttempts: 3,
      resolveDelayMs: 0,
      sleep: async () => undefined,
    })
  }

  beforeEach(async () => {
    sim = new ChoreographSim()
    routes = new SobremesaRoutes(sim)
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true })]
    await sim.start()
    chat = open()
    await chat.probeCapabilities!()
  })
  afterEach(async () => sim.stop())

  describe('a first message the gateway refuses for credit (402)', () => {
    it('is a typed refusal that carries what the gateway said of the balance and of the need', async () => {
      sim.invocation = () => ({ status: 402, body: OUT_OF_CREDITS(30_000, 93_600) })
      const created = await chat.createSession()
      const failure = await refusal(chat.startTurn(created.id, 'Hello'))
      expect(failure.billing).toEqual({ kind: 'insufficient_credit', balanceMicroUsd: 30_000, requiredMicroUsd: 93_600 })
      expect(failure).toBeInstanceOf(ChatServiceFailure)
      expect(failure.phase).toBe('submit')
      // Nothing was accepted, so there is nothing to reconcile and nothing to check.
      expect(failure.recovery).toBe('none')
      // The words a place that only shows a message would show; no raw code.
      expect(failure.message).toBe("You're out of credits. Your message is saved. Add credits to continue.")
    })

    it('does not leave the conversation half-started: the same conversation sends once credit is there', async () => {
      // Defect avoided: `invocationPending` left set turns the next send into "the first
      // message may still be starting and cannot be confirmed yet".
      let refuse = true
      sim.invocation = () => (refuse ? { status: 402, body: OUT_OF_CREDITS(3_800, 6_168) } : undefined)
      const created = await chat.createSession()
      await refusal(chat.startTurn(created.id, 'Hello'))
      expect(sim.sessions.size).toBe(0)

      refuse = false
      const turn = await collect(await chat.startTurn(created.id, 'Hello'))
      expect(turn.outcome).toEqual({ state: 'completed' })
      expect(sim.sessions.size).toBe(1)
    })

    it('is a refusal for credit even when the body names no numbers, or is not the coded envelope', async () => {
      sim.invocation = () => ({ status: 402, body: { error: 'insufficient credit' } })
      const created = await chat.createSession()
      const failure = await refusal(chat.startTurn(created.id, 'Hello'))
      expect(failure.billing).toEqual({ kind: 'insufficient_credit', balanceMicroUsd: null, requiredMicroUsd: null })
    })

    it('does not fall back to the workspace assistant: a refusal for credit is the answer, not a missing Domain Agent', async () => {
      sim.provisioned.add(GRAPH)
      sim.invocation = () => ({ status: 402, body: OUT_OF_CREDITS(3_800, 6_168) })
      const created = await chat.createSession()
      await refusal(chat.startTurn(created.id, 'Hello'))
      expect(sim.invocations()).toHaveLength(1)
    })

    it('refuses a voice that cannot be priced in its own words (422), and a provider that is down (503)', async () => {
      const created = await chat.createSession()
      sim.invocation = () => ({ status: 422, body: { error: { code: 'model_unpriced', message: 'no price for this model' } } })
      expect((await refusal(chat.startTurn(created.id, 'Hello'))).billing.kind).toBe('model_unpriced')

      sim.invocation = () => ({ status: 503, body: { error: { code: 'provider_unavailable', message: 'OpenRouter is down' } } })
      const down = await refusal(chat.startTurn(created.id, 'Hello'))
      expect(down.billing.kind).toBe('provider_unavailable')
      // Defect avoided: the generic `_unavailable` line blamed the workspace for waking up.
      expect(down.message).toBe('The model provider is unavailable. This is not about your balance. Try again shortly.')
      expect(down.message).not.toMatch(/workspace/i)
    })

    it('keeps a picked-up conversation a picked-up conversation after a refusal: the same first message goes, with its window, once credit is there', async () => {
      // Defect guarded: a rejected launch unpinned the conversation from the workspace assistant, the
      // retry chose the Domain Agent, and every later attempt was refused as "cannot pick up an earlier
      // conversation" for a conversation that was picked up a minute ago.
      const archive = new MemoryArchive([
        turn(0, 'user', 'What is a monad?', { at: T0 }),
        turn(1, 'assistant', 'A monad is a design pattern.', { at: T0 + 30_000 }),
      ])
      chat = open({ archive })
      await chat.probeCapabilities!()
      const plan = await chat.prepareContinuation!({
        conversationId: CONVERSATION_ID,
        revisionId: REVISION_ID,
        title: archive.title,
        messagesLoaded: 2,
      })
      const opened = await chat.continueConversation!(plan, { modelId: KIMI })

      let refuse = true
      sim.invocation = () => (refuse ? { status: 402, body: OUT_OF_CREDITS(3_800, 12_748) } : undefined)
      await refusal(chat.startTurn(opened.id, 'So where were we?'))

      refuse = false
      const resumed = await collect(await chat.startTurn(opened.id, 'So where were we?'))
      expect(resumed.outcome).toEqual({ state: 'completed' })
      const launched = sim.invocations().at(-1)!.body
      expect(launched.target.workflowName).toBe('workspace-chat-v1')
      expect(launched.input.seed).toBeDefined()
      expect(launched.input.inference).toEqual({ provider: 'openrouter', model: KIMI })
    })

    it('leaves every other refusal as it was', async () => {
      const created = await chat.createSession()
      sim.invocation = () => ({ status: 503, body: { error: { code: 'workspace_unavailable', message: 'waking up' } } })
      try {
        await chat.startTurn(created.id, 'Hello')
        throw new Error('expected a refusal')
      } catch (error) {
        expect(error).toBeInstanceOf(ChatServiceFailure)
        expect(error).not.toBeInstanceOf(ChatBillingFailure)
        expect((error as ChatServiceFailure).recovery).toBe('resubmit')
      }
    })
  })

  describe('a follow-up the gateway refuses for credit (402)', () => {
    let refuseCommands = false
    const refusalBody = OUT_OF_CREDITS(30_000, 93_600)

    beforeEach(() => {
      refuseCommands = false
      sim.extraRoutes.push((request: Received) =>
        refuseCommands && request.method === 'POST' && request.route.endsWith('/commands')
          ? { status: 402, body: refusalBody }
          : undefined)
    })

    it('is the same typed refusal, not "check the status"', async () => {
      const created = await chat.createSession()
      await collect(await chat.startTurn(created.id, 'First'))
      refuseCommands = true
      const failure = await refusal(chat.startTurn(created.id, 'Second'))
      expect(failure.billing).toMatchObject({ kind: 'insufficient_credit', balanceMicroUsd: 30_000, requiredMicroUsd: 93_600 })
      // Defect guarded (E-billing 4.5.2): a refused follow-up was handed to `reconcile`.
      expect(failure.recovery).toBe('none')
      expect(failure.phase).toBe('submit')
    })

    it('parks nothing: after a top-up the very same message is sent as a fresh follow-up', async () => {
      const created = await chat.createSession()
      await collect(await chat.startTurn(created.id, 'First'))
      refuseCommands = true
      await refusal(chat.startTurn(created.id, 'Second'))
      expect(sim.session().commands.filter(command => command.name === 'follow_up')).toHaveLength(0)

      refuseCommands = false
      const retried = await collect(await chat.startTurn(created.id, 'Second'))
      expect(retried.outcome).toEqual({ state: 'completed' })
      expect(sim.session().commands.filter(command => command.name === 'follow_up')).toHaveLength(1)
    })

    it('does not show the refused message in the conversation it never joined', async () => {
      const created = await chat.createSession()
      await collect(await chat.startTurn(created.id, 'First'))
      refuseCommands = true
      await refusal(chat.startTurn(created.id, 'Second'))
      const { messages } = await chat.hydrateSession(created.id)
      expect(messages.map(message => message.content)).not.toContain('Second')
    })
  })

  describe('a call the host refuses in the middle of the run (turn.failed insufficient_credit:)', () => {
    async function twoTurnsThenFailing(message: string) {
      sim.queueTurn(plainTurn('First reply.'))
      sim.queueTurn(failingTurn(message))
      const created = await chat.createSession()
      await collect(await chat.startTurn(created.id, 'First'))
      return { created, second: await collect(await chat.startTurn(created.id, 'Second')) }
    }

    it('ends the turn with the typed refusal, and puts no raw error text in the conversation', async () => {
      const { second } = await twoTurnsThenFailing('insufficient_credit: balance 30000 is below the 93600 this call needs')
      expect(second.outcome.state).toBe('failed')
      const failure = (second.outcome as { state: 'failed'; failure: ChatServiceFailure }).failure
      expect(failure).toBeInstanceOf(ChatBillingFailure)
      expect((failure as ChatBillingFailure).billing.kind).toBe('insufficient_credit')
      expect(failure.recovery).toBe('none')
      // Defect avoided: the raw string reaching the bubble as an error.
      expect(second.events.filter(event => event.type === 'error')).toEqual([])
      expect(JSON.stringify(second.events)).not.toContain('insufficient_credit:')
      expect(failure.message).not.toContain('insufficient_credit:')
    })

    it('still says it as the banner when the stream closed before the host said why: the command row failed first, the reason arrives after', async () => {
      // Defect guarded: the session and the command ledger were read before what was still durable in
      // the event log, so a refusal for credit surfaced as "Agent Session command failed: failed".
      sim.queueTurn(plainTurn('First reply.'))
      sim.queueTurn({
        answer: '',
        fails: true,
        stages: [
          [started(), reserved()],
          [turnFailed('insufficient_credit: balance 3800 is below the 6168 this call needs')],
        ],
      })
      const created = await chat.createSession()
      await collect(await chat.startTurn(created.id, 'First'))
      const second = await collect(await chat.startTurn(created.id, 'Second'))

      expect(second.outcome.state).toBe('failed')
      const failure = (second.outcome as { state: 'failed'; failure: ChatServiceFailure }).failure
      expect(failure).toBeInstanceOf(ChatBillingFailure)
      expect(second.events.filter(event => event.type === 'error')).toEqual([])
      expect(JSON.stringify(second.events)).not.toContain('insufficient_credit:')
      expect(failure.message).not.toContain('Agent Session command')
    })

    it('keeps a turn that failed for any other reason an ordinary failure, error text and all', async () => {
      const { second } = await twoTurnsThenFailing('the provider closed the connection')
      expect(second.outcome.state).toBe('failed')
      const failure = (second.outcome as { state: 'failed'; failure: ChatServiceFailure }).failure
      expect(failure).not.toBeInstanceOf(ChatBillingFailure)
      expect(second.events.filter(event => event.type === 'error')).toEqual([
        { type: 'error', message: 'the provider closed the connection' },
      ])
    })

    it('does not treat a message that merely mentions the code as one', async () => {
      const { second } = await twoTurnsThenFailing('agent failed: insufficient_credit: nope')
      const failure = (second.outcome as { state: 'failed'; failure: ChatServiceFailure }).failure
      expect(failure).not.toBeInstanceOf(ChatBillingFailure)
    })
  })

  describe('what each reply cost, from the settled ledger event', () => {
    const costs = (events: readonly ChatEvent[]) =>
      events.flatMap(event => (event.type === 'cost' ? [event.microUsd] : []))

    it('emits the settled cost once, before the reply ends, and nothing for the reservation', async () => {
      sim.queueTurn(costedTurn('Hello there.', 848))
      const created = await chat.createSession()
      const { events } = await collect(await chat.startTurn(created.id, 'Hi'))
      expect(costs(events)).toEqual([848])
      // The reservation ($0.097 at a worst case) is not what the reply cost.
      expect(JSON.stringify(events)).not.toContain('97441')
      const settledAt = events.findIndex(event => event.type === 'cost')
      const doneAt = events.findIndex(event => event.type === 'done')
      expect(settledAt).toBeGreaterThan(-1)
      expect(settledAt).toBeLessThan(doneAt)
    })

    it('emits one for each model call behind a reply that used a tool', async () => {
      sim.queueTurn({
        answer: 'Found it.',
        stages: [
          [started(), reserved(), settled(500), toolStarted('search_documents')],
          [toolCompleted('search_documents', 'ok'), reserved(), delta('Found it.'), settled(300), turnDone(), completed('Found it.')],
        ],
      })
      const created = await chat.createSession()
      const { events } = await collect(await chat.startTurn(created.id, 'Find it'))
      expect(costs(events)).toEqual([500, 300])
    })

    it('says nothing for a reply whose ledger settled at nothing, or has no ledger at all', async () => {
      sim.queueTurn(costedTurn('Free.', 0))
      sim.queueTurn(plainTurn('No ledger.'))
      const created = await chat.createSession()
      expect(costs((await collect(await chat.startTurn(created.id, 'One'))).events)).toEqual([])
      expect(costs((await collect(await chat.startTurn(created.id, 'Two'))).events)).toEqual([])
    })

    it('reads a follow-up’s cost the same way', async () => {
      sim.queueTurn(costedTurn('First.', 848))
      sim.queueTurn(costedTurn('Second.', 800))
      const created = await chat.createSession()
      await collect(await chat.startTurn(created.id, 'One'))
      const second = await collect(await chat.startTurn(created.id, 'Two'))
      expect(costs(second.events)).toEqual([800])
    })
  })

  describe('a reloaded conversation keeps what each reply cost', () => {
    const replies = (messages: readonly ChatMessage[]) =>
      messages.filter(message => message.role === 'assistant').map(message => [message.content, message.costMicroUsd])

    it('attaches each turn’s settled cost to the reply of that turn, by the turn’s own command', async () => {
      sim.queueTurn(costedTurn('First.', 848))
      sim.queueTurn(costedTurn('Second.', 800))
      sim.queueTurn(costedTurn('Third.', 1_200))
      const created = await chat.createSession()
      for (const text of ['One', 'Two', 'Three']) await collect(await chat.startTurn(created.id, text))

      const { messages } = await chat.hydrateSession(created.id)
      expect(replies(messages)).toEqual([['First.', 848], ['Second.', 800], ['Third.', 1_200]])
    })

    it('adds up the calls behind a reply that used a tool', async () => {
      sim.queueTurn({
        answer: 'Found it.',
        stages: [[started(), reserved(), settled(500), toolStarted('search_documents'),
          toolCompleted('search_documents', 'ok'), reserved(), delta('Found it.'), settled(300), turnDone(), completed('Found it.')]],
      })
      const created = await chat.createSession()
      await collect(await chat.startTurn(created.id, 'Find it'))
      const { messages } = await chat.hydrateSession(created.id)
      expect(replies(messages)).toEqual([['Found it.', 800]])
    })

    it('gives no chip to a reply the ledger said nothing about, and never moves a cost onto another reply', async () => {
      sim.queueTurn(plainTurn('First, unmetered.'))
      sim.queueTurn(costedTurn('Second.', 800))
      const created = await chat.createSession()
      await collect(await chat.startTurn(created.id, 'One'))
      await collect(await chat.startTurn(created.id, 'Two'))
      const { messages } = await chat.hydrateSession(created.id)
      expect(replies(messages)).toEqual([['First, unmetered.', undefined], ['Second.', 800]])
    })

    it('keeps each reply’s chip where the ledger also holds commands that are not follow-ups', async () => {
      // A quiesce or an abort between turns is a command too, and must not shift the costs.
      sim.queueTurn(costedTurn('First.', 848))
      sim.queueTurn(costedTurn('Second.', 800))
      const created = await chat.createSession()
      await collect(await chat.startTurn(created.id, 'One'))
      // As the live ledger has it between turns (F-step-zero, seq 12 to 17): the runtime's own command.
      const session = sim.session()
      session.append('command.accepted', undefined, { commandId: `runtime.quiesce:${session.id}:0` })
      session.append('command.completed', undefined, { commandId: `runtime.quiesce:${session.id}:0` })
      await collect(await chat.startTurn(created.id, 'Two'))
      const { messages } = await chat.hydrateSession(created.id)
      expect(replies(messages)).toEqual([['First.', 848], ['Second.', 800]])
    })
  })

  describe('the voices, told what they cost', () => {
    it('gives the picker a multiple of House and flags a premium voice, with House as the measure', async () => {
      chat = open({ premium: true })
      await chat.probeCapabilities!()
      const roster = chat.models()
      const house = roster.find(model => model.house)!
      const kimi = roster.find(model => model.id === KIMI)!
      const pro = roster.find(model => model.id === PRO)!
      expect(house.multipleOfHouse).toBeUndefined()
      expect(kimi.multipleOfHouse).toBeCloseTo(2_648 / 1_500, 3)
      expect(kimi.premium).toBeUndefined()
      expect(pro.premium).toBe(true)
      expect(pro.premiumNote).toBe('A short reply costs about $0.15, roughly 86× House.')
    })
  })
})
