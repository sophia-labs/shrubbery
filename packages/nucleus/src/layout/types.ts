/**
 * Layout-as-data — Phase 1 logical schema.
 *
 * Mirrors plans/shrubbery-layout-as-data-design-20260716.md §2.2, with one
 * deliberate, documented extension: `LayoutLeafNode.descriptorRevision`.
 * §2.2's literal code block does not list this field, but §2.1's own identity
 * ladder names "leaf descriptor revision" as a distinct identity layer, and
 * §2.5's normative text requires it ("descriptor revision", "Increment
 * descriptor revision on replacement... reject stale... replacement
 * operations"). Without a stored field there is nothing for a precondition to
 * compare against — see operations.ts's `expectedDescriptorRevision` on
 * `replace_descriptor`, added per design §9.2 Phase 1 diff-review r1. This is
 * a schema EXTENSION the design's own prose requires, not a deviation from it.
 *
 * Physical encoding (Y.Doc, RDF projection) is explicitly OUT of Phase 1
 * (design §2.3, §9.2 Phase 1) — a plain immutable object is the only carrier
 * here.
 *
 * Every value that leaves operations.ts's `applyOperation` (and validate.ts's
 * `createValidatedLayoutDocument`) is deep-frozen and built from a deep CLONE
 * of any caller-supplied descriptor, never a live caller reference — see
 * immutable.ts and operations.ts's `finalizeCandidate`. types.ts itself still
 * carries no runtime code beyond the tiny, frozen `sophia.home` descriptor
 * constant below.
 *
 * Ratios are integer basis points (1..9999; 5000 = 50%) to avoid float drift
 * across JSON, Yjs, RDF decimals, and DOM percentages (design §2.2). Pixel
 * allocation is NEVER stored — see solver.ts.
 */

/**
 * Split-divider orientation, named by LAYOUT FLOW direction (not divider
 * direction) — this is the exact ambiguity the design calls out (§2.2):
 *   horizontal = start/end laid left-to-right, with a VERTICAL divider line.
 *   vertical   = start/end laid top-to-bottom, with a HORIZONTAL divider line.
 */
export type Axis = 'horizontal' | 'vertical'

/** Integer basis-point bounds for a split's `startBasisPoints` (design §2.2). */
export const MIN_BASIS_POINTS = 1
export const MAX_BASIS_POINTS = 9999
/** The basis-point value operations use when a caller omits an explicit ratio. */
export const DEFAULT_BASIS_POINTS = 5000

export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
}

/** True iff `value` is an integer in the legal document range [1, 9999]. */
export function isValidBasisPoints(value: unknown): value is number {
  return isInteger(value) && value >= MIN_BASIS_POINTS && value <= MAX_BASIS_POINTS
}

/** True iff `value` is a non-negative integer (a legal `descriptorRevision`). */
export function isValidDescriptorRevision(value: unknown): value is number {
  return isInteger(value) && value >= 0
}

/**
 * A canonical resource locator — the durable-domain-resource half of a leaf's
 * descriptor (design §2.2). Each variant names the resource kind and the
 * identifiers needed to resolve it; NONE of them carry resource content
 * (document text, query rows, chat messages) — see diagnostics.ts's
 * content-free rule, which this shape makes possible by construction.
 */
export type ResourceLocator =
  | { readonly kind: 'document'; readonly graphId: string; readonly documentId: string }
  | { readonly kind: 'graph'; readonly graphId: string; readonly subjectIri?: string }
  | {
      readonly kind: 'query'
      readonly graphId: string
      readonly queryId: string
      readonly revision?: string
    }
  | { readonly kind: 'chat'; readonly graphId: string; readonly sessionId: string }
  | { readonly kind: 'iri'; readonly iri: string }

/** The set of legal `ResourceLocator.kind` discriminants (for shape checks). */
export const RESOURCE_LOCATOR_KINDS = ['document', 'graph', 'query', 'chat', 'iri'] as const

/**
 * A leaf's durable, portable intent: resource + face + face-validated params.
 * NOT a serialized DOM, component instance, callback bag, access token,
 * provider object, query result cache, or arbitrary editor state (design §3.1).
 *
 * `faceId` is a semantic/versioned catalog coordinate. Phase 1 has no real
 * registry (that's P2) — see validate.ts's pluggable `isFaceRegistered`
 * predicate. The DEFAULT predicate is a mandatory, closed allow-list of the
 * few face ids Phase 1 itself mints (currently just `sophia.home`), NOT a
 * permissive shape-only check (design §9.2 Phase 1 diff-review r1) — a real
 * caller injects its own registry-backed predicate (P2's `FaceRegistration`
 * catalog) via `ValidateOptions.isFaceRegistered`.
 *
 * `params`, when present, MUST be closed, JSON-plain, serializable data —
 * validate.ts recursively rejects functions, class/provider/DOM instances,
 * and unknown/forbidden keys at any depth (design §2.2's "not an untyped
 * escape hatch").
 */
export interface ViewDescriptor {
  readonly schemaVersion: 1
  readonly faceId: string
  readonly resource: ResourceLocator
  readonly params?: Readonly<Record<string, unknown>>
}

/**
 * A leaf node: geometry identity `id` plus a typed view descriptor.
 *
 * `descriptorRevision` — see this file's header comment — starts at 0 for a
 * freshly created leaf and is incremented by operations.ts exactly when the
 * leaf's descriptor is replaced (`replace_descriptor`, and `close_leaf`'s
 * root-replacement-with-`sophia.home` branch). It is NEVER touched by an
 * operation that does not rebind this leaf's descriptor (split/close of a
 * SIBLING, ratio, swap, move) — those preserve the leaf's node object by
 * reference, so its revision necessarily comes along unchanged.
 */
export interface LayoutLeafNode {
  readonly kind: 'leaf'
  readonly id: string
  readonly descriptor: ViewDescriptor
  readonly descriptorRevision: number
}

/** A binary split node: geometry identity plus axis, two children, and a ratio. */
export interface LayoutSplitNode {
  readonly kind: 'split'
  readonly id: string
  readonly axis: Axis
  readonly startNodeId: string
  readonly endNodeId: string
  /** Integer 1..9999; 5000 = 50%. */
  readonly startBasisPoints: number
}

// ── grid/collection composition node (Wave 2 x Lane B, design
// plans/surface-wave2-laneb-slice-20260716.md §2) ───────────────────────────

/**
 * Grid flow modes legal in v1 (design §2.1). `'freeform' | 'radial'` are
 * RESERVED names for future flow modes (design §8 open decision 2: "Flow set
 * v1 = reflow + stack ... freeform/radial reserved in the enum, unbuilt? Recommend
 * yes") — deliberately NOT part of this type union, and not accepted by any
 * op/validator/solver in this module family. When a flow mode is actually
 * built, it is added here (and to `GRID_FLOWS`) in the same change, not
 * pre-declared speculatively.
 */
export type GridFlow = 'reflow' | 'stack'

/** The closed, ordered set of `GridFlow`'s legal members (mirrors `LAYOUT_SCOPES`'s role for `LayoutDocument.scope`). */
export const GRID_FLOWS: readonly GridFlow[] = ['reflow', 'stack']

export function isValidGridFlow(value: unknown): value is GridFlow {
  return typeof value === 'string' && (GRID_FLOWS as readonly string[]).includes(value)
}

/** Integer pixel lower bound for a grid's `minCellWidth` (design §2.1: "reflow: auto-fill column basis (px, int)"). */
export const MIN_CELL_WIDTH_FLOOR = 1

export function isValidMinCellWidth(value: unknown): value is number {
  return isInteger(value) && value >= MIN_CELL_WIDTH_FLOOR
}

/**
 * `gridRevision` mirrors `descriptorRevision` exactly (design §2.1: "bumped
 * by every grid_* op — mirrors descriptorRevision") — same legal range
 * (non-negative integer), same "starts at 0, bumped on every mutating write"
 * contract, just scoped to the grid's own flow/minCellWidth/children config
 * rather than a leaf's descriptor.
 */
export function isValidGridRevision(value: unknown): value is number {
  return isInteger(value) && value >= 0
}

/**
 * Hard cap on a collection source's `maxItems` — REQUIRED per field (design
 * §2.1: "hard cap, required (no silent unbounded fan-out)"), a positive
 * integer; there is no "unbounded" spelling.
 */
export function isValidMaxItems(value: unknown): value is number {
  return isInteger(value) && value >= 1
}

/**
 * `refreshSeconds`, when present, is a non-negative integer; `0` or an absent
 * field both mean "load-once" (design §2.1).
 */
export function isValidRefreshSeconds(value: unknown): value is number {
  return isInteger(value) && value >= 0
}

/**
 * A fixed grid cell: geometry-free identity (`id`, scoped to this grid's own
 * `cells` array — NOT the document-wide `nodes` id space, since a cell is
 * never a `LayoutNode` tree entry, design §2.1: "Collection rows never enter
 * the LayoutDocument... the document stores only the binding") plus a typed
 * view descriptor and an optional reflow column-span hint.
 */
export interface GridCell {
  readonly id: string
  readonly descriptor: ViewDescriptor
  /** Column span hint, reflow flow only (design §2.1). */
  readonly span?: 1 | 2 | 3
}

/**
 * A grid's children: either a caller-authored fixed list of cells, or a
 * binding to a query whose rows become virtual, render-time-only cells
 * (design §2.1/§2.2). `collection.kind` is `'query'` in v1 — the SELECT is
 * expected to bind `?item` (an IRI) per row, a semantic constraint this pure
 * structural model cannot itself verify (mirrors `ResourceLocator.query`'s
 * `queryId` being opaque raw SPARQL text throughout this module family).
 */
export type GridChildrenSource =
  | { readonly kind: 'fixed'; readonly cells: readonly GridCell[] }
  | {
      readonly kind: 'collection'
      readonly collection: ResourceLocator
      readonly itemFaceId: string
      /** Values may reference `'?var'` bindings from the collection query's row (design §2.1). */
      readonly itemParams?: Readonly<Record<string, string>>
      readonly maxItems: number
      /** `0` or absent = load-once. */
      readonly refreshSeconds?: number
    }

/**
 * A grid node: geometry identity `id` plus flow config and a children
 * source. THIRD `LayoutNode` kind (design §2 thesis) — legal wherever a leaf
 * is (child of a split, or root); presents to the split solver as ONE opaque
 * allocation (solver.ts) and, unlike `split`, carries no `nodes`-map child
 * references at all — a grid's cells (fixed) or binding (collection) are
 * embedded directly in this node, never indirected through `LayoutDocument.nodes`.
 */
export interface LayoutGridNode {
  readonly kind: 'grid'
  readonly id: string
  readonly flow: GridFlow
  /** reflow: auto-fill column basis, px, integer >= 1. */
  readonly minCellWidth: number
  readonly children: GridChildrenSource
  /** Bumped by every `grid_*` op — mirrors `descriptorRevision`. */
  readonly gridRevision: number
}

/**
 * The caller-supplied grid configuration payload for `insert_grid`
 * (operations.ts) — exactly `LayoutGridNode`'s own fields minus `id` /
 * `gridRevision`, which the operation assigns (`gridRevision` always starts
 * at 0 for a freshly inserted grid, mirroring `split_leaf`'s fresh leaf
 * always starting `descriptorRevision` at 0).
 */
export interface GridConfig {
  readonly flow: GridFlow
  readonly minCellWidth: number
  readonly children: GridChildrenSource
}

/** Bound on a tabs node's tab list. */
export const MAX_TABS = 32

/** Bound on one tab's label. */
export const MAX_TAB_LABEL_LENGTH = 120

export function isValidTabsRevision(value: unknown): value is number {
  return isInteger(value) && value >= 0
}

export function isValidTabLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TAB_LABEL_LENGTH
}

export interface LayoutTab {
  readonly nodeId: string
  readonly label: string
}

export interface LayoutTabsNode {
  readonly kind: 'tabs'
  readonly id: string
  readonly tabs: readonly LayoutTab[]
  readonly activeNodeId: string
  readonly tabsRevision: number
}

/** Structural children in document order. */
export function childNodeIds(node: LayoutNode): readonly string[] {
  switch (node.kind) {
    case 'split':
      return [node.startNodeId, node.endNodeId]
    case 'tabs':
      return node.tabs.map((tab) => tab.nodeId)
    case 'leaf':
    case 'grid':
      return []
  }
}

export type LayoutNode = LayoutSplitNode | LayoutLeafNode | LayoutGridNode | LayoutTabsNode

/**
 * The canonical layout document (design §2.2). v1 has exactly one root; a
 * later session document may own several layout roots without changing node
 * or descriptor shape (design §2.2, final paragraph).
 */
export interface LayoutDocument {
  readonly schemaVersion: 1
  readonly layoutId: string
  readonly scope: 'session' | 'user' | 'workspace'
  readonly graphId: string | null
  readonly rootNodeId: string
  readonly nodes: Readonly<Record<string, LayoutNode>>
  readonly createdAt: string
  readonly updatedAt: string
}

/** The closed, ordered set of a `LayoutDocument`'s legal top-level fields (design §2.2). */
export const LAYOUT_DOCUMENT_KEYS = [
  'schemaVersion',
  'layoutId',
  'scope',
  'graphId',
  'rootNodeId',
  'nodes',
  'createdAt',
  'updatedAt',
] as const

export const LAYOUT_SCOPES = ['session', 'user', 'workspace'] as const

/**
 * The well-known `sophia.home` face id. LAY-010 (last leaf): a document cannot
 * have zero leaves; closing the last leaf replaces it with this descriptor
 * (design §2.1, §2.5). Phase 1 has no real registry, so this is a plain
 * constant, not a registry lookup, and it is the ONE entry in Phase 1's own
 * default face allow-list (validate.ts's `PHASE1_KNOWN_FACE_IDS`).
 */
export const SOPHIA_HOME_FACE_ID = 'sophia.home'

/**
 * The well-known home resource — a stable, content-free IRI, not a document.
 * FROZEN at module load (design §9.2 Phase 1 diff-review r1: this was
 * previously a shared MUTABLE object reachable from every `sophia.home`
 * descriptor — freezing it once here is sufficient; every consumer reuses the
 * same frozen instance rather than cloning it, since a frozen shared constant
 * is safe to alias.
 */
export const SOPHIA_HOME_RESOURCE: ResourceLocator = Object.freeze({
  kind: 'iri',
  iri: 'urn:sophia:home',
})

/** Build a fresh, frozen `sophia.home` descriptor (LAY-010's replacement leaf). */
export function createSophiaHomeDescriptor(): ViewDescriptor {
  return Object.freeze({
    schemaVersion: 1 as const,
    faceId: SOPHIA_HOME_FACE_ID,
    resource: SOPHIA_HOME_RESOURCE,
  })
}
