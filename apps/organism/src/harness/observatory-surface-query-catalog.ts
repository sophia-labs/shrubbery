/**
 * observatory-surface-query-catalog.ts — the nineteen named queries behind the
 * tabs-composed "Observatory as ONE surface" document (P7,
 * plans/observatory-ux-implementation-spec-20260728.md §3 P7). Extends P2's
 * URN grammar (`urn:sophia:query:*`, the SAME `{{graphId}}` template
 * discipline, the SAME `NamedQueryRegistry`) with a SEPARATE, sealed registry
 * — this is a distinct catalogue from `observatory-query-catalog.ts`'s nine
 * (Stage 0 / the canned v0 dashboard), not a superset or a replacement of it.
 * v0's fallback keeps consuming its own nine; nothing here is imported there.
 *
 * PROVENANCE (read before touching a query body):
 *   - Six queries — `activeRuns`, `failedRuns`, `coldStartP95` (used under BOTH
 *     `obs.pulse.cold-start-p95` and `obs.fleet.cold-start-p95` — two distinct
 *     catalogue NAMES, byte-identical TEXT, by design: Pulse wants one fleet-
 *     health summary stat, Fleet wants the full percentile breakdown),
 *     `estimatedComputeUsd`, `activityByKind`, `sequenceGaps` — are copied
 *     BYTE-FOR-BYTE from `observatory-query-catalog.ts`'s own nine (the spec's
 *     own words: "the six Pulse queries that are already correct come across
 *     verbatim"), with only the graph-iri interpolation swapped from this
 *     file's runtime `${rollupsGraphIri(graphId)}` call to the sealed
 *     registry's `{{graphId}}` template token (P2's substitution grammar,
 *     resolved by `NamedQueryRegistry.resolve`, never at document-build time).
 *   - `dau`/`dau-series` reference `urn:sophia:observatory:metric:usage_dau_v1`
 *     — NOT `billing_llm_dau_v1` (v0's metric, which has no wired source; spec
 *     §3 P7 Contract, verbatim). `dau-series` otherwise reuses v0's
 *     `dauOverTime` MAX(computedAt)-per-logicalId subquery shape unchanged;
 *     `dau` adapts the SAME shape to a single GLOBAL latest value (MAX across
 *     every logicalId for this metric definition, not one pinned slice) —
 *     deliberately avoiding an unverified slice-string filter (see the
 *     "OPEN GROUNDING GAPS" note below).
 *   - `cold-start-p50`/`cold-start-p95`/`hydrate-p50`/`hydrate-p95` are direct
 *     `obs:FleetObservation` property reads (latest by `obs:asOf`), the exact
 *     shape `coldStartP95` already proves live — grounded in
 *     `plans/observatory-analysis-cell-spec-20260715.md` §A.2's own
 *     `FleetObservation` field list: "obs:coldStartP50Ms/P95Ms,
 *     obs:hydrateP50Ms/P95Ms, ...".
 *   - `recent-runs` is v0's `recentMachineRuns` with the THREE changes the
 *     spec's own P7 Contract names verbatim: the run subject is bound to
 *     `?item` (not `?run`) and projected FIRST — `sparql.bindings-table`'s
 *     `subjectField:'item'` param (the document's own `ObsFleetRuns` cell)
 *     depends on this exact variable name; `obs:bootMode`/`obs:runtimeMs`/
 *     `obs:startedAt` move into `OPTIONAL` blocks (v0's mandatory patterns
 *     silently dropped runs lacking them — the vocab marks all three
 *     optional).
 *   - `projection-runs` orders by `obs:evaluatedAt` (always emitted), never
 *     `obs:projectedThrough` (omitted when the fold saw nothing), and
 *     deliberately never projects `obs:outcome` (a hardcoded constant that
 *     would render as if it were a signal) — both exclusions the spec's own
 *     Contract text, both enforced here with `OPTIONAL` around
 *     `projectedThrough` and no `outcome` variable anywhere in the SELECT.
 *
 * OPEN GROUNDING GAPS (reported here rather than hidden — Rule 1: stop and
 * report a gap, never invent past it). Two reference documents were read in
 * full before writing this file: `plans/observatory-analysis-cell-spec-
 * 20260715.md` §A.2 (the materializer's JSON-MO -> RDF mapping contract, the
 * most authoritative source reachable from this worktree) and `plans/
 * observatory-ux-proposal-20260728.md` §3.2 (the pre-ruling proposal this
 * spec's Pulse/Fleet/Capture reader-questions were carried over from
 * verbatim). Neither document gives the exact predicate/type IRIs for THREE
 * of the nineteen queries below; the ANALOGOUS, best-grounded choice was made
 * in each case and is called out at its query site:
 *   1. `spawn-unmaterialized` — `SpawnAttemptProjection`'s RDF type is never
 *      spelled out (only that it exists, target=rollups, reconcile=logical-id
 *      supersede, mirroring `MachineRunProjection`). This file assumes
 *      `mach:SpawnAttempt` by analogy with `MachineRunProjection` ->
 *      `mach:MachineRun`. UNVERIFIED against the real materializer output.
 *   2. `line-count`/`unique-count`/`redelivery-permille` — the proposal names
 *      `obs:lineCount` and `obs:uniqueEventCount` on "`obs:SourceSnapshot`"
 *      (its own wording) but no ordering/"latest" field. This file assumes
 *      `obs:asOf`, by analogy with `FleetObservation`/`CapacityEstimate` —
 *      the OTHER two "subject-upsert (content-hash)" rollup types (§A.2's own
 *      reconcile-scope table), which both use `obs:asOf`. UNVERIFIED.
 *   3. `evaluation-failures` — `obs:MetricEvaluation`'s failure vocabulary is
 *      never spelled out beyond the type name and "typed error codes"
 *      (proposal prose). This file reuses `obs:computationStatus` (the ONE
 *      predicate confirmed on two OTHER rollup types — `MetricObservation`
 *      and `obs:ProjectionRun`) and filters `!= "ok"`, rather than inventing
 *      unconfirmed `obs:errorCode`/`obs:outcome` predicates. UNVERIFIED, and
 *      the biggest residual risk in this file: if `MetricEvaluation` reuses
 *      `MetricObservation`'s OWN "ok"|"no-data" vocabulary rather than a
 *      distinct evaluation-attempt vocabulary, this filter would also catch
 *      honest empty-window "no-data" rows and mislabel them as failures —
 *      exactly the confusion ruling 3 (CONFESS) exists to prevent. Flagged
 *      for operator verification against a real cell before this cell is
 *      trusted; Gap 5 (no local gardend binary) blocks that here.
 * All three fail SAFE, not silently: an unverified predicate name simply
 * never matches anything, so the cell renders P4's honest `No data` /
 * `sparql.bindings-table`'s empty-table state — never a fabricated value,
 * never a crash.
 *
 * No `obs.pulse.freshness` name exists here — ruling 3 withdrew the governor
 * as a leaf entirely (`ObsGovernor` is DROPPED, plans/observatory-ux-
 * implementation-spec-20260728.md §3 P7: "a fragment cannot speak for the
 * page"); freshness is page chrome (P3), never a document leaf.
 */
import { NamedQueryRegistry, type NamedQueryDefinition } from '@shrubbery/runtime/layout'

export const OBS_SURFACE_QUERY = {
  // Pulse (8)
  dau: 'urn:sophia:query:obs.pulse.dau',
  activeRuns: 'urn:sophia:query:obs.pulse.active-runs',
  failedRuns: 'urn:sophia:query:obs.pulse.failed-runs',
  coldStartP95Pulse: 'urn:sophia:query:obs.pulse.cold-start-p95',
  computeUsd: 'urn:sophia:query:obs.pulse.compute-usd',
  dauSeries: 'urn:sophia:query:obs.pulse.dau-series',
  activityByKind: 'urn:sophia:query:obs.pulse.activity-by-kind',
  sequenceGaps: 'urn:sophia:query:obs.pulse.sequence-gaps',
  // Fleet (6)
  coldStartP50Fleet: 'urn:sophia:query:obs.fleet.cold-start-p50',
  coldStartP95Fleet: 'urn:sophia:query:obs.fleet.cold-start-p95',
  hydrateP50: 'urn:sophia:query:obs.fleet.hydrate-p50',
  hydrateP95: 'urn:sophia:query:obs.fleet.hydrate-p95',
  spawnUnmaterialized: 'urn:sophia:query:obs.fleet.spawn-unmaterialized',
  recentRuns: 'urn:sophia:query:obs.fleet.recent-runs',
  // Capture (5)
  projectionRuns: 'urn:sophia:query:obs.capture.projection-runs',
  lineCount: 'urn:sophia:query:obs.capture.line-count',
  uniqueCount: 'urn:sophia:query:obs.capture.unique-count',
  redeliveryPermille: 'urn:sophia:query:obs.capture.redelivery-permille',
  evaluationFailures: 'urn:sophia:query:obs.capture.evaluation-failures',
} as const

const OBS = 'http://mnemosyne.dev/observatory#'
const MACH = 'http://mnemosyne.dev/machine#'
const ROLLUPS = 'urn:mnemosyne:local:graph:{{graphId}}:projection:obs:rollups'
const RAW = 'urn:mnemosyne:local:graph:{{graphId}}:projection:obs:raw'
/** Spec §3 P7 Contract, verbatim: usage_dau_v1, NOT billing_llm_dau_v1 (the latter has no wired source). */
const USAGE_DAU_METRIC_IRI = 'urn:sophia:observatory:metric:usage_dau_v1'

export const OBSERVATORY_SURFACE_NAMED_QUERIES: readonly NamedQueryDefinition[] = [
  // ── Pulse ──────────────────────────────────────────────────────────────
  {
    name: OBS_SURFACE_QUERY.dau,
    description: 'Latest DAU (usage_dau_v1) — single scalar value, global latest across every logicalId.',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?value WHERE {
  {
    SELECT (MAX(?computedAt) AS ?latestComputedAt) WHERE {
      GRAPH <${ROLLUPS}> {
        ?obs a obs:MetricObservation ;
             obs:metricDefinition <${USAGE_DAU_METRIC_IRI}> ;
             obs:computedAt ?computedAt .
      }
    }
  }
  GRAPH <${ROLLUPS}> {
    ?obs2 a obs:MetricObservation ;
          obs:metricDefinition <${USAGE_DAU_METRIC_IRI}> ;
          obs:computedAt ?latestComputedAt ;
          obs:value ?value .
  }
}`,
  },
  {
    name: OBS_SURFACE_QUERY.activeRuns,
    description: 'Latest active fleet run count (verbatim from Stage 0).',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?value WHERE {
  GRAPH <${ROLLUPS}> {
    ?fo a obs:FleetObservation ; obs:asOf ?asOf ; obs:activeRuns ?value .
  }
} ORDER BY DESC(?asOf) LIMIT 1`,
  },
  {
    name: OBS_SURFACE_QUERY.failedRuns,
    description: 'Latest failed runs and final flushes (verbatim from Stage 0).',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ((?failedRuns + ?failedFinalFlushes) AS ?value) WHERE {
  GRAPH <${ROLLUPS}> {
    ?fo a obs:FleetObservation ; obs:asOf ?asOf ;
        obs:failedRuns ?failedRuns ; obs:failedFinalFlushes ?failedFinalFlushes .
  }
} ORDER BY DESC(?asOf) LIMIT 1`,
  },
  {
    name: OBS_SURFACE_QUERY.coldStartP95Pulse,
    description: 'Latest fleet cold-start p95 (verbatim from Stage 0; the Pulse-page summary copy).',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?value WHERE {
  GRAPH <${ROLLUPS}> {
    ?fo a obs:FleetObservation ; obs:asOf ?asOf ; obs:coldStartP95Ms ?value .
  }
} ORDER BY DESC(?asOf) LIMIT 1`,
  },
  {
    name: OBS_SURFACE_QUERY.computeUsd,
    description: 'Latest estimated compute cost (verbatim from Stage 0; empty until capacity params are wired — a named gap, not an asterisk).',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?value WHERE {
  GRAPH <${ROLLUPS}> {
    ?ce a obs:CapacityEstimate ; obs:asOf ?asOf ; obs:estimatedComputeUsd ?value .
  }
} ORDER BY DESC(?asOf) LIMIT 1`,
  },
  {
    name: OBS_SURFACE_QUERY.dauSeries,
    description: 'DAU (usage_dau_v1) over time — one point per logicalId at its own latest computation.',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?windowStart ?value WHERE {
  {
    SELECT ?logicalId (MAX(?computedAt) AS ?latestComputedAt) WHERE {
      GRAPH <${ROLLUPS}> {
        ?obs a obs:MetricObservation ;
             obs:metricDefinition <${USAGE_DAU_METRIC_IRI}> ;
             obs:logicalId ?logicalId ;
             obs:computedAt ?computedAt .
      }
    } GROUP BY ?logicalId
  }
  GRAPH <${ROLLUPS}> {
    ?obs2 a obs:MetricObservation ;
          obs:logicalId ?logicalId ;
          obs:computedAt ?latestComputedAt ;
          obs:windowStart ?windowStart ;
          obs:value ?value .
  }
} ORDER BY ?windowStart`,
  },
  {
    name: OBS_SURFACE_QUERY.activityByKind,
    description: '72h raw activity grouped by event kind (verbatim from Stage 0).',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?kind (COUNT(*) AS ?count) WHERE {
  GRAPH <${RAW}> {
    ?event obs:kind ?kind .
  }
} GROUP BY ?kind ORDER BY DESC(?count)`,
  },
  {
    name: OBS_SURFACE_QUERY.sequenceGaps,
    description: 'Sequence-gap witnesses (verbatim from Stage 0) — the collection ObsPulseGaps binds via ?item.',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?item WHERE {
  GRAPH <${ROLLUPS}> {
    ?item a obs:SequenceGap .
  }
}`,
  },
  // ── Fleet ──────────────────────────────────────────────────────────────
  {
    name: OBS_SURFACE_QUERY.coldStartP50Fleet,
    description: 'Latest fleet cold-start p50.',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?value WHERE {
  GRAPH <${ROLLUPS}> {
    ?fo a obs:FleetObservation ; obs:asOf ?asOf ; obs:coldStartP50Ms ?value .
  }
} ORDER BY DESC(?asOf) LIMIT 1`,
  },
  {
    name: OBS_SURFACE_QUERY.coldStartP95Fleet,
    description: 'Latest fleet cold-start p95 (byte-identical text to obs.pulse.cold-start-p95 — two catalogue names, one proven query).',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?value WHERE {
  GRAPH <${ROLLUPS}> {
    ?fo a obs:FleetObservation ; obs:asOf ?asOf ; obs:coldStartP95Ms ?value .
  }
} ORDER BY DESC(?asOf) LIMIT 1`,
  },
  {
    name: OBS_SURFACE_QUERY.hydrateP50,
    description: 'Latest fleet hydrate p50.',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?value WHERE {
  GRAPH <${ROLLUPS}> {
    ?fo a obs:FleetObservation ; obs:asOf ?asOf ; obs:hydrateP50Ms ?value .
  }
} ORDER BY DESC(?asOf) LIMIT 1`,
  },
  {
    name: OBS_SURFACE_QUERY.hydrateP95,
    description: 'Latest fleet hydrate p95.',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?value WHERE {
  GRAPH <${ROLLUPS}> {
    ?fo a obs:FleetObservation ; obs:asOf ?asOf ; obs:hydrateP95Ms ?value .
  }
} ORDER BY DESC(?asOf) LIMIT 1`,
  },
  {
    name: OBS_SURFACE_QUERY.spawnUnmaterialized,
    description:
      'Count of spawn attempts never promoted to a machine run (requested-but-never-incarnated). ' +
      'UNVERIFIED type: mach:SpawnAttempt is inferred by analogy with MachineRunProjection -> mach:MachineRun — see this file header.',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT (COUNT(?item) AS ?value) WHERE {
  GRAPH <${ROLLUPS}> {
    ?item a mach:SpawnAttempt .
  }
}`,
  },
  {
    name: OBS_SURFACE_QUERY.recentRuns,
    description:
      'Recent machine runs, subject bound to ?item (the drill-down row identity, projected first); ' +
      'bootMode/runtimeMs/startedAt OPTIONAL (v0 mandatory patterns silently dropped runs lacking them).',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?item ?graphId ?runId ?runState ?startedAt ?runtimeMs ?bootMode WHERE {
  GRAPH <${ROLLUPS}> {
    ?item a mach:MachineRun ;
          obs:graphId ?graphId ;
          obs:runId ?runId ;
          mach:runState ?runState ;
          obs:firstObservedAt ?firstObservedAt .
    OPTIONAL { ?item obs:startedAt ?startedAt }
    OPTIONAL { ?item obs:runtimeMs ?runtimeMs }
    OPTIONAL { ?item obs:bootMode ?bootMode }
  }
} ORDER BY DESC(?firstObservedAt) LIMIT 50`,
  },
  // ── Capture ────────────────────────────────────────────────────────────
  {
    name: OBS_SURFACE_QUERY.projectionRuns,
    description:
      'ProjectionRun history, ordered by obs:evaluatedAt (always emitted) — never obs:projectedThrough ' +
      '(omitted when the fold saw nothing) — and never projecting obs:outcome (a hardcoded constant).',
    text: `PREFIX obs: <${OBS}>
SELECT ?run ?evaluatedAt ?projectedThrough ?computationStatus WHERE {
  GRAPH <${ROLLUPS}> {
    ?run a obs:ProjectionRun ; obs:evaluatedAt ?evaluatedAt .
    OPTIONAL { ?run obs:projectedThrough ?projectedThrough }
    OPTIONAL { ?run obs:computationStatus ?computationStatus }
  }
} ORDER BY DESC(?evaluatedAt) LIMIT 50`,
  },
  {
    name: OBS_SURFACE_QUERY.lineCount,
    description:
      'Latest capture ledger line count (obs:SourceSnapshot). UNVERIFIED ordering field: obs:asOf is ' +
      'inferred by analogy with the other two content-hash-upsert rollup types — see this file header.',
    text: `PREFIX obs: <${OBS}>
SELECT ?value WHERE {
  GRAPH <${ROLLUPS}> {
    ?snap a obs:SourceSnapshot ; obs:asOf ?asOf ; obs:lineCount ?value .
  }
} ORDER BY DESC(?asOf) LIMIT 1`,
  },
  {
    name: OBS_SURFACE_QUERY.uniqueCount,
    description: 'Latest capture ledger unique-event count (obs:SourceSnapshot). Same grounding note as line-count.',
    text: `PREFIX obs: <${OBS}>
SELECT ?value WHERE {
  GRAPH <${ROLLUPS}> {
    ?snap a obs:SourceSnapshot ; obs:asOf ?asOf ; obs:uniqueEventCount ?value .
  }
} ORDER BY DESC(?asOf) LIMIT 1`,
  },
  {
    name: OBS_SURFACE_QUERY.redeliveryPermille,
    description:
      'Redelivery rate in permille: (lineCount - uniqueEventCount) * 1000 / lineCount, on the latest ' +
      'obs:SourceSnapshot (~50% observed on canary per the proposal doc — the dedup contract carrying real weight).',
    text: `PREFIX obs: <${OBS}>
SELECT (ROUND(((?lineCount - ?uniqueCount) * 1000) / ?lineCount) AS ?value) WHERE {
  GRAPH <${ROLLUPS}> {
    ?snap a obs:SourceSnapshot ; obs:asOf ?asOf ; obs:lineCount ?lineCount ; obs:uniqueEventCount ?uniqueCount .
    FILTER(?lineCount > 0)
  }
} ORDER BY DESC(?asOf) LIMIT 1`,
  },
  {
    name: OBS_SURFACE_QUERY.evaluationFailures,
    description:
      'MetricEvaluation rows whose obs:computationStatus is not "ok". UNVERIFIED vocabulary — see this ' +
      'file header for the risk that MetricEvaluation reuses MetricObservation’s ok|no-data axis, in ' +
      'which case this would also catch honest empty windows; flagged for operator verification.',
    text: `PREFIX obs: <${OBS}>
SELECT ?evaluation ?metricDefinition ?evaluatedAt ?computationStatus WHERE {
  GRAPH <${ROLLUPS}> {
    ?evaluation a obs:MetricEvaluation ;
                obs:computationStatus ?computationStatus ;
                obs:evaluatedAt ?evaluatedAt .
    OPTIONAL { ?evaluation obs:metricDefinition ?metricDefinition }
    FILTER(?computationStatus != "ok")
  }
} ORDER BY DESC(?evaluatedAt) LIMIT 50`,
  },
]

/** A fresh, sealed registry holding exactly the 19 `OBSERVATORY_SURFACE_NAMED_QUERIES`. */
export function createObservatorySurfaceNamedQueryRegistry(): NamedQueryRegistry {
  const registry = new NamedQueryRegistry()
  for (const definition of OBSERVATORY_SURFACE_NAMED_QUERIES) registry.register(definition)
  registry.seal()
  return registry
}
