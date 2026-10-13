/**
 * Opening a file from the Files pane. Opening never downloads (Vera, 2026-10-08): every file opens a page.
 *
 * - A PDF in the original-page viewer (rasterised page by page; nothing extracted), an image as a picture.
 * - What Hoja can render, rendered read-only through the editor kernel (`files-viewers/`): plain text, Markdown, code,
 *   JSON, CSV/TSV and spreadsheets (the `dataTable` node), HTML and Word documents (through the reader schema).
 * - Audio, video and SVG drawn by the browser from a blob: URL (an SVG only ever as an <img>).
 * - Anything else: the file's page (what it is, its size, when it changed) and an explicit Download.
 *
 * The bytes are fetched with the shell's bearer (a bare `<img src>` or `<a href>` would not carry it) and handed on as an
 * object URL, an array buffer or text; this controller owns those URLs (and a data table's side-store entry) and lets go
 * of them when the file closes or another opens. Which viewer a kind gets is the registry's (`files-viewers/registry.ts`).
 */
import { FilesContractError, type FilesClient } from './files-contract.js'
import { formatFileSize, typeCaption, type FilesTypeFacts } from './files-policy.js'
import { saveBlob } from './document-transfer.js'
import { readsText, viewerKindOf, type FileViewerKind } from './files-viewers/registry.js'
import { capBytes, decodeText, looksBinary } from './files-viewers/text.js'

/** What `<hoja-reader>` is given (see packages/hoja/src/hoja-reader.ts). */
export interface FilesReaderView {
  readonly variant: 'prose' | 'code' | 'table'
  readonly doc?: unknown
  readonly html?: string | null
  readonly lineNumbers?: boolean
  readonly highlight?: unknown
}

type Status = 'loading' | 'ready' | 'error'

export type FilesPreviewState =
  | { readonly kind: 'none' }
  | { readonly kind: 'pdf'; readonly artifactId: string; readonly name: string; readonly status: Status; readonly error: string
      /** The bytes, once downloaded: the reader (pdf.js's viewer) opens them. */
      readonly data: Uint8Array | null
      /** Download progress: bytes so far, and the total (0 when the cell states none). */
      readonly loaded: number; readonly total: number
      /** What the reader reports as the person reads (it owns the page). */
      readonly pageCount: number; readonly pageNumber: number }
  | { readonly kind: 'image'; readonly artifactId: string; readonly name: string; readonly status: Status; readonly error: string
      readonly url: string | null }
  | { readonly kind: 'reader'; readonly artifactId: string; readonly name: string; readonly status: Status; readonly error: string
      /** The kind, said: 'Markdown', 'TypeScript'. */
      readonly label: string
      /** Which viewer of the registry rendered it ('markdown', 'code', 'csv', …). */
      readonly viewer: string
      readonly view: FilesReaderView | null
      readonly truncated: { readonly shown: string; readonly total: string } | null
      readonly source: boolean | null
      readonly note: string | null }
  | { readonly kind: 'media'; readonly artifactId: string; readonly name: string; readonly status: Status; readonly error: string
      readonly media: 'audio' | 'video' | 'svg'; readonly url: string | null; readonly mimeType: string }
  | { readonly kind: 'file'; readonly artifactId: string; readonly name: string; readonly status: Status; readonly error: string
      readonly typeLabel: string; readonly caption: string; readonly sizeBytes: number | null; readonly modified: string | null }

export interface FilesPreviewFile extends FilesTypeFacts {
  readonly id: string
  readonly label: string
}

type Viewers = typeof import('./files-viewers/render.js')

export interface FilesPreviewDeps {
  readonly client: FilesClient
  readonly onChange: () => void
  readonly url?: { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void }
  readonly save?: (blob: Blob, filename: string) => void | Promise<void>
  /** Text over this many bytes shows its start first (default 2 MB). */
  readonly textCapBytes?: number
  /** Let go of a data table's side-store entry (the reader module's `releaseDataTable`). */
  readonly releaseTable?: (ref: string) => void
}

const GONE = 'This file is no longer available.'
const MEDIA_TYPES: Readonly<Record<string, string>> = { svg: 'image/svg+xml' }

function failure(error: unknown): string {
  if (error instanceof FilesContractError && error.status === 404) return GONE
  return error instanceof Error ? error.message : String(error)
}

function when(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** The file page's kind: the registry's label, else "ZIP file" from the extension, else "File". */
function pageLabel(kind: FileViewerKind, file: FilesPreviewFile): string {
  if (kind.id !== 'unknown') return kind.label
  const caption = typeCaption(file)
  return caption ? `${caption} file` : 'File'
}

interface Loaded {
  readonly graphId: string
  readonly file: FilesPreviewFile
  readonly kind: FileViewerKind
  readonly name: string
  readonly text: string
  readonly shownBytes: number
  readonly totalBytes: number
  readonly truncated: boolean
}

export class FilesPreviewController {
  private state: FilesPreviewState = { kind: 'none' }
  private urls = new Set<string>()
  private abort: AbortController | null = null
  private sequence = 0
  private tables = new Set<string>()
  private loaded: Loaded | null = null
  private viewers: Promise<Viewers> | null = null

  constructor(private readonly deps: FilesPreviewDeps) {}

  private get url() { return this.deps.url ?? { createObjectURL: (b: Blob) => URL.createObjectURL(b), revokeObjectURL: (u: string) => URL.revokeObjectURL(u) } }

  snapshot(): FilesPreviewState { return this.state }

  private set(next: FilesPreviewState): void {
    this.state = next
    this.deps.onChange()
  }

  private objectUrl(blob: Blob): string {
    const url = this.url.createObjectURL(blob)
    this.urls.add(url)
    return url
  }

  /** The viewers module, loaded on first use (a lazy chunk: Hoja's reader posture, Markdown, the CSV parser). */
  private loadViewers(): Promise<Viewers> {
    this.viewers ??= import('./files-viewers/render.js')
    return this.viewers
  }

  private releaseTables(): void {
    for (const ref of this.tables) {
      if (this.deps.releaseTable) this.deps.releaseTable(ref)
      // A table exists only once the viewers module has loaded.
      else void this.viewers?.then(v => v.releaseTableRef(ref), () => undefined)
    }
    this.tables.clear()
  }

  private release(): void {
    this.abort?.abort()
    this.abort = null
    for (const url of this.urls) this.url.revokeObjectURL(url)
    this.urls.clear()
    this.releaseTables()
    this.loaded = null
  }

  /** Open `file` on its page. Nothing is ever saved to the computer here; that is `download`'s, on the person's word. */
  async open(graphId: string, file: FilesPreviewFile): Promise<void> {
    this.release()
    const sequence = ++this.sequence
    const abort = new AbortController()
    this.abort = abort
    const kind = viewerKindOf(file)
    const name = file.originalFilename?.trim() || file.label
    const live = () => sequence === this.sequence && !abort.signal.aborted
    switch (kind.viewer) {
      case 'pdf': return this.openPdf(graphId, file, name, abort, live)
      case 'image': return this.openImage(graphId, file, name, live, abort.signal)
      case 'svg': case 'audio': case 'video': return this.openMedia(graphId, file, kind, name, live, abort.signal)
      case 'file': return kind.id === 'unknown' ? this.openUnknown(graphId, file, kind, name, live, abort.signal) : this.openPage(graphId, file, kind, name, live, abort.signal, null)
      default: return this.openReader(graphId, file, kind, name, live, abort.signal)
    }
  }

  private async openPdf(graphId: string, file: FilesPreviewFile, name: string, abort: AbortController, live: () => boolean): Promise<void> {
    const base = { kind: 'pdf', artifactId: file.id, name, pageCount: 0, pageNumber: 1 } as const
    // The reader (pdf.js's viewer layer) is a lazy chunk, loaded while the bytes come down.
    void import('./pdf-reader/pdf-reader.js')
    this.set({ ...base, status: 'loading', error: '', data: null, loaded: 0, total: 0 })
    try {
      let last = 0
      const data = await this.deps.client.downloadBytes(graphId, file.id, { inline: true, signal: abort.signal, onProgress: (loaded, total) => {
        // Progress is shown, not announced: at most a few repaints a second.
        const now = Date.now()
        if (!live() || now - last < 120) return
        last = now
        this.set({ ...base, status: 'loading', error: '', data: null, loaded, total })
      } })
      if (!live()) return
      this.set({ ...base, status: 'ready', error: '', data, loaded: data.length, total: data.length })
    } catch (error) {
      if (live()) this.set({ ...base, status: 'error', error: failure(error), data: null, loaded: 0, total: 0 })
    }
  }

  private async openImage(graphId: string, file: FilesPreviewFile, name: string, live: () => boolean, signal: AbortSignal): Promise<void> {
    this.set({ kind: 'image', artifactId: file.id, name, status: 'loading', error: '', url: null })
    try {
      const blob = await this.deps.client.download(graphId, file.id, { inline: true, signal })
      if (!live()) return
      this.set({ kind: 'image', artifactId: file.id, name, status: 'ready', error: '', url: this.objectUrl(blob) })
    } catch (error) {
      if (live()) this.set({ kind: 'image', artifactId: file.id, name, status: 'error', error: failure(error), url: null })
    }
  }

  private async openMedia(graphId: string, file: FilesPreviewFile, kind: FileViewerKind, name: string, live: () => boolean, signal: AbortSignal): Promise<void> {
    const media = kind.viewer as 'svg' | 'audio' | 'video'
    const base = { kind: 'media', artifactId: file.id, name, media } as const
    this.set({ ...base, status: 'loading', error: '', url: null, mimeType: '' })
    try {
      let blob = await this.deps.client.download(graphId, file.id, { signal })
      if (!live()) return
      // An SVG stored as octet-stream would not draw in an <img>: give its blob the type its kind says.
      const wanted = MEDIA_TYPES[kind.id]
      if (wanted && blob.type !== wanted) blob = new Blob([await blob.arrayBuffer()], { type: wanted })
      if (!live()) return
      this.set({ ...base, status: 'ready', error: '', url: this.objectUrl(blob), mimeType: blob.type })
    } catch (error) {
      if (live()) this.set({ ...base, status: 'error', error: failure(error), url: null, mimeType: '' })
    }
  }

  /** The file's page: what it is, its size and when it changed (from the listing, not from its bytes). */
  private async openPage(graphId: string, file: FilesPreviewFile, kind: FileViewerKind, name: string, live: () => boolean, signal: AbortSignal,
    known: { readonly sizeBytes: number } | null): Promise<void> {
    const base = { kind: 'file', artifactId: file.id, name, typeLabel: pageLabel(kind, file), caption: typeCaption(file) } as const
    this.set({ ...base, status: 'loading', error: '', sizeBytes: known?.sizeBytes ?? null, modified: null })
    let info: Awaited<ReturnType<FilesClient['artifactInfo']>> = null
    try { info = await this.deps.client.artifactInfo(graphId, file.id, signal) } catch { info = null }
    if (!live()) return
    this.set({ ...base, status: 'ready', error: '', sizeBytes: known?.sizeBytes ?? info?.sizeBytes ?? null, modified: when(info?.updatedAt ?? null) })
  }

  /** A file nothing recognizes: if its bytes are text, the text viewer; otherwise its page. */
  private async openUnknown(graphId: string, file: FilesPreviewFile, kind: FileViewerKind, name: string, live: () => boolean, signal: AbortSignal): Promise<void> {
    this.set({ kind: 'file', artifactId: file.id, name, status: 'loading', error: '', typeLabel: pageLabel(kind, file), caption: typeCaption(file), sizeBytes: null, modified: null })
    try {
      const bytes = new Uint8Array(await (await this.deps.client.download(graphId, file.id, { signal })).arrayBuffer())
      if (!live()) return
      if (bytes.length > 0 && !looksBinary(bytes)) {
        const text: FileViewerKind = { id: 'text', label: 'Plain text', viewer: 'text' }
        return this.showText(graphId, file, text, name, bytes)
      }
      return this.openPage(graphId, file, kind, name, live, signal, { sizeBytes: bytes.length })
    } catch (error) {
      if (live()) this.set({ kind: 'file', artifactId: file.id, name, status: 'error', error: failure(error), typeLabel: pageLabel(kind, file), caption: typeCaption(file), sizeBytes: null, modified: null })
    }
  }

  private readerBase(file: FilesPreviewFile, kind: FileViewerKind, name: string) {
    return { kind: 'reader', artifactId: file.id, name, label: kind.label, viewer: kind.viewer } as const
  }

  private async openReader(graphId: string, file: FilesPreviewFile, kind: FileViewerKind, name: string, live: () => boolean, signal: AbortSignal): Promise<void> {
    const base = this.readerBase(file, kind, name)
    this.set({ ...base, status: 'loading', error: '', view: null, truncated: null, source: kind.viewer === 'html' ? false : null, note: null })
    try {
      const blob = await this.deps.client.download(graphId, file.id, { signal })
      if (!live()) return
      const bytes = new Uint8Array(await blob.arrayBuffer())
      if (!live()) return
      if (readsText(kind.viewer)) {
        // A binary misnamed .txt (or .csv, .json…) is not text: its page, with Download.
        if (looksBinary(bytes)) return this.openPage(graphId, file, { ...kind, id: 'unknown' }, name, live, signal, { sizeBytes: bytes.length })
        return this.showText(graphId, file, kind, name, bytes)
      }
      const viewers = await this.loadViewers()
      if (!live()) return
      const build = kind.viewer === 'docx' ? await viewers.buildDocxView(bytes) : await viewers.buildSheetView(bytes, name)
      if (!live()) { if (build.dataRef) (this.deps.releaseTable ?? viewers.releaseTableRef)(build.dataRef); return }
      if (build.dataRef) this.tables.add(build.dataRef)
      this.set({ ...base, status: 'ready', error: '', view: build.view, truncated: null, source: null, note: build.note })
    } catch (error) {
      if (live()) this.set({ ...base, status: 'error', error: readFailure(kind, error), view: null, truncated: null, source: null, note: null })
    }
  }

  /** Decode, cap and render a text kind. */
  private async showText(graphId: string, file: FilesPreviewFile, kind: FileViewerKind, name: string, bytes: Uint8Array): Promise<void> {
    const base = this.readerBase(file, kind, name)
    const source = kind.viewer === 'html' ? false : null
    // A table is never capped: its grid draws only the rows in sight.
    const capped = kind.viewer === 'csv' ? { bytes, truncated: false } : capBytes(bytes, this.deps.textCapBytes)
    const { text } = decodeText(capped.bytes)
    this.loaded = { graphId, file, kind, name, text, shownBytes: capped.bytes.length, totalBytes: bytes.length, truncated: capped.truncated }
    this.loadedBytes = capped.truncated ? bytes : null
    await this.renderText(base, source)
  }

  /** The full bytes of a truncated text, kept for Show all. */
  private loadedBytes: Uint8Array | null = null

  private async renderText(base: ReturnType<FilesPreviewController['readerBase']>, source: boolean | null): Promise<void> {
    const loaded = this.loaded
    if (!loaded) return
    const sequence = this.sequence
    const signal = this.abort?.signal
    const truncated = loaded.truncated ? { shown: formatFileSize(loaded.shownBytes), total: formatFileSize(loaded.totalBytes) } : null
    this.set({ ...base, status: 'loading', error: '', view: null, truncated, source, note: null })
    try {
      const viewers = await this.loadViewers()
      if (sequence !== this.sequence || signal?.aborted) return
      const build = await viewers.buildTextView(loaded.kind, loaded.text, { name: loaded.name, signal, source: source === true, truncated: loaded.truncated })
      if (sequence !== this.sequence || signal?.aborted) { if (build.dataRef) (this.deps.releaseTable ?? viewers.releaseTableRef)(build.dataRef); return }
      this.releaseTables()
      if (build.dataRef) this.tables.add(build.dataRef)
      this.set({ ...base, status: 'ready', error: '', view: build.view, truncated, source, note: build.note })
    } catch (error) {
      if (sequence === this.sequence) this.set({ ...base, status: 'error', error: readFailure(loaded.kind, error), view: null, truncated, source, note: null })
    }
  }

  /** HTML's Source switch: the page as Hoja renders it, or its source as code. */
  async setSource(on: boolean): Promise<void> {
    const state = this.state
    const loaded = this.loaded
    if (state.kind !== 'reader' || state.source === null || !loaded || state.source === on) return
    await this.renderText(this.readerBase(loaded.file, loaded.kind, loaded.name), on)
  }

  /** The whole of a long text, not just its start. */
  async showAll(): Promise<void> {
    const loaded = this.loaded
    const bytes = this.loadedBytes
    if (!loaded || !loaded.truncated || !bytes) return
    const state = this.state
    const source = state.kind === 'reader' ? state.source : null
    this.loaded = { ...loaded, text: decodeText(bytes).text, shownBytes: bytes.length, truncated: false }
    this.loadedBytes = null
    await this.renderText(this.readerBase(loaded.file, loaded.kind, loaded.name), source)
  }

  /** The reader says which page it is on (it owns the page; this is only so the shell can say it). */
  reportPage(pageNumber: number, pageCount: number): void {
    const state = this.state
    if (state.kind !== 'pdf' || (state.pageNumber === pageNumber && state.pageCount === pageCount)) return
    // Not a repaint: nothing in the pane draws these today, and the reader is already showing the page.
    this.state = { ...state, pageNumber, pageCount }
  }

  /** Save the open file's bytes (the viewer's Download, on the person's word). */
  async download(graphId: string): Promise<void> {
    const state = this.state
    if (state.kind === 'none') return
    try {
      await this.save(graphId, { id: state.artifactId, name: state.name })
    } catch (error) {
      if (this.state === state) this.set({ ...state, status: 'error', error: failure(error) } as FilesPreviewState)
    }
  }

  /** Save a file's bytes under its own name, without opening it (the menu's Download). */
  async save(graphId: string, file: { readonly id: string; readonly name: string }): Promise<void> {
    const blob = await this.deps.client.download(graphId, file.id)
    await (this.deps.save ?? saveBlob)(blob, file.name)
  }

  close(): void {
    this.sequence += 1
    this.release()
    if (this.state.kind !== 'none') this.set({ kind: 'none' })
  }
}

function readFailure(kind: FileViewerKind, error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Cancelled.'
  const said = failure(error)
  return said === GONE ? said : `This ${kind.label} could not be shown: ${said}`
}
