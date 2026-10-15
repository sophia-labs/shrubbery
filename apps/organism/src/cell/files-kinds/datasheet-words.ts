/**
 * How a datasheet's reading is said to a person: numbers with their own precision, ranges, human labels, table headings told apart from
 * values, and who made the part and what it is called when the records are thin. Pure functions; the card, the reader's overlay and the
 * info page all say things through these, so they say them the same way.
 *
 * The importer's records are testimony, and older imports are thin (no maker, a part that is a fragment of the real one, a part that is
 * the file's own stem). The display does what it can with what is on the screen anyway: the file name and the title. Anything taken from
 * there is said to come from there (`by`). The importer's own identity reconciliation (garden `datasheet_identity.rs`) is the better
 * source; a re-import replaces what is guessed here.
 */

/** A number as printed: its own digits, never rounded to zero ('0.00008', not '0'); a true minus sign. */
export function figure(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (n === 0) return '0'
  const abs = Math.abs(n)
  // 12 significant digits drop binary noise (0.1 + 0.2) and keep every digit a datasheet prints.
  const text = abs >= 1e-6 && abs < 1e15 ? String(Number(abs.toPrecision(12))) : abs.toExponential(3).replace(/\.?0+e/, 'e')
  return `${n < 0 ? '−' : ''}${text}`
}

/** 'a–b', or 'a to b' when a sign would make the dash read as a minus. */
export function span(lower: number, upper: number): string {
  if (lower === upper) return figure(lower)
  return lower < 0 || upper < 0 ? `${figure(lower)} to ${figure(upper)}` : `${figure(lower)}–${figure(upper)}`
}

/** '1.8–6.5 V', '≤ 28 V', '≥ 3.5 V', 'typ 1.2 mA', '0.9–1.5 V (typ 1.2)'; '' when no number was read. */
export function valueWords(v: { lower: number | null; typical: number | null; upper: number | null; nominal?: number | null }, unit: string): string {
  const u = unit ? ` ${unit}` : ''
  const { lower, typical, upper } = v
  const nominal = v.nominal ?? null
  if (lower !== null && upper !== null) return `${span(lower, upper)}${u}${typical !== null ? ` (typ ${figure(typical)})` : ''}`
  if (nominal !== null) return `${figure(nominal)}${u}`
  if (upper !== null) return `${typical !== null ? `typ ${figure(typical)}, ` : ''}≤ ${figure(upper)}${u}`
  if (lower !== null) return `${typical !== null ? `typ ${figure(typical)}, ` : ''}≥ ${figure(lower)}${u}`
  if (typical !== null) return `typ ${figure(typical)}${u}`
  return ''
}

/** Footnote markers ('Headroom (1)', 'Slew rate ⁽²⁾') are the page's, not the parameter's. */
export function withoutFootnotes(text: string): string {
  const t = text.replace(/\s*\(\s*\d{1,2}\s*\)/g, '').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, '').replace(/\s+/g, ' ').trim()
  // A cell the reader read once per column it spans ('Storage temperature, Tstg Storage temperature, Tstg') is said once.
  return t.replace(/^(.{3,}?)(?:\s+\1)+$/, '$1')
}

/** The words of the importer's own parameter names; anything else camelCase is spaced and lower-cased. */
const PARAMETER_WORDS: Readonly<Record<string, readonly [string, string?]>> = {
  vin: ['Input voltage', 'VIN'], inputvoltage: ['Input voltage', 'VIN'], vout: ['Output voltage', 'VOUT'], outputvoltage: ['Output voltage', 'VOUT'],
  iout: ['Output current', 'IOUT'], outputcurrent: ['Output current', 'IOUT'], fsw: ['Switching frequency', 'fSW'], switchingfrequency: ['Switching frequency', 'fSW'],
  iq: ['Quiescent current', 'IQ'], quiescentcurrent: ['Quiescent current', 'IQ'], gainbandwidth: ['Gain bandwidth', 'GBW'], gbw: ['Gain bandwidth', 'GBW'],
  gainbandwidthproduct: ['Gain bandwidth', 'GBW'], inputoffsetvoltage: ['Input offset voltage', 'VOS'], vos: ['Input offset voltage', 'VOS'],
  supplyvoltage: ['Supply voltage'], supply: ['Supply voltage'], drainsourcevoltage: ['Drain–source voltage', 'VDS'], vds: ['Drain–source voltage', 'VDS'],
  draincurrent: ['Drain current', 'ID'], onresistance: ['On-resistance', 'RDS(on)'], rdson: ['On-resistance', 'RDS(on)'], dropout: ['Dropout voltage', 'VDO'],
  dropoutvoltage: ['Dropout voltage', 'VDO'], accuracy: ['Accuracy'], range: ['Range'], measurementrange: ['Range'], resolution: ['Resolution'],
  samplerate: ['Sample rate'], datarate: ['Data rate'], slewrate: ['Slew rate', 'SR'], core: ['Core'], flash: ['Flash'], flashsize: ['Flash'], ram: ['RAM'], ramsize: ['RAM'],
}

/** A parameter's name as a person reads it: the importer's internal keys ('gainBandwidth', 'vin') never reach the screen. */
export function parameterLabel(name: string): string {
  const clean = withoutFootnotes(name)
  const known = PARAMETER_WORDS[clean.replace(/[^A-Za-z0-9]/g, '').toLowerCase()]
  // Only an identifier-shaped name is a key: a printed name ('Input voltage', 'VIN') keeps its own words.
  if (known && /^[a-z][A-Za-z0-9]*$/.test(clean)) return known[0]
  if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(clean)) {
    const words = clean.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
    return words.charAt(0).toUpperCase() + words.slice(1)
  }
  return clean
}

/** The symbol the importer's key names stand for ('vin' → 'VIN'); '' when none is known. */
export function parameterSymbol(name: string): string {
  const known = PARAMETER_WORDS[name.replace(/[^A-Za-z0-9]/g, '').toLowerCase()]
  return known?.[1] ?? ''
}

/** Symbols that read like words: temperature subscripts printed in mixed case. */
const MIXED_SYMBOLS = /^(?:Tstg|Tsol|Tlead|Tj|Ta|Tc|Tsold)$/

/**
 * A symbol the reader merged into the name ('TA Operating temperature', 'V(ESD) Electrostatic discharge'), split back out: a leading
 * token with two capitals, a digit or a subscript in parentheses, followed by a capitalized word. Names that merely start with a
 * capital ('Input voltage', 'Total harmonic distortion') are left alone.
 */
export function splitLeadingSymbol(label: string): { symbol: string; label: string } | null {
  const m = /^([A-Za-z][A-Za-z0-9]{0,6}(?:\([A-Za-z0-9+-]{1,8}\))?)\s+([A-Z][a-z].*)$/.exec(label.trim())
  if (!m) return null
  const token = m[1]!
  const capitals = (token.match(/[A-Z]/g) ?? []).length
  // 'tON', 'tSUSTO': a lower-case subscript-first symbol still carries its capitals.
  const symbolish = capitals >= 2 || (/^[A-Z]/.test(token) && (/\d|\(/.test(token) || MIXED_SYMBOLS.test(token)))
  return symbolish ? { symbol: token, label: m[2]!.trim() } : null
}

/** 'AUDIO PERFORMANCE' → 'Audio performance' (a table's own heading, said once). */
export function headingWords(text: string): string {
  const t = withoutFootnotes(text).toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * Whether a row the reader took for a value is the table's own section heading ('AUDIO PERFORMANCE · no value'): no number, its name in
 * capitals (a run of four or more), and its symbol and conditions either absent or the heading again.
 */
export function isHeadingRow(row: { label: string; symbol: string | null; conditions: string | null; hasNumber: boolean }): boolean {
  if (row.hasNumber) return false
  const label = withoutFootnotes(row.label)
  if (!label || /[a-z]/.test(label) || !/[A-Z]{4,}/.test(label) || /\d/.test(label)) return false
  const same = (s: string | null) => !s || !s.trim() || s.trim().toUpperCase() === label.toUpperCase() || label.toUpperCase().includes(s.trim().toUpperCase())
  return same(row.symbol) && same(row.conditions)
}

/** '5.1 Absolute Maximum Ratings (continued)' → 'Absolute Maximum Ratings'. */
export function sectionWords(section: string): string {
  return section.replace(/\s*\(continued\)\s*$/i, '').replace(/^\s*(?:\d+(?:\.\d+)*|[A-Z](?:\.\d+)+)\.?\s+(?=\S)/, '').replace(/\s+/g, ' ').trim()
}

/** A part identifier, normalized for matching ('ESP32-C3-MINI-1' → 'esp32c3mini1'). */
export function normPart(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]/g, '') }

// --- identity from the file name and the title --------------------------------------------------------------------------------------------

/** First words of a file name that name a maker (the importer's lexicon, garden `datasheet_identity.rs`). */
const MAKER_PREFIXES: Readonly<Record<string, string>> = {
  ti: 'Texas Instruments', texas: 'Texas Instruments', adi: 'Analog Devices', analog: 'Analog Devices', infineon: 'Infineon', ir: 'Infineon',
  microchip: 'Microchip Technology', atmel: 'Microchip Technology', espressif: 'Espressif', bosch: 'Bosch Sensortec', vishay: 'Vishay', murata: 'Murata',
  zilog: 'Zilog', jst: 'JST', st: 'STMicroelectronics', stm: 'STMicroelectronics', nxp: 'NXP', onsemi: 'onsemi', fairchild: 'onsemi', renesas: 'Renesas',
  intersil: 'Renesas', nexperia: 'Nexperia', diodes: 'Diodes Incorporated', maxim: 'Maxim Integrated', linear: 'Linear Technology', ltc: 'Linear Technology',
  nordic: 'Nordic Semiconductor', silabs: 'Silicon Labs', rohm: 'ROHM', toshiba: 'Toshiba', cypress: 'Cypress', allegro: 'Allegro MicroSystems',
  mps: 'Monolithic Power Systems', semtech: 'Semtech', lattice: 'Lattice Semiconductor', littelfuse: 'Littelfuse', tdk: 'TDK', kemet: 'Kemet',
  panasonic: 'Panasonic', arxiv: 'arXiv',
}

/** Words of a file name that end the part's name (what the file is, its edition, where it came from). */
const STOP = /^(ds|datasheet|data|sheet|series|family|local|older|newer|final|spec|specification|productspec|mlcc|errata|master|trm|manual|userguide|guide|user|appnote|app|note|rev[a-z0-9]*|v\d[\d.]*|\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\d{2}|connector|eval|evm)$/i

/** Literature numbers (TI's SBAS444E, SLVU720) name a document, not a part. */
const LITERATURE = /^(?:s[a-z]{3}\d{3}[a-z]?)$/i

/** A word that can be (the start of) a part number: letters and digits together. */
const isPartWord = (w: string) => /[a-z]/i.test(w) && /\d/.test(w) && w.length >= 2

const DOC_TYPE_WORDS: readonly (readonly [RegExp, string])[] = [
  [/^errata$/i, 'Errata'], [/^trm$/i, 'Technical reference manual'], [/^(?:userguide|guide)$/i, 'User guide'], [/^appnote$/i, 'Application note'],
  [/^productspec$/i, 'Product specification'], [/^spec$/i, 'Specification'], [/^(?:ds|datasheet)$/i, 'Datasheet'],
]

export interface FileNameWitness {
  readonly maker: string | null
  readonly part: string | null
  readonly docType: string | null
  /** 'Rev A', 'v2.6', 'Mar 1978'. */
  readonly edition: string | null
}

/** What a file name says: `ti-opa2134_DS.pdf` → Texas Instruments, OPA2134, Datasheet. */
export function fileNameWitness(name: string): FileNameWitness {
  const base = name.split('/').pop() ?? name
  const stem = base.replace(/\.text\.txt$/i, '').replace(/\.[A-Za-z0-9]{1,5}$/, '')
  const words = stem.split(/[-_\s]+/).filter(Boolean)
  const maker = words.length ? MAKER_PREFIXES[words[0]!.toLowerCase()] ?? null : null
  const rest = maker ? words.slice(1) : words
  const run: string[] = []
  for (const w of rest) {
    if (STOP.test(w) || LITERATURE.test(w)) { if (run.length) break; continue }
    if (!run.length) { if (isPartWord(w)) run.push(w); else if (/^\d[\d.]*$/.test(w)) break; continue }
    // A part keeps its short tail words ('esp32-c3-mini-1', 'z80-cpu').
    if (w.length <= 5 && /^[a-z0-9]+$/i.test(w)) run.push(w); else break
  }
  let docType: string | null = null
  for (const w of rest) { const hit = DOC_TYPE_WORDS.find(([re]) => re.test(w)); if (hit) { docType = hit[1]; if (hit[1] !== 'Datasheet') break } }
  let edition: string | null = null
  for (const w of rest) {
    const rev = /^rev([a-z0-9]{1,3})$/i.exec(w)
    const ver = /^v(\d+(?:\.\d+)*)$/i.exec(w)
    const month = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\d{2})$/i.exec(w)
    if (rev) edition = `Rev ${rev[1]!.toUpperCase()}`
    else if (ver) edition = `v${ver[1]}`
    else if (month) edition = `${month[1]!.charAt(0).toUpperCase()}${month[1]!.slice(1).toLowerCase()} ${Number(month[2]) > 50 ? 19 : 20}${month[2]}`
  }
  return { maker, part: run.length ? run.join('-').toUpperCase() : null, docType, edition }
}

/** The parts a title leads with: 'LM158, LM158A, LM258 … LM358BA' → each; 'TPS54331 3-A, 28-V Input …' → TPS54331. */
export function titleParts(title: string | null): string[] {
  if (!title) return []
  const out: string[] = []
  for (const raw of title.split(/[\s,/]+/)) {
    const w = raw.replace(/[^A-Za-z0-9-]/g, '')
    if (!w) continue
    if (!(isPartWord(w) && /^[A-Z0-9-]+$/.test(w) && w.length >= 4 && !/^\d/.test(w)) || LITERATURE.test(w)) { if (out.length) break; continue }
    if (!out.some(p => normPart(p) === normPart(w))) out.push(w)
  }
  return out
}

export interface PartIdentity {
  /** The part, large; null when nothing names one (an app note, a paper). */
  readonly part: string | null
  /** Every part the sheet covers, in the records' or the title's order, the headline among them (empty for one part). */
  readonly family: readonly string[]
  /** How the headline is known: 'records', 'file name', 'title'. */
  readonly partBy: string
  readonly maker: string | null
  readonly makerBy: string | null
}

/**
 * The part and the maker as the display says them. The records win, except where they are visibly thinner than what the file is called:
 * a part that is a short tail of the file's own part (`A12` of GRM188R71C105KA12), a part that is the file's stem echoed back, a parser
 * guess of the maker from a part prefix that the file's maker word contradicts (`ADS1113 · Analog Devices` for `ti-ads1115_DS.pdf`).
 */
export function partIdentity(input: {
  readonly partNumber: string | null
  readonly families: readonly string[]
  readonly title: string | null
  readonly fileName: string
  readonly maker: string | null
  readonly makerBy: string | null
}): PartIdentity {
  const file = fileNameWitness(input.fileName)
  const fromTitle = titleParts(input.title)
  const fileStem = input.fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '')
  const recordsRaw = [input.partNumber, ...input.families].filter((p): p is string => !!p && !!p.trim())
  // A record that is a file name echoed back ('microchip-atmega328p_DS-revA': a maker word, a stop word) is not a part, nor is its
  // normalized twin; nor is a short tail of the file's own part ('A12' of GRM188R71C105KA12).
  const noisy = (p: string) => {
    const ws = p.split(/[-_\s]+/).filter(Boolean)
    return ws.length > 1 && (ws.some(w => STOP.test(w) || LITERATURE.test(w)) || !!MAKER_PREFIXES[ws[0]!.toLowerCase()])
  }
  const echoes = new Set([...recordsRaw.filter(noisy), ...(noisy(fileStem) ? [fileStem] : [])].map(normPart))
  const echo = (p: string) => noisy(p) || echoes.has(normPart(p))
  const fragment = (p: string) => !!file.part && normPart(p).length <= 4 && normPart(file.part).length > normPart(p).length && normPart(file.part).endsWith(normPart(p))
  const records = recordsRaw.filter(p => !echo(p) && !fragment(p))
  const display = (p: string) => (/[a-z]/.test(p) && !/[A-Z]/.test(p) ? p.toUpperCase() : p)
  const family: string[] = []
  for (const p of [...fromTitle, ...records.map(display)]) if (!family.some(f => normPart(f) === normPart(p))) family.push(p)
  let part: string | null = null
  let partBy = 'records'
  const fileHit = file.part ? family.find(f => normPart(f) === normPart(file.part!)) : undefined
  if (fileHit) { part = fileHit; partBy = records.some(r => normPart(r) === normPart(fileHit)) ? 'records' : fromTitle.length ? 'title' : 'file name' }
  else if (records.length) part = display(records[0]!)
  else if (fromTitle.length) { part = fromTitle[0]!; partBy = 'title' }
  else if (file.part) { part = file.part; partBy = 'file name' }
  if (part && !family.some(f => normPart(f) === normPart(part!))) family.unshift(part)
  // The maker: the records', unless they only guessed it from a part prefix and the file's maker word says otherwise.
  let maker = input.maker?.trim() || null
  let makerBy = maker ? (input.makerBy && input.makerBy !== 'none' ? input.makerBy : 'records') : null
  const guessed = makerBy === 'part-prefix'
  if (file.maker && (!maker || (guessed && normPart(file.maker) !== normPart(maker)))) { maker = file.maker; makerBy = 'file name' }
  return { part, family: family.length > 1 ? family : [], partBy, maker, makerBy }
}

/** 'datasheet' → 'Datasheet', 'reference_manual' → 'Reference manual', 'app-note' → 'Application note'. */
export function documentTypeWords(type: string | null): string | null {
  if (!type || !type.trim() || /^unknown$/i.test(type)) return null
  const t = type.trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (t === 'app note') return 'Application note'
  return t.charAt(0).toUpperCase() + t.slice(1)
}
