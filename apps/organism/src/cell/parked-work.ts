/**
 * parked-work.ts — durable records about a PREVIOUS life of a graph: the
 * join between Document Activation's recovery store (full Y.Doc snapshots,
 * `document-activation.ts`) and the source mirror's undeliverable outbox
 * rows (typed operations, `@shrubbery/source`), plus export (MO object-face
 * integration spec, master §3 Slice 8, WS3 §4.4-4.6, §6.4-6.5, §8.3).
 *
 * Terminology law (master §7.1): PARKED, never "conflict" — a document is
 * never contested (Law I merges every document CRDT); only PENDING (an
 * unsent local write) or PARKED (a Law VI fence quarantined it) apply to a
 * document. "Contested" belongs to objects (Law IV) alone and does not
 * appear on this surface except once, in the handoff copy (HO-1/2), which
 * this module does not own.
 */
import {
  documentIdOf,
  type SourceFaultCode,
  type SourceMirrorState,
  type SourceOperation,
  type SourceOutboxRecord,
  type SourceOutboxStatus,
} from '@shrubbery/source'
import type { SidebarSection } from '@shrubbery/runtime'
import type { DocumentRecoveryRecord } from './document-activation.js'

export type ParkedReason = 'deleted' | 'replaced' | 'orphaned'

/** PW-4/5/6. */
export const PARKED_REASON_LABEL: Readonly<Record<ParkedReason, string>> = {
  replaced: 'Replaced',
  deleted: 'Deleted',
  orphaned: 'Orphaned',
}

/** PW-7/8/9. */
export const PARKED_REASON_HELP: Readonly<Record<ParkedReason, string>> = {
  replaced: 'This document exists now, but as a different one.',
  deleted: 'This document is not in the graph any more.',
  orphaned: "This document left the graph's membership while you were away.",
}

const PARKED_SIDEBAR_ID_PREFIX = 'parked:'

/** The inverse of `parkedSidebarSection`'s `id` construction — a sidebar row
 *  id is a string convention, never the model; callers key off `section`
 *  first (master §3 Slice 8 REPAIR, C-D26) and use this only to recover the
 *  recoveryKey once they already know the row IS a parked one. */
export function parkedRecoveryKeyOf(id: string): string {
  return id.startsWith(PARKED_SIDEBAR_ID_PREFIX) ? id.slice(PARKED_SIDEBAR_ID_PREFIX.length) : id
}

/**
 * WS3 §7.5's representability taxonomy. Computed HERE rather than in
 * `apps/organism/src/cell/reapply-controller.ts` (which master §4.7's
 * literal file-inventory row tags as this type's owner) because master §3
 * Slice 8's own text requires the taxonomy "shown in the face BEFORE the
 * human commits" (PW-22/23) — that face is this module's `ParkedWorkModel`,
 * built a full slice before `reapply-controller.ts` exists. Slice 9 imports
 * this type and `representabilityOf` from here rather than redefining them;
 * recorded as a divergence in the Slice 8 build log.
 */
export type ParkedRepresentability =
  | { readonly kind: 'representable' }
  | { readonly kind: 're-stamped'; readonly field: 'documentIncarnation' | 'newDocumentIncarnation' }
  /** `currentState` — base version UNCHANGED (C-D25); may raise a genuine
   *  Law IV contest on reapply rather than silently overwriting. */
  | { readonly kind: 'may-contest' }
  /** The synthesized `documentUpdate` every reapplied recovery gets, once,
   *  carrying the full Y.Doc snapshot (C-D24) — not a row in THIS taxonomy's
   *  own input (it does not exist until Slice 9 plans a run), named here
   *  only so the union is complete and Slice 9 need not extend it. */
  | { readonly kind: 'document-snapshot' }
  | { readonly kind: 'already-satisfied'; readonly why: 'document-exists' | 'document-absent' }
  | {
      readonly kind: 'unrepresentable'
      readonly why:
        | 'previous-life-resolution'
        | 'previous-life-recreate'
        | 'cross-lifetime-delete'
        | 'document-absent'
    }

function stringField(operation: SourceOperation, key: string): string | null {
  const value = operation[key]
  return typeof value === 'string' ? value : null
}

/**
 * WS3 §7.5's table, derived from the complete operation-kind switch at
 * `@shrubbery/source`'s `source-mirror.ts:315-425`. `documentExists`
 * answers "does a document with this id exist in the graph's CURRENT (new)
 * life" — the parked-work face's own title lookup already answers this for
 * free. A caller with no way to answer (the conservative default) treats
 * every conditional case as absent, which never claims "already satisfied"
 * when it cannot know that.
 */
export function representabilityOf(
  operation: SourceOperation,
  documentExists: (documentId: string) => boolean,
): ParkedRepresentability {
  switch (operation.kind) {
    case 'workspaceUpdate':
    case 'graphMetadata':
    case 'eventLog':
    case 'memory':
    case 'valuation':
    case 'retraction':
      return { kind: 'representable' }
    case 'documentUpdate':
      return { kind: 're-stamped', field: 'documentIncarnation' }
    case 'documentLifecycle': {
      const documentId = stringField(operation, 'documentId')
      const exists = documentId !== null && documentExists(documentId)
      const action = stringField(operation, 'action')
      if (action === 'create') {
        return exists
          ? { kind: 'already-satisfied', why: 'document-exists' }
          : { kind: 're-stamped', field: 'newDocumentIncarnation' }
      }
      if (action === 'delete') {
        return exists
          ? { kind: 'unrepresentable', why: 'cross-lifetime-delete' }
          : { kind: 'already-satisfied', why: 'document-absent' }
      }
      // 'recreate' — rotates the replacement's own incarnation; no
      // re-stamping makes a previous life's recreate mean something here.
      return { kind: 'unrepresentable', why: 'previous-life-recreate' }
    }
    case 'crdtCommand': {
      const documentId = stringField(operation, 'documentId')
      if (documentId !== null && !documentExists(documentId)) {
        return { kind: 'unrepresentable', why: 'document-absent' }
      }
      return { kind: 'representable' }
    }
    case 'currentState':
      return { kind: 'may-contest' }
    case 'resolveCurrent':
      return { kind: 'unrepresentable', why: 'previous-life-resolution' }
    default:
      return { kind: 'representable' }
  }
}

/** CHAIR — ADDED (master §2.1, C-D19). `valuation` carries a REQUIRED
 *  `documentId` + `blockId` on the normalized wire even though
 *  `documentIdOf` correctly excludes it from the document-plane join
 *  (`isDocumentBearingOperation` — a valuation unions by stable id,
 *  observer-aware; it is never reapplied INTO a replacement document the
 *  way a `documentUpdate` is). A loose row that still names a document must
 *  say so (PW-13b/14b), not claim it is "not about one document". */
function namesDocumentId(operation: SourceOperation): string | null {
  return operation.kind === 'valuation' ? stringField(operation, 'documentId') : null
}

export interface ParkedOperationRow {
  readonly operationId: string
  readonly kind: string
  readonly graphIncarnation: string
  readonly createdAt: number
  readonly attempts: number
  /** Verbatim authority testimony from the failed flush. */
  readonly error: string | null
  readonly errorCode: SourceFaultCode | null
  readonly representability: ParkedRepresentability
  /** The documentId this operation NAMES, when it names one but is not
   *  itself a document-plane operation (C-D19's `valuation` case). `null`
   *  for a genuinely graph-scoped row. */
  readonly namesDocumentId: string | null
}

export interface ParkedDocumentRow {
  readonly recoveryKey: string
  readonly documentId: string
  readonly title: string
  readonly reason: ParkedReason
  /** Short form of the DOCUMENT incarnation this work belonged to. */
  readonly previousLife: string
  readonly recoveredAt: number
  readonly sizeBytes: number
  /** Resolved from `relatedOperationIds`; empty when the join is absent (D4). */
  readonly operations: readonly ParkedOperationRow[]
  /** True exactly for records that predate the join field — distinct from a
   *  join that resolved to genuinely zero operations. */
  readonly joinUnavailable: boolean
  readonly reappliedAt: number | null
  /** Only 'replaced' can be reapplied: 'deleted' has no destination,
   *  'orphaned' has no fence. */
  readonly canReapply: boolean
}

export interface ParkedWorkModel {
  readonly graphId: string
  readonly graphTitle: string
  readonly fenced: boolean
  readonly fenceTestimony: string | null
  /** Short form of the CURRENT graph incarnation, when fenced. */
  readonly previousLife: string
  readonly documents: readonly ParkedDocumentRow[]
  /** Graph-scoped operations that belong to no single document (D3). */
  readonly looseOperations: readonly ParkedOperationRow[]
  readonly totalOperations: number
}

/**
 * The real parked-DOCUMENT count for `graphId`'s lifetime banner (build
 * bundle review finding 5, 2026-07-31) — Slice 8 built the real
 * `ParkedWorkModel` join but never replaced Slice 7's own
 * `lifetimeBannerStateFor()` placeholder (`main.ts`), which hardcoded
 * `parkedDocuments: 0` unconditionally. `parkedWork` is the SAME model the
 * parked-work face itself reads (`currentParkedWork`, `main.ts`) — reused
 * here rather than re-queried, so the banner and the face never disagree.
 * Reports 0 (never a guess) when the model has not loaded yet, or is a
 * stale model left over from a different graph — both real, honest "don't
 * know yet" states, not the same claim as "genuinely zero".
 */
export function parkedDocumentsCountFor(
  parkedWork: ParkedWorkModel | null,
  graphId: string,
): number {
  return parkedWork && parkedWork.graphId === graphId ? parkedWork.documents.length : 0
}

export interface LoadParkedWorkOptions {
  readonly userId: string
  readonly graphId: string
  readonly graphTitle: string
  readonly recoveries: (userId: string) => Promise<readonly DocumentRecoveryRecord[]>
  readonly operations: () => readonly SourceOutboxRecord[]
  readonly mirror: SourceMirrorState
  readonly titleFor?: (documentId: string) => string | null
  /** Does a document with this id exist in the graph's CURRENT life —
   *  answers WS3 §7.5's conditional representability rows. Conservatively
   *  `false` when absent (never claims "already satisfied" it cannot know). */
  readonly documentExists?: (documentId: string) => boolean
}

function parkedOperationRowFrom(
  record: SourceOutboxRecord,
  documentExists: (documentId: string) => boolean,
): ParkedOperationRow {
  return {
    operationId: record.operation.operationId,
    kind: record.operation.kind,
    graphIncarnation: record.graphIncarnation,
    createdAt: record.createdAt,
    attempts: record.attempts,
    error: record.error ?? null,
    errorCode: record.errorCode ?? null,
    representability: representabilityOf(record.operation, documentExists),
    namesDocumentId: namesDocumentId(record.operation),
  }
}

/**
 * The join (master §3 Slice 8, WS3 §4.5/§6.4). Filters `recoveries` to this
 * graph, resolves each `relatedOperationIds` entry against the live outbox
 * rows, and puts every remaining parked operation into `looseOperations`.
 * Ordering: documents newest-`recoveredAt` first; operations oldest-
 * `createdAt` first (the order they would have been delivered in).
 */
export async function loadParkedWork(options: LoadParkedWorkOptions): Promise<ParkedWorkModel> {
  const records = (await options.recoveries(options.userId)).filter(record => record.graphId === options.graphId)
  const operations = options.operations()
  const documentExists = options.documentExists ?? ((): boolean => false)
  const titleFor = options.titleFor ?? ((): string | null => null)

  const claimedOperationIds = new Set<string>()
  const documents: ParkedDocumentRow[] = records
    .map((record): ParkedDocumentRow => {
      const relatedIds = record.relatedOperationIds
      const rows: ParkedOperationRow[] = []
      for (const operationId of relatedIds ?? []) {
        const match = operations.find(candidate => candidate.operation.operationId === operationId)
        if (!match) continue
        claimedOperationIds.add(operationId)
        rows.push(parkedOperationRowFrom(match, documentExists))
      }
      rows.sort((left, right) => left.createdAt - right.createdAt)
      return {
        recoveryKey: record.key,
        documentId: record.documentId,
        title: titleFor(record.documentId) ?? record.documentId,
        reason: record.reason,
        previousLife: (record.incarnation ?? '').slice(0, 8),
        recoveredAt: record.recoveredAt,
        sizeBytes: record.update.byteLength,
        operations: rows,
        joinUnavailable: relatedIds === undefined,
        reappliedAt: record.reappliedAt ?? null,
        canReapply: record.reason === 'replaced',
      }
    })
    .sort((left, right) => right.recoveredAt - left.recoveredAt)

  const looseOperations = operations
    .filter(record => !claimedOperationIds.has(record.operation.operationId))
    .map(record => parkedOperationRowFrom(record, documentExists))
    .sort((left, right) => left.createdAt - right.createdAt)

  return {
    graphId: options.graphId,
    graphTitle: options.graphTitle,
    fenced: options.mirror.fenced,
    fenceTestimony: options.mirror.fenceTestimony,
    previousLife: (options.mirror.graphIncarnation ?? '').slice(0, 8),
    documents,
    looseOperations,
    totalOperations: operations.length,
  }
}

/**
 * The sidebar's "parked work" section (master §3 Slice 8, WS3 §5.3). `null`
 * rather than an empty section: the sidebar's own empty vocabulary belongs
 * to sections that EXIST in this life. A graph with nothing parked has no
 * parked section at all, which is the honest shape.
 *
 * REPAIR (refutation-03 #7, C-D26): rows are `kind:'document'`,
 * `section:'parked'`, `readOnly:true` — the shell keys off `section`
 * (never the `parked:` id prefix, which is a string convention, not the
 * model) to route the click to the parked-work face instead of an editor,
 * and `mn-sidebar-panel.ts`'s `readOnly` guards (this same slice) stop the
 * row from being dragged or hover-prefetched as though it were a real
 * document.
 */
export function parkedSidebarSection(model: ParkedWorkModel | null): SidebarSection | null {
  if (!model || model.documents.length === 0) return null
  return {
    id: 'parked',
    label: 'Parked work',
    icon: 'package',
    count: model.documents.length,
    emptyLabel: 'Nothing parked',
    nodes: model.documents.map(row => ({
      id: `${PARKED_SIDEBAR_ID_PREFIX}${row.recoveryKey}`,
      label: row.title,
      kind: 'document',
      section: 'parked',
      readOnly: true,
      badge: PARKED_REASON_LABEL[row.reason],
      lastAccessedAt: row.recoveredAt,
    })),
  }
}

// ── export (master §3 Slice 8, WS3 §6.5) ────────────────────────────────

export const PARKED_EXPORT_FORMAT = 'shrubbery.parked-work/v1' as const

export interface ParkedWorkExport {
  readonly format: typeof PARKED_EXPORT_FORMAT
  readonly exportedAt: string
  readonly provenance: {
    readonly userId: string
    readonly graphId: string
    readonly graphTitle: string
    readonly previousGraphIncarnation: string
    readonly fenceTestimony: string | null
    readonly appVersion: string
    readonly schemaVersion: number
  }
  readonly documents: readonly {
    readonly recoveryKey: string
    readonly documentId: string
    readonly title: string
    readonly reason: ParkedReason
    readonly documentIncarnation: string | null
    readonly recoveredAt: string
    readonly updateBase64: string
    readonly updateSha256: string
    readonly relatedOperationIds: readonly string[]
  }[]
  readonly operations: readonly {
    readonly operationId: string
    readonly graphIncarnation: string
    readonly status: SourceOutboxStatus
    readonly createdAt: string
    readonly attempts: number
    readonly error: string | null
    readonly operation: Record<string, unknown>
  }[]
}

export interface ParkedWorkExportProvenance {
  readonly userId: string
  readonly graphId: string
  readonly graphTitle: string
  /** The graph incarnation this client still holds at export time. */
  readonly previousGraphIncarnation: string
  readonly fenceTestimony: string | null
  readonly appVersion?: string
  readonly schemaVersion: number
}

function encodeBase64(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return globalThis.btoa(binary)
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', exact))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Builds the export payload. One JSON file, not a zip (both logical parts
 * are already base64-clean; a single self-describing document is
 * inspectable with `jq`, diffable, and re-importable without an unzip
 * step). `recoveryKey: null` exports the WHOLE graph's parked work
 * (PW-19); a specific key exports one document plus only the operations
 * that document's own `relatedOperationIds` names.
 */
export async function exportParkedWork(
  provenance: ParkedWorkExportProvenance,
  documents: readonly DocumentRecoveryRecord[],
  operations: readonly SourceOutboxRecord[],
  recoveryKey: string | null,
  titleFor: (documentId: string) => string | null = (): null => null,
  now: () => number = Date.now,
): Promise<ParkedWorkExport> {
  const selectedDocuments = recoveryKey === null
    ? documents
    : documents.filter(record => record.key === recoveryKey)
  const selectedOperationIds = new Set(
    selectedDocuments.flatMap(record => record.relatedOperationIds ?? []),
  )
  const selectedOperations = recoveryKey === null
    ? operations
    : operations.filter(record => selectedOperationIds.has(record.operation.operationId))

  return {
    format: PARKED_EXPORT_FORMAT,
    exportedAt: new Date(now()).toISOString(),
    provenance: {
      userId: provenance.userId,
      graphId: provenance.graphId,
      graphTitle: provenance.graphTitle,
      previousGraphIncarnation: provenance.previousGraphIncarnation,
      fenceTestimony: provenance.fenceTestimony,
      appVersion: provenance.appVersion ?? 'unknown',
      schemaVersion: provenance.schemaVersion,
    },
    documents: await Promise.all(selectedDocuments.map(async record => ({
      recoveryKey: record.key,
      documentId: record.documentId,
      title: titleFor(record.documentId) ?? record.documentId,
      reason: record.reason,
      documentIncarnation: record.incarnation,
      recoveredAt: new Date(record.recoveredAt).toISOString(),
      updateBase64: encodeBase64(record.update),
      updateSha256: await sha256Hex(record.update),
      relatedOperationIds: record.relatedOperationIds ? [...record.relatedOperationIds] : [],
    }))),
    operations: selectedOperations.map(record => ({
      operationId: record.operation.operationId,
      graphIncarnation: record.graphIncarnation,
      status: record.status,
      createdAt: new Date(record.createdAt).toISOString(),
      attempts: record.attempts,
      error: record.error ?? null,
      operation: record.operation as Record<string, unknown>,
    })),
  }
}

/** File naming (WS3 §6.5); sanitized at delivery time by `saveBlob`'s own
 *  `safeDownloadFilename` call (`document-transfer.ts`). */
export function parkedExportFilename(
  graphId: string,
  previousLife8: string,
  documentId: string | null,
  now: () => number = Date.now,
): string {
  const date = new Date(now())
  const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`
    + `${String(date.getUTCDate()).padStart(2, '0')}`
  const base = documentId
    ? `parked-${graphId}-${documentId}-${previousLife8}-${stamp}`
    : `parked-${graphId}-${previousLife8}-${stamp}`
  return `${base}.shrubbery-parked.json`
}

// `documentIdOf` is re-exported for callers deriving `documentExists`/
// `titleFor` inputs from the outbox alongside this module's own join.
export { documentIdOf }
