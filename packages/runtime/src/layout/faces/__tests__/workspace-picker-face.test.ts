/**
 * workspace-picker-face.test.ts — the FAST, network-free mount proof: a real
 * `FaceRegistry`/`LayoutResourceBroker`/`LayoutInterpreter`, and a real
 * `WorkspaceCatalogService` built by `createWorkspaceCatalogService` over a
 * fake-but-real `fetch` (the `hosted-viewer-rest-client.test.ts` "real async
 * function returning a real Response" convention — this is `workspace-
 * gateway-service.test.ts`'s own transport proof, reused as this suite's
 * network layer). `<mn-workspace-selector>` is not registered in this
 * package (`@shrubbery/runtime` cannot depend on `@shrubbery/components` —
 * `workspace-picker-face.ts`'s own header), so — mirroring `doc-history-
 * face.test.ts`'s own established boundary — these tests drive the mounted
 * element's REAL property/event contract directly via `dispatchEvent` with
 * the SAME event names/detail shapes the real component fires, proving the
 * FACE's controller wiring and real-service round trips. The real
 * component's own rendering is proven by a real-Chromium proof, not here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deepFreeze, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { FaceRegistry } from '../../face-registry.js'
import { LayoutResourceBroker } from '../../resource-broker.js'
import { LayoutInterpreter } from '../../layout-interpreter.js'
import { createSophiaHomeFace, createSophiaHomeResourceAdapter } from '../sophia-home-face.js'
import { createWorkspaceCatalogService, type WorkspaceCatalogEntry } from '../../../editor-services/workspace-gateway-service.js'
import {
  createWorkspacePickerFace,
  createWorkspacePickerResourceAdapter,
  WORKSPACE_CATALOG_IRI,
  WORKSPACE_PICKER_FACE_ID,
  WORKSPACE_PICKER_RESOURCE_ADAPTER_ID,
  type WorkspacePickerCapabilities,
} from '../workspace-picker-face.js'

interface MnWorkspaceSelectorLike extends HTMLElement {
  embedded: boolean
  workspaces: readonly { graphId: string; title: string; role: string; cellState: string; capabilities?: Record<string, unknown> }[]
  status: string
  error: string
  activeGraphId: string
  busyGraphId: string
  createCapability: { available: boolean; disabledReason?: string }
}

/** Real, deterministic capabilities — REQUIRED (wave1 review r1 WRONG fix); used by every test that isn't itself exercising create/delete. */
function realCapabilities(overrides: Partial<WorkspacePickerCapabilities> = {}): WorkspacePickerCapabilities {
  return {
    promptCreateTitle: async () => 'New Workspace',
    confirmDelete: async () => true,
    ...overrides,
  }
}

function fakeGraphsFetch(entries: WorkspaceCatalogEntry[], failNext = false): typeof fetch {
  return (async () => {
    if (failNext) return new Response('{"error":"forbidden"}', { status: 403 })
    return new Response(JSON.stringify(entries), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
}

/** A real, in-memory-backed fetch simulating the FULL graphs control-plane surface (GET/POST/DELETE) — a genuine implementation, not a stubbed return value (mirrors `access-manager-face.test.ts`'s own `realAccessBackend`). */
function realGraphsBackend(seed: WorkspaceCatalogEntry[]) {
  const graphs = new Map(seed.map((entry) => [entry.graphId, entry]))
  const calls: { method: string; url: string; body?: unknown }[] = []
  let nextId = 1
  const fetchImpl: typeof fetch = (async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    calls.push({ method, url: url.pathname, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const match = url.pathname.match(/^\/graphs(?:\/([^/]+))?$/u)
    if (!match) return new Response('{"error":"unhandled"}', { status: 404 })
    const graphId = match[1] ? decodeURIComponent(match[1]) : null
    if (method === 'GET' && !graphId) return new Response(JSON.stringify([...graphs.values()]), { status: 200 })
    if (method === 'POST' && !graphId) {
      const body = JSON.parse(String(init.body ?? '{}')) as { title?: string }
      const id = `g-created-${nextId++}`
      const entry: WorkspaceCatalogEntry = { graphId: id, title: body.title || id, cellState: 'running', role: 'owner' }
      graphs.set(id, entry)
      return new Response(JSON.stringify({ graphId: id, title: entry.title }), { status: 200 })
    }
    if (method === 'DELETE' && graphId) {
      graphs.delete(graphId)
      return new Response(null, { status: 204 })
    }
    return new Response('{"error":"method not allowed"}', { status: 405 })
  }) as typeof fetch
  return { fetchImpl, calls, graphs }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function pickerLeaf(activeGraphId?: string): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'workspace-picker-only',
    scope: 'session',
    graphId: null,
    rootNodeId: 'picker',
    nodes: {
      picker: {
        kind: 'leaf',
        id: 'picker',
        descriptor: {
          schemaVersion: 1,
          faceId: WORKSPACE_PICKER_FACE_ID,
          resource: { kind: 'iri', iri: WORKSPACE_CATALOG_IRI },
          ...(activeGraphId ? { params: { activeGraphId } } : {}),
        },
        descriptorRevision: 0,
      },
    },
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
  })
}

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

describe('workspace.picker — resource adapter', () => {
  it('is derived, accepts only the workspace-catalog iri locator, and has a stable resourceKey', () => {
    const service = createWorkspaceCatalogService({ resolveGatewayBaseUrl: () => 'https://gw.test', headers: () => ({}) }, fakeGraphsFetch([]))
    const adapter = createWorkspacePickerResourceAdapter(service)
    expect(adapter.shape).toBe('derived')
    expect(adapter.adapterId).toBe(WORKSPACE_PICKER_RESOURCE_ADAPTER_ID)
    expect(adapter.accepts({ kind: 'iri', iri: WORKSPACE_CATALOG_IRI })).toBe(true)
    expect(adapter.accepts({ kind: 'iri', iri: 'urn:sophia:home' })).toBe(false)
    expect(adapter.accepts({ kind: 'document', graphId: 'g', documentId: 'd' })).toBe(false)
    expect(adapter.resourceKey({ kind: 'iri', iri: WORKSPACE_CATALOG_IRI })).toBe(JSON.stringify(['iri', WORKSPACE_CATALOG_IRI]))
  })

  it('compute() never throws on a fetch failure — it captures an honest error snapshot instead', async () => {
    const service = createWorkspaceCatalogService({ resolveGatewayBaseUrl: () => 'https://gw.test', headers: () => ({}) }, fakeGraphsFetch([], true))
    const adapter = createWorkspacePickerResourceAdapter(service)
    const resource = await adapter.compute({ kind: 'iri', iri: WORKSPACE_CATALOG_IRI })
    expect(resource.status).toBe('error')
    expect(resource.entries).toEqual([])
    expect(resource.error).toMatch(/HTTP 403/)
  })
})

describe('workspace.picker — mounted via the real LayoutInterpreter', () => {
  function buildVehicle(
    service: ReturnType<typeof createWorkspaceCatalogService>,
    onSelect: (entry: WorkspaceCatalogEntry) => void,
    capabilities: WorkspacePickerCapabilities = realCapabilities(),
  ) {
    const registry = new FaceRegistry()
    registry.register(createWorkspacePickerFace(onSelect, capabilities))
    registry.register(createSophiaHomeFace())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createWorkspacePickerResourceAdapter(service))
    broker.registerAdapter(createSophiaHomeResourceAdapter())
    return new LayoutInterpreter(root, { registry, broker })
  }

  it('mounts the real <mn-workspace-selector> in embedded mode with a real fetched catalog', async () => {
    const entries: WorkspaceCatalogEntry[] = [
      { graphId: 'g1', title: 'Alpha Garden', cellState: 'running', role: 'owner' },
      { graphId: 'g2', title: 'Shared Notes', cellState: 'stopped', role: 'editor' },
    ]
    const service = createWorkspaceCatalogService({ resolveGatewayBaseUrl: () => 'https://gw.test', headers: () => ({}) }, fakeGraphsFetch(entries))
    const selected: WorkspaceCatalogEntry[] = []
    const interpreter = buildVehicle(service, (entry) => selected.push(entry))

    const result = await interpreter.reconcile(pickerLeaf('g1'), { width: 800, height: 600 })
    expect(result.ok).toBe(true)

    const wrapper = interpreter.leafWrapperElement('picker')!
    const el = wrapper.querySelector('mn-workspace-selector') as MnWorkspaceSelectorLike
    expect(el).not.toBeNull()
    expect(el.embedded).toBe(true)
    expect(el.activeGraphId).toBe('g1')
    // wave1 review r1 WRONG fix: create is genuinely available now, and
    // every row's `capabilities` is OMITTED (not an explicit `{}`) —
    // `mn-workspace-selector-model.ts`'s own backward-compatible
    // owner-delete inference path, the SAME real behavior production gets.
    expect(el.createCapability.available).toBe(true)
    expect(el.status).toBe('ready')
    expect(el.workspaces.map((w) => w.graphId)).toEqual(['g1', 'g2'])
    expect(el.workspaces.every((w) => w.capabilities === undefined)).toBe(true)

    // The real event contract: selecting a row forwards to the injected callback.
    el.dispatchEvent(new CustomEvent('mn-workspace-select', { detail: { workspace: el.workspaces[1] } }))
    expect(selected).toEqual([entries[1]])

    await interpreter.dispose()
  })

  it('mn-workspace-refresh re-runs the real service and updates the element in place', async () => {
    let call = 0
    const fetchImpl: typeof fetch = (async () => {
      call += 1
      const entries: WorkspaceCatalogEntry[] = call === 1
        ? [{ graphId: 'g1', title: 'First', cellState: 'running', role: 'owner' }]
        : [{ graphId: 'g1', title: 'First', cellState: 'running', role: 'owner' }, { graphId: 'g2', title: 'Second', cellState: 'running', role: 'viewer' }]
      return new Response(JSON.stringify(entries), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    const service = createWorkspaceCatalogService({ resolveGatewayBaseUrl: () => 'https://gw.test', headers: () => ({}) }, fetchImpl)
    const interpreter = buildVehicle(service, () => {})

    await interpreter.reconcile(pickerLeaf(), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('picker')!.querySelector('mn-workspace-selector') as MnWorkspaceSelectorLike
    expect(el.workspaces).toHaveLength(1)

    el.dispatchEvent(new CustomEvent('mn-workspace-refresh', {}))
    await waitFor(() => el.workspaces.length === 2)
    expect(call).toBe(2)

    await interpreter.dispose()
  })

  it('an honest error snapshot renders through status/error rather than a fabricated empty list', async () => {
    const service = createWorkspaceCatalogService({ resolveGatewayBaseUrl: () => 'https://gw.test', headers: () => ({}) }, fakeGraphsFetch([], true))
    const interpreter = buildVehicle(service, () => {})
    await interpreter.reconcile(pickerLeaf(), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('picker')!.querySelector('mn-workspace-selector') as MnWorkspaceSelectorLike
    expect(el.status).toBe('error')
    expect(el.error).toMatch(/HTTP 403/)
    await interpreter.dispose()
  })

  // wave1 review r1 WRONG fix: create/delete used to be entirely unwired.
  it('mn-workspace-create prompts for a title, POSTs a real create, and forwards the new workspace to onSelectWorkspace', async () => {
    const { fetchImpl, calls } = realGraphsBackend([{ graphId: 'g1', title: 'Alpha', cellState: 'running', role: 'owner' }])
    const service = createWorkspaceCatalogService({ resolveGatewayBaseUrl: () => 'https://gw.test', headers: () => ({}) }, fetchImpl)
    const selected: WorkspaceCatalogEntry[] = []
    const interpreter = buildVehicle(service, (entry) => selected.push(entry), realCapabilities({ promptCreateTitle: async () => 'Second Garden' }))
    await interpreter.reconcile(pickerLeaf(), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('picker')!.querySelector('mn-workspace-selector') as MnWorkspaceSelectorLike
    await waitFor(() => el.workspaces.length === 1)

    el.dispatchEvent(new CustomEvent('mn-workspace-create', {}))
    await waitFor(() => el.workspaces.length === 2)

    expect(calls.some((c) => c.method === 'POST' && c.url === '/graphs' && (c.body as { title?: string })?.title === 'Second Garden')).toBe(true)
    expect(selected).toHaveLength(1)
    expect(selected[0]?.title).toBe('Second Garden')

    await interpreter.dispose()
  })

  it('mn-workspace-create does nothing when the title prompt is cancelled (null) — no request sent', async () => {
    const { fetchImpl, calls } = realGraphsBackend([{ graphId: 'g1', title: 'Alpha', cellState: 'running', role: 'owner' }])
    const service = createWorkspaceCatalogService({ resolveGatewayBaseUrl: () => 'https://gw.test', headers: () => ({}) }, fetchImpl)
    const interpreter = buildVehicle(service, () => {}, realCapabilities({ promptCreateTitle: async () => null }))
    await interpreter.reconcile(pickerLeaf(), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('picker')!.querySelector('mn-workspace-selector') as MnWorkspaceSelectorLike
    await waitFor(() => el.workspaces.length === 1)
    const priorCalls = calls.length

    el.dispatchEvent(new CustomEvent('mn-workspace-create', {}))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls.length).toBe(priorCalls)

    await interpreter.dispose()
  })

  it('mn-workspace-delete on an owned row confirms, then DELETEs and reloads the real catalog', async () => {
    const { fetchImpl, calls } = realGraphsBackend([
      { graphId: 'g1', title: 'Alpha', cellState: 'running', role: 'owner' },
      { graphId: 'g2', title: 'Beta', cellState: 'running', role: 'owner' },
    ])
    const service = createWorkspaceCatalogService({ resolveGatewayBaseUrl: () => 'https://gw.test', headers: () => ({}) }, fetchImpl)
    let confirmCalls = 0
    const interpreter = buildVehicle(service, () => {}, realCapabilities({ confirmDelete: async () => { confirmCalls += 1; return true } }))
    await interpreter.reconcile(pickerLeaf(), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('picker')!.querySelector('mn-workspace-selector') as MnWorkspaceSelectorLike
    await waitFor(() => el.workspaces.length === 2)

    const target = el.workspaces.find((w) => w.graphId === 'g2')!
    el.dispatchEvent(new CustomEvent('mn-workspace-delete', { detail: { workspace: target } }))
    await waitFor(() => el.workspaces.length === 1)

    expect(confirmCalls).toBe(1)
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/graphs/g2')).toBe(true)
    expect(el.workspaces.map((w) => w.graphId)).toEqual(['g1'])

    await interpreter.dispose()
  })

  it('mn-workspace-delete is gated behind confirm — declining leaves the workspace untouched', async () => {
    const { fetchImpl, calls } = realGraphsBackend([{ graphId: 'g1', title: 'Alpha', cellState: 'running', role: 'owner' }])
    const service = createWorkspaceCatalogService({ resolveGatewayBaseUrl: () => 'https://gw.test', headers: () => ({}) }, fetchImpl)
    let confirmCalls = 0
    const interpreter = buildVehicle(service, () => {}, realCapabilities({ confirmDelete: async () => { confirmCalls += 1; return false } }))
    await interpreter.reconcile(pickerLeaf(), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('picker')!.querySelector('mn-workspace-selector') as MnWorkspaceSelectorLike
    await waitFor(() => el.workspaces.length === 1)

    el.dispatchEvent(new CustomEvent('mn-workspace-delete', { detail: { workspace: el.workspaces[0] } }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(confirmCalls).toBe(1)
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(el.workspaces).toHaveLength(1)

    await interpreter.dispose()
  })

  it('mn-workspace-delete on a NON-owned row is refused client-side — never even reaches confirm (defense in depth)', async () => {
    const { fetchImpl, calls } = realGraphsBackend([{ graphId: 'g1', title: 'Alpha', cellState: 'running', role: 'editor' }])
    const service = createWorkspaceCatalogService({ resolveGatewayBaseUrl: () => 'https://gw.test', headers: () => ({}) }, fetchImpl)
    let confirmCalls = 0
    const interpreter = buildVehicle(service, () => {}, realCapabilities({ confirmDelete: async () => { confirmCalls += 1; return true } }))
    await interpreter.reconcile(pickerLeaf(), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('picker')!.querySelector('mn-workspace-selector') as MnWorkspaceSelectorLike
    await waitFor(() => el.workspaces.length === 1)

    el.dispatchEvent(new CustomEvent('mn-workspace-delete', { detail: { workspace: el.workspaces[0] } }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(confirmCalls).toBe(0)
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

    await interpreter.dispose()
  })

  // Production parity (`main.ts`'s `deleteHostedWorkspace` last-editable guard).
  it('refuses to delete the ACTIVE workspace when no other editable one remains — before confirm, with an honest error', async () => {
    const { fetchImpl, calls } = realGraphsBackend([{ graphId: 'g1', title: 'Alpha', cellState: 'running', role: 'owner' }])
    const service = createWorkspaceCatalogService({ resolveGatewayBaseUrl: () => 'https://gw.test', headers: () => ({}) }, fetchImpl)
    let confirmCalls = 0
    const interpreter = buildVehicle(service, () => {}, realCapabilities({ confirmDelete: async () => { confirmCalls += 1; return true } }))
    await interpreter.reconcile(pickerLeaf('g1'), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('picker')!.querySelector('mn-workspace-selector') as MnWorkspaceSelectorLike
    await waitFor(() => el.workspaces.length === 1)

    el.dispatchEvent(new CustomEvent('mn-workspace-delete', { detail: { workspace: el.workspaces[0] } }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(confirmCalls).toBe(0)
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(el.error).toBe('Create another editable workspace before deleting the active workspace.')

    await interpreter.dispose()
  })

  it('allows deleting the ACTIVE workspace when another editable workspace remains as a fallback', async () => {
    const { fetchImpl, calls } = realGraphsBackend([
      { graphId: 'g1', title: 'Alpha', cellState: 'running', role: 'owner' },
      { graphId: 'g2', title: 'Beta', cellState: 'running', role: 'owner' },
    ])
    const service = createWorkspaceCatalogService({ resolveGatewayBaseUrl: () => 'https://gw.test', headers: () => ({}) }, fetchImpl)
    let confirmCalls = 0
    const interpreter = buildVehicle(service, () => {}, realCapabilities({ confirmDelete: async () => { confirmCalls += 1; return true } }))
    await interpreter.reconcile(pickerLeaf('g1'), { width: 800, height: 600 })
    const el = interpreter.leafWrapperElement('picker')!.querySelector('mn-workspace-selector') as MnWorkspaceSelectorLike
    await waitFor(() => el.workspaces.length === 2)

    const active = el.workspaces.find((w) => w.graphId === 'g1')!
    el.dispatchEvent(new CustomEvent('mn-workspace-delete', { detail: { workspace: active } }))
    await waitFor(() => el.workspaces.length === 1)

    expect(confirmCalls).toBe(1)
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/graphs/g1')).toBe(true)
    expect(el.workspaces.map((w) => w.graphId)).toEqual(['g2'])

    await interpreter.dispose()
  })
})
