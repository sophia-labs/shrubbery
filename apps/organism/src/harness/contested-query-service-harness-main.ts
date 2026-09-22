/**
 * contested-query-service-harness-main.ts — REAL entry point wiring the
 * contested centre route through the REAL `renderWorkspace()` production
 * surface, on the REAL `GARDEN_DEFAULT` config (an ORDINARY route — no
 * `sh-layout-dashboard` marker anywhere in it) against a REAL spawned
 * gardend cell (MO object-face integration spec, master §2.8/§2.9, §3
 * Slice 5, gate G10).
 *
 * Proves R10 (`shell supplied no fragments.queryService`) is dead: this
 * harness never builds a `fragments` option at all — only `contested`, with
 * its OWN `queryService`/`objectService` — and the table still resolves
 * real rows, because `engineServicesFor` merges `opts.contested` FIRST
 * (master §2.8).
 *
 * NO MOCKS: `createGardendContract` builds the REAL `SourceMirrorRuntime`
 * (real IndexedDB, real MCP round-trips); `createSourceObjectService` and
 * `contestedSelectionFrom` are `apps/organism`'s actual production code.
 */
import '@shrubbery/tokens/tokens.css'
import { applySkinTheme } from '@shrubbery/tokens'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import {
  renderWorkspace,
  workspaceSurfaceReady,
  setWorkspaceNamedQueryRegistry,
  type SubjectRowActivateDetail,
} from '@shrubbery/runtime'
import { createGardendContract } from '../cell/gardend-contract.js'
import { createSourceObjectService } from '../cell/source-object-runtime.js'
import { createShellNamedQueryRegistry } from './shell-named-query-registry.js'
import { SYNC_QUERY } from './source-sync-query-catalog.js'
import {
  contestedSelectionFrom,
  reconcileContestedSelection,
  type ContestedSurfaceState,
} from '../cell/contested-surface.js'

export const GRAPH_ID = 'contested-query-service-harness-proof'

interface ContestedQueryServiceHarnessBridge {
  /** Re-derive `state` against the resident bundle and re-render — the
   *  same reconciliation `applySourceMirrorState` runs on a new epoch. */
  refresh(): Promise<void>
  /** The route's own state, for the browser script's own assertions. */
  currentSelection(): ContestedSurfaceState['selection']
}

declare global {
  interface Window {
    __contestedQueryServiceHarness?: ContestedQueryServiceHarnessBridge
  }
}

async function boot(): Promise<void> {
  applySkinTheme({ skin: 'garden', theme: 'light' })
  // Master §3 Slice 5: the SAME sealed registry production `main.ts` sets —
  // `sync.conflicts-open` resolves through it, exactly like any other
  // `urn:sophia:query:*` reference.
  setWorkspaceNamedQueryRegistry(createShellNamedQueryRegistry())

  const container = document.querySelector<HTMLElement>('#contested-query-service-root')
  if (!container) throw new Error('contested-query-service-harness: #contested-query-service-root is missing')

  const contract = createGardendContract({
    transport: { mcpUrl: '/cell/mcp', healthUrl: '/cell/health' },
  })
  // Prime the real mirror BEFORE the first render — createGardendContract
  // does not sync on its own (`card-object-harness-main.ts`'s own pattern).
  await contract.sourceMirror.open(GRAPH_ID)
  await contract.sourceMirror.sync(GRAPH_ID)
  const objectService = createSourceObjectService({ runtime: contract.sourceMirror, caller: contract.rawMcp })

  let state: ContestedSurfaceState = { graphId: GRAPH_ID, selection: null }

  function draw(): void {
    renderWorkspace(GARDEN_DEFAULT, {
      container: container!,
      surface: true,
      // Deliberately NO `fragments` option anywhere in this harness (R10's
      // own regression) — `contested` carries its own queryService/
      // objectService, exactly as master §2.8 requires for an ordinary
      // route.
      contested: {
        graphId: GRAPH_ID,
        queryId: SYNC_QUERY.conflictsOpen,
        queryService: contract.sourceMirror.surfaceQueryService(GRAPH_ID),
        objectService,
        maxRows: 200,
        selection: state.selection,
        onSelect: (detail: SubjectRowActivateDetail) => {
          state = {
            graphId: GRAPH_ID,
            selection: contestedSelectionFrom(detail, contract.sourceMirror.bundleFor(GRAPH_ID), GRAPH_ID),
          }
          draw()
        },
        onClose: () => {
          state = { graphId: GRAPH_ID, selection: null }
          draw()
        },
      },
    })
  }

  window.__contestedQueryServiceHarness = {
    async refresh() {
      state = reconcileContestedSelection(state, contract.sourceMirror.bundleFor(GRAPH_ID))
      draw()
    },
    currentSelection: () => state.selection,
  }

  draw()
  await workspaceSurfaceReady(container)
  document.body.dataset.contestedQueryServiceHarnessReady = 'true'
}

boot().catch((error: unknown) => {
  document.body.dataset.contestedQueryServiceHarnessError = error instanceof Error ? error.message : String(error)
  // eslint-disable-next-line no-console
  console.error('contested-query-service-harness boot failed:', error)
})
