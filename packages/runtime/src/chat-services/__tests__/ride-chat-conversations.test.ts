/**
 * The self-host chat's conversations on the agent core, past the first reply (NO MOCKS: the gardend-shaped
 * front and the ride v2 sim are real HTTP servers; every store folds with the real projector):
 *   - a rename is kept by vehicle-host, so every browser and every reload sees it;
 *   - a delete moves the conversation to the host's trash, and is refused while a reply is under way;
 *   - the same person in another browser is offered "Continue here", takes the conversation over, and the
 *     first browser goes read-only (following it while visible); someone else is refused;
 *   - a reloaded conversation is dated by its record, each message at its own time.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type ChatServiceStore, CONTINUE_HERE_ACTION, createChatServiceStore as makeStore } from '../../chat-host/chat-service-store.js'
import { makeLocalChatService } from '../local-chat-service.js'
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
/** Every store a test made: disposed after it, so no watch outlives the servers. */
const stores: ChatServiceStore[] = []
const createChatServiceStore = (...args: Parameters<typeof makeStore>): ChatServiceStore => {
  const store = makeStore(...args)
  stores.push(store)
  return store
}

interface HappyDomControl {
  readonly happyDOM?: { setURL(url: string): void }
  readonly location: { href: string }
}
const page = (): HappyDomControl => globalThis.window as unknown as HappyDomControl
let originalUrl = ''

/** One browser: its own storage (so its own `x-vehicle-client-id`), the self-host key unless told otherwise. */
function browser(storage = new MemoryStorage(), key?: string) {
  return makeRideChatService({
    baseUrl: front.vehicleBase,
    graphId: () => GRAPH,
    token: () => key ?? front.key,
    role: () => 'owner',
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

/** A conversation with one reply in it, made in `svc`'s browser. */
async function conversationWithReply(svc: ReturnType<typeof browser>, question = 'Which part charges the battery?') {
  const store = createChatServiceStore(svc)
  const { id } = await svc.createSession({ title: null })
  svc.bindSlotSession(0, id)
  store.setSession(id)
  await until(() => store.getState().conversationState === 'ready', 'the conversation to load')
  sim.scripts.push([{ kind: 'say', text: 'The BQ25185.' }])
  store.send(question)
  await until(() => store.getState().streaming, 'the reply to start')
  await until(() => !store.getState().streaming, 'the reply to end')
  return { id, store }
}

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(async () => {
  sim = new RideSim()
  await sim.start()
  front = new GardendFront(sim)
  await front.start()
  originalUrl = page().location.href
  page().happyDOM?.setURL(`${front.base}/`)
})

afterEach(async () => {
  for (const store of stores.splice(0)) store.dispose()
  setVisibility('visible')
  page().happyDOM?.setURL(originalUrl)
  await front.stop()
  await sim.stop()
})

describe('rename, kept by vehicle-host', () => {
  it('names the conversation on the host: another browser and a reload see it; a placeholder brings the preview back', async () => {
    const storage = new MemoryStorage()
    const svc = browser(storage)
    const { id, store } = await conversationWithReply(svc)
    store.dispose()
    // A name this browser kept before names were kept by the host.
    storage.setItem(`sophia.ride.title.${id}`, 'an old local name')

    const renamed = await svc.renameSession(id, '  Charging,\n the battery  ')
    expect(renamed.title).toBe('Charging, the battery')
    const patch = sim.received.find(item => item.method === 'PATCH')
    expect(patch?.path).toBe(`/sessions/${id}`)
    expect(patch?.headers['x-graph-id']).toBe(GRAPH)
    expect(patch?.body.title).toBe('Charging, the battery')
    expect(sim.sessions.get(id)?.title).toBe('Charging, the battery')
    expect(storage.getItem(`sophia.ride.title.${id}`)).toBeNull()

    // Another browser of the same person, and a reload of this one.
    expect((await browser().listSessions()).map(row => row.title)).toEqual(['Charging, the battery'])
    const reloaded = browser(storage)
    expect((await reloaded.hydrateSession(id)).session.title).toBe('Charging, the battery')

    // "New chat" (what the drawer sends for an empty box) clears the name: the first thing said names it again.
    await reloaded.renameSession(id, 'New chat')
    expect(sim.received.filter(item => item.method === 'PATCH').at(-1)?.body.title).toBeNull()
    expect((await browser().listSessions()).map(row => row.title)).toEqual(['Which part charges the battery?'])
  })
})

describe('delete, to the host\'s trash', () => {
  it('moves the conversation to the trash: gone from every list, its slot let go of; deleting it again is fine', async () => {
    const svc = browser()
    const { id, store } = await conversationWithReply(svc)
    expect(svc.slotSessions()[0]).toBe(id)
    await svc.deleteSession(id)
    expect(sim.received.find(item => item.method === 'DELETE')?.path).toBe(`/sessions/${id}`)
    expect(sim.trash.has(id)).toBe(true)
    expect(sim.sessions.has(id)).toBe(false)
    expect(sim.trash.get(id)?.events.at(-1)?.type).toBe('session.deleted')
    expect((await svc.listSessions()).map(row => row.id)).not.toContain(id)
    expect((await browser().listSessions()).map(row => row.id)).not.toContain(id)
    expect(svc.slotSessions()[0]).toBeNull()
    // The panel still on it says so, and offers a new chat.
    await until(() => store.getState().readOnly, 'the deleted conversation to read only')
    expect(store.getState().composerNotice).toMatchObject({ id: 'conversation-gone', action: { id: 'new-chat' } })
    await expect(svc.deleteSession(id)).resolves.toBeUndefined()
    store.dispose()
  })

  it('is refused while a reply is under way, and the conversation keeps its slot', async () => {
    const svc = browser()
    const store = createChatServiceStore(svc)
    const { id } = await svc.createSession({ title: null })
    svc.bindSlotSession(0, id)
    store.setSession(id)
    await until(() => store.getState().conversationState === 'ready', 'the conversation to load')
    sim.scripts.push([{ kind: 'say', text: 'Reading.' }, { kind: 'hold' }, { kind: 'say', text: 'Done.' }])
    store.send('Read everything.')
    await sim.held()
    await expect(svc.deleteSession(id)).rejects.toThrow(/still working in this conversation\. Stop the reply, then delete it/)
    expect(sim.sessions.has(id)).toBe(true)
    expect(svc.slotSessions()[0]).toBe(id)
    expect(svc.driverState(id)).toBeNull()
    sim.go()
    await until(() => !store.getState().streaming, 'the reply to end')
    await svc.deleteSession(id)
    expect(sim.trash.has(id)).toBe(true)
    store.dispose()
  })
})

describe('the same person in another browser', () => {
  it('is offered "Continue here", takes the conversation over, and the first browser goes read-only and follows it', async () => {
    const first = browser()
    const { id, store: one } = await conversationWithReply(first)
    expect(one.getState().readOnly).toBe(false)

    // The second browser opens the same conversation (from its history drawer, or a link).
    const second = browser()
    const two = createChatServiceStore(second)
    two.setSession(id)
    await until(() => two.getState().conversationState === 'ready' && two.getState().readOnly, 'the second browser to read only')
    expect(two.getState().messages.map(message => message.content)).toEqual(['Which part charges the battery?', 'The BQ25185.'])
    expect(two.getState().error).toBe('This conversation is open in another tab or browser.')
    expect(two.getState().composerNotice).toMatchObject({
      id: 'driver-elsewhere',
      title: 'This conversation is open in another tab or browser.',
      action: { id: CONTINUE_HERE_ACTION, label: 'Continue here' },
    })
    // Not a silent new conversation.
    expect(sim.received.filter(item => item.method === 'POST' && item.path === '/sessions')).toHaveLength(1)

    // Continue here.
    two.composerNoticeAction?.(CONTINUE_HERE_ACTION)
    await until(() => !two.getState().readOnly, 'the second browser to drive')
    expect(two.getState().composerNotice).toBeNull()
    const claim = sim.received.filter(item => item.path.endsWith('/claim')).at(-1)
    expect(claim?.body.takeover).toBe(true)
    expect(sim.sessions.get(id)?.lease?.clientId).toBe(second.clientId)
    const revoked = sim.sessions.get(id)?.events.find(event => event.type === 'lease.revoked')
    expect(revoked?.payload).toMatchObject({ clientId: first.clientId, by: second.clientId, reason: 'takeover' })

    // The first browser, following the conversation, goes read-only with the same offer.
    await until(() => one.getState().readOnly, 'the first browser to read only')
    expect(one.getState().composerNotice).toMatchObject({ action: { id: CONTINUE_HERE_ACTION } })

    // The second drives; the first reads the new turn in as it settles.
    sim.scripts.push([{ kind: 'say', text: 'Yes, the same charger.' }])
    two.send('Is that the charger on the schematic?')
    await until(() => two.getState().streaming, 'the second browser\'s reply to start')
    await until(() => !two.getState().streaming, 'the second browser\'s reply to end')
    await until(() => one.getState().messages.at(-1)?.content === 'Yes, the same charger.', 'the first browser to read the new turn')
    expect(one.getState().readOnly).toBe(true)

    // And back: the first takes it again, the second goes read-only.
    one.composerNoticeAction?.(CONTINUE_HERE_ACTION)
    await until(() => !one.getState().readOnly && two.getState().readOnly, 'the lease to come back')
    expect(sim.sessions.get(id)?.lease?.clientId).toBe(first.clientId)
    one.dispose()
    two.dispose()
  })

  it('tells a browser that lost the lease, when it sends, and keeps its words for after "Continue here"', async () => {
    const first = browser()
    const { id, store: one } = await conversationWithReply(first)
    one.dispose() // not following: it learns only when it sends
    const second = browser()
    await second.hydrateSession(id)
    await second.takeOver(id)

    // It still believes it holds the lease (it was not following): the send is refused, and now it knows.
    expect(first.driverState(id)).toBeNull()
    await expect(first.startTurn(id, 'Still mine?')).rejects.toThrow(/open in another tab or browser\. Choose Continue here/)
    expect(first.driverState(id)).toEqual({ kind: 'elsewhere', canTakeOver: true })
    // Refused at the host: nothing was accepted, let alone run.
    expect(sim.sessions.get(id)?.commands.map(command => command.text)).not.toContain('Still mine?')
  })

  it('stops following while the page is hidden, and catches up when it is shown again', async () => {
    const first = browser()
    const { id, store: one } = await conversationWithReply(first)
    await until(() => front.forwarded.some(item => item.path.endsWith('/events')), 'the follow to open')
    setVisibility('hidden')
    await new Promise(resolve => setTimeout(resolve, 50))
    const second = browser()
    await second.hydrateSession(id)
    await second.takeOver(id)
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(one.getState().readOnly).toBe(false)
    setVisibility('visible')
    await until(() => one.getState().readOnly, 'the first browser to catch up')
    one.dispose()
  })
})

describe('someone else', () => {
  it('finds no such conversation: a member cannot read it, take it over, rename it or delete it', async () => {
    const owner = browser()
    const { id, store } = await conversationWithReply(owner)
    const member = browser(new MemoryStorage(), front.memberKey)
    await expect(member.hydrateSession(id)).rejects.toThrow(/not here any more/)
    await expect(member.takeOver(id)).rejects.toThrow(/not here any more/)
    await expect(member.renameSession(id, 'mine now')).rejects.toThrow(/not here any more/)
    await expect(member.deleteSession(id)).resolves.toBeUndefined() // "already gone", as far as the member can tell
    expect(sim.sessions.has(id)).toBe(true)
    expect(sim.sessions.get(id)?.lease?.clientId).toBe(owner.clientId)
    expect(sim.sessions.get(id)?.title).toBeUndefined()
    const refused = sim.received.filter(item => item.headers['x-user-id'] === 'token:member' && item.path.startsWith(`/sessions/${id}`))
    expect(refused.length).toBeGreaterThanOrEqual(4)
    expect(store.getState().readOnly).toBe(false)
    store.dispose()
  })
})

describe('the record\'s own times', () => {
  it('dates a reloaded conversation message by message, never by when it began', async () => {
    let clock = Date.UTC(2026, 9, 13, 16, 0, 0)
    sim.now = () => (clock += 1_000)
    const storage = new MemoryStorage()
    const svc = browser(storage)
    const store = createChatServiceStore(svc)
    const { id } = await svc.createSession({ title: null })
    const began = Date.parse(sim.sessions.get(id)?.createdAt as string)
    store.setSession(id)
    await until(() => store.getState().conversationState === 'ready', 'the conversation to load')
    sim.scripts.push([{ kind: 'tool', name: 'search_documents', args: { query: 'charger' }, result: 'BQ25185' }, { kind: 'say', text: 'The BQ25185.' }])
    store.send('Which part charges the battery?')
    await until(() => !store.getState().streaming && store.getState().messages.length === 2, 'the first reply')
    clock += 2 * 3_600_000 // two hours later
    sim.scripts.push([{ kind: 'say', text: 'About 4.2 V.' }])
    store.send('And its charge voltage?')
    await until(() => !store.getState().streaming && store.getState().messages.length === 4, 'the second reply')
    store.dispose()

    const transcript = sim.sessions.get(id)?.transcript as { role: string; timestamp: string }[]
    const at = (index: number) => Date.parse(transcript[index]?.timestamp as string)
    const { messages } = await browser(storage).hydrateSession(id)
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    // A person's message when it was taken; a reply when its last step ended (as the hosted chat dates them).
    expect(messages[0]?.createdAt).toBe(at(0))
    expect(messages[1]?.createdAt).toBe(at(3))
    expect(messages[2]?.createdAt).toBe(at(4))
    expect(messages[3]?.createdAt).toBe(at(5))
    expect(messages[2]!.createdAt - messages[0]!.createdAt).toBeGreaterThan(2 * 3_600_000)
    for (const message of messages) expect(message.createdAt).not.toBe(began)
  })
})

describe('a chat without a driver lease (the hosted and local chats)', () => {
  it('is never read-only for it, offers no "Continue here", and ignores the action', async () => {
    const local = makeLocalChatService()
    expect('driverState' in local || 'takeOver' in local || 'followSession' in local).toBe(false)
    const store = createChatServiceStore(local)
    const { id } = await local.createSession({ title: 'local' })
    store.setSession(id)
    await until(() => store.getState().conversationState === 'ready', 'the conversation to load')
    expect(store.getState().readOnly).toBe(false)
    expect(store.getState().composerNotice ?? null).toBeNull()
    store.composerNoticeAction?.(CONTINUE_HERE_ACTION)
    expect(store.getState().readOnly).toBe(false)
    store.dispose()
  })
})
