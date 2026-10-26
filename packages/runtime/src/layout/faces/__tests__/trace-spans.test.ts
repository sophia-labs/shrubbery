/**
 * trace-spans.test.ts — the neutral span model: tree building (orphans, the unjoined/empty case, duplicates, cycles),
 * self time, collapse, the slowest path, and both adapters (ledger rows, gardend OTLP JSON lines).
 */
import { describe, expect, it } from 'vitest'
import {
  buildSpanTree,
  defaultCollapsed,
  expandableIds,
  flattenVisible,
  formatMs,
  groupOtlpTraces,
  parseAttrsJson,
  parseOtlpJsonLines,
  selfTimeMs,
  slowestPathIds,
  spansFromBenchRows,
  spansFromOtlpLines,
  topSelfTime,
  trimOtlpAttributes,
  unionLengthMs,
  type NeutralSpan,
} from '../trace-spans.js'

function span(spanId: string, parentSpanId: string | null, startOffsetMs: number, durationMs: number, extra: Partial<NeutralSpan> = {}): NeutralSpan {
  return { spanId, parentSpanId, name: extra.name ?? `span-${spanId}`, startOffsetMs, durationMs, fsyncs: extra.fsyncs ?? 0, attrs: extra.attrs ?? {} }
}

describe('buildSpanTree', () => {
  it('nests children under parents, in start order, with depth', () => {
    const forest = buildSpanTree([span('c2', 'a', 60, 10), span('a', null, 0, 100), span('c1', 'a', 10, 30), span('g', 'c1', 12, 5)])
    expect(forest.roots.map((r) => r.span.spanId)).toEqual(['a'])
    const a = forest.byId.get('a')!
    expect(a.children.map((c) => c.span.spanId)).toEqual(['c1', 'c2'])
    expect(forest.byId.get('g')!.depth).toBe(2)
    expect(forest.totalMs).toBe(100)
    expect(forest.spanCount).toBe(4)
    expect(forest.orphanCount).toBe(0)
  })

  it('lifts a span whose parent is missing to an orphan root and keeps it', () => {
    const forest = buildSpanTree([span('a', null, 0, 100), span('lost', 'ghost', 90, 8), span('k', 'lost', 91, 2)])
    expect(forest.roots.map((r) => r.span.spanId)).toEqual(['a', 'lost'])
    expect(forest.byId.get('lost')!.orphan).toBe(true)
    expect(forest.byId.get('a')!.orphan).toBe(false)
    expect(forest.byId.get('k')!.depth).toBe(1)
    expect(forest.orphanCount).toBe(1)
  })

  it('treats empty, null and all-zero parents as roots', () => {
    const forest = buildSpanTree([span('a', '', 0, 5), span('b', '0000000000000000', 6, 5), span('c', null, 12, 5)])
    expect(forest.roots).toHaveLength(3)
    expect(forest.orphanCount).toBe(0)
  })

  it('the unjoined case: no spans at all is a valid empty forest', () => {
    const forest = buildSpanTree([])
    expect(forest.roots).toEqual([])
    expect(forest.spanCount).toBe(0)
    expect(forest.totalMs).toBe(0)
    expect(flattenVisible(forest, new Set())).toEqual([])
  })

  it('keeps the first of a repeated span id and counts the rest', () => {
    const forest = buildSpanTree([span('a', null, 0, 10, { name: 'first' }), span('a', null, 0, 99, { name: 'second' })])
    expect(forest.spanCount).toBe(1)
    expect(forest.duplicateCount).toBe(1)
    expect(forest.byId.get('a')!.span.name).toBe('first')
  })

  it('breaks a parent cycle at the earliest member and keeps every span reachable', () => {
    const forest = buildSpanTree([span('x', 'y', 5, 10), span('y', 'x', 2, 10), span('self', 'self', 20, 1)])
    const seen = new Set(flattenVisible(forest, new Set()).map((n) => n.span.spanId))
    expect(seen).toEqual(new Set(['x', 'y', 'self']))
    expect(forest.byId.get('y')!.orphan).toBe(true)
    expect(forest.byId.get('x')!.depth).toBe(1)
  })
})

describe('self time', () => {
  it('unionLengthMs merges overlaps and clips to the window', () => {
    expect(unionLengthMs([[0, 10], [5, 15], [20, 30]], 0, 100)).toBe(25)
    expect(unionLengthMs([[-5, 5], [95, 120]], 0, 100)).toBe(10)
    expect(unionLengthMs([], 0, 100)).toBe(0)
  })

  it('subtracts sequential children', () => {
    expect(selfTimeMs(span('p', null, 0, 100), [span('a', 'p', 0, 30), span('b', 'p', 40, 20)])).toBe(50)
  })

  it('does not double-count parallel (overlapping) children', () => {
    expect(selfTimeMs(span('p', null, 0, 100), [span('a', 'p', 10, 50), span('b', 'p', 30, 50)])).toBe(30)
  })

  it('never goes negative when children overrun the parent', () => {
    expect(selfTimeMs(span('p', null, 0, 10), [span('a', 'p', 0, 50)])).toBe(0)
  })

  it('is computed on every node of the tree and rolls up by name', () => {
    const forest = buildSpanTree([span('r', null, 0, 100, { name: 'root' }), span('a', 'r', 0, 40, { name: 'work' }), span('b', 'r', 50, 40, { name: 'work' })])
    expect(forest.byId.get('r')!.selfMs).toBe(20)
    expect(forest.byId.get('a')!.selfMs).toBe(40)
    expect(topSelfTime(forest)).toEqual([
      { name: 'work', selfMsTotal: 80, n: 2 },
      { name: 'root', selfMsTotal: 20, n: 1 },
    ])
  })
})

describe('collapse and the slowest path', () => {
  const deep = [
    span('r', null, 0, 100), span('a', 'r', 0, 60), span('b', 'r', 60, 30),
    span('a1', 'a', 0, 40), span('a2', 'a', 40, 10), span('a1x', 'a1', 0, 35),
  ]
  it('flattenVisible skips the descendants of a collapsed span', () => {
    const forest = buildSpanTree(deep)
    expect(flattenVisible(forest, new Set()).map((n) => n.span.spanId)).toEqual(['r', 'a', 'a1', 'a1x', 'a2', 'b'])
    expect(flattenVisible(forest, new Set(['a'])).map((n) => n.span.spanId)).toEqual(['r', 'a', 'b'])
    expect([...expandableIds(forest)].sort()).toEqual(['a', 'a1', 'r'])
  })

  it('defaultCollapsed leaves a small trace open and collapses a large one below depth 2', () => {
    expect(defaultCollapsed(buildSpanTree(deep)).size).toBe(0)
    const big: NeutralSpan[] = [span('r', null, 0, 1000), span('m', 'r', 0, 900), span('d', 'm', 0, 800)]
    for (let i = 0; i < 400; i += 1) big.push(span(`leaf${i}`, 'd', i, 1))
    const collapsed = defaultCollapsed(buildSpanTree(big))
    expect([...collapsed]).toEqual(['d'])
    const visible = flattenVisible(buildSpanTree(big), collapsed)
    expect(visible.map((n) => n.span.spanId)).toEqual(['r', 'm', 'd'])
  })

  it('slowestPathIds follows the longest child from the longest root', () => {
    expect(slowestPathIds(buildSpanTree(deep))).toEqual(['r', 'a', 'a1', 'a1x'])
    expect(slowestPathIds(buildSpanTree([]))).toEqual([])
  })
})

describe('spansFromBenchRows (the ledger adapter)', () => {
  it('maps SPARQL rows, defaulting what is missing and skipping rows with no span id', () => {
    const spans = spansFromBenchRows([
      { spanId: 'aa', name: 'root', start: '0.0', dur: '120.5', fsyncs: '3', attrs: '{"sophia.lease.wait_ms":12,"note":"x","nested":{"a":1}}' },
      { spanId: 'bb', parentSpanId: 'aa', name: 'child', start: '10', dur: '5' },
      { spanId: 'cc', parentSpanId: '0000000000000000', start: 'oops', dur: '-3' },
      { name: 'no id' },
    ])
    expect(spans).toHaveLength(3)
    expect(spans[0]).toEqual({ spanId: 'aa', parentSpanId: null, name: 'root', startOffsetMs: 0, durationMs: 120.5, fsyncs: 3, attrs: { 'sophia.lease.wait_ms': 12, note: 'x' } })
    expect(spans[1]!.parentSpanId).toBe('aa')
    expect(spans[1]!.fsyncs).toBe(0)
    expect(spans[2]).toMatchObject({ parentSpanId: null, name: 'cc', startOffsetMs: 0, durationMs: 0 })
  })

  it('parseAttrsJson tolerates garbage', () => {
    expect(parseAttrsJson('not json')).toEqual({})
    expect(parseAttrsJson('[1,2]')).toEqual({})
    expect(parseAttrsJson(undefined)).toEqual({})
    expect(parseAttrsJson('{"a":true,"b":1.5,"c":null}')).toEqual({ a: true, b: 1.5 })
  })
})

describe('spansFromOtlpLines (gardend GARDEN_OTEL_FILE)', () => {
  const T0 = 1_792_902_600_000_000_000
  const line = (o: Record<string, unknown>) => ({ trace_id: 't1', parent_span_id: '', attributes: {}, events: [], ...o })
  const lines = [
    line({ span_id: 'r', name: 'tools/call x', start_unix_nanos: T0, end_unix_nanos: T0 + 100_000_000, events: [{ name: 'fsync', attributes: { 'sophia.fsync.ms': 4 } }, { name: 'fsync' }, { name: 'other' }] }),
    line({ span_id: 'c', parent_span_id: 'r', name: 'crdt.op.apply', start_unix_nanos: T0 + 10_000_000, end_unix_nanos: T0 + 70_000_000, attributes: { 'sophia.queue.wait_ms': 3 } }),
    line({ trace_id: 't2', span_id: 'z', name: 'other trace', start_unix_nanos: T0, end_unix_nanos: T0 + 1_000_000 }),
  ]

  it('converts nanos to ms offsets from the trace start, counts fsync events, and picks the biggest trace by default', () => {
    const spans = spansFromOtlpLines(lines)
    expect(spans.map((s) => s.spanId)).toEqual(['r', 'c'])
    expect(spans[0]).toMatchObject({ parentSpanId: null, startOffsetMs: 0, fsyncs: 2 })
    expect(spans[0]!.durationMs).toBeCloseTo(100, 3)
    expect(spans[1]!.startOffsetMs).toBeCloseTo(10, 3)
    expect(spans[1]!.attrs).toEqual({ 'sophia.queue.wait_ms': 3 })
  })

  it('selects a trace by id and returns [] for an unknown one', () => {
    expect(spansFromOtlpLines(lines, 't2').map((s) => s.spanId)).toEqual(['z'])
    expect(spansFromOtlpLines(lines, 'nope')).toEqual([])
    expect([...groupOtlpTraces(lines).keys()].sort()).toEqual(['t1', 't2'])
  })

  it('accepts nanos as digit strings and skips lines missing ids or times', () => {
    const spans = spansFromOtlpLines([
      line({ span_id: 'a', start_unix_nanos: String(T0), end_unix_nanos: String(T0 + 5_000_000) }),
      line({ span_id: 'b' }),
      { trace_id: 't1', start_unix_nanos: T0, end_unix_nanos: T0 },
      null,
    ])
    expect(spans.map((s) => s.spanId)).toEqual(['a'])
  })

  it('trims attributes to ids, counts and durations: no text, no foreign keys, no long strings', () => {
    expect(
      trimOtlpAttributes({
        'sophia.graph.id': 'bench-m-1',
        'sophia.lease.wait_ms': 12,
        'http.response.status_code': 200,
        'db.query.text': 'SELECT ?s WHERE { ?s ?p ?o }',
        'sophia.prompt': 'hello',
        'sophia.debug.note': 'x'.repeat(400),
        'user.email': 'a@b.c',
        'sophia.nested': { a: 1 },
        'sophia.ok': true,
      }),
    ).toEqual({ 'sophia.graph.id': 'bench-m-1', 'sophia.lease.wait_ms': 12, 'http.response.status_code': 200, 'sophia.ok': true })
  })

  it('parseOtlpJsonLines counts malformed lines', () => {
    const { lines: ok, malformed } = parseOtlpJsonLines('{"a":1}\n\nnot json\n[1]\n{"b":2}\n')
    expect(ok).toHaveLength(2)
    expect(malformed).toBe(2)
  })
})

describe('formatMs', () => {
  it('scales units and survives nothing', () => {
    expect(formatMs(0.424)).toBe('0.42 ms')
    expect(formatMs(12.34)).toBe('12.3 ms')
    expect(formatMs(123.4)).toBe('123 ms')
    expect(formatMs(9650)).toBe('9.65 s')
    expect(formatMs(null)).toBe('—')
    expect(formatMs(Number.NaN)).toBe('—')
  })
})
