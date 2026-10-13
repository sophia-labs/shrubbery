/**
 * The datasheet kind (plans/2026-10-08-datasheets-in-sophia.md §2, §3): what the importer's light records look like, and what a
 * datasheet's card, list columns and status say. Files knows none of this; it reads `files-kinds/registry.ts`.
 *
 * Reads of the importer:
 *   edition  de:DocumentEdition with de:artifact · de:title · de:partNumber · de:maker · de:revision · de:productType · de:rowCount ·
 *            de:toCheckCount · de:scan · de:textOnly · de:readState (queued | reading | read | failed) · de:readPage · de:readPages ·
 *            de:readError; a de:docType other than "datasheet" belongs to another kind
 *   param    a de:Assertion of kind derivation in the same named graph: de:predicate · de:paramOrder · eng:lowerLimit · eng:upperLimit ·
 *            eng:typical · eng:nominal · eng:unit / eng:unitLexical · de:valueText · de:confidence (dsp:high | medium | low | contested)
 *            · de:diagnostic (Tom's flags, verbatim)
 *   checks   a de:Assessment in the person's partition: de:assesses the param, facet sourceFidelity, result accept
 */
import type { Corroboration, FileEvidenceValue, FileInfoSection } from '@shrubbery/nucleus'
import { localName } from '@shrubbery/nucleus'
import type { FileKind, KindItem, KindRecord } from './registry.js'
import { datasheetMargin } from './datasheet-reader.js'

/** One parameter as the records state it. */
export interface RawParam {
  /** Local name of the predicate: 'inputVoltage'. */
  readonly name: string
  readonly order: number
  readonly lower: number | null
  readonly upper: number | null
  readonly typical: number | null
  readonly nominal: number | null
  readonly text: string
  readonly unit: string
  readonly corroboration: Corroboration
  /** The reader flagged it (repaired, readers disagree). */
  readonly flagged: boolean
}

interface KeySlot { readonly label: string; readonly names: readonly string[] }
const slot = (label: string, ...names: string[]): KeySlot => ({ label, names })

/** The three values that say what a part is, by product type. A type that is not here uses the first three parameters. */
export const KEY_SLOTS: Readonly<Record<string, readonly KeySlot[]>> = Object.freeze({
  converter: [slot('VIN', 'inputvoltage', 'vin'), slot('IOUT', 'outputcurrent', 'iout'), slot('fSW', 'switchingfrequency', 'fsw')],
  'op-amp': [slot('GBW', 'gainbandwidth', 'gbw', 'gainbandwidthproduct'), slot('VOS', 'inputoffsetvoltage', 'vos'), slot('Supply', 'supplyvoltage', 'supply')],
  mcu: [slot('Core', 'core'), slot('Flash', 'flash', 'flashsize'), slot('RAM', 'ram', 'ramsize')],
  mosfet: [slot('VDS', 'drainsourcevoltage', 'vds'), slot('RDS(on)', 'onresistance', 'rdson'), slot('ID', 'draincurrent', 'id')],
  sensor: [slot('Range', 'range', 'measurementrange'), slot('Accuracy', 'accuracy'), slot('Supply', 'supplyvoltage', 'supply')],
})

const TYPE_ALIASES: readonly (readonly [RegExp, string])[] = [
  [/converter|regulator|buck|boost|ldo|dc-?dc|power ?supply/i, 'converter'],
  [/op-?amp|amplifier|comparator/i, 'op-amp'],
  [/mcu|microcontroller|soc|processor/i, 'mcu'],
  [/mosfet|fet|transistor/i, 'mosfet'],
  [/sensor|imu|accelerometer|gyro|adc|thermistor/i, 'sensor'],
]

/** 'DC/DC converter' → 'converter'; anything else is '' (the fallback). */
export function productKind(productType: string): string {
  for (const [pattern, kind] of TYPE_ALIASES) if (pattern.test(productType)) return kind
  return ''
}

function num(n: number): string {
  return String(Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 1000) / 1000)
}

/** '1.8–6.5 V', '≤ 6.5 V', '≥ 1.8 V', '60 nA', or the printed text. */
export function formatParam(p: RawParam): string {
  const unit = p.unit ? ` ${p.unit}` : ''
  if (p.lower !== null && p.upper !== null) return p.lower === p.upper ? `${num(p.lower)}${unit}` : `${num(p.lower)}–${num(p.upper)}${unit}`
  if (p.nominal !== null) return `${num(p.nominal)}${unit}`
  if (p.typical !== null) return `${num(p.typical)}${unit}`
  if (p.upper !== null) return `≤ ${num(p.upper)}${unit}`
  if (p.lower !== null) return `≥ ${num(p.lower)}${unit}`
  return p.text
}

/** 'inputVoltage' → 'Input voltage'; a short symbol-like name stays as written ('VIN'). */
export function humanLabel(name: string): string {
  if (/^[A-Z0-9()]{2,6}$/.test(name)) return name
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * The three key values for a product type: the type's own slots that the sheet has, then the first parameters (by `de:paramOrder`,
 * then by name) as the fallback for a type we do not know or a value the sheet lacks.
 */
export function chooseKeyValues(productType: string, params: readonly RawParam[]): FileEvidenceValue[] {
  const usable = params.filter(p => formatParam(p) !== '')
  const out: FileEvidenceValue[] = []
  const used = new Set<RawParam>()
  for (const s of KEY_SLOTS[productKind(productType)] ?? []) {
    const found = usable.find(p => !used.has(p) && s.names.includes(p.name.toLowerCase()))
    if (found) { used.add(found); out.push({ label: s.label, text: formatParam(found), mark: found.corroboration }) }
  }
  const rest = usable.filter(p => !used.has(p)).sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const p of rest) {
    if (out.length >= 3) break
    out.push({ label: humanLabel(p.name), text: formatParam(p), mark: p.corroboration })
  }
  return out.slice(0, 3)
}

/** Whether a value asks for a look: contested or low, or flagged by the reader. A checked value never does. */
export function valueNeedsLook(p: Pick<RawParam, 'corroboration' | 'flagged'>): boolean {
  return p.corroboration !== 'checked' && (p.corroboration === 'contested' || p.corroboration === 'low' || p.flagged)
}

const number = (v: string | null): number | null => {
  if (v === null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const count = (v: string | null): number => { const n = number(v); return n !== null && n >= 0 ? Math.floor(n) : 0 }
const flagsLook = (diag: readonly string[]) => diag.some(d => /disagree|contested|repair|lost|mismatch|conflict/i.test(d))

function paramOf(item: KindItem): RawParam {
  const conf = item.local('conf').toLowerCase()
  const checked = item.all('checked').some(v => v === 'true' || v === '1')
  const unit = item.one('unitLex') ?? (item.one('unit') ? localName(item.one('unit')!) : '')
  const stricter = item.all('conf').map(c => localName(c).toLowerCase()).includes('contested') ? 'contested' : conf
  return {
    name: item.local('pred'), order: number(item.one('order')) ?? Number.MAX_SAFE_INTEGER,
    lower: number(item.one('lo')), upper: number(item.one('hi')), typical: number(item.one('typ')), nominal: number(item.one('nom')),
    text: item.one('text') ?? '', unit,
    corroboration: checked ? 'checked' : stricter === 'high' ? 'high' : stricter === 'low' ? 'low' : stricter === 'contested' || stricter === 'disputed' ? 'contested' : 'medium',
    flagged: flagsLook(item.all('diag')),
  }
}

const paramsOf = (r: KindRecord) => r.items.map(paramOf)
/** Values to check: the importer's count when it states one, otherwise what the key values themselves ask for. */
const toCheck = (r: KindRecord) => count(r.f.toCheck ?? null) || paramsOf(r).filter(valueNeedsLook).length
const rows = (r: KindRecord) => count(r.f.rowCount ?? null)
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** 'Read with datasheet-parser ee680a6 · Docling 2.135.0', from the import attempt's tool profile (edition → import record → attempt → tool); null when the records do not say. */
export function readerLine(r: KindRecord): string | null {
  const tool = r.f.readerTool?.trim()
  if (!tool) return null
  const commit = r.f.readerCommit?.trim().slice(0, 7)
  const docling = r.f.doclingVersion?.trim()
  return [`Read with ${tool}${commit ? ` ${commit}` : ''}`, ...(docling ? [`Docling ${docling}`] : [])].join(' · ')
}

/** The datasheet's block of the Show info panel. */
export function datasheetInfo(r: KindRecord): readonly FileInfoSection[] {
  const fact = (label: string, text: string | null | undefined) => text ? [{ label, text }] : []
  const reader = readerLine(r)
  const params = paramsOf(r).filter(p => formatParam(p) !== '').sort((a, b) => a.order - b.order)
  const registers = count(r.f.registerCount ?? null)
  return [{ title: 'Datasheet', rows: [
    ...fact('Part', r.f.part), ...fact('Maker', r.f.maker), ...fact('Revision', r.f.rev), ...fact('Product type', r.f.productType),
    ...(reader ? [{ label: 'Reader', text: reader }] : []),
    { label: 'Rows', text: String(rows(r)) }, ...(registers ? [{ label: 'Registers', text: String(registers) }] : []),
    { label: 'To check', text: String(toCheck(r)) },
    ...params.slice(0, 12).map(p => ({ label: humanLabel(p.name), text: formatParam(p), mark: p.corroboration })),
    { label: '', text: 'Open in reader', action: 'open' },
  ] }]
}

export const datasheetKind: FileKind = {
  id: 'datasheet',
  captions: ['PDF'],
  recognize: '{ed} a de:DocumentEdition . FILTER NOT EXISTS { {ed} de:docType {dt} . FILTER({dt} != "datasheet") }',
  fields: {
    title: 'de:title', part: 'de:partNumber', maker: 'de:maker', rev: 'de:revision', productType: 'de:productType', rowCount: 'de:rowCount', registerCount: 'de:registerCount',
    toCheck: 'de:toCheckCount', readerTool: 'de:importRecord/de:attempt/de:tool/de:toolName', readerCommit: 'de:importRecord/de:attempt/de:tool/de:toolCommit',
    doclingVersion: 'de:importRecord/de:attempt/de:tool/de:doclingVersion', scan: 'de:scan', textOnly: 'de:textOnly', state: 'de:readState', page: 'de:readPage', pages: 'de:readPages', error: 'de:readError',
  },
  items: {
    pattern: '{it} a de:Assertion ; de:assertionKind de:derivation ; de:predicate {pred}',
    key: 'pred',
    vars: ['pred', 'checked'],
    fields: {
      order: 'de:paramOrder', lo: 'eng:lowerLimit', hi: 'eng:upperLimit', typ: 'eng:typical', nom: 'eng:nominal', unit: 'eng:unit', unitLex: 'eng:unitLexical',
      text: 'de:valueText', conf: 'de:confidence', diag: 'de:diagnostic',
    },
    after: 'OPTIONAL { GRAPH ?g2 { ?asm a de:Assessment ; de:assesses {it} ; de:facet "sourceFidelity" ; de:result de:accept . BIND(true AS {checked}) } FILTER(BOUND({it})) }',
  },
  card: {
    title: r => r.f.part ?? r.f.title ?? '',
    subtitle: r => [{ text: r.f.maker ?? '' }, ...(r.f.rev ? [{ text: `· Rev ${r.f.rev}`, fixed: true }] : [])],
    values: r => chooseKeyValues(r.f.productType ?? '', paramsOf(r)),
    doneBadge: r => r.f.textOnly === 'true' ? 'Text only' : toCheck(r) > 0 ? `${toCheck(r)} to check` : r.f.scan === 'true' ? 'Scan: OCR' : `Read · ${rows(r)} rows`,
    badgeTone: r => r.f.textOnly === 'true' || toCheck(r) > 0 ? 'attention' : undefined,
  },
  columns: [
    { header: 'Part', width: '7rem', cell: r => ({ text: r.f.part ?? r.f.title ?? '', strong: true }) },
    { header: 'Maker', width: '9rem', cell: r => ({ text: r.f.maker ?? '' }) },
    { header: 'Key value', width: 'minmax(8rem, 12rem)', cell: r => {
      const v = chooseKeyValues(r.f.productType ?? '', paramsOf(r))[0]
      return v ? { label: v.label, text: v.text, mark: v.mark } : { text: '' }
    } },
  ],
  margin: datasheetMargin,
  info: r => datasheetInfo(r),
  lookable: r => paramsOf(r).some(valueNeedsLook) || toCheck(r) > 0,
  summary: r => {
    const parts = [plural(r.items.length, 'key value'), plural(rows(r), 'row')]
    if (toCheck(r) > 0) parts.push(`${toCheck(r)} to check`)
    return parts.join(', ')
  },
  status: { state: 'state', page: 'page', pages: 'pages', error: 'error' },
}
