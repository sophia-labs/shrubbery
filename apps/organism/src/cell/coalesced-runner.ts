/**
 * Single-flight with trailing coalescing.
 *
 * `request()` while idle starts `run()`. While a run is in flight, any number of
 * further requests collapse into ONE trailing run that starts when the in-flight
 * one settles and sees the state as it is then; every collapsed caller gets that
 * trailing run's result. A request whose `key` differs from the in-flight run's
 * (a different graph, say) is never merged: it starts at once.
 */
export function createCoalescedRunner<T>(
  run: () => Promise<T>,
  keyOf: () => string = () => '',
): () => Promise<T> {
  interface Deferred { promise: Promise<T>; resolve(value: T | PromiseLike<T>): void; reject(reason: unknown): void }
  interface Slot { readonly key: string; promise: Promise<T>; trailing: Deferred | null }
  let slot: Slot | null = null

  const deferred = (): Deferred => {
    let resolve!: Deferred['resolve']
    let reject!: Deferred['reject']
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  const begin = (key: string): Promise<T> => {
    const mine: Slot = { key, promise: undefined as unknown as Promise<T>, trailing: null }
    slot = mine
    let started: Promise<T>
    try {
      started = run()
    } catch (error) {
      started = Promise.reject(error)
    }
    mine.promise = started
    const settled = (): void => {
      const trailing = mine.trailing
      if (slot === mine) {
        slot = null
        if (trailing) begin(keyOf()).then(trailing.resolve, trailing.reject)
      } else if (trailing) {
        // Superseded by a request under another key: join whatever is running now.
        const current = slot as Slot | null
        const next = current ? current.promise : begin(keyOf())
        next.then(trailing.resolve, trailing.reject)
      }
    }
    started.then(settled, settled)
    return started
  }

  return () => {
    const key = keyOf()
    if (slot && slot.key === key) {
      slot.trailing ??= deferred()
      return slot.trailing.promise
    }
    return begin(key)
  }
}
