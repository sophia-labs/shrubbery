/**
 * session-store.ts — SHELL-SIDE store factory: the seam between a
 * ShrubberyContract and the pure library's WorkspaceConfig.
 *
 * `loadConfigFromCell(contract)` is the one-shot read: it pulls the cell's
 * :ux:config NAMED graph through the contract's REST/MCP surface, then runs the
 * REAL production read path (parseNT → parseTriplesToConfig) to recover a
 * WorkspaceConfig. The library functions are the same ones the organism's seed
 * mode and the runtime integration test use — no second, divergent parser.
 *
 * `createSessionStore(contract)` wraps that in a tiny reactive store (manual
 * refresh + optional poll) the shell binds the render host to. The store is
 * SHELL-side state — the library never owns a backend connection; it is handed
 * a finished WorkspaceConfig.
 *
 * NO MOCKS / NO FAKED FALLBACK: a read error is surfaced verbatim in the store
 * state (status='error', error=<the real message>). The store never substitutes
 * a built-in config when the live read fails.
 */

import {
  parseNT,
  parseTriplesToConfig,
  parseVtuberControlOverlay,
  projectShrubberyStore,
  validateConfig,
  type VtuberControlOverlay,
  type WorkspaceConfig,
} from '@shrubbery/nucleus'
import type { GardendContract } from './gardend-contract.js'
import { uxConfigGraphIri } from '@shrubbery/nucleus'
import type {
  PollableStore,
  ShrubberyStore,
  StoreStatus as CanonicalStoreStatus,
  StoreState,
} from '@shrubbery/nucleus'

/** A single live-read result (config + provenance). */
export interface CellConfigRead {
  readonly config: WorkspaceConfig
  /** Authoritative triple count = N-Triples body line count (NOT the envelope quadCount). */
  readonly tripleCount: number
  /** The raw N-Triples body read from the cell (for display / debugging). */
  readonly nt: string
  /** The named-graph IRI that was read. */
  readonly graphIri: string
  /** Wall-clock ms when this read completed. */
  readonly readAt: number
}

/**
 * Read the cell's :ux:config graph once and parse it to a WorkspaceConfig.
 *
 * Read path: rdf_dump(sourceGraphIri=:ux:config) → N-Triples body → parseNT →
 * parseTriplesToConfig. The triple count is taken from the body line count
 * (the +N quadCount-field discrepancy is response machinery, per the recipe).
 *
 * VALIDATION PARITY WITH THE WRITE GATE: the grow/commit path validates every
 * config before it lands (grow.ts → validateConfig); the live READ must apply
 * the SAME invariants, or a cell holding a malformed config (e.g. a cyclic
 * childRegion spine that stack-overflows planFor, or an unresolvable region)
 * would render garbage or brick the shell. We run validateConfig on the parsed
 * candidate and, on failure, throw the verdict VERBATIM — never returning a
 * silently-broken config. The throw is caught by createSessionStore.refresh and
 * surfaced through the honest read-status channel (status='error', error=the
 * 'config rejected: …' message), exactly like a transport/parse error.
 */
export async function loadConfigFromCell(
  contract: GardendContract,
  graphId: string,
): Promise<CellConfigRead> {
  const env = await contract.restConcrete.dumpUxConfig(graphId)
  const nt = env.data ?? ''
  const triples = parseNT(nt) // parseNT skips '#' header lines itself
  const config = parseTriplesToConfig(triples)
  const verdict = validateConfig(config)
  if (!verdict.ok) throw new Error(`config rejected: ${verdict.error}`)
  return {
    config,
    tripleCount: triples.length,
    nt,
    graphIri: uxConfigGraphIri(graphId),
    readAt: Date.now(),
  }
}

/**
 * Read the cell's :ux:control graph once and parse it to a VtuberControlOverlay.
 * Mirrors loadConfigFromCell exactly (rdf_dump → N-Triples body → parse), scoped
 * to the sibling :ux:control named graph via `restConcrete.dumpUxControl` instead
 * of `dumpUxConfig`. This is the live-read extension S2/S3 needed: the layout
 * graph (:ux:config) says WHICH component renders where; this overlay says what
 * durable control state (tints/expression/model) drives an mn-vtuber surface once
 * rendered — a second, sibling read through the SAME client, not a new backend.
 */
export async function loadControlOverlayFromCell(
  contract: GardendContract,
  graphId: string,
): Promise<VtuberControlOverlay> {
  const env = await contract.restConcrete.dumpUxControl(graphId)
  const triples = parseNT(env.data ?? '')
  return parseVtuberControlOverlay(triples)
}

/**
 * Cross-check via SPARQL COUNT over the named graph (the recipe's second read
 * path). Returns the COUNT row binding (authoritative), NOT the envelope
 * quadCount. Used by the integration test to prove the two read paths agree.
 */
export async function countUxConfigTriples(
  contract: GardendContract,
  graphId: string,
): Promise<number> {
  const iri = uxConfigGraphIri(graphId)
  const env = await contract.restConcrete.query(
    graphId,
    `SELECT (COUNT(*) AS ?n) WHERE { GRAPH <${iri}> { ?s ?p ?o } }`,
  )
  const row = env.rows?.[0]
  const raw = row?.n ?? ''
  const m = /(\d+)/.exec(raw)
  if (!m) throw new Error(`countUxConfigTriples: no COUNT binding in SPARQL result: ${JSON.stringify(env).slice(0, 300)}`)
  return Number(m[1])
}

// ── Reactive store (shell-side) ───────────────────────────────────────────────

/**
 * Re-export the canonical nucleus StoreStatus under the local name the shells
 * already import. Members are byte-identical ('idle'|'loading'|'ready'|'error');
 * this re-points the alias at the single source of truth WITHOUT renaming any
 * member or method (apps/organism/main.ts string-compares getState().status).
 */
export type StoreStatus = CanonicalStoreStatus

/**
 * The session store's settled state = the canonical async-load envelope
 * specialized to a CellConfigRead payload. Same {status,read,error} shape as
 * before — now expressed as nucleus StoreState<CellConfigRead>.
 */
export type SessionStoreState = StoreState<CellConfigRead>

export interface SessionStore extends PollableStore<CellConfigRead> {
  /** Compatibility alias for existing shells; canonical store reads use get(). */
  getState(): SessionStoreState
  /** The live contract the store reads through — the shell uses it to assemble the
   *  EditorServices + open the CRDT provider for the live editor (the editor seam). */
  readonly contract: GardendContract
  /** The graph this store is scoped to. */
  readonly graphId: string
}

export interface SessionStoreOptions {
  readonly contract: GardendContract
  readonly graphId: string
}

/**
 * Project the richer live-read store into the canonical WorkspaceConfig store the
 * render/kernel layer consumes. Provenance stays on SessionStoreState; rendering
 * gets only the config face.
 */
export function workspaceConfigStore(store: SessionStore): ShrubberyStore<WorkspaceConfig> {
  return projectShrubberyStore(store, (read) => read.config)
}

/**
 * Build a shell-side session store over a gardend contract. Wraps
 * loadConfigFromCell with reactive state + manual refresh + optional poll.
 */
export function createSessionStore(opts: SessionStoreOptions): SessionStore {
  const { contract, graphId } = opts
  let state: SessionStoreState = { status: 'idle', read: null, error: null }
  const subs = new Set<(s: SessionStoreState) => void>()
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const set = (next: SessionStoreState): void => {
    state = next
    for (const cb of subs) cb(state)
  }

  const refresh = async (): Promise<void> => {
    set({ status: 'loading', read: state.read, error: null })
    try {
      const read = await loadConfigFromCell(contract, graphId)
      set({ status: 'ready', read, error: null })
    } catch (e) {
      // Surface the REAL error verbatim — never fall back to a built-in config.
      set({ status: 'error', read: state.read, error: e instanceof Error ? e.message : String(e) })
    }
  }

  const stopPoll = (): void => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  const startPoll = (intervalMs: number): (() => void) => {
    stopPoll()
    pollTimer = setInterval(() => void refresh(), intervalMs)
    return stopPoll
  }

  return {
    get: () => state,
    getState: () => state,
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    refresh,
    startPoll,
    stopPoll,
    contract,
    graphId,
  }
}
