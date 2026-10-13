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
 * a built-in config when the live read FAILS.
 *
 * ONE deliberate carve-out (NOT a failure): a graph whose :ux:config carries NO
 * `sux:Workspace` node at all — fresh, imported, and legacy-migrated graphs all
 * boot this way — is the DEFINED empty state, not a broken read. That case maps
 * to the canonical GARDEN_DEFAULT in memory (read.defaulted=true) so the shell
 * renders a workspace instead of a blank page. Nothing is ever written back:
 * the moment the graph holds real config triples, any later load parses and
 * returns THEM (defaulted=false). A MALFORMED config (Workspace node present
 * but parse/validation fails) still errors verbatim — falling back over a real
 * config would mask corruption.
 */

import {
  GARDEN_DEFAULT,
  isNoWorkspaceNodeError,
  parseNT,
  parseTriplesToConfig,
  projectShrubberyStore,
  validateConfig,
  type RestClient,
  type ShrubberyContract,
  type WorkspaceConfig,
} from '@shrubbery/nucleus'
import type { GardendContract } from './gardend-contract.js'
import { withLegacyDefaultInteractionEdges } from './legacy-default-interactions.js'
import { withChoreographModesRegion } from './choreograph-region-compat.js'
import { uxConfigGraphIri } from '@shrubbery/nucleus'
import type {
  PollableStore,
  ShrubberyStore,
  StoreStatus as CanonicalStoreStatus,
  StoreState,
} from '@shrubbery/nucleus'

/**
 * The fallback shown when a graph has no :ux:config: GARDEN_DEFAULT narrowed
 * to the Garden app alone. Dropping the app dimension also keeps the host-only
 * Grapevine views from attaching, so an unconfigured graph shows Garden
 * and nothing else. A graph's own saved config is unaffected.
 */
const { 'region-choreo-center': _choreoCenter, ...gardenOnlyRegions } = GARDEN_DEFAULT.regions
const { 'dim-app': _appDimension, ...gardenOnlyDimensions } = GARDEN_DEFAULT.dimensions
const { appRootRegions: _appRootRegions, ...gardenOnlyBase } = GARDEN_DEFAULT
export const GARDEN_ONLY_DEFAULT: WorkspaceConfig = {
  ...gardenOnlyBase,
  regions: gardenOnlyRegions,
  dimensions: gardenOnlyDimensions,
}

/** The config-loading extension shared by local gardend and hosted gateway shells. */
export interface CellRestClient extends RestClient {
  query(graphId: string, sparql: string): Promise<{
    rows?: Array<Record<string, string>>
    [k: string]: unknown
  }>
  dumpUxConfig(graphId: string): Promise<{
    data?: string
    [k: string]: unknown
  }>
}

/** Any cell-backed contract with the concrete named-graph dump primitive. */
export interface CellContract extends ShrubberyContract {
  readonly restConcrete: CellRestClient
}

/** A single live-read result (config + provenance). */
export interface CellConfigRead {
  readonly config: WorkspaceConfig
  /**
   * True when `config` is the in-memory GARDEN_DEFAULT because the graph's
   * :ux:config held NO sux:Workspace node (the defined empty state). False for
   * every real parsed config. Never persisted — provenance only, so the shell
   * can surface an honest "default workspace" notice.
   */
  readonly defaulted: boolean
  /** Exact pre-edge default received its six interaction edges in memory only. */
  readonly interactionCompatibility?: 'legacy-default-v1'
  /** Authoritative triple count = N-Triples body line count (NOT the envelope quadCount). */
  readonly tripleCount: number
  /** The raw N-Triples body read from the cell (for display / debugging). */
  readonly nt: string
  /** The named-graph IRI that was read. */
  readonly graphIri: string
  /** Wall-clock ms when this read completed. */
  readonly readAt: number
  /** Honest activation testimony for cold offline boot. */
  readonly activationSource?: 'live' | 'indexeddb'
  /** The transport failure that caused a validated cached read to be used. */
  readonly offlineError?: string
}

interface StoredCellConfigRead {
  readonly key: string
  readonly userId: string
  readonly graphId: string
  readonly schemaVersion: 1
  readonly read: CellConfigRead
}

export interface CellConfigReadStorage {
  get(userId: string, graphId: string): Promise<CellConfigRead | undefined>
  put(userId: string, graphId: string, read: CellConfigRead): Promise<void>
  delete(userId: string, graphId: string): Promise<void>
}

const SESSION_CACHE_DB = 'shrubbery-session-activation-v1'
const SESSION_CACHE_STORE = 'workspace-config'

function sessionCacheKey(userId: string, graphId: string): string {
  return JSON.stringify([userId.trim(), graphId.trim()])
}

function sessionIdbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('session cache request failed'))
  })
}

function sessionIdbTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('session cache transaction aborted'))
    transaction.onerror = () => reject(transaction.error ?? new Error('session cache transaction failed'))
  })
}

export class IndexedDbCellConfigReadStorage implements CellConfigReadStorage {
  private database: Promise<IDBDatabase> | null = null

  constructor(private readonly factory: IDBFactory) {}

  async get(userId: string, graphId: string): Promise<CellConfigRead | undefined> {
    const db = await this.open()
    const transaction = db.transaction(SESSION_CACHE_STORE, 'readonly')
    const completion = sessionIdbTransaction(transaction)
    const record = await sessionIdbRequest(
      transaction.objectStore(SESSION_CACHE_STORE).get(
        sessionCacheKey(userId, graphId),
      ) as IDBRequest<StoredCellConfigRead | undefined>,
    )
    await completion
    if (
      !record
      || record.schemaVersion !== 1
      || record.userId !== userId
      || record.graphId !== graphId
    ) return undefined
    return structuredClone(record.read)
  }

  async put(userId: string, graphId: string, read: CellConfigRead): Promise<void> {
    const db = await this.open()
    const transaction = db.transaction(SESSION_CACHE_STORE, 'readwrite')
    transaction.objectStore(SESSION_CACHE_STORE).put({
      key: sessionCacheKey(userId, graphId),
      userId,
      graphId,
      schemaVersion: 1,
      read: structuredClone(read),
    } satisfies StoredCellConfigRead)
    await sessionIdbTransaction(transaction)
  }

  async delete(userId: string, graphId: string): Promise<void> {
    const db = await this.open()
    const transaction = db.transaction(SESSION_CACHE_STORE, 'readwrite')
    transaction.objectStore(SESSION_CACHE_STORE).delete(sessionCacheKey(userId, graphId))
    await sessionIdbTransaction(transaction)
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    this.database = new Promise((resolve, reject) => {
      const request = this.factory.open(SESSION_CACHE_DB, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(SESSION_CACHE_STORE)) {
          request.result.createObjectStore(SESSION_CACHE_STORE, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        this.database = null
        reject(request.error ?? new Error('session cache open failed'))
      }
      request.onblocked = () => {
        this.database = null
        reject(new Error('session cache open was blocked'))
      }
    })
    return this.database
  }
}

export class MemoryCellConfigReadStorage implements CellConfigReadStorage {
  private readonly records = new Map<string, CellConfigRead>()

  async get(userId: string, graphId: string): Promise<CellConfigRead | undefined> {
    const read = this.records.get(sessionCacheKey(userId, graphId))
    return read ? structuredClone(read) : undefined
  }

  async put(userId: string, graphId: string, read: CellConfigRead): Promise<void> {
    this.records.set(sessionCacheKey(userId, graphId), structuredClone(read))
  }

  async delete(userId: string, graphId: string): Promise<void> {
    this.records.delete(sessionCacheKey(userId, graphId))
  }
}

function defaultCellConfigReadStorage(): CellConfigReadStorage {
  return typeof globalThis.indexedDB === 'object'
    ? new IndexedDbCellConfigReadStorage(globalThis.indexedDB)
    : new MemoryCellConfigReadStorage()
}

/** A response was received, but its config bytes are not renderable authority. */
export class CellConfigContentError extends Error {
  override readonly name = 'CellConfigContentError'
}

/**
 * Read the cell's :ux:config graph once and parse it to a WorkspaceConfig.
 *
 * Read path: rdf_dump(sourceGraphIri=:ux:config) → N-Triples body → parseNT →
 * parseTriplesToConfig. The triple count is taken from the body line count
 * (the +N quadCount-field discrepancy is response machinery, per the recipe).
 *
 * ABSENT ≠ MALFORMED: if parseTriplesToConfig raises the typed
 * NoWorkspaceNodeError (no sux:Workspace node in the graph at all), the read
 * resolves to the canonical GARDEN_DEFAULT in memory with defaulted=true — see
 * the module doc. All other parse errors still throw.
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
  contract: CellContract,
  graphId: string,
): Promise<CellConfigRead> {
  const env = await contract.restConcrete.dumpUxConfig(graphId)
  const nt = env.data ?? ''
  let triples: ReturnType<typeof parseNT>
  try {
    triples = parseNT(nt) // parseNT skips '#' header lines itself
  } catch (error) {
    throw new CellConfigContentError(error instanceof Error ? error.message : String(error))
  }
  let config: WorkspaceConfig
  let defaulted = false
  try {
    config = parseTriplesToConfig(triples)
  } catch (e) {
    // ONLY the typed ABSENT signal falls back (no sux:Workspace node at all —
    // fresh/imported/legacy graphs). Every other failure — transport, N-Triples
    // parse, malformed-config parse — rethrows verbatim: a fallback over a
    // real-but-broken config would mask corruption.
    if (!isNoWorkspaceNodeError(e)) {
      throw new CellConfigContentError(e instanceof Error ? e.message : String(e))
    }
    config = GARDEN_ONLY_DEFAULT
    defaulted = true
  }
  const compatibility = defaulted ? null : withLegacyDefaultInteractionEdges(config, triples)
  if (compatibility) config = compatibility.config
  config = withChoreographModesRegion(config)
  const verdict = validateConfig(config)
  if (!verdict.ok) throw new CellConfigContentError(`config rejected: ${verdict.error}`)
  return {
    config,
    defaulted,
    ...(compatibility ? { interactionCompatibility: compatibility.interactionCompatibility } : {}),
    tripleCount: triples.length,
    nt,
    graphIri: uxConfigGraphIri(graphId),
    readAt: Date.now(),
    activationSource: 'live',
  }
}

/**
 * Cross-check via SPARQL COUNT over the named graph (the recipe's second read
 * path). Returns the COUNT row binding (authoritative), NOT the envelope
 * quadCount. Used by the integration test to prove the two read paths agree.
 */
export async function countUxConfigTriples(
  contract: CellContract,
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

export interface SessionStore<C extends CellContract = GardendContract> extends PollableStore<CellConfigRead> {
  /** Compatibility alias for existing shells; canonical store reads use get(). */
  getState(): SessionStoreState
  /** The live contract the store reads through — the shell uses it to assemble the
   *  EditorServices + open the CRDT provider for the live editor (the editor seam). */
  readonly contract: C
  /** The graph this store is scoped to. */
  readonly graphId: string
}

export interface SessionStoreOptions<C extends CellContract = GardendContract> {
  readonly contract: C
  readonly graphId: string
  readonly offlineStorage?: CellConfigReadStorage
}

/**
 * Project the richer live-read store into the canonical WorkspaceConfig store the
 * render/kernel layer consumes. Provenance stays on SessionStoreState; rendering
 * gets only the config face.
 */
export function workspaceConfigStore<C extends CellContract>(store: SessionStore<C>): ShrubberyStore<WorkspaceConfig> {
  return projectShrubberyStore(store, (read) => read.config)
}

/**
 * Build a shell-side session store over a local or hosted cell contract. Wraps
 * loadConfigFromCell with reactive state + manual refresh + optional poll.
 */
export function createSessionStore<C extends CellContract>(opts: SessionStoreOptions<C>): SessionStore<C> {
  const { contract, graphId } = opts
  const offlineStorage = opts.offlineStorage ?? defaultCellConfigReadStorage()
  let activationUserId = contract.auth?.userId?.() ?? 'local-organism'
  let authEpoch = 0
  let state: SessionStoreState = { status: 'idle', read: null, error: null }
  const subs = new Set<(s: SessionStoreState) => void>()
  let pollTimer: ReturnType<typeof setInterval> | null = null
  type RefreshRequest = { readonly source: 'manual' | 'poll'; readonly previous: SessionStoreState }
  let latestRefresh: RefreshRequest | null = null
  const inFlight = new Set<RefreshRequest>()
  let cacheMutation: Promise<void> = Promise.resolve()

  /**
   * Two states are the same ANSWER when they carry the same status, the same
   * error, and the same config triples.
   *
   * Deliberately NOT a deep equality on the read: `CellConfigRead` carries
   * `readAt: Date.now()`, so every poll produces an object that differs from
   * the last one no matter what the cell said. A structural comparison can
   * therefore never short-circuit, which is exactly how this went unnoticed —
   * the guard you would reach for first cannot work here. `nt` is the
   * authority's own N-Triples payload; if that string is unchanged the
   * workspace is unchanged, whatever the clock says.
   */
  const sameAnswer = (a: SessionStoreState, b: SessionStoreState): boolean => (
    a.status === b.status
    && a.error === b.error
    && a.read?.nt === b.read?.nt
    && a.read?.activationSource === b.read?.activationSource
    && a.read?.offlineError === b.read?.offlineError
  )

  /**
   * Notify ONLY on a real change.
   *
   * This used to notify unconditionally, and `refresh()` calls it twice per
   * tick against a 3s poll — so every subscriber rebuilt the workspace twice
   * every three seconds, forever, whether or not anything had happened.
   * Measured in the packaged app on a 1,137-document graph: the WebKit process
   * at 48% CPU with WindowServer alongside it at 48% (continuous repaint, not
   * merely computation), memory climbing, and a stack dominated by
   * `IDBTransaction::dispatchEvent` from the per-tick cache write below.
   *
   * A poll that finds nothing must cost nothing.
   */
  const set = (next: SessionStoreState): void => {
    if (sameAnswer(state, next)) {
      // Keep the freshest read (its readAt/timestamps are newer) but wake no
      // one: the rendered answer is identical.
      state = next
      return
    }
    state = next
    for (const cb of subs) cb(state)
  }

  // A started storage operation cannot be cancelled through this interface.
  // Serialize mutations so a slow older put/delete cannot land after a newer
  // successful write; skip queued mutations once their refresh is superseded.
  const mutateCache = (isCurrent: () => boolean, mutation: () => Promise<void>): Promise<void> => {
    const pending = cacheMutation.then(async () => {
      if (isCurrent()) await mutation()
    })
    cacheMutation = pending.catch(() => {})
    return pending
  }

  const refresh = async (source: 'manual' | 'poll' = 'manual'): Promise<void> => {
    // Timers never multiply outstanding work. Explicit manual refresh still
    // starts a new observation and supersedes earlier results for this user.
    if (source === 'poll' && inFlight.size > 0) return
    const refreshUserId = contract.auth?.userId?.() ?? 'local-organism'
    const refreshEpoch = authEpoch
    const request: RefreshRequest = { source, previous: state }
    latestRefresh = request
    inFlight.add(request)
    const isCurrentRefresh = (): boolean =>
      latestRefresh === request && refreshEpoch === authEpoch && refreshUserId === activationUserId
    const publish = (next: SessionStoreState): void => {
      // Settle before notifying subscribers: stopping a poll from its ready
      // notification must not restore the state from before that success.
      inFlight.delete(request)
      if (isCurrentRefresh()) set(next)
    }
    try {
      // A poll tick is background work: nobody is waiting on it, so it must not
      // announce itself. A manual refresh still shows `loading`, because there a
      // spinner is the honest answer to a request someone just made. With
      // `set()` comparing answers, the `loading` hop would otherwise be the one
      // change that is real on every single tick.
      if (source !== 'poll') set({ status: 'loading', read: state.read, error: null })
      const read = await loadConfigFromCell(contract, graphId)
      if (!isCurrentRefresh()) return
      // Only persist a config that actually differs. The cache is a copy of an
      // answer, and rewriting an unchanged answer every 3s is the IndexedDB
      // transaction churn the profiler found.
      if (state.read?.nt !== read.nt) {
        try {
          await mutateCache(isCurrentRefresh, () => offlineStorage.put(refreshUserId, graphId, read))
        } catch {
          // Live authority remains usable if local persistence is unavailable.
        }
      }
      publish({ status: 'ready', read, error: null })
    } catch (e) {
      if (!isCurrentRefresh()) return
      const message = e instanceof Error ? e.message : String(e)
      // A malformed authoritative response must remain loud. Only transport
      // failure may activate a previously validated, user/graph-scoped read.
      if (!(e instanceof CellConfigContentError)) {
        try {
          const cached = await offlineStorage.get(refreshUserId, graphId)
          if (!isCurrentRefresh()) return
          if (cached) {
            const compatibility = withLegacyDefaultInteractionEdges(cached.config, parseNT(cached.nt))
            const verdict = validateConfig(cached.config)
            if (verdict.ok) {
              publish({
                status: 'ready',
                read: {
                  ...cached,
                  ...(compatibility ?? {}),
                  config: withChoreographModesRegion(compatibility?.config ?? cached.config),
                  activationSource: 'indexeddb',
                  offlineError: message,
                },
                error: null,
              })
              return
            }
            await mutateCache(isCurrentRefresh, () => offlineStorage.delete(refreshUserId, graphId))
            if (!isCurrentRefresh()) return
          }
        } catch {
          // The original transport error remains the honest failure.
        }
      }
      publish({ status: 'error', read: state.read, error: message })
    } finally {
      inFlight.delete(request)
    }
  }

  contract.auth?.onChange?.(() => {
    const nextUserId = contract.auth?.userId?.() ?? 'local-organism'
    if (nextUserId === activationUserId && contract.auth?.isAuthenticated?.()) return
    authEpoch += 1
    activationUserId = nextUserId
    latestRefresh = null
    // Never leave the previous user's validated workspace visible or eligible
    // for a late in-flight refresh after an identity boundary.
    set({ status: 'idle', read: null, error: null })
  })

  const stopPoll = (): void => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    // Stop automatic publication as well as future ticks. Keep the last
    // actual state, and leave an explicitly requested manual refresh alone.
    if (latestRefresh?.source === 'poll' && inFlight.has(latestRefresh)) {
      const previous = latestRefresh.previous
      latestRefresh = null
      set(previous)
    }
  }

  const startPoll = (intervalMs: number): (() => void) => {
    stopPoll()
    pollTimer = setInterval(() => void refresh('poll'), intervalMs)
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
