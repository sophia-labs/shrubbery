/** Host-side execution and DOM face for the pure editor-kernel QueryBlock. */

import type { RestClient } from '@shrubbery/nucleus'
import type {
  QueryBlockAttrs,
  QueryBlockRenderer,
  QueryBlockVisualization,
} from '@shrubbery/editor-kernel'
import {
  mountQueryBlockVega,
  type QueryBlockVegaEmbedLoader,
} from './query-block-vega.js'
import { observeVegaThemeFlips } from './vega-theme.js'

export type QueryBlockQueryKind = 'ask' | 'select' | 'construct' | 'describe'

export interface QueryBlockTerm {
  readonly type: 'uri' | 'bnode' | 'literal'
  readonly value: string
  readonly datatype?: string
  readonly language?: string
}

export type QueryBlockRow = Record<string, QueryBlockTerm>

interface QueryBlockResultBase {
  readonly queryKind: QueryBlockQueryKind
  readonly durationMs: number
  readonly raw: unknown
}

export type QueryBlockResult =
  | (QueryBlockResultBase & {
      readonly resultKind: 'ask'
      readonly boolean: boolean
      readonly columns: readonly ['result']
      readonly rows: readonly QueryBlockRow[]
    })
  | (QueryBlockResultBase & {
      readonly resultKind: 'bindings'
      readonly columns: readonly string[]
      readonly rows: readonly QueryBlockRow[]
      /**
       * The TRUE row count the query matched, BEFORE this function's own
       * `sourceRows.slice(0, maxRows)` clamp (`run()`'s own `Math.min(500,
       * ...)` ceiling). OPTIONAL — a hand-built `QueryBlockResult` (tests,
       * storybook fixtures) may omit it; every result `normalizeResult`
       * itself produces always sets it, since `sourceRows.length` is already
       * in hand at that point. Grid-laneb review r1 WRONG finding (c): a
       * caller that only ever saw `rows.length` could not tell "500 rows,
       * total 500" apart from "500 rows, total 700" — this is the one place
       * that honest total is still available before it is discarded.
       */
      readonly totalRowCount?: number
    })
  | (QueryBlockResultBase & {
      readonly resultKind: 'serialized'
      readonly mediaType: string
      readonly value: string
    })

export type QueryBlockValueKind =
  | 'uri'
  | 'bnode'
  | 'literal'
  | 'number'
  | 'date'
  | 'boolean'
  | 'mixed'
  | 'empty'

export interface QueryBlockColumnProfile {
  readonly name: string
  readonly valueKind: QueryBlockValueKind
  readonly nonNullCount: number
  readonly distinctCount: number
}

export interface QueryBlockResultProfile {
  readonly rowCount: number
  readonly columns: readonly QueryBlockColumnProfile[]
}

export interface QueryBlockVegaBuilderState {
  readonly mark: string
  readonly x: string
  readonly y: string
  readonly x2?: string
  readonly color?: string
  readonly size?: string
  readonly shape?: string
  readonly opacity?: string
  readonly sort?: 'ascending' | 'descending' | ''
  readonly aggregate?: string
  readonly stack?: 'zero' | 'normalize' | ''
  readonly facet?: string
}

export interface QueryBlockService {
  run(graphId: string, sparql: string, maxRows?: number): Promise<QueryBlockResult>
}

export interface QueryBlockRendererOptions {
  /** Production leaves this unset and loads `vega-embed` only when a Vega result renders. */
  readonly loadVegaEmbed?: QueryBlockVegaEmbedLoader
}

const UPDATE_PATTERN = /\b(INSERT|DELETE|LOAD|CLEAR|CREATE|DROP|COPY|MOVE|ADD)\b/i

function withoutDeclarations(sparql: string): string {
  let remaining = sparql.trimStart()
  while (remaining) {
    if (remaining.startsWith('#')) {
      const newline = remaining.indexOf('\n')
      remaining = newline < 0 ? '' : remaining.slice(newline + 1).trimStart()
      continue
    }
    const declaration = remaining.match(
      /^(?:PREFIX\s+[A-Za-z][\w-]*:\s*<[^>]+>|BASE\s+<[^>]+>)\s*/i,
    )
    if (!declaration) break
    remaining = remaining.slice(declaration[0].length).trimStart()
  }
  return remaining
}

export function inferQueryBlockQueryKind(sparql: string): QueryBlockQueryKind {
  const body = withoutDeclarations(sparql)
  const match = /^(ASK|SELECT|CONSTRUCT|DESCRIBE)\b/i.exec(body)
  if (!match || UPDATE_PATTERN.test(body)) {
    throw new Error('Only read-only ASK, SELECT, CONSTRUCT, and DESCRIBE queries are allowed')
  }
  return match[1].toLowerCase() as QueryBlockQueryKind
}

function parseTerm(raw: unknown): QueryBlockTerm {
  if (isRecord(raw) && typeof raw.value === 'string') {
    const type = raw.type === 'uri' || raw.type === 'bnode' ? raw.type : 'literal'
    return {
      type,
      value: raw.value,
      ...(typeof raw.datatype === 'string' ? { datatype: raw.datatype } : {}),
      ...(typeof raw['xml:lang'] === 'string'
        ? { language: raw['xml:lang'] }
        : typeof raw.language === 'string'
          ? { language: raw.language }
          : {}),
    }
  }
  if (raw == null) return { type: 'literal', value: '' }
  const value = String(raw)
  if (value.startsWith('<') && value.endsWith('>')) {
    return { type: 'uri', value: value.slice(1, -1) }
  }
  if (value.startsWith('_:')) return { type: 'bnode', value: value.slice(2) }
  const literal = /^"((?:[^"\\]|\\.)*)"(?:\^\^<([^>]+)>|@([A-Za-z][\w-]*))?$/.exec(value)
  if (!literal) return { type: 'literal', value }
  return {
    type: 'literal',
    // SINGLE-PASS unescape. Sequential .replace() passes corrupt any literal
    // containing an escaped backslash: wire `\\n` (escaped backslash + 'n')
    // had its inner `\n` pair rewritten to a real newline first, yielding
    // `\<LF>` — observed live as "Bad escaped character" JSON.parse failures
    // on ux:layoutJson whose embedded SPARQL strings contain `\n`.
    value: literal[1].replace(/\\(.)/g, (_m, c: string) =>
      c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c,
    ),
    ...(literal[2] ? { datatype: literal[2] } : {}),
    ...(literal[3] ? { language: literal[3] } : {}),
  }
}

function normalizeResult(
  payload: unknown,
  queryKind: QueryBlockQueryKind,
  durationMs: number,
  maxRows: number,
): QueryBlockResult {
  const record = isRecord(payload) ? payload : {}
  const nested = isRecord(record.data) ? record.data : record
  if (queryKind === 'ask') {
    const value = Boolean(nested.boolean ?? nested.result ?? record.boolean ?? record.result)
    return {
      queryKind,
      resultKind: 'ask',
      boolean: value,
      columns: ['result'],
      rows: [{ result: { type: 'literal', value: String(value) } }],
      durationMs,
      raw: payload,
    }
  }

  if (queryKind === 'select') {
    const directRows = Array.isArray(record.rows) ? record.rows.filter(isRecord) : null
    const hasBindingsEnvelope = isRecord(nested.results) && Array.isArray(nested.results.bindings)
    const bindingRows = hasBindingsEnvelope
      ? (nested.results as { bindings: unknown[] }).bindings.filter(isRecord)
      : Array.isArray(payload)
        ? payload.filter(isRecord)
        : []
    // A 2xx body that matches none of the three recognized SELECT envelope
    // shapes (`{rows:[...]}`, `{data:{results:{bindings:[...]}}}`/`{results:
    // {bindings:[...]}}`, or a bare bindings array) is NOT "zero rows" — it is
    // a malformed/unexpected response (null, {}, {error: ...}, ...) that must
    // surface as an explicit failure rather than be silently normalized into
    // an empty-but-successful bindings result. Every caller (this file's own
    // renderer, every query-backed layout face, the Observatory layout-source
    // loader's "no ux:layoutJson triple" fallback) relies on THIS distinction
    // to tell real absence apart from a bad response.
    if (directRows === null && !hasBindingsEnvelope && !Array.isArray(payload)) {
      throw new Error(
        `query-block-service: SELECT response is not a recognized bindings envelope ` +
          `(expected {rows:[...]}, {results:{bindings:[...]}}, or a bindings array); got ` +
          `${JSON.stringify(payload)?.slice(0, 300) ?? typeof payload}`,
      )
    }
    const sourceRows = directRows ?? bindingRows
    const declared = Array.isArray(record.variables)
      ? record.variables.filter((value): value is string => typeof value === 'string')
      : isRecord(nested.head) && Array.isArray(nested.head.vars)
        ? nested.head.vars.filter((value): value is string => typeof value === 'string')
        : []
    const columns = declared.length
      ? declared
      : Array.from(new Set(sourceRows.flatMap((row) => Object.keys(row))))
    const rows = sourceRows.slice(0, maxRows).map((row) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [key, parseTerm(value)])),
    )
    return { queryKind, resultKind: 'bindings', columns, rows, totalRowCount: sourceRows.length, durationMs, raw: payload }
  }

  const value =
    typeof record.data === 'string'
      ? record.data
      : typeof payload === 'string'
        ? payload
        : JSON.stringify(payload, null, 2)
  return {
    queryKind,
    resultKind: 'serialized',
    mediaType: typeof record.mediaType === 'string' ? record.mediaType : 'application/n-quads',
    value,
    durationMs,
    raw: payload,
  }
}

export function makeQueryBlockService(rest: RestClient): QueryBlockService {
  return {
    async run(graphId, sparql, maxRows = 100) {
      const activeGraph = graphId.trim()
      const query = sparql.trim()
      if (!activeGraph) throw new Error('Query blocks require an active graph')
      if (!query) throw new Error('SPARQL query must not be empty')
      const kind = inferQueryBlockQueryKind(query)
      const rows = Math.max(1, Math.min(500, Math.trunc(maxRows)))
      const started = performance.now()
      const payload = await rest.query(activeGraph, query)
      return normalizeResult(payload, kind, Math.max(0, Math.round(performance.now() - started)), rows)
    },
  }
}

export function formatQueryBlockTerm(term: QueryBlockTerm | undefined): string {
  if (!term) return ''
  if (term.type === 'uri') return term.value
  if (term.type === 'bnode') return `_:${term.value}`
  if (term.language) return `"${term.value}"@${term.language}`
  if (term.datatype) return `"${term.value}"^^${term.datatype}`
  return term.value
}

/**
 * The PLAIN lexical value of a term — `"7"`, never `formatQueryBlockTerm`'s
 * Turtle-shorthand RDF notation (`"7"^^http://www.w3.org/2001/XMLSchema#
 * integer`). `formatQueryBlockTerm` is correct for `sh-sparql-table-view`'s
 * bindings-table cells, where showing the underlying RDF term shape
 * (datatype/language included) is the whole point of an inspection tool —
 * but a `stat.scalar` big-number card or a `card.subject` property-card field
 * wants the human value only. Discovered via a REAL gardend-cell integration
 * test (`stat-scalar-face.integration.test.ts`): a typed literal round-trips
 * as `"7"` here, `7` after `Number()` coercion, never the decorated notation.
 * Bnodes keep the same `_:id` convention `formatQueryBlockTerm` uses — a bare
 * blank-node label alone is not identifiable as one.
 */
export function plainQueryBlockTermValue(term: QueryBlockTerm | undefined): string {
  if (!term) return ''
  if (term.type === 'bnode') return `_:${term.value}`
  return term.value
}

/**
 * True iff `term` is a literal whose DATATYPE is an XSD numeric type — the
 * term-typed classification, never a lexical guess: an untyped/xsd:string
 * literal that HAPPENS to parse as a number (an id like "00123") is NOT
 * numeric, while a typed numeric whose lexical form doesn't `Number()`-parse
 * cleanly (xsd:double "INF") IS. The ONE numeric-datatype rule shared by the
 * table's column classification and the Vega value-kind mapping
 * (query-block-vega.ts's `termValueKind`).
 */
export function isNumericQueryBlockTerm(term: QueryBlockTerm | undefined): boolean {
  if (!term || term.type !== 'literal') return false
  const datatype = term.datatype?.toLowerCase() ?? ''
  return (
    datatype.includes('#integer') ||
    datatype.includes('#decimal') ||
    datatype.includes('#double') ||
    datatype.includes('#float') ||
    datatype.includes('#int') ||
    datatype.includes('#long') ||
    datatype.includes('#short') ||
    datatype.includes('#byte')
  )
}

/**
 * Build the real `<table>` DOM for a bindings/triples result — the ONE
 * shared bindings-table rendering primitive used by BOTH the production
 * `makeQueryBlockRenderer` host (this file, below) and the P2
 * `sh-sparql-table-view` leaf (`layout/faces/sparql-table-view-element.ts`;
 * diff-review r2 SUSPECT: "the table body was recreated in a new Lit element
 * ... this is parallel presentation logic, not an extracted shared leaf").
 *
 * Cell values are ALREADY-FORMATTED display strings — run every raw term
 * through `formatQueryBlockTerm` (or already have a plain string, e.g. a
 * triples-mode subject/predicate/object) before calling this. This function
 * only builds table STRUCTURE; it never formats a term itself, and it is
 * deliberately toolbar-free — no comment/collapse/Vega-builder/JSON-editor
 * chrome (design §9.1: "removing TipTap node-specific toolbar concerns from
 * the leaf"). Callers own their own wrapping chrome (a `role`/`aria-label`
 * region, a meta line, a CSS class for their own stylesheet, sticky-header
 * styling) — this returns a bare, unstyled `<table>` element.
 */
export function buildBindingsTableElement(
  columns: readonly string[],
  rows: readonly Readonly<Record<string, string>>[],
): HTMLTableElement {
  const table = document.createElement('table')
  const thead = document.createElement('thead')
  const headerRow = document.createElement('tr')
  for (const column of columns) {
    const th = document.createElement('th')
    th.textContent = column
    headerRow.appendChild(th)
  }
  thead.appendChild(headerRow)
  table.appendChild(thead)
  const tbody = document.createElement('tbody')
  for (const row of rows) {
    const tr = document.createElement('tr')
    for (const column of columns) {
      const td = document.createElement('td')
      td.textContent = row[column] ?? ''
      tr.appendChild(td)
    }
    tbody.appendChild(tr)
  }
  table.appendChild(tbody)
  return table
}

const NUMERIC_DATATYPE = /#(?:byte|decimal|double|float|int|integer|long|negativeInteger|nonNegativeInteger|nonPositiveInteger|positiveInteger|short|unsignedByte|unsignedInt|unsignedLong|unsignedShort)$/i
const DATE_DATATYPE = /#(?:date|dateTime|gDay|gMonth|gMonthDay|gYear|gYearMonth|time)$/i

function queryBlockValueKind(term: QueryBlockTerm): QueryBlockValueKind {
  if (term.type === 'uri') return 'uri'
  if (term.type === 'bnode') return 'bnode'
  const datatype = term.datatype ?? ''
  if (NUMERIC_DATATYPE.test(datatype)) return 'number'
  if (DATE_DATATYPE.test(datatype)) return 'date'
  if (/#boolean$/i.test(datatype) || /^(?:true|false)$/i.test(term.value)) return 'boolean'
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(term.value.trim())) return 'number'
  if (/^\d{4}-\d{2}-\d{2}(?:[T ][^\s]+)?$/.test(term.value.trim())) return 'date'
  return 'literal'
}

export function profileQueryBlockResult(result: QueryBlockResult): QueryBlockResultProfile {
  if (result.resultKind !== 'bindings') return { rowCount: result.resultKind === 'ask' ? 1 : 0, columns: [] }
  return {
    rowCount: result.rows.length,
    columns: result.columns.map((name) => {
      const kinds = new Set<QueryBlockValueKind>()
      const values = new Set<string>()
      let nonNullCount = 0
      for (const row of result.rows) {
        const term = row[name]
        if (!term || !term.value) continue
        nonNullCount += 1
        kinds.add(queryBlockValueKind(term))
        values.add(`${term.type}:${term.value}:${term.datatype ?? ''}:${term.language ?? ''}`)
      }
      return {
        name,
        valueKind: kinds.size === 0
          ? 'empty'
          : kinds.size === 1
            ? kinds.values().next().value ?? 'empty'
            : 'mixed',
        nonNullCount,
        distinctCount: values.size,
      }
    }),
  }
}

function vegaType(kind: QueryBlockValueKind): 'quantitative' | 'temporal' | 'nominal' {
  if (kind === 'number') return 'quantitative'
  if (kind === 'date') return 'temporal'
  return 'nominal'
}

function chartColumns(profile: QueryBlockResultProfile): {
  readonly numeric: readonly QueryBlockColumnProfile[]
  readonly temporal: readonly QueryBlockColumnProfile[]
  readonly categorical: readonly QueryBlockColumnProfile[]
} {
  return {
    numeric: profile.columns.filter(column => column.valueKind === 'number'),
    temporal: profile.columns.filter(column => column.valueKind === 'date'),
    categorical: profile.columns.filter(column =>
      column.valueKind === 'literal' || column.valueKind === 'uri' || column.valueKind === 'mixed'),
  }
}

/** Garden-compatible automatic chart recommendation; returns no fake for non-chartable rows. */
export function generateAutoQueryBlockVegaSpec(
  result: QueryBlockResult,
  profile: QueryBlockResultProfile = profileQueryBlockResult(result),
): string | null {
  if (result.resultKind !== 'bindings' || result.rows.length < 2) return null
  const { numeric, temporal, categorical } = chartColumns(profile)
  if (temporal[0] && numeric[0]) {
    return JSON.stringify({
      mark: { type: 'line', tooltip: true },
      encoding: {
        x: { field: temporal[0].name, type: 'temporal' },
        y: { field: numeric[0].name, type: 'quantitative' },
      },
      height: 300,
    }, null, 2)
  }
  if (numeric.length >= 2) {
    return JSON.stringify({
      mark: { type: 'circle', opacity: 0.8, tooltip: true },
      encoding: {
        x: { field: numeric[0].name, type: 'quantitative' },
        y: { field: numeric[1].name, type: 'quantitative' },
        ...(categorical[0]
          ? { color: { field: categorical[0].name, type: 'nominal' } }
          : {}),
      },
      height: 300,
    }, null, 2)
  }
  if (categorical[0] && numeric[0]) {
    return JSON.stringify({
      mark: { type: 'bar', cornerRadiusEnd: 4, tooltip: true },
      encoding: {
        y: {
          field: categorical[0].name,
          type: 'nominal',
          sort: '-x',
          axis: { title: categorical[0].name, labelLimit: 220 },
        },
        x: {
          field: numeric[0].name,
          type: 'quantitative',
          axis: { title: numeric[0].name },
        },
        // No authored bar color: series/mark colors are the chart color
        // law's surface — the house theme's slot-1 mark color applies. (An
        // earlier revision authored the legacy accent green here, which the
        // mount-time law guard would now strip with a warning on every
        // auto-generated chart.)
      },
      height: Math.max(180, Math.min(520, result.rows.length * 28)),
    }, null, 2)
  }
  return null
}

export function buildQueryBlockVegaSpec(
  result: QueryBlockResult,
  state: QueryBlockVegaBuilderState,
): string | null {
  if (result.resultKind !== 'bindings' || !state.x || !state.y) return null
  const profile = profileQueryBlockResult(result)
  const byName = new Map(profile.columns.map(column => [column.name, column]))
  const xColumn = byName.get(state.x)
  const yColumn = byName.get(state.y)
  if (!xColumn || !yColumn) return null
  const x: Record<string, unknown> = { field: state.x, type: vegaType(xColumn.valueKind) }
  const y: Record<string, unknown> = { field: state.y, type: vegaType(yColumn.valueKind) }
  if (state.aggregate) {
    if (x.type === 'quantitative') x.aggregate = state.aggregate
    else if (y.type === 'quantitative') y.aggregate = state.aggregate
  }
  if (state.sort) {
    if (y.type === 'nominal') y.sort = state.sort === 'descending' ? '-x' : 'x'
    else if (x.type === 'nominal') x.sort = state.sort === 'descending' ? '-y' : 'y'
  }
  if (state.stack) {
    if (x.type === 'quantitative') x.stack = state.stack
    else if (y.type === 'quantitative') y.stack = state.stack
  }
  const encoding: Record<string, unknown> = { x, y }
  const addField = (channel: string, field: string | undefined, fallback: QueryBlockValueKind): void => {
    if (!field) return
    encoding[channel] = { field, type: vegaType(byName.get(field)?.valueKind ?? fallback) }
  }
  addField('x2', state.x2, 'number')
  addField('color', state.color, 'literal')
  addField('size', state.size, 'number')
  addField('shape', state.shape, 'literal')
  addField('opacity', state.opacity, 'number')
  addField('column', state.facet, 'literal')
  if (!state.stack && state.color && (state.mark === 'bar' || state.mark === 'area')) {
    if (x.type === 'quantitative') x.stack = null
    else if (y.type === 'quantitative') y.stack = null
  }
  const mark: Record<string, unknown> = { type: state.mark || 'bar', tooltip: true }
  if (mark.type === 'bar') mark.cornerRadiusEnd = 4
  if (mark.type === 'circle') mark.opacity = 0.8
  if (mark.type === 'text') mark.fontSize = 11
  if (mark.type === 'tick') mark.thickness = 2
  if (mark.type === 'text') {
    const text = profile.columns.find(column => column.valueKind === 'literal')
    if (text) encoding.text = { field: text.name, type: 'nominal' }
  }
  return JSON.stringify({
    mark,
    encoding,
    height: mark.type === 'bar'
      ? Math.max(180, Math.min(520, result.rows.length * 28))
      : 300,
  }, null, 2)
}

function tripleRows(result: QueryBlockResult): Array<Record<'subject' | 'predicate' | 'object', string>> {
  if (result.resultKind === 'bindings') {
    const names = new Map(result.columns.map((column) => [column.toLowerCase(), column]))
    const subject = names.get('subject') ?? names.get('s')
    const predicate = names.get('predicate') ?? names.get('p')
    const object = names.get('object') ?? names.get('o')
    if (!subject || !predicate || !object) return []
    return result.rows.map((row) => ({
      subject: formatQueryBlockTerm(row[subject]),
      predicate: formatQueryBlockTerm(row[predicate]),
      object: formatQueryBlockTerm(row[object]),
    }))
  }
  if (result.resultKind !== 'serialized') return []
  const termPattern = /<[^>]*>|_:[^\s]+|"([^"\\]|\\.)*"(?:@[A-Za-z0-9-]+|\^\^<[^>]+>)?/g
  return result.value
    .split('\n')
    .map((line) => Array.from(line.matchAll(termPattern)).map((match) => match[0]))
    .filter((terms) => terms.length >= 3)
    .map((terms) => ({ subject: terms[0], predicate: terms[1], object: terms[2] }))
}

function available(result: QueryBlockResult, visualization: QueryBlockVisualization): boolean {
  if (visualization === 'json') return true
  if (visualization === 'table') return result.resultKind !== 'serialized'
  if (visualization === 'triples' || visualization === 'network') return tripleRows(result).length > 0
  if (visualization === 'stat') {
    return result.resultKind === 'ask' ||
      (result.resultKind === 'bindings' && result.rows.length === 1 && result.columns.length === 1)
  }
  if (visualization === 'vega') return result.resultKind === 'bindings' && result.rows.length > 0
  return false
}

function automaticVisualization(result: QueryBlockResult): QueryBlockVisualization {
  if (result.resultKind === 'ask') return 'stat'
  if (tripleRows(result).length > 0) return 'triples'
  if (result.resultKind === 'bindings' && result.rows.length === 1 && result.columns.length === 1) {
    return 'stat'
  }
  if (generateAutoQueryBlockVegaSpec(result)) return 'vega'
  return result.resultKind === 'bindings' ? 'table' : 'json'
}

function chosenVisualization(attrs: QueryBlockAttrs, result: QueryBlockResult): QueryBlockVisualization {
  const requested = attrs.displayMode === 'auto' ? automaticVisualization(result) : attrs.visualization
  return available(result, requested) ? requested : automaticVisualization(result)
}

const QUERY_BLOCK_STYLE = `
.query-block{border:1px solid var(--mn-color-border-default,#d6d3d1);border-left:3px solid var(--mn-color-border-accent,#39725a);border-radius:6px;padding:8px;margin:8px 0;background:var(--mn-color-surface-raised,#fff);font-family:var(--mn-font-utility,sans-serif)}
.query-block[data-status=running]{opacity:.72}.query-block[data-status=error]{border-left-color:var(--mn-color-danger-strong,#b42318)}
.query-block-host-toolbar{display:flex;gap:6px;align-items:center}.query-block-host-toolbar button,.query-block-host-toolbar select,.query-block-host-toolbar input{font:inherit}
.query-block-host-comment,.query-block-host-query{box-sizing:border-box;width:100%;margin-top:6px}.query-block-host-query{min-height:88px;font-family:var(--mn-font-mono,monospace)}
.query-block-host-meta{font-size:11px;color:var(--mn-color-text-secondary,#666);margin:5px 0}.query-block-host-error{color:var(--mn-color-danger-strong,#b42318)}
.query-block-host-table{width:100%;border-collapse:collapse;font-size:12px}.query-block-host-table th,.query-block-host-table td{border:1px solid var(--mn-color-border-subtle,#ddd);padding:4px;text-align:left;vertical-align:top}
.query-block-host-stat{font-size:28px;font-weight:650;padding:10px 0}
.query-block-host-vega-builder{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:6px;margin-top:6px;padding:8px;border:1px solid var(--mn-color-border-subtle,#ddd);border-radius:5px;background:var(--mn-color-surface-sunken,#fafafa)}
.query-block-host-vega-field{display:flex;min-width:0;flex-direction:column;gap:3px;color:var(--mn-color-text-secondary,#666);font-size:10px;font-weight:650;text-transform:uppercase;letter-spacing:.03em}.query-block-host-vega-field select{min-width:0;width:100%;font:inherit;font-size:11px;text-transform:none;letter-spacing:normal}
.query-block-host-vega-json-toggle{align-self:end;min-height:24px;font:inherit;font-size:11px}
.query-block-host-vega-spec{box-sizing:border-box;width:100%;min-height:116px;margin-top:6px;font-family:var(--mn-font-mono,monospace);font-size:11px}
.query-block-host-vega{min-height:120px;font-variant-numeric:tabular-nums}.query-block-host-vega-loading,.query-block-host-vega-hint{padding:12px 0;color:var(--mn-color-text-secondary,#666);font-size:12px}.query-block-host-vega-error{padding:12px 0;color:var(--mn-color-danger-strong,#b42318);font-size:12px;white-space:pre-wrap}
.query-block-host-network{width:100%;height:260px;border:1px solid var(--mn-color-border-subtle,#ddd)}
`

function ensureStyle(document: Document): void {
  if (document.querySelector('[data-shrubbery-query-block-style]')) return
  const style = document.createElement('style')
  style.dataset.shrubberyQueryBlockStyle = ''
  style.textContent = QUERY_BLOCK_STYLE
  document.head.appendChild(style)
}

export function makeQueryBlockRenderer(
  service: QueryBlockService,
  options: QueryBlockRendererOptions = {},
): QueryBlockRenderer {
  return (target, initialRequest) => {
    ensureStyle(target.ownerDocument)
    const document = target.ownerDocument
    let request = initialRequest
    let result: QueryBlockResult | null = null
    let runId = 0
    let richVisualizationCleanup: (() => void) | null = null
    let richVisualizationRenderId = 0
    let rawVegaJsonVisible = false
    let themeFlipDispose: (() => void) | null = null

    const commitAttrs = (patch: Partial<QueryBlockAttrs>): void => {
      request.updateAttrs(patch)
      request = { ...request, attrs: { ...request.attrs, ...patch } }
    }

    const toolbar = document.createElement('div')
    toolbar.className = 'query-block-host-toolbar'
    const visualization = document.createElement('select')
    for (const value of ['table', 'stat', 'triples', 'vega', 'network', 'json'] as const) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = value[0].toUpperCase() + value.slice(1)
      visualization.appendChild(option)
    }
    const maxRows = document.createElement('input')
    maxRows.type = 'number'
    maxRows.min = '1'
    maxRows.max = '500'
    const run = document.createElement('button')
    run.type = 'button'
    run.textContent = 'Run'
    const collapse = document.createElement('button')
    collapse.type = 'button'
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = 'Delete'
    toolbar.append(visualization, maxRows, run, collapse, remove)

    const comment = document.createElement('input')
    comment.className = 'query-block-host-comment'
    comment.placeholder = 'Add a note…'
    const query = document.createElement('textarea')
    query.className = 'query-block-host-query'
    query.spellcheck = false
    const vegaBuilder = document.createElement('div')
    vegaBuilder.className = 'query-block-host-vega-builder'
    const builderSelect = (
      label: string,
      id: string,
      values: readonly (readonly [string, string])[] = [],
    ): HTMLSelectElement => {
      const field = document.createElement('label')
      field.className = 'query-block-host-vega-field'
      field.textContent = label
      const select = document.createElement('select')
      select.dataset.vegaField = id
      select.setAttribute('aria-label', `Vega ${label}`)
      for (const [value, text] of values) {
        const option = document.createElement('option')
        option.value = value
        option.textContent = text
        select.appendChild(option)
      }
      field.appendChild(select)
      vegaBuilder.appendChild(field)
      return select
    }
    const markSelect = builderSelect('Mark', 'mark', [
      ['bar', 'Bar'], ['line', 'Line'], ['area', 'Area'], ['point', 'Point'],
      ['circle', 'Circle'], ['rect', 'Rect'], ['tick', 'Tick'], ['text', 'Text'],
    ])
    const xSelect = builderSelect('X axis', 'x')
    const ySelect = builderSelect('Y axis', 'y')
    const x2Select = builderSelect('X2', 'x2')
    const colorSelect = builderSelect('Color', 'color')
    const sizeSelect = builderSelect('Size', 'size')
    const shapeSelect = builderSelect('Shape', 'shape')
    const opacitySelect = builderSelect('Opacity', 'opacity')
    const sortSelect = builderSelect('Sort', 'sort', [
      ['', 'Natural'], ['ascending', 'Ascending'], ['descending', 'Descending'],
    ])
    const aggregateSelect = builderSelect('Aggregate', 'aggregate', [
      ['', 'None'], ['sum', 'Sum'], ['count', 'Count'], ['mean', 'Mean'],
      ['median', 'Median'], ['min', 'Min'], ['max', 'Max'],
    ])
    const stackSelect = builderSelect('Stack', 'stack', [
      ['', 'None'], ['zero', 'Zero'], ['normalize', 'Normalize'],
    ])
    const facetSelect = builderSelect('Facet', 'facet')
    const jsonToggle = document.createElement('button')
    jsonToggle.type = 'button'
    jsonToggle.className = 'query-block-host-vega-json-toggle'
    jsonToggle.textContent = 'Edit JSON'
    jsonToggle.setAttribute('aria-expanded', 'false')
    vegaBuilder.appendChild(jsonToggle)
    const vegaSpec = document.createElement('textarea')
    vegaSpec.className = 'query-block-host-vega-spec'
    vegaSpec.spellcheck = false
    vegaSpec.placeholder = 'Vega-Lite JSON spec'
    vegaSpec.setAttribute('aria-label', 'Vega-Lite JSON spec')
    const meta = document.createElement('div')
    meta.className = 'query-block-host-meta'
    const error = document.createElement('div')
    error.className = 'query-block-host-error'
    const output = document.createElement('div')
    output.setAttribute('aria-live', 'polite')
    target.replaceChildren(toolbar, comment, query, vegaBuilder, vegaSpec, meta, error, output)

    const fieldSelects = [
      xSelect, ySelect, x2Select, colorSelect, sizeSelect, shapeSelect, opacitySelect, facetSelect,
    ] as const
    const optionalFieldSelects = new Set<HTMLSelectElement>([
      x2Select, colorSelect, sizeSelect, shapeSelect, opacitySelect, facetSelect,
    ])

    const populateBuilderFields = (activeResult: QueryBlockResult): void => {
      if (activeResult.resultKind !== 'bindings') return
      const profile = profileQueryBlockResult(activeResult)
      for (const select of fieldSelects) {
        const previous = select.value
        select.replaceChildren()
        if (optionalFieldSelects.has(select)) {
          const none = document.createElement('option')
          none.value = ''
          none.textContent = '— none —'
          select.appendChild(none)
        }
        for (const column of profile.columns) {
          const option = document.createElement('option')
          option.value = column.name
          option.textContent = `${column.name} (${column.valueKind})`
          select.appendChild(option)
        }
        if ([...select.options].some(option => option.value === previous)) select.value = previous
      }
    }

    const syncBuilderFromSpec = (source: string): void => {
      try {
        const spec = JSON.parse(source) as Record<string, unknown>
        const mark = spec.mark
        markSelect.value = typeof mark === 'string'
          ? mark
          : isRecord(mark) && typeof mark.type === 'string'
            ? mark.type
            : markSelect.value
        const encoding = isRecord(spec.encoding) ? spec.encoding : {}
        const field = (channel: string): string => {
          const value = encoding[channel]
          return isRecord(value) && typeof value.field === 'string' ? value.field : ''
        }
        xSelect.value = field('x')
        ySelect.value = field('y')
        x2Select.value = field('x2')
        colorSelect.value = field('color')
        sizeSelect.value = field('size')
        shapeSelect.value = field('shape')
        opacitySelect.value = field('opacity')
        facetSelect.value = field('column')
        const x = isRecord(encoding.x) ? encoding.x : {}
        const y = isRecord(encoding.y) ? encoding.y : {}
        const sort = x.sort ?? y.sort
        sortSelect.value = sort === '-x' || sort === '-y' || sort === 'descending'
          ? 'descending'
          : sort === 'x' || sort === 'y' || sort === 'ascending'
            ? 'ascending'
            : ''
        const aggregate = x.aggregate ?? y.aggregate
        aggregateSelect.value = typeof aggregate === 'string' ? aggregate : ''
        const stack = x.stack ?? y.stack
        stackSelect.value = stack === 'normalize' ? 'normalize' : stack === 'zero' ? 'zero' : ''
      } catch {
        // The raw editor owns malformed JSON errors; builder selections stay stable.
      }
    }

    const builderState = (): QueryBlockVegaBuilderState => ({
      mark: markSelect.value,
      x: xSelect.value,
      y: ySelect.value,
      x2: x2Select.value,
      color: colorSelect.value,
      size: sizeSelect.value,
      shape: shapeSelect.value,
      opacity: opacitySelect.value,
      sort: sortSelect.value as QueryBlockVegaBuilderState['sort'],
      aggregate: aggregateSelect.value,
      stack: stackSelect.value as QueryBlockVegaBuilderState['stack'],
      facet: facetSelect.value,
    })

    const clearRichVisualization = (): void => {
      richVisualizationRenderId += 1
      richVisualizationCleanup?.()
      richVisualizationCleanup = null
      themeFlipDispose?.()
      themeFlipDispose = null
      delete output.dataset.visualizationStatus
    }

    const renderOutput = (): void => {
      clearRichVisualization()
      output.replaceChildren()
      if (!result) {
        output.textContent = target.dataset.status === 'running' ? 'Running query…' : 'No result yet.'
        return
      }
      const mode = chosenVisualization(request.attrs, result)
      if (mode === 'json') {
        const pre = document.createElement('pre')
        pre.textContent = JSON.stringify(result.raw, null, 2)
        output.appendChild(pre)
        return
      }
      if (mode === 'stat') {
        const stat = document.createElement('div')
        stat.className = 'query-block-host-stat'
        stat.textContent = result.resultKind === 'ask'
          ? String(result.boolean)
          : result.resultKind === 'bindings'
            ? formatQueryBlockTerm(result.rows[0]?.[result.columns[0]])
            : ''
        output.appendChild(stat)
        return
      }
      if (mode === 'vega' && result.resultKind === 'bindings') {
        const host = document.createElement('div')
        host.className = 'query-block-host-vega'
        const loading = document.createElement('div')
        loading.className = 'query-block-host-vega-loading'
        loading.textContent = 'Rendering Vega-Lite view…'
        host.appendChild(loading)
        output.dataset.visualizationStatus = 'rendering'
        output.appendChild(host)

        // The SAME root theme/skin re-mount contract <sh-vega-chart-view>
        // holds (vega-theme.ts's header: Vega bakes every color into spec
        // JSON at mount time, so no CSS cascade can re-theme a mounted
        // chart): an editor-embedded QueryBlock chart re-renders — re-baking
        // the config against the new mode — when the root data-theme/
        // data-skin flips. One shared observer per rendered chart, disposed
        // by clearRichVisualization (every re-render and destroy() path),
        // so nothing outlives the block.
        themeFlipDispose = observeVegaThemeFlips(target.ownerDocument, () => renderOutput())

        const activeRender = ++richVisualizationRenderId
        void mountQueryBlockVega({
          container: host,
          result,
          vegaLiteSpec: vegaSpec.value,
          loadEmbed: options.loadVegaEmbed,
        })
          .then((cleanup) => {
            if (activeRender !== richVisualizationRenderId) {
              cleanup()
              return
            }
            richVisualizationCleanup = cleanup
            output.dataset.visualizationStatus = 'done'
          })
          .catch((cause) => {
            if (activeRender !== richVisualizationRenderId) return
            const failure = document.createElement('div')
            failure.className = 'query-block-host-vega-error'
            failure.setAttribute('role', 'alert')
            failure.textContent = cause instanceof Error
              ? cause.message
              : 'Unable to render Vega-Lite view.'
            host.replaceChildren(failure)
            output.dataset.visualizationStatus = 'error'
          })
        return
      }
      const triples = tripleRows(result)
      if (mode === 'network') {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('class', 'query-block-host-network')
        svg.setAttribute('viewBox', '0 0 800 260')
        const nodes = Array.from(new Set(triples.flatMap((row) => [row.subject, row.object])))
        const positions = new Map(nodes.map((id, index) => [id, {
          x: 60 + index % 5 * 165,
          y: 55 + Math.floor(index / 5) * 95,
        }]))
        for (const triple of triples) {
          const from = positions.get(triple.subject)
          const to = positions.get(triple.object)
          if (!from || !to) continue
          const line = document.createElementNS(svg.namespaceURI, 'line')
          line.setAttribute('x1', String(from.x))
          line.setAttribute('y1', String(from.y))
          line.setAttribute('x2', String(to.x))
          line.setAttribute('y2', String(to.y))
          line.setAttribute('stroke', 'currentColor')
          svg.appendChild(line)
        }
        for (const [id, position] of positions) {
          const text = document.createElementNS(svg.namespaceURI, 'text')
          text.setAttribute('x', String(position.x))
          text.setAttribute('y', String(position.y))
          text.setAttribute('font-size', '10')
          text.textContent = id.length > 24 ? `…${id.slice(-23)}` : id
          svg.appendChild(text)
        }
        output.appendChild(svg)
        return
      }
      let columns: string[] = []
      let rows: Array<Record<string, string>> = []
      if (mode === 'triples') {
        columns = ['subject', 'predicate', 'object']
        rows = triples
      } else if (result.resultKind === 'bindings') {
        const bindings = result
        columns = [...bindings.columns]
        rows = bindings.rows.map((row) =>
          Object.fromEntries(
            bindings.columns.map((column) => [column, formatQueryBlockTerm(row[column])]),
          ),
        )
      }
      // Shared bindings-table DOM primitive (diff-review r2 SUSPECT) — the
      // SAME table structure `sh-sparql-table-view` builds; only the class
      // hook (this host's own stylesheet target) is added here.
      const table = buildBindingsTableElement(columns, rows)
      table.className = 'query-block-host-table'
      output.appendChild(table)
    }

    const sync = (): void => {
      if (document.activeElement !== comment) comment.value = request.attrs.comment
      if (document.activeElement !== query) query.value = request.attrs.query
      if (document.activeElement !== vegaSpec) vegaSpec.value = request.attrs.vegaLiteSpec
      if (result) {
        populateBuilderFields(result)
        if (!vegaBuilder.contains(document.activeElement) && request.attrs.vegaLiteSpec.trim()) {
          syncBuilderFromSpec(request.attrs.vegaLiteSpec)
        }
      }
      visualization.value = request.attrs.visualization
      maxRows.value = String(request.attrs.maxRows)
      comment.readOnly = !request.editable
      query.readOnly = !request.editable
      vegaSpec.readOnly = !request.editable
      visualization.disabled = !request.editable
      maxRows.disabled = !request.editable
      for (const select of [markSelect, ...fieldSelects, sortSelect, aggregateSelect, stackSelect]) {
        select.disabled = !request.editable
      }
      jsonToggle.disabled = !request.editable
      remove.hidden = !request.editable
      collapse.textContent = request.attrs.collapsed ? 'Expand' : 'Collapse'
      query.hidden = request.attrs.collapsed
      comment.hidden = request.attrs.collapsed
      const showVega = !request.attrs.collapsed && (
        request.attrs.visualization === 'vega' || (result ? automaticVisualization(result) === 'vega' : false)
      )
      vegaBuilder.hidden = !showVega
      vegaSpec.hidden = !showVega || !rawVegaJsonVisible
      jsonToggle.textContent = rawVegaJsonVisible ? 'Hide JSON' : 'Edit JSON'
      jsonToggle.setAttribute('aria-expanded', String(rawVegaJsonVisible))
      output.hidden = request.attrs.collapsed
      renderOutput()
    }

    const execute = async (): Promise<void> => {
      const graphId = request.graphId
      const activeRun = ++runId
      target.dataset.status = 'running'
      run.disabled = true
      error.textContent = ''
      meta.textContent = 'Running…'
      renderOutput()
      try {
        result = await service.run(graphId ?? '', query.value, Number(maxRows.value))
        if (activeRun !== runId) return
        target.dataset.status = 'done'
        meta.textContent = `${result.queryKind.toUpperCase()} · ${result.durationMs}ms`
        populateBuilderFields(result)
        if (request.attrs.vegaLiteSpec.trim()) {
          syncBuilderFromSpec(request.attrs.vegaLiteSpec)
        } else if (request.attrs.displayMode === 'auto') {
          const generated = generateAutoQueryBlockVegaSpec(result)
          if (generated) {
            vegaSpec.value = generated
            syncBuilderFromSpec(generated)
            commitAttrs({ visualization: 'vega', vegaLiteSpec: generated })
          }
        }
        if (query.value !== request.attrs.query || Number(maxRows.value) !== request.attrs.maxRows) {
          commitAttrs({ query: query.value, maxRows: Number(maxRows.value) })
        }
      } catch (cause) {
        if (activeRun !== runId) return
        target.dataset.status = 'error'
        error.textContent = cause instanceof Error ? cause.message : String(cause)
        meta.textContent = 'Query failed'
      } finally {
        if (activeRun === runId) {
          run.disabled = false
          sync()
        }
      }
    }

    toolbar.addEventListener('mousedown', (event) => event.stopPropagation())
    vegaBuilder.addEventListener('mousedown', (event) => event.stopPropagation())
    comment.addEventListener('blur', () => commitAttrs({ comment: comment.value }))
    query.addEventListener('blur', () => commitAttrs({ query: query.value }))
    query.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void execute()
      }
    })
    const commitVegaSpec = (): void => {
      if (vegaSpec.value !== request.attrs.vegaLiteSpec) {
        commitAttrs({ displayMode: 'manual', visualization: 'vega', vegaLiteSpec: vegaSpec.value })
        syncBuilderFromSpec(vegaSpec.value)
      }
      renderOutput()
    }
    vegaSpec.addEventListener('blur', commitVegaSpec)
    vegaSpec.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        commitVegaSpec()
      }
    })
    jsonToggle.addEventListener('click', () => {
      rawVegaJsonVisible = !rawVegaJsonVisible
      sync()
      if (rawVegaJsonVisible) vegaSpec.focus()
    })
    const onBuilderChange = (): void => {
      if (!result) return
      const spec = buildQueryBlockVegaSpec(result, builderState())
      if (!spec) return
      vegaSpec.value = spec
      commitAttrs({ displayMode: 'manual', visualization: 'vega', vegaLiteSpec: spec })
      renderOutput()
    }
    for (const select of [markSelect, ...fieldSelects, sortSelect, aggregateSelect, stackSelect]) {
      select.addEventListener('change', onBuilderChange)
    }
    visualization.addEventListener('change', () => {
      commitAttrs({
        displayMode: 'manual',
        visualization: visualization.value as QueryBlockVisualization,
      })
      sync()
    })
    maxRows.addEventListener('change', () => {
      const value = Math.max(1, Math.min(500, Number(maxRows.value) || 100))
      maxRows.value = String(value)
      commitAttrs({ maxRows: value })
    })
    run.addEventListener('click', () => void execute())
    collapse.addEventListener('click', () => {
      commitAttrs({ collapsed: !request.attrs.collapsed })
      sync()
    })
    remove.addEventListener('click', () => request.deleteNode())

    sync()
    if (request.graphId && request.attrs.query.trim()) void execute()
    return {
      update(next) {
        const signatureChanged =
          next.graphId !== request.graphId ||
          next.attrs.query !== request.attrs.query ||
          next.attrs.maxRows !== request.attrs.maxRows
        request = next
        sync()
        if (signatureChanged && request.graphId && request.attrs.query.trim()) void execute()
      },
      destroy() {
        runId += 1
        clearRichVisualization()
        target.replaceChildren()
      },
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
