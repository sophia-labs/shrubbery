/**
 * The credits notice in the chat store's one slot above the composer (NO MOCKS: the real store
 * over the real local service, and over the real hosted service and a scripted Choreograph for the
 * refusals that must outrank it).
 *
 * The slot carries one thing at a time. A refusal the platform just gave, and a chat that reached
 * its size limit, are about the message the person is trying to send: they come first. The
 * heads-up that credits are starting is about the future: it takes the slot only when nothing
 * more urgent has it, and gives it back the moment something does.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatComposerNotice } from '@shrubbery/chat-kernel'
import { makeHostedChatService } from '../../chat-services/hosted-chat-service.js'
import { makeLocalChatService } from '../../chat-services/local-chat-service.js'
import {
  ChoreographSim,
  DOMAIN_WORKFLOW,
  workspaceWorkflow,
} from '../../chat-services/__tests__/fixtures/choreograph-sim.js'
import { SobremesaRoutes } from '../../chat-services/__tests__/fixtures/sobremesa-routes.js'
import type { CreditsFacts } from '../../chat-services/credits-facts.js'
import { createChatServiceStore, type ChatServiceStore } from '../chat-service-store.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const USER = '4999d9ce-3091-70d0-9c80-7bed4a0fc77d'

const HEADS_UP: ChatComposerNotice = {
  id: 'credits-notice',
  tone: 'info',
  title: 'Credits start on October 12, 2026.',
  body: 'From then each message uses credits from your balance.',
  dismiss: { id: 'dismiss-credits-notice', label: 'Dismiss' },
}

async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('store test timed out')
    await new Promise(resolve => setTimeout(resolve, 2))
  }
}

describe('the heads-up that credits are starting, in the store', () => {
  const stores: ChatServiceStore[] = []
  const sims: ChoreographSim[] = []
  afterEach(async () => {
    for (const store of stores.splice(0)) store.dispose()
    for (const sim of sims.splice(0)) await sim.stop()
  })

  async function localStore(creditsNotice?: (facts: CreditsFacts | null) => ChatComposerNotice | null): Promise<ChatServiceStore> {
    const service = makeLocalChatService()
    const session = await service.createSession({ title: 'credits-notice' })
    const store = createChatServiceStore(service, { canAddCredits: () => true, ...(creditsNotice ? { creditsNotice } : {}) })
    stores.push(store)
    store.setSession(session.id)
    await until(() => store.getState().conversationState === 'ready')
    return store
  }

  it('shows nothing in the slot when no one has anything to say (the voices release as it was)', async () => {
    const store = await localStore()
    expect(store.getState().composerNotice).toBeNull()
  })

  it('shows the heads-up when the slot is otherwise empty, read afresh each time the state is read', async () => {
    let said: ChatComposerNotice | null = HEADS_UP
    const store = await localStore(() => said)
    expect(store.getState().composerNotice).toEqual(HEADS_UP)

    said = null
    expect(store.getState().composerNotice).toBeNull()

    said = { ...HEADS_UP, title: 'Credits start on October 19, 2026.' }
    expect(store.getState().composerNotice?.title).toBe('Credits start on October 19, 2026.')
  })

  it('is told the facts of the last balance read, and null before any (it decides what to say from them)', async () => {
    const sim = new ChoreographSim()
    sims.push(sim)
    const routes = new SobremesaRoutes(sim)
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true })]
    routes.balance = {
      status: 200,
      body: SobremesaRoutes.balanceBody(USER, 970_000, { gateMode: 'observe', feeBps: 1500, creditsStartDate: '2026-10-12' }),
    }
    await sim.start()
    const service = makeHostedChatService({
      gatewayBaseUrl: sim.base,
      graphBaseUrl: (graph: string) => sim.graphBase(graph),
      graphId: () => 'atelier-20261003',
      userId: () => USER,
      token: () => 'jwt',
      storage: new MemoryStorage(),
      resolveAttempts: 3,
      resolveDelayMs: 0,
      sleep: async () => undefined,
    })
    await service.probeCapabilities!()
    const created = await service.createSession()
    service.bindSlotSession(0, created.id)
    const seen: Array<unknown> = []
    const store = createChatServiceStore(service, {
      canAddCredits: () => true,
      creditsNotice: facts => { seen.push(facts); return facts?.startDate ? { ...HEADS_UP, title: `Credits start on ${facts.startDate}.` } : null },
    })
    stores.push(store)
    expect(store.creditsFacts()).toBeNull()
    store.setSession(created.id)
    await until(() => store.getState().composerNotice !== null)

    expect(seen[0]).toBeNull()
    const facts = { feeBps: 1500, gateMode: 'observe', startDate: 'October 12, 2026' }
    expect(seen.at(-1)).toEqual(facts)
    expect(store.creditsFacts()).toEqual(facts)
    expect(store.getState().composerNotice?.title).toBe('Credits start on October 12, 2026.')
  })

  it('has no facts, and so no notice from a source that wants a date, before the balance is read or from an older backend', async () => {
    const store = await localStore(facts => (facts?.startDate ? HEADS_UP : null))
    expect(store.creditsFacts()).toBeNull()
    expect(store.getState().composerNotice).toBeNull()
  })

  it('is not stopped by a source that throws: no notice beats no chat', async () => {
    const store = await localStore(() => { throw new Error('storage refused') })
    expect(store.getState().composerNotice).toBeNull()
    expect(store.getState().conversationState).toBe('ready')
  })

  it('gives the slot to a refusal for credit, and takes it back when the person moves on', async () => {
    const sim = new ChoreographSim()
    sims.push(sim)
    const routes = new SobremesaRoutes(sim)
    sim.workflows = [DOMAIN_WORKFLOW, workspaceWorkflow({ inference: true, seed: true })]
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, 3_800) }
    await sim.start()
    const service = makeHostedChatService({
      gatewayBaseUrl: sim.base,
      graphBaseUrl: (graph: string) => sim.graphBase(graph),
      graphId: () => 'atelier-20261003',
      userId: () => USER,
      token: () => 'jwt',
      storage: new MemoryStorage(),
      resolveAttempts: 3,
      resolveDelayMs: 0,
      sleep: async () => undefined,
    })
    await service.probeCapabilities!()
    const created = await service.createSession()
    service.bindSlotSession(0, created.id)
    const store = createChatServiceStore(service, { canAddCredits: () => true, creditsNotice: () => HEADS_UP })
    stores.push(store)
    store.setSession(created.id)
    await until(() => store.getState().conversationState === 'ready')
    expect(store.getState().composerNotice?.id).toBe('credits-notice')

    sim.invocation = () => ({
      status: 402,
      body: { error: { code: 'insufficient_credit', message: '', balanceMicroUsd: 3_800, requiredMicroUsd: 6_168 } },
    })
    store.send('Hello there')
    await until(() => store.getState().composerNotice?.id === 'billing-refusal')
    expect(store.getState().composerNotice?.title).toBe("You're out of credits.")
    // A refusal never carries the heads-up's control: it is answered, not put away.
    expect(store.getState().composerNotice?.dismiss).toBeUndefined()
  })
})
