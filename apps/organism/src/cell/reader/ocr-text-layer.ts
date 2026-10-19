/**
 * A scan's words (gardend's `sophia.ocr-text-layer/1`: what Tesseract read on each page, with each word's box in the
 * page's own coordinates) given to pdf.js as the page's text. pdf.js then does the rest as for any PDF with text: its
 * text layer (so words select and copy), its find, and the Reader's highlights, which are drawn over that layer.
 */

export interface OcrWord {
  readonly text: string
  /** PDF user space, points, y up: x0 < x1, y0 (bottom) < y1 (top). */
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly conf: number
  readonly block: number
  readonly par: number
  readonly line: number
}

export interface OcrPage {
  readonly page: number
  readonly status: 'ocr' | 'has-text' | 'rotated' | 'failed' | string
  readonly words?: readonly OcrWord[]
}

export interface OcrTextLayer {
  readonly schema: 'sophia.ocr-text-layer/1' | string
  readonly engine: string
  readonly lang: string
  readonly pageCount: number
  readonly pages: readonly OcrPage[]
}

/** The font pdf.js is told the words are in: a box exactly the word's height, sitting on its bottom edge. */
const OCR_FONT = 'sophia-ocr'

interface TextItem {
  str: string
  dir: 'ltr'
  width: number
  height: number
  transform: [number, number, number, number, number, number]
  fontName: string
  hasEOL: boolean
}

/** One page's words as pdf.js text content: a word per item, a space carried to the next word, a line end marked. */
export function ocrTextContent(page: OcrPage): { items: TextItem[]; styles: Record<string, unknown>; lang: string | null } {
  const words = page.words ?? []
  const items: TextItem[] = []
  words.forEach((word, index) => {
    const next = words[index + 1]
    const sameLine = next && next.block === word.block && next.par === word.par && next.line === word.line
    const height = Math.max(1, word.y1 - word.y0)
    // The space after a word belongs to it, so find and copy see "two words", and the box runs to the next word.
    const right = sameLine && next.x0 > word.x1 ? next.x0 : word.x1
    items.push({
      str: sameLine ? `${word.text} ` : word.text,
      dir: 'ltr',
      width: Math.max(1, right - word.x0),
      height,
      transform: [height, 0, 0, height, word.x0, word.y0],
      fontName: OCR_FONT,
      hasEOL: !sameLine,
    })
  })
  return { items, styles: { [OCR_FONT]: { fontFamily: 'sans-serif', ascent: 1, descent: 0, vertical: false } }, lang: null }
}

// biome-ignore lint/suspicious/noExplicitAny: pdf.js's proxies are used through the narrow seam below
type Loose = any

/**
 * Give pdf.js a scan's words: every page with OCR words answers `getTextContent` and `streamTextContent` (what the
 * viewer's text layer and the find controller ask) with them. Pages that have their own text are left as they are.
 */
export function withOcrText(pdf: Loose, layer: OcrTextLayer | null | undefined): Loose {
  const byPage = new Map<number, OcrPage>()
  for (const page of layer?.pages ?? []) if (page.status === 'ocr' && page.words?.length) byPage.set(page.page, page)
  if (byPage.size === 0) return pdf
  const getPage = pdf.getPage.bind(pdf)
  const patched = new Map<number, Promise<Loose>>()
  pdf.getPage = (n: number): Promise<Loose> => {
    const known = patched.get(n)
    if (known) return known
    const promise: Promise<Loose> = getPage(n).then((page: Loose) => {
      const ocr = byPage.get(n)
      if (!ocr) return page
      const content = ocrTextContent(ocr)
      page.getTextContent = async () => content
      page.streamTextContent = () => new ReadableStream({
        start(controller) { controller.enqueue(content); controller.close() },
      })
      return page
    })
    patched.set(n, promise)
    return promise
  }
  return pdf
}
