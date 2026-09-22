/**
 * layout/types.ts — the P2 face/resource contract (design
 * plans/shrubbery-layout-as-data-design-20260716.md §3, §4; Builder-1 task
 * brief "THE FACE CONTRACT").
 *
 * This module owns ONLY the runtime interfaces that sit ON TOP OF the Phase-1
 * document model — it imports `LayoutDocument`/`ViewDescriptor`/
 * `ResourceLocator`/`FaceParamsValidator`/`ViewportAllocation` etc. from
 * `@shrubbery/nucleus/layout` (Phase 1) and never redeclares them. Phase 1 is
 * the tree/validator/solver; this file is "what a leaf's live view looks
 * like" and "what a leaf's live resource looks like" — the split the task
 * brief calls "tiny": FaceRegistration/FaceView on one side, ResourceBroker/
 * ResourceLease on the other, joined by `FaceMountContext`.
 *
 * LAY-004 (closed behavior catalog): a `FaceRegistration` is code, assembled
 * at boot by `FaceRegistry.register` (face-registry.ts) — a `LayoutDocument`
 * leaf can only ever NAME a `faceId` string; it can never supply a `mount`
 * function, a class, or an import specifier. `paramsSchema` is REQUIRED and
 * MUST be built with Phase 1's `createExactParamsSchema` (or the zero-field
 * `noParamsAllowed`) — never Phase 1's `anyClosedParams` escape hatch, which
 * exists for a genuinely open-ended face and is exactly what this guard rail
 * (task brief: "NO open escape hatch") forbids reaching for by default.
 */
import {
  anyClosedParams,
  createExactParamsSchema,
  noParamsAllowed,
  type FaceParamsValidator,
  type ParamsFieldSchema,
  type ResourceLocator,
  type ViewDescriptor,
  type ViewportAllocation,
} from '@shrubbery/nucleus/layout'
import type { ShrubberyStore } from '@shrubbery/nucleus'

// ── geometry / constraints ──────────────────────────────────────────────────

/**
 * A solved pixel rectangle for one leaf, exactly as the Phase-1 solver
 * (`solveLayout`'s `LayoutPlanNode.allocation`) produces it — re-exported
 * under the face-facing name the task brief uses ("resize(PixelBox from the
 * Phase-1 solver)"). Structurally identical to `ViewportAllocation`; kept as
 * a distinct alias so face code never needs to know the solver's own type
 * name.
 */
export type PixelBox = ViewportAllocation

/**
 * The runtime-facing leaf sizing/overflow contract a face registration
 * declares (design §3.2). A strict SUPERSET of Phase 1's solver-scoped
 * `LeafSizeConstraints` (adds `overflow` — Phase 1 has no registry to source
 * it from, design §6.2's "obey each face's `overflow` rule"). The interpreter
 * strips `overflow` back off before calling the Phase-1 solver, which only
 * ever needs the four numeric fields.
 */
export interface LeafConstraints {
  readonly minWidth: number
  readonly minHeight: number
  /** Soft preference — advisory only (design §6.1/§6.2). */
  readonly preferredAspectRatio?: number
  readonly maxWidth?: number
  readonly maxHeight?: number
  readonly overflow: 'scroll' | 'clip'
}

/** The constraint a leaf gets when its face declares none (design §3.2's optional `constraints`). */
export const DEFAULT_LEAF_CONSTRAINTS: LeafConstraints = Object.freeze({
  minWidth: 0,
  minHeight: 0,
  overflow: 'scroll',
})

// ── persistence classification (design §3.2, §4.2) ─────────────────────────

/**
 * How a face's live `FaceView` relates to DOM relocation and repeated close/
 * reopen — the classification the interpreter needs to decide whether it may
 * safely move/reflow a leaf's wrapper (design §4.2: "a real-browser identity
 * test is a release gate").
 *
 *   - `stamp` — cheap to recreate; no meaningful ephemeral state worth
 *     preserving across a descriptor replace (e.g. a query result table).
 *   - `persistent-relocatable` — carries real local state (caret, selection,
 *     scroll, an undo lease) that MUST survive ratio/axis/focus/move/swap,
 *     but the view itself tolerates living inside a wrapper whose position
 *     changes (this interpreter never reparents a persisting wrapper at all
 *     — see `layout-interpreter.ts`'s `ensureWrapper` — so every registered
 *     face today qualifies at least this far).
 *   - `persistent-non-relocatable` — the view cannot even survive a
 *     future non-flat rendering strategy relocating its DOM subtree (e.g. a
 *     WebGL canvas that loses its context on reparent). Design §4.2's
 *     anchor/host-registry pattern is reserved for this class; v1's flat,
 *     always-root-parented wrapper strategy already satisfies it trivially,
 *     but the classification is recorded now so a future renderer that DOES
 *     nest DOM (design §6.3's `sl-split-panel` adapter) has the information
 *     it needs without re-deriving it per face.
 */
export type FacePersistence = 'stamp' | 'persistent-relocatable' | 'persistent-non-relocatable'

// ── dispose reason (design §3.2, §4.2) ──────────────────────────────────────

/**
 * Why a `FaceView` is being disposed — lets a face distinguish "this
 * attachment is truly going away" from "the interpreter is being torn down
 * wholesale" without inferring it from side channels.
 *
 *   - `closed`       — `close_leaf` removed this leaf from the tree.
 *   - `replaced`     — `replace_descriptor` incremented this leaf's
 *                       descriptor revision (LAY-007's own remount boundary).
 *   - `unmountable`  — mount/initial-resize failed after a resource lease was
 *                       already acquired; the interpreter is unwinding a
 *                       partially-constructed view, not honoring a document
 *                       change.
 *   - `shell-teardown` — `LayoutInterpreter.dispose()` tore down every
 *                       mounted leaf because the interpreter itself is going
 *                       away (design §9.1: "closing the last leaf destroys
 *                       the provider and room history once" generalizes to
 *                       "tearing down the shell does too").
 */
export type DisposeReason = 'closed' | 'replaced' | 'unmountable' | 'shell-teardown'

// ── focus ────────────────────────────────────────────────────────────────────

/**
 * Why focus is being requested (design §5.4: activation, sibling promotion,
 * directional nav, restore-on-unzoom).
 *
 *   - `promoted` (F4, repair round 3): `LayoutInterpreter.reconcile()`'s own
 *     close/promote focus handoff — the leaf that held DOM focus was just
 *     closed, and this leaf is the promoted sibling that took over its
 *     position in the tree (`layout-interpreter.ts`'s
 *     `handleFocusHandoff`/`promotedSiblingLeafId`). Never supplied by a
 *     caller — only the interpreter itself mints this reason.
 */
export type FocusReason = 'activate' | 'restore' | 'directional' | 'programmatic' | 'promoted'

export interface FocusRequest {
  readonly reason: FocusReason
}

// ── resource shapes (Two-tier lifetime guard rail — see this dir's README) ─

export type ResourceKey = string

/** Host-owned scheduling priority for asynchronous Surface resource work. */
export type SurfaceActivationPriority = 'visible' | 'background'

export interface SurfaceActivationDiagnostics {
  readonly active: number
  readonly queuedVisible: number
  readonly queuedBackground: number
  readonly maxConcurrent: number
}

/**
 * The code-owned execution policy beneath reactive Surface resources. Layout
 * documents may name resources and freshness intent; they never grant
 * themselves unbounded network concurrency.
 */
export interface SurfaceActivationScheduler {
  schedule<T>(
    task: () => Promise<T>,
    priority?: SurfaceActivationPriority,
  ): Promise<T>
  /** Resolves once every task scheduled so far has settled. */
  whenIdle(): Promise<void>
  diagnostics(): SurfaceActivationDiagnostics
}

/** Runtime services available while a derived adapter materializes its value. */
export interface ResourceComputeContext {
  readonly activation: SurfaceActivationScheduler
}

/**
 * The TWO resource shapes the broker interface MUST model (Builder-1 task
 * brief, guard rail 1):
 *
 *   - `durable`  — a stored thing with identity (document, artifact/blob):
 *     loaded once per key, REF-COUNTED across every leaf that leases it,
 *     shared reference, disposed on last release (LAY-009).
 *   - `derived`  — a COMPUTED result (a query/rollup): keyed by its inputs,
 *     refetchable and staleable, with no durable domain identity. Ordinary
 *     derived values are fresh per acquire; reactive derived stores may opt
 *     into bounded idle retention and cross-leaf sharing.
 */
export type ResourceShape = 'durable' | 'derived'

/**
 * A leased resource value. `release()` is idempotent (design §3.2's
 * `ResourceLease.release()` — calling it twice is a no-op, never a double
 * dispose). For a `durable` lease, `value` is the exact SAME object reference
 * every concurrent leaseholder of the same key holds — the "two leaves on one
 * document share one exact provider" requirement (design §9.1). For a
 * `derived` lease, sharing is adapter policy: without `retainForMs`, `value`
 * is this acquisition's own freshly computed result; with `retainForMs`, it
 * is the keyed retained value shared by concurrent/revisiting leaves.
 */
export interface ResourceLease<T = unknown> {
  readonly key: ResourceKey
  readonly shape: ResourceShape
  readonly value: T
  readonly released: boolean
  release(): void
}

interface ResourceAdapterBase {
  /** Stable id for diagnostics/duplicate-registration checks — not a security boundary. */
  readonly adapterId: string
  /** True iff this adapter knows how to resolve `locator` (mirrors `FaceRegistration.accepts`). */
  accepts(locator: ResourceLocator): boolean
  /** The canonical, stable key this locator resolves to — the ref-count/cache key. */
  resourceKey(locator: ResourceLocator): ResourceKey
}

/**
 * A durable-domain-resource adapter (design §4.1's "durable domain resource"
 * / "live resource handle" split). `load` runs exactly once per key, on the
 * FIRST acquire; `dispose` runs exactly once per key, after the LAST release.
 * A real `hoja.document` adapter's `load`/`dispose` are thin delegations to
 * the existing `EditorRoomPool` (task brief: "REUSE... do NOT duplicate its
 * key/refcount logic") — the broker's OWN ref-counting (resource-broker.ts)
 * counts LAYOUT LEASES against one key, a different granularity than the
 * pool's attachment-id counting, and does not reimplement it.
 */
export interface DurableResourceAdapter<T = unknown> extends ResourceAdapterBase {
  readonly shape: 'durable'
  load(locator: ResourceLocator): Promise<T>
  dispose(value: T, key: ResourceKey): void | Promise<void>
}

/**
 * A derived/computed-result adapter (design's query/rollup shape). By
 * default `compute` runs per `acquire()`. `retainForMs` promotes the computed
 * value to a keyed, broker-held background resource; `isStale` then governs
 * whether an idle retained value may be replaced. `dispose` is optional
 * because a derived value often needs no teardown at all.
 */
export interface DerivedResourceAdapter<T = unknown> extends ResourceAdapterBase {
  readonly shape: 'derived'
  /**
   * Optional idle retention turns the computed value into a broker-held,
   * keyed background resource. Acquires share the same value and in-flight
   * compute; after the last release it remains warm for this many
   * milliseconds before optional disposal. Omit to preserve the original
   * fresh-per-acquire derived semantics.
   */
  readonly retainForMs?: number
  compute(locator: ResourceLocator, context?: ResourceComputeContext): Promise<T>
  isStale?(value: T, locator: ResourceLocator): boolean
  dispose?(value: T, key: ResourceKey): void | Promise<void>
}

export type ResourceAdapter<T = unknown> = DurableResourceAdapter<T> | DerivedResourceAdapter<T>

export interface ResourceBrokerDiagnostics {
  /** Current ref count per durable resource key (0 entries once fully released — the key is deleted, not zeroed). */
  readonly durableRefCounts: Readonly<Record<ResourceKey, number>>
  /** Current ref count per retained-derived key, including warm zero-ref entries. */
  readonly retainedDerivedRefCounts?: Readonly<Record<ResourceKey, number>>
  /** Count of not-yet-released leases outstanding across every shape. */
  readonly outstandingLeases: number
  /** Count of failed `adapter.dispose()` calls retained since the last `takeDisposalErrors()` drain (never thrown from `release()` itself — see `resource-broker.ts`'s `runDisposal`). */
  readonly disposalErrorCount: number
}

/**
 * `ResourceBroker.acquire(locator, adapterId): ResourceLease` — the
 * authoritative-resource seam (task brief). Returns a `Promise` because a
 * real durable `load` (opening a room, fetching a blob) is inherently
 * asynchronous; this matches design §3.2's own
 * `FaceRegistration.acquire(...): Promise<ResourceLease>`.
 *
 * `adapterId` is REQUIRED (diff-review r2 WRONG: "the broker silently
 * selects the first adapter whose accepts() returns true ... two faces
 * needing different projections of the same resource kind are therefore
 * order-dependent and can receive the wrong lease value"). The caller — in
 * practice `LayoutInterpreter`, using the mounting `FaceRegistration`'s own
 * `resourceAdapterId` — names EXACTLY which registered adapter must resolve
 * `locator`; the broker never scans for the first adapter whose `accepts()`
 * happens to return true. It still calls that NAMED adapter's `accepts()` as
 * a mismatch guard (a face declaring the wrong adapter id for its resource
 * kind is a programming error, not a silently-tolerated one).
 */
export interface ResourceBroker {
  /** Bootstrap-time registration only — mirrors `FaceRegistry.register`'s closed-catalog discipline. */
  registerAdapter(adapter: ResourceAdapter): void
  acquire(locator: ResourceLocator, adapterId: string): Promise<ResourceLease>
  diagnostics(): ResourceBrokerDiagnostics
}

// ── the face contract ────────────────────────────────────────────────────────

export interface FaceMountContext<D extends ViewDescriptor = ViewDescriptor> {
  /** The leaf wrapper element this view mounts into — owned by the interpreter, stable across resize/move (LAY-007). */
  readonly target: HTMLElement
  readonly descriptor: D
  readonly lease: ResourceLease
  readonly constraints: LeafConstraints
}

/**
 * A leaf's live, client-local rendered identity (design §3.2/§4.2). One leaf
 * has at most one active `FaceView`. `resize` MUST NOT write layout state
 * (design §3.2: "may be called many times and MUST NOT write layout state").
 * `serialize()` returns a VALIDATED descriptor reflecting the view's current
 * durable intent (design §3.2: "returns a validated descriptor, not
 * ephemeral state") — e.g. a face that lets its params drift locally
 * (a table's `maxRows`) reports the CURRENT value here, not the mount-time
 * one; a face with no such drift may simply return the descriptor it was
 * mounted with. `dispose(reason)` releases the VIEW only — it never releases
 * the resource lease; the interpreter (which handed the lease to `mount`)
 * owns calling `lease.release()` after `dispose()` resolves, and it is
 * responsible for calling `dispose()` in the first place even when a prior
 * step (e.g. this SAME view's own initial `resize()`) has thrown — see
 * `layout-interpreter.ts`'s `mountLeaf`/`teardownMountedLeaf`.
 */
export interface FaceView<D extends ViewDescriptor = ViewDescriptor> {
  focus(request: FocusRequest): boolean | Promise<boolean>
  blur(): void | Promise<void>
  resize(box: PixelBox, constraints: LeafConstraints): void
  serialize(): D
  /** Best-effort EPHEMERAL view state (scroll/selection/sort) — never shared, never part of `ViewDescriptor`. */
  serializeViewState?(): unknown
  hydrateViewState?(state: unknown): void
  dispose(reason: DisposeReason): void | Promise<void>
}

/**
 * A CLOSED registry entry (LAY-004): data selects a face by `faceId` string;
 * code supplies everything else. Registered once, at boot, by
 * `FaceRegistry.register` — never constructed from document/agent data.
 */
export interface FaceRegistration<D extends ViewDescriptor = ViewDescriptor> {
  readonly faceId: string
  /**
   * How this face's live view relates to DOM relocation (design §3.2, §4.2)
   * — see `FacePersistence`. REQUIRED, not inferred: the interpreter cannot
   * safely guess whether a view tolerates being moved.
   */
  readonly persistence: FacePersistence
  /**
   * The EXACT registered `ResourceAdapter.adapterId` this face's resource is
   * acquired through (design §3.1: "the authority maps each face
   * registration to its resource adapter"). Required, not inferred: without
   * it, `ResourceBroker.acquire` would have to guess which of possibly
   * several adapters accepting the same locator KIND is the one THIS face
   * actually wants — order-dependent and silently wrong whenever two faces
   * need different projections of the same resource kind (diff-review r2
   * WRONG). The interpreter passes this id straight through to
   * `broker.acquire(descriptor.resource, registration.resourceAdapterId)`.
   */
  readonly resourceAdapterId: string
  /** Defense in depth beyond `faceId` lookup: does THIS face actually make sense over this resource kind? */
  accepts(locator: ResourceLocator): boolean
  /**
   * CLOSED params validator — a `ClosedFaceParamsSchema`, constructible only
   * through `closedParamsSchema`/`noFaceParams` (or the explicit,
   * justification-bearing `sealedOpenFaceParamsSchema` escape hatch) below.
   * Phase 1's raw `createExactParamsSchema`/`noParamsAllowed`/
   * `anyClosedParams` are NOT directly assignable here — see this file's
   * "closed params branding" section for why a bare `FaceParamsValidator`
   * function is not enough of a guard rail on its own.
   */
  readonly paramsSchema: ClosedFaceParamsSchema
  mount(context: FaceMountContext<D>): FaceView<D> | Promise<FaceView<D>>
  /** Declared in CODE, not layout data (design §6.2: "an agent cannot claim zero minimum for a WebGL face"). */
  constraints?(descriptor: D): LeafConstraints
}

// ── closed params branding ──────────────────────────────────────────────────
//
// `FaceParamsValidator` (Phase 1) is just `(params) => boolean` — ANY
// function of that shape typechecks, including a bare `() => true` or Phase
// 1's own `anyClosedParams` escape hatch, typed at a bare property. That
// makes LAY-004's "each face registration owns a CLOSED descriptor schema"
// a matter of convention at the P2 boundary, not something the type system
// enforces (diff-review SUSPECT: "closure is convention, not enforced by the
// contract"). A nominal brand closes that: only `closedParamsSchema`,
// `noFaceParams`, and the explicit `sealedOpenFaceParamsSchema` escape hatch
// below ever produce a `ClosedFaceParamsSchema` — a raw arrow function,
// however innocuous-looking, fails to typecheck as a `FaceRegistration.
// paramsSchema` value.
declare const CLOSED_FACE_PARAMS_BRAND: unique symbol
export type ClosedFaceParamsSchema = FaceParamsValidator & { readonly [CLOSED_FACE_PARAMS_BRAND]: true }

function brand(validator: FaceParamsValidator): ClosedFaceParamsSchema {
  return validator as ClosedFaceParamsSchema
}

/** Build a real, closed, per-face params schema — the P2-branded wrapper around Phase 1's `createExactParamsSchema`. */
export function closedParamsSchema(fields: Readonly<Record<string, ParamsFieldSchema>>): ClosedFaceParamsSchema {
  return brand(createExactParamsSchema(fields))
}

/** A face that takes no params at all — the P2-branded wrapper around Phase 1's `noParamsAllowed`. */
export const noFaceParams: ClosedFaceParamsSchema = brand(noParamsAllowed)

/**
 * One recorded call to `sealedOpenFaceParamsSchema` — a boot-time-auditable
 * log entry, not just a call-site comment (diff-review r2 SUSPECT: "closed
 * params actually enforced" — a justification nobody can ever list/query is
 * not machine-auditable, whatever it says).
 */
export interface SealedOpenFaceParamsUsage {
  readonly justification: string
  readonly recordedAt: string
}

const sealedOpenFaceParamsUsages: SealedOpenFaceParamsUsage[] = []

/**
 * Every `sealedOpenFaceParamsSchema()` call made so far, in call order — a
 * lint/boot-audit hook can assert on its length (e.g. "still zero — v1 has
 * no genuinely open-ended face") or inspect each justification without
 * grepping source. Never used by the interpreter/registry themselves; purely
 * an inspection surface.
 */
export function listSealedOpenFaceParamsUsages(): readonly SealedOpenFaceParamsUsage[] {
  return sealedOpenFaceParamsUsages.slice()
}

/**
 * The explicit escape hatch for a face with GENUINELY open-ended params
 * (design's own `anyClosedParams` doc comment: "reserve this for a face that
 * has genuinely open-ended params by design"). Unlike reaching for
 * `anyClosedParams` directly, this REQUIRES a human-readable justification
 * string at the call site — the open choice is visible in code, not silently
 * reachable by picking the same import everything else uses.
 *
 * The justification is now ENFORCED, not merely accepted (diff-review r2
 * SUSPECT: "even an empty string is accepted... the branded type is not
 * constructible only through exact/no-params helpers as the prior repair
 * requested"): an empty or whitespace-only string throws at the call site —
 * boot fails loudly, not a silently-accepted no-op justification — and every
 * successful call is retained in `listSealedOpenFaceParamsUsages()` for a
 * real audit pass, not just typed dead code nobody can enumerate.
 */
// F5 (repair round 3, faces-mvp review): a REAL runtime symbol (not the
// type-only `unique symbol` brand above, which erases at compile time and
// carries no runtime value) — set on every schema `sealedOpenFaceParamsSchema`
// mints, so `isSealedOpenFaceParamsSchema` (and `FaceRegistry`'s own
// allowlist gate below) can detect an open schema at runtime, not just by
// convention/review.
const SEALED_OPEN_FACE_PARAMS_MARKER = Symbol('sealed-open-face-params-schema')

export function sealedOpenFaceParamsSchema(justification: string): ClosedFaceParamsSchema {
  const trimmed = justification.trim()
  if (trimmed.length === 0) {
    throw new Error(
      'sealedOpenFaceParamsSchema: a non-empty justification is required — this is the reviewed open-params ' +
        'escape hatch, not a convenience default. State WHY this face genuinely needs open-ended params.',
    )
  }
  sealedOpenFaceParamsUsages.push({ justification: trimmed, recordedAt: new Date().toISOString() })
  // A FRESH wrapper closure per call (never the bare shared `anyClosedParams`
  // singleton itself) — the marker below is set on THIS call's own function
  // object, never mutating a Phase-1-level constant other, unbranded callers
  // might also hold a reference to.
  const schema = brand((params) => anyClosedParams(params))
  Object.defineProperty(schema, SEALED_OPEN_FACE_PARAMS_MARKER, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return schema
}

/**
 * F5 (repair round 3) — read-only detector: true iff `schema` was produced
 * by `sealedOpenFaceParamsSchema` (the reviewed open-params escape hatch),
 * never by `closedParamsSchema`/`noFaceParams`. Exported publicly — it
 * GRANTS no capability, only INSPECTS one — so `FaceRegistry`'s own
 * allowlist gate (face-registry.ts) can refuse an open-schema registration
 * by default, and any other defense-in-depth caller can do the same.
 */
export function isSealedOpenFaceParamsSchema(schema: ClosedFaceParamsSchema): boolean {
  return (schema as unknown as { readonly [SEALED_OPEN_FACE_PARAMS_MARKER]?: true })[SEALED_OPEN_FACE_PARAMS_MARKER] === true
}

// ── grid collection query contract (Wave 2 x Lane B spec
// plans/surface-wave2-laneb-slice-20260716.md §3; layout-interpreter.ts's own
// grid renderer) ─────────────────────────────────────────────────────────────

/**
 * One SPARQL-binding-shaped term inside a grid collection row. Deliberately
 * NOT `QueryBlockTerm` (`../editor-services/query-block-service.js`): the
 * core interpreter (this file's consumer, `layout-interpreter.ts`) must stay
 * independent of any one query-execution service — only a concrete
 * `ResourceAdapter` registration, built and wired elsewhere (mirroring
 * `faces/query-handle-resource-adapter.ts`'s own adapter-per-face pattern),
 * bridges to a real `QueryBlockService`. Every `QueryBlockTerm` variant DOES
 * carry a `.value: string`, so a real adapter's `QueryBlockResult` ('bindings'
 * and 'ask' both carry `rows: readonly QueryBlockRow[]`) is structurally
 * assignable here with no adapter-side translation required.
 *
 * `type` is OPTIONAL (kept structurally decoupled from `QueryBlockTerm`, same
 * rationale as `.value` above — this interface must not require the full
 * `QueryBlockTerm` shape), but the grid renderer's own `?item` identity check
 * (spec §2.1: "SELECT must bind `?item` (IRI)") reads it when present: a real
 * `QueryBlockTerm` always carries `type: 'uri' | 'bnode' | 'literal'`, so a
 * production row structurally satisfies this without translation, and
 * `runGridCollectionRefresh` can tell an `?item` genuinely bound to a URI
 * apart from one bound to a literal/blank node that merely happens to share
 * the same `.value: string` shape.
 */
export interface GridCollectionTerm {
  readonly value: string
  readonly type?: 'uri' | 'bnode' | 'literal'
}

/** One collection-query result row, keyed by SPARQL variable name (no leading `?`). */
export type GridCollectionRow = Readonly<Record<string, GridCollectionTerm | undefined>>

export interface GridCollectionQueryResult {
  readonly rows: readonly GridCollectionRow[]
  /**
   * The TRUE row count the collection query matched, BEFORE any fetch-layer
   * clamp (`grid-collection-query-resource-adapter.ts`'s own `SERVICE_MAX_ROWS`
   * / `query-block-service.ts`'s own 500-row `normalizeResult` clamp) sliced
   * `rows` down. Grid-laneb review r1 WRONG finding (c): the interpreter's
   * count badge previously compared `shown.length` against `rows.length` —
   * but `rows` was ALREADY clamped to at most 500 by the fetch layer, so a
   * 700-row match silently rendered as "500 of 500", never surfacing the real
   * truncation. `totalRowCount` is the one honest denominator for "showing N
   * of M" (`updateGridCountBadge`) — always the FULL match count, never the
   * post-clamp `rows.length`.
   */
  readonly totalRowCount: number
}

/**
 * The DERIVED-lease value a grid's `collection` children source resolves to
 * (spec §3: "the grid holds a derived lease on the collection query").
 * Mirrors `faces/query-handle-resource-adapter.ts`'s own reactive store
 * shape: the CALLER (here, `LayoutInterpreter`'s own refresh tick) decides
 * cadence, never the adapter/broker. It is declared independently rather
 * than imported from `faces/`, for the same reason `GridCollectionTerm` is:
 * the core interpreter must not depend on any one face's adapter module.
 */
export interface GridCollectionQueryHandle extends ShrubberyStore<GridCollectionQueryResult> {
  /** Compatibility one-shot over the same reactive store. */
  run(): Promise<GridCollectionQueryResult>
}
