/**
 * operations.ts — the CLOSED operation union (design §2.4) as pure total
 * reducers: `applyOperation(doc, op)` takes a VALID `LayoutDocument` and one
 * `LayoutOperation`, and returns either `{ ok: true, doc }` (a new, itself
 * VALID, DEEP-FROZEN document) or `{ ok: false, diagnostic }`. Every op
 * reduces one valid tree to another valid tree atomically; NONE ever returns a
 * half-mutated document — `finalizeCandidate` re-validates the constructed
 * candidate AND deep-freezes it before it is ever handed back (defense in
 * depth beneath each op's own preconditions).
 *
 * This mirrors workspace/apply-verb.ts's shape exactly: one CLOSED
 * discriminated union (`LayoutOperation`) is the security/shape boundary, and
 * one exported dispatcher (`applyOperation`) is the sole public entry point.
 * The six per-op reducers below are module-private — a caller can only reach
 * them through the closed union, never by importing an individual verb
 * function and inventing new argument shapes.
 *
 * CONCURRENCY PRECONDITIONS (design §2.5) — two rounds:
 *
 * r1 made `expectedParent` (`split_leaf`/`close_leaf`/`move_node`'s source)
 * and `expectedDescriptorRevision` (`replace_descriptor`) OPTIONAL,
 * backward-compatible guards: omitted meant "no constraint, last-write-wins."
 *
 * r2 (design §9.2 Phase 1 diff-review r2) found that backward-compatible
 * default insufficient: "two concurrent splits of the same leaf cannot both
 * silently win" is not actually true when the guard is opt-in — a caller
 * (or half of a two-writer race) that simply omits the field still wins
 * unconditionally. The design's own §2.5 text ("reject stale split, move,
 * close, and replacement operations") is a MUST, not a MAY. r2 makes these
 * preconditions REQUIRED, on the four op types design §2.5 names, PLUS
 * `move_node`'s TARGET leaf (`expectedTargetParent`) — the r1 review missed
 * that a target leaf can itself have been concurrently relocated between the
 * caller's read and its write, and a target-only guard silently splices the
 * moved node in beside whatever the id currently resolves to, which may not
 * be where the caller reasoned it would land. `locateParent` (bottom of this
 * file) is exported so a well-behaved caller can compute a CORRECT
 * precondition without hand-deriving `ParentLocation`.
 *
 * A forged/malformed precondition (missing, `null`, wrong shape) is now
 * rejected by `decodeOperation` BEFORE any reducer runs — see this file's
 * "closed union decoder" section, which also fixes the r1 escape where
 * `applyOperation(doc, null)` / `applyOperation(doc, undefined)` / a
 * `split_leaf` with `expectedParent: null` all threw instead of returning a
 * diagnostic (r2: `applyOperation` MUST be a total, non-throwing reducer for
 * ANY input shape, not just the one adversarial shape r1's test covered).
 *
 * r4 (Builder P1 hardening finding 1): r2's decoder proved the operation's
 * KEY SET closed and its preconditions well-shaped, but every OTHER
 * mandatory field (`leafId`, `newLeafId`, `splitId`, `nodeId`,
 * `targetLeafId`, `firstNodeId`, `secondNodeId`, `axis`, `side`) was still
 * cast straight through to its reducer untyped. A JSON-shaped operation with
 * `leafId: null` — a legal JSON value — reached `requireKind`, which handed
 * `null` to `makeDiagnostic`'s `nodeId` parameter, and `diagnostics.ts`'s
 * `tokenizeId` threw on `null.length`. `REQUIRED_ID_FIELDS`/
 * `REQUIRED_ENUM_STRING_FIELDS` (below, in the "closed union decoder"
 * section) close this: every mandatory id is checked as a non-empty string,
 * and every mandatory enum-shaped field is checked as a string, BEFORE any
 * reducer runs — a missing or wrong-typed field is now uniformly
 * `LAYOP_MALFORMED_OPERATION` rather than reaching a reducer and either
 * throwing or being misdiagnosed under an unrelated code.
 *
 * Pure: no DOM, no stores, no Y.js, no network. Metadata (`createdAt` /
 * `updatedAt`) is deliberately left untouched by every reducer here — stamping
 * it is an interpreter/caller responsibility (P2), not part of this pure
 * structural core, so operations stay fully deterministic for the property
 * and determinism tests.
 */

import type {
  Axis,
  GridCell,
  GridChildrenSource,
  GridConfig,
  GridFlow,
  LayoutDocument,
  LayoutGridNode,
  LayoutLeafNode,
  LayoutNode,
  LayoutSplitNode,
  LayoutTabsNode,
  ResourceLocator,
  ViewDescriptor,
} from './types.js'
import {
  DEFAULT_BASIS_POINTS,
  GRID_FLOWS,
  MAX_BASIS_POINTS,
  MAX_TABS,
  MIN_BASIS_POINTS,
  createSophiaHomeDescriptor,
  isValidDescriptorRevision,
  isValidGridRevision,
  isValidMinCellWidth,
  isValidTabLabel,
  isValidTabsRevision,
  childNodeIds,
} from './types.js'
import type { Diagnostic } from './diagnostics.js'
import { makeDiagnostic } from './diagnostics.js'
import type { FaceGridEligibilityPredicate, FaceRegistrationPredicate, ValidateOptions } from './validate.js'
import {
  defaultFaceGridEligibilityPredicate,
  defaultFaceRegistrationPredicate,
  hasNoUnknownKeys,
  isPlainObject,
  isWellShapedGridChildrenSource,
  isWellShapedViewDescriptor,
  validateLayoutDocument,
} from './validate.js'
import { deepCloneJsonValue, freezeWithoutMutatingOwner } from './immutable.js'

export type Side = 'start' | 'end'

/**
 * Where a node currently sits: the document root, or a specific split's
 * start/end child. Used both internally (`findParentLocation`) and publicly
 * as the shape of a `LayoutOperation`'s `expectedParent`/`expectedTargetParent`
 * precondition — the caller states what it last observed; `applyOperation`
 * compares that against the CURRENT location before mutating anything.
 */
export type ParentLocation =
  | { readonly kind: 'root' }
  | { readonly kind: 'child'; readonly splitId: string; readonly side: Side }
  | { readonly kind: 'tab'; readonly tabsId: string; readonly index: number }

/**
 * The CLOSED operation union (design §2.4) — the security boundary BY SHAPE,
 * same discipline as workspace/apply-verb.ts's `VerbSpec`. No member carries
 * raw node maps, arbitrary object mutation, or an escape hatch; every field is
 * an id, an enum, a ratio, a `ParentLocation`, or a `ViewDescriptor` (itself
 * closed, types.ts/validate.ts). `expectedParent` / `expectedTargetParent` /
 * `expectedDescriptorRevision` are REQUIRED (design §9.2 Phase 1 diff-review
 * r2 — see file header); `startBasisPoints` remains optional (a caller happy
 * with the default 50/50 split never needs to think about ratios).
 */
export type LayoutOperation =
  | {
      readonly op: 'split_leaf'
      readonly leafId: string
      readonly axis: Axis
      readonly side: Side
      readonly newLeafId: string
      readonly splitId: string
      readonly descriptor: ViewDescriptor
      readonly startBasisPoints?: number
      readonly expectedParent: ParentLocation
    }
  | {
      readonly op: 'close_leaf'
      readonly leafId: string
      readonly expectedParent: ParentLocation
    }
  | { readonly op: 'set_ratio'; readonly splitId: string; readonly startBasisPoints: number }
  | {
      readonly op: 'replace_descriptor'
      readonly leafId: string
      readonly descriptor: ViewDescriptor
      readonly expectedDescriptorRevision: number
    }
  | { readonly op: 'swap_nodes'; readonly firstNodeId: string; readonly secondNodeId: string }
  | {
      readonly op: 'move_node'
      readonly nodeId: string
      readonly targetLeafId: string
      readonly side: Side
      readonly axis: Axis
      readonly splitId: string
      readonly startBasisPoints?: number
      readonly expectedParent: ParentLocation
      readonly expectedTargetParent: ParentLocation
    }
  // ── grid/collection node ops (Wave 2 x Lane B, design §2.2) ─────────────
  | {
      readonly op: 'insert_grid'
      readonly targetLeafId: string
      readonly axis: Axis
      readonly side: Side
      readonly splitId: string
      readonly gridId: string
      readonly gridConfig: GridConfig
      readonly startBasisPoints?: number
      readonly expectedParent: ParentLocation
    }
  | {
      /**
       * Generalizes `close_leaf` to ANY node id — leaf, grid, or an entire
       * split subtree (design §2.2's op table: "generalizes close_leaf...
       * subtree dispose; sibling promotion; LAY-010 home-fallback preserved").
       * Additive: `close_leaf` itself is untouched, still leaf-only.
       */
      readonly op: 'close_node'
      readonly nodeId: string
      readonly expectedParent: ParentLocation
    }
  | {
      readonly op: 'wrap_in_tabs'
      readonly nodeId: string
      readonly tabsId: string
      readonly label: string
      readonly expectedParent: ParentLocation
    }
  | {
      readonly op: 'tabs_add_tab'
      readonly tabsId: string
      readonly newLeafId: string
      readonly descriptor: ViewDescriptor
      readonly label: string
      readonly index?: number
      readonly activate?: boolean
      readonly expectedTabsRevision: number
    }
  | {
      readonly op: 'tabs_close_tab'
      readonly tabsId: string
      readonly nodeId: string
      readonly expectedTabsRevision: number
    }
  | {
      readonly op: 'tabs_set_active'
      readonly tabsId: string
      readonly activeNodeId: string
      readonly expectedTabsRevision: number
    }
  | {
      /** Whole-`cells` replacement (fixed source). */
      readonly op: 'grid_set_cells'
      readonly gridId: string
      readonly cells: readonly GridCell[]
      readonly expectedGridRevision: number
    }
  | {
      /** Set/replace the collection binding — also flips the source kind to `'collection'`. */
      readonly op: 'grid_bind_collection'
      readonly gridId: string
      readonly collection: ResourceLocator
      readonly itemFaceId: string
      readonly itemParams?: Readonly<Record<string, string>>
      readonly maxItems: number
      readonly refreshSeconds?: number
      readonly expectedGridRevision: number
    }
  | {
      readonly op: 'grid_set_flow'
      readonly gridId: string
      readonly flow: GridFlow
      readonly minCellWidth: number
      readonly expectedGridRevision: number
    }

export type OperationResult =
  | { readonly ok: true; readonly doc: LayoutDocument }
  | { readonly ok: false; readonly diagnostic: Diagnostic }

// ── shared precondition helpers ─────────────────────────────────────────────

/**
 * `Object.hasOwn`-guarded node lookup — mirrors validate.ts's private
 * `getOwnNode` (same rationale, restated here because operations.ts's node
 * map is typed `Record<string, LayoutNode>`, not `Record<string, unknown>`).
 * A bare `doc.nodes[id]` resolves an INHERITED `Object.prototype` member
 * (e.g. `id === 'toString'`, a perfectly ordinary JSON string value for an
 * operation's `firstNodeId`/`leafId`/etc.) as if it were a real node — which
 * is truthy, so a plain `!doc.nodes[id]` existence check let it silently
 * through. Builder P1 hardening (recheck): `requireExisting`'s old bare
 * lookup let `swap_nodes` with `firstNodeId: 'toString'` past its
 * existence check entirely; the reducer then called `findParentLocation`,
 * got a genuine `null` back (no split actually points at `'toString'`), and
 * dereferenced that `null` after an unchecked `as ParentLocation` cast —
 * `applyOperation` is documented to NEVER throw for ANY JSON-shaped input.
 * Every node lookup keyed by an OPERATION-SUPPLIED id (never one derived by
 * enumerating `Object.values`/`Object.entries` of an already-valid map, which
 * only ever yields genuine own entries) goes through this helper instead of a
 * bare bracket access.
 */
function getOwnNode(nodes: Readonly<Record<string, LayoutNode>>, id: string): LayoutNode | undefined {
  return Object.hasOwn(nodes, id) ? nodes[id] : undefined
}

function requireExisting(doc: LayoutDocument, id: string, label: string): Diagnostic | null {
  if (!getOwnNode(doc.nodes, id)) {
    return makeDiagnostic('LAYOP_NODE_NOT_FOUND', id, { field: label })
  }
  return null
}

function requireKind(
  doc: LayoutDocument,
  id: string,
  kind: 'split' | 'leaf' | 'grid' | 'tabs',
  label: string,
): Diagnostic | null {
  const node = getOwnNode(doc.nodes, id)
  if (!node) return makeDiagnostic('LAYOP_NODE_NOT_FOUND', id, { field: label })
  if (node.kind !== kind) {
    return makeDiagnostic('LAYOP_NODE_KIND_MISMATCH', id, {
      field: label,
      expectedKind: kind,
      actualKind: node.kind,
    })
  }
  return null
}

function requireFreshId(doc: LayoutDocument, id: string, label: string): Diagnostic | null {
  if (getOwnNode(doc.nodes, id)) {
    return makeDiagnostic('LAYOP_ID_COLLISION', id, { field: label })
  }
  return null
}

function requireEnum<T extends string>(
  value: string,
  legal: readonly T[],
  label: string,
): Diagnostic | null {
  if (!(legal as readonly string[]).includes(value)) {
    return makeDiagnostic('LAYOP_INVALID_ENUM', undefined, {
      field: label,
      legalValues: legal.join('|'),
    })
  }
  return null
}

function clampBasisPoints(value: number): number {
  const rounded = Math.round(value)
  return Math.min(MAX_BASIS_POINTS, Math.max(MIN_BASIS_POINTS, rounded))
}

/**
 * Resolve an optional/required ratio input into a legal stored value. Per
 * design §2.5, `set_ratio` (and any op that plants a fresh split ratio)
 * CLAMPS into the legal [1,9999] document range rather than rejecting —
 * the separate, unrelated client-projection clamp (solver.ts, driven by
 * viewport minima) never writes back into the document. A non-finite input
 * (NaN/Infinity/non-number) is the one genuine precondition failure.
 */
function resolveBasisPoints(
  requested: number | undefined,
): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly diagnostic: Diagnostic } {
  if (requested === undefined) return { ok: true, value: DEFAULT_BASIS_POINTS }
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAYOP_INVALID_RATIO_INPUT', undefined, {
        actualType: typeof requested,
      }),
    }
  }
  return { ok: true, value: clampBasisPoints(requested) }
}

/**
 * Find where `id` sits: the document root, one specific split's start/end
 * child, or one direct tab of a tabs node.
 * In a valid document (LAY-001: at most one parent) at most one match
 * exists, so `Object.values` iteration order never affects the result.
 */
function findParentLocation(
  nodes: Readonly<Record<string, LayoutNode>>,
  rootNodeId: string,
  id: string,
): ParentLocation | null {
  if (rootNodeId === id) return { kind: 'root' }
  for (const node of Object.values(nodes)) {
    if (node.kind === 'split') {
      if (node.startNodeId === id) return { kind: 'child', splitId: node.id, side: 'start' }
      if (node.endNodeId === id) return { kind: 'child', splitId: node.id, side: 'end' }
    } else if (node.kind === 'tabs') {
      const index = node.tabs.findIndex((tab) => tab.nodeId === id)
      if (index >= 0) return { kind: 'tab', tabsId: node.id, index }
    }
  }
  return null
}

/**
 * Where `id` currently sits in `doc` — the document root, or one specific
 * split's start/end child. Exported so a well-behaved caller/test can compute
 * a CORRECT `expectedParent`/`expectedTargetParent` precondition without
 * hand-deriving `ParentLocation` (design §9.2 Phase 1 diff-review r2: these
 * preconditions are now mandatory on several ops). Returns `null` iff `id`
 * does not exist in `doc` at all.
 */
export function locateParent(doc: LayoutDocument, id: string): ParentLocation | null {
  return findParentLocation(doc.nodes, doc.rootNodeId, id)
}

function parentLocationsMatch(a: ParentLocation, b: ParentLocation): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'root':
      return true
    case 'child':
      return a.splitId === (b as Extract<ParentLocation, { kind: 'child' }>).splitId && a.side === (b as Extract<ParentLocation, { kind: 'child' }>).side
    case 'tab':
      return a.tabsId === (b as Extract<ParentLocation, { kind: 'tab' }>).tabsId && a.index === (b as Extract<ParentLocation, { kind: 'tab' }>).index
  }
}

/**
 * Check a MANDATORY `expectedParent`/`expectedTargetParent` precondition
 * against `id`'s ACTUAL current parent location. `expectedParent` here is
 * already known well-shaped (`decodeOperation` verified it before any reducer
 * runs) — this function only compares it against the live document. Returns a
 * `LAYOP_STALE_PARENT` diagnostic when the caller-supplied expectation no
 * longer matches (design §2.5's "two concurrent splits of the same leaf
 * cannot both silently win" — the second, stale caller is rejected here,
 * surfaced for retry against the tree's new shape). `fieldLabel` names WHICH
 * precondition failed ('expectedParent' vs 'expectedTargetParent') so
 * `move_node`'s two independent guards are distinguishable in diagnostics.
 */
function checkExpectedParent(
  doc: LayoutDocument,
  id: string,
  expectedParent: ParentLocation,
  fieldLabel: 'expectedParent' | 'expectedTargetParent',
): Diagnostic | null {
  const actual = findParentLocation(doc.nodes, doc.rootNodeId, id)
  if (actual !== null && parentLocationsMatch(expectedParent, actual)) return null
  return makeDiagnostic('LAYOP_STALE_PARENT', id, {
    field: fieldLabel,
  })
}

function rejectIfTabChild(doc: LayoutDocument, id: string, field: string): Diagnostic | null {
  const loc = findParentLocation(doc.nodes, doc.rootNodeId, id)
  return loc?.kind === 'tab' ? makeDiagnostic('LAYOP_TAB_CHILD_NOT_RELOCATABLE', id, { field }) : null
}

/**
 * All ids in `nodeId`'s own subtree (inclusive), via a bounded iterative walk
 * (a visited-set guards against a malformed/cyclic input rather than trusting
 * the caller's document is already valid).
 */
function collectSubtreeIds(
  nodes: Readonly<Record<string, LayoutNode>>,
  nodeId: string,
): Set<string> {
  const result = new Set<string>()
  const stack: string[] = [nodeId]
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (result.has(id)) continue
    result.add(id)
    const node = getOwnNode(nodes, id)
    if (node) stack.push(...childNodeIds(node))
  }
  return result
}

type WorkingTree = { nodes: Record<string, LayoutNode>; rootNodeId: string }

/**
 * Detach `nodeId` (which MUST have a parent — callers reject nodeId===root
 * before calling this) by removing its parent split and promoting the
 * sibling into the parent's old slot (design §2.5 close_leaf/move_node
 * shared step). `nodeId`'s own node entry (and, if it is a split, its entire
 * subtree) is left completely untouched — only the parent split is removed
 * and the grandparent/root edge is rewired. The caller decides whether to
 * also delete `nodeId` itself (close_leaf: yes; move_node: no, it is
 * reinserted immediately after).
 */
function detachPromoteSibling(working: WorkingTree, nodeId: string): WorkingTree | null {
  const parentLoc = findParentLocation(working.nodes, working.rootNodeId, nodeId)
  if (!parentLoc || parentLoc.kind !== 'child') return null
  const loc = parentLoc
  const parentSplit = working.nodes[loc.splitId] as LayoutSplitNode
  const siblingId = loc.side === 'start' ? parentSplit.endNodeId : parentSplit.startNodeId

  const grandparentLoc = findParentLocation(working.nodes, working.rootNodeId, loc.splitId)
  const nextNodes: Record<string, LayoutNode> = { ...working.nodes }
  delete nextNodes[loc.splitId]

  let nextRoot = working.rootNodeId
  if (!grandparentLoc || grandparentLoc.kind === 'root') {
    nextRoot = siblingId
  } else if (grandparentLoc.kind === 'child') {
    const g = nextNodes[grandparentLoc.splitId] as LayoutSplitNode
    nextNodes[grandparentLoc.splitId] =
      grandparentLoc.side === 'start' ? { ...g, startNodeId: siblingId } : { ...g, endNodeId: siblingId }
  } else {
    const tabs = nextNodes[grandparentLoc.tabsId] as LayoutTabsNode
    nextNodes[grandparentLoc.tabsId] = {
      ...tabs,
      tabs: tabs.tabs.map((tab, index) => (index === grandparentLoc.index ? { ...tab, nodeId: siblingId } : tab)),
      activeNodeId: tabs.activeNodeId === loc.splitId ? siblingId : tabs.activeNodeId,
      tabsRevision: tabs.tabsRevision + 1,
    }
  }
  return { nodes: nextNodes, rootNodeId: nextRoot }
}

/**
 * Insert `insertedNodeId` beside `targetLeafId` under a fresh split `splitId`
 * (design §2.5 split_leaf/move_node shared step). `targetLeafId`'s own entry
 * is untouched; only its parent edge (or root pointer) is rewired to the new
 * split.
 */
function spliceBesideLeaf(
  working: WorkingTree,
  targetLeafId: string,
  side: Side,
  axis: Axis,
  splitId: string,
  insertedNodeId: string,
  startBasisPoints: number,
): WorkingTree {
  const targetLoc = findParentLocation(working.nodes, working.rootNodeId, targetLeafId) as ParentLocation
  const newSplit: LayoutSplitNode = {
    kind: 'split',
    id: splitId,
    axis,
    startNodeId: side === 'start' ? insertedNodeId : targetLeafId,
    endNodeId: side === 'start' ? targetLeafId : insertedNodeId,
    startBasisPoints,
  }
  const nextNodes: Record<string, LayoutNode> = { ...working.nodes, [splitId]: newSplit }
  let nextRoot = working.rootNodeId
  if (targetLoc.kind === 'root') {
    nextRoot = splitId
  } else if (targetLoc.kind === 'child') {
    const p = nextNodes[targetLoc.splitId] as LayoutSplitNode
    nextNodes[targetLoc.splitId] =
      targetLoc.side === 'start' ? { ...p, startNodeId: splitId } : { ...p, endNodeId: splitId }
  } else {
    const tabs = nextNodes[targetLoc.tabsId] as LayoutTabsNode
    nextNodes[targetLoc.tabsId] = {
      ...tabs,
      tabs: tabs.tabs.map((tab, index) => (index === targetLoc.index ? { ...tab, nodeId: splitId } : tab)),
      activeNodeId: tabs.activeNodeId === targetLeafId ? splitId : tabs.activeNodeId,
      tabsRevision: tabs.tabsRevision + 1,
    }
  }
  return { nodes: nextNodes, rootNodeId: nextRoot }
}

/**
 * Deep-clone a caller-supplied `ViewDescriptor` before it is EVER embedded in
 * a stored node. Only ever called after `isWellShapedViewDescriptor` (and
 * therefore validate.ts's recursive closed/serializable check on `params`)
 * has already passed, so the clone cannot encounter anything it doesn't know
 * how to copy. This is what stops the caller's ORIGINAL object — which the
 * caller may go on to mutate after this call returns — from ever being
 * reachable from the returned document.
 */
function cloneViewDescriptor(descriptor: ViewDescriptor): ViewDescriptor {
  return deepCloneJsonValue(descriptor)
}

/**
 * Re-validate a constructed candidate before ever returning it as `ok: true`,
 * then freeze it via `freezeWithoutMutatingOwner` (immutable.ts) — NOT the
 * bare `deepFreeze` this used before Builder P1 hardening finding 2. Most of
 * a candidate's nodes are the SAME object references as the caller-supplied
 * input `doc.nodes[id]` (only the handful this step actually touched are
 * fresh); `deepFreeze` would call `Object.freeze` directly on those shared
 * references, mutating whatever object graph the CALLER still owns as a side
 * effect — not a valid thing for a pure reducer to do.
 * `freezeWithoutMutatingOwner` clones any not-yet-frozen subtree before
 * freezing it instead, so nothing reachable from the caller's own input is
 * ever touched, while an already-frozen subtree (the normal case once a
 * document has been through this once) is still reused for free.
 */
function finalizeCandidate(
  candidate: LayoutDocument,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): OperationResult {
  const verdict = validateLayoutDocument(candidate, { isFaceRegistered, isFaceGridEligible })
  if (!verdict.ok) {
    const first = verdict.diagnostics[0]
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAYOP_POSTCONDITION_INVALID', first.nodeId, {
        underlyingCode: first.code,
      }),
    }
  }
  return { ok: true, doc: freezeWithoutMutatingOwner(candidate) }
}

// ── the six reducers (module-private; reached only through applyOperation) ─

type Op<K extends LayoutOperation['op']> = Extract<LayoutOperation, { op: K }>

function splitLeaf(
  doc: LayoutDocument,
  op: Op<'split_leaf'>,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): OperationResult {
  const leafErr = requireKind(doc, op.leafId, 'leaf', 'leafId')
  if (leafErr) return { ok: false, diagnostic: leafErr }
  const staleErr = checkExpectedParent(doc, op.leafId, op.expectedParent, 'expectedParent')
  if (staleErr) return { ok: false, diagnostic: staleErr }

  const axisErr = requireEnum(op.axis, ['horizontal', 'vertical'], 'axis')
  if (axisErr) return { ok: false, diagnostic: axisErr }
  const sideErr = requireEnum(op.side, ['start', 'end'], 'side')
  if (sideErr) return { ok: false, diagnostic: sideErr }

  const newLeafErr = requireFreshId(doc, op.newLeafId, 'newLeafId')
  if (newLeafErr) return { ok: false, diagnostic: newLeafErr }
  const splitIdErr = requireFreshId(doc, op.splitId, 'splitId')
  if (splitIdErr) return { ok: false, diagnostic: splitIdErr }
  if (op.newLeafId === op.splitId) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAYOP_ID_COLLISION', op.newLeafId, {
        field: 'splitId',
      }),
    }
  }

  if (!isWellShapedViewDescriptor(op.descriptor)) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAY003_INVALID_DESCRIPTOR', op.newLeafId),
    }
  }
  if (!isFaceRegistered(op.descriptor)) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAY003_UNREGISTERED_FACE', op.newLeafId, {
        faceId: op.descriptor.faceId,
      }),
    }
  }

  const ratio = resolveBasisPoints(op.startBasisPoints)
  if (!ratio.ok) return { ok: false, diagnostic: ratio.diagnostic }

  const newLeaf: LayoutLeafNode = {
    kind: 'leaf',
    id: op.newLeafId,
    descriptor: cloneViewDescriptor(op.descriptor),
    descriptorRevision: 0,
  }
  const working: WorkingTree = {
    nodes: { ...doc.nodes, [op.newLeafId]: newLeaf },
    rootNodeId: doc.rootNodeId,
  }
  const spliced = spliceBesideLeaf(working, op.leafId, op.side, op.axis, op.splitId, op.newLeafId, ratio.value)
  const candidate: LayoutDocument = { ...doc, nodes: spliced.nodes, rootNodeId: spliced.rootNodeId }
  return finalizeCandidate(candidate, isFaceRegistered, isFaceGridEligible)
}

function closeLeaf(
  doc: LayoutDocument,
  op: Op<'close_leaf'>,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): OperationResult {
  const leafErr = requireKind(doc, op.leafId, 'leaf', 'leafId')
  if (leafErr) return { ok: false, diagnostic: leafErr }
  const tabErr = rejectIfTabChild(doc, op.leafId, 'leafId')
  if (tabErr) return { ok: false, diagnostic: tabErr }

  const staleErr = checkExpectedParent(doc, op.leafId, op.expectedParent, 'expectedParent')
  if (staleErr) return { ok: false, diagnostic: staleErr }

  if (doc.rootNodeId === op.leafId) {
    // LAY-010: closing the last leaf (root) replaces its descriptor with
    // sophia.home rather than emptying the document. Same node id, same
    // position — only the descriptor (and its revision) changes.
    const existing = getOwnNode(doc.nodes, op.leafId) as LayoutLeafNode
    const homeLeaf: LayoutLeafNode = {
      kind: 'leaf',
      id: op.leafId,
      descriptor: createSophiaHomeDescriptor(),
      descriptorRevision: existing.descriptorRevision + 1,
    }
    const candidate: LayoutDocument = { ...doc, nodes: { ...doc.nodes, [op.leafId]: homeLeaf } }
    return finalizeCandidate(candidate, isFaceRegistered, isFaceGridEligible)
  }

  const working: WorkingTree = { nodes: { ...doc.nodes }, rootNodeId: doc.rootNodeId }
  const promoted = detachPromoteSibling(working, op.leafId)
  if (!promoted) return { ok: false, diagnostic: makeDiagnostic('LAYOP_TAB_CHILD_NOT_RELOCATABLE', op.leafId, { field: 'leafId' }) }
  const nextNodes: Record<string, LayoutNode> = { ...promoted.nodes }
  delete nextNodes[op.leafId]
  const candidate: LayoutDocument = { ...doc, nodes: nextNodes, rootNodeId: promoted.rootNodeId }
  return finalizeCandidate(candidate, isFaceRegistered, isFaceGridEligible)
}

function setRatio(
  doc: LayoutDocument,
  op: Op<'set_ratio'>,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): OperationResult {
  const splitErr = requireKind(doc, op.splitId, 'split', 'splitId')
  if (splitErr) return { ok: false, diagnostic: splitErr }

  const ratio = resolveBasisPoints(op.startBasisPoints)
  if (!ratio.ok) return { ok: false, diagnostic: ratio.diagnostic }

  const existing = getOwnNode(doc.nodes, op.splitId) as LayoutSplitNode
  const nextNodes = { ...doc.nodes, [op.splitId]: { ...existing, startBasisPoints: ratio.value } }
  const candidate: LayoutDocument = { ...doc, nodes: nextNodes }
  return finalizeCandidate(candidate, isFaceRegistered, isFaceGridEligible)
}

function replaceDescriptor(
  doc: LayoutDocument,
  op: Op<'replace_descriptor'>,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): OperationResult {
  const leafErr = requireKind(doc, op.leafId, 'leaf', 'leafId')
  if (leafErr) return { ok: false, diagnostic: leafErr }

  const existing = getOwnNode(doc.nodes, op.leafId) as LayoutLeafNode
  if (op.expectedDescriptorRevision !== existing.descriptorRevision) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAYOP_STALE_DESCRIPTOR_REVISION', op.leafId, {
        expected: op.expectedDescriptorRevision,
        actual: existing.descriptorRevision,
      }),
    }
  }

  if (!isWellShapedViewDescriptor(op.descriptor)) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAY003_INVALID_DESCRIPTOR', op.leafId),
    }
  }
  if (!isFaceRegistered(op.descriptor)) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAY003_UNREGISTERED_FACE', op.leafId, {
        faceId: op.descriptor.faceId,
      }),
    }
  }

  const nextLeaf: LayoutLeafNode = {
    ...existing,
    descriptor: cloneViewDescriptor(op.descriptor),
    descriptorRevision: existing.descriptorRevision + 1,
  }
  const nextNodes = { ...doc.nodes, [op.leafId]: nextLeaf }
  const candidate: LayoutDocument = { ...doc, nodes: nextNodes }
  return finalizeCandidate(candidate, isFaceRegistered, isFaceGridEligible)
}

function swapNodes(
  doc: LayoutDocument,
  op: Op<'swap_nodes'>,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): OperationResult {
  const firstErr = requireExisting(doc, op.firstNodeId, 'firstNodeId')
  if (firstErr) return { ok: false, diagnostic: firstErr }
  const secondErr = requireExisting(doc, op.secondNodeId, 'secondNodeId')
  if (secondErr) return { ok: false, diagnostic: secondErr }
  const firstTabErr = rejectIfTabChild(doc, op.firstNodeId, 'firstNodeId')
  if (firstTabErr) return { ok: false, diagnostic: firstTabErr }
  const secondTabErr = rejectIfTabChild(doc, op.secondNodeId, 'secondNodeId')
  if (secondTabErr) return { ok: false, diagnostic: secondTabErr }

  if (op.firstNodeId === op.secondNodeId) {
    // Benign no-op: swapping a node with itself changes nothing STRUCTURALLY.
    // Still routed through finalizeCandidate for a uniform re-validated
    // return shape — but build a FRESH top-level document and nodes map
    // rather than aliasing `doc`/`doc.nodes` directly (design §9.2 Phase 1
    // diff-review r2: passing `doc` itself here made finalizeCandidate's old
    // `deepFreeze` call freeze the CALLER's own input document AND nodes map
    // in place, and `result.doc` was literally `=== doc` — the one operation
    // that skipped the "always return a fresh top-level object" discipline
    // every other branch in this file already follows). Individual UNCHANGED
    // leaf/split node VALUES are still the same references as `doc.nodes[id]`
    // — that part is unavoidable and intentional: it is LAY-002's own
    // reference-preservation contract (an untouched node's identity survives
    // an operation), the same aliasing every REAL structural operation
    // already relies on for its untouched siblings. Since Builder P1
    // hardening finding 2, `finalizeCandidate` no longer freezes those shared
    // references in place either (see `freezeWithoutMutatingOwner`'s doc
    // comment, immutable.ts) — an unfrozen untouched node gets cloned before
    // freezing, so the caller's own object graph is never mutated even if
    // this branch's `{ ...doc.nodes }` still aliases it structurally.
    return finalizeCandidate({ ...doc, nodes: { ...doc.nodes } }, isFaceRegistered, isFaceGridEligible)
  }

  // Reject ancestor/descendant swaps: exchanging a node with its own
  // descendant would nest that node inside what remains of its own former
  // subtree, creating a cycle (LAY-001). Not spelled out verbatim for
  // swap_nodes in design §2.5, but required to preserve the tree invariant —
  // the same containment rule move_node states explicitly.
  //
  // COROLLARY: since the root's subtree is, by definition, the entire
  // document, this containment check ALWAYS rejects a swap where either
  // operand is doc.rootNodeId (unless first === second, handled above as a
  // no-op) — mirroring move_node's explicit LAYOP_CANNOT_MOVE_ROOT rejection
  // for the identical structural reason, without needing a second check.
  //
  // Deliberately out of scope for the r1/r2 mandatory-precondition work
  // (design §2.5 names exactly split_leaf/close_leaf/move_node/
  // replace_descriptor): swap_nodes's existing NODE_NOT_FOUND precondition
  // already gives "a stale target of a deleted node" behavior — a
  // concurrently-relocated (not deleted) node id still resolves to a live
  // node and swapping wherever it CURRENTLY sits is exactly what swap_nodes
  // documents itself as doing (design §2.5: "exchange parent/root
  // references... follow the nodes").
  const firstSubtree = collectSubtreeIds(doc.nodes, op.firstNodeId)
  if (firstSubtree.has(op.secondNodeId)) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAYOP_TARGET_IN_SUBTREE', op.secondNodeId),
    }
  }
  const secondSubtree = collectSubtreeIds(doc.nodes, op.secondNodeId)
  if (secondSubtree.has(op.firstNodeId)) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAYOP_TARGET_IN_SUBTREE', op.firstNodeId),
    }
  }

  const firstLoc = findParentLocation(doc.nodes, doc.rootNodeId, op.firstNodeId)
  const secondLoc = findParentLocation(doc.nodes, doc.rootNodeId, op.secondNodeId)
  // Defense in depth (Builder P1 hardening, recheck): `requireExisting` above
  // already guarantees both ids are genuine OWN entries in `doc.nodes` (via
  // `getOwnNode`'s `Object.hasOwn` guard), and LAY-001 guarantees every entry
  // in a VALID document is reachable from root, so `findParentLocation`
  // should never actually return `null` here. The PREVIOUS version of this
  // function cast that assumption away (`as ParentLocation`) instead of
  // checking it — a forged id that slipped past the old prototype-collision-
  // prone `requireExisting` (e.g. `firstNodeId: 'toString'`) resolved to a
  // genuine `null` here and was then dereferenced on the very next line,
  // throwing `TypeError: Cannot read properties of null (reading 'kind')`.
  // `applyOperation` must never throw for ANY input shape — check explicitly
  // and return a diagnostic instead of casting.
  if (firstLoc === null) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAYOP_NODE_NOT_FOUND', op.firstNodeId, { field: 'firstNodeId' }),
    }
  }
  if (secondLoc === null) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAYOP_NODE_NOT_FOUND', op.secondNodeId, { field: 'secondNodeId' }),
    }
  }

  const nextNodes: Record<string, LayoutNode> = { ...doc.nodes }
  let nextRoot = doc.rootNodeId

  // Wherever firstNodeId sat, secondNodeId now sits.
  if (firstLoc.kind === 'root') {
    nextRoot = op.secondNodeId
  } else if (firstLoc.kind === 'child') {
    const p = nextNodes[firstLoc.splitId] as LayoutSplitNode
    nextNodes[firstLoc.splitId] =
      firstLoc.side === 'start' ? { ...p, startNodeId: op.secondNodeId } : { ...p, endNodeId: op.secondNodeId }
  }
  // Wherever secondNodeId sat, firstNodeId now sits. Read from nextNodes (not
  // doc.nodes) so a shared parent (A and B are siblings under one split) is
  // rewired correctly: the second rewrite sees the first rewrite's result.
  if (secondLoc.kind === 'root') {
    nextRoot = op.firstNodeId
  } else if (secondLoc.kind === 'child') {
    const p = nextNodes[secondLoc.splitId] as LayoutSplitNode
    nextNodes[secondLoc.splitId] =
      secondLoc.side === 'start' ? { ...p, startNodeId: op.firstNodeId } : { ...p, endNodeId: op.firstNodeId }
  }

  const candidate: LayoutDocument = { ...doc, nodes: nextNodes, rootNodeId: nextRoot }
  return finalizeCandidate(candidate, isFaceRegistered, isFaceGridEligible)
}

function moveNode(
  doc: LayoutDocument,
  op: Op<'move_node'>,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): OperationResult {
  const nodeErr = requireExisting(doc, op.nodeId, 'nodeId')
  if (nodeErr) return { ok: false, diagnostic: nodeErr }
  const nodeTabErr = rejectIfTabChild(doc, op.nodeId, 'nodeId')
  if (nodeTabErr) return { ok: false, diagnostic: nodeTabErr }

  if (doc.rootNodeId === op.nodeId) {
    // The root has no parent to detach from (no sibling to promote into its
    // place) — Phase 1 rejects moving the root rather than inventing a
    // parentless-detach special case. See the design-choices note in the
    // handoff for the reasoning.
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAYOP_CANNOT_MOVE_ROOT', op.nodeId),
    }
  }

  const staleErr = checkExpectedParent(doc, op.nodeId, op.expectedParent, 'expectedParent')
  if (staleErr) return { ok: false, diagnostic: staleErr }

  const targetErr = requireKind(doc, op.targetLeafId, 'leaf', 'targetLeafId')
  if (targetErr) return { ok: false, diagnostic: targetErr }
  const targetTabErr = rejectIfTabChild(doc, op.targetLeafId, 'targetLeafId')
  if (targetTabErr) return { ok: false, diagnostic: targetTabErr }

  // r2 (design §9.2 Phase 1 diff-review r2): the SOURCE node's precondition
  // alone is not enough — the TARGET leaf can itself have been concurrently
  // relocated (moved/swapped elsewhere) between the caller's read and this
  // write. Guard it exactly like the source.
  const staleTargetErr = checkExpectedParent(doc, op.targetLeafId, op.expectedTargetParent, 'expectedTargetParent')
  if (staleTargetErr) return { ok: false, diagnostic: staleTargetErr }

  const axisErr = requireEnum(op.axis, ['horizontal', 'vertical'], 'axis')
  if (axisErr) return { ok: false, diagnostic: axisErr }
  const sideErr = requireEnum(op.side, ['start', 'end'], 'side')
  if (sideErr) return { ok: false, diagnostic: sideErr }

  const splitIdErr = requireFreshId(doc, op.splitId, 'splitId')
  if (splitIdErr) return { ok: false, diagnostic: splitIdErr }

  // MUST reject a target inside the moved node's own subtree (design §2.5,
  // and the task's explicit requirement): moving A beside one of A's own
  // descendants would nest A inside itself once the new split is spliced in.
  const subtree = collectSubtreeIds(doc.nodes, op.nodeId)
  if (subtree.has(op.targetLeafId)) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAYOP_TARGET_IN_SUBTREE', op.targetLeafId),
    }
  }

  const ratio = resolveBasisPoints(op.startBasisPoints)
  if (!ratio.ok) return { ok: false, diagnostic: ratio.diagnostic }

  const detached = detachPromoteSibling({ nodes: { ...doc.nodes }, rootNodeId: doc.rootNodeId }, op.nodeId)
  if (!detached) return { ok: false, diagnostic: makeDiagnostic('LAYOP_TAB_CHILD_NOT_RELOCATABLE', op.nodeId, { field: 'nodeId' }) }
  const spliced = spliceBesideLeaf(detached, op.targetLeafId, op.side, op.axis, op.splitId, op.nodeId, ratio.value)
  const candidate: LayoutDocument = { ...doc, nodes: spliced.nodes, rootNodeId: spliced.rootNodeId }
  return finalizeCandidate(candidate, isFaceRegistered, isFaceGridEligible)
}

function wrapInTabs(
  doc: LayoutDocument,
  op: Op<'wrap_in_tabs'>,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): OperationResult {
  const existsErr = requireExisting(doc, op.nodeId, 'nodeId')
  if (existsErr) return { ok: false, diagnostic: existsErr }
  const tabErr = rejectIfTabChild(doc, op.nodeId, 'nodeId')
  if (tabErr) return { ok: false, diagnostic: tabErr }
  const staleErr = checkExpectedParent(doc, op.nodeId, op.expectedParent, 'expectedParent')
  if (staleErr) return { ok: false, diagnostic: staleErr }
  const idErr = requireFreshId(doc, op.tabsId, 'tabsId')
  if (idErr) return { ok: false, diagnostic: idErr }
  if (!isValidTabLabel(op.label)) return { ok: false, diagnostic: makeDiagnostic('LAY001_INVALID_TABS_SHAPE', op.tabsId, { reason: 'bad-label' }) }

  const tabs: LayoutTabsNode = {
    kind: 'tabs',
    id: op.tabsId,
    tabs: [{ nodeId: op.nodeId, label: op.label }],
    activeNodeId: op.nodeId,
    tabsRevision: 0,
  }
  const nextNodes: Record<string, LayoutNode> = { ...doc.nodes, [op.tabsId]: tabs }
  let rootNodeId = doc.rootNodeId
  if (op.expectedParent.kind === 'root') {
    rootNodeId = op.tabsId
  } else if (op.expectedParent.kind === 'child') {
    const parent = nextNodes[op.expectedParent.splitId] as LayoutSplitNode
    nextNodes[op.expectedParent.splitId] =
      op.expectedParent.side === 'start' ? { ...parent, startNodeId: op.tabsId } : { ...parent, endNodeId: op.tabsId }
  }
  return finalizeCandidate({ ...doc, nodes: nextNodes, rootNodeId }, isFaceRegistered, isFaceGridEligible)
}

function tabsAddTab(
  doc: LayoutDocument,
  op: Op<'tabs_add_tab'>,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): OperationResult {
  const tabsErr = requireKind(doc, op.tabsId, 'tabs', 'tabsId')
  if (tabsErr) return { ok: false, diagnostic: tabsErr }
  const existing = getOwnNode(doc.nodes, op.tabsId) as LayoutTabsNode
  if (op.expectedTabsRevision !== existing.tabsRevision) {
    return { ok: false, diagnostic: makeDiagnostic('LAYOP_STALE_TABS_REVISION', op.tabsId, { expected: op.expectedTabsRevision, actual: existing.tabsRevision }) }
  }
  const idErr = requireFreshId(doc, op.newLeafId, 'newLeafId')
  if (idErr) return { ok: false, diagnostic: idErr }
  if (!isValidTabLabel(op.label)) return { ok: false, diagnostic: makeDiagnostic('LAY001_INVALID_TABS_SHAPE', op.tabsId, { reason: 'bad-label' }) }
  const index = op.index ?? existing.tabs.length
  if (!Number.isInteger(index) || index < 0 || index > existing.tabs.length) return { ok: false, diagnostic: malformedOperationDiagnostic('index') }
  if (op.activate !== undefined && typeof op.activate !== 'boolean') return { ok: false, diagnostic: malformedOperationDiagnostic('activate') }
  if (existing.tabs.length >= MAX_TABS) return { ok: false, diagnostic: makeDiagnostic('LAY001_INVALID_TABS_SHAPE', op.tabsId, { reason: 'too-many' }) }
  if (!isWellShapedViewDescriptor(op.descriptor)) return { ok: false, diagnostic: makeDiagnostic('LAY003_INVALID_DESCRIPTOR', op.newLeafId) }
  if (!isFaceRegistered(op.descriptor)) return { ok: false, diagnostic: makeDiagnostic('LAY003_UNREGISTERED_FACE', op.newLeafId, { faceId: op.descriptor.faceId }) }
  const leaf: LayoutLeafNode = { kind: 'leaf', id: op.newLeafId, descriptor: cloneViewDescriptor(op.descriptor), descriptorRevision: 0 }
  const nextTabs = [...existing.tabs]
  nextTabs.splice(index, 0, { nodeId: op.newLeafId, label: op.label })
  const nextTabsNode: LayoutTabsNode = {
    ...existing,
    tabs: nextTabs,
    activeNodeId: op.activate === true ? op.newLeafId : existing.activeNodeId,
    tabsRevision: existing.tabsRevision + 1,
  }
  return finalizeCandidate({ ...doc, nodes: { ...doc.nodes, [op.newLeafId]: leaf, [op.tabsId]: nextTabsNode } }, isFaceRegistered, isFaceGridEligible)
}

function tabsCloseTab(
  doc: LayoutDocument,
  op: Op<'tabs_close_tab'>,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): OperationResult {
  const tabsErr = requireKind(doc, op.tabsId, 'tabs', 'tabsId')
  if (tabsErr) return { ok: false, diagnostic: tabsErr }
  const existing = getOwnNode(doc.nodes, op.tabsId) as LayoutTabsNode
  if (op.expectedTabsRevision !== existing.tabsRevision) {
    return { ok: false, diagnostic: makeDiagnostic('LAYOP_STALE_TABS_REVISION', op.tabsId, { expected: op.expectedTabsRevision, actual: existing.tabsRevision }) }
  }
  const closedIndex = existing.tabs.findIndex((tab) => tab.nodeId === op.nodeId)
  if (closedIndex < 0) return { ok: false, diagnostic: makeDiagnostic('LAYOP_NODE_NOT_FOUND', op.nodeId, { field: 'nodeId' }) }
  const subtreeIds = collectSubtreeIds(doc.nodes, op.nodeId)
  const nextNodes: Record<string, LayoutNode> = { ...doc.nodes }
  if (existing.tabs.length === 1) {
    for (const id of collectSubtreeIds(doc.nodes, op.tabsId)) delete nextNodes[id]
    nextNodes[op.tabsId] = { kind: 'leaf', id: op.tabsId, descriptor: createSophiaHomeDescriptor(), descriptorRevision: 0 }
  } else {
    for (const id of subtreeIds) delete nextNodes[id]
    const nextTabs = existing.tabs.filter((_, index) => index !== closedIndex)
    const activeNodeId = existing.activeNodeId === op.nodeId ? nextTabs[Math.max(0, closedIndex - 1)].nodeId : existing.activeNodeId
    nextNodes[op.tabsId] = { ...existing, tabs: nextTabs, activeNodeId, tabsRevision: existing.tabsRevision + 1 }
  }
  return finalizeCandidate({ ...doc, nodes: nextNodes }, isFaceRegistered, isFaceGridEligible)
}

function tabsSetActive(
  doc: LayoutDocument,
  op: Op<'tabs_set_active'>,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): OperationResult {
  const tabsErr = requireKind(doc, op.tabsId, 'tabs', 'tabsId')
  if (tabsErr) return { ok: false, diagnostic: tabsErr }
  const existing = getOwnNode(doc.nodes, op.tabsId) as LayoutTabsNode
  if (op.expectedTabsRevision !== existing.tabsRevision) {
    return { ok: false, diagnostic: makeDiagnostic('LAYOP_STALE_TABS_REVISION', op.tabsId, { expected: op.expectedTabsRevision, actual: existing.tabsRevision }) }
  }
  if (!existing.tabs.some((tab) => tab.nodeId === op.activeNodeId)) return { ok: false, diagnostic: makeDiagnostic('LAYOP_NODE_NOT_FOUND', op.activeNodeId, { field: 'activeNodeId' }) }
  const nextTabsNode: LayoutTabsNode = { ...existing, activeNodeId: op.activeNodeId, tabsRevision: existing.tabsRevision + 1 }
  return finalizeCandidate({ ...doc, nodes: { ...doc.nodes, [op.tabsId]: nextTabsNode } }, isFaceRegistered, isFaceGridEligible)
}

// ── grid/collection node reducers (Wave 2 x Lane B, design §2.2) ───────────

/**
 * Deep-clone a caller-supplied `GridChildrenSource` before it is EVER
 * embedded in a stored grid node — the exact same rationale as
 * `cloneViewDescriptor` above (the caller's original object must never stay
 * reachable from the returned document). `GridChildrenSource` is plain
 * JSON-shaped data throughout (a `ResourceLocator`/`ViewDescriptor`/string
 * map, recursively), so the same generic `deepCloneJsonValue` machinery
 * applies unchanged. Only ever called after `isWellShapedGridChildrenSource`
 * has already passed, mirroring `cloneViewDescriptor`'s own precondition.
 */
function cloneGridChildrenSource(children: GridChildrenSource): GridChildrenSource {
  return deepCloneJsonValue(children)
}

/**
 * Check face registration + grid-eligibility for one `GridChildrenSource` —
 * every fixed cell's descriptor, or a collection source's bare `itemFaceId`
 * (design §2.1's "cell persistence rule" — see `FaceGridEligibilityPredicate`'s
 * doc comment, validate.ts). Mirrors `splitLeaf`/`replaceDescriptor`'s own
 * `isWellShapedViewDescriptor` -> `isFaceRegistered` two-step, generalized to
 * a grid's (potentially many) cells, and reused verbatim by
 * `insertGrid`/`gridSetCells`/`gridBindCollection` — an early, specific
 * diagnostic here, with `finalizeCandidate`'s full `validateLayoutDocument`
 * pass still the final authority (defense in depth, same discipline as every
 * other reducer in this file).
 */
function checkGridChildrenFaces(
  children: GridChildrenSource,
  gridId: string,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): Diagnostic | null {
  if (children.kind === 'fixed') {
    for (const cell of children.cells) {
      if (!isFaceRegistered(cell.descriptor)) {
        return makeDiagnostic('LAY003_UNREGISTERED_FACE', cell.id, { faceId: cell.descriptor.faceId })
      }
      if (!isFaceGridEligible(cell.descriptor.faceId)) {
        return makeDiagnostic('LAY003_CELL_FACE_NOT_GRID_ELIGIBLE', cell.id, { faceId: cell.descriptor.faceId })
      }
    }
    return null
  }
  // Collection source: only a bare faceId exists pre-render (design §2.1 —
  // "the document stores only the binding"); full registration of
  // itemFaceId against a concrete descriptor is deferred to the runtime
  // layer, once a real resource+row exist (mirrors validate.ts's per-node
  // grid branch exactly).
  if (!isFaceGridEligible(children.itemFaceId)) {
    return makeDiagnostic('LAY003_CELL_FACE_NOT_GRID_ELIGIBLE', gridId, { faceId: children.itemFaceId })
  }
  return null
}

/**
 * The closed, exact key set a caller-supplied `GridConfig` payload admits
 * (`insert_grid`'s own `gridConfig` field) — mirrors `OPERATION_KEYS`'s
 * top-level discipline one layer deeper. `decodeOperation`'s
 * `REQUIRED_OBJECT_FIELDS` gate only proves `gridConfig` is A PLAIN OBJECT
 * before any reducer runs; it says nothing about which keys that object
 * carries. Without this check, `insertGrid` below reads only
 * `.flow`/`.minCellWidth`/`.children` by name, so an extra key (e.g. a
 * forged `gridConfig.gridRevision` trying to seed a non-zero starting
 * revision, or simple caller error) was silently DISCARDED rather than
 * REJECTED — every other operation payload in this file closes its own key
 * set (`OPERATION_KEYS`) before a single field is read; `gridConfig` is not
 * exempt from that same discipline merely for being one level deeper.
 */
const GRID_CONFIG_KEYS = ['flow', 'minCellWidth', 'children'] as const

/**
 * `insert_grid` — like `split_leaf`, but the spliced-in node is a `grid`
 * (design §2.2's op table). `targetLeafId` must be an existing LEAF (same
 * constraint `split_leaf`/`move_node`'s target already carries — v1 does not
 * support splitting beside an existing grid, only beside a leaf); the new
 * grid's own id becomes legal to reference (as a split child, or later as
 * root) the moment this returns.
 */
function insertGrid(
  doc: LayoutDocument,
  op: Op<'insert_grid'>,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): OperationResult {
  const targetErr = requireKind(doc, op.targetLeafId, 'leaf', 'targetLeafId')
  if (targetErr) return { ok: false, diagnostic: targetErr }

  const staleErr = checkExpectedParent(doc, op.targetLeafId, op.expectedParent, 'expectedParent')
  if (staleErr) return { ok: false, diagnostic: staleErr }

  const axisErr = requireEnum(op.axis, ['horizontal', 'vertical'], 'axis')
  if (axisErr) return { ok: false, diagnostic: axisErr }
  const sideErr = requireEnum(op.side, ['start', 'end'], 'side')
  if (sideErr) return { ok: false, diagnostic: sideErr }

  const gridIdErr = requireFreshId(doc, op.gridId, 'gridId')
  if (gridIdErr) return { ok: false, diagnostic: gridIdErr }
  const splitIdErr = requireFreshId(doc, op.splitId, 'splitId')
  if (splitIdErr) return { ok: false, diagnostic: splitIdErr }
  if (op.gridId === op.splitId) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAYOP_ID_COLLISION', op.gridId, { field: 'splitId' }),
    }
  }

  // `op.gridConfig` is concretely typed as `GridConfig` (no index signature)
  // by this point, unlike every other `hasNoUnknownKeys` call site in this
  // file (which all still hold an `unknown`/`Record<string, unknown>` from
  // `decodeOperation`'s own `raw` payload) — the cast is safe because
  // `hasNoUnknownKeys` only ever reads `Object.keys(value)`.
  if (!hasNoUnknownKeys(op.gridConfig as unknown as Record<string, unknown>, GRID_CONFIG_KEYS)) {
    return { ok: false, diagnostic: malformedOperationDiagnostic('gridConfig') }
  }

  const flowErr = requireEnum(op.gridConfig.flow, GRID_FLOWS, 'flow')
  if (flowErr) return { ok: false, diagnostic: flowErr }
  if (!isValidMinCellWidth(op.gridConfig.minCellWidth)) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAY001_INVALID_MIN_CELL_WIDTH', op.gridId, {
        actualType: typeof op.gridConfig.minCellWidth,
      }),
    }
  }
  if (!isWellShapedGridChildrenSource(op.gridConfig.children)) {
    return { ok: false, diagnostic: makeDiagnostic('LAY001_INVALID_GRID_CHILDREN_SHAPE', op.gridId) }
  }
  const faceErr = checkGridChildrenFaces(op.gridConfig.children, op.gridId, isFaceRegistered, isFaceGridEligible)
  if (faceErr) return { ok: false, diagnostic: faceErr }

  const ratio = resolveBasisPoints(op.startBasisPoints)
  if (!ratio.ok) return { ok: false, diagnostic: ratio.diagnostic }

  const newGrid: LayoutGridNode = {
    kind: 'grid',
    id: op.gridId,
    flow: op.gridConfig.flow,
    minCellWidth: op.gridConfig.minCellWidth,
    children: cloneGridChildrenSource(op.gridConfig.children),
    gridRevision: 0,
  }
  const working: WorkingTree = {
    nodes: { ...doc.nodes, [op.gridId]: newGrid },
    rootNodeId: doc.rootNodeId,
  }
  const spliced = spliceBesideLeaf(working, op.targetLeafId, op.side, op.axis, op.splitId, op.gridId, ratio.value)
  const candidate: LayoutDocument = { ...doc, nodes: spliced.nodes, rootNodeId: spliced.rootNodeId }
  return finalizeCandidate(candidate, isFaceRegistered, isFaceGridEligible)
}

/**
 * `close_node` — generalizes `close_leaf` to ANY node id: a leaf, a grid, or
 * an entire split subtree (design §2.2's op table). `close_leaf` itself is
 * untouched (still leaf-only) — this is a strict ADDITIVE generalization,
 * not a replacement.
 *
 * Non-root case: disposes `op.nodeId`'s ENTIRE subtree (one id for a
 * leaf/grid, many for a split — `collectSubtreeIds`), promoting its sibling
 * exactly like `close_leaf`'s non-root branch (which is the leaf-subtree
 * special case of this same operation: a leaf's "subtree" is always just
 * itself).
 *
 * Root case (LAY-010 home-fallback, preserved and generalized): closing the
 * document's OWN root — of any kind — never empties the document. When the
 * root is already a leaf this is byte-identical to `close_leaf`'s existing
 * root branch (continues that leaf's own descriptorRevision lineage). When
 * the root is a grid or a split, the ENTIRE tree (by LAY-001, a valid
 * document's root subtree IS the whole `nodes` map) collapses to one fresh
 * `sophia.home` leaf at the same id — there is no prior LEAF descriptor
 * revision to continue, so the fresh leaf starts at revision 0, exactly like
 * any other freshly-minted leaf (`split_leaf`'s `newLeaf`).
 */
function closeNode(
  doc: LayoutDocument,
  op: Op<'close_node'>,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): OperationResult {
  const existsErr = requireExisting(doc, op.nodeId, 'nodeId')
  if (existsErr) return { ok: false, diagnostic: existsErr }
  const tabErr = rejectIfTabChild(doc, op.nodeId, 'nodeId')
  if (tabErr) return { ok: false, diagnostic: tabErr }

  const staleErr = checkExpectedParent(doc, op.nodeId, op.expectedParent, 'expectedParent')
  if (staleErr) return { ok: false, diagnostic: staleErr }

  if (doc.rootNodeId === op.nodeId) {
    const existing = getOwnNode(doc.nodes, op.nodeId) as LayoutNode
    const homeLeaf: LayoutLeafNode = {
      kind: 'leaf',
      id: op.nodeId,
      descriptor: createSophiaHomeDescriptor(),
      descriptorRevision: existing.kind === 'leaf' ? existing.descriptorRevision + 1 : 0,
    }
    // The root's own subtree is, by LAY-001, the ENTIRE document — every
    // other entry in doc.nodes (if any: a split or grid root may have had
    // many descendants) is discarded along with it, not just op.nodeId.
    const nextNodes: Record<string, LayoutNode> = { [op.nodeId]: homeLeaf }
    const candidate: LayoutDocument = { ...doc, nodes: nextNodes, rootNodeId: op.nodeId }
    return finalizeCandidate(candidate, isFaceRegistered, isFaceGridEligible)
  }

  const working: WorkingTree = { nodes: { ...doc.nodes }, rootNodeId: doc.rootNodeId }
  const subtreeIds = collectSubtreeIds(doc.nodes, op.nodeId)
  const promoted = detachPromoteSibling(working, op.nodeId)
  if (!promoted) return { ok: false, diagnostic: makeDiagnostic('LAYOP_TAB_CHILD_NOT_RELOCATABLE', op.nodeId, { field: 'nodeId' }) }
  const nextNodes: Record<string, LayoutNode> = { ...promoted.nodes }
  for (const id of subtreeIds) delete nextNodes[id]
  const candidate: LayoutDocument = { ...doc, nodes: nextNodes, rootNodeId: promoted.rootNodeId }
  return finalizeCandidate(candidate, isFaceRegistered, isFaceGridEligible)
}

/** `grid_set_cells` — whole-`cells` replacement (fixed source), staleness-gated on `gridRevision`. */
function gridSetCells(
  doc: LayoutDocument,
  op: Op<'grid_set_cells'>,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): OperationResult {
  const gridErr = requireKind(doc, op.gridId, 'grid', 'gridId')
  if (gridErr) return { ok: false, diagnostic: gridErr }

  const existing = getOwnNode(doc.nodes, op.gridId) as LayoutGridNode
  if (op.expectedGridRevision !== existing.gridRevision) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAYOP_STALE_GRID_REVISION', op.gridId, {
        expected: op.expectedGridRevision,
        actual: existing.gridRevision,
      }),
    }
  }

  const candidateChildren: GridChildrenSource = { kind: 'fixed', cells: op.cells }
  if (!isWellShapedGridChildrenSource(candidateChildren)) {
    return { ok: false, diagnostic: makeDiagnostic('LAY001_INVALID_GRID_CHILDREN_SHAPE', op.gridId) }
  }
  const faceErr = checkGridChildrenFaces(candidateChildren, op.gridId, isFaceRegistered, isFaceGridEligible)
  if (faceErr) return { ok: false, diagnostic: faceErr }

  const nextGrid: LayoutGridNode = {
    ...existing,
    children: cloneGridChildrenSource(candidateChildren),
    gridRevision: existing.gridRevision + 1,
  }
  const nextNodes = { ...doc.nodes, [op.gridId]: nextGrid }
  const candidate: LayoutDocument = { ...doc, nodes: nextNodes }
  return finalizeCandidate(candidate, isFaceRegistered, isFaceGridEligible)
}

/** `grid_bind_collection` — set/replace the collection binding; also flips the source kind to `'collection'`. */
function gridBindCollection(
  doc: LayoutDocument,
  op: Op<'grid_bind_collection'>,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): OperationResult {
  const gridErr = requireKind(doc, op.gridId, 'grid', 'gridId')
  if (gridErr) return { ok: false, diagnostic: gridErr }

  const existing = getOwnNode(doc.nodes, op.gridId) as LayoutGridNode
  if (op.expectedGridRevision !== existing.gridRevision) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAYOP_STALE_GRID_REVISION', op.gridId, {
        expected: op.expectedGridRevision,
        actual: existing.gridRevision,
      }),
    }
  }

  const candidateChildren: GridChildrenSource = {
    kind: 'collection',
    collection: op.collection,
    itemFaceId: op.itemFaceId,
    ...(op.itemParams !== undefined ? { itemParams: op.itemParams } : {}),
    maxItems: op.maxItems,
    ...(op.refreshSeconds !== undefined ? { refreshSeconds: op.refreshSeconds } : {}),
  }
  if (!isWellShapedGridChildrenSource(candidateChildren)) {
    return { ok: false, diagnostic: makeDiagnostic('LAY001_INVALID_GRID_CHILDREN_SHAPE', op.gridId) }
  }
  const faceErr = checkGridChildrenFaces(candidateChildren, op.gridId, isFaceRegistered, isFaceGridEligible)
  if (faceErr) return { ok: false, diagnostic: faceErr }

  const nextGrid: LayoutGridNode = {
    ...existing,
    children: cloneGridChildrenSource(candidateChildren),
    gridRevision: existing.gridRevision + 1,
  }
  const nextNodes = { ...doc.nodes, [op.gridId]: nextGrid }
  const candidate: LayoutDocument = { ...doc, nodes: nextNodes }
  return finalizeCandidate(candidate, isFaceRegistered, isFaceGridEligible)
}

/** `grid_set_flow` — `flow` + `minCellWidth`, staleness-gated on `gridRevision`. */
function gridSetFlow(
  doc: LayoutDocument,
  op: Op<'grid_set_flow'>,
  isFaceRegistered: FaceRegistrationPredicate,
  isFaceGridEligible: FaceGridEligibilityPredicate,
): OperationResult {
  const gridErr = requireKind(doc, op.gridId, 'grid', 'gridId')
  if (gridErr) return { ok: false, diagnostic: gridErr }

  const existing = getOwnNode(doc.nodes, op.gridId) as LayoutGridNode
  if (op.expectedGridRevision !== existing.gridRevision) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAYOP_STALE_GRID_REVISION', op.gridId, {
        expected: op.expectedGridRevision,
        actual: existing.gridRevision,
      }),
    }
  }

  const flowErr = requireEnum(op.flow, GRID_FLOWS, 'flow')
  if (flowErr) return { ok: false, diagnostic: flowErr }
  if (!isValidMinCellWidth(op.minCellWidth)) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAY001_INVALID_MIN_CELL_WIDTH', op.gridId, {
        actualType: typeof op.minCellWidth,
      }),
    }
  }

  const nextGrid: LayoutGridNode = { ...existing, flow: op.flow, minCellWidth: op.minCellWidth, gridRevision: existing.gridRevision + 1 }
  const nextNodes = { ...doc.nodes, [op.gridId]: nextGrid }
  const candidate: LayoutDocument = { ...doc, nodes: nextNodes }
  return finalizeCandidate(candidate, isFaceRegistered, isFaceGridEligible)
}

// ── the closed union decoder (design §9.2 Phase 1 diff-review r2) ──────────

/** The closed, exact key set each operation shape admits (mirrors the union above). */
const OPERATION_KEYS: Readonly<Record<LayoutOperation['op'], readonly string[]>> = {
  split_leaf: ['op', 'leafId', 'axis', 'side', 'newLeafId', 'splitId', 'descriptor', 'startBasisPoints', 'expectedParent'],
  close_leaf: ['op', 'leafId', 'expectedParent'],
  set_ratio: ['op', 'splitId', 'startBasisPoints'],
  replace_descriptor: ['op', 'leafId', 'descriptor', 'expectedDescriptorRevision'],
  swap_nodes: ['op', 'firstNodeId', 'secondNodeId'],
  move_node: ['op', 'nodeId', 'targetLeafId', 'side', 'axis', 'splitId', 'startBasisPoints', 'expectedParent', 'expectedTargetParent'],
  insert_grid: ['op', 'targetLeafId', 'axis', 'side', 'splitId', 'gridId', 'gridConfig', 'startBasisPoints', 'expectedParent'],
  close_node: ['op', 'nodeId', 'expectedParent'],
  grid_set_cells: ['op', 'gridId', 'cells', 'expectedGridRevision'],
  grid_bind_collection: [
    'op',
    'gridId',
    'collection',
    'itemFaceId',
    'itemParams',
    'maxItems',
    'refreshSeconds',
    'expectedGridRevision',
  ],
  grid_set_flow: ['op', 'gridId', 'flow', 'minCellWidth', 'expectedGridRevision'],
  wrap_in_tabs: ['op', 'nodeId', 'tabsId', 'label', 'expectedParent'],
  tabs_add_tab: ['op', 'tabsId', 'newLeafId', 'descriptor', 'label', 'index', 'activate', 'expectedTabsRevision'],
  tabs_close_tab: ['op', 'tabsId', 'nodeId', 'expectedTabsRevision'],
  tabs_set_active: ['op', 'tabsId', 'activeNodeId', 'expectedTabsRevision'],
}

const KNOWN_OPERATIONS: ReadonlySet<LayoutOperation['op']> = new Set(
  Object.keys(OPERATION_KEYS) as readonly LayoutOperation['op'][],
)

/**
 * Per-op-type ID-shaped fields that MUST be a non-empty string before ANY
 * reducer runs (Builder P1 hardening finding 1, r4 — see this file's
 * header). `hasNoUnknownKeys` above only proves the operation carries no
 * EXTRA key; it says nothing about whether a MANDATORY key is present or
 * correctly typed. A JSON-shaped operation with e.g. `leafId: null` (a
 * perfectly valid JSON value at that key) previously reached a reducer's
 * `requireKind`/`requireExisting`/`requireFreshId` helper unchecked, which
 * handed the non-string straight to `makeDiagnostic`'s `nodeId` parameter —
 * `diagnostics.ts`'s `tokenizeId` called `.length` on it, which THROWS for
 * `null` (`applyOperation` is documented to NEVER throw for ANY JSON-shaped
 * input — design §9.2 Phase 1 diff-review r2's whole point). A field that is
 * entirely MISSING (`undefined`) is caught by the same check (`typeof
 * undefined !== 'string'`), so it is rejected here as malformed rather than
 * silently reaching a reducer and being misdiagnosed under some other code
 * (e.g. `LAYOP_NODE_NOT_FOUND` for a field that was never supplied at all).
 * Every id this union ever dispatches on is checked here, uniformly, BEFORE
 * the switch below ever reaches a reducer.
 */
const REQUIRED_ID_FIELDS: Readonly<Record<LayoutOperation['op'], readonly string[]>> = {
  split_leaf: ['leafId', 'newLeafId', 'splitId'],
  close_leaf: ['leafId'],
  set_ratio: ['splitId'],
  replace_descriptor: ['leafId'],
  swap_nodes: ['firstNodeId', 'secondNodeId'],
  move_node: ['nodeId', 'targetLeafId', 'splitId'],
  insert_grid: ['targetLeafId', 'splitId', 'gridId'],
  close_node: ['nodeId'],
  grid_set_cells: ['gridId'],
  grid_bind_collection: ['gridId', 'itemFaceId'],
  grid_set_flow: ['gridId'],
  wrap_in_tabs: ['nodeId', 'tabsId'],
  tabs_add_tab: ['tabsId', 'newLeafId'],
  tabs_close_tab: ['tabsId', 'nodeId'],
  tabs_set_active: ['tabsId', 'activeNodeId'],
}

/**
 * Per-op-type fields that MUST be a string. Legal ENUM MEMBERSHIP (`axis`
 * being exactly `'horizontal'|'vertical'`) stays each reducer's OWN
 * `requireEnum` check, which already safely reports `LAYOP_INVALID_ENUM` for
 * a wrong-but-string value such as `'diagonal'` without ever throwing — only
 * the TYPE is decoded here. A non-string (missing, `null`, a number, an
 * object, …) is malformed, not merely an illegal enum member, so it is
 * rejected before dispatch instead.
 */
const REQUIRED_ENUM_STRING_FIELDS: Readonly<Record<LayoutOperation['op'], readonly string[]>> = {
  split_leaf: ['axis', 'side'],
  close_leaf: [],
  set_ratio: [],
  replace_descriptor: [],
  swap_nodes: [],
  move_node: ['axis', 'side'],
  insert_grid: ['axis', 'side'],
  close_node: [],
  grid_set_cells: [],
  grid_bind_collection: [],
  // `flow`'s legal MEMBERSHIP ('reflow'|'stack') stays gridSetFlow's own
  // `requireEnum` check (mirrors axis/side) — only the TYPE is decoded here.
  grid_set_flow: ['flow'],
  wrap_in_tabs: ['label'],
  tabs_add_tab: ['label'],
  tabs_close_tab: [],
  tabs_set_active: [],
}

/**
 * Per-op-type fields whose value MUST be a plain object before ANY reducer
 * runs — currently only `descriptor` (`split_leaf`/`replace_descriptor`; the
 * union's type declares it mandatory, never `descriptor?:`). Builder P1
 * hardening (recheck): `decodeOperation` previously let `descriptor` reach
 * the reducer entirely undecoded, so an ENTIRELY MISSING (or `null`, or any
 * other non-plain-object) descriptor was diagnosed as `LAY003_INVALID_DESCRIPTOR`
 * by `isWellShapedViewDescriptor` deep inside the reducer — the SAME code a
 * genuinely PRESENT-but-invalid-content descriptor gets (e.g. `{schemaVersion:
 * 1, faceId: '', resource: {...}}`), making the two indistinguishable. This
 * check only proves the field is well-TYPED (a plain object) before dispatch,
 * mirroring `REQUIRED_ENUM_STRING_FIELDS`'s type-only split — a present plain
 * object with invalid CONTENT still falls through to the reducer's own
 * `isWellShapedViewDescriptor` check and keeps its `LAY003_INVALID_DESCRIPTOR`
 * diagnostic; only a missing/wrong-typed descriptor becomes
 * `LAYOP_MALFORMED_OPERATION` here.
 */
const REQUIRED_OBJECT_FIELDS: Readonly<Record<LayoutOperation['op'], readonly string[]>> = {
  split_leaf: ['descriptor'],
  close_leaf: [],
  set_ratio: [],
  replace_descriptor: ['descriptor'],
  swap_nodes: [],
  move_node: [],
  insert_grid: ['gridConfig'],
  close_node: [],
  grid_set_cells: [],
  grid_bind_collection: ['collection'],
  grid_set_flow: [],
  wrap_in_tabs: [],
  tabs_add_tab: ['descriptor'],
  tabs_close_tab: [],
  tabs_set_active: [],
}

/**
 * Per-op-type fields whose value MUST be a `number` before ANY reducer runs —
 * currently only `set_ratio.startBasisPoints`, the ONE op where this field is
 * mandatory (`split_leaf`/`move_node`'s `startBasisPoints` stay optional: a
 * caller happy with the 50/50 default never sets them, but `set_ratio`'s
 * entire purpose is to set an explicit ratio, so its type omits the `?`).
 * Builder P1 hardening (recheck): omitting the field previously reached
 * `resolveBasisPoints`, whose `undefined` branch is deliberately the
 * OPTIONAL-field default path — `set_ratio` silently wrote the default 5000
 * instead of being rejected as malformed. Legal RANGE/finiteness stays
 * `resolveBasisPoints`'s job (`LAYOP_INVALID_RATIO_INPUT`); only the
 * mandatory-field TYPE is decoded here.
 */
const REQUIRED_NUMBER_FIELDS: Readonly<Record<LayoutOperation['op'], readonly string[]>> = {
  split_leaf: [],
  close_leaf: [],
  set_ratio: ['startBasisPoints'],
  replace_descriptor: [],
  swap_nodes: [],
  move_node: [],
  insert_grid: [],
  close_node: [],
  grid_set_cells: [],
  grid_bind_collection: ['maxItems'],
  grid_set_flow: ['minCellWidth'],
  wrap_in_tabs: [],
  tabs_add_tab: [],
  tabs_close_tab: [],
  tabs_set_active: [],
}

/**
 * Per-op-type fields whose value MUST be a genuine array before ANY reducer
 * runs — currently only `grid_set_cells.cells` (the union's type declares it
 * mandatory, `readonly GridCell[]`, never optional). Mirrors
 * `REQUIRED_OBJECT_FIELDS`'s type-only split: this only proves the field is
 * an ARRAY before dispatch; per-element shape (`isWellShapedGridCell`) and
 * closedness (`isClosedArray`) stay `gridSetCells`'s own
 * `isWellShapedGridChildrenSource` check, exactly like `descriptor`'s deeper
 * content check stays inside its reducer.
 */
const REQUIRED_ARRAY_FIELDS: Readonly<Record<LayoutOperation['op'], readonly string[]>> = {
  split_leaf: [],
  close_leaf: [],
  set_ratio: [],
  replace_descriptor: [],
  swap_nodes: [],
  move_node: [],
  insert_grid: [],
  close_node: [],
  grid_set_cells: ['cells'],
  grid_bind_collection: [],
  grid_set_flow: [],
  wrap_in_tabs: [],
  tabs_add_tab: [],
  tabs_close_tab: [],
  tabs_set_active: [],
}

function isNonEmptyStringField(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

const PARENT_LOCATION_ROOT_KEYS = ['kind'] as const
const PARENT_LOCATION_CHILD_KEYS = ['kind', 'splitId', 'side'] as const
const PARENT_LOCATION_TAB_KEYS = ['kind', 'tabsId', 'index'] as const

/**
 * Exact, non-throwing shape check for one `ParentLocation` — used both to
 * decode a caller-supplied precondition and (indirectly, via the same
 * function) to keep `checkExpectedParent` from ever being handed something
 * that isn't actually a `{kind:'root'}` / `{kind:'child',...}` shape. Never
 * throws for ANY input (design §9.2 Phase 1 diff-review r2: a bare
 * `expectedParent.kind` access on a forged `null`/primitive/array threw in
 * r1 — this is the fix).
 */
function isWellShapedParentLocation(value: unknown): value is ParentLocation {
  if (!isPlainObject(value)) return false
  if (value.kind === 'root') return hasNoUnknownKeys(value, PARENT_LOCATION_ROOT_KEYS)
  if (value.kind === 'child') {
    return (
      hasNoUnknownKeys(value, PARENT_LOCATION_CHILD_KEYS) &&
      typeof value.splitId === 'string' &&
      value.splitId.length > 0 &&
      (value.side === 'start' || value.side === 'end')
    )
  }
  if (value.kind === 'tab') {
    return hasNoUnknownKeys(value, PARENT_LOCATION_TAB_KEYS) && typeof value.tabsId === 'string' && value.tabsId.length > 0 && typeof value.index === 'number' && Number.isInteger(value.index) && value.index >= 0
  }
  return false
}

/**
 * Build a `LAYOP_MALFORMED_OPERATION` diagnostic naming which field of the
 * closed operation shape failed to decode. `field` is always one of a small,
 * code-controlled enum (a key name from `OPERATION_KEYS`/a precondition field
 * name) — never raw caller content.
 */
function malformedOperationDiagnostic(field: string): Diagnostic {
  return makeDiagnostic('LAYOP_MALFORMED_OPERATION', undefined, {
    field,
  })
}

export type DecodeResult =
  | { readonly ok: true; readonly op: LayoutOperation }
  | { readonly ok: false; readonly diagnostic: Diagnostic }

/**
 * Reduce a forged/unknown operation discriminant to a coarse, NEVER-ECHOED
 * token safe to embed in a diagnostic. r1 truncated-and-regex-gated the raw
 * string through — but a secret-shaped string that happens to match
 * `[\w.-]+` (a very common shape for API-key-like secrets, e.g.
 * `sk-...-1234567890`) passed the regex and was embedded verbatim (design
 * §9.2 Phase 1 diff-review r2's probe). This version echoes ONLY the
 * discriminant's `typeof` — never any of its content, any length, any shape.
 */
function sanitizeOperationDiscriminant(value: unknown): string {
  return typeof value
}

/**
 * The single, TOTAL, NEVER-THROWING gate every `LayoutOperation` crosses
 * before any reducer touches the document (design §9.2 Phase 1 diff-review
 * r2). Two jobs:
 *
 *   1. Reject anything that is not a plain object with a known `op`
 *      discriminant and the EXACT key set that discriminant's shape admits
 *      (closed-by-shape, same discipline as `isWellShapedViewDescriptor`).
 *   2. Reject a MISSING or MALFORMED mandatory precondition
 *      (`expectedParent` / `expectedTargetParent` / `expectedDescriptorRevision`)
 *      BEFORE any reducer's `checkExpectedParent`/revision comparison ever
 *      runs — this is what makes `applyOperation(doc, null)`,
 *      `applyOperation(doc, undefined)`, and `{op:'split_leaf', ...,
 *      expectedParent: null}` all return a diagnostic instead of throwing.
 *
 * Every OTHER field (leafId/axis/side/descriptor/ratio legality, existence,
 * freshness, …) keeps its EXISTING reducer-level check — those were already
 * total (bracket lookups and `.includes()` never throw), so re-validating
 * them here would be pure duplication.
 */
function decodeOperation(raw: unknown): DecodeResult {
  if (!isPlainObject(raw)) {
    return { ok: false, diagnostic: malformedOperationDiagnostic('operation') }
  }
  if (typeof raw.op !== 'string' || !KNOWN_OPERATIONS.has(raw.op as LayoutOperation['op'])) {
    return {
      ok: false,
      diagnostic: makeDiagnostic('LAYOP_UNKNOWN_OPERATION', undefined, {
        discriminantType: sanitizeOperationDiscriminant(raw.op),
      }),
    }
  }
  const opName = raw.op as LayoutOperation['op']
  if (!hasNoUnknownKeys(raw, OPERATION_KEYS[opName])) {
    return { ok: false, diagnostic: malformedOperationDiagnostic('op') }
  }

  // Fully decode every mandatory field's TYPE before any reducer ever runs
  // (Builder P1 hardening finding 1, r4 — see `REQUIRED_ID_FIELDS`'s doc
  // comment above). This is what makes `leafId: null`, a missing `nodeId`,
  // or any other wrong-typed/absent mandatory field a `LAYOP_MALFORMED_OPERATION`
  // diagnostic instead of a crash or a misleading diagnostic several layers
  // deeper.
  for (const field of REQUIRED_ID_FIELDS[opName]) {
    if (!isNonEmptyStringField(raw[field])) {
      return { ok: false, diagnostic: malformedOperationDiagnostic(field) }
    }
  }
  for (const field of REQUIRED_ENUM_STRING_FIELDS[opName]) {
    if (typeof raw[field] !== 'string') {
      return { ok: false, diagnostic: malformedOperationDiagnostic(field) }
    }
  }
  for (const field of REQUIRED_OBJECT_FIELDS[opName]) {
    if (!isPlainObject(raw[field])) {
      return { ok: false, diagnostic: malformedOperationDiagnostic(field) }
    }
  }
  for (const field of REQUIRED_NUMBER_FIELDS[opName]) {
    if (typeof raw[field] !== 'number') {
      return { ok: false, diagnostic: malformedOperationDiagnostic(field) }
    }
  }
  for (const field of REQUIRED_ARRAY_FIELDS[opName]) {
    if (!Array.isArray(raw[field])) {
      return { ok: false, diagnostic: malformedOperationDiagnostic(field) }
    }
  }

  switch (opName) {
    case 'split_leaf':
    case 'close_leaf':
    case 'insert_grid':
    case 'close_node':
    case 'wrap_in_tabs':
      if (!isWellShapedParentLocation(raw.expectedParent)) {
        return { ok: false, diagnostic: malformedOperationDiagnostic('expectedParent') }
      }
      break
    case 'move_node':
      if (!isWellShapedParentLocation(raw.expectedParent)) {
        return { ok: false, diagnostic: malformedOperationDiagnostic('expectedParent') }
      }
      if (!isWellShapedParentLocation(raw.expectedTargetParent)) {
        return { ok: false, diagnostic: malformedOperationDiagnostic('expectedTargetParent') }
      }
      break
    case 'replace_descriptor':
      if (!isValidDescriptorRevision(raw.expectedDescriptorRevision)) {
        return { ok: false, diagnostic: malformedOperationDiagnostic('expectedDescriptorRevision') }
      }
      break
    case 'grid_set_cells':
    case 'grid_bind_collection':
    case 'grid_set_flow':
      if (!isValidGridRevision(raw.expectedGridRevision)) {
        return { ok: false, diagnostic: malformedOperationDiagnostic('expectedGridRevision') }
      }
      break
    case 'tabs_add_tab':
    case 'tabs_close_tab':
    case 'tabs_set_active':
      if (!isValidTabsRevision(raw.expectedTabsRevision)) {
        return { ok: false, diagnostic: malformedOperationDiagnostic('expectedTabsRevision') }
      }
      break
    case 'set_ratio':
    case 'swap_nodes':
      break
  }

  return { ok: true, op: raw as unknown as LayoutOperation }
}

// ── the single public entry point ───────────────────────────────────────────

/**
 * Apply ONE `LayoutOperation` to a valid `LayoutDocument`. Returns the new
 * valid, deep-frozen document, or a diagnostic — never a half-mutated doc,
 * and NEVER throws for ANY input shape (see `decodeOperation`'s header —
 * design §9.2 Phase 1 diff-review r2 widens this guarantee beyond the single
 * forged-discriminant shape r1's test covered). `options` carries the same
 * pluggable face-registration predicate `validate.ts` uses (default: Phase
 * 1's own mandatory allow-list); pass the real P2 registry's predicate once
 * one exists.
 */
export function applyOperation(
  doc: LayoutDocument,
  op: LayoutOperation,
  options?: ValidateOptions,
): OperationResult {
  const isFaceRegistered = options?.isFaceRegistered ?? defaultFaceRegistrationPredicate
  const isFaceGridEligible = options?.isFaceGridEligible ?? defaultFaceGridEligibilityPredicate
  const decoded = decodeOperation(op)
  if (!decoded.ok) return { ok: false, diagnostic: decoded.diagnostic }
  const safeOp = decoded.op
  switch (safeOp.op) {
    case 'split_leaf':
      return splitLeaf(doc, safeOp, isFaceRegistered, isFaceGridEligible)
    case 'close_leaf':
      return closeLeaf(doc, safeOp, isFaceRegistered, isFaceGridEligible)
    case 'set_ratio':
      return setRatio(doc, safeOp, isFaceRegistered, isFaceGridEligible)
    case 'replace_descriptor':
      return replaceDescriptor(doc, safeOp, isFaceRegistered, isFaceGridEligible)
    case 'swap_nodes':
      return swapNodes(doc, safeOp, isFaceRegistered, isFaceGridEligible)
    case 'move_node':
      return moveNode(doc, safeOp, isFaceRegistered, isFaceGridEligible)
    case 'insert_grid':
      return insertGrid(doc, safeOp, isFaceRegistered, isFaceGridEligible)
    case 'close_node':
      return closeNode(doc, safeOp, isFaceRegistered, isFaceGridEligible)
    case 'wrap_in_tabs':
      return wrapInTabs(doc, safeOp, isFaceRegistered, isFaceGridEligible)
    case 'tabs_add_tab':
      return tabsAddTab(doc, safeOp, isFaceRegistered, isFaceGridEligible)
    case 'tabs_close_tab':
      return tabsCloseTab(doc, safeOp, isFaceRegistered, isFaceGridEligible)
    case 'tabs_set_active':
      return tabsSetActive(doc, safeOp, isFaceRegistered, isFaceGridEligible)
    case 'grid_set_cells':
      return gridSetCells(doc, safeOp, isFaceRegistered, isFaceGridEligible)
    case 'grid_bind_collection':
      return gridBindCollection(doc, safeOp, isFaceRegistered, isFaceGridEligible)
    case 'grid_set_flow':
      return gridSetFlow(doc, safeOp, isFaceRegistered, isFaceGridEligible)
    default: {
      // Unreachable: decodeOperation already rejects anything outside
      // KNOWN_OPERATIONS. Kept as a defensive exhaustiveness guard rather
      // than trusting the switch's exhaustiveness alone (mirrors
      // apply-verb.ts's default arm).
      const forged: never = safeOp
      return {
        ok: false,
        diagnostic: makeDiagnostic('LAYOP_UNKNOWN_OPERATION', undefined, {
          discriminantType: sanitizeOperationDiscriminant((forged as { op?: unknown }).op),
        }),
      }
    }
  }
}
