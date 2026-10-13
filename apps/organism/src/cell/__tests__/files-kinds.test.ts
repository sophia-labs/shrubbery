// @vitest-environment node
/**
 * The kind registry (apps/organism/src/cell/files-kinds): the datasheet kind's choices, the one batched query, and the seam itself: a
 * second kind (a paper, test-only) is read, queried and shown with no change to the card, the list or the status line.
 */
import { describe, expect, it } from 'vitest'
import { evidenceBadge, needsLook, readDoneSentence } from '@shrubbery/nucleus'
import { chooseKeyValues, formatParam, productKind, valueNeedsLook, type RawParam } from '../files-kinds/datasheet.js'
import { FILE_KINDS, evidenceQuery, readEvidence } from '../files-kinds/index.js'
import { paperKind } from './support/paper-kind.js'

const param = (name: string, p: Partial<RawParam> = {}): RawParam => ({
  name, order: 0, lower: null, upper: null, typical: null, nominal: null, text: '', unit: '', corroboration: 'medium', flagged: false, ...p,
})


describe('key values by product type', () => {
  const params = [
    param('zzz', { typical: 9, unit: 'x' }),
    param('switchingFrequency', { typical: 1.8, unit: 'MHz', corroboration: 'low' }),
    param('inputVoltage', { lower: 1.8, upper: 6.5, unit: 'V', corroboration: 'high' }),
    param('outputCurrent', { upper: 750, unit: 'mA', corroboration: 'contested' }),
  ]
  it('a converter shows VIN, IOUT, fSW in that order, whatever order the sheet lists them', () => {
    expect(chooseKeyValues('DC/DC converter', params)).toEqual([
      { label: 'VIN', text: '1.8–6.5 V', mark: 'high' },
      { label: 'IOUT', text: '≤ 750 mA', mark: 'contested' },
      { label: 'fSW', text: '1.8 MHz', mark: 'low' },
    ])
  })
  it('an op-amp, an MCU, a MOSFET and a sensor each pick their own three', () => {
    expect(chooseKeyValues('op-amp', [param('supplyVoltage', { lower: 2.7, upper: 5.5, unit: 'V' }), param('gainBandwidth', { typical: 10, unit: 'MHz' }),
      param('inputOffsetVoltage', { upper: 0.5, unit: 'mV' })]).map(v => v.label)).toEqual(['GBW', 'VOS', 'Supply'])
    expect(chooseKeyValues('microcontroller', [param('ram', { nominal: 64, unit: 'kB' }), param('core', { text: 'Cortex-M4' }), param('flash', { nominal: 512, unit: 'kB' })])
      .map(v => `${v.label} ${v.text}`)).toEqual(['Core Cortex-M4', 'Flash 512 kB', 'RAM 64 kB'])
    expect(chooseKeyValues('power MOSFET', [param('draincurrent', { nominal: 30, unit: 'A' }), param('drainSourceVoltage', { nominal: 60, unit: 'V' }),
      param('onResistance', { typical: 8, unit: 'mΩ' })]).map(v => v.label)).toEqual(['VDS', 'RDS(on)', 'ID'])
    expect(chooseKeyValues('temperature sensor', [param('range', { lower: -40, upper: 125, unit: '°C' }), param('accuracy', { nominal: 0.5, unit: '°C' }),
      param('supplyVoltage', { lower: 1.7, upper: 3.6, unit: 'V' })]).map(v => v.label)).toEqual(['Range', 'Accuracy', 'Supply'])
  })
  it('a type it does not know, or a sheet missing a value, falls back to the first parameters', () => {
    expect(productKind('widget')).toBe('')
    expect(chooseKeyValues('widget', [param('alpha', { nominal: 1 }), param('betaGain', { nominal: 2 }), param('gamma', { nominal: 3 }), param('delta', { nominal: 4 })]).map(v => v.label))
      .toEqual(['Alpha', 'Beta gain', 'Delta'])
    expect(chooseKeyValues('converter', [param('inputVoltage', { lower: 3, upper: 5, unit: 'V' }), param('other', { nominal: 1 })]).map(v => v.label)).toEqual(['VIN', 'Other'])
  })
  it('a parameter with nothing to say is not a key value', () => {
    expect(chooseKeyValues('converter', [param('inputVoltage'), param('outputCurrent', { upper: 1, unit: 'A' })]).map(v => v.label)).toEqual(['IOUT'])
  })
})

describe('badges and the status sentence come from what the kind read', () => {
  const X = 'http://www.w3.org/2001/XMLSchema#'
  const edition = (extra: Record<string, string> = {}): Record<string, string> => ({ artifact: '"x"', kind: '"datasheet"', datasheet_part: '"OPA2192"', datasheet_productType: '"op-amp"',
    datasheet_rowCount: `"140"^^<${X}integer>`, ...extra })
  const item = (n: number, f: Record<string, string>): Record<string, string> => ({ ...edition(), datasheet_it: `<urn:i:${n}>`, datasheet_pred: `<https://e/p#${f.name}>`, ...Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'name').map(([k, v]) => [`datasheet_${k}`, v])) })

  it('read, to check, scan and text only', () => {
    const only = (rows: Record<string, string>[]) => readEvidence(FILE_KINDS, rows).get('x')!
    expect(evidenceBadge(only([edition()]))).toBe('Read · 140 rows')
    expect(evidenceBadge(only([edition({ datasheet_toCheck: `"2"^^<${X}integer>` })]))).toBe('2 to check')
    expect(evidenceBadge(only([edition({ datasheet_scan: `"true"^^<${X}boolean>` })]))).toBe('Scan: OCR')
    expect(evidenceBadge(only([edition({ datasheet_textOnly: `"true"^^<${X}boolean>` })]))).toBe('Text only')
    expect(evidenceBadge(only([edition({ datasheet_state: '"queued"' })]))).toBe('Queued')
    expect(evidenceBadge(only([edition({ datasheet_state: '"reading"', datasheet_page: `"20"^^<${X}integer>`, datasheet_pages: `"38"^^<${X}integer>` })]))).toBe('Reading 20/38')
    expect(evidenceBadge(only([edition({ datasheet_state: '"failed"' })]))).toBe('Couldn’t read')
  })

  it('a contested value, a low one, or a flag asks for a look; a checked one does not; a read in progress has nothing yet', () => {
    const only = (rows: Record<string, string>[]) => readEvidence(FILE_KINDS, rows).get('x')
    expect(needsLook(only([edition()]))).toBe(false)
    expect(needsLook(only([item(1, { name: 'gainBandwidth', conf: '<https://e/dsp#contested>', typ: `"10"^^<${X}decimal>` })]))).toBe(true)
    expect(needsLook(only([item(1, { name: 'gainBandwidth', conf: '<https://e/dsp#low>', typ: `"10"^^<${X}decimal>` })]))).toBe(true)
    expect(needsLook(only([item(1, { name: 'gainBandwidth', conf: '<https://e/dsp#low>', typ: `"10"^^<${X}decimal>`, checked: `"true"^^<${X}boolean>` })]))).toBe(false)
    expect(needsLook(only([item(1, { name: 'gainBandwidth', diag: '"readers_disagree"', typ: `"10"^^<${X}decimal>` })]))).toBe(true)
    expect(needsLook(only([edition({ datasheet_state: '"reading"' }), item(1, { name: 'gainBandwidth', conf: '<https://e/dsp#low>', datasheet_state: '"reading"' })]))).toBe(false)
  })

  it('says what was read', () => {
    const e = readEvidence(FILE_KINDS, [edition({ datasheet_toCheck: `"2"^^<${X}integer>` }), item(1, { name: 'a', nom: `"1"^^<${X}decimal>` }), item(2, { name: 'b', nom: `"2"^^<${X}decimal>` })]).get('x')!
    expect(readDoneSentence('TPS62840.pdf', e)).toBe('Read TPS62840.pdf: 2 key values, 140 rows, 2 to check')
  })

  it('merges the rows of one parameter (a second diagnostic) into one item, and orders the fallback by de:paramOrder', () => {
    const e = readEvidence(FILE_KINDS, [
      item(1, { name: 'zeta', nom: `"1"^^<${X}decimal>`, order: `"0"^^<${X}integer>` }), item(1, { name: 'zeta', nom: `"1"^^<${X}decimal>`, diag: '"repaired"' }),
      item(2, { name: 'alpha', nom: `"2"^^<${X}decimal>`, order: `"1"^^<${X}integer>` }),
    ]).get('x')!
    expect(e.values.map(v => v.label)).toEqual(['VIN'.length ? 'Zeta' : '', 'Alpha'].filter(Boolean))
    expect(e.lookable).toBe(true)
  })
})

describe('the query', () => {
  it('is one batched query for every kind, each branch inside GRAPH, variables namespaced by kind', () => {
    const q = evidenceQuery([...FILE_KINDS, paperKind], ['a', 'b"c'])
    expect(q).toContain('VALUES ?artifact { "a" "b\\"c" }')
    expect((q.match(/GRAPH \?g \{/g) ?? []).length).toBe(2)
    expect(q.match(/UNION/g)).toHaveLength(1)
    expect(q).toContain('?datasheet_title')
    expect(q).toContain('?paper_title')
    expect(q).not.toMatch(/WHERE \{\s*\?/)
  })
})

describe('the seam: a second kind (a paper) needs no card, list or status code', () => {
  const kinds = [...FILE_KINDS, paperKind]
  const rows = [
    { artifact: '"p"', kind: '"paper"', paper_title: '"Attention Is All You Need"', paper_authors: '"Vaswani et al."', paper_year: '"2017"', paper_venue: '"NeurIPS"' },
    { artifact: '"d"', kind: '"datasheet"', datasheet_part: '"TPS62840"', datasheet_maker: '"TI"' },
  ]
  it('reads each artifact with the kind that recognized it', () => {
    const out = readEvidence(kinds, rows)
    expect(out.get('p')).toMatchObject({ kind: 'paper', title: 'Attention Is All You Need', values: [{ label: 'Venue', text: 'NeurIPS' }],
      subtitle: [{ text: 'Vaswani et al.' }, { text: '· 2017', fixed: true }], doneBadge: 'Read' })
    expect(out.get('p')!.cells.map(c => [c.header, c.text])).toEqual([['Title', 'Attention Is All You Need'], ['Authors', 'Vaswani et al.'], ['Year', '2017']])
    expect(out.get('d')).toMatchObject({ kind: 'datasheet', title: 'TPS62840' })
  })
  it('a resource no kind recognized is absent, so it keeps the generic card', () => {
    expect(readEvidence(kinds, [{ artifact: '"z"' }, { artifact: '"z"', kind: '"other"' }]).size).toBe(0)
  })
})

