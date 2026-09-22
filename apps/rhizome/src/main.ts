/**
 * main.ts — the RHIZOME browser shell (ONE integrated shell, LEFT RAIL).
 *
 * Boots the REAL render host (@shrubbery/runtime renderWorkspace) against the
 * RHIZOME WorkspaceConfig, lifts the chrome (top bar + left rail) + the single
 * resizable spine head (rz-shell, the content host) in place, and drives them
 * with LIVE memory-world reads from a real gardend cell (NO mock). The browser
 * reaches the cell over a SAME-ORIGIN Vite `/cell` proxy (see vite.config.ts) that
 * injects the bearer server-side — the token never reaches browser JS.
 *
 * SURFACE SWITCHING: the content region SWAPS by STATE, never page swaps. A small
 * hash router (router.ts, grammar MIRRORS the conneg URLs /plot, /plot/{rootId},
 * /walk, /walk/{runId} + ?asof/?turn) is the source of truth for the location; the
 * left rail (rz-rail) emits `rz-surface` to navigate. The shell (rz-shell) renders
 * the cross-surface ?asof scrubber once + the active surface body (Plot ↔ Walk).
 *
 * The app shell owns the UI state the surfaces do not:
 *   - `asof`        — the SCRUBBER lens (null = now). On change → re-fetch the Plot.
 *   - `openRoot`    — the opened bed (the BOUQUET) or null = the Plot grid.
 *   - `surface`     — the active surface (plot | walk), driven by the router.
 * The Plot data layer (MemoryWorld) is the only SPARQL site; the Walk surface is a
 * stub for now (its FILE data source lands in phase 2).
 *
 * Order matters: import @shrubbery/components + ./rz-rail + ./rz-shell BEFORE
 * renderWorkspace, so the stamped <rz-rail> / <rz-shell> upgrade in place.
 */

import '@shrubbery/tokens/tokens.css'
import {
  applySkinTheme,
  nextVisualIdentitySkin,
  type Theme,
  type VisualIdentitySkin,
} from '@shrubbery/tokens'
import '@shrubbery/components'
import './rz-rail.js'
import './rz-shell.js'
import { renderWorkspace } from '@shrubbery/runtime'
import type {
  BouquetResource,
  GreenhouseResource,
  MemoryRecord,
  PlotResource,
  SubjectResource,
  WalkIndexResource,
  WalkResource,
} from '@shrubbery/render'
import { RHIZOME } from './rhizome-config.js'
import { GardenClient } from './garden-client.js'
import { MemoryWorld } from './memory-world.js'
import { GreenhouseWorld } from './greenhouse-world.js'
import { EntityResolver } from './entity-resolution.js'
import type { GhostCluster } from './greenhouse-views.js'
import { TraceClient } from './trace-client.js'
import { createRouter, surfaceOf, type Route, type Surface } from './router.js'
import type { RzRail } from './rz-rail.js'
import type { RzShell } from './rz-shell.js'

// The graph to observe. URL `?graph=<id>` WINS (runtime, unambiguous — one bundle
// serves any graph, so switching/observing needs no per-graph dev-server restart and
// is immune to env-injection/bundle-cache fragility); else the build-time
// VITE_RHIZOME_GRAPH; else the default. (Surfaced in the top bar so the loaded graph
// is always visible — never guess which graph you're looking at.)
const GRAPH_ID =
  new URLSearchParams(location.search).get('graph') ||
  (import.meta as { env?: Record<string, string> }).env?.VITE_RHIZOME_GRAPH ||
  '6a1eabeb-agentic'

// Browser transport: the same-origin /cell proxy injects the bearer server-side.
const cell = new GardenClient({ transport: 'fetch', base: '/cell' })
const world = new MemoryWorld(cell, GRAPH_ID)
// THE GREENHOUSE reads the cell for the knobs + meters; the EntityResolver is the
// ONE write site (the real merge/collapse) the merge-ghost affordance calls.
const greenhouseWorld = new GreenhouseWorld(cell, GRAPH_ID)
const resolver = new EntityResolver(cell, GRAPH_ID)
// The WALK reads the trace FILES same-origin via the /traces dev middleware.
const traces = new TraceClient('/traces')

// ── Shell state ───────────────────────────────────────────────────────────────
let asof: string | null = null
let openRoot: string | null = null
let surface: Surface = 'plot'
let runId: string | null = null
let turn: number | null = null
// THE BOUQUET drill-down: the opened belief's root (null = the bouquet index grid).
let bouquetRoot: string | null = null
// THE REVERSE CROSS-LINK: bed rootId → the agentic run that minted its head. Built
// once from the Walk index (each run's supersededRoots), so a Plot bed can offer
// "open the Walk" → navigate IN-SHELL to that run. Empty until the index loads (or
// when the traces middleware is unreachable) — then the affordance simply absents.
let mintedBy: ReadonlyMap<string, string> = new Map()
// THE GREENHOUSE: the detected near-duplicate ghost clusters (the merge-ghost
// affordance), shown on the Plot AND in the Greenhouse's entity-resolution panel.
let ghosts: readonly GhostCluster[] = []

let activeSkin: VisualIdentitySkin = 'emporium'
let activeTheme: Theme = 'light'
applySkinTheme({ skin: activeSkin, theme: activeTheme })

// The hash router — the source of truth for the location (surface + params).
const router = createRouter()

// Render the workspace frame; lift the rail + the content host.
const host = document.getElementById('host') as HTMLElement
renderWorkspace(RHIZOME, { container: host })

// BRAND the stamped top bar (mirror apps/emporium + apps/organism). The glyph is a
// REGISTERED ICON NAME (the ported @shrubbery/components icon system → inline lucide
// SVG), never an emoji: 'sprout' — the rhizome/memory-bed motif.
const bar = host.querySelector('mn-app-bar') as
  | (HTMLElement & {
      brand?: string
      glyph?: string
      badge?: string
      activeSkin?: VisualIdentitySkin
      isDark?: boolean
    })
  | null
if (bar) {
  bar.brand = 'Rhizome'
  bar.glyph = 'sprout'
  bar.badge = GRAPH_ID
  bar.activeSkin = activeSkin
  bar.isDark = false
  bar.addEventListener('mn-skin-toggle', () => {
    activeSkin = nextVisualIdentitySkin(activeSkin)
    applySkinTheme({ skin: activeSkin, theme: activeTheme })
    bar.activeSkin = activeSkin
  })
  bar.addEventListener('mn-theme-toggle', () => {
    activeTheme = activeTheme === 'light' ? 'dark' : 'light'
    applySkinTheme({ skin: activeSkin, theme: activeTheme })
    bar.isDark = activeTheme === 'dark'
  })
}

const rail = host.querySelector('rz-rail') as RzRail | null
const shell = host.querySelector('rz-shell') as RzShell | null

/** Push props into the lifted shell. */
function setShell(props: Partial<RzShell>): void {
  if (!shell) return
  Object.assign(shell, props)
}

/** Mirror the active surface into the rail (the highlight) + the shell. */
function syncSurface(): void {
  if (rail) rail.surface = surface
  setShell({ surface, runId, turn, bouquetRoot })
}

/**
 * Build the REVERSE cross-link map (bed rootId → run id) from the Walk INDEX —
 * each run advertises the Plot bed rootIds it minted (run.supersededRoots, the
 * OLD record of each run_end edge). When several runs touch a bed we keep the
 * newest (the index is newest-first), so a bed points at its most recent minting
 * run. Best-effort: an unreachable traces middleware leaves the map empty (the
 * affordance just absents — NO fake link).
 */
async function loadMintedBy(): Promise<void> {
  try {
    const index = await traces.walk()
    const m = new Map<string, string>()
    for (const run of index.runs) {
      for (const rootId of run.supersededRoots) {
        if (!m.has(rootId)) m.set(rootId, run.id)
      }
    }
    mintedBy = m
    setShell({ mintedBy })
  } catch {
    // The Walk index is unreachable (e.g. /traces middleware down) — leave the
    // map empty; the Plot simply shows no "minted by run" affordance.
  }
}

/**
 * Build the entity-resolution GHOST CLUSTERS from the live detector — the near-
 * duplicate clusters (the merge-ghost affordance). Each ghost carries the member
 * record IRIs (passed verbatim to the REAL merge), the human label, and whether it
 * is CURRENTLY merged (a sameSubjectAs edge already binds it). Best-effort: a failed
 * read leaves the ghosts empty (the affordance just absents — NO fake). Shared by
 * the Plot + the Greenhouse, so the same fragmentation reads the same in both.
 */
async function loadGhosts(): Promise<void> {
  try {
    const [clusters, edges] = await Promise.all([
      resolver.detectDuplicates(),
      resolver.sameSubjectEdges(),
    ])
    const merged = new Set(edges.map((e) => e.from))
    ghosts = clusters.map((c) => ({
      signature: c.signature,
      label: c.label,
      recIris: c.records.map((r) => r.iri),
      n: c.records.length,
      // a cluster is "merged" when its non-canonical members all carry an edge.
      merged: c.records.filter((r) => r.iri !== c.canonical).every((r) => merged.has(r.iri)),
    }))
    setShell({ ghosts })
  } catch {
    // detector unreachable → no ghost affordance (never a fake cluster).
  }
}

// ── The GRAPH SWITCHER (R1) — the observe-loop wants to flip graphs in-app ──────
// The rail combobox lists `cell graphs ∪ visited recents`; choosing one reloads the
// observatory at `?graph=<id>` (GRAPH_ID binds at boot, so a reload is the clean,
// robust rewire — no in-place re-instantiation of world/resolver/cell). NO data path
// in the rail: main.ts builds the list (best-effort) + does the navigation.
const RECENTS_KEY = 'rz-graph-recents'

/** Read the visited-graph recents from localStorage (best-effort, newest-first). */
function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

/** Record a graph visit (newest-first, deduped, capped) so it autocompletes later. */
function recordGraphVisit(id: string): void {
  try {
    const next = [id, ...readRecents().filter((g) => g !== id)].slice(0, 24)
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch {
    // localStorage unavailable (private mode) — recents simply don't persist.
  }
}

/**
 * Build the combobox graph list: the cell's graphs (best-effort `list_graphs`,
 * tolerant of {graphs:[…]} | string[] | [{id|graphId|name}] shapes) UNIONed with
 * the visited recents + the current graph, deduped + sorted. A failed/absent
 * list_graphs degrades to recents-only (the combobox still works as free-text).
 */
async function loadGraphList(): Promise<string[]> {
  const set = new Set<string>([GRAPH_ID, ...readRecents()])
  try {
    const out = (await cell.mcp('list_graphs', {})) as unknown
    const arr = Array.isArray(out) ? out : ((out as { graphs?: unknown[] })?.graphs ?? [])
    for (const g of arr as unknown[]) {
      const id =
        typeof g === 'string'
          ? g
          : ((g as { id?: string })?.id ??
            (g as { graphId?: string })?.graphId ??
            (g as { name?: string })?.name)
      if (id) set.add(id)
    }
  } catch {
    // list_graphs absent/erroring on this cell — recents-only (still usable).
  }
  return [...set].sort()
}

/** Re-read the GREENHOUSE (knobs + meters) for the lens and push into the shell. */
async function refreshGreenhouse(): Promise<void> {
  setShell({ loading: true, error: '' })
  try {
    const greenhouse: GreenhouseResource = await greenhouseWorld.greenhouse(asof)
    setShell({ loading: false, asof, greenhouse })
    await loadGhosts()
    syncSurface()
  } catch (e) {
    setShell({ loading: false, error: e instanceof Error ? `${e.message}` : String(e) })
  }
}

/** Re-read the WALK trace files for the current (runId, turn) and push into the shell. */
async function refreshWalk(): Promise<void> {
  setShell({ loading: true, error: '' })
  try {
    if (runId) {
      const walk: WalkResource | null = await traces.trace(runId, turn)
      setShell({ loading: false, walk, walkIndex: null })
      syncSurface()
      return
    }
    const index: WalkIndexResource = await traces.walk()
    setShell({ loading: false, walk: null, walkIndex: index })
    syncSurface()
  } catch (e) {
    setShell({ loading: false, error: e instanceof Error ? `${e.message}` : String(e) })
  }
}

/**
 * Re-read the live cell for the current bouquet (asof, bouquetRoot) and push into
 * the shell. At the index level (no bouquetRoot) the readable beliefs are the SAME
 * Plot grid (refreshPlot fills plot/chains); a bloom reads world.bouquet().
 */
async function refreshBouquet(): Promise<void> {
  setShell({ loading: true, error: '' })
  try {
    if (bouquetRoot) {
      const bouquet: BouquetResource | null = await world.bouquet(bouquetRoot, asof)
      setShell({ loading: false, asof, bouquet })
      syncSurface()
      return
    }
    // The index grid = the Plot rows (the readable beliefs); reuse the plot read.
    await refreshPlot()
    setShell({ bouquet: null })
    syncSurface()
  } catch (e) {
    setShell({ loading: false, error: e instanceof Error ? `${e.message}` : String(e) })
  }
}

/** Read the Plot grid (the rows + each bed's chain) and push into the shell. */
async function refreshPlot(): Promise<void> {
  const plot: PlotResource = await world.plot(asof)
  const chains = new Map<string, readonly MemoryRecord[]>()
  for (const s of plot.subjects) {
    const sub = await world.subject(s.rootId, asof)
    if (sub) chains.set(s.rootId, sub.records)
  }
  setShell({ loading: false, asof, plot, chains })
}

/** Re-read the live cell for the current (asof, openRoot) and push into the shell. */
async function refresh(): Promise<void> {
  // The Walk surface reads the trace FILES (same-origin /traces) — not the cell.
  if (surface === 'walk') {
    void refreshWalk()
    return
  }
  if (surface === 'bouquet') {
    void refreshBouquet()
    return
  }
  if (surface === 'greenhouse') {
    void refreshGreenhouse()
    return
  }
  setShell({ loading: true, error: '' })
  try {
    if (openRoot) {
      const subject: SubjectResource | null = await world.subject(openRoot, asof)
      setShell({ loading: false, asof, openSubject: subject })
      syncSurface()
      return
    }
    const plot: PlotResource = await world.plot(asof)
    // Fetch each bed's full chain (the soil layer) for the plot cards.
    const chains = new Map<string, readonly MemoryRecord[]>()
    for (const s of plot.subjects) {
      const sub = await world.subject(s.rootId, asof)
      if (sub) chains.set(s.rootId, sub.records)
    }
    setShell({ loading: false, asof, plot, chains, openSubject: null })
    syncSurface()
  } catch (e) {
    setShell({ loading: false, error: e instanceof Error ? `${e.message}` : String(e) })
  }
}

// ── Wire the surface intents (rail) + the surface state (router) ───────────────
host.addEventListener('rz-surface', (e) => {
  const s = (e as CustomEvent<{ surface: Surface }>).detail.surface
  // Navigating to a surface resets its drill-down cursor + keeps the ?asof lens.
  router.navigate(
    s === 'walk'
      ? { kind: 'walk', asof }
      : s === 'bouquet'
        ? { kind: 'bouquet', asof }
        : s === 'greenhouse'
          ? { kind: 'greenhouse', asof }
          : { kind: 'plot', asof },
  )
})

// ── THE GRAPH SWITCHER intent — choosing a graph reloads at ?graph=<id> ─────────
host.addEventListener('rz-graph', (e) => {
  const id = (e as CustomEvent<{ graph: string }>).detail.graph
  const u = new URL(location.href)
  u.searchParams.set('graph', id)
  // Reload: GRAPH_ID (+ world/resolver/cell) bind at boot, so a navigation is the
  // clean rewire. The hash route + ?asof are preserved by reusing the current URL.
  location.href = u.toString()
})

// ── THE MERGE-GHOST intents — the ONE write site (the real entity-resolution merge) ──
host.addEventListener('rz-merge', (e) => {
  const recIris = (e as CustomEvent<{ recIris: readonly string[] }>).detail.recIris
  void doMerge(recIris)
})
host.addEventListener('rz-unmerge', (e) => {
  const recIris = (e as CustomEvent<{ recIris: readonly string[] }>).detail.recIris
  void doUnmerge(recIris)
})

/**
 * MERGE — the REAL write (entity-resolution.merge writes sameSubjectAs edges into the
 * non-reserved :entity-links sidecar; NO :projection write). After the write we
 * RE-READ everything that reflects it: the ghosts (now merged), the active surface's
 * data (the Plot collapses, the Greenhouse meter goes 3→1). The meter changing is the
 * proof the dial did the work.
 */
async function doMerge(recIris: readonly string[]): Promise<void> {
  setShell({ loading: true, error: '' })
  try {
    await resolver.merge(recIris)
    await loadGhosts()
    await refresh()
  } catch (err) {
    setShell({ loading: false, error: err instanceof Error ? err.message : String(err) })
  }
}

/** UNMERGE — the reverse (DELETE the edges) → the fragmentation returns; re-read. */
async function doUnmerge(recIris: readonly string[]): Promise<void> {
  setShell({ loading: true, error: '' })
  try {
    await resolver.unmerge(recIris)
    await loadGhosts()
    await refresh()
  } catch (err) {
    setShell({ loading: false, error: err instanceof Error ? err.message : String(err) })
  }
}

// ── Wire the observatory intents back to the shell ────────────────────────────
host.addEventListener('rz-asof', (e) => {
  asof = (e as CustomEvent<{ asof: string | null }>).detail.asof
  // Reflect the lens into the location (it persists across surfaces).
  const r = router.current()
  router.navigate({ ...r, asof } as Route)
})
host.addEventListener('rz-open', (e) => {
  const rootId = (e as CustomEvent<{ rootId: string }>).detail.rootId
  // DEEP-LINK (no island): opening a bed — whether from the Plot grid OR an entity
  // link inside a Bouquet — drills into the BOUQUET (the read-side constellation
  // reader), the richer twin of the structural lineage. The bare /plot/{rootId}
  // lineage view stays reachable via curl + the bed's rel=related links.
  bouquetRoot = rootId
  router.navigate({ kind: 'bouquet-subject', rootId, asof })
})
host.addEventListener('rz-back', () => {
  // Surface-aware back: a run → the walk index; a bloom → the bouquet index; a bed
  // → the plot grid.
  if (surface === 'walk') {
    runId = null
    turn = null
    router.navigate({ kind: 'walk', asof })
  } else if (surface === 'bouquet') {
    bouquetRoot = null
    router.navigate({ kind: 'bouquet', asof })
  } else {
    openRoot = null
    router.navigate({ kind: 'plot', asof })
  }
})

// ── The WALK intents (a run card opened; a turn lens picked) ───────────────────
host.addEventListener('rz-open-run', (e) => {
  runId = (e as CustomEvent<{ runId: string }>).detail.runId
  router.navigate({ kind: 'walk-run', runId, turn: null, asof })
})
host.addEventListener('rz-turn', (e) => {
  const t = (e as CustomEvent<{ turn: number | null }>).detail.turn
  if (runId) router.navigate({ kind: 'walk-run', runId, turn: t, asof })
})

// ── The router drives the actual state → refresh ──────────────────────────────
router.subscribe((route) => {
  surface = surfaceOf(route)
  asof = route.asof
  openRoot = route.kind === 'plot-subject' ? route.rootId : null
  bouquetRoot = route.kind === 'bouquet-subject' ? route.rootId : null
  runId = route.kind === 'walk-run' ? route.runId : null
  turn = route.kind === 'walk-run' ? route.turn : null
  void refresh()
})

// Detect the entity-resolution ghost clusters once on boot (independent of surface),
// so the Plot's merge-ghost affordance appears the moment the grid renders.
void loadGhosts()

// Build the reverse cross-link map (bed → minting run) once on boot, independent of
// the active surface, so the Plot can offer "open the Walk" the moment it renders.
void loadMintedBy()

// THE GRAPH SWITCHER: seed the rail combobox with the loaded graph, record the visit
// (so it autocompletes next time), and populate the list (cell graphs ∪ recents).
if (rail) rail.graph = GRAPH_ID
recordGraphVisit(GRAPH_ID)
void loadGraphList().then((graphs) => {
  if (rail) rail.graphs = graphs
})
