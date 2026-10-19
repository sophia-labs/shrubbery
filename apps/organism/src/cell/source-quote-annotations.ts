/**
 * source-quote-annotations.ts — draw a document's comments and highlights over
 * its original file by quoted text.
 *
 * An imported document (an EPUB, say) keeps its comments in the Y.Doc
 * `comments` map; each comment carries the passage it was made on
 * (`quotedText`) and the block it was anchored in. The original file has no
 * block ids, so the only shared key is the text itself. This module finds a
 * quote in a chapter's text and wraps it in `<mark>` elements, the way Garden's
 * legacy viewer did (`frontend/src/lib/source-annotations.ts`), with these
 * differences:
 *
 * - Matching is tolerant of what differs between an imported block and its
 *   source markup: runs of whitespace, curly versus straight quotes, dashes, an
 *   ellipsis written as one character or as dots, soft hyphens, and case.
 * - A quote with an ellipsis that is not in the source is read as an elision:
 *   its pieces are found in order and the whole passage is marked.
 * - A quote may cross inline elements (`<i>`, `<cite>`, a footnote reference):
 *   each text node it touches gets its own `<mark>`, so no element is split or
 *   moved.
 * - The comment's block text, when known, chooses among repeated occurrences.
 * - Anything not found is returned, so the caller can report it.
 *
 * Everything that comes from a comment reaches the markup through DOM
 * attribute and text APIs, never as markup.
 */

export type SourceQuoteKind = 'comment' | 'highlight'

export interface SourceQuoteAnnotation {
  readonly id: string
  readonly kind: SourceQuoteKind
  /** The passage, as stored on the comment or covered by the highlight. */
  readonly quote: string
  /** The comment's own words. */
  readonly text?: string | null
  readonly author?: string | null
  /** The text of the block the annotation sits in, used to pick among repeats. */
  readonly context?: string | null
}

/** Matching-ready text: `text` keeps case, `folded` is the same text lower-cased, character for character. */
export interface QuoteSearchText {
  readonly text: string
  readonly folded: string
}

export interface QuoteTextIndex extends QuoteSearchText {
  readonly nodes: readonly Text[]
  /** For each character of `text`: the index into `nodes` it came from. */
  readonly pointNode: readonly number[]
  /** For each character of `text`: its offset in that text node. */
  readonly pointOffset: readonly number[]
}

export interface QuoteRange {
  readonly start: number
  readonly end: number
}

/** The shortest quote worth drawing; one character would mark noise. */
export const MIN_QUOTE_LENGTH = 2
/** How far apart the pieces of an elided quote may be, in normalized characters. */
export const MAX_ELISION_GAP = 2400
/** A context longer than this is matched by its beginning (an edited block may have grown). */
const CONTEXT_PREFIX = 160

const DROPPED = /[­​-‍⁠﻿]/
const SINGLE_QUOTES = /[‘’‚‛′ʼ]/
const DOUBLE_QUOTES = /[“”„‟″«»]/
const DASHES = /[‐-―−]/
const SPACE = /\s/

function canonical(char: string): string {
  if (SPACE.test(char)) return ' '
  if (DROPPED.test(char)) return ''
  if (SINGLE_QUOTES.test(char)) return "'"
  if (DOUBLE_QUOTES.test(char)) return '"'
  if (DASHES.test(char)) return '-'
  if (char === '…') return '...'
  return char
}

function foldChar(char: string): string {
  const lower = char.toLowerCase()
  return lower.length === char.length ? lower : char
}

/**
 * One normalizer for quotes and for source text, so both sides agree:
 * whitespace collapses to one space (none at the start), dashes collapse to one
 * `-` with no space around it, three or more dots are `...`.
 */
class QuoteTextBuilder {
  private readonly chars: string[] = []
  private readonly foldedChars: string[] = []
  readonly pointNode: number[] = []
  readonly pointOffset: number[] = []
  private pendingSpace = false

  /** A block boundary: the next character is a new word even without whitespace between. */
  boundary(): void {
    this.pendingSpace = true
  }

  push(char: string, node = -1, offset = -1): void {
    for (const piece of canonical(char)) this.emit(piece, node, offset)
  }

  private last(back = 1): string {
    return this.chars[this.chars.length - back] ?? ''
  }

  private pop(): void {
    this.chars.pop()
    this.foldedChars.pop()
    this.pointNode.pop()
    this.pointOffset.pop()
  }

  private append(char: string, node: number, offset: number): void {
    this.chars.push(char)
    this.foldedChars.push(foldChar(char))
    this.pointNode.push(node)
    this.pointOffset.push(offset)
  }

  private emit(char: string, node: number, offset: number): void {
    if (char === ' ') {
      this.pendingSpace = false
      if (this.chars.length === 0 || this.last() === ' ' || this.last() === '-') return
      this.append(' ', node, offset)
      return
    }
    if (this.pendingSpace) {
      this.pendingSpace = false
      if (this.chars.length > 0 && this.last() !== ' ' && this.last() !== '-' && char !== '-') {
        this.append(' ', node, offset)
      }
    }
    if (char === '-') {
      if (this.last() === ' ') this.pop()
      if (this.last() === '-') return
    }
    // A fourth dot and beyond: "floor...." keeps three, so it meets "floor…".
    if (char === '.' && this.last() === '.' && this.last(2) === '.' && this.last(3) === '.') return
    this.append(char, node, offset)
  }

  finish(): QuoteSearchText {
    while (this.last() === ' ') this.pop()
    return { text: this.chars.join(''), folded: this.foldedChars.join('') }
  }
}

function searchFormOf(value: string): QuoteSearchText {
  const builder = new QuoteTextBuilder()
  // A spaced ellipsis (". . .") in a quote is an ellipsis.
  const source = value.replace(/\.(?:[ \t ]*\.){2,}/g, '...')
  for (let index = 0; index < source.length; index += 1) builder.push(source[index]!)
  return builder.finish()
}

/** The matching form of a quote (or any plain string). */
export function normalizeQuoteText(value: string): string {
  return searchFormOf(value).text
}

const SKIPPED_ELEMENTS = new Set(['head', 'script', 'style', 'noscript', 'template', 'title'])
const BLOCK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure',
  'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'img', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])
/** Text directly inside these is whitespace the parser keeps; a mark there would be moved out on reparse. */
const NO_MARK_PARENTS = new Set(['table', 'tbody', 'thead', 'tfoot', 'tr', 'colgroup', 'select', 'ol', 'ul', 'dl'])

const TEXT_NODE = 3
const ELEMENT_NODE = 1

/** Index the text under `root` with a pointer back to each character's text node. */
export function quoteTextIndex(root: Node): QuoteTextIndex {
  const builder = new QuoteTextBuilder()
  const nodes: Text[] = []
  const visit = (parent: Node): void => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === TEXT_NODE) {
        const text = child as Text
        const nodeIndex = nodes.push(text) - 1
        const data = text.data
        for (let offset = 0; offset < data.length; offset += 1) builder.push(data[offset]!, nodeIndex, offset)
      } else if (child.nodeType === ELEMENT_NODE) {
        const name = (child as Element).localName.toLowerCase()
        if (SKIPPED_ELEMENTS.has(name)) continue
        const block = BLOCK_ELEMENTS.has(name)
        if (block) builder.boundary()
        visit(child)
        if (block) builder.boundary()
      }
    }
  }
  visit(root)
  const { text, folded } = builder.finish()
  return {
    text,
    folded,
    nodes,
    pointNode: builder.pointNode.slice(0, text.length),
    pointOffset: builder.pointOffset.slice(0, text.length),
  }
}

/** The search form of the text under `root` (no node pointers; for choosing a chapter). */
export function quoteSearchText(root: Node): QuoteSearchText {
  const { text, folded } = quoteTextIndex(root)
  return { text, folded }
}

function findIn(haystack: QuoteSearchText, needle: QuoteSearchText, from: number, to: number): QuoteRange | null {
  if (needle.text.length < MIN_QUOTE_LENGTH) return null
  const exact = haystack.text.indexOf(needle.text, from)
  if (exact >= 0 && exact + needle.text.length <= to) return { start: exact, end: exact + needle.text.length }
  const folded = haystack.folded.indexOf(needle.folded, from)
  if (folded >= 0 && folded + needle.folded.length <= to) return { start: folded, end: folded + needle.folded.length }
  return null
}

/** An elided quote: every piece in order, each within MAX_ELISION_GAP of the one before. */
function findElided(haystack: QuoteSearchText, needle: QuoteSearchText, from: number, to: number): QuoteRange | null {
  if (!needle.folded.includes('...')) return null
  const pieces = needle.folded.split('...').map(piece => piece.trim()).filter(piece => piece.length >= MIN_QUOTE_LENGTH)
  if (pieces.length === 0) return null
  const [first, ...rest] = pieces as [string, ...string[]]
  let start = haystack.folded.indexOf(first, from)
  while (start >= 0 && start + first.length <= to) {
    let cursor = start + first.length
    let complete = true
    for (const piece of rest) {
      const next = haystack.folded.indexOf(piece, cursor)
      if (next < 0 || next + piece.length > to) return null
      if (next - cursor > MAX_ELISION_GAP) {
        complete = false
        break
      }
      cursor = next + piece.length
    }
    if (complete) return { start, end: cursor }
    start = haystack.folded.indexOf(first, start + 1)
  }
  return null
}

function findQuoteBetween(haystack: QuoteSearchText, quote: QuoteSearchText, from: number, to: number): QuoteRange | null {
  return findIn(haystack, quote, from, to) ?? findElided(haystack, quote, from, to)
}

function contextRange(haystack: QuoteSearchText, context: string | null | undefined): QuoteRange | null {
  const form = context ? searchFormOf(context) : null
  if (!form || form.text.length < MIN_QUOTE_LENGTH) return null
  const whole = findIn(haystack, form, 0, haystack.text.length)
  if (whole) return whole
  if (form.text.length <= CONTEXT_PREFIX) return null
  const prefix = searchFormOf(form.text.slice(0, CONTEXT_PREFIX))
  const head = findIn(haystack, prefix, 0, haystack.text.length)
  // The block may have grown or changed at its end: search from its beginning to as far as it was long.
  return head ? { start: head.start, end: Math.min(haystack.text.length, head.start + form.text.length + CONTEXT_PREFIX) } : null
}

/** The quote within its block's text, when that block is found here. */
export function findQuoteInContext(haystack: QuoteSearchText, annotation: Pick<SourceQuoteAnnotation, 'quote' | 'context'>): QuoteRange | null {
  const range = contextRange(haystack, annotation.context)
  return range ? findQuoteBetween(haystack, searchFormOf(annotation.quote), range.start, range.end) : null
}

/** The first occurrence of the quote anywhere here. */
export function findQuote(haystack: QuoteSearchText, quote: string): QuoteRange | null {
  return findQuoteBetween(haystack, searchFormOf(quote), 0, haystack.text.length)
}

/** Where an annotation lands in this text: inside its own block if that block is here, else its first occurrence. */
export function findAnnotationRange(haystack: QuoteSearchText, annotation: Pick<SourceQuoteAnnotation, 'quote' | 'context'>): QuoteRange | null {
  return findQuoteInContext(haystack, annotation) ?? findQuote(haystack, annotation.quote)
}

export interface QuoteChapterText extends QuoteSearchText {
  readonly id: string
}

/**
 * Choose a chapter for each annotation: the first chapter (in reading order)
 * that holds its block with the quote inside it, else the first that holds the
 * quote at all. `null` means it is not in the book.
 */
export function locateQuoteAnnotations(
  chapters: readonly QuoteChapterText[],
  annotations: readonly SourceQuoteAnnotation[],
): ReadonlyMap<string, string | null> {
  const located = new Map<string, string | null>()
  for (const annotation of annotations) {
    let chapterId: string | null = null
    if (annotation.context) chapterId = chapters.find(chapter => findQuoteInContext(chapter, annotation))?.id ?? null
    chapterId ??= chapters.find(chapter => findQuote(chapter, annotation.quote))?.id ?? null
    located.set(annotation.id, chapterId)
  }
  return located
}

interface MarkSegment {
  readonly start: number
  readonly end: number
  readonly annotation: SourceQuoteAnnotation
}

const MARK_CLASS = 'mn-quote-mark'

/** The value a mark carries in `data-annotation-ids` for one annotation id (ids are free text). */
export function markToken(annotationId: string): string {
  return encodeURIComponent(annotationId)
}

function titleFor(annotations: readonly SourceQuoteAnnotation[]): string {
  return annotations.map(annotation => {
    if (annotation.kind === 'highlight') return 'Highlight'
    const text = (annotation.text ?? '').trim()
    const author = (annotation.author ?? '').trim()
    const body = text.length > 400 ? `${text.slice(0, 399)}…` : text
    return [author, body || 'Comment'].filter(Boolean).join(': ')
  }).join('\n\n')
}

function wrapTextNode(document: Document, node: Text, segments: readonly MarkSegment[]): void {
  const parentName = node.parentElement?.localName.toLowerCase() ?? ''
  if (NO_MARK_PARENTS.has(parentName)) return
  const data = node.data
  const cuts = new Set<number>([0, data.length])
  for (const segment of segments) {
    cuts.add(segment.start)
    cuts.add(segment.end)
  }
  const ordered = [...cuts].sort((left, right) => left - right)
  const fragment = document.createDocumentFragment()
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const from = ordered[index]!
    const to = ordered[index + 1]!
    if (to <= from) continue
    const piece = data.slice(from, to)
    const covering = segments.filter(segment => segment.start <= from && segment.end >= to).map(segment => segment.annotation)
    if (covering.length === 0) {
      fragment.append(document.createTextNode(piece))
      continue
    }
    const mark = document.createElement('mark')
    mark.className = MARK_CLASS
    mark.setAttribute('data-annotation-ids', [...new Set(covering.map(annotation => markToken(annotation.id)))].join(' '))
    mark.setAttribute('data-kind', [...new Set(covering.map(annotation => annotation.kind))].sort().join(' '))
    mark.setAttribute('title', titleFor(covering))
    mark.textContent = piece
    fragment.append(mark)
  }
  node.replaceWith(fragment)
}

/** Literal colours: the chapter frame is its own document and Shrubbery's tokens do not reach it. */
export const QUOTE_MARK_CSS = `
mark.${MARK_CLASS} {
  color: inherit;
  background: rgba(250, 204, 21, 0.38);
  border-radius: 2px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
mark.${MARK_CLASS}[data-kind~="comment"] {
  background: rgba(245, 158, 11, 0.22);
  border-bottom: 2px solid rgba(217, 119, 6, 0.85);
  cursor: help;
}
mark.${MARK_CLASS}.${MARK_CLASS}-active {
  outline: 2px solid rgba(217, 119, 6, 0.95);
  outline-offset: 1px;
}
`

/**
 * Wrap every annotation found in `document`'s body in `<mark>` elements and add
 * their style. Returns the ids that were drawn, each with where it starts in the
 * text (for reading order); the rest were not found here.
 */
export function markQuoteAnnotations(
  document: Document,
  annotations: readonly SourceQuoteAnnotation[],
): ReadonlyMap<string, number> {
  const drawn = new Map<string, number>()
  const root = document.body ?? document.documentElement
  if (!root || annotations.length === 0) return drawn
  const index = quoteTextIndex(root)
  const segmentsByNode = new Map<number, MarkSegment[]>()
  for (const annotation of annotations) {
    const range = findAnnotationRange(index, annotation)
    if (!range) continue
    const spans = new Map<number, [number, number]>()
    for (let position = range.start; position < range.end; position += 1) {
      const node = index.pointNode[position]!
      const offset = index.pointOffset[position]!
      if (node < 0) continue
      const span = spans.get(node)
      if (span) {
        span[0] = Math.min(span[0], offset)
        span[1] = Math.max(span[1], offset + 1)
      } else {
        spans.set(node, [offset, offset + 1])
      }
    }
    let anyText = false
    for (const [node, [start, end]] of spans) {
      if (!index.nodes[node]!.data.slice(start, end).trim()) continue
      anyText = true
      const list = segmentsByNode.get(node) ?? []
      list.push({ start, end, annotation })
      segmentsByNode.set(node, list)
    }
    if (anyText) drawn.set(annotation.id, range.start)
  }
  for (const [node, segments] of segmentsByNode) wrapTextNode(document, index.nodes[node]!, segments)
  if (drawn.size > 0) {
    const head = document.head ?? document.documentElement.insertBefore(document.createElement('head'), document.body)
    const style = document.createElement('style')
    style.setAttribute('data-mn-quote-marks', '')
    style.textContent = QUOTE_MARK_CSS
    head.append(style)
  }
  return drawn
}
