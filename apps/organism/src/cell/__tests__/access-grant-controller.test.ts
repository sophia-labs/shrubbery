import { describe, expect, it, vi } from 'vitest'
import type { AuthProvider } from '@shrubbery/nucleus'
import { OrganismAccessGrantController } from '../access-grant-controller.js'
import { GatewayTransport, type GatewayAccessGrant } from '../gateway-transport.js'

class TestAuth implements AuthProvider {
  token(): string { return 'hosted-access-token' }
  userId(): string { return 'user:owner-1' }
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
  const grants = new Map(seed.filter(row => row.role !== 'owner').map(row => [row.userId, { ...row }]))
  const calls: BackendCall[] = []
  let failure: { action: string; code: number } | null = null
  let staleGrant = false
  let everyone = false
  const links = new Map<string, Record<string, unknown>>()
  const fetch: typeof globalThis.fetch = vi.fn(async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
    calls.push({ method, path: url.pathname, authorization: headers.get('authorization'), body })
    if (url.pathname === '/root/graphs') return Response.json([{ graphId: 'graph-a', owner: 'user:owner-1', title: 'Research Garden', cellState: 'running', role: 'owner' }])
    if (url.pathname !== '/root/control/mcp' || method !== 'POST') return Response.json({ error: 'unhandled route' }, { status: 404 })
    const args = body.params.arguments
    const reply = (value: unknown) => Response.json({ jsonrpc: '2.0', id: body.id, result: { structuredContent: value, isError: false } })
    const graph = { owner: 'user:owner-1', graphId: 'graph-a' }
    if (failure && failure.action === body.params.name) {
      failure = null
      return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32003, message: 'synthetic sharing refusal' } })
    }
    if (body.params.name === 'get_sharing') {
      return reply({ graph, generation: 1, people: [], everyone: everyone ? { graph, principal: 'everyone:authenticated', role: 'viewer' } : null, links: [...links.values()] })
    }
    if (body.params.name === 'manage_share_links') {
      if (args.action === 'create') {
        const linkId = String(links.size + 1).padStart(64, '0')
        const link = { linkId, graph, generation: 1, role: args.role, createdBy: 'user:owner-1', createdAtMs: 1790000000000, ...(args.expiresInSeconds ? { expiresAtMs: 1790000000000 + args.expiresInSeconds * 1000 } : {}), live: true }
        links.set(linkId, link)
        return reply({ ...link, token: `shr_${'T'.repeat(42)}${links.size}` })
      }
      links.delete(args.linkId)
      return reply({ revoked: true })
    }
    if (args.principal === 'everyone:authenticated') {
      everyone = args.action === 'grant'
      return reply(everyone ? { graph, generation: 1, principal: 'everyone:authenticated', role: 'viewer', grantedBy: 'user:owner-1', grantedAtMs: 1790000000000 } : { revoked: true })
    }
    if (failure && failure.action === args.action) {
      const code = failure.code
      failure = null
      return Response.json({ jsonrpc: '2.0', id: body.id, error: { code, message: code === -32004 ? 'graph not found' : 'synthetic refusal' } })
    }
    const wire = (row: GatewayAccessGrant) => ({ graph: { owner: 'user:owner-1', graphId: 'graph-a' }, generation: 1, principal: row.userId, role: row.role, grantedAtMs: Date.parse(row.grantedAt), grantedBy: row.grantedBy })
    let value: unknown
    if (args.action === 'list') value = [...grants.values()].map(wire)
    else if (args.action === 'grant') {
      const row = { userId: args.principal, role: args.role, grantedAt: '2026-09-06T00:00:00.000Z', grantedBy: 'user:owner-1' }
      if (!staleGrant) grants.set(row.userId, row)
      value = wire(row)
    } else {
      grants.delete(args.principal)
      value = { revoked: true }
    }
    return Response.json({ jsonrpc: '2.0', id: body.id, result: { structuredContent: value, isError: false } })
  })
  return { calls, grants, fetch, links,
    get everyone() { return everyone },
    failNext(action: string, code: number) { failure = { action, code } },
    leaveGrantUnconfirmed() { staleGrant = true },
  }
}

function actions(calls: readonly BackendCall[]): string[] {
  return calls.filter(call => call.path === '/root/control/mcp'
    && (call.body as { params: { name: string } }).params.name === 'manage_access').map(call => (call.body as { params: { arguments: { action: string } } }).params.arguments.action)
}

const initial: GatewayAccessGrant[] = [
  {
    userId: 'user:editor-2',
    role: 'editor',
    grantedAt: '2026-07-10T12:01:00Z',
    grantedBy: 'user:owner-1',
    email: 'editor@example.test',
    displayName: 'Eddie Editor',
  },
  {
    userId: 'user:owner-1',
    role: 'owner',
    grantedAt: '2026-07-10T12:00:00Z',
    grantedBy: 'user:owner-1',
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
    currentUserId: 'user:owner-1',
    roleHint: 'owner',
  })
  return { backend, confirm, controller, gateway, rerender }
}

describe('OrganismAccessGrantController', () => {
  it('never applies graph A removal confirmation to graph B after a scope change', async () => {
    let resolveConfirm!: (value: boolean) => void
    const gateway = {
      access: vi.fn(async () => initial),
      putAccess: vi.fn(async () => undefined),
      deleteAccess: vi.fn(async () => undefined),
    }
    const ui = { confirm: vi.fn(() => new Promise<boolean>(resolve => { resolveConfirm = resolve })) }
    const controller = new OrganismAccessGrantController({ requestRender: vi.fn() })
    const scope = { gateway, ui, graphId: 'graph-a', graphTitle: 'A', currentUserId: 'user:owner-1', roleHint: 'owner' as const }
    controller.setScope(scope)
    await controller.open()
    const removing = controller.remove({ userId: 'user:editor-2' })
    controller.setScope({ ...scope, graphId: 'graph-b', graphTitle: 'B' })
    await controller.open()
    resolveConfirm(true)
    await removing
    expect(gateway.deleteAccess).not.toHaveBeenCalled()
    expect(controller.snapshot()?.graphId).toBe('graph-b')
  })

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
      currentUserId: 'user:owner-1',
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
    expect(controller.snapshot()).toMatchObject({ status: 'idle', currentRole: 'owner' })

    await controller.open()
    await Promise.resolve()
    expect(controller.snapshot()).toMatchObject({
      graphId: 'graph-a',
      graphTitle: 'Research Garden',
      status: 'ready',
      currentRole: 'owner',
      error: null,
    })
    expect(controller.snapshot()?.grants.map(grant => grant.userId)).toEqual(['user:editor-2'])
    expect(actions(backend.calls)).toEqual(['list'])
    expect(backend.calls.every(call => call.authorization === 'Bearer hosted-access-token')).toBe(true)
    expect(rerender).toHaveBeenCalled()
  })

  it('adds and updates a typed principal and confirms authoritative grants', async () => {
    const { backend, controller } = setup()
    await controller.open()
    await controller.add({ userId: ' user:viewer-3 ', role: 'viewer' })
    expect(controller.snapshot()?.notice).toBe('Added user:viewer-3 as viewer.')
    await controller.changeRole({ userId: 'user:viewer-3', role: 'editor' })
    expect(controller.snapshot()?.notice).toBe('Updated user:viewer-3 to editor.')
    expect(controller.snapshot()?.grants.find(grant => grant.userId === 'user:viewer-3')?.role).toBe('editor')
    expect(actions(backend.calls)).toEqual(['list', 'grant', 'list', 'grant', 'list'])
  })

  it('does not certify accepted grant when reload is stale or fails, and gates another write', async () => {
    const { backend, controller } = setup()
    await controller.open()
    backend.leaveGrantUnconfirmed()
    await controller.add({ userId: 'user:viewer-3', role: 'viewer' })
    expect(controller.snapshot()).toMatchObject({ status: 'error', notice: null, error: expect.stringContaining('accepted, but current membership could not be confirmed') })
    await controller.add({ userId: 'user:viewer-4', role: 'viewer' })
    expect(actions(backend.calls)).toEqual(['list', 'grant', 'list'])
    await controller.refresh()
    backend.failNext('list', -32004)
    await controller.add({ userId: 'user:viewer-3', role: 'viewer' })
    expect(controller.snapshot()).toMatchObject({ status: 'error', notice: null, error: expect.stringContaining('accepted, but current membership could not be confirmed') })
  })

  it('refuses bare IDs and unsupported metadata before control writes', async () => {
    const { backend, controller } = setup()
    await controller.open()
    await controller.add({ userId: 'viewer-3', role: 'viewer' })
    expect(controller.snapshot()?.error).toContain('typed user principal')
    await controller.add({ userId: 'user:viewer-3', role: 'viewer', email: 'v@example.test' })
    expect(controller.snapshot()?.error).toContain('metadata')
    expect(actions(backend.calls)).toEqual(['list'])
  })

  it('requires confirmation before removal and performs no DELETE when cancelled', async () => {
    const confirm = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const { backend, controller } = setup(confirm)
    await controller.open()

    await controller.remove({ userId: 'user:editor-2' })
    expect(actions(backend.calls)).toEqual(['list'])
    expect(controller.snapshot()?.grants.some(grant => grant.userId === 'user:editor-2')).toBe(true)

    await controller.remove({ userId: 'user:editor-2' })
    expect(confirm).toHaveBeenLastCalledWith({
      title: 'Remove user:editor-2?',
      message: 'user:editor-2 will immediately lose editor access to Research Garden.',
      confirmLabel: 'Remove member',
      cancelLabel: 'Cancel',
    })
    expect(actions(backend.calls)).toEqual(['list', 'revoke', 'list'])
    expect(controller.snapshot()?.grants.some(grant => grant.userId === 'user:editor-2')).toBe(false)
    expect(controller.snapshot()?.notice).toBe('Removed user:editor-2.')
  })

  it('keeps the last authoritative list and shows a permission error when a mutation is denied', async () => {
    const { backend, controller } = setup()
    await controller.open()
    backend.failNext('grant', -32003)

    await controller.changeRole({ userId: 'user:editor-2', role: 'viewer' })
    expect(controller.snapshot()).toMatchObject({
      status: 'error',
      error: 'Access management was refused. synthetic refusal',
      busyAction: null,
    })
    expect(controller.snapshot()?.grants.find(grant => grant.userId === 'user:editor-2')?.role).toBe('editor')
  })

  it('never attempts owner mutation and blocks non-owner callers before the gateway', async () => {
    const { backend, confirm, controller, gateway } = setup()
    await controller.open()
    await controller.changeRole({ userId: 'user:owner-1', role: 'viewer' })
    await controller.remove({ userId: 'user:owner-1' })
    expect(actions(backend.calls)).toEqual(['list'])
    expect(controller.snapshot()?.error).toContain('no longer present')

    controller.setScope({
      gateway,
      ui: { confirm },
      graphId: 'graph-a',
      graphTitle: 'Research Garden',
      currentUserId: 'user:editor-2',
      roleHint: 'editor',
    })
    await controller.add({ userId: 'user:viewer-4', role: 'viewer' })
    expect(actions(backend.calls)).toEqual(['list'])
    expect(controller.snapshot()?.error).toContain('Only the workspace owner')
  })

  describe('sharing', () => {
    async function settle(): Promise<void> {
      for (let i = 0; i < 10; i += 1) await Promise.resolve()
      await new Promise(resolve => setTimeout(resolve, 0))
    }

    it('loads the owner sharing view and toggles everyone only after confirmation', async () => {
      const confirm = vi.fn(async () => false)
      const { backend, controller } = setup(confirm)
      await controller.open()
      await settle()
      expect(controller.snapshot()?.sharing).toMatchObject({ status: 'ready', everyone: false, links: [] })

      await controller.setEveryone({ enabled: true })
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(backend.everyone).toBe(false)

      confirm.mockResolvedValue(true)
      await controller.setEveryone({ enabled: true })
      expect(backend.everyone).toBe(true)
      expect(controller.snapshot()?.sharing?.everyone).toBe(true)
      expect(controller.snapshot()?.notice).toContain('Anyone signed in')

      // Turning it off needs no confirmation and is confirmed by a re-read.
      await controller.setEveryone({ enabled: false })
      expect(confirm).toHaveBeenCalledTimes(2)
      expect(backend.everyone).toBe(false)
      expect(controller.snapshot()?.sharing?.everyone).toBe(false)
    })

    it('creates a link whose URL carries the token in the fragment, once, and revokes it after confirmation', async () => {
      const confirm = vi.fn(async () => true)
      const backend = accessBackend(initial)
      const gateway = new GatewayTransport({ gatewayBaseUrl: 'https://gateway.test/root', auth: new TestAuth(), fetch: backend.fetch })
      const controller = new OrganismAccessGrantController({ requestRender: vi.fn(), linkOrigin: () => 'https://garden.example.test' })
      controller.setScope({ gateway, ui: { confirm }, graphId: 'graph-a', graphTitle: 'Research Garden', currentUserId: 'user:owner-1', roleHint: 'owner' })
      await controller.open()
      await settle()

      await controller.createLink({ role: 'editor', expiresInSeconds: 604800 })
      const sharing = controller.snapshot()!.sharing!
      expect(sharing.createdLinkUrl).toBe(`https://garden.example.test/#share=shr_${'T'.repeat(42)}1`)
      expect(sharing.links).toHaveLength(1)
      expect(sharing.links[0]).toMatchObject({ role: 'editor', live: true })
      expect(sharing.links[0].expiresAt).not.toBeNull()
      // The token never appears anywhere but the one-time URL.
      expect(JSON.stringify(sharing.links)).not.toContain('shr_')
      controller.dismissLink()
      expect(controller.snapshot()!.sharing!.createdLinkUrl).toBeNull()

      await controller.revokeLink({ linkId: sharing.links[0].linkId })
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(backend.links.size).toBe(0)
      expect(controller.snapshot()!.sharing!.links).toEqual([])
    })

    it('keeps people usable when sharing is refused, and hides sharing from non-owners', async () => {
      const { backend, controller } = setup()
      backend.failNext('get_sharing', -32003)
      await controller.open()
      await settle()
      expect(controller.snapshot()).toMatchObject({ status: 'ready' })
      expect(controller.snapshot()?.grants).toHaveLength(1)
      expect(controller.snapshot()?.sharing).toMatchObject({ status: 'error' })
      expect(controller.snapshot()?.sharing?.error).toContain('unavailable')

      const viewer = accessBackend(initial)
      const gateway = new GatewayTransport({ gatewayBaseUrl: 'https://gateway.test/root', auth: new TestAuth(), fetch: viewer.fetch })
      const other = new OrganismAccessGrantController({ requestRender: vi.fn() })
      other.setScope({ gateway, ui: { confirm: vi.fn(async () => true) }, graphId: 'graph-a', graphTitle: 'R', currentUserId: 'user:viewer-9', roleHint: 'viewer' })
      await other.open()
      await settle()
      expect(other.snapshot()?.sharing).toBeNull()
      expect(viewer.calls.some(call => (call.body as { params?: { name?: string } } | null)?.params?.name === 'get_sharing')).toBe(false)
    })
  })
})
