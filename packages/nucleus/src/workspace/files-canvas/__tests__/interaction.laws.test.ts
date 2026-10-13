// @vitest-environment node
/**
 * The eight laws of section 3.3 of the design, and the laws of the review's section 3, as invariants over
 * event sequences. Each test is a gesture a person could make, driven through the reducer against a real
 * (small) shell, and asserted both as what the canvas emitted and as what the shell then holds.
 */
import { describe, expect, it } from 'vitest'
import { fileKey, type FileCanvasCapabilities, type WorkspaceFileRef } from '../../folder-view-contract.js'
import { menuVerbs, type CanvasEvent } from '../interaction.js'
import { CARD_METRICS } from '../scene.js'
import { ALL_CAPS, NO_CAPS, capsExcept } from './support/fixtures.js'
import { ALT, Harness, MOD, SHIFT, mods } from './support/harness.js'
import { ShellSim } from './support/shell-sim.js'

const M = CARD_METRICS.medium

/** Five cards: three files in a row, a folder and a file below. Names: a.pdf b.pdf c.pdf, Datasheets, d.pdf. */
function view(configure?: (sim: ShellSim) => void, opts: { viewed?: string } = {}): Harness {
  const sim = new ShellSim()
  sim.addFile('a', { x: 16, y: 16 })
  sim.addFile('b', { x: 176, y: 16 })
  sim.addFile('c', { x: 336, y: 16 })
  sim.addFile('F', { folder: true, label: 'Datasheets', x: 16, y: 176 })
  sim.addFile('d', { x: 176, y: 176 })
  if (opts.viewed) sim.viewed = fileKey(sim.refOf(opts.viewed, true))
  configure?.(sim)
  return new Harness({ sim })
}
const rects = (h: Harness) => new Map(h.scene().cards.map((c) => [c.key, c.rect]))

describe('Law 1: a drag onto a folder is one move, onto empty space is an arrange, a cancel is nothing', () => {
  it('ending on a folder emits exactly one move and no place', () => {
    const h = view()
    h.dragOnto('a', 'F')
    expect(h.intents.filter((i) => i.kind !== 'select')).toEqual([{ kind: 'move', files: [h.sim.refOf('a')], folder: h.sim.refOf('F', true) }])
    expect(h.sim.parentOf('a')).toBe(h.keyOf('F', true))
    expect(h.sim.messages.at(-1)).toBe('Moved a.pdf to Datasheets')
    expect(h.mode).toBe('idle')
    expect(h.effectsOf('endDrag')).toEqual([{ kind: 'endDrag', outcome: 'committed' }])
  })

  it('highlights the folder under the pointer while the drag is still in flight', () => {
    const h = view()
    h.drag('a', h.at('F', true), { release: false })
    expect(h.state.mode).toMatchObject({ kind: 'dragging', files: [h.keyOf('a')], dropTarget: h.keyOf('F', true) })
    h.move(h.empty())
    expect(h.state.mode).toMatchObject({ kind: 'dragging', dropTarget: null })
  })

  it('ending on empty space emits place for exactly the moved set and nothing else', () => {
    const h = view()
    h.drag('a', h.empty(700, 500))
    const places = h.intentsOf('place')
    expect(places).toHaveLength(1)
    expect(places[0]!.placements).toHaveLength(1)
    expect(places[0]!.placements[0]).toMatchObject({ file: h.sim.refOf('a'), coordinateSpace: 'folder-canvas', schemaVersion: 1 })
    expect(h.intents.filter((i) => i.kind !== 'select' && i.kind !== 'place')).toEqual([])
    expect(h.sim.parentOf('a')).toBeNull()
    expect(h.sim.placementOf('a')).toBeDefined()
    expect(h.effectsOf('endDrag')).toEqual([{ kind: 'endDrag', outcome: 'committed' }])
  })

  it('moves the whole selection together, each card by the same delta, one record per file', () => {
    const h = view()
    h.click('a'); h.click('b', { mods: MOD })
    h.mark()
    const before = rects(h)
    h.drag('a', { x: h.at('a').x + 300, y: h.at('a').y + 400 })
    const place = h.intentsOf('place')[0]!
    expect(place.placements.map((p) => p.file.id).sort()).toEqual(['a', 'b'])
    const delta = (id: string) => ({ x: place.placements.find((p) => p.file.id === id)!.x - before.get(h.keyOf(id))!.x, y: place.placements.find((p) => p.file.id === id)!.y - before.get(h.keyOf(id))!.y })
    expect(delta('a')).toEqual(delta('b'))
    expect(h.intents.filter((i) => i.kind === 'move')).toEqual([])
  })

  it('treats a file card as empty space: dropping onto a file never moves into it', () => {
    const h = view()
    h.dragOnto('a', 'd', { ontoFolder: false })
    expect(h.intentsOf('move')).toEqual([])
    expect(h.intentsOf('place')).toHaveLength(1)
  })

  it('a pointercancel emits nothing, restores positions, and leaves the shell untouched', () => {
    const h = view()
    const before = rects(h)
    h.drag('a', h.empty(700, 500), { release: false })
    expect(h.mode).toBe('dragging')
    h.mark()
    h.cancel()
    expect(h.intents).toEqual([])
    expect(h.mode).toBe('idle')
    expect(h.effectsOf('endDrag')).toEqual([{ kind: 'endDrag', outcome: 'cancelled' }])
    expect(h.effectsOf('releasePointer')).toHaveLength(1)
    expect(rects(h)).toEqual(before)
    expect(h.intentsOf('place')).toEqual([])
  })

  it('Escape cancels a drag the same way', () => {
    const h = view()
    h.drag('a', h.empty(700, 500), { release: false })
    h.mark()
    h.key('Escape')
    expect(h.intents).toEqual([])
    expect(h.mode).toBe('idle')
    expect(h.effectsOf('endDrag')).toEqual([{ kind: 'endDrag', outcome: 'cancelled' }])
  })

  it('a drag that ends where it began writes nothing', () => {
    const h = view()
    h.drag('a', h.at('a'), { release: false })
    h.move({ x: h.at('a').x + 40, y: h.at('a').y + 40 })
    h.up(h.at('a'))
    expect(h.intentsOf('place')).toEqual([])
    expect(h.effectsOf('endDrag').at(-1)).toEqual({ kind: 'endDrag', outcome: 'cancelled' })
  })

  it('moves to a folder outside the canvas (a tree row) when the pointer leaves it', () => {
    const h = view()
    const tree = { folder: h.sim.refOf('F', true) }
    h.drag('a', { x: -80, y: 300 }, { external: tree })
    expect(h.intents.filter((i) => i.kind === 'move')).toEqual([{ kind: 'move', files: [h.sim.refOf('a')], folder: tree.folder }])
    expect(h.intentsOf('place')).toEqual([])
  })

  it('releasing outside the canvas over nothing is a cancel, not a place', () => {
    const h = view()
    h.drag('a', { x: -80, y: 300 })
    expect(h.intentsOf('place')).toEqual([])
    expect(h.intentsOf('move')).toEqual([])
    expect(h.effectsOf('endDrag').at(-1)).toEqual({ kind: 'endDrag', outcome: 'cancelled' })
  })

  it('snaps to a neighbour while dragging, and Alt turns the snapping off', () => {
    const h = view()
    // b's left edge is at 176; drag a so its right edge lands 3px short of it.
    const target = { x: h.at('a').x + (176 - 144 - 16) - 3, y: h.at('a').y + 220 }
    h.drag('a', target, { release: false })
    expect(h.dragMode().snapped.guides.length).toBeGreaterThan(0)
    h.move(target, { mods: ALT })
    expect(h.dragMode().snapped.guides).toEqual([])
    expect(h.dragMode().snapped.delta).toEqual({ x: target.x - h.at('a').x, y: target.y - h.at('a').y })
  })

  it('lands on the grid when the folder snaps to it', () => {
    const h = view((sim) => { sim.view = { iconSize: 'medium', snapToGrid: true } })
    h.drag('a', { x: h.at('a').x + 301, y: h.at('a').y + 403 })
    const p = h.intentsOf('place')[0]!.placements[0]!
    expect(p.x % 8).toBe(0)
    expect(p.y % 8).toBe(0)
  })
})

describe('Law 2: rename and create pass through naming, and naming has four doors', () => {
  it('F2 enters naming, the commit emits one rename, and nothing was emitted on the way in', () => {
    const h = view()
    h.click('a'); h.mark()
    h.press('F2')
    expect(h.state.naming).toMatchObject({ target: { kind: 'file', key: h.keyOf('a') }, origin: 'local', initial: 'a.pdf', text: 'a.pdf', error: null })
    expect(h.intents).toEqual([])
    expect(h.effectsOf('focusInput')).toHaveLength(1)
    h.type('Thermal report.pdf')
    h.commit()
    expect(h.intents).toEqual([{ kind: 'rename', file: h.sim.refOf('a'), name: 'Thermal report.pdf' }])
    expect(h.sim.labelOf('a')).toBe('Thermal report.pdf')
    expect(h.state.naming).toBeNull()
  })

  it('Escape in the input emits name-cancel, never a rename', () => {
    const h = view()
    h.click('a'); h.press('F2'); h.type('Something else.pdf')
    h.mark()
    h.escapeInput()
    expect(h.intents).toEqual([{ kind: 'name-cancel' }])
    expect(h.sim.labelOf('a')).toBe('a.pdf')
    expect(h.state.naming).toBeNull()
  })

  it('a commit that changes nothing is a cancel, not a rename', () => {
    const h = view()
    h.click('a'); h.press('F2'); h.mark()
    h.commit()
    expect(h.intents).toEqual([{ kind: 'name-cancel' }])
  })

  it('the name-click rule is a door: a click on the selected card\'s label after a pause', () => {
    const h = view()
    h.click('a')
    h.click('a', { label: true, wait: 900 })
    expect(h.state.naming).toMatchObject({ target: { kind: 'file', key: h.keyOf('a') }, origin: 'local' })
    expect(h.intentsOf('rename')).toEqual([])
  })

  it('the shell\'s session.naming is a door: a draft the shell opened is named in place', () => {
    const h = view()
    h.click('a'); h.mark()
    h.send({ type: 'command', command: 'new-folder' })
    expect(h.intents).toEqual([{ kind: 'new-folder', placement: expect.any(Object) }])
    h.send({ type: 'sync' })
    const draft = h.sim.drafts[0]!
    expect(h.state.naming).toMatchObject({ target: { kind: 'draft', draftId: draft.draftId }, origin: 'shell', initial: 'Untitled folder' })
    expect(h.effectsOf('focusInput')).toHaveLength(1)
    h.type('Datasheets 2')
    h.commit()
    expect(h.intentsOf('create')).toEqual([{ kind: 'create', objectKind: 'folder', parent: null, name: 'Datasheets 2', placement: draft.placement, draftId: draft.draftId }])
  })

  it('no other event enters naming: Enter, double-click, a drag, a context menu, a lone commit', () => {
    const h = view()
    h.click('a'); h.press('Enter')
    expect(h.state.naming).toBeNull()
    h.doubleClick('b'); h.drag('c', h.empty(700, 600)); h.contextMenu({ kind: 'card', key: h.keyOf('d') }, h.at('d'))
    h.send({ type: 'menu-closed' })
    expect(h.state.naming).toBeNull()
    h.mark()
    h.commit('Injected'); h.escapeInput(); h.type('x'); h.send({ type: 'name-commit', text: 'Injected' })
    expect(h.intents.filter((i) => i.kind === 'rename' || i.kind === 'create')).toEqual([])
    expect(h.intents.filter((i) => i.kind === 'name-cancel')).toEqual([])
  })

  it('a failed create keeps the draft and the input; the second try can succeed', () => {
    const h = view()
    h.send({ type: 'command', command: 'new-folder' }); h.send({ type: 'sync' })
    h.type('   ')
    h.commit()
    expect(h.sim.drafts).toHaveLength(1)
    h.send({ type: 'sync' })
    expect(h.state.naming).toMatchObject({ origin: 'shell', error: 'A name is required.', submitted: false })
    h.type('Quotes')
    h.commit()
    expect(h.sim.drafts).toEqual([])
    expect(h.sim.labelOf(h.sim.children().find((f) => f.label === 'Quotes')!.ref.id, true)).toBe('Quotes')
    h.send({ type: 'sync' })
    expect(h.state.naming).toBeNull()
  })

  it('does not emit the commit twice when Enter and the blur it causes both arrive', () => {
    const h = view()
    h.send({ type: 'command', command: 'new-folder' }); h.send({ type: 'sync' })
    h.type('Once')
    h.mark()
    h.commit(); h.commit()
    expect(h.intentsOf('create')).toHaveLength(1)
  })
})

describe('Law 3: while naming, a pointer on another card commits first, and the canvas stays', () => {
  it('commits the rename before the click selects the other card', () => {
    const h = view()
    h.click('a'); h.press('F2'); h.type('Renamed.pdf'); h.mark()
    const cardsBefore = h.scene().cards.length
    h.down({ kind: 'card', key: h.keyOf('b') }, h.at('b'))
    expect(h.intents.map((i) => i.kind)).toEqual(['rename', 'select'])
    expect(h.intents[0]).toEqual({ kind: 'rename', file: h.sim.refOf('a'), name: 'Renamed.pdf' })
    expect(h.sim.labelOf('a')).toBe('Renamed.pdf')
    expect(h.sim.selectionIds).toEqual(['b'])
    expect(h.state.naming).toBeNull()
    expect(h.scene().cards).toHaveLength(cardsBefore)
    expect(h.state.dead).toBe(false)
  })

  it('a click on empty space while naming a draft commits the draft, then clears the selection', () => {
    const h = view()
    h.click('a')
    h.send({ type: 'command', command: 'new-folder' }); h.send({ type: 'sync' })
    h.type('Datasheets 2'); h.mark()
    h.clickBackground()
    expect(h.intents.map((i) => i.kind)).toEqual(['create', 'select'])
    expect(h.sim.selectionIds).toEqual([])
  })

  it('the cards do not move, appear or vanish because a name is being edited', () => {
    const h = view()
    h.click('a')
    const before = rects(h)
    h.press('F2'); h.type('x')
    expect(rects(h)).toEqual(before)
  })
})

describe('Law 4: select is emitted only when the set differs from session.selected', () => {
  it('does not echo: clicking the sole selected card, or the background with nothing selected, says nothing', () => {
    const h = view()
    h.click('a'); h.mark()
    h.click('a')
    expect(h.intentsOf('select')).toEqual([])
    h.click('a', { wait: 300 })
    expect(h.intentsOf('select')).toEqual([])
    h.press('Escape'); h.mark()
    h.clickBackground()
    expect(h.intentsOf('select')).toEqual([])
  })

  it('emits one select per change of the set, in reading order', () => {
    const h = view()
    h.click('b'); h.click('a', { mods: MOD }); h.click('c', { mods: MOD })
    expect(h.intentsOf('select').map((i) => i.files.map((f) => f.id))).toEqual([['b'], ['a', 'b'], ['a', 'b', 'c']])
  })

  it('a marquee emits when the set changes, not on every pointermove or on release', () => {
    const h = view()
    h.marquee({ x: 5, y: 5 }, { x: 330, y: 150 })
    // The sweep reaches a first, then b: two changes in four moves and a release.
    expect(h.intentsOf('select').map((i) => i.files.map((f) => f.id))).toEqual([['a'], ['a', 'b']])
    h.mark()
    h.marquee({ x: 5, y: 5 }, { x: 330, y: 150 }, { mods: SHIFT })
    expect(h.intentsOf('select')).toEqual([])
    h.mark()
    h.marquee({ x: 5, y: 5 }, { x: 500, y: 150 }, { mods: SHIFT })
    expect(h.intentsOf('select').map((i) => i.files.map((f) => f.id))).toEqual([['a', 'b', 'c']])
  })

  it('a press on empty space clears the selection when the click completes, and a cancelled press clears nothing', () => {
    const h = view()
    h.click('a'); h.mark()
    h.down({ kind: 'background' }, h.empty())
    expect(h.intents).toEqual([])
    h.cancel()
    expect(h.intents).toEqual([])
    expect(h.sim.selectionIds).toEqual(['a'])
    h.clickBackground()
    expect(h.intentsOf('select')).toEqual([{ kind: 'select', files: [] }])
  })

  it('Select all twice, Escape twice, and a bare sync are each one change or none', () => {
    const h = view()
    h.press('a', MOD); h.press('a', MOD)
    expect(h.intentsOf('select')).toHaveLength(1)
    expect(h.intentsOf('select')[0]!.files).toHaveLength(5)
    h.mark()
    h.press('Escape'); h.press('Escape'); h.send({ type: 'sync' })
    expect(h.intentsOf('select')).toEqual([{ kind: 'select', files: [] }])
  })
})

describe('Law 5: locked cards cannot be dragged, everything else stays draggable', () => {
  const locked = (state: 'pending' | 'contested') => (sim: ShellSim) => { sim.placementStates = { [fileKey(sim.refOf('a'))]: state } }

  for (const state of ['pending', 'contested'] as const) {
    it(`a ${state} card does not start a drag and writes nothing`, () => {
      const h = view(locked(state))
      h.drag('a', h.empty(700, 500), { release: false })
      expect(h.mode).toBe('pressing')
      h.up(h.empty(700, 500))
      expect(h.intents.filter((i) => i.kind === 'place' || i.kind === 'move')).toEqual([])
      expect(h.sim.placementOf('a')).toEqual({ x: 16, y: 16 })
    })
  }

  it('every other card is still draggable while one is locked', () => {
    const h = view(locked('pending'))
    h.drag('b', h.empty(700, 500))
    expect(h.intentsOf('place').map((p) => p.placements.map((r) => r.file.id))).toEqual([['b']])
  })

  it('a drag set never contains a locked card: the selection is trimmed, and the locked card stays', () => {
    const h = view(locked('pending'))
    h.click('a'); h.click('b', { mods: MOD }); h.click('c', { mods: MOD }); h.mark()
    h.drag('b', h.empty(700, 500), { release: false })
    expect(h.state.mode).toMatchObject({ kind: 'dragging', files: [h.keyOf('b'), h.keyOf('c')] })
    h.up(h.empty(700, 500))
    expect(h.intentsOf('place')[0]!.placements.map((r) => r.file.id)).toEqual(['b', 'c'])
    expect(h.sim.placementOf('a')).toEqual({ x: 16, y: 16 })
  })

  it('a locked card is still selectable, openable and nameable: only its position is frozen', () => {
    const h = view(locked('contested'))
    h.click('a'); h.press('Enter'); h.press('F2')
    expect(h.sim.selectionIds).toEqual(['a'])
    expect(h.intentsOf('open')).toHaveLength(1)
    expect(h.state.naming).not.toBeNull()
  })

  it('unlocks when the state clears', () => {
    const h = view(locked('pending'))
    h.sim.placementStates = {}
    h.drag('a', h.empty(700, 500))
    expect(h.intentsOf('place')).toHaveLength(1)
  })
})

describe('Law 6: an OS drop is an add, into the folder under the pointer or the viewed folder', () => {
  it('on empty space adds to the viewed folder at the drop point, and never places or moves', () => {
    const h = view()
    h.drop({ x: 700, y: 500 }, ['datasheet.pdf', 'quote.pdf'])
    expect(h.intents).toHaveLength(1)
    const add = h.intentsOf('add')[0]!
    expect(add.folder).toBeNull()
    expect(add.placement).toEqual({ x: 700, y: 500 })
    expect(Array.from(add.files).map((f) => f.name)).toEqual(['datasheet.pdf', 'quote.pdf'])
    expect(h.sim.imported.map((i) => i.name)).toEqual(['datasheet.pdf', 'quote.pdf'])
    expect(h.sim.messages.at(-1)).toBe('2 PDFs added')
  })

  it('onto a folder card adds into that folder, with no placement', () => {
    const h = view()
    h.drop(h.at('F', true))
    expect(h.intents).toEqual([{ kind: 'add', files: expect.anything(), folder: h.sim.refOf('F', true) }])
    expect(h.intentsOf('add')[0]!.placement).toBeUndefined()
  })

  it('in a subfolder the viewed folder is that folder', () => {
    const h = view((sim) => { sim.addFile('inner', { parent: 'F', x: 16, y: 16 }) }, { viewed: 'F' })
    h.drop({ x: 600, y: 400 })
    expect(h.intentsOf('add')[0]!.folder).toEqual(h.sim.refOf('F', true))
  })

  it('highlights the folder under the files while they hover, and leaves when they leave', () => {
    const h = view()
    h.hoverFiles(h.at('F', true))
    expect(h.state.mode).toMatchObject({ kind: 'osdrag', dropTarget: h.keyOf('F', true) })
    expect(h.last.handled).toBe(true)
    h.hoverFiles(h.empty())
    expect(h.state.mode).toMatchObject({ kind: 'osdrag', dropTarget: null })
    h.send({ type: 'dragleave' })
    expect(h.mode).toBe('idle')
  })

  it('is not accepted where files cannot be added: no intent, and the host is told to let the browser refuse', () => {
    const h = view((sim) => { sim.capabilities = capsExcept('add') })
    const over = h.hoverFiles(h.empty())
    expect(over.handled).toBe(false)
    expect(h.mode).toBe('idle')
    const dropped = h.drop(h.empty())
    expect(dropped.handled).toBe(false)
    expect(h.intents).toEqual([])
  })
})

describe('Law 7: after a scope change, a generation change or destroy there are no more intents', () => {
  const gestures: [string, (h: Harness) => void][] = [
    ['a press', (h) => { h.down({ kind: 'card', key: h.keyOf('a') }, h.at('a')) }],
    ['a drag', (h) => { h.drag('a', h.empty(700, 500), { release: false }) }],
    ['a marquee', (h) => { h.marquee({ x: 5, y: 600 }, { x: 330, y: 700 }, { release: false }) }],
    ['a name edit', (h) => { h.click('a'); h.press('F2'); h.type('Renamed.pdf') }],
    ['a draft', (h) => { h.send({ type: 'command', command: 'new-folder' }); h.send({ type: 'sync' }); h.type('Late') }],
    ['a relation picker', (h) => {
      h.down({ kind: 'handle', key: h.keyOf('a') }, h.at('a')); h.move({ x: h.at('a').x + 20, y: h.at('a').y }); h.move(h.at('b')); h.up(h.at('b'))
    }],
    ['a pan', (h) => { h.down({ kind: 'background' }, h.empty(), { button: 1 }); h.move({ x: 800, y: 600 }) }],
  ]
  // What the old gesture's own events would do next: the stale half of a gesture must be inert.
  const finishStale = (h: Harness) => {
    h.move(h.empty(720, 520)); h.up(h.empty(300, 600)); h.up(h.empty(700, 500)); h.cancel()
    h.commit('Late'); h.send({ type: 'name-cancel' }); h.send({ type: 'relation-picked', relation: 'rel:explains' }); h.send({ type: 'menu-closed' })
  }
  // After destroy not even a fresh key or click is the canvas's.
  const finishAll = (h: Harness) => {
    finishStale(h)
    h.press('Enter'); h.press('Delete'); h.press('F2'); h.press('a', MOD); h.press('z', MOD); h.click('a'); h.drag('b', h.empty()); h.drop(h.empty())
  }

  for (const [name, start] of gestures) {
    it(`a scope change during ${name} ends it without intents`, () => {
      const h = view()
      start(h)
      h.mark()
      h.epoch = 'epoch-2-another-folder'
      finishStale(h)
      expect(h.intents).toEqual([])
      expect(h.state.epoch).toBe('epoch-2-another-folder')
      expect(h.state.naming).toBeNull()
      expect(h.mode).toBe('idle')
    })
    it(`destroy during ${name} ends it for good`, () => {
      const h = view()
      start(h)
      h.send({ type: 'destroy' })
      h.mark()
      finishAll(h)
      expect(h.intents).toEqual([])
      expect(h.effects).toEqual([])
      expect(h.state.dead).toBe(true)
      expect(h.steps.every((s) => !s.handled && s.intents.length === 0 && s.effects.length === 0)).toBe(true)
    })
  }

  it('releases the pointer it was holding when the scope changes under it', () => {
    const h = view()
    h.drag('a', h.empty(700, 500), { release: false })
    h.mark()
    h.epoch = 'epoch-2'
    h.move(h.empty(710, 510))
    expect(h.effectsOf('releasePointer')).toHaveLength(1)
    expect(h.effectsOf('endDrag')).toEqual([{ kind: 'endDrag', outcome: 'cancelled' }])
  })
})

describe('Law 8: a verb absent from the capabilities is in no menu and bound to no key', () => {
  type Row = { verb: keyof FileCanvasCapabilities; menu: ('open-beside' | 'rename' | 'move-to' | 'connect' | 'remove' | 'new-folder-inside' | 'add' | 'new-folder' | 'paste' | 'tidy')[] }
  const rows: Row[] = [
    { verb: 'place', menu: ['tidy'] },
    { verb: 'move', menu: ['move-to', 'paste'] },
    { verb: 'rename', menu: ['rename'] },
    { verb: 'create', menu: ['new-folder', 'new-folder-inside'] },
    { verb: 'add', menu: ['add'] },
    { verb: 'remove', menu: ['remove'] },
    { verb: 'connect', menu: ['connect'] },
    { verb: 'openBeside', menu: ['open-beside'] },
  ]

  it('offers every verb of the grammar when everything is allowed, and a plain list when nothing is', () => {
    expect(menuVerbs(ALL_CAPS, { kind: 'item', folder: false }).map((v) => v.verb)).toEqual(['open', 'open-beside', 'rename', 'move-to', 'connect', 'remove'])
    expect(menuVerbs(ALL_CAPS, { kind: 'item', folder: true }).map((v) => v.verb)).toEqual(['open', 'open-beside', 'rename', 'move-to', 'connect', 'remove', 'new-folder-inside'])
    expect(menuVerbs(ALL_CAPS, { kind: 'background', pasteable: true }).map((v) => v.verb)).toEqual(['add', 'new-folder', 'paste', 'tidy', 'view'])
    expect(menuVerbs(NO_CAPS, { kind: 'item', folder: true }).map((v) => v.verb)).toEqual(['open'])
    expect(menuVerbs(NO_CAPS, { kind: 'background', pasteable: true }).map((v) => v.verb)).toEqual(['view'])
  })

  it('has one label per verb, whatever the subject', () => {
    const labels = new Map<string, string>()
    for (const subject of [{ kind: 'item', folder: false }, { kind: 'item', folder: true }, { kind: 'background', pasteable: true }] as const) {
      for (const v of menuVerbs(ALL_CAPS, subject)) {
        expect(labels.get(v.verb) ?? v.label).toBe(v.label)
        labels.set(v.verb, v.label)
      }
    }
    expect(labels.get('rename')).toBe('Rename')
    expect(labels.get('move-to')).toBe('Move to…')
  })

  it('paste is offered only when there is something to paste', () => {
    expect(menuVerbs(ALL_CAPS, { kind: 'background', pasteable: false }).map((v) => v.verb)).not.toContain('paste')
  })

  // The key bound to each verb that has one, and what it would do if it were bound.
  const probes: Partial<Record<keyof FileCanvasCapabilities, (h: Harness) => { handled: boolean; acted: () => boolean }>> = {
    place: (h) => { const s = h.key('ArrowRight', ALT); return { handled: s.handled, acted: () => h.intentsOf('place').length > 0 } },
    move: (h) => { const s = h.key('v', MOD); return { handled: s.handled, acted: () => h.intentsOf('move').length > 0 } },
    rename: (h) => { const s = h.key('F2'); return { handled: s.handled, acted: () => h.state.naming !== null } },
    create: (h) => { const s = h.key('n', mods({ meta: true, shift: true })); return { handled: s.handled, acted: () => h.intentsOf('new-folder').length > 0 } },
    remove: (h) => { const s = h.key('Delete'); return { handled: s.handled, acted: () => h.intentsOf('remove').length > 0 } },
    openBeside: (h) => { const s = h.key('Enter', ALT); return { handled: s.handled, acted: () => h.intentsOf('open').some((i) => i.beside) } },
  }
  const ready = (caps: FileCanvasCapabilities): Harness => {
    // The cut file is one that lives elsewhere: pasting it here is a real move.
    const h = view((sim) => { sim.capabilities = caps; sim.addFile('x', { parent: 'F' }); sim.cut = [sim.refOf('x')] })
    h.click('a'); h.mark()
    return h
  }

  for (const { verb, menu } of rows) {
    it(`without ${verb}: not in the menus, and its key does nothing`, () => {
      const caps = capsExcept(verb)
      for (const subject of [{ kind: 'item', folder: true }, { kind: 'background', pasteable: true }] as const) {
        const offered = menuVerbs(caps, subject).map((v) => v.verb)
        for (const absent of menu) expect(offered, `${absent} offered without ${verb}`).not.toContain(absent)
        // And the other verbs are all still there: absence is exact.
        const full = menuVerbs(ALL_CAPS, subject).map((v) => v.verb).filter((v) => !menu.includes(v as never))
        expect(offered).toEqual(full)
      }
      const probe = probes[verb]
      if (!probe) return
      const control = probe(ready(ALL_CAPS))
      expect(control.handled, `${verb}'s key is bound when allowed`).toBe(true)
      expect(control.acted(), `${verb}'s key acts when allowed`).toBe(true)
      const h = ready(caps)
      const result = probe(h)
      expect(result.handled, `${verb}'s key is bound though absent`).toBe(false)
      expect(result.acted()).toBe(false)
    })
  }

  it('without add a drop is refused, and without connect a handle does not start a connection', () => {
    const noAdd = view((sim) => { sim.capabilities = capsExcept('add') })
    expect(noAdd.drop(noAdd.empty()).handled).toBe(false)
    expect(noAdd.intents).toEqual([])
    const noConnect = view((sim) => { sim.capabilities = capsExcept('connect') })
    noConnect.down({ kind: 'handle', key: noConnect.keyOf('a') }, noConnect.at('a'))
    noConnect.move(noConnect.at('b')); noConnect.up(noConnect.at('b'))
    expect(noConnect.state.mode.kind).toBe('idle')
    expect(noConnect.effectsOf('openRelationPicker')).toEqual([])
    noConnect.send({ type: 'handle-activate', key: noConnect.keyOf('a') })
    expect(noConnect.mode).toBe('idle')
  })

  it('without move there is no folder highlight and no drop on a folder; without place there is no arrange', () => {
    const noMove = view((sim) => { sim.capabilities = capsExcept('move') })
    noMove.drag('a', noMove.at('F', true), { release: false })
    expect(noMove.state.mode).toMatchObject({ kind: 'dragging', dropTarget: null })
    noMove.up(noMove.at('F', true))
    // The folder is not a target, so the drop is only an arrangement: the card sits over it, and nothing moves.
    expect(noMove.intents.filter((i) => i.kind === 'move')).toEqual([])
    expect(noMove.sim.parentOf('a')).toBeNull()
    const noPlace = view((sim) => { sim.capabilities = capsExcept('place', 'move') })
    noPlace.drag('a', noPlace.empty(700, 500))
    expect(noPlace.mode).toBe('idle')
    expect(noPlace.intents.filter((i) => i.kind !== 'select')).toEqual([])
    noPlace.send({ type: 'command', command: 'tidy' })
    expect(noPlace.intentsOf('place')).toEqual([])
  })

  it('a read-only canvas still selects, focuses, opens and shows menus: reading is not a verb', () => {
    const h = view((sim) => { sim.capabilities = NO_CAPS })
    h.click('a'); h.press('ArrowRight'); h.press('Enter'); h.contextMenu({ kind: 'card', key: h.keyOf('a') }, h.at('a'))
    expect(h.intents.map((i) => i.kind)).toEqual(['select', 'open', 'menu'])
    h.mark()
    h.press('z', MOD); h.press('x', MOD)
    expect(h.intents).toEqual([])
  })

  it('across all 256 capability sets a gesture only ever produces an intent its capability allows', { timeout: 60000 }, () => {
    const allow: Record<string, keyof FileCanvasCapabilities | null> = { place: 'place', move: 'move', rename: 'rename', create: 'create', 'new-folder': 'create', add: 'add', remove: 'remove', connect: 'connect' }
    const keys = Object.keys(ALL_CAPS) as (keyof FileCanvasCapabilities)[]
    for (let bits = 0; bits < 256; bits++) {
      const caps = Object.fromEntries(keys.map((k, i) => [k, (bits & (1 << i)) !== 0])) as unknown as FileCanvasCapabilities
      const h = view((sim) => { sim.capabilities = caps; sim.addFile('x', { parent: 'F' }); sim.cut = [sim.refOf('x')] })
      h.click('a')
      h.drag('a', h.empty(700, 500)); h.dragOnto('b', 'F'); h.drop(h.empty(600, 400)); h.drop(h.at('F', true))
      h.press('F2'); h.escapeInput(); h.press('Delete'); h.press('v', MOD); h.press('ArrowLeft', ALT); h.press('n', mods({ meta: true, shift: true }))
      h.press('Enter', ALT); h.send({ type: 'command', command: 'tidy' }); h.send({ type: 'command', command: 'new-folder' })
      h.down({ kind: 'handle', key: h.keyOf('c') }, h.at('c')); h.move(h.at('d')); h.up(h.at('d')); h.send({ type: 'relation-picked', relation: 'rel:explains' })
      for (const i of h.intents) {
        const need = allow[i.kind]
        if (i.kind === 'open' && i.beside) expect(caps.openBeside, `bits ${bits}: open beside`).toBe(true)
        if (need) expect(caps[need], `bits ${bits}: ${i.kind} without ${need}`).toBe(true)
      }
    }
  })
})

describe('the review\'s laws: selection is one set and focus is separate; arrange never changes membership', () => {
  it('moving focus with the arrows changes no selection and emits no select', () => {
    const h = view()
    h.click('a'); h.mark()
    h.press('ArrowRight'); h.press('ArrowRight'); h.press('ArrowDown')
    expect(h.intents).toEqual([])
    expect(h.focused).not.toBe(h.keyOf('a'))
    expect(h.sim.selectionIds).toEqual(['a'])
  })

  it('a click puts focus where the selection is, and the focus ring is the host\'s :focus-visible, not state', () => {
    const h = view()
    h.click('c')
    expect(h.focused).toBe(h.keyOf('c'))
    expect(h.effectsOf('focusCard').at(-1)).toEqual({ kind: 'focusCard', key: h.keyOf('c') })
  })

  it('arranging writes placements only: no file changes parent or name', () => {
    const h = view()
    h.drag('a', h.empty(700, 500)); h.drag('b', h.empty(600, 400))
    h.send({ type: 'command', command: 'tidy' })
    for (const id of ['a', 'b', 'c', 'd']) expect(h.sim.parentOf(id)).toBeNull()
    expect(h.sim.labelOf('a')).toBe('a.pdf')
    expect(h.intents.filter((i) => i.kind !== 'select').every((i) => i.kind === 'place')).toBe(true)
  })

  it('exposes WorkspaceFileRef identity, not coordinates, in every intent about files', () => {
    const h = view()
    h.dragOnto('a', 'F'); h.click('b'); h.press('Delete'); h.press('z', MOD)
    const refs = (r: WorkspaceFileRef) => expect(Object.keys(r).sort()).toEqual(['graphId', 'graphIncarnation', 'id', 'kind', 'ownerId'])
    for (const i of h.intents) {
      if (i.kind === 'move' || i.kind === 'remove' || i.kind === 'select') i.files.forEach(refs)
    }
  })

  it('keeps the CanvasEvent union closed: every event type the host may send is handled without throwing', () => {
    const h = view()
    const all: CanvasEvent[] = [
      { type: 'pointerdown', pointerId: 1, at: { x: 0, y: 0 }, button: 0, mods: mods(), target: { kind: 'background' }, t: 1 },
      { type: 'pointermove', pointerId: 1, at: { x: 1, y: 1 }, mods: mods(), t: 2 }, { type: 'pointerup', pointerId: 1, at: { x: 1, y: 1 }, mods: mods(), t: 3 },
      { type: 'pointercancel', pointerId: 1 }, { type: 'longpress', pointerId: 1 }, { type: 'wheel', at: { x: 5, y: 5 }, deltaX: 0, deltaY: 10, mods: mods() },
      { type: 'keydown', key: 'x', mods: mods() }, { type: 'keyup', key: 'x', mods: mods() },
      { type: 'contextmenu', at: { x: 5, y: 5 }, target: { kind: 'background' }, mods: mods() }, { type: 'dragover', at: { x: 5, y: 5 } }, { type: 'dragleave' },
      { type: 'drop', at: { x: 5, y: 5 }, files: [] }, { type: 'name-input', text: 'x' }, { type: 'name-commit' }, { type: 'name-cancel' },
      { type: 'handle-activate', key: h.keyOf('a') }, { type: 'relation-picked', relation: 'r' }, { type: 'relation-cancelled' }, { type: 'menu-closed' },
      { type: 'command', command: 'reset-view' }, { type: 'blur' }, { type: 'sync' },
    ]
    for (const e of all) expect(() => h.send(e), e.type).not.toThrow()
    expect(M.w).toBe(144)
  })
})
