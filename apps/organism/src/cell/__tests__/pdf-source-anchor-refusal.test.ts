// @vitest-environment node
// Explicitly mocked PDF.js item/page inputs: real parser source-mapping refusals, not PDF extraction.
import { afterEach, it, expect, vi } from 'vitest'
import { decodePdfSourceAnchor, PDF_SOURCE_ANCHOR_ATTRIBUTE } from '@shrubbery/nucleus'
import { parsePdfFastTextDocument } from '../pdf-layout-parser.js'
import { loadPdfJs } from '../pdfjs-runtime.js'
vi.mock('../pdfjs-runtime.js', () => ({ loadPdfJs: vi.fn() }))
afterEach(() => vi.resetAllMocks())
async function parse(pageChange: Record<string, unknown> = {}, itemChange: Record<string, unknown> = {}, text = 'Retained source passage') {
  const page = { view: [0, 0, 600, 800], rotate: 0, userUnit: 1,
    getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] }),
    getTextContent: async () => ({ styles: { f1: { ascent: .75, descent: -.25 } }, items: [
      { str: text, transform: [12, 0, 0, 12, 72, 650], width: 120, height: 12, fontName: 'f1', ...itemChange },
    ] }), cleanup: vi.fn(), ...pageChange }
  const destroy = vi.fn(async () => {})
  vi.mocked(loadPdfJs).mockResolvedValue({ version: 'mock-geometry-only', getDocument: () => ({
    promise: Promise.resolve({ numPages: 1, getMetadata: async () => null, getPage: async () => page }), destroy,
  }) } as any)
  const value = await parsePdfFastTextDocument({ bytes: new Uint8Array([1]), fallbackTitle: 'Synthetic' })
  expect(destroy).toHaveBeenCalledOnce()
  return value
}
it('uses the original item matrix and actual font extents, not guessed prose width', async () => {
  const value = await parse(), a = decodePdfSourceAnchor(value.tiptapJson.content![1]!.attrs![PDF_SOURCE_ANCHOR_ATTRIBUTE])!
  expect(a.targets[0]!.rects).toEqual([[72, 647, 192, 659]])
})
it('uses a documented font-level extent when both PDF.js metrics are zero', async () => {
  const value = await parse({ getTextContent: async () => ({ styles: { f1: { ascent: 0, descent: 0 } }, items: [
    { str: 'Visible footnote', transform: [12, 0, 0, 12, 72, 650], width: 120, height: 12, fontName: 'f1' },
  ] }) })
  const anchor = decodePdfSourceAnchor(value.tiptapJson.content![1]!.attrs![PDF_SOURCE_ANCHOR_ATTRIBUTE])
  expect(anchor!.targets[0]!.rects).toEqual([[72, 647.6, 192, 659.6]])
  expect(value.warnings).toEqual([])
})
it('preserves valid metrics and text beside a zero-metric contributing span', async () => {
  const value = await parse({ getTextContent: async () => ({ styles: {
    f1: { ascent: .75, descent: -.25 }, f2: { ascent: 0, descent: 0 },
  }, items: [
    { str: 'First', transform: [12, 0, 0, 12, 72, 650], width: 30, height: 12, fontName: 'f1' },
    { str: 'second', transform: [12, 0, 0, 12, 105, 650], width: 36, height: 12, fontName: 'f2' },
  ] }) })
  const node = value.tiptapJson.content![1]!, anchor = decodePdfSourceAnchor(node.attrs![PDF_SOURCE_ANCHOR_ATTRIBUTE])
  expect(anchor!.targets[0]!.rects).toEqual([[72, 647, 102, 659], [105, 647.6, 141, 659.6]])
  expect(node.content).toEqual([{ type: 'text', text: 'First second' }])
  expect(value.warnings).toEqual([])
})
it('does not let zero-metric fallback repair an out-of-crop item', async () => {
  const value = await parse({ getTextContent: async () => ({ styles: { f1: { ascent: 0, descent: 0 } }, items: [
    { str: 'Outside crop', transform: [12, 0, 0, 12, 700, 650], width: 120, height: 12, fontName: 'f1' },
  ] }) })
  expect(decodePdfSourceAnchor(value.tiptapJson.content![1]!.attrs![PDF_SOURCE_ANCHOR_ATTRIBUTE])).toBeNull()
  expect(value.warnings.join(' ')).toContain('missing contributing geometry')
})
for (const [name, mutation] of [['missing matrix', { transform: undefined }], ['nonfinite matrix', { transform: [12, 0, 0, 12, Infinity, 650] }],
  ['missing advance', { width: undefined }], ['zero advance', { width: 0 }]] as const)
  it('retains text but no invented source rectangle with ' + name, async () => {
    const value = await parse({}, mutation)
    expect(decodePdfSourceAnchor(value.tiptapJson.content![1]!.attrs![PDF_SOURCE_ANCHOR_ATTRIBUTE])).toBeNull()
    expect(value.warnings.join(' ')).toContain('missing contributing geometry')
    expect(value.extractionStatus).toBe('partial')
  })
for (const [name, mutation] of [['bad rotation', { rotate: 45 }], ['huge coordinate', { view: [0, 0, 1e10, 800] }],
  ['huge userUnit', { userUnit: 1e7 }], ['reversed crop', { view: [600, 0, 0, 800] }]] as const)
  it('keeps explicit unmapped page state for ' + name, async () => {
    const value = await parse(mutation)
    expect(decodePdfSourceAnchor(value.tiptapJson.content![1]!.attrs![PDF_SOURCE_ANCHOR_ATTRIBUTE])).toBeNull()
    expect(value.warnings.join(' ')).toContain('unsupported page geometry')
  })
it('a bare marker remains actual source text, not an invented empty list', async () => {
  const value = await parse({}, {}, '- ')
  expect(value.tiptapJson.content![1]!.type).toBe('paragraph')
  expect(value.tiptapJson.content![1]!.content![0]!.text).toBe('-')
  expect(decodePdfSourceAnchor(value.tiptapJson.content![1]!.attrs![PDF_SOURCE_ANCHOR_ATTRIBUTE])).not.toBeNull()
})
it('empty source spans give no anchor to the title or warning', async () => {
  const value = await parse({}, {}, '')
  expect(value.tiptapJson.content!.every(n => decodePdfSourceAnchor(n.attrs?.[PDF_SOURCE_ANCHOR_ATTRIBUTE]) === null)).toBe(true)
})
