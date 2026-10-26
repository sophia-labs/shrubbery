#!/usr/bin/env node
// gen-perf-ledger-fixture.mjs — writes the synthetic `perf` ledger the bench dashboard harness renders without a gardend.
//
//   node apps/organism/scripts/gen-perf-ledger-fixture.mjs
//
// Output (deterministic; same bytes every run):
//   src/harness/fixtures/perf-ledger.nt     N-Triples conforming to plans/2026-10-25-perf/SCHEMA.md §4
//   src/harness/fixtures/perf-spans.jsonl   gardend OTLP JSON lines (GARDEN_OTEL_FILE shape) for one trace
//
// The numbers are SYNTHETIC: plausible, not measured. Book edits are ~10 s, reads tens of ms. Three runs (the first is
// the baseline), a lease-split step and an fsync-batching step, so the hill-climb has a shape. One case is missing from
// the middle run and one span is deliberately orphaned, so one-sided rows and orphans show up in the views.
// No document text anywhere: ids, counts, durations. (One OTLP attribute, `db.query.text`, is synthetic query text
// placed there on purpose to prove the adapter trims it.)
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../src/harness/fixtures')
mkdirSync(outDir, { recursive: true })

const NS = 'https://sophia-labs.com/ns/bench#'
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = mulberry32(20261025)
const hex = (n) => Array.from({ length: n }, () => Math.floor(rng() * 16).toString(16)).join('')
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d

// ── N-Triples writer ────────────────────────────────────────────────────────────────────────────────────────────────
const lines = []
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
const I = (iri) => `<${iri}>`
const str = (s) => `"${esc(String(s))}"`
const int = (n) => `"${Math.trunc(n)}"^^<${XSD}integer>`
const dec = (n) => `"${Number.isInteger(n) ? n.toFixed(1) : String(n)}"^^<${XSD}decimal>`
const bool = (b) => `"${b ? 'true' : 'false'}"^^<${XSD}boolean>`
const dt = (s) => `"${s}"^^<${XSD}dateTime>`
const add = (s, p, o) => lines.push(`${I(s)} ${I(p)} ${o} .`)
const B = (local) => NS + local

// ── cases ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// [caseId, base p50 ms, p95/p50 ratio, base fsyncs/op, lease-split factor, fsync-batch factor]
// kind = first dotted segment of the case id (SCHEMA §3).
const CASES = [
  ['read.read_document.small', 18, 1.6, 0, 1.0, 1.0],
  ['read.read_document.book_page', 42, 1.7, 0, 1.0, 1.0],
  ['read.read_blocks.book', 65, 1.5, 0, 1.0, 1.0],
  ['read.list_documents', 24, 1.4, 0, 1.0, 1.0],
  ['read.search_documents', 55, 1.8, 0, 0.97, 1.0],
  ['read.sparql.count', 12, 1.5, 0, 1.0, 1.0],
  ['read.sparql.titles', 30, 1.6, 0, 1.0, 1.0],
  ['read.sparql.wires_2hop', 88, 2.1, 0, 1.0, 1.0],
  ['read.get_backlinks', 21, 1.5, 0, 1.0, 1.0],
  ['read.get_workspace', 140, 1.9, 0, 1.12, 1.0],
  ['read.context_bundle', 210, 1.8, 0, 1.0, 1.0],
  ['read.document_digest.book', 95, 1.6, 0, 1.0, 1.0],
  ['write.insert_blocks.small', 410, 1.5, 9, 0.9, 0.55],
  ['write.insert_blocks.book', 8200, 1.3, 21, 0.85, 0.6],
  ['write.edit_block_text.small', 380, 1.5, 8, 0.9, 0.55],
  ['write.edit_block_text.book', 9650, 1.25, 23, 0.8, 0.6],
  ['write.edit_comment.small', 360, 1.5, 8, 0.92, 0.55],
  ['write.create_document', 520, 1.4, 11, 0.95, 0.6],
  ['write.write_document.medium', 1800, 1.4, 17, 0.9, 0.62],
  ['write.create_wires', 450, 1.5, 9, 0.95, 0.58],
  ['write.create_folder', 300, 1.4, 7, 0.97, 0.6],
  ['write.create_restore_point', 2600, 1.3, 14, 1.0, 0.7],
  ['burst.insert_blocks.same_doc_x8', 7400, 1.5, 24, 0.5, 0.6],
  ['burst.insert_blocks.distinct_docs_x8', 3100, 1.4, 12, 0.7, 0.65],
  ['burst.read_under_write', 640, 2.6, 0, 0.35, 1.0],
  ['scale.create_documents', 900, 1.6, 12, 0.95, 0.7],
  ['ws.typing.book', 85, 2.2, 0, 0.7, 1.0],
  ['ws.open.book', 1300, 1.4, 0, 1.0, 1.0],
  ['boot.cold_start', 2400, 1.1, 0, 1.0, 1.0],
  ['boot.first_read', 800, 1.2, 0, 1.0, 1.0],
  ['boot.first_sparql', 3100, 1.2, 0, 1.0, 0.98],
  // rich.<family>.*: gardend's fancier data types, headless (SCHEMA §7)
  ['rich.whiteboard.create', 640, 1.4, 10, 0.95, 0.6],
  ['rich.whiteboard.apply_large', 2900, 1.4, 16, 0.85, 0.6],
  ['rich.emporium.write', 520, 1.5, 9, 0.9, 0.6],
  ['rich.emporium.sweep', 1400, 1.3, 0, 1.0, 1.0],
  ['rich.workflow.plan_compose', 880, 1.5, 11, 0.95, 0.62],
  ['rich.artifact.ingest_pdf', 5200, 1.3, 18, 1.0, 0.8],
  ['rich.semantic.search', 160, 1.7, 0, 1.0, 1.0],
  ['rich.memory.recall', 210, 1.6, 0, 1.0, 1.0],
  ['rich.rdf.load_100k', 4200, 1.2, 40, 0.98, 0.7],
  ['rich.rdf.sparql_update', 430, 1.5, 8, 0.95, 0.6],
  // gui.*: Shrubbery in WebKit (SCHEMA §7); carry the browser block
  ['gui.app.cold_load', 2100, 1.3, 0, 1.0, 1.0],
  ['gui.app.warm_load', 780, 1.3, 0, 1.0, 1.0],
  ['gui.doc.open.book', 1900, 1.4, 0, 0.85, 0.9],
  ['gui.doc.type.book', 74, 2.1, 0, 0.8, 0.95],
  ['gui.doc.scroll.book', 22, 1.8, 0, 1.0, 1.0],
  ['gui.board.draw', 48, 1.9, 0, 0.9, 1.0],
  ['gui.persona.curious', 310, 2.4, 0, 0.9, 0.9],
]
const kindOf = (caseId) => caseId.split('.')[0]

// ── runs ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const RUNS = [
  { runId: '20261025T020000Z-baseline-019463f', label: 'baseline-019463f', startedAt: '2026-10-25T02:00:00.000Z', gitRev: '019463f', load: 2.1, rss: 910, baseline: true, step: 0, skip: [], jitter: 0.012 },
  { runId: '20261025T031500Z-lease-split-a1b2c3d', label: 'lease-split-a1b2c3d', startedAt: '2026-10-25T03:15:00.000Z', gitRev: 'a1b2c3d', load: 1.4, rss: 884, baseline: false, step: 1, skip: ['boot.first_sparql'], jitter: 0.02 },
  { runId: '20261025T043000Z-fsync-batch-e4f5a6b', label: 'fsync-batch-e4f5a6b', startedAt: '2026-10-25T04:30:00.000Z', gitRev: 'e4f5a6b', load: 1.2, rss: 861, baseline: false, step: 2, skip: [], jitter: 0.02 },
]

const runIri = (run) => `urn:sophia:bench:run:${run.runId}`
const caseIri = (caseId) => `urn:sophia:bench:case:${caseId}@v1`
const resultIri = (run, caseId) => `${runIri(run)}/case/${caseId}`

// ── exemplar traces ─────────────────────────────────────────────────────────────────────────────────────────────────
// Build a span tree for a tool call of `wall` ms with exactly `count` spans. Phases are laid out sequentially inside
// their parent; filler children (reconcile batches, history reads) soak up the remaining count.
function buildTrace({ wall, count, fsyncTotal, leaseWait, orphan, rootName = 'tools/call edit_block_text' }) {
  const spans = []
  const mk = (name, parent, start, dur, extra = {}) => {
    const span = { spanId: hex(16), parentSpanId: parent ? parent.spanId : null, name, startOffsetMs: round(start, 2), durationMs: round(Math.max(0.01, dur), 2), fsyncs: extra.fsyncs ?? 0, attrs: extra.attrs ?? {} }
    spans.push(span)
    return span
  }
  const root = mk(rootName, null, 0, wall, { attrs: { 'rpc.system': 'mcp', 'rpc.method': 'tools/call', 'sophia.tool.name': 'edit_block_text', 'sophia.graph.id': 'bench-m-1' } })
  let cursor = wall * 0.004
  const seq = (name, parent, weight, extra) => {
    const dur = wall * weight
    const span = mk(name, parent, cursor, dur, extra)
    cursor += dur
    return span
  }
  seq('mcp.dispatch', root, 0.004, { attrs: { 'rpc.service': 'edit_block_text' } })
  seq('crdt.queue.wait', root, 0.07, { attrs: { 'sophia.queue.wait_ms': round(wall * 0.07, 1) } })
  const applyStart = cursor
  const apply = seq('crdt.op.apply', root, 0.86, { attrs: { 'sophia.crdt.op': 'edit_block_text', 'sophia.doc.blocks': 2500 } })
  cursor = applyStart + wall * 0.004
  seq('graph.lease.hot_write', apply, 0.02 + leaseWait / wall, { attrs: { 'sophia.lease.wait_ms': leaseWait, 'sophia.lease.held_ms': round(wall * 0.78, 0), 'sophia.lease.outcome': 'acquired' } })
  seq('document.materialize_projection', apply, 0.17, { attrs: { 'sophia.projection.blocks': 2500 } })
  const fs = (n) => Math.max(0, Math.round(fsyncTotal * n))
  seq('storage.write_record', apply, 0.08, { fsyncs: fs(0.15), attrs: { 'sophia.storage.bytes': 1843200 } })
  const reconcile = seq('document.rdf.reconcile', apply, 0.3, { attrs: { 'sophia.rdf.quads': 31400 } })
  const snapshot = seq('document.history.snapshot', apply, 0.22, { fsyncs: fs(0.1), attrs: { 'sophia.history.entries': 4200 } })
  seq('response.serialize', root, 0.01, { attrs: { 'http.response.body.size': 612 } })
  // filler: reconcile batches (2 spans each: batch + quad write) and history reads (1 span each)
  const fixed = spans.length
  let remaining = count - fixed - (orphan ? 1 : 0)
  const batches = Math.max(0, Math.floor((remaining * 0.7) / 2))
  const reads = Math.max(0, remaining - batches * 2)
  const slot = (reconcile.durationMs * 0.9) / Math.max(1, batches)
  for (let k = 0; k < batches; k += 1) {
    const start = reconcile.startOffsetMs + reconcile.durationMs * 0.05 + k * slot
    const batch = mk('rdf.reconcile.batch', reconcile, start, slot * 0.92, { attrs: { 'sophia.rdf.batch': k, 'sophia.rdf.quads': 200 + Math.floor(rng() * 40) } })
    mk('rdf.quad.write', batch, start + slot * 0.1, slot * 0.6, { fsyncs: k % 6 === 0 ? 1 : 0, attrs: { 'sophia.rdf.quads': 200 } })
  }
  const rslot = (snapshot.durationMs * 0.8) / Math.max(1, reads)
  for (let k = 0; k < reads; k += 1) {
    mk('history.store.read', snapshot, snapshot.startOffsetMs + snapshot.durationMs * 0.05 + k * rslot, rslot * 0.85, { attrs: { 'sophia.history.chunk': k, 'sophia.history.bytes': 40960 } })
  }
  if (orphan) {
    // Work that left the request: its parent span was never exported, so it joins no tree.
    const missingParent = hex(16)
    const span = mk('projection.debounced_flush', null, wall * 0.9, wall * 0.08, { attrs: { 'sophia.projection.reason': 'debounce' } })
    span.parentSpanId = missingParent
  }
  return spans
}

const EXEMPLARS = [
  // [run index, caseId, rank, wall ms, span count, fsync total, lease wait, orphan]
  [0, 'write.edit_block_text.book', 1, 11240, 80, 23, 640, true],
  [2, 'write.edit_block_text.book', 1, 5310, 56, 9, 38, false],
  [2, 'read.context_bundle', 1, 262, 22, 0, 0, false],
  // a GUI case is ONE trace for the whole case: 1,000+ spans (the waterfall opens collapsed below depth 2)
  [2, 'gui.doc.type.book', 1, 31800, 1050, 60, 120, false, 'gui.case gui.doc.type.book'],
]

// ── emit ────────────────────────────────────────────────────────────────────────────────────────────────────────────
for (const [caseId] of CASES) {
  const c = caseIri(caseId)
  add(c, RDF_TYPE, I(B('Case')))
  add(c, B('caseId'), str(caseId))
  add(c, B('caseVersion'), int(1))
  add(c, B('kind'), str(kindOf(caseId)))
  add(c, RDFS_LABEL, str(caseId))
}

const exemplarLines = []
for (const [runIndex, run] of RUNS.entries()) {
  const r = runIri(run)
  add(r, RDF_TYPE, I(B('Run')))
  add(r, B('runId'), str(run.runId))
  add(r, B('label'), str(run.label))
  add(r, B('startedAt'), dt(run.startedAt))
  add(r, B('mode'), str('spawn'))
  add(r, B('suite'), str('standard'))
  add(r, B('tier'), str('m'))
  add(r, B('seed'), int(1))
  add(r, B('protocolVersion'), int(1))
  add(r, B('gitRev'), str(run.gitRev))
  add(r, B('version'), str(`gardend 0.1.4 (storage format 1) (${run.gitRev})`))
  add(r, B('binarySha256'), str(hex(64)))
  add(r, B('host'), str('bench-host-1'))
  add(r, B('loadBefore1m'), dec(run.load))
  add(r, B('rssPeakMB'), int(run.rss))
  add(r, B('isBaseline'), bool(run.baseline))

  for (const [caseId, base, ratio, baseFsyncs, leaseFactor, fsyncFactor] of CASES) {
    if (run.skip.includes(caseId)) continue
    const factor = (run.step >= 1 ? leaseFactor : 1) * (run.step >= 2 ? fsyncFactor : 1)
    const noise = 1 + (rng() * 2 - 1) * run.jitter
    const p50 = round(base * factor * noise, base < 100 ? 1 : 0)
    const p95 = round(p50 * ratio * (1 + (rng() - 0.5) * 0.06), base < 100 ? 1 : 0)
    const p99 = round(p95 * 1.12, base < 100 ? 1 : 0)
    const mean = round(p50 * 1.04, base < 100 ? 1 : 0)
    const maxMs = round(p99 * 1.18, base < 100 ? 1 : 0)
    const fsyncsPerOp = Math.round(baseFsyncs * (run.step >= 2 ? fsyncFactor : 1))
    const kind = kindOf(caseId)
    const x = resultIri(run, caseId)
    add(x, RDF_TYPE, I(B('CaseResult')))
    add(x, B('run'), I(r))
    add(x, B('case'), I(caseIri(caseId)))
    add(x, B('n'), int(kind === 'burst' ? 12 : base > 5000 ? 12 : 30))
    add(x, B('errors'), int(0))
    add(x, B('meanMs'), dec(mean))
    add(x, B('p50Ms'), dec(p50))
    add(x, B('p95Ms'), dec(p95))
    add(x, B('p99Ms'), dec(p99))
    add(x, B('maxMs'), dec(maxMs))
    if (kind === 'write' || kind === 'burst' || kind === 'scale') add(x, B('fsyncsPerOpP50'), int(fsyncsPerOp))
    if (kind === 'write' || kind === 'burst') {
      const wait = round((kind === 'burst' ? p50 * 0.35 : p50 * 0.05) * (run.step >= 1 ? leaseFactor : 1), 0)
      add(x, B('leaseWaitP95Ms'), dec(wait))
      add(x, B('leaseHoldP95Ms'), dec(round(p95 * 0.8, 0)))
      add(x, B('queueWaitP95Ms'), dec(round(p95 * 0.06, 0)))
    }
    if (kind === 'gui') {
      const itp50 = round(p50 * (caseId.includes('.type.') || caseId.includes('draw') || caseId.includes('scroll') ? 0.9 : 0.35), 1)
      add(x, B('inputToPaintP50Ms'), dec(itp50))
      add(x, B('inputToPaintP95Ms'), dec(round(itp50 * 1.9, 1)))
      add(x, B('longFrameCount'), int(Math.max(0, Math.round((p50 / 120) * factor))))
      add(x, B('longFrameMsTotal'), dec(round(p50 * 0.4 * factor, 0)))
      add(x, B('requests'), int(Math.round(40 + p50 / 60)))
      add(x, B('requestBytes'), int(Math.round((220000 + p50 * 350) * (run.step >= 1 ? 0.9 : 1))))
    }
    if (caseId === 'scale.create_documents') add(x, B('slopeMsPer100'), dec(run.step >= 1 ? 31.5 : 38.2))

    for (const [exRun, exCase, rank, wall, count, fsyncTotal, leaseWait, orphan, rootName] of EXEMPLARS) {
      if (exRun !== runIndex || exCase !== caseId) continue
      const e = `${x}/exemplar/${rank}`
      const traceId = hex(32)
      add(e, RDF_TYPE, I(B('Exemplar')))
      add(e, B('caseResult'), I(x))
      add(e, B('rank'), int(rank))
      add(e, B('traceId'), str(traceId))
      add(e, B('wallMs'), dec(wall))
      const spans = buildTrace({ wall, count, fsyncTotal, leaseWait, orphan, rootName })
      for (const s of spans) {
        const sIri = `${e}/span/${s.spanId}`
        add(sIri, RDF_TYPE, I(B('Span')))
        add(sIri, B('exemplar'), I(e))
        add(sIri, B('spanId'), str(s.spanId))
        if (s.parentSpanId) add(sIri, B('parentSpanId'), str(s.parentSpanId))
        add(sIri, B('name'), str(s.name))
        add(sIri, B('startOffsetMs'), dec(s.startOffsetMs))
        add(sIri, B('durationMs'), dec(s.durationMs))
        add(sIri, B('fsyncs'), int(s.fsyncs))
        add(sIri, B('attrsJson'), str(JSON.stringify(s.attrs)))
      }
      if (runIndex === 2 && caseId === 'write.edit_block_text.book') exemplarLines.push({ traceId, wall, spans })
    }
  }
}

writeFileSync(resolve(outDir, 'perf-ledger.nt'), `${lines.join('\n')}\n`)

// ── the OTLP lines for the first run-3 exemplar: gardend's GARDEN_OTEL_FILE shape ───────────────────────────────────
const trace = exemplarLines[0]
const originNanos = BigInt(Date.UTC(2026, 9, 25, 4, 30, 0)) * 1000000n // 2026-10-25T04:30:00Z
const otlp = trace.spans.map((s) => {
  const startNanos = originNanos + BigInt(Math.round(s.startOffsetMs * 1e6))
  const endNanos = startNanos + BigInt(Math.round(s.durationMs * 1e6))
  const events = Array.from({ length: s.fsyncs }, (_, k) => ({ name: 'fsync', time_unix_nanos: Number(startNanos + BigInt(k)), attributes: { 'sophia.fsync.ms': round(4 + rng() * 6, 2), 'sophia.fsync.what': 'record' } }))
  const attributes = { ...s.attrs }
  // Synthetic content-bearing keys the adapter must trim; they never reach the screen.
  if (s.name === 'document.rdf.reconcile') attributes['db.query.text'] = 'SELECT ?s WHERE { GRAPH ?g { ?s ?p ?o } }'
  if (s.name === 'tools/call edit_block_text') attributes['sophia.debug.note'] = 'x'.repeat(400)
  return JSON.stringify({
    trace_id: trace.traceId,
    span_id: s.spanId,
    parent_span_id: s.parentSpanId ?? '',
    name: s.name,
    start_unix_nanos: Number(startNanos),
    end_unix_nanos: Number(endNanos),
    attributes,
    events,
  })
})
writeFileSync(resolve(outDir, 'perf-spans.jsonl'), `${otlp.join('\n')}\n`)

const exCount = EXEMPLARS.length
process.stdout.write(`perf-ledger.nt: ${lines.length} triples, ${RUNS.length} runs, ${CASES.length} cases, ${exCount} exemplars; perf-spans.jsonl: ${otlp.length} lines\n`)
