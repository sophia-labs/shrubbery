/**
 * observatory-freshness.ts — the freshness governor's PURE core (ruling 3:
 * "staleness: CONFESS"). Reads the latest `obs:ProjectionRun` **whole**
 * (watermark + `evaluatedAt` + outcome) and computes an honest verdict —
 * zero DOM, zero side effects beyond the one `QueryBlockService.run()` call
 * `readLatestProjectionRun` makes on the caller's behalf.
 *
 * Motivating failure (real and recent): the projector died on 2026-07-21 and
 * no surface said so for a week. This module is what would have caught it —
 * `computeFreshnessVerdict` walks `obs:evaluatedAt`'s own age, not any
 * self-reported status field (see fact (b)/(c) below for why).
 *
 * Four load-bearing facts, each with a citation, each of which shapes a
 * decision below:
 *
 * (a) `obs:projectedThrough` is OMITTED, not nulled, when a fold saw no
 *     events (garden `mapping.rs:1191`) — so an absent `projectedThroughRaw`
 *     here is ITSELF a signal ("the last run projected nothing"), never
 *     conflated with "the run doesn't exist" or "the field failed to
 *     parse".
 * (b) `obs:outcome` is a hardcoded `"ok"` (`&'static str`, set at its single
 *     construction site — `projector.rs:283` / `lifecycle/model.rs:281`). It
 *     can never say anything else. This module renders it VERBATIM
 *     (`runLine`) but never lets it influence `tone` — see
 *     `computeFreshnessVerdict`, which never reads `outcomeRaw`.
 * (c) A FAILED projector run publishes NO `obs:ProjectionRun` subject at all
 *     (`run-projector-cronjob.sh:545-562` — the cronjob refuses to publish a
 *     generation on lifecycle failure, since `catch_up` would otherwise
 *     reject the whole bundle including the good raw lane). The only
 *     in-graph signal of an outage is therefore the AGE of the newest
 *     `obs:evaluatedAt` — which is why `observatoryProjectionRunQuery`
 *     orders by `?evaluatedAt`, never by `?projectedThrough` (a run that
 *     projected nothing would be invisible to the latter ordering).
 * (d) The published tone is the WORST of the run's own age and its
 *     watermark's age, because the page's claim to "now" is bounded by
 *     both: a projector that runs on schedule but sees nothing new is lying
 *     just as surely as one that stopped running.
 *
 * **Do not let a builder "improve" this module by branching on
 * `outcomeRaw`.** It is decorative by construction (fact b) — see this
 * module's own tests for the guard pinning that.
 */
import { plainQueryBlockTermValue, type QueryBlockResult, type QueryBlockService } from '@shrubbery/runtime'
import { assertEmbeddableGraphId } from './observatory-layout-source.js'
import { rollupsGraphIri } from './observatory-dashboard-document.js'

export const OBS_NS = 'http://mnemosyne.dev/observatory#'

/** B.3 tone thresholds, keyed to the projector's hourly cadence. */
export const FRESHNESS_WARNING_AFTER_MS = 7_200_000 // 2h
export const FRESHNESS_STALE_AFTER_MS = 86_400_000 // 24h

export type FreshnessTone = 'fresh' | 'warning' | 'stale' | 'unknown'

export const FRESHNESS_TONE_RANK: Readonly<Record<FreshnessTone, number>> = {
  fresh: 0,
  warning: 1,
  stale: 2,
  unknown: 3,
}

/**
 * EVERY predicate the projector puts on `obs:ProjectionRun` — the object
 * read WHOLE (ruling 3). Values are RAW lexical strings, never reformatted:
 * testimony is quoted, not paraphrased. `null` means the predicate is
 * absent, which is itself a signal (`projectedThroughRaw` is OMITTED, not
 * nulled, when the fold saw nothing — fact (a) above).
 */
export interface ProjectionRunObservation {
  readonly runIri: string
  readonly evaluatedAtRaw: string
  readonly asOfRaw: string | null
  readonly projectedThroughRaw: string | null
  readonly cursorHighWaterMarkRaw: string | null
  readonly outcomeRaw: string | null
  readonly computationStatusRaw: string | null
  readonly environmentRaw: string | null
  readonly engineNameRaw: string | null
  readonly engineVersionRaw: string | null
}

export interface FreshnessVerdict {
  readonly tone: FreshnessTone
  readonly stale: boolean // tone !== 'fresh' — THE predicate publishing [data-stale]
  readonly run: ProjectionRunObservation | null
  readonly runAgeMs: number | null
  readonly runTone: FreshnessTone
  readonly watermarkAgeMs: number | null
  readonly watermarkTone: FreshnessTone
  readonly headline: string
  readonly reason: string
  readonly watermarkLine: string
  readonly runLine: string
  readonly failure: string | null // non-null IFF the read failed; tone is then 'unknown'
  readonly observedAtMs: number
}

export class ObservatoryFreshnessError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'ObservatoryFreshnessError'
  }
}

/**
 * The exact SPARQL text this module runs. `GRAPH <iri>` comes from
 * `rollupsGraphIri(graphId)` — the SAME `:projection:obs:rollups` named
 * graph `observatory-dashboard-document.ts`'s own cells read.
 * `assertEmbeddableGraphId` runs FIRST (the platform graph-id grammar,
 * re-used rather than re-derived — see `observatory-layout-source.ts`).
 *
 * `ORDER BY` is on `?evaluatedAt`, NOT `?projectedThrough` as the shipped
 * `freshness` stat cell (`observatory-dashboard-document.ts`'s
 * `freshnessQuery`) uses — a run that projected nothing has no watermark and
 * would be invisible to that ordering (fact (c) above).
 */
export function observatoryProjectionRunQuery(graphId: string): string {
  assertEmbeddableGraphId(graphId)
  const graphIri = rollupsGraphIri(graphId)
  return (
    `PREFIX obs: <${OBS_NS}>\n` +
    `SELECT ?run ?evaluatedAt ?asOf ?projectedThrough ?cursorHighWaterMark ?outcome ?computationStatus ?environment ?engineName ?engineVersion WHERE {\n` +
    `  GRAPH <${graphIri}> {\n` +
    `    ?run a obs:ProjectionRun ;\n` +
    `         obs:evaluatedAt ?evaluatedAt .\n` +
    `    OPTIONAL { ?run obs:asOf ?asOf }\n` +
    `    OPTIONAL { ?run obs:projectedThrough ?projectedThrough }\n` +
    `    OPTIONAL { ?run obs:cursorHighWaterMark ?cursorHighWaterMark }\n` +
    `    OPTIONAL { ?run obs:outcome ?outcome }\n` +
    `    OPTIONAL { ?run obs:computationStatus ?computationStatus }\n` +
    `    OPTIONAL { ?run obs:environment ?environment }\n` +
    `    OPTIONAL { ?run obs:engineName ?engineName }\n` +
    `    OPTIONAL { ?run obs:engineVersion ?engineVersion }\n` +
    `  }\n` +
    `} ORDER BY DESC(?evaluatedAt) LIMIT 1`
  )
}

/**
 * "No run at all" is a state (`null`); a malformed run is an error, never
 * silently coerced. Every optional field falls back through
 * `plainQueryBlockTermValue(...) || null` — an absent OPTIONAL binding
 * yields `''` from that helper, which this collapses to `null` so "absent"
 * and "bound to an empty string" are never conflated with "present".
 */
export function decodeProjectionRunResult(result: QueryBlockResult): ProjectionRunObservation | null {
  if (result.resultKind !== 'bindings') {
    throw new ObservatoryFreshnessError(
      `observatory freshness: expected a SELECT bindings result, got '${result.resultKind}'`,
    )
  }
  if (result.rows.length === 0) return null

  const row = result.rows[0]!
  const runTerm = row.run
  if (runTerm?.type !== 'uri') {
    throw new ObservatoryFreshnessError(
      `observatory freshness: ?run is not a URI term (got ${runTerm ? JSON.stringify(runTerm) : 'no binding'})`,
    )
  }

  const evaluatedAtRaw = plainQueryBlockTermValue(row.evaluatedAt) || null
  if (evaluatedAtRaw == null) {
    throw new ObservatoryFreshnessError(
      `observatory freshness: obs:ProjectionRun <${runTerm.value}> is missing obs:evaluatedAt`,
    )
  }

  return {
    runIri: runTerm.value,
    evaluatedAtRaw,
    asOfRaw: plainQueryBlockTermValue(row.asOf) || null,
    projectedThroughRaw: plainQueryBlockTermValue(row.projectedThrough) || null,
    cursorHighWaterMarkRaw: plainQueryBlockTermValue(row.cursorHighWaterMark) || null,
    outcomeRaw: plainQueryBlockTermValue(row.outcome) || null,
    computationStatusRaw: plainQueryBlockTermValue(row.computationStatus) || null,
    environmentRaw: plainQueryBlockTermValue(row.environment) || null,
    engineNameRaw: plainQueryBlockTermValue(row.engineName) || null,
    engineVersionRaw: plainQueryBlockTermValue(row.engineVersion) || null,
  }
}

export async function readLatestProjectionRun(o: {
  readonly queryService: QueryBlockService
  readonly graphId: string
}): Promise<ProjectionRunObservation | null> {
  const { queryService, graphId } = o
  const query = observatoryProjectionRunQuery(graphId)
  let result: QueryBlockResult
  try {
    result = await queryService.run(graphId, query, 1)
  } catch (error) {
    throw new ObservatoryFreshnessError(
      `observatory freshness: querying obs:ProjectionRun in graph "${graphId}" failed: ` +
        (error instanceof Error ? error.message : String(error)),
      error,
    )
  }
  return decodeProjectionRunResult(result)
}

/** non-finite → `'unknown'`; `< 2h` → `'fresh'` (negatives included — skew is confessed in the line, not the tone); `< 24h` → `'warning'`; else `'stale'`. */
export function toneForAgeMs(ageMs: number): FreshnessTone {
  if (!Number.isFinite(ageMs)) return 'unknown'
  if (ageMs < FRESHNESS_WARNING_AFTER_MS) return 'fresh'
  if (ageMs < FRESHNESS_STALE_AFTER_MS) return 'warning'
  return 'stale'
}

/** Bare magnitude, no "ago": non-finite → `'unknown'`; `<60s` → `Ns`; `<1h` → `Nm`; `<24h` → `Nh`; else `Nd`; negative gets a `-` prefix. */
export function formatAgeMs(ageMs: number): string {
  if (!Number.isFinite(ageMs)) return 'unknown'
  const sign = ageMs < 0 ? '-' : ''
  const magnitude = Math.abs(ageMs)
  if (magnitude < 60_000) return `${sign}${Math.floor(magnitude / 1_000)}s`
  if (magnitude < 3_600_000) return `${sign}${Math.floor(magnitude / 60_000)}m`
  if (magnitude < 86_400_000) return `${sign}${Math.floor(magnitude / 3_600_000)}h`
  return `${sign}${Math.floor(magnitude / 86_400_000)}d`
}

function dateDiffOrNull(nowMs: number, raw: string): number | null {
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? null : nowMs - parsed
}

function worstOf(a: FreshnessTone, b: FreshnessTone): FreshnessTone {
  return FRESHNESS_TONE_RANK[a] >= FRESHNESS_TONE_RANK[b] ? a : b
}

/** `formatAgeMs` plus the "ago"/clock-skew framing shared by `watermarkLine` and `runLine`. */
function formatAgeWithSkew(ageMs: number | null): string {
  if (ageMs == null) return 'unknown'
  const skew = ageMs < 0 ? ' (in the future — clock skew)' : ''
  return `${formatAgeMs(ageMs)} ago${skew}`
}

export function computeFreshnessVerdict(input: {
  readonly run: ProjectionRunObservation | null
  readonly nowMs: number
  readonly graphId: string
  readonly failure?: string | null
}): FreshnessVerdict {
  const { run, nowMs, graphId } = input
  const failure = input.failure ?? null

  const runAgeMs = run ? dateDiffOrNull(nowMs, run.evaluatedAtRaw) : null
  const watermarkAgeMs = run?.projectedThroughRaw ? dateDiffOrNull(nowMs, run.projectedThroughRaw) : null

  const runTone: FreshnessTone = run == null || runAgeMs == null ? 'unknown' : toneForAgeMs(runAgeMs)
  const watermarkTone: FreshnessTone =
    run == null
      ? 'unknown'
      : run.projectedThroughRaw == null
        ? 'warning' // absence IS a signal (fact a)
        : watermarkAgeMs == null
          ? 'unknown'
          : toneForAgeMs(watermarkAgeMs)

  // Worst-of, never a trust in outcomeRaw (fact b — outcomeRaw is NEVER read here).
  const tone: FreshnessTone = failure != null ? 'unknown' : worstOf(runTone, watermarkTone)
  const stale = tone !== 'fresh'

  const headline =
    tone === 'fresh'
      ? 'Fresh — this page is current.'
      : tone === 'warning'
        ? 'LATE — these numbers are not "now".'
        : tone === 'stale'
          ? 'STALE — this page is historical testimony, not the present.'
          : 'UNKNOWN — freshness could not be established; treat every number on this page as unverified.'

  const reason =
    failure != null
      ? failure
      : run == null
        ? `no obs:ProjectionRun exists in <${rollupsGraphIri(graphId)}> — this cell holds no projector run at all`
        : run.projectedThroughRaw == null
          ? 'the last run projected no events (obs:projectedThrough absent)'
          : FRESHNESS_TONE_RANK[watermarkTone] > FRESHNESS_TONE_RANK[runTone]
            ? `the projector ran ${formatAgeMs(runAgeMs ?? Number.NaN)} ago but its event watermark is ${formatAgeMs(watermarkAgeMs ?? Number.NaN)} old — it runs and sees nothing new`
            : `the projector last ran ${formatAgeMs(runAgeMs ?? Number.NaN)} ago; hourly cadence expected`

  const watermarkLine =
    run == null
      ? 'watermark: no obs:ProjectionRun to read a watermark from'
      : run.projectedThroughRaw == null
        ? 'watermark (absent) — the last run projected no events'
        : `watermark ${run.projectedThroughRaw} (${formatAgeWithSkew(watermarkAgeMs)})`

  const runLine =
    run == null
      ? 'run: no obs:ProjectionRun exists'
      : `run ${run.evaluatedAtRaw} (${formatAgeWithSkew(runAgeMs)}) · status ${run.computationStatusRaw ?? '(absent)'} · outcome ${run.outcomeRaw ?? '(absent)'} · env ${run.environmentRaw ?? '(absent)'} · engine ${run.engineNameRaw ?? '(absent)'} ${run.engineVersionRaw ?? '(absent)'}`

  return {
    tone,
    stale,
    run,
    runAgeMs,
    runTone,
    watermarkAgeMs,
    watermarkTone,
    headline,
    reason,
    watermarkLine,
    runLine,
    failure,
    observedAtMs: nowMs,
  }
}
