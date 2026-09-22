/**
 * query-handle-resource-adapter.ts — the shared DERIVED-resource half for
 * `stat.scalar` and `chart.vega-lite` (Wave 2 / Lane B spec
 * `plans/surface-wave2-laneb-slice-20260716.md` §4's own "Derived-adapter
 * note": the original query adapters returned an imperative `QueryHandle`.
 * The completed form keeps the face-owned refresh cadence but makes the lease
 * value a retained reactive store: faces observe snapshots and call
 * `refresh()`, while the broker's activation queue governs execution.
 *
 * This is a DELIBERATE divergence from `sparql.bindings-table`'s own
 * `createSparqlBindingsTableResourceAdapter` (sparql-bindings-table-face.ts),
 * which historically resolved the FULL `QueryBlockResult` once at
 * `compute()` time. All three query faces now converge on the same
 * StoreState lifecycle, without changing their result projections.
 *
 * Factored out once because `stat.scalar` and `chart.vega-lite` need
 * byte-identical adapter logic (`accepts`/`resourceKey`/`compute`), differing
 * only in their own `adapterId` string — this is NOT a general-purpose
 * abstraction layered over every query face: `sparql.bindings-table`
 * keeps its own private adapter, and `card.subject` needs graph-parametrized
 * stores, so neither is hidden behind this helper.
 */
import type { ResourceLocator } from '@shrubbery/nucleus/layout'
import type { QueryBlockResult, QueryBlockService } from '../../editor-services/query-block-service.js'
import type { DerivedResourceAdapter, ResourceKey } from '../types.js'
import { resourceKeyTuple } from '../resource-key.js'
import type { QueryTextResolver } from '../named-query-registry.js'
import {
  createSurfaceResourceStore,
  DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
  type SurfaceResourceStore,
} from '../resource-store.js'

/**
 * The maximum row count this face family will ever ask
 * `QueryBlockService.run()` to fetch — mirrors `sparql-bindings-table-
 * face.ts`'s own `SERVICE_MAX_ROWS` (that file's own `run()` clamp is
 * `Math.max(1, Math.min(500, ...))`). `stat.scalar` only ever looks at the
 * first row; `chart.vega-lite` charts every row up to this ceiling.
 */
const SERVICE_MAX_ROWS = 500

/**
 * Compatibility name retained for the two face modules. Its value is now the
 * canonical reactive store envelope over a query result.
 */
export type QueryHandle = SurfaceResourceStore<QueryBlockResult>

export function isQueryLocator(locator: ResourceLocator): locator is Extract<ResourceLocator, { kind: 'query' }> {
  return locator.kind === 'query'
}

export function queryHandleResourceKey(locator: ResourceLocator): ResourceKey {
  if (!isQueryLocator(locator)) {
    throw new Error(`query-handle resource adapter given a non-query locator (kind '${locator.kind}')`)
  }
  // Collision-safe tagged tuple, not a naive colon-join — see resource-key.ts.
  return resourceKeyTuple('query', locator.graphId, locator.queryId, locator.revision)
}

/**
 * Build a `DerivedResourceAdapter<QueryHandle>` under `adapterId` — one real,
 * distinct registration per calling face (`FaceRegistration.resourceAdapterId`
 * binds a face to exactly one adapter id; resource-broker.ts's "no guessing"
 * discipline).
 */
export function createQueryHandleResourceAdapter(
  adapterId: string,
  service: QueryBlockService,
  resolver: QueryTextResolver,
): DerivedResourceAdapter<QueryHandle> {
  return {
    adapterId,
    shape: 'derived',
    retainForMs: DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
    accepts: isQueryLocator,
    resourceKey: queryHandleResourceKey,
    async compute(locator, context) {
      if (!isQueryLocator(locator)) throw new Error('unreachable: resourceKey already validated the kind')
      const { graphId } = locator
      const query = resolver.resolve(locator)
      return createSurfaceResourceStore(
        () => service.run(graphId, query, SERVICE_MAX_ROWS),
        context,
      )
    },
  }
}
