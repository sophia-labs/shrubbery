import type {
  CommittedSourceMirror,
  GraphLifecycleIntent,
  GraphLifecycleStorage,
  SourceMirrorStorage,
  SourceOutboxRecord,
} from '@shrubbery/source'

const DB_NAME = 'shrubbery-source-mirror-v1'
const DB_VERSION = 2
const MIRRORS = 'mirrors'
const OUTBOX = 'outbox'
const OUTBOX_MIRROR_INDEX = 'mirrorKey'
const GRAPH_LIFECYCLE = 'graph-lifecycle'
const GRAPH_LIFECYCLE_USER_INDEX = 'userId'

export type SourceMirrorIndexedDbTransactionKind =
  | 'mirror'
  | 'outbox'
  | 'graph-lifecycle'

export interface IndexedDbSourceMirrorStorageHooks {
  /**
   * Deterministic transaction seam for durability/fault-injection harnesses.
   * Production callers omit it. Calling `transaction.abort()` here exercises
   * the same IndexedDB abort boundary used for quota and serialization errors.
   */
  beforeTransactionComplete?(
    kind: SourceMirrorIndexedDbTransactionKind,
    transaction: IDBTransaction,
  ): void
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(
      transaction.error ?? new Error('IndexedDB transaction aborted'),
    )
    transaction.onerror = () => reject(
      transaction.error ?? new Error('IndexedDB transaction failed'),
    )
  })
}

export class IndexedDbSourceMirrorStorage
implements SourceMirrorStorage, GraphLifecycleStorage {
  private database: Promise<IDBDatabase> | null = null

  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly hooks: IndexedDbSourceMirrorStorageHooks = {},
  ) {}

  async readMirror(key: string): Promise<CommittedSourceMirror | undefined> {
    const db = await this.open()
    const transaction = db.transaction(MIRRORS, 'readonly')
    const result = await requestResult(
      transaction.objectStore(MIRRORS).get(key) as IDBRequest<CommittedSourceMirror | undefined>,
    )
    await transactionDone(transaction)
    return result
  }

  async commitMirror(record: CommittedSourceMirror): Promise<void> {
    const db = await this.open()
    const transaction = db.transaction(MIRRORS, 'readwrite')
    transaction.objectStore(MIRRORS).put(record)
    // This completion event—not the put request—is the complete-mirror commit
    // point. Quota, serialization, and transaction aborts reject the promise.
    this.hooks.beforeTransactionComplete?.('mirror', transaction)
    await transactionDone(transaction)
  }

  async putOutbox(record: SourceOutboxRecord): Promise<void> {
    const db = await this.open()
    const transaction = db.transaction(OUTBOX, 'readwrite')
    transaction.objectStore(OUTBOX).put(record)
    this.hooks.beforeTransactionComplete?.('outbox', transaction)
    await transactionDone(transaction)
  }

  async listOutbox(mirrorKey: string): Promise<readonly SourceOutboxRecord[]> {
    const db = await this.open()
    const transaction = db.transaction(OUTBOX, 'readonly')
    const index = transaction.objectStore(OUTBOX).index(OUTBOX_MIRROR_INDEX)
    const result = await requestResult(
      index.getAll(IDBKeyRange.only(mirrorKey)) as IDBRequest<SourceOutboxRecord[]>,
    )
    await transactionDone(transaction)
    return result.sort(
      (left, right) => left.createdAt - right.createdAt || left.key.localeCompare(right.key),
    )
  }

  async putGraphLifecycleIntent(intent: GraphLifecycleIntent): Promise<void> {
    const db = await this.open()
    const transaction = db.transaction(GRAPH_LIFECYCLE, 'readwrite')
    transaction.objectStore(GRAPH_LIFECYCLE).put(intent)
    this.hooks.beforeTransactionComplete?.('graph-lifecycle', transaction)
    await transactionDone(transaction)
  }

  async listGraphLifecycleIntents(
    userId: string,
  ): Promise<readonly GraphLifecycleIntent[]> {
    const db = await this.open()
    const transaction = db.transaction(GRAPH_LIFECYCLE, 'readonly')
    const index = transaction
      .objectStore(GRAPH_LIFECYCLE)
      .index(GRAPH_LIFECYCLE_USER_INDEX)
    const result = await requestResult(
      index.getAll(IDBKeyRange.only(userId)) as IDBRequest<GraphLifecycleIntent[]>,
    )
    await transactionDone(transaction)
    return result.sort(
      (left, right) => left.createdAt - right.createdAt || left.key.localeCompare(right.key),
    )
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    this.database = new Promise((resolve, reject) => {
      const request = this.factory.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(MIRRORS)) {
          db.createObjectStore(MIRRORS, { keyPath: 'key' })
        }
        if (!db.objectStoreNames.contains(OUTBOX)) {
          const outbox = db.createObjectStore(OUTBOX, { keyPath: 'key' })
          outbox.createIndex(OUTBOX_MIRROR_INDEX, 'mirrorKey', { unique: false })
        }
        if (!db.objectStoreNames.contains(GRAPH_LIFECYCLE)) {
          const lifecycle = db.createObjectStore(GRAPH_LIFECYCLE, { keyPath: 'key' })
          lifecycle.createIndex(
            GRAPH_LIFECYCLE_USER_INDEX,
            GRAPH_LIFECYCLE_USER_INDEX,
            { unique: false },
          )
        }
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          db.close()
          this.database = null
        }
        resolve(db)
      }
      request.onerror = () => {
        this.database = null
        reject(request.error ?? new Error('open source mirror IndexedDB failed'))
      }
      request.onblocked = () => {
        this.database = null
        reject(new Error('open source mirror IndexedDB was blocked'))
      }
    })
    return this.database
  }
}
