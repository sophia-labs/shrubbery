/**
 * graph-read.ts — one named graph's triples, from whichever source the shell has.
 *
 * A source that dumps (`read`) is read in one call: the `.nt` the builder wrote.
 * A source that answers SPARQL is read with paged SELECTs instead, because a
 * public-mode gardend refuses `rdf_dump` to visitors and answers `sparql_query`
 * at most 1,000 rows a page. The pages are ordered (`ORDER BY ?s ?p ?o`) so the
 * paging is stable, and the triple count is the one actually read.
 *
 * Every result carries its testimony: how it was read, when, and how much.
 */

import { TripleSourceError, triplesOf, type SourceTerm, type Term, type Triple, type TripleSource } from '@shrubbery/nucleus'

export interface GraphReadTestimony {
  readonly graphIri: string
  readonly via: 'read' | 'select'
  readonly readAt: number
  readonly tripleCount: number
  /** SELECT pages fetched (1 for a read). */
  readonly pages: number
  /** Rows with a blank node, which the nucleus Triple model does not carry. */
  readonly skipped: number
}

export interface GraphRead {
  readonly triples: readonly Triple[]
  readonly testimony: GraphReadTestimony
}

export interface GraphReadOptions {
  /** Rows per SELECT page (a public gardend answers at most 1,000). */
  readonly pageSize?: number
  /** A ceiling on pages, so a runaway graph cannot hold the page. */
  readonly maxPages?: number
}

function checkIri(iri: string): string {
  if (/[<>"{}|\\^`\s]/.test(iri)) throw new TripleSourceError('protocol', `refusing to query an unsafe graph IRI <${iri}>`)
  return iri
}

export function pagedTriplesQuery(graphIri: string, limit: number, offset: number): string {
  return `SELECT ?s ?p ?o WHERE { GRAPH <${checkIri(graphIri)}> { ?s ?p ?o } } ORDER BY ?s ?p ?o LIMIT ${limit} OFFSET ${offset}`
}

function asTerm(t: SourceTerm | undefined): Term | null {
  if (!t || t.type === 'bnode') return null
  return t.type === 'iri' ? { type: 'iri', value: t.value } : t.datatype ? { type: 'literal', value: t.value, datatype: t.datatype } : { type: 'literal', value: t.value }
}

export async function readGraph(source: TripleSource, graphIri: string, opts: GraphReadOptions = {}): Promise<GraphRead> {
  if (source.description.sparql && source.select) {
    const size = opts.pageSize ?? 1000
    const maxPages = opts.maxPages ?? 200
    const triples: Triple[] = []
    let skipped = 0
    let readAt = 0
    let pages = 0
    for (;;) {
      const result = await source.select(pagedTriplesQuery(graphIri, size, pages * size))
      pages++
      readAt = result.readAt
      for (const row of result.rows) {
        const s = asTerm(row.s)
        const p = asTerm(row.p)
        const o = asTerm(row.o)
        if (!s || !p || !o || s.type !== 'iri' || p.type !== 'iri') {
          skipped++
          continue
        }
        triples.push({ s: s.value, p: p.value, o })
      }
      if (result.rows.length < size) break
      if (pages >= maxPages) {
        throw new TripleSourceError('protocol', `<${graphIri}> did not end within ${maxPages} pages of ${size} rows`)
      }
    }
    return { triples, testimony: { graphIri, via: 'select', readAt, tripleCount: triples.length, pages, skipped } }
  }
  const read = await source.read(graphIri)
  const triples = triplesOf(read)
  return {
    triples,
    testimony: { graphIri, via: 'read', readAt: read.readAt, tripleCount: read.tripleCount, pages: 1, skipped: 0 },
  }
}
