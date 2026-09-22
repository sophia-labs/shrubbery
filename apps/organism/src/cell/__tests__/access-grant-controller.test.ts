import { describe, expect, it, vi } from 'vitest'
import type { AuthProvider } from '@shrubbery/nucleus'
import { OrganismAccessGrantController } from '../access-grant-controller.js'
import { GatewayTransport, type GatewayAccessGrant } from '../gateway-transport.js'

class TestAuth implements AuthProvider {
  token(): string { return 'hosted-access-token' }
  userId(): string { return 'owner-1' }
  isAuthenticated(): boolean { return true }
  whenReady(): Promise<void> { return Promise.resolve() }
  onChange(): () => void { return () => undefined }
}

interface BackendCall {
  readonly method: string
  readonly path: string
  readonly authorization: string | null
  readonly body: unknown
}

function accessBackend(seed: readonly GatewayAccessGrant[]) {
  const grants = new Map(seed.map(grant => [grant.userId, { ...grant }]))
  const calls: BackendCall[] = []
  let failure: { method: string; status: number; body: unknown } | null = null
  const fetch: typeof globalThis.fetch = vi.fn(async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as unknown : null
    calls.push({ method, path: url.pathname, authorization: headers.get('authorization'), body })
    if (failure && failure.method === method) {
      const next = failure
      failure = null
      return new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { 'content-type': 'application/json' },
      })
    }
    const match = url.pathname.match(/^\/root\/graphs\/graph-a\/access(?:\/([^/]+))?$/u)
    if (!match) return new Response(JSON.stringify({ error: 'unhandled route' }), { status: 404 })
    const userId = match[1] ? decodeURIComponent(match[1]) : null
    if (method === 'GET' && !userId) {
      return new Response(JSON.stringify([...grants.values()]), {
        headers: { 'content-type': 'application/json' },
      })
    }
    if (method === 'PUT' && userId && body && typeof body === 'object') {
      const request = body as { role: 'viewer' | 'editor'; email?: string; displayName?: string }
      grants.set(userId, {
        userId,
        role: request.role,
        grantedAt: '2026-07-10T13:00:00Z',
        grantedBy: 'owner-1',
        ...(request.email ? { email: request.email } : {}),
        ...(request.displayName ? { displayName: request.displayName } : {}),
      })
      return new Response(JSON.stringify({ graphId: 'graph-a', userId, role: request.role }), {
        headers: { 'content-type': 'application/json' },
      })
    }
    if (method === 'DELETE' && userId) {
      grants.delete(userId)
      return new Response(null, { status: 204 })
    }
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 })
  }) as typeof globalThis.fetch
  return {
    calls,
    grants,
    fetch,
    failNext(method: string, status: number, body: unknown) { failure = { method, status, body } },
  }
}

const initial: GatewayAccessGrant[] = [
  {
    userId: 'editor-2',
    role: 'editor',
    grantedAt: '2026-07-10T12:01:00Z',
    grantedBy: 'owner-1',
    email: 'editor@example.test',
    displayName: 'Eddie Editor',
  },
  {
    userId: 'owner-1',
    role: 'owner',
    grantedAt: '2026-07-10T12:00:00Z',
    grantedBy: 'owner-1',
    email: 'owner@example.test',
    displayName: 'Vera Owner',
  },
]

function setup(confirm = vi.fn(async () => true)) {
  const backend = accessBackend(initial)
  const gateway = new GatewayTransport({
    gatewayBaseUrl: 'https://gateway.test/root',
    auth: new TestAuth(),
    fetch: backend.fetch,
  })
  const rerender = vi.fn()
  const controller = new OrganismAccessGrantController({ requestRender: rerender })
  controller.setScope({
    gateway,
    ui: { confirm },
    graphId: 'graph-a',
    graphTitle: 'Research Garden',
    currentUserId: 'owner-1',
    roleHint: 'unknown',
  })
  return { backend, confirm, controller, gateway, rerender }
}

describe('OrganismAccessGrantController', () => {
  it('does not stale-cancel an in-flight load when a shell rerender supplies an equivalent scope', async () => {
    let resolveRows!: (rows: readonly GatewayAccessGrant[]) => void
    const gateway = {
      access: vi.fn(() => new Promise<readonly GatewayAccessGrant[]>(resolve => { resolveRows = resolve })),
      putAccess: vi.fn(async () => undefined),
      deleteAccess: vi.fn(async () => undefined),
    }
    const ui = { confirm: vi.fn(async () => true) }
    const controller = new OrganismAccessGrantController({ requestRender: vi.fn() })
    const scope = {
      gateway,
      ui,
      graphId: 'graph-a',
      graphTitle: 'Research Garden',
      currentUserId: 'owner-1',
      roleHint: 'owner' as const,
    }
    controller.setScope(scope)
    const loading = controller.open()
    controller.setScope({ ...scope, graphTitle: 'Research Garden Renamed' })
    resolveRows(initial)
    await loading
    expect(controller.snapshot()).toMatchObject({
      graphTitle: 'Research Garden Renamed',
      status: 'ready',
      currentRole: 'owner',
    })
    expect(controller.snapshot()?.grants).toHaveLength(2)
  })

  it('loads typed grants through the authenticated transport and derives the caller role', async () => {
    const { backend, controller, rerender } = setup()
    expect(controller.snapshot()).toMatchObject({ status: 'idle', currentRole: 'unknown' })

    await controller.open()
    await Promise.resolve()
    expect(controller.snapshot()).toMatchObject({
      graphId: 'graph-a',
      graphTitle: 'Research Garden',
      status: 'ready',
      currentRole: 'owner',
      error: null,
    })
    expect(controller.snapshot()?.grants.map(grant => grant.userId)).toEqual(['owner-1', 'editor-2'])
    expect(backend.calls).toEqual([{
      method: 'GET',
      path: '/root/graphs/graph-a/access',
      authorization: 'Bearer hosted-access-token',
      body: null,
    }])
    expect(rerender).toHaveBeenCalled()
  })

  it('adds and updates a member, preserving metadata and re-reading authoritative grants', async () => {
    const { backend, controller } = setup()
    await controller.open()
    await controller.add({
      userId: ' viewer/3 ',
      role: 'viewer',
      email: ' viewer@example.test ',
      displayName: ' Viewer Three ',
    })
    expect(controller.snapshot()?.notice).toBe('Added Viewer Three as viewer.')
    expect(controller.snapshot()?.grants.find(grant => grant.userId === 'viewer/3')).toMatchObject({
      role: 'viewer',
      email: 'viewer@example.test',
      displayName: 'Viewer Three',
    })

    await controller.changeRole({ userId: 'viewer/3', role: 'editor' })
    expect(controller.snapshot()?.notice).toBe('Updated Viewer Three to editor.')
    expect(controller.snapshot()?.grants.find(grant => grant.userId === 'viewer/3')?.role).toBe('editor')
    expect(backend.calls.map(call => [call.method, call.path])).toEqual([
      ['GET', '/root/graphs/graph-a/access'],
      ['PUT', '/root/graphs/graph-a/access/viewer%2F3'],
      ['GET', '/root/graphs/graph-a/access'],
      ['PUT', '/root/graphs/graph-a/access/viewer%2F3'],
      ['GET', '/root/graphs/graph-a/access'],
    ])
    expect(backend.calls[3].body).toEqual({
      role: 'editor',
      email: 'viewer@example.test',
      displayName: 'Viewer Three',
    })
  })

  it('requires confirmation before removal and performs no DELETE when cancelled', async () => {
    const confirm = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const { backend, controller } = setup(confirm)
    await controller.open()

    await controller.remove({ userId: 'editor-2' })
    expect(backend.calls.some(call => call.method === 'DELETE')).toBe(false)
    expect(controller.snapshot()?.grants.some(grant => grant.userId === 'editor-2')).toBe(true)

    await controller.remove({ userId: 'editor-2' })
    expect(confirm).toHaveBeenLastCalledWith({
      title: 'Remove Eddie Editor?',
      message: 'Eddie Editor will immediately lose editor access to Research Garden.',
      confirmLabel: 'Remove member',
      cancelLabel: 'Cancel',
    })
    expect(backend.calls.filter(call => call.method === 'DELETE')).toHaveLength(1)
    expect(controller.snapshot()?.grants.some(grant => grant.userId === 'editor-2')).toBe(false)
    expect(controller.snapshot()?.notice).toBe('Removed Eddie Editor.')
  })

  it('keeps the last authoritative list and shows a permission error when a mutation is denied', async () => {
    const { backend, controller } = setup()
    await controller.open()
    backend.failNext('PUT', 403, { error: 'only the graph owner may manage access' })

    await controller.changeRole({ userId: 'editor-2', role: 'viewer' })
    expect(controller.snapshot()).toMatchObject({
      status: 'ready',
      error: 'Only the workspace owner can manage member access.',
      busyAction: null,
    })
    expect(controller.snapshot()?.grants.find(grant => grant.userId === 'editor-2')?.role).toBe('editor')
  })

  it('never attempts owner mutation and blocks non-owner callers before the gateway', async () => {
    const { backend, confirm, controller, gateway } = setup()
    await controller.open()
    await controller.changeRole({ userId: 'owner-1', role: 'viewer' })
    await controller.remove({ userId: 'owner-1' })
    expect(backend.calls.filter(call => call.method !== 'GET')).toEqual([])
    expect(controller.snapshot()?.error).toContain('owner grant cannot be removed')

    controller.setScope({
      gateway,
      ui: { confirm },
      graphId: 'graph-a',
      graphTitle: 'Research Garden',
      currentUserId: 'editor-2',
      roleHint: 'editor',
    })
    await controller.add({ userId: 'viewer-4', role: 'viewer' })
    expect(backend.calls.filter(call => call.method !== 'GET')).toEqual([])
    expect(controller.snapshot()?.error).toContain('Only the workspace owner')
  })
})
