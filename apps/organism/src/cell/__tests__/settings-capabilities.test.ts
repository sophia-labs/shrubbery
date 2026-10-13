import { describe, expect, it, vi } from 'vitest'
import { HostedSettingsCapabilities, hostedGraphSettingsWritable } from '../settings-capabilities.js'
import { PhanesControlApi } from '../phanes-control-api.js'

const SUBJECT = 'verified-operator-fixture'
function envelope(phanesControl: unknown = true, subject: unknown = SUBJECT) {
  return { schema: 'sophia.me.capabilities.v1', subject, capabilities: { phanesControl } }
}
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }) }
function fixture(body: unknown = envelope(), status = 200) {
  const session = { subject: SUBJECT, token: 'synthetic-session-token' }
  const auth = { userId: () => session.subject, token: () => session.token, whenReady: async () => {} }
  const fetch = vi.fn(async () => json(body, status))
  return { session, auth, fetch, capability: new HostedSettingsCapabilities(auth, 'https://gateway.example.test', fetch) }
}

describe('server-bound settings capabilities', () => {
  it('binds native fetch to the browser global receiver', async () => {
    const test = fixture()
    vi.stubGlobal('fetch', function(this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return Promise.resolve(json(envelope()))
    })
    try {
      const capability = new HostedSettingsCapabilities(test.auth, 'https://gateway.example.test')
      expect(await capability.refresh()).toBe(true)
    } finally { vi.unstubAllGlobals() }
  })
  it('uses only the authenticated no-store server projection and exact current subject', async () => {
    const test = fixture()
    expect(test.capability.allowed()).toBe(false)
    expect(await test.capability.refresh()).toBe(true)
    expect(test.capability.allowed()).toBe(true)
    expect(test.fetch).toHaveBeenCalledWith('https://gateway.example.test/me/capabilities', {
      method: 'GET', headers: { Authorization: 'Bearer synthetic-session-token' },
      cache: 'no-store', credentials: 'omit', redirect: 'error',
    })
  })

  it.each([
    envelope(false), envelope('true'), envelope(1), envelope([true]),
    envelope(true, 'another-subject'), envelope(true, [SUBJECT]),
    { ...envelope(), schema: 'unknown.v1' }, { subject: SUBJECT, capabilities: { phanesControl: true } },
    { ...envelope(), capabilities: [{ phanesControl: true }] }, null,
  ])('fails closed for denied or malformed capabilities: %j', async body => {
    const test = fixture(body)
    expect(await test.capability.refresh()).toBe(false)
    expect(test.capability.allowed()).toBe(false)
    await expect(test.capability.assertAllowed()).rejects.toThrow('not authorized')
  })

  it.each([401, 403, 404, 500])('fails closed for HTTP %s', async status => {
    const test = fixture(envelope(), status)
    expect(await test.capability.refresh()).toBe(false)
  })

  it('invalidates on token rotation, account change, logout and malformed reread', async () => {
    const test = fixture()
    await test.capability.refresh()
    test.session.token = 'rotated-token'
    expect(test.capability.allowed()).toBe(false)
    expect(await test.capability.refresh()).toBe(true)
    test.fetch.mockResolvedValueOnce(new Response('not json'))
    expect(await test.capability.refresh()).toBe(false)
    expect(test.capability.allowed()).toBe(false)
    test.session.subject = 'ordinary-subject'
    expect(await test.capability.refresh()).toBe(false)
    test.session.token = ''
    test.fetch.mockClear()
    expect(await test.capability.refresh()).toBe(false)
    expect(test.fetch).not.toHaveBeenCalled()
  })

  it('can recover after a synchronous fetch failure without caching the failed promise', async () => {
    const test = fixture()
    test.fetch.mockImplementationOnce(() => { throw new Error('transport stopped') })
    expect(await test.capability.refresh()).toBe(false)
    expect(await test.capability.refresh()).toBe(true)
    expect(test.fetch).toHaveBeenCalledTimes(2)
  })

  it('does not admit a stale in-flight reply after account change', async () => {
    const test = fixture()
    let reply!: (response: Response) => void
    test.fetch.mockImplementationOnce(() => new Promise(resolve => { reply = resolve }))
    const pending = test.capability.refresh()
    await vi.waitFor(() => expect(reply).toBeTypeOf('function'))
    test.session.subject = 'ordinary-subject'
    reply(json(envelope()))
    expect(await pending).toBe(false)
    expect(test.capability.allowed()).toBe(false)
  })

  it('refuses URL credentials and non-HTTP transports before any request', () => {
    const test = fixture()
    for (const url of ['https://user:password@example.test', 'file:///tmp/capability', 'https://example.test?token=hidden']) {
      expect(() => new HostedSettingsCapabilities(test.auth, url, test.fetch)).toThrow()
    }
    expect(test.fetch).not.toHaveBeenCalled()
  })

  it('rechecks authorization before direct Phanes reads or writes, not just navigation', async () => {
    const test = fixture(envelope(false))
    const callTool = vi.fn(async () => ({}))
    const api = new PhanesControlApi({ callTool }, test.capability)
    for (const run of [() => api.load(), () => api.loadIngestionControl(), () => api.loadOperations(),
      () => api.save({}, 0), () => api.saveIngestionPolicy({}, 0), () => api.saveOperationsControl({}, 0)]) {
      await expect(run()).rejects.toThrow('not authorized')
    }
    await expect(new PhanesControlApi({ callTool }).load()).rejects.toThrow('not authorized')
    expect(callTool).not.toHaveBeenCalled()
    test.fetch.mockResolvedValue(json(envelope()))
    callTool.mockRejectedValueOnce(new Error('authorized fixture read reached transport'))
    await expect(api.load()).rejects.toThrow('authorized fixture read reached transport')
    expect(callTool).toHaveBeenCalledTimes(1)
    test.fetch.mockResolvedValue(json(envelope(false)))
    await expect(api.load()).rejects.toThrow('not authorized')
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it('takes only an unambiguous fresh editor/owner directory row as a UI write hint', async () => {
    const test = fixture()
    for (const role of ['editor', 'owner']) {
      expect(await hostedGraphSettingsWritable(test.auth, 'graph', async () => [{ graphId: 'graph', role }])).toBe(true)
    }
    for (const rows of [[], [{ graphId: 'graph', role: 'viewer' }], [{ graphId: 'other', role: 'owner' }],
      [{ graphId: 'graph', role: 'owner' }, { graphId: 'graph', role: 'editor' }], { role: 'owner' }]) {
      expect(await hostedGraphSettingsWritable(test.auth, 'graph', async () => rows)).toBe(false)
    }
    expect(await hostedGraphSettingsWritable(test.auth, 'graph', async () => { throw new Error('offline') })).toBe(false)
  })
})
