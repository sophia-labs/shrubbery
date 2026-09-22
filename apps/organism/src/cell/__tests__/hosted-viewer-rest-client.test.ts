/**
 * hosted-viewer-rest-client.test.ts — mirrors hosted-gateway-contract.test.ts's
 * own `fetchQueue` convention: `vi.fn` wraps a REAL async function that
 * returns a REAL `Response`, never a stubbed return value.
 */
import { describe, expect, it, vi } from 'vitest'
import type { AuthProvider } from '@shrubbery/nucleus'
import { HostedViewerRestClient } from '../hosted-viewer-rest-client.js'
import { GatewayHttpError } from '../gateway-transport.js'

class MutableAuth implements AuthProvider {
  constructor(private currentToken: string | undefined = 'id-token-1') {}
  token(): string | undefined { return this.currentToken }
  userId(): string { return 'user-1' }
  isAuthenticated(): boolean { return Boolean(this.currentToken) }
  async whenReady(): Promise<void> {}
  onChange(): () => void { return () => {} }
  setToken(token: string | undefined): void { this.currentToken = token }
}

interface FetchCall {
  readonly url: string
  readonly init: RequestInit
}

function fetchQueue(...responses: Array<{ status?: number; body?: unknown; raw?: string }>) {
  const calls: FetchCall[] = []
  const fetch: typeof globalThis.fetch = vi.fn(async (input, init = {}) => {
    calls.push({ url: String(input), init })
    const response = responses.shift()
    if (!response) throw new Error(`unexpected fetch: ${String(input)}`)
    const body = response.raw ?? JSON.stringify(response.body ?? null)
    return new Response(body, {
      status: response.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

describe('HostedViewerRestClient', () => {
  it("POSTs the cell's Viewer-eligible /api/sparql/query route with a bearer token, not /mcp", async () => {
    const { fetch, calls } = fetchQueue({ body: { rows: [{ s: '<urn:a>', p: '<urn:b>', o: '<urn:c>' }] } })
    const rest = new HostedViewerRestClient({
      gatewayBaseUrl: 'https://api.canary.sophia-labs.com',
      owner: 'user:owner-1',
      auth: new MutableAuth('tok-1'),
      fetch,
    })

    const result = await rest.query('observatory', 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.canary.sophia-labs.com/o/user%3Aowner-1/g/observatory/api/sparql/query')
    expect(calls[0]?.init.method).toBe('POST')
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      graphId: 'observatory',
      query: 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }',
    })
    expect(result).toEqual({ rows: [{ s: '<urn:a>', p: '<urn:b>', o: '<urn:c>' }] })
  })

  it('honors a custom cellQueryRoute', async () => {
    const { fetch, calls } = fetchQueue({ body: { rows: [] } })
    const rest = new HostedViewerRestClient({
      gatewayBaseUrl: 'https://api.canary.sophia-labs.com',
      owner: 'user:owner-1',
      auth: new MutableAuth('tok-1'),
      fetch,
      cellQueryRoute: '/api/graphs/query',
    })
    await rest.query('observatory', 'ASK { ?s ?p ?o }')
    expect(calls[0]?.url).toBe('https://api.canary.sophia-labs.com/o/user%3Aowner-1/g/observatory/api/graphs/query')
  })

  it('rejects a non-cell-root-relative cellQueryRoute at construction', () => {
    expect(
      () =>
        new HostedViewerRestClient({
          gatewayBaseUrl: 'https://api.canary.sophia-labs.com',
          owner: 'user:owner-1',
          auth: new MutableAuth('tok-1'),
          cellQueryRoute: 'api/sparql/query',
        }),
    ).toThrow(/cell-root-relative/)
  })

  it('throws a typed GatewayHttpError on a non-2xx response, body verbatim', async () => {
    const { fetch } = fetchQueue({ status: 403, raw: '{"error":"forbidden"}' })
    const rest = new HostedViewerRestClient({
      gatewayBaseUrl: 'https://api.canary.sophia-labs.com',
      owner: 'user:owner-1',
      auth: new MutableAuth('tok-1'),
      fetch,
    })
    await expect(rest.query('observatory', 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }')).rejects.toMatchObject({
      constructor: GatewayHttpError,
      status: 403,
      responseBody: '{"error":"forbidden"}',
    })
  })

  it('throws when no auth token is available rather than sending an unauthenticated request', async () => {
    const { fetch, calls } = fetchQueue()
    const auth = new MutableAuth()
    auth.setToken(undefined) // constructor default arg would otherwise win — see MutableAuth's own default.
    const rest = new HostedViewerRestClient({
      gatewayBaseUrl: 'https://api.canary.sophia-labs.com',
      owner: 'user:owner-1',
      auth,
      fetch,
    })
    await expect(rest.query('observatory', 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }')).rejects.toThrow(/authentication token is unavailable/)
    expect(calls).toHaveLength(0)
  })

  it('graphs() and update() are unsupported — the observatory dashboard never lists or writes', async () => {
    const rest = new HostedViewerRestClient({
      gatewayBaseUrl: 'https://api.canary.sophia-labs.com',
      owner: 'user:owner-1',
      auth: new MutableAuth('tok-1'),
    })
    await expect(rest.graphs()).rejects.toThrow(/unsupported/)
    await expect(rest.update('observatory', 'INSERT DATA { }')).rejects.toThrow(/unsupported/)
  })
})
