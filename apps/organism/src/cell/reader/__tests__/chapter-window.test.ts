import { describe, expect, it } from 'vitest'
import { DEFAULT_PX_PER_WORD, bookLayout, chapterAtLine, chapterAtY, chapterHeights, gapsAround, isJump, nextChapterWindow, placeAtY, pxPerWord, windowAt } from '../chapter-window.js'

const V = 800
const win = (first: number, last: number, heights: number[], scrollTop: number, count = 21, extra = {}) =>
  nextChapterWindow({ count, current: { first, last }, heights, scrollTop, viewport: V, ...extra })

describe('windowAt', () => {
  it('starts with the one chapter, clamped', () => {
    expect(windowAt(4, 21)).toEqual({ first: 4, last: 4 })
    expect(windowAt(99, 21)).toEqual({ first: 20, last: 20 })
    expect(windowAt(-3, 21)).toEqual({ first: 0, last: 0 })
  })
})

describe('nextChapterWindow', () => {
  it('adds the next chapter near the bottom only', () => {
    expect(win(4, 4, [5000], 3500)).toEqual({ first: 4, last: 5 })
  })
  it('adds the previous chapter near the top only', () => {
    expect(win(4, 4, [5000], 100, 21, { })).toEqual({ first: 3, last: 4 })
  })
  it('does nothing mid-chapter', () => {
    expect(win(4, 4, [9000], 4000)).toEqual({ first: 4, last: 4 })
  })
  it('does not grow past either end of the book', () => {
    expect(win(0, 0, [900], 0, 1)).toEqual({ first: 0, last: 0 })
    expect(win(20, 20, [900], 0)).toEqual({ first: 19, last: 20 })
    expect(win(0, 1, [3000, 3000], 5500)).toEqual({ first: 0, last: 2 })
  })
  it('never renders the whole book: far chapters are dropped', () => {
    // viewport deep in the fourth chapter of four rendered ones
    const w = win(2, 5, [3000, 3000, 3000, 3000], 9500)
    expect(w.first).toBeGreaterThan(2)
    expect(w.last).toBeGreaterThanOrEqual(5)
  })
  it('caps the window and drops the end farther from the reading line', () => {
    const w = win(0, 6, [2000, 2000, 2000, 2000, 2000, 2000, 2000], 9000, 21, { buffer: 100000, maxRendered: 3 })
    expect(w.last - w.first + 1).toBeLessThanOrEqual(3)
    expect(w.first).toBeLessThanOrEqual(4)
    expect(w.last).toBeGreaterThanOrEqual(4)
  })
  it('grows in short chapters until the edges are covered, one step at a time', () => {
    let w = { first: 5, last: 5 }
    for (let i = 0; i < 10; i++) w = nextChapterWindow({ count: 21, current: w, heights: Array(w.last - w.first + 1).fill(300), scrollTop: 100 + 300 * (5 - w.first), viewport: V })
    expect(w.last - w.first + 1).toBeLessThanOrEqual(5)
    expect(w.first).toBeLessThan(5)
    expect(w.last).toBeGreaterThan(5)
  })
})

describe('chapterAtLine', () => {
  it('finds the chapter holding the reading line', () => {
    const heights = [1000, 2000, 500]
    expect(chapterAtLine({ first: 3, last: 5 }, heights, 0)).toBe(3)
    expect(chapterAtLine({ first: 3, last: 5 }, heights, 999)).toBe(3)
    expect(chapterAtLine({ first: 3, last: 5 }, heights, 1000)).toBe(4)
    expect(chapterAtLine({ first: 3, last: 5 }, heights, 3200)).toBe(5)
    expect(chapterAtLine({ first: 3, last: 5 }, heights, 99999)).toBe(5)
  })
})

describe('the height of the whole book', () => {
  const words = [100, 1000, 5000, 20000, 50]
  it('measures px per word over the rendered chapters, or falls back', () => {
    expect(pxPerWord(words, new Map())).toBe(DEFAULT_PX_PER_WORD)
    expect(pxPerWord(words, new Map([[2, 15096], [3, 60096]]), 9)).toBeCloseTo(3)
    expect(pxPerWord(words, new Map([[2, 15096]]), 9)).toBe(3)
    // a cover and a short preface say nothing about px per word
    expect(pxPerWord(words, new Map([[0, 5000], [4, 5000]]), 9)).toBe(9)
  })
  it('estimates unmeasured chapters from their words and keeps measured ones', () => {
    const heights = chapterHeights(words, new Map([[2, 9999]]), 3)
    expect(heights).toEqual([396, 3096, 9999, 60096, 246])
  })
  it('lays out cumulative tops and finds the chapter at a position', () => {
    const layout = bookLayout([100, 200, 300])
    expect(layout.tops).toEqual([0, 100, 300])
    expect(layout.total).toBe(600)
    expect([0, 99, 100, 299, 300, 599, 5000, -5].map(y => chapterAtY(layout, y))).toEqual([0, 0, 1, 1, 2, 2, 2, 0])
  })
  it('puts the rest of the book in two gaps around the window', () => {
    const layout = bookLayout([100, 200, 300, 400, 500])
    expect(gapsAround(layout, { first: 1, last: 2 })).toEqual({ before: 100, after: 900 })
    expect(gapsAround(layout, { first: 0, last: 4 })).toEqual({ before: 0, after: 0 })
  })
  it('the gaps and the window add up to the whole book at any window', () => {
    const layout = bookLayout(chapterHeights(words, new Map([[2, 7777]]), 2.5))
    for (const w of [{ first: 0, last: 0 }, { first: 1, last: 3 }, { first: 4, last: 4 }]) {
      const { before, after } = gapsAround(layout, w)
      let inside = 0
      for (let i = w.first; i <= w.last; i++) inside += layout.heights[i]!
      expect(before + inside + after).toBeCloseTo(layout.total)
    }
  })
  it('a jump is a view that shares no pixel with the rendered chapters', () => {
    expect(isJump(0, 800, 9000)).toBe(false)
    expect(isJump(-300, 800, 9000)).toBe(false)
    expect(isJump(-800, 800, 9000)).toBe(true)
    expect(isJump(8999, 800, 9000)).toBe(false)
    expect(isJump(9000, 800, 9000)).toBe(true)
  })
  it('a drag to half of the scroll height lands in the middle chapter', () => {
    const layout = bookLayout(chapterHeights(Array(21).fill(4000), new Map(), 2.7))
    const placed = placeAtY(layout, layout.total / 2)
    expect(placed.chapter).toBe(10)
    expect(placed.fraction).toBeGreaterThan(0)
    expect(placed.fraction).toBeLessThan(1)
    expect(placeAtY(layout, 0)).toEqual({ chapter: 0, fraction: 0 })
    expect(placeAtY(layout, layout.total * 2).chapter).toBe(20)
  })
})
