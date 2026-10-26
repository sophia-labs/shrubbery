/**
 * bench-dashboard-element.ts — `<sh-bench-dashboard>`: the `perf` ledger graph made legible (la Lente, 2026-10-25).
 *
 * One component, four parts (the lane's brief) plus the trace:
 *   (a) the runs list, newest first: label, git revision, suite/tier, load, baseline flag;
 *   (b) a run against a baseline, per case: p50, p95, fsyncs/op, change in percent and a faster/slower/same mark;
 *   (c) the hill-climb: one case's p50 and p95 across runs in time order, the x axis labelled by git revision;
 *   (d) a kind filter (read, write, burst, scale, ws, boot) over (b), and the case list for (c).
 *   +   the slowest calls of the charted case, each as a `<sh-trace-waterfall>`.
 *
 * It reads ONLY through the injected `QueryBlockService` (the production seam every query face uses), with the
 * fixed, GRAPH-wrapped SPARQL of bench-model.ts. It renders ids, counts and durations: the ledger holds nothing else.
 * The change mark is SCHEMA §2's ±5% rule on medians, labelled as a display hint; the verdict of record is
 * `gbench compare`.
 */
import { LocaleController, formatDate, formatNumber, t } from '@shrubbery/nucleus'
import { LitElement, css, html, nothing, svg, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import type { QueryBlockService } from '../../editor-services/query-block-service.js'
import {
  BENCH_KINDS,
  caseResultsQuery,
  chartGeometry,
  compareRuns,
  defaultComparePair,
  deltaVerdict,
  exemplarsQuery,
  filterByKind,
  kindsPresent,
  linePath,
  mapCaseResultRows,
  mapRunRows,
  mapSeriesRows,
  plainRows,
  runsQuery,
  seriesLabel,
  seriesQuery,
  spansQuery,
  SPAN_PAGE,
  type BenchCaseResult,
  type BenchCompareRow,
  type BenchDelta,
  type BenchKindFilter,
  type BenchRunSummary,
  type BenchSeriesPoint,
  type BenchVerdict,
} from './bench-model.js'
import { formatMs, spansFromBenchRows, type NeutralSpan, type PlainRow } from './trace-spans.js'

function deltaOf(base: number | null | undefined, current: number | null | undefined): BenchDelta {
  return deltaVerdict(base ?? null, current ?? null)
}
import './trace-waterfall-element.js'

/** Safety cap: 20 pages of 500 = 10,000 spans. */
const MAX_SPAN_PAGES = 20

type Status = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

interface ExemplarChoice {
  readonly iri: string
  readonly rank: number
  readonly wallMs: number | null
}

const VERDICT_GLYPH: Readonly<Record<BenchVerdict, string>> = { faster: '▼', slower: '▲', same: '=', none: '–' }

/** `+12.3%` / `-8.0%` / `0.0%`; an em dash when there is nothing to compare. */
export function formatDeltaPct(delta: BenchDelta): string {
  if (delta.deltaPct === null) return '—'
  const magnitude = formatNumber(Math.abs(delta.deltaPct), { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${delta.deltaPct > 0 ? '+' : delta.deltaPct < 0 ? '-' : ''}${magnitude}%`
}

@customElement('sh-bench-dashboard')
export class ShBenchDashboard extends LitElement {
  protected readonly _locale = new LocaleController(this)

  /** The read seam. Setting it (or `graphId`) reloads the ledger. */
  @property({ attribute: false }) service: QueryBlockService | null = null
  @property({ type: String, attribute: 'graph-id' }) graphId = 'perf'

  @state() private status: Status = 'idle'
  @state() private errorMessage = ''
  @state() private runs: readonly BenchRunSummary[] = []
  @state() private baseRunId: string | null = null
  @state() private currentRunId: string | null = null
  @state() private baseResults: readonly BenchCaseResult[] = []
  @state() private currentResults: readonly BenchCaseResult[] = []
  @state() private kind: BenchKindFilter = 'all'
  @state() private chartCaseId: string | null = null
  @state() private series: readonly BenchSeriesPoint[] = []
  @state() private exemplars: readonly ExemplarChoice[] = []
  @state() private exemplarRank: number | null = null
  @state() private spans: readonly NeutralSpan[] = []
  @state() private traceStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle'

  private generation = 0
  private loadedKey = ''
  private loadedService: QueryBlockService | null = null

  static styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      min-height: 100%;
      padding: var(--mn-space-4, 16px);
      background: var(--mn-color-surface-base);
      color: var(--mn-color-text-primary);
      font: var(--mn-text-sm, 13px) / 1.5 var(--mn-font-chrome, system-ui, sans-serif);
    }
    .page {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-4, 16px);
      max-width: 1180px;
      margin: 0 auto;
    }
    header.top {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--mn-space-3, 12px);
    }
    h2 {
      margin: 0;
      font-size: var(--mn-text-lg, 18px);
      font-weight: 650;
      color: var(--mn-color-text-title, var(--mn-color-text-primary));
    }
    h3 {
      margin: 0;
      font-size: var(--mn-text-sm, 13px);
      font-weight: 650;
      font-variant-caps: all-small-caps;
      letter-spacing: var(--mn-tracking-label, 0.05em);
      color: var(--mn-color-text-muted);
    }
    section {
      display: flex;
      flex-direction: column;
      gap: var(--mn-space-2, 8px);
      padding: var(--mn-space-3, 12px);
      background: var(--mn-color-surface-raised);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-surface, 8px);
      box-shadow: var(--mn-shadow-card);
      min-width: 0;
    }
    .row-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mn-space-2, 8px) var(--mn-space-3, 12px);
    }
    .grow {
      margin-inline-start: auto;
    }
    .muted {
      color: var(--mn-color-text-tertiary);
    }
    .hint {
      color: var(--mn-color-text-tertiary);
      font-size: var(--mn-text-xs, 12px);
    }
    .status {
      padding: var(--mn-space-6, 24px);
      text-align: center;
      color: var(--mn-color-text-tertiary);
      font-style: italic;
    }
    .status[data-tone='error'] {
      color: var(--mn-color-danger-strong);
      font-style: normal;
    }
    .scroll {
      overflow: auto;
      max-height: 420px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-variant-numeric: tabular-nums;
    }
    th,
    td {
      padding: 4px 10px;
      text-align: start;
      white-space: nowrap;
      border-top: 1px solid var(--mn-chart-grid, var(--mn-color-border-subtle));
    }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--mn-color-surface-raised);
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      border-top: 0;
      border-bottom: 1px solid var(--mn-color-border-default);
    }
    td.num,
    th.num {
      text-align: end;
    }
    tbody tr {
      cursor: pointer;
    }
    tbody tr:hover {
      background: var(--mn-color-surface-hover);
    }
    tbody tr[data-selected='true'] {
      background: var(--mn-color-surface-selected, var(--mn-color-surface-accent-subtle));
    }
    tbody tr:focus-visible,
    button:focus-visible,
    select:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent));
      outline-offset: -2px;
    }
    .mono {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
    }
    .pill {
      display: inline-block;
      padding: 0 8px;
      border-radius: var(--mn-radius-full, 9999px);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      background: var(--mn-color-surface-sunken);
      color: var(--mn-color-text-secondary);
    }
    .pill[data-tone='baseline'] {
      color: var(--mn-color-info-strong, var(--mn-color-accent-strong));
      background: var(--mn-color-info-surface, var(--mn-color-surface-accent-subtle));
    }
    .verdict {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px;
      border-radius: var(--mn-radius-full, 9999px);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
    }
    .verdict[data-verdict='faster'] {
      color: var(--mn-color-success-strong);
      background: var(--mn-color-success-surface);
    }
    .verdict[data-verdict='slower'] {
      color: var(--mn-color-danger-strong);
      background: var(--mn-color-danger-surface);
    }
    .verdict[data-verdict='same'],
    .verdict[data-verdict='none'] {
      color: var(--mn-color-text-tertiary);
      background: var(--mn-color-surface-sunken);
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    tr.family th {
      position: static;
      background: var(--mn-color-surface-sunken);
      color: var(--mn-color-text-secondary);
      border-bottom: 0;
    }
    .browser {
      margin-top: var(--mn-space-2, 8px);
    }
    .chips {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--mn-space-1, 4px);
    }
    button,
    select {
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-secondary);
      background: var(--mn-color-surface-base);
      border: 1px solid var(--mn-color-border-default);
      border-radius: var(--mn-radius-sm, 4px);
      padding: 3px 9px;
      cursor: pointer;
    }
    button:hover {
      background: var(--mn-color-surface-hover);
    }
    button[aria-pressed='true'] {
      color: var(--mn-color-on-accent, var(--mn-color-text-inverse));
      background: var(--mn-color-accent);
      border-color: var(--mn-color-accent);
    }
    label.field {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--mn-color-text-secondary);
      font-size: var(--mn-text-xs, 12px);
    }
    .chart-wrap {
      width: 100%;
      overflow: hidden;
    }
    svg.chart {
      display: block;
      width: 100%;
      height: auto;
      max-height: 320px;
    }
    .grid {
      stroke: var(--mn-chart-grid, var(--mn-color-border-subtle));
      stroke-width: 1;
    }
    .axis-text {
      fill: var(--mn-chart-axis, var(--mn-color-text-tertiary));
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    .line {
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .line-p50 {
      stroke: var(--mn-chart-categorical-1);
    }
    .line-p95 {
      stroke: var(--mn-chart-categorical-2);
      stroke-dasharray: 5 4;
    }
    .dot-p50 {
      fill: var(--mn-chart-categorical-1);
    }
    .dot-p95 {
      fill: var(--mn-color-surface-base);
      stroke: var(--mn-chart-categorical-2);
      stroke-width: 2;
    }
    .legend {
      display: inline-flex;
      gap: var(--mn-space-4, 16px);
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-secondary);
    }
    .swatch {
      display: inline-block;
      width: 18px;
      height: 0;
      margin-inline-end: 6px;
      vertical-align: middle;
      border-top: 2px solid var(--mn-chart-categorical-1);
    }
    .swatch[data-series='p95'] {
      border-top: 2px dashed var(--mn-chart-categorical-2);
    }
  `

  connectedCallback(): void {
    super.connectedCallback()
    this.maybeLoad()
  }

  protected willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('service') || changed.has('graphId')) this.maybeLoad()
  }

  private maybeLoad(): void {
    const key = `${this.graphId}`
    if (!this.service || !this.isConnected) return
    if (this.loadedKey === key && this.loadedService === this.service) return
    this.loadedKey = key
    this.loadedService = this.service
    void this.loadRuns()
  }

  /** Reload everything from the ledger. */
  refresh(): Promise<void> {
    return this.loadRuns()
  }

  private async loadRuns(): Promise<void> {
    const service = this.service
    if (!service) return
    const generation = ++this.generation
    this.status = 'loading'
    this.errorMessage = ''
    try {
      const result = await service.run(this.graphId, runsQuery(), 500)
      if (generation !== this.generation) return
      const runs = mapRunRows(plainRows(result))
      this.runs = runs
      if (runs.length === 0) {
        this.status = 'empty'
        return
      }
      const pair = defaultComparePair(runs)
      this.baseRunId = pair.baseRunId
      this.currentRunId = pair.currentRunId
      await this.loadComparison(generation)
      if (generation !== this.generation) return
      this.status = 'ready'
    } catch (error) {
      if (generation !== this.generation) return
      this.status = 'error'
      this.errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  private async fetchResults(runId: string | null): Promise<BenchCaseResult[]> {
    if (!runId || !this.service) return []
    const result = await this.service.run(this.graphId, caseResultsQuery(runId), 500)
    return mapCaseResultRows(plainRows(result))
  }

  private async loadComparison(generation: number): Promise<void> {
    const [base, current] = await Promise.all([this.fetchResults(this.baseRunId), this.fetchResults(this.currentRunId)])
    if (generation !== this.generation) return
    this.baseResults = base
    this.currentResults = current
    const available = current.length > 0 ? current : base
    const stillThere = this.chartCaseId !== null && available.some((r) => r.caseId === this.chartCaseId)
    if (!stillThere) {
      const slowest = [...available].sort((a, b) => (b.p50Ms ?? 0) - (a.p50Ms ?? 0))[0]
      this.chartCaseId = slowest?.caseId ?? null
    }
    await this.loadCase(generation)
  }

  private async loadCase(generation: number): Promise<void> {
    const caseId = this.chartCaseId
    const service = this.service
    this.exemplars = []
    this.exemplarRank = null
    this.spans = []
    this.traceStatus = 'idle'
    if (!caseId || !service) {
      this.series = []
      return
    }
    const seriesResult = await service.run(this.graphId, seriesQuery(caseId), 500)
    if (generation !== this.generation) return
    this.series = mapSeriesRows(plainRows(seriesResult))
    if (!this.currentRunId) return
    const exemplarResult = await service.run(this.graphId, exemplarsQuery(this.currentRunId, caseId), 50)
    if (generation !== this.generation) return
    this.exemplars = plainRows(exemplarResult)
      .filter((row) => row.exemplar && row.rank)
      .map((row) => ({ iri: row.exemplar as string, rank: Number(row.rank), wallMs: row.wallMs ? Number(row.wallMs) : null }))
    const first = this.exemplars[0]
    if (first) await this.loadSpans(first.rank, generation)
  }

  private async loadSpans(rank: number, generation: number = this.generation): Promise<void> {
    const service = this.service
    const choice = this.exemplars.find((e) => e.rank === rank)
    if (!service || !choice) return
    this.exemplarRank = rank
    this.traceStatus = 'loading'
    try {
      const rows: PlainRow[] = []
      for (let page = 0; page < MAX_SPAN_PAGES; page += 1) {
        const result = await service.run(this.graphId, spansQuery(choice.iri, page * SPAN_PAGE), SPAN_PAGE)
        if (generation !== this.generation || this.exemplarRank !== rank) return
        const got = plainRows(result)
        rows.push(...got)
        if (got.length < SPAN_PAGE) break
      }
      this.spans = spansFromBenchRows(rows)
      this.traceStatus = 'ready'
    } catch {
      if (generation !== this.generation) return
      this.spans = []
      this.traceStatus = 'error'
    }
  }

  private async chooseRuns(base: string | null, current: string | null): Promise<void> {
    this.baseRunId = base
    this.currentRunId = current
    const generation = ++this.generation
    try {
      await this.loadComparison(generation)
    } catch (error) {
      if (generation !== this.generation) return
      this.status = 'error'
      this.errorMessage = error instanceof Error ? error.message : String(error)
    }
  }

  private async chooseCase(caseId: string): Promise<void> {
    if (caseId === this.chartCaseId) return
    this.chartCaseId = caseId
    const generation = ++this.generation
    try {
      await this.loadCase(generation)
    } catch {
      /* a failed series read leaves the previous picture's emptiness; the table is unaffected */
    }
  }

  // ── rendering ───────────────────────────────────────────────────────────────────────────────────────────────────

  private runLabel(run: BenchRunSummary): string {
    return `${run.label || run.runId}${run.gitRev ? ` · ${run.gitRev}` : ''}`
  }

  private renderRuns(): TemplateResult {
    return html`
      <section aria-labelledby="runs-h">
        <div class="row-head">
          <h3 id="runs-h">${t('bench.runs')}</h3>
          <span class="muted">${t('bench.runsCount', { count: this.runs.length })}</span>
          <button class="grow" type="button" @click=${() => void this.refresh()}>${t('bench.refresh')}</button>
        </div>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>${t('bench.col.when')}</th>
                <th>${t('bench.col.label')}</th>
                <th>${t('bench.col.rev')}</th>
                <th>${t('bench.col.suite')}</th>
                <th class="num">${t('bench.col.load')}</th>
                <th>${t('bench.col.baseline')}</th>
              </tr>
            </thead>
            <tbody>
              ${this.runs.map((run) => html`
                <tr
                  tabindex="0"
                  data-run-id=${run.runId}
                  data-selected=${String(run.runId === this.currentRunId)}
                  title=${run.runId}
                  @click=${() => void this.chooseRuns(this.baseRunId === run.runId ? null : this.baseRunId, run.runId)}
                  @keydown=${(event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void this.chooseRuns(this.baseRunId === run.runId ? null : this.baseRunId, run.runId) } }}
                >
                  <td>${run.startedAt ? formatDate(new Date(run.startedAt), { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                  <td>${run.label || run.runId}</td>
                  <td class="mono">${run.gitRev || '—'}</td>
                  <td>${[run.suite, run.tier].filter(Boolean).join(' / ') || '—'}</td>
                  <td class="num">${run.loadBefore1m === null ? '—' : formatNumber(run.loadBefore1m, { maximumFractionDigits: 1 })}</td>
                  <td>${run.isBaseline ? html`<span class="pill" data-tone="baseline">${t('bench.baselineBadge')}</span>` : nothing}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      </section>
    `
  }

  private renderDelta(delta: BenchDelta): TemplateResult {
    return html`
      <span class="verdict" data-verdict=${delta.verdict} title=${t('bench.hint')}>
        <span aria-hidden="true">${VERDICT_GLYPH[delta.verdict]}</span>
        <span>${formatDeltaPct(delta)}</span>
        <span class="sr">${t(`bench.verdict.${delta.verdict}` as 'bench.verdict.same')}</span>
      </span>
    `
  }

  private renderCompareRow(row: BenchCompareRow): TemplateResult {
    const side = row.onlyIn
    return html`
      <tr
        tabindex="0"
        data-case-id=${row.caseId}
        data-selected=${String(row.caseId === this.chartCaseId)}
        @click=${() => void this.chooseCase(row.caseId)}
        @keydown=${(event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void this.chooseCase(row.caseId) } }}
      >
        <td class="mono">${row.caseId}${row.caseVersion > 1 ? html`<span class="muted">@v${row.caseVersion}</span>` : nothing}${side ? html` <span class="pill">${side === 'base' ? t('bench.onlyBase') : t('bench.onlyRun')}</span>` : nothing}</td>
        <td>${t(`bench.kind.${row.kind}` as 'bench.kind.read')}</td>
        <td class="num">${formatMs(row.base?.p50Ms)}</td>
        <td class="num">${formatMs(row.current?.p50Ms)}</td>
        <td>${this.renderDelta(row.p50)}</td>
        <td class="num">${formatMs(row.base?.p95Ms)}</td>
        <td class="num">${formatMs(row.current?.p95Ms)}</td>
        <td>${this.renderDelta(row.p95)}</td>
        <td class="num">${row.base?.fsyncsPerOpP50 ?? '—'} → ${row.current?.fsyncsPerOpP50 ?? '—'}</td>
      </tr>
    `
  }

  private renderCompare(): TemplateResult {
    const all = compareRuns(this.baseResults, this.currentResults)
    const rows = filterByKind(all, this.kind)
    const present = kindsPresent(all)
    return html`
      <section aria-labelledby="cmp-h">
        <div class="row-head">
          <h3 id="cmp-h">${t('bench.compare')}</h3>
          <label class="field">${t('bench.baselineSelect')}
            <select @change=${(event: Event) => void this.chooseRuns((event.target as HTMLSelectElement).value || null, this.currentRunId)}>
              <option value="" ?selected=${this.baseRunId === null}>—</option>
              ${this.runs.map((run) => html`<option value=${run.runId} ?selected=${run.runId === this.baseRunId}>${this.runLabel(run)}${run.isBaseline ? ` (${t('bench.baselineBadge')})` : ''}</option>`)}
            </select>
          </label>
          <label class="field">${t('bench.runSelect')}
            <select @change=${(event: Event) => void this.chooseRuns(this.baseRunId, (event.target as HTMLSelectElement).value || null)}>
              ${this.runs.map((run) => html`<option value=${run.runId} ?selected=${run.runId === this.currentRunId}>${this.runLabel(run)}</option>`)}
            </select>
          </label>
        </div>
        <div class="row-head" role="group" aria-label=${t('bench.kindFilter')}>
          <span class="muted">${t('bench.kindFilter')}</span>
          <span class="chips">
            <button type="button" aria-pressed=${String(this.kind === 'all')} @click=${() => { this.kind = 'all' }}>${t('bench.kind.all')}</button>
            ${BENCH_KINDS.filter((k) => present.includes(k)).map((k) => html`
              <button type="button" aria-pressed=${String(this.kind === k)} data-kind=${k} @click=${() => { this.kind = k }}>${t(`bench.kind.${k}` as 'bench.kind.read')}</button>
            `)}
          </span>
        </div>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>${t('bench.col.case')}</th>
                <th>${t('bench.col.kind')}</th>
                <th class="num">${t('bench.col.p50')} · ${t('bench.baselineShort')}</th>
                <th class="num">${t('bench.col.p50')} · ${t('bench.runShort')}</th>
                <th>${t('bench.col.delta')}</th>
                <th class="num">${t('bench.col.p95')} · ${t('bench.baselineShort')}</th>
                <th class="num">${t('bench.col.p95')} · ${t('bench.runShort')}</th>
                <th>${t('bench.col.delta')}</th>
                <th class="num">${t('bench.col.fsyncs')}</th>
              </tr>
            </thead>
            <tbody>${rows.map((row, i) => html`${row.family && row.family !== rows[i - 1]?.family
              ? html`<tr class="family" data-family=${row.family}><th colspan="9" scope="rowgroup">${row.family}</th></tr>`
              : nothing}${this.renderCompareRow(row)}`)}</tbody>
          </table>
        </div>
        <span class="hint">${t('bench.hint')}</span>
        ${this.renderBrowser(all)}
      </section>
    `
  }

  /** The GUI lane's browser block for the charted case (SCHEMA §7), baseline against run. Absent for non-GUI cases. */
  private renderBrowser(all: readonly BenchCompareRow[]): TemplateResult | typeof nothing {
    const row = all.find((r) => r.caseId === this.chartCaseId)
    if (!row || row.kind !== 'gui') return nothing
    const metrics: ReadonlyArray<readonly [string, BenchDelta, (v: number | null) => string]> = [
      ['bench.browser.inputToPaint', row.inputToPaint, formatMs],
      ['bench.browser.inputToPaint95', deltaOf(row.base?.inputToPaintP95Ms, row.current?.inputToPaintP95Ms), formatMs],
      ['bench.browser.longFrames', row.longFrames, (v) => (v === null ? '\u2014' : formatNumber(v))],
      ['bench.browser.longFrameMs', deltaOf(row.base?.longFrameMsTotal, row.current?.longFrameMsTotal), formatMs],
      ['bench.browser.requests', row.requests, (v) => (v === null ? '\u2014' : formatNumber(v))],
      ['bench.browser.bytes', deltaOf(row.base?.requestBytes, row.current?.requestBytes), (v) => (v === null ? '\u2014' : formatNumber(v))],
    ]
    return html`
      <div class="browser" data-case-id=${row.caseId}>
        <h3>${t('bench.browser')} \u00B7 <span class="mono">${row.caseId}</span></h3>
        <table>
          <thead><tr><th></th><th class="num">${t('bench.baselineShort')}</th><th class="num">${t('bench.runShort')}</th><th>${t('bench.col.delta')}</th></tr></thead>
          <tbody>
            ${metrics.map(([key, delta, fmt]) => html`<tr><td>${t(key as 'bench.browser')}</td><td class="num">${fmt(delta.base)}</td><td class="num">${fmt(delta.current)}</td><td>${this.renderDelta(delta)}</td></tr>`)}
          </tbody>
        </table>
      </div>
    `
  }

  private renderChart(): TemplateResult {
    const points = this.series
    const geometry = chartGeometry(points)
    const choices = filterByKind(this.currentResults.length > 0 ? this.currentResults : this.baseResults, this.kind)
    return html`
      <section aria-labelledby="hill-h">
        <div class="row-head">
          <h3 id="hill-h">${t('bench.chart')}</h3>
          <label class="field">${t('bench.chartCase')}
            <select @change=${(event: Event) => void this.chooseCase((event.target as HTMLSelectElement).value)}>
              ${choices.map((r) => html`<option value=${r.caseId} ?selected=${r.caseId === this.chartCaseId}>${r.caseId}</option>`)}
            </select>
          </label>
          <span class="legend grow" aria-hidden="true">
            <span><span class="swatch"></span>${t('bench.col.p50')}</span>
            <span><span class="swatch" data-series="p95"></span>${t('bench.col.p95')}</span>
          </span>
        </div>
        ${points.length === 0
          ? html`<div class="status">${this.chartCaseId ? t('bench.chartNone') : t('bench.pickCase')}</div>`
          : html`<div class="chart-wrap">
              <svg class="chart" viewBox="0 0 ${geometry.width} ${geometry.height}" role="img" aria-label=${t('bench.chartAria', { caseId: this.chartCaseId ?? '', count: points.length })}>
                ${geometry.yTicks.map((tick) => svg`
                  <line class="grid" x1=${geometry.plot.left} x2=${geometry.plot.right} y1=${tick.y} y2=${tick.y}></line>
                  <text class="axis-text" x=${geometry.plot.left - 8} y=${tick.y + 4} text-anchor="end">${formatMs(tick.value)}</text>
                `)}
                ${points.map((point, i) => svg`
                  <text class="axis-text" x=${geometry.xs[i] ?? 0} y=${geometry.plot.bottom + 18} text-anchor="middle">${seriesLabel(point)}</text>
                `)}
                <path class="line line-p95" d=${linePath(geometry.p95)}></path>
                <path class="line line-p50" d=${linePath(geometry.p50)}></path>
                ${geometry.p95.map((p) => svg`<circle class="dot-p95" cx=${p.x} cy=${p.y} r="4"><title>${points[p.i]?.runId} · p95 ${formatMs(points[p.i]?.p95Ms)}</title></circle>`)}
                ${geometry.p50.map((p) => svg`<circle class="dot-p50" cx=${p.x} cy=${p.y} r="4"><title>${points[p.i]?.runId} · p50 ${formatMs(points[p.i]?.p50Ms)}</title></circle>`)}
              </svg>
            </div>`}
      </section>
    `
  }

  private renderTrace(): TemplateResult | typeof nothing {
    if (!this.chartCaseId) return nothing
    const choice = this.exemplars.find((e) => e.rank === this.exemplarRank)
    return html`
      <section aria-labelledby="trace-h">
        <div class="row-head">
          <h3 id="trace-h">${t('bench.exemplars')}</h3>
          <span class="chips">
            ${this.exemplars.map((e) => html`
              <button type="button" aria-pressed=${String(e.rank === this.exemplarRank)} @click=${() => void this.loadSpans(e.rank)}>
                ${t('bench.exemplar', { rank: e.rank, ms: formatMs(e.wallMs) })}
              </button>
            `)}
          </span>
        </div>
        ${this.exemplars.length === 0
          ? html`<div class="status">${t('bench.exemplarNone')}</div>`
          : this.traceStatus === 'loading'
            ? html`<div class="status">${t('bench.loading')}</div>`
            : html`<sh-trace-waterfall
                .spans=${this.spans}
                .heading=${choice ? t('bench.traceHeading', { caseId: this.chartCaseId, rank: choice.rank, ms: formatMs(choice.wallMs) }) : ''}
              ></sh-trace-waterfall>`}
      </section>
    `
  }

  protected render(): TemplateResult {
    return html`
      <div class="page" data-status=${this.status}>
        <header class="top">
          <h2>${t('bench.title')}</h2>
          <span class="hint">${this.graphId}</span>
        </header>
        ${this.status === 'loading' || this.status === 'idle'
          ? html`<div class="status">${t('bench.loading')}</div>`
          : this.status === 'error'
            ? html`<div class="status" data-tone="error" role="alert">${t('bench.error', { message: this.errorMessage })}</div>`
            : this.status === 'empty'
              ? html`<div class="status">${t('bench.empty')}</div>`
              : html`${this.renderRuns()}${this.renderCompare()}${this.renderChart()}${this.renderTrace()}`}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-bench-dashboard': ShBenchDashboard
  }
}
