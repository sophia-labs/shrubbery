/**
 * The playlist's queue logic: play order, shuffle, repeat, next and previous.
 * Pure functions, so no element and no audio are involved.
 */
import { describe, expect, it } from 'vitest'
import {
  formatClock,
  nextRepeatMode,
  nextTrackIndex,
  playOrder,
  previousTrackIndex,
  seededRandom,
} from '../audio-playlist.js'

describe('play order', () => {
  it('is the authored order unless shuffled', () => {
    expect(playOrder(4, false)).toEqual([0, 1, 2, 3])
    expect(playOrder(0, true)).toEqual([])
    expect(playOrder(1, true)).toEqual([0])
  })

  it('a shuffle is a permutation, the same for the same seed, and starts at the anchor', () => {
    const a = playOrder(12, true, 42)
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 12 }, (_, i) => i))
    expect(playOrder(12, true, 42)).toEqual(a)
    expect(playOrder(12, true, 43)).not.toEqual(a)
    const anchored = playOrder(12, true, 42, 5)
    expect(anchored[0]).toBe(5)
    expect([...anchored].sort((x, y) => x - y)).toEqual(Array.from({ length: 12 }, (_, i) => i))
  })

  it('the seeded generator stays in [0, 1)', () => {
    const r = seededRandom(9)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('next', () => {
  const order = [2, 0, 1]
  it('follows the play order', () => {
    expect(nextTrackIndex(order, 2, 'off', false)).toBe(0)
    expect(nextTrackIndex(order, 0, 'off', true)).toBe(1)
    expect(nextTrackIndex(order, null, 'off', false)).toBe(2)
  })
  it('at the end: by hand it wraps, by itself it stops unless repeat is all', () => {
    expect(nextTrackIndex(order, 1, 'off', false)).toBe(2)
    expect(nextTrackIndex(order, 1, 'off', true)).toBeNull()
    expect(nextTrackIndex(order, 1, 'all', true)).toBe(2)
  })
  it('repeat one replays the track that ended, but next by hand still moves', () => {
    expect(nextTrackIndex(order, 0, 'one', true)).toBe(0)
    expect(nextTrackIndex(order, 0, 'one', false)).toBe(1)
  })
  it('an empty playlist has no next', () => {
    expect(nextTrackIndex([], null, 'all', false)).toBeNull()
  })
})

describe('previous', () => {
  const order = [0, 1, 2]
  it('restarts the track past 3 s, else steps back (wrapping)', () => {
    expect(previousTrackIndex(order, 1, 12)).toEqual({ index: 1, restart: true })
    expect(previousTrackIndex(order, 1, 1.5)).toEqual({ index: 0, restart: false })
    expect(previousTrackIndex(order, 0, 0)).toEqual({ index: 2, restart: false })
    expect(previousTrackIndex([], null, 0)).toBeNull()
  })
})

describe('repeat cycle and clock', () => {
  it('cycles off → all → one → off', () => {
    expect(nextRepeatMode('off')).toBe('all')
    expect(nextRepeatMode('all')).toBe('one')
    expect(nextRepeatMode('one')).toBe('off')
  })
  it('formats seconds, and an unknown duration as an em dash', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(53.09)).toBe('0:53')
    expect(formatClock(98.7)).toBe('1:38')
    expect(formatClock(3725)).toBe('1:02:05')
    expect(formatClock(undefined)).toBe('—')
    expect(formatClock(Number.NaN)).toBe('—')
  })
})
