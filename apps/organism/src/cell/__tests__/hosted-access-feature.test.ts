import { describe, expect, it, vi } from 'vitest'
import { accessOpenRequested, createOrganismShellFeatureHost, withoutAccessOpenRequest } from '../shell-features.js'
import { createShellContext } from '../shell-context.js'
import type { GatewayAccessGrant } from '../gateway-transport.js'

const rows: readonly GatewayAccessGrant[] = [
  {
    userId: 'owner-1',
    role: 'owner',
    grantedAt: '2026-07-10T12:00:00Z',
    grantedBy: 'owner-1',
    displayName: 'Vera Owner',
  },
  {
    userId: 'viewer-2',
    role: 'viewer',
    grantedAt: '2026-07-10T12:01:00Z',
    grantedBy: 'owner-1',
    displayName: 'Viv Viewer',
  },
]

function hostedContext(
  root: HTMLElement,
  contract: unknown,
  rerender = vi.fn(),
) {
  return createShellContext({
    host: root,
    graphId: 'graph-a',
    documentId: 'doc-a',
    app: 'garden',
    source: 'CELL_LIVE',
    deploymentMode: 'hosted',
    contract,
    location: new URL('https://garden.test/'),
    rerender,
  })
}

describe('hosted access shell feature', () => {
  it('projects gateway grants into chrome and activates lazily on panel open', async () => {
    const gateway = {
      access: vi.fn(async () => rows),
      putAccess: vi.fn(async () => undefined),
      deleteAccess: vi.fn(async () => undefined),
    }
    const contract = {
      auth: { userId: () => 'owner-1' },
      gateway,
      ui: { confirm: vi.fn(async () => true) },
    }
    const root = document.createElement('div')
    const rerender = vi.fn()
    const context = hostedContext(root, contract, rerender)
    const host = createOrganismShellFeatureHost()
    const base = {
      chrome: {
        workspaces: [{
          graphId: 'graph-a',
          title: 'Research Garden',
          role: 'owner' as const,
          cellState: 'running' as const,
        }],
      },
    }

    let snapshot = host.workspaceSnapshot(context, base)
    expect(snapshot.chrome?.access).toMatchObject({
      graphId: 'graph-a',
      graphTitle: 'Research Garden',
      currentRole: 'owner',
      status: 'idle',
      grants: [],
    })
    snapshot.chrome?.access?.onOpen?.()
    await vi.waitFor(() => expect(gateway.access).toHaveBeenCalledWith('graph-a'))
    await vi.waitFor(() => expect(rerender).toHaveBeenCalled())

    snapshot = host.workspaceSnapshot(context, base)
    expect(snapshot.chrome?.access).toMatchObject({
      currentRole: 'owner',
      status: 'ready',
      error: null,
    })
    expect(snapshot.chrome?.access?.grants.map(grant => grant.userId)).toEqual(['owner-1', 'viewer-2'])
    host.destroy()
  })

  it('does not advertise hosted sharing in local or structurally incomplete contracts', () => {
    const root = document.createElement('div')
    const host = createOrganismShellFeatureHost()
    const local = createShellContext({
      host: root,
      graphId: 'graph-a',
      documentId: null,
      app: 'garden',
      source: 'CELL_LIVE',
      deploymentMode: 'playground',
      contract: {
        auth: { userId: () => 'local-user' },
        gateway: { access: vi.fn(), putAccess: vi.fn(), deleteAccess: vi.fn() },
        ui: { confirm: vi.fn() },
      },
      location: new URL('http://localhost/'),
      rerender: vi.fn(),
    })
    expect(host.workspaceSnapshot(local, { chrome: {} }).chrome?.access).toBeNull()

    const incomplete = hostedContext(root, { auth: { userId: () => 'owner-1' } })
    expect(host.workspaceSnapshot(incomplete, { chrome: {} }).chrome?.access).toBeNull()
    host.destroy()
  })

  it('opens the Share dialog once for ?access=1, after the graph has loaded', async () => {
    const gateway = {
      access: vi.fn(async () => rows),
      putAccess: vi.fn(async () => undefined),
      deleteAccess: vi.fn(async () => undefined),
    }
    const contract = {
      auth: { userId: () => 'owner-1', snapshot: () => ({ identity: 'vera@example.test' }) },
      gateway,
      ui: { confirm: vi.fn(async () => true) },
    }
    const root = document.createElement('div')
    const context = createShellContext({
      host: root,
      graphId: 'graph-a',
      documentId: null,
      app: 'garden',
      source: 'CELL_LIVE',
      deploymentMode: 'hosted',
      contract,
      location: new URL('https://garden.test/g/graph-a?access=1'),
      rerender: vi.fn(),
    })
    const host = createOrganismShellFeatureHost()
    const workspaces = [{ graphId: 'graph-a', title: 'Research Garden', role: 'owner' as const, cellState: 'running' as const }]

    const loading = host.workspaceSnapshot(context, { chrome: { workspaces }, sidebar: { status: 'loading' } })
    expect(loading.chrome?.access?.openRequest ?? null).toBeNull()
    expect(gateway.access).not.toHaveBeenCalled()

    const ready = host.workspaceSnapshot(context, { chrome: { workspaces }, sidebar: { status: 'ready' } })
    expect(ready.chrome?.access?.openRequest).toBe(1)
    await vi.waitFor(() => expect(gateway.access).toHaveBeenCalledTimes(1))
    const again = host.workspaceSnapshot(context, { chrome: { workspaces }, sidebar: { status: 'ready' } })
    expect(again.chrome?.access?.openRequest).toBe(1)
    expect(again.chrome?.access?.memberLinkUrl).toMatch(/\/g\/graph-a$/)
    host.destroy()
  })

  it('reads ?access=1 and strips only that parameter', () => {
    expect(accessOpenRequested(new URL('https://garden.test/g/a?access=1&doc=d'))).toBe(true)
    expect(accessOpenRequested(new URL('https://garden.test/g/a?access=0'))).toBe(false)
    expect(withoutAccessOpenRequest(new URL('https://garden.test/g/a?access=1&doc=d')).href).toBe('https://garden.test/g/a?doc=d')
  })
})
