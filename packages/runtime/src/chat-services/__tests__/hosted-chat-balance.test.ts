/**
 * The credit balance beside the picker, read through the hosted chat service against
 * the gateway's own route over a real socket (NO MOCKS). `GET /billing/balance` is not
 * assumed: it is what the live gateway answered to the probe account on 2026-09-28
 * (F-step-zero), read there by Settings > Billing.
 *
 * Reading a balance changes nothing and gates nothing: it is a line of text, so every
 * way it can fail is "no line", never an error in the conversation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeHostedChatService } from '../hosted-chat-service.js'
import { ChoreographSim } from './fixtures/choreograph-sim.js'
import { recordingFetch } from './fixtures/recording-fetch.js'
import { SobremesaRoutes } from './fixtures/sobremesa-routes.js'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const USER = '4999d9ce-3091-70d0-9c80-7bed4a0fc77d'

describe('ChatService.balance()', () => {
  let sim: ChoreographSim
  let routes: SobremesaRoutes
  beforeEach(async () => {
    sim = new ChoreographSim()
    routes = new SobremesaRoutes(sim)
    await sim.start()
  })
  afterEach(async () => sim.stop())

  function chat(options: { gateway?: boolean; user?: string; token?: string | undefined; fetchImpl?: typeof fetch } = {}) {
    return makeHostedChatService({
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.gateway === false ? {} : { gatewayBaseUrl: sim.base }),
      graphBaseUrl: (graph: string) => sim.graphBase(graph),
      graphId: () => 'hoja-qa-20260923',
      userId: () => options.user ?? USER,
      token: () => ('token' in options ? options.token : 'jwt'),
      storage: new MemoryStorage(),
      resolveAttempts: 2,
      resolveDelayMs: 0,
      sleep: async () => undefined,
    })
  }

  it('reads the balance the way Settings does, with the person’s own token, from the gateway root', async () => {
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, 3_760) }
    const seen = recordingFetch()
    await expect(chat({ fetchImpl: seen.fetchImpl }).balance!()).resolves.toEqual({
      initialized: true,
      balanceMicroUsd: 3_760,
      canMakeRequests: true,
    })
    const [call] = sim.received.filter(item => item.route === '/billing/balance')
    expect(call.method).toBe('GET')
    expect(call.graph).toBeNull()
    // What the service built (happy-dom's fetch drops the header on the way to the socket, so the
    // host cannot be asked): the person's own token, no cookies, nothing cached.
    const [sent] = seen.to('/billing/balance')
    expect(sent.url.origin).toBe(sim.base)
    expect(sent.method).toBe('GET')
    expect(sent.headers.get('authorization')).toBe('Bearer jwt')
    expect(sent.credentials).toBe('omit')
    expect(sent.cache).toBe('no-store')
  })

  it('carries what the backend says of the credits regime, when it says it', async () => {
    routes.balance = {
      status: 200,
      body: SobremesaRoutes.balanceBody(USER, 970_000, { gateMode: 'observe', feeBps: 1500, creditsStartDate: '2026-10-12' }),
    }
    await expect(chat().balance!()).resolves.toEqual({
      initialized: true,
      balanceMicroUsd: 970_000,
      canMakeRequests: true,
      facts: { feeBps: 1500, gateMode: 'observe', startDate: 'October 12, 2026' },
    })
  })

  it('carries the facts it can read when the backend says only some of them', async () => {
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, 970_000, { gateMode: 'enforce' }) }
    await expect(chat().balance!()).resolves.toMatchObject({ facts: { feeBps: null, gateMode: 'enforce', startDate: null } })
  })

  it('has no `facts` at all from a backend that says nothing of them: the answer is what it always was', async () => {
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, 970_000) }
    const read = await chat().balance!()
    expect(read).not.toBeNull()
    expect('facts' in read!).toBe(false)
  })

  it('reports an account that has no credit record yet as not initialized', async () => {
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, 0, { initialized: false }) }
    await expect(chat().balance!()).resolves.toMatchObject({ initialized: false, balanceMicroUsd: 0 })
  })

  it('reports that the gateway would refuse a request when it says so', async () => {
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, -700_000, { canMakeRequests: false }) }
    await expect(chat().balance!()).resolves.toMatchObject({ balanceMicroUsd: -700_000, canMakeRequests: false })
  })

  it('shows no balance, and does not throw, wherever the read goes wrong', async () => {
    const service = chat()
    // An older gateway with no such route.
    routes.balance = null
    await expect(service.balance!()).resolves.toBeNull()
    // A session that has expired, and a gateway that is down.
    routes.balance = { status: 401, body: { error: 'expired' } }
    await expect(service.balance!()).resolves.toBeNull()
    routes.balance = { status: 503, body: { error: 'warming up' } }
    await expect(service.balance!()).resolves.toBeNull()
    // Something that is not JSON at all.
    routes.balance = { status: 200, body: undefined }
    await expect(service.balance!()).resolves.toBeNull()
  })

  it('shows no balance that is not this person’s', async () => {
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody('someone-else', 5_000_000) }
    await expect(chat().balance!()).resolves.toBeNull()
  })

  it('shows no balance whose numbers cannot be trusted', async () => {
    routes.balance = { status: 200, body: { ...SobremesaRoutes.balanceBody(USER, 100), balanceMicroUsd: 1.5 } }
    await expect(chat().balance!()).resolves.toBeNull()
    routes.balance = { status: 200, body: { ...SobremesaRoutes.balanceBody(USER, 100), balanceMicroUsd: '100' } }
    await expect(chat().balance!()).resolves.toBeNull()
    routes.balance = { status: 200, body: { ...SobremesaRoutes.balanceBody(USER, 100), initialized: 'yes' } }
    await expect(chat().balance!()).resolves.toBeNull()
  })

  it('has nothing to read without a gateway, or without a signed-in person', async () => {
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, 3_760) }
    await expect(chat({ gateway: false }).balance!()).resolves.toBeNull()
    await expect(chat({ token: undefined }).balance!()).resolves.toBeNull()
    await expect(chat({ user: '' }).balance!()).resolves.toBeNull()
    expect(routes.asked.balance).toBe(0)
  })

  it('reads and nothing else: no write, no other route', async () => {
    routes.balance = { status: 200, body: SobremesaRoutes.balanceBody(USER, 3_760) }
    await chat().balance!()
    expect(sim.received.map(item => `${item.method} ${item.route}`)).toEqual(['GET /billing/balance'])
  })
})
