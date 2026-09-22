import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  DocumentActivationCache,
  DocumentActivationManager,
  MemoryDocumentActivationStorage,
  documentActivationKey,
  type DocumentActivationKey,
  type DocumentCacheRecord,
  type DocumentRecoveryRecord,
} from '../document-activation.js'

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}

function deferredValue<T>(): {
  readonly promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}

function lifecycleSource() {
  let value = {
    connection: 'connecting' as 'connecting' | 'connected' | 'disconnected',
    synchronized: false,
    shouldConnect: true,
  }
  const listeners = new Set<(next: typeof value) => void>()
  return {
    source: {
      get: () => value,
      subscribe(listener: (next: typeof value) => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    set(next: typeof value): void {
      value = next
      for (const listener of [...listeners]) listener(next)
    },
  }
}

function updateWithText(text: string): Uint8Array {
  const doc = new Y.Doc()
  doc.getText('body').insert(0, text)
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}

const KEY: DocumentActivationKey = {
  userId: 'user-a',
  graphId: 'graph-a',
  documentId: 'doc-a',
}

function record(
  key: DocumentActivationKey,
  update: Uint8Array,
  authority: 'snapshot' | 'live' | 'offline' = 'live',
  schemaVersion = 1,
): DocumentCacheRecord {
  return {
    ...key,
    key: documentActivationKey(key),
    update,
    authority,
    schemaVersion,
    savedAt: 10,
    incarnation: 'incarnation-a',
  }
}

function recoveryRecord(
  key: DocumentActivationKey,
  update: Uint8Array,
  overrides: Partial<Omit<DocumentRecoveryRecord, keyof DocumentActivationKey | 'update'>> = {},
): DocumentRecoveryRecord {
  return {
    ...key,
    key: `${documentActivationKey(key)}:${overrides.recoveredAt ?? 0}`,
    documentKey: documentActivationKey(key),
    schemaVersion: 1,
    update,
    recoveredAt: 0,
    reason: 'deleted',
    incarnation: 'incarnation-a',
    ...overrides,
  }
}

describe('DocumentActivationManager', () => {
  it('bounds the resident cache by both document count and encoded bytes', async () => {
    const storage = new MemoryDocumentActivationStorage()
    const firstKey = { ...KEY, documentId: 'doc-first' }
    const secondKey = { ...KEY, documentId: 'doc-second' }
    const first = record(firstKey, updateWithText('first'))
    const second = record(secondKey, updateWithText('second'))
    const cache = new DocumentActivationCache(
      storage,
      8,
      Math.max(first.update.byteLength, second.update.byteLength),
    )

    await cache.put(first)
    await cache.put(second)

    expect(cache.diagnostics()).toEqual({
      entries: 1,
      bytes: second.update.byteLength,
    })
    expect(await storage.get(first.key)).toBeDefined()
    expect(await storage.get(second.key)).toBeDefined()

    const oversized = new DocumentActivationCache(storage, 8, 1)
    await oversized.get(firstKey)
    expect(oversized.diagnostics()).toEqual({ entries: 0, bytes: 0 })
  })

  it('renders a proven cached Y.Doc before sync, merges arriving edits, then persists live state', async () => {
    const storage = new MemoryDocumentActivationStorage()
    const cachedUpdate = updateWithText('cached')
    await storage.put(record(KEY, cachedUpdate))
    const manager = new DocumentActivationManager({
      storage,
      persistDebounceMs: 0,
    })
    const liveSync = deferred()
    const target = new Y.Doc()
    const activation = manager.activateVisible(KEY, target, liveSync.promise)

    await expect(activation.whenRenderable).resolves.toBeUndefined()
    await expect(activation.renderSource).resolves.toBe('memory')
    expect(target.getText('body').toString()).toBe('cached')

    const remote = new Y.Doc()
    Y.applyUpdate(remote, cachedUpdate)
    remote.getText('body').insert(6, '+remote')
    Y.applyUpdate(target, Y.encodeStateAsUpdate(remote))
    expect(target.getText('body').toString()).toBe('cached+remote')

    liveSync.resolve()
    await liveSync.promise
    await new Promise(resolve => setTimeout(resolve, 0))
    activation.dispose()
    expect(manager.diagnostics().metrics).toMatchObject({
      renderSources: { memory: 1 },
      lastActivationToRenderableMs: expect.any(Number),
      lastRenderableToSyncedMs: expect.any(Number),
    })

    const stored = await storage.get(documentActivationKey(KEY))
    const restored = new Y.Doc()
    Y.applyUpdate(restored, stored!.update)
    expect(restored.getText('body').toString()).toBe('cached+remote')
    expect(stored?.authority).toBe('live')
    restored.destroy()
    remote.destroy()
    target.destroy()
  })

  it('durably records offline edits before room sync and restores them after a cold client restart', async () => {
    const storage = new MemoryDocumentActivationStorage()
    await storage.put(record(KEY, updateWithText('cached')))
    const firstRemote = deferredValue<{ update: Uint8Array; incarnation: string | null }>()
    const firstLifecycle = lifecycleSource()
    const firstSync = deferred()
    const firstManager = new DocumentActivationManager({
      storage,
      fetchSnapshot: () => firstRemote.promise,
      validationRetryMs: 25,
    })
    const firstDoc = new Y.Doc()
    const first = firstManager.activateVisible(
      KEY,
      firstDoc,
      firstSync.promise,
      firstLifecycle.source,
    )

    await first.whenEditable
    expect(first.state.get()).toMatchObject({
      phase: 'offline-clean',
      durability: 'durable',
    })
    firstDoc.getText('body').insert(6, '+offline-a')
    await first.flush()
    expect(first.state.get()).toMatchObject({
      phase: 'offline-dirty',
      durability: 'durable',
    })
    const durable = await storage.get(documentActivationKey(KEY))
    expect(durable?.authority).toBe('offline')

    first.dispose()
    firstDoc.destroy()

    const secondRemote = deferredValue<{ update: Uint8Array; incarnation: string | null }>()
    const secondManager = new DocumentActivationManager({
      storage,
      fetchSnapshot: () => secondRemote.promise,
      validationRetryMs: 25,
    })
    const secondDoc = new Y.Doc()
    const second = secondManager.activateVisible(KEY, secondDoc, new Promise<void>(() => {}))
    await second.whenEditable
    expect(secondDoc.getText('body').toString()).toBe('cached+offline-a')
    expect(second.state.get().phase).toBe('offline-dirty')

    second.dispose()
    secondDoc.destroy()
  })

  it('reports failed local durability instead of silently claiming an offline edit is saved', async () => {
    const storage = new MemoryDocumentActivationStorage()
    await storage.put(record(KEY, updateWithText('cached')))
    vi.spyOn(storage, 'put').mockRejectedValue(new Error('quota exhausted'))
    const manager = new DocumentActivationManager({ storage })
    const doc = new Y.Doc()
    const activation = manager.activateVisible(KEY, doc, new Promise<void>(() => {}))

    await activation.whenEditable
    doc.getText('body').insert(6, '+at-risk')
    await activation.flush()

    expect(activation.state.get()).toMatchObject({
      phase: 'offline-dirty',
      durability: 'failed',
    })
    activation.dispose()
    doc.destroy()
  })

  it('never connects stale state to a replacement incarnation and preserves it as recovery', async () => {
    const storage = new MemoryDocumentActivationStorage()
    await storage.put(record(KEY, updateWithText('old-authority'), 'offline'))
    const remote = deferredValue<{ update: Uint8Array; incarnation: string | null }>()
    const manager = new DocumentActivationManager({
      storage,
      fetchSnapshot: () => remote.promise,
      validationRetryMs: 25,
    })
    const doc = new Y.Doc()
    const activation = manager.activateVisible(KEY, doc, new Promise<void>(() => {}))

    await activation.whenEditable
    doc.getText('body').insert(doc.getText('body').length, '+unsynced')
    await activation.flush()
    remote.resolve({
      update: updateWithText('fresh-replacement'),
      incarnation: 'incarnation-b',
    })

    await expect(activation.connectionPermit).resolves.toEqual({
      status: 'conflict',
      reason: 'replaced',
    })
    expect(activation.state.get()).toMatchObject({
      phase: 'conflict',
      conflict: 'replaced',
      durability: 'durable',
    })
    expect(await storage.get(documentActivationKey(KEY))).toBeUndefined()
    const recoveries = await manager.recoveries(KEY)
    expect(recoveries).toHaveLength(1)
    const recovered = new Y.Doc()
    Y.applyUpdate(recovered, recoveries[0]!.update)
    expect(recovered.getText('body').toString()).toBe('old-authority+unsynced')

    activation.dispose()
    recovered.destroy()
    doc.destroy()
  })

  it('moves an inactive offline record to recovery when an authoritative listing deletes it', async () => {
    const storage = new MemoryDocumentActivationStorage()
    const orphan = { ...KEY, documentId: 'offline-orphan' }
    await storage.put(record(orphan, updateWithText('unsynced-offline'), 'offline'))
    const manager = new DocumentActivationManager({ storage })

    await expect(manager.pruneGraph(KEY.userId, KEY.graphId, [])).resolves.toBe(1)
    expect(await storage.get(documentActivationKey(orphan))).toBeUndefined()
    const recoveries = await manager.recoveries(orphan)
    expect(recoveries).toHaveLength(1)
    expect(recoveries[0]).toMatchObject({ reason: 'orphaned' })
  })

  it('does not expose an editable-looking empty document on a cache miss', async () => {
    const manager = new DocumentActivationManager({
      storage: new MemoryDocumentActivationStorage(),
    })
    const liveSync = deferred()
    const target = new Y.Doc()
    const activation = manager.activateVisible(KEY, target, liveSync.promise)
    let rendered = false
    void activation.whenRenderable.then(() => { rendered = true })

    await Promise.resolve()
    await Promise.resolve()
    expect(rendered).toBe(false)
    expect(target.getText('body').toString()).toBe('')

    target.getText('body').insert(0, 'authoritative')
    liveSync.resolve()
    await expect(activation.whenRenderable).resolves.toBeUndefined()
    await expect(activation.renderSource).resolves.toBe('live')
    expect(rendered).toBe(true)
    activation.dispose()
    target.destroy()
  })

  it('opens a just-created live room from empty state after a transient blob 404, then acquires its fence', async () => {
    const storage = new MemoryDocumentActivationStorage()
    const authoritative = updateWithText('just-created')
    let reads = 0
    const fetchSnapshot = vi.fn(async () => {
      reads += 1
      if (reads === 1) {
        throw Object.assign(new Error('projection not materialized yet'), { status: 404 })
      }
      return {
        update: authoritative,
        incarnation: 'incarnation-new',
      }
    })
    const lifecycle = lifecycleSource()
    const liveSync = deferred()
    const manager = new DocumentActivationManager({
      storage,
      fetchSnapshot,
      persistDebounceMs: 0,
      validationRetryMs: 25,
    })
    const target = new Y.Doc()
    const activation = manager.activateVisible(
      KEY,
      target,
      liveSync.promise,
      lifecycle.source,
    )

    await expect(activation.connectionPermit).resolves.toEqual({
      status: 'allowed',
      incarnation: null,
    })
    expect(target.getText('body').toString()).toBe('')

    // This is the provider's initial authoritative sync, not a local offline
    // edit. It becomes render/edit authority only with the live testimony.
    Y.applyUpdate(target, authoritative)
    lifecycle.set({
      connection: 'connected',
      synchronized: true,
      shouldConnect: true,
    })
    liveSync.resolve()
    await activation.whenEditable
    expect(target.getText('body').toString()).toBe('just-created')

    const fenced = await vi.waitFor(async () => {
      const cached = await storage.get(documentActivationKey(KEY))
      expect(cached?.incarnation).toBe('incarnation-new')
      expect(cached?.authority).toBe('live')
      return cached
    })
    expect(fenced).toBeDefined()
    expect(fetchSnapshot).toHaveBeenCalledTimes(2)

    activation.dispose()
    target.destroy()
  })

  it('background-fetches, validates, and caches a snapshot without a room provider', async () => {
    const storage = new MemoryDocumentActivationStorage()
    const fetchUpdate = vi.fn(async () => updateWithText('prepared'))
    const manager = new DocumentActivationManager({ storage, fetchUpdate })

    await expect(manager.prepare({ ...KEY, reason: 'intent' })).resolves.toEqual({
      status: 'prepared',
      bytes: expect.any(Number),
    })
    expect(fetchUpdate).toHaveBeenCalledOnce()

    const liveSync = deferred()
    const target = new Y.Doc()
    const activation = manager.activateVisible(KEY, target, liveSync.promise)
    await activation.whenRenderable
    expect(await activation.renderSource).toBe('snapshot')
    expect(target.getText('body').toString()).toBe('prepared')
    activation.dispose()
    await Promise.resolve()
    expect((await storage.get(documentActivationKey(KEY)))?.authority).toBe('snapshot')
    target.destroy()
  })

  it('promotes a delayed intent immediately when the same document is directly opened', async () => {
    const fetchUpdate = vi.fn(async () => updateWithText('promoted'))
    const manager = new DocumentActivationManager({
      storage: new MemoryDocumentActivationStorage(),
      fetchUpdate,
    })
    const delayedIntent = manager.prepare({
      ...KEY,
      reason: 'intent',
      delayMs: 60_000,
    })
    const directIntent = manager.prepare({
      ...KEY,
      reason: 'intent',
      delayMs: 0,
    })

    expect(directIntent).toBe(delayedIntent)
    await expect(directIntent).resolves.toMatchObject({ status: 'prepared' })
    expect(fetchUpdate).toHaveBeenCalledOnce()
  })

  it('cancels displaced intent and treats a brief snapshot 404 as an ordinary miss', async () => {
    let firstAborted = false
    const firstStarted = deferred()
    const fetchUpdate = vi.fn((
      _graphId: string,
      documentId: string,
      options?: { readonly signal?: AbortSignal },
    ): Promise<Uint8Array> => {
      if (documentId === 'missing') {
        return Promise.reject(Object.assign(new Error('not materialized yet'), { status: 404 }))
      }
      return new Promise((resolve, reject) => {
        firstStarted.resolve()
        options?.signal?.addEventListener('abort', () => {
          firstAborted = true
          reject(options.signal?.reason)
        }, { once: true })
        void resolve
      })
    })
    const manager = new DocumentActivationManager({
      storage: new MemoryDocumentActivationStorage(),
      fetchUpdate,
    })
    const first = manager.prepare({ ...KEY, reason: 'intent' })
    await firstStarted.promise
    const missing = manager.prepare({ ...KEY, documentId: 'missing', reason: 'intent' })

    await expect(first).resolves.toEqual({ status: 'cancelled' })
    await expect(missing).resolves.toEqual({ status: 'miss' })
    expect(firstAborted).toBe(true)
  })

  it('discards corrupt/schema-mismatched entries and deletion cannot resurrect them', async () => {
    const storage = new MemoryDocumentActivationStorage()
    await storage.put(record(KEY, new Uint8Array([255, 0, 1])))
    const manager = new DocumentActivationManager({ storage, persistDebounceMs: 0 })
    const sync = deferred()
    const target = new Y.Doc()
    const activation = manager.activateVisible(KEY, target, sync.promise)
    let rendered = false
    void activation.whenRenderable.then(() => { rendered = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(rendered).toBe(false)

    sync.resolve()
    await activation.whenRenderable
    await manager.delete(KEY)
    target.getText('body').insert(0, 'late')
    activation.dispose()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await storage.get(documentActivationKey(KEY))).toBeUndefined()
    target.destroy()

    await storage.put(record(KEY, updateWithText('old-schema'), 'live', 99))
    const next = new DocumentActivationManager({ storage })
    const nextSync = deferred()
    const nextDoc = new Y.Doc()
    const nextActivation = next.activateVisible(KEY, nextDoc, nextSync.promise)
    await Promise.resolve()
    await Promise.resolve()
    expect(nextDoc.getText('body').toString()).toBe('')
    nextSync.resolve()
    await nextActivation.whenRenderable
    nextActivation.dispose()
    nextDoc.destroy()
  })

  it('keeps navigation hints user-scoped and clears cache plus hint on logout', async () => {
    const values = new Map<string, string>()
    const navigationStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    const storage = new MemoryDocumentActivationStorage()
    const manager = new DocumentActivationManager({ storage, navigationStorage })
    manager.rememberNavigation(KEY)
    await storage.put(record(KEY, updateWithText('private')))
    const activeDoc = new Y.Doc()
    const active = manager.activateVisible(KEY, activeDoc, new Promise<void>(() => {}))
    await active.whenEditable

    expect(manager.readNavigation('user-a')).toMatchObject(KEY)
    expect(manager.readNavigation('user-b')).toBeNull()
    await manager.clearUser('user-a')
    expect(manager.readNavigation('user-a')).toBeNull()
    expect(await storage.get(documentActivationKey(KEY))).toBeUndefined()
    await vi.waitFor(() => {
      expect(active.state.get()).toMatchObject({
        phase: 'conflict',
        conflict: 'unfenced',
      })
    })
    active.dispose()
    activeDoc.destroy()
  })

  it('prunes graph orphans, cancels their preparation, and prevents active writes from reviving them', async () => {
    const storage = new MemoryDocumentActivationStorage()
    const orphanKey = { ...KEY, documentId: 'orphan' }
    const retainedKey = { ...KEY, documentId: 'retained' }
    await storage.put(record(orphanKey, updateWithText('orphan')))
    await storage.put(record(retainedKey, updateWithText('retained')))
    const fetchUpdate = vi.fn(async () => updateWithText('must-not-run'))
    const manager = new DocumentActivationManager({
      storage,
      fetchUpdate,
      persistDebounceMs: 0,
    })
    manager.rememberNavigation(orphanKey)

    const sync = deferred()
    const doc = new Y.Doc()
    const activation = manager.activateVisible(orphanKey, doc, sync.promise)
    await activation.whenRenderable
    sync.resolve()
    await sync.promise
    await new Promise(resolve => setTimeout(resolve, 0))

    const preparation = manager.prepare({
      ...orphanKey,
      reason: 'intent',
      delayMs: 125,
    })
    await expect(manager.pruneGraph(KEY.userId, KEY.graphId, [retainedKey.documentId])).resolves.toBe(1)
    await expect(preparation).resolves.toEqual({ status: 'cancelled' })
    expect(fetchUpdate).not.toHaveBeenCalled()
    expect(manager.readNavigation(KEY.userId)).toBeNull()

    doc.getText('body').insert(0, 'late')
    activation.dispose()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await storage.get(documentActivationKey(orphanKey))).toBeUndefined()
    expect(await storage.get(documentActivationKey(retainedKey))).toBeDefined()
    doc.destroy()
  })

  // ── master §3 Slice 8 (WS3 §8.3, C6 — the one genuine data-loss bug this
  // ── programme fixes rather than merely surfaces) ────────────────────────

  it('C6 regression — a binding that took offline edits before ever painting still preserves them on quarantine', async () => {
    const storage = new MemoryDocumentActivationStorage()
    let calls = 0
    // First call: nothing materialized on the server yet (a just-created,
    // still-empty room) — the "safe first-open fallback" branch, which
    // settles the permit with `incarnation: null` WITHOUT ever calling
    // settleRenderable (no cache hit, no live sync). Second+ calls (the
    // fence monitor's own background poll, not gated on rendering): the
    // projection has now materialized, handing back a real incarnation —
    // `permittedIncarnation` is set DIRECTLY inside that poll (:1449, not
    // via `settlePermit`), so `rendered` stays false while
    // `permittedIncarnation` becomes non-null. An edit landing AFTER that
    // point is real, addressable offline work with nowhere yet to paint it.
    const fetchSnapshot = vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        throw Object.assign(new Error('not materialized yet'), { status: 404 })
      }
      return { update: updateWithText(''), incarnation: 'incarnation-new' }
    })
    const manager = new DocumentActivationManager({
      storage,
      fetchSnapshot,
      validationRetryMs: 10,
    })
    const doc = new Y.Doc()
    // No lifecycle, and a `whenSynced` that never resolves: this binding
    // never becomes `synchronized`, so `handleSynchronized` (the OTHER path
    // that would set `rendered`) never fires either.
    const activation = manager.activateVisible(KEY, doc, new Promise<void>(() => {}))

    await expect(activation.connectionPermit).resolves.toEqual({ status: 'allowed', incarnation: null })

    let rendered = false
    void activation.whenRenderable.then(() => { rendered = true })

    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledTimes(2))
    // Let the fence monitor's own continuation (the `permittedIncarnation =`
    // assignment right after the awaited fetchSnapshot call) actually run.
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(rendered).toBe(false)

    doc.getText('body').insert(0, 'never painted but real')
    // Give the CRDT's own synchronous 'update' event a turn to reach
    // `onUpdate` (it does — Y.Doc emits synchronously — this is just
    // matching the file's own existing await style around edits).
    await Promise.resolve()

    await expect(manager.pruneGraph(KEY.userId, KEY.graphId, [])).resolves.toBe(1)
    expect(activation.state.get()).toMatchObject({
      phase: 'conflict',
      conflict: 'deleted',
      durability: 'durable',
    })

    const recoveries = await manager.recoveries(KEY)
    expect(recoveries).toHaveLength(1)
    const recovered = new Y.Doc()
    Y.applyUpdate(recovered, recoveries[0]!.update)
    expect(recovered.getText('body').toString()).toBe('never painted but real')
    recovered.destroy()

    activation.dispose()
    doc.destroy()
  })

  it('C6 regression — an untouched binding (never rendered, never dirtied) produces no recovery at all', async () => {
    const storage = new MemoryDocumentActivationStorage()
    const manager = new DocumentActivationManager({ storage })
    const doc = new Y.Doc()
    // No cache hit (empty storage), no fetchSnapshot/fetchUpdate configured
    // at all — `rendered` and `dirtySinceSync` both stay false forever.
    const activation = manager.activateVisible(KEY, doc, new Promise<void>(() => {}))
    await Promise.resolve()
    await Promise.resolve()

    await expect(manager.pruneGraph(KEY.userId, KEY.graphId, [])).resolves.toBe(1)
    expect(activation.state.get()).toMatchObject({ phase: 'conflict', durability: 'none' })
    expect(await manager.recoveries(KEY)).toHaveLength(0)

    activation.dispose()
    doc.destroy()
  })

  it('listUserRecoveries enumerates every parked record for one human, newest first, across documents', async () => {
    const storage = new MemoryDocumentActivationStorage()
    const first = { ...KEY, documentId: 'doc-first' }
    const second = { ...KEY, documentId: 'doc-second' }
    const otherUser = { ...KEY, userId: 'user-b', documentId: 'doc-other-user' }
    await storage.putRecovery(recoveryRecord(first, updateWithText('older'), { recoveredAt: 100, reason: 'deleted' }))
    await storage.putRecovery(recoveryRecord(second, updateWithText('newer'), { recoveredAt: 200, reason: 'replaced' }))
    await storage.putRecovery(recoveryRecord(otherUser, updateWithText('not-mine'), { recoveredAt: 300, reason: 'orphaned' }))
    const manager = new DocumentActivationManager({ storage })

    const mine = await manager.userRecoveries('user-a')
    expect(mine.map(r => r.documentId)).toEqual(['doc-second', 'doc-first'])
    expect(await manager.userRecoveries('user-b')).toHaveLength(1)
  })

  it('clearUser({retainRecoveries:true}) empties the document cache but leaves parked recoveries; the default flips to keep (D7)', async () => {
    const storage = new MemoryDocumentActivationStorage()
    await storage.put(record(KEY, updateWithText('cached')))
    await storage.putRecovery(recoveryRecord(KEY, updateWithText('parked'), { recoveredAt: 100, reason: 'deleted' }))
    const manager = new DocumentActivationManager({ storage })

    // Default (no options) — master §3 Slice 8, D7 RATIFIED: retains.
    await manager.clearUser('user-a')
    expect(await storage.get(documentActivationKey(KEY))).toBeUndefined()
    expect(await manager.userRecoveries('user-a')).toHaveLength(1)

    // The destructive fallback still exists, reached only through an
    // explicit option (§8.2 — specced, not default).
    await manager.clearUser('user-a', { retainRecoveries: false })
    expect(await manager.userRecoveries('user-a')).toHaveLength(0)
  })

  it('markRecoveryReapplied stamps without destroying (Law III); deleteRecovery is the one destructive path', async () => {
    const storage = new MemoryDocumentActivationStorage()
    const recoveryKey = documentActivationKey(KEY) + ':r1'
    await storage.putRecovery(recoveryRecord(KEY, updateWithText('parked'), {
      key: recoveryKey,
      recoveredAt: 100,
      reason: 'replaced',
    }))
    const manager = new DocumentActivationManager({ storage })

    await manager.markRecoveryReapplied(recoveryKey, 500)
    const [after] = await manager.userRecoveries('user-a')
    expect(after).toMatchObject({ key: recoveryKey, reappliedAt: 500 })

    await manager.deleteRecovery(recoveryKey)
    expect(await manager.userRecoveries('user-a')).toHaveLength(0)
  })

  it('the relatedOperations resolver seam joins into a fresh recovery at quarantine time; absent resolver leaves the field unset (joinUnavailable)', async () => {
    const storage = new MemoryDocumentActivationStorage()
    await storage.put(record(KEY, updateWithText('old-authority'), 'offline'))
    const remote = deferredValue<{ update: Uint8Array; incarnation: string | null }>()
    const relatedOperations = vi.fn(() => ['op-1', 'op-2'])
    const manager = new DocumentActivationManager({
      storage,
      fetchSnapshot: () => remote.promise,
      validationRetryMs: 25,
      relatedOperations,
    })
    const doc = new Y.Doc()
    const activation = manager.activateVisible(KEY, doc, new Promise<void>(() => {}))
    await activation.whenEditable
    doc.getText('body').insert(doc.getText('body').length, '+unsynced')
    await activation.flush()
    remote.resolve({ update: updateWithText('fresh-replacement'), incarnation: 'incarnation-b' })
    await activation.connectionPermit

    const [recovery] = await manager.recoveries(KEY)
    expect(recovery).toMatchObject({ relatedOperationIds: ['op-1', 'op-2'] })
    expect(relatedOperations).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-a', graphId: 'graph-a', documentId: 'doc-a' }),
      'incarnation-a',
    )

    activation.dispose()
    doc.destroy()

    // No resolver configured at all: the field stays genuinely UNSET
    // (never normalized to `[]`), distinguishing "never asked" from
    // "asked, found nothing" (D4 — `parked-work.ts`'s `joinUnavailable`).
    const storage2 = new MemoryDocumentActivationStorage()
    await storage2.put(record(KEY, updateWithText('old-authority-2'), 'offline'))
    const remote2 = deferredValue<{ update: Uint8Array; incarnation: string | null }>()
    const manager2 = new DocumentActivationManager({
      storage: storage2,
      fetchSnapshot: () => remote2.promise,
      validationRetryMs: 25,
    })
    const doc2 = new Y.Doc()
    const activation2 = manager2.activateVisible(KEY, doc2, new Promise<void>(() => {}))
    await activation2.whenEditable
    doc2.getText('body').insert(doc2.getText('body').length, '+unsynced-2')
    await activation2.flush()
    remote2.resolve({ update: updateWithText('fresh-replacement-2'), incarnation: 'incarnation-c' })
    await activation2.connectionPermit

    const [recovery2] = await manager2.recoveries(KEY)
    expect(recovery2!.relatedOperationIds).toBeUndefined()

    activation2.dispose()
    doc2.destroy()
  })
})
