/**
 * The Reader's model: what a highlight or note on an original is, where it sits, and how a selection becomes one.
 *
 * One annotation layer serves both surfaces. A PDF's text layer and an EPUB chapter are both plain DOM text, so an
 * annotation is found by its quoted words (the same matcher that draws an agent's comments over an EPUB), turned into
 * DOM Ranges, and painted with the CSS Custom Highlight API: nothing in the page is rewritten, and the text stays the
 * text a person selects and copies.
 */
import {
  findAnnotationRange,
  quoteTextIndex,
  type QuoteTextIndex,
  type SourceQuoteAnnotation,
} from '../source-quote-annotations.js'

/** The highlighter's colours, by name. The names are stored; what they look like is the reader's stylesheet. */
export const READER_COLORS = ['yellow', 'green', 'blue', 'pink'] as const
export type ReaderColor = typeof READER_COLORS[number]

export function readerColor(value: unknown): ReaderColor {
  return READER_COLORS.includes(value as ReaderColor) ? value as ReaderColor : 'yellow'
}

/** Where on the original an annotation was made: a PDF page (1-based) or an EPUB chapter (spine index). */
export type ReaderPlace =
  | { readonly kind: 'page'; readonly page: number }
  | { readonly kind: 'chapter'; readonly chapterIndex: number }

/** A highlight or note to draw. `place` is a hint: the quote is searched there first, then everywhere. */
export interface ReaderAnnotation extends SourceQuoteAnnotation {
  readonly color: ReaderColor
  readonly place?: ReaderPlace | null
  /** Words just before and after the quote, to choose among repeats. */
  readonly prefix?: string | null
  readonly suffix?: string | null
  /** Made by this person (an agent's finding is not theirs to delete). */
  readonly mine?: boolean
  /** Who signed it, when the author shown is the name a workflow or agent gave. */
  readonly signedBy?: string | null
}

/** What a person asked for over a selection. */
export interface ReaderAnnotateDetail {
  readonly kind: 'highlight' | 'comment'
  readonly color: ReaderColor
  readonly quote: string
  readonly prefix: string
  readonly suffix: string
  readonly place: ReaderPlace
  /** A note's words; empty for a highlight. */
  readonly text: string
}

export interface ReaderAnnotationChangeDetail {
  readonly id: string
  readonly action: 'recolor' | 'edit' | 'delete'
  readonly color?: ReaderColor
  readonly text?: string
}

const CONTEXT_CHARS = 48

/**
 * The live selection inside `root`, as a Range in `root`'s tree. Engines disagree about selections in shadow trees:
 * WebKit's `getRangeAt` answers with the range rescoped to the shadow host (and calls it collapsed), so composed ranges
 * (which see into the roots named) are asked first wherever they exist; `getRangeAt` is the fallback without them.
 */
export function selectionIn(root: ShadowRoot): Range | null {
  const own = (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.()
  const selection = own ?? document.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const composed = (selection as Selection & { getComposedRanges?: (...args: unknown[]) => StaticRange[] }).getComposedRanges
  if (typeof composed === 'function') {
    const roots = shadowAncestry(root)
    let ranges: StaticRange[] = []
    try { ranges = composed.call(selection, { shadowRoots: roots }) } catch { ranges = composed.call(selection, ...roots) }
    const first = ranges[0]
    if (first && !first.collapsed && root.contains(first.startContainer) && root.contains(first.endContainer)) {
      const range = document.createRange()
      range.setStart(first.startContainer, first.startOffset)
      range.setEnd(first.endContainer, first.endOffset)
      return range
    }
  }
  if (selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  return root.contains(range.startContainer) && root.contains(range.endContainer) ? range : null
}

function shadowAncestry(root: ShadowRoot): ShadowRoot[] {
  const roots: ShadowRoot[] = []
  let node: Node | null = root
  while (node) {
    if (node instanceof ShadowRoot) { roots.push(node); node = node.host } else node = node.parentNode
  }
  return roots
}

/** The quote and its context for a selection inside `scope` (one PDF page's text layer, or one chapter). */
export function selectionQuote(scope: Element, range: Range): { quote: string; prefix: string; suffix: string } | null {
  const quote = range.toString().replace(/\s+/g, ' ').trim()
  if (quote.length < 2) return null
  const before = document.createRange()
  before.selectNodeContents(scope)
  before.setEnd(range.startContainer, range.startOffset)
  const after = document.createRange()
  after.selectNodeContents(scope)
  after.setStart(range.endContainer, range.endOffset)
  const squash = (value: string) => value.replace(/\s+/g, ' ')
  return {
    quote,
    prefix: squash(before.toString()).trimEnd().slice(-CONTEXT_CHARS).trimStart(),
    suffix: squash(after.toString()).trimStart().slice(0, CONTEXT_CHARS).trimEnd(),
  }
}

/** The DOM Range of an annotation inside an indexed root, or null when its words are not there. */
export function annotationRange(index: QuoteTextIndex, annotation: ReaderAnnotation): Range | null {
  const context = [annotation.prefix, annotation.quote, annotation.suffix].filter(Boolean).join(' ')
  const found = findAnnotationRange(index, { quote: annotation.quote, context: annotation.context ?? (context || null) })
  if (!found || found.end <= found.start) return null
  // A match can begin or end on a boundary the index inserted between blocks (no text node): step inward to text.
  let first = found.start
  let last = found.end - 1
  while (first <= last && (index.pointNode[first] ?? -1) < 0) first += 1
  while (last >= first && (index.pointNode[last] ?? -1) < 0) last -= 1
  if (first > last) return null
  const startNode = index.nodes[index.pointNode[first]!]
  const endNode = index.nodes[index.pointNode[last]!]
  if (!startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, index.pointOffset[first]!)
  range.setEnd(endNode, index.pointOffset[last]! + 1)
  return range
}

export { quoteTextIndex }

/** Ranges painted by colour, find matches, and the active annotation: one registry per reader, named per instance. */
export class ReaderHighlights {
  private readonly names: Record<string, string>
  private readonly supported = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function'

  constructor(readonly prefix: string) {
    this.names = Object.fromEntries([...READER_COLORS, 'note', 'active', 'find', 'find-current'].map(key => [key, `${prefix}-${key}`]))
  }

  get available(): boolean { return this.supported }

  name(key: string): string { return this.names[key] ?? `${this.prefix}-${key}` }

  /** Replace what is painted under `key` with `ranges`. */
  paint(key: string, ranges: readonly Range[]): void {
    if (!this.supported) return
    const name = this.name(key)
    if (ranges.length === 0) { CSS.highlights.delete(name); return }
    const highlight = new Highlight(...ranges)
    if (key === 'active' || key === 'find-current') highlight.priority = 2
    else if (key === 'find') highlight.priority = 1
    CSS.highlights.set(name, highlight)
  }

  clear(): void {
    if (!this.supported) return
    for (const name of Object.values(this.names)) CSS.highlights.delete(name)
  }
}

/** Does any client rect of `range` contain the point? (Custom highlights are not elements, so clicks are tested here.) */
export function rangeContainsPoint(range: Range, x: number, y: number): boolean {
  for (const rect of Array.from(range.getClientRects())) {
    if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1) return true
  }
  return false
}
