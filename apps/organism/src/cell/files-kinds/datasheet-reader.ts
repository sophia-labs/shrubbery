/**
 * The datasheet's margin (plans/2026-10-08-datasheets-in-sophia.md §6, "the reader page"): what was read from the open PDF, every parsed value
 * with the page it is printed on. The cell tool `datasheet_facts { artifact, limit }` answers with the edition (identity, document
 * diagnostics) and its claims; this module turns that answer into the kind-neutral `MarginReading` the margin and the table draw.
 *
 * The cell is a different program from this one and moves on its own, so everything here is read defensively: a field that is absent is
 * a row not drawn, never an exception; an unknown diagnostic is shown in its own words; identity fields the cell is still gaining
 * (`makerBy`, `partsBy`, an `identity` block) are used when they are there.
 *
 *   claim  { id, kind: keyParameter | specRow, parameter, symbol, section, group, regime, value: { lower, typical, upper, unit, text },
 *            conditions: { row, slots: { lower|typical|upper: { conditions, guarantee } } }, page, box, readings: [ { sourceRole, readerTools,
 *            page, lower, typical, upper } ], corroboration: { level, independentSources, contested }, diagnostics, checks, checkedByPerson }
 */
import type { Corroboration } from '@shrubbery/nucleus'
import type { FileKindMargin, MarginFact, MarginGroup, MarginReading, MarginRowData } from './registry.js'
import {
  figure, headingWords, isHeadingRow, normPart, parameterLabel, parameterSymbol, partIdentity, sectionWords, span, splitLeadingSymbol, withoutFootnotes,
} from './datasheet-words.js'

export { figure }

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Rec : null)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)
const real = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const strings = (v: unknown): string[] => arr(v).flatMap(x => { const s = str(x); return s ? [s] : [] })

/** Rows asked for at once: the cell's own ceiling (garden `datasheet_facts` clamps `limit` to 1..1000, 200 by default). */
export const FACTS_LIMIT = 1000

/** '4.5–28 V', '≤ 28 V', '≥ 3.5 V', 'typ 1.2 V', '0.9–1.5 (typ 1.2) V', '−40 to 125 °C'; '' when nothing numeric was read. */
export function claimValue(value: Rec | null, unitFallback = ''): string {
  if (!value) return ''
  const lower = real(value.lower), typical = real(value.typical), upper = real(value.upper)
  const unit = str(value.unit) ?? unitFallback
  const parts: string[] = []
  if (lower !== null && upper !== null) parts.push(span(lower, upper))
  else if (upper !== null) parts.push(`≤ ${figure(upper)}`)
  else if (lower !== null) parts.push(`≥ ${figure(lower)}`)
  if (typical !== null) parts.push(parts.length ? `(typ ${figure(typical)})` : `typ ${figure(typical)}`)
  if (!parts.length) return str(value.text) ?? ''
  return `${parts.join(' ')}${unit ? ` ${unit}` : ''}`
}

const REGIME_WORDS: Readonly<Record<string, string>> = {
  absoluteMaximum: 'Absolute maximum', recommendedOperating: 'Recommended operating', electricalCharacteristic: 'Electrical characteristics', otherRegime: '',
}
const REGIME_RANK: Readonly<Record<string, number>> = { absoluteMaximum: 1, recommendedOperating: 2, electricalCharacteristic: 3 }

function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words ? words[0]!.toUpperCase() + words.slice(1) : ''
}

const SOURCE_WORDS: Readonly<Record<string, string>> = { roc: 'ROC table', prose: 'prose', specTable: 'spec table', vendor: 'vendor file' }

/** A diagnostic of the reader or the importer, in plain words. An unknown one keeps its own words. */
export function plainDiagnostic(raw: string): string {
  const text = raw.trim()
  const disagreement = /^disagreement:\s*(.*)$/i.exec(text)
  if (disagreement) {
    const sides = disagreement[1]!.replace(/^"+|"+$/g, '').split(/\s+vs\.?\s+/i).map(side => {
      const [who, ...what] = side.split('=')
      return what.length ? `${SOURCE_WORDS[who!.trim()] ?? who!.trim()} read ${what.join('=').trim()}` : side.trim()
    })
    return `The readers disagree: ${sides.join(', ')}.`
  }
  const derived = /^derived from spec_rows\[(\d+)\]\s*\((.*)\)\s*$/.exec(text)
  if (derived) return `Taken from table row ${derived[1]}${derived[2]!.trim() ? ` (${derived[2]!.trim()})` : ''}.`
  if (/^row range inverted/i.test(text)) return 'The row reads with its minimum above its maximum.'
  switch (text) {
    case 'text_readers_disagree': return 'The text readers disagreed on parts of this document; values they did not agree on are marked.'
    case 'unit_maybe_micro': return 'The unit may be a micro prefix (µ) that was read as a plain letter.'
    case 'value_not_numeric': return 'No number was read: the value is not a plain number as printed.'
    case 'split_from_merged_row': return 'Split out of a row the reader had merged with its neighbour.'
    case 'label_from_neighbour': return 'The name was taken from the neighbouring row.'
    case 'unit_from_neighbour': return 'The unit was taken from the neighbouring row.'
    default: return text.includes(' ') ? text : humanize(text) + '.'
  }
}

function checkWords(check: unknown): string | null {
  const text = str(check)
  if (text) return text
  const r = rec(check)
  if (!r) return null
  const result = str(r.result) ?? str(r.outcome)
  const facet = str(r.facet)
  const by = str(r.byName) ?? str(r.by)
  return result ? `${result === 'accept' ? 'Checked against the page' : humanize(result)}${facet ? ` (${humanize(facet)})` : ''}${by ? `, by ${by}` : ''}.` : null
}

function markOf(claim: Rec, contested: boolean): Corroboration {
  if (claim.checkedByPerson === true) return 'checked'
  if (contested) return 'contested'
  const level = str(rec(claim.corroboration)?.level)
  return level === 'high' || level === 'medium' || level === 'low' ? level : 'low'
}

const isDisagreement = (d: string) => /^disagreement/i.test(d)

/** The box the import gave, read defensively: `{ page?, l, b, r, t }` in PDF user space (points, origin bottom-left); anything else is no box. */
function boxOf(claim: Rec): Pick<MarginRowData, 'box' | 'precision' | 'method'> {
  const b = rec(claim.box)
  const l = real(b?.l), bt = real(b?.b), r = real(b?.r), t = real(b?.t)
  const precision = str(claim.precision) ?? str(b?.precision)
  const method = str(claim.method) ?? str(b?.method)
  const meta = { ...(precision ? { precision } : {}), ...(method ? { method } : {}) }
  const page = int(b?.page) ?? int(claim.page)
  if (l === null || bt === null || r === null || t === null || !page || r <= l || t <= bt) return meta
  return { box: { page, l, b: bt, r, t }, ...meta }
}

function slotConditions(claim: Rec): string[] {
  const slots = rec(rec(claim.conditions)?.slots)
  if (!slots) return []
  return (['lower', 'typical', 'upper'] as const).flatMap(slot => {
    const s = rec(slots[slot])
    const when = str(s?.conditions)
    if (!when) return []
    const guarantee = str(s?.guarantee)
    return [`${slot === 'lower' ? 'Min' : slot === 'typical' ? 'Typ' : 'Max'}: ${when}${guarantee ? ` (${guarantee})` : ''}`]
  })
}

function readingWords(reading: Rec): { text: string; page: number | null } {
  const role = str(reading.sourceRole)
  const tools = strings(reading.readerTools)
  const value = claimValue(reading, '')
  const who = `${role ? SOURCE_WORDS[role] ?? role : 'reading'}${tools.length ? ` (${tools.join(', ')})` : ''}`
  return { text: `${who}: ${value || 'no value'}`, page: int(reading.page) }
}

const JUNK_SECTION = /^(www\.|https?:|©|\d+$)/i

/** One cleaned row of the reading, before it is placed in its group. */
interface Counted { headings: number; repeats: number }

/**
 * Groups and rows of the claims: the key values first, then each table (regime, section) in the order of the regime then the page.
 *
 * What the reader handed over is cleaned the way a person would read the page: a table's own section heading ('AUDIO PERFORMANCE',
 * no value) is a heading, never a row; footnote markers leave the names; a symbol carried down from the row above onto a different
 * parameter ('Intermodulation distortion · THD+N') is dropped; the importer's internal keys ('gainBandwidth') become words; a row the
 * reader split into identical pieces is one row.
 */
function groupClaims(claims: Rec[], counted: Counted): { groups: MarginGroup[]; rows: MarginRowData[] } {
  const groups = new Map<string, MarginGroup & { rank: number; order: number }>()
  const rows: MarginRowData[] = []
  const seen = new Set<string>()
  // Per group: the raw symbol and the name of the row above, and the table heading it sits under.
  const above = new Map<string, { symbol: string; label: string; heading: string }>()
  claims.forEach((claim, index) => {
    const id = str(claim.id) ?? `claim-${index}`
    const key = str(claim.kind) === 'keyParameter'
    const regime = str(claim.regime) ?? 'otherRegime'
    const section = str(claim.section)
    const clean = section && !JUNK_SECTION.test(section) && section.length >= 3 ? sectionWords(section) : ''
    const regimeWord = REGIME_WORDS[regime] ?? humanize(regime)
    const groupId = key ? 'key' : `${regime}|${clean.toLowerCase()}`
    const value = rec(claim.value)
    const lo = real(value?.lower), ty = real(value?.typical), hi = real(value?.upper)
    const rawName = str(claim.parameter) ?? humanize(str(claim.predicate)?.split('#').pop() ?? '')
    const rawSymbol = str(claim.symbol)
    const rowConditions = str(rec(claim.conditions)?.row)
    const prev = above.get(groupId)
    if (!key && isHeadingRow({ label: rawName, symbol: rawSymbol, conditions: rowConditions, hasNumber: lo !== null || ty !== null || hi !== null })) {
      counted.headings++
      above.set(groupId, { symbol: '', label: '', heading: headingWords(rawName) })
      return
    }
    if (!groups.has(groupId)) {
      const title = key ? 'Key values' : clean || regimeWord || 'Other rows'
      const tag = !key && clean && regimeWord && !title.toLowerCase().includes(regimeWord.toLowerCase().split(' ')[0]!) ? regimeWord : undefined
      groups.set(groupId, { id: groupId, title, ...(tag ? { tag } : {}), rank: key ? 0 : REGIME_RANK[regime] ?? 4, order: groups.size })
    }
    const name = key ? parameterLabel(rawName) : withoutFootnotes(rawName)
    let symbol = rawSymbol ? withoutFootnotes(rawSymbol) : ''
    // A symbol the row above printed, on a parameter that is not the row above's, was carried down by the reader.
    if (!key && symbol && prev && prev.symbol && prev.symbol === rawSymbol && prev.label && normPart(prev.label) !== normPart(name)) symbol = ''
    if (key && !symbol) symbol = parameterSymbol(rawName)
    let named = name
    if (!key && !symbol) { const split = splitLeadingSymbol(name); if (split) { symbol = split.symbol; named = split.label } }
    const label = named || prev?.heading || symbol || 'Unnamed row'
    above.set(groupId, { symbol: rawSymbol ?? '', label: name, heading: prev?.heading ?? '' })
    const unit = str(value?.unit) ?? ''
    const page = int(claim.page)
    const fold = [groupId, label.toLowerCase(), symbol, rowConditions ?? '', lo, ty, hi, unit, page].join('|')
    if (seen.has(fold)) { counted.repeats++; return }
    seen.add(fold)
    const diagnostics = strings(claim.diagnostics)
    const corroboration = rec(claim.corroboration)
    const disagreement = diagnostics.find(isDisagreement)
    const contested = corroboration?.contested === true || disagreement !== undefined
    const conditions = [rowConditions, ...slotConditions(claim)].flatMap(c => c ? [c] : [])
    const sources = int(corroboration?.independentSources)
    const mark = markOf(claim, contested)
    const corrected = claim.corrected === true || rec(claim.correction) !== null || arr(claim.checks).some(c => /correct/i.test(str(rec(c)?.result) ?? ''))
    const notes = [
      ...diagnostics.map(plainDiagnostic), ...arr(claim.checks).flatMap(c => { const w = checkWords(c); return w ? [w] : [] }),
      ...(sources !== null && !contested ? [`${sources} independent ${sources === 1 ? 'source' : 'sources'}.`] : []),
    ]
    rows.push({
      id, group: groupId, label, symbol: symbol && symbol.toLowerCase() !== label.toLowerCase() ? symbol : '',
      value: claimValue(value), page, mark, contested, key,
      status: corrected ? 'corrected' : mark === 'checked' ? 'checked' : contested ? 'contested' : 'read',
      numbers: [lo, ty, hi].flatMap(n => n === null ? [] : [n]), sectionTitle: groups.get(groupId)!.title,
      readingPages: [...new Set(arr(claim.readings).flatMap(r => { const n = int(rec(r)?.page); return n !== null && n > 0 && n !== page ? [n] : [] }))],
      conditions: conditions.filter((c, i) => conditions.indexOf(c) === i),
      readings: arr(claim.readings).flatMap(r => { const x = rec(r); return x ? [readingWords(x)] : [] }),
      notes,
      slots: { min: lo === null ? '' : figure(lo), typ: ty === null ? '' : figure(ty), max: hi === null ? '' : figure(hi) }, unit,
      subgroup: key ? '' : prev?.heading ?? '', when: rowConditions ?? '',
      ...(contested ? { dispute: disagreement ? plainDiagnostic(disagreement) : 'The readers disagree about this value.' } : {}),
      ...boxOf(claim),
    })
  })
  const ordered = [...groups.values()].sort((a, b) => a.rank - b.rank || a.order - b.order).map(({ id, title, tag }) => ({ id, title, ...(tag ? { tag } : {}) }))
  return { groups: ordered, rows }
}

/** The identity block of an edition: today's fields, and the ones the cell is gaining (`makerBy`, `partsBy`, `identity`, its diagnostics). */
function identityOf(edition: Rec): { makerBy: string | null; partsBy: string | null; diagnostics: string[] } {
  const identity = rec(edition.identity)
  const by = (v: unknown): string | null => str(v) ?? (rec(v) ? str(rec(v)!.by) ?? str(rec(v)!.source) ?? str(rec(v)!.how) : null)
  return {
    makerBy: by(edition.makerBy) ?? by(identity?.makerBy) ?? by(rec(identity?.maker)),
    partsBy: by(edition.partsBy) ?? by(edition.partBy) ?? by(identity?.partsBy) ?? by(rec(identity?.parts)),
    diagnostics: [...strings(edition.identityDiagnostics), ...strings(identity?.diagnostics)],
  }
}

/** The edition of the answer that belongs to this artifact (a `part` query can return several; an `artifact` query one). */
function editionOf(raw: Rec, artifactId: string): Rec | null {
  const editions = arr(raw.editions).flatMap(e => { const r = rec(e); return r ? [r] : [] })
  return editions.find(e => str(e.artifact) === artifactId) ?? editions[0] ?? null
}

/** How a maker is known, in words ('from the document and the file name'); nothing for the records' own reading. */
export function makerHint(by: string | null): string | undefined {
  if (!by || by === 'records' || by === 'parser' || by === 'none') return undefined
  if (by === 'part-prefix') return 'guessed from the part number'
  const WORDS: Readonly<Record<string, string>> = { text: 'the document', parser: 'the reader', filename: 'the file name', 'file name': 'the file name', title: 'the title' }
  const words = by.split('+').map(w => w.trim()).filter(Boolean).map(w => WORDS[w] ?? (/^the\s/i.test(w) ? w : `the ${w}`))
  return words.length ? `from ${words.join(' and ')}` : undefined
}

/** The reader's own account of the reading (`edition.reader`), as plain facts. */
function aboutOf(edition: Rec): MarginFact[] {
  const reader = rec(edition.reader)
  const tools = rec(reader?.tools)
  const toolLine = tools ? Object.entries(tools).flatMap(([name, commit]) => [`${name}${str(commit) ? ` ${str(commit)!.slice(0, 7)}` : ''}`]).join(', ') : ''
  const readers = rec(reader?.readers)
  const readerLine = readers ? [...new Set(Object.values(readers).flatMap(v => str(v) ? [str(v)!] : []))].join(', ') : ''
  const generated = str(reader?.generated)
  const repairs = int(reader?.unitRepairs)
  const byte = str(edition.byteCheck)
  return [
    ...(toolLine ? [{ label: 'Reader', text: toolLine }] : []),
    ...(readerLine ? [{ label: 'Read with', text: readerLine }] : []),
    ...(generated ? [{ label: 'Read on', text: generated }] : []),
    ...(repairs ? [{ label: 'Units repaired', text: String(repairs) }] : []),
    ...(byte ? [{ label: 'File', text: byte === 'matched' ? 'The same bytes the reader read' : `Did not match the bytes the reader read (${byte})` }] : []),
  ]
}

/** `datasheet_facts` for one artifact → the margin's reading. */
export function readDatasheetFacts(raw: Rec, artifactId: string, context: { readonly fileName?: string } = {}): MarginReading {
  const edition = editionOf(raw, artifactId)
  if (!edition) {
    return { title: '', facts: [], notes: [], groups: [], rows: [], empty: 'Nothing was read from this file yet.', truncated: null, pageCount: null }
  }
  const claims = arr(edition.claims).flatMap(c => { const r = rec(c); return r ? [r] : [] })
  const counted: Counted = { headings: 0, repeats: 0 }
  const { groups, rows } = groupClaims(claims, counted)
  const identity = identityOf(edition)
  const parts = strings(edition.parts)
  const pages = int(edition.pageCount)
  const revision = str(edition.revision)
  const keyCount = rows.filter(r => r.key).length
  const shown = context.fileName
    ? partIdentity({ partNumber: null, families: parts, title: str(edition.title), fileName: context.fileName, maker: str(edition.maker), makerBy: identity.makerBy })
    : null
  const maker = shown ? shown.maker : str(edition.maker)
  const makerBy = shown ? shown.makerBy : identity.makerBy
  const family = shown?.family.length ? shown.family : shown?.part ? [shown.part] : parts.map(p => p.toUpperCase())
  const hint = makerHint(makerBy)
  const facts: MarginFact[] = [
    ...(maker ? [{ label: 'Maker', text: maker, ...(hint ? { hint } : {}) }] : []),
    ...(revision ? [{ label: 'Revision', text: revision }] : []),
    ...(family.length ? [{ label: family.length > 1 ? 'Part family' : 'Part', text: family.join(', '), ...(identity.partsBy ? { hint: identity.partsBy } : {}) }] : []),
    ...(pages !== null ? [{ label: 'Pages', text: String(pages) }] : []),
    { label: 'Read', text: `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}${keyCount ? `, ${keyCount} key ${keyCount === 1 ? 'value' : 'values'}` : ''}` },
  ]
  const byteCheck = str(edition.byteCheck)
  const corrections = arr(edition.corrections).length
  const notes = [
    ...strings(edition.diagnostics).map(plainDiagnostic), ...identity.diagnostics.map(plainDiagnostic),
    ...(byteCheck && byteCheck !== 'matched' ? [`The stored file did not match its recorded digest (${byteCheck}).`] : []),
    ...(corrections ? [`${corrections} ${corrections === 1 ? 'correction was' : 'corrections were'} imported with it.`] : []),
  ]
  const title = str(edition.title) ?? (family.length ? family.join(', ') : '')
  return {
    title, facts, notes: notes.filter((n, i) => notes.indexOf(n) === i), groups, rows,
    empty: rows.length ? null : 'Text only: no tables were read. The page is still there to read; nothing was taken from it as a value.',
    truncated: edition.truncated === true ? `Showing the first ${rows.length} rows; the cell cut the rest off at ${FACTS_LIMIT}.` : null,
    pageCount: pages,
    identity: { title: str(edition.title), parts, maker: str(edition.maker), makerBy: identity.makerBy, revision, documentType: str(edition.documentType),
      literature: str(edition.literature) },
    about: aboutOf(edition),
    counts: { rows: claims.filter(c => str(c.kind) !== 'keyParameter').length, keys: keyCount, headings: counted.headings, repeats: counted.repeats,
      disputed: rows.filter(r => r.contested).length },
  }
}

export const datasheetMargin: FileKindMargin = {
  title: 'What was read',
  tool: 'datasheet_facts',
  args: (graphId, artifactId) => ({ graphId, artifact: artifactId, limit: FACTS_LIMIT }),
  read: readDatasheetFacts,
  artifactOf: id => /^(.+?)-(?:params|spec_rows)-/.exec(id)?.[1] ?? null,
}
