/**
 * The typed-object fixtures (`./fixtures/*.ttl`, D5's shape) in a REAL Oxigraph store — the same engine the gardend
 * cell embeds — each in the named graph its first line names. `query()` answers in the cell's `sparql_query` row
 * shape (each cell an N-Triples term string), so the code under test parses exactly what a cell sends. Every fixture
 * lives in a NAMED graph: a query without `GRAPH ?g { … }` finds nothing here, as it finds nothing in a cell.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classCatalogFrom, objectTriplesQuery, sparqlRows, triplesFromRows, typesOf } from '@shrubbery/nucleus/object-faces'
import { namedNode, Store, type Term } from 'oxigraph'
import type { TypedObjectService } from '../typed-object-service.js'

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

export const RUN_GRAPH = 'urn:sophia:wf:doc-sleepers:run:mh3x9a1'
export const TYPED_ITEM = `${RUN_GRAPH}#item-7`
export const UNFIT_ITEM = `${RUN_GRAPH}#item-9`
export const UNTYPED_ITEM = `${RUN_GRAPH}#item-2`
export const DREAM_REPORT = 'urn:sophia:type:freud-dreams:workspace#DreamReport'
export const STIMULUS = 'urn:sophia:type:freud-dreams:workspace#Stimulus'
export const AGENT = 'urn:sophia:agent:agent-62517a586738e5e9'

export const TTL_FIXTURES = ['run-record.ttl', 'run-typed-item.ttl', 'run-unfit-item.ttl', 'run-untyped-item.ttl', 'beings.ttl'] as const

export function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8')
}

/** The `emporium_vocab` answer for the graph's domain vocabulary, as JSON. */
export function vocabFixture(): Record<string, unknown> {
  return JSON.parse(fixtureText('freud-dreams-workspace.vocab.json')) as Record<string, unknown>
}

export function loadFixtures(names: readonly string[] = TTL_FIXTURES): Store {
  const store = new Store()
  for (const name of names) {
    const text = fixtureText(name)
    const graph = /^# graph: (\S+)/.exec(text)?.[1]
    if (!graph) throw new Error(`${name}: the first line must name its graph`)
    store.load(text, { format: 'text/turtle', to_graph_name: namedNode(graph) })
  }
  return store
}

/** A SELECT, answered as the cell answers `sparql_query`: `{rows: [{var: "<n-triples term>"}]}`. */
export function queryRows(store: Store, sparql: string): { rows: Record<string, string>[] } {
  const result = store.query(sparql) as Map<string, Term>[]
  return {
    rows: result.map((solution) => {
      const row: Record<string, string> = {}
      for (const [name, term] of solution) row[name] = term.toString()
      return row
    }),
  }
}

/**
 * A typed-object reader over the fixture store: the same query the app's reader runs, the class from the fixture
 * vocabulary's `classCatalog`. Null when the store holds no triple about the IRI.
 */
export function fixtureTypedObjectService(store: Store, withCatalog = true): TypedObjectService {
  return {
    async read(graphId, iri) {
      const triples = triplesFromRows(sparqlRows(queryRows(store, objectTriplesQuery(iri))))
      if (!triples.some((t) => t.s === iri)) return null
      const types = typesOf(iri, triples)
      const catalog = withCatalog ? classCatalogFrom(vocabFixture()) : []
      const contract = catalog.find((entry) => types.includes(entry.iri)) ?? null
      return { graphId, iri, types, triples, contract, catalog }
    },
  }
}
