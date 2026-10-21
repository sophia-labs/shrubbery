/**
 * layout.ts — the app's pages as data: one LayoutDocument per route, kept in the
 * graph's `:ux:config` as `ux:layoutJson` (the Koch pattern), validated by the
 * nucleus layout validator against this app's closed face catalogue.
 *
 * A route the graph has no layout for uses the app's built-in one and the
 * footer says so ("layout: built-in"). A layout the graph states but that fails
 * validation is refused, loudly, never silently replaced.
 *
 * The piece page is authored once, against the placeholder resource
 * `urn:ovillo:route:piece`; the shell binds it to the piece in the route.
 */

import {
  TripleSourceError,
  termToNT,
  type Triple,
  type TripleSource,
} from '@shrubbery/nucleus'
import {
  createValidatedLayoutDocument,
  type GridCell,
  type LayoutDocument,
  type LayoutNode,
  type ViewDescriptor,
} from '@shrubbery/nucleus/layout'
import { OVILLO_FACE_IDS, isOvilloFaceId, type OvilloFaceId } from './face-ids.js'
import { readGraph } from './graph-read.js'
import { OVILLO_GRAPH_ID, OVILLO_UX_GRAPH, RDFS_LABEL, RDF_TYPE, SITE_ORIGIN } from './vocab.js'

export const UX_NS = 'http://mnemosyne.dev/ux#'
export const UX_LAYOUT_JSON = `${UX_NS}layoutJson`
export const UX_LAYOUT_DOCUMENT = `${UX_NS}LayoutDocument`

export const ROUTE_NAMES = ['home', 'piece', 'bench', 'tract', 'score'] as const
export type OvilloRouteName = (typeof ROUTE_NAMES)[number]

/** The placeholder resource the piece-route layouts are authored against. */
export const PIECE_PLACEHOLDER = 'urn:ovillo:route:piece'

export const surfaceIri = (route: OvilloRouteName): string => `${SITE_ORIGIN}/id/surface/${route}`

const ROUTE_LABELS: Record<OvilloRouteName, string> = {
  home: 'Ovillo gallery',
  piece: 'Ovillo piece page',
  bench: 'Ovillo bench',
  tract: 'Ovillo tract',
  score: 'Ovillo score editor',
}

export class OvilloLayoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OvilloLayoutError'
  }
}

function descriptor(faceId: OvilloFaceId, iri: string, bindingId: string): ViewDescriptor {
  return { schemaVersion: 1, faceId, resource: { kind: 'iri', iri }, params: { bindingId } }
}

function cell(id: string, faceId: OvilloFaceId, iri: string, span?: 1 | 2 | 3): GridCell {
  return { id, descriptor: descriptor(faceId, iri, id), ...(span ? { span } : {}) }
}

function gridDoc(route: OvilloRouteName, minCellWidth: number, cells: GridCell[], timestamp: string): LayoutDocument {
  const rootId = `ovillo-${route}-grid`
  const nodes: Record<string, LayoutNode> = {
    [rootId]: { kind: 'grid', id: rootId, flow: 'reflow', minCellWidth, gridRevision: 0, children: { kind: 'fixed', cells } },
  }
  return { schemaVersion: 1, layoutId: `ovillo-${route}-v1`, scope: 'workspace', graphId: OVILLO_GRAPH_ID, rootNodeId: rootId, nodes, createdAt: timestamp, updatedAt: timestamp }
}

function leafDoc(route: OvilloRouteName, faceId: OvilloFaceId, iri: string, timestamp: string): LayoutDocument {
  const id = `ovillo-${route}`
  return {
    schemaVersion: 1,
    layoutId: `ovillo-${route}-v1`,
    scope: 'workspace',
    graphId: OVILLO_GRAPH_ID,
    rootNodeId: id,
    nodes: { [id]: { kind: 'leaf', id, descriptor: descriptor(faceId, iri, route), descriptorRevision: 0 } },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function validateOvilloLayout(candidate: LayoutDocument) {
  return createValidatedLayoutDocument(candidate, {
    isFaceRegistered: (view) => isOvilloFaceId(view.faceId),
    isFaceGridEligible: isOvilloFaceId,
  })
}

/** The app's own layouts: what a graph without `:ux:config` gets, and what the fixture stores. */
export function defaultOvilloLayouts(timestamp = '2026-10-20T00:00:00.000Z'): Record<OvilloRouteName, LayoutDocument> {
  const id = (kind: string): string => `${SITE_ORIGIN}/id/${kind}`
  const docs: Record<OvilloRouteName, LayoutDocument> = {
    home: gridDoc('home', 320, [
      cell('gallery', OVILLO_FACE_IDS.gallery, id('gallery'), 3),
      cell('now', OVILLO_FACE_IDS.now, id('gallery/now'), 2),
      cell('about', OVILLO_FACE_IDS.about, id('about')),
    ], timestamp),
    piece: gridDoc('piece', 320, [
      cell('player', OVILLO_FACE_IDS.piecePlayer, PIECE_PLACEHOLDER, 3),
      cell('trace', OVILLO_FACE_IDS.pieceTrace, PIECE_PLACEHOLDER, 3),
      cell('ledger', OVILLO_FACE_IDS.pieceLedger, PIECE_PLACEHOLDER),
      cell('world', OVILLO_FACE_IDS.pieceWorld, PIECE_PLACEHOLDER),
      cell('receipt', OVILLO_FACE_IDS.pieceReceipt, PIECE_PLACEHOLDER),
      cell('score', OVILLO_FACE_IDS.pieceScore, PIECE_PLACEHOLDER, 3),
    ], timestamp),
    bench: leafDoc('bench', OVILLO_FACE_IDS.bench, id('bench'), timestamp),
    tract: leafDoc('tract', OVILLO_FACE_IDS.tract, id('tract'), timestamp),
    score: leafDoc('score', OVILLO_FACE_IDS.scoreEditor, PIECE_PLACEHOLDER, timestamp),
  }
  for (const [route, doc] of Object.entries(docs)) {
    const verdict = validateOvilloLayout(doc)
    if (!verdict.ok) throw new OvilloLayoutError(`the built-in ${route} layout is invalid: ${JSON.stringify(verdict.diagnostics)}`)
  }
  return docs
}

/** Bind a piece-route layout to one piece: the placeholder resource becomes the piece's IRI. */
export function bindPieceLayout(doc: LayoutDocument, pieceIri: string): LayoutDocument {
  const bind = (d: ViewDescriptor): ViewDescriptor =>
    d.resource.kind === 'iri' && d.resource.iri === PIECE_PLACEHOLDER ? { ...d, resource: { kind: 'iri', iri: pieceIri } } : d
  const nodes: Record<string, LayoutNode> = {}
  for (const [key, node] of Object.entries(doc.nodes)) {
    if (node.kind === 'leaf') nodes[key] = { ...node, descriptor: bind(node.descriptor) }
    else if (node.kind === 'grid' && node.children.kind === 'fixed') {
      nodes[key] = { ...node, children: { kind: 'fixed', cells: node.children.cells.map((c) => ({ ...c, descriptor: bind(c.descriptor) })) } }
    } else nodes[key] = node
  }
  return { ...doc, nodes }
}

/** The `:ux:config` triples that state these layouts. */
export function layoutTriples(docs: Partial<Record<OvilloRouteName, LayoutDocument>>): Triple[] {
  const out: Triple[] = []
  for (const route of ROUTE_NAMES) {
    const doc = docs[route]
    if (!doc) continue
    const s = surfaceIri(route)
    out.push({ s, p: RDF_TYPE, o: { type: 'iri', value: UX_LAYOUT_DOCUMENT } })
    out.push({ s, p: RDFS_LABEL, o: { type: 'literal', value: ROUTE_LABELS[route] } })
    out.push({ s, p: UX_LAYOUT_JSON, o: { type: 'literal', value: JSON.stringify(doc) } })
  }
  return out
}

/** N-Triples for a `:ux:config` file (one statement per line, a final newline). */
export function layoutNTriples(docs: Partial<Record<OvilloRouteName, LayoutDocument>>): string {
  return `${layoutTriples(docs).map((t) => `<${t.s}> <${t.p}> ${termToNT(t.o)} .`).join('\n')}\n`
}

export interface OvilloLayouts {
  readonly docs: Record<OvilloRouteName, LayoutDocument>
  /** Per route: from the graph, or the app's built-in one. */
  readonly sources: Record<OvilloRouteName, 'graph' | 'built-in'>
  readonly readAt: number | null
  /** Why no graph layout was read at all, when none was (e.g. the file is not served). */
  readonly missing: string | null
}

/** Read the layouts from `:ux:config`; each route the graph does not state falls back to the built-in, and says so. */
export async function loadOvilloLayouts(source: TripleSource): Promise<OvilloLayouts> {
  const builtIn = defaultOvilloLayouts()
  const docs = { ...builtIn }
  const sources = Object.fromEntries(ROUTE_NAMES.map((r) => [r, 'built-in'])) as Record<OvilloRouteName, 'graph' | 'built-in'>
  let triples: readonly Triple[]
  let readAt: number | null = null
  try {
    const read = await readGraph(source, OVILLO_UX_GRAPH)
    triples = read.triples
    readAt = read.testimony.readAt
  } catch (cause) {
    if (cause instanceof TripleSourceError && cause.code === 'not-found') {
      return { docs, sources, readAt, missing: `${cause.message}${cause.detail ? ` (${cause.detail})` : ''}` }
    }
    throw cause
  }
  for (const route of ROUTE_NAMES) {
    const values = triples.filter((t) => t.s === surfaceIri(route) && t.p === UX_LAYOUT_JSON)
    if (values.length === 0) continue
    if (values.length > 1) throw new OvilloLayoutError(`<${surfaceIri(route)}> has ${values.length} ux:layoutJson values; refusing to pick one`)
    let candidate: unknown
    try {
      candidate = JSON.parse(values[0].o.value)
    } catch (e) {
      throw new OvilloLayoutError(`the ${route} ux:layoutJson is not JSON: ${e instanceof Error ? e.message : String(e)}`)
    }
    const verdict = validateOvilloLayout(candidate as LayoutDocument)
    if (!verdict.ok) throw new OvilloLayoutError(`the graph's ${route} layout failed validation: ${JSON.stringify(verdict.diagnostics)}`)
    docs[route] = verdict.doc
    sources[route] = 'graph'
  }
  return { docs, sources, readAt, missing: triples.length === 0 ? 'the :ux:config graph is empty' : null }
}
