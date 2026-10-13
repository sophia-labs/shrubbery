// @vitest-environment node
// Actual generated PDF bytes and installed PDF.js; HTTP is mocked only in transfer cases.
import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { decodePdfSourceAnchor, PDF_SOURCE_ANCHOR_ATTRIBUTE, sha256PdfAnchorText, type ShrubberyContract } from '@shrubbery/nucleus'
import { parseBrowserBinaryDocument, GardendDocumentTransferService, type BrowserBinaryDocumentParser } from '../document-transfer.js'
import { pdfBytes, columnRows, tableRows, type PdfPageOptions } from './pdf-test-fixtures.js'
import { parsePdfFastTextDocument, type TipTapJsonNode } from '../pdf-layout-parser.js'
const digest = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const anchor = (n: TipTapJsonNode) => decodePdfSourceAnchor(n.attrs?.[PDF_SOURCE_ANCHOR_ATTRIBUTE])
const file = (bytes: Uint8Array<ArrayBuffer>, name = 'anchored.pdf') => new File([bytes], name, { type: 'application/pdf' })

describe('actual PDF source geometry', () => {
  it('holds one byte snapshot across caller mutation and async parser loading', async () => {
    const bytes = pdfBytes([columnRows]), beforeHash = digest(bytes), beforeLength = bytes.byteLength
    const pending = parsePdfFastTextDocument({ bytes, fallbackTitle: 'Snapshot' })
    bytes.fill(0)
    const parsed = await pending, a = anchor(parsed.tiptapJson.content![1]!)!
    expect(a.source).toEqual({ sha256: beforeHash, byteLength: beforeLength })
    expect(parsed.extractionStatus).toBe('text-extracted')
  })
  it('keeps the browser-safe fixture builder byte-identical to all four retained originals', () => {
    const samples = [pdfBytes([columnRows]), pdfBytes([tableRows]),
      pdfBytes([[], [{ text: 'ORIGINAL SOURCE PAGE TWO' }], [{ text: 'ORIGINAL SOURCE PAGE THREE' }]]), pdfBytes([[], []])]
    expect(samples.map(digest)).toEqual([
      '9518a533f83a3e96b86ab3b7fd14e4c6f56484709284a4b0f62af27aa668a7fb',
      'e74e72e9ed30e27bfd09fc6cd1393a2a6307856adc2b437b71f7f71dfa56f247',
      '087c52ad3755a4302430ca8ad6390e178a9e1a1cf349fcf0abf4d1f77393e649',
      '0215ab26682e25224c553ba9e547770fdde569deda1672135274643571639220',
    ])
  })
  it('keeps separate contributing line regions and exact original/text identities for both columns', async () => {
    const bytes = pdfBytes([columnRows]), parsed = await parseBrowserBinaryDocument(file(bytes))
    const blocks = parsed.tiptapJson!.content!.filter(n => n.type === 'paragraph')
    expect(blocks).toHaveLength(2)
    for (const [index, block] of blocks.entries()) {
      const a = anchor(block)!
      expect(a.source).toEqual({ sha256: digest(bytes), byteLength: bytes.byteLength })
      expect(a.textSha256).toBe(await sha256PdfAnchorText(block))
      expect(a.targets[0]).toMatchObject({ pageIndex: 0, viewBox: [0, 0, 2000, 2000], rotation: 0, userUnit: 1 })
      expect(a.targets[0]!.rects).toHaveLength(6)
      expect(a.targets[0]!.rects.every(r => index === 0 ? r[2] < 1000 : r[0] > 1000)).toBe(true)
    }
    expect(anchor(parsed.tiptapJson!.content![0]!)).toBeNull()
  })
  it('keeps all nine source-cell rectangles on the table block, without a union across the gaps', async () => {
    const parsed = await parseBrowserBinaryDocument(file(pdfBytes([tableRows])))
    const table = parsed.tiptapJson!.content!.find(n => n.type === 'table')!, a = anchor(table)!
    expect(a.targets[0]!.rects).toHaveLength(9)
    expect(a.targets[0]!.rects.map(r => r[0])).toEqual([72, 280, 500, 72, 280, 500, 72, 280, 500])
    expect(a.textSha256).toBe(await sha256PdfAnchorText(table))
  })
  for (const [rotation, matrix] of [
    [0, [1, 0, 0, 1, 180, 500]], [90, [0, 1, -1, 0, 180, 300]],
    [180, [-1, 0, 0, -1, 550, 500]], [270, [0, -1, 1, 0, 550, 700]],
  ] as const) it('retains unrotated effective crop/userUnit and maps layout at rotation ' + rotation, async () => {
    const options: PdfPageOptions = { mediaBox: [0, 0, 800, 1000], cropBox: [100, 200, 700, 900], rotation, userUnit: 2 }
    const bytes = pdfBytes([[{ text: 'ROTATED CROP SOURCE', matrix, size: 12 }]], [options])
    const parsed = await parseBrowserBinaryDocument(file(bytes)), block = parsed.tiptapJson!.content![1]!, a = anchor(block)!
    expect(a).not.toBeNull()
    expect(a.targets[0]).toMatchObject({ pageIndex: 0, viewBox: options.cropBox, userUnit: 2, rotation })
    const rect = a.targets[0]!.rects[0]!
    expect(rect[0]).toBeGreaterThanOrEqual(100); expect(rect[2]).toBeLessThanOrEqual(700)
    expect(rect[1]).toBeGreaterThanOrEqual(200); expect(rect[3]).toBeLessThanOrEqual(900)
    if (rotation === 0 || rotation === 180) expect(rect[3] - rect[1]).toBeLessThan(15)
    else expect(rect[2] - rect[0]).toBeLessThan(15)
    expect(a.textSha256).toBe(await sha256PdfAnchorText(block))
    expect(parsed.warnings).toEqual([])
  })
  it('keeps physical page indices through blank first pages and gives no anchor to warning/title', async () => {
    const parsed = await parseBrowserBinaryDocument(file(pdfBytes([[], [{ text: 'PAGE TWO SOURCE' }]])))
    expect(anchor(parsed.tiptapJson!.content![1]!)!.targets[0]!.pageIndex).toBe(1)
    const empty = await parseBrowserBinaryDocument(file(pdfBytes([[]])))
    expect(empty.tiptapJson!.content!.every(n => anchor(n) === null)).toBe(true)
  })
})

function transfer(response: Record<string, unknown>, binaryParser?: BrowserBinaryDocumentParser) {
  const calls: Array<{ url: string; body: any }> = []
  const contract: Pick<ShrubberyContract, 'auth' | 'runtime'> = {
    auth: { token: () => 'test', userId: () => 'test', isAuthenticated: () => true, whenReady: async () => {}, onChange: () => () => {} },
    runtime: { mode: () => 'hosted', isGateway: () => true, graphBaseUrl: () => 'https://fixture.invalid' },
  }
  const service = new GardendDocumentTransferService(contract, { binaryParser, fetch: async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
    return new Response(JSON.stringify(String(url).endsWith('/revisions') ? response : String(url).endsWith('/api/crdt/operations') ? { documentId: 'doc-fixture' } : { label: 'original' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  } })
  return { calls, service }
}
describe('real upload service binds actual archive reply before document.write (mock HTTP)', () => {
  it('binds artifact and returned revision after checking literal original hash/size', async () => {
    const bytes = pdfBytes([columnRows]), t = transfer({ revisionId: 'rev-observed-42', contentHashSha256: digest(bytes), sizeBytes: bytes.byteLength })
    await t.service.uploadFile('graph', file(bytes))
    const staged = t.calls.find(c => c.url.endsWith('/revisions'))!
    const artifactId = staged.url.split('/').at(-2)!
    expect(Buffer.from(staged.body.dataBase64, 'base64')).toEqual(Buffer.from(bytes))
    const written = t.calls.find(c => c.body?.kind === 'document.write')!.body.payload.tiptapJson
    expect(anchor(written.content[1])!.source).toEqual({ sha256: digest(bytes), byteLength: bytes.byteLength, artifactId, revisionId: 'rev-observed-42' })
  })
  it('never manufactures a missing revision', async () => {
    const t = transfer({}), bytes = pdfBytes([columnRows]); await t.service.uploadFile('graph', file(bytes))
    const written = t.calls.find(c => c.body?.kind === 'document.write')!.body.payload.tiptapJson
    expect(anchor(written.content[1])!.source.artifactId).toBeTruthy()
    expect(anchor(written.content[1])!.source).not.toHaveProperty('revisionId')
  })
  for (const [name, reply] of [['hash mismatch', { contentHashSha256: '0'.repeat(64) }], ['size mismatch', { sizeBytes: 1 }], ['bad revision', { revisionId: '../escape' }], ['null revision', { revisionId: null }]] as const)
    it('refuses ' + name + ' before any text/CRDT write', async () => {
      const t = transfer(reply); await expect(t.service.uploadFile('graph', file(pdfBytes([columnRows])))).rejects.toThrow()
      expect(t.calls.some(c => c.body?.kind === 'document.write' || c.body?.kind === 'workspace.createDocument')).toBe(false)
    })
  it('refuses a parser anchor naming different source bytes before text write', async () => {
    const bytes = pdfBytes([columnRows]), parsed = await parseBrowserBinaryDocument(file(bytes))
    const node = parsed.tiptapJson!.content![1]!, value = JSON.parse(String(node.attrs![PDF_SOURCE_ANCHOR_ATTRIBUTE]))
    value.source.sha256 = '0'.repeat(64); node.attrs![PDF_SOURCE_ANCHOR_ATTRIBUTE] = JSON.stringify(value)
    const t = transfer({}, async () => parsed)
    await expect(t.service.uploadFile('graph', file(bytes))).rejects.toThrow('submitted original')
    expect(t.calls.some(c => c.body?.kind === 'document.write')).toBe(false)
  })
  for (const raw of [' {"version":2,"future":"retained"} ', '{malformed', ''])
    it('retains uninterpreted anchor bytes during source binding: ' + raw, async () => {
      const bytes = pdfBytes([columnRows]), parsed = await parseBrowserBinaryDocument(file(bytes))
      parsed.tiptapJson!.content![1]!.attrs![PDF_SOURCE_ANCHOR_ATTRIBUTE] = raw
      const t = transfer({ revisionId: 'real-returned' }, async () => parsed)
      await t.service.uploadFile('graph', file(bytes))
      expect(t.calls.find(c => c.body?.kind === 'document.write')!.body.payload.tiptapJson.content[1].attrs[PDF_SOURCE_ANCHOR_ATTRIBUTE]).toBe(raw)
    })
})
