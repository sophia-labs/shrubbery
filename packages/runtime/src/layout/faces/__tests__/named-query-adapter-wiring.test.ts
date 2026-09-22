import { describe, expect, it } from 'vitest'
import type { QueryBlockService } from '../../../editor-services/query-block-service.js'
import {
  NamedQueryRegistry,
  NamedQueryResolutionError,
  createQueryTextResolver,
} from '../../named-query-registry.js'
import { createQueryHandleResourceAdapter } from '../query-handle-resource-adapter.js'
import { createStatScalarResourceAdapter } from '../stat-scalar-face.js'
import { createChartVegaLiteResourceAdapter } from '../chart-vega-lite-face.js'
import { createSparqlBindingsTableResourceAdapter } from '../sparql-bindings-table-face.js'
import { createGridCollectionQueryResourceAdapter } from '../grid-collection-query-resource-adapter.js'

const service: QueryBlockService = {
  async run() {
    throw new Error('named-query-adapter-wiring.test.ts: run should not be reached')
  },
}

function namedOnlyResolver() {
  const registry = new NamedQueryRegistry()
  registry.seal()
  return createQueryTextResolver({ registry, rawTextPolicy: 'named-only' })
}

const rawLocator = { kind: 'query' as const, graphId: 'g', queryId: 'SELECT * WHERE {}' }

describe('named-query adapter wiring', () => {
  it('all four query adapters resolve eagerly at compute()', async () => {
    const resolver = namedOnlyResolver()
    const adapters = [
      createQueryHandleResourceAdapter('test.query', service, resolver),
      createStatScalarResourceAdapter(service, resolver),
      createChartVegaLiteResourceAdapter(service, resolver),
      createSparqlBindingsTableResourceAdapter(service, resolver),
      createGridCollectionQueryResourceAdapter(service, resolver),
    ]
    for (const adapter of adapters) {
      await expect(adapter.compute(rawLocator)).rejects.toBeInstanceOf(NamedQueryResolutionError)
    }
  })

  it('resource keys retain the unresolved query name', () => {
    const resolver = namedOnlyResolver()
    const adapter = createStatScalarResourceAdapter(service, resolver)
    const a = adapter.resourceKey({ kind: 'query', graphId: 'g', queryId: 'urn:sophia:query:a' })
    const b = adapter.resourceKey({ kind: 'query', graphId: 'g', queryId: 'urn:sophia:query:a' })
    const c = adapter.resourceKey({ kind: 'query', graphId: 'g', queryId: 'urn:sophia:query:b' })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('the collection adapter rejects an unknown name before its first handle run', async () => {
    const adapter = createGridCollectionQueryResourceAdapter(service, namedOnlyResolver())
    await expect(adapter.compute({ kind: 'query', graphId: 'g', queryId: 'urn:sophia:query:missing' })).rejects.toMatchObject({ reason: 'unknown-name' })
  })
})
