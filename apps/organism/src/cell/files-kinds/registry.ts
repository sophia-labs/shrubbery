/**
 * The kind registry: Files stays generic, and a kind brings what a file of that kind needs, as data.
 *
 * Like Finder: a kind is its own importer's reading (what the records look like, so what to ask for) and its own Quick Look (what the
 * card, the list columns and the status line say). The shell asks for every kind at once, in ONE batched SPARQL query per visible
 * place, every pattern inside `GRAPH ?g { ... }` (cell stores are partitioned by named graph: an unwrapped pattern returns nothing).
 * The card, the list and the status line read only the `FileEvidence` this module hands them; a file no kind recognizes has none and
 * keeps today's card.
 *
 *   const paperKind: FileKind = {
 *     id: 'paper', captions: ['PDF'], recognize: '{ed} a de:DocumentEdition ; de:docType "paper"',
 *     fields: { title: 'de:title', authors: 'de:authors', year: 'de:year' },
 *     card: { title: r => r.f.title ?? '', subtitle: r => [{ text: r.f.authors ?? '' }], values: () => [], doneBadge: r => r.f.year ?? 'Read' },
 *     columns: [{ header: 'Title', cell: r => ({ text: r.f.title ?? '' }) }], lookable: () => false, summary: () => '', status: {},
 *   }
 *
 * Variables are namespaced by the kind (`?paper_title`), so two kinds never collide. `{name}` inside a pattern means that kind's
 * variable; `{ed}`, `{artifact}` and `{it}` (an item of the edition) are the kind's own too.
 */
import {
  localName, type Corroboration, type FileEvidence, type FileInfoSection, type FileEvidenceCell, type FileEvidenceSubtitle, type FileEvidenceValue, type ReadState,
} from '@shrubbery/nucleus'
import type { FilesPageBody } from '@shrubbery/runtime'

export const PREFIXES = {
  de: 'https://sophia-labs.ai/ontology/document-evidence#',
  eng: 'https://sophia-labs.ai/ontology/engineering#',
} as const

type Row = Readonly<Record<string, unknown>>

/** The decoded literal of an N-Triples term (`<iri>`, `"text"`, `"1.8"^^<xsd:decimal>`), or null. */
export function termText(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null
  if (raw.startsWith('<') && raw.endsWith('>')) return raw.slice(1, -1)
  if (!raw.startsWith('"')) return raw
  let escaped = false
  for (let i = 1; i < raw.length; i++) {
    const c = raw[i]
    if (escaped) { escaped = false; continue }
    if (c === '\\') { escaped = true; continue }
    if (c === '"') {
      try { return JSON.parse(raw.slice(0, i + 1)) as string } catch { return raw.slice(1, i) }
    }
  }
  return raw
}

/** One repeated record of an edition (a datasheet's key parameter), with every row that stated it. */
export interface KindItem {
  /** The first value of the field, or null. */
  one(field: string): string | null
  /** Every value of the field across the rows that stated this item. */
  all(field: string): readonly string[]
  /** The local name of an IRI field. */
  local(field: string): string
}

/** What a kind's functions read: the edition's fields and its items, decoded; and its lists (every value of a repeated field). */
export interface KindRecord {
  readonly f: Readonly<Record<string, string | null>>
  readonly items: readonly KindItem[]
  readonly lists?: Readonly<Record<string, readonly string[]>>
}

export interface FileKindColumn {
  readonly header: string
  readonly width?: string
  readonly cell: (r: KindRecord) => Omit<FileEvidenceCell, 'header' | 'width'>
}

/** One fact in the margin's header ('Maker' · 'Texas Instruments'), with how we know it when the records say. */
export interface MarginFact { readonly label: string; readonly text: string; readonly hint?: string }

/** One thing the reader read from a page: a row of the margin, and of the table. */
export interface MarginRowData {
  readonly id: string
  /** The group it sits in (`MarginReading.groups`). */
  readonly group: string
  readonly label: string
  /** The symbol as printed ('VIN'), '' when it is none or is the label again. */
  readonly symbol: string
  /** '4.5–28 V', '≤ 28 V', '1.2 typ · 0.9–1.5 V'; '' when no value was read. */
  readonly value: string
  readonly page: number | null
  readonly mark: Corroboration
  /** The readers disagreed about this one. */
  readonly contested: boolean
  readonly key: boolean
  /** Where the assertion stands: read, checked by a person, corrected by a person, or contested (the readers disagreed). */
  readonly status: 'read' | 'check' | 'checked' | 'corrected' | 'contested'
  /** The numbers the claim states (min, typ, max) as printed: what the viewer looks for on the page to box the row. */
  readonly numbers: readonly number[]
  /** Where the claim says it is: the sections of its table, in words (the margin's group title). */
  readonly sectionTitle: string
  /** Other pages its separate readings were read on (where to look when its own page does not print it). */
  readonly readingPages: readonly number[]
  readonly conditions: readonly string[]
  /** Each separate reading of it: the words, and the page it was read on. */
  readonly readings: readonly { readonly text: string; readonly page: number | null }[]
  /** Diagnostics and checks, in plain words. */
  readonly notes: readonly string[]
  /** Where the PDF prints it, when the records know the box (a seam: nothing draws it yet). */
  readonly box?: { readonly page: number; readonly l: number; readonly b: number; readonly r: number; readonly t: number }
  readonly precision?: string
  readonly method?: string
  /** Verbs the row offers (the seam for Check and Correct); none while the margin is read-only. */
  readonly actions?: readonly { readonly id: string; readonly label: string }[]
  /** The value's slots as printed ('0.00008', '−40'), '' when the slot is empty, and its unit: the table's columns. */
  readonly slots?: { readonly min: string; readonly typ: string; readonly max: string }
  readonly unit?: string
  /** The table's own heading this row sits under ('Audio performance'), '' when none. */
  readonly subgroup?: string
  /** The row's own conditions as printed ('f = 1 kHz, G = 1'), '' when none. */
  readonly when?: string
  /** Why it is disputed, in words ('The readers disagree: prose read ?–28, ROC table read 3.5–28.'), when it is. */
  readonly dispute?: string
}

export interface MarginGroup { readonly id: string; readonly title: string; readonly tag?: string }

/** What a kind's reader says about an open file, in the one shape the margin and the table draw (kinds that read nothing have none). */
export interface MarginReading {
  readonly title: string
  readonly facts: readonly MarginFact[]
  /** The document's own diagnostics, in plain words. */
  readonly notes: readonly string[]
  readonly groups: readonly MarginGroup[]
  readonly rows: readonly MarginRowData[]
  /** Said, plainly, when there are no rows ('Text only: no tables were read.'). */
  readonly empty: string | null
  /** Said when the cell cut the rows off. */
  readonly truncated: string | null
  readonly pageCount: number | null
  /** Who and what the records say the document is, as they say it (the display reconciles it with the file name: `datasheet-words.ts`). */
  readonly identity?: {
    readonly title: string | null; readonly parts: readonly string[]; readonly maker: string | null; readonly makerBy: string | null
    readonly revision: string | null; readonly documentType: string | null; readonly literature: string | null
  }
  /** The reading as a whole: the reader's tools and what it reported, in plain facts (About this reading). */
  readonly about?: readonly MarginFact[]
  /** What became of the rows the reader handed over: table headings told apart, repeats folded, disputes counted. */
  readonly counts?: { readonly rows: number; readonly keys: number; readonly headings: number; readonly repeats: number; readonly disputed: number }
}

/** A kind's margin (reader record beside the file): the cell tool that returns it, and how it reads. */
export interface FileKindMargin {
  /** Heading of the margin ('What was read'). */
  readonly title: string
  readonly tool: string
  readonly args: (graphId: string, artifactId: string) => Record<string, unknown>
  /** Defensive: the cell may be older or newer than this code. */
  readonly read: (raw: Record<string, unknown>, artifactId: string, context?: { readonly fileName?: string }) => MarginReading
  /** The file's id from one of this kind's evidence ids (a claim id: 'ds-ab12-params-vin'), for deep links. */
  readonly artifactOf?: (evidenceId: string) => string | null
}

// --- the info page: sections as data ----------------------------------------------------------------------------------------------------

/**
 * The closed catalogue of the info page's faces. Data picks a face and never supplies code (the FaceRegistry law of
 * plans/2026-09-25-document-primitives.md §3): a rule naming a face outside this list is refused whole.
 */
export const INFO_FACES = ['facts', 'values', 'notes', 'table', 'links', 'source'] as const
export type InfoFace = typeof INFO_FACES[number]

/**
 * One section of a file's info page, as data: which face draws it, where it sits, whether it starts folded. Shaped like a `sux:FaceRule`
 * (`view:face`, `sux:displayOrder`) so the standard set can move into a published `sophia-standard` revision snapshot without changing
 * its consumers (plans/2026-09-22-sophia-standard-layout-slots.md); until then it is code-resolved here.
 */
export interface InfoSectionRule {
  readonly id: string
  readonly title: string
  readonly order: number
  /** Folded until the person opens it. */
  readonly collapsed: boolean
  readonly face: InfoFace
}

/** A kind's rule: a new section in full, or a shadow of a standard one by id (only the fields it names change). */
export type InfoSectionOverride = Partial<InfoSectionRule> & { readonly id: string }

/** The standard sector: what every file's page has, whatever its kind. */
export const STANDARD_INFO_SECTIONS: readonly InfoSectionRule[] = Object.freeze([
  { id: 'source', title: 'Contents', order: 10, collapsed: false, face: 'source' },
  { id: 'notes', title: 'Your notes', order: 50, collapsed: false, face: 'notes' },
  { id: 'about', title: 'About this file', order: 80, collapsed: true, face: 'facts' },
  { id: 'connections', title: 'Connections', order: 90, collapsed: true, face: 'links' },
])

/**
 * The sections of a page: the standard ones, each shadowed by the kind's rule of the same id, then the kind's own, in order. A rule that
 * names no face of the catalogue, or a new section without a title, is refused whole and reported (never half admitted).
 */
export function resolveInfoSections(kindRules: readonly InfoSectionOverride[] = [], standard: readonly InfoSectionRule[] = STANDARD_INFO_SECTIONS):
  { readonly sections: readonly InfoSectionRule[]; readonly refused: readonly string[] } {
  const out = new Map(standard.map(r => [r.id, r]))
  const refused: string[] = []
  for (const rule of kindRules) {
    const base = out.get(rule.id)
    const merged = { ...base, ...rule } as Partial<InfoSectionRule>
    const ok = typeof merged.title === 'string' && merged.title.length > 0 && typeof merged.order === 'number' && typeof merged.collapsed === 'boolean'
      && (INFO_FACES as readonly string[]).includes(merged.face ?? '')
    if (!ok) { refused.push(rule.id); continue }
    out.set(rule.id, merged as InfoSectionRule)
  }
  return { sections: [...out.values()].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1)), refused }
}

/**
 * A file that belongs to another rather than sitting beside it: what a reader wrote for a PDF (its text, its data), or a person's notes on
 * it. Found by its relation to its file, so Files can hide it from the place and the file's page can still reach it. Data, like the
 * sections: an id that is the file's id with a suffix or a prefix, or a name that is the file's stem with an ending.
 */
export interface CompanionRule {
  readonly role: string
  /** What it is, in words, on the file's page ('The text the reader read'). */
  readonly label: string
  readonly entry: 'artifact' | 'document'
  readonly idSuffix?: string
  readonly idPrefix?: string
  readonly nameSuffix?: string
}

/** The standard companion: a person's notes on a file are the document `notes-<file id>`. */
export const NOTES_PREFIX = 'notes-'
export const STANDARD_COMPANIONS: readonly CompanionRule[] = Object.freeze([
  { role: 'notes', label: 'Your notes', entry: 'document', idPrefix: NOTES_PREFIX },
])

/** What a kind hands its page: the file, the reading, the kind's own queries' rows and the tree's names. */
export interface KindPageInput {
  readonly artifactId: string
  readonly fileName: string
  /** The words typed in the page's filter (the table face). */
  readonly filter: string
  readonly reading: MarginReading | null
  readonly readingStatus: 'none' | 'loading' | 'ready' | 'error'
  readonly readingError: string
  readonly evidence: FileEvidence | undefined
  /** The rows of each of the kind's page queries, by query id (empty while asked). */
  readonly rows: Readonly<Record<string, readonly Row[]>>
  /** Every file and document of the graph (for Related): its tree key, name and kind. */
  readonly tree: readonly { readonly key: string; readonly id: string; readonly label: string; readonly kind: 'artifact' | 'document' }[]
  /** This file's companions, found in the tree. */
  readonly companions: readonly { readonly key: string; readonly label: string; readonly role: string; readonly roleLabel: string }[]
}

/** What a kind's page says: its head, and the bodies of its own sections by id (the page draws them with their faces). */
export interface KindPageContent {
  readonly head: {
    readonly title: string
    readonly chips: readonly { readonly text: string; readonly current?: boolean; readonly title?: string }[]
    readonly lines: readonly { readonly text: string; readonly title?: string }[]
  } | null
  readonly bodies: Readonly<Record<string, FilesPageBody | null>>
  /** Counts beside section titles ('56'), by section id. */
  readonly counts?: Readonly<Record<string, string>>
  /** A sentence under a section title, by id. */
  readonly notes?: Readonly<Record<string, string>>
  /** Sections with nothing to say for this file (an errata has no table): not drawn. */
  readonly hidden?: readonly string[]
}

/** A kind's page: its section rules, the graph queries it reads (per file or per graph), and how it turns them into bodies. */
export interface FileKindPage {
  readonly sections: readonly InfoSectionOverride[]
  /** SPARQL queries by id; `scope: 'graph'` is asked once per graph and shared by every page, `file` once per opened file. */
  readonly queries?: readonly { readonly id: string; readonly scope: 'graph' | 'file'; readonly query: (artifactId: string) => string }[]
  readonly content: (input: KindPageInput) => KindPageContent
  /** The kind's companions (what its reader writes beside a file). */
  readonly companions?: readonly CompanionRule[]
}

export interface FileKind {
  readonly id: string
  /** The file-type captions the kind may recognize ('PDF'); absent: any file. Spares the query files that cannot be of the kind. */
  readonly captions?: readonly string[]
  /** How a resource is recognized: a pattern about `{ed}` (its RDF type, or a predicate), inside the import's named graph. */
  readonly recognize: string
  /** The edition's optional fields: name → predicate. The artifact link (`de:artifact`) is the registry's. */
  readonly fields: Readonly<Record<string, string>>
  /**
   * Repeated values of the edition (the parts a sheet covers): name → a pattern from `{ed}` to `{value}`. Asked in a second batched query
   * per place, so they never multiply the rows of the first.
   */
  readonly lists?: Readonly<Record<string, string>>
  /** Repeated records of the edition (key parameters): a pattern about `{it}`, its fields, the one that must be bound, and what follows. */
  readonly items?: {
    readonly pattern: string
    readonly fields: Readonly<Record<string, string>>
    /** Variables the pattern or `after` binds itself (selected, not optional): the key among them. */
    readonly vars?: readonly string[]
    /** The field that identifies an item: rows with the same value are one item; none bound, no item. */
    readonly key: string
    /** A pattern after the graph (a person's checks live in another graph), e.g. `OPTIONAL { GRAPH ?g2 { ... {it} ... } }`. */
    readonly after?: string
  }
  readonly card: {
    readonly title: (r: KindRecord) => string
    readonly subtitle: (r: KindRecord) => readonly FileEvidenceSubtitle[]
    /** How the key values are chosen (by product type for a datasheet, with the fallback). */
    readonly values: (r: KindRecord) => readonly FileEvidenceValue[]
    /** The badge once read. */
    readonly doneBadge: (r: KindRecord) => string
    readonly badgeTone?: (r: KindRecord) => 'attention' | 'danger' | undefined
  }
  /** The list's columns after Name and Type, with their headers. */
  readonly columns: readonly FileKindColumn[]
  /** The kind's margin beside the open file (what was read from it); absent: the file opens alone. */
  readonly margin?: FileKindMargin
  /** The kind's own block of the Show info panel; absent: the kind adds nothing there. */
  readonly info?: (r: KindRecord) => readonly FileInfoSection[]
  /** The kind's sections of the file's info page; absent: the page has the standard sections only. */
  readonly page?: FileKindPage
  /** The kind's predicate for the Disputed filter: values the readers disagreed on. */
  readonly lookable: (r: KindRecord) => boolean
  /** After 'Read name: ' on the status line. */
  readonly summary: (r: KindRecord) => string
  /** The read-progress fields of the edition (the importer's, and later the read job's): names of `fields`. */
  readonly status: {
    readonly state?: string
    readonly page?: string
    readonly pages?: string
    readonly error?: string
  }
}

const safe = (id: string) => id.replace(/[^A-Za-z0-9]/g, '_')
const variable = (kind: FileKind, name: string) => `${safe(kind.id)}_${name}`
const bind = (kind: FileKind, text: string) => text.replace(/\{(\w+)\}/g, (_, n: string) => `?${variable(kind, n)}`)

/** Every variable a kind selects. */
function variablesOf(kind: FileKind): string[] {
  return [...Object.keys(kind.fields), ...Object.keys(kind.items?.fields ?? {}), ...(kind.items?.vars ?? []), ...(kind.items ? ['it'] : [])].map(n => variable(kind, n))
}

/** Cap on rows read per artifact (a datasheet keeps at most 40 key parameters, 5 readings each, and the query reads derivations). */
const ROWS_PER_ARTIFACT = 60

export function kindsMatching(kinds: readonly FileKind[], caption: string): FileKind[] {
  return kinds.filter(k => !k.captions || k.captions.includes(caption))
}

/** The one query for a place: every given artifact, every kind, one `GRAPH ?g { ... }` per kind branch. */
export function evidenceQuery(kinds: readonly FileKind[], artifactIds: readonly string[]): string {
  const values = artifactIds.map(id => JSON.stringify(id)).join(' ')
  const vars = kinds.flatMap(variablesOf).map(v => `?${v}`)
  const branches = kinds.map(kind => {
    const ed = `?${variable(kind, 'ed')}`
    const fields = Object.entries(kind.fields).map(([name, pred]) => `    OPTIONAL { ${ed} ${pred} ?${variable(kind, name)} }`).join('\n')
    const items = kind.items ? `    OPTIONAL {
      ${bind(kind, kind.items.pattern)} .
${Object.entries(kind.items.fields).map(([name, pred]) => `      OPTIONAL { ?${variable(kind, 'it')} ${pred} ?${variable(kind, name)} }`).join('\n')}
    }` : ''
    return `  {
    GRAPH ?g {
      ${bind(kind, kind.recognize)} .
      ${ed} de:artifact ?artifact .
${fields}
${items}
    }
${kind.items?.after ? `    ${bind(kind, kind.items.after)}` : ''}
    BIND(${JSON.stringify(kind.id)} AS ?kind)
  }`
  }).join('\n  UNION\n')
  return `PREFIX de: <${PREFIXES.de}>
PREFIX eng: <${PREFIXES.eng}>
SELECT ?artifact ?kind ${vars.join(' ')}
WHERE {
  VALUES ?artifact { ${values} }
${branches}
}
ORDER BY ?artifact
LIMIT ${Math.max(1, artifactIds.length) * ROWS_PER_ARTIFACT}`
}

/** The second query for a place: every kind's lists, one `GRAPH ?g { ... }` branch per (kind, list); null when no kind has a list. */
export function listsQuery(kinds: readonly FileKind[], artifactIds: readonly string[]): string | null {
  const branches = kinds.flatMap(kind => Object.entries(kind.lists ?? {}).map(([name, pattern]) => `  {
    GRAPH ?g {
      ${bind(kind, kind.recognize)} .
      ?${variable(kind, 'ed')} de:artifact ?artifact .
      ${bind(kind, pattern).replace(new RegExp(`\\?${variable(kind, 'value')}\\b`, 'g'), '?value')} .
    }
    BIND(${JSON.stringify(kind.id)} AS ?kind)
    BIND(${JSON.stringify(name)} AS ?list)
  }`))
  if (!branches.length || !artifactIds.length) return null
  return `PREFIX de: <${PREFIXES.de}>
PREFIX eng: <${PREFIXES.eng}>
SELECT DISTINCT ?artifact ?kind ?list ?value
WHERE {
  VALUES ?artifact { ${artifactIds.map(id => JSON.stringify(id)).join(' ')} }
${branches.join('\n  UNION\n')}
}
LIMIT ${Math.max(1, artifactIds.length) * 40}`
}

function itemOf(rows: readonly Row[], kind: FileKind): KindItem {
  const get = (field: string) => rows.map(r => termText(r[variable(kind, field)])).filter((v): v is string => v !== null)
  return { one: field => get(field)[0] ?? null, all: get, local: field => { const v = get(field)[0]; return v ? localName(v) : '' } }
}

const STATES: readonly ReadState[] = ['queued', 'reading', 'read', 'failed']

function num(text: string | null): number {
  const n = text === null ? NaN : Number(text)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

/** The rows of the batched query (and of the lists query), as evidence per artifact id. Artifacts no kind recognized are absent. */
export function readEvidence(kinds: readonly FileKind[], rows: readonly Row[], listRows: readonly Row[] = []): Map<string, FileEvidence> {
  const lists = new Map<string, Record<string, string[]>>()
  for (const row of listRows) {
    const id = termText(row.artifact), kind = termText(row.kind), list = termText(row.list), value = termText(row.value)
    if (!id || !kind || !list || !value) continue
    const at = lists.get(`${kind}|${id}`) ?? {}
    const values = at[list] ?? []
    if (!values.includes(value)) values.push(value)
    at[list] = values
    lists.set(`${kind}|${id}`, at)
  }
  const byArtifact = new Map<string, Row[]>()
  for (const row of rows) {
    const id = termText(row.artifact)
    if (!id) continue
    const list = byArtifact.get(id)
    if (list) list.push(row); else byArtifact.set(id, [row])
  }
  const out = new Map<string, FileEvidence>()
  for (const [id, list] of byArtifact) {
    // The first kind that recognized the artifact reads it.
    const kind = kinds.find(k => list.some(r => termText(r.kind) === k.id))
    if (!kind) continue
    const mine = list.filter(r => termText(r.kind) === kind.id)
    const head = mine[0]!
    const f: Record<string, string | null> = {}
    for (const name of Object.keys(kind.fields)) f[name] = termText(head[variable(kind, name)])
    const groups = new Map<string, Row[]>()
    if (kind.items) {
      for (const row of mine) {
        const key = termText(row[variable(kind, kind.items.key)])
        if (key === null) continue
        const g = groups.get(key)
        if (g) g.push(row); else groups.set(key, [row])
      }
    }
    const record: KindRecord = { f, items: [...groups.values()].map(g => itemOf(g, kind)), lists: lists.get(`${kind.id}|${id}`) ?? {} }
    const stateWord = kind.status.state ? f[kind.status.state] : null
    const state: ReadState = STATES.find(s => s === stateWord) ?? 'read'
    const page = kind.status.page ? num(f[kind.status.page] ?? null) : 0
    const pages = kind.status.pages ? num(f[kind.status.pages] ?? null) : 0
    const error = kind.status.error ? f[kind.status.error] : null
    const tone = kind.card.badgeTone?.(record)
    const info = kind.info?.(record)
    out.set(id, {
      kind: kind.id, title: kind.card.title(record), subtitle: kind.card.subtitle(record), values: kind.card.values(record).slice(0, 3),
      state, doneBadge: kind.card.doneBadge(record), summary: kind.summary(record), lookable: kind.lookable(record),
      cells: kind.columns.map(c => ({ header: c.header, ...(c.width ? { width: c.width } : {}), ...c.cell(record) })),
      ...(tone ? { badgeTone: tone } : {}),
      ...(info?.length ? { info } : {}),
      ...(state === 'reading' && pages > 0 ? { progress: { page, pages } } : {}),
      ...(error ? { error } : {}),
    })
  }
  return out
}
