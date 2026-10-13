/**
 * letter-reading.ts — the PURE reading of one letter (`cor:Letter`) for el
 * Despacho W2: the fixed SPARQL shapes the `card.letter` face runs and the
 * pure fold of their real rows into one `LetterReading` — a page.
 *
 * Data-only: no DOM, no network. A letter's BODY never enters the graph: the
 * projection carries the body's path in the sophia repository, its sha256 and
 * a ~280-character excerpt (correo v0.1.0's own rule). The reading keeps that
 * distinction so the view can show the excerpt as the page and the path and
 * digest as provenance, and can say that what it shows is operator testimony
 * (`operator-attested-local`), never an authenticated receipt.
 */
import { plainQueryBlockTermValue, type QueryBlockResult } from '../editor-services/query-block-service.js'
import { COR_NS } from './seat-reading.js'

export const LETTER_MAX_ROWS = 200

export interface LetterParty {
  readonly iri: string
  readonly title: string | null
}

export interface LetterRef {
  readonly iri: string
  readonly kind: string | null
  readonly at: string | null
  readonly from: LetterParty | null
  readonly excerpt: string | null
}

export interface LetterAck {
  readonly iri: string
  readonly actor: LetterParty
  readonly at: string
}

export interface LetterReading {
  readonly subject: string
  readonly found: boolean
  /** False when the subject has triples but is not a correo letter. */
  readonly isLetter: boolean
  readonly props: Readonly<Record<string, readonly string[]>>
  readonly messageId: string | null
  readonly kind: string | null
  readonly conversation: string | null
  readonly at: string | null
  readonly from: LetterParty | null
  readonly to: LetterParty | null
  readonly excerpt: string | null
  readonly bodyPath: string | null
  readonly bodySha256: string | null
  readonly attestation: string | null
  readonly provenance: readonly string[]
  /** The letter this one answers, when the register recorded one. */
  readonly replyTo: LetterRef | null
  /** Letters that answer this one, oldest first. */
  readonly replies: readonly LetterRef[]
  /** Acknowledgements of this letter, oldest first. */
  readonly acks: readonly LetterAck[]
}

function iri(subject: string): string {
  return `<${subject}>`
}

export function letterPropertiesQuery(subject: string): string {
  return `SELECT ?p ?o WHERE { GRAPH ?g { ${iri(subject)} ?p ?o } } LIMIT ${LETTER_MAX_ROWS}`
}

/** The two parties with their titles, and the letter this one answers with its own kind/at/excerpt. */
export function letterPartiesQuery(subject: string): string {
  const s = iri(subject)
  return (
    `SELECT ?from ?fromTitle ?to ?toTitle ?replyTo ?replyKind ?replyAt ?replyFrom ?replyFromTitle ?replyExcerpt WHERE { GRAPH ?g { ` +
    `${s} <${COR_NS}from> ?from ; <${COR_NS}to> ?to . ` +
    `OPTIONAL { ?from <${COR_NS}title> ?fromTitle } OPTIONAL { ?to <${COR_NS}title> ?toTitle } ` +
    `OPTIONAL { ${s} <${COR_NS}replyTo> ?replyTo . ` +
    `OPTIONAL { ?replyTo <${COR_NS}letterKind> ?replyKind } OPTIONAL { ?replyTo <${COR_NS}at> ?replyAt } ` +
    `OPTIONAL { ?replyTo <${COR_NS}from> ?replyFrom . OPTIONAL { ?replyFrom <${COR_NS}title> ?replyFromTitle } } ` +
    `OPTIONAL { ?replyTo <${COR_NS}excerpt> ?replyExcerpt } } } } LIMIT 1`
  )
}

/** Letters that answer this one, oldest first. */
export function letterRepliesQuery(subject: string): string {
  return (
    `SELECT ?r ?kind ?at ?from ?fromTitle ?excerpt WHERE { GRAPH ?g { ` +
    `?r <${COR_NS}replyTo> ${iri(subject)} ; <${COR_NS}letterKind> ?kind ; <${COR_NS}at> ?at ; <${COR_NS}from> ?from . ` +
    `OPTIONAL { ?from <${COR_NS}title> ?fromTitle } OPTIONAL { ?r <${COR_NS}excerpt> ?excerpt } } } ` +
    `ORDER BY ?at ?r LIMIT ${LETTER_MAX_ROWS}`
  )
}

/** Acknowledgements of this letter, oldest first. */
export function letterAcksQuery(subject: string): string {
  return (
    `SELECT ?a ?actor ?actorTitle ?at WHERE { GRAPH ?g { ` +
    `?a <${COR_NS}acknowledges> ${iri(subject)} ; <${COR_NS}actor> ?actor ; <${COR_NS}at> ?at . ` +
    `OPTIONAL { ?actor <${COR_NS}title> ?actorTitle } } } ORDER BY ?at ?a LIMIT ${LETTER_MAX_ROWS}`
  )
}

/** The correo local id of a letter subject, or null when the IRI is not shaped `…:letter:<id>`. */
export function letterLocalId(subject: string): string | null {
  const marker = ':letter:'
  const at = subject.lastIndexOf(marker)
  if (at < 0) return null
  const local = subject.slice(at + marker.length)
  return local.length > 0 ? local : null
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

function party(iriTerm: string, titleTerm: string | null): LetterParty | null {
  return iriTerm ? { iri: iriTerm, title: titleTerm || null } : null
}

function readParties(result: QueryBlockResult): { from: LetterParty | null; to: LetterParty | null; replyTo: LetterRef | null } {
  if (result.resultKind !== 'bindings' || result.rows.length === 0) return { from: null, to: null, replyTo: null }
  const row = result.rows[0]!
  const replyIri = plainQueryBlockTermValue(row.replyTo)
  return {
    from: party(plainQueryBlockTermValue(row.from), row.fromTitle ? plainQueryBlockTermValue(row.fromTitle) : null),
    to: party(plainQueryBlockTermValue(row.to), row.toTitle ? plainQueryBlockTermValue(row.toTitle) : null),
    replyTo: replyIri
      ? {
          iri: replyIri,
          kind: row.replyKind ? plainQueryBlockTermValue(row.replyKind) : null,
          at: row.replyAt ? plainQueryBlockTermValue(row.replyAt) : null,
          from: party(plainQueryBlockTermValue(row.replyFrom), row.replyFromTitle ? plainQueryBlockTermValue(row.replyFromTitle) : null),
          excerpt: row.replyExcerpt ? plainQueryBlockTermValue(row.replyExcerpt) : null,
        }
      : null,
  }
}

function readReplies(result: QueryBlockResult): LetterRef[] {
  if (result.resultKind !== 'bindings') return []
  const replies: LetterRef[] = []
  for (const row of result.rows) {
    const r = plainQueryBlockTermValue(row.r)
    if (!r) continue
    replies.push({
      iri: r,
      kind: plainQueryBlockTermValue(row.kind) || null,
      at: plainQueryBlockTermValue(row.at) || null,
      from: party(plainQueryBlockTermValue(row.from), row.fromTitle ? plainQueryBlockTermValue(row.fromTitle) : null),
      excerpt: row.excerpt ? plainQueryBlockTermValue(row.excerpt) : null,
    })
  }
  return replies
}

function readAcks(result: QueryBlockResult): LetterAck[] {
  if (result.resultKind !== 'bindings') return []
  const acks: LetterAck[] = []
  for (const row of result.rows) {
    const a = plainQueryBlockTermValue(row.a)
    const actor = plainQueryBlockTermValue(row.actor)
    if (!a || !actor) continue
    acks.push({
      iri: a,
      actor: { iri: actor, title: row.actorTitle ? plainQueryBlockTermValue(row.actorTitle) : null },
      at: plainQueryBlockTermValue(row.at),
    })
  }
  return acks
}

/** Pure — fold the four real results into one reading. */
export function readLetter(
  subject: string,
  properties: QueryBlockResult,
  parties: QueryBlockResult,
  replies: QueryBlockResult,
  acks: QueryBlockResult,
): LetterReading {
  const props = groupProperties(properties)
  const found = Object.keys(props).length > 0
  const messageId = first(props, 'messageId')
  const { from, to, replyTo } = readParties(parties)
  return {
    subject,
    found,
    isLetter: messageId !== null,
    props,
    messageId,
    kind: first(props, 'letterKind'),
    conversation: first(props, 'conversation'),
    at: first(props, 'at'),
    from,
    to,
    excerpt: first(props, 'excerpt'),
    bodyPath: first(props, 'bodyPath'),
    bodySha256: first(props, 'bodySha256'),
    attestation: first(props, 'attestation'),
    provenance: props[`${COR_NS}provenance`] ?? [],
    replyTo,
    replies: readReplies(replies),
    acks: readAcks(acks),
  }
}
