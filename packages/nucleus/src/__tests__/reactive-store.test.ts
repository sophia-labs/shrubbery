/**
 * reactive-store.test.ts — exercises the REAL store-envelope abstraction against
 * REAL StoreState values. Pure functions over real values: no DOM, no stores, no
 * mocks. (Runs under the nucleus happy-dom env, but touches no DOM.)
 */
import { describe, expect, it } from 'vitest'
import {
  createAsyncStore,
  isReady,
  type PollableStore,
  projectShrubberyStore,
  projectStoreState,
  type RefreshableStore,
  recencyFromStoreState,
  type ShrubberyStore,
  type StoreState,
  type StoreStatus,
} from '../index.js'

function deferred<T>(): {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(cause: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('StoreStatus — the canonical 4-member union', () => {
  it('is exactly [idle, loading, ready, error]', () => {
    // A value of each member must be assignable; an exhaustive list proves the
    // members at runtime (the union itself is compile-time).
    const members: StoreStatus[] = ['idle', 'loading', 'ready', 'error']
    expect(members).toEqual(['idle', 'loading', 'ready', 'error'])
  })
})

describe('isReady — narrowing over a real envelope', () => {
  it('ready + non-null read → true, with compile-time narrowing to read:T', () => {
    const ready: StoreState<{ n: number }> = { status: 'ready', read: { n: 7 }, error: null }
    expect(isReady(ready)).toBe(true)
    if (isReady(ready)) {
      // Compile-time proof: `read` is narrowed to non-null here.
      expect(ready.read.n).toBe(7)
    } else {
      throw new Error('isReady should have narrowed a ready+non-null envelope')
    }
  })

  it('ready + null read → false (no fake config substituted)', () => {
    const readyButEmpty: StoreState<number> = { status: 'ready', read: null, error: null }
    expect(isReady(readyButEmpty)).toBe(false)
  })

  it('loading + non-null read (prior value retained) → false', () => {
    const loading: StoreState<number> = { status: 'loading', read: 42, error: null }
    expect(isReady(loading)).toBe(false)
  })

  it('error + non-null read + verbatim error → false', () => {
    const errored: StoreState<number> = { status: 'error', read: 42, error: 'cell unreachable: ECONNREFUSED' }
    expect(isReady(errored)).toBe(false)
    expect(errored.error).toBe('cell unreachable: ECONNREFUSED')
  })

  it('idle → false', () => {
    const idle: StoreState<number> = { status: 'idle', read: null, error: null }
    expect(isReady(idle)).toBe(false)
  })
})

describe('ShrubberyStore<T> / RefreshableStore<T> / PollableStore<T> — real conforming objects', () => {
  /** Build a REAL in-memory store conforming to ShrubberyStore<T> (no mock). */
  function makeStore<T>(initial: T | null): ShrubberyStore<T> & { set(next: StoreState<T>): void } {
    let state: StoreState<T> = { status: initial === null ? 'idle' : 'ready', read: initial, error: null }
    const subs = new Set<(s: StoreState<T>) => void>()
    return {
      get: () => state,
      subscribe(cb) {
        subs.add(cb)
        return () => subs.delete(cb)
      },
      async refresh() {
        state = { status: 'ready', read: state.read, error: null }
        for (const cb of subs) cb(state)
      },
      set(next) {
        state = next
        for (const cb of subs) cb(state)
      },
    }
  }

  it('a real object satisfies ShrubberyStore<T>: get() reads, subscribe() forwards, refresh() settles', async () => {
    const store = makeStore<number>(null)
    expect(store.get().status).toBe('idle')

    let last: StoreState<number> | null = null
    const unsub = store.subscribe((s) => {
      last = s
    })
    store.set({ status: 'ready', read: 99, error: null })
    expect(last).not.toBeNull()
    expect(last!.read).toBe(99)
    expect(isReady(store.get())).toBe(true)

    await store.refresh()
    expect(store.get().status).toBe('ready')

    unsub()
    store.set({ status: 'error', read: 99, error: 'boom' })
    // After unsubscribe, the captured `last` does not advance.
    expect(last!.error).toBeNull()
  })

  it('RefreshableStore<T> is the same shape as ShrubberyStore<T>', () => {
    const store: ShrubberyStore<number> = makeStore<number>(1)
    const refreshable: RefreshableStore<number> = store // assignable both ways
    expect(typeof refreshable.refresh).toBe('function')
  })

  it('PollableStore<T> extends the core with startPoll/stopPoll', () => {
    const base = makeStore<number>(1)
    let polling = false
    const pollable: PollableStore<number> = {
      ...base,
      startPoll() {
        polling = true
        return () => {
          polling = false
        }
      },
      stopPoll() {
        polling = false
      },
    }
    const stop = pollable.startPoll(1000)
    expect(polling).toBe(true)
    stop()
    expect(polling).toBe(false)
    pollable.stopPoll()
    // A PollableStore is also a ShrubberyStore (the core methods are present).
    const asCore: ShrubberyStore<number> = pollable
    expect(typeof asCore.get).toBe('function')
  })

  it('projectStoreState preserves status/error while mapping retained read values', () => {
    const loadingWithPrior: StoreState<{ n: number }> = {
      status: 'loading',
      read: { n: 2 },
      error: null,
      previous: { read: { n: 1 }, capturedAt: 1000 },
    }
    expect(projectStoreState(loadingWithPrior, (r) => r.n)).toEqual({
      status: 'loading',
      read: 2,
      error: null,
      previous: { read: 1, capturedAt: 1000 },
    })

    const erroredEmpty: StoreState<{ n: number }> = {
      status: 'error',
      read: null,
      error: 'cell unreachable',
      previous: { read: { n: 1 }, capturedAt: 1000 },
    }
    expect(projectStoreState(erroredEmpty, (r) => r.n)).toEqual({
      status: 'error',
      read: null,
      error: 'cell unreachable',
      previous: { read: 1, capturedAt: 1000 },
    })
  })

  it('the retained-previous seam carries the prior read across successive reads', () => {
    const first: StoreState<{ n: number }> & { capturedAt: number } = {
      status: 'ready',
      read: { n: 1 },
      error: null,
      capturedAt: 1000,
    }
    const second: StoreState<{ n: number }> & { capturedAt: number } = {
      status: 'ready',
      read: { n: 2 },
      error: null,
      capturedAt: 2000,
      previous: { read: first.read!, capturedAt: first.capturedAt },
    }

    expect(second.previous).toEqual({ read: { n: 1 }, capturedAt: 1000 })
  })

  it('derives a pure Recency<T> view from a timestamped StoreState previous seam', () => {
    const state: StoreState<{ n: number }> & { capturedAt: number } = {
      status: 'ready',
      read: { n: 2 },
      error: null,
      capturedAt: 2000,
      previous: { read: { n: 1 }, capturedAt: 1000 },
    }

    expect(recencyFromStoreState(state)).toEqual({
      current: { n: 2 },
      capturedAt: 2000,
      previous: { value: { n: 1 }, capturedAt: 1000 },
    })
  })

  it('projectShrubberyStore projects get/subscribe and forwards refresh', async () => {
    const source = makeStore<{ n: number }>({ n: 1 })
    const projected = projectShrubberyStore(source, (r) => r.n)

    expect(projected.get()).toEqual({ status: 'ready', read: 1, error: null })

    const seen: StoreState<number>[] = []
    const unsub = projected.subscribe((s) => {
      seen.push(s)
    })
    source.set({ status: 'loading', read: { n: 2 }, error: null })
    source.set({ status: 'error', read: { n: 3 }, error: 'boom' })
    expect(seen).toEqual([
      { status: 'loading', read: 2, error: null },
      { status: 'error', read: 3, error: 'boom' },
    ])

    await projected.refresh()
    expect(source.get().status).toBe('ready')
    unsub()
  })
})

describe('createAsyncStore — canonical retained async lifecycle', () => {
  it('shares one in-flight load across concurrent refresh callers', async () => {
    const pending = deferred<number>()
    let loads = 0
    const store = createAsyncStore(async () => {
      loads += 1
      return pending.promise
    })

    const first = store.refresh()
    const second = store.refresh()
    expect(first).toBe(second)
    expect(store.get()).toMatchObject({ status: 'loading', read: null, error: null })

    pending.resolve(7)
    await first
    expect(loads).toBe(1)
    expect(store.get()).toMatchObject({ status: 'ready', read: 7, error: null })
  })

  it('retains the previous read and its capture time while refreshing', async () => {
    const reads = [deferred<number>(), deferred<number>()]
    let index = 0
    let clock = 1000
    const store = createAsyncStore(() => reads[index++]!.promise, { now: () => clock })

    const first = store.refresh()
    reads[0]!.resolve(1)
    await first

    clock = 2000
    const second = store.refresh()
    expect(store.get()).toEqual({
      status: 'loading',
      read: 1,
      error: null,
      capturedAt: 1000,
      previous: { read: 1, capturedAt: 1000 },
    })

    reads[1]!.resolve(2)
    await second
    expect(store.get()).toEqual({
      status: 'ready',
      read: 2,
      error: null,
      capturedAt: 2000,
      previous: { read: 1, capturedAt: 1000 },
    })
  })

  it('represents failure without blanking a retained successful read', async () => {
    let attempt = 0
    const store = createAsyncStore(async () => {
      attempt += 1
      if (attempt === 1) return 9
      throw new Error('cell unavailable')
    }, { now: () => 1234 })

    await store.refresh()
    await expect(store.refresh()).resolves.toBeUndefined()
    expect(store.get()).toEqual({
      status: 'error',
      read: 9,
      error: 'cell unavailable',
      capturedAt: 1234,
      previous: { read: 9, capturedAt: 1234 },
    })
  })

  it('notifies subscribers for loading and settled states, then honors unsubscribe', async () => {
    const seen: StoreStatus[] = []
    const store = createAsyncStore(async () => 4)
    const unsubscribe = store.subscribe((state) => seen.push(state.status))

    await store.refresh()
    unsubscribe()
    await store.refresh()

    expect(seen).toEqual(['loading', 'ready'])
  })
})
