/**
 * perf-lens-main.ts — the perf lens harness (la Lente, 2026-10-25): `<sh-bench-dashboard>` and `<sh-trace-waterfall>`
 * over a SYNTHETIC `perf` ledger, with no gardend running.
 *
 * NO MOCKS: the ledger (`fixtures/perf-ledger.nt`, plans/2026-10-25-perf/SCHEMA.md §4) is loaded into a REAL Oxigraph
 * store, in a NAMED graph, and the dashboard's real SPARQL (GRAPH-wrapped, as against a cell) runs against it through
 * the production `makeQueryBlockService` seam. An unwrapped pattern would return zero rows here exactly as on a cell.
 *
 * The second waterfall is fed by the OTHER adapter: gardend `GARDEN_OTEL_FILE` JSON lines
 * (`fixtures/perf-spans.jsonl`, which carries a content-bearing `db.query.text` the adapter must trim).
 *
 * Regenerate the fixtures: `node apps/organism/scripts/gen-perf-ledger-fixture.mjs`.
 */
import '@shrubbery/tokens/tokens.css'
import { applySkinTheme } from '@shrubbery/tokens'
import { localeSource, type RestClient } from '@shrubbery/nucleus'
import {
  makeQueryBlockService,
  inferQueryBlockQueryKind,
} from '@shrubbery/runtime'
// Registers <sh-bench-dashboard> and <sh-trace-waterfall>; the type imports below are erased.
import '@shrubbery/runtime/layout'
import {
  parseOtlpJsonLines,
  spansFromOtlpLines,
  type ShBenchDashboard,
  type ShTraceWaterfall,
} from '@shrubbery/runtime/layout'
import * as Oxigraph from 'oxigraph'
import type { Term } from 'oxigraph'
import LEDGER_NT from './fixtures/perf-ledger.nt?raw'
import OTLP_JSONL from './fixtures/perf-spans.jsonl?raw'

/** Where a cell keeps user triples; any named graph proves the GRAPH ?g wrapping. */
const LEDGER_GRAPH_ID = 'perf'
const LEDGER_GRAPH_IRI = 'urn:mnemosyne:local:graph:perf:user:rdf'

let wasmReady: Promise<void> | null = null
/** The browser entry exposes an async initializer; the Node entry initializes itself (same distinction room-mirror.ts keeps). */
function prepareOxigraph(): Promise<void> {
  if (!wasmReady) {
    const init = (Oxigraph as unknown as { readonly default?: unknown }).default
    wasmReady = typeof init === 'function' ? Promise.resolve((init as () => Promise<unknown>)()).then(() => {}) : Promise.resolve()
  }
  return wasmReady
}

/** SELECT through a real store, shaped as the cell's solutions envelope (term.toString() per binding). */
function solutionsEnvelope(store: InstanceType<typeof Oxigraph.Store>, sparql: string): unknown {
  if (inferQueryBlockQueryKind(sparql) !== 'select') throw new Error('perf-lens harness: only SELECT is served')
  const result = store.query(sparql)
  if (!Array.isArray(result)) throw new Error('perf-lens harness: SELECT did not return solution mappings')
  const variables: string[] = []
  const rows = (result as Array<Map<string, Term>>).map((solution) => {
    const row: Record<string, string> = {}
    for (const [variable, term] of solution) {
      if (!variables.includes(variable)) variables.push(variable)
      row[variable] = term.toString()
    }
    return row
  })
  return { resultType: 'solutions', variables, rows, boolean: null, graph: null }
}

const statusEl = document.querySelector<HTMLElement>('#perf-lens-status')!
const benchRoot = document.querySelector<HTMLElement>('#bench-root')!
const otlpRoot = document.querySelector<HTMLElement>('#otlp-root')!

declare global {
  interface Window {
    __perfLens?: {
      readonly ready: boolean
      readonly dashboard: ShBenchDashboard
      readonly otlpWaterfall: ShTraceWaterfall
      readonly queries: readonly string[]
    }
  }
}

async function boot(): Promise<void> {
  await prepareOxigraph()
  const store = new Oxigraph.Store()
  store.load(LEDGER_NT, { format: 'application/n-triples', to_graph_name: Oxigraph.namedNode(LEDGER_GRAPH_IRI) })

  const queries: string[] = []
  const rest = {
    query: async (_graphId: string, sparql: string) => {
      queries.push(sparql)
      return solutionsEnvelope(store, sparql)
    },
  } as unknown as RestClient
  const service = makeQueryBlockService(rest)

  const dashboard = document.createElement('sh-bench-dashboard') as ShBenchDashboard
  dashboard.graphId = LEDGER_GRAPH_ID
  dashboard.service = service
  benchRoot.replaceChildren(dashboard)

  const otlpWaterfall = document.createElement('sh-trace-waterfall') as ShTraceWaterfall
  const { lines, malformed } = parseOtlpJsonLines(OTLP_JSONL)
  otlpWaterfall.heading = `write.edit_block_text.book · OTLP file (${lines.length} lines, ${malformed} malformed)`
  otlpWaterfall.spans = spansFromOtlpLines(lines)
  otlpRoot.append(otlpWaterfall)

  window.__perfLens = { ready: true, dashboard, otlpWaterfall, queries }
  document.body.dataset.perfLensReady = 'true'
  statusEl.textContent = `${store.size} quads loaded`
}

// Skin / theme / language toggles (QA only; the same attributes applySkinTheme stamps on <html>).
applySkinTheme({ skin: 'garden', theme: 'light' })
const root = document.documentElement
document.querySelector('#perf-lens-bar')!.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLButtonElement)) return
  if (target.dataset.skin) {
    if (target.dataset.skin === 'garden') delete root.dataset.skin
    else root.dataset.skin = target.dataset.skin
  } else if (target.dataset.themeToggle) {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'
    target.textContent = root.dataset.theme === 'dark' ? 'light' : 'dark'
  } else if (target.dataset.lang) {
    localeSource.set(target.dataset.lang === 'ja' ? 'ja' : 'en')
  }
})

void boot().catch((error: unknown) => {
  document.body.dataset.perfLensError = error instanceof Error ? (error.stack ?? error.message) : String(error)
  statusEl.textContent = `failed: ${error instanceof Error ? error.message : String(error)}`
})
