import { describe, expect, it } from 'vitest'
import { ArchiveRequestError, createConversationArchive } from '../conversation-archive.js'
const id = 'urn:sophia:conversation-archive:conversation:' + 'a'.repeat(64)
const revisionId = 'b'.repeat(64)
const revision = { revisionId, title: 'My Sophia chat', messageCount: 1, partCount: 1 }
const message = { messageId: 'm1', role: 'assistant', occurredAt: '2026-01-01T00:00:00Z', state: 'retained', parts: [{ partId: 'p1', kind: 'text', mediaType: 'text/plain', content: 'Saved answer' }] }
const page = { conversationId: id, revisionId, cursor: 0, messages: [message], nextCursor: null, totalMessages: 1, completeness: { status: 'complete', reason: 'Captured' } }
describe('account conversation archive', () => {
  it('uses only account GETs with current human auth and validates owner, revisions and message pagination', async () => {
    const requests: { url: URL; init: RequestInit | undefined }[] = []
    const client = createConversationArchive({ gatewayBaseUrl: 'https://sirin.test', userId: () => 'alice', token: () => 'human', fetchImpl: async (input, init) => {
      const url = new URL(String(input)); requests.push({ url, init })
      const body = url.pathname.endsWith('/messages') ? page : url.pathname === '/me/conversations'
        ? { schema: 'sophia.private-conversation-catalogue.v1', items: [{ conversationId: id, graphId: 'home', revision, revisionCount: 1 }], nextCursor: null }
        : { conversationId: id, audience: { kind: 'owner-only', ownerPrincipal: 'user:alice' }, revisions: [revision] }
      return new Response(JSON.stringify(body))
    } })
    expect((await client.list()).items[0].revision.title).toBe('My Sophia chat')
    expect(await client.revisions(id)).toEqual([revision])
    expect((await client.messages(id, revisionId)).messages).toEqual([message])
    for (const { url, init } of requests) {
      expect(url.pathname).toMatch(/^\/me\/conversations/)
      expect(init?.method ?? 'GET').toBe('GET')
      expect(init?.headers).toEqual({ Authorization: 'Bearer human' })
      expect(init?.cache).toBe('no-store')
      expect(init?.credentials).toBe('omit')
      expect(init?.redirect).toBe('error')
    }
  })
  it('rejects foreign owners, stale responses, malformed cursors and partial pages presented as complete', async () => {
    let subject = 'alice'
    let body: unknown = { conversationId: id, audience: { kind: 'owner-only', ownerPrincipal: 'user:bob' }, revisions: [revision] }
    let change = false
    const client = createConversationArchive({ gatewayBaseUrl: 'https://sirin.test', userId: () => subject, token: () => 'human', fetchImpl: async () => {
      if (change) subject = 'bob'
      return new Response(JSON.stringify(body))
    } })
    await expect(client.revisions(id)).rejects.toThrow('ownership')
    await expect(client.list('../private')).rejects.toThrow('cursor')
    body = { ...page, totalMessages: 2 }
    await expect(client.messages(id, revisionId)).rejects.toThrow('pagination')
    change = true; body = page
    await expect(client.messages(id, revisionId)).rejects.toThrow('session changed')
  })
})

// ── Sobremesa additions: recency order, dates, parents, models, voice, typed failures ──

const cid = (n: number): string => 'urn:sophia:conversation-archive:conversation:' + n.toString(16).padStart(64, '0')
const rid = (n: number): string => n.toString(16).padStart(64, '0')
/** Item 0 is the newest; every item gets an hour older than the one before. */
const lastAt = (n: number): string => new Date(Date.UTC(2026, 8, 1) - n * 3_600_000).toISOString()
const firstAt = (n: number): string => new Date(Date.UTC(2026, 8, 1) - n * 3_600_000 - 600_000).toISOString()
function rawItem(n: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conversationId: cid(n),
    graphId: 'cloud1-opencode-archive',
    revision: { revisionId: rid(n + 1), title: `Chat ${n}`, messageCount: 3, partCount: 5 },
    revisionCount: 1,
    firstOccurredAt: firstAt(n),
    lastOccurredAt: lastAt(n),
    parentConversationId: n % 10 === 1 ? cid(n - 1) : null,
    models: [{ id: 'moonshotai/kimi-k2.5', provider: 'moonshotai' }],
    attributionBasis: 'account header',
    ...extra,
  }
}
const BASE_KEYS = ['conversationId', 'graphId', 'revision', 'revisionCount']

/**
 * A real, small gateway: it parses the query the way the deployed route does.
 * `supportsRecent: false` is the deployed gateway at c29fef5 (deny_unknown_fields,
 * hash order, cursor = last conversation id, no additive fields); `true` is the
 * Sobremesa one (order=recent, opaque cursor, additive fields).
 */
function fakeGateway(options: { supportsRecent: boolean; items: Record<string, unknown>[]; status?: number; code?: string }) {
  const requests: URL[] = []
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    requests.push(url)
    if (options.status) return json({ ok: false, code: options.code }, options.status)
    const known = options.supportsRecent ? ['limit', 'after', 'order'] : ['limit', 'after']
    for (const key of url.searchParams.keys()) {
      if (!known.includes(key)) return new Response('Failed to deserialize query string: unknown field `' + key + '`', { status: 400 })
    }
    const limit = Number(url.searchParams.get('limit') ?? '50')
    const after = url.searchParams.get('after')
    if (options.supportsRecent) {
      const sorted = [...options.items].sort((a, b) => String(b.lastOccurredAt ?? '').localeCompare(String(a.lastOccurredAt ?? '')))
      const offset = after ? Number(after.slice(3)) : 0
      const slice = sorted.slice(offset, offset + limit)
      const next = offset + slice.length < sorted.length ? `v1.${offset + slice.length}` : null
      return json({ schema: 'sophia.private-conversation-catalogue.v1', items: slice, nextCursor: next })
    }
    const sorted = [...options.items]
      .map(item => Object.fromEntries(Object.entries(item).filter(([key]) => BASE_KEYS.includes(key))))
      .sort((a, b) => String(a.conversationId).localeCompare(String(b.conversationId)))
    const start = after ? sorted.findIndex(item => String(item.conversationId) > after) : 0
    const slice = start < 0 ? [] : sorted.slice(start, start + limit)
    const more = start >= 0 && start + slice.length < sorted.length
    return json({ schema: 'sophia.private-conversation-catalogue.v1', items: slice, nextCursor: more ? slice.at(-1)!.conversationId : null })
  }) as typeof fetch
  return { fetchImpl, requests }
}
const clientOver = (fetchImpl: typeof fetch) =>
  createConversationArchive({ gatewayBaseUrl: 'https://sirin.test', userId: () => 'alice', token: () => 'human', fetchImpl })

describe('account conversation archive: recency order and the additive fields', () => {
  it('asks for recency order, reads dates, parent, models and basis, and follows an opaque cursor', async () => {
    const gateway = fakeGateway({ supportsRecent: true, items: Array.from({ length: 120 }, (_, n) => rawItem(n)) })
    const client = clientOver(gateway.fetchImpl)
    const first = await client.list()
    expect(gateway.requests[0].searchParams.get('order')).toBe('recent')
    expect(first.order).toBe('recent')
    expect(first.items).toHaveLength(50)
    expect(first.nextCursor).toBe('v1.50')
    expect(first.items[0]).toMatchObject({
      conversationId: cid(0),
      firstOccurredAt: firstAt(0),
      lastOccurredAt: lastAt(0),
      models: [{ id: 'moonshotai/kimi-k2.5', provider: 'moonshotai' }],
      attributionBasis: 'account header',
    })
    // A child names its parent; a root has no parent key at all.
    expect(first.items[1].parentConversationId).toBe(cid(0))
    expect('parentConversationId' in first.items[0]).toBe(false)
    const second = await client.list(first.nextCursor!)
    expect(gateway.requests[1].searchParams.get('after')).toBe('v1.50')
    expect(second.items[0].conversationId).toBe(cid(50))
    expect((await client.list(second.nextCursor!)).nextCursor).toBeNull()
  })

  it('falls back to stored order when an older gateway refuses order=recent, and asks only once', async () => {
    const gateway = fakeGateway({ supportsRecent: false, items: Array.from({ length: 60 }, (_, n) => rawItem(n)) })
    const client = clientOver(gateway.fetchImpl)
    const first = await client.list()
    expect(first.order).toBe('stored')
    expect(first.items).toHaveLength(50)
    expect('lastOccurredAt' in first.items[0]).toBe(false)
    expect(first.nextCursor).toBe(first.items.at(-1)!.conversationId)
    const second = await client.list(first.nextCursor!)
    expect(second.items).toHaveLength(10)
    expect(second.nextCursor).toBeNull()
    expect(gateway.requests.map(url => url.searchParams.get('order'))).toEqual(['recent', null, null])
  })

  it('keeps every stored-order check: catalogue order, cursor shape', async () => {
    const wrongOrder = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.searchParams.has('order')) return new Response('unknown field', { status: 400 })
      return new Response(JSON.stringify({ schema: 'sophia.private-conversation-catalogue.v1', items: [rawItem(3)], nextCursor: null }))
    }) as typeof fetch
    await expect(clientOver(wrongOrder).list(cid(5))).rejects.toThrow('order')
    await expect(clientOver(wrongOrder).list('v1.50')).rejects.toThrow('cursor')
  })

  it('accepts an opaque cursor only after the gateway has shown it speaks recency order', async () => {
    const gateway = fakeGateway({ supportsRecent: true, items: Array.from({ length: 60 }, (_, n) => rawItem(n)) })
    const client = clientOver(gateway.fetchImpl)
    await expect(client.list('v1.50')).rejects.toThrow('cursor')
    await client.list()
    await expect(client.list('v1.50')).resolves.toMatchObject({ order: 'recent' })
    await expect(client.list('has spaces')).rejects.toThrow('cursor')
  })

  it('ignores malformed additive fields instead of failing the page, and never invents one', async () => {
    const gateway = fakeGateway({ supportsRecent: true, items: [
      rawItem(0, { firstOccurredAt: 'not a date', lastOccurredAt: 42, parentConversationId: '../etc/passwd', models: 'kimi', attributionBasis: 7 }),
      rawItem(1, { models: [{ id: '' }, { provider: 'x' }, 'zai/glm-4.6', { id: 'google/gemini-2.5-flash' }], attributionBasis: '' }),
    ] })
    const { items } = await clientOver(gateway.fetchImpl).list()
    const bare = items.find(item => item.conversationId === cid(0))!
    for (const key of ['firstOccurredAt', 'lastOccurredAt', 'parentConversationId', 'models', 'attributionBasis']) {
      expect(key in bare, key).toBe(false)
    }
    const partial = items.find(item => item.conversationId === cid(1))!
    expect(partial.models).toEqual([{ id: 'zai/glm-4.6', provider: null }, { id: 'google/gemini-2.5-flash', provider: null }])
    expect('attributionBasis' in partial).toBe(false)
  })

  it('reads a per-message voice in the shapes the gateway may use, and never invents one', async () => {
    const withVoice = (messageId: string, voice?: unknown) => ({ ...message, messageId, ...(voice === undefined ? {} : { voice }) })
    const body = { ...page, totalMessages: 5, messages: [
      withVoice('m1', { modelId: 'moonshotai/kimi-k2.5', provider: 'moonshotai', basis: 'source-recorded' }),
      withVoice('m2', 'moonshotai/kimi-k2.5'),
      withVoice('m3', { label: 'Kimi K2.5' }),
      withVoice('m4'),
      withVoice('m5', 42),
    ] }
    const client = clientOver((async () => new Response(JSON.stringify(body))) as typeof fetch)
    const { messages } = await client.messages(id, revisionId)
    expect(messages[0].voice).toEqual({ modelId: 'moonshotai/kimi-k2.5', provider: 'moonshotai', label: null, basis: 'source-recorded' })
    expect(messages[1].voice).toEqual({ modelId: 'moonshotai/kimi-k2.5', provider: null, label: null, basis: null })
    expect(messages[2].voice).toEqual({ modelId: null, provider: null, label: 'Kimi K2.5', basis: null })
    expect('voice' in messages[3]).toBe(false)
    expect('voice' in messages[4]).toBe(false)
  })

  it('reads the voice the way the gateway serves it: a page-level map keyed by message id, and no voice on the message itself', async () => {
    // `G-gateway-return.md` 1.3: the messages are the archive's, byte for byte; the sidecar's voices ride beside them in
    // `voice.byMessage`, `{ modelId, providerId, basis }`, and a message absent from the map is "voice not recorded".
    const named = (messageId: string) => ({ ...message, messageId })
    const body = {
      ...page,
      totalMessages: 4,
      messages: [named('urn:m:1'), named('urn:m:2'), named('urn:m:3'), named('urn:m:4')],
      voice: {
        derivedBy: { job: 'conversation-sidecar-backfill', version: '1', at: '2026-10-01T00:00:00.000Z' },
        byMessage: {
          'urn:m:2': { modelId: 'moonshotai/kimi-k2.5', providerId: 'openrouter', basis: 'source-recorded' },
          'urn:m:3': { modelId: 'claude-sonnet-4', providerId: null, basis: 'source-recorded' },
          // A message that is not on this page names nothing here.
          'urn:m:elsewhere': { modelId: 'gpt-5', providerId: 'openai', basis: 'source-recorded' },
        },
      },
    }
    const client = clientOver((async () => new Response(JSON.stringify(body))) as typeof fetch)
    const { messages } = await client.messages(id, revisionId)
    expect('voice' in messages[0]).toBe(false)
    expect(messages[1].voice).toEqual({ modelId: 'moonshotai/kimi-k2.5', provider: 'openrouter', label: null, basis: 'source-recorded' })
    expect(messages[2].voice).toEqual({ modelId: 'claude-sonnet-4', provider: null, label: null, basis: 'source-recorded' })
    expect('voice' in messages[3]).toBe(false)
  })

  it('treats a page whose `voice` is null, or not a map, as "voice not recorded" for every message', async () => {
    for (const voice of [null, 'kimi', 42, { byMessage: 'x' }, { byMessage: [1, 2] }, {}]) {
      const body = { ...page, voice }
      const client = clientOver((async () => new Response(JSON.stringify(body))) as typeof fetch)
      const { messages } = await client.messages(id, revisionId)
      expect('voice' in messages[0], JSON.stringify(voice)).toBe(false)
    }
  })

  it('lets a voice on the message itself stand when the page has none for it, and the message’s own wins over the map', async () => {
    const own = { ...message, messageId: 'urn:m:1', voice: { modelId: 'own/model', provider: null, basis: 'source-recorded' } }
    const body = {
      ...page,
      messages: [own],
      voice: { byMessage: { 'urn:m:1': { modelId: 'map/model', providerId: null, basis: 'source-recorded' } } },
    }
    const client = clientOver((async () => new Response(JSON.stringify(body))) as typeof fetch)
    expect((await client.messages(id, revisionId)).messages[0].voice?.modelId).toBe('own/model')
  })

  it('reads an attribution basis on a revision only when the gateway sends one', async () => {
    const withBasis = { ...revision, attributionBasis: 'reciprocal parent lineage' }
    const client = clientOver((async () => new Response(JSON.stringify({
      conversationId: id, audience: { kind: 'owner-only', ownerPrincipal: 'user:alice' }, revisions: [withBasis, revision],
    }))) as typeof fetch)
    const revisions = await client.revisions(id)
    expect(revisions[0].attributionBasis).toBe('reciprocal parent lineage')
    expect('attributionBasis' in revisions[1]).toBe(false)
  })
})

describe('account conversation archive: failures are typed, not strings', () => {
  it.each([
    [401, undefined],
    [403, 'human_user_required'],
    [410, 'conversation_archive_erased'],
    [503, 'conversation_archive_busy'],
  ] as const)('a %i from the list carries its status and code', async (status, code) => {
    const client = clientOver(fakeGateway({ supportsRecent: true, items: [], status, code }).fetchImpl)
    const error = await client.list().catch(caught => caught)
    expect(error).toBeInstanceOf(ArchiveRequestError)
    expect(error.status).toBe(status)
    expect(error.code).toBe(code ?? null)
  })

  it('keeps the readable messages the panel used to show', async () => {
    const expired = clientOver(fakeGateway({ supportsRecent: true, items: [], status: 401 }).fetchImpl)
    await expect(expired.list()).rejects.toThrow('Your session expired. Sign in again.')
    const busy = clientOver(fakeGateway({ supportsRecent: true, items: [], status: 503 }).fetchImpl)
    await expect(busy.list()).rejects.toThrow('Imported chats could not be loaded (503).')
  })

  it('reports every archive route the same way, and an unreachable gateway as status 0', async () => {
    const gone = clientOver((async () => new Response(JSON.stringify({ ok: false, code: 'conversation_archive_erased' }), { status: 410 })) as typeof fetch)
    const fromRevisions = await gone.revisions(id).catch(caught => caught)
    expect(fromRevisions).toMatchObject({ status: 410, code: 'conversation_archive_erased' })
    const fromMessages = await gone.messages(id, revisionId).catch(caught => caught)
    expect(fromMessages).toBeInstanceOf(ArchiveRequestError)
    const offline = clientOver((async () => { throw new TypeError('Failed to fetch') }) as typeof fetch)
    const unreachable = await offline.list().catch(caught => caught)
    expect(unreachable).toBeInstanceOf(ArchiveRequestError)
    expect(unreachable).toMatchObject({ status: 0, code: 'unreachable' })
  })

  it('does not treat an unreadable body as a code', async () => {
    const client = clientOver((async () => new Response('<html>bad gateway</html>', { status: 503 })) as typeof fetch)
    const error = await client.list().catch(caught => caught)
    expect(error).toMatchObject({ status: 503, code: null })
  })
})
