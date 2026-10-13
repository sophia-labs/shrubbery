import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import portable from './fixtures/pdf-source-anchor-v1.json'
import { inspectPdfSourceAnchor, decodePdfSourceAnchor, encodePdfSourceAnchor, canonicalPdfAnchorText,
  sha256PdfAnchorText, sha256PdfSourceBytes, type PdfSourceAnchorV1 } from '../pdf-source-anchor.js'
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const fixture = (): PdfSourceAnchorV1 => ({ version: 1, source: { sha256: hash('synthetic original'), byteLength: 18 },
  textSha256: hash('text'), relation: 'derived-from', precision: 'block', extraction: { approach: 'pdf.fast-text', version: 'test-v1' },
  targets: [{ pageIndex: 0, space: 'pdf-user-space', viewBox: [-10, 20, 590, 820], userUnit: 1, rotation: 90, rects: [[20, 30, 80, 42], [20, 50, 90, 62]] }] })
describe('PDF source anchor v1 wire', () => {
  it('accepts the exact portable native decoder fixture and source-text digest', async () => {
    const decoded = decodePdfSourceAnchor(portable.wire)!
    expect(decoded).toEqual(portable.anchor)
    expect(encodePdfSourceAnchor(decoded)).toBe(portable.wire)
    expect(await sha256PdfAnchorText({ type: 'paragraph', content: [{ type: 'text', text: portable.text }] })).toBe(portable.expectedTextSha256)
  })
  it('roundtrips deterministically without mutating raw data', () => {
    const a = fixture(), before = JSON.stringify(a), encoded = encodePdfSourceAnchor(a)
    expect(decodePdfSourceAnchor(encoded)).toEqual(a)
    expect(encodePdfSourceAnchor(JSON.parse(encoded))).toBe(encoded)
    expect(JSON.stringify(a)).toBe(before)
    const reordered = { ...a, source: { byteLength: a.source.byteLength, sha256: a.source.sha256 } }
    expect(encodePdfSourceAnchor(reordered)).toBe(encoded)
  })
  it('distinguishes absent, invalid and unsupported without changing raw strings', () => {
    expect(inspectPdfSourceAnchor(undefined)).toEqual({ status: 'absent' })
    expect(inspectPdfSourceAnchor(null)).toEqual({ status: 'absent' })
    for (const raw of ['', '{', '[]', 'null', '{}', 42, fixture()]) expect(inspectPdfSourceAnchor(raw).status).toBe('invalid')
    const future = ' { "version": 2, "unknown": ["retained"] } '
    expect(inspectPdfSourceAnchor(future)).toMatchObject({ status: 'unsupported', reason: expect.any(String) })
    expect(future).toBe(' { "version": 2, "unknown": ["retained"] } ')
  })
  const mutations: Array<[string, (v: any) => void]> = [
    ['missing text digest', v => delete v.textSha256], ['upper hash', v => v.source.sha256 = 'A'.repeat(64)],
    ['source byte length zero', v => v.source.byteLength = 0], ['unsafe byte length', v => v.source.byteLength = Number.MAX_SAFE_INTEGER + 1],
    ['extra top key', v => v.future = true], ['extra source key', v => v.source.url = 'https://invalid'],
    ['extra extraction key', v => v.extraction.future = true], ['extra target key', v => v.targets[0].future = true],
    ['revision without artifact', v => v.source.revisionId = 'r1'], ['path ID', v => v.source.artifactId = '../original'],
    ['dot ID', v => v.source.artifactId = '.'], ['overlong ID', v => v.source.artifactId = 'a'.repeat(201)],
    ['empty extraction approach', v => v.extraction.approach = ' '], ['UTF8 extraction bound', v => v.extraction.version = '🪴'.repeat(33)],
    ['fractional page', v => v.targets[0].pageIndex = .5], ['negative page', v => v.targets[0].pageIndex = -1],
    ['screen-space', v => v.targets[0].space = 'pixels'], ['rotation 45', v => v.targets[0].rotation = 45],
    ['infinite crop', v => v.targets[0].viewBox[0] = Infinity], ['huge coordinate', v => v.targets[0].viewBox[2] = 1e9 + 1],
    ['reversed crop', v => v.targets[0].viewBox = [2, 0, 1, 10]], ['zero crop area', v => v.targets[0].viewBox = [0, 0, 1, 0]],
    ['zero unit', v => v.targets[0].userUnit = 0], ['huge unit', v => v.targets[0].userUnit = 1e6 + 1],
    ['underflow scaled dimensions', v => v.targets[0].userUnit = Number.MIN_VALUE],
    ['outside crop', v => v.targets[0].rects[0][0] = -11], ['reversed rect', v => v.targets[0].rects[0] = [90, 30, 80, 42]],
    ['no rectangles', v => v.targets[0].rects = []], ['too many rectangles', v => v.targets[0].rects = Array(2049).fill([20, 30, 80, 42])],
    ['no targets', v => v.targets = []], ['too many targets', v => v.targets = Array(65).fill(v.targets[0])],
  ]
  for (const [name, mutate] of mutations) it('refuses ' + name, () => {
    const a = fixture(); mutate(a)
    expect(inspectPdfSourceAnchor(JSON.stringify(a)).status).toBe('invalid')
    expect(() => encodePdfSourceAnchor(a)).toThrow()
  })
  it('enforces the UTF8 wire bound before interpretation', () => expect(inspectPdfSourceAnchor(' '.repeat(65_537)).status).toBe('invalid'))
  it('supports exact qualified immutable source and boundary crop', () => {
    const a = fixture(); a.source.artifactId = 'artifact-1'; a.source.revisionId = 'rev.1'; a.targets = [{ ...a.targets[0]!, rects: [a.targets[0]!.viewBox] }]
    expect(decodePdfSourceAnchor(encodePdfSourceAnchor(a))).toEqual(a)
  })
})
describe('exact source text leaf digest', () => {
  it('counts text leaves once, ignoring cached ancestor text, marks and non-text leaves', async () => {
    const node = { type: 'paragraph', text: 'CACHED NOT SOURCE', attrs: { text: 'ATTR' }, content: [
      { type: 'text', text: 'A leaf ', marks: [{ type: 'bold', attrs: { text: 'MARK' } }] },
      { type: 'image', text: 'NOT TEXT' }, { type: 'hardBreak' }, { type: 'text', text: '🪴\nExact.' },
    ] }
    expect(canonicalPdfAnchorText(node)).toBe('A leaf 🪴\nExact.')
    expect(await sha256PdfAnchorText(node)).toBe(hash('A leaf 🪴\nExact.'))
    expect(await sha256PdfSourceBytes(new TextEncoder().encode('exact bytes'))).toBe(hash('exact bytes'))
    node.content[0]!.text = 'A Leaf '
    expect(await sha256PdfAnchorText(node)).not.toBe(hash('A leaf 🪴\nExact.'))
  })
  it('does not insert separators or normalize whitespace/unicode', () => {
    expect(canonicalPdfAnchorText({ content: [{ type: 'text', text: 'e\u0301 ' }, { type: 'text', text: ' x' }] })).toBe('e\u0301  x')
  })
})
