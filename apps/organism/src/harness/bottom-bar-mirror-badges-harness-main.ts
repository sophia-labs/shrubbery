/**
 * bottom-bar-mirror-badges-harness-main.ts — REAL entry point wiring the
 * REAL `<mn-bottom-bar>` and `<mn-sidebar-panel>` (MO object-face
 * integration spec, master §3 Slice 4, gate G9) against a REAL spawned
 * gardend cell.
 *
 * Mirrors `card-object-harness-main.ts`'s own shape: the SAME production
 * `createGardendContract` (real IndexedDB-backed `SourceMirrorRuntime`, real
 * MCP round-trips over the same-origin `/cell` proxy — no token reaches this
 * module), and the SAME production `sourceStatusModel()` /
 * `decorateSidebarSectionsWithSourceState()` (`apps/organism/src/cell/
 * source-status.ts`) main.ts itself calls. Driven by `scripts/
 * bottom-bar-mirror-badges-browser.mts`.
 *
 * NO MOCKS: every badge asserted by the browser gate is computed from a
 * REAL `SourceMirrorManager` state, itself the product of REAL `source_push`
 * calls against a REAL cell (the contest) and a REAL, un-flushed local
 * `enqueue()` (the pending write) — never a synthesized `ChromeSourceStatus`,
 * except the ONE deliberately-synthetic count used for the right-collapsed
 * width-invariance probe (§3 Slice 4's own content), which is a property of
 * this component's CSS, not of any particular cell state.
 */
import '@shrubbery/tokens/tokens.css'
import { applySkinTheme } from '@shrubbery/tokens'
import '@shrubbery/components'
import type { ChromeSourceStatus, MnBottomBar } from '@shrubbery/components'
import type { SidebarSection } from '@shrubbery/runtime'
import * as Y from 'yjs'
import { createGardendContract, type GardendContract } from '../cell/gardend-contract.js'
import { decorateSidebarSectionsWithSourceState, sourceStatusModel } from '../cell/source-status.js'

export const GRAPH_ID = 'bottom-bar-mirror-badges-proof'
export const DOCUMENT_ID = 'bottom-bar-mirror-badges-doc'

interface HarnessBridge {
  /** Recompute both real projections from the live manager and re-render. */
  refresh(): Promise<void>
  /** A REAL, un-flushed `documentUpdate` enqueue — stays `pending` because
   *  no `flush()` follows. */
  enqueuePendingDocumentWrite(): Promise<void>
  /** The one deliberately-synthetic probe (§3 Slice 4): swaps the real
   *  contested count for a large one to prove the badge's measured width
   *  under `right-collapsed` does not grow with the digit count. Restores
   *  the real projection via `refresh()`. */
  setSyntheticContestedCount(count: number): void
}

declare global {
  interface Window {
    __bottomBarBadgesHarness?: HarnessBridge
  }
}

function emptyYUpdateBase64(): string {
  const doc = new Y.Doc()
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  let binary = ''
  for (const byte of update) binary += String.fromCharCode(byte)
  return globalThis.btoa(binary)
}

async function boot(): Promise<void> {
  applySkinTheme({ skin: 'garden', theme: 'light' })

  const bottomBar = document.querySelector('mn-bottom-bar') as MnBottomBar | null
  const sidebar = document.querySelector('mn-sidebar-panel') as (HTMLElement & { sections: readonly SidebarSection[] }) | null
  if (!bottomBar) throw new Error('bottom-bar-mirror-badges-harness: <mn-bottom-bar> is missing')
  if (!sidebar) throw new Error('bottom-bar-mirror-badges-harness: <mn-sidebar-panel> is missing')

  const contract: GardendContract = createGardendContract({
    transport: { mcpUrl: '/cell/mcp', healthUrl: '/cell/health' },
  })

  // Prime the real mirror BEFORE exposing the bridge (card-object-harness-
  // main.ts's own pattern — createGardendContract does not sync on its own).
  await contract.sourceMirror.open(GRAPH_ID)
  await contract.sourceMirror.sync(GRAPH_ID)

  const baseSections: readonly SidebarSection[] = [{
    id: 'documents',
    label: 'Documents',
    nodes: [{ id: DOCUMENT_ID, label: 'Badge doc', kind: 'document' }],
  }]

  function refresh(): void {
    const manager = contract.sourceMirror.manager(GRAPH_ID)
    bottomBar!.sourceStatus = sourceStatusModel(manager.get())
    sidebar!.sections = decorateSidebarSectionsWithSourceState(baseSections, manager.outboxRecords())
  }

  window.__bottomBarBadgesHarness = {
    async refresh() {
      refresh()
    },
    async enqueuePendingDocumentWrite() {
      const manager = contract.sourceMirror.manager(GRAPH_ID)
      const bundle = contract.sourceMirror.bundleFor(GRAPH_ID)
      const document_ = bundle?.documents.find((candidate) => candidate.documentId === DOCUMENT_ID)
      if (!document_) throw new Error(`bottom-bar-mirror-badges-harness: ${DOCUMENT_ID} is not in the complete bundle`)
      await manager.enqueue({
        kind: 'documentUpdate',
        operationId: 'bottom-bar-badges-pending-write',
        documentId: DOCUMENT_ID,
        documentIncarnation: document_.documentIncarnation,
        updateBase64: emptyYUpdateBase64(),
      })
      // Deliberately no flush() — this row must stay `pending`.
      refresh()
    },
    setSyntheticContestedCount(count: number) {
      const synthetic: ChromeSourceStatus = {
        badges: [{
          kind: 'contested',
          glyph: '◆',
          label: `${count} contested`,
          accessibleName: `${count} objects are contested. Open the contested list.`,
          hint: 'synthetic width probe — not a real cell state',
        }],
      }
      bottomBar!.sourceStatus = synthetic
    },
  }

  refresh()
  document.body.dataset.bottomBarBadgesHarnessReady = 'true'
}

boot().catch((error: unknown) => {
  document.body.dataset.bottomBarBadgesHarnessError = error instanceof Error ? error.message : String(error)
  // eslint-disable-next-line no-console
  console.error('bottom-bar-mirror-badges-harness boot failed:', error)
})
