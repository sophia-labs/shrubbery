import { describe, expect, it, vi } from 'vitest'
import type { CrdtRoom, ProviderHandle } from '@shrubbery/nucleus'
import { synchronizedCrdtProviderLifecycle } from '@shrubbery/nucleus'
import { EditorRoomPool, editorRoomKey } from './editor-room-pool.js'
import { UNSYNCED_ROOM_LINGER_MS } from '@shrubbery/runtime'
import { createCrdtProviderLifecycle } from './crdt-provider-lifecycle.js'

interface FakeProvider extends ProviderHandle {
  readonly name: string
  destroyCount: number
}

function backend(options: { throwFor?: string; unsynced?: boolean } = {}) {
  const opened: Array<{ room: CrdtRoom; provider: FakeProvider }> = []
  const lifecycles: Array<ReturnType<typeof createCrdtProviderLifecycle>> = []
  return {
    opened,
    lifecycles,
    open(room: CrdtRoom): ProviderHandle {
      if (room.docId === options.throwFor) throw new Error(`cannot open ${room.docId}`)
      if (options.unsynced) lifecycles.push(createCrdtProviderLifecycle({ connection: 'connecting', synchronized: false, shouldConnect: true }))
      const provider: FakeProvider = {
        name: room.docId ?? room.graphId,
        doc: { room },
        awareness: { room },
        lifecycle: options.unsynced
          ? lifecycles.at(-1)!.source
          : synchronizedCrdtProviderLifecycle(),
        whenRenderable: Promise.resolve(),
        whenEditable: Promise.resolve(),
        whenSynced: Promise.resolve(),
        renderSource: Promise.resolve('live'),
        destroyCount: 0,
        destroy() { provider.destroyCount++ },
      }
      opened.push({ room, provider })
      return provider
    },
  }
}

const docRoom = (docId: string): CrdtRoom => ({ kind: 'doc', graphId: 'graph', docId })

describe('EditorRoomPool', () => {
  it('opens one provider for two pane attachments to the same room', () => {
    const factory = backend()
    const pool = new EditorRoomPool(factory)
    const primary = pool.acquire(docRoom('shared'), 'center-primary::graph::shared')
    const secondary = pool.acquire(docRoom('shared'), 'center-secondary::graph::shared')

    expect(factory.opened).toHaveLength(1)
    expect(primary.provider).toBe(secondary.provider)
    expect(pool.snapshot()).toEqual({
      roomCount: 1,
      attachmentCount: 2,
      rooms: [{
        roomKey: editorRoomKey(docRoom('shared')),
        kind: 'doc',
        graphId: 'graph',
        documentId: 'shared',
        refCount: 2,
        attachmentIds: [
          'center-primary::graph::shared',
          'center-secondary::graph::shared',
        ],
      }],
    })
  })

  it('keeps distinct document workloads independent', () => {
    const factory = backend()
    const pool = new EditorRoomPool(factory)
    const alpha = pool.acquire(docRoom('alpha'), 'primary-alpha')
    const beta = pool.acquire(docRoom('beta'), 'secondary-beta')

    expect(factory.opened).toHaveLength(2)
    expect(alpha.provider).not.toBe(beta.provider)
    expect(pool.snapshot()).toMatchObject({ roomCount: 2, attachmentCount: 2 })
  })

  it('destroys only after the last attachment and makes release idempotent', () => {
    const factory = backend()
    const pool = new EditorRoomPool(factory)
    const primary = pool.acquire(docRoom('shared'), 'primary')
    const secondary = pool.acquire(docRoom('shared'), 'secondary')
    const provider = primary.provider as FakeProvider

    primary.release()
    primary.release()
    expect(primary.released).toBe(true)
    expect(provider.destroyCount).toBe(0)
    expect(pool.snapshot()).toMatchObject({ roomCount: 1, attachmentCount: 1 })

    secondary.release()
    secondary.release()
    expect(provider.destroyCount).toBe(1)
    expect(pool.snapshot()).toEqual({ roomCount: 0, attachmentCount: 0, rooms: [] })
  })

  it('keeps a released room that never synced until its first sync (WB-DROP)', () => {
    const factory = backend({ unsynced: true })
    const pool = new EditorRoomPool(factory)
    const lease = pool.acquire(docRoom('board'), 'whiteboard::graph::board::1')
    const provider = lease.provider as FakeProvider

    lease.release()
    expect(provider.destroyCount).toBe(0)
    expect(pool.snapshot()).toMatchObject({ roomCount: 1, attachmentCount: 0 })

    factory.lifecycles[0]!.set({ connection: 'connected', synchronized: true, shouldConnect: true })
    expect(provider.destroyCount).toBe(1)
    expect(pool.snapshot()).toEqual({ roomCount: 0, attachmentCount: 0, rooms: [] })
  })

  it('hands a lingering room back, same provider, to the next acquire', () => {
    const factory = backend({ unsynced: true })
    const pool = new EditorRoomPool(factory)
    const first = pool.acquire(docRoom('board'), 'whiteboard::graph::board::1')
    first.release()
    const again = pool.acquire(docRoom('board'), 'whiteboard::graph::board::2')

    expect(factory.opened).toHaveLength(1)
    expect(again.provider).toBe(first.provider)
    // Synced while held again: nothing is destroyed until that lease goes too.
    factory.lifecycles[0]!.set({ connection: 'connected', synchronized: true, shouldConnect: true })
    expect((again.provider as FakeProvider).destroyCount).toBe(0)
    again.release()
    expect((again.provider as FakeProvider).destroyCount).toBe(1)
  })

  it('lets an unsynced room go after the linger bound', () => {
    vi.useFakeTimers()
    try {
      const factory = backend({ unsynced: true })
      const pool = new EditorRoomPool(factory)
      const lease = pool.acquire(docRoom('board'), 'whiteboard::graph::board::1')
      lease.release()
      vi.advanceTimersByTime(UNSYNCED_ROOM_LINGER_MS - 1)
      expect((lease.provider as FakeProvider).destroyCount).toBe(0)
      vi.advanceTimersByTime(1)
      expect((lease.provider as FakeProvider).destroyCount).toBe(1)
      // A late sync after the bound changes nothing.
      factory.lifecycles[0]!.set({ connection: 'connected', synchronized: true, shouldConnect: true })
      expect((lease.provider as FakeProvider).destroyCount).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('destroys a lingering room once on contract replacement', () => {
    const factory = backend({ unsynced: true })
    const pool = new EditorRoomPool(factory)
    const lease = pool.acquire(docRoom('board'), 'whiteboard::graph::board::1')
    lease.release()
    pool.destroyAll()
    factory.lifecycles[0]!.set({ connection: 'connected', synchronized: true, shouldConnect: true })
    expect((lease.provider as FakeProvider).destroyCount).toBe(1)
  })

  it('rejects a second live lease with the same attachment identity', () => {
    const pool = new EditorRoomPool(backend())
    pool.acquire(docRoom('alpha'), 'center-primary')
    expect(() => pool.acquire(docRoom('alpha'), 'center-primary')).toThrow(/already live/)
    expect(() => pool.acquire(docRoom('beta'), 'center-primary')).toThrow(/already live/)
  })

  it('destroys every provider once and invalidates leases on contract replacement', () => {
    const factory = backend()
    const pool = new EditorRoomPool(factory)
    const alpha = pool.acquire(docRoom('alpha'), 'primary')
    const beta = pool.acquire(docRoom('beta'), 'secondary')

    pool.destroyAll()
    expect(alpha.released).toBe(true)
    expect(beta.released).toBe(true)
    expect(factory.opened.map(item => item.provider.destroyCount)).toEqual([1, 1])
    expect(pool.snapshot()).toEqual({ roomCount: 0, attachmentCount: 0, rooms: [] })

    alpha.release()
    beta.release()
    expect(factory.opened.map(item => item.provider.destroyCount)).toEqual([1, 1])
  })

  it('does not retain phantom state when the backend open fails', () => {
    const pool = new EditorRoomPool(backend({ throwFor: 'broken' }))
    expect(() => pool.acquire(docRoom('broken'), 'primary')).toThrow('cannot open broken')
    expect(pool.snapshot()).toEqual({ roomCount: 0, attachmentCount: 0, rooms: [] })
  })

  it('uses collision-safe room keys and validates incomplete identities', () => {
    expect(editorRoomKey({ kind: 'doc', graphId: 'a:b', docId: 'c' }))
      .not.toBe(editorRoomKey({ kind: 'doc', graphId: 'a', docId: 'b:c' }))
    expect(() => editorRoomKey({ kind: 'doc', graphId: 'graph' })).toThrow(/requires a docId/)
  })
})
