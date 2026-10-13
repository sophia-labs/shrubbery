import { afterEach, describe, expect, it, vi } from 'vitest'
import { GARDEN_DEFAULT, deriveAppTabs, planFor, validateConfig, type ShrubberyContract } from '@shrubbery/nucleus'
import { createShellContext } from '../shell-context.js'
import { acceptsGrapevineNavigation, createGrapevineFeature, grapevineEndpoint } from '../grapevine-feature.js'
import { MnGrapevinePane } from '../grapevine-pane.js'
import { withGrapevineWorkspace } from '../grapevine-workspace.js'

type Contract = Pick<ShrubberyContract, 'auth' | 'runtime'>
const targets = [
  { id: 'a', channel: 'demi', topic: 'Garden', label: 'Garden' },
  { id: 'b', channel: 'demi', topic: 'Trellis', label: 'Trellis' },
]
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }) }
function setup() {
  let user = 'subject-a'
  const listeners = new Set<() => void>()
  const contract: Contract = {
    auth: { token: () => user ? 'synthetic-token' : undefined, userId: () => user, isAuthenticated: () => Boolean(user), whenReady: async () => {}, onChange: callback => { listeners.add(callback); return () => listeners.delete(callback) } },
    runtime: { mode: () => 'hosted', isGateway: () => true, graphBaseUrl: graph => `https://gateway.test/o/user%3Aowner/g/${graph}` },
  }
  const host = document.createElement('div')
  document.body.append(host)
  const feature = createGrapevineFeature<Contract>()
  const render = (graphId = 'graph-a', app = 'grapevine') => {
    const pane = new MnGrapevinePane()
    host.replaceChildren(pane)
    feature.afterWorkspaceRender!(createShellContext({ host, graphId, documentId: null, app, source: 'CELL_LIVE', deploymentMode: 'hosted', contract, location: new URL('https://shell.test/'), rerender: vi.fn() }), {})
    return host.querySelector<MnGrapevinePane>('mn-grapevine-pane')!
  }
  return { contract, feature, host, render, changeUser: (next: string) => { user = next; for (const listener of listeners) listener() } }
}
function bootstrap() { return { graph: { owner: 'user:owner', graphId: 'graph-a' }, identity: { cognitoSub: 'subject-a', cognitoEmail: 'test@example.invalid', link: { zulipUserId: 17 } }, targets, agents: [] } }
function sendReceipt(replay = false) { return {
  schema: 'sophia.grapevine.send-receipt.v1', zulipMessageId: 99, replay,
  delivery: 'zulip-accepted', gardenPersistence: 'not-attested-by-this-receipt',
  recipientAcknowledgementRecorded: false, runtimeLaunched: false,
} }
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren() })
function mounted(fetcher: typeof fetch) {
  vi.stubGlobal('fetch', vi.fn(fetcher))
  const fixture = setup()
  cleanups.push(() => fixture.feature.destroy?.())
  return fixture
}

describe('Grapevine workspace composition', () => {
  it('uses a distinct app spine, preserves Garden and the serialized source, and is idempotent', () => {
    const original = JSON.stringify(GARDEN_DEFAULT)
    const view = withGrapevineWorkspace(GARDEN_DEFAULT)
    expect(deriveAppTabs(view)).toEqual(['garden', 'choreograph', 'grapevine'])
    expect(planFor(view, 'grapevine').spineHeadId).toBe('region-grapevine-center')
    expect(planFor(view, 'garden')).toEqual(planFor(GARDEN_DEFAULT, 'garden'))
    expect(validateConfig(view)).toEqual({ ok: true })
    expect(JSON.stringify(GARDEN_DEFAULT)).toBe(original)
    expect(withGrapevineWorkspace(GARDEN_DEFAULT)).toBe(view)
    expect(withGrapevineWorkspace(view)).toBe(view)
  })
  it('does not take over an authored app or fullscreen layout', () => {
    const authored = { ...GARDEN_DEFAULT, appRootRegions: { ...GARDEN_DEFAULT.appRootRegions, grapevine: ['custom'] } }
    expect(withGrapevineWorkspace(authored)).toBe(authored)
    const fullscreen = { ...GARDEN_DEFAULT, dimensions: {} }
    expect(withGrapevineWorkspace(fullscreen)).toBe(fullscreen)
  })
  it('requires an exact owner-qualified secure route', () => {
    const { contract } = setup()
    expect(grapevineEndpoint(contract, 'graph-a')).toBe('https://gateway.test/o/user%3Aowner/g/graph-a/grapevine/api/v1')
    for (const route of ['https://gateway.test/g/graph-a', 'https://gateway.test/o/user%3Aowner/g/wrong', 'https://gateway.test/o/user%3Aowner/g/graph-a?token=unsafe', 'http://remote.test/o/user%3Aowner/g/graph-a']) {
      contract.runtime.graphBaseUrl = () => route
      expect(() => grapevineEndpoint(contract, 'graph-a')).toThrow()
    }
  })
  it('accepts navigation only for the exact graph, owner route and current principal', () => {
    const { contract } = setup()
    const detail = { agentRef: 'urn:sophia:agent:garden', graphId: 'graph-a', graphBaseUrl: 'https://gateway.test/o/user%3Aowner/g/graph-a', principal: 'subject-a' }
    expect(acceptsGrapevineNavigation(contract, 'graph-a', detail)).toBe(true)
    for (const patch of [{ principal: 'someone-else' }, { graphId: 'graph-b' }, { graphBaseUrl: 'https://gateway.test/o/user%3Aother/g/graph-a' }, { agentRef: 'Garden' }]) expect(acceptsGrapevineNavigation(contract, 'graph-a', { ...detail, ...patch })).toBe(false)
  })
})

describe('Grapevine host and real pane', () => {
  it('settles stalled auth at the deadline and never fetches when auth resolves late', async () => {
    vi.useFakeTimers()
    let ready!: () => void
    const authReady = new Promise<void>(resolve => { ready = resolve })
    const fixture = mounted(async () => json(bootstrap()))
    fixture.contract.auth.whenReady = () => authReady
    const pane = fixture.render()
    expect(pane.snapshot.busy).toBe(true)
    await vi.advanceTimersByTimeAsync(15001)
    expect(pane.snapshot.status).toBe('error')
    expect(pane.snapshot.busy).toBe(false)
    expect(pane.snapshot.error).toContain('timed out')
    ready()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('never starts a fetch when auth resolves after disposal', async () => {
    let ready!: () => void
    const authReady = new Promise<void>(resolve => { ready = resolve })
    const fixture = mounted(async () => json(bootstrap()))
    fixture.contract.auth.whenReady = () => authReady
    fixture.render()
    fixture.feature.destroy?.()
    ready()
    await Promise.resolve(); await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('uses one deadline across auth, headers and an uncancellable body', async () => {
    vi.useFakeTimers()
    let ready!: () => void
    let bodyDone!: (value: unknown) => void
    const authReady = new Promise<void>(resolve => { ready = resolve })
    const fixture = mounted(async () => ({ ok: true, status: 200, json: () => new Promise(resolve => { bodyDone = resolve }) }) as Response)
    fixture.contract.auth.whenReady = () => authReady
    const pane = fixture.render()
    await vi.advanceTimersByTimeAsync(14000)
    expect(fetch).not.toHaveBeenCalled()
    ready(); await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(bodyDone).toBeTypeOf('function')
    await vi.advanceTimersByTimeAsync(1000)
    expect(pane.snapshot.busy).toBe(false)
    expect(pane.snapshot.status).toBe('error')
    bodyDone(bootstrap()); await vi.advanceTimersByTimeAsync(1)
    expect(pane.snapshot.status).toBe('error')
    expect(pane.snapshot.targets).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('retains a pending send draft when authentication stalls, without a late POST', async () => {
    const fixture = mounted(async input => String(input).endsWith('/me') ? json(bootstrap()) : json({ messages: [] }))
    const pane = fixture.render()
    await vi.waitFor(() => expect(pane.snapshot.status === 'ready' && !pane.snapshot.busy).toBe(true))
    vi.useFakeTimers()
    let ready!: () => void
    const authReady = new Promise<void>(resolve => { ready = resolve })
    fixture.contract.auth.whenReady = () => authReady
    pane.onDraft!('exact draft before authentication'); pane.onSend!()
    await vi.advanceTimersByTimeAsync(15001)
    expect(pane.snapshot.uncertain).toBe(true)
    expect(pane.snapshot.busy).toBe(false)
    expect(pane.snapshot.draft).toBe('exact draft before authentication')
    expect(pane.snapshot.targetId).toBe('a')
    expect(pane.snapshot.delivery).toMatch(/Client nonce: [a-zA-Z0-9_]+/)
    ready(); await vi.advanceTimersByTimeAsync(1)
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })
  it('keeps the deadline through a headers-success, stalled response body', async () => {
    vi.useFakeTimers()
    let bodyStarted = false
    const fixture = mounted(async (_input, init) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        bodyStarted = true
        init?.signal?.addEventListener('abort', () => reject(Error('body aborted')), { once: true })
      }),
    }) as Response)
    const pane = fixture.render()
    await vi.waitFor(() => expect(bodyStarted).toBe(true))
    await vi.advanceTimersByTimeAsync(15001)
    expect(pane.snapshot.busy).toBe(false)
    expect(pane.snapshot.status).toBe('error')
    expect(pane.snapshot.error).toContain('timed out')
  })
  it('reads with shared auth, preserves target drafts and node replacement, and never writes on viewing', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fixture = mounted(async (input, init) => { calls.push({ url: String(input), init }); return String(input).endsWith('/me') ? json(bootstrap()) : json({ messages: [] }) })
    const pane = fixture.render()
    await vi.waitFor(() => expect(pane.snapshot.busy).toBe(false))
    expect(pane.snapshot.status).toBe('ready')
    pane.onDraft!('Garden draft')
    pane.onTarget!('b')
    await vi.waitFor(() => expect(pane.snapshot.busy).toBe(false))
    pane.onDraft!('Trellis draft')
    pane.onTarget!('a')
    await vi.waitFor(() => expect(pane.snapshot.busy).toBe(false))
    expect(pane.snapshot.draft).toBe('Garden draft')
    fixture.render('graph-a', 'garden')
    expect(fixture.render()).toBe(pane)
    expect(pane.snapshot.draft).toBe('Garden draft')
    expect(calls.every(call => call.init?.method === 'GET')).toBe(true)
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe('Bearer synthetic-token')
    expect(new Headers(calls[0].init?.headers).get('x-user-id')).toBeNull()
    await pane.updateComplete
    expect(pane.shadowRoot?.textContent).toContain('Garden retention is not confirmed')
    expect(pane.shadowRoot?.querySelector('hoja-editor')).not.toBeNull()
  })
  it('does not place a delayed A read under B when selection changes during loading', async () => {
    let resolveA!: (response: Response) => void
    const pendingA = new Promise<Response>(resolve => { resolveA = resolve })
    const fixture = mounted(async input => {
      if (String(input).endsWith('/me')) return json(bootstrap())
      if (String(input).endsWith('targetId=a')) return pendingA
      return json({ messages: [{ id: 22, content: 'B message' }] })
    })
    const pane = fixture.render()
    await vi.waitFor(() => expect(pane.snapshot.targets).toHaveLength(2))
    pane.onTarget!('b')
    await vi.waitFor(() => expect(pane.snapshot.messages[0]?.id).toBe(22))
    resolveA(json({ messages: [{ id: 11, content: 'A message' }] }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(pane.snapshot.targetId).toBe('b')
    expect(pane.snapshot.messages.map(message => message.id)).toEqual([22])
  })
  it.each([403, 404, 503])('shows HTTP %i as an error, never successful emptiness', async status => {
    const fixture = mounted(async () => json({}, status))
    const pane = fixture.render()
    await vi.waitFor(() => expect(pane.snapshot.status).toBe('error'))
    expect(pane.snapshot.error).not.toBe('')
    await pane.updateComplete
    expect(pane.shadowRoot?.querySelector('[role="alert"]')).not.toBeNull()
    expect(pane.shadowRoot?.textContent).not.toContain('No messages returned')
  })
  it('refuses malformed successful data', async () => {
    const fixture = mounted(async () => json({ identity: {}, targets: [] }))
    const pane = fixture.render()
    await vi.waitFor(() => expect(pane.snapshot.status).toBe('error'))
    expect(pane.snapshot.error).toContain('invalid identity')
  })
  it('refuses a well-formed response from a different graph', async () => {
    const data = bootstrap(); data.graph.graphId = 'graph-b'
    const fixture = mounted(async () => json(data))
    const pane = fixture.render()
    await vi.waitFor(() => expect(pane.snapshot.status).toBe('error'))
    expect(pane.snapshot.error).toContain('different workspace')
  })
  it.each([0, 1, 2])('Agent navigation uses only explicit returned associations (matches=%i)', async count => {
    const agentRef = 'urn:sophia:agent:garden'
    const data = bootstrap()
    data.targets = targets.map((target, index) => ({ ...target, ...(index < count ? { agentRef } : {}) }))
    const fixture = mounted(async input => String(input).endsWith('/me') ? json(data) : json({ messages: [] }))
    const pane = fixture.render()
    pane.onAgentRequest!(agentRef)
    await vi.waitFor(() => expect(pane.snapshot.status === 'ready' && !pane.snapshot.busy).toBe(true))
    if (count === 1) expect(pane.snapshot.targetId).toBe('a')
    else expect(pane.snapshot.error).toContain(count === 0 ? 'No conversation' : 'Several conversations')
  })
  it('refuses A1 after newer A2 through A → B → A', async () => {
    let resolveA!: (response: Response) => void
    let aReads = 0
    const fixture = mounted(async input => {
      if (String(input).endsWith('/me')) return json(bootstrap())
      if (String(input).endsWith('targetId=a') && ++aReads === 1) return new Promise(resolve => { resolveA = resolve })
      return json({ messages: [{ id: 22, content: 'newer' }] })
    })
    const pane = fixture.render()
    await vi.waitFor(() => expect(pane.snapshot.targets).toHaveLength(2))
    pane.onTarget!('b'); pane.onTarget!('a')
    await vi.waitFor(() => expect(pane.snapshot.messages[0]?.id).toBe(22))
    resolveA(json({ messages: [{ id: 11, content: 'older' }] }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(pane.snapshot.messages[0]?.id).toBe(22)
  })
  it.each([true, false])('freezes target and draft during a pending send (success=%s)', async success => {
    let finish!: (response: Response) => void
    let fail!: (error: Error) => void
    const fixture = mounted(async (input, init) => {
      if (init?.method === 'POST') return new Promise((resolve, reject) => { finish = resolve; fail = reject })
      return String(input).endsWith('/me') ? json(bootstrap()) : json({ messages: [] })
    })
    const pane = fixture.render()
    await vi.waitFor(() => expect(pane.snapshot.status === 'ready' && !pane.snapshot.busy).toBe(true))
    pane.onDraft!('A draft'); pane.onSend!()
    await vi.waitFor(() => expect(pane.snapshot.mutating).toBe(true))
    pane.onTarget!('b'); pane.onDraft!('B draft')
    expect(pane.snapshot.targetId).toBe('a'); expect(pane.snapshot.draft).toBe('A draft')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    if (success) finish(json(sendReceipt(), 201)); else fail(Error('response lost'))
    await vi.waitFor(() => expect(pane.snapshot.busy).toBe(false))
    expect(pane.snapshot.targetId).toBe('a')
    expect(pane.snapshot.draft).toBe(success ? '' : 'A draft')
    expect(pane.snapshot.uncertain).toBe(!success)
  })
  it('clears identity immediately and ignores delayed reads after sign-out', async () => {
    let finish!: (response: Response) => void
    const fixture = mounted(async input => String(input).endsWith('/me') ? json(bootstrap()) : new Promise(resolve => { finish = resolve }))
    const pane = fixture.render()
    await vi.waitFor(() => expect(pane.snapshot.linked).toBe(true))
    pane.onDraft!('private draft')
    fixture.changeUser('')
    finish(json({ messages: [{ id: 11, content: 'private body' }] }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(pane.snapshot.draft).toBe('')
    expect(pane.snapshot.messages).toEqual([])
    expect(pane.snapshot.status).toBe('unavailable')
  })
  it('retains the exact draft and nonce on uncertain send and never automatically retries', async () => {
    let sends = 0
    let body: Record<string, string> = {}
    const fixture = mounted(async (input, init) => {
      if (init?.method === 'POST') { sends++; body = JSON.parse(String(init.body)); throw Error('response lost') }
      return String(input).endsWith('/me') ? json(bootstrap()) : json({ messages: [] })
    })
    const pane = fixture.render()
    await vi.waitFor(() => expect(pane.snapshot.status === 'ready' && !pane.snapshot.busy).toBe(true))
    pane.onDraft!('The exact message')
    pane.onSend!()
    await vi.waitFor(() => expect(pane.snapshot.uncertain).toBe(true))
    expect(pane.snapshot.draft).toBe('The exact message')
    expect(body.content).toBe('The exact message')
    expect(pane.snapshot.delivery).toContain(body.clientNonce)
    pane.onSend!()
    pane.onRefresh!()
    await vi.waitFor(() => expect(pane.snapshot.busy).toBe(false))
    expect(sends).toBe(1)
    expect(pane.snapshot.draft).toBe('The exact message')
  })
  it.each([
    ['empty', {}, 200], ['old permissive fixture', { id: 99 }, 200],
    ['wrong schema', { ...sendReceipt(true), schema: 'other' }, 200],
    ['missing ID', { ...sendReceipt(true), zulipMessageId: null }, 200],
    ['zero ID', { ...sendReceipt(true), zulipMessageId: 0 }, 200],
    ['fractional ID', { ...sendReceipt(true), zulipMessageId: 2.5 }, 200],
    ['unsafe ID', { ...sendReceipt(true), zulipMessageId: Number.MAX_SAFE_INTEGER + 1 }, 200],
    ['string ID', { ...sendReceipt(true), zulipMessageId: '99' }, 200],
    ['nonboolean replay', { ...sendReceipt(true), replay: 'true' }, 200],
    ['wrong delivery', { ...sendReceipt(true), delivery: 'pending' }, 200],
    ['false Garden testimony', { ...sendReceipt(true), gardenPersistence: 'persisted' }, 200],
    ['false recipient ACK', { ...sendReceipt(true), recipientAcknowledgementRecorded: true }, 200],
    ['false runtime launch', { ...sendReceipt(true), runtimeLaunched: true }, 200],
    ['contradictory status', sendReceipt(false), 200],
    ['contradictory error', { ...sendReceipt(true), error: 'not sent' }, 200],
  ])('retains exact draft/target/nonce after an unconfirmed success receipt: %s', async (_name, receipt, status) => {
    let nonce = ''
    let sends = 0
    const fixture = mounted(async (input, init) => {
      if (init?.method === 'POST') { sends++; nonce = JSON.parse(String(init.body)).clientNonce; return json(receipt, status as number) }
      return String(input).endsWith('/me') ? json(bootstrap()) : json({ messages: [] })
    })
    const pane = fixture.render()
    await vi.waitFor(() => expect(pane.snapshot.status === 'ready' && !pane.snapshot.busy).toBe(true))
    pane.onDraft!('  exact draft\n'); pane.onSend!()
    await vi.waitFor(() => expect(pane.snapshot.busy).toBe(false))
    expect(pane.snapshot.uncertain).toBe(true)
    expect(pane.snapshot.draft).toBe('  exact draft\n')
    expect(pane.snapshot.targetId).toBe('a')
    expect(pane.snapshot.delivery).toContain(nonce)
    expect(pane.snapshot.delivery).not.toContain('Zulip accepted')
    pane.onSend!()
    expect(sends).toBe(1)
  })
  it.each([false, true])('accepts the actual Vinea send receipt only (replay=%s)', async replay => {
    const fixture = mounted(async (input, init) => init?.method === 'POST'
      ? json(sendReceipt(replay), replay ? 200 : 201)
      : String(input).endsWith('/me') ? json(bootstrap()) : json({ messages: [] }))
    const pane = fixture.render()
    await vi.waitFor(() => expect(pane.snapshot.status === 'ready' && !pane.snapshot.busy).toBe(true))
    pane.onDraft!('confirmed draft'); pane.onSend!()
    await vi.waitFor(() => expect(pane.snapshot.busy).toBe(false))
    expect(pane.snapshot.draft).toBe('')
    expect(pane.snapshot.uncertain).toBe(false)
    expect(pane.snapshot.delivery).toContain('99')
    expect(pane.snapshot.delivery).toContain('not a recipient receipt')
  })
})
