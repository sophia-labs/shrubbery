/**
 * wikilink-search-service.ts — WikiLinkSearchService: the host-side seam that powers
 * the `[[` document picker.
 *
 * Garden read the doc list out of `filesystemStore.getState().documents` (a Y.js store)
 * and fuzzy-filtered host-side (document-editor.ts::getWikiLinkSuggestions →
 * fuzzyFilterDocuments). Here the doc list comes from the contract's RestClient via a
 * GRAPH-SCOPED SPARQL SELECT against the workspace projection graph, and the SAME pure
 * fuzzy scorer (lifted VERBATIM from garden) filters host-side.
 *
 * THE GRAPH-SCOPE INVARIANT (the bug the L2a harness exists to catch): DOC_LIST_SPARQL
 * wraps its WHERE in GRAPH <urn:mnemosyne:local:graph:{graphId}:projection:workspace>.
 * Without it the cell runs the query verbatim against the EMPTY default graph and the
 * picker is always empty. The graphId comes from getScope().graphId AT CALL TIME. The
 * only retained state is one graph-keyed document projection cache; query text never
 * becomes remote state.
 *
 * FETCH-LIST-THEN-FILTER, not round-trip-per-keystroke: the service caches one FULL doc
 * list per graph scope and runs fuzzyFilterDocuments host-side — matching garden, which
 * filtered an in-memory list. A scope change invalidates the cache; a keystroke is a pure
 * local re-filter rather than another cell request.
 *
 * HOME SCOPE ⇒ []: when nothing is open (centerMode 'home' / graphId null) there is no
 * graph to scope to, so suggest() returns [] without issuing a query — honest, not faked.
 *
 * dcterms:title is OPTIONAL on a TipTapDocument (the materializer only emits it when a
 * title exists, rdf_workspace_entity_triples.rs:72-73). So the SELECT uses OPTIONAL +
 * COALESCE to 'Untitled', exactly like garden's `doc.title || 'Untitled'`. The COALESCE
 * is over BOTH dcterms:title AND doc:title (mnemosyne.dev/doc#title): the live cell
 * materializes dcterms:title, but a doc:title fallback makes the picker robust to either
 * title predicate (legacy / alternate-projection data) at zero cost for current data,
 * since both branches are OPTIONAL.
 *
 * ISLAND NOTE: editor-services/ subdir — outside the non-recursive island scan (like
 * collab/). It imports @shrubbery/nucleus types + a sibling .js; no forbidden coupling.
 */

import type { RestClient } from '@shrubbery/nucleus'
import { workspaceProjectionGraphIri } from './sparql-terms.js'

/**
 * The suggestion item shape — lifted VERBATIM from garden's
 * lib/tiptap-wikilink-suggestion.ts so the host has ONE source of truth for it.
 */
export interface WikiLinkSuggestionItem {
  id: string
  label: string
  type: 'document' | 'artifact'
  parentId?: string | null
}

/** The host-side seam: given a query string, return ranked suggestion items. */
export interface WikiLinkSearchService {
  suggest(query: string): Promise<WikiLinkSuggestionItem[]>
}

/** The document picker and chat composer share graph truth but not an editor
 * lifecycle. Keeping this read seam graph-shaped lets both hosts scope lookup
 * honestly without inventing a fake open document for chat. */
export interface WikiLinkSearchScope {
  readonly graphId: string | null
}

/**
 * Build the GRAPH-scoped doc-list SELECT for a graph's workspace projection graph.
 *
 * GRAPH-SCOPED (non-negotiable): the WHERE is wrapped in
 * GRAPH <…:projection:workspace>. Both dcterms:title and doc:title are OPTIONAL (the live
 * cell emits dcterms:title only when present; doc:title is a robustness fallback) →
 * COALESCE(?dctitle, ?doctitle, 'Untitled') gives the same fallback garden's
 * `|| 'Untitled'` did, surviving either title predicate.
 */
export function docListSparql(graphId: string): string {
  const ws = workspaceProjectionGraphIri(graphId)
  return [
    'PREFIX doc: <http://mnemosyne.dev/doc#>',
    'PREFIX dcterms: <http://purl.org/dc/terms/>',
    'SELECT ?doc (COALESCE(?dctitle, ?doctitle, "Untitled") AS ?label)',
    `WHERE { GRAPH <${ws}> {`,
    '  ?doc a doc:TipTapDocument .',
    '  OPTIONAL { ?doc dcterms:title ?dctitle }',
    '  OPTIONAL { ?doc doc:title ?doctitle }',
    '} }',
  ].join('\n')
}

/**
 * Simple fuzzy filter for document names. LIFTED VERBATIM from garden's
 * lib/tiptap-wikilink-suggestion.ts::fuzzyFilterDocuments — the 5-rung scorer:
 *   exact 100 / startsWith 80 / includes 60 / subsequence +10·char / slice(0,20).
 * One host source of truth — do NOT re-derive a variant.
 */
export function fuzzyFilterDocuments(
  items: WikiLinkSuggestionItem[],
  query: string,
): WikiLinkSuggestionItem[] {
  if (!query) {
    return items.slice(0, 20)
  }

  const lowerQuery = query.toLowerCase().trim()

  const scored = items
    .map((item) => {
      const label = item.label.toLowerCase()
      let score = 0

      // Exact match
      if (label === lowerQuery) {
        score = 100
      }
      // Starts with
      else if (label.startsWith(lowerQuery)) {
        score = 80
      }
      // Contains
      else if (label.includes(lowerQuery)) {
        score = 60
      }
      // Fuzzy match
      else {
        let queryIndex = 0
        for (let i = 0; i < label.length && queryIndex < lowerQuery.length; i++) {
          if (label[i] === lowerQuery[queryIndex]) {
            queryIndex++
            score += 10
          }
        }
        if (queryIndex < lowerQuery.length) {
          score = 0 // Didn't match all characters
        }
      }

      return { item, score }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)

  return scored.map(({ item }) => item)
}

/** The shape of one row in the cell's SparqlQueryResult.rows (var → term.to_string()). */
type SolutionRow = Record<string, string>

/** The subset of the cell's SparqlQueryResult shape this adapter reads. */
interface SolutionsResult {
  rows?: SolutionRow[]
}

/**
 * Parse a `?doc`/`?label` row pair (term.to_string() form) into a suggestion item.
 *   - ?doc is a NamedNode → "<urn:mnemosyne:local:document:{id}>"; strip <…> + the
 *     document-subject prefix back to the bare id.
 *   - ?label is a Literal → '"Title"' (possibly '"Title"@en' / '"v"^^<dt>'); take the
 *     first quoted segment and unescape it.
 */
function rowToItem(row: SolutionRow): WikiLinkSuggestionItem | null {
  const docTerm = row.doc
  const labelTerm = row.label
  if (!docTerm) return null
  const id = bareDocumentId(docTerm)
  if (!id) return null
  return {
    id,
    label: labelTerm ? unquoteLiteral(labelTerm) : 'Untitled',
    type: 'document',
  }
}

/** "<urn:mnemosyne:local:document:{id}>" → "{id}" (else null if not that shape). */
function bareDocumentId(term: string): string | null {
  const iri = term.startsWith('<') && term.endsWith('>') ? term.slice(1, -1) : term
  const prefix = 'urn:mnemosyne:local:document:'
  return iri.startsWith(prefix) ? iri.slice(prefix.length) : null
}

/** '"Title"@en' / '"Title"^^<dt>' / '"Title"' → 'Title' (unescaping \" \\ \n \r \t). */
function unquoteLiteral(term: string): string {
  if (term[0] !== '"') return term
  // Find the closing unescaped quote.
  let out = ''
  for (let i = 1; i < term.length; i++) {
    const ch = term[i]
    if (ch === '\\') {
      const next = term[i + 1]
      out +=
        next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next ?? ''
      i++
      continue
    }
    if (ch === '"') break
    out += ch
  }
  return out
}

/**
 * Build the WikiLinkSearchService over the contract's RestClient and a scope getter.
 * Reads getScope().graphId AT CALL TIME and caches one full projection per active graph
 * so successive autocomplete keystrokes remain local.
 *
 *   - home scope (no graphId) ⇒ [] without a query;
 *   - else: ONE GRAPH-scoped SELECT, map rows → items, then fuzzyFilterDocuments
 *     host-side (fetch-list-then-fuzzy-filter — never a round-trip per keystroke).
 */
export function makeWikiLinkSearchService(
  rest: RestClient,
  getScope: () => WikiLinkSearchScope,
): WikiLinkSearchService {
  let cachedGraphId: string | null = null
  let cachedItems: Promise<WikiLinkSuggestionItem[]> | null = null

  const loadItems = (graphId: string): Promise<WikiLinkSuggestionItem[]> => {
    if (cachedGraphId === graphId && cachedItems) return cachedItems
    cachedGraphId = graphId
    cachedItems = rest.query(graphId, docListSparql(graphId)).then((raw) => {
      const result = raw as SolutionsResult
      const items: WikiLinkSuggestionItem[] = []
      for (const row of result.rows ?? []) {
        const item = rowToItem(row)
        if (item) items.push(item)
      }
      return items
    }).catch((error) => {
      if (cachedGraphId === graphId) {
        cachedGraphId = null
        cachedItems = null
      }
      throw error
    })
    return cachedItems
  }

  return {
    async suggest(query: string): Promise<WikiLinkSuggestionItem[]> {
      const scope = getScope()
      const graphId = scope.graphId
      if (!graphId) return [] // home / nothing open — no graph to scope to
      const items = await loadItems(graphId)
      return fuzzyFilterDocuments(items, query)
    },
  }
}
