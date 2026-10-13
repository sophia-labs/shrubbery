// @vitest-environment node
/**
 * The shell the reducer tests drive is a real (small) store, and its failures have to be real: a batch that cannot be applied is
 * refused whole, with a reason, and leaves the store as it was. Without that, an undo that did nothing would be announced as done.
 */
import { describe, expect, it } from 'vitest'
import { connection } from './support/fixtures.js'
import { ShellSim } from './support/shell-sim.js'

function sim() {
  const s = new ShellSim()
  s.addFile('a', { x: 16, y: 16 }); s.addFile('b', { x: 176, y: 16 }); s.addFile('F', { folder: true, x: 16, y: 176 })
  return s
}

describe('ShellSim: refusals are real', () => {
  it('refuses an undo whose connection is no longer there, says why, and keeps the entry', () => {
    const s = sim()
    s.apply({ kind: 'connect', source: s.refOf('a'), target: s.refOf('b'), relation: 'rel:explains' })
    expect(s.connections).toHaveLength(1)
    s.connections = []
    s.apply({ kind: 'undo' })
    expect(s.messages.at(-1)).toBe('Can\'t undo: That connection is gone.')
    expect(s.journal.canUndo).toBe(true)
    expect(s.journal.canRedo).toBe(false)
  })

  it('refuses a forward disconnect of a connection that is not there, out loud, and journals nothing', () => {
    const s = sim()
    s.apply({ kind: 'disconnect', connectionId: 'nobody' })
    expect(s.messages.at(-1)).toBe('That connection is gone.')
    expect(s.journal.canUndo).toBe(false)
  })

  it('refuses a batch whole: what an earlier intent of it did is put back, and no message is spoken for the part', () => {
    const s = sim()
    s.apply({ kind: 'remove', files: [s.refOf('a')] })
    const spoken = s.messages.length
    const result = s.applyBatch([{ kind: 'restore', files: [s.refOf('a')] }, { kind: 'disconnect', connectionId: 'nobody' }])
    expect(result).toEqual({ ok: false, reason: 'That connection is gone.' })
    expect(s.isRemoved('a')).toBe(true)
    expect(s.messages).toHaveLength(spoken)
  })

  it('puts back a rename, a move and a placement too when a later intent of the batch is refused', () => {
    const s = sim()
    const before = { label: s.labelOf('a'), parent: s.parentOf('a'), at: s.placementOf('a') }
    const result = s.applyBatch([
      { kind: 'rename', file: s.refOf('a'), name: 'Renamed.pdf' },
      { kind: 'move', files: [s.refOf('a')], folder: s.refOf('F', true) },
      { kind: 'disconnect', connectionId: 'nobody' },
    ])
    expect(result.ok).toBe(false)
    expect({ label: s.labelOf('a'), parent: s.parentOf('a'), at: s.placementOf('a') }).toEqual(before)
    expect(s.naming).toBeNull()
  })

  it('refuses what only the applying can show: a rename that clashes with an earlier rename of the same batch, and puts the first back', () => {
    const s = sim()
    const result = s.applyBatch([{ kind: 'rename', file: s.refOf('a'), name: 'Same.pdf' }, { kind: 'rename', file: s.refOf('b'), name: 'Same.pdf' }])
    expect(result).toEqual({ ok: false, reason: '“Same.pdf” already exists here.' })
    expect([s.labelOf('a'), s.labelOf('b')]).toEqual(['a.pdf', 'b.pdf'])
    expect(s.naming).toBeNull()
  })

  it('restores a connection whole by id, and refuses to restore one whose id is taken or whose card has gone', () => {
    const s = sim()
    const kept = { ...connection('c1', s.refOf('a'), s.refOf('b'), 'explains'), state: 'endorsed' as const, attribution: 'Eschaton' }
    expect(s.applyBatch([{ kind: 'restore-connection', connection: kept }])).toEqual({ ok: true })
    expect(s.connections).toEqual([kept])
    expect(s.applyBatch([{ kind: 'restore-connection', connection: kept }]).ok).toBe(false)
    expect(s.connections).toEqual([kept])
    s.connections = []
    s.files.get(s.keyOf('b'))!.removed = true
    expect(s.applyBatch([{ kind: 'restore-connection', connection: kept }]).ok).toBe(false)
    expect(s.connections).toEqual([])
  })

  it('clears the whole selection after a successful move, including a selected card that stayed behind', () => {
    const s = sim()
    s.addFile('locked', { x: 336, y: 16 })
    s.selection = [s.keyOf('a'), s.keyOf('locked')]
    s.apply({ kind: 'move', files: [s.refOf('a')], folder: s.refOf('F', true) })
    expect(s.parentOf('a')).toBe(s.keyOf('F', true))
    expect(s.selection).toEqual([])
    expect(s.messages.at(-1)).toBe('Moved a.pdf to F')
  })

  it('leaves the selection alone when a move is refused', () => {
    const s = sim()
    s.selection = [s.keyOf('a')]
    s.files.get(s.keyOf('F', true))!.removed = true
    s.apply({ kind: 'move', files: [s.refOf('a')], folder: s.refOf('F', true) })
    expect(s.selection).toEqual([s.keyOf('a')])
    expect(s.messages.at(-1)).toMatch(/gone/)
  })
})
