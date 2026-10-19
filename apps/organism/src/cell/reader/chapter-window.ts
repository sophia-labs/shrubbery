/**
 * Continuous reading: which chapters of a book are in the page for a scroll position. Pure, so it is tested without a
 * browser. The Reader measures the rendered chapters (their heights, in order) and the scroll position, and asks for the
 * next window; it renders what comes back and keeps the reading line still (scroll anchoring) when the top changes.
 */
export interface ChapterWindow { readonly first: number; readonly last: number }

export interface WindowInput {
  /** Chapters in the book. */
  readonly count: number
  /** The chapters now rendered, `first..last` inclusive. */
  readonly current: ChapterWindow
  /** Measured height in px of each rendered chapter, in order (length `last - first + 1`). */
  readonly heights: readonly number[]
  /** Scroll offset in px from the top of the first rendered chapter. */
  readonly scrollTop: number
  /** Visible height in px. */
  readonly viewport: number
  /** How near an edge (px) before the next chapter is rendered. Default: 1.5 viewports. */
  readonly buffer?: number
  /** The most chapters rendered at once. Default 5. */
  readonly maxRendered?: number
}

export function clampWindow(window: ChapterWindow, count: number): ChapterWindow {
  const first = Math.max(0, Math.min(count - 1, window.first))
  const last = Math.max(first, Math.min(count - 1, window.last))
  return { first, last }
}

/** Where to start when jumping to a chapter: just that one; the edges grow from there as it is measured. */
export function windowAt(chapter: number, count: number): ChapterWindow {
  return clampWindow({ first: chapter, last: chapter }, count)
}

/** The next window: grow toward an edge the reader is near, drop chapters far past the other, never more than `maxRendered`. */
export function nextChapterWindow(input: WindowInput): ChapterWindow {
  const { count, scrollTop, viewport } = input
  if (count <= 0) return { first: 0, last: 0 }
  const buffer = input.buffer ?? Math.round(viewport * 1.5)
  const max = Math.max(2, input.maxRendered ?? 5)
  const trim = buffer * 2 + viewport
  let { first, last } = clampWindow(input.current, count)
  const heights = input.heights
  const total = heights.reduce((sum, h) => sum + h, 0)
  const viewTop = scrollTop
  const viewBottom = scrollTop + viewport
  if (viewTop < buffer && first > 0) first -= 1
  if (total - viewBottom < buffer && last < count - 1) last += 1
  // Heights are those of the old window; the chapter just added has none yet and is never trimmed this round.
  const offset = (index: number): number => heights.slice(0, index - input.current.first).reduce((sum, h) => sum + h, 0)
  while (first < last && first >= input.current.first && offset(first) + (heights[first - input.current.first] ?? 0) < viewTop - trim) first += 1
  while (last > first && last <= input.current.last && offset(last) > viewBottom + trim) last -= 1
  while (last - first + 1 > max) {
    // Over the cap: drop the end farther from the reading line.
    const line = viewTop + viewport / 2
    const topGap = line - (offset(first) + (heights[first - input.current.first] ?? 0))
    const bottomGap = offset(last) - line
    if (topGap >= bottomGap) first += 1; else last -= 1
  }
  return { first, last }
}

/** The chapter at a reading line (px from the top of the first rendered chapter): the last whose top is at or above it. */
export function chapterAtLine(window: ChapterWindow, heights: readonly number[], line: number): number {
  let top = 0
  for (let i = 0; i <= window.last - window.first; i++) {
    const height = heights[i] ?? 0
    if (line < top + height || i === window.last - window.first) return window.first + i
    top += height
  }
  return window.first
}

// --- the height of the whole book -------------------------------------------------------------------------------------
//
// In continuous mode only a few chapters are in the page, but the scrollbar should be the size of the book. Every chapter
// outside the window is a gap of its estimated height: its measured height if it was ever rendered at this type size and
// measure, else its words times the px-per-word of the chapters that are rendered now.

/** A first guess before any chapter is measured: about 18px type at a comfortable measure. */
export const DEFAULT_PX_PER_WORD = 3.1
/** No chapter is estimated shorter than this (a title page still takes room). */
const MIN_ESTIMATE = 96

/** Words are at least 1 so an empty chapter still has a share. */
const wordsOf = (count: number): number => Math.max(1, count)

/** What a chapter takes besides its words: the padding above and below it (see `.chapter` in the Reader's styles). */
export const CHAPTER_OVERHEAD = 96
/** Short chapters (a cover, a title page, a dedication) say little about px per word: they are left out of the average. */
const MIN_WORDS_TO_AVERAGE = 1500

/** Px per word over the chapters measured so far (padding set aside); `fallback` when none is long enough to tell. */
export function pxPerWord(words: readonly number[], measured: ReadonlyMap<number, number>, fallback = DEFAULT_PX_PER_WORD): number {
  let px = 0
  let count = 0
  for (const [index, height] of measured) {
    const n = words[index] ?? 0
    if (index < 0 || index >= words.length || !(height > CHAPTER_OVERHEAD) || n < MIN_WORDS_TO_AVERAGE) continue
    px += height - CHAPTER_OVERHEAD
    count += n
  }
  return count > 0 ? px / count : fallback
}

/** The height of every chapter: measured where known, estimated elsewhere. */
export function chapterHeights(words: readonly number[], measured: ReadonlyMap<number, number>, perWord: number): number[] {
  return words.map((count, index) => {
    const known = measured.get(index)
    return known !== undefined && known > 0 ? known : Math.max(MIN_ESTIMATE, CHAPTER_OVERHEAD + wordsOf(count) * perWord)
  })
}

export interface BookLayout { readonly heights: readonly number[]; readonly tops: readonly number[]; readonly total: number }

export function bookLayout(heights: readonly number[]): BookLayout {
  const tops: number[] = []
  let total = 0
  for (const height of heights) { tops.push(total); total += height }
  return { heights, tops, total }
}

/** The chapter holding `y` (px from the top of the book); clamped to the first and last. */
export function chapterAtY(layout: BookLayout, y: number): number {
  const count = layout.heights.length
  if (count === 0) return 0
  let low = 0
  let high = count - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if ((layout.tops[mid] ?? 0) <= y) low = mid; else high = mid - 1
  }
  return low
}

/** The gaps before and after the rendered window, in px. */
export function gapsAround(layout: BookLayout, window: ChapterWindow): { before: number; after: number } {
  const before = layout.tops[window.first] ?? 0
  const end = (layout.tops[window.last] ?? 0) + (layout.heights[window.last] ?? 0)
  return { before, after: Math.max(0, layout.total - end) }
}

/**
 * Did the reader land where nothing is rendered (dragged the scrollbar)? `scrollTop` is the offset of the view's top from
 * the top of the first rendered chapter, `rendered` the height of the rendered chapters together. When the view and the
 * rendered chapters share no pixel, it is a jump and the window must be rebuilt there.
 */
export function isJump(scrollTop: number, viewport: number, rendered: number): boolean {
  return scrollTop + viewport <= 0 || scrollTop >= rendered
}

/** Where a view top at `y` falls in the book: the chapter and how far through it (0..1 of its estimated height). */
export function placeAtY(layout: BookLayout, y: number): { chapter: number; fraction: number } {
  const chapter = chapterAtY(layout, y)
  const fraction = (y - (layout.tops[chapter] ?? 0)) / Math.max(1, layout.heights[chapter] ?? 1)
  return { chapter, fraction: Math.max(0, Math.min(1, fraction)) }
}
