/**
 * graph-fence-parked-harness-main.ts — REAL entry point wiring the REAL
 * `<mn-lifetime-banner>` and `<mn-workspace-selector>` (MO object-face
 * integration spec, master §3 Slice 7, WS3 §4.1/§4.3/§4.6/§6.1/§6.2, gate
 * G12) against a REAL spawned gardend cell, driven by
 * `scripts/graph-fence-parked-browser.mts`.
 *
 * Mirrors `bottom-bar-mirror-badges-harness-main.ts`'s own shape: the SAME
 * production `createGardendContract` (real IndexedDB-backed
 * `SourceMirrorRuntime`, real MCP round-trips over the same-origin `/cell`
 * proxy — no token reaches this module).
 *
 * The banner-state and workspace-summary COMPOSITIONS below are duplicated
 * from `apps/organism/src/main.ts`'s own `lifetimeBannerStateFor()` /
 * `workspaceSummaries()` rather than imported — both are small, private,
 * shell-local derivations over the SAME untyped `SourceMirrorState`/
 * `rest.graphs()` boundary `knownCandidateOperationIdsFor` (`source-mirror-
 * runtime.ts`) and `contestFromWire` (`source-object-runtime.ts`) already
 * duplicate for the identical reason (D-4): each call site narrows exactly
 * what it needs off the same wire shape, and `main.ts` exports neither
 * function. The REAL functions under test — `SourceMirrorManager.
 * adoptNewLife()`, `SourceMirrorRuntime.adoptNewLife()`/`parkedOperations()`,
 * the reversed `rest.graphs()` filter — are all production code, imported
 * and called for real; only the tiny presentation glue is re-derived here.
 *
 * NO MOCKS: every assertion in the driving script reads REAL
 * `SourceMirrorState`, a REAL `rest.graphs()` round trip (network-partitioned
 * by the driving script to exercise the offline fallback), and REAL
 * `<mn-lifetime-banner>`/`<mn-workspace-selector>` DOM.
 */
import '@shrubbery/tokens/tokens.css'
import { applySkinTheme } from '@shrubbery/tokens'
import '@shrubbery/components'
import * as Y from 'yjs'
import type {
  MnLifetimeBanner,
  MnLifetimeBannerState,
  MnWorkspaceSelector,
  MnWorkspaceSummary,
} from '@shrubbery/components'
import type { SourceMirrorState, SourceOutboxRecord } from '@shrubbery/source'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import { renderWorkspace, workspaceSurfaceReady, type SidebarNodeDetail } from '@shrubbery/runtime'
import { createGardendContract, type GardendContract } from '../cell/gardend-contract.js'
import { documentActivationKey, type DocumentCacheRecord } from '../cell/document-activation.js'
import {
  loadParkedWork,
  exportParkedWork,
  parkedSidebarSection,
  parkedRecoveryKeyOf,
  type ParkedWorkModel,
} from '../cell/parked-work.js'

export const GRAPH_ID = 'graph-fence-parked-harness-proof'
export const RENDERED_DOCUMENT_ID = 'parked-doc-rendered'
export const NEVER_RENDERED_DOCUMENT_ID = 'parked-doc-never-rendered'
const HARNESS_USER_ID = 'local-organism'

interface HarnessBridge {
  mirrorState(): SourceMirrorState
  /** A REAL, un-flushed graph-scoped write — stays `pending` until a flush
   *  attempt (which this harness never makes) or `adoptNewLife()` marks it
   *  `rejected-stale` (WS3 C3's own scenario: a row enqueued under the
   *  still-current-but-about-to-be-superseded incarnation). */
  enqueueLooseOperation(): Promise<void>
  /** `SourceMirrorRuntime.sync()` — awaited, never rethrown to the caller
   *  (Playwright's `page.evaluate` would otherwise reject the whole call);
   *  the boolean reports whether it threw, which the driving script asserts
   *  against separately from the durable state `mirrorState()` exposes. */
  syncAndReportError(): Promise<{ readonly threw: boolean; readonly message: string | null }>
  /** The raw `rest.graphs()` round trip — offline-fallback shape when the
   *  live listing is unreachable (the driving script partitions `/cell/**`
   *  before calling this), exactly the boundary `main.ts`'s
   *  `refreshHostedGraphs()` itself defensively unwraps. */
  restGraphs(): Promise<unknown>
  /** Compose the REAL banner state (mirroring `main.ts`'s own
   *  `lifetimeBannerStateFor()`) and push it onto the REAL, mounted
   *  `<mn-lifetime-banner>`. */
  refreshBanner(): void
  /** Compose a REAL `MnWorkspaceSummary[]` from `restGraphs()`'s offline
   *  fallback shape (mirroring `main.ts`'s own `workspaceSummaries()`) and
   *  push it onto the REAL, mounted `<mn-workspace-selector>`. */
  refreshSelector(): Promise<void>
  adoptNewLife(): Promise<void>
  parkedOperations(): readonly SourceOutboxRecord[]
  lastError(): string | null
  /**
   * master §3 Slice 8 (WS3 §10.2 steps 2/3). Two REAL documents, both
   * durable in the REAL IndexedDB cache with `authority:'offline'` before
   * the fence:
   *   - `RENDERED_DOCUMENT_ID` — opened live via `activateVisible`, given a
   *     real Y.Doc edit, then disposed (the ordinary offline-edit path).
   *   - `NEVER_RENDERED_DOCUMENT_ID` — written directly into
   *     `documentActivation.cache` with NO `activateVisible` call at all —
   *     a document cached in an earlier session and never opened in this
   *     one. `adoptNewLife()`'s own re-import (already exercised at step
   *     10, `importCompleteMirror` → `pruneGraph` against the recreated
   *     graph's now-EMPTY document list) orphans BOTH into the recovery
   *     store through the pre-existing storage-level pass — the C6 RACE
   *     itself (an active binding dirtied before ever painting) is a
   *     narrower, timing-dependent scenario with its own dedicated,
   *     deterministic proof in `document-activation.test.ts` (R3); this
   *     journey proves the FACE lists a document that was simply never
   *     rendered THIS session, which is what its own text names.
   */
  seedParkedDocuments(): Promise<{ readonly renderedText: string }>
  /** The REAL `loadParkedWork` join over the REAL `documentActivation` +
   *  `sourceMirror` for THIS graph (master §3 Slice 8, WS3 §4.5). */
  loadParkedWorkModel(): Promise<ParkedWorkModel>
  /** The REAL export for one recovery — base64 + sha256 computed for real. */
  exportParkedDocument(recoveryKey: string): Promise<{ readonly updateBase64: string; readonly documentId: string }>
  /** `documentActivation.userRecoveries(userId)` for an ARBITRARY userId —
   *  proves the storage is genuinely user-scoped without simulating a full
   *  sign-out/sign-in UI flow. */
  userRecoveryCount(userId: string): Promise<number>
  /** `clearUser(userId, {retainRecoveries:true})` — the D7 default — then
   *  reports whether this session's own recoveries survived it. */
  clearUserRetainingRecoveries(): Promise<{ readonly countAfter: number }>
  /**
   * fix(slice-8), R22/G12 step 5b (master §3 Slice 9's dispatched
   * adversarial review, finding #1: this step was named twice in the
   * spec — WS3 §10.2, master §8.3 R22 — and never built; Slice 8's own
   * build log records the gap as Divergence 8 rather than claiming it).
   *
   * Mounts the REAL `<mn-sidebar-panel>` INSIDE the REAL
   * `renderWorkspace()` shell — the SAME production surface
   * `contested-query-service-harness-main.ts` exercises for Slice 5's own
   * G10 — fed the REAL `parkedSidebarSection()` over the REAL
   * `loadParkedWork()` join. Returns every parked row's real recoveryKey
   * so the driving script can click one for real.
   */
  mountParkedSidebar(): Promise<{ readonly recoveryKeys: readonly string[] }>
  /**
   * The REAL routing decision `main.ts`'s own `handleSidebarNodeOpen`
   * makes (`main.ts:3992-4001`, branch order verified identical: the
   * parked branch precedes the document fallthrough, R22) — reproduced
   * here rather than imported, matching this file's own established
   * shell-local-duplication pattern (D-4, see header comment) for the
   * SAME reason: `main.ts` exports neither function, and both sides
   * derive off the same real `SidebarNodeDetail` the mounted, real
   * `<mn-sidebar-panel>` emits.
   *
   * `openedRecoveryKey` is non-null exactly when a REAL DOM click on a
   * parked row fired `mn-sidebar-node-open` with `node.section ===
   * 'parked'` and the branch that would otherwise attempt a document
   * open (`prepareDocumentIntent` → an editor mount) was never reached.
   */
  parkedSidebarRouteState(): {
    readonly openedRecoveryKey: string | null
    readonly documentOpenAttempted: string | null
  }
}

declare global {
  interface Window {
    __graphFenceParkedHarness?: HarnessBridge
  }
}

/** Mirrors `main.ts`'s own `lifetimeBannerStateFor()` (master §3 Slice 7). */
function bannerStateFor(state: SourceMirrorState): MnLifetimeBannerState | null {
  if (!state.fenced) return null
  return {
    reason: 'graph-recreated',
    graphTitle: GRAPH_ID,
    previousLife: (state.graphIncarnation ?? '').slice(0, 8),
    parkedDocuments: 0,
    parkedOperations: state.parked + state.nonDocumentParked,
    testimony: state.fenceTestimony ?? '',
  }
}

/** Mirrors `main.ts`'s own `refreshHostedGraphs()` offline-row unwrap +
 *  `workspaceSummaries()`'s spread — this harness's ONLY "live" catalog IS
 *  the offline fallback shape once `/cell/**` is partitioned, so there is
 *  no separate live-success branch to model here. */
function workspaceSummariesFromOfflineRows(raw: unknown): readonly MnWorkspaceSummary[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { graphs?: unknown }).graphs)
      ? (raw as { graphs: unknown[] }).graphs
      : []
  return rows.flatMap((value): MnWorkspaceSummary[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const row = value as Record<string, unknown>
    const graphId = typeof row.graphId === 'string' ? row.graphId : ''
    if (!graphId) return []
    const lifetime = row.lifetime
    return [{
      graphId,
      title: typeof row.title === 'string' ? row.title : graphId,
      role: 'owner',
      cellState: 'running',
      lifetime: lifetime && typeof lifetime === 'object' && !Array.isArray(lifetime)
        ? (lifetime as MnWorkspaceSummary['lifetime'])
        : null,
    }]
  })
}

async function boot(): Promise<void> {
  applySkinTheme({ skin: 'garden', theme: 'light' })

  const banner = document.querySelector('mn-lifetime-banner') as MnLifetimeBanner | null
  const selector = document.querySelector('mn-workspace-selector') as MnWorkspaceSelector | null
  const parkedSidebarRoot = document.querySelector<HTMLElement>('#parked-sidebar-root')
  if (!banner) throw new Error('graph-fence-parked-harness: <mn-lifetime-banner> is missing')
  if (!selector) throw new Error('graph-fence-parked-harness: <mn-workspace-selector> is missing')
  if (!parkedSidebarRoot) throw new Error('graph-fence-parked-harness: #parked-sidebar-root is missing')
  selector.embedded = true
  selector.status = 'ready'

  const contract: GardendContract = createGardendContract({
    transport: { mcpUrl: '/cell/mcp', healthUrl: '/cell/health' },
  })

  // Prime the real mirror BEFORE exposing the bridge (the established
  // pattern every sibling harness in this file uses).
  await contract.sourceMirror.open(GRAPH_ID)
  await contract.sourceMirror.sync(GRAPH_ID)

  let lastError: string | null = null

  function refreshBanner(): void {
    const state = contract.sourceMirror.manager(GRAPH_ID).get()
    banner!.state = bannerStateFor(state)
  }

  // ── fix(slice-8), R22/G12 step 5b ────────────────────────────────────────
  // The REAL `renderWorkspace()` shell hosting a REAL `<mn-sidebar-panel>`
  // fed the REAL `parkedSidebarSection()`, plus the REAL `garden.parked-work`
  // centre route (`opts.parkedWork`) it opens into — the SAME production
  // surface `contested-query-service-harness-main.ts` drives for Slice 5's
  // own G10. `parkedFaceModel`/`parkedFaceOpenKey` mirror `main.ts`'s own
  // `currentParkedWork`/`currentParkedWorkRoute` split (master §2.9: the
  // loaded MODEL and whether the ROUTE is open are independent axes).
  let parkedFaceModel: ParkedWorkModel | null = null
  let parkedFaceOpenKey: string | null = null
  let openedRecoveryKey: string | null = null
  let documentOpenAttempted: string | null = null

  function drawParkedSidebar(): void {
    const section = parkedSidebarSection(parkedFaceModel)
    renderWorkspace(GARDEN_DEFAULT, {
      container: parkedSidebarRoot!,
      surface: true,
      ...(parkedFaceOpenKey !== null && parkedFaceModel
        ? { parkedWork: { graphId: GRAPH_ID, model: parkedFaceModel, focusRecoveryKey: parkedFaceOpenKey } }
        : {}),
      sidebar: {
        sections: section ? [section] : [],
        status: 'ready',
        // Mirrors `main.ts`'s REAL `handleSidebarNodeOpen` (`:3992-4001`,
        // R22): the parked branch MUST precede any document-open attempt.
        // This is real production branch logic, duplicated for the same
        // reason this file's header comment already gives for the
        // banner/selector compositions (D-4) — `main.ts` exports neither
        // function, and both sides read the SAME real `SidebarNodeDetail`
        // the mounted, real `<mn-sidebar-panel>` emits from a real click.
        onNodeOpen: (detail: SidebarNodeDetail) => {
          if (detail.node.section === 'parked') {
            openedRecoveryKey = parkedRecoveryKeyOf(detail.id)
            parkedFaceOpenKey = openedRecoveryKey
            drawParkedSidebar()
            return
          }
          // The branch a real document row would take — `main.ts` calls
          // `prepareDocumentIntent` here, which is what eventually mounts
          // an editor and issues a document fetch. This harness does not
          // reproduce the editor (out of its own scope, matching every
          // sibling harness in this file); it records that the branch was
          // REACHED, which for a parked row must never happen.
          documentOpenAttempted = detail.id
        },
      },
    })
  }

  window.__graphFenceParkedHarness = {
    mirrorState: () => contract.sourceMirror.manager(GRAPH_ID).get(),
    async enqueueLooseOperation() {
      await contract.sourceMirror.manager(GRAPH_ID).enqueue({
        kind: 'graphMetadata',
        operationId: 'graph-fence-parked-loose-op-1',
        title: 'Offline title edit — never flushed before the fence',
      })
    },
    async syncAndReportError() {
      try {
        await contract.sourceMirror.sync(GRAPH_ID)
        return { threw: false, message: null }
      } catch (error) {
        return { threw: true, message: error instanceof Error ? error.message : String(error) }
      }
    },
    restGraphs: () => contract.sourceMirror.rest.graphs(),
    refreshBanner,
    async refreshSelector() {
      const raw = await contract.sourceMirror.rest.graphs()
      selector!.workspaces = workspaceSummariesFromOfflineRows(raw)
    },
    async adoptNewLife() {
      await contract.sourceMirror.adoptNewLife(GRAPH_ID)
      refreshBanner()
    },
    parkedOperations: () => contract.sourceMirror.parkedOperations(GRAPH_ID),
    lastError: () => lastError,
    async seedParkedDocuments() {
      // Document A — a REAL activateVisible binding kept ACTIVE (never
      // disposed) through the fence, so `adoptNewLife()`'s re-import
      // quarantines it via the ACTIVE-BINDING branch of `pruneGraph`
      // (the real `quarantine()` function this slice's C6 fix touches).
      const liveDoc = new Y.Doc()
      const activation = contract.documentActivation.activateVisible(
        { userId: HARNESS_USER_ID, graphId: GRAPH_ID, documentId: RENDERED_DOCUMENT_ID },
        liveDoc,
        new Promise<void>(() => {}), // never synchronizes — this binding stays offline throughout
      )
      await activation.whenEditable
      const renderedText = 'offline edit made before the fence, binding still open'
      liveDoc.getText('body').insert(0, renderedText)
      await activation.flush()

      // Document B — never opened THIS session at all: a direct write into
      // the same real IndexedDB-backed cache `activateVisible` itself
      // reads, simulating a document cached in an earlier session.
      const seedDoc = new Y.Doc()
      seedDoc.getText('body').insert(0, 'never rendered this session, but real offline text')
      const update = Y.encodeStateAsUpdate(seedDoc)
      seedDoc.destroy()
      const neverRenderedKey = { userId: HARNESS_USER_ID, graphId: GRAPH_ID, documentId: NEVER_RENDERED_DOCUMENT_ID }
      const neverRenderedRecord: DocumentCacheRecord = {
        ...neverRenderedKey,
        key: documentActivationKey(neverRenderedKey),
        schemaVersion: 1,
        update,
        savedAt: Date.now(),
        authority: 'offline',
        incarnation: null,
      }
      await contract.documentActivation.cache.put(neverRenderedRecord)

      return { renderedText }
    },
    loadParkedWorkModel: () => loadParkedWork({
      userId: HARNESS_USER_ID,
      graphId: GRAPH_ID,
      graphTitle: GRAPH_ID,
      recoveries: userId => contract.documentActivation.userRecoveries(userId),
      operations: () => contract.sourceMirror.parkedOperations(GRAPH_ID),
      mirror: contract.sourceMirror.manager(GRAPH_ID).get(),
    }),
    async exportParkedDocument(recoveryKey) {
      const documents = await contract.documentActivation.userRecoveries(HARNESS_USER_ID)
      const operations = contract.sourceMirror.parkedOperations(GRAPH_ID)
      const mirror = contract.sourceMirror.manager(GRAPH_ID).get()
      const payload = await exportParkedWork(
        {
          userId: HARNESS_USER_ID,
          graphId: GRAPH_ID,
          graphTitle: GRAPH_ID,
          previousGraphIncarnation: mirror.graphIncarnation ?? '',
          fenceTestimony: mirror.fenceTestimony,
          schemaVersion: 1,
        },
        documents,
        operations,
        recoveryKey,
      )
      const exported = payload.documents[0]
      if (!exported) throw new Error(`exportParkedDocument: no document for recoveryKey ${recoveryKey}`)
      return { updateBase64: exported.updateBase64, documentId: exported.documentId }
    },
    async userRecoveryCount(userId) {
      return (await contract.documentActivation.userRecoveries(userId)).length
    },
    async clearUserRetainingRecoveries() {
      await contract.documentActivation.clearUser(HARNESS_USER_ID, { retainRecoveries: true })
      return { countAfter: (await contract.documentActivation.userRecoveries(HARNESS_USER_ID)).length }
    },
    async mountParkedSidebar() {
      parkedFaceModel = await loadParkedWork({
        userId: HARNESS_USER_ID,
        graphId: GRAPH_ID,
        graphTitle: GRAPH_ID,
        recoveries: userId => contract.documentActivation.userRecoveries(userId),
        operations: () => contract.sourceMirror.parkedOperations(GRAPH_ID),
        mirror: contract.sourceMirror.manager(GRAPH_ID).get(),
      })
      parkedFaceOpenKey = null
      openedRecoveryKey = null
      documentOpenAttempted = null
      drawParkedSidebar()
      await workspaceSurfaceReady(parkedSidebarRoot!)
      return { recoveryKeys: parkedFaceModel.documents.map(row => row.recoveryKey) }
    },
    parkedSidebarRouteState: () => ({ openedRecoveryKey, documentOpenAttempted }),
  }

  refreshBanner()
  document.body.dataset.graphFenceParkedHarnessReady = 'true'
}

boot().catch((error: unknown) => {
  document.body.dataset.graphFenceParkedHarnessError = error instanceof Error ? error.message : String(error)
  // eslint-disable-next-line no-console
  console.error('graph-fence-parked-harness boot failed:', error)
})
