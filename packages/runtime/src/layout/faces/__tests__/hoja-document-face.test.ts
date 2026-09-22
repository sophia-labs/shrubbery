/**
 * hoja-document-face.test.ts — the FAST proof: real `EditorRoomPool` (the
 * exact hoisted class `packages/runtime/src/collab/editor-room-pool.ts`) over
 * a real in-process CRDT backend (`harness/in-process-crdt-backend.ts` — real
 * `Y.Doc`/`Awareness`, no `vi.mock`), driven through the real
 * `FaceRegistry`/`LayoutResourceBroker`/`LayoutInterpreter` machinery. No
 * network — that proof is `hoja-document-face.integration.test.ts`'s job
 * (real spawned gardend + real WebSocket doc room).
 *
 * Proves the design's "Proving leaf A" bullets (§9.1) at the in-process
 * layer: two leaves on the same document share one exact provider object;
 * each leaf gets its own live `<sh-editor-host>`; closing one leaf leaves the
 * other's provider alive; closing the last leaf disposes the room exactly
 * once.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSophiaHomeDescriptor, deepFreeze, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { FaceRegistry } from '../../face-registry.js'
import { LayoutResourceBroker } from '../../resource-broker.js'
import { LayoutInterpreter } from '../../layout-interpreter.js'
import { EditorRoomPool, type EditorRoomLease } from '../../../collab/editor-room-pool.js'
import { InProcessCrdtBackend } from '../../../harness/in-process-crdt-backend.js'
import {
  createHojaDocumentFace,
  createHojaDocumentResourceAdapter,
  HOJA_DOCUMENT_FACE_ID,
} from '../hoja-document-face.js'
import { createSophiaHomeFace, createSophiaHomeResourceAdapter } from '../sophia-home-face.js'

/**
 * Mirrors the broker's own namespaced diagnostics key exactly:
 * resource-key.ts's `resourceKeyTuple('hoja.document.room-pool',
 * resourceKeyTuple('document', graphId, documentId))` — resource-broker.ts's
 * `acquireDurable` wraps every adapter's raw `resourceKey()` in an
 * adapter-id-qualified tuple (diff-review r2 WRONG's "namespace cache keys
 * by adapter identity" companion fix) before it ever reaches
 * `diagnostics().durableRefCounts`. Kept local so this test fails loudly if
 * either encoding ever drifts silently.
 */
function documentResourceKeyFor(graphId: string, documentId: string): string {
  const rawKey = JSON.stringify(['document', graphId, documentId])
  return JSON.stringify(['hoja.document.room-pool', rawKey])
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function documentLeaf(id: string, documentId: string, graphId = 'g1') {
  return {
    kind: 'leaf' as const,
    id,
    descriptor: {
      schemaVersion: 1 as const,
      faceId: HOJA_DOCUMENT_FACE_ID,
      resource: { kind: 'document' as const, graphId, documentId },
    },
    descriptorRevision: 0,
  }
}

function oneLeafDoc(documentId: string): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'hoja-only',
    scope: 'session',
    graphId: null,
    rootNodeId: 'a',
    nodes: { a: documentLeaf('a', documentId) },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  })
}

function twoLeafSameDocumentDoc(documentId: string): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'hoja-split',
    scope: 'session',
    graphId: null,
    rootNodeId: 'split',
    nodes: {
      split: { kind: 'split', id: 'split', axis: 'horizontal', startNodeId: 'a', endNodeId: 'b', startBasisPoints: 5000 },
      a: documentLeaf('a', documentId),
      b: documentLeaf('b', documentId),
    },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
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

function buildInterpreter(pool: EditorRoomPool): LayoutInterpreter {
  const registry = new FaceRegistry()
  registry.register(createHojaDocumentFace())
  const broker = new LayoutResourceBroker()
  broker.registerAdapter(createHojaDocumentResourceAdapter(pool))
  return new LayoutInterpreter(root, { registry, broker })
}

describe('hoja.document — resource adapter wraps EditorRoomPool, does not duplicate it', () => {
  it('accepts only document locators; resourceKey is graphId+documentId', () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const adapter = createHojaDocumentResourceAdapter(pool)
    expect(adapter.shape).toBe('durable')
    expect(adapter.accepts({ kind: 'document', graphId: 'g', documentId: 'd' })).toBe(true)
    expect(adapter.accepts({ kind: 'iri', iri: 'urn:x' })).toBe(false)
    expect(adapter.resourceKey({ kind: 'document', graphId: 'g1', documentId: 'doc-a' })).toBe(
      JSON.stringify(['document', 'g1', 'doc-a']),
    )
  })

  // diff-review r2 WRONG: "one shared ProviderHandle per document key" — the
  // key must be collision-safe, not a naive colon-join, or (a:b,c) and
  // (a,b:c) collide into the same string.
  it('resourceKey is collision-safe for delimiter-bearing graphId/documentId (diff-review r2)', () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const adapter = createHojaDocumentResourceAdapter(pool)
    const keyAB_C = adapter.resourceKey({ kind: 'document', graphId: 'a:b', documentId: 'c' })
    const keyA_BC = adapter.resourceKey({ kind: 'document', graphId: 'a', documentId: 'b:c' })
    expect(keyAB_C).not.toBe(keyA_BC)
  })

  it('load() delegates to pool.acquire — the pool, not the adapter, opens the provider', async () => {
    const backend = new InProcessCrdtBackend()
    const pool = new EditorRoomPool(backend)
    const adapter = createHojaDocumentResourceAdapter(pool)
    const lease = await adapter.load({ kind: 'document', graphId: 'g1', documentId: 'doc-a' })
    expect(pool.snapshot().roomCount).toBe(1)
    // The provider's Y.Doc is the SAME room object the backend (not the adapter) opened.
    expect(lease.provider.doc).toBe(backend.roomDocument({ kind: 'doc', graphId: 'g1', docId: 'doc-a' }))
    adapter.dispose(lease, 'document:g1:doc-a')
    expect(pool.snapshot().roomCount).toBe(0)
  })
})

// F1 (repair round 3): the broker reacquire race reproduced against the
// REAL `EditorRoomPool` (hoisted `packages/runtime/src/collab/editor-room-
// pool.ts`) — see hoja-document-face.ts's `load()` comment for the full
// mechanism. No mocks: a real pool, a real in-process Y.Doc-backed CRDT
// backend, a real `LayoutResourceBroker`.
describe('hoja.document — F1: broker reacquire race against a real EditorRoomPool', () => {
  it('release() then an immediate reacquire of the SAME document key does not throw "already live"', async () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createHojaDocumentResourceAdapter(pool))
    const locator = { kind: 'document' as const, graphId: 'g1', documentId: 'doc-race' }

    const first = await broker.acquire(locator, 'hoja.document.room-pool')
    // Deliberately NO `await broker.settled()` here — release() deletes the
    // broker's durableEntries entry synchronously, but the pool-level
    // release it schedules (resource-broker.ts's `runDisposal`) is deferred
    // to a microtask. Reacquiring in the very next statement, with no
    // `await` in between, races that deferred disposal on purpose.
    first.release()

    const second = await broker.acquire(locator, 'hoja.document.room-pool')
    expect((second.value as EditorRoomLease).released).toBe(false)
    expect(pool.snapshot().roomCount).toBe(1) // same room, reused — not a duplicate open

    await broker.settled()
    second.release()
    await broker.settled()
    expect(pool.snapshot().roomCount).toBe(0)
  })

  it('two LayoutResourceBrokers sharing one EditorRoomPool on the same document share the exact same real provider', async () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const brokerOne = new LayoutResourceBroker()
    brokerOne.registerAdapter(createHojaDocumentResourceAdapter(pool))
    const brokerTwo = new LayoutResourceBroker()
    brokerTwo.registerAdapter(createHojaDocumentResourceAdapter(pool))
    const locator = { kind: 'document' as const, graphId: 'g1', documentId: 'doc-shared-across-brokers' }

    const leaseOne = await brokerOne.acquire(locator, 'hoja.document.room-pool')
    const leaseTwo = await brokerTwo.acquire(locator, 'hoja.document.room-pool')

    expect((leaseOne.value as EditorRoomLease).provider).toBe((leaseTwo.value as EditorRoomLease).provider)
    expect(pool.snapshot().roomCount).toBe(1) // one real room…
    expect(pool.snapshot().rooms[0]!.refCount).toBe(2) // …two distinct pool attachments, one per broker

    leaseOne.release()
    await brokerOne.settled()
    expect(pool.snapshot().roomCount).toBe(1) // brokerTwo's independent lease keeps the room alive

    leaseTwo.release()
    await brokerTwo.settled()
    expect(pool.snapshot().roomCount).toBe(0)
  })
})

describe('hoja.document — real interpreter mount', () => {
  it('mounts a real <sh-editor-host> in contained layout mode, bound to the pool provider', async () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const interpreter = buildInterpreter(pool)
    const result = await interpreter.reconcile(oneLeafDoc('doc-a'), { width: 500, height: 300 })
    expect(result.ok).toBe(true)

    const wrapper = interpreter.leafWrapperElement('a')!
    const host = wrapper.querySelector('sh-editor-host') as HTMLElement & { layoutMode: string; binding: unknown }
    expect(host).not.toBeNull()
    expect(host.layoutMode).toBe('contained')
    expect(host.getAttribute('layout-mode')).toBe('contained')
    expect(host.binding).not.toBeNull()

    await interpreter.dispose()
  })

  it('a real live EditorView (ProseMirror body) eventually mounts inside the shadow root', async () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const interpreter = buildInterpreter(pool)
    await interpreter.reconcile(oneLeafDoc('doc-a'), { width: 500, height: 300 })
    const host = interpreter.leafWrapperElement('a')!.querySelector('sh-editor-host') as HTMLElement

    await waitFor(() => host.shadowRoot?.querySelector('.editor-mount .ProseMirror') != null)
    const pm = host.shadowRoot!.querySelector('.editor-mount .ProseMirror') as HTMLElement
    expect(pm.getAttribute('contenteditable')).not.toBeNull()

    await interpreter.dispose()
  })
})

describe('hoja.document — two leaves on the same document share ONE exact provider (design §9.1)', () => {
  it('one pool room, one broker lease key, two distinct <sh-editor-host> elements with the SAME provider', async () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const registry = new FaceRegistry()
    registry.register(createHojaDocumentFace())
    const broker = new LayoutResourceBroker()
    const adapter = createHojaDocumentResourceAdapter(pool)
    broker.registerAdapter(adapter)
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const result = await interpreter.reconcile(twoLeafSameDocumentDoc('doc-shared'), { width: 1000, height: 400 })
    expect(result.ok).toBe(true)

    // The BROKER only ever loaded once for this key (its own dedup — resource-broker.ts).
    expect(broker.diagnostics().durableRefCounts[documentResourceKeyFor('g1', 'doc-shared')]).toBe(2)
    // The POOL only ever opened one room too (adapter.load called exactly once).
    expect(pool.snapshot().roomCount).toBe(1)
    expect(pool.snapshot().rooms[0].refCount).toBe(1) // one pool attachment, shared by the broker's 2 layout leases

    const hostA = interpreter.leafWrapperElement('a')!.querySelector('sh-editor-host') as HTMLElement & { binding: { get(): { provider: unknown } } }
    const hostB = interpreter.leafWrapperElement('b')!.querySelector('sh-editor-host') as HTMLElement & { binding: { get(): { provider: unknown } } }
    expect(hostA).not.toBe(hostB) // distinct client-local view instances…
    expect(hostA.binding.get().provider).toBe(hostB.binding.get().provider) // …over the exact same provider object

    await waitFor(() => {
      const pmA = hostA.shadowRoot?.querySelector('.editor-mount .ProseMirror')
      const pmB = hostB.shadowRoot?.querySelector('.editor-mount .ProseMirror')
      return pmA != null && pmB != null
    })
    const pmA = hostA.shadowRoot!.querySelector('.editor-mount .ProseMirror')
    const pmB = hostB.shadowRoot!.querySelector('.editor-mount .ProseMirror')
    expect(pmA).not.toBe(pmB) // each leaf has its OWN EditorView DOM, not a shared one

    await interpreter.dispose()
  })

  it('closing one leaf leaves the other provider alive; closing the last one disposes the room once', async () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const registry = new FaceRegistry()
    registry.register(createHojaDocumentFace())
    // LAY-010: closing the LAST leaf replaces its descriptor with sophia.home
    // — that replacement is itself validated against this same registry, so
    // sophia.home must be registered here too (exactly the real organism
    // wiring: every face a document can legally reach lives in ONE registry).
    registry.register(createSophiaHomeFace())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createHojaDocumentResourceAdapter(pool))
    broker.registerAdapter(createSophiaHomeResourceAdapter())
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const { applyOperation, locateParent } = await import('@shrubbery/nucleus/layout')
    const doc0 = twoLeafSameDocumentDoc('doc-shared')
    await interpreter.reconcile(doc0, { width: 1000, height: 400 })
    expect(pool.snapshot().roomCount).toBe(1)

    const closeB = applyOperation(doc0, { op: 'close_leaf', leafId: 'b', expectedParent: locateParent(doc0, 'b')! }, {
      isFaceRegistered: registry.toFaceRegistrationPredicate(),
    })
    if (!closeB.ok) throw new Error(`close_leaf failed: ${closeB.diagnostic.code}`)
    await interpreter.reconcile(closeB.doc, { width: 1000, height: 400 })

    // 'a' still live, provider not destroyed — one lease remains.
    expect(pool.snapshot().roomCount).toBe(1)
    expect(broker.diagnostics().durableRefCounts[documentResourceKeyFor('g1', 'doc-shared')]).toBe(1)

    const closeA = applyOperation(closeB.doc, { op: 'close_leaf', leafId: 'a', expectedParent: locateParent(closeB.doc, 'a')! }, {
      isFaceRegistered: registry.toFaceRegistrationPredicate(),
    })
    if (!closeA.ok) throw new Error(`close_leaf failed: ${closeA.diagnostic.code}`)
    await interpreter.reconcile(closeA.doc, { width: 1000, height: 400 })

    // Last leaf closed → LAY-010 replaces it with sophia.home, whose descriptor
    // is a DIFFERENT resource — the hoja document's lease is fully released
    // (the pool room is gone) even though the leaf itself lives on with a
    // brand-new (trivial) sophia.home lease.
    expect(pool.snapshot().roomCount).toBe(0)
    expect(broker.diagnostics().durableRefCounts[documentResourceKeyFor('g1', 'doc-shared')]).toBeUndefined()
    expect(broker.diagnostics().outstandingLeases).toBe(1) // the leaf's new sophia.home lease

    await interpreter.dispose()
  })

  // diff-review r2 WRONG: "lease release can still throw synchronously" —
  // proved here at the REAL end-to-end depth the finding names: a real
  // EditorRoomPool over a real ProviderHandle whose OWN destroy() throws
  // (the room's actual last-release teardown path, hoja-document-face.ts's
  // `dispose(value) { value.release() }` -> pool.release -> provider.destroy).
  // With `LayoutResourceBroker`'s own fix (resource-broker.ts's `runDisposal`
  // defers the adapter.dispose() CALL itself into a microtask), the real
  // `lease.release()` the interpreter calls no longer throws AT ALL — the
  // failure surfaces asynchronously as a retained `disposalError`, not as an
  // `interpreter.dispose()` rejection. This is the end-to-end proof that the
  // fix holds all the way down to a REAL provider, not just the fixture-level
  // proof in resource-broker.test.ts / layout-interpreter.test.ts (whose
  // "SYNCHRONOUSLY throwing lease.release()" test instead exercises a
  // hand-written NON-LayoutResourceBroker to prove the interpreter's own
  // independent guard).
  it('a real provider whose destroy() throws does not abort LayoutInterpreter.dispose(); the failure surfaces as a retained broker disposalError', async () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const registry = new FaceRegistry()
    registry.register(createHojaDocumentFace())
    registry.register(createSophiaHomeFace())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createHojaDocumentResourceAdapter(pool))
    broker.registerAdapter(createSophiaHomeResourceAdapter())
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const doc0: LayoutDocument = deepFreeze({
      schemaVersion: 1,
      layoutId: 'hoja-provider-destroy-throws',
      scope: 'session',
      graphId: null,
      rootNodeId: 'split',
      nodes: {
        split: { kind: 'split', id: 'split', axis: 'horizontal', startNodeId: 'a', endNodeId: 'b', startBasisPoints: 5000 },
        a: documentLeaf('a', 'doc-breaks-on-destroy'),
        b: { kind: 'leaf', id: 'b', descriptor: createSophiaHomeDescriptor(), descriptorRevision: 0 },
      },
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    })
    await interpreter.reconcile(doc0, { width: 1000, height: 600 })

    // Break the REAL provider's real destroy() — a genuine object, one
    // method deliberately made to fail, not a vi.mock stand-in for the whole
    // collab plane.
    const hostA = interpreter.leafWrapperElement('a')!.querySelector('sh-editor-host') as HTMLElement & {
      binding: { get(): { provider: { destroy(): void } } }
    }
    const realProvider = hostA.binding.get().provider
    const realDestroy = realProvider.destroy.bind(realProvider)
    let destroyAttempted = false
    realProvider.destroy = () => {
      destroyAttempted = true
      throw new Error('boom: real provider destroy() failed')
    }

    // No throw, no hang — dispose() resolves cleanly despite the real
    // provider's real destroy() failing underneath it.
    await expect(interpreter.dispose()).resolves.toBeUndefined()
    await broker.settled()
    expect(destroyAttempted).toBe(true)
    // The interpreter still finished tearing down EVERYTHING despite the
    // real provider's real destroy() throwing.
    expect(interpreter.diagnostics().mountedLeafIds).toEqual([])
    expect(root.children).toHaveLength(0)

    // The failure is not silently lost — it is retained on the broker for
    // exactly this purpose (diff-review r2 WRONG: "retain/report disposal errors").
    const disposalErrors = broker.takeDisposalErrors()
    expect(disposalErrors).toHaveLength(1)
    expect((disposalErrors[0]!.error as Error).message).toContain('real provider destroy() failed')

    // Clean up the real Y.Doc/awareness this test intentionally broke, so it
    // does not leak past the test (restore the real destroy and call it).
    realProvider.destroy = realDestroy
    realProvider.destroy()
  })
})

describe('hoja.document — FaceView lifecycle', () => {
  it('dispose() removes the host element (view only); the interpreter releases the lease separately', async () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const interpreter = buildInterpreter(pool)
    await interpreter.reconcile(oneLeafDoc('doc-a'), { width: 500, height: 300 })
    const wrapper = interpreter.leafWrapperElement('a')!
    expect(wrapper.querySelector('sh-editor-host')).not.toBeNull()

    await interpreter.dispose()
    expect(wrapper.isConnected).toBe(false)
    expect(pool.snapshot().roomCount).toBe(0)
  })

  it('resize() never mutates the pool/broker (MUST NOT write layout state)', async () => {
    const pool = new EditorRoomPool(new InProcessCrdtBackend())
    const interpreter = buildInterpreter(pool)
    await interpreter.reconcile(oneLeafDoc('doc-a'), { width: 500, height: 300 })
    const before = pool.snapshot()
    await interpreter.reconcile(oneLeafDoc('doc-a'), { width: 900, height: 300 })
    expect(pool.snapshot().roomCount).toBe(before.roomCount)
    await interpreter.dispose()
  })
})
