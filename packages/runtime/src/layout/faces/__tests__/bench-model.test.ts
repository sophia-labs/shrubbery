/**
 * bench-model.test.ts — the pure half of the bench dashboard: the queries (GRAPH-wrapped, injection-safe), the
 * SPARQL row -> model mapping, the delta/verdict display hint (SCHEMA §2's 5% rule), the run comparison, and the
 * hill-climb geometry. The queries are run against a real store in apps/organism's perf-lens-queries.test.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  BENCH_KINDS,
  caseResultsQuery,
  chartGeometry,
  compareRuns,
  defaultComparePair,
  deltaVerdict,
  exemplarsQuery,
  familyOfCase,
  filterByKind,
  kindOfCase,
  kindsPresent,
  linePath,
  mapCaseResultRows,
  mapRunRows,
  mapSeriesRows,
  niceCeil,
  runsQuery,
  seriesLabel,
  seriesQuery,
  spansQuery,
  type BenchCaseResult,
  type BenchSeriesPoint,
} from '../bench-model.js'

describe('queries', () => {
  it('every pattern sits inside GRAPH ?g and declares the bench prefix', () => {
    for (const q of [runsQuery(), caseResultsQuery('r1'), seriesQuery('write.x'), exemplarsQuery('r1', 'write.x'), spansQuery('urn:x:y')]) {
      expect(q).toContain('PREFIX bench: <https://sophia-labs.com/ns/bench#>')
      expect(q).toContain('GRAPH ?g {')
      expect(q.startsWith('PREFIX')).toBe(true)
    }
  })

  it('refuses ids that could escape the string literal or IRI', () => {
    expect(() => caseResultsQuery('a" . } DROP')).toThrow()
    expect(() => seriesQuery('x y')).toThrow()
    expect(() => exemplarsQuery('ok', '"')).toThrow()
    expect(() => spansQuery('urn:x> . <y')).toThrow()
    expect(() => caseResultsQuery('20261025T020000Z-baseline-019463f')).not.toThrow()
    expect(() => seriesQuery('write.edit_block_text.book')).not.toThrow()
  })

  it('keeps every page inside the 500-row ceiling and pages spans exactly', () => {
    expect(runsQuery(9999)).toContain('LIMIT 500')
    expect(spansQuery('urn:x', 500)).toContain('OFFSET 500')
    expect(spansQuery('urn:x', 500)).toContain('LIMIT 500')
    expect(spansQuery('urn:x', -3)).toContain('OFFSET 0')
    expect(spansQuery('urn:x')).toContain('ORDER BY ?start ?spanId')
  })

  it('asks for the browser block (SCHEMA §7 names)', () => {
    const q = caseResultsQuery('r1')
    for (const p of ['inputToPaintP50Ms', 'inputToPaintP95Ms', 'longFrameCount', 'longFrameMsTotal', 'bench:requests', 'requestBytes']) expect(q).toContain(p)
  })
})

describe('mapRunRows', () => {
  it('maps, orders newest first, dedupes by run id and reads the baseline flag', () => {
    const runs = mapRunRows([
      { run: 'urn:r1', runId: 'r1', label: 'baseline', startedAt: '2026-10-25T02:00:00.000Z', gitRev: 'aaa', suite: 'standard', tier: 'm', isBaseline: 'true', loadAvg: '2.1', rss: '910' },
      { run: 'urn:r2', runId: 'r2', startedAt: '2026-10-25T04:30:00.000Z', isBaseline: 'false' },
      { run: 'urn:r1', runId: 'r1', startedAt: '2026-10-25T02:00:00.000Z' },
      { runId: '', startedAt: 'x' },
    ])
    expect(runs.map((r) => r.runId)).toEqual(['r2', 'r1'])
    expect(runs[1]).toMatchObject({ label: 'baseline', gitRev: 'aaa', suite: 'standard', tier: 'm', isBaseline: true, loadBefore1m: 2.1, rssPeakMB: 910 })
    expect(runs[0]).toMatchObject({ isBaseline: false, loadBefore1m: null, label: '' })
  })
})

describe('mapCaseResultRows', () => {
  it('maps numbers, defaults the version to 1, infers the kind and keeps absent numbers null', () => {
    const [a, b] = mapCaseResultRows([
      { caseId: 'write.edit_block_text.book', kind: 'write', caseVersion: '1', p50: '9653', p95: '10200.5', fsyncs: '23', n: '30' },
      { caseId: 'gui.doc.type.book', p50: '74', itp50: '66.6', itp95: '120', lfCount: '4', lfMs: '310', requests: '52', requestBytes: '480000' },
      { caseId: 'write.edit_block_text.book', p50: '1' },
      { p50: '5' },
    ])
    expect(a).toMatchObject({ caseId: 'write.edit_block_text.book', kind: 'write', caseVersion: 1, p50Ms: 9653, p95Ms: 10200.5, fsyncsPerOpP50: 23, n: 30, p99Ms: null, inputToPaintP50Ms: null })
    expect(b).toMatchObject({ kind: 'gui', inputToPaintP50Ms: 66.6, inputToPaintP95Ms: 120, longFrameCount: 4, longFrameMsTotal: 310, requests: 52, requestBytes: 480000 })
  })

  it('classifies kinds, including rich and gui, and falls back to other', () => {
    expect(BENCH_KINDS).toContain('rich')
    expect(BENCH_KINDS).toContain('gui')
    expect(kindOfCase(undefined, 'rich.whiteboard.create')).toBe('rich')
    expect(kindOfCase('bogus', 'gui.app.cold_load')).toBe('gui')
    expect(kindOfCase(undefined, 'mystery.case')).toBe('other')
  })

  it('families: the second segment of a rich id, nothing for other kinds', () => {
    expect(familyOfCase('rich.whiteboard.apply_large')).toBe('whiteboard')
    expect(familyOfCase('rich.rdf.load_100k')).toBe('rdf')
    expect(familyOfCase('rich')).toBe('other')
    expect(familyOfCase('write.edit_block_text.book')).toBe('')
  })
})

describe('deltaVerdict (SCHEMA §2: 5% on medians, a display hint)', () => {
  it('same inside the band, faster below, slower above', () => {
    expect(deltaVerdict(100, 102).verdict).toBe('same')
    expect(deltaVerdict(100, 98).verdict).toBe('same')
    expect(deltaVerdict(100, 80).verdict).toBe('faster')
    expect(deltaVerdict(100, 130).verdict).toBe('slower')
  })

  it('exactly on the band counts as changed, on both sides', () => {
    expect(deltaVerdict(100, 105).verdict).toBe('slower')
    expect(deltaVerdict(100, 95).verdict).toBe('faster')
    expect(deltaVerdict(100, 104.9).verdict).toBe('same')
  })

  it('reports ratio and percent, negative when faster', () => {
    const d = deltaVerdict(200, 150)
    expect(d.ratio).toBeCloseTo(0.75, 10)
    expect(d.deltaPct).toBeCloseTo(-25, 10)
  })

  it('has nothing to say without both sides or with a non-positive baseline', () => {
    expect(deltaVerdict(null, 5).verdict).toBe('none')
    expect(deltaVerdict(5, null).verdict).toBe('none')
    expect(deltaVerdict(0, 5).verdict).toBe('none')
    expect(deltaVerdict(5, Number.NaN).verdict).toBe('none')
    expect(deltaVerdict(null, null).deltaPct).toBeNull()
  })

  it('honours a custom band', () => {
    expect(deltaVerdict(100, 108, 0.1).verdict).toBe('same')
  })
})

function result(caseId: string, p50: number, extra: Partial<BenchCaseResult> = {}): BenchCaseResult {
  return {
    caseId, caseVersion: 1, kind: kindOfCase(undefined, caseId), label: '', n: 30, errors: 0, meanMs: null, p50Ms: p50, p95Ms: p50 * 1.5,
    p99Ms: null, maxMs: null, fsyncsPerOpP50: null, leaseWaitP95Ms: null, leaseHoldP95Ms: null, queueWaitP95Ms: null, slopeMsPer100: null,
    inputToPaintP50Ms: null, inputToPaintP95Ms: null, longFrameCount: null, longFrameMsTotal: null, requests: null, requestBytes: null, ...extra,
  }
}

describe('compareRuns', () => {
  it('pairs by case, computes verdicts for p50, p95 and fsyncs, and orders by kind then family then id', () => {
    const base = [result('write.b', 1000, { fsyncsPerOpP50: 20 }), result('read.a', 50), result('rich.rdf.load', 400), result('rich.emporium.write', 300), result('gui.x', 100, { inputToPaintP50Ms: 80 })]
    const cur = [result('write.b', 500, { fsyncsPerOpP50: 8 }), result('read.a', 51), result('rich.rdf.load', 400), result('rich.emporium.write', 330), result('gui.x', 100, { inputToPaintP50Ms: 40 })]
    const rows = compareRuns(base, cur)
    expect(rows.map((r) => r.caseId)).toEqual(['read.a', 'write.b', 'rich.emporium.write', 'rich.rdf.load', 'gui.x'])
    expect(rows[0]!.p50.verdict).toBe('same')
    expect(rows[1]!.p50.verdict).toBe('faster')
    expect(rows[1]!.fsyncs).toMatchObject({ base: 20, current: 8, verdict: 'faster' })
    expect(rows[2]!.family).toBe('emporium')
    expect(rows[2]!.p50.verdict).toBe('slower')
    expect(rows[4]!.inputToPaint.verdict).toBe('faster')
  })

  it('gives one-sided rows when a case is in one run only, and never mixes protocol versions', () => {
    const rows = compareRuns([result('read.a', 10), result('read.old', 5)], [result('read.a', 10, { caseVersion: 2 }), result('read.new', 5)])
    expect(rows.map((r) => `${r.caseId}@v${r.caseVersion}:${r.onlyIn}`).sort()).toEqual([
      'read.a@v1:base', 'read.a@v2:current', 'read.new@v1:current', 'read.old@v1:base',
    ])
    expect(rows.every((r) => r.p50.verdict === 'none')).toBe(true)
  })
})

describe('kind filter', () => {
  const rows = compareRuns([result('read.a', 1), result('write.b', 1), result('gui.c', 1), result('rich.x.y', 1)], [])
  it('filters by kind and keeps everything for all', () => {
    expect(filterByKind(rows, 'all')).toHaveLength(4)
    expect(filterByKind(rows, 'write').map((r) => r.caseId)).toEqual(['write.b'])
    expect(filterByKind(rows, 'ws')).toEqual([])
  })
  it('lists the kinds that occur, in schema order', () => {
    expect(kindsPresent(rows)).toEqual(['read', 'write', 'rich', 'gui'])
  })
})

describe('series and the chart', () => {
  const rows: Array<Record<string, string>> = [
    { runId: 'r3', startedAt: '2026-10-25T04:30:00Z', gitRev: 'e4f', p50: '4566', p95: '5700' },
    { runId: 'r1', startedAt: '2026-10-25T02:00:00Z', gitRev: '019', p50: '9711', p95: '12000' },
    { runId: 'r2', startedAt: '2026-10-25T03:15:00Z', label: 'lease-split', p50: '7802' },
    { runId: 'bad', startedAt: '2026-10-25T05:00:00Z', p50: 'x' },
    { runId: 'r1', startedAt: '2026-10-25T02:00:00Z', p50: '1' },
  ]
  it('orders in time, drops unusable points and dedupes', () => {
    const points = mapSeriesRows(rows)
    expect(points.map((p) => p.runId)).toEqual(['r1', 'r2', 'r3'])
    expect(points[1]!.p95Ms).toBeNull()
  })
  it('labels the x axis by git revision, then label, then the run id after its timestamp', () => {
    const [a, b] = mapSeriesRows(rows)
    expect(seriesLabel(a!)).toBe('019')
    expect(seriesLabel(b!)).toBe('lease-split')
    expect(seriesLabel({ ...a!, gitRev: '', label: '', runId: '20261025T020000Z-baseline' })).toBe('baseline')
  })
  it('niceCeil rounds up to 1, 2, 5 times a power of ten', () => {
    expect([niceCeil(0), niceCeil(0.7), niceCeil(1.2), niceCeil(3), niceCeil(9650), niceCeil(12000)]).toEqual([1, 1, 2, 5, 10000, 20000])
  })
  it('chartGeometry spaces runs ordinally, scales y from zero and skips missing p95', () => {
    const points: BenchSeriesPoint[] = mapSeriesRows(rows)
    const g = chartGeometry(points, { width: 600, height: 240 })
    expect(g.yMax).toBe(20000)
    expect(g.p50).toHaveLength(3)
    expect(g.p95.map((p) => p.i)).toEqual([0, 2])
    expect(g.xs[0]).toBe(g.plot.left)
    expect(g.xs[2]).toBe(g.plot.right)
    expect(g.xs[1]).toBeCloseTo((g.plot.left + g.plot.right) / 2, 6)
    // SVG y grows downward: the higher value (run 1, 9711 ms) must sit higher, i.e. at the smaller y
    expect(g.p50[0]!.y).toBeLessThan(g.p50[2]!.y)
    expect(g.yTicks[0]).toMatchObject({ value: 0, y: g.plot.bottom })
    expect(chartGeometry([points[0]!]).xs[0]).toBeCloseTo(((52 + (640 - 16)) / 2), 6)
    expect(chartGeometry([]).p50).toEqual([])
    expect(linePath([])).toBe('')
    expect(linePath(g.p50)).toMatch(/^M[\d.]+,[\d.]+ L/)
  })
})

describe('defaultComparePair', () => {
  it('current is the newest run, base the newest older baseline, else the previous run', () => {
    const run = (runId: string, isBaseline: boolean) => ({ iri: '', runId, label: '', startedAt: '', gitRev: '', suite: '', tier: '', mode: '', loadBefore1m: null, rssPeakMB: null, isBaseline })
    expect(defaultComparePair([run('c', false), run('b', false), run('a', true)])).toEqual({ baseRunId: 'a', currentRunId: 'c' })
    expect(defaultComparePair([run('c', false), run('b', false)])).toEqual({ baseRunId: 'b', currentRunId: 'c' })
    expect(defaultComparePair([run('c', false)])).toEqual({ baseRunId: null, currentRunId: 'c' })
    expect(defaultComparePair([])).toEqual({ baseRunId: null, currentRunId: null })
  })
})
