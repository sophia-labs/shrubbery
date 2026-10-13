/**
 * The races and the wear of the hosted chat, held to the independent desk-check of the voice
 * branch (`S2-desk-check-29d2160.md`, findings 4, 5, 6, 8 and 9), against a scripted
 * Choreograph over a real socket (NO MOCKS). What makes a race exact here is the network,
 * not a clock: `holdingResponse` lets the host act on a request and holds the answer back;
 * `losingResponse` lets the host act and tells the caller the connection dropped
 * (fixtures/slow-network.ts; both run the real `fetch`). Each test names the defect it guards.
 */
import type { ChatEvent } from '@shrubbery/chat-kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChatServiceFailure, NO_CAPABILITIES } from '../chat-service.js'
import { makeHostedChatService, purgeHostedChatWindows } from '../hosted-chat-service.js'
import {
  ChoreographSim,
  DOMAIN_WORKFLOW,
  delta,
  failingTurn,
  plainTurn,
  started,
  workspaceWorkflow,
} from './fixtures/choreograph-sim.js'
import { CONVERSATION_ID, MemoryArchive, REVISION_ID, turn } from './fixtures/memory-archive.js'
import { holdingResponse, losingResponse } from './fixtures/slow-network.js'
import { SobremesaRoutes } from './fixtures/sobremesa-routes.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

/** A browser's storage as a whole: it can be walked, and it can be full. */
class BrowserStorage extends MemoryStorage {
  /** Total characters (keys and values) it will hold; Infinity is "not full". */
  capacity = Number.POSITIVE_INFINITY
  get length(): number { return this.values.size }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  private used(without?: string): number {
    let total = 0
    for (const [key, value] of this.values) if (key !== without) total += key.length + value.length
    return total
  }
  override setItem(key: string, value: string): void {
    if (this.used(key) + key.length + value.length > this.capacity) {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
    super.setItem(key, value)
  }
}

const GRAPH = 'atelier-20260929'
const HOUSE = 'google/gemini-2.5-flash'
const ROOT = `shrubbery:c2chat:v1:probe:${GRAPH}`

interface Options {
  storage?: MemoryStorage
  fetchImpl?: typeof fetch
  graphId?: () => string
  readTimeoutMs?: number
  resolveDelayMs?: number
  streamDeadlineMs?: number
  sleep?: (ms: number) => Promise<void>
  archive?: MemoryArchive
}

function chatOver(sim: ChoreographSim, options: Options = {}) {
  return makeHostedChatService({
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.archive ? { archive: options.archive } : {}),
    ...(options.readTimeoutMs !== undefined ? { readTimeoutMs: options.readTimeoutMs } : {}),
    ...(options.streamDeadlineMs !== undefined ? { streamDeadlineMs: options.streamDeadlineMs } : {}),
    gatewayBaseUrl: sim.base,
    graphBaseUrl: (graph: string) => sim.graphBase(graph),
    graphId: options.graphId ?? (() => GRAPH),
    userId: () => 'probe',
    token: () => 'jwt',
    storage: options.storage ?? new MemoryStorage(),
    resolveAttempts: 3,
    resolveDelayMs: options.resolveDelayMs ?? 0,
    sleep: options.sleep ?? (async () => undefined),
  })
}

async function collect(handle: Awaited<ReturnType<ReturnType<typeof chatOver>['startTurn']>>) {
  const events: ChatEvent[] = []
  for await (const item of handle.events) events.push(item)
  return { events, outcome: await handle.done }
}

async function say(chat: ReturnType<typeof chatOver>, text: string): Promise<string> {
  const created = await chat.createSession()
  await collect(await chat.startTurn(created.id, text))
  return created.id
}

const isPost = (suffix: string) => ({ url, method }: { url: URL; method: string }) =>
  method === 'POST' && url.pathname.endsWith(suffix)

describe('the list of conversations and a launch the host has, but this browser has not yet heard of (finding 4)', () => {
  let sim: ChoreographSim
  let routes: SobremesaRoutes
  beforeEach(async () => {
    sim = new ChoreographSim()
    routes = new SobremesaRoutes(sim)
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('lists a conversation once when it holds the host’s run but has not yet bound its session', async () => {
    // Defect guarded: rows were matched to conversations by session id only, so a conversation that
    // held the run and was still to resolve its session was adopted a second time from the host's
    // own row: two conversations for one, and two ways to send the same words.
    const storage = new MemoryStorage()
    const id = await say(chatOver(sim, { storage }), 'What is a monad?')
    const key = `${ROOT}:descriptor:${id}`
    const stored = JSON.parse(storage.getItem(key)!)
    expect(stored.runId).toBeTruthy()
    delete stored.agentSessionId
    storage.setItem(key, JSON.stringify(stored))
    const session = sim.session()
    routes.sessions = [{
      sessionId: session.id,
      runId: session.runId,
      title: 'What is a monad?',
      model: session.model,
      createdAt: session.createdAt,
      lastActivityAt: session.updatedAt,
    }]

    const later = chatOver(sim, { storage })
    const listed = await later.listConversations!()
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe(id)
    expect(await later.listSessions()).toHaveLength(1)
  })

  it('gives a launch whose answer was lost back to the conversation that sent it, and lists no second one', async () => {
    // Defect guarded: the host's list showed the run before this browser had settled its lost
    // launch. It was adopted as a conversation of its own; the launch that started it then found its
    // run taken, decided it had never started, and dropped the words its person had sent.
    sim.clock = Date.now() - 6 * 60_000
    const storage = new MemoryStorage()
    let posts = 0
    const lossy = losingResponse(request => isPost('/invocations')(request) && ++posts === 2)
    const lost = chatOver(sim, { storage, fetchImpl: lossy })
    const created = await lost.createSession()
    await expect(lost.startTurn(created.id, 'Was this heard?')).rejects.toBeInstanceOf(ChatServiceFailure)
    const session = sim.session()

    // A page load later: the host has the run, and the answer never came back.
    const key = `${ROOT}:descriptor:${created.id}`
    const stored = JSON.parse(storage.getItem(key)!)
    expect(stored.invocationPending).toBe(true)
    expect(stored.runId).toBeUndefined()
    stored.invocationSubmittedAt = new Date(session.createdAt + 1_000).toISOString()
    storage.setItem(key, JSON.stringify(stored))
    routes.sessions = [{
      sessionId: session.id,
      runId: session.runId,
      title: 'Was this heard?',
      createdAt: session.createdAt,
      lastActivityAt: session.updatedAt,
    }]

    const later = chatOver(sim, { storage })
    const listed = await later.listConversations!()
    expect(listed).toHaveLength(1)
    expect(await later.listSessions()).toHaveLength(1)
    // It is the conversation that sent the words, bound to the run, still holding them.
    const shown = await later.hydrateSession(created.id)
    expect(shown.messages.map(message => message.content)).toContain('Was this heard?')
    expect(JSON.parse(storage.getItem(key)!).runId).toBe(session.runId)
  })

  it('waits, and adopts nothing, while a launch of this graph is too young to be settled either way', async () => {
    // A launch sent seconds ago whose answer was lost cannot yet be told from one that never
    // started (the host may still be admitting it): the list does not guess.
    const storage = new MemoryStorage()
    let posts = 0
    const lossy = losingResponse(request => isPost('/invocations')(request) && ++posts === 2)
    const lost = chatOver(sim, { storage, fetchImpl: lossy })
    const created = await lost.createSession()
    await expect(lost.startTurn(created.id, 'Just sent')).rejects.toBeInstanceOf(ChatServiceFailure)
    const session = sim.session()
    routes.sessions = [{ sessionId: session.id, runId: session.runId, title: 'Just sent', createdAt: session.createdAt, lastActivityAt: session.updatedAt }]

    const later = chatOver(sim, { storage })
    const listed = await later.listConversations!()
    expect(await later.listSessions()).toHaveLength(1)
    expect(listed.map(row => row.id)).toEqual([created.id])
  })
})

describe('a turn is in flight from the moment it is sent (finding 5)', () => {
  let sim: ChoreographSim
  beforeEach(async () => {
    sim = new ChoreographSim()
    new SobremesaRoutes(sim)
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('a read of the conversation while a follow-up is still being submitted leaves its events and its command to the stream', async () => {
    // Defect guarded (the duplicate bubble again): the in-flight marker went up only after the
    // submit had answered. A read in between took the cursor past the turn's events, settled the
    // command the stream was to follow, and seeded a base that already held the reply, or none of
    // the conversation at all.
    sim.queueTurn(plainTurn('First reply.'))
    sim.queueTurn(plainTurn('Second reply.'))
    const slow = holdingResponse(isPost('/commands'))
    const chat = chatOver(sim, { fetchImpl: slow.fetchImpl })
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'One'))

    slow.arm()
    const starting = chat.startTurn(created.id, 'Two')
    await slow.reached // the host has the message and has answered it; nobody has heard back
    const midway = await chat.hydrateSession(created.id)
    slow.release()
    const handle = await starting

    // What the store does next: seed the base from a read, then follow the stream.
    const seeded = (await chat.hydrateSession(created.id)).messages
    const followed = await collect(handle)

    expect(midway.messages.map(message => message.content)).toEqual(['One', 'First reply.', 'Two'])
    expect(seeded.map(message => message.content)).toEqual(['One', 'First reply.', 'Two'])
    expect(followed.outcome).toEqual({ state: 'completed' })
    expect(followed.events.filter(event => event.type === 'text').map(event => (event as { content: string }).content).join(''))
      .toBe('Second reply.')
    const settled = (await chat.hydrateSession(created.id)).messages
    expect(settled.map(message => message.content)).toEqual(['One', 'First reply.', 'Two', 'Second reply.'])
  })

  it('does not judge a turn that ends while the conversation is being read: its stream still delivers it', async () => {
    // Defect guarded (caught by the store's own test while this was being fixed): a read that asked
    // "is a turn in flight?" only after its snapshot had come back found the answer "no" for a turn that had
    // ended in between, took the idle path on a snapshot older than the turn's end, and threw the turn's
    // failure out of the read as "Agent Session command failed: failed".
    sim.queueTurn(plainTurn('First reply.'))
    sim.queueTurn(failingTurn('the provider closed the connection'))
    const chat = chatOver(sim)
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'One'))

    const handle = await chat.startTurn(created.id, 'Two')
    const seeded = await chat.hydrateSession(created.id)
    const followed = await collect(handle)
    expect(seeded.messages.map(message => message.content)).toEqual(['One', 'First reply.', 'Two'])
    expect(followed.outcome.state).toBe('failed')
    expect((followed.outcome as { failure: ChatServiceFailure }).failure.message).toBe('the provider closed the connection')
  })

  it('takes the marker down when the submit fails, so the conversation can be read and sent again', async () => {
    sim.queueTurn(plainTurn('First reply.'))
    let refuse = false
    sim.extraRoutes.unshift(request =>
      refuse && request.method === 'POST' && request.route.endsWith('/commands')
        ? { status: 500, body: { error: { code: 'internal', message: 'no' } } }
        : undefined)
    const chat = chatOver(sim)
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'One'))

    refuse = true
    await expect(chat.startTurn(created.id, 'Two')).rejects.toBeInstanceOf(ChatServiceFailure)
    // A marker left behind would freeze the cursor and hide the conversation as "in flight" for good.
    refuse = false
    sim.queueTurn(plainTurn('Second reply.'))
    const again = await collect(await chat.startTurn(created.id, 'Two'))
    expect(again.outcome).toEqual({ state: 'completed' })
    const settled = (await chat.hydrateSession(created.id)).messages
    expect(settled.map(message => message.content)).toEqual(['One', 'First reply.', 'Two', 'Second reply.'])
  })
})

describe('what a browser asks of the host, and how long it waits (finding 6)', () => {
  let sim: ChoreographSim
  let routes: SobremesaRoutes
  beforeEach(async () => {
    sim = new ChoreographSim()
    routes = new SobremesaRoutes(sim)
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true })]
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('does not let a probe that comes back for a graph the person has left take away what the graph they are in advertises', async () => {
    // Defect guarded: the answer for graph A landed after the person was in graph B and
    // replaced B's capabilities and roster: the picker vanished until the next look.
    let graph = 'graph-a'
    const slow = holdingResponse(({ url }) => url.pathname === '/g/graph-a/workflows', { armed: true })
    const chat = chatOver(sim, { graphId: () => graph, fetchImpl: slow.fetchImpl })
    const first = chat.probeCapabilities!()
    await slow.reached
    graph = 'graph-b'
    await chat.probeCapabilities!()
    expect(chat.capabilities).toEqual({ voice: true, continuation: true })
    expect(chat.models().length).toBeGreaterThan(0)

    slow.release()
    await first
    expect(chat.capabilities).toEqual({ voice: true, continuation: true })
    expect(chat.models().length).toBeGreaterThan(0)
  })

  it('gives up on a registry that never answers, and offers nothing new', async () => {
    // Defect guarded: a wedged proxy left the probe (and every send, which reads the registry first) waiting for ever.
    sim.extraRoutes.unshift(request => (request.route === '/workflows' ? { hang: true } : undefined))
    const chat = chatOver(sim, { readTimeoutMs: 80 })
    const began = Date.now()
    await expect(chat.probeCapabilities!()).resolves.toBe(NO_CAPABILITIES)
    expect(Date.now() - began).toBeLessThan(3_000)
    expect(chat.models()).toEqual([])
  }, 6_000)

  it('gives up on a catalogue that never answers, and leaves the roster empty', async () => {
    sim.extraRoutes.unshift(request => (request.route === '/chat/models' ? { hang: true } : undefined))
    const chat = chatOver(sim, { readTimeoutMs: 80 })
    const began = Date.now()
    await expect(chat.probeCapabilities!()).resolves.toMatchObject({ voice: true })
    expect(Date.now() - began).toBeLessThan(3_000)
    expect(chat.models()).toEqual([])
  }, 6_000)

  it('gives up on a session list that never answers, and lists what this browser holds', async () => {
    const storage = new MemoryStorage()
    const mine = await say(chatOver(sim, { storage }), 'Started here')
    routes.sessions = []
    sim.extraRoutes.unshift(request => (request.query.get('view') === 'chat-sessions' ? { hang: true } : undefined))
    const chat = chatOver(sim, { storage, readTimeoutMs: 80 })
    const began = Date.now()
    const listed = await chat.listConversations!()
    expect(Date.now() - began).toBeLessThan(3_000)
    expect(listed.map(row => row.id)).toEqual([mine])
  }, 6_000)

  it('fails a send in words, with nothing sent, when the registry does not answer in time; and the same conversation can be sent again', async () => {
    // Defect guarded: a registry that never answered at the moment of sending left the send waiting for ever;
    // once it is given up on, what the person reads must be about the workspace, not a raw "signal timed out".
    let wedged = true
    sim.extraRoutes.unshift(request => (wedged && request.route === '/workflows' ? { hang: true } : undefined))
    const chat = chatOver(sim, { readTimeoutMs: 80 })
    const created = await chat.createSession()
    await expect(chat.startTurn(created.id, 'Hello')).rejects.toMatchObject({
      phase: 'submit',
      recovery: 'resubmit',
      message: expect.stringMatching(/did not answer in time.*Nothing was sent/i),
    })
    expect(sim.invocations()).toEqual([])
    wedged = false
    expect((await collect(await chat.startTurn(created.id, 'Hello'))).outcome).toEqual({ state: 'completed' })
  }, 6_000)

  it('still reads and sends where the browser has no AbortSignal.timeout (Safari before 16)', async () => {
    // Defect guarded: the registry is read on the way to every first message, so a browser without the method
    // could not have sent one at all.
    const original = AbortSignal.timeout
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true, writable: true })
    try {
      const chat = chatOver(sim)
      await expect(chat.probeCapabilities!()).resolves.toEqual({ voice: true, continuation: true })
      expect(chat.models().length).toBeGreaterThan(0)
      const created = await chat.createSession()
      expect((await collect(await chat.startTurn(created.id, 'Hello'))).outcome).toEqual({ state: 'completed' })
      // And where it is given up on, it still is.
      sim.extraRoutes.unshift(request => (request.route === '/workflows' ? { hang: true } : undefined))
      const patient = chatOver(sim, { readTimeoutMs: 80 })
      const began = Date.now()
      await expect(patient.probeCapabilities!()).resolves.toBe(NO_CAPABILITIES)
      expect(Date.now() - began).toBeLessThan(3_000)
    } finally {
      Object.defineProperty(AbortSignal, 'timeout', { value: original, configurable: true, writable: true })
    }
  }, 8_000)

  it('does not cut a message short: sending is not one of the reads that are given up on', async () => {
    // The timeout belongs to the reads that say what the host can do; a first message answers as slowly as it must.
    const slow = holdingResponse(isPost('/invocations'))
    const chat = chatOver(sim, { fetchImpl: slow.fetchImpl, readTimeoutMs: 40 })
    const created = await chat.createSession()
    slow.arm()
    const starting = chat.startTurn(created.id, 'Take your time')
    await slow.reached
    await new Promise(resolve => setTimeout(resolve, 150))
    slow.release()
    const handle = await starting
    expect((await collect(handle)).outcome).toEqual({ state: 'completed' })
  })
})

describe('the load a quiet turn puts on the host (finding 8)', () => {
  let sim: ChoreographSim
  beforeEach(async () => {
    sim = new ChoreographSim()
    new SobremesaRoutes(sim)
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('backs off from 250 ms to a 2 s cap while nothing moves, and starts over when something does', async () => {
    // Defect guarded: an idle turn was asked about up to sixteen times a second for ten minutes.
    const quiet = Array.from({ length: 24 }, () => [] as never[])
    sim.queueTurn({
      answer: 'Late, at last.',
      stages: [[started()], ...quiet, [delta('Late, at last.')], ...Array.from({ length: 12 }, () => [] as never[])],
    })
    const slept: number[] = []
    const chat = chatOver(sim, {
      resolveDelayMs: 250,
      streamDeadlineMs: 5_000,
      sleep: async ms => {
        slept.push(ms)
        await new Promise(resolve => setTimeout(resolve, 1))
      },
    })
    const created = await chat.createSession()
    const handle = await chat.startTurn(created.id, 'Say something, eventually')
    const finished = await collect(handle)
    expect(finished.outcome).toEqual({ state: 'completed' })

    // While nothing moved: 250, then doubling, never past 2,000.
    const idle = slept.filter(ms => ms > 0)
    expect(idle.slice(0, 5)).toEqual([250, 500, 1_000, 2_000, 2_000])
    expect(Math.max(...idle)).toBe(2_000)
    // The moment something moved it only yielded, and the next quiet stretch began at 250 again.
    const movedAt = slept.findIndex((ms, index) => ms === 0 && slept.slice(0, index).includes(2_000))
    expect(movedAt).toBeGreaterThan(-1)
    expect(slept.slice(movedAt + 1).find(ms => ms > 0)).toBe(250)
  }, 15_000)
})

describe('a browser that will not hold any more (finding 9)', () => {
  let sim: ChoreographSim
  beforeEach(async () => {
    sim = new ChoreographSim()
    new SobremesaRoutes(sim)
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true })]
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('does not fail a healthy turn because the storage is full', async () => {
    // Defect guarded: every write of the conversation's bookkeeping was unguarded, so a full quota
    // threw out of the middle of a stream and a turn that had worked was reported as failed.
    const storage = new BrowserStorage()
    const chat = chatOver(sim, { storage })
    const created = await chat.createSession()
    storage.capacity = 0
    const turnDone = await collect(await chat.startTurn(created.id, 'Hello'))
    expect(turnDone.outcome).toEqual({ state: 'completed' })
    const shown = await chat.hydrateSession(created.id)
    expect(shown.messages.map(message => message.role)).toEqual(['user', 'assistant'])
    expect(await chat.listSessions()).toHaveLength(1)
    await chat.renameSession(created.id, 'Still nameable')
    await chat.deleteSession(created.id)
  })

  it('opens on a storage that is full before it has written a thing', () => {
    const storage = new BrowserStorage()
    storage.capacity = 0
    expect(() => chatOver(sim, { storage })).not.toThrow()
  })

  it('makes room for a new window from the windows of conversations that are already under way', async () => {
    // Defect guarded: windows of up to 192 KiB accumulated for as long as the conversations lived.
    const archive = new MemoryArchive(
      Array.from({ length: 8 }, (_, index) => turn(index, index % 2 === 0 ? 'user' : 'assistant', `${'word '.repeat(120)}${index}`)),
    )
    const storage = new BrowserStorage()
    const chat = chatOver(sim, { storage, archive })
    await chat.probeCapabilities!()
    const intent = { conversationId: CONVERSATION_ID, revisionId: REVISION_ID, title: archive.title, messagesLoaded: 8 }
    const plan = await chat.prepareContinuation!(intent)

    const older = await chat.continueConversation!(plan, { modelId: HOUSE })
    await collect(await chat.startTurn(older.id, 'Older one, sent'))
    const windowBytes = [...storage.values].filter(([key]) => key.includes(':window:')).reduce((sum, [key, value]) => sum + key.length + value.length, 0)
    // Room for the bookkeeping and one more window, not two.
    const used = [...storage.values].reduce((sum, [key, value]) => sum + key.length + value.length, 0)
    storage.capacity = used + Math.floor(windowBytes * 0.6)

    const newest = await chat.continueConversation!(plan, { modelId: HOUSE })
    const windowKeys = [...storage.values.keys()].filter(key => key.includes(':window:'))
    expect(windowKeys.some(key => key.endsWith(encodeURIComponent(newest.id)))).toBe(true)
    // The one made room for had already been sent: the host holds its seed, the browser only its display.
    expect(windowKeys.some(key => key.endsWith(encodeURIComponent(older.id)))).toBe(false)
    const reloaded = chatOver(sim, { storage, archive })
    await reloaded.probeCapabilities!()
    expect((await reloaded.hydrateSession(newest.id)).messages.filter(message => message.origin === 'window').length).toBeGreaterThan(0)
  })
})

describe('signing out leaves no earlier conversation behind (finding 9)', () => {
  function seeded(): BrowserStorage {
    const storage = new BrowserStorage()
    const prefix = 'shrubbery:c2chat:v1'
    for (const [user, graph] of [['probe', 'atelier'], ['probe', 'other'], ['someone', 'atelier']]) {
      storage.setItem(`${prefix}:${user}:${graph}:window:c2chat-1`, '[{"role":"user"}]')
      storage.setItem(`${prefix}:${user}:${graph}:window:c2chat-2`, '[{"role":"assistant"}]')
      storage.setItem(`${prefix}:${user}:${graph}:descriptor:c2chat-1`, '{}')
      storage.setItem(`${prefix}:${user}:${graph}:descriptor-index`, '["c2chat-1"]')
      storage.setItem(`${prefix}:${user}:${graph}:slots`, '[null,null,null]')
    }
    storage.setItem('shrubbery.cognito.tokens.v1', '{"tokens":true}')
    storage.setItem('some-other-app:window:1', 'not ours')
    return storage
  }

  it('removes every window this app keeps, for every person and graph, and nothing else', () => {
    const storage = seeded()
    expect(purgeHostedChatWindows(storage)).toBe(6)
    expect([...storage.values.keys()].filter(key => key.includes(':window:c2chat'))).toEqual([])
    expect(storage.getItem('shrubbery:c2chat:v1:probe:atelier:descriptor:c2chat-1')).toBe('{}')
    expect(storage.getItem('shrubbery:c2chat:v1:probe:atelier:slots')).toBe('[null,null,null]')
    expect(storage.getItem('shrubbery.cognito.tokens.v1')).toBe('{"tokens":true}')
    expect(storage.getItem('some-other-app:window:1')).toBe('not ours')
  })

  it('takes a prefix, for a shell that keeps its chat under another', () => {
    const storage = new BrowserStorage()
    storage.setItem('mine:v1:u:g:window:c2chat-1', '[]')
    storage.setItem('shrubbery:c2chat:v1:u:g:window:c2chat-1', '[]')
    expect(purgeHostedChatWindows(storage, 'mine:v1')).toBe(1)
    expect(storage.getItem('shrubbery:c2chat:v1:u:g:window:c2chat-1')).toBe('[]')
  })

  it('does nothing, and does not throw, with no storage or storage that cannot be walked or written', () => {
    expect(purgeHostedChatWindows(null)).toBe(0)
    expect(purgeHostedChatWindows(undefined)).toBe(0)
    expect(purgeHostedChatWindows({ getItem: () => null, setItem: () => undefined, removeItem: () => undefined } as unknown as Storage)).toBe(0)
    const stubborn = seeded()
    stubborn.removeItem = () => { throw new Error('blocked') }
    expect(() => purgeHostedChatWindows(stubborn)).not.toThrow()
  })
})

