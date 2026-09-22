import { describe, expect, it, vi } from 'vitest'
import type { AuthProvider } from '@shrubbery/nucleus'
import {
  createHostedGatewayContract,
} from '../hosted-gateway-contract.js'
import {
  GatewayHttpError,
  GatewayMcpError,
  GatewayTransport,
  gatewayGraphBaseUrl,
  normalizeGatewayBaseUrl,
} from '../gateway-transport.js'
import { createSessionStore } from '../session-store.js'
import {
  createCognitoAuthSession,
  type AuthStorage,
} from '../cognito-auth-session.js'
import {
  MemoryDocumentActivationStorage,
  documentActivationKey,
  type DocumentActivationKey,
} from '../document-activation.js'
import {
  loadSidebarSections,
  sidebarDocumentListSparql,
} from '../sidebar-documents.js'

class MutableAuth implements AuthProvider {
  private readonly listeners = new Set<() => void>()
  readyCalls = 0

  constructor(
    private currentToken: string | undefined = 'id-token-1',
    private currentUser = 'user-1',
  ) {}

  token(): string | undefined { return this.currentToken }
  userId(): string { return this.currentUser }
  isAuthenticated(): boolean { return Boolean(this.currentToken) }
  async whenReady(): Promise<void> { this.readyCalls++ }
  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  rotate(token: string | undefined, userId = this.currentUser): void {
    this.currentToken = token
    this.currentUser = userId
    for (const listener of this.listeners) listener()
  }
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
    const body = response.status === 204
      ? null
      : response.raw ?? JSON.stringify(response.body ?? null)
    return new Response(body, {
      status: response.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

function mcpResult(body: unknown): unknown {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text: JSON.stringify(body) }] },
  }
}

function requestBody(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>
}

class MemoryStorage implements AuthStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

function encoded(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('GatewayTransport', () => {
  it('normalizes the root and builds encoded graph routes without losing a base path', () => {
    expect(normalizeGatewayBaseUrl(' https://gateway.test/root/// ')).toBe('https://gateway.test/root')
    expect(gatewayGraphBaseUrl('https://gateway.test/root/', 'graph / one')).toBe(
      'https://gateway.test/root/g/graph%20%2F%20one',
    )
    expect(gatewayGraphBaseUrl('https://gateway.test/root/', 'graph / one', 'user:owner / one')).toBe(
      'https://gateway.test/root/o/user%3Aowner%20%2F%20one/g/graph%20%2F%20one',
    )
    expect(() => normalizeGatewayBaseUrl('/relative')).toThrow('absolute http(s) URL')
    expect(() => gatewayGraphBaseUrl('https://gateway.test', ' ')).toThrow('must not be empty')
  })

  it('uses gateway-root GET /graphs and resolves the bearer again for every request', async () => {
    const auth = new MutableAuth()
    const network = fetchQueue(
      { body: [{ owner: 'user:owner-1', graphId: 'alpha', title: 'Alpha', lifecycleState: 'active', role: 'owner' }] },
      { body: { items: [{ owner: 'user:owner-2', graphId: 'beta', title: 'Beta', lifecycleState: 'repairing', role: 'viewer' }] } },
    )
    const transport = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test/',
      auth,
      fetch: network.fetch,
    })

    await expect(transport.graphs()).resolves.toEqual([
      { owner: 'user:owner-1', graphId: 'alpha', title: 'Alpha', cellState: 'running', lifecycleState: 'active', role: 'owner' },
    ])
    expect(transport.graphBaseUrl('alpha')).toBe('https://gateway.test/o/user%3Aowner-1/g/alpha')
    auth.rotate('id-token-2')
    await expect(transport.graphs()).resolves.toEqual([
      { owner: 'user:owner-2', graphId: 'beta', title: 'Beta', cellState: 'stopped', lifecycleState: 'repairing', role: 'viewer' },
    ])
    expect(transport.graphBaseUrl('beta')).toBe('https://gateway.test/o/user%3Aowner-2/g/beta')

    expect(network.calls.map(call => call.url)).toEqual([
      'https://gateway.test/graphs',
      'https://gateway.test/graphs',
    ])
    expect(new Headers(network.calls[0].init.headers).get('Authorization')).toBe('Bearer id-token-1')
    expect(new Headers(network.calls[1].init.headers).get('Authorization')).toBe('Bearer id-token-2')
    expect(auth.readyCalls).toBe(2)
  })

  it('fails closed when one local graph id is visible under multiple owners', async () => {
    const network = fetchQueue({ body: [
      { owner: 'user:owner-a', graphId: 'notes', title: 'A', lifecycleState: 'active', role: 'viewer' },
      { owner: 'user:owner-b', graphId: 'notes', title: 'B', lifecycleState: 'active', role: 'editor' },
      { owner: 'user:owner-c', graphId: 'notes', title: 'C', lifecycleState: 'active', role: 'viewer' },
    ] })
    const transport = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new MutableAuth(),
      fetch: network.fetch,
    })

    await expect(transport.graphs()).resolves.toHaveLength(3)
    expect(() => transport.graphBaseUrl('notes')).toThrow("ambiguous across owners")
  })

  it('waits for a cold owner-scoped cell and replays the identical MCP request', async () => {
    const network = fetchQueue(
      { body: [{
        owner: 'user:owner-1', graphId: 'observatory', title: 'Observatory',
        lifecycleState: 'active', role: 'owner',
      }] },
      { status: 202, body: {
        code: 'graph_activating',
        activationId: 'cell-observatory-1',
        pollUrl: '/activations/cell-observatory-1',
        eventsUrl: '/activations/cell-observatory-1/events',
      } },
      { body: {
        activationId: 'cell-observatory-1', phase: 'hydrating', error: null,
      } },
      { body: {
        activationId: 'cell-observatory-1', phase: 'ready', error: null,
      } },
      { body: mcpResult({ data: '<urn:s> <urn:p> <urn:o> .' }) },
    )
    const transport = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new MutableAuth('cold-open-token'),
      fetch: network.fetch,
      activationPollIntervalMs: 0,
    })

    await transport.graphs()
    await expect(transport.toolsCall('observatory', 'rdf_dump', {
      graphId: 'observatory', format: 'application/n-triples',
    })).resolves.toMatchObject({ content: expect.any(Array) })

    expect(network.calls.map(call => [call.init.method, call.url])).toEqual([
      ['GET', 'https://gateway.test/graphs'],
      ['POST', 'https://gateway.test/o/user%3Aowner-1/g/observatory/mcp'],
      ['GET', 'https://gateway.test/activations/cell-observatory-1'],
      ['GET', 'https://gateway.test/activations/cell-observatory-1'],
      ['POST', 'https://gateway.test/o/user%3Aowner-1/g/observatory/mcp'],
    ])
    expect(requestBody(network.calls[1])).toEqual(requestBody(network.calls[4]))
    expect(network.calls.every(call => (
      new Headers(call.init.headers).get('Authorization') === 'Bearer cold-open-token'
    ))).toBe(true)
  })

  it('reports failed activation and rejects cross-origin activation polling', async () => {
    const failedNetwork = fetchQueue(
      { status: 202, body: {
        code: 'graph_activating', activationId: 'cell-failed',
        pollUrl: '/activations/cell-failed',
      } },
      { body: {
        activationId: 'cell-failed', phase: 'failed', error: 'durable hydrate failed',
      } },
    )
    const failed = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new MutableAuth(),
      fetch: failedNetwork.fetch,
      activationPollIntervalMs: 0,
    })
    await expect(failed.toolsCall('g', 'rdf_dump', { graphId: 'g' })).rejects.toThrow(
      "Gateway activation 'cell-failed' failed: durable hydrate failed",
    )

    const unsafeNetwork = fetchQueue({ status: 202, body: {
      code: 'graph_activating', activationId: 'cell-unsafe',
      pollUrl: 'https://attacker.test/activations/cell-unsafe',
    } })
    const unsafe = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new MutableAuth(),
      fetch: unsafeNetwork.fetch,
    })
    await expect(unsafe.toolsCall('g', 'rdf_dump', { graphId: 'g' })).rejects.toThrow(
      "Gateway activation 'cell-unsafe' returned an unsafe poll URL",
    )
    expect(unsafeNetwork.calls).toHaveLength(1)
  })

  it('creates and owner-deletes workspaces through gateway control-plane routes', async () => {
    const auth = new MutableAuth('owner-token')
    const network = fetchQueue(
      { body: { data: {
        graph_id: 'research-lab',
        title: 'Research Lab',
        graph_incarnation: '11111111-1111-4111-8111-111111111111',
        operation_id: 'offline-create-1',
      } } },
      { status: 204, raw: '' },
      { body: { graphId: 'g-generated', title: 'Generated' } },
    )
    const transport = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test/root/',
      auth,
      fetch: network.fetch,
    })

    await expect(transport.createGraph({
      graphId: ' research-lab ',
      title: ' Research Lab ',
      graphIncarnation: '11111111-1111-4111-8111-111111111111',
      operationId: 'offline-create-1',
    })).resolves.toEqual({
      graphId: 'research-lab',
      title: 'Research Lab',
      graphIncarnation: '11111111-1111-4111-8111-111111111111',
      operationId: 'offline-create-1',
    })
    await expect(transport.deleteGraph(' research/lab ', {
      expectedGraphIncarnation: '11111111-1111-4111-8111-111111111111',
      operationId: 'offline-delete-1',
    })).resolves.toBeUndefined()
    await expect(transport.createGraph()).resolves.toEqual({
      graphId: 'g-generated',
      title: 'Generated',
    })

    expect(network.calls.map(call => [call.init.method, call.url])).toEqual([
      ['POST', 'https://gateway.test/root/graphs'],
      [
        'DELETE',
        'https://gateway.test/root/graphs/research%2Flab?expectedGraphIncarnation=11111111-1111-4111-8111-111111111111&operationId=offline-delete-1',
      ],
      ['POST', 'https://gateway.test/root/graphs'],
    ])
    expect(requestBody(network.calls[0])).toEqual({
      graphId: 'research-lab',
      title: 'Research Lab',
      graphIncarnation: '11111111-1111-4111-8111-111111111111',
      operationId: 'offline-create-1',
    })
    expect(requestBody(network.calls[2])).toEqual({})
    expect(new Headers(network.calls[1].init.headers).get('Authorization')).toBe('Bearer owner-token')
    await expect(transport.deleteGraph('  ')).rejects.toThrow('graph id must not be empty')
  })

  it('manages an account-scoped OpenRouter credential without reflecting the secret', async () => {
    const auth = new MutableAuth('credential-token')
    const network = fetchQueue(
      { body: { provider: 'openrouter', configured: true, effectiveSource: 'user' } },
      { status: 204, raw: '' },
      { status: 204, raw: '' },
    )
    const transport = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test/root',
      auth,
      fetch: network.fetch,
    })

    const status = await transport.providerCredentialStatus('openrouter')
    expect(status).toEqual({
      provider: 'openrouter', configured: true, effectiveSource: 'user',
    })
    await expect(transport.putProviderCredential('openrouter', 'sentinel-provider-secret')).resolves.toBeUndefined()
    await expect(transport.deleteProviderCredential('openrouter')).resolves.toBeUndefined()

    expect(network.calls.map(call => [call.init.method, call.url])).toEqual([
      ['GET', 'https://gateway.test/root/me/provider-credentials/openrouter'],
      ['PUT', 'https://gateway.test/root/me/provider-credentials/openrouter'],
      ['DELETE', 'https://gateway.test/root/me/provider-credentials/openrouter'],
    ])
    expect(network.calls.every(call => call.init.cache === 'no-store')).toBe(true)
    expect(network.calls.every(call => new Headers(call.init.headers).get('Authorization') === 'Bearer credential-token')).toBe(true)
    expect(requestBody(network.calls[1])).toEqual({ apiKey: 'sentinel-provider-secret' })
    expect(JSON.stringify(status)).not.toContain('sentinel-provider-secret')

    const unused = fetchQueue({ status: 204, raw: '' })
    const empty = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test',
      auth,
      fetch: unused.fetch,
    })
    await expect(empty.putProviderCredential('openrouter', '  ')).rejects.toThrow('must not be empty')
    expect(unused.calls).toHaveLength(0)
  })

  it('rejects malformed provider-credential status instead of inventing availability', async () => {
    const network = fetchQueue({ body: { provider: 'openrouter', configured: 'yes', effectiveSource: 'user' } })
    const transport = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new MutableAuth(),
      fetch: network.fetch,
    })
    await expect(transport.providerCredentialStatus('openrouter')).rejects.toThrow('invalid shape')
  })

  it('rejects malformed graph-create responses instead of inventing an id', async () => {
    const network = fetchQueue({ body: { title: 'Missing id' } })
    const transport = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new MutableAuth(),
      fetch: network.fetch,
    })
    await expect(transport.createGraph({ title: 'Missing id' })).rejects.toThrow(
      'returned no graph id',
    )
  })

  it('lists and owner-manages graph access through the Cloud-2 grants routes', async () => {
    const auth = new MutableAuth('owner-token')
    const network = fetchQueue(
      { body: [
        {
          userId: 'owner-1', role: 'owner', grantedAt: '2026-07-10T12:00:00Z', grantedBy: 'owner-1',
          email: 'owner@example.com', displayName: 'Owner',
        },
        {
          userId: 'editor/2', role: 'editor', grantedAt: '2026-07-10T12:01:00Z', grantedBy: 'owner-1',
        },
      ] },
      { body: { graphId: 'graph a', userId: 'viewer 3', role: 'viewer' } },
      { status: 204, raw: '' },
    )
    const transport = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test/root',
      auth,
      fetch: network.fetch,
    })

    await expect(transport.access(' graph a ')).resolves.toEqual([
      {
        userId: 'owner-1', role: 'owner', grantedAt: '2026-07-10T12:00:00Z', grantedBy: 'owner-1',
        email: 'owner@example.com', displayName: 'Owner',
      },
      {
        userId: 'editor/2', role: 'editor', grantedAt: '2026-07-10T12:01:00Z', grantedBy: 'owner-1',
      },
    ])
    await expect(transport.putAccess('graph a', ' viewer 3 ', {
      role: 'viewer',
      email: ' viewer@example.com ',
      displayName: ' Viewer Three ',
    })).resolves.toBeUndefined()
    await expect(transport.deleteAccess('graph a', 'editor/2')).resolves.toBeUndefined()

    expect(network.calls.map(call => [call.init.method, call.url])).toEqual([
      ['GET', 'https://gateway.test/root/graphs/graph%20a/access'],
      ['PUT', 'https://gateway.test/root/graphs/graph%20a/access/viewer%203'],
      ['DELETE', 'https://gateway.test/root/graphs/graph%20a/access/editor%2F2'],
    ])
    expect(requestBody(network.calls[1])).toEqual({
      role: 'viewer', email: 'viewer@example.com', displayName: 'Viewer Three',
    })
    expect(new Headers(network.calls[1].init.headers).get('Authorization')).toBe('Bearer owner-token')
  })

  it('rejects malformed grants and invalid access mutations locally', async () => {
    const network = fetchQueue({ body: [{ userId: 'member', role: 'admin' }] })
    const transport = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new MutableAuth(),
      fetch: network.fetch,
    })
    await expect(transport.access('g')).rejects.toThrow('invalid grant shape')
    await expect(transport.putAccess('g', 'member', { role: 'owner' as never })).rejects.toThrow(
      'role must be viewer or editor',
    )
    await expect(transport.deleteAccess('g', ' ')).rejects.toThrow('user id must not be empty')
  })

  it('rejects unauthenticated, malformed, HTTP-error, and MCP-error responses loudly', async () => {
    const anonymous = new MutableAuth('')
    const unused = fetchQueue({ body: [] })
    await expect(new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test',
      auth: anonymous,
      fetch: unused.fetch,
    }).graphs()).rejects.toThrow('authentication token is unavailable')
    expect(unused.calls).toHaveLength(0)

    const malformed = fetchQueue({ body: [{ graphId: 'x', title: 'X', role: 'owner' }] })
    await expect(new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new MutableAuth(),
      fetch: malformed.fetch,
    }).graphs()).rejects.toThrow('invalid graphId/title/cellState/role shape')

    const denied = fetchQueue({ status: 403, body: { error: 'forbidden' } })
    const deniedTransport = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new MutableAuth(),
      fetch: denied.fetch,
    })
    const httpError = await deniedTransport.graphs().catch(error => error)
    expect(httpError).toBeInstanceOf(GatewayHttpError)
    expect(httpError).toMatchObject({ status: 403, method: 'GET' })

    const mcpFailure = fetchQueue({ body: {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32000, message: 'cell says no', data: { reason: 'acl' } },
    } })
    const mcpTransport = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new MutableAuth(),
      fetch: mcpFailure.fetch,
    })
    const mcpError = await mcpTransport.toolsCall('g', 'sparql_update', {}).catch(error => error)
    expect(mcpError).toBeInstanceOf(GatewayMcpError)
    expect(mcpError).toMatchObject({ tool: 'sparql_update', code: -32000, data: { reason: 'acl' } })

    const invalidMcp = fetchQueue({ body: null }, { body: { jsonrpc: '2.0', id: 1 } })
    const invalidTransport = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new MutableAuth(),
      fetch: invalidMcp.fetch,
    })
    await expect(invalidTransport.toolsCall('g', 'sparql_query', {})).rejects.toThrow(
      'not a JSON-RPC object',
    )
    await expect(invalidTransport.toolsCall('g', 'sparql_query', {})).rejects.toThrow(
      'neither an error nor a result object',
    )
  })
})

describe('HostedGatewayContract', () => {
  it('forwards salience through the graph-prefixed cell route with bearer auth', async () => {
    const graphId = 'graph / one'
    const score = {
      blockId: 'block-1',
      documentId: 'doc / one',
      compositeScore: 0.52,
      userImportance: 3,
      userValence: null,
    }
    const updated = { ...score, userImportance: 5, userValence: 4 }
    const auth = new MutableAuth('salience-token')
    const network = fetchQueue(
      { body: { blocks: [score] } },
      { body: updated },
    )
    const contract = createHostedGatewayContract({
      gatewayBaseUrl: 'https://gateway.test/root',
      auth,
      fetch: network.fetch,
    })

    await expect(contract.salience.getScores(graphId, 'doc / one')).resolves.toEqual([
      expect.objectContaining({ blockId: 'block-1', compositeScore: 0.52, userImportance: 3 }),
    ])
    await expect(contract.salience.setUserValue(graphId, {
      documentId: 'doc / one',
      blockId: 'block-1',
      importance: 5,
      valence: 4,
    })).resolves.toEqual(expect.objectContaining({
      blockId: 'block-1', userImportance: 5, userValence: 4,
    }))

    expect(network.calls.map(call => [call.init.method, call.url])).toEqual([
      [
        'GET',
        'https://gateway.test/root/g/graph%20%2F%20one/salience/graph%20%2F%20one/blocks/values?document_id=doc%20%2F%20one&limit=1000',
      ],
      [
        'PUT',
        'https://gateway.test/root/g/graph%20%2F%20one/salience/graph%20%2F%20one/blocks/user-value',
      ],
    ])
    expect(requestBody(network.calls[1])).toEqual({
      documentId: 'doc / one',
      blockId: 'block-1',
      importance: 5,
      valence: 4,
    })
    expect(network.calls.every(call => (
      new Headers(call.init.headers).get('Authorization') === 'Bearer salience-token'
    ))).toBe(true)
  })

  it('provisions an offline graph and document as cold-queryable Meaningful Objects', async () => {
    const auth = new MutableAuth('offline-token', 'offline-user')
    const documentStorage = new MemoryDocumentActivationStorage()
    const fetch = vi.fn(async () => {
      throw new TypeError('network partition')
    }) as typeof globalThis.fetch
    const contract = createHostedGatewayContract({
      gatewayBaseUrl: 'https://gateway.test',
      auth,
      fetch,
      documentActivationStorage: documentStorage,
    })
    const graphId = 'offline-provisional'
    const graphIncarnation = '11111111-1111-4111-8111-111111111111'
    const documentIncarnation = '22222222-2222-4222-8222-222222222222'
    const lifecycle = await contract.sourceMirror.openGraphLifecycle()
    await lifecycle.enqueueCreate({
      graphId,
      graphIncarnation,
      operationId: 'offline-graph-create',
      title: 'Offline Provisional',
    })
    await contract.sourceMirror.provisionGraph(graphId, graphIncarnation)

    await expect(contract.rest.graphs()).resolves.toEqual([
      expect.objectContaining({
        graphId,
        title: 'Offline Provisional',
        offline: true,
        provisional: true,
      }),
    ])
    await expect(contract.mcp.toolsCall('create_document', {
      graphId,
      documentId: 'offline-doc',
      documentIncarnation,
      operationId: 'offline-document-create',
      title: 'Offline Document',
    })).resolves.toMatchObject({
      structuredContent: {
        success: true,
        graphId,
        sourceQueued: true,
        offline: true,
      },
    })

    const projection = await contract.rest.query(
      graphId,
      sidebarDocumentListSparql(graphId),
    ) as { rows?: Array<Record<string, string>> }
    expect(projection.rows).toEqual([
      expect.objectContaining({ label: '"Offline Document"' }),
    ])
    expect(contract.sourceMirror.manager(graphId).outboxRecords()).toEqual([
      expect.objectContaining({
        status: 'pending',
        operation: expect.objectContaining({
          kind: 'documentLifecycle',
          newDocumentIncarnation: documentIncarnation,
        }),
      }),
      expect.objectContaining({
        status: 'pending',
        operation: expect.objectContaining({
          kind: 'crdtCommand',
          commandKind: 'workspace.updateDocument',
        }),
      }),
    ])
    expect(await documentStorage.get(documentActivationKey({
      userId: 'offline-user',
      graphId,
      documentId: 'offline-doc',
    }))).toMatchObject({
      authority: 'snapshot',
      incarnation: documentIncarnation,
    })

    await expect(contract.mcp.toolsCall('rename', {
      graphId,
      entityType: 'document',
      entityId: 'offline-doc',
      newName: 'Offline Renamed Document',
      operationId: 'offline-document-rename',
    })).resolves.toMatchObject({
      structuredContent: {
        success: true,
        graphId,
        sourceQueued: true,
        offline: true,
      },
    })
    await expect(contract.rest.query(
      graphId,
      sidebarDocumentListSparql(graphId),
    )).resolves.toMatchObject({
      rows: [expect.objectContaining({ label: '"Offline Renamed Document"' })],
    })
    await expect(loadSidebarSections(
      contract.rest,
      graphId,
      'offline-doc',
    )).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'documents',
        nodes: [expect.objectContaining({
          id: 'offline-doc',
          label: 'Offline Renamed Document',
        })],
      }),
    ]))

    await expect(contract.mcp.toolsCall('source_push', {
      graphId,
      graphIncarnation,
      operations: [{
        kind: 'currentState',
        operationId: 'offline-current-state',
        vocab: 'emporium-bookmark',
        class: 'Bookmark',
        objectId: 'offline-bookmark',
        baseVersion: 'root',
        record: {
          kind: 'Bookmark',
          localId: 'offline-bookmark',
          title: 'Offline source object',
          url: 'https://offline.test/source-object',
        },
      }],
    })).resolves.toMatchObject({
      structuredContent: {
        ok: true,
        offline: true,
        localAccepted: true,
        receipts: [{
          operationId: 'offline-current-state',
          status: 'accepted',
          outcome: { outcome: 'locally-queued' },
        }],
      },
    })
    await expect(contract.mcp.toolsCall('source_pull', {
      graphId,
      graphIncarnation,
    })).resolves.toMatchObject({
      structuredContent: {
        graphId,
        graphIncarnation,
        localPendingOperations: expect.arrayContaining([
          expect.objectContaining({
            kind: 'currentState',
            operationId: 'offline-current-state',
          }),
        ]),
      },
    })
    await expect(contract.mcp.toolsCall('source_push', {
      graphId,
      graphIncarnation,
      operations: [{
        kind: 'currentState',
        operationId: 'offline-current-state',
        vocab: 'emporium-bookmark',
        class: 'Bookmark',
        objectId: 'offline-bookmark',
        baseVersion: 'root',
        record: {
          kind: 'Bookmark',
          localId: 'offline-bookmark',
          title: 'Offline source object',
          url: 'https://offline.test/source-object',
        },
      }],
    })).resolves.toMatchObject({
      structuredContent: {
        receipts: [{ operationId: 'offline-current-state', duplicate: true }],
      },
    })

    await lifecycle.enqueueDelete({
      graphId,
      graphIncarnation,
      operationId: 'offline-graph-delete',
    })
    await expect(contract.rest.graphs()).resolves.toEqual([])
    await expect(contract.rest.query(
      graphId,
      sidebarDocumentListSparql(graphId),
    )).rejects.toThrow('network partition')
  })

  it('clears the previous user document cache when auth logs out or changes identity', async () => {
    const auth = new MutableAuth('token-a', 'user-a')
    const storage = new MemoryDocumentActivationStorage()
    const key: DocumentActivationKey = {
      userId: 'user-a',
      graphId: 'graph-a',
      documentId: 'doc-a',
    }
    await storage.put({
      ...key,
      key: documentActivationKey(key),
      schemaVersion: 1,
      update: new Uint8Array([0, 0]),
      savedAt: 1,
      authority: 'live',
      incarnation: 'incarnation-a',
    })
    const contract = createHostedGatewayContract({
      gatewayBaseUrl: 'https://gateway.test',
      auth,
      fetch: fetchQueue().fetch,
      documentActivationStorage: storage,
    })
    contract.documentActivation.rememberNavigation(key)

    auth.rotate(undefined, 'signed-out')
    await vi.waitFor(async () => {
      expect(await storage.get(documentActivationKey(key))).toBeUndefined()
    })
    expect(contract.documentActivation.readNavigation('user-a')).toBeNull()
  })

  it('does not clear a fabricated empty user when an anonymous session first authenticates', async () => {
    const auth = new MutableAuth(undefined, '')
    const storage = new MemoryDocumentActivationStorage()
    const clearUser = vi.spyOn(storage, 'clearUser')
    const contract = createHostedGatewayContract({
      gatewayBaseUrl: 'https://gateway.test',
      auth,
      fetch: fetchQueue().fetch,
      documentActivationStorage: storage,
    })

    auth.rotate('id-token', 'cognito-user')
    await Promise.resolve()

    expect(contract.auth.userId()).toBe('cognito-user')
    expect(clearUser).not.toHaveBeenCalled()
  })

  it('uses the concrete CognitoAuthSession ID token as the gateway bearer', async () => {
    const storage = new MemoryStorage()
    const idToken = `${encoded({ alg: 'none' })}.${encoded({ sub: 'cognito-user', exp: 5000 })}.signature`
    storage.setItem('shrubbery.cognito.tokens.v1', JSON.stringify({
      accessToken: 'access-token-must-not-be-sent',
      idToken,
      refreshToken: 'refresh-token',
      expiresAt: 5_000_000,
    }))
    const auth = createCognitoAuthSession({
      config: { region: 'us-west-1', clientId: 'client-id' },
      storage,
      now: () => 1_000_000,
      fetch: async () => { throw new Error('valid restore must not call Cognito') },
    })
    await auth.whenReady()
    const network = fetchQueue({ body: [] })
    const contract = createHostedGatewayContract({
      gatewayBaseUrl: 'https://gateway.test',
      auth,
      fetch: network.fetch,
    })

    await expect(contract.rest.graphs()).resolves.toEqual([])
    expect(new Headers(network.calls[0].init.headers).get('Authorization')).toBe(`Bearer ${idToken}`)
    expect(contract.auth.userId()).toBe('cognito-user')
  })

  it('assembles hosted runtime/UI/auth and routes every graph operation through the catalog-bound owner cell', async () => {
    const auth = new MutableAuth()
    const presenter = vi.fn(() => true)
    const network = fetchQueue(
      { body: [{ owner: 'user:owner-1', graphId: 'g one', title: 'One', lifecycleState: 'active', role: 'editor' }] },
      { body: mcpResult({ rows: [{ s: '<urn:s>' }] }) },
      { body: mcpResult({ success: true }) },
      { body: mcpResult({ data: '<urn:s> <urn:p> <urn:o> .', format: 'application/n-triples' }) },
      { body: mcpResult({ data: '', format: 'application/n-triples' }) },
      { body: mcpResult({ wires: [{ wireId: 'server-wire' }] }) },
      { body: mcpResult({ success: true }) },
      { body: mcpResult({ success: true }) },
    )
    const contract = createHostedGatewayContract({
      gatewayBaseUrl: 'https://gateway.test/',
      auth,
      fetch: network.fetch,
      confirmPresenter: presenter,
    })

    expect(contract.auth).toBe(auth)
    expect(contract.runtime.mode()).toBe('hosted')
    expect(contract.runtime.isGateway()).toBe(true)
    expect(contract.runtime.graphBaseUrl('g one')).toBe('https://gateway.test/g/g%20one')
    expect(contract.ui.presenceColors).toHaveLength(10)
    await expect(contract.ui.confirm({ message: 'Continue?' })).resolves.toBe(true)
    expect(presenter).toHaveBeenCalledWith({ message: 'Continue?' })
    expect(contract.wireMode.view().isActive).toBe(false)
    const session = createSessionStore({ contract, graphId: 'g one' })
    expect(session.contract).toBe(contract)
    expect(session.graphId).toBe('g one')

    await expect(contract.rest.graphs()).resolves.toHaveLength(1)
    expect(contract.runtime.graphBaseUrl('g one')).toBe(
      'https://gateway.test/o/user%3Aowner-1/g/g%20one',
    )
    await expect(contract.restConcrete.query('g one', 'SELECT * WHERE {}')).resolves.toEqual({
      rows: [{ s: '<urn:s>' }],
    })
    await expect(contract.restConcrete.update('g one', 'INSERT DATA {}')).resolves.toBeUndefined()
    await expect(contract.restConcrete.dumpUxConfig('g one')).resolves.toMatchObject({ data: '<urn:s> <urn:p> <urn:o> .' })
    await expect(contract.restConcrete.dumpUxControl('g one')).resolves.toMatchObject({ data: '' })
    await expect(contract.wire.create('g one', {
      sourceDocumentId: 'source',
      targetDocumentId: 'target',
      targetGraphId: 'other',
      sourceBlockId: 'source-block',
      targetBlockId: 'target-block',
      predicate: 'supports',
      bidirectional: true,
    })).resolves.toEqual({ wireId: 'server-wire' })
    await expect(contract.wire.delete('g one', 'server-wire')).resolves.toBeUndefined()
    await expect(contract.mcp.toolsCall('rdf_load', {
      graphId: 'g one',
      data: '<urn:s> <urn:p> <urn:o> .',
    })).resolves.toMatchObject({ content: expect.any(Array) })

    expect(network.calls[0].url).toBe('https://gateway.test/graphs')
    expect(network.calls.slice(1).every(call => (
      call.url === 'https://gateway.test/o/user%3Aowner-1/g/g%20one/mcp'
    ))).toBe(true)
    expect(network.calls.slice(1).map(call => {
      const params = requestBody(call).params as { name: string }
      return params.name
    })).toEqual([
      'sparql_query',
      'sparql_update',
      'rdf_dump',
      'rdf_dump',
      'create_wires',
      'delete',
      'rdf_load',
    ])

    const createParams = (requestBody(network.calls[5]).params as {
      arguments: { graphId: string; wires: Array<Record<string, unknown>> }
    }).arguments
    expect(createParams).toEqual({
      graphId: 'g one',
      wires: [{
        sourceDocumentId: 'source',
        targetDocumentId: 'target',
        targetGraphId: 'other',
        sourceBlockId: 'source-block',
        targetBlockId: 'target-block',
        predicate: 'supports',
        bidirectional: true,
      }],
    })
  })

  it('keeps a caller-minted wire id authoritative even if the cell echoes another id', async () => {
    const network = fetchQueue({ body: mcpResult({ wires: [{ wireId: 'server-other' }] }) })
    const contract = createHostedGatewayContract({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new MutableAuth(),
      fetch: network.fetch,
    })
    await expect(contract.wire.create('g', {
      sourceDocumentId: 'source',
      targetDocumentId: 'target',
      wireId: 'caller-wire',
    })).resolves.toEqual({ wireId: 'caller-wire' })
    const args = (requestBody(network.calls[0]).params as {
      arguments: { wires: Array<Record<string, unknown>> }
    }).arguments
    expect(args.wires[0].wireId).toBe('caller-wire')
  })

  it('requires graph scoping on the structural MCP shell adapter', async () => {
    const contract = createHostedGatewayContract({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new MutableAuth(),
      fetch: fetchQueue().fetch,
    })
    await expect(contract.mcp.toolsCall('rdf_load', {})).rejects.toThrow('graphId is required')
  })
})
