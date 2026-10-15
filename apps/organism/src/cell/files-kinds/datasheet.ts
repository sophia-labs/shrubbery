/**
 * The datasheet kind (plans/2026-10-08-datasheets-in-sophia.md §2, §3): what the importer's light records look like, and what a
 * datasheet's card, list columns and status say. Files knows none of this; it reads `files-kinds/registry.ts`.
 *
 * Reads of the importer:
 *   edition  de:DocumentEdition with de:artifact · de:title · de:partNumber · de:maker · de:makerBy · de:revision · de:productType ·
 *            de:documentType · de:fileName · de:rowCount · de:scan · de:textOnly · de:readState (queued | reading | read | failed) ·
 *            de:readPage · de:readPages · de:readError; a de:docType other than "datasheet" belongs to another kind. The importer's
 *            de:toCheckCount is not read: what a person sees marked is what the readers disagreed on, nothing else.
 *   param    a de:Assertion of kind derivation in the same named graph: de:predicate · de:paramOrder · eng:lowerLimit · eng:upperLimit ·
 *            eng:typical · eng:nominal · eng:unit / eng:unitLexical · de:valueText · de:confidence (dsp:high | medium | low | contested)
 *            · de:diagnostic (Tom's flags, verbatim)
 *   checks   a de:Assessment in the person's partition: de:assesses the param, facet sourceFidelity, result accept
 */
import type { Corroboration, FileEvidenceValue, FileInfoSection } from '@shrubbery/nucleus'
import { localName } from '@shrubbery/nucleus'
import type { CompanionRule, FileKind, KindItem, KindRecord } from './registry.js'
import { datasheetMargin } from './datasheet-reader.js'
import { DATASHEET_SECTIONS, datasheetPageContent, editionsQuery, registersQuery } from './datasheet-page.js'
import { fileNameWitness, parameterLabel, partIdentity, valueWords } from './datasheet-words.js'

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

/** '1.8–6.5 V', '≤ 6.5 V', '≥ 1.8 V', '60 nA', '0.00008 %', or the printed text. Numbers keep their own digits (never rounded to zero). */
export function formatParam(p: RawParam): string {
  if (p.lower !== null && p.upper !== null) return valueWords({ lower: p.lower, upper: p.upper, typical: null }, p.unit)
  if (p.nominal !== null) return valueWords({ lower: null, upper: null, typical: null, nominal: p.nominal }, p.unit)
  if (p.typical !== null) return valueWords({ lower: null, upper: null, typical: null, nominal: p.typical }, p.unit)
  return valueWords({ lower: p.lower, upper: p.upper, typical: null }, p.unit) || p.text
}

/** 'inputVoltage' → 'Input voltage'; a short symbol-like name stays as written ('VIN'). */
export function humanLabel(name: string): string {
  if (/^[A-Z0-9()]{2,6}$/.test(name)) return name
  const label = parameterLabel(name)
  return label.charAt(0).toUpperCase() + label.slice(1)
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

/** Whether a value is disputed: the readers disagreed about it (said by the records or by the reader's own flag). A checked value is not. */
export function valueDisputed(p: Pick<RawParam, 'corroboration' | 'flagged'>): boolean {
  return p.corroboration !== 'checked' && (p.corroboration === 'contested' || p.flagged)
}

const number = (v: string | null): number | null => {
  if (v === null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const count = (v: string | null): number => { const n = number(v); return n !== null && n >= 0 ? Math.floor(n) : 0 }
const flagsLook = (diag: readonly string[]) => diag.some(d => /disagree|contested|conflict/i.test(d))

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
/** Values the readers disagreed on. The importer's own "to check" count is not a count a person needs: it is the reader's audit trail. */
const disputed = (r: KindRecord) => paramsOf(r).filter(valueDisputed).length
const rows = (r: KindRecord) => count(r.f.rowCount ?? null)
/** Every value read: the key values and the table rows. */
const values = (r: KindRecord) => rows(r) + r.items.length
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** The part and maker as the card says them: the records, reconciled with the file name and the title (`partIdentity`). */
function identityOf(r: KindRecord) {
  return partIdentity({ partNumber: r.f.part ?? null, families: r.lists?.family ?? [], title: r.f.title ?? null, fileName: r.f.fileName ?? r.f.alias ?? '', maker: r.f.maker ?? null,
    makerBy: r.f.makerBy ?? null })
}

/** The words of a document that is not a datasheet ('Errata', 'Reference manual'); null for a datasheet. */
function otherDocument(r: KindRecord): string | null {
  const type = (r.f.documentType ?? '').toLowerCase()
  if (type && type !== 'datasheet') return type.replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase())
  const product = (r.f.productType ?? '').toLowerCase()
  const doc: Record<string, string> = { errata: 'Errata', 'reference-manual': 'Reference manual', 'app-note': 'Application note', 'user-guide': 'User guide' }
  return doc[product] ?? null
}

/** 'Read · 214 values', with '· 2 disputed' only when the readers disagreed somewhere. */
function doneBadge(r: KindRecord): string {
  if (r.f.textOnly === 'true') return otherDocument(r) ?? 'Text only'
  if (r.f.scan === 'true') return 'Scan: OCR'
  const d = disputed(r)
  // The card's annunciator is narrow: a dispute says itself first, in place of "Read" (what does not fit is the count).
  return d ? `${d} disputed · ${plural(values(r), 'value')}` : `Read · ${plural(values(r), 'value')}`
}

/** What a datasheet's reader writes beside its PDF (Tom's sidecars, the read job's outputs): hidden from the place, reached from the page. */
export const DATASHEET_COMPANIONS: readonly CompanionRule[] = Object.freeze([
  { role: 'text', label: 'Text the reader read', entry: 'artifact', idSuffix: '-text', nameSuffix: '.text.txt' },
  { role: 'data', label: 'What the reader wrote (data)', entry: 'artifact', idSuffix: '-data', nameSuffix: '.data.json' },
  { role: 'regions', label: 'Where the reader found each row', entry: 'artifact', idSuffix: '-regions', nameSuffix: '.regions.json' },
  { role: 'audit', label: 'The reader’s table audit', entry: 'artifact', idSuffix: '-audit', nameSuffix: '.audit.tsv' },
])

/** 'Read with datasheet-parser (NomDeTom) ee680a6 · Docling 2.135.0', from the import attempt's tool profile (edition → import record → attempt → tool); null when the records do not say. */
export function readerLine(r: KindRecord): string | null {
  const tool = r.f.readerTool?.trim()
  if (!tool) return null
  const credit = r.f.readerCredit?.trim()
  const named = credit && !tool.includes(credit) ? `${tool} (${credit})` : tool
  const commit = r.f.readerCommit?.trim().slice(0, 7)
  const docling = r.f.doclingVersion?.trim()
  return [`Read with ${named}${commit ? ` ${commit}` : ''}`, ...(docling ? [`Docling ${docling}`] : [])].join(' · ')
}

/** The datasheet's block of the Show info panel. */
export function datasheetInfo(r: KindRecord): readonly FileInfoSection[] {
  const fact = (label: string, text: string | null | undefined) => text ? [{ label, text }] : []
  const reader = readerLine(r)
  const params = paramsOf(r).filter(p => formatParam(p) !== '').sort((a, b) => a.order - b.order)
  const registers = count(r.f.registerCount ?? null)
  const id = identityOf(r)
  const d = disputed(r)
  return [{ title: 'Datasheet', rows: [
    ...fact('Part', id.part), ...fact('Maker', id.maker), ...fact('Revision', r.f.rev),
    ...(reader ? [{ label: 'Reader', text: reader }] : []),
    { label: 'Values', text: String(values(r)) }, ...(registers ? [{ label: 'Registers', text: String(registers) }] : []),
    ...(d ? [{ label: 'Disputed', text: String(d) }] : []),
    ...params.slice(0, 12).map(p => ({ label: humanLabel(p.name), text: formatParam(p), ...(valueDisputed(p) || p.corroboration === 'checked' ? { mark: p.corroboration } : {}) })),
    { label: '', text: 'Open', action: 'open' },
  ] }]
}

export const datasheetKind: FileKind = {
  id: 'datasheet',
  captions: ['PDF'],
  recognize: '{ed} a de:DocumentEdition . FILTER NOT EXISTS { {ed} de:docType {dt} . FILTER({dt} != "datasheet") }',
  fields: {
    title: 'de:title', part: 'de:partNumber', maker: 'de:maker', makerBy: 'de:makerBy', rev: 'de:revision', productType: 'de:productType', documentType: 'de:documentType',
    fileName: 'de:fileName', alias: 'de:alias', rowCount: 'de:rowCount', registerCount: 'de:registerCount',
    readerTool: 'de:importRecord/de:attempt/de:tool/de:toolName', readerCommit: 'de:importRecord/de:attempt/de:tool/de:toolCommit',
    readerCredit: 'de:importRecord/de:attempt/de:tool/de:credit',
    doclingVersion: 'de:importRecord/de:attempt/de:tool/de:doclingVersion', scan: 'de:scan', textOnly: 'de:textOnly', state: 'de:readState', page: 'de:readPage', pages: 'de:readPages', error: 'de:readError',
  },
  lists: { family: '{ed} de:namesFamily {f} . {f} eng:identifier {value}' },
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
    title: r => identityOf(r).part ?? r.f.title ?? '',
    subtitle: r => {
      const edition = r.f.rev ? `Rev ${r.f.rev}` : fileNameWitness(r.f.fileName ?? r.f.alias ?? '').edition
      return [{ text: identityOf(r).maker ?? '' }, ...(edition ? [{ text: `· ${edition}`, fixed: true }] : [])]
    },
    values: r => chooseKeyValues(r.f.productType ?? '', paramsOf(r)),
    doneBadge,
    badgeTone: r => disputed(r) > 0 ? 'attention' : undefined,
  },
  columns: [
    { header: 'Part', width: '7rem', cell: r => ({ text: identityOf(r).part ?? r.f.title ?? '', strong: true }) },
    { header: 'Maker', width: '9rem', cell: r => ({ text: identityOf(r).maker ?? '' }) },
    { header: 'Key value', width: 'minmax(8rem, 12rem)', cell: r => {
      const v = chooseKeyValues(r.f.productType ?? '', paramsOf(r))[0]
      return v ? { label: v.label, text: v.text, mark: v.mark } : { text: '' }
    } },
  ],
  margin: datasheetMargin,
  info: r => datasheetInfo(r),
  page: {
    sections: DATASHEET_SECTIONS,
    queries: [{ id: 'editions', scope: 'graph', query: () => editionsQuery() }, { id: 'registers', scope: 'file', query: registersQuery }],
    content: datasheetPageContent,
    companions: DATASHEET_COMPANIONS,
  },
  lookable: r => disputed(r) > 0,
  summary: r => {
    const parts = [plural(values(r), 'value')]
    if (disputed(r) > 0) parts.push(`${disputed(r)} disputed`)
    return parts.join(', ')
  },
  status: { state: 'state', page: 'page', pages: 'pages', error: 'error' },
}
