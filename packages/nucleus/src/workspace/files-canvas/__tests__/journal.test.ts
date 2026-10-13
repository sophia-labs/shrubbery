// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fileKey, type FilePlacementRecord, type FileCanvasIntent } from '../../folder-view-contract.js'
import { IntentJournal, invert, isEdit, type Applier, type JournalIntent, type PriorState } from '../journal.js'
import { connection, file, folder, placement, scope } from './support/fixtures.js'

const a = file('a'), b = file('b'), F = folder('F'), G = folder('G')
const ok: Applier = () => ({ ok: true })

describe('invert: the intent that undoes each edit', () => {
  it('place goes back to the previous records, and cannot be undone without them', () => {
    const forward: FileCanvasIntent = { kind: 'place', placements: [placement(a, 300, 300), placement(b, 400, 300)] }
    const before = new Map<string, FilePlacementRecord>([[fileKey(a), placement(a, 16, 16)], [fileKey(b), placement(b, 176, 16)]])
    expect(invert(forward, { placements: before })).toEqual({ inverse: [{ kind: 'place', placements: [placement(a, 16, 16), placement(b, 176, 16)] }], redo: [forward] })
    expect(invert(forward, { placements: new Map([[fileKey(a), placement(a, 16, 16)]]) })).toBeNull()
    expect(invert(forward, {})).toBeNull()
  })

  it('move goes back to each previous parent, as one batch per parent', () => {
    const forward: FileCanvasIntent = { kind: 'move', files: [a, b], folder: F }
    const same = invert(forward, { parents: new Map([[fileKey(a), null], [fileKey(b), null]]) })!
    expect(same.inverse).toEqual([{ kind: 'move', files: [a, b], folder: null }])
    const split = invert(forward, { parents: new Map([[fileKey(a), null], [fileKey(b), G]]) })!
    expect(split.inverse).toEqual([{ kind: 'move', files: [a], folder: null }, { kind: 'move', files: [b], folder: G }])
    expect(split.redo).toEqual([forward])
    expect(invert(forward, { parents: new Map([[fileKey(a), null]]) })).toBeNull()
  })

  it('rename goes back to the previous name', () => {
    const forward: FileCanvasIntent = { kind: 'rename', file: a, name: 'Quote.pdf' }
    expect(invert(forward, { names: new Map([[fileKey(a), 'a.pdf']]) })!.inverse).toEqual([{ kind: 'rename', file: a, name: 'a.pdf' }])
    expect(invert(forward, {})).toBeNull()
  })

  it('create is undone by removing the folder it made, and redone by restoring it, not by making a second one', () => {
    const forward: FileCanvasIntent = { kind: 'create', objectKind: 'folder', parent: null, name: 'Quotes', placement: { x: 0, y: 0 }, draftId: 'd' }
    expect(invert(forward, { created: F })).toEqual({ inverse: [{ kind: 'remove', files: [F] }], redo: [{ kind: 'restore', files: [F] }] })
    expect(invert(forward, {})).toBeNull()
  })

  it('add is undone by removing what it imported, and redone by restoring it', () => {
    const forward: FileCanvasIntent = { kind: 'add', files: [], folder: null }
    expect(invert(forward, { added: [a, b] })).toEqual({ inverse: [{ kind: 'remove', files: [a, b] }], redo: [{ kind: 'restore', files: [a, b] }] })
    expect(invert(forward, { added: [] })).toBeNull()
  })

  it('remove is undone by restoring', () => {
    expect(invert({ kind: 'remove', files: [a] }, {})).toEqual({ inverse: [{ kind: 'restore', files: [a] }], redo: [{ kind: 'remove', files: [a] }] })
  })

  it('connect is undone by disconnecting the connection it made, by id, and redone by restoring that very connection, not by making a second one', () => {
    const connect: FileCanvasIntent = { kind: 'connect', source: a, target: b, relation: 'rel:explains' }
    const made = { ...connection('conn-1', a, b, 'explains'), attribution: 'vera' }
    expect(invert(connect, { connection: made })).toEqual({
      inverse: [{ kind: 'disconnect', connectionId: 'conn-1' }],
      redo: [{ kind: 'restore-connection', connection: made }],
    })
    expect(invert(connect, {})).toBeNull()
  })

  it('disconnect is undone by restoring the connection whole: its id, its state, who proposed it', () => {
    const removed = { ...connection('c9', a, b, 'contradicts'), state: 'endorsed' as const, attribution: 'Eschaton' }
    expect(invert({ kind: 'disconnect', connectionId: 'c9' }, { connection: removed })).toEqual({
      inverse: [{ kind: 'restore-connection', connection: removed }],
      redo: [{ kind: 'disconnect', connectionId: 'c9' }],
    })
    expect(invert({ kind: 'disconnect', connectionId: 'someone-else' }, { connection: removed })).toBeNull()
    expect(invert({ kind: 'disconnect', connectionId: 'c9' }, {})).toBeNull()
  })

  it('a connection survives connect, undo, redo, undo, redo with one id: the inverse never goes stale', () => {
    // The journal alone, with a store that keeps connections by id and refuses what is not there.
    const store = new Map<string, ReturnType<typeof connection>>()
    const apply: Applier = (batch) => {
      for (const i of batch) {
        if (i.kind === 'disconnect') { if (!store.delete(i.connectionId)) return { ok: false, reason: `${i.connectionId} is gone` } }
        else if (i.kind === 'restore-connection') { if (store.has(i.connection.id)) return { ok: false, reason: 'exists' }; store.set(i.connection.id, i.connection) }
        else return { ok: false, reason: `unexpected ${i.kind}` }
      }
      return { ok: true }
    }
    const made = { ...connection('conn-1', a, b, 'explains'), attribution: 'vera' }
    store.set(made.id, made)
    const inversion = invert({ kind: 'connect', source: a, target: b, relation: 'rel:explains' }, { connection: made })!
    const j = new IntentJournal()
    j.record({ label: 'Connected', forward: { kind: 'connect', source: a, target: b, relation: 'rel:explains' }, inverse: inversion.inverse, redo: inversion.redo })
    for (let round = 0; round < 3; round++) {
      expect(j.undo(apply)).toEqual({ status: 'applied', label: 'Connected' })
      expect([...store.keys()]).toEqual([])
      expect(j.redo(apply)).toEqual({ status: 'applied', label: 'Connected' })
      expect([...store.values()]).toEqual([made])
    }
  })

  it('choose-placement settles a contest and is not undoable; nothing else is journaled at all', () => {
    expect(invert({ kind: 'choose-placement', file: a, candidateId: 'x' }, {})).toBeNull()
    for (const intent of [{ kind: 'select', files: [] }, { kind: 'open', file: a }, { kind: 'menu', files: [], clientX: 0, clientY: 0 }, { kind: 'name-cancel' },
      { kind: 'new-folder', placement: { x: 0, y: 0 } }, { kind: 'undo' }, { kind: 'redo' }] as FileCanvasIntent[]) {
      expect(isEdit(intent), intent.kind).toBe(false)
      expect(invert(intent, {})).toBeNull()
    }
    for (const kind of ['place', 'move', 'rename', 'create', 'add', 'remove', 'connect', 'disconnect', 'choose-placement']) {
      expect(isEdit({ kind } as FileCanvasIntent), kind).toBe(true)
    }
    expect(scope.ownerId).toBe('owner')
  })
})

describe('the one edit without an inverse', () => {
  it('choosing a contested placement is the deliberate exception: every other edit can be undone given what the shell knew before', () => {
    const made = connection('c1', a, b)
    const prior: PriorState = {
      placements: new Map([[fileKey(a), placement(a, 16, 16)]]), parents: new Map([[fileKey(a), null]]), names: new Map([[fileKey(a), 'a.pdf']]),
      created: F, added: [b], connection: made,
    }
    const edits: FileCanvasIntent[] = [
      { kind: 'place', placements: [placement(a, 300, 300)] }, { kind: 'move', files: [a], folder: F }, { kind: 'rename', file: a, name: 'x.pdf' },
      { kind: 'create', objectKind: 'folder', parent: null, name: 'Quotes', placement: { x: 0, y: 0 }, draftId: 'd' }, { kind: 'add', files: [], folder: null },
      { kind: 'remove', files: [a] }, { kind: 'connect', source: a, target: b, relation: 'rel:explains' }, { kind: 'disconnect', connectionId: 'c1' },
    ]
    for (const edit of edits) expect(invert(edit, prior), edit.kind).not.toBeNull()
    expect(invert({ kind: 'choose-placement', file: a, candidateId: 'x' }, prior)).toBeNull()
    // And the edit kinds are exactly these nine: a new edit kind must decide, here, whether it has an inverse.
    expect(['place', 'move', 'rename', 'create', 'add', 'remove', 'connect', 'disconnect', 'choose-placement'].every((k) => isEdit({ kind: k } as FileCanvasIntent))).toBe(true)
  })
})

describe('IntentJournal: undo and redo', () => {
  const entry = (label: string, n = 1) => ({ label, forward: { kind: 'remove', files: [file(`f${n}`)] } as JournalIntent, inverse: [{ kind: 'restore', files: [file(`f${n}`)] }] as JournalIntent[] })

  it('undoes the latest change first and redoes in the opposite order', () => {
    const j = new IntentJournal()
    const applied: JournalIntent[][] = []
    const apply: Applier = (batch) => { applied.push([...batch]); return { ok: true } }
    j.record(entry('one', 1)); j.record(entry('two', 2))
    expect(j.undo(apply)).toEqual({ status: 'applied', label: 'two' })
    expect(j.undo(apply)).toEqual({ status: 'applied', label: 'one' })
    expect(j.undo(apply)).toEqual({ status: 'nothing' })
    expect(j.redo(apply)).toEqual({ status: 'applied', label: 'one' })
    expect(j.redo(apply)).toEqual({ status: 'applied', label: 'two' })
    expect(j.redo(apply)).toEqual({ status: 'nothing' })
    expect(applied.map((b) => b[0]!.kind)).toEqual(['restore', 'restore', 'remove', 'remove'])
  })

  it('a new change ends the redo side', () => {
    const j = new IntentJournal()
    j.record(entry('one')); j.undo(ok)
    expect(j.canRedo).toBe(true)
    j.record(entry('two', 2))
    expect(j.canRedo).toBe(false)
    expect(j.redo(ok)).toEqual({ status: 'nothing' })
  })

  it('hands back the whole inverse as one batch for the shell to apply whole or not at all', () => {
    const j = new IntentJournal()
    const batch: JournalIntent[] = [{ kind: 'move', files: [a], folder: null }, { kind: 'move', files: [b], folder: G }]
    j.record({ label: 'Moved 2 files', forward: { kind: 'move', files: [a, b], folder: F }, inverse: batch })
    let seen: readonly JournalIntent[] = []
    j.undo((x) => { seen = x; return { ok: true } })
    expect(seen).toEqual(batch)
  })

  it('reports a refused inverse honestly and changes nothing: the entry stays where it was', () => {
    const j = new IntentJournal()
    j.record(entry('Moved BOM.pdf'))
    const refused = j.undo(() => ({ ok: false, reason: 'BOM.pdf has moved since.' }))
    expect(refused).toEqual({ status: 'refused', label: 'Moved BOM.pdf', reason: 'BOM.pdf has moved since.' })
    expect(j.canUndo).toBe(true)
    expect(j.canRedo).toBe(false)
    expect(j.undo(ok)).toEqual({ status: 'applied', label: 'Moved BOM.pdf' })
    expect(j.redo(() => ({ ok: false, reason: 'No.' }))).toEqual({ status: 'refused', label: 'Moved BOM.pdf', reason: 'No.' })
    expect(j.canRedo).toBe(true)
  })

  it('holds an irreversible change as a barrier: Undo says so and does not reach past it', () => {
    const j = new IntentJournal()
    j.record(entry('before'))
    j.record({ label: 'Position kept', forward: { kind: 'choose-placement', file: a, candidateId: 'x' }, inverse: null })
    expect(j.undo(ok)).toEqual({ status: 'irreversible', label: 'Position kept' })
    expect(j.undo(ok)).toEqual({ status: 'irreversible', label: 'Position kept' })
    expect(j.size).toBe(2)
    j.record(entry('after', 3))
    expect(j.undo(ok)).toEqual({ status: 'applied', label: 'after' })
    expect(j.undo(ok)).toEqual({ status: 'irreversible', label: 'Position kept' })
  })

  it('uses the redo the entry carries, which is not always the forward intent', () => {
    const j = new IntentJournal()
    const create: FileCanvasIntent = { kind: 'create', objectKind: 'folder', parent: null, name: 'Quotes', placement: { x: 0, y: 0 }, draftId: 'd' }
    const inversion = invert(create, { created: F })!
    j.record({ label: 'Created Quotes', forward: create, inverse: inversion.inverse, redo: inversion.redo })
    j.undo(ok)
    let redone: readonly JournalIntent[] = []
    j.redo((x) => { redone = x; return { ok: true } })
    expect(redone).toEqual([{ kind: 'restore', files: [F] }])
  })

  it('keeps a bounded memory: the oldest change is forgotten first', () => {
    const j = new IntentJournal(3)
    for (let i = 0; i < 5; i++) j.record(entry(`c${i}`, i))
    expect(j.size).toBe(3)
    const labels: string[] = []
    while (j.canUndo) { const o = j.undo(ok); if (o.status === 'applied') labels.push(o.label) }
    expect(labels).toEqual(['c4', 'c3', 'c2'])
  })
})
