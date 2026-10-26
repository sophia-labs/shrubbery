/**
 * When to write a cache snapshot: quiet first, then idle, never later than a ceiling.
 *
 * The document cache used to persist 120 ms after each update (a trailing debounce, reset by every
 * update), so typing with natural pauses encoded and wrote the whole Y.Doc every word or two. This
 * scheduler holds a persist request until
 *
 * 1. the document has been quiet for `quietMs` (every update restarts this), and then
 * 2. the main thread is idle (`requestIdleCallback`, run by `idleTimeoutMs` at the latest), or, where
 *    that API does not exist (WebKit), straight away;
 *
 * and a continuously edited document still persists: `maxWaitMs` after the FIRST unwritten update
 * the persist is forced through the same idle step, so the delay is bounded by
 * `maxWaitMs + idleTimeoutMs`. With `quietMs` of 0 the persist runs on a plain 0 ms timer (the
 * pre-existing "persist now" mode used by tests and by callers that want no deferral).
 *
 * `take()` hands back the pending request and cancels the timers: `flush()`, `dispose()`, page hide
 * and quarantine call it to write (or drop) at once.
 */
export interface IdlePersistOptions<A> {
  readonly quietMs: number
  readonly maxWaitMs: number
  readonly idleTimeoutMs: number
  run(authority: A): void
  setTimer?(callback: () => void, ms: number): unknown
  clearTimer?(handle: unknown): void
  /** Defaults to `requestIdleCallback` when the page has it; otherwise the callback runs immediately. */
  requestIdle?(callback: () => void, timeoutMs: number): unknown
  cancelIdle?(handle: unknown): void
}

export interface IdlePersist<A> {
  schedule(authority: A): void
  /** The pending request, if any; timers are cancelled. */
  take(): A | null
  cancel(): void
  readonly pending: boolean
}

export function createIdlePersist<A>(options: IdlePersistOptions<A>): IdlePersist<A> {
  const setTimer: (callback: () => void, ms: number) => unknown =
    options.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms))
  const clearTimer: (handle: unknown) => void =
    options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const idleApi = globalThis as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number
    cancelIdleCallback?: (handle: number) => void
  }
  const requestIdle: ((callback: () => void, timeoutMs: number) => unknown) | undefined = options.requestIdle ?? (
    typeof idleApi.requestIdleCallback === 'function'
      ? (cb: () => void, timeout: number) => idleApi.requestIdleCallback!(cb, { timeout })
      : undefined
  )
  const cancelIdle: ((handle: unknown) => void) | undefined = options.cancelIdle ?? (
    typeof idleApi.cancelIdleCallback === 'function'
      ? (handle: unknown) => idleApi.cancelIdleCallback!(handle as number)
      : undefined
  )

  let pendingAuthority: A | null = null
  let hasPending = false
  let quietTimer: unknown = null
  let maxTimer: unknown = null
  let idleHandle: unknown = null

  const clearAll = (): void => {
    if (quietTimer !== null) clearTimer(quietTimer)
    if (maxTimer !== null) clearTimer(maxTimer)
    if (idleHandle !== null) cancelIdle?.(idleHandle)
    quietTimer = null
    maxTimer = null
    idleHandle = null
  }

  const fire = (): void => {
    clearAll()
    if (!hasPending) return
    const authority = pendingAuthority as A
    pendingAuthority = null
    hasPending = false
    options.run(authority)
  }

  const goIdle = (): void => {
    // Either timer may get here first; whichever does ends both.
    if (quietTimer !== null) clearTimer(quietTimer)
    if (maxTimer !== null) clearTimer(maxTimer)
    quietTimer = null
    maxTimer = null
    if (idleHandle !== null) return
    if (options.quietMs <= 0 || !requestIdle) {
      fire()
      return
    }
    idleHandle = requestIdle(fire, options.idleTimeoutMs)
  }

  return {
    schedule(authority) {
      pendingAuthority = authority
      hasPending = true
      if (quietTimer !== null) clearTimer(quietTimer)
      quietTimer = setTimer(goIdle, Math.max(0, options.quietMs))
      if (maxTimer === null && idleHandle === null) {
        maxTimer = setTimer(goIdle, Math.max(0, options.maxWaitMs))
      }
    },
    take() {
      clearAll()
      if (!hasPending) return null
      const authority = pendingAuthority as A
      pendingAuthority = null
      hasPending = false
      return authority
    },
    cancel() {
      clearAll()
      pendingAuthority = null
      hasPending = false
    },
    get pending() {
      return hasPending
    },
  }
}
