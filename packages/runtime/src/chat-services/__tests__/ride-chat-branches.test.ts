/**
 * Branches in the self-host chat on the agent core (NO MOCKS: the gardend-shaped front and the ride v2 sim are
 * real HTTP servers; every store folds with the real projector):
 *   - "Branch from here" on one of the person's messages forks the conversation before it: a new conversation
 *     with the history up to that message, which this browser drives, and the message's words (without the note
 *     pi-sophia adds for the model) for the composer; the old conversation is untouched;
 *   - "Duplicate" clones it whole;
 *   - the list says what each branch came from;
 *   - deleting a conversation that has a document in the workspace (vehicle-host's mirror) puts that document in
 *     the workspace's Trash with the person's own credential; a member, who may not, still deletes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type ChatServiceStore, createChatServiceStore as makeStore } from '../../chat-host/chat-service-store.js'
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

/** One browser: its own storage, the self-host key unless told otherwise, gardend's document Trash as the organism wires it. */
function browser(key?: string, refs: readonly string[] = []) {
  const bearer = key ?? front.key
  return makeRideChatService({
    baseUrl: front.vehicleBase,
    graphId: () => GRAPH,
    token: () => bearer,
    role: () => 'owner',
    contextRefs: () => refs,
    storage: new MemoryStorage(),
    longPollMs: 500,
    trashDocument: async (graphId, documentId) => {
      const response = await fetch(`${front.base}/navigation/${graphId}/documents/${documentId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${bearer}` } })
      if (!response.ok) throw new Error(`trash refused: ${response.status}`)
      return response.json()
    },
  })
}

async function until(predicate: () => boolean, what: string, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** A conversation with the given turns, each answered, driven through a store as the panel does. */
async function conversation(svc: ReturnType<typeof browser>, turns: readonly (readonly [string, string])[]) {
  const store = createChatServiceStore(svc)
  const { id } = await svc.createSession({ title: null })
  svc.bindSlotSession(0, id)
  store.setSession(id)
  await until(() => store.getState().conversationState === 'ready', 'the conversation to load')
  for (const [question, answer] of turns) {
    sim.scripts.push([{ kind: 'say', text: answer }])
    store.send(question)
    await until(() => store.getState().streaming, 'the reply to start')
    await until(() => !store.getState().streaming, 'the reply to end')
  }
  return { id, store }
}

const texts = (store: ChatServiceStore) => store.getState().messages.map(message => `${message.role}: ${message.content}`)

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
  page().happyDOM?.setURL(originalUrl)
  await front.stop()
  await sim.stop()
})

describe('Branch from here', () => {
  it('forks before the person’s message: the history up to it, driven here, its words back for the composer', async () => {
    const svc = browser(undefined, ['buck-boost-converter'])
    const { id, store } = await conversation(svc, [
      ['Which part regulates the 3.3 V rail?', 'The TPS63020.'],
      ['And which charges the battery?', 'The BQ25185.'],
    ])
    const second = store.getState().messages.filter(message => message.role === 'user')[1]!

    const claims = () => sim.received.filter(item => item.path.endsWith('/claim')).length
    const claimsBefore = claims()
    const branch = await svc.branchSession(id, { id: second.id, content: second.content, userIndex: 1 })
    expect(branch.text).toBe('And which charges the battery?')
    const fork = sim.commandsOf('fork')[0]!
    expect(fork.path).toBe(`/sessions/${id}/commands`)
    expect(fork.headers['x-graph-id']).toBe(GRAPH)
    const source = sim.sessions.get(id)!
    expect(fork.body.entryId).toBe(source.transcript.filter(item => item.role === 'user')[1]?.entryId)
    // No lease asked for: the owner may branch from any of their clients.
    expect(claims()).toBe(claimsBefore)

    // The branch: driven here (its lease is this browser's), holding the first exchange only.
    const made = sim.sessions.get(branch.session.id)!
    expect(made.parent).toEqual({ sessionId: id, kind: 'fork', entryId: fork.body.entryId })
    expect(made.lease?.clientId).toBe(svc.clientId)
    const here = createChatServiceStore(svc)
    svc.bindSlotSession(0, branch.session.id)
    here.setSession(branch.session.id)
    await until(() => here.getState().conversationState === 'ready', 'the branch to load')
    expect(texts(here)).toEqual(['user: Which part regulates the 3.3 V rail?', 'assistant: The TPS63020.'])
    expect(here.getState().readOnly).toBe(false)

    // The person edits the words and sends: a different second answer, in the branch only.
    sim.scripts.push([{ kind: 'say', text: 'A different answer: the BQ25185, a linear charger.' }])
    here.send('And which part charges the LiPo?')
    await until(() => here.getState().streaming, 'the branch reply to start')
    await until(() => !here.getState().streaming, 'the branch reply to end')
    expect(texts(here).slice(2)).toEqual(['user: And which part charges the LiPo?', 'assistant: A different answer: the BQ25185, a linear charger.'])
    expect(sim.sessions.get(id)!.transcript.map(item => item.text)).toEqual([
      expect.stringMatching(/^Which part regulates the 3\.3 V rail\?/),
      'The TPS63020.',
      expect.stringMatching(/^And which charges the battery\?/),
      'The BQ25185.',
    ])

    // The list says where the branch came from.
    const listed = await svc.listConversations()
    const row = listed.find(item => item.id === branch.session.id)
    expect(row?.branchedFrom).toEqual({ id, kind: 'fork', title: 'Which part regulates the 3.3 V rail?' })
    expect(listed.find(item => item.id === id)?.branchedFrom).toBeUndefined()
  })

  it('finds the message by the record’s own id, else by its place and words (a message the page only saw streamed)', async () => {
    const svc = browser()
    const { id, store } = await conversation(svc, [
      ['Same words', 'one'],
      ['Same words', 'two'],
    ])
    store.dispose()
    const reloaded = createChatServiceStore(svc)
    reloaded.setSession(id)
    await until(() => reloaded.getState().conversationState === 'ready' && reloaded.getState().messages.length === 4, 'the reload')
    const second = reloaded.getState().messages.filter(message => message.role === 'user')[1]!
    expect(second.id.startsWith('ride-')).toBe(true)
    const entries = sim.sessions.get(id)!.transcript.filter(item => item.role === 'user').map(item => item.entryId)
    // Its place says the first: the record's id wins.
    await svc.branchSession(id, { id: second.id, content: second.content, userIndex: 0 })
    expect(sim.commandsOf('fork')[0]?.body.entryId).toBe(entries[1])
    // A message known only by the page's own id: its place among the person's messages, checked against its words.
    await svc.branchSession(id, { id: 'pending-7f3a', content: 'Same words', userIndex: 1 })
    expect(sim.commandsOf('fork')[1]?.body.entryId).toBe(entries[1])
    // Words that are not in the record: refused, nothing forked.
    await expect(svc.branchSession(id, { id: 'pending-8', content: 'Never said', userIndex: 0 })).rejects.toThrow(/not in the conversation’s record/)
    expect(sim.commandsOf('fork')).toHaveLength(2)
  })
})

describe('Duplicate', () => {
  it('clones the conversation whole, as "Copy of" it, driven here, with its lineage in the list', async () => {
    const svc = browser()
    const { id } = await conversation(svc, [['Which part regulates the 3.3 V rail?', 'The TPS63020.']])
    await svc.renameSession(id, 'Power rails')
    const copy = await svc.duplicateSession(id)
    expect(copy.title).toBe('Copy of Power rails')
    expect(sim.sessions.get(copy.id)?.lease?.clientId).toBe(svc.clientId)
    expect(sim.sessions.get(copy.id)?.transcript.map(item => item.text)).toEqual(['Which part regulates the 3.3 V rail?', 'The TPS63020.'])
    const listed = await svc.listConversations()
    expect(listed.find(item => item.id === copy.id)?.branchedFrom).toEqual({ id, kind: 'clone', title: 'Power rails' })
    // A deleted parent is said to be gone.
    await svc.deleteSession(id)
    expect((await svc.listConversations()).find(item => item.id === copy.id)?.branchedFrom).toEqual({ id, kind: 'clone', title: null })
  })
})

describe('the conversation’s document in the workspace', () => {
  it('tells the shell when vehicle-host wrote it, so the tree shows it without a reload', async () => {
    const changed: string[] = []
    const svc = makeRideChatService({
      baseUrl: front.vehicleBase,
      graphId: () => GRAPH,
      token: () => front.key,
      role: () => 'owner',
      storage: new MemoryStorage(),
      longPollMs: 500,
      onWorkspaceChanged: graphId => changed.push(graphId),
    })
    // The panel's store follows the open conversation; a second watch of it changes nothing.
    const { id } = await conversation(svc, [['Which part charges the battery?', 'The BQ25185.']])
    const stop = svc.followSession(id, () => undefined)
    try {
      await until(() => changed.length > 0, 'the shell to hear of the document')
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(changed).toEqual([GRAPH])
      expect(sim.sessions.get(id)?.events.filter(event => event.type === 'mirror.written')).toHaveLength(1)
    } finally {
      stop()
    }
  })

  it('goes to the workspace’s Trash with the conversation, with the person’s own credential', async () => {
    const svc = browser()
    const { id } = await conversation(svc, [['Which part charges the battery?', 'The BQ25185.']])
    const empty = await svc.createSession({ title: null })
    await svc.deleteSession(id)
    expect(sim.trash.has(id)).toBe(true)
    expect(front.trashed).toEqual([{ graphId: GRAPH, documentId: `sophia-conversation-${id}`, by: 'owner' }])
    // A conversation nothing was said in has no document: nothing to trash.
    await svc.deleteSession(empty.id)
    expect(front.trashed).toHaveLength(1)
  })

  it('stays when the person may not trash documents (a member), and the conversation is deleted all the same', async () => {
    const member = browser(front.memberKey)
    const { id } = await conversation(member, [['Which part charges the battery?', 'The BQ25185.']])
    await member.deleteSession(id)
    expect(sim.trash.has(id)).toBe(true)
    expect(front.trashed).toEqual([])
  })
})
