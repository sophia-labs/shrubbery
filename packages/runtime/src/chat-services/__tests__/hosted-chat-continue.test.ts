/**
 * "Continue with…" through the hosted chat service: a real in-memory archive paged as
 * the gateway pages it, a scripted Choreograph and gateway over a real socket, the real
 * service and its real browser-shaped storage (NO MOCKS).
 *
 * What is held to: nothing leaves the browser until the person sends their first
 * message; then exactly the window that was shown is what is sent, to the seed store,
 * and only its digest travels with the launch; the conversation is refused, visibly
 * and before anything is sent, wherever the host cannot carry a seed; the old turns
 * keep their own voice, and the seam says what the host really resolved. The seed
 * store's route and receipt are ASSUMED (`sobremesa-contract.ts`); so is the fixture.
 */
import type { ChatEvent } from '@shrubbery/chat-kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChatServiceFailure } from '../chat-service.js'
import { ContinuationError, seedPayloadFor, type ContinuationPlan } from '../continuation.js'
import { makeHostedChatService } from '../hosted-chat-service.js'
import { CHAT_SEEDS_PATH } from '../sobremesa-contract.js'
import { ChoreographSim, DOMAIN_WORKFLOW, workspaceWorkflow } from './fixtures/choreograph-sim.js'
import {
  alternating,
  CONVERSATION_ID,
  MemoryArchive,
  REVISION_ID,
  turn,
  type FixtureMessage,
} from './fixtures/memory-archive.js'
import { recordingFetch } from './fixtures/recording-fetch.js'
import { SobremesaRoutes } from './fixtures/sobremesa-routes.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const GRAPH = 'atelier-20260929'
const HOUSE = 'google/gemini-2.5-flash'
const KIMI_K25 = 'moonshotai/kimi-k2.5'
const KIMI_K26 = 'moonshotai/kimi-k2.6'
const T0 = Date.UTC(2026, 0, 5, 12, 0)

/** A short conversation that ended on an old Kimi. */
function oldChat(): FixtureMessage[] {
  const kimi = { id: KIMI_K25, provider: 'opencode' }
  return [
    turn(0, 'user', 'What is a monad?', { at: T0 }),
    turn(1, 'assistant', 'A monad is a design pattern.', { at: T0 + 30_000, voice: kimi }),
    turn(2, 'user', 'And a functor?', { at: T0 + 60_000 }),
    turn(3, 'assistant', 'Something that maps.', { at: T0 + 90_000, voice: kimi }),
  ]
}

function intentFor(archive: MemoryArchive) {
  return { conversationId: CONVERSATION_ID, revisionId: REVISION_ID, title: archive.title, messagesLoaded: 50 }
}

async function collect(handle: Awaited<ReturnType<ReturnType<typeof chatOver>['startTurn']>>) {
  const events: ChatEvent[] = []
  for await (const item of handle.events) events.push(item)
  return { events, outcome: await handle.done }
}

function chatOver(
  sim: ChoreographSim,
  archive: MemoryArchive,
  options: {
    storage?: MemoryStorage
    windowLimits?: { maxBytes: number; maxMessageChars: number }
    fetchImpl?: typeof fetch
  } = {},
) {
  return makeHostedChatService({
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    gatewayBaseUrl: sim.base,
    graphBaseUrl: (graph: string) => sim.graphBase(graph),
    graphId: () => GRAPH,
    userId: () => 'probe',
    token: () => 'jwt',
    storage: options.storage ?? new MemoryStorage(),
    archive,
    ...(options.windowLimits ? { windowLimits: options.windowLimits } : {}),
    resolveAttempts: 3,
    resolveDelayMs: 0,
    sleep: async () => undefined,
  })
}

const workspaceInvocations = (sim: ChoreographSim) =>
  sim.invocations().filter(call => call.body.target.workflowName === 'workspace-chat-v1')

describe('continuing an imported conversation', () => {
  let sim: ChoreographSim
  let routes: SobremesaRoutes
  let archive: MemoryArchive
  beforeEach(async () => {
    sim = new ChoreographSim()
    routes = new SobremesaRoutes(sim)
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true })]
    archive = new MemoryArchive(oldChat())
    await sim.start()
  })
  afterEach(async () => sim.stop())

  async function begin(chat = chatOver(sim, archive)): Promise<{ chat: typeof chat; plan: ContinuationPlan }> {
    await chat.probeCapabilities!()
    const plan = await chat.prepareContinuation!(intentFor(archive))
    return { chat, plan }
  }

  describe('reading the window', () => {
    it('reads it with the person’s own archive access and sends nothing anywhere', async () => {
      const { plan } = await begin()
      expect(plan.window.messages.map(message => message.text)).toEqual([
        'What is a monad?',
        'A monad is a design pattern.',
        'And a functor?',
        'Something that maps.',
      ])
      expect(plan.window.total).toBe(4)
      expect(plan.window.omitted).toBe(0)
      expect(archive.reads.length).toBeGreaterThan(0)
      expect(routes.seeds).toEqual([])
      expect(sim.invocations()).toEqual([])
      expect(sim.received.filter(item => item.method === 'POST')).toEqual([])
    })

    it('names the source’s models from today’s catalogue and keeps the source’s own record of them', async () => {
      const { plan } = await begin()
      const assistant = plan.window.messages.filter(message => message.role === 'assistant')
      expect(assistant.every(message => message.voice?.basis === 'source-recorded')).toBe(true)
      expect(assistant[0].voice).toMatchObject({ id: KIMI_K25, label: 'Kimi K2.5' })
      expect(plan.sourceVoices).toEqual([{ id: KIMI_K25, provider: 'opencode' }])
    })

    it('is refused, before the archive is read, when the host cannot carry a seed', async () => {
      sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true })]
      const chat = chatOver(sim, archive)
      const failure = await chat.prepareContinuation!(intentFor(archive)).catch(error => error)
      expect(failure).toBeInstanceOf(ContinuationError)
      expect(failure).toMatchObject({ code: 'unsupported' })
      expect(failure.message).toMatch(/Nothing was sent/)
      expect(archive.reads).toEqual([])
    })

    it('is refused when there is no archive to read at all', async () => {
      const chat = makeHostedChatService({
        graphBaseUrl: (graph: string) => sim.graphBase(graph),
        graphId: () => GRAPH,
        userId: () => 'probe',
        token: () => 'jwt',
        storage: new MemoryStorage(),
      })
      await chat.probeCapabilities!()
      await expect(chat.prepareContinuation!(intentFor(archive))).rejects.toMatchObject({ code: 'unsupported' })
    })

    it('reports an archive that cannot be read as such, and creates nothing', async () => {
      const broken = new MemoryArchive(oldChat(), { failAtCursor: 0 })
      const chat = chatOver(sim, broken)
      await chat.probeCapabilities!()
      await expect(chat.prepareContinuation!(intentFor(broken))).rejects.toMatchObject({ code: 'archive-unavailable' })
      expect(await chat.listSessions()).toEqual([])
    })
  })

  describe('opening the conversation', () => {
    it('is refused, visibly and with no conversation made, when the host cannot carry a seed', async () => {
      const { chat, plan } = await begin()
      sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true })]
      const stale = chatOver(sim, archive)
      const failure = await stale.continueConversation!(plan, { modelId: KIMI_K26 }).catch(error => error)
      expect(failure).toBeInstanceOf(ContinuationError)
      expect(failure).toMatchObject({ code: 'unsupported' })
      expect(await stale.listSessions()).toEqual([])
      expect(await chat.listSessions()).toEqual([])
    })

    it('refuses a voice that is not on offer, and makes nothing', async () => {
      const { chat, plan } = await begin()
      const failure = await chat.continueConversation!(plan, { modelId: 'nobody/nothing' }).catch(error => error)
      expect(failure).toBeInstanceOf(ContinuationError)
      expect(failure).toMatchObject({ code: 'voice-unavailable' })
      expect(await chat.listSessions()).toEqual([])
    })

    describe('while no catalogue of voices is on offer (the registry advertises `inference`, the catalogue is stale or will not load)', () => {
      // Defect guarded: the chooser has nothing to choose from and says "This workspace’s own voice will pick it up.",
      // and Confirm sends no voice at all; the service read that as "a voice that is not on offer" and refused, so the
      // person was told one thing and then refused another. This is not a corner: the live catalogue answered HTTP 200
      // with `stale: true` at 16:54 on 2026-10-01, after answering fresh at 16:21, and the voices release treats a stale
      // catalogue as none.
      it('continues with the House default the host runs when it is not told, and says so at the seam', async () => {
        routes.catalogueOptions = { stale: true }
        const { chat, plan } = await begin()
        expect(chat.models()).toEqual([])
        const opened = await chat.continueConversation!(plan, { modelId: '' })
        expect(opened.title).toBe('Monads, again · continued')
        expect(chat.sessionSeam!(opened.id)).toMatchObject({
          voiceLabel: 'House default',
          providerNotice: 'Continuing sends this conversation to OpenRouter and the model provider behind it.',
        })
        // Nothing has left the browser yet, as in every continued chat.
        expect(routes.seeds).toEqual([])
        expect(sim.invocations()).toEqual([])
      })

      it('then launches with the seed and no voice, exactly as an ordinary first message would', async () => {
        routes.catalogueOptions = { stale: true }
        const { chat, plan } = await begin()
        const opened = await chat.continueConversation!(plan, { modelId: '' })
        await collect(await chat.startTurn(opened.id, 'So where were we?'))
        expect(routes.seeds).toHaveLength(1)
        const [launch] = workspaceInvocations(sim)
        expect(launch.body.input.seed).toMatchObject({ window: { kept: 4, omitted: 0, total: 4 }, title: 'Monads, again · continued' })
        expect(launch.body.input.inference).toBeUndefined()
        expect(routes.admitted).toHaveLength(1)
      })

      it('still refuses a voice that was named and cannot be checked, and makes nothing', async () => {
        routes.catalogueOptions = { stale: true }
        const { chat, plan } = await begin()
        const failure = await chat.continueConversation!(plan, { modelId: KIMI_K26 }).catch(error => error)
        expect(failure).toBeInstanceOf(ContinuationError)
        expect(failure).toMatchObject({ code: 'voice-unavailable' })
        expect(await chat.listSessions()).toEqual([])
      })

      it('does not read "no choice" as the House default when there ARE voices on offer (a blank choice is refused)', async () => {
        const { chat, plan } = await begin()
        expect(chat.models().length).toBeGreaterThan(0)
        const failure = await chat.continueConversation!(plan, { modelId: '' }).catch(error => error)
        expect(failure).toBeInstanceOf(ContinuationError)
        expect(failure).toMatchObject({ code: 'voice-unavailable' })
        expect(await chat.listSessions()).toEqual([])
      })
    })

    it('opens a conversation titled "{old title} · continued", showing the window, and sends nothing yet', async () => {
      const { chat, plan } = await begin()
      const before = Date.now()
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      expect(opened.title).toBe('Monads, again · continued')

      const hydrated = await chat.hydrateSession(opened.id)
      expect(hydrated.messages.map(message => [message.role, message.content, message.origin])).toEqual([
        ['user', 'What is a monad?', 'window'],
        ['assistant', 'A monad is a design pattern.', 'window'],
        ['user', 'And a functor?', 'window'],
        ['assistant', 'Something that maps.', 'window'],
      ])
      // The old turns keep their own dates and their own voice.
      expect(hydrated.messages.map(message => message.createdAt)).toEqual([T0, T0 + 30_000, T0 + 60_000, T0 + 90_000])
      expect(hydrated.messages[1].voice).toMatchObject({ id: KIMI_K25, label: 'Kimi K2.5', basis: 'source-recorded' })
      expect(hydrated.messages[0].voice).toBeUndefined()

      // Nothing has left the browser.
      expect(routes.seeds).toEqual([])
      expect(sim.invocations()).toEqual([])
      expect(sim.received.filter(item => item.method === 'POST')).toEqual([])

      // The seam is ready, dated now, naming the new voice and where the window goes.
      const seam = chat.sessionSeam!(opened.id)!
      expect(seam).toMatchObject({
        omittedCount: 0,
        originalTitle: 'Monads, again',
        voiceLabel: 'Kimi K2.6',
        providerNotice: 'Continuing sends this conversation to Moonshot through OpenRouter.',
      })
      expect(Date.parse(seam.pickedUpAt)).toBeGreaterThanOrEqual(before)
      expect(chat.sessionModelId!(opened.id)).toBe(KIMI_K26)
    })

    it('is a conversation nobody else has: no seam on an ordinary one', async () => {
      const { chat } = await begin()
      const plain = await chat.createSession()
      expect(chat.sessionSeam!(plain.id)).toBeNull()
    })

    it('fixes the voice at the seam: it cannot be changed before the first message', async () => {
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      expect(() => chat.setSessionModel!(opened.id, KIMI_K25)).toThrow(ChatServiceFailure)
      expect(chat.sessionModelId!(opened.id)).toBe(KIMI_K26)
    })

    it('counts what the window left out', async () => {
      const long = new MemoryArchive(alternating(300, 200))
      const chat = chatOver(sim, long, { windowLimits: { maxBytes: 30_000, maxMessageChars: 4_000 } })
      await chat.probeCapabilities!()
      const plan = await chat.prepareContinuation!(intentFor(long))
      const opened = await chat.continueConversation!(plan, { modelId: HOUSE })
      expect(plan.window.omitted).toBeGreaterThan(100)
      expect(chat.sessionSeam!(opened.id)!.omittedCount).toBe(plan.window.omitted)
      const shown = (await chat.hydrateSession(opened.id)).messages
      expect(shown).toHaveLength(plan.window.messages.length)
    })
  })

  describe('the first message', () => {
    it('sends exactly the window that was shown, to the seed store, then launches with its digest', async () => {
      const seen = recordingFetch()
      const { chat, plan } = await begin(chatOver(sim, archive, { fetchImpl: seen.fetchImpl }))
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      await collect(await chat.startTurn(opened.id, 'So where were we?'))

      // One seed, and it is the window: the same bytes the panel showed.
      expect(routes.seeds).toHaveLength(1)
      const [seed] = routes.seeds
      expect(seed.graph).toBe(GRAPH)
      // Sent with the person's own token (what the service built: happy-dom's fetch drops the header
      // before the socket, so the host cannot be asked).
      const posted = seen.to(`/g/${GRAPH}${CHAT_SEEDS_PATH}`, 'POST')
      expect(posted).toHaveLength(1)
      expect(posted[0].headers.get('authorization')).toBe('Bearer jwt')
      expect(posted[0].headers.get('content-type')).toBe('application/json')
      // The body is the live store's contract, spelled out here (not derived from the code under test):
      // `sophia.chat-seed.v1` and its messages with `occurredAt` and, where the source recorded one, `voice.model`.
      expect(seed.body).toEqual({
        schema: 'sophia.chat-seed.v1',
        messages: [
          { role: 'user', text: 'What is a monad?', occurredAt: new Date(T0).toISOString() },
          { role: 'assistant', text: 'A monad is a design pattern.', occurredAt: new Date(T0 + 30_000).toISOString(), voice: { model: KIMI_K25 } },
          { role: 'user', text: 'And a functor?', occurredAt: new Date(T0 + 60_000).toISOString() },
          { role: 'assistant', text: 'Something that maps.', occurredAt: new Date(T0 + 90_000).toISOString(), voice: { model: KIMI_K25 } },
        ],
      })
      expect(JSON.stringify(seed.body)).toBe(JSON.stringify(seedPayloadFor(plan)))
      const shown = (await chat.hydrateSession(opened.id)).messages.filter(message => message.origin === 'window')
      expect((seed.body as { messages: { text: string }[] }).messages.map(message => message.text))
        .toEqual(shown.map(message => message.content))

      // The launch carries the digest and the lineage, never the body; the voice; and no 404 first.
      expect(sim.invocations().map(call => call.body.target.workflowName)).toEqual(['workspace-chat-v1'])
      const [launch] = workspaceInvocations(sim)
      // The launch's `seed` is what the host admits and nothing else (it refuses an unknown key): the digest, the byte
      // count, where it came from, the window as counts (kept + omitted = total) and the title.
      expect(launch.body.input.seed).toEqual({
        seedDigest: seed.digest,
        bytes: seed.bytes,
        continuesConversation: { archiveConversationUrn: CONVERSATION_ID, revisionId: REVISION_ID },
        window: { kept: 4, omitted: 0, total: 4 },
        title: 'Monads, again · continued',
      })
      expect(launch.body.input.title).toBe('Monads, again · continued')
      expect(launch.body.input.inference).toEqual({ provider: 'openrouter', model: KIMI_K26 })
      expect(JSON.stringify(launch.body)).not.toContain('A monad is a design pattern.')
      // The seed reaches the store before the launch refers to it.
      const order = sim.received.filter(item => item.method === 'POST').map(item => item.route)
      expect(order.indexOf(CHAT_SEEDS_PATH)).toBeGreaterThanOrEqual(0)
      expect(order.indexOf(CHAT_SEEDS_PATH)).toBeLessThan(order.indexOf('/invocations'))
    })

    it('goes only to the workspace assistant: a Domain Agent would ignore the seed and answer a plain chat', async () => {
      sim.provisioned.add(GRAPH)
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      await collect(await chat.startTurn(opened.id, 'So where were we?'))
      expect(sim.invocations().map(call => call.body.target.workflowName)).toEqual(['workspace-chat-v1'])
    })

    it('sends the House default’s launch with the seed and no voice', async () => {
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: HOUSE })
      await collect(await chat.startTurn(opened.id, 'So where were we?'))
      const [launch] = workspaceInvocations(sim)
      expect(launch.body.input.seed).toBeDefined()
      expect(launch.body.input.inference).toBeUndefined()
    })

    it('is admitted by the host: the digest it names is held, the byte count and the window match', async () => {
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      await collect(await chat.startTurn(opened.id, 'So where were we?'))
      // The host's own checks (unknown keys, digest, bytes, kept messages) all passed: a run exists.
      expect(routes.admitted).toHaveLength(1)
      expect(routes.admitted[0]).toMatchObject({
        graph: GRAPH,
        window: { kept: 4, omitted: 0, total: 4 },
        continuesConversation: { archiveConversationUrn: CONVERSATION_ID, revisionId: REVISION_ID },
      })
      expect(routes.stored.has(routes.admitted[0].digest)).toBe(true)
      expect(sim.sessions.size).toBe(1)
    })

    it('is admitted by the host for a conversation of thousands of tiny messages: the store takes at most 2,000', async () => {
      // Defect guarded: a window cut by bytes alone kept all 3,000 one-word undated turns (about 84,000 bytes) and the
      // live store refused the seed (`seed_invalid`: between 1 and 2,000 messages), at the person's first message.
      const tiny = new MemoryArchive(Array.from({ length: 3_000 }, (_, index) => turn(index, index % 2 === 0 ? 'user' : 'assistant', 'ok')))
      const { chat, plan } = await begin(chatOver(sim, tiny))
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      const { outcome } = await collect(await chat.startTurn(opened.id, 'So where were we?'))
      expect(outcome).toBeDefined()
      expect(routes.seeds).toHaveLength(1)
      expect((routes.seeds[0].body as { messages: unknown[] }).messages).toHaveLength(2_000)
      expect(routes.admitted).toHaveLength(1)
      expect(routes.admitted[0].window).toEqual({ kept: 2_000, omitted: 1_000, total: 3_000 })
    })

    it('tells the continuing assistant when the old conversation was held and which model spoke in it', async () => {
      // Defect guarded: a seed that spells a date `at` or leaves the model out of `voice.model` is accepted by the
      // store and then read as a conversation held "at an unrecorded time" by a model that "was not recorded".
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      await collect(await chat.startTurn(opened.id, 'So where were we?'))
      const { briefing } = routes.admitted[0]
      expect(briefing.framing).toContain('held 2026-01-05\u20132026-01-05 in the old Garden and imported read-only')
      expect(briefing.framing).toContain(`Its model was recorded at the source as ${KIMI_K25}.`)
      expect(briefing.framing).toContain('0 of 4 messages were omitted from the middle to fit.')
      expect(briefing.headers).toEqual([
        '[message 1 of 4 \u00b7 user \u00b7 2026-01-05]',
        `[message 2 of 4 \u00b7 assistant \u00b7 2026-01-05 \u00b7 voice: ${KIMI_K25} (recorded at the source)]`,
        '[message 3 of 4 \u00b7 user \u00b7 2026-01-05]',
        `[message 4 of 4 \u00b7 assistant \u00b7 2026-01-05 \u00b7 voice: ${KIMI_K25} (recorded at the source)]`,
      ])
    })

    it('says a message with no recorded voice has none, and never names the voice chosen for the new chat as the old one', async () => {
      const bare = new MemoryArchive([
        turn(0, 'user', 'Hello.', { at: T0 }),
        turn(1, 'assistant', 'Hi.', { at: T0 + 1_000 }),
      ])
      const chat = chatOver(sim, bare)
      await chat.probeCapabilities!()
      const plan = await chat.prepareContinuation!(intentFor(bare))
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      await collect(await chat.startTurn(opened.id, 'Go on.'))
      const { briefing } = routes.admitted[0]
      expect(briefing.framing).toContain('Its model was not recorded.')
      expect(briefing.framing).not.toContain(KIMI_K26)
      expect(briefing.headers[1]).toBe('[message 2 of 2 \u00b7 assistant \u00b7 2026-01-05 \u00b7 voice: not recorded]')
    })

    it('tells the model how much was left out, counted the way the panel counts it', async () => {
      const long = new MemoryArchive(alternating(300, 200))
      const chat = chatOver(sim, long, { windowLimits: { maxBytes: 30_000, maxMessageChars: 4_000 } })
      await chat.probeCapabilities!()
      const plan = await chat.prepareContinuation!(intentFor(long))
      const opened = await chat.continueConversation!(plan, { modelId: HOUSE })
      await collect(await chat.startTurn(opened.id, 'Where were we?'))
      expect(plan.window.omitted).toBeGreaterThan(100)
      const [admitted] = routes.admitted
      expect(admitted.window).toEqual({ kept: plan.window.messages.length, omitted: plan.window.omitted, total: 300 })
      expect(admitted.briefing.framing).toContain(`${plan.window.omitted} of 300 messages were omitted from the middle to fit.`)
      expect(chat.sessionSeam!(opened.id)!.omittedCount).toBe(plan.window.omitted)
    })

    it('builds a window the host does not have to cut: what the model is shown is what the panel shows', async () => {
      // The host shows the model at most `seedRenderMaxChars` characters, header and quote marks included, and cuts the
      // middle of what is over (counting it to the model, not to the person). A window built under that number arrives whole.
      // Prose, code in short lines, quotes and accents: the shapes whose JSON size and rendered size differ most.
      const render = 40_000
      sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true, host: { limits: { seedRenderMaxChars: render } } })]
      const code = Array.from({ length: 60 }, (_, line) => `x${line} = "a" + 'b'`).join('\n')
      const mixed = Array.from({ length: 400 }, (_, index) =>
        turn(index, index % 2 === 0 ? 'user' : 'assistant', index % 3 === 0 ? `${code}\n${index}` : `\u00bfQu\u00e9 tal? "${index}" `.repeat(30), {
          at: T0 + index * 60_000,
          ...(index % 2 === 1 ? { voice: { id: KIMI_K25, provider: 'opencode' } } : {}),
        }))
      const long = new MemoryArchive(mixed)
      const chat = chatOver(sim, long)
      await chat.probeCapabilities!()
      const plan = await chat.prepareContinuation!(intentFor(long))
      expect(plan.window.omitted).toBeGreaterThan(0)
      const opened = await chat.continueConversation!(plan, { modelId: HOUSE })
      await collect(await chat.startTurn(opened.id, 'Where were we?'))
      const [admitted] = routes.admitted
      expect(admitted.renderedChars).toBeLessThanOrEqual(render)
      // And so the host dropped nothing of its own: the count it tells the model is the panel's.
      expect(admitted.window.omitted).toBe(plan.window.omitted)
      expect(admitted.briefing.framing).toContain(`${plan.window.omitted} of 400 messages were omitted from the middle to fit.`)
    })

    it('keeps an old title that is already near the limit inside the 200 characters the host takes', async () => {
      const long = new MemoryArchive(oldChat(), { title: `${'Long '.repeat(60)}title` })
      const chat = chatOver(sim, long)
      await chat.probeCapabilities!()
      const plan = await chat.prepareContinuation!(intentFor(long))
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      await collect(await chat.startTurn(opened.id, 'Go on.'))
      const [launch] = workspaceInvocations(sim)
      expect(Array.from(launch.body.input.title as string).length).toBeLessThanOrEqual(200)
      expect(launch.body.input.title).toMatch(/ · continued$/)
      expect(launch.body.input.seed.title).toBe(launch.body.input.title)
    })

    it('renders the window, then what the person said and the reply, in the voice that spoke', async () => {
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      await collect(await chat.startTurn(opened.id, 'So where were we?'))
      const messages = (await chat.hydrateSession(opened.id)).messages
      expect(messages.map(message => [message.role, message.origin ?? 'live'])).toEqual([
        ['user', 'window'],
        ['assistant', 'window'],
        ['user', 'window'],
        ['assistant', 'window'],
        ['user', 'live'],
        ['assistant', 'live'],
      ])
      expect(messages[4].content).toBe('So where were we?')
      // Old turns keep the source's mark; the new reply is marked with what the host resolved.
      expect(messages[1].voice).toMatchObject({ id: KIMI_K25, basis: 'source-recorded' })
      expect(messages[5].voice).toMatchObject({ id: KIMI_K26, basis: 'live' })
    })

    it('keeps its title: it is never named from the seed or from its first message', async () => {
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      await collect(await chat.startTurn(opened.id, 'So where were we?'))
      const row = (await chat.listConversations!()).find(item => item.id === opened.id)!
      expect(row.title).toBe('Monads, again · continued')
      expect((await chat.listSessions()).find(item => item.id === opened.id)!.title).toBe('Monads, again · continued')
    })

    it('records where it came from, for the list and for the person', async () => {
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      // Even before a word is said, a conversation with a window is a conversation.
      expect((await chat.listConversations!()).map(item => item.id)).toEqual([opened.id])
      await collect(await chat.startTurn(opened.id, 'So where were we?'))
      const row = (await chat.listConversations!()).find(item => item.id === opened.id)!
      expect(row.continuesConversation).toEqual({
        archiveConversationUrn: CONVERSATION_ID,
        revisionId: REVISION_ID,
        title: 'Monads, again',
      })
    })

    it('says which model the host really resolved when its allowlist declines the one asked for', async () => {
      sim.allowedModels = new Set([KIMI_K25])
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: 'moonshotai/kimi-k3' })
      expect(chat.sessionSeam!(opened.id)!.voiceLabel).toBe('Kimi K3')
      await collect(await chat.startTurn(opened.id, 'So where were we?'))
      const seam = chat.sessionSeam!(opened.id)!
      expect(seam.voiceLabel).toBe('Gemini 2.5 Flash')
      expect(seam.providerNotice).toBe('Continuing sends this conversation to Google through OpenRouter.')
    })

    it('keeps its window, its seam and its voice across a reload of the page', async () => {
      const storage = new MemoryStorage()
      const { chat, plan } = await begin(chatOver(sim, archive, { storage }))
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      await collect(await chat.startTurn(opened.id, 'So where were we?'))

      const reloaded = chatOver(sim, archive, { storage })
      const messages = (await reloaded.hydrateSession(opened.id)).messages
      expect(messages.filter(message => message.origin === 'window')).toHaveLength(4)
      expect(messages.at(-1)!.role).toBe('assistant')
      expect(reloaded.sessionSeam!(opened.id)).toMatchObject({
        originalTitle: 'Monads, again',
        pickedUpAt: chat.sessionSeam!(opened.id)!.pickedUpAt,
      })
    })

    it('shows the window before the first message even after a reload', async () => {
      const storage = new MemoryStorage()
      const { chat, plan } = await begin(chatOver(sim, archive, { storage }))
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      const reloaded = chatOver(sim, archive, { storage })
      const messages = (await reloaded.hydrateSession(opened.id)).messages
      expect(messages.map(message => message.origin)).toEqual(['window', 'window', 'window', 'window'])
    })

    it('does not keep the window once the conversation is deleted', async () => {
      const storage = new MemoryStorage()
      const { chat, plan } = await begin(chatOver(sim, archive, { storage }))
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      expect([...storage.values.keys()].some(key => key.includes('window'))).toBe(true)
      await chat.deleteSession(opened.id)
      expect([...storage.values.keys()].some(key => key.includes('window'))).toBe(false)
      expect([...storage.values.values()].some(value => value.includes('A monad is a design pattern.'))).toBe(false)
    })

    it('keeps the window out of the descriptor, which is rewritten at every step of a stream', async () => {
      const storage = new MemoryStorage()
      const { chat, plan } = await begin(chatOver(sim, archive, { storage }))
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      const descriptorKey = [...storage.values.keys()].find(key => key.includes(`descriptor:${opened.id}`))!
      expect(storage.values.get(descriptorKey)).not.toContain('A monad is a design pattern.')
    })

    it('bounds what is sent by the cap it was built under', async () => {
      const long = new MemoryArchive(alternating(300, 200))
      const chat = chatOver(sim, long, { windowLimits: { maxBytes: 20_000, maxMessageChars: 4_000 } })
      await chat.probeCapabilities!()
      const plan = await chat.prepareContinuation!(intentFor(long))
      const opened = await chat.continueConversation!(plan, { modelId: HOUSE })
      await collect(await chat.startTurn(opened.id, 'Where were we?'))
      expect(routes.seeds[0].bytes).toBeLessThanOrEqual(20_000)
    })
  })

  describe('when it cannot be sent', () => {
    it('is refused, before anything is sent, if the registry no longer advertises `seed`', async () => {
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      // A rollback of Choreograph between opening the conversation and the first message.
      sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true })]
      const failure = await chat.startTurn(opened.id, 'So where were we?').catch(error => error)
      expect(failure).toBeInstanceOf(ChatServiceFailure)
      expect(failure).toMatchObject({ phase: 'submit', recovery: 'none' })
      expect(failure.message).toMatch(/cannot pick up an earlier conversation/i)
      expect(routes.seeds).toEqual([])
      expect(sim.invocations()).toEqual([])
      // The message was not sent, so it is not in the conversation.
      const messages = (await chat.hydrateSession(opened.id)).messages
      expect(messages.every(message => message.origin === 'window')).toBe(true)
    })

    it('is refused when the workspace assistant is not on offer (only a Domain Agent would answer)', async () => {
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      sim.workflows = [DOMAIN_WORKFLOW]
      sim.provisioned.add(GRAPH)
      const failure = await chat.startTurn(opened.id, 'So where were we?').catch(error => error)
      expect(failure).toBeInstanceOf(ChatServiceFailure)
      expect(failure).toMatchObject({ recovery: 'none' })
      expect(sim.invocations()).toEqual([])
      expect(routes.seeds).toEqual([])
    })

    it('says the conversation is too large, definitely and without sending a message, when the store refuses the size', async () => {
      routes.seedRefusal = { status: 413, body: { error: { code: 'seed_too_large', message: 'over the cap' } } }
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      const failure = await chat.startTurn(opened.id, 'So where were we?').catch(error => error)
      expect(failure).toBeInstanceOf(ChatServiceFailure)
      expect(failure).toMatchObject({ phase: 'submit', recovery: 'none' })
      expect(failure.message).toMatch(/too large to carry over.*Nothing was sent/)
      expect(sim.invocations()).toEqual([])
    })

    it('says it is not ready, and lets the person try again, when the store is busy', async () => {
      routes.seedRefusal = { status: 503, body: { error: { code: 'seed_store_unavailable', message: 'warming up' } } }
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      const failure = await chat.startTurn(opened.id, 'So where were we?').catch(error => error)
      expect(failure).toMatchObject({ phase: 'submit', recovery: 'resubmit' })
      expect(sim.invocations()).toEqual([])
      // The same conversation, the same message, once the store is back.
      routes.seedRefusal = null
      const turn = await collect(await chat.startTurn(opened.id, 'So where were we?'))
      expect(turn.outcome).toEqual({ state: 'completed' })
      expect(routes.seeds).toHaveLength(1)
      expect(workspaceInvocations(sim)).toHaveLength(1)
    })

    it('says so when the gateway has no seed route at all (an older gateway)', async () => {
      routes.seedRoute = false
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      const failure = await chat.startTurn(opened.id, 'So where were we?').catch(error => error)
      expect(failure).toBeInstanceOf(ChatServiceFailure)
      expect(failure).toMatchObject({ recovery: 'none' })
      expect(failure.message).toMatch(/cannot pick up an earlier conversation yet/)
      expect(sim.invocations()).toEqual([])
    })

    it('says so when the session has expired', async () => {
      routes.seedRefusal = { status: 401, body: { error: 'expired' } }
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      const failure = await chat.startTurn(opened.id, 'So where were we?').catch(error => error)
      expect(failure.message).toMatch(/Sign in again/)
      expect(sim.invocations()).toEqual([])
    })

    it('is refused when the store answers with something that is not a receipt', async () => {
      sim.extraRoutes.unshift(request =>
        request.route === CHAT_SEEDS_PATH ? { status: 201, body: { ok: true } } : undefined)
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      const failure = await chat.startTurn(opened.id, 'So where were we?').catch(error => error)
      expect(failure).toBeInstanceOf(ChatServiceFailure)
      expect(sim.invocations()).toEqual([])
    })
  })

  describe('a host that carries a seed but takes no voice', () => {
    it('continues in the House voice and says so', async () => {
      sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ seed: true })]
      const { chat, plan } = await begin()
      const opened = await chat.continueConversation!(plan, { modelId: KIMI_K26 })
      expect(chat.sessionSeam!(opened.id)!.voiceLabel).toBe('House default')
      await collect(await chat.startTurn(opened.id, 'So where were we?'))
      const [launch] = workspaceInvocations(sim)
      expect(launch.body.input.seed).toBeDefined()
      expect(launch.body.input.inference).toBeUndefined()
    })
  })
})
