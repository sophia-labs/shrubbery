/**
 * source-object-service.ts — the `SourceObjectService` seam (WS1 §5.2/§6.1/
 * §6.2, master spec §2.5, §3 Slice 2).
 *
 * The `card.object` face's ONE seam onto the source register: one
 * current-state Meaningful Object, read either from the offline mirror
 * (primary) or the live cell's RDF projection (an explicit, degraded,
 * provenance-stamped fallback — D-3). Declared here, in `@shrubbery/runtime`,
 * and implemented in `apps/organism` over `SourceMirrorRuntime` — the exact
 * split `QueryBlockService` already draws (`editor-services/query-block-
 * service.ts`, wired at `fragment-face-set.ts:97`). `@shrubbery/runtime`'s
 * `package.json` lists `@shrubbery/source` only as a devDependency (D-4): this
 * module has ZERO imports from `@shrubbery/source`, so the package graph is
 * never inverted.
 *
 * Also owns the `urn:sophia:object:` codec (D-2, §6.1) — a client-minted,
 * lossless, reversible encoding of an emporium `objectKey`
 * (`vocab  class  objectId`, garden `source_sync.rs:758-760`)
 * carried in the CLOSED `graph` resource locator's optional `subjectIri`
 * (`packages/nucleus/src/layout/types.ts:68`) — no new locator kind, no new
 * keys.
 *
 * ALSO REACHABLE via `@shrubbery/runtime/layout/source-object-service-internal`
 * (master §3 Slice 5) — this module has ZERO Lit dependencies (D-5's own
 * "deliberately dumb", enforced package-wide), but the PUBLIC
 * `@shrubbery/runtime/layout` barrel (`layout/index.ts`) re-exports it
 * ALONGSIDE `faces/index.ts`, whose `@customElement`-decorated view
 * elements call `customElements.define` at module load time and crash any
 * plain-Node script with no DOM (verified empirically: "Unsupported
 * decorator location: field" from `stat-scalar-view-element.ts`). A
 * Node-only real-cell script that needs `objectKeyOf`/`ObjectKeyParts`/etc.
 * — `apps/organism`'s `createSourceObjectService` does — imports THIS
 * subpath directly rather than the full barrel, mirroring
 * `sealed-open-face-params-internal.ts`'s own narrow-subpath pattern
 * (same mechanism, different reason: DOM-safety here, not quarantine).
 */
import { resourceKeyTuple } from './resource-key.js'
import type { ResourceKey } from './types.js'
import type { ResourceLocator } from '@shrubbery/nucleus/layout'

// ── the object URN codec (§6.1) ─────────────────────────────────────────────

export const OBJECT_URN_PREFIX = 'urn:sophia:object:'

/** The three parts of an emporium `objectKey`, unencoded. */
export interface ObjectKeyParts {
  readonly vocab: string
  readonly class: string
  readonly objectId: string
}

// Only `:` (the URN's own separator) and `%` (so the escape is
// self-describing) are ever escaped. Garden validates `objectId` as
// `[A-Za-z0-9._:-]`, <=160 bytes (`validate_stable_id`, source_sync.rs:
// 741-756, applied at :812), and vocab/class come from the frozen vocab
// registry, so a real key needs at most the `:` escape; `%` is handled for
// totality, never because a real id contains one.
function encodeSegment(part: string): string {
  return part.replace(/[%:]/g, (ch) => (ch === '%' ? '%25' : '%3A'))
}

// ONE pass — a two-pass `%3A` then `%25` decode would turn `%253A` into `:`.
function decodeSegment(part: string): string {
  return part.replace(/%(25|3[Aa])/g, (_m, code: string) => (code === '25' ? '%' : ':'))
}

/**
 * `objectKey` parts -> a stable, reversible URN. THROWS on an empty part — a
 * locator that cannot round-trip is a programming error, never a
 * silently-truncated URN.
 */
export function objectUrn(parts: ObjectKeyParts): string {
  if (!parts.vocab || !parts.class || !parts.objectId) {
    throw new Error(`objectUrn: every part must be non-empty (got ${JSON.stringify(parts)})`)
  }
  return `${OBJECT_URN_PREFIX}${encodeSegment(parts.vocab)}:${encodeSegment(parts.class)}:${encodeSegment(parts.objectId)}`
}

/** The inverse of `objectUrn`. Returns `null` for any string that is not a well-formed object URN. */
export function parseObjectUrn(urn: string): ObjectKeyParts | null {
  if (!urn.startsWith(OBJECT_URN_PREFIX)) return null
  const rest = urn.slice(OBJECT_URN_PREFIX.length)
  const parts = rest.split(':')
  if (parts.length !== 3) return null
  const [vocab, cls, objectId] = parts
  if (!vocab || !cls || !objectId) return null
  return { vocab: decodeSegment(vocab), class: decodeSegment(cls), objectId: decodeSegment(objectId) }
}

/** The wire form the cell speaks: `vocab  class  objectId` (garden `source_sync.rs:758-760`). */
export function objectKeyOf(parts: ObjectKeyParts): string {
  return `${parts.vocab}${parts.class}${parts.objectId}`
}

/** The inverse of `objectKeyOf`; `null` when the string is not a well-formed 3-part key. */
export function parseObjectKey(objectKey: string): ObjectKeyParts | null {
  const parts = objectKey.split('')
  if (parts.length !== 3) return null
  const [vocab, cls, objectId] = parts
  if (!vocab || !cls || !objectId) return null
  return { vocab, class: cls, objectId }
}

// ── the value type (§6.2.1) ─────────────────────────────────────────────────

/** WHICH read produced this value. Never inferred by the view; always carried. */
export type SourceObjectProvenance =
  /** A verified complete local mirror epoch: record + version + strategy + candidates. */
  | 'mirror'
  /** The live cell's RDF projection (`emporium_read`): fields only. */
  | 'authority-projection'

/** One proposal in a contested object's fold (`CurrentCandidateFace`, garden `source_sync.rs:370-377`). */
export interface SourceObjectCandidate {
  readonly operationId: string
  readonly sourceVersion: string
  readonly baseVersion: string
  readonly record: Readonly<Record<string, unknown>>
  /** Ask A (WS4). Absent until Garden widens `CurrentCandidateFace`. */
  readonly clientId?: string
  /** Ask A (WS4). Absent until Garden widens `CurrentCandidateFace`. An opaque ordering value — NEVER a timestamp. */
  readonly causalOrder?: number
}

/** The contest, when there is one (`SyncConflict`, garden `source_sync.rs:379-389`). */
export interface SourceObjectContest {
  readonly conflictId: string
  readonly baseVersion: string
  readonly reason: string
  /** In the cell's own wire order — HASH order, never time order (D-14). */
  readonly candidates: readonly SourceObjectCandidate[]
  /** The head the fold projected; ALWAYS provisional while a contest is open. */
  readonly projectedOperationId: string
}

/** Optional class metadata from `bundle.sourceRegistry` (garden `source_sync.rs:3645-3683`). */
export interface SourceObjectClassInfo {
  readonly identityKind?: string
  readonly storeTarget?: string
  readonly storeMode?: string
  readonly dispatchMode?: string
}

/** Facts this read could NOT establish — confessed, never defaulted. */
export type SourceObjectUnavailable = 'sourceVersion' | 'reconciliationStrategy' | 'contest' | 'lastWriter'

export interface SourceObjectRead {
  readonly provenance: SourceObjectProvenance
  readonly graphId: string
  readonly objectKey: string
  readonly vocab: string
  readonly class: string
  readonly objectId: string
  /** The head record. Field order is NOT meaningful — the face sorts. */
  readonly record: Readonly<Record<string, unknown>>
  /** sha256 of the candidate binding (garden `source_sync.rs:836-847`). Absent on the authority path. */
  readonly sourceVersion?: string
  /** One of the five labels (`reconciliation_strategy_label`, garden `source_sync.rs:762-770`). */
  readonly reconciliationStrategy?: string
  /**
   * THE STANCE AUTHORITY. Present iff the fold produced a `SyncConflict` for
   * this object THIS EPOCH — lifted straight from `CurrentObjectFace.
   * conflictId`, which rides INSIDE the manifest digest closure. `contest`
   * below can be legitimately absent even when this is set (the bundle's
   * `conflicts` array rides OUTSIDE the digest closure) — a reader that only
   * checks `contest !== undefined` would render a genuinely contested object
   * as clean, silently, on that (real) epoch. See `unavailable`.
   */
  readonly conflictId?: string
  /**
   * The contest's full detail — present iff `conflictId` is set AND
   * `bundle.conflicts` carried a matching, parseable entry this epoch. MAY
   * BE UNDEFINED even when `conflictId` is set; that combination is the
   * "contested-but-degraded" case and is why `unavailable` can contain
   * `'contest'` while the object is still, truthfully, contested.
   */
  readonly contest?: SourceObjectContest
  /** Ask A (WS4). The head's provenance — absent until Garden widens `CurrentObjectFace`. */
  readonly lastWriter?: { readonly operationId: string; readonly clientId?: string }
  readonly classInfo?: SourceObjectClassInfo
  /** EXACTLY the facts this provenance cannot supply. Drives the view's absence copy. */
  readonly unavailable: readonly SourceObjectUnavailable[]
  /** The mirror epoch (`graph-incarnation:revision:manifest-hash`) — mirror path only. */
  readonly epoch?: string
}

export class SourceObjectServiceError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'SourceObjectServiceError'
  }
}

/**
 * The ONE seam `card.object` resolves through — structurally typed and
 * dependency-free, exactly like `QueryBlockService`. `@shrubbery/runtime`
 * declares it; `apps/organism` implements it over `SourceMirrorRuntime`.
 * Runtime NEVER imports `@shrubbery/source` (D-4).
 */
export interface SourceObjectService {
  /**
   * Read one current-state object. NEVER returns a partially-fabricated
   * value: either a `SourceObjectRead` whose `unavailable` names every
   * missing fact, or a rejection (thrown) carrying the underlying error
   * verbatim.
   *
   * Resolves to `null` — a first-class EMPTY, not an error — when the object
   * genuinely does not exist in this graph at this epoch.
   */
  read(graphId: string, key: ObjectKeyParts): Promise<SourceObjectRead | null>
}

// ── the locator (§6.1) ──────────────────────────────────────────────────────

/**
 * `card.object`'s `FaceRegistration.accepts` / `ResourceAdapter.accepts`
 * predicate. `subjectIri === undefined` is the EMPTY-SELECTION locator — WS2's
 * contested split mints a `card.object` leaf on every render, including
 * before anything is selected, and needs an honest `status:'empty'` leaf to
 * mount into rather than a `resource-rejected` diagnostic. `subjectIri` is
 * optional on the closed `graph` locator kind
 * (`packages/nucleus/src/layout/types.ts:68`), so this stays inside the
 * closed union with no widening.
 */
export function isCardObjectLocator(locator: ResourceLocator): boolean {
  if (locator.kind !== 'graph') return false
  if (locator.subjectIri === undefined) return true
  return typeof locator.subjectIri === 'string' && parseObjectUrn(locator.subjectIri) !== null
}

/**
 * `objectKey === null` ⇒ `{kind:'graph', graphId}` with NO `subjectIri` — the
 * honest "nothing selected" locator, accepted by `card.object` and rendered
 * as `status:'empty'` with the choose-an-object copy. NOT an error and NOT a
 * rejected resource.
 */
export function objectLocator(graphId: string, objectKey: string | null): ResourceLocator {
  if (objectKey === null) return { kind: 'graph', graphId }
  const parts = parseObjectKey(objectKey)
  if (!parts) throw new Error(`objectLocator: '${objectKey}' is not a well-formed objectKey`)
  return { kind: 'graph', graphId, subjectIri: objectUrn(parts) }
}

/**
 * The collision-safe resource key for `card.object`'s adapter (§6.1's
 * "Resource key"). The empty-selection locator gets its own stable key
 * (never colliding with a real object's) so selecting an object and clearing
 * it does not thrash one shared retained store.
 */
export function cardObjectResourceKey(locator: ResourceLocator): ResourceKey {
  const graphId = (locator as { readonly graphId: string }).graphId
  const subjectIri = (locator as { readonly subjectIri?: string }).subjectIri
  if (subjectIri === undefined) return resourceKeyTuple('card-object', graphId, undefined)
  const parts = parseObjectUrn(subjectIri)
  if (!parts) throw new Error('card.object: resource adapter given a non-object locator')
  return resourceKeyTuple('card-object', graphId, objectKeyOf(parts))
}

// ── exposed to WS2 (master §2.5) ────────────────────────────────────────────

/** `card.object`'s closed descriptor params — mirrors `card-object-face.ts`'s own schema shape (§6.7). */
export interface CardObjectParams {
  readonly titleField?: string
  readonly fields?: string
  readonly showProposals?: boolean
  readonly maxFields?: number
}

/**
 * Params for the contested split's card leaf. Can only ever return
 * `{showProposals:true}` or `undefined`: `card.object`'s params schema has no
 * `conflictId` field and needs none — the card derives the contest from the
 * READ, not the descriptor (D-15). Exists so a caller never hand-assembles
 * params against a closed schema.
 */
export function contestedCardParams(
  selection: { readonly objectKey: string; readonly conflictId: string } | null,
): CardObjectParams | undefined {
  return selection ? { showProposals: true } : undefined
}
