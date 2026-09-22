/**
 * workspace-gateway-service.test.ts — mirrors
 * `apps/organism/src/cell/__tests__/hosted-viewer-rest-client.test.ts`'s own
 * `fetchQueue` convention (this wave's task brief: "the hosted-viewer-rest-
 * client test pattern"): `vi.fn` wraps a REAL async function that returns a
 * REAL `Response`, never a stubbed return value. Every assertion below
 * drives the ACTUAL `createWorkspaceCatalogService`/`createAccessGrantService`
 * return values — no method is reimplemented here, only the transport's
 * `fetch` call is captured.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createAccessGrantService,
  createWorkspaceCatalogService,
  WorkspaceGatewayHttpError,
  type WorkspaceGatewayTransport,
} from '../workspace-gateway-service.js'

interface FetchCall {
  readonly url: string
  readonly init: RequestInit
}

function fetchQueue(...responses: Array<{ status?: number; body?: unknown; raw?: string }>) {
  const calls: FetchCall[] = []
  const fetchImpl: typeof globalThis.fetch = vi.fn(async (input, init = {}) => {
    calls.push({ url: String(input), init })
    const response = responses.shift()
    if (!response) throw new Error(`unexpected fetch: ${String(input)}`)
    const body = response.raw ?? JSON.stringify(response.body ?? null)
    return new Response(body, {
      status: response.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  return { fetch: fetchImpl, calls }
}

function transport(headers: Record<string, string> = { Authorization: 'Bearer tok-1' }): WorkspaceGatewayTransport {
  return {
    resolveGatewayBaseUrl: () => 'https://api.canary.sophia-labs.com',
    headers: () => headers,
  }
}

describe('createWorkspaceCatalogService — real request construction', () => {
  it('GETs the exact gateway control-plane /graphs route with headers, and parses a bare array', async () => {
    const { fetch, calls } = fetchQueue({
      body: [
        { graphId: 'g1', title: 'Alpha', cellState: 'running', role: 'owner' },
        { graphId: 'g2', title: 'Beta', cellState: 'stopped', role: 'viewer' },
      ],
    })
    const service = createWorkspaceCatalogService(transport(), fetch)

    const entries = await service.list()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.canary.sophia-labs.com/graphs')
    expect(calls[0]?.init.method).toBe('GET')
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1')
    expect(entries).toEqual([
      { graphId: 'g1', title: 'Alpha', cellState: 'running', role: 'owner' },
      { graphId: 'g2', title: 'Beta', cellState: 'stopped', role: 'viewer' },
    ])
  })

  it('accepts an { items } rolling-deploy compatibility envelope', async () => {
    const { fetch } = fetchQueue({
      body: { items: [{ graphId: 'g1', title: 'Alpha', cellState: 'running', role: 'editor' }] },
    })
    const service = createWorkspaceCatalogService(transport(), fetch)
    const entries = await service.list()
    expect(entries).toEqual([{ graphId: 'g1', title: 'Alpha', cellState: 'running', role: 'editor' }])
  })

  it('rejects a row with an invalid role/cellState shape rather than silently coercing it', async () => {
    const { fetch } = fetchQueue({ body: [{ graphId: 'g1', title: 'Alpha', cellState: 'sleeping', role: 'owner' }] })
    const service = createWorkspaceCatalogService(transport(), fetch)
    await expect(service.list()).rejects.toThrow(/invalid graphId\/title\/cellState\/role shape/)
  })

  it('throws a typed WorkspaceGatewayHttpError on a non-2xx response, body verbatim', async () => {
    const { fetch } = fetchQueue({ status: 403, raw: '{"error":"forbidden"}' })
    const service = createWorkspaceCatalogService(transport(), fetch)
    await expect(service.list()).rejects.toMatchObject({
      constructor: WorkspaceGatewayHttpError,
      status: 403,
      responseBody: '{"error":"forbidden"}',
    })
  })

  it('trims a trailing slash off the resolved gateway base URL', async () => {
    const { fetch, calls } = fetchQueue({ body: [] })
    const service = createWorkspaceCatalogService(
      { resolveGatewayBaseUrl: () => 'https://api.canary.sophia-labs.com/', headers: () => ({}) },
      fetch,
    )
    await service.list()
    expect(calls[0]?.url).toBe('https://api.canary.sophia-labs.com/graphs')
  })

  // wave1 review r1 WRONG fix: workspace.picker used to have no create/
  // remove at all — these prove the routes byte-identical to
  // `gateway-transport.ts`'s own `createGraph`/`deleteGraph`.
  it('POSTs the exact gateway control-plane /graphs route to create a workspace, with an optional title', async () => {
    const { fetch, calls } = fetchQueue({ body: { graphId: 'g-new', title: 'New Garden' } })
    const service = createWorkspaceCatalogService(transport(), fetch)

    const created = await service.create({ title: 'New Garden' })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.canary.sophia-labs.com/graphs')
    expect(calls[0]?.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ title: 'New Garden' })
    expect(created).toEqual({ graphId: 'g-new', title: 'New Garden' })
  })

  it('create() omits an empty/absent title from the request body, and accepts a {data} envelope response', async () => {
    const { fetch, calls } = fetchQueue({ body: { data: { graph_id: 'g-auto' } } })
    const service = createWorkspaceCatalogService(transport(), fetch)

    const created = await service.create()

    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({})
    expect(created).toEqual({ graphId: 'g-auto', title: 'g-auto' })
  })

  it('create() throws when the gateway returns no graph id', async () => {
    const { fetch } = fetchQueue({ body: {} })
    const service = createWorkspaceCatalogService(transport(), fetch)
    await expect(service.create()).rejects.toThrow(/returned no graph id/)
  })

  it('DELETEs the exact gateway control-plane /graphs/{id} route to remove a workspace', async () => {
    const { fetch, calls } = fetchQueue({ status: 204, raw: '' })
    const service = createWorkspaceCatalogService(transport(), fetch)

    await service.remove('g-old')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.canary.sophia-labs.com/graphs/g-old')
    expect(calls[0]?.init.method).toBe('DELETE')
  })

  it('remove() rejects an empty graphId client-side, no request sent', async () => {
    const { fetch, calls } = fetchQueue()
    const service = createWorkspaceCatalogService(transport(), fetch)
    await expect(service.remove('  ')).rejects.toThrow(/must not be empty/)
    expect(calls).toHaveLength(0)
  })
})

describe('createAccessGrantService — real request construction', () => {
  it('GETs the exact gateway /graphs/{id}/access route and parses grant rows', async () => {
    const { fetch, calls } = fetchQueue({
      body: [
        { userId: 'owner-1', role: 'owner', grantedAt: '2026-07-10T12:00:00Z', grantedBy: 'owner-1', email: 'o@example.test' },
      ],
    })
    const service = createAccessGrantService(transport(), fetch)

    const grants = await service.list('graph-a')

    expect(calls[0]?.url).toBe('https://api.canary.sophia-labs.com/graphs/graph-a/access')
    expect(calls[0]?.init.method).toBe('GET')
    expect(grants).toEqual([
      { userId: 'owner-1', role: 'owner', grantedAt: '2026-07-10T12:00:00Z', grantedBy: 'owner-1', email: 'o@example.test' },
    ])
  })

  it('PUTs a role grant to the exact per-user route with a JSON body, URI-encoding both ids', async () => {
    const { fetch, calls } = fetchQueue({ body: { graphId: 'graph-a', userId: 'user/two', role: 'editor' } })
    const service = createAccessGrantService(transport(), fetch)

    await service.put('graph a', 'user/two', { role: 'editor', email: 'two@example.test' })

    expect(calls[0]?.url).toBe(
      'https://api.canary.sophia-labs.com/graphs/graph%20a/access/user%2Ftwo',
    )
    expect(calls[0]?.init.method).toBe('PUT')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ role: 'editor', email: 'two@example.test' })
  })

  it('rejects put() with an owner role rather than silently sending it', async () => {
    const { fetch } = fetchQueue()
    const service = createAccessGrantService(transport(), fetch)
    await expect(service.put('graph-a', 'u1', { role: 'owner' as never })).rejects.toThrow(/viewer or editor/)
  })

  it('DELETEs the exact per-user route', async () => {
    const { fetch, calls } = fetchQueue({ raw: '' })
    const service = createAccessGrantService(transport(), fetch)
    await service.remove('graph-a', 'user-1')
    expect(calls[0]?.url).toBe('https://api.canary.sophia-labs.com/graphs/graph-a/access/user-1')
    expect(calls[0]?.init.method).toBe('DELETE')
  })

  it('throws a typed WorkspaceGatewayHttpError on a non-2xx response', async () => {
    const { fetch } = fetchQueue({ status: 404, raw: '{"error":"not found"}' })
    const service = createAccessGrantService(transport(), fetch)
    await expect(service.list('graph-missing')).rejects.toMatchObject({
      constructor: WorkspaceGatewayHttpError,
      status: 404,
    })
  })
})
