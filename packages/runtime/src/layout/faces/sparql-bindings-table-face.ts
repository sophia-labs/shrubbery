/**
 * sparql-bindings-table-face.ts — the `sparql.bindings-table` face (design
 * §7.4, §9.1 "Proving leaf B"; diff-review WRONG: "the ratified Phase-2 gate
 * requires the real QueryBlockService/SPARQL bindings table" — this file
 * closes that gap).
 *
 * Wraps the PRODUCTION `QueryBlockService` (`makeQueryBlockService` over a
 * REAL `RestClient` — `../../editor-services/query-block-service.js`, the
 * exact service the live gardend integration test
 * (`apps/organism/tests/gardend-liveread.integration.test.ts`) already
 * exercises with a real SELECT). This module adds NO query execution logic
 * of its own — `run()` is the real service's real HTTP round-trip — and
 * reuses `formatQueryBlockTerm` for typed URI/bnode/literal rendering
 * (`sparql-table-view-element.ts`). What it does NOT reuse is
 * `makeQueryBlockRenderer` — that function owns the full TipTap-node
 * comment/collapse/Vega-builder toolbar, which design §9.1 explicitly asks
 * to leave behind ("removing TipTap node-specific toolbar concerns from the
 * leaf").
 *
 * Resource shape: `derived` (a query result has no durable domain identity).
 * Its adapter materializes a keyed reactive store: concurrent leaves share
 * one in-flight read and a released snapshot remains warm briefly for a
 * revisit, without turning the result into durable state.
 *
 * Resource locator: `{ kind: 'query', graphId, queryId }`. Named query
 * references resolve through the sealed registry at `compute()`; raw text is
 * retained only for the explicitly permitted human-authored escape hatch.
 */
import type { ResourceLocator, ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { StoreState } from '@shrubbery/nucleus'
import {
  formatQueryBlockTerm,
  type QueryBlockResult,
  type QueryBlockService,
} from '../../editor-services/query-block-service.js'
// Side-effect import: registers the <sh-sparql-table-view> custom element.
import './sparql-table-view-element.js'
import type { ShSparqlTableView } from './sparql-table-view-element.js'
import {
  closedParamsSchema,
  type DerivedResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
  type ResourceKey,
} from '../types.js'
import { resourceKeyTuple } from '../resource-key.js'
import type { QueryTextResolver } from '../named-query-registry.js'
import {
  createSurfaceResourceStore,
  DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
  observeSurfaceResourceStore,
  type SurfaceResourceStore,
} from '../resource-store.js'

export const SPARQL_BINDINGS_TABLE_FACE_ID = 'sparql.bindings-table'

/**
 * The maximum row count `query-block-service.ts`'s own `run()` will ever
 * fetch (its `Math.max(1, Math.min(500, ...))` clamp) — this adapter always
 * asks for the ceiling and lets the FACE slice down to the descriptor's own
 * (optional, closed-schema) `maxRows` for display. `compute(locator)` has no
 * visibility into `descriptor.params` (design's `DerivedResourceAdapter`
 * shape takes only a `ResourceLocator`), so the row cap the design's "cap
 * results using the existing 1..500 rule" describes is enforced in TWO
 * places that compose to the same bound: the service's own clamp (network
 * fetch ceiling) and this face's display slice (the descriptor's intent).
 */
const SERVICE_MAX_ROWS = 500

function isQueryLocator(locator: ResourceLocator): locator is Extract<ResourceLocator, { kind: 'query' }> {
  return locator.kind === 'query'
}

function queryResourceKey(locator: ResourceLocator): ResourceKey {
  if (!isQueryLocator(locator)) {
    throw new Error(`sparql.bindings-table: resource adapter given a non-query locator (kind '${locator.kind}')`)
  }
  // Collision-safe tagged tuple, not a naive colon-join — see resource-key.ts.
  return resourceKeyTuple('query', locator.graphId, locator.queryId, locator.revision)
}

/**
 * The derived-resource half materializes a retained reactive store. The first
 * visible face asks it to refresh through the broker-owned activation queue;
 * concurrent/revisiting faces observe the same snapshot and in-flight read.
 */
export function createSparqlBindingsTableResourceAdapter(
  service: QueryBlockService,
  resolver: QueryTextResolver,
): DerivedResourceAdapter<SurfaceResourceStore<QueryBlockResult>> {
  return {
    adapterId: 'sparql.bindings-table.query-block-service',
    shape: 'derived',
    retainForMs: DEFAULT_SURFACE_RESOURCE_RETENTION_MS,
    accepts: isQueryLocator,
    resourceKey: queryResourceKey,
    async compute(locator, context) {
      if (!isQueryLocator(locator)) throw new Error('unreachable: resourceKey already validated the kind')
      const query = resolver.resolve(locator)
      return createSurfaceResourceStore(
        () => service.run(locator.graphId, query, SERVICE_MAX_ROWS),
        context,
      )
    },
  }
}

function sparqlBindingsTableConstraints(): LeafConstraints {
  // <sh-sparql-table-view> owns its own internal overflow:auto stage.
  return { minWidth: 280, minHeight: 160, overflow: 'clip' }
}

function displayMaxRows(descriptor: ViewDescriptor): number {
  const params = descriptor.params as { readonly maxRows?: number } | undefined
  const requested = params?.maxRows
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return 100
  return Math.max(1, Math.min(SERVICE_MAX_ROWS, Math.trunc(requested)))
}

/**
 * The `sparql.bindings-table` `FaceRegistration`. `mount()` installs one
 * loading table immediately, observes any warm typed result, then requests a
 * refresh. No query text is re-parsed and no term is re-formatted anywhere
 * but through the real, reused `formatQueryBlockTerm`.
 */
export function createSparqlBindingsTableFace(): FaceRegistration {
  return {
    faceId: SPARQL_BINDINGS_TABLE_FACE_ID,
    // A query result is cheap to recompute and carries no local caret/
    // selection/undo state worth protecting across a relocate — design
    // §7.4's own catalog table: "stamp or cached-relocatable".
    persistence: 'stamp',
    // Binds this face to the EXACT registered adapter it expects (diff-review
    // r2 WRONG: "the broker silently selects the first adapter whose
    // accepts() returns true") — see createSparqlBindingsTableResourceAdapter's
    // own `adapterId` above.
    resourceAdapterId: 'sparql.bindings-table.query-block-service',
    accepts: isQueryLocator,
    paramsSchema: closedParamsSchema({
      maxRows: { type: 'number', optional: true },
      // P6 (plans/observatory-ux-implementation-spec-20260728.md §3 P6): the
      // row-activation door. NO default value — absent means "not
      // drillable", never an inferred 'item'. `mount()` below passes this
      // straight through to `<sh-sparql-table-view>.subjectColumn` unchanged.
      subjectField: { type: 'string', optional: true },
    }),
    constraints: sparqlBindingsTableConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      const store = lease.value as SurfaceResourceStore<QueryBlockResult>

      const view = document.createElement('sh-sparql-table-view') as ShSparqlTableView
      view.tabIndex = 0
      view.status = 'loading'
      // P6: `subjectField` names a column of this leaf's OWN result whose
      // values are subject IRIs — absent means not drillable (paramsSchema's
      // own comment above), never an inferred 'item'.
      const params = descriptor.params as { readonly subjectField?: string } | undefined
      view.subjectColumn = params?.subjectField ?? ''

      target.replaceChildren(view)

      let disposed = false
      const applyResult = (result: QueryBlockResult): void => {
        view.queryKind = result.queryKind
        view.durationMs = result.durationMs
        if (result.resultKind === 'bindings' || result.resultKind === 'ask') {
          const cap = displayMaxRows(descriptor)
          view.status = 'ready'
          view.columns = result.columns
          view.rows = result.rows.slice(0, cap)
        } else {
          // CONSTRUCT/DESCRIBE ('serialized') is not a bindings table — an
          // honest error, not a fabricated empty table.
          view.status = 'error'
          view.error = `sparql.bindings-table only renders SELECT/ASK results (got a ${result.resultKind} result)`
        }
      }
      const applyState = (state: StoreState<QueryBlockResult>): void => {
        if (disposed) return
        view.dataset.resourceState = state.status
        if (state.read !== null) {
          applyResult(state.read)
          if (state.status === 'ready') delete view.dataset.resourceStale
          else view.dataset.resourceStale = 'true'
          return
        }
        delete view.dataset.resourceStale
        if (state.status === 'error') {
          view.status = 'error'
          view.error = state.error ?? 'Unable to load this resource.'
        } else {
          view.status = 'loading'
        }
      }
      const unsubscribe = observeSurfaceResourceStore(store, applyState)
      await store.refresh()

      const faceView: FaceView = {
        focus(_request) {
          view.focus()
          return true
        },
        blur() {
          view.blur()
        },
        resize() {
          // <sh-sparql-table-view>'s :host fills 100%/100% via CSS; the
          // interpreter already sized `target`. MUST NOT write layout state
          // (design §3.2) — no-op.
        },
        serialize(): ViewDescriptor {
          return descriptor
        },
        dispose() {
          if (disposed) return
          disposed = true
          unsubscribe()
          view.remove()
        },
      }
      return faceView
    },
  }
}

// Re-exported for callers that want to format a term the SAME way this face
// does without depending on `@shrubbery/runtime`'s full editor-services
// barrel (mirrors `media-face.ts`'s `artifactIri`/`parseArtifactIri` pattern
// of exposing the small pure helpers a caller needs alongside the face).
export { formatQueryBlockTerm }
export type { QueryBlockResult, QueryBlockService }
