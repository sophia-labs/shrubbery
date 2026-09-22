/**
 * gardend-contract.ts — SHELL-SIDE concrete ShrubberyContract backed by a REAL
 * local gardend cell over its loopback HTTP/MCP server.
 *
 * This is the deployment shape "garden desktop / local cell": runtime mode
 * 'local', auth via the per-run loopback bearer token, REST = SPARQL over the
 * cell's named graphs through /mcp. The shrubbery LIBRARY never sees any of this
 * — it only depends on the ShrubberyContract INTERFACE (from @shrubbery/nucleus).
 *
 * Iteration 2 scope = CONFIG READ ONLY. So:
 *   - auth: real loopback token (or undefined when the proxy injects it).
 *   - rest.query: real SPARQL read against the cell, used by the session-store
 *     to fetch the :ux:config named graph.
 *   - runtime: mode 'local', graphBaseUrl points at the loopback base.
 *   - crdt / ui / native: NOT WIRED THIS ITERATION. They are honest boundaries
 *     that THROW if a future caller reaches for them — never faked handles. The
 *     config-read path never touches them, so the contract is fully real for
 *     everything iteration 2 exercises.
 */

import type {
  AuthProvider,
  RestClient,
  RuntimeModeProvider,
  ShrubberyContract,
  UiServices,
  ConfirmOpts,
  WireWriter,
  WireCreateRequest,
  SalienceService,
  SalienceUserValueRequest,
  BlockScore,
} from '@shrubbery/nucleus/contract'
import type { TemplateResult } from 'lit'
import {
  createWireModeController,
  uxConfigGraphIri,
  uxControlGraphIri,
} from '@shrubbery/nucleus'
import { LoopbackMcpClient, mcpText, type LoopbackTransport } from './loopback-mcp.js'
import { LoopbackCrdtBackend } from './loopback-crdt-backend.js'

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

class LoopbackRestClient implements RestClient {
  constructor(private readonly mcp: LoopbackMcpClient) {}

  async graphs(): Promise<unknown> {
    // Not exercised by iteration-2 config read; a future iteration maps this to
    // list_graphs / the catalog. Throw honestly rather than fake a payload.
    throw new Error('LoopbackRestClient.graphs(): not wired in iteration 2 (config-read only)')
  }

  /** POST /graphs/query equivalent → sparql_query tools/call. Returns the parsed envelope. */
  async query(graphId: string, sparql: string): Promise<SparqlQueryEnvelope> {
    const result = await this.mcp.toolsCall('sparql_query', { graphId, query: sparql })
    return JSON.parse(mcpText(result)) as SparqlQueryEnvelope
  }

  async update(graphId: string, sparql: string): Promise<void> {
    await this.mcp.toolsCall('sparql_update', { graphId, update: sparql })
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

  // ── the SAME read primitive, scoped to :ux:control (the VTuber control overlay) ──
  // Mirrors dumpUxConfig exactly — same client, same rdf_dump tool, different
  // named-graph IRI. Used by loadControlOverlayFromCell (session-store.ts) and by
  // the Atelier's set_vtuber_appearance verb's AppearanceGrowCell.readControlOverlay.
  async dumpUxControl(graphId: string): Promise<RdfDumpEnvelope> {
    const result = await this.mcp.toolsCall('rdf_dump', {
      graphId,
      format: 'application/n-triples',
      sourceGraphIri: uxControlGraphIri(graphId),
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

// ── UI — an honest "not wired this iteration" boundary (never faked) ──────────

class NotWiredUiServices implements UiServices {
  readonly presenceColors: readonly string[] = []
  confirm(_opts: ConfirmOpts): Promise<boolean> {
    throw new Error('UiServices.confirm(): not wired in iteration 2')
  }
  icon(_name: string): TemplateResult {
    throw new Error('UiServices.icon(): not wired in iteration 2')
  }
}

// ── Assembly ──────────────────────────────────────────────────────────────────

export interface GardendContractOptions {
  /** Transport to the cell loopback (Node: direct URL+token; browser: /cell proxy). */
  readonly transport: LoopbackTransport
  /** Stable user/presence id for the local session (default 'local-organism'). */
  readonly userId?: string
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
}

/** Build a real ShrubberyContract backed by the given gardend loopback. */
export function createGardendContract(opts: GardendContractOptions): GardendContract {
  const mcp = new LoopbackMcpClient(opts.transport)
  const rest = new LoopbackRestClient(mcp)
  const wire = new LoopbackWireWriter(mcp)
  const salience = new LoopbackSalienceService(mcp)
  const baseUrl = opts.transport.mcpUrl.replace(/\/mcp$/, '')
  return {
    auth: new LoopbackAuthProvider(opts.transport.token, opts.userId ?? 'local-organism'),
    crdt: new LoopbackCrdtBackend({
      mcpUrl: opts.transport.mcpUrl,
      token: opts.transport.token,
      WebSocketPolyfill: opts.crdtWebSocketPolyfill,
    }),
    runtime: new LocalRuntimeModeProvider(baseUrl),
    ui: new NotWiredUiServices(),
    rest,
    wire,
    wireMode: createWireModeController({ wire }),
    salience,
    restConcrete: rest,
    mcp,
  }
}
