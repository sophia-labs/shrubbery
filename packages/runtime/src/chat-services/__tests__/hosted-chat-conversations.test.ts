/**
 * The one conversation home's live half: `listConversations()` over a scripted
 * Choreograph (NO MOCKS: real socket, real service, real storage-shaped memory).
 *
 * The list comes from Choreograph's own session list when the host has one, so it is
 * the same on every device; otherwise from the descriptors this browser holds. Either
 * way it is dated by when the conversation was last really active (not by when it
 * was last opened), titled by what was said in it, and a conversation the person
 * deleted here does not come back from the server. The list route and its row shape
 * are ASSUMED (`sobremesa-contract.ts`); the fixture is assumed with them.
 */
import type { ChatEvent } from '@shrubbery/chat-kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeHostedChatService } from '../hosted-chat-service.js'
import { ChoreographSim, plainTurn } from './fixtures/choreograph-sim.js'
import { recordingFetch } from './fixtures/recording-fetch.js'
import { SobremesaRoutes } from './fixtures/sobremesa-routes.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const GRAPH = 'atelier-20260929'

function chatOver(
  sim: ChoreographSim,
  storage: MemoryStorage = new MemoryStorage(),
  graph = GRAPH,
  fetchImpl?: typeof fetch,
) {
  return makeHostedChatService({
    ...(fetchImpl ? { fetchImpl } : {}),
    gatewayBaseUrl: sim.base,
    graphBaseUrl: (id: string) => sim.graphBase(id),
    graphId: () => graph,
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

const pause = (ms = 8) => new Promise(resolve => setTimeout(resolve, ms))

async function say(chat: ReturnType<typeof chatOver>, text: string, title?: string | null): Promise<string> {
  const created = await chat.createSession(title === undefined ? {} : { title })
  await collect(await chat.startTurn(created.id, text))
  return created.id
}

describe('listConversations from this browser’s conversations (a host with no session list)', () => {
  let sim: ChoreographSim
  beforeEach(async () => {
    sim = new ChoreographSim()
    // Installs the Sobremesa routes with a session list that answers 404, as an older host does.
    new SobremesaRoutes(sim)
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('lists what was said, newest first, dated by activity, with the graph and the model that spoke', async () => {
    const chat = chatOver(sim)
    const first = await say(chat, 'What is a monad?')
    await pause()
    const second = await say(chat, 'Explain functors.')
    const listed = await chat.listConversations!()
    expect(listed.map(row => row.id)).toEqual([second, first])
    for (const row of listed) {
      expect(row).toMatchObject({ kind: 'live', graphId: GRAPH })
      expect(Date.parse(row.updatedAt)).toBeGreaterThan(0)
      expect(Date.parse(row.createdAt!)).toBeGreaterThan(0)
      expect(row.models).toEqual([{ id: 'google/gemini-2.5-flash', provider: 'openrouter' }])
      expect(row.continuesConversation).toBeUndefined()
    }
    expect(Date.parse(listed[0].updatedAt)).toBeGreaterThanOrEqual(Date.parse(listed[1].updatedAt))
  })

  it('names each conversation by what was said in it, and keeps a title the person gave', async () => {
    const chat = chatOver(sim)
    const auto = await say(chat, '   What is   a monad,\n and why does everyone  ask?  ')
    const given = await say(chat, 'Explain functors.', 'Category theory')
    const generic = await say(chat, 'A third thing to ask.', 'organism-chat')
    const rows = new Map((await chat.listConversations!()).map(row => [row.id, row.title]))
    expect(rows.get(auto)).toBe('What is a monad, and why does everyone ask?')
    expect(rows.get(given)).toBe('Category theory')
    // The shell's own placeholder is not a title.
    expect(rows.get(generic)).toBe('A third thing to ask.')
  })

  it('cuts a long first message to a title that reads, at a word', async () => {
    const chat = chatOver(sim)
    const id = await say(chat, 'Please explain, in as much detail as you reasonably can manage, how a monad differs from a functor and an applicative.')
    const title = (await chat.listConversations!()).find(row => row.id === id)!.title
    expect(title.length).toBeLessThanOrEqual(61)
    expect(title.endsWith('…')).toBe(true)
    expect(title.startsWith('Please explain, in as much detail')).toBe(true)
    expect(title).not.toMatch(/\s…$/)
  })

  it('shows the same title in the drawer’s list of sessions', async () => {
    const chat = chatOver(sim)
    const id = await say(chat, 'What is a monad?')
    expect((await chat.listSessions()).find(row => row.id === id)?.title).toBe('What is a monad?')
  })

  it('shows no title for a conversation that has only the shell’s placeholder, and what was said once something has been', async () => {
    // Defect seen in the browser harness: the shell names every new conversation "organism-chat", and the
    // header and the drawer showed that placeholder until a person renamed it (step zero read the same).
    const chat = chatOver(sim)
    const created = await chat.createSession({ title: 'organism-chat' })
    expect(created.title).toBeNull()
    expect((await chat.listSessions()).find(row => row.id === created.id)?.title).toBeNull()
    expect((await chat.hydrateSession(created.id)).session.title).toBeNull()
    await collect(await chat.startTurn(created.id, 'What is a monad?'))
    expect((await chat.hydrateSession(created.id)).session.title).toBe('What is a monad?')
    expect((await chat.listSessions()).find(row => row.id === created.id)?.title).toBe('What is a monad?')
  })

  it('does the same for a conversation stored before, under the placeholder', async () => {
    const storage = new MemoryStorage()
    const first = chatOver(sim, storage)
    const created = await first.createSession({ title: 'organism-chat' })
    await collect(await first.startTurn(created.id, 'Explain functors.'))
    // As an earlier version left it: the placeholder was the stored title.
    const key = `shrubbery:c2chat:v1:probe:${GRAPH}:descriptor:${created.id}`
    const stored = JSON.parse(storage.getItem(key)!)
    stored.title = 'organism-chat'
    storage.setItem(key, JSON.stringify(stored))
    const later = chatOver(sim, storage)
    expect((await later.listSessions()).find(row => row.id === created.id)?.title).toBe('Explain functors.')
    expect((await later.hydrateSession(created.id)).session.title).toBe('Explain functors.')
  })

  it('does not list a conversation nothing has been said in', async () => {
    const chat = chatOver(sim)
    await chat.createSession()
    await chat.createSession({ title: 'organism-chat' })
    expect(await chat.listConversations!()).toEqual([])
  })

  it('does not re-date a conversation by opening it', async () => {
    // Defect guarded: every read of a conversation saved its bookkeeping, and the
    // saved time was the "last updated" the lists showed.
    const chat = chatOver(sim)
    const older = await say(chat, 'First conversation')
    await pause()
    const newer = await say(chat, 'Second conversation')
    const before = await chat.listConversations!()
    await pause()
    await chat.hydrateSession(older)
    await chat.hydrateSession(older)
    const after = await chat.listConversations!()
    expect(after.map(row => row.id)).toEqual([newer, older])
    expect(after.find(row => row.id === older)!.updatedAt).toBe(before.find(row => row.id === older)!.updatedAt)
    const sessions = await chat.listSessions()
    expect(sessions.map(row => row.id)).toEqual([newer, older])
  })

  it('re-dates a conversation when something is really said in it', async () => {
    const chat = chatOver(sim)
    const older = await say(chat, 'First conversation')
    await pause()
    const newer = await say(chat, 'Second conversation')
    await pause()
    await collect(await chat.startTurn(older, 'A follow-up to the first'))
    const listed = await chat.listConversations!()
    expect(listed.map(row => row.id)).toEqual([older, newer])
  })

  it('lists only this graph’s conversations', async () => {
    const storage = new MemoryStorage()
    const here = chatOver(sim, storage, GRAPH)
    const there = chatOver(sim, storage, 'another-graph')
    const inHere = await say(here, 'A question here')
    await say(there, 'A question elsewhere')
    expect((await here.listConversations!()).map(row => row.id)).toEqual([inHere])
  })
})

describe('listConversations from the host’s session list', () => {
  let sim: ChoreographSim
  let routes: SobremesaRoutes
  beforeEach(async () => {
    sim = new ChoreographSim()
    routes = new SobremesaRoutes(sim)
    await sim.start()
  })
  afterEach(async () => sim.stop())

  /** A conversation started on another device: it lives on the host and nowhere in this browser. */
  async function startedElsewhere(text: string): Promise<{ sessionId: string; createdAt: number; lastActivityAt: number }> {
    sim.queueTurn(plainTurn('An answer from the other device.'))
    const other = chatOver(sim, new MemoryStorage())
    await say(other, text)
    const session = sim.session()
    return { sessionId: session.id, createdAt: session.createdAt, lastActivityAt: session.updatedAt }
  }

  it('shows a conversation started on another device, so the list is the same everywhere', async () => {
    const elsewhere = await startedElsewhere('Started on the laptop')
    routes.sessions = [{
      sessionId: elsewhere.sessionId,
      title: 'Started on the laptop',
      model: 'google/gemini-2.5-flash',
      provider: 'openrouter',
      createdAt: elsewhere.createdAt,
      lastActivityAt: elsewhere.lastActivityAt,
    }]
    const phone = chatOver(sim, new MemoryStorage())
    const listed = await phone.listConversations!()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      kind: 'live',
      title: 'Started on the laptop',
      graphId: GRAPH,
      updatedAt: new Date(elsewhere.lastActivityAt).toISOString(),
      createdAt: new Date(elsewhere.createdAt).toISOString(),
      models: [{ id: 'google/gemini-2.5-flash', provider: 'openrouter' }],
    })
    expect(listed[0].id).toMatch(/^c2chat-/)
  })

  it('opens it: the id is one this browser can bind, and its messages are the host’s', async () => {
    const elsewhere = await startedElsewhere('Started on the laptop')
    routes.sessions = [{ sessionId: elsewhere.sessionId, title: 'Started on the laptop', createdAt: elsewhere.createdAt, lastActivityAt: elsewhere.lastActivityAt }]
    const phone = chatOver(sim, new MemoryStorage())
    const [row] = await phone.listConversations!()
    expect(() => phone.bindSlotSession(0, row.id)).not.toThrow()
    const hydrated = await phone.hydrateSession(row.id)
    expect(hydrated.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'Started on the laptop'],
      ['assistant', 'An answer from the other device.'],
    ])
    // The first message is dated by the host, like every other.
    expect(hydrated.messages[0].createdAt).toBe(elsewhere.createdAt)
  })

  it('lists a conversation once, and gives it the same id on every look', async () => {
    const elsewhere = await startedElsewhere('Started on the laptop')
    routes.sessions = [{ sessionId: elsewhere.sessionId, title: 'Started on the laptop', createdAt: elsewhere.createdAt, lastActivityAt: elsewhere.lastActivityAt }]
    const storage = new MemoryStorage()
    const phone = chatOver(sim, storage)
    const first = await phone.listConversations!()
    const second = await phone.listConversations!()
    expect(second.map(row => row.id)).toEqual(first.map(row => row.id))
    // A new page load over the same browser storage finds the same conversation under the same id.
    const reloaded = await chatOver(sim, storage).listConversations!()
    expect(reloaded.map(row => row.id)).toEqual(first.map(row => row.id))
    expect(reloaded).toHaveLength(1)
  })

  it('joins a conversation this browser started to its row: one entry, the host’s dates', async () => {
    const chat = chatOver(sim)
    sim.queueTurn(plainTurn('An answer.'))
    const mine = await say(chat, 'Started here')
    const session = sim.session()
    routes.sessions = [{
      sessionId: session.id,
      title: 'The host’s own title',
      model: 'google/gemini-2.5-flash',
      createdAt: session.createdAt,
      lastActivityAt: session.updatedAt + 60_000,
    }]
    const listed = await chat.listConversations!()
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe(mine)
    // The person's own title (here: what was said) stands; the host's date is the real one.
    expect(listed[0].title).toBe('Started here')
    expect(listed[0].updatedAt).toBe(new Date(session.updatedAt + 60_000).toISOString())
  })

  it('does not bring back a conversation deleted here', async () => {
    const elsewhere = await startedElsewhere('Started on the laptop')
    routes.sessions = [{ sessionId: elsewhere.sessionId, title: 'Started on the laptop', createdAt: elsewhere.createdAt, lastActivityAt: elsewhere.lastActivityAt }]
    const storage = new MemoryStorage()
    const phone = chatOver(sim, storage)
    const [row] = await phone.listConversations!()
    await phone.deleteSession(row.id)
    expect(await phone.listConversations!()).toEqual([])
    // Nor after a reload of the page.
    expect(await chatOver(sim, storage).listConversations!()).toEqual([])
  })

  it('takes a row with no session id for nothing: there is nothing to open', async () => {
    routes.sessions = [{ sessionId: '', title: 'Ghost' }]
    expect(await chatOver(sim).listConversations!()).toEqual([])
  })

  it('takes only rows whose session id is one a Cloud-2 chat can bind', async () => {
    routes.sessions = [{ sessionId: 'not a session', title: 'Odd' }, { sessionId: 'ses_legacy', title: 'Legacy' }]
    expect(await chatOver(sim).listConversations!()).toEqual([])
  })

  it('orders the whole list, the host’s rows and this browser’s, newest first', async () => {
    // The host's row is an hour old on the host's own clock, whatever day the suite runs on.
    sim.clock = Date.now() - 3_600_000
    const elsewhere = await startedElsewhere('Started on the laptop')
    const chat = chatOver(sim)
    await pause()
    const mine = await say(chat, 'Started here, later')
    routes.sessions = [{ sessionId: elsewhere.sessionId, title: 'Started on the laptop', createdAt: elsewhere.createdAt, lastActivityAt: elsewhere.lastActivityAt }]
    const listed = await chat.listConversations!()
    expect(listed).toHaveLength(2)
    expect(listed[0].id).toBe(mine)
    expect(listed[1].title).toBe('Started on the laptop')
  })

  it('falls back to this browser’s conversations when the host has no list, and does not ask again this page load', async () => {
    routes.sessions = null
    const chat = chatOver(sim)
    const mine = await say(chat, 'Started here')
    expect((await chat.listConversations!()).map(row => row.id)).toEqual([mine])
    await chat.listConversations!()
    await chat.listConversations!()
    expect(routes.asked.sessions).toBe(1)
  })

  it('falls back when the list cannot be read now, and asks again next time', async () => {
    const chat = chatOver(sim)
    const mine = await say(chat, 'Started here')
    let broken = true
    sim.extraRoutes.unshift(request =>
      broken && request.query.get('view') === 'chat-sessions' ? { status: 503, body: { error: 'warming up' } } : undefined)
    expect((await chat.listConversations!()).map(row => row.id)).toEqual([mine])
    broken = false
    const elsewhere = await startedElsewhere('Started on the laptop')
    routes.sessions = [{ sessionId: elsewhere.sessionId, title: 'Started on the laptop', createdAt: elsewhere.createdAt, lastActivityAt: elsewhere.lastActivityAt }]
    expect(await chat.listConversations!()).toHaveLength(2)
  })

  it('asks for chat sessions of this graph only, with the person’s token', async () => {
    routes.sessions = []
    const seen = recordingFetch()
    await chatOver(sim, undefined, undefined, seen.fetchImpl).listConversations!()
    const call = sim.received.find(item => item.query.get('view') === 'chat-sessions')!
    expect(call.graph).toBe(GRAPH)
    expect(call.method).toBe('GET')
    // What the service built (happy-dom's fetch drops the header before the socket, so the host
    // cannot be asked): the person's own token, on this graph's route.
    const [sent] = seen.to(`/g/${GRAPH}/workflows/runs`, 'GET').filter(item => item.url.searchParams.get('view') === 'chat-sessions')
    expect(sent.headers.get('authorization')).toBe('Bearer jwt')
  })
})
