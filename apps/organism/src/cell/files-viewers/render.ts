/**
 * The viewers that Hoja renders, as one lazy module (off the Files route's static import graph): each turns a file's
 * text or bytes into what `<hoja-reader>` is given — a document in the reader schema, or HTML it parses through that
 * schema. Grammars (lowlight), Word (mammoth) and spreadsheets (SheetJS) load lazily again, each in its own chunk, only
 * when a file of their kind opens.
 */
import '@shrubbery/hoja/reader'
import { registerDataTable, releaseDataTable, type CodeHighlighter, type DataTableSheet } from '@shrubbery/hoja/reader'
import { Marked } from 'marked'
import type { FileViewerKind } from './registry.js'
import { parseDelimitedChunked, sniffDelimiter } from './delimited.js'

export interface ReaderView {
  readonly variant: 'prose' | 'code' | 'table'
  readonly doc?: unknown
  readonly html?: string | null
  readonly lineNumbers?: boolean
  readonly highlight?: CodeHighlighter | null
}

export interface ReaderBuild {
  readonly view: ReaderView
  /** A sentence about how the file was read, or null. */
  readonly note: string | null
  /** A data table's side-store reference, released when the viewer closes. */
  readonly dataRef: string | null
}

/** Let go of a data table's side-store entry. */
export const releaseTableRef = (ref: string): void => releaseDataTable(ref)

let highlighter: Promise<CodeHighlighter | null> | null = null

/** The grammar chunk, loaded once; a failure to load means plain monospace, never an error page. */
function loadHighlighter(): Promise<CodeHighlighter | null> {
  highlighter ??= import('./highlight.js').then(m => m.highlightCode, () => null)
  return highlighter
}

function normalizeNewlines(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text
}

/** One code block in the reader schema (an empty file is an empty block). */
export function codeDocument(text: string, language: string | null): unknown {
  const body = normalizeNewlines(text)
  return { type: 'doc', content: [{ type: 'codeBlock', attrs: { language }, content: body ? [{ type: 'text', text: body }] : [] }] }
}

const marked = new Marked({ gfm: true, breaks: false })

/** Markdown → HTML; the HTML then goes through the reader schema (raw HTML in the Markdown included: same allowlist). */
export function markdownHtml(text: string): string {
  return marked.parse(normalizeNewlines(text), { async: false }) as string
}

/** JSON pretty-printed (JSON Lines: each record), or the text as it is with a note when it does not parse. */
export function prettyJson(text: string, lines: boolean): { readonly text: string; readonly note: string | null } {
  if (lines) {
    const out: string[] = []
    let bad = 0
    for (const line of normalizeNewlines(text).split('\n')) {
      if (!line.trim()) continue
      try { out.push(JSON.stringify(JSON.parse(line), null, 2)) } catch { bad++; out.push(line) }
    }
    return { text: out.join('\n'), note: bad ? `${bad} ${bad === 1 ? 'line is' : 'lines are'} not valid JSON and ${bad === 1 ? 'is' : 'are'} shown as written.` : null }
  }
  try {
    return { text: JSON.stringify(JSON.parse(text), null, 2), note: null }
  } catch (error) {
    return { text, note: `Not valid JSON (${error instanceof Error ? error.message : String(error)}); shown as written.` }
  }
}

function tableDocument(ref: string, caption: string): unknown {
  return { type: 'doc', content: [{ type: 'dataTable', attrs: { ref, caption } }] }
}

export interface TextBuildOptions {
  readonly name: string
  readonly signal?: AbortSignal
  /** HTML's Source switch. */
  readonly source?: boolean
  /** The text is only the file's start (JSON is then not re-formatted). */
  readonly truncated?: boolean
}

/** A text kind (plain text, Markdown, code, JSON, CSV/TSV, HTML) → its reader view. */
export async function buildTextView(kind: FileViewerKind, text: string, options: TextBuildOptions): Promise<ReaderBuild> {
  switch (kind.viewer) {
    case 'markdown':
      return { view: { variant: 'prose', html: markdownHtml(text), highlight: await loadHighlighter() }, note: null, dataRef: null }
    case 'html':
      if (options.source) return { view: { variant: 'code', doc: codeDocument(text, 'xml'), lineNumbers: true, highlight: await loadHighlighter() }, note: null, dataRef: null }
      return { view: { variant: 'prose', html: text, highlight: await loadHighlighter() }, note: null, dataRef: null }
    case 'json': {
      const pretty = options.truncated ? { text, note: null } : prettyJson(text, kind.lines === true)
      return { view: { variant: 'code', doc: codeDocument(pretty.text, 'json'), lineNumbers: true, highlight: await loadHighlighter() }, note: pretty.note, dataRef: null }
    }
    case 'csv': {
      const delimiter = sniffDelimiter(text, kind.delimiter ?? ',')
      const table = await parseDelimitedChunked(text, delimiter, { signal: options.signal })
      const sheet: DataTableSheet = { name: options.name, columns: table.columns, rows: table.rows }
      const ref = registerDataTable({ sheets: [sheet] })
      return { view: { variant: 'table', doc: tableDocument(ref, options.name) }, note: null, dataRef: ref }
    }
    case 'code':
      return { view: { variant: 'code', doc: codeDocument(text, kind.language ?? null), lineNumbers: true, highlight: await loadHighlighter() }, note: null, dataRef: null }
    default:
      return { view: { variant: 'code', doc: codeDocument(text, 'plaintext'), lineNumbers: true, highlight: null }, note: null, dataRef: null }
  }
}

/** A Word document → HTML (mammoth, lazy) → the reader schema. Embedded pictures arrive as data: URIs. */
export async function buildDocxView(bytes: Uint8Array): Promise<ReaderBuild> {
  const { docxHtml } = await import('./docx.js')
  const result = await docxHtml(bytes)
  return { view: { variant: 'prose', html: result.html, highlight: await loadHighlighter() }, note: result.note, dataRef: null }
}

/** A workbook → its sheets as one data table with tabs (SheetJS, lazy). */
export async function buildSheetView(bytes: Uint8Array, name: string): Promise<ReaderBuild> {
  const { workbookSheets } = await import('./sheet.js')
  const sheets = await workbookSheets(bytes)
  const ref = registerDataTable({ sheets })
  return { view: { variant: 'table', doc: tableDocument(ref, name) }, note: sheets.length ? null : 'This workbook has no sheets.', dataRef: ref }
}
