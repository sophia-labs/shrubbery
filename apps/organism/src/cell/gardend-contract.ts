/**
 * gardend-contract.ts — SHELL-SIDE concrete ShrubberyContract backed by a REAL
 * local gardend cell over its loopback HTTP/MCP server.
 *
 * This is the deployment shape "garden desktop / local cell": runtime mode
 * 'local', auth via the per-run loopback bearer token, REST = SPARQL over the
 * cell's named graphs through /mcp. The shrubbery LIBRARY never sees any of this
 * — it only depends on the ShrubberyContract INTERFACE (from @shrubbery/nucleus).
 *
 * The contract keeps every environment-specific concern in this app shell:
 *   - auth: real loopback token (or undefined when the proxy injects it).
 *   - rest: the cell's real graph catalog + SPARQL read/write MCP tools.
 *   - runtime: mode 'local', graphBaseUrl points at the loopback base.
 *   - crdt: the real y-websocket document-sync backend.
 *   - ui: Garden's ported confirmation dialog, Lucide icon renderer, and
 *     canonical presence-color palette.
 * The reusable shrubbery packages still see only the narrow contract surfaces.
 */

import type {
  AuthProvider,
  RestClient,
  RuntimeModeProvider,
  ShrubberyContract,
  UiServices,
  ConfirmOpts,
  PromptOpts,
  WireWriter,
  WireCreateRequest,
  SalienceService,
  SalienceUserValueRequest,
  BlockScore,
} from '@shrubbery/nucleus/contract'
import type { TemplateResult } from 'lit'
import { createWireModeController, uxConfigGraphIri } from '@shrubbery/nucleus'
import {
  icon as renderGardenIcon,
  type MnConfirmationDialog,
  type MnInputDialog,
  type MnInputDialogConfirmDetail,
} from '@shrubbery/components'
import { LoopbackMcpClient, mcpText, type LoopbackTransport } from './loopback-mcp.js'
import { LoopbackCrdtBackend } from './loopback-crdt-backend.js'
import {
  DocumentActivationManager,
  type DocumentActivationStorage,
} from './document-activation.js'
import { SourceMirrorRuntime } from './source-mirror-runtime.js'

// ── (1) Auth — the loopback bearer token (per-run, all scopes) ────────────────

class LoopbackAuthProvider implements AuthProvider {
  constructor(
    private readonly tok: string | undefined,
    private readonly uid: string,
  ) {}
  token(): string | undefined {
    return this.tok
  }
  userId(): string {
    return this.uid
  }
  isAuthenticated(): boolean {
    // Local cell: the loopback grants all scopes for the session. Authenticated
    // either when we hold the token (Node) or when the proxy holds it (browser:
    // token is undefined here but the same-origin proxy supplies it).
    return true
  }
  whenReady(): Promise<void> {
    // Token is known synchronously at construct time (read from loopback.json by
    // the shell). No async login race for the local cell.
    return Promise.resolve()
  }
  onChange(): () => void {
    // The local session token never rotates within a run.
    return () => {}
  }
}

// ── (3) Runtime mode — local cell ─────────────────────────────────────────────

class LocalRuntimeModeProvider implements RuntimeModeProvider {
  constructor(private readonly baseUrl: string) {}
  mode(): 'local' | 'hosted' {
    return 'local'
  }
  isGateway(): boolean {
    return false
  }
  graphBaseUrl(_graphId: string): string {
    // For a local cell every graph is served by the one loopback base.
    return this.baseUrl
  }
}

// ── REST — SPARQL read/write over the cell via /mcp ───────────────────────────

/** Shape of the gardend sparql_query envelope (the part the shell consumes). */
export interface SparqlQueryEnvelope {
  /** SELECT rows: each cell is a stringified RDF term (e.g. "227"^^xsd:integer). */
  rows?: Array<Record<string, string>>
  /** CONSTRUCT/DESCRIBE may return a serialized body here. */
  data?: string
  /** MISLEADING — counts response-set machinery, not the graph. Do not trust. */
  quadCount?: number
  [k: string]: unknown
}

/** Shape of the gardend rdf_dump envelope. */
export interface RdfDumpEnvelope {
  /** N-Triples body of the source named graph (line count = authoritative). */
  data?: string
  format?: string
  mediaType?: string
  /** MISLEADING — see SparqlQueryEnvelope.quadCount. */
  quadCount?: number
  [k: string]: unknown
}

/** One graph in gardend's hosted-compatible graph catalog projection. */
export interface GraphCatalogEntry {
  readonly graph_uri: string
  readonly graph_id: string
  readonly title: string
  readonly description: string | null
  readonly status: string
  readonly created_at: string
  readonly updated_at: string
  readonly triple_count: number | null
  readonly last_query_at: string | null
  readonly last_update_at: string | null
  readonly role: string
  readonly owner_user_id: string
  readonly granted_at?: string
  readonly [k: string]: unknown
}

/** Exact structured-content shape returned by gardend's `list_graphs` MCP tool. */
export interface GraphCatalogEnvelope {
  readonly graphs: readonly GraphCatalogEntry[]
  readonly count: number
}

function parseGraphCatalog(body: string): GraphCatalogEnvelope {
  const parsed = JSON.parse(body) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LoopbackRestClient.graphs(): list_graphs returned a non-object catalog')
  }
  const catalog = parsed as Record<string, unknown>
  if (!Array.isArray(catalog.graphs) || typeof catalog.count !== 'number') {
    throw new Error('LoopbackRestClient.graphs(): list_graphs returned a malformed { graphs, count } catalog')
  }
  if (catalog.count !== catalog.graphs.length) {
    throw new Error(
      `LoopbackRestClient.graphs(): list_graphs count ${catalog.count} does not match ${catalog.graphs.length} graph entries`,
    )
  }
  return parsed as GraphCatalogEnvelope
}

/**
 * Exported (not just used internally by `createGardendContract`) so a
 * narrower caller that only needs SPARQL read/write — e.g. the layout-as-data
 * workbench's `sparql.bindings-table` face, which needs a real `RestClient`
 * but none of `GardendContract`'s auth/UI/wire-writer concerns — can build
 * one directly over the SAME `LoopbackMcpClient` transport, rather than
 * standing up the whole contract or hand-rolling a second REST client.
 */
export class LoopbackRestClient implements RestClient {
  constructor(private readonly mcp: LoopbackMcpClient) {}

  async graphs(): Promise<GraphCatalogEnvelope> {
    // gardend projects its local GraphRecords into the same snake_case catalog
    // entries as GET /api/graphs/catalog. The MCP form wraps them in
    // `{ graphs, count }`; preserve that contract rather than inventing a shell
    // shape or reaching around the cell into its profile directory.
    const result = await this.mcp.toolsCall('list_graphs', {})
    return parseGraphCatalog(mcpText(result))
  }

  /** POST /graphs/query equivalent → sparql_query tools/call. Returns the parsed envelope. */
  async query(graphId: string, sparql: string): Promise<SparqlQueryEnvelope> {
    const result = await this.mcp.toolsCall('sparql_query', { graphId, query: sparql })
    return JSON.parse(mcpText(result)) as SparqlQueryEnvelope
  }

  async update(graphId: string, sparql: string): Promise<void> {
    await this.mcp.toolsCall('sparql_update', { graphId, update: sparql })
  }

  documentUpdate(
    graphId: string,
    documentId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Uint8Array> {
    return this.mcp.documentUpdate(graphId, documentId, options)
  }

  documentSnapshot(
    graphId: string,
    documentId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<{ readonly update: Uint8Array; readonly incarnation: string | null }> {
    return this.mcp.documentSnapshot(graphId, documentId, options)
  }

  // ── extra read primitive the session-store uses to dump the :ux:config graph ──
  // (Not on the RestClient interface — exposed on the concrete for the store.)
  async dumpUxConfig(graphId: string): Promise<RdfDumpEnvelope> {
    const result = await this.mcp.toolsCall('rdf_dump', {
      graphId,
      format: 'application/n-triples',
      sourceGraphIri: uxConfigGraphIri(graphId),
    })
    return JSON.parse(mcpText(result)) as RdfDumpEnvelope
  }
}

// ── WireWriter — cell-faithful wire create/delete over the existing /mcp client ─
//
// The REAL gen-2 wire-write path. A wire's triples live in the read-only
// :projection:workspace graph, MATERIALIZED by the cell from its workspace CRDT
// plane — so raw projection sparql_update is rejected by the cell's authority gate.
// Instead this calls the cell's create_wires MCP tool (which enqueues a
// workspace.createWire CRDT op) and the generic delete tool with type:'wires'
// (workspace.deleteWire), over the SAME LoopbackMcpClient the shell already holds —
// ZERO new transport. The cell honors a caller-minted wire_id, so the WikiLink node
// + the wire share the host-minted id (the fire-and-insert contract is preserved).
//
// This is the gen-2-honest mediated replacement for garden's bespoke POST /wires
// REST call (the emporium-mediated-call-migration thread names Wires as such).
class LoopbackWireWriter implements WireWriter {
  constructor(private readonly mcp: LoopbackMcpClient) {}

  async create(graphId: string, params: WireCreateRequest): Promise<{ wireId: string }> {
    // Emit the canonical `wires: [ {…} ]` array form the cell's wire_inputs reads,
    // with the exact keys mcp_wire_payloads.rs accepts (source/target_document_id
    // required; wire_id honored). The cell echoes the wire id; we also keep the
    // caller-minted one so the WikiLink node + wire stay in sync without a round-trip.
    const wire: Record<string, unknown> = {
      sourceDocumentId: params.sourceDocumentId,
      targetDocumentId: params.targetDocumentId,
      targetGraphId: params.targetGraphId ?? graphId,
      bidirectional: params.bidirectional ?? false,
    }
    if (params.wireId !== undefined) wire.wireId = params.wireId
    if (params.sourceBlockId !== undefined) wire.sourceBlockId = params.sourceBlockId
    if (params.targetBlockId !== undefined) wire.targetBlockId = params.targetBlockId
    if (params.predicate !== undefined) wire.predicate = params.predicate
    await this.mcp.toolsCall('create_wires', { graphId, wires: [wire] })
    return { wireId: params.wireId ?? '' }
  }

  async delete(graphId: string, wireId: string): Promise<void> {
    // No delete_wires tool exists — the generic `delete` tool resolves type:'wires'
    // (mcp_delete_service.rs) to a workspace.deleteWire op, keyed on wireId.
    await this.mcp.toolsCall('delete', { graphId, type: 'wires', wireId })
  }
}

// ── SalienceService — a computed view + a restricted write, both raw loopback ──
//
// Per-block scores live in the cell's own reserved :projection:salience graph
// (same :projection:* reservation that forces wires off raw sparql_update),
// but compositeScore/wireCounts are computed at query time from the value
// store + a wire cross-reference (salience_score_projection.rs) — never
// materialized as RDF triples, so no sparql_query can reach them either. And
// there is no MCP tool for the RESTRICTED user-value write — the cell's MCP
// catalog only has `value` (full 0-5 range, agent-accumulation semantics —
// the wrong tool for a human's replace-not-accumulate rating). So both reads
// and writes go straight through the cell's dedicated REST routes
// (loopback_salience_routes.rs) via LoopbackMcpClient.getJson/putJson — still
// the same transport/token the shell already holds, just outside the MCP
// JSON-RPC envelope.
class LoopbackSalienceService implements SalienceService {
  constructor(private readonly mcp: LoopbackMcpClient) {}

  async getScores(graphId: string, documentId: string): Promise<readonly BlockScore[]> {
    const raw = await this.mcp.getJson<{ blocks?: unknown[] }>(
      `/salience/${encodeURIComponent(graphId)}/blocks/values?document_id=${encodeURIComponent(documentId)}&limit=1000`,
    )
    const blocks = Array.isArray(raw.blocks) ? raw.blocks : []
    return blocks.map((block) => parseBlockScore(block as Record<string, unknown>))
  }

  async setUserValue(graphId: string, params: SalienceUserValueRequest): Promise<BlockScore> {
    const raw = await this.mcp.putJson<Record<string, unknown>>(
      `/salience/${encodeURIComponent(graphId)}/blocks/user-value`,
      {
        documentId: params.documentId,
        blockId: params.blockId,
        importance: params.importance,
        valence: params.valence,
      },
    )
    return parseBlockScore(raw)
  }
}

/**
 * The cell's salience JSON is dual-keyed (snake_case + camelCase) on the
 * stub-record path and camelCase-only on the real scored path (both
 * confirmed in salience_route_service.rs / LocalBlockValueRecord's serde
 * derive) — read camelCase first, fall back to snake_case so either shape
 * parses the same way.
 */
export function parseBlockScore(raw: Record<string, unknown>): BlockScore {
  // camelCase wins whenever the key is present AT ALL — including an explicit
  // `null` (a real "unrated" signal on userImportance/userValence) — and
  // snake_case is consulted only when the camel key is entirely absent. A `??`
  // fallback would instead treat an explicit camel `null` as "missing" and
  // prefer a stale/differing snake_case value on a dual-keyed payload.
  const pick = (camel: string, snake: string): unknown =>
    Object.prototype.hasOwnProperty.call(raw, camel) ? raw[camel] : raw[snake]
  const num = (camel: string, snake: string): number => {
    const value = pick(camel, snake)
    return typeof value === 'number' ? value : 0
  }
  const nullableNum = (camel: string, snake: string): number | null => {
    const value = pick(camel, snake)
    return typeof value === 'number' ? value : null
  }
  const str = (camel: string, snake: string): string => {
    const value = pick(camel, snake)
    return typeof value === 'string' ? value : ''
  }
  const nullableStr = (camel: string, snake: string): string | null => {
    const value = pick(camel, snake)
    return typeof value === 'string' ? value : null
  }
  return {
    blockId: str('blockId', 'block_id'),
    documentId: str('documentId', 'document_id'),
    cumulativeImportance: num('cumulativeImportance', 'cumulative_importance'),
    cumulativeValence: num('cumulativeValence', 'cumulative_valence'),
    rawImportanceSum: num('rawImportanceSum', 'raw_importance_sum'),
    rawValenceSum: num('rawValenceSum', 'raw_valence_sum'),
    importanceCount: num('importanceCount', 'importance_count'),
    valenceCount: num('valenceCount', 'valence_count'),
    compositeScore: num('compositeScore', 'composite_score'),
    blockWireCount: num('blockWireCount', 'block_wire_count'),
    docWireCount: num('docWireCount', 'doc_wire_count'),
    lastValuatedAt: nullableStr('lastValuatedAt', 'last_valuated_at'),
    userImportance: nullableNum('userImportance', 'user_importance'),
    userValence: nullableNum('userValence', 'user_valence'),
  }
}

// ── CRDT — the REAL loopback doc-sync backend (replaces NotWiredCrdtBackend) ──
//
// The live editor mounts only when the binding carries a real ProviderHandle. The
// spawned gardend cell serves real y-websocket doc-sync rooms at /hocuspocus/docs/
// {graph}/{doc}, so LoopbackCrdtBackend.open() connects a Y.Doc there over the SAME
// loopback the contract already targets — NO new server work. NotWiredCrdtBackend is
// GONE from the live path (a throwing backend is the only thing that would force a
// placeholder). The Node path (integration test / gardend:dev) authenticates via the
// bearer.<token> subprotocol directly; the BROWSER path (no token in JS, Vite /cell
// proxy HTTP-only) is the labelled L5 residual edge — the cell side is fully ready.

// ── UI — Garden's ported dialog, icon system, and presence palette ────────

/**
 * Canonical Garden presence swatches, byte-for-byte with Garden's
 * document-store and the --mn-color-presence-* token family. These must be raw
 * colors (not CSS var() references): Yjs awareness transmits them as data.
 */
export const GARDEN_PRESENCE_COLORS: readonly string[] = Object.freeze([
  '#2f6b55', // moss
  '#3f7c49', // fern
  '#5a8f3d', // leaf
  '#738f2f', // olive stem
  '#8a5a2b', // bark
  '#ad6a3b', // marigold
  '#b24d65', // rose
  '#6d5a9c', // iris
  '#4e789f', // hydrangea
  '#3d8078', // eucalyptus
])

/** Host override for non-DOM shells and deterministic tests. */
export type ConfirmPresenter = (opts: ConfirmOpts) => boolean | Promise<boolean>

function presentGardenConfirmation(opts: ConfirmOpts): Promise<boolean> {
  if (typeof document === 'undefined' || !document.body) {
    throw new Error(
      'UiServices.confirm(): no DOM is available; pass GardendContractOptions.confirmPresenter',
    )
  }

  // @shrubbery/components registers the actual ported Garden custom element.
  // One element per request keeps lifecycle and listeners request-scoped; no
  // singleton state can leak a prior title/label into the next confirmation.
  const dialog = document.createElement('mn-confirmation-dialog') as MnConfirmationDialog
  dialog.title = opts.title ?? 'Confirm Action'
  dialog.message = opts.message
  dialog.confirmText = opts.confirmLabel ?? 'Confirm'
  dialog.secondaryConfirmText = ''
  dialog.cancelText = opts.cancelLabel ?? 'Cancel'
  dialog.variant = 'default'
  dialog.loading = false
  document.body.appendChild(dialog)

  return new Promise<boolean>(resolve => {
    let settled = false
    const finish = (confirmed: boolean): void => {
      if (settled) return
      settled = true
      dialog.removeEventListener('mn-confirm', onConfirm)
      dialog.removeEventListener('mn-cancel', onCancel)
      dialog.hide()
      dialog.remove()
      resolve(confirmed)
    }
    const onConfirm = (): void => finish(true)
    const onCancel = (): void => finish(false)
    dialog.addEventListener('mn-confirm', onConfirm)
    dialog.addEventListener('mn-cancel', onCancel)
    dialog.show()
  })
}

/** Host override for non-DOM shells and deterministic tests. */
export type PromptPresenter = (opts: PromptOpts) => (string | null) | Promise<string | null>

function presentGardenPrompt(opts: PromptOpts): Promise<string | null> {
  if (typeof document === 'undefined' || !document.body) {
    throw new Error(
      'UiServices.prompt(): no DOM is available; pass GardendContractOptions.promptPresenter',
    )
  }

  // Same request-scoped-element discipline as presentGardenConfirmation: one
  // <mn-input-dialog> per call, so no prior title/value/placeholder can leak
  // into the next prompt.
  const dialog = document.createElement('mn-input-dialog') as MnInputDialog
  dialog.title = opts.title ?? 'Enter a value'
  dialog.message = opts.message ?? ''
  dialog.value = opts.value ?? ''
  dialog.placeholder = opts.placeholder ?? ''
  dialog.confirmText = opts.confirmLabel ?? 'OK'
  dialog.cancelText = opts.cancelLabel ?? 'Cancel'
  dialog.loading = false
  document.body.appendChild(dialog)

  return new Promise<string | null>(resolve => {
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      dialog.removeEventListener('mn-confirm', onConfirm)
      dialog.removeEventListener('mn-cancel', onCancel)
      dialog.hide()
      dialog.remove()
      resolve(value)
    }
    const onConfirm = (event: Event): void =>
      finish((event as CustomEvent<MnInputDialogConfirmDetail>).detail.value.trim())
    const onCancel = (): void => finish(null)
    dialog.addEventListener('mn-confirm', onConfirm)
    dialog.addEventListener('mn-cancel', onCancel)
    dialog.show()
  })
}

export class GardenUiServices implements UiServices {
  readonly presenceColors = GARDEN_PRESENCE_COLORS

  constructor(
    private readonly confirmPresenter: ConfirmPresenter = presentGardenConfirmation,
    private readonly promptPresenter: PromptPresenter = presentGardenPrompt,
  ) {}

  async confirm(opts: ConfirmOpts): Promise<boolean> {
    return this.confirmPresenter(opts)
  }

  async prompt(opts: PromptOpts): Promise<string | null> {
    return this.promptPresenter(opts)
  }

  icon(name: string): TemplateResult {
    // UiServices predates the icon renderer's more precise IconResult union.
    // Both branches are valid Lit child values: known names are inline SVG
    // directives and unknown names are sized TemplateResult placeholders.
    return renderGardenIcon(name) as TemplateResult
  }
}

// ── Assembly ──────────────────────────────────────────────────────────────────

export interface GardendContractOptions {
  /** Transport to the cell loopback (Node: direct URL+token; browser: /cell proxy). */
  readonly transport: LoopbackTransport
  /** Stable user/presence id for the local session (default 'local-organism'). */
  readonly userId?: string
  /**
   * Optional confirmation presenter for a non-DOM host (or a host-managed modal
   * queue). Browser organism defaults to the real mn-confirmation-dialog.
   */
  readonly confirmPresenter?: ConfirmPresenter
  /**
   * Optional prompt presenter for a non-DOM host. Browser organism defaults
   * to the real mn-input-dialog.
   */
  readonly promptPresenter?: PromptPresenter
  /**
   * Base WebSocket constructor for the live CRDT provider. Omit in the BROWSER (the
   * global WebSocket is used). The Node app / integration test MUST pass one (the `ws`
   * package) because Node's global WebSocket is shadowed under happy-dom and the
   * LoopbackCrdtBackend builds the doc-sync provider on it.
   */
  readonly crdtWebSocketPolyfill?: new (
    url: string | URL,
    protocols?: string | string[],
  ) => unknown
  /** Deterministic persistence injection for tests/embedded shells. */
  readonly documentActivationStorage?: DocumentActivationStorage
}

/**
 * The concrete contract for a local gardend cell. Also exposes the underlying
 * concrete RestClient (`restConcrete`) so the session-store can call the extra
 * `dumpUxConfig` read primitive that is intentionally not on the narrow
 * RestClient interface.
 */
export interface GardendContract extends ShrubberyContract {
  readonly restConcrete: LoopbackRestClient
  readonly mcp: LoopbackMcpClient
  /**
   * The UNWRAPPED MCP caller — bypasses `SourceMirrorRuntime.wrapMcpClient`'s
   * mirror routing (MO object-face integration spec, WS1 §6.2.4). `mcp`
   * above is the wrapped, mirror-routing client every other caller wants;
   * `rawMcp` exists specifically for `SourceObjectService`'s authority-path
   * fallback, which must reach the live cell directly.
   */
  readonly rawMcp: { callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown> }
  readonly documentActivation: DocumentActivationManager
  readonly sourceMirror: SourceMirrorRuntime
}

/** Build a real ShrubberyContract backed by the given gardend loopback. */
export function createGardendContract(opts: GardendContractOptions): GardendContract {
  const rawMcp = new LoopbackMcpClient(opts.transport)
  const liveRest = new LoopbackRestClient(rawMcp)
  const baseUrl = opts.transport.mcpUrl.replace(/\/mcp$/, '')
  const auth = new LoopbackAuthProvider(opts.transport.token, opts.userId ?? 'local-organism')
  let sourceMirror: SourceMirrorRuntime | null = null
  const documentActivation = new DocumentActivationManager({
    storage: opts.documentActivationStorage,
    fetchSnapshot: async (graphId, documentId, options) =>
      sourceMirror?.documentSnapshot(graphId, documentId)
      ?? await liveRest.documentSnapshot(graphId, documentId, options),
    fetchUpdate: async (graphId, documentId, options) =>
      sourceMirror?.documentSnapshot(graphId, documentId)?.update
      ?? await liveRest.documentUpdate(graphId, documentId, options),
    // master §3 Slice 8 (WS3 §4.5) — same late-binding pattern as
    // `fetchSnapshot`/`fetchUpdate` above. `graph-fence-parked-browser.mts`
    // (G12) drives this contract, not the hosted one, so the join must be
    // wired here too or the parked-work face's `relatedOperationIds` never
    // resolves under the real gating gate.
    relatedOperations: (key, documentIncarnation) =>
      sourceMirror?.parkedOperationIdsFor(key, documentIncarnation) ?? [],
  })
  sourceMirror = new SourceMirrorRuntime({
    liveRest,
    caller: rawMcp,
    auth,
    documentActivation,
  })
  const mcp = sourceMirror.wrapMcpClient(rawMcp)
  const wire = new LoopbackWireWriter(mcp)
  const salience = new LoopbackSalienceService(rawMcp)
  return {
    auth,
    crdt: new LoopbackCrdtBackend({
      mcpUrl: opts.transport.mcpUrl,
      token: opts.transport.token,
      userId: opts.userId ?? 'local-organism',
      WebSocketPolyfill: opts.crdtWebSocketPolyfill,
      documentActivation,
      fetchWorkspaceSnapshot: graphId => rawMcp.workspaceSnapshot(graphId),
    }),
    runtime: new LocalRuntimeModeProvider(baseUrl),
    ui: new GardenUiServices(opts.confirmPresenter, opts.promptPresenter),
    rest: sourceMirror.rest,
    wire,
    wireMode: createWireModeController({ wire }),
    salience,
    restConcrete: liveRest,
    mcp,
    rawMcp,
    documentActivation,
    sourceMirror,
  }
}
