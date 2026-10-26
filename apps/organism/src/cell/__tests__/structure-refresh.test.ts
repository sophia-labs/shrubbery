import { describe, expect, it } from 'vitest'
import {
  STRUCTURE_REFRESH_DEBOUNCE_MS,
  createStructureRefresher,
  type StructureRefreshTimers,
} from '../structure-refresh.js'

/** A real, tiny virtual-time scheduler (not a mock of anything: the refresher only needs set/clear). */
class VirtualTimers implements StructureRefreshTimers {
  now = 0
  private next = 1
  private readonly pending = new Map<number, { at: number; run: () => void }>()
  set(callback: () => void, ms: number): unknown {
    const id = this.next++
    this.pending.set(id, { at: this.now + ms, run: callback })
    return id
  }
  clear(handle: unknown): void { this.pending.delete(handle as number) }
  advance(ms: number): void {
    this.now += ms
    for (const [id, entry] of [...this.pending]) {
      if (entry.at <= this.now) {
        this.pending.delete(id)
        entry.run()
      }
    }
  }
  get size(): number { return this.pending.size }
}

function harness(opts: { graph?: boolean; outline?: boolean } = {}) {
  const timers = new VirtualTimers()
  const calls = { full: 0, stats: 0 }
  const refresher = createStructureRefresher({
    graphWantsRefresh: () => opts.graph === true,
    outlineWantsRefresh: () => opts.outline === true,
    fullRender: () => { calls.full += 1 },
    refreshStats: () => { calls.stats += 1 },
  }, timers)
  return { timers, calls, refresher }
}

describe('createStructureRefresher', () => {
  it('typing in a body paragraph refreshes only the count, once per pause, never the shell', () => {
    const { timers, calls, refresher } = harness()
    for (let i = 0; i < 50; i += 1) {
      refresher.handle('transaction', false)
      timers.advance(40) // keystrokes faster than the debounce
    }
    expect(calls).toEqual({ full: 0, stats: 0 })
    timers.advance(STRUCTURE_REFRESH_DEBOUNCE_MS)
    expect(calls).toEqual({ full: 0, stats: 1 })
  })

  it('a heading change renders the shell once after the pause, and wins over a stats refresh', () => {
    const { timers, calls, refresher } = harness()
    refresher.handle('transaction', false)
    refresher.handle('transaction', true)
    refresher.handle('transaction', false)
    timers.advance(STRUCTURE_REFRESH_DEBOUNCE_MS)
    expect(calls).toEqual({ full: 1, stats: 0 })
  })

  it('an open graph panel keeps the old behaviour: a full render after every pause', () => {
    const { timers, calls, refresher } = harness({ graph: true })
    refresher.handle('transaction', false)
    timers.advance(STRUCTURE_REFRESH_DEBOUNCE_MS)
    expect(calls).toEqual({ full: 1, stats: 0 })
  })

  it('selection events are ignored unless the outline or graph panel is open, then render at once', () => {
    const closed = harness()
    closed.refresher.handle('selection', false)
    expect(closed.timers.size).toBe(0)

    const open = harness({ outline: true })
    open.refresher.handle('selection', false)
    open.timers.advance(0)
    expect(open.calls).toEqual({ full: 1, stats: 0 })
  })

  it('cancel drops pending work', () => {
    const { timers, calls, refresher } = harness()
    refresher.handle('transaction', true)
    refresher.cancel()
    timers.advance(1000)
    expect(calls).toEqual({ full: 0, stats: 0 })
  })
})
