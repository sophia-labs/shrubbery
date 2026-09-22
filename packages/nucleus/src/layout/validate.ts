/**
 * THREAT MODEL (pinned — Builder P1 hardening, load-bearing, read before
 * judging anything else in this module family): a `LayoutDocument` crossing
 * any trust boundary is JSON — agents author it via the closed operation
 * vocabulary (operations.ts), and an untrusted document is JSON-normalized at
 * the INGEST boundary (a `JSON.parse`/roundtrip) BEFORE it ever reaches this
 * pure model. IN SCOPE: robustness against JSON-SHAPED malformed input (wrong
 * types, null/missing required fields, out-of-range values, duplicate/
 * dangling ids, cycles) — this validator REJECTS such input and the reducer
 * (operations.ts) never throws or partial-renders on it — plus purity,
 * content-free diagnostics, deterministic output, and closed-schema
 * enforcement that is ACTUALLY tested (not a vacuous allow-everything stub).
 * OUT OF SCOPE BY DESIGN: in-process exotic-object forgery — non-enumerable
 * properties, accessors/getters, `Symbol.toPrimitive`/`valueOf` coercion
 * bombs, prototype-pollution objects. `JSON.parse` cannot produce any of
 * these, so ingest already neutralizes them; hardening this pure validator
 * against them is out of scope and not attempted here.
 *
 * validate.ts — the STRUCTURAL + deterministic Phase-1 invariants, as pure
 * validators over one `LayoutDocument` snapshot.
 *
 * Covers (design §2.1):
 *   LAY-000 — document schema: schemaVersion, layoutId, scope, graphId,
 *             createdAt/updatedAt, and the nodes map itself must be
 *             well-shaped, and no unknown top-level field is admitted
 *             (design §2.2's runtime schema).
 *   LAY-001 — tree: exactly one root, every reachable node is split|leaf, at
 *             most one parent, no cycles, no dangling children. Every node's
 *             OWN shape is also closed — exactly its documented key set, and
 *             a genuine plain object, never a class/provider/DOM/exotic
 *             instance (design §9.2 Phase 1 diff-review r2: "a leaf with an
 *             extra executable field validated successfully" — the r1
 *             implementation checked node FIELDS but never the node's own key
 *             closure).
 *   LAY-002 — stable identity: (single-document form) every node's embedded
 *             `id` matches its key in `nodes`, and every leaf's
 *             `descriptorRevision` is a legal non-negative integer. Cross-
 *             operation stability is operations.ts's job (preconditions + the
 *             property test's survivor-id oracle), not a single-snapshot check.
 *   LAY-003 — typed leaf: every leaf carries a schema-versioned descriptor
 *             with a canonical resource locator and a face id, validated
 *             through a MANDATORY registration predicate — see
 *             `isFaceRegistered` below.
 *   LAY-004 — closed behavior catalog: descriptor `params`, when present,
 *             MUST be closed, JSON-plain, serializable data — functions,
 *             class/provider/DOM instances, symbol/prototype-polluting keys,
 *             and unbounded/cyclic structures are all rejected, recursively,
 *             at any depth, INCLUDING inside arrays (design §9.2 Phase 1
 *             diff-review r2: the r1 array check only walked INDEXED
 *             elements via `Array.prototype.every`, so a non-index own
 *             property such as `arr.onClick = fn`, or a sparse/hole-bearing
 *             array, or an accessor-defined index, all slipped past
 *             undetected — `isClosedArray` below closes that gap by checking
 *             own-property NAMES and DESCRIPTORS, not just indexed values).
 *             Each FACE REGISTRATION also owns its own closed params schema
 *             (design §2.2/§3.1) — see `FaceRegistrationEntry.validateParams`
 *             below; the generic closed-serializable check is the FLOOR every
 *             descriptor must clear, not a substitute for a face's own schema.
 *   LAY-010 — last leaf: at least one leaf is reachable from root.
 *
 * OUT of Phase 1 (design §2.1 explicitly): LAY-005 (one authority — a
 * Y.Doc/RDF concern) and LAY-008 (local projection — a client/interpreter
 * concern). Neither has a document-shape signature to validate here.
 *
 * LAY-011/012: `validateLayoutDocument` is the single gate every other Phase-1
 * module calls before doing recursive work (operations.ts's postcondition
 * check, solver.ts's pre-solve check). It NEVER recurses over unvalidated
 * data — the tree walk below is iterative with an explicit stack and a
 * visited-set, so even a maliciously cyclic `nodes` map cannot stack-overflow
 * it. Every `nodes[id]`-shaped lookup goes through `getOwnNode` (`Object.
 * hasOwn`-guarded), not a bare bracket access — design §9.2 Phase 1
 * diff-review r2: a bare `nodes[rootNodeId]` resolves an INHERITED
 * `Object.prototype` member (e.g. `rootNodeId: 'toString'` against an empty
 * `nodes` map) as if it were a real node, which is truthy and therefore
 * passed the old root-existence check, then threw deep inside the
 * traversal once the inherited function reached a field access. The
 * document-schema pass and the recursive `params` shape check are both
 * DEPTH- and SIZE-bounded for the same "never let untrusted structure drive
 * unbounded work" reason (see `isClosedSerializableValue`).
 *
 * Pure: no DOM, no stores, no Y.js, no network.
 */

import type {
  GridCell,
  GridChildrenSource,
  LayoutDocument,
  LayoutGridNode,
  LayoutLeafNode,
  LayoutNode,
  LayoutSplitNode,
  LayoutTab,
  LayoutTabsNode,
  ResourceLocator,
  ViewDescriptor,
} from './types.js'
import {
  LAYOUT_DOCUMENT_KEYS,
  LAYOUT_SCOPES,
  RESOURCE_LOCATOR_KINDS,
  SOPHIA_HOME_FACE_ID,
  isValidBasisPoints,
  isValidDescriptorRevision,
  isValidGridFlow,
  isValidGridRevision,
  isValidMaxItems,
  isValidMinCellWidth,
  isValidRefreshSeconds,
  isValidTabLabel,
  isValidTabsRevision,
  MAX_TABS,
  childNodeIds,
} from './types.js'
import type { Diagnostic } from './diagnostics.js'
import { makeDiagnostic, sortDiagnostics } from './diagnostics.js'
import { deepCloneJsonValue, deepFreeze } from './immutable.js'

/**
 * The face-registration predicate LAY-003/LAY-004 delegate to. Phase 1 has no
 * real registry (that's P2's `FaceRegistration` catalog, design §3.2) — the
 * DEFAULT implementation (`defaultFaceRegistrationPredicate` below) is a
 * MANDATORY, CLOSED allow-list of the handful of face ids Phase 1's own code
 * ever mints (currently just `sophia.home` — see `PHASE1_FACE_REGISTRATIONS`),
 * not a permissive shape check. Callers with a real registry inject their own
 * predicate, typically built with `createFaceAllowListPredicate`.
 */
export type FaceRegistrationPredicate = (descriptor: ViewDescriptor) => boolean

/**
 * The grid-cell-eligibility predicate LAY-003's "cell persistence rule"
 * delegates to (design §2.1: "faces with persistence: 'persistent-non-
 * relocatable' are invalid in grid cells"). Phase 1's document model has NO
 * concept of persistence at all — `FacePersistence`/`FaceRegistration` are a
 * P2/runtime concern (`packages/runtime/src/layout/types.ts`), entirely
 * outside this pure module family's imports. This predicate takes a bare
 * `faceId` (not a full `ViewDescriptor`) so it applies uniformly to BOTH a
 * fixed cell's `descriptor.faceId` and a collection source's `itemFaceId`
 * (which has no concrete `resource`/`params` until a collection row is
 * resolved at render time — see `GridChildrenSource`'s doc comment) — mirrors
 * `FaceRegistrationPredicate`'s pluggable-default shape exactly. The DEFAULT
 * (`defaultFaceGridEligibilityPredicate` below) is permissive (`() => true`):
 * Phase 1 has no registry to source persistence from, so nothing is excluded
 * by default; a real caller with a real, persistence-aware `FaceRegistration`
 * catalog injects its own predicate, exactly as it does for `isFaceRegistered`.
 */
export type FaceGridEligibilityPredicate = (faceId: string) => boolean

export interface ValidateOptions {
  readonly isFaceRegistered?: FaceRegistrationPredicate
  readonly isFaceGridEligible?: FaceGridEligibilityPredicate
}

/**
 * The DEFAULT grid-eligibility predicate — see `FaceGridEligibilityPredicate`'s
 * doc comment above for why "permissive" is the correct Phase-1 default (not
 * a security-relevant allow-list the way `defaultFaceRegistrationPredicate`
 * is; there is simply no persistence concept here to enforce against).
 */
export const defaultFaceGridEligibilityPredicate: FaceGridEligibilityPredicate = () => true

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

/**
 * A plain, non-array object whose prototype is `Object.prototype` or `null`,
 * with NO symbol-keyed own properties and NO accessor (getter/setter) own
 * properties — every own enumerable key is a plain DATA property. This is the
 * SINGLE base-shape gate every closed-schema check in this module (and,
 * exported, `operations.ts`'s decoder) uses.
 *
 * The accessor/symbol checks (design §9.2 Phase 1 diff-review r2) close a
 * subtler gap than r1's prototype check alone: a getter can return a
 * perfectly plain-looking value on ONE read yet be non-idempotent, or can
 * itself throw / have side effects — none of that is "closed, JSON-plain,
 * serializable data" (design §2.2), even though `typeof
 * theResult === 'object'` might look fine downstream. Rejecting any object
 * with an accessor property closes that off structurally rather than relying
 * on every future reader to only ever access each property once.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return false
  if (Object.getOwnPropertySymbols(value).length > 0) return false
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || descriptor.get || descriptor.set) return false
  }
  return true
}

/**
 * A genuine dense array: `Array.prototype` as its prototype, no symbol-keyed
 * own properties, no extra named own properties beyond `length` and its
 * indices, no holes, and no accessor-defined index (design §9.2 Phase 1
 * diff-review r2 — see this file's header). `Array.prototype.every` alone
 * (r1's check) walks only the VALUES at indices `0..length-1` and is blind to
 * all four of these — a non-index own property such as `arr.onClick = fn` is
 * simply never visited by `.every`.
 */
export function isClosedArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false
  if (Object.getPrototypeOf(value) !== Array.prototype) return false
  if (Object.getOwnPropertySymbols(value).length > 0) return false
  const length = value.length
  if (!Number.isInteger(length) || length < 0) return false
  // Every own property name must be exactly one of '0'..String(length-1) plus
  // 'length' — nothing more (rejects extra named props) and nothing less
  // (rejects holes, since a hole has no own property at that index at all).
  if (Object.getOwnPropertyNames(value).length !== length + 1) return false
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i)
    if (!descriptor || !('value' in descriptor) || descriptor.get || descriptor.set) return false
    if (!descriptor.enumerable) return false
  }
  return true
}

/**
 * Exported so `operations.ts`'s decoder can apply the SAME closed-key
 * discipline to `LayoutOperation`/`ParentLocation` shapes without
 * reimplementing it (design §9.2 Phase 1 diff-review r2).
 */
export function hasNoUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

/** `Object.hasOwn`-guarded node lookup — see this file's header for why a bare `nodes[id]` is unsafe. */
function getOwnNode(nodes: Readonly<Record<string, unknown>>, id: string): unknown {
  return Object.hasOwn(nodes, id) ? nodes[id] : undefined
}

const RESOURCE_LOCATOR_KEYS: Readonly<Record<(typeof RESOURCE_LOCATOR_KINDS)[number], readonly string[]>> = {
  document: ['kind', 'graphId', 'documentId'],
  graph: ['kind', 'graphId', 'subjectIri'],
  query: ['kind', 'graphId', 'queryId', 'revision'],
  chat: ['kind', 'graphId', 'sessionId'],
  iri: ['kind', 'iri'],
}

/**
 * Shape-check one `ResourceLocator` — every variant carries ONLY its
 * documented identifier fields (design §2.2). Unknown/extra keys are
 * rejected. Exported (Wave 2 x Lane B) so a `GridChildrenSource`'s
 * `collection` locator can be checked with the exact same discipline as a
 * leaf's `resource`, rather than duplicating this logic.
 */
export function isWellShapedResourceLocator(value: unknown): value is ResourceLocator {
  if (!isPlainObject(value)) return false
  const kind = value.kind
  if (typeof kind !== 'string' || !(RESOURCE_LOCATOR_KINDS as readonly string[]).includes(kind)) {
    return false
  }
  const allowedKeys = RESOURCE_LOCATOR_KEYS[kind as (typeof RESOURCE_LOCATOR_KINDS)[number]]
  if (!hasNoUnknownKeys(value, allowedKeys)) return false
  const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0
  const isOptionalString = (v: unknown): boolean => v === undefined || typeof v === 'string'
  switch (kind) {
    case 'document':
      return isNonEmptyString(value.graphId) && isNonEmptyString(value.documentId)
    case 'graph':
      return isNonEmptyString(value.graphId) && isOptionalString(value.subjectIri)
    case 'query':
      return (
        isNonEmptyString(value.graphId) &&
        isNonEmptyString(value.queryId) &&
        isOptionalString(value.revision)
      )
    case 'chat':
      return isNonEmptyString(value.graphId) && isNonEmptyString(value.sessionId)
    case 'iri':
      return isNonEmptyString(value.iri)
    default:
      return false
  }
}

// ── closed, recursive `params` validation (LAY-004) ────────────────────────

/**
 * Bounds on `params`'s recursive shape check — this is a document-shape gate
 * that MUST terminate on adversarial input (a maliciously deep or huge
 * object), not a product feature. Real face params (design §3.1 examples:
 * `{mode:"document"}`, `{maxRows:100}`) are tiny and shallow; these bounds are
 * generous relative to that, not a tight product limit.
 */
const MAX_PARAMS_DEPTH = 8
const MAX_PARAMS_KEYS_OR_ITEMS = 200

/** Keys that could smuggle prototype pollution through a later `{...params}` spread. */
const FORBIDDEN_KEY_NAMES: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor'])

/**
 * True iff `value` is closed, JSON-plain, serializable data: a finite number,
 * string, boolean, null, or a plain array/object of such, recursively — NEVER
 * a function, symbol, bigint, undefined, class instance, DOM node, Map/Set/
 * Date/RegExp, sparse array, or array/object carrying an accessor or a
 * non-index own property. `seen` rejects any repeated object reference — this
 * both catches a genuine circular structure (which would otherwise recurse
 * forever) and, more strictly, forbids a shared-reference graph inside params
 * altogether (params is meant to be portable, cloneable intent, never an
 * aliasing graph).
 */
function isClosedSerializableValue(value: unknown, depth: number, seen: Set<unknown>): boolean {
  if (depth > MAX_PARAMS_DEPTH) return false
  if (value === null) return true
  const t = typeof value
  if (t === 'string' || t === 'boolean') return true
  if (t === 'number') return Number.isFinite(value)
  if (t !== 'object') return false // function | symbol | bigint | undefined
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) {
    if (!isClosedArray(value)) return false
    if (value.length > MAX_PARAMS_KEYS_OR_ITEMS) return false
    return value.every((item) => isClosedSerializableValue(item, depth + 1, seen))
  }
  if (!isPlainObject(value)) return false // class instance / DOM node / Map / Set / Date / RegExp / …
  const keys = Object.keys(value)
  if (keys.length > MAX_PARAMS_KEYS_OR_ITEMS) return false
  for (const key of keys) {
    if (FORBIDDEN_KEY_NAMES.has(key)) return false
    if (!isClosedSerializableValue(value[key], depth + 1, seen)) return false
  }
  return true
}

function isClosedSerializableParams(value: unknown): value is Readonly<Record<string, unknown>> {
  return isPlainObject(value) && isClosedSerializableValue(value, 0, new Set())
}

const VIEW_DESCRIPTOR_KEYS = ['schemaVersion', 'faceId', 'resource', 'params'] as const

/**
 * Shape-check one `ViewDescriptor`: closed key set, schemaVersion 1,
 * non-empty faceId, a well-shaped (closed-key) resource, and (if present) a
 * closed/recursively-serializable `params`. This is the generic FLOOR every
 * descriptor must clear regardless of face — it proves the descriptor is
 * legal DATA, not that its face is vetted, and not that its `params` satisfy
 * that SPECIFIC face's own schema (see `FaceRegistrationEntry.validateParams`
 * and `isFaceRegistered` below, design §2.2/§3.1: "Each face registration
 * owns a closed descriptor schema").
 */
export function isWellShapedViewDescriptor(value: unknown): value is ViewDescriptor {
  if (!isPlainObject(value)) return false
  if (!hasNoUnknownKeys(value, VIEW_DESCRIPTOR_KEYS)) return false
  if (value.schemaVersion !== 1) return false
  if (typeof value.faceId !== 'string' || value.faceId.length === 0) return false
  if (!isWellShapedResourceLocator(value.resource)) return false
  if (value.params !== undefined && !isClosedSerializableParams(value.params)) return false
  return true
}

// ── grid children source shape (design §2.1; Wave 2 x Lane B) ──────────────

const GRID_CELL_KEYS = ['id', 'descriptor', 'span'] as const
const GRID_FIXED_CHILDREN_KEYS = ['kind', 'cells'] as const
const GRID_COLLECTION_CHILDREN_KEYS = [
  'kind',
  'collection',
  'itemFaceId',
  'itemParams',
  'maxItems',
  'refreshSeconds',
] as const

/**
 * Bound on a fixed grid's `cells` array length — same "must terminate on
 * adversarial input, generous relative to any real product size" rationale
 * as `MAX_PARAMS_KEYS_OR_ITEMS` above; the §5 dashboard's biggest fixed grid
 * is 7 cells.
 */
const MAX_GRID_CELLS = 200

/** Bound on a collection source's `itemParams` key count — same rationale. */
const MAX_ITEM_PARAMS_KEYS = 50

function isWellShapedGridCell(value: unknown): value is GridCell {
  if (!isPlainObject(value)) return false
  if (!hasNoUnknownKeys(value, GRID_CELL_KEYS)) return false
  if (typeof value.id !== 'string' || value.id.length === 0) return false
  if (!isWellShapedViewDescriptor(value.descriptor)) return false
  if (value.span !== undefined && value.span !== 1 && value.span !== 2 && value.span !== 3) return false
  return true
}

/**
 * `itemParams` — closed, string-valued, JSON-plain (design §2.1: "values may
 * reference '?var' from the row"). Reuses `FORBIDDEN_KEY_NAMES`'s
 * prototype-pollution guard rather than re-deriving it; every value must be a
 * plain string (not merely closed/serializable — an `itemParams` number or
 * boolean would be meaningless as a var-substitution template).
 */
function isClosedItemParams(value: unknown): value is Readonly<Record<string, string>> {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  if (keys.length > MAX_ITEM_PARAMS_KEYS) return false
  for (const key of keys) {
    if (FORBIDDEN_KEY_NAMES.has(key)) return false
    if (typeof value[key] !== 'string') return false
  }
  return true
}

/**
 * Shape-check one `GridChildrenSource` — closed key set per source kind, a
 * closed/deduplicated `cells` array for `'fixed'`, or a well-shaped `'query'`
 * `ResourceLocator` + closed binding fields for `'collection'` (design §2.1:
 * "v1: kind 'query'"). This is the generic FLOOR every grid's children must
 * clear — it proves the source is legal DATA, exactly `isWellShapedViewDescriptor`'s
 * role for a leaf's descriptor; face REGISTRATION and grid-ELIGIBILITY
 * (LAY-003's cell persistence rule) are separate concerns checked by the
 * caller (validate.ts's per-node loop, operations.ts's grid reducers) once
 * this shape floor has passed — mirrors `isWellShapedViewDescriptor` /
 * `isFaceRegistered`'s own two-step split exactly.
 *
 * Cell ids need only be unique WITHIN this one grid's own `cells` array — a
 * `GridCell.id` is never a `LayoutDocument.nodes` key (design §2.1: cells are
 * never tree nodes), so it lives in a grid-local namespace, not the
 * document-wide one `requireFreshId`/LAY-002 police.
 */
export function isWellShapedGridChildrenSource(value: unknown): value is GridChildrenSource {
  if (!isPlainObject(value)) return false
  if (value.kind === 'fixed') {
    if (!hasNoUnknownKeys(value, GRID_FIXED_CHILDREN_KEYS)) return false
    if (!isClosedArray(value.cells)) return false
    if (value.cells.length > MAX_GRID_CELLS) return false
    const seenIds = new Set<string>()
    for (const cell of value.cells) {
      if (!isWellShapedGridCell(cell)) return false
      if (seenIds.has(cell.id)) return false
      seenIds.add(cell.id)
    }
    return true
  }
  if (value.kind === 'collection') {
    if (!hasNoUnknownKeys(value, GRID_COLLECTION_CHILDREN_KEYS)) return false
    if (!isWellShapedResourceLocator(value.collection)) return false
    if (value.collection.kind !== 'query') return false
    if (typeof value.itemFaceId !== 'string' || value.itemFaceId.length === 0) return false
    if (value.itemParams !== undefined && !isClosedItemParams(value.itemParams)) return false
    if (!isValidMaxItems(value.maxItems)) return false
    if (value.refreshSeconds !== undefined && !isValidRefreshSeconds(value.refreshSeconds)) return false
    return true
  }
  return false
}

// ── face registration (LAY-003/LAY-004) — mandatory, closed, per-face ──────

/**
 * A face-owned closed params schema (design §2.2: "Each face registration
 * owns a closed descriptor schema; unknown keys or values fail validation").
 * Runs AFTER `isWellShapedViewDescriptor` has already proven `params` is
 * generic closed/serializable data — a real face narrows further (which keys
 * exist, what they mean), not just re-checks genericclosedness.
 */
export type FaceParamsValidator = (
  params: Readonly<Record<string, unknown>> | undefined,
) => boolean

/** A face that takes NO params at all — `descriptor.params` must be entirely absent. */
export const noParamsAllowed: FaceParamsValidator = (params) => params === undefined

/**
 * A face with no schema narrower than the generic closed/serializable floor
 * `isWellShapedViewDescriptor` already enforces — i.e. it accepts ANY closed,
 * JSON-plain `params` object, arbitrary keys included. This is an ESCAPE
 * HATCH, not a default: a face registered with `anyClosedParams` is exempt
 * from LAY-004's actual point ("each face registration owns a closed
 * descriptor schema; unknown keys or values fail validation" — design §2.2).
 * Builder P1 hardening finding 1: the test fixtures previously registered
 * nearly every face with this validator, which made LAY-004 unfalsifiable in
 * the test suite (an `{arbitraryUnknownKey:1}` params object passed for
 * every face, since "any closed value" trivially includes it) — real face
 * registrations, and the test registry, should reach for
 * `createExactParamsSchema` (or `noParamsAllowed`) instead; reserve this for
 * a face that has GENUINELY open-ended params by design.
 */
export const anyClosedParams: FaceParamsValidator = () => true

/** One field's legal type inside an exact params schema — see `createExactParamsSchema`. */
export type ParamsFieldSchema =
  | { readonly type: 'string'; readonly optional?: boolean }
  | { readonly type: 'number'; readonly optional?: boolean }
  | { readonly type: 'boolean'; readonly optional?: boolean }
  | { readonly type: 'enum'; readonly values: readonly string[]; readonly optional?: boolean }

/**
 * Build a REAL, closed, per-face params validator (Builder P1 hardening
 * finding 1 — see `anyClosedParams`'s doc comment above): exactly the
 * declared keys are legal, nothing else — an unlisted key (however
 * innocuous-looking, e.g. `{arbitraryUnknownKey:1}`) is REJECTED, not
 * silently ignored — every declared key's runtime type is checked, and every
 * non-`optional` key is REQUIRED. This is the mechanism LAY-004's "each face
 * registration owns a closed descriptor schema" actually calls for; a face
 * that truly takes no params should use `noParamsAllowed` instead (a
 * zero-field exact schema would also work, but `noParamsAllowed` states the
 * intent more directly and additionally forbids the empty-object `params: {}`
 * form, which an empty `createExactParamsSchema({})` would accept).
 *
 * Runs strictly AFTER `isWellShapedViewDescriptor` has already proven
 * `params` is generic closed/serializable data (`createFaceAllowListPredicate`
 * only ever calls a face's `validateParams` once that floor has passed) — so
 * this only needs to check KEY SET and per-field TYPE, never re-derive
 * closedness itself.
 */
export function createExactParamsSchema(fields: Readonly<Record<string, ParamsFieldSchema>>): FaceParamsValidator {
  const fieldNames = Object.keys(fields)
  return (params) => {
    if (params === undefined) {
      // Legal iff every declared field is optional.
      return fieldNames.every((name) => fields[name].optional === true)
    }
    const actualKeys = Object.keys(params)
    if (actualKeys.length > fieldNames.length) return false
    for (const key of actualKeys) {
      if (!Object.hasOwn(fields, key)) return false
    }
    for (const name of fieldNames) {
      const schema = fields[name]
      const has = Object.hasOwn(params, name)
      if (!has) {
        if (schema.optional === true) continue
        return false
      }
      const value = params[name]
      switch (schema.type) {
        case 'string':
          if (typeof value !== 'string') return false
          break
        case 'number':
          if (typeof value !== 'number' || !Number.isFinite(value)) return false
          break
        case 'boolean':
          if (typeof value !== 'boolean') return false
          break
        case 'enum':
          if (typeof value !== 'string' || !schema.values.includes(value)) return false
          break
      }
    }
    return true
  }
}

export interface FaceRegistrationEntry {
  readonly faceId: string
  /** MANDATORY — every registration owns its own closed params validator. */
  readonly validateParams: FaceParamsValidator
}

/**
 * Build a closed, per-face allow-list predicate: registered iff (a)
 * well-shaped, (b) `faceId` is one of the registered entries, AND (c) that
 * entry's OWN `validateParams` accepts `descriptor.params` (design §9.2 Phase
 * 1 diff-review r2: r1's `createFaceAllowListPredicate` took a bare list of
 * face ids and validated ONLY the id, never a face-owned params schema — the
 * design's own text explicitly requires the latter).
 */
export function createFaceAllowListPredicate(
  entries: Iterable<FaceRegistrationEntry>,
): FaceRegistrationPredicate {
  const byId = new Map<string, FaceParamsValidator>()
  for (const entry of entries) byId.set(entry.faceId, entry.validateParams)
  return (descriptor: ViewDescriptor): boolean => {
    if (!isWellShapedViewDescriptor(descriptor)) return false
    const validateParams = byId.get(descriptor.faceId)
    if (!validateParams) return false
    return validateParams(descriptor.params)
  }
}

/**
 * Phase 1's OWN minimal built-in registry — just the well-known
 * `sophia.home` face this module itself constructs (LAY-010's fallback),
 * which takes no params (`createSophiaHomeDescriptor` never sets any). This
 * is explicitly NOT the real P2 `FaceRegistration` catalog (design §3.2); it
 * exists only so Phase 1's own acceptance gate is actually enforced.
 */
export const PHASE1_FACE_REGISTRATIONS: readonly FaceRegistrationEntry[] = [
  { faceId: SOPHIA_HOME_FACE_ID, validateParams: noParamsAllowed },
]

/** The closed set of face ids `PHASE1_FACE_REGISTRATIONS` registers. */
export const PHASE1_KNOWN_FACE_IDS: ReadonlySet<string> = new Set(
  PHASE1_FACE_REGISTRATIONS.map((entry) => entry.faceId),
)

/**
 * The DEFAULT face-registration predicate used whenever a caller passes no
 * `ValidateOptions.isFaceRegistered` — a MANDATORY, closed, per-face
 * allow-list (`PHASE1_FACE_REGISTRATIONS`), not a permissive shape-only
 * stand-in. A real caller with a real face catalog MUST inject its own
 * predicate; this default exists so Phase 1's own invariants and gate are
 * enforced even when nobody has injected anything yet.
 */
export const defaultFaceRegistrationPredicate: FaceRegistrationPredicate =
  createFaceAllowListPredicate(PHASE1_FACE_REGISTRATIONS)

// ── document-level schema shape (LAY-000; design §2.2's runtime schema) ────

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

type ParentRef = { readonly parentId: string }

/** Build a child→parent index by scanning every structural node once. Pure, O(n). */
function indexParents(nodes: Readonly<Record<string, LayoutNode>>): Map<string, ParentRef[]> {
  const index = new Map<string, ParentRef[]>()
  const push = (childId: string, ref: ParentRef): void => {
    const existing = index.get(childId)
    if (existing) existing.push(ref)
    else index.set(childId, [ref])
  }
  for (const node of Object.values(nodes)) {
    for (const childId of childNodeIds(node)) push(childId, { parentId: node.id })
  }
  return index
}

const LAYOUT_LEAF_NODE_KEYS = ['kind', 'id', 'descriptor', 'descriptorRevision'] as const
const LAYOUT_SPLIT_NODE_KEYS = ['kind', 'id', 'axis', 'startNodeId', 'endNodeId', 'startBasisPoints'] as const
const LAYOUT_GRID_NODE_KEYS = ['kind', 'id', 'flow', 'minCellWidth', 'children', 'gridRevision'] as const
const LAYOUT_TABS_NODE_KEYS = ['kind', 'id', 'tabs', 'activeNodeId', 'tabsRevision'] as const
const LAYOUT_TAB_KEYS = ['nodeId', 'label'] as const

export const LAYOUT_NODE_KEYS = {
  split: LAYOUT_SPLIT_NODE_KEYS,
  leaf: LAYOUT_LEAF_NODE_KEYS,
  grid: LAYOUT_GRID_NODE_KEYS,
  tabs: LAYOUT_TABS_NODE_KEYS,
} as const satisfies Readonly<Record<LayoutNode['kind'], readonly string[]>>

export function isWellShapedLayoutTab(value: unknown): value is LayoutTab {
  return (
    isPlainObject(value) &&
    hasNoUnknownKeys(value, LAYOUT_TAB_KEYS) &&
    typeof value.nodeId === 'string' &&
    value.nodeId.length > 0 &&
    isValidTabLabel(value.label)
  )
}

/**
 * Validate a `LayoutDocument` against LAY-000 (document schema), LAY-001,
 * LAY-002, LAY-003/004, and LAY-010. Returns `{ ok: true }` or
 * `{ ok: false, diagnostics }` with every violation found, sorted
 * deterministically (LAY-011). Never throws, never recurses unboundedly — the
 * reachability walk below is iterative with a visited-set, so a cyclic or
 * dangling document is diagnosed, not crashed on (LAY-012: the caller must
 * not proceed to plan/render past a `{ ok: false }` result). The parameter is
 * typed `LayoutDocument`, but every check below re-verifies its shape at
 * runtime rather than trusting the static type — this function is the LAST
 * gate before untyped/agent-forged data (a JSON payload cast with `as
 * LayoutDocument`, for instance) reaches the rest of the module family.
 */
export function validateLayoutDocument(
  doc: LayoutDocument,
  options?: ValidateOptions,
): ValidationResult {
  const isFaceRegistered = options?.isFaceRegistered ?? defaultFaceRegistrationPredicate
  const isFaceGridEligible = options?.isFaceGridEligible ?? defaultFaceGridEligibilityPredicate
  const diagnostics: Diagnostic[] = []
  const raw: unknown = doc

  // ── LAY-000 (document schema shape) ─────────────────────────────────────
  if (!isPlainObject(raw)) {
    diagnostics.push(
      makeDiagnostic('LAY000_INVALID_DOCUMENT_SHAPE', undefined, {
        reason: 'not-plain-object',
      }),
    )
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) }
  }
  for (const key of Object.keys(raw)) {
    if (!(LAYOUT_DOCUMENT_KEYS as readonly string[]).includes(key)) {
      diagnostics.push(
        makeDiagnostic('LAY000_UNKNOWN_TOP_LEVEL_FIELD', undefined, {
          field: key,
        }),
      )
    }
  }
  if (raw.schemaVersion !== 1) {
    diagnostics.push(
      makeDiagnostic('LAY000_INVALID_SCHEMA_VERSION', undefined, {
        actualType: typeof raw.schemaVersion,
      }),
    )
  }
  if (typeof raw.layoutId !== 'string' || raw.layoutId.length === 0) {
    diagnostics.push(makeDiagnostic('LAY000_INVALID_LAYOUT_ID'))
  }
  if (!(LAYOUT_SCOPES as readonly string[]).includes(raw.scope as string)) {
    diagnostics.push(
      makeDiagnostic('LAY000_INVALID_SCOPE', undefined, {
        actualType: typeof raw.scope,
      }),
    )
  }
  if (raw.graphId !== null && typeof raw.graphId !== 'string') {
    diagnostics.push(
      makeDiagnostic('LAY000_INVALID_GRAPH_ID', undefined, {
        actualType: typeof raw.graphId,
      }),
    )
  }
  if (!isValidTimestamp(raw.createdAt)) {
    diagnostics.push(
      makeDiagnostic('LAY000_INVALID_TIMESTAMP', undefined, {
        field: 'createdAt',
      }),
    )
  }
  if (!isValidTimestamp(raw.updatedAt)) {
    diagnostics.push(
      makeDiagnostic('LAY000_INVALID_TIMESTAMP', undefined, {
        field: 'updatedAt',
      }),
    )
  }
  if (!isPlainObject(raw.nodes)) {
    diagnostics.push(makeDiagnostic('LAY000_INVALID_NODES_MAP'))
  }
  if (typeof raw.rootNodeId !== 'string') {
    diagnostics.push(
      makeDiagnostic('LAY000_INVALID_DOCUMENT_SHAPE', undefined, {
        reason: 'invalid-root-node-id',
      }),
    )
  }
  // Any of the above makes the recursive walk below unsafe (e.g. `nodes`
  // might not even be an object) — stop before touching node structure.
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) }
  }

  const nodes = doc.nodes as unknown as Readonly<Record<string, unknown>>

  // ── LAY-001 (root existence) ────────────────────────────────────────────
  if (!doc.rootNodeId || !getOwnNode(nodes, doc.rootNodeId)) {
    diagnostics.push(makeDiagnostic('LAY001_NO_ROOT', doc.rootNodeId || undefined))
    // Nothing else can be safely walked without a root — return immediately.
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) }
  }

  // ── LAY-002 (single-document self-consistency) + per-node local shape ──
  for (const [key, rawNode] of Object.entries(nodes)) {
    if (!isPlainObject(rawNode)) {
      diagnostics.push(
        makeDiagnostic('LAY001_INVALID_NODE_SHAPE', key, {
          reason: 'not-plain-object',
        }),
      )
      continue
    }
    if (rawNode.id !== key) {
      diagnostics.push(
        makeDiagnostic('LAY002_ID_MISMATCH', key,
          typeof rawNode.id === 'string' ? { embeddedId: rawNode.id } : undefined,
        ),
      )
      continue
    }

    if (rawNode.kind === 'split') {
      if (!hasNoUnknownKeys(rawNode, LAYOUT_SPLIT_NODE_KEYS)) {
        diagnostics.push(
          makeDiagnostic('LAY001_INVALID_NODE_SHAPE', key, {
            reason: 'unknown-field',
          }),
        )
        continue
      }
      const node = rawNode as unknown as LayoutSplitNode
      if (node.axis !== 'horizontal' && node.axis !== 'vertical') {
        diagnostics.push(makeDiagnostic('LAY001_INVALID_AXIS', node.id))
      }
      if (!isValidBasisPoints(node.startBasisPoints)) {
        diagnostics.push(
          makeDiagnostic('LAY001_INVALID_RATIO_RANGE', node.id, {
            actualType: typeof node.startBasisPoints,
          }),
        )
      }
      if (
        typeof node.startNodeId !== 'string' ||
        typeof node.endNodeId !== 'string' ||
        node.startNodeId.length === 0 ||
        node.endNodeId.length === 0 ||
        node.startNodeId === node.endNodeId
      ) {
        diagnostics.push(
          makeDiagnostic('LAY001_DEGENERATE_SPLIT', node.id),
        )
      } else {
        if (getOwnNode(nodes, node.startNodeId) === undefined) {
          diagnostics.push(
            makeDiagnostic('LAY001_DANGLING_CHILD', node.id, {
              childId: node.startNodeId,
              childField: 'startNodeId',
            }),
          )
        }
        if (getOwnNode(nodes, node.endNodeId) === undefined) {
          diagnostics.push(
            makeDiagnostic('LAY001_DANGLING_CHILD', node.id, {
              childId: node.endNodeId,
              childField: 'endNodeId',
            }),
          )
        }
      }
    } else if (rawNode.kind === 'leaf') {
      if (!hasNoUnknownKeys(rawNode, LAYOUT_LEAF_NODE_KEYS)) {
        diagnostics.push(
          makeDiagnostic('LAY001_INVALID_NODE_SHAPE', key, {
            reason: 'unknown-field',
          }),
        )
        continue
      }
      const node = rawNode as unknown as LayoutLeafNode
      if (!isValidDescriptorRevision(node.descriptorRevision)) {
        diagnostics.push(
          makeDiagnostic('LAY002_INVALID_DESCRIPTOR_REVISION', node.id, {
            actualType: typeof node.descriptorRevision,
          }),
        )
      }
      if (!isWellShapedViewDescriptor(node.descriptor)) {
        diagnostics.push(
          makeDiagnostic('LAY003_INVALID_DESCRIPTOR', node.id),
        )
      } else if (!isFaceRegistered(node.descriptor)) {
        diagnostics.push(
          makeDiagnostic('LAY003_UNREGISTERED_FACE', node.id, {
            faceId: node.descriptor.faceId,
          }),
        )
      }
    } else if (rawNode.kind === 'grid') {
      if (!hasNoUnknownKeys(rawNode, LAYOUT_GRID_NODE_KEYS)) {
        diagnostics.push(
          makeDiagnostic('LAY001_INVALID_NODE_SHAPE', key, {
            reason: 'unknown-field',
          }),
        )
        continue
      }
      const node = rawNode as unknown as LayoutGridNode
      if (!isValidGridFlow(node.flow)) {
        diagnostics.push(makeDiagnostic('LAY001_INVALID_GRID_FLOW', node.id))
      }
      if (!isValidMinCellWidth(node.minCellWidth)) {
        diagnostics.push(
          makeDiagnostic('LAY001_INVALID_MIN_CELL_WIDTH', node.id, {
            actualType: typeof node.minCellWidth,
          }),
        )
      }
      if (!isValidGridRevision(node.gridRevision)) {
        diagnostics.push(
          makeDiagnostic('LAY002_INVALID_GRID_REVISION', node.id, {
            actualType: typeof node.gridRevision,
          }),
        )
      }
      if (!isWellShapedGridChildrenSource(node.children)) {
        diagnostics.push(makeDiagnostic('LAY001_INVALID_GRID_CHILDREN_SHAPE', node.id))
      } else if (node.children.kind === 'fixed') {
        // Deeper per-cell face checks — only meaningful once the shape floor
        // above has already passed (mirrors the leaf branch's
        // isWellShapedViewDescriptor -> isFaceRegistered two-step).
        for (const cell of node.children.cells) {
          if (!isFaceRegistered(cell.descriptor)) {
            diagnostics.push(
              makeDiagnostic('LAY003_UNREGISTERED_FACE', cell.id, {
                faceId: cell.descriptor.faceId,
              }),
            )
          } else if (!isFaceGridEligible(cell.descriptor.faceId)) {
            diagnostics.push(
              makeDiagnostic('LAY003_CELL_FACE_NOT_GRID_ELIGIBLE', cell.id, {
                faceId: cell.descriptor.faceId,
              }),
            )
          }
        }
      } else if (!isFaceGridEligible(node.children.itemFaceId)) {
        // Collection source: only a bare faceId exists pre-render (design
        // §2.1 — "the document stores only the binding"), so there is no
        // concrete ViewDescriptor to run isFaceRegistered against yet; full
        // registration of itemFaceId is deferred to the runtime layer at
        // collection-materialization time, once a real resource+row exist.
        diagnostics.push(
          makeDiagnostic('LAY003_CELL_FACE_NOT_GRID_ELIGIBLE', node.id, {
            faceId: node.children.itemFaceId,
          }),
        )
      }
    } else if (rawNode.kind === 'tabs') {
      if (!hasNoUnknownKeys(rawNode, LAYOUT_NODE_KEYS.tabs)) {
        diagnostics.push(
          makeDiagnostic('LAY001_INVALID_NODE_SHAPE', key, {
            reason: 'unknown-field',
          }),
        )
        continue
      }
      const node = rawNode as unknown as LayoutTabsNode
      if (!isValidTabsRevision(node.tabsRevision)) {
        diagnostics.push(
          makeDiagnostic('LAY002_INVALID_TABS_REVISION', node.id, {
            actualType: typeof node.tabsRevision,
          }),
        )
      }
      const rawTabs: unknown = rawNode.tabs
      if (!isClosedArray(rawTabs)) {
        diagnostics.push(makeDiagnostic('LAY001_INVALID_TABS_SHAPE', node.id, { reason: 'not-array' }))
        continue
      }
      if (rawTabs.length === 0) {
        diagnostics.push(makeDiagnostic('LAY001_DEGENERATE_TABS', node.id, { reason: 'empty' }))
      } else if (rawTabs.length > MAX_TABS) {
        diagnostics.push(makeDiagnostic('LAY001_INVALID_TABS_SHAPE', node.id, { reason: 'too-many' }))
      }
      const seenTabIds = new Set<string>()
      for (const rawTab of rawTabs) {
        if (!isWellShapedLayoutTab(rawTab)) {
          const badLabel =
            isPlainObject(rawTab) &&
            hasNoUnknownKeys(rawTab, LAYOUT_TAB_KEYS) &&
            typeof rawTab.nodeId === 'string' &&
            rawTab.nodeId.length > 0 &&
            !isValidTabLabel(rawTab.label)
          diagnostics.push(
            makeDiagnostic('LAY001_INVALID_TABS_SHAPE', node.id, {
              reason: badLabel ? 'bad-label' : 'bad-entry',
            }),
          )
          continue
        }
        if (seenTabIds.has(rawTab.nodeId)) {
          diagnostics.push(makeDiagnostic('LAY001_DEGENERATE_TABS', node.id, { reason: 'duplicate-tab' }))
        }
        seenTabIds.add(rawTab.nodeId)
        if (rawTab.nodeId === node.id) {
          diagnostics.push(makeDiagnostic('LAY001_DEGENERATE_TABS', node.id, { reason: 'self-reference' }))
        }
        if (getOwnNode(nodes, rawTab.nodeId) === undefined) {
          diagnostics.push(
            makeDiagnostic('LAY001_DANGLING_CHILD', node.id, {
              childId: rawTab.nodeId,
              childField: 'tabs',
            }),
          )
        }
      }
      if (!seenTabIds.has(node.activeNodeId)) {
        diagnostics.push(makeDiagnostic('LAY001_DEGENERATE_TABS', node.id, { reason: 'active-not-a-tab' }))
      }
    } else {
      diagnostics.push(makeDiagnostic('LAY001_UNKNOWN_NODE_KIND', key))
    }
  }

  // Dangling children / degenerate splits / unknown kinds / bad node shapes
  // make a bounded walk unsafe (an edge may point nowhere) — stop before the
  // reachability walk.
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) }
  }

  const typedNodes = doc.nodes

  // ── LAY-001 (single root: no incoming edges to root) ────────────────────
  const parents = indexParents(typedNodes)
  if (parents.has(doc.rootNodeId)) {
    diagnostics.push(makeDiagnostic('LAY001_MULTIPLE_PARENTS', doc.rootNodeId))
  }

  // ── LAY-001 (acyclic + at-most-one-parent), iterative DFS, visited-set ──
  // onStack distinguishes a true ancestor-cycle from a diamond re-convergence
  // (two parents pointing at the same child — a DAG, not a tree).
  const visited = new Set<string>()
  const onStack = new Set<string>()
  const multiParentReported = new Set<string>()
  const cycleReported = new Set<string>()
  type Frame = { readonly id: string; childIndex: number }
  const stack: Frame[] = [{ id: doc.rootNodeId, childIndex: 0 }]
  onStack.add(doc.rootNodeId)

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]
    const node = getOwnNode(nodes, frame.id) as LayoutNode | undefined
    const children = node ? childNodeIds(node) : []
    if (!node || frame.childIndex >= children.length) {
      visited.add(frame.id)
      onStack.delete(frame.id)
      stack.pop()
      continue
    }
    const childId = children[frame.childIndex]
    frame.childIndex += 1
    if (onStack.has(childId)) {
      if (!cycleReported.has(childId)) {
        cycleReported.add(childId)
        diagnostics.push(makeDiagnostic('LAY001_CYCLE', childId))
      }
      continue
    }
    if (visited.has(childId)) {
      if (!multiParentReported.has(childId)) {
        multiParentReported.add(childId)
        diagnostics.push(makeDiagnostic('LAY001_MULTIPLE_PARENTS', childId))
      }
      continue
    }
    onStack.add(childId)
    stack.push({ id: childId, childIndex: 0 })
  }

  // ── LAY-001 (no orphans: every mapped node must be reachable from root) ──
  for (const id of Object.keys(nodes)) {
    if (!visited.has(id)) {
      diagnostics.push(makeDiagnostic('LAY001_ORPHAN_NODE', id))
    }
  }

  // ── LAY-010 (last leaf) ───────────────────────────────────────────────
  // Defensive: given the checks above pass, a finite acyclic tree with no
  // dangling children always bottoms out in >=1 terminal node. Kept as an
  // explicit, cheap assertion rather than relying on that argument implicitly.
  //
  // Wave 2 x Lane B: a `grid` counts toward "last leaf" exactly like a
  // `leaf` does (design §2.1: "grids legal wherever a leaf is") — both are
  // TERMINAL, renderable node kinds (as opposed to `split`, which is purely
  // structural and always bottoms out in a leaf/grid on both sides). Without
  // A `tabs` node is structural like a split and never counts itself.
  // Without this, `close_node` promoting a grid into the root slot when its last
  // `leaf` sibling closes (a perfectly legal sequence through the operation
  // vocabulary — operations.ts's `closeNode`) would produce a document
  // `finalizeCandidate` itself rejects as having "zero leaves", even though
  // the grid is fully renderable content. The code/message stay `LAY010_NO_LEAVES`
  // ("last leaf" is this invariant's established name throughout the design
  // docs) — see the updated message text acknowledging both kinds now count.
  let leafCount = 0
  for (const id of visited) {
    const node = getOwnNode(nodes, id) as LayoutNode | undefined
    if (node?.kind === 'leaf' || node?.kind === 'grid') leafCount++
  }
  if (leafCount === 0) {
    diagnostics.push(makeDiagnostic('LAY010_NO_LEAVES'))
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics: sortDiagnostics(diagnostics) }
  }
  return { ok: true }
}

// ── the validated immutable-document constructor (design §9.2 Phase 1 r1) ──

export type DocumentConstructionResult =
  | { readonly ok: true; readonly doc: LayoutDocument }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

/**
 * Validate `candidate`, then return a DEEP-CLONED + DEEP-FROZEN copy — never
 * the caller's own object graph. This is the ONLY exported way Phase 1 code
 * should mint a fresh, store-safe `LayoutDocument` from entirely
 * caller-supplied data (fixtures/tests, or an eventual P2 caller building an
 * initial document): once validated, the caller's original object can be
 * mutated afterward with zero effect on the returned document, and the
 * returned document itself cannot be mutated at all (both throw/no-op per
 * `Object.freeze` semantics). Because `validateLayoutDocument` now rejects any
 * node/descriptor/params carrying an unknown field, an accessor, or a
 * function BEFORE this clone ever runs (design §9.2 Phase 1 diff-review r2),
 * an executable extra field can no longer reach `deepCloneJsonValue` in the
 * first place — closing the r2 probe that found one surviving, unfrozen, in
 * the returned document.
 *
 * `operations.ts`'s `applyOperation` does NOT call this for every step (that
 * would deep-clone the entire tree on every operation, including every
 * untouched subtree); instead it clones only the ONE caller-supplied
 * descriptor a given operation newly embeds (`cloneViewDescriptor`) and then
 * deep-freezes the constructed candidate directly — cheaper, and equivalent
 * in effect, because every OTHER node in that candidate was already
 * clone-safe (either untouched-and-already-frozen from a prior step, or
 * built fresh by operations.ts itself, never aliasing caller state).
 */
export function createValidatedLayoutDocument(
  candidate: LayoutDocument,
  options?: ValidateOptions,
): DocumentConstructionResult {
  const verdict = validateLayoutDocument(candidate, options)
  if (!verdict.ok) return { ok: false, diagnostics: verdict.diagnostics }
  return { ok: true, doc: deepFreeze(deepCloneJsonValue(candidate)) }
}

// Re-exported so operations.ts (and tests) can reuse the exact same
// deep-clone-then-freeze discipline for a single caller-supplied descriptor
// without duplicating the algorithm.
export { deepCloneJsonValue as cloneJsonValue, deepFreeze } from './immutable.js'
