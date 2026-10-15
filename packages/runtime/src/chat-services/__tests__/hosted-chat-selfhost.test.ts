/**
 * The self-host's chat: the hosted ChatService over a self-host's gardend proxy to its own Choreograph
 * (NO MOCKS: two real HTTP servers, the gardend-shaped proxy in front of the scripted Choreograph's own
 * `/api/…` face, and every request crosses both sockets).
 *
 * What it holds (survey 2026-10-13, slice S1):
 *   - the chat reaches Choreograph at `${origin}/services/choreograph/api` with the self-host key, through
 *     `assembleChatServices`' endpoint option, and speaks as the user gardend asserts (`default`), which
 *     Choreograph requires of an invocation's `actorRef`;
 *   - while gardend refuses the event stream (501, 0.1.3), a turn is followed through the JSON face, every
 *     word in order; once gardend streams, the stream is used;
 *   - the chat-session list names its graph, and keeps only that graph's rows;
 *   - no gateway is asked anything: no voices, no balance;
 *   - and without `viaLocalService` (the hosted chat) nothing of this happens: a refused stream is an error.
 */
import type { ChatEvent } from '@shrubbery/chat-kernel'
import type { EditorScope, ShrubberyContract } from '@shrubbery/nucleus'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleChatServices } from '../assemble.js'
import type { ChatService } from '../chat-service.js'
import {
  ChoreographSim,
  completed,
  delta,
  plainTurn,
  started,
  turnDone,
  type TurnScript,
} from './fixtures/choreograph-sim.js'
import { GARDEND_PROFILE_ID, GARDEND_SSE_REFUSAL, GardendProxy } from './fixtures/gardend-proxy.js'
import { SobremesaRoutes } from './fixtures/sobremesa-routes.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

/**
 * The page is on gardend's own origin, as a self-host's is: happy-dom then sends the bearer (it strips
 * Authorization from a cross-origin request) and asks no CORS. The window is shared with sibling files,
 * so its URL is put back after each test.
 */
interface HappyDomControl {
  readonly happyDOM?: { setURL(url: string): void }
  readonly location: { href: string }
}
const page = (): HappyDomControl => globalThis.window as unknown as HappyDomControl

async function standUp(): Promise<{ sim: ChoreographSim; proxy: GardendProxy; restore: () => Promise<void> }> {
  const sim = new ChoreographSim()
  await sim.start()
  const proxy = new GardendProxy(sim)
  await proxy.start()
  const original = page().location.href
  page().happyDOM?.setURL(`${proxy.base}/`)
  return {
    sim,
    proxy,
    restore: async () => {
      page().happyDOM?.setURL(original)
      await proxy.stop()
      await sim.stop()
    },
  }
}

const GRAPH = 'kitchen-notes'
const OTHER_GRAPH = 'garden-plans'
const scope: EditorScope = { centerMode: 'home', graphId: null, documentId: null }

/**
 * The self-host's gardend contract as the shell holds it: its user is the self-host's own
 * (`garden-self-host`), not the one gardend asserts to Choreograph, and its graph route is gardend's
 * MCP cell, not a Choreograph. The chat must take neither.
 */
function selfHostContract(): ShrubberyContract {
  return {
    auth: { token: () => 'contract-token', userId: () => 'garden-self-host' },
    runtime: { graphBaseUrl: (graphId: string) => `http://127.0.0.1:9/cell/${graphId}` },
  } as ShrubberyContract
}

function chatThrough(
  proxy: GardendProxy,
  storage: MemoryStorage,
  options: { userId?: string; viaLocalService?: boolean; token?: string; graphOwner?: string | null } = {},
): ChatService {
  const owner = options.graphOwner === undefined ? `user:${GARDEND_PROFILE_ID}` : options.graphOwner
  return assembleChatServices(selfHostContract(), () => scope, 'hosted', {
    graphId: () => GRAPH,
    endpoint: {
      graphBaseUrl: () => proxy.chatBase,
      token: () => options.token ?? proxy.key,
      userId: () => options.userId ?? GARDEND_PROFILE_ID,
      ...(owner ? { graphOwner: () => owner } : {}),
    },
    hosted: {
      storage,
      viaLocalService: options.viaLocalService ?? true,
      resolveAttempts: 3,
      resolveDelayMs: 0,
      sleep: async () => undefined,
    },
  })
}

async function collect(handle: Awaited<ReturnType<ChatService['startTurn']>>) {
  const events: ChatEvent[] = []
  for await (const item of handle.events) events.push(item)
  return { events, outcome: await handle.done }
}

const words = (events: readonly ChatEvent[]): string =>
  events.flatMap(event => (event.type === 'text' ? [event.content] : [])).join('')

/** A reply that becomes durable in two parts, between two reads of the events. */
const IN_TWO_PARTS: TurnScript = {
  answer: 'Your kitchen notes mention basil twice.',
  stages: [
    [started(), delta('Your kitchen notes')],
    [delta(' mention basil twice.'), turnDone(), completed('Your kitchen notes mention basil twice.')],
  ],
}

describe('the self-host chat, through gardend to its own Choreograph', () => {
  let sim: ChoreographSim
  let proxy: GardendProxy
  let restore: () => Promise<void>
  beforeEach(async () => {
    ;({ sim, proxy, restore } = await standUp())
  })
  afterEach(async () => restore())

  it('launches and follows up through the proxy, with the key, as the user gardend asserts', async () => {
    sim.queueTurn(plainTurn('Hello from your own Sophia.'))
    sim.queueTurn(plainTurn('Basil, mint and thyme.', { echo: true }))
    const chat = chatThrough(proxy, new MemoryStorage())
    const created = await chat.createSession()

    const first = await collect(await chat.startTurn(created.id, 'Hello?'))
    expect(first.outcome).toEqual({ state: 'completed' })
    expect(words(first.events)).toBe('Hello from your own Sophia.')

    const second = await collect(await chat.startTurn(created.id, 'Which herbs do I grow?'))
    expect(second.outcome).toEqual({ state: 'completed' })
    expect(words(second.events)).toBe('Basil, mint and thyme.')

    // The invocation is gardend's user's, for this graph, and reached Choreograph's own path.
    const [invocation] = sim.invocations()
    expect(invocation.path).toBe('/api/invocations')
    expect(invocation.body.actorRef).toBe(`user:${GARDEND_PROFILE_ID}`)
    expect(invocation.body.graph).toEqual({ graphId: GRAPH, ownerPrincipal: 'user:default' })
    // The browser sent the key to gardend; Choreograph saw gardend's identity and never the key.
    const forwarded = proxy.forwarded()
    expect(forwarded.length).toBeGreaterThan(0)
    expect(forwarded.every(item => item.authorization === `Bearer ${proxy.key}`)).toBe(true)
    expect(sim.received.every(item => item.direct)).toBe(true)
    expect(sim.received.every(item => item.headers.authorization === undefined)).toBe(true)
    expect(sim.received.every(item => item.headers['x-user-id'] === GARDEND_PROFILE_ID)).toBe(true)
    // The follow-up went to the session's commands, below the same base.
    expect(sim.calls('/commands', 'POST')).toHaveLength(1)
    expect(sim.calls('/commands', 'POST')[0].path).toMatch(/^\/api\/agent-sessions\/ags_\w+\/commands$/)
  })

  it('follows a turn through the JSON face once gardend refuses the stream, every word in order', async () => {
    sim.queueTurn(IN_TWO_PARTS)
    sim.queueTurn({
      answer: 'Twice: in March and in May.',
      stages: [
        [started(), delta('Twice:')],
        [delta(' in March')],
        [delta(' and in May.'), turnDone(), completed('Twice: in March and in May.')],
      ],
    })
    const chat = chatThrough(proxy, new MemoryStorage())
    const created = await chat.createSession()

    const first = await collect(await chat.startTurn(created.id, 'What about basil?'))
    expect(first.outcome).toEqual({ state: 'completed' })
    expect(words(first.events)).toBe('Your kitchen notes mention basil twice.')
    expect(first.events.filter(event => event.type === 'done')).toEqual([
      { type: 'done', output: 'Your kitchen notes mention basil twice.' },
    ])
    const second = await collect(await chat.startTurn(created.id, 'When?'))
    expect(words(second.events)).toBe('Twice: in March and in May.')

    // The stream was asked for once, refused with gardend's 501, and never again: the second turn polled
    // from its first read. Choreograph saw no stream request at all.
    const streamAsks = proxy.received.filter(item => item.accept.includes('text/event-stream'))
    expect(streamAsks).toHaveLength(1)
    expect(streamAsks[0].status).toBe(501)
    const eventReads = sim.calls('/events', 'GET')
    expect(eventReads.length).toBeGreaterThan(2)
    expect(eventReads.every(item => !String(item.headers.accept ?? '').includes('text/event-stream'))).toBe(true)
    expect(GARDEND_SSE_REFUSAL).toMatch(/JSON polling/)
  })

  it('streams when gardend streams (the later garden slice), and polls nothing in its place', async () => {
    proxy.streams = true
    sim.queueTurn(IN_TWO_PARTS)
    const chat = chatThrough(proxy, new MemoryStorage())
    const created = await chat.createSession()

    const turn = await collect(await chat.startTurn(created.id, 'What about basil?'))
    expect(turn.outcome).toEqual({ state: 'completed' })
    expect(words(turn.events)).toBe('Your kitchen notes mention basil twice.')
    expect(proxy.received.some(item => item.status === 501)).toBe(false)
    const streamed = sim.calls('/events', 'GET').filter(item => String(item.headers.accept ?? '').includes('text/event-stream'))
    expect(streamed.length).toBeGreaterThan(0)
  })

  it('must speak as gardend\'s user: as the self-host\'s own id, Choreograph refuses the first message', async () => {
    // Why the chat's user is `default` and not the shell's `garden-self-host`: Choreograph checks it.
    const chat = chatThrough(proxy, new MemoryStorage(), { userId: 'garden-self-host' })
    const created = await chat.createSession()

    // A refusal before any run exists is definite: the send itself is refused, nothing is left uncertain.
    await expect(chat.startTurn(created.id, 'Hello?')).rejects.toThrow(/access to chat/)
    expect(sim.sessions.size).toBe(0)
    const refusals = sim.invocations().map(item => item.body.actorRef)
    expect(refusals.length).toBeGreaterThan(0)
    expect(new Set(refusals)).toEqual(new Set(['user:garden-self-host']))
  })

  it('names the graph\'s owner: without it the local Choreograph will not start either chat (as de822be refused live)', async () => {
    // What the first live message under Vera's gardend got: no gateway forced the owner in, so the Domain Agent's
    // 409 came back instead of its 404, and the chat never fell back to the workspace assistant.
    const chat = chatThrough(proxy, new MemoryStorage(), { graphOwner: null })
    const created = await chat.createSession()

    await expect(chat.startTurn(created.id, 'Hello?')).rejects.toThrow(/owner-scoped host invocation/)
    expect(sim.sessions.size).toBe(0)
    expect(sim.invocations().every(item => item.body.graph?.ownerPrincipal === undefined)).toBe(true)
  })

  it('lists this graph\'s conversations only: the query names the graph, and another graph\'s rows are left out', async () => {
    const sobremesa = new SobremesaRoutes(sim)
    sobremesa.sessions = [
      { sessionId: 'ags_kitchen01', title: 'Herbs', graphId: GRAPH, createdAt: sim.clock - 60_000 },
      // What an older local Choreograph that ignored `graph_id` would also list.
      { sessionId: 'ags_garden001', title: 'Tomatoes', graphId: OTHER_GRAPH, createdAt: sim.clock - 30_000 },
    ]
    const chat = chatThrough(proxy, new MemoryStorage())

    const listed = await chat.listConversations!()

    expect(listed.map(item => item.title)).toEqual(['Herbs'])
    const [asked] = sim.received.filter(item => item.query.get('view') === 'chat-sessions')
    expect(asked.path).toBe('/api/workflows/runs')
    expect(asked.query.get('graph_id')).toBe(GRAPH)
  })

  it('asks no gateway anything: no voices, no balance', async () => {
    const sobremesa = new SobremesaRoutes(sim)
    const chat = chatThrough(proxy, new MemoryStorage())

    expect(await chat.balance!()).toBeNull()
    await chat.probeCapabilities!()

    expect(chat.models()).toEqual([])
    expect(sobremesa.asked.catalogue).toBe(0)
    expect(sobremesa.asked.balance).toBe(0)
    expect(proxy.received.some(item => /chat\/models|billing/.test(item.path))).toBe(false)
  })
})

describe('the hosted chat is unchanged without viaLocalService', () => {
  let sim: ChoreographSim
  let proxy: GardendProxy
  let restore: () => Promise<void>
  beforeEach(async () => {
    ;({ sim, proxy, restore } = await standUp())
  })
  afterEach(async () => restore())

  it('takes a refused stream as an error, and its session list names no graph', async () => {
    sim.queueTurn(plainTurn('Never seen.'))
    new SobremesaRoutes(sim).sessions = []
    const chat = chatThrough(proxy, new MemoryStorage(), { viaLocalService: false })
    const created = await chat.createSession()

    const turn = await collect(await chat.startTurn(created.id, 'Hello?'))
    expect(turn.outcome.state).toBe('failed')
    expect(turn.events.find(event => event.type === 'error')).toMatchObject({
      message: expect.stringContaining('GET Agent Session events → 501'),
    })
    expect(sim.calls('/events', 'GET')).toHaveLength(0)

    await chat.listConversations!()
    const asked = proxy.received.filter(item => item.query.get('view') === 'chat-sessions')
    expect(asked).toHaveLength(1)
    expect(asked[0].query.has('graph_id')).toBe(false)
  })
})
