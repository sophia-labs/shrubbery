/** Host-side execution and DOM face for the pure editor-kernel QueryBlock. */

import { adoptStyleSheet } from '@shrubbery/nucleus'
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
import {
  EMPTY_VALUE_DICTIONARY,
  type FaceStance,
  genericValueView,
  resolveValueFace,
  type ValueDictionary,
  type ValueView,
} from '@shrubbery/nucleus/value-faces'
import { observeVegaThemeFlips, resolveVegaThemeMode } from './vega-theme.js'
import { renderValueView, VALUE_FACE_STYLE, type ValueDictionarySource } from './value-face-view.js'
import { runWithRetry } from './query-retry.js'
export { isRetryableQueryError } from './query-retry.js'

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
  /** The per-graph value dictionary for value faces (rung chips, ladder-ordered charts). */
  readonly valueDictionary?: ValueDictionarySource
  /** The host's stance for this pane (`?stance=`); `read` when absent. */
  readonly stance?: () => FaceStance | null | undefined
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

/**
 * Blank out every IRIREF (`<…>` with no whitespace or other IRI-excluded
 * character inside — a `<` comparison operator is never matched) and every
 * string literal (`'''…'''`, `"""…"""`, `"…"`, `'…'`) so the update-keyword
 * scan below sees only SPARQL syntax. Found live on 2026-09-15 (el Despacho
 * W1): a plain SELECT over the real bead `…:cuenta:sirin-w1-move-sophia-cluster`
 * was refused because `\bMOVE\b` matched inside the IRI. Keywords inside an
 * IRI or a string can never be an update operation; the guard's intent is
 * unchanged, its false positives on real names are gone.
 */
function withoutIrisAndStrings(body: string): string {
  return body
    .replace(/<[^<>\s"{}|\\^`]*>/g, '<>')
    .replace(/'''[\s\S]*?'''|"""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""')
}

export function inferQueryBlockQueryKind(sparql: string): QueryBlockQueryKind {
  const body = withoutDeclarations(sparql)
  const match = /^(ASK|SELECT|CONSTRUCT|DESCRIBE)\b/i.exec(body)
  if (!match || UPDATE_PATTERN.test(withoutIrisAndStrings(body))) {
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

/** The generic value face in the REVIEW stance: the RDF term notation (nucleus value-faces). */
export function formatQueryBlockTerm(term: QueryBlockTerm | undefined): string {
  return genericValueView(term, 'review').text
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
  // The generic value face in the READ stance (nucleus value-faces).
  return genericValueView(term, 'read').text
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

/**
 * The query block's faces by STANCE (plans/2026-09-25-document-primitives.md
 * §1, §6 step 2):
 *   - read   (the resting face): the title as typography, the result, a quiet
 *            caption ("25 rows · 3 min ago"). No controls.
 *   - draft  (the editing chrome): shown INSIDE read on hover or focus-within,
 *            and on touch through the block's options affordance; pinned open
 *            while the query or chart editor is open. It keeps every function
 *            the block had: visualization, row limit, Run, Collapse, Delete,
 *            the query and title editors, and — behind "Edit chart" — the
 *            Vega encoding builder and raw JSON.
 *   - review (the query and its timing, set by the host, e.g. `?stance=review`):
 *            the read face plus the query source and the run's timing.
 * The stance is carried as `data-face-stance` (NOT `data-stance`, which is the
 * room-posture register `stance.css` styles).
 */
const QUERY_BLOCK_STYLE = `
.query-block{position:relative;container-type:inline-size;margin:var(--mn-space-4,1rem) 0;padding:0;border:0;background:transparent;color:var(--mn-color-text-primary,#1f2933);font-family:var(--mn-font-chrome,system-ui,sans-serif)}
.query-block[data-status=running] .query-block-output{opacity:.6;transition:opacity 120ms ease}
.query-block-head{display:flex;align-items:flex-start;gap:var(--mn-space-2,.5rem)}
.query-block-title{flex:1 1 auto;min-width:0;margin:0 0 var(--mn-space-2,.5rem);color:var(--mn-color-text-primary,#1f2933);font:600 var(--mn-text-sm,.9rem)/1.4 var(--mn-font-prose,Georgia,serif);letter-spacing:.005em}
.query-block-title:empty{display:none}
.query-block-chrome{position:absolute;top:-8px;right:0;z-index:3;display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:4px;max-width:100%;padding:3px;border:1px solid var(--mn-color-border-subtle,rgba(15,23,42,.12));border-radius:var(--mn-radius-md,8px);background:var(--mn-color-surface-raised,#fffdf8);box-shadow:var(--mn-shadow-card,0 8px 24px -16px rgba(0,0,0,.35));opacity:0;visibility:hidden;transform:translateY(-2px);transition:opacity 120ms ease,transform 120ms ease,visibility 0s linear 120ms}
.query-block:is(:hover,:focus-within,[data-chrome-open]) .query-block-chrome,.query-block[data-face-stance=draft] .query-block-chrome{opacity:1;visibility:visible;transform:none;transition:opacity 120ms ease,transform 120ms ease}
.query-block-host-meta{padding:0 6px;color:var(--mn-color-text-tertiary,#697386);font:500 var(--mn-text-2xs,.72rem)/1 var(--mn-font-mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;white-space:nowrap}
.query-block-chrome :is(button,select,input){box-sizing:border-box;height:24px;margin:0;padding:0 7px;border:1px solid transparent;border-radius:var(--mn-radius-sm,5px);background:transparent;color:var(--mn-color-text-secondary,#475467);font:500 var(--mn-text-2xs,.74rem)/1 var(--mn-font-chrome,system-ui,sans-serif);cursor:pointer}
.query-block-chrome select{appearance:none;padding-right:20px;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 11px) 11px,calc(100% - 7px) 11px;background-size:4px 4px;background-repeat:no-repeat}
.query-block-chrome input[type=number]{width:52px;cursor:text;border-color:var(--mn-color-border-subtle,rgba(15,23,42,.12));font-variant-numeric:tabular-nums}
.query-block-chrome :is(button,select):hover{background:var(--mn-color-surface-sunken,rgba(15,23,42,.05));color:var(--mn-color-text-primary,#1f2933)}
.query-block-chrome :is(button,select,input):focus-visible,.query-block-affordance:focus-visible,.query-block-editor :is(input,textarea,button,select):focus-visible{outline:2px solid var(--mn-color-border-focus,#4d8768);outline-offset:1px}
.query-block-chrome button[aria-pressed=true]{background:color-mix(in srgb,var(--mn-color-accent,#4d8768) 14%,transparent);color:var(--mn-color-text-accent,#3d7f5f)}
.query-block-chrome .query-block-run{background:var(--mn-color-accent,#4d8768);color:var(--mn-color-text-on-accent,#fff)}
.query-block-chrome .query-block-run:hover{background:var(--mn-color-accent-strong,var(--mn-color-accent,#3d7f5f));color:var(--mn-color-text-on-accent,#fff)}
.query-block-chrome .query-block-delete:hover{color:var(--mn-color-danger-strong,#b42318);background:color-mix(in srgb,var(--mn-color-danger,#a8322d) 10%,transparent)}
.query-block-chrome button:disabled,.query-block-chrome select:disabled,.query-block-chrome input:disabled{opacity:.45;cursor:default}
.query-block-chrome-sep{width:1px;height:16px;background:var(--mn-color-border-subtle,rgba(15,23,42,.12))}
.query-block-bar{display:none;align-items:center;justify-content:flex-end;min-height:44px}
.query-block-affordance{flex:none;display:inline-grid;place-items:center;width:44px;height:44px;margin:0;padding:0;border:0;border-radius:999px;background:transparent;color:var(--mn-color-text-tertiary,#697386);font:600 18px/1 var(--mn-font-chrome,system-ui,sans-serif);cursor:pointer;-webkit-tap-highlight-color:transparent}
.query-block[data-chrome-open] .query-block-affordance{color:var(--mn-color-text-accent,#3d7f5f)}
@media (hover:none),(pointer:coarse){.query-block-bar{display:flex}.query-block .query-block-chrome,.query-block:is(:hover,:focus-within) .query-block-chrome{position:static;display:none;opacity:1;visibility:visible;transform:none;justify-content:flex-start;margin:0 0 var(--mn-space-3,.75rem);box-shadow:none}.query-block:is([data-chrome-open],[data-face-stance=draft]) .query-block-chrome{display:flex}.query-block-chrome :is(button,select,input){height:36px}}
.query-block-editor{display:grid;gap:var(--mn-space-2,.5rem);margin:0 0 var(--mn-space-3,.75rem);padding:var(--mn-space-3,.75rem);border:1px solid var(--mn-color-border-subtle,rgba(15,23,42,.12));border-radius:var(--mn-radius-md,8px);background:var(--mn-color-surface-sunken,rgba(15,23,42,.03))}
.query-block-editor[hidden],.query-block-editor label[hidden],.query-block-host-vega-builder[hidden],.query-block-host-vega-spec[hidden]{display:none}
.query-block-editor label{display:grid;gap:4px;color:var(--mn-color-text-tertiary,#697386);font:600 var(--mn-text-2xs,.72rem)/1.2 var(--mn-font-chrome,system-ui,sans-serif);letter-spacing:var(--sophia-tracking-label,.04em);text-transform:lowercase;font-variant:small-caps}
.query-block-host-comment,.query-block-host-query,.query-block-host-vega-spec{box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid var(--mn-color-border-subtle,rgba(15,23,42,.14));border-radius:var(--mn-radius-sm,5px);background:var(--mn-color-surface-editor,var(--mn-color-surface-raised,#fff));color:var(--mn-color-text-primary,#1f2933);font:400 var(--mn-text-sm,.875rem)/1.45 var(--mn-font-chrome,system-ui,sans-serif);letter-spacing:normal;text-transform:none;font-variant:normal}
.query-block-host-query,.query-block-host-vega-spec{min-height:120px;resize:vertical;font:400 var(--mn-text-xs,.78rem)/1.5 var(--mn-font-mono,ui-monospace,monospace);tab-size:2}
.query-block-host-query[readonly]{background:transparent}
.query-block-host-error{margin:0 0 var(--mn-space-2,.5rem);color:var(--mn-color-danger-strong,#b42318);font:500 var(--mn-text-xs,.78rem)/1.45 var(--mn-font-chrome,system-ui,sans-serif);white-space:pre-wrap}
.query-block-host-error:empty{display:none}
.query-block-caption{margin-top:var(--mn-space-2,.5rem);color:var(--mn-color-text-tertiary,#697386);font:400 var(--mn-text-2xs,.74rem)/1.4 var(--mn-font-chrome,system-ui,sans-serif);font-variant-numeric:tabular-nums}
.query-block-caption:empty{display:none}
.query-block-hint{color:var(--mn-color-text-tertiary,#697386);font:400 var(--mn-text-2xs,.72rem)/1.4 var(--mn-font-chrome,system-ui,sans-serif)}
.query-block-output{min-width:0;overflow-x:auto}
.query-block-output > pre{margin:0;padding:var(--mn-space-2,.5rem);border-radius:var(--mn-radius-sm,5px);background:var(--mn-color-surface-sunken,rgba(15,23,42,.04));font:400 var(--mn-text-xs,.78rem)/1.5 var(--mn-font-mono,ui-monospace,monospace);white-space:pre-wrap;overflow-wrap:anywhere}
.query-block-host-table{width:100%;border-collapse:collapse;font:400 var(--mn-text-sm,.875rem)/1.45 var(--mn-font-chrome,system-ui,sans-serif);font-variant-numeric:tabular-nums}
.query-block-host-table th{padding:0 var(--mn-space-3,.75rem) 6px 0;border-bottom:1px solid var(--mn-color-border-default,rgba(15,23,42,.18));color:var(--mn-color-text-tertiary,#697386);font:600 var(--mn-text-2xs,.72rem)/1.2 var(--mn-font-chrome,system-ui,sans-serif);letter-spacing:var(--sophia-tracking-label,.04em);text-align:left;text-transform:lowercase;font-variant:small-caps;white-space:nowrap}
.query-block-host-table td{padding:7px var(--mn-space-3,.75rem) 7px 0;border-bottom:1px solid var(--mn-color-border-subtle,rgba(15,23,42,.08));color:var(--mn-color-text-primary,#1f2933);text-align:left;vertical-align:top}
.query-block-host-table tr:last-child td{border-bottom:0}
.query-block-host-table :is(th,td):last-child{padding-right:0}
.query-block-host-table [data-column-shape=token],.query-block-host-table [data-column-shape=chip]{white-space:nowrap;width:1%}
.query-block-host-table [data-column-shape=token]{color:var(--mn-color-text-secondary,#475467);font-family:var(--mn-font-mono,ui-monospace,monospace);font-size:var(--mn-text-xs,.78rem)}
.query-block-host-table [data-column-shape=number]{white-space:nowrap;width:1%;text-align:right}
.query-block-host-table th[data-column-shape=number]{text-align:right}
.query-block-host-table [data-column-shape=reference]{overflow-wrap:anywhere;color:var(--mn-color-text-secondary,#475467);font-size:var(--mn-text-xs,.78rem)}
.query-block-host-table [data-column-shape=prose]{min-width:16ch;font-family:var(--mn-font-prose,Georgia,serif)}
.query-block-clamp{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:3}
td[data-clamp]{cursor:pointer}
td[data-clamp][data-expanded] .query-block-clamp{display:block;-webkit-line-clamp:unset}
.query-block-host-stat{padding:var(--mn-space-2,.5rem) 0;font:650 var(--mn-text-3xl,1.75rem)/1.1 var(--mn-font-chrome,system-ui,sans-serif);font-variant-numeric:tabular-nums}
.query-block-host-vega-builder{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:var(--mn-space-2,.5rem);margin:0 0 var(--mn-space-3,.75rem);padding:var(--mn-space-3,.75rem);border:1px solid var(--mn-color-border-subtle,rgba(15,23,42,.12));border-radius:var(--mn-radius-md,8px);background:var(--mn-color-surface-sunken,rgba(15,23,42,.03))}
.query-block-host-vega-field{display:flex;min-width:0;flex-direction:column;gap:3px;color:var(--mn-color-text-tertiary,#697386);font:600 var(--mn-text-2xs,.72rem)/1.2 var(--mn-font-chrome,system-ui,sans-serif);letter-spacing:var(--sophia-tracking-label,.04em);text-transform:lowercase;font-variant:small-caps}
.query-block-host-vega-field select,.query-block-host-vega-json-toggle{box-sizing:border-box;min-width:0;width:100%;height:28px;padding:0 6px;border:1px solid var(--mn-color-border-subtle,rgba(15,23,42,.14));border-radius:var(--mn-radius-sm,5px);background:var(--mn-color-surface-editor,var(--mn-color-surface-raised,#fff));color:var(--mn-color-text-primary,#1f2933);font:400 var(--mn-text-xs,.78rem)/1 var(--mn-font-chrome,system-ui,sans-serif);text-transform:none;font-variant:normal;letter-spacing:normal}
.query-block-host-vega-json-toggle{align-self:end;cursor:pointer}
.query-block-host-vega-spec{margin:0 0 var(--mn-space-3,.75rem)}
.query-block-host-vega{min-height:120px;font-variant-numeric:tabular-nums}.query-block-host-vega-loading,.query-block-host-vega-hint{padding:12px 0;color:var(--mn-color-text-tertiary,#697386);font-size:var(--mn-text-xs,.78rem)}.query-block-host-vega-error{padding:12px 0;color:var(--mn-color-danger-strong,#b42318);font-size:var(--mn-text-xs,.78rem);white-space:pre-wrap}
.query-block-host-network{width:100%;height:260px;border:1px solid var(--mn-color-border-subtle,rgba(15,23,42,.12));border-radius:var(--mn-radius-sm,5px)}
.query-block[data-collapsed=true] .query-block-output,.query-block[data-collapsed=true] .query-block-caption{display:none}
@container (max-width:559px){
.query-block-host-table,.query-block-host-table tbody{display:block;width:100%}
.query-block-host-table thead{display:none}
.query-block-host-table tr{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:10px;row-gap:5px;align-items:center;padding:12px 0;border-bottom:1px solid var(--mn-color-border-subtle,rgba(15,23,42,.08))}
.query-block-host-table tr:first-child{padding-top:4px}
.query-block-host-table tr:last-child{border-bottom:0}
.query-block-host-table td{display:block;min-width:0;width:auto;padding:0;border:0}
.query-block-host-table td[data-column-shape=token]{order:1}
.query-block-host-table td[data-column-shape=chip]{order:2;justify-self:start}
.query-block-host-table td[data-column-shape=prose]{order:3;grid-column:1/-1;min-width:0}
.query-block-host-table td:not([data-column-shape=token]):not([data-column-shape=chip]):not([data-column-shape=prose]){order:4;grid-column:1/-1;display:flex;gap:8px;align-items:baseline;width:auto;text-align:left;font-size:var(--mn-text-xs,.8rem)}
.query-block-host-table td:not([data-column-shape=token]):not([data-column-shape=chip]):not([data-column-shape=prose])::before{content:attr(data-label);flex:none;color:var(--mn-color-text-tertiary,#697386);font:600 var(--mn-text-2xs,.72rem)/1.3 var(--mn-font-chrome,system-ui,sans-serif);letter-spacing:var(--sophia-tracking-label,.04em);text-transform:lowercase;font-variant:small-caps}
.query-block-host-table td[data-empty]:not([data-column-shape=token]){display:none}
.query-block-bar{display:flex}
.query-block .query-block-chrome,.query-block:is(:hover,:focus-within) .query-block-chrome{position:static;display:none;opacity:1;visibility:visible;transform:none;justify-content:flex-start;margin:0 0 var(--mn-space-3,.75rem);box-shadow:none}
.query-block:is([data-chrome-open],[data-face-stance=draft]) .query-block-chrome{display:flex}
.query-block-chrome :is(button,select,input){height:36px}
.query-block-host-meta{display:none}.query-block-host-table td,.query-block-host-table th{padding-right:var(--mn-space-2,.5rem)}.query-block-host-meta{display:none}}
@media (prefers-reduced-motion:reduce){.query-block-chrome{transition:none}}
${VALUE_FACE_STYLE}
`

/**
 * The editor lives in `<sh-editor-host>`'s SHADOW root: a `<style>` in
 * `document.head` never reaches it (found 2026-09-25 — every block rendered
 * as bare native widgets). Style the root the block actually renders in.
 */
function ensureStyle(target: HTMLElement): boolean {
  const root = target.getRootNode()
  const host: ParentNode | null = root instanceof ShadowRoot
    ? root
    : root === target.ownerDocument
      ? target.ownerDocument.head
      : null
  if (!host) return false
  // Adopted, not a <style> element: the app's CSP refuses runtime <style>
  // elements (see adoptStyleSheet).
  adoptStyleSheet(root instanceof ShadowRoot ? root : target.ownerDocument, 'shrubbery-query-block-style', QUERY_BLOCK_STYLE)
  return true
}

/** How a result column reads in the table: decides wrapping, alignment and clamping. */
export type QueryBlockColumnShape = 'chip' | 'number' | 'token' | 'reference' | 'prose' | 'text'

const TOKEN_MAX = 32
const PROSE_MIN = 90

/**
 * Column shape from the column's terms and their value faces — never from its
 * name. Tokens (ids, slugs: no whitespace, short) never wrap; prose clamps.
 */
export function queryBlockColumnShape(
  terms: readonly (QueryBlockTerm | undefined)[],
  views: readonly ValueView[],
): QueryBlockColumnShape {
  const present = terms.map((term, index) => ({ term, view: views[index] })).filter(({ term }) => term?.value)
  if (present.length === 0) return 'text'
  if (present.every(({ view }) => view?.face === 'value.chip')) return 'chip'
  if (present.every(({ term }) => term && queryBlockValueKind(term) === 'number')) return 'number'
  if (present.every(({ term }) => term?.type === 'uri' || term?.type === 'bnode')) return 'reference'
  if (present.some(({ view }) => (view?.text.length ?? 0) > PROSE_MIN)) return 'prose'
  if (present.every(({ view }) => view && view.text.length <= TOKEN_MAX && !/\s/.test(view.text))) return 'token'
  return 'text'
}

/** "just now", "3 min ago" — the caption's relative time. */
export function formatQueryBlockAge(ranAt: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ranAt) / 1000))
  if (seconds < 45) return 'just now'
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' })
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return format.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return format.format(-hours, 'hour')
  return format.format(-Math.round(hours / 24), 'day')
}

/** The read face's caption: what came back, and when. */
function pluralize(word: string, count: number): string {
  if (count === 1) return word
  if (/(s|x|ch|sh)$/.test(word)) return `${word}es`
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`
  return `${word}s`
}

function singular(word: string): string {
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`
  if (/(ches|shes|xes|ses)$/.test(word)) return word.slice(0, -2)
  return word.replace(/s$/, '')
}

/** The class a query binds `?variable` to (`?c a claim:Claim` → `claim`), lower-cased local name. */
function classNounOf(query: string, variable: string): string | null {
  const pattern = new RegExp(`\\?${variable}\\s+(?:a|rdf:type|<http://www\\.w3\\.org/1999/02/22-rdf-syntax-ns#type>)\\s+(<[^>]+>|[\\w-]*:[\\w-]+)`, 'g')
  const classes = new Set([...query.matchAll(pattern)].map(match => match[1]))
  if (classes.size !== 1) return null
  const iri = [...classes][0].replace(/^<|>$/g, '')
  const local = iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'), iri.lastIndexOf(':')) + 1)
  return local ? local.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase() : null
}

const GENERIC_COUNT_NAMES = new Set(['n', 'count', 'counts', 'total', 'num', 'number', 'value', 'values'])

/**
 * What a result counts, when the query says so — the caption's "25 claims"
 * instead of "6 rows":
 *   - one `COUNT(?x) AS ?alias` column: the sum of that column, named by the
 *     alias when it is a word ("claims"), else by the class `?x` is bound to;
 *   - no aggregate, one `?x a Class` pattern, and one row per distinct value of
 *     the first column: the rows ARE those things.
 * Null when unknown; the caption then counts rows.
 */
export function queryBlockCountUnit(query: string, result: QueryBlockResult): { count: number; unit: string } | null {
  if (result.resultKind !== 'bindings' || result.rows.length === 0) return null
  const counts = [...query.matchAll(/COUNT\s*\(\s*(?:DISTINCT\s+)?\?(\w+)\s*\)\s*AS\s+\?(\w+)/gi)]
  if (counts.length === 1) {
    const [, counted, alias] = counts[0]
    if (!result.columns.includes(alias)) return null
    const values = result.rows.map(row => Number(row[alias]?.value))
    if (values.some(value => !Number.isFinite(value))) return null
    const total = values.reduce((sum, value) => sum + value, 0)
    const word = /^[a-z][a-z_]{2,}$/i.test(alias) && !GENERIC_COUNT_NAMES.has(alias.toLowerCase())
      ? singular(alias.replace(/_/g, ' ').toLowerCase())
      : classNounOf(query, counted)
    return word ? { count: total, unit: pluralize(word, total) } : null
  }
  if (counts.length > 1 || /\bGROUP\s+BY\b/i.test(query)) return null
  const bound = [...query.matchAll(/\?(\w+)\s+(?:a|rdf:type)\s+(?:<[^>]+>|[\w-]*:[\w-]+)/g)].map(match => match[1])
  if (new Set(bound).size !== 1) return null
  const noun = classNounOf(query, bound[0])
  const first = result.columns[0]
  const distinct = new Set(result.rows.map(row => row[first]?.value)).size
  if (!noun || distinct !== result.rows.length) return null
  if ((result.totalRowCount ?? result.rows.length) > result.rows.length) return null
  return { count: result.rows.length, unit: pluralize(noun, result.rows.length) }
}

export function queryBlockCaption(result: QueryBlockResult, ranAt: number, now?: number, query?: string): string {
  const age = formatQueryBlockAge(ranAt, now)
  if (result.resultKind === 'ask') return `${result.boolean ? 'yes' : 'no'} · ${age}`
  if (result.resultKind === 'serialized') return `${result.mediaType} · ${age}`
  const unit = query ? queryBlockCountUnit(query, result) : null
  if (unit) return `${unit.count} ${unit.unit} · ${age}`
  const shown = result.rows.length
  const total = result.totalRowCount ?? shown
  const count = total > shown ? `${shown} of ${total} rows` : `${shown} ${shown === 1 ? 'row' : 'rows'}`
  return `${count} · ${age}`
}

export function makeQueryBlockRenderer(
  service: QueryBlockService,
  options: QueryBlockRendererOptions = {},
): QueryBlockRenderer {
  return (target, initialRequest) => {
    const document = target.ownerDocument
    let request = initialRequest
    let result: QueryBlockResult | null = null
    let ranAt = 0
    let dictionary: ValueDictionary = EMPTY_VALUE_DICTIONARY
    let runId = 0
    let richVisualizationCleanup: (() => void) | null = null
    let richVisualizationRenderId = 0
    let rawVegaJsonVisible = false
    let queryEditorOpen = false
    let chartEditorOpen = false
    let chromeOpen = false
    let themeFlipDispose: (() => void) | null = null
    // The chart an AUTO block would draw. Shown, never stored: a read must not
    // write (2026-09-25: opening senderos turned `readme-weakest-q` from a
    // table into a stored bar chart). It is persisted only when the author
    // edits the chart.
    let autoVegaSpec = ''
    let valueFaceHints: readonly string[] = []

    let styled = ensureStyle(target)
    const styleWhenConnected = (): void => {
      if (!styled) styled = ensureStyle(target)
    }
    queueMicrotask(styleWhenConnected)

    const baseStance = (): FaceStance => {
      const stance = options.stance?.()
      return stance === 'draft' || stance === 'review' ? stance : 'read'
    }

    const commitAttrs = (patch: Partial<QueryBlockAttrs>): void => {
      request.updateAttrs(patch)
      request = { ...request, attrs: { ...request.attrs, ...patch } }
    }

    const button = (text: string, className: string, label?: string): HTMLButtonElement => {
      const element = document.createElement('button')
      element.type = 'button'
      element.className = className
      element.textContent = text
      if (label) element.setAttribute('aria-label', label)
      return element
    }

    // ── read face ─────────────────────────────────────────────────────────
    const head = document.createElement('div')
    head.className = 'query-block-head'
    const title = document.createElement('div')
    title.className = 'query-block-title'
    head.appendChild(title)

    // ── draft chrome (hover / focus-within / touch affordance) ────────────
    const toolbar = document.createElement('div')
    toolbar.className = 'query-block-chrome query-block-host-toolbar'
    toolbar.setAttribute('role', 'toolbar')
    toolbar.setAttribute('aria-label', 'Query block')
    const meta = document.createElement('span')
    meta.className = 'query-block-host-meta'
    const visualization = document.createElement('select')
    visualization.setAttribute('aria-label', 'Visualization')
    for (const value of ['table', 'stat', 'triples', 'vega', 'network', 'json'] as const) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = value === 'vega' ? 'Chart' : value[0].toUpperCase() + value.slice(1)
      visualization.appendChild(option)
    }
    const maxRows = document.createElement('input')
    maxRows.type = 'number'
    maxRows.min = '1'
    maxRows.max = '500'
    maxRows.setAttribute('aria-label', 'Row limit')
    maxRows.title = 'Row limit'
    const editQuery = button('Query', 'query-block-edit-query', 'Edit query')
    const editChart = button('Edit chart', 'query-block-edit-chart')
    const run = button('Run', 'query-block-run')
    const collapse = button('Collapse', 'query-block-collapse')
    const remove = button('Delete', 'query-block-delete')
    const separator = (): HTMLSpanElement => {
      const element = document.createElement('span')
      element.className = 'query-block-chrome-sep'
      element.setAttribute('aria-hidden', 'true')
      return element
    }
    toolbar.append(meta, separator(), visualization, maxRows, editQuery, editChart, separator(), run, collapse, remove)
    const affordance = button('⋯', 'query-block-affordance', 'Query block options')
    affordance.setAttribute('aria-expanded', 'false')
    // The slim bar above the block (touch screens, narrow blocks): the ⋯ sits
    // there, right-aligned, like the diagram's — never beside or over the
    // title or the result (senderos follow-ups, 2026-09-26).
    const bar = document.createElement('div')
    bar.className = 'query-block-bar'
    bar.appendChild(affordance)

    // ── query editor (draft, pinned) / query source (review) ──────────────
    const editor = document.createElement('div')
    editor.className = 'query-block-editor'
    const commentLabel = document.createElement('label')
    commentLabel.textContent = 'Title'
    const comment = document.createElement('input')
    comment.className = 'query-block-host-comment'
    comment.placeholder = 'Add a title…'
    commentLabel.appendChild(comment)
    const queryLabel = document.createElement('label')
    queryLabel.textContent = 'SPARQL'
    const query = document.createElement('textarea')
    query.className = 'query-block-host-query'
    query.spellcheck = false
    queryLabel.appendChild(query)
    editor.append(commentLabel, queryLabel)

    // ── chart editor (behind "Edit chart") ────────────────────────────────
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
    const vegaHint = document.createElement('div')
    vegaHint.className = 'query-block-hint'
    vegaBuilder.appendChild(vegaHint)
    const vegaSpec = document.createElement('textarea')
    vegaSpec.className = 'query-block-host-vega-spec'
    vegaSpec.spellcheck = false
    vegaSpec.placeholder = 'Vega-Lite JSON spec'
    vegaSpec.setAttribute('aria-label', 'Vega-Lite JSON spec')

    const error = document.createElement('div')
    error.className = 'query-block-host-error'
    error.setAttribute('role', 'status')
    const output = document.createElement('div')
    output.className = 'query-block-output'
    output.setAttribute('aria-live', 'polite')
    const caption = document.createElement('div')
    caption.className = 'query-block-caption'
    target.replaceChildren(bar, head, toolbar, editor, vegaBuilder, vegaSpec, error, output, caption)

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

    const effectiveVegaSpec = (): string => request.attrs.vegaLiteSpec.trim() ? request.attrs.vegaLiteSpec : autoVegaSpec

    const renderTable = (columns: readonly string[], terms: ReadonlyArray<Record<string, QueryBlockTerm | undefined>>): void => {
      const stance = baseStance()
      const mode = resolveVegaThemeMode(target)
      const views = terms.map(row => Object.fromEntries(columns.map(column => [
        column, resolveValueFace(row[column], dictionary, { stance, slot: 'inline' }),
      ])) as Record<string, ValueView>)
      const shapes = new Map(columns.map(column => [
        column,
        queryBlockColumnShape(terms.map(row => row[column]), views.map(row => row[column])),
      ]))
      // The shared table structure (sh-sparql-table-view builds the same one),
      // then the value faces into its cells.
      const table = buildBindingsTableElement(columns, views.map(row => Object.fromEntries(
        columns.map(column => [column, row[column].text]),
      )))
      table.className = 'query-block-host-table'
      table.querySelectorAll('th').forEach((th, index) => {
        th.dataset.columnShape = shapes.get(columns[index]) ?? 'text'
      })
      table.querySelectorAll('tbody tr').forEach((tr, rowIndex) => {
        tr.querySelectorAll('td').forEach((td, columnIndex) => {
          const column = columns[columnIndex]
          const shape = shapes.get(column) ?? 'text'
          const view = views[rowIndex]?.[column]
          td.dataset.columnShape = shape
          td.dataset.label = column.replace(/_/g, ' ')
          if (!view?.text) td.dataset.empty = ''
          if (!view) return
          if (view.face === 'value.chip') {
            td.replaceChildren(renderValueView(document, view, mode))
          } else if (shape === 'prose') {
            const clamp = document.createElement('div')
            clamp.className = 'query-block-clamp'
            clamp.textContent = view.text
            td.replaceChildren(clamp)
            if (view.text.length > PROSE_MIN) {
              td.dataset.clamp = ''
              td.title = 'Click to show the whole text'
            }
          } else if (view.title && view.title !== view.text) {
            td.title = view.title
          }
        })
      })
      table.addEventListener('click', (event) => {
        const cell = (event.target as Element | null)?.closest?.('td[data-clamp]') as HTMLElement | null
        if (!cell) return
        if (cell.hasAttribute('data-expanded')) cell.removeAttribute('data-expanded')
        else cell.setAttribute('data-expanded', '')
      })
      output.appendChild(table)
    }

    const renderOutput = (): void => {
      clearRichVisualization()
      output.replaceChildren()
      if (!result) {
        output.dataset.visualizationMode = ''
        const pending = document.createElement('div')
        pending.className = 'query-block-hint'
        pending.textContent = target.dataset.status === 'running' ? 'Running query…' : 'No result yet.'
        output.appendChild(pending)
        return
      }
      // Baked colors (chips, charts) re-render when the root theme flips.
      themeFlipDispose = observeVegaThemeFlips(target.ownerDocument, () => renderOutput())
      const mode = chosenVisualization(request.attrs, result)
      output.dataset.visualizationMode = mode
      if (mode === 'json') {
        const pre = document.createElement('pre')
        pre.textContent = JSON.stringify(result.raw, null, 2)
        output.appendChild(pre)
        return
      }
      if (mode === 'stat') {
        const stat = document.createElement('div')
        stat.className = 'query-block-host-stat'
        if (result.resultKind === 'ask') {
          stat.textContent = String(result.boolean)
        } else if (result.resultKind === 'bindings') {
          const view = resolveValueFace(result.rows[0]?.[result.columns[0]], dictionary, { stance: baseStance(), slot: 'block' })
          if (view.face === 'value.chip') stat.appendChild(renderValueView(document, view, resolveVegaThemeMode(target)))
          else stat.textContent = view.text
        }
        output.appendChild(stat)
        return
      }
      if (mode === 'vega' && result.resultKind === 'bindings') {
        const host = document.createElement('div')
        host.className = 'query-block-host-vega'
        const loading = document.createElement('div')
        loading.className = 'query-block-host-vega-loading'
        loading.textContent = 'Rendering chart…'
        host.appendChild(loading)
        output.dataset.visualizationStatus = 'rendering'
        output.appendChild(host)

        const activeRender = ++richVisualizationRenderId
        void mountQueryBlockVega({
          container: host,
          result,
          vegaLiteSpec: effectiveVegaSpec(),
          loadEmbed: options.loadVegaEmbed,
          valueDictionary: dictionary,
          onValueFaceHints: (hints) => {
            valueFaceHints = hints
            vegaHint.textContent = hints.length ? `Order: ${hints.join('; ')}.` : ''
          },
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
          text.setAttribute('fill', 'currentColor')
          text.textContent = id.length > 24 ? `…${id.slice(-23)}` : id
          svg.appendChild(text)
        }
        output.appendChild(svg)
        return
      }
      if (mode === 'triples') {
        const columns = ['subject', 'predicate', 'object']
        renderTable(columns, triples.map(row => Object.fromEntries(columns.map(column => [
          column, { type: 'literal', value: row[column as keyof typeof row] } as QueryBlockTerm,
        ]))))
        return
      }
      if (result.resultKind === 'bindings') renderTable(result.columns, result.rows)
    }

    const renderCaption = (): void => {
      if (!result || target.dataset.status === 'error') {
        caption.textContent = ''
        return
      }
      const stance = baseStance()
      caption.textContent = stance === 'review'
        ? `${queryBlockCaption(result, ranAt, undefined, request.attrs.query)} · ${result.queryKind.toUpperCase()} in ${result.durationMs} ms`
        : queryBlockCaption(result, ranAt, undefined, request.attrs.query)
    }
    const captionTimer = setInterval(renderCaption, 30_000)
    // Charts are laid out for the width they mount at: re-mount when the
    // block's width changes (a rotated phone, a resized split pane).
    let chartWidth = 0
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0)
      if (!width || Math.abs(width - chartWidth) < 4) return
      const first = chartWidth === 0
      chartWidth = width
      if (first || output.dataset.visualizationMode !== 'vega') return
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => renderOutput(), 150)
    })
    resizeObserver?.observe(output)

    const sync = (): void => {
      styleWhenConnected()
      const stance = baseStance()
      const pinnedDraft = queryEditorOpen || chartEditorOpen
      target.dataset.faceStance = stance === 'read' && pinnedDraft ? 'draft' : stance
      target.dataset.collapsed = String(request.attrs.collapsed)
      if (chromeOpen) target.dataset.chromeOpen = ''
      else delete target.dataset.chromeOpen
      affordance.setAttribute('aria-expanded', String(chromeOpen))

      title.textContent = request.attrs.comment.trim()
      if (document.activeElement !== comment) comment.value = request.attrs.comment
      if (document.activeElement !== query) query.value = request.attrs.query
      if (document.activeElement !== vegaSpec) vegaSpec.value = effectiveVegaSpec()
      if (result) {
        populateBuilderFields(result)
        if (!vegaBuilder.contains(document.activeElement) && effectiveVegaSpec().trim()) {
          syncBuilderFromSpec(effectiveVegaSpec())
        }
      }
      visualization.value = request.attrs.displayMode === 'auto' && result
        ? chosenVisualization(request.attrs, result)
        : request.attrs.visualization
      maxRows.value = String(request.attrs.maxRows)
      comment.readOnly = !request.editable
      query.readOnly = !request.editable || stance === 'review' && !queryEditorOpen
      vegaSpec.readOnly = !request.editable
      visualization.disabled = !request.editable
      maxRows.disabled = !request.editable
      for (const select of [markSelect, ...fieldSelects, sortSelect, aggregateSelect, stackSelect]) {
        select.disabled = !request.editable
      }
      jsonToggle.disabled = !request.editable
      remove.hidden = !request.editable
      collapse.textContent = request.attrs.collapsed ? 'Expand' : 'Collapse'
      collapse.setAttribute('aria-expanded', String(!request.attrs.collapsed))

      editQuery.setAttribute('aria-label', request.editable ? 'Edit query' : 'Show query')
      editQuery.setAttribute('aria-pressed', String(queryEditorOpen))
      // review shows the query source; draft (pinned) edits it.
      editor.hidden = request.attrs.collapsed || !(queryEditorOpen || stance === 'review')
      commentLabel.hidden = !queryEditorOpen

      const showsChart = result
        ? chosenVisualization(request.attrs, result) === 'vega'
        : request.attrs.visualization === 'vega'
      editChart.hidden = !showsChart
      editChart.setAttribute('aria-pressed', String(chartEditorOpen && showsChart))
      vegaBuilder.hidden = request.attrs.collapsed || !showsChart || !chartEditorOpen
      vegaSpec.hidden = vegaBuilder.hidden || !rawVegaJsonVisible
      jsonToggle.textContent = rawVegaJsonVisible ? 'Hide JSON' : 'Edit JSON'
      jsonToggle.setAttribute('aria-expanded', String(rawVegaJsonVisible))
      vegaHint.textContent = valueFaceHints.length ? `Order: ${valueFaceHints.join('; ')}.` : ''
      output.hidden = request.attrs.collapsed
      renderOutput()
      renderCaption()
    }

    const execute = async (): Promise<void> => {
      const graphId = request.graphId
      const activeRun = ++runId
      target.dataset.status = 'running'
      run.disabled = true
      error.textContent = ''
      meta.textContent = 'Running…'
      if (!result) renderOutput()
      try {
        const [next, nextDictionary] = await Promise.all([
          runWithRetry(() => service.run(graphId ?? '', query.value, Number(maxRows.value))),
          graphId && options.valueDictionary
            ? options.valueDictionary.load(graphId).catch(() => EMPTY_VALUE_DICTIONARY)
            : Promise.resolve(dictionary),
        ])
        if (activeRun !== runId) return
        result = next
        dictionary = nextDictionary
        ranAt = Date.now()
        target.dataset.status = 'done'
        meta.textContent = `${result.queryKind.toUpperCase()} · ${result.durationMs} ms`
        populateBuilderFields(result)
        autoVegaSpec = ''
        if (request.attrs.vegaLiteSpec.trim()) {
          syncBuilderFromSpec(request.attrs.vegaLiteSpec)
        } else if (request.attrs.displayMode === 'auto') {
          const generated = generateAutoQueryBlockVegaSpec(result)
          if (generated) {
            autoVegaSpec = generated
            syncBuilderFromSpec(generated)
          }
        }
        // Only an edit the author ran is stored — never the open itself.
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

    for (const surface of [toolbar, vegaBuilder, editor, bar]) {
      surface.addEventListener('mousedown', (event) => event.stopPropagation())
    }
    comment.addEventListener('blur', () => {
      if (comment.value !== request.attrs.comment) commitAttrs({ comment: comment.value })
      title.textContent = comment.value.trim()
    })
    query.addEventListener('blur', () => {
      if (query.value !== request.attrs.query) commitAttrs({ query: query.value })
    })
    query.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void execute()
      }
    })
    const commitVegaSpec = (): void => {
      if (vegaSpec.value !== effectiveVegaSpec()) {
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
    editQuery.addEventListener('click', () => {
      queryEditorOpen = !queryEditorOpen
      sync()
      if (queryEditorOpen) query.focus()
    })
    editChart.addEventListener('click', () => {
      chartEditorOpen = !chartEditorOpen
      sync()
    })
    // Tapping anywhere outside the block closes the touch chrome. (Not
    // focusout: the editor takes focus back after every tap inside a node view.)
    const closeOnOutsidePointer = (event: Event): void => {
      if (event.composedPath().includes(target)) return
      setChromeOpen(false)
    }
    const setChromeOpen = (open: boolean): void => {
      if (open === chromeOpen) return
      chromeOpen = open
      if (open) document.addEventListener('pointerdown', closeOnOutsidePointer, true)
      else document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
      sync()
    }
    // A tap must not move focus: focusing the button scrolls the editor, the
    // release lands on the text below, and the click never reaches the button
    // (found at 390px, 2026-09-25). Keyboard activation is unaffected.
    // It toggles on POINTERDOWN: the editor's own pointer handling re-targets
    // the release of a tap near a block edge to the text beneath, so a click
    // never reaches the button (found at 390px, 2026-09-25). Keyboard
    // activation (a click with detail 0) still works.
    affordance.addEventListener('mousedown', event => event.preventDefault())
    affordance.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      setChromeOpen(!chromeOpen)
    })
    affordance.addEventListener('click', (event) => {
      if (event.detail === 0) setChromeOpen(!chromeOpen)
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
        clearInterval(captionTimer)
        resizeObserver?.disconnect()
        document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
        if (resizeTimer) clearTimeout(resizeTimer)
        clearRichVisualization()
        target.replaceChildren()
      },
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
