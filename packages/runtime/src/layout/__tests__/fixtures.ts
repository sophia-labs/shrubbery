/**
 * Shared REAL (no `vi.mock`) test doubles for the P2 face-machinery suites.
 *
 * Two genuinely different resource/face pairs prove the contract does not
 * secretly bake in document/CRDT assumptions (design guard rail 2):
 *
 *   - `test.document-face` over a `document` locator — a durable, text-shaped
 *     resource, closest in spirit to a future `hoja.document`.
 *   - `test.media-face` over an `iri` locator — a durable, byte-shaped blob
 *     resource rendered into a bare `<canvas>`. NO CRDT, NO provider, NO
 *     editor machinery, NO toolbar — it only ever reads `lease.value.bytes`.
 *
 * Plus one `derived`-shaped adapter (`test.query-rollup`, over a `query`
 * locator) used only by resource-broker.test.ts to prove the reserved
 * derived shape is real, not just typed dead code.
 *
 * Every "face"/"adapter" here is a small, fully working implementation of the
 * real interface under test — not a stand-in for a dependency the code under
 * test needs. Call-count/identity tracking uses plain arrays/counters
 * (`FaceMountRecord`), never a spy framework.
 */
import {
  deepFreeze,
  type Axis,
  type GridCell,
  type GridChildrenSource,
  type GridFlow,
  type LayoutDocument,
  type LayoutGridNode,
  type LayoutLeafNode,
  type LayoutNode,
  type LayoutSplitNode,
  type ResourceLocator,
  type ViewDescriptor,
} from '@shrubbery/nucleus/layout'
import { FaceRegistry } from '../face-registry.js'
import { LayoutResourceBroker } from '../resource-broker.js'
import {
  closedParamsSchema,
  noFaceParams,
  type DerivedResourceAdapter,
  type DurableResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type GridCollectionQueryHandle,
  type PixelBox,
} from '../types.js'
import {
  createSurfaceResourceStore,
  refreshSurfaceResourceStore,
} from '../resource-store.js'

const TIMESTAMP = '2026-07-16T00:00:00.000Z'

export function freshDocument(rootNodeId: string, nodes: Record<string, LayoutNode>): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'test-layout',
    scope: 'session',
    graphId: null,
    rootNodeId,
    nodes,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  })
}

export function leafNode(id: string, descriptor: ViewDescriptor, descriptorRevision = 0): LayoutLeafNode {
  return { kind: 'leaf', id, descriptor, descriptorRevision }
}

export function splitNode(
  id: string,
  axis: Axis,
  startNodeId: string,
  endNodeId: string,
  startBasisPoints = 5000,
): LayoutSplitNode {
  return { kind: 'split', id, axis, startNodeId, endNodeId, startBasisPoints }
}

export function documentDescriptor(documentId: string, graphId = 'g1'): ViewDescriptor {
  return { schemaVersion: 1, faceId: 'test.document-face', resource: { kind: 'document', graphId, documentId } }
}

export function mediaDescriptor(iri: string): ViewDescriptor {
  return { schemaVersion: 1, faceId: 'test.media-face', resource: { kind: 'iri', iri } }
}

export function queryDescriptor(queryId: string, graphId = 'g1'): ViewDescriptor {
  return { schemaVersion: 1, faceId: 'test.query-face', resource: { kind: 'query', graphId, queryId } }
}

// ── document-shaped durable resource + face ─────────────────────────────────

export interface TestDocumentValue {
  readonly text: string
  disposed: boolean
}

export function createDocumentAdapter(): {
  readonly adapter: DurableResourceAdapter<TestDocumentValue>
  readonly loadCalls: ResourceLocator[]
  readonly disposeCalls: string[]
} {
  const loadCalls: ResourceLocator[] = []
  const disposeCalls: string[] = []
  const adapter: DurableResourceAdapter<TestDocumentValue> = {
    adapterId: 'test.document-store',
    shape: 'durable',
    accepts: (locator) => locator.kind === 'document',
    resourceKey: (locator) => {
      if (locator.kind !== 'document') throw new Error('test.document-store: not a document locator')
      return `document:${locator.graphId}:${locator.documentId}`
    },
    load: async (locator) => {
      loadCalls.push(locator)
      return { text: `hello from ${locator.kind === 'document' ? locator.documentId : '?'}`, disposed: false }
    },
    dispose: (value, key) => {
      value.disposed = true
      disposeCalls.push(key)
    },
  }
  return { adapter, loadCalls, disposeCalls }
}

/** One face `mount()` call — plain-object call tracking, no spy framework. */
export interface FaceMountRecord {
  readonly descriptor: ViewDescriptor
  readonly element: HTMLElement
  readonly resizeCalls: PixelBox[]
  readonly focusCalls: FaceFocusCall[]
  disposed: boolean
}

export interface FaceFocusCall {
  readonly reason: string
}

export function createDocumentFace(): { readonly registration: FaceRegistration; readonly mounts: FaceMountRecord[] } {
  const mounts: FaceMountRecord[] = []
  const registration: FaceRegistration = {
    faceId: 'test.document-face',
    persistence: 'persistent-relocatable',
    resourceAdapterId: 'test.document-store',
    accepts: (locator) => locator.kind === 'document',
    // Closed, exact schema (design guard rail: "no open escape hatch") — only
    // `mode` is legal, and only these two values.
    paramsSchema: closedParamsSchema({
      mode: { type: 'enum', values: ['document', 'composer'], optional: true },
    }),
    constraints: () => ({ minWidth: 200, minHeight: 120, overflow: 'scroll' }),
    mount: (ctx) => {
      const element = document.createElement('div')
      element.dataset.face = 'test.document-face'
      const value = ctx.lease.value as TestDocumentValue
      element.textContent = value.text
      ctx.target.appendChild(element)

      const record: FaceMountRecord = { descriptor: ctx.descriptor, element, resizeCalls: [], focusCalls: [], disposed: false }
      mounts.push(record)

      const view: FaceView = {
        focus: (request) => {
          record.focusCalls.push({ reason: request.reason })
          return true
        },
        blur: () => {},
        resize: (box) => {
          record.resizeCalls.push(box)
          element.style.width = `${box.width}px`
          element.style.height = `${box.height}px`
        },
        serialize: () => ctx.descriptor,
        dispose: () => {
          record.disposed = true
          element.remove()
        },
      }
      return view
    },
  }
  return { registration, mounts }
}

// ── media/blob-shaped durable resource + face (guard rail 2) ───────────────

export interface TestBlobValue {
  readonly bytes: Uint8Array
  disposed: boolean
}

export function createBlobAdapter(): {
  readonly adapter: DurableResourceAdapter<TestBlobValue>
  readonly loadCalls: ResourceLocator[]
  readonly disposeCalls: string[]
} {
  const loadCalls: ResourceLocator[] = []
  const disposeCalls: string[] = []
  const adapter: DurableResourceAdapter<TestBlobValue> = {
    adapterId: 'test.blob-store',
    shape: 'durable',
    accepts: (locator) => locator.kind === 'iri',
    resourceKey: (locator) => {
      if (locator.kind !== 'iri') throw new Error('test.blob-store: not an iri locator')
      return `iri:${locator.iri}`
    },
    load: async (locator) => {
      loadCalls.push(locator)
      return { bytes: new Uint8Array([1, 2, 3, 4]), disposed: false }
    },
    dispose: (value, key) => {
      value.disposed = true
      disposeCalls.push(key)
    },
  }
  return { adapter, loadCalls, disposeCalls }
}

export function createMediaFace(): { readonly registration: FaceRegistration; readonly mounts: FaceMountRecord[] } {
  const mounts: FaceMountRecord[] = []
  const registration: FaceRegistration = {
    faceId: 'test.media-face',
    persistence: 'stamp',
    resourceAdapterId: 'test.blob-store',
    accepts: (locator) => locator.kind === 'iri',
    paramsSchema: noFaceParams,
    constraints: () => ({ minWidth: 64, minHeight: 64, overflow: 'clip' }),
    mount: (ctx) => {
      // A genuinely different top-level pane (design guard rail 2): a bare
      // blob/media viewer over a durable blob resource. No CRDT, no
      // provider, no editor machinery, no toolbar — just the raw bytes.
      const element = document.createElement('canvas')
      element.dataset.face = 'test.media-face'
      const value = ctx.lease.value as TestBlobValue
      element.width = value.bytes.length
      ctx.target.appendChild(element)

      const record: FaceMountRecord = { descriptor: ctx.descriptor, element, resizeCalls: [], focusCalls: [], disposed: false }
      mounts.push(record)

      const view: FaceView = {
        focus: (request) => {
          record.focusCalls.push({ reason: request.reason })
          return true
        },
        blur: () => {},
        resize: (box) => {
          record.resizeCalls.push(box)
          element.width = Math.max(1, Math.round(box.width))
          element.height = Math.max(1, Math.round(box.height))
        },
        serialize: () => ctx.descriptor,
        dispose: () => {
          record.disposed = true
          element.remove()
        },
      }
      return view
    },
  }
  return { registration, mounts }
}

/**
 * A durable adapter whose `load()` awaits a manually-resolved gate — real
 * `broker.acquire()` behavior (same `TestBlobValue` shape `createBlobAdapter`
 * returns), but the caller controls exactly WHEN the promise settles
 * (`release()`). Opens a real async race window around `mountGridCell`'s own
 * `broker.acquire()` await — the same shape a genuinely slow durable
 * resource (a cold blob fetch) leaves open in production — used by
 * `layout-interpreter-grid.test.ts`'s own "a stale collection-cell mount
 * cannot resurrect after dispose()" regression (grid-laneb review r1).
 */
export function createGatedBlobAdapter(): {
  readonly adapter: DurableResourceAdapter<TestBlobValue>
  /** One entry PER `load()` call, pushed BEFORE the gate await — a real, deterministic "we've reached the gate" signal for a caller that needs to await it without guessing a microtask-tick count. */
  readonly loadCalls: ResourceLocator[]
  readonly disposeCalls: string[]
  /** Resolve every `load()` currently awaiting the gate — mirrors a real load finally landing. */
  release(): void
} {
  const loadCalls: ResourceLocator[] = []
  const disposeCalls: string[] = []
  let resolveGate: (() => void) | null = null
  const gate = new Promise<void>((resolve) => {
    resolveGate = resolve
  })
  const adapter: DurableResourceAdapter<TestBlobValue> = {
    adapterId: 'test.gated-blob-store',
    shape: 'durable',
    accepts: (locator) => locator.kind === 'iri',
    resourceKey: (locator) => {
      if (locator.kind !== 'iri') throw new Error('test.gated-blob-store: not an iri locator')
      return `iri:${locator.iri}`
    },
    load: async (locator) => {
      loadCalls.push(locator)
      await gate
      return { bytes: new Uint8Array([1, 2, 3, 4]), disposed: false }
    },
    dispose: (value, key) => {
      value.disposed = true
      disposeCalls.push(key)
    },
  }
  return {
    adapter,
    loadCalls,
    disposeCalls,
    release: () => resolveGate?.(),
  }
}

/** Pairs with `createGatedBlobAdapter` — otherwise identical to `createMediaFace`. */
export function createGatedMediaFace(): { readonly registration: FaceRegistration; readonly mounts: FaceMountRecord[] } {
  const mounts: FaceMountRecord[] = []
  const registration: FaceRegistration = {
    faceId: 'test.gated-media-face',
    persistence: 'stamp',
    resourceAdapterId: 'test.gated-blob-store',
    accepts: (locator) => locator.kind === 'iri',
    paramsSchema: noFaceParams,
    constraints: () => ({ minWidth: 64, minHeight: 64, overflow: 'clip' }),
    mount: (ctx) => {
      const element = document.createElement('canvas')
      element.dataset.face = 'test.gated-media-face'
      const value = ctx.lease.value as TestBlobValue
      element.width = value.bytes.length
      ctx.target.appendChild(element)

      const record: FaceMountRecord = { descriptor: ctx.descriptor, element, resizeCalls: [], focusCalls: [], disposed: false }
      mounts.push(record)

      const view: FaceView = {
        focus: (request) => {
          record.focusCalls.push({ reason: request.reason })
          return true
        },
        blur: () => {},
        resize: (box) => {
          record.resizeCalls.push(box)
          element.width = Math.max(1, Math.round(box.width))
          element.height = Math.max(1, Math.round(box.height))
        },
        serialize: () => ctx.descriptor,
        dispose: () => {
          record.disposed = true
          element.remove()
        },
      }
      return view
    },
  }
  return { registration, mounts }
}

/**
 * F4 (repair round 3) — a REAL-focusable document-shaped face: unlike
 * `createDocumentFace`'s `focus()` (which only records the call), this one's
 * `focus()`/`blur()` actually move real DOM focus onto a real, tabbable
 * element (`tabIndex = 0`), and `focus()` reports success based on whether
 * `document.activeElement` genuinely landed there — the honest signal
 * `LayoutInterpreter.handleFocusHandoff`'s own `activeElementLeafId()` reads.
 * Shares `test.document-store`'s durable document-shaped adapter (same as
 * `createDocumentFace`) so it composes on the SAME broker/registry as the
 * other document-shaped fixtures in this file.
 */
export function focusableDescriptor(documentId: string, graphId = 'g1'): ViewDescriptor {
  return { schemaVersion: 1, faceId: 'test.focusable-face', resource: { kind: 'document', graphId, documentId } }
}

export function createFocusableFace(): { readonly registration: FaceRegistration; readonly mounts: FaceMountRecord[] } {
  const mounts: FaceMountRecord[] = []
  const registration: FaceRegistration = {
    faceId: 'test.focusable-face',
    persistence: 'persistent-relocatable',
    resourceAdapterId: 'test.document-store',
    accepts: (locator) => locator.kind === 'document',
    paramsSchema: noFaceParams,
    constraints: () => ({ minWidth: 100, minHeight: 60, overflow: 'clip' }),
    mount: (ctx) => {
      const element = document.createElement('div')
      element.dataset.face = 'test.focusable-face'
      element.tabIndex = 0
      ctx.target.appendChild(element)

      const record: FaceMountRecord = { descriptor: ctx.descriptor, element, resizeCalls: [], focusCalls: [], disposed: false }
      mounts.push(record)

      const view: FaceView = {
        focus: (request) => {
          record.focusCalls.push({ reason: request.reason })
          element.focus()
          return document.activeElement === element
        },
        blur: () => {
          element.blur()
        },
        resize: (box) => {
          record.resizeCalls.push(box)
        },
        serialize: () => ctx.descriptor,
        dispose: () => {
          record.disposed = true
          element.remove()
        },
      }
      return view
    },
  }
  return { registration, mounts }
}

// ── derived/query-rollup adapter — proves the reserved shape is real ───────

export interface TestQueryRollupValue {
  readonly rows: readonly number[]
  readonly computedAtSeq: number
}

export function createQueryRollupAdapter(): {
  readonly adapter: DerivedResourceAdapter<TestQueryRollupValue>
  readonly computeCalls: ResourceLocator[]
  readonly disposeCalls: string[]
} {
  const computeCalls: ResourceLocator[] = []
  const disposeCalls: string[] = []
  let seq = 0
  const adapter: DerivedResourceAdapter<TestQueryRollupValue> = {
    adapterId: 'test.query-rollup',
    shape: 'derived',
    accepts: (locator) => locator.kind === 'query',
    resourceKey: (locator) => {
      if (locator.kind !== 'query') throw new Error('test.query-rollup: not a query locator')
      return `query:${locator.graphId}:${locator.queryId}`
    },
    compute: async (locator) => {
      computeCalls.push(locator)
      seq += 1
      return { rows: [1, 2, 3], computedAtSeq: seq }
    },
    dispose: (_value, key) => {
      disposeCalls.push(key)
    },
  }
  return { adapter, computeCalls, disposeCalls }
}

// ── wiring helpers ───────────────────────────────────────────────────────────

export function buildTestRegistry(): {
  readonly registry: FaceRegistry
  readonly documentFace: ReturnType<typeof createDocumentFace>
  readonly mediaFace: ReturnType<typeof createMediaFace>
} {
  const registry = new FaceRegistry()
  const documentFace = createDocumentFace()
  const mediaFace = createMediaFace()
  registry.register(documentFace.registration)
  registry.register(mediaFace.registration)
  return { registry, documentFace, mediaFace }
}

export function buildTestBroker(): {
  readonly broker: LayoutResourceBroker
  readonly documentAdapter: ReturnType<typeof createDocumentAdapter>
  readonly blobAdapter: ReturnType<typeof createBlobAdapter>
} {
  const broker = new LayoutResourceBroker()
  const documentAdapter = createDocumentAdapter()
  const blobAdapter = createBlobAdapter()
  broker.registerAdapter(documentAdapter.adapter)
  broker.registerAdapter(blobAdapter.adapter)
  return { broker, documentAdapter, blobAdapter }
}

// ── grid/collection fixtures (Wave 2 x Lane B spec
// plans/surface-wave2-laneb-slice-20260716.md §3) ───────────────────────────

export function gridNode(
  id: string,
  children: GridChildrenSource,
  overrides: Partial<{ readonly flow: GridFlow; readonly minCellWidth: number; readonly gridRevision: number }> = {},
): LayoutGridNode {
  return {
    kind: 'grid',
    id,
    flow: overrides.flow ?? 'reflow',
    minCellWidth: overrides.minCellWidth ?? 160,
    children,
    gridRevision: overrides.gridRevision ?? 0,
  }
}

export function gridCell(id: string, descriptor: ViewDescriptor, span?: 1 | 2 | 3): GridCell {
  return { id, descriptor, ...(span !== undefined ? { span } : {}) }
}

export function fixedGridChildren(cells: readonly GridCell[]): GridChildrenSource {
  return { kind: 'fixed', cells }
}

/**
 * `itemFaceId` defaults to `'test.media-face'`, NOT `'test.document-face'`:
 * a collection-derived cell's resource is ALWAYS `{kind:'iri', iri:itemIri}`
 * (`buildGridCollectionCellDescriptor`, layout-interpreter.ts — the row's own
 * identity IS the resource, design §2.1) — `test.document-face` only accepts
 * a `document` locator and would reject every collection cell outright.
 */
export function collectionGridChildren(
  overrides: Partial<Extract<GridChildrenSource, { kind: 'collection' }>> = {},
): GridChildrenSource {
  return {
    kind: 'collection',
    collection: { kind: 'query', graphId: 'g1', queryId: 'SELECT ?item WHERE { ?item a <urn:test:Thing> }' },
    itemFaceId: 'test.media-face',
    maxItems: 10,
    ...overrides,
  }
}

/**
 * A `persistent-non-relocatable` document-shaped face — stands in for a real
 * P2 face design §2.1's cell persistence rule excludes from grid cells
 * (`FaceRegistry.toFaceGridEligibilityPredicate`). Shares
 * `test.document-store`'s durable adapter so it composes on the SAME
 * broker/registry as every other document-shaped fixture in this file.
 */
export function createPersistentNonRelocatableFace(): { readonly registration: FaceRegistration; readonly mounts: FaceMountRecord[] } {
  const mounts: FaceMountRecord[] = []
  const registration: FaceRegistration = {
    faceId: 'test.persistent-non-relocatable-face',
    persistence: 'persistent-non-relocatable',
    resourceAdapterId: 'test.document-store',
    accepts: (locator) => locator.kind === 'document',
    paramsSchema: noFaceParams,
    constraints: () => ({ minWidth: 100, minHeight: 60, overflow: 'clip' }),
    mount: (ctx) => {
      const element = document.createElement('div')
      element.dataset.face = 'test.persistent-non-relocatable-face'
      ctx.target.appendChild(element)
      const record: FaceMountRecord = { descriptor: ctx.descriptor, element, resizeCalls: [], focusCalls: [], disposed: false }
      mounts.push(record)
      const view: FaceView = {
        focus: () => true,
        blur: () => {},
        resize: (box) => record.resizeCalls.push(box),
        serialize: () => ctx.descriptor,
        dispose: () => {
          record.disposed = true
          element.remove()
        },
      }
      return view
    },
  }
  return { registration, mounts }
}

/** One test row's term — a bare string is shorthand for `{value, type: 'uri'}` (every fixture-authored `item` value is IRI-shaped, e.g. `'urn:test:item-a'`), matching what a REAL adapter's `QueryBlockTerm` structurally carries. A test that specifically needs a non-URI term (proving the interpreter's own `?item`-must-be-a-uri check) spells the object form out, e.g. `{ value: 'not an iri', type: 'literal' }`. */
export type ControllableGridCollectionTerm = string | { readonly value: string; readonly type: 'uri' | 'bnode' | 'literal' }

/**
 * A CONTROLLABLE `DerivedResourceAdapter<GridCollectionQueryHandle>` — every
 * `run()` call resolves to whatever `setRows`/`setError`/`setTotalRowCount`
 * last configured (an error is consumed exactly once, mirroring a real
 * transient query failure rather than a permanently broken adapter). Every
 * "row" here is a plain `Record<string, ControllableGridCollectionTerm>` of
 * SPARQL-variable-name -> term; this fixture wraps each value as the exact
 * `GridCollectionTerm` shape `layout-interpreter.ts`'s own grid renderer
 * expects (see types.ts's own header for why the core interpreter never
 * imports `QueryBlockTerm`). `totalRowCount` defaults to the CURRENT rows'
 * own length (the honest, untruncated case); `setTotalRowCount` overrides it
 * independently, so a test can exercise the fetch-layer-clamped case (a real
 * `totalRowCount` larger than the rows actually delivered) the way
 * `query-block-service.ts`'s own 500-row clamp genuinely can in production.
 */
export interface ControllableGridCollectionAdapter {
  readonly adapter: DerivedResourceAdapter<GridCollectionQueryHandle>
  readonly computeCalls: ResourceLocator[]
  readonly disposeCalls: string[]
  runCallCount(): number
  setRows(rows: readonly Readonly<Record<string, ControllableGridCollectionTerm>>[]): void
  setTotalRowCount(totalRowCount: number | null): void
  setError(error: unknown): void
}

export function createGridCollectionAdapter(adapterId = 'test.grid-collection'): ControllableGridCollectionAdapter {
  const computeCalls: ResourceLocator[] = []
  const disposeCalls: string[] = []
  let nextRows: readonly Readonly<Record<string, ControllableGridCollectionTerm>>[] = []
  let nextTotalRowCountOverride: number | null = null
  let nextError: unknown = null
  let runCalls = 0
  const adapter: DerivedResourceAdapter<GridCollectionQueryHandle> = {
    adapterId,
    shape: 'derived',
    accepts: (locator) => locator.kind === 'query',
    resourceKey: (locator) => {
      if (locator.kind !== 'query') throw new Error('test.grid-collection: not a query locator')
      return `query:${locator.graphId}:${locator.queryId}`
    },
    compute: async (locator, context) => {
      computeCalls.push(locator)
      const store = createSurfaceResourceStore(async () => {
        runCalls += 1
        if (nextError !== null) {
          const error = nextError
          nextError = null
          throw error
        }
        const rows = nextRows.map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, term]) => [
              key,
              typeof term === 'string' ? { value: term, type: 'uri' as const } : term,
            ]),
          ),
        )
        return { rows, totalRowCount: nextTotalRowCountOverride ?? rows.length }
      }, context)
      return {
        ...store,
        run: () => refreshSurfaceResourceStore(store),
      }
    },
    dispose: (_value, key) => {
      disposeCalls.push(key)
    },
  }
  return {
    adapter,
    computeCalls,
    disposeCalls,
    runCallCount: () => runCalls,
    setRows: (rows) => {
      nextRows = rows
    },
    setTotalRowCount: (totalRowCount) => {
      nextTotalRowCountOverride = totalRowCount
    },
    setError: (error) => {
      nextError = error
    },
  }
}
