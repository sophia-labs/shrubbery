import { describe, expect, it } from 'vitest'
import { createIdlePersist } from '../idle-persist.js'

/** A real virtual clock for the scheduler's three injection points. */
function clock() {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; cb: () => void }>()
  const idles = new Map<number, { cb: () => void; deadline: number }>()
  return {
    hooks: {
      setTimer: (cb: () => void, ms: number) => { const id = nextId++; timers.set(id, { at: now + ms, cb }); return id },
      clearTimer: (id: unknown) => { timers.delete(id as number) },
      requestIdle: (cb: () => void, timeout: number) => { const id = nextId++; idles.set(id, { cb, deadline: now + timeout }); return id },
      cancelIdle: (id: unknown) => { idles.delete(id as number) },
    },
    advance(ms: number, opts: { idle?: boolean } = {}) {
      const end = now + ms
      while (now < end) {
        now += 1
        for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.cb() }
        for (const [id, i] of [...idles]) {
          // The browser runs an idle callback when idle, or at its deadline.
          if ((opts.idle ?? false) || i.deadline <= now) { idles.delete(id); i.cb() }
        }
      }
    },
    get now() { return now },
  }
}

describe('createIdlePersist', () => {
  it('waits for quiet: every schedule restarts the window, then runs once', () => {
    const c = clock()
    const runs: string[] = []
    const persist = createIdlePersist<string>({ quietMs: 100, maxWaitMs: 10_000, idleTimeoutMs: 50, run: a => runs.push(a), ...c.hooks })
    persist.schedule('live')
    c.advance(90)
    persist.schedule('live')
    c.advance(90)
    expect(runs).toEqual([])
    expect(persist.pending).toBe(true)
    c.advance(10, { idle: true })
    expect(runs).toEqual(['live'])
    expect(persist.pending).toBe(false)
  })

  it('after quiet, runs at the idle deadline even if the browser is never idle', () => {
    const c = clock()
    const runs: string[] = []
    const persist = createIdlePersist<string>({ quietMs: 100, maxWaitMs: 10_000, idleTimeoutMs: 50, run: a => runs.push(a), ...c.hooks })
    persist.schedule('live')
    c.advance(149)
    expect(runs).toEqual([])
    c.advance(1)
    expect(runs).toEqual(['live'])
  })

  it('bounds the delay of a document edited without pause: maxWait after the first unwritten update, plus idle timeout', () => {
    const c = clock()
    const runs: number[] = []
    const persist = createIdlePersist<string>({ quietMs: 100, maxWaitMs: 1000, idleTimeoutMs: 50, run: () => runs.push(c.now), ...c.hooks })
    for (let t = 0; t < 3000; t += 10) {
      persist.schedule('live') // an update every 10 ms: the quiet window never elapses
      c.advance(10)
    }
    expect(runs.length).toBeGreaterThanOrEqual(2)
    expect(runs[0]).toBeLessThanOrEqual(1000 + 50 + 10)
    for (let i = 1; i < runs.length; i += 1) expect(runs[i]! - runs[i - 1]!).toBeLessThanOrEqual(1000 + 50 + 20)
  })

  it('runs on a plain 0 ms timer when the quiet window is 0, and straight away without requestIdleCallback', () => {
    const c = clock()
    const runs: string[] = []
    const zero = createIdlePersist<string>({ quietMs: 0, maxWaitMs: 100, idleTimeoutMs: 50, run: a => runs.push(a), ...c.hooks })
    zero.schedule('offline')
    c.advance(1)
    expect(runs).toEqual(['offline'])

    const noIdle = createIdlePersist<string>({
      quietMs: 20, maxWaitMs: 100, idleTimeoutMs: 50, run: a => runs.push(a),
      setTimer: c.hooks.setTimer, clearTimer: c.hooks.clearTimer,
      // WebKit: no requestIdleCallback at all.
      requestIdle: undefined,
    })
    // The default picks up globalThis.requestIdleCallback when present; make the absence explicit for the run.
    const had = (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback
    delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback
    try {
      const fresh = createIdlePersist<string>({
        quietMs: 20, maxWaitMs: 100, idleTimeoutMs: 50, run: a => runs.push(a),
        setTimer: c.hooks.setTimer, clearTimer: c.hooks.clearTimer,
      })
      fresh.schedule('live')
      c.advance(20)
      expect(runs).toEqual(['offline', 'live'])
    } finally {
      if (had) (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = had
    }
    noIdle.cancel()
  })

  it('take() hands back the pending request and cancels it; cancel() drops it', () => {
    const c = clock()
    const runs: string[] = []
    const persist = createIdlePersist<string>({ quietMs: 100, maxWaitMs: 1000, idleTimeoutMs: 50, run: a => runs.push(a), ...c.hooks })
    expect(persist.take()).toBeNull()
    persist.schedule('live')
    expect(persist.take()).toBe('live')
    c.advance(5000, { idle: true })
    expect(runs).toEqual([])
    persist.schedule('live')
    persist.cancel()
    c.advance(5000, { idle: true })
    expect(runs).toEqual([])
    expect(persist.pending).toBe(false)
  })
})
