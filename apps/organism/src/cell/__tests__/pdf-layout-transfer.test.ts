// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ShrubberyContract } from '@shrubbery/nucleus'
import { GardendDocumentTransferService, parseBrowserBinaryDocument } from '../document-transfer.js'
import { documentUploadSummary } from '../document-upload-summary.js'
import type { TipTapJsonNode } from '../pdf-layout-parser.js'
import { columnRows, pdfBytes, tableCells, tableRows, type PdfRow } from './pdf-test-fixtures.js'

const textOf = (node: TipTapJsonNode): string => node.text ?? (node.content ?? []).map(textOf).join(' ')
const pdfFile = (rows: readonly (readonly PdfRow[])[], name = 'paper.pdf') =>
  new File([pdfBytes(rows)], name, { type: 'application/pdf' })
async function parse(rows: readonly (readonly PdfRow[])[]) {
  const result = await parseBrowserBinaryDocument(pdfFile(rows))
  expect(result.tiptapJson?.type).toBe('doc')
  expect(result.markdown).toBeUndefined()
  return { ...result, tiptapJson: result.tiptapJson! }
}

describe('lightweight PDF text-layer recovery, actual PDF.js and PDF bytes', () => {
  it('extracts a control and reports the actual parser version', async () => {
    const result = await parse([[{ text: 'REAL PDF CONTROL SENTINEL' }]])
    expect(textOf(result.tiptapJson)).toContain('REAL PDF CONTROL SENTINEL')
    expect(result.extractionStatus).toBe('text-extracted')
    expect(result.warnings).toEqual([])
    expect(result.stats).toMatchObject({ pageCount: 1, approachId: 'pdf.fast-text', parserVersion: expect.any(String) })
  })

  it('keeps entire columns separate on exactly the prior counterexample bytes', async () => {
    expect(createHash('sha256').update(pdfBytes([columnRows])).digest('hex'))
      .toBe('9518a533f83a3e96b86ab3b7fd14e4c6f56484709284a4b0f62af27aa668a7fb')
    const result = await parse([columnRows])
    const paragraphs = result.tiptapJson.content!.filter(node => node.type === 'paragraph')
    expect(paragraphs).toHaveLength(2)
    expect(textOf(paragraphs[0]!)).toContain('Left column sentence 6')
    expect(textOf(paragraphs[0]!)).not.toContain('Right column')
    expect(textOf(paragraphs[1]!)).toContain('Right column sentence 1')
    expect(textOf(paragraphs[1]!)).not.toContain('Left column')
  })

  it('preserves original pages 2/3 and tells the caller that source page 1 had no text', async () => {
    const rows = [[], [{ text: 'ORIGINAL SOURCE PAGE TWO' }], [{ text: 'ORIGINAL SOURCE PAGE THREE' }]]
    expect(createHash('sha256').update(pdfBytes(rows)).digest('hex'))
      .toBe('087c52ad3755a4302430ca8ad6390e178a9e1a1cf349fcf0abf4d1f77393e649')
    const result = await parse(rows)
    for (const [page, text] of [[2, 'ORIGINAL SOURCE PAGE TWO'], [3, 'ORIGINAL SOURCE PAGE THREE']] as const) {
      const node = result.tiptapJson.content!.find(node => textOf(node).includes(text))!
      expect(node.attrs).toMatchObject({ 'data-pdf-page': page, 'data-source-page': page, 'data-source-format': 'pdf' })
    }
    expect(result.extractionStatus).toBe('partial')
    expect(result.warnings.some(warning => warning.startsWith('Page 1 did not contain extractable text'))).toBe(true)
  })

  it('returns native table rows/cells with source identity, not pipe-delimited Markdown', async () => {
    const result = await parse([tableRows])
    const table = result.tiptapJson.content!.find(node => node.type === 'table')!
    expect(table.attrs).toMatchObject({ 'data-pdf-page': 1, 'data-source-page': 1, 'data-source-role': 'table', 'data-block-id': expect.any(String) })
    expect(table.content!.map(row => row.content!.map(textOf))).toEqual(tableCells)
    expect(table.content![0]!.content!.every(cell => cell.type === 'tableHeader')).toBe(true)
    expect(table.content![1]!.content!.every(cell => cell.type === 'tableCell')).toBe(true)
  })

  it('does not count a filename-derived title or warning placeholder as extracted text', async () => {
    const result = await parse([[], []])
    expect(result.title).toBe('paper')
    expect(result.extractionStatus).toBe('no-text')
    expect(result.stats).toMatchObject({ totalChars: 0, textItemCount: 0, pageCount: 2 })
    expect(result.warnings).toHaveLength(3)
    expect(result.warnings.join(' ')).toContain('OCR was not performed')
    expect(textOf(result.tiptapJson)).toContain('No source text is available in this extraction')
  })

  it('does not classify former fixture names as special headings or quotation boundaries', async () => {
    const result = await parse([[
      { text: 'A miniature passage', y: 1600 },
      { text: 'Ordinary continuation stays ordinary', y: 1572 },
      { text: 'Search token: not a parser directive', y: 1544 },
      { text: 'Marginal Rule is just part of this sentence', y: 1516 },
    ]])
    expect(result.tiptapJson.content!.slice(1).every(node => node.type === 'paragraph')).toBe(true)
    expect(textOf(result.tiptapJson)).toContain('Search token: not a parser directive')
  })

  it('rejects malformed bytes without producing an extraction result', async () => {
    await expect(parseBrowserBinaryDocument(new File(['not a PDF'], 'bad.pdf', { type: 'application/pdf' })))
      .rejects.toThrow()
  })

  it('rejects an already cancelled parse', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(parseBrowserBinaryDocument(pdfFile([columnRows]), controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
  })
})

function mockTransport(mode: 'local' | 'hosted') {
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, any> | null }> = []
  const contract: Pick<ShrubberyContract, 'auth' | 'runtime'> = {
    auth: { token: () => 'synthetic', userId: () => 'synthetic-owner', isAuthenticated: () => true, whenReady: () => Promise.resolve(), onChange: () => () => {} },
    runtime: { mode: () => mode, isGateway: () => mode === 'hosted', graphBaseUrl: () => 'https://example.invalid/cell' },
  }
  const fetch: typeof globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(String(init.body)) : null })
    return new Response(JSON.stringify(String(url).endsWith('/api/crdt/operations')
      ? { documentId: 'synthetic-doc' } : { status: 'ready', label: 'original' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  return { calls, service: new GardendDocumentTransferService(contract, { fetch }) }
}

for (const mode of ['local', 'hosted'] as const) {
  it(`${mode}: sends the structured table to document.write and retains original/read-only links (HTTP mocked)`, async () => {
    const { calls, service } = mockTransport(mode)
    const file = pdfFile([tableRows])
    const result = await service.uploadFile('g', file, { parentId: 'folder' })
    const write = calls.find(call => call.body?.kind === 'document.write')!.body!.payload
    expect(write).not.toHaveProperty('content')
    expect(write).not.toHaveProperty('format')
    expect(write).toMatchObject({ readOnly: true, parentId: 'folder', tiptapJson: { type: 'doc' } })
    const table = write.tiptapJson.content.find((node: TipTapJsonNode) => node.type === 'table')
    expect(table.content.map((row: TipTapJsonNode) => row.content!.map(textOf))).toEqual(tableCells)
    const original = calls.find(call => call.url.endsWith('/revisions'))!.body!
    expect(Buffer.from(original.dataBase64, 'base64')).toEqual(Buffer.from(await file.arrayBuffer()))
    const source = calls.find(call => call.body?.kind === 'workspace.createDocument')!.body!.payload
    expect(source).toMatchObject({ documentId: result.documentId, readOnly: true, parentId: 'folder', sourceFile: { originalFilename: 'paper.pdf', fileType: 'pdf' } })
    expect(source.sourceFile).not.toHaveProperty('sizeBytes')
    expect(result).toMatchObject({ readOnly: true, jobId: null, warnings: [], extractionStatus: 'text-extracted' })
    expect(result.extractionStats).toMatchObject({ approachId: 'pdf.fast-text', parserVersion: expect.any(String), layoutAssembler: 'span-line-column-region-v2-recovered-1' })
    expect(calls.some(call => /\/import$|graphs\/jobs/.test(call.url))).toBe(false)
    expect((calls[0]!.init.headers as Headers).has('X-User-ID')).toBe(mode === 'local')
  })

  it(`${mode}: returns warnings and source-only status through the final shell summary (HTTP mocked)`, async () => {
    const { service } = mockTransport(mode)
    const progress: string[] = []
    const result = await service.uploadFile('g', pdfFile([[]]), { onProgress: (_file, state) => progress.push(state.message ?? '') })
    expect(result.extractionStatus).toBe('no-text')
    expect(result.warnings).toHaveLength(2)
    expect(progress.at(-1)).toContain('no text extracted')
    const summary = documentUploadSummary({ succeeded: [result], failed: [], skipped: [], cancelled: false })
    expect(summary).toContain('imported 0 documents, 1 original retained without extracted text')
    for (const warning of result.warnings) expect(summary).toContain(warning)
  })
}

it('keeps prior extraction warnings when a later file fails or the batch is cancelled', async () => {
  const { service } = mockTransport('hosted')
  const sourceOnly = await service.uploadFile('g', pdfFile([[]]))
  const failedFile = new File(['bad'], 'bad.pdf')
  const summary = documentUploadSummary({
    succeeded: [sourceOnly], failed: [{ file: failedFile, error: new Error('selected failure') }],
    skipped: [new File(['ignore'], '.DS_Store')], cancelled: true,
  })
  expect(summary).toContain('1 original retained without extracted text, failed 1, skipped 1 system files, cancelled')
  expect(summary).toContain('bad.pdf: selected failure')
  for (const warning of sourceOnly.warnings) expect(summary).toContain(warning)
})
