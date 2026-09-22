/**
 * reactive-store.ts — the canonical async-load STORE ENVELOPE + abstraction,
 * hoisted into the kernel from the two shell-side stores that hand-roll it
 * byte-for-byte (apps/organism/src/cell/{session-store,emporium-store}.ts).
 *
 * Module name is `reactive-store.ts` (NOT `context.ts`): `context.ts` already
 * exists in @shrubbery/render and means the JSON-LD @context render vocabulary.
 * This module is the STORE-state ontology, a distinct concern.
 *
 * It owns FOUR pieces of the common vocabulary (with zero external runtime
 * dependencies):
 *   1. ONE canonical StoreStatus union (session-store's `StoreStatus` and
 *      emporium-store's `EmporiumStatus` are identical 4-member unions today).
 *   2. A generic StoreState<T> async-load envelope (both concretes are
 *      structurally identical except the `read` payload type).
 *   3. ShrubberyStore<T> = ReactiveSource<StoreState<T>> + refresh() — the common
 *      core both stores expose. (RefreshableStore<T> is the same core under a
 *      descriptive alias.) PollableStore<T> is an opt-in extension because only
 *      SessionStore polls; the EmporiumStore retrofit carries no dead methods.
 *   4. createAsyncStore() — the canonical in-flight dedupe + stale-while-
 *      refresh implementation for new stores, so they do not repeat that
 *      state machine.
 *
 * Existing shells keep getState() as a compatibility alias (apps/emporium/shell.ts
 * + apps/organism/main.ts still string-compare getState().status), but the
 * canonical store surface is get()/subscribe()/refresh().
 */

import type { ReactiveSource } from './contract.js'

/**
 * ONE canonical status, hoisted from session-store `StoreStatus` +
 * emporium-store `EmporiumStatus` (identical members, two names today).
 *
 * Members are LOAD-BEARING: apps/emporium/shell.ts string-compares them and
 * renders `state.status` verbatim as a badge — do NOT rename the members.
 */
export type StoreStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * The async-load envelope BOTH concrete stores already have byte-for-byte except
 * the `read` payload type. `read` retains the prior value across 'loading' and
 * 'error' so the UI never blanks; `error` carries the verbatim message (no
 * faked fallback).
 */
export interface StoreState<T> {
  readonly status: StoreStatus
  readonly read: T | null
  readonly error: string | null
  /**
   * Wall-clock time of the retained `read`, when the concrete store records
   * one. Optional for compatibility with the original shell stores; generic
   * async stores created by `createAsyncStore` always populate it after their
   * first successful read and retain it through loading/error states.
   */
  readonly capturedAt?: number | null
  /**
   * Optional retained-previous seam: stores that capture read timestamps can carry
   * the last settled read beside the current envelope without changing the
   * canonical status/read/error contract.
   */
  readonly previous?: {
    readonly read: T
    readonly capturedAt: number
  }
}

/**
 * The common core: a ReactiveSource over the envelope (D4) + the one-shot
 * refresh() both stores hand-roll. Uses get()/subscribe() (the contract names),
 * NOT getState() — upgraded concretes expose get() directly; the shell-side
 * `asReactiveStore` adapter remains for any compatibility-only getState source.
 */
export interface ShrubberyStore<T> extends ReactiveSource<StoreState<T>> {
  /** Manual one-shot live read. Resolves after the read settles. */
  refresh(): Promise<void>
}

export interface AsyncStoreOptions {
  /** Clock seam for deterministic recency tests. Production uses `Date.now`. */
  readonly now?: () => number
}

/**
 * Build the canonical reactive async-load store without re-implementing its
 * lifecycle in every host:
 *
 *   - one in-flight `refresh()` is shared by every concurrent caller;
 *   - the last successful read remains visible while refreshing or errored;
 *   - successful reads carry capture time + previous-read testimony;
 *   - load failures are represented in StoreState rather than thrown past the
 *     reactive boundary.
 *
 * Scheduling is deliberately outside this primitive. A caller may supply a
 * loader that runs through a bounded queue, an HTTP client, a worker, or a
 * local computation; the store owns observation and continuity only.
 */
export function createAsyncStore<T>(
  load: () => Promise<T>,
  options: AsyncStoreOptions = {},
): ShrubberyStore<T> {
  const now = options.now ?? Date.now
  let state: StoreState<T> = {
    status: 'idle',
    read: null,
    error: null,
    capturedAt: null,
  }
  let inFlight: Promise<void> | null = null
  const subscribers = new Set<(next: StoreState<T>) => void>()

  const publish = (next: StoreState<T>): void => {
    state = next
    for (const subscriber of subscribers) subscriber(state)
  }

  const retainedPrevious = (): StoreState<T>['previous'] => {
    if (state.read === null || typeof state.capturedAt !== 'number') return undefined
    return { read: state.read, capturedAt: state.capturedAt }
  }

  const refresh = (): Promise<void> => {
    if (inFlight) return inFlight

    const previous = retainedPrevious()
    publish({
      status: 'loading',
      read: state.read,
      error: null,
      capturedAt: state.capturedAt ?? null,
      ...(previous ? { previous } : {}),
    })

    const run = Promise.resolve()
      .then(load)
      .then(
        (read) => {
          publish({
            status: 'ready',
            read,
            error: null,
            capturedAt: now(),
            ...(previous ? { previous } : {}),
          })
        },
        (cause: unknown) => {
          publish({
            status: 'error',
            read: state.read,
            error: cause instanceof Error ? cause.message : String(cause),
            capturedAt: state.capturedAt ?? null,
            ...(previous ? { previous } : {}),
          })
        },
      )
    const settled = run.finally(() => {
      if (inFlight === settled) inFlight = null
    })
    inFlight = settled
    return settled
  }

  return {
    get: () => state,
    subscribe(subscriber) {
      subscribers.add(subscriber)
      return () => subscribers.delete(subscriber)
    },
    refresh,
  }
}

/**
 * RefreshableStore<T> — descriptive alias for the refresh()-bearing core. Same
 * shape as ShrubberyStore<T>; named for the load-bearing capability (a store you
 * can ask to re-read) so call sites that only need refresh() can say so.
 */
export type RefreshableStore<T> = ShrubberyStore<T>

/**
 * Polling is store-SPECIFIC (only SessionStore has startPoll/stopPoll). Opt-in
 * extension so the EmporiumStore retrofit carries no dead methods.
 */
export interface PollableStore<T> extends ShrubberyStore<T> {
  /** Start polling every `intervalMs`. Returns a stop function. */
  startPoll(intervalMs: number): () => void
  /** Stop any active poll. */
  stopPoll(): void
}

/**
 * Pure narrowing helper so shells stop inline-comparing status. Narrows to a
 * state whose `read` is provably non-null when ready.
 */
export const isReady = <T>(s: StoreState<T>): s is StoreState<T> & { read: T } =>
  s.status === 'ready' && s.read !== null

/**
 * Project a StoreState<T> envelope without changing its load/error semantics.
 * Prior ready data retained during loading/error remains visible after mapping;
 * null stays null, so callers never synthesize fake data.
 */
export function projectStoreState<T, U>(
  state: StoreState<T>,
  project: (read: T) => U,
): StoreState<U> {
  const projected: StoreState<U> = {
    status: state.status,
    read: state.read === null ? null : project(state.read),
    error: state.error,
    ...(state.capturedAt !== undefined ? { capturedAt: state.capturedAt } : {}),
  }
  return state.previous
    ? {
        ...projected,
        previous: {
          read: project(state.previous.read),
          capturedAt: state.previous.capturedAt,
        },
      }
    : projected
}

/**
 * Project a ShrubberyStore<T> into a ShrubberyStore<U> while preserving the same
 * subscription and refresh lifecycle. Shell stores use this to expose a
 * WorkspaceConfig store from a richer live-read payload without cloning the
 * store machinery.
 */
export function projectShrubberyStore<T, U>(
  store: ShrubberyStore<T>,
  project: (read: T) => U,
): ShrubberyStore<U> {
  return {
    get: () => projectStoreState(store.get(), project),
    subscribe: (cb) => store.subscribe((s) => cb(projectStoreState(s, project))),
    refresh: () => store.refresh(),
  }
}
