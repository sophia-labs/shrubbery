/**
 * observatory-dashboard-main.ts — REAL entry point wiring the tabs-composed
 * "observatory surface v1" document (P7, plans/observatory-ux-
 * implementation-spec-20260728.md §3 P7 — graduated from the earlier
 * "observatory surface v0" this harness wired per Wave 2 / Lane B spec
 * `plans/surface-wave2-laneb-slice-20260716.md` §5/§6.3): a REAL
 * `LayoutInterpreter` + `FaceRegistry` + `LayoutResourceBroker` hosting SIX
 * generic query-backed faces (`stat.scalar`, `chart.vega-lite`,
 * `card.subject`, `sparql.bindings-table`, `sophia.home`,
 * `obs.evidence-chain`) over `buildObservatorySurfaceDocument()`, against a
 * REAL spawned `observatory` gardend cell
 * (`observatory-dashboard-gardend-browser.mts`).
 *
 * NO MOCKS: every face/adapter/registry/broker/interpreter class here is the
 * actual production implementation (`@shrubbery/runtime/layout`); the SPARQL
 * adapters run a REAL `QueryBlockService.run()` over a REAL
 * `LoopbackRestClient`/MCP round-trip through the SAME same-origin `/cell`
 * proxy `layout-workbench-main.ts` uses — the port/bearer token never reach
 * this module. `FaceRegistry` is constructed with NO
 * `allowOpenParamsFaceIds` (spec's own r3 note: "leave empty") — none of the
 * six faces registered below use the sealed open-params escape hatch.
 *
 * `sophia.home` is registered so a `close_leaf` that ever collapses this
 * document to LAY-010's home fallback has a face to mount (P7 Contract:
 * "`sophia.home` is registered so a close that collapses to LAY-010's home
 * fallback has a face to mount") — its resource adapter is registered
 * alongside it (`sophia.home` cannot mount without `sophia.home.marker`
 * resolving; see `sophia-home-face.ts`'s own header) even though the
 * Contract text names only the face, not the adapter, as a small necessary
 * completion of the same sentence's own intent.
 *
 * TAB ACTIVATION (P1's `onTabActivate` callback contract,
 * `layout-interpreter.ts`): `LayoutInterpreter` renders the tab strip and
 * calls `onTabActivate` on click/keyboard activation but does NOT itself
 * apply the operation — this harness is the caller or nobody is, so
 * `handleTabActivate` below runs the real `applyOperation('tabs_set_active')`
 * reducer and re-reconciles. This is LOCAL, in-memory persistence only (a
 * page reload resets to `ObsPulse`) — the SAME durability gap this file's
 * own drill-down wiring has (see `installSubjectDrillDown` below): this
 * harness holds one plain `LayoutDocument` variable with no durable-write
 * seam of its own (unlike the shell's fragment path, which persists through
 * `observatory-layout-sink.ts` at a commit settle point). Persisting either
 * tab activation or drill-down state through the SHELL's fragment path (the
 * `WorkspaceSurfaceModel.onRatioChange` counterpart for
 * `onActiveTabChange`/`SUBJECT_ROW_ACTIVATE_EVENT`) does not exist yet —
 * `onActiveTabChange` is a real, already-shipped `surface-host.ts` callback
 * (P1) with NO consumer anywhere in `render-workspace.ts` (verified: no
 * `applyFragmentRatio`-equivalent for tabs), and wiring one would mean
 * extending `WorkspaceSurfaceModel` (`workspace-surface-element.ts`) plus its
 * generic consumer — core Surface-engine files outside this packet's
 * territory. Per the spec's own P7 step 6 escape valve ("If the fragment
 * path makes that impossible, ship activation as non-durable and say so in
 * the commit rather than writing a namespaced id into ux:layoutJson"), both
 * are shipped non-durable here, said so in the commit, and NOT invented past.
 *
 * Deliberately minimal chrome otherwise: no split/move/swap actions beyond
 * tabs+drill-down — this harness exists to prove real materializer output is
 * consumable end-to-end by the real grid/chart/table/card/tabs/drill-down
 * machinery, not to exercise every layout-as-data operation (that's
 * `layout-workbench-main.ts`'s job).
 */
import '@shrubbery/tokens/tokens.css'
import { applySkinTheme } from '@shrubbery/tokens'
import { makeQueryBlockService } from '@shrubbery/runtime'
import {
  FaceRegistry,
  LayoutResourceBroker,
  LayoutInterpreter,
  GRID_COLLECTION_QUERY_ADAPTER_ID,
  createGridCollectionQueryResourceAdapter,
  createStatScalarFace,
  createStatScalarResourceAdapter,
  createChartVegaLiteFace,
  createChartVegaLiteResourceAdapter,
  createCardSubjectFace,
  createCardSubjectResourceAdapter,
  createSparqlBindingsTableFace,
  createSparqlBindingsTableResourceAdapter,
  createSophiaHomeFace,
  createSophiaHomeResourceAdapter,
  createEvidenceChainFace,
  createEvidenceChainResourceAdapter,
  createQueryTextResolver,
  installSubjectDrillDown,
  type TabActivateRequest,
} from '@shrubbery/runtime/layout'
import { applyOperation, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { LoopbackMcpClient } from '../cell/loopback-mcp.js'
import { LoopbackRestClient } from '../cell/gardend-contract.js'
import { buildObservatorySurfaceDocument, OBSERVATORY_SURFACE_DEFAULT_GRAPH_ID } from './observatory-surface-document.js'
import { createObservatorySurfaceNamedQueryRegistry } from './observatory-surface-query-catalog.js'

const OBS = 'http://mnemosyne.dev/observatory#'
const MACH = 'http://mnemosyne.dev/machine#'

const root = document.querySelector<HTMLElement>('#observatory-dashboard-root')!

// ── real MCP + REST client for every query-backed face (no mocks) — SAME
// same-origin `/cell` proxy `layout-workbench-main.ts` uses. ────────────────
const mcp = new LoopbackMcpClient({ mcpUrl: '/cell/mcp', healthUrl: '/cell/health' })
const rest = new LoopbackRestClient(mcp)
const queryService = makeQueryBlockService(rest)
let rawQueryCount = 0
const queryResolver = createQueryTextResolver({
  // P7: this harness's document is now the 19-name "observatory surface v1"
  // catalogue, not Stage 0's nine — the resolver must resolve against THAT
  // registry or every query on this page fails at acquire() with
  // 'unknown-name'.
  registry: createObservatorySurfaceNamedQueryRegistry(),
  rawTextPolicy: 'allow-raw',
  onRawText(locator) {
    rawQueryCount += 1
    document.body.dataset.observatoryRawQueries = String(rawQueryCount)
    console.warn(`observatory: raw query text resolved for ${locator.graphId}`)
  },
})

// ── real registry — the six generic faces this document (or a drill-down
// off it) can name, no open-params allowlist. ──────────────────────────────
const registry = new FaceRegistry()
registry.register(createStatScalarFace())
registry.register(createChartVegaLiteFace())
registry.register(createCardSubjectFace())
registry.register(createSparqlBindingsTableFace())
registry.register(createSophiaHomeFace())
registry.register(createEvidenceChainFace())
registry.seal()

// ── real broker — one adapter per face, plus the grid's OWN collection
// adapter (not bound to any one face — see that module's header). ──────────
const broker = new LayoutResourceBroker()
broker.registerAdapter(createStatScalarResourceAdapter(queryService, queryResolver))
broker.registerAdapter(createChartVegaLiteResourceAdapter(queryService, queryResolver))
broker.registerAdapter(createCardSubjectResourceAdapter(queryService))
broker.registerAdapter(createSparqlBindingsTableResourceAdapter(queryService, queryResolver))
broker.registerAdapter(createSophiaHomeResourceAdapter())
broker.registerAdapter(createEvidenceChainResourceAdapter(queryService))
broker.registerAdapter(createGridCollectionQueryResourceAdapter(queryService, queryResolver))

const validateOptions = {
  isFaceRegistered: registry.toFaceRegistrationPredicate(),
  isFaceGridEligible: registry.toFaceGridEligibilityPredicate(),
}

/** `let`, not `const` — tab activation and drill-down both replace this with a fresh, validated document (see this file's own header on non-durable persistence). */
let doc: LayoutDocument = buildObservatorySurfaceDocument(OBSERVATORY_SURFACE_DEFAULT_GRAPH_ID)

/** `LayoutInterpreter` renders the tab strip and reports activation; it does not apply the operation itself — see this file's header. */
function handleTabActivate(request: TabActivateRequest): void {
  const tabsNode = doc.nodes[request.tabsId]
  if (!tabsNode || tabsNode.kind !== 'tabs') return
  const outcome = applyOperation(
    doc,
    {
      op: 'tabs_set_active',
      tabsId: request.tabsId,
      activeNodeId: request.nodeId,
      expectedTabsRevision: tabsNode.tabsRevision,
    },
    validateOptions,
  )
  if (!outcome.ok) return
  doc = outcome.doc
  void reconcileAndRender()
}

const interpreter = new LayoutInterpreter(root, {
  registry,
  broker,
  gridCollectionResourceAdapterId: GRID_COLLECTION_QUERY_ADAPTER_ID,
  onTabActivate: handleTabActivate,
})

// ── the drill-down door (P6 runtime path, P7 wiring): activating a Fleet
// runs row splits a card.subject + obs.evidence-chain pair beside the table.
// `?item`'s IRI drives `card.subject`'s own subject-properties query; the
// field list mirrors what a MachineRunProjection actually carries
// (mach:runState, obs:bootMode, obs:stopReason, obs:evidenceEventCount,
// obs:evidenceEventId) — see plans/observatory-analysis-cell-spec-
// 20260715.md §A.2. ──────────────────────────────────────────────────────
const disposeDrillDown = installSubjectDrillDown(root, () => doc, (nextDoc) => { doc = nextDoc; void reconcileAndRender() }, {
  graphId: OBSERVATORY_SURFACE_DEFAULT_GRAPH_ID,
  cardTitleField: `${OBS}runId`,
  cardFields: `${MACH}runState,${OBS}bootMode,${OBS}stopReason,${OBS}evidenceEventCount,${OBS}evidenceEventId`,
  validate: validateOptions,
  onReject(diagnostic) {
    console.warn('observatory: drill-down rejected', diagnostic)
  },
})

let containerSize = { width: 1500, height: 1400 }
root.style.width = `${containerSize.width}px`
root.style.height = `${containerSize.height}px`

// ── the introspection bridge the Playwright proof drives ───────────────────
declare global {
  interface Window {
    __observatoryDashboard?: {
      readonly ready: boolean
      readonly interpreter: LayoutInterpreter
      readonly broker: LayoutResourceBroker
      readonly registry: FaceRegistry
      getDoc(): LayoutDocument
      reconcile(): Promise<{ ok: boolean; diagnostics: readonly unknown[] }>
      resizeContainer(width: number, height: number): Promise<{ ok: boolean; diagnostics: readonly unknown[] }>
    }
  }
}

function reconcileAndRender(): Promise<{ ok: boolean; diagnostics: readonly unknown[] }> {
  return interpreter.reconcile(doc, containerSize)
}

async function boot(): Promise<void> {
  const result = await reconcileAndRender()
  window.__observatoryDashboard = {
    ready: result.ok,
    interpreter,
    broker,
    registry,
    getDoc: () => doc,
    reconcile: reconcileAndRender,
    resizeContainer: (width, height) => {
      containerSize = { width, height }
      root.style.width = `${width}px`
      root.style.height = `${height}px`
      return reconcileAndRender()
    },
  }
  document.body.dataset.observatoryDashboardReady = String(result.ok)
  if (!result.ok) {
    document.body.dataset.observatoryDashboardError = JSON.stringify(result.diagnostics)
  }
}

applySkinTheme({ skin: 'garden', theme: 'light' })

window.addEventListener('beforeunload', () => {
  disposeDrillDown()
  void interpreter.dispose()
})

void boot().catch((error: unknown) => {
  document.body.dataset.observatoryDashboardError = error instanceof Error ? (error.stack ?? error.message) : String(error)
})
