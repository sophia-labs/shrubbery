/**
 * The ATELIER — the minimal "plain text" Sophia.
 *
 * A plain Vite app that boots the REAL render host (@shrubbery/runtime) against
 * the minimal one-text-panel :ux:config read LIVE from a REAL local gardend cell.
 * NO mock, NO faked fallback config. The whole app is ONE source: CELL_LIVE.
 *
 * The thesis (W0): with NOTHING but this minimal atelier running against a real
 * gardend, an OUT-OF-BAND write that appends grow-triples to the cell's :ux:config
 * named graph makes the DOM GROW — the EXISTING startPoll(3000) re-reads the graph
 * (rdf_dump → parseTriplesToConfig → planFor → renderWorkspace) and the new region
 * appears. This file only OWNS the read+render loop; WHO writes is downstream.
 *
 * What it wires (all real, all from the workspace packages):
 *   - @shrubbery/tokens — the design tokens + the skin/theme applier.
 *   - @shrubbery/components — registers the chrome custom elements (upgrade seam):
 *     the side-effect import is what lets <mn-card>/<mn-top-bar> UPGRADE live.
 *   - @shrubbery/atelier-vtuber — registers <mn-vtuber> (carved out of
 *     @shrubbery/components for its heavier @pixiv/three-vrm footprint): a live
 *     :ux:config docking a vtuber panel must upgrade the same way, not stamp inert.
 *   - @shrubbery/runtime — the real planFor → LayoutPlan → Lit DOM render host.
 *   - SHELL-SIDE: the gardend-backed contract + the session-store (live-read loop).
 *
 * The browser never sees the loopback token or port — the Vite proxy injects them
 * server-side (see vite.config.ts); the browser only calls same-origin /cell/*.
 */

// 0) The REAL design tokens — gives the chrome its --mn-* values + skin/theme.
import '@shrubbery/tokens/tokens.css'
import { applySkinTheme } from '@shrubbery/tokens'

// 1) Register the chrome components (side-effect import = the upgrade seam). This
//    is load-bearing: without it <mn-card>/<mn-top-bar> would appear in the DOM
//    but stay un-upgraded inert elements.
import '@shrubbery/components'
// mn-vtuber (the WebGL/VRM avatar puppet) is registered by its own package —
// carved out of @shrubbery/components for its heavier @pixiv/three-vrm
// dependency. Same upgrade seam, separate side-effect import: renderWorkspace
// below can dock a live :ux:config panel onto <mn-vtuber>, and without this it
// would stamp an inert, un-upgraded element.
import '@shrubbery/atelier-vtuber'

// 2) The real render host.
import { renderWorkspace } from '@shrubbery/runtime'
import type { ShrubberyStore, StoreState, WorkspaceConfig } from '@shrubbery/nucleus'

// 3) SHELL-SIDE: the gardend-backed contract + the session-store factory.
import { createGardendContract } from './cell/gardend-contract.js'
import {
  createSessionStore,
  workspaceConfigStore,
  type SessionStore,
  type SessionStoreState,
} from './cell/session-store.js'

// ── DOM handles ───────────────────────────────────────────────────────────────
const statusEl = document.getElementById('status') as HTMLDivElement
const hostEl = document.getElementById('host') as HTMLDivElement

const GRAPH_ID = 'atelier-dev'

// ── Status reporting ──────────────────────────────────────────────────────────
function ok(msg: string): void {
  statusEl.className = 'ok'
  statusEl.textContent = msg
}
function err(msg: string): void {
  statusEl.className = 'err'
  statusEl.textContent = msg
}

// ── The live-read loop — read :ux:config through the contract, then render ──────
//
// Browser transport = the SAME-ORIGIN Vite proxy at /cell (see vite.config.ts).
// The proxy injects the bearer + targets the random loopback port SERVER-SIDE, so
// the token/port NEVER appear in browser JS. We pass NO token here.
function buildCellStore(graphId: string): SessionStore {
  const contract = createGardendContract({
    transport: {
      mcpUrl: '/cell/mcp',
      healthUrl: '/cell/health',
      // token deliberately omitted — the proxy injects it server-side.
    },
  })
  return createSessionStore({ contract, graphId })
}

let configStore: ShrubberyStore<WorkspaceConfig> | null = null

function renderCellState(
  state: SessionStoreState,
  configState: StoreState<WorkspaceConfig> = configStore?.get() ?? { status: state.status, read: null, error: state.error },
): void {
  if (state.status === 'loading') {
    ok('reading :ux:config from the live gardend cell…')
    return
  }
  if (state.status === 'error') {
    // Surface the REAL error verbatim — NO faked fallback config.
    err(
      `live-read error (NO fallback — the atelier shows the real error):\n${state.error}\n\n` +
        `Is a cell running? Start one with:  pnpm gardend:dev`,
    )
    return
  }
  if (state.status === 'ready' && state.read) {
    if (configState.status !== 'ready' || !configState.read) {
      err(`live config store not ready (NO fallback):\nstatus=${configState.status}${configState.error ? `\n${configState.error}` : ''}`)
      return
    }
    const { read } = state
    try {
      renderWorkspace(configState.read, { container: hostEl })
      const when = new Date(read.readAt).toLocaleTimeString()
      const regions = Object.keys(configState.read.regions).length
      const roots = configState.read.rootRegions.length
      ok(
        `LIVE cell read @ ${when} · ${read.tripleCount} triples · ` +
          `${regions} regions · ${roots} rooted\nfrom ${read.graphIri}`,
      )
    } catch (e) {
      err(`render error (live config):\n${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

// ── Boot: apply the default skin/theme, then start the live-read loop + poll ────
applySkinTheme({ skin: 'garden', theme: 'light' })

const store = buildCellStore(GRAPH_ID)
configStore = workspaceConfigStore(store)
store.subscribe((state) => renderCellState(state, configStore?.get()))
void store.refresh()
// The EXISTING poll — re-reads :ux:config every 3s, so an out-of-band grow write
// to the cell's named graph makes the DOM grow within ≤3s with no UI action.
store.startPoll(3000)
