import { describe, expect, it } from 'vitest'
import { RENDER_FALLBACK_MS, createRenderScheduler } from '../render-scheduler.js'

/** A tiny real frame clock: frames and timers fire when the test says so. */
function clock() {
  let nextId = 1
  const frames = new Map<number, () => void>()
  const timers = new Map<number, { at: number; cb: () => void }>()
  let now = 0
  return {
    hooks: {
      requestFrame: (cb: () => void) => { const id = nextId++; frames.set(id, cb); return id },
      cancelFrame: (id: unknown) => { frames.delete(id as number) },
      setTimer: (cb: () => void, ms: number) => { const id = nextId++; timers.set(id, { at: now + ms, cb }); return id },
      clearTimer: (id: unknown) => { timers.delete(id as number) },
    },
    frame() { const batch = [...frames.values()]; frames.clear(); for (const cb of batch) cb() },
    advance(ms: number) {
      now += ms
      for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.cb() }
    },
    get queued() { return frames.size },
  }
}

describe('createRenderScheduler', () => {
  it('folds any number of requests in a frame into one render, using the state at frame time', () => {
    const c = clock()
    let state = 0
    const seen: number[] = []
    const requests: boolean[] = []
    const scheduler = createRenderScheduler(() => seen.push(state), { ...c.hooks, onRequest: coalesced => requests.push(coalesced) })
    for (let i = 1; i <= 191; i += 1) { state = i; scheduler.request() }
    expect(seen).toEqual([])
    expect(scheduler.pending).toBe(true)
    expect(c.queued).toBe(1)
    c.frame()
    expect(seen).toEqual([191])
    expect(scheduler.pending).toBe(false)
    expect(requests.filter(Boolean).length).toBe(190)
    expect(requests.filter(coalesced => !coalesced).length).toBe(1)
  })

  it('renders again for a request made after the frame, and for one made during the render (next frame)', () => {
    const c = clock()
    let renders = 0
    const scheduler = createRenderScheduler(() => {
      renders += 1
      if (renders === 1) scheduler.request()
    }, c.hooks)
    scheduler.request()
    c.frame()
    expect(renders).toBe(1)
    expect(scheduler.pending).toBe(true)
    c.frame()
    expect(renders).toBe(2)
    scheduler.request()
    c.frame()
    expect(renders).toBe(3)
  })

  it('still renders when no animation frame ever comes (hidden page), exactly once', () => {
    const c = clock()
    let renders = 0
    const scheduler = createRenderScheduler(() => { renders += 1 }, c.hooks)
    scheduler.request()
    scheduler.request()
    c.advance(RENDER_FALLBACK_MS - 1)
    expect(renders).toBe(0)
    c.advance(1)
    expect(renders).toBe(1)
    c.frame() // the frame callback was cancelled with the timer's run
    expect(renders).toBe(1)
  })

  it('renderNow renders synchronously and drops the pending frame; flush only renders when pending', () => {
    const c = clock()
    let renders = 0
    const scheduler = createRenderScheduler(() => { renders += 1 }, c.hooks)
    expect(scheduler.flush()).toBe(false)
    expect(renders).toBe(0)
    scheduler.request()
    scheduler.renderNow()
    expect(renders).toBe(1)
    c.frame()
    c.advance(1000)
    expect(renders).toBe(1)
    scheduler.request()
    expect(scheduler.flush()).toBe(true)
    expect(renders).toBe(2)
  })

  it('cancel drops a pending render', () => {
    const c = clock()
    let renders = 0
    const scheduler = createRenderScheduler(() => { renders += 1 }, c.hooks)
    scheduler.request()
    scheduler.cancel()
    c.frame()
    c.advance(1000)
    expect(renders).toBe(0)
    expect(scheduler.pending).toBe(false)
  })

  it('runs on the real animation frame and timer when given no hooks', async () => {
    let renders = 0
    const scheduler = createRenderScheduler(() => { renders += 1 })
    scheduler.request()
    scheduler.request()
    await new Promise(resolve => setTimeout(resolve, RENDER_FALLBACK_MS + 50))
    expect(renders).toBe(1)
  })
})
