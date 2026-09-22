/**
 * layout-workbench-main.ts — REAL entry point wiring the P2 layout vehicle
 * (`LayoutInterpreter` + `FaceRegistry` + `LayoutResourceBroker` +
 * `hoja.document`/`sparql.bindings-table`/`sophia.home` — the ratified P2
 * catalog, design §9.2 Phase 2's exact "Register exactly hoja.document,
 * sparql.bindings-table, and an honest sophia.home fallback"; diff-review r2
 * WRONG "media.viewer is a fourth addition beyond the authority's 'exactly'
 * wording" — kept OUT of that ratified catalog. `media.viewer` IS still
 * registered on this SAME registry/broker (F6, repair round 3) — this file
 * is its ONE quarantined harness-only consumer, reached through the
 * explicitly-internal `@shrubbery/runtime/layout/faces/media-face-internal`
 * subpath, never the public `@shrubbery/runtime/layout` barrel — see the
 * registration's own comment below for the full quarantine rationale),
 * `registry.seal()`ed after boot) against a REAL spawned gardend cell.
 *
 * NO MOCKS: `EditorRoomPool` wraps a REAL `LoopbackCrdtBackend` (real
 * y-websocket doc-sync), the sparql adapter runs a REAL
 * `QueryBlockService.run()` over a REAL `LoopbackRestClient`/MCP round-trip,
 * and every face/registry/broker/interpreter class is the actual production
 * implementation (`@shrubbery/runtime` / `@shrubbery/runtime/layout`) —
 * nothing here is a test double. The browser talks to the cell exclusively
 * through the SAME same-origin `/cell` proxy (`scripts/vite-cell-proxy.ts`,
 * already wired into `vite.config.ts`) the full organism entry uses — the
 * port/bearer token never reach this module.
 *
 * This remains a SEPARATE, minimal face-catalog specimen. Production Garden
 * now uses the same recursive interpreter for its whole main pane, but wraps
 * the rich wire/comments/citation/image channels in code-owned pane-face
 * bindings; a descriptor is still durable intent, never a callback bag. This
 * workbench deliberately exercises the narrower public P2 faces directly.
 *
 * A thin, real (non-mock) divider/action chrome layer lives in this file —
 * pointer-drag resizing and move/swap/close buttons — because the P2 face
 * contract is deliberately content-only (design: chrome is shell-owned).
 * Every control here calls the REAL `applyOperation` reducer and the REAL
 * `LayoutInterpreter.reconcile`; nothing is simulated.
 */
import '@shrubbery/tokens/tokens.css'
import { applySkinTheme } from '@shrubbery/tokens'
// Side-effect import: registers <mn-doc-history-panel> (and every other
// `@shrubbery/components` custom element) — `doc.history`'s `mount()` cannot
// import the class itself (`packages/runtime` cannot depend on
// `@shrubbery/components`; see `doc-history-face.ts`'s own header), so this
// app-level harness (which already depends on both packages) is what
// triggers the real registration, exactly like `apps/organism/src/main.ts`'s
// production entry already does for its own modal-takeover mount.
import '@shrubbery/components'
import type { MnConfirmationDialog, MnInputDialog, MnInputDialogConfirmDetail } from '@shrubbery/components'
import {
  EditorRoomPool,
  makeQueryBlockService,
  createDocumentSnapshotService,
  createWorkspaceCatalogService,
  createAccessGrantService,
  type WorkspaceGatewayTransport,
} from '@shrubbery/runtime'
import {
  FaceRegistry,
  LayoutResourceBroker,
  LayoutInterpreter,
  createHojaDocumentFace,
  createHojaDocumentResourceAdapter,
  createSophiaHomeFace,
  createSophiaHomeResourceAdapter,
  createSparqlBindingsTableFace,
  createSparqlBindingsTableResourceAdapter,
  createDocHistoryFace,
  createDocHistoryResourceAdapter,
  createSettingsPageFace,
  createSettingsPageResourceAdapter,
  createPresenceInspectorFace,
  createPresenceInspectorResourceAdapter,
  createWorkspacePickerFace,
  createWorkspacePickerResourceAdapter,
  WORKSPACE_CATALOG_IRI,
  createAccessManagerFace,
  createAccessManagerResourceAdapter,
  installLayoutEdges,
  type LayoutIntentEvent,
  type LayoutIntentSource,
  createRawTextQueryResolver,
} from '@shrubbery/runtime/layout'
// F6 quarantine (repair round 3): `media.viewer` is deliberately NOT part of
// the ratified `@shrubbery/runtime/layout` public barrel above — see that
// barrel's own header. This explicitly-internal subpath is the ONE place in
// the whole codebase permitted to reach it; see media-face-internal.ts's own
// header for why.
import {
  createMediaFace,
  createMediaResourceAdapter,
  type ArtifactFetcher,
} from '@shrubbery/runtime/layout/faces/media-face-internal'
import {
  applyOperation,
  locateParent,
  deepFreeze,
  type Axis,
  type LayoutDocument,
  type LayoutEdge,
  type LayoutOperation,
  type Side,
  type ViewDescriptor,
} from '@shrubbery/nucleus/layout'
import { LoopbackCrdtBackend } from '../cell/loopback-crdt-backend.js'
import { LoopbackMcpClient } from '../cell/loopback-mcp.js'
import { LoopbackRestClient } from '../cell/gardend-contract.js'
// The REAL production settings service (Wave 1) — `settings.page`'s own
// header: `packages/runtime` cannot import `apps/organism` (apps depend on
// packages, never the reverse), so the CALLER constructs the real
// `DefaultOrganismSettingsService` and injects it via
// `createSettingsPageResourceAdapter`, exactly like this harness already
// does for `doc.history`'s `DocumentSnapshotService`.
import { createDefaultSettingsService } from '../cell/settings-service.js'

// ── shared fixture identity — mirrors scripts/layout-workbench-gardend-browser.mts ──
export const GRAPH_ID = 'layout-workbench-proof'
export const DOC_A = 'doc-a'
export const DOC_B = 'doc-b'
/**
 * A real, read-only, no-declarations triple dump across EVERY named graph
 * (`GRAPH ?g { ?s ?p ?o }`, the same variable-graph pattern
 * `fid004-cold-projection-browser.mts` uses to search across all of a cell's
 * named graphs) — always returns SOMETHING for a graph with real content, so
 * the proof does not depend on knowing gardend's exact document/artifact
 * ontology or which specific named graph holds it (design §9.1 "Proving leaf
 * B": "execute a read-only SELECT against a real spawned gardend cell"). A
 * bare `{ ?s ?p ?o }` with no GRAPH clause only matches the (empty) DEFAULT
 * graph — gardend-liveread.integration.test.ts's own real-SELECT proof
 * always scopes to an explicit named graph for exactly this reason.
 */
export const SPARQL_DUMP_QUERY = 'SELECT ?g ?s ?p ?o WHERE { GRAPH ?g { ?s ?p ?o } } LIMIT 10'

applySkinTheme({ skin: 'garden', theme: 'light' })

const root = document.querySelector<HTMLElement>('#layout-workbench-root')!
const overlay = document.querySelector<HTMLElement>('#layout-workbench-overlay')!
const actionsEl = document.querySelector<HTMLElement>('#layout-workbench-actions')!

// ── real backend + pool (no mocks) ──────────────────────────────────────────
const backend = new LoopbackCrdtBackend({ mcpUrl: '/cell/mcp' })
const pool = new EditorRoomPool(backend)

// ── real MCP + REST client for the sparql.bindings-table face (no mocks) ───
// SAME same-origin `/cell` proxy as the CRDT backend above — no bearer token
// reaches this module (the proxy injects it server-side, exactly like
// `LoopbackCrdtBackend`'s own `/cell/mcp` usage).
const mcp = new LoopbackMcpClient({ mcpUrl: '/cell/mcp', healthUrl: '/cell/health' })
const rest = new LoopbackRestClient(mcp)
const queryService = makeQueryBlockService(rest)

// ── real DocumentSnapshotService for `doc.history` (Wave 1) — the SAME
// same-origin `/cell` proxy every other real client in this file uses, over
// the SAME `/v1/documents/{graphId}/{documentId}/snapshots` routes
// `apps/organism/src/main.ts`'s production modal already calls. No bearer
// token reaches this module — the proxy injects it server-side.
const snapshotService = createDocumentSnapshotService({
  resolveBaseUrl: () => '/cell',
  headers: () => ({}),
})

// ── real OrganismSettingsService for `settings.page` (Wave 1) — the SAME
// real production class `apps/organism/src/cell/settings-service.ts` owns
// (no route in `apps/organism/src/main.ts` constructs one today — the
// catalogue's own "reached only by full-page navigation" finding extends to
// "with no real backing service wired at all" — so this harness's instance
// is the first REAL, non-mock wiring of it, real `localStorage`-backed
// preferences included). No `operations`/`localAi`/`providerSecrets`
// injected — the service's own visibility filter already handles their
// absence honestly (those sections simply do not appear), exactly as it
// does in `renderSettingsRoute` when `options.settingsService` is omitted.
const settingsService = createDefaultSettingsService({
  runtimeMode: 'hosted',
  apiBaseUrl: '/cell',
  mcpUrl: '/cell/mcp',
  storage: window.localStorage,
})

// ── real (synthetic-backend) gateway control-plane transport for
// `workspace.picker`/`access.manager` (Wave 1) — GET /graphs and
// GET/PUT/DELETE /graphs/{id}/access are GATEWAY control-plane routes
// (`gateway-transport.ts`'s own header: "control plane: GET {gatewayRoot}
// /graphs"), never a per-graph CELL route — this harness's spawned gardend
// cell (behind the `/cell` proxy every other client above uses) does not
// serve them at all. `gatewayFetch` below is a REAL, in-page HTTP handler —
// genuine `fetch()`/`Response`/status-code semantics, never a stubbed
// return value — mirroring `apps/organism/src/harness/access-main.ts`'s own
// `backendFetch` pattern (that harness's real-transport proof for the SAME
// `/graphs/{id}/access` routes, at the app level). `createWorkspaceCatalog
// Service`/`createAccessGrantService` (this file's own new imports) are the
// REAL, production-route-faithful transport `workspace-gateway-service.ts`
// hoists from `GatewayTransport` (untouched) — this harness supplies a real
// backing store, not the gateway itself, exactly like the cell-proxy above
// supplies a real gardend cell rather than a full platform-next deployment.
const workspaceGatewayGraphs = new Map<string, { graphId: string; title: string; cellState: 'running' | 'stopped'; role: 'viewer' | 'editor' | 'owner' }>([
  [GRAPH_ID, { graphId: GRAPH_ID, title: 'Layout Workbench Proof', cellState: 'running', role: 'owner' }],
  ['second-workspace', { graphId: 'second-workspace', title: 'Second Workspace', cellState: 'stopped', role: 'viewer' }],
])
const workspaceGatewayAccess = new Map<string, Map<string, { userId: string; role: 'viewer' | 'editor' | 'owner'; grantedAt: string; grantedBy: string; displayName?: string }>>([
  [GRAPH_ID, new Map([
    ['owner-1', { userId: 'owner-1', role: 'owner' as const, grantedAt: '2026-07-17T00:00:00Z', grantedBy: 'owner-1', displayName: 'Vera Owner' }],
  ])],
])
const CURRENT_HARNESS_USER_ID = 'owner-1'
const gatewayFetch: typeof fetch = (async (input, init = {}) => {
  const url = new URL(String(input), window.location.href)
  const method = init.method ?? 'GET'
  const json = (value: unknown, status = 200): Response =>
    new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
  if (url.pathname === '/workspace-gateway-harness/graphs' && method === 'GET') {
    return json([...workspaceGatewayGraphs.values()])
  }
  // wave1 review r1 WRONG fix: workspace.picker now wires REAL create/delete
  // (`workspace-gateway-service.ts`'s own new `WorkspaceCatalogService.
  // create`/`.remove`) — this synthetic harness backend grows the matching
  // routes, same in-page-Map-backed realism as the access sub-routes below.
  if (url.pathname === '/workspace-gateway-harness/graphs' && method === 'POST') {
    const body = JSON.parse(String(init.body ?? '{}')) as { title?: string; graphId?: string }
    const graphId = body.graphId?.trim() || `harness-graph-${workspaceGatewayGraphs.size + 1}`
    const title = body.title?.trim() || graphId
    workspaceGatewayGraphs.set(graphId, { graphId, title, cellState: 'running', role: 'owner' })
    return json({ graphId, title })
  }
  const graphMatch = url.pathname.match(/^\/workspace-gateway-harness\/graphs\/([^/]+)$/u)
  if (graphMatch && method === 'DELETE') {
    workspaceGatewayGraphs.delete(decodeURIComponent(graphMatch[1]!))
    return new Response(null, { status: 204 })
  }
  const accessMatch = url.pathname.match(/^\/workspace-gateway-harness\/graphs\/([^/]+)\/access(?:\/([^/]+))?$/u)
  if (accessMatch) {
    const graphId = decodeURIComponent(accessMatch[1]!)
    const userId = accessMatch[2] ? decodeURIComponent(accessMatch[2]) : null
    const grants = workspaceGatewayAccess.get(graphId) ?? new Map()
    workspaceGatewayAccess.set(graphId, grants)
    if (method === 'GET' && !userId) return json([...grants.values()])
    if (method === 'PUT' && userId) {
      const body = JSON.parse(String(init.body ?? '{}')) as { role: 'viewer' | 'editor'; email?: string; displayName?: string }
      grants.set(userId, { userId, role: body.role, grantedAt: new Date().toISOString(), grantedBy: CURRENT_HARNESS_USER_ID, ...(body.displayName ? { displayName: body.displayName } : {}) })
      return new Response(null, { status: 204 })
    }
    if (method === 'DELETE' && userId) {
      grants.delete(userId)
      return new Response(null, { status: 204 })
    }
  }
  return json({ error: `unhandled workspace-gateway-harness route: ${method} ${url.pathname}` }, 404)
}) as typeof fetch
const workspaceGatewayTransport: WorkspaceGatewayTransport = {
  resolveGatewayBaseUrl: () => `${window.location.origin}/workspace-gateway-harness`,
  headers: () => ({}),
}
const workspaceCatalogService = createWorkspaceCatalogService(workspaceGatewayTransport, gatewayFetch)
const accessGrantService = createAccessGrantService(workspaceGatewayTransport, gatewayFetch)

// ── real confirm/prompt dialogs (wave1 review r1 WRONG fix) ─────────────────
// `doc.history`/`access.manager`/`workspace.picker` now REQUIRE a real
// confirm (and, for workspace create, a real title prompt) dependency — see
// each face's own header for why an optional/unwired one was a genuine
// safety regression, not an honest scope trade-off. These are the SAME
// REAL custom elements (`<mn-confirmation-dialog>`, `<mn-input-dialog>`)
// `apps/organism/src/main.ts`'s own `confirmAction`/`promptForText` drive —
// registered via this file's own `import '@shrubbery/components'` above —
// just a separate instance per app entry point (this harness is a distinct
// HTML page from the production shell, so it cannot share main.ts's
// module-private singleton; the dialog CLASS and its real show/hide/mn-
// confirm/mn-cancel behavior are identical either way).
const confirmationDialogEl = document.createElement('mn-confirmation-dialog') as MnConfirmationDialog
const inputDialogEl = document.createElement('mn-input-dialog') as MnInputDialog
document.body.appendChild(confirmationDialogEl)
document.body.appendChild(inputDialogEl)

interface HarnessConfirmOptions {
  readonly title: string
  readonly message: string
  readonly confirmLabel: string
  readonly cancelLabel: string
  readonly variant?: 'default' | 'danger' | 'warning'
}

/** Real confirm dialog round trip — mirrors `apps/organism/src/main.ts`'s own `confirmAction`. */
function harnessConfirm(options: HarnessConfirmOptions): Promise<boolean> {
  confirmationDialogEl.title = options.title
  confirmationDialogEl.message = options.message
  confirmationDialogEl.confirmText = options.confirmLabel
  confirmationDialogEl.secondaryConfirmText = ''
  confirmationDialogEl.cancelText = options.cancelLabel
  confirmationDialogEl.variant = options.variant ?? 'default'
  confirmationDialogEl.loading = false
  return new Promise((resolve) => {
    function cleanup(): void {
      confirmationDialogEl.removeEventListener('mn-confirm', onConfirm)
      confirmationDialogEl.removeEventListener('mn-cancel', onCancel)
    }
    function onConfirm(): void {
      cleanup()
      confirmationDialogEl.hide()
      resolve(true)
    }
    function onCancel(): void {
      cleanup()
      confirmationDialogEl.hide()
      resolve(false)
    }
    confirmationDialogEl.addEventListener('mn-confirm', onConfirm)
    confirmationDialogEl.addEventListener('mn-cancel', onCancel)
    confirmationDialogEl.show()
  })
}

/** Real prompt dialog round trip — mirrors `apps/organism/src/main.ts`'s own `promptForText`. Returns the trimmed value, or `null` when cancelled. */
function harnessPromptForText(title: string, placeholder: string): Promise<string | null> {
  inputDialogEl.title = title
  inputDialogEl.message = ''
  inputDialogEl.value = ''
  inputDialogEl.placeholder = placeholder
  inputDialogEl.confirmText = 'Create'
  inputDialogEl.cancelText = 'Cancel'
  inputDialogEl.loading = false
  return new Promise((resolve) => {
    function cleanup(): void {
      inputDialogEl.removeEventListener('mn-confirm', onConfirm)
      inputDialogEl.removeEventListener('mn-cancel', onCancel)
    }
    function onConfirm(event: Event): void {
      cleanup()
      inputDialogEl.hide()
      resolve((event as CustomEvent<MnInputDialogConfirmDetail>).detail.value.trim())
    }
    function onCancel(): void {
      cleanup()
      inputDialogEl.hide()
      resolve(null)
    }
    inputDialogEl.addEventListener('mn-confirm', onConfirm)
    inputDialogEl.addEventListener('mn-cancel', onCancel)
    inputDialogEl.show()
  })
}

// ── real registry + broker + interpreter ────────────────────────────────────
// The ratified v1 P2 catalog (design §9.2 Phase 2) is exactly these three —
// see this file's own header.
const registry = new FaceRegistry()
registry.register(createHojaDocumentFace())
registry.register(createSophiaHomeFace())
registry.register(createSparqlBindingsTableFace())
// `doc.history` (Wave 1, north star §2.2/§3) — real from here down; see
// `doc-history-face.ts`'s own header for the live-vs-derived verdict.
// `confirmDialog` is the REAL `<mn-confirmation-dialog>` round trip above —
// REQUIRED (wave1 review r1 WRONG fix): delete/restore both gate on it now.
registry.register(createDocHistoryFace((options) => harnessConfirm({
  title: options.title,
  message: options.message,
  confirmLabel: options.confirmLabel,
  cancelLabel: options.cancelLabel,
  variant: options.variant,
})))
// `settings.page` (Wave 1, north star §2.2/§3) — see settings-page-face.ts's
// own header for the "wraps mn-settings-page unchanged" verdict.
registry.register(createSettingsPageFace())
// `presence.inspector` (Wave 1, north star §2.2/§3) — see presence-
// inspector-face.ts's own header for the live-verdict + resource-sharing
// rationale.
registry.register(createPresenceInspectorFace())
// `workspace.picker` (Wave 1, north star §2.2/§3) — see workspace-picker-
// face.ts's own header for the derived/stamp verdict + the "top-bar dropdown
// remains chrome" scope boundary. `onSelectWorkspace` here is a REAL,
// harness-visible callback (bridge state below), not fabricated navigation
// (this wave's own "do not fork navigation" rule — production-shell
// integration is Wave 3). `promptCreateTitle`/`confirmDelete` are the SAME
// real dialogs above — REQUIRED (wave1 review r1 WRONG fix): create/delete
// are genuinely wired now, not hard-disabled.
registry.register(createWorkspacePickerFace(
  (workspace) => {
    lastSelectedWorkspace = workspace.graphId
    document.body.dataset.layoutWorkbenchLastSelectedWorkspace = workspace.graphId
  },
  {
    promptCreateTitle: () => harnessPromptForText('New Workspace', 'Workspace name'),
    confirmDelete: (options) => harnessConfirm({ ...options, variant: 'danger' }),
  },
))
// `access.manager` (Wave 1, north star §2.2/§3) — see access-manager-
// face.ts's own header for the derived/stamp verdict + the leaf-scoped
// orchestration mirror of `OrganismAccessGrantController`. `confirmRemove`
// is the SAME real dialog — REQUIRED (wave1 review r1 WRONG fix): it used to
// be omitted here entirely, which meant a real removal round trip through
// this harness had ZERO confirmation.
registry.register(createAccessManagerFace(
  () => CURRENT_HARNESS_USER_ID,
  (options) => harnessConfirm({ ...options, variant: 'danger' }),
))

// F6 quarantine (repair round 3, faces-mvp review): `media.viewer` is the
// Wave-2 STATIC-resource-shape template named by
// plans/shrubbery-surface-north-star-20260716.md §2.1 ("STATIC (3): artifact
// view, artifact editor (sub-mode), original-file view. ← the MVP's media
// face is the template.") — real and tested, but deliberately NOT part of
// the ratified catalog above, and no longer exported from the public
// `@shrubbery/runtime/layout` barrel either (a casual consumer of that
// package must not reach it — see `faces/index.ts`'s header). This harness
// is its ONE registered consumer in the entire codebase, reached only
// through the explicitly-internal `.../layout/faces/media-face-internal`
// subpath imported above. Promoting it to the production catalog requires
// either an explicit authority revision from Vera, or extracting/sharing the
// production `mn-original-viewer` artifact viewer in its place (see
// media-face.ts's own header for the cross-package restructuring that would
// take — pending, not attempted here).
//
// The fetcher below is REAL (a genuine same-origin `fetch()` through the
// SAME `/cell` proxy every other real client in this file uses, against the
// production artifact-download route shape — see
// `apps/organism/src/cell/original-file-controller.ts`'s own
// `artifactOriginalUrl`), not a stand-in — even though no leaf in this
// harness currently mints a `media.viewer` descriptor, so it is never
// actually invoked by anything below.
const mediaArtifactFetcher: ArtifactFetcher = {
  async fetchArtifact(ref) {
    const url = `/cell/artifacts/${encodeURIComponent(ref.graphId)}/${encodeURIComponent(ref.artifactId)}/download?inline=true`
    const response = await fetch(url, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`media.viewer harness fetcher: HTTP ${response.status} for ${url}`)
    const blob = await response.blob()
    const mimeType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() || 'application/octet-stream'
    return { blob, filename: ref.artifactId, mimeType }
  },
}
registry.register(createMediaFace())

// LAY-004 / diff-review SUSPECT ("consider sealing the registry after
// bootstrap"): every v1 face PLUS the quarantined media.viewer is registered
// above; no code path past this line may grow the catalog.
registry.seal()

const broker = new LayoutResourceBroker()
const queryResolver = createRawTextQueryResolver()
broker.registerAdapter(createHojaDocumentResourceAdapter(pool))
broker.registerAdapter(createSophiaHomeResourceAdapter())
broker.registerAdapter(createSparqlBindingsTableResourceAdapter(queryService, queryResolver))
broker.registerAdapter(createMediaResourceAdapter(mediaArtifactFetcher))
// Shares the SAME `pool` as `hoja.document` above — two leaves over the same
// document resolve to one real EditorRoomPool room regardless of which of
// the two adapters acquired it first (doc-history-face.ts's own header).
broker.registerAdapter(createDocHistoryResourceAdapter(pool, snapshotService))
broker.registerAdapter(createSettingsPageResourceAdapter(settingsService))
// Shares the SAME `pool` a third way (presence-inspector-face.ts's own header).
broker.registerAdapter(createPresenceInspectorResourceAdapter(pool))
broker.registerAdapter(createWorkspacePickerResourceAdapter(workspaceCatalogService))
broker.registerAdapter(createAccessManagerResourceAdapter(accessGrantService))

const interpreter = new LayoutInterpreter(root, { registry, broker })

// ── descriptor builders ─────────────────────────────────────────────────────
function documentDescriptor(documentId: string): ViewDescriptor {
  return { schemaVersion: 1, faceId: 'hoja.document', resource: { kind: 'document', graphId: GRAPH_ID, documentId } }
}
function sparqlDescriptor(sparql: string): ViewDescriptor {
  // v1: `queryId` IS the raw SPARQL text — see sparql-bindings-table-face.ts's header.
  return { schemaVersion: 1, faceId: 'sparql.bindings-table', resource: { kind: 'query', graphId: GRAPH_ID, queryId: sparql } }
}
function docHistoryDescriptor(documentId: string): ViewDescriptor {
  return { schemaVersion: 1, faceId: 'doc.history', resource: { kind: 'document', graphId: GRAPH_ID, documentId } }
}
function workspacePickerDescriptor(): ViewDescriptor {
  return { schemaVersion: 1, faceId: 'workspace.picker', resource: { kind: 'iri', iri: WORKSPACE_CATALOG_IRI }, params: { activeGraphId: GRAPH_ID } }
}
function accessManagerDescriptor(): ViewDescriptor {
  return { schemaVersion: 1, faceId: 'access.manager', resource: { kind: 'graph', graphId: GRAPH_ID }, params: { graphTitle: 'Layout Workbench Proof' } }
}
function settingsPageDescriptor(section?: string): ViewDescriptor {
  return {
    schemaVersion: 1,
    faceId: 'settings.page',
    resource: { kind: 'iri', iri: 'urn:sophia:settings' },
    ...(section ? { params: { section } } : {}),
  }
}
function presenceInspectorDescriptor(documentId: string, personId: string): ViewDescriptor {
  return {
    schemaVersion: 1,
    faceId: 'presence.inspector',
    resource: { kind: 'document', graphId: GRAPH_ID, documentId },
    params: { personId },
  }
}

/**
 * Reads the current LOCAL client's real awareness id off the SAME cached
 * pool room `D1`'s `hoja.document` leaf already holds open — a synchronous
 * probe attachment/release, never a second connection. Presence membership
 * is real Yjs-generated identity, not something this harness can hardcode
 * (unlike `DOC_A`/`DOC_B`); this is how the "split presence.inspector"
 * action below discovers a real `personId` to name.
 */
function currentSelfPresenceId(documentId: string): string | null {
  const probe = pool.acquire({ kind: 'doc', graphId: GRAPH_ID, docId: documentId }, `presence-probe-${Date.now()}`)
  const clientId = (probe.provider.awareness as { clientID?: number }).clientID
  probe.release()
  return clientId == null ? null : String(clientId)
}

// ── the live document (Phase-1 LayoutDocument) — starts as ONE leaf ────────
let doc: LayoutDocument = deepFreeze({
  schemaVersion: 1,
  layoutId: 'layout-workbench',
  scope: 'session',
  graphId: GRAPH_ID,
  rootNodeId: 'D1',
  nodes: {
    D1: { kind: 'leaf', id: 'D1', descriptor: documentDescriptor(DOC_A), descriptorRevision: 0 },
  },
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
})

// Mutable (not `const`) — `resizeContainer` (exposed on the bridge below)
// lets the real-browser proof exercise design §6.2's min-constraint
// infeasibility path (diff-review r2 MISSING: "minimum constraints ... not
// exercised") by actually shrinking the container below a face's declared
// minimum, then growing it back.
let containerSize = { width: 1400, height: 900 }
root.style.width = `${containerSize.width}px`
root.style.height = `${containerSize.height}px`

// A pointer-drag fires many `set_ratio` + reconcile calls in rapid
// succession (one per `pointermove`). `LayoutInterpreter.reconcile` is async
// (mounting/disposing a real face involves real awaits); two overlapping
// calls racing over the SAME internal wrapper/mounted-view maps against two
// DIFFERENT `doc` snapshots is exactly the kind of concurrency bug that can
// corrupt interpreter state (a later call's `pruneStale` observing an
// earlier call's still-in-flight mount). Queue every reconcile strictly
// sequentially — never two in flight at once — rather than trusting the
// interpreter to arbitrate overlapping callers itself.
let reconcileQueue: Promise<{ ok: boolean; diagnostics: readonly unknown[] }> = Promise.resolve({ ok: true, diagnostics: [] })
// The real, harness-visible sink `workspace.picker`'s injected `onSelectWorkspace`
// callback writes to (this file's own registry.register(createWorkspacePickerFace(...)) above).
let lastSelectedWorkspace = ''

function reconcileAndRender(): Promise<{ ok: boolean; diagnostics: readonly unknown[] }> {
  reconcileQueue = reconcileQueue.then(async () => {
    const result = await interpreter.reconcile(doc, containerSize)
    renderDividers()
    return result
  })
  return reconcileQueue
}

function applyOp(op: LayoutOperation): { ok: boolean; diagnostic?: unknown } {
  const result = applyOperation(doc, op, { isFaceRegistered: registry.toFaceRegistrationPredicate() })
  if (result.ok) {
    doc = result.doc
    return { ok: true }
  }
  return { ok: false, diagnostic: result.diagnostic }
}

// ── DATA-DECLARED layout-mutating edges (Slice D) ───────────────────────────
// The nucleus `LayoutEdge` model, driven by the runtime `installLayoutEdges`
// interpreter, slotted into THIS harness's live applyOp -> reconcile cycle. An
// edge binds one source intent (`from`) to one closed-vocabulary layout-op
// predicate; the LIVE, ephemeral `leafId` the op touches rides on the intent
// EVENT at fire time (the edge cannot store an ephemeral id — see
// layout-edge.ts). EPHEMERAL / SESSION-ONLY: like every other doc mutation in
// this file, nothing here persists; there is no writer for edges.
//
// A real (non-mock) in-harness intent emitter: `onIntent` subscribes (returning
// an unsubscribe, the interpreter's plug-point shape), `fire` dispatches. No spy
// framework — a plain listener Set with a recording-free fan-out.
interface HarnessLayoutIntentSource extends LayoutIntentSource {
  fire(event: LayoutIntentEvent): void
}
function createHarnessLayoutIntentSource(): HarnessLayoutIntentSource {
  const listeners = new Set<(event: LayoutIntentEvent) => void>()
  return {
    onIntent(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    fire(event) {
      for (const listener of [...listeners]) listener(event)
    },
  }
}
const layoutIntentSource = createHarnessLayoutIntentSource()

// The tiny edge set — at minimum one `closesLeaf` and one `opensInSplit`,
// authored by STABLE `from` name (+ axis/side for the split); the live target
// leaf is supplied per fire. `opensInSplit` opens a fresh sophia.home leaf.
const layoutEdges: readonly LayoutEdge[] = [
  { from: 'workbench:closeLeaf', predicate: 'closesLeaf' },
  { from: 'workbench:openInSplit', predicate: 'opensInSplit', axis: 'vertical', side: 'end' },
]

// Install over the LIVE cycle: `getDoc` returns the session doc; `commit`
// receives the reducer's already-VALIDATED, frozen doc and adopts it exactly
// the way `applyOp` -> `reconcileAndRender` already does — swap the session doc
// and re-render through the EXISTING serialized `reconcileQueue` (never
// bypassed, so an edge-driven mutation races nothing with pointer-drag
// reconciles). `validate` uses the SAME real registry predicate `applyOp` does.
const disposeLayoutEdges = installLayoutEdges(
  layoutEdges,
  layoutIntentSource,
  () => doc,
  (newDoc) => {
    doc = newDoc
    void reconcileAndRender()
  },
  { validate: { isFaceRegistered: registry.toFaceRegistrationPredicate() } },
)

// ── real pointer-drag divider chrome (shell-owned; the interpreter itself
// never renders chrome — design §3.3) ───────────────────────────────────────
interface PlanWalk {
  readonly id: string
  readonly kind: 'split' | 'leaf'
}

function collectSplitIds(node: unknown, into: string[]): void {
  const n = node as { kind: string; id: string; start?: unknown; end?: unknown }
  if (n.kind === 'tabs') {
    collectSplitIds((n as { active?: unknown }).active, into)
    return
  }
  if (n.kind !== 'split') return
  into.push(n.id)
  collectSplitIds(n.start, into)
  collectSplitIds(n.end, into)
}

function renderDividers(): void {
  overlay.replaceChildren()
  const plan = interpreter.currentPlan()
  if (!plan) return
  const splitIds: string[] = []
  collectSplitIds(plan.root, splitIds)
  for (const splitId of splitIds) {
    const wrapper = interpreter.splitWrapperElement(splitId)
    const docNode = doc.nodes[splitId]
    if (!wrapper || !docNode || docNode.kind !== 'split') continue
    const left = Number.parseFloat(wrapper.style.left)
    const top = Number.parseFloat(wrapper.style.top)
    const width = Number.parseFloat(wrapper.style.width)
    const height = Number.parseFloat(wrapper.style.height)
    const ratio = docNode.startBasisPoints / 10000

    const handle = document.createElement('div')
    handle.dataset.dividerHandle = splitId
    handle.style.position = 'absolute'
    handle.style.zIndex = '50'
    handle.style.background = 'color-mix(in srgb, #4d8768 55%, transparent)'
    // Accessible keyboard separator controls (design §9.2 Phase 3 gate:
    // "keyboard separator controls ... browser-proven"; diff-review r2
    // MISSING) — a real ARIA `separator` with `tabindex`, live
    // `aria-valuenow`, and arrow-key resize, not pointer-only chrome.
    handle.tabIndex = 0
    handle.setAttribute('role', 'separator')
    handle.setAttribute('aria-orientation', docNode.axis === 'horizontal' ? 'vertical' : 'horizontal')
    handle.setAttribute('aria-valuemin', '1')
    handle.setAttribute('aria-valuemax', '99')
    handle.setAttribute('aria-valuenow', String(Math.round(ratio * 100)))
    handle.setAttribute('aria-label', `Resize ${splitId}`)
    if (docNode.axis === 'horizontal') {
      handle.style.top = `${top}px`
      handle.style.height = `${height}px`
      handle.style.left = `${left + width * ratio - 4}px`
      handle.style.width = '8px'
      handle.style.cursor = 'col-resize'
    } else {
      handle.style.left = `${left}px`
      handle.style.width = `${width}px`
      handle.style.top = `${top + height * ratio - 4}px`
      handle.style.height = '8px'
      handle.style.cursor = 'row-resize'
    }
    handle.addEventListener('pointerdown', (event) => startDividerDrag(event, splitId, docNode.axis, { left, top, width, height }))
    handle.addEventListener('keydown', (event) => onDividerKeyDown(event, splitId, docNode.startBasisPoints))
    overlay.appendChild(handle)
  }
}

/** Arrow-key resize (1% per press, 5% with Shift) + Home/End to the legal extremes — mirrors center-panes-host.ts's own onDividerKeyDown for the generic N-leaf split-tree dividers. */
function onDividerKeyDown(event: KeyboardEvent, splitId: string, currentBasisPoints: number): void {
  const step = event.shiftKey ? 500 : 100
  let next: number | null = null
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = currentBasisPoints - step
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = currentBasisPoints + step
  if (event.key === 'Home') next = 100
  if (event.key === 'End') next = 9900
  if (next == null) return
  event.preventDefault()
  const clamped = Math.min(9900, Math.max(100, next))
  const outcome = applyOp({ op: 'set_ratio', splitId, startBasisPoints: clamped })
  if (outcome.ok) void reconcileAndRender()
}

function startDividerDrag(
  event: PointerEvent,
  splitId: string,
  axis: Axis,
  rect: { left: number; top: number; width: number; height: number },
): void {
  event.preventDefault()
  const move = (moveEvent: PointerEvent): void => {
    const pos = axis === 'horizontal' ? moveEvent.clientX - rect.left : moveEvent.clientY - rect.top
    const size = axis === 'horizontal' ? rect.width : rect.height
    const startBasisPoints = Math.round((pos / size) * 10000)
    const outcome = applyOp({ op: 'set_ratio', splitId, startBasisPoints })
    if (outcome.ok) void reconcileAndRender()
  }
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// ── real action buttons (split/move/swap/close) — real clicks drive real ops ──
function addAction(id: string, label: string, run: () => void): void {
  const button = document.createElement('button')
  button.dataset.action = id
  button.textContent = label
  button.type = 'button'
  button.addEventListener('click', run)
  actionsEl.appendChild(button)
}

// Splits in a REAL sparql.bindings-table leaf (Q1) — the ratified P2
// catalog's own "genuinely different, provider-free pane" proof (design
// §9.1 "Proving leaf B": "remain usable with no TipTap, Y.Doc, or editor
// toolbar present"). This is what `media.viewer`'s M1 used to prove; since
// that face is no longer part of the ratified catalog registered above
// (diff-review r2 WRONG), Q1 takes over its structural role in this
// topology — a STRONGER proof of the same property, since sparql.bindings-
// table's DERIVED resource shape (never cached/shared) is a genuinely
// different lifetime contract than hoja.document's DURABLE shape, not just
// a different DOM element.
addAction('split-sparql', 'Split in real SPARQL bindings table', () => {
  const parent = locateParent(doc, 'D1')
  if (!parent) return
  const outcome = applyOp({
    op: 'split_leaf',
    leafId: 'D1',
    axis: 'horizontal',
    side: 'end',
    newLeafId: 'Q1',
    splitId: 'S-root',
    descriptor: sparqlDescriptor(SPARQL_DUMP_QUERY),
    expectedParent: parent,
  })
  if (outcome.ok) void reconcileAndRender()
})

// Splits in a REAL doc.history leaf over the SAME document as D1 (Wave 1,
// north star §2.2/§3: "doc-history beside the live document it diffs" — the
// cataloguer's own named first case). Proves the two-tier resource design's
// "two leaves on the SAME document share one exact provider" property across
// TWO DIFFERENT adapters (hoja.document + doc.history), not just two leaves
// of the same face.
addAction('split-doc-history', 'Split D1 -> real doc.history over the SAME document', () => {
  const parent = locateParent(doc, 'D1')
  if (!parent) return
  const outcome = applyOp({
    op: 'split_leaf',
    leafId: 'D1',
    axis: 'horizontal',
    side: 'end',
    newLeafId: 'H1',
    splitId: 'S-history',
    descriptor: docHistoryDescriptor(DOC_A),
    expectedParent: parent,
  })
  if (outcome.ok) void reconcileAndRender()
})

// Splits in a REAL workspace.picker leaf beside D1 (Wave 1, north star
// §2.2/§3: "the workspaces themselves are faceable; the top-bar dropdown
// remains chrome"). The real <mn-workspace-selector> mounts in `embedded`
// mode, driven off a real fetched catalog (this harness's own synthetic-
// but-real gateway backend above).
addAction('split-workspace-picker', 'Split D1 -> real workspace.picker', () => {
  const parent = locateParent(doc, 'D1')
  if (!parent) return
  const outcome = applyOp({
    op: 'split_leaf',
    leafId: 'D1',
    axis: 'vertical',
    side: 'end',
    newLeafId: 'WP1',
    splitId: 'S-workspace-picker',
    descriptor: workspacePickerDescriptor(),
    expectedParent: parent,
  })
  if (outcome.ok) void reconcileAndRender()
})

// Splits in a REAL access.manager leaf beside D1 (Wave 1, north star §2.2/§3:
// "the second clean 'data-driven ≠ face' illustration"). The real
// <mn-access-manager> mounts in `embedded` mode, driven off a real fetched
// grant list for GRAPH_ID.
addAction('split-access-manager', 'Split D1 -> real access.manager', () => {
  const parent = locateParent(doc, 'D1')
  if (!parent) return
  const outcome = applyOp({
    op: 'split_leaf',
    leafId: 'D1',
    axis: 'vertical',
    side: 'end',
    newLeafId: 'AM1',
    splitId: 'S-access-manager',
    descriptor: accessManagerDescriptor(),
    expectedParent: parent,
  })
  if (outcome.ok) void reconcileAndRender()
})

// Splits in a REAL settings.page leaf (Wave 1, north star §2.2/§3) — the
// REAL <mn-settings-page> workbench, driven by the harness's own REAL
// `DefaultOrganismSettingsService` above. No shared resource with D1; it is
// the workspace-singleton `urn:sophia:settings` resource (settings-page-
// face.ts's own header).
addAction('split-settings', 'Split D1 -> real settings.page', () => {
  const parent = locateParent(doc, 'D1')
  if (!parent) return
  const outcome = applyOp({
    op: 'split_leaf',
    leafId: 'D1',
    axis: 'vertical',
    side: 'end',
    newLeafId: 'SET1',
    splitId: 'S-settings',
    descriptor: settingsPageDescriptor(),
    expectedParent: parent,
  })
  if (outcome.ok) void reconcileAndRender()
})

// Splits in a REAL presence.inspector leaf over the SAME document as D1
// (Wave 1, north star §2.2/§3) — proves the resource design's "N leaves on
// the SAME document share one exact provider" property a third way
// (hoja.document + doc.history + presence.inspector). `personId` is
// discovered from the REAL local awareness client id already live on D1's
// shared room, not hardcoded.
addAction('split-presence', 'Split D1 -> real presence.inspector (self)', () => {
  const parent = locateParent(doc, 'D1')
  if (!parent) return
  const personId = currentSelfPresenceId(DOC_A)
  if (!personId) return
  const outcome = applyOp({
    op: 'split_leaf',
    leafId: 'D1',
    axis: 'horizontal',
    side: 'end',
    newLeafId: 'P1',
    splitId: 'S-presence',
    descriptor: presenceInspectorDescriptor(DOC_A, personId),
    expectedParent: parent,
  })
  if (outcome.ok) void reconcileAndRender()
})

addAction('split-doc-a2', 'Split sparql -> second doc-a leaf', () => {
  const parent = locateParent(doc, 'Q1')
  if (!parent) return
  const outcome = applyOp({
    op: 'split_leaf',
    leafId: 'Q1',
    axis: 'vertical',
    side: 'end',
    newLeafId: 'D2',
    splitId: 'S-q1',
    descriptor: documentDescriptor(DOC_A),
    expectedParent: parent,
  })
  if (outcome.ok) void reconcileAndRender()
})

// A SECOND, independent sparql.bindings-table leaf over the SAME query text
// as Q1 — the derived-shape sibling of hoja.document's "two leaves share one
// exact provider" proof (design §9.1's own "Proving leaf B": "no durable
// identity, no cross-leaf sharing"). Opened beside D2, verified, then closed
// again so the leaf count returns to 4 for the assertions that follow.
addAction('split-sparql-second', 'Split D2 -> second independent SPARQL leaf', () => {
  const parent = locateParent(doc, 'D2')
  if (!parent) return
  const outcome = applyOp({
    op: 'split_leaf',
    leafId: 'D2',
    axis: 'horizontal',
    side: 'end',
    newLeafId: 'Q2',
    splitId: 'S-q2',
    descriptor: sparqlDescriptor(SPARQL_DUMP_QUERY),
    expectedParent: parent,
  })
  if (outcome.ok) void reconcileAndRender()
})

addAction('split-doc-b', 'Split D1 -> nested doc-b leaf (4th leaf)', () => {
  const parent = locateParent(doc, 'D1')
  if (!parent) return
  const outcome = applyOp({
    op: 'split_leaf',
    leafId: 'D1',
    axis: 'vertical',
    side: 'end',
    newLeafId: 'D3',
    splitId: 'S-d1',
    descriptor: documentDescriptor(DOC_B),
    expectedParent: parent,
  })
  if (outcome.ok) void reconcileAndRender()
})

addAction('move-sparql', 'Move sparql leaf beside doc-b', () => {
  const expectedParent = locateParent(doc, 'Q1')
  const expectedTargetParent = locateParent(doc, 'D3')
  if (!expectedParent || !expectedTargetParent) return
  const outcome = applyOp({
    op: 'move_node',
    nodeId: 'Q1',
    targetLeafId: 'D3',
    side: 'end',
    axis: 'horizontal',
    splitId: 'S-move-1',
    expectedParent,
    expectedTargetParent,
  })
  if (outcome.ok) void reconcileAndRender()
})

addAction('swap-d2-d3', 'Swap D2 and D3', () => {
  const outcome = applyOp({ op: 'swap_nodes', firstNodeId: 'D2', secondNodeId: 'D3' })
  if (outcome.ok) void reconcileAndRender()
})

// A DOCUMENT leaf (real EditorView, not the provider-free sparql leaf)
// moved across parents into a brand-new split — the identity proof the
// sparql-only 'move-sparql' action above cannot stand in for (diff-review
// WRONG: "Assert the exact liveEditor/ProseMirror reference for a document
// leaf moved across parents").
addAction('move-d3-beside-d2', 'Move D3 (document leaf) beside D2', () => {
  const expectedParent = locateParent(doc, 'D3')
  const expectedTargetParent = locateParent(doc, 'D2')
  if (!expectedParent || !expectedTargetParent) return
  const outcome = applyOp({
    op: 'move_node',
    nodeId: 'D3',
    targetLeafId: 'D2',
    side: 'end',
    axis: 'horizontal',
    splitId: 'S-move-2',
    expectedParent,
    expectedTargetParent,
  })
  if (outcome.ok) void reconcileAndRender()
})

function closeLeafAction(id: string, leafId: string, label: string): void {
  addAction(id, label, () => {
    const parent = locateParent(doc, leafId)
    if (!parent) return
    const outcome = applyOp({ op: 'close_leaf', leafId, expectedParent: parent })
    if (outcome.ok) void reconcileAndRender()
  })
}
closeLeafAction('close-q2', 'Q2', 'Close Q2 (second independent SPARQL leaf)')
closeLeafAction('close-d2', 'D2', 'Close D2 (doc-a, not last ref)')
closeLeafAction('close-d1', 'D1', 'Close D1 (doc-a, last ref)')

// ── the introspection bridge the Playwright proof drives ───────────────────
declare global {
  interface Window {
    __layoutWorkbench?: {
      readonly ready: boolean
      readonly interpreter: LayoutInterpreter
      readonly broker: LayoutResourceBroker
      readonly pool: EditorRoomPool
      readonly registry: FaceRegistry
      getDoc(): LayoutDocument
      locateParent(id: string): ReturnType<typeof locateParent>
      applyOp(op: LayoutOperation): { ok: boolean; diagnostic?: unknown }
      reconcile(): Promise<{ ok: boolean; diagnostics: readonly unknown[] }>
      splitLeaf(args: {
        leafId: string
        axis: Axis
        side: Side
        newLeafId: string
        splitId: string
        descriptor: ViewDescriptor
      }): { ok: boolean; diagnostic?: unknown }
      /**
       * Close ANY leaf by id, including the document root — `locateParent`
       * returns `{kind:'root'}` (not `null`) for the root, so this covers
       * LAY-010's "closing the last leaf replaces it with sophia.home" case
       * too, not just interior leaves. Exposed generically (rather than one
       * hand-wired button per specific leaf id) so the proof can drive an
       * arbitrary topology down to its last leaf regardless of how many
       * split/move/swap actions preceded it.
       */
      closeLeaf(leafId: string): { ok: boolean; diagnostic?: unknown }
      /**
       * Real container resize — design §6.2's min-constraint infeasibility
       * path (diff-review r2 MISSING: "minimum constraints ... not
       * exercised") is otherwise unreachable in this harness, since
       * `containerSize` only ever fed one fixed value to `reconcile()`.
       * Resizes BOTH the actual `#layout-workbench-root` CSS box and the
       * size passed to the next `reconcile()` — the real geometry a real
       * ResizeObserver-driven caller would see.
       */
      resizeContainer(width: number, height: number): Promise<{ ok: boolean; diagnostics: readonly unknown[] }>
      /**
       * Fire a DATA-DECLARED layout edge (Slice D). The event names WHICH
       * source intent fired (`from`, matched against the installed edges'
       * `from`) and the LIVE, ephemeral `leafId` the synthesized op touches.
       * A `closesLeaf`/`opensInSplit` fire routes through the REAL
       * `installLayoutEdges` interpreter -> `applyOperation` reducer -> the
       * same `commit` seam every other mutation uses; an unmatched `from` or a
       * forged predicate is inert. The reconcile it kicks is serialized on the
       * SAME `reconcileQueue`, so await `reconcile()` after firing to observe it.
       */
      fireLayoutEdge(event: LayoutIntentEvent): void
    }
  }
}

async function boot(): Promise<void> {
  const result = await reconcileAndRender()
  window.__layoutWorkbench = {
    ready: result.ok,
    interpreter,
    broker,
    pool,
    registry,
    getDoc: () => doc,
    locateParent: (id) => locateParent(doc, id),
    applyOp,
    reconcile: reconcileAndRender,
    splitLeaf: (args) => {
      const parent = locateParent(doc, args.leafId)
      if (!parent) return { ok: false, diagnostic: 'no-parent' }
      return applyOp({
        op: 'split_leaf',
        leafId: args.leafId,
        axis: args.axis,
        side: args.side,
        newLeafId: args.newLeafId,
        splitId: args.splitId,
        descriptor: args.descriptor,
        expectedParent: parent,
      })
    },
    closeLeaf: (leafId) => {
      const parent = locateParent(doc, leafId)
      if (!parent) return { ok: false, diagnostic: 'no-such-leaf' }
      return applyOp({ op: 'close_leaf', leafId, expectedParent: parent })
    },
    resizeContainer: (width, height) => {
      containerSize = { width, height }
      root.style.width = `${width}px`
      root.style.height = `${height}px`
      return reconcileAndRender()
    },
    fireLayoutEdge: (event) => layoutIntentSource.fire(event),
  }
  document.body.dataset.layoutWorkbenchReady = String(result.ok)
}

window.addEventListener('beforeunload', () => {
  disposeLayoutEdges()
  pool.destroyAll()
})

void boot().catch((error: unknown) => {
  document.body.dataset.layoutWorkbenchError = error instanceof Error ? error.stack ?? error.message : String(error)
})
