/**
 * The multiple of House a picker row shows (NO MOCKS, no DOM).
 *
 * The host works the multiple out (it knows what a short reply is and what the House
 * default charges); the kernel only words it. Defects guarded: a multiple that reads as
 * a precise price, a tiny fraction that rounds to "0.0x", and a missing figure dressed up
 * as "1x".
 */
import { describe, expect, it } from 'vitest'

import { formatVoiceMultiple } from '../voice-roster.js'

describe('formatVoiceMultiple', () => {
  it('says how many times House a voice costs, to one decimal under ten', () => {
    expect(formatVoiceMultiple(1.7653)).toBe('1.8× House')
    expect(formatVoiceMultiple(8.24)).toBe('8.2× House')
    expect(formatVoiceMultiple(1)).toBe('1.0× House')
  })

  it('says it plainly when a voice costs less than House', () => {
    expect(formatVoiceMultiple(0.5)).toBe('0.5× House')
    expect(formatVoiceMultiple(0.093)).toBe('0.1× House')
  })

  it('does not round a very small fraction to nothing', () => {
    expect(formatVoiceMultiple(0.004)).toBe('<0.1× House')
  })

  it('rounds to a whole number from ten up, where a decimal means nothing', () => {
    expect(formatVoiceMultiple(12.4)).toBe('12× House')
    expect(formatVoiceMultiple(99.6)).toBe('100× House')
  })

  it('never shows a decimal past ten, even for a number that only rounds up to ten', () => {
    // Defect avoided: 9.96 printed as "10.0× House".
    expect(formatVoiceMultiple(9.94)).toBe('9.9× House')
    expect(formatVoiceMultiple(9.96)).toBe('10× House')
  })

  it('caps the very large, so a strange catalogue row cannot fill the row', () => {
    expect(formatVoiceMultiple(2_500)).toBe('1000×+ House')
  })

  it('caps at the number that would print as a thousand, not a hair after it', () => {
    // Defect avoided: 999.6 printed as "1000× House", one character short of the cap it belongs to.
    expect(formatVoiceMultiple(999.4)).toBe('999× House')
    expect(formatVoiceMultiple(999.6)).toBe('1000×+ House')
  })

  it('says nothing when there is nothing to say', () => {
    expect(formatVoiceMultiple(null)).toBeNull()
    expect(formatVoiceMultiple(undefined)).toBeNull()
    expect(formatVoiceMultiple(0)).toBeNull()
    expect(formatVoiceMultiple(-2)).toBeNull()
    expect(formatVoiceMultiple(Number.NaN)).toBeNull()
    expect(formatVoiceMultiple(Number.POSITIVE_INFINITY)).toBeNull()
  })
})
