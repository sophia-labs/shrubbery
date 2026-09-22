import type {
  CrdtProviderLifecycle,
  ReactiveSource,
} from '@shrubbery/nucleus'

export interface MutableCrdtProviderLifecycle {
  readonly source: ReactiveSource<CrdtProviderLifecycle>
  set(value: CrdtProviderLifecycle): void
  clear(): void
}

/** Small shell-owned reactive value for facts emitted by y-websocket. */
export function createCrdtProviderLifecycle(
  initial: CrdtProviderLifecycle,
): MutableCrdtProviderLifecycle {
  let value = Object.freeze({ ...initial })
  const listeners = new Set<(next: CrdtProviderLifecycle) => void>()
  return {
    source: {
      get: () => value,
      subscribe(callback) {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
    },
    set(next) {
      if (
        next.connection === value.connection
        && next.synchronized === value.synchronized
        && next.shouldConnect === value.shouldConnect
      ) return
      value = Object.freeze({ ...next })
      for (const listener of listeners) listener(value)
    },
    clear() {
      listeners.clear()
    },
  }
}
