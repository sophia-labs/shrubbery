/**
 * The chat store and the Voice picker over the real hosted service and a scripted
 * Choreograph (NO MOCKS), plus the local service as the control.
 *
 * Defects guarded: the picker's choice stopped in the store (`setModel` changed store
 * state and nothing else, so no launch ever carried it); the roster was read once,
 * before the host had said what it can do; and no live assistant message said which
 * model spoke.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeHostedChatService } from '../../chat-services/hosted-chat-service.js'
import { makeLocalChatService } from '../../chat-services/local-chat-service.js'
import {
  ChoreographSim,
  DOMAIN_WORKFLOW,
  completed,
  delta,
  started,
  turnDone,
  workspaceWorkflow,
} from '../../chat-services/__tests__/fixtures/choreograph-sim.js'
import { SobremesaRoutes, voiceCatalogue } from '../../chat-services/__tests__/fixtures/sobremesa-routes.js'
import { createChatServiceStore, type ChatServiceStore, type ChatServiceStoreState } from '../chat-service-store.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const HOUSE = 'google/gemini-2.5-flash'
const KIMI_K26 = 'moonshotai/kimi-k2.6'

async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('store test timed out')
    await new Promise(resolve => setTimeout(resolve, 2))
  }
}

async function say(store: ChatServiceStore, text: string): Promise<void> {
  const before = store.getState().messages.length
  store.send(text)
  await until(() => {
    const state = store.getState()
    return !state.streaming && state.messages.length >= before + 2
  })
}

describe('the store over a hosted service that can offer a voice', () => {
  let sim: ChoreographSim
  let routes: SobremesaRoutes
  let store: ChatServiceStore
  let service: ReturnType<typeof makeHostedChatService>
  let sessionId: string

  async function open(options: { advertise?: boolean } = {}): Promise<void> {
    sim.workflows = [
      DOMAIN_WORKFLOW,
      workspaceWorkflow({ inference: options.advertise ?? true, seed: true }),
    ]
    service = makeHostedChatService({
      gatewayBaseUrl: sim.base,
      graphBaseUrl: (graph: string) => sim.graphBase(graph),
      graphId: () => 'atelier-20260929',
      userId: () => 'probe',
      token: () => 'jwt',
      storage: new MemoryStorage(),
      resolveAttempts: 3,
      resolveDelayMs: 0,
      sleep: async () => undefined,
    })
    const created = await service.createSession()
    sessionId = created.id
    service.bindSlotSession(0, created.id)
    store = createChatServiceStore(service)
    store.setSession(created.id)
    await until(() => store.getState().conversationState === 'ready')
  }

  beforeEach(async () => {
    sim = new ChoreographSim()
    routes = new SobremesaRoutes(sim)
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('has no picker until the host has said it can offer a voice, then shows the whole roster', async () => {
    // Defect guarded: the roster was read once when the store was made.
    await open()
    await until(() => store.getState().models.length > 0)
    expect(store.getState().models.map(model => model.id)).toEqual(voiceCatalogue().map(row => row.id))
    expect(routes.asked.catalogue).toBe(1)
  })

  it('shows no picker at all when the host does not advertise a voice', async () => {
    await open({ advertise: false })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(store.getState().models).toEqual([])
    expect(store.getState().currentModel).toBe('')
    expect(routes.asked.catalogue).toBe(0)
  })

  it('shows the House default as the current voice until one is chosen', async () => {
    await open()
    await until(() => store.getState().models.length > 0)
    expect(store.getState().currentModel).toBe(HOUSE)
  })

  it('says "Choose a voice" (no current voice), not the first row of the list, when the host would refuse the House default', async () => {
    // Defect guarded: with no House row the store fell back to the first voice on the list and
    // showed it as the default, a voice the person had not chosen and a launch would not use.
    routes.catalogueOptions = { houseAdmissible: false }
    await open()
    await until(() => store.getState().models.length > 0)
    expect(store.getState().models.some(model => model.house)).toBe(false)
    expect(store.getState().currentModel).toBe('')
    store.setModel!(KIMI_K26)
    expect(store.getState().currentModel).toBe(KIMI_K26)
  })

  it('asks for the catalogue again when the host says it takes a voice but the catalogue would not load', async () => {
    // Defect guarded: the store retried only while the host's capabilities were unknown, so a
    // catalogue that failed once (a token not ready, a gateway warming up) left no picker until reload.
    routes.rawCatalogue = { status: 503, body: { error: { code: 'model_catalogue_unavailable', message: 'warming up' } } }
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true })]
    service = makeHostedChatService({
      gatewayBaseUrl: sim.base,
      graphBaseUrl: (graph: string) => sim.graphBase(graph),
      graphId: () => 'atelier-20260929',
      userId: () => 'probe',
      token: () => 'jwt',
      storage: new MemoryStorage(),
      resolveAttempts: 3,
      resolveDelayMs: 0,
      sleep: async () => undefined,
    })
    const created = await service.createSession()
    store = createChatServiceStore(service, { probeRetryMs: 10 })
    store.setSession(created.id)
    await until(() => routes.asked.catalogue >= 1)
    expect(store.getState().models).toEqual([])
    routes.rawCatalogue = undefined
    await until(() => store.getState().models.length > 0)
    expect(store.getState().models.map(model => model.id)).toEqual(voiceCatalogue().map(row => row.id))
  })

  it('carries the choice to the service, shows it, and the first message launches with it', async () => {
    await open()
    await until(() => store.getState().models.length > 0)

    store.setModel!(KIMI_K26)
    expect(service.sessionModelId!(sessionId)).toBe(KIMI_K26)
    expect(store.getState().currentModel).toBe(KIMI_K26)

    await say(store, 'Hello')
    const workspace = sim.invocations().find(call => call.body.target.workflowName === 'workspace-chat-v1')!
    expect(workspace.body.input.inference).toEqual({ provider: 'openrouter', model: KIMI_K26 })
    expect(store.getState().currentModel).toBe(KIMI_K26)
  })

  it('names the conversation in the header by what was said, as soon as it is said', async () => {
    // Defect guarded: the header kept "New chat" until the conversation was next opened, because the
    // title was read once, when the conversation was bound, and never again.
    await open()
    await until(() => store.getState().models.length > 0)
    expect(store.getState().sessionTitle).toBeNull()
    await say(store, 'What can you help me with in this workspace?')
    expect(store.getState().sessionTitle).toBe('What can you help me with in this workspace?')
  })

  it('tells the panel about a choice the moment it is made', async () => {
    await open()
    await until(() => store.getState().models.length > 0)
    const seen: string[] = []
    store.subscribe(state => { seen.push(state.currentModel) })
    store.setModel!(KIMI_K26)
    expect(seen.at(-1)).toBe(KIMI_K26)
  })

  it('does not change a voice once a message has been sent', async () => {
    await open()
    await until(() => store.getState().models.length > 0)
    store.setModel!(KIMI_K26)
    await say(store, 'Hello')
    store.setModel!('moonshotai/kimi-k2.5')
    expect(store.getState().currentModel).toBe(KIMI_K26)
    expect(service.sessionModelId!(sessionId)).toBe(KIMI_K26)
  })

  it('ignores a voice that is not on offer', async () => {
    await open()
    await until(() => store.getState().models.length > 0)
    store.setModel!('nobody/nothing')
    expect(store.getState().currentModel).toBe(HOUSE)
    expect(service.sessionModelId!(sessionId)).toBe(HOUSE)
  })

  it('marks every live assistant message with the voice that spoke, in every frame it is on screen', async () => {
    // Defect guarded (D7): a person could not see, choose or learn the model.
    sim.queueTurn({
      answer: 'Hello there, friend.',
      stages: [
        [started(), delta('Hello')],
        [delta(' there,'), delta(' friend.'), turnDone(), completed('Hello there, friend.')],
      ],
    })
    await open()
    await until(() => store.getState().models.length > 0)
    store.setModel!(KIMI_K26)
    const frames: ChatServiceStoreState[] = []
    store.subscribe(state => { frames.push(state) })

    await say(store, 'Hello')

    const withAssistant = frames.filter(frame => frame.messages.some(message => message.role === 'assistant'))
    expect(withAssistant.length).toBeGreaterThan(1)
    for (const frame of withAssistant) {
      for (const message of frame.messages) {
        if (message.role === 'assistant') {
          expect(message.voice).toMatchObject({ id: KIMI_K26, label: 'Kimi K2.6', basis: 'live' })
        } else {
          expect(message.voice).toBeUndefined()
        }
      }
    }
    // The bubble that was streaming, and the one that finished, are the same voice.
    const last = frames.at(-1)!.messages.at(-1)!
    expect(last.content).toBe('Hello there, friend.')
    expect(last.voice?.id).toBe(KIMI_K26)
  })

  it('names the voice of a reply read back before the catalogue answered, once the catalogue answers (a reload)', async () => {
    // Defect guarded (D-B, seen live 2026-10-01 in the voices release's acceptance): after a reload the
    // replies read "voice: kimi-k2.6" while the chip read "Kimi K2.6". The marks were built at hydration,
    // before the catalogue was read, by the id's tail; nothing named them when the catalogue arrived.
    const storage = new MemoryStorage()
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true })]
    const page = () => makeHostedChatService({
      gatewayBaseUrl: sim.base,
      graphBaseUrl: (graph: string) => sim.graphBase(graph),
      graphId: () => 'atelier-20260929',
      userId: () => 'probe',
      token: () => 'jwt',
      storage,
      resolveAttempts: 3,
      resolveDelayMs: 0,
      sleep: async () => undefined,
    })
    service = page()
    const created = await service.createSession()
    service.bindSlotSession(0, created.id)
    store = createChatServiceStore(service)
    store.setSession(created.id)
    await until(() => store.getState().conversationState === 'ready' && store.getState().models.length > 0)
    store.setModel!(KIMI_K26)
    await say(store, 'One')
    store.dispose()

    // The page is loaded again; its catalogue read does not answer at first.
    routes.rawCatalogue = { status: 503, body: { error: { code: 'model_catalogue_unavailable', message: 'warming up' } } }
    const reloaded = page()
    store = createChatServiceStore(reloaded, { probeRetryMs: 10 })
    store.setSession(created.id)
    await until(() => store.getState().conversationState === 'ready' && store.getState().messages.length === 2)
    expect(store.getState().models).toEqual([])
    expect(store.getState().messages[1].voice).toMatchObject({ id: KIMI_K26, label: 'kimi-k2.6' })

    routes.rawCatalogue = undefined
    await until(() => store.getState().models.length > 0)
    const reply = store.getState().messages[1]
    expect(reply.voice).toMatchObject({ id: KIMI_K26, label: 'Kimi K2.6', basis: 'live' })
    expect(store.getState().messages[0].voice).toBeUndefined()
  })

  it('marks the messages of a conversation opened later, before any new turn', async () => {
    await open()
    await until(() => store.getState().models.length > 0)
    store.setModel!(KIMI_K26)
    await say(store, 'One')
    store.setSession(sessionId)
    await until(() => store.getState().conversationState === 'ready' && store.getState().messages.length === 2)
    const assistant = store.getState().messages.find(message => message.role === 'assistant')!
    expect(assistant.voice).toMatchObject({ id: KIMI_K26, basis: 'live' })
  })
})

describe('the store when the first read of the registry failed', () => {
  let sim: ChoreographSim

  beforeEach(async () => {
    sim = new ChoreographSim()
    new SobremesaRoutes(sim)
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true })]
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('asks again, so a chat mounted before the session token was ready still gets its picker', async () => {
    // Defect avoided: a registry read that failed once (no token yet) left the chip
    // hidden until the person happened to switch conversations.
    let broken = true
    sim.extraRoutes.unshift(request =>
      broken && request.route === '/workflows' ? { status: 401, body: { error: 'no session yet' } } : undefined)
    const service = makeHostedChatService({
      gatewayBaseUrl: sim.base,
      graphBaseUrl: (graph: string) => sim.graphBase(graph),
      graphId: () => 'atelier-20260929',
      userId: () => 'probe',
      token: () => 'jwt',
      storage: new MemoryStorage(),
      resolveAttempts: 3,
      resolveDelayMs: 0,
      sleep: async () => undefined,
    })
    const created = await service.createSession()
    const store = createChatServiceStore(service, { probeRetryMs: 20 })
    store.setSession(created.id)
    await until(() => store.getState().conversationState === 'ready')
    expect(store.getState().models).toEqual([])
    broken = false
    await until(() => store.getState().models.length > 0, 3_000)
    expect(store.getState().models.map(model => model.id)).toEqual(voiceCatalogue().map(row => row.id))
    store.dispose()
  })

  it('stops asking when the store is disposed', async () => {
    let asked = 0
    sim.extraRoutes.unshift(request => {
      if (request.route !== '/workflows') return undefined
      asked += 1
      return { status: 503, body: { error: 'down' } }
    })
    const service = makeHostedChatService({
      gatewayBaseUrl: sim.base,
      graphBaseUrl: (graph: string) => sim.graphBase(graph),
      graphId: () => 'atelier-20260929',
      userId: () => 'probe',
      token: () => 'jwt',
      storage: new MemoryStorage(),
      resolveAttempts: 3,
      resolveDelayMs: 0,
      sleep: async () => undefined,
    })
    const store = createChatServiceStore(service, { probeRetryMs: 10 })
    await until(() => asked >= 1)
    store.dispose()
    const settled = asked
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(asked).toBeLessThanOrEqual(settled + 1)
  })
})

describe('the store over a service with nothing to choose (the local control)', () => {
  it('keeps a choice in the store alone, as before, and marks nothing', async () => {
    const service = makeLocalChatService({
      models: [
        { id: 'm1', label: 'Model One' },
        { id: 'm2', label: 'Model Two' },
      ],
    })
    const created = await service.createSession({ title: 't' })
    const store = createChatServiceStore(service)
    store.setSession(created.id)
    await until(() => store.getState().conversationState === 'ready')
    expect(store.getState().currentModel).toBe('m1')
    store.setModel!('m2')
    expect(store.getState().currentModel).toBe('m2')
    store.setModel!('nope')
    expect(store.getState().currentModel).toBe('m2')
    await say(store, 'hi')
    expect(store.getState().messages.every(message => message.voice === undefined)).toBe(true)
    // Locked once a message exists.
    store.setModel!('m1')
    expect(store.getState().currentModel).toBe('m2')
  })
})
