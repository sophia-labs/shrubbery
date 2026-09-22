/**
 * split-tree-renderer.ts — the shared two-pane split GEOMETRY primitive for
 * `sh-center-panes` (design plans/shrubbery-layout-as-data-design-20260716.md
 * §6.3, §9.2 Phase 3's "Likely files" list; diff-review r2 WRONG "render
 * organism center via the layout vehicle" / "flat-grid-remains").
 *
 * `sh-center-panes`' own internal primary/secondary geometry used to be a
 * hand-written CSS `calc()` formula (design §1.2's "flat-grid failure mode" —
 * the exact bug class the design names as evidence the center needed a real
 * recursive geometry authority, not merely a fixed CSS regression fix). This
 * module gives it one: a PURE function that builds a genuinely valid,
 * one-or-two-leaf Phase-1 `LayoutDocument` from just an axis-free ratio + leaf
 * ids, and solves it through the REAL `solveLayout`
 * (`@shrubbery/nucleus/layout`) — never a parallel arithmetic formula. Leaf
 * CONTENT is irrelevant to geometry, so both leaves carry the real, valid,
 * Phase-1-exported `sophia.home` descriptor (`createSophiaHomeDescriptor`);
 * this throwaway document is solved for its SHAPE only and is never rendered,
 * stored, persisted, or shown to any face registry — `center-panes-host.ts`
 * reads only the returned pixel allocations.
 *
 * Deliberately narrower than design §6.3's `renderSplitTree(plan,
 * leafAnchorFor)`, which additionally emits the shared `<sl-split-panel>` DOM
 * wrapper `render-workspace.ts`'s `renderSpine` uses for the workspace spine.
 * `sh-center-panes` cannot adopt that DOM shape without regressing its own
 * load-bearing property (design §4.2: "a real-browser identity test is a
 * release gate"): `<sl-split-panel>` exists in the DOM only while `split` is
 * true, so wrapping the primary pane in a conditionally-present
 * `<sl-split-panel>` would give it a NEW DOM PARENT every time a second pane
 * opens/closes — disconnecting and reconnecting the live `sh-editor-host`/
 * `EditorView` inside it, exactly the failure mode `layout-interpreter.ts`'s
 * own `ensureWrapper` doc comment identifies as destructive ("never removed
 * from one DOM parent and re-appended to another"). This module instead
 * reuses the SAME flat, always-root-parented, absolutely-positioned wrapper
 * strategy `LayoutInterpreter` already uses for exactly that reason: real
 * solved geometry, applied to STABLE sibling elements whose DOM parent never
 * changes. Full `<sl-split-panel>` unification with `renderSpine` (one
 * primitive for both workspace and center) remains Phase 5 work (design
 * §9.2) — `center-panes-layout-adapter.ts`'s header names this same boundary.
 *
 * F7 (repair round 3, faces-mvp review): this module is a PRODUCTION-
 * GEOMETRY SHIM, not a general layout primitive, and its shape is
 * deliberately narrower than `LayoutInterpreter`'s in two ways this file
 * states explicitly rather than leaving implicit:
 *
 *   1. ONE-OR-TWO LEAVES ONLY (`CenterPaneSplitInput.secondaryId: string |
 *      null` — there is no third pane, no nesting). `sh-center-panes`'
 *      OWN model (`center-panes-model.ts`) never represents more than
 *      primary+secondary, so this adapter has no need to solve anything
 *      deeper — it is not a limitation this file works around, it is the
 *      exact shape of what it wraps.
 *   2. AXIS IS ALWAYS `'horizontal'` (`throwawayGeometryDocument` below
 *      hardcodes it) — `sh-center-panes` has no vertical-split mode today.
 *
 * `LayoutInterpreter` (`layout-interpreter.ts`) — proven end-to-end by the
 * REAL workbench (`apps/organism/src/harness/layout-workbench-main.ts` +
 * `scripts/layout-workbench-gardend-browser.mts`) — has neither limitation:
 * it renders an arbitrary-depth recursive split tree on either axis, with
 * real `FaceRegistration`-mounted content, not a throwaway `sophia.home`-
 * only geometry document. This module and that one are DELIBERATELY
 * separate today (see `center-panes-layout-adapter.ts`'s own "F7 STAGING"
 * comment for why production content still goes through neither the
 * interpreter nor this file, only `sh-center-panes`' own imperative shell).
 */
import {
  createSophiaHomeDescriptor,
  solveLayout,
  type LayoutDocument,
  type LayoutNode,
  type ViewportAllocation,
} from '@shrubbery/nucleus/layout'

export interface CenterPaneSplitInput {
  readonly primaryId: string
  /** `null` when there is no second pane — the one-leaf, unsplit case. */
  readonly secondaryId: string | null
  /** 0..100 — `sh-center-panes`' own `CenterPanesProjection.dividerPercent`. */
  readonly dividerPercent: number
  readonly containerWidth: number
  readonly containerHeight: number
  readonly dividerThickness?: number
}

export interface CenterPaneSplitResult {
  readonly primary: ViewportAllocation
  /** `null` exactly when `input.secondaryId` was `null`. */
  readonly secondary: ViewportAllocation | null
  readonly dividerThickness: number
}

const GEOMETRY_LAYOUT_ID = 'center-panes-geometry'
const GEOMETRY_SPLIT_ID = 'center-panes-geometry-split'
const GEOMETRY_TIMESTAMP = '1970-01-01T00:00:00.000Z'
/** `sh-center-panes`' existing divider hit-target width (center-panes-host.ts's own `.divider { width: 12px }`). */
export const DEFAULT_CENTER_DIVIDER_THICKNESS = 12

/** `dividerPercent` (0..100, not yet clamped to the caller's min/max) -> Phase 1's integer 1..9999 basis points. Mirrors `center-panes-layout-adapter.ts`'s `dividerPercentToBasisPoints` exactly (kept local to avoid a `center-panes-host <-> layout` import cycle); both round the same way and clamp to the same legal range. */
function toBasisPoints(dividerPercent: number): number {
  const raw = Math.round(dividerPercent * 100)
  return Math.min(9999, Math.max(1, raw))
}

function throwawayGeometryDocument(input: CenterPaneSplitInput): LayoutDocument {
  const primaryLeaf: LayoutNode = {
    kind: 'leaf',
    id: input.primaryId,
    descriptor: createSophiaHomeDescriptor(),
    descriptorRevision: 0,
  }
  if (!input.secondaryId) {
    return {
      schemaVersion: 1,
      layoutId: GEOMETRY_LAYOUT_ID,
      scope: 'session',
      graphId: null,
      rootNodeId: input.primaryId,
      nodes: { [input.primaryId]: primaryLeaf },
      createdAt: GEOMETRY_TIMESTAMP,
      updatedAt: GEOMETRY_TIMESTAMP,
    }
  }
  const secondaryLeaf: LayoutNode = {
    kind: 'leaf',
    id: input.secondaryId,
    descriptor: createSophiaHomeDescriptor(),
    descriptorRevision: 0,
  }
  return {
    schemaVersion: 1,
    layoutId: GEOMETRY_LAYOUT_ID,
    scope: 'session',
    graphId: null,
    rootNodeId: GEOMETRY_SPLIT_ID,
    nodes: {
      [GEOMETRY_SPLIT_ID]: {
        kind: 'split',
        id: GEOMETRY_SPLIT_ID,
        axis: 'horizontal',
        startNodeId: input.primaryId,
        endNodeId: input.secondaryId,
        startBasisPoints: toBasisPoints(input.dividerPercent),
      },
      [input.primaryId]: primaryLeaf,
      [input.secondaryId]: secondaryLeaf,
    },
    createdAt: GEOMETRY_TIMESTAMP,
    updatedAt: GEOMETRY_TIMESTAMP,
  }
}

/**
 * Solve `sh-center-panes`' own primary/(optional)secondary geometry through
 * the REAL Phase-1 recursive solver (`solveLayout`, never reimplemented
 * arithmetic). Returns `null` only when the container has not been measured
 * yet (non-positive width/height) or the solve is otherwise infeasible —
 * callers should retain their previous geometry (or render nothing) rather
 * than treat a 0x0 container as a legitimate layout.
 *
 * No `isFaceRegistered` predicate is passed to `solveLayout`: the document
 * built here uses ONLY `sophia.home` descriptors, which is exactly what
 * `@shrubbery/nucleus/layout`'s OWN `defaultFaceRegistrationPredicate`
 * accepts — reusing the real default rather than constructing a redundant
 * allow-list of one.
 */
export function solveCenterPaneSplit(input: CenterPaneSplitInput): CenterPaneSplitResult | null {
  if (!(input.containerWidth > 0) || !(input.containerHeight > 0)) return null
  const dividerThickness = input.dividerThickness ?? DEFAULT_CENTER_DIVIDER_THICKNESS
  const doc = throwawayGeometryDocument(input)
  const solved = solveLayout(doc, {}, input.containerWidth, input.containerHeight, { dividerThickness })
  if (!solved.ok) return null
  if (solved.plan.root.kind === 'leaf') {
    return { primary: solved.plan.root.allocation, secondary: null, dividerThickness }
  }
  // `throwawayGeometryDocument` only ever mints 'leaf'/'split' nodes, never a
  // 'grid' (@shrubbery/nucleus/layout's third LayoutNode kind, Wave 2 x Lane
  // B) — this narrows for the type checker; grid-aware rendering here is out
  // of this function's scope (it never builds a grid to begin with).
  if (solved.plan.root.kind !== 'split') return null
  return { primary: solved.plan.root.start.allocation, secondary: solved.plan.root.end.allocation, dividerThickness }
}
