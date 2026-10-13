import { afterEach, describe, expect, it, vi } from 'vitest'
import '@shrubbery/components'
import type { AuthProvider } from '@shrubbery/nucleus/contract'
import { GatewayTransport, type GatewayGraphInfo } from '../gateway-transport.js'
import { STARTER_PAGES } from '../new-user-starter-content.js'
import type { StarterWorkspace } from '../new-user-starter-contract.js'
import type { NewUserStarterInput } from '../new-user-starter.js'
import { makeStarterStartupNotice } from '../new-user-starter-notice.js'
import {
  STARTER_GENERATION_HEADER, confirmedStarterPreference, createCapturedStarterMcp,
  isNativeStarterSession, readCapturedHostedDirectory, startHostedStarter, type StarterStartupNotice,
} from '../new-user-starter-startup.js'

const subject = 'synthetic-native-subject'
const cognito = { region: 'us-west-1', userPoolId: 'us-west-1_synthetic', clientId: 'synthetic-client' }
const target = { owner: `user:${subject}`, graphId: 'starter-exact', generation: 4 }
const base = 'https://gateway.test'
function jwt(overrides: Record<string, unknown> = {}, suffix = 'a'): string {
  return `synthetic.${btoa(JSON.stringify({ sub: subject, iss: `https://cognito-idp.${cognito.region}.amazonaws.com/${cognito.userPoolId}`,
    aud: cognito.clientId, token_use: 'id', ...overrides }))}.${suffix}`
}
class Session implements AuthProvider {
  value = jwt()
  sub = subject
  listeners = new Set<() => void>()
  token() { return this.value || undefined }
  userId() { return this.sub }
  isAuthenticated() { return Boolean(this.value) }
  async whenReady() {}
  onChange(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  change(kind: 'sign-out' | 'token-switch' | 'subject-switch') {
    this.value = kind === 'sign-out' ? '' : jwt(kind === 'subject-switch' ? { sub: 'other' } : {}, 'b')
    if (kind === 'subject-switch') this.sub = 'other'
    for (const listener of this.listeners) listener()
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>(settle => { resolve = settle }), resolve: (value: T) => resolve(value) }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const snapshot = (status = 'registered', completed = false) => ({
  schema: 'sophia.account-starter.v1', subject, status, workspace: target,
  seed: { edition: '2026-09-06', manifestSha256: 'b6b781c0b096e89bc7962939fa3a569796d83322e18e6eadb56e4706efef9c3f',
    state: completed ? 'client-observed-complete' : 'pending', pages: STARTER_PAGES.map(page => ({
      documentId: page.documentId, state: completed ? 'observed-present' : 'unattempted', ...(completed ? { attemptId: `attempt-${page.documentId}` } : {}),
    })) },
})
const complete = () => ({ status: 'client-observed-complete' as const, workspace: target, observedDocumentIds: STARTER_PAGES.map(page => page.documentId), contentObservedThisRun: true, durabilityConfirmed: false as const })

/** An independent HTTP producer, not the module's direct-callback fixture. */
function httpFixture(holdPhase?: 'grant' | 'read' | 'write') {
  const requests: { url: string; init: RequestInit; tool?: string }[] = []
  const docs = new Map<string, { title: string; tiptapJson: unknown }>()
  const journal = new Map(STARTER_PAGES.map(page => [page.documentId, { state: 'unattempted', attemptId: undefined as string | undefined }]))
  const reached = deferred<void>()
  const release = deferred<void>()
  let held = false
  const state = () => {
    const value = snapshot()
    return { ...value, seed: { ...value.seed,
      state: [...journal.values()].every(page => page.state === 'observed-present') ? 'client-observed-complete' : 'pending',
      pages: [...journal].map(([documentId, page]) => ({ documentId, ...page })) } }
  }
  const fetcher: typeof fetch = vi.fn(async (input, init = {}) => {
    const url = new URL(String(input))
    const body = JSON.parse(String(init.body ?? '{}'))
    const tool = body.params?.name as string | undefined
    requests.push({ url: url.href, init, tool })
    let response: Response | undefined
    let phase: string | undefined
    if (url.pathname === '/me/starter-workspace') response = json(state(), 201)
    else if (url.pathname.startsWith('/me/starter-workspace/pages/')) {
      const id = url.pathname.split('/').at(-2)!
      const row = journal.get(id)!
      if (url.pathname.endsWith('/claim')) {
        phase = 'grant'
        expect(body).toEqual({})
        expect(row.state).toBe('unattempted')
        row.state = 'attempted'; row.attemptId = `attempt-${id}`
        response = json({ ...state(), documentId: id, attemptId: row.attemptId, freshGrant: true }, 201)
      } else {
        expect(body.observation).toBe('template-present')
        expect(body.attemptId).toBe(row.attemptId)
        row.state = 'observed-present'
        response = json({ ...state(), documentId: id, attemptId: row.attemptId })
      }
    } else {
      expect(url.pathname).toBe(`/o/${encodeURIComponent(target.owner)}/g/${target.graphId}/mcp`)
      const headers = new Headers(init.headers)
      expect(headers.get(STARTER_GENERATION_HEADER)).toBe('4')
      const args = body.params.arguments
      const id = args.documentId ?? args.document_id
      let result: unknown
      if (tool === 'list_documents') result = { documents: [], count: 0, page: { complete: true, returned: 0, nextCursor: null } }
      else if (tool === 'read_document') {
        phase = 'read'
        const doc = docs.get(id)
        if (!doc) response = json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: `document not found: ${id}` } })
        else result = { graphId: target.graphId, documentId: id, title: doc.title, revision: 1,
          format: 'json', complete: true, fragment: false, offset: 0, nextOffset: null,
          content: JSON.stringify({ tiptapJson: doc.tiptapJson }) }
      } else {
        phase = 'write'
        expect(tool).toBe('create_document_once')
        expect(args.graph_id).toBe(target.graphId)
        expect(args.graphId).toBeUndefined()
        expect(docs.has(id)).toBe(false)
        expect(journal.get(id)?.state).toBe('attempted')
        docs.set(id, { title: args.title, tiptapJson: args.tiptapJson })
        result = { success: true, outcome: 'created', graph_id: target.graphId, document_id: id, revision: 1 }
      }
      response ??= json({ jsonrpc: '2.0', id: body.id, result: { structuredContent: result } })
    }
    if (holdPhase && !held && phase === holdPhase) { held = true; reached.resolve(); await release.promise }
    return response!
  })
  return { fetcher, requests, docs, reached, release }
}

const cleanups: (() => void)[] = []
function start(options: Partial<Parameters<typeof startHostedStarter>[0]> = {}) {
  const auth = new Session()
  const notices: (StarterStartupNotice | null)[] = []
  const startup = startHostedStarter({ mode: 'hosted', auth, cognito, gatewayBaseUrl: base,
    location: () => new URL('https://app.test/'), onNotice: notice => notices.push(notice), ...options })
  cleanups.push(() => startup.cancel())
  return { auth, notices, startup }
}
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.useRealTimers(); document.body.replaceChildren() })

describe('captured hosted starter startup', () => {
  it('shows a bounded informational unavailable notice only for the absent initial starter endpoint', async () => {
    const fetcher = vi.fn(async () => new Response('Not found', { status: 404 }))
    const { startup, notices } = start({ fetch: fetcher as typeof fetch })
    expect(await startup.done).toMatchObject({ status: 'unavailable', httpStatus: 404 })
    expect(await startup.initial).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(notices.at(-1)).toMatchObject({ kind: 'unavailable', message: 'Automatic starter setup is unavailable' })
    const presenter = makeStarterStartupNotice(document, vi.fn())
    presenter.show(notices.at(-1)!)
    const toast = document.querySelector('mn-toast') as HTMLElement & { type: string; duration: number }
    expect(toast.type).toBe('info')
    expect(toast.duration).toBe(8000)
    presenter.destroy()
  })

  it.each([401, 403, 409, 429, 500, 503])('keeps initial HTTP %s visible as attention, not capability absence', async status => {
    const fetcher = vi.fn(async () => json({}, status))
    const { startup, notices } = start({ fetch: fetcher as typeof fetch })
    await startup.done
    expect(notices.at(-1)).toMatchObject({ kind: 'attention' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps failed transport visible as attention', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('synthetic network failure') })
    const { startup, notices } = start({ fetch: fetcher as typeof fetch })
    await startup.done
    expect(notices.at(-1)).toMatchObject({ kind: 'attention' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each(['claim', 'mcp'])('keeps HTTP 404 after registration at %s visible as attention', async phase => {
    const fixture = httpFixture()
    const missing = vi.fn()
    const fetcher: typeof fetch = async (input, init) => {
      if (new URL(String(input)).pathname.endsWith(`/${phase}`)) {
        missing()
        return new Response('Not found', { status: 404 })
      }
      return fixture.fetcher(input, init)
    }
    const { startup, notices } = start({ fetch: fetcher })
    expect(await startup.done).toMatchObject({ status: 'attention', workspace: target })
    expect(missing).toHaveBeenCalled()
    expect(notices.at(-1)).toMatchObject({ kind: 'attention' })
    expect(fixture.docs.size).toBe(0)
  })

  it('drives the actual module over captured HTTP through one canonical generation and nine create-once calls', async () => {
    const fixture = httpFixture()
    const { auth, startup } = start({ fetch: fixture.fetcher })
    expect(await startup.done).toMatchObject(complete())
    expect((await startup.initial)?.workspace).toEqual(target)
    expect(fixture.docs.size).toBe(9)
    expect(fixture.requests.filter(request => request.tool === 'create_document_once')).toHaveLength(9)
    expect(fixture.requests.some(request => request.tool === 'write_document')).toBe(false)
    for (const request of fixture.requests) {
      expect(new Headers(request.init.headers).get('Authorization')).toBe(`Bearer ${auth.token()}`)
      expect(request.init.credentials).toBe('omit')
      expect(request.init.redirect).toBe('error')
      expect(request.init.signal).toBeDefined()
    }
  })

  it.each(['grant', 'read', 'write'] as const)('stops after sign-out during pending %s, without claiming already-dispatched work was undone', async phase => {
    const fixture = httpFixture(phase)
    const { auth, startup } = start({ fetch: fixture.fetcher })
    await fixture.reached.promise
    const count = fixture.requests.length
    auth.change('sign-out')
    expect(await startup.done).toEqual({ status: 'stale' })
    expect(await startup.initial).toBeNull()
    fixture.release.resolve()
    await Promise.resolve(); await Promise.resolve()
    expect(fixture.requests).toHaveLength(count)
    expect(fixture.requests.at(-1)!.init.signal!.aborted).toBe(true)
    expect(fixture.docs.size).toBe(phase === 'write' ? 1 : 0)
  })

  it.each(['grant', 'read', 'write'] as const)('stops after same-subject token replacement during pending %s', async phase => {
    const fixture = httpFixture(phase)
    const { auth, startup } = start({ fetch: fixture.fetcher })
    const captured = auth.token()
    await fixture.reached.promise
    const count = fixture.requests.length
    auth.change('token-switch')
    expect(await startup.done).toEqual({ status: 'stale' })
    fixture.release.resolve()
    await Promise.resolve(); await Promise.resolve()
    expect(fixture.requests).toHaveLength(count)
    for (const request of fixture.requests) expect(new Headers(request.init.headers).get('Authorization')).toBe(`Bearer ${captured}`)
  })

  it.each(['/home', '/settings', '/g/existing?doc=kept#block', '/?graph=existing', '/?returnTo=%2Fhome', '/#document'])(
    'does not await preparation or choose a starter over explicit %s', async path => {
      const held = deferred<ReturnType<typeof complete>>()
      const { startup } = start({ location: () => new URL(path, 'https://app.test'), runStarter: async () => held.promise })
      expect(await startup.initial).toBeNull()
      held.resolve(complete())
      await startup.done
    },
  )

  it('limits the root opportunity to two seconds and cannot retarget on a late result', async () => {
    vi.useFakeTimers()
    const held = deferred<ReturnType<typeof complete>>()
    const { startup } = start({ initialWaitMs: 9000, runStarter: async () => held.promise })
    const settled = vi.fn()
    void startup.initial.then(settled)
    await vi.advanceTimersByTimeAsync(1999)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await startup.initial).toBeNull()
    held.resolve(complete())
    await startup.done
    expect(settled).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('keeps a changed route and invalidates a preference after token replacement', async () => {
    let location = new URL('https://app.test/')
    const held = deferred<ReturnType<typeof complete>>()
    const first = start({ location: () => location, runStarter: async () => held.promise })
    location = new URL('https://app.test/g/chosen')
    held.resolve(complete())
    expect(await first.startup.initial).toBeNull()
    const second = start({ runStarter: async () => complete() })
    const preference = await second.startup.initial
    expect(preference?.isCurrent()).toBe(true)
    second.auth.change('token-switch')
    expect(preference?.isCurrent()).toBe(false)
  })

  it('ends a never-settling invocation visibly within its total bound', async () => {
    vi.useFakeTimers()
    const { notices, startup } = start({ timeoutMs: 30, runStarter: async () => new Promise(() => {}) })
    await vi.advanceTimersByTimeAsync(30)
    expect(await startup.done).toMatchObject({ status: 'unavailable', reason: 'budget-exhausted' })
    expect(await startup.initial).toBeNull()
    expect(notices.at(-1)).toMatchObject({ kind: 'attention' })
  })

  it.each([
    ['not-applicable', false], ['retained-unavailable', true], ['preserved', false], ['disabled', false], ['unknown', true],
  ])('handles actual registration %s without a create fallback', async (disposition, visible) => {
    const fetcher = vi.fn(async () => disposition === 'not-applicable'
      ? json({ schema: 'sophia.account-starter.v1', subject, status: disposition, reason: 'pre-cutoff-account' })
      : disposition === 'disabled' || disposition === 'unknown'
        ? json({ schema: 'sophia.account-starter.v1', subject, code: disposition === 'disabled' ? 'starter_disabled' : 'starter_authority_unavailable' }, 503)
        : json(snapshot(disposition === 'preserved' ? 'registered' : disposition, disposition === 'preserved')))
    const { notices, startup } = start({ fetch: fetcher as typeof fetch })
    await startup.done
    expect(await startup.initial).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(Boolean(notices.at(-1))).toBe(visible)
  })

  it.each([
    { token_use: 'access' }, { iss: 'https://other.test' }, { aud: 'other-client' }, { sub: 'other' }, { identities: [{ providerName: 'Google' }] },
  ])('does not invoke the native starter for an unsupported session shape %j', async claims => {
    const auth = new Session(); auth.value = jwt(claims)
    const runStarter = vi.fn(async () => complete())
    const { startup } = start({ auth, runStarter })
    expect(isNativeStarterSession(auth, cognito)).toBe(false)
    expect(await startup.done).toEqual({ status: 'skipped' })
    expect(runStarter).not.toHaveBeenCalled()
  })

  it.each(['local', 'playground', 'service'] as const)('does not invoke the starter in %s transport', async mode => {
    const runStarter = vi.fn(async () => complete())
    const { startup } = start({ mode: mode === 'service' ? 'hosted' : mode, serviceProxySubject: mode === 'service' ? subject : undefined, runStarter })
    expect(await startup.done).toEqual({ status: 'skipped' })
    expect(runStarter).not.toHaveBeenCalled()
  })
})

describe('starter dispatch and fresh directory confirmation', () => {
  it('keeps generation and bearer on an activation retry, without an unbound route', async () => {
    const calls: { input: string; init: RequestInit }[] = []
    const mcp = createCapturedStarterMcp({ gatewayBaseUrl: base, subject, token: 'captured', isCurrent: () => true,
      fetch: async (input, init = {}) => {
        calls.push({ input: String(input), init })
        if (calls.length === 1) return json({ code: 'graph_activating', activationId: 'fixed', pollUrl: '/activations/fixed' }, 202)
        if (calls.length === 2) return json({ activationId: 'fixed', phase: 'ready' })
        return json({ jsonrpc: '2.0', id: 1, result: { structuredContent: { count: 0 } } })
      } })
    expect(await mcp.callTool(target, 'list_documents', { graphId: target.graphId }, new AbortController().signal)).toEqual({ count: 0 })
    expect(calls).toHaveLength(3)
    expect(calls[0].input).toBe(calls[2].input)
    for (const call of calls) {
      expect(new Headers(call.init.headers).get(STARTER_GENERATION_HEADER)).toBe('4')
      expect(new Headers(call.init.headers).get('Authorization')).toBe('Bearer captured')
    }
  })

  it('refuses a replaced generation and never retries a 409 on create-once', async () => {
    const fetcher = vi.fn(async () => json({ error: 'generation mismatch' }, 409))
    const mcp = createCapturedStarterMcp({ gatewayBaseUrl: base, subject, token: 'captured', isCurrent: () => true, fetch: fetcher as typeof fetch })
    await expect(mcp.callTool(target, 'create_document_once', { graph_id: target.graphId }, new AbortController().signal)).rejects.toThrow('HTTP 409')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('checks identity again after the async auth boundary and at dispatch', async () => {
    let current = true
    const fetcher = vi.fn(async () => json({ jsonrpc: '2.0', id: 1, result: {} }))
    const mcp = createCapturedStarterMcp({ gatewayBaseUrl: base, subject, token: 'captured', isCurrent: () => current, fetch: fetcher as typeof fetch })
    const pending = mcp.callTool(target, 'read_document', { graphId: target.graphId }, new AbortController().signal)
    current = false
    await expect(pending).rejects.toThrow('stale-session')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not change a previously bound workspace or accept mismatched tool IDs', async () => {
    const fetcher = vi.fn(async () => json({ jsonrpc: '2.0', id: 1, result: { structuredContent: {} } }))
    const mcp = createCapturedStarterMcp({ gatewayBaseUrl: base, subject, token: 'captured', isCurrent: () => true, fetch: fetcher as typeof fetch })
    await mcp.callTool(target, 'list_documents', { graphId: target.graphId }, new AbortController().signal)
    await expect(mcp.callTool({ ...target, generation: 5 }, 'list_documents', { graphId: target.graphId }, new AbortController().signal)).rejects.toThrow('routing-identity-changed')
    await expect(mcp.callTool(target, 'read_document', { graphId: 'other' }, new AbortController().signal)).rejects.toThrow('mcp-target-mismatch')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('requires exact fresh Owner/generation/unique-row confirmation and preserves stored selection', () => {
    const preference = { workspace: target, isCurrent: () => true }
    const row: GatewayGraphInfo = { ...target, title: 'My Garden', role: 'owner', cellState: 'running' }
    expect(confirmedStarterPreference(preference, [row], '')).toBe(target.graphId)
    for (const invalid of [[], [row, row], [{ ...row, owner: 'user:other' }], [{ ...row, generation: undefined }], [{ ...row, generation: 5 }], [{ ...row, role: 'viewer' as const }]]) {
      expect(confirmedStarterPreference(preference, invalid, '')).toBeNull()
    }
    expect(confirmedStarterPreference(preference, [row, { ...row, graphId: 'chosen' }], 'chosen')).toBeNull()
    expect(confirmedStarterPreference({ ...preference, isCurrent: () => false }, [row], '')).toBeNull()
  })

  it.each([0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1])('rejects malformed directory generation %j', async generation => {
    const gateway = new GatewayTransport({ gatewayBaseUrl: base, auth: new Session(), fetch: async () => json([{ ...target, generation, title: 'My Garden', role: 'owner', cellState: 'running' }]) })
    await expect(gateway.graphs()).rejects.toThrow('invalid generation')
  })

  it('retains the real generation and does not invent it for legacy rows', async () => {
    const row = { graphId: 'legacy', title: 'Legacy', role: 'owner', cellState: 'running' }
    const gateway = new GatewayTransport({ gatewayBaseUrl: base, auth: new Session(), fetch: async () => json([{ ...row, ...target }, row]) })
    expect(await gateway.graphs()).toEqual([{ ...row, ...target }, row])
  })

  it('replaces ordinary directory owner bindings without turning them into explicit permanent bindings', () => {
    const gateway = new GatewayTransport({ gatewayBaseUrl: base, auth: new Session() })
    const row: GatewayGraphInfo = { ...target, title: 'My Garden', role: 'owner', cellState: 'stopped' }
    gateway.adoptGraphDirectory([row])
    expect(gateway.graphBaseUrl(row.graphId)).toContain(encodeURIComponent(row.owner!))
    gateway.adoptGraphDirectory([{ ...row, owner: 'user:other' }])
    expect(gateway.graphBaseUrl(row.graphId)).toContain('user%3Aother')
    gateway.adoptGraphDirectory([row, { ...row, owner: 'user:other' }])
    expect(() => gateway.graphBaseUrl(row.graphId)).toThrow('ambiguous')
    gateway.bindGraphOwner('trusted', target.owner)
    gateway.adoptGraphDirectory([])
    expect(gateway.graphBaseUrl('trusted')).toContain(encodeURIComponent(target.owner))
    expect(gateway.graphBaseUrl(row.graphId)).not.toContain('/o/')
  })

  it('captures the directory bearer and request lifetime without a generation restriction on the account catalog', async () => {
    const auth = new Session()
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json([]))
    expect(await readCapturedHostedDirectory({ gatewayBaseUrl: base, auth, isCurrent: () => true, fetch: fetcher as typeof fetch })).toEqual([])
    const [input, init] = fetcher.mock.calls[0]
    expect(input).toBe(`${base}/graphs`)
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${auth.value}`)
    expect(new Headers(init?.headers).has(STARTER_GENERATION_HEADER)).toBe(false)
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' })
    expect(auth.listeners.size).toBe(0)
  })

  it.each(['sign-out', 'token-switch', 'subject-switch'] as const)('refuses a directory response after %s', async kind => {
    const auth = new Session()
    const arrived = deferred<void>()
    const response = deferred<Response>()
    const promise = readCapturedHostedDirectory({ gatewayBaseUrl: base, auth, isCurrent: () => true,
      fetch: async () => { arrived.resolve(); return response.promise } })
    const refused = expect(promise).rejects.toThrow('stale-session')
    await arrived.promise
    auth.change(kind)
    await refused
    response.resolve(json([{ ...target, title: 'Old account', role: 'owner', cellState: 'running' }]))
    expect(auth.listeners.size).toBe(0)
  })

  it('rechecks directory identity immediately before dispatch', async () => {
    let current = true
    const fetcher = vi.fn(async () => json([]))
    const pending = readCapturedHostedDirectory({ gatewayBaseUrl: base, auth: new Session(), isCurrent: () => current, fetch: fetcher as typeof fetch })
    current = false
    await expect(pending).rejects.toThrow('stale-session')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['request', 'body'])('bounds a never-settling directory %s', async phase => {
    vi.useFakeTimers()
    const auth = new Session()
    const fetcher = async () => phase === 'request' ? new Promise<Response>(() => {})
      : { ok: true, text: () => new Promise<string>(() => {}) } as Response
    const pending = readCapturedHostedDirectory({ gatewayBaseUrl: base, auth, isCurrent: () => true, fetch: fetcher as typeof fetch, timeoutMs: 20 })
    const refused = expect(pending).rejects.toThrow('directory-timeout')
    await vi.advanceTimersByTimeAsync(20)
    await refused
    expect(auth.listeners.size).toBe(0)
  })

  it('uses visible existing toast chrome with only an explicit Workspaces action', async () => {
    const open = vi.fn()
    const notice = makeStarterStartupNotice(document, open)
    notice.show({ kind: 'attention', message: 'Starter needs attention', description: 'Retained work.', workspace: target })
    const toast = document.querySelector('mn-toast')!
    await toast.updateComplete
    expect(toast.visible).toBe(true)
    expect(toast.duration).toBe(0)
    expect(toast.shadowRoot!.textContent).toContain('Retained work.')
    expect(toast.shadowRoot!.textContent).not.toContain(target.graphId)
    expect(open).not.toHaveBeenCalled()
    toast.dispatchEvent(new CustomEvent('mn-action'))
    expect(open).toHaveBeenCalledTimes(1)
    notice.show(null)
    expect(document.querySelector('mn-toast')).toBeNull()
    notice.show({ kind: 'prepared', message: 'Your starter pages are available', description: 'Open My Garden from Workspaces.' })
    expect(document.querySelector('mn-toast')!.duration).toBe(8_000)
    notice.destroy()
  })
})
