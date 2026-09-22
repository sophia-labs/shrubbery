/**
 * source-store.ts — the host-side config store over a TripleSource.
 *
 * HOISTED lineage: apps/organism/src/cell/session-store.ts @ b2f408e
 * (CellConfigRead.readAt is TripleRead.readAt's direct ancestor; the
 * refresh/startPoll shape is the session-store recipe) — organism's copy is
 * frozen under active swarm ownership; @shrubbery/source is the sole external
 * adapter-consumption convention. Upgrades over the ancestor:
 *
 *   - EMPTY is a FIRST-CLASS state: `tripleCount === 0` pre-checks to
 *     status 'empty' BEFORE parseTriplesToConfig (which throws on empty
 *     input) — never an error, never an excuse for a fallback body.
 *   - errors are classified 1:1 from the contract taxonomy
 *     (TripleSourceError.code), plus 'parse' for a parseTriplesToConfig
 *     throw on non-empty input — never by sniffing transport error shapes.
 *
 * The canonical nucleus StoreStatus ('idle'|'loading'|'ready'|'error',
 * reactive-store.ts) is load-bearing and frozen-consumed; it is NOT widened.
 * SourceStoreStatus is the package-local envelope reusing the canonical
 * member names. Whether 'empty' is eventually absorbed into the nucleus
 * StoreStatus is ledgered for when the runtime freeze lifts — not decided
 * here.
 *
 * NO MOCKS / NO FAKED FALLBACK: a read error is surfaced verbatim
 * (status='error', error=<the real message>). No fallback config exists
 * anywhere in the tree.
 */

import {
  TripleSourceError,
  parseTriplesToConfig,
  triplesOf,
  type TripleRead,
  type TripleSource,
  type TripleSourceErrorCode,
  type WorkspaceConfig,
} from '@shrubbery/nucleus'

/** Canonical members + the first-class 'empty' state. */
export type SourceStoreStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

/** Error classification: the contract taxonomy 1:1, plus 'parse' for a
 *  vocabulary-level failure on non-empty input. */
export type SourceErrorKind = TripleSourceErrorCode | 'parse'

export interface SourceState {
  readonly status: SourceStoreStatus
  /** Last completed read testimony (set for ready AND empty; retained through
   *  later errors — hosts label it stale). */
  readonly read: TripleRead | null
  /** Non-null iff status === 'ready'. */
  readonly config: WorkspaceConfig | null
  /** Verbatim message, never softened. */
  readonly error: string | null
  /** Set iff status === 'error'. `null` also covers the (contract-violating)
   *  case of a non-TripleSourceError thrown by an adapter — the message still
   *  surfaces verbatim in `error`. */
  readonly errorKind: SourceErrorKind | null
}

export interface SourceConfigStore {
  get(): SourceState
  subscribe(cb: (s: SourceState) => void): () => void
  /** One read → one settled state (ready | empty | error). */
  refresh(): Promise<void>
  /** Start the host's re-read loop. Interval resolution:
   *  explicit arg → boot pollMs → description.suggestedPollMs. On a 'static'
   *  source this is a documented no-op (a fossil can never change). */
  startPoll(intervalMs?: number): () => void
  stopPoll(): void
  /** The source this store reads through (testimony display). */
  readonly source: TripleSource
  /** The named graph this store is scoped to. */
  readonly graphIri: string
}

export interface SourceConfigStoreOptions {
  /** Default poll interval; falls back to description.suggestedPollMs. */
  readonly pollMs?: number
}

/**
 * Build a reactive config store over one TripleSource + one named graph.
 * The store is HOST-side state — the render layer is handed a finished
 * WorkspaceConfig and never owns a backend connection.
 */
export function createConfigStore(
  source: TripleSource,
  graphIri: string,
  opts: SourceConfigStoreOptions = {},
): SourceConfigStore {
  let state: SourceState = { status: 'idle', read: null, config: null, error: null, errorKind: null }
  const subs = new Set<(s: SourceState) => void>()
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const set = (next: SourceState): void => {
    state = next
    for (const cb of subs) cb(state)
  }

  const refresh = async (): Promise<void> => {
    set({ status: 'loading', read: state.read, config: null, error: null, errorKind: null })
    let read: TripleRead
    try {
      read = await source.read(graphIri)
    } catch (e) {
      // Surface the REAL error verbatim — never fall back to a built-in config.
      set({
        status: 'error',
        read: state.read, // retained previous read; hosts label it stale
        config: null,
        error: e instanceof Error ? e.message : String(e),
        errorKind: e instanceof TripleSourceError ? e.code : null,
      })
      return
    }
    if (read.tripleCount === 0) {
      // EMPTY is a successful read — first-class, never an error.
      set({ status: 'empty', read, config: null, error: null, errorKind: null })
      return
    }
    try {
      const config = parseTriplesToConfig(triplesOf(read))
      set({ status: 'ready', read, config, error: null, errorKind: null })
    } catch (e) {
      // The read succeeded; the vocabulary-level parse did not. The read
      // testimony is kept (it is real), the config is not fabricated.
      set({
        status: 'error',
        read,
        config: null,
        error: e instanceof Error ? e.message : String(e),
        errorKind: e instanceof TripleSourceError ? e.code : 'parse',
      })
    }
  }

  const stopPoll = (): void => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  const startPoll = (intervalMs?: number): (() => void) => {
    if (source.description.liveness === 'static') {
      // A fossil can never change — polling it would be aspiration, not
      // testimony. Documented no-op (PlanterBootConfig: 'static' ignores pollMs).
      return () => {}
    }
    const interval = intervalMs ?? opts.pollMs ?? source.description.suggestedPollMs
    if (interval === undefined) {
      throw new Error(
        'createConfigStore.startPoll: no interval — pass intervalMs, set boot pollMs, ' +
          'or use an adapter that declares description.suggestedPollMs',
      )
    }
    stopPoll()
    pollTimer = setInterval(() => void refresh(), interval)
    return stopPoll
  }

  return {
    get: () => state,
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    refresh,
    startPoll,
    stopPoll,
    source,
    graphIri,
  }
}
