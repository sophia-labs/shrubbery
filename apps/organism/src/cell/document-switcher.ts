/**
 * Shell-side projection for the global document switcher.
 *
 * The controlled `mn-document-switcher` stays pure UI. This file owns the
 * Organism-specific shaping of sidebar documents and command-registry commands
 * into rows the component can render.
 */

import type {
  MnDocumentSwitcherAction,
  MnDocumentSwitcherBlockItem,
  MnDocumentSwitcherDocumentItem,
  MnDocumentSwitcherItem,
  MnDocumentSwitcherScope,
  MnDocumentSwitcherSort,
} from '@shrubbery/components'
import type { Command, CommandContext, CommandRegistry } from '@shrubbery/nucleus'
import type { OfflineSemanticSearchHit } from '@shrubbery/source'
import { graphSubject } from '@shrubbery/runtime'
import type { SidebarNode, SidebarSection } from '@shrubbery/runtime'

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

interface QueryResult {
  readonly rows?: ReadonlyArray<Record<string, string>>
}

export interface DocumentSwitcherRest {
  query(graphId: string, sparql: string): Promise<unknown>
}

function normalized(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function title(value: string | null | undefined, fallback: string): string {
  const clean = (value ?? '').trim()
  return clean || fallback
}

function escapeSparqlLiteral(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

function iriValue(term: string): string {
  return term.startsWith('<') && term.endsWith('>') ? term.slice(1, -1) : term
}

function unquoteLiteral(term: string): string {
  if (term[0] !== '"') return term
  let out = ''
  for (let i = 1; i < term.length; i++) {
    const ch = term[i]
    if (ch === '\\') {
      const next = term[i + 1]
      out += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next ?? ''
      i++
      continue
    }
    if (ch === '"') break
    out += ch
  }
  return out
}

function termText(term: string | undefined): string | null {
  if (!term) return null
  const value = term[0] === '"' ? unquoteLiteral(term) : iriValue(term)
  return value.trim() || null
}

function documentIdFromTerm(term: string | undefined): string | null {
  if (!term) return null
  const iri = iriValue(term)
  const localPrefix = 'urn:mnemosyne:local:document:'
  if (iri.startsWith(localPrefix)) return iri.slice(localPrefix.length)
  const marker = ':document:'
  const markerIndex = iri.lastIndexOf(marker)
  if (markerIndex >= 0) return iri.slice(markerIndex + marker.length)
  const slash = iri.lastIndexOf('/')
  if (slash >= 0 && slash < iri.length - 1) return iri.slice(slash + 1)
  const colon = iri.lastIndexOf(':')
  if (colon >= 0 && colon < iri.length - 1) return iri.slice(colon + 1)
  return null
}

function blockIdFromBlockTerm(term: string | undefined): string | null {
  if (!term) return null
  const iri = iriValue(term)
  const marker = '#block-'
  const index = iri.indexOf(marker)
  return index >= 0 ? iri.slice(index + marker.length) : null
}

function localName(term: string | undefined): string {
  const text = termText(term) ?? ''
  const hash = text.lastIndexOf('#')
  if (hash >= 0 && hash < text.length - 1) return text.slice(hash + 1)
  const slash = text.lastIndexOf('/')
  if (slash >= 0 && slash < text.length - 1) return text.slice(slash + 1)
  return text
}

function scoreDocument(item: MnDocumentSwitcherDocumentItem, query: string): number {
  const q = normalized(query)
  if (!q) return item.score ?? 0
  const label = normalized(item.label)
  const path = normalized(item.path)
  if (label === q) return 100
  if (label.startsWith(q)) return 80
  if (label.includes(q)) return 60
  if (path.includes(q)) return 30
  return 0
}

function scoreBlock(item: MnDocumentSwitcherBlockItem, query: string): number {
  // Continuous lexical relevance, not tiers: RRF needs a real ranking signal,
  // and coarse 100/85/65 tiers collapse every hit to the same score (which is
  // how "smart" used to render as plain a-z). Components: match quality
  // (exact > prefix > substring), position of first match, query-token
  // coverage, and a light brevity bonus so a 2-word heading beats a 900-word
  // paragraph for the same hit.
  const q = normalized(query)
  if (!q) return item.score ?? 0
  const label = normalized(item.label)
  const snippet = normalized(item.snippet)
  const haystack = snippet || label
  if (!haystack.includes(q) && !label.includes(q)) return 0

  let score = 0
  if (snippet === q) score += 100
  else if (snippet.startsWith(q)) score += 70
  else if (snippet.includes(q)) score += 45
  if (label === q) score += 40
  else if (label.startsWith(q)) score += 25
  else if (label.includes(q)) score += 12

  const firstHit = haystack.indexOf(q)
  if (firstHit >= 0) score += Math.max(0, 15 - firstHit / 8)

  const tokens = q.split(' ').filter(Boolean)
  if (tokens.length > 1) {
    const covered = tokens.filter((token) => haystack.includes(token)).length
    score += 20 * (covered / tokens.length)
  }

  const length = Math.max(haystack.length, 1)
  score += Math.min(10, 200 / length)
  return score
}

function matchesDocument(item: MnDocumentSwitcherDocumentItem, query: string): boolean {
  // Sort modes order; they do not filter. ('exact' once filtered to exact
  // label matches, which emptied the list for almost every query — exact is
  // an ORDERING: standard reciprocal-rank fusion, see below.)
  const q = normalized(query)
  if (!q) return true
  const label = normalized(item.label)
  const path = normalized(item.path)
  return label.includes(q) || item.id.toLowerCase().includes(q) || path.includes(q)
}

function sortDocuments(
  items: readonly MnDocumentSwitcherDocumentItem[],
  query: string,
  sort: MnDocumentSwitcherSort,
): MnDocumentSwitcherDocumentItem[] {
  const out = items.map((item) => ({
    ...item,
    compositeScore: scoreDocument(item, query),
  }))
  out.sort((left, right) => {
    if (sort === 'alphabetical' || !normalized(query)) {
      return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
    }
    const scoreDelta = (right.compositeScore ?? 0) - (left.compositeScore ?? 0)
    return scoreDelta || left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
  })
  return out
}

function sortBlocks(
  items: readonly MnDocumentSwitcherBlockItem[],
  query: string,
  sort: MnDocumentSwitcherSort,
): MnDocumentSwitcherBlockItem[] {
  const out = items.map((item) => ({
    ...item,
    compositeScore: scoreBlock(item, query),
  }))
  out.sort((left, right) => {
    if (sort === 'alphabetical') {
      return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }) ||
        (left.snippet ?? '').localeCompare(right.snippet ?? '', undefined, { sensitivity: 'base' })
    }
    const scoreDelta = (right.compositeScore ?? 0) - (left.compositeScore ?? 0)
    return scoreDelta || left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
  })
  return out
}

export function documentSwitcherDocumentsFromSidebar(
  sections: readonly SidebarSection[],
  graphId: string,
): MnDocumentSwitcherDocumentItem[] {
  const documents: MnDocumentSwitcherDocumentItem[] = []

  function visit(node: SidebarNode, parents: readonly string[]): void {
    const pathParts = [...parents]
    if (node.kind === 'folder') pathParts.push(title(node.label, node.id))

    if (node.kind === 'document' || node.kind === undefined) {
      documents.push({
        kind: 'document',
        id: node.id,
        documentId: node.id,
        graphId,
        label: title(node.label, node.id),
        path: pathParts.join(' / ') || null,
        readOnly: Boolean(node.readOnly),
      })
    }

    for (const child of node.children ?? []) visit(child, pathParts)
  }

  for (const section of sections) {
    if (section.id !== 'documents') continue
    for (const node of section.nodes ?? []) visit(node, [])
  }

  return documents
}

export function documentSwitcherItems(
  documents: readonly MnDocumentSwitcherDocumentItem[],
  query: string,
  scope: MnDocumentSwitcherScope,
  sort: MnDocumentSwitcherSort,
): MnDocumentSwitcherItem[] {
  if (scope === 'actions' || scope === 'blocks') return []
  return sortDocuments(
    documents.filter((item) => matchesDocument(item, query)),
    query,
    sort,
  )
}

export function documentSwitcherBlocksSparql(graphId: string, query: string): string {
  // Block text lives ONLY in the per-document projection graphs
  // ({graph}:projection:document:{id}); the workspace projection carries no
  // doc:textContent at all, so querying it scans ~2M quads to answer empty
  // (~6s measured on default_x1). Scanning the per-doc graphs with GRAPH ?g
  // answers in ~0.4s with real rows. No ORDER BY here: ordering a full scan
  // forces total materialization before LIMIT; rows are scored and sorted
  // client-side instead.
  const docGraphPrefix = `${graphSubject(graphId)}:projection:document:`
  const needle = escapeSparqlLiteral(normalized(query))
  return [
    'PREFIX doc: <http://mnemosyne.dev/doc#>',
    'SELECT ?block ?docId ?blockId ?text ?type',
    'WHERE {',
    '  GRAPH ?g {',
    '    ?block doc:textContent ?text .',
    `    ?block <${RDF_TYPE}> ?type .`,
    '    OPTIONAL { ?block doc:nodeId ?nodeBlockId . }',
    '  }',
    `  FILTER(STRSTARTS(STR(?g), "${docGraphPrefix}"))`,
    `  FILTER(CONTAINS(LCASE(STR(?text)), ${needle}))`,
    '  BIND(STRAFTER(STR(?g), ":projection:document:") AS ?docId)',
    '  BIND(COALESCE(?nodeBlockId, STRAFTER(STR(?block), "#block-")) AS ?blockId)',
    '}',
    'LIMIT 40',
  ].join('\n')
}

export function documentSwitcherBlockFromRow(
  row: Record<string, string>,
  graphId: string,
  query: string,
  resolveTitle?: (documentId: string) => string | null,
): MnDocumentSwitcherBlockItem | null {
  const documentId = termText(row.docId) ?? documentIdFromTerm(row.docUri)
  const blockId = termText(row.blockId) ?? blockIdFromBlockTerm(row.block)
  const text = termText(row.text)
  if (!documentId || !blockId || !text) return null
  const label = termText(row.docTitle) ?? resolveTitle?.(documentId) ?? documentId
  const type = localName(row.type)
  const path = type ? `${label} / ${type}` : label
  return {
    kind: 'block',
    id: `${documentId}:${blockId}`,
    documentId,
    blockId,
    graphId,
    label,
    snippet: text,
    path,
    matchSource: 'lexical',
    score: scoreBlock({ kind: 'block', id: `${documentId}:${blockId}`, documentId, blockId, graphId, label, snippet: text, path }, query),
  }
}

export function documentSwitcherBlockItemsFromRows(
  rows: readonly Record<string, string>[],
  graphId: string,
  query: string,
  sort: MnDocumentSwitcherSort,
  resolveTitle?: (documentId: string) => string | null,
): MnDocumentSwitcherBlockItem[] {
  const seen = new Set<string>()
  const items: MnDocumentSwitcherBlockItem[] = []
  for (const row of rows) {
    const item = documentSwitcherBlockFromRow(row, graphId, query, resolveTitle)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
  }
  return sortBlocks(items, query, sort)
}

export async function loadDocumentSwitcherBlocks(
  rest: DocumentSwitcherRest,
  graphId: string,
  query: string,
  sort: MnDocumentSwitcherSort,
  resolveTitle?: (documentId: string) => string | null,
): Promise<MnDocumentSwitcherBlockItem[]> {
  if (normalized(query).length < 2) return []
  const result = (await rest.query(graphId, documentSwitcherBlocksSparql(graphId, query))) as QueryResult
  return documentSwitcherBlockItemsFromRows(result.rows ?? [], graphId, query, sort, resolveTitle)
}

export function documentSwitcherOfflineSemanticItems(
  hits: readonly OfflineSemanticSearchHit[],
  graphId: string,
): MnDocumentSwitcherBlockItem[] {
  return hits.map(hit => ({
    kind: 'block',
    id: `${hit.documentId}:${hit.blockId}`,
    documentId: hit.documentId,
    blockId: hit.blockId,
    graphId,
    label: hit.documentTitle || hit.documentId,
    snippet: hit.content,
    path: hit.blockType
      ? `${hit.documentTitle || hit.documentId} / ${hit.blockType}`
      : hit.documentTitle || hit.documentId,
    matchSource: 'semantic',
    score: hit.score,
  }))
}

// Reciprocal-rank fusion, k=60 (the standard constant). 'exact' sorts by this
// fused relevance; 'smart' sorts by the same RRF plus a bounded salience
// nudge (mirroring the MCP hybrid mode's relevance + salienceBoost split).
const RRF_K = 60
const SALIENCE_NUDGE_CAP = 0.006
const SALIENCE_NUDGE_RATE = 0.0012

function rankMap(items: readonly MnDocumentSwitcherBlockItem[]): Map<string, number> {
  const sorted = [...items].sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
  const ranks = new Map<string, number>()
  sorted.forEach((item, index) => {
    if (!ranks.has(item.id)) ranks.set(item.id, index)
  })
  return ranks
}

export function reciprocalRankFuseDocumentSwitcherBlocks(
  lexical: readonly MnDocumentSwitcherBlockItem[],
  semantic: readonly MnDocumentSwitcherBlockItem[],
  limit = 40,
): MnDocumentSwitcherBlockItem[] {
  const lexicalRanks = rankMap(lexical)
  const semanticRanks = rankMap(semantic)
  const byId = new Map<string, MnDocumentSwitcherBlockItem & { rrf: number; lexical: boolean; semantic: boolean }>()

  const consider = (
    item: MnDocumentSwitcherBlockItem,
    ranks: Map<string, number>,
    source: 'lexical' | 'semantic',
  ): void => {
    const rank = ranks.get(item.id)
    if (rank === undefined) return
    const contribution = 1 / (RRF_K + rank + 1)
    const existing = byId.get(item.id)
    if (existing) {
      existing.rrf += contribution
      existing[source] = true
    } else {
      byId.set(item.id, {
        ...item,
        rrf: contribution,
        lexical: source === 'lexical',
        semantic: source === 'semantic',
      })
    }
  }
  for (const item of lexical) consider(item, lexicalRanks, 'lexical')
  for (const item of semantic) consider(item, semanticRanks, 'semantic')

  return [...byId.values()]
    .map(({ rrf, lexical: isLexical, semantic: isSemantic, ...item }) => ({
      ...item,
      matchSource: (isLexical && isSemantic ? 'both' : isLexical ? 'lexical' : 'semantic') as MnDocumentSwitcherBlockItem['matchSource'],
      score: rrf,
      compositeScore: rrf,
    }))
    .sort((left, right) =>
      (right.compositeScore ?? 0) - (left.compositeScore ?? 0)
      || left.label.localeCompare(right.label)
      || left.id.localeCompare(right.id))
    .slice(0, limit)
}

/** Salience rows for RRF candidates: valuations live in the cell's reserved
 * :projection:salience graph (one scan, graph-wide — the per-document
 * /salience REST route costs ~3.5s/doc, so fan-out is not an option). */
export function documentSwitcherSalienceSparql(
  graphId: string,
  candidates: ReadonlyArray<{ documentId: string; blockId: string }>,
): string {
  const values = candidates
    .map(({ documentId, blockId }) => {
      const bare = blockId.startsWith('block-') ? blockId : `block-${blockId}`
      return `<urn:mnemosyne:local:document:${documentId}#block-${bare}>`
    })
    .join(' ')
  return [
    'PREFIX local: <https://mnemosyne.local/ns#>',
    'SELECT ?target ?imp ?val ?count',
    'WHERE {',
    `  VALUES ?target { ${values} }`,
    `  GRAPH <${graphSubject(graphId)}:projection:salience> {`,
    '    ?valuation a local:BlockValuation .',
    '    ?valuation local:targetsBlock ?target .',
    '    ?valuation local:cumulativeImportance ?imp .',
    '    OPTIONAL { ?valuation local:cumulativeValence ?val . }',
    '    OPTIONAL { ?valuation local:valuationCount ?count . }',
    '  }',
    '}',
  ].join('\n')
}

export interface BlockSalienceNudge {
  readonly importance: number
  readonly valence: number | null
}

export function documentSwitcherSalienceNudgesFromRows(
  rows: readonly Record<string, string>[],
): Map<string, BlockSalienceNudge> {
  const nudges = new Map<string, BlockSalienceNudge>()
  for (const row of rows) {
    const iri = iriValue(row.target ?? '')
    const docMarker = ':document:'
    const blockMarker = '#block-'
    const docIndex = iri.indexOf(docMarker)
    const blockIndex = iri.indexOf(blockMarker)
    const importance = Number(termText(row.imp) ?? NaN)
    if (docIndex < 0 || blockIndex < 0 || !Number.isFinite(importance)) continue
    const documentId = iri.slice(docIndex + docMarker.length, blockIndex)
    const blockId = iri.slice(blockIndex + blockMarker.length)
    const valenceRaw = termText(row.val)
    const valence = valenceRaw === null ? null : Number(valenceRaw)
    nudges.set(`${documentId}:${blockId}`, {
      importance,
      valence: valence !== null && Number.isFinite(valence) ? valence : null,
    })
  }
  return nudges
}

/** 'smart' only: add the bounded salience nudge on top of the RRF score and
 * re-sort. 'exact' and 'alphabetical' are returned untouched. */
export function withDocumentSwitcherSalienceNudge(
  items: readonly MnDocumentSwitcherBlockItem[],
  nudges: ReadonlyMap<string, BlockSalienceNudge>,
  sort: MnDocumentSwitcherSort,
): MnDocumentSwitcherBlockItem[] {
  if (sort !== 'smart') return [...items]
  return items
    .map((item) => {
      const nudge = nudges.get(item.id)
      if (!nudge) return item
      const boost = Math.min(SALIENCE_NUDGE_CAP, SALIENCE_NUDGE_RATE * Math.max(0, nudge.importance))
      if (boost <= 0) return item
      return { ...item, compositeScore: (item.compositeScore ?? item.score ?? 0) + boost }
    })
    .sort((left, right) =>
      (right.compositeScore ?? 0) - (left.compositeScore ?? 0)
      || left.label.localeCompare(right.label)
      || left.id.localeCompare(right.id))
}

export function documentSwitcherActionRows(
  registry: Pick<CommandRegistry, 'search' | 'available'>,
  query: string,
  ctx: CommandContext,
): MnDocumentSwitcherAction[] {
  const commands = normalized(query)
    ? registry.search(query, ctx, 'palette')
    : registry.available(ctx, 'palette')

  return commands.map((command: Command): MnDocumentSwitcherAction => ({
    id: command.id,
    label: command.label,
    category: command.category,
    icon: command.icon ?? null,
    shortcut: command.shortcut ?? null,
    disabled: command.disabled === true,
  }))
}
