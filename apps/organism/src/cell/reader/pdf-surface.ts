/**
 * The Reader's PDF surface: pdf.js's own viewer layer (PDFViewer, links, find) in a container the Reader owns.
 * Pages render lazily with a selectable text layer; annotations are found in each page's text and handed back to the
 * Reader as DOM Ranges over that text layer, whenever pdf.js (re)builds it.
 */
import { loadPdfJs } from '../pdfjs-runtime.js'
import { readMemory, writeMemory } from '../pdf-reader/pdf-reader-memory.js'
import { locateQuoteAnnotations, quoteSearchText, type QuoteChapterText } from '../source-quote-annotations.js'
import { annotationRange, quoteTextIndex, type ReaderAnnotation } from './reader-model.js'
import { withOcrText, type OcrTextLayer } from './ocr-text-layer.js'

// biome-ignore lint/suspicious/noExplicitAny: pdf.js's viewer layer is used through the narrow surface below
type Loose = any

export type PdfZoom = 'page-width' | 'page-fit' | 'auto' | number

export interface PdfOutlineItem { readonly title: string; readonly dest: unknown; readonly items: readonly PdfOutlineItem[] }

export interface PdfSurfaceState {
  readonly pageCount: number
  readonly page: number
  readonly pageLabel: string | null
  readonly scale: number
  readonly zoom: PdfZoom
  readonly hasText: boolean
  readonly outline: readonly PdfOutlineItem[]
  readonly find: { readonly current: number; readonly total: number; readonly none: boolean } | null
  readonly ready: boolean
  /** The PDF's own title and author, from its metadata, when it names them. */
  readonly docTitle: string
  readonly docAuthor: string
}

export interface PdfSurfaceHost {
  /** Something the Reader shows changed (page, zoom, find count, readiness). */
  changed(state: PdfSurfaceState): void
  /** A page's text layer was (re)built: annotation ranges on it are new objects. */
  textLayerRendered(page: number): void
  failed(message: string): void
}

const MIN_SCALE = 0.25
const MAX_SCALE = 5

let viewerModule: Promise<Loose> | null = null
async function loadViewer(): Promise<{ pdfjs: Loose; viewer: Loose }> {
  const pdfjs = await loadPdfJs()
  ;(globalThis as Loose).pdfjsLib = pdfjs
  // The viewer layer reads globalThis.pdfjsLib when it loads, so it loads after the library is in place.
  viewerModule ??= import('pdfjs-dist/legacy/web/pdf_viewer.mjs')
  return { pdfjs, viewer: await viewerModule }
}

export class PdfSurface {
  private pdf: Loose = null
  private pv: Loose = null
  private bus: Loose = null
  private links: Loose = null
  private task: Loose = null
  private generation = 0
  private resize: ResizeObserver | null = null
  private rememberTimer = 0
  private labels: readonly string[] | null = null
  private pageTexts: Promise<QuoteChapterText[]> | null = null
  private state: PdfSurfaceState = { pageCount: 0, page: 1, pageLabel: null, scale: 1, zoom: 'auto', hasText: true, outline: [], find: null, ready: false, docTitle: '', docAuthor: '' }

  constructor(private readonly host: PdfSurfaceHost, private readonly fileKey: string) {}

  get current(): PdfSurfaceState { return this.state }

  private set(patch: Partial<PdfSurfaceState>): void {
    this.state = { ...this.state, ...patch }
    this.host.changed(this.state)
  }

  /** Open a PDF; a scan's OCR words (`ocr`), when there are some, are its pages' text. */
  async open(data: Uint8Array, container: HTMLElement, viewerEl: HTMLElement, ocr: OcrTextLayer | null = null): Promise<void> {
    this.close()
    const generation = this.generation
    try {
      const { pdfjs, viewer } = await loadViewer()
      if (generation !== this.generation) return
      const bus = new viewer.EventBus()
      const links = new viewer.PDFLinkService({ eventBus: bus, externalLinkTarget: 2, externalLinkRel: 'noopener noreferrer nofollow' })
      const finder = new viewer.PDFFindController({ linkService: links, eventBus: bus, updateMatchesCountOnProgress: true })
      const pv = new viewer.PDFViewer({ container, viewer: viewerEl, eventBus: bus, linkService: links, findController: finder,
        textLayerMode: 1, removePageBorders: true, maxCanvasPixels: 16_777_216 })
      links.setViewer(pv)
      this.bus = bus; this.links = links; this.pv = pv
      this.wire(bus, pv, generation)
      const task = pdfjs.getDocument({ data: data.slice(), disableFontFace: true, useSystemFonts: true, useWorkerFetch: false, useWasm: false,
        isOffscreenCanvasSupported: false, isImageDecoderSupported: false, stopAtErrors: false })
      this.task = task
      const pdf = withOcrText(await task.promise, ocr)
      if (generation !== this.generation) { void pdf.destroy(); return }
      this.pdf = pdf
      pv.setDocument(pdf)
      links.setDocument(pdf, null)
      this.set({ pageCount: pdf.numPages })
      void this.readOutline(pdf, generation)
      void this.readLabels(pdf, generation)
      void this.readMetadata(pdf, generation)
      void this.checkText(pdf, generation)
      this.observe(container)
    } catch (error) {
      if (generation !== this.generation) return
      const name = (error as { name?: string })?.name
      this.host.failed(name === 'PasswordException' ? 'This PDF is password protected, and the Reader cannot ask for the password yet.'
        : name === 'InvalidPDFException' ? 'This file is not a PDF the Reader can open.'
        : `The PDF could not be opened: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  close(): void {
    this.generation++
    this.resize?.disconnect()
    this.resize = null
    window.clearTimeout(this.rememberTimer)
    try { this.task?.destroy() } catch { /* already gone */ }
    this.task = null
    try { this.pv?.cleanup?.(); this.pv?.setDocument?.(null) } catch { /* torn down */ }
    this.pv = null
    try { void this.pdf?.destroy?.() } catch { /* torn down */ }
    this.pdf = null
    this.labels = null
    this.pageTexts = null
    this.state = { pageCount: 0, page: 1, pageLabel: null, scale: 1, zoom: 'auto', hasText: true, outline: [], find: null, ready: false, docTitle: '', docAuthor: '' }
  }

  private wire(bus: Loose, pv: Loose, generation: number): void {
    const live = () => generation === this.generation
    bus.on('pagesinit', () => {
      if (!live()) return
      const memory = readMemory(this.fileKey)
      const zoom: PdfZoom = memory?.zoom === 'page-width' || memory?.zoom === 'page-fit' ? memory.zoom
        : typeof memory?.zoom === 'number' ? memory.zoom : 'auto'
      pv.currentScaleValue = typeof zoom === 'number' ? String(zoom) : zoom
      if (memory && memory.page > 1) pv.currentPageNumber = Math.min(memory.page, pv.pagesCount)
      this.set({ ready: true, zoom, scale: pv.currentScale, page: pv.currentPageNumber, pageLabel: this.labelOf(pv.currentPageNumber) })
    })
    bus.on('pagechanging', (e: { pageNumber: number }) => {
      if (!live()) return
      this.set({ page: e.pageNumber, pageLabel: this.labelOf(e.pageNumber) })
      this.remember()
    })
    bus.on('scalechanging', (e: { scale: number; presetValue?: string }) => {
      if (!live()) return
      const zoom: PdfZoom = e.presetValue === 'page-width' || e.presetValue === 'page-fit' || e.presetValue === 'auto'
        ? e.presetValue : Math.round(e.scale * 100) / 100
      this.set({ scale: e.scale, zoom })
      this.remember()
    })
    bus.on('textlayerrendered', (e: { pageNumber: number }) => { if (live()) this.host.textLayerRendered(e.pageNumber) })
    bus.on('updatefindmatchescount', (e: { matchesCount: { current: number; total: number } }) => {
      if (live()) this.set({ find: { current: e.matchesCount.current, total: e.matchesCount.total, none: false } })
    })
    bus.on('updatefindcontrolstate', (e: { state: number; matchesCount: { current: number; total: number } }) => {
      if (live()) this.set({ find: { current: e.matchesCount?.current ?? 0, total: e.matchesCount?.total ?? 0, none: e.state === 1 } })
    })
  }

  private labelOf(page: number): string | null {
    const label = this.labels?.[page - 1]
    return label && label !== String(page) ? label : null
  }

  private observe(container: HTMLElement): void {
    let last = container.clientWidth
    this.resize = new ResizeObserver(() => {
      if (!this.pv || container.clientWidth === last) return
      last = container.clientWidth
      // A preset (fit width, fit page, automatic) follows the box; a fixed scale stays.
      if (typeof this.state.zoom !== 'number') this.pv.currentScaleValue = this.state.zoom
      else this.pv.update?.()
    })
    this.resize.observe(container)
    container.addEventListener('wheel', this.onWheel, { passive: false })
  }

  private readonly onWheel = (e: WheelEvent): void => {
    if (!(e.ctrlKey || e.metaKey) || !this.pv) return
    e.preventDefault()
    this.zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0035)))
  }

  private async readOutline(pdf: Loose, generation: number): Promise<void> {
    try {
      const raw = (await pdf.getOutline()) as { title: string; dest: unknown; items?: unknown[] }[] | null
      if (generation !== this.generation || !raw?.length) return
      const map = (items: typeof raw): PdfOutlineItem[] => items.map(i => ({ title: String(i.title ?? '').trim(), dest: i.dest, items: map((i.items ?? []) as typeof raw) }))
      this.set({ outline: map(raw) })
    } catch { /* a PDF without a readable outline has none */ }
  }

  private async readLabels(pdf: Loose, generation: number): Promise<void> {
    try {
      const labels = (await pdf.getPageLabels()) as string[] | null
      if (generation !== this.generation || !labels?.length) return
      this.labels = labels
      this.set({ pageLabel: this.labelOf(this.state.page) })
    } catch { /* no labels: page numbers are the labels */ }
  }

  private async readMetadata(pdf: Loose, generation: number): Promise<void> {
    try {
      const info = ((await pdf.getMetadata())?.info ?? {}) as { Title?: unknown; Author?: unknown }
      const clean = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
      const title = clean(info.Title)
      // Tools stamp file names and placeholders into Title; only a title that reads like one is shown.
      const usable = title && !/\.(pdf|docx?|tex|dvi)$/i.test(title) && !/^(untitled|microsoft word|title)\b/i.test(title)
      if (generation === this.generation) this.set({ docTitle: usable ? title : '', docAuthor: clean(info.Author).slice(0, 160) })
    } catch { /* no metadata */ }
  }

  /** A scan has pages and no text: said, so search, selection and highlighting are not a mystery. */
  private async checkText(pdf: Loose, generation: number): Promise<void> {
    try {
      let any = false
      for (let n = 1; n <= Math.min(4, pdf.numPages) && !any; n++) {
        const content = await (await pdf.getPage(n)).getTextContent()
        any = content.items.some((i: { str?: string }) => (i.str ?? '').trim() !== '')
      }
      if (generation === this.generation) this.set({ hasText: any })
    } catch { /* unknown stays "has text" */ }
  }

  private remember(): void {
    window.clearTimeout(this.rememberTimer)
    this.rememberTimer = window.setTimeout(() => {
      if (this.pv) writeMemory(this.fileKey, { page: this.pv.currentPageNumber, zoom: typeof this.state.zoom === 'number' ? this.state.zoom : this.state.zoom === 'page-fit' ? 'page-fit' : 'page-width' })
    }, 300)
  }

  // --- navigation and zoom ------------------------------------------------------------------------------------------------

  goToPage(n: number): void {
    if (!this.pv || !Number.isFinite(n)) return
    this.pv.currentPageNumber = Math.max(1, Math.min(this.state.pageCount || 1, Math.floor(n)))
  }

  /** A page label as printed ("xii", "23"), else a page number. */
  goToLabel(value: string): void {
    const trimmed = value.trim()
    const index = this.labels?.findIndex(label => label.toLowerCase() === trimmed.toLowerCase()) ?? -1
    if (index >= 0) this.goToPage(index + 1)
    else this.goToPage(Number(trimmed))
  }

  goToDestination(dest: unknown): void { if (dest) void this.links?.goToDestination(dest) }

  setZoom(value: PdfZoom): void {
    if (!this.pv) return
    this.pv.currentScaleValue = typeof value === 'number' ? String(Math.max(MIN_SCALE, Math.min(MAX_SCALE, value))) : value
  }

  zoomBy(factor: number): void {
    if (!this.pv) return
    this.pv.currentScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.pv.currentScale * factor))
  }

  find(query: string, again: boolean, previous = false): void {
    if (!this.bus) return
    if (!query) { this.closeFind(); return }
    this.bus.dispatch('find', { source: this, type: again ? 'again' : '', query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false })
  }

  closeFind(): void {
    this.bus?.dispatch('findbarclose', { source: this })
    this.set({ find: null })
  }

  /** Draw page `n` small, for the sidebar. */
  async renderThumb(n: number, canvas: HTMLCanvasElement, width = 132): Promise<void> {
    const pdf = this.pdf
    if (!pdf || n < 1 || n > pdf.numPages) return
    const page = await pdf.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: (width * Math.min(2, window.devicePixelRatio || 1)) / base.width })
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`
    const context = canvas.getContext('2d', { alpha: false })
    if (context) await page.render({ canvas, canvasContext: context, viewport, background: '#ffffff' }).promise
  }

  pageElement(n: number): HTMLElement | null {
    return (this.pv?.getPageView(n - 1)?.div as HTMLElement | undefined) ?? null
  }

  // --- annotations --------------------------------------------------------------------------------------------------------

  /** Every page's text, in the matcher's form, read once (for placing annotations whose page is not known). */
  private allPageTexts(): Promise<QuoteChapterText[]> {
    const pdf = this.pdf
    if (!pdf) return Promise.resolve([])
    this.pageTexts ??= (async () => {
      const pages: QuoteChapterText[] = []
      for (let n = 1; n <= pdf.numPages; n++) {
        const content = await (await pdf.getPage(n)).getTextContent()
        const div = document.createElement('div')
        for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
          if (typeof item.str !== 'string') continue
          div.append(document.createTextNode(item.str))
          if (item.hasEOL) div.append(document.createElement('br'))
        }
        pages.push({ id: String(n), ...quoteSearchText(div) })
      }
      return pages
    })()
    return this.pageTexts
  }

  /** The page each annotation is on: its own place when given, else where its words are found. */
  async placeAnnotations(annotations: readonly ReaderAnnotation[]): Promise<ReadonlyMap<string, number>> {
    const placed = new Map<string, number>()
    const unknown: ReaderAnnotation[] = []
    for (const annotation of annotations) {
      if (annotation.place?.kind === 'page') placed.set(annotation.id, annotation.place.page)
      else unknown.push(annotation)
    }
    if (unknown.length && this.state.hasText) {
      const located = locateQuoteAnnotations(await this.allPageTexts(), unknown)
      for (const [id, page] of located) if (page) placed.set(id, Number(page))
    }
    return placed
  }

  /** The ranges of these annotations on page `n`'s text layer, when it is built. */
  rangesOnPage(n: number, annotations: readonly ReaderAnnotation[]): Map<string, Range> {
    const ranges = new Map<string, Range>()
    const layer = this.pageElement(n)?.querySelector<HTMLElement>('.textLayer')
    if (!layer || annotations.length === 0) return ranges
    const index = quoteTextIndex(layer)
    for (const annotation of annotations) {
      const range = annotationRange(index, annotation)
      if (range) ranges.set(annotation.id, range)
    }
    return ranges
  }
}
