/**
 * EPUB → book, for the in-app Reader.
 *
 * The original-file viewer (`original-file-controller.ts`) gives each chapter to a sandboxed iframe as `srcdoc`.
 * The Reader renders chapters in OUR DOM (a shadow root, through Lit's `unsafeHTML`), so nothing from the book may
 * reach it as markup: every chapter is parsed, walked, and REBUILT as a string from an allowlist. Element names
 * and attribute names in the output come only from the tables below; text and attribute values are escaped; no
 * raw-text element (script, style, textarea, title, noscript, …) is ever emitted, so the escaped text cannot be
 * re-read as markup. Images are inlined as `data:` URLs from the archive, links are rewritten to namespaced
 * anchors (chapters share one DOM), and printed-page markers become empty `span.rd-pagenum` elements.
 *
 * Parsing: XHTML chapters are parsed as XML first (XHTML's `<a id="x"/>` is an empty anchor; an HTML parse would
 * make it swallow the paragraph), and fall back to an HTML parse when the XML is not well formed.
 */

export interface ReaderTocEntry {
  readonly label: string
  readonly chapterIndex: number
  readonly anchor: string | null
  readonly children: readonly ReaderTocEntry[]
}

/** One printed-page marker inside a chapter: its label (`12`, `xiv`) and the namespaced id of its span. */
export interface ReaderPageMarker {
  readonly page: string
  readonly anchor: string
}

export interface ReaderChapter {
  /** Spine order, 0-based. */
  readonly index: number
  /** Manifest id (or path). */
  readonly id: string
  /** Archive path. */
  readonly path: string
  /** The TOC label for this chapter if any, else first h1/h2/h3 text, else `<title>`, else "Chapter N". */
  readonly title: string
  /** Sanitized BODY inner HTML, safe to render in our DOM. */
  readonly html: string
  readonly wordCount: number
  /** False for spine items marked `linear="no"` (still included, in spine order). */
  readonly linear: boolean
  /** The chapter document's language (`html`/`body` `lang` or `xml:lang`), or "". */
  readonly language: string
  /** Printed-page markers in this chapter, in document order. */
  readonly pages: readonly ReaderPageMarker[]
}

export interface ReaderBook {
  readonly title: string
  readonly author: string
  readonly language: string
  readonly publisher: string
  /** `data:` URL of the cover image when the package names one. */
  readonly cover: string | null
  /** Nested, from EPUB3 nav (epub:type="toc") else EPUB2 NCX navMap; if neither, one entry per chapter. */
  readonly toc: readonly ReaderTocEntry[]
  readonly chapters: readonly ReaderChapter[]
  /** Where the TOC came from. */
  readonly tocSource: 'nav' | 'ncx' | 'spine'
  /** The package document's `version` attribute (`2.0`, `3.0`, …), or "". */
  readonly version: string
}

/** The anchor id the reader puts on element `id` of chapter `index` (ids are namespaced so chapters can share one DOM). */
export function readerAnchorId(index: number, id: string): string {
  const key = anchorKey(id)
  return key ? `rd-c${index}-${key}` : readerChapterId(index)
}

/** The id the reader puts on the chapter element itself; links to the start of a chapter point here. */
export function readerChapterId(index: number): string {
  return `rd-c${index}`
}

/** Every printed-page marker in the book, in reading order. */
export function printedPages(book: ReaderBook): readonly { chapterIndex: number; page: string; anchor: string }[] {
  const pages: { chapterIndex: number; page: string; anchor: string }[] = []
  for (const chapter of book.chapters) {
    for (const marker of chapter.pages) pages.push({ chapterIndex: chapter.index, page: marker.page, anchor: marker.anchor })
  }
  return Object.freeze(pages)
}

// ---------------------------------------------------------------------------------------------------------------
// Tables

const XHTML_NS = 'http://www.w3.org/1999/xhtml'
const SVG_NS = 'http://www.w3.org/2000/svg'
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'
const OPS_NS = 'http://www.idpf.org/2007/ops'

const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  'p', 'div', 'span', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'em', 'i', 'b', 'strong', 'small', 'sub', 'sup', 's', 'u', 'del', 'ins', 'mark', 'abbr', 'cite', 'q', 'dfn',
  'code', 'kbd', 'samp', 'var', 'pre', 'blockquote', 'br', 'hr',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'col', 'colgroup',
  'figure', 'figcaption', 'img', 'a', 'ruby', 'rt', 'rp', 'wbr', 'bdi', 'bdo', 'time',
])

/** Dropped with everything inside them. Anything else that is not allowed is unwrapped (its children kept). */
const DROPPED_ELEMENTS: ReadonlySet<string> = new Set([
  'script', 'style', 'link', 'meta', 'base', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'param',
  'form', 'input', 'button', 'textarea', 'select', 'option', 'optgroup', 'datalist', 'keygen', 'output',
  'svg', 'math', 'video', 'audio', 'source', 'track', 'canvas', 'template', 'noscript', 'noembed', 'noframes',
  'head', 'title', 'area', 'image', 'portal', 'slot',
])

const VOID_ELEMENTS: ReadonlySet<string> = new Set(['br', 'hr', 'img', 'col', 'wbr'])

/** Elements whose edges separate words (for the word count and for heading text). */
const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  'p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'pre', 'blockquote', 'br', 'hr', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'caption', 'thead', 'tbody',
  'tfoot', 'tr', 'th', 'td', 'figure', 'figcaption', 'body',
])

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
}
const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set(Object.values(IMAGE_TYPES))
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml|avif)[;,]/i

const CLASS_TOKEN = /^[A-Za-z][A-Za-z0-9_-]*$/
const LANG_TAG = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/
const DIGITS = /^\d{1,6}$/
const PAGE_MARKER_CLASSES: ReadonlySet<string> = new Set(['pagenum', 'x-ebookmaker-pageno', 'pageno', 'page-number'])

// ---------------------------------------------------------------------------------------------------------------
// Archive helpers (after the original-file viewer's)

function basename(value: string): string {
  const clean = value.split(/[?#]/, 1)[0]?.replace(/\\/g, '/') ?? ''
  return clean.split('/').filter(Boolean).at(-1) ?? ''
}

function extensionFrom(value: string): string {
  const name = basename(value)
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index + 1).toLocaleLowerCase() : ''
}

function archivePath(value: string): string {
  const parts: string[] = []
  for (const part of value.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function archiveDirectory(value: string): string {
  const normalized = archivePath(value)
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index) : ''
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** `value` (a relative href, query and fragment ignored) resolved against archive directory `base`. */
function joinArchivePath(base: string, value: string): string {
  return archivePath(`${base}/${safeDecode(value.split(/[?#]/, 1)[0] ?? '')}`)
}

class Archive {
  private readonly byLowerPath = new Map<string, Uint8Array>()
  constructor(private readonly entries: Readonly<Record<string, Uint8Array>>) {
    for (const [key, bytes] of Object.entries(entries)) {
      const lower = archivePath(key).toLocaleLowerCase()
      if (!this.byLowerPath.has(lower)) this.byLowerPath.set(lower, bytes)
    }
  }

  get(path: string): Uint8Array | null {
    const normalized = archivePath(path)
    return this.entries[normalized] ?? this.byLowerPath.get(normalized.toLocaleLowerCase()) ?? null
  }
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + chunk)))
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

/** UTF-8 unless a BOM or the XML declaration says otherwise (EPUB allows UTF-16; old books say windows-1252). */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200))
  const declared = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1]?.toLocaleLowerCase()
  if (declared && declared !== 'utf-8' && declared !== 'utf8') {
    try {
      return new TextDecoder(declared).decode(bytes)
    } catch {
      // An encoding this runtime does not know: read it as UTF-8.
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

// ---------------------------------------------------------------------------------------------------------------
// DOM helpers

function localNameOf(element: Element): string {
  return (element.localName.split(':').at(-1) ?? element.localName).toLocaleLowerCase()
}

function prefixOf(element: Element): string {
  const parts = element.localName.split(':')
  return parts.length > 1 ? (parts[0] ?? '').toLocaleLowerCase() : (element.prefix ?? '').toLocaleLowerCase()
}

function descendants(root: Document | Element, localName: string): Element[] {
  const wanted = localName.toLocaleLowerCase()
  return Array.from(root.getElementsByTagName('*')).filter(element => localNameOf(element) === wanted)
}

function childElements(parent: Element | null | undefined, localName?: string): Element[] {
  if (!parent) return []
  const wanted = localName?.toLocaleLowerCase()
  return Array.from(parent.children).filter(element => !wanted || localNameOf(element) === wanted)
}

/** An attribute by qualified name (`epub:type`, `xml:lang`) or, for namespaced XML, by namespace + local name. */
function attributeOf(element: Element, qualifiedName: string, namespace?: string): string | null {
  const wanted = qualifiedName.toLocaleLowerCase()
  const local = wanted.split(':').at(-1)
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.name.toLocaleLowerCase() === wanted) return attribute.value
    if (namespace && attribute.namespaceURI === namespace && attribute.localName.toLocaleLowerCase() === local) {
      return attribute.value
    }
  }
  return null
}

function epubTypeOf(element: Element): string[] {
  return tokens(attributeOf(element, 'epub:type', OPS_NS))
}

function tokens(value: string | null | undefined): string[] {
  return (value ?? '').split(/\s+/).filter(Boolean)
}

function collapse(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

/** A TOC or heading label without the footnote call Gutenberg leaves on it (`…OF THE DREAM[D]`). */
function cleanLabel(value: string | null | undefined): string {
  return collapse(value).replace(/(\S)\[[0-9A-Za-z]{1,3}\]$/, '$1').trim()
}

/** The key an element id and a link fragment share: trimmed, inner whitespace folded to `_`. */
function anchorKey(value: string): string {
  return value.trim().replace(/\s+/g, '_')
}

function hasParserError(document: Document): boolean {
  return document.getElementsByTagName('parsererror').length > 0
}

/** Package, container and NCX documents: XML, with nothing executable and XML's empty elements spelled out. */
function parseXml(source: string, label: string): Document {
  const document = new DOMParser().parseFromString(expandEmptyElements(withoutExecutables(source)), 'application/xml')
  if (hasParserError(document) || !document.documentElement) throw new Error(`${label} is malformed`)
  return document
}

const EXECUTABLE = '(?:script|style|iframe|frame|object|embed|template|applet)'

/**
 * Remove what must never run before any parser sees the markup (a lightweight DOM may run a script while
 * parsing; browsers' DOMParser documents are inert). Only markup is touched: in well-formed (X)HTML a literal
 * `<script` in text is escaped, so no text matches. An internal DTD subset goes too (entity expansion); the
 * DOCTYPE itself stays, so XHTML's named entities still parse. The walk below is still the authority: it emits
 * only allowlisted elements.
 */
function withoutExecutables(source: string): string {
  return source
    .replace(/<!DOCTYPE([^>[]*)\[[\s\S]*?\]\s*>/i, '<!DOCTYPE$1>')
    .replace(new RegExp(`<(${EXECUTABLE})\\b[^>]*?/>`, 'gi'), '')
    .replace(new RegExp(`<(${EXECUTABLE})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`, 'gi'), '')
    .replace(new RegExp(`</?${EXECUTABLE}\\b[^>]*>`, 'gi'), '')
}

/** A chapter's markup with nothing executable and nothing that loads (a lightweight DOM fetches `<link>` CSS). */
function inertMarkup(source: string): string {
  return withoutExecutables(source).replace(/<\/?(?:link|meta|base)\b[^>]*>/gi, '')
}

const HTML_VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

/**
 * XML's empty-element tags (`<a id="r1"/>`, `<div/>`, `<content src="…"/>`) as start + end tags. An XML parser
 * reads both spellings the same; an HTML parser — the fallback for XHTML that is not well formed, and the only
 * parser some lightweight DOMs have — ignores the slash and lets the element swallow what follows (Gutenberg's
 * `<div/>` after its header would wrap the transcriber's note). HTML void elements keep their spelling
 * (`<br></br>` is two breaks to an HTML parser).
 */
function expandEmptyElements(source: string): string {
  return source.replace(
    /<([A-Za-z][A-Za-z0-9:_.-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/>/g,
    (tag, name: string, attributes: string) => (HTML_VOID.has(name.toLocaleLowerCase()) ? tag : `<${name}${attributes}></${name}>`),
  )
}

/** XHTML as XML first; HTML when it is not well formed (or is HTML to begin with). */
function parseChapter(source: string, xml: boolean): Document {
  const inert = inertMarkup(source)
  if (xml) {
    const expanded = expandEmptyElements(inert)
    const document = new DOMParser().parseFromString(expanded, 'application/xhtml+xml')
    if (!hasParserError(document) && document.documentElement) return document
    return new DOMParser().parseFromString(expanded, 'text/html')
  }
  return new DOMParser().parseFromString(inert, 'text/html')
}

function bodyOf(document: Document): Element | null {
  return descendants(document, 'body')[0] ?? document.documentElement
}

function documentTitle(document: Document): string {
  const head = descendants(document, 'head')[0]
  const title = childElements(head, 'title')[0] ?? descendants(document, 'title')[0]
  return collapse(title?.textContent).replace(/^"(.*)"$/, '$1').trim()
}

function documentLanguage(document: Document): string {
  for (const element of [document.documentElement, bodyOf(document)]) {
    if (!element) continue
    const lang = attributeOf(element, 'xml:lang') ?? attributeOf(element, 'lang')
    if (lang && LANG_TAG.test(lang.trim())) return lang.trim()
  }
  return ''
}

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, character => (character === '&' ? '&amp;' : character === '<' ? '&lt;' : '&gt;'))
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"]/g, character =>
    character === '&' ? '&amp;' : character === '<' ? '&lt;' : character === '>' ? '&gt;' : '&quot;')
}

function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’.\-][\p{L}\p{N}]+)*/gu)?.length ?? 0
}

// ---------------------------------------------------------------------------------------------------------------
// The package

interface ManifestItem {
  readonly id: string
  readonly href: string
  readonly path: string
  readonly mediaType: string
  readonly properties: readonly string[]
}

interface SpineItem {
  readonly item: ManifestItem
  readonly linear: boolean
}

interface LinkTarget {
  readonly chapterIndex: number
  /** The namespaced id, or "" for the start of the chapter. */
  readonly anchor: string
}

/** An (X)HTML content document (an SVG content document is an image here; an NCX is not a chapter). */
function isMarkupItem(item: ManifestItem): boolean {
  if (/svg|ncx/i.test(item.mediaType) || /\.(?:svg|ncx)$/i.test(item.href)) return false
  return /(?:xhtml|html|xml)/i.test(item.mediaType) || /\.(?:xhtml|html?|xml)$/i.test(item.href)
}

function imageMimeFor(path: string, mediaType?: string): string | null {
  const byExtension = IMAGE_TYPES[extensionFrom(path)]
  if (byExtension) return byExtension
  const declared = mediaType?.split(';', 1)[0]?.trim().toLocaleLowerCase() ?? ''
  return IMAGE_MIME_TYPES.has(declared) ? declared : null
}

function hasScheme(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
}

/** ASCII whitespace and controls removed, as a browser does before reading a URL's scheme (`java\nscript:`). */
function urlForm(value: string): string {
  return value.replace(/[\u0000-\u0020\u007f]/g, '')
}

class Book {
  readonly spine: readonly SpineItem[]
  private readonly spineIndex = new Map<string, number>()
  private readonly dataUrls = new Map<string, string | null>()
  private readonly manifestByPath = new Map<string, ManifestItem>()

  constructor(readonly archive: Archive, spine: readonly SpineItem[], manifest: Iterable<ManifestItem>) {
    this.spine = spine
    spine.forEach((entry, index) => {
      const key = entry.item.path.toLocaleLowerCase()
      if (!this.spineIndex.has(key)) this.spineIndex.set(key, index)
    })
    for (const item of manifest) this.manifestByPath.set(item.path.toLocaleLowerCase(), item)
  }

  chapterAt(path: string): number | undefined {
    return this.spineIndex.get(archivePath(path).toLocaleLowerCase())
  }

  /** An archive image as a `data:` URL, or null when it is missing or not an image we inline. */
  image(path: string): string | null {
    const key = archivePath(path).toLocaleLowerCase()
    if (this.dataUrls.has(key)) return this.dataUrls.get(key) ?? null
    const bytes = this.archive.get(path)
    const mime = imageMimeFor(path, this.manifestByPath.get(key)?.mediaType)
    const url = bytes && mime ? bytesToDataUrl(bytes, mime) : null
    this.dataUrls.set(key, url)
    return url
  }

  /** An `img`/`image` reference from a document in `directory`, as a `data:` URL. */
  resolveImage(directory: string, src: string | null): string | null {
    const value = urlForm(src ?? '')
    if (!value) return null
    if (DATA_IMAGE.test(value)) return value
    if (hasScheme(value) || value.startsWith('/')) return null
    return this.image(joinArchivePath(directory, value))
  }

  /** A relative href from the document at index `from` (or a non-spine document in `directory`) to a chapter. */
  resolveLink(directory: string, from: number | null, href: string): LinkTarget | null {
    const value = urlForm(href)
    if (value.startsWith('#') && from !== null) return this.target(from, value.slice(1))
    if (!value || hasScheme(value) || value.startsWith('/')) return null
    const hash = value.indexOf('#')
    const pathPart = (hash >= 0 ? value.slice(0, hash) : value).split('?', 1)[0] ?? ''
    const fragment = hash >= 0 ? value.slice(hash + 1) : ''
    if (!pathPart) return from !== null ? this.target(from, fragment) : null
    const index = this.chapterAt(joinArchivePath(directory, pathPart))
    return index === undefined ? null : this.target(index, fragment)
  }

  private target(chapterIndex: number, fragment: string): LinkTarget {
    const key = anchorKey(safeDecode(fragment))
    return { chapterIndex, anchor: key ? readerAnchorId(chapterIndex, key) : '' }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tables of contents

interface TocBuild {
  readonly entries: ReaderTocEntry[]
  /** The first linked label for each chapter, in reading order of the TOC. */
  readonly titles: Map<number, string>
}

function tocEntry(label: string, chapterIndex: number, anchor: string | null, children: readonly ReaderTocEntry[]): ReaderTocEntry {
  return Object.freeze({ label, chapterIndex, anchor, children: Object.freeze([...children]) })
}

function navToc(book: Book, document: Document, navPath: string): TocBuild {
  const directory = archiveDirectory(navPath)
  const titles = new Map<number, string>()
  const navs = descendants(document, 'nav')
  const nav = navs.find(element => epubTypeOf(element).includes('toc'))
    ?? navs.find(element => element.getAttribute('role') === 'doc-toc')
    ?? (navs.length === 1 && epubTypeOf(navs[0]!).length === 0 ? navs[0] : undefined)
  const list = childElements(nav, 'ol')[0] ?? (nav ? descendants(nav, 'ol')[0] : undefined)

  const read = (ol: Element): ReaderTocEntry[] => {
    const entries: ReaderTocEntry[] = []
    for (const li of childElements(ol, 'li')) {
      const head = childElements(li).find(element => ['a', 'span'].includes(localNameOf(element)))
      const href = head && localNameOf(head) === 'a' ? head.getAttribute('href') : null
      const target = href ? book.resolveLink(directory, null, href) : null
      const label = cleanLabel(head?.textContent)
      if (target && label && !titles.has(target.chapterIndex)) titles.set(target.chapterIndex, label)
      const nested = childElements(li, 'ol')[0]
      const children = nested ? read(nested) : []
      if (target) entries.push(tocEntry(label || `Chapter ${target.chapterIndex + 1}`, target.chapterIndex, target.anchor || null, children))
      else if (children.length > 0) {
        const first = children[0]!
        entries.push(tocEntry(label || first.label, first.chapterIndex, first.anchor, children))
      }
    }
    return entries
  }
  return { entries: list ? read(list) : [], titles }
}

function ncxToc(book: Book, document: Document, ncxPath: string): TocBuild {
  const directory = archiveDirectory(ncxPath)
  const titles = new Map<number, string>()
  const read = (parent: Element): ReaderTocEntry[] => {
    const entries: ReaderTocEntry[] = []
    for (const point of childElements(parent, 'navPoint')) {
      const label = cleanLabel(childElements(childElements(point, 'navLabel')[0], 'text')[0]?.textContent)
      const src = childElements(point, 'content')[0]?.getAttribute('src') ?? null
      const target = src ? book.resolveLink(directory, null, src) : null
      if (target && label && !titles.has(target.chapterIndex)) titles.set(target.chapterIndex, label)
      const children = read(point)
      if (target) entries.push(tocEntry(label || `Chapter ${target.chapterIndex + 1}`, target.chapterIndex, target.anchor || null, children))
      else if (children.length > 0) {
        const first = children[0]!
        entries.push(tocEntry(label || first.label, first.chapterIndex, first.anchor, children))
      }
    }
    return entries
  }
  const navMap = descendants(document, 'navMap')[0]
  return { entries: navMap ? read(navMap) : [], titles }
}

// ---------------------------------------------------------------------------------------------------------------
// The chapter walk

interface Walk {
  readonly book: Book
  readonly index: number
  readonly directory: string
  /** The chapter's own element ids (anchor keys), so a synthesized page-marker id cannot collide with one. */
  readonly ids: ReadonlySet<string>
  readonly out: string[]
  readonly text: string[]
  readonly pages: ReaderPageMarker[]
  /** Text of the first h1–h3, gathered while inside it. */
  heading: string[] | null
  /** The first non-empty h1–h3 text, once found. */
  headingText: string
  pageSequence: number
}

const MAX_DEPTH = 256

function emitText(walk: Walk, value: string): void {
  if (!value) return
  walk.out.push(escapeText(value))
  walk.text.push(value)
  walk.heading?.push(value)
}

function boundary(walk: Walk): void {
  walk.text.push(' ')
  walk.heading?.push(' ')
}

function walkChildren(walk: Walk, parent: Node, depth: number): void {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 3 || child.nodeType === 4) emitText(walk, child.nodeValue ?? '')
    else if (child.nodeType === 1) walkElement(walk, child as Element, depth + 1)
  }
}

function walkElement(walk: Walk, element: Element, depth: number): void {
  const name = localNameOf(element)
  const namespace = element.namespaceURI
  if (depth > MAX_DEPTH) {
    // Pathologically deep markup: keep the words, drop the structure.
    emitText(walk, element.textContent ?? '')
    return
  }
  if (namespace === SVG_NS || name === 'svg') {
    svgImage(walk, element)
    return
  }
  if (namespace === MATHML_NS || name === 'math') return
  if (name === 'switch' && (namespace === OPS_NS || prefixOf(element) === 'epub')) {
    // epub:switch — render the fallback (epub:default), never the epub:case content.
    const fallback = childElements(element, 'default')[0]
    if (fallback) walkChildren(walk, fallback, depth)
    return
  }
  if (pageMarker(walk, element, name)) return
  if (DROPPED_ELEMENTS.has(name)) return
  const html = namespace === null || namespace === XHTML_NS || namespace === ''
  if (!html || !ALLOWED_ELEMENTS.has(name)) {
    if (BLOCK_ELEMENTS.has(name)) boundary(walk)
    walkChildren(walk, element, depth)
    if (BLOCK_ELEMENTS.has(name)) boundary(walk)
    return
  }

  const capturing = !walk.headingText && walk.heading === null && (name === 'h1' || name === 'h2' || name === 'h3')
  if (capturing) walk.heading = []
  const block = BLOCK_ELEMENTS.has(name)
  if (block) boundary(walk)
  walk.out.push(`<${name}${attributes(walk, element, name)}>`)
  walkChildren(walk, element, depth)
  if (!VOID_ELEMENTS.has(name)) walk.out.push(`</${name}>`)
  if (block) boundary(walk)
  if (capturing) {
    walk.headingText = cleanLabel(walk.heading?.join(''))
    walk.heading = null
  }
}

function attributes(walk: Walk, element: Element, name: string): string {
  const out = new Map<string, string>()
  for (const attribute of Array.from(element.attributes)) {
    const qualified = attribute.name.toLocaleLowerCase()
    const value = attribute.value
    switch (qualified) {
      case 'id': {
        const key = anchorKey(value)
        if (key) out.set('id', readerAnchorId(walk.index, key))
        break
      }
      case 'class': {
        const kept = tokens(value).filter(token => CLASS_TOKEN.test(token) && !token.startsWith('rd-'))
        if (kept.length > 0) out.set('class', kept.join(' '))
        break
      }
      case 'lang':
      case 'xml:lang': {
        const lang = value.trim()
        if (LANG_TAG.test(lang) && (qualified === 'xml:lang' || !out.has('lang'))) out.set('lang', lang)
        break
      }
      case 'dir': {
        const dir = value.trim().toLocaleLowerCase()
        if (dir === 'ltr' || dir === 'rtl' || dir === 'auto') out.set('dir', dir)
        break
      }
      case 'title':
        out.set('title', value)
        break
      case 'alt':
        if (name === 'img') out.set('alt', value)
        break
      case 'colspan':
      case 'rowspan':
        if ((name === 'td' || name === 'th') && DIGITS.test(value.trim())) out.set(qualified, value.trim())
        break
      case 'width':
      case 'height':
        if (name === 'img' && DIGITS.test(value.trim())) out.set(qualified, value.trim())
        break
      case 'epub:type': {
        const kept = tokens(value).filter(token => /^[A-Za-z][A-Za-z0-9:_-]*$/.test(token))
        if (kept.length > 0) out.set('data-epub-type', kept.join(' '))
        break
      }
      case 'start':
        if (name === 'ol' && /^-?\d{1,6}$/.test(value.trim())) out.set('start', value.trim())
        break
      case 'reversed':
        if (name === 'ol') out.set('reversed', '')
        break
      case 'scope': {
        const scope = value.trim().toLocaleLowerCase()
        if (name === 'th' && ['row', 'col', 'rowgroup', 'colgroup'].includes(scope)) out.set('scope', scope)
        break
      }
      case 'datetime':
        if (name === 'time' || name === 'del' || name === 'ins') out.set('datetime', value)
        break
      default:
        if (attribute.namespaceURI === OPS_NS && attribute.localName === 'type') {
          const kept = tokens(value).filter(token => /^[A-Za-z][A-Za-z0-9:_-]*$/.test(token))
          if (kept.length > 0) out.set('data-epub-type', kept.join(' '))
        }
    }
  }
  if (name === 'a') {
    // Old HTML anchors (`<a name="Page_12">`) are link targets too.
    const legacyName = element.getAttribute('name')
    if (!out.has('id') && legacyName && anchorKey(legacyName)) out.set('id', readerAnchorId(walk.index, legacyName))
    link(walk, element, out)
  }
  if (name === 'img') {
    const src = walk.book.resolveImage(walk.directory, element.getAttribute('src'))
    if (src) out.set('src', src)
  }
  let serialized = ''
  for (const [key, value] of out) serialized += ` ${key}="${escapeAttribute(value)}"`
  return serialized
}

function link(walk: Walk, element: Element, out: Map<string, string>): void {
  const href = element.getAttribute('href') ?? attributeOf(element, 'xlink:href')
  if (href === null) return
  const value = urlForm(href)
  if (/^(?:https?|mailto):/i.test(value)) {
    try {
      const url = new URL(value)
      if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
        out.set('href', url.href)
        out.set('data-rd-external', '')
        out.set('rel', 'noopener noreferrer')
      }
    } catch {
      // Not a URL: no href.
    }
    return
  }
  const target = walk.book.resolveLink(walk.directory, walk.index, value)
  if (!target) return
  out.set('href', `#${target.anchor || readerChapterId(target.chapterIndex)}`)
  out.set('data-rd-chapter', String(target.chapterIndex))
  out.set('data-rd-anchor', target.anchor)
}

/**
 * Printed-page markers become `<span class="rd-pagenum" data-page="12" id="…"></span>`: empty, so the text does
 * not read "[Pg 12]", with the label for the reader's margin. The shapes: Project Gutenberg's ebookmaker EPUBs
 * (`<span class="x-ebookmaker-pageno" id="Page_12" title="12"></span>`), Gutenberg HTML
 * (`<span class="pagenum"><a id="Page_12">[Pg 12]</a></span>`), and EPUB3 page breaks
 * (`epub:type="pagebreak"`, `role="doc-pagebreak"`).
 */
function pageMarker(walk: Walk, element: Element, name: string): boolean {
  if (name !== 'span' && name !== 'a' && name !== 'div' && name !== 'hr' && name !== 'p') return false
  const classes = tokens(element.getAttribute('class'))
  const isMarker = classes.some(token => PAGE_MARKER_CLASSES.has(token.toLocaleLowerCase()))
    || epubTypeOf(element).includes('pagebreak')
    || element.getAttribute('role') === 'doc-pagebreak'
  if (!isMarker) return false
  const text = collapse(element.textContent)
  if (text.length > 32) return false // not a bare marker: let the walk keep its words

  const ids: string[] = []
  for (const candidate of [element, ...Array.from(element.querySelectorAll('*'))]) {
    const id = anchorKey(candidate.getAttribute('id') ?? (localNameOf(candidate) === 'a' ? candidate.getAttribute('name') ?? '' : ''))
    if (id && !ids.includes(id)) ids.push(id)
  }
  const fromText = /^\[?\s*(?:pg\.?|page|p\.)?\s*([^\]\s][^\]]*?)\s*\]?$/i.exec(text)?.[1] ?? ''
  const fromId = ids.map(id => /^page[_-]?(.+)$/i.exec(id)?.[1]).find(Boolean) ?? ''
  const label = collapse(element.getAttribute('title')) || collapse(element.getAttribute('aria-label')) || fromText || fromId
  if (!label || label.length > 16) return false

  let anchorId = ids[0]
  if (!anchorId) {
    do anchorId = `rd-pg-${walk.pageSequence++}`
    while (walk.ids.has(anchorId))
  }
  const anchor = readerAnchorId(walk.index, anchorId)
  walk.out.push(`<span class="rd-pagenum" data-page="${escapeAttribute(label)}" id="${escapeAttribute(anchor)}"></span>`)
  for (const extra of ids.slice(1)) walk.out.push(`<span id="${escapeAttribute(readerAnchorId(walk.index, extra))}"></span>`)
  walk.pages.push(Object.freeze({ page: label, anchor }))
  return true
}

/**
 * SVG is dropped, except the cover-wrapper shape (an `<svg>` holding one `<image>` and no text), which becomes
 * the plain `<img>` it stands for.
 */
function svgImage(walk: Walk, svg: Element): void {
  if (localNameOf(svg) !== 'svg') return
  const images = descendants(svg, 'image')
  if (images.length !== 1 || collapse(svg.textContent).length > 0) return
  const image = images[0]!
  const src = walk.book.resolveImage(walk.directory, attributeOf(image, 'xlink:href', 'http://www.w3.org/1999/xlink') ?? image.getAttribute('href'))
  if (!src) return
  let size = ''
  for (const key of ['width', 'height']) {
    const value = (image.getAttribute(key) ?? '').trim()
    if (DIGITS.test(value)) size += ` ${key}="${value}"`
  }
  walk.out.push(`<img src="${escapeAttribute(src)}" alt=""${size}>`)
}

function collectIds(document: Document): Set<string> {
  const ids = new Set<string>()
  for (const element of Array.from(document.getElementsByTagName('*'))) {
    const id = anchorKey(element.getAttribute('id') ?? '')
    if (id) ids.add(id)
    if (localNameOf(element) === 'a') {
      const legacy = anchorKey(element.getAttribute('name') ?? '')
      if (legacy) ids.add(legacy)
    }
  }
  return ids
}

// ---------------------------------------------------------------------------------------------------------------
// The book

export async function readEpubBook(bytes: Uint8Array, filename: string): Promise<ReaderBook> {
  if (typeof DOMParser === 'undefined') throw new Error('Reading an EPUB requires a DOM parser')
  const { unzipSync } = await import('fflate')
  const archive = new Archive(unzipSync(bytes))

  const containerBytes = archive.get('META-INF/container.xml')
  if (!containerBytes) throw new Error('EPUB is missing META-INF/container.xml')
  const container = parseXml(decodeText(containerBytes), 'EPUB container')
  const rootfiles = descendants(container, 'rootfile')
  const packagePath = archivePath(
    (rootfiles.find(element => /oebps-package/i.test(element.getAttribute('media-type') ?? '')) ?? rootfiles[0])
      ?.getAttribute('full-path')?.trim() ?? '',
  )
  const packageBytes = packagePath ? archive.get(packagePath) : null
  if (!packageBytes) throw new Error('EPUB package document is unavailable')
  const pkg = parseXml(decodeText(packageBytes), 'EPUB package')
  const packageDirectory = archiveDirectory(packagePath)
  const packageElement = descendants(pkg, 'package')[0] ?? pkg.documentElement

  // Metadata
  const metadata = descendants(pkg, 'metadata')[0] ?? packageElement
  const firstText = (localName: string): string => collapse(descendants(metadata, localName)[0]?.textContent)
  const title = firstText('title') || basename(filename).replace(/\.epub$/i, '') || 'EPUB'
  const author = firstText('creator')
  const language = firstText('language') || (attributeOf(packageElement, 'xml:lang') ?? '').trim()
  const publisher = firstText('publisher')

  // Manifest
  const manifest = new Map<string, ManifestItem>()
  for (const element of descendants(pkg, 'item')) {
    const id = element.getAttribute('id')?.trim() ?? ''
    const href = element.getAttribute('href')?.trim() ?? ''
    if (!id || !href || manifest.has(id)) continue
    manifest.set(id, Object.freeze({
      id,
      href,
      path: joinArchivePath(packageDirectory, href),
      mediaType: element.getAttribute('media-type')?.trim() ?? '',
      properties: tokens(element.getAttribute('properties')),
    }))
  }

  // Spine: every itemref in order, non-linear ones included.
  const spineElement = descendants(pkg, 'spine')[0]
  const spine: SpineItem[] = []
  for (const itemref of descendants(spineElement ?? pkg, 'itemref')) {
    const item = manifest.get(itemref.getAttribute('idref')?.trim() ?? '')
    if (!item || !archive.get(item.path)) continue
    if (!isMarkupItem(item) && !imageMimeFor(item.path, item.mediaType)) continue
    spine.push({ item, linear: (itemref.getAttribute('linear') ?? '').trim().toLocaleLowerCase() !== 'no' })
  }
  if (spine.length === 0) {
    // No usable spine: the manifest's documents, in manifest order.
    for (const item of manifest.values()) {
      if (isMarkupItem(item) && !item.properties.includes('nav') && archive.get(item.path)) spine.push({ item, linear: true })
    }
  }
  if (spine.length === 0) throw new Error('EPUB contains no readable chapters')
  const book = new Book(archive, spine, manifest.values())

  // Cover: EPUB3 properties="cover-image", else EPUB2 <meta name="cover" content="id">.
  const items = [...manifest.values()]
  const metaCover = descendants(metadata, 'meta').find(element => element.getAttribute('name')?.trim().toLocaleLowerCase() === 'cover')
    ?.getAttribute('content')?.trim() ?? ''
  const coverItem = items.find(item => item.properties.includes('cover-image') && imageMimeFor(item.path, item.mediaType))
    ?? [manifest.get(metaCover), items.find(item => item.href === metaCover)]
      .find(item => item !== undefined && imageMimeFor(item.path, item.mediaType) !== null)
  const cover = coverItem ? book.image(coverItem.path) : null

  // Table of contents
  let toc: TocBuild = { entries: [], titles: new Map() }
  let tocSource: ReaderBook['tocSource'] = 'spine'
  const navItem = items.find(item => item.properties.includes('nav'))
  const navBytes = navItem ? archive.get(navItem.path) : null
  if (navItem && navBytes) {
    toc = navToc(book, parseChapter(decodeText(navBytes), true), navItem.path)
    if (toc.entries.length > 0) tocSource = 'nav'
  }
  if (toc.entries.length === 0) {
    const ncxId = spineElement?.getAttribute('toc')?.trim() ?? ''
    const ncxItem = manifest.get(ncxId) ?? items.find(item => /dtbncx/i.test(item.mediaType) || /\.ncx$/i.test(item.href))
    const ncxBytes = ncxItem ? archive.get(ncxItem.path) : null
    if (ncxItem && ncxBytes) {
      try {
        toc = ncxToc(book, parseXml(decodeText(ncxBytes), 'EPUB NCX'), ncxItem.path)
        if (toc.entries.length > 0) tocSource = 'ncx'
      } catch {
        // A malformed NCX: the spine stands in for it below.
      }
    }
  }

  // Chapters, one parsed document at a time.
  const chapters: ReaderChapter[] = spine.map(({ item, linear }, index) => {
    const xml = /xhtml|xml/i.test(item.mediaType) || /\.(?:xhtml|xml)$/i.test(item.href)
    const document = isMarkupItem(item) ? parseChapter(decodeText(archive.get(item.path)!), xml) : null
    const walk: Walk = {
      book,
      index,
      directory: archiveDirectory(item.path),
      ids: document ? collectIds(document) : new Set(),
      out: [],
      text: [],
      pages: [],
      heading: null,
      headingText: '',
      pageSequence: 0,
    }
    let documentTitleText = ''
    let chapterLanguage = ''
    if (document) {
      const body = bodyOf(document)
      if (body) walkChildren(walk, body, 0)
      documentTitleText = documentTitle(document)
      chapterLanguage = documentLanguage(document)
    } else {
      // An image in the spine (a picture book's page): the picture is the chapter.
      const src = book.image(item.path)
      if (src) walk.out.push(`<img src="${escapeAttribute(src)}" alt="">`)
    }
    return Object.freeze({
      index,
      id: item.id || item.path,
      path: item.path,
      title: toc.titles.get(index) || walk.headingText || documentTitleText || `Chapter ${index + 1}`,
      html: walk.out.join(''),
      wordCount: countWords(walk.text.join('')),
      linear,
      language: chapterLanguage,
      pages: Object.freeze(walk.pages),
    })
  })

  const entries = toc.entries.length > 0
    ? toc.entries
    : chapters.map(chapter => tocEntry(chapter.title, chapter.index, null, []))

  return Object.freeze({
    title,
    author,
    language,
    publisher,
    cover,
    toc: Object.freeze(entries),
    chapters: Object.freeze(chapters),
    tocSource,
    version: (packageElement.getAttribute('version') ?? '').trim(),
  })
}
