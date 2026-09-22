/**
 * query-handle-resource-adapter.test.ts — the resource-key/adapter-shape
 * proof for the SHARED `stat.scalar`/`chart.vega-lite` derived-resource
 * adapter. Mirrors `sparql-bindings-table-face.test.ts`'s own scope: only
 * `resourceKey`/`accepts` are pure functions of the locator, independent of
 * what a real `QueryBlockService.run()` would return — a real network-backed
 * service is exercised only in the real-cell integration tests (`stat-
 * scalar-face.integration.test.ts`, `chart-vega-lite-face.integration.
 * test.ts`).
 */
import { describe, expect, it } from 'vitest'
import type { QueryBlockService } from '../../../editor-services/query-block-service.js'
import { createQueryHandleResourceAdapter } from '../query-handle-resource-adapter.js'
import { createRawTextQueryResolver } from '../../named-query-registry.js'

// Real shape, deliberately unused by these tests — `run()` should never be
// invoked (only the ADAPTER's own `accepts`/`resourceKey` are exercised
// here); a real network-backed service is used everywhere `run()` actually
// executes (see this file's header).
const unusedService: QueryBlockService = {
  async run() {
    throw new Error('query-handle-resource-adapter.test.ts: run() should never be invoked by this suite')
  },
}

describe('query-handle resource adapter — resource adapter shape', () => {
  it('accepts only query locators', () => {
    const adapter = createQueryHandleResourceAdapter('test.query-handle', unusedService, createRawTextQueryResolver())
    expect(adapter.shape).toBe('derived')
    expect(adapter.accepts({ kind: 'query', graphId: 'g', queryId: 'SELECT * WHERE { ?s ?p ?o }' })).toBe(true)
    expect(adapter.accepts({ kind: 'document', graphId: 'g', documentId: 'd' })).toBe(false)
    expect(adapter.accepts({ kind: 'iri', iri: 'urn:x' })).toBe(false)
  })

  it('resourceKey is a collision-safe tagged tuple, not a naive colon-join', () => {
    const adapter = createQueryHandleResourceAdapter('test.query-handle', unusedService, createRawTextQueryResolver())
    const keyAB_C = adapter.resourceKey({ kind: 'query', graphId: 'a:b', queryId: 'c' })
    const keyA_BC = adapter.resourceKey({ kind: 'query', graphId: 'a', queryId: 'b:c' })
    expect(keyAB_C).not.toBe(keyA_BC)

    const withEmptyRevision = adapter.resourceKey({ kind: 'query', graphId: 'g', queryId: 'q', revision: '' })
    const withNoRevision = adapter.resourceKey({ kind: 'query', graphId: 'g', queryId: 'q' })
    expect(withEmptyRevision).not.toBe(withNoRevision)
  })

  it('two different queries never collide; the same query is stable across calls', () => {
    const adapter = createQueryHandleResourceAdapter('test.query-handle', unusedService, createRawTextQueryResolver())
    const locatorA = { kind: 'query' as const, graphId: 'g1', queryId: 'SELECT ?s WHERE { ?s a ?t }' }
    const locatorB = { kind: 'query' as const, graphId: 'g1', queryId: 'SELECT ?o WHERE { ?s ?p ?o }' }
    expect(adapter.resourceKey(locatorA)).not.toBe(adapter.resourceKey(locatorB))
    expect(adapter.resourceKey(locatorA)).toBe(adapter.resourceKey(locatorA))
  })

  it('compute() returns an idle reactive store — building it never calls the service', async () => {
    const adapter = createQueryHandleResourceAdapter('test.query-handle', unusedService, createRawTextQueryResolver())
    const store = await adapter.compute({ kind: 'query', graphId: 'g', queryId: 'SELECT ?s WHERE { ?s ?p ?o }' })
    expect(typeof store.refresh).toBe('function')
    expect(store.get().status).toBe('idle')
    // `unusedService.run()` would throw if compute() eagerly invoked it.
  })

  it('two adapters with distinct adapterIds carry distinct identities (resource-broker.ts namespaces by adapterId)', () => {
    const statAdapter = createQueryHandleResourceAdapter('stat.scalar.query-handle', unusedService, createRawTextQueryResolver())
    const chartAdapter = createQueryHandleResourceAdapter('chart.vega-lite.query-handle', unusedService, createRawTextQueryResolver())
    expect(statAdapter.adapterId).toBe('stat.scalar.query-handle')
    expect(chartAdapter.adapterId).toBe('chart.vega-lite.query-handle')
    expect(statAdapter.adapterId).not.toBe(chartAdapter.adapterId)
  })
})
