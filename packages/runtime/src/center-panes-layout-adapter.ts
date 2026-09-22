/**
 * center-panes-layout-adapter.ts — `CenterPanesState → LayoutDocument`
 * (design plans/shrubbery-layout-as-data-design-20260716.md §9.2 Phase 3's
 * "Likely files" list, and Phase 4's exact migration recipe: "center-primary
 * → leaf with current document/home descriptor; existing secondary → second
 * leaf; deterministic root split center-root-split, horizontal axis;
 * dividerPercent * 100 → basis points"; diff-review WRONG "render organism
 * center via the layout vehicle" — "Adapt CenterPanesState to a LayoutDocument
 * and route the actual Organism center through the recursive renderer while
 * preserving its shell chrome and controller").
 *
 * This module is DELIBERATELY narrow: a pure, one-way projection from the
 * production `CenterPanesState` (center-panes-model.ts's own canonical
 * session state — primary/secondary pane, divider percent, navigation
 * history) into a valid Phase-1 `LayoutDocument`, using ONLY Phase 1's own
 * `@shrubbery/nucleus/layout` types/constants — never reimplementing the
 * document schema, basis-point clamping, or `sophia.home` descriptor
 * minting (design's own "consume the Phase-1 model... do NOT reimplement
 * it").
 *
 * The production Organism no longer mounts `sh-center-panes`: the workspace
 * assembler projects the same center state into the single recursive Surface
 * document and mounts pane header/content faces through `LayoutInterpreter`.
 * This module remains the small public adapter for callers that need a
 * center-only document, while `sh-center-panes` and its split renderer remain
 * compatibility specimens for isolated consumers and regression tests.
 */
import {
  createSophiaHomeDescriptor,
  deepFreeze,
  isValidBasisPoints,
  type LayoutDocument,
  type LayoutNode,
  type ViewDescriptor,
} from '@shrubbery/nucleus/layout'
import type { CenterPaneLocation, CenterPanesState } from './center-panes-contract.js'

/** Deterministic — design §9.2 Phase 4's own migration recipe names this exact id. */
export const CENTER_ROOT_SPLIT_ID = 'center-root-split'

/** The `hoja.document` face id — the real, registered v1 face (`@shrubbery/runtime/layout`'s `HOJA_DOCUMENT_FACE_ID`). Not imported from there to avoid a `runtime -> runtime/layout` self-dependency; the string is the public, stable contract. */
const HOJA_DOCUMENT_FACE_ID = 'hoja.document'

function locationDescriptor(location: CenterPaneLocation): ViewDescriptor {
  if (location.kind === 'document') {
    return {
      schemaVersion: 1,
      faceId: HOJA_DOCUMENT_FACE_ID,
      resource: { kind: 'document', graphId: location.graphId, documentId: location.documentId },
    }
  }
  // 'home' — Phase 1's OWN well-known descriptor (LAY-010's replacement
  // target), not a locally-reinvented one. `location.graphId` (per-graph
  // "home") has no home in the CONTENT-FREE `sophia.home` resource shape
  // (design §3.1: a descriptor names durable intent, not display copy) —
  // faithfully dropped, exactly as LAY-010's close_leaf replacement already
  // does for any leaf's home fallback.
  return createSophiaHomeDescriptor()
}

/**
 * `dividerPercent` (design §2.2's `%`, 20..80 by `center-panes-model.ts`'s
 * own default clamp) → integer basis points (Phase 1's `1..9999`, `5000` =
 * 50%). Multiplying by 100 and clamping to the LEGAL range (not the
 * center-panes' OWN narrower 20..80 range — a caller passing a not-yet-
 * clamped raw percent should still get a Phase-1-valid document) is the
 * exact conversion design §9.2 Phase 4 names: "dividerPercent * 100 → basis
 * points".
 */
export function dividerPercentToBasisPoints(dividerPercent: number): number {
  const raw = Math.round(dividerPercent * 100)
  return isValidBasisPoints(raw) ? raw : Math.min(9999, Math.max(1, raw))
}

/**
 * `CenterPanesState` → a valid Phase-1 `LayoutDocument`. Always either ONE
 * leaf (`state.primary`'s id, no split — `state.secondary === null`) or a
 * `center-root-split` horizontal split of `primary`/`secondary` — the exact
 * degenerate shapes design §2.2 calls out as legal v1 documents ("The v1
 * document contains one root"). `layoutId`/timestamps are caller-supplied so
 * repeated calls over an unchanged `state` are byte-identical (LAY-011)
 * rather than accidentally re-timestamped on every render.
 */
export function centerPanesStateToLayoutDocument(
  state: CenterPanesState,
  options: { readonly layoutId?: string; readonly graphId?: string | null; readonly at?: string } = {},
): LayoutDocument {
  const layoutId = options.layoutId ?? 'center-panes'
  const at = options.at ?? new Date(0).toISOString()
  const graphId = options.graphId ?? state.primary.current.graphId ?? null

  const primaryLeaf: LayoutNode = {
    kind: 'leaf',
    id: state.primary.id,
    descriptor: locationDescriptor(state.primary.current),
    descriptorRevision: 0,
  }

  if (!state.secondary) {
    return deepFreeze({
      schemaVersion: 1,
      layoutId,
      scope: 'session',
      graphId,
      rootNodeId: state.primary.id,
      nodes: { [state.primary.id]: primaryLeaf },
      createdAt: at,
      updatedAt: at,
    })
  }

  const secondaryLeaf: LayoutNode = {
    kind: 'leaf',
    id: state.secondary.id,
    descriptor: locationDescriptor(state.secondary.current),
    descriptorRevision: 0,
  }
  const split: LayoutNode = {
    kind: 'split',
    id: CENTER_ROOT_SPLIT_ID,
    axis: 'horizontal',
    startNodeId: state.primary.id,
    endNodeId: state.secondary.id,
    startBasisPoints: dividerPercentToBasisPoints(state.dividerPercent),
  }
  return deepFreeze({
    schemaVersion: 1,
    layoutId,
    scope: 'session',
    graphId,
    rootNodeId: CENTER_ROOT_SPLIT_ID,
    nodes: {
      [CENTER_ROOT_SPLIT_ID]: split,
      [state.primary.id]: primaryLeaf,
      [state.secondary.id]: secondaryLeaf,
    },
    createdAt: at,
    updatedAt: at,
  })
}
