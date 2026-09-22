import { NamedQueryRegistry, type NamedQueryDefinition } from '@shrubbery/runtime/layout'

export const OBS_QUERY = {
  freshness: 'urn:sophia:query:obs.projection-run-latest-watermark',
  activeRuns: 'urn:sophia:query:obs.fleet-active-runs',
  failedRuns: 'urn:sophia:query:obs.fleet-failed-runs-and-final-flushes',
  coldStartP95: 'urn:sophia:query:obs.fleet-cold-start-p95-ms',
  estimatedComputeUsd: 'urn:sophia:query:obs.capacity-estimated-compute-usd',
  dauOverTime: 'urn:sophia:query:obs.metric-billing-llm-dau-over-time',
  activityByKind: 'urn:sophia:query:obs.raw-activity-by-kind',
  recentMachineRuns: 'urn:sophia:query:obs.recent-machine-runs',
  sequenceGaps: 'urn:sophia:query:obs.sequence-gaps',
} as const

const OBS = 'http://mnemosyne.dev/observatory#'
const MACH = 'http://mnemosyne.dev/machine#'
const ROLLUPS = 'urn:mnemosyne:local:graph:{{graphId}}:projection:obs:rollups'
const RAW = 'urn:mnemosyne:local:graph:{{graphId}}:projection:obs:raw'
const DAU_METRIC_IRI = 'urn:sophia:observatory:metric:billing_llm_dau_v1'

export const OBSERVATORY_NAMED_QUERIES: readonly NamedQueryDefinition[] = [
  {
    name: OBS_QUERY.freshness,
    description: 'Latest projection watermark.',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?value WHERE {
  GRAPH <${ROLLUPS}> {
    ?run a obs:ProjectionRun ; obs:projectedThrough ?value .
  }
} ORDER BY DESC(?value) LIMIT 1`,
  },
  {
    name: OBS_QUERY.activeRuns,
    description: 'Latest active fleet run count.',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?value WHERE {
  GRAPH <${ROLLUPS}> {
    ?fo a obs:FleetObservation ; obs:asOf ?asOf ; obs:activeRuns ?value .
  }
} ORDER BY DESC(?asOf) LIMIT 1`,
  },
  {
    name: OBS_QUERY.failedRuns,
    description: 'Latest failed runs and final flushes.',
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
    name: OBS_QUERY.coldStartP95,
    description: 'Latest fleet cold-start p95.',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?value WHERE {
  GRAPH <${ROLLUPS}> {
    ?fo a obs:FleetObservation ; obs:asOf ?asOf ; obs:coldStartP95Ms ?value .
  }
} ORDER BY DESC(?asOf) LIMIT 1`,
  },
  {
    name: OBS_QUERY.estimatedComputeUsd,
    description: 'Latest estimated compute cost.',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?value WHERE {
  GRAPH <${ROLLUPS}> {
    ?ce a obs:CapacityEstimate ; obs:asOf ?asOf ; obs:estimatedComputeUsd ?value .
  }
} ORDER BY DESC(?asOf) LIMIT 1`,
  },
  {
    name: OBS_QUERY.dauOverTime,
    description: 'Daily active users over time.',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?windowStart ?value WHERE {
  {
    SELECT ?logicalId (MAX(?computedAt) AS ?latestComputedAt) WHERE {
      GRAPH <${ROLLUPS}> {
        ?obs a obs:MetricObservation ;
             obs:metricDefinition <${DAU_METRIC_IRI}> ;
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
    name: OBS_QUERY.activityByKind,
    description: 'Raw activity grouped by event kind.',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?kind (COUNT(*) AS ?count) WHERE {
  GRAPH <${RAW}> {
    ?event obs:kind ?kind .
  }
} GROUP BY ?kind ORDER BY DESC(?count)`,
  },
  {
    name: OBS_QUERY.recentMachineRuns,
    description: 'Most recent machine runs.',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?graphId ?runId ?runState ?startedAt ?runtimeMs ?bootMode WHERE {
  GRAPH <${ROLLUPS}> {
    ?run a mach:MachineRun ;
         obs:graphId ?graphId ;
         obs:runId ?runId ;
         mach:runState ?runState ;
         obs:startedAt ?startedAt ;
         obs:runtimeMs ?runtimeMs ;
         obs:bootMode ?bootMode ;
         obs:firstObservedAt ?firstObservedAt .
  }
} ORDER BY DESC(?firstObservedAt) LIMIT 50`,
  },
  {
    name: OBS_QUERY.sequenceGaps,
    description: 'Sequence-gap witnesses.',
    text: `PREFIX obs: <${OBS}>
PREFIX mach: <${MACH}>
SELECT ?item WHERE {
  GRAPH <${ROLLUPS}> {
    ?item a obs:SequenceGap .
  }
}`,
  },
]

export function createObservatoryNamedQueryRegistry(): NamedQueryRegistry {
  const registry = new NamedQueryRegistry()
  for (const definition of OBSERVATORY_NAMED_QUERIES) registry.register(definition)
  registry.seal()
  return registry
}
