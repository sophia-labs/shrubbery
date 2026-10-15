/**
 * The self-host's chat, from the shell's side (survey 2026-10-13, slice S1): chat shows only when the
 * page's own gardend says it runs a Choreograph, reaches it through gardend's proxy on this origin with
 * the key, and speaks as the user gardend asserts.
 *
 * NO MOCKS: a gardend-shaped HTTP server (the runtime's `gardend-proxy.ts`, which speaks garden
 * `loopback_service_routes.rs`) in front of the scripted Choreograph's own `/api/…` face. The page is put
 * on gardend's origin, as a self-host's page is, so happy-dom sends the bearer as a browser would.
 */
import { assembleChatServices } from '@shrubbery/runtime'
import type { EditorScope, ShrubberyContract } from '@shrubbery/nucleus'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ChoreographSim,
  plainTurn,
} from '../../../../../packages/runtime/src/chat-services/__tests__/fixtures/choreograph-sim.js'
import { GardendProxy } from '../../../../../packages/runtime/src/chat-services/__tests__/fixtures/gardend-proxy.js'
import {
  SELF_HOST_CHOREOGRAPH_STATUS_PATH,
  parseSelfHostChoreographStatus,
  readSelfHostChat,
  selfHostChatActor,
  selfHostChatEndpoint,
  selfHostChatEndpointOption,
  selfHostRideEndpoint,
  type SelfHostSession,
} from '../self-host.js'

interface HappyDomControl {
  readonly happyDOM?: { setURL(url: string): void }
  readonly location: { href: string }
}
const page = (): HappyDomControl => globalThis.window as unknown as HappyDomControl

function session(
  origin: string,
  options: { token?: string; email?: string; services?: SelfHostSession['descriptor']['services'] } = {},
): SelfHostSession {
  const auth = options.token ? 'key' : 'cloudflare-access'
  return {
    descriptor: { kind: 'gardend-self-host', version: '0.1.3', auth, user: options.email ? { email: options.email } : null, services: options.services ?? {} },
    origin,
    auth,
    token: options.token,
    userId: options.email ?? 'garden-self-host',
    email: options.email ?? null,
    signOut: () => {},
  }
}

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

describe('whether a self-host has chat: what its gardend says', () => {
  let sim: ChoreographSim
  let proxy: GardendProxy
  let original = ''
  beforeEach(async () => {
    sim = new ChoreographSim()
    await sim.start()
    proxy = new GardendProxy(sim)
    await proxy.start()
    original = page().location.href
    page().happyDOM?.setURL(`${proxy.base}/`)
  })
  afterEach(async () => {
    page().happyDOM?.setURL(original)
    await proxy.stop()
    await sim.stop()
  })

  it('has chat when Choreograph is configured: gardend\'s proxy on this origin, the key, gardend\'s user', async () => {
    const chat = await readSelfHostChat(session(proxy.base, { token: proxy.key }))

    expect(chat).toEqual({
      baseUrl: `${proxy.base}/services/choreograph/api`,
      token: proxy.key,
      userId: 'default',
      graphOwner: 'user:default',
      state: 'running',
    })
    expect(proxy.received.map(item => [item.path, item.authorization])).toEqual([
      [SELF_HOST_CHOREOGRAPH_STATUS_PATH, `Bearer ${proxy.key}`],
    ])
  })

  it('has chat when configured but stopped, and says so', async () => {
    proxy.state = 'stopped'
    expect((await readSelfHostChat(session(proxy.base, { token: proxy.key })))?.state).toBe('stopped')
  })

  it('has no chat when gardend has no Choreograph configured (0.1.3 as shipped)', async () => {
    proxy.state = 'unconfigured'
    expect(await readSelfHostChat(session(proxy.base, { token: proxy.key }))).toBeNull()
  })

  it('has no chat when the status cannot be read: an older gardend, a refused key', async () => {
    expect(await readSelfHostChat(session(proxy.base, { token: 'revoked' }))).toBeNull()
    proxy.statusRoute = false
    expect(await readSelfHostChat(session(proxy.base, { token: proxy.key }))).toBeNull()
  })

  it('gives a member chat too: Vera 10-13, family may chat (the proxy scope is gardend\'s to grant)', async () => {
    const chat = await readSelfHostChat(session(proxy.base, { token: proxy.memberKey }))
    expect(chat?.baseUrl).toBe(`${proxy.base}/services/choreograph/api`)
    expect(chat?.token).toBe(proxy.memberKey)
  })

  it('under Cloudflare Access sends no bearer, and the chat carries none', async () => {
    proxy.behindAccess = true
    const chat = await readSelfHostChat(session(proxy.base, { email: 'lucy@example.com' }))

    expect(chat?.token).toBeUndefined()
    expect(chat?.userId).toBe('default')
    expect(proxy.received[0].authorization).toBeUndefined()
  })

  it('carries a message to Choreograph and back, assembled as the shell assembles it', async () => {
    sim.queueTurn(plainTurn('Hello from your own Sophia.'))
    const chat = await readSelfHostChat(session(proxy.base, { token: proxy.key }))
    expect(chat).not.toBeNull()
    const scope: EditorScope = { centerMode: 'home', graphId: null, documentId: null }
    const contract = {
      auth: { token: () => proxy.key, userId: () => 'garden-self-host' },
      runtime: { graphBaseUrl: (graphId: string) => `${proxy.base}/cell/${graphId}` },
    } as ShrubberyContract
    const service = assembleChatServices(contract, () => scope, 'hosted', {
      graphId: () => 'kitchen-notes',
      endpoint: selfHostChatEndpointOption(chat!),
      hosted: {
        storage: new MemoryStorage(),
        viaLocalService: true,
        resolveAttempts: 3,
        resolveDelayMs: 0,
        sleep: async () => undefined,
      },
    })
    const created = await service.createSession()
    const handle = await service.startTurn(created.id, 'Hello?')
    const words: string[] = []
    for await (const event of handle.events) if (event.type === 'text') words.push(event.content)

    expect(await handle.done).toEqual({ state: 'completed' })
    expect(words.join('')).toBe('Hello from your own Sophia.')
    expect(sim.invocations()[0].body.actorRef).toBe('user:default')
    expect(sim.invocations()[0].body.graph).toEqual({ graphId: 'kitchen-notes', ownerPrincipal: 'user:default' })
    expect(proxy.received.filter(item => item.status === 501)).toHaveLength(1)
  })
})

describe('the chat endpoint gardend\'s status describes', () => {
  const configured = { state: 'running', configured: true, proxyMount: '/services/choreograph' }

  it('reads the status gardend serves, and nothing that is not one', () => {
    expect(parseSelfHostChoreographStatus({
      serviceId: 'choreograph', state: 'unconfigured', proxyMount: '/services/choreograph', profileId: 'default', configured: false,
    })).toEqual({ state: 'unconfigured', configured: false, proxyMount: '/services/choreograph' })
    expect(parseSelfHostChoreographStatus({ state: 'running', configured: true })?.proxyMount).toBe('/services/choreograph')
    expect(parseSelfHostChoreographStatus({ state: 'running' })).toBeNull()
    expect(parseSelfHostChoreographStatus('<!doctype html>')).toBeNull()
    expect(parseSelfHostChoreographStatus([])).toBeNull()
  })

  it('is this page\'s origin plus the mount, wherever the page is: 127.0.0.1, localhost into WSL2, behind Access', () => {
    expect(selfHostChatEndpoint(session('http://127.0.0.1:7674', { token: 'k' }), configured)?.baseUrl)
      .toBe('http://127.0.0.1:7674/services/choreograph/api')
    expect(selfHostChatEndpoint(session('http://localhost:7674', { token: 'k' }), configured)?.baseUrl)
      .toBe('http://localhost:7674/services/choreograph/api')
    expect(selfHostChatEndpoint(session('https://sophia.example.com'), { ...configured, proxyMount: '/services/choreograph/' })?.baseUrl)
      .toBe('https://sophia.example.com/services/choreograph/api')
  })

  it('never leaves the page\'s origin, and is nothing while unconfigured', () => {
    const at = session('http://127.0.0.1:7674', { token: 'k' })
    expect(selfHostChatEndpoint(at, { ...configured, configured: false })).toBeNull()
    expect(selfHostChatEndpoint(at, { ...configured, proxyMount: '//evil.example.com/x' })).toBeNull()
    expect(selfHostChatEndpoint(at, { ...configured, proxyMount: 'https://evil.example.com/x' })).toBeNull()
  })

  it('speaks as gardend\'s user whoever signed in (one place to change when gardend asserts the person)', () => {
    expect(selfHostChatActor(session('https://sophia.example.com', { email: 'lucy@example.com' }))).toBe('default')
    expect(selfHostChatActor(session('http://127.0.0.1:7674', { token: 'k' }))).toBe('default')
  })
})

describe('the agent core\'s chat: gardend\'s vehicle service', () => {
  it('is chosen when /self-host.json lists vehicle as configured: this origin plus the mount, the key', () => {
    const ride = selfHostRideEndpoint(session('http://127.0.0.1:7674', {
      token: 'k-1',
      services: { choreograph: { configured: true, state: 'running' }, vehicle: { configured: true, state: 'running' } },
    }))
    expect(ride).toEqual({ baseUrl: 'http://127.0.0.1:7674/services/vehicle', token: 'k-1', state: 'running' })
    expect(selfHostRideEndpoint(session('https://sophia.example.com', {
      services: { vehicle: { configured: true, state: 'starting' } },
    }))).toEqual({ baseUrl: 'https://sophia.example.com/services/vehicle', token: undefined, state: 'starting' })
  })

  it('carries gardend\'s reason when chat cannot start on this computer (no Node.js)', () => {
    const reason = "Chat needs Node.js 22.19 or newer, and there is no node on gardend's PATH. Install Node.js 22.19 or newer, then restart gardend."
    expect(selfHostRideEndpoint(session('http://127.0.0.1:7674', {
      token: 'k-1',
      services: { vehicle: { configured: true, state: 'unavailable', reason } },
    }))).toEqual({ baseUrl: 'http://127.0.0.1:7674/services/vehicle', token: 'k-1', state: 'unavailable', reason })
  })

  it('is not chosen otherwise: the Choreograph chat (S1) or none', () => {
    expect(selfHostRideEndpoint(session('http://127.0.0.1:7674', { token: 'k-1' }))).toBeNull()
    expect(selfHostRideEndpoint(session('http://127.0.0.1:7674', {
      token: 'k-1',
      services: { vehicle: { configured: false, state: 'unconfigured' }, choreograph: { configured: true, state: 'running' } },
    }))).toBeNull()
  })
})
