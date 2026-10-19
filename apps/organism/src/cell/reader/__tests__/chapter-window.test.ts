import { describe, expect, it } from 'vitest'
import { chapterAtLine, nextChapterWindow, windowAt } from '../chapter-window.js'

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
