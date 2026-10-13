/**
 * CSV and TSV, parsed for real (RFC 4180 and what spreadsheets actually write): quoted fields with doubled quotes,
 * delimiters and line breaks inside quotes, CRLF or LF or CR line ends, a leading BOM, ragged rows. A quote only opens a
 * quoted field at the field's start; text after a closing quote is kept (lenient, never lost). An unterminated quote
 * takes the rest of the file. Blank lines are skipped.
 *
 * Big files parse in slices that yield to the event loop between them, so the page stays responsive while a 200,000-row
 * file is read.
 */

export interface DelimitedTable {
  readonly columns: string[]
  readonly rows: string[][]
}

interface ParseState {
  i: number
  rows: string[][]
}

/** Parse up to `budget` rows from `state.i`; returns whether the text is finished. */
function step(text: string, delimiter: number, state: ParseState, budget: number): boolean {
  const n = text.length
  let i = state.i
  let row: string[] = []
  let made = 0
  while (i < n && made < budget) {
    let value: string
    if (text.charCodeAt(i) === 34) {
      let out = ''
      let segment = i + 1
      let j = segment
      for (;;) {
        const q = text.indexOf('"', j)
        if (q === -1) { out += text.slice(segment); i = n; break }
        if (text.charCodeAt(q + 1) === 34) { out += text.slice(segment, q + 1); j = q + 2; segment = j; continue }
        out += text.slice(segment, q)
        i = q + 1
        break
      }
      let k = i
      while (k < n) { const c = text.charCodeAt(k); if (c === delimiter || c === 10 || c === 13) break; k++ }
      if (k > i) out += text.slice(i, k)
      i = k
      value = out
    } else {
      let k = i
      while (k < n) { const c = text.charCodeAt(k); if (c === delimiter || c === 10 || c === 13) break; k++ }
      value = text.slice(i, k)
      i = k
    }
    row.push(value)
    if (i >= n) break
    const c = text.charCodeAt(i)
    if (c === delimiter) {
      i++
      if (i >= n) row.push('')
      continue
    }
    i += c === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1
    if (!(row.length === 1 && row[0] === '')) { state.rows.push(row); made++ }
    row = []
  }
  if (row.length && !(row.length === 1 && row[0] === '')) state.rows.push(row)
  state.i = i
  return i >= n
}

function prepare(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function tableOf(rows: string[][]): DelimitedTable {
  const columns = rows.shift() ?? []
  return { columns, rows }
}

/** Parse all at once (small inputs, tests). The first row is the header. */
export function parseDelimited(text: string, delimiter: ',' | '\t' | ';' = ','): DelimitedTable {
  const state: ParseState = { i: 0, rows: [] }
  step(prepare(text), delimiter.charCodeAt(0), state, Number.POSITIVE_INFINITY)
  return tableOf(state.rows)
}

/** Parse in slices of `slice` rows, yielding between them; aborts with the signal. The first row is the header. */
export async function parseDelimitedChunked(text: string, delimiter: ',' | '\t' | ';' = ',',
  options: { readonly slice?: number; readonly signal?: AbortSignal } = {}): Promise<DelimitedTable> {
  const source = prepare(text)
  const state: ParseState = { i: 0, rows: [] }
  const slice = options.slice ?? 20_000
  const code = delimiter.charCodeAt(0)
  while (!step(source, code, state, slice)) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    if (options.signal?.aborted) throw new DOMException('Reading the table was cancelled', 'AbortError')
  }
  return tableOf(state.rows)
}

/** A file named .csv that is really semicolon-separated (common in European exports): guess from the first line. */
export function sniffDelimiter(text: string, declared: ',' | '\t'): ',' | '\t' | ';' {
  if (declared === '\t') return '\t'
  const first = text.slice(0, Math.max(0, text.indexOf('\n')) || 4096)
  const count = (ch: string) => first.split(ch).length - 1
  return count(';') > count(',') && count(';') > 0 ? ';' : ','
}
