/**
 * wikilink-block-search-service.ts — graph-scoped block rows for the wikilink picker.
 *
 * Garden's picker fetched `/documents/{graph}/{doc}/blocks` after a document was chosen.
 * Shrubbery's runtime keeps that as a projection read: SELECT block nodes from the same
 * workspace projection graph that powers wikilink document search, map the materialized
 * TipTap tree triples into picker rows, then filter host-side.
 */

import type { EditorScope, RestClient } from '@shrubbery/nucleus'
import {
  RDF_TYPE,
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
    `WHERE { GRAPH <${ws}> {`,
    `  BIND(<${doc}> AS ?docUri)`,
    '  ?docUri a doc:TipTapDocument .',
    `  ?block <${RDF_TYPE}> ?type .`,
    '  FILTER(STRSTARTS(STR(?block), CONCAT(STR(?docUri), "#block-")))',
    '  OPTIONAL { ?block doc:blockId ?flatBlockId . }',
    '  OPTIONAL { ?block doc:nodeId ?nodeBlockId . }',
    '  OPTIONAL { ?block doc:textContent ?text . }',
    '  OPTIONAL { ?block doc:level ?level . }',
    '  OPTIONAL { ?block doc:order ?order . }',
    '  OPTIONAL { ?block doc:siblingOrder ?siblingOrder . }',
    '  BIND(COALESCE(?flatBlockId, ?nodeBlockId, STRAFTER(STR(?block), "#block-")) AS ?blockId)',
    '} }',
    'ORDER BY ?order ?siblingOrder ?blockId',
  ].join('\n')
}

export function filterWikiLinkBlocks(
  items: readonly WikiLinkBlockItem[],
  query: string,
): WikiLinkBlockItem[] {
  const q = query.toLowerCase().trim()
  if (!q) return items.slice(0, 20)
  return items
    .filter((block) => block.text.toLowerCase().includes(q))
    .slice(0, 20)
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

export function makeWikiLinkBlockSearchService(
  rest: RestClient,
  getScope: () => EditorScope,
): WikiLinkBlockSearchService {
  return {
    async suggest(documentId: string, query: string): Promise<WikiLinkBlockItem[]> {
      const graphId = getScope().graphId
      if (!graphId || !documentId) return []
      const result = (await rest.query(graphId, wikilinkBlockListSparql(graphId, documentId))) as SolutionsResult
      return filterWikiLinkBlocks(wikilinkBlockRowsToItems(result.rows ?? []), query)
    },
  }
}
