import { afterEach, describe, expect, it, vi } from 'vitest'
import { GARDEN_DEFAULT, serializeConfigToTriples, triplesToNT, validateConfig } from '@shrubbery/nucleus'
import {
  MemoryCellConfigReadStorage,
  createSessionStore,
  type CellContract,
  type CellConfigReadStorage,
} from '../session-store.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const body = (label: string) => ({
  data: triplesToNT(serializeConfigToTriples({ ...GARDEN_DEFAULT, label })),
})
const stores: ReturnType<typeof createSessionStore>[] = []

function fixture(offlineStorage: CellConfigReadStorage = new MemoryCellConfigReadStorage()) {
  const requests: ReturnType<typeof deferred<{ data: string }>>[] = []
  let user = 'user-a'
  let onIdentityChange = () => {}
  const contract = {
    auth: {
      userId: () => user,
      isAuthenticated: () => true,
      onChange: (listener: () => void) => { onIdentityChange = listener; return () => {} },
    },
    restConcrete: {
      dumpUxConfig: () => {
        const request = deferred<{ data: string }>()
        requests.push(request)
        return request.promise
      },
    },
  } as unknown as CellContract
  const store = createSessionStore({ contract, graphId: 'refresh-ordering', offlineStorage })
  stores.push(store)
  return {
    store, requests, offlineStorage,
    switchUser(next: string) { user = next; onIdentityChange() },
  }
}

afterEach(() => {
  for (const store of stores.splice(0)) store.stopPoll()
  vi.useRealTimers()
})

describe('session refresh ordering and bounded polling', () => {
  it('an explicit newer refresh wins over an older success in both rendered state and cache', async () => {
    const { store, requests, offlineStorage } = fixture()
    const older = store.refresh()
    const newer = store.refresh()
    expect(requests).toHaveLength(2)
    requests[1].resolve(body('newer'))
    await newer
    requests[0].resolve(body('older'))
    await older
    expect(store.getState().read?.config.label).toBe('newer')
    expect((await offlineStorage.get('user-a', 'refresh-ordering'))?.config.label).toBe('newer')
  })

  it('an older failure cannot downgrade a newer live success into an offline/error result', async () => {
    const { store, requests } = fixture()
    const older = store.refresh()
    const newer = store.refresh()
    requests[1].resolve(body('newer'))
    await newer
    requests[0].reject(new TypeError('older network failure'))
    await older
    expect(store.getState()).toMatchObject({ status: 'ready', error: null })
    expect(store.getState().read?.config.label).toBe('newer')
    expect(store.getState().read?.activationSource).toBe('live')
    expect(store.getState().read?.offlineError).toBeUndefined()
  })

  it('an older success cannot conceal a newer failed refresh', async () => {
    const { store, requests } = fixture()
    const older = store.refresh()
    const newer = store.refresh()
    requests[1].reject(new TypeError('newer network failure'))
    await newer
    requests[0].resolve(body('older'))
    await older
    expect(store.getState().status).toBe('error')
    expect(store.getState().error).toBe('newer network failure')
    expect(store.getState().read).toBeNull()
  })

  it('a previous identity cannot publish or populate its cache after a user switch', async () => {
    const { store, requests, offlineStorage, switchUser } = fixture()
    const older = store.refresh()
    switchUser('user-b')
    expect(store.getState()).toEqual({ status: 'idle', read: null, error: null })
    const newer = store.refresh()
    requests[1].resolve(body('user-b config'))
    await newer
    requests[0].resolve(body('user-a config'))
    await older
    expect(store.getState().read?.config.label).toBe('user-b config')
    expect(await offlineStorage.get('user-a', 'refresh-ordering')).toBeUndefined()
    expect((await offlineStorage.get('user-b', 'refresh-ordering'))?.config.label).toBe('user-b config')
  })

  it('timer ticks skip all in-flight refreshes, then resume after settlement', async () => {
    vi.useFakeTimers()
    const { store, requests } = fixture()
    const manual = store.refresh()
    store.startPoll(3000)
    await vi.advanceTimersByTimeAsync(9000)
    expect(requests).toHaveLength(1)
    requests[0].resolve(body('manual'))
    await manual
    await vi.advanceTimersByTimeAsync(3000)
    expect(requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(9000)
    expect(requests).toHaveLength(2)
    requests[1].resolve(body('poll'))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(3000)
    expect(requests).toHaveLength(3)
    requests[2].resolve(body('next poll'))
    await vi.advanceTimersByTimeAsync(0)
  })

  it('stopping polling fences its pending result and restores the last actual state', async () => {
    vi.useFakeTimers()
    const { store, requests, offlineStorage } = fixture()
    const first = store.refresh()
    requests[0].resolve(body('retained'))
    await first
    const stop = store.startPoll(3000)
    await vi.advanceTimersByTimeAsync(3000)
    expect(requests).toHaveLength(2)
    // A poll tick is background work and no longer announces `loading`
    // (session-store-quiet-poll.test.ts); the pending poll is still in flight.
    expect(store.getState().status).toBe('ready')
    stop()
    expect(store.getState()).toMatchObject({ status: 'ready', read: { config: { label: 'retained' } } })
    requests[1].resolve(body('stopped poll'))
    await vi.advanceTimersByTimeAsync(9000)
    expect(requests).toHaveLength(2)
    expect(store.getState().read?.config.label).toBe('retained')
    expect((await offlineStorage.get('user-a', 'refresh-ordering'))?.config.label).toBe('retained')
  })

  it('stopping polling does not cancel an explicit manual refresh', async () => {
    vi.useFakeTimers()
    const { store, requests } = fixture()
    const stop = store.startPoll(3000)
    const manual = store.refresh()
    stop()
    requests[0].resolve(body('explicit manual result'))
    await manual
    expect(store.getState()).toMatchObject({ status: 'ready', read: { config: { label: 'explicit manual result' } } })
    await vi.advanceTimersByTimeAsync(9000)
    expect(requests).toHaveLength(1)
  })

  it('an already-started older cache write cannot overwrite a later successful read', async () => {
    const cache = new MemoryCellConfigReadStorage()
    const oldWriteStarted = deferred<void>()
    const oldWriteGate = deferred<void>()
    const offlineStorage: CellConfigReadStorage = {
      get: (user, graph) => cache.get(user, graph),
      delete: (user, graph) => cache.delete(user, graph),
      async put(user, graph, read) {
        if (read.config.label === 'older') {
          oldWriteStarted.resolve()
          await oldWriteGate.promise
        }
        await cache.put(user, graph, read)
      },
    }
    const { store, requests } = fixture(offlineStorage)
    const older = store.refresh()
    requests[0].resolve(body('older'))
    await oldWriteStarted.promise
    const newer = store.refresh()
    requests[1].resolve(body('newer'))
    // Give the newer network read a chance to reach persistence while the old
    // write is held. This is local promise ordering, not a timing benchmark.
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    oldWriteGate.resolve()
    await Promise.all([older, newer])
    expect(store.getState().read?.config.label).toBe('newer')
    expect((await cache.get('user-a', 'refresh-ordering'))?.config.label).toBe('newer')
  })

  it('a stale invalid-cache deletion cannot erase or publish over a newer successful read', async () => {
    const cache = new MemoryCellConfigReadStorage()
    const deleteStarted = deferred<void>()
    const deleteGate = deferred<void>()
    const offlineStorage: CellConfigReadStorage = {
      get: (user, graph) => cache.get(user, graph),
      put: (user, graph, read) => cache.put(user, graph, read),
      async delete(user, graph) {
        deleteStarted.resolve()
        await deleteGate.promise
        await cache.delete(user, graph)
      },
    }
    const { store, requests } = fixture(offlineStorage)
    const first = store.refresh()
    requests[0].resolve(body('seed'))
    await first
    const cached = (await cache.get('user-a', 'refresh-ordering'))!
    const regionId = Object.keys(cached.config.regions)[0]
    const invalid = {
      ...cached,
      config: {
        ...cached.config,
        regions: {
          ...cached.config.regions,
          [regionId]: { ...cached.config.regions[regionId], childRegion: regionId },
        },
      },
    }
    expect(validateConfig(invalid.config).ok).toBe(false)
    await cache.put('user-a', 'refresh-ordering', invalid)

    const older = store.refresh()
    requests[1].reject(new TypeError('older network failure'))
    await deleteStarted.promise
    const newer = store.refresh()
    requests[2].resolve(body('newer'))
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    deleteGate.resolve()
    await Promise.all([older, newer])

    expect(store.getState()).toMatchObject({ status: 'ready', error: null })
    expect(store.getState().read?.config.label).toBe('newer')
    expect(store.getState().read?.activationSource).toBe('live')
    expect((await cache.get('user-a', 'refresh-ordering'))?.config.label).toBe('newer')
  })
})
