import { describe, expect, it } from 'vitest'
import { buildInfoModel, type InfoContext, type InfoItem } from '../files-info.js'
import { datasheetKind } from '../files-kinds/index.js'
import { readEvidence } from '../files-kinds/registry.js'

const file = (id: string, label: string, caption = 'TXT', sizeBytes: number | null = 40): InfoItem =>
  ({ key: `artifact:${id}`, kind: 'artifact', id, label, mimeType: 'text/plain', caption, sizeBytes })
const ctx = (items: InfoItem[], extra: Partial<InfoContext> = {}): InfoContext => ({
  items, location: () => ({ text: 'Files / Kitchen', action: 'location:fld' }), contents: () => ({ direct: 2, files: 2, bytes: 100, unknown: 0 }),
  scope: () => ({ files: items.length, bytes: 100, unknown: 0 }), detail: null, detailStatus: 'ready', wires: null, evidence: undefined, writable: true, ...extra })

describe('the Show info model', () => {
  it('a file: name renamable, location a link, id copyable, digest abbreviated but copied whole', () => {
    const sha = 'ab'.repeat(32)
    const m = buildInfoModel(ctx([file('f1', 'notes.txt')], { detail: { sizeBytes: 40, createdAt: '2026-10-08T10:00:00Z', updatedAt: null, createdBy: 'Vera', updatedBy: null, sha256: sha, revisions: 3, wordCount: null } }))!
    expect(m.title).toBe('notes.txt'); expect(m.renamable).toBe(true)
    const rows = Object.fromEntries(m.sections.flatMap(s => s.rows).map(r => [r.label, r]))
    expect(rows.Where).toMatchObject({ action: 'location:fld' })
    expect(rows.ID).toMatchObject({ copy: true, mono: true })
    expect(rows['SHA-256']).toMatchObject({ copy: true, copyText: sha, text: 'abababab…ababab' })
    expect(rows.Revisions!.text).toBe('3')
    expect(rows.Created!.text).toMatch(/by Vera$/)
  })
  it('a read-only graph cannot rename; a kind with no info adds nothing; connections say when there are none', () => {
    const m = buildInfoModel(ctx([file('f1', 'a.txt')], { writable: false, wires: [] }))!
    expect(m.renamable).toBe(false)
    expect(m.sections.map(s => s.id)).toEqual(['general', 'file', 'connections'])
    expect(m.sections.at(-1)!.note).toBe('No connections.')
  })
  it('several items: a summary with the count, the total size and the kinds', () => {
    const m = buildInfoModel(ctx([file('a', 'a.txt'), file('b', 'b.pdf', 'PDF')]))!
    expect(m.title).toBe('2 items')
    const rows = Object.fromEntries(m.sections[0]!.rows.map(r => [r.label, r.text]))
    expect(rows).toMatchObject({ Items: '2', 'Total size': '100 bytes', Kinds: 'TXT 1, PDF 1' })
  })
  it('the datasheet kind contributes its block; a reader line only when the records name the reader', () => {
    const rows = (reader: boolean) => [{ artifact: '"f1"', kind: '"datasheet"', datasheet_part: '"TPS62840"', datasheet_maker: '"TI"', datasheet_rowCount: '"212"', datasheet_toCheck: '"0"',
      ...(reader ? { datasheet_readerTool: '"datasheet-parser (NomDeTom)"', datasheet_readerCommit: '"ee680a6f1c2d"', datasheet_doclingVersion: '"2.135.0"' } : {}) }]
    const read = (reader: boolean) => readEvidence([datasheetKind], rows(reader)).get('f1')
    const withReader = buildInfoModel(ctx([file('f1', 'TPS.pdf', 'PDF')], { evidence: read(true) }))!
    const block = withReader.sections.find(s => s.title === 'Datasheet')!
    expect(block.rows.find(r => r.label === 'Reader')!.text).toBe('Read with datasheet-parser (NomDeTom) ee680a6 · Docling 2.135.0')
    expect(block.rows.at(-1)).toMatchObject({ text: 'Open', action: 'kind:open' })
    expect(block.rows.some(r => r.label === 'To check')).toBe(false)
    const without = buildInfoModel(ctx([file('f1', 'TPS.pdf', 'PDF')], { evidence: read(false) }))!
    expect(without.sections.find(s => s.title === 'Datasheet')!.rows.some(r => r.label === 'Reader')).toBe(false)
  })
})
