/**
 * trace-spans.ts — the neutral span model behind the trace waterfall (la Lente, 2026-10-25; the first of the
 * "custom Shrubbery components on top of Jaeger" that plans/2026-10-21-opentelemetry/DESIGN.md §6.1 chose).
 *
 * Pure: no DOM, no Lit. One neutral shape, two adapters:
 *   - `spansFromBenchRows`  — rows of the `perf` ledger's `bench:Span` SPARQL (plans/2026-10-25-perf/SCHEMA.md §4);
 *   - `spansFromOtlpLines`  — gardend's `GARDEN_OTEL_FILE` JSON lines (`trace_id`, `span_id`, `parent_span_id`,
 *                             `name`, `start_unix_nanos`, `end_unix_nanos`, `attributes`, `events`).
 * A Jaeger adapter later maps its query API's span objects onto `NeutralSpan` the same way; nothing below the
 * adapters knows where a span came from.
 *
 * Privacy: spans carry ids, counts, sizes, kinds and durations only. `trimOtlpAttributes` is the allow-list the OTLP
 * adapter applies so an untrimmed file can never put text on the screen (SCHEMA §1: "never text").
 */

import { formatNumber } from '@shrubbery/nucleus'

/** A span attribute value after trimming: a scalar, never nested. */
export type SpanAttrValue = string | number | boolean

/** The neutral span the waterfall draws. Offsets are milliseconds from the trace's start. */
export interface NeutralSpan {
  readonly spanId: string
  /** `null` for a root. A parent that is not in the set makes the span an orphan (see `buildSpanTree`). */
  readonly parentSpanId: string | null
  readonly name: string
  readonly startOffsetMs: number
  readonly durationMs: number
  /** Count of fsync events on this span itself (not its descendants). */
  readonly fsyncs: number
  readonly attrs: Readonly<Record<string, SpanAttrValue>>
}

export interface SpanNode {
  readonly span: NeutralSpan
  readonly depth: number
  readonly children: SpanNode[]
  /** Duration minus the union of the children's intervals (clipped to this span), never negative. */
  readonly selfMs: number
  /** True when `parentSpanId` named a span that is not in the set: the node was lifted to a root. */
  readonly orphan: boolean
}

export interface SpanForest {
  /** Roots in start order: true roots first by time, orphans interleaved by time. */
  readonly roots: readonly SpanNode[]
  readonly byId: ReadonlyMap<string, SpanNode>
  readonly orphanCount: number
  /** Spans dropped because their id repeated an earlier span. */
  readonly duplicateCount: number
  /** End of the latest span (offset ms), 0 for an empty forest. */
  readonly totalMs: number
  readonly spanCount: number
}

const ZERO_PARENT = /^0+$/

/** True for the spellings a root's parent takes: absent, empty, or all zeros (OTLP's "no parent"). */
export function isRootParent(parentSpanId: string | null | undefined): boolean {
  return parentSpanId == null || parentSpanId === '' || ZERO_PARENT.test(parentSpanId)
}

/** Length of the union of `[start, end]` intervals, clipped to `[clipStart, clipEnd]`. */
export function unionLengthMs(
  intervals: readonly (readonly [number, number])[],
  clipStart: number,
  clipEnd: number,
): number {
  const clipped: Array<[number, number]> = []
  for (const [a, b] of intervals) {
    const start = Math.max(a, clipStart)
    const end = Math.min(b, clipEnd)
    if (end > start) clipped.push([start, end])
  }
  clipped.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  let total = 0
  let curStart = 0
  let curEnd = 0
  let open = false
  for (const [start, end] of clipped) {
    if (!open) {
      curStart = start
      curEnd = end
      open = true
    } else if (start <= curEnd) {
      if (end > curEnd) curEnd = end
    } else {
      total += curEnd - curStart
      curStart = start
      curEnd = end
    }
  }
  if (open) total += curEnd - curStart
  return total
}

/** A span's self time given its children: duration minus the union of the children, floored at 0. */
export function selfTimeMs(span: NeutralSpan, children: readonly NeutralSpan[]): number {
  const start = span.startOffsetMs
  const end = start + span.durationMs
  const covered = unionLengthMs(
    children.map((c) => [c.startOffsetMs, c.startOffsetMs + c.durationMs] as const),
    start,
    end,
  )
  return Math.max(0, span.durationMs - covered)
}

function compareSpans(a: NeutralSpan, b: NeutralSpan): number {
  return a.startOffsetMs - b.startOffsetMs || b.durationMs - a.durationMs || (a.spanId < b.spanId ? -1 : a.spanId > b.spanId ? 1 : 0)
}

interface MutableNode {
  span: NeutralSpan
  depth: number
  children: MutableNode[]
  selfMs: number
  orphan: boolean
  parent: MutableNode | null
}

/**
 * Build the forest. Rules:
 *   - a repeated `spanId` keeps the first span and counts the rest in `duplicateCount`;
 *   - a root parent (`isRootParent`) or a span naming itself as parent is a root;
 *   - a parent that is absent from the set makes the span an ORPHAN root (`orphan: true`): the span is kept and drawn,
 *     never silently dropped (a trace can be partial: SCHEMA §1 "unjoined" work);
 *   - a parent cycle (A under B under A) is broken at the earliest member, which becomes an orphan root;
 *   - an empty input is a valid, empty forest (the "no server spans joined" case).
 */
export function buildSpanTree(spans: readonly NeutralSpan[]): SpanForest {
  const nodes = new Map<string, MutableNode>()
  let duplicateCount = 0
  for (const span of spans) {
    if (nodes.has(span.spanId)) {
      duplicateCount += 1
      continue
    }
    nodes.set(span.spanId, { span, depth: 0, children: [], selfMs: 0, orphan: false, parent: null })
  }

  const roots: MutableNode[] = []
  for (const node of nodes.values()) {
    const parentId = node.span.parentSpanId
    if (isRootParent(parentId) || parentId === node.span.spanId) {
      roots.push(node)
      continue
    }
    const parent = nodes.get(parentId as string)
    if (!parent) {
      node.orphan = true
      roots.push(node)
      continue
    }
    node.parent = parent
    parent.children.push(node)
  }

  // Reachability from the roots; whatever is unreachable sits in a parent cycle.
  const reached = new Set<MutableNode>()
  const mark = (start: MutableNode): void => {
    const stack = [start]
    while (stack.length) {
      const next = stack.pop() as MutableNode
      if (reached.has(next)) continue
      reached.add(next)
      stack.push(...next.children)
    }
  }
  for (const root of roots) mark(root)
  const stranded = [...nodes.values()].filter((n) => !reached.has(n)).sort((a, b) => compareSpans(a.span, b.span))
  for (const node of stranded) {
    if (reached.has(node)) continue
    if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node)
    node.parent = null
    node.orphan = true
    roots.push(node)
    mark(node)
  }

  let totalMs = 0
  const finish = (node: MutableNode, depth: number): void => {
    node.depth = depth
    node.children.sort((a, b) => compareSpans(a.span, b.span))
    node.selfMs = selfTimeMs(node.span, node.children.map((c) => c.span))
    totalMs = Math.max(totalMs, node.span.startOffsetMs + node.span.durationMs)
    for (const child of node.children) finish(child, depth + 1)
  }
  roots.sort((a, b) => compareSpans(a.span, b.span))
  for (const root of roots) finish(root, 0)

  return {
    roots,
    byId: nodes,
    orphanCount: roots.filter((r) => r.orphan).length,
    duplicateCount,
    totalMs,
    spanCount: nodes.size,
  }
}

/** Depth-first visible rows, skipping the descendants of every collapsed span. */
export function flattenVisible(forest: SpanForest, collapsed: ReadonlySet<string>): SpanNode[] {
  const out: SpanNode[] = []
  const walk = (node: SpanNode): void => {
    out.push(node)
    if (collapsed.has(node.span.spanId)) return
    for (const child of node.children) walk(child)
  }
  for (const root of forest.roots) walk(root)
  return out
}

/** Span ids that have children: the ones a collapse toggle applies to. */
export function expandableIds(forest: SpanForest): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const node of forest.byId.values()) if (node.children.length > 0) ids.add(node.span.spanId)
  return ids
}

/** Traces larger than this open collapsed below `DEFAULT_OPEN_DEPTH` (a GUI case is one trace of 1,000+ spans). */
export const LARGE_TRACE_SPANS = 300
export const DEFAULT_OPEN_DEPTH = 2

/** The ids to start collapsed: for a large trace every parent at depth >= `openDepth`; for a small one, none. */
export function defaultCollapsed(forest: SpanForest, openDepth: number = DEFAULT_OPEN_DEPTH): ReadonlySet<string> {
  const ids = new Set<string>()
  if (forest.spanCount <= LARGE_TRACE_SPANS) return ids
  for (const node of forest.byId.values()) if (node.children.length > 0 && node.depth >= openDepth) ids.add(node.span.spanId)
  return ids
}

/**
 * The slowest path: from the longest root, repeatedly step into the child with the longest duration (ties: the earlier
 * start). Returns the ids root-first. This is "where did the wall time go" as one chain, not a critical-path proof.
 */
export function slowestPathIds(forest: SpanForest): string[] {
  const path: string[] = []
  let node: SpanNode | undefined = [...forest.roots].sort((a, b) => b.span.durationMs - a.span.durationMs)[0]
  while (node) {
    path.push(node.span.spanId)
    let best: SpanNode | undefined
    for (const child of node.children) {
      if (!best || child.span.durationMs > best.span.durationMs) best = child
    }
    node = best
  }
  return path
}

export interface SelfTimeRow {
  readonly name: string
  readonly selfMsTotal: number
  readonly n: number
}

/** Where the time went: self time summed by span name, largest first (the shape of SCHEMA's `topSelfTime`). */
export function topSelfTime(forest: SpanForest, limit = 10): SelfTimeRow[] {
  const byName = new Map<string, { selfMsTotal: number; n: number }>()
  for (const node of forest.byId.values()) {
    const row = byName.get(node.span.name) ?? { selfMsTotal: 0, n: 0 }
    row.selfMsTotal += node.selfMs
    row.n += 1
    byName.set(node.span.name, row)
  }
  return [...byName.entries()]
    .map(([name, row]) => ({ name, selfMsTotal: row.selfMsTotal, n: row.n }))
    .sort((a, b) => b.selfMsTotal - a.selfMsTotal || (a.name < b.name ? -1 : 1))
    .slice(0, limit)
}

// ── adapter 1: the ledger's bench:Span rows ──────────────────────────────────────────────────────────────────────────

/** A SPARQL row with every term already reduced to its plain lexical text. */
export type PlainRow = Readonly<Record<string, string>>

/** Parse the `bench:attrsJson` literal. Anything that is not a flat object of scalars yields `{}` (never throws). */
export function parseAttrsJson(text: string | undefined): Record<string, SpanAttrValue> {
  if (!text) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Record<string, SpanAttrValue> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'boolean') out[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}

function finiteNumber(text: string | undefined, fallback = 0): number {
  if (text === undefined || text === '') return fallback
  const n = Number(text)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Rows of the lens' spans query (`?spanId ?parentSpanId ?name ?start ?dur ?fsyncs ?attrs`) to neutral spans. A row
 * without a `spanId` is skipped; a missing name becomes the span id; negative or non-numeric numbers become 0.
 */
export function spansFromBenchRows(rows: readonly PlainRow[]): NeutralSpan[] {
  const spans: NeutralSpan[] = []
  for (const row of rows) {
    const spanId = row.spanId
    if (!spanId) continue
    const parent = row.parentSpanId
    spans.push({
      spanId,
      parentSpanId: isRootParent(parent) ? null : (parent as string),
      name: row.name || spanId,
      startOffsetMs: Math.max(0, finiteNumber(row.start)),
      durationMs: Math.max(0, finiteNumber(row.dur)),
      fsyncs: Math.max(0, Math.trunc(finiteNumber(row.fsyncs))),
      attrs: parseAttrsJson(row.attrs),
    })
  }
  return spans
}

// ── adapter 2: gardend's OTLP JSON lines ─────────────────────────────────────────────────────────────────────────────

/** One line of `GARDEN_OTEL_FILE`, loosely typed: the adapter validates field by field. */
export interface OtlpLine {
  readonly trace_id?: unknown
  readonly span_id?: unknown
  readonly parent_span_id?: unknown
  readonly name?: unknown
  readonly start_unix_nanos?: unknown
  readonly end_unix_nanos?: unknown
  readonly attributes?: unknown
  readonly events?: unknown
}

const ATTR_ALLOW_PREFIXES = ['sophia.', 'http.', 'rpc.', 'otel.', 'db.system', 'db.operation', 'thread.', 'code.', 'url.path', 'server.']
const ATTR_DENY = /(^|\.)(text|prompt|content|body|statement|query_text)$|query\.text/i
const ATTR_MAX_STRING = 120

/**
 * The attributes a waterfall may show. Allow-list by key prefix, deny-list for content-bearing keys (`db.query.text`,
 * `*.prompt`, `*.body`…), scalars only, strings capped at 120 characters. This mirrors what the ledger keeps
 * (SCHEMA §1: "only sophia.* and otel/http/rpc keys whose values are ids, counts, sizes, kinds or durations").
 */
export function trimOtlpAttributes(raw: unknown): Record<string, SpanAttrValue> {
  const out: Record<string, SpanAttrValue> = {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ATTR_ALLOW_PREFIXES.some((p) => key.startsWith(p))) continue
    if (ATTR_DENY.test(key)) continue
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
    else if (typeof value === 'boolean') out[key] = value
    else if (typeof value === 'string' && value.length <= ATTR_MAX_STRING) out[key] = value
  }
  return out
}

function nanosToMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value / 1e6 : null
  if (typeof value === 'bigint') return Number(value) / 1e6
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(BigInt(value)) / 1e6
  return null
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Group parsed OTLP lines by trace id, converting each trace to neutral spans (offsets from that trace's earliest start). */
export function groupOtlpTraces(lines: readonly (OtlpLine | null | undefined)[]): Map<string, NeutralSpan[]> {
  interface Raw { line: OtlpLine; spanId: string; startMs: number; endMs: number }
  const byTrace = new Map<string, Raw[]>()
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue
    const traceId = asId(line.trace_id)
    const spanId = asId(line.span_id)
    const startMs = nanosToMs(line.start_unix_nanos)
    const endMs = nanosToMs(line.end_unix_nanos)
    if (!traceId || !spanId || startMs === null || endMs === null) continue
    const list = byTrace.get(traceId) ?? []
    list.push({ line, spanId, startMs, endMs })
    byTrace.set(traceId, list)
  }
  const out = new Map<string, NeutralSpan[]>()
  for (const [traceId, raws] of byTrace) {
    const origin = Math.min(...raws.map((r) => r.startMs))
    out.set(
      traceId,
      raws.map(({ line, spanId, startMs, endMs }) => {
        const events = Array.isArray(line.events) ? line.events : []
        const fsyncs = events.filter((e) => e !== null && typeof e === 'object' && (e as { name?: unknown }).name === 'fsync').length
        const parent = asId(line.parent_span_id)
        return {
          spanId,
          parentSpanId: isRootParent(parent) ? null : parent,
          name: typeof line.name === 'string' && line.name ? line.name : spanId,
          startOffsetMs: startMs - origin,
          durationMs: Math.max(0, endMs - startMs),
          fsyncs,
          attrs: trimOtlpAttributes(line.attributes),
        }
      }),
    )
  }
  return out
}

/** Parse a JSON-lines blob; malformed lines are skipped and counted. */
export function parseOtlpJsonLines(text: string): { lines: OtlpLine[]; malformed: number } {
  const lines: OtlpLine[] = []
  let malformed = 0
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    try {
      const value: unknown = JSON.parse(trimmed)
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) lines.push(value as OtlpLine)
      else malformed += 1
    } catch {
      malformed += 1
    }
  }
  return { lines, malformed }
}

/**
 * One trace out of OTLP lines. With `traceId`, exactly that trace (empty when absent); without, the trace with the
 * most spans (ties: the earliest-seen), so a file of one call needs no argument.
 */
export function spansFromOtlpLines(lines: readonly (OtlpLine | null | undefined)[], traceId?: string): NeutralSpan[] {
  const traces = groupOtlpTraces(lines)
  if (traceId !== undefined) return traces.get(traceId) ?? []
  let best: NeutralSpan[] = []
  for (const spans of traces.values()) if (spans.length > best.length) best = spans
  return best
}

/** Milliseconds for people: `0.42 ms`, `123 ms`, `9.65 s`. Locale-aware digits; null/NaN is an em dash. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '\u2014'
  const abs = Math.abs(ms)
  if (abs >= 1000) return `${formatNumber(ms / 1000, { maximumFractionDigits: 2 })} s`
  if (abs >= 100) return `${formatNumber(ms, { maximumFractionDigits: 0 })} ms`
  if (abs >= 10) return `${formatNumber(ms, { maximumFractionDigits: 1 })} ms`
  return `${formatNumber(ms, { maximumFractionDigits: 2 })} ms`
}
