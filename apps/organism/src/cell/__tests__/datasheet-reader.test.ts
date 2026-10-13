import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { claimValue, plainDiagnostic, readDatasheetFacts } from '../files-kinds/datasheet-reader.js'
import { linesOf, locateOnPage, numbersIn } from '../pdf-reader/pdf-locate.js'

// Verbatim `datasheet_facts` answers captured from production (the corpus PDFs' real artifacts).
const fixture = (name: string) => JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/datasheet-facts', `${name}.json`), 'utf8')) as Record<string, unknown>

describe('the datasheet margin, from a real datasheet_facts answer', () => {
  const tps = readDatasheetFacts(fixture('ti-tps54331-datasheet.pdf'), 'ds-cf72dfd0ac69eec6')

  it('reads the identity into facts and the document diagnostics into plain words', () => {
    expect(tps.title).toMatch(/^TPS54331 3-A/)
    expect(tps.facts.map(f => [f.label, f.text])).toEqual([['Maker', 'Texas Instruments'], ['Part family', 'TPS54331'], ['Pages', '41'], ['Read', '47 rows, 3 key values']])
    expect(tps.notes).toEqual(['The text readers disagreed on parts of this document; values they did not agree on are marked.'])
    expect(tps.truncated).toBeNull()
  })

  it('groups the key values first, then each table by regime, with every row carrying its page', () => {
    expect(tps.groups.map(g => g.title).slice(0, 3)).toEqual(['Key values', '6.1 Absolute Maximum Ratings', '6.3 Recommended Operating Conditions'])
    expect(tps.rows).toHaveLength(47)
    expect(tps.rows.every(r => r.page !== null)).toBe(true)
  })

  it('marks a disagreement in words and as contested; a key value keeps the pages of its readings', () => {
    const vin = tps.rows.find(r => r.id === 'ds-cf72dfd0ac69eec6-params-vin')!
    expect(vin).toMatchObject({ contested: true, status: 'contested', mark: 'contested', value: '≤ 28 V', page: 1, readingPages: [4] })
    expect(vin.notes[0]).toBe('The readers disagree: prose read ?–28, ROC table read 3.5–28.')
    expect(vin.readings.map(r => r.page)).toEqual([4, 1])
  })

  it('a text-only document says so, plainly, with no table', () => {
    const vishay = readDatasheetFacts(fixture('vishay-si2302cds-datasheet.pdf'), 'ds-728a4847478dc4de')
    expect(vishay.rows).toEqual([])
    expect(vishay.empty).toMatch(/^Text only: no tables were read/)
    expect(vishay.facts.find(f => f.label === 'Maker')?.text).toBe('not stated')
  })

  it('reads an answer defensively: no edition, new identity fields, a box in user space', () => {
    expect(readDatasheetFacts({ editions: [] }, 'x').empty).toBe('Nothing was read from this file yet.')
    const raw = { editions: [{ artifact: 'a', maker: 'Acme', makerBy: 'the cover page', parts: ['x1'], partsBy: 'the title', pageCount: 3, claims: [
      { id: 'a-params-v', kind: 'keyParameter', parameter: 'v', page: 2, precision: 'cell', method: 'docling-cell', box: { page: 2, l: 10, b: 20, r: 110, t: 40 }, value: { upper: 5, unit: 'V' } },
      { id: 'a-params-w', kind: 'keyParameter', parameter: 'w', page: 2, box: { l: 1, b: 1, r: 0, t: 0 } }] }] }
    const r = readDatasheetFacts(raw, 'a')
    expect(r.facts.find(f => f.label === 'Maker')).toMatchObject({ text: 'Acme', hint: 'the cover page' })
    expect(r.rows[0]).toMatchObject({ box: { page: 2, l: 10, b: 20, r: 110, t: 40 }, precision: 'cell', method: 'docling-cell' })
    expect(r.rows[1]!.box).toBeUndefined()
  })

  it('writes values and unknown diagnostics', () => {
    expect(claimValue({ lower: 3.5, upper: 28, unit: 'V' })).toBe('3.5–28 V')
    expect(claimValue({ typical: 1.2, unit: 'mA' })).toBe('typ 1.2 mA')
    expect(plainDiagnostic('something_new')).toBe('Something new.')
  })
})

describe('locating a claim in the text of its page', () => {
  const item = (str: string, x: number, y: number, w = str.length * 5) => ({ str, transform: [10, 0, 0, 10, x, y], width: w, height: 10 })
  const page = linesOf([item('Input voltage', 10, 700), item('VIN', 120, 700), item('3.5', 300, 700), item('28', 360, 700), item('V', 400, 700),
    item('Output current', 10, 680), item('3', 360, 680), item('A', 400, 680), item('Switching frequency', 10, 660), item('456', 300, 660), item('684', 360, 660)])

  it('numbers keep their sign only at the start of a token', () => {
    expect(numbersIn('1.8-6.5 V, −0.3 to 1,200')).toEqual([1.8, 6.5, -0.3, 1200])
  })

  it('boxes the row whose words and numbers match, and nothing for a row the page does not print', () => {
    const found = locateOnPage(page, [
      { id: 'vin', label: 'Input voltage', symbol: 'VIN', numbers: [3.5, 28] }, { id: 'fsw', label: 'Switching frequency', symbol: '', numbers: [456, 684] },
      { id: 'ghost', label: 'Dropout voltage', symbol: 'VDO', numbers: [200] }])
    expect([...found.keys()].sort()).toEqual(['fsw', 'vin'])
    expect(found.get('vin')!.rect.y0).toBeGreaterThan(found.get('fsw')!.rect.y1)
  })
})
