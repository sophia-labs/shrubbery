import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  FENCE_CODES,
  MemorySourceMirrorStorage,
  PERMANENT_CODES,
  SOURCE_FAULT_CODES,
  SourceMirrorManager,
  buildResolveCurrentOperation,
  classifySourceFault,
  createProvisionalSourceBundle,
  documentIdOf,
  isDocumentBearingOperation,
  isFenceFault,
  retryable,
  sourceErrorTestimony,
  sourceOperationDigest,
  validateSourceBundle,
  type SourceBundle,
  type SourceOperation,
  type SourcePushResult,
  type SourceSyncTransport,
} from '../src/index.js'

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
}

function digest(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function bundle(
  epoch: string,
  incarnation = 'incarnation-a',
  projection = '<urn:s> <urn:p> "v" <urn:g> .\n',
): SourceBundle {
  const revision = Number(epoch.replace(/\D/g, '')) || 1
  const workspace = Buffer.from(`workspace:${epoch}`)
  const baseline = '<urn:legacy> <urn:source> "baseline" <urn:g> .\n'
  const members = [
    {
      sourceKind: 'current-state' as const,
      objectId: 'legacy-rdf-baseline',
      objectIncarnation: null,
      sourceVersion: digest(baseline),
      localDigest: digest(baseline),
      durable: true,
    },
    {
      sourceKind: 'ydoc' as const,
      objectId: 'workspace',
      objectIncarnation: incarnation,
      sourceVersion: digest(workspace),
      localDigest: digest(workspace),
      durable: true,
    },
    {
      sourceKind: 'derived' as const,
      objectId: 'rdf-projection-snapshot',
      objectIncarnation: null,
      sourceVersion: digest(projection),
      localDigest: digest(projection),
      durable: true,
    },
  ]
  return {
    schemaVersion: 1,
    graphId: 'graph-a',
    graphIncarnation: incarnation,
    revision,
    epoch,
    complete: true,
    manifest: {
      sourceManifestHash: digest(canonical(members)),
      members,
      complete: true,
    },
    workspace: {
      updateBase64: workspace.toString('base64'),
      digest: digest(workspace),
    },
    documents: [],
    currentState: [],
    events: [],
    memory: [],
    valuations: [],
    retractions: [],
    legacyBaseline: {
      ledgerRevision: 0,
      capturedAtMs: 1,
      rdfSnapshot: {
        format: 'application/n-quads',
        data: baseline,
        digest: digest(baseline),
        quadCount: 1,
      },
      valuationStores: {},
    },
    valuationStores: {},
    conflicts: [],
    receipts: [],
    sourceRegistry: [],
    projectionSnapshot: {
      format: 'application/n-quads',
      data: projection,
      digest: digest(projection),
      quadCount: 1,
      sourceRevision: revision,
    },
  }
}

class Transport implements SourceSyncTransport {
  nextBundle = bundle('epoch-1')
  pushes: SourceOperation[][] = []
  pushError: Error | null = null
  receiptOutcome: Record<string, unknown> = { outcome: 'applied' }
  pushTransform: ((result: SourcePushResult) => SourcePushResult) | null = null

  async pull(): Promise<SourceBundle> {
    return this.nextBundle
  }

  async push(
    graphId: string,
    graphIncarnation: string,
    operations: readonly SourceOperation[],
  ): Promise<SourcePushResult> {
    if (this.pushError) throw this.pushError
    this.pushes.push([...operations])
    const result: SourcePushResult = {
      ok: true,
      graphId,
      graphIncarnation,
      revision: 2,
      receipts: await Promise.all(operations.map(async (operation, index) => ({
        operationId: operation.operationId,
        digest: await sourceOperationDigest(operation),
        acceptedRevision: index + 1,
        status: 'applied' as const,
        duplicate: this.pushes.length > 1,
        outcome: this.receiptOutcome,
      }))),
    }
    return this.pushTransform?.(result) ?? result
  }
}

function manager(storage: MemorySourceMirrorStorage, transport: Transport): SourceMirrorManager {
  return new SourceMirrorManager({
    identity: { userId: 'user-a', graphId: 'graph-a' },
    storage,
    transport,
    now: () => 100,
  })
}

describe('SourceMirrorManager', () => {
  it('cold-opens an identity-fenced provisional empty graph before its lifecycle intent is delivered', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const mirror = manager(storage, transport)
    await mirror.open()
    const provisional = await createProvisionalSourceBundle({
      graphId: 'graph-a',
      graphIncarnation: '11111111-1111-4111-8111-111111111111',
      workspaceUpdateBase64: Buffer.from([0, 0]).toString('base64'),
      now: 50,
    })
    await mirror.bootstrap(provisional)
    expect(mirror.get()).toMatchObject({
      phase: 'complete',
      complete: true,
      graphIncarnation: '11111111-1111-4111-8111-111111111111',
      epoch: 'provisional:11111111-1111-4111-8111-111111111111',
    })

    const cold = manager(storage, transport)
    await cold.open()
    expect(cold.bundle()).toMatchObject({ provisional: true, documents: [] })
  })

  it('commits a verified complete epoch and cold-reopens it without transport', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const first = manager(storage, transport)
    await first.open()
    await first.pull()
    expect(first.get()).toMatchObject({
      phase: 'complete',
      complete: true,
      epoch: 'epoch-1',
      graphIncarnation: 'incarnation-a',
    })

    const cold = manager(storage, new Transport())
    await cold.open()
    expect(cold.get()).toMatchObject({
      phase: 'complete',
      complete: true,
      epoch: 'epoch-1',
    })
    expect(cold.projectionSnapshot()?.data).toContain('<urn:s>')
  })

  it('rejects corrupt bytes before the completeness commit', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    transport.nextBundle = {
      ...transport.nextBundle,
      workspace: {
        ...transport.nextBundle.workspace,
        updateBase64: Buffer.from('tampered').toString('base64'),
      },
    }
    const mirror = manager(storage, transport)
    await mirror.open()
    await expect(mirror.pull()).rejects.toThrow('digest mismatch for workspace')
    expect(storage.mirrors.size).toBe(0)
    expect(mirror.get()).toMatchObject({ complete: false, phase: 'error' })
  })

  it('rejects a self-consistent manifest that is not closed over its payload', async () => {
    const base = bundle('epoch-closure')
    const incomplete: SourceBundle = {
      ...base,
      currentState: [{
        objectKey: 'emporium-bookmark\u001fBookmark\u001funlisted',
        vocab: 'emporium-bookmark',
        class: 'Bookmark',
        objectId: 'unlisted',
        sourceVersion: 'sv-unlisted',
        reconciliationStrategy: 'producerDirected',
        record: { kind: 'Bookmark', title: 'not manifest bound' },
      }],
    }
    await expect(validateSourceBundle(incomplete, 'graph-a')).rejects.toThrow(
      'complete manifest omits payload member',
    )

    const members = base.manifest.members.filter(member => member.objectId !== 'workspace')
    const omitted: SourceBundle = {
      ...base,
      manifest: {
        ...base.manifest,
        members,
        sourceManifestHash: digest(canonical(members)),
      },
    }
    await expect(validateSourceBundle(omitted, 'graph-a')).rejects.toThrow(
      'complete manifest omits payload member workspace',
    )
  })

  it('rejects duplicate, unbound, and wrongly typed manifest identities', async () => {
    const base = bundle('epoch-manifest-shape')
    const workspace = base.manifest.members.find(member => member.objectId === 'workspace')!
    const duplicateMembers = [...base.manifest.members, workspace]
    await expect(validateSourceBundle({
      ...base,
      manifest: {
        ...base.manifest,
        members: duplicateMembers,
        sourceManifestHash: digest(canonical(duplicateMembers)),
      },
    }, 'graph-a')).rejects.toThrow('duplicate manifest member workspace')

    const unboundMembers = [...base.manifest.members, {
      sourceKind: 'derived' as const,
      objectId: 'unknown-future-face',
      objectIncarnation: null,
      sourceVersion: digest(''),
      localDigest: digest(''),
      durable: true,
    }]
    await expect(validateSourceBundle({
      ...base,
      manifest: {
        ...base.manifest,
        members: unboundMembers,
        sourceManifestHash: digest(canonical(unboundMembers)),
      },
    }, 'graph-a')).rejects.toThrow('manifest names unbound member unknown-future-face')

    const wrongKindMembers = base.manifest.members.map(member =>
      member.objectId === 'workspace'
        ? { ...member, sourceKind: 'derived' as const }
        : member)
    await expect(validateSourceBundle({
      ...base,
      manifest: {
        ...base.manifest,
        members: wrongKindMembers,
        sourceManifestHash: digest(canonical(wrongKindMembers)),
      },
    }, 'graph-a')).rejects.toThrow('member workspace has the wrong source kind')
  })

  it('rejects duplicate or structurally invalid authority receipts', async () => {
    const base = bundle('epoch-receipts')
    const receipt = {
      operationId: 'operation-a',
      digest: 'a'.repeat(64),
      acceptedRevision: 1,
      status: 'applied' as const,
      duplicate: false,
      outcome: { outcome: 'applied' },
    }
    await expect(validateSourceBundle({
      ...base,
      receipts: [receipt, receipt],
    }, 'graph-a')).rejects.toThrow('duplicate receipt operation-a')
    await expect(validateSourceBundle({
      ...base,
      receipts: [{ ...receipt, digest: 'not-a-digest' }],
    }, 'graph-a')).rejects.toThrow('invalid operation digest')
  })

  it('covers original-file resources with the complete manifest digest', async () => {
    const base = bundle('epoch-resource')
    const bytes = Buffer.from('byte authority')
    const resource = {
      resourceId: 'original:documents/doc-a/original',
      kind: 'original',
      path: 'documents/doc-a/original',
      filename: 'source.bin',
      mediaType: 'application/octet-stream',
      sizeBytes: bytes.length,
      digest: digest(bytes),
      createdAt: '1',
      updatedAt: '1',
      dataBase64: bytes.toString('base64'),
    }
    const members = [
      ...base.manifest.members,
      {
        sourceKind: 'current-state' as const,
        objectId: `resource:${resource.resourceId}`,
        objectIncarnation: null,
        sourceVersion: digest(bytes),
        localDigest: digest(bytes),
        durable: true,
      },
    ].sort((left, right) => left.objectId.localeCompare(right.objectId))
    const complete: SourceBundle = {
      ...base,
      resources: [resource],
      manifest: {
        ...base.manifest,
        members,
        sourceManifestHash: digest(canonical(members)),
      },
    }
    await expect(validateSourceBundle(complete, 'graph-a')).resolves.toBeUndefined()
    await expect(validateSourceBundle({
      ...complete,
      resources: [{ ...resource, dataBase64: Buffer.from('tampered').toString('base64') }],
    }, 'graph-a')).rejects.toThrow(/resource .* size|digest mismatch/)
  })

  it('never advances the epoch when an atomic quota commit fails', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const mirror = manager(storage, transport)
    await mirror.open()
    await mirror.pull()

    transport.nextBundle = bundle('epoch-2')
    storage.failNextMirrorCommit = new Error('QuotaExceededError')
    await expect(mirror.pull()).rejects.toThrow('QuotaExceededError')
    expect(storage.mirrors.values().next().value?.epoch).toBe('epoch-1')
    expect(mirror.get()).toMatchObject({ complete: true, epoch: 'epoch-1', phase: 'error' })
  })

  it('rejects revision rollback and epoch equivocation without replacing local truth', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const mirror = manager(storage, transport)
    await mirror.open()
    await mirror.pull()

    const rollbackBase = bundle('epoch-rollback')
    transport.nextBundle = {
      ...rollbackBase,
      revision: 0,
      projectionSnapshot: {
        ...rollbackBase.projectionSnapshot,
        sourceRevision: 0,
      },
    }
    await expect(mirror.pull()).rejects.toThrow('authority revision rolled back')
    expect(storage.mirrors.values().next().value?.epoch).toBe('epoch-1')

    transport.nextBundle = bundle(
      'epoch-1',
      'incarnation-a',
      '<urn:s> <urn:p> "equivocated" <urn:g> .\n',
    )
    await expect(mirror.pull()).rejects.toThrow('reused epoch epoch-1')
    expect(storage.mirrors.values().next().value?.bundle.projectionSnapshot.data)
      .toContain('"v"')
  })

  it('durably queues stable intents and a lost acknowledgement retries one identity', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const first = manager(storage, transport)
    await first.open()
    await first.pull()
    const operation = {
      kind: 'graphMetadata',
      operationId: 'client-a:valuation:1',
      title: 'Durable title',
    }
    await first.enqueue(operation)

    const cold = manager(storage, transport)
    await cold.open()
    expect(cold.get().pending).toBe(1)
    await cold.flush()
    expect(transport.pushes).toEqual([[operation]])
    expect(cold.outboxRecords()[0]).toMatchObject({ status: 'applied', attempts: 1 })

    // Reopening after the durable receipt does not resend.
    const again = manager(storage, transport)
    await again.open()
    await expect(again.flush()).resolves.toEqual([])
    expect(transport.pushes).toHaveLength(1)
  })

  it('requires a complete, graph-bound, content-bound receipt set', async () => {
    const operation: SourceOperation = {
      kind: 'graphMetadata',
      operationId: 'client-a:receipt:1',
      title: 'Content-bound',
    }

    for (const [label, transform, expected] of [
      [
        'wrong digest',
        (result: SourcePushResult): SourcePushResult => ({
          ...result,
          receipts: result.receipts.map(receipt => ({
            ...receipt,
            digest: '0'.repeat(64),
          })),
        }),
        'does not match the durable operation',
      ],
      [
        'missing receipt',
        (result: SourcePushResult): SourcePushResult => ({ ...result, receipts: [] }),
        'one receipt per operation',
      ],
      [
        'foreign graph',
        (result: SourcePushResult): SourcePushResult => ({ ...result, graphId: 'graph-b' }),
        'different graph',
      ],
    ] as const) {
      const storage = new MemorySourceMirrorStorage()
      const transport = new Transport()
      const mirror = manager(storage, transport)
      await mirror.open()
      await mirror.pull()
      await mirror.enqueue(operation)
      transport.pushTransform = transform
      await expect(mirror.flush(), label).rejects.toThrow(expected)
      expect(mirror.outboxRecords()[0]).toMatchObject({
        status: 'pending',
        attempts: 1,
      })
    }
  })

  it('keeps an accepted effect failure pending until authority repair applies it', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const mirror = manager(storage, transport)
    await mirror.open()
    await mirror.pull()
    await mirror.enqueue({
      kind: 'graphMetadata',
      operationId: 'client-a:effect-repair:1',
      title: 'Repair me',
    })
    transport.pushTransform = result => ({
      ...result,
      ok: false,
      receipts: result.receipts.map(receipt => ({
        ...receipt,
        status: 'accepted',
        effectError: 'temporary projection failure',
        outcome: { outcome: 'accepted' },
      })),
    })

    await mirror.flush()
    expect(mirror.get()).toMatchObject({ pending: 1, contestedObjects: 0 })
    expect(mirror.outboxRecords()[0]).toMatchObject({
      status: 'accepted',
      error: 'temporary projection failure',
    })

    transport.pushTransform = null
    await mirror.flush()
    expect(mirror.get()).toMatchObject({ pending: 0, contestedObjects: 0 })
    expect(mirror.outboxRecords()[0]).toMatchObject({ status: 'applied' })
  })

  // ── master §3 Slice 3: the merged SourceMirrorState + the coded fault
  // ── ladder's client half (§2.1, §2.2, §2.3, §2.4, §2.13, §2.17) ──────────

  it('R1 — a Law IV outbox contest never bumps the authority-derived contestedObjects, or either Law VI parked counter', async () => {
    // The version this replaces conflated Law IV (this outbox row's own
    // push-time contest) and Law VI (a lifetime fence) into one integer,
    // `SourceMirrorState.conflicts`. This is the split, proven directly: the
    // receipt outcome literally says 'conflict', the row's own status
    // becomes 'conflict' — and NONE of `contestedObjects` (authority-ledger-
    // derived, not outbox-derived), `parked`, or `nonDocumentParked` move.
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const mirror = manager(storage, transport)
    await mirror.open()
    await mirror.pull()
    await mirror.enqueue({
      kind: 'graphMetadata',
      operationId: 'client-a:bookmark:1',
      title: 'Conflict title',
    })
    transport.receiptOutcome = { outcome: 'conflict', conflictId: 'conflict-1' }
    await mirror.flush()
    expect(mirror.get()).toMatchObject({
      phase: 'conflict',
      contestedObjects: 0,
      parked: 0,
      nonDocumentParked: 0,
    })
    expect(mirror.outboxRecords()[0]).toMatchObject({ status: 'conflict' })
  })

  it('R2/C-D18 — a stale graph incarnation fence parks the whole batch, and the fence + its testimony survive a cold restart', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const mirror = manager(storage, transport)
    await mirror.open()
    await mirror.pull()
    await mirror.enqueue({
      kind: 'workspaceUpdate',
      operationId: 'client-a:workspace:2',
      updateBase64: 'AA==',
    })
    transport.pushError = new Error('stale graph incarnation')
    await expect(mirror.flush()).rejects.toThrow('stale graph incarnation')
    expect(mirror.outboxRecords()[0]).toMatchObject({
      status: 'rejected-stale',
      errorCode: 'stale_graph_incarnation',
    })
    // workspaceUpdate is graph-scoped, not document-bearing (master §2.1) —
    // it counts against nonDocumentParked, never parked.
    expect(mirror.get()).toMatchObject({
      phase: 'conflict',
      parked: 0,
      nonDocumentParked: 1,
      fenced: true,
      errorCode: 'stale_graph_incarnation',
    })
    expect(mirror.get().fenceTestimony).toContain('stale graph incarnation')

    // Cold restart against the SAME durable storage, no new error on this
    // call at all — `fenced`/`fenceTestimony` are re-derived purely from the
    // durable outbox rows, with no new store and no schema bump.
    const cold = manager(storage, transport)
    await cold.open()
    expect(cold.get()).toMatchObject({ fenced: true, nonDocumentParked: 1 })
    expect(cold.get().fenceTestimony).toContain('stale graph incarnation')
  })

  it('S7 — adoptNewLife() marks every parked row rejected-stale WITH the fence testimony before releasing the record, and a successful adoption clears the fence', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const mirror = manager(storage, transport)
    await mirror.open()
    await mirror.pull()
    await mirror.enqueue({
      kind: 'workspaceUpdate',
      operationId: 'client-a:workspace:2',
      updateBase64: 'AA==',
    })
    transport.pushError = new Error('stale graph incarnation')
    await expect(mirror.flush()).rejects.toThrow('stale graph incarnation')
    expect(mirror.get()).toMatchObject({ fenced: true, nonDocumentParked: 1 })

    // Enqueued AFTER the fence was already detected, BEFORE any further
    // flush() attempt — this is exactly the row `flush()`'s own incarnation
    // filter would otherwise leave `pending` forever (C3): it still carries
    // the SAME (still-held, still-fenced) incarnation, so it is invisible to
    // `flush()`'s own C3 guard and only `adoptNewLife()` catches it.
    await mirror.enqueue({
      kind: 'graphMetadata',
      operationId: 'client-a:never-flushed:1',
      title: 'Never got a chance to flush',
    })
    expect(mirror.get().pending).toBe(1)

    transport.pushError = null
    transport.nextBundle = bundle('epoch-2', 'incarnation-b')
    const adopted = await mirror.adoptNewLife()
    expect(adopted.graphIncarnation).toBe('incarnation-b')

    const staleRows = mirror.outboxRecords().filter(row => row.graphIncarnation === 'incarnation-a')
    expect(staleRows).toHaveLength(2)
    for (const row of staleRows) {
      expect(row.status).toBe('rejected-stale')
      expect(row.errorCode).toBe('stale_graph_incarnation')
      expect(row.error).toContain('stale graph incarnation')
    }
    expect(mirror.get()).toMatchObject({
      fenced: false,
      graphIncarnation: 'incarnation-b',
      pending: 0,
      // Both rows are graph-scoped (workspaceUpdate, graphMetadata), never
      // document-bearing — both count against nonDocumentParked (C-D19).
      nonDocumentParked: 2,
      parked: 0,
    })
  })

  it('S7 — adoptNewLife() is idempotent across a failed pull, and a FAILED adoption re-raises the fence on the next open() — no separate flag to forget to clear', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const mirror = manager(storage, transport)
    await mirror.open()
    await mirror.pull()
    await mirror.enqueue({
      kind: 'workspaceUpdate',
      operationId: 'client-a:workspace:2',
      updateBase64: 'AA==',
    })
    transport.pushError = new Error('stale graph incarnation')
    await expect(mirror.flush()).rejects.toThrow('stale graph incarnation')
    expect(mirror.get().fenced).toBe(true)

    // The authority is unreachable for the adoption's own pull too.
    transport.pushError = null
    transport.nextBundle = { ...transport.nextBundle, graphId: 'a-different-graph' }
    await expect(mirror.adoptNewLife()).rejects.toThrow('does not match')
    // The row is ALREADY rejected-stale on disk even though the pull failed —
    // local durability is never traded for liveness.
    expect(mirror.outboxRecords()[0]).toMatchObject({
      status: 'rejected-stale',
      errorCode: 'stale_graph_incarnation',
    })

    // Re-invoking after the failure is idempotent over the outbox — nothing
    // left in pending/accepted to mark — and only the pull is retried.
    await expect(mirror.adoptNewLife()).rejects.toThrow('does not match')
    expect(mirror.outboxRecords()).toHaveLength(1)

    // Cold restart against the SAME storage: adoptNewLife() never called
    // commitMirror, so the OLD committed mirror resurrects, and the durable
    // fence re-derives purely from the rejected-stale row under that SAME
    // old incarnation — no separate flag exists to have forgotten to clear.
    const cold = manager(storage, transport)
    await cold.open()
    expect(cold.get()).toMatchObject({ fenced: true, graphIncarnation: 'incarnation-a' })
    expect(cold.get().fenceTestimony).toContain('stale graph incarnation')
  })

  it('R19 (fix/slice-8) — an ordinary Law IV receipt contest beside a historical parked row does not raise a lifetime banner', async () => {
    // `lifetimeBannerStateFor()` (apps/organism/src/main.ts:7196-7210) reads
    // `state.fenced` as the ONE source of fence truth (master §2.1/C-D18) —
    // it never keys off `parked`/`nonDocumentParked`/`contestedObjects`. This
    // proves the INPUT to that composition stays honest in the one scenario
    // that could plausibly confuse the two: a graph that has ALREADY lived
    // through a fence (so it carries durable, historical `rejected-stale`
    // rows from its previous incarnation — exactly the C3/S7 scenario above)
    // and, in its CURRENT unfenced life, takes an ordinary Law IV current-
    // state contest on a fresh write. Neither the leftover history nor the
    // live contest may flip `fenced` back to true.
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const mirror = manager(storage, transport)
    await mirror.open()
    await mirror.pull()

    // Live through a real fence + adoption first, so a HISTORICAL parked row
    // is durably on disk under the superseded incarnation (same shape as the
    // S7 test above).
    await mirror.enqueue({
      kind: 'workspaceUpdate',
      operationId: 'client-a:workspace:2',
      updateBase64: 'AA==',
    })
    transport.pushError = new Error('stale graph incarnation')
    await expect(mirror.flush()).rejects.toThrow('stale graph incarnation')
    expect(mirror.get().fenced).toBe(true)

    transport.pushError = null
    transport.nextBundle = bundle('epoch-2', 'incarnation-b')
    await mirror.adoptNewLife()
    expect(mirror.get()).toMatchObject({ fenced: false, graphIncarnation: 'incarnation-b' })
    const historicalRow = mirror
      .outboxRecords()
      .find(row => row.graphIncarnation === 'incarnation-a')
    expect(historicalRow).toMatchObject({ status: 'rejected-stale', errorCode: 'stale_graph_incarnation' })

    // Now, in the CURRENT (unfenced) life, an ordinary Law IV current-state
    // contest — nothing to do with lifecycle at all.
    await mirror.enqueue({
      kind: 'graphMetadata',
      operationId: 'client-a:bookmark:2',
      title: 'Conflict title',
    })
    transport.receiptOutcome = { outcome: 'conflict', conflictId: 'conflict-2' }
    await mirror.flush()
    expect(
      mirror.outboxRecords().find(row => row.operation.operationId === 'client-a:bookmark:2'),
    ).toMatchObject({ status: 'conflict' })

    // The historical row is STILL there (parked work is not silently
    // dropped), the live contest registers, and — the point of this test —
    // `fenced` stays false throughout, so `lifetimeBannerStateFor()` would
    // return null: no lifetime banner for an ordinary object contest sitting
    // beside a previous life's parked history.
    expect(mirror.get()).toMatchObject({
      fenced: false,
      graphIncarnation: 'incarnation-b',
      phase: 'conflict',
    })
    expect(mirror.outboxRecords().find(row => row.graphIncarnation === 'incarnation-a')).toMatchObject({
      status: 'rejected-stale',
    })

    // Cold restart re-derives purely from durable rows too — the historical
    // parked row alone (no live fence) must not resurrect `fenced: true`.
    const cold = manager(storage, transport)
    await cold.open()
    expect(cold.get()).toMatchObject({ fenced: false, graphIncarnation: 'incarnation-b' })
  })

  it('D14 — a document-lifetime fence code parks a document-bearing row as `parked`, not `nonDocumentParked`', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const mirror = manager(storage, transport)
    await mirror.open()
    await mirror.pull()
    await mirror.enqueue({
      kind: 'documentUpdate',
      operationId: 'client-a:doc:1',
      documentId: 'doc-a',
      documentIncarnation: 'doc-incarnation-a',
      updateBase64: 'AA==',
    })
    transport.pushError = new Error('stale document incarnation for doc-a')
    await expect(mirror.flush()).rejects.toThrow('stale document incarnation')
    expect(mirror.outboxRecords()[0]).toMatchObject({
      status: 'rejected-stale',
      errorCode: 'stale_document_incarnation',
    })
    expect(mirror.get()).toMatchObject({ parked: 1, nonDocumentParked: 0, fenced: true })
  })

  it('R23 — a `valuation` naming a real documentId is still a LOOSE operation: nonDocumentParked, never parked (kind allowlist, not a presence test)', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const mirror = manager(storage, transport)
    await mirror.open()
    await mirror.pull()
    await mirror.enqueue({
      kind: 'valuation',
      operationId: 'client-a:valuation:1',
      valuationEventId: 'event-1',
      documentId: 'doc-a',
      blockId: 'block-a',
      atMs: 1,
    })
    transport.pushError = new Error('stale graph incarnation')
    await expect(mirror.flush()).rejects.toThrow('stale graph incarnation')
    expect(mirror.get()).toMatchObject({ parked: 0, nonDocumentParked: 1 })
  })

  it('R5/D-W8 — a lost resolution race parks ONLY the named row; its innocent batch-mate stays pending, and the next flush delivers it', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const mirror = manager(storage, transport)
    await mirror.open()
    await mirror.pull()
    await mirror.enqueue({
      kind: 'resolveCurrent',
      operationId: 'client-a:resolve:1',
      objectKey: 'vocabClassobj-1',
      conflictId: 'conflict-9',
      chosenOperationId: 'op-x',
    })
    await mirror.enqueue({
      kind: 'graphMetadata',
      operationId: 'client-a:innocent:1',
      title: 'Innocent, unrelated',
    })
    transport.pushError = new Error("sync conflict 'conflict-9' is not current for object 'vocabClassobj-1'")
    await expect(mirror.flush()).rejects.toThrow('is not current')
    const resolveRow = mirror.outboxRecords().find(r => r.operation.operationId === 'client-a:resolve:1')
    const innocentRow = mirror.outboxRecords().find(r => r.operation.operationId === 'client-a:innocent:1')
    expect(resolveRow).toMatchObject({ status: 'rejected-permanent', errorCode: 'stale_sync_conflict' })
    expect(innocentRow).toMatchObject({ status: 'pending' })
    expect(mirror.get()).toMatchObject({
      rejectedPermanent: 1,
      supersededResolutions: 1,
      pending: 1, // the innocent row, still deliverable
    })

    // The very next flush delivers the innocent sibling — no livelock.
    transport.pushError = null
    await mirror.flush()
    expect(mirror.outboxRecords().find(r => r.operation.operationId === 'client-a:innocent:1'))
      .toMatchObject({ status: 'applied' })
    expect(transport.pushes.at(-1)).toEqual([{
      kind: 'graphMetadata',
      operationId: 'client-a:innocent:1',
      title: 'Innocent, unrelated',
    }])
  })

  it('D15 — an untargeted permanent fault reaches a terminal status and a second flush does not resubmit it', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const mirror = manager(storage, transport)
    await mirror.open()
    await mirror.pull()
    await mirror.enqueue({
      kind: 'documentLifecycle',
      operationId: 'client-a:create-doc:1',
      action: 'create',
      documentId: 'doc-already-there',
    })
    transport.pushError = new Error('document doc-already-there already exists')
    await expect(mirror.flush()).rejects.toThrow('already exists')
    expect(mirror.outboxRecords()[0]).toMatchObject({
      status: 'rejected-permanent',
      errorCode: 'document_exists',
    })
    expect(mirror.get()).toMatchObject({ rejectedPermanent: 1, pending: 0, parked: 0 })

    transport.pushError = null
    await mirror.flush()
    // The fake transport's `push()` throws BEFORE recording, so the first
    // (failing) attempt never appears in `pushes` either — `pushes` staying
    // EMPTY across both flushes is the proof: the second flush's `pending`
    // selection excludes `rejected-permanent` rows, so it never calls
    // `transport.push` at all (the early "nothing to push" return).
    expect(transport.pushes).toHaveLength(0)
    expect(mirror.outboxRecords()[0]).toMatchObject({ status: 'rejected-permanent' })
  })

  it('R4 — a successful resolution receipt is NEVER classified as a contest (§2.4 conflictReceipt fix); resolving/awaitingEpoch derive from it', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const mirror = manager(storage, transport)
    await mirror.open()
    await mirror.pull()
    await mirror.enqueue({
      kind: 'resolveCurrent',
      operationId: 'client-a:resolve:2',
      objectKey: 'vocabClassobj-2',
      conflictId: 'conflict-1',
      chosenOperationId: 'op-y',
    })
    // Still pending (no receipt yet): resolving names its conflictId.
    expect(mirror.get().resolving).toEqual(['conflict-1'])

    // Garden's OWN successful-resolution receipt shape — carries a
    // `conflictId` string, which the retired classifier misfiled as a
    // contest (the exact footgun §2.4 fixes).
    transport.receiptOutcome = {
      outcome: 'resolved',
      conflictId: 'conflict-1',
      remainingConflictId: 'conflict-2',
    }
    await mirror.flush()
    expect(mirror.outboxRecords()[0]).toMatchObject({
      status: 'applied', // NOT 'conflict' — the direct regression guard
      resolvedConflictId: 'conflict-1',
    })
    expect(mirror.get().resolving).toEqual([])

    // The next epoch still lists conflict-1 as open (the non-optimistic
    // window: the cell accepted the choice, the next pull hasn't confirmed
    // it cleared yet) — a SEPARATE pull, since flush() alone never learns it.
    transport.nextBundle = {
      ...transport.nextBundle,
      conflicts: [{
        conflictId: 'conflict-1',
        objectKey: 'vocab\u001fClass\u001fobj-2',
        baseVersion: 'root',
        reconciliationStrategy: 'contested',
        reason: 'concurrent current-state writes',
        projectedOperationId: 'op-y',
        candidates: [{
          operationId: 'op-y',
          sourceVersion: 'sv-op-y',
          baseVersion: 'root',
          record: {},
        }],
      }],
    }
    await mirror.pull()
    expect(mirror.get().awaitingEpoch).toEqual([
      { conflictId: 'conflict-1', remainingConflictId: 'conflict-2' },
    ])
  })

  describe('classifySourceFault / isFenceFault / retryable (master §2.2)', () => {
    it('rung 1 — reads a JSON-RPC tool error .data.code (McpError/GatewayMcpError shape)', () => {
      const error = Object.assign(new Error('MCP error for source_push: whatever'), {
        data: { code: 'stale_graph_incarnation' },
      })
      expect(classifySourceFault(error)).toMatchObject({
        code: 'stale_graph_incarnation',
        origin: 'code',
      })
    })

    it('rung 2a — reads an HTTP error body `.responseBody` JSON `{code}` (GatewayHttpError shape)', () => {
      const error = Object.assign(new Error('Gateway DELETE /g/x failed with HTTP 409: …'), {
        responseBody: JSON.stringify({ error: 'stale graph incarnation', code: 'stale_graph_incarnation' }),
      })
      expect(classifySourceFault(error)).toMatchObject({
        code: 'stale_graph_incarnation',
        origin: 'code',
      })
    })

    it('rung 2b — reads a loopback-shaped error object\'s own top-level string `.code`', () => {
      const error = { ok: false, error: 'quota exceeded', code: 'quota_exceeded' }
      expect(classifySourceFault(error)).toMatchObject({ code: 'quota_exceeded', origin: 'code' })
    })

    it('a numeric JSON-RPC `.code` never collides with rung 2b — rung 1\'s `.data.code` still wins', () => {
      const error = Object.assign(new Error('MCP error for source_push: x'), {
        code: -32000, // McpError's own numeric JSON-RPC code
        data: { code: 'stale_graph_incarnation' },
      })
      expect(classifySourceFault(error)).toMatchObject({ code: 'stale_graph_incarnation', origin: 'code' })
    })

    it('rung 3 — legacy message regex fallback, origin "regex"', () => {
      expect(classifySourceFault(new Error('different lifecycle identity for graph g'))).toMatchObject({
        code: 'graph_lifecycle_identity_mismatch',
        origin: 'regex',
      })
    })

    it('D16/rung 4 — an unqualified 409, a bare "conflict", and a wholly unmatched message all classify as {code:null, origin:"none"} (C-D3)', () => {
      for (const message of ['HTTP 409', '409', 'conflict', 'connection reset']) {
        expect(classifySourceFault(new Error(message))).toEqual({ code: null, origin: 'none', message })
      }
    })

    it('retryable() partitions the taxonomy without overlap, and retryable(null) is true', () => {
      for (const code of SOURCE_FAULT_CODES) {
        const inFence = FENCE_CODES.includes(code)
        const inPermanent = PERMANENT_CODES.includes(code)
        expect(inFence && inPermanent).toBe(false)
        expect(retryable(code)).toBe(!inFence && !inPermanent)
      }
      expect(retryable(null)).toBe(true)
    })

    it('isFenceFault is true for a regex-origin fence too, and false at rung 4', () => {
      const regexFault = classifySourceFault(new Error('stale graph incarnation for g'))
      expect(regexFault.origin).toBe('regex')
      expect(isFenceFault(regexFault)).toBe(true)
      expect(isFenceFault(classifySourceFault(new Error('connection reset')))).toBe(false)
    })

    it('sourceErrorTestimony is the authority\'s own words, verbatim on this (non-MCP-prefixed) path', () => {
      const error = new Error('stale graph incarnation for graph g')
      expect(sourceErrorTestimony(error)).toBe(error.message)
    })
  })

  describe('documentIdOf / isDocumentBearingOperation (master §2.1, §2.17)', () => {
    it('documentUpdate / documentLifecycle / crdtCommand-with-documentId are document-bearing', () => {
      expect(documentIdOf({ kind: 'documentUpdate', operationId: 'o1', documentId: 'd1' })).toBe('d1')
      expect(documentIdOf({ kind: 'documentLifecycle', operationId: 'o2', documentId: 'd2' })).toBe('d2')
      expect(documentIdOf({ kind: 'crdtCommand', operationId: 'o3', documentId: 'd3' })).toBe('d3')
      expect(isDocumentBearingOperation({ kind: 'documentUpdate', operationId: 'o1', documentId: 'd1' })).toBe(true)
    })

    it('a crdtCommand with no documentId, and every graph-scoped kind (incl. a documentId-bearing valuation), are NOT document-bearing', () => {
      expect(documentIdOf({ kind: 'crdtCommand', operationId: 'o4' })).toBeNull()
      expect(documentIdOf({ kind: 'valuation', operationId: 'o5', documentId: 'd5' })).toBeNull()
      expect(documentIdOf({ kind: 'workspaceUpdate', operationId: 'o6' })).toBeNull()
      expect(isDocumentBearingOperation({ kind: 'graphMetadata', operationId: 'o7' })).toBe(false)
    })
  })

  it('T-R4-adjacent: a `keep` operation built by `buildResolveCurrentOperation` round-trips through enqueue → flush without a digest mismatch', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const mirror = manager(storage, transport)
    await mirror.open()
    await mirror.pull()
    const operation = buildResolveCurrentOperation(
      { kind: 'keep', objectKey: 'vocabClassobj-2', conflictId: 'conflict-1', chosenOperationId: 'op-y' },
      'client-a:resolve:built',
      ['op-y', 'op-z'],
    )
    await mirror.enqueue(operation)
    const receipts = await mirror.flush()
    expect(receipts).toHaveLength(1)
    expect(mirror.outboxRecords()[0]?.status).toBe('applied')
  })

  it('a `compose` operation built by `buildResolveCurrentOperation` round-trips the same way, including a safe-integer field', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const mirror = manager(storage, transport)
    await mirror.open()
    await mirror.pull()
    const operation = buildResolveCurrentOperation(
      {
        kind: 'compose',
        objectKey: 'vocabClassobj-2',
        conflictId: 'conflict-1',
        record: { kind: 'Class', localId: 'obj-2', title: 'Merged', count: 42 },
      },
      'client-a:resolve:composed',
      ['op-y'],
    )
    await mirror.enqueue(operation)
    const receipts = await mirror.flush()
    expect(receipts).toHaveLength(1)
    expect(mirror.outboxRecords()[0]?.status).toBe('applied')
  })
})

describe('buildResolveCurrentOperation (master §3 Slice 6, WS2 §6.3)', () => {
  const KNOWN = ['op-a', 'op-b']

  it('builds a well-formed keep operation', () => {
    const operation = buildResolveCurrentOperation(
      { kind: 'keep', objectKey: 'vocabclassobj', conflictId: 'conflict-1', chosenOperationId: 'op-a' },
      'resolve-1',
      KNOWN,
    )
    expect(operation).toEqual({
      kind: 'resolveCurrent',
      operationId: 'resolve-1',
      objectKey: 'vocabclassobj',
      conflictId: 'conflict-1',
      chosenOperationId: 'op-a',
    })
  })

  it('builds a well-formed compose operation, carrying the record through verbatim', () => {
    const record = { kind: 'Bookmark', localId: 'obj', title: 'Merged Title' }
    const operation = buildResolveCurrentOperation(
      { kind: 'compose', objectKey: 'vocabBookmarkobj', conflictId: 'conflict-1', record },
      'resolve-2',
      KNOWN,
    )
    expect(operation).toEqual({
      kind: 'resolveCurrent',
      operationId: 'resolve-2',
      objectKey: 'vocabBookmarkobj',
      conflictId: 'conflict-1',
      record,
    })
  })

  it('R12/T-R3 — throws client-side, before any push, when chosenOperationId names no resident candidate', () => {
    expect(() => buildResolveCurrentOperation(
      { kind: 'keep', objectKey: 'vocabclassobj', conflictId: 'conflict-1', chosenOperationId: 'op-ghost' },
      'resolve-3',
      KNOWN,
    )).toThrow(/op-ghost is not a proposal on this object/)
  })

  it('rejects empty objectKey / conflictId / operationId', () => {
    expect(() => buildResolveCurrentOperation(
      { kind: 'keep', objectKey: '  ', conflictId: 'conflict-1', chosenOperationId: 'op-a' },
      'resolve-4',
      KNOWN,
    )).toThrow(/objectKey must not be empty/)
    expect(() => buildResolveCurrentOperation(
      { kind: 'keep', objectKey: 'vocabclassobj', conflictId: '', chosenOperationId: 'op-a' },
      'resolve-5',
      KNOWN,
    )).toThrow(/conflictId must not be empty/)
    expect(() => buildResolveCurrentOperation(
      { kind: 'keep', objectKey: 'vocabclassobj', conflictId: 'conflict-1', chosenOperationId: 'op-a' },
      '',
      KNOWN,
    )).toThrow(/operationId must not be empty/)
  })

  it('rejects a malformed operationId the same way `enqueue` always has', () => {
    expect(() => buildResolveCurrentOperation(
      { kind: 'keep', objectKey: 'vocabclassobj', conflictId: 'conflict-1', chosenOperationId: 'op-a' },
      'has a space',
      KNOWN,
    )).toThrow(/operationId must be <=160 characters/)
  })

  it('rejects a non-object composed record', () => {
    expect(() => buildResolveCurrentOperation(
      { kind: 'compose', objectKey: 'vocabclassobj', conflictId: 'conflict-1', record: [] as unknown as Record<string, unknown> },
      'resolve-6',
      KNOWN,
    )).toThrow(/composed record must be a JSON object/)
  })

  it("rejects a composed record whose kind/localId disagree with the object's own", () => {
    expect(() => buildResolveCurrentOperation(
      {
        kind: 'compose',
        objectKey: 'vocabRealClassreal-id',
        conflictId: 'conflict-1',
        record: { kind: 'WrongClass' },
      },
      'resolve-7',
      KNOWN,
    )).toThrow(/composed record\.kind 'WrongClass' does not match this object's class 'RealClass'/)
    expect(() => buildResolveCurrentOperation(
      {
        kind: 'compose',
        objectKey: 'vocabRealClassreal-id',
        conflictId: 'conflict-1',
        record: { localId: 'wrong-id' },
      },
      'resolve-8',
      KNOWN,
    )).toThrow(/composed record\.localId 'wrong-id' does not match this object's id 'real-id'/)
  })

  it('accepts a safe integer and a finite non-integer, rejects an unsafe integer leaf (JS double vs serde i64)', () => {
    const withSafeAndFloat = buildResolveCurrentOperation(
      {
        kind: 'compose',
        objectKey: 'vocabclassobj',
        conflictId: 'conflict-1',
        record: { count: Number.MAX_SAFE_INTEGER, ratio: 0.1 },
      },
      'resolve-9',
      KNOWN,
    )
    expect(withSafeAndFloat.record).toEqual({ count: Number.MAX_SAFE_INTEGER, ratio: 0.1 })

    expect(() => buildResolveCurrentOperation(
      {
        kind: 'compose',
        objectKey: 'vocabclassobj',
        conflictId: 'conflict-1',
        record: { count: Number.MAX_SAFE_INTEGER + 2 },
      },
      'resolve-10',
      KNOWN,
    )).toThrow(/record field count is a number this client cannot digest exactly/)
  })

  it('walks nested arrays/objects for the same unsafe-integer rule', () => {
    expect(() => buildResolveCurrentOperation(
      {
        kind: 'compose',
        objectKey: 'vocabclassobj',
        conflictId: 'conflict-1',
        record: { nested: { items: [1, Number.MAX_SAFE_INTEGER + 4] } },
      },
      'resolve-11',
      KNOWN,
    )).toThrow(/record field nested\.items\[1\] is a number this client cannot digest exactly/)
  })
})

/**
 * Ask A's client contract (build bundle review finding 6, 2026-07-31):
 * `SourceBundle.currentState`/`conflicts` are real types
 * (`SourceCurrentObject`/`SourceConflict`), not `Record<string, unknown>[]`,
 * and `conflictsDigest`/`sourceCapabilities` are declared AND validated —
 * `validateSourceConflictShape`/`validateSourceCandidateShape` run
 * unconditionally inside `validateSourceBundle`, and the digest binds
 * `conflicts` when the authority supplies one. Every case here was run
 * against the pre-fix `source-mirror.ts` first (`conflicts: readonly
 * Record<string, unknown>[]`, no shape check, no digest check) and
 * confirmed to fail there — see the build log for the transcript — before
 * the fix landed.
 */
describe('Ask A — SourceBundle client contract (build bundle review finding 6)', () => {
  const validConflict = {
    conflictId: 'conflict-shape-1',
    objectKey: 'vocabClassobj-1',
    baseVersion: 'root',
    reconciliationStrategy: 'contested' as const,
    reason: 'concurrent current-state writes',
    projectedOperationId: 'op-a',
    candidates: [{
      operationId: 'op-a',
      sourceVersion: 'sv-a',
      baseVersion: 'root',
      record: { title: 'A' },
      clientId: 'client-a',
      causalOrder: 100,
    }],
  }

  it('rejects a conflict missing required fields — the shape check runs unconditionally, even with no conflictsDigest', async () => {
    const base = bundle('epoch-ask-a-1')
    const malformed: SourceBundle = {
      ...base,
      conflicts: [{ conflictId: 'only-this' }] as unknown as SourceBundle['conflicts'],
    }
    await expect(validateSourceBundle(malformed, 'graph-a')).rejects.toThrow('has no objectKey')
  })

  it('rejects a conflict with an out-of-taxonomy reconciliationStrategy', async () => {
    const base = bundle('epoch-ask-a-2')
    const bad: SourceBundle = {
      ...base,
      conflicts: [{ ...validConflict, reconciliationStrategy: 'madeUpStrategy' }] as unknown as SourceBundle['conflicts'],
    }
    await expect(validateSourceBundle(bad, 'graph-a')).rejects.toThrow('unknown reconciliationStrategy')
  })

  it('rejects a projectedOperationId absent from its own candidates (D19 client-side recheck)', async () => {
    const base = bundle('epoch-ask-a-3')
    const dangling: SourceBundle = {
      ...base,
      conflicts: [{ ...validConflict, projectedOperationId: 'op-nowhere' }],
    }
    await expect(validateSourceBundle(dangling, 'graph-a')).rejects.toThrow(
      'projects an operation absent from its own candidates',
    )
  })

  it('rejects an unsafe causalOrder on a candidate (D17 client-side mirror)', async () => {
    const base = bundle('epoch-ask-a-4')
    const unsafe: SourceBundle = {
      ...base,
      conflicts: [{
        ...validConflict,
        candidates: [{ ...validConflict.candidates[0], causalOrder: Number.MAX_SAFE_INTEGER + 2 }],
      }],
    }
    await expect(validateSourceBundle(unsafe, 'graph-a')).rejects.toThrow('unsafe causalOrder')
  })

  it('rejects a non-finite evidenceWeight on a candidate', async () => {
    const base = bundle('epoch-ask-a-4b')
    const bad: SourceBundle = {
      ...base,
      conflicts: [{
        ...validConflict,
        candidates: [{ ...validConflict.candidates[0], evidenceWeight: Number.POSITIVE_INFINITY }],
      }],
    }
    await expect(validateSourceBundle(bad, 'graph-a')).rejects.toThrow('non-finite evidenceWeight')
  })

  it('accepts a well-formed conflicts array with no conflictsDigest (an older cell — shape alone is enough)', async () => {
    const base = bundle('epoch-ask-a-5')
    const withConflict: SourceBundle = { ...base, conflicts: [validConflict] }
    await expect(validateSourceBundle(withConflict, 'graph-a')).resolves.toBeUndefined()
  })

  it('rejects a conflictsDigest that does not match the real conflicts payload', async () => {
    const base = bundle('epoch-ask-a-6')
    const bad: SourceBundle = { ...base, conflicts: [validConflict], conflictsDigest: 'a'.repeat(64) }
    await expect(validateSourceBundle(bad, 'graph-a')).rejects.toThrow('contested-set digest mismatch')
  })

  it('accepts a conflictsDigest that DOES match — a real sha256 over JCS-canonical JSON, independently computed by this test', async () => {
    const base = bundle('epoch-ask-a-7')
    const conflictsDigest = digest(canonical([validConflict]))
    const good: SourceBundle = { ...base, conflicts: [validConflict], conflictsDigest }
    await expect(validateSourceBundle(good, 'graph-a')).resolves.toBeUndefined()
  })

  it('rejects a malformed conflictsDigest string (not 64 lowercase hex chars)', async () => {
    const base = bundle('epoch-ask-a-8')
    const bad: SourceBundle = { ...base, conflicts: [validConflict], conflictsDigest: 'not-a-digest' }
    await expect(validateSourceBundle(bad, 'graph-a')).rejects.toThrow('invalid contested-set digest')
  })

  it('sourceCapabilities is additive — a bundle declaring none still validates, and the field round-trips when present', async () => {
    const base = bundle('epoch-ask-a-9')
    expect(base.sourceCapabilities).toBeUndefined()
    await expect(validateSourceBundle(base, 'graph-a')).resolves.toBeUndefined()

    const withCapabilities: SourceBundle = {
      ...base,
      sourceCapabilities: { typedErrorCodes: 1, candidateAttribution: 1, conflictsDigest: 1 },
    }
    expect(withCapabilities.sourceCapabilities?.candidateAttribution).toBe(1)
    await expect(validateSourceBundle(withCapabilities, 'graph-a')).resolves.toBeUndefined()
  })

  it('rejects every malformed currentState identity and optional attribution field at the bundle boundary', async () => {
    const validCurrent = {
      objectKey: 'vocab\u001fClass\u001fobject-1',
      vocab: 'vocab',
      class: 'Class',
      objectId: 'object-1',
      sourceVersion: 'version-1',
      record: { title: 'Current' },
      reconciliationStrategy: 'producerDirected',
      operationId: 'operation-1',
      clientId: 'client-1',
    }
    const malformed: readonly [string, unknown, string][] = [
      ['vocab', '', 'has no vocab'],
      ['class', '', 'has no class'],
      ['objectId', '', 'has no objectId'],
      ['sourceVersion', '', 'has no sourceVersion'],
      ['record', [], 'has a non-object record'],
      ['reconciliationStrategy', 'unknown', 'unknown reconciliationStrategy'],
      ['operationId', 7, 'invalid operationId'],
      ['clientId', 7, 'invalid clientId'],
    ]
    for (const [field, value, expected] of malformed) {
      const current = { ...validCurrent, [field]: value }
      const base = bundle(`epoch-ask-a-current-${field}`)
      const recordDigest = digest(canonical(current.record))
      const members = [...base.manifest.members, {
        sourceKind: 'current-state' as const,
        objectId: current.objectKey,
        objectIncarnation: null,
        sourceVersion: recordDigest,
        localDigest: recordDigest,
        durable: true,
      }]
      const bad: SourceBundle = {
        ...base,
        currentState: [current] as unknown as SourceBundle['currentState'],
        manifest: { ...base.manifest, members, sourceManifestHash: digest(canonical(members)) },
      }
      await expect(validateSourceBundle(bad, 'graph-a')).rejects.toThrow(expected)
    }
  })

  it('rejects non-numeric, fractional, and negative source capability versions', async () => {
    for (const version of ['1', 1.5, -1]) {
      const bad: SourceBundle = {
        ...bundle(`epoch-ask-a-capability-${String(version)}`),
        sourceCapabilities: { typedErrorCodes: version } as unknown as SourceBundle['sourceCapabilities'],
      }
      await expect(validateSourceBundle(bad, 'graph-a')).rejects.toThrow('source capability typedErrorCodes has an invalid version')
    }
  })

  it('currentState/conflicts are real types, not index-signature bags — a full round trip through pull()', async () => {
    const storage = new MemorySourceMirrorStorage()
    const transport = new Transport()
    const record = { title: 'typed current state' }
    const recordDigest = digest(canonical(record))
    const extraMember = {
      sourceKind: 'current-state' as const,
      objectId: 'vocabClassobj-typed',
      objectIncarnation: null,
      sourceVersion: recordDigest,
      localDigest: recordDigest,
      durable: true,
    }
    const members = [...transport.nextBundle.manifest.members, extraMember]
    transport.nextBundle = {
      ...transport.nextBundle,
      currentState: [{
        objectKey: 'vocabClassobj-typed',
        vocab: 'vocab',
        class: 'Class',
        objectId: 'obj-typed',
        sourceVersion: 'sv-1',
        record,
        reconciliationStrategy: 'producerDirected',
        operationId: 'op-typed',
        clientId: 'client-typed',
      }],
      manifest: {
        sourceManifestHash: digest(canonical(members)),
        members,
        complete: true,
      },
    }
    const mirror = manager(storage, transport)
    await mirror.open()
    await mirror.pull()
    const resident = mirror.bundle()
    // Real field access against the REAL exported types — this is what
    // proves `currentState` is no longer `Record<string, unknown>[]`: every
    // field below is declared on `SourceCurrentObject`, read with no cast.
    const face = resident?.currentState.find(candidate => candidate.objectKey === 'vocabClassobj-typed')
    expect(face?.vocab).toBe('vocab')
    expect(face?.class).toBe('Class')
    expect(face?.objectId).toBe('obj-typed')
    expect(face?.clientId).toBe('client-typed')
    expect(face?.reconciliationStrategy).toBe('producerDirected')
  })
})
