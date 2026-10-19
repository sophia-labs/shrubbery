/**
 * `<mn-reader>` — the Reader: one read-only view of an original, PDF or EPUB, in the same quiet chrome.
 *
 *   bar        sidebar · title and author | where you are (page "12 of 310", or chapter and %) | zoom or type · find ·
 *              notes · Original / Text · more (download)
 *   sidebar    Contents (the PDF's outline or the book's table of contents) · Pages (PDF thumbnails) · Notes
 *   stage      pdf.js pages on a canvas, or one chapter set as a book page (printed page numbers in the gutter)
 *   margin     each note beside its passage, never above it
 *
 * Select text and a small bar offers four highlighter colours and Note. Highlights and notes are painted with the CSS
 * Custom Highlight API over the text itself; they are asked for with events and drawn from `annotations`, which the
 * shell keeps (the document's comments): `reader-annotate` { kind, color, quote, prefix, suffix, place, text } and
 * `reader-annotation-change` { id, action: recolor | edit | delete, color?, text? }. A highlight is painted at once and
 * stays until the shell's list says otherwise.
 *
 * Other events (bubble, composed), shared with the original viewer so the shell needs nothing new:
 * `mn-editor-original-view-toggle` (the Text side of Original / Text) and `mn-original-viewer-download`.
 */
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { repeat } from 'lit/directives/repeat.js'
import { ref } from 'lit/directives/ref.js'
import { locateQuoteAnnotations, quoteSearchText, type QuoteChapterText, type QuoteSearchText } from '../source-quote-annotations.js'
import './reader-bar.js'
import { chapterAtLine, nextChapterWindow, windowAt, type ChapterWindow } from './chapter-window.js'
import type { MenuEntry, MenuSelectDetail } from '@shrubbery/nucleus'
import type { MnContextMenu } from '@shrubbery/components'
import { icon } from './reader-icons.js'
import { PdfSurface, type PdfOutlineItem, type PdfSurfaceState, type PdfZoom } from './pdf-surface.js'
import {
  READER_COLORS,
  ReaderHighlights,
  annotationRange,
  quoteTextIndex,
  rangeContainsPoint,
  selectionIn,
  selectionQuote,
  type ReaderAnnotateDetail,
  type ReaderAnnotation,
  type ReaderAnnotationChangeDetail,
  type ReaderColor,
  type ReaderPlace,
} from './reader-model.js'
import { PDF_VIEWER_STYLES, READER_BAR_STYLES, READER_STYLES, READER_TOKENS, highlightRules } from './reader-styles.js'
import type { ReaderBook, ReaderTocEntry } from './epub-book.js'

/** `reader-ask-sophia`: what a person asked Sophia about; the shell puts it in the chat. */
export interface ReaderAskDetail { readonly quote: string; readonly scope: 'passage' | 'page' | 'chapter'; readonly where: string; readonly title: string }

export type ReaderSource =
  | { readonly kind: 'pdf'; readonly key: string; readonly data: Uint8Array }
  | { readonly kind: 'epub'; readonly key: string; readonly book: ReaderBook }

const TYPE_SIZES = [0.95, 1.05, 1.125, 1.25, 1.4, 1.6] as const
const MEASURES = { narrow: '28em', medium: '34em', wide: '42em' } as const
type Measure = keyof typeof MEASURES
interface TypeSettings { size: number; face: 'serif' | 'sans'; measure: Measure; justify: boolean; layout: 'continuous' | 'chapter' }
const TYPE_KEY = 'mn-reader:v1:type'
const PANEL_KEY = 'mn-reader:v1:panels'
const bookKey = (key: string) => `mn-reader:v1:book:${key}`

function readJson<T>(key: string): T | null {
  try { const raw = globalThis.localStorage?.getItem(key); return raw ? JSON.parse(raw) as T : null } catch { return null }
}
function writeJson(key: string, value: unknown): void {
  try { globalThis.localStorage?.setItem(key, JSON.stringify(value)) } catch { /* the reader works without it */ }
}

let instances = 0

type SelectionQuote = { readonly quote: string; readonly prefix: string; readonly suffix: string; readonly place: ReaderPlace }
interface Pop { readonly x: number; readonly y: number; readonly below: boolean }
interface SelectionPop extends Pop { readonly quote: string; readonly prefix: string; readonly suffix: string; readonly place: ReaderPlace }
interface Composer extends Pop {
  readonly quote: string; readonly prefix: string; readonly suffix: string; readonly place: ReaderPlace
  readonly color: ReaderColor; readonly editing: string | null; readonly draft: string
}

@customElement('mn-reader')
export class MnReader extends LitElement {
  static override styles = [PDF_VIEWER_STYLES, READER_TOKENS, READER_BAR_STYLES, READER_STYLES]

  @property({ attribute: false }) source: ReaderSource | null = null
  @property({ type: String }) override title = ''
  @property({ type: String }) author = ''
  @property({ type: String }) status: 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'unavailable' = 'idle'
  @property({ type: String }) error = ''
  @property({ attribute: false }) annotations: readonly ReaderAnnotation[] = []
  /** May this person highlight and write notes here (the shell can save them)? */
  @property({ type: Boolean, attribute: 'can-annotate' }) canAnnotate = false
  /** Why not, when not. */
  @property({ type: String, attribute: 'annotate-note' }) annotateNote = ''
  /** A Text view exists (the document made from this original). */
  @property({ type: Boolean, attribute: 'text-view' }) textView = false
  @property({ type: Boolean }) downloadable = false

  @state() private sidebar = false
  @state() private tab: 'contents' | 'pages' | 'notes' = 'contents'
  @state() private margin = true
  @state() private menu: 'type' | 'fit' | null = null
  @state() private findOpen = false
  @state() private findQuery = ''
  @state() private pdfState: PdfSurfaceState | null = null
  @state() private chapter = 0
  /** The chapters in the page: one in By chapter, a few around the reading line in Continuous. */
  @state() private win: ChapterWindow = { first: 0, last: 0 }
  @state() private progress = 0
  @state() private type: TypeSettings = { size: 2, face: 'serif', measure: 'medium', justify: true, layout: 'continuous', ...readJson<Partial<TypeSettings>>(TYPE_KEY) }
  @state() private pop: SelectionPop | null = null
  @state() private composer: Composer | null = null
  @state() private active: string | null = null
  @state() private activePop: (Pop & { readonly id: string }) | null = null
  @state() private notePlaces: ReadonlyMap<string, number> = new Map()
  @state() private bookFind: { readonly results: readonly { chapter: number; nth: number }[]; readonly current: number } | null = null
  @state() private failure = ''
  @state() private pending: readonly ReaderAnnotation[] = []
  /** Narrower than a page and a margin: the sidebar and the margin open over the page, only when asked for. */
  @state() private narrow = false
  @state() private overlay: 'sidebar' | 'margin' | null = null
  /** The margin was opened by hand: shown even before there is a note in it. */
  @state() private marginAsked = false
  private sizer: ResizeObserver | null = null

  private readonly highlights = new ReaderHighlights(`rd${++instances}`)
  private readonly highlightSheet = typeof CSSStyleSheet === 'function' ? new CSSStyleSheet() : null
  private surface: PdfSurface | null = null
  private openedKey = ''
  /** PDF: the page of each annotation; ranges per rendered page. EPUB: ranges in the open chapter. */
  private pdfPages = new Map<string, number>()
  private pdfRanges = new Map<number, Map<string, Range>>()
  private bookRanges = new Map<string, Range>()
  private chapterTexts = new Map<number, QuoteSearchText>()
  private bookChapterOf = new Map<string, number>()
  private placeFrame = 0
  private memoryTimer = 0
  private pendingSeq = 0
  private thumbsDrawn = new Set<number>()

  constructor() {
    super()
    const panels = readJson<{ sidebar?: boolean; margin?: boolean }>(PANEL_KEY)
    if (typeof panels?.sidebar === 'boolean') this.sidebar = panels.sidebar
    if (typeof panels?.margin === 'boolean') this.margin = panels.margin
  }

  override connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('keydown', this.onKey)
    document.addEventListener('selectionchange', this.onSelectionChange)
    this.sizer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0
      const narrow = width > 0 && width < 900
      if (narrow !== this.narrow) { this.narrow = narrow; this.overlay = null; this.toggleAttribute('data-narrow', narrow) }
    })
    this.sizer.observe(this)
  }

  override disconnectedCallback(): void {
    this.removeEventListener('keydown', this.onKey)
    document.removeEventListener('selectionchange', this.onSelectionChange)
    window.clearTimeout(this.settleTimer)
    this.sizer?.disconnect()
    this.sizer = null
    this.surface?.close()
    this.surface = null
    this.openedKey = ''
    this.highlights.clear()
    cancelAnimationFrame(this.placeFrame)
    super.disconnectedCallback()
  }

  protected override firstUpdated(): void {
    if (this.highlightSheet && this.shadowRoot) {
      this.highlightSheet.replaceSync(highlightRules(this.highlights.prefix))
      this.shadowRoot.adoptedStyleSheets = [...this.shadowRoot.adoptedStyleSheets, this.highlightSheet]
    }
  }

  // --- what is drawn ------------------------------------------------------------------------------------------------------

  private get shown(): readonly ReaderAnnotation[] {
    return this.pending.length ? [...this.annotations, ...this.pending] : this.annotations
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('source')) {
      const kind = this.source?.kind ?? ''
      if (kind) this.setAttribute('data-kind', kind); else this.removeAttribute('data-kind')
    }
    if (changed.has('annotations') && this.pending.length) {
      // A highlight asked for stays painted until the shell's list carries it.
      const key = (a: ReaderAnnotation) => `${a.kind}\u0000${a.quote.replace(/\s+/g, ' ').trim()}`
      const saved = new Set(this.annotations.map(key))
      this.pending = this.pending.filter(a => !saved.has(key(a)))
    }
    this.setAttribute('data-justify', this.type.justify ? 'on' : 'off')
    this.style.setProperty('--rd-type-size', `${TYPE_SIZES[this.type.size] ?? 1.125}rem`)
    this.style.setProperty('--rd-measure', MEASURES[this.type.measure])
    this.style.setProperty('--rd-face', this.type.face === 'sans' ? 'var(--mn-font-sans, system-ui, sans-serif)' : 'var(--mn-font-prose, Georgia, serif)')
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has('source')) void this.openSource()
    this.announceMeta()
    if (changed.has('annotations') || changed.has('pending')) void this.placeAnnotations()
    if (changed.has('win') && this.source?.kind === 'epub') this.afterWindow()
    if (changed.has('type') && this.source?.kind === 'epub' && this.typeAnchor) this.afterType()
    if (changed.has('notePlaces')) this.queuePlaceNotes()
    if (changed.has('sidebar') || changed.has('margin') || changed.has('type') || changed.has('overlay') || changed.has('narrow')) this.queuePlaceNotes()
  }

  private metaSaid = ''
  /** Tell the shell the work's own title and author, once they are known: the Text view's bar says the same words. */
  private announceMeta(): void {
    const source = this.source
    if (!source) return
    const book = source.kind === 'epub' ? source.book : null
    const title = this.displayTitle(book)
    const author = this.displayAuthor(book)
    const said = `${source.key}\u0000${title}\u0000${author}`
    if (said === this.metaSaid || title === 'Original') return
    this.metaSaid = said
    this.say('reader-meta', { title, author })
  }

  private async openSource(): Promise<void> {
    const source = this.source
    const key = source ? `${source.kind}:${source.key}` : ''
    if (key === this.openedKey) return
    this.openedKey = key
    this.surface?.close()
    this.surface = null
    this.pdfState = null
    this.failure = ''
    this.pdfPages.clear(); this.pdfRanges.clear(); this.bookRanges.clear(); this.chapterTexts.clear(); this.bookChapterOf.clear()
    this.thumbsDrawn.clear()
    this.highlights.clear()
    this.pop = null; this.composer = null; this.active = null; this.activePop = null; this.bookFind = null
    if (!source) return
    if (source.kind === 'pdf') {
      await this.updateComplete
      const container = this.renderRoot.querySelector<HTMLElement>('.pdf')
      const viewer = this.renderRoot.querySelector<HTMLElement>('.pdfViewer')
      if (!container || !viewer) return
      const surface = new PdfSurface({
        changed: state => { if (this.surface === surface) { this.pdfState = state; this.queuePlaceNotes() } },
        textLayerRendered: page => { if (this.surface === surface) this.pageReady(page) },
        failed: message => { if (this.surface === surface) this.failure = message },
      }, source.key)
      this.surface = surface
      container.addEventListener('scroll', this.onScroll, { passive: true })
      await surface.open(source.data, container, viewer)
      void this.placeAnnotations()
    } else {
      const memory = readJson<{ chapter?: number; fraction?: number }>(bookKey(source.key))
      const count = source.book.chapters.length
      const start = Math.max(0, Math.min(count - 1, Math.floor(memory?.chapter ?? this.firstReadableChapter(source.book))))
      this.chapter = start
      this.win = windowAt(start, count)
      await this.updateComplete
      const scroller = this.scroller()
      if (scroller) {
        scroller.addEventListener('scroll', this.onScroll, { passive: true })
        this.placeAt(start, memory?.fraction ?? 0)
      }
      this.syncBook()
    }
  }

  /** Skip a Gutenberg licence-and-cover front matter when nothing is remembered: the first chapter with real prose. */
  private firstReadableChapter(book: ReaderBook): number {
    const index = book.chapters.findIndex(chapter => chapter.wordCount >= 120 && !/project gutenberg/i.test(chapter.title))
    return index >= 0 ? index : 0
  }

  // --- annotations --------------------------------------------------------------------------------------------------------

  private async placeAnnotations(): Promise<void> {
    const source = this.source
    if (!source) return
    const all = this.shown
    if (source.kind === 'pdf') {
      const surface = this.surface
      if (!surface?.current.ready && !surface?.current.pageCount) return
      this.pdfPages = new Map(await surface.placeAnnotations(all))
      if (this.surface !== surface) return
      this.pdfRanges.clear()
      for (let n = 1; n <= surface.current.pageCount; n++) if (surface.pageElement(n)?.querySelector('.textLayer')) this.pageReady(n, false)
      this.paint()
    } else {
      this.locateInBook(source.book, all)
      this.rangeChapters()
      this.paint()
    }
  }

  private pageReady(page: number, repaint = true): void {
    const surface = this.surface
    if (!surface) return
    const here = this.shown.filter(a => this.pdfPages.get(a.id) === page)
    this.pdfRanges.set(page, surface.rangesOnPage(page, here))
    if (this.findOpen && this.findQuery) { /* pdf.js paints its own find matches */ }
    if (repaint) this.paint()
  }

  private chapterText(book: ReaderBook, index: number): QuoteSearchText {
    let text = this.chapterTexts.get(index)
    if (!text) {
      const doc = new DOMParser().parseFromString(`<body>${book.chapters[index]?.html ?? ''}</body>`, 'text/html')
      text = quoteSearchText(doc.body)
      this.chapterTexts.set(index, text)
    }
    return text
  }

  /** Which chapter each annotation is in: its own place first, else the first chapter holding its words (tolerantly). */
  private locateInBook(book: ReaderBook, all: readonly ReaderAnnotation[]): void {
    const unplaced = all.filter(annotation => !this.bookChapterOf.has(annotation.id))
    if (!unplaced.length) return
    const hinted: ReaderAnnotation[] = []
    const rest: ReaderAnnotation[] = []
    for (const annotation of unplaced) {
      const hint = annotation.place?.kind === 'chapter' ? annotation.place.chapterIndex : -1
      if (hint >= 0 && hint < book.chapters.length && locateQuoteAnnotations([{ id: String(hint), ...this.chapterText(book, hint) }], [annotation]).get(annotation.id)) {
        this.bookChapterOf.set(annotation.id, hint)
        hinted.push(annotation)
      } else rest.push(annotation)
    }
    if (!rest.length) return
    const chapters: QuoteChapterText[] = book.chapters.map((_, index) => ({ id: String(index), ...this.chapterText(book, index) }))
    for (const [id, chapter] of locateQuoteAnnotations(chapters, rest)) if (chapter !== null) this.bookChapterOf.set(id, Number(chapter))
  }

  private chapterEls(): HTMLElement[] { return Array.from(this.renderRoot.querySelectorAll<HTMLElement>('article.chapter[data-chapter]')) }
  private scroller(): HTMLElement | null { return this.renderRoot.querySelector<HTMLElement>('.book') }
  private get continuous(): boolean { return this.source?.kind === 'epub' && this.type.layout !== 'chapter' }
  private isRendered(chapter: number): boolean { return chapter >= this.win.first && chapter <= this.win.last }

  /** Ranges for every annotation in the chapters now in the page. */
  private rangeChapters(): void {
    this.bookRanges.clear()
    for (const root of this.chapterEls()) {
      const chapter = Number(root.dataset.chapter)
      const here = this.shown.filter(a => this.bookChapterOf.get(a.id) === chapter)
      if (!here.length) continue
      const index = quoteTextIndex(root)
      for (const annotation of here) {
        const range = annotationRange(index, annotation)
        if (range) this.bookRanges.set(annotation.id, range)
      }
    }
  }

  private rangeOf(id: string): Range | null {
    if (this.source?.kind === 'epub') return this.bookRanges.get(id) ?? null
    for (const ranges of this.pdfRanges.values()) { const range = ranges.get(id); if (range) return range }
    return null
  }

  private allRanges(): Map<string, Range> {
    if (this.source?.kind === 'epub') return this.bookRanges
    const all = new Map<string, Range>()
    for (const ranges of this.pdfRanges.values()) for (const [id, range] of ranges) all.set(id, range)
    return all
  }

  private paint(): void {
    const ranges = this.allRanges()
    const byColor = new Map<string, Range[]>(READER_COLORS.map(color => [color, []]))
    const notes: Range[] = []
    for (const annotation of this.shown) {
      const range = ranges.get(annotation.id)
      if (!range) continue
      // A person's highlight or note is a colour; an agent's finding is underlined, so a page of findings stays readable.
      if (annotation.mine || annotation.kind === 'highlight') byColor.get(annotation.color)?.push(range)
      if (annotation.kind === 'comment') notes.push(range)
    }
    for (const [color, list] of byColor) this.highlights.paint(color, list)
    this.highlights.paint('note', notes)
    const active = this.active ? ranges.get(this.active) : null
    this.highlights.paint('active', active ? [active] : [])
    this.queuePlaceNotes()
  }

  /** Each note beside its passage: wanted at the passage's top, pushed down past the one above, never above its passage. */
  private queuePlaceNotes(): void {
    cancelAnimationFrame(this.placeFrame)
    this.placeFrame = requestAnimationFrame(() => this.placeNotes())
  }

  private placeNotes(): void {
    const margin = this.renderRoot.querySelector<HTMLElement>('.margin')
    if (!margin || !this.marginShown) return
    const top = margin.getBoundingClientRect().top
    const height = margin.clientHeight
    const ranges = this.allRanges()
    const wanted: { id: string; y: number }[] = []
    for (const annotation of this.shown) {
      if (annotation.kind !== 'comment') continue
      const range = ranges.get(annotation.id)
      if (!range) continue
      const rect = range.getBoundingClientRect()
      if (rect.height === 0 && rect.width === 0) continue
      wanted.push({ id: annotation.id, y: rect.top - top })
    }
    wanted.sort((a, b) => a.y - b.y)
    const places = new Map<string, number>()
    let floor = -Infinity
    for (const item of wanted) {
      const el = margin.querySelector<HTMLElement>(`[data-note="${CSS.escape(item.id)}"]`)
      const h = el && el.offsetHeight > 0 ? el.offsetHeight : 72
      const y = Math.max(item.y, floor)
      floor = y + h + 8
      if (y + h < -40 || y > height + 40) continue
      places.set(item.id, y)
    }
    const same = places.size === this.notePlaces.size && [...places].every(([id, y]) => Math.abs((this.notePlaces.get(id) ?? NaN) - y) < 0.5)
    if (!same) this.notePlaces = places
  }

  private readonly onScroll = (): void => {
    this.queuePlaceNotes()
    if (this.pop) this.pop = null
    if (this.activePop) this.activePop = null
    if (this.source?.kind === 'epub') this.trackBookProgress()
  }

  // --- EPUB ---------------------------------------------------------------------------------------------------------------

  private scrollAfterWin: (() => void) | null = null
  private winAnchor: { readonly chapter: number; readonly offset: number } | null = null
  private typeAnchor: { readonly chapter: number; readonly offset: number } | null = null
  private bookFrame = 0

  /** The chapter at the top of the page and how far down the page it starts, to keep it still while things change above it. */
  private captureAnchor(): { chapter: number; offset: number } | null {
    const scroller = this.scroller()
    if (!scroller) return null
    const top = scroller.getBoundingClientRect().top
    for (const el of this.chapterEls()) {
      const rect = el.getBoundingClientRect()
      if (rect.bottom > top + 1) return { chapter: Number(el.dataset.chapter), offset: rect.top - top }
    }
    return null
  }

  private restoreAnchor(anchor: { chapter: number; offset: number } | null): void {
    const scroller = this.scroller()
    if (!scroller || !anchor) return
    const el = this.chapterEls().find(e => Number(e.dataset.chapter) === anchor.chapter)
    if (!el) return
    scroller.scrollTop += (el.getBoundingClientRect().top - scroller.getBoundingClientRect().top) - anchor.offset
  }

  /** Scroll so `fraction` of the way through `chapter` is at the top. */
  private placeAt(chapter: number, fraction: number): void {
    const scroller = this.scroller()
    const el = this.chapterEls().find(e => Number(e.dataset.chapter) === chapter)
    if (!scroller || !el) return
    const rect = el.getBoundingClientRect()
    const span = Math.max(0, rect.height - scroller.clientHeight)
    scroller.scrollTop += (rect.top - scroller.getBoundingClientRect().top) + Math.max(0, Math.min(1, fraction)) * span
  }

  /** Where the page is read from: the chapter at the reading line, and how far through it the top of the page is. */
  private bookPlace(): { chapter: number; fraction: number } | null {
    const scroller = this.scroller()
    const els = this.chapterEls()
    if (!scroller || !els.length) return null
    const top = scroller.getBoundingClientRect().top
    const first = els[0]!.getBoundingClientRect().top
    const heights = els.map(el => el.getBoundingClientRect().height)
    const chapter = chapterAtLine(this.win, heights, top + Math.min(120, scroller.clientHeight / 4) - first)
    const el = els.find(e => Number(e.dataset.chapter) === chapter) ?? els[0]!
    const rect = el.getBoundingClientRect()
    const fraction = Math.max(0, Math.min(1, (top - rect.top) / Math.max(1, rect.height - scroller.clientHeight)))
    return { chapter, fraction }
  }

  /** The window changed: range the annotations in what is now in the page, keep the reading place, go on growing. */
  private afterWindow(): void {
    this.rangeChapters()
    this.paint()
    if (this.bookFind) this.paintBookFind(false)
    const pending = this.scrollAfterWin
    this.scrollAfterWin = null
    const anchor = this.winAnchor
    this.winAnchor = null
    if (pending) pending()
    else if (anchor) this.restoreAnchor(anchor)
    else if (!this.continuous) { const scroller = this.scroller(); if (scroller) scroller.scrollTop = 0 }
    cancelAnimationFrame(this.bookFrame)
    this.bookFrame = requestAnimationFrame(() => this.syncBook())
  }

  private afterType(): void {
    const anchor = this.typeAnchor
    this.typeAnchor = null
    requestAnimationFrame(() => { this.restoreAnchor(anchor); this.queuePlaceNotes(); this.syncBook() })
  }

  /**
   * Ask for the chapter. Continuous: it is put in the page (with its neighbours as they are reached) and scrolled to
   * (`align`: its top, or the `anchor` within it); By chapter: it replaces the page. `then` runs once it is there.
   */
  private goChapter(index: number, anchor: string | null = null, then?: () => void, align = true): void {
    const book = this.source?.kind === 'epub' ? this.source.book : null
    if (!book || index < 0 || index >= book.chapters.length) return
    const scrollTo = () => {
      if (anchor) this.renderRoot.querySelector<HTMLElement>(`#${CSS.escape(anchor)}`)?.scrollIntoView({ block: 'start' })
      else if (align) this.placeAt(index, 0)
      then?.()
    }
    this.pop = null; this.activePop = null; this.active = null
    if (this.isRendered(index) && (this.continuous || index === this.chapter)) { scrollTo(); if (this.continuous) this.syncBook(); return }
    this.scrollAfterWin = scrollTo
    this.chapter = index
    this.win = windowAt(index, book.chapters.length)
  }

  private syncBook(): void {
    const book = this.source?.kind === 'epub' ? this.source.book : null
    const scroller = this.scroller()
    const place = this.bookPlace()
    if (!book || !scroller || !place) return
    if (place.chapter !== this.chapter) this.chapter = place.chapter
    const total = book.chapters.reduce((sum, chapter) => sum + Math.max(1, chapter.wordCount), 0)
    const before = book.chapters.slice(0, place.chapter).reduce((sum, chapter) => sum + Math.max(1, chapter.wordCount), 0)
    const here = Math.max(1, book.chapters[place.chapter]?.wordCount ?? 1)
    this.progress = (before + place.fraction * here) / total
    window.clearTimeout(this.memoryTimer)
    const key = this.source?.key ?? ''
    this.memoryTimer = window.setTimeout(() => writeJson(bookKey(key), place), 300)
    if (!this.continuous) return
    const els = this.chapterEls()
    if (!els.length) return
    const first = els[0]!.getBoundingClientRect().top
    const next = nextChapterWindow({
      count: book.chapters.length,
      current: this.win,
      heights: els.map(el => el.getBoundingClientRect().height),
      scrollTop: scroller.getBoundingClientRect().top - first,
      viewport: scroller.clientHeight,
    })
    if (next.first !== this.win.first || next.last !== this.win.last) {
      this.winAnchor = this.captureAnchor()
      this.win = next
    }
  }

  private trackBookProgress(): void {
    cancelAnimationFrame(this.bookFrame)
    this.bookFrame = requestAnimationFrame(() => this.syncBook())
  }

  private onBookClick(event: MouseEvent): void {
    const link = (event.target as Element | null)?.closest?.('a')
    if (!link) return
    if (link.hasAttribute('data-rd-external')) {
      event.preventDefault()
      const href = link.getAttribute('href') ?? ''
      if (/^(https?:|mailto:)/i.test(href)) globalThis.open?.(href, '_blank', 'noopener,noreferrer')
      return
    }
    const chapter = link.getAttribute('data-rd-chapter')
    if (chapter !== null) {
      event.preventDefault()
      this.goChapter(Number(chapter), link.getAttribute('data-rd-anchor') || null)
    }
  }

  // --- selection, highlight, note -----------------------------------------------------------------------------------------

  /** How the last press on the stage was made: a touch selection ends without a pointerup, so it is read as it settles. */
  private lastPointer = 'mouse'
  private settleTimer = 0

  private readonly onSelectionChange = (): void => {
    if (this.composer) return
    const root = this.shadowRoot
    if (!root) return
    const range = selectionIn(root)
    window.clearTimeout(this.settleTimer)
    if (!range) { if (this.pop) this.pop = null; return }
    if (this.lastPointer === 'touch') this.settleTimer = window.setTimeout(() => this.selectionPop(), 350)
  }

  /** What is selected in the page: its words with context, where it is, and where it is on the screen. */
  private readSelection(): (SelectionQuote & { readonly rect: DOMRect }) | null {
    const root = this.shadowRoot
    if (!root) return null
    const range = selectionIn(root)
    if (!range) return null
    const place = this.placeOf(range.startContainer)
    const scope = this.scopeOf(range.startContainer)
    if (!place || !scope) return null
    // A selection may run on into the next chapter: the note is made on the part in the first.
    let within = range
    if (!scope.contains(range.endContainer)) { within = range.cloneRange(); within.setEnd(scope, scope.childNodes.length) }
    const quoted = selectionQuote(scope, within)
    if (!quoted) return null
    return { ...quoted, place, rect: within.getBoundingClientRect() }
  }

  private selectionPop(): void {
    const stage = this.renderRoot.querySelector<HTMLElement>('.stage')
    if (!stage) return
    const found = this.readSelection()
    if (!found) { this.pop = null; return }
    const { rect, ...quoted } = found
    const s = stage.getBoundingClientRect()
    const x = Math.max(120, Math.min(s.width - 120, rect.left + rect.width / 2 - s.left))
    const below = rect.top - s.top < 64
    const y = below ? rect.bottom - s.top : rect.top - s.top
    this.activePop = null
    this.pop = { x, y, below, ...quoted }
  }

  private placeOf(node: Node): ReaderPlace | null {
    const element = node instanceof Element ? node : node.parentElement
    if (this.source?.kind === 'epub') { const chapter = element?.closest<HTMLElement>('.chapter'); return chapter ? { kind: 'chapter', chapterIndex: Number(chapter.dataset.chapter) } : null }
    const page = element?.closest<HTMLElement>('.page')
    const n = Number(page?.dataset.pageNumber)
    return page && element?.closest('.textLayer') && n >= 1 ? { kind: 'page', page: n } : null
  }

  private scopeOf(node: Node): Element | null {
    const element = node instanceof Element ? node : node.parentElement
    return this.source?.kind === 'epub' ? element?.closest('.chapter') ?? null : element?.closest('.textLayer') ?? null
  }

  private clearSelection(): void {
    const root = this.shadowRoot as (ShadowRoot & { getSelection?: () => Selection | null }) | null
    ;(root?.getSelection?.() ?? document.getSelection())?.removeAllRanges()
  }

  private highlight(color: ReaderColor, from: SelectionQuote | null = this.pop): void {
    const pop = from
    if (!pop || !this.canAnnotate) return
    const detail: ReaderAnnotateDetail = { kind: 'highlight', color, quote: pop.quote, prefix: pop.prefix, suffix: pop.suffix, place: pop.place, text: '' }
    this.say('reader-annotate', detail)
    this.pending = [...this.pending, { id: `pending-${++this.pendingSeq}`, kind: 'highlight', color, quote: pop.quote, prefix: pop.prefix, suffix: pop.suffix, place: pop.place, mine: true }]
    this.pop = null
    this.clearSelection()
  }

  private openComposer(from: Pop & { quote: string; prefix: string; suffix: string; place: ReaderPlace }, color: ReaderColor, editing: string | null, draft: string): void {
    this.composer = { x: from.x, y: from.y, below: from.below, quote: from.quote, prefix: from.prefix, suffix: from.suffix, place: from.place, color, editing, draft }
    this.pop = null
    this.activePop = null
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus())
  }

  private saveComposer(): void {
    const c = this.composer
    if (!c) return
    const text = c.draft.trim()
    if (c.editing) {
      if (text) this.say('reader-annotation-change', { id: c.editing, action: 'edit', text } satisfies ReaderAnnotationChangeDetail)
    } else if (text) {
      this.say('reader-annotate', { kind: 'comment', color: c.color, quote: c.quote, prefix: c.prefix, suffix: c.suffix, place: c.place, text } satisfies ReaderAnnotateDetail)
      this.pending = [...this.pending, { id: `pending-${++this.pendingSeq}`, kind: 'comment', color: c.color, quote: c.quote, prefix: c.prefix, suffix: c.suffix, place: c.place, text, author: 'You', mine: true }]
    }
    this.composer = null
    this.clearSelection()
  }

  // --- the contextual menu ------------------------------------------------------------------------------------------------

  private onStageContextMenu(event: MouseEvent): void {
    if (!this.source) return
    event.preventDefault()
    // A long press on a touch screen selects a word and asks for this menu: the selection bar is what a finger wants.
    if (this.lastPointer === 'touch') { this.selectionPop(); return }
    const found = this.readSelection()
    const sel: SelectionQuote | null = found ? { quote: found.quote, prefix: found.prefix, suffix: found.suffix, place: found.place } : null
    this.pop = null; this.activePop = null
    const stage = this.renderRoot.querySelector<HTMLElement>('.stage')
    const box = stage?.getBoundingClientRect()
    const menu = this.renderRoot.querySelector<MnContextMenu>('mn-context-menu.ctx')
    if (!menu) return
    this.ctx = { sel, x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
    menu.items = this.contextEntries(sel)
    menu.show({ x: event.clientX, y: event.clientY })
  }

  private ctx: { readonly sel: SelectionQuote | null; readonly x: number; readonly y: number } | null = null

  private get hereLabel(): 'page' | 'chapter' { return this.source?.kind === 'pdf' ? 'page' : 'chapter' }

  private contextEntries(sel: SelectionQuote | null): MenuEntry[] {
    const off = !this.canAnnotate
    if (sel) {
      return [
        { id: 'copy', label: 'Copy', icon: 'copy' },
        { type: 'divider' },
        ...READER_COLORS.map(color => ({ id: `highlight-${color}`, label: `Highlight ${color}`, icon: 'highlighter', disabled: off })),
        { id: 'note', label: 'Add note', icon: 'message-square', disabled: off },
        { type: 'divider' },
        { id: 'ask', label: 'Ask Sophia about this passage', icon: 'bot' },
        { id: 'find', label: 'Find in this document', icon: 'search' },
      ]
    }
    return [
      { id: 'ask', label: `Ask Sophia about this ${this.hereLabel}`, icon: 'bot' },
      { id: 'find', label: 'Find…', icon: 'search', shortcut: '⌘F' },
      { id: 'contents', label: 'Contents', icon: 'list' },
      { type: 'divider' },
      { id: 'download', label: 'Download original', icon: 'download', disabled: !this.downloadable },
    ]
  }

  private onContextSelect(event: CustomEvent<MenuSelectDetail>): void {
    event.stopPropagation()
    const id = event.detail.id
    const { sel, x, y } = this.ctx ?? { sel: null, x: 0, y: 0 }
    if (id === 'copy' && sel) void navigator.clipboard?.writeText(sel.quote)
    else if (id.startsWith('highlight-') && sel) this.highlight(id.slice(10) as ReaderColor, sel)
    else if (id === 'note' && sel) this.openComposer({ x, y, below: y < 200, ...sel }, 'yellow', null, '')
    else if (id === 'ask') this.askSophia(sel)
    else if (id === 'find') {
      if (sel) this.findQuery = sel.quote.slice(0, 120)
      this.openFind()
      if (sel) void this.updateComplete.then(() => this.runFind(false))
    } else if (id === 'contents') {
      this.tab = 'contents'
      if (!this.sidebarShown) this.togglePanel('sidebar')
    } else if (id === 'download') this.say('mn-original-viewer-download', {})
  }

  /** The passage (or the page or chapter in view) goes to the Sophia chat: the shell writes it into the composer. */
  private askSophia(sel: SelectionQuote | null): void {
    const book = this.source?.kind === 'epub' ? this.source.book : null
    const where = this.source?.kind === 'pdf'
      ? `page ${this.pdfState?.pageLabel ?? this.pdfState?.page ?? 1}`
      : `${book?.chapters[this.chapter]?.title ?? 'this chapter'}`
    this.say('reader-ask-sophia', { quote: sel?.quote ?? '', scope: sel ? 'passage' : this.hereLabel, where, title: this.displayTitle(book) } satisfies ReaderAskDetail)
  }

  private onStagePointerUp(event?: PointerEvent): void {
    if (event && event.button !== 0) return
    // Let the selection settle (a double-click's word, a drag's end) before asking for it.
    requestAnimationFrame(() => this.selectionPop())
  }

  private onStageClick(event: MouseEvent): void {
    if (this.source?.kind === 'epub') this.onBookClick(event)
    if (event.defaultPrevented) return
    const root = this.shadowRoot
    if (root && selectionIn(root)) return
    const ranges = this.allRanges()
    let hit: string | null = null
    for (const annotation of this.shown) {
      const range = ranges.get(annotation.id)
      if (range && rangeContainsPoint(range, event.clientX, event.clientY)) { hit = annotation.id; break }
    }
    if (!hit) { if (this.active || this.activePop) { this.active = null; this.activePop = null; this.paint() } return }
    this.showAnnotation(hit, ranges.get(hit)!)
  }

  private showAnnotation(id: string, range: Range): void {
    const stage = this.renderRoot.querySelector<HTMLElement>('.stage')
    if (!stage) return
    const rect = range.getBoundingClientRect()
    const s = stage.getBoundingClientRect()
    const below = rect.top - s.top < 64
    this.active = id
    this.activePop = { id, x: Math.max(140, Math.min(s.width - 140, rect.left + rect.width / 2 - s.left)), y: below ? rect.bottom - s.top : rect.top - s.top, below }
    this.pop = null
    this.paint()
  }

  /** Go to an annotation from the Notes list or the margin. */
  private reveal(annotation: ReaderAnnotation): void {
    const show = () => {
      const range = this.rangeOf(annotation.id)
      if (!range) return
      const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
      start?.scrollIntoView({ block: 'center' })
      requestAnimationFrame(() => this.showAnnotation(annotation.id, range))
    }
    if (this.source?.kind === 'epub') {
      const chapter = this.bookChapterOf.get(annotation.id)
      if (chapter === undefined) return
      if (this.isRendered(chapter)) show(); else this.goChapter(chapter, null, show, false)
    } else {
      const page = this.pdfPages.get(annotation.id)
      if (!page) return
      if (this.rangeOf(annotation.id)) { show(); return }
      this.surface?.goToPage(page)
      window.setTimeout(show, 450)
    }
  }

  private change(detail: ReaderAnnotationChangeDetail): void {
    this.say('reader-annotation-change', detail)
    if (detail.action === 'delete') { this.active = null; this.activePop = null }
  }

  // --- find ---------------------------------------------------------------------------------------------------------------

  private openFind(): void {
    this.findOpen = true
    void this.updateComplete.then(() => { const input = this.renderRoot.querySelector<HTMLInputElement>('.find input'); input?.focus(); input?.select() })
  }

  private closeFind(): void {
    this.findOpen = false
    this.surface?.closeFind()
    this.bookFind = null
    this.highlights.paint('find', [])
    this.highlights.paint('find-current', [])
  }

  private runFind(again: boolean, previous = false): void {
    const query = this.findQuery.trim()
    if (this.source?.kind === 'pdf') { this.surface?.find(query, again, previous); return }
    const book = this.source?.kind === 'epub' ? this.source.book : null
    if (!book) return
    if (!query) { this.bookFind = null; this.highlights.paint('find', []); this.highlights.paint('find-current', []); return }
    if (!again || !this.bookFind) {
      const folded = query.replace(/\s+/g, ' ').toLowerCase()
      const results: { chapter: number; nth: number }[] = []
      book.chapters.forEach((_, index) => {
        const text = this.chapterText(book, index).folded
        let at = text.indexOf(folded), nth = 0
        while (at >= 0 && results.length < 2000) { results.push({ chapter: index, nth: nth++ }); at = text.indexOf(folded, at + folded.length) }
      })
      const first = Math.max(0, results.findIndex(r => r.chapter >= this.chapter))
      this.bookFind = { results, current: results.length ? first : -1 }
    } else {
      const n = this.bookFind.results.length
      if (!n) return
      this.bookFind = { ...this.bookFind, current: (this.bookFind.current + (previous ? n - 1 : 1)) % n }
    }
    const hit = this.bookFind.results[this.bookFind.current]
    if (hit) this.goChapter(hit.chapter, null, () => this.paintBookFind(), false)
    else this.paintBookFind()
  }

  private paintBookFind(scroll = true): void {
    const found = this.bookFind
    if (!found) return
    const query = this.findQuery.trim().replace(/\s+/g, ' ').toLowerCase()
    const ranges: Range[] = []
    const byChapter = new Map<number, Range[]>()
    for (const root of this.chapterEls()) {
      const chapter = Number(root.dataset.chapter)
      const index = quoteTextIndex(root)
      const list: Range[] = []
      let at = index.folded.indexOf(query)
      while (at >= 0 && query) {
        const range = annotationRange(index, { id: 'find', kind: 'highlight', color: 'yellow', quote: index.text.slice(at, at + query.length) })
        if (range) list.push(range)
        at = index.folded.indexOf(query, at + query.length)
      }
      byChapter.set(chapter, list)
      ranges.push(...list)
    }
    const hit = found.results[found.current]
    const current = hit ? byChapter.get(hit.chapter)?.[hit.nth] : undefined
    this.highlights.paint('find', ranges)
    this.highlights.paint('find-current', current ? [current] : [])
    if (scroll) current?.startContainer.parentElement?.scrollIntoView({ block: 'center' })
  }

  // --- keys ---------------------------------------------------------------------------------------------------------------

  private readonly onKey = (event: KeyboardEvent): void => {
    const path = event.composedPath()
    const target = path[0] as HTMLElement
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
    const mod = event.metaKey || event.ctrlKey
    if (mod && (event.key === 'f' || event.key === 'F')) { event.preventDefault(); this.openFind(); return }
    if (event.key === 'Escape') {
      if (this.composer) { this.composer = null; event.preventDefault(); return }
      if (this.menu) { this.menu = null; event.preventDefault(); return }
      if (this.pop || this.activePop) { this.pop = null; this.activePop = null; this.active = null; this.paint(); event.preventDefault(); return }
      if (this.findOpen) { this.closeFind(); event.preventDefault(); return }
      return
    }
    if (typing) return
    if (mod && (event.key === '+' || event.key === '=')) { event.preventDefault(); this.bigger(1); return }
    if (mod && (event.key === '-' || event.key === '_')) { event.preventDefault(); this.bigger(-1); return }
    if (mod && event.key === '0') { event.preventDefault(); if (this.source?.kind === 'pdf') this.surface?.setZoom('auto'); else this.setType({ size: 2 }); return }
    if (mod || event.altKey) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const step = event.key === 'ArrowRight' ? 1 : -1
      event.preventDefault()
      if (this.source?.kind === 'pdf') this.surface?.goToPage((this.pdfState?.page ?? 1) + step)
      else this.goChapter(this.chapter + step)
    }
  }

  private bigger(step: number): void {
    if (this.source?.kind === 'pdf') this.surface?.zoomBy(step > 0 ? 1.15 : 1 / 1.15)
    else this.setType({ size: Math.max(0, Math.min(TYPE_SIZES.length - 1, this.type.size + step)) })
  }

  private setType(patch: Partial<TypeSettings>): void {
    if (this.source?.kind === 'epub') {
      if (patch.layout && patch.layout !== this.type.layout) {
        // Another layout: the same place in the book, in the other arrangement.
        const place = this.bookPlace()
        if (place) {
          this.scrollAfterWin = () => this.placeAt(place.chapter, place.fraction)
          this.chapter = place.chapter
          this.win = windowAt(place.chapter, this.source.book.chapters.length)
        }
      } else this.typeAnchor = this.captureAnchor()
    }
    this.type = { ...this.type, ...patch }
    writeJson(TYPE_KEY, this.type)
    this.queuePlaceNotes()
  }

  private get sidebarShown(): boolean { return this.narrow ? this.overlay === 'sidebar' : this.sidebar }
  private get marginShown(): boolean {
    if (this.narrow) return this.overlay === 'margin'
    return this.margin && (this.marginAsked || this.shown.some(a => a.kind === 'comment'))
  }

  private togglePanel(which: 'sidebar' | 'margin'): void {
    if (this.narrow) { this.overlay = this.overlay === which ? null : which; return }
    if (which === 'margin' && !this.marginShown) { this.marginAsked = true; this.setPanels({ margin: true }); return }
    this.setPanels(which === 'sidebar' ? { sidebar: !this.sidebar } : { margin: !this.margin })
  }

  private setPanels(patch: { sidebar?: boolean; margin?: boolean }): void {
    if (patch.sidebar !== undefined) this.sidebar = patch.sidebar
    if (patch.margin !== undefined) this.margin = patch.margin
    writeJson(PANEL_KEY, { sidebar: this.sidebar, margin: this.margin })
  }

  private say<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { bubbles: true, composed: true, detail }))
  }

  // --- render -------------------------------------------------------------------------------------------------------------

  /** The work's own title (the PDF's metadata, the book's package) over a file name. */
  private displayTitle(book: ReaderBook | null): string {
    const fileName = /\.[a-z0-9]{2,5}$/i.test(this.title) || !this.title
    return (fileName ? this.pdfState?.docTitle || book?.title : '') || this.title || book?.title || 'Original'
  }

  private displayAuthor(book: ReaderBook | null): string {
    return this.author || book?.author || this.pdfState?.docAuthor || ''
  }

  private notesCount(): number { return this.shown.filter(a => a.kind === 'comment').length }

  private bar(): TemplateResult {
    const source = this.source
    const pdf = source?.kind === 'pdf' ? this.pdfState : null
    const book = source?.kind === 'epub' ? source.book : null
    const notes = this.notesCount()
    const more: MenuEntry[] = [
      { id: 'download', label: 'Download original', icon: 'download', disabled: !this.downloadable },
      ...(this.textView ? [{ id: 'text', label: 'Show the text', icon: 'file-text' }] : []),
    ]
    return html`<mn-reader-bar view="original" title=${this.displayTitle(book)} author=${this.displayAuthor(book)}
        ?view-toggle=${this.textView} ?sidebar-pressed=${this.sidebarShown} ?sidebar-disabled=${!source}
        ?find-pressed=${this.findOpen} ?find-disabled=${!source} .progress=${book ? this.progress : null} .menu=${more}
        @rd-bar-sidebar=${() => this.togglePanel('sidebar')}
        @rd-bar-find=${() => { if (this.findOpen) this.closeFind(); else this.openFind() }}
        @rd-bar-menu=${(e: CustomEvent<{ id: string }>) => this.onBarMenu(e.detail.id)}>
      <div slot="location" class="loc-slot">${pdf ? this.pdfLocation(pdf) : book ? this.bookLocation(book) : nothing}</div>
      ${pdf ? html`<span slot="tools" class="tools">
          <button type="button" class="btn" aria-label="Zoom out" title="Zoom out (⌘−)" ?disabled=${!pdf.ready} @click=${() => this.surface?.zoomBy(1 / 1.15)}>${icon('minus')}</button>
          <button type="button" class="btn zoom" aria-label="Fit" title="Fit and zoom" aria-haspopup="menu" ?disabled=${!pdf.ready} @click=${() => { this.menu = this.menu === 'fit' ? null : 'fit' }}>${Math.round(pdf.scale * 100)}%</button>
          <button type="button" class="btn" aria-label="Zoom in" title="Zoom in (⌘+)" ?disabled=${!pdf.ready} @click=${() => this.surface?.zoomBy(1.15)}>${icon('plus')}</button></span>` : nothing}
      ${book ? html`<button slot="tools" type="button" class="btn" aria-label="Type" title="Type size, face and width" aria-pressed=${this.menu === 'type' ? 'true' : 'false'} @click=${() => { this.menu = this.menu === 'type' ? null : 'type' }}>${icon('type')}</button>` : nothing}
      <button slot="tools-end" type="button" class="btn" aria-label="Margin notes" title="Notes in the margin" aria-pressed=${this.marginShown ? 'true' : 'false'} ?disabled=${!source}
        @click=${() => this.togglePanel('margin')}>${icon('margin')}${notes ? html`<span class="count">${notes}</span>` : nothing}</button>
    </mn-reader-bar>`
  }

  private onBarMenu(id: string): void {
    if (id === 'download') this.say('mn-original-viewer-download', {})
    else if (id === 'text') this.say('mn-editor-original-view-toggle', {})
  }

  private pdfLocation(pdf: PdfSurfaceState): TemplateResult {
    const label = pdf.pageLabel
    return html`
      <button type="button" class="btn" aria-label="Previous page" title="Previous page (←)" ?disabled=${!pdf.ready || pdf.page <= 1} @click=${() => this.surface?.goToPage(pdf.page - 1)}>${icon('left')}</button>
      <input type="text" inputmode="numeric" aria-label="Page" .value=${label ?? String(pdf.page)} ?disabled=${!pdf.ready}
        @focus=${(e: FocusEvent) => (e.target as HTMLInputElement).select()}
        @keydown=${(e: KeyboardEvent) => {
          const input = e.target as HTMLInputElement
          if (e.key === 'Enter') { this.surface?.goToLabel(input.value); input.blur() }
          else if (e.key === 'Escape') { input.value = label ?? String(pdf.page); input.blur() }
        }}
        @blur=${(e: FocusEvent) => { (e.target as HTMLInputElement).value = label ?? String(pdf.page) }} />
      <span class="of">${label ? `(${pdf.page} of ${pdf.pageCount || '–'})` : `of ${pdf.pageCount || '–'}`}</span>
      <button type="button" class="btn" aria-label="Next page" title="Next page (→)" ?disabled=${!pdf.ready || pdf.page >= pdf.pageCount} @click=${() => this.surface?.goToPage(pdf.page + 1)}>${icon('right')}</button>`
  }

  private bookLocation(book: ReaderBook): TemplateResult {
    const chapter = book.chapters[this.chapter]
    return html`
      <button type="button" class="btn" aria-label="Previous chapter" title="Previous chapter (←)" ?disabled=${this.chapter <= 0} @click=${() => this.goChapter(this.chapter - 1)}>${icon('left')}</button>
      <span class="where" title=${chapter?.title ?? ''}>${chapter?.title ?? ''}</span>
      <span class="pct">${Math.round(this.progress * 100)}%</span>
      <button type="button" class="btn" aria-label="Next chapter" title="Next chapter (→)" ?disabled=${this.chapter >= book.chapters.length - 1} @click=${() => this.goChapter(this.chapter + 1)}>${icon('right')}</button>`
  }

  private menus(): TemplateResult | typeof nothing {
    if (!this.menu) return nothing
    if (this.menu === 'fit') {
      const zoom = this.pdfState?.zoom
      const zoomItem = (value: PdfZoom, label: string) => html`<button type="button" role="menuitemradio" aria-checked=${zoom === value ? 'true' : 'false'}
        @click=${() => { this.menu = null; this.surface?.setZoom(value) }}>${zoom === value ? '✓ ' : ''}${label}</button>`
      return html`<div class="menu" role="menu" style="top:6px;right:120px">
        ${zoomItem('auto', 'Automatic')}${zoomItem('page-width', 'Fit width')}${zoomItem('page-fit', 'Fit page')}${zoomItem(1, 'Actual size')}${zoomItem(1.5, '150%')}${zoomItem(2, '200%')}
      </div>`
    }
    const t = this.type
    const choice = <K extends keyof TypeSettings>(key: K, value: TypeSettings[K], label: string) => html`<button type="button" aria-pressed=${t[key] === value ? 'true' : 'false'}
      @click=${() => this.setType({ [key]: value } as Partial<TypeSettings>)}>${label}</button>`
    return html`<div class="menu" role="dialog" aria-label="Type" style="top:6px;right:140px">
      <div class="label">Size</div>
      <div class="choices"><button type="button" aria-label="Smaller" @click=${() => this.bigger(-1)}>A−</button><button type="button" aria-label="Larger" @click=${() => this.bigger(1)}>A+</button></div>
      <div class="label">Face</div>
      <div class="choices">${choice('face', 'serif', 'Serif')}${choice('face', 'sans', 'Sans')}</div>
      <div class="label">Line length</div>
      <div class="choices">${choice('measure', 'narrow', 'Narrow')}${choice('measure', 'medium', 'Medium')}${choice('measure', 'wide', 'Wide')}</div>
      <div class="label">Layout</div>
      <div class="choices">${choice('layout', 'continuous', 'Continuous')}${choice('layout', 'chapter', 'By chapter')}</div>
      <div class="label">Alignment</div>
      <div class="choices">${choice('justify', true, 'Justified')}${choice('justify', false, 'Ragged')}</div>
    </div>`
  }

  private sidePanel(): TemplateResult | typeof nothing {
    if (!this.sidebarShown || !this.source) return nothing
    const pdf = this.source.kind === 'pdf'
    const tabs: { id: 'contents' | 'pages' | 'notes'; label: string }[] = [
      { id: 'contents', label: 'Contents' }, ...(pdf ? [{ id: 'pages' as const, label: 'Pages' }] : []), { id: 'notes', label: 'Notes' },
    ]
    const tab = tabs.some(t => t.id === this.tab) ? this.tab : 'contents'
    return html`<aside class="side" aria-label="Contents">
      <div class="tabs" role="tablist">${tabs.map(t => html`<button type="button" role="tab" aria-selected=${tab === t.id ? 'true' : 'false'} @click=${() => { this.tab = t.id }}>${t.label}</button>`)}</div>
      <div class="side-scroll">${tab === 'contents' ? this.contents() : tab === 'pages' ? this.thumbs() : this.notesList()}</div>
    </aside>`
  }

  private contents(): TemplateResult {
    const source = this.source!
    if (source.kind === 'pdf') {
      const outline = this.pdfState?.outline ?? []
      const list = (items: readonly PdfOutlineItem[]): TemplateResult => html`<ul>${items.map(item => html`<li>
        <button type="button" @click=${() => this.surface?.goToDestination(item.dest)}>${item.title || '(untitled)'}</button>
        ${item.items.length ? list(item.items) : nothing}</li>`)}</ul>`
      return outline.length ? html`<nav class="toc">${list(outline)}</nav>` : html`<p class="empty">This PDF has no table of contents. Pages are in the next tab.</p>`
    }
    const current = this.chapter
    const list = (items: readonly ReaderTocEntry[]): TemplateResult => html`<ul>${items.map(item => html`<li>
      <button type="button" aria-current=${item.chapterIndex === current && !item.anchor ? 'true' : 'false'} @click=${() => this.goChapter(item.chapterIndex, item.anchor)}>${item.label}</button>
      ${item.children.length ? list(item.children) : nothing}</li>`)}</ul>`
    return html`<nav class="toc">${list(source.book.toc)}</nav>`
  }

  private thumbs(): TemplateResult {
    const count = this.pdfState?.pageCount ?? 0
    const page = this.pdfState?.page ?? 1
    const pages = Array.from({ length: count }, (_, i) => i + 1)
    return html`<div class="thumbs">${repeat(pages, n => n, n => html`<button type="button" class="thumb" aria-label=${`Page ${n}`} aria-current=${n === page ? 'page' : 'false'}
      @click=${() => this.surface?.goToPage(n)}><canvas data-thumb=${n} ${ref(el => this.watchThumb(el as HTMLCanvasElement | undefined, n))}></canvas><span>${n}</span></button>`)}</div>`
  }

  private watchThumb(canvas: HTMLCanvasElement | undefined, n: number): void {
    if (!canvas || this.thumbsDrawn.has(n)) return
    const scroller = this.renderRoot.querySelector('.side-scroll')
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      observer.disconnect()
      if (this.thumbsDrawn.has(n)) return
      this.thumbsDrawn.add(n)
      void this.surface?.renderThumb(n, canvas).catch(() => this.thumbsDrawn.delete(n))
    }, { root: scroller, rootMargin: '300px' })
    observer.observe(canvas)
  }

  private notesList(): TemplateResult {
    const list = this.ordered()
    if (!list.length) {
      return html`<p class="empty">${this.canAnnotate ? 'Select a passage to highlight it or write a note.' : this.annotateNote || 'No highlights or notes yet.'}</p>`
    }
    return html`<div class="notes-list">${list.map(annotation => html`<button type="button" class="note-row" @click=${() => this.reveal(annotation)}>
      <q>${annotation.quote}</q>
      ${annotation.kind === 'comment' && annotation.text ? html`<span>${annotation.text}</span>` : nothing}
      <span class="meta"><i class="dot" data-color=${annotation.color}></i>${annotation.kind === 'comment' ? annotation.author || 'Note' : 'Highlight'}${this.where(annotation)}</span>
    </button>`)}</div>`
  }

  private where(annotation: ReaderAnnotation): string {
    if (this.source?.kind === 'pdf') { const page = this.pdfPages.get(annotation.id); return page ? ` · p. ${page}` : ' · not found' }
    const chapter = this.bookChapterOf.get(annotation.id)
    const book = this.source?.kind === 'epub' ? this.source.book : null
    return chapter !== undefined && book ? ` · ${book.chapters[chapter]?.title ?? ''}` : ' · not found'
  }

  /** Reading order: by page or chapter, then as given. */
  private ordered(): ReaderAnnotation[] {
    const at = (a: ReaderAnnotation) => this.source?.kind === 'pdf' ? this.pdfPages.get(a.id) ?? Infinity : this.bookChapterOf.get(a.id) ?? Infinity
    return [...this.shown].map((a, i) => ({ a, i })).sort((x, y) => at(x.a) - at(y.a) || x.i - y.i).map(x => x.a)
  }

  private stage(): TemplateResult {
    const source = this.source
    const book = source?.kind === 'epub' ? source.book : null
    const pdf = source?.kind === 'pdf' ? this.pdfState : null
    return html`<main class="stage" @pointerdown=${(e: PointerEvent) => { this.lastPointer = e.pointerType || 'mouse' }} @pointerup=${(e: PointerEvent) => this.onStagePointerUp(e)} @contextmenu=${(e: MouseEvent) => this.onStageContextMenu(e)} @click=${(e: MouseEvent) => this.onStageClick(e)}
        @keyup=${(e: KeyboardEvent) => { if (e.shiftKey) this.selectionPop() }}>
      ${source?.kind === 'pdf' ? html`<div class="pdf" tabindex="0" role="document" aria-label=${this.title || 'PDF'}><div class="pdfViewer"></div></div>` : nothing}
      ${book ? html`<div class="book" tabindex="0" role="document" aria-label=${book.title}>
        ${repeat(book.chapters.slice(this.win.first, this.win.last + 1), c => c.index, c => html`<article class="chapter" id=${`rd-c${c.index}`} data-chapter=${c.index} lang=${book.language || nothing}>${unsafeHTML(c.html)}</article>`)}
        ${this.continuous ? nothing : html`<nav class="chapter-nav" aria-label="Chapters">
          ${this.chapter > 0 ? html`<button type="button" @click=${() => this.goChapter(this.chapter - 1)}><small>Previous</small>${book.chapters[this.chapter - 1]?.title}</button>` : nothing}
          ${this.chapter < book.chapters.length - 1 ? html`<button type="button" data-next @click=${() => this.goChapter(this.chapter + 1)}><small>Next</small>${book.chapters[this.chapter + 1]?.title}</button>` : nothing}
        </nav>`}
      </div>` : nothing}
      ${pdf?.ready && !pdf.hasText ? html`<div class="banner" role="note">This PDF is a scan: its pages are pictures, so there is no text to search, select or highlight.</div>` : nothing}
      ${this.findBar()}
      ${this.selectionBar()}
      ${this.annotationBar()}
      ${this.composerView()}
      ${this.veil()}
    </main>`
  }

  private findBar(): TemplateResult | typeof nothing {
    if (!this.findOpen) return nothing
    const pdf = this.source?.kind === 'pdf' ? this.pdfState?.find : null
    const book = this.bookFind
    const count = !this.findQuery.trim() ? ''
      : this.source?.kind === 'pdf' ? (!this.pdfState?.hasText ? 'No text' : pdf?.total ? `${pdf.current} of ${pdf.total}` : pdf?.none ? 'No matches' : '…')
      : book ? (book.results.length ? `${book.current + 1} of ${book.results.length}${book.results.length >= 2000 ? '+' : ''}` : 'No matches') : ''
    let timer = 0
    return html`<div class="find" role="search">
      <input type="text" aria-label="Find" placeholder="Find" .value=${this.findQuery} spellcheck="false"
        @input=${(e: Event) => { this.findQuery = (e.target as HTMLInputElement).value; window.clearTimeout(timer); timer = window.setTimeout(() => this.runFind(false), 160) }}
        @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); this.runFind(true, e.shiftKey) } }} />
      <span class="count" aria-live="polite">${count}</span>
      <button type="button" class="btn" aria-label="Previous match" @click=${() => this.runFind(true, true)}>${icon('up')}</button>
      <button type="button" class="btn" aria-label="Next match" @click=${() => this.runFind(true, false)}>${icon('down')}</button>
      <button type="button" class="btn" aria-label="Close find" @click=${() => this.closeFind()}>${icon('x')}</button>
    </div>`
  }

  private selectionBar(): TemplateResult | typeof nothing {
    const pop = this.pop
    if (!pop) return nothing
    const off = !this.canAnnotate
    return html`<div class="pop" role="toolbar" aria-label="Selection" style=${`left:${pop.x}px;top:${pop.y}px`} ?data-below=${pop.below}
        @pointerdown=${(e: Event) => e.preventDefault()}>
      ${READER_COLORS.map(color => html`<button type="button" class="swatch" data-color=${color} aria-label=${`Highlight ${color}`} title=${off ? this.annotateNote || 'Highlighting is not available here' : `Highlight (${color})`}
        ?disabled=${off} @click=${() => this.highlight(color)}><i></i></button>`)}
      <span class="vsep"></span>
      <button type="button" class="act" ?disabled=${off} title=${off ? this.annotateNote : 'Write a note on this passage'} @click=${() => this.openComposer(pop, 'yellow', null, '')}>Note</button>
      <button type="button" class="act" @click=${() => { void navigator.clipboard?.writeText(pop.quote); this.pop = null }}>Copy</button>
    </div>`
  }

  private annotationBar(): TemplateResult | typeof nothing {
    const pop = this.activePop
    const annotation = pop ? this.shown.find(a => a.id === pop.id) : null
    if (!pop || !annotation) return nothing
    const pending = annotation.id.startsWith('pending-')
    const mine = annotation.mine !== false && this.canAnnotate && !pending
    return html`<div class="pop" role="toolbar" aria-label="Highlight" style=${`left:${pop.x}px;top:${pop.y}px`} ?data-below=${pop.below}
        @pointerdown=${(e: Event) => e.preventDefault()}>
      ${mine ? READER_COLORS.map(color => html`<button type="button" class="swatch" data-color=${color} aria-label=${`Make it ${color}`} aria-pressed=${annotation.color === color ? 'true' : 'false'}
        @click=${() => this.change({ id: annotation.id, action: 'recolor', color })}><i></i></button>`) : nothing}
      ${mine ? html`<span class="vsep"></span>` : nothing}
      ${mine ? html`<button type="button" class="act" @click=${() => this.openComposer({ ...pop, quote: annotation.quote, prefix: annotation.prefix ?? '', suffix: annotation.suffix ?? '', place: annotation.place ?? { kind: 'page', page: 1 } }, annotation.color, annotation.kind === 'comment' ? annotation.id : null, annotation.text ?? '')}>${annotation.kind === 'comment' ? 'Edit note' : 'Note'}</button>` : nothing}
      <button type="button" class="act" @click=${() => { void navigator.clipboard?.writeText(annotation.quote); this.activePop = null }}>Copy</button>
      ${mine ? html`<button type="button" class="act" @click=${() => this.change({ id: annotation.id, action: 'delete' })}>Delete</button>` : nothing}
    </div>`
  }

  private composerView(): TemplateResult | typeof nothing {
    const c = this.composer
    if (!c) return nothing
    const stage = this.renderRoot.querySelector<HTMLElement>('.stage')
    const width = 300
    const left = Math.max(8, Math.min((stage?.clientWidth ?? 800) - width - 8, c.x - width / 2))
    const top = c.below ? c.y + 12 : Math.max(8, c.y - 190)
    return html`<div class="composer" role="dialog" aria-label=${c.editing ? 'Edit note' : 'New note'} style=${`left:${left}px;top:${top}px`}>
      <q>${c.quote}</q>
      <textarea aria-label="Note" placeholder="Write a note…" .value=${c.draft}
        @input=${(e: Event) => { this.composer = { ...c, draft: (e.target as HTMLTextAreaElement).value } }}
        @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.saveComposer() } }}></textarea>
      <div class="row"><span class="grow">⌘↩ to save</span>
        <button type="button" class="btn" @click=${() => { this.composer = null }}>Cancel</button>
        <button type="button" class="primary" ?disabled=${!c.draft.trim()} @click=${() => this.saveComposer()}>${c.editing ? 'Save' : 'Add note'}</button></div>
    </div>`
  }

  private marginView(): TemplateResult | typeof nothing {
    if (!this.marginShown || !this.source) return nothing
    const notes = this.shown.filter(a => a.kind === 'comment')
    return html`<aside class="margin" aria-label="Notes">
      ${notes.length === 0 ? html`<p class="margin-empty">${this.canAnnotate ? 'Notes appear here, beside their passage. Select text to write one.' : this.annotateNote || 'No notes on this original.'}</p>` : nothing}
      ${repeat(notes, a => a.id, a => {
        const y = this.notePlaces.get(a.id)
        return html`<div class="margin-note" data-note=${a.id} ?data-active=${this.active === a.id} ?data-unplaced=${y === undefined}
          style=${`top:${y ?? 0}px;--rd-note-color:var(--rd-dot-${a.color}, ${({ yellow: 'rgb(234,179,8)', green: 'rgb(34,160,90)', blue: 'rgb(59,130,246)', pink: 'rgb(219,39,119)' } as const)[a.color]})`}
          @click=${() => { const range = this.rangeOf(a.id); if (range) this.showAnnotation(a.id, range) }}>
          <div class="who" title=${a.signedBy ? `Published by ${a.signedBy}` : ''}>${a.author || 'Note'}</div>
          <div class="words">${a.text}</div>
        </div>`
      })}
    </aside>`
  }

  private veil(): TemplateResult | typeof nothing {
    const message = this.failure || this.error
    if (message) return html`<div class="veil" role="alert"><p>${message}</p></div>`
    if (this.status === 'loading' || (this.source?.kind === 'pdf' && !this.pdfState?.ready)) {
      return html`<div class="veil" role="status"><p>Opening ${this.title || 'the original'}…</p></div>`
    }
    if (!this.source && this.status !== 'idle') return html`<div class="veil"><p>This original cannot be shown in the Reader.</p></div>`
    return nothing
  }

  protected override render(): TemplateResult {
    return html`
      ${this.bar()}
      <div class="body">
        ${this.sidePanel()}
        ${this.stage()}
        ${this.marginView()}
        ${this.menus()}
      </div>
      <mn-context-menu class="ctx" @mn-select=${(e: CustomEvent<MenuSelectDetail>) => this.onContextSelect(e)}></mn-context-menu>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'mn-reader': MnReader }
}
