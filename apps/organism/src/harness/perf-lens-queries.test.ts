/**
 * perf-lens-queries.test.ts — the bench dashboard's REAL SPARQL against a REAL Oxigraph store holding the synthetic
 * ledger (fixtures/perf-ledger.nt, SCHEMA §4), in a named graph. No mocks: an unwrapped pattern would return zero rows
 * here exactly as on a cell, so passing proves the GRAPH ?g wrapping. Also drives <sh-bench-dashboard> end to end.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Oxigraph from 'oxigraph'
import type { Term } from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'
import type { RestClient } from '@shrubbery/nucleus'
import { inferQueryBlockQueryKind, makeQueryBlockService, type QueryBlockService } from '@shrubbery/runtime'
import {
  BENCH_PREFIX,
  SPAN_PAGE,
  buildSpanTree,
  caseResultsQuery,
  compareRuns,
  exemplarsQuery,
  filterByKind,
  mapCaseResultRows,
  mapRunRows,
  mapSeriesRows,
  parseOtlpJsonLines,
  plainRows,
  runsQuery,
  seriesQuery,
  spansFromBenchRows,
  spansFromOtlpLines,
  spansQuery,
  type ShBenchDashboard,
} from '@shrubbery/runtime/layout'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const BASELINE = '20261025T020000Z-baseline-019463f'
const LAST = '20261025T043000Z-fsync-batch-e4f5a6b'

let service: QueryBlockService
let store: InstanceType<typeof Oxigraph.Store>

beforeAll(async () => {
  const init = (Oxigraph as unknown as { readonly default?: unknown }).default
  if (typeof init === 'function') await (init as () => Promise<unknown>)()
  store = new Oxigraph.Store()
  store.load(readFileSync(resolve(dir, 'perf-ledger.nt'), 'utf8'), {
    format: 'application/n-triples',
    to_graph_name: Oxigraph.namedNode('urn:mnemosyne:local:graph:perf:user:rdf'),
  })
  const rest = {
    query: async (_graphId: string, sparql: string) => {
      if (inferQueryBlockQueryKind(sparql) !== 'select') throw new Error('select only')
      const result = store.query(sparql) as Array<Map<string, Term>>
      const variables: string[] = []
      const rows = result.map((solution) => {
        const row: Record<string, string> = {}
        for (const [variable, term] of solution) {
          if (!variables.includes(variable)) variables.push(variable)
          row[variable] = term.toString()
        }
        return row
      })
      return { resultType: 'solutions', variables, rows }
    },
  } as unknown as RestClient
  service = makeQueryBlockService(rest)
})

describe('the ledger queries against a real store', () => {
  it('an unwrapped pattern returns nothing (the trap the lens avoids)', async () => {
    const result = await service.run('perf', `${BENCH_PREFIX}\nSELECT ?run WHERE { ?run bench:runId ?id }`, 10)
    expect(plainRows(result)).toEqual([])
  })

  it('(a) lists the runs newest first, with the baseline flag', async () => {
    const runs = mapRunRows(plainRows(await service.run('perf', runsQuery(), 500)))
    expect(runs.map((r) => r.runId)).toEqual([LAST, '20261025T031500Z-lease-split-a1b2c3d', BASELINE])
    expect(runs.map((r) => r.isBaseline)).toEqual([false, false, true])
    expect(runs[2]).toMatchObject({ gitRev: '019463f', suite: 'standard', tier: 'm', loadBefore1m: 2.1 })
  })

  it('(b)(d) compares a run with the baseline and filters by kind', async () => {
    const base = mapCaseResultRows(plainRows(await service.run('perf', caseResultsQuery(BASELINE), 500)))
    const cur = mapCaseResultRows(plainRows(await service.run('perf', caseResultsQuery(LAST), 500)))
    expect(base.length).toBeGreaterThan(40)
    const rows = compareRuns(base, cur)
    const edit = rows.find((r) => r.caseId === 'write.edit_block_text.book')!
    expect(edit.p50.verdict).toBe('faster')
    expect(edit.fsyncs.verdict).toBe('faster')
    expect(edit.base!.p50Ms).toBeGreaterThan(9000)
    expect(rows.find((r) => r.caseId === 'read.get_workspace')!.p50.verdict).toBe('slower')
    expect(rows.find((r) => r.caseId === 'read.sparql.count')!.p50.verdict).toBe('same')
    expect(filterByKind(rows, 'gui').length).toBeGreaterThan(3)
    expect(filterByKind(rows, 'rich').map((r) => r.family)).toContain('whiteboard')
    const gui = rows.find((r) => r.caseId === 'gui.doc.type.book')!
    expect(gui.current!.inputToPaintP50Ms).not.toBeNull()
    expect(gui.current!.requestBytes).not.toBeNull()
  })

  it('(c) returns one case across runs in time order', async () => {
    const points = mapSeriesRows(plainRows(await service.run('perf', seriesQuery('write.edit_block_text.book'), 500)))
    expect(points.map((p) => p.gitRev)).toEqual(['019463f', 'a1b2c3d', 'e4f5a6b'])
    expect(points[0]!.p50Ms).toBeGreaterThan(points[1]!.p50Ms)
    expect(points[1]!.p50Ms).toBeGreaterThan(points[2]!.p50Ms)
  })

  it('reads an exemplar and builds its tree, orphan included', async () => {
    const ex = plainRows(await service.run('perf', exemplarsQuery(BASELINE, 'write.edit_block_text.book'), 50))
    expect(ex).toHaveLength(1)
    const spans = spansFromBenchRows(plainRows(await service.run('perf', spansQuery(ex[0]!.exemplar!), SPAN_PAGE)))
    expect(spans).toHaveLength(80)
    const forest = buildSpanTree(spans)
    expect(forest.orphanCount).toBe(1)
    expect(forest.roots[0]!.span.name).toBe('tools/call edit_block_text')
  })

  it('pages a 1,000+ span GUI exemplar completely', async () => {
    const ex = plainRows(await service.run('perf', exemplarsQuery(LAST, 'gui.doc.type.book'), 50))
    const all: Array<Record<string, string>> = []
    for (let page = 0; page < 10; page += 1) {
      const rows = plainRows(await service.run('perf', spansQuery(ex[0]!.exemplar!, page * SPAN_PAGE), SPAN_PAGE))
      all.push(...rows)
      if (rows.length < SPAN_PAGE) break
    }
    expect(all).toHaveLength(1050)
    expect(new Set(all.map((r) => r.spanId)).size).toBe(1050)
  })
})

describe('the OTLP fixture', () => {
  it('adapts to the same tree shape and never carries query text', () => {
    const { lines, malformed } = parseOtlpJsonLines(readFileSync(resolve(dir, 'perf-spans.jsonl'), 'utf8'))
    expect(malformed).toBe(0)
    const spans = spansFromOtlpLines(lines)
    expect(spans).toHaveLength(56)
    expect(spans.some((s) => 'db.query.text' in s.attrs)).toBe(false)
    expect(spans.some((s) => 'sophia.debug.note' in s.attrs)).toBe(false)
    expect(buildSpanTree(spans).roots).toHaveLength(1)
    expect(spans.reduce((n, s) => n + s.fsyncs, 0)).toBeGreaterThan(0)
  })
})

describe('<sh-bench-dashboard> over the real store', () => {
  it('loads the ledger and renders runs, the comparison, the chart and a trace', async () => {
    const element = document.createElement('sh-bench-dashboard') as ShBenchDashboard
    element.graphId = 'perf'
    element.service = service
    document.body.append(element)
    for (let i = 0; i < 200 && element.shadowRoot?.querySelector('.page')?.getAttribute('data-status') !== 'ready'; i += 1) {
      await new Promise((r) => setTimeout(r, 25))
    }
    await element.updateComplete
    const root = element.shadowRoot!
    expect(root.querySelectorAll('tr[data-run-id]')).toHaveLength(3)
    expect(root.querySelectorAll('tr[data-case-id]').length).toBeGreaterThan(40)
    expect(root.querySelector('svg.chart')).not.toBeNull()
    expect(root.querySelector('tr.family')).not.toBeNull()
    const kinds = [...root.querySelectorAll('button[data-kind]')].map((b) => b.getAttribute('data-kind'))
    expect(kinds).toEqual(expect.arrayContaining(['read', 'write', 'rich', 'gui']))
    const trace = root.querySelector('sh-trace-waterfall') as (HTMLElement & { updateComplete: Promise<boolean> }) | null
    expect(trace).not.toBeNull()
    await trace!.updateComplete
    expect(trace!.shadowRoot!.querySelectorAll('.row').length).toBeGreaterThan(5)
    element.remove()
  })
})
