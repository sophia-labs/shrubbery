/**
 * layout-interpreter-grid.test.ts — the grid/collection renderer (Wave 2 x
 * Lane B spec `plans/surface-wave2-laneb-slice-20260716.md` §3): mount,
 * reflow, refresh-reconcile, error-cell, and lease accounting, all against
 * REAL `FaceRegistration`/`ResourceAdapter` implementations (fixtures.ts) —
 * no `vi.mock`, mirroring `layout-interpreter.test.ts`'s own no-mocks
 * discipline for the leaf/split renderer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutDocument, ViewDescriptor } from '@shrubbery/nucleus/layout'
import { LayoutInterpreter, buildGridCollectionCellDescriptor, collectionItemIri } from '../layout-interpreter.js'
import { FaceRegistry } from '../face-registry.js'
import { LayoutResourceBroker } from '../resource-broker.js'
import { createSurfaceResourceStore, refreshSurfaceResourceStore } from '../resource-store.js'
import {
  noFaceParams,
  type DerivedResourceAdapter,
  type GridCollectionQueryHandle,
  type GridCollectionRow,
} from '../types.js'
import {
  buildTestBroker,
  buildTestRegistry,
  collectionGridChildren,
  createGatedBlobAdapter,
  createGatedMediaFace,
  createGridCollectionAdapter,
  createPersistentNonRelocatableFace,
  documentDescriptor,
  fixedGridChildren,
  freshDocument,
  gridCell,
  gridNode,
  leafNode,
  mediaDescriptor,
  splitNode,
} from './fixtures.js'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
  vi.useRealTimers()
})

// ── fixed-source grids ──────────────────────────────────────────────────────

describe('LayoutInterpreter — fixed grid: initial mount', () => {
  it('mounts every cell INSIDE the grid wrapper (the sanctioned nesting exception) with real leases', async () => {
    const { registry, documentFace, mediaFace } = buildTestRegistry()
    const { broker, documentAdapter, blobAdapter } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const doc = freshDocument('grid-1', {
      'grid-1': gridNode(
        'grid-1',
        fixedGridChildren([
          gridCell('x', documentDescriptor('doc-x')),
          gridCell('y', mediaDescriptor('urn:test:y')),
        ]),
      ),
    })
    const result = await interpreter.reconcile(doc, { width: 800, height: 400 })
    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])

    expect(documentFace.mounts).toHaveLength(1)
    expect(mediaFace.mounts).toHaveLength(1)
    expect(documentAdapter.loadCalls).toHaveLength(1)
    expect(blobAdapter.loadCalls).toHaveLength(1)

    const outer = interpreter.gridWrapperElement('grid-1')!
    const interior = interpreter.gridInteriorElement('grid-1')!
    const wrapperX = interpreter.gridCellWrapperElement('grid-1', 'x')!
    const wrapperY = interpreter.gridCellWrapperElement('grid-1', 'y')!
    expect(outer.parentElement).toBe(root)
    expect(interior.parentElement).toBe(outer)
    expect(wrapperX.parentElement).toBe(interior)
    expect(wrapperY.parentElement).toBe(interior)
    expect(outer.style.overflowY).toBe('auto')
    expect(interior.style.display).toBe('grid')

    expect(interpreter.mountedGridCellView('grid-1', 'x')).not.toBeNull()
    expect(interpreter.mountedGridCellView('grid-1', 'y')).not.toBeNull()
    expect(broker.diagnostics().outstandingLeases).toBe(2)

    await interpreter.dispose()
    expect(broker.diagnostics().outstandingLeases).toBe(0)
  })

  it('applies the reflow span hint as a CSS grid-column', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc = freshDocument('grid-1', {
      'grid-1': gridNode('grid-1', fixedGridChildren([gridCell('x', documentDescriptor('doc-x'), 2)])),
    })
    await interpreter.reconcile(doc, { width: 800, height: 400 })
    expect(interpreter.gridCellWrapperElement('grid-1', 'x')!.style.gridColumn).toBe('span 2')
    await interpreter.dispose()
  })

  it('the count badge stays hidden for a fixed source (no maxItems concept)', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc = freshDocument('grid-1', {
      'grid-1': gridNode('grid-1', fixedGridChildren([gridCell('x', documentDescriptor('doc-x'))])),
    })
    await interpreter.reconcile(doc, { width: 800, height: 400 })
    expect(interpreter.gridCountBadgeElement('grid-1')!.hidden).toBe(true)
    await interpreter.dispose()
  })
})

describe('LayoutInterpreter — fixed grid: reflow does NOT remount', () => {
  it('a second reconcile of the SAME cells calls resize() again without remounting', async () => {
    const { registry, documentFace } = buildTestRegistry()
    const { broker, documentAdapter } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc = freshDocument('grid-1', {
      'grid-1': gridNode('grid-1', fixedGridChildren([gridCell('x', documentDescriptor('doc-x'))])),
    })
    await interpreter.reconcile(doc, { width: 800, height: 400 })
    const viewBefore = interpreter.mountedGridCellView('grid-1', 'x')
    const wrapperBefore = interpreter.gridCellWrapperElement('grid-1', 'x')

    await interpreter.reconcile(doc, { width: 900, height: 500 })

    expect(documentFace.mounts).toHaveLength(1) // no remount
    expect(documentAdapter.loadCalls).toHaveLength(1) // no reload
    expect(documentFace.mounts[0].resizeCalls.length).toBeGreaterThanOrEqual(2) // mount-time + reflow
    expect(interpreter.mountedGridCellView('grid-1', 'x')).toBe(viewBefore) // same view instance
    expect(interpreter.gridCellWrapperElement('grid-1', 'x')).toBe(wrapperBefore) // same wrapper instance

    await interpreter.dispose()
  })
})

describe('LayoutInterpreter — fixed grid: content-signature reconciliation', () => {
  it('a changed cell descriptor remounts; an UNCHANGED sibling cell keeps its view', async () => {
    const { registry, documentFace, mediaFace } = buildTestRegistry()
    const { broker, documentAdapter } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc0 = freshDocument('grid-1', {
      'grid-1': gridNode(
        'grid-1',
        fixedGridChildren([gridCell('x', documentDescriptor('doc-x')), gridCell('y', mediaDescriptor('urn:test:y'))]),
      ),
    })
    await interpreter.reconcile(doc0, { width: 800, height: 400 })
    const yViewBefore = interpreter.mountedGridCellView('grid-1', 'y')
    const firstXRecord = documentFace.mounts[0]

    // `grid_set_cells` is a whole-array replace — same cell id 'x', a
    // GENUINELY different descriptor content (operations.ts's own
    // contract). 'y' is re-supplied byte-identical.
    const doc1 = freshDocument('grid-1', {
      'grid-1': gridNode(
        'grid-1',
        fixedGridChildren([gridCell('x', documentDescriptor('doc-x-v2')), gridCell('y', mediaDescriptor('urn:test:y'))]),
        { gridRevision: 1 },
      ),
    })
    await interpreter.reconcile(doc1, { width: 800, height: 400 })

    // 'x' was torn down and remounted — the OLD document lease is gone.
    expect(firstXRecord.disposed).toBe(true)
    expect(documentAdapter.disposeCalls).toHaveLength(1)
    expect(documentFace.mounts).toHaveLength(2)
    expect(documentAdapter.loadCalls).toHaveLength(2)

    // 'y' — byte-identical descriptor — kept its exact mounted view.
    expect(mediaFace.mounts).toHaveLength(1)
    expect(interpreter.mountedGridCellView('grid-1', 'y')).toBe(yViewBefore)

    await interpreter.dispose()
  })

  it('a cell that falls out of `cells` entirely is pruned: view disposed, lease released, wrapper removed', async () => {
    const { registry, mediaFace } = buildTestRegistry()
    const { broker, blobAdapter } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc0 = freshDocument('grid-1', {
      'grid-1': gridNode('grid-1', fixedGridChildren([gridCell('x', documentDescriptor('doc-x')), gridCell('y', mediaDescriptor('urn:test:y'))])),
    })
    await interpreter.reconcile(doc0, { width: 800, height: 400 })

    const doc1 = freshDocument('grid-1', {
      'grid-1': gridNode('grid-1', fixedGridChildren([gridCell('x', documentDescriptor('doc-x'))]), { gridRevision: 1 }),
    })
    await interpreter.reconcile(doc1, { width: 800, height: 400 })

    expect(mediaFace.mounts[0].disposed).toBe(true)
    expect(blobAdapter.disposeCalls).toHaveLength(1)
    expect(interpreter.gridCellWrapperElement('grid-1', 'y')).toBeNull()
    expect(interpreter.mountedGridCellView('grid-1', 'x')).not.toBeNull() // untouched sibling

    await interpreter.dispose()
  })
})

describe('LayoutInterpreter — fixed grid: error-cell painting (no crash, no leak)', () => {
  it('an unregistered fixed-cell face is a DOCUMENT-level validation failure (mirrors a leaf, LAY-003) — never reaches mount at all', async () => {
    const registry = new FaceRegistry() // deliberately empty
    const { broker, documentAdapter } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc = freshDocument('grid-1', {
      'grid-1': gridNode('grid-1', fixedGridChildren([gridCell('x', documentDescriptor('doc-x'))])),
    })
    const result = await interpreter.reconcile(doc, { width: 800, height: 400 })
    // nucleus validate.ts checks isFaceRegistered for a FIXED cell's
    // descriptor at the SAME document-validity gate a leaf goes through
    // (LAY003_UNREGISTERED_FACE) — solveLayout rejects the whole document
    // before reconcileNode (and therefore any mount attempt) ever runs.
    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((d) => d.code === 'LAY003_UNREGISTERED_FACE')).toBe(true)
    expect(interpreter.gridCellWrapperElement('grid-1', 'x')).toBeNull()
    expect(documentAdapter.loadCalls).toHaveLength(0)
  })

  it('a resource the broker cannot resolve paints resource-unavailable, not a crash', async () => {
    const { registry } = buildTestRegistry()
    const broker = new LayoutResourceBroker() // no adapters registered at all
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc = freshDocument('grid-1', {
      'grid-1': gridNode('grid-1', fixedGridChildren([gridCell('x', documentDescriptor('doc-x'))])),
    })
    const result = await interpreter.reconcile(doc, { width: 800, height: 400 })
    expect(result.ok).toBe(true)
    expect(interpreter.gridCellWrapperElement('grid-1', 'x')!.getAttribute('data-layout-error-reason')).toBe(
      'resource-unavailable',
    )
    expect(interpreter.mountedGridCellView('grid-1', 'x')).toBeNull()
  })

  it('mount() throwing after the lease was acquired still releases the lease (no leak)', async () => {
    const registry = new FaceRegistry()
    registry.register({
      faceId: 'test.throws-on-mount',
      persistence: 'stamp',
      resourceAdapterId: 'test.document-store',
      accepts: () => true,
      paramsSchema: noFaceParams,
      mount: () => {
        throw new Error('boom: mount always fails')
      },
    })
    const { broker, documentAdapter } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })
    const doc = freshDocument('grid-1', {
      'grid-1': gridNode(
        'grid-1',
        fixedGridChildren([
          gridCell('x', { schemaVersion: 1, faceId: 'test.throws-on-mount', resource: { kind: 'document', graphId: 'g1', documentId: 'doc-x' } }),
        ]),
      ),
    })
    const result = await interpreter.reconcile(doc, { width: 800, height: 400 })
    expect(result.ok).toBe(true)
    expect(documentAdapter.loadCalls).toHaveLength(1) // the lease WAS acquired…
    expect(documentAdapter.disposeCalls).toHaveLength(1) // …and released even though mount() never returned a view
    expect(interpreter.mountedGridCellView('grid-1', 'x')).toBeNull()
    expect(interpreter.gridCellWrapperElement('grid-1', 'x')!.getAttribute('data-layout-error-reason')).toBe('mount-failed')
    expect(broker.diagnostics().outstandingLeases).toBe(0)

    await interpreter.dispose()
  })
})

describe('LayoutInterpreter — the cell persistence rule is wired end-to-end via the REAL FaceRegistry', () => {
  it('a persistent-non-relocatable face makes the WHOLE document invalid (LAY003_CELL_FACE_NOT_GRID_ELIGIBLE), never merely refused at mount time', async () => {
    const { registry } = buildTestRegistry()
    const nonRelocatable = createPersistentNonRelocatableFace()
    registry.register(nonRelocatable.registration)
    const { broker } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const descriptor: ViewDescriptor = {
      schemaVersion: 1,
      faceId: 'test.persistent-non-relocatable-face',
      resource: { kind: 'document', graphId: 'g1', documentId: 'doc-x' },
    }
    const doc = freshDocument('grid-1', {
      'grid-1': gridNode('grid-1', fixedGridChildren([gridCell('x', descriptor)])),
    })
    const result = await interpreter.reconcile(doc, { width: 800, height: 400 })

    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((d) => d.code === 'LAY003_CELL_FACE_NOT_GRID_ELIGIBLE')).toBe(true)
    expect(nonRelocatable.mounts).toHaveLength(0) // solveLayout rejected the document before any mount was ever attempted

    await interpreter.dispose()
  })
})

describe('LayoutInterpreter — a grid coexists with a leaf sibling in the split tree', () => {
  it('grid cells mount alongside a real leaf face, and closing the grid tears down every cell', async () => {
    const { registry, documentFace, mediaFace } = buildTestRegistry()
    const { broker, documentAdapter, blobAdapter } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const doc0 = freshDocument('S1', {
      S1: splitNode('S1', 'horizontal', 'leaf-a', 'grid-1', 5000),
      'leaf-a': leafNode('leaf-a', documentDescriptor('doc-a')),
      'grid-1': gridNode('grid-1', fixedGridChildren([gridCell('x', mediaDescriptor('urn:test:x'))])),
    })
    const result = await interpreter.reconcile(doc0, { width: 1000, height: 600 })
    expect(result.ok).toBe(true)
    expect(documentFace.mounts).toHaveLength(1)
    expect(mediaFace.mounts).toHaveLength(1)
    expect(interpreter.leafWrapperElement('leaf-a')!.parentElement).toBe(root)
    expect(interpreter.gridWrapperElement('grid-1')!.parentElement).toBe(root)

    // Close the grid out of the tree entirely — root becomes the leaf alone.
    const doc1 = freshDocument('leaf-a', {
      'leaf-a': leafNode('leaf-a', documentDescriptor('doc-a')),
    })
    const result2 = await interpreter.reconcile(doc1, { width: 1000, height: 600 })
    expect(result2.ok).toBe(true)

    expect(mediaFace.mounts[0].disposed).toBe(true)
    expect(blobAdapter.disposeCalls).toHaveLength(1)
    expect(interpreter.gridWrapperElement('grid-1')).toBeNull()
    // The surviving leaf is untouched — no remount, no reload.
    expect(documentFace.mounts).toHaveLength(1)
    expect(documentAdapter.loadCalls).toHaveLength(1)
    expect(documentAdapter.disposeCalls).toHaveLength(0)

    await interpreter.dispose()
  })
})

// ── collection-source grids ─────────────────────────────────────────────────

function collectionDoc(gridRevision: number, overrides: Partial<Parameters<typeof collectionGridChildren>[0]> = {}): LayoutDocument {
  return freshDocument('grid-1', {
    'grid-1': gridNode('grid-1', collectionGridChildren(overrides), { gridRevision }),
  })
}

describe('LayoutInterpreter — collection grid: initial mount', () => {
  it('runs the bound query ONCE (awaited) and mounts a virtual cell per ?item row, keyed by the item IRI', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const collection = createGridCollectionAdapter()
    broker.registerAdapter(collection.adapter)
    collection.setRows([{ item: 'urn:test:item-a' }, { item: 'urn:test:item-b' }])

    const interpreter = new LayoutInterpreter(root, {
      registry,
      broker,
      gridCollectionResourceAdapterId: collection.adapter.adapterId,
    })
    const result = await interpreter.reconcile(collectionDoc(0), { width: 800, height: 400 })
    expect(result.ok).toBe(true)

    expect(collection.computeCalls).toHaveLength(1)
    expect(collection.runCallCount()).toBe(1)
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:item-a')).not.toBeNull()
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:item-b')).not.toBeNull()
    expect(interpreter.gridCellWrapperElement('grid-1', 'urn:test:item-a')!.parentElement).toBe(
      interpreter.gridInteriorElement('grid-1'),
    )
    expect(interpreter.gridCountBadgeElement('grid-1')!.hidden).toBe(true) // 2 rows, maxItems 10 — not truncated

    await interpreter.dispose()
  })

  it('maxItems truncation is surfaced via the count badge, never silent', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const collection = createGridCollectionAdapter()
    broker.registerAdapter(collection.adapter)
    collection.setRows([{ item: 'urn:test:1' }, { item: 'urn:test:2' }, { item: 'urn:test:3' }])

    const interpreter = new LayoutInterpreter(root, {
      registry,
      broker,
      gridCollectionResourceAdapterId: collection.adapter.adapterId,
    })
    await interpreter.reconcile(collectionDoc(0, { maxItems: 2 }), { width: 800, height: 400 })

    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:1')).not.toBeNull()
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:2')).not.toBeNull()
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:3')).toBeNull() // truncated away
    const badge = interpreter.gridCountBadgeElement('grid-1')!
    expect(badge.hidden).toBe(false)
    expect(badge.textContent).toBe('showing 2 of 3')

    await interpreter.dispose()
  })

  it('a row with no bound ?item is skipped, not fatal', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const collection = createGridCollectionAdapter()
    broker.registerAdapter(collection.adapter)
    collection.setRows([{ label: 'no item bound here' }, { item: 'urn:test:ok' }])

    const interpreter = new LayoutInterpreter(root, {
      registry,
      broker,
      gridCollectionResourceAdapterId: collection.adapter.adapterId,
    })
    const result = await interpreter.reconcile(collectionDoc(0), { width: 800, height: 400 })
    expect(result.ok).toBe(true)
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:ok')).not.toBeNull()

    await interpreter.dispose()
  })

  it('a row whose ?item is bound to a LITERAL (not a URI) is skipped, never treated as a real collection identity (review r1 finding (b))', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const collection = createGridCollectionAdapter()
    broker.registerAdapter(collection.adapter)
    collection.setRows([
      { item: { value: 'not actually an iri', type: 'literal' } },
      { item: { value: 'urn:test:blank', type: 'bnode' } },
      { item: 'urn:test:ok' }, // shorthand for {value, type:'uri'} — see ControllableGridCollectionTerm
    ])

    const interpreter = new LayoutInterpreter(root, {
      registry,
      broker,
      gridCollectionResourceAdapterId: collection.adapter.adapterId,
    })
    const result = await interpreter.reconcile(collectionDoc(0), { width: 800, height: 400 })
    expect(result.ok).toBe(true)
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:ok')).not.toBeNull()
    expect(interpreter.mountedGridCellView('grid-1', 'not actually an iri')).toBeNull()
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:blank')).toBeNull()

    await interpreter.dispose()
  })

  it('identities are validated and deduplicated BEFORE maxItems truncation — an invalid/duplicate early row never wastes a slot a later valid row could have filled (review r1 finding (b))', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const collection = createGridCollectionAdapter()
    broker.registerAdapter(collection.adapter)
    // Two invalid rows and one duplicate FIRST — under the old slice-before-
    // validate ordering, these would have consumed 3 of `maxItems: 2`'s
    // slots, leaving only ONE genuinely valid item mounted (or none).
    collection.setRows([
      { item: { value: 'not an iri', type: 'literal' } },
      { label: 'no item bound here' },
      { item: 'urn:test:1' },
      { item: 'urn:test:1' }, // duplicate identity — same item, not a second slot
      { item: 'urn:test:2' },
      { item: 'urn:test:3' },
    ])

    const interpreter = new LayoutInterpreter(root, {
      registry,
      broker,
      gridCollectionResourceAdapterId: collection.adapter.adapterId,
    })
    await interpreter.reconcile(collectionDoc(0, { maxItems: 2 }), { width: 800, height: 400 })

    // The fix under test: 'urn:test:2' must NOT be crowded out by the two
    // invalid rows + one duplicate that precede it — under the OLD
    // slice-before-validate ordering, `rows.slice(0, 2)` would have kept only
    // `{not an iri}` and `{no item bound}` (both invalid) as the "shown" set,
    // mounting ZERO real items.
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:1')).not.toBeNull()
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:2')).not.toBeNull()
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:3')).toBeNull() // truncated away, honestly this time
    // The badge's own total is the query layer's raw match count (all 6 rows
    // the query returned — `totalRowCount`, review r1 finding (c)), a
    // DIFFERENT and orthogonal concern from row-identity validity (finding
    // (b), asserted above): the interpreter cannot know how many of any
    // FETCH-CLAMPED-AWAY rows beyond what it received would have been valid,
    // so the one well-defined "total" is the query engine's own count.
    const badge = interpreter.gridCountBadgeElement('grid-1')!
    expect(badge.hidden).toBe(false)
    expect(badge.textContent).toBe('showing 2 of 6')

    await interpreter.dispose()
  })

  it('the count badge total reflects the query layer\'s real totalRowCount, never the (possibly fetch-clamped) rows actually delivered (review r1 finding (c))', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const collection = createGridCollectionAdapter()
    broker.registerAdapter(collection.adapter)
    // Simulates a fetch-layer clamp (query-block-service.ts's own 500-row
    // ceiling): only 2 rows actually arrived, but the query really matched 7.
    collection.setRows([{ item: 'urn:test:1' }, { item: 'urn:test:2' }])
    collection.setTotalRowCount(7)

    const interpreter = new LayoutInterpreter(root, {
      registry,
      broker,
      gridCollectionResourceAdapterId: collection.adapter.adapterId,
    })
    await interpreter.reconcile(collectionDoc(0, { maxItems: 10 }), { width: 800, height: 400 })

    // Both delivered rows mounted (maxItems=10 never truncated the DELIVERED
    // set) — the badge must still be honest about the real, larger total.
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:1')).not.toBeNull()
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:2')).not.toBeNull()
    const badge = interpreter.gridCountBadgeElement('grid-1')!
    expect(badge.hidden).toBe(false)
    expect(badge.textContent).toBe('showing 2 of 7')

    await interpreter.dispose()
  })

  it('paints a retained collection snapshot before its revisit refresh settles', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    let runCalls = 0
    let releaseRevisit!: () => void
    const revisitGate = new Promise<void>((resolve) => {
      releaseRevisit = resolve
    })
    const adapter: DerivedResourceAdapter<GridCollectionQueryHandle> = {
      adapterId: 'test.retained-grid-collection',
      shape: 'derived',
      retainForMs: 60_000,
      accepts: (locator) => locator.kind === 'query',
      resourceKey: (locator) => JSON.stringify(locator),
      async compute(_locator, context) {
        const store = createSurfaceResourceStore(async () => {
          runCalls += 1
          if (runCalls > 1) await revisitGate
          const itemIri = runCalls === 1 ? 'urn:test:warm-item' : 'urn:test:fresh-item'
          return {
            rows: [{ item: { type: 'uri' as const, value: itemIri } }],
            totalRowCount: 1,
          }
        }, context)
        return {
          ...store,
          run: () => refreshSurfaceResourceStore(store),
        }
      },
    }
    broker.registerAdapter(adapter)
    const interpreter = new LayoutInterpreter(root, {
      registry,
      broker,
      gridCollectionResourceAdapterId: adapter.adapterId,
    })

    await interpreter.reconcile(collectionDoc(0), { width: 800, height: 400 })
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:warm-item')).not.toBeNull()

    await interpreter.reconcile(
      freshDocument('away', { away: leafNode('away', documentDescriptor('away')) }),
      { width: 800, height: 400 },
    )

    let revisitSettled = false
    const revisit = interpreter
      .reconcile(collectionDoc(0), { width: 800, height: 400 })
      .then((result) => {
        revisitSettled = true
        return result
      })
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()

    expect(runCalls).toBe(2)
    expect(revisitSettled).toBe(false)
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:warm-item')).not.toBeNull()
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:fresh-item')).toBeNull()

    releaseRevisit()
    await revisit
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:warm-item')).toBeNull()
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:fresh-item')).not.toBeNull()

    await interpreter.dispose()
    broker.clearRetained()
    await broker.settled()
  })
})

describe('collectionItemIri', () => {
  it('accepts only a non-empty URI-typed ?item term', () => {
    expect(collectionItemIri({ item: { value: 'urn:test:a', type: 'uri' } })).toBe('urn:test:a')
    expect(collectionItemIri({ item: { value: 'not an iri', type: 'literal' } })).toBeNull()
    expect(collectionItemIri({ item: { value: 'b1', type: 'bnode' } })).toBeNull()
    expect(collectionItemIri({ item: { value: '', type: 'uri' } })).toBeNull()
    expect(collectionItemIri({ item: { value: 'urn:test:a' } })).toBeNull() // no `type` at all — not proven to be a URI
    expect(collectionItemIri({})).toBeNull()
  })
})

describe('LayoutInterpreter — collection grid: grid_set_flow-shaped changes never force a rebind (review r1 WRONG finding: "unrelated grid configuration updates preserve collection cell mounts")', () => {
  it('a reconcile with the SAME binding but a bumped gridRevision + changed flow/minCellWidth (exactly what grid_set_flow produces) reflows without re-querying or remounting', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const collection = createGridCollectionAdapter()
    broker.registerAdapter(collection.adapter)
    collection.setRows([{ item: 'urn:test:a' }, { item: 'urn:test:b' }])

    const interpreter = new LayoutInterpreter(root, {
      registry,
      broker,
      gridCollectionResourceAdapterId: collection.adapter.adapterId,
    })
    await interpreter.reconcile(collectionDoc(0), { width: 800, height: 400 })
    expect(collection.runCallCount()).toBe(1)
    const viewBefore = interpreter.mountedGridCellView('grid-1', 'urn:test:a')
    expect(viewBefore).not.toBeNull()
    const interior = interpreter.gridInteriorElement('grid-1')!
    expect(interior.style.gridTemplateColumns).toContain('160px') // collectionDoc's default minCellWidth

    // Exactly what `grid_set_flow` produces: gridRevision bumped, flow/
    // minCellWidth changed, `children` (the binding) byte-identical.
    const flowChangedDoc = freshDocument('grid-1', {
      'grid-1': gridNode('grid-1', collectionGridChildren(), { gridRevision: 1, flow: 'stack', minCellWidth: 240 }),
    })
    await interpreter.reconcile(flowChangedDoc, { width: 800, height: 400 })

    // No re-query, no remount — the SAME view instance survives.
    expect(collection.runCallCount()).toBe(1)
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:a')).toBe(viewBefore)
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:b')).not.toBeNull()
    // The geometry change DID apply — this is a real reflow, not a no-op.
    expect(interior.style.gridTemplateColumns).toBe('1fr')

    await interpreter.dispose()
  })

  it('a genuine `grid_bind_collection`-shaped change (the binding itself differs) still rebinds even though gridRevision bumped the same way', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const collection = createGridCollectionAdapter()
    broker.registerAdapter(collection.adapter)
    collection.setRows([{ item: 'urn:test:a' }])

    const interpreter = new LayoutInterpreter(root, {
      registry,
      broker,
      gridCollectionResourceAdapterId: collection.adapter.adapterId,
    })
    await interpreter.reconcile(collectionDoc(0), { width: 800, height: 400 })
    expect(collection.runCallCount()).toBe(1)

    collection.setRows([{ item: 'urn:test:a' }])
    const rebound = freshDocument('grid-1', {
      'grid-1': gridNode('grid-1', collectionGridChildren({ maxItems: 99 }), { gridRevision: 1 }),
    })
    await interpreter.reconcile(rebound, { width: 800, height: 400 })

    expect(collection.runCallCount()).toBe(2) // a real rebind, a real re-query

    await interpreter.dispose()
  })
})

describe('LayoutInterpreter — collection grid: a stale cell mount cannot leak or resurrect after dispose() (review r1 WRONG finding)', () => {
  it('a mount whose acquire()/mount() awaits outlive dispose() is torn down on arrival, never inserted into live state', async () => {
    const { registry } = buildTestRegistry()
    const gatedFace = createGatedMediaFace()
    registry.register(gatedFace.registration)
    const { broker } = buildTestBroker()
    const gatedBlob = createGatedBlobAdapter()
    broker.registerAdapter(gatedBlob.adapter)
    const collection = createGridCollectionAdapter()
    broker.registerAdapter(collection.adapter)
    collection.setRows([{ item: 'urn:test:slow' }])

    const interpreter = new LayoutInterpreter(root, {
      registry,
      broker,
      gridCollectionResourceAdapterId: collection.adapter.adapterId,
    })
    const doc = freshDocument('grid-1', {
      'grid-1': gridNode('grid-1', collectionGridChildren({ itemFaceId: 'test.gated-media-face' }), { gridRevision: 0 }),
    })

    // Kick off reconcile — it will hang inside mountGridCell's own
    // broker.acquire() await (createGatedBlobAdapter's load() never resolves
    // until release() is called). Do NOT await it yet.
    const reconcilePromise = interpreter.reconcile(doc, { width: 800, height: 400 })
    // Drain microtasks until the REAL signal that we've reached the gate
    // (load() was actually entered) — never a guessed tick count, which
    // would be a flaky proxy for "far enough along".
    for (let i = 0; i < 100 && gatedBlob.loadCalls.length === 0; i++) {
      await Promise.resolve()
    }
    expect(gatedBlob.loadCalls).toHaveLength(1) // sanity: the race window is genuinely open

    // dispose() runs to completion WHILE the mount above is still pending —
    // the exact race the fix guards against.
    await interpreter.dispose()
    expect(broker.diagnostics().outstandingLeases).toBe(0)

    // Now let the stale mount's acquire()/mount() actually resolve.
    gatedBlob.release()
    await reconcilePromise.catch(() => {}) // reconcile() itself may observe interpreter.disposed; only the leak matters here
    await Promise.resolve()
    await Promise.resolve()

    // The lease must never have been resurrected into live state: no
    // outstanding lease, and the view (if it ever mounted) was disposed, not
    // left live in an orphaned grid.
    expect(broker.diagnostics().outstandingLeases).toBe(0)
    if (gatedFace.mounts.length > 0) {
      expect(gatedFace.mounts.every((m) => m.disposed)).toBe(true)
    }
  })
})

describe('LayoutInterpreter — collection grid: refresh-tick reconciliation', () => {
  beforeEach(() => vi.useFakeTimers())

  it('reconciles by id on each tick: an unchanged item keeps its view, a new item mounts, a vanished item is torn down', async () => {
    const { registry, mediaFace } = buildTestRegistry()
    const { broker, blobAdapter } = buildTestBroker()
    const collection = createGridCollectionAdapter()
    broker.registerAdapter(collection.adapter)
    collection.setRows([{ item: 'urn:test:stays' }, { item: 'urn:test:leaves' }])

    const interpreter = new LayoutInterpreter(root, {
      registry,
      broker,
      gridCollectionResourceAdapterId: collection.adapter.adapterId,
    })
    await interpreter.reconcile(collectionDoc(0, { refreshSeconds: 5 }), { width: 800, height: 400 })
    expect(mediaFace.mounts).toHaveLength(2)
    const stayingViewBefore = interpreter.mountedGridCellView('grid-1', 'urn:test:stays')

    // Next tick: 'leaves' is gone, 'arrives' is new, 'stays' persists.
    collection.setRows([{ item: 'urn:test:stays' }, { item: 'urn:test:arrives' }])
    await vi.advanceTimersByTimeAsync(5000)

    expect(collection.runCallCount()).toBe(2)
    // 'stays' kept its EXACT mounted view — no remount.
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:stays')).toBe(stayingViewBefore)
    // 'arrives' is freshly mounted.
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:arrives')).not.toBeNull()
    // 'leaves' was torn down: view disposed, lease released, wrapper removed.
    expect(interpreter.gridCellWrapperElement('grid-1', 'urn:test:leaves')).toBeNull()
    expect(blobAdapter.disposeCalls.length).toBeGreaterThanOrEqual(1)
    expect(mediaFace.mounts.filter((m) => m.disposed)).toHaveLength(1) // only 'leaves'

    await interpreter.dispose()
  })

  it('a refresh tick that fails AFTER cells are mounted leaves them intact (non-destructive) and marks the error non-fatally', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const collection = createGridCollectionAdapter()
    broker.registerAdapter(collection.adapter)
    collection.setRows([{ item: 'urn:test:a' }])

    const interpreter = new LayoutInterpreter(root, {
      registry,
      broker,
      gridCollectionResourceAdapterId: collection.adapter.adapterId,
    })
    await interpreter.reconcile(collectionDoc(0, { refreshSeconds: 5 }), { width: 800, height: 400 })
    const viewBefore = interpreter.mountedGridCellView('grid-1', 'urn:test:a')
    expect(viewBefore).not.toBeNull()

    collection.setError(new Error('transient query failure'))
    await vi.advanceTimersByTimeAsync(5000)

    // The already-mounted cell is UNTOUCHED — no leak, no destructive repaint.
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:a')).toBe(viewBefore)
    expect(interpreter.gridWrapperElement('grid-1')!.getAttribute('data-layout-grid-collection-error')).toBe(
      'collection-query-failed',
    )
    expect(interpreter.gridWrapperElement('grid-1')!.hasAttribute('data-layout-grid-error-reason')).toBe(false)

    // Recovery: next successful tick clears the marker and keeps polling.
    await vi.advanceTimersByTimeAsync(5000)
    expect(interpreter.gridWrapperElement('grid-1')!.hasAttribute('data-layout-grid-collection-error')).toBe(false)
    expect(collection.runCallCount()).toBe(3)

    await interpreter.dispose()
  })
})

describe('LayoutInterpreter — collection grid: total-failure paths (empty interior, no leak)', () => {
  it('no `gridCollectionResourceAdapterId` configured paints an honest error, never throws', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const interpreter = new LayoutInterpreter(root, { registry, broker }) // deliberately no adapter id
    const result = await interpreter.reconcile(collectionDoc(0), { width: 800, height: 400 })
    expect(result.ok).toBe(true)
    expect(interpreter.gridWrapperElement('grid-1')!.getAttribute('data-layout-grid-error-reason')).toBe(
      'collection-adapter-unconfigured',
    )
    await interpreter.dispose()
  })

  it('the acquire itself failing paints resource-unavailable', async () => {
    const { registry } = buildTestRegistry()
    const broker = new LayoutResourceBroker() // no collection adapter registered
    const interpreter = new LayoutInterpreter(root, {
      registry,
      broker,
      gridCollectionResourceAdapterId: 'nonexistent-adapter',
    })
    const result = await interpreter.reconcile(collectionDoc(0), { width: 800, height: 400 })
    expect(result.ok).toBe(true)
    expect(interpreter.gridWrapperElement('grid-1')!.getAttribute('data-layout-grid-error-reason')).toBe(
      'resource-unavailable',
    )
    await interpreter.dispose()
  })

  it('the FIRST fetch failing (no cells mounted yet) paints the destructive total-grid error', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const collection = createGridCollectionAdapter()
    broker.registerAdapter(collection.adapter)
    collection.setError(new Error('first fetch fails'))

    const interpreter = new LayoutInterpreter(root, {
      registry,
      broker,
      gridCollectionResourceAdapterId: collection.adapter.adapterId,
    })
    const result = await interpreter.reconcile(collectionDoc(0), { width: 800, height: 400 })
    expect(result.ok).toBe(true)
    expect(interpreter.gridWrapperElement('grid-1')!.getAttribute('data-layout-grid-error-reason')).toBe(
      'collection-query-failed',
    )
    expect(broker.diagnostics().outstandingLeases).toBe(1) // the COLLECTION lease itself is still held (a retry seam) — no cell leases

    await interpreter.dispose()
    expect(broker.diagnostics().outstandingLeases).toBe(0)
  })
})

describe('LayoutInterpreter — collection grid: rebind on gridRevision change', () => {
  it('a `grid_bind_collection`-shaped gridRevision bump discards the OLD item set and re-fetches', async () => {
    const { registry, mediaFace } = buildTestRegistry()
    const { broker, blobAdapter } = buildTestBroker()
    const collection = createGridCollectionAdapter()
    broker.registerAdapter(collection.adapter)
    collection.setRows([{ item: 'urn:test:old-1' }, { item: 'urn:test:old-2' }])

    const interpreter = new LayoutInterpreter(root, {
      registry,
      broker,
      gridCollectionResourceAdapterId: collection.adapter.adapterId,
    })
    await interpreter.reconcile(collectionDoc(0), { width: 800, height: 400 })
    expect(mediaFace.mounts).toHaveLength(2)
    expect(collection.computeCalls).toHaveLength(1)

    // A REBIND — different query text AND a bumped gridRevision (both real
    // ops, `grid_bind_collection`, bump it in lockstep).
    collection.setRows([{ item: 'urn:test:new-1' }])
    const doc1 = freshDocument('grid-1', {
      'grid-1': gridNode(
        'grid-1',
        collectionGridChildren({ collection: { kind: 'query', graphId: 'g1', queryId: 'SELECT ?item WHERE { ?item a <urn:test:OtherThing> }' } }),
        { gridRevision: 1 },
      ),
    })
    await interpreter.reconcile(doc1, { width: 800, height: 400 })

    // A fresh lease was acquired for the new binding.
    expect(collection.computeCalls).toHaveLength(2)
    // Every OLD item's view was torn down — a rebind is a different query,
    // not a refresh of the same one.
    expect(interpreter.gridCellWrapperElement('grid-1', 'urn:test:old-1')).toBeNull()
    expect(interpreter.gridCellWrapperElement('grid-1', 'urn:test:old-2')).toBeNull()
    expect(blobAdapter.disposeCalls).toHaveLength(2)
    // The new item is mounted.
    expect(interpreter.mountedGridCellView('grid-1', 'urn:test:new-1')).not.toBeNull()

    await interpreter.dispose()
  })
})

describe('LayoutInterpreter — collection grid: dispose() tears down cells, the binding, and its interval', () => {
  it('releases every cell lease AND the collection lease, and really stops the poll', async () => {
    vi.useFakeTimers()
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const collection = createGridCollectionAdapter()
    broker.registerAdapter(collection.adapter)
    collection.setRows([{ item: 'urn:test:a' }, { item: 'urn:test:b' }])

    const interpreter = new LayoutInterpreter(root, {
      registry,
      broker,
      gridCollectionResourceAdapterId: collection.adapter.adapterId,
    })
    await interpreter.reconcile(collectionDoc(0, { refreshSeconds: 5 }), { width: 800, height: 400 })
    expect(broker.diagnostics().outstandingLeases).toBe(3) // 2 cell leases + 1 collection lease

    await interpreter.dispose()
    expect(broker.diagnostics().outstandingLeases).toBe(0)
    expect(root.children).toHaveLength(0)

    const runCallsAtDispose = collection.runCallCount()
    await vi.advanceTimersByTimeAsync(20000) // well past several poll periods, had it survived
    expect(collection.runCallCount()).toBe(runCallsAtDispose) // the interval was really cleared
  })
})

// ── pure descriptor construction ────────────────────────────────────────────

describe('buildGridCollectionCellDescriptor', () => {
  const row: GridCollectionRow = { item: { value: 'urn:test:subject' }, label: { value: 'A Label' } }

  it('resource is always {kind:"iri", iri: itemIri} — the row IS the resource (design §2.1)', () => {
    const descriptor = buildGridCollectionCellDescriptor(
      { kind: 'collection', collection: { kind: 'query', graphId: 'g1', queryId: 'q' }, itemFaceId: 'card.subject', maxItems: 10 },
      row,
      'urn:test:subject',
    )
    expect(descriptor.resource).toEqual({ kind: 'iri', iri: 'urn:test:subject' })
    expect(descriptor.faceId).toBe('card.subject')
    expect(descriptor.params).toBeUndefined()
  })

  it('a literal itemParams value passes through verbatim; a `?var` reference resolves against the row', () => {
    const descriptor = buildGridCollectionCellDescriptor(
      {
        kind: 'collection',
        collection: { kind: 'query', graphId: 'g1', queryId: 'q' },
        itemFaceId: 'card.subject',
        maxItems: 10,
        itemParams: { titleField: 'obs:witness', dynamicField: '?label' },
      },
      row,
      'urn:test:subject',
    )
    expect(descriptor.params).toEqual({ titleField: 'obs:witness', dynamicField: 'A Label' })
  })

  it('an unresolvable `?var` reference is OMITTED, never coerced to an empty string', () => {
    const descriptor = buildGridCollectionCellDescriptor(
      {
        kind: 'collection',
        collection: { kind: 'query', graphId: 'g1', queryId: 'q' },
        itemFaceId: 'card.subject',
        maxItems: 10,
        itemParams: { missing: '?notBoundInThisRow' },
      },
      row,
      'urn:test:subject',
    )
    expect(descriptor.params).toBeUndefined()
  })
})
