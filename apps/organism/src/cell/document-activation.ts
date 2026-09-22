/**
 * Cache-first activation for live Yjs documents.
 *
 * This store owns only durable document state. It never opens a WebSocket and
 * never publishes awareness. A visible CrdtBackend lease hydrates the same
 * Y.Doc from this cache while its ordinary room provider connects; the editor
 * may render and edit a proven cached update immediately. Every pre-sync edit
 * is serialized into local persistence before it is offered to the live room.
 * A stable document-incarnation fence prevents a deleted/recreated authority
 * from ever absorbing stale cached state.
 */

import * as Y from 'yjs'
import {
  ActivationScheduler,
  type ActivationSchedulerDiagnostics,
  type ActivationTask,
  type CrdtProviderLifecycle,
  type ReactiveSource,
} from '@shrubbery/nucleus'

export type DocumentCacheAuthority = 'snapshot' | 'live' | 'offline'
export type DocumentRenderSource = 'memory' | 'indexeddb' | 'snapshot' | 'live'
export type DocumentPreparationReason = 'boot' | 'history' | 'intent' | 'recent'
export type DocumentConflictReason = 'deleted' | 'replaced' | 'unfenced'

export interface DocumentRemoteSnapshot {
  readonly update: Uint8Array
  readonly incarnation: string | null
}

/** One identity-fenced document authority from a complete graph mirror. */
export interface CompleteDocumentMirrorSnapshot {
  readonly documentId: string
  readonly incarnation: string
  readonly update: Uint8Array
}

export interface DocumentMirrorImportReport {
  readonly imported: number
  readonly mergedOffline: number
  readonly replaced: number
  readonly pruned: number
}

export interface DocumentActivationKey {
  readonly userId: string
  readonly graphId: string
  readonly documentId: string
}

export interface DocumentCacheRecord extends DocumentActivationKey {
  readonly key: string
  readonly schemaVersion: number
  readonly update: Uint8Array
  readonly savedAt: number
  readonly authority: DocumentCacheAuthority
  /** Opaque server identity for one delete/recreate lifetime. */
  readonly incarnation: string | null
}

export interface DocumentRecoveryRecord extends DocumentActivationKey {
  readonly key: string
  readonly documentKey: string
  readonly schemaVersion: number
  readonly update: Uint8Array
  readonly recoveredAt: number
  readonly reason: Exclude<DocumentConflictReason, 'unfenced'> | 'orphaned'
  readonly incarnation: string | null
  /**
   * MO object-face integration spec, master §3 Slice 8 (WS3 §4.5, D3/D4).
   * Source-outbox `operationId`s in flight for this document when it was
   * parked, resolved at quarantine time by the injected `relatedOperations`
   * seam. `undefined` means the record predates this field (join truly
   * unavailable, not merely empty — `parked-work.ts`'s `joinUnavailable`
   * depends on this distinction surviving storage, so it is NEVER
   * normalized to `[]` on read the way `incarnation` is normalized to
   * `null`). An empty ARRAY means the field exists and resolved to nothing.
   */
  readonly relatedOperationIds?: readonly string[]
  /** Set by `markRecoveryReapplied` (master §3 Slice 9). The record
   *  survives a successful reapply, stamped and greyed (Law III). */
  readonly reappliedAt?: number | null
}

/** master §3 Slice 8 (WS3 §8.1, D7). */
export interface ClearUserOptions {
  /** Default TRUE. Parked work is not session state — logging out must not
   *  be the thing that destroys a user's only copy of it. */
  readonly retainRecoveries?: boolean
}

export interface DocumentActivationStorage {
  readonly kind?: 'memory' | 'indexeddb'
  get(key: string): Promise<DocumentCacheRecord | undefined>
  put(record: DocumentCacheRecord): Promise<void>
  putRecovery(record: DocumentRecoveryRecord): Promise<void>
  listRecoveries(key: DocumentActivationKey): Promise<readonly DocumentRecoveryRecord[]>
  /** Every parked record for one human, newest-recoveredAt-first (master §3
   *  Slice 8, WS3 §4.4, closes C1). Uses the existing `userId` index. */
  listUserRecoveries(userId: string): Promise<readonly DocumentRecoveryRecord[]>
  /** Stamp a successful reapply without destroying the record (Law III). */
  markRecoveryReapplied(recoveryKey: string, at: number): Promise<void>
  /** The one destructive path, reached solely through an explicit human confirmation. */
  deleteRecovery(recoveryKey: string): Promise<void>
  delete(key: string): Promise<void>
  clearUser(userId: string, options?: ClearUserOptions): Promise<void>
  pruneGraph(
    userId: string,
    graphId: string,
    retainedDocumentIds: ReadonlySet<string>,
    /** Pre-resolved `relatedOperationIds` for orphans this pass may mint a
     *  recovery for, keyed by `documentActivationKey`. The storage-level
     *  cursor runs inside one IndexedDB transaction and cannot await the
     *  resolver itself (master §3 Slice 8, WS3 §4.5). */
    relatedOperations?: ReadonlyMap<string, readonly string[]>,
  ): Promise<readonly DocumentActivationKey[]>
}

export interface DocumentCacheHit {
  readonly record: DocumentCacheRecord
  readonly layer: 'memory' | 'indexeddb'
}

export interface DocumentPreparationCandidate extends DocumentActivationKey {
  readonly reason: DocumentPreparationReason
  /** Intent candidates use 100–150 ms; boot/history candidates normally use 0. */
  readonly delayMs?: number
}

export type DocumentPreparationResult =
  | { readonly status: 'prepared'; readonly bytes: number }
  | { readonly status: 'cached' }
  | { readonly status: 'miss' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'error'; readonly error: unknown }

export interface VisibleDocumentActivation {
  readonly whenRenderable: Promise<void>
  /** Cached state is a durable editing authority; cache miss waits for live testimony. */
  readonly whenEditable: Promise<void>
  readonly renderSource: Promise<DocumentRenderSource>
  readonly state: ReactiveSource<DocumentActivationState>
  readonly connectionPermit: Promise<DocumentConnectionPermit>
  /** Resolves once every state snapshot queued before this call is durable. */
  flush(): Promise<void>
  dispose(): void
}

export type DocumentActivationPhase =
  | 'loading'
  | 'offline-clean'
  | 'offline-dirty'
  | 'live'
  | 'conflict'

export interface DocumentActivationState {
  readonly phase: DocumentActivationPhase
  readonly durability: 'none' | 'pending' | 'durable' | 'failed'
  readonly renderSource: DocumentRenderSource | null
  readonly conflict: DocumentConflictReason | null
}

export type DocumentConnectionPermit =
  | { readonly status: 'allowed'; readonly incarnation: string | null }
  | { readonly status: 'conflict'; readonly reason: DocumentConflictReason }
  | { readonly status: 'cancelled' }

export type DocumentActivationEvent =
  | {
      readonly type: 'renderable'
      readonly key: DocumentActivationKey
      readonly source: DocumentRenderSource
      readonly elapsedMs: number
    }
  | {
      readonly type: 'synced'
      readonly key: DocumentActivationKey
      readonly elapsedMs: number
      readonly renderableToSyncedMs: number | null
    }
  | {
      readonly type: 'prefetch'
      readonly key: DocumentActivationKey
      readonly reason: DocumentPreparationReason
      readonly outcome: DocumentPreparationResult['status']
      readonly bytes?: number
    }
  | {
      readonly type: 'cache-error'
      readonly key: DocumentActivationKey
      readonly operation: 'read' | 'write' | 'delete' | 'clear' | 'prune'
      readonly error: unknown
    }
  | {
      readonly type: 'conflict'
      readonly key: DocumentActivationKey
      readonly reason: DocumentConflictReason
      readonly recoveryKey?: string
    }

export interface DocumentActivationManagerOptions {
  readonly storage?: DocumentActivationStorage
  readonly fetchUpdate?: (
    graphId: string,
    documentId: string,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<Uint8Array>
  /**
   * Incarnation-bearing snapshot read. Production contracts provide this;
   * `fetchUpdate` remains as an unfenced compatibility seam for isolated tests.
   */
  readonly fetchSnapshot?: (
    graphId: string,
    documentId: string,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<DocumentRemoteSnapshot>
  readonly schemaVersion?: number
  readonly maxMemoryEntries?: number
  readonly maxMemoryBytes?: number
  readonly persistDebounceMs?: number
  readonly validationRetryMs?: number
  readonly now?: () => number
  readonly navigationStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  readonly onEvent?: (event: DocumentActivationEvent) => void
  /**
   * master §3 Slice 8 (WS3 §4.5, D3). The join seam: at quarantine time,
   * which source-outbox `operationId`s were in flight for this document.
   * Late-bound at `hosted-gateway-contract.ts` (constructed before
   * `SourceMirrorRuntime` exists). Absent entirely (not merely returning
   * `[]`) means this manager has no resolver configured at all — the
   * written recovery's `relatedOperationIds` stays `undefined` in that
   * case, honestly confessing "join unavailable" rather than claiming a
   * resolved-empty result it never computed.
   */
  readonly relatedOperations?: (
    key: DocumentActivationKey,
    documentIncarnation: string | null,
  ) => readonly string[] | Promise<readonly string[]>
}

export interface DocumentActivationMetrics {
  readonly renderSources: Readonly<Record<DocumentRenderSource, number>>
  readonly prefetchOutcomes: Readonly<Record<DocumentPreparationResult['status'], number>>
  readonly prefetchBytes: number
  readonly cancellations: number
  readonly cacheErrors: number
  readonly lastActivationToRenderableMs: number | null
  readonly lastRenderableToSyncedMs: number | null
}

interface CurrentPreparation {
  readonly key: string
  readonly identity: DocumentActivationKey
  readonly task: ActivationTask<DocumentPreparationResult>
  readonly result: Promise<DocumentPreparationResult>
  promote(): void
}

interface ActiveDocumentBinding {
  readonly identity: DocumentActivationKey
  quarantine(reason: 'deleted' | 'replaced'): Promise<void>
  discard(reason: DocumentConflictReason): void
}

function mutableSource<T>(initial: T): {
  readonly source: ReactiveSource<T>
  set(value: T): void
  clear(): void
} {
  let current = initial
  const listeners = new Set<(value: T) => void>()
  return {
    source: {
      get: () => current,
      subscribe(listener): () => void {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    set(value): void {
      current = value
      for (const listener of [...listeners]) listener(value)
    },
    clear(): void {
      listeners.clear()
    },
  }
}

interface NavigationHint {
  readonly version: 1
  readonly userId: string
  readonly graphId: string
  readonly documentId: string
  readonly savedAt: number
}

const CACHE_DB_NAME = 'shrubbery-document-activation-v1'
const CACHE_STORE_NAME = 'documents'
const RECOVERY_STORE_NAME = 'recoveries'
const NAVIGATION_PREFIX = 'shrubbery:document-activation:last:'
const CACHE_APPLY_ORIGIN = Object.freeze({ kind: 'shrubbery-document-cache' })

function normalizedPart(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`DocumentActivation: ${label} must not be empty`)
  return normalized
}

export function documentActivationKey(key: DocumentActivationKey): string {
  return JSON.stringify([
    normalizedPart(key.userId, 'userId'),
    normalizedPart(key.graphId, 'graphId'),
    normalizedPart(key.documentId, 'documentId'),
  ])
}

function copyUpdate(update: Uint8Array): Uint8Array {
  return update.slice()
}

/** `Y.encodeStateAsUpdate(new Y.Doc())` — verified empirically, stable across
 *  yjs's own update-encoding format (2 bytes: zero clients, empty delete
 *  set). master §3 Slice 8 (WS3 §8.3, C6): guards the quarantine-time
 *  recovery write against manufacturing a parked row for a document that
 *  was never actually touched. */
const EMPTY_UPDATE = new Uint8Array([0, 0])

function isEmptyUpdate(update: Uint8Array): boolean {
  if (update.byteLength !== EMPTY_UPDATE.byteLength) return false
  for (let index = 0; index < update.byteLength; index += 1) {
    if (update[index] !== EMPTY_UPDATE[index]) return false
  }
  return true
}

function copyRecord(record: DocumentCacheRecord): DocumentCacheRecord {
  return { ...record, update: copyUpdate(record.update) }
}

function copyRecovery(record: DocumentRecoveryRecord): DocumentRecoveryRecord {
  return { ...record, update: copyUpdate(record.update) }
}

function documentRecoveryKey(
  key: DocumentActivationKey,
  incarnation: string | null,
): string {
  return JSON.stringify([
    normalizedPart(key.userId, 'userId'),
    normalizedPart(key.graphId, 'graphId'),
    normalizedPart(key.documentId, 'documentId'),
    incarnation ?? 'unknown-incarnation',
  ])
}

function recoveryFromCache(
  record: DocumentCacheRecord,
  reason: DocumentRecoveryRecord['reason'],
  recoveredAt: number,
): DocumentRecoveryRecord {
  return {
    userId: record.userId,
    graphId: record.graphId,
    documentId: record.documentId,
    key: documentRecoveryKey(record, record.incarnation),
    documentKey: record.key,
    schemaVersion: record.schemaVersion,
    update: copyUpdate(record.update),
    recoveredAt,
    reason,
    incarnation: record.incarnation,
  }
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function idbTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

interface StoredDocumentCacheRecord extends Omit<DocumentCacheRecord, 'update'> {
  readonly update: ArrayBuffer
}

interface StoredDocumentRecoveryRecord extends Omit<DocumentRecoveryRecord, 'update'> {
  readonly update: ArrayBuffer
}

/**
 * `incarnation`/`reappliedAt` are normalized to their explicit sentinel
 * (`null`) exactly as before — no consumer needs to distinguish "missing"
 * from "known absent" for either. `relatedOperationIds` is DELIBERATELY
 * left as-is (`undefined` stays `undefined`): master §3 Slice 8's
 * `joinUnavailable` (WS3 §4.4/D4, `parked-work.ts`) must be able to tell a
 * record written before this field existed from one that resolved to a
 * genuinely empty array, and normalizing here with `?? []` — the pattern
 * `incarnation` uses — would erase that distinction permanently.
 */
function fromStoredRecovery(record: StoredDocumentRecoveryRecord): DocumentRecoveryRecord {
  return {
    ...record,
    incarnation: record.incarnation ?? null,
    reappliedAt: record.reappliedAt ?? null,
    update: new Uint8Array(record.update.slice(0)),
  }
}

/** Persistent browser adapter. Records are explicitly user/graph/document scoped. */
export class IndexedDbDocumentActivationStorage implements DocumentActivationStorage {
  readonly kind = 'indexeddb' as const
  private database: Promise<IDBDatabase> | null = null

  constructor(
    private readonly factory: IDBFactory,
    private readonly databaseName = CACHE_DB_NAME,
  ) {}

  async get(key: string): Promise<DocumentCacheRecord | undefined> {
    const db = await this.open()
    const transaction = db.transaction(CACHE_STORE_NAME, 'readonly')
    const completion = idbTransaction(transaction)
    const stored = await idbRequest(
      transaction.objectStore(CACHE_STORE_NAME).get(key) as IDBRequest<StoredDocumentCacheRecord | undefined>,
    )
    await completion
    if (!stored) return undefined
    return {
      ...stored,
      incarnation: stored.incarnation ?? null,
      update: new Uint8Array(stored.update.slice(0)),
    }
  }

  async put(record: DocumentCacheRecord): Promise<void> {
    const db = await this.open()
    const transaction = db.transaction(CACHE_STORE_NAME, 'readwrite')
    const update = record.update.buffer.slice(
      record.update.byteOffset,
      record.update.byteOffset + record.update.byteLength,
    ) as ArrayBuffer
    transaction.objectStore(CACHE_STORE_NAME).put({ ...record, update })
    await idbTransaction(transaction)
  }

  async putRecovery(record: DocumentRecoveryRecord): Promise<void> {
    const db = await this.open()
    const transaction = db.transaction(RECOVERY_STORE_NAME, 'readwrite')
    const update = record.update.buffer.slice(
      record.update.byteOffset,
      record.update.byteOffset + record.update.byteLength,
    ) as ArrayBuffer
    transaction.objectStore(RECOVERY_STORE_NAME).put({ ...record, update })
    await idbTransaction(transaction)
  }

  async listRecoveries(key: DocumentActivationKey): Promise<readonly DocumentRecoveryRecord[]> {
    const db = await this.open()
    const transaction = db.transaction(RECOVERY_STORE_NAME, 'readonly')
    const completion = idbTransaction(transaction)
    const records = await idbRequest(
      transaction.objectStore(RECOVERY_STORE_NAME).index('documentKey').getAll(
        documentActivationKey(key),
      ) as IDBRequest<StoredDocumentRecoveryRecord[]>,
    )
    await completion
    return records.map(fromStoredRecovery)
  }

  /** master §3 Slice 8 (WS3 §4.4, closes C1). No version bump: the `userId`
   *  index on `RECOVERY_STORE_NAME` already exists. */
  async listUserRecoveries(userId: string): Promise<readonly DocumentRecoveryRecord[]> {
    const db = await this.open()
    const transaction = db.transaction(RECOVERY_STORE_NAME, 'readonly')
    const completion = idbTransaction(transaction)
    const records = await idbRequest(
      transaction.objectStore(RECOVERY_STORE_NAME).index('userId').getAll(
        userId,
      ) as IDBRequest<StoredDocumentRecoveryRecord[]>,
    )
    await completion
    return records.map(fromStoredRecovery).sort((left, right) => right.recoveredAt - left.recoveredAt)
  }

  async markRecoveryReapplied(recoveryKey: string, at: number): Promise<void> {
    const db = await this.open()
    const transaction = db.transaction(RECOVERY_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(RECOVERY_STORE_NAME)
    const existing = await idbRequest(store.get(recoveryKey) as IDBRequest<StoredDocumentRecoveryRecord | undefined>)
    if (existing) store.put({ ...existing, reappliedAt: at })
    await idbTransaction(transaction)
  }

  async deleteRecovery(recoveryKey: string): Promise<void> {
    const db = await this.open()
    const transaction = db.transaction(RECOVERY_STORE_NAME, 'readwrite')
    transaction.objectStore(RECOVERY_STORE_NAME).delete(recoveryKey)
    await idbTransaction(transaction)
  }

  async delete(key: string): Promise<void> {
    const db = await this.open()
    const transaction = db.transaction(CACHE_STORE_NAME, 'readwrite')
    transaction.objectStore(CACHE_STORE_NAME).delete(key)
    await idbTransaction(transaction)
  }

  async clearUser(userId: string, options: ClearUserOptions = {}): Promise<void> {
    const retain = options.retainRecoveries !== false
    const stores = retain ? [CACHE_STORE_NAME] : [CACHE_STORE_NAME, RECOVERY_STORE_NAME]
    const db = await this.open()
    const transaction = db.transaction(stores, 'readwrite')
    const completion = idbTransaction(transaction)
    for (const storeName of stores) {
      const index = transaction.objectStore(storeName).index('userId')
      const request = index.openCursor(IDBKeyRange.only(userId))
      await new Promise<void>((resolve, reject) => {
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) {
            resolve()
            return
          }
          cursor.delete()
          cursor.continue()
        }
        request.onerror = () => reject(request.error ?? new Error('IndexedDB user-cache cursor failed'))
      })
    }
    await completion
  }

  async pruneGraph(
    userId: string,
    graphId: string,
    retainedDocumentIds: ReadonlySet<string>,
    relatedOperations?: ReadonlyMap<string, readonly string[]>,
  ): Promise<readonly DocumentActivationKey[]> {
    const db = await this.open()
    const transaction = db.transaction([CACHE_STORE_NAME, RECOVERY_STORE_NAME], 'readwrite')
    const completion = idbTransaction(transaction)
    const documents = transaction.objectStore(CACHE_STORE_NAME)
    const recoveries = transaction.objectStore(RECOVERY_STORE_NAME)
    const index = documents.index('userId')
    const request = index.openCursor(IDBKeyRange.only(userId))
    const removed: DocumentActivationKey[] = []
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve()
          return
        }
        const record = cursor.value as StoredDocumentCacheRecord
        if (
          record.graphId === graphId
          && !retainedDocumentIds.has(record.documentId)
        ) {
          removed.push({
            userId: record.userId,
            graphId: record.graphId,
            documentId: record.documentId,
          })
          if (record.authority === 'offline') {
            const normalized: DocumentCacheRecord = {
              ...record,
              incarnation: record.incarnation ?? null,
              update: new Uint8Array(record.update.slice(0)),
            }
            const recovery: DocumentRecoveryRecord = {
              ...recoveryFromCache(normalized, 'orphaned', Date.now()),
              relatedOperationIds: relatedOperations?.get(documentActivationKey(normalized)),
            }
            const update = recovery.update.buffer.slice(
              recovery.update.byteOffset,
              recovery.update.byteOffset + recovery.update.byteLength,
            ) as ArrayBuffer
            recoveries.put({ ...recovery, update })
          }
          cursor.delete()
        }
        cursor.continue()
      }
      request.onerror = () => reject(request.error ?? new Error('IndexedDB graph-cache cursor failed'))
    })
    await completion
    return removed
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    this.database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.databaseName, 2)
      request.onupgradeneeded = () => {
        const db = request.result
        const store = db.objectStoreNames.contains(CACHE_STORE_NAME)
          ? request.transaction!.objectStore(CACHE_STORE_NAME)
          : db.createObjectStore(CACHE_STORE_NAME, { keyPath: 'key' })
        if (!store.indexNames.contains('userId')) store.createIndex('userId', 'userId')
        const recoveries = db.objectStoreNames.contains(RECOVERY_STORE_NAME)
          ? request.transaction!.objectStore(RECOVERY_STORE_NAME)
          : db.createObjectStore(RECOVERY_STORE_NAME, { keyPath: 'key' })
        if (!recoveries.indexNames.contains('userId')) recoveries.createIndex('userId', 'userId')
        if (!recoveries.indexNames.contains('documentKey')) {
          recoveries.createIndex('documentKey', 'documentKey')
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        this.database = null
        reject(request.error ?? new Error('IndexedDB open failed'))
      }
      request.onblocked = () => {
        this.database = null
        reject(new Error('IndexedDB open was blocked'))
      }
    })
    return this.database
  }
}

/** Deterministic adapter used in Node/tests and when IndexedDB is unavailable. */
export class MemoryDocumentActivationStorage implements DocumentActivationStorage {
  readonly kind = 'memory' as const
  private readonly records = new Map<string, DocumentCacheRecord>()
  private readonly recoveries = new Map<string, DocumentRecoveryRecord>()

  async get(key: string): Promise<DocumentCacheRecord | undefined> {
    const record = this.records.get(key)
    return record ? copyRecord(record) : undefined
  }

  async put(record: DocumentCacheRecord): Promise<void> {
    this.records.set(record.key, copyRecord(record))
  }

  async putRecovery(record: DocumentRecoveryRecord): Promise<void> {
    this.recoveries.set(record.key, copyRecovery(record))
  }

  async listRecoveries(key: DocumentActivationKey): Promise<readonly DocumentRecoveryRecord[]> {
    const encoded = documentActivationKey(key)
    return [...this.recoveries.values()]
      .filter(record => record.documentKey === encoded)
      .map(copyRecovery)
  }

  async listUserRecoveries(userId: string): Promise<readonly DocumentRecoveryRecord[]> {
    return [...this.recoveries.values()]
      .filter(record => record.userId === userId)
      .map(copyRecovery)
      .sort((left, right) => right.recoveredAt - left.recoveredAt)
  }

  async markRecoveryReapplied(recoveryKey: string, at: number): Promise<void> {
    const existing = this.recoveries.get(recoveryKey)
    if (existing) this.recoveries.set(recoveryKey, { ...existing, reappliedAt: at })
  }

  async deleteRecovery(recoveryKey: string): Promise<void> {
    this.recoveries.delete(recoveryKey)
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key)
  }

  async clearUser(userId: string, options: ClearUserOptions = {}): Promise<void> {
    const retain = options.retainRecoveries !== false
    for (const [key, record] of this.records) {
      if (record.userId === userId) this.records.delete(key)
    }
    if (retain) return
    for (const [key, record] of this.recoveries) {
      if (record.userId === userId) this.recoveries.delete(key)
    }
  }

  async pruneGraph(
    userId: string,
    graphId: string,
    retainedDocumentIds: ReadonlySet<string>,
    relatedOperations?: ReadonlyMap<string, readonly string[]>,
  ): Promise<readonly DocumentActivationKey[]> {
    const removed: DocumentActivationKey[] = []
    for (const [key, record] of this.records) {
      if (
        record.userId !== userId
        || record.graphId !== graphId
        || retainedDocumentIds.has(record.documentId)
      ) continue
      if (record.authority === 'offline') {
        const recovery: DocumentRecoveryRecord = {
          ...recoveryFromCache(record, 'orphaned', Date.now()),
          relatedOperationIds: relatedOperations?.get(documentActivationKey(record)),
        }
        this.recoveries.set(recovery.key, recovery)
      }
      this.records.delete(key)
      removed.push({
        userId: record.userId,
        graphId: record.graphId,
        documentId: record.documentId,
      })
    }
    return removed
  }
}

export function defaultDocumentActivationStorage(): DocumentActivationStorage {
  const factory = typeof globalThis.indexedDB === 'object' ? globalThis.indexedDB : undefined
  return factory
    ? new IndexedDbDocumentActivationStorage(factory)
    : new MemoryDocumentActivationStorage()
}

/** Memory front plus persistent backing, with an independent in-memory bound. */
export class DocumentActivationCache {
  private readonly memory = new Map<string, DocumentCacheRecord>()
  private memoryBytes = 0

  constructor(
    private readonly storage: DocumentActivationStorage,
    private readonly maxMemoryEntries = 8,
    private readonly maxMemoryBytes = 16 * 1024 * 1024,
  ) {
    if (!Number.isFinite(maxMemoryEntries) || maxMemoryEntries < 1) {
      throw new Error('DocumentActivationCache: maxMemoryEntries must be positive')
    }
    if (!Number.isFinite(maxMemoryBytes) || maxMemoryBytes < 1) {
      throw new Error('DocumentActivationCache: maxMemoryBytes must be positive')
    }
  }

  async get(key: DocumentActivationKey): Promise<DocumentCacheHit | undefined> {
    const encoded = documentActivationKey(key)
    const resident = this.memory.get(encoded)
    if (resident) {
      this.memory.delete(encoded)
      this.memory.set(encoded, resident)
      return { record: copyRecord(resident), layer: 'memory' }
    }
    const persisted = await this.storage.get(encoded)
    if (!persisted) return undefined
    this.remember(persisted)
    return {
      record: copyRecord(persisted),
      layer: this.storage.kind === 'memory' ? 'memory' : 'indexeddb',
    }
  }

  async put(record: DocumentCacheRecord): Promise<void> {
    this.remember(record)
    await this.storage.put(copyRecord(record))
  }

  async putRecovery(record: DocumentRecoveryRecord): Promise<void> {
    await this.storage.putRecovery(copyRecovery(record))
  }

  listRecoveries(key: DocumentActivationKey): Promise<readonly DocumentRecoveryRecord[]> {
    return this.storage.listRecoveries(key)
  }

  listUserRecoveries(userId: string): Promise<readonly DocumentRecoveryRecord[]> {
    return this.storage.listUserRecoveries(userId)
  }

  markRecoveryReapplied(recoveryKey: string, at: number): Promise<void> {
    return this.storage.markRecoveryReapplied(recoveryKey, at)
  }

  deleteRecovery(recoveryKey: string): Promise<void> {
    return this.storage.deleteRecovery(recoveryKey)
  }

  async delete(key: DocumentActivationKey): Promise<void> {
    const encoded = documentActivationKey(key)
    this.forget(encoded)
    await this.storage.delete(encoded)
  }

  async clearUser(userId: string, options?: ClearUserOptions): Promise<void> {
    for (const [key, record] of this.memory) {
      if (record.userId === userId) this.forget(key)
    }
    await this.storage.clearUser(userId, options)
  }

  async pruneGraph(
    userId: string,
    graphId: string,
    retainedDocumentIds: ReadonlySet<string>,
    relatedOperations?: ReadonlyMap<string, readonly string[]>,
  ): Promise<readonly DocumentActivationKey[]> {
    const removed = new Map<string, DocumentActivationKey>()
    for (const [key, record] of this.memory) {
      if (
        record.userId !== userId
        || record.graphId !== graphId
        || retainedDocumentIds.has(record.documentId)
      ) continue
      this.forget(key)
      removed.set(key, {
        userId: record.userId,
        graphId: record.graphId,
        documentId: record.documentId,
      })
    }
    for (const key of await this.storage.pruneGraph(userId, graphId, retainedDocumentIds, relatedOperations)) {
      removed.set(documentActivationKey(key), key)
    }
    return [...removed.values()]
  }

  diagnostics(): { readonly entries: number; readonly bytes: number } {
    return {
      entries: this.memory.size,
      bytes: this.memoryBytes,
    }
  }

  private remember(record: DocumentCacheRecord): void {
    this.forget(record.key)
    // An unusually large document remains available from persistent storage,
    // but it cannot defeat the independent resident-memory budget.
    if (record.update.byteLength > this.maxMemoryBytes) return
    const resident = copyRecord(record)
    this.memory.set(record.key, resident)
    this.memoryBytes += resident.update.byteLength
    while (
      this.memory.size > this.maxMemoryEntries
      || this.memoryBytes > this.maxMemoryBytes
    ) {
      const oldest = this.memory.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.forget(oldest)
    }
  }

  private forget(key: string): void {
    const resident = this.memory.get(key)
    if (!resident) return
    this.memory.delete(key)
    this.memoryBytes -= resident.update.byteLength
  }
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError')
    || (
      Boolean(error)
      && typeof error === 'object'
      && (error as { name?: unknown }).name === 'AbortError'
    )
  )
}

function isNotFound(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (
    (error as { status?: unknown }).status === 404
    || (error as { code?: unknown }).code === 404
  )
}

function renderSourceFor(hit: DocumentCacheHit): DocumentRenderSource {
  if (hit.record.authority === 'snapshot') return 'snapshot'
  return hit.layer
}

function delayed(signal: AbortSignal, delayMs: number): {
  readonly promise: Promise<void>
  promote(): void
} {
  if (delayMs <= 0) return { promise: Promise.resolve(), promote() {} }
  let settle!: () => void
  let timer: ReturnType<typeof setTimeout> | null = null
  const promise = new Promise<void>((resolve, reject) => {
    settle = resolve
    timer = setTimeout(resolve, delayMs)
    signal.addEventListener('abort', () => {
      if (timer) clearTimeout(timer)
      timer = null
      reject(signal.reason)
    }, { once: true })
  })
  return {
    promise,
    promote(): void {
      if (timer) clearTimeout(timer)
      timer = null
      settle()
    },
  }
}

/**
 * Policy owner for proactive snapshot fetches and cache-backed visible rooms.
 *
 * One background network task is allowed. A different visible activation
 * cancels it; activating the same candidate promotes its intent delay and can
 * consume the in-flight snapshot while the WebSocket connects concurrently.
 */
export class DocumentActivationManager {
  readonly cache: DocumentActivationCache
  private readonly fetchUpdate: DocumentActivationManagerOptions['fetchUpdate']
  private readonly fetchSnapshot: DocumentActivationManagerOptions['fetchSnapshot']
  private readonly schemaVersion: number
  private readonly persistDebounceMs: number
  private readonly validationRetryMs: number
  private readonly now: () => number
  private readonly navigationStorage: DocumentActivationManagerOptions['navigationStorage']
  private readonly onEvent: DocumentActivationManagerOptions['onEvent']
  private readonly relatedOperations: DocumentActivationManagerOptions['relatedOperations']
  private readonly scheduler = new ActivationScheduler({ maxConcurrent: 1 })
  private currentPreparation: CurrentPreparation | null = null
  private currentScope: { readonly userId: string; readonly graphId: string } | null = null
  private scopeEpoch = 0
  private readonly tombstones = new Set<string>()
  private readonly activeBindings = new Map<string, Set<ActiveDocumentBinding>>()
  private readonly metricRenderSources: Record<DocumentRenderSource, number> = {
    memory: 0,
    indexeddb: 0,
    snapshot: 0,
    live: 0,
  }
  private readonly metricPrefetchOutcomes: Record<DocumentPreparationResult['status'], number> = {
    prepared: 0,
    cached: 0,
    miss: 0,
    cancelled: 0,
    error: 0,
  }
  private metricPrefetchBytes = 0
  private metricCacheErrors = 0
  private metricLastActivationToRenderableMs: number | null = null
  private metricLastRenderableToSyncedMs: number | null = null

  constructor(options: DocumentActivationManagerOptions = {}) {
    this.cache = new DocumentActivationCache(
      options.storage ?? defaultDocumentActivationStorage(),
      options.maxMemoryEntries ?? 8,
      options.maxMemoryBytes ?? 16 * 1024 * 1024,
    )
    this.fetchUpdate = options.fetchUpdate
    this.fetchSnapshot = options.fetchSnapshot
    this.schemaVersion = options.schemaVersion ?? 1
    this.persistDebounceMs = options.persistDebounceMs ?? 120
    this.validationRetryMs = Math.max(25, options.validationRetryMs ?? 500)
    this.now = options.now ?? Date.now
    this.navigationStorage = options.navigationStorage ?? this.defaultNavigationStorage()
    this.onEvent = options.onEvent
    this.relatedOperations = options.relatedOperations
  }

  /** `undefined` when no resolver is configured at all (master §3 Slice 8,
   *  WS3 §4.5/D4) — distinct from the resolver genuinely returning `[]`. */
  private async resolveRelatedOperations(
    key: DocumentActivationKey,
    documentIncarnation: string | null,
  ): Promise<readonly string[] | undefined> {
    if (!this.relatedOperations) return undefined
    return this.relatedOperations(key, documentIncarnation)
  }

  setScope(userId: string, graphId: string): void {
    const next = {
      userId: normalizedPart(userId, 'userId'),
      graphId: normalizedPart(graphId, 'graphId'),
    }
    if (this.currentScope?.userId === next.userId && this.currentScope.graphId === next.graphId) return
    this.scopeEpoch += 1
    this.currentScope = next
    this.cancelPreparation()
  }

  prepare(candidate: DocumentPreparationCandidate): Promise<DocumentPreparationResult> {
    const normalized = this.normalizedKey(candidate)
    this.setScope(normalized.userId, normalized.graphId)
    const encoded = documentActivationKey(normalized)
    if (this.currentPreparation?.key === encoded) {
      if ((candidate.delayMs ?? 0) <= 0) this.currentPreparation.promote()
      return this.currentPreparation.result
    }
    this.cancelPreparation()

    let promoted = false
    let promote = (): void => { promoted = true }
    const task = this.scheduler.schedule(async signal => {
      const delay = delayed(signal, Math.max(0, candidate.delayMs ?? 0))
      if (promoted) delay.promote()
      promote = delay.promote
      await delay.promise
      try {
        if (signal.aborted) throw signal.reason
        const cached = await this.readValidCache(normalized)
        if (signal.aborted) throw signal.reason
        if (cached) return { status: 'cached' } as const
        if (!this.fetchSnapshot && !this.fetchUpdate) return { status: 'miss' } as const

        const remote = this.fetchSnapshot
          ? await this.fetchSnapshot(normalized.graphId, normalized.documentId, { signal })
          : {
              update: await this.fetchUpdate!(
                normalized.graphId,
                normalized.documentId,
                { signal },
              ),
              incarnation: null,
            }
        if (signal.aborted) throw signal.reason
        // Validate and normalize the remote bytes before they become trusted
        // cache testimony. A corrupt update is an ordinary preparation error.
        const probe = new Y.Doc()
        try {
          Y.applyUpdate(probe, remote.update)
          const normalizedUpdate = Y.encodeStateAsUpdate(probe)
          const record = this.record(
            normalized,
            normalizedUpdate,
            'snapshot',
            remote.incarnation,
          )
          // A successful authenticated snapshot is fresh existence testimony;
          // it may legitimately revive an identifier recreated after deletion.
          this.tombstones.delete(encoded)
          await this.cache.put(record)
          return { status: 'prepared', bytes: normalizedUpdate.byteLength } as const
        } finally {
          probe.destroy()
        }
      } catch (error) {
        if (isAbort(error)) return { status: 'cancelled' } as const
        if (isNotFound(error)) return { status: 'miss' } as const
        return { status: 'error', error } as const
      }
    }, 'background')
    const result = task.promise.catch((error): DocumentPreparationResult =>
      isAbort(error) ? { status: 'cancelled' } : { status: 'error', error })
    const current: CurrentPreparation = {
      key: encoded,
      identity: normalized,
      task,
      result,
      promote: () => promote(),
    }
    this.currentPreparation = current
    void result.then(outcome => {
      this.emit({
        type: 'prefetch',
        key: normalized,
        reason: candidate.reason,
        outcome: outcome.status,
        ...(outcome.status === 'prepared' ? { bytes: outcome.bytes } : {}),
      })
    }).finally(() => {
      if (this.currentPreparation === current) this.currentPreparation = null
    })
    return result
  }

  cancelPreparation(key?: DocumentActivationKey): void {
    if (
      key
      && this.currentPreparation?.key !== documentActivationKey(this.normalizedKey(key))
    ) return
    this.currentPreparation?.task.cancel()
    this.currentPreparation = null
  }

  /**
   * Attach cache hydration/persistence to a visible Y.Doc.
   *
 * The room provider must wait for `connectionPermit`. Cache hydration establishes
 * local render/edit authority first; an authenticated remote snapshot then
 * validates the document incarnation before the same Y.Doc can enter its room.
 * `whenSynced` remains separate testimony about the live handshake.
   */
  activateVisible(
    key: DocumentActivationKey,
    doc: Y.Doc,
    whenSynced: Promise<void>,
    lifecycle?: ReactiveSource<CrdtProviderLifecycle>,
  ): VisibleDocumentActivation {
    const normalized = this.normalizedKey(key)
    this.setScope(normalized.userId, normalized.graphId)
    const encoded = documentActivationKey(normalized)
    const activationEpoch = this.scopeEpoch
    const startedAt = this.now()
    let disposed = false
    let conflicted = false
    let synchronized = lifecycle?.get().synchronized ?? false
    let syncedEventEmitted = false
    let dirtySinceSync = false
    let revision = 0
    let lastSyncRevision = synchronized ? revision : -1
    let incarnation: string | null = null
    let cacheAuthority: DocumentCacheAuthority = 'snapshot'
    let persistTimer: ReturnType<typeof setTimeout> | null = null
    let validationRetryTimer: ReturnType<typeof setTimeout> | null = null
    const validationAbort = new AbortController()
    let resolveRenderable!: () => void
    let resolveSource!: (source: DocumentRenderSource) => void
    let resolvePermit!: (permit: DocumentConnectionPermit) => void
    let permitSettled = false
    let permittedIncarnation: string | null = null
    let fenceMonitorRunning = false
    let liveUnfenced = false
    let ensureFenceMonitor: () => void = () => {}
    let rendered = false
    let renderedAt: number | null = null
    const whenRenderable = new Promise<void>(resolve => { resolveRenderable = resolve })
    const renderSource = new Promise<DocumentRenderSource>(resolve => { resolveSource = resolve })
    const connectionPermit = new Promise<DocumentConnectionPermit>(resolve => {
      resolvePermit = resolve
    })
    const activationState = mutableSource<DocumentActivationState>({
      phase: 'loading',
      durability: 'none',
      renderSource: null,
      conflict: null,
    })
    let writeChain: Promise<void> = Promise.resolve()
    let writeGeneration = 0

    const matchingPreparation = this.currentPreparation?.key === encoded
      ? this.currentPreparation
      : null
    if (matchingPreparation) {
      matchingPreparation.promote()
    } else {
      this.cancelPreparation()
    }

    const settleRenderable = (source: DocumentRenderSource): void => {
      if (rendered || disposed) return
      rendered = true
      renderedAt = this.now()
      resolveSource(source)
      resolveRenderable()
      activationState.set({
        phase: synchronized
          ? 'live'
          : dirtySinceSync
            ? 'offline-dirty'
            : 'offline-clean',
        durability: 'durable',
        renderSource: source,
        conflict: null,
      })
      this.emit({
        type: 'renderable',
        key: normalized,
        source,
        elapsedMs: renderedAt - startedAt,
      })
    }

    const settlePermit = (permit: DocumentConnectionPermit): void => {
      if (permitSettled) return
      permitSettled = true
      if (permit.status === 'allowed') permittedIncarnation = permit.incarnation
      resolvePermit(permit)
    }

    const queuePersist = (authority: DocumentCacheAuthority): Promise<void> => {
      if (
        disposed
        || this.scopeEpoch !== activationEpoch
        || this.tombstones.has(encoded)
        || conflicted
      ) return writeChain
      // A safe first-open fallback may reach a live room before its blob
      // projection exposes an incarnation. Do not turn that unfenced online
      // state into reusable cache authority. A genuine later offline edit is
      // still stored as `offline`, so it can be recovered rather than lost.
      if (this.fetchSnapshot && !incarnation && authority === 'live') {
        return writeChain
      }
      cacheAuthority = authority
      const generation = ++writeGeneration
      const record = this.record(
        normalized,
        Y.encodeStateAsUpdate(doc),
        authority,
        incarnation,
      )
      const current = activationState.source.get()
      activationState.set({ ...current, durability: 'pending' })
      writeChain = writeChain.then(async () => {
        if (
          this.scopeEpoch !== activationEpoch
          || this.tombstones.has(encoded)
          || conflicted
        ) return
        try {
          await this.cache.put(record)
          if (
            this.scopeEpoch !== activationEpoch
            || this.tombstones.has(encoded)
            || conflicted
          ) {
            await this.cache.delete(normalized)
            return
          }
          if (generation === writeGeneration) {
            const latest = activationState.source.get()
            activationState.set({ ...latest, durability: 'durable' })
          }
        } catch (error) {
          if (generation === writeGeneration) {
            const latest = activationState.source.get()
            activationState.set({ ...latest, durability: 'failed' })
          }
          this.emit({ type: 'cache-error', key: normalized, operation: 'write', error })
        }
      })
      return writeChain
    }

    const schedulePersist = (authority: DocumentCacheAuthority): void => {
      if (disposed || conflicted || this.tombstones.has(encoded)) return
      if (persistTimer) clearTimeout(persistTimer)
      if (authority === 'offline') {
        persistTimer = null
        void queuePersist(authority)
        return
      }
      persistTimer = setTimeout(() => {
        persistTimer = null
        void queuePersist(authority)
      }, Math.max(0, this.persistDebounceMs))
    }

    const onUpdate = (_update: Uint8Array, origin: unknown): void => {
      if (origin === CACHE_APPLY_ORIGIN) return
      revision += 1
      // On an uncached first open, the provider's initial remote update can
      // arrive immediately before its synchronized lifecycle bit. It is not an
      // offline user edit and must not be cached as unfenced offline authority.
      if (!synchronized && !rendered && permittedIncarnation === null) return
      if (!synchronized) {
        dirtySinceSync = true
        if (rendered && !conflicted) {
          const current = activationState.source.get()
          activationState.set({ ...current, phase: 'offline-dirty' })
        }
      }
      schedulePersist(synchronized ? 'live' : 'offline')
    }
    doc.on('update', onUpdate)

    const quarantine = async (
      reason: DocumentConflictReason,
      preserve: boolean,
    ): Promise<void> => {
      if (conflicted || disposed) return
      conflicted = true
      this.tombstones.add(encoded)
      validationAbort.abort(reason)
      if (validationRetryTimer) clearTimeout(validationRetryTimer)
      validationRetryTimer = null
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = null
      let recoveryKey: string | undefined
      // C6 fix (master §3 Slice 8, WS3 §8.3): `rendered` alone missed a
      // binding that took offline edits and never painted — `dirtySinceSync`
      // is the honest signal that there is real unsent work to preserve.
      // The empty-update guard stops that widening from manufacturing a
      // parked row for a document nobody ever actually touched.
      const worthPreserving = rendered || dirtySinceSync
      try {
        if (preserve && worthPreserving) {
          const snapshot = Y.encodeStateAsUpdate(doc)
          if (!isEmptyUpdate(snapshot)) {
            const cacheRecord = this.record(normalized, snapshot, 'offline', incarnation)
            const recovery: DocumentRecoveryRecord = {
              ...recoveryFromCache(
                cacheRecord,
                reason === 'unfenced' ? 'orphaned' : reason,
                this.now(),
              ),
              relatedOperationIds: await this.resolveRelatedOperations(normalized, incarnation),
            }
            recoveryKey = recovery.key
            await this.cache.putRecovery(recovery)
          }
        }
        await this.cache.delete(normalized)
      } catch (error) {
        this.emit({ type: 'cache-error', key: normalized, operation: 'delete', error })
      }
      activationState.set({
        ...activationState.source.get(),
        phase: 'conflict',
        durability: recoveryKey !== undefined ? 'durable' : 'none',
        conflict: reason,
      })
      settlePermit({ status: 'conflict', reason })
      this.emit({
        type: 'conflict',
        key: normalized,
        reason,
        ...(recoveryKey ? { recoveryKey } : {}),
      })
    }

    const binding: ActiveDocumentBinding = {
      identity: normalized,
      quarantine: reason => quarantine(reason, true),
      discard: reason => { void quarantine(reason, false) },
    }
    const bindings = this.activeBindings.get(encoded) ?? new Set<ActiveDocumentBinding>()
    bindings.add(binding)
    this.activeBindings.set(encoded, bindings)

    let cacheHit: DocumentCacheHit | undefined
    const cacheReady = (async (): Promise<void> => {
      let hit = await this.readValidCache(normalized)
      if (!hit && matchingPreparation) {
        await matchingPreparation.result
        hit = await this.readValidCache(normalized)
      }
      if (!hit || disposed) return
      cacheHit = hit
      incarnation = hit.record.incarnation
      cacheAuthority = hit.record.authority
      dirtySinceSync = hit.record.authority === 'offline'
      try {
        Y.applyUpdate(doc, hit.record.update, CACHE_APPLY_ORIGIN)
      } catch (error) {
        await this.discardCorrupt(normalized, error)
        return
      }
      settleRenderable(renderSourceFor(hit))
      if (synchronized) schedulePersist('live')
    })().catch(error => {
      this.emit({ type: 'cache-error', key: normalized, operation: 'read', error })
    })

    const handleSynchronized = (): void => {
      if (disposed || conflicted) return
      synchronized = true
      dirtySinceSync = false
      lastSyncRevision = revision
      settleRenderable('live')
      schedulePersist('live')
      activationState.set({
        ...activationState.source.get(),
        phase: 'live',
        conflict: null,
      })
      if (syncedEventEmitted) return
      syncedEventEmitted = true
      const syncedAt = this.now()
      this.emit({
        type: 'synced',
        key: normalized,
        elapsedMs: syncedAt - startedAt,
        renderableToSyncedMs: renderedAt === null ? null : syncedAt - renderedAt,
      })
    }

    const lifecycleUnsubscribe = lifecycle?.subscribe(next => {
      if (next.synchronized) {
        handleSynchronized()
        return
      }
      const wasSynchronized = synchronized
      synchronized = false
      liveUnfenced = false
      if (!rendered || conflicted || disposed) return
      if (wasSynchronized && revision > lastSyncRevision) dirtySinceSync = true
      activationState.set({
        ...activationState.source.get(),
        phase: dirtySinceSync ? 'offline-dirty' : 'offline-clean',
      })
      if (dirtySinceSync) schedulePersist('offline')
      ensureFenceMonitor()
    })

    void whenSynced.then(handleSynchronized)

    const waitForValidationRetry = (): Promise<void> => new Promise(resolve => {
      validationRetryTimer = setTimeout(() => {
        validationRetryTimer = null
        resolve()
      }, this.validationRetryMs)
      validationAbort.signal.addEventListener('abort', () => resolve(), { once: true })
    })

    ensureFenceMonitor = (): void => {
      if (
        fenceMonitorRunning
        || !permitSettled
        || !this.fetchSnapshot
        || (synchronized && (permittedIncarnation !== null || liveUnfenced))
        || conflicted
        || disposed
      ) return
      fenceMonitorRunning = true
      void (async () => {
        while (
          !disposed
          && !conflicted
          && (!synchronized || permittedIncarnation === null)
        ) {
          await waitForValidationRetry()
          if (
            disposed
            || conflicted
            || (synchronized && permittedIncarnation !== null)
          ) break
          try {
            const remote = await this.fetchSnapshot!(
              normalized.graphId,
              normalized.documentId,
              { signal: validationAbort.signal },
            )
            if (!remote.incarnation) {
              if (permittedIncarnation === null && synchronized) {
                // The live room is usable, but this deployment cannot provide
                // reusable offline authority. Stay online-only; if the room
                // later disconnects, the lifecycle callback restarts the
                // monitor and quarantines any local work as unfenced.
                liveUnfenced = true
                break
              }
              if (permittedIncarnation === null && !rendered) continue
              await quarantine('unfenced', rendered)
              break
            }
            if (permittedIncarnation === null) {
              // Safe first-open fallback: this socket started from an empty
              // Y.Doc after a transient blob miss, so no cached operation
              // crossed an incarnation boundary. Acquire the fence as soon as
              // projection catches up.
              permittedIncarnation = remote.incarnation
              incarnation = remote.incarnation
              schedulePersist(synchronized ? 'live' : 'offline')
            } else if (remote.incarnation !== permittedIncarnation) {
              await quarantine('replaced', true)
              break
            }
            Y.applyUpdate(doc, remote.update, CACHE_APPLY_ORIGIN)
            if (dirtySinceSync) schedulePersist('offline')
          } catch (error) {
            if (disposed || conflicted || isAbort(error)) break
            if (isNotFound(error)) {
              if (permittedIncarnation === null && !rendered) continue
              if (synchronized && permittedIncarnation === null) continue
              await quarantine('deleted', true)
              break
            }
          }
        }
      })().finally(() => {
        fenceMonitorRunning = false
        if (!disposed && !conflicted && !synchronized) ensureFenceMonitor()
      })
    }

    const validateAndPermit = async (): Promise<void> => {
      await cacheReady
      if (disposed || conflicted) return
      if (!this.fetchSnapshot) {
        settlePermit({ status: 'allowed', incarnation })
        return
      }
      while (!disposed && !conflicted) {
        let remote: DocumentRemoteSnapshot
        try {
          remote = await this.fetchSnapshot(
            normalized.graphId,
            normalized.documentId,
            { signal: validationAbort.signal },
          )
        } catch (error) {
          if (disposed || conflicted || isAbort(error)) return
          if (isNotFound(error)) {
            if (cacheHit || rendered) {
              await quarantine('deleted', true)
              return
            }
            // Garden can have a live just-created room a beat before the cold
            // document projection/blob exists. Starting that room from an
            // empty Y.Doc is safe because no cached operation can cross an
            // incarnation boundary. The monitor acquires the token once
            // projection materializes.
            settlePermit({ status: 'allowed', incarnation: null })
            ensureFenceMonitor()
            return
          }
          await waitForValidationRetry()
          continue
        }

        const probe = new Y.Doc()
        let normalizedUpdate: Uint8Array
        try {
          Y.applyUpdate(probe, remote.update)
          normalizedUpdate = Y.encodeStateAsUpdate(probe)
        } catch (error) {
          this.emit({ type: 'cache-error', key: normalized, operation: 'read', error })
          await waitForValidationRetry()
          continue
        } finally {
          probe.destroy()
        }

        if (!remote.incarnation) {
          if (cacheHit || rendered) {
            await quarantine('unfenced', rendered)
            return
          }
          // Preserve online compatibility with an older deployment without
          // allowing unfenced cached state into a room. Connect from an empty
          // Y.Doc and wait for live authority; a disconnected local edit can
          // be recovered, but cannot silently cross a later identity boundary.
          settlePermit({ status: 'allowed', incarnation: null })
          ensureFenceMonitor()
          return
        }
        if (cacheHit && (!incarnation || incarnation !== remote.incarnation)) {
          await quarantine(incarnation ? 'replaced' : 'unfenced', true)
          return
        }

        // An authenticated incarnation-bearing snapshot is positive existence
        // testimony. A prior binding may remain quarantined, but a fresh open
        // can now attach to this exact replacement authority.
        this.tombstones.delete(encoded)
        incarnation = remote.incarnation
        if (!rendered) {
          const snapshotRecord = this.record(
            normalized,
            normalizedUpdate,
            'snapshot',
            incarnation,
          )
          try {
            await this.cache.put(snapshotRecord)
          } catch (error) {
            this.emit({ type: 'cache-error', key: normalized, operation: 'write', error })
          }
          if (disposed || conflicted) return
          Y.applyUpdate(doc, normalizedUpdate, CACHE_APPLY_ORIGIN)
          cacheAuthority = 'snapshot'
          settleRenderable('snapshot')
        } else {
          Y.applyUpdate(doc, normalizedUpdate, CACHE_APPLY_ORIGIN)
          schedulePersist(cacheAuthority)
        }
        settlePermit({ status: 'allowed', incarnation })
        ensureFenceMonitor()
        return
      }
    }
    void validateAndPermit()
    // Keep a rejection from the cache path observed even when live sync wins.
    void cacheReady

    const flush = async (): Promise<void> => {
      if (persistTimer) {
        clearTimeout(persistTimer)
        persistTimer = null
        void queuePersist(synchronized ? 'live' : 'offline')
      }
      while (true) {
        const observed = writeChain
        await observed
        if (observed === writeChain && !persistTimer) return
      }
    }

    return {
      whenRenderable,
      whenEditable: whenRenderable,
      renderSource,
      state: activationState.source,
      connectionPermit,
      flush,
      dispose: (): void => {
        if (disposed) return
        validationAbort.abort('disposed')
        if (validationRetryTimer) clearTimeout(validationRetryTimer)
        validationRetryTimer = null
        if (persistTimer) {
          clearTimeout(persistTimer)
          persistTimer = null
        }
        if (rendered && !conflicted && (synchronized || dirtySinceSync)) {
          void queuePersist(synchronized ? 'live' : 'offline')
        }
        disposed = true
        settlePermit({ status: 'cancelled' })
        doc.off('update', onUpdate)
        lifecycleUnsubscribe?.()
        const active = this.activeBindings.get(encoded)
        active?.delete(binding)
        if (active?.size === 0) this.activeBindings.delete(encoded)
        activationState.clear()
      },
    }
  }

  async delete(key: DocumentActivationKey): Promise<void> {
    const normalized = this.normalizedKey(key)
    const encoded = documentActivationKey(normalized)
    this.tombstones.add(encoded)
    if (this.currentPreparation?.key === encoded) this.cancelPreparation()
    for (const binding of this.activeBindings.get(encoded) ?? []) {
      binding.discard('deleted')
    }
    try {
      await this.cache.delete(normalized)
    } catch (error) {
      this.emit({ type: 'cache-error', key: normalized, operation: 'delete', error })
    }
  }

  async clearUser(userId: string, options: ClearUserOptions = {}): Promise<void> {
    const normalizedUser = normalizedPart(userId, 'userId')
    this.scopeEpoch += 1
    this.cancelPreparation()
    if (this.currentScope?.userId === normalizedUser) this.currentScope = null
    this.forgetNavigation(normalizedUser)
    // Active Y.Docs are just as user-scoped as their IndexedDB records. Lock
    // and discard them before a hosted auth provider can rotate credentials;
    // they must never reconnect under the next human identity.
    for (const [encoded, bindings] of this.activeBindings) {
      for (const binding of bindings) {
        if (binding.identity.userId !== normalizedUser) continue
        this.tombstones.add(encoded)
        binding.discard('unfenced')
      }
    }
    try {
      await this.cache.clearUser(normalizedUser, options)
    } catch (error) {
      this.emit({
        type: 'cache-error',
        key: { userId: normalizedUser, graphId: '*', documentId: '*' },
        operation: 'clear',
        error,
      })
    }
  }

  /**
   * Remove persistent testimony for documents absent from an authoritative
   * graph listing. Active bindings are tombstoned before storage I/O so a
   * concurrent debounced write cannot resurrect an orphan.
   */
  async pruneGraph(
    userId: string,
    graphId: string,
    retainedDocumentIds: Iterable<string>,
  ): Promise<number> {
    const normalizedUser = normalizedPart(userId, 'userId')
    const normalizedGraph = normalizedPart(graphId, 'graphId')
    const retained = new Set(
      [...retainedDocumentIds]
        .map(documentId => documentId.trim())
        .filter(Boolean),
    )
    // The authoritative listing is also positive existence testimony. This
    // lets a legitimately recreated document identifier leave tombstone state.
    for (const documentId of retained) {
      this.tombstones.delete(documentActivationKey({
        userId: normalizedUser,
        graphId: normalizedGraph,
        documentId,
      }))
    }
    const preparation = this.currentPreparation
    if (
      preparation?.identity.userId === normalizedUser
      && preparation.identity.graphId === normalizedGraph
      && !retained.has(preparation.identity.documentId)
    ) this.cancelPreparation(preparation.identity)
    const quarantines: Promise<void>[] = []
    const removedIdentities = new Set<string>()
    for (const [encoded, bindings] of this.activeBindings) {
      for (const binding of bindings) {
        if (
          binding.identity.userId === normalizedUser
          && binding.identity.graphId === normalizedGraph
          && !retained.has(binding.identity.documentId)
        ) {
          this.tombstones.add(encoded)
          removedIdentities.add(encoded)
          quarantines.push(binding.quarantine('deleted'))
        }
      }
    }
    try {
      await Promise.all(quarantines)
      // master §3 Slice 8 (WS3 §4.5). The storage-level orphan pass runs
      // inside one IndexedDB transaction and cannot await the resolver —
      // pre-compute what CAN be resolved (the active-binding-quarantined
      // set above; every one of those already lost its cache record via
      // `binding.quarantine()`, so the storage cursor can never rediscover
      // it independently — the two sets are disjoint by construction).
      const related = new Map<string, readonly string[]>()
      if (this.relatedOperations) {
        for (const encoded of removedIdentities) {
          const identity = JSON.parse(encoded) as [string, string, string]
          const key = { userId: identity[0], graphId: identity[1], documentId: identity[2] }
          related.set(encoded, await this.relatedOperations(key, null))
        }
      }
      const removed = await this.cache.pruneGraph(normalizedUser, normalizedGraph, retained, related)
      for (const key of removed) {
        const encoded = documentActivationKey(key)
        removedIdentities.add(encoded)
        this.tombstones.add(encoded)
      }
      const hint = this.readNavigation(normalizedUser)
      if (
        hint?.graphId === normalizedGraph
        && !retained.has(hint.documentId)
      ) this.forgetNavigation(normalizedUser)
      return removedIdentities.size
    } catch (error) {
      this.emit({
        type: 'cache-error',
        key: { userId: normalizedUser, graphId: normalizedGraph, documentId: '*' },
        operation: 'prune',
        error,
      })
      return 0
    }
  }

  /**
   * Populate the document activation cache from one already-verified complete
   * graph mirror. Same-incarnation offline work is merged into the mirrored
   * source; replacement incarnations quarantine local work; members absent
   * from the complete manifest are pruned through the ordinary delete path.
   *
   * The complete source bundle remains the primary cold authority. This
   * import is a performance bridge for the editor cache and may be repeated
   * safely after every mirror epoch.
   */
  async importCompleteMirror(
    userId: string,
    graphId: string,
    snapshots: readonly CompleteDocumentMirrorSnapshot[],
  ): Promise<DocumentMirrorImportReport> {
    const normalizedUser = normalizedPart(userId, 'userId')
    const normalizedGraph = normalizedPart(graphId, 'graphId')
    this.setScope(normalizedUser, normalizedGraph)
    let imported = 0
    let mergedOffline = 0
    let replaced = 0

    for (const snapshot of snapshots) {
      const key = this.normalizedKey({
        userId: normalizedUser,
        graphId: normalizedGraph,
        documentId: snapshot.documentId,
      })
      const encoded = documentActivationKey(key)
      const probe = new Y.Doc()
      try {
        Y.applyUpdate(probe, snapshot.update)
        const existing = await this.readValidCache(key)
        const sameIncarnation = existing?.record.incarnation === snapshot.incarnation
        if (existing && existing.record.incarnation !== snapshot.incarnation) {
          replaced += 1
          const bindings = [...(this.activeBindings.get(encoded) ?? [])]
          if (bindings.length > 0) {
            await Promise.all(bindings.map(binding => binding.quarantine('replaced')))
          } else {
            if (existing.record.authority === 'offline') {
              await this.cache.putRecovery({
                ...recoveryFromCache(existing.record, 'replaced', this.now()),
                relatedOperationIds: await this.resolveRelatedOperations(key, existing.record.incarnation),
              })
            }
            await this.cache.delete(key)
          }
        } else if (sameIncarnation && existing) {
          Y.applyUpdate(probe, existing.record.update)
          if (existing.record.authority === 'offline') mergedOffline += 1
        }
        const update = Y.encodeStateAsUpdate(probe)
        await this.cache.put(this.record(
          key,
          update,
          sameIncarnation && existing?.record.authority === 'offline' ? 'offline' : 'snapshot',
          snapshot.incarnation,
        ))
        this.tombstones.delete(encoded)
        imported += 1
      } finally {
        probe.destroy()
      }
    }

    const pruned = await this.pruneGraph(
      normalizedUser,
      normalizedGraph,
      snapshots.map(snapshot => snapshot.documentId),
    )
    return { imported, mergedOffline, replaced, pruned }
  }

  /**
   * Import one identity-fenced provisional document without asserting that it
   * is the complete graph membership set. Used by offline document creation;
   * the next complete source epoch performs the ordinary merge-and-prune pass.
   */
  async importMirrorDocument(
    userId: string,
    graphId: string,
    snapshot: CompleteDocumentMirrorSnapshot,
  ): Promise<DocumentMirrorImportReport> {
    const normalizedUser = normalizedPart(userId, 'userId')
    const normalizedGraph = normalizedPart(graphId, 'graphId')
    this.setScope(normalizedUser, normalizedGraph)
    const key = this.normalizedKey({
      userId: normalizedUser,
      graphId: normalizedGraph,
      documentId: snapshot.documentId,
    })
    const encoded = documentActivationKey(key)
    const probe = new Y.Doc()
    let mergedOffline = 0
    let replaced = 0
    try {
      Y.applyUpdate(probe, snapshot.update)
      const existing = await this.readValidCache(key)
      const sameIncarnation = existing?.record.incarnation === snapshot.incarnation
      if (existing && !sameIncarnation) {
        replaced = 1
        const bindings = [...(this.activeBindings.get(encoded) ?? [])]
        if (bindings.length > 0) {
          await Promise.all(bindings.map(binding => binding.quarantine('replaced')))
        } else {
          if (existing.record.authority === 'offline') {
            await this.cache.putRecovery({
              ...recoveryFromCache(existing.record, 'replaced', this.now()),
              relatedOperationIds: await this.resolveRelatedOperations(key, existing.record.incarnation),
            })
          }
          await this.cache.delete(key)
        }
      } else if (sameIncarnation && existing) {
        Y.applyUpdate(probe, existing.record.update)
        if (existing.record.authority === 'offline') mergedOffline = 1
      }
      await this.cache.put(this.record(
        key,
        Y.encodeStateAsUpdate(probe),
        sameIncarnation && existing?.record.authority === 'offline' ? 'offline' : 'snapshot',
        snapshot.incarnation,
      ))
      this.tombstones.delete(encoded)
      return { imported: 1, mergedOffline, replaced, pruned: 0 }
    } finally {
      probe.destroy()
    }
  }

  recoveries(key: DocumentActivationKey): Promise<readonly DocumentRecoveryRecord[]> {
    return this.cache.listRecoveries(this.normalizedKey(key))
  }

  /** Every parked record for one human, newest first (master §3 Slice 8, closes C1). */
  userRecoveries(userId: string): Promise<readonly DocumentRecoveryRecord[]> {
    return this.cache.listUserRecoveries(normalizedPart(userId, 'userId'))
  }

  /** Stamp a successful reapply without destroying the record (Law III ethic;
   *  master §3 Slice 9 is the only planned caller). */
  markRecoveryReapplied(recoveryKey: string, at: number): Promise<void> {
    return this.cache.markRecoveryReapplied(recoveryKey, at)
  }

  /** The one destructive path, reached solely through an explicit human
   *  confirmation. Never called by the reapply pipeline. */
  deleteRecovery(recoveryKey: string): Promise<void> {
    return this.cache.deleteRecovery(recoveryKey)
  }

  rememberNavigation(key: DocumentActivationKey): void {
    const normalized = this.normalizedKey(key)
    const hint: NavigationHint = {
      version: 1,
      ...normalized,
      savedAt: this.now(),
    }
    try {
      this.navigationStorage?.setItem(
        `${NAVIGATION_PREFIX}${encodeURIComponent(normalized.userId)}`,
        JSON.stringify(hint),
      )
    } catch {
      // Navigation prediction is optional; storage denial must not affect opening.
    }
  }

  readNavigation(userId: string): NavigationHint | null {
    const normalizedUser = normalizedPart(userId, 'userId')
    try {
      const raw = this.navigationStorage?.getItem(
        `${NAVIGATION_PREFIX}${encodeURIComponent(normalizedUser)}`,
      )
      if (!raw) return null
      const parsed = JSON.parse(raw) as Partial<NavigationHint>
      if (
        parsed.version !== 1
        || parsed.userId !== normalizedUser
        || typeof parsed.graphId !== 'string'
        || !parsed.graphId.trim()
        || typeof parsed.documentId !== 'string'
        || !parsed.documentId.trim()
        || typeof parsed.savedAt !== 'number'
      ) return null
      return parsed as NavigationHint
    } catch {
      return null
    }
  }

  forgetNavigation(userId: string): void {
    try {
      this.navigationStorage?.removeItem(
        `${NAVIGATION_PREFIX}${encodeURIComponent(userId)}`,
      )
    } catch {
      // Best-effort prediction cleanup; cache cleanup remains independent.
    }
  }

  diagnostics(): {
    readonly scope: { readonly userId: string; readonly graphId: string } | null
    readonly preparing: boolean
    readonly scheduler: ActivationSchedulerDiagnostics
    readonly metrics: DocumentActivationMetrics
  } {
    return {
      scope: this.currentScope,
      preparing: this.currentPreparation !== null,
      scheduler: this.scheduler.diagnostics(),
      metrics: {
        renderSources: { ...this.metricRenderSources },
        prefetchOutcomes: { ...this.metricPrefetchOutcomes },
        prefetchBytes: this.metricPrefetchBytes,
        cancellations: this.metricPrefetchOutcomes.cancelled,
        cacheErrors: this.metricCacheErrors,
        lastActivationToRenderableMs: this.metricLastActivationToRenderableMs,
        lastRenderableToSyncedMs: this.metricLastRenderableToSyncedMs,
      },
    }
  }

  private normalizedKey(key: DocumentActivationKey): DocumentActivationKey {
    return {
      userId: normalizedPart(key.userId, 'userId'),
      graphId: normalizedPart(key.graphId, 'graphId'),
      documentId: normalizedPart(key.documentId, 'documentId'),
    }
  }

  private record(
    key: DocumentActivationKey,
    update: Uint8Array,
    authority: DocumentCacheAuthority,
    incarnation: string | null,
  ): DocumentCacheRecord {
    return {
      ...key,
      key: documentActivationKey(key),
      schemaVersion: this.schemaVersion,
      update: copyUpdate(update),
      savedAt: this.now(),
      authority,
      incarnation,
    }
  }

  private async readValidCache(key: DocumentActivationKey): Promise<DocumentCacheHit | undefined> {
    if (this.tombstones.has(documentActivationKey(key))) return undefined
    const hit = await this.cache.get(key)
    if (!hit) return undefined
    const record = hit.record
    if (
      record.key !== documentActivationKey(key)
      || record.userId !== key.userId
      || record.graphId !== key.graphId
      || record.documentId !== key.documentId
      || record.schemaVersion !== this.schemaVersion
      || !(record.update instanceof Uint8Array)
      || record.update.byteLength === 0
    ) {
      await this.cache.delete(key)
      return undefined
    }
    try {
      Y.decodeUpdate(record.update)
    } catch {
      await this.cache.delete(key)
      return undefined
    }
    return hit
  }

  private async discardCorrupt(key: DocumentActivationKey, error: unknown): Promise<void> {
    try {
      await this.cache.delete(key)
    } finally {
      this.emit({ type: 'cache-error', key, operation: 'read', error })
    }
  }

  private defaultNavigationStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
    try {
      return typeof globalThis.localStorage === 'object' ? globalThis.localStorage : undefined
    } catch {
      return undefined
    }
  }

  private emit(event: DocumentActivationEvent): void {
    if (event.type === 'renderable') {
      this.metricRenderSources[event.source] += 1
      this.metricLastActivationToRenderableMs = event.elapsedMs
    } else if (event.type === 'synced') {
      this.metricLastRenderableToSyncedMs = event.renderableToSyncedMs
    } else if (event.type === 'prefetch') {
      this.metricPrefetchOutcomes[event.outcome] += 1
      this.metricPrefetchBytes += event.bytes ?? 0
    } else if (event.type === 'cache-error') {
      this.metricCacheErrors += 1
    }
    try {
      this.onEvent?.(event)
    } catch {
      // Observability is testimony about activation, never part of activation's
      // correctness path.
    }
  }
}
