/**
 * bench-model.ts — the pure half of the bench dashboard (la Lente, 2026-10-25): the SPARQL the lens asks of the
 * `perf` ledger graph, the mapping of its rows to models, and the run-vs-baseline arithmetic.
 *
 * The vocabulary is plans/2026-10-25-perf/SCHEMA.md §4 (`bench: <https://sophia-labs.com/ns/bench#>`), unchanged.
 * Every pattern sits inside `GRAPH ?g { … }`: cell stores are named-graph partitioned and an unwrapped pattern
 * silently returns zero rows.
 *
 * Every query stays at or below the 500-row ceiling of `QueryBlockService.run` (runs ≤ 200; one run's results are
 * one row per case; one case across runs ≤ 500; one exemplar's spans ≤ 300 by SCHEMA §1).
 *
 * The verdict here is a DISPLAY HINT (SCHEMA §2's 5% rule, on medians). The real verdict is `gbench compare`'s
 * bootstrap CI; nothing here should be quoted as a claim without a run id.
 */
import type { QueryBlockResult } from '../../editor-services/query-block-service.js'
import { plainQueryBlockTermValue } from '../../editor-services/query-block-service.js'
import type { PlainRow } from './trace-spans.js'

export const BENCH_NS = 'https://sophia-labs.com/ns/bench#'
export const BENCH_PREFIX = `PREFIX bench: <${BENCH_NS}>`

/** SCHEMA §3 and §7: the kinds of case (`rich` = gardend's fancier data types headless; `gui` = Shrubbery in WebKit). */
export const BENCH_KINDS = ['read', 'write', 'burst', 'scale', 'ws', 'boot', 'rich', 'gui'] as const
export type BenchKind = (typeof BENCH_KINDS)[number]
export type BenchKindFilter = BenchKind | 'all'

export function isBenchKind(value: string): value is BenchKind {
  return (BENCH_KINDS as readonly string[]).includes(value)
}

/** SCHEMA §2: `same` inside ±5%. */
export const SAME_BAND = 0.05

// ── queries ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const ID_PATTERN = /^[A-Za-z0-9._:@-]{1,160}$/
// eslint-disable-next-line no-control-regex
const IRI_FORBIDDEN = /[\u0000- <>"{}|^`\\]/

/** A run id or case id as it may sit inside a SPARQL string literal. Throws on anything else (no escaping games). */
export function assertBenchId(id: string, what: string): string {
  if (!ID_PATTERN.test(id)) throw new Error(`bench: ${what} ${JSON.stringify(id)} is outside [A-Za-z0-9._:@-]{1,160}`)
  return id
}

function assertIri(iri: string, what: string): string {
  if (iri.length === 0 || IRI_FORBIDDEN.test(iri)) throw new Error(`bench: ${what} ${JSON.stringify(iri)} cannot sit in an IRIREF`)
  return iri
}

/** (a) the runs list, newest first. */
export function runsQuery(limit = 200): string {
  const n = Math.max(1, Math.min(500, Math.trunc(limit)))
  return `${BENCH_PREFIX}
SELECT ?run ?runId ?label ?startedAt ?gitRev ?suite ?tier ?mode ?load ?rss ?isBaseline WHERE {
  GRAPH ?g {
    ?run bench:runId ?runId ;
         bench:startedAt ?startedAt .
    OPTIONAL { ?run bench:label ?label }
    OPTIONAL { ?run bench:gitRev ?gitRev }
    OPTIONAL { ?run bench:suite ?suite }
    OPTIONAL { ?run bench:tier ?tier }
    OPTIONAL { ?run bench:mode ?mode }
    OPTIONAL { ?run bench:loadBefore1m ?load }
    OPTIONAL { ?run bench:rssPeakMB ?rss }
    OPTIONAL { ?run bench:isBaseline ?isBaseline }
  }
}
ORDER BY DESC(?startedAt)
LIMIT ${n}`
}

/** (b) one run's case results: one row per case. */
export function caseResultsQuery(runId: string): string {
  assertBenchId(runId, 'run id')
  return `${BENCH_PREFIX}
SELECT ?caseId ?caseVersion ?kind ?caseLabel ?n ?errors ?mean ?p50 ?p95 ?p99 ?maxMs ?fsyncs ?leaseWait ?leaseHold ?queueWait ?slope ?itp50 ?itp95 ?lfCount ?lfMs ?requests ?requestBytes WHERE {
  GRAPH ?g {
    ?run bench:runId "${runId}" .
    ?result bench:run ?run ;
            bench:case ?case .
    ?case bench:caseId ?caseId .
    OPTIONAL { ?result bench:p50Ms ?p50 }
    OPTIONAL { ?case bench:caseVersion ?caseVersion }
    OPTIONAL { ?case bench:kind ?kind }
    OPTIONAL { ?case <http://www.w3.org/2000/01/rdf-schema#label> ?caseLabel }
    OPTIONAL { ?result bench:n ?n }
    OPTIONAL { ?result bench:errors ?errors }
    OPTIONAL { ?result bench:meanMs ?mean }
    OPTIONAL { ?result bench:p95Ms ?p95 }
    OPTIONAL { ?result bench:p99Ms ?p99 }
    OPTIONAL { ?result bench:maxMs ?maxMs }
    OPTIONAL { ?result bench:fsyncsPerOpP50 ?fsyncs }
    OPTIONAL { ?result bench:leaseWaitP95Ms ?leaseWait }
    OPTIONAL { ?result bench:leaseHoldP95Ms ?leaseHold }
    OPTIONAL { ?result bench:queueWaitP95Ms ?queueWait }
    OPTIONAL { ?result bench:slopeMsPer100 ?slope }
    OPTIONAL { ?result bench:inputToPaintP50Ms ?itp50 }
    OPTIONAL { ?result bench:inputToPaintP95Ms ?itp95 }
    OPTIONAL { ?result bench:longFrameCount ?lfCount }
    OPTIONAL { ?result bench:longFrameMsTotal ?lfMs }
    OPTIONAL { ?result bench:requests ?requests }
    OPTIONAL { ?result bench:requestBytes ?requestBytes }
  }
}
ORDER BY ?caseId
LIMIT 500`
}

/** (c) one case across every run, oldest first: the hill-climb. */
export function seriesQuery(caseId: string): string {
  assertBenchId(caseId, 'case id')
  return `${BENCH_PREFIX}
SELECT ?runId ?label ?startedAt ?gitRev ?caseVersion ?p50 ?p95 ?fsyncs WHERE {
  GRAPH ?g {
    ?case bench:caseId "${caseId}" .
    ?result bench:case ?case ;
            bench:run ?run ;
            bench:p50Ms ?p50 .
    ?run bench:runId ?runId ;
         bench:startedAt ?startedAt .
    OPTIONAL { ?case bench:caseVersion ?caseVersion }
    OPTIONAL { ?result bench:p95Ms ?p95 }
    OPTIONAL { ?result bench:fsyncsPerOpP50 ?fsyncs }
    OPTIONAL { ?run bench:label ?label }
    OPTIONAL { ?run bench:gitRev ?gitRev }
  }
}
ORDER BY ?startedAt
LIMIT 500`
}

/** The exemplars (slowest calls) of one case in one run, slowest first. */
export function exemplarsQuery(runId: string, caseId: string): string {
  assertBenchId(runId, 'run id')
  assertBenchId(caseId, 'case id')
  return `${BENCH_PREFIX}
SELECT ?exemplar ?rank ?traceId ?wallMs WHERE {
  GRAPH ?g {
    ?run bench:runId "${runId}" .
    ?case bench:caseId "${caseId}" .
    ?result bench:run ?run ;
            bench:case ?case .
    ?exemplar bench:caseResult ?result ;
              bench:rank ?rank .
    OPTIONAL { ?exemplar bench:traceId ?traceId }
    OPTIONAL { ?exemplar bench:wallMs ?wallMs }
  }
}
ORDER BY ?rank
LIMIT 20`
}

/** Page size of the span reads: `QueryBlockService.run` returns at most 500 rows. A GUI case has 1,000+ spans. */
export const SPAN_PAGE = 500

/** One page of an exemplar's spans, in a stable order (start, then id) so OFFSET paging is exact. */
export function spansQuery(exemplarIri: string, offset = 0): string {
  assertIri(exemplarIri, 'exemplar IRI')
  const skip = Math.max(0, Math.trunc(offset))
  return `${BENCH_PREFIX}
SELECT ?spanId ?parentSpanId ?name ?start ?dur ?fsyncs ?attrs WHERE {
  GRAPH ?g {
    ?span bench:exemplar <${exemplarIri}> ;
          bench:spanId ?spanId ;
          bench:name ?name ;
          bench:startOffsetMs ?start ;
          bench:durationMs ?dur .
    OPTIONAL { ?span bench:parentSpanId ?parentSpanId }
    OPTIONAL { ?span bench:fsyncs ?fsyncs }
    OPTIONAL { ?span bench:attrsJson ?attrs }
  }
}
ORDER BY ?start ?spanId
OFFSET ${skip}
LIMIT ${SPAN_PAGE}`
}

// ── row mapping ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Reduce a bindings result to plain-text rows (`plainQueryBlockTermValue` per term). Non-bindings → no rows. */
export function plainRows(result: QueryBlockResult): PlainRow[] {
  if (result.resultKind !== 'bindings') return []
  return result.rows.map((row) => {
    const out: Record<string, string> = {}
    for (const [key, term] of Object.entries(row)) out[key] = plainQueryBlockTermValue(term)
    return out
  })
}

function num(text: string | undefined): number | null {
  if (text === undefined || text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

function bool(text: string | undefined): boolean {
  return text === 'true' || text === '1'
}

export interface BenchRunSummary {
  readonly iri: string
  readonly runId: string
  readonly label: string
  readonly startedAt: string
  readonly gitRev: string
  readonly suite: string
  readonly tier: string
  readonly mode: string
  /** 1-minute load average before the run, or null. */
  readonly loadBefore1m: number | null
  readonly rssPeakMB: number | null
  readonly isBaseline: boolean
}

/** Rows of `runsQuery` → runs, newest first, one per run id (a ledger copied into two graphs does not double). */
export function mapRunRows(rows: readonly PlainRow[]): BenchRunSummary[] {
  const seen = new Set<string>()
  const runs: BenchRunSummary[] = []
  for (const row of rows) {
    const runId = row.runId
    if (!runId || seen.has(runId)) continue
    seen.add(runId)
    runs.push({
      iri: row.run ?? '',
      runId,
      label: row.label ?? '',
      startedAt: row.startedAt ?? '',
      gitRev: row.gitRev ?? '',
      suite: row.suite ?? '',
      tier: row.tier ?? '',
      mode: row.mode ?? '',
      loadBefore1m: num(row.load),
      rssPeakMB: num(row.rss),
      isBaseline: bool(row.isBaseline),
    })
  }
  return runs.sort((a, b) => timeOf(b.startedAt) - timeOf(a.startedAt) || (a.runId < b.runId ? 1 : -1))
}

function timeOf(iso: string): number {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

export interface BenchCaseResult {
  readonly caseId: string
  readonly caseVersion: number
  readonly kind: BenchKind | 'other'
  readonly label: string
  readonly n: number | null
  readonly errors: number | null
  readonly meanMs: number | null
  readonly p50Ms: number | null
  readonly p95Ms: number | null
  readonly p99Ms: number | null
  readonly maxMs: number | null
  readonly fsyncsPerOpP50: number | null
  readonly leaseWaitP95Ms: number | null
  readonly leaseHoldP95Ms: number | null
  readonly queueWaitP95Ms: number | null
  readonly slopeMsPer100: number | null
  /** The GUI lane's browser block (SCHEMA §7); all null for a non-GUI case. */
  readonly inputToPaintP50Ms: number | null
  readonly inputToPaintP95Ms: number | null
  readonly longFrameCount: number | null
  readonly longFrameMsTotal: number | null
  readonly requests: number | null
  readonly requestBytes: number | null
}

/** `caseId@vN`, the key two runs are compared under (SCHEMA §2: same caseVersion only). */
export function caseKey(caseId: string, caseVersion: number): string {
  return `${caseId}@v${caseVersion}`
}

/** The kind of a case: the ledger's own `bench:kind`, else the first dotted segment of the id, else `other`. */
export function kindOfCase(kind: string | undefined, caseId: string): BenchKind | 'other' {
  if (kind && isBenchKind(kind)) return kind
  const head = caseId.split('.')[0] ?? ''
  return isBenchKind(head) ? head : 'other'
}

/**
 * The family of a `rich.*` case: its second id segment (`rich.whiteboard.create` -> `whiteboard`). Other kinds have none.
 * A rich case id without a second segment falls in `other`.
 */
export function familyOfCase(caseId: string): string {
  const parts = caseId.split('.')
  if (parts[0] !== 'rich') return ''
  return parts[1] || 'other'
}

/** Rows of `caseResultsQuery` → case results. A row with no case id is skipped; a repeated case key keeps the first. */
export function mapCaseResultRows(rows: readonly PlainRow[]): BenchCaseResult[] {
  const seen = new Set<string>()
  const results: BenchCaseResult[] = []
  for (const row of rows) {
    const caseId = row.caseId
    if (!caseId) continue
    const caseVersion = num(row.caseVersion) ?? 1
    const key = caseKey(caseId, caseVersion)
    if (seen.has(key)) continue
    seen.add(key)
    results.push({
      caseId,
      caseVersion,
      kind: kindOfCase(row.kind, caseId),
      label: row.caseLabel ?? '',
      n: num(row.n),
      errors: num(row.errors),
      meanMs: num(row.mean),
      p50Ms: num(row.p50),
      p95Ms: num(row.p95),
      p99Ms: num(row.p99),
      maxMs: num(row.maxMs),
      fsyncsPerOpP50: num(row.fsyncs),
      leaseWaitP95Ms: num(row.leaseWait),
      leaseHoldP95Ms: num(row.leaseHold),
      queueWaitP95Ms: num(row.queueWait),
      slopeMsPer100: num(row.slope),
      inputToPaintP50Ms: num(row.itp50),
      inputToPaintP95Ms: num(row.itp95),
      longFrameCount: num(row.lfCount),
      longFrameMsTotal: num(row.lfMs),
      requests: num(row.requests),
      requestBytes: num(row.requestBytes),
    })
  }
  return results
}

export interface BenchSeriesPoint {
  readonly runId: string
  readonly label: string
  readonly gitRev: string
  readonly startedAt: string
  readonly caseVersion: number
  readonly p50Ms: number
  readonly p95Ms: number | null
  readonly fsyncsPerOpP50: number | null
}

/** Rows of `seriesQuery` → points in time order. A point without a finite p50 is dropped. */
export function mapSeriesRows(rows: readonly PlainRow[]): BenchSeriesPoint[] {
  const seen = new Set<string>()
  const points: BenchSeriesPoint[] = []
  for (const row of rows) {
    const p50 = num(row.p50)
    if (!row.runId || p50 === null || seen.has(row.runId)) continue
    seen.add(row.runId)
    points.push({
      runId: row.runId,
      label: row.label ?? '',
      gitRev: row.gitRev ?? '',
      startedAt: row.startedAt ?? '',
      caseVersion: num(row.caseVersion) ?? 1,
      p50Ms: p50,
      p95Ms: num(row.p95),
      fsyncsPerOpP50: num(row.fsyncs),
    })
  }
  return points.sort((a, b) => timeOf(a.startedAt) - timeOf(b.startedAt) || (a.runId < b.runId ? -1 : 1))
}

/** The x-axis label of a point: its git revision, else its label, else the run id's tail. */
export function seriesLabel(point: BenchSeriesPoint): string {
  return point.gitRev || point.label || point.runId.slice(-12)
}

// ── compare ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `none`: one side is absent or the baseline is not positive, so there is nothing to compare. */
export type BenchVerdict = 'faster' | 'slower' | 'same' | 'none'

export interface BenchDelta {
  readonly base: number | null
  readonly current: number | null
  /** current / base, or null. */
  readonly ratio: number | null
  /** (current − base) / base × 100, or null. Negative is faster. */
  readonly deltaPct: number | null
  readonly verdict: BenchVerdict
}

/**
 * SCHEMA §2's display rule on two medians (lower is better): `same` when |ratio − 1| < band, `faster` below,
 * `slower` above. Exactly on the band counts as changed. Either side absent (or a non-positive base) is `none`.
 */
export function deltaVerdict(base: number | null, current: number | null, band: number = SAME_BAND): BenchDelta {
  if (base === null || current === null || !Number.isFinite(base) || !Number.isFinite(current) || base <= 0) {
    return { base, current, ratio: null, deltaPct: null, verdict: 'none' }
  }
  const ratio = current / base
  const deltaPct = (ratio - 1) * 100
  // 1e-9 so that exactly ±band (e.g. 105/100) reads as changed despite binary floating point.
  const verdict: BenchVerdict = Math.abs(ratio - 1) < band - 1e-9 ? 'same' : ratio < 1 ? 'faster' : 'slower'
  return { base, current, ratio, deltaPct, verdict }
}

export interface BenchCompareRow {
  readonly key: string
  readonly caseId: string
  readonly caseVersion: number
  readonly kind: BenchKind | 'other'
  /** `rich` cases group by family (`whiteboard`, `emporium`, ...); '' otherwise. */
  readonly family: string
  readonly label: string
  readonly base: BenchCaseResult | null
  readonly current: BenchCaseResult | null
  readonly p50: BenchDelta
  readonly p95: BenchDelta
  readonly fsyncs: BenchDelta
  /** GUI: input-to-paint p50 (lower is better). */
  readonly inputToPaint: BenchDelta
  readonly longFrames: BenchDelta
  readonly requests: BenchDelta
  /** Present in both runs but under different protocol versions never share a row, so this is only ever a one-sided case. */
  readonly onlyIn: 'base' | 'current' | null
}

const KIND_ORDER: readonly (BenchKind | 'other')[] = [...BENCH_KINDS, 'other']

/**
 * Pair two runs' case results by `caseId@vN`. A case in one run only gets a one-sided row (`onlyIn`, verdict `none`).
 * Rows come out by kind (SCHEMA §3 order), then family (rich), then case id.
 */
export function compareRuns(base: readonly BenchCaseResult[], current: readonly BenchCaseResult[]): BenchCompareRow[] {
  const baseByKey = new Map(base.map((r) => [caseKey(r.caseId, r.caseVersion), r]))
  const currentByKey = new Map(current.map((r) => [caseKey(r.caseId, r.caseVersion), r]))
  const keys = new Set<string>([...baseByKey.keys(), ...currentByKey.keys()])
  const rows: BenchCompareRow[] = []
  for (const key of keys) {
    const b = baseByKey.get(key) ?? null
    const c = currentByKey.get(key) ?? null
    const any = (c ?? b) as BenchCaseResult
    rows.push({
      key,
      caseId: any.caseId,
      caseVersion: any.caseVersion,
      kind: any.kind,
      family: familyOfCase(any.caseId),
      label: any.label,
      base: b,
      current: c,
      p50: deltaVerdict(b?.p50Ms ?? null, c?.p50Ms ?? null),
      p95: deltaVerdict(b?.p95Ms ?? null, c?.p95Ms ?? null),
      fsyncs: deltaVerdict(b?.fsyncsPerOpP50 ?? null, c?.fsyncsPerOpP50 ?? null),
      inputToPaint: deltaVerdict(b?.inputToPaintP50Ms ?? null, c?.inputToPaintP50Ms ?? null),
      longFrames: deltaVerdict(b?.longFrameCount ?? null, c?.longFrameCount ?? null),
      requests: deltaVerdict(b?.requests ?? null, c?.requests ?? null),
      onlyIn: b && !c ? 'base' : c && !b ? 'current' : null,
    })
  }
  return rows.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      (a.family < b.family ? -1 : a.family > b.family ? 1 : 0) ||
      (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0) ||
      a.caseVersion - b.caseVersion,
  )
}

/** (d) the kind filter. `all` keeps everything. */
export function filterByKind<T extends { readonly kind: BenchKind | 'other' }>(rows: readonly T[], filter: BenchKindFilter): T[] {
  return filter === 'all' ? [...rows] : rows.filter((r) => r.kind === filter)
}

/** Kinds that actually occur, in SCHEMA order (so the filter shows no empty chips). */
export function kindsPresent(rows: readonly { readonly kind: BenchKind | 'other' }[]): BenchKind[] {
  const present = new Set(rows.map((r) => r.kind))
  return BENCH_KINDS.filter((k) => present.has(k))
}

/** The default comparison pair: the newest run against the newest baseline that is not itself (else the next run). */
export function defaultComparePair(runs: readonly BenchRunSummary[]): { baseRunId: string | null; currentRunId: string | null } {
  const current = runs[0]
  if (!current) return { baseRunId: null, currentRunId: null }
  const baseline = runs.slice(1).find((r) => r.isBaseline) ?? runs[1]
  return { baseRunId: baseline?.runId ?? null, currentRunId: current.runId }
}

// ── the hill-climb chart ────────────────────────────────────────────────────────────────────────────────────────────

/** Round up to 1, 2 or 5 times a power of ten: a tidy axis maximum. 0 and negatives give 1. */
export function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const exponent = Math.floor(Math.log10(value))
  const base = 10 ** exponent
  const fraction = value / base
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return nice * base
}

export interface ChartPoint {
  readonly x: number
  readonly y: number
  /** Index into the series. */
  readonly i: number
}

export interface ChartGeometry {
  readonly width: number
  readonly height: number
  readonly plot: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }
  readonly yMax: number
  readonly p50: readonly ChartPoint[]
  readonly p95: readonly ChartPoint[]
  readonly xs: readonly number[]
  readonly yTicks: readonly { readonly value: number; readonly y: number }[]
}

/**
 * Pure layout of the hill-climb: an ORDINAL x axis (one slot per run, in time order: runs are not evenly spaced in
 * time and the picture is "what each revision did"), a linear y from 0 to a tidy maximum. p95 points exist only where
 * the run recorded a p95. One point sits mid-plot.
 */
export function chartGeometry(
  points: readonly BenchSeriesPoint[],
  size: { readonly width: number; readonly height: number } = { width: 640, height: 240 },
): ChartGeometry {
  const plot = { left: 52, right: size.width - 16, top: 12, bottom: size.height - 34 }
  const innerW = plot.right - plot.left
  const innerH = plot.bottom - plot.top
  const highest = points.reduce((m, p) => Math.max(m, p.p50Ms, p.p95Ms ?? 0), 0)
  const yMax = niceCeil(highest)
  const xAt = (i: number): number => (points.length <= 1 ? plot.left + innerW / 2 : plot.left + (innerW * i) / (points.length - 1))
  const yAt = (v: number): number => plot.bottom - (v / yMax) * innerH
  const xs = points.map((_, i) => xAt(i))
  const p50 = points.map((p, i) => ({ x: xAt(i), y: yAt(p.p50Ms), i }))
  const p95: ChartPoint[] = []
  points.forEach((p, i) => {
    if (p.p95Ms !== null) p95.push({ x: xAt(i), y: yAt(p.p95Ms), i })
  })
  const yTicks = [0, 1, 2, 3, 4].map((k) => ({ value: (yMax * k) / 4, y: yAt((yMax * k) / 4) }))
  return { width: size.width, height: size.height, plot, yMax, p50, p95, xs, yTicks }
}

/** An SVG path through points: `M x,y L x,y …`; empty for no points. */
export function linePath(points: readonly ChartPoint[]): string {
  return points.map((p, k) => `${k === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}
