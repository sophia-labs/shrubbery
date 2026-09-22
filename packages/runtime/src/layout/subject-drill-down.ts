/**
 * subject-drill-down.ts — the row -> subject-card -> evidence-chain
 * drill-down door (P6, plans/observatory-ux-implementation-spec-20260728.md
 * §3 P6). Activating a machine-run row splits a `card.subject` +
 * `obs.evidence-chain` pair beside the table WITHOUT remounting the table;
 * re-activating a different row replaces both descriptors without
 * restructuring anything.
 *
 * Two functions, same split as `layout-edge-interpreter.ts`'s own
 * synthesize/install pair:
 *
 *   - `planSubjectDrillDown` is PURE (no DOM, no timers) — it only ever calls
 *     the real, total `applyOperation` reducer, never hand-builds a document.
 *     Unit-testable against the real reducer.
 *   - `installSubjectDrillDown` is the DOM half: listens on `root` for
 *     `SUBJECT_ROW_ACTIVATE_EVENT`, resolves the activating leaf via the
 *     interpreter's own `data-layout-node-id` stamp, and drives `commit`.
 *
 * Minted descriptors carry `{kind:'graph', graphId, subjectIri}` locators —
 * NEVER SPARQL text (ruling 4, plans/observatory-ux-implementation-spec-
 * 20260728.md §1, through the RUNTIME path here, not just the seed P7 ships).
 *
 * Deliberately has NO dependency on the `tabs` composition node (P1), the
 * named-query resolver (P2), or the freshness governor (P3) — this packet was
 * carved out of the original P6 specifically so it could build in parallel
 * with that work (see the spec's own P6 header).
 */
import {
  applyOperation,
  locateParent,
  type Diagnostic,
  type LayoutDocument,
  type LayoutLeafNode,
  type LayoutNode,
  type ResourceLocator,
  type ValidateOptions,
  type ViewDescriptor,
} from '@shrubbery/nucleus/layout'
import { CARD_SUBJECT_FACE_ID } from './faces/card-subject-face.js'
import { EVIDENCE_CHAIN_FACE_ID } from './faces/evidence-chain-face.js'
import { SUBJECT_ROW_ACTIVATE_EVENT, type SubjectRowActivateDetail } from './faces/sparql-table-view-element.js'

/** The four contract node ids this door mints — geometry identity, not query state. */
export interface SubjectDrillDownIds {
  readonly cardSplitId: string
  readonly cardLeafId: string
  readonly evidenceSplitId: string
  readonly evidenceLeafId: string
}

export const DEFAULT_SUBJECT_DRILL_DOWN_IDS: SubjectDrillDownIds = {
  cardSplitId: 'obs.drill.split-card',
  cardLeafId: 'obs.drill.card',
  evidenceSplitId: 'obs.drill.split-evidence',
  evidenceLeafId: 'obs.drill.evidence',
}

/**
 * The caller-supplied shape of the door: which graph to scope the minted
 * `{kind:'graph', graphId, subjectIri}` locators to, `card.subject`'s own
 * required/optional params, an optional row cap for the evidence-chain leaf,
 * an optional id-set override (a page hosting more than one drill-down door
 * needs distinct contract ids per door), and the face-registration predicate
 * `applyOperation` needs to accept `card.subject`/`obs.evidence-chain` —
 * neither is in Phase 1's own default allow-list (mirrors
 * `InstallLayoutEdgesOptions.validate`, layout-edge-interpreter.ts).
 */
export interface SubjectDrillDownConfig {
  readonly graphId: string
  readonly cardTitleField: string
  readonly cardFields?: string
  readonly evidenceMaxRows?: number
  readonly ids?: SubjectDrillDownIds
  readonly validate?: ValidateOptions
}

type PlanResult = { readonly ok: true; readonly doc: LayoutDocument } | { readonly ok: false; readonly diagnostic: Diagnostic }

/** `Object.hasOwn`-guarded node lookup — mirrors operations.ts's own private `getOwnNode` (same rationale: a bare `doc.nodes[id]` resolves an inherited `Object.prototype` member for an adversarial id). */
function getOwnNode(doc: LayoutDocument, id: string): LayoutNode | undefined {
  return Object.hasOwn(doc.nodes, id) ? doc.nodes[id] : undefined
}

function graphLocatorFor(graphId: string, subjectIri: string): ResourceLocator {
  return { kind: 'graph', graphId, subjectIri }
}

function cardDescriptor(config: SubjectDrillDownConfig, subjectIri: string): ViewDescriptor {
  return {
    schemaVersion: 1,
    faceId: CARD_SUBJECT_FACE_ID,
    resource: graphLocatorFor(config.graphId, subjectIri),
    params: {
      titleField: config.cardTitleField,
      ...(config.cardFields !== undefined ? { fields: config.cardFields } : {}),
    },
  }
}

function evidenceDescriptor(config: SubjectDrillDownConfig, subjectIri: string): ViewDescriptor {
  return {
    schemaVersion: 1,
    faceId: EVIDENCE_CHAIN_FACE_ID,
    resource: graphLocatorFor(config.graphId, subjectIri),
    ...(config.evidenceMaxRows !== undefined ? { params: { maxRows: config.evidenceMaxRows } } : {}),
  }
}

/**
 * FIRST activation (`cardLeafId` absent from `doc`): two sequential
 * `split_leaf` calls. The first opens `cardLeafId` beside `sourceLeafId`
 * (horizontal, end, 60/40 — the table keeps the majority of the space); the
 * second opens `evidenceLeafId` beneath `cardLeafId` (vertical, end, 50/50).
 * `sourceLeafId`'s own node entry is untouched by either call (`split_leaf`'s
 * `spliceBesideLeaf` only ever rewires the TARGET's parent edge, never the
 * target's own map entry) — LAY-007 preserves the table's own view across the
 * whole operation. A rejection at either step returns `{ok:false,diagnostic}`
 * and never touches the caller's `doc` reference (`applyOperation` is a pure,
 * non-mutating reducer throughout).
 */
function planFirstActivation(
  doc: LayoutDocument,
  ids: SubjectDrillDownIds,
  params: SubjectDrillDownConfig & { readonly sourceLeafId: string; readonly subjectIri: string },
): PlanResult {
  const firstSplit = applyOperation(
    doc,
    {
      op: 'split_leaf',
      leafId: params.sourceLeafId,
      axis: 'horizontal',
      side: 'end',
      newLeafId: ids.cardLeafId,
      splitId: ids.cardSplitId,
      descriptor: cardDescriptor(params, params.subjectIri),
      startBasisPoints: 6000,
      expectedParent: locateParent(doc, params.sourceLeafId) ?? { kind: 'root' },
    },
    params.validate,
  )
  if (!firstSplit.ok) return { ok: false, diagnostic: firstSplit.diagnostic }

  const secondSplit = applyOperation(
    firstSplit.doc,
    {
      op: 'split_leaf',
      leafId: ids.cardLeafId,
      axis: 'vertical',
      side: 'end',
      newLeafId: ids.evidenceLeafId,
      splitId: ids.evidenceSplitId,
      descriptor: evidenceDescriptor(params, params.subjectIri),
      startBasisPoints: 5000,
      expectedParent: locateParent(firstSplit.doc, ids.cardLeafId) ?? { kind: 'root' },
    },
    params.validate,
  )
  if (!secondSplit.ok) return { ok: false, diagnostic: secondSplit.diagnostic }

  return { ok: true, doc: secondSplit.doc }
}

/**
 * SUBSEQUENT activation (`cardLeafId` present): two `replace_descriptor`
 * calls, no restructuring — `expectedDescriptorRevision` for each is read
 * straight off `doc` (the doc as the caller handed it in, before either call
 * runs; the two leaves are independent, so the second call's precondition is
 * unaffected by the first call's own result).
 */
function planSubsequentActivation(
  doc: LayoutDocument,
  ids: SubjectDrillDownIds,
  params: SubjectDrillDownConfig & { readonly sourceLeafId: string; readonly subjectIri: string },
): PlanResult {
  const cardLeaf = getOwnNode(doc, ids.cardLeafId) as LayoutLeafNode
  const evidenceLeaf = getOwnNode(doc, ids.evidenceLeafId) as LayoutLeafNode | undefined

  const cardReplace = applyOperation(
    doc,
    {
      op: 'replace_descriptor',
      leafId: ids.cardLeafId,
      descriptor: cardDescriptor(params, params.subjectIri),
      expectedDescriptorRevision: cardLeaf.descriptorRevision,
    },
    params.validate,
  )
  if (!cardReplace.ok) return { ok: false, diagnostic: cardReplace.diagnostic }

  const evidenceReplace = applyOperation(
    cardReplace.doc,
    {
      op: 'replace_descriptor',
      leafId: ids.evidenceLeafId,
      descriptor: evidenceDescriptor(params, params.subjectIri),
      // `evidenceLeaf` absent is a genuine document inconsistency (a
      // `cardLeafId` with no matching `evidenceLeafId`) — `0` is a safe,
      // inert guess here because the reducer's own `requireKind` existence
      // check runs BEFORE its revision comparison and will reject on
      // `LAYOP_NODE_NOT_FOUND` first; this value is never actually compared.
      expectedDescriptorRevision: evidenceLeaf?.descriptorRevision ?? 0,
    },
    params.validate,
  )
  if (!evidenceReplace.ok) return { ok: false, diagnostic: evidenceReplace.diagnostic }

  return { ok: true, doc: evidenceReplace.doc }
}

export function planSubjectDrillDown(
  doc: LayoutDocument,
  params: SubjectDrillDownConfig & { readonly sourceLeafId: string; readonly subjectIri: string },
): PlanResult {
  const ids = params.ids ?? DEFAULT_SUBJECT_DRILL_DOWN_IDS
  const existingCard = getOwnNode(doc, ids.cardLeafId)
  return existingCard === undefined
    ? planFirstActivation(doc, ids, params)
    : planSubsequentActivation(doc, ids, params)
}

/**
 * Install the door over `root`. Resolves the activating leaf via
 * `(event.target as Element).closest('[data-layout-node-id]')` — the
 * interpreter's own wrapper stamp (`layout-interpreter.ts`'s `ensureWrapper`)
 * — ignoring the event when that (or `detail.subjectIri`) is missing. Returns
 * an idempotent disposer (mirrors `installLayoutEdges`'s own contract).
 */
export function installSubjectDrillDown(
  root: HTMLElement,
  getDoc: () => LayoutDocument,
  commit: (doc: LayoutDocument) => void,
  config: SubjectDrillDownConfig & { readonly onReject?: (diagnostic: Diagnostic) => void },
): () => void {
  const { onReject, ...drillConfig } = config

  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<SubjectRowActivateDetail>).detail
    const subjectIri = detail?.subjectIri
    const eventTarget = event.target
    const leafWrapper = eventTarget instanceof Element ? (eventTarget.closest('[data-layout-node-id]') as HTMLElement | null) : null
    const sourceLeafId = leafWrapper?.dataset.layoutNodeId
    if (!sourceLeafId || !subjectIri) return

    const doc = getDoc()
    const result = planSubjectDrillDown(doc, { ...drillConfig, sourceLeafId, subjectIri })
    if (result.ok) {
      commit(result.doc)
    } else {
      onReject?.(result.diagnostic)
    }
  }

  root.addEventListener(SUBJECT_ROW_ACTIVATE_EVENT, listener)

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    root.removeEventListener(SUBJECT_ROW_ACTIVATE_EVENT, listener)
  }
}
