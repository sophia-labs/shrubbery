/**
 * named-graph-store.ts — the REAL named-graph test substrate for the EditorServices
 * adapters (RUNG L2a harness, the load-bearing fix).
 *
 * THE BUG THIS HARNESS EXISTS TO CATCH: the cell materializes documents + wires into
 * a NAMED projection graph —
 *   urn:mnemosyne:local:graph:{graphId}:projection:workspace
 *   (rdf_authority.rs: workspace_projection_graph_iri(g) = "{graph_subject(g)}:projection:workspace";
 *    graph_subject(g) = "urn:mnemosyne:local:graph:{g}").
 * The cell's SELECT path (rdf_query_service.rs::execute_sparql_query) runs the query
 * VERBATIM with NO union-default-graph and NO rewriting. So ANY SELECT/INSERT/DELETE
 * that omits a GRAPH clause hits the DEFAULT graph and finds/writes NOTHING the cell
 * sees. The prior in-process RestClient fake (a regex/round-trip stub) could not
 * surface that — it had no named-graph semantics, so a GRAPH-less adapter "passed".
 *
 * THE FIX: this harness is a REAL quad store with REAL named-graph semantics — the
 * `oxigraph` npm package (v0.5.9), which is the SAME Rust Oxigraph engine the gardend
 * cell embeds, compiled to a Node addon. We seed docs + wires INTO the named
 * projection graph and run the adapter's GRAPH-scoped SPARQL against it. Because
 * Oxigraph's SELECT default-graph semantics mean a GRAPH-less query sees ZERO triples
 * when all data sits in a named graph, the regression proof is INTRINSIC: an adapter
 * passes ONLY if its GRAPH clause is actually correct. This is a real named-graph-aware
 * store per the no-mock rule — NOT a regex/round-trip fake (which is forbidden here).
 *
 * WHY NOT THE REAL CELL: the most-faithful harness would reuse shrubbery's existing
 * "spawn a real current-release gardend" helper (apps/organism/src/cell/spawn-gardend.ts,
 * exercised by *.integration.test.ts). But it is NOT reusable from a packages/runtime
 * test: (1) it lives in apps/organism, which DEPENDS ON @shrubbery/runtime — importing
 * it upstream inverts the workspace dependency layering the island discipline forbids;
 * (2) packages/runtime tests run under happy-dom with no node:child_process / 40s
 * binary-spawn precedent. Per the prompt's ELSE branch, the in-process REAL engine is
 * the correct, layering-clean substitute — and it ISOLATES the GRAPH-clause-correctness
 * property without the cell's write-authority policy (rdf_authority's reserved-graph
 * gate) confounding the test.
 *
 * ISLAND NOTE: this is a __tests__ helper (NOT shipped host source) and is therefore
 * outside the island guard's non-recursive src/*.ts scan. It is free to import oxigraph.
 *
 * RESULT SHAPE: queryStore() returns the cell's EXACT SparqlQueryResult shape
 * (rdf_query_service.rs lines 71-78): { result_type:'solutions', variables, rows } where
 * each row maps variable → term.to_string(). Oxigraph-JS's `term.toString()` renders a
 * NamedNode as `<uri>` and a Literal as `"value"` — byte-identical to the Rust engine's
 * Display. So a RestClient built on this store (makeOxigraphRestClient) hands the
 * adapters the SAME bytes the real cell would, and the adapters parse it the SAME way.
 */

import { Store, namedNode, literal, quad, type Term } from 'oxigraph'
import type { RestClient } from '@shrubbery/nucleus'
// Reuse the SAME term vocabulary the adapters mint with — one host source of truth for
// the cell-canonical IRIs (graph subject, projection-graph name, document subject).
import {
  WIRE_NS,
  blockRefUri,
  documentSubject,
  documentRefUri,
  workspaceProjectionGraphIri,
  RDF_TYPE,
  wirePredicateUri,
  wireRefUri,
} from '../editor-services/sparql-terms.js'

export { documentSubject, workspaceProjectionGraphIri }

const MDOC_NS = 'http://mnemosyne.dev/doc#'
const DCTERMS_NS = 'http://purl.org/dc/terms/'

/**
 * A document seed:
 *   - `title` (omitted ⇒ no dcterms:title triple) — the live-cell title predicate;
 *   - `docTitle` (omitted ⇒ no doc:title triple) — the alternate/legacy title predicate
 *     (mnemosyne.dev/doc#title) the picker's COALESCE falls back to. Seeding it lets a
 *     test prove the doc:title fallback honestly against the REAL engine.
 */
export interface DocSeed {
  readonly id: string
  readonly title?: string
  readonly docTitle?: string
  readonly tags?: readonly string[]
  readonly blocks?: readonly BlockSeed[]
}

export interface BlockSeed {
  readonly id: string
  readonly type?: 'paragraph' | 'heading' | 'listItem' | 'blockquote' | 'codeBlock'
  readonly text: string
  readonly level?: number
  readonly order?: number
}

export interface WireSeed {
  readonly id: string
  readonly sourceDocumentId: string
  readonly targetDocumentId: string
  readonly sourceBlockId?: string
  readonly targetBlockId?: string
  readonly targetGraphId?: string
  readonly predicate?: string
  readonly bidirectional?: boolean
  readonly sourceTitle?: string
  readonly targetTitle?: string
  readonly sourceSnippet?: string
  readonly targetSnippet?: string
  readonly snapshotAt?: string
}

/**
 * Build a REAL Oxigraph Store and seed the given documents INTO the named projection
 * graph for `graphId`. Each doc gets the canonical materializer triples a real cell
 * would emit (rdf_workspace_entity_triples.rs::push_document_snapshot_triples):
 *   <urn:mnemosyne:local:document:{id}> a doc:TipTapDocument
 *   <…> dcterms:title "<title>"   (only when title is present)
 *
 * EVERYTHING lands in GRAPH <…:projection:workspace> — nothing in the default graph.
 * That is exactly what makes the no-GRAPH-returns-ZERO regression intrinsic.
 */
export function seedWorkspaceStore(
  graphId: string,
  docs: readonly DocSeed[],
  wires: readonly WireSeed[] = [],
): Store {
  const store = new Store()
  const g = namedNode(workspaceProjectionGraphIri(graphId))
  for (const doc of docs) {
    const subj = namedNode(documentSubject(doc.id))
    store.add(quad(subj, namedNode(RDF_TYPE), namedNode(`${MDOC_NS}TipTapDocument`), g))
    if (doc.title !== undefined) {
      store.add(quad(subj, namedNode(`${DCTERMS_NS}title`), literal(doc.title), g))
    }
    if (doc.docTitle !== undefined) {
      store.add(quad(subj, namedNode(`${MDOC_NS}title`), literal(doc.docTitle), g))
    }
    for (const tag of doc.tags ?? []) {
      store.add(quad(subj, namedNode(`${MDOC_NS}hasTag`), literal(tag), g))
    }
    for (const [index, block] of (doc.blocks ?? []).entries()) {
      const blockSubj = namedNode(blockRefUri(doc.id, block.id))
      store.add(quad(blockSubj, namedNode(RDF_TYPE), namedNode(blockTypeUri(block.type ?? 'paragraph')), g))
      store.add(quad(blockSubj, namedNode(`${MDOC_NS}nodeId`), literal(block.id), g))
      store.add(quad(blockSubj, namedNode(`${MDOC_NS}textContent`), literal(block.text), g))
      store.add(quad(blockSubj, namedNode(`${MDOC_NS}siblingOrder`), literal(String(block.order ?? index)), g))
      if (block.level !== undefined) {
        store.add(quad(blockSubj, namedNode(`${MDOC_NS}level`), literal(String(block.level)), g))
      }
    }
  }
  for (const wire of wires) {
    const subj = namedNode(wireRefUri(graphId, wire.id))
    store.add(quad(subj, namedNode(RDF_TYPE), namedNode(`${WIRE_NS}Wire`), g))
    store.add(quad(subj, namedNode(`${WIRE_NS}sourceDocument`), namedNode(documentRefUri(wire.sourceDocumentId)), g))
    store.add(quad(subj, namedNode(`${WIRE_NS}targetDocument`), namedNode(documentRefUri(wire.targetDocumentId)), g))
    if (wire.sourceBlockId !== undefined) {
      store.add(
        quad(
          subj,
          namedNode(`${WIRE_NS}sourceBlock`),
          namedNode(blockRefUri(wire.sourceDocumentId, wire.sourceBlockId)),
          g,
        ),
      )
    }
    if (wire.targetBlockId !== undefined) {
      store.add(
        quad(
          subj,
          namedNode(`${WIRE_NS}targetBlock`),
          namedNode(blockRefUri(wire.targetDocumentId, wire.targetBlockId)),
          g,
        ),
      )
    }
    store.add(
      quad(
        subj,
        namedNode(`${WIRE_NS}targetGraph`),
        literal(wire.targetGraphId ?? graphId),
        g,
      ),
    )
    store.add(
      quad(
        subj,
        namedNode(`${WIRE_NS}predicate`),
        namedNode(wirePredicateUri(wire.predicate ?? 'relatedTo')),
        g,
      ),
    )
    store.add(quad(subj, namedNode(`${WIRE_NS}bidirectional`), literal(String(wire.bidirectional ?? false)), g))
    if (wire.sourceTitle !== undefined) {
      store.add(quad(subj, namedNode(`${WIRE_NS}sourceTitle`), literal(wire.sourceTitle), g))
    }
    if (wire.targetTitle !== undefined) {
      store.add(quad(subj, namedNode(`${WIRE_NS}targetTitle`), literal(wire.targetTitle), g))
    }
    if (wire.sourceSnippet !== undefined) {
      store.add(quad(subj, namedNode(`${WIRE_NS}sourceSnippet`), literal(wire.sourceSnippet), g))
    }
    if (wire.targetSnippet !== undefined) {
      store.add(quad(subj, namedNode(`${WIRE_NS}targetSnippet`), literal(wire.targetSnippet), g))
    }
    if (wire.snapshotAt !== undefined) {
      store.add(quad(subj, namedNode(`${WIRE_NS}snapshotAt`), literal(wire.snapshotAt), g))
    }
  }
  return store
}

function blockTypeUri(type: NonNullable<BlockSeed['type']>): string {
  switch (type) {
    case 'heading':
      return `${MDOC_NS}Heading`
    case 'listItem':
      return `${MDOC_NS}ListItem`
    case 'blockquote':
      return `${MDOC_NS}Blockquote`
    case 'codeBlock':
      return `${MDOC_NS}CodeBlock`
    default:
      return `${MDOC_NS}Paragraph`
  }
}

/** The cell's SparqlQueryResult shape (rdf_query_service.rs:71-78). */
export interface SparqlQueryResult {
  readonly result_type: 'solutions'
  readonly variables: string[]
  readonly rows: Array<Record<string, string>>
}

/**
 * Run a SELECT against the store and shape the answer like the cell does: variables +
 * rows mapping var → term.to_string(). Oxigraph-JS solutions are Map<string, Term>;
 * `term.toString()` matches the Rust engine's Display verbatim.
 */
export function queryStore(store: Store, sparql: string): SparqlQueryResult {
  const solutions = store.query(sparql) as Array<Map<string, Term>>
  const variables: string[] = []
  const rows: Array<Record<string, string>> = []
  for (const sol of solutions) {
    const row: Record<string, string> = {}
    for (const [variable, term] of sol) {
      if (!variables.includes(variable)) variables.push(variable)
      row[variable] = term.toString()
    }
    rows.push(row)
  }
  return { result_type: 'solutions', variables, rows }
}

/**
 * A REAL RestClient (the contract seam the adapters consume) backed by an Oxigraph
 * Store. query() returns the cell's SparqlQueryResult shape; update() runs the SPARQL
 * update against the SAME engine the cell uses. graphs() is unused by these adapters.
 *
 * `graphId` is accepted but NOT used to scope the query — exactly like the cell, which
 * runs the query VERBATIM. The ONLY thing that scopes a query to the workspace graph is
 * the adapter's own GRAPH clause. That is the whole point: if the adapter forgets it,
 * the query hits the empty default graph and returns nothing.
 */
export function makeOxigraphRestClient(store: Store): RestClient {
  return {
    graphs(): Promise<unknown> {
      return Promise.resolve([])
    },
    query(_graphId: string, sparql: string): Promise<unknown> {
      return Promise.resolve(queryStore(store, sparql))
    },
    update(_graphId: string, sparql: string): Promise<void> {
      store.update(sparql)
      return Promise.resolve()
    },
  }
}
