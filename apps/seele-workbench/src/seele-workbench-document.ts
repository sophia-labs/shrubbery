/**
 * seele-workbench-document.ts — W6.1: the workbench's layout literal.
 *
 * A pure, parameterized, deep-frozen `LayoutDocument` builder, shaped after
 * `buildObservatoryDashboardDocument`. No side effects; a fresh, frozen
 * document every call.
 *
 * THE AXIS IS THE POINT (C15/F0). `packages/nucleus/src/layout/types.ts` names
 * axes by LAYOUT FLOW, not by divider direction:
 *
 *     horizontal = start/end laid LEFT-TO-RIGHT, with a VERTICAL divider line
 *     vertical   = start/end laid TOP-TO-BOTTOM, with a HORIZONTAL divider
 *
 * Rev 1 of the suite had these inverted, which would have produced the
 * constitution stacked ON TOP of its context pane rather than beside it — a
 * layout in which you cannot read the source and its verdict at the same time,
 * which is the entire proposition of the surface. So: `axis: 'horizontal'`,
 * `start` = the constitution (LEFT), `end` = the context pane (RIGHT). The
 * geometry test in `tests/` asserts the rects, not just the string.
 *
 * TWO LEAVES, NOT THREE (D15, ratified 2026-08-03). Chat is out of this
 * revision entirely: a `chat` locator needs a `sessionId` this builder does not
 * have, `resource` is mandatory on every descriptor, and no `chat.session` face
 * is registered anywhere. The reserved chat dock in the vessel's chrome is
 * shell furniture — deliberately NOT a leaf, and deliberately not wired to
 * anything (see `index.html` and `main.ts`). When chat is genuinely promoted,
 * `end` becomes `split(axis: 'vertical', startBasisPoints: 6500)` over
 * `seele.context` (start = top) and `chat.session` (end = bottom); nothing else
 * in this file moves.
 *
 * INTEGER BASIS POINTS ONLY, NEVER PIXELS — a stored pixel ratio drifts across
 * JSON, CRDT, RDF decimals and DOM percentages; 5800 means 58%.
 */
import { deepFreeze, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { HOJA_DOCUMENT_FACE_ID, SEELE_CONTEXT_FACE_ID } from '@shrubbery/runtime/layout'

/** Stable node ids — the browser script and the geometry test both address leaves by these. */
export const WORKBENCH_ROOT_NODE_ID = 'WorkbenchRoot'
export const CONSTITUTION_LEAF_ID = 'Constitution'
export const SEELE_CONTEXT_LEAF_ID = 'SeeleContext'

export const SEELE_WORKBENCH_LAYOUT_ID = 'seele-workbench-v1'

/**
 * The constitution gets the larger share: it is the thing being WRITTEN, and
 * YAML is wide. The context pane is a verdict, and a verdict is narrow.
 */
export const CONSTITUTION_BASIS_POINTS = 5800

/** The contract this workbench is an instance of. Parameterized — nothing below is SEELe-specific but this string (W8.6). */
export const DEFAULT_CONTRACT_NAME = 'seele-core'

export interface SeeleWorkbenchDocumentOptions {
  /** The contract identifier handed to `seele.context`'s closed params schema. */
  readonly contractName?: string
  /** Split ratio in integer basis points (1..9999). Defaults to `CONSTITUTION_BASIS_POINTS`. */
  readonly startBasisPoints?: number
}

/**
 * Build the workbench layout for one constitution document.
 *
 * Both leaves point at the SAME `{kind:'document', graphId, documentId}`
 * locator — that is not an accident and not a duplication. The two faces
 * resolve it through DIFFERENT registered adapters (`hoja.document.room-pool`
 * vs `seele.context.compile`), which is exactly the case the broker's required
 * `adapterId` argument exists to disambiguate: same resource, two projections,
 * no order-dependence.
 */
export function buildSeeleWorkbenchDocument(
  graphId: string,
  documentId: string,
  options: SeeleWorkbenchDocumentOptions = {},
): LayoutDocument {
  const contractName = options.contractName ?? DEFAULT_CONTRACT_NAME
  const startBasisPoints = options.startBasisPoints ?? CONSTITUTION_BASIS_POINTS
  const now = '2026-08-03T00:00:00.000Z'
  return deepFreeze({
    schemaVersion: 1,
    layoutId: SEELE_WORKBENCH_LAYOUT_ID,
    scope: 'session',
    graphId,
    rootNodeId: WORKBENCH_ROOT_NODE_ID,
    nodes: {
      [WORKBENCH_ROOT_NODE_ID]: {
        kind: 'split',
        id: WORKBENCH_ROOT_NODE_ID,
        // left | right — see this file's header before touching this.
        axis: 'horizontal',
        startNodeId: CONSTITUTION_LEAF_ID,
        endNodeId: SEELE_CONTEXT_LEAF_ID,
        startBasisPoints,
      },
      [CONSTITUTION_LEAF_ID]: {
        kind: 'leaf',
        id: CONSTITUTION_LEAF_ID,
        descriptorRevision: 0,
        descriptor: {
          schemaVersion: 1,
          faceId: HOJA_DOCUMENT_FACE_ID,
          resource: { kind: 'document', graphId, documentId },
        },
      },
      [SEELE_CONTEXT_LEAF_ID]: {
        kind: 'leaf',
        id: SEELE_CONTEXT_LEAF_ID,
        descriptorRevision: 0,
        descriptor: {
          schemaVersion: 1,
          faceId: SEELE_CONTEXT_FACE_ID,
          resource: { kind: 'document', graphId, documentId },
          params: { contractName },
        },
      },
    },
    createdAt: now,
    updatedAt: now,
  } as LayoutDocument)
}
