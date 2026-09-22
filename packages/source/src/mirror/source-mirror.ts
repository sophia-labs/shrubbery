/**
 * Source Mirror — the invisible, source-aware store behind Surface Activation.
 *
 * A mirror record is committed as one value. `complete: true` is trusted only
 * after every manifest member has been re-hashed and the whole manifest hash
 * matches. Stable intents are written to the outbox before they are exposed as
 * durable local mutations; retries retain their original operation identity.
 *
 * `SourceMirrorState`'s fault register (master spec §2.1, §2.2, §3 Slice 3)
 * is classified through `./source-fault.js` — the one taxonomy, shared with
 * `graph-lifecycle.ts` and (via the package barrel) every downstream reader.
 */
import {
  FENCE_CODES,
  PERMANENT_CODES,
  TARGETED_PERMANENT_CODES,
  classifySourceFault,
  isFenceFault,
  type SourceFault,
  type SourceFaultCode,
} from './source-fault.js'

export interface SourceManifestMember {
  readonly sourceKind: 'ydoc' | 'event-log' | 'current-state' | 'derived'
  readonly objectId: string
  readonly objectIncarnation?: string | null
  readonly sourceVersion: string
  readonly localDigest: string
  readonly durable: boolean
}

export interface SourceMirrorManifest {
  readonly sourceManifestHash: string
  readonly members: readonly SourceManifestMember[]
  readonly complete: boolean
}

export interface SourceProjectionSnapshot {
  readonly format: 'application/n-quads'
  readonly data: string
  readonly digest: string
  readonly quadCount: number
  readonly sourceRevision: number
}

export interface SourceDocumentSnapshot {
  readonly documentId: string
  readonly documentIncarnation: string
  readonly revision: number
  readonly updateBase64: string
  readonly digest: string
}

export interface SourceResourceSnapshot {
  readonly resourceId: string
  readonly kind: 'original' | 'artifact-revision' | string
  readonly path: string
  readonly filename: string
  readonly mediaType: string
  readonly sizeBytes: number
  readonly digest: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly dataBase64: string
}

export interface SourceDocumentHistorySnapshot {
  readonly historyId: string
  readonly documentId: string
  readonly snapshotId: string
  readonly meta: Readonly<Record<string, unknown>>
  readonly payload: Readonly<Record<string, unknown>>
}

export interface SourceSemanticCorpusEntry {
  readonly semanticId: string
  readonly kind: string
  readonly graphId: string
  readonly documentId: string
  readonly documentTitle: string
  readonly blockId: string
  readonly blockType: string
  readonly content: string
  readonly contentHash: string
  readonly order: number
}

export interface SourceLegacyBaseline {
  readonly ledgerRevision: number
  readonly capturedAtMs: number
  readonly rdfSnapshot: {
    readonly format: 'application/n-quads'
    readonly data: string
    readonly digest: string
    readonly quadCount: number
  }
  readonly valuationStores: Readonly<Record<string, string>>
}

/**
 * Ask A's client contract (MO object-face integration spec, master §3 Slice
 * 0/WS4 §4.1.7; build bundle review finding 6, 2026-07-31). Garden emits
 * these field-for-field (`source_sync.rs`'s `CurrentObjectFace`/
 * `CurrentCandidateFace`/`SyncConflict`) — this is the client-side typing
 * and validation half of the same wire contract, previously untyped
 * `Record<string, unknown>[]` positions on `SourceBundle` below.
 */
export type SourceReconciliationStrategy =
  | 'producerDirected'
  | 'contested'
  | 'causalLww'
  | 'evidenceWeighted'
  | 'codeBacked'

/** Runtime mirror of `SourceReconciliationStrategy`, for shape validation
 *  (`validateSourceConflictShape`, below) — a union type alone gives no
 *  runtime check. */
export const SOURCE_RECONCILIATION_STRATEGIES: readonly SourceReconciliationStrategy[] = [
  'producerDirected',
  'contested',
  'causalLww',
  'evidenceWeighted',
  'codeBacked',
]

/** A single proposal for a contested object's current state. Field-for-
 *  field the cell's `CurrentCandidateFace` (garden source_sync.rs:370-377). */
export interface SourceConflictCandidate {
  readonly operationId: string
  readonly sourceVersion: string
  readonly baseVersion: string
  readonly record: Readonly<Record<string, unknown>>
  /** Verbatim writer token from the operation. Absent on pre-attribution
   *  rows and on any operation that declared none. Never synthesised. */
  readonly clientId?: string
  /** Opaque ordering value the writer supplied. NOT a timestamp on the wire
   *  contract, even though both shipping writers fill it with epoch ms.
   *  Wire domain is i64; this field is a JS `number`, so a value outside
   *  `Number.isSafeInteger` is a contract violation `validateSourceCandidate
   *  Shape` (below) rejects on read, mirroring Garden's own D17 write-time
   *  guard. */
  readonly causalOrder?: number
  readonly evidenceWeight?: number
}

/** An object whose current state has at least one recorded proposal — a
 *  *contest* requires two or more concurrent siblings, but the missing-base
 *  shape (Garden D19) can legitimately name exactly one orphaned candidate
 *  while the projected head is a separate, already-settled operation. Do
 *  NOT read `candidates.length > 1` as "contested"; read `conflictId !=
 *  null` on the object face instead. Field-for-field the cell's
 *  `SyncConflict` (garden source_sync.rs:379-389). */
export interface SourceConflict {
  readonly conflictId: string
  readonly objectKey: string
  readonly baseVersion: string
  readonly reconciliationStrategy: SourceReconciliationStrategy
  readonly reason: string
  readonly candidates: readonly SourceConflictCandidate[]
  /** Always a member of `candidates` — enforced server-side (Garden D19)
   *  and reverified client-side by `validateSourceConflictShape`. */
  readonly projectedOperationId: string
}

/** The current-state face of one Meaningful Object. Field-for-field the
 *  cell's `CurrentObjectFace` (garden source_sync.rs:356-368). */
export interface SourceCurrentObject {
  readonly objectKey: string
  readonly vocab: string
  readonly class: string
  readonly objectId: string
  readonly sourceVersion: string
  readonly record: Readonly<Record<string, unknown>>
  readonly reconciliationStrategy: SourceReconciliationStrategy
  /** Present iff this head is provisional — a live contest exists. */
  readonly conflictId?: string
  /** Absent only on a pre-Ask-A cell. */
  readonly operationId?: string
  readonly clientId?: string
}

/** Integers are contract versions; absent means unsupported (Ask A/B). Never
 *  consulted to *interpret* an error — only to decide whether a regex
 *  fault-classification fallback may retire. */
export interface SourceCapabilities {
  readonly typedErrorCodes?: number
  readonly candidateAttribution?: number
  readonly conflictsDigest?: number
  readonly [key: string]: unknown
}

export interface SourceBundle {
  readonly schemaVersion: number
  readonly graphId: string
  readonly graphIncarnation: string
  /** Locally complete empty authority awaiting identity-matched graph creation. */
  readonly provisional?: boolean
  readonly revision: number
  readonly epoch: string
  readonly complete: boolean
  readonly manifest: SourceMirrorManifest
  readonly workspace: {
    readonly updateBase64: string
    readonly digest: string
  }
  readonly graphMetadata?: {
    readonly title: string
    readonly description?: string | null
    readonly status?: string
    readonly createdAt?: string
    readonly updatedAt?: string
    readonly createdByOperationId?: string | null
  }
  readonly documents: readonly SourceDocumentSnapshot[]
  readonly resources?: readonly SourceResourceSnapshot[]
  readonly documentHistory?: readonly SourceDocumentHistorySnapshot[]
  readonly semanticCorpus?: readonly SourceSemanticCorpusEntry[]
  readonly derivedCapabilities?: {
    readonly semanticSearch?: {
      readonly algorithm: string
      readonly sourceRevision: number
      readonly offline: boolean
    }
    readonly [key: string]: unknown
  }
  readonly currentState: readonly SourceCurrentObject[]
  readonly events: readonly Record<string, unknown>[]
  readonly memory: readonly Record<string, unknown>[]
  readonly valuations: readonly Record<string, unknown>[]
  readonly retractions: readonly Record<string, unknown>[]
  readonly legacyBaseline: SourceLegacyBaseline
  readonly valuationStores: Readonly<Record<string, string>>
  readonly conflicts: readonly SourceConflict[]
  /** sha256 over JCS-canonical `conflicts` (Ask A D6/§4.1.5) — `conflicts`
   *  rides OUTSIDE the manifest closure by design (adding it would be a
   *  flag day; see the design doc), bound by this sibling field instead.
   *  `undefined` on an older cell; `conflicts`' own SHAPE is still
   *  validated regardless of whether this digest is present. */
  readonly conflictsDigest?: string
  readonly sourceCapabilities?: SourceCapabilities
  readonly receipts: readonly SourceOperationReceipt[]
  readonly sourceRegistry: readonly Record<string, unknown>[]
  readonly projectionSnapshot: SourceProjectionSnapshot
  readonly [key: string]: unknown
}

export interface SourceOperation {
  readonly kind: string
  readonly operationId: string
  readonly [key: string]: unknown
}

export interface SourceOperationReceipt {
  readonly operationId: string
  readonly digest: string
  readonly acceptedRevision: number
  readonly status: 'accepted' | 'applied'
  readonly duplicate: boolean
  readonly outcome: Readonly<Record<string, unknown>>
  readonly effectError?: string
}

export interface SourcePushResult {
  readonly ok: boolean
  readonly graphId: string
  readonly graphIncarnation: string
  readonly revision: number
  readonly receipts: readonly SourceOperationReceipt[]
  readonly [key: string]: unknown
}

export interface SourceSyncTransport {
  pull(graphId: string, graphIncarnation?: string): Promise<SourceBundle>
  push(
    graphId: string,
    graphIncarnation: string,
    operations: readonly SourceOperation[],
  ): Promise<SourcePushResult>
}

export interface SourceMirrorIdentity {
  readonly userId: string
  readonly graphId: string
}

export interface CommittedSourceMirror {
  readonly key: string
  readonly userId: string
  readonly graphId: string
  readonly graphIncarnation: string
  readonly epoch: string
  readonly committedAt: number
  readonly bundle: SourceBundle
}

export type SourceOutboxStatus =
  | 'pending'
  | 'accepted'
  | 'applied'
  | 'conflict'
  | 'rejected-stale'
  /** Terminal, non-fence (master §2.3, WS4 D15): retrying the identical
   *  operation can never succeed. Never resubmitted by `flush()`. */
  | 'rejected-permanent'

export interface SourceOutboxRecord {
  readonly key: string
  readonly mirrorKey: string
  readonly graphIncarnation: string
  readonly operation: SourceOperation
  readonly status: SourceOutboxStatus
  readonly createdAt: number
  readonly updatedAt: number
  readonly attempts: number
  readonly receipt?: SourceOperationReceipt
  readonly error?: string
  /** Machine-readable classification of `error` (master §2.13). */
  readonly errorCode?: SourceFaultCode
  /** Set once this row's receipt confirms `outcome: 'resolved'` (master
   *  §2.13) — the `resolveCurrent` operation's own `conflictId`, cached in a
   *  guaranteed-string field so `publish()`'s `awaitingEpoch` derivation
   *  needs no unsafe cast on `operation.conflictId` (`unknown` on the base
   *  `SourceOperation`). */
  readonly resolvedConflictId?: string
  /**
   * MO object-face integration spec, master §3 Slice 9 (03 §7.3, C-D22).
   * For a `reapply:{uuid}` row: the PARKED operationId it was minted from —
   * the old-id → new-id map, on the record that already has to be durable
   * (`enqueue` persists every fresh row through `putOutbox` BEFORE any
   * push). Replaces a `reapply-journal` that was never built: crash
   * evidence after a `SIGKILL` mid-`restoring` is the outbox itself,
   * enumerable through the already-shipping `outboxRecords()`. Lives ONLY
   * on the outbox record, never on `operation` — it rides through
   * `enqueue`'s own bookkeeping and is never part of what `flush()` sends
   * over the wire (`normalizedSourceOperation`'s per-kind switch, and the
   * raw `operation` object `flush()` pushes, both stay exactly as authored
   * by the caller). */
  readonly reapplyOf?: string
}

/** `enqueue()`'s additive second parameter (master §3 Slice 9). Never
 *  reaches the wire — `reapplyOf` lives on the outbox record only. */
export interface EnqueueOptions {
  readonly reapplyOf?: string
}

export interface SourceMirrorStorage {
  readMirror(key: string): Promise<CommittedSourceMirror | undefined>
  commitMirror(record: CommittedSourceMirror): Promise<void>
  putOutbox(record: SourceOutboxRecord): Promise<void>
  listOutbox(mirrorKey: string): Promise<readonly SourceOutboxRecord[]>
}

export type SourceMirrorPhase =
  | 'idle'
  | 'opening'
  | 'absent'
  | 'complete'
  | 'pulling'
  | 'pushing'
  | 'conflict'
  | 'error'

/**
 * The honest mirror state (master spec §2.1, §3 Slice 3 — merged WS2 §5.1 +
 * WS3 §4.1 + WS4 §4.2.7's client half; three sections independently rewrote
 * this interface and none referenced the others). `conflicts` (a single
 * integer that conflated a Law IV object contest and a Law VI lifetime
 * fence, R1) is REMOVED with zero product callers lost — grep confirmed only
 * this file and its own tests read it.
 */
export interface SourceMirrorState {
  readonly phase: SourceMirrorPhase
  readonly complete: boolean
  readonly epoch: string | null
  readonly graphIncarnation: string | null

  // ── delivery register (outbox-derived) ──
  /** Locally durable, unacknowledged, and STILL DELIVERABLE under this incarnation. */
  readonly pending: number
  /**
   * Law VI. DOCUMENT-BEARING outbox rows this mirror can no longer deliver:
   * `rejected-stale`, OR `pending|accepted` stamped with a superseded
   * `graphIncarnation` (WS3 C3 — `flush()`'s incarnation filter means those
   * rows are never marked stale on their own and would otherwise stay
   * `pending` forever, inflating `pending`, R2). Document-bearing = exactly
   * `documentUpdate` | `documentLifecycle` | `crdtCommand`-with-`documentId`
   * (`documentIdOf`, below) — a KIND ALLOWLIST, never a `'documentId' in
   * operation` test (a `valuation` carries a REQUIRED `documentId` too and
   * is graph-scoped, not document-plane; R23).
   */
  readonly parked: number
  /**
   * The same undeliverability, for graph-scoped kinds (`currentState`,
   * `eventLog`, `memory`, `valuation`, `retraction`, `workspaceUpdate`,
   * `graphMetadata`, a fenced `resolveCurrent`). No destination surface for
   * it exists in this slice — exposed so the count is never silently
   * dropped on the floor while a surface for it is designed (later slices).
   */
  readonly nonDocumentParked: number
  /** Terminal, non-fence failures (WS4 D15). Never "parked" — nothing to reapply to. */
  readonly rejectedPermanent: number
  /** Resolutions this client authored that another writer's resolution beat
   *  (`rejected-permanent` rows whose `errorCode === 'stale_sync_conflict'`). */
  readonly supersededResolutions: number
  /** Conflict ids with a locally-durable, unacknowledged `resolveCurrent` (pending|accepted). */
  readonly resolving: readonly string[]
  /**
   * Conflict ids whose resolution receipt landed (outbox `applied`) but
   * whose id is still in THIS epoch's `bundle.conflicts` — the
   * non-optimistic window. `remainingConflictId` is Garden's own.
   */
  readonly awaitingEpoch: readonly {
    readonly conflictId: string
    readonly remainingConflictId: string | null
  }[]

  // ── authority register (bundle-derived) ──
  /**
   * Objects the AUTHORITY reports contested this epoch —
   * `bundle.conflicts.length`. NOT an outbox count: an object can be
   * contested by two other clients while this client has nothing pending.
   * THIS is what the `◆ N contested` badge binds to (later slices).
   */
  readonly contestedObjects: number
  /**
   * `bundle.repair?.error != null` — a projection rebuild failed, so
   * `contestedObjects` (a fresh ledger-only fold) and the `sync-conflicts`
   * RDF graph a contested table would read (store-durable, possibly stale)
   * can disagree. Suppresses the contested badge in favour of a repair
   * notice (later slices).
   */
  readonly repairNeeded: boolean

  // ── fault register ──
  /**
   * This mirror's graph moved on without it. `phase` is 'conflict' whenever
   * true (garden's own wire fossil name for the phase value; the product
   * word is "parked"/"moved on without you", never rendered here). Computed
   * identically after every `publish()` — including a bare `open()` with no
   * new error — from data that is ALREADY DURABLE (`putOutbox` persists
   * `error`/`errorCode` on every row `flush()`'s catch marks), so the fence
   * and its testimony survive a cold restart with no new store and no
   * schema bump. See `publish()`'s `fenceRow`/`fencedRows` computation.
   */
  readonly fenced: boolean
  /** The authority's own words when fenced. Never paraphrased. */
  readonly fenceTestimony: string | null
  readonly error: string | null
  /** Machine-readable classification of `error`; null when there is none, or
   *  when the authority predates the taxonomy and no fallback regex matched. */
  readonly errorCode: SourceFaultCode | null
}

export interface SourceMirrorOptions {
  readonly identity: SourceMirrorIdentity
  readonly storage: SourceMirrorStorage
  readonly transport: SourceSyncTransport
  readonly now?: () => number
}

export interface SourceMirrorSubscription {
  get(): SourceMirrorState
  subscribe(observer: (state: SourceMirrorState) => void): () => void
}

export function sourceMirrorKey(identity: SourceMirrorIdentity): string {
  const userId = nonEmpty(identity.userId, 'userId')
  const graphId = nonEmpty(identity.graphId, 'graphId')
  return `${encodeURIComponent(userId)}\u001f${encodeURIComponent(graphId)}`
}

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`SourceMirror: ${label} must not be empty`)
  return normalized
}

const OPERATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/

/** The one copy of the operationId format rule (garden `source_sync.rs:750-754`
 *  mirrors it server-side) — shared by `enqueue()` and, from master §3 Slice 6,
 *  `buildResolveCurrentOperation` (WS2 §6.3's table), so a resolution built
 *  client-side fails the SAME way `enqueue()` always has, before either claims
 *  local durability. */
function assertOperationIdFormat(operationId: string): string {
  if (operationId.length > 160 || !OPERATION_ID_PATTERN.test(operationId)) {
    throw new Error('SourceMirror: operationId must be <=160 characters of [A-Za-z0-9._:-]')
  }
  return operationId
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('SourceMirror: source JSON contains a non-finite number')
    }
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') {
    throw new Error(`SourceMirror: source JSON contains unsupported ${typeof value}`)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function decodeBase64(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const normalized = value.replace(/\s+/g, '')
  if (normalized.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(normalized)) {
    throw new Error('SourceMirror: invalid base64 source')
  }
  const bytes: number[] = []
  for (let index = 0; index < normalized.length; index += 4) {
    const a = alphabet.indexOf(normalized[index] ?? '')
    const b = alphabet.indexOf(normalized[index + 1] ?? '')
    const c = normalized[index + 2] === '=' ? -1 : alphabet.indexOf(normalized[index + 2] ?? '')
    const d = normalized[index + 3] === '=' ? -1 : alphabet.indexOf(normalized[index + 3] ?? '')
    if (a < 0 || b < 0 || c < -1 || d < -1) throw new Error('SourceMirror: invalid base64 source')
    bytes.push((a << 2) | (b >> 4))
    if (c >= 0) bytes.push(((b & 15) << 4) | (c >> 2))
    if (d >= 0) bytes.push(((c & 3) << 6) | d)
  }
  return new Uint8Array(bytes)
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const cryptoLike = (globalThis as {
    crypto?: {
      subtle?: {
        digest(algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer>
      }
    }
  }).crypto
  if (!cryptoLike?.subtle) {
    throw new Error('SourceMirror: WebCrypto SHA-256 is unavailable')
  }
  const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = new Uint8Array(await cryptoLike.subtle.digest('SHA-256', exact))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

function normalizedSourceOperation(operation: SourceOperation): Record<string, unknown> {
  // This is the serde wire form Gardend hashes into its durable ledger. Fields
  // with Rust `#[serde(default)]` are materialized on re-serialization, so the
  // client must make those defaults explicit before checking a receipt digest.
  switch (operation.kind) {
    case 'currentState':
      return {
        kind: operation.kind,
        operationId: operation.operationId,
        vocab: operation.vocab,
        class: operation.class,
        objectId: operation.objectId,
        baseVersion: operation.baseVersion,
        record: operation.record,
        causalOrder: operation.causalOrder ?? null,
        clientId: operation.clientId ?? null,
        evidenceWeight: operation.evidenceWeight ?? null,
      }
    case 'resolveCurrent':
      return {
        kind: operation.kind,
        operationId: operation.operationId,
        objectKey: operation.objectKey,
        conflictId: operation.conflictId,
        chosenOperationId: operation.chosenOperationId ?? null,
        record: operation.record ?? null,
      }
    case 'eventLog':
      return {
        kind: operation.kind,
        operationId: operation.operationId,
        eventId: operation.eventId,
        vocab: operation.vocab,
        class: operation.class,
        record: operation.record,
      }
    case 'memory':
      return {
        kind: operation.kind,
        operationId: operation.operationId,
        observer: operation.observer ?? '',
        publish: operation.publish ?? false,
        atMs: operation.atMs,
        records: operation.records,
      }
    case 'valuation':
      return {
        kind: operation.kind,
        operationId: operation.operationId,
        valuationEventId: operation.valuationEventId,
        observer: operation.observer ?? '',
        documentId: operation.documentId,
        blockId: operation.blockId,
        importance: operation.importance ?? null,
        valence: operation.valence ?? null,
        tags: operation.tags ?? [],
        atMs: operation.atMs,
      }
    case 'retraction':
      return {
        kind: operation.kind,
        operationId: operation.operationId,
        retractionEventId: operation.retractionEventId,
        subject: operation.subject,
        rationale: operation.rationale,
        retractionKind: operation.retractionKind ?? 'retract',
        observer: operation.observer ?? null,
        atMs: operation.atMs,
      }
    case 'documentLifecycle':
      return {
        kind: operation.kind,
        operationId: operation.operationId,
        action: operation.action,
        documentId: operation.documentId,
        title: operation.title ?? null,
        newDocumentIncarnation: operation.newDocumentIncarnation ?? null,
        expectedDocumentIncarnation: operation.expectedDocumentIncarnation ?? null,
        initialUpdateBase64: operation.initialUpdateBase64 ?? null,
      }
    case 'workspaceUpdate':
      return {
        kind: operation.kind,
        operationId: operation.operationId,
        updateBase64: operation.updateBase64,
      }
    case 'documentUpdate':
      return {
        kind: operation.kind,
        operationId: operation.operationId,
        documentId: operation.documentId,
        documentIncarnation: operation.documentIncarnation,
        updateBase64: operation.updateBase64,
      }
    case 'crdtCommand':
      return {
        kind: operation.kind,
        operationId: operation.operationId,
        commandKind: operation.commandKind,
        documentId: operation.documentId ?? null,
        payload: operation.payload ?? null,
      }
    case 'graphMetadata':
      return {
        kind: operation.kind,
        operationId: operation.operationId,
        title: operation.title ?? null,
        description: operation.description ?? null,
      }
    default:
      throw new Error(`SourceMirror: unsupported source operation kind ${operation.kind}`)
  }
}

/** Digest used to bind a durable client intent to an authority receipt. */
export async function sourceOperationDigest(operation: SourceOperation): Promise<string> {
  return sha256(utf8(canonicalJson(normalizedSourceOperation(operation))))
}

function operationFrom(
  sources: readonly Record<string, unknown>[],
  operationId: string,
): Record<string, unknown> | undefined {
  return sources.find(source => source.operationId === operationId)
}

function memberBytes(bundle: SourceBundle, member: SourceManifestMember): Uint8Array {
  if (member.objectId === 'workspace') return decodeBase64(bundle.workspace.updateBase64)
  if (member.objectId === 'graph-metadata') {
    if (!bundle.graphMetadata) {
      throw new Error('SourceMirror: manifest names missing graph metadata')
    }
    return utf8(canonicalJson(bundle.graphMetadata))
  }
  if (member.objectId.startsWith('document:')) {
    const documentId = member.objectId.slice('document:'.length)
    const document = bundle.documents.find(candidate => candidate.documentId === documentId)
    if (!document) throw new Error(`SourceMirror: manifest names missing document ${documentId}`)
    return decodeBase64(document.updateBase64)
  }
  if (member.objectId === 'legacy-rdf-baseline') {
    return utf8(bundle.legacyBaseline.rdfSnapshot.data)
  }
  if (member.objectId.startsWith('legacy-valuation-store:')) {
    const path = member.objectId.slice('legacy-valuation-store:'.length)
    const data = bundle.legacyBaseline.valuationStores[path]
    if (data === undefined) {
      throw new Error(`SourceMirror: manifest names missing legacy valuation store ${path}`)
    }
    return utf8(data)
  }
  if (member.objectId === 'rdf-projection-snapshot') return utf8(bundle.projectionSnapshot.data)
  if (member.objectId === 'semantic-corpus') {
    return utf8(canonicalJson(bundle.semanticCorpus ?? []))
  }
  if (member.objectId.startsWith('resource:')) {
    const resourceId = member.objectId.slice('resource:'.length)
    const resource = (bundle.resources ?? []).find(candidate => candidate.resourceId === resourceId)
    if (!resource) throw new Error(`SourceMirror: manifest names missing resource ${resourceId}`)
    const bytes = decodeBase64(resource.dataBase64)
    if (bytes.length !== resource.sizeBytes) {
      throw new Error(`SourceMirror: resource ${resourceId} size does not match its manifest`)
    }
    return bytes
  }
  if (member.objectId.startsWith('document-history:')) {
    const historyId = member.objectId.slice('document-history:'.length)
    const history = (bundle.documentHistory ?? []).find(candidate => candidate.historyId === historyId)
    if (!history) throw new Error(`SourceMirror: manifest names missing history ${historyId}`)
    return utf8(canonicalJson(history))
  }
  if (member.objectId.startsWith('valuation-store:')) {
    const path = member.objectId.slice('valuation-store:'.length)
    const data = bundle.valuationStores[path]
    if (data === undefined) throw new Error(`SourceMirror: manifest names missing valuation store ${path}`)
    return utf8(data)
  }
  if (member.objectId.startsWith('event:')) {
    const eventId = member.objectId.slice('event:'.length)
    const event = bundle.events.find(candidate => candidate.eventId === eventId)
    if (!event) throw new Error(`SourceMirror: manifest names missing event ${eventId}`)
    return utf8(canonicalJson(event))
  }
  if (member.objectId.startsWith('operation:')) {
    const operationId = member.objectId.slice('operation:'.length)
    const operation = operationFrom(bundle.memory, operationId)
      ?? operationFrom(bundle.valuations, operationId)
      ?? operationFrom(bundle.retractions, operationId)
    if (!operation) throw new Error(`SourceMirror: manifest names missing operation ${operationId}`)
    return utf8(canonicalJson(operation))
  }
  const current = bundle.currentState.find(candidate => candidate.objectKey === member.objectId)
  if (current && current.record !== undefined) return utf8(canonicalJson(current.record))
  throw new Error(`SourceMirror: unrecognized manifest member ${member.objectId}`)
}

interface ExpectedManifestMember {
  readonly sourceKind: SourceManifestMember['sourceKind']
  readonly objectIncarnation?: string | null
}

function sourceIdentity(
  value: unknown,
  property: string,
  label: string,
): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`SourceMirror: ${label} is not an object`)
  }
  const identity = (value as Record<string, unknown>)[property]
  if (typeof identity !== 'string' || !identity) {
    throw new Error(`SourceMirror: ${label} has no ${property}`)
  }
  return identity
}

function expectedManifestMembers(bundle: SourceBundle): Map<string, ExpectedManifestMember> {
  const expected = new Map<string, ExpectedManifestMember>()
  const add = (
    objectId: string,
    sourceKind: SourceManifestMember['sourceKind'],
    objectIncarnation?: string | null,
  ): void => {
    if (!objectId) throw new Error('SourceMirror: source payload has an empty object identity')
    if (expected.has(objectId)) {
      throw new Error(`SourceMirror: duplicate source payload member ${objectId}`)
    }
    expected.set(objectId, {
      sourceKind,
      ...(objectIncarnation !== undefined ? { objectIncarnation } : {}),
    })
  }

  add('workspace', 'ydoc', bundle.graphIncarnation)
  if (bundle.graphMetadata !== undefined) {
    add('graph-metadata', 'current-state', bundle.graphIncarnation)
  }
  for (const document of bundle.documents) {
    add(
      `document:${sourceIdentity(document, 'documentId', 'document source')}`,
      'ydoc',
      sourceIdentity(document, 'documentIncarnation', 'document source'),
    )
  }
  for (const resource of bundle.resources ?? []) {
    add(
      `resource:${sourceIdentity(resource, 'resourceId', 'resource source')}`,
      'current-state',
      null,
    )
  }
  for (const history of bundle.documentHistory ?? []) {
    add(
      `document-history:${sourceIdentity(history, 'historyId', 'document-history source')}`,
      'event-log',
      null,
    )
  }
  if (bundle.semanticCorpus !== undefined) add('semantic-corpus', 'derived', null)
  for (const current of bundle.currentState) {
    add(
      sourceIdentity(current, 'objectKey', 'current-state source'),
      'current-state',
      null,
    )
  }
  for (const event of bundle.events) {
    add(
      `event:${sourceIdentity(event, 'eventId', 'event source')}`,
      'event-log',
      null,
    )
  }
  for (const [label, sources] of [
    ['memory', bundle.memory],
    ['valuation', bundle.valuations],
    ['retraction', bundle.retractions],
  ] as const) {
    for (const source of sources) {
      add(
        `operation:${sourceIdentity(source, 'operationId', `${label} source`)}`,
        'event-log',
        null,
      )
    }
  }
  add('legacy-rdf-baseline', 'current-state', null)
  for (const path of Object.keys(bundle.legacyBaseline.valuationStores)) {
    add(`legacy-valuation-store:${path}`, 'current-state', null)
  }
  add('rdf-projection-snapshot', 'derived', null)
  for (const path of Object.keys(bundle.valuationStores)) {
    add(`valuation-store:${path}`, 'current-state', null)
  }
  return expected
}

function validateReceiptShape(
  receipt: SourceOperationReceipt,
  label: string,
): void {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error(`SourceMirror: ${label} is not an object`)
  }
  if (typeof receipt.operationId !== 'string' || !receipt.operationId) {
    throw new Error(`SourceMirror: ${label} has no operationId`)
  }
  if (!/^[0-9a-f]{64}$/.test(receipt.digest)) {
    throw new Error(`SourceMirror: ${label} has an invalid operation digest`)
  }
  if (!Number.isSafeInteger(receipt.acceptedRevision) || receipt.acceptedRevision < 0) {
    throw new Error(`SourceMirror: ${label} has an invalid accepted revision`)
  }
  if (receipt.status !== 'accepted' && receipt.status !== 'applied') {
    throw new Error(`SourceMirror: ${label} has an invalid status`)
  }
  if (typeof receipt.duplicate !== 'boolean') {
    throw new Error(`SourceMirror: ${label} has no duplicate flag`)
  }
  if (!receipt.outcome || typeof receipt.outcome !== 'object' || Array.isArray(receipt.outcome)) {
    throw new Error(`SourceMirror: ${label} has a non-object outcome`)
  }
  if (receipt.effectError !== undefined && typeof receipt.effectError !== 'string') {
    throw new Error(`SourceMirror: ${label} has an invalid effect error`)
  }
}

/**
 * Ask A shape validation (D18, build bundle review finding 6). Every other
 * bundle member (receipts above, manifest members, documents, resources) is
 * shape-validated before anything downstream trusts it; `conflicts` was the
 * one exception. Runs unconditionally inside `validateSourceBundle` — it
 * does NOT depend on `conflictsDigest` being present, because an older cell
 * with no digest still owes a shape-valid array.
 */
function validateSourceCandidateShape(candidate: unknown, label: string): void {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error(`SourceMirror: ${label} is not an object`)
  }
  const c = candidate as Record<string, unknown>
  if (typeof c.operationId !== 'string' || !c.operationId) {
    throw new Error(`SourceMirror: ${label} has no operationId`)
  }
  if (typeof c.sourceVersion !== 'string' || !c.sourceVersion) {
    throw new Error(`SourceMirror: ${label} has no sourceVersion`)
  }
  if (typeof c.baseVersion !== 'string') {
    throw new Error(`SourceMirror: ${label} has an invalid baseVersion`)
  }
  if (!c.record || typeof c.record !== 'object' || Array.isArray(c.record)) {
    throw new Error(`SourceMirror: ${label} has a non-object record`)
  }
  if (c.clientId !== undefined && typeof c.clientId !== 'string') {
    throw new Error(`SourceMirror: ${label} has an invalid clientId`)
  }
  // Garden D17's mirror: a client-side guard against the same lossy-parse
  // hazard — `causalOrder` is wire-typed i64 but arrives as a parsed JS
  // `number`.
  if (c.causalOrder !== undefined
    && (typeof c.causalOrder !== 'number' || !Number.isSafeInteger(c.causalOrder))) {
    throw new Error(`SourceMirror: ${label} has an unsafe causalOrder`)
  }
  if (c.evidenceWeight !== undefined
    && (typeof c.evidenceWeight !== 'number' || !Number.isFinite(c.evidenceWeight))) {
    throw new Error(`SourceMirror: ${label} has a non-finite evidenceWeight`)
  }
}

function validateSourceConflictShape(conflict: unknown, label: string): void {
  if (!conflict || typeof conflict !== 'object' || Array.isArray(conflict)) {
    throw new Error(`SourceMirror: ${label} is not an object`)
  }
  const c = conflict as Record<string, unknown>
  if (typeof c.conflictId !== 'string' || !c.conflictId) {
    throw new Error(`SourceMirror: ${label} has no conflictId`)
  }
  if (typeof c.objectKey !== 'string' || !c.objectKey) {
    throw new Error(`SourceMirror: ${label} has no objectKey`)
  }
  if (typeof c.baseVersion !== 'string') {
    throw new Error(`SourceMirror: ${label} has an invalid baseVersion`)
  }
  if (!SOURCE_RECONCILIATION_STRATEGIES.includes(c.reconciliationStrategy as SourceReconciliationStrategy)) {
    throw new Error(`SourceMirror: ${label} has an unknown reconciliationStrategy`)
  }
  if (typeof c.projectedOperationId !== 'string' || !c.projectedOperationId) {
    throw new Error(`SourceMirror: ${label} has no projectedOperationId`)
  }
  if (!Array.isArray(c.candidates) || c.candidates.length === 0) {
    throw new Error(`SourceMirror: ${label} has no candidates`)
  }
  for (const [index, candidate] of c.candidates.entries()) {
    validateSourceCandidateShape(candidate, `${label}.candidates[${index}]`)
  }
  // Garden D19's own fix guarantees this server-side; the client still
  // checks it, because a client cannot trust a server-side invariant it
  // cannot see.
  if (!(c.candidates as { readonly operationId?: unknown }[]).some(
    candidate => candidate.operationId === c.projectedOperationId,
  )) {
    throw new Error(`SourceMirror: ${label} projects an operation absent from its own candidates`)
  }
}

/** Ask A's current-state face is authority data, never an unchecked cast. */
function validateSourceCurrentObjectShape(current: unknown, label: string): void {
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error(`SourceMirror: ${label} is not an object`)
  }
  const c = current as Record<string, unknown>
  for (const field of ['objectKey', 'vocab', 'class', 'objectId', 'sourceVersion'] as const) {
    if (typeof c[field] !== 'string' || !c[field]) {
      throw new Error(`SourceMirror: ${label} has no ${field}`)
    }
  }
  if (!c.record || typeof c.record !== 'object' || Array.isArray(c.record)) {
    throw new Error(`SourceMirror: ${label} has a non-object record`)
  }
  if (!SOURCE_RECONCILIATION_STRATEGIES.includes(c.reconciliationStrategy as SourceReconciliationStrategy)) {
    throw new Error(`SourceMirror: ${label} has an unknown reconciliationStrategy`)
  }
  for (const field of ['conflictId', 'operationId', 'clientId'] as const) {
    if (c[field] !== undefined && (typeof c[field] !== 'string' || !c[field])) {
      throw new Error(`SourceMirror: ${label} has an invalid ${field}`)
    }
  }
}

function validateSourceCapabilitiesShape(capabilities: unknown): void {
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    throw new Error('SourceMirror: authority returned non-object source capabilities')
  }
  for (const [name, version] of Object.entries(capabilities as Record<string, unknown>)) {
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
      throw new Error(`SourceMirror: source capability ${name} has an invalid version`)
    }
  }
}

export async function validateSourceBundle(
  bundle: SourceBundle,
  graphId: string,
  expectedIncarnation?: string,
): Promise<void> {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new Error('SourceMirror: authority returned a non-object bundle')
  }
  if (bundle.schemaVersion !== 1) {
    throw new Error(`SourceMirror: unsupported source schema ${String(bundle.schemaVersion)}`)
  }
  if (bundle.graphId !== graphId) {
    throw new Error(`SourceMirror: bundle graph ${bundle.graphId} does not match ${graphId}`)
  }
  if (!bundle.graphIncarnation) throw new Error('SourceMirror: bundle has no graph incarnation')
  if (expectedIncarnation && bundle.graphIncarnation !== expectedIncarnation) {
    throw new Error(
      `SourceMirror: stale graph incarnation ${expectedIncarnation}; authority is ${bundle.graphIncarnation}`,
    )
  }
  if (!bundle.complete || !bundle.manifest.complete) {
    throw new Error('SourceMirror: authority did not provide a complete bundle')
  }
  if (!Number.isSafeInteger(bundle.revision) || bundle.revision < 0) {
    throw new Error('SourceMirror: authority returned an invalid source revision')
  }
  if (typeof bundle.epoch !== 'string' || !bundle.epoch) {
    throw new Error('SourceMirror: authority returned an invalid source epoch')
  }
  if (!Array.isArray(bundle.manifest.members)) {
    throw new Error('SourceMirror: authority returned an invalid source manifest')
  }
  const expectedMembers = expectedManifestMembers(bundle)
  const objectIds = new Set<string>()
  const membersById = new Map<string, SourceManifestMember>()
  for (const member of bundle.manifest.members) {
    if (!member || typeof member !== 'object' || Array.isArray(member)) {
      throw new Error('SourceMirror: manifest contains a non-object member')
    }
    if (!['ydoc', 'event-log', 'current-state', 'derived'].includes(member.sourceKind)) {
      throw new Error(`SourceMirror: member ${String(member.objectId)} has an invalid source kind`)
    }
    if (typeof member.objectId !== 'string' || !member.objectId) {
      throw new Error('SourceMirror: manifest contains a member without an object identity')
    }
    if (typeof member.sourceVersion !== 'string' || !member.sourceVersion) {
      throw new Error(`SourceMirror: member ${member.objectId} has no source version`)
    }
    if (!/^[0-9a-f]{64}$/.test(member.localDigest)) {
      throw new Error(`SourceMirror: member ${member.objectId} has an invalid local digest`)
    }
    if (!member.durable) throw new Error(`SourceMirror: member ${member.objectId} is not durable`)
    if (objectIds.has(member.objectId)) {
      throw new Error(`SourceMirror: duplicate manifest member ${member.objectId}`)
    }
    objectIds.add(member.objectId)
    membersById.set(member.objectId, member)
    const expected = expectedMembers.get(member.objectId)
    if (!expected) {
      throw new Error(`SourceMirror: manifest names unbound member ${member.objectId}`)
    }
    if (member.sourceKind !== expected.sourceKind) {
      throw new Error(`SourceMirror: member ${member.objectId} has the wrong source kind`)
    }
    if (expected.objectIncarnation !== undefined
      && (member.objectIncarnation ?? null) !== expected.objectIncarnation) {
      throw new Error(`SourceMirror: member ${member.objectId} has the wrong object incarnation`)
    }
    const digest = await sha256(memberBytes(bundle, member))
    if (digest !== member.localDigest) {
      throw new Error(`SourceMirror: digest mismatch for ${member.objectId}`)
    }
  }
  for (const objectId of expectedMembers.keys()) {
    if (!objectIds.has(objectId)) {
      throw new Error(`SourceMirror: complete manifest omits payload member ${objectId}`)
    }
  }
  const manifestDigest = await sha256(utf8(canonicalJson(bundle.manifest.members)))
  if (manifestDigest !== bundle.manifest.sourceManifestHash) {
    throw new Error('SourceMirror: source manifest hash mismatch')
  }
  if (!/^[0-9a-f]{64}$/.test(bundle.manifest.sourceManifestHash)) {
    throw new Error('SourceMirror: source manifest has an invalid digest')
  }
  const projectionDigest = await sha256(utf8(bundle.projectionSnapshot.data))
  if (projectionDigest !== bundle.projectionSnapshot.digest) {
    throw new Error('SourceMirror: projection snapshot hash mismatch')
  }
  if (membersById.get('rdf-projection-snapshot')?.localDigest !== projectionDigest) {
    throw new Error('SourceMirror: projection snapshot is not bound to the complete manifest')
  }
  if (bundle.projectionSnapshot.sourceRevision !== bundle.revision) {
    throw new Error('SourceMirror: projection snapshot revision does not match the source revision')
  }
  const baselineDigest = await sha256(utf8(bundle.legacyBaseline.rdfSnapshot.data))
  if (baselineDigest !== bundle.legacyBaseline.rdfSnapshot.digest) {
    throw new Error('SourceMirror: legacy baseline hash mismatch')
  }
  if (membersById.get('legacy-rdf-baseline')?.localDigest !== baselineDigest) {
    throw new Error('SourceMirror: legacy baseline is not bound to the complete manifest')
  }
  const workspaceDigest = await sha256(decodeBase64(bundle.workspace.updateBase64))
  if (bundle.workspace.digest !== workspaceDigest
    || membersById.get('workspace')?.localDigest !== workspaceDigest) {
    throw new Error('SourceMirror: workspace digest is not bound to the complete manifest')
  }
  for (const document of bundle.documents) {
    const member = membersById.get(`document:${document.documentId}`)
    if (document.digest !== member?.localDigest) {
      throw new Error(`SourceMirror: document ${document.documentId} digest is not manifest-bound`)
    }
  }
  for (const resource of bundle.resources ?? []) {
    const member = membersById.get(`resource:${resource.resourceId}`)
    if (resource.digest !== member?.localDigest) {
      throw new Error(`SourceMirror: resource ${resource.resourceId} digest is not manifest-bound`)
    }
  }
  const receiptIds = new Set<string>()
  for (const [index, receipt] of bundle.receipts.entries()) {
    validateReceiptShape(receipt, `receipt[${index}]`)
    if (receiptIds.has(receipt.operationId)) {
      throw new Error(`SourceMirror: duplicate receipt ${receipt.operationId}`)
    }
    receiptIds.add(receipt.operationId)
  }
  // Ask A (D18, build bundle review finding 6) — shape first, then binding.
  // `conflicts` rides OUTSIDE the manifest closure by design (D6), so this
  // is the one place its shape is ever checked. `contested[…]`, not
  // `conflicts[…]` — this label reaches a thrown Error's message text, and
  // the terminology law's "conflict" ban applies to every client-authored
  // string, not only user-facing copy (§7.1; the same reasoning already
  // renamed the two `conflictsDigest` error strings below).
  for (const [index, conflict] of bundle.conflicts.entries()) {
    validateSourceConflictShape(conflict, `contested[${index}]`)
  }
  for (const [index, current] of bundle.currentState.entries()) {
    validateSourceCurrentObjectShape(current, `currentState[${index}]`)
  }
  if (bundle.sourceCapabilities !== undefined) {
    validateSourceCapabilitiesShape(bundle.sourceCapabilities)
  }
  // The digest binds `conflicts` when the authority supports it (D6); when
  // it does not (an older cell), say so by doing nothing — the shape check
  // above already ran regardless of digest support.
  if (bundle.conflictsDigest !== undefined) {
    if (typeof bundle.conflictsDigest !== 'string'
      || !/^[0-9a-f]{64}$/.test(bundle.conflictsDigest)) {
      throw new Error('SourceMirror: authority returned an invalid contested-set digest')
    }
    const computedConflictsDigest = await sha256(utf8(canonicalJson(bundle.conflicts)))
    if (computedConflictsDigest !== bundle.conflictsDigest) {
      throw new Error('SourceMirror: contested-set digest mismatch')
    }
  }
}

/**
 * Build the complete, identity-fenced empty source epoch for a graph whose
 * lifecycle create intent is already durable but has not reached the gateway.
 *
 * This is not a pretend server snapshot: `provisional` keeps the provenance
 * explicit, while the client-minted graph incarnation makes every later push
 * and pull converge on exactly one graph lifetime.
 */
export async function createProvisionalSourceBundle(input: {
  readonly graphId: string
  readonly graphIncarnation: string
  readonly workspaceUpdateBase64: string
  readonly title?: string
  readonly now?: number
}): Promise<SourceBundle> {
  const graphId = nonEmpty(input.graphId, 'graphId')
  const graphIncarnation = nonEmpty(input.graphIncarnation, 'graphIncarnation')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(graphIncarnation)) {
    throw new Error('SourceMirror: graphIncarnation must be a UUID')
  }
  const workspace = decodeBase64(input.workspaceUpdateBase64)
  const workspaceDigest = await sha256(workspace)
  const emptyDigest = await sha256(utf8(''))
  const semanticDigest = await sha256(utf8('[]'))
  const at = input.now ?? Date.now()
  const graphMetadata = {
    title: nonEmpty(input.title ?? graphId, 'title'),
    description: null,
    status: 'active',
    createdAt: new Date(at).toISOString(),
    updatedAt: new Date(at).toISOString(),
    createdByOperationId: null,
  }
  const graphMetadataDigest = await sha256(utf8(canonicalJson(graphMetadata)))
  const members: SourceManifestMember[] = [
    {
      sourceKind: 'current-state',
      objectId: 'graph-metadata',
      objectIncarnation: graphIncarnation,
      sourceVersion: graphMetadataDigest,
      localDigest: graphMetadataDigest,
      durable: true,
    },
    {
      sourceKind: 'current-state',
      objectId: 'legacy-rdf-baseline',
      objectIncarnation: null,
      sourceVersion: emptyDigest,
      localDigest: emptyDigest,
      durable: true,
    },
    {
      sourceKind: 'derived',
      objectId: 'rdf-projection-snapshot',
      objectIncarnation: null,
      sourceVersion: emptyDigest,
      localDigest: emptyDigest,
      durable: true,
    },
    {
      sourceKind: 'derived',
      objectId: 'semantic-corpus',
      objectIncarnation: null,
      sourceVersion: '0',
      localDigest: semanticDigest,
      durable: true,
    },
    {
      sourceKind: 'ydoc',
      objectId: 'workspace',
      objectIncarnation: graphIncarnation,
      sourceVersion: workspaceDigest,
      localDigest: workspaceDigest,
      durable: true,
    },
  ]
  members.sort((left, right) => left.objectId.localeCompare(right.objectId))
  const sourceManifestHash = await sha256(utf8(canonicalJson(members)))
  return {
    schemaVersion: 1,
    graphId,
    graphIncarnation,
    provisional: true,
    revision: 0,
    epoch: `provisional:${graphIncarnation}`,
    complete: true,
    manifest: { sourceManifestHash, members, complete: true },
    workspace: {
      updateBase64: input.workspaceUpdateBase64,
      digest: workspaceDigest,
    },
    graphMetadata,
    documents: [],
    resources: [],
    documentHistory: [],
    semanticCorpus: [],
    derivedCapabilities: {
      semanticSearch: {
        algorithm: 'source-derived-hybrid-v1',
        sourceRevision: 0,
        offline: true,
      },
    },
    currentState: [],
    events: [],
    memory: [],
    valuations: [],
    retractions: [],
    legacyBaseline: {
      ledgerRevision: 0,
      capturedAtMs: at,
      rdfSnapshot: {
        format: 'application/n-quads',
        data: '',
        digest: emptyDigest,
        quadCount: 0,
      },
      valuationStores: {},
    },
    valuationStores: {},
    conflicts: [],
    receipts: [],
    sourceRegistry: [],
    projectionSnapshot: {
      format: 'application/n-quads',
      data: '',
      digest: emptyDigest,
      quadCount: 0,
      sourceRevision: 0,
    },
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Document-bearing kinds (Law VI's document-plane, master §2.1): exactly
 *  `documentUpdate`, `documentLifecycle`, and `crdtCommand` WITH a non-null
 *  `documentId`. A KIND ALLOWLIST, never a `'documentId' in operation` test
 *  — `valuation` carries a REQUIRED `documentId` (plus `blockId`) on the
 *  normalized wire and is graph-scoped (Law III, observer-scoped), not
 *  document-plane (R23). Exported so later slices' sidebar/badge code share
 *  this one definition rather than drifting (master §2.17). */
export function documentIdOf(operation: SourceOperation): string | null {
  switch (operation.kind) {
    case 'documentUpdate':
    case 'documentLifecycle':
    case 'crdtCommand': {
      const id = operation.documentId
      return typeof id === 'string' && id.length > 0 ? id : null
    }
    default:
      return null
  }
}

export function isDocumentBearingOperation(operation: SourceOperation): boolean {
  return documentIdOf(operation) !== null
}

/** `receipt.outcome.outcome`, when it is a string. `SourceOperationReceipt.outcome`
 *  is `Readonly<Record<string, unknown>>` — this is the one narrowing point. */
function outcomeLabel(receipt: SourceOperationReceipt): string | null {
  const outcome = receipt.outcome.outcome
  return typeof outcome === 'string' ? outcome : null
}

/**
 * FIXED (master §2.4). The version this replaces returned true for ANY
 * receipt carrying a `conflictId` string — which misfiled Garden's
 * **successful** resolution receipt (`{outcome:"resolved",conflictId,
 * remainingConflictId}`) as a contest, feeding it into the contested count
 * and re-flushing it forever. Strict equality on `outcome` alone; the
 * `conflictId`-presence clause is dropped entirely, not merely short-
 * circuited for `'resolved'` (WS2's fix, not WS3's — WS3's kept the clause
 * live for every OTHER outcome that happens to carry a conflictId).
 */
function conflictReceipt(receipt: SourceOperationReceipt): boolean {
  return outcomeLabel(receipt) === 'conflict'
}

/** A successful `ResolveCurrent` receipt. */
function resolvedReceipt(receipt: SourceOperationReceipt): boolean {
  return outcomeLabel(receipt) === 'resolved'
}

/** Garden's own `remainingConflictId` on a resolution receipt's outcome —
 *  the non-optimistic-window marker: this conflict cleared, but a NEWER
 *  disagreement already exists at the same object key. */
function remainingConflictId(receipt: SourceOperationReceipt): string | null {
  const value = receipt.outcome.remainingConflictId
  return typeof value === 'string' ? value : null
}

/** Adds targeted-operation extraction to `classifySourceFault` — the one
 *  thing the shared classifier does not do (master §2.2). Today only
 *  `stale_sync_conflict` carries a targetable identifier: Garden's message
 *  `"sync conflict '{id}' is not current for object '{key}'"` yields a
 *  conflictId, matched against the batch's own `resolveCurrent` rows. */
export interface SourcePushRejection {
  readonly fault: SourceFault
  /** The one operation the authority named, when the message named one. */
  readonly operationId: string | null
}

const STALE_SYNC_CONFLICT_ID = /sync conflict '([^']*)' is not current for object/i

export function classifyPushRejection(
  error: unknown,
  pending: readonly SourceOutboxRecord[],
): SourcePushRejection {
  const fault = classifySourceFault(error)
  if (fault.code !== 'stale_sync_conflict') return { fault, operationId: null }
  const conflictId = STALE_SYNC_CONFLICT_ID.exec(fault.message)?.[1]
  if (!conflictId) return { fault, operationId: null }
  const named = pending.find(
    (record) => record.operation.kind === 'resolveCurrent' && record.operation.conflictId === conflictId,
  )
  return { fault, operationId: named?.operation.operationId ?? null }
}

// ── the client-authored ResolveCurrent (master §3 Slice 6, WS2 §6.3) ───────

/**
 * The client's first-ever authored `resolveCurrent`. `SourceOperation` is an
 * open record; this is its typed refinement, and `normalizedSourceOperation`'s
 * `'resolveCurrent'` case (above) is already its exact serde mirror —
 * `chosenOperationId`/`record` are `#[serde(default)]` WITHOUT
 * `skip_serializing_if` on the Rust side (`source_sync.rs:187-190`), so both
 * normalize to `?? null`, matching serde's own materialized default exactly.
 */
export interface ResolveCurrentOperation extends SourceOperation {
  readonly kind: 'resolveCurrent'
  readonly operationId: string
  /** `vocab  class  objectId` — garden `source_sync.rs:758-760`. */
  readonly objectKey: string
  /** `conflict-` + 32 hex — garden `source_sync.rs:849-859`. */
  readonly conflictId: string
  readonly chosenOperationId?: string
  readonly record?: Readonly<Record<string, unknown>>
}

/** Exactly one of the two arms — mirrors garden's own validation
 *  (`source_sync.rs:1483-1487`); the union itself makes the illegal third
 *  case unrepresentable, so no separate runtime check is needed for it. */
export type ResolveCurrentIntent =
  | {
      readonly kind: 'keep'
      readonly objectKey: string
      readonly conflictId: string
      readonly chosenOperationId: string
    }
  | {
      readonly kind: 'compose'
      readonly objectKey: string
      readonly conflictId: string
      readonly record: Readonly<Record<string, unknown>>
    }

/** The wire form the cell speaks for an object key (`objectKeyOf`/`parseObjectKey`'s
 *  own separator, `packages/runtime/src/layout/source-object-service.ts:91-102`).
 *  Duplicated locally, narrowly, rather than imported: `@shrubbery/source` is a
 *  lower layer than `@shrubbery/runtime` (WS1 D-4, "Runtime NEVER imports
 *  @shrubbery/source" — the dependency is one-way), so the reverse import is not
 *  available here, and this function needs only the split, not the full locator
 *  vocabulary runtime owns. */
const OBJECT_KEY_SEPARATOR = String.fromCharCode(0x1f)

function parseObjectKeyPartsLocal(
  objectKey: string,
): { readonly vocab: string; readonly class: string; readonly objectId: string } | null {
  const parts = objectKey.split(OBJECT_KEY_SEPARATOR)
  if (parts.length !== 3) return null
  const [vocab, cls, objectId] = parts
  if (!vocab || !cls || !objectId) return null
  return { vocab, class: cls, objectId }
}

/**
 * Every numeric leaf in a composed record must be either a safe integer or a
 * finite non-integer (WS2 §6.3 "Canonicalization vs Garden's serde
 * defaults"): JS numbers are IEEE-754 doubles, `serde_json` parses bare
 * integers into `i64`/`u64`, so an integer leaf beyond 2^53 would digest
 * differently on the two sides and `validateReceiptBindings` would then
 * reject a CORRECT receipt as "does not match the durable operation" — a
 * confusing failure for a write that was accepted. Non-finite numbers are
 * already rejected by `canonicalJson` (the digest path `enqueue()` always
 * runs); this closes the ONE gap that check leaves open. `path` uses plain
 * dot/bracket notation matching the field the authority would name.
 */
function assertDigestibleRecordField(value: unknown, path: string): void {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Error(`SourceMirror: record field ${path} is a number this client cannot digest exactly`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertDigestibleRecordField(item, `${path}[${index}]`))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      assertDigestibleRecordField((value as Record<string, unknown>)[key], `${path}.${key}`)
    }
  }
}

/**
 * Build the durable operation. THROWS on anything the authority would
 * reject, before any local durability is claimed — the same discipline
 * `enqueue` already applies by digesting first.
 *
 * `knownCandidateOperationIds` is not decoration: Garden's unknown-candidate
 * check lives INSIDE `fold_current_objects` (`:1044-1048`), reached from
 * `stable_outcome` (`:1372`) inside the SAME push loop, before
 * `write_ledger` (`:3041`) — so it aborts the ENTIRE batch, and the
 * pre-Ask-B classifier has no operationId to extract from that message
 * shape, leaving the batch `pending` forever (a livelock, not merely a bad
 * error). Making the illegal choice unrepresentable client-side is the fix.
 */
export function buildResolveCurrentOperation(
  intent: ResolveCurrentIntent,
  operationId: string,
  knownCandidateOperationIds: readonly string[],
): ResolveCurrentOperation {
  const id = assertOperationIdFormat(nonEmpty(operationId, 'operationId'))
  const objectKey = nonEmpty(intent.objectKey, 'objectKey')
  const conflictId = nonEmpty(intent.conflictId, 'conflictId')

  if (intent.kind === 'keep') {
    const chosenOperationId = nonEmpty(intent.chosenOperationId, 'chosenOperationId')
    if (!knownCandidateOperationIds.includes(chosenOperationId)) {
      // Terminology law (master §7.1): never "conflict" in authored copy —
      // WS2 §6.3's own draft wording used it; reworded, meaning unchanged.
      throw new Error(`SourceMirror: ${chosenOperationId} is not a proposal on this object`)
    }
    return { kind: 'resolveCurrent', operationId: id, objectKey, conflictId, chosenOperationId }
  }

  const record = intent.record
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    throw new Error('SourceMirror: composed record must be a JSON object')
  }
  const parts = parseObjectKeyPartsLocal(objectKey)
  if (parts) {
    const kind = (record as Record<string, unknown>).kind
    if (kind !== undefined && kind !== parts.class) {
      throw new Error(
        `SourceMirror: composed record.kind '${String(kind)}' does not match this object's class '${parts.class}'`,
      )
    }
    const localId = (record as Record<string, unknown>).localId
    if (localId !== undefined && localId !== parts.objectId) {
      throw new Error(
        `SourceMirror: composed record.localId '${String(localId)}' does not match this object's id '${parts.objectId}'`,
      )
    }
  }
  for (const key of Object.keys(record)) assertDigestibleRecordField(record[key], key)
  return { kind: 'resolveCurrent', operationId: id, objectKey, conflictId, record }
}

export class SourceMirrorManager implements SourceMirrorSubscription {
  readonly key: string
  private readonly now: () => number
  private record: CommittedSourceMirror | undefined
  private outbox: SourceOutboxRecord[] = []
  private observers = new Set<(state: SourceMirrorState) => void>()
  private state: SourceMirrorState = {
    phase: 'idle',
    complete: false,
    epoch: null,
    graphIncarnation: null,
    pending: 0,
    parked: 0,
    nonDocumentParked: 0,
    rejectedPermanent: 0,
    supersededResolutions: 0,
    resolving: [],
    awaitingEpoch: [],
    contestedObjects: 0,
    repairNeeded: false,
    fenced: false,
    fenceTestimony: null,
    error: null,
    errorCode: null,
  }
  private active: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: SourceMirrorOptions) {
    this.key = sourceMirrorKey(options.identity)
    this.now = options.now ?? Date.now
  }

  get(): SourceMirrorState {
    return this.state
  }

  subscribe(observer: (state: SourceMirrorState) => void): () => void {
    this.observers.add(observer)
    return () => this.observers.delete(observer)
  }

  bundle(): SourceBundle | undefined {
    return this.record?.bundle
  }

  projectionSnapshot(): SourceProjectionSnapshot | undefined {
    return this.record?.bundle.projectionSnapshot
  }

  async open(): Promise<SourceMirrorState> {
    return this.serialize(async () => {
      this.setState({ ...this.state, phase: 'opening', error: null })
      try {
        const record = await this.options.storage.readMirror(this.key)
        this.outbox = [...await this.options.storage.listOutbox(this.key)]
        if (record) {
          await validateSourceBundle(
            record.bundle,
            this.options.identity.graphId,
            record.graphIncarnation,
          )
        }
        this.record = record
        this.publish(this.record ? 'complete' : 'absent')
        return this.state
      } catch (error) {
        // Never leave a corrupt or partially readable value resident: pull()
        // may safely replace it with an independently verified complete epoch.
        this.record = undefined
        this.publish('error', error)
        throw error
      }
    })
  }

  async pull(): Promise<SourceBundle> {
    return this.serialize(async () => {
      this.publish('pulling')
      try {
        const bundle = await this.options.transport.pull(
          this.options.identity.graphId,
          this.record?.graphIncarnation,
        )
        await validateSourceBundle(
          bundle,
          this.options.identity.graphId,
          this.record?.graphIncarnation,
        )
        this.validateProgression(bundle)
        await this.validateReceiptBindings(bundle.receipts, bundle.revision)
        const committed: CommittedSourceMirror = {
          key: this.key,
          userId: this.options.identity.userId,
          graphId: this.options.identity.graphId,
          graphIncarnation: bundle.graphIncarnation,
          epoch: bundle.epoch,
          committedAt: this.now(),
          bundle,
        }
        // The single storage call is the completeness commit point. A quota or
        // transaction failure leaves the previous complete epoch untouched.
        await this.options.storage.commitMirror(committed)
        this.record = committed
        await this.reconcileReceipts(bundle.receipts)
        this.publish('complete')
        return bundle
      } catch (error) {
        const fault = classifySourceFault(error)
        this.publish(isFenceFault(fault) ? 'conflict' : 'error', error, fault.code)
        throw error
      }
    })
  }

  async bootstrap(bundle: SourceBundle): Promise<SourceBundle> {
    return this.serialize(async () => {
      await validateSourceBundle(
        bundle,
        this.options.identity.graphId,
        bundle.graphIncarnation,
      )
      if (this.record) {
        if (this.record.graphIncarnation !== bundle.graphIncarnation) {
          throw new Error(
            `SourceMirror: graph incarnation changed from ${this.record.graphIncarnation} to ${bundle.graphIncarnation}`,
          )
        }
        return this.record.bundle
      }
      const committed: CommittedSourceMirror = {
        key: this.key,
        userId: this.options.identity.userId,
        graphId: this.options.identity.graphId,
        graphIncarnation: bundle.graphIncarnation,
        epoch: bundle.epoch,
        committedAt: this.now(),
        bundle,
      }
      await this.options.storage.commitMirror(committed)
      this.record = committed
      this.publish('complete')
      return bundle
    })
  }

  async enqueue(operation: SourceOperation, options?: EnqueueOptions): Promise<SourceOutboxRecord> {
    assertOperationIdFormat(nonEmpty(operation.operationId, 'operationId'))
    const graphIncarnation = this.record?.graphIncarnation
    if (!graphIncarnation || !this.record?.bundle.complete) {
      throw new Error('SourceMirror: a complete identity-fenced mirror is required before offline writes')
    }
    // Reject operations that cannot be represented by the authority's stable
    // wire schema before claiming local durability.
    await sourceOperationDigest(operation)
    const existing = this.outbox.find(candidate => candidate.operation.operationId === operation.operationId)
    if (existing) {
      if (canonicalJson(existing.operation) !== canonicalJson(operation)) {
        throw new Error(`SourceMirror: operationId ${operation.operationId} was reused with different content`)
      }
      return existing
    }
    const now = this.now()
    const record: SourceOutboxRecord = {
      key: `${this.key}\u001f${operation.operationId}`,
      mirrorKey: this.key,
      graphIncarnation,
      operation,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      ...(options?.reapplyOf !== undefined ? { reapplyOf: options.reapplyOf } : {}),
    }
    await this.options.storage.putOutbox(record)
    this.outbox.push(record)
    this.publish(this.state.phase === 'idle' ? 'complete' : this.state.phase)
    return record
  }

  async flush(): Promise<readonly SourceOperationReceipt[]> {
    return this.serialize(async () => {
      const graphIncarnation = this.record?.graphIncarnation
      if (!graphIncarnation) throw new Error('SourceMirror: cannot push without a graph incarnation')
      const pending = this.outbox
        .filter(record => record.status === 'pending' || record.status === 'accepted')
        .filter(record => record.graphIncarnation === graphIncarnation)
        .sort((left, right) => left.createdAt - right.createdAt || left.key.localeCompare(right.key))
      if (pending.length === 0) {
        this.publish('complete')
        return []
      }
      this.publish('pushing')
      try {
        const result = await this.options.transport.push(
          this.options.identity.graphId,
          graphIncarnation,
          pending.map(record => record.operation),
        )
        await this.validatePushResult(result, graphIncarnation, pending)
        await this.reconcileReceipts(result.receipts, true)
        this.publish(this.outbox.some(record => record.status === 'conflict') ? 'conflict' : 'complete')
        return result.receipts
      } catch (error) {
        // Four-way (master §2.3, WS4 D15 + the targeted branch, C-D4):
        //   fence              → the WHOLE batch `rejected-stale`.
        //   targeted-permanent → ONLY the row the authority NAMED becomes
        //                        `rejected-permanent`; siblings keep their
        //                        status and are re-flushed next backgroundSync.
        //   untargeted-permanent → the WHOLE batch `rejected-permanent`
        //                        (`source_push` rejects pre-acceptance on the
        //                        first failing operation and returns exactly
        //                        one error for the call — no per-operation
        //                        result to distinguish batch-mates; documented
        //                        limitation, not fixed here).
        //   transient          → every status untouched, `attempts` incremented.
        const rejection = classifyPushRejection(error, pending)
        const fault = rejection.fault
        const targeted = fault.code !== null && TARGETED_PERMANENT_CODES.includes(fault.code)
        const statusFor = (record: SourceOutboxRecord): SourceOutboxStatus =>
          isFenceFault(fault)
            ? 'rejected-stale'
            : targeted
              ? record.operation.operationId === rejection.operationId
                ? 'rejected-permanent'
                : record.status
              : fault.code !== null && PERMANENT_CODES.includes(fault.code)
                ? 'rejected-permanent'
                : record.status
        for (const record of pending) {
          const next: SourceOutboxRecord = {
            ...record,
            status: statusFor(record),
            attempts: record.attempts + 1,
            updatedAt: this.now(),
            error: errorMessage(error),
            errorCode: fault.code ?? undefined,
          }
          await this.options.storage.putOutbox(next)
          this.replaceOutbox(next)
        }
        this.publish(isFenceFault(fault) ? 'conflict' : 'error', error, fault.code)
        throw error
      }
    })
  }

  outboxRecords(): readonly SourceOutboxRecord[] {
    return this.outbox
  }

  /**
   * Accept that this graph's previous life ended (master §3 Slice 7, WS3
   * §4.3 + the master §2.1/C-D18 repair). Every outbox row this mirror can
   * no longer deliver — bound to a superseded incarnation, or `pending`/
   * `accepted` under the CURRENT (still fenced) incarnation — is marked
   * `rejected-stale` on disk FIRST, each row carrying the fence's own
   * `errorCode`/`error` testimony. That ordering, and that testimony, are
   * both load-bearing:
   *
   * - It is what makes those rows enumerable as parked work at all (closes
   *   WS3 C3 — `flush()`'s incarnation filter would otherwise have left a
   *   superseded row `pending` forever without this call).
   * - It is what makes `publish()`'s DURABLE fence rule (§2.1, C-D18) work
   *   across a cold restart: a fence row with no `errorCode` in
   *   `FENCE_CODES` is invisible to `fencedRows`, so a row marked stale
   *   without the fence's own code would silently un-fence the mirror the
   *   next time it opens.
   * - It is why a FAILED adoption re-raises the fence rather than silently
   *   clearing it: this method never calls `commitMirror` for the old
   *   incarnation, so if the pull below throws, the outbox rows just
   *   written stay `rejected-stale` under the OLD (still-committed)
   *   incarnation, and the next `open()` finds them and re-derives
   *   `fenced: true` from durable data alone — no separate flag exists to
   *   forget to clear.
   *
   * Local durability is never traded for liveness: the caller may re-invoke
   * after a failure — every row this call would mark is already
   * `rejected-stale`, so re-running it is a no-op over the outbox and only
   * the pull is retried.
   */
  async adoptNewLife(): Promise<SourceBundle> {
    return this.serialize(async () => {
      const heldIncarnation = this.record?.graphIncarnation
      const fenced = this.state.fenced
      // Prefer evidence ALREADY durable on an existing fence row over this
      // session's latest transient error. A retried adoption's own pull can
      // fail for an unrelated, unclassifiable reason (a network timeout);
      // that must never overwrite rows this call marks with a null code,
      // which would make them invisible to `publish()`'s `fenceRow` filter.
      const isFenceRow = (record: SourceOutboxRecord): boolean =>
        record.status === 'rejected-stale' && record.errorCode !== undefined && FENCE_CODES.includes(record.errorCode)
      const existingFenceRow = heldIncarnation === undefined
        ? undefined
        : this.outbox
          .filter(record => isFenceRow(record) && record.graphIncarnation === heldIncarnation)
          .reduce<SourceOutboxRecord | undefined>(
            (latest, record) => (latest === undefined || record.updatedAt > latest.updatedAt ? record : latest),
            undefined,
          )
      const fenceErrorCode = existingFenceRow?.errorCode ?? this.state.errorCode ?? undefined
      const fenceMessage = existingFenceRow?.error
        ?? this.state.fenceTestimony
        ?? this.state.error
        ?? 'SourceMirror: graph incarnation superseded'
      const now = this.now()
      for (const record of this.outbox) {
        if (record.status !== 'pending' && record.status !== 'accepted') continue
        const superseded = heldIncarnation === undefined || record.graphIncarnation !== heldIncarnation
        const staleUnderTheCurrentFence = record.graphIncarnation === heldIncarnation && fenced
        if (!superseded && !staleUnderTheCurrentFence) continue
        const next: SourceOutboxRecord = {
          ...record,
          status: 'rejected-stale',
          updatedAt: now,
          error: fenceMessage,
          errorCode: fenceErrorCode,
        }
        await this.options.storage.putOutbox(next)
        this.replaceOutbox(next)
      }
      this.record = undefined
      this.publish('pulling')
      try {
        const bundle = await this.options.transport.pull(this.options.identity.graphId)
        await validateSourceBundle(bundle, this.options.identity.graphId, undefined)
        this.validateProgression(bundle) // a no-op: this.record is undefined
        await this.validateReceiptBindings(bundle.receipts, bundle.revision)
        const committed: CommittedSourceMirror = {
          key: this.key,
          userId: this.options.identity.userId,
          graphId: this.options.identity.graphId,
          graphIncarnation: bundle.graphIncarnation,
          epoch: bundle.epoch,
          committedAt: this.now(),
          bundle,
        }
        await this.options.storage.commitMirror(committed)
        this.record = committed
        await this.reconcileReceipts(bundle.receipts)
        this.publish('complete')
        return bundle
      } catch (error) {
        const fault = classifySourceFault(error)
        this.publish(isFenceFault(fault) ? 'conflict' : 'error', error, fault.code)
        throw error
      }
    })
  }

  private validateProgression(bundle: SourceBundle): void {
    const previous = this.record?.bundle
    if (!previous) return
    if (bundle.revision < previous.revision) {
      throw new Error(
        `SourceMirror: authority revision rolled back from ${previous.revision} to ${bundle.revision}`,
      )
    }
    if (bundle.epoch === previous.epoch
      && bundle.manifest.sourceManifestHash !== previous.manifest.sourceManifestHash) {
      throw new Error(
        `SourceMirror: authority reused epoch ${bundle.epoch} for a different complete manifest`,
      )
    }
    if (bundle.epoch === previous.epoch && bundle.revision !== previous.revision) {
      throw new Error(
        `SourceMirror: authority reused epoch ${bundle.epoch} across source revisions`,
      )
    }
  }

  private async validateReceiptBindings(
    receipts: readonly SourceOperationReceipt[],
    maximumRevision?: number,
  ): Promise<void> {
    const seen = new Set<string>()
    for (const [index, receipt] of receipts.entries()) {
      validateReceiptShape(receipt, `receipt[${index}]`)
      if (seen.has(receipt.operationId)) {
        throw new Error(`SourceMirror: duplicate receipt ${receipt.operationId}`)
      }
      seen.add(receipt.operationId)
      if (maximumRevision !== undefined && receipt.acceptedRevision > maximumRevision) {
        throw new Error(
          `SourceMirror: receipt ${receipt.operationId} is newer than its source revision`,
        )
      }
      const existing = this.outbox.find(
        candidate => candidate.operation.operationId === receipt.operationId,
      )
      if (!existing) continue
      const expectedDigest = await sourceOperationDigest(existing.operation)
      if (receipt.digest !== expectedDigest) {
        throw new Error(
          `SourceMirror: receipt ${receipt.operationId} does not match the durable operation`,
        )
      }
    }
  }

  private async validatePushResult(
    result: SourcePushResult,
    graphIncarnation: string,
    pending: readonly SourceOutboxRecord[],
  ): Promise<void> {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('SourceMirror: source push returned a non-object result')
    }
    if (result.ok !== true && result.ok !== false) {
      throw new Error('SourceMirror: source push returned no outcome')
    }
    if (result.graphId !== this.options.identity.graphId) {
      throw new Error('SourceMirror: source push returned a different graph')
    }
    if (result.graphIncarnation !== graphIncarnation) {
      throw new Error('SourceMirror: source push returned a different graph incarnation')
    }
    if (!Number.isSafeInteger(result.revision) || result.revision < 0) {
      throw new Error('SourceMirror: source push returned an invalid revision')
    }
    if (!Array.isArray(result.receipts)) {
      throw new Error('SourceMirror: source push returned invalid receipts')
    }
    const expected = new Set(pending.map(record => record.operation.operationId))
    if (result.receipts.length !== expected.size) {
      throw new Error('SourceMirror: source push did not return one receipt per operation')
    }
    await this.validateReceiptBindings(result.receipts, result.revision)
    for (const receipt of result.receipts) {
      if (!expected.delete(receipt.operationId)) {
        throw new Error(`SourceMirror: source push returned unexpected receipt ${receipt.operationId}`)
      }
    }
    if (expected.size > 0) {
      throw new Error('SourceMirror: source push omitted operation receipts')
    }
  }

  private async reconcileReceipts(
    receipts: readonly SourceOperationReceipt[],
    incrementAttempts = false,
  ): Promise<void> {
    for (const receipt of receipts) {
      const existing = this.outbox.find(
        candidate => candidate.operation.operationId === receipt.operationId,
      )
      if (!existing) continue
      const resolvedConflictId =
        resolvedReceipt(receipt) && typeof existing.operation.conflictId === 'string'
          ? existing.operation.conflictId
          : existing.resolvedConflictId
      const next: SourceOutboxRecord = {
        ...existing,
        status: conflictReceipt(receipt)
          ? 'conflict'
          : receipt.status === 'applied'
            ? 'applied'
            : 'accepted',
        updatedAt: this.now(),
        attempts: existing.attempts + (incrementAttempts ? 1 : 0),
        receipt,
        error: receipt.effectError,
        resolvedConflictId,
      }
      await this.options.storage.putOutbox(next)
      this.replaceOutbox(next)
    }
  }

  private replaceOutbox(next: SourceOutboxRecord): void {
    const index = this.outbox.findIndex(record => record.key === next.key)
    if (index < 0) this.outbox.push(next)
    else this.outbox[index] = next
  }

  /**
   * The ONE place `SourceMirrorState` is computed (master §2.1, §3 Slice 3).
   * `errorCode` is the CURRENT call's classification (null on every
   * success path and on unclassifiable errors) — `fenced`/`fenceTestimony`
   * do NOT trust it alone; they re-derive from the DURABLE outbox, so a
   * fence survives a cold restart with no new store and no schema bump.
   */
  private publish(
    phase: SourceMirrorPhase,
    error?: unknown,
    errorCode: SourceFaultCode | null = null,
  ): void {
    const heldIncarnation = this.record?.graphIncarnation
    const deliverableUnder = (record: SourceOutboxRecord): boolean =>
      heldIncarnation === undefined || record.graphIncarnation === heldIncarnation

    const pending = this.outbox.filter(
      record => (record.status === 'pending' || record.status === 'accepted') && deliverableUnder(record),
    ).length

    // Law VI. Undeliverable = `rejected-stale` (any vintage) OR
    // `pending|accepted` stamped with a superseded incarnation (WS3 C3 —
    // `flush()`'s incarnation filter means those rows are never marked stale
    // on their own; R2's regression guard).
    const undeliverable = this.outbox.filter(
      record =>
        record.status === 'rejected-stale'
        || ((record.status === 'pending' || record.status === 'accepted') && !deliverableUnder(record)),
    )
    const parked = undeliverable.filter(record => isDocumentBearingOperation(record.operation)).length
    const nonDocumentParked = undeliverable.length - parked

    const rejectedPermanent = this.outbox.filter(record => record.status === 'rejected-permanent').length
    const supersededResolutions = this.outbox.filter(
      record => record.status === 'rejected-permanent' && record.errorCode === 'stale_sync_conflict',
    ).length

    const resolving = this.outbox
      .filter(
        record =>
          record.operation.kind === 'resolveCurrent'
          && (record.status === 'pending' || record.status === 'accepted'),
      )
      .map(record => String(record.operation.conflictId))

    const openConflictIds = new Set(
      (this.record?.bundle.conflicts ?? [])
        .map(entry => entry.conflictId)
        .filter((id): id is string => typeof id === 'string'),
    )
    const awaitingEpoch = this.outbox
      .filter(record => record.operation.kind === 'resolveCurrent' && record.status === 'applied')
      .map(record => String(record.operation.conflictId))
      .filter(id => openConflictIds.has(id))
      .map((id) => {
        const record = this.outbox.find(candidate => candidate.resolvedConflictId === id)
        return {
          conflictId: id,
          remainingConflictId: record?.receipt !== undefined ? remainingConflictId(record.receipt) : null,
        }
      })

    const contestedObjects = this.record?.bundle.conflicts.length ?? 0
    const repair = this.record?.bundle.repair as { error?: unknown } | undefined
    const repairNeeded = repair?.error != null

    // Durable fence (master §2.1, C-D18). A mirror is fenced iff it holds
    // rows that were fenced under the incarnation it CURRENTLY holds, OR the
    // error THIS call just observed is itself a fence. Recomputed identically
    // after a bare `open()` (no new error) as after a `flush()`/`pull()`
    // failure — the rule reads only already-durable data.
    const currentFault: SourceFault = {
      code: errorCode,
      origin: errorCode !== null ? 'code' : 'none',
      message: error === undefined ? '' : errorMessage(error),
    }
    const fenceRow = (record: SourceOutboxRecord): boolean =>
      record.status === 'rejected-stale' && record.errorCode !== undefined && FENCE_CODES.includes(record.errorCode)
    const fencedRows = this.outbox.filter(record => fenceRow(record) && deliverableUnder(record))
    const fenced = isFenceFault(currentFault) || fencedRows.length > 0
    const fenceTestimony = fenced
      ? isFenceFault(currentFault)
        ? currentFault.message
        : (fencedRows.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a)).error ?? null)
      : null

    this.setState({
      phase,
      complete: this.record?.bundle.complete === true,
      epoch: this.record?.epoch ?? null,
      graphIncarnation: this.record?.graphIncarnation ?? null,
      pending,
      parked,
      nonDocumentParked,
      rejectedPermanent,
      supersededResolutions,
      resolving,
      awaitingEpoch,
      contestedObjects,
      repairNeeded,
      fenced,
      fenceTestimony,
      error: error === undefined ? null : errorMessage(error),
      errorCode,
    })
  }

  private setState(state: SourceMirrorState): void {
    this.state = state
    for (const observer of this.observers) observer(state)
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.active.then(task, task)
    this.active = next.then(() => undefined, () => undefined)
    return next
  }
}

export class MemorySourceMirrorStorage implements SourceMirrorStorage {
  readonly mirrors = new Map<string, CommittedSourceMirror>()
  readonly outbox = new Map<string, SourceOutboxRecord>()
  failNextMirrorCommit: Error | null = null

  async readMirror(key: string): Promise<CommittedSourceMirror | undefined> {
    return this.mirrors.get(key)
  }

  async commitMirror(record: CommittedSourceMirror): Promise<void> {
    if (this.failNextMirrorCommit) {
      const error = this.failNextMirrorCommit
      this.failNextMirrorCommit = null
      throw error
    }
    this.mirrors.set(record.key, record)
  }

  async putOutbox(record: SourceOutboxRecord): Promise<void> {
    this.outbox.set(record.key, record)
  }

  async listOutbox(mirrorKey: string): Promise<readonly SourceOutboxRecord[]> {
    return [...this.outbox.values()].filter(record => record.mirrorKey === mirrorKey)
  }
}
