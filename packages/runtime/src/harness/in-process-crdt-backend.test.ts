import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { InProcessCrdtBackend } from './in-process-crdt-backend.js'

describe('InProcessCrdtBackend', () => {
  it('opens real, shared room authority with real local awareness', async () => {
    const backend = new InProcessCrdtBackend({ userId: 'browser-user', presenceColor: '#123456' })
    const room = { kind: 'doc' as const, graphId: 'g', docId: 'a' }
    const first = backend.open(room)
    const second = backend.open(room)

    expect(first.doc).toBeInstanceOf(Y.Doc)
    expect(second.doc).toBe(first.doc)
    await expect(first.whenSynced).resolves.toBeUndefined()
    expect((first.awareness as { getLocalState(): unknown }).getLocalState()).toMatchObject({
      user: { name: 'browser-user', color: '#123456' },
    })

    ;(first.doc as Y.Doc).getMap('probe').set('value', 42)
    expect((second.doc as Y.Doc).getMap('probe').get('value')).toBe(42)

    first.destroy()
    second.destroy()
    backend.destroyAll()
  })

  it('keeps different rooms isolated and validates document room ids', () => {
    const backend = new InProcessCrdtBackend()
    const a = backend.open({ kind: 'doc', graphId: 'g', docId: 'a' })
    const b = backend.open({ kind: 'doc', graphId: 'g', docId: 'b' })
    expect(a.doc).not.toBe(b.doc)
    expect(backend.roomCount()).toBe(2)
    expect(() => backend.open({ kind: 'doc', graphId: 'g' })).toThrow('requires a docId')
    backend.destroyAll()
  })
})
