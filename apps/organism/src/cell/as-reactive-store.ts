/**
 * as-reactive-store.ts — the D4 bridge, SHELL-side (per S13: factories/adapters
 * stay shell-side, never kernel residents).
 *
 * @shrubbery/nucleus declares ReactiveSource<T> with get()/subscribe(). This
 * compatibility bridge adapts any older getState()/subscribe()/refresh() source
 * over the identical {status,read,error} envelope into the canonical store shape:
 *
 *     { get: s.getState, subscribe: s.subscribe, refresh: s.refresh }
 *
 * No store rewrite, no new dependency, no call-site churn. The shells keep
 * calling getState() (they string-compare getState().status); the renderer/host
 * layer that wants a ReactiveSource gets one via this adapter at the boundary.
 */

import type { ShrubberyStore, StoreState } from '@shrubbery/nucleus'

/**
 * The structural shape the two app stores ALREADY expose (getState, not get).
 * Older shell stores and small test stores can satisfy this without a nominal
 * dependency.
 */
export interface GetStateStore<T> {
  getState(): StoreState<T>
  subscribe(cb: (s: StoreState<T>) => void): () => void
  refresh(): Promise<void>
}

/**
 * Adapt a getState()-shaped store to the kernel's get()-shaped ShrubberyStore<T>.
 * Pure, additive, no-mock-testable against a real store object.
 */
export function asReactiveStore<T>(s: GetStateStore<T>): ShrubberyStore<T> {
  return {
    get: () => s.getState(),
    subscribe: (cb) => s.subscribe(cb),
    refresh: () => s.refresh(),
  }
}
