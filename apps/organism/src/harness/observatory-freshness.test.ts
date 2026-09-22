/**
 * observatory-freshness.test.ts — real, no-mock coverage for the freshness
 * governor's pure core (ruling 3: "staleness: CONFESS").
 *
 * `MemoryRestClient` mirrors the established real-`RestClient`-test-double
 * convention already in this monorepo (`observatory-layout-source.test.ts`'s
 * own `MemoryRestClient` / `query-block-service.test.ts`'s) — a plain class
 * implementing the real `@shrubbery/nucleus` `RestClient` interface, no
 * mocking-library primitives. Payloads below are real SPARQL 1.1 JSON results
 * (`{head:{vars:[...]},results:{bindings:[...]}}`), driven through the REAL
 * `makeQueryBlockService`.
 */
import { describe, expect, it } from 'vitest'
import type { RestClient } from '@shrubbery/nucleus/contract'
import { makeQueryBlockService } from '@shrubbery/runtime'
import {
  FRESHNESS_STALE_AFTER_MS,
  FRESHNESS_WARNING_AFTER_MS,
  ObservatoryFreshnessError,
  computeFreshnessVerdict,
  decodeProjectionRunResult,
  formatAgeMs,
  observatoryProjectionRunQuery,
  readLatestProjectionRun,
  toneForAgeMs,
  type ProjectionRunObservation,
} from './observatory-freshness.js'
import { rollupsGraphIri } from './observatory-dashboard-document.js'

const GRAPH_ID = 'observatory-freshness-test'

/** A real `RestClient` — records every call, answers a caller-supplied payload. No mocking library. */
class MemoryRestClient implements RestClient {
  readonly queries: Array<{ graphId: string; sparql: string }> = []
  constructor(private readonly payload: unknown) {}
  async graphs(): Promise<unknown> {
    throw new Error('not used')
  }
  async query(graphId: string, sparql: string): Promise<unknown> {
    this.queries.push({ graphId, sparql })
    return this.payload
  }
  async update(): Promise<void> {
    throw new Error('not used')
  }
}

const RUN_VARS = [
  'run',
  'evaluatedAt',
  'asOf',
  'projectedThrough',
  'cursorHighWaterMark',
  'outcome',
  'computationStatus',
  'environment',
  'engineName',
  'engineVersion',
] as const

/** A full ten-field `obs:ProjectionRun` binding, real SPARQL 1.1 JSON term shapes. Pass `null` to OMIT a field (mirroring a real OPTIONAL that didn't bind). */
function runBinding(overrides: Partial<Record<(typeof RUN_VARS)[number], string | null>> = {}): Record<string, unknown> {
  const defaults: Record<string, string | null> = {
    run: 'urn:sophia:observatory:run:default',
    evaluatedAt: '2026-07-15T12:00:00.000Z',
    asOf: '2026-07-15T12:00:00.000Z',
    projectedThrough: '2026-07-15T09:00:00.018Z',
    cursorHighWaterMark: 'cursor-abc',
    outcome: 'ok',
    computationStatus: 'ok',
    environment: 'cloud-2-local',
    engineName: 'garden',
    engineVersion: '1.2.3',
  }
  const merged = { ...defaults, ...overrides }
  const binding: Record<string, unknown> = {}
  for (const key of RUN_VARS) {
    const value = merged[key]
    if (value == null) continue
    binding[key] = key === 'run' ? { type: 'uri', value } : { type: 'literal', value }
  }
  return binding
}

/** Real SPARQL 1.1 JSON results envelope. */
function bindingsPayload(bindings: readonly Record<string, unknown>[]): unknown {
  return { head: { vars: [...RUN_VARS] }, results: { bindings } }
}

describe('observatoryProjectionRunQuery', () => {
  it("scopes to the graph's :projection:obs:rollups named graph and orders by evaluatedAt, NOT projectedThrough", () => {
    const sparql = observatoryProjectionRunQuery(GRAPH_ID)
    expect(sparql).toContain('PREFIX obs: <http://mnemosyne.dev/observatory#>')
    expect(sparql).toContain(`GRAPH <${rollupsGraphIri(GRAPH_ID)}>`)
    expect(sparql).toContain('ORDER BY DESC(?evaluatedAt)')
    expect(sparql).not.toContain('ORDER BY DESC(?projectedThrough)')
  })

  it('refuses a graphId outside the platform graph-id grammar (IRI-injection safety by delegation)', () => {
    expect(() => observatoryProjectionRunQuery('has a space')).toThrow()
    expect(() => observatoryProjectionRunQuery('has>angle')).toThrow()
  })
})

describe('decodeProjectionRunResult', () => {
  it('decodes all ten predicates byte-identically to the input lexical forms — reads the object WHOLE', async () => {
    const payload = bindingsPayload([
      runBinding({
        run: 'urn:sophia:observatory:run:whole-read',
        evaluatedAt: '2026-07-15T12:00:00.000Z',
        asOf: '2026-07-15T11:59:00.000Z',
        projectedThrough: '2026-07-15T09:00:00.018Z',
        cursorHighWaterMark: 'cursor-whole-read',
        outcome: 'ok',
        computationStatus: 'ok',
        environment: 'cloud-2-local',
        engineName: 'garden',
        engineVersion: '1.2.3',
      }),
    ])
    const rest = new MemoryRestClient(payload)
    const queryService = makeQueryBlockService(rest)
    const result = await queryService.run(GRAPH_ID, observatoryProjectionRunQuery(GRAPH_ID), 1)
    const run = decodeProjectionRunResult(result)
    expect(run).toEqual<ProjectionRunObservation>({
      runIri: 'urn:sophia:observatory:run:whole-read',
      evaluatedAtRaw: '2026-07-15T12:00:00.000Z',
      asOfRaw: '2026-07-15T11:59:00.000Z',
      projectedThroughRaw: '2026-07-15T09:00:00.018Z',
      cursorHighWaterMarkRaw: 'cursor-whole-read',
      outcomeRaw: 'ok',
      computationStatusRaw: 'ok',
      environmentRaw: 'cloud-2-local',
      engineNameRaw: 'garden',
      engineVersionRaw: '1.2.3',
    })
  })

  it('an absent obs:projectedThrough decodes to null, not the empty string', () => {
    const payload = bindingsPayload([runBinding({ projectedThrough: null })])
    const rest = new MemoryRestClient(payload)
    const queryService = makeQueryBlockService(rest)
    return queryService.run(GRAPH_ID, observatoryProjectionRunQuery(GRAPH_ID), 1).then((result) => {
      const run = decodeProjectionRunResult(result)
      expect(run?.projectedThroughRaw).toBeNull()
      expect(run?.projectedThroughRaw).not.toBe('')
    })
  })

  it('zero rows decode to a null run (a real state, not an error)', async () => {
    const rest = new MemoryRestClient(bindingsPayload([]))
    const queryService = makeQueryBlockService(rest)
    const result = await queryService.run(GRAPH_ID, observatoryProjectionRunQuery(GRAPH_ID), 1)
    expect(decodeProjectionRunResult(result)).toBeNull()
  })

  it('a non-bindings result throws', async () => {
    const rest = new MemoryRestClient({ boolean: true })
    const queryService = makeQueryBlockService(rest)
    // ASK is the only query kind whose SELECT-shaped payload wouldn't normalize
    // to 'bindings' — force it by running an ASK query text against the same service.
    const result = await queryService.run(GRAPH_ID, 'ASK { ?s ?p ?o }', 1)
    expect(() => decodeProjectionRunResult(result)).toThrow(ObservatoryFreshnessError)
  })

  it('a run without obs:evaluatedAt throws (malformed, never silently coerced)', async () => {
    const binding = runBinding()
    delete binding.evaluatedAt
    const rest = new MemoryRestClient(bindingsPayload([binding]))
    const queryService = makeQueryBlockService(rest)
    const result = await queryService.run(GRAPH_ID, observatoryProjectionRunQuery(GRAPH_ID), 1)
    expect(() => decodeProjectionRunResult(result)).toThrow(ObservatoryFreshnessError)
  })
})

describe('readLatestProjectionRun', () => {
  it('runs the real query against the real QueryBlockService and decodes the response', async () => {
    const rest = new MemoryRestClient(bindingsPayload([runBinding({ run: 'urn:sophia:observatory:run:live' })]))
    const queryService = makeQueryBlockService(rest)
    const run = await readLatestProjectionRun({ queryService, graphId: GRAPH_ID })
    expect(run?.runIri).toBe('urn:sophia:observatory:run:live')
    expect(rest.queries).toHaveLength(1)
    expect(rest.queries[0]?.graphId).toBe(GRAPH_ID)
    expect(rest.queries[0]?.sparql).toBe(observatoryProjectionRunQuery(GRAPH_ID))
  })
})

describe('toneForAgeMs', () => {
  it('is unknown for non-finite ages, fresh under 2h, warning under 24h, else stale', () => {
    expect(toneForAgeMs(Number.NaN)).toBe('unknown')
    expect(toneForAgeMs(Number.POSITIVE_INFINITY)).toBe('unknown')
    expect(toneForAgeMs(-5)).toBe('fresh') // skew confessed in the line, not the tone
    expect(toneForAgeMs(FRESHNESS_WARNING_AFTER_MS - 1)).toBe('fresh')
    expect(toneForAgeMs(FRESHNESS_WARNING_AFTER_MS)).toBe('warning')
    expect(toneForAgeMs(FRESHNESS_STALE_AFTER_MS - 1)).toBe('warning')
    expect(toneForAgeMs(FRESHNESS_STALE_AFTER_MS)).toBe('stale')
  })
})

describe('formatAgeMs', () => {
  it('is unknown for non-finite ages', () => {
    expect(formatAgeMs(Number.NaN)).toBe('unknown')
    expect(formatAgeMs(Number.POSITIVE_INFINITY)).toBe('unknown')
  })

  it('boundary vocabulary at the six named thresholds, plus the negative prefix', () => {
    expect(formatAgeMs(59_999)).toBe('59s')
    expect(formatAgeMs(60_000)).toBe('1m')
    expect(formatAgeMs(3_599_999)).toBe('59m')
    expect(formatAgeMs(3_600_000)).toBe('1h')
    expect(formatAgeMs(86_399_999)).toBe('23h')
    expect(formatAgeMs(86_400_000)).toBe('1d')
    expect(formatAgeMs(-90_000)).toBe('-1m')
  })
})

describe('computeFreshnessVerdict', () => {
  const NOW = Date.parse('2026-07-15T14:00:00.000Z')

  it("is 'fresh' only when BOTH the run age and the watermark age are under 2h", () => {
    const run: ProjectionRunObservation = {
      runIri: 'urn:run:fresh',
      evaluatedAtRaw: '2026-07-15T13:00:00.000Z', // 1h old
      asOfRaw: null,
      projectedThroughRaw: '2026-07-15T13:30:00.000Z', // 30m old
      cursorHighWaterMarkRaw: null,
      outcomeRaw: 'ok',
      computationStatusRaw: 'ok',
      environmentRaw: null,
      engineNameRaw: null,
      engineVersionRaw: null,
    }
    const verdict = computeFreshnessVerdict({ run, nowMs: NOW, graphId: GRAPH_ID })
    expect(verdict.runTone).toBe('fresh')
    expect(verdict.watermarkTone).toBe('fresh')
    expect(verdict.tone).toBe('fresh')
    expect(verdict.stale).toBe(false)
    expect(verdict.headline).toBe('Fresh — this page is current.')
  })

  it("is 'warning' when the projector just ran but its watermark trails past 2h — 'it runs and sees nothing new'", () => {
    const run: ProjectionRunObservation = {
      runIri: 'urn:run:trailing-watermark',
      evaluatedAtRaw: new Date(NOW - 5 * 60_000).toISOString(), // 5m old
      asOfRaw: null,
      projectedThroughRaw: new Date(NOW - 3 * 3_600_000).toISOString(), // 3h old
      cursorHighWaterMarkRaw: null,
      outcomeRaw: 'ok',
      computationStatusRaw: 'ok',
      environmentRaw: null,
      engineNameRaw: null,
      engineVersionRaw: null,
    }
    const verdict = computeFreshnessVerdict({ run, nowMs: NOW, graphId: GRAPH_ID })
    expect(verdict.runTone).toBe('fresh')
    expect(verdict.watermarkTone).toBe('warning')
    expect(verdict.tone).toBe('warning')
    expect(verdict.stale).toBe(true)
    expect(verdict.reason).toContain('it runs and sees nothing new')
  })

  it('THE 21-JULY REGRESSION: a run that has not evaluated in 7 days reads STALE', () => {
    const run: ProjectionRunObservation = {
      runIri: 'urn:run:21-july',
      evaluatedAtRaw: '2026-07-21T09:00:00.000Z',
      asOfRaw: null,
      projectedThroughRaw: '2026-07-21T08:00:00.000Z',
      cursorHighWaterMarkRaw: null,
      outcomeRaw: 'ok',
      computationStatusRaw: 'ok',
      environmentRaw: null,
      engineNameRaw: null,
      engineVersionRaw: null,
    }
    const nowMs = Date.parse('2026-07-28T12:00:00.000Z')
    const verdict = computeFreshnessVerdict({ run, nowMs, graphId: GRAPH_ID })
    expect(verdict.tone).toBe('stale')
    expect(verdict.headline).toContain('historical testimony')
    expect(verdict.reason).toContain('7d ago')
  })

  it("a run that projected no events is 'warning' even when it just ran", () => {
    const run: ProjectionRunObservation = {
      runIri: 'urn:run:no-events',
      evaluatedAtRaw: new Date(NOW - 60_000).toISOString(), // 1m old
      asOfRaw: null,
      projectedThroughRaw: null, // OMITTED — the fold saw nothing
      cursorHighWaterMarkRaw: null,
      outcomeRaw: 'ok',
      computationStatusRaw: 'ok',
      environmentRaw: null,
      engineNameRaw: null,
      engineVersionRaw: null,
    }
    const verdict = computeFreshnessVerdict({ run, nowMs: NOW, graphId: GRAPH_ID })
    expect(verdict.runTone).toBe('fresh')
    expect(verdict.watermarkTone).toBe('warning')
    expect(verdict.tone).toBe('warning')
    expect(verdict.reason).toContain('projected no events')
  })

  it('obs:outcome is reported verbatim and NEVER drives the tone — the guard against "fixing" the governor by trusting outcome', () => {
    const run: ProjectionRunObservation = {
      runIri: 'urn:run:decorative-outcome',
      evaluatedAtRaw: new Date(NOW - 8 * 86_400_000).toISOString(), // 8 days old
      asOfRaw: null,
      projectedThroughRaw: new Date(NOW - 8 * 86_400_000).toISOString(),
      cursorHighWaterMarkRaw: null,
      outcomeRaw: 'ok', // decorative — projector.rs:283 hardcodes this literal
      computationStatusRaw: 'ok',
      environmentRaw: null,
      engineNameRaw: null,
      engineVersionRaw: null,
    }
    const verdict = computeFreshnessVerdict({ run, nowMs: NOW, graphId: GRAPH_ID })
    expect(verdict.tone).toBe('stale')
    expect(verdict.runLine).toContain('outcome ok')
  })

  it("a failed read is 'unknown' with the failure text preserved", () => {
    const verdict = computeFreshnessVerdict({
      run: null,
      nowMs: NOW,
      graphId: GRAPH_ID,
      failure: 'network unreachable',
    })
    expect(verdict.tone).toBe('unknown')
    expect(verdict.failure).toBe('network unreachable')
    expect(verdict.reason).toBe('network unreachable')
    expect(verdict.headline).toContain('UNKNOWN')
  })

  it('no run at all — reason names the rollups graph, tone unknown', () => {
    const verdict = computeFreshnessVerdict({ run: null, nowMs: NOW, graphId: GRAPH_ID })
    expect(verdict.tone).toBe('unknown')
    expect(verdict.reason).toContain(rollupsGraphIri(GRAPH_ID))
    expect(verdict.reason).toContain('holds no projector run at all')
  })

  it('raw lexical timestamps are never reformatted — exact substrings in both lines', () => {
    const run: ProjectionRunObservation = {
      runIri: 'urn:run:raw-lexical',
      evaluatedAtRaw: '2026-07-15T13:00:00.000Z',
      asOfRaw: null,
      projectedThroughRaw: '2026-07-15T09:00:00.018Z',
      cursorHighWaterMarkRaw: null,
      outcomeRaw: null,
      computationStatusRaw: null,
      environmentRaw: null,
      engineNameRaw: null,
      engineVersionRaw: null,
    }
    const verdict = computeFreshnessVerdict({ run, nowMs: NOW, graphId: GRAPH_ID })
    expect(verdict.runLine).toContain('2026-07-15T13:00:00.000Z')
    expect(verdict.watermarkLine).toContain('2026-07-15T09:00:00.018Z')
    // absent optional fields render '(absent)', never a fabricated value.
    expect(verdict.runLine).toContain('status (absent)')
    expect(verdict.runLine).toContain('outcome (absent)')
  })
})
