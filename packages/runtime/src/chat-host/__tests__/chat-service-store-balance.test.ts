/**
 * The credit balance beside the picker through the real store over the real hosted
 * service and a scripted gateway (NO MOCKS): what the line says when it is read, and
 * what it says when it could not be.
 *
 * The billing states in full (normal, low, out, starter credit, the refusal banner, the
 * chip) are held in `chat-service-store-billing.test.ts`. This file keeps the first
 * release's promises: the line reads the gateway's own figure, reads again after a
 * turn, and the client never gates sending on it (the gateway and the host decide what
 * is refused; the panel only says).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeHostedChatService } from '../../chat-services/hosted-chat-service.js'
import { makeLocalChatService } from '../../chat-services/local-chat-service.js'
import { ChoreographSim } from '../../chat-services/__tests__/fixtures/choreograph-sim.js'
import { SobremesaRoutes } from '../../chat-services/__tests__/fixtures/sobremesa-routes.js'
import { createChatServiceStore, type ChatServiceStore } from '../chat-service-store.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const USER = '4999d9ce-3091-70d0-9c80-7bed4a0fc77d'

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

describe('the balance line, as read', () => {
  let sim: ChoreographSim
  let routes: SobremesaRoutes
  let store: ChatServiceStore

  async function open(): Promise<void> {
    const service = makeHostedChatService({
      gatewayBaseUrl: sim.base,
      graphBaseUrl: (graph: string) => sim.graphBase(graph),
      graphId: () => 'hoja-qa-20260923',
      userId: () => USER,
      token: () => 'jwt',
      storage: new MemoryStorage(),
      resolveAttempts: 3,
      resolveDelayMs: 0,
      sleep: async () => undefined,
    })
    const created = await service.createSession()
    service.bindSlotSession(0, created.id)
    // These are the balance line's states as the shell that can take the person to Billing shows them.
    store = createChatServiceStore(service, { canAddCredits: () => true })
    store.setSession(created.id)
    await until(() => store.getState().conversationState === 'ready')
  }

  beforeEach(async () => {
    sim = new ChoreographSim()
    routes = new SobremesaRoutes(sim)
    await sim.start()
  })
  afterEach(async () => sim.stop())

  it('shows the credit balance beside the picker once the gateway has said it', async () => {
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, 970_000) }
    await open()
    await until(() => store.getState().accountNote !== null)
    expect(store.getState().accountNote).toEqual({
      label: 'Credit',
      value: '$0.97',
      tone: 'ok',
      hint: 'Your credit balance. It is the same figure as Settings, Billing.',
    })
  })

  it('says the balance is unavailable when the gateway cannot say, and never shows it as zero', async () => {
    routes.balance = null
    await open()
    await until(() => store.getState().accountNote !== null)
    expect(store.getState().accountNote).toMatchObject({ label: 'Credit', value: 'unavailable' })
    expect(store.getState().accountNote!.tone).toBeUndefined()
    expect(routes.asked.balance).toBeGreaterThan(0)
  })

  it('says a starter credit, not "not initialized", for an account without a credit record', async () => {
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, 0, { initialized: false }) }
    await open()
    await until(() => store.getState().accountNote !== null)
    expect(store.getState().accountNote).toMatchObject({ value: '$1.00 starter credit', tone: 'ok' })
  })

  it('says the account is out of credits when the balance is at or below zero, where the gate enforces', async () => {
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, -1_250, { gateMode: 'enforce' }) }
    await open()
    await until(() => store.getState().accountNote !== null)
    expect(store.getState().accountNote).toMatchObject({ label: 'Out of credits', tone: 'out' })
  })

  it('marks the line "out" when the gateway itself says a request would be refused, where the gate enforces', async () => {
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, 900_000, { canMakeRequests: false, gateMode: 'enforce' }) }
    await open()
    await until(() => store.getState().accountNote !== null)
    expect(store.getState().accountNote).toMatchObject({ tone: 'out' })
  })

  it('says the balance, never "out", for the same balance where the gate only observes', async () => {
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, -1_250, { gateMode: 'observe' }) }
    await open()
    await until(() => store.getState().accountNote !== null)
    expect(store.getState().accountNote).toMatchObject({ label: 'Running low', value: '$0.00', tone: 'low' })
    expect(store.getState().accountNote).not.toMatchObject({ tone: 'out' })
  })

  it('says the balance, never "out", for a backend that names no mode', async () => {
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, 900_000, { canMakeRequests: false }) }
    await open()
    await until(() => store.getState().accountNote !== null)
    expect(store.getState().accountNote).toMatchObject({ label: 'Credit', value: '$0.90', tone: 'ok' })
  })

  it('reads the balance again after each turn, which is when a turn is debited', async () => {
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, 970_000) }
    await open()
    await until(() => store.getState().accountNote?.value === '$0.97')
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, 960_000) }
    await say(store, 'Hello')
    await until(() => store.getState().accountNote?.value === '$0.96')
  })

  it('does not gate sending on the balance: the line says, and the gateway decides what is refused', async () => {
    // Defect avoided: the client refusing a message the platform would have taken (or
    // taking one it would refuse). Only a refusal from the platform makes a banner.
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, -900_000, { canMakeRequests: false }) }
    await open()
    await until(() => store.getState().accountNote !== null)
    expect(store.getState().composerNotice).toBeNull()
    await say(store, 'Still sending')
    expect(store.getState().messages.map(message => [message.role, message.content])[0]).toEqual(['user', 'Still sending'])
    expect(store.getState().sendState).toBe('ready')
    expect(store.getState().composerNotice).toBeNull()
    expect(sim.invocations().length).toBeGreaterThan(0)
  })
})

describe('a service that cannot say what an account holds (the local control)', () => {
  it('has no line and no notice', async () => {
    const service = makeLocalChatService()
    const created = await service.createSession({ title: 't' })
    const store = createChatServiceStore(service)
    store.setSession(created.id)
    await until(() => store.getState().conversationState === 'ready')
    expect(store.getState().accountNote).toBeNull()
    expect(store.getState().composerNotice).toBeNull()
  })
})
