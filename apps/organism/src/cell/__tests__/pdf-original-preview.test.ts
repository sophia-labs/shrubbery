import { describe, expect, it } from 'vitest'
import { pdfPageGeometryMatches, pdfPreviewScale } from '../pdf-original-preview.js'

describe('original PDF viewport boundary', () => {
  const target = { pageIndex: 0, space: 'pdf-user-space' as const, viewBox: [25, 40, 625, 840] as const, userUnit: 2, rotation: 90 as const, rects: [[30, 50, 200, 80] as const] }
  it('requires the same actual crop, rotation and user unit, not merely a matching page number', () => {
    const actual = { view: [25, 40, 625, 840], userUnit: 2, rotate: 90 }
    expect(pdfPageGeometryMatches(target, actual)).toBe(true)
    expect(pdfPageGeometryMatches(target, { ...actual, rotate: 0 })).toBe(false)
    expect(pdfPageGeometryMatches(target, { ...actual, userUnit: 1 })).toBe(false)
    expect(pdfPageGeometryMatches(target, { ...actual, view: [0, 0, 600, 800] })).toBe(false)
    expect(pdfPageGeometryMatches(target, { ...actual, view: [NaN, 40, 625, 840] })).toBe(false)
  })
  it.each([[600, 800], [1e8, 2e8], [100, 50000], [50000, 100]])('bounds the %s by %s raster', (w, h) => {
    const scale = pdfPreviewScale(w, h)
    expect(scale).toBeGreaterThan(0)
    expect(w * scale).toBeLessThanOrEqual(4096)
    expect(h * scale).toBeLessThanOrEqual(4096)
    expect(w * h * scale * scale).toBeLessThanOrEqual(4_000_001)
  })
  it.each([[0, 2], [2, -1], [Infinity, 10], [1e308, 1e308]])('refuses invalid dimensions %s by %s', (w, h) => {
    expect(() => pdfPreviewScale(w, h)).toThrow()
  })
})
