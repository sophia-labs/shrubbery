import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  generatePrompt,
  lessonCharacters,
  nextLesson,
  normalizeCopy,
  scoreCopy,
} from '../src/koch.js'
import { buildTimeline, farnsworthTiming } from '../src/audio.js'

describe('Koch lesson model', () => {
  it('starts with two full-speed sounds and adds one character per lesson', () => {
    expect(lessonCharacters(2)).toEqual(['K', 'M'])
    expect(lessonCharacters(3)).toEqual(['K', 'M', 'U'])
  })

  it('builds deterministic five-character copy groups with the newest sound represented', () => {
    const prompt = generatePrompt(3, DEFAULT_SETTINGS, () => 0)
    expect(prompt.grouped.split(' ')).toHaveLength(5)
    expect(prompt.plain).toHaveLength(25)
    expect(prompt.plain).toContain('U')
    expect([...prompt.plain].every((char) => ['K', 'M', 'U'].includes(char))).toBe(true)
  })

  it('scores positional copy and advances only at ninety percent', () => {
    const score = scoreCopy('KMUKM', 'KMUUM')
    expect(score.correct).toBe(4)
    expect(score.accuracy).toBe(0.8)
    expect(nextLesson(4, 0.899)).toBe(4)
    expect(nextLesson(4, 0.9)).toBe(5)
    expect(normalizeCopy('k m /?')).toBe('KM/?')
  })
})

describe('Morse timing', () => {
  it('keeps character elements at target speed and stretches only spacing', () => {
    const fast = farnsworthTiming(20, 20)
    const spaced = farnsworthTiming(20, 10)
    expect(fast.ditSeconds).toBeCloseTo(0.06)
    expect(spaced.ditSeconds).toBe(fast.ditSeconds)
    expect(spaced.spacingUnitSeconds).toBeGreaterThan(fast.spacingUnitSeconds)
  })

  it('schedules K and M as five audible elements without revealing them visually', () => {
    const timeline = buildTimeline('KM', DEFAULT_SETTINGS)
    expect(timeline.events).toHaveLength(5)
    expect(timeline.events[0].durationSeconds).toBeCloseTo(0.18)
    expect(timeline.events[1].durationSeconds).toBeCloseTo(0.06)
    expect(timeline.durationSeconds).toBeGreaterThan(1)
  })
})
