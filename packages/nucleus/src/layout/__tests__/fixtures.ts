/**
 * fixtures.ts — small, hand-built `LayoutDocument`s and descriptor builders
 * shared by the Phase-1 layout test suites. Plain immutable objects only — no
 * Y.Doc, no RDF, no DOM (Phase 1 is storage-agnostic and browser-free).
 *
 * TEST_FACE_IDS / testFaceRegistrationPredicate / TEST_VALIDATE_OPTIONS — the
 * production `defaultFaceRegistrationPredicate` (validate.ts) is a MANDATORY,
 * closed, PER-FACE allow-list (design §9.2 Phase 1 diff-review r2: every
 * registration owns its own closed `params` schema, not just a bare id list —
 * see `createFaceAllowListPredicate`'s `FaceRegistrationEntry` shape). Tests
 * need their OWN explicit registry so fixtures built with 'test.face' /
 * 'hoja.document' / 'sparql.bindings-table' still validate. Every test file
 * wraps `applyOperation` / `validateLayoutDocument` / `solveLayout` in a
 * local shim that defaults to `TEST_VALIDATE_OPTIONS` (see each test file's
 * header), so existing call sites that don't care about registration keep
 * working unchanged, while tests that DO care about the real default call the
 * raw, unwrapped export directly.
 *
 * `expectedParentFor` / `expectedRevisionFor` — design §9.2 Phase 1
 * diff-review r2 made `expectedParent` / `expectedTargetParent` /
 * `expectedDescriptorRevision` MANDATORY on several operations. These
 * helpers let a test compute the CORRECT precondition for a fixture document
 * without hand-deriving `ParentLocation` at every call site.
 */
import type { GridCell, GridChildrenSource, LayoutDocument, LayoutNode, ResourceLocator, ViewDescriptor } from '../types.js'
import { SOPHIA_HOME_FACE_ID } from '../types.js'
import type { ParentLocation } from '../operations.js'
import { locateParent } from '../operations.js'
import type { FaceGridEligibilityPredicate, FaceRegistrationEntry, ValidateOptions } from '../validate.js'
import { createFaceAllowListPredicate, createExactParamsSchema, noParamsAllowed } from '../validate.js'
import { deepFreeze } from '../immutable.js'

let counter = 0
/** A fresh, collision-free id for test-local node construction. */
export function freshId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

export function makeDescriptor(faceId = 'test.face', iri = 'urn:test:resource'): ViewDescriptor {
  return { schemaVersion: 1, faceId, resource: { kind: 'iri', iri } }
}

/**
 * The closed set of face ids the test suites treat as "registered" — 'the
 * test registry' the diff-review asked for. Deliberately does NOT include
 * every string the suites use as a descriptor faceId: `'unregistered.face'`
 * and `'anything.goes'` are used specifically to prove REJECTION and must
 * stay off this list.
 */
/**
 * REGISTERED (via `TEST_FACE_IDS`, below) but marked grid-INELIGIBLE by
 * `testFaceGridEligibilityPredicate` — the fixture that lets a test
 * distinguish LAY003_UNREGISTERED_FACE (the face doesn't exist at all) from
 * LAY003_CELL_FACE_NOT_GRID_ELIGIBLE (the face exists but design §2.1's cell
 * persistence rule excludes it from grid cells), exactly the way a real
 * `persistent-non-relocatable` face would be excluded by a real P2 registry.
 */
export const GRID_INELIGIBLE_FACE_ID = 'persistent.non-relocatable-face'

export const TEST_FACE_IDS: readonly string[] = [
  'test.face',
  'hoja.document',
  'sparql.bindings-table',
  'a',
  'b',
  'c',
  'new.face',
  SOPHIA_HOME_FACE_ID,
  GRID_INELIGIBLE_FACE_ID,
]

/**
 * A face registered with a genuinely NARROWER params schema than the generic
 * closed-shape floor — proves `createFaceAllowListPredicate` actually
 * consults a face's own `validateParams` (design §9.2 Phase 1 diff-review r2
 * finding: r1's allow-list validated only the faceId).
 */
export const STRICT_MODE_FACE_ID = 'strict.mode-face'

function isStrictModeParams(params: Readonly<Record<string, unknown>> | undefined): boolean {
  if (params === undefined) return false
  const keys = Object.keys(params)
  return keys.length === 1 && keys[0] === 'mode' && (params.mode === 'document' || params.mode === 'composer')
}

/**
 * `test.face` is the one test face some suites hand a `params: {count:...}`
 * object (operations.test.ts / validate.test.ts's clone-before-embed probes)
 * — a REAL, exact, closed schema (Builder P1 hardening finding 1), not the
 * old `anyClosedParams` escape hatch: `count` is the ONLY legal key, and an
 * `{arbitraryUnknownKey:1}` params object is rejected (see
 * `validate.test.ts`'s "closed params actually enforced" suite).
 */
const TEST_FACE_PARAMS_SCHEMA = createExactParamsSchema({ count: { type: 'number', optional: true } })

/**
 * Every test-registry entry — a REAL closed schema per face (Builder P1
 * hardening finding 1), not the old `anyClosedParams` stand-in that made
 * LAY-004 unfalsifiable here: `sophia.home` takes no params at all;
 * `test.face` takes an optional `count` (see `TEST_FACE_PARAMS_SCHEMA`);
 * every other test face id never carries params anywhere in these suites, so
 * it is registered with `noParamsAllowed` — an `{arbitraryUnknownKey:1}`
 * params object is rejected for EVERY one of them.
 */
export const TEST_FACE_REGISTRATIONS: readonly FaceRegistrationEntry[] = [
  ...TEST_FACE_IDS.map((faceId) => ({
    faceId,
    validateParams:
      faceId === SOPHIA_HOME_FACE_ID ? noParamsAllowed : faceId === 'test.face' ? TEST_FACE_PARAMS_SCHEMA : noParamsAllowed,
  })),
  { faceId: STRICT_MODE_FACE_ID, validateParams: isStrictModeParams },
]

export const testFaceRegistrationPredicate = createFaceAllowListPredicate(TEST_FACE_REGISTRATIONS)

/**
 * The test grid-eligibility predicate (Wave 2 x Lane B) — everything in the
 * test registry is grid-eligible EXCEPT `GRID_INELIGIBLE_FACE_ID`, which
 * stands in for a real `persistence: 'persistent-non-relocatable'` face
 * Phase 1's document model has no way to represent directly (see
 * `FaceGridEligibilityPredicate`'s doc comment, validate.ts).
 */
export const testFaceGridEligibilityPredicate: FaceGridEligibilityPredicate = (faceId) =>
  faceId !== GRID_INELIGIBLE_FACE_ID

export const TEST_VALIDATE_OPTIONS: ValidateOptions = {
  isFaceRegistered: testFaceRegistrationPredicate,
  isFaceGridEligible: testFaceGridEligibilityPredicate,
}

/**
 * A document with a single root leaf. FROZEN before it is returned (Builder
 * P1 hardening finding 2): `applyOperation`'s real, documented contract is a
 * VALID, already-frozen `LayoutDocument` (`createValidatedLayoutDocument`'s
 * output, or a prior `applyOperation` call's output) — `finalizeCandidate`
 * only avoids mutating the CALLER's own graph by cloning any not-yet-frozen
 * subtree it must freeze (see `freezeWithoutMutatingOwner`, immutable.ts),
 * which means an untouched node's reference identity across an operation is
 * only guaranteed when the input was already frozen. Every test in this
 * suite family that asserts LAY-002 reference-preservation (`toBe`, not
 * `toEqual`, on an untouched sibling) depends on starting from a frozen
 * fixture — this is that starting point.
 */
export function singleLeafDoc(rootId = 'leaf-root', faceId = 'test.face'): LayoutDocument {
  const nodes: Record<string, LayoutNode> = {
    [rootId]: { kind: 'leaf', id: rootId, descriptor: makeDescriptor(faceId), descriptorRevision: 0 },
  }
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'test-layout',
    scope: 'session',
    graphId: null,
    rootNodeId: rootId,
    nodes,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  })
}

/** A document with a root split of two leaves (start=A, end=B). */
export function twoLeafDoc(): {
  readonly doc: LayoutDocument
  readonly splitId: string
  readonly leafAId: string
  readonly leafBId: string
} {
  const splitId = 'split-root'
  const leafAId = 'leaf-a'
  const leafBId = 'leaf-b'
  const nodes: Record<string, LayoutNode> = {
    [splitId]: {
      kind: 'split',
      id: splitId,
      axis: 'horizontal',
      startNodeId: leafAId,
      endNodeId: leafBId,
      startBasisPoints: 5000,
    },
    [leafAId]: {
      kind: 'leaf',
      id: leafAId,
      descriptor: makeDescriptor('test.face', 'urn:test:a'),
      descriptorRevision: 0,
    },
    [leafBId]: {
      kind: 'leaf',
      id: leafBId,
      descriptor: makeDescriptor('test.face', 'urn:test:b'),
      descriptorRevision: 0,
    },
  }
  const doc: LayoutDocument = deepFreeze({
    schemaVersion: 1,
    layoutId: 'test-layout',
    scope: 'session',
    graphId: null,
    rootNodeId: splitId,
    nodes,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  })
  return { doc, splitId, leafAId, leafBId }
}

/**
 * The CORRECT `expectedParent`/`expectedTargetParent` precondition for `id`
 * in `doc` right now — throws (a fixture-invariant error, not a matcher) if
 * `id` does not exist, since every call site already knows it should.
 */
export function expectedParentFor(doc: LayoutDocument, id: string): ParentLocation {
  const loc = locateParent(doc, id)
  if (!loc) throw new Error(`fixture invariant: '${id}' not found in document`)
  return loc
}

/** The CORRECT `expectedDescriptorRevision` precondition for leaf `leafId` in `doc` right now. */
export function expectedRevisionFor(doc: LayoutDocument, leafId: string): number {
  const node = doc.nodes[leafId]
  if (!node || node.kind !== 'leaf') throw new Error(`fixture invariant: '${leafId}' is not a leaf`)
  return node.descriptorRevision
}

// ── grid/collection node fixtures (Wave 2 x Lane B) ─────────────────────────

/** The CORRECT `expectedGridRevision` precondition for grid `gridId` in `doc` right now. */
export function expectedGridRevisionFor(doc: LayoutDocument, gridId: string): number {
  const node = doc.nodes[gridId]
  if (!node || node.kind !== 'grid') throw new Error(`fixture invariant: '${gridId}' is not a grid`)
  return node.gridRevision
}

export function expectedTabsRevisionFor(doc: LayoutDocument, tabsId: string): number {
  const node = doc.nodes[tabsId]
  if (!node || node.kind !== 'tabs') throw new Error(`fixture expected tabs node '${tabsId}'`)
  return node.tabsRevision
}

export function makeTab(nodeId: string, label = nodeId): { readonly nodeId: string; readonly label: string } {
  return { nodeId, label }
}

function layoutDoc(rootNodeId: string, nodes: Record<string, LayoutNode>): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'test-layout',
    scope: 'session',
    graphId: null,
    rootNodeId,
    nodes,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  })
}

export function singleTabsDoc(): LayoutDocument {
  return layoutDoc('T', {
    T: { kind: 'tabs', id: 'T', tabs: [makeTab('t-a', 'A'), makeTab('t-b', 'B')], activeNodeId: 't-a', tabsRevision: 0 },
    't-a': { kind: 'leaf', id: 't-a', descriptor: makeDescriptor('test.face', 'urn:test:a'), descriptorRevision: 0 },
    't-b': { kind: 'leaf', id: 't-b', descriptor: makeDescriptor('test.face', 'urn:test:b'), descriptorRevision: 0 },
  })
}

export function tabsInSplitDoc(): LayoutDocument {
  return layoutDoc('root-split', {
    'root-split': { kind: 'split', id: 'root-split', axis: 'horizontal', startNodeId: 'outside', endNodeId: 'T', startBasisPoints: 5000 },
    outside: { kind: 'leaf', id: 'outside', descriptor: makeDescriptor('test.face', 'urn:test:outside'), descriptorRevision: 0 },
    T: { kind: 'tabs', id: 'T', tabs: [makeTab('t-a', 'A'), makeTab('t-b-split', 'B')], activeNodeId: 't-a', tabsRevision: 0 },
    't-a': { kind: 'leaf', id: 't-a', descriptor: makeDescriptor('test.face', 'urn:test:a'), descriptorRevision: 0 },
    't-b-split': { kind: 'split', id: 't-b-split', axis: 'vertical', startNodeId: 't-b1', endNodeId: 't-b2', startBasisPoints: 5000 },
    't-b1': { kind: 'leaf', id: 't-b1', descriptor: makeDescriptor('test.face', 'urn:test:b1'), descriptorRevision: 0 },
    't-b2': { kind: 'leaf', id: 't-b2', descriptor: makeDescriptor('test.face', 'urn:test:b2'), descriptorRevision: 0 },
  })
}

export function makeGridCell(id: string, faceId = 'test.face', iri?: string, span?: 1 | 2 | 3): GridCell {
  return {
    id,
    descriptor: makeDescriptor(faceId, iri ?? `urn:test:cell:${id}`),
    ...(span !== undefined ? { span } : {}),
  }
}

export function makeFixedChildren(cells: readonly GridCell[]): GridChildrenSource {
  return { kind: 'fixed', cells }
}

/** A `'query'` `ResourceLocator` — the only `collection.kind` legal in v1 (design §2.1). */
export function makeQueryLocator(queryId = 'SELECT ?item WHERE { ?item a <urn:test:Thing> }', graphId = 'test-graph'): ResourceLocator {
  return { kind: 'query', graphId, queryId }
}

export function makeCollectionChildren(
  overrides: Partial<Extract<GridChildrenSource, { kind: 'collection' }>> = {},
): GridChildrenSource {
  return {
    kind: 'collection',
    collection: makeQueryLocator(),
    itemFaceId: 'test.face',
    maxItems: 10,
    ...overrides,
  }
}

/** A document with a single root grid (fixed source, two cells by default). */
export function singleGridDoc(rootId = 'grid-root', cells?: readonly GridCell[]): LayoutDocument {
  const gridCells = cells ?? [makeGridCell('cell-a'), makeGridCell('cell-b')]
  const nodes: Record<string, LayoutNode> = {
    [rootId]: {
      kind: 'grid',
      id: rootId,
      flow: 'reflow',
      minCellWidth: 200,
      children: makeFixedChildren(gridCells),
      gridRevision: 0,
    },
  }
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'test-layout',
    scope: 'session',
    graphId: null,
    rootNodeId: rootId,
    nodes,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  })
}

/** A document with a root split of a leaf (start) and a grid (end) — for close_node / grid_* op targets. */
export function leafAndGridDoc(): {
  readonly doc: LayoutDocument
  readonly splitId: string
  readonly leafId: string
  readonly gridId: string
} {
  const splitId = 'split-root'
  const leafId = 'leaf-a'
  const gridId = 'grid-a'
  const nodes: Record<string, LayoutNode> = {
    [splitId]: {
      kind: 'split',
      id: splitId,
      axis: 'horizontal',
      startNodeId: leafId,
      endNodeId: gridId,
      startBasisPoints: 5000,
    },
    [leafId]: {
      kind: 'leaf',
      id: leafId,
      descriptor: makeDescriptor('test.face', 'urn:test:a'),
      descriptorRevision: 0,
    },
    [gridId]: {
      kind: 'grid',
      id: gridId,
      flow: 'reflow',
      minCellWidth: 200,
      children: makeFixedChildren([makeGridCell('cell-a')]),
      gridRevision: 0,
    },
  }
  const doc: LayoutDocument = deepFreeze({
    schemaVersion: 1,
    layoutId: 'test-layout',
    scope: 'session',
    graphId: null,
    rootNodeId: splitId,
    nodes,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  })
  return { doc, splitId, leafId, gridId }
}
