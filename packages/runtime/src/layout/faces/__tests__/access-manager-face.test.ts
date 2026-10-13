/**
 * access-manager-face.test.ts — the FAST, network-free mount proof: a real
 * `FaceRegistry`/`LayoutResourceBroker`/`LayoutInterpreter`, and a real
 * `AccessGrantService` built by `createAccessGrantService` over a
 * fake-but-real `fetch` (the `hosted-viewer-rest-client.test.ts` "real async
 * function returning a real Response" convention). `<mn-access-manager>` is
 * not registered in this package (`@shrubbery/runtime` cannot depend on
 * `@shrubbery/components` — `access-manager-face.ts`'s own header), so —
 * mirroring `doc-history-face.test.ts`'s own established boundary — these
 * tests drive the mounted element's REAL property/event contract directly
 * via `dispatchEvent` with the SAME event names/detail shapes the real
 * component fires, proving the FACE's controller wiring and real add/role-
 * change/remove/refresh round trips against a real (in-memory-backed HTTP)
 * `AccessGrantService`. The real component's own rendering is proven by a
 * real-Chromium proof, not here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deepFreeze, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { FaceRegistry } from '../../face-registry.js'
import { LayoutResourceBroker } from '../../resource-broker.js'
import { LayoutInterpreter } from '../../layout-interpreter.js'
import { createAccessGrantService, type AccessGrantEntry, type WorkspaceGatewayTransport } from '../../../editor-services/workspace-gateway-service.js'
import {
  ACCESS_MANAGER_FACE_ID,
  ACCESS_MANAGER_RESOURCE_ADAPTER_ID,
  createAccessManagerFace,
  createAccessManagerResourceAdapter,
} from '../access-manager-face.js'

interface MnAccessManagerLike extends HTMLElement {
  embedded: boolean
  model: {
    graphId: string
    graphTitle: string
    currentRole: string
    status: string
    grants: readonly AccessGrantEntry[]
    error: string | null
    notice: string | null
    busyUserId: string | null
    busyAction: string | null
  } | null
}

/** A real, in-memory-backed HTTP fake — genuine `fetch`/`Response`/status-code semantics (this file's own header), not a stubbed return value. Mirrors `apps/organism/src/harness/access-main.ts`'s own `backendFetch` pattern. */
function realAccessBackend(seed: readonly AccessGrantEntry[]) {
  const grants = new Map(seed.filter(row => row.role !== 'owner').map(row => [row.userId, row]))
  const calls: { method: string; url: string; body?: unknown }[] = []
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url: url.pathname, body })
    if (url.pathname === '/graphs') return Response.json(['graph-a', 'graph-b'].map(graphId => ({ graphId, owner: 'user:owner-1', role: 'owner', title: graphId, cellState: 'running' })))
    if (url.pathname !== '/control/mcp' || method !== 'POST') return Response.json({ error: 'unhandled route' }, { status: 404 })
    const args = body.params.arguments
    const wire = (row: AccessGrantEntry) => ({ graph: { owner: args.owner, graphId: args.graphId }, generation: 1, principal: row.userId, role: row.role, grantedAtMs: Date.parse(row.grantedAt), grantedBy: row.grantedBy })
    let value: unknown
    if (args.action === 'list') value = [...grants.values()].map(wire)
    else if (args.action === 'grant') {
      const row = { userId: args.principal, role: args.role, grantedAt: '2026-09-06T00:00:00.000Z', grantedBy: 'user:owner-1' }
      grants.set(row.userId, row)
      value = wire(row)
    } else { grants.delete(args.principal); value = { revoked: true } }
    return Response.json({ jsonrpc: '2.0', id: body.id, result: { structuredContent: value, isError: false } })
  }
  const transport: WorkspaceGatewayTransport = { resolveGatewayBaseUrl: () => 'https://gw.test', headers: () => ({}) }
  return { service: createAccessGrantService(transport, fetchImpl), calls, grants }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function accessLeaf(graphId: string, graphTitle?: string, descriptorRevision = 0): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'access-manager-only',
    scope: 'session',
    graphId: null,
    rootNodeId: 'access',
    nodes: {
      access: {
        kind: 'leaf',
        id: 'access',
        descriptor: {
          schemaVersion: 1,
          faceId: ACCESS_MANAGER_FACE_ID,
          resource: { kind: 'graph', graphId },
          ...(graphTitle ? { params: { graphTitle } } : {}),
        },
        descriptorRevision,
      },
    },
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
  })
}

const OWNER: AccessGrantEntry = { userId: 'user:owner-1', role: 'owner', grantedAt: '2026-07-10T12:00:00Z', grantedBy: 'user:owner-1', displayName: 'Vera Owner' }
const EDITOR: AccessGrantEntry = { userId: 'user:editor-2', role: 'editor', grantedAt: '2026-07-10T12:01:00Z', grantedBy: 'user:owner-1', displayName: 'Eddie Editor' }

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

describe('access.manager — resource adapter', () => {
  it('is derived, accepts only graph locators, and keys by graphId', () => {
    const { service } = realAccessBackend([])
    const adapter = createAccessManagerResourceAdapter(service)
    expect(adapter.shape).toBe('derived')
    expect(adapter.adapterId).toBe(ACCESS_MANAGER_RESOURCE_ADAPTER_ID)
    expect(adapter.accepts({ kind: 'graph', graphId: 'g1' })).toBe(true)
    expect(adapter.accepts({ kind: 'document', graphId: 'g', documentId: 'd' })).toBe(false)
    expect(adapter.resourceKey({ kind: 'graph', graphId: 'g1' })).not.toBe(adapter.resourceKey({ kind: 'graph', graphId: 'g2' }))
  })
})

/** A real, always-resolving confirm — used by every test that isn't itself exercising the confirm gate (confirmRemove is now REQUIRED — wave1 review r1 WRONG fix). */
async function alwaysConfirm(): Promise<boolean> {
  return true
}

describe('access.manager — mounted via the real LayoutInterpreter', () => {
  function buildVehicle(
    service: ReturnType<typeof createAccessGrantService>,
    currentUserId: () => string,
    confirmRemove: (options: import('../access-manager-face.js').ConfirmRemoveOptions) => Promise<boolean> = alwaysConfirm,
  ) {
    const registry = new FaceRegistry()
    registry.register(createAccessManagerFace(currentUserId, confirmRemove))
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createAccessManagerResourceAdapter(service))
    return new LayoutInterpreter(root, { registry, broker })
  }

  it('mounts the real <mn-access-manager> in embedded mode with real fetched grants and a resolved owner role', async () => {
    const { service } = realAccessBackend([OWNER, EDITOR])
    const interpreter = buildVehicle(service, () => 'user:owner-1')

    const result = await interpreter.reconcile(accessLeaf('graph-a', 'Research Garden'), { width: 800, height: 600 })
    expect(result.ok).toBe(true)

    const el = interpreter.leafWrapperElement('access')!.querySelector('mn-access-manager') as MnAccessManagerLike
    expect(el).not.toBeNull()
    expect(el.embedded).toBe(true)
    expect(el.model?.graphId).toBe('graph-a')
    expect(el.model?.graphTitle).toBe('Research Garden')
    expect(el.model?.status).toBe('ready')
    expect(el.model?.currentRole).toBe('owner')
    expect(el.model?.grants.map((g) => g.userId)).toEqual(['user:editor-2'])

    await interpreter.dispose()
  })

  it('falls back to graphId when no graphTitle param is supplied', async () => {
    const { service } = realAccessBackend([OWNER])
    const interpreter = buildVehicle(service, () => 'user:owner-1')
    await interpreter.reconcile(accessLeaf('graph-b'), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('access')!.querySelector('mn-access-manager') as MnAccessManagerLike
    expect(el.model?.graphTitle).toBe('graph-b')
    await interpreter.dispose()
  })

  it('resolves currentRole "unknown" for a viewer not present in the fetched grants', async () => {
    const { service } = realAccessBackend([OWNER, EDITOR])
    const interpreter = buildVehicle(service, () => 'stranger-9')
    await interpreter.reconcile(accessLeaf('graph-a'), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('access')!.querySelector('mn-access-manager') as MnAccessManagerLike
    expect(el.model?.currentRole).toBe('unknown')
    await interpreter.dispose()
  })

  it('a real mn-access-add round-trips through canonical grant + refetch, driven by a real dispatched panel event', async () => {
    const { service, calls } = realAccessBackend([OWNER])
    const interpreter = buildVehicle(service, () => 'user:owner-1')
    await interpreter.reconcile(accessLeaf('graph-a'), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('access')!.querySelector('mn-access-manager') as MnAccessManagerLike

    el.dispatchEvent(new CustomEvent('mn-access-add', {
      bubbles: true,
      detail: { userId: 'user:viewer-3', role: 'viewer' },
    }))
    await waitFor(() => (el.model?.grants.length ?? 0) === 1)

    expect(el.model?.grants.map((g) => g.userId)).toEqual(['user:viewer-3'])
    expect(el.model?.notice).toMatch(/Added/)
    expect(calls.some(c => c.method === 'POST' && c.url === '/control/mcp' && JSON.stringify(c.body).includes('"action":"grant"'))).toBe(true)

    await interpreter.dispose()
  })

  it('a real mn-access-remove round-trips through canonical revoke + refetch', async () => {
    const { service } = realAccessBackend([OWNER, EDITOR])
    const interpreter = buildVehicle(service, () => 'user:owner-1')
    await interpreter.reconcile(accessLeaf('graph-a'), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('access')!.querySelector('mn-access-manager') as MnAccessManagerLike
    await waitFor(() => (el.model?.grants.length ?? 0) === 1)

    el.dispatchEvent(new CustomEvent('mn-access-remove', { bubbles: true, detail: { userId: 'user:editor-2' } }))
    await waitFor(() => (el.model?.grants.length ?? 0) === 0)
    expect(el.model?.grants.map((g) => g.userId)).toEqual([])
    expect(el.model?.notice).toMatch(/Removed/)

    await interpreter.dispose()
  })

  it('a REQUIRED confirmRemove gate blocks removal when it resolves false', async () => {
    const { service } = realAccessBackend([OWNER, EDITOR])
    let confirmCalls = 0
    const interpreter = buildVehicle(service, () => 'user:owner-1', async () => { confirmCalls += 1; return false })
    await interpreter.reconcile(accessLeaf('graph-a'), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('access')!.querySelector('mn-access-manager') as MnAccessManagerLike
    await waitFor(() => (el.model?.grants.length ?? 0) === 1)

    el.dispatchEvent(new CustomEvent('mn-access-remove', { bubbles: true, detail: { userId: 'user:editor-2' } }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(confirmCalls).toBe(1)
    expect(el.model?.grants.map((g) => g.userId)).toEqual(['user:editor-2'])

    await interpreter.dispose()
  })

  it('a non-owner mutation attempt is rejected client-side with an honest error, no request sent (checked BEFORE the owner-grant guard, matching real remove() ordering)', async () => {
    const { service, calls } = realAccessBackend([OWNER, EDITOR])
    let confirmCalls = 0
    const interpreter = buildVehicle(service, () => 'user:editor-2', async () => { confirmCalls += 1; return true })
    await interpreter.reconcile(accessLeaf('graph-a'), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('access')!.querySelector('mn-access-manager') as MnAccessManagerLike
    await waitFor(() => (el.model?.grants.length ?? 0) === 1)
    const priorCalls = calls.length

    el.dispatchEvent(new CustomEvent('mn-access-remove', { bubbles: true, detail: { userId: 'user:owner-1' } }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(el.model?.error).toMatch(/Only the workspace owner/)
    expect(calls.length).toBe(priorCalls)
    expect(confirmCalls).toBe(0) // never even reaches the confirm dialog

    await interpreter.dispose()
  })

  it('an owner CURRENT USER still cannot remove the owner grant itself — the owner-grant guard, distinct from the current-user guard (wave1 review r1 WRONG fix)', async () => {
    const { service, calls } = realAccessBackend([OWNER, EDITOR])
    let confirmCalls = 0
    const interpreter = buildVehicle(service, () => 'user:owner-1', async () => { confirmCalls += 1; return true })
    await interpreter.reconcile(accessLeaf('graph-a'), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('access')!.querySelector('mn-access-manager') as MnAccessManagerLike
    await waitFor(() => (el.model?.grants.length ?? 0) === 1)
    const priorCalls = calls.length

    el.dispatchEvent(new CustomEvent('mn-access-remove', { bubbles: true, detail: { userId: 'user:owner-1' } }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(el.model?.error).toBe('The owner grant cannot be removed.')
    expect(calls.length).toBe(priorCalls)
    expect(confirmCalls).toBe(0) // rejected before ever asking for confirmation

    await interpreter.dispose()
  })

  it('an owner role-change attempt on the owner grant is rejected client-side, no request sent (wave1 review r1 WRONG fix)', async () => {
    const { service, calls } = realAccessBackend([OWNER, EDITOR])
    const interpreter = buildVehicle(service, () => 'user:owner-1')
    await interpreter.reconcile(accessLeaf('graph-a'), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('access')!.querySelector('mn-access-manager') as MnAccessManagerLike
    await waitFor(() => (el.model?.grants.length ?? 0) === 1)
    const priorCalls = calls.length

    el.dispatchEvent(new CustomEvent('mn-access-role-change', { bubbles: true, detail: { userId: 'user:owner-1', role: 'viewer' } }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(el.model?.error).toBe('The owner grant cannot be changed through the member access API.')
    expect(calls.length).toBe(priorCalls)

    await interpreter.dispose()
  })

  it.each(['stale', 'refused'] as const)('does not publish success for an accepted grant followed by a %s reload', async kind => {
    const { service, grants } = realAccessBackend([])
    const interpreter = buildVehicle(service, () => 'owner-1')
    await interpreter.reconcile(accessLeaf('graph-a'), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('access')!.querySelector('mn-access-manager') as MnAccessManagerLike
    expect(el.model?.currentRole).toBe('owner')
    const list = vi.spyOn(service, 'list')
    if (kind === 'stale') list.mockResolvedValueOnce([])
    else list.mockRejectedValueOnce(new Error('synthetic reload refusal'))
    el.dispatchEvent(new CustomEvent('mn-access-add', { detail: { userId: 'user:reader', role: 'viewer' } }))
    await waitFor(() => el.model?.status === 'error')
    expect(grants.has('user:reader')).toBe(true)
    expect(el.model?.notice).toBeNull()
    expect(el.model?.error).toContain('accepted, but current membership could not be confirmed')
    const put = vi.spyOn(service, 'put')
    el.dispatchEvent(new CustomEvent('mn-access-add', { detail: { userId: 'user:other', role: 'viewer' } }))
    await Promise.resolve()
    expect(put).not.toHaveBeenCalled()
    await interpreter.dispose()
  })

  it('does not revoke after an old leaf confirmation resolves in a different workspace', async () => {
    const { service } = realAccessBackend([EDITOR])
    let resolveConfirm!: (value: boolean) => void
    const interpreter = buildVehicle(service, () => 'owner-1', () => new Promise(resolve => { resolveConfirm = resolve }))
    await interpreter.reconcile(accessLeaf('graph-a'), { width: 800, height: 600 })
    const old = interpreter.leafWrapperElement('access')!.querySelector('mn-access-manager') as MnAccessManagerLike
    const remove = vi.spyOn(service, 'remove')
    old.dispatchEvent(new CustomEvent('mn-access-remove', { detail: { userId: 'user:editor-2' } }))
    // A changed descriptor must increment the real interpreter's revision.
    await interpreter.reconcile(accessLeaf('graph-b', undefined, 1), { width: 800, height: 600 })
    const current = interpreter.leafWrapperElement('access')!.querySelector('mn-access-manager') as MnAccessManagerLike
    expect(current.model?.graphId).toBe('graph-b')
    resolveConfirm(true)
    await Promise.resolve()
    expect(remove).not.toHaveBeenCalled()
    await interpreter.dispose()
  })

  it('an honest error snapshot renders through status/error rather than a fabricated empty list', async () => {
    const transport: WorkspaceGatewayTransport = {
      resolveGatewayBaseUrl: () => 'https://gw.test',
      headers: () => ({}),
    }
    const service = createAccessGrantService(transport, (async () => new Response('{"error":"forbidden"}', { status: 403 })) as typeof fetch)
    const interpreter = buildVehicle(service, () => 'user:owner-1')
    await interpreter.reconcile(accessLeaf('graph-a'), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('access')!.querySelector('mn-access-manager') as MnAccessManagerLike
    expect(el.model?.status).toBe('error')
    expect(el.model?.error).toMatch(/HTTP 403/)
    await interpreter.dispose()
  })
})
