/**
 * One shell render per animation frame, however many things asked for it.
 *
 * `rerenderCurrentSource()` has ~190 call sites (every store notification, every
 * `refresh*`, every mirror publish). Each used to render the whole workspace
 * shell synchronously, so boot and document-open ran 8-15 renders back to back.
 * The renders are idempotent over current state, so the requests are folded:
 * `request()` marks the shell dirty and the render runs once, in the next
 * animation frame, with the state as it is THEN.
 *
 * - A hidden page gets no animation frames, so a fallback timer renders anyway
 *   (state is never left unrendered indefinitely; tests and harnesses that run in
 *   a background tab still see their render).
 * - `flush()` renders now if (and only if) a render is pending; `renderNow()`
 *   renders now unconditionally and drops the pending one. Callers that read the
 *   DOM straight after asking for a render use one of those.
 */
export interface RenderSchedulerHooks {
  requestFrame?(callback: () => void): unknown
  cancelFrame?(handle: unknown): void
  setTimer?(callback: () => void, ms: number): unknown
  clearTimer?(handle: unknown): void
  /** Called for every request, and again with `coalesced` when it folded into a pending render. */
  onRequest?(coalesced: boolean): void
}

export const RENDER_FALLBACK_MS = 100

export interface RenderScheduler {
  /** Ask for a render; at most one runs per frame. */
  request(): void
  /** Render now if one is pending. Returns whether it rendered. */
  flush(): boolean
  /** Render now, dropping any pending render. */
  renderNow(): void
  /** Drop a pending render without running it. */
  cancel(): void
  readonly pending: boolean
}

export function createRenderScheduler(render: () => void, hooks: RenderSchedulerHooks = {}): RenderScheduler {
  const requestFrame = hooks.requestFrame
    ?? (typeof requestAnimationFrame === 'function' ? (cb: () => void) => requestAnimationFrame(() => cb()) : undefined)
  const cancelFrame = hooks.cancelFrame
    ?? (typeof cancelAnimationFrame === 'function' ? (handle: unknown) => cancelAnimationFrame(handle as number) : undefined)
  const setTimer = hooks.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms))
  const clearTimer = hooks.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))

  let pending = false
  let frameHandle: unknown = null
  let timerHandle: unknown = null

  const clearPending = (): void => {
    if (frameHandle !== null) cancelFrame?.(frameHandle)
    if (timerHandle !== null) clearTimer(timerHandle)
    frameHandle = null
    timerHandle = null
    pending = false
  }

  const run = (): void => {
    clearPending()
    render()
  }

  return {
    request() {
      if (pending) {
        hooks.onRequest?.(true)
        return
      }
      hooks.onRequest?.(false)
      pending = true
      if (requestFrame) frameHandle = requestFrame(run)
      timerHandle = setTimer(run, RENDER_FALLBACK_MS)
    },
    flush() {
      if (!pending) return false
      run()
      return true
    },
    renderNow() {
      run()
    },
    cancel: clearPending,
    get pending() { return pending },
  }
}
