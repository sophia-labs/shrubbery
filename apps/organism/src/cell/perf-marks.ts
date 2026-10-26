/**
 * Browser instrumentation for the performance hill-climb ("instrumentation
 * site 2/4/5" of plans/2026-10-25-perf/hunt/client.md).
 *
 * Every span is a `performance.mark` pair that is folded into one
 * `performance.measure` named `shrubbery:<name>`, so Safari Web Inspector and
 * the GUI bench can read it with a `PerformanceObserver({type:'measure'})`.
 * Attributes (counts, ids, causes; never text) travel as the measure `detail`.
 *
 * Cost when unobserved: one global read and a shared no-op closure. Nothing is
 * recorded, so the performance timeline cannot grow. A bench turns it on with
 * `window.__shrubberyPerf = true`, `localStorage['shrubbery.perf'] = '1'` or
 * `?perf=1` in the URL (checked once per page, then cached) or `setPerfEnabled`.
 */

export type PerfDetail = Record<string, string | number | boolean | null>

let enabled: boolean | null = null

function detectEnabled(): boolean {
  try {
    const g = globalThis as { __shrubberyPerf?: unknown; location?: { search?: string }; localStorage?: Storage }
    if (g.__shrubberyPerf === true) return true
    if (g.location?.search && /[?&]perf=1(?:&|$)/.test(g.location.search)) return true
    if (g.localStorage?.getItem('shrubbery.perf') === '1') return true
  } catch { /* storage may throw in private windows */ }
  return false
}

export function perfEnabled(): boolean {
  // A bench may set the global after load; re-check the cheap global every time
  // until something turns the cache on.
  if (enabled === true) return true
  const g = globalThis as { __shrubberyPerf?: unknown }
  if (g.__shrubberyPerf === true) { enabled = true; return true }
  if (enabled === null) enabled = detectEnabled()
  return enabled
}

export function setPerfEnabled(value: boolean): void {
  enabled = value
  try { (globalThis as { __shrubberyPerf?: unknown }).__shrubberyPerf = value } catch { /* ignore */ }
}

const noop = (): void => {}
let seq = 0

/**
 * Begin a span; call the returned function to end it. Safe to call end more
 * than once (only the first records).
 */
export function perfSpan(name: string, startDetail?: PerfDetail): (endDetail?: PerfDetail) => void {
  if (!perfEnabled() || typeof performance === 'undefined' || typeof performance.mark !== 'function') return noop
  const id = ++seq
  const startMark = `shrubbery:${name}:start:${id}`
  const start = performance.now()
  try { performance.mark(startMark) } catch { return noop }
  let done = false
  return (endDetail) => {
    if (done) return
    done = true
    const endMark = `shrubbery:${name}:end:${id}`
    try {
      performance.mark(endMark)
      performance.measure(`shrubbery:${name}`, {
        start,
        end: performance.now(),
        detail: { ...startDetail, ...endDetail },
      })
    } catch {
      try { performance.measure(`shrubbery:${name}`, startMark, endMark) } catch { /* ignore */ }
    }
    // The start/end marks only exist to give old engines a fallback; do not let
    // them pile up on the timeline.
    try { performance.clearMarks(startMark); performance.clearMarks(endMark) } catch { /* ignore */ }
  }
}

/** Count an event (no duration) as a zero-length measure named `shrubbery:<name>`. */
export function perfCount(name: string, detail?: PerfDetail): void {
  if (!perfEnabled() || typeof performance === 'undefined') return
  try {
    const now = performance.now()
    performance.measure(`shrubbery:${name}`, { start: now, end: now, detail: { ...detail } })
  } catch { /* ignore */ }
}

/** Run `fn` inside a span. */
export function perfMeasure<T>(name: string, fn: () => T, detail?: PerfDetail): T {
  const end = perfSpan(name, detail)
  try { return fn() } finally { end() }
}
