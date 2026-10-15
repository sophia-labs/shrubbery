/**
 * `<mn-pdf-reader>` — the PDF reader: pdf.js's own viewer layer (PDFViewer, EventBus, PDFLinkService, PDFFindController) in a calm
 * toolbar. Any PDF in Files opens here; a file whose kind has evidence adds the assertions overlay.
 *
 *   continuous scroll with lazy pages · selectable text layer · working internal links · fit width (default) / fit page / ± / ⌘-wheel / pinch
 *   thumbnails and the outline (when the PDF has one) · find (⌘F, n of N, Enter / Shift+Enter) · page field · PgUp/PgDn/Home/End/j/k
 *   the last page and zoom of each file, remembered per viewer
 *   "What we read": translucent boxes where each assertion is printed, hover card, click selects, a list beside the pages
 *
 * THE SEAM (stable; the component page embeds this element beside itself, at any width — it lays out in its own box):
 *
 *   properties   data: Uint8Array | null      the PDF's bytes (copied; the caller keeps its own)
 *                fileKey: string              what the viewer remembers page and zoom under
 *                name: string                 for aria labels
 *                loading: { loaded, total } | null   the host's download progress, shown until `data` arrives
 *                error: string                a failure to show, with Retry (event `pdf-retry`)
 *                assertions: PdfAssertion[]   what was read; absent or empty: no overlay, no toggle
 *                info: PdfReadingInfo | null  the list's header (title, facts, notes, "nothing was read")
 *                overlay: boolean             the assertions overlay (attribute `overlay`), also the toggle's state
 *                selected: string | null      the selected assertion id
 *                reveal: { id, nonce } | null ask for an assertion: overlay on, scroll to it, select it, flash it (a new nonce asks again)
 *                spotlight: { id, nonce } | null  show one assertion's box on its page, the overlay staying off (a page link of the file's
 *                                             page); `page:N` turns to page N. The reader scrolls itself into view first.
 *   methods      goToPage(n) · showAssertion(id) · setZoom('page-width' | 'page-fit' | number) · find(query) · whenReady()
 *   events       (all bubble, composed)
 *                pdf-load              { pageCount, hasText, hasOutline }
 *                pdf-page-change       { page, pageCount }
 *                pdf-zoom-change       { zoom: 'page-width' | 'page-fit' | number, scale }
 *                pdf-error             { message }
 *                pdf-retry             the Retry button
 *                assertion-select      { id | null, page }       (a click on a box or a list item; Esc clears with null)
 *                assertion-overlay-change { on }
 *                assertion-located     { located, notLocated, total }   once the text search has placed what it can
 *                assertion-action      { action, id }            a verb of an assertion's `actions` (Check, Correct)
 *
 * Light DOM, one stylesheet injected once, house tokens only.
 */
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { ref } from 'lit/directives/ref.js'
import { repeat } from 'lit/directives/repeat.js'
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'
import pdfViewerCss from 'pdfjs-dist/web/pdf_viewer.css?inline'
import { loadPdfJs } from '../pdfjs-runtime.js'
import { PDF_READER_CSS } from './pdf-reader-styles.js'
import { readMemory, writeMemory } from './pdf-reader-memory.js'
import { linesOf, locateAll, type PageLine } from './pdf-locate.js'
import type {
  AssertionOverlayDetail, AssertionSelectDetail, AssertionStatus, PdfAssertion, PdfLoadDetail, PdfLocationReport, PdfPageChangeDetail, PdfReadingInfo,
} from './pdf-reader-types.js'

/* eslint-disable @typescript-eslint/no-explicit-any -- pdf.js's viewer layer is used through the narrow surface below */
type Loose = any

const ICONS: Readonly<Record<string, string>> = {
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  up: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', minus: '<path d="M5 12h14"/>', plus: '<path d="M5 12h14M12 5v14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="9" width="10" height="6" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
}
const ic = (name: string): TemplateResult => html`<svg viewBox="0 0 24 24" aria-hidden="true">${unsafeSVG(ICONS[name] ?? '')}</svg>`

const STATUS_WORDS: Readonly<Record<AssertionStatus, string>> = {
  read: 'Read', check: 'To check', checked: 'Checked', corrected: 'Corrected', contested: 'Contested',
}
const MIN_SCALE = 0.25
const MAX_SCALE = 5

interface Placed { readonly page: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly source: 'text' | 'reader' }
interface OutlineItem { title: string; dest: unknown; items: OutlineItem[] }

let stylesInjected = false
function injectStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return
  stylesInjected = true
  const style = document.createElement('style')
  style.id = 'mn-pdf-reader-styles'
  style.textContent = `${pdfViewerCss}\n${PDF_READER_CSS}`
  document.head.appendChild(style)
}

let viewerModule: Promise<Loose> | null = null
async function loadViewer(): Promise<{ pdfjs: Loose; viewer: Loose }> {
  const pdfjs = await loadPdfJs()
  ;(globalThis as Loose).pdfjsLib = pdfjs
  // The viewer layer reads globalThis.pdfjsLib when it loads, so it loads after the library is in place.
  viewerModule ??= import('pdfjs-dist/legacy/web/pdf_viewer.mjs')
  return { pdfjs, viewer: await viewerModule }
}

@customElement('mn-pdf-reader')
export class MnPdfReader extends LitElement {
  @property({ attribute: false }) data: Uint8Array | null = null
  @property({ type: String, attribute: 'file-key' }) fileKey = ''
  @property({ type: String }) name = ''
  @property({ attribute: false }) loading: { loaded: number; total: number } | null = null
  @property({ type: String }) error = ''
  @property({ attribute: false }) assertions: readonly PdfAssertion[] = []
  @property({ attribute: false }) info: PdfReadingInfo | null = null
  @property({ type: Boolean, reflect: true }) overlay = false
  @property({ attribute: false }) selected: string | null = null
  @property({ attribute: false }) reveal: { id: string; nonce: number } | null = null
  @property({ attribute: false }) spotlight: { id: string; nonce: number } | null = null
  /** The toggle's name. */
  @property({ type: String, attribute: 'overlay-label' }) overlayLabel = 'What we read'

  @state() private pageCount = 0
  @state() private pageNo = 1
  @state() private zoomMode: 'page-width' | 'page-fit' | number = 'page-width'
  @state() private scalePct = 100
  @state() private sidebar = false
  @state() private tab: 'thumbs' | 'outline' = 'thumbs'
  @state() private outline: OutlineItem[] = []
  @state() private parsing = false
  @state() private parseError = ''
  @state() private noText = false
  @state() private findOpen = false
  @state() private findQuery = ''
  @state() private findCount: { current: number; total: number } | null = null
  @state() private findNone = false
  @state() private listOpen = true
  @state() private filter = ''
  @state() private scope: 'visible' | 'all' = 'visible'
  @state() private visible: [number, number] = [1, 1]
  @state() private placed: ReadonlyMap<string, Placed> = new Map()
  @state() private locating = false
  @state() private locateDone = false
  @state() private card: { id: string; x: number; y: number } | null = null
  @state() private thumbsReady = 0

  private pdf: Loose = null
  private pv: Loose = null
  private pdfjs: Loose = null
  private bus: Loose = null
  private links: Loose = null
  private finder: Loose = null
  private task: Loose = null
  private ready: Promise<void> = Promise.resolve()
  private generation = 0
  private resizeObserver: ResizeObserver | null = null
  private rememberTimer = 0
  private findTimer = 0
  private flashTimer = 0
  private pendingFocus: string | null = null
  private lineCache = new Map<number, Promise<PageLine[]>>()
  private viewports = new Map<number, { width: number; height: number; convert: (r: number[]) => number[] }>()
  private thumbQueue: number[] = []
  private thumbBusy = false
  private thumbSeen = new Set<number>()
  private lastReveal = 0
  private lastFocus = 0
  /** The one assertion whose box is drawn while the overlay is off (a page link asked for it), and one waiting for the document. */
  private only: string | null = null
  private pendingOnly: string | null = null

  protected override createRenderRoot(): HTMLElement { return this }

  override connectedCallback(): void {
    super.connectedCallback()
    injectStyles()
    this.addEventListener('keydown', this.onKey)
  }

  override disconnectedCallback(): void {
    this.removeEventListener('keydown', this.onKey)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.teardown()
    super.disconnectedCallback()
  }

  // --- the public seam ----------------------------------------------------------------------------------------------------

  /** Resolves once the document is open and its pages are laid out. */
  whenReady(): Promise<void> { return this.ready }

  goToPage(n: number): void {
    if (!this.pv || !Number.isFinite(n)) return
    this.pv.currentPageNumber = Math.max(1, Math.min(this.pageCount || 1, Math.floor(n)))
  }

  setZoom(value: 'page-width' | 'page-fit' | number): void {
    if (!this.pv) return
    this.zoomMode = value
    this.pv.currentScaleValue = typeof value === 'number' ? String(Math.max(MIN_SCALE, Math.min(MAX_SCALE, value))) : value
    this.remember()
  }

  find(query: string): void {
    this.findOpen = true
    this.findQuery = query
    this.runFind('')
  }

  /** Turn the overlay on and go to an assertion: its box when it was located, its page when it was not. */
  showAssertion(id: string): void {
    if (!this.assertions.some(a => a.id === id)) return
    this.pendingFocus = id
    this.selected = id
    this.setOverlay(true)
    void this.ready.then(() => this.flushFocus())
  }

  // --- lifecycle ----------------------------------------------------------------------------------------------------------

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('assertions')) { this.placed = new Map(); this.locateDone = false; this.locating = false; this.lineCache.clear() }
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has('data')) void this.open()
    if (changed.has('assertions') || changed.has('overlay')) {
      if (this.overlay && this.pv && !this.locating && !this.locateDone) void this.locate()
      this.draw()
    }
    if (changed.has('selected') || changed.has('placed')) this.draw()
    if (changed.has('reveal') && this.reveal && this.reveal.nonce !== this.lastReveal) {
      this.lastReveal = this.reveal.nonce
      this.showAssertion(this.reveal.id)
    }
    if (changed.has('spotlight') && this.spotlight && this.spotlight.nonce !== this.lastFocus) {
      this.lastFocus = this.spotlight.nonce
      this.pendingOnly = this.spotlight.id
      this.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
      void this.focusOnly()
    }
  }

  /** Show one assertion's box on its page, the overlay as it is: a box the import gave, else where its words are on the page. */
  private async focusOnly(): Promise<void> {
    const id = this.pendingOnly
    if (!id || !this.pv || !this.pageCount || this.parsing) return
    this.pendingOnly = null
    if (id.startsWith('page:')) { this.goToPage(Number(id.slice(5))); return }
    const a = this.assertions.find(x => x.id === id)
    if (!a) return
    const previous = this.only
    this.only = id
    if (previous && previous !== id) { const was = this.placed.get(previous); if (was) this.drawPage(was.page) }
    if (!this.placed.has(id)) await this.placeOne(a)
    const p = this.placed.get(id)
    if (p) { this.scrollToPlaced(p); this.drawPage(p.page); this.flash(id) }
    else { const page = a.page ?? a.readingPages[0]; if (page) this.goToPage(page) }
  }

  /** Place one assertion: its own box, else the text search over its page(s), with the page's other rows competing for the lines. */
  private async placeOne(a: PdfAssertion): Promise<void> {
    const generation = this.generation
    const put = (id: string, p: Placed) => { this.placed = new Map([...this.placed, [id, p]]) }
    if (a.box) {
      const vp = await this.pageViewport(a.box.page)
      if (vp && generation === this.generation) {
        const [vx0, vy0, vx1, vy1] = vp.convert([a.box.l, a.box.b, a.box.r, a.box.t]) as [number, number, number, number]
        const x0 = Math.max(0, Math.min(vx0, vx1)), x1 = Math.min(vp.width, Math.max(vx0, vx1)), y0 = Math.max(0, Math.min(vy0, vy1)), y1 = Math.min(vp.height, Math.max(vy0, vy1))
        put(a.id, { page: a.box.page, x: x0 / vp.width, y: y0 / vp.height, w: (x1 - x0) / vp.width, h: (y1 - y0) / vp.height, source: 'reader' })
        return
      }
    }
    const pages = new Set([a.page, ...a.readingPages].filter((n): n is number => typeof n === 'number' && n > 0))
    const rows = this.assertions.filter(x => !x.box && x.page !== null && pages.has(x.page))
      .map(x => ({ id: x.id, label: x.label, symbol: x.symbol, numbers: x.numbers, page: x.page, alt: x.id === a.id ? x.readingPages : [] }))
    if (!rows.some(r => r.id === a.id)) rows.push({ id: a.id, label: a.label, symbol: a.symbol, numbers: a.numbers, page: a.page, alt: a.readingPages })
    try {
      await locateAll(rows, n => this.pageLines(n), (page, found) => {
        const vp = this.viewports.get(page)
        const hit = found.get(a.id)
        if (!vp || !hit || generation !== this.generation) return
        const [vx0, vy0, vx1, vy1] = vp.convert([hit.rect.x0, hit.rect.y0, hit.rect.x1, hit.rect.y1]) as [number, number, number, number]
        const x0 = Math.max(0, Math.min(vx0, vx1) - 2), x1 = Math.min(vp.width, Math.max(vx0, vx1) + 2)
        const y0 = Math.max(0, Math.min(vy0, vy1) - 1), y1 = Math.min(vp.height, Math.max(vy0, vy1) + 1)
        put(a.id, { page, x: x0 / vp.width, y: y0 / vp.height, w: (x1 - x0) / vp.width, h: (y1 - y0) / vp.height, source: 'text' })
      })
    } catch { /* not located: its page is turned to instead */ }
  }

  private teardown(): void {
    this.generation++
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    window.clearTimeout(this.rememberTimer)
    window.clearTimeout(this.findTimer)
    try { this.task?.destroy() } catch { /* already gone */ }
    this.task = null
    try { this.pv?.cleanup?.() ; this.pv?.setDocument?.(null) } catch { /* torn down */ }
    this.pv = null
    try { void this.pdf?.destroy?.() } catch { /* torn down */ }
    this.pdf = null
    this.lineCache.clear()
    this.viewports.clear()
    this.thumbQueue = []
    this.thumbSeen.clear()
  }

  private async open(): Promise<void> {
    this.teardown()
    const generation = this.generation
    const data = this.data
    this.pageCount = 0; this.pageNo = 1; this.outline = []; this.noText = false; this.parseError = ''
    this.findOpen = false; this.findCount = null; this.thumbsReady = 0; this.card = null
    this.placed = new Map(); this.locateDone = false; this.locating = false; this.only = null
    if (!data) { this.parsing = false; this.ready = Promise.resolve(); return }
    this.parsing = true
    let done!: () => void
    this.ready = new Promise<void>(resolve => { done = resolve })
    try {
      await this.updateComplete
      const { pdfjs, viewer } = await loadViewer()
      if (generation !== this.generation) return
      const container = this.querySelector<HTMLElement>('.pr-container')
      const viewerEl = this.querySelector<HTMLElement>('.pdfViewer')
      if (!container || !viewerEl) throw new Error('The reader is not on the page.')
      this.pdfjs = pdfjs
      const bus = new viewer.EventBus()
      const links = new viewer.PDFLinkService({ eventBus: bus, externalLinkTarget: 2, externalLinkRel: 'noopener noreferrer nofollow' })
      const finder = new viewer.PDFFindController({ linkService: links, eventBus: bus, updateMatchesCountOnProgress: true })
      const pv = new viewer.PDFViewer({ container, viewer: viewerEl, eventBus: bus, linkService: links, findController: finder,
        textLayerMode: 1, removePageBorders: true, maxCanvasPixels: 16_777_216 })
      links.setViewer(pv)
      this.bus = bus; this.links = links; this.finder = finder; this.pv = pv
      this.wire(bus, pv, generation, done)
      const task = pdfjs.getDocument({ data: data.slice(), disableFontFace: true, useSystemFonts: true, useWorkerFetch: false, useWasm: false,
        isOffscreenCanvasSupported: false, isImageDecoderSupported: false, stopAtErrors: false })
      this.task = task
      const pdf = await task.promise
      if (generation !== this.generation) { void pdf.destroy(); return }
      this.pdf = pdf
      pv.setDocument(pdf)
      links.setDocument(pdf, null)
      this.pageCount = pdf.numPages
      void this.readOutline(pdf, generation)
      void this.checkText(pdf, generation)
      this.observeSize(container)
    } catch (e) {
      if (generation !== this.generation) return
      const name = (e as { name?: string })?.name
      this.parsing = false
      this.parseError = name === 'PasswordException' ? 'This PDF is password protected, and the viewer cannot ask for the password yet.'
        : name === 'InvalidPDFException' ? 'This file is not a PDF the viewer can read.'
        : `The PDF could not be opened: ${e instanceof Error ? e.message : String(e)}`
      this.say('pdf-error', { message: this.parseError })
      done()
    }
  }

  private wire(bus: Loose, pv: Loose, generation: number, done: () => void): void {
    const live = () => generation === this.generation
    bus.on('pagesinit', () => {
      if (!live()) return
      const memory = readMemory(this.fileKey)
      const zoom = memory?.zoom ?? 'page-width'
      this.zoomMode = zoom === 'page-width' || zoom === 'page-fit' ? zoom : Number(zoom)
      pv.currentScaleValue = typeof this.zoomMode === 'number' ? String(this.zoomMode) : this.zoomMode
      if (memory && memory.page > 1) pv.currentPageNumber = Math.min(memory.page, pv.pagesCount)
      this.pageNo = pv.currentPageNumber
      this.scalePct = Math.round(pv.currentScale * 100)
      this.parsing = false
      this.updateVisible()
      this.say('pdf-load', { pageCount: pv.pagesCount, hasText: !this.noText, hasOutline: this.outline.length > 0 } satisfies PdfLoadDetail)
      done()
      void this.afterLoad()
    })
    bus.on('pagechanging', (e: { pageNumber: number }) => {
      if (!live()) return
      this.pageNo = e.pageNumber
      this.say('pdf-page-change', { page: e.pageNumber, pageCount: pv.pagesCount } satisfies PdfPageChangeDetail)
      this.remember()
      this.updateVisible()
    })
    bus.on('scalechanging', (e: { scale: number; presetValue?: string }) => {
      if (!live()) return
      this.scalePct = Math.round(e.scale * 100)
      if (!e.presetValue && typeof this.zoomMode !== 'number') this.zoomMode = Math.round(e.scale * 100) / 100
      this.say('pdf-zoom-change', { zoom: this.zoomMode, scale: e.scale })
      this.remember()
      this.updateVisible()
    })
    bus.on('pagerendered', (e: { pageNumber: number }) => { if (live()) { this.drawPage(e.pageNumber); this.updateVisible() } })
    bus.on('updatefindmatchescount', (e: { matchesCount: { current: number; total: number } }) => { if (live()) this.findCount = e.matchesCount })
    bus.on('updatefindcontrolstate', (e: { state: number; matchesCount: { current: number; total: number } }) => {
      if (!live()) return
      this.findCount = e.matchesCount
      this.findNone = e.state === 1 && !!this.findQuery
    })
  }

  private async afterLoad(): Promise<void> {
    if (this.assertions.length && this.overlay) await this.locate()
    this.flushFocus()
    await this.focusOnly()
  }

  private observeSize(container: HTMLElement): void {
    this.resizeObserver?.disconnect()
    let last = container.clientWidth
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.pv || container.clientWidth === last) return
      last = container.clientWidth
      // A preset (fit width, fit page) follows the box; a fixed scale stays.
      if (typeof this.zoomMode !== 'number') this.pv.currentScaleValue = this.zoomMode
      else this.pv.update?.()
    })
    this.resizeObserver.observe(container)
    container.addEventListener('scroll', () => this.updateVisible(), { passive: true })
    container.addEventListener('wheel', this.onWheel, { passive: false })
    container.addEventListener('pointerdown', () => { if (document.activeElement === document.body) container.focus({ preventScroll: true }) })
  }

  private async readOutline(pdf: Loose, generation: number): Promise<void> {
    try {
      const raw = (await pdf.getOutline()) as { title: string; dest: unknown; items?: unknown[] }[] | null
      if (generation !== this.generation || !raw?.length) return
      const map = (items: typeof raw): OutlineItem[] => items.map(i => ({ title: String(i.title ?? ''), dest: i.dest, items: map((i.items ?? []) as typeof raw) }))
      this.outline = map(raw)
    } catch { /* a PDF without a readable outline has none */ }
  }

  /** A scan has pages and no text: said, so search and selection are not a mystery. */
  private async checkText(pdf: Loose, generation: number): Promise<void> {
    try {
      let any = false
      for (let n = 1; n <= Math.min(3, pdf.numPages) && !any; n++) {
        const content = await (await pdf.getPage(n)).getTextContent()
        any = content.items.some((i: { str?: string }) => (i.str ?? '').trim() !== '')
      }
      if (generation === this.generation) this.noText = !any
    } catch { /* unknown stays "has text" */ }
  }

  private remember(): void {
    window.clearTimeout(this.rememberTimer)
    this.rememberTimer = window.setTimeout(() => {
      if (this.pv) writeMemory(this.fileKey, { page: this.pv.currentPageNumber, zoom: this.zoomMode })
    }, 300)
  }

  private say<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { bubbles: true, composed: true, detail }))
  }

  // --- zoom, keys, wheel --------------------------------------------------------------------------------------------------

  private zoomBy(factor: number): void {
    if (!this.pv) return
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.pv.currentScale * factor))
    this.zoomMode = Math.round(next * 100) / 100
    this.pv.currentScale = next
  }

  private readonly onWheel = (e: WheelEvent): void => {
    if (!(e.ctrlKey || e.metaKey) || !this.pv) return
    e.preventDefault()
    this.zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0035)))
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement
    const typing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement
    const mod = e.metaKey || e.ctrlKey
    if (mod && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); this.openFind(); return }
    if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); this.zoomBy(1.2); return }
    if (mod && (e.key === '-' || e.key === '_')) { e.preventDefault(); this.zoomBy(1 / 1.2); return }
    if (mod && e.key === '0') { e.preventDefault(); this.setZoom('page-width'); return }
    if (e.key === 'Escape') {
      if (this.findOpen) { e.preventDefault(); e.stopPropagation(); this.closeFind(); return }
      if (this.selected) { this.select(null); return }
      return
    }
    if (typing || mod || e.altKey) return
    const container = this.querySelector<HTMLElement>('.pr-container')
    if (!container) return
    if (e.key === 'j') { e.preventDefault(); container.scrollBy({ top: 90 }) }
    else if (e.key === 'k') { e.preventDefault(); container.scrollBy({ top: -90 }) }
    else if (e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'Home' || e.key === 'End') {
      // The container scrolls these natively when it has focus; take focus so they work after a click on the toolbar.
      if (!container.contains(document.activeElement)) container.focus({ preventScroll: true })
    }
  }

  // --- find ---------------------------------------------------------------------------------------------------------------

  private openFind(): void {
    this.findOpen = true
    void this.updateComplete.then(() => { const input = this.querySelector<HTMLInputElement>('.pr-find input'); input?.focus(); input?.select() })
  }

  private closeFind(): void {
    this.findOpen = false
    this.findCount = null
    this.findNone = false
    this.bus?.dispatch('findbarclose', { source: this })
    this.querySelector<HTMLElement>('.pr-container')?.focus({ preventScroll: true })
  }

  private runFind(type: '' | 'again', previous = false): void {
    if (!this.bus) return
    this.bus.dispatch('find', { source: this, type, query: this.findQuery, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false })
  }

  // --- visible pages ------------------------------------------------------------------------------------------------------

  private updateVisible(): void {
    const container = this.querySelector<HTMLElement>('.pr-container')
    const pv = this.pv
    if (!container || !pv || !pv.pagesCount) return
    const top = container.scrollTop, bottom = top + container.clientHeight
    let first = 0, last = 0
    for (let n = 1; n <= pv.pagesCount; n++) {
      const div = pv.getPageView(n - 1)?.div as HTMLElement | undefined
      if (!div) continue
      if (div.offsetTop + div.offsetHeight < top) continue
      if (div.offsetTop > bottom) break
      if (!first) first = n
      last = n
    }
    if (first && (this.visible[0] !== first || this.visible[1] !== last)) this.visible = [first, last]
  }

  // --- the assertions: location, boxes, list -------------------------------------------------------------------------------

  private setOverlay(on: boolean): void {
    if (this.overlay === on) return
    this.overlay = on
    this.say('assertion-overlay-change', { on } satisfies AssertionOverlayDetail)
  }

  private async pageLines(n: number): Promise<PageLine[]> {
    let cached = this.lineCache.get(n)
    if (!cached) {
      const pdf = this.pdf
      cached = (async () => {
        const page = await pdf.getPage(n)
        const viewport = page.getViewport({ scale: 1 })
        this.viewports.set(n, { width: viewport.width, height: viewport.height, convert: (r: number[]) => viewport.convertToViewportRectangle(r) })
        const content = await page.getTextContent()
        return linesOf(content.items.filter((i: { str?: unknown }) => typeof i.str === 'string'))
      })()
      this.lineCache.set(n, cached)
    }
    return cached
  }

  private async pageViewport(n: number): Promise<{ width: number; height: number; convert: (r: number[]) => number[] } | null> {
    if (!this.viewports.has(n) && this.pdf && n >= 1 && n <= this.pdf.numPages) {
      const viewport = (await this.pdf.getPage(n)).getViewport({ scale: 1 })
      this.viewports.set(n, { width: viewport.width, height: viewport.height, convert: (r: number[]) => viewport.convertToViewportRectangle(r) })
    }
    return this.viewports.get(n) ?? null
  }

  private async locate(): Promise<void> {
    const pdf = this.pdf
    const generation = this.generation
    if (!pdf || this.locating || !this.assertions.length) return
    this.locating = true
    const assertions = this.assertions
    const next = new Map<string, Placed>()
    for (const a of assertions) {
      if (!a.box) continue
      const vp = await this.pageViewport(a.box.page)
      if (!vp) continue
      const [vx0, vy0, vx1, vy1] = vp.convert([a.box.l, a.box.b, a.box.r, a.box.t]) as [number, number, number, number]
      const x0 = Math.max(0, Math.min(vx0, vx1)), x1 = Math.min(vp.width, Math.max(vx0, vx1)), y0 = Math.max(0, Math.min(vy0, vy1)), y1 = Math.min(vp.height, Math.max(vy0, vy1))
      next.set(a.id, { page: a.box.page, x: x0 / vp.width, y: y0 / vp.height, w: (x1 - x0) / vp.width, h: (y1 - y0) / vp.height, source: 'reader' })
    }
    if (next.size) this.placed = new Map(next)
    const rows = assertions.filter(a => !next.has(a.id)).map(a => ({ id: a.id, label: a.label, symbol: a.symbol, numbers: a.numbers, page: a.page, alt: a.readingPages }))
    try {
      await locateAll(rows, n => this.pageLines(n), (page, found) => {
        const vp = this.viewports.get(page)
        if (!vp || generation !== this.generation || assertions !== this.assertions) return
        for (const [id, hit] of found) {
          const [vx0, vy0, vx1, vy1] = vp.convert([hit.rect.x0, hit.rect.y0, hit.rect.x1, hit.rect.y1]) as [number, number, number, number]
          const x0 = Math.max(0, Math.min(vx0, vx1) - 2), x1 = Math.min(vp.width, Math.max(vx0, vx1) + 2)
          const y0 = Math.max(0, Math.min(vy0, vy1) - 1), y1 = Math.min(vp.height, Math.max(vy0, vy1) + 1)
          next.set(id, { page, x: x0 / vp.width, y: y0 / vp.height, w: (x1 - x0) / vp.width, h: (y1 - y0) / vp.height, source: 'text' })
        }
        this.placed = new Map(next)
        this.flushFocus()
      })
    } catch { /* what could not be read stays "not located" */ }
    if (generation !== this.generation || assertions !== this.assertions) return
    this.placed = new Map(next)
    this.locating = false
    this.locateDone = true
    const located = assertions.filter(a => next.has(a.id)).length
    this.say('assertion-located', { located, notLocated: assertions.length - located, total: assertions.length } satisfies PdfLocationReport)
    this.flushFocus()
  }

  /** The boxes of one page, drawn into that page's own element (pdf.js clears a page's extra children when it resets). */
  private drawPage(n: number): void {
    const div = this.pv?.getPageView(n - 1)?.div as HTMLElement | undefined
    if (!div) return
    div.querySelector(':scope > .pr-alayer')?.remove()
    // The overlay draws every box; off, only the one a page link asked for.
    const mine = this.overlay ? this.assertions.filter(a => this.placed.get(a.id)?.page === n)
      : this.only && this.placed.get(this.only)?.page === n ? this.assertions.filter(a => a.id === this.only) : []
    if (!mine.length) return
    const layer = document.createElement('div')
    layer.className = 'pr-alayer'
    for (const a of mine) {
      const p = this.placed.get(a.id)!
      const box = document.createElement('div')
      box.className = 'pr-abox'
      box.dataset.id = a.id
      box.dataset.status = a.status
      box.dataset.source = p.source
      if (a.id === this.selected || (!this.overlay && a.id === this.only)) box.dataset.selected = ''
      box.tabIndex = 0
      box.setAttribute('role', 'button')
      box.setAttribute('aria-label', `${a.label}${a.value ? `, ${a.value}` : ''}, ${STATUS_WORDS[a.status]}, page ${n}`)
      box.style.cssText = `left:${(p.x * 100).toFixed(3)}%;top:${(p.y * 100).toFixed(3)}%;width:${(p.w * 100).toFixed(3)}%;height:${(p.h * 100).toFixed(3)}%`
      box.addEventListener('mouseenter', () => this.showCard(a.id, box))
      box.addEventListener('focus', () => this.showCard(a.id, box))
      box.addEventListener('mouseleave', () => { this.card = null })
      box.addEventListener('blur', () => { this.card = null })
      box.addEventListener('click', e => { e.stopPropagation(); this.select(a.id) })
      box.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select(a.id) } })
      layer.appendChild(box)
    }
    div.appendChild(layer)
  }

  private draw(): void {
    if (!this.pv) return
    for (let n = 1; n <= this.pageCount; n++) this.drawPage(n)
  }

  private showCard(id: string, box: HTMLElement): void {
    const stage = this.querySelector<HTMLElement>('.pr-stage')
    if (!stage) return
    const s = stage.getBoundingClientRect(), b = box.getBoundingClientRect()
    const width = Math.min(320, s.width - 16)
    const x = Math.max(8, Math.min(s.width - width - 8, b.left - s.left))
    const below = b.bottom - s.top + 8
    const y = below + 190 > s.height ? Math.max(8, b.top - s.top - 8 - 190) : below
    this.card = { id, x, y }
  }

  private select(id: string | null): void {
    this.selected = id
    const a = id ? this.assertions.find(x => x.id === id) : null
    this.say('assertion-select', { id, page: a ? this.placed.get(a.id)?.page ?? a.page : null } satisfies AssertionSelectDetail)
  }

  /** Go to the asked-for assertion once it can be placed: its box, flashing; or its page when no box was found. */
  private flushFocus(): void {
    const id = this.pendingFocus
    if (!id || !this.pv || !this.pageCount) return
    const a = this.assertions.find(x => x.id === id)
    if (!a) { this.pendingFocus = null; return }
    const p = this.placed.get(id)
    if (p) {
      this.pendingFocus = null
      this.scrollToPlaced(p)
      this.flash(id)
    } else if (this.locateDone || !this.overlay) {
      this.pendingFocus = null
      const page = a.page ?? a.readingPages[0]
      if (page) this.goToPage(page)
    } else if (a.page && !this.locating) {
      this.goToPage(a.page)
    }
  }

  private scrollToPlaced(p: Placed): void {
    const container = this.querySelector<HTMLElement>('.pr-container')
    const div = this.pv?.getPageView(p.page - 1)?.div as HTMLElement | undefined
    if (!container || !div) return
    const top = div.offsetTop + p.y * div.offsetHeight - container.clientHeight * 0.3
    const left = div.offsetLeft + p.x * div.offsetWidth - 40
    container.scrollTo({ top: Math.max(0, top), left: Math.max(0, Math.min(left, container.scrollWidth)), behavior: 'smooth' })
  }

  private flash(id: string): void {
    window.clearTimeout(this.flashTimer)
    const p = this.placed.get(id)
    if (!p) return
    this.drawPage(p.page)
    const box = this.pv?.getPageView(p.page - 1)?.div?.querySelector(`.pr-abox[data-id="${CSS.escape(id)}"]`) as HTMLElement | null
    box?.classList.add('flash')
    this.flashTimer = window.setTimeout(() => box?.classList.remove('flash'), 2400)
  }

  private choose(a: PdfAssertion): void {
    this.select(a.id)
    this.pendingFocus = a.id
    this.flushFocus()
    if (!this.placed.has(a.id) && a.page) this.goToPage(a.page)
  }

  // --- thumbnails ---------------------------------------------------------------------------------------------------------

  private readonly onThumbVisible = (canvasHost?: Element): void => {
    if (!canvasHost) return
    const n = Number((canvasHost as HTMLElement).dataset.page)
    if (!n || this.thumbSeen.has(n)) return
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      observer.disconnect()
      if (!this.thumbSeen.has(n)) { this.thumbSeen.add(n); this.thumbQueue.push(n); void this.drainThumbs() }
    }, { root: this.querySelector('.pr-side .pr-scroll'), rootMargin: '200px' })
    observer.observe(canvasHost)
  }

  private async drainThumbs(): Promise<void> {
    if (this.thumbBusy) return
    this.thumbBusy = true
    const generation = this.generation
    while (this.thumbQueue.length && generation === this.generation && this.pdf) {
      const n = this.thumbQueue.shift()!
      try {
        const page = await this.pdf.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const scale = (132 * Math.min(2, window.devicePixelRatio || 1)) / base.width
        const viewport = page.getViewport({ scale })
        const canvas = this.querySelector<HTMLCanvasElement>(`canvas[data-thumb="${n}"]`)
        if (!canvas) continue
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
        canvas.style.aspectRatio = `${canvas.width} / ${canvas.height}`
        const ctx = canvas.getContext('2d', { alpha: false })
        if (ctx) await page.render({ canvas, canvasContext: ctx, viewport, background: '#ffffff' }).promise
        canvas.dataset.ready = ''
        this.thumbsReady++
      } catch { /* a thumbnail that fails is a blank one */ }
    }
    this.thumbBusy = false
  }

  // --- render -------------------------------------------------------------------------------------------------------------

  private veil(): TemplateResult | typeof nothing {
    const message = this.error || this.parseError
    if (message) {
      return html`<div class="pr-veil" data-error role="alert"><p>${message}</p>
        <button type="button" class="pr-btn" data-action="retry" @click=${() => this.say('pdf-retry', {})}>Try again</button></div>`
    }
    if (!this.data) {
      const l = this.loading
      const known = l && l.total > 0
      const mb = (n: number) => `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB`
      return html`<div class="pr-veil" data-loading role="status"><p>${known ? `Downloading ${this.name || 'the file'}: ${mb(l!.loaded)} of ${mb(l!.total)}` : `Opening ${this.name || 'the file'}…`}</p>
        <div class="pr-progress ${known ? '' : 'indeterminate'}"><i style=${known ? `width:${Math.min(100, Math.round((100 * l!.loaded) / l!.total))}%` : ''}></i></div></div>`
    }
    if (this.parsing) {
      return html`<div class="pr-veil" data-loading role="status"><p>Laying out the pages…</p><div class="pr-progress indeterminate"><i></i></div></div>`
    }
    return nothing
  }

  private toolbar(): TemplateResult {
    const has = this.assertions.length > 0 || (this.info !== null)
    const ready = this.pageCount > 0
    return html`<div class="pr-bar" role="toolbar" aria-label="PDF viewer">
      <button type="button" class="pr-btn" data-action="sidebar" aria-label="Pages and outline" title="Pages and outline" aria-pressed=${this.sidebar ? 'true' : 'false'}
        ?disabled=${!ready} @click=${() => { this.sidebar = !this.sidebar }}>${ic('sidebar')}</button>
      <span class="pr-sep"></span>
      <span class="pr-page">
        <input type="text" inputmode="numeric" aria-label="Page number" .value=${String(this.pageNo)} ?disabled=${!ready}
          @focus=${(e: FocusEvent) => (e.target as HTMLInputElement).select()}
          @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') { this.goToPage(Number((e.target as HTMLInputElement).value)); (e.target as HTMLInputElement).blur() } else if (e.key === 'Escape') { (e.target as HTMLInputElement).value = String(this.pageNo); (e.target as HTMLInputElement).blur() } }}
          @blur=${(e: FocusEvent) => { (e.target as HTMLInputElement).value = String(this.pageNo) }} />
        <span aria-hidden="true">/</span><span data-page-count>${this.pageCount || '–'}</span></span>
      <button type="button" class="pr-btn" data-action="prev" aria-label="Previous page" title="Previous page" ?disabled=${!ready || this.pageNo <= 1} @click=${() => this.goToPage(this.pageNo - 1)}>${ic('up')}</button>
      <button type="button" class="pr-btn" data-action="next" aria-label="Next page" title="Next page" ?disabled=${!ready || this.pageNo >= this.pageCount} @click=${() => this.goToPage(this.pageNo + 1)}>${ic('down')}</button>
      <span class="pr-sep"></span>
      <button type="button" class="pr-btn" data-action="zoom-out" aria-label="Zoom out" title="Zoom out (⌘−)" ?disabled=${!ready} @click=${() => this.zoomBy(1 / 1.2)}>${ic('minus')}</button>
      <span class="pr-zoom pr-page" data-zoom aria-live="off">${this.scalePct}%</span>
      <button type="button" class="pr-btn" data-action="zoom-in" aria-label="Zoom in" title="Zoom in (⌘+)" ?disabled=${!ready} @click=${() => this.zoomBy(1.2)}>${ic('plus')}</button>
      <select class="pr-fit" aria-label="Fit" data-fit ?disabled=${!ready}
        @change=${(e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v === 'page-width' || v === 'page-fit') this.setZoom(v) }}>
        <option value="page-width" ?selected=${this.zoomMode === 'page-width'}>Fit width</option>
        <option value="page-fit" ?selected=${this.zoomMode === 'page-fit'}>Fit page</option>
        <option value="custom" ?selected=${typeof this.zoomMode === 'number'} disabled>${this.scalePct}%</option>
      </select>
      <span class="pr-grow"></span>
      <button type="button" class="pr-btn" data-action="find" aria-label="Find in document" title="Find (⌘F)" aria-pressed=${this.findOpen ? 'true' : 'false'} ?disabled=${!ready}
        @click=${() => { if (this.findOpen) this.closeFind(); else this.openFind() }}>${ic('search')}<span class="pr-lbl">Find</span></button>
      ${has ? html`<span class="pr-sep"></span>
        <button type="button" class="pr-btn" data-action="overlay" aria-pressed=${this.overlay ? 'true' : 'false'} title=${`${this.overlayLabel}: box each value where the page prints it`}
          @click=${() => { this.setOverlay(!this.overlay) }}>${ic('scan')}<span class="pr-lbl">${this.overlayLabel}</span></button>
        ${this.overlay ? html`<button type="button" class="pr-btn" data-action="list" aria-label="List" title="Show or hide the list" aria-pressed=${this.listOpen ? 'true' : 'false'}
          @click=${() => { this.listOpen = !this.listOpen }}>${ic('list')}</button>` : nothing}` : nothing}
    </div>`
  }

  private sidePanel(): TemplateResult | typeof nothing {
    if (!this.sidebar || !this.pageCount) return nothing
    const outlineList = (items: OutlineItem[]): TemplateResult => html`<ul>${items.map(i => html`<li>
      <button type="button" @click=${() => { if (i.dest) this.links?.goToDestination(i.dest) }}>${i.title || '(untitled)'}</button>
      ${i.items.length ? outlineList(i.items) : nothing}</li>`)}</ul>`
    const pages = Array.from({ length: this.pageCount }, (_, i) => i + 1)
    return html`<aside class="pr-side" aria-label="Pages and outline">
      <div class="pr-tabs" role="tablist">
        <button type="button" class="pr-tab" role="tab" aria-selected=${this.tab === 'thumbs' ? 'true' : 'false'} @click=${() => { this.tab = 'thumbs' }}>Pages</button>
        <button type="button" class="pr-tab" role="tab" aria-selected=${this.tab === 'outline' ? 'true' : 'false'} @click=${() => { this.tab = 'outline' }}>Outline</button>
      </div>
      <div class="pr-scroll">${this.tab === 'thumbs'
        ? repeat(pages, n => n, n => html`<button type="button" class="pr-thumb" data-page=${n} aria-label=${`Page ${n}`} aria-current=${n === this.pageNo ? 'page' : 'false'}
            @click=${() => this.goToPage(n)} ${ref(this.onThumbVisible)}><canvas data-thumb=${n}></canvas><span>${n}</span></button>`)
        : this.outline.length ? html`<div class="pr-outline">${outlineList(this.outline)}</div>` : html`<p class="pr-note">This PDF has no outline.</p>`}</div>
    </aside>`
  }

  private findBar(): TemplateResult | typeof nothing {
    if (!this.findOpen) return nothing
    const c = this.findCount
    return html`<div class="pr-find" role="search">
      <input type="text" aria-label="Find in document" placeholder="Find" .value=${this.findQuery} spellcheck="false"
        @input=${(e: Event) => { this.findQuery = (e.target as HTMLInputElement).value; window.clearTimeout(this.findTimer); this.findTimer = window.setTimeout(() => this.runFind(''), 140) }}
        @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); this.runFind('again', e.shiftKey) } }} />
      <span class="pr-count" data-find-count aria-live="polite">${!this.findQuery ? '' : this.noText ? 'No text layer' : c && c.total ? `${c.current} of ${c.total}` : this.findNone ? 'No matches' : '…'}</span>
      <button type="button" class="pr-btn" data-action="find-prev" aria-label="Previous match" @click=${() => this.runFind('again', true)}>${ic('up')}</button>
      <button type="button" class="pr-btn" data-action="find-next" aria-label="Next match" @click=${() => this.runFind('again', false)}>${ic('down')}</button>
      <button type="button" class="pr-btn" data-action="find-close" aria-label="Close find" @click=${() => this.closeFind()}>${ic('x')}</button>
    </div>`
  }

  private cardView(): TemplateResult | typeof nothing {
    const c = this.card
    const a = c ? this.assertions.find(x => x.id === c.id) : null
    if (!c || !a) return nothing
    const at = this.placed.get(a.id)
    return html`<div class="pr-card" style=${`left:${c.x}px;top:${c.y}px`} role="tooltip" data-card>
      <h4>${a.label}${a.symbol ? html` <small>(${a.symbol})</small>` : nothing}</h4>
      <div class="pr-val">${a.value || html`<span class="pr-note">no value read</span>`}</div>
      <dl>
        <dt>Status</dt><dd>${STATUS_WORDS[a.status]} · ${a.mark} ${a.agreement}</dd>
        ${a.group ? html`<dt>Where</dt><dd>${a.group}</dd>` : nothing}
        ${a.conditions.length ? html`<dt>Conditions</dt><dd>${a.conditions.join('; ')}</dd>` : nothing}
        ${a.readings.length ? html`<dt>Readings</dt><dd>${a.readings.map(r => html`<div>${r.text}${r.page ? ` · p. ${r.page}` : ''}</div>`)}</dd>` : nothing}
        <dt>Page</dt><dd>${at?.page ?? a.page ?? '–'}${at ? at.source === 'text' ? ' · found in the page text (approximate)' : ` · box from the import${a.precision ? `: ${a.precision}` : ''}${a.method ? ` (${a.method})` : ''}` : ''}</dd>
        ${a.notes.length ? html`<dt>Notes</dt><dd>${a.notes.map(n => html`<div>${n}</div>`)}</dd>` : nothing}
      </dl></div>`
  }

  private listView(): TemplateResult | typeof nothing {
    if (!this.overlay || !this.listOpen) return nothing
    const all = this.assertions
    const q = this.filter.trim().toLowerCase()
    const inScope = (a: PdfAssertion) => {
      const page = this.placed.get(a.id)?.page ?? a.page
      return this.scope === 'all' || (page !== null && page >= this.visible[0] && page <= this.visible[1])
    }
    const shown = all.filter(a => inScope(a) && (!q || `${a.label} ${a.symbol} ${a.value} ${a.group}`.toLowerCase().includes(q)))
    const located = all.filter(a => this.placed.has(a.id)).length
    const info = this.info
    let lastGroup = ''
    const items = shown.map(a => {
      const header = a.group !== lastGroup ? html`<div class="pr-group">${a.group || 'Other'}</div>` : nothing
      lastGroup = a.group
      return html`${header}${this.item(a)}`
    })
    return html`<aside class="pr-claims" aria-label=${this.overlayLabel}>
      <header><h3>${this.overlayLabel}</h3>
        <button type="button" class="pr-btn" data-action="close-list" aria-label="Close list" @click=${() => { this.listOpen = false }}>${ic('x')}</button></header>
      ${info ? html`<details class="pr-about" open><summary>${info.title || info.heading}</summary>
        <dl>${info.facts.map(f => html`<dt>${f.label}</dt><dd>${f.text}${f.hint ? html`<small>${f.hint}</small>` : nothing}</dd>`)}</dl>
        ${info.notes.length ? html`<ul>${info.notes.map(n => html`<li>${n}</li>`)}</ul>` : nothing}</details>` : nothing}
      ${all.length ? html`<div class="pr-tools">
        <input type="search" aria-label="Filter assertions" placeholder="Filter by name, symbol or value" .value=${this.filter} @input=${(e: Event) => { this.filter = (e.target as HTMLInputElement).value }} />
        <button type="button" class="pr-btn" data-action="scope" aria-pressed=${this.scope === 'all' ? 'true' : 'false'} title="Show assertions of the pages in view, or of every page"
          @click=${() => { this.scope = this.scope === 'all' ? 'visible' : 'all' }}>${this.scope === 'all' ? 'All pages' : 'Pages in view'}</button></div>
        <div class="pr-legend" aria-label="Legend">
          ${(['read', 'check', 'checked', 'corrected', 'contested'] as const).map(s => html`<span><i class="pr-dot" data-s=${s}></i>${STATUS_WORDS[s]}</span>`)}
          <span><i class="pr-dot" data-dashed></i>found in the page text</span></div>` : nothing}
      <div class="pr-list" data-list>
        ${all.length === 0 ? html`<p class="pr-note" data-empty>${info?.empty ?? 'Nothing was read from this file.'}</p>`
          : shown.length === 0 ? html`<p class="pr-note" data-empty>${q ? 'No assertion matches.' : this.scope === 'visible' ? 'No assertions on the pages in view. Show all pages to see every one.' : 'Nothing to show.'}</p>`
          : items}
        ${info?.truncated ? html`<p class="pr-note" data-truncated>${info.truncated}</p>` : nothing}
        ${all.length ? html`<p class="pr-note" data-located>${this.locating ? 'Finding where each is printed…' : `${located} of ${all.length} located in the page text.`}</p>` : nothing}
      </div></aside>`
  }

  private item(a: PdfAssertion): TemplateResult {
    const at = this.placed.get(a.id)
    const current = this.selected === a.id
    const unplaced = this.locateDone && !at
    return html`<button type="button" class="pr-item" data-id=${a.id} data-status=${a.status} aria-current=${current ? 'true' : 'false'} @click=${() => this.choose(a)}>
      <span class="pr-row1"><span class="pr-name">${a.label}${a.symbol ? html`<small>${a.symbol}</small>` : nothing}</span>
        <span class="pr-pg">${a.page ? `p. ${at?.page ?? a.page}` : ''}</span></span>
      <span class="pr-row2"><span class="pr-v">${a.value || html`<span class="pr-note" style="padding:0">no value</span>`}</span>
        <span class="pr-mark" title=${a.agreement}>${a.mark}</span>
        ${a.status !== 'read' ? html`<span class="pr-chip">${STATUS_WORDS[a.status]}</span>` : nothing}
        ${unplaced ? html`<span class="pr-chip" data-not-located title="The page text did not show where it is printed">not located</span>` : nothing}</span>
      ${current ? html`<span class="pr-detail" data-detail>
        ${a.group ? html`<h5>Where</h5><div>${a.group}</div>` : nothing}
        ${a.conditions.length ? html`<h5>Conditions</h5><ul>${a.conditions.map(c => html`<li>${c}</li>`)}</ul>` : nothing}
        ${a.readings.length ? html`<h5>Readings</h5><ul>${a.readings.map(r => html`<li>${r.text}${r.page ? html` · <span role="link" tabindex="0" style="color:var(--pr-accent);cursor:pointer"
          @click=${(e: Event) => { e.stopPropagation(); this.goToPage(r.page!) }}>p. ${r.page}</span>` : nothing}</li>`)}</ul>` : nothing}
        ${a.notes.length ? html`<h5>Notes</h5><ul>${a.notes.map(n => html`<li>${n}</li>`)}</ul>` : nothing}
        ${unplaced ? html`<h5>Location</h5><div>Page ${a.page ?? '–'}, not located: the page text did not show where it is printed.</div>` : nothing}
        ${a.actions?.length ? html`<span class="pr-seam" data-seam="assertion-actions">${a.actions.map(x => html`<button type="button" class="pr-btn"
          @click=${(e: Event) => { e.stopPropagation(); this.say('assertion-action', { action: x.id, id: a.id }) }}>${x.label}</button>`)}</span>` : nothing}
      </span>` : nothing}
    </button>`
  }

  protected override render(): TemplateResult {
    return html`
      ${this.toolbar()}
      <div class="pr-main">
        ${this.sidePanel()}
        <div class="pr-stage" data-stage>
          <div class="pr-container" tabindex="0" role="document" aria-label=${this.name ? `PDF: ${this.name}` : 'PDF'}><div class="pdfViewer"></div></div>
          ${this.noText && this.pageCount ? html`<div class="pr-banner" role="note" data-no-text>No text layer: this PDF looks like a scan, so text cannot be searched or selected.</div>` : nothing}
          ${this.findBar()}
          ${this.cardView()}
          ${this.veil()}
        </div>
        ${this.listView()}
      </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'mn-pdf-reader': MnPdfReader }
}
