import { uxConfigGraphIri, type TripleSource } from '@shrubbery/nucleus'
import {
  createValidatedLayoutDocument,
  type LayoutDocument,
  type ViewDescriptor,
} from '@shrubbery/nucleus/layout'
import { KOCH_FACE_IDS, isKochFaceId } from './face-ids.js'
import {
  RDF,
  RDFS,
  assertGraphId,
  courseIri,
  kochSurfaceIri,
  learnerIri,
  literal,
} from './vocabulary.js'

export const UX_NS = 'http://mnemosyne.dev/ux#'
export const UX_LAYOUT_JSON = `${UX_NS}layoutJson`
export const UX_LAYOUT_DOCUMENT = `${UX_NS}LayoutDocument`

export interface KochUpdateClient {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
}

export type KochLayoutSource = 'graph' | 'seeded'

export interface KochLayoutUpgradeResult {
  readonly document: LayoutDocument
  readonly upgraded: boolean
}

export interface KochLayoutLoadResult {
  readonly document: LayoutDocument
  readonly source: 'graph' | 'missing'
  readonly readAt: number
}

export class KochLayoutError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'KochLayoutError'
  }
}

function descriptor(
  faceId: string,
  resourceIri: string,
  bindingId: string,
): ViewDescriptor {
  return {
    schemaVersion: 1,
    faceId,
    resource: { kind: 'iri', iri: resourceIri },
    params: { bindingId },
  }
}

export function validateKochLayout(candidate: LayoutDocument) {
  return createValidatedLayoutDocument(candidate, {
    isFaceRegistered: (view) => isKochFaceId(view.faceId),
    isFaceGridEligible: isKochFaceId,
  })
}

/**
 * A responsive, data-only Surface document. The interpreter treats the grid as
 * one opaque allocation and lets CSS grid reflow its fixed Resource × Face
 * cells: practice first on a phone; practice + curriculum + record in one row
 * when three tracks fit. No viewport geometry is serialized.
 */
export function buildDefaultKochLayout(
  graphId: string,
  timestamp = '2026-07-20T00:00:00.000Z',
  actorId = 'local',
): LayoutDocument {
  assertGraphId(graphId)
  const candidate: LayoutDocument = {
    schemaVersion: 1,
    layoutId: 'koch-practice-surface-v3',
    scope: 'user',
    graphId,
    rootNodeId: 'koch-practice-grid',
    nodes: {
      'koch-practice-grid': {
        kind: 'grid',
        id: 'koch-practice-grid',
        flow: 'reflow',
        minCellWidth: 260,
        gridRevision: 0,
        children: {
          kind: 'fixed',
          cells: [
            {
              id: 'practice',
              span: 2,
              descriptor: descriptor(
                KOCH_FACE_IDS.practice,
                learnerIri(graphId, actorId),
                'practice',
              ),
            },
            {
              id: 'curriculum',
              descriptor: descriptor(
                KOCH_FACE_IDS.curriculum,
                courseIri(graphId),
                'curriculum',
              ),
            },
            {
              id: 'progress',
              descriptor: descriptor(
                KOCH_FACE_IDS.progress,
                learnerIri(graphId, actorId),
                'progress',
              ),
            },
          ],
        },
      },
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const verdict = validateKochLayout(candidate)
  if (!verdict.ok) {
    throw new KochLayoutError(`The built-in Koch layout is invalid: ${JSON.stringify(verdict.diagnostics)}`)
  }
  return verdict.doc
}

/**
 * Upgrade only the exact v1 seed shipped by this app. Any graph-authored
 * variation (revision, width, cell order, descriptor, or span) is preserved
 * verbatim: a shell may improve its own default, never overwrite a user's
 * layout judgment under the guise of migration.
 */
export function upgradeDefaultKochLayout(
  document: LayoutDocument,
  graphId: string,
  updatedAt = new Date().toISOString(),
  actorId = 'local',
): KochLayoutUpgradeResult {
  const root = document.nodes[document.rootNodeId]
  const isExactV1 = document.layoutId === 'koch-practice-surface-v1'
    && document.scope === 'workspace'
    && document.graphId === graphId
    && document.rootNodeId === 'koch-practice-grid'
    && Object.keys(document.nodes).length === 1
    && root?.kind === 'grid'
    && root.flow === 'reflow'
    && root.minCellWidth === 360
    && root.gridRevision === 0
    && root.children.kind === 'fixed'
    && root.children.cells.length === 3
    && root.children.cells.every((cell, index) => {
      const expected = [
        ['practice', KOCH_FACE_IDS.practice, 'practice'],
        ['curriculum', KOCH_FACE_IDS.curriculum, 'curriculum'],
        ['progress', KOCH_FACE_IDS.progress, 'progress'],
      ][index]
      return expected
        && cell.id === expected[0]
        && cell.span === undefined
        && cell.descriptor.faceId === expected[1]
        && cell.descriptor.params?.bindingId === expected[2]
    })
  const isV2Workspace = document.layoutId === 'koch-practice-surface-v2'
    && document.scope === 'workspace'
    && document.graphId === graphId
  if (!isExactV1 && !isV2Workspace) return { document, upgraded: false }

  const seed = isExactV1
    ? buildDefaultKochLayout(graphId, document.createdAt, actorId)
    : { ...document, layoutId: 'koch-practice-surface-v3', scope: 'user' as const }
  const candidate = { ...seed, updatedAt }
  const verdict = validateKochLayout(candidate)
  if (!verdict.ok) {
    throw new KochLayoutError(`The Koch user-layout upgrade is invalid: ${JSON.stringify(verdict.diagnostics)}`)
  }
  return { document: verdict.doc, upgraded: true }
}

export function kochLayoutQuery(graphId: string, actorId = 'local'): string {
  assertGraphId(graphId)
  return `PREFIX ux: <${UX_NS}>
SELECT ?layoutJson WHERE {
  GRAPH <${uxConfigGraphIri(graphId)}> {
    <${kochSurfaceIri(graphId, actorId)}> ux:layoutJson ?layoutJson .
  }
}
LIMIT 2`
}

export async function loadKochLayout(
  source: TripleSource,
  graphId: string,
  actorId = 'local',
): Promise<KochLayoutLoadResult> {
  if (!source.select || !source.description.sparql) {
    throw new KochLayoutError(`The ${source.description.kind} source cannot SELECT the Koch layout.`)
  }

  let result: Awaited<ReturnType<NonNullable<TripleSource['select']>>>
  try {
    result = await source.select(kochLayoutQuery(graphId, actorId))
  } catch (error) {
    throw new KochLayoutError(
      `Reading the Koch ux:layoutJson from Garden failed: ${error instanceof Error ? error.message : String(error)}`,
      error,
    )
  }

  if (result.rows.length === 0) {
    return { document: buildDefaultKochLayout(graphId, undefined, actorId), source: 'missing', readAt: result.readAt }
  }
  if (result.rows.length > 1) {
    throw new KochLayoutError(
      `Garden contains more than one ux:layoutJson value for <${kochSurfaceIri(graphId, actorId)}>; refusing an arbitrary layout.`,
    )
  }

  const term = result.rows[0]?.layoutJson
  if (!term || term.type !== 'literal') {
    throw new KochLayoutError('The Koch ux:layoutJson binding is absent or is not an RDF literal.')
  }

  let candidate: unknown
  try {
    candidate = JSON.parse(term.value)
  } catch (error) {
    throw new KochLayoutError(
      `The Koch ux:layoutJson value is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      error,
    )
  }

  const verdict = validateKochLayout(candidate as LayoutDocument)
  if (!verdict.ok) {
    throw new KochLayoutError(
      `The graph-authored Koch layout failed the sealed-face validator: ${JSON.stringify(verdict.diagnostics)}`,
    )
  }
  return { document: verdict.doc, source: 'graph', readAt: result.readAt }
}

export function layoutPersistUpdate(graphId: string, document: LayoutDocument, actorId = 'local'): string {
  assertGraphId(graphId)
  const graph = uxConfigGraphIri(graphId)
  const surface = kochSurfaceIri(graphId, actorId)
  const encoded = literal(JSON.stringify(document))
  return `DELETE WHERE {
  GRAPH <${graph}> { <${surface}> <${UX_LAYOUT_JSON}> ?layoutJson . }
};
INSERT DATA {
  GRAPH <${graph}> {
    <${surface}> <${RDF.type}> <${UX_LAYOUT_DOCUMENT}> .
    <${surface}> <${RDFS.label}> ${literal('Koch practice surface')} .
    <${surface}> <${UX_LAYOUT_JSON}> ${encoded} .
  }
}`
}

export async function persistKochLayout(
  client: KochUpdateClient,
  graphId: string,
  document: LayoutDocument,
  actorId = 'local',
): Promise<void> {
  const verdict = validateKochLayout(document)
  if (!verdict.ok) {
    throw new KochLayoutError(`Refusing to persist an invalid Koch layout: ${JSON.stringify(verdict.diagnostics)}`)
  }
  await client.callTool('sparql_update', {
    graphId,
    update: layoutPersistUpdate(graphId, verdict.doc, actorId),
  })
}
