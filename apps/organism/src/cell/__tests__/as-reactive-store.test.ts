/**
 * as-reactive-store.test.ts — drives the D4 adapter against a REAL hand-rolled
 * getState/subscribe/refresh store object (a real reactive store, NOT a mock).
 *
 * No-mock: the input is a genuine reactive object whose refresh() really mutates
 * state and notifies subscribers; the test asserts the adapter reads/forwards
 * THROUGH to it. The two production factory inputs (createSessionStore needs a
 * GardendContract; createEmporiumStore needs a transport) are deliberately NOT
 * exercised here — they're backend-coupled and covered by the live-read
 * integration tests; faking their inputs would violate the no-mock rule.
 */
import { describe, it, expect } from 'vitest'
import type { StoreState } from '@shrubbery/nucleus'
import { isReady } from '@shrubbery/nucleus'
import { asReactiveStore, type GetStateStore } from '../as-reactive-store.js'

/** A REAL getState-shaped store over an arbitrary payload (mirrors the two
 *  organism stores' hand-rolled reactive core — same set/subscribe machinery). */
function makeGetStateStore<T>(loader: () => Promise<T>): GetStateStore<T> {
  let state: StoreState<T> = { status: 'idle', read: null, error: null }
  const subs = new Set<(s: StoreState<T>) => void>()
  const set = (next: StoreState<T>): void => {
    state = next
    for (const cb of subs) cb(state)
  }
  return {
    getState: () => state,
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    async refresh() {
      set({ status: 'loading', read: state.read, error: null })
      try {
        const read = await loader()
        set({ status: 'ready', read, error: null })
      } catch (e) {
        set({ status: 'error', read: state.read, error: e instanceof Error ? e.message : String(e) })
      }
    },
  }
}

describe('asReactiveStore — the get/getState D4 bridge against a real store', () => {
  it('get() reads through to getState(): idle before, ready after a real refresh()', async () => {
    const store = makeGetStateStore(async () => ({ n: 7 }))
    const reactive = asReactiveStore(store)

    expect(reactive.get().status).toBe('idle')
    expect(store.getState().status).toBe('idle')

    await reactive.refresh()

    expect(reactive.get().status).toBe('ready')
    // The adapter reads the SAME live state object the store holds.
    expect(reactive.get()).toBe(store.getState())
    expect(isReady(reactive.get())).toBe(true)
    if (isReady(reactive.get())) {
      expect(reactive.get().read).not.toBeNull()
    }
  })

  it('subscribe() forwards the value to the callback and returns a working unsubscribe', async () => {
    const store = makeGetStateStore(async () => 99)
    const reactive = asReactiveStore(store)

    const seen: StoreState<number>[] = []
    const unsub = reactive.subscribe((s) => {
      seen.push(s)
    })

    await reactive.refresh() // fires loading + ready through the same subs set
    expect(seen.map((s) => s.status)).toEqual(['loading', 'ready'])
    expect(seen[seen.length - 1].read).toBe(99)

    unsub()
    const before = seen.length
    await reactive.refresh()
    // After unsubscribe, no more notifications reach this callback.
    expect(seen.length).toBe(before)
  })

  it('surfaces a real error verbatim through get() (no faked fallback)', async () => {
    const store = makeGetStateStore<number>(async () => {
      throw new Error('cell unreachable: ECONNREFUSED')
    })
    const reactive = asReactiveStore(store)

    await reactive.refresh()
    const s = reactive.get()
    expect(s.status).toBe('error')
    expect(s.error).toBe('cell unreachable: ECONNREFUSED')
    expect(isReady(s)).toBe(false)
  })
})
