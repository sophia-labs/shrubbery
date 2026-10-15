/**
 * Your notes on a file: a Hoja editor on one native document per file, `notes-<file id>`, wired to the file (`annotates`). The document
 * is made at the first keystroke, never before (an untouched file has no notes document), and nothing generated ever writes into it:
 * only the person's keystrokes reach `write_document`. (plans/2026-10-08-datasheets-in-sophia.md §3: "Notes is the person's own margin…
 * a notes document, created at the first keystroke and wired to the PDF".)
 *
 * The cell's `write_document` is whole-document (TipTap JSON), fenced by the revision the edits build on, and it re-files the document
 * at the root (the Hoja app's CellStore found this): each save puts the notes back in the file's folder. A revision conflict (the same
 * notes open in two places) takes the newer revision and writes again: they are one person's notes, and the latest keystrokes win.
 */
import type { FilesPageNotes } from '@shrubbery/runtime'
import { fileDocumentTitle } from './document-title.js'
import { NOTES_PREFIX } from './files-kinds/registry.js'

export const NOTES_PREDICATE = 'annotates'

export interface FilesNotesDeps {
  readonly tool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
  readonly onChange: () => void
  /** Saves wait this long after the last keystroke (default 900 ms). */
  readonly debounceMs?: number
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

export interface NotesTarget {
  readonly graphId: string
  readonly graphIncarnation: string
  readonly artifactId: string
  /** The file's name: the notes' title says whose they are. */
  readonly label: string
  /** The file's folder (null: the top); where the notes live, when the cell lets a folder hold documents. */
  readonly parentId: string | null
  readonly anyFolder: boolean
  readonly writable: boolean
}

export function notesDocumentId(artifactId: string): string { return `${NOTES_PREFIX}${artifactId}` }

type Status = FilesPageNotes['status']

const record = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)
const revisionOf = (v: Record<string, unknown>): number | null => {
  for (const k of ['revision', 'documentRevision', 'newRevision']) { const n = v[k]; if (typeof n === 'number' && Number.isFinite(n)) return n }
  return null
}

export class FilesNotes {
  private target: NotesTarget | null = null
  private key = ''
  private generation = 0
  private status: Status = 'loading'
  private document: unknown | null = null
  private exists = false
  private revision: number | null = null
  private message = ''
  private pending: { json: unknown; isEmpty: boolean } | null = null
  private timer: unknown = null
  private saving: Promise<void> | null = null

  constructor(private readonly deps: FilesNotesDeps) {}

  /** The file whose notes are shown; reads them once per file. */
  bind(target: NotesTarget | null): void {
    const key = target ? `${target.graphId}|${target.artifactId}` : ''
    this.target = target
    if (key === this.key) return
    void this.flush()
    this.key = key
    this.generation++
    this.document = null; this.exists = false; this.revision = null; this.message = ''; this.pending = null
    this.status = target ? 'loading' : 'empty'
    if (target) void this.read(this.generation)
  }

  /** The notes document's id, once it exists. */
  documentId(): string | null { return this.exists && this.target ? notesDocumentId(this.target.artifactId) : null }

  model(): FilesPageNotes {
    const t = this.target
    return {
      status: this.status, valueKey: `${this.key}|${this.generation}`, document: this.document, readOnly: !t?.writable,
      ...(this.message ? { message: this.message } : {}),
      ...(this.exists && t ? { openAction: `open:document:${notesDocumentId(t.artifactId)}` } : {}),
    }
  }

  private async read(generation: number): Promise<void> {
    const t = this.target
    if (!t) return
    try {
      const value = await this.deps.tool('read_document', { graphId: t.graphId, documentId: notesDocumentId(t.artifactId), format: 'json', maxChars: 262144 })
      if (generation !== this.generation) return
      if (typeof value.content !== 'string') throw new Error('no notes document')
      let json: unknown = null
      try { json = record(JSON.parse(value.content))?.tiptapJson ?? null } catch { json = null }
      this.exists = true
      this.revision = revisionOf(value)
      this.document = record(json) ? json : null
      this.status = 'ready'
    } catch {
      // No notes yet (the document does not exist): an empty editor that makes them at the first keystroke.
      if (generation !== this.generation) return
      this.status = 'empty'
    }
    this.deps.onChange()
  }

  /** A keystroke: saved shortly after the last one. An empty editor on a file with no notes writes nothing. */
  change(detail: { readonly json: unknown; readonly isEmpty: boolean }): void {
    const t = this.target
    if (!t?.writable || this.status === 'loading') return
    if (!this.exists && detail.isEmpty) return
    this.pending = { json: detail.json, isEmpty: detail.isEmpty }
    if (this.timer !== null) (this.deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer)
    this.timer = (this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms)))(() => { this.timer = null; void this.flush() }, this.deps.debounceMs ?? 900)
  }

  /** Save what is waiting now (leaving the page, another file). */
  async flush(): Promise<void> {
    if (this.timer !== null) { (this.deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer); this.timer = null }
    while (this.saving) await this.saving
    const job = this.pending
    const t = this.target
    if (!job || !t) return
    this.pending = null
    this.saving = this.save(t, job.json, this.generation).finally(() => { this.saving = null })
    await this.saving
  }

  private async save(t: NotesTarget, json: unknown, generation: number): Promise<void> {
    const documentId = notesDocumentId(t.artifactId)
    // The cell makes no document with a title over 96 characters: a long file name is cut in its middle, its extension kept.
    const title = fileDocumentTitle('Notes on ', t.label)
    const parentId = t.anyFolder ? t.parentId : null
    const live = () => generation === this.generation
    this.status = 'saving'; this.message = 'Saving…'
    this.deps.onChange()
    try {
      if (!this.exists) {
        // `exists` is a guess (a failed read, a lost reply): keep notes that are already there.
        await this.deps.tool('create_document', { graphId: t.graphId, documentId, title, parentId, ifExists: 'keep' })
        this.exists = true
        this.revision = 0
        // The wire says whose notes these are; the id says it too, so a wire that could not be made costs nothing.
        await this.deps.tool('create_wires', { graphId: t.graphId, ...(t.graphIncarnation ? { graphIncarnation: t.graphIncarnation } : {}), wires: [{
          wireId: `wire-${documentId}`, sourceDocumentId: documentId, targetDocumentId: t.artifactId, targetGraphId: t.graphId, predicate: NOTES_PREDICATE, bidirectional: false,
        }] }).catch(() => undefined)
      }
      const write = (expected: number | null) => this.deps.tool('write_document', { graphId: t.graphId, documentId, title, tiptapJson: json, awaitDurable: true,
        ...(typeof expected === 'number' ? { expectedRevision: expected } : {}) })
      let value: Record<string, unknown>
      try { value = await write(this.revision) } catch (error) {
        if (!/revision/i.test(error instanceof Error ? error.message : String(error))) throw error
        const now = await this.deps.tool('read_document', { graphId: t.graphId, documentId, format: 'markdown', offset: 0, maxChars: 1 })
        value = await write(revisionOf(now))
      }
      const revision = revisionOf(value)
      if (revision !== null) this.revision = revision
      // write_document files what it writes at the top: put the notes back beside their file.
      if (parentId) await this.deps.tool('move_documents', { graphId: t.graphId, documentIds: [documentId], parentId }).catch(() => undefined)
      if (!live()) return
      // The editor keeps its own document while it is open: handing it back what it just wrote would move the caret.
      this.status = 'saved'; this.message = 'Saved'
    } catch (error) {
      if (!live()) return
      this.status = 'error'
      this.message = `Couldn’t save: ${error instanceof Error ? error.message : String(error)}`
      // Kept, to be tried again at the next keystroke.
      this.pending = this.pending ?? { json, isEmpty: false }
    }
    this.deps.onChange()
  }
}
