/**
 * session-store-quiet-poll.test.ts — a poll that finds nothing must cost
 * nothing.
 *
 * THE BUG. `set()` notified every subscriber unconditionally, and `refresh()`
 * calls it twice per tick (`loading`, then `ready`) against a 3-second poll. So
 * every subscriber rebuilt the workspace twice every three seconds, forever,
 * whether or not the cell had said anything new. Measured in the packaged app
 * on a 1,137-document graph: the WebKit process at 48% CPU with WindowServer
 * alongside at 48% — continuous repaint, not merely computation — memory
 * climbing, and a main-thread profile dominated by
 * `IDBTransaction::dispatchEvent` from the per-tick cache write.
 *
 * WHY THE OBVIOUS GUARD COULD NOT HAVE WORKED, which is worth a test rather
 * than a comment: `CellConfigRead` carries `readAt: Date.now()`. Any structural
 * or deep comparison of the read differs on every single tick. The comparison
 * has to be on the authority's own payload — the N-Triples string — and nothing
 * else.
 *
 * EVERY CASE HERE DRIVES `startPoll` WITH FAKE TIMERS, never a private
 * argument. An earlier draft called an internal `refresh(background)` directly;
 * it passed while the wiring that actually runs in the app — the `setInterval`
 * inside `startPoll` — went untested, so dropping the background flag there
 * would have restored the bug against a green suite. The timer IS the subject.
 */
import { describe, it, expect, vi } from 'vitest'
import { createSessionStore } from '../session-store.js'
import type { CellContract } from '../session-store.js'

const NT = '<urn:a> <urn:b> <urn:c> .\n'
/** A config with no sux:Workspace node — the real shape of a fresh/imported graph. */
const ABSENT = '# no workspace node\n'

function contractReturning(body: () => string, onRead: () => void = () => undefined): CellContract {
  return {
    restConcrete: {
      dumpUxConfig: async () => {
        onRead()
        return { data: body() }
      },
    },
  } as unknown as CellContract
}

const noStorage = {
  get: async () => undefined,
  put: async () => undefined,
  delete: async () => undefined,
}

describe('the config poll is quiet when nothing changed', () => {
  it('four poll ticks over an unchanged cell wake nobody', async () => {
    vi.useFakeTimers()
    try {
      let reads = 0
      const store = createSessionStore({
        contract: contractReturning(() => ABSENT, () => { reads += 1 }),
        graphId: 'g',
        offlineStorage: noStorage,
      })
      await store.refresh()
      const notified = vi.fn()
      store.subscribe(notified)

      const stop = store.startPoll(3000)
      for (let tick = 0; tick < 4; tick += 1) await vi.advanceTimersByTimeAsync(3000)
      stop()

      expect(reads, 'the cell is still being asked — quiet is not blind').toBe(5)
      expect(
        notified.mock.calls.length,
        'an unchanged cell must wake no subscriber — this is the 48% CPU',
      ).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('still notifies the moment the config actually changes', async () => {
    vi.useFakeTimers()
    try {
      let body = ABSENT
      const store = createSessionStore({
        contract: contractReturning(() => body),
        graphId: 'g',
        offlineStorage: noStorage,
      })
      await store.refresh()
      const notified = vi.fn()
      store.subscribe(notified)

      const stop = store.startPoll(3000)
      await vi.advanceTimersByTimeAsync(3000)
      expect(notified.mock.calls.length, 'still quiet while unchanged').toBe(0)

      body = ABSENT + NT
      await vi.advanceTimersByTimeAsync(3000)
      stop()

      expect(
        notified.mock.calls.length,
        'a real change must still reach the shell — quiet is not deaf',
      ).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a poll tick never flaps the UI through `loading`', async () => {
    vi.useFakeTimers()
    try {
      const store = createSessionStore({
        contract: contractReturning(() => ABSENT),
        graphId: 'g',
        offlineStorage: noStorage,
      })
      await store.refresh()
      const statuses: string[] = []
      store.subscribe(state => statuses.push(state.status))

      const stop = store.startPoll(3000)
      for (let tick = 0; tick < 3; tick += 1) await vi.advanceTimersByTimeAsync(3000)
      stop()

      expect(statuses, 'ready -> loading -> ready twice every 3s is a flap, not a state').toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a USER-initiated refresh still shows loading — quiet applies to polls only', async () => {
    const store = createSessionStore({
      contract: contractReturning(() => ABSENT),
      graphId: 'g',
      offlineStorage: noStorage,
    })
    await store.refresh()
    const statuses: string[] = []
    store.subscribe(state => statuses.push(state.status))

    await store.refresh()

    expect(statuses, 'someone asked; a spinner is the honest answer').toContain('loading')
  })

  it('does not rewrite the offline cache on a tick that changed nothing', async () => {
    vi.useFakeTimers()
    try {
      const put = vi.fn(async () => undefined)
      const store = createSessionStore({
        contract: contractReturning(() => ABSENT),
        graphId: 'g',
        offlineStorage: { ...noStorage, put },
      })
      await store.refresh()
      const afterFirst = put.mock.calls.length

      const stop = store.startPoll(3000)
      for (let tick = 0; tick < 4; tick += 1) await vi.advanceTimersByTimeAsync(3000)
      stop()

      expect(
        put.mock.calls.length,
        'an IndexedDB transaction per tick is the churn the profiler found',
      ).toBe(afterFirst)
    } finally {
      vi.useRealTimers()
    }
  })

  describe('while the page is hidden', () => {
    const setVisibility = (value: 'hidden' | 'visible'): void => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
      document.dispatchEvent(new Event('visibilitychange'))
    }

    it('asks the cell nothing, and reads once the moment the page is visible again', async () => {
      vi.useFakeTimers()
      try {
        let reads = 0
        const store = createSessionStore({
          contract: contractReturning(() => ABSENT, () => { reads += 1 }),
          graphId: 'g',
          offlineStorage: noStorage,
        })
        await store.refresh()
        expect(reads).toBe(1)

        const stop = store.startPoll(3000)
        setVisibility('hidden')
        for (let tick = 0; tick < 5; tick += 1) await vi.advanceTimersByTimeAsync(3000)
        expect(reads, 'a hidden page must not poll').toBe(1)

        setVisibility('visible')
        await vi.advanceTimersByTimeAsync(0)
        expect(reads, 'one catch-up read on becoming visible').toBe(2)
        await vi.advanceTimersByTimeAsync(3000)
        expect(reads, 'and the poll resumes').toBe(3)
        stop()
        setVisibility('visible')
        await vi.advanceTimersByTimeAsync(0)
        expect(reads, 'stopping the poll also stops listening for visibility').toBe(3)
      } finally {
        vi.useRealTimers()
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      }
    })
  })

  it('a poll that sees identical dump text keeps the freshest readAt and wakes nobody', async () => {
    vi.useFakeTimers()
    try {
      const store = createSessionStore({
        contract: contractReturning(() => ABSENT),
        graphId: 'g',
        offlineStorage: noStorage,
      })
      await store.refresh()
      const first = store.get().read
      const notified = vi.fn()
      store.subscribe(notified)
      await vi.advanceTimersByTimeAsync(5000)
      await store.nudge?.()
      const second = store.get().read
      expect(second?.nt).toBe(first?.nt)
      expect(second?.config).toBe(first?.config) // same parsed object: nothing was re-parsed
      expect(second?.readAt ?? 0).toBeGreaterThan(first?.readAt ?? 0)
      expect(notified).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('nudge picks up a real change without a loading flash', async () => {
    let body = ABSENT
    const store = createSessionStore({
      contract: contractReturning(() => body),
      graphId: 'g',
      offlineStorage: noStorage,
    })
    await store.refresh()
    const statuses: string[] = []
    store.subscribe(state => statuses.push(state.status))
    body = ABSENT + NT
    await store.nudge?.()
    expect(store.get().read?.nt).toBe(body)
    expect(statuses).toEqual(['ready'])
  })
})
