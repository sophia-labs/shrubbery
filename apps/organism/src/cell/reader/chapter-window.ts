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
