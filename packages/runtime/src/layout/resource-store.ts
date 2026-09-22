/**
 * The Surface-facing composition of nucleus's canonical ShrubberyStore with
 * runtime activation policy. The store owns reactive continuity; the
 * scheduler owns when its loader may consume network/compute capacity.
 */
import {
  createAsyncStore,
  type ShrubberyStore,
  type StoreState,
} from '@shrubbery/nucleus'
import type {
  ResourceComputeContext,
  SurfaceActivationPriority,
} from './types.js'

/** Warm idle window used by the code-owned query adapters. */
export const DEFAULT_SURFACE_RESOURCE_RETENTION_MS = 60_000

export type SurfaceResourceStore<T> = ShrubberyStore<T>

export function createSurfaceResourceStore<T>(
  load: () => Promise<T>,
  context?: ResourceComputeContext,
  priority: SurfaceActivationPriority = 'visible',
): SurfaceResourceStore<T> {
  return createAsyncStore(() => (
    context
      ? context.activation.schedule(load, priority)
      : Promise.resolve().then(load)
  ))
}

/**
 * Observe the current state immediately, then every subsequent transition.
 * `ReactiveSource.subscribe` intentionally does not promise an eager first
 * notification; Surface faces need this tiny composition to paint a warm
 * snapshot synchronously on remount.
 */
export function observeSurfaceResourceStore<T>(
  store: SurfaceResourceStore<T>,
  observer: (state: StoreState<T>) => void,
): () => void {
  observer(store.get())
  return store.subscribe(observer)
}

/**
 * Imperative compatibility bridge for callers that still need one settled
 * value (for example collection reconciliation). Reactive faces should
 * observe the store directly.
 *
 * REPAIR (MO object-face integration spec, master §3 Slice 2): keyed on
 * `state.status`, never `state.read !== null`. Every caller before
 * `card.object` had a `T` that could never legitimately BE `null` on success,
 * so `state.read !== null` and `state.status === 'ready'` always agreed.
 * `card.object`'s `SourceObjectService.read()` legitimately returns `null` on
 * a SUCCESSFUL read (EMPTY: the object does not exist, or nothing is
 * selected) — with the old `read !== null` gate, that success was
 * misclassified as "no value produced" and thrown as an error. Existing
 * callers are unaffected: `store.refresh()` always settles to `status`
 * `'ready'` or `'error'` (`createAsyncStore`'s `run().then(...)` publishes
 * one of the two before the awaited promise resolves), so this is a pure
 * widening, not a behavior change, for any `T` that never carries `null`.
 */
export async function refreshSurfaceResourceStore<T>(
  store: SurfaceResourceStore<T>,
): Promise<T> {
  await store.refresh()
  const state = store.get()
  if (state.status === 'ready') return state.read as T
  throw new Error(state.error ?? 'Surface resource refresh failed')
}
