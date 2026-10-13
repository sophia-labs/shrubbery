import { describe, expect, it, vi } from 'vitest'
import type { AuthProvider } from '@shrubbery/nucleus/contract'
import {
  ApiKeyError,
  isValidApiKeyIdempotencyKey,
  validateApiKeyCreateRequest,
  type ApiKeyCreateRequest,
  type ApiKeyMetadata,
} from '../api-key-contract.js'
import { GatewayApiKeyClient } from '../api-key-client.js'
import { ApiKeyStore } from '../api-key-store.js'
import { GatewayTransport } from '../gateway-transport.js'

class Auth implements AuthProvider {
  tokenValue: string | undefined = 'fresh-token-1'
  token(): string | undefined { return this.tokenValue }
  userId(): string { return 'cognito-subject' }
  isAuthenticated(): boolean { return Boolean(this.tokenValue) }
  async whenReady(): Promise<void> {}
  onChange(): () => void { return () => undefined }
}

const metadata = (keyId = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'): ApiKeyMetadata => ({
  keyId,
  displayLabel: 'Local automation',
  createdAtUnixSeconds: 1_800_000_000,
  expiresAtUnixSeconds: 1_900_000_000,
  lastUsedAtUnixSeconds: null,
  lastUsedOutcome: null,
  status: 'active',
  scopes: ['graphs.read'],
  graphAllowlist: [{ owner: 'user:alice', graphId: 'research' }],
  credentialVersion: 1,
  terminalAtUnixSeconds: null,
})
const request: ApiKeyCreateRequest = {
  displayLabel: ' Local automation ',
  expiresAtUnixSeconds: 1_900_000_000,
  scopes: ['graphs.read'],
  graphAllowlist: [{ owner: 'user:alice', graphId: 'research' }],
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

function headers(init: RequestInit | undefined): Headers { return new Headers(init?.headers) }

describe('D3 API-key root client', () => {
  it('does not restore a late creation secret after leaving Settings', async () => {
    let complete!: (value: { apiKey: ApiKeyMetadata; secret: string; replayed: boolean }) => void
    const client = {
      async list() { return [] },
      create: () => new Promise<{ apiKey: ApiKeyMetadata; secret: string; replayed: boolean }>(resolve => { complete = resolve }),
      async remove() { return { apiKey: metadata(), deleted: true, revocationEpoch: 1 } },
    }
    const store = new ApiKeyStore(client)
    const pending = store.create(request)
    store.discardOneTimeSecret()
    complete({ apiKey: metadata(), secret: 'fixture-secret', replayed: false })
    await pending
    expect(store.snapshot().apiKeys).toHaveLength(1)
    expect(store.snapshot().oneTimeSecret).toBeNull()
  })
  it('uses only fresh-token root GET/POST/DELETE management paths', async () => {
    const auth = new Auth()
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      if (calls.length === 1) return response({ apiKeys: [metadata()] })
      if (calls.length === 2) return response({ apiKey: metadata(), secret: 'sph_ak1_one_time_value', replayed: false })
      return response({ apiKey: { ...metadata(), status: 'deleted', terminalAtUnixSeconds: 1_800_000_001 }, deleted: true, revocationEpoch: 9 })
    }) as typeof globalThis.fetch
    const client = new GatewayApiKeyClient(new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.example.test/g/poison?ignored=true', auth, fetch,
    }))

    await expect(client.list()).resolves.toEqual([metadata()])
    auth.tokenValue = 'fresh-token-2'
    await expect(client.create(request, 'api-key-create-1')).resolves.toMatchObject({ secret: 'sph_ak1_one_time_value', replayed: false })
    auth.tokenValue = 'fresh-token-3'
    await expect(client.remove(metadata().keyId)).resolves.toMatchObject({ deleted: true, revocationEpoch: 9 })

    expect(calls.map(call => new URL(call.url).pathname)).toEqual([
      '/me/api-keys', '/me/api-keys', `/me/api-keys/${metadata().keyId}`,
    ])
    expect(calls.map(call => call.url)).not.toContain(expect.stringContaining('/g/poison'))
    expect(headers(calls[0]?.init).get('authorization')).toBe('Bearer fresh-token-1')
    expect(headers(calls[1]?.init).get('authorization')).toBe('Bearer fresh-token-2')
    expect(headers(calls[2]?.init).get('authorization')).toBe('Bearer fresh-token-3')
    expect(headers(calls[1]?.init).get('idempotency-key')).toBe('api-key-create-1')
    expect(calls.every(call => call.init?.cache === 'no-store')).toBe(true)
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ ...request, displayLabel: 'Local automation' })
  })

  it('supports explicit global selection without widening legacy or empty selected requests', async () => {
    const global = { ...request, graphAccess: 'all_accessible' as const, graphAllowlist: [] }
    expect(validateApiKeyCreateRequest(global)).toEqual({ ...global, displayLabel: 'Local automation' })
    for (const invalid of [
      { ...request, graphAllowlist: [] },
      { ...global, graphAccess: 'selected' },
      { ...global, graphAccess: '*' },
      { ...global, graphAccess: null },
      { ...global, graphAllowlist: request.graphAllowlist },
    ]) expect(() => validateApiKeyCreateRequest(invalid as never)).toThrow(ApiKeyError)
    const globalMetadata = { ...metadata('ZYXWVUTSRQPONMLKJIHGFEDCBA'), graphAccess: 'all_accessible' as const, graphAllowlist: [] }
    const client = new GatewayApiKeyClient(new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.example.test', auth: new Auth(),
      fetch: (async () => response({ apiKeys: [metadata(), globalMetadata] })) as typeof globalThis.fetch,
    }))
    await expect(client.list()).resolves.toEqual([metadata(), globalMetadata])
    for (const invalid of [
      { ...globalMetadata, graphAccess: null },
      { ...globalMetadata, graphAccess: 'future-mode' },
      { ...globalMetadata, graphAccess: 'selected' },
      { ...globalMetadata, graphAllowlist: request.graphAllowlist },
    ]) {
      const bad = new GatewayApiKeyClient(new GatewayTransport({
        gatewayBaseUrl: 'https://gateway.example.test', auth: new Auth(),
        fetch: (async () => response({ apiKeys: [invalid] })) as typeof globalThis.fetch,
      }))
      await expect(bad.list()).rejects.toMatchObject({ code: 'invalid_json' })
    }
  })

  it('preflights exact v1 scopes and GraphKeys with no wildcards or reserved transports', () => {
    expect(isValidApiKeyIdempotencyKey('a._~-Z9')).toBe(true)
    expect(isValidApiKeyIdempotencyKey('x'.repeat(128))).toBe(true)
    expect(isValidApiKeyIdempotencyKey('with space')).toBe(false)
    expect(validateApiKeyCreateRequest(request)).toMatchObject({ displayLabel: 'Local automation' })
    expect(validateApiKeyCreateRequest({ ...request, scopes: ['mcp.read', 'mcp.write'] }).scopes).toEqual(['mcp.read', 'mcp.write'])
    for (const bad of [
      { ...request, scopes: ['graphs.sync'] as never },
      { ...request, scopes: ['mcp.write'] },
      { ...request, scopes: ['graphs.read', 'graphs.read'] },
      { ...request, graphAllowlist: [{ owner: 'user:*', graphId: 'research' }] },
      { ...request, graphAllowlist: [{ owner: 'user:alice', graphId: '*' }] },
      { ...request, graphAllowlist: [{ owner: 'user:alice', graphId: 'research' }, { owner: 'user:alice', graphId: 'research' }] },
    ]) {
      expect(() => validateApiKeyCreateRequest(bad as ApiKeyCreateRequest)).toThrow(ApiKeyError)
    }
  })

  it('redacts response bodies in errors and treats replayed creation as secret-unavailable', async () => {
    const errorClient = new GatewayApiKeyClient(new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.example.test', auth: new Auth(),
      fetch: vi.fn(async () => response({ code: 'api_key_quota_exceeded', secret: 'never-log-me' }, 409)) as typeof fetch,
    }))
    await errorClient.list().catch(error => {
      expect(error).toMatchObject({ code: 'api_key_quota_exceeded', status: 409 })
      expect(String(error)).not.toContain('never-log-me')
    })

    const client = {
      async list() { return [] as readonly ApiKeyMetadata[] },
      async create() { return { apiKey: metadata(), secret: null, replayed: true } },
      async remove() { return { apiKey: metadata(), deleted: true, revocationEpoch: 1 } },
    }
    const store = new ApiKeyStore(client)
    await store.create(request)
    expect(store.snapshot()).toMatchObject({ code: 'one_time_secret_unavailable', oneTimeSecret: null, replayedCreate: true })
  })

  it('fails closed on unknown or duplicate fields in every successful response envelope', async () => {
    const canonicalMetadata = JSON.stringify(metadata())
    const mutations: Array<{ operation: 'list' | 'create' | 'delete'; raw: string }> = [
      { operation: 'list', raw: `{"apiKeys":[],"unknown":true}` },
      { operation: 'list', raw: `{"apiKeys":[],"apiKeys":[]}` },
      { operation: 'create', raw: `{"apiKey":${canonicalMetadata},"secret":null,"replayed":true,"unknown":true}` },
      { operation: 'create', raw: `{"apiKey":${canonicalMetadata},"secret":null,"secret":null,"replayed":true}` },
      { operation: 'delete', raw: `{"apiKey":${canonicalMetadata},"deleted":true,"revocationEpoch":1,"unknown":true}` },
      { operation: 'delete', raw: `{"apiKey":${canonicalMetadata},"deleted":true,"deleted":false,"revocationEpoch":1}` },
      { operation: 'list', raw: `{"apiKeys":[${canonicalMetadata.replace('"graphId":"research"', '"graphId":"research","unknown":true')} ]}` },
      { operation: 'list', raw: `{"apiKeys":[${canonicalMetadata.replace('"status":"active"', '"status":"active","status":"revoked"')}]}` },
      { operation: 'list', raw: `{"apiKeys":[${canonicalMetadata.replace('"graphId":"research"', '"graphId":"research","graphId":"other"')}]}` },
    ]
    for (const mutation of mutations) {
      const client = new GatewayApiKeyClient(new GatewayTransport({
        gatewayBaseUrl: 'https://gateway.example.test',
        auth: new Auth(),
        fetch: vi.fn(async () => new Response(mutation.raw, {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch,
      }))
      const operation = mutation.operation === 'list'
        ? client.list()
        : mutation.operation === 'create'
          ? client.create(request, 'closed-response-1')
          : client.remove(metadata().keyId)
      await expect(operation).rejects.toMatchObject({ code: 'invalid_json', status: 502 })
    }
  })

  it('keeps a generated secret out of serializable store state and retries the exact creation', async () => {
    const creates: Array<{ body: ApiKeyCreateRequest; idempotencyKey: string }> = []
    let fail = true
    const client = {
      async list() { return [] as readonly ApiKeyMetadata[] },
      async create(body: ApiKeyCreateRequest, idempotencyKey: string) {
        creates.push({ body, idempotencyKey })
        if (fail) {
          fail = false
          throw new ApiKeyError('api_key_authority_unavailable', 503)
        }
        return { apiKey: metadata(), secret: 'sph_ak1_in_memory_only', replayed: false }
      },
      async remove() { return { apiKey: metadata(), deleted: true, revocationEpoch: 1 } },
    }
    const store = new ApiKeyStore(client)
    await expect(store.create(request)).rejects.toMatchObject({ code: 'api_key_authority_unavailable' })
    await store.retryCreate()
    expect(creates).toHaveLength(2)
    expect(creates[1]?.idempotencyKey).toBe(creates[0]?.idempotencyKey)
    expect(creates[1]?.body).toEqual(creates[0]?.body)
    expect(JSON.stringify(store.snapshot())).not.toContain('sph_ak1_in_memory_only')
    expect(String(store.snapshot().oneTimeSecret)).toContain('REDACTED')
    store.acknowledgeSecret()
    expect(store.snapshot().oneTimeSecret).toBeNull()
  })
})
