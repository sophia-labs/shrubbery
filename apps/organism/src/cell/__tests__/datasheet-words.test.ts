// @vitest-environment node
/**
 * How a datasheet's reading is said (files-kinds/datasheet-words.ts): numbers with their own precision, table headings told apart from
 * values, symbols the reader merged into names, and the part and maker when the records are thin. The file names are the real ones of
 * Vera's datasheet library (fixtures/datasheet-page/datasheet-library-listing.json).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  figure, fileNameWitness, isHeadingRow, parameterLabel, partIdentity, sectionWords, splitLeadingSymbol, titleParts, valueWords, withoutFootnotes,
} from '../files-kinds/datasheet-words.js'

const listing = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/datasheet-page/datasheet-library-listing.json'), 'utf8')) as
  { artifacts: { id: string; label: string; fileType: string }[] }

describe('numbers', () => {
  it('as printed: never rounded to zero, no binary noise, a true minus', () => {
    expect([0.00008, 0.00015, 32768, 0.1 + 0.2, -40, 0, 1e-9].map(figure)).toEqual(['0.00008', '0.00015', '32768', '0.3', '−40', '0', '1e-9'])
    expect(valueWords({ lower: 1.45, upper: 5.5, typical: null }, 'V')).toBe('1.45–5.5 V')
    expect(valueWords({ lower: -0.3, upper: 6, typical: null }, 'V')).toBe('−0.3 to 6 V')
    expect(valueWords({ lower: null, upper: 5, typical: 4 }, 'mA')).toBe('typ 4, ≤ 5 mA')
  })
})

describe('names', () => {
  it('footnote markers and cells read once per spanned column leave the name', () => {
    expect(withoutFootnotes('Headroom (1)')).toBe('Headroom')
    expect(withoutFootnotes('Storage temperature, Tstg Storage temperature, Tstg Storage temperature, Tstg')).toBe('Storage temperature, Tstg')
  })
  it('the importer\'s keys become words; printed names keep theirs', () => {
    expect(['gainBandwidth', 'vin', 'fsw', 'supplyVoltage', 'Input voltage', 'VIN'].map(parameterLabel))
      .toEqual(['Gain bandwidth', 'Input voltage', 'Switching frequency', 'Supply voltage', 'Input voltage', 'VIN'])
  })
  it('a table heading is told from a value: capitals, no number, its symbol and conditions the heading again', () => {
    expect(isHeadingRow({ label: 'AUDIO PERFORMANCE', symbol: 'AUDIO PERFORMANCE', conditions: 'AUDIO PERFORMANCE', hasNumber: false })).toBe(true)
    expect(isHeadingRow({ label: 'NOISE', symbol: null, conditions: null, hasNumber: false })).toBe(true)
    expect(isHeadingRow({ label: 'VCC', symbol: 'VCC', conditions: null, hasNumber: false })).toBe(false)
    expect(isHeadingRow({ label: 'OUTPUT', symbol: 'OUTPUT', conditions: null, hasNumber: true })).toBe(false)
    expect(isHeadingRow({ label: 'Slew rate', symbol: 'SR', conditions: null, hasNumber: false })).toBe(false)
  })
  it('a symbol merged into a name is split back out; a name that only starts with a capital is left alone', () => {
    expect(splitLeadingSymbol('TA Operating temperature')).toEqual({ symbol: 'TA', label: 'Operating temperature' })
    expect(splitLeadingSymbol('V(ESD) Electrostatic discharge')).toEqual({ symbol: 'V(ESD)', label: 'Electrostatic discharge' })
    expect(splitLeadingSymbol('tSUSTO Setup time for STOP condition')).toEqual({ symbol: 'tSUSTO', label: 'Setup time for STOP condition' })
    expect(splitLeadingSymbol('Input voltage')).toBeNull()
    expect(splitLeadingSymbol('Total harmonic distortion')).toBeNull()
  })
  it('a section is said without its number', () => {
    expect(sectionWords('5.1 Absolute Maximum Ratings (continued)')).toBe('Absolute Maximum Ratings')
    expect(sectionWords('Electrical Characteristics')).toBe('Electrical Characteristics')
  })
})

describe('what a file name says (every PDF of the library)', () => {
  it('maker, part, document type and edition', () => {
    const said = Object.fromEntries(listing.artifacts.filter(a => a.fileType === 'pdf').map(a => [a.label, fileNameWitness(a.label)]))
    expect(said['ti-opa2134_DS.pdf']).toEqual({ maker: 'Texas Instruments', part: 'OPA2134', docType: 'Datasheet', edition: null })
    expect(said['murata-grm188r71c105ka12-mlcc-spec.pdf']).toMatchObject({ maker: 'Murata', part: 'GRM188R71C105KA12', docType: 'Specification' })
    expect(said['espressif-esp32-c3-mini-1_DS.pdf']).toMatchObject({ maker: 'Espressif', part: 'ESP32-C3-MINI-1' })
    expect(said['microchip-atmega328p_DS-revB.pdf']).toMatchObject({ maker: 'Microchip Technology', part: 'ATMEGA328P', edition: 'Rev B' })
    expect(said['infineon-bsc016n06ns_DS_V2.6.pdf']).toMatchObject({ part: 'BSC016N06NS', edition: 'v2.6' })
    expect(said['zilog-z80-cpu-productspec-mar78.pdf']).toMatchObject({ maker: 'Zilog', part: 'Z80-CPU', docType: 'Product specification', edition: 'Mar 1978' })
    expect(said['espressif-esp32-c3-errata-master.pdf']).toMatchObject({ part: 'ESP32-C3', docType: 'Errata' })
    expect(said['espressif-esp32-c3-trm.pdf']).toMatchObject({ docType: 'Technical reference manual' })
    // A literature number names a document, not a part.
    expect(said['ti-slva477b-appnote.pdf']).toMatchObject({ maker: 'Texas Instruments', part: null, docType: 'Application note' })
    expect(said['ti-slvu720-userguide.pdf']).toMatchObject({ part: null, docType: 'User guide' })
    expect(said['jst-ph-connector.pdf']).toMatchObject({ maker: 'JST', part: null })
  })
  it('a title leads with the parts it covers', () => {
    expect(titleParts('ADS1113, ADS1114, ADS1115 SBAS444E - MAY 2009 - REVISED DEC 2016')).toEqual(['ADS1113', 'ADS1114', 'ADS1115'])
    expect(titleParts('TPS54331 3-A, 28-V Input, Step Down DC-DC Converter With Eco-mode')).toEqual(['TPS54331'])
    expect(titleParts('Publ i c BSC016N06NS Final datasheet')).toEqual(['BSC016N06NS'])
  })
})

describe('the part and the maker', () => {
  const id = (partNumber: string | null, fileName: string, extra: Partial<Parameters<typeof partIdentity>[0]> = {}) =>
    partIdentity({ partNumber, families: [], title: null, fileName, maker: null, makerBy: null, ...extra })

  it('the records win, unless they are visibly thinner than the file\'s name', () => {
    expect(id('TPS54331', 'ti-tps54331_DS.pdf', { maker: 'Texas Instruments', makerBy: 'part-prefix' })).toMatchObject({ part: 'TPS54331', maker: 'Texas Instruments' })
    expect(id('IRLB8721PbF', 'infineon-irlb8721_DS.pdf')).toMatchObject({ part: 'IRLB8721PbF', maker: 'Infineon', makerBy: 'file name' })
    expect(id('A12', 'murata-grm188r71c105ka12-mlcc-spec.pdf', { families: ['A12'] })).toMatchObject({ part: 'GRM188R71C105KA12', partBy: 'file name' })
    expect(id('microchip-atmega328p_DS-revA', 'microchip-atmega328p_DS-revA.pdf', { families: ['microchipatmega328pdsreva'] })).toMatchObject({ part: 'ATMEGA328P' })
    expect(id('ti-slva477b-appnote', 'ti-slva477b-appnote.pdf', { families: ['tislva477bappnote'] })).toMatchObject({ part: null, maker: 'Texas Instruments' })
  })
  it('a multi-part sheet: the file\'s part large, the family as chips', () => {
    expect(id('OPA134', 'ti-opa2134_DS.pdf', { families: ['OPA2134', 'OPA134', 'OPA4134'] })).toMatchObject({ part: 'OPA2134', family: ['OPA134', 'OPA2134', 'OPA4134'] })
    expect(id('ADS1113', 'ti-ads1115_DS.pdf', { title: 'ADS1113, ADS1114, ADS1115 SBAS444E', maker: 'Analog Devices', makerBy: 'part-prefix' }))
      .toMatchObject({ part: 'ADS1115', family: ['ADS1113', 'ADS1114', 'ADS1115'], maker: 'Texas Instruments', makerBy: 'file name' })
  })
  it('a maker read from the document is kept even against the file name', () => {
    expect(id('BME280', 'acme-bme280.pdf', { maker: 'Bosch Sensortec', makerBy: 'text' })).toMatchObject({ maker: 'Bosch Sensortec', makerBy: 'text' })
  })
})
