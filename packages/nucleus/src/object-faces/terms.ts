/**
 * Terms and triples of a typed resource, and the one SPARQL read that fetches them (typed objects architecture D6,
 * `plans/2026-10-20-typed-objects/README.md`): the subject's own triples, its nested values' triples (a nested value is
 * a child node `<parent>/<key>` or `<parent>/<key>/<i>`, D2 "Nesting", at most three levels down), and the label of the
 * being that made it. Every pattern is wrapped in `GRAPH ?g { … }`: a cell's store is named-graph partitioned, so an
 * unwrapped pattern silently matches nothing.
 *
 * Pure: no DOM, no network, no Lit.
 */

import type { ValueTerm } from '../value-faces/index.js'

export const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
export const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'
export const SKOS_PREF_LABEL = 'http://www.w3.org/2004/02/skos/core#prefLabel'
export const DCT_TITLE = 'http://purl.org/dc/terms/title'
export const WF = 'http://mnemosyne.dev/workflow#'
export const PROV_GENERATED_AT = 'http://www.w3.org/ns/prov#generatedAtTime'
export const EMPORIUM_RETRACTED_AT = 'http://mnemosyne.dev/emporium#retractedAt'
export const EMPORIUM_RETRACTED_BY = 'http://mnemosyne.dev/emporium#retractedBy'
export const MDOC = 'http://mnemosyne.dev/doc#'
/** gardend's document projection names a block's document with `mnemo:documentId` (runtime_config.rs MNEMO_NS). */
export const MNEMO = 'https://mnemosyne.local/ns#'
export const XSD = 'http://www.w3.org/2001/XMLSchema#'

/** One triple of a typed resource (or of its nested values): subject IRI, predicate IRI, object term. */
export interface ObjectTriple {
  readonly s: string
  readonly p: string
  readonly o: ValueTerm
}

/** How deep nested values go (D2 "Nesting": depth 3, a cycle refused at definition). */
export const OBJECT_NESTING_DEPTH = 3

const IRI_TEXT = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]+$/

/** An absolute IRI that is safe to put between `<` and `>` in a query. */
export function isAbsoluteIri(value: string): boolean {
  return IRI_TEXT.test(value)
}

/**
 * The one read of a typed resource: rows `?s ?p ?o`. The subject, each nested level below it (only children whose IRI
 * extends the parent's, so a link to another object is never followed), and the label of `wf:producedBy`.
 */
export function objectTriplesQuery(iri: string): string {
  if (!isAbsoluteIri(iri)) throw new Error(`not an absolute IRI: ${JSON.stringify(iri)}`)
  const levels: string[] = [`{ GRAPH ?g { <${iri}> ?p ?o } BIND(<${iri}> AS ?s) }`]
  let path = `<${iri}> ?p1 ?c1 .`
  let filter = `FILTER(isIRI(?c1) && STRSTARTS(STR(?c1), "${iri}/"))`
  for (let depth = 1; depth <= OBJECT_NESTING_DEPTH; depth++) {
    levels.push(`{ GRAPH ?g { ${path} ?c${depth} ?p ?o } ${filter} BIND(?c${depth} AS ?s) }`)
    path = `${path} ?c${depth} ?p${depth + 1} ?c${depth + 1} .`
    filter = `${filter} FILTER(isIRI(?c${depth + 1}) && STRSTARTS(STR(?c${depth + 1}), CONCAT(STR(?c${depth}), "/")))`
  }
  levels.push(
    `{ GRAPH ?g { <${iri}> <${WF}producedBy> ?s } GRAPH ?gl { ?s ?p ?o } FILTER(?p IN (<${RDFS_LABEL}>, <${SKOS_PREF_LABEL}>, <${DCT_TITLE}>)) }`,
  )
  return `SELECT DISTINCT ?s ?p ?o WHERE {\n  ${levels.join('\n  UNION\n  ')}\n} LIMIT 2000`
}

/** Parse one N-Triples term as a cell's `sparql_query` rows carry it (`<iri>`, `"lit"^^<dt>`, `"lit"@en`, `_:b`). */
export function parseNTriplesTerm(raw: string): ValueTerm {
  const text = raw.trim()
  if (text.startsWith('<') && text.endsWith('>')) return { type: 'uri', value: text.slice(1, -1) }
  if (text.startsWith('_:')) return { type: 'bnode', value: text.slice(2) }
  if (text.startsWith('"')) {
    let i = 1
    let value = ''
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') {
        const next = text[i + 1] ?? ''
        if (next === 'u' || next === 'U') {
          const len = next === 'u' ? 4 : 8
          value += String.fromCodePoint(Number.parseInt(text.slice(i + 2, i + 2 + len), 16))
          i += 2 + len
          continue
        }
        const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\', b: '\b', f: '\f', "'": "'" }
        value += simple[next] ?? next
        i += 2
        continue
      }
      value += text[i]
      i += 1
    }
    const rest = text.slice(i + 1)
    if (rest.startsWith('^^<') && rest.endsWith('>')) return { type: 'literal', value, datatype: rest.slice(3, -1) }
    if (rest.startsWith('@')) return { type: 'literal', value, language: rest.slice(1) }
    return { type: 'literal', value }
  }
  // A bare token (some SPARQL faces print plain literals unquoted): keep it as a literal.
  return { type: 'literal', value: text }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The rows of a SELECT answer in any shape a tool result arrives in (structuredContent, a text part, rows). */
export function sparqlRows(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord)
  if (!isRecord(value)) return []
  if (Array.isArray(value.rows)) return value.rows.filter(isRecord)
  if (isRecord(value.results) && Array.isArray(value.results.bindings)) return value.results.bindings.filter(isRecord)
  if (isRecord(value.structuredContent)) return sparqlRows(value.structuredContent)
  if (isRecord(value.result)) return sparqlRows(value.result)
  if (Array.isArray(value.content)) {
    for (const part of value.content) {
      if (isRecord(part) && typeof part.text === 'string') {
        try {
          const rows = sparqlRows(JSON.parse(part.text))
          if (rows.length) return rows
        } catch {
          // not JSON; keep looking
        }
      }
    }
  }
  return []
}

/** One cell of a row: an N-Triples string, or a SPARQL JSON term `{type, value, datatype?, xml:lang?}`. */
export function rowTerm(cell: unknown): ValueTerm | undefined {
  if (typeof cell === 'string') return parseNTriplesTerm(cell)
  if (!isRecord(cell) || typeof cell.value !== 'string') return undefined
  const type = cell.type === 'uri' || cell.type === 'bnode' ? cell.type : 'literal'
  const language = typeof cell['xml:lang'] === 'string' ? cell['xml:lang'] : typeof cell.language === 'string' ? cell.language : undefined
  return {
    type,
    value: cell.value,
    ...(typeof cell.datatype === 'string' ? { datatype: cell.datatype } : {}),
    ...(language ? { language } : {}),
  }
}

/** `?s ?p ?o` rows to triples; rows with a literal subject or a non-IRI predicate are dropped. */
export function triplesFromRows(rows: readonly Record<string, unknown>[]): ObjectTriple[] {
  const out: ObjectTriple[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const s = rowTerm(row.s)
    const p = rowTerm(row.p)
    const o = rowTerm(row.o)
    if (!s || !p || !o || s.type === 'literal' || p.type !== 'uri') continue
    const subject = s.type === 'bnode' ? `_:${s.value}` : s.value
    const key = `${subject}\u0000${p.value}\u0000${o.type}\u0000${o.value}\u0000${o.datatype ?? ''}\u0000${o.language ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ s: subject, p: p.value, o })
  }
  return out
}

/** The `rdf:type`s of one subject, in lexical order (RDF keeps none). */
export function typesOf(iri: string, triples: readonly ObjectTriple[]): string[] {
  return [...new Set(triples.filter((t) => t.s === iri && t.p === RDF_TYPE && t.o.type === 'uri').map((t) => t.o.value))].sort()
}

/**
 * The documents whose blocks embed `iri`: rows `?documentId ?block ?nodeId`. An `objectEmbed` block projects a real
 * edge `<block> mdoc:embeds <iri>` (§4 "Embed block"), beside its attrs as literals (`a mdoc:ObjectEmbed ; mdoc:iri
 * "<iri>"`); either form finds it, so a gardend that projects only the literals (before the edge) is read too.
 */
export function objectUsageQuery(iri: string): string {
  if (!isAbsoluteIri(iri)) throw new Error(`not an absolute IRI: ${JSON.stringify(iri)}`)
  return [
    `PREFIX mdoc: <${MDOC}>`,
    `PREFIX mnemo: <${MNEMO}>`,
    'SELECT DISTINCT ?documentId ?block ?nodeId WHERE {',
    `  { GRAPH ?g { ?block mdoc:embeds <${iri}> } } UNION { GRAPH ?g { ?block a mdoc:ObjectEmbed ; mdoc:iri ${JSON.stringify(iri)} } }`,
    '  OPTIONAL { GRAPH ?g { ?block mnemo:documentId ?documentId } }',
    '  OPTIONAL { GRAPH ?g { ?block mdoc:nodeId ?nodeId } }',
    '} LIMIT 200',
  ].join('\n')
}

/**
 * Typed objects of this graph for the `/object` picker: every subject typed by a graph-defined class (the namespace
 * `urn:sophia:type:`, D3), with its class. Rows `?s ?c`.
 */
export function typedObjectSearchQuery(namespace = 'urn:sophia:type:', limit = 400): string {
  return [
    `SELECT DISTINCT ?s ?c WHERE {`,
    `  GRAPH ?g { ?s <${RDF_TYPE}> ?c FILTER(isIRI(?s) && STRSTARTS(STR(?c), ${JSON.stringify(namespace)})) }`,
    `} LIMIT ${Math.max(1, Math.min(2000, Math.floor(limit)))}`,
  ].join('\n')
}
