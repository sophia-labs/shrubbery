/**
 * The chat store over a conversation that picked up an imported one (NO MOCKS: the real
 * hosted service, a real in-memory archive, a scripted Choreograph over a real socket).
 *
 * The window is part of what the store projects, read-only and ahead of everything said
 * here; the seam rides beside it; the voice is fixed at the seam; and a first message
 * that cannot be sent leaves the window as it was and gives the person their words back.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeHostedChatService } from '../../chat-services/hosted-chat-service.js'
import {
  ChoreographSim,
  DOMAIN_WORKFLOW,
  workspaceWorkflow,
} from '../../chat-services/__tests__/fixtures/choreograph-sim.js'
import {
  CONVERSATION_ID,
  MemoryArchive,
  REVISION_ID,
  turn,
} from '../../chat-services/__tests__/fixtures/memory-archive.js'
import { SobremesaRoutes } from '../../chat-services/__tests__/fixtures/sobremesa-routes.js'
import { createChatServiceStore, type ChatServiceStore } from '../chat-service-store.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const KIMI_K25 = 'moonshotai/kimi-k2.5'
const KIMI_K26 = 'moonshotai/kimi-k2.6'
const T0 = Date.UTC(2026, 0, 5, 12, 0)

async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('store test timed out')
    await new Promise(resolve => setTimeout(resolve, 2))
  }
}

describe('the store over a continued conversation', () => {
  let sim: ChoreographSim
  let routes: SobremesaRoutes
  let store: ChatServiceStore
  let service: ReturnType<typeof makeHostedChatService>
  let openedId: string

  beforeEach(async () => {
    sim = new ChoreographSim()
    routes = new SobremesaRoutes(sim)
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true })]
    await sim.start()
    const archive = new MemoryArchive([
      turn(0, 'user', 'What is a monad?', { at: T0 }),
      turn(1, 'assistant', 'A monad is a design pattern.', { at: T0 + 30_000, voice: { id: KIMI_K25, provider: 'opencode' } }),
    ])
    service = makeHostedChatService({
      gatewayBaseUrl: sim.base,
      graphBaseUrl: (graph: string) => sim.graphBase(graph),
      graphId: () => 'atelier-20260929',
      userId: () => 'probe',
      token: () => 'jwt',
      storage: new MemoryStorage(),
      archive,
      resolveAttempts: 3,
      resolveDelayMs: 0,
      sleep: async () => undefined,
    })
    await service.probeCapabilities!()
    const plan = await service.prepareContinuation!({
      conversationId: CONVERSATION_ID,
      revisionId: REVISION_ID,
      title: archive.title,
      messagesLoaded: 2,
    })
    const opened = await service.continueConversation!(plan, { modelId: KIMI_K26 })
    openedId = opened.id
    service.bindSlotSession(0, opened.id)
    store = createChatServiceStore(service)
    store.setSession(opened.id)
    await until(() => store.getState().conversationState === 'ready')
  })
  afterEach(async () => {
    store.dispose()
    await sim.stop()
  })

  it('shows the window read-only with the seam beside it, before a word is said', () => {
    const state = store.getState()
    expect(state.messages.map(message => [message.role, message.origin])).toEqual([
      ['user', 'window'],
      ['assistant', 'window'],
    ])
    expect(state.messages[1].voice).toMatchObject({ id: KIMI_K25, basis: 'source-recorded' })
    expect(state.seam).toMatchObject({
      omittedCount: 0,
      originalTitle: 'Monads, again',
      voiceLabel: 'Kimi K2.6',
      providerNotice: 'Continuing sends this conversation to Moonshot through OpenRouter.',
    })
    expect(state.currentModel).toBe(KIMI_K26)
    expect(state.sessionTitle).toBe('Monads, again · continued')
    expect(state.sendState).toBe('ready')
  })

  it('does not treat the window as this conversation having begun, but does not let the voice change either', () => {
    store.setModel!(KIMI_K25)
    expect(store.getState().currentModel).toBe(KIMI_K26)
    expect(service.sessionModelId!(openedId)).toBe(KIMI_K26)
  })

  it('sends the first message: the window stays first, the seam stays, the reply carries the voice that spoke', async () => {
    store.send('So where were we?')
    await until(() => !store.getState().streaming && store.getState().messages.length >= 4)
    const { messages, seam } = store.getState()
    expect(messages.map(message => [message.role, message.origin ?? 'live'])).toEqual([
      ['user', 'window'],
      ['assistant', 'window'],
      ['user', 'live'],
      ['assistant', 'live'],
    ])
    expect(messages[1].voice).toMatchObject({ id: KIMI_K25, basis: 'source-recorded' })
    expect(messages[3].voice).toMatchObject({ id: KIMI_K26, basis: 'live' })
    expect(seam).toMatchObject({ originalTitle: 'Monads, again', voiceLabel: 'Kimi K2.6' })
    expect(routes.seeds).toHaveLength(1)
  })

  it('gives the person their words back, and leaves the window as it was, when the first message cannot be sent', async () => {
    routes.seedRefusal = { status: 413, body: { error: { code: 'seed_too_large', message: 'over the cap' } } }
    store.send('So where were we?')
    await until(() => store.getState().sendState === 'error')
    const state = store.getState()
    expect(state.sendError).toMatch(/too large to carry over/)
    expect(state.retainedDraft).toBe('So where were we?')
    expect(state.messages.map(message => message.origin)).toEqual(['window', 'window'])
    expect(state.streaming).toBe(false)
    expect(sim.invocations()).toEqual([])
    expect(state.seam).not.toBeNull()
  })

  it('offers to try again when the seed store is only busy, and the second try goes through', async () => {
    routes.seedRefusal = { status: 503, body: { error: { code: 'seed_store_unavailable', message: 'warming up' } } }
    store.send('So where were we?')
    await until(() => store.getState().sendState === 'error')
    expect(store.getState().sendRecovery).toBe('resubmit')
    routes.seedRefusal = null
    store.continuityAction!({ type: 'retry-send' })
    await until(() => !store.getState().streaming && store.getState().messages.length >= 4)
    expect(store.getState().messages.at(-1)!.role).toBe('assistant')
    expect(routes.seeds).toHaveLength(1)
  })
})
