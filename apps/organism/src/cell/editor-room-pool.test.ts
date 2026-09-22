import { describe, expect, it } from 'vitest'
import type { CrdtRoom, ProviderHandle } from '@shrubbery/nucleus'
import { synchronizedCrdtProviderLifecycle } from '@shrubbery/nucleus'
import { EditorRoomPool, editorRoomKey } from './editor-room-pool.js'

interface FakeProvider extends ProviderHandle {
  readonly name: string
  destroyCount: number
}

function backend(options: { throwFor?: string } = {}) {
  const opened: Array<{ room: CrdtRoom; provider: FakeProvider }> = []
  return {
    opened,
    open(room: CrdtRoom): ProviderHandle {
      if (room.docId === options.throwFor) throw new Error(`cannot open ${room.docId}`)
      const provider: FakeProvider = {
        name: room.docId ?? room.graphId,
        doc: { room },
        awareness: { room },
        lifecycle: synchronizedCrdtProviderLifecycle(),
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
