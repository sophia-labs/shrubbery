/**
 * Choosing a voice through the hosted chat, against a scripted Choreograph over a real
 * socket (NO MOCKS). Each test names the defect it guards.
 *
 * The chip appears only when the registry advertises `inputs.properties.inference`
 * (an older Choreograph drops keys it does not know, so a new client that offered a
 * choice anyway would start a plain chat while the person believed they had picked
 * Kimi); the choice reaches the launch; the voice the host RESOLVED, not the one that
 * was asked for, is what every live assistant message is marked with.
 */
import type { ChatEvent, ChatModelOption } from '@shrubbery/chat-kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChatServiceFailure } from '../chat-service.js'
import { makeHostedChatService } from '../hosted-chat-service.js'
import {
  ChoreographSim,
  DOMAIN_WORKFLOW,
  completed,
  delta,
  started,
  turnDone,
  workspaceWorkflow,
} from './fixtures/choreograph-sim.js'
import { LIVE_CATALOGUE_ROUTE_TODAY, LIVE_DOMAIN_AGENT_ENTRY, LIVE_WORKSPACE_CHAT_ENTRY } from './fixtures/live-20260929.js'
import { recordingFetch } from './fixtures/recording-fetch.js'
import { SobremesaRoutes, voiceCatalogue } from './fixtures/sobremesa-routes.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const GRAPH = 'atelier-20260929'
const HOUSE = 'google/gemini-2.5-flash'
const KIMI_K26 = 'moonshotai/kimi-k2.6'

function chatOver(sim: ChoreographSim, storage: MemoryStorage = new MemoryStorage(), fetchImpl?: typeof fetch) {
  return makeHostedChatService({
    ...(fetchImpl ? { fetchImpl } : {}),
    gatewayBaseUrl: sim.base,
    graphBaseUrl: (graph: string) => sim.graphBase(graph),
    graphId: () => GRAPH,
    userId: () => 'probe',
    token: () => 'jwt',
    storage,
    resolveAttempts: 3,
    resolveDelayMs: 0,
    sleep: async () => undefined,
  })
}

async function collect(handle: Awaited<ReturnType<ReturnType<typeof chatOver>['startTurn']>>) {
  const events: ChatEvent[] = []
  for await (const item of handle.events) events.push(item)
  return { events, outcome: await handle.done }
}

const workspaceInvocations = (sim: ChoreographSim) =>
  sim.invocations().filter(call => call.body.target.workflowName === 'workspace-chat-v1')

const ids = (roster: readonly ChatModelOption[]): string[] => roster.map(model => model.id)

describe('what the registry advertises', () => {
  let sim: ChoreographSim
  let routes: SobremesaRoutes
  beforeEach(async () => {
    sim = new ChoreographSim()
    routes = new SobremesaRoutes(sim)
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('offers no voice, no picker and no catalogue request while the registry does not advertise `inference`', async () => {
    // Defect guarded: "Sophia-1 · profile-managed" was a constant that omitted the model.
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow()]
    const chat = chatOver(sim)
    expect(chat.capabilities).toEqual({ voice: false, continuation: false })
    expect(chat.models()).toEqual([])
    await expect(chat.probeCapabilities!()).resolves.toEqual({ voice: false, continuation: false })
    expect(chat.models()).toEqual([])
    expect(routes.asked.catalogue).toBe(0)
  })

  it('offers nothing against the registry the live host answered today, and chat goes exactly as it always has', async () => {
    // The live registry, read from production on 2026-09-30 (fixtures/live-20260929.ts): `workspace-chat-v1`
    // lists trigger, contextRefs and interactionMode and nothing else (`additionalProperties: false`), and the
    // gateway's catalogue route answers with its old projection. No picker, no Continue, and a launch that
    // carries only what the live host takes: anything more it would refuse (or, older, silently drop).
    sim.workflows = [LIVE_DOMAIN_AGENT_ENTRY, LIVE_WORKSPACE_CHAT_ENTRY]
    routes.rawCatalogue = { body: LIVE_CATALOGUE_ROUTE_TODAY }
    const chat = chatOver(sim)
    await expect(chat.probeCapabilities!()).resolves.toEqual({ voice: false, continuation: false })
    expect(chat.models()).toEqual([])
    expect(chat.voiceFootnote!()).toBeNull()
    expect(routes.asked.catalogue).toBe(0)
    await expect(chat.prepareContinuation!({
      conversationId: `urn:sophia:conversation-archive:conversation:${'a'.repeat(64)}`,
      revisionId: 'b'.repeat(64),
      title: 'Old',
      messagesLoaded: 1,
    })).rejects.toMatchObject({ code: 'unsupported' })

    const created = await chat.createSession()
    expect(chat.sessionModelId!(created.id)).toBeNull()
    const turn = await collect(await chat.startTurn(created.id, 'Hello'))
    expect(turn.outcome).toEqual({ state: 'completed' })
    const [launch] = workspaceInvocations(sim)
    expect(Object.keys(launch.body.input).sort()).toEqual(['contextRefs', 'interactionMode', 'trigger'])
    expect(launch.body.target.definitionDigest).toBe(LIVE_WORKSPACE_CHAT_ENTRY.definitionDigest)
    expect(routes.seeds).toEqual([])
    // The bill of what the page asked of the host: no catalogue, no seed store.
    expect(routes.asked.catalogue).toBe(0)
  })

  it('offers the catalogue as a roster once the registry advertises `inference`', async () => {
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true })]
    const chat = chatOver(sim)
    await expect(chat.probeCapabilities!()).resolves.toEqual({ voice: true, continuation: false })
    expect(chat.capabilities).toEqual({ voice: true, continuation: false })
    const roster = chat.models()
    expect(ids(roster)).toEqual(voiceCatalogue().map(row => row.id))
    expect(roster[0]).toMatchObject({
      id: HOUSE,
      house: true,
      note: 'House default · via OpenRouter',
      priceInPerMTok: 0.36,
      priceOutPerMTok: 3,
      supportsTools: true,
    })
    expect(roster[2]).toMatchObject({ id: KIMI_K26, label: 'Kimi K2.6', priceInPerMTok: 0.78, priceOutPerMTok: 4.092 })
    expect(roster.every(model => model.disabled !== true)).toBe(true)
  })

  it('reads the registry and the catalogue once, not on every look', async () => {
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true })]
    const chat = chatOver(sim)
    await chat.probeCapabilities!()
    await chat.probeCapabilities!()
    await Promise.all([chat.probeCapabilities!(), chat.probeCapabilities!()])
    expect(routes.asked.catalogue).toBe(1)
    expect(sim.calls('/workflows', 'GET').filter(call => call.route === '/workflows')).toHaveLength(1)
    // The roster is one array until it changes: nothing re-renders for nothing.
    expect(chat.models()).toBe(chat.models())
  })

  it('reads a continuation from `inputs.properties.seed` on its own', async () => {
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ seed: true })]
    const chat = chatOver(sim)
    await expect(chat.probeCapabilities!()).resolves.toEqual({ voice: false, continuation: true })
    expect(routes.asked.catalogue).toBe(0)
    expect(chat.models()).toEqual([])
  })

  it('offers nothing, without throwing, when the registry cannot be read; and reads it again next time', async () => {
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true })]
    let broken = true
    sim.extraRoutes.unshift(request =>
      broken && request.route === '/workflows' ? { status: 503, body: { error: 'warming up' } } : undefined)
    const chat = chatOver(sim)
    await expect(chat.probeCapabilities!()).resolves.toEqual({ voice: false, continuation: false })
    expect(chat.models()).toEqual([])
    broken = false
    await expect(chat.probeCapabilities!()).resolves.toEqual({ voice: true, continuation: false })
    expect(chat.models().length).toBeGreaterThan(0)
  })

  it('leaves the roster empty (no chip) when the registry advertises a voice but the catalogue will not load', async () => {
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true })]
    routes.catalogue = null
    const chat = chatOver(sim)
    await expect(chat.probeCapabilities!()).resolves.toMatchObject({ voice: true })
    expect(chat.models()).toEqual([])
  })

  it('lists a voice with no price, or one that cannot use tools, but disabled and with its reason', async () => {
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true })]
    routes.catalogue = {
      models: [
        ...voiceCatalogue().slice(0, 2),
        { id: 'mystery/unpriced', label: 'Mystery', priceInPerMTok: null, priceOutPerMTok: null, supportsTools: true },
        { id: 'perplexity/sonar-pro', label: 'Sonar Pro', priceInPerMTok: 3, priceOutPerMTok: 15, supportsTools: false },
      ],
    }
    const chat = chatOver(sim)
    await chat.probeCapabilities!()
    const roster = chat.models()
    expect(roster.find(model => model.id === 'mystery/unpriced')).toMatchObject({
      disabled: true,
      disabledReason: expect.stringMatching(/no price/i),
    })
    expect(roster.find(model => model.id === 'perplexity/sonar-pro')).toMatchObject({
      disabled: true,
      disabledReason: expect.stringMatching(/tools/i),
    })
    expect(roster.find(model => model.id === KIMI_K26 || model.id === 'moonshotai/kimi-k2.5')?.disabled).toBeUndefined()
  })

  it('asks for the catalogue at the gateway root, once, with the person’s own token, and never below a graph', async () => {
    // Defect guarded: the catalogue is the account's, not a graph's; a request under `/g/{graph}`
    // would ask a route no gateway has, and the picker would never appear.
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true })]
    const seen = recordingFetch()
    const chat = chatOver(sim, new MemoryStorage(), seen.fetchImpl)
    await chat.probeCapabilities!()
    const asked = seen.to('/chat/models', 'GET')
    expect(asked).toHaveLength(1)
    expect(asked[0].url.origin).toBe(sim.base)
    expect(asked[0].url.searchParams.get('view')).toBe('chat')
    expect(asked[0].url.searchParams.get('limit')).toBe('1000')
    // What the service built (happy-dom's fetch drops the header before the socket, so the host
    // cannot be asked): the person's own token, and no cookies.
    expect(asked[0].headers.get('authorization')).toBe('Bearer jwt')
    expect(asked[0].credentials).toBe('omit')
    expect(routes.catalogueRequests).toHaveLength(1)
    expect(routes.catalogueRequests[0].graph).toBeNull()
  })

  it('offers nothing when what answers at the catalogue route is the gateway’s old projection', async () => {
    // Defect guarded: until the gateway forwards `?view=chat` unprojected, `/chat/models` answers
    // with its fixed projection of every model OpenRouter lists. Not a picker: it would offer
    // batch routes and free models a launch refuses, at prices nobody is charged.
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true })]
    routes.rawCatalogue = {
      body: { models: [{ id: 'google/gemini-2.5-flash', name: 'Google: Gemini 2.5 Flash', pricing: { prompt: 3e-7, completion: 2.5e-6 } }] },
    }
    const chat = chatOver(sim)
    await expect(chat.probeCapabilities!()).resolves.toMatchObject({ voice: true })
    expect(chat.models()).toEqual([])
  })

  it('offers nothing while the catalogue says its prices are stale, or its answer is an error', async () => {
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true })]
    routes.catalogueOptions = { stale: true }
    const stale = chatOver(sim)
    await stale.probeCapabilities!()
    expect(stale.models()).toEqual([])
    routes.catalogueOptions = {}
    routes.rawCatalogue = {
      status: 503,
      body: { error: { code: 'pricing_unavailable', message: 'stale', details: { reason: 'catalogue_stale' } } },
    }
    const refused = chatOver(sim)
    await refused.probeCapabilities!()
    expect(refused.models()).toEqual([])
  })

  it('asks for the catalogue again when it would not load, and offers it once it does', async () => {
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true })]
    routes.rawCatalogue = { status: 503, body: { error: { code: 'model_catalogue_unavailable', message: 'warming up' } } }
    const chat = chatOver(sim)
    await chat.probeCapabilities!()
    expect(chat.models()).toEqual([])
    routes.rawCatalogue = undefined
    await chat.probeCapabilities!()
    expect(ids(chat.models())).toEqual(voiceCatalogue().map(row => row.id))
  })

  it('tells a listener when the roster arrives or a choice is made, and stops when it unsubscribes', async () => {
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true })]
    const chat = chatOver(sim)
    const heard: number[] = []
    const stop = chat.subscribe!(() => { heard.push(chat.models().length) })
    await chat.probeCapabilities!()
    expect(heard.length).toBeGreaterThan(0)
    expect(heard.at(-1)).toBe(voiceCatalogue().length)

    const created = await chat.createSession()
    const beforeChoice = heard.length
    chat.setSessionModel!(created.id, KIMI_K26)
    expect(heard.length).toBeGreaterThan(beforeChoice)

    stop()
    const afterStop = heard.length
    chat.setSessionModel!(created.id, HOUSE)
    expect(heard.length).toBe(afterStop)
  })
})

describe('choosing a voice', () => {
  let sim: ChoreographSim
  let routes: SobremesaRoutes
  beforeEach(async () => {
    sim = new ChoreographSim()
    routes = new SobremesaRoutes(sim)
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true })]
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('sends the chosen voice with the first message, to the workspace assistant only', async () => {
    // Defect guarded: setModel never reached the service; the launch carried no model.
    const chat = chatOver(sim)
    await chat.probeCapabilities!()
    const created = await chat.createSession()
    chat.setSessionModel!(created.id, KIMI_K26)
    expect(chat.sessionModelId!(created.id)).toBe(KIMI_K26)
    await collect(await chat.startTurn(created.id, 'Hello'))

    const [domain] = sim.invocations()
    expect(domain.body.target.workflowName).toBe(DOMAIN_WORKFLOW.name)
    expect(domain.body.input.inference).toBeUndefined()
    const [workspace] = workspaceInvocations(sim)
    expect(workspace.body.input.inference).toEqual({ provider: 'openrouter', model: KIMI_K26 })
  })

  it('does not send the House default: the host’s own default is what runs', async () => {
    const chat = chatOver(sim)
    await chat.probeCapabilities!()
    const created = await chat.createSession()
    chat.setSessionModel!(created.id, HOUSE)
    await collect(await chat.startTurn(created.id, 'Hello'))
    expect(workspaceInvocations(sim)[0].body.input.inference).toBeUndefined()
  })

  it('sends no voice when none was chosen', async () => {
    const chat = chatOver(sim)
    await chat.probeCapabilities!()
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'Hello'))
    expect(workspaceInvocations(sim)[0].body.input.inference).toBeUndefined()
  })

  it('asks for a choice, and sends nothing, when the catalogue says the House default would be refused', async () => {
    // Defect guarded: with House refused, a chat started with no voice named is refused by the host
    // (`model_house_default_unavailable`) in the words of "the workspace may be waking up", while the
    // picker showed some other voice as if it were the default.
    routes.catalogueOptions = { houseAdmissible: false }
    const chat = chatOver(sim)
    await chat.probeCapabilities!()
    expect(chat.models().length).toBeGreaterThan(0)
    expect(chat.models().some(model => model.house)).toBe(false)
    const created = await chat.createSession()
    expect(chat.sessionModelId!(created.id)).toBeNull()
    await expect(chat.startTurn(created.id, 'Hello')).rejects.toMatchObject({
      phase: 'submit',
      recovery: 'none',
      message: expect.stringMatching(/choose a voice/i),
    })
    // Nothing reached the workspace assistant, and nothing was started (the one 404 a graph with no
    // Domain Agent always answers is not a message).
    expect(workspaceInvocations(sim)).toEqual([])
    expect(sim.sessions.size).toBe(0)
    // Once a voice is chosen the same conversation goes, with it.
    chat.setSessionModel!(created.id, KIMI_K26)
    await collect(await chat.startTurn(created.id, 'Hello'))
    expect(workspaceInvocations(sim)[0].body.input.inference).toEqual({ provider: 'openrouter', model: KIMI_K26 })
  })

  it('honours a voice named when the conversation is created', async () => {
    // Defect guarded: createSession hard-wired the profile model and ignored `modelId`.
    const chat = chatOver(sim)
    await chat.probeCapabilities!()
    const created = await chat.createSession({ modelId: KIMI_K26 })
    expect(chat.sessionModelId!(created.id)).toBe(KIMI_K26)
    await collect(await chat.startTurn(created.id, 'Hello'))
    expect(workspaceInvocations(sim)[0].body.input.inference).toEqual({ provider: 'openrouter', model: KIMI_K26 })
  })

  it('refuses a voice that is not on offer and leaves the choice as it was', async () => {
    const chat = chatOver(sim)
    await chat.probeCapabilities!()
    const created = await chat.createSession()
    chat.setSessionModel!(created.id, KIMI_K26)
    const failure = (() => {
      try {
        chat.setSessionModel!(created.id, 'nobody/nothing')
      } catch (error) {
        return error
      }
      return null
    })()
    expect(failure).toBeInstanceOf(ChatServiceFailure)
    expect(failure).toMatchObject({ recovery: 'none' })
    expect(chat.sessionModelId!(created.id)).toBe(KIMI_K26)
  })

  it('refuses a voice the catalogue lists but disabled', async () => {
    routes.catalogue = {
      models: [...voiceCatalogue().slice(0, 2), { id: 'mystery/unpriced', label: 'Mystery', priceInPerMTok: null, priceOutPerMTok: null }],
    }
    const chat = chatOver(sim)
    await chat.probeCapabilities!()
    const created = await chat.createSession()
    expect(() => chat.setSessionModel!(created.id, 'mystery/unpriced')).toThrow(ChatServiceFailure)
    expect(chat.sessionModelId!(created.id)).toBe(HOUSE)
  })

  it('refuses a change once the conversation has begun: the voice is fixed after the first message', async () => {
    const chat = chatOver(sim)
    await chat.probeCapabilities!()
    const created = await chat.createSession()
    chat.setSessionModel!(created.id, KIMI_K26)
    await collect(await chat.startTurn(created.id, 'Hello'))
    expect(() => chat.setSessionModel!(created.id, 'moonshotai/kimi-k2.5')).toThrow(ChatServiceFailure)
    expect(chat.sessionModelId!(created.id)).toBe(KIMI_K26)
  })

  it('shows the House default as the voice of a conversation nobody has chosen for', async () => {
    const chat = chatOver(sim)
    await chat.probeCapabilities!()
    const created = await chat.createSession()
    expect(chat.sessionModelId!(created.id)).toBe(HOUSE)
    expect(chat.sessionVoice!(created.id)).toBeNull()
  })

  it('does not send a voice the registry has stopped advertising, though one was chosen', async () => {
    // A rollback of Choreograph: the SPA still holds a choice, the host would drop the key.
    const chat = chatOver(sim)
    await chat.probeCapabilities!()
    const created = await chat.createSession()
    chat.setSessionModel!(created.id, KIMI_K26)
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow()]
    await collect(await chat.startTurn(created.id, 'Hello'))
    expect(workspaceInvocations(sim)[0].body.input.inference).toBeUndefined()
  })

  it('treats the retired profile id as no choice at all', async () => {
    const storage = new MemoryStorage()
    const root = `shrubbery:c2chat:v1:probe:${GRAPH}`
    storage.setItem(`${root}:descriptor-index`, JSON.stringify(['c2chat-legacy']))
    storage.setItem(`${root}:descriptor:c2chat-legacy`, JSON.stringify({
      schema: 'shrubbery.cloud2-chat-descriptor.v1',
      virtualId: 'c2chat-legacy',
      graphId: GRAPH,
      title: null,
      modelId: 'sophia-1/profile',
      clientId: 'c2chat-client-legacy',
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      cursor: 0,
    }))
    const chat = chatOver(sim, storage)
    await chat.probeCapabilities!()
    expect(chat.sessionModelId!('c2chat-legacy')).toBe(HOUSE)
    await collect(await chat.startTurn('c2chat-legacy', 'Hello'))
    expect(workspaceInvocations(sim)[0].body.input.inference).toBeUndefined()
  })
})

describe('the voice the host resolved', () => {
  let sim: ChoreographSim
  let routes: SobremesaRoutes
  beforeEach(async () => {
    sim = new ChoreographSim()
    routes = new SobremesaRoutes(sim)
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true })]
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('marks the conversation with the model the host reported, named by the catalogue', async () => {
    const chat = chatOver(sim)
    await chat.probeCapabilities!()
    const created = await chat.createSession()
    chat.setSessionModel!(created.id, KIMI_K26)
    await collect(await chat.startTurn(created.id, 'Hello'))
    expect(chat.sessionVoice!(created.id)).toEqual({
      id: KIMI_K26,
      label: 'Kimi K2.6',
      provider: 'Moonshot',
      basis: 'live',
    })
    expect(chat.sessionModelId!(created.id)).toBe(KIMI_K26)
  })

  it('names the model the host RESOLVED, not the one that was asked for', async () => {
    // Defect guarded (D7): the picker said one thing and the host ran another.
    sim.allowedModels = new Set(['moonshotai/kimi-k2.5'])
    const chat = chatOver(sim)
    await chat.probeCapabilities!()
    const created = await chat.createSession()
    chat.setSessionModel!(created.id, 'moonshotai/kimi-k3')
    await collect(await chat.startTurn(created.id, 'Hello'))
    expect(workspaceInvocations(sim)[0].body.input.inference.model).toBe('moonshotai/kimi-k3')
    expect(chat.sessionVoice!(created.id)).toMatchObject({ id: HOUSE, label: 'Gemini 2.5 Flash', basis: 'live' })
    expect(chat.sessionModelId!(created.id)).toBe(HOUSE)
  })

  it('knows the voice as soon as the session exists, before the first word arrives', async () => {
    sim.queueTurn({
      answer: 'Hello there.',
      stages: [[started()], [delta('Hello there.'), turnDone(), completed('Hello there.')]],
    })
    const chat = chatOver(sim)
    await chat.probeCapabilities!()
    const created = await chat.createSession()
    chat.setSessionModel!(created.id, KIMI_K26)
    const handle = await chat.startTurn(created.id, 'Hello')
    expect(chat.sessionVoice!(created.id)).toMatchObject({ id: KIMI_K26, basis: 'live' })
    await collect(handle)
  })

  it('marks every assistant message, after the turn and after a reload, and no user message', async () => {
    const storage = new MemoryStorage()
    const chat = chatOver(sim, storage)
    await chat.probeCapabilities!()
    const created = await chat.createSession()
    chat.setSessionModel!(created.id, KIMI_K26)
    await collect(await chat.startTurn(created.id, 'One'))
    await collect(await chat.startTurn(created.id, 'Two'))

    const check = async (service: typeof chat): Promise<void> => {
      const messages = (await service.hydrateSession(created.id)).messages
      expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
      for (const message of messages) {
        if (message.role === 'assistant') {
          expect(message.voice).toMatchObject({ id: KIMI_K26, basis: 'live' })
        } else {
          expect(message.voice).toBeUndefined()
        }
      }
    }
    await check(chat)
    await check(chatOver(sim, storage))
  })

  it('names the voice by the tail of its id while the catalogue has not loaded', async () => {
    const storage = new MemoryStorage()
    const chat = chatOver(sim, storage)
    await chat.probeCapabilities!()
    const created = await chat.createSession()
    chat.setSessionModel!(created.id, KIMI_K26)
    await collect(await chat.startTurn(created.id, 'One'))
    // A page load whose catalogue read has not answered yet.
    const cold = chatOver(sim, storage)
    expect(cold.models()).toEqual([])
    expect(cold.sessionVoice!(created.id)).toMatchObject({ id: KIMI_K26, label: 'kimi-k2.6', basis: 'live' })
    await cold.probeCapabilities!()
    expect(cold.sessionVoice!(created.id)).toMatchObject({ id: KIMI_K26, label: 'Kimi K2.6' })
    expect(routes.asked.catalogue).toBe(2)
  })
})
