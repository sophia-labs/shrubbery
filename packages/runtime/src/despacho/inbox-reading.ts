/**
 * inbox-reading.ts — el Despacho W4: the PURE reading of one viewer's inbox
 * (plans/2026-09-15-despacho-operational-memo.md §2 "Communicate", §3 W4).
 *
 * An inbox is everything that waits on a person, and nothing else:
 *   1. gates awaiting their word — open gate beads whose `cta:owner` is the
 *      viewer's office name (cuentas names holders by office: "vera", "demi";
 *      never by seat IRI), ready ones first (ready is COMPUTED: every
 *      `needs`/`gatedBy` target done — an unknown target counts as NOT done);
 *   2. unanswered letters — questions and requests addressed to the seats the
 *      viewer convenes, with no reply pointing at them and no acknowledgement
 *      (the register's own two ways of answering);
 *   3. returns to read — accounts (Rendiciones) newest first, EXCEPT those the
 *      viewer has already read by their own testimony (a `cta:Lectura`,
 *      cuentas v0.3.0) or rendered themselves (their own word).
 *
 * Read-state is never a system flag: it is the reader's dated claim, and the
 * inbox clears by it. Data-only: no DOM, no network. The queries name their
 * graphs explicitly (`GRAPH <…:projection:cuentas>`) so a room mirror (S0)
 * answers them locally.
 */
import { plainQueryBlockTermValue, type QueryBlockResult } from '../editor-services/query-block-service.js'
import { CTA_NS } from './cuenta-reading.js'
// The correo namespace has ONE owner in this package (W2's seat reading); a
// second copy here would be a second place to be wrong.
import { COR_NS } from './seat-reading.js'

export const INBOX_MAX_ROWS = 200

export function cuentasGraphIri(graphId: string): string {
  return `urn:mnemosyne:local:graph:${graphId}:projection:cuentas`
}
export function correoGraphIri(graphId: string): string {
  return `urn:mnemosyne:local:graph:${graphId}:projection:correo`
}

/** A SPARQL string literal with backslash, quote and line breaks escaped — the ONE way an office name or a reader enters a query. */
export function sparqlStringLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`
}

function iri(value: string): string {
  return `<${value}>`
}

export interface InboxBlocker {
  readonly target: string
  readonly status: string | null
}

export interface InboxGate {
  readonly iri: string
  readonly title: string
  readonly priority: number | null
  readonly createdAt: string | null
  readonly blockers: readonly InboxBlocker[]
  /** open ∧ every blocker done. */
  readonly ready: boolean
}

export interface InboxLetter {
  readonly iri: string
  readonly from: string
  readonly fromTitle: string | null
  readonly to: string
  readonly kind: string
  readonly at: string
  readonly excerpt: string | null
  readonly conversation: string | null
}

export interface InboxReturn {
  readonly iri: string
  readonly forCuenta: string
  readonly forTitle: string | null
  readonly verdict: string
  readonly witness: string
  readonly summary: string
  readonly renderedAt: string | null
  readonly word: string | null
}

export interface InboxReading {
  readonly owner: string
  readonly seats: readonly string[]
  /** The reader whose Lecturas clear the returns; '' when the session has no viewer identity (then nothing clears, and the view says so). */
  readonly reader: string
  readonly gates: readonly InboxGate[]
  readonly letters: readonly InboxLetter[]
  readonly returns: readonly InboxReturn[]
  readonly counts: { readonly gates: number; readonly ready: number; readonly letters: number; readonly returns: number }
}

/** Open gates held by `owner` with each `needs`/`gatedBy` target's own status (one row per gate × blocker; a gate with no blocker is one row). */
export function inboxGatesQuery(cuentasGraph: string, owner: string): string {
  return (
    `SELECT ?gate ?title ?priority ?createdAt ?dep ?depStatus WHERE { GRAPH ${iri(cuentasGraph)} { ` +
    `?gate <${CTA_NS}beadKind> "gate" ; <${CTA_NS}status> "open" ; <${CTA_NS}owner> ${sparqlStringLiteral(owner)} ; <${CTA_NS}title> ?title . ` +
    `OPTIONAL { ?gate <${CTA_NS}priority> ?priority } OPTIONAL { ?gate <${CTA_NS}createdAt> ?createdAt } ` +
    `OPTIONAL { ?gate ?edge ?dep . VALUES ?edge { <${CTA_NS}needs> <${CTA_NS}gatedBy> } OPTIONAL { ?dep <${CTA_NS}status> ?depStatus } } ` +
    `} } ORDER BY ?priority ?createdAt ?gate LIMIT ${INBOX_MAX_ROWS * 4}`
  )
}

/** Questions and requests addressed to any of `seats` with no reply and no acknowledgement, newest first. */
export function inboxLettersQuery(correoGraph: string, seats: readonly string[]): string {
  const values = seats.map(iri).join(' ')
  return (
    `SELECT ?letter ?from ?fromTitle ?to ?kind ?at ?excerpt ?conversation WHERE { GRAPH ${iri(correoGraph)} { ` +
    `VALUES ?to { ${values} } VALUES ?kind { "question" "request" } ` +
    `?letter <${COR_NS}to> ?to ; <${COR_NS}from> ?from ; <${COR_NS}letterKind> ?kind ; <${COR_NS}at> ?at . ` +
    `OPTIONAL { ?letter <${COR_NS}excerpt> ?excerpt } OPTIONAL { ?letter <${COR_NS}conversation> ?conversation } OPTIONAL { ?from <${COR_NS}title> ?fromTitle } ` +
    `FILTER NOT EXISTS { ?reply <${COR_NS}replyTo> ?letter } FILTER NOT EXISTS { ?ack <${COR_NS}acknowledges> ?letter } ` +
    `} } ORDER BY DESC(?at) ?letter LIMIT ${INBOX_MAX_ROWS}`
  )
}

/**
 * Accounts newest first, minus those the reader has read (a `cta:Lectura`
 * by this reader) and those the reader rendered themselves (their witness
 * IS the reader). An empty reader clears nothing.
 */
export function inboxReturnsQuery(cuentasGraph: string, reader: string): string {
  const readerLit = sparqlStringLiteral(reader)
  return (
    `SELECT ?r ?forCuenta ?forTitle ?verdict ?witness ?summary ?renderedAt ?word WHERE { GRAPH ${iri(cuentasGraph)} { ` +
    `?r <${CTA_NS}forCuenta> ?forCuenta ; <${CTA_NS}verdict> ?verdict ; <${CTA_NS}witness> ?witness ; <${CTA_NS}summary> ?summary . ` +
    `OPTIONAL { ?r <${CTA_NS}renderedAt> ?renderedAt } OPTIONAL { ?r <${CTA_NS}word> ?word } OPTIONAL { ?forCuenta <${CTA_NS}title> ?forTitle } ` +
    (reader
      ? `FILTER(?witness != ${readerLit}) FILTER NOT EXISTS { ?lectura <${CTA_NS}forRendicion> ?r ; <${CTA_NS}reader> ${readerLit} } `
      : '') +
    `} } ORDER BY DESC(?renderedAt) ?r LIMIT ${INBOX_MAX_ROWS}`
  )
}

/** A bindings row exactly as the query service renders it — never a second spelling of its term type. */
type Row = Extract<QueryBlockResult, { resultKind: 'bindings' }>['rows'][number]

function rows(result: QueryBlockResult): readonly Row[] {
  return result.resultKind === 'bindings' ? result.rows : []
}

function text(row: Row, name: string): string | null {
  const term = row[name]
  return term ? plainQueryBlockTermValue(term) : null
}

function readGates(result: QueryBlockResult): InboxGate[] {
  const byGate = new Map<string, { title: string; priority: number | null; createdAt: string | null; blockers: InboxBlocker[] }>()
  for (const row of rows(result)) {
    const gate = text(row, 'gate')
    if (!gate) continue
    let entry = byGate.get(gate)
    if (!entry) {
      const priorityRaw = text(row, 'priority')
      const priority = priorityRaw !== null && Number.isFinite(Number(priorityRaw)) ? Number(priorityRaw) : null
      entry = { title: text(row, 'title') ?? gate, priority, createdAt: text(row, 'createdAt'), blockers: [] }
      byGate.set(gate, entry)
    }
    const dep = text(row, 'dep')
    if (dep && !entry.blockers.some((b) => b.target === dep)) entry.blockers.push({ target: dep, status: text(row, 'depStatus') })
  }
  const gates: InboxGate[] = [...byGate.entries()].map(([gateIri, entry]) => ({
    iri: gateIri,
    title: entry.title,
    priority: entry.priority,
    createdAt: entry.createdAt,
    blockers: entry.blockers,
    ready: entry.blockers.every((b) => b.status === 'done'),
  }))
  // Ready first; then priority (0 highest, unknown last); then oldest first; then id.
  gates.sort((a, b) => {
    if (a.ready !== b.ready) return a.ready ? -1 : 1
    const pa = a.priority ?? Number.POSITIVE_INFINITY
    const pb = b.priority ?? Number.POSITIVE_INFINITY
    if (pa !== pb) return pa - pb
    const ca = a.createdAt ?? ''
    const cb = b.createdAt ?? ''
    if (ca !== cb) return ca < cb ? -1 : 1
    return a.iri < b.iri ? -1 : a.iri > b.iri ? 1 : 0
  })
  return gates
}

function readLetters(result: QueryBlockResult): InboxLetter[] {
  const seen = new Set<string>()
  const letters: InboxLetter[] = []
  for (const row of rows(result)) {
    const letter = text(row, 'letter')
    if (!letter || seen.has(letter)) continue
    seen.add(letter)
    letters.push({
      iri: letter,
      from: text(row, 'from') ?? '',
      fromTitle: text(row, 'fromTitle'),
      to: text(row, 'to') ?? '',
      kind: text(row, 'kind') ?? 'observation',
      at: text(row, 'at') ?? '',
      excerpt: text(row, 'excerpt'),
      conversation: text(row, 'conversation'),
    })
  }
  return letters
}

function readReturns(result: QueryBlockResult): InboxReturn[] {
  const seen = new Set<string>()
  const returns: InboxReturn[] = []
  for (const row of rows(result)) {
    const r = text(row, 'r')
    if (!r || seen.has(r)) continue
    seen.add(r)
    returns.push({
      iri: r,
      forCuenta: text(row, 'forCuenta') ?? '',
      forTitle: text(row, 'forTitle'),
      verdict: text(row, 'verdict') ?? '',
      witness: text(row, 'witness') ?? '',
      summary: text(row, 'summary') ?? '',
      renderedAt: text(row, 'renderedAt'),
      word: text(row, 'word'),
    })
  }
  return returns
}

/** Pure fold of the three real results into one reading. */
export function readInbox(
  owner: string,
  seats: readonly string[],
  reader: string,
  gatesResult: QueryBlockResult,
  lettersResult: QueryBlockResult,
  returnsResult: QueryBlockResult,
): InboxReading {
  const gates = readGates(gatesResult)
  const letters = readLetters(lettersResult)
  const returns = readReturns(returnsResult)
  return {
    owner,
    seats,
    reader,
    gates,
    letters,
    returns,
    counts: { gates: gates.length, ready: gates.filter((g) => g.ready).length, letters: letters.length, returns: returns.length },
  }
}

/** The cuentas local id of a Rendición subject (`…:rendicion:<localId>`), or null. */
export function rendicionLocalId(subject: string): string | null {
  const marker = ':rendicion:'
  const at = subject.lastIndexOf(marker)
  if (at < 0) return null
  const local = subject.slice(at + marker.length)
  return local.length > 0 ? local : null
}
