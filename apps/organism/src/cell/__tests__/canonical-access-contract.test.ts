import { describe, expect, it, vi } from 'vitest'
import type { AuthProvider } from '@shrubbery/nucleus'
import { GatewayTransport as SourceGatewayTransport } from '@shrubbery/source/gateway'
import { createAccessGrantService } from '@shrubbery/runtime'
import { GatewayTransport } from '../gateway-transport.js'

const owner = 'user:owner-sub'
const graphId = 'notes'
const member = 'user:recipient-sub'
const grantedAtMs = 1788678000000

class TestAuth implements AuthProvider {
  value = 'synthetic-id-token'
  token(): string { return this.value }
  userId(): string { return owner }
  isAuthenticated(): boolean { return true }
  whenReady(): Promise<void> { return Promise.resolve() }
  onChange(): () => void { return () => undefined }
}

function fixture() {
  const auth = new TestAuth()
  const calls: { path: string; method: string; body: any; authorization: string | null }[] = []
  const grant = {
    graph: { owner, graphId }, generation: 1, principal: member, role: 'viewer',
    grantedBy: owner, grantedAtMs,
  }
  let nextResult: unknown = undefined
  let nextError: { code: number; message: string } | undefined
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(input)).pathname
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
    calls.push({ path, method: init.method ?? 'GET', body, authorization: new Headers(init.headers).get('authorization') })
    if (path === '/root/graphs' && (init.method ?? 'GET') === 'GET') {
      return Response.json([{ owner, graphId, title: 'Notes', role: 'owner', cellState: 'running' }])
    }
    if (path !== '/root/control/mcp' || init.method !== 'POST') {
      return Response.json({ error: 'not found: route' }, { status: 404 })
    }
    if (nextError) {
      const error = nextError
      nextError = undefined
      return Response.json({ jsonrpc: '2.0', id: body.id, error })
    }
    const args = body.params.arguments
    const value = nextResult !== undefined ? nextResult : args.action === 'list' ? [grant]
      : args.action === 'grant' ? { ...grant, principal: args.principal, role: args.role }
        : { revoked: true }
    nextResult = undefined
    return Response.json({ jsonrpc: '2.0', id: body.id, result: {
      content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false,
    } })
  }) as typeof globalThis.fetch
  return {
    auth, calls, fetch,
    result(value: unknown) { nextResult = value },
    error(code: number, message: string) { nextError = { code, message } },
  }
}

const adapters = [
  ['Organism caller', async (f: ReturnType<typeof fixture>) => {
    const gateway = new GatewayTransport({ gatewayBaseUrl: 'https://gateway.test/root', auth: f.auth, fetch: f.fetch })
    await gateway.graphs()
    return { list: () => gateway.access(graphId), put: (principal: string) => gateway.putAccess(graphId, principal, { role: 'viewer' }), remove: () => gateway.deleteAccess(graphId, member) }
  }],
  ['source-package caller', async (f: ReturnType<typeof fixture>) => {
    const gateway = new SourceGatewayTransport({ gatewayBaseUrl: 'https://gateway.test/root', auth: f.auth, fetch: f.fetch })
    await gateway.graphs()
    return { list: () => gateway.access(graphId), put: (principal: string) => gateway.putAccess(graphId, principal, { role: 'viewer' }), remove: () => gateway.deleteAccess(graphId, member) }
  }],
  ['access.manager service', async (f: ReturnType<typeof fixture>) => {
    const service = createAccessGrantService({
      resolveGatewayBaseUrl: () => 'https://gateway.test/root',
      headers: () => ({ Authorization: `Bearer ${f.auth.token()}` }),
    }, f.fetch)
    return { list: () => service.list(graphId), put: (principal: string) => service.put(graphId, principal, { role: 'viewer' }), remove: () => service.remove(graphId, member) }
  }],
] as const

describe.each(adapters)('%s canonical owner-qualified grants', (_name, setup) => {
  it('lists/grants/revokes through control MCP with typed identities and fresh authentication', async () => {
    const f = fixture()
    const client = await setup(f)
    await expect(client.list()).resolves.toEqual([{
      userId: member, role: 'viewer', grantedAt: new Date(grantedAtMs).toISOString(), grantedBy: owner,
    }])
    f.auth.value = 'synthetic-refreshed-id-token'
    await client.put(member)
    await client.remove()
    const controls = f.calls.filter(call => call.path === '/root/control/mcp')
    expect(controls.map(call => call.body.params)).toEqual([
      { name: 'manage_access', arguments: { owner, graphId, action: 'list' } },
      { name: 'manage_access', arguments: { owner, graphId, action: 'grant', principal: member, role: 'viewer' } },
      { name: 'manage_access', arguments: { owner, graphId, action: 'revoke', principal: member } },
    ])
    expect(controls[0].authorization).toBe('Bearer synthetic-id-token')
    expect(controls[1].authorization).toBe('Bearer synthetic-refreshed-id-token')
    expect(f.calls.some(call => call.path.includes('/access'))).toBe(false)
  })

  it('preserves an HTTP-200 RPC refusal instead of inventing empty membership', async () => {
    const f = fixture()
    const client = await setup(f)
    f.error(-32004, 'graph not found')
    await expect(client.list()).rejects.toMatchObject({ code: -32004, message: expect.stringContaining('graph not found') })
  })

  it('rejects a mismatched owner/graph response', async () => {
    const f = fixture()
    const client = await setup(f)
    f.result([{ graph: { owner: 'user:someone-else', graphId }, generation: 1, principal: member, role: 'viewer', grantedAtMs, grantedBy: owner }])
    await expect(client.list()).rejects.toThrow(/identity/i)
  })

  it('does not submit an untyped recipient principal', async () => {
    const f = fixture()
    const client = await setup(f)
    await expect(client.put('recipient-sub')).rejects.toThrow(/user:|principal/i)
    expect(f.calls.filter(call => call.path === '/root/control/mcp')).toHaveLength(0)
  })
})
