import type { AuthProvider } from '@shrubbery/nucleus'
import { describe, expect, it, vi } from 'vitest'
import { GatewayTransport } from '../src/gateway/gateway-transport.js'

const auth: AuthProvider = {
  async whenReady() {},
  token: () => 'id-token',
  userId: () => 'probe-sub',
  isAuthenticated: () => true,
  onChange: () => () => {},
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('GatewayTransport canonical cloud-2 graph routing', () => {
  it('uses a host-bound exact owner immediately, without graph discovery', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: '[]' }] },
    }))
    const transport = new GatewayTransport({
      gatewayBaseUrl: 'https://api.canary.sophia-labs.com',
      auth,
      fetch: fetchImpl,
    })

    transport.bindGraphOwner('notes', 'agent:phanes')
    await transport.toolsCall('notes', 'list_documents', { graphId: 'notes' })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://api.canary.sophia-labs.com/o/agent%3Aphanes/g/notes/mcp',
    )
  })

  it('refuses malformed or conflicting explicit owner bindings', () => {
    const transport = new GatewayTransport({
      gatewayBaseUrl: 'https://api.canary.sophia-labs.com',
      auth,
      fetch: vi.fn<typeof fetch>(),
    })
    expect(() => transport.bindGraphOwner('notes', 'phanes')).toThrow('owner principal')
    expect(() => transport.bindGraphOwner('notes', 'user:vera/other')).toThrow('owner principal')
    transport.bindGraphOwner('notes', 'user:vera')
    expect(() => transport.bindGraphOwner('notes', 'agent:phanes')).toThrow('already bound')
  })

  it('normalizes lifecycle state, retains owner, and follows one cold activation', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json([{
        owner: 'user:probe-sub',
        graphId: 'obs-hoja-canary',
        title: 'Hoja canary swarm',
        lifecycleState: 'provisioning',
        role: 'owner',
      }]))
      .mockResolvedValueOnce(json({
        code: 'graph_activating',
        activationId: 'act-1',
        pollUrl: '/activations/act-1',
      }, 202))
      .mockResolvedValueOnce(json({ activationId: 'act-1', phase: 'ready' }))
      .mockResolvedValueOnce(json({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text', text: '[]' }] },
      }))
    const transport = new GatewayTransport({
      gatewayBaseUrl: 'https://api.canary.sophia-labs.com',
      auth,
      fetch: fetchImpl,
      activationPollIntervalMs: 0,
    })

    await expect(transport.graphs()).resolves.toEqual([{
      owner: 'user:probe-sub',
      graphId: 'obs-hoja-canary',
      title: 'Hoja canary swarm',
      lifecycleState: 'provisioning',
      cellState: 'stopped',
      role: 'owner',
    }])
    await expect(transport.toolsCall('obs-hoja-canary', 'list_documents', {
      graphId: 'obs-hoja-canary',
    })).resolves.toMatchObject({ content: [{ text: '[]' }] })

    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.canary.sophia-labs.com/graphs',
      'https://api.canary.sophia-labs.com/o/user%3Aprobe-sub/g/obs-hoja-canary/mcp',
      'https://api.canary.sophia-labs.com/activations/act-1',
      'https://api.canary.sophia-labs.com/o/user%3Aprobe-sub/g/obs-hoja-canary/mcp',
    ])
  })

  it('refuses an owner-ambiguous slug instead of falling back to the legacy alias', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json([
      { owner: 'user:a', graphId: 'notes', title: 'A', lifecycleState: 'active', role: 'viewer' },
      { owner: 'user:b', graphId: 'notes', title: 'B', lifecycleState: 'active', role: 'editor' },
    ]))
    const transport = new GatewayTransport({
      gatewayBaseUrl: 'https://api.canary.sophia-labs.com',
      auth,
      fetch: fetchImpl,
    })

    await transport.graphs()
    expect(() => transport.graphBaseUrl('notes')).toThrow('ambiguous across owners')
  })

  it('preserves a trusted exact binding across ambiguous control-plane discovery', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json([
      { owner: 'user:a', graphId: 'notes', title: 'A', lifecycleState: 'active', role: 'viewer' },
      { owner: 'user:b', graphId: 'notes', title: 'B', lifecycleState: 'active', role: 'editor' },
    ]))
    const transport = new GatewayTransport({
      gatewayBaseUrl: 'https://api.canary.sophia-labs.com',
      auth,
      fetch: fetchImpl,
    })
    transport.bindGraphOwner('notes', 'agent:phanes')

    await transport.graphs()

    expect(transport.graphBaseUrl('notes')).toBe(
      'https://api.canary.sophia-labs.com/o/agent%3Aphanes/g/notes',
    )
  })
})
