/**
 * sparql-bindings-table-face.test.ts — the resource-key/adapter-shape
 * proof. `compute()` is deliberately never invoked here — a real SELECT
 * against a real gardend cell is exercised in
 * `apps/organism/scripts/layout-workbench-gardend-browser.mts`'s (e) proof
 * and `gardend-liveread.integration.test.ts`; this file covers what a
 * network-free unit test actually can: `resourceKey`/`accepts` are pure
 * functions of the locator, independent of what `run()` would return.
 */
import { describe, expect, it } from 'vitest'
import type { QueryBlockService } from '../../../editor-services/query-block-service.js'
import { createSparqlBindingsTableFace, createSparqlBindingsTableResourceAdapter } from '../sparql-bindings-table-face.js'
import { createRawTextQueryResolver } from '../../named-query-registry.js'

// Real shape, deliberately unused by these tests — `compute()` is never
// called (only `resourceKey`/`accepts` are exercised), so throwing here would
// never fire; a real network-backed service is used everywhere `compute()`
// actually runs (see this file's header).
const unusedService: QueryBlockService = {
  async run() {
    throw new Error('sparql-bindings-table-face.test.ts: compute() should never be invoked by this suite')
  },
}

describe('sparql.bindings-table — resource adapter shape', () => {
  it('accepts only query locators', () => {
    const adapter = createSparqlBindingsTableResourceAdapter(unusedService, createRawTextQueryResolver())
    expect(adapter.shape).toBe('derived')
    expect(adapter.accepts({ kind: 'query', graphId: 'g', queryId: 'SELECT * WHERE { ?s ?p ?o }' })).toBe(true)
    expect(adapter.accepts({ kind: 'document', graphId: 'g', documentId: 'd' })).toBe(false)
  })

  it('resourceKey is a collision-safe tagged tuple, not a naive colon-join (diff-review r2)', () => {
    const adapter = createSparqlBindingsTableResourceAdapter(unusedService, createRawTextQueryResolver())
    const keyAB_C = adapter.resourceKey({ kind: 'query', graphId: 'a:b', queryId: 'c' })
    const keyA_BC = adapter.resourceKey({ kind: 'query', graphId: 'a', queryId: 'b:c' })
    expect(keyAB_C).not.toBe(keyA_BC)

    // A present-but-empty revision must also stay distinguishable from an
    // absent one (resource-key.ts's own `?? null` normalization — JSON has
    // no `undefined`, so silently dropping the array slot would collapse
    // "no revision" and "revision:''" into the same encoded tuple).
    const withEmptyRevision = adapter.resourceKey({ kind: 'query', graphId: 'g', queryId: 'q', revision: '' })
    const withNoRevision = adapter.resourceKey({ kind: 'query', graphId: 'g', queryId: 'q' })
    expect(withEmptyRevision).not.toBe(withNoRevision)
  })

  it('two different queries never collide; the same query is stable across calls', () => {
    const adapter = createSparqlBindingsTableResourceAdapter(unusedService, createRawTextQueryResolver())
    const locatorA = { kind: 'query' as const, graphId: 'g1', queryId: 'SELECT ?s WHERE { ?s a ?t }' }
    const locatorB = { kind: 'query' as const, graphId: 'g1', queryId: 'SELECT ?o WHERE { ?s ?p ?o }' }
    expect(adapter.resourceKey(locatorA)).not.toBe(adapter.resourceKey(locatorB))
    expect(adapter.resourceKey(locatorA)).toBe(adapter.resourceKey(locatorA))
  })
})

/**
 * P6's `subjectField` addition (plans/observatory-ux-implementation-spec-
 * 20260728.md §3 P6). `paramsSchema` is a plain `(params) => boolean`
 * function — directly callable without any DOM/mount machinery, so it stays
 * inside this file's own "network-free unit test" scope (see this file's own
 * header). The element-level wiring `subjectField` drives
 * (`<sh-sparql-table-view>.subjectColumn`, and the row-activate event itself)
 * is proven in `sparql-table-view-element.test.ts`.
 */
describe('sparql.bindings-table — paramsSchema (P6 subjectField)', () => {
  it('accepts an optional subjectField alongside the existing optional maxRows', () => {
    const face = createSparqlBindingsTableFace()
    expect(face.paramsSchema(undefined)).toBe(true) // both fields optional
    expect(face.paramsSchema({ subjectField: 'run' })).toBe(true)
    expect(face.paramsSchema({ maxRows: 50, subjectField: 'run' })).toBe(true)
    expect(face.paramsSchema({ maxRows: 50 })).toBe(true) // unchanged pre-P6 shape still legal
  })

  it('rejects a non-string subjectField and any unknown key — closed schema, not an open escape hatch', () => {
    const face = createSparqlBindingsTableFace()
    expect(face.paramsSchema({ subjectField: 42 })).toBe(false)
    expect(face.paramsSchema({ subjectField: 'run', extra: true })).toBe(false)
  })
})
