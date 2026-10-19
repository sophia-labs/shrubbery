import { describe, expect, it } from 'vitest'
import { loadPdfJs } from '../../pdfjs-runtime.js'
import { pdfBytes } from '../../__tests__/pdf-test-fixtures.js'
import { ocrTextContent, withOcrText, type OcrPage, type OcrTextLayer } from '../ocr-text-layer.js'

const word = (text: string, x0: number, x1: number, line: number, y0 = 690, y1 = 712) =>
  ({ text, x0, x1, y0, y1, conf: 95, block: 1, par: 1, line })

const page: OcrPage = {
  page: 1,
  status: 'ocr',
  words: [word('Knowledge', 72, 180, 1), word('is', 188, 204, 1), word('effective', 72, 160, 2, 660, 682), word('action.', 166, 240, 2, 660, 682)],
}

describe('a scan\'s words as pdf.js text content', () => {
  it('reads as the words with spaces between them and a line end after each line', () => {
    const content = ocrTextContent(page)
    // pdf.js reads a line end as a break between lines (its text layer draws a <br>, its find sees a newline).
    expect(content.items.map(item => item.str + (item.hasEOL ? '\n' : '')).join('')).toBe('Knowledge is\neffective action.\n')
    expect(content.items.map(item => item.hasEOL)).toEqual([false, true, false, true])
  })

  it('places each word where it was read: its box, in the page\'s own coordinates, running to the next word', () => {
    const [knowledge, is] = ocrTextContent(page).items
    expect(knowledge).toMatchObject({ transform: [22, 0, 0, 22, 72, 690], width: 188 - 72, height: 22, fontName: 'sophia-ocr' })
    expect(is).toMatchObject({ transform: [22, 0, 0, 22, 188, 690], width: 204 - 188 })
  })

  it('turns a rotated page\'s words with the page: upside down, each word runs right to left from its far corner', () => {
    const [knowledge, is] = ocrTextContent({ ...page, rotation: 180 }).items
    // Shown upright on a page turned 180 degrees, "Knowledge" starts at its box's top-right corner and runs toward x0.
    expect(knowledge).toMatchObject({ transform: [-22, 0, 0, -22, 180, 712], height: 22, width: 180 - 72 })
    expect(is!.transform).toEqual([-22, 0, 0, -22, 204, 712])
  })

  it('turns a quarter-turned page\'s words: a line runs up the page, from the corner where it starts as shown', () => {
    // On a page turned a quarter clockwise a printed line runs up the page: its words share an x range, y grows.
    const turned: OcrPage = { page: 1, status: 'ocr', rotation: 90, words: [
      { text: 'Knowledge', x0: 300, x1: 322, y0: 100, y1: 208, conf: 95, block: 1, par: 1, line: 1 },
      { text: 'is', x0: 301, x1: 320, y0: 216, y1: 232, conf: 95, block: 1, par: 1, line: 1 },
    ] }
    const [knowledge, is] = ocrTextContent(turned).items
    expect(knowledge).toMatchObject({ transform: [0, 22, -22, 0, 322, 100], width: 216 - 100, height: 22 })
    expect(is!.transform).toEqual([0, 22, -22, 0, 322, 216])
  })

  it('gives every word of a line the line\'s full height, so a selection across it is one even band', () => {
    const uneven: OcrPage = { page: 1, status: 'ocr', words: [
      { text: 'Cover', x0: 72, x1: 120, y0: 690, y1: 712, conf: 95, block: 1, par: 1, line: 1 },
      { text: 'your', x0: 126, x1: 160, y0: 684, y1: 706, conf: 95, block: 1, par: 1, line: 1 },
    ] }
    const [cover, your] = ocrTextContent(uneven).items
    expect([cover!.transform, your!.transform]).toEqual([[28, 0, 0, 28, 72, 684], [28, 0, 0, 28, 126, 684]])
  })

  it('makes real pdf.js answer a textless page with the words read, and leaves a printed page as printed', async () => {
    // A real two-page PDF read by real pdf.js: page 1 has no text (as a scan has none), page 2 has a printed line.
    const pdfjs = await loadPdfJs()
    const bytes = pdfBytes([[], [{ x: 72, y: 700, text: 'A printed line stays printed' }]], [{ mediaBox: [0, 0, 612, 792] }, { mediaBox: [0, 0, 612, 792] }])
    const pdf = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, disableFontFace: true }).promise
    // As pdf.js's find reads a page: each item's string, a newline after a line end.
    const textOf = async (n: number) => (await (await pdf.getPage(n)).getTextContent()).items
      .map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join('').trim()
    expect(await textOf(1)).toBe('')
    const layer: OcrTextLayer = { schema: 'sophia.ocr-text-layer/1', engine: 'tesseract 5.5.2', lang: 'eng', pageCount: 2, pages: [page, { page: 2, status: 'has-text' }] }
    withOcrText(pdf, layer)
    expect(await textOf(1)).toBe('Knowledge is\neffective action.')
    expect(await textOf(2)).toBe('A printed line stays printed')
    // The viewer's text layer reads the stream: one chunk, the same words.
    const chunks: { items: { str: string }[] }[] = []
    const reader = (await pdf.getPage(1)).streamTextContent().getReader()
    for (let next = await reader.read(); !next.done; next = await reader.read()) chunks.push(next.value as { items: { str: string }[] })
    expect(chunks.map(chunk => chunk.items.map(item => item.str))).toEqual([['Knowledge ', 'is', 'effective ', 'action.']])
    expect(await pdf.getPage(1)).toBe(await pdf.getPage(1))
    await pdf.destroy()
  })
})
