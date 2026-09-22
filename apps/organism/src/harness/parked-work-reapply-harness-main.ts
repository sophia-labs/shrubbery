/**
 * parked-work-reapply-harness-main.ts — REAL entry point driving the REAL
 * `ReapplyController` against the REAL, mounted `<mn-restore-overlay>` (MO
 * object-face integration spec, master §3 Slice 9, WS3 §7, gate G13).
 *
 * Continues from the SAME kind of fixture `graph-fence-parked-harness-
 * main.ts` builds (a real fence + a real parked recovery), built fresh and
 * self-contained here per this repo's own sibling-harness convention (each
 * browser proof boots its own fixture rather than depending on another
 * script's harness — `contested-resolution-harness-main.ts`/`contested-
 * query-service-harness-main.ts` are the precedent).
 *
 * NO MOCKS: `createGardendContract` builds the REAL `SourceMirrorRuntime`
 * (real IndexedDB, real MCP round-trips) and the REAL `DocumentActivation
 * Manager`; `ReapplyController` is production code, driving the REAL,
 * registered `<mn-restore-overlay>` custom element via direct property
 * assignment (the same seam `app-routes.ts`'s own `reapplyOverlayTemplate`
 * uses, minus the `renderWorkspace`/route-frame machinery this focused
 * harness does not need).
 */
import '@shrubbery/tokens/tokens.css'
import { applySkinTheme } from '@shrubbery/tokens'
import '@shrubbery/components'
import * as Y from 'yjs'
import type { MnRestoreOverlay } from '@shrubbery/components'
import type { SourceMirrorState, SourceOperation, SourceOutboxRecord } from '@shrubbery/source'
import { createGardendContract, type GardendContract } from '../cell/gardend-contract.js'
import { documentActivationKey, type DocumentCacheRecord } from '../cell/document-activation.js'
import { loadParkedWork, type ParkedWorkModel } from '../cell/parked-work.js'
import {
  ReapplyController,
  type ContestedHandoff,
  type ReapplyOutcome,
  type ReapplyView,
} from '../cell/reapply-controller.js'

export const GRAPH_ID = 'parked-work-reapply-harness-proof'
const HARNESS_USER_ID = 'local-organism'

interface HarnessBridge {
  mirrorState(): SourceMirrorState
  /** A document cached with NO `activateVisible` call at all this session
   *  (the C6 "never-rendered" branch `graph-fence-parked-harness-main.ts`
   *  already established) — the exact shape whose `relatedOperationIds`
   *  comes back empty, C-D24/R20's own precondition. */
  seedNeverRenderedDocument(documentId: string, text: string): Promise<void>
  /** A raw, durably-pending offline operation — never flushed until the
   *  fence marks it `rejected-stale`. */
  enqueueLoose(operation: SourceOperation): Promise<void>
  syncAndReportError(): Promise<{ readonly threw: boolean; readonly message: string | null }>
  adoptNewLife(): Promise<void>
  loadParkedWorkModel(): Promise<ParkedWorkModel>
  /** Drives the REAL `ReapplyController`, pushing every `ReapplyView` onto
   *  the REAL, mounted `<mn-restore-overlay>` exactly as `app-routes.ts`'s
   *  own wiring does, and recording the full view sequence for the
   *  driving script's own monotonic-progress assertion. */
  runReapply(recoveryKeys: readonly string[]): Promise<ReapplyOutcome>
  viewSequence(): readonly ReapplyView[]
  contestedHandoffs(): readonly ContestedHandoff[]
  overlaySnapshot(): {
    readonly active: boolean
    readonly operationState: string
    readonly progress: number
    readonly heading: string
    readonly message: string
    readonly error: string
  }
  /** An ordinary, real live edit in the CURRENT (already-adopted) life —
   *  for the drain-refusal proof (§7.4, step 1c). Never flushed by this call. */
  enqueueLiveEdit(operationId: string): Promise<void>
  flushNow(): Promise<{ readonly threw: boolean; readonly message: string | null }>
  outboxSnapshot(): readonly {
    readonly operationId: string
    readonly status: string
    readonly reapplyOf: string | null
  }[]
  cancelInFlight(): void
  /** The real `bundle.conflicts` rows for the CURRENT epoch, for the "the
   *  new life's value is still present as a proposal beside the parked
   *  one" assertion (step 4). `SourceConflict` now ships typed (build
   *  bundle review finding 6); re-widened to this bridge's own declared
   *  `Record<string, unknown>[]` shape, matching the Playwright
   *  serialization boundary every other bridge method here already crosses
   *  untyped. */
  bundleConflicts(): readonly Record<string, unknown>[]
}

declare global {
  interface Window {
    __parkedWorkReapplyHarness?: HarnessBridge
  }
}

async function boot(): Promise<void> {
  applySkinTheme({ skin: 'garden', theme: 'light' })

  const overlay = document.querySelector('mn-restore-overlay') as MnRestoreOverlay | null
  if (!overlay) throw new Error('parked-work-reapply-harness: <mn-restore-overlay> is missing')

  const contract: GardendContract = createGardendContract({
    transport: { mcpUrl: '/cell/mcp', healthUrl: '/cell/health' },
  })

  await contract.sourceMirror.open(GRAPH_ID)
  await contract.sourceMirror.sync(GRAPH_ID)

  let viewSequence: ReapplyView[] = []
  let contestedHandoffs: readonly ContestedHandoff[] = []
  let controller: ReapplyController | null = null

  function ensureController(): ReapplyController {
    if (controller) return controller
    controller = new ReapplyController({
      runtime: contract.sourceMirror,
      activation: contract.documentActivation,
      userId: HARNESS_USER_ID,
      graphId: GRAPH_ID,
      graphTitle: GRAPH_ID,
      onView: (view) => {
        viewSequence.push(view)
        // The SAME seam `app-routes.ts`'s `reapplyOverlayTemplate` binds —
        // direct property assignment onto the REAL, registered element.
        overlay!.active = view.active
        overlay!.operationState = view.stage
        overlay!.progress = view.progress
        overlay!.heading = view.heading
        overlay!.message = view.message
        overlay!.error = view.error
      },
      onContested: (handoffs) => {
        contestedHandoffs = handoffs
      },
    })
    return controller
  }

  window.__parkedWorkReapplyHarness = {
    mirrorState: () => contract.sourceMirror.manager(GRAPH_ID).get(),
    async seedNeverRenderedDocument(documentId, text) {
      const seedDoc = new Y.Doc()
      seedDoc.getText('body').insert(0, text)
      const update = Y.encodeStateAsUpdate(seedDoc)
      seedDoc.destroy()
      const key = { userId: HARNESS_USER_ID, graphId: GRAPH_ID, documentId }
      const record: DocumentCacheRecord = {
        ...key,
        key: documentActivationKey(key),
        schemaVersion: 1,
        update,
        savedAt: Date.now(),
        authority: 'offline',
        incarnation: null,
      }
      await contract.documentActivation.cache.put(record)
    },
    async enqueueLoose(operation) {
      await contract.sourceMirror.manager(GRAPH_ID).enqueue(operation)
    },
    async syncAndReportError() {
      try {
        await contract.sourceMirror.sync(GRAPH_ID)
        return { threw: false, message: null }
      } catch (error) {
        return { threw: true, message: error instanceof Error ? error.message : String(error) }
      }
    },
    async adoptNewLife() {
      await contract.sourceMirror.adoptNewLife(GRAPH_ID)
    },
    loadParkedWorkModel: () => loadParkedWork({
      userId: HARNESS_USER_ID,
      graphId: GRAPH_ID,
      graphTitle: GRAPH_ID,
      recoveries: userId => contract.documentActivation.userRecoveries(userId),
      operations: () => contract.sourceMirror.parkedOperations(GRAPH_ID),
      mirror: contract.sourceMirror.manager(GRAPH_ID).get(),
      documentExists: (documentId) => {
        const bundle = contract.sourceMirror.bundleFor(GRAPH_ID)
        return bundle ? bundle.documents.some(document => document.documentId === documentId) : false
      },
    }),
    async runReapply(recoveryKeys) {
      viewSequence = []
      contestedHandoffs = []
      return ensureController().run(recoveryKeys)
    },
    viewSequence: () => viewSequence,
    contestedHandoffs: () => contestedHandoffs,
    overlaySnapshot: () => ({
      active: overlay!.active,
      operationState: overlay!.operationState,
      progress: overlay!.progress,
      heading: overlay!.heading,
      message: overlay!.message,
      error: overlay!.error,
    }),
    async enqueueLiveEdit(operationId) {
      await contract.sourceMirror.manager(GRAPH_ID).enqueue({
        kind: 'graphMetadata',
        operationId,
        title: `an ordinary live edit — ${operationId}`,
      })
    },
    async flushNow() {
      try {
        await contract.sourceMirror.manager(GRAPH_ID).flush()
        return { threw: false, message: null }
      } catch (error) {
        return { threw: true, message: error instanceof Error ? error.message : String(error) }
      }
    },
    outboxSnapshot: () => contract.sourceMirror.manager(GRAPH_ID).outboxRecords().map((record: SourceOutboxRecord) => ({
      operationId: record.operation.operationId,
      status: record.status,
      reapplyOf: record.reapplyOf ?? null,
    })),
    cancelInFlight: () => controller?.cancel(),
    bundleConflicts: () => (contract.sourceMirror.bundleFor(GRAPH_ID)?.conflicts ?? []) as unknown as readonly Record<string, unknown>[],
  }

  document.body.dataset.parkedWorkReapplyHarnessReady = 'true'
}

boot().catch((error: unknown) => {
  document.body.dataset.parkedWorkReapplyHarnessError = error instanceof Error ? error.message : String(error)
  // eslint-disable-next-line no-console
  console.error('parked-work-reapply-harness boot failed:', error)
})
