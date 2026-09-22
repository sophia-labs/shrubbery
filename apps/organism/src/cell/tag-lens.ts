/**
 * Tag-lens projection for the Organism shell.
 *
 * This is the shell-side half of the read-only `mn-tag-view` port. It reads a
 * GRAPH-scoped `doc:hasTag` projection from the live cell and shapes rows into
 * the structural block model that runtime forwards to the backend-free
 * component. UI packages do not import this file.
 */

import { workspaceProjectionGraphIri, type TagLensBlock } from '@shrubbery/runtime'

interface QueryResult {
  readonly rows?: ReadonlyArray<Record<string, string>>
}

export interface TagLensRest {
  query(graphId: string, sparql: string): Promise<unknown>
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

  const docMarker = ':doc:'
  const docMarkerIndex = iri.lastIndexOf(docMarker)
  if (docMarkerIndex >= 0) return iri.slice(docMarkerIndex + docMarker.length)

  const lastSlash = iri.lastIndexOf('/')
  if (lastSlash >= 0 && lastSlash < iri.length - 1) return iri.slice(lastSlash + 1)

  const lastColon = iri.lastIndexOf(':')
  if (lastColon >= 0 && lastColon < iri.length - 1) return iri.slice(lastColon + 1)

  return null
}

function blockIdFromBlockTerm(term: string | undefined): string | null {
  if (!term) return null
  const iri = iriValue(term)
  const marker = '#block-'
  const index = iri.indexOf(marker)
  return index >= 0 ? iri.slice(index + marker.length) : null
}

function typeName(term: string | undefined): string | null {
  const text = termText(term)
  if (!text) return null
  const hash = text.lastIndexOf('#')
  if (hash >= 0 && hash < text.length - 1) return text.slice(hash + 1)
  const slash = text.lastIndexOf('/')
  if (slash >= 0 && slash < text.length - 1) return text.slice(slash + 1)
  return text
}

export function tagLensBlocksSparql(graphId: string, tagName: string): string {
  const ws = workspaceProjectionGraphIri(graphId)
  const tag = escapeSparqlLiteral(tagName)
  return [
    'PREFIX doc: <http://mnemosyne.dev/doc#>',
    'PREFIX dcterms: <http://purl.org/dc/terms/>',
    'SELECT DISTINCT ?block ?docUri ?blockId ?docTitle ?docUpdated ?text ?type ?order ?siblingOrder',
    `WHERE { GRAPH <${ws}> {`,
    `  ?block doc:hasTag ${tag} .`,
    '  BIND(IRI(STRBEFORE(STR(?block), "#")) AS ?docUri)',
    '  BIND(STRAFTER(STR(?block), "#block-") AS ?fragmentBlockId)',
    '  OPTIONAL { ?block doc:blockId ?flatBlockId . }',
    '  OPTIONAL { ?block doc:nodeId ?nodeBlockId . }',
    '  OPTIONAL { ?block doc:textContent ?text . }',
    '  OPTIONAL { ?block doc:blockType ?blockType . }',
    '  OPTIONAL { ?block doc:type ?docType . }',
    '  OPTIONAL { ?block doc:order ?order . }',
    '  OPTIONAL { ?block doc:siblingOrder ?siblingOrder . }',
    '  ?docUri a doc:TipTapDocument .',
    '  OPTIONAL { ?docUri dcterms:title ?dctitle . }',
    '  OPTIONAL { ?docUri doc:title ?doctitle . }',
    '  OPTIONAL { ?docUri doc:updatedAt ?docUpdated . }',
    '  BIND(COALESCE(?flatBlockId, ?nodeBlockId, ?fragmentBlockId) AS ?blockId)',
    '  BIND(COALESCE(?blockType, ?docType) AS ?type)',
    '  BIND(COALESCE(?dctitle, ?doctitle, "Untitled") AS ?docTitle)',
    '} }',
    'ORDER BY DESC(?docUpdated) ?docUri ?order ?siblingOrder ?blockId',
  ].join('\n')
}

export function tagLensBlockFromRow(row: Record<string, string>): TagLensBlock | null {
  const documentId = documentIdFromTerm(row.docUri)
  if (!documentId) return null
  const blockId = termText(row.blockId) ?? blockIdFromBlockTerm(row.block)
  if (!blockId) return null
  const text = termText(row.text) ?? ''
  const documentTitle = termText(row.docTitle) ?? documentId
  return {
    id: `${documentId}:${blockId}`,
    documentId,
    documentTitle,
    blockId,
    text,
    type: typeName(row.type),
    updatedAt: termText(row.docUpdated),
  }
}

export async function loadTagLensBlocks(
  rest: TagLensRest,
  graphId: string,
  tagName: string,
): Promise<TagLensBlock[]> {
  const result = (await rest.query(graphId, tagLensBlocksSparql(graphId, tagName))) as QueryResult
  const blocks: TagLensBlock[] = []
  const seen = new Set<string>()
  for (const row of result.rows ?? []) {
    const block = tagLensBlockFromRow(row)
    if (!block || seen.has(block.id)) continue
    seen.add(block.id)
    blocks.push(block)
  }
  return blocks
}
