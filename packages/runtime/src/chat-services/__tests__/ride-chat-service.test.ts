/**
 * The self-host's chat on the agent core: the ride protocol v2 through gardend's `/services/vehicle`
 * (NO MOCKS: two real HTTP servers, a gardend-shaped front minting identity and the graph, the ride sim
 * behind it; every request crosses both sockets, and the store folds every turn with the real projector).
 *
 * What it holds (agent-core V2):
 *   - a new conversation is `POST /g/<graph>/sessions`; gardend's front mints the graph, the body names none;
 *   - a turn streams over SSE (deltas, tool chips, cost, the end), and is the same over long-poll when the
 *     proxy cannot stream;
 *   - a message sent mid-reply steers it, and settles into the conversation's own order;
 *   - stop aborts the run;
 *   - the conversation list is the caller's own; a reload finds the conversation and drives it again;
 *   - a service without `steer` (the hosted chat) keeps the one-reply-at-a-time composer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type ChatServiceStore, createChatServiceStore } from '../../chat-host/chat-service-store.js'
import { makeRideChatService } from '../ride-chat-service.js'
import { GardendFront, RideSim } from './fixtures/ride-sim.js'

const GRAPH = 'atopile-led-badge'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
}

let sim: RideSim
let front: GardendFront
let storage: MemoryStorage
/** Every store a test made: disposed after it, so no watch outlives the servers. */
const stores: ChatServiceStore[] = []
const storeOf = (...args: Parameters<typeof createChatServiceStore>): ChatServiceStore => {
  const store = createChatServiceStore(...args)
  stores.push(store)
  return store
}

interface HappyDomControl {
  readonly happyDOM?: { setURL(url: string): void }
  readonly location: { href: string }
}
const page = (): HappyDomControl => globalThis.window as unknown as HappyDomControl
let originalUrl = ''

function service(options: { key?: string; graph?: string } = {}) {
  return makeRideChatService({
    baseUrl: front.vehicleBase,
    graphId: () => options.graph ?? GRAPH,
    token: () => options.key ?? front.key,
    role: () => 'owner',
    contextRefs: () => ['buck-boost-converter'],
    storage,
    longPollMs: 500,
  })
}

async function until(predicate: () => boolean, what: string, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

beforeEach(async () => {
  sim = new RideSim()
  await sim.start()
  front = new GardendFront(sim)
  await front.start()
  storage = new MemoryStorage()
  // The page is on gardend's origin, as a self-host page is (a cross-origin fetch would lose Authorization).
  originalUrl = page().location.href
  page().happyDOM?.setURL(`${front.base}/`)
})

afterEach(async () => {
  for (const store of stores.splice(0)) store.dispose()
  page().happyDOM?.setURL(originalUrl)
  await front.stop()
  await sim.stop()
})

describe('the ride chat through gardend', () => {
  it('creates a conversation on the graph gardend mints, never naming one itself', async () => {
    const svc = service()
    const created = await svc.createSession({ title: null })
    const create = sim.received.find(item => item.method === 'POST' && item.path === '/sessions')
    expect(create?.headers['x-graph-id']).toBe(GRAPH)
    expect(create?.headers['x-user-id']).toBe('owner')
    expect(create?.body.graphId).toBeUndefined()
    expect(create?.headers['x-vehicle-client-id']).toMatch(/^browser-/)
    expect(sim.sessions.get(created.id)?.graphId).toBe(GRAPH)
    expect(sim.sessions.get(created.id)?.lease?.clientId).toBe(create?.headers['x-vehicle-client-id'])
  })

  it('streams a turn: text as it comes, a tool chip with its result, the cost, and the end', async () => {
    const svc = service()
    const store = storeOf(svc)
    const { id } = await svc.createSession({ title: null })
    store.setSession(id)
    await until(() => store.getState().conversationState === 'ready', 'the conversation to load')
    sim.scripts.push([
      { kind: 'say', text: 'Let me look.' },
      { kind: 'tool', name: 'search_documents', args: { query: 'buck' }, result: 'buck-boost-converter: Buck-Boost Converter - TPS63020' },
      { kind: 'say', text: 'The TPS63020 converts the battery to 3.3 V.', costUsd: 0.001 },
    ])
    store.send('Which part makes the 3.3 V rail?')
    await until(() => store.getState().streaming, 'the reply to start')
    await until(() => !store.getState().streaming, 'the reply to end')
    const state = store.getState()
    expect(state.sendState).toBe('ready')
    const [user, reply] = state.messages
    expect(user?.role).toBe('user')
    expect(user?.content).toBe('Which part makes the 3.3 V rail?')
    expect(reply?.role).toBe('assistant')
    expect(reply?.content).toBe('Let me look.\n\nThe TPS63020 converts the battery to 3.3 V.')
    expect(reply?.toolCalls).toEqual([
      expect.objectContaining({ tool: 'search_documents', status: 'completed', input: { query: 'buck' }, output: expect.stringContaining('TPS63020') }),
    ])
    expect(reply?.costMicroUsd).toBe(1700)
    expect(reply?.isStreaming).toBe(false)
    // Streamed, not polled: the events were read as one event stream, with the deltas.
    const watched = front.forwarded.filter(item => item.path.endsWith('/events'))
    expect(watched.length).toBeGreaterThan(0)
    expect(watched.every(item => String(item.headers.accept).includes('text/event-stream'))).toBe(true)
    // The prompt carried what the person had open.
    expect(sim.commandsOf('prompt')[0]?.body).toMatchObject({ text: 'Which part makes the 3.3 V rail?', contextRefs: ['buck-boost-converter'] })
  })

  it('reads the same turn by long-poll when the proxy cannot stream', async () => {
    front.streams = false
    const svc = service()
    const store = storeOf(svc)
    const { id } = await svc.createSession({ title: null })
    store.setSession(id)
    await until(() => store.getState().conversationState === 'ready', 'the conversation to load')
    sim.scripts.push([
      { kind: 'tool', name: 'read_document', args: { documentId: 'buck-boost-converter' }, result: 'TPS63020' },
      { kind: 'say', text: 'It is the TPS63020.' },
    ])
    store.send('Name the regulator.')
    await until(() => store.getState().streaming, 'the reply to start')
    await until(() => !store.getState().streaming, 'the reply to end')
    const reply = store.getState().messages.at(-1)
    expect(reply?.content).toBe('It is the TPS63020.')
    expect(reply?.toolCalls.map(call => [call.tool, call.status])).toEqual([['read_document', 'completed']])
    expect(front.forwarded.some(item => item.path.endsWith('/events') && !String(item.headers.accept).includes('text/event-stream'))).toBe(true)
  })

  it('steers the reply under way, then shows each message where the reply took it', async () => {
    const svc = service()
    const store = storeOf(svc)
    const { id } = await svc.createSession({ title: null })
    store.setSession(id)
    await until(() => store.getState().conversationState === 'ready', 'the conversation to load')
    expect(store.getState().steerWhileStreaming).toBe(true)
    sim.scripts.push([
      { kind: 'say', text: 'Listing every component.' },
      { kind: 'hold' },
      { kind: 'say', text: 'Only the power parts: BQ25185, TPS63020.' },
    ])
    store.send('List every component.')
    await sim.held()
    store.send('Only the power-related parts, please.')
    await until(() => sim.commandsOf('steer').length === 1, 'the steer to reach the host')
    expect(store.getState().messages.at(-1)).toMatchObject({ role: 'user', content: 'Only the power-related parts, please.' })
    sim.go()
    await until(() => !store.getState().streaming, 'the reply to end')
    await until(() => store.getState().messages.length === 4 && store.getState().conversationState === 'ready', 'the record to settle')
    expect(store.getState().messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'List every component.'],
      ['assistant', 'Listing every component.'],
      ['user', 'Only the power-related parts, please.'],
      ['assistant', 'Only the power parts: BQ25185, TPS63020.'],
    ])
    expect(sim.commandsOf('steer')[0]?.body).toMatchObject({ op: 'steer', text: 'Only the power-related parts, please.' })
  })

  it('stops the reply', async () => {
    const svc = service()
    const store = storeOf(svc)
    const { id } = await svc.createSession({ title: null })
    store.setSession(id)
    await until(() => store.getState().conversationState === 'ready', 'the conversation to load')
    sim.scripts.push([{ kind: 'say', text: 'Reading.' }, { kind: 'hold' }, { kind: 'say', text: 'never said' }])
    store.send('Read everything.')
    await sim.held()
    await svc.abort(id)
    await until(() => !store.getState().streaming, 'the reply to stop')
    expect(sim.commandsOf('abort')).toHaveLength(1)
    const reply = store.getState().messages.at(-1)
    expect(reply?.content).toBe('Reading.')
    expect(reply?.isStreaming).toBe(false)
    expect(store.getState().sendState).toBe('ready')
    expect(sim.sessions.get(id)?.events.at(-1)).toMatchObject({ type: 'run.settled', payload: { aborted: true } })
  })

  it('lists the person\'s own conversations, and a reload finds the conversation and drives it again', async () => {
    const svc = service()
    const store = storeOf(svc)
    const { id } = await svc.createSession({ title: null })
    svc.bindSlotSession(0, id)
    store.setSession(id)
    await until(() => store.getState().conversationState === 'ready', 'the conversation to load')
    sim.scripts.push([{ kind: 'tool', name: 'search_documents', args: { query: 'charger' }, result: 'BQ25185' }, { kind: 'say', text: 'The BQ25185.' }])
    store.send('Which part charges the battery?')
    await until(() => store.getState().streaming, 'the reply to start')
    await until(() => !store.getState().streaming, 'the reply to end')
    // Another graph's conversation and a member's are not listed.
    await service({ graph: 'other-graph' }).createSession({ title: null })
    await service({ key: front.memberKey }).createSession({ title: null })
    const listed = await svc.listSessions()
    expect(listed.map(row => [row.id, row.title])).toEqual([[id, 'Which part charges the battery?']])

    // A reload: a new page with the same browser storage.
    const reloaded = service()
    expect(reloaded.slotSessions()[0]).toBe(id)
    expect((await reloaded.listSessions()).map(row => row.id)).toContain(id)
    const hydrated = await reloaded.hydrateSession(id)
    expect(hydrated.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'Which part charges the battery?'],
      ['assistant', 'The BQ25185.'],
    ])
    expect(hydrated.messages[1]?.toolCalls).toEqual([expect.objectContaining({ tool: 'search_documents', status: 'completed', output: 'BQ25185' })])
    const again = storeOf(reloaded)
    again.setSession(id)
    await until(() => again.getState().conversationState === 'ready', 'the reloaded conversation')
    sim.scripts.push([{ kind: 'say', text: 'Yes, the same one.' }])
    again.send('Is that the same charger?')
    await until(() => again.getState().streaming, 'the next reply to start')
    await until(() => !again.getState().streaming, 'the next reply to end')
    expect(again.getState().sendState).toBe('ready')
    expect(again.getState().messages.at(-1)?.content).toBe('Yes, the same one.')
    const claims = sim.received.filter(item => item.path.endsWith('/claim'))
    expect(claims.at(-1)?.headers['x-vehicle-client-id']).toBe(sim.sessions.get(id)?.lease?.clientId)
  })

  it('names a conversation the shell opened under its placeholder by what was said in it', async () => {
    const svc = service()
    const store = storeOf(svc)
    // The shell opens its first chat as `organism-chat` (ensureChatClaim).
    const { id, title } = await svc.createSession({ title: 'organism-chat' })
    expect(title).toBeNull()
    expect(sim.received.find(item => item.path === '/sessions' && item.method === 'POST')?.body.title).toBeUndefined()
    store.setSession(id)
    await until(() => store.getState().conversationState === 'ready', 'the conversation to load')
    sim.scripts.push([{ kind: 'say', text: 'The TPS63020.' }])
    store.send('Which part is the regulator?')
    await until(() => store.getState().streaming, 'the reply to start')
    await until(() => !store.getState().streaming, 'the reply to end')
    expect((await svc.listSessions()).map(row => row.title)).toEqual(['Which part is the regulator?'])
    // A title of its own wins.
    const named = await svc.createSession({ title: 'Power budget' })
    svc.bindSlotSession(1, named.id)
    expect((await svc.listSessions()).find(row => row.id === named.id)?.title).toBe('Power budget')
  })

  it('tells the person when another browser drives the conversation', async () => {
    const svc = service()
    const { id } = await svc.createSession({ title: null })
    const elsewhere = makeRideChatService({
      baseUrl: front.vehicleBase,
      graphId: () => GRAPH,
      token: () => front.key,
      storage: new MemoryStorage(),
    })
    await expect(elsewhere.startTurn(id, 'hi')).rejects.toThrow(/This conversation is open in another tab or browser/)
    expect(sim.commandsOf('prompt')).toHaveLength(0)
    // The same person: offered to continue there, not refused for good.
    expect(elsewhere.driverState(id)).toEqual({ kind: 'elsewhere', canTakeOver: true })
  })
})

describe('a Sophia whose gardend could not start chat', () => {
  it('says why where the panel says what the chat may do, before anything is sent', () => {
    const reason = "Chat needs Node.js 22.19 or newer, and there is no node on gardend's PATH. Install Node.js 22.19 or newer, then restart gardend."
    const svc = makeRideChatService({
      baseUrl: front.vehicleBase,
      graphId: () => GRAPH,
      token: () => front.key,
      role: () => 'owner',
      storage,
      unavailable: () => reason,
    })
    expect(svc.access?.(null)).toEqual({ mode: 'read', basis: 'unavailable', role: 'owner', reason })
    expect(storeOf(svc).getState().accessNote).toEqual({ mode: 'read', label: reason })
    // Without a reason the chat is what the role allows, as before.
    expect(service().access?.(null)).toEqual({ mode: 'write', basis: 'role', role: 'owner' })
  })
})

describe('the store without steer (the hosted chat)', () => {
  it('keeps one reply at a time: a send while streaming is not taken', async () => {
    const svc = service()
    const { steer: _steer, ...withoutSteer } = svc
    void _steer
    const hosted = Object.assign(Object.create(Object.getPrototypeOf(svc)), withoutSteer, {
      get activeSlot() {
        return svc.activeSlot
      },
    })
    const store = storeOf(hosted)
    expect(store.getState().steerWhileStreaming).toBe(false)
    const { id } = await svc.createSession({ title: null })
    store.setSession(id)
    await until(() => store.getState().conversationState === 'ready', 'the conversation to load')
    sim.scripts.push([{ kind: 'say', text: 'One.' }, { kind: 'hold' }, { kind: 'say', text: 'Two.' }])
    store.send('Count.')
    await sim.held()
    store.send('And three?')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(sim.commandsOf('steer')).toHaveLength(0)
    expect(sim.commandsOf('prompt')).toHaveLength(1)
    sim.go()
    await until(() => !store.getState().streaming, 'the reply to end')
  })
})
