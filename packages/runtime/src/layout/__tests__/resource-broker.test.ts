/**
 * resource-broker.test.ts — durable ref-count/share/last-release-disposes
 * (design §4.1, LAY-009), plus the `derived` shape's presence in the type
 * surface, its default unshared behavior, and its opt-in retained-store
 * behavior.
 */
import { describe, expect, it } from 'vitest'
import {
  DuplicateResourceAdapterError,
  LayoutResourceBroker,
  ResourceAdapterLocatorMismatchError,
  UnknownResourceAdapterError,
} from '../resource-broker.js'
import type { DerivedResourceAdapter, DurableResourceAdapter } from '../types.js'
import { buildTestBroker, createDocumentAdapter, createQueryRollupAdapter } from './fixtures.js'

const DOC_A = { kind: 'document', graphId: 'g1', documentId: 'doc-a' } as const
const DOC_B = { kind: 'document', graphId: 'g1', documentId: 'doc-b' } as const
const BLOB_A = { kind: 'iri', iri: 'urn:test:blob-a' } as const
const DOC_ADAPTER_ID = 'test.document-store'
const BLOB_ADAPTER_ID = 'test.blob-store'
const ROLLUP_ADAPTER_ID = 'test.query-rollup'

/** A real, working durable adapter whose `dispose` throws — either
 * synchronously (a plain `throw`) or by returning a rejected promise —
 * depending on `mode`. Used to prove `release()` itself never throws and
 * that a failing disposal never blocks any OTHER lease's teardown. Deliberately
 * claims `kind: 'chat'` locators (a kind no other fixture in this file
 * registers) so it can compose on the SAME broker as `createDocumentAdapter`/
 * `createBlobAdapter` — this suite is about disposal-failure isolation, not
 * adapter selection (that gets its own describe block below). */
function createThrowingDisposeAdapter(mode: 'sync' | 'async'): {
  readonly adapter: DurableResourceAdapter<{ readonly id: string }>
  readonly adapterId: string
  readonly loadCalls: number
} {
  let loadCalls = 0
  const adapterId = `test.throwing-dispose-${mode}`
  const adapter: DurableResourceAdapter<{ readonly id: string }> = {
    adapterId,
    shape: 'durable',
    accepts: (locator) => locator.kind === 'chat',
    resourceKey: (locator) => {
      if (locator.kind !== 'chat') throw new Error('not a chat locator')
      return `throwing:${locator.sessionId}`
    },
    load: async (locator) => {
      loadCalls += 1
      return { id: locator.kind === 'chat' ? locator.sessionId : '?' }
    },
    dispose: (value) => {
      if (mode === 'sync') throw new Error(`sync dispose failure for ${value.id}`)
      return Promise.reject(new Error(`async dispose failure for ${value.id}`))
    },
  }
  return { adapter, adapterId, get loadCalls() { return loadCalls } }
}

describe('LayoutResourceBroker — durable: load-once, shared value, ref-counted', () => {
  it('acquire() loads once and returns the durable value', async () => {
    const { broker, documentAdapter } = buildTestBroker()
    const lease = await broker.acquire(DOC_A, DOC_ADAPTER_ID)
    expect(lease.shape).toBe('durable')
    expect(lease.released).toBe(false)
    expect(documentAdapter.loadCalls).toHaveLength(1)
    expect((lease.value as { text: string }).text).toContain('doc-a')
  })

  it('two acquires of the SAME key share the exact same value reference, and load runs exactly once', async () => {
    const { broker, documentAdapter } = buildTestBroker()
    const leaseOne = await broker.acquire(DOC_A, DOC_ADAPTER_ID)
    const leaseTwo = await broker.acquire(DOC_A, DOC_ADAPTER_ID)
    expect(leaseOne.value).toBe(leaseTwo.value) // same object reference — the "two leaves share one provider" property
    expect(documentAdapter.loadCalls).toHaveLength(1)
    expect(broker.diagnostics().durableRefCounts[leaseOne.key]).toBe(2)
  })

  it('concurrent first-acquires of a brand-new key dedupe to exactly one load call', async () => {
    const { broker, documentAdapter } = buildTestBroker()
    const [leaseOne, leaseTwo, leaseThree] = await Promise.all([
      broker.acquire(DOC_A, DOC_ADAPTER_ID),
      broker.acquire(DOC_A, DOC_ADAPTER_ID),
      broker.acquire(DOC_A, DOC_ADAPTER_ID),
    ])
    expect(documentAdapter.loadCalls).toHaveLength(1)
    expect(leaseOne.value).toBe(leaseTwo.value)
    expect(leaseTwo.value).toBe(leaseThree.value)
    expect(broker.diagnostics().durableRefCounts[leaseOne.key]).toBe(3)
  })

  it('releasing one of several leases decrements the ref count WITHOUT disposing', async () => {
    const { broker, documentAdapter } = buildTestBroker()
    const leaseOne = await broker.acquire(DOC_A, DOC_ADAPTER_ID)
    const leaseTwo = await broker.acquire(DOC_A, DOC_ADAPTER_ID)
    leaseOne.release()
    expect(leaseOne.released).toBe(true)
    expect(documentAdapter.disposeCalls).toHaveLength(0)
    expect(broker.diagnostics().durableRefCounts[leaseTwo.key]).toBe(1)
    expect(leaseTwo.value).toBeDefined()
  })

  it('the LAST release disposes exactly once (LAY-009)', async () => {
    const { broker, documentAdapter } = buildTestBroker()
    const leaseOne = await broker.acquire(DOC_A, DOC_ADAPTER_ID)
    const leaseTwo = await broker.acquire(DOC_A, DOC_ADAPTER_ID)
    leaseOne.release()
    leaseTwo.release()
    await broker.settled()
    // The broker passes its OWN namespaced key to adapter.dispose(value,
    // key), not the adapter's raw resourceKey() return value — so this must
    // equal the observed lease.key, not a hand-reconstructed raw string.
    expect(documentAdapter.disposeCalls).toEqual([leaseOne.key])
    expect(broker.diagnostics().durableRefCounts[leaseOne.key]).toBeUndefined()
    expect((leaseOne.value as { disposed: boolean }).disposed).toBe(true)
  })

  it('release() is idempotent — a second release() on the same lease is a no-op', async () => {
    const { broker, documentAdapter } = buildTestBroker()
    const lease = await broker.acquire(DOC_A, DOC_ADAPTER_ID)
    lease.release()
    lease.release()
    lease.release()
    await broker.settled()
    expect(documentAdapter.disposeCalls).toHaveLength(1) // not 3
  })

  it('re-acquiring after full release starts a fresh lifecycle (load runs again, not a resurrected value)', async () => {
    const { broker, documentAdapter } = buildTestBroker()
    const first = await broker.acquire(DOC_A, DOC_ADAPTER_ID)
    first.release()
    await broker.settled()
    const second = await broker.acquire(DOC_A, DOC_ADAPTER_ID)
    expect(documentAdapter.loadCalls).toHaveLength(2)
    expect(second.value).not.toBe(first.value)
    expect((second.value as { disposed: boolean }).disposed).toBe(false)
  })

  it('different keys never share ref counts or values', async () => {
    const { broker } = buildTestBroker()
    const leaseA = await broker.acquire(DOC_A, DOC_ADAPTER_ID)
    const leaseB = await broker.acquire(DOC_B, DOC_ADAPTER_ID)
    expect(leaseA.key).not.toBe(leaseB.key)
    expect(leaseA.value).not.toBe(leaseB.value)
    expect(broker.diagnostics().durableRefCounts[leaseA.key]).toBe(1)
    expect(broker.diagnostics().durableRefCounts[leaseB.key]).toBe(1)
  })

  it('a durable and a blob adapter compose on one broker without interfering', async () => {
    const { broker } = buildTestBroker()
    const docLease = await broker.acquire(DOC_A, DOC_ADAPTER_ID)
    const blobLease = await broker.acquire(BLOB_A, BLOB_ADAPTER_ID)
    expect(docLease.key).not.toBe(blobLease.key)
    expect((blobLease.value as { bytes: Uint8Array }).bytes).toBeInstanceOf(Uint8Array)
  })
})

// diff-review r2 WRONG: "the broker silently selects the first adapter whose
// accepts() returns true ... two faces needing different projections of the
// same resource kind are therefore order-dependent and can receive the wrong
// lease value". `acquire()` now REQUIRES the caller to name exactly which
// registered adapter resolves the locator — no first-match scan anywhere —
// and rejects an unknown id or a named-but-non-accepting adapter instead of
// silently substituting a different one.
describe('LayoutResourceBroker — acquire() resolves the NAMED adapter, never a first-match scan', () => {
  it('acquire() rejects with UnknownResourceAdapterError when the named adapterId is not registered', async () => {
    const broker = new LayoutResourceBroker()
    await expect(
      broker.acquire({ kind: 'chat', graphId: 'g1', sessionId: 's1' }, 'nothing.registered.under.this.id'),
    ).rejects.toThrow(UnknownResourceAdapterError)
  })

  it('acquire() rejects with ResourceAdapterLocatorMismatchError when the named adapter does not accept this locator', async () => {
    const { broker } = buildTestBroker()
    // BLOB_ADAPTER_ID is real and registered, but DOC_A is a document
    // locator — the document adapter's id, not the blob adapter's.
    await expect(broker.acquire(DOC_A, BLOB_ADAPTER_ID)).rejects.toThrow(ResourceAdapterLocatorMismatchError)
  })

  it('two adapters that BOTH accept the same locator kind never collide: acquire() always resolves the NAMED one, regardless of registration order', async () => {
    const projectionA: DurableResourceAdapter<{ readonly projection: string }> = {
      adapterId: 'test.projection-a',
      shape: 'durable',
      accepts: (locator) => locator.kind === 'query',
      resourceKey: (locator) => (locator.kind === 'query' ? `a:${locator.queryId}` : 'unreachable'),
      load: async () => ({ projection: 'A' }),
      dispose: () => {},
    }
    const projectionB: DurableResourceAdapter<{ readonly projection: string }> = {
      adapterId: 'test.projection-b',
      shape: 'durable',
      accepts: (locator) => locator.kind === 'query', // deliberately the SAME kind as projectionA
      resourceKey: (locator) => (locator.kind === 'query' ? `b:${locator.queryId}` : 'unreachable'),
      load: async () => ({ projection: 'B' }),
      dispose: () => {},
    }
    const locator = { kind: 'query', graphId: 'g1', queryId: 'shared-query-text' } as const

    // Order A-then-B:
    const brokerAB = new LayoutResourceBroker()
    brokerAB.registerAdapter(projectionA)
    brokerAB.registerAdapter(projectionB)
    const leaseFromB_inAB = await brokerAB.acquire(locator, 'test.projection-b')
    expect((leaseFromB_inAB.value as { projection: string }).projection).toBe('B')

    // Order B-then-A — the OPPOSITE registration order, same requested id:
    // a first-match scan would have returned B in the first broker (B
    // registered second, A still matches first) and now potentially A here
    // if implemented as first-match; the NAMED-id contract must return B in
    // BOTH regardless of order.
    const brokerBA = new LayoutResourceBroker()
    brokerBA.registerAdapter(projectionB)
    brokerBA.registerAdapter(projectionA)
    const leaseFromB_inBA = await brokerBA.acquire(locator, 'test.projection-b')
    expect((leaseFromB_inBA.value as { projection: string }).projection).toBe('B')

    // And asking for A explicitly, on the SAME locator, gets A — not B.
    const leaseFromA_inAB = await brokerAB.acquire(locator, 'test.projection-a')
    expect((leaseFromA_inAB.value as { projection: string }).projection).toBe('A')
  })

  it('cache keys are namespaced by adapter identity: two adapters whose OWN resourceKey returns the identical raw string never share a durable entry', async () => {
    const sameRawKey = 'identical-raw-key'
    const adapterOne: DurableResourceAdapter<{ readonly from: string }> = {
      adapterId: 'test.namespace-one',
      shape: 'durable',
      accepts: (locator) => locator.kind === 'chat',
      resourceKey: () => sameRawKey,
      load: async () => ({ from: 'one' }),
      dispose: () => {},
    }
    const adapterTwo: DurableResourceAdapter<{ readonly from: string }> = {
      adapterId: 'test.namespace-two',
      shape: 'durable',
      accepts: (locator) => locator.kind === 'chat',
      resourceKey: () => sameRawKey, // deliberately the SAME raw key as adapterOne
      load: async () => ({ from: 'two' }),
      dispose: () => {},
    }
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(adapterOne)
    broker.registerAdapter(adapterTwo)
    const locator = { kind: 'chat', graphId: 'g1', sessionId: 's1' } as const

    const leaseOne = await broker.acquire(locator, 'test.namespace-one')
    const leaseTwo = await broker.acquire(locator, 'test.namespace-two')

    expect(leaseOne.key).not.toBe(leaseTwo.key) // the broker's OWN key is adapter-qualified
    expect(leaseOne.value).not.toBe(leaseTwo.value) // and never shares the underlying durable entry
    expect((leaseOne.value as { from: string }).from).toBe('one')
    expect((leaseTwo.value as { from: string }).from).toBe('two')
    expect(broker.diagnostics().durableRefCounts[leaseOne.key]).toBe(1)
    expect(broker.diagnostics().durableRefCounts[leaseTwo.key]).toBe(1)
  })
})

// diff-review r2 WRONG: "lease release can still throw synchronously ...
// such a throw aborts the outer disposal loop after disposed is already set,
// recreating the unretryable partial-cleanup failure". These prove
// `release()` itself is now a non-throwing contract regardless of how the
// underlying adapter's `dispose` fails, and that a failing adapter never
// blocks any OTHER lease's teardown.
describe('LayoutResourceBroker — release() never throws, even when adapter.dispose() fails', () => {
  it('a SYNCHRONOUSLY throwing dispose does not escape release()', async () => {
    const broker = new LayoutResourceBroker()
    const { adapter, adapterId } = createThrowingDisposeAdapter('sync')
    broker.registerAdapter(adapter)
    const lease = await broker.acquire({ kind: 'chat', graphId: 'g1', sessionId: 'bad-a' }, adapterId)
    expect(() => lease.release()).not.toThrow()
    await broker.settled()
    const errors = broker.takeDisposalErrors()
    expect(errors).toHaveLength(1)
    expect(errors[0]!.error).toBeInstanceOf(Error)
    expect((errors[0]!.error as Error).message).toContain('sync dispose failure')
  })

  it('an ASYNCHRONOUSLY rejecting dispose does not escape release() and is retained too', async () => {
    const broker = new LayoutResourceBroker()
    const { adapter, adapterId } = createThrowingDisposeAdapter('async')
    broker.registerAdapter(adapter)
    const lease = await broker.acquire({ kind: 'chat', graphId: 'g1', sessionId: 'bad-b' }, adapterId)
    expect(() => lease.release()).not.toThrow()
    await broker.settled()
    const errors = broker.takeDisposalErrors()
    expect(errors).toHaveLength(1)
    expect((errors[0]!.error as Error).message).toContain('async dispose failure')
  })

  it('takeDisposalErrors() drains — a second call returns empty until another disposal fails', async () => {
    const broker = new LayoutResourceBroker()
    const { adapter, adapterId } = createThrowingDisposeAdapter('sync')
    broker.registerAdapter(adapter)
    const lease = await broker.acquire({ kind: 'chat', graphId: 'g1', sessionId: 'drain-me' }, adapterId)
    lease.release()
    await broker.settled()
    expect(broker.takeDisposalErrors()).toHaveLength(1)
    expect(broker.takeDisposalErrors()).toHaveLength(0)
  })

  it('one lease\'s failing disposal never blocks a DIFFERENT key\'s teardown', async () => {
    const broker = new LayoutResourceBroker()
    const { adapter: throwing, adapterId: throwingId } = createThrowingDisposeAdapter('sync')
    const { adapter: healthy, disposeCalls } = createDocumentAdapter()
    broker.registerAdapter(throwing)
    broker.registerAdapter(healthy)
    const badLease = await broker.acquire({ kind: 'chat', graphId: 'g1', sessionId: 'bad-c' }, throwingId)
    const goodLease = await broker.acquire(DOC_A, DOC_ADAPTER_ID)
    badLease.release()
    goodLease.release()
    await broker.settled()
    // disposeCalls records the broker's namespaced key, not the adapter's
    // own raw resourceKey() return value — see the identical note above.
    expect(disposeCalls).toEqual([goodLease.key]) // the healthy adapter's dispose ran regardless of the other's failure
    expect(broker.diagnostics().disposalErrorCount).toBe(1)
    broker.takeDisposalErrors()
  })

  it('diagnostics().disposalErrorCount reflects retained errors before they are drained', async () => {
    const broker = new LayoutResourceBroker()
    const { adapter, adapterId } = createThrowingDisposeAdapter('sync')
    broker.registerAdapter(adapter)
    expect(broker.diagnostics().disposalErrorCount).toBe(0)
    const lease = await broker.acquire({ kind: 'chat', graphId: 'g1', sessionId: 'count-me' }, adapterId)
    lease.release()
    await broker.settled()
    expect(broker.diagnostics().disposalErrorCount).toBe(1)
  })
})

describe('LayoutResourceBroker — registration', () => {
  it('registerAdapter throws on a duplicate adapterId', () => {
    const broker = new LayoutResourceBroker()
    const { adapter } = createDocumentAdapter()
    broker.registerAdapter(adapter)
    expect(() => broker.registerAdapter(adapter)).toThrow(DuplicateResourceAdapterError)
  })
})

describe('LayoutResourceBroker — ordinary derived values remain fresh per acquire', () => {
  it('a derived adapter registers on the SAME broker as durable adapters with no interface changes', async () => {
    const { broker } = buildTestBroker()
    const { adapter: rollup } = createQueryRollupAdapter()
    expect(() => broker.registerAdapter(rollup)).not.toThrow()
  })

  it('acquire() on a derived locator computes fresh and reports shape "derived"', async () => {
    const broker = new LayoutResourceBroker()
    const { adapter: rollup, computeCalls } = createQueryRollupAdapter()
    broker.registerAdapter(rollup)
    const lease = await broker.acquire({ kind: 'query', graphId: 'g1', queryId: 'active-keystones' }, ROLLUP_ADAPTER_ID)
    expect(lease.shape).toBe('derived')
    expect(computeCalls).toHaveLength(1)
    expect((lease.value as { rows: readonly number[] }).rows).toEqual([1, 2, 3])
  })

  it('derived leases are NOT shared/ref-counted — two acquires of the same locator compute independently', async () => {
    const broker = new LayoutResourceBroker()
    const { adapter: rollup, computeCalls } = createQueryRollupAdapter()
    broker.registerAdapter(rollup)
    const locator = { kind: 'query', graphId: 'g1', queryId: 'active-keystones' } as const
    const leaseOne = await broker.acquire(locator, ROLLUP_ADAPTER_ID)
    const leaseTwo = await broker.acquire(locator, ROLLUP_ADAPTER_ID)
    expect(computeCalls).toHaveLength(2) // no dedupe/sharing — "refetchable, staleable, no durable identity"
    expect(leaseOne.value).not.toBe(leaseTwo.value)
    // A derived key is never tracked in durableRefCounts — that map is durable-only.
    expect(broker.diagnostics().durableRefCounts[leaseOne.key]).toBeUndefined()
  })

  it('releasing a derived lease calls its (optional) dispose exactly once, independent of any other lease', async () => {
    const broker = new LayoutResourceBroker()
    const { adapter: rollup, disposeCalls } = createQueryRollupAdapter()
    broker.registerAdapter(rollup)
    const locator = { kind: 'query', graphId: 'g1', queryId: 'active-keystones' } as const
    const lease = await broker.acquire(locator, ROLLUP_ADAPTER_ID)
    lease.release()
    lease.release() // idempotent, even for derived
    await broker.settled()
    expect(disposeCalls).toHaveLength(1)
  })
})

describe('LayoutResourceBroker — retained derived background values', () => {
  it('shares one in-flight compute and one value across concurrent leases when an adapter opts in', async () => {
    let resolveValue!: (value: { readonly rows: readonly number[] }) => void
    const pending = new Promise<{ readonly rows: readonly number[] }>((resolve) => {
      resolveValue = resolve
    })
    let computeCalls = 0
    const adapter: DerivedResourceAdapter<{ readonly rows: readonly number[] }> = {
      adapterId: 'test.retained-rollup',
      shape: 'derived',
      retainForMs: 60_000,
      accepts: (locator) => locator.kind === 'query',
      resourceKey: (locator) => JSON.stringify(locator),
      async compute() {
        computeCalls += 1
        return pending
      },
    }
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(adapter)
    const locator = { kind: 'query', graphId: 'g1', queryId: 'q1' } as const

    const acquiringOne = broker.acquire(locator, adapter.adapterId)
    const acquiringTwo = broker.acquire(locator, adapter.adapterId)
    resolveValue({ rows: [1, 2, 3] })
    const [one, two] = await Promise.all([acquiringOne, acquiringTwo])

    expect(computeCalls).toBe(1)
    expect(one.value).toBe(two.value)
    expect(broker.diagnostics().retainedDerivedRefCounts?.[one.key]).toBe(2)
    one.release()
    two.release()
    broker.clearRetained()
  })

  it('reuses a warm zero-ref value, then disposes it on explicit idle-store clearing', async () => {
    let computeCalls = 0
    let disposeCalls = 0
    const adapter: DerivedResourceAdapter<{ readonly identity: number }> = {
      adapterId: 'test.warm-rollup',
      shape: 'derived',
      retainForMs: 60_000,
      accepts: (locator) => locator.kind === 'query',
      resourceKey: (locator) => JSON.stringify(locator),
      async compute() {
        return { identity: ++computeCalls }
      },
      dispose() {
        disposeCalls += 1
      },
    }
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(adapter)
    const locator = { kind: 'query', graphId: 'g1', queryId: 'q1' } as const

    const first = await broker.acquire(locator, adapter.adapterId)
    const firstValue = first.value
    first.release()
    expect(broker.diagnostics().retainedDerivedRefCounts?.[first.key]).toBe(0)

    const second = await broker.acquire(locator, adapter.adapterId)
    expect(second.value).toBe(firstValue)
    expect(computeCalls).toBe(1)
    second.release()

    broker.clearRetained()
    await broker.settled()
    expect(disposeCalls).toBe(1)
    expect(broker.diagnostics().retainedDerivedRefCounts?.[first.key]).toBeUndefined()
  })

  it('an opt-in zero retention evicts after release while allowing same-turn reacquisition', async () => {
    let computeCalls = 0
    const adapter: DerivedResourceAdapter<{ readonly identity: number }> = {
      adapterId: 'test.zero-retention',
      shape: 'derived',
      retainForMs: 0,
      accepts: (locator) => locator.kind === 'query',
      resourceKey: (locator) => JSON.stringify(locator),
      async compute() {
        return { identity: ++computeCalls }
      },
    }
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(adapter)
    const locator = { kind: 'query', graphId: 'g1', queryId: 'q1' } as const

    const first = await broker.acquire(locator, adapter.adapterId)
    first.release()
    const sameTurn = await broker.acquire(locator, adapter.adapterId)
    expect(sameTurn.value).toBe(first.value)
    sameTurn.release()

    await Promise.resolve()
    const afterEviction = await broker.acquire(locator, adapter.adapterId)
    expect(afterEviction.value).not.toBe(first.value)
    expect(computeCalls).toBe(2)
    afterEviction.release()
    await Promise.resolve()
  })

  it('clearRetained retires an active value on its last release', async () => {
    let disposeCalls = 0
    let computeCalls = 0
    const adapter: DerivedResourceAdapter<{ readonly identity: number }> = {
      adapterId: 'test.retire-active',
      shape: 'derived',
      retainForMs: 60_000,
      accepts: (locator) => locator.kind === 'query',
      resourceKey: (locator) => JSON.stringify(locator),
      compute: async () => ({ identity: ++computeCalls }),
      dispose: () => {
        disposeCalls += 1
      },
    }
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(adapter)
    const locator = { kind: 'query', graphId: 'g1', queryId: 'q1' } as const

    const lease = await broker.acquire(locator, adapter.adapterId)
    broker.clearRetained()
    expect(broker.diagnostics().retainedDerivedRefCounts?.[lease.key]).toBe(1)

    const nextScopeLease = await broker.acquire(locator, adapter.adapterId)
    expect(nextScopeLease.key).not.toBe(lease.key)
    expect(nextScopeLease.value).not.toBe(lease.value)
    expect(computeCalls).toBe(2)

    lease.release()
    nextScopeLease.release()
    broker.clearRetained()
    await broker.settled()
    expect(disposeCalls).toBe(2)
    expect(broker.diagnostics().retainedDerivedRefCounts?.[lease.key]).toBeUndefined()
    expect(broker.diagnostics().retainedDerivedRefCounts?.[nextScopeLease.key]).toBeUndefined()
  })

  it('clearRetained cannot be defeated by a retained compute that settles afterward', async () => {
    let resolveValue!: (value: { readonly identity: number }) => void
    const pendingValue = new Promise<{ readonly identity: number }>((resolve) => {
      resolveValue = resolve
    })
    let disposeCalls = 0
    const adapter: DerivedResourceAdapter<{ readonly identity: number }> = {
      adapterId: 'test.retire-pending',
      shape: 'derived',
      retainForMs: 60_000,
      accepts: (locator) => locator.kind === 'query',
      resourceKey: (locator) => JSON.stringify(locator),
      compute: async () => pendingValue,
      dispose: () => {
        disposeCalls += 1
      },
    }
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(adapter)
    const locator = { kind: 'query', graphId: 'g1', queryId: 'q1' } as const

    const acquiring = broker.acquire(locator, adapter.adapterId)
    broker.clearRetained()
    resolveValue({ identity: 1 })
    const lease = await acquiring
    lease.release()

    await broker.settled()
    expect(disposeCalls).toBe(1)
    expect(broker.diagnostics().retainedDerivedRefCounts?.[lease.key]).toBeUndefined()
  })
})

describe('LayoutResourceBroker — diagnostics().outstandingLeases', () => {
  it('tracks total un-released leases across both shapes', async () => {
    const { broker } = buildTestBroker()
    const rollup = createQueryRollupAdapter()
    broker.registerAdapter(rollup.adapter)

    expect(broker.diagnostics().outstandingLeases).toBe(0)
    const durable = await broker.acquire(DOC_A, DOC_ADAPTER_ID)
    const derived = await broker.acquire({ kind: 'query', graphId: 'g1', queryId: 'q1' }, ROLLUP_ADAPTER_ID)
    expect(broker.diagnostics().outstandingLeases).toBe(2)
    durable.release()
    expect(broker.diagnostics().outstandingLeases).toBe(1)
    derived.release()
    expect(broker.diagnostics().outstandingLeases).toBe(0)
  })
})
