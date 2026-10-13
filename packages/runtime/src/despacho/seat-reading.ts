/**
 * seat-reading.ts — the PURE reading of one seat (`cor:Seat`) for el Despacho
 * W2 (plans/2026-09-15-despacho-design.md §5, "seats and letters"): the fixed
 * SPARQL shapes the `card.seat` face runs, and the pure fold of their real
 * result rows into one `SeatReading` — a character with a heartbeat.
 *
 * Data-only: no DOM, no network. The correo vocabulary (v0.1.0, the active
 * `chm:DomainOntology` in sophia-cluster's chamber) is transcribed here as
 * constants for the same reason cuenta-reading.ts transcribes cuentas: this
 * codebase has no runtime CURIE registry. Every correo record is
 * `operator-attested-local` — the register's own word for "an operator's
 * testimony, never an authenticated receipt" — and the reading carries that
 * attestation through so the view can say it plainly.
 *
 * The seat's HELD BEADS are read by joining the seat's `cor:seatId` literal
 * against `cta:owner` in the cuentas projection. Today no bead names a
 * roster seat as its holder (owners are "demi" and "vera"), so the list is
 * honestly empty for every seat and the view says why; the join is real and
 * lights up the day a bead names a seat.
 */
import { plainQueryBlockTermValue, type QueryBlockResult } from '../editor-services/query-block-service.js'
import { CTA_NS } from './cuenta-reading.js'

export const COR_NS = 'http://sophia.ai/correo#'
export const CORREO_ATTESTATION_LOCAL = 'operator-attested-local'

/** The row cap shared by the seat shapes — mirrors the sibling query faces' `SERVICE_MAX_ROWS`. */
export const SEAT_MAX_ROWS = 500
export const SEAT_RECENT_RUNS = 5
export const SEAT_CORRESPONDENTS = 6

export interface SeatRun {
  readonly iri: string
  readonly state: string
  readonly runtime: string
  readonly at: string
  readonly bodyIdentity: string | null
}

export interface SeatHeldBead {
  readonly iri: string
  readonly title: string
  readonly status: string
  readonly beadKind: string
}

export interface SeatCorrespondent {
  readonly iri: string
  readonly title: string | null
  readonly letters: number
}

/** correo v0.2.0: a move the seat holds (`cor:Capability` with `cor:heldBy` this seat). */
export interface SeatCapability {
  readonly iri: string
  readonly name: string
  readonly definition: string | null
  readonly contract: string | null
  readonly confidence: string | null
  readonly mergeVerdict: string | null
  readonly attestation: string | null
}

export interface SeatReading {
  readonly subject: string
  /** False when the subject has no triples at all — the view says so, never a blank character. */
  readonly found: boolean
  /** False when the subject has triples but none of them are correo seat triples (a bead, a letter, a stranger). */
  readonly isSeat: boolean
  readonly props: Readonly<Record<string, readonly string[]>>
  readonly seatId: string | null
  readonly title: string
  readonly seatKind: string | null
  readonly scope: string | null
  /** The parent seat's id (a roster id), and the IRI it resolves to under this seat's own projection prefix. */
  readonly parent: { readonly seatId: string; readonly iri: string } | null
  readonly handoff: string | null
  readonly evidence: readonly string[]
  readonly attestation: string | null
  readonly lettersIn: number
  readonly lettersOut: number
  /** Letters addressed to this seat that it has not acknowledged. */
  readonly unacknowledged: number
  /** Newest first; the first entry is the heartbeat. */
  readonly recentRuns: readonly SeatRun[]
  readonly heldBeads: readonly SeatHeldBead[]
  readonly correspondents: readonly SeatCorrespondent[]
  // ── correo v0.2.0 (Vera: "correo is the canon"; every field optional, a
  // plain roster seat has none of them) ──
  /** active | idle | dormant | retired | minted-not-certified — a claim, as the source wrote it. */
  readonly seatStatus: string | null
  readonly agentUri: string | null
  readonly model: string | null
  readonly trigger: string | null
  /** What the seat is for, verbatim from its source. */
  readonly mandate: string | null
  /** The seat's own card text, verbatim. */
  readonly card: string | null
  /** What the seat may never do, verbatim. */
  readonly jail: string | null
  /** Rules the seat keeps, verbatim. */
  readonly seals: readonly string[]
  readonly confidence: string | null
  /** The latest run known at fold time — a dated claim, distinct from the runs actually recorded. */
  readonly lastRunAt: string | null
  /** Graph document ids: definition, charter, tool manifest, prompt bindings. */
  readonly definitions: readonly string[]
  readonly foldedFrom: readonly string[]
  readonly supersedes: string | null
  /** The moves the seat holds. */
  readonly capabilities: readonly SeatCapability[]
}

function iri(subject: string): string {
  return `<${subject}>`
}

/** `SELECT ?p ?o` over every named graph — the same cross-graph-safe shape every subject face uses. */
export function seatPropertiesQuery(subject: string): string {
  return `SELECT ?p ?o WHERE { GRAPH ?g { ${iri(subject)} ?p ?o } } LIMIT ${SEAT_MAX_ROWS}`
}

/** Three counts in one row: letters in, letters out, and letters in with no acknowledgement by this seat. */
export function seatCountsQuery(subject: string): string {
  const s = iri(subject)
  return (
    `SELECT ?in ?out ?unacked WHERE { ` +
    `{ SELECT (COUNT(DISTINCT ?l) AS ?in) WHERE { GRAPH ?g { ?l <${COR_NS}to> ${s} } } } ` +
    `{ SELECT (COUNT(DISTINCT ?m) AS ?out) WHERE { GRAPH ?g { ?m <${COR_NS}from> ${s} } } } ` +
    `{ SELECT (COUNT(DISTINCT ?u) AS ?unacked) WHERE { GRAPH ?g { ?u <${COR_NS}to> ${s} . ` +
    `FILTER NOT EXISTS { ?a <${COR_NS}acknowledges> ?u ; <${COR_NS}actor> ${s} } } } } }`
  )
}

/** The seat's runs, newest first, capped — the first row is the heartbeat. */
export function seatRunsQuery(subject: string): string {
  return (
    `SELECT ?run ?state ?runtime ?at ?body WHERE { GRAPH ?g { ` +
    `?run <${COR_NS}seat> ${iri(subject)} ; <${COR_NS}state> ?state ; <${COR_NS}runtime> ?runtime ; <${COR_NS}at> ?at . ` +
    `OPTIONAL { ?run <${COR_NS}bodyIdentity> ?body } } } ORDER BY DESC(?at) LIMIT ${SEAT_RECENT_RUNS}`
  )
}

/** Beads whose `cta:owner` literal equals this seat's `cor:seatId` literal — a cross-projection join. */
export function seatHeldBeadsQuery(subject: string): string {
  return (
    `SELECT ?b ?title ?status ?kind WHERE { ` +
    `GRAPH ?g1 { ${iri(subject)} <${COR_NS}seatId> ?id } ` +
    `GRAPH ?g2 { ?b <${CTA_NS}owner> ?id ; <${CTA_NS}title> ?title ; <${CTA_NS}status> ?status ; <${CTA_NS}beadKind> ?kind } ` +
    `} ORDER BY ?status ?b LIMIT ${SEAT_MAX_ROWS}`
  )
}

/** The seats this seat exchanges the most letters with, either direction, capped. */
export function seatCorrespondentsQuery(subject: string): string {
  const s = iri(subject)
  return (
    `SELECT ?peer ?ptitle (COUNT(DISTINCT ?l) AS ?n) WHERE { GRAPH ?g { ` +
    `{ ?l <${COR_NS}from> ${s} ; <${COR_NS}to> ?peer } UNION { ?l <${COR_NS}to> ${s} ; <${COR_NS}from> ?peer } ` +
    `OPTIONAL { ?peer <${COR_NS}title> ?ptitle } } FILTER(?peer != ${s}) } ` +
    `GROUP BY ?peer ?ptitle ORDER BY DESC(?n) ?peer LIMIT ${SEAT_CORRESPONDENTS}`
  )
}

/** correo v0.2.0: the moves held by this seat, by name. */
export function seatCapabilitiesQuery(subject: string): string {
  return (
    `SELECT ?cap ?name ?definition ?contract ?confidence ?verdict ?attestation WHERE { GRAPH ?g { ` +
    `?cap <${COR_NS}heldBy> ${iri(subject)} ; <${COR_NS}capabilityName> ?name . ` +
    `OPTIONAL { ?cap <${COR_NS}definition> ?definition } OPTIONAL { ?cap <${COR_NS}contract> ?contract } ` +
    `OPTIONAL { ?cap <${COR_NS}confidence> ?confidence } OPTIONAL { ?cap <${COR_NS}mergeVerdict> ?verdict } ` +
    `OPTIONAL { ?cap <${COR_NS}attestation> ?attestation } } } ORDER BY ?name ?cap LIMIT ${SEAT_MAX_ROWS}`
  )
}

/** The correo local id of a seat subject, or null when the IRI is not shaped `…:seat:<id>`. */
export function seatLocalId(subject: string): string | null {
  const marker = ':seat:'
  const at = subject.lastIndexOf(marker)
  if (at < 0) return null
  const local = subject.slice(at + marker.length)
  return local.length > 0 ? local : null
}

/** The seat IRI a sibling roster id resolves to under the SAME projection prefix as `subject` (null when `subject` is not a seat IRI). */
export function siblingSeatIri(subject: string, seatId: string): string | null {
  const marker = ':seat:'
  const at = subject.lastIndexOf(marker)
  if (at < 0) return null
  return `${subject.slice(0, at + marker.length)}${seatId.replace(/[^A-Za-z0-9._~:@+-]/g, '-').slice(0, 200)}`
}

function groupProperties(result: QueryBlockResult): Record<string, string[]> {
  const byPredicate: Record<string, string[]> = {}
  if (result.resultKind !== 'bindings') return byPredicate
  for (const row of result.rows) {
    const predicate = plainQueryBlockTermValue(row.p)
    if (!predicate) continue
    const values = byPredicate[predicate] ?? (byPredicate[predicate] = [])
    values.push(plainQueryBlockTermValue(row.o))
  }
  return byPredicate
}

function first(props: Record<string, string[]>, local: string): string | null {
  return props[`${COR_NS}${local}`]?.[0] ?? null
}

function count(result: QueryBlockResult, column: string): number {
  if (result.resultKind !== 'bindings' || result.rows.length === 0) return 0
  const n = Number(plainQueryBlockTermValue(result.rows[0]![column]))
  return Number.isFinite(n) ? n : 0
}

function readRuns(result: QueryBlockResult): SeatRun[] {
  if (result.resultKind !== 'bindings') return []
  const runs: SeatRun[] = []
  for (const row of result.rows) {
    const run = plainQueryBlockTermValue(row.run)
    if (!run) continue
    runs.push({
      iri: run,
      state: plainQueryBlockTermValue(row.state),
      runtime: plainQueryBlockTermValue(row.runtime),
      at: plainQueryBlockTermValue(row.at),
      bodyIdentity: row.body ? plainQueryBlockTermValue(row.body) : null,
    })
  }
  return runs
}

function readHeldBeads(result: QueryBlockResult): SeatHeldBead[] {
  if (result.resultKind !== 'bindings') return []
  const beads: SeatHeldBead[] = []
  for (const row of result.rows) {
    const b = plainQueryBlockTermValue(row.b)
    if (!b) continue
    beads.push({
      iri: b,
      title: plainQueryBlockTermValue(row.title),
      status: plainQueryBlockTermValue(row.status),
      beadKind: plainQueryBlockTermValue(row.kind),
    })
  }
  return beads
}

function readCorrespondents(result: QueryBlockResult): SeatCorrespondent[] {
  if (result.resultKind !== 'bindings') return []
  const peers: SeatCorrespondent[] = []
  for (const row of result.rows) {
    const peer = plainQueryBlockTermValue(row.peer)
    if (!peer) continue
    const n = Number(plainQueryBlockTermValue(row.n))
    peers.push({ iri: peer, title: row.ptitle ? plainQueryBlockTermValue(row.ptitle) : null, letters: Number.isFinite(n) ? n : 0 })
  }
  return peers
}

function readCapabilities(result: QueryBlockResult | undefined): SeatCapability[] {
  if (!result || result.resultKind !== 'bindings') return []
  const byIri = new Map<string, SeatCapability>()
  for (const row of result.rows) {
    const cap = plainQueryBlockTermValue(row.cap)
    if (!cap || byIri.has(cap)) continue
    byIri.set(cap, {
      iri: cap,
      name: plainQueryBlockTermValue(row.name),
      definition: row.definition ? plainQueryBlockTermValue(row.definition) : null,
      contract: row.contract ? plainQueryBlockTermValue(row.contract) : null,
      confidence: row.confidence ? plainQueryBlockTermValue(row.confidence) : null,
      mergeVerdict: row.verdict ? plainQueryBlockTermValue(row.verdict) : null,
      attestation: row.attestation ? plainQueryBlockTermValue(row.attestation) : null,
    })
  }
  return [...byIri.values()]
}

/** Pure — fold the six real results into one reading (`capabilities` may be omitted: a v0.1.0 caller). */
export function readSeat(
  subject: string,
  properties: QueryBlockResult,
  counts: QueryBlockResult,
  runs: QueryBlockResult,
  heldBeads: QueryBlockResult,
  correspondents: QueryBlockResult,
  capabilities?: QueryBlockResult,
): SeatReading {
  const props = groupProperties(properties)
  const found = Object.keys(props).length > 0
  const seatId = first(props, 'seatId')
  const parentId = first(props, 'parent')
  const parentIri = parentId ? siblingSeatIri(subject, parentId) : null
  return {
    seatStatus: first(props, 'status'),
    agentUri: first(props, 'agentUri'),
    model: first(props, 'model'),
    trigger: first(props, 'trigger'),
    mandate: first(props, 'mandate'),
    card: first(props, 'card'),
    jail: first(props, 'jail'),
    seals: props[`${COR_NS}seal`] ?? [],
    confidence: first(props, 'confidence'),
    lastRunAt: first(props, 'lastRunAt'),
    definitions: props[`${COR_NS}definition`] ?? [],
    foldedFrom: props[`${COR_NS}foldedFrom`] ?? [],
    supersedes: first(props, 'supersedes'),
    capabilities: readCapabilities(capabilities),
    subject,
    found,
    isSeat: seatId !== null,
    props,
    seatId,
    title: first(props, 'title') ?? seatId ?? subject,
    seatKind: first(props, 'seatKind'),
    scope: first(props, 'scope'),
    parent: parentId && parentIri ? { seatId: parentId, iri: parentIri } : null,
    handoff: first(props, 'handoff'),
    evidence: props[`${COR_NS}evidence`] ?? [],
    attestation: first(props, 'attestation'),
    lettersIn: count(counts, 'in'),
    lettersOut: count(counts, 'out'),
    unacknowledged: count(counts, 'unacked'),
    recentRuns: readRuns(runs),
    heldBeads: readHeldBeads(heldBeads),
    correspondents: readCorrespondents(correspondents),
  }
}
