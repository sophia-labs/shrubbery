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
import { workspaceProjectionGraphIri } from '@shrubbery/runtime'
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
  const q = normalized(query)
  if (!q) return item.score ?? 0
  const label = normalized(item.label)
  const snippet = normalized(item.snippet)
  const path = normalized(item.path)
  if (snippet === q) return 100
  if (snippet.startsWith(q)) return 85
  if (label === q) return 75
  if (snippet.includes(q)) return 65
  if (label.includes(q)) return 45
  if (path.includes(q)) return 25
  return 0
}

function matchesDocument(item: MnDocumentSwitcherDocumentItem, query: string, sort: MnDocumentSwitcherSort): boolean {
  const q = normalized(query)
  if (!q) return true
  const label = normalized(item.label)
  const path = normalized(item.path)
  if (sort === 'exact') return label === q || item.id.toLowerCase() === q
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
    documents.filter((item) => matchesDocument(item, query, sort)),
    query,
    sort,
  )
}

export function documentSwitcherBlocksSparql(graphId: string, query: string): string {
  const ws = workspaceProjectionGraphIri(graphId)
  const needle = escapeSparqlLiteral(normalized(query))
  return [
    'PREFIX doc: <http://mnemosyne.dev/doc#>',
    'PREFIX dcterms: <http://purl.org/dc/terms/>',
    'SELECT DISTINCT ?block ?docUri ?blockId ?docTitle ?text ?type ?order ?siblingOrder',
    `WHERE { GRAPH <${ws}> {`,
    '  ?docUri a doc:TipTapDocument .',
    `  ?block <${RDF_TYPE}> ?type .`,
    '  FILTER(STRSTARTS(STR(?block), CONCAT(STR(?docUri), "#block-")))',
    '  OPTIONAL { ?block doc:blockId ?flatBlockId . }',
    '  OPTIONAL { ?block doc:nodeId ?nodeBlockId . }',
    '  OPTIONAL { ?block doc:textContent ?text . }',
    `  FILTER(BOUND(?text) && CONTAINS(LCASE(STR(?text)), ${needle}))`,
    '  OPTIONAL { ?block doc:order ?order . }',
    '  OPTIONAL { ?block doc:siblingOrder ?siblingOrder . }',
    '  OPTIONAL { ?docUri dcterms:title ?dctitle . }',
    '  OPTIONAL { ?docUri doc:title ?doctitle . }',
    '  BIND(COALESCE(?flatBlockId, ?nodeBlockId, STRAFTER(STR(?block), "#block-")) AS ?blockId)',
    '  BIND(COALESCE(?dctitle, ?doctitle, "Untitled") AS ?docTitle)',
    '} }',
    'ORDER BY ?docTitle ?order ?siblingOrder ?blockId',
    'LIMIT 40',
  ].join('\n')
}

export function documentSwitcherBlockFromRow(
  row: Record<string, string>,
  graphId: string,
  query: string,
): MnDocumentSwitcherBlockItem | null {
  const documentId = documentIdFromTerm(row.docUri)
  const blockId = termText(row.blockId) ?? blockIdFromBlockTerm(row.block)
  const text = termText(row.text)
  if (!documentId || !blockId || !text) return null
  const label = termText(row.docTitle) ?? documentId
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
): MnDocumentSwitcherBlockItem[] {
  const seen = new Set<string>()
  const items: MnDocumentSwitcherBlockItem[] = []
  for (const row of rows) {
    const item = documentSwitcherBlockFromRow(row, graphId, query)
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
): Promise<MnDocumentSwitcherBlockItem[]> {
  if (normalized(query).length < 2) return []
  const result = (await rest.query(graphId, documentSwitcherBlocksSparql(graphId, query))) as QueryResult
  return documentSwitcherBlockItemsFromRows(result.rows ?? [], graphId, query, sort)
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

export function mergeDocumentSwitcherBlockItems(
  lexical: readonly MnDocumentSwitcherBlockItem[],
  semantic: readonly MnDocumentSwitcherBlockItem[],
  limit = 40,
): MnDocumentSwitcherBlockItem[] {
  const byId = new Map<string, MnDocumentSwitcherBlockItem>()
  for (const item of lexical) byId.set(item.id, item)
  for (const item of semantic) {
    const existing = byId.get(item.id)
    byId.set(item.id, existing
      ? {
          ...existing,
          matchSource: 'both',
          score: Math.max(existing.score ?? 0, item.score ?? 0),
        }
      : item)
  }
  return [...byId.values()]
    .sort((left, right) =>
      (right.score ?? 0) - (left.score ?? 0)
      || left.label.localeCompare(right.label)
      || left.id.localeCompare(right.id))
    .slice(0, limit)
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
