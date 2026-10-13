/**
 * The hosted chat's follow-up turn, against a scripted Choreograph over a real
 * socket (NO MOCKS). Every test names the defect the live probe of 2026-09-28
 * (`hoja-probe`, F-step-zero) found, or the race behind it.
 *
 * The scripted host releases one stage of a turn per `/events` request, so the
 * interleavings that a real host produces by timing (its follow-up SSE
 * connections closed after 35 to 125 ms) are reproduced exactly, not hoped for.
 */
import type { ChatEvent } from '@shrubbery/chat-kernel'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeHostedChatService } from '../hosted-chat-service.js'
import {
  ChoreographSim,
  DOMAIN_WORKFLOW,
  completed,
  delta,
  plainTurn,
  started,
  turnDone,
  type TurnScript,
} from './fixtures/choreograph-sim.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const GRAPH = 'hoja-qa-20260923'

function chatOver(sim: ChoreographSim, storage: MemoryStorage, options: { streamDeadlineMs?: number } = {}) {
  return makeHostedChatService({
    graphBaseUrl: (graph: string) => sim.graphBase(graph),
    graphId: () => GRAPH,
    userId: () => 'probe',
    token: () => 'jwt',
    storage,
    resolveAttempts: 3,
    resolveDelayMs: 0,
    sleep: async () => undefined,
    ...options,
  })
}

async function collect(handle: Awaited<ReturnType<ReturnType<typeof chatOver>['startTurn']>>) {
  const events: ChatEvent[] = []
  for await (const item of handle.events) events.push(item)
  return { events, outcome: await handle.done }
}

const words = (events: readonly ChatEvent[]): string =>
  events.flatMap(event => (event.type === 'text' ? [event.content] : [])).join('')

/** The follow-up the live probe saw truncated: "Read" now, " and search workspace." a moment later. */
const TRUNCATION_PRONE: TurnScript = {
  answer: 'Read and search workspace.',
  stages: [
    [started(), delta('Read')],
    [delta(' and search workspace.'), turnDone(), completed('Read and search workspace.')],
  ],
}

describe('a follow-up turn against a host whose event stream closes early', () => {
  let sim: ChoreographSim
  beforeEach(async () => {
    sim = new ChoreographSim()
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('delivers every word of the reply, in order, when the rest arrives between two reads (D2)', async () => {
    // Defect guarded: after each SSE close the cursor jumped to the newest event in
    // the session snapshot, over deltas the stream had not yet delivered, and the
    // terminal reconciliation could only fill an EMPTY bubble: the reply stayed "Read".
    sim.queueTurn(plainTurn('I can help you read and search your workspace.'))
    sim.queueTurn(TRUNCATION_PRONE)
    const chat = chatOver(sim, new MemoryStorage())
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'What can you help me with?'))

    const second = await collect(await chat.startTurn(created.id, 'Say that again, briefly.'))

    expect(second.outcome).toEqual({ state: 'completed' })
    expect(words(second.events)).toBe('Read and search workspace.')
    expect(second.events.at(-1)).toEqual({ type: 'done', output: 'Read and search workspace.' })
    // One terminal event, not one from the stream and another from reconciliation.
    expect(second.events.filter(event => event.type === 'done')).toHaveLength(1)
  })

  it('delivers the whole reply of the FIRST turn too, however the reads fall', async () => {
    sim.queueTurn({
      answer: 'Hello there, friend.',
      stages: [
        [started(), delta('Hello')],
        [delta(' there,'), delta(' friend.'), turnDone(), completed('Hello there, friend.')],
      ],
    })
    const chat = chatOver(sim, new MemoryStorage())
    const created = await chat.createSession()
    const turn = await collect(await chat.startTurn(created.id, 'Hi'))
    expect(turn.outcome).toEqual({ state: 'completed' })
    expect(words(turn.events)).toBe('Hello there, friend.')
  })

  it('follows a slow turn to its end however many times the stream closes on it', async () => {
    // Defect guarded: the read loop gave up after eight reconnects. A reasoning
    // model that takes a while, on a host that closes the stream each time, was
    // reported as a lost turn. Here the stream closes thirty times.
    const chunks = Array.from({ length: 30 }, (_, index) => `part${index} `)
    sim.queueTurn(plainTurn('First.'))
    sim.queueTurn({
      answer: chunks.join(''),
      stages: [
        [started()],
        ...chunks.slice(0, -1).map(chunk => [delta(chunk)]),
        [delta(chunks.at(-1)!), turnDone(), completed(chunks.join(''))],
      ],
    })
    const chat = chatOver(sim, new MemoryStorage())
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'One'))
    const slow = await collect(await chat.startTurn(created.id, 'Two'))
    expect(slow.outcome).toEqual({ state: 'completed' })
    expect(words(slow.events)).toBe(chunks.join(''))
  })

  it('does not replay events it has already delivered', async () => {
    sim.queueTurn(plainTurn('First answer.'))
    sim.queueTurn(TRUNCATION_PRONE)
    const chat = chatOver(sim, new MemoryStorage())
    const created = await chat.createSession()
    const first = await collect(await chat.startTurn(created.id, 'First question'))
    const second = await collect(await chat.startTurn(created.id, 'Second question'))
    expect(words(first.events)).toBe('First answer.')
    // The second turn's stream begins after the first turn's events.
    expect(words(second.events)).not.toContain('First answer.')
    expect(second.events.filter(event => event.type === 'turn_start')).toHaveLength(1)
  })

  it('gives up honestly when the host never finishes, instead of waiting forever', async () => {
    sim.queueTurn(plainTurn('First.'))
    // A turn that never completes: after its first words, ten thousand empty stages.
    sim.queueTurn({
      answer: 'never',
      stages: [[started(), delta('Working')], ...Array.from({ length: 10_000 }, () => [] as never[])],
    })
    const chat = chatOver(sim, new MemoryStorage(), { streamDeadlineMs: 50 })
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'One'))
    const stuck = await collect(await chat.startTurn(created.id, 'Two'))
    expect(stuck.outcome).toMatchObject({ state: 'failed', failure: { recovery: 'reconcile' } })
    expect(stuck.events.at(-1)).toMatchObject({ type: 'error' })
  })
})

describe('the transcript on reload', () => {
  let sim: ChoreographSim
  beforeEach(async () => {
    sim = new ChoreographSim()
    await sim.start()
  })
  afterEach(async () => sim.stop())

  async function twoTurns(storage: MemoryStorage, second: TurnScript) {
    sim.queueTurn(plainTurn('I can help you read and search your workspace.'))
    sim.queueTurn(second)
    const chat = chatOver(sim, storage)
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'What can you help me with?'))
    await collect(await chat.startTurn(created.id, 'Say that again in five words or fewer.'))
    return { chat, id: created.id }
  }

  it('shows a follow-up answer once when the run-level node-result repeats it (D3)', async () => {
    // Defect guarded: the session transcript carries a `command-result` and, after
    // it, a `node-result` with the same words; every item was rendered.
    const storage = new MemoryStorage()
    const { chat, id } = await twoTurns(storage, plainTurn('Read and search workspace.', { echo: true }))

    const hydrated = await chat.hydrateSession(id)
    expect(hydrated.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'What can you help me with?'],
      ['assistant', 'I can help you read and search your workspace.'],
      ['user', 'Say that again in five words or fewer.'],
      ['assistant', 'Read and search workspace.'],
    ])

    // …and on a fresh browser load over the same conversation.
    const reloaded = chatOver(sim, storage)
    const again = await reloaded.hydrateSession(id)
    expect(again.messages).toHaveLength(4)
  })

  it('keeps the canonical command result, not the echo, and gives each message one stable id', async () => {
    const { chat, id } = await twoTurns(new MemoryStorage(), plainTurn('Read and search workspace.', { echo: true }))
    const messages = (await chat.hydrateSession(id)).messages
    const answer = messages.at(-1)!
    expect(answer.id).toMatch(/^command:.+:result$/)
    expect(new Set(messages.map(message => message.id)).size).toBe(messages.length)
  })

  it('does not collapse two different turns that happen to answer with the same words', async () => {
    // The dedupe is for a repeat of ONE turn's result, never for a model that says
    // "OK." twice to two questions.
    sim.queueTurn(plainTurn('OK.'))
    sim.queueTurn(plainTurn('OK.'))
    const chat = chatOver(sim, new MemoryStorage())
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'Will you do it?'))
    await collect(await chat.startTurn(created.id, 'Really?'))
    const messages = (await chat.hydrateSession(created.id)).messages
    expect(messages.filter(message => message.role === 'assistant').map(message => message.content))
      .toEqual(['OK.', 'OK.'])
  })

  it('does not seed the first turn with its own answer either', async () => {
    const chat = chatOver(sim, new MemoryStorage())
    const created = await chat.createSession()
    const handle = await chat.startTurn(created.id, 'Hello')
    const seeded = await chat.hydrateSession(created.id)
    expect(seeded.messages.map(message => [message.role, message.content])).toEqual([['user', 'Hello']])
    const turn = await collect(handle)
    expect(words(turn.events)).toBe(`Reply in ${GRAPH}.`)
    const settled = await chat.hydrateSession(created.id)
    expect(settled.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'Hello'],
      ['assistant', `Reply in ${GRAPH}.`],
    ])
  })

  it('does not double the answer the store re-seeds from when the turn was already durable', async () => {
    // Defect guarded: the store re-seeds its fold base from hydrateSession right after
    // startTurn. A reply that had already reached the durable transcript by then was in
    // the base AND arrived again through the stream: two bubbles for one answer.
    sim.queueTurn(plainTurn('First.'))
    sim.queueTurn(plainTurn('Already complete.'))
    const chat = chatOver(sim, new MemoryStorage())
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'One'))
    const handle = await chat.startTurn(created.id, 'Two')
    // The moment the store re-seeds, while the turn's stream is in flight.
    const seeded = await chat.hydrateSession(created.id)
    expect(seeded.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'One'],
      ['assistant', 'First.'],
      ['user', 'Two'],
    ])
    const turn = await collect(handle)
    expect(words(turn.events)).toBe('Already complete.')
    const settled = await chat.hydrateSession(created.id)
    expect(settled.messages.filter(message => message.role === 'assistant').map(message => message.content))
      .toEqual(['First.', 'Already complete.'])
  })
})

describe('message times (D4)', () => {
  let sim: ChoreographSim
  beforeEach(async () => {
    sim = new ChoreographSim()
    await sim.start()
  })
  afterEach(async () => sim.stop())

  function eventTimes(type: string): number[] {
    return sim.session().events.filter(event => event.type === type).map(event => event.ts)
  }

  it('stamps each message with when it happened, not with when it was loaded', async () => {
    // Defect guarded: transcript items carry no time, so every hydrated message fell
    // back to Date.now(); the first user bubble showed the chat's creation time.
    const storage = new MemoryStorage()
    sim.queueTurn(plainTurn('I can help you read and search your workspace.'))
    sim.queueTurn(plainTurn('Read and search workspace.', { echo: true }))
    const chat = chatOver(sim, storage)
    const created = await chat.createSession()
    await new Promise(resolve => setTimeout(resolve, 20))
    await collect(await chat.startTurn(created.id, 'What can you help me with?'))
    await collect(await chat.startTurn(created.id, 'Say that again in five words or fewer.'))

    const check = async (service: typeof chat): Promise<void> => {
      const messages = (await service.hydrateSession(created.id)).messages
      expect(messages).toHaveLength(4)
      // The first message is dated when the host began the session that answered it:
      // the same clock as every later message, not when the chat was made.
      expect(messages[0].createdAt).toBe(sim.session().createdAt)
      const [firstDone, secondDone] = eventTimes('message.completed')
      expect(messages[1].createdAt).toBe(firstDone)
      expect(messages[2].createdAt).toBe(eventTimes('command.accepted')[0])
      expect(messages[3].createdAt).toBe(secondDone)
      const times = messages.map(message => message.createdAt)
      expect([...times].sort((left, right) => left - right)).toEqual(times)
    }
    await check(chat)
    // A later page load says the same thing.
    await check(chatOver(sim, storage))
  })

  it('dates the first message by when it was sent while the host has not yet begun a session', async () => {
    // A launch whose answer was lost leaves a descriptor with the message and no
    // session. The chat was made an hour ago; the message was sent seconds ago.
    const storage = new MemoryStorage()
    const madeAt = new Date(Date.now() - 60 * 60_000).toISOString()
    const sentAt = new Date(Date.now() - 5_000).toISOString()
    const root = `shrubbery:c2chat:v1:probe:${GRAPH}`
    storage.setItem(`${root}:descriptor-index`, JSON.stringify(['c2chat-pending']))
    storage.setItem(`${root}:descriptor:c2chat-pending`, JSON.stringify({
      schema: 'shrubbery.cloud2-chat-descriptor.v1',
      virtualId: 'c2chat-pending',
      graphId: GRAPH,
      title: null,
      modelId: 'sophia-1/profile',
      clientId: 'c2chat-client-pending',
      createdAt: madeAt,
      updatedAt: sentAt,
      cursor: 0,
      invocationId: 'c2chat.inv.pending',
      invocationPending: true,
      invocationSubmittedAt: sentAt,
      initialUserText: 'Was this heard?',
      initialUserMessageId: 'c2chat-pending:initial-user',
    }))
    const chat = chatOver(sim, storage)
    const [message] = (await chat.hydrateSession('c2chat-pending')).messages
    expect(message.content).toBe('Was this heard?')
    expect(message.createdAt).toBe(Date.parse(sentAt))
    expect(message.createdAt).not.toBe(Date.parse(madeAt))
  })

  it('honours a time the host records on the transcript item itself', async () => {
    // The host does not do this today; the day it does, it wins over any inference.
    sim.queueTurn(plainTurn('First.'))
    const storage = new MemoryStorage()
    const chat = chatOver(sim, storage)
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'One'))
    const session = sim.session()
    const [id] = session.order
    const inferred = (await chat.hydrateSession(created.id)).messages.at(-1)!.createdAt
    // A realistic time: after the session began (the host's own clock), before the event the
    // inference would have used, so it can be told from it.
    const stamped = session.createdAt + 500
    expect(stamped).toBeLessThan(inferred)
    session.items[id] = { ...session.items[id], ts: stamped }
    const messages = (await chat.hydrateSession(created.id)).messages
    expect(messages.at(-1)!.createdAt).toBe(stamped)
  })

  it('does not let a recorded time older than the message before it run the conversation backwards', async () => {
    // Defect guarded: this test once stamped 1970 on the reply and expected 1970 back; the
    // conversation reads in order, so a time older than what precedes it takes that time instead.
    sim.queueTurn(plainTurn('First.'))
    const chat = chatOver(sim, new MemoryStorage())
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'One'))
    const session = sim.session()
    const [id] = session.order
    session.items[id] = { ...session.items[id], ts: 1_234_567 }
    const messages = (await chat.hydrateSession(created.id)).messages
    const users = messages.filter(message => message.role === 'user')
    expect(messages.at(-1)!.createdAt).toBeGreaterThanOrEqual(users[0].createdAt)
    expect(messages.at(-1)!.createdAt).not.toBe(1_234_567)
  })

  it('never reads the clock for a message the host has already recorded', async () => {
    const storage = new MemoryStorage()
    sim.queueTurn(plainTurn('First.'))
    const chat = chatOver(sim, storage)
    const created = await chat.createSession()
    await collect(await chat.startTurn(created.id, 'One'))
    const before = (await chat.hydrateSession(created.id)).messages.map(message => message.createdAt)
    await new Promise(resolve => setTimeout(resolve, 25))
    const after = (await chat.hydrateSession(created.id)).messages.map(message => message.createdAt)
    expect(after).toEqual(before)
  })
})

describe('a workspace with no Domain Agent (D6)', () => {
  let sim: ChoreographSim
  beforeEach(async () => {
    sim = new ChoreographSim()
    await sim.start()
  })
  afterEach(async () => sim.stop())

  const targets = (): string[] => sim.invocations().map(call => call.body.target.workflowName)

  it('spends the 404 once per page load and then goes straight to the built-in assistant', async () => {
    const chat = chatOver(sim, new MemoryStorage())
    const one = await chat.createSession()
    await collect(await chat.startTurn(one.id, 'One'))
    const two = await chat.createSession()
    await collect(await chat.startTurn(two.id, 'Two'))
    expect(targets()).toEqual([DOMAIN_WORKFLOW.name, 'workspace-chat-v1', 'workspace-chat-v1'])
  })

  it('remembers it across page loads for a short while, so a reload does not spend the 404 again', async () => {
    const storage = new MemoryStorage()
    const first = chatOver(sim, storage)
    const one = await first.createSession()
    await collect(await first.startTurn(one.id, 'One'))

    // A new page load: a new service over the same browser storage.
    const reloaded = chatOver(sim, storage)
    const two = await reloaded.createSession()
    await collect(await reloaded.startTurn(two.id, 'Two'))
    expect(targets()).toEqual([DOMAIN_WORKFLOW.name, 'workspace-chat-v1', 'workspace-chat-v1'])
  })

  it('asks the graph again once the memory is stale: a Domain Agent may have been provisioned since', async () => {
    const storage = new MemoryStorage()
    const first = chatOver(sim, storage)
    const one = await first.createSession()
    await collect(await first.startTurn(one.id, 'One'))
    for (const [key, value] of storage.values) {
      if (key.endsWith(':no-domain-agent') && value) {
        storage.values.set(key, new Date(Date.now() - 60 * 60_000).toISOString())
      }
    }
    sim.provisioned.add(GRAPH)

    const reloaded = chatOver(sim, storage)
    const two = await reloaded.createSession()
    await collect(await reloaded.startTurn(two.id, 'Two'))
    expect(targets().slice(2)).toEqual([DOMAIN_WORKFLOW.name])
  })

  it('does not remember it for a graph where the Domain Agent exists', async () => {
    sim.provisioned.add(GRAPH)
    const storage = new MemoryStorage()
    const first = chatOver(sim, storage)
    const one = await first.createSession()
    await collect(await first.startTurn(one.id, 'One'))
    const reloaded = chatOver(sim, storage)
    const two = await reloaded.createSession()
    await collect(await reloaded.startTurn(two.id, 'Two'))
    expect(targets()).toEqual([DOMAIN_WORKFLOW.name, DOMAIN_WORKFLOW.name])
  })
})
