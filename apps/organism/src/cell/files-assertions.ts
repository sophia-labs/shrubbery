/**
 * What a file's kind read from it, for the open PDF's reader: the cell tool of the kind's margin (`datasheet_facts` for a datasheet) is
 * asked once per opened file, and its answer becomes the reader's assertions (`<mn-pdf-reader>`'s overlay and list). Files knows none of
 * the kind's words; it asks `FileKind.margin`.
 *
 * Also the deep link: a request to open an assertion (`#evidence=<claim id>`) waits here until the file is open and the reading is in,
 * then reaches the reader as `reveal`.
 */
import { CORROBORATION_MARK, CORROBORATION_WORDS } from '@shrubbery/nucleus'
import { FILE_KINDS, type FileKind, type MarginReading, type MarginRowData } from './files-kinds/index.js'
import type { PdfAssertion, PdfReadingInfo } from './pdf-reader/pdf-reader-types.js'

export interface FilesAssertionsDeps {
  readonly tool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
  readonly kinds?: readonly FileKind[]
  readonly onChange: () => void
}

type Load = { readonly key: string; readonly artifactId: string; readonly title: string; readonly status: 'loading' | 'ready' | 'error'; readonly reading: MarginReading | null; readonly error: string }

export interface PaneAssertions {
  readonly assertions: readonly PdfAssertion[]
  readonly info: PdfReadingInfo | null
  readonly overlay: boolean
  readonly selected: string | null
  readonly reveal: { readonly id: string; readonly nonce: number } | null
}

export function assertionOf(row: MarginRowData, groups: ReadonlyMap<string, string>): PdfAssertion {
  return {
    id: row.id, page: row.page, label: row.label, symbol: row.symbol, value: row.value, group: groups.get(row.group) ?? '',
    conditions: row.conditions, readings: row.readings, notes: row.notes, mark: CORROBORATION_MARK[row.mark], agreement: CORROBORATION_WORDS[row.mark],
    status: row.status, numbers: row.numbers, readingPages: row.readingPages, key: row.key,
    ...(row.box ? { box: row.box } : {}), ...(row.precision ? { precision: row.precision } : {}), ...(row.method ? { method: row.method } : {}),
    ...(row.actions?.length ? { actions: row.actions } : {}),
  }
}

export class FilesAssertions {
  private load: Load | null = null
  private converted: { readonly reading: MarginReading; readonly list: readonly PdfAssertion[]; readonly info: PdfReadingInfo } | null = null
  private overlay = false
  private selected: string | null = null
  private request: { readonly artifactId: string; readonly id: string; readonly nonce: number } | null = null
  private nonce = 0
  private open: string | null = null
  private disposed = false

  constructor(private readonly deps: FilesAssertionsDeps) {}

  private kindOf(kindId: string | null): FileKind | undefined {
    return kindId ? (this.deps.kinds ?? FILE_KINDS).find(k => k.id === kindId && k.margin) : undefined
  }

  /** What is open: the artifact and its kind (null: nothing, or a kind with no margin). Asks the cell once per (file, read state). */
  sync(graphId: string, artifactId: string | null, kindId: string | null, readState: string): void {
    const kind = artifactId && graphId ? this.kindOf(kindId) : undefined
    if (artifactId !== this.open) {
      this.open = artifactId
      // A file opened by a deep link keeps what the link asked for.
      const asked = this.request?.artifactId === artifactId ? this.request : null
      this.overlay = asked !== null
      this.selected = asked?.id ?? null
      this.converted = null
    }
    if (!kind?.margin || !artifactId) { this.load = null; this.converted = null; return }
    const key = `${graphId}|${artifactId}|${readState}`
    if (this.load?.key === key) return
    this.load = { key, artifactId, title: kind.margin.title, status: 'loading', reading: this.load?.artifactId === artifactId ? this.load.reading : null, error: '' }
    const margin = kind.margin
    void this.deps.tool(margin.tool, margin.args(graphId, artifactId)).then(raw => {
      if (this.disposed || this.load?.key !== key) return
      this.load = { key, artifactId, title: margin.title, status: 'ready', reading: margin.read(raw, artifactId), error: '' }
      this.converted = null
      this.deps.onChange()
    }, error => {
      if (this.disposed || this.load?.key !== key) return
      this.load = { key, artifactId, title: margin.title, status: 'error', reading: null, error: error instanceof Error ? error.message : String(error) }
      this.deps.onChange()
    })
  }

  /** What the open file hands the reader, or null for a plain PDF. */
  forPane(artifactId: string): PaneAssertions | null {
    const load = this.load
    if (!load || load.artifactId !== artifactId) return null
    const reading = load.reading
    if (!reading) {
      // Asked, not yet answered (or failed): the toggle is there, the list says so.
      return { assertions: [], overlay: this.overlay || this.request?.artifactId === artifactId, selected: this.selected, reveal: this.revealFor(artifactId),
        info: { heading: load.title, title: '', facts: [], notes: [], truncated: null,
          empty: load.status === 'error' ? `The reading could not be fetched: ${load.error}` : 'Reading what was read…' } }
    }
    if (this.converted?.reading !== reading) {
      const groups = new Map(reading.groups.map(g => [g.id, g.title]))
      this.converted = { reading, list: reading.rows.map(r => assertionOf(r, groups)),
        info: { heading: load.title, title: reading.title, facts: reading.facts, notes: reading.notes, empty: reading.empty, truncated: reading.truncated } }
    }
    return { assertions: this.converted.list, info: this.converted.info, overlay: this.overlay || this.request?.artifactId === artifactId,
      selected: this.selected, reveal: this.revealFor(artifactId) }
  }

  private revealFor(artifactId: string): { id: string; nonce: number } | null {
    return this.request && this.request.artifactId === artifactId ? { id: this.request.id, nonce: this.request.nonce } : null
  }

  /** Ask for an assertion of this file: the reader turns its overlay on and goes to it. */
  requestReveal(artifactId: string, id: string): void {
    this.request = { artifactId, id, nonce: ++this.nonce }
    this.overlay = true
    this.selected = id
    this.deps.onChange()
  }

  setOverlay(on: boolean): void { this.overlay = on; if (!on) this.request = null }
  select(id: string | null): void { this.selected = id }
  /** The kind's way from an evidence id back to its file. */
  artifactOf(kindId: string, evidenceId: string): string | null { return this.kindOf(kindId)?.margin?.artifactOf?.(evidenceId) ?? null }
  anyArtifactOf(evidenceId: string): string | null {
    for (const k of this.deps.kinds ?? FILE_KINDS) { const a = k.margin?.artifactOf?.(evidenceId); if (a) return a }
    return null
  }
  dispose(): void { this.disposed = true }
}
