import { describe, expect, it } from 'vitest'
import {
  StraightKeyCapture,
  classifyKeyingElement,
  scoreKeying,
  targetDitMs,
} from '../src/keying.js'

describe('straight-key sending assessment', () => {
  it('classifies elements around the two-unit boundary', () => {
    expect(targetDitMs(20)).toBe(60)
    expect(classifyKeyingElement(119, 60)).toBe('.')
    expect(classifyKeyingElement(120, 60)).toBe('-')
  })

  it('captures monotonic transitions and closes characters on the caller-owned gap', () => {
    const capture = new StraightKeyCapture(60, 1_000)
    capture.keyDown(1_000)
    capture.keyUp(1_180)
    capture.keyDown(1_240)
    capture.keyUp(1_300)
    capture.keyDown(1_360)
    capture.keyUp(1_540)
    const character = capture.closeCharacter(1_720)

    expect(character).toMatchObject({ pattern: '-.-', decoded: 'K' })
    expect(capture.snapshot().transitions).toEqual([
      { kind: 'down', atMs: 0 },
      { kind: 'up', atMs: 180 },
      { kind: 'down', atMs: 240 },
      { kind: 'up', atMs: 300 },
      { kind: 'down', atMs: 360 },
      { kind: 'up', atMs: 540 },
    ])
  })

  it('keeps symbol accuracy separate from duration, spacing, and consistency', () => {
    const capture = new StraightKeyCapture(60, 0)
    capture.keyDown(0); capture.keyUp(180)
    capture.keyDown(240); capture.keyUp(300)
    capture.keyDown(360); capture.keyUp(540)
    capture.closeCharacter(720)

    const score = scoreKeying('K', capture.snapshot())
    expect(score).toMatchObject({
      activity: 'send',
      entered: 'K',
      correct: 1,
      total: 1,
      accuracy: 1,
      durationScore: 1,
      spacingScore: 1,
      consistencyScore: 1,
      timingScore: 1,
      performanceScore: 1,
    })
  })
})
