/**
 * A file's page: the default face of an opened file in Files (Vera, 2026-10-13). The Show info panel grown into the main pane, generic
 * for every file and composed from sections declared as data (`files-kinds/registry.ts`: `STANDARD_INFO_SECTIONS`, a kind's `page`):
 *
 *   standard   Contents (the file's own viewer) · Your notes (Hoja, `files-notes.ts`) · About this file (Show info's facts) · Connections
 *   a kind     its own sections and bodies, and where the standard ones sit (a datasheet folds its PDF under what was read from it)
 *
 * This controller owns what the page remembers while it is open (which sections are open, the table's filter, the one value the source
 * should show) and what it reads for its file (the listing record, the wires, the kind's page queries). The reading itself is the kind's
 * margin, loaded once by `FilesAssertions`; the viewer is `FilesPreviewController`'s. Nothing here writes, except the notes.
 */
import type { FileEvidence } from '@shrubbery/nucleus'
import type { FilesPageBody, FilesPageFact, FilesPageLink, FilesPageSection, FilesPanePage } from '@shrubbery/runtime'
import type { FilesClient } from './files-contract.js'
import { FILE_KINDS, type FileKind, type MarginReading } from './files-kinds/index.js'
import { resolveInfoSections, type InfoSectionRule, type KindPageContent, type KindPageInput } from './files-kinds/registry.js'
import { buildInfoModel, readInfoDetail, type InfoContext, type InfoDetail, type InfoItem, type InfoWire } from './files-info.js'
import { FilesNotes, NOTES_PREDICATE, type NotesTarget } from './files-notes.js'
import type { Companion } from './files-companions.js'
import { formatFileSize } from './files-policy.js'

type Row = Readonly<Record<string, unknown>>

export interface FilesPageFile {
  readonly graphId: string
  readonly id: string
  /** The tree key (`artifact:{id}`). */
  readonly key: string
  readonly label: string
  readonly caption: string
  readonly mimeType: string | null
  readonly sizeBytes: number | null
}

export interface FilesPageDeps {
  readonly client: FilesClient
  readonly onChange: () => void
  readonly kinds?: readonly FileKind[]
  /** Notes' save timing (tests). */
  readonly notesDebounceMs?: number
}

/** What the shell knows when it asks for the page. */
export interface FilesPageContext {
  readonly writable: boolean
  readonly anyFolder: boolean
  readonly graphIncarnation: string
  /** The file's folder id (null: the top). */
  readonly parentId: string | null
  /** The kind that read the file (from the place's evidence); null while the place's evidence is still being asked for. */
  readonly evidence: FileEvidence | undefined
  readonly evidencePending: boolean
  readonly reading: { readonly status: 'none' | 'loading' | 'ready' | 'error'; readonly reading: MarginReading | null; readonly error: string }
  readonly tree: KindPageInput['tree']
  readonly companions: readonly Companion[]
  /** For About this file: where the file is, as Show info says it. */
  readonly info: Pick<InfoContext, 'location' | 'contents' | 'scope'>
  /** Tree key → name, for the connections. */
  readonly nameOf: (id: string) => { readonly key: string; readonly label: string } | null
}

interface Reads {
  detail: InfoDetail | null
  detailStatus: 'loading' | 'ready' | 'error'
  wires: InfoWire[] | null
}

export class FilesPageController {
  private file: FilesPageFile | null = null
  private openState = new Map<string, boolean>()
  private filterText = ''
  private reads: Reads = { detail: null, detailStatus: 'loading', wires: null }
  private generation = 0
  private spot: { id: string; nonce: number } | null = null
  private nonce = 0
  private history: FilesPageFile[] = []
  /** Kind page queries: per graph (`graphId|kind|query`) and per file (`graphId|artifactId|kind|query`). */
  private queries = new Map<string, { status: 'loading' | 'ready' | 'error'; rows: readonly Row[] }>()
  readonly notes: FilesNotes

  constructor(private readonly deps: FilesPageDeps) {
    this.notes = new FilesNotes({ tool: (n, a) => deps.client.tool(n, a), onChange: () => deps.onChange(), ...(deps.notesDebounceMs !== undefined ? { debounceMs: deps.notesDebounceMs } : {}) })
  }

  get isOpen(): boolean { return this.file !== null }
  get current(): FilesPageFile | null { return this.file }
  /** The value the source should show (a page link), with a nonce per press. */
  get spotlight(): { id: string; nonce: number } | null { return this.spot }

  /** Open a file's page. `from`: the page it was opened from (Back returns there). */
  open(file: FilesPageFile, options: { readonly push?: boolean } = {}): void {
    if (options.push && this.file && this.file.id !== file.id) this.history.push(this.file)
    if (!options.push) this.history = []
    const same = this.file?.id === file.id && this.file.graphId === file.graphId
    // The notes editor (`<hoja-editor>`) is a lazy chunk, loaded with the first page.
    void import('@shrubbery/hoja').catch(() => undefined)
    this.file = file
    if (same) { this.deps.onChange(); return }
    this.filterText = ''
    this.spot = null
    const generation = ++this.generation
    this.reads = { detail: null, detailStatus: 'loading', wires: null }
    void readInfoDetail(this.deps.client, file.graphId, { kind: 'artifact', id: file.id, sizeBytes: file.sizeBytes }, { hash: false })
      .then(detail => { if (generation === this.generation) { this.reads = { ...this.reads, detail, detailStatus: 'ready' }; this.deps.onChange() } })
      .catch(() => { if (generation === this.generation) { this.reads = { ...this.reads, detailStatus: 'error' }; this.deps.onChange() } })
    void this.deps.client.tool('get_wires', { graphId: file.graphId, documentId: file.id, direction: 'both' }).then(read => {
      if (generation !== this.generation) return
      this.reads = { ...this.reads, wires: wiresOf(read, file) }
      this.deps.onChange()
    }).catch(() => { if (generation === this.generation) { this.reads = { ...this.reads, wires: [] }; this.deps.onChange() } })
    this.deps.onChange()
  }

  /** Back: the page this one was opened from, or none (the place). */
  back(): FilesPageFile | null {
    const previous = this.history.pop() ?? null
    if (previous) this.open(previous, { push: false })
    else this.close()
    return previous
  }

  close(): void {
    if (!this.file) return
    void this.notes.flush()
    this.notes.bind(null)
    this.file = null
    this.history = []
    this.spot = null
    this.generation++
    this.deps.onChange()
  }

  /** The graph changed: what was read for it goes. */
  forgetGraph(): void { this.queries.clear(); this.close() }

  private rule(id: string, kind: FileKind | undefined): InfoSectionRule | undefined {
    return resolveInfoSections(kind?.page?.sections).sections.find(r => r.id === id)
  }

  isSectionOpen(rule: InfoSectionRule): boolean {
    return this.file ? this.openState.get(`${this.file.id}|${rule.id}`) ?? !rule.collapsed : false
  }

  setSection(id: string, open: boolean): void {
    if (!this.file) return
    this.openState.set(`${this.file.id}|${id}`, open)
    this.deps.onChange()
  }

  setFilter(text: string): void { this.filterText = text; this.deps.onChange() }

  /** A page link: the source section opens and shows that value (or turns to that page). */
  goto(evidenceId: string): void {
    if (!this.file) return
    this.openState.set(`${this.file.id}|source`, true)
    this.spot = { id: evidenceId, nonce: ++this.nonce }
    this.deps.onChange()
  }

  /** Whether the source section is open now (the shell opens the viewer when it is). */
  sourceOpen(kind: FileKind | undefined, pending: boolean): boolean {
    if (!this.file || pending) return false
    const rule = this.rule('source', kind)
    return rule ? this.isSectionOpen(rule) : false
  }

  private kindOf(evidence: FileEvidence | undefined): FileKind | undefined {
    return evidence ? (this.deps.kinds ?? FILE_KINDS).find(k => k.id === evidence.kind) : undefined
  }

  /** Rows of one of the kind's page queries, asked once (per graph or per file) and kept. */
  private queryRows(kind: FileKind, file: FilesPageFile): Record<string, readonly Row[]> {
    const out: Record<string, readonly Row[]> = {}
    for (const q of kind.page?.queries ?? []) {
      const key = q.scope === 'graph' ? `${file.graphId}|${kind.id}|${q.id}` : `${file.graphId}|${file.id}|${kind.id}|${q.id}`
      let entry = this.queries.get(key)
      if (!entry) {
        entry = { status: 'loading', rows: [] }
        this.queries.set(key, entry)
        void this.deps.client.tool('sparql_query', { graphId: file.graphId, query: q.query(file.id) }).then(result => {
          this.queries.set(key, { status: 'ready', rows: Array.isArray(result.rows) ? result.rows as Row[] : [] })
          this.deps.onChange()
        }, () => { this.queries.set(key, { status: 'error', rows: [] }); this.deps.onChange() })
      }
      out[q.id] = entry.rows
    }
    return out
  }

  /** Ask the kind's page queries for the open file now. */
  prime(kind: FileKind | undefined): void {
    if (this.file && kind?.page) this.queryRows(kind, this.file)
  }

  /** Ask a graph-wide query again (after an import or an upload). */
  refreshGraphQueries(graphId: string): void {
    for (const key of [...this.queries.keys()]) if (key.startsWith(`${graphId}|`)) this.queries.delete(key)
  }

  /** The page as the pane draws it. */
  model(ctx: FilesPageContext): FilesPanePage | null {
    const file = this.file
    if (!file) return null
    const kind = this.kindOf(ctx.evidence)
    this.notes.bind({ graphId: file.graphId, graphIncarnation: ctx.graphIncarnation, artifactId: file.id, label: file.label, parentId: ctx.parentId,
      anyFolder: ctx.anyFolder, writable: ctx.writable } satisfies NotesTarget)
    const content: KindPageContent | null = kind?.page && !ctx.evidencePending ? kind.page.content({
      artifactId: file.id, fileName: file.label, filter: this.filterText, reading: ctx.reading.reading,
      readingStatus: ctx.reading.status, readingError: ctx.reading.error, evidence: ctx.evidence, rows: this.queryRows(kind, file), tree: ctx.tree,
      companions: ctx.companions.map(c => ({ key: c.key, label: c.label, role: c.role, roleLabel: c.roleLabel })),
    }) : null
    const head = content?.head ?? null
    const lines = head?.lines ?? this.genericLines(file)
    if (ctx.evidencePending) {
      return { key: file.key, name: file.label, caption: file.caption, title: file.label, chips: [], lines, note: 'Reading what we know about this file…', sections: [] }
    }
    const { sections: rules } = resolveInfoSections(kind?.page?.sections)
    const hidden = new Set(content?.hidden ?? [])
    const sections: FilesPageSection[] = []
    for (const rule of rules) {
      if (hidden.has(rule.id)) continue
      const open = this.isSectionOpen(rule)
      const standard = this.standardBody(rule, file, ctx)
      const body: FilesPageBody | null = standard !== undefined ? standard : content?.bodies[rule.id] ?? null
      const note = content?.notes?.[rule.id] ?? (rule.id === 'connections' && this.reads.wires?.length === 0 ? 'No connections.' : null)
      // A kind's section with nothing in it and nothing to say is not drawn (while its reading loads it says so).
      if (body === null && !note && standard === undefined && ctx.reading.status !== 'loading' && rule.face !== 'source') continue
      const notesModel = rule.face === 'notes' ? this.notes.model() : null
      sections.push({
        id: rule.id, title: rule.title, face: rule.face, open, body,
        ...(content?.counts?.[rule.id] ? { count: content.counts[rule.id] } : rule.id === 'connections' && this.reads.wires?.length ? { count: String(this.reads.wires.length) } : {}),
        ...(note ? { note } : {}),
        ...(notesModel?.openAction ? { verb: { label: 'Open as a document', action: notesModel.openAction } } : {}),
      })
    }
    return {
      key: file.key, name: file.label, caption: file.caption, title: head?.title ?? file.label, chips: head?.chips ?? [], lines,
      note: ctx.reading.status === 'error' && kind ? `What was read from this file could not be fetched: ${ctx.reading.error}` : null,
      sections,
    }
  }

  /** The kind's line under the name of a file no kind read: its type and size. */
  private genericLines(file: FilesPageFile): { text: string }[] {
    const d = this.reads.detail
    const size = d?.sizeBytes ?? file.sizeBytes
    return [{ text: file.caption ? `${file.caption} file` : 'File' }, ...(size !== null && size !== undefined ? [{ text: formatFileSize(size) }] : [])]
  }

  /** The standard sections' bodies; undefined for a section that is the kind's own. */
  private standardBody(rule: InfoSectionRule, file: FilesPageFile, ctx: FilesPageContext): FilesPageBody | null | undefined {
    switch (rule.id) {
      case 'source': return { face: 'source' }
      case 'notes': return { face: 'notes', notes: this.notes.model() }
      case 'about': return { face: 'facts', rows: this.aboutRows(file, ctx) }
      case 'connections': {
        if (this.reads.wires === null) return null
        const hidden = new Set(ctx.companions.map(c => c.id))
        const links: FilesPageLink[] = this.reads.wires.filter(w => !hidden.has(parseId(w.otherKey))).map(w => {
          const named = ctx.nameOf(parseId(w.otherKey))
          return { id: w.id, label: named?.label ?? w.otherName, tag: w.direction === 'out' ? `→ ${w.label}` : `← ${w.label}`, action: `goto:${named?.key ?? w.otherKey}` }
        })
        return links.length ? { face: 'links', links } : null
      }
      default: return rule.face === 'source' ? { face: 'source' } : undefined
    }
  }

  /** About this file: Show info's General and File facts, as the panel says them. */
  private aboutRows(file: FilesPageFile, ctx: FilesPageContext): FilesPageFact[] {
    const item: InfoItem = { key: file.key, kind: 'artifact', id: file.id, label: file.label, mimeType: file.mimeType, caption: file.caption, sizeBytes: file.sizeBytes }
    const model = buildInfoModel({ items: [item], ...ctx.info, detail: this.reads.detail, detailStatus: this.reads.detailStatus, wires: [], evidence: undefined,
      writable: ctx.writable })
    const rows = (model?.sections ?? []).filter(s => s.id === 'general' || s.id === 'file').flatMap(s => s.rows)
    return rows.map(r => ({ label: r.label, text: r.text, ...(r.title ? { title: r.title } : {}), ...(r.mono ? { mono: true } : {}),
      ...(r.action ? { action: r.action } : {}) }))
  }
}

function parseId(key: string): string { const at = key.indexOf(':'); return at >= 0 ? key.slice(at + 1) : key }


/** The wires at a file, both ways, as connections (the notes' own wire is the notes section's, not a connection). */
function wiresOf(read: Record<string, unknown>, file: FilesPageFile): InfoWire[] {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const out: InfoWire[] = []
  for (const row of Array.isArray(read.wires) ? read.wires : []) {
    const w = row as Record<string, unknown>
    const id = str(w.id), source = str(w.sourceDocumentId), target = str(w.targetDocumentId)
    if (!id || !source || !target || (str(w.targetGraphId) ?? file.graphId) !== file.graphId) continue
    const predicate = str(w.predicate) ?? 'relatedTo'
    if (predicate === NOTES_PREDICATE && source === `notes-${file.id}`) continue
    const label = str(w.predicateLabel) ?? predicate.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
    const out_ = source === file.id
    const other = out_ ? target : source
    out.push({ id, direction: out_ ? 'out' : 'in', label, otherKey: `artifact:${other}`, otherName: other })
  }
  return out
}
