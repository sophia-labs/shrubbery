/**
 * A datasheet's info page (Vera, 2026-10-13: "the raw PDF should be a collapsed section on a sophia-standard info display with the stuff we
 * extracted, your notes on it, etc."). What the datasheet kind contributes to the generic page: the part as the headline, the few values
 * that matter for its type, what we extracted as one compact table, the other documents naming the same part, and an account of the
 * reading. The PDF itself is the standard source section, folded.
 *
 * Everything here reads the kind's reading (`datasheet_facts` through `readDatasheetFacts`) and two graph queries; nothing writes.
 */
import type { FilesPageBody, FilesPageFact, FilesPageLink, FilesPageRegister, FilesPageRow, FilesPageSubheading, FilesPageTableGroup, FilesPageValue } from '@shrubbery/runtime'
import type { InfoSectionOverride, KindPageContent, KindPageInput, MarginRowData } from './registry.js'
import { PREFIXES, termText } from './registry.js'
import { documentTypeWords, fileNameWitness, normPart, partIdentity } from './datasheet-words.js'
import { makerHint } from './datasheet-reader.js'

type Row = Readonly<Record<string, unknown>>

/** The datasheet's sections: the standard ones re-placed (the PDF folded, below what was read from it), and its own. */
export const DATASHEET_SECTIONS: readonly InfoSectionOverride[] = Object.freeze([
  { id: 'key-values', title: 'Key values', order: 20, collapsed: false, face: 'values' },
  { id: 'notes', order: 30 },
  { id: 'extracted', title: 'What we extracted', order: 40, collapsed: false, face: 'table' },
  { id: 'related', title: 'Related', order: 45, collapsed: false, face: 'links' },
  { id: 'source', title: 'Source PDF', order: 60, collapsed: true },
  { id: 'reading', title: 'About this reading', order: 70, collapsed: true, face: 'facts' },
])

// --- queries --------------------------------------------------------------------------------------------------------------------------

/**
 * Every edition of the graph, with what names it (asked once per graph: the header's identity and Related both read it). A family's
 * identifier is written into each import's own graph beside the edition, so it is asked there: an OPTIONAL over another graph with the
 * family unbound would match every family of the graph.
 */
export function editionsQuery(): string {
  return `PREFIX de: <${PREFIXES.de}>
PREFIX eng: <${PREFIXES.eng}>
SELECT ?artifact ?part ?title ?fileName ?alias ?docType ?productType ?kvk ?inferred ?maker ?makerBy ?revision ?literature ?pages ?family
WHERE {
  GRAPH ?g {
    ?ed a de:DocumentEdition ; de:artifact ?artifact .
    OPTIONAL { ?ed de:partNumber ?part } OPTIONAL { ?ed de:title ?title } OPTIONAL { ?ed de:fileName ?fileName } OPTIONAL { ?ed de:alias ?alias }
    OPTIONAL { ?ed de:documentType ?docType } OPTIONAL { ?ed de:productType ?productType } OPTIONAL { ?ed de:keyValueKind ?kvk }
    OPTIONAL { ?ed de:inferredProductType ?inferred } OPTIONAL { ?ed de:maker ?maker } OPTIONAL { ?ed de:makerBy ?makerBy }
    OPTIONAL { ?ed de:revision ?revision } OPTIONAL { ?ed de:literature ?literature } OPTIONAL { ?ed de:pageCount ?pages }
    OPTIONAL { ?ed de:namesFamily ?f . ?f eng:identifier ?family }
  }
}
LIMIT 5000`
}

/** The registers of one file's reading (the facts tool does not carry them). */
export function registersQuery(artifactId: string): string {
  return `PREFIX de: <${PREFIXES.de}>
PREFIX eng: <${PREFIXES.eng}>
SELECT ?r ?name ?address ?reset ?description ?page (COUNT(?field) AS ?fields)
WHERE {
  GRAPH ?g {
    ?ed a de:DocumentEdition ; de:artifact ${JSON.stringify(artifactId)} ; de:sourceContent ?content .
    ?r a eng:RegisterDefinition ; de:sourceContent ?content .
    OPTIONAL { ?r eng:name ?name } OPTIONAL { ?r eng:addressLexical ?address } OPTIONAL { ?r eng:resetLexical ?reset }
    OPTIONAL { ?r eng:description ?description } OPTIONAL { ?r de:pageIndex ?page } OPTIONAL { ?field eng:register ?r }
  }
}
GROUP BY ?r ?name ?address ?reset ?description ?page
ORDER BY ?page ?name
LIMIT 200`
}

/** One edition as the graph names it. */
export interface EditionRecord {
  readonly artifact: string
  readonly part: string | null
  readonly title: string | null
  readonly fileName: string | null
  readonly docType: string | null
  readonly productType: string | null
  readonly kind: string | null
  readonly maker: string | null
  readonly makerBy: string | null
  readonly revision: string | null
  readonly literature: string | null
  readonly pages: number | null
  readonly families: readonly string[]
}

/** The rows of `editionsQuery`, one record per artifact (its families gathered). */
export function readEditions(rows: readonly Row[]): Map<string, EditionRecord> {
  const out = new Map<string, EditionRecord & { families: string[] }>()
  for (const row of rows) {
    const artifact = termText(row.artifact)
    if (!artifact) continue
    const t = (k: string) => termText(row[k])
    let ed = out.get(artifact)
    if (!ed) {
      const pages = Number(t('pages'))
      ed = { artifact, part: t('part'), title: t('title'), fileName: t('fileName') ?? t('alias'), docType: t('docType'), productType: t('productType'),
        kind: t('kvk') ?? t('inferred'), maker: t('maker'), makerBy: t('makerBy'), revision: t('revision'), literature: t('literature'),
        pages: Number.isFinite(pages) && pages > 0 ? pages : null, families: [] }
      out.set(artifact, ed)
    }
    const family = t('family')
    if (family && !ed.families.some(f => normPart(f) === normPart(family))) ed.families.push(family)
  }
  return out
}

// --- key values -------------------------------------------------------------------------------------------------------------------------

interface KeySlot { readonly label: string; readonly symbol: RegExp; readonly name: RegExp; readonly absolute?: boolean }
const key = (label: string, symbol: RegExp, name: RegExp, absolute = false): KeySlot => ({ label, symbol, name, absolute })

const SUPPLY = key('Supply voltage', /^v(s|cc|dd|\+)$/i, /supply voltage|single supply|power supply \(vdd/i)
/** The values that say what a part is, by its type; each found in what was read by its symbol, else by its name. */
export const KEY_SLOTS: Readonly<Record<string, readonly KeySlot[]>> = Object.freeze({
  'op-amp': [key('Gain bandwidth', /^gbw?p?$/i, /gain[- ]?bandwidth/i), key('Slew rate', /^sr$/i, /slew rate/i), key('Voltage noise', /^e\s?n$/i, /input voltage noise density/i),
    key('Offset voltage', /^v\s?(os|io)$/i, /^input offset voltage$/i), key('Bias current', /^i\s?(b|ib)$/i, /^input bias current$/i), key('Quiescent current', /^i\s?q$/i, /quiescent current/i), SUPPLY],
  converter: [key('Input voltage', /^v\s?in$/i, /input voltage/i), key('Output voltage', /^v\s?out$/i, /output voltage/i), key('Output current', /^i\s?out$/i, /output current/i),
    key('Switching frequency', /^f\s?sw$/i, /switching frequency/i), key('Quiescent current', /^i\s?q$/i, /quiescent current/i), key('Efficiency', /^η$/i, /efficiency/i)],
  ldo: [key('Input voltage', /^v\s?in$/i, /input voltage/i), key('Output voltage', /^v\s?out$/i, /output voltage/i), key('Output current', /^i\s?out$/i, /output current/i),
    key('Dropout voltage', /^v\s?do$/i, /dropout/i), key('Quiescent current', /^i\s?(q|gnd)$/i, /quiescent current|ground current/i), key('PSRR', /^psrr$/i, /power[- ]supply rejection/i)],
  mosfet: [key('Drain–source voltage', /^v\s?ds$/i, /drain[- –]source voltage/i, true), key('Drain current', /^i\s?d$/i, /continuous drain current|drain current/i, true),
    key('On-resistance', /^r\s?ds\(?on\)?$/i, /on[- ]?(state )?resistance/i), key('Gate threshold', /^v\s?gs\(?th\)?$/i, /gate threshold/i), key('Gate charge', /^q\s?g$/i, /total gate charge/i)],
  sensor: [SUPPLY, key('Supply current', /^i\s?dd$/i, /supply current|current consumption/i), key('Accuracy', /^$/, /accuracy/i), key('Range', /^$/, /(measurement|operating) range/i),
    key('Resolution', /^$/, /resolution/i)],
  adc: [SUPPLY, key('Resolution', /^$/, /resolution/i), key('Data rate', /^dr$/i, /data rate|sampl(e|ing) rate/i), key('INL', /^inl$/i, /integral nonlinearity/i),
    key('Supply current', /^i\s?dd$/i, /supply current/i)],
  mcu: [SUPPLY, key('Flash', /^$/, /flash/i), key('SRAM', /^$/, /\bs?ram\b/i), key('Clock', /^f\s?(clk|max|cpu)$/i, /clock|cpu frequency|operating frequency/i),
    key('Supply current', /^i\s?(dd|cc)$/i, /supply current|active current/i)],
})

const TYPES: readonly (readonly [RegExp, string])[] = [
  [/\bldo\b|low[- ]dropout/i, 'ldo'], [/converter|regulator|buck|boost|dc[-/ ]?dc|power supply/i, 'converter'], [/op[- ]?amp|operational amplifier|amplifier|comparator/i, 'op-amp'],
  [/\badc\b|analog[- ]to[- ]digital/i, 'adc'], [/mcu|microcontroller|\bsoc\b|processor|wi-?fi|bluetooth/i, 'mcu'], [/mosfet|\bfet\b|transistor/i, 'mosfet'],
  [/sensor|imu|accelerometer|gyro|thermistor|humidity|pressure/i, 'sensor'],
]

/** 'op-amp', 'DC/DC converter', a title ('TPS54331 … Step Down DC-DC Converter') → a key of `KEY_SLOTS`; '' when none fits. */
export function partType(...hints: readonly (string | null | undefined)[]): string {
  for (const hint of hints) {
    if (!hint) continue
    for (const [re, type] of TYPES) if (re.test(hint)) return type
  }
  return ''
}

const short = (text: string, n = 56) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text)

/** The few values that matter: the importer's own key values, then the type's slots it did not cover, found in the table rows. */
export function keyValues(rows: readonly MarginRowData[], type: string, limit = 6): FilesPageValue[] {
  const out: FilesPageValue[] = []
  const covered = (slot: KeySlot) => out.some(v => slot.name.test(v.label) || (!!v.symbol && slot.symbol.test(v.symbol)))
  const read = (r: MarginRowData) => r.value !== ''
  const asValue = (r: MarginRowData, label = r.label): FilesPageValue => ({ id: r.id, label, ...(r.symbol ? { symbol: r.symbol } : {}), ...headline(r),
    ...(r.when ? { when: short(r.when) } : r.conditions.length ? { when: short(r.conditions[0]!) } : {}), page: r.page, disputed: r.dispute ?? null })
  for (const r of rows) if (r.key && read(r) && out.length < limit) out.push(asValue(r))
  for (const slot of KEY_SLOTS[type] ?? []) {
    if (out.length >= limit) break
    if (covered(slot)) continue
    const candidates = rows.filter(r => !r.key && read(r) && (slot.symbol.test(r.symbol) || slot.name.test(r.label)))
    // An operating value over a rating, unless the type's value is a rating (a MOSFET's VDS).
    const ranked = candidates.sort((a, b) => Number(isRating(a) !== !!slot.absolute) - Number(isRating(b) !== !!slot.absolute))
    if (ranked[0]) out.push(asValue(ranked[0], slot.label))
  }
  return out
}

const isRating = (r: MarginRowData) => r.group.startsWith('absoluteMaximum')

/** A key value's number as a headline: the range or the limit large, the typical small beside it ('5–36 V' typ 30; '8 MHz' typ). */
export function headline(r: Pick<MarginRowData, 'slots' | 'unit' | 'value'>): { text: string; qualifier?: string } {
  const s = r.slots
  if (!s) return { text: r.value }
  const unit = r.unit ? ` ${r.unit}` : ''
  const range = s.min && s.max ? (s.min === s.max ? s.min : s.min.startsWith('−') || s.max.startsWith('−') ? `${s.min} to ${s.max}` : `${s.min}–${s.max}`)
    : s.max ? `≤ ${s.max}` : s.min ? `≥ ${s.min}` : ''
  if (range) return { text: `${range}${unit}`, ...(s.typ ? { qualifier: `typ ${s.typ}` } : {}) }
  if (s.typ) return { text: `${s.typ}${unit}`, qualifier: 'typ' }
  return { text: r.value }
}

// --- the table --------------------------------------------------------------------------------------------------------------------------

function matches(r: MarginRowData, group: string, words: readonly string[]): boolean {
  if (!words.length) return true
  const hay = `${r.label} ${r.symbol} ${r.when} ${r.unit ?? ''} ${r.subgroup ?? ''} ${group} ${r.value}`.toLowerCase()
  return words.every(w => hay.includes(w))
}

/** What we extracted, grouped by the document's own tables, its own headings inside each, filtered by every word typed. */
export function extractedTable(rows: readonly MarginRowData[], groups: readonly { id: string; title: string; tag?: string }[], filter: string):
  { groups: FilesPageTableGroup[]; total: number; shown: number } {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  const table = rows.filter(r => !r.key)
  const out: FilesPageTableGroup[] = []
  let shown = 0
  for (const g of groups) {
    if (g.id === 'key') continue
    const mine = table.filter(r => r.group === g.id && matches(r, g.title, words))
    if (!mine.length) continue
    const list: (FilesPageRow | FilesPageSubheading)[] = []
    let under = ''
    for (const r of mine) {
      if ((r.subgroup ?? '') !== under) { under = r.subgroup ?? ''; if (under) list.push({ heading: under }) }
      list.push({ id: r.id, label: r.label, symbol: r.symbol, when: r.when ?? '', min: r.slots?.min ?? '', typ: r.slots?.typ ?? '', max: r.slots?.max ?? '',
        unit: r.unit ?? '', page: r.page, disputed: r.dispute ?? null })
      shown++
    }
    out.push({ id: g.id, title: g.title, ...(g.tag ? { tag: g.tag } : {}), rows: list })
  }
  return { groups: out, total: table.length, shown }
}

/** The registers worth a row: a name that is a name, or an address, or fields (the reader's 'UNKNOWN · ?' rows say nothing). */
export function readRegisters(rows: readonly Row[]): FilesPageRegister[] {
  return rows.flatMap((row, i) => {
    const name = termText(row.name) ?? ''
    const address = termText(row.address) ?? ''
    const fields = Number(termText(row.fields) ?? 0) || 0
    const real = (name && !/^unknown$/i.test(name)) && (fields > 0 || (address && address !== '?'))
    if (!real) return []
    const page = Number(termText(row.page))
    return [{ id: termText(row.r) ?? `register-${i}`, name, address: address === '?' ? '' : address, reset: termText(row.reset) ?? '', fields,
      description: termText(row.description) ?? '', page: Number.isFinite(page) && page > 0 ? page : null }]
  })
}

// --- related ----------------------------------------------------------------------------------------------------------------------------

/** The parts an edition names, normalized (its records reconciled with its file name and title). */
function partsOf(ed: EditionRecord, fileName: string): Set<string> {
  const id = partIdentity({ partNumber: ed.part, families: ed.families, title: ed.title, fileName: ed.fileName ?? fileName, maker: ed.maker, makerBy: ed.makerBy })
  return new Set([...(id.part ? [id.part] : []), ...id.family].map(normPart).filter(p => p.length >= 3))
}

/** Other documents of the graph naming the same part family: the same part first, then a part of the same line (a module, a grade). */
export function relatedLinks(input: KindPageInput, editions: ReadonlyMap<string, EditionRecord>): FilesPageLink[] {
  const me = editions.get(input.artifactId)
  const mine = me ? partsOf(me, input.fileName) : new Set<string>()
  const file = fileNameWitness(input.fileName)
  if (file.part) mine.add(normPart(file.part))
  if (!mine.size) return []
  const names = new Map(input.tree.map(t => [t.id, t]))
  const hidden = new Set(input.companions.map(c => c.key))
  const out: (FilesPageLink & { rank: number })[] = []
  for (const ed of editions.values()) {
    if (ed.artifact === input.artifactId) continue
    const entry = names.get(ed.artifact)
    if (!entry) continue
    const theirs = partsOf(ed, entry.label)
    let rank = 0
    let named = ''
    for (const p of theirs) {
      for (const m of mine) {
        if (p === m) { rank = 2; named = p; break }
        if (rank < 1 && Math.min(p.length, m.length) >= 4 && (p.startsWith(m) || m.startsWith(p))) { rank = 1; named = p }
      }
      if (rank === 2) break
    }
    if (!rank) continue
    const id = partIdentity({ partNumber: ed.part, families: ed.families, title: ed.title, fileName: ed.fileName ?? entry.label, maker: ed.maker, makerBy: ed.makerBy })
    const theirFile = fileNameWitness(ed.fileName ?? entry.label)
    const type = theirFile.docType && theirFile.docType !== 'Datasheet' ? theirFile.docType : documentTypeWords(ed.docType) ?? documentTypeWords(ed.productType) ?? 'Document'
    out.push({ id: ed.artifact, rank, label: id.part ?? named.toUpperCase(), tag: `${type}${rank === 2 ? '' : ' · related part'}`, detail: entry.label,
      action: `open:artifact:${ed.artifact}` })
  }
  // Documents of the graph whose names carry the part (a design note, a bring-up log).
  for (const t of input.tree) {
    if (t.kind !== 'document' || hidden.has(t.key)) continue
    const n = normPart(t.label)
    const hit = [...mine].find(m => m.length >= 4 && n.includes(m))
    if (hit) out.push({ id: t.key, rank: 2, label: t.label, tag: 'Document', action: `open:document:${t.id}` })
  }
  return out.sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label)).slice(0, 24).map(({ rank: _rank, ...link }) => link)
}

// --- the page ---------------------------------------------------------------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The reader line of the evidence (edition → import record → attempt → tool), else the reading's own. */
function readerFact(input: KindPageInput): FilesPageFact[] {
  const line = input.evidence?.info?.flatMap(s => s.rows).find(r => r.label === 'Reader')?.text
  return line ? [{ label: 'Reader', text: line }] : []
}

/** About this reading: who read it, what became of what it read, where its text is. */
function readingFacts(input: KindPageInput): FilesPageFact[] {
  const r = input.reading
  const counts = r?.counts
  const facts: FilesPageFact[] = [...readerFact(input)]
  for (const f of r?.about ?? []) if (!(f.label === 'Reader' && facts.length)) facts.push({ label: f.label, text: f.text })
  if (counts) {
    const asked = counts.keys + counts.rows
    const aside = [counts.headings ? plural(counts.headings, 'table heading') : '', counts.repeats ? plural(counts.repeats, 'repeat') : ''].filter(Boolean)
    facts.push({ label: 'Values', text: `${plural(asked, 'value')} read: ${plural(counts.keys, 'key value')} and ${plural(counts.rows, 'table row')}${aside.length
      ? ` (${aside.join(' and ')} set aside)` : ''}` })
    facts.push({ label: 'Disputed', text: counts.disputed ? `${plural(counts.disputed, 'value')}: the readers disagreed, and both readings are kept` : 'None: no two readers disagreed about a value' })
  }
  for (const note of r?.notes ?? []) facts.push({ label: 'Note', text: note })
  for (const c of input.companions) if (c.role !== 'notes') facts.push({ label: c.roleLabel, text: c.label, action: `open:${c.key}` })
  return facts
}

/** The datasheet kind's page: its head and the bodies of its sections. */
export function datasheetPageContent(input: KindPageInput): KindPageContent {
  const editions = readEditions(input.rows.editions ?? [])
  const ed = editions.get(input.artifactId)
  const reading = input.reading
  const fileName = ed?.fileName ?? input.fileName
  const ident = partIdentity({
    partNumber: ed?.part ?? null, families: ed?.families.length ? ed.families : reading?.identity?.parts ?? [],
    title: ed?.title ?? reading?.identity?.title ?? null, fileName, maker: ed?.maker ?? reading?.identity?.maker ?? null,
    makerBy: ed?.makerBy ?? reading?.identity?.makerBy ?? null,
  })
  const file = fileNameWitness(fileName)
  const recordsType = documentTypeWords(ed?.docType ?? reading?.identity?.documentType ?? null)
  const docType = file.docType && file.docType !== 'Datasheet' && (!recordsType || recordsType === 'Datasheet') ? file.docType : recordsType ?? file.docType
  const revision = reading?.identity?.revision ?? ed?.revision ?? null
  const literature = reading?.identity?.literature ?? ed?.literature ?? null
  const pages = reading?.pageCount ?? ed?.pages ?? null
  const hint = makerHint(ident.makerBy)
  const lines = [
    ...(ident.maker ? [{ text: ident.maker, ...(hint ? { title: `Maker ${hint}` } : {}) }] : []),
    ...(docType ? [{ text: docType }] : []),
    ...(revision ? [{ text: /^rev/i.test(revision) ? revision : `Rev ${revision}` }] : file.edition ? [{ text: file.edition, title: 'From the file name' }] : []),
    ...(literature ? [{ text: literature, title: 'Literature number' }] : []),
    ...(pages ? [{ text: plural(pages, 'page') }] : []),
  ]
  const title = ident.part ?? input.fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '')
  const chips = ident.family.map(f => ({ text: f, ...(ident.part && normPart(f) === normPart(ident.part) ? { current: true } : {}) }))
  const rows = reading?.rows ?? []
  const type = partType(ed?.kind, ed?.productType, ed?.title ?? reading?.identity?.title, docType)
  const values = keyValues(rows, type)
  const table = extractedTable(rows, reading?.groups ?? [], input.filter)
  const registers = readRegisters(input.rows.registers ?? [])
  const related = relatedLinks(input, editions)
  const loading = input.readingStatus === 'loading' && !reading
  const bodies: Record<string, FilesPageBody | null> = {
    'key-values': values.length ? { face: 'values', values } : null,
    extracted: table.total || registers.length ? { face: 'table', groups: table.groups, filter: input.filter, total: table.total, shown: table.shown, registers } : null,
    related: related.length ? { face: 'links', links: related } : null,
    reading: reading || input.companions.length ? { face: 'facts', rows: readingFacts(input) } : null,
  }
  const datasheet = !docType || docType === 'Datasheet'
  const notes: Record<string, string> = {}
  const hidden: string[] = []
  if (!loading) {
    if (!values.length) { if (rows.length) notes['key-values'] = 'None of the values this kind of part is known by was read; the table below has what was.'; else hidden.push('key-values') }
    if (!table.total && !registers.length) {
      if (input.readingStatus === 'error') notes.extracted = `The reading could not be fetched: ${input.readingError}`
      else if (datasheet) notes.extracted = reading?.empty ?? 'Nothing was read from this file yet.'
      else hidden.push('extracted')
    }
    if (!related.length) hidden.push('related')
  }
  return {
    head: { title, chips, lines },
    bodies,
    counts: { ...(table.total ? { extracted: String(table.total) } : {}), ...(related.length ? { related: String(related.length) } : {}) },
    notes,
    hidden,
  }
}
