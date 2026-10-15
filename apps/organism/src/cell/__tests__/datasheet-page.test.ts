// @vitest-environment node
/**
 * A datasheet's info page (files-kinds/datasheet-page.ts), from real answers: the OPA2134 `datasheet_facts` reading and the editions of
 * Vera's datasheet library (fixtures/datasheet-page), both captured read-only from her local cell. And the section rules as data.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readDatasheetFacts } from '../files-kinds/datasheet-reader.js'
import { datasheetPageContent, headline, keyValues, partType, readEditions, readRegisters, relatedLinks } from '../files-kinds/datasheet-page.js'
import { datasheetKind } from '../files-kinds/index.js'
import { resolveInfoSections, STANDARD_INFO_SECTIONS, type KindPageInput } from '../files-kinds/registry.js'

const here = dirname(fileURLToPath(import.meta.url))
const json = (path: string) => JSON.parse(readFileSync(join(here, 'fixtures', path), 'utf8')) as Record<string, unknown>
const editionsRows = (json('datasheet-page/datasheet-library-editions.json').rows ?? []) as Record<string, unknown>[]
const listing = json('datasheet-page/datasheet-library-listing.json') as unknown as { artifacts: { id: string; label: string; fileType: string }[] }
const tree = listing.artifacts.map(a => ({ key: `artifact:${a.id}`, id: a.id, label: a.label, kind: 'artifact' as const }))
const OPA = 'ds-ede0a2dfc224c765'
const opa = readDatasheetFacts(json('datasheet-facts/ti-opa2134_DS.pdf.json'), OPA, { fileName: 'ti-opa2134_DS.pdf' })

const input = (over: Partial<KindPageInput> = {}): KindPageInput => ({
  artifactId: OPA, fileName: 'ti-opa2134_DS.pdf', filter: '', reading: opa, readingStatus: 'ready', readingError: '', evidence: undefined,
  rows: { editions: editionsRows, registers: [] }, tree, companions: [{ key: `artifact:${OPA}-text`, label: 'ti-opa2134_DS.text.txt', role: 'text', roleLabel: 'Text the reader read' }],
  ...over,
})

describe('the sections, as data', () => {
  it('a datasheet folds its PDF below what was read from it; the standard sections keep their place', () => {
    const { sections, refused } = resolveInfoSections(datasheetKind.page!.sections)
    expect(refused).toEqual([])
    expect(sections.map(s => `${s.id}${s.collapsed ? ' (folded)' : ''}`)).toEqual(['key-values', 'notes', 'extracted', 'related', 'source (folded)', 'reading (folded)',
      'about (folded)', 'connections (folded)'])
    expect(sections.find(s => s.id === 'source')).toMatchObject({ title: 'Source PDF', face: 'source' })
  })
  it('every other file has the standard page: its contents open first', () => {
    expect(resolveInfoSections().sections.map(s => s.id)).toEqual(STANDARD_INFO_SECTIONS.map(s => s.id))
    expect(resolveInfoSections().sections[0]).toMatchObject({ id: 'source', collapsed: false })
  })
  it('a rule naming a face outside the catalogue, or a new section with no title, is refused whole', () => {
    const { sections, refused } = resolveInfoSections([{ id: 'x', title: 'X', order: 1, collapsed: false, face: 'iframe' as never }, { id: 'y', order: 2 }])
    expect(refused).toEqual(['x', 'y'])
    expect(sections.some(s => s.id === 'x' || s.id === 'y')).toBe(false)
  })
})

describe('the OPA2134 page', () => {
  const page = datasheetPageContent(input())

  it('the head: the part large, the family as chips, the maker (from the file name), type and pages', () => {
    expect(page.head).toEqual({ title: 'OPA2134',
      chips: [{ text: 'OPA134' }, { text: 'OPA2134', current: true }, { text: 'OPA4134' }],
      lines: [{ text: 'Texas Instruments', title: 'Maker from the file name' }, { text: 'Datasheet' }, { text: '35 pages' }] })
  })

  it('key values: the importer\'s own, then what an op-amp is known by, each with its page; the typical said small', () => {
    const values = page.bodies['key-values']
    expect(values?.face).toBe('values')
    if (values?.face !== 'values') return
    expect(values.values.map(v => [v.label, v.text, v.qualifier ?? '', v.page])).toEqual([
      ['Gain bandwidth', '8 MHz', 'typ', 7], ['Supply voltage', '5–36 V', 'typ 30', 5], ['Voltage noise', '8 nV/√Hz', 'typ', 7], ['Quiescent current', '≤ 5 mA', 'typ 4', 8]])
    expect(values.values.every(v => !v.disputed)).toBe(true)
  })

  it('what we extracted: grouped by the document\'s tables, its own headings inside, every row with a page; the filter keeps every word', () => {
    const table = page.bodies.extracted
    expect(table?.face).toBe('table')
    if (table?.face !== 'table') return
    expect(table.groups.map(g => g.title)).toEqual(['Absolute Maximum Ratings', 'Recommended Operating Conditions', 'Electrical Characteristics', 'ESD Ratings'])
    const electrical = table.groups[2]!.rows
    expect(electrical.filter(r => 'heading' in r).map(r => (r as { heading: string }).heading).slice(0, 4)).toEqual(['Audio performance', 'Frequency response', 'Noise', 'Offset voltage'])
    expect(table.total).toBe(54)
    expect(page.counts?.extracted).toBe('54')
    const filtered = datasheetPageContent(input({ filter: 'thd 3vrms' })).bodies.extracted
    if (filtered?.face !== 'table') throw new Error('no table')
    expect(filtered.shown).toBe(2)
    expect(filtered.groups.flatMap(g => g.rows).filter(r => !('heading' in r)).map(r => (r as { typ: string }).typ)).toEqual(['0.00008', '0.00015'])
  })

  it('about this reading: who read it, what became of what it read, and the text it read (a companion, reached from here)', () => {
    const facts = page.bodies.reading
    if (facts?.face !== 'facts') throw new Error('no facts')
    const said = Object.fromEntries(facts.rows.map(r => [r.label, r]))
    expect(said.Values!.text).toBe('84 values read: 2 key values and 82 table rows (19 table headings and 9 repeats set aside)')
    expect(said.Disputed!.text).toBe('None: no two readers disagreed about a value')
    expect(said['Text the reader read']).toMatchObject({ text: 'ti-opa2134_DS.text.txt', action: `open:artifact:${OPA}-text` })
  })

  it('an errata has no table and no key values: those sections are not drawn; a datasheet with nothing read says so', () => {
    const errata = datasheetPageContent(input({ artifactId: 'ds-f8511ca18665d3ab', fileName: 'espressif-esp32-c3-errata-master.pdf', companions: [],
      reading: readDatasheetFacts({ editions: [{ artifact: 'ds-f8511ca18665d3ab', documentType: 'errata', claims: [] }] }, 'ds-f8511ca18665d3ab') }))
    expect(errata.hidden).toEqual(expect.arrayContaining(['key-values', 'extracted']))
    expect(errata.head!.lines.map(l => l.text)).toContain('Errata')
    const textOnly = datasheetPageContent(input({ artifactId: 'ds-728a4847478dc4de', fileName: 'vishay-si2302cds_DS.pdf', companions: [],
      reading: readDatasheetFacts(json('datasheet-facts/vishay-si2302cds-datasheet.pdf.json'), 'ds-728a4847478dc4de') }))
    expect(textOnly.notes?.extracted).toMatch(/^Text only: no tables were read/)
  })
})

describe('related documents (the library\'s real editions)', () => {
  const editions = readEditions(editionsRows)
  it('reads one record per edition, its families gathered', () => {
    expect(editions.size).toBe(28)
    expect([...editions.get(OPA)!.families].sort()).toEqual(['OPA134', 'OPA2134', 'OPA4134'])
  })
  it('the ESP32-C3 datasheet: its errata and reference manual are the same part; its module is a related part', () => {
    const links = relatedLinks(input({ artifactId: 'ds-833fc000b4b3c3d3', fileName: 'espressif-esp32-c3_DS.pdf', companions: [] }), editions)
    const by = Object.fromEntries(links.map(l => [l.detail, l.tag]))
    expect(by['espressif-esp32-c3-errata-master.pdf']).toBe('Errata')
    expect(by['espressif-esp32-c3-trm.pdf']).toBe('Technical reference manual')
    expect(by['espressif-esp32-c3-mini-1_DS.pdf']).toBe('Datasheet · related part')
    expect(links[0]!.tag).not.toMatch(/related part/)
    expect(links.every(l => l.action.startsWith('open:artifact:'))).toBe(true)
  })
  it('two editions of the ATmega328P sheet find each other, though their records only echo their file names', () => {
    const links = relatedLinks(input({ artifactId: 'ds-bf1c2e470f8ec7d4', fileName: 'microchip-atmega328p_DS-revA.pdf', companions: [] }), editions)
    expect(links.map(l => l.detail)).toEqual(['microchip-atmega328p_DS-revB.pdf'])
  })
  it('a document of the graph whose name carries the part is related too; the file\'s own notes are not', () => {
    const withDocs = [...tree, { key: 'document:doc-1', id: 'doc-1', label: 'OPA2134 headphone buffer', kind: 'document' as const },
      { key: `document:notes-${OPA}`, id: `notes-${OPA}`, label: 'Notes on ti-opa2134_DS.pdf', kind: 'document' as const }]
    const links = relatedLinks(input({ tree: withDocs, companions: [{ key: `document:notes-${OPA}`, label: 'Notes on ti-opa2134_DS.pdf', role: 'notes', roleLabel: 'Your notes' }] }), editions)
    expect(links.map(l => [l.label, l.tag])).toEqual([['OPA2134 headphone buffer', 'Document']])
  })
})

describe('the pieces', () => {
  it('a key value\'s headline: the range or the limit large, the typical small', () => {
    expect(headline({ slots: { min: '4.5', typ: '12', max: '28' }, unit: 'V', value: '' })).toEqual({ text: '4.5–28 V', qualifier: 'typ 12' })
    expect(headline({ slots: { min: '−40', typ: '', max: '125' }, unit: '°C', value: '' })).toEqual({ text: '−40 to 125 °C' })
    expect(headline({ slots: { min: '', typ: '8', max: '' }, unit: 'MHz', value: '' })).toEqual({ text: '8 MHz', qualifier: 'typ' })
  })
  it('a part\'s type from the records or the title', () => {
    expect(partType('op-amp')).toBe('op-amp')
    expect(partType(null, 'unknown', 'TLV755P 500mA, Low-IQ, Small-Size, Low-Dropout Regulator')).toBe('ldo')
    expect(partType(null, 'unknown', 'TPS54331 3-A, 28-V Input, Step Down DC-DC Converter With Eco-mode')).toBe('converter')
    expect(partType(null, null, null)).toBe('')
  })
  it('key values of a converter (LM5164) carry the dispute in words', () => {
    const lm = readDatasheetFacts(json('datasheet-facts/ti-lm5164_DS.pdf.json'), 'ds-cce03619fbe13951', { fileName: 'ti-lm5164_DS.pdf' })
    const values = keyValues(lm.rows, 'converter')
    expect(values.find(v => v.label === 'Switching frequency')!.disputed).toMatch(/^The readers disagree/)
    expect(values.filter(v => v.disputed)).toHaveLength(1)
  })
  it('registers: the reader\'s "UNKNOWN · ?" rows say nothing and are left out', () => {
    const regs = readRegisters([
      { r: '<urn:r:0>', name: '"UNKNOWN"', address: '"?"', page: '"23"', fields: '"0"' },
      { r: '<urn:r:1>', name: '"Config register"', address: '"01h"', reset: '"8583h"', page: '"25"', fields: '"11"' }])
    expect(regs).toEqual([{ id: 'urn:r:1', name: 'Config register', address: '01h', reset: '8583h', fields: 11, description: '', page: 25 }])
  })
})
