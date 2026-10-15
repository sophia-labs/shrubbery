// @vitest-environment node
/**
 * gardend makes no document with a title over 96 Unicode scalar values (garden a901a16 refuses it at once; before that the
 * create retried forever and held the graph's writes behind it). Titles made from file names are cut to fit.
 */
import { describe, expect, it } from 'vitest'
import { DOCUMENT_TITLE_MAX, documentTitle, fileDocumentTitle } from '../document-title.js'

const scalars = (value: string) => Array.from(value).length
const LONG_NAME = 'Thermal validation report for the OPA2134 headphone amplifier board, revision C, batch 7 – final review.pdf'

describe('documentTitle', () => {
  it('sends a title that fits exactly as it was, 96 characters included', () => {
    const ninetySix = 'x'.repeat(96)
    expect(documentTitle(ninetySix)).toBe(ninetySix)
    expect(documentTitle('  Plan  ')).toBe('  Plan  ')
    // Padding the cell trims does not count.
    expect(documentTitle(` ${ninetySix} `)).toBe(` ${ninetySix} `)
  })

  it('cuts a longer one to 95 characters and an ellipsis, without a space before the ellipsis', () => {
    const title = documentTitle(`${'word '.repeat(30)}end`)
    expect(scalars(title)).toBeLessThanOrEqual(DOCUMENT_TITLE_MAX)
    expect(title.endsWith('word…')).toBe(true)
    expect(documentTitle('y'.repeat(200))).toBe(`${'y'.repeat(95)}…`)
  })

  it('cuts in whole graphemes and counts what the cell counts (scalar values, not UTF-16 units)', () => {
    const family = '👨‍👩‍👧‍👦' // one grapheme, seven scalar values, eleven UTF-16 units
    const title = documentTitle(family.repeat(20))
    expect(scalars(title)).toBeLessThanOrEqual(DOCUMENT_TITLE_MAX)
    expect(title).toBe(`${family.repeat(13)}…`) // 13 × 7 = 91; a fourteenth would be 98 with the ellipsis
    const accented = 'é'.repeat(60) // é as e + combining acute: 120 scalar values
    const cut = documentTitle(accented)
    expect(scalars(cut)).toBeLessThanOrEqual(DOCUMENT_TITLE_MAX)
    expect(cut).toBe(`${'é'.repeat(47)}…`)
    // Astral letters are one scalar value each, though two UTF-16 units: 96 of them fit.
    expect(documentTitle('𝔊'.repeat(96))).toBe('𝔊'.repeat(96))
  })
})

describe('fileDocumentTitle', () => {
  it('keeps a short name whole', () => {
    expect(fileDocumentTitle('Notes on ', 'ti-opa2134_DS.pdf')).toBe('Notes on ti-opa2134_DS.pdf')
  })

  it('cuts a long name in its middle, keeping its last word and extension, as a file card shows it', () => {
    const title = fileDocumentTitle('Notes on ', LONG_NAME)
    expect(scalars(title)).toBeLessThanOrEqual(DOCUMENT_TITLE_MAX)
    expect(title.startsWith('Notes on Thermal validation report for the OPA2134')).toBe(true)
    expect(title.endsWith('…review.pdf')).toBe(true)
    // A name without a prefix, as an uploaded file's base name becomes its document's title.
    const base = fileDocumentTitle('', LONG_NAME.replace(/\.pdf$/, ''))
    expect(scalars(base)).toBeLessThanOrEqual(DOCUMENT_TITLE_MAX)
    expect(base.endsWith('…review')).toBe(true)
  })

  it('fits names whose graphemes hold several scalar values', () => {
    const name = `${'N\u0300\u0303'.repeat(70)} final.pdf` // N with a grave and a tilde: one grapheme, three scalar values
    const title = fileDocumentTitle('Notes on ', name)
    expect(scalars(title)).toBeLessThanOrEqual(DOCUMENT_TITLE_MAX)
    expect(title.endsWith('…final.pdf')).toBe(true)
  })
})
