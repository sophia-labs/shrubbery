/**
 * contract.ts — the ONE backend surface the Shrubbery library may touch.
 *
 * INTERFACE-ONLY. `shrubbery` ships NO concrete for any of these. Each of the
 * three deployment shapes — garden desktop, cloud-2 cell SPA, choreograph Studio
 * — is a thin app-shell that builds a `ShrubberyContract` and injects it at boot.
 * The library reads backend state through these seams and never reaches for a
 * socket, a token, a Tauri global, or `window.*` directly.
 *
 * These shapes formalize the four hard couplings the frontend audit named
 * (auth-token supply, CRDT provider factory, native bridge, runtime-mode global)
 * plus REST and UI. See plans/shrubbery-frontend-decomposition-20260619.md §3.
 *
 * NOTE on CRDT types: the contract is deliberately structural so the nucleus
 * stays free of a hard `yjs` dependency. `CrdtDoc` / `CrdtAwareness` are opaque
 * handles; a shell binds them to concrete `Y.Doc` / `Awareness` instances. The
 * library only ever passes them through `CrdtBackend.open()` and reads the
 * provider's initial-sync gate plus its controlled lifecycle facts.
 */

import type { TemplateResult } from 'lit'

// ── Opaque CRDT handles (shell binds to yjs; nucleus stays yjs-free) ──────────

/** An opaque CRDT document handle (a shell binds this to a concrete `Y.Doc`). */
export type CrdtDoc = unknown

/** An opaque awareness/presence handle (a shell binds this to `Awareness`). */
export type CrdtAwareness = unknown

// ── (1) Auth-token supply ─────────────────────────────────────────────────────

export interface AuthProvider {
  /** ID token; `undefined` in dev / skip-auth. */
  token(): string | undefined
  /** Stable presence/scoping id (Cognito sub or dev id). */
  userId(): string
  isAuthenticated(): boolean
  /** Gates the FIRST connect — kills the "WS 401 before token" race. */
  whenReady(): Promise<void>
  /** login / refresh / logout; returns an unsubscribe. */
  onChange(cb: () => void): () => void
}

// ── (2) CRDT transport: "give me a synced room" ──────────────────────────────

/** A room descriptor the shell turns into a concrete sync provider. */
export interface CrdtRoom {
  readonly kind: 'workspace' | 'doc'
  readonly graphId: string
  readonly docId?: string
}

/** The live handle the library holds for an opened room. */
export type CrdtProviderConnection = 'connecting' | 'connected' | 'disconnected'

/**
 * Transport facts reported by the concrete provider. `synchronized` describes
 * the current Yjs room handshake only; it is deliberately not a persistence or
 * "saved" acknowledgement. `shouldConnect` distinguishes retry backoff from an
 * intentional disconnect such as hosted sign-out.
 */
export interface CrdtProviderLifecycle {
  readonly connection: CrdtProviderConnection
  readonly synchronized: boolean
  readonly shouldConnect: boolean
}

export interface CrdtDocumentActivationState {
  readonly phase: 'loading' | 'offline-clean' | 'offline-dirty' | 'live' | 'conflict'
  readonly durability: 'none' | 'pending' | 'durable' | 'failed'
  readonly renderSource: 'memory' | 'indexeddb' | 'snapshot' | 'live' | null
  readonly conflict: 'deleted' | 'replaced' | 'unfenced' | null
}

export interface ProviderHandle {
  readonly doc: CrdtDoc
  readonly awareness: CrdtAwareness
  readonly lifecycle: ReactiveSource<CrdtProviderLifecycle>
  /**
   * Trustworthy render gate. Resolves from a proven local snapshot/cache or
   * from initial live sync, whichever establishes document state first.
   */
  readonly whenRenderable: Promise<void>
  /**
   * Editing gate. A durable, incarnation-fenced cache resolves this before
   * network sync; cache misses resolve it with initial live testimony.
   */
  readonly whenEditable: Promise<void>
  /** Initial authoritative room-sync testimony. */
  readonly whenSynced: Promise<void>
  /** Testimony for activation telemetry and honest cached-state UI. */
  readonly renderSource: Promise<'memory' | 'indexeddb' | 'snapshot' | 'live'>
  /** Present for document rooms managed by an offline-capable activation store. */
  readonly activation?: ReactiveSource<CrdtDocumentActivationState>
  destroy(): void
}

export interface CrdtBackend {
  /** The ONLY connect path; called AFTER `auth.whenReady()`. Per-call, never module-scope. */
  open(room: CrdtRoom, doc: CrdtDoc): ProviderHandle
  /** Guards Y.Doc shape across library bumps. */
  schemaVersion(): number
}

// ── (3) Runtime mode (replaces the `__MN_RUNTIME_MODE__` global) ──────────────

export interface RuntimeModeProvider {
  mode(): 'local' | 'hosted'
  isGateway(): boolean
  graphBaseUrl(graphId: string): string
}

// ── UI services (dialogs / icons / presence) ─────────────────────────────────

export interface ConfirmOpts {
  readonly title?: string
  readonly message: string
  readonly confirmLabel?: string
  readonly cancelLabel?: string
}

export interface PromptOpts {
  readonly title?: string
  readonly message?: string
  readonly value?: string
  readonly placeholder?: string
  readonly confirmLabel?: string
  readonly cancelLabel?: string
}

export interface UiServices {
  confirm(opts: ConfirmOpts): Promise<boolean>
  /**
   * Themed text-input dialog. Resolves to null on cancel/dismiss. Optional:
   * not every contract implementation has a themed dialog wired up yet —
   * callers should fall back to a native prompt() when this is absent,
   * same as they did before this capability existed.
   */
  prompt?(opts: PromptOpts): Promise<string | null>
  icon(name: string): TemplateResult
  /** SoT lives in nucleus tokens; passed through here. */
  readonly presenceColors: readonly string[]
}

// ── REST ──────────────────────────────────────────────────────────────────────

export interface RestClient {
  /** `GET /graphs` (catalog). */
  graphs(): Promise<unknown>
  /** `POST /graphs/query` — SPARQL read against a graph. */
  query(graphId: string, sparql: string): Promise<unknown>
  /** `POST /graphs/update` — SPARQL write against a graph. */
  update(graphId: string, sparql: string): Promise<void>
  /**
   * Optional deployment-specific Y.Doc snapshot read used only for proactive
   * cache hydration. It must not open a room or publish awareness.
   */
  documentUpdate?(
    graphId: string,
    documentId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Uint8Array>
}

// ── Wire writes (the cell-faithful seam — NOT raw projection SPARQL) ──────────
//
// CONTRACT-SURFACE ADDITION (flagged for the emporium-mediated-call-migration
// thread, where Wires is named as a bespoke frontend→backend call). RestClient's
// `update()` cannot create/delete a wire on a REAL cell: a wire's triples live in
// the workspace projection graph (…:projection:workspace), and a raw sparql_update
// targeting any :projection:* graph is REJECTED by the cell's authority gate
// (garden rdf_authority.rs: "SPARQL update targets a reserved local RDF authority
// graph"). Wires are MATERIALIZED by the cell from the WORKSPACE CRDT plane — the
// real write path is the cell's workspace.createWire / workspace.deleteWire op
// (reached via the create_wires MCP tool + the generic delete{type:'wires'} tool,
// or the equivalent /wires REST route). This narrow seam is the gen-2-honest
// mediated replacement for garden's bespoke `POST /wires` call; the shell's
// concrete implements it over the transport it already holds.

/** Params to create a wikilink-backing wire (mirrors the cell's create_wires arg). */
export interface WireCreateRequest {
  /** Source document id (required by the cell: source_document_id). */
  readonly sourceDocumentId: string
  /** Target document id (required by the cell: target_document_id). */
  readonly targetDocumentId: string
  /** Target graph id (cross-graph links); defaults to the wire's own graph. */
  readonly targetGraphId?: string
  /** Source block id, if the link lives in a specific block. */
  readonly sourceBlockId?: string
  /** Target block id, for block-level links. */
  readonly targetBlockId?: string
  /** Predicate IRI/name; the cell defaults to its own when omitted. */
  readonly predicate?: string
  /** Always false for wikilinks (unidirectional); defaults false. */
  readonly bidirectional?: boolean
  /** Caller-minted wire id — the cell honors it so the WikiLink node + wire share it. */
  readonly wireId?: string
}

export interface WireWriter {
  /**
   * Create a wire backing a wikilink. The cell enqueues a workspace.createWire
   * CRDT op and materializes the wire into the read-only :projection:workspace
   * graph. Returns the wire id (the caller-minted one when supplied).
   */
  create(graphId: string, params: WireCreateRequest): Promise<{ wireId: string }>
  /**
   * Delete a wire by id (the cleanup when a wikilink node is removed). The cell
   * enqueues a workspace.deleteWire CRDT op.
   */
  delete(graphId: string, wireId: string): Promise<void>
}

// ── (3b) Salience service — a computed view, not a plain projection read ──────
//
// Per-block importance/valence scores live in the cell's own reserved
// :projection:salience graph (garden rdf_authority.rs — same `:projection:*`
// reservation that forces wires off raw sparql_update). Unlike wires, though,
// reads ALSO can't go through RestClient.query(): the interesting fields —
// compositeScore, blockWireCount, docWireCount — are computed at query time
// from the value store + a wire-count cross-reference (garden
// salience_score_projection.rs), never materialized as triples in the
// projection graph. So both halves go through the cell's dedicated REST
// surface (loopback_salience_routes.rs): GET .../blocks/values for reads, PUT
// .../blocks/user-value for the restricted, replace-not-accumulate user
// rating (importance ∈ {0,3,5}, valence ∈ {-4,0,4}) — distinct from the
// full-range, accumulating agent valuation path an MCP `value` call would
// take. This is the human-rating half only; agents keep valuing through
// their own tools.

/** A block's salience scores, mirroring the cell's BlockValuation shape. */
export interface BlockScore {
  readonly blockId: string
  readonly documentId: string
  readonly cumulativeImportance: number
  readonly cumulativeValence: number
  readonly rawImportanceSum: number
  readonly rawValenceSum: number
  readonly importanceCount: number
  readonly valenceCount: number
  readonly compositeScore: number
  readonly blockWireCount: number
  readonly docWireCount: number
  readonly lastValuatedAt: string | null
  /** The graph's shared human rating: null | 0 | 3 | 5. 0 is "actively forgetting," distinct from null (unrated). */
  readonly userImportance: number | null
  /** The graph's shared human rating: null | -4 | 0 | 4. */
  readonly userValence: number | null
}

/** Params to replace the graph-shared human rating for one block. */
export interface SalienceUserValueRequest {
  readonly documentId: string
  readonly blockId: string
  /** null | 0 | 3 | 5 — validated cell-side; anything else is rejected. */
  readonly importance: number | null
  /** null | -4 | 0 | 4 — validated cell-side; anything else is rejected. */
  readonly valence: number | null
}

export interface SalienceService {
  /**
   * All scored/tagged blocks for a document — a computed view (composite
   * score, wire counts), not a plain read of the projection graph.
   */
  getScores(graphId: string, documentId: string): Promise<readonly BlockScore[]>
  /**
   * Replace the graph-shared human rating for a block. The current Garden
   * route carries no observer identity, so this is deliberately not described
   * as a per-user assessment. Unlike agent valuations it is replace-current,
   * online-only state rather than an accumulating, offline source operation.
   * Returns the block's full updated score.
   */
  setUserValue(graphId: string, params: SalienceUserValueRequest): Promise<BlockScore>
}

// ── (4) Native bridge — optional (absent ⇒ web / cell / Studio) ───────────────

export interface NativeBridge {
  /** Local file read (desktop only). */
  readFile(path: string): Promise<string>
  /** Local file write (desktop only). */
  writeFile(path: string, contents: string): Promise<void>
}

// ── (5) Visual wire mode — host-owned active-mode state + cross-pane gating ──
//
// The wire-creation surface needs an explicit truth source for "wire mode is
// on, from where, with what config, and which host owns it." Without it,
// multiple split-pane editor hosts cannot coordinate (which one gets J/K nav,
// which one commits on Enter), and the editor-kernel must stay state-free.
//
// This view formalizes prod's wireStore (Zustand) + module-level
// activeWirePane pair into one explicit seam. The runtime subscribes to read;
// the organism (via the advanced wire menu confirm) calls enter; the runtime
// (on cross-pane mousedown) calls transferActiveHost; Enter / mouse-click
// targets call commit. Direction='reverse' swaps source/target in the wire
// create call. Direction='bidirectional' sets the bidirectional flag.

/** Direction of the wire being constructed; commit() handles the swap. */
export type WireModeDirection = 'forward' | 'reverse' | 'bidirectional'

/** The endpoint a wire originates from when wire mode is active. */
export interface WireModeSource {
  readonly graphId: string
  readonly documentId: string
  readonly blockId: string | null
}

/** The target endpoint resolved on commit. */
export interface WireModeTarget {
  readonly graphId: string
  readonly documentId: string
  readonly blockId: string | null
}

/** Per-mode wire configuration captured at entry (predicate + direction). */
export interface WireModeConfig {
  readonly predicate: string
  readonly direction: WireModeDirection
}

/** Snapshot of wire-mode state observed by subscribers. */
export interface WireModeView {
  readonly isActive: boolean
  readonly source: WireModeSource | null
  readonly config: WireModeConfig | null
  /** Opaque host identifier; null when no host owns wire mode. */
  readonly activeHostId: string | null
}

export interface WireModeController {
  /** Snapshot the current wire-mode state. */
  view(): WireModeView
  /** Subscribe to wire-mode state changes; returns an unsubscribe. */
  subscribe(cb: (view: WireModeView) => void): () => void
  /**
   * Enter wire mode from `source` with `config`, owned by `hostId`. Replaces
   * source + config + activeHostId when wire mode is already active (prod's
   * Mod+Shift+; can re-open the advanced menu mid-mode, which calls enter
   * again with the new predicate / direction).
   */
  enter(source: WireModeSource, config: WireModeConfig, hostId: string): void
  /** Exit wire mode and clear all state. Idempotent when already inactive. */
  exit(): void
  /**
   * Transfer active-host ownership to `hostId` without exiting wire mode. For
   * split-view cross-pane mousedown: clicking another pane transfers the
   * J/K/Enter / mouse-target focus without canceling the wire being made.
   * No-op when wire mode is inactive.
   */
  transferActiveHost(hostId: string): void
  /**
   * Commit a wire to `target` using the current source + config. Handles
   * source/target swap when direction='reverse'; sets bidirectional=true
   * when direction='bidirectional'. Exits wire mode on success. Throws if
   * wire mode is inactive.
   */
  commit(target: WireModeTarget): Promise<{ wireId: string }>
}

// ── Telemetry — optional (PostHog / TTS) ─────────────────────────────────────

export interface Telemetry {
  track(event: string, props?: Readonly<Record<string, unknown>>): void
}

// ── IoC without a container: Zustand's getState/subscribe satisfies this ──────

export interface ReactiveSource<T> {
  get(): T
  subscribe(cb: (value: T) => void): () => void
}

// ── The injected bundle ───────────────────────────────────────────────────────

export interface ShrubberyContract {
  readonly auth: AuthProvider
  readonly crdt: CrdtBackend
  readonly runtime: RuntimeModeProvider
  readonly ui: UiServices
  readonly rest: RestClient
  /** Cell-faithful wire create/delete (the workspace-CRDT-materialized write path). */
  readonly wire: WireWriter
  /** Visual wire mode state + lifecycle (commit calls wire.create under the hood). */
  readonly wireMode: WireModeController
  /** Cell-faithful salience read (computed score view) + user-rating write. */
  readonly salience: SalienceService
  readonly native?: NativeBridge
  readonly telemetry?: Telemetry
}
