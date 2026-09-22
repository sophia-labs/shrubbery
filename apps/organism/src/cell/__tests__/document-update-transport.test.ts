import { describe, expect, it, vi } from 'vitest'
import type { AuthProvider } from '@shrubbery/nucleus'
import {
  LoopbackMcpClient,
} from '../loopback-mcp.js'
import {
  GatewayTransport,
} from '../gateway-transport.js'

class Auth implements AuthProvider {
  token(): string { return 'token-a' }
  userId(): string { return 'user-a' }
  isAuthenticated(): boolean { return true }
  whenReady(): Promise<void> { return Promise.resolve() }
  onChange(): () => void { return () => {} }
}

describe('document snapshot transports', () => {
  it('reads the advertised MCP tool contracts without calling a tool', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: [{
            name: 'emporium_write',
            description: 'write objects',
            inputSchema: {
              type: 'object',
              properties: { records: { type: 'array' } },
            },
          }],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    const client = new LoopbackMcpClient({
      mcpUrl: '/cell/mcp',
      healthUrl: '/cell/health',
      transport: 'fetch',
      fetch,
    })

    await expect(client.toolsList()).resolves.toEqual([{
      name: 'emporium_write',
      description: 'write objects',
      inputSchema: {
        type: 'object',
        properties: { records: { type: 'array' } },
      },
    }])
    const request = fetch.mock.calls[0]?.[1]
    expect(JSON.parse(String(request?.body))).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/list',
      params: {},
    })
  })

  it('reads binary updates through the same-origin loopback proxy with AbortSignal', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'x-document-incarnation': 'incarnation-loopback' },
      }))
    const client = new LoopbackMcpClient({
      mcpUrl: '/cell/mcp',
      healthUrl: '/cell/health',
      transport: 'fetch',
      fetch,
    })
    const controller = new AbortController()

    await expect(client.documentSnapshot('g one', 'doc/one', {
      signal: controller.signal,
    })).resolves.toEqual({
      update: new Uint8Array([1, 2, 3]),
      incarnation: 'incarnation-loopback',
    })
    expect(fetch).toHaveBeenCalledWith('/cell/documents/g%20one/doc%2Fone/blob', expect.objectContaining({
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    }))
  })

  it('reads an identity-fenced loopback workspace snapshot', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(new Uint8Array([4, 5, 6]), {
        status: 200,
        headers: { 'x-graph-incarnation': 'graph-incarnation-loopback' },
      }))
    const client = new LoopbackMcpClient({
      mcpUrl: '/cell/mcp',
      healthUrl: '/cell/health',
      transport: 'fetch',
      fetch,
    })

    await expect(client.workspaceSnapshot('g one')).resolves.toEqual({
      update: new Uint8Array([4, 5, 6]),
      incarnation: 'graph-incarnation-loopback',
    })
    expect(fetch).toHaveBeenCalledWith(
      '/cell/documents/g%20one/workspace/blob',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    )
  })

  it('refuses to call an unfenced workspace response authoritative', async () => {
    const client = new LoopbackMcpClient({
      mcpUrl: '/cell/mcp',
      healthUrl: '/cell/health',
      transport: 'fetch',
      fetch: async () => new Response(new Uint8Array([1]), { status: 200 }),
    })
    await expect(client.workspaceSnapshot('g')).rejects.toMatchObject({
      name: 'LoopbackHttpError',
      status: 502,
    })
  })

  it('preserves loopback 404 as a typed cache miss', async () => {
    const client = new LoopbackMcpClient({
      mcpUrl: '/cell/mcp',
      healthUrl: '/cell/health',
      transport: 'fetch',
      fetch: async () => new Response('not materialized', { status: 404 }),
    })
    await expect(client.documentUpdate('g', 'new-doc')).rejects.toMatchObject({
      name: 'LoopbackHttpError',
      status: 404,
    })
  })

  it('reads the graph-prefixed hosted blob route with fresh bearer auth', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(new Uint8Array([9, 8]), {
        status: 200,
        headers: { 'x-document-incarnation': 'incarnation-hosted' },
      }))
    const gateway = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new Auth(),
      fetch,
    })

    await expect(gateway.documentSnapshot('g one', 'doc/one')).resolves.toEqual({
      update: new Uint8Array([9, 8]),
      incarnation: 'incarnation-hosted',
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://gateway.test/g/g%20one/documents/g%20one/doc%2Fone/blob',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: 'Bearer token-a' }),
      }),
    )
  })

  it('reads the graph-prefixed hosted workspace snapshot and fence', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      new Response(new Uint8Array([7, 6]), {
        status: 200,
        headers: { 'x-graph-incarnation': 'graph-incarnation-hosted' },
      }))
    const gateway = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new Auth(),
      fetch,
    })

    await expect(gateway.workspaceSnapshot('g one')).resolves.toEqual({
      update: new Uint8Array([7, 6]),
      incarnation: 'graph-incarnation-hosted',
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://gateway.test/g/g%20one/documents/g%20one/workspace/blob',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: 'Bearer token-a' }),
      }),
    )
  })

  it('preserves hosted 404 as a typed cache miss', async () => {
    const gateway = new GatewayTransport({
      gatewayBaseUrl: 'https://gateway.test',
      auth: new Auth(),
      fetch: async () => new Response('missing', { status: 404 }),
    })
    await expect(gateway.documentUpdate('g', 'new-doc')).rejects.toMatchObject({
      name: 'GatewayHttpError',
      status: 404,
    })
  })
})
