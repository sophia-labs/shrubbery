/**
 * observatory-dashboard-document.ts — the "observatory surface v0" canned
 * `LayoutDocument` (Wave 2 / Lane B spec
 * `plans/surface-wave2-laneb-slice-20260716.md` §5, open decision 1: "a
 * canned layout-document JSON shipped with the app... graduating to
 * graph-persisted the moment D1/D2 lands").
 *
 * Pure JSON-serializable data — `buildObservatoryDashboardDocument(graphId)`
 * has no side effects and returns a freshly `createValidatedLayoutDocument`-
 * checked document every call (deep-cloned + deep-frozen, per that
 * function's own contract). Every leaf/cell query below targets the TWO
 * reserved graphs the observatory materializer writes for THAT graph id
 * (`plans/observatory-analysis-cell-spec-20260715.md`, spec §1's own
 * "grounding facts"):
 *   - `:projection:obs:raw`     — the bounded 72h CaptureEvent ledger.
 *   - `:projection:obs:rollups` — the durable, per-subject-upserted rollups
 *     (`FleetObservation`, `CapacityEstimate`, `MetricObservation`,
 *     `MachineRun`, `SequenceGap`, `ProjectionRun`, ...).
 *
 * The two `chart.vega-lite` cells below (`dau-chart`, `kind-chart`) render
 * through the house Vega-Lite theme (`packages/runtime/src/editor-services/
 * vega-theme.ts`'s `buildVegaTheme`) with NO theme authoring of their own —
 * that in-repo default is required to make both conform (recessive grids,
 * 4px rounded bar ends, the validated categorical palette, tabular figures,
 * light AND dark) with zero graph-authored `ux:vegaTheme`. See
 * `apps/organism/seeds/observatory-vega-theme.README.md` for the OPTIONAL
 * override convention, were a graph ever to want one.
 *
 * PARAMETERIZED BY `graphId` (grid-laneb hosted-dashboard review WRONG
 * finding 1): earlier revisions hard-coded every locator/named-graph to the
 * literal `'observatory'` cell, which meant `observatory-layout-source.ts`'s
 * fallback silently queried "observatory" while the page chrome claimed a
 * fallback for whatever `?graph=` the caller actually requested. Every
 * locator/named-graph IRI below is now derived from the caller's `graphId` —
 * the default parameter (`GRAPH_ID`, `'observatory'`) preserves the existing
 * behavior for callers that don't pass one (`observatory-dashboard-main.ts`'s
 * local harness).
 *
 * `queryId` is a named-query URN resolved by the sealed runtime catalogue;
 * every query below is scoped with an explicit `GRAPH <iri> { ... }` clause
 * naming one of the two reserved graphs above.
 *
 * `ResourceLocator.query.graphId` throughout this file is the CELL's own
 * graph identity (the same `graphId` this builder was called with) — the
 * same routing value every other locator kind's `graphId` field carries
 * (`document`, `graph`, `chat`) — NOT an RDF named-graph IRI. Named-graph
 * scoping within that one cell/store happens entirely inside the SPARQL text
 * via `GRAPH <full-iri> { ... }`, per this file's queries below.
 */
import { deepFreeze, type LayoutDocument, type ViewDescriptor } from '@shrubbery/nucleus/layout'
import { createObservatoryNamedQueryRegistry, OBS_QUERY } from './observatory-query-catalog.js'

const OBS = 'http://mnemosyne.dev/observatory#'

/** The DEFAULT cell/store this dashboard targets when no `graphId` is supplied — matches the materializer's own `graph_identity::GRAPH_ID`. */
export const GRAPH_ID = 'observatory'

/**
 * The poll cadence every refreshable cell carries. The projector CronJob runs
 * hourly, so 300s bounds DISPLAY staleness to five minutes past DATA staleness
 * while costing ~8 SPARQL queries/minute across the dashboard — no worse than
 * the burst this page already issues on every mount. `sparql.bindings-table`
 * has NO `refreshSeconds` param (its adapter resolves at acquire time, not
 * through a QueryHandle), so ObsRunsTable stays load-once; adding the key there
 * would FAIL the closed params schema and invalidate the whole document.
 */
export const OBSERVATORY_REFRESH_SECONDS = 300

// `graph_subject(graph_id) = urn:mnemosyne:local:graph:<graph_id>` (garden's
// `rdf.rs`) — re-derived verbatim rather than imported, since this file has
// no dependency on the Rust crate; `graph_identity.rs`'s own
// `raw_graph_iri`/`rollups_graph_iri` are the ground truth these mirror.
/** The `:projection:obs:raw` named-graph IRI for a given cell `graphId`. */
export const rawGraphIri = (graphId: string): string => `urn:mnemosyne:local:graph:${graphId}:projection:obs:raw`
/** The `:projection:obs:rollups` named-graph IRI for a given cell `graphId`. */
export const rollupsGraphIri = (graphId: string): string =>
  `urn:mnemosyne:local:graph:${graphId}:projection:obs:rollups`

const CATALOG = createObservatoryNamedQueryRegistry()

function queryDescriptor(
  graphId: string,
  faceId: string,
  queryName: string,
  params?: Readonly<Record<string, unknown>>,
): ViewDescriptor {
  return {
    schemaVersion: 1,
    faceId,
    resource: { kind: 'query', graphId, queryId: queryName },
    ...(params ? { params } : {}),
  }
}

/**
 * Build the "observatory surface v0" `LayoutDocument`: a vertical split —
 * the fixed stat/chart grid (7 cells) above a lower vertical split of the
 * recent-machine-runs table above the sequence-gaps collection grid (spec
 * §5's three components). `deepFreeze`d fresh on every call — mirrors
 * `layout-workbench-main.ts`'s own initial-document construction (a plain
 * object literal + `deepFreeze`, never a mutable shared singleton); full
 * mount-time validity (face registration, grid eligibility) is the REAL
 * registry's own concern at `reconcile()` time, not this pure builder's.
 *
 * @param graphId The cell/store this dashboard's locators and named-graph
 *   IRIs target — defaults to `GRAPH_ID` (`'observatory'`) for callers that
 *   render the single local-harness cell. `observatory-layout-source.ts`'s
 *   fallback passes the ACTUAL requested graph id here so the canned
 *   document it returns queries the same graph the page chrome says it
 *   fell back for (grid-laneb hosted-dashboard review WRONG finding 1).
 */
export function buildObservatoryDashboardDocument(graphId: string = GRAPH_ID): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'observatory-dashboard-v0',
    scope: 'session',
    graphId,
    rootNodeId: 'ObsRoot',
    nodes: {
      ObsRoot: {
        kind: 'split',
        id: 'ObsRoot',
        axis: 'vertical', // top-to-bottom (design's own axis-naming convention)
        startNodeId: 'ObsStatsGrid',
        endNodeId: 'ObsLower',
        startBasisPoints: 4200,
      },
      ObsLower: {
        kind: 'split',
        id: 'ObsLower',
        axis: 'vertical',
        startNodeId: 'ObsRunsTable',
        endNodeId: 'ObsGapsGrid',
        startBasisPoints: 6000,
      },
      ObsStatsGrid: {
        kind: 'grid',
        id: 'ObsStatsGrid',
        flow: 'reflow',
        minCellWidth: 220,
        gridRevision: 0,
        children: {
          kind: 'fixed',
          cells: [
            {
              id: 'freshness',
              descriptor: queryDescriptor(graphId, 'stat.scalar', OBS_QUERY.freshness, {
                label: 'Freshness (projected through)',
                format: 'dateTimeRelative',
                refreshSeconds: OBSERVATORY_REFRESH_SECONDS,
              }),
            },
            {
              id: 'active-runs',
              descriptor: queryDescriptor(graphId, 'stat.scalar', OBS_QUERY.activeRuns, {
                label: 'Active runs',
                format: 'number',
                refreshSeconds: OBSERVATORY_REFRESH_SECONDS,
              }),
            },
            {
              id: 'failed-runs',
              descriptor: queryDescriptor(graphId, 'stat.scalar', OBS_QUERY.failedRuns, {
                label: 'Failed runs / failed final flushes',
                format: 'number',
                refreshSeconds: OBSERVATORY_REFRESH_SECONDS,
              }),
            },
            {
              id: 'cold-start-p95',
              descriptor: queryDescriptor(graphId, 'stat.scalar', OBS_QUERY.coldStartP95, {
                label: 'Cold-start p95',
                format: 'ms',
                refreshSeconds: OBSERVATORY_REFRESH_SECONDS,
              }),
            },
            {
              id: 'estimated-compute-usd',
              descriptor: queryDescriptor(graphId, 'stat.scalar', OBS_QUERY.estimatedComputeUsd, {
                label: 'Estimated compute cost',
                format: 'usd',
                refreshSeconds: OBSERVATORY_REFRESH_SECONDS,
              }),
            },
            {
              id: 'dau-chart',
              span: 2,
              descriptor: queryDescriptor(graphId, 'chart.vega-lite', OBS_QUERY.dauOverTime, {
                mark: 'bar',
                xField: 'windowStart',
                yField: 'value',
                title: 'DAU over time (billing_llm_dau_v1)',
                refreshSeconds: OBSERVATORY_REFRESH_SECONDS,
              }),
            },
            {
              id: 'kind-chart',
              span: 2,
              descriptor: queryDescriptor(graphId, 'chart.vega-lite', OBS_QUERY.activityByKind, {
                mark: 'bar',
                xField: 'kind',
                yField: 'count',
                title: '72h activity by kind',
                refreshSeconds: OBSERVATORY_REFRESH_SECONDS,
              }),
            },
          ],
        },
      },
      ObsRunsTable: {
        kind: 'leaf',
        id: 'ObsRunsTable',
        descriptor: queryDescriptor(graphId, 'sparql.bindings-table', OBS_QUERY.recentMachineRuns, { maxRows: 50 }),
        descriptorRevision: 0,
      },
      ObsGapsGrid: {
        kind: 'grid',
        id: 'ObsGapsGrid',
        flow: 'reflow',
        minCellWidth: 260,
        gridRevision: 0,
        children: {
          kind: 'collection',
          collection: { kind: 'query', graphId, queryId: OBS_QUERY.sequenceGaps },
          itemFaceId: 'card.subject',
          // Full predicate IRIs, never CURIEs — card-subject-face.ts's own
          // header: "match a real ?p binding's EXACT predicate IRI text
          // (never a compacted form)". `graphIri` is the CELL graph id
          // (this builder's `graphId` parameter), not an RDF named-graph IRI
          // — see this file's header.
          itemParams: {
            titleField: `${OBS}witness`,
            fields: `${OBS}expectedSeq,${OBS}observedSeq,${OBS}gapCount`,
            graphIri: graphId,
          },
          maxItems: 20,
          refreshSeconds: OBSERVATORY_REFRESH_SECONDS,
        },
      },
    },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  })
}

// Exported for the e2e proof's own SPARQL sanity checks (run directly
// against the cell via MCP, independent of the browser-side faces) and for
// documentation — never mutated. A function of `graphId` for the same reason
// `buildObservatoryDashboardDocument` is (defaults to `GRAPH_ID`).
export function observatoryDashboardQueries(graphId: string = GRAPH_ID) {
  return Object.freeze({
    freshness: CATALOG.resolve(OBS_QUERY.freshness, graphId),
    activeRuns: CATALOG.resolve(OBS_QUERY.activeRuns, graphId),
    failedRuns: CATALOG.resolve(OBS_QUERY.failedRuns, graphId),
    coldStartP95: CATALOG.resolve(OBS_QUERY.coldStartP95, graphId),
    estimatedComputeUsd: CATALOG.resolve(OBS_QUERY.estimatedComputeUsd, graphId),
    dauOverTime: CATALOG.resolve(OBS_QUERY.dauOverTime, graphId),
    activityByKind: CATALOG.resolve(OBS_QUERY.activityByKind, graphId),
    recentMachineRuns: CATALOG.resolve(OBS_QUERY.recentMachineRuns, graphId),
    sequenceGaps: CATALOG.resolve(OBS_QUERY.sequenceGaps, graphId),
  })
}

/** @deprecated Back-compat alias for `observatoryDashboardQueries()` at the default `GRAPH_ID` — prefer calling `observatoryDashboardQueries(graphId)` directly. */
export const OBSERVATORY_DASHBOARD_QUERIES = observatoryDashboardQueries()
