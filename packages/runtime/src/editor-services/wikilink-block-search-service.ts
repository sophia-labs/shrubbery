/**
 * wikilink-block-search-service.ts — graph-scoped block rows for the wikilink picker.
 *
 * Garden's picker fetched `/documents/{graph}/{doc}/blocks` after a document was chosen.
 * Shrubbery's runtime keeps that as a projection read: SELECT block nodes, map the
 * materialized TipTap tree triples into picker rows, then filter host-side.
 *
 * gardend writes a document's block triples into that document's own projection graph
 * (`...:projection:document:{id}`), not the workspace graph, which holds only the
 * document node. A query of the workspace graph alone found no blocks in offline Garden,
 * so the picker's block step was always empty (measured on default_x1, 2026-10-07). The
 * query reads both graphs, so a store that keeps blocks in the workspace graph still works.
 */

import type { EditorScope, RestClient } from '@shrubbery/nucleus'
import {
  RDF_TYPE,
  documentProjectionGraphIri,
  documentRefUri,
  workspaceProjectionGraphIri,
} from './sparql-terms.js'

export interface WikiLinkBlockItem {
  readonly id: string
  readonly type: 'heading' | 'paragraph' | 'listItem' | 'blockquote' | 'codeBlock'
  readonly level?: number
  readonly text: string
  readonly preview?: string
}

export interface WikiLinkBlockSearchService {
  suggest(documentId: string, query: string): Promise<WikiLinkBlockItem[]>
}

type SolutionRow = Record<string, string>

interface SolutionsResult {
  rows?: SolutionRow[]
}

export function wikilinkBlockListSparql(graphId: string, documentId: string): string {
  const ws = workspaceProjectionGraphIri(graphId)
  const doc = documentRefUri(documentId)
  return [
    'PREFIX doc: <http://mnemosyne.dev/doc#>',
    'SELECT DISTINCT ?block ?blockId ?text ?type ?level ?order ?siblingOrder',
    `WHERE {`,
    `  BIND(<${doc}> AS ?docUri)`,
    `  GRAPH <${ws}> { ?docUri a doc:TipTapDocument . }`,
    `  VALUES ?blockGraph { <${ws}> <${documentProjectionGraphIri(graphId, documentId)}> }`,
    '  GRAPH ?blockGraph {',
    `  ?block <${RDF_TYPE}> ?type .`,
    '  OPTIONAL { ?block doc:blockId ?flatBlockId . }',
    '  OPTIONAL { ?block doc:nodeId ?nodeBlockId . }',
    '  OPTIONAL { ?block doc:textContent ?text . }',
    '  OPTIONAL { ?block doc:level ?level . }',
    '  OPTIONAL { ?block doc:order ?order . }',
    '  OPTIONAL { ?block doc:siblingOrder ?siblingOrder . }',
    '  }',
    // Outside the GRAPH group: ?docUri is bound out here, not inside it.
    '  FILTER(STRSTARTS(STR(?block), CONCAT(STR(?docUri), "#block-")))',
    '  BIND(COALESCE(?flatBlockId, ?nodeBlockId, STRAFTER(STR(?block), "#block-")) AS ?blockId)',
    '}',
    'ORDER BY ?order ?siblingOrder ?blockId',
  ].join('\n')
}

/**
 * The document's tree: every parent→child edge in its projection graph, with
 * the child's siblingOrder. gardend numbers siblingOrder within each parent
 * and writes no document-wide doc:order on blocks, so the only true reading
 * order is a walk of this tree (wikilinkBlocksInTreeOrder). Inline children
 * (text runs, marks) carry no block id and are left out; list containers,
 * which also carry none, are kept so the walk can pass through them.
 */
export function wikilinkBlockTreeSparql(graphId: string, documentId: string): string {
  return [
    'PREFIX doc: <http://mnemosyne.dev/doc#>',
    'SELECT ?parent ?child ?siblingOrder ?parentType ?childType',
    'WHERE {',
    `  GRAPH <${documentProjectionGraphIri(graphId, documentId)}> {`,
    '    ?parent doc:childNode ?child .',
    '    OPTIONAL { ?child doc:siblingOrder ?siblingOrder . }',
    '    OPTIONAL { ?parent a ?parentType . }',
    '    OPTIONAL { ?child a ?childType . }',
    '  }',
    // TaskItems written by older Garden carry #node- ids, not #block-: keep
    // them too, or their task paragraphs would hang off a second root.
    '  FILTER(CONTAINS(STR(?child), "#block-") || STRENDS(STR(?childType), "List") || STRENDS(STR(?childType), "TaskItem"))',
    '}',
  ].join('\n')
}

/** Containers whose own text stands for their paragraphs: one row each. */
const ROW_CONTAINERS = new Set(['ListItem', 'Blockquote'])
/**
 * Structure the walk passes through without a row of its own. A TaskItem
 * has no block id or text of its own in gardend's projection; its paragraph
 * is the addressable block (2026-10-16: 14 tasks in one document vanished
 * while TaskItem was treated as a row container).
 */
const PASS_THROUGH = new Set([
  'XmlFragment', 'BulletList', 'OrderedList', 'TaskList', 'TaskItem',
  'Table', 'TableRow', 'TableCell', 'TableHeader',
])

/**
 * Blocks in reading order, each once (2026-10-14: the wiring list
 * showed list items twice and lists out of order). Walks the tree from the
 * fragment root by siblingOrder:
 * - a list item or quote is one row, its own text; its direct paragraphs
 *   are not rows (they are the same words, and the editor addresses the item),
 *   but nested items, quotes, images and code inside it still are;
 * - tables and lists are passed through to their paragraphs;
 * - any other block is a row, and the walk does not descend into it.
 * Blocks the walk does not reach (a document still in the older flat schema)
 * follow in their query order.
 */
export function wikilinkBlocksInTreeOrder(
  blockRows: readonly SolutionRow[],
  edgeRows: readonly SolutionRow[],
): WikiLinkBlockItem[] {
  const byIri = new Map<string, WikiLinkBlockItem>()
  const typeOf = new Map<string, string>()
  for (const row of blockRows) {
    const iri = row.block ? iriValue(row.block) : null
    const item = wikilinkBlockRowToItem(row)
    if (iri && item && !byIri.has(iri)) byIri.set(iri, item)
  }
  const children = new Map<string, Array<{ iri: string, order: number }>>()
  const isChild = new Set<string>()
  for (const row of edgeRows) {
    const parent = row.parent ? iriValue(row.parent) : null
    const child = row.child ? iriValue(row.child) : null
    if (!parent || !child) continue
    if (row.parentType) typeOf.set(parent, localName(termText(row.parentType) ?? ''))
    if (row.childType) typeOf.set(child, localName(termText(row.childType) ?? ''))
    const list = children.get(parent) ?? []
    if (!list.some(entry => entry.iri === child)) {
      list.push({ iri: child, order: parseInteger(row.siblingOrder) ?? Number.MAX_SAFE_INTEGER })
    }
    children.set(parent, list)
    isChild.add(child)
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order || a.iri.localeCompare(b.iri))
  const roots = [...children.keys()].filter(iri => !isChild.has(iri))
    .sort((a, b) => Number(typeOf.get(b) === 'XmlFragment') - Number(typeOf.get(a) === 'XmlFragment'))

  const out: WikiLinkBlockItem[] = []
  const emitted = new Set<string>()
  const seen = new Set<string>()
  const emit = (iri: string): void => {
    const item = byIri.get(iri)
    if (item && !emitted.has(item.id)) {
      emitted.add(item.id)
      out.push(item)
    }
  }
  const walk = (iri: string, skipParagraphs: boolean): void => {
    if (seen.has(iri)) return
    seen.add(iri)
    const type = typeOf.get(iri) ?? ''
    if (skipParagraphs && type === 'Paragraph') return
    if (ROW_CONTAINERS.has(type)) {
      emit(iri)
      for (const child of children.get(iri) ?? []) walk(child.iri, true)
      return
    }
    if (PASS_THROUGH.has(type) || (!byIri.has(iri) && children.has(iri))) {
      for (const child of children.get(iri) ?? []) walk(child.iri, false)
      return
    }
    emit(iri)
  }
  for (const root of roots) walk(root, false)
  // Anything the walk never reached keeps its query position, after. Blocks
  // it reached and chose not to list (a list item's own paragraph) stay out.
  for (const [iri, item] of byIri) {
    if (seen.has(iri) || emitted.has(item.id)) continue
    emitted.add(item.id)
    out.push(item)
  }
  return out
}

/**
 * With no query, the whole document in order, to scroll; with one, every
 * block that contains it. A cap of 20 used to cut the list short, so blocks
 * past the twentieth looked missing (2026-10-14). The ceiling that
 * remains only guards against a pathological document.
 */
export const WIKILINK_BLOCK_LIMIT = 2000

export function filterWikiLinkBlocks(
  items: readonly WikiLinkBlockItem[],
  query: string,
): WikiLinkBlockItem[] {
  const q = query.toLowerCase().trim()
  if (!q) return items.slice(0, WIKILINK_BLOCK_LIMIT)
  return items
    .filter((block) => block.text.toLowerCase().includes(q))
    .slice(0, WIKILINK_BLOCK_LIMIT)
}

export function wikilinkBlockRowsToItems(rows: readonly SolutionRow[]): WikiLinkBlockItem[] {
  const out: WikiLinkBlockItem[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const item = wikilinkBlockRowToItem(row)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

function wikilinkBlockRowToItem(row: SolutionRow): WikiLinkBlockItem | null {
  const id = termText(row.blockId) ?? blockIdFromTerm(row.block)
  if (!id) return null
  const text = termText(row.text)?.trim()
  if (!text) return null
  const type = pickerBlockType(row.type)
  const level = parseInteger(row.level)
  return {
    id,
    type,
    ...(type === 'heading' && level !== undefined ? { level } : {}),
    text,
    preview: text.length > 80 ? `${text.slice(0, 80)}...` : text,
  }
}

function termText(term: string | undefined): string | null {
  if (!term) return null
  const value = term[0] === '"' ? unquoteLiteral(term) : iriValue(term)
  return value.trim() || null
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

function blockIdFromTerm(term: string | undefined): string | null {
  if (!term) return null
  const iri = iriValue(term)
  const marker = '#block-'
  const index = iri.indexOf(marker)
  return index >= 0 ? iri.slice(index + marker.length) : null
}

function parseInteger(term: string | undefined): number | undefined {
  if (!term) return undefined
  const match = /^"?(-?\d+)"?(?:\^\^<[^>]+>)?$/.exec(term.trim())
  if (!match) return undefined
  const value = Number.parseInt(match[1]!, 10)
  return Number.isFinite(value) ? value : undefined
}

function pickerBlockType(term: string | undefined): WikiLinkBlockItem['type'] {
  const local = localName(termText(term) ?? '')
  switch (local) {
    case 'Heading':
    case 'heading':
      return 'heading'
    case 'ListItem':
    case 'TaskItem':
    case 'listItem':
    case 'todo':
      return 'listItem'
    case 'Blockquote':
    case 'blockquote':
    case 'quote':
      return 'blockquote'
    case 'CodeBlock':
    case 'codeBlock':
    case 'code':
      return 'codeBlock'
    default:
      return 'paragraph'
  }
}

function localName(value: string): string {
  const hash = value.lastIndexOf('#')
  if (hash >= 0 && hash < value.length - 1) return value.slice(hash + 1)
  const slash = value.lastIndexOf('/')
  if (slash >= 0 && slash < value.length - 1) return value.slice(slash + 1)
  return value
}

/**
 * How long one document's block list is reused. Each keystroke in the picker
 * filters the whole document; without this every key re-read it twice.
 */
const BLOCK_LIST_TTL_MS = 10_000

export function makeWikiLinkBlockSearchService(
  rest: RestClient,
  getScope: () => EditorScope,
  now: () => number = Date.now,
): WikiLinkBlockSearchService {
  let cached: { key: string, at: number, items: Promise<WikiLinkBlockItem[]> } | null = null
  const load = (graphId: string, documentId: string): Promise<WikiLinkBlockItem[]> => {
    const key = `${graphId}\u0000${documentId}`
    if (cached && cached.key === key && now() - cached.at < BLOCK_LIST_TTL_MS) return cached.items
    const items = readBlocksInOrder(rest, graphId, documentId)
    cached = { key, at: now(), items }
    // A failed read is not reused.
    items.catch(() => { if (cached?.items === items) cached = null })
    return items
  }
  return {
    async suggest(documentId: string, query: string): Promise<WikiLinkBlockItem[]> {
      const graphId = getScope().graphId
      if (!graphId || !documentId) return []
      // Entering the block step (no query yet) always reads fresh, so a
      // block written a moment ago is there; typing filters that copy.
      if (!query.trim()) cached = null
      return filterWikiLinkBlocks(await load(graphId, documentId), query)
    },
  }
}

async function readBlocksInOrder(rest: RestClient, graphId: string, documentId: string): Promise<WikiLinkBlockItem[]> {
  const [blocks, tree] = await Promise.all([
    rest.query(graphId, wikilinkBlockListSparql(graphId, documentId)) as Promise<SolutionsResult>,
    // The order is a refinement: without the tree the list still works.
    (rest.query(graphId, wikilinkBlockTreeSparql(graphId, documentId)) as Promise<SolutionsResult>)
      .catch((): SolutionsResult => ({ rows: [] })),
  ])
  return wikilinkBlocksInTreeOrder(blocks.rows ?? [], tree.rows ?? [])
}
