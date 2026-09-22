/**
 * layout-interpreter.ts — live-reads a Phase-1 `LayoutDocument` and
 * reconciles it into DOM (design §3.3; Builder-1 task brief).
 *
 * The interpreter owns STRUCTURE and reconciliation, never content behavior
 * (design §3.3): it validates the document and solves geometry entirely
 * through Phase-1's own `solveLayout` (never reimplementing tree walking or
 * arithmetic), keys every leaf/split wrapper by stable NODE ID (not tree
 * position), and renders through the RECURSIVE split tree the solver
 * produces — each split wrapper is a real DOM parent of its two children,
 * never a flat grid.
 *
 * LAY-007 (reconciliation by id) is the one property this file exists to
 * guarantee structurally: a leaf whose id, `descriptorRevision`, AND
 * host-owned resource scope are unchanged between two `reconcile()` calls
 * keeps its exact wrapper element, its exact mounted `FaceView` instance, and
 * its exact resource lease — only `FaceView.resize()` runs. A ratio change, a
 * `move_node`/`swap_nodes` (same leaf id relocated elsewhere in the tree), or
 * an ancestor split's axis/ratio change all leave `descriptorRevision`
 * untouched (types.ts's own contract), so none of them remounts anything
 * here. `replace_descriptor` (which Phase 1 defines as incrementing
 * `descriptorRevision`), a host resource-scope rotation (session/service
 * identity changed), or the leaf's outright removal triggers
 * dispose+reacquire+remount.
 */
import {
  DEFAULT_DIVIDER_THICKNESS,
  solveLayout,
  type Diagnostic,
  type FaceGridEligibilityPredicate,
  type FaceRegistrationPredicate,
  type GridCell,
  type GridChildrenSource,
  type LayoutDocument,
  type LayoutGridNode,
  type LayoutNode,
  type LayoutPlan,
  type LayoutPlanNode,
  type LeafConstraintsMap as SolverLeafConstraintsMap,
  type LeafSizeConstraints,
  type ViewDescriptor,
} from '@shrubbery/nucleus/layout'
import type { FaceRegistry } from './face-registry.js'
import {
  DEFAULT_LEAF_CONSTRAINTS,
  type DisposeReason,
  type FaceView,
  type FocusReason,
  type GridCollectionQueryHandle,
  type GridCollectionQueryResult,
  type GridCollectionRow,
  type LeafConstraints,
  type PixelBox,
  type ResourceBroker,
  type ResourceLease,
} from './types.js'

export interface LayoutInterpreterOptions {
  readonly registry: FaceRegistry
  readonly broker: ResourceBroker
  readonly dividerThickness?: number
  /**
   * Host-owned session/auth generation. A change remounts resource-bearing
   * leaves/cells even when graph-authored descriptors are byte-identical.
   */
  readonly resourceScope?: () => string | number | null
  /**
   * The `ResourceBroker`-registered adapter id used to resolve a grid's
   * COLLECTION children source (`GridChildrenSource.collection`, a `query`
   * `ResourceLocator`) into a `GridCollectionQueryHandle` lease — mirrors
   * `FaceRegistration.resourceAdapterId`'s "named, never guessed" discipline
   * (resource-broker.ts's own header). Consulted only by a document that
   * actually binds a grid to a collection; a document with no collection-
   * bound grid never touches it. Omitting it while reconciling a
   * collection-bound grid paints that grid's own error state
   * (`collection-adapter-unconfigured`) rather than throwing — see
   * `reconcileCollectionGrid`.
   */
  readonly gridCollectionResourceAdapterId?: string
  readonly onTabActivate?: (request: TabActivateRequest) => void
}

export interface TabActivateRequest {
  readonly tabsId: string
  readonly nodeId: string
  readonly source: 'pointer' | 'keyboard'
}

export interface ReconcileResult {
  readonly ok: boolean
  readonly diagnostics: readonly Diagnostic[]
}

export interface LayoutRuntimeDiagnostics {
  readonly lastValid: boolean
  readonly diagnostics: readonly Diagnostic[]
  readonly mountedLeafIds: readonly string[]
}

interface MountedLeaf {
  readonly leafId: string
  readonly descriptorRevision: number
  readonly resourceScope: string | number | null
  readonly lease: ResourceLease
  readonly view: FaceView
}

const ERROR_REASON_ATTR = 'data-layout-error-reason'

// ── grid renderer internals (Wave 2 x Lane B spec
// plans/surface-wave2-laneb-slice-20260716.md §3) ───────────────────────────

/** Grid-level total-failure reason, painted into the interior in place of any cells (see `renderGridError`). */
const GRID_ERROR_REASON_ATTR = 'data-layout-grid-error-reason'
/** Non-destructive refresh-tick failure marker — set/cleared WITHOUT touching already-mounted cells (see `runGridCollectionRefresh`). */
const GRID_COLLECTION_TICK_ERROR_ATTR = 'data-layout-grid-collection-error'
const GRID_COUNT_BADGE_ATTR = 'data-layout-grid-count-badge'
const GRID_CELL_ID_ATTR = 'data-layout-grid-cell-id'
/** Gap between cells inside the interior CSS grid — a fixed constant, not a document field (mirrors nucleus solver.ts's own `GRID_FLOOR_HEIGHT` convention: the interpreter owns its own chrome constants, never sourced from layout data). */
const GRID_CELL_GAP_PX = 8
/** `grid-auto-rows` floor for the interior CSS grid, so a freshly-mounted (still loading) cell never collapses to zero height before its face paints real content — mirrors nucleus solver.ts's `GRID_FLOOR_HEIGHT` for the SAME reason, one layer up. */
const GRID_ROW_MIN_HEIGHT_PX = 140

interface MountedGridCell {
  readonly lease: ResourceLease
  readonly view: FaceView
  readonly constraints: LeafConstraints
  /** `JSON.stringify({resourceScope, descriptor})` for a FIXED cell's change detection (operations.ts's `grid_set_cells` is a whole-array replace, so cell identity alone cannot detect a content or host-scope change — see `reconcileFixedGridCells`). Always `''` for a collection-derived cell, whose identity IS its `?item` IRI (spec §2.1) — reconciled by id alone inside one binding scope. */
  readonly descriptorSignature: string
}

interface GridCollectionRuntimeState {
  /**
   * A content signature of the SEMANTICALLY relevant binding fields
   * (`collectionBindingSignature` — `collection`/`itemFaceId`/`itemParams`/
   * `maxItems`/`refreshSeconds`) this lease was acquired under. A change
   * here forces a full re-bind (see `reconcileCollectionGrid`).
   *
   * Deliberately NOT `LayoutGridNode.gridRevision`: `gridRevision` is bumped
   * by EVERY `grid_*` op on this node (`grid_set_cells`/`grid_bind_collection`/
   * `grid_set_flow` alike — types.ts's own "mirrors descriptorRevision"
   * contract), so keying rebind on revision equality could not distinguish
   * "the binding itself changed" from "only `flow`/`minCellWidth` changed"
   * (grid-laneb review r1 WRONG finding: "unrelated grid configuration
   * updates" — a bare `grid_set_flow` — "preserve collection cell mounts"
   * was violated: every `grid_set_flow` forced a full unmount/re-lease/
   * remount of every already-live collection cell). A content signature
   * scoped to the binding's own fields is immune to a sibling field's
   * revision bump.
   */
  readonly boundSignature: string
  readonly lease: ResourceLease
  intervalHandle: ReturnType<typeof setInterval> | null
  refreshing: boolean
}

/**
 * Stable content signature of a collection binding's SEMANTICALLY relevant
 * fields — host `resourceScope` plus `collection`/`itemFaceId`/`itemParams`/`maxItems`/
 * `refreshSeconds` — deliberately excluding the grid's OWN `flow`/
 * `minCellWidth` (sibling fields on `LayoutGridNode`, never part of
 * `GridChildrenSource` to begin with) and `gridRevision` itself (see
 * `GridCollectionRuntimeState.boundSignature`'s own doc comment for why).
 * Mirrors `reconcileFixedGridCells`'s own `JSON.stringify(cell.descriptor)`
 * content-signature idiom, one layer up — these fields are closed/JSON-plain
 * by construction (nucleus validate.ts's own LAY-004), so this is safe and
 * deterministic.
 */
function collectionBindingSignature(
  children: Extract<GridChildrenSource, { kind: 'collection' }>,
  resourceScope: string | number | null,
): string {
  return JSON.stringify({
    resourceScope,
    collection: children.collection,
    itemFaceId: children.itemFaceId,
    itemParams: children.itemParams,
    maxItems: children.maxItems,
    refreshSeconds: children.refreshSeconds,
  })
}

interface GridRuntimeState {
  /** Root-parented, absolutely-positioned wrapper — same discipline as every leaf/split wrapper (`ensureWrapper`'s own doc comment). */
  readonly outer: HTMLElement
  /** The ONE sanctioned exception to flat root-parenting (spec §3): cells mount inside THIS element, itself a child of `outer`. */
  readonly interior: HTMLElement
  readonly badge: HTMLElement
  readonly cellWrappers: Map<string, HTMLElement>
  readonly cellMounts: Map<string, MountedGridCell>
  readonly resizeObserver: ResizeObserver | null
  /** Non-null only while `children.kind === 'collection'` and a lease is currently held. */
  collection: GridCollectionRuntimeState | null
}

/** A cell wrapper's OWN measured box — never root-absolute (unlike a leaf/split wrapper's solver-provided `PixelBox`): a grid cell's position/size comes from CSS grid track layout, not the Phase-1 solver (design §2.3's opaque-box treatment). Real faces ignore `x`/`y` and fill via `:host{width:100%;height:100%}` (see stat-scalar-view-element.ts etc.), so `{x:0,y:0}` is honest, not a stand-in for unavailable data. */
function measureGridCellBox(wrapper: HTMLElement): PixelBox {
  const rect = wrapper.getBoundingClientRect()
  return { x: 0, y: 0, width: rect.width, height: rect.height }
}

/**
 * Resolve one `itemParams` value against a collection row's bindings (spec
 * §2.1: "values may reference '?var' from the row"). A value is either a
 * literal string (returned verbatim — most of §5's dashboard cells pass
 * constant predicate CURIEs this way, e.g. `titleField: obs:witness`) or an
 * EXACT `'?varName'` reference, substituted with that binding's plain text
 * value. An unbound reference resolves to `undefined` (the key is OMITTED
 * from the built descriptor, not coerced to `''`) — a face whose params
 * schema requires that key then honestly fails `registry.validate` at mount
 * time (this file's per-cell error-leaf painting), never a silently blank
 * field.
 */
function resolveItemParamValue(template: string, row: GridCollectionRow): string | undefined {
  if (!template.startsWith('?')) return template
  return row[template.slice(1)]?.value
}

/**
 * Pure — exported for unit testing (mirrors `buildGridCollectionCellDescriptor`'s
 * own "pure, exported" note, one step later in the same pipeline). A row
 * yields a valid collection identity ONLY when its `?item` binding is a
 * genuine URI term (spec §2.1: "SELECT must bind `?item` (IRI)") — a literal
 * or blank node that happens to share the same `.value: string` shape is not
 * a legal item identity (grid-laneb review r1 finding (b): the previous check
 * only asked "is this a non-empty string", so a `?item` accidentally bound to
 * a literal was silently accepted as if it were real collection identity).
 * `type` is read defensively — `GridCollectionTerm.type` stays optional by
 * design (`types.ts`'s own header), so a term that genuinely omits it is
 * treated the same as "not proven to be a URI", never given the benefit of
 * the doubt.
 */
export function collectionItemIri(row: GridCollectionRow): string | null {
  const term = row['item']
  if (!term || term.type !== 'uri' || term.value.length === 0) return null
  return term.value
}

/**
 * Pure — exported for unit testing. Builds the virtual `ViewDescriptor` for
 * one collection row (spec §2.1/§3): resource is always `{kind:'iri', iri:
 * itemIri}` (the row's own identity), faceId is the source's `itemFaceId`,
 * and `params` is `itemParams` with every `'?var'` reference resolved against
 * this row (unresolvable references omitted — see `resolveItemParamValue`).
 * Collection rows never enter the `LayoutDocument` (design §2.1) — this
 * descriptor is render-time-only, built fresh on every refresh tick.
 */
export function buildGridCollectionCellDescriptor(
  children: Extract<GridChildrenSource, { kind: 'collection' }>,
  row: GridCollectionRow,
  itemIri: string,
): ViewDescriptor {
  const params: Record<string, string> = {}
  if (children.itemParams) {
    for (const [key, template] of Object.entries(children.itemParams)) {
      const resolved = resolveItemParamValue(template, row)
      if (resolved !== undefined) params[key] = resolved
    }
  }
  return {
    schemaVersion: 1,
    faceId: children.itemFaceId,
    resource: { kind: 'iri', iri: itemIri },
    ...(Object.keys(params).length > 0 ? { params } : {}),
  }
}

export class LayoutInterpreter {
  private readonly root: HTMLElement
  private readonly registry: FaceRegistry
  private readonly broker: ResourceBroker
  private readonly dividerThickness: number
  private readonly resourceScope: () => string | number | null
  private readonly isFaceRegistered: FaceRegistrationPredicate
  private readonly isFaceGridEligible: FaceGridEligibilityPredicate
  private readonly gridCollectionResourceAdapterId: string | undefined
  private readonly onTabActivate: ((request: TabActivateRequest) => void) | undefined

  private readonly leafWrappers = new Map<string, HTMLElement>()
  private readonly splitWrappers = new Map<string, HTMLElement>()
  private readonly tabsWrappers = new Map<string, HTMLElement>()
  private readonly mounted = new Map<string, MountedLeaf>()
  private readonly grids = new Map<string, GridRuntimeState>()

  private lastValidPlan: LayoutPlan | null = null
  private lastDiagnostics: readonly Diagnostic[] = []
  private disposed = false
  /**
   * F4 fix (repair round 3): the document from the LAST successful
   * `reconcile()`, retained purely so `handleFocusHandoff` can look up
   * `focusedLeafIdBefore`'s parent split and sibling in a tree that STILL
   * contains the leaf that is about to be (or was just) closed — the `doc`
   * argument of the CURRENT `reconcile()` call may no longer contain it at
   * all. Never used for anything else; the interpreter's live mount/wrapper
   * state remains the sole source of truth for everything else it does.
   */
  private lastDoc: LayoutDocument | null = null
  private pendingTabFocusNodeId: string | null = null

  constructor(root: HTMLElement, options: LayoutInterpreterOptions) {
    this.root = root
    this.registry = options.registry
    this.broker = options.broker
    this.dividerThickness = options.dividerThickness ?? DEFAULT_DIVIDER_THICKNESS
    this.resourceScope = options.resourceScope ?? (() => null)
    this.gridCollectionResourceAdapterId = options.gridCollectionResourceAdapterId
    this.onTabActivate = options.onTabActivate
    // The registry backs BOTH the P2 mount-time gate (`FaceRegistry.validate`)
    // and Phase 1's own document-validity gate — see face-registry.ts's
    // `toFaceRegistrationPredicate` doc comment.
    this.isFaceRegistered = this.registry.toFaceRegistrationPredicate()
    // Same registry, adapted into Phase 1's OTHER validity predicate — the
    // cell persistence rule (design §2.1). Without this, `solveLayout` would
    // fall back to its permissive default and never actually enforce it in
    // production (see `toFaceGridEligibilityPredicate`'s own doc comment).
    this.isFaceGridEligible = this.registry.toFaceGridEligibilityPredicate()
    this.root.style.position = 'relative'
    this.root.style.overflow = 'hidden'
  }

  /**
   * Validate + solve + reconcile one document against one container size.
   * LAY-012: an invalid document (or infeasible geometry) never reaches the
   * DOM walk — the interpreter returns `{ok:false, diagnostics}` and leaves
   * every previously mounted wrapper/view/lease exactly as it was.
   */
  async reconcile(
    document: LayoutDocument,
    container: { readonly width: number; readonly height: number },
  ): Promise<ReconcileResult> {
    if (this.disposed) throw new Error('LayoutInterpreter: reconcile() called after dispose()')

    // F4 fix (repair round 3): capture WHICH leaf (if any) currently owns DOM
    // focus BEFORE this reconcile does anything. If that leaf is closed by
    // this pass, `handleFocusHandoff` below uses this to hand focus to its
    // promoted sibling — computed from `this.lastDoc`'s tree shape, not the
    // caller-supplied `document` (which may no longer even mention the
    // closed leaf).
    const focusedLeafIdBefore = this.activeElementLeafId()

    const { forSolver, full } = this.collectLeafConstraints(document)
    const solved = solveLayout(document, forSolver, container.width, container.height, {
      isFaceRegistered: this.isFaceRegistered,
      isFaceGridEligible: this.isFaceGridEligible,
      dividerThickness: this.dividerThickness,
    })

    if (!solved.ok) {
      this.lastDiagnostics = solved.diagnostics
      return { ok: false, diagnostics: solved.diagnostics }
    }

    const visitedLeaves = new Set<string>()
    const visitedSplits = new Set<string>()
    const visitedGrids = new Set<string>()
    const visitedTabs = new Set<string>()
    await this.reconcileNode(document, solved.plan.root, full, visitedLeaves, visitedSplits, visitedGrids, visitedTabs, focusedLeafIdBefore)
    await this.pruneStale(visitedLeaves, visitedSplits)
    await this.pruneStaleGrids(visitedGrids)
    this.pruneStaleTabs(visitedTabs)
    if (this.pendingTabFocusNodeId) {
      const button = this.findTabButton(this.pendingTabFocusNodeId)
      this.pendingTabFocusNodeId = null
      button?.focus()
    }
    await this.handleFocusHandoff(focusedLeafIdBefore, document)

    this.lastValidPlan = solved.plan
    this.lastDiagnostics = solved.diagnostics
    this.lastDoc = document
    return { ok: true, diagnostics: solved.diagnostics }
  }

  async focus(leafId: string, reason: FocusReason = 'programmatic'): Promise<boolean> {
    const existing = this.mounted.get(leafId)
    if (!existing) return false
    return Boolean(await existing.view.focus({ reason }))
  }

  /**
   * F4 (repair round 3) — close/promote focus handoff: if the leaf that held
   * DOM focus before this `reconcile()` call is now GONE from the document,
   * move focus to its promoted sibling (the leaf/subtree that inherited the
   * collapsed split's slot — the exact node `close_leaf`'s own
   * `detachPromoteSibling` promotes, nucleus `operations.ts`). Never invoked
   * with a caller-supplied destination — the destination is always derived
   * here, from `this.lastDoc`'s OWN tree shape at the moment the closed leaf
   * still lived in it.
   *
   * Deliberately conservative: does nothing unless (a) a leaf really did
   * hold focus, (b) that leaf is genuinely absent from the NEW document
   * (closed, not merely resized/moved — LAY-007 never remounts on a
   * ratio/move alone, so a same leaf id surviving with a new position never
   * reaches here), (c) `this.lastDoc` still has structural knowledge of it,
   * (d) a promoted destination leaf can be found AND is actually mounted,
   * and (e) focus was not already claimed by something else in the
   * meantime (never steals focus a caller/face legitimately moved
   * elsewhere mid-reconcile).
   */
  private async handleFocusHandoff(focusedLeafIdBefore: string | null, newDoc: LayoutDocument): Promise<void> {
    if (!focusedLeafIdBefore) return
    if (newDoc.nodes[focusedLeafIdBefore]) return // still present — nothing closed, nothing to hand off
    const priorDoc = this.lastDoc
    if (!priorDoc || !priorDoc.nodes[focusedLeafIdBefore]) return // no structural history to compute a sibling from
    const destination = this.promotedSiblingLeafId(priorDoc, focusedLeafIdBefore)
    if (!destination || !this.mounted.has(destination)) return
    if (this.activeElementLeafId() !== null) return // something else already legitimately holds focus — never steal it
    await this.focus(destination, 'promoted')
  }

  /**
   * Which mounted leaf (if any) currently contains `document.activeElement`.
   * Works across shadow-DOM-hosting faces too: per spec, `document
   * .activeElement` reports the outermost custom-element HOST when focus is
   * inside a non-`delegatesFocus` open shadow tree (e.g. `<sh-editor-host>`'s
   * ProseMirror body) — that host is still a plain light-DOM descendant of
   * its leaf wrapper, so `wrapper.contains(...)` finds it correctly.
   */
  private activeElementLeafId(): string | null {
    const active = document.activeElement
    if (!active || active === document.body) return null
    for (const [leafId, wrapper] of this.leafWrappers) {
      if (wrapper.contains(active)) return leafId
    }
    return null
  }

  /**
   * Mirrors nucleus `operations.ts`'s `detachPromoteSibling` READ-ONLY: given
   * the document AS IT WAS while `closedLeafId` still lived in it, finds
   * `closedLeafId`'s parent split and returns the OTHER child's promoted
   * position — recursing into a split sibling via its `startNodeId` side
   * (the same deterministic "leftmost leaf" choice every topology reduces
   * to) until a leaf is reached. Returns `null` if `closedLeafId` had no
   * parent (it was the document root — LAY-010's replace-not-remove path,
   * which never actually removes the leaf id, so `handleFocusHandoff`'s own
   * presence check above already short-circuits before this is ever called
   * for that case) or the tree shape is otherwise unexpected.
   */
  private promotedSiblingLeafId(doc: LayoutDocument, closedLeafId: string): string | null {
    for (const node of Object.values(doc.nodes)) {
      if (node.kind !== 'split') continue
      let siblingId: string | null = null
      if (node.startNodeId === closedLeafId) siblingId = node.endNodeId
      else if (node.endNodeId === closedLeafId) siblingId = node.startNodeId
      if (siblingId === null) continue
      let current: LayoutNode | undefined = doc.nodes[siblingId]
      while (current && (current.kind === 'split' || current.kind === 'tabs')) {
        current = doc.nodes[current.kind === 'split' ? current.startNodeId : current.activeNodeId]
      }
      return current && current.kind === 'leaf' ? current.id : null
    }
    return null
  }

  diagnostics(): LayoutRuntimeDiagnostics {
    return {
      lastValid: this.lastValidPlan !== null,
      diagnostics: this.lastDiagnostics,
      mountedLeafIds: Array.from(this.mounted.keys()),
    }
  }

  /** The most recently solved plan, or `null` before the first successful `reconcile()`. */
  currentPlan(): LayoutPlan | null {
    return this.lastValidPlan
  }

  /** Introspection only — the live wrapper element for a leaf, stable across resize/move (LAY-007). */
  leafWrapperElement(leafId: string): HTMLElement | null {
    return this.leafWrappers.get(leafId) ?? null
  }

  /** Introspection only — the live wrapper element for a split node, stable across ratio changes. */
  splitWrapperElement(splitId: string): HTMLElement | null {
    return this.splitWrappers.get(splitId) ?? null
  }

  /** Introspection only — the live mounted `FaceView` for a leaf, or `null` if unmounted/errored. */
  mountedView(leafId: string): FaceView | null {
    return this.mounted.get(leafId)?.view ?? null
  }

  /** Introspection only — the live, root-parented OUTER wrapper element for a grid, stable across reflow/refresh. */
  gridWrapperElement(gridId: string): HTMLElement | null {
    return this.grids.get(gridId)?.outer ?? null
  }

  /** Introspection only — the live INTERIOR CSS-grid container a grid's cell wrappers mount inside. */
  gridInteriorElement(gridId: string): HTMLElement | null {
    return this.grids.get(gridId)?.interior ?? null
  }

  /** Introspection only — one grid cell's own wrapper element, keyed by its `GridCell.id` (fixed) or `?item` IRI (collection). */
  gridCellWrapperElement(gridId: string, cellId: string): HTMLElement | null {
    return this.grids.get(gridId)?.cellWrappers.get(cellId) ?? null
  }

  /** Introspection only — the live mounted `FaceView` for one grid cell, or `null` if unmounted/errored. */
  mountedGridCellView(gridId: string, cellId: string): FaceView | null {
    return this.grids.get(gridId)?.cellMounts.get(cellId)?.view ?? null
  }

  /** Introspection only — the "showing N of M" count-badge element for a grid (hidden unless truncated — see `updateGridCountBadge`). */
  gridCountBadgeElement(gridId: string): HTMLElement | null {
    return this.grids.get(gridId)?.badge ?? null
  }

  /**
   * Tears down every mounted leaf and clears the DOM. `this.disposed` is set
   * FIRST (so `reconcile()` rejects concurrent/re-entrant calls immediately),
   * but that does NOT mean cleanup stops at the first failure: every mounted
   * leaf gets an independent teardown attempt (each one releases its lease
   * and clears its own bookkeeping regardless of whether that leaf's
   * `dispose()` throws — see `teardownMountedLeaf`), and any errors are
   * aggregated and thrown together at the end, once every leaf has actually
   * been cleaned up. The previous version awaited each `dispose()` INSIDE
   * the loop with no try/catch, so one throwing view left every remaining
   * mounted leaf's lease unreleased AND unremovable on retry (`disposed` was
   * already `true`, so a second `dispose()` call short-circuited to a no-op)
   * — a real, if rare, leak (design §10: "Resource retention leak").
   */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const errors: unknown[] = []
    for (const existing of Array.from(this.mounted.values())) {
      errors.push(...(await this.teardownMountedLeaf(existing, 'shell-teardown')))
    }
    for (const state of Array.from(this.grids.values())) {
      errors.push(...(await this.teardownGrid(state)))
    }
    for (const wrapper of this.leafWrappers.values()) wrapper.remove()
    for (const wrapper of this.splitWrappers.values()) wrapper.remove()
    for (const wrapper of this.tabsWrappers.values()) wrapper.remove()
    for (const state of this.grids.values()) state.outer.remove()
    this.leafWrappers.clear()
    this.splitWrappers.clear()
    this.tabsWrappers.clear()
    this.grids.clear()
    this.lastValidPlan = null
    this.lastDoc = null
    if (errors.length > 0) {
      throw new AggregateError(errors, 'LayoutInterpreter.dispose: one or more FaceView.dispose() calls threw')
    }
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** Solver-scoped minima (`forSolver`) plus the full runtime `LeafConstraints` (`full`, keeps `overflow` for DOM styling). */
  private collectLeafConstraints(doc: LayoutDocument): {
    readonly forSolver: SolverLeafConstraintsMap
    readonly full: ReadonlyMap<string, LeafConstraints>
  } {
    const forSolver: Record<string, LeafSizeConstraints> = {}
    const full = new Map<string, LeafConstraints>()
    for (const node of Object.values(doc.nodes)) {
      if (node.kind !== 'leaf') continue
      const registration = this.registry.get(node.descriptor.faceId)
      const constraints = registration?.constraints?.(node.descriptor) ?? DEFAULT_LEAF_CONSTRAINTS
      full.set(node.id, constraints)
      forSolver[node.id] = {
        minWidth: constraints.minWidth,
        minHeight: constraints.minHeight,
        ...(constraints.preferredAspectRatio !== undefined
          ? { preferredAspectRatio: constraints.preferredAspectRatio }
          : {}),
        ...(constraints.maxWidth !== undefined ? { maxWidth: constraints.maxWidth } : {}),
        ...(constraints.maxHeight !== undefined ? { maxHeight: constraints.maxHeight } : {}),
      }
    }
    return { forSolver: Object.freeze(forSolver), full }
  }

  private async reconcileNode(
    doc: LayoutDocument,
    planNode: LayoutPlanNode,
    leafConstraints: ReadonlyMap<string, LeafConstraints>,
    visitedLeaves: Set<string>,
    visitedSplits: Set<string>,
    visitedGrids: Set<string>,
    visitedTabs: Set<string>,
    focusedLeafIdBefore: string | null,
  ): Promise<void> {
    switch (planNode.kind) {
      case 'split': {
      visitedSplits.add(planNode.id)
      // The split wrapper is a SIBLING of every other wrapper under `root`,
      // never a DOM ancestor of its children — see `ensureWrapper`'s doc
      // comment for why (design §9.2 Phase 1 diff-review: "the DOM is never
      // allowed to disagree with the solver, at any nesting depth").
      const wrapper = this.ensureWrapper(this.splitWrappers, planNode.id, 'split')
      this.positionWrapper(wrapper, planNode.allocation)
      this.setConstrainedAttribute(wrapper, planNode.constrained)
      // Start both branches before awaiting either. Every descendant stages
      // its wrapper/loading face synchronously up to its first resource await;
      // reactive stores then flow through the broker's bounded activation
      // queue. DOM order remains solver/document order because the function
      // calls themselves are evaluated left-to-right.
      await Promise.all([
        this.reconcileNode(doc, planNode.start, leafConstraints, visitedLeaves, visitedSplits, visitedGrids, visitedTabs, focusedLeafIdBefore),
        this.reconcileNode(doc, planNode.end, leafConstraints, visitedLeaves, visitedSplits, visitedGrids, visitedTabs, focusedLeafIdBefore),
      ])
      return
      }

      case 'grid': {
      visitedGrids.add(planNode.id)
      const docNode = doc.nodes[planNode.id]
      if (!docNode || docNode.kind !== 'grid') return // unreachable for a solver-produced plan of a valid document
      await this.reconcileGrid(planNode.id, docNode, planNode.allocation, planNode.constrained)
      return
      }

      case 'tabs': {
      visitedTabs.add(planNode.id)
      const docNode = doc.nodes[planNode.id]
      if (!docNode || docNode.kind !== 'tabs') return
      const priorTabs = this.lastDoc?.nodes[planNode.id]
      if (
        focusedLeafIdBefore &&
        priorTabs?.kind === 'tabs' &&
        priorTabs.activeNodeId !== docNode.activeNodeId &&
        this.isInSubtree(this.lastDoc, priorTabs.activeNodeId, focusedLeafIdBefore)
      ) {
        this.pendingTabFocusNodeId = docNode.activeNodeId
      }
      const strip = this.ensureTabsStrip(planNode.id)
      this.positionWrapper(strip, planNode.stripAllocation)
      this.renderTabStrip(strip, docNode, focusedLeafIdBefore)
      await this.reconcileNode(doc, planNode.active, leafConstraints, visitedLeaves, visitedSplits, visitedGrids, visitedTabs, focusedLeafIdBefore)
      return
      }

      case 'leaf': {
    visitedLeaves.add(planNode.id)
    const wrapper = this.ensureWrapper(this.leafWrappers, planNode.id, 'leaf')
    this.positionWrapper(wrapper, planNode.allocation)
    // design §6.2's own diagnosability requirement: "mark affected wrappers
    // data-layout-constrained and expose a diagnostic" — the solver already
    // computes `constrained` (LAYGEO_LEAF_CONSTRAINED / infeasibility's
    // emergency-floor branch, nucleus solver.ts's own `allocateAxis`); the
    // interpreter only needed to surface it onto the DOM, which it never did
    // (diff-review r2 MISSING: "minimum constraints ... not exercised").
    this.setConstrainedAttribute(wrapper, planNode.constrained)

    const docNode = doc.nodes[planNode.id]
    if (!docNode || docNode.kind !== 'leaf') return // unreachable for a solver-produced plan of a valid document

    const constraints = leafConstraints.get(planNode.id) ?? DEFAULT_LEAF_CONSTRAINTS
    wrapper.style.overflow = constraints.overflow === 'clip' ? 'hidden' : 'auto'

    const resourceScope = this.resourceScope()
    const existing = this.mounted.get(planNode.id)
    if (
      existing
      && existing.descriptorRevision === docNode.descriptorRevision
      && existing.resourceScope === resourceScope
    ) {
      // LAY-007 — same leaf id, descriptor revision, and host resource scope:
      // PRESERVE the view.
      existing.view.resize(planNode.allocation, constraints)
      return
    }

    if (existing) await this.teardownMountedLeaf(existing, 'replaced')
    await this.mountLeaf(
      planNode.id,
      wrapper,
      docNode.descriptor,
      docNode.descriptorRevision,
      resourceScope,
      planNode.allocation,
      constraints,
    )
        return
      }
      default: {
        const _never: never = planNode
        return _never
      }
    }
  }

  private isInSubtree(doc: LayoutDocument | null, rootId: string, targetId: string): boolean {
    if (!doc) return false
    const stack = [rootId]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const id = stack.pop() as string
      if (id === targetId) return true
      if (seen.has(id)) continue
      seen.add(id)
      const node = doc.nodes[id]
      if (!node) continue
      if (node.kind === 'split') stack.push(node.startNodeId, node.endNodeId)
      else if (node.kind === 'tabs') stack.push(...node.tabs.map((tab) => tab.nodeId))
    }
    return false
  }

  tabsStripElement(tabsId: string): HTMLElement | null {
    return this.tabsWrappers.get(tabsId) ?? null
  }

  private ensureTabsStrip(tabsId: string): HTMLElement {
    let strip = this.tabsWrappers.get(tabsId)
    if (!strip) {
      strip = document.createElement('div')
      strip.dataset.layoutNodeKind = 'tabs'
      strip.dataset.layoutNodeId = tabsId
      strip.setAttribute('role', 'tablist')
      strip.style.position = 'absolute'
      this.tabsWrappers.set(tabsId, strip)
    }
    if (strip.parentElement !== this.root) this.root.appendChild(strip)
    return strip
  }

  private findTabButton(nodeId: string): HTMLButtonElement | null {
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(nodeId) : nodeId.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
    return this.root.querySelector(`button[data-layout-tab-node-id="${escaped}"]`)
  }

  private renderTabStrip(strip: HTMLElement, node: Extract<LayoutNode, { kind: 'tabs' }>, focusedLeafIdBefore: string | null): void {
    const focused = document.activeElement?.closest?.('button[data-layout-tab-node-id]') as HTMLElement | null
    const focusedNodeId = focused?.dataset.layoutTabNodeId
    strip.replaceChildren()
    for (const tab of node.tabs) {
      const button = document.createElement('button')
      button.setAttribute('role', 'tab')
      button.dataset.layoutTabNodeId = tab.nodeId
      button.setAttribute('aria-selected', String(tab.nodeId === node.activeNodeId))
      button.tabIndex = tab.nodeId === node.activeNodeId ? 0 : -1
      button.textContent = tab.label
      button.addEventListener('click', () => this.onTabActivate?.({ tabsId: node.id, nodeId: tab.nodeId, source: 'pointer' }))
      button.addEventListener('keydown', (event) => {
        const current = node.tabs.findIndex((candidate) => candidate.nodeId === tab.nodeId)
        let nextIndex: number | null = null
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (current + 1) % node.tabs.length
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (current - 1 + node.tabs.length) % node.tabs.length
        else if (event.key === 'Home') nextIndex = 0
        else if (event.key === 'End') nextIndex = node.tabs.length - 1
        else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          this.onTabActivate?.({ tabsId: node.id, nodeId: tab.nodeId, source: 'keyboard' })
          return
        }
        if (nextIndex !== null) {
          event.preventDefault()
          const next = node.tabs[nextIndex]
          const nextButton = this.findTabButton(next.nodeId)
          if (nextButton) {
            strip.querySelectorAll<HTMLButtonElement>('button[role="tab"]').forEach((candidate) => {
              candidate.tabIndex = -1
            })
            nextButton.tabIndex = 0
            nextButton.focus()
          }
        }
      })
      strip.appendChild(button)
    }
    if (focusedNodeId) this.findTabButton(focusedNodeId)?.focus()
    else if (focusedLeafIdBefore && this.isInSubtree(this.lastDoc, node.activeNodeId, focusedLeafIdBefore)) this.findTabButton(node.activeNodeId)?.focus()
  }

  /**
   * Every wrapper (split OR leaf) is a DIRECT, PERMANENT child of `this.root`
   * — NEVER nested inside another wrapper. This is deliberate, not an
   * oversight (design §9.2 Phase 1 diff-review r2, "The DOM is never allowed
   * to disagree with the solver, at any nesting depth"):
   *
   *   1. Phase 1's solver (`solveLayout`/`buildPlanNode`) already computes
   *      every `allocation.x`/`allocation.y` as ROOT-ABSOLUTE pixels — each
   *      recursive call derives a child's box from its PARENT's `allocation`,
   *      which itself started from the root `{x:0,y:0,...}` (solver.ts's own
   *      `startAlloc`/`endAlloc`). Positioning a child wrapper as a CSS
   *      `position:absolute` descendant of its split's wrapper (itself
   *      absolutely positioned at a non-zero offset) would add the parent's
   *      offset a SECOND time — a leaf planned at root-relative x=501 nested
   *      two splits deep would render at 501+501=1002px. Appending every
   *      wrapper flat to `root` and using the solver's coordinates verbatim
   *      is the correct pairing for an already-root-absolute coordinate
   *      system; it is not merely simpler.
   *   2. It is ALSO what makes `move_node`/`swap_nodes` never destroy a live
   *      view (design §4.2): a leaf wrapper that persists across a
   *      structural operation keeps `root` as its parent forever — only its
   *      `left`/`top`/`width`/`height` change. It is never removed from one
   *      DOM parent and re-appended to another, so it never fires
   *      `disconnectedCallback` (which is exactly what tears down a live
   *      `EditorView` — editor-host.ts's `_teardownEditor`). A truly nested
   *      DOM structure would have to reparent an interior split's children
   *      whenever that split's ANCESTOR moved, even though the leaf's OWN
   *      geometry node did not change parents in the document tree.
   */
  private ensureWrapper(store: Map<string, HTMLElement>, nodeId: string, kind: 'split' | 'leaf'): HTMLElement {
    let el = store.get(nodeId)
    if (!el) {
      el = document.createElement('div')
      el.dataset.layoutNodeKind = kind
      el.dataset.layoutNodeId = nodeId
      el.style.position = 'absolute'
      // F2 fix (repair round 3): a SPLIT wrapper's box is the UNION of its
      // two children's allocations (`planNode.allocation` at a split node —
      // see `reconcileNode`'s split branch above), so it necessarily overlaps
      // every leaf wrapper beneath it in the tree. Every wrapper — split or
      // leaf — is a flat, absolutely-positioned DIRECT child of `root` (see
      // this method's own doc comment above), so DOM paint/hit-test order is
      // plain append order, not tree nesting. A split node minted by a
      // structural operation AFTER its leaves already exist (e.g. `split_leaf`
      // wrapping a pre-existing leaf in a brand-new split) is appended to
      // `root` AFTER that leaf's wrapper, and paints ON TOP of it. A split
      // wrapper carries no interactive content of its own — it exists purely
      // to report `data-layout-constrained` and geometry (callers like
      // layout-workbench-main.ts's `renderDividers()` read its
      // left/top/width/height to place divider chrome on a SEPARATE overlay
      // element) — so with the browser's default `pointer-events: auto` it
      // silently absorbed every click/focus meant for the leaf underneath,
      // even though it renders nothing visible. `pointer-events: none` makes
      // split wrappers structurally transparent to the pointer, so hit-testing
      // always falls through to whichever leaf wrapper is actually painted at
      // that point — leaves remain fully clickable/typeable regardless of
      // split-wrapper append order. Leaf wrappers are untouched (default
      // `auto`) since they host the real interactive FaceView content.
      if (kind === 'split') el.style.pointerEvents = 'none'
      store.set(nodeId, el)
    }
    if (el.parentElement !== this.root) this.root.appendChild(el)
    return el
  }

  /** `box` is already ROOT-ABSOLUTE (solver.ts) — applied verbatim since every wrapper is a direct child of `root` (see `ensureWrapper`). */
  private positionWrapper(el: HTMLElement, box: PixelBox): void {
    el.style.left = `${box.x}px`
    el.style.top = `${box.y}px`
    el.style.width = `${box.width}px`
    el.style.height = `${box.height}px`
  }

  /**
   * design §6.2: "mark affected wrappers `data-layout-constrained` and
   * expose a diagnostic". `constrained` is the solver's OWN verdict
   * (`LayoutPlanNode.constrained` — true when this leaf's allocation fell
   * below its declared minimum, or a split had to fall back to an emergency
   * floor because both sides' minima could not fit) — the interpreter never
   * recomputes it, only reflects it.
   */
  private setConstrainedAttribute(el: HTMLElement, constrained: boolean): void {
    if (constrained) el.setAttribute('data-layout-constrained', 'true')
    else el.removeAttribute('data-layout-constrained')
  }

  private async mountLeaf(
    leafId: string,
    wrapper: HTMLElement,
    descriptor: ViewDescriptor,
    descriptorRevision: number,
    resourceScope: string | number | null,
    box: PixelBox,
    constraints: LeafConstraints,
  ): Promise<void> {
    wrapper.replaceChildren()
    wrapper.removeAttribute(ERROR_REASON_ATTR)

    const verdict = this.registry.validate(descriptor)
    if (!verdict.ok) {
      this.renderErrorLeaf(wrapper, verdict.reason)
      return
    }

    let lease: ResourceLease
    try {
      // The registration NAMES its adapter (diff-review r2 WRONG: "the
      // broker silently selects the first adapter whose accepts() returns
      // true") — never left for the broker to guess via a locator-kind scan.
      lease = await this.broker.acquire(descriptor.resource, verdict.registration.resourceAdapterId)
    } catch {
      this.renderErrorLeaf(wrapper, 'resource-unavailable')
      return
    }

    // Ownership guard (design §10 "Resource retention leak"; diff-review
    // WRONG "closing a leaf releases it exactly once"): once `acquire()` has
    // handed us a lease, EVERY exit path from here on must either (a) end
    // with the lease recorded in `this.mounted` (so a later teardown will
    // release it), or (b) release it itself before returning. `mount()` or
    // the view's OWN initial `resize()` can throw with the lease already
    // live and nothing tracking it yet — that used to leak the lease
    // forever (no `this.mounted` entry ⇒ nothing to compare against for the
    // face's own contract, `pruneStale`, or `dispose()`'s teardown pass).
    let view: FaceView | undefined
    try {
      view = await verdict.registration.mount({ target: wrapper, descriptor, lease, constraints })
      view.resize(box, constraints)
    } catch {
      if (view) {
        try {
          await view.dispose('unmountable')
        } catch {
          // best-effort — the lease release below is what actually matters here
        }
      }
      lease.release()
      this.renderErrorLeaf(wrapper, 'mount-failed')
      return
    }
    this.mounted.set(leafId, { leafId, descriptorRevision, resourceScope, lease, view })
  }

  private renderErrorLeaf(wrapper: HTMLElement, reason: string): void {
    wrapper.replaceChildren()
    wrapper.setAttribute(ERROR_REASON_ATTR, reason)
    const el = document.createElement('div')
    el.dataset.layoutError = 'true'
    el.textContent = `layout: face unavailable (${reason})`
    wrapper.appendChild(el)
  }

  /**
   * Releases the lease and clears bookkeeping UNCONDITIONALLY, even when
   * `view.dispose()` throws (diff-review WRONG: "a throwing disposal leaks
   * the lease"). Bookkeeping is removed BEFORE the dispose attempt (not
   * after) so a leaf that fails to tear down cleanly is never left looking
   * "still mounted" to a caller retrying `reconcile()`. Returns EVERY caught
   * error (zero, one, or two — view dispose AND lease release are each
   * independently guarded) rather than throwing, so a batch caller
   * (`dispose()`/`pruneStale()`) can finish tearing down every OTHER leaf
   * before deciding what to do with the failure(s).
   *
   * `lease.release()` is wrapped in its OWN try/catch, not merely called from
   * a bare `finally` block (diff-review r2 WRONG: "lease release can still
   * throw synchronously ... such a throw aborts the outer disposal loop").
   * `LayoutResourceBroker.release()` itself is now non-throwing by
   * construction (`resource-broker.ts`'s `runDisposal`), but `ResourceBroker`
   * is a caller-supplied interface — this method does not assume every
   * implementation upholds that contract. A `finally` block with no
   * try/catch around a throwing statement REPLACES any pending `catch`-block
   * error with the `finally` block's own throw (per the language's own
   * completion-value rules), which is exactly how a release-time throw used
   * to silently swallow a real dispose-time error AND abort the caller's
   * loop after `this.mounted.delete` had already run.
   */
  private async teardownMountedLeaf(existing: MountedLeaf, reason: DisposeReason): Promise<readonly unknown[]> {
    this.mounted.delete(existing.leafId)
    const errors: unknown[] = []
    try {
      await existing.view.dispose(reason)
    } catch (caught) {
      errors.push(caught)
    }
    try {
      existing.lease.release()
    } catch (caught) {
      errors.push(caught)
    }
    return errors
  }

  private async pruneStale(visitedLeaves: ReadonlySet<string>, visitedSplits: ReadonlySet<string>): Promise<void> {
    const errors: unknown[] = []
    for (const [leafId, wrapper] of Array.from(this.leafWrappers.entries())) {
      if (visitedLeaves.has(leafId)) continue
      const existing = this.mounted.get(leafId)
      if (existing) {
        errors.push(...(await this.teardownMountedLeaf(existing, 'closed')))
      }
      wrapper.remove()
      this.leafWrappers.delete(leafId)
    }
    for (const [splitId, wrapper] of Array.from(this.splitWrappers.entries())) {
      if (visitedSplits.has(splitId)) continue
      wrapper.remove()
      this.splitWrappers.delete(splitId)
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'LayoutInterpreter.reconcile: one or more closed FaceView.dispose() calls threw')
    }
  }

  private pruneStaleTabs(visitedTabs: ReadonlySet<string>): void {
    for (const [tabsId, wrapper] of Array.from(this.tabsWrappers.entries())) {
      if (visitedTabs.has(tabsId)) continue
      wrapper.remove()
      this.tabsWrappers.delete(tabsId)
    }
  }

  // ── grid renderer (Wave 2 x Lane B spec
  // plans/surface-wave2-laneb-slice-20260716.md §3) ─────────────────────────

  /**
   * Reconcile one grid node: position its OUTER wrapper exactly like every
   * other wrapper (`positionWrapper`/`setConstrainedAttribute`, unchanged —
   * the grid is root-parented and root-absolute, spec §3's own "root-parented
   * positioned box"), refresh the interior CSS-grid flow styling, then
   * dispatch to the fixed- or collection-cell reconciler. The split solver
   * never sees past this point (nucleus solver.ts's opaque `'grid'` plan
   * node) — everything below is DOM-native.
   */
  private async reconcileGrid(
    gridId: string,
    node: LayoutGridNode,
    allocation: PixelBox,
    constrained: boolean,
  ): Promise<void> {
    const state = this.ensureGridState(gridId)
    this.positionWrapper(state.outer, allocation)
    this.setConstrainedAttribute(state.outer, constrained)
    state.interior.style.gridTemplateColumns =
      node.flow === 'stack' ? '1fr' : `repeat(auto-fill, minmax(${node.minCellWidth}px, 1fr))`

    if (node.children.kind === 'fixed') {
      // A grid that was collection-bound and just got `grid_set_cells`ed back
      // to a fixed source (both ops bump `gridRevision` — types.ts's own
      // "mirrors descriptorRevision" contract) — release any stale binding
      // (and any error markers it may have left behind) before reconciling
      // the (now authoritative) fixed cell list.
      this.teardownGridCollectionBinding(state)
      state.outer.removeAttribute(GRID_ERROR_REASON_ATTR)
      state.outer.removeAttribute(GRID_COLLECTION_TICK_ERROR_ATTR)
      await this.reconcileFixedGridCells(state, node.children.cells)
      return
    }
    await this.reconcileCollectionGrid(gridId, state, node.children)
  }

  /**
   * Create (once) or fetch the persistent per-grid DOM/bookkeeping bundle:
   * an OUTER root-parented positioned wrapper, an INTERIOR CSS-grid container
   * (the sanctioned nesting exception, spec §3), and a count-badge element —
   * plus a best-effort `ResizeObserver` on the interior (real browsers only;
   * `happy-dom`'s own `ResizeObserver` is an unimplemented stub, so the test
   * suite instead exercises reflow the SAME way `center-panes-host.test.ts`
   * does — re-`reconcile()`ing, which unconditionally re-measures every
   * still-mounted cell regardless of whether any observer ever fires; see
   * `reconcileFixedGridCells`/`runGridCollectionRefresh`'s own resize calls).
   */
  private ensureGridState(gridId: string): GridRuntimeState {
    let state = this.grids.get(gridId)
    if (state) {
      if (state.outer.parentElement !== this.root) this.root.appendChild(state.outer)
      return state
    }

    const outer = document.createElement('div')
    outer.dataset.layoutNodeKind = 'grid'
    outer.dataset.layoutNodeId = gridId
    outer.style.position = 'absolute'
    outer.style.overflowY = 'auto'
    outer.style.overflowX = 'hidden'

    const badge = document.createElement('div')
    badge.setAttribute(GRID_COUNT_BADGE_ATTR, 'true')
    badge.hidden = true

    const interior = document.createElement('div')
    interior.dataset.layoutGridInterior = 'true'
    interior.style.display = 'grid'
    interior.style.gap = `${GRID_CELL_GAP_PX}px`
    interior.style.alignContent = 'start'
    interior.style.gridAutoRows = `minmax(${GRID_ROW_MIN_HEIGHT_PX}px, auto)`

    outer.append(badge, interior)
    this.root.appendChild(outer)

    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => this.reflowGridCells(gridId))
      resizeObserver.observe(interior)
    }

    state = {
      outer,
      interior,
      badge,
      cellWrappers: new Map(),
      cellMounts: new Map(),
      resizeObserver,
      collection: null,
    }
    this.grids.set(gridId, state)
    return state
  }

  /**
   * Re-measure and `resize()` every currently mounted cell in a grid, WITHOUT
   * mounting/unmounting anything — the `ResizeObserver` callback's own job
   * (spec §3: "faces get real resize() calls on reflow"), also invoked
   * unconditionally at the tail of every ordinary reconcile of an
   * ALREADY-bound collection grid (`reconcileCollectionGrid`) so the
   * behavior is deterministically testable without a real observer firing.
   */
  private reflowGridCells(gridId: string): void {
    const state = this.grids.get(gridId)
    if (!state) return
    for (const [cellId, mount] of state.cellMounts) {
      const wrapper = state.cellWrappers.get(cellId)
      if (!wrapper) continue
      mount.view.resize(measureGridCellBox(wrapper), mount.constraints)
    }
  }

  /** Create (once) or fetch one cell's wrapper element, parented inside the grid's INTERIOR container, with the reflow column-span hint applied (fixed cells only — spec §2.1). */
  private ensureGridCellWrapper(state: GridRuntimeState, cellId: string, span: 1 | 2 | 3 | undefined): HTMLElement {
    let el = state.cellWrappers.get(cellId)
    if (!el) {
      el = document.createElement('div')
      el.setAttribute(GRID_CELL_ID_ATTR, cellId)
      state.cellWrappers.set(cellId, el)
    }
    el.style.gridColumn = span && span > 1 ? `span ${span}` : ''
    if (el.parentElement !== state.interior) state.interior.appendChild(el)
    return el
  }

  /**
   * Per-cell lifecycle — the EXACT `mountLeaf` discipline (spec §3:
   * "verbatim"): `registry.validate` → `broker.acquire` → `registration.mount`
   * → initial `resize()`, with error-leaf painting AND lease-leak guards on
   * every failure branch (mirrors `mountLeaf`'s own ownership-guard comment
   * line for line). Kept as an independent method rather than a literal call
   * into `mountLeaf` because a grid cell's `constraints` are not
   * pre-collected the way a leaf's are (`collectLeafConstraints` walks only
   * `doc.nodes`'s `leaf` entries — a fixed cell's descriptor lives inside a
   * `grid` node's own `children.cells`, and a collection cell's descriptor is
   * virtual/render-time-only, design §2.1 — neither is ever a
   * `LayoutDocument.nodes` entry `collectLeafConstraints` could see);
   * `constraints` is instead resolved fresh from the registration, exactly
   * once validation has already named it.
   */
  private async mountGridCell(
    wrapper: HTMLElement,
    descriptor: ViewDescriptor,
  ): Promise<MountedGridCell | null> {
    wrapper.replaceChildren()
    wrapper.removeAttribute(ERROR_REASON_ATTR)

    const verdict = this.registry.validate(descriptor)
    if (!verdict.ok) {
      this.renderErrorLeaf(wrapper, verdict.reason)
      return null
    }

    let lease: ResourceLease
    try {
      lease = await this.broker.acquire(descriptor.resource, verdict.registration.resourceAdapterId)
    } catch {
      this.renderErrorLeaf(wrapper, 'resource-unavailable')
      return null
    }

    const constraints = verdict.registration.constraints?.(descriptor) ?? DEFAULT_LEAF_CONSTRAINTS
    wrapper.style.overflow = constraints.overflow === 'clip' ? 'hidden' : 'auto'
    wrapper.style.minWidth = `${Math.max(1, constraints.minWidth)}px`
    wrapper.style.minHeight = `${Math.max(1, constraints.minHeight)}px`

    // Ownership guard (mirrors `mountLeaf`'s own — design §10 "Resource
    // retention leak"): every exit path from here on either ends with the
    // lease returned (so the caller records it and a later teardown will
    // release it) or releases it itself before returning.
    let view: FaceView | undefined
    try {
      view = await verdict.registration.mount({ target: wrapper, descriptor, lease, constraints })
      view.resize(measureGridCellBox(wrapper), constraints)
    } catch {
      if (view) {
        try {
          await view.dispose('unmountable')
        } catch {
          // best-effort — the lease release below is what actually matters here
        }
      }
      lease.release()
      this.renderErrorLeaf(wrapper, 'mount-failed')
      return null
    }
    return { lease, view, constraints, descriptorSignature: '' }
  }

  /** Mirrors `teardownMountedLeaf` verbatim, scoped to one grid cell's `{lease, view}` pair. */
  private async teardownGridCell(mount: MountedGridCell, reason: DisposeReason): Promise<readonly unknown[]> {
    const errors: unknown[] = []
    try {
      await mount.view.dispose(reason)
    } catch (caught) {
      errors.push(caught)
    }
    try {
      mount.lease.release()
    } catch (caught) {
      errors.push(caught)
    }
    return errors
  }

  /** Tear down every cell NOT in `keepIds` — mirrors `pruneStale`'s leaf pass, scoped to one grid. */
  private async pruneGridCells(state: GridRuntimeState, keepIds: ReadonlySet<string>): Promise<void> {
    const errors: unknown[] = []
    for (const [cellId, wrapper] of Array.from(state.cellWrappers.entries())) {
      if (keepIds.has(cellId)) continue
      const existing = state.cellMounts.get(cellId)
      if (existing) {
        state.cellMounts.delete(cellId)
        errors.push(...(await this.teardownGridCell(existing, 'closed')))
      }
      wrapper.remove()
      state.cellWrappers.delete(cellId)
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'LayoutInterpreter.reconcile: one or more closed grid-cell FaceView.dispose() calls threw')
    }
  }

  /**
   * Fixed-source reconciliation (spec §3): reconcile-by-id AND by content —
   * `grid_set_cells` is a WHOLE-array replace (operations.ts), so an
   * unchanged `GridCell.id` alone does not prove an unchanged descriptor the
   * way a leaf's `descriptorRevision` does; `JSON.stringify({resourceScope,
   * descriptor})` is the cheap, honest content signature (descriptors are closed/JSON-plain by
   * construction — nucleus validate.ts's own LAY-004 — so this is safe and
   * deterministic). A cell whose id AND signature both survive keeps its
   * mounted view (only `resize()` runs, LAY-007's own discipline one layer
   * up); anything else remounts. Always ends with `updateGridCountBadge`
   * (hidden — fixed sources have no `maxItems` truncation concept) and
   * `pruneGridCells` for any id that fell out of `cells` entirely.
   */
  private async reconcileFixedGridCells(state: GridRuntimeState, cells: readonly GridCell[]): Promise<void> {
    const seen = new Set<string>()
    const resourceScope = this.resourceScope()
    const activations = cells.map(async (cell) => {
      seen.add(cell.id)
      const signature = JSON.stringify({ resourceScope, descriptor: cell.descriptor })
      const wrapper = this.ensureGridCellWrapper(state, cell.id, cell.span)
      const existing = state.cellMounts.get(cell.id)
      if (existing && existing.descriptorSignature === signature) {
        existing.view.resize(measureGridCellBox(wrapper), existing.constraints)
        return
      }
      if (existing) {
        state.cellMounts.delete(cell.id)
        await this.teardownGridCell(existing, 'replaced')
      }
      const mounted = await this.mountGridCell(wrapper, cell.descriptor)
      if (mounted) {
        state.cellMounts.set(cell.id, { ...mounted, descriptorSignature: signature })
      }
    })
    await Promise.all(activations)
    await this.pruneGridCells(state, seen)
    this.updateGridCountBadge(state, cells.length, cells.length)
  }

  /** "showing N of M", surfaced never silently (spec §3's own "maxItems truncation ... never silent") — hidden whenever `shown === total`. */
  private updateGridCountBadge(state: GridRuntimeState, shown: number, total: number): void {
    const truncated = total > shown
    state.badge.hidden = !truncated
    state.badge.textContent = truncated ? `showing ${shown} of ${total}` : ''
  }

  /** Grid-level TOTAL failure (spec's binding could not be acquired at all) — paints an error INTO the (by this point already-emptied, via `pruneGridCells`) interior. Never called once any cell is genuinely mounted; see `runGridCollectionRefresh`'s own non-destructive tick-failure path for that case. */
  private renderGridError(state: GridRuntimeState, reason: string): void {
    state.interior.replaceChildren()
    state.outer.setAttribute(GRID_ERROR_REASON_ATTR, reason)
    state.badge.hidden = true
    const el = document.createElement('div')
    el.dataset.layoutError = 'true'
    el.textContent = `layout: grid unavailable (${reason})`
    state.interior.appendChild(el)
  }

  /** Releases the collection lease + clears the refresh interval, idempotently (a no-op when `state.collection` is already `null`) — mirrors `teardownMountedLeaf`'s "release unconditionally" discipline for the ONE lease a collection-bound grid itself holds (distinct from its cells' own leases). */
  private teardownGridCollectionBinding(state: GridRuntimeState): void {
    const collection = state.collection
    if (!collection) return
    if (collection.intervalHandle !== null) clearInterval(collection.intervalHandle)
    state.collection = null
    try {
      collection.lease.release()
    } catch {
      // best-effort, mirrors teardownMountedLeaf's own release guard — this
      // is the grid's OWN collection-query lease, never a cell's.
    }
  }

  /**
   * Collection-source reconciliation (spec §3): a change in the binding's OWN
   * content signature (`collectionBindingSignature` — `collection`/
   * `itemFaceId`/`itemParams`/`maxItems`/`refreshSeconds`; see
   * `GridCollectionRuntimeState.boundSignature`'s own doc comment for why
   * this is NOT `node.gridRevision`) is this binding's remount boundary —
   * exactly LAY-007's leaf rule, one layer up. On a genuine (re)bind: release
   * any prior lease, discard every previously mounted cell (the OLD query's
   * items — a rebind is a different query, not a refresh of the same one),
   * acquire a `GridCollectionQueryHandle` lease, paint any retained snapshot
   * immediately, and run the FIRST refresh AWAITED (so a caller's
   * `await reconcile()` still observes settled cells). Only when
   * `refreshSeconds` is a positive number does it
   * start this binding's OWN `setInterval` (spec: "refresh tick re-runs",
   * independent of the caller's OWN reconcile cadence, exactly like
   * `stat.scalar`/`chart.vega-lite`'s own poll-owning `mount()`). An
   * UNCHANGED binding between reconciles does nothing but re-measure
   * already-mounted cells (`reflowGridCells`) — the interval already owns
   * re-fetching. A `grid_set_flow`-only change (same binding, new `flow`/
   * `minCellWidth`) bumps `node.gridRevision` but leaves this signature
   * untouched, so it takes the SAME no-rebind path — `reconcileGrid`'s own
   * `state.interior.style.gridTemplateColumns` update already applied the
   * new flow before this method was ever called.
   */
  private async reconcileCollectionGrid(
    gridId: string,
    state: GridRuntimeState,
    children: Extract<GridChildrenSource, { kind: 'collection' }>,
  ): Promise<void> {
    const signature = collectionBindingSignature(children, this.resourceScope())
    const rebind = !state.collection || state.collection.boundSignature !== signature
    if (!rebind) {
      this.reflowGridCells(gridId)
      return
    }

    this.teardownGridCollectionBinding(state)
    await this.pruneGridCells(state, new Set())
    state.outer.removeAttribute(GRID_ERROR_REASON_ATTR)
    state.outer.removeAttribute(GRID_COLLECTION_TICK_ERROR_ATTR)

    if (!this.gridCollectionResourceAdapterId) {
      this.renderGridError(state, 'collection-adapter-unconfigured')
      return
    }

    let lease: ResourceLease
    try {
      lease = await this.broker.acquire(children.collection, this.gridCollectionResourceAdapterId)
    } catch {
      this.renderGridError(state, 'resource-unavailable')
      return
    }

    const collectionState: GridCollectionRuntimeState = {
      boundSignature: signature,
      lease,
      intervalHandle: null,
      refreshing: false,
    }
    state.collection = collectionState

    await this.runGridCollectionRefresh(gridId, state, children)

    const refreshSeconds = children.refreshSeconds
    if (typeof refreshSeconds === 'number' && refreshSeconds > 0) {
      collectionState.intervalHandle = setInterval(() => {
        void this.runGridCollectionRefresh(gridId, state, children)
      }, refreshSeconds * 1000)
    }
  }

  /**
   * One collection refresh tick (spec §3): begin refreshing the bound store,
   * reconcile its retained read immediately when present, then reconcile the
   * fresh settled read. Both paths map VALID rows (`collectionItemIri` — a
   * genuine, deduplicated `?item` URI) to
   * virtual cells keyed by their `?item` IRI (design §2.1's own identity
   * ladder extension), THEN apply `maxItems` — validation and dedup happen
   * BEFORE truncation, never after (grid-laneb review r1 WRONG finding (b):
   * slicing to `maxItems` first let invalid/duplicate rows waste truncation
   * slots that a later, genuinely-valid row could have filled). Reconciles
   * by id against the PREVIOUS tick's cells (an id that survives keeps its
   * mounted view — never remounted just because some OTHER row binding
   * changed), and refreshes the count badge against `result.totalRowCount`
   * — the query layer's own TRUE match count, never the (possibly
   * fetch-clamped) `rows.length` (review r1 WRONG finding (c): a 700-row
   * match clamped to 500 rows in transit previously rendered as "500 of
   * 500", never surfacing the real truncation). Re-entrancy-guarded
   * (`collection.refreshing`) — an overlapping tick (a slow query outliving
   * its own interval period) is skipped, not queued or aborted.
   *
   * Failure handling distinguishes two cases: the FIRST fetch of a fresh
   * binding fails with NO cells mounted yet — safe to paint the same
   * destructive `renderGridError` a total bind failure would; a LATER tick
   * fails with cells ALREADY mounted — those leases would leak if
   * `renderGridError`'s `interior.replaceChildren()` ran, so this case only
   * sets a non-destructive marker attribute and leaves every mounted cell
   * exactly as it was (mirrors `stat.scalar`/`chart.vega-lite`'s own
   * per-face "flip to error status, keep the view, keep polling" pattern).
   */
  private async runGridCollectionRefresh(
    gridId: string,
    state: GridRuntimeState,
    children: Extract<GridChildrenSource, { kind: 'collection' }>,
  ): Promise<void> {
    const collection = state.collection
    if (!collection || collection.refreshing) return
    collection.refreshing = true
    try {
      const handle = collection.lease.value as GridCollectionQueryHandle
      const retained = handle.get().read
      const refresh = handle.refresh()
      if (retained !== null) {
        await this.reconcileGridCollectionResult(gridId, state, collection, children, retained)
      }
      await refresh
      // This grid (or its binding) may have been torn down/rebound WHILE this
      // await was in flight — re-check identity before touching DOM/state.
      if (this.grids.get(gridId) !== state || state.collection !== collection) return

      const settled = handle.get()
      if (settled.status === 'error') {
        throw new Error(settled.error ?? 'collection query refresh failed')
      }
      if (settled.read === null) {
        throw new Error('collection query refresh produced no value')
      }
      if (settled.read !== retained) {
        await this.reconcileGridCollectionResult(gridId, state, collection, children, settled.read)
      }
    } catch {
      if (this.grids.get(gridId) !== state) return
      if (state.cellMounts.size === 0) {
        this.renderGridError(state, 'collection-query-failed')
      } else {
        state.outer.setAttribute(GRID_COLLECTION_TICK_ERROR_ATTR, 'collection-query-failed')
      }
    } finally {
      collection.refreshing = false
    }
  }

  /** Apply one retained-or-fresh collection snapshot without owning refresh cadence. */
  private async reconcileGridCollectionResult(
    gridId: string,
    state: GridRuntimeState,
    collection: GridCollectionRuntimeState,
    children: Extract<GridChildrenSource, { kind: 'collection' }>,
    result: GridCollectionQueryResult,
  ): Promise<void> {
    if (this.grids.get(gridId) !== state || state.collection !== collection) return
    state.outer.removeAttribute(GRID_COLLECTION_TICK_ERROR_ATTR)

    // Validate + dedupe identities BEFORE slicing to maxItems (see
    // `runGridCollectionRefresh`'s doc comment — WRONG finding (b)).
    const validRows: { readonly row: GridCollectionRow; readonly itemIri: string }[] = []
    const seenIdentities = new Set<string>()
    for (const row of result.rows) {
      const itemIri = collectionItemIri(row)
      if (itemIri === null) continue // no bound (or non-URI) ?item — skipped, not fatal (design §2.1's own "SELECT is expected to bind ?item" is a semantic contract this structural layer cannot itself enforce)
      if (seenIdentities.has(itemIri)) continue // collection identity = the ?item IRI (design §2.1) — a repeat row is the SAME item, not a second slot
      seenIdentities.add(itemIri)
      validRows.push({ row, itemIri })
    }
    const shown = validRows.slice(0, children.maxItems)

    const seen = new Set<string>()
    const activations = shown.map(async ({ row, itemIri }) => {
      seen.add(itemIri)
      const wrapper = this.ensureGridCellWrapper(state, itemIri, undefined)
      const existing = state.cellMounts.get(itemIri)
      if (existing) {
        // Reconcile-by-id (design §2.1): the SAME item IRI keeps its
        // mounted view across a refresh, even when its OTHER row bindings
        // changed — only a genuinely new/vanished item id mounts/unmounts.
        existing.view.resize(measureGridCellBox(wrapper), existing.constraints)
        return
      }
      const descriptor = buildGridCollectionCellDescriptor(children, row, itemIri)
      const mounted = await this.mountGridCell(wrapper, descriptor)
      if (!mounted) return
      // The mount's own acquire/mount awaits (inside `mountGridCell`) may
      // have outlived a rebind/dispose that superseded this exact binding
      // — recheck identity ONE MORE TIME before a stale mount can ever
      // enter live state (review r1 WRONG finding: "cannot leak or
      // resurrect stale cell mounts" — without this recheck, a mount
      // landing after `dispose()`/a rebind had already torn this grid down
      // would silently re-insert into an orphaned `state.cellMounts` Map,
      // leaking its lease forever since nothing will ever prune it again).
      if (this.grids.get(gridId) !== state || state.collection !== collection) {
        await this.teardownGridCell(mounted, 'closed')
        state.cellWrappers.delete(itemIri)
        wrapper.remove()
        return
      }
      state.cellMounts.set(itemIri, mounted)
    })
    await Promise.all(activations)
    if (this.grids.get(gridId) !== state || state.collection !== collection) return
    await this.pruneGridCells(state, seen)
    this.updateGridCountBadge(state, shown.length, result.totalRowCount)
  }

  /** Tear down every cell + the collection binding (if any) for one grid — the FULL teardown `dispose()`/`pruneStaleGrids` share. */
  private async teardownGrid(state: GridRuntimeState): Promise<readonly unknown[]> {
    const errors: unknown[] = []
    for (const [cellId, mount] of Array.from(state.cellMounts.entries())) {
      state.cellMounts.delete(cellId)
      errors.push(...(await this.teardownGridCell(mount, 'closed')))
    }
    this.teardownGridCollectionBinding(state)
    state.resizeObserver?.disconnect()
    return errors
  }

  /** Tear down every grid NOT in `visitedGrids` — mirrors `pruneStale`'s leaf/split pass, one node kind up. */
  private async pruneStaleGrids(visitedGrids: ReadonlySet<string>): Promise<void> {
    const errors: unknown[] = []
    for (const [gridId, state] of Array.from(this.grids.entries())) {
      if (visitedGrids.has(gridId)) continue
      errors.push(...(await this.teardownGrid(state)))
      state.outer.remove()
      this.grids.delete(gridId)
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'LayoutInterpreter.reconcile: one or more closed grid cells threw during teardown')
    }
  }
}
