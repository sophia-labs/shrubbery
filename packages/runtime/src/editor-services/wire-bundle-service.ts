/**
 * wire-bundle-service.ts — read-side Garden wire bundle over the workspace projection.
 *
 * This is the counterpart to WireService's write seam. Writes go through WireWriter
 * because projection graphs are authority-read-only; reads are ordinary GRAPH-scoped
 * SPARQL over the materialized workspace projection, the same substrate used by the
 * wikilink picker.
 */

import type { EditorScope, RestClient } from '@shrubbery/nucleus'
import { getWirePredicateLabel } from '@shrubbery/nucleus'
import { documentRefUri, workspaceProjectionGraphIri, wirePredicateUri } from './sparql-terms.js'
import { DEFAULT_WIKILINK_PREDICATE } from './wire-service.js'

export interface WireSummary {
  readonly id: string
  readonly predicate: string
  readonly predicateLabel: string
  readonly otherDocumentId: string
  readonly otherGraphId: string
  readonly otherBlockId?: string
  /** The far end is a typed object, not a document: its IRI (`otherDocumentId` is then empty). */
  readonly otherIri?: string
  /** The board an arrow was promoted from, and the arrow's element id (absent for wires not drawn on a board). */
  readonly sceneDocumentId?: string
  readonly sceneElementId?: string
  readonly localBlockId?: string
  readonly otherTitle?: string
  readonly otherSnippet?: string
  readonly localSnippet?: string
  readonly bidirectional: boolean
  readonly snapshotAt?: string
}

export interface WireBundle {
  readonly outgoingWires: readonly WireSummary[]
  readonly incomingWires: readonly WireSummary[]
  readonly wiredBlockIds: readonly string[]
}

export interface WireBundleService {
  loadBundle(graphId: string, documentId: string): Promise<WireBundle>
}

type SolutionRow = Record<string, string>

interface SolutionsResult {
  rows?: SolutionRow[]
}

export const EMPTY_WIRE_BUNDLE: WireBundle = {
  outgoingWires: [],
  incomingWires: [],
  wiredBlockIds: [],
}

export function wireBundleSparql(graphId: string, documentId: string): string {
  const ws = workspaceProjectionGraphIri(graphId)
  const document = documentRefUri(documentId)
  return [
    'PREFIX mnemo: <http://mnemosyne.ai/vocab#>',
    'PREFIX doc: <http://mnemosyne.dev/doc#>',
    'PREFIX dcterms: <http://purl.org/dc/terms/>',
    'SELECT ?wire ?sourceDoc ?targetDoc ?sourceRes ?targetRes ?sceneDoc ?sceneEl ?sourceBlock ?targetBlock ?targetGraph ?predicate ?bidirectional',
    '       (COALESCE(?cachedSourceTitle, ?sourceDctitle, ?sourceDocTitle, "Untitled") AS ?sourceTitle)',
    '       (COALESCE(?cachedTargetTitle, ?targetDctitle, ?targetDocTitle, "Untitled") AS ?targetTitle)',
    '       ?sourceSnippet ?targetSnippet (COALESCE(?wireSnapshotAt, ?wireCreatedAt) AS ?snapshotAt)',
    `WHERE { GRAPH <${ws}> {`,
    '  ?wire a mnemo:Wire .',
    // A wire end is a document or, since whiteboard semantics, a typed object (`*Resource`), so the document ends
    // are optional; a wire also belongs to the board it was drawn on (`sceneDocumentId`, a string).
    // The title lookups nest inside the document end: with the end unbound they would match every title.
    '  OPTIONAL { ?wire mnemo:sourceDocument ?sourceDoc .',
    '    OPTIONAL { ?sourceDoc dcterms:title ?sourceDctitle }',
    '    OPTIONAL { ?sourceDoc doc:title ?sourceDocTitle } }',
    '  OPTIONAL { ?wire mnemo:targetDocument ?targetDoc .',
    '    OPTIONAL { ?targetDoc dcterms:title ?targetDctitle }',
    '    OPTIONAL { ?targetDoc doc:title ?targetDocTitle } }',
    '  OPTIONAL { ?wire mnemo:sourceResource ?sourceRes }',
    '  OPTIONAL { ?wire mnemo:targetResource ?targetRes }',
    '  OPTIONAL { ?wire mnemo:sceneDocumentId ?sceneDoc }',
    '  OPTIONAL { ?wire mnemo:sceneElementId ?sceneEl }',
    `  FILTER(?sourceDoc = <${document}> || ?targetDoc = <${document}> || ?sceneDoc = ${JSON.stringify(documentId)})`,
    '  OPTIONAL { ?wire mnemo:sourceBlock ?sourceBlock }',
    '  OPTIONAL { ?wire mnemo:targetBlock ?targetBlock }',
    '  OPTIONAL { ?wire mnemo:targetGraph ?targetGraph }',
    '  OPTIONAL { ?wire mnemo:predicate ?predicate }',
    '  OPTIONAL { ?wire mnemo:bidirectional ?bidirectional }',
    '  OPTIONAL { ?wire mnemo:sourceTitle ?cachedSourceTitle }',
    '  OPTIONAL { ?wire mnemo:targetTitle ?cachedTargetTitle }',
    '  OPTIONAL { ?wire mnemo:sourceSnippet ?sourceSnippet }',
    '  OPTIONAL { ?wire mnemo:targetSnippet ?targetSnippet }',
    '  OPTIONAL { ?wire mnemo:snapshotAt ?wireSnapshotAt }',
    '  OPTIONAL { ?wire doc:createdAt ?wireCreatedAt }',
    '} }',
    'ORDER BY ?wire',
  ].join('\n')
}

export function deduplicateBidirectionalWires(
  outgoing: readonly WireSummary[],
  incoming: readonly WireSummary[],
): WireSummary[] {
  const outgoingBidirectionalIds = new Set<string>()
  const outgoingBidirectionalSignatures = new Set<string>()
  for (const wire of outgoing) {
    if (!wire.bidirectional) continue
    outgoingBidirectionalIds.add(wire.id)
    outgoingBidirectionalSignatures.add(
      `${wire.otherDocumentId}|${wire.otherBlockId ?? ''}|${wire.predicate}`,
    )
  }
  return incoming.filter((wire) => {
    if (!wire.bidirectional) return true
    const baseId = wire.id.replace(/-inv$/, '')
    if (baseId !== wire.id && outgoingBidirectionalIds.has(baseId)) return false
    const signature = `${wire.otherDocumentId}|${wire.otherBlockId ?? ''}|${wire.predicate}`
    return !outgoingBidirectionalSignatures.has(signature)
  })
}

export function buildWiredBlockIdSet(
  explicitBlockIds: readonly string[],
  outgoing: readonly WireSummary[],
  incoming: readonly WireSummary[],
): string[] {
  const ids = new Set<string>()
  for (const blockId of explicitBlockIds) {
    if (blockId) ids.add(blockId)
  }
  for (const wire of [...outgoing, ...incoming]) {
    if (wire.localBlockId) ids.add(wire.localBlockId)
  }
  return Array.from(ids).sort()
}

export function makeWireBundleService(rest: RestClient): WireBundleService {
  return {
    async loadBundle(graphId: string, documentId: string): Promise<WireBundle> {
      const result = (await rest.query(graphId, wireBundleSparql(graphId, documentId))) as SolutionsResult
      return rowsToWireBundle(graphId, documentId, result.rows ?? [])
    },
  }
}

export function makeScopedWireBundleLoader(
  rest: RestClient,
  getScope: () => EditorScope,
): () => Promise<WireBundle> {
  const service = makeWireBundleService(rest)
  return async () => {
    const scope = getScope()
    if (!scope.graphId || !scope.documentId) return EMPTY_WIRE_BUNDLE
    return service.loadBundle(scope.graphId, scope.documentId)
  }
}

export function rowsToWireBundle(
  graphId: string,
  documentId: string,
  rows: readonly SolutionRow[],
): WireBundle {
  const outgoing: WireSummary[] = []
  const incoming: WireSummary[] = []
  for (const row of rows) {
    const sourceDocumentId = bareDocumentId(row.sourceDoc)
    const targetDocumentId = bareDocumentId(row.targetDoc)
    // Each end names a document or an object; a wire with an unnamed end is not a wire.
    if (!sourceDocumentId && !namedNodeIri(row.sourceRes)) continue
    if (!targetDocumentId && !namedNodeIri(row.targetRes)) continue

    // A wire drawn on this board with neither end in it is listed as outgoing (its far end is the target).
    const drawnHere = unquoteLiteral(row.sceneDoc) === documentId
    const isOutgoing = sourceDocumentId === documentId || (drawnHere && targetDocumentId !== documentId)
    const isIncoming = targetDocumentId === documentId
    if (!isOutgoing && !isIncoming) continue

    if (isOutgoing) outgoing.push(rowToWireSummary(graphId, row, true))
    if (isIncoming && (!isOutgoing || row.targetBlock !== row.sourceBlock)) {
      incoming.push(rowToWireSummary(graphId, row, false))
    }
  }
  const dedupedIncoming = deduplicateBidirectionalWires(outgoing, incoming)
  return {
    outgoingWires: outgoing,
    incomingWires: dedupedIncoming,
    wiredBlockIds: buildWiredBlockIdSet([], outgoing, dedupedIncoming),
  }
}

function rowToWireSummary(graphId: string, row: SolutionRow, outgoing: boolean): WireSummary {
  const sourceDocumentId = bareDocumentId(row.sourceDoc) ?? ''
  const targetDocumentId = bareDocumentId(row.targetDoc) ?? ''
  const sourceBlockId = bareBlockId(row.sourceBlock)
  const targetBlockId = bareBlockId(row.targetBlock)
  const predicate = namedNodeIri(row.predicate) ?? wirePredicateUri(DEFAULT_WIKILINK_PREDICATE)
  const otherDocumentId = outgoing ? targetDocumentId : sourceDocumentId
  const otherIri = (outgoing ? namedNodeIri(row.targetRes) : namedNodeIri(row.sourceRes)) ?? undefined
  const sceneDocumentId = unquoteLiteral(row.sceneDoc)
  const sceneElementId = unquoteLiteral(row.sceneEl)
  const otherGraphId = outgoing ? unquoteLiteral(row.targetGraph) || graphId : graphId
  const otherBlockId = outgoing ? targetBlockId : sourceBlockId
  const localBlockId = outgoing ? sourceBlockId : targetBlockId
  const rawTitle = outgoing ? unquoteLiteral(row.targetTitle) : unquoteLiteral(row.sourceTitle)
  // An object end has no document to title it: "Untitled" is the query's filler, not a title.
  const otherTitle = otherIri && !otherDocumentId && rawTitle === 'Untitled' ? '' : rawTitle
  const localSnippet = outgoing ? unquoteLiteral(row.sourceSnippet) : unquoteLiteral(row.targetSnippet)
  const otherSnippet = outgoing ? unquoteLiteral(row.targetSnippet) : unquoteLiteral(row.sourceSnippet)
  return {
    id: bareWireId(row.wire) ?? namedNodeIri(row.wire) ?? row.wire ?? '',
    predicate,
    predicateLabel: getWirePredicateLabel(predicate),
    otherDocumentId,
    otherGraphId,
    ...(otherBlockId ? { otherBlockId } : {}),
    ...(otherIri ? { otherIri } : {}),
    ...(sceneDocumentId ? { sceneDocumentId } : {}),
    ...(sceneElementId ? { sceneElementId } : {}),
    ...(localBlockId ? { localBlockId } : {}),
    ...(otherTitle ? { otherTitle } : {}),
    ...(otherSnippet ? { otherSnippet } : {}),
    ...(localSnippet ? { localSnippet } : {}),
    bidirectional: booleanLiteral(row.bidirectional),
    ...(row.snapshotAt ? { snapshotAt: unquoteLiteral(row.snapshotAt) } : {}),
  }
}

function namedNodeIri(term: string | undefined): string | null {
  if (!term) return null
  return term.startsWith('<') && term.endsWith('>') ? term.slice(1, -1) : term
}

function bareDocumentId(term: string | undefined): string | null {
  const iri = namedNodeIri(term)
  if (!iri) return null
  const prefix = 'urn:mnemosyne:local:document:'
  return iri.startsWith(prefix) ? iri.slice(prefix.length) : iri
}

function bareWireId(term: string | undefined): string | null {
  const iri = namedNodeIri(term)
  if (!iri) return null
  const marker = ':wire:'
  const index = iri.indexOf(marker)
  return index >= 0 ? iri.slice(index + marker.length) : null
}

function bareBlockId(term: string | undefined): string | undefined {
  const iri = namedNodeIri(term)
  if (!iri) return undefined
  const marker = '#block-'
  const index = iri.indexOf(marker)
  return index >= 0 ? iri.slice(index + marker.length) : iri
}

function booleanLiteral(term: string | undefined): boolean {
  if (!term) return false
  const value = unquoteLiteral(term).toLowerCase()
  return value === 'true' || value === '1'
}

function unquoteLiteral(term: string | undefined): string {
  if (!term) return ''
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
