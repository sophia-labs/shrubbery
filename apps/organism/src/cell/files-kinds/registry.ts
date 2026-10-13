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

/** What a kind's functions read: the edition's fields and its items, decoded. */
export interface KindRecord {
  readonly f: Readonly<Record<string, string | null>>
  readonly items: readonly KindItem[]
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
  /** Where the assertion stands: read (nothing asks for a look), to check, checked by a person, corrected by a person, contested. */
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
}

/** A kind's margin (reader record beside the file): the cell tool that returns it, and how it reads. */
export interface FileKindMargin {
  /** Heading of the margin ('What was read'). */
  readonly title: string
  readonly tool: string
  readonly args: (graphId: string, artifactId: string) => Record<string, unknown>
  /** Defensive: the cell may be older or newer than this code. */
  readonly read: (raw: Record<string, unknown>, artifactId: string) => MarginReading
  /** The file's id from one of this kind's evidence ids (a claim id: 'ds-ab12-params-vin'), for deep links. */
  readonly artifactOf?: (evidenceId: string) => string | null
}

export interface FileKind {
  readonly id: string
  /** The file-type captions the kind may recognize ('PDF'); absent: any file. Spares the query files that cannot be of the kind. */
  readonly captions?: readonly string[]
  /** How a resource is recognized: a pattern about `{ed}` (its RDF type, or a predicate), inside the import's named graph. */
  readonly recognize: string
  /** The edition's optional fields: name → predicate. The artifact link (`de:artifact`) is the registry's. */
  readonly fields: Readonly<Record<string, string>>
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
  /** The kind's predicate for the Needs a look filter. */
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

function itemOf(rows: readonly Row[], kind: FileKind): KindItem {
  const get = (field: string) => rows.map(r => termText(r[variable(kind, field)])).filter((v): v is string => v !== null)
  return { one: field => get(field)[0] ?? null, all: get, local: field => { const v = get(field)[0]; return v ? localName(v) : '' } }
}

const STATES: readonly ReadState[] = ['queued', 'reading', 'read', 'failed']

function num(text: string | null): number {
  const n = text === null ? NaN : Number(text)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

/** The rows of the batched query, as evidence per artifact id. Artifacts no kind recognized are absent. */
export function readEvidence(kinds: readonly FileKind[], rows: readonly Row[]): Map<string, FileEvidence> {
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
    const record: KindRecord = { f, items: [...groups.values()].map(g => itemOf(g, kind)) }
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
