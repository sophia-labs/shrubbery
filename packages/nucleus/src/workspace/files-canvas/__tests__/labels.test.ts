// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { LABEL_BUDGET, displayLabel, graphemeCount, graphemes } from '../labels.js'
import { forSeeds } from './support/lcg.js'

describe('displayLabel', () => {
  it('shows a name that fits as it is, with whitespace collapsed', () => {
    expect(displayLabel('Datasheet.pdf')).toBe('Datasheet.pdf')
    expect(displayLabel('  Thermal   test \n report.pdf  ')).toBe('Thermal test report.pdf')
    expect(displayLabel('x'.repeat(34))).toBe('x'.repeat(34))
  })

  it('has the budgets of the design: 20, 34 and 48 graphemes', () => {
    expect(LABEL_BUDGET).toEqual({ small: 20, medium: 34, large: 48 })
  })

  it('keeps the head, an ellipsis, and a tail holding the last word and the extension', () => {
    expect(displayLabel('Thermal test report – batch 7 – final review.pdf')).toBe('Thermal test report – b…review.pdf')
    expect(displayLabel('Thermal test report – batch 7 – final review.pdf', 'large')).toBe('Thermal test report – batch 7 – final review.pdf')
    expect(displayLabel('Thermal test report – batch 7 – final review.pdf', 'small')).toBe('Thermal t…review.pdf')
  })

  it('never exceeds the budget and always ends with the extension, at every size', () => {
    const names = [
      'Thermal test report – batch 7 – final review.pdf',
      'BOM_rev_C_supplier_quote_comparison_with_lead_times_and_MOQ.pdf',
      '2026-10-03 meeting notes about the fuselage mounting bracket tolerances.docx',
      'A very long name without any extension at all that keeps going and going',
    ]
    for (const name of names) for (const size of ['small', 'medium', 'large'] as const) {
      const shown = displayLabel(name, size)
      expect(graphemeCount(shown), `${size}: ${shown}`).toBeLessThanOrEqual(LABEL_BUDGET[size])
      const ext = /\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0]
      if (ext) expect(shown.endsWith(ext), `${size}: ${shown}`).toBe(true)
      expect(shown.includes('…')).toBe(graphemeCount(name) > LABEL_BUDGET[size])
    }
  })

  it('keeps the last word before the extension whenever it fits', () => {
    const shown = displayLabel('Thermal test report – batch 7 – final review.pdf', 'medium')
    expect(shown.endsWith('review.pdf')).toBe(true)
    expect(displayLabel('Quarterly supplier audit findings and corrective actions.pdf', 'medium').endsWith('actions.pdf')).toBe(true)
  })

  it('does not break a name with no extension, or a single long token', () => {
    const plain = displayLabel('A very long name without any extension at all that keeps going and going')
    expect(graphemeCount(plain)).toBeLessThanOrEqual(34)
    expect(plain.endsWith('going')).toBe(true)
    const token = displayLabel('x'.repeat(100))
    expect(graphemeCount(token)).toBeLessThanOrEqual(34)
    expect(token).toContain('…')
  })

  it('is safe at tiny budgets', () => {
    expect(displayLabel('abcdef', 1)).toBe('…')
    expect(displayLabel('abcdef', 2)).toBe('a…')
    expect(graphemeCount(displayLabel('abcdefgh.pdf', 4))).toBeLessThanOrEqual(4)
  })

  it('counts grapheme clusters, so an emoji, a flag or a letter with marks is never split', () => {
    const family = '👨‍👩‍👧‍👦', flag = '🇺🇾', accented = 'é'
    expect(graphemeCount(family)).toBe(1); expect(graphemeCount(flag)).toBe(1); expect(graphemeCount(accented)).toBe(1)
    const name = `${`${family}${flag}${accented}`.repeat(15)} informe final.pdf`
    const shown = displayLabel(name, 'small')
    expect(graphemeCount(shown)).toBeLessThanOrEqual(20)
    const original = new Set(graphemes(name))
    for (const g of graphemes(shown)) if (g !== '…') expect(original.has(g), `split cluster ${JSON.stringify(g)}`).toBe(true)
  })

  it('is idempotent: a display string is its own display string', () => {
    forSeeds(40, (rng) => {
      const words = ['informe', 'final', 'rev', 'C', 'supplier', 'quote', '–', '7', 'datasheet', 'térmica', '👍']
      const name = Array.from({ length: 4 + rng.int(14) }, () => rng.pick(words)).join(rng.pick([' ', '_', ' - '])) + rng.pick(['.pdf', '.docx', '', '.tar.gz'])
      const size = rng.pick(['small', 'medium', 'large'] as const)
      const once = displayLabel(name, size)
      expect(displayLabel(once, size)).toBe(once)
      expect(graphemeCount(once)).toBeLessThanOrEqual(LABEL_BUDGET[size])
    })
  })
})
