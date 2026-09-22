/**
 * observatory-surface-document.ts — the Observatory as ONE tabs-composed
 * `LayoutDocument` (P7, plans/observatory-ux-implementation-spec-20260728.md
 * §3 P7). Pulse / Fleet / Capture live as three subtrees under one `tabs`
 * root (`ObsPages`), every query is a catalogue NAME (`@shrubbery/runtime`'s
 * `NamedQueryRegistry` grammar via `observatory-surface-query-catalog.ts`),
 * no stat cell renders absence as `0` (P4's `no-data` — this file adds
 * nothing there, it just never sets a literal `0`), and the Fleet runs table
 * carries a drill-down door (`subjectField:'item'`, P6).
 *
 * Consumes exactly what P1/P2/P4/P6 shipped, not an earlier draft:
 *   - P1's tab shape: `LayoutTab{nodeId,label}` + `LayoutTabsNode.activeNodeId`
 *     + `tabsRevision` — NOT `{id,title,nodeId}` + `activeTabIndex`.
 *   - P2's `urn:sophia:query:*` grammar — every `queryId` below is a NAME,
 *     never raw SPARQL text (checked by `named-query-audit.ts`'s
 *     `findRawQueryLocators`, see this file's own test).
 *   - P4's `no-data` confession lives entirely in `stat-scalar-face.ts`; this
 *     file only has to avoid ever hard-coding a fabricated value, which it
 *     does by construction (every stat cell's value comes from a query).
 *
 * There is NO `ObsGovernor` leaf — ruling 3 (plans/observatory-ux-
 * implementation-spec-20260728.md §1): "a fragment cannot speak for the
 * page." The freshness governor is page chrome (P3's DOM controller), never
 * a node in this document.
 *
 * The builder is pure, deep-frozen, and a function of its own argument only
 * — no shared mutable singleton (mirrors `buildObservatoryDashboardDocument`,
 * `observatory-dashboard-document.ts`, this repo's own established pattern
 * for a canned/fallback `LayoutDocument`).
 */
import { deepFreeze, type LayoutDocument, type ViewDescriptor } from '@shrubbery/nucleus/layout'
import { OBS_SURFACE_QUERY } from './observatory-surface-query-catalog.js'

const OBS = 'http://mnemosyne.dev/observatory#'

/** The default cell/store this document targets when no `graphId` is supplied — mirrors `observatory-dashboard-document.ts`'s own `GRAPH_ID`. */
export const OBSERVATORY_SURFACE_DEFAULT_GRAPH_ID = 'observatory'

export const OBSERVATORY_SURFACE_LAYOUT_ID = 'observatory-surface-v1'

/**
 * Poll cadence for the five stat.scalar cells per page — spec §3 P7 Contract:
 * "Every stat/chart descriptor carries refreshSeconds (300 stats, 600
 * charts)." The projector CronJob runs hourly; 300s bounds display staleness
 * to five minutes past data staleness for the cheap scalar reads.
 */
export const OBSERVATORY_SURFACE_STAT_REFRESH_SECONDS = 300
/**
 * Poll cadence for chart.vega-lite cells and the sequence-gaps collection —
 * the same 600s the document table gives `ObsPulseGaps` explicitly; grouped
 * here with charts because both are heavier renders than a scalar tile.
 */
export const OBSERVATORY_SURFACE_CHART_REFRESH_SECONDS = 600

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

function statCell(
  id: string,
  graphId: string,
  queryName: string,
  label: string,
  format: 'number' | 'usd' | 'ms' | 'dateTimeRelative',
): { readonly id: string; readonly descriptor: ViewDescriptor } {
  return {
    id,
    descriptor: queryDescriptor(graphId, 'stat.scalar', queryName, {
      label,
      format,
      refreshSeconds: OBSERVATORY_SURFACE_STAT_REFRESH_SECONDS,
    }),
  }
}

/**
 * Build the "observatory surface v1" tabs-composed `LayoutDocument`: one
 * `tabs` root (`ObsPages`) holding three page subtrees (Pulse / Fleet /
 * Capture), each a vertical split of a stat/chart grid over its own
 * table/collection. `deepFreeze`d fresh on every call — never a mutable
 * shared singleton.
 *
 * @param graphId The cell/store this document's locators and named-graph IRIs
 *   target (resolved later, inside `compute()`, by the named-query resolver
 *   — never at document-build time; ruling 4). Defaults to
 *   `OBSERVATORY_SURFACE_DEFAULT_GRAPH_ID`.
 */
export function buildObservatorySurfaceDocument(graphId: string = OBSERVATORY_SURFACE_DEFAULT_GRAPH_ID): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: OBSERVATORY_SURFACE_LAYOUT_ID,
    scope: 'workspace',
    graphId,
    rootNodeId: 'ObsPages',
    nodes: {
      ObsPages: {
        kind: 'tabs',
        id: 'ObsPages',
        tabs: [
          { nodeId: 'ObsPulse', label: 'Pulse' },
          { nodeId: 'ObsFleet', label: 'Fleet' },
          { nodeId: 'ObsCapture', label: 'Capture' },
        ],
        activeNodeId: 'ObsPulse',
        tabsRevision: 0,
      },

      // ── Pulse — "Is the platform alive, and is this page telling the truth?" ──
      ObsPulse: {
        kind: 'split',
        id: 'ObsPulse',
        axis: 'vertical',
        startNodeId: 'ObsPulseStats',
        endNodeId: 'ObsPulseGaps',
        startBasisPoints: 7000,
      },
      ObsPulseStats: {
        kind: 'grid',
        id: 'ObsPulseStats',
        flow: 'reflow',
        minCellWidth: 220,
        gridRevision: 0,
        children: {
          kind: 'fixed',
          cells: [
            statCell('dau', graphId, OBS_SURFACE_QUERY.dau, 'DAU', 'number'),
            statCell('active-runs', graphId, OBS_SURFACE_QUERY.activeRuns, 'Active runs', 'number'),
            statCell('failed-runs', graphId, OBS_SURFACE_QUERY.failedRuns, 'Failed runs / failed final flushes', 'number'),
            statCell('cold-start-p95', graphId, OBS_SURFACE_QUERY.coldStartP95Pulse, 'Cold-start p95', 'ms'),
            statCell('compute-usd', graphId, OBS_SURFACE_QUERY.computeUsd, 'Estimated compute cost', 'usd'),
            {
              id: 'dau-chart',
              span: 2,
              descriptor: queryDescriptor(graphId, 'chart.vega-lite', OBS_SURFACE_QUERY.dauSeries, {
                mark: 'bar',
                xField: 'windowStart',
                yField: 'value',
                title: 'DAU over time (usage_dau_v1)',
                refreshSeconds: OBSERVATORY_SURFACE_CHART_REFRESH_SECONDS,
              }),
            },
            {
              id: 'kind-chart',
              span: 2,
              descriptor: queryDescriptor(graphId, 'chart.vega-lite', OBS_SURFACE_QUERY.activityByKind, {
                mark: 'bar',
                xField: 'kind',
                yField: 'count',
                title: '72h activity by kind',
                refreshSeconds: OBSERVATORY_SURFACE_CHART_REFRESH_SECONDS,
              }),
            },
          ],
        },
      },
      ObsPulseGaps: {
        kind: 'grid',
        id: 'ObsPulseGaps',
        flow: 'reflow',
        minCellWidth: 260,
        gridRevision: 0,
        children: {
          kind: 'collection',
          collection: { kind: 'query', graphId, queryId: OBS_SURFACE_QUERY.sequenceGaps },
          itemFaceId: 'card.subject',
          itemParams: {
            titleField: `${OBS}witness`,
            fields: `${OBS}expectedSeq,${OBS}observedSeq,${OBS}gapCount`,
            graphIri: graphId,
          },
          maxItems: 20,
          refreshSeconds: OBSERVATORY_SURFACE_CHART_REFRESH_SECONDS,
        },
      },

      // ── Fleet — "What are the cells doing?" ────────────────────────────────
      ObsFleet: {
        kind: 'split',
        id: 'ObsFleet',
        axis: 'vertical',
        startNodeId: 'ObsFleetStats',
        endNodeId: 'ObsFleetRuns',
        startBasisPoints: 3000,
      },
      ObsFleetStats: {
        kind: 'grid',
        id: 'ObsFleetStats',
        flow: 'reflow',
        minCellWidth: 220,
        gridRevision: 0,
        children: {
          kind: 'fixed',
          cells: [
            statCell('cold-start-p50', graphId, OBS_SURFACE_QUERY.coldStartP50Fleet, 'Cold-start p50', 'ms'),
            statCell('cold-start-p95', graphId, OBS_SURFACE_QUERY.coldStartP95Fleet, 'Cold-start p95', 'ms'),
            statCell('hydrate-p50', graphId, OBS_SURFACE_QUERY.hydrateP50, 'Hydrate p50', 'ms'),
            statCell('hydrate-p95', graphId, OBS_SURFACE_QUERY.hydrateP95, 'Hydrate p95', 'ms'),
            statCell('spawn-unmaterialized', graphId, OBS_SURFACE_QUERY.spawnUnmaterialized, 'Spawn attempts never materialized', 'number'),
          ],
        },
      },
      ObsFleetRuns: {
        kind: 'leaf',
        id: 'ObsFleetRuns',
        descriptor: queryDescriptor(graphId, 'sparql.bindings-table', OBS_SURFACE_QUERY.recentRuns, {
          maxRows: 50,
          subjectField: 'item',
        }),
        descriptorRevision: 0,
      },

      // ── Capture — "Is the self-knowledge system itself healthy?" ──────────
      ObsCapture: {
        kind: 'split',
        id: 'ObsCapture',
        axis: 'vertical',
        startNodeId: 'ObsCaptureRuns',
        endNodeId: 'ObsCaptureLower',
        startBasisPoints: 4500,
      },
      ObsCaptureRuns: {
        kind: 'leaf',
        id: 'ObsCaptureRuns',
        descriptor: queryDescriptor(graphId, 'sparql.bindings-table', OBS_SURFACE_QUERY.projectionRuns, { maxRows: 50 }),
        descriptorRevision: 0,
      },
      ObsCaptureLower: {
        kind: 'split',
        id: 'ObsCaptureLower',
        axis: 'vertical',
        startNodeId: 'ObsCaptureRedelivery',
        endNodeId: 'ObsCaptureFailures',
        startBasisPoints: 3000,
      },
      ObsCaptureRedelivery: {
        kind: 'grid',
        id: 'ObsCaptureRedelivery',
        flow: 'reflow',
        minCellWidth: 220,
        gridRevision: 0,
        children: {
          kind: 'fixed',
          cells: [
            statCell('line-count', graphId, OBS_SURFACE_QUERY.lineCount, 'Capture ledger lines (72h)', 'number'),
            statCell('unique-count', graphId, OBS_SURFACE_QUERY.uniqueCount, 'Unique captured events', 'number'),
            statCell('redelivery-permille', graphId, OBS_SURFACE_QUERY.redeliveryPermille, 'Redelivery rate (‰)', 'number'),
          ],
        },
      },
      ObsCaptureFailures: {
        kind: 'leaf',
        id: 'ObsCaptureFailures',
        descriptor: queryDescriptor(graphId, 'sparql.bindings-table', OBS_SURFACE_QUERY.evaluationFailures, { maxRows: 50 }),
        descriptorRevision: 0,
      },
    },
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
  })
}
