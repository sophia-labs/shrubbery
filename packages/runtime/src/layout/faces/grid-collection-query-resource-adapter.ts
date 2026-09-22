/**
 * grid-collection-query-resource-adapter.ts — the production
 * `DerivedResourceAdapter<GridCollectionQueryHandle>` a real grid's
 * COLLECTION children source resolves through (Wave 2 / Lane B spec
 * `plans/surface-wave2-laneb-slice-20260716.md` §3: "the grid holds a
 * derived lease on the collection query"; §6.3's flagship e2e is this
 * adapter's first real-cell exercise).
 *
 * Mirrors `query-handle-resource-adapter.ts`'s shared `QueryHandle` shape
 * exactly, one layer up: wraps the SAME production `QueryBlockService`
 * every other query-backed face in this directory wraps — no query-
 * execution logic of its own — and hands back a retained, refreshable
 * `GridCollectionQueryHandle` store. `layout-interpreter.ts`'s grid renderer
 * decides refresh cadence via `GridChildrenSource.collection.refreshSeconds`,
 * never this adapter.
 *
 * `types.ts`'s own header explains why `GridCollectionRow`/
 * `GridCollectionTerm` are declared independently of `QueryBlockTerm`: the
 * core interpreter must not depend on any one query-execution service. A
 * real `QueryBlockResult` (`resultKind: 'bindings'`) is structurally
 * assignable to `GridCollectionQueryResult` with no per-row translation —
 * every `QueryBlockTerm` already carries the `.value: string` field
 * `GridCollectionTerm` requires.
 *
 * This is NOT a `FaceRegistration`-bound adapter (no face names it via
 * `resourceAdapterId`) — it is registered on the SAME broker as every face
 * adapter, then its own `adapterId` is threaded into
 * `LayoutInterpreterOptions.gridCollectionResourceAdapterId` so
 * `LayoutInterpreter`'s grid renderer (not any one face) is the caller that
 * acquires it (`layout-interpreter.ts`'s `reconcileCollectionGrid`).
 */
import type { ResourceLocator } from '@shrubbery/nucleus/layout'
import type { QueryBlockService } from '../../editor-services/query-block-service.js'
import type { DerivedResourceAdapter, GridCollectionQueryHandle, ResourceKey } from '../types.js'
import { resourceKeyTuple } from '../resource-key.js'
import type { QueryTextResolver } from '../named-query-registry.js'
import {
  createSurfaceResourceStore,
  DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
  refreshSurfaceResourceStore,
} from '../resource-store.js'

/**
 * The maximum row count this adapter will ever ask `QueryBlockService.run()`
 * to fetch — mirrors the sibling query-face adapters' shared
 * `SERVICE_MAX_ROWS` ceiling (`query-handle-resource-adapter.ts`,
 * `sparql-bindings-table-face.ts`). The grid's OWN `maxItems` (a document
 * field, always <= this ceiling in practice) slices further at render time
 * (`layout-interpreter.ts`'s `runGridCollectionRefresh`); this is only the
 * network-fetch ceiling.
 */
const SERVICE_MAX_ROWS = 500

export const GRID_COLLECTION_QUERY_ADAPTER_ID = 'layout.grid-collection.query-handle'

function isQueryLocator(locator: ResourceLocator): locator is Extract<ResourceLocator, { kind: 'query' }> {
  return locator.kind === 'query'
}

function gridCollectionResourceKey(locator: ResourceLocator): ResourceKey {
  if (!isQueryLocator(locator)) {
    throw new Error(`grid-collection query resource adapter given a non-query locator (kind '${locator.kind}')`)
  }
  // Collision-safe tagged tuple, not a naive colon-join — see resource-key.ts.
  return resourceKeyTuple('grid-collection-query', locator.graphId, locator.queryId, locator.revision)
}

/**
 * Build a `DerivedResourceAdapter<GridCollectionQueryHandle>` under
 * `adapterId` (default `GRID_COLLECTION_QUERY_ADAPTER_ID`) — a real, distinct
 * registration a caller both `broker.registerAdapter()`s AND passes as
 * `LayoutInterpreterOptions.gridCollectionResourceAdapterId` (resource-
 * broker.ts's "no guessing" discipline, one layer up from a per-face binding).
 */
export function createGridCollectionQueryResourceAdapter(
  service: QueryBlockService,
  resolver: QueryTextResolver,
  adapterId: string = GRID_COLLECTION_QUERY_ADAPTER_ID,
): DerivedResourceAdapter<GridCollectionQueryHandle> {
  return {
    adapterId,
    shape: 'derived',
    retainForMs: DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
    accepts: isQueryLocator,
    resourceKey: gridCollectionResourceKey,
    async compute(locator, context) {
      if (!isQueryLocator(locator)) throw new Error('unreachable: resourceKey already validated the kind')
      const { graphId } = locator
      const query = resolver.resolve(locator)
      const store = createSurfaceResourceStore(async () => {
        const result = await service.run(graphId, query, SERVICE_MAX_ROWS)
        if (result.resultKind !== 'bindings') {
          throw new Error(
            `grid collection query must be a SELECT (got a ${result.resultKind} result) for graphId=${graphId}`,
          )
        }
        // Structural match (see this file's header): every QueryBlockTerm
        // already carries the `.value: string` (and `.type`) GridCollectionTerm
        // needs. `totalRowCount` falls back to the (already fetch-clamped)
        // `rows.length` only for a hand-built `QueryBlockResult` that omits it.
        return { rows: result.rows, totalRowCount: result.totalRowCount ?? result.rows.length }
      }, context)
      return {
        ...store,
        run: () => refreshSurfaceResourceStore(store),
      }
    },
  }
}
