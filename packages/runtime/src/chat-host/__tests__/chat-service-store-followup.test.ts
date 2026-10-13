/**
 * The chat store over the real hosted service and a scripted Choreograph (NO MOCKS):
 * what a person sees on screen after a second message, on a host whose event stream
 * closes early (F-step-zero D2, D3).
 *
 * The store folds the service's events through the real projector and re-seeds its
 * base from `hydrateSession` right after `startTurn`, so a fault in either the
 * service's cursor or the durable transcript shows up here as the wrong bubbles.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeHostedChatService } from '../../chat-services/hosted-chat-service.js'
import {
  ChoreographSim,
  completed,
  delta,
  plainTurn,
  reserved,
  settled,
  started,
  turnDone,
} from '../../chat-services/__tests__/fixtures/choreograph-sim.js'
import { createChatServiceStore, type ChatServiceStore } from '../chat-service-store.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('store test timed out')
    await new Promise(resolve => setTimeout(resolve, 2))
  }
}

const shown = (store: ChatServiceStore): Array<[string, string]> =>
  store.getState().messages.map(message => [message.role, message.content])

async function say(store: ChatServiceStore, text: string): Promise<void> {
  const before = store.getState().messages.length
  store.send(text)
  await until(() => {
    const state = store.getState()
    return !state.streaming && state.messages.length >= before + 2
  })
}

describe('the store over a hosted follow-up', () => {
  let sim: ChoreographSim
  let store: ChatServiceStore
  beforeEach(async () => {
    sim = new ChoreographSim()
    await sim.start()
    const service = makeHostedChatService({
      graphBaseUrl: (graph: string) => sim.graphBase(graph),
      graphId: () => 'hoja-qa-20260923',
      userId: () => 'probe',
      token: () => 'jwt',
      storage: new MemoryStorage(),
      resolveAttempts: 3,
      resolveDelayMs: 0,
      sleep: async () => undefined,
    })
    const created = await service.createSession()
    service.bindSlotSession(0, created.id)
    store = createChatServiceStore(service)
    store.setSession(created.id)
    await until(() => store.getState().conversationState === 'ready')
  })
  afterEach(async () => sim.stop())

  it('ends a follow-up with the whole reply in one bubble (D2)', async () => {
    sim.queueTurn(plainTurn('I can help you read and search your workspace.'))
    sim.queueTurn({
      answer: 'Read and search workspace.',
      stages: [
        [started(), delta('Read')],
        [delta(' and search workspace.'), turnDone(), completed('Read and search workspace.')],
      ],
    })
    await say(store, 'What can you help me with?')
    await say(store, 'Now say that again in five words or fewer.')

    expect(shown(store)).toEqual([
      ['user', 'What can you help me with?'],
      ['assistant', 'I can help you read and search your workspace.'],
      ['user', 'Now say that again in five words or fewer.'],
      ['assistant', 'Read and search workspace.'],
    ])
    expect(store.getState().sendState).toBe('ready')
    expect(store.getState().messages.every(message => !message.isStreaming)).toBe(true)
  })

  it('shows one bubble for a reply that was already durable when the base was re-seeded', async () => {
    // Defect guarded: the re-seed read the durable transcript, which already held the
    // finished reply, and the stream then delivered the same reply again.
    sim.queueTurn(plainTurn('First.'))
    sim.queueTurn(plainTurn('Already complete.'))
    await say(store, 'One')
    await say(store, 'Two')
    expect(shown(store)).toEqual([
      ['user', 'One'],
      ['assistant', 'First.'],
      ['user', 'Two'],
      ['assistant', 'Already complete.'],
    ])
  })

  it('shows one bubble for the FIRST reply when it was already durable at the re-seed', async () => {
    sim.queueTurn(plainTurn('Already complete.'))
    await say(store, 'One')
    expect(shown(store)).toEqual([
      ['user', 'One'],
      ['assistant', 'Already complete.'],
    ])
  })

  it('still shows a reply once after the run-level result repeats it, on the next send (D3)', async () => {
    // Defect guarded: the repeat is in the transcript from the moment the follow-up
    // completes, so the very next send re-seeded a doubled answer.
    sim.queueTurn(plainTurn('First.'))
    sim.queueTurn(plainTurn('Read and search workspace.', { echo: true }))
    sim.queueTurn(plainTurn('Third.'))
    await say(store, 'One')
    await say(store, 'Two')
    await say(store, 'Three')
    expect(shown(store)).toEqual([
      ['user', 'One'],
      ['assistant', 'First.'],
      ['user', 'Two'],
      ['assistant', 'Read and search workspace.'],
      ['user', 'Three'],
      ['assistant', 'Third.'],
    ])
  })

  it('shows a follow-up the host answered with no message events (a warm Session), with its cost (D-A)', async () => {
    // Defect guarded (seen live 2026-10-01): a follow-up sent within a minute of a reply, while the Session was
    // still warm, was answered and billed, but the host's events for it were only the ledger's and the
    // command's. Nothing was shown until the next message or a reload. The second turn here carries exactly
    // that: no turn.started, no message.delta, no message.completed; the answer is durable when it ends.
    sim.queueTurn(plainTurn('Six.'))
    sim.queueTurn({ answer: 'Six.', stages: [[reserved(), settled(692)]] })
    await say(store, 'What is two times three? One word.')
    await say(store, 'And again, the same question?')
    expect(shown(store)).toEqual([
      ['user', 'What is two times three? One word.'],
      ['assistant', 'Six.'],
      ['user', 'And again, the same question?'],
      ['assistant', 'Six.'],
    ])
    const reply = store.getState().messages[3]
    expect(reply.isStreaming).toBe(false)
    expect(reply.costMicroUsd).toBe(692)
  })
})
