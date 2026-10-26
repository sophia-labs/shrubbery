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

const PUBLIC_TOKEN = `shp_${'S'.repeat(43)}`

function accessBackend(seed: readonly GatewayAccessGrant[]) {
  const grants = new Map(seed.filter(row => row.role !== 'owner').map(row => [row.userId, { ...row }]))
  const calls: BackendCall[] = []
  let failure: { action: string; code: number } | null = null
  let staleGrant = false
  let everyone = false
  const links = new Map<string, Record<string, unknown>>()
  /** The gateway's directory: the one email with a confirmed account, and the names it knows. */
  const directory = new Map([['ada@example.test', { principal: 'user:ada', name: 'Ada Reader' }]])
  const people = new Map<string, { name?: string; email?: string }>()
  const invitations = new Map<string, Record<string, unknown>>()
  let publicLink: Record<string, unknown> | null = null
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
    const wire = (row: GatewayAccessGrant) => ({ graph: { owner: 'user:owner-1', graphId: 'graph-a' }, generation: 1, principal: row.userId, role: row.role, grantedAtMs: Date.parse(row.grantedAt), grantedBy: row.grantedBy })
    const everyoneRow = { graph, generation: 1, principal: 'everyone:authenticated', role: 'viewer', grantedBy: 'user:owner-1', grantedAtMs: 1790000000000 }
    if (failure && failure.action === body.params.name) {
      failure = null
      return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32003, message: 'synthetic sharing refusal' } })
    }
    if (body.params.name === 'get_sharing') {
      return reply({
        graph, generation: 1,
        people: [...grants.values()].map(row => ({ ...wire(row), person: people.get(row.userId) ?? {} })),
        everyone: everyone ? everyoneRow : null,
        links: [...links.values()],
        invitations: [...invitations.values()],
        publicLink: publicLink ? { linkId: publicLink.linkId, token: publicLink.token, role: 'viewer', createdAtMs: publicLink.createdAtMs, live: true } : null,
      })
    }
    if (body.params.name === 'share_with_email') {
      const known = directory.get(args.email)
      if (known) {
        const row = { userId: known.principal, role: args.role, grantedAt: '2026-10-26T00:00:00.000Z', grantedBy: 'user:owner-1' }
        grants.set(row.userId, row)
        people.set(row.userId, { name: known.name, email: args.email })
        return reply({ outcome: 'granted', grant: wire(row), person: { name: known.name, email: args.email } })
      }
      const invitation = { invitationId: `inv-${invitations.size + 1}`, graph, generation: 1, email: args.email, role: args.role, invitedBy: 'user:owner-1', createdAtMs: 1790000000000, acceptedBy: null, acceptedAtMs: null }
      invitations.set(invitation.invitationId, invitation)
      return reply({ outcome: 'invited', invitation })
    }
    if (body.params.name === 'cancel_graph_invitation') {
      invitations.delete(args.invitationId)
      return reply({ cancelled: true })
    }
    if (body.params.name === 'manage_share_links') {
      if (args.action === 'create' && args.audience === 'public') {
        publicLink ??= { linkId: 'f'.repeat(64), graph, generation: 1, role: 'viewer', createdBy: 'user:owner-1', createdAtMs: 1790000000000, token: PUBLIC_TOKEN }
        return reply(publicLink)
      }
      if (args.action === 'revoke' && publicLink && args.linkId === publicLink.linkId) {
        publicLink = null
        return reply({ revoked: true })
      }
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
    let value: unknown
    // Tolerance: an older gateway listed the everyone row among people.
    if (args.action === 'list') value = [...[...grants.values()].map(wire), ...(everyone ? [everyoneRow] : [])]
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
  return { calls, grants, fetch, links, invitations,
    get everyone() { return everyone },
    get publicLink() { return publicLink },
    failNext(action: string, code: number) { failure = { action, code } },
    leaveGrantUnconfirmed() { staleGrant = true },
    /** What the directory knows about someone with access (get_sharing's `person`). */
    name(userId: string, person: { name?: string; email?: string }) { people.set(userId, person) },
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
    // The owner is drawn first; the gateway lists only delegated grants.
    expect(controller.snapshot()?.grants.map(grant => [grant.userId, grant.role])).toEqual([['user:owner-1', 'owner'], ['user:editor-2', 'editor']])
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
    expect(controller.snapshot()?.error).toContain('owner grant cannot be changed')
    await controller.remove({ userId: 'user:owner-1' })
    expect(actions(backend.calls)).toEqual(['list'])
    expect(controller.snapshot()?.error).toContain('owner grant cannot be removed')

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
      expect(controller.snapshot()?.grants.map(grant => grant.userId)).toEqual(['user:owner-1', 'user:editor-2'])
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

    function ownerSetup(confirm = vi.fn(async () => true)) {
      const backend = accessBackend(initial)
      const gateway = new GatewayTransport({ gatewayBaseUrl: 'https://gateway.test/root', auth: new TestAuth(), fetch: backend.fetch })
      const controller = new OrganismAccessGrantController({ requestRender: vi.fn(), linkOrigin: () => 'https://garden.example.test/' })
      controller.setScope({
        gateway, ui: { confirm }, graphId: 'graph-a', graphTitle: 'Research Garden',
        currentUserId: 'user:owner-1', roleHint: 'owner', currentUserEmail: 'vera@example.test',
      })
      return { backend, controller, confirm }
    }

    function toolNames(calls: readonly BackendCall[]): string[] {
      return calls.filter(call => call.path === '/root/control/mcp')
        .map(call => (call.body as { params: { name: string } }).params.name)
    }

    it('names people from the sharing view and keeps the owner first', async () => {
      const { backend, controller } = ownerSetup()
      backend.name('user:editor-2', { name: 'Eddie Editor', email: 'editor@example.test' })
      await controller.open()
      await settle()
      const grants = controller.snapshot()!.grants
      expect(grants.map(grant => grant.userId)).toEqual(['user:owner-1', 'user:editor-2'])
      expect(grants[0]).toMatchObject({ role: 'owner', email: 'vera@example.test' })
      expect(grants[1]).toMatchObject({ displayName: 'Eddie Editor', email: 'editor@example.test' })
      expect(controller.snapshot()!.memberLinkUrl).toBe('https://garden.example.test/g/graph-a')
    })

    it('shares by email: a known account is granted and named at once', async () => {
      const { backend, controller } = ownerSetup()
      await controller.open()
      await settle()
      await controller.invite({ email: ' Ada@Example.TEST ', role: 'editor' })
      await settle()
      expect(controller.snapshot()?.inviteResult).toEqual({ outcome: 'granted', email: 'ada@example.test', name: 'Ada Reader', role: 'editor' })
      expect(controller.snapshot()?.grants.find(grant => grant.userId === 'user:ada')).toMatchObject({ role: 'editor', displayName: 'Ada Reader' })
      const share = backend.calls.find(call => (call.body as { params?: { name?: string } } | null)?.params?.name === 'share_with_email')
      expect((share!.body as { params: unknown }).params).toEqual({
        name: 'share_with_email',
        arguments: { owner: 'user:owner-1', graphId: 'graph-a', email: 'ada@example.test', role: 'editor' },
      })
    })

    it('invites an unknown email with a message naming the graph, the inviter and the app, then cancels it', async () => {
      const { backend, controller } = ownerSetup()
      await controller.open()
      await settle()
      await controller.invite({ email: 'bob@example.test', role: 'viewer' })
      await settle()
      expect(controller.snapshot()?.inviteResult).toEqual({
        outcome: 'invited',
        email: 'bob@example.test',
        role: 'viewer',
        message: 'vera@example.test has shared “Research Garden” with you on Sophia. To open it, sign in or create an account at https://garden.example.test/g/graph-a with this email address: bob@example.test',
      })
      expect(controller.snapshot()?.sharing?.invitations).toEqual([
        { invitationId: 'inv-1', email: 'bob@example.test', role: 'viewer', createdAt: new Date(1790000000000).toISOString(), expiresAt: null },
      ])
      // Nobody is granted until that email signs in.
      expect(controller.snapshot()?.grants.map(grant => grant.userId)).toEqual(['user:owner-1', 'user:editor-2'])

      await controller.cancelInvitation({ invitationId: 'inv-1' })
      expect(backend.invitations.size).toBe(0)
      expect(controller.snapshot()?.sharing?.invitations).toEqual([])
      expect(controller.snapshot()?.notice).toBe('The invitation for bob@example.test is cancelled.')
      expect(controller.snapshot()?.inviteResult).toBeNull()
    })

    it('refuses a malformed email before any request', async () => {
      const { backend, controller } = ownerSetup()
      await controller.open()
      await settle()
      const before = backend.calls.length
      await controller.invite({ email: 'bob at example', role: 'viewer' })
      expect(controller.snapshot()?.error).toContain('Enter an email address')
      expect(backend.calls.length).toBe(before)
    })

    it('moves General access between its three choices with the right grant and link calls', async () => {
      const confirm = vi.fn(async () => true)
      const { backend, controller } = ownerSetup(confirm)
      await controller.open()
      await settle()
      expect(controller.snapshot()?.sharing).toMatchObject({ generalAccess: 'restricted', publicLinkUrl: null })

      await controller.setGeneralAccess({ access: 'signed-in' })
      expect(backend.everyone).toBe(true)
      expect(backend.publicLink).toBeNull()
      expect(controller.snapshot()?.sharing?.generalAccess).toBe('signed-in')
      expect(controller.snapshot()?.notice).toBe('Anyone signed in to Sophia can now view this graph.')
      // The everyone row an older gateway lists among people is general access, not a person.
      await controller.refresh()
      await settle()
      expect(controller.snapshot()?.status).toBe('ready')
      expect(controller.snapshot()?.grants.some(grant => grant.userId === 'everyone:authenticated')).toBe(false)

      await controller.setGeneralAccess({ access: 'public' })
      expect(backend.publicLink).not.toBeNull()
      expect(backend.everyone).toBe(false)
      expect(controller.snapshot()?.sharing).toMatchObject({
        generalAccess: 'public',
        publicLinkUrl: `https://garden.example.test/view#${PUBLIC_TOKEN}`,
      })
      const create = backend.calls.find(call => (call.body as { params?: { arguments?: { audience?: string } } } | null)?.params?.arguments?.audience === 'public')
      expect((create!.body as { params: { arguments: unknown } }).params.arguments).toEqual({
        owner: 'user:owner-1', graphId: 'graph-a', action: 'create', audience: 'public', role: 'viewer',
      })

      await controller.setGeneralAccess({ access: 'restricted' })
      expect(backend.publicLink).toBeNull()
      expect(backend.everyone).toBe(false)
      expect(controller.snapshot()?.sharing).toMatchObject({ generalAccess: 'restricted', publicLinkUrl: null })
      expect(controller.snapshot()?.notice).toBe('Only people with access can open this graph now.')
      // Widening asked twice; narrowing never asks.
      expect(confirm).toHaveBeenCalledTimes(2)
      expect(confirm.mock.calls[1]).toEqual([expect.objectContaining({ title: 'Let anyone with the link view this graph?' })])
    })

    it('changes nothing when the owner cancels a widening', async () => {
      const { backend, controller } = ownerSetup(vi.fn(async () => false))
      await controller.open()
      await settle()
      const before = toolNames(backend.calls).length
      await controller.setGeneralAccess({ access: 'public' })
      expect(toolNames(backend.calls).length).toBe(before)
      expect(backend.publicLink).toBeNull()
      expect(controller.snapshot()?.sharing?.generalAccess).toBe('restricted')
    })

    it('never lists people for a Viewer or an Editor; they get their role and the graph link', async () => {
      const viewer = accessBackend(initial)
      const gateway = new GatewayTransport({ gatewayBaseUrl: 'https://gateway.test/root', auth: new TestAuth(), fetch: viewer.fetch })
      const controller = new OrganismAccessGrantController({ requestRender: vi.fn(), linkOrigin: () => 'https://garden.example.test' })
      controller.setScope({ gateway, ui: { confirm: vi.fn(async () => true) }, graphId: 'graph-a', graphTitle: 'R', currentUserId: 'user:viewer-9', roleHint: 'viewer' })
      await controller.open()
      await settle()
      expect(controller.snapshot()).toMatchObject({ status: 'ready', currentRole: 'viewer', error: null, memberLinkUrl: 'https://garden.example.test/g/graph-a' })
      expect(toolNames(viewer.calls)).toEqual([])
    })

    it('opens on request (Home\'s Share button) and loads once', async () => {
      const { backend, controller } = ownerSetup()
      expect(controller.snapshot()?.openRequest).toBeNull()
      controller.requestOpen()
      expect(controller.snapshot()?.openRequest).toBe(1)
      await settle()
      expect(controller.snapshot()?.status).toBe('ready')
      controller.requestOpen()
      expect(controller.snapshot()?.openRequest).toBe(2)
      await settle()
      expect(actions(backend.calls)).toEqual(['list'])
    })
  })
})
