/**
 * Card labels. CSS cannot ellipsise in the middle, so the display string is made here.
 *
 * A name that fits the character budget for the card width is shown as it is. A longer one keeps its head, an
 * ellipsis, and a tail that always holds the extension and the last word before it: "Thermal test report – batch 7
 * – final review.pdf" becomes "Thermal test report – b…review.pdf" at the medium budget and "Thermal t…review.pdf"
 * at the small one. Budgets are counted in grapheme clusters, so a family emoji or a letter with combining marks is
 * never split. The full name stays the `title`, the accessible name and the margin's identity line.
 */

export type LabelSize = 'small' | 'medium' | 'large'

/** Characters (grapheme clusters) per card width, for `iconSize` small, medium and large. */
export const LABEL_BUDGET: Readonly<Record<LabelSize, number>> = Object.freeze({ small: 20, medium: 34, large: 48 })

export const ELLIPSIS = '…'

type Segmenter = { segment(input: string): Iterable<{ segment: string }> }
let segmenter: Segmenter | null | undefined

function graphemeSegmenter(): Segmenter | null {
  if (segmenter === undefined) {
    const ctor = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => Segmenter }).Segmenter
    segmenter = ctor ? new ctor(undefined, { granularity: 'grapheme' }) : null
  }
  return segmenter
}

/** Grapheme clusters of `text`; code points where `Intl.Segmenter` is unavailable. */
export function graphemes(text: string): string[] {
  const s = graphemeSegmenter()
  return s ? Array.from(s.segment(text), (part) => part.segment) : Array.from(text)
}

export function graphemeCount(text: string): number {
  return graphemes(text).length
}

const isSeparator = (g: string): boolean => /^[\s_\-–—]+$/u.test(g)

/** `[stem, extension]`; the extension keeps its dot and is at most eight letters or digits. */
function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return [name, '']
  return /^[A-Za-z0-9]{1,8}$/.test(name.slice(dot + 1)) ? [name.slice(0, dot), name.slice(dot)] : [name, '']
}

/** The string a card shows for `name` within `size`'s budget (or an explicit grapheme count). */
export function displayLabel(name: string, size: LabelSize | number = 'medium'): string {
  const budget = Math.max(1, Math.floor(typeof size === 'number' ? size : LABEL_BUDGET[size]))
  const normal = name.replace(/\s+/gu, ' ').trim()
  const all = graphemes(normal)
  if (all.length <= budget) return normal
  if (budget <= 2) return all.slice(0, budget - 1).join('') + ELLIPSIS

  const [stem, ext] = splitExtension(normal)
  const extG = graphemes(ext)
  const stemG = graphemes(stem)
  let end = stemG.length
  while (end > 0 && isSeparator(stemG[end - 1]!)) end--
  let start = end
  while (start > 0 && !isSeparator(stemG[start - 1]!)) start--

  let tail = [...stemG.slice(start, end), ...extG]
  // The head keeps at least two fifths of the budget; the tail may take the rest, and always leaves one
  // grapheme of head. A cut takes the front of the tail, so the extension is kept whenever it fits at all.
  const tailMax = Math.max(1, Math.min(budget - 2, Math.max(extG.length + 3, budget - 1 - Math.ceil(0.4 * budget))))
  if (tail.length > tailMax) tail = tail.slice(tail.length - tailMax)
  const head = all.slice(0, budget - 1 - tail.length).join('').replace(/\s+$/u, '')
  return `${head}${ELLIPSIS}${tail.join('')}`
}
