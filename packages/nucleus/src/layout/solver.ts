/**
 * solver.ts — deterministic recursive sizing (design §6.1) and
 * directional-neighbor selection (§6.1, §8) over an already-VALID
 * `LayoutDocument`.
 *
 * The document stores axis + integer basis-point ratios ONLY; this module
 * turns that plus per-leaf minimum constraints and a container size into a
 * `LayoutPlan` of solved pixel rectangles. NO pixels are ever stored back
 * into the document — `solveLayout` takes a document and returns a plan; it
 * never returns a document.
 *
 * LAY-012: `solveLayout` validates first and NEVER recursively walks
 * unvalidated data — an invalid document yields `{ ok: false, diagnostics }`
 * and no plan is built. Design §9.2 Phase 1 diff-review r2 widened this: the
 * DOCUMENT wasn't the only untrusted input here — `containerWidth`/
 * `containerHeight`/`dividerThickness`, and every entry of the caller-supplied
 * `leafConstraints` map, are now also validated as finite, non-negative
 * numbers (and, for `leafConstraints`, own-property-looked-up and closed-
 * shaped) BEFORE any geometry is computed. A probe found that (a) a
 * constraint keyed by a prototype-colliding leaf id such as `'toString'`
 * against an EMPTY constraints object resolved to `Object.prototype.toString`
 * via a bare `leafConstraints[leafId]` lookup — truthy, so `c.minWidth` read
 * `undefined`, and `Math.max(0, undefined)` is `NaN`, silently marking a
 * split "constrained" with no diagnostic explaining why; and (b) a forged
 * `containerWidth`/`containerHeight`/constraint of `Infinity`/`NaN` produced
 * `ok: true` with `Infinity`/`NaN` pixel allocations. `leafMin` now does an
 * `Object.hasOwn`-guarded lookup, and `validateSolveInputs` rejects any
 * non-finite/negative container, divider, or constraint value up front with a
 * diagnostic instead of ever reaching `allocateAxis`'s arithmetic.
 *
 * LAY-011: given the same document, constraints map, container size, and
 * divider thickness, the returned `LayoutPlan` and `diagnostics` are
 * byte-stable — the tree walk here follows the document's own start/end
 * structure (never `Object.keys` iteration order), and `allocateAxis` is
 * pure integer arithmetic.
 *
 * Builder P1 hardening finding 3: `validateSolveInputs` proves each of
 * `containerWidth`/`containerHeight`/a constraint's `minWidth` etc.
 * INDIVIDUALLY finite, but a value DERIVED from two such finite inputs is not
 * automatically finite — `containerWidth: Number.MAX_VALUE`,
 * `containerHeight: Number.MIN_VALUE`, `preferredAspectRatio: 1` all pass
 * that per-input check yet divide out to an `actualAspectRatio` of
 * `Infinity`, which used to be embedded straight into an `ok:true`
 * `LAYGEO_LEAF_ASPECT_MISMATCH` diagnostic (serializing as `null`). Every
 * numeric value ever placed in a diagnostic or a plan is now finite, full
 * stop — `buildPlanNode`'s aspect-ratio branch checks the derived ratio, its
 * rounded form, and the relative-error arithmetic for finiteness and
 * rejects the solve as `LAYGEO_NON_FINITE_GEOMETRY` (the same code
 * `findNonFiniteMinSize`/`isFiniteAllocation` already use) rather than
 * returning a silently-broken number.
 *
 * Pure: no DOM, no stores, no network.
 */

import type { Axis, LayoutDocument, LayoutGridNode } from './types.js'
import type { Diagnostic } from './diagnostics.js'
import { makeDiagnostic, sortDiagnostics } from './diagnostics.js'
import type { FaceGridEligibilityPredicate, FaceRegistrationPredicate, ValidateOptions } from './validate.js'
import {
  defaultFaceGridEligibilityPredicate,
  defaultFaceRegistrationPredicate,
  isPlainObject,
  validateLayoutDocument,
} from './validate.js'

/**
 * Phase-1-scoped leaf sizing input. `minWidth`/`minHeight` are HARD —
 * `allocateAxis` actively solves for them (design §6.1's priority 2).
 * `preferredAspectRatio`/`maxWidth`/`maxHeight` are SOFT preferences (design
 * §6.1: "Preferred aspect ratio and maximum sizes are soft preferences. The
 * v1 solver preserves the document ratio where possible, then hard minima,
 * then soft aspect. It does not require a general linear-constraint engine.")
 * — the v1 solver does NOT rebalance geometry to satisfy them; it reports a
 * `LAYGEO_LEAF_EXCEEDS_MAX` / `LAYGEO_LEAF_ASPECT_MISMATCH` diagnostic when
 * the ratio+minima-driven allocation misses them (design §6.2: "silently
 * distorting or hiding it is not a solver").
 *
 * The full runtime `LeafConstraints` (adds `overflow` — design §3.2) is a P2
 * `FaceRegistration` concern; Phase 1 has no registry to source `overflow`
 * from, so it is not part of this Phase-1-scoped interface.
 */
export interface LeafSizeConstraints {
  readonly minWidth: number
  readonly minHeight: number
  /** Soft preference: desired width / height. Advisory only — see above. */
  readonly preferredAspectRatio?: number
  /** Soft preference: the solver never shrinks a SIBLING to enforce this. */
  readonly maxWidth?: number
  /** Soft preference: the solver never shrinks a SIBLING to enforce this. */
  readonly maxHeight?: number
}

const LEAF_SIZE_CONSTRAINT_KEYS = ['minWidth', 'minHeight', 'preferredAspectRatio', 'maxWidth', 'maxHeight'] as const

/**
 * Relative tolerance for the soft aspect-ratio preference: an allocation
 * whose width/height ratio is within this fraction of `preferredAspectRatio`
 * is NOT flagged. Pure constant, no effect on hard-minima solving.
 */
const ASPECT_RATIO_TOLERANCE = 0.02

/** Per-leaf constraints, keyed by leaf node id. A missing entry defaults to {0,0}. */
export type LeafConstraintsMap = Readonly<Record<string, LeafSizeConstraints>>

export interface ViewportAllocation {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type LayoutPlanNode =
  | {
      readonly kind: 'split'
      readonly id: string
      readonly axis: Axis
      readonly allocation: ViewportAllocation
      readonly dividerThickness: number
      /** True if this split or anything beneath it was allocated below its declared minimum. */
      readonly constrained: boolean
      readonly start: LayoutPlanNode
      readonly end: LayoutPlanNode
    }
  | {
      readonly kind: 'leaf'
      readonly id: string
      readonly allocation: ViewportAllocation
      /** True if this leaf's allocation is below its declared minWidth/minHeight. */
      readonly constrained: boolean
    }
  | {
      /**
       * A grid presents to the solver as ONE opaque allocation (design §2.3:
       * "grid = opaque box... NO interior solving") — the split solver never
       * descends into a grid's cells/collection; interior flow is DOM-native
       * CSS grid at render time (runtime concern, out of Phase 1's scope).
       */
      readonly kind: 'grid'
      readonly id: string
      readonly allocation: ViewportAllocation
      /** True if this grid's allocation is below its minCellWidth / floor-height minimum. */
      readonly constrained: boolean
    }
  | {
      readonly kind: 'tabs'
      readonly id: string
      readonly allocation: ViewportAllocation
      readonly stripAllocation: ViewportAllocation
      readonly constrained: boolean
      readonly active: LayoutPlanNode
    }

export interface LayoutPlan {
  readonly layoutId: string
  readonly rootNodeId: string
  readonly containerWidth: number
  readonly containerHeight: number
  readonly dividerThickness: number
  readonly root: LayoutPlanNode
}

export type SolveResult =
  | { readonly ok: true; readonly plan: LayoutPlan; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export interface SolveOptions extends ValidateOptions {
  readonly dividerThickness?: number
}

export const DEFAULT_DIVIDER_THICKNESS = 1
export const TABS_STRIP_HEIGHT = 32

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Validate the geometry INPUTS other than the document itself: container
 * dimensions, divider thickness, and every entry of `leafConstraints` (design
 * §9.2 Phase 1 diff-review r2 — see this file's header). Returns diagnostics;
 * an empty array means every input is safe to solve with.
 */
function validateSolveInputs(
  containerWidth: number,
  containerHeight: number,
  dividerThickness: number,
  leafConstraints: LeafConstraintsMap,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  if (!isFiniteNonNegative(containerWidth)) {
    diagnostics.push(
      makeDiagnostic('LAYGEO_INVALID_CONTAINER', undefined, {
        field: 'containerWidth',
      }),
    )
  }
  if (!isFiniteNonNegative(containerHeight)) {
    diagnostics.push(
      makeDiagnostic('LAYGEO_INVALID_CONTAINER', undefined, {
        field: 'containerHeight',
      }),
    )
  }
  if (!isFiniteNonNegative(dividerThickness)) {
    diagnostics.push(
      makeDiagnostic('LAYGEO_INVALID_CONTAINER', undefined, {
        field: 'dividerThickness',
      }),
    )
  }

  if (!isPlainObject(leafConstraints)) {
    diagnostics.push(makeDiagnostic('LAYGEO_INVALID_CONSTRAINTS'))
    return sortDiagnostics(diagnostics)
  }
  for (const leafId of Object.keys(leafConstraints)) {
    const entry: unknown = leafConstraints[leafId]
    if (!isPlainObject(entry) || !Object.keys(entry).every((key) => LEAF_SIZE_CONSTRAINT_KEYS.includes(key as never))) {
      diagnostics.push(makeDiagnostic('LAYGEO_INVALID_CONSTRAINTS', leafId, {
        field: 'shape',
      }))
      continue
    }
    if (!isFiniteNonNegative(entry.minWidth)) {
      diagnostics.push(makeDiagnostic('LAYGEO_INVALID_CONSTRAINTS', leafId, {
        field: 'minWidth',
      }))
    }
    if (!isFiniteNonNegative(entry.minHeight)) {
      diagnostics.push(makeDiagnostic('LAYGEO_INVALID_CONSTRAINTS', leafId, {
        field: 'minHeight',
      }))
    }
    if (entry.maxWidth !== undefined && !isFiniteNonNegative(entry.maxWidth)) {
      diagnostics.push(makeDiagnostic('LAYGEO_INVALID_CONSTRAINTS', leafId, {
        field: 'maxWidth',
      }))
    }
    if (entry.maxHeight !== undefined && !isFiniteNonNegative(entry.maxHeight)) {
      diagnostics.push(makeDiagnostic('LAYGEO_INVALID_CONSTRAINTS', leafId, {
        field: 'maxHeight',
      }))
    }
    if (entry.preferredAspectRatio !== undefined && !isFinitePositive(entry.preferredAspectRatio)) {
      diagnostics.push(makeDiagnostic('LAYGEO_INVALID_CONSTRAINTS', leafId, {
        field: 'preferredAspectRatio',
      }))
    }
  }
  return sortDiagnostics(diagnostics)
}

interface MinSize {
  readonly minWidth: number
  readonly minHeight: number
}

/**
 * True iff EVERY component of `allocation` is a finite number (Builder P1
 * hardening finding 4 — see `buildPlanNode`/`solveLayout`'s overflow guards
 * below).
 */
function isFiniteAllocation(allocation: ViewportAllocation): boolean {
  return (
    Number.isFinite(allocation.x) &&
    Number.isFinite(allocation.y) &&
    Number.isFinite(allocation.width) &&
    Number.isFinite(allocation.height)
  )
}

/** `Object.hasOwn`-guarded constraint lookup — see this file's header. */
function getOwnConstraints(leafConstraints: LeafConstraintsMap, leafId: string): LeafSizeConstraints | undefined {
  return Object.hasOwn(leafConstraints, leafId) ? leafConstraints[leafId] : undefined
}

function leafMin(leafConstraints: LeafConstraintsMap, leafId: string): MinSize {
  const c = getOwnConstraints(leafConstraints, leafId)
  return { minWidth: c ? Math.max(0, c.minWidth) : 0, minHeight: c ? Math.max(0, c.minHeight) : 0 }
}

/**
 * Fixed minimum height floor for an opaque grid box (design §2.3: "min-
 * constraints from minCellWidth + floor height"). The solver never counts a
 * collection's rows or measures fixed-cell content ("NO interior solving"),
 * so it cannot derive a real minimum height the way `computeMinSizes`
 * derives one for a `split` from its children's ACTUAL constraints. This is
 * a single, deliberately generous constant — enough for one row of a
 * stat-card-sized cell so a freshly-inserted, empty/loading grid never
 * collapses to zero height before real content arrives — not a measured or
 * configurable value; DOM-native CSS grid measures its own real content
 * height at render time (a runtime/interpreter concern, out of Phase 1's
 * scope).
 */
const GRID_FLOOR_HEIGHT = 120

/**
 * A grid's minimum size comes ENTIRELY from its own stored `minCellWidth`
 * field plus `GRID_FLOOR_HEIGHT` — never from the caller-supplied
 * `leafConstraints` map (that map is scoped to real per-leaf FACE content, a
 * Phase-2 concept Phase 1 has no registry to source real minima from; a grid
 * intrinsically declares its own minimum via its own field, design §2.3).
 */
function gridMinSize(node: LayoutGridNode): MinSize {
  return { minWidth: Math.max(0, node.minCellWidth), minHeight: GRID_FLOOR_HEIGHT }
}

/**
 * Bottom-up minimum-size propagation (design §6.1). A single call from the
 * root visits every node on the active path (LAY-001 guarantees a tree, not a
 * DAG). Inactive tab subtrees remain document-reachable but are not planned.
 */
function computeMinSizes(
  doc: LayoutDocument,
  leafConstraints: LeafConstraintsMap,
  dividerThickness: number,
  nodeId: string,
  out: Map<string, MinSize>,
): MinSize {
  const node = doc.nodes[nodeId]
  let result: MinSize
  if (node.kind === 'leaf') {
    result = leafMin(leafConstraints, nodeId)
  } else if (node.kind === 'grid') {
    result = gridMinSize(node)
  } else if (node.kind === 'tabs') {
    const activeMin = computeMinSizes(doc, leafConstraints, dividerThickness, node.activeNodeId, out)
    result = { minWidth: activeMin.minWidth, minHeight: activeMin.minHeight + TABS_STRIP_HEIGHT }
  } else {
    const start = computeMinSizes(doc, leafConstraints, dividerThickness, node.startNodeId, out)
    const end = computeMinSizes(doc, leafConstraints, dividerThickness, node.endNodeId, out)
    result =
      node.axis === 'horizontal'
        ? {
            minWidth: start.minWidth + dividerThickness + end.minWidth,
            minHeight: Math.max(start.minHeight, end.minHeight),
          }
        : {
            minWidth: Math.max(start.minWidth, end.minWidth),
            minHeight: start.minHeight + dividerThickness + end.minHeight,
          }
  }
  out.set(nodeId, result)
  return result
}

/**
 * The id of the FIRST node (in Map insertion/traversal order — irrelevant
 * here since the caller only checks "is there one at all", never returns the
 * set as user-facing without going through `sortDiagnostics`) whose computed
 * minimum size overflowed to a non-finite value, or `null` if every entry is
 * finite (Builder P1 hardening finding 4: "finite `Number.MAX_VALUE` minima
 * overflow to NaN widths/coords with `ok:true`" — a `minWidth`/`minHeight`
 * constraint is only required to be finite and non-negative
 * (`validateSolveInputs`), not bounded in MAGNITUDE, so summing two such
 * constraints across a split in `computeMinSizes` — or, transitively, across
 * several nested splits — can overflow past `Number.MAX_VALUE` to
 * `Infinity`, and dividing `Infinity` by `Infinity` in `allocateAxis`'s
 * infeasibility branch below then yields `NaN`. Scanning the FULL `minSizes`
 * map right after it is built catches this BEFORE any allocation work
 * happens, at every split in the tree, not just the one that first
 * overflowed — see `solveLayout`).
 */
function findNonFiniteMinSize(minSizes: ReadonlyMap<string, MinSize>): string | null {
  for (const [nodeId, size] of minSizes) {
    if (!Number.isFinite(size.minWidth) || !Number.isFinite(size.minHeight)) return nodeId
  }
  return null
}

/**
 * Allocate one axis of one split (design §6.1). When `available` cannot fit
 * both sides' minima, this is the §6.2 infeasibility path: allocate a
 * deterministic emergency floor (proportional to each side's min share, or an
 * even split if both minima are zero) rather than violating either side's
 * true minimum silently — the caller marks the result `constrained`. Callers
 * only ever pass `startMin`/`endMin` that already came from the (pre-checked
 * finite, see `findNonFiniteMinSize`) `minSizes` map, so an overflow inside
 * THIS function's own arithmetic (`available * startBasisPoints`, or
 * `startMin + endMin`) is not expected in practice — `buildPlanNode` below
 * still asserts every returned `start`/`end` is finite before using it, as
 * defense in depth (Builder P1 hardening finding 4).
 */
function allocateAxis(
  available: number,
  startMin: number,
  endMin: number,
  startBasisPoints: number,
): { readonly start: number; readonly end: number; readonly constrained: boolean } {
  const wanted = Math.round((available * startBasisPoints) / 10000)
  const low = startMin
  const high = available - endMin
  if (low <= high) {
    const start = Math.min(high, Math.max(low, wanted))
    return { start, end: available - start, constrained: false }
  }
  const totalMin = startMin + endMin
  const start = totalMin > 0 ? Math.round((available * startMin) / totalMin) : Math.round(available / 2)
  return { start, end: available - start, constrained: true }
}

/**
 * Build one `LayoutPlanNode` (recursively). Returns `null` — never a
 * plan containing a NaN/Infinity number — if `allocation`, or either child's
 * computed sub-allocation, overflowed to a non-finite value (Builder P1
 * hardening finding 4); `solveLayout` treats a `null` result as infeasible
 * and returns `ok:false` rather than a plan with silently broken geometry.
 */
function buildPlanNode(
  doc: LayoutDocument,
  minSizes: Map<string, MinSize>,
  leafConstraints: LeafConstraintsMap,
  dividerThickness: number,
  nodeId: string,
  allocation: ViewportAllocation,
  diagnostics: Diagnostic[],
): LayoutPlanNode | null {
  const node = doc.nodes[nodeId]

  if (!isFiniteAllocation(allocation)) {
    diagnostics.push(makeDiagnostic('LAYGEO_NON_FINITE_GEOMETRY', nodeId, { field: 'allocation' }))
    return null
  }

  if (node.kind === 'leaf') {
    const min = leafMin(leafConstraints, nodeId)
    const constrained = allocation.width < min.minWidth || allocation.height < min.minHeight
    if (constrained) {
      diagnostics.push(
        makeDiagnostic('LAYGEO_LEAF_CONSTRAINED', nodeId, {
          minWidth: min.minWidth,
          minHeight: min.minHeight,
          allocatedWidth: allocation.width,
          allocatedHeight: allocation.height,
        }),
      )
    }

    // Soft preferences (design §6.1/§6.2) — advisory only, never rebalanced.
    const soft = getOwnConstraints(leafConstraints, nodeId)
    if (soft?.maxWidth !== undefined && allocation.width > soft.maxWidth) {
      diagnostics.push(
        makeDiagnostic('LAYGEO_LEAF_EXCEEDS_MAX', nodeId, {
          axis: 'width',
          maxWidth: soft.maxWidth,
          allocatedWidth: allocation.width,
        }),
      )
    }
    if (soft?.maxHeight !== undefined && allocation.height > soft.maxHeight) {
      diagnostics.push(
        makeDiagnostic('LAYGEO_LEAF_EXCEEDS_MAX', nodeId, {
          axis: 'height',
          maxHeight: soft.maxHeight,
          allocatedHeight: allocation.height,
        }),
      )
    }
    if (soft?.preferredAspectRatio !== undefined && soft.preferredAspectRatio > 0 && allocation.height > 0) {
      const actualAspectRatio = allocation.width / allocation.height
      const roundedAspectRatio = Math.round(actualAspectRatio * 10000) / 10000
      const relativeError = Math.abs(actualAspectRatio - soft.preferredAspectRatio) / soft.preferredAspectRatio
      // Builder P1 hardening finding 3: `allocation.width`/`allocation.height`
      // are each individually finite (guarded by `isFiniteAllocation` above),
      // but their RATIO — and the relative-error arithmetic derived from it —
      // is not bounded by that guard. Extreme-but-finite container dimensions
      // (e.g. `containerWidth: Number.MAX_VALUE`, `containerHeight:
      // Number.MIN_VALUE`) can still overflow `actualAspectRatio` to
      // `Infinity`, which would otherwise serialize as `null` inside a
      // "successful" `LAYGEO_LEAF_ASPECT_MISMATCH` diagnostic — a numeric
      // solver result that is silently not a number. Every derived value is
      // checked for finiteness here; a non-finite result is treated the same
      // as every OTHER geometry overflow in this module (`findNonFiniteMinSize`,
      // `isFiniteAllocation`): rejected as infeasible via `LAYGEO_NON_FINITE_GEOMETRY`
      // rather than ever returned inside an `ok:true` plan.
      if (!Number.isFinite(actualAspectRatio) || !Number.isFinite(relativeError) || !Number.isFinite(roundedAspectRatio)) {
        diagnostics.push(makeDiagnostic('LAYGEO_NON_FINITE_GEOMETRY', nodeId, { field: 'aspectRatio' }))
        return null
      }
      if (relativeError > ASPECT_RATIO_TOLERANCE) {
        diagnostics.push(
          makeDiagnostic('LAYGEO_LEAF_ASPECT_MISMATCH', nodeId, {
            preferredAspectRatio: soft.preferredAspectRatio,
            actualAspectRatio: roundedAspectRatio,
          }),
        )
      }
    }

    return { kind: 'leaf', id: nodeId, allocation, constrained }
  }

  if (node.kind === 'grid') {
    // Opaque box (design §2.3: "NO interior solving") — no soft-preference
    // machinery either (maxWidth/maxHeight/preferredAspectRatio are sourced
    // from `leafConstraints`, a real-per-leaf-face concept a grid's own
    // intrinsic minimum does not participate in; see `gridMinSize`).
    const min = gridMinSize(node)
    const constrained = allocation.width < min.minWidth || allocation.height < min.minHeight
    if (constrained) {
      diagnostics.push(
        makeDiagnostic('LAYGEO_GRID_CONSTRAINED', nodeId, {
          minWidth: min.minWidth,
          minHeight: min.minHeight,
          allocatedWidth: allocation.width,
          allocatedHeight: allocation.height,
        }),
      )
    }
    return { kind: 'grid', id: nodeId, allocation, constrained }
  }

  if (node.kind === 'tabs') {
    const activeMin = minSizes.get(node.activeNodeId) as MinSize
    const stripHeight = Math.min(TABS_STRIP_HEIGHT, allocation.height)
    const stripAllocation: ViewportAllocation = {
      x: allocation.x,
      y: allocation.y,
      width: allocation.width,
      height: stripHeight,
    }
    const activeAllocation: ViewportAllocation = {
      x: allocation.x,
      y: allocation.y + stripHeight,
      width: allocation.width,
      height: allocation.height - stripHeight,
    }
    const constrained = allocation.width < activeMin.minWidth || allocation.height < activeMin.minHeight + TABS_STRIP_HEIGHT
    if (constrained) {
      diagnostics.push(
        makeDiagnostic('LAYGEO_TABS_CONSTRAINED', nodeId, {
          minWidth: activeMin.minWidth,
          minHeight: activeMin.minHeight + TABS_STRIP_HEIGHT,
          allocatedWidth: allocation.width,
          allocatedHeight: allocation.height,
        }),
      )
    }
    const active = buildPlanNode(doc, minSizes, leafConstraints, dividerThickness, node.activeNodeId, activeAllocation, diagnostics)
    if (active === null) return null
    return { kind: 'tabs', id: nodeId, allocation, stripAllocation, constrained: constrained || active.constrained, active }
  }

  const startMin = minSizes.get(node.startNodeId) as MinSize
  const endMin = minSizes.get(node.endNodeId) as MinSize

  let startAlloc: ViewportAllocation
  let endAlloc: ViewportAllocation
  let splitConstrained: boolean

  if (node.axis === 'horizontal') {
    const available = Math.max(0, allocation.width - dividerThickness)
    const { start, end, constrained } = allocateAxis(
      available,
      startMin.minWidth,
      endMin.minWidth,
      node.startBasisPoints,
    )
    startAlloc = { x: allocation.x, y: allocation.y, width: start, height: allocation.height }
    endAlloc = {
      x: allocation.x + start + dividerThickness,
      y: allocation.y,
      width: end,
      height: allocation.height,
    }
    splitConstrained = constrained
  } else {
    const available = Math.max(0, allocation.height - dividerThickness)
    const { start, end, constrained } = allocateAxis(
      available,
      startMin.minHeight,
      endMin.minHeight,
      node.startBasisPoints,
    )
    startAlloc = { x: allocation.x, y: allocation.y, width: allocation.width, height: start }
    endAlloc = {
      x: allocation.x,
      y: allocation.y + start + dividerThickness,
      width: allocation.width,
      height: end,
    }
    splitConstrained = constrained
  }

  const startNode = buildPlanNode(
    doc,
    minSizes,
    leafConstraints,
    dividerThickness,
    node.startNodeId,
    startAlloc,
    diagnostics,
  )
  const endNode = buildPlanNode(
    doc,
    minSizes,
    leafConstraints,
    dividerThickness,
    node.endNodeId,
    endAlloc,
    diagnostics,
  )
  // A child already flagged (and diagnosed) its own non-finite allocation —
  // propagate the rejection rather than building a split around a `null`.
  if (startNode === null || endNode === null) return null

  return {
    kind: 'split',
    id: nodeId,
    axis: node.axis,
    allocation,
    dividerThickness,
    constrained: splitConstrained || startNode.constrained || endNode.constrained,
    start: startNode,
    end: endNode,
  }
}

/**
 * Solve pixel geometry for a validated `LayoutDocument` against a container
 * size and per-leaf constraints. Returns `{ ok: false, diagnostics }` without
 * building anything if the document itself is invalid (LAY-012), OR if the
 * container/divider/constraints inputs are not finite, non-negative numbers
 * (design §9.2 Phase 1 diff-review r2 — see this file's header), OR if
 * computing minimum sizes / allocating geometry overflows to a non-finite
 * value anywhere in the tree (Builder P1 hardening finding 4 — see
 * `findNonFiniteMinSize`/`buildPlanNode`'s doc comments: a `minWidth`/
 * `minHeight` constraint of e.g. `Number.MAX_VALUE` is individually finite
 * and passes `validateSolveInputs`, but SUMMING two such constraints across
 * a split can overflow past `Number.MAX_VALUE` to `Infinity`, and dividing
 * `Infinity` by `Infinity` in `allocateAxis`'s infeasibility branch then
 * yields `NaN` — this used to return `ok:true` with `NaN`/`Infinity`
 * pixel allocations; it is now rejected as infeasible, never silently
 * returned).
 */
export function solveLayout(
  doc: LayoutDocument,
  leafConstraints: LeafConstraintsMap,
  containerWidth: number,
  containerHeight: number,
  options?: SolveOptions,
): SolveResult {
  const isFaceRegistered: FaceRegistrationPredicate =
    options?.isFaceRegistered ?? defaultFaceRegistrationPredicate
  const isFaceGridEligible: FaceGridEligibilityPredicate =
    options?.isFaceGridEligible ?? defaultFaceGridEligibilityPredicate
  const verdict = validateLayoutDocument(doc, { isFaceRegistered, isFaceGridEligible })
  if (!verdict.ok) {
    return { ok: false, diagnostics: verdict.diagnostics }
  }

  const dividerThickness = options?.dividerThickness ?? DEFAULT_DIVIDER_THICKNESS
  const inputDiagnostics = validateSolveInputs(containerWidth, containerHeight, dividerThickness, leafConstraints)
  if (inputDiagnostics.length > 0) {
    return { ok: false, diagnostics: inputDiagnostics }
  }

  const minSizes = new Map<string, MinSize>()
  computeMinSizes(doc, leafConstraints, dividerThickness, doc.rootNodeId, minSizes)

  const overflowedNodeId = findNonFiniteMinSize(minSizes)
  if (overflowedNodeId !== null) {
    return {
      ok: false,
      diagnostics: sortDiagnostics([
        makeDiagnostic('LAYGEO_NON_FINITE_GEOMETRY', overflowedNodeId, { field: 'minSize' }),
      ]),
    }
  }

  const rootAllocation: ViewportAllocation = {
    x: 0,
    y: 0,
    width: Math.max(0, containerWidth),
    height: Math.max(0, containerHeight),
  }
  const diagnostics: Diagnostic[] = []
  const root = buildPlanNode(
    doc,
    minSizes,
    leafConstraints,
    dividerThickness,
    doc.rootNodeId,
    rootAllocation,
    diagnostics,
  )
  if (root === null) {
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) }
  }

  const plan: LayoutPlan = {
    layoutId: doc.layoutId,
    rootNodeId: doc.rootNodeId,
    containerWidth: rootAllocation.width,
    containerHeight: rootAllocation.height,
    dividerThickness,
    root,
  }
  return { ok: true, plan, diagnostics: sortDiagnostics(diagnostics) }
}

// ── directional-neighbor selection (design §6.1, §8) ────────────────────────

export type Direction = 'left' | 'right' | 'up' | 'down'

/**
 * Flatten every FOCUSABLE plan node — `'leaf'` and `'grid'` alike, both
 * terminal/opaque from the solver's point of view — into one id -> rect map;
 * only `'split'` recurses. A grid occupies one rectangle exactly like a leaf
 * (design §2.3's opaque-box treatment), so it participates in directional
 * navigation the same way.
 */
function flattenLeaves(node: LayoutPlanNode, out: Map<string, ViewportAllocation>): void {
  if (node.kind === 'split') {
    flattenLeaves(node.start, out)
    flattenLeaves(node.end, out)
  } else if (node.kind === 'tabs') {
    flattenLeaves(node.active, out)
  } else {
    out.set(node.id, node.allocation)
  }
}

/**
 * Directional focus navigation over SOLVED rectangles, not tree order (design
 * §8): among leaves in the requested half-plane relative to `fromLeafId`,
 * choose greatest orthogonal overlap, then shortest edge distance, then
 * stable leaf ID. Returns `null` when `fromLeafId` is unknown or no leaf lies
 * in that half-plane.
 */
export function findDirectionalNeighbor(
  plan: LayoutPlan,
  fromLeafId: string,
  direction: Direction,
): string | null {
  const leaves = new Map<string, ViewportAllocation>()
  flattenLeaves(plan.root, leaves)
  const from = leaves.get(fromLeafId)
  if (!from) return null

  type Candidate = { readonly id: string; readonly overlap: number; readonly distance: number }
  const candidates: Candidate[] = []

  for (const [id, rect] of leaves) {
    if (id === fromLeafId) continue
    let inHalfPlane: boolean
    let distance: number
    let overlap: number
    switch (direction) {
      case 'right':
        inHalfPlane = rect.x >= from.x + from.width
        distance = rect.x - (from.x + from.width)
        overlap = Math.max(0, Math.min(from.y + from.height, rect.y + rect.height) - Math.max(from.y, rect.y))
        break
      case 'left':
        inHalfPlane = rect.x + rect.width <= from.x
        distance = from.x - (rect.x + rect.width)
        overlap = Math.max(0, Math.min(from.y + from.height, rect.y + rect.height) - Math.max(from.y, rect.y))
        break
      case 'down':
        inHalfPlane = rect.y >= from.y + from.height
        distance = rect.y - (from.y + from.height)
        overlap = Math.max(0, Math.min(from.x + from.width, rect.x + rect.width) - Math.max(from.x, rect.x))
        break
      case 'up':
        inHalfPlane = rect.y + rect.height <= from.y
        distance = from.y - (rect.y + rect.height)
        overlap = Math.max(0, Math.min(from.x + from.width, rect.x + rect.width) - Math.max(from.x, rect.x))
        break
    }
    if (!inHalfPlane) continue
    candidates.push({ id, overlap, distance })
  }

  if (candidates.length === 0) return null

  candidates.sort((a, b) => {
    if (a.overlap !== b.overlap) return b.overlap - a.overlap
    if (a.distance !== b.distance) return a.distance - b.distance
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return candidates[0].id
}
