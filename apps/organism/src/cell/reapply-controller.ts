/**
 * reapply-controller.ts — the reapply pipeline (MO object-face integration
 * spec, master §3 Slice 9, WS3 §7 as REPAIRED 2026-07-30).
 *
 * Drives `<mn-restore-overlay>` (finally wired) through its nine shared
 * states while turning a previous life's parked work into fresh, honestly-
 * transformed operations against the CURRENT life. Four repaired defects
 * are the heart of this module (03 §7, master §3 Slice 9's own summary):
 *
 *   1. The parked Y.Doc snapshot is reapplied — a synthesized
 *      `documentUpdate` carries `DocumentRecoveryRecord.update` (the FULL
 *      Y.Doc snapshot) once per reapplied recovery, because the durable
 *      user WORK is that snapshot, not the outbox rows alone (C-D24, R20).
 *   2. A reapplied `currentState` keeps its ORIGINAL `baseVersion` —
 *      rebasing it onto the new life's head would make the fold advance
 *      silently with no contest at all (C-D25, R21).
 *   3. The lifecycle/`crdtCommand` transformations are corrected:
 *      `recreate` and a cross-lifetime `delete` are unrepresentable and
 *      reported, never replayed.
 *   4. "One at a time" is made true rather than asserted: the controller
 *      DRAINS the outbox and REFUSES to start on a non-empty deliverable
 *      queue, attributes receipts by `operationId`, and reports collateral
 *      rows (an unrelated live edit co-batched by the authority's
 *      one-error-per-batch contract) separately from planned ones.
 *
 * `reapply-journal` does not exist (deleted from `03` §7.1/§7.3, C-D22) —
 * crash evidence is the outbox itself: every `reapply:{uuid}` row carries
 * `reapplyOf` naming its parked original, durable through `putOutbox`
 * BEFORE any push.
 *
 * `ParkedRepresentability`/`representabilityOf` are imported from
 * `parked-work.ts`, not redefined here — Slice 8 built them a slice early
 * because the taxonomy has to be shown in the parked-work face (PW-22/23)
 * BEFORE a human commits to a reapply, and recorded the divergence from
 * the literal file-inventory tag in its own build log. This module reuses
 * them rather than forking the taxonomy in two places.
 */
import {
  classifySourceFault,
  isFenceFault,
  type SourceFaultCode,
  type SourceOperation,
  type SourceOperationReceipt,
  type SourceOutboxRecord,
  type SourceOutboxStatus,
} from '@shrubbery/source'
import type { MnRestoreOperationState } from '@shrubbery/components'
import type { SourceMirrorRuntime } from './source-mirror-runtime.js'
import {
  type DocumentActivationManager,
  type DocumentRecoveryRecord,
} from './document-activation.js'
import { representabilityOf, type ParkedRepresentability } from './parked-work.js'

// ── the driver's public shape (03 §7.2) ─────────────────────────────────

export type ReapplyStage = MnRestoreOperationState

export interface ReapplyView {
  readonly active: boolean
  readonly stage: ReapplyStage | ''
  readonly progress: number
  readonly heading: string
  readonly message: string
  readonly error: string
}

/**
 * A reapplied operation the authority folded into a genuine Law IV
 * contest. Workstream 2 opens `card.object` at `objectKey` wearing the
 * contested stance; this workstream's job ends at handing over an
 * accurate, complete envelope (03 §7.6).
 */
export interface ContestedHandoff {
  readonly source: 'parked-reapply'
  /** The fresh id that was accepted and became a candidate. */
  readonly operationId: string
  /** The parked original, for provenance. */
  readonly parkedOperationId: string
  /** `vocab  class  objectId` — garden `source_sync.rs:758-760`,
   *  read verbatim off the receipt's own `outcome.objectKey`
   *  (`stable_outcome`, `source_sync.rs:1416`) rather than reconstructed
   *  client-side. */
  readonly objectKey: string
  /** From the receipt outcome; absent if the authority did not name one. */
  readonly conflictId: string | null
  readonly recoveryKey: string | null
}

/** The PARKED operation's id — nothing fresh was ever minted for it. */
export interface DroppedOperation {
  readonly parkedOperationId: string
  readonly kind: string
  readonly recoveryKey: string | null
  readonly representability: Extract<
    ParkedRepresentability,
    { readonly kind: 'unrepresentable' } | { readonly kind: 'already-satisfied' }
  >
}

export interface FailedOperation {
  /** The fresh id that was pushed (null when the failure preceded the
   *  push — a remaining planned operation abandoned after a mid-run
   *  fence, or a collateral row that was never "parked" at all). */
  readonly operationId: string | null
  /** The parked original, when there is one. A COLLATERAL row (an
   *  unrelated live edit from the new life, co-batched and poisoned by
   *  this run's own failure) has no parked original at all; this module
   *  reuses its own fresh/live `operationId` here rather than inventing a
   *  second type for one additional field (§7.4's own "collateral rows …
   *  never counted into RA-9" — they are reported, just honestly unparked). */
  readonly parkedOperationId: string
  readonly kind: string
  readonly recoveryKey: string | null
  readonly status: SourceOutboxStatus
  readonly errorCode: SourceFaultCode | null
  /** The authority's own words. */
  readonly testimony: string
}

export interface ReapplyOutcome {
  readonly stage: Extract<ReapplyStage, 'succeeded' | 'failed' | 'rolled_back'>
  /** Fresh operationIds accepted by the authority (applied or acknowledged). */
  readonly applied: readonly string[]
  readonly contested: readonly ContestedHandoff[]
  readonly dropped: readonly DroppedOperation[]
  readonly failed: readonly FailedOperation[]
  /** Rows the authority's batch-level rejection terminated that this run
   *  did NOT plan — an ordinary edit made in the new life that happened to
   *  be co-batched (§7.4, WS4 OQ-9). Never folded into `failed`: the user
   *  must never be told their unrelated work "could not be reapplied". */
  readonly collateral: readonly FailedOperation[]
  /** The recovery keys this outcome actually concerns — the requested set
   *  narrowed to the ones that resolved to a real, reapplicable ('replaced')
   *  recovery; see `resolveTargets` below. */
  readonly recoveryKeys: readonly string[]
}

export interface ReapplyControllerOptions {
  readonly runtime: SourceMirrorRuntime
  readonly activation: DocumentActivationManager
  readonly userId: string
  readonly graphId: string
  readonly graphTitle: string
  readonly onView: (view: ReapplyView) => void
  readonly onContested: (handoffs: readonly ContestedHandoff[]) => void
  readonly now?: () => number
  readonly newOperationId?: () => string
}

// ── small local helpers (D-4: each concern keeps its own tiny copy rather
//    than growing a shared export for something this small — the same
//    convention `source-mirror.ts`/`source-mirror-runtime.ts` already use
//    for their own private `decodeBase64`) ──────────────────────────────

function encodeBase64(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return globalThis.btoa(binary)
}

function randomUuid(): string {
  const direct = globalThis.crypto?.randomUUID?.()
  if (direct) return direct
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function pluralS(count: number): string {
  return count === 1 ? '' : 's'
}

/** `SourceOperationReceipt.outcome`'s `objectKey`/`conflictId` — garden's
 *  `stable_outcome` (`source_sync.rs:1414-1420`), the same narrowing
 *  pattern `source-mirror.ts`'s own `outcomeLabel`/`remainingConflictId`
 *  use for the identical `Readonly<Record<string,unknown>>` shape. */
function outcomeString(receipt: SourceOperationReceipt | undefined, field: string): string | null {
  const value = receipt?.outcome[field]
  return typeof value === 'string' ? value : null
}

function terminalOutboxStatus(status: SourceOutboxStatus): boolean {
  return status !== 'pending'
}

/**
 * fix(slice-9) — refutation finding #2 (adversarial review, 2026-07-31): a
 * reapply row that reached and was DISPOSED OF by the authority — accepted,
 * fully applied, or resolved into a genuine Law IV contest (C-D25's own
 * design: a reapplied `currentState` keeping its original `baseVersion` is
 * SUPPOSED to raise a contest, and that is a completed, delivered outcome,
 * not a failure). `rejected-stale`/`rejected-permanent` mean the operation
 * never got there — 03 §7's own requirement is that these stay reappliable,
 * not `pending` (in flight; its fate is not yet known — never treated as
 * delivered either).
 */
function reapplyDelivered(status: SourceOutboxStatus): boolean {
  return status === 'accepted' || status === 'applied' || status === 'conflict'
}

/**
 * The `reapplyOf` ids of every reapply attempt that actually DELIVERED (see
 * `reapplyDelivered`) — the set `buildPlan`'s `alreadyReapplied` excludes
 * from a future plan.
 *
 * fix(slice-9) — refutation finding #2. Previously this counted EVERY
 * outbox row carrying a `reapplyOf`, regardless of its own status: a FAILED
 * attempt (`rejected-stale`/`rejected-permanent`) still marked its parked
 * original (and synthesized snapshot) as "already reapplied" forever,
 * making a genuinely failed recovery unretriable — and because the excluded
 * rows made `buildPlan` return an EMPTY plan for that recovery, `run()`'s
 * `stage = failed.length === 0 ? 'succeeded' : 'failed'` then stamped the
 * recovery `reappliedAt` and reported it `succeeded` a second time, though
 * nothing new was ever sent. Exported for direct unit testing (this is the
 * exact construction `run()` uses; a `ReapplyController.run()`-level test
 * would need a full real gardend + real outbox to observe it end to end —
 * the pure question of WHICH ids count as delivered belongs here instead).
 */
export function deliveredReapplyIds(outboxRecords: readonly SourceOutboxRecord[]): ReadonlySet<string> {
  return new Set(
    outboxRecords
      .filter(record => reapplyDelivered(record.status))
      .flatMap(record => (record.reapplyOf !== undefined ? [record.reapplyOf] : [])),
  )
}

function labelFor(kind: string, synthesized: boolean): string {
  if (synthesized) return 'document text'
  switch (kind) {
    case 'workspaceUpdate':
      return 'workspace update'
    case 'graphMetadata':
      return 'graph title'
    case 'eventLog':
      return 'event'
    case 'memory':
      return 'memory'
    case 'valuation':
      return 'valuation'
    case 'retraction':
      return 'retraction'
    case 'documentUpdate':
      return 'document update'
    case 'documentLifecycle':
      return 'document creation'
    case 'crdtCommand':
      return 'workspace command'
    case 'currentState':
      return 'object proposal'
    default:
      return kind
  }
}

// ── the plan (03 §7.5) ───────────────────────────────────────────────────

export interface PlannedOperation {
  readonly operation: SourceOperation
  readonly parkedOperationId: string
  readonly recoveryKey: string | null
  readonly kind: string
  readonly label: string
}

export interface ReapplyPlan {
  readonly planned: readonly PlannedOperation[]
  readonly dropped: readonly DroppedOperation[]
}

/**
 * Resolve `recoveryKeys` to real, currently-reapplicable ('replaced')
 * recoveries for this graph. A key that does not resolve — stale, wrong
 * graph, or a `reason` other than 'replaced' ('deleted' has no
 * destination, 'orphaned' has no fence, master §10.9/PW-16/17) — is
 * silently excluded rather than attempted: `canReapply` is a UI-level
 * precondition (the row action itself is unavailable for those reasons),
 * so a key reaching here in violation of it is treated as stale rather
 * than fabricating a destructive create/delete to represent it anyway.
 */
export function resolveTargets(
  recoveries: readonly DocumentRecoveryRecord[],
  recoveryKeys: readonly string[],
  graphId: string,
): readonly DocumentRecoveryRecord[] {
  const requested = new Set(recoveryKeys)
  return recoveries.filter(
    record => record.graphId === graphId && requested.has(record.key) && record.reason === 'replaced',
  )
}

export function buildPlan(
  targetDocuments: readonly DocumentRecoveryRecord[],
  allRecoveries: readonly DocumentRecoveryRecord[],
  outbox: readonly SourceOutboxRecord[],
  documentExists: (documentId: string) => boolean,
  documentIncarnationOf: (documentId: string) => string | null,
  newOperationId: () => string,
  /**
   * Every `reapplyOf` value ALREADY carried by some outbox row — a parked
   * operation's own id, or `snapshot:{recoveryKey}` for a recovery whose
   * synthesized snapshot already went out. `parkedOperations()`'s
   * `rejected-stale` rows are durable FOREVER (nothing ever deletes or
   * mutates them once superseded), so without this exclusion a SECOND
   * `run()` call — even with an EMPTY `recoveryKeys` (D3's loose
   * operations "always ride along") — would re-discover and re-plan the
   * SAME parked rows under brand-new fresh ids, resending already-
   * delivered work under a fresh id every time it is called (found live
   * against a real cell, G13's own step 1c neighbourhood).
   */
  alreadyReapplied: ReadonlySet<string> = new Set(),
): ReapplyPlan {
  const planned: PlannedOperation[] = []
  const dropped: DroppedOperation[] = []

  function planTyped(record: SourceOutboxRecord, recoveryKey: string | null): void {
    const operation = record.operation
    const parkedOperationId = operation.operationId
    const representability = representabilityOf(operation, documentExists)
    switch (representability.kind) {
      case 'representable':
      case 'may-contest': {
        // Every "bare" kind rides through verbatim except for the fresh
        // id — `currentState`'s own `baseVersion` is included in that
        // "verbatim", which is the whole point of C-D25: leaving it
        // UNCHANGED is what lets a genuine contest form instead of a
        // silent overwrite (`source_sync.rs:1003-1007`).
        planned.push({
          operation: { ...operation, operationId: newOperationId() },
          parkedOperationId,
          recoveryKey,
          kind: operation.kind,
          label: labelFor(operation.kind, false),
        })
        return
      }
      case 're-stamped': {
        if (representability.field === 'documentIncarnation') {
          const documentId = typeof operation.documentId === 'string' ? operation.documentId : null
          const incarnation = documentId !== null ? documentIncarnationOf(documentId) : null
          if (documentId === null || incarnation === null) {
            // Defensive only: `representabilityOf`'s `documentUpdate` case
            // does not itself check existence (03 §7.5's own "precede with
            // a create" branch is unreachable in practice here — reapply
            // is only ever offered for `reason:'replaced'` rows, where a
            // replacement document always exists by definition). If it is
            // somehow absent anyway, drop rather than push a
            // `documentIncarnation` the new life does not recognise.
            dropped.push({
              parkedOperationId,
              kind: operation.kind,
              recoveryKey,
              representability: { kind: 'unrepresentable', why: 'document-absent' },
            })
            return
          }
          planned.push({
            operation: { ...operation, operationId: newOperationId(), documentIncarnation: incarnation },
            parkedOperationId,
            recoveryKey,
            kind: operation.kind,
            label: labelFor(operation.kind, false),
          })
          return
        }
        // field === 'newDocumentIncarnation' — a `documentLifecycle create`
        // whose document is absent in the new life: representable with a
        // fresh incarnation (03 §7.5).
        planned.push({
          operation: { ...operation, operationId: newOperationId(), newDocumentIncarnation: randomUuid() },
          parkedOperationId,
          recoveryKey,
          kind: operation.kind,
          label: labelFor(operation.kind, false),
        })
        return
      }
      case 'already-satisfied':
      case 'unrepresentable':
        dropped.push({ parkedOperationId, kind: operation.kind, recoveryKey, representability })
        return
      case 'document-snapshot':
        // Never returned by `representabilityOf` for a real outbox
        // operation (Slice 8's own comment: reserved so the union is
        // complete for the SYNTHESIZED row this module adds below).
        return
    }
  }

  for (const document of targetDocuments) {
    const relatedIds = document.relatedOperationIds ?? []
    const records = relatedIds
      .map(operationId => outbox.find(candidate => candidate.operation.operationId === operationId))
      .filter((record): record is SourceOutboxRecord => record !== undefined)
      .filter(record => !alreadyReapplied.has(record.operation.operationId))
      .sort((left, right) => left.createdAt - right.createdAt)
    for (const record of records) planTyped(record, document.key)

    // C-D24, R20 — the synthesized snapshot, ALWAYS once per reapplied
    // recovery whose document exists in the new life (by construction,
    // `resolveTargets` already restricted to `reason:'replaced'`, so this
    // is true in every real call; the `else` branch is the same defensive
    // honesty as the `documentUpdate` case above). Appended AFTER the
    // document's own re-stamped typed operations. Skipped entirely
    // (neither planned nor dropped) once already sent once.
    if (alreadyReapplied.has(`snapshot:${document.key}`)) {
      // already reapplied — nothing new to plan or report for this recovery.
    } else if (documentExists(document.documentId)) {
      const incarnation = documentIncarnationOf(document.documentId)
      planned.push({
        operation: {
          kind: 'documentUpdate',
          operationId: newOperationId(),
          documentId: document.documentId,
          documentIncarnation: incarnation,
          updateBase64: encodeBase64(document.update),
        },
        parkedOperationId: `snapshot:${document.key}`,
        recoveryKey: document.key,
        kind: 'documentUpdate',
        label: labelFor('documentUpdate', true),
      })
    } else {
      dropped.push({
        parkedOperationId: `snapshot:${document.key}`,
        kind: 'documentUpdate',
        recoveryKey: document.key,
        representability: { kind: 'unrepresentable', why: 'document-absent' },
      })
    }
  }

  // Loose/graph-scoped parked operations (D3 — belong to no single
  // document) always ride along: there is no per-row selection affordance
  // for them (PW-13's "Unsent changes to the graph itself" has no
  // checkbox), and they have no OTHER path to ever being reapplied.
  // "Loose" is computed against EVERY recovery's claim, not only the
  // targets, matching `loadParkedWork`'s own `claimedOperationIds`
  // definition — an operation belonging to a document the caller did NOT
  // select stays that document's, never falls through as "loose".
  const claimed = new Set(allRecoveries.flatMap(record => record.relatedOperationIds ?? []))
  const loose = outbox
    .filter(record => !claimed.has(record.operation.operationId))
    .filter(record => !alreadyReapplied.has(record.operation.operationId))
    .sort((left, right) => left.createdAt - right.createdAt)
  for (const record of loose) planTyped(record, null)

  return { planned, dropped }
}

// ── the driver (03 §7.1-§7.4, §7.7) ─────────────────────────────────────

export class ReapplyController {
  private readonly options: ReapplyControllerOptions
  private inFlight: Promise<ReapplyOutcome> | null = null
  private cancelled = false
  private disposed = false

  constructor(options: ReapplyControllerOptions) {
    this.options = options
  }

  /** Idempotent while running: a second call returns the in-flight promise. */
  run(recoveryKeys: readonly string[]): Promise<ReapplyOutcome> {
    if (this.inFlight) return this.inFlight
    this.cancelled = false
    const promise = this.execute(recoveryKeys).finally(() => {
      this.inFlight = null
    })
    this.inFlight = promise
    return promise
  }

  /** Cooperative. Only honoured before the first operation is accepted
   *  (checked at the `pending`/`locking`/`backing_up` boundaries; once
   *  `restoring` begins pushing, the ledger's own append-only nature means
   *  there is no undo, so a late cancel can no longer mean `rolled_back` —
   *  03 §7.7). */
  cancel(): void {
    this.cancelled = true
  }

  dispose(): void {
    this.disposed = true
  }

  private pushView(view: ReapplyView): void {
    if (!this.disposed) this.options.onView(view)
  }

  private async execute(recoveryKeys: readonly string[]): Promise<ReapplyOutcome> {
    const { runtime, activation, userId, graphId, graphTitle } = this.options
    const now = this.options.now ?? Date.now
    const newOperationId = this.options.newOperationId ?? ((): string => `reapply:${randomUuid()}`)
    const manager = runtime.manager(graphId)

    const applied: string[] = []
    const contested: ContestedHandoff[] = []
    const failed: FailedOperation[] = []
    const collateral: FailedOperation[] = []

    const rolledBack = (message: string, dropped: readonly DroppedOperation[], targetKeys: readonly string[]): ReapplyOutcome => {
      this.pushView({
        active: true,
        stage: 'rolled_back',
        progress: 0,
        heading: 'Reapply did not start',
        message: 'Nothing was sent. Your parked work is exactly as it was.',
        error: message,
      })
      return { stage: 'rolled_back', applied: [], contested: [], dropped, failed: [], collateral: [], recoveryKeys: targetKeys }
    }

    // ── pending (RA-1) ─────────────────────────────────────────────────
    this.pushView({
      active: true,
      stage: 'pending',
      progress: 0,
      heading: 'Reapplying parked work',
      message: 'Reading what is parked and checking what can be carried over.',
      error: '',
    })

    const allRecoveries = (await activation.userRecoveries(userId)).filter(record => record.graphId === graphId)
    const targetDocuments = resolveTargets(allRecoveries, recoveryKeys, graphId)
    const targetKeys = targetDocuments.map(document => document.key)
    const bundle = runtime.bundleFor(graphId)
    if (!bundle) {
      return rolledBack(
        'SourceMirror: reapply requires a complete, unfenced local copy of this graph',
        [],
        targetKeys,
      )
    }
    const documentIncarnationOf = (documentId: string): string | null =>
      bundle.documents.find(document => document.documentId === documentId)?.documentIncarnation ?? null
    const documentExists = (documentId: string): boolean => documentIncarnationOf(documentId) !== null
    const outbox = runtime.parkedOperations(graphId)
    // fix(slice-9), refutation finding #2: only a DELIVERED prior attempt
    // excludes its original from a future plan — a failed one stays
    // reappliable (see `deliveredReapplyIds`'s own comment).
    const alreadyReapplied = deliveredReapplyIds(manager.outboxRecords())
    const { planned, dropped } = buildPlan(
      targetDocuments,
      allRecoveries,
      outbox,
      documentExists,
      documentIncarnationOf,
      newOperationId,
      alreadyReapplied,
    )

    if (this.cancelled) return rolledBack('SourceMirror: reapply was cancelled before it started', dropped, targetKeys)

    // ── locking (RA-2) ─────────────────────────────────────────────────
    this.pushView({
      active: true,
      stage: 'locking',
      progress: 5,
      heading: 'Reapplying parked work',
      message: "Holding this graph's current life steady.",
      error: '',
    })
    if (this.cancelled) return rolledBack('SourceMirror: reapply was cancelled before it started', dropped, targetKeys)

    // ── backing_up (RA-3) — build the export in memory, then DRAIN and
    //    REFUSE (§7.4, audit #5): this is what makes "one at a time" true
    //    rather than merely hoped. ────────────────────────────────────────
    this.pushView({
      active: true,
      stage: 'backing_up',
      progress: 10,
      heading: 'Reapplying parked work',
      message: 'Keeping a copy of the parked work before anything is sent.',
      error: '',
    })

    const deliverable = (): readonly SourceOutboxRecord[] =>
      manager.outboxRecords().filter(
        record =>
          (record.status === 'pending' || record.status === 'accepted')
          && record.graphIncarnation === manager.get().graphIncarnation,
      )
    if (deliverable().length > 0) {
      try {
        await manager.flush()
      } catch {
        // fall through to the check below
      }
    }
    if (deliverable().length > 0) {
      return rolledBack(
        'SourceMirror: reapply needs an empty outbox for this graph; unsent changes are still on their way',
        dropped,
        targetKeys,
      )
    }
    if (this.cancelled) return rolledBack('SourceMirror: reapply was cancelled before it started', dropped, targetKeys)

    // ── restoring (RA-4) ───────────────────────────────────────────────
    let fenced = false
    for (const [index, entry] of planned.entries()) {
      this.pushView({
        active: true,
        stage: 'restoring',
        progress: 10 + Math.round(65 * index / Math.max(planned.length, 1)),
        heading: 'Reapplying parked work',
        message: `Change ${index + 1} of ${planned.length} — ${entry.label}`,
        error: '',
      })
      const before = new Set(deliverable().map(record => record.operation.operationId))
      await manager.enqueue(entry.operation, { reapplyOf: entry.parkedOperationId })
      try {
        await manager.flush()
        this.classify(manager, entry, applied, contested, failed)
      } catch (error) {
        const fault = classifySourceFault(error)
        if (isFenceFault(fault)) {
          // This row's own status was already written by `flush()`'s own
          // four-way catch (rejected-stale, for a fence) — classify it for
          // real rather than fabricating a status.
          this.classify(manager, entry, applied, contested, failed)
          for (const remaining of planned.slice(index + 1)) {
            failed.push({
              operationId: null,
              parkedOperationId: remaining.parkedOperationId,
              kind: remaining.kind,
              recoveryKey: remaining.recoveryKey,
              status: 'pending',
              errorCode: fault.code,
              testimony: 'SourceMirror: this graph was fenced again mid-reapply; this change was never attempted',
            })
          }
          fenced = true
          break
        }
        // Re-read the outbox: the four-way catch (master §2.3) already
        // wrote final statuses, and it may have terminated rows this run
        // did not plan (WS4 OQ-9) — attribute by id, never "the receipts".
        for (const row of manager.outboxRecords()) {
          if (row.operation.operationId === entry.operation.operationId) {
            this.classify(manager, entry, applied, contested, failed, row)
          } else if (before.has(row.operation.operationId) && terminalOutboxStatus(row.status)) {
            collateral.push({
              operationId: row.operation.operationId,
              parkedOperationId: row.operation.operationId,
              kind: row.operation.kind,
              recoveryKey: null,
              status: row.status,
              errorCode: row.errorCode ?? null,
              testimony: row.error ?? fault.message,
            })
          }
        }
      }
      if (fenced) break
    }

    // ── rebuilding (RA-5) ──────────────────────────────────────────────
    this.pushView({
      active: true,
      stage: 'rebuilding',
      progress: 85,
      heading: 'Reapplying parked work',
      message: "Rebuilding this graph's local copy.",
      error: '',
    })
    try {
      await runtime.sync(graphId)
    } catch {
      // A rebuild failure does not retract what already applied — the next
      // ordinary sync repairs the local projection. `verifying` still
      // partitions off the outbox's own durable statuses below.
    }

    // ── verifying (RA-6) ───────────────────────────────────────────────
    this.pushView({
      active: true,
      stage: 'verifying',
      progress: 95,
      heading: 'Reapplying parked work',
      message: 'Checking the graph took every change.',
      error: '',
    })

    if (contested.length > 0) this.options.onContested(contested)

    const stage: 'succeeded' | 'failed' = failed.length === 0 ? 'succeeded' : 'failed'
    if (stage === 'succeeded') {
      for (const key of targetKeys) await activation.markRecoveryReapplied(key, now())
    }

    const outcome: ReapplyOutcome = { stage, applied, contested, dropped, failed, collateral, recoveryKeys: targetKeys }

    if (stage === 'succeeded') {
      const n = applied.length + contested.length
      const clauses: string[] = []
      if (contested.length > 0) {
        clauses.push(`${contested.length} object${pluralS(contested.length)} now have proposals to settle.`)
      }
      if (dropped.length > 0) {
        clauses.push(`${dropped.length} could not be carried over and stayed parked.`)
      }
      const tail = clauses.length > 0 ? clauses.join(' ') : 'The parked copy is kept for the record.'
      this.pushView({
        active: true,
        stage: 'succeeded',
        progress: 100,
        heading: 'Parked work reapplied',
        message: `${n === applied.length && contested.length === 0 && dropped.length === 0 ? 'All ' : ''}${n} changes are in ${graphTitle}. ${tail}`,
        error: '',
      })
    } else {
      const n = applied.length + contested.length
      this.pushView({
        active: true,
        stage: 'failed',
        progress: 100,
        heading: 'Reapply stopped partway',
        message: `${n} changes are in ${graphTitle}. ${failed.length} did not go through, and are still parked. `
          + 'Nothing already accepted was undone — it cannot be.',
        error: failed[0]?.testimony ?? '',
      })
    }

    return outcome
  }

  /**
   * The `verifying` predicate, disambiguated (audit #13, §7.4): receipt
   * status (`'accepted'|'applied'`) is the authority's ACKNOWLEDGEMENT;
   * outbox status is the DISPOSITION, and `reconcileReceipts` writes
   * `'conflict'` for a contested receipt. Reads the outbox row fresh
   * (unless already supplied) rather than trusting the raw receipts array.
   */
  private classify(
    manager: ReturnType<SourceMirrorRuntime['manager']>,
    entry: PlannedOperation,
    applied: string[],
    contested: ContestedHandoff[],
    failed: FailedOperation[],
    knownRow?: SourceOutboxRecord,
  ): void {
    const row = knownRow ?? manager.outboxRecords().find(record => record.operation.operationId === entry.operation.operationId)
    if (!row) {
      failed.push({
        operationId: entry.operation.operationId,
        parkedOperationId: entry.parkedOperationId,
        kind: entry.kind,
        recoveryKey: entry.recoveryKey,
        status: 'pending',
        errorCode: null,
        testimony: 'SourceMirror: reapply lost track of this operation locally',
      })
      return
    }
    switch (row.status) {
      case 'applied':
        applied.push(row.operation.operationId)
        return
      case 'accepted':
        if (row.receipt?.effectError) {
          failed.push({
            operationId: row.operation.operationId,
            parkedOperationId: entry.parkedOperationId,
            kind: entry.kind,
            recoveryKey: entry.recoveryKey,
            status: row.status,
            errorCode: row.errorCode ?? null,
            testimony: row.receipt.effectError,
          })
        } else {
          applied.push(row.operation.operationId)
        }
        return
      case 'conflict':
        contested.push({
          source: 'parked-reapply',
          operationId: row.operation.operationId,
          parkedOperationId: entry.parkedOperationId,
          objectKey: outcomeString(row.receipt, 'objectKey') ?? '',
          conflictId: outcomeString(row.receipt, 'conflictId'),
          recoveryKey: entry.recoveryKey,
        })
        return
      case 'rejected-permanent':
      case 'rejected-stale':
        failed.push({
          operationId: row.operation.operationId,
          parkedOperationId: entry.parkedOperationId,
          kind: entry.kind,
          recoveryKey: entry.recoveryKey,
          status: row.status,
          errorCode: row.errorCode ?? null,
          testimony: row.error ?? '',
        })
        return
      case 'pending':
        failed.push({
          operationId: row.operation.operationId,
          parkedOperationId: entry.parkedOperationId,
          kind: entry.kind,
          recoveryKey: entry.recoveryKey,
          status: 'pending',
          errorCode: row.errorCode ?? null,
          testimony: row.error ?? 'SourceMirror: this change was never delivered',
        })
        return
    }
  }
}
