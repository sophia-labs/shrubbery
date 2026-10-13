// @vitest-environment node
/**
 * One test (or a few) per row of the verb table of section 3.2: what the pointer does, what the keyboard
 * does, what is emitted, and what the shell then holds. The laws are in `interaction.laws.test.ts`; the
 * adversarial sequences are in `interaction.adversarial.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { fileKey, type PlacementContest } from '../../folder-view-contract.js'
import { toScene, toViewport } from '../geometry.js'
import { CARD_GAP, GRID_STEP, ghostKey } from '../scene.js'
import { capsExcept } from './support/fixtures.js'
import { ALT, Harness, MOD, SHIFT, mods } from './support/harness.js'
import { ShellSim } from './support/shell-sim.js'

const MOD_SHIFT = mods({ meta: true, shift: true })
const CTRL = mods({ ctrl: true })

function view(configure?: (sim: ShellSim) => void, opts: { viewed?: string; viewport?: { x: number; y: number; w: number; h: number }; echoFocus?: boolean } = {}): Harness {
  const sim = new ShellSim()
  sim.addFile('a', { x: 16, y: 16 })
  sim.addFile('b', { x: 176, y: 16 })
  sim.addFile('c', { x: 336, y: 16 })
  sim.addFile('F', { folder: true, label: 'Datasheets', x: 16, y: 176 })
  sim.addFile('d', { x: 176, y: 176 })
  if (opts.viewed) sim.viewed = fileKey(sim.refOf(opts.viewed, true))
  configure?.(sim)
  return new Harness({ sim, viewport: opts.viewport, echoFocus: opts.echoFocus })
}
const ids = (files: readonly { id: string }[]) => files.map((f) => f.id)
const rects = (h: Harness) => new Map(h.scene().cards.map((c) => [c.key, c.rect]))

describe('Select', () => {
  it('a click selects the card and focuses it', () => {
    const h = view()
    h.click('b')
    expect(h.sim.selectionIds).toEqual(['b'])
    expect(h.focused).toBe(h.keyOf('b'))
    expect(h.intentsOf('select')).toEqual([{ kind: 'select', files: [h.sim.refOf('b')] }])
  })

  it('a click on another card replaces the selection', () => {
    const h = view()
    h.click('a'); h.click('b')
    expect(h.sim.selectionIds).toEqual(['b'])
  })

  it('Cmd-click and Ctrl-click toggle a card in and out', () => {
    const h = view()
    h.click('a'); h.click('c', { mods: MOD })
    expect(h.sim.selectionIds).toEqual(['a', 'c'])
    h.click('a', { mods: CTRL })
    expect(h.sim.selectionIds).toEqual(['c'])
    h.click('c', { mods: MOD })
    expect(h.sim.selectionIds).toEqual([])
  })

  it('Shift-click extends from the anchor through reading order, and keeps the anchor', () => {
    const h = view()
    h.click('a'); h.click('c', { mods: SHIFT })
    expect(h.sim.selectionIds).toEqual(['a', 'b', 'c'])
    h.click('d', { mods: SHIFT })
    expect(h.sim.selectionIds).toEqual(['a', 'b', 'c', 'F', 'd'])
    h.click('b', { mods: SHIFT })
    expect(h.sim.selectionIds).toEqual(['a', 'b'])
  })

  it('a placement carries where the cards stood, so a shell can undo it', () => {
    const h = view()
    h.click('a'); h.mark()
    const before = h.scene().byKey.get(h.keyOf('a'))!.rect
    h.drag('a', h.empty(700, 500))
    const place = h.intentsOf('place')[0]!
    expect(place.previous).toEqual([expect.objectContaining({ x: before.x, y: before.y, file: place.placements[0]!.file })])
    expect(place.placements[0]!.x).not.toBe(before.x)
  })

  it('a plain click on a member of a multi-selection collapses to it on release, but a drag keeps them all', () => {
    const h = view()
    h.click('a'); h.click('b', { mods: MOD }); h.click('c', { mods: MOD }); h.mark()
    h.down({ kind: 'card', key: h.keyOf('b') }, h.at('b'))
    expect(h.intents).toEqual([])
    h.up(h.at('b'))
    expect(h.sim.selectionIds).toEqual(['b'])

    h.click('a'); h.click('b', { mods: MOD }); h.mark()
    h.drag('b', h.empty(700, 500))
    expect(h.intentsOf('select')).toEqual([])
    expect(ids(h.intentsOf('place')[0]!.placements.map((p) => p.file))).toEqual(['a', 'b'])
  })

  it('a marquee selects every card it touches, a Shift marquee adds, and the rectangle may start anywhere', () => {
    const h = view()
    h.marquee({ x: 5, y: 5 }, { x: 330, y: 150 })
    expect(h.sim.selectionIds).toEqual(['a', 'b'])
    h.marquee({ x: 5, y: 160 }, { x: 100, y: 200 }, { mods: SHIFT })
    expect(h.sim.selectionIds).toEqual(['a', 'b', 'F'])
    h.marquee({ x: 600, y: 700 }, { x: 5, y: 5 })                       // from the far corner backwards
    expect(h.sim.selectionIds).toEqual(['a', 'b', 'c', 'F', 'd'])
  })

  it('the marquee never selects a ghost', () => {
    const h = view((sim) => {
      sim.contests = [{ file: sim.refOf('a'), candidates: [
        { id: 'mine', x: 16, y: 16, origin: 'this-tab', label: 'this tab', at: 1 }, { id: 'theirs', x: 700, y: 400, origin: 'other', label: 'other tab', at: 2 }] }]
    })
    expect(h.scene().cards.some((c) => c.role === 'ghost' && c.rect.x === 700)).toBe(true)
    h.marquee({ x: 600, y: 350 }, { x: 900, y: 600 })
    expect(h.sim.selectionIds).toEqual([])
  })

  it('arrows move focus, Space toggles on release, Shift+arrows extend, Select all, Escape clears then leaves', () => {
    const h = view()
    h.press('ArrowRight')
    expect(h.focused).toBe(h.keyOf('a'))                               // the first arrow lands on the first card
    h.press('ArrowRight'); h.press('ArrowDown')
    expect(h.focused).toBe(h.keyOf('d'))
    h.mark()
    h.key(' ')
    expect(h.intentsOf('select')).toEqual([])
    h.send({ type: 'keyup', key: ' ', mods: mods() })
    expect(h.sim.selectionIds).toEqual(['d'])
    h.press(' ')
    expect(h.sim.selectionIds).toEqual([])

    h.click('a'); h.press('ArrowRight', SHIFT); h.press('ArrowRight', SHIFT)
    expect(h.sim.selectionIds).toEqual(['a', 'b', 'c'])
    h.press('ArrowLeft', SHIFT)
    expect(h.sim.selectionIds).toEqual(['a', 'b'])
    h.press('a', MOD)
    expect(h.sim.selectionIds).toEqual(['a', 'b', 'c', 'F', 'd'])
    h.mark()
    h.press('Escape')
    expect(h.sim.selectionIds).toEqual([])
    expect(h.effectsOf('focusHeader')).toEqual([])
    h.press('Escape')
    expect(h.effectsOf('focusHeader')).toEqual([{ kind: 'focusHeader' }])
  })

  it('Home and End go to the first and last card in reading order, and extend with Shift', () => {
    const h = view()
    h.press('End')
    expect(h.focused).toBe(h.keyOf('d'))
    h.press('Home')
    expect(h.focused).toBe(h.keyOf('a'))
    h.click('b'); h.press('End', SHIFT)
    expect(h.sim.selectionIds).toEqual(['b', 'c', 'F', 'd'])
  })

  it('keyboard navigation brings an off-screen card into view', () => {
    const h = view((sim) => { sim.addFile('far', { x: 3000, y: 16 }) })
    h.press('Home'); h.press('ArrowRight'); h.press('ArrowRight'); h.press('ArrowRight')
    expect(h.focused).toBe(h.keyOf('far'))
    expect(toViewport(h.camera, { x: 3000, y: 16 }).x).toBeGreaterThanOrEqual(0)
    expect(toViewport(h.camera, { x: 3144, y: 16 }).x).toBeLessThanOrEqual(h.viewport.w)
    h.press('Home')
    expect(toViewport(h.camera, { x: 16, y: 16 }).x).toBeGreaterThanOrEqual(0)
  })
})

describe('Open', () => {
  it('a double-click opens a file or a folder with one intent, and a triple click does not open twice', () => {
    const h = view()
    h.doubleClick('a')
    expect(h.intentsOf('open')).toEqual([{ kind: 'open', file: h.sim.refOf('a') }])
    h.mark()
    h.doubleClick('F', true)
    expect(h.intentsOf('open')).toEqual([{ kind: 'open', file: h.sim.refOf('F', true) }])
    h.mark()
    h.click('b'); h.tick(100); h.click('b'); h.tick(100); h.click('b')
    expect(h.intentsOf('open')).toHaveLength(1)
  })

  it('two clicks too far apart are not a double-click', () => {
    const h = view()
    h.click('a'); h.tick(450); h.click('a')
    expect(h.intentsOf('open')).toEqual([])
    h.tick(2000)
    h.click('b'); h.tick(100); h.click('c')
    expect(h.intentsOf('open')).toEqual([])
  })

  it('Enter opens the focused card; Alt+Enter opens beside, only where that is a verb', () => {
    const h = view()
    h.click('b'); h.press('Enter')
    expect(h.intentsOf('open')).toEqual([{ kind: 'open', file: h.sim.refOf('b') }])
    h.press('Enter', ALT)
    expect(h.intentsOf('open').at(-1)).toEqual({ kind: 'open', file: h.sim.refOf('b'), beside: true })
    const noBeside = view((sim) => { sim.capabilities = capsExcept('openBeside') })
    noBeside.click('b'); noBeside.mark()
    const step = noBeside.press('Enter', ALT)
    expect(step.handled).toBe(false)
    expect(noBeside.intents).toEqual([])
    expect(noBeside.press('Enter').intents).toEqual([{ kind: 'open', file: noBeside.sim.refOf('b') }])
  })

  it('Enter with nothing focused or selected does nothing, and is left to the browser', () => {
    const h = view()
    const step = h.press('Enter')
    expect(step.intents).toEqual([])
    expect(step.handled).toBe(false)
  })
})

describe('Name', () => {
  it('names a card on a click of its label, after a pause of 0.5 to 2 seconds, when it is the one selected card', () => {
    const h = view()
    h.click('a')
    h.click('a', { label: true, wait: 700 })
    expect(h.state.naming?.target).toEqual({ kind: 'file', key: h.keyOf('a') })
  })

  it('does not fire too soon (that is a double-click), too late, on another card, on a multi-selection, or after a double-click', () => {
    const soon = view(); soon.click('a'); soon.click('a', { label: true, wait: 100 })
    expect(soon.state.naming).toBeNull()
    expect(soon.intentsOf('open')).toHaveLength(1)

    const late = view(); late.click('a'); late.click('a', { label: true, wait: 2600 })
    expect(late.state.naming).toBeNull()

    const other = view(); other.click('a'); other.click('b', { label: true, wait: 800 })
    expect(other.state.naming).toBeNull()

    const multi = view(); multi.click('a'); multi.click('b', { mods: MOD }); multi.click('a', { label: true, wait: 800 })
    expect(multi.state.naming).toBeNull()

    const afterDouble = view(); afterDouble.doubleClick('a'); afterDouble.click('a', { label: true, wait: 800 })
    expect(afterDouble.state.naming).toBeNull()

    const firstClick = view(); firstClick.click('a', { label: true, wait: 800 })
    expect(firstClick.state.naming).toBeNull()

    // The card has to be the selected one when the second click lands, not only the one clicked before.
    const deselected = view(); deselected.click('a'); deselected.press('Escape'); deselected.click('a', { label: true, wait: 800 })
    expect(deselected.state.naming).toBeNull()
    const widened = view(); widened.click('a'); widened.press('a', MOD); widened.click('a', { label: true, wait: 800 })
    expect(widened.state.naming).toBeNull()
  })

  it('F2 names the focused card, else the one selected card, and nothing when there is neither', () => {
    const h = view()
    expect(h.press('F2').handled).toBe(true)
    expect(h.state.naming).toBeNull()
    h.click('c'); h.press('F2')
    expect(h.state.naming?.target).toEqual({ kind: 'file', key: h.keyOf('c') })
  })

  it('a rename the shell refuses keeps the input, with the reason, and the next try can work', () => {
    const h = view()
    h.click('a'); h.press('F2'); h.type('b.pdf'); h.commit()
    expect(h.sim.labelOf('a')).toBe('a.pdf')
    h.send({ type: 'sync' })
    expect(h.state.naming).toMatchObject({ target: { kind: 'file', key: h.keyOf('a') }, origin: 'shell', error: '“b.pdf” already exists here.', text: 'b.pdf' })
    expect(h.effectsOf('focusInput').length).toBeGreaterThanOrEqual(2)
    h.type('Quote.pdf'); h.commit()
    expect(h.sim.labelOf('a')).toBe('Quote.pdf')
    h.send({ type: 'sync' })
    expect(h.state.naming).toBeNull()
  })

  it('a rename the shell started (session.naming on a file) is shown in place and committed as a rename', () => {
    const h = view()
    h.sim.naming = { target: h.sim.refOf('d'), initial: 'd.pdf', error: null }
    h.send({ type: 'sync' })
    expect(h.state.naming).toMatchObject({ origin: 'shell', target: { kind: 'file', key: h.keyOf('d') } })
    h.type('Quote.pdf'); h.commit()
    expect(h.intentsOf('rename')).toEqual([{ kind: 'rename', file: h.sim.refOf('d'), name: 'Quote.pdf' }])
  })

  it('returns focus to the card when the edit ends', () => {
    const h = view()
    h.click('a'); h.press('F2'); h.mark()
    h.escapeInput()
    expect(h.effectsOf('focusCard')).toEqual([{ kind: 'focusCard', key: h.keyOf('a') }])
  })
})

describe('New folder: create where you look', () => {
  it('asks the shell for a draft at the first free slot, from the toolbar command or Cmd-Shift-N', () => {
    for (const ask of [(h: Harness) => h.send({ type: 'command', command: 'new-folder' }), (h: Harness) => h.press('n', MOD_SHIFT), (h: Harness) => h.press('N', MOD_SHIFT)]) {
      const h = view()
      expect(ask(h).handled).toBe(true)
      expect(h.intents).toEqual([{ kind: 'new-folder', placement: { x: 496, y: 16 } }])
    }
  })

  it('does not ask again while a draft is being named: the input owns the keys', () => {
    const h = view()
    h.send({ type: 'command', command: 'new-folder' })
    const again = h.press('n', MOD_SHIFT)
    expect(h.intentsOf('new-folder')).toHaveLength(1)
    expect(again.handled).toBe(false)
  })

  it('looks where the camera looks: the first free slot at or after the top-left of what is visible', () => {
    const h = view()
    h.camera = { x: 0, y: -592, zoom: 1 }
    h.send({ type: 'command', command: 'new-folder' })
    expect(h.intentsOf('new-folder')[0]!.placement).toEqual({ x: 16, y: 592 })
    h.mark()
    h.camera = { x: 0, y: 0, zoom: 1 }
    h.send({ type: 'command', command: 'new-folder' })
    expect(h.intentsOf('new-folder')[0]!.placement).toEqual({ x: 496, y: 16 })
  })

  it('shows the draft at that slot, and commits it there: nothing else moves, placed or not', () => {
    for (const placed of [true, false]) {
      const sim = new ShellSim()
      for (const [i, id] of ['a', 'b', 'c', 'd', 'e'].entries()) sim.addFile(id, placed ? { x: 16 + (i % 4) * 160, y: 16 + Math.floor(i / 4) * 144 } : {})
      const h = new Harness({ sim })
      const before = rects(h)
      h.send({ type: 'command', command: 'new-folder' }); h.send({ type: 'sync' })
      const draft = h.scene().cards.find((c) => c.role === 'draft')!
      expect([draft.rect.x, draft.rect.y]).toEqual([h.intentsOf('new-folder')[0]!.placement.x, h.intentsOf('new-folder')[0]!.placement.y])
      for (const [key, rect] of before) expect(h.scene().byKey.get(key)!.rect, `placed=${placed}`).toEqual(rect)
      h.type('Datasheets'); h.commit(); h.send({ type: 'sync' })
      for (const [key, rect] of before) expect(h.scene().byKey.get(key)!.rect, `placed=${placed} after commit`).toEqual(rect)
      const made = h.scene().cards.find((c) => c.label === 'Datasheets')!
      expect([made.rect.x, made.rect.y, made.kind, made.role]).toEqual([draft.rect.x, draft.rect.y, 'folder', 'real'])
      expect(h.state.naming).toBeNull()
    }
  })

  it('creates a sibling in the viewed folder even with a folder selected, and never navigates', () => {
    const h = view()
    h.click('F', { folder: true })
    h.send({ type: 'command', command: 'new-folder' }); h.send({ type: 'sync' }); h.type('Quotes'); h.commit()
    expect(h.intentsOf('create')[0]!.parent).toBeNull()
    expect(h.intents.filter((i) => i.kind === 'open')).toEqual([])
    expect(h.sim.viewed).toBeNull()
  })

  it('creates inside a subfolder when that is the viewed folder, with the folder as parent', () => {
    const h = view((sim) => { sim.addFile('inner', { parent: 'F', x: 16, y: 16 }) }, { viewed: 'F' })
    h.send({ type: 'command', command: 'new-folder' }); h.send({ type: 'sync' }); h.type('Quotes'); h.commit()
    expect(h.intentsOf('create')[0]!.parent).toEqual(h.sim.refOf('F', true))
  })

  it('escaping the draft drops it and returns focus', () => {
    const h = view()
    h.send({ type: 'command', command: 'new-folder' }); h.send({ type: 'sync' }); h.type('x'); h.escapeInput()
    expect(h.sim.drafts).toEqual([])
    h.send({ type: 'sync' })
    expect(h.state.naming).toBeNull()
    expect(h.scene().cards.every((c) => c.role === 'real')).toBe(true)
  })

  it('puts the draft where the camera looks, even where the lattice does not reach: a pane panned a thousand units right', () => {
    // The lattice is four columns wide from the scene's top-left; the pane shows scene x from 1000 to 2024.
    const h = view()
    h.camera = { x: -1000, y: 0, zoom: 1 }
    const before = rects(h)
    h.send({ type: 'command', command: 'new-folder' })
    const { placement } = h.intentsOf('new-folder')[0]!
    const cell = { x: placement.x, y: placement.y, w: 144, h: 128 }
    const onScreen = [toViewport(h.camera, { x: cell.x, y: cell.y }), toViewport(h.camera, { x: cell.x + cell.w, y: cell.y + cell.h })]
    expect(onScreen[0]!.x).toBeGreaterThanOrEqual(0); expect(onScreen[1]!.x).toBeLessThanOrEqual(h.viewport.w)
    expect(onScreen[0]!.y).toBeGreaterThanOrEqual(0); expect(onScreen[1]!.y).toBeLessThanOrEqual(h.viewport.h)
    expect(placement).toEqual({ x: 1136, y: 16 })                           // the first cell of the lattice's own grid that is wholly in view
    h.send({ type: 'sync' })
    expect(h.camera).toEqual({ x: -1000, y: 0, zoom: 1 })                  // the naming had nothing to reveal: the camera did not jump
    for (const [key, rect] of before) expect(h.scene().byKey.get(key)!.rect).toEqual(rect)
    expect(h.scene().cards.find((c) => c.role === 'draft')!.rect).toEqual(cell)
  })

  it('looks at the zoom the camera has: a zoomed-out pane sees more of the scene, so a full pane at zoom 1 has room at zoom 0.5', () => {
    // Cards fill columns 0 to 6 of rows 0 to 4. A pane 1024 by 768 at zoom 1 sees columns 0 to 5 and rows 0 to 4: all taken, so the
    // nearest free cell is the one below the fold (96 units of pan). At zoom 0.5 it sees twice as far, and column 7 of row 0 is free.
    const h = view((sim) => { for (let row = 0; row <= 4; row++) for (let col = 0; col <= 6; col++) sim.addFile(`g${row}-${col}`, { x: 16 + col * 160, y: 16 + row * 144 }) })
    h.send({ type: 'command', command: 'new-folder' })
    expect(h.intentsOf('new-folder')[0]!.placement).toEqual({ x: 16, y: 736 })
    h.sim.drafts = []; h.sim.naming = null; h.mark()
    h.camera = { x: 0, y: 0, zoom: 0.5 }
    h.send({ type: 'command', command: 'new-folder' })
    expect(h.intentsOf('new-folder')[0]!.placement).toEqual({ x: 1136, y: 16 })
  })

  it('when everything in view is taken, takes the free cell that needs the least pan, and the naming pans by exactly that', () => {
    // Cards fill every cell wholly in view (columns 7 to 11, rows 0 to 4). The nearest free cells are column 6, which starts 24 units
    // left of the view; column 12 would need 56, and the row below 96.
    const h = view((sim) => {
      for (let row = 0; row <= 4; row++) for (let col = 7; col <= 11; col++) sim.addFile(`g${row}-${col}`, { x: 16 + col * 160, y: 16 + row * 144 })
    })
    h.camera = { x: -1000, y: 0, zoom: 1 }
    h.send({ type: 'command', command: 'new-folder' })
    expect(h.intentsOf('new-folder')[0]!.placement).toEqual({ x: 976, y: 16 })
    h.send({ type: 'sync' })
    expect(h.camera).toEqual({ x: -960, y: 0, zoom: 1 })                   // the draft's left edge at the pane's margin: 24 plus 16 of room
    const draft = h.scene().cards.find((c) => c.role === 'draft')!
    expect(toViewport(h.camera, { x: draft.rect.x, y: draft.rect.y }).x).toBe(16)
  })

  it('a draft only half in view is revealed by the least pan: the pane here fits four columns, all taken', () => {
    // Thirty-two cards fill the first eight rows of four columns. A pane 700 wide shows columns 0 to 3, and column 4 starts at 656.
    const h = view((sim) => { for (let i = 0; i < 32; i++) sim.addFile(`g${i}`, { x: 16 + (i % 4) * 160, y: 16 + Math.floor(i / 4) * 144 }) }, { viewport: { x: 0, y: 0, w: 700, h: 768 } })
    h.send({ type: 'command', command: 'new-folder' })
    expect(h.intentsOf('new-folder')[0]!.placement).toEqual({ x: 656, y: 16 })
    h.send({ type: 'sync' })
    const draft = h.scene().cards.find((c) => c.role === 'draft')!
    const top = toViewport(h.camera, { x: draft.rect.x, y: draft.rect.y })
    const bottom = toViewport(h.camera, { x: draft.rect.x + draft.rect.w, y: draft.rect.y + draft.rect.h })
    expect(top.y).toBeGreaterThanOrEqual(0)
    expect(bottom.x).toBe(700 - 16)                                         // right edge at the pane's margin: the draft's 100 units out of view, plus 16
    expect(h.camera.y).toBe(0)
    expect(bottom.y).toBeLessThanOrEqual(h.viewport.h)
  })
})

describe('Move by cut and paste', () => {
  it('Cmd-X marks the selection, and Cmd-V in the destination folder moves it there', () => {
    const h = view()
    h.click('a'); h.click('b', { mods: MOD }); h.mark()
    const cut = h.press('x', MOD)
    expect(cut.handled).toBe(true)
    expect(h.intents).toEqual([])
    expect(ids(h.sim.cut)).toEqual(['a', 'b'])
    h.sim.viewed = h.keyOf('F', true)                                      // navigate into the destination
    h.send({ type: 'sync' }); h.mark()
    h.press('v', MOD)
    expect(h.intents).toEqual([{ kind: 'move', files: [h.sim.refOf('a'), h.sim.refOf('b')], folder: h.sim.refOf('F', true) }])
    expect(h.sim.parentOf('a')).toBe(h.keyOf('F', true))
    expect(h.sim.cut).toEqual([])
  })

  it('pasting where the files already are moves nothing, and still ends the cut', () => {
    const h = view()
    h.click('a'); h.press('x', MOD); h.mark()
    h.press('v', MOD)
    expect(h.intents).toEqual([])
    expect(h.sim.cut).toEqual([])
  })

  it('Escape cancels a cut, and Cmd-X with nothing selected marks nothing', () => {
    const h = view()
    h.click('a'); h.press('x', MOD); h.press('Escape')
    expect(h.sim.cut).toEqual([])
    expect(h.sim.selectionIds).toEqual(['a'])                              // the first Escape ends the cut, not the selection
    h.press('Escape'); h.press('x', MOD)
    expect(h.sim.cut).toEqual([])
  })

  it('pastes to the top level when the root is the viewed folder', () => {
    const h = view((sim) => { sim.addFile('inner', { parent: 'F', x: 16, y: 16 }) }, { viewed: 'F' })
    h.click('inner'); h.press('x', MOD)
    h.sim.viewed = null; h.send({ type: 'sync' }); h.mark()
    h.press('v', MOD)
    expect(h.intentsOf('move')).toEqual([{ kind: 'move', files: [h.sim.refOf('inner')], folder: null }])
  })
})

describe('Arrange', () => {
  it('Tidy up lays the cards out in reading order and writes one record per card that moves', () => {
    const h = view()
    h.send({ type: 'command', command: 'tidy' })
    const place = h.intentsOf('place')
    expect(place).toHaveLength(1)
    const moved = new Map(place[0]!.placements.map((p) => [p.file.id, [p.x, p.y]]))
    // Reading order a, b, c, F, d on a lattice from (16, 16): only the cards that were not already there move.
    expect(moved.has('a')).toBe(false)
    for (const [, [x, y]] of moved) { expect((x! - CARD_GAP) % 160).toBe(0); expect((y! - CARD_GAP) % 144).toBe(0) }
    expect(new Set([...moved.values()].map(([x, y]) => `${x},${y}`)).size).toBe(moved.size)
  })

  it('Tidy up twice changes nothing the second time', () => {
    const h = view((sim) => { sim.addFile('e', { x: 700, y: 500 }); sim.addFile('f', { x: 40, y: 600 }) })
    h.send({ type: 'command', command: 'tidy' })
    h.mark()
    h.send({ type: 'command', command: 'tidy' })
    expect(h.intents).toEqual([])
  })

  it('Tidy up fits the lattice to the visible width and leaves locked cards where they are', () => {
    const h = view((sim) => { sim.placementStates = { [fileKey(sim.refOf('d'))]: 'pending' } }, { viewport: { x: 0, y: 0, w: 400, h: 600 } })
    h.send({ type: 'command', command: 'tidy' })
    const placed = new Map(h.intentsOf('place')[0]!.placements.map((p) => [p.file.id, p]))
    expect(placed.has('d')).toBe(false)
    expect(Math.max(...[...placed.values()].map((p) => p.x))).toBeLessThan(400)
  })

  it('Alt+arrow nudges the selection by one grid step, Alt+Shift+arrow by four', () => {
    const h = view()
    h.click('a'); h.click('b', { mods: MOD }); h.mark()
    h.press('ArrowRight', ALT)
    expect(h.intentsOf('place')[0]!.placements.map((p) => [p.file.id, p.x, p.y])).toEqual([['a', 16 + GRID_STEP, 16], ['b', 176 + GRID_STEP, 16]])
    h.press('ArrowDown', mods({ alt: true, shift: true }))
    expect(h.intentsOf('place')[1]!.placements.map((p) => [p.file.id, p.x, p.y])).toEqual([['a', 24, 48], ['b', 184, 48]])
    h.press('ArrowLeft', ALT); h.press('ArrowUp', ALT)
    expect(h.sim.placementOf('a')).toEqual({ x: 16, y: 40 })
  })

  it('nudges the focused card when nothing is selected, never a locked one, and nothing at all with neither', () => {
    const h = view((sim) => { sim.placementStates = { [fileKey(sim.refOf('a'))]: 'contested' } })
    expect(h.press('ArrowRight', ALT).intents).toEqual([])
    h.click('b'); h.press('Escape'); h.mark()
    h.press('ArrowRight'); h.press('ArrowLeft')                                 // focus moves; selection is empty
    h.press('ArrowDown', ALT)
    expect(h.intentsOf('place')).toHaveLength(1)
    h.click('a'); h.mark()
    h.press('ArrowRight', ALT)
    expect(h.intentsOf('place')).toEqual([])
  })
})

describe('Connect', () => {
  it('dragging from a card\'s handle to another card opens the relation picker at the drop, and the pick makes the connection', () => {
    const h = view()
    h.down({ kind: 'handle', key: h.keyOf('a') }, h.at('a'))
    expect(h.mode).toBe('pressing')
    h.move({ x: h.at('a').x + 30, y: h.at('a').y }); h.move(h.at('b'))
    expect(h.state.mode).toMatchObject({ kind: 'connecting', source: h.keyOf('a'), via: 'pointer', candidate: h.keyOf('b') })
    h.mark()
    h.up(h.at('b'))
    expect(h.effectsOf('openRelationPicker')).toEqual([{ kind: 'openRelationPicker', at: h.at('b'), source: h.keyOf('a'), target: h.keyOf('b') }])
    expect(h.state.mode).toMatchObject({ kind: 'picking', source: h.keyOf('a'), target: h.keyOf('b') })
    expect(h.intents).toEqual([])
    h.send({ type: 'relation-picked', relation: 'rel:explains', label: 'explains' })
    expect(h.intents).toEqual([{ kind: 'connect', source: h.sim.refOf('a'), target: h.sim.refOf('b'), relation: 'rel:explains', label: 'explains' }])
    expect(h.sim.connections).toHaveLength(1)
    expect(h.mode).toBe('idle')
  })

  it('does not change the selection, and a drop on empty space, on itself, or a cancelled picker connects nothing', () => {
    const h = view()
    h.click('d'); h.mark()
    h.down({ kind: 'handle', key: h.keyOf('a') }, h.at('a')); h.move(h.empty()); h.up(h.empty())
    expect(h.intents).toEqual([])
    h.down({ kind: 'handle', key: h.keyOf('a') }, h.at('a')); h.move({ x: h.at('a').x + 20, y: h.at('a').y }); h.up(h.at('a'))
    expect(h.intents).toEqual([])
    h.down({ kind: 'handle', key: h.keyOf('a') }, h.at('a')); h.move(h.at('b')); h.up(h.at('b'))
    h.send({ type: 'relation-cancelled' })
    expect(h.mode).toBe('idle')
    h.send({ type: 'relation-picked', relation: 'rel:explains' })
    expect(h.intents).toEqual([])
    expect(h.sim.selectionIds).toEqual(['d'])
  })

  it('has a keyboard twin: activate the handle, choose the target with the arrows, Enter opens the picker', () => {
    const h = view()
    h.send({ type: 'handle-activate', key: h.keyOf('a') })
    expect(h.state.mode).toMatchObject({ kind: 'connecting', via: 'keyboard', source: h.keyOf('a'), candidate: null })
    h.press('ArrowRight')
    expect(h.state.mode).toMatchObject({ candidate: h.keyOf('b') })
    h.press('ArrowRight')
    expect(h.state.mode).toMatchObject({ candidate: h.keyOf('c') })
    h.press('ArrowLeft'); h.press('ArrowLeft')
    expect(h.state.mode).toMatchObject({ candidate: h.keyOf('b') })    // never the source itself
    h.press('ArrowLeft')
    expect(h.state.mode).not.toMatchObject({ candidate: h.keyOf('a') })
    h.press('ArrowRight')
    h.press('Enter')
    expect(h.effectsOf('openRelationPicker').at(-1)).toMatchObject({ source: h.keyOf('a'), target: expect.any(String) })
    h.send({ type: 'relation-picked', relation: 'rel:supports' })
    expect(h.intentsOf('connect')).toHaveLength(1)
    expect(h.intentsOf('connect')[0]!.relation).toBe('rel:supports')
  })

  it('Escape leaves keyboard connecting without a trace and returns focus to the source', () => {
    const h = view()
    h.send({ type: 'handle-activate', key: h.keyOf('a') }); h.press('ArrowRight'); h.mark()
    h.press('Escape')
    expect(h.mode).toBe('idle')
    expect(h.intents).toEqual([])
    expect(h.effectsOf('focusCard').at(-1)).toEqual({ kind: 'focusCard', key: h.keyOf('a') })
  })
})

describe('Remove, Undo and Redo', () => {
  it('Delete and Backspace remove the selection; with nothing selected they emit nothing but stay bound', () => {
    const h = view()
    expect(h.press('Delete').handled).toBe(true)
    expect(h.intents).toEqual([])
    h.click('a'); h.click('c', { mods: MOD }); h.mark()
    h.press('Delete')
    expect(h.intents).toEqual([{ kind: 'remove', files: [h.sim.refOf('a'), h.sim.refOf('c')] }])
    expect(h.sim.isRemoved('a')).toBe(true)
    expect(h.sim.selectionIds).toEqual([])
    h.click('b'); h.mark()
    h.press('Backspace')
    expect(h.intentsOf('remove')).toEqual([{ kind: 'remove', files: [h.sim.refOf('b')] }])
  })

  it('removal is recoverable: Cmd-Z brings it back, Shift-Cmd-Z removes it again', () => {
    const h = view()
    h.click('a'); h.press('Delete')
    expect(h.scene().byKey.has(h.keyOf('a'))).toBe(false)
    h.press('z', MOD)
    expect(h.intentsOf('undo')).toHaveLength(1)
    expect(h.sim.isRemoved('a')).toBe(false)
    expect(h.scene().byKey.has(h.keyOf('a'))).toBe(true)
    expect(h.sim.messages.at(-1)).toBe('Undid: Removed a.pdf')
    h.press('Z', MOD_SHIFT)
    expect(h.intentsOf('redo')).toHaveLength(1)
    expect(h.sim.isRemoved('a')).toBe(true)
    h.press('z', MOD); h.press('y', CTRL)
    expect(h.intentsOf('redo')).toHaveLength(2)
    expect(h.sim.isRemoved('a')).toBe(true)
  })

  it('undoes an arrangement exactly, redoes it, and a new change ends the redo', () => {
    const h = view()
    h.drag('a', h.empty(700, 500))
    const moved = h.sim.placementOf('a')!
    expect(moved).not.toEqual({ x: 16, y: 16 })
    h.press('z', MOD)
    expect(h.sim.placementOf('a')).toEqual({ x: 16, y: 16 })
    h.press('Z', MOD_SHIFT)
    expect(h.sim.placementOf('a')).toEqual(moved)
    h.press('z', MOD)
    h.drag('b', h.empty(600, 400))
    h.press('Z', MOD_SHIFT)
    expect(h.sim.placementOf('a')).toEqual({ x: 16, y: 16 })           // the new drag ended the redo of a's move
  })

  it('undoes each kind of change: move, rename, create, add, connect', () => {
    const h = view()
    h.dragOnto('a', 'F')
    h.press('z', MOD)
    expect(h.sim.parentOf('a')).toBeNull()
    expect(h.sim.messages.at(-1)).toBe('Undid: Moved a.pdf to Datasheets')

    h.click('b'); h.press('F2'); h.type('Quote.pdf'); h.commit()
    h.press('z', MOD)
    expect(h.sim.labelOf('b')).toBe('b.pdf')

    h.send({ type: 'command', command: 'new-folder' }); h.send({ type: 'sync' }); h.type('Quotes'); h.commit()
    const quotes = h.sim.children().find((f) => f.label === 'Quotes')!
    h.press('z', MOD)
    expect(quotes.removed).toBe(true)
    h.press('Z', MOD_SHIFT)
    expect(quotes.removed).toBe(false)

    h.drop(h.empty(), ['one.pdf', 'two.pdf'])
    expect(h.sim.children().filter((f) => f.label.startsWith('one') || f.label.startsWith('two'))).toHaveLength(2)
    h.press('z', MOD)
    expect(h.sim.children().filter((f) => f.label.startsWith('one') || f.label.startsWith('two'))).toHaveLength(0)

    h.down({ kind: 'handle', key: h.keyOf('c') }, h.at('c')); h.move(h.at('d')); h.up(h.at('d')); h.send({ type: 'relation-picked', relation: 'rel:explains' })
    expect(h.sim.connections).toHaveLength(1)
    h.press('z', MOD)
    expect(h.sim.connections).toHaveLength(0)
  })

  it('says so, and changes nothing, when the inverse is no longer possible', () => {
    const h = view()
    h.dragOnto('a', 'F')
    h.sim.files.get(h.keyOf('a'))!.removed = true                           // someone removed it behind the canvas
    h.press('z', MOD)
    expect(h.sim.messages.at(-1)).toBe('Can\'t undo: a.pdf has gone since.')
    expect(h.sim.journal.canUndo).toBe(true)
  })

  it('Undo and Redo are bound only to a canvas that can change something', () => {
    const h = view((sim) => { sim.capabilities = capsExcept('place', 'move', 'rename', 'create', 'add', 'remove', 'connect') })
    expect(h.press('z', MOD).handled).toBe(false)
    expect(h.intents).toEqual([])
  })
})

describe('The release is a position of its own', () => {
  // Pointer moves are coalesced: the last one delivered may be well behind where the pointer is let go.
  it('a marquee is finalized from where the pointer is released, not from the last move that was delivered', () => {
    const h = view()
    h.down({ kind: 'background' }, { x: 0, y: 0 })
    h.move({ x: 150, y: 140 })
    expect(h.sim.selectionIds).toEqual(['a'])
    h.up({ x: 500, y: 160 })
    expect(h.sim.selectionIds).toEqual(['a', 'b', 'c'])
    expect(h.mode).toBe('idle')
    expect(h.intentsOf('select').map((i) => i.files.map((f) => f.id))).toEqual([['a'], ['a', 'b', 'c']])
  })

  it('and it can take cards out as well as bring them in', () => {
    const h = view()
    h.down({ kind: 'background' }, { x: 0, y: 0 })
    h.move({ x: 500, y: 160 })
    expect(h.sim.selectionIds).toEqual(['a', 'b', 'c'])
    h.up({ x: 150, y: 140 })
    expect(h.sim.selectionIds).toEqual(['a'])
  })

  it('a Shift marquee adds what the release reaches to the selection it began with', () => {
    const h = view()
    h.click('d')
    h.down({ kind: 'background' }, { x: 0, y: 0 }, { mods: SHIFT })
    h.move({ x: 150, y: 140 }, { mods: SHIFT })
    h.up({ x: 500, y: 160 }, { mods: SHIFT })
    expect(h.sim.selectionIds).toEqual(['a', 'b', 'c', 'd'])
  })

  it('a release where the last move was changes nothing and says nothing more', () => {
    const h = view()
    h.down({ kind: 'background' }, { x: 0, y: 0 })
    h.move({ x: 500, y: 160 })
    h.mark()
    h.up({ x: 500, y: 160 })
    expect(h.intentsOf('select')).toEqual([])
    expect(h.sim.selectionIds).toEqual(['a', 'b', 'c'])
  })

  it('a pan ends at the camera the release asks for', () => {
    const h = view()
    h.down({ kind: 'background' }, h.empty(), { button: 1 })
    h.move({ x: h.empty().x - 40, y: h.empty().y - 10 })
    h.up({ x: h.empty().x - 100, y: h.empty().y - 30 })
    expect(h.camera).toEqual({ x: -100, y: -30, zoom: 1 })
    expect(h.mode).toBe('idle')
  })

  it('a press let go far from where it began, with no move delivered between, is the gesture it travelled: a marquee on the background', () => {
    const h = view()
    h.click('d'); h.mark()
    h.down({ kind: 'background' }, { x: 0, y: 0 })
    h.up({ x: 500, y: 160 })
    expect(h.sim.selectionIds).toEqual(['a', 'b', 'c'])
    expect(h.intentsOf('select').map((i) => i.files.map((f) => f.id))).toEqual([['a', 'b', 'c']])
  })

  it('a press on a card let go far away, with no move delivered between, is a drag to there: dropped on a folder it moves the card', () => {
    const h = view()
    h.down({ kind: 'card', key: h.keyOf('b') }, h.at('b'))
    h.up(h.at('F', true))
    expect(h.intentsOf('move')).toEqual([{ kind: 'move', files: [h.sim.refOf('b')], folder: h.sim.refOf('F', true) }])
    expect(h.sim.parentOf('b')).toBe(h.keyOf('F', true))
  })

  it('a ghost let go far from where it was pressed is not a choice', () => {
    const h = view((sim) => {
      sim.contests = [{ file: sim.refOf('a'), candidates: [
        { id: 'mine', x: 16, y: 16, origin: 'this-tab', label: 'this tab', at: 1 }, { id: 'theirs', x: 700, y: 400, origin: 'other', label: 'other tab', at: 2 }] }]
    })
    const ghost = h.scene().cards.find((c) => c.role === 'ghost')!
    const at = toViewport(h.camera, { x: ghost.rect.x + ghost.rect.w / 2, y: ghost.rect.y + ghost.rect.h / 2 })
    h.down({ kind: 'card', key: ghost.key }, at)
    h.up({ x: at.x - 200, y: at.y })
    expect(h.intentsOf('choose-placement')).toEqual([])
    expect(h.mode).toBe('idle')
    // Let go where it was pressed, it is the choice.
    h.down({ kind: 'card', key: ghost.key }, at)
    h.up(at)
    expect(h.intentsOf('choose-placement')).toEqual([{ kind: 'choose-placement', file: h.sim.refOf('a'), candidateId: 'theirs' }])
  })

  it('a press on a card let go within the click distance is still a click', () => {
    const h = view()
    const at = h.at('b')
    h.down({ kind: 'card', key: h.keyOf('b') }, at)
    h.up({ x: at.x + 2, y: at.y + 1 })
    expect(h.sim.selectionIds).toEqual(['b'])
    expect(h.intentsOf('move')).toEqual([])
    expect(h.intentsOf('place')).toEqual([])
  })
})

describe('Connections keep their identity across undo and redo', () => {
  const connect = (h: Harness) => {
    h.down({ kind: 'handle', key: h.keyOf('a') }, h.at('a')); h.move(h.at('b')); h.up(h.at('b'))
    h.send({ type: 'relation-picked', relation: 'rel:explains', label: 'explains' })
  }

  it('connect, undo, redo, undo, redo: one connection, the same id, state and attribution at every step', () => {
    const h = view()
    connect(h)
    expect(h.sim.connections).toHaveLength(1)
    const made = h.sim.connections[0]!
    expect(made).toMatchObject({ state: 'proposed', attribution: 'you', relation: 'rel:explains', label: 'explains' })
    for (let round = 0; round < 3; round++) {
      h.press('z', MOD)
      expect(h.sim.connections, `undo ${round + 1}`).toEqual([])
      expect(h.sim.messages.at(-1)).toBe('Undid: Connected')
      h.press('Z', MOD_SHIFT)
      expect(h.sim.connections, `redo ${round + 1}`).toEqual([made])
      expect(h.sim.messages.at(-1)).toBe('Redid: Connected')
    }
    expect(h.sim.journal.canUndo).toBe(true)
  })

  it('a connection removed from the margin comes back whole when the removal is undone, and goes again when it is redone', () => {
    const h = view((sim) => {
      sim.connections = [{ id: 'c-eschaton', source: sim.refOf('a'), target: sim.refOf('b'), relation: 'rel:supports', label: 'supports', state: 'endorsed', attribution: 'Eschaton' }]
    })
    const record = h.sim.connections[0]!
    h.sim.apply({ kind: 'disconnect', connectionId: 'c-eschaton' })
    expect(h.sim.connections).toEqual([])
    h.press('z', MOD)
    expect(h.sim.connections).toEqual([record])
    h.press('Z', MOD_SHIFT)
    expect(h.sim.connections).toEqual([])
    h.press('z', MOD)
    expect(h.sim.connections).toEqual([record])
  })

  it('says so, and changes nothing, when the connection to undo is no longer there', () => {
    const h = view()
    connect(h)
    h.sim.connections = []                                              // someone removed it behind the canvas
    h.press('z', MOD)
    expect(h.sim.messages.at(-1)).toBe('Can\'t undo: That connection is gone.')
    expect(h.sim.journal.canUndo).toBe(true)
    expect(h.sim.journal.canRedo).toBe(false)
  })
})

describe('Choose placement: contested positions as ghosts', () => {
  const contest = (sim: ShellSim): PlacementContest => ({
    file: sim.refOf('a'),
    candidates: [{ id: 'mine', x: 16, y: 16, origin: 'this-tab', label: 'this tab', at: 100 }, { id: 'theirs', x: 700, y: 400, origin: 'other', label: 'other tab · 12:04', at: 200 }],
  })
  const contested = (sim: ShellSim) => {
    sim.contests = [contest(sim)]
    sim.placementStates = { [fileKey(sim.refOf('a'))]: 'contested' }
  }

  it('clicking a ghost keeps that position; the contest settles and the card is free again', () => {
    const h = view(contested)
    const ghost = h.scene().cards.find((c) => c.role === 'ghost')!
    expect(ghost.key).toBe(ghostKey(h.keyOf('a'), 'theirs'))
    const at = { x: ghost.rect.x + 70, y: ghost.rect.y + 60 }
    h.mark()
    h.down({ kind: 'card', key: ghost.key }, at); h.up(at)
    expect(h.intents).toEqual([{ kind: 'choose-placement', file: h.sim.refOf('a'), candidateId: 'theirs' }])
    expect(h.sim.placementOf('a')).toEqual({ x: 700, y: 400 })
    expect(h.scene().cards.some((c) => c.role === 'ghost')).toBe(false)
    h.drag('a', h.empty(300, 600))
    expect(h.intentsOf('place')).toHaveLength(1)
  })

  it('does not select the real card or move the selection when a ghost is clicked, and a ghost cannot be dragged', () => {
    const h = view(contested)
    h.click('b'); h.mark()
    const ghost = h.scene().cards.find((c) => c.role === 'ghost')!
    h.down({ kind: 'card', key: ghost.key }, { x: ghost.rect.x + 70, y: ghost.rect.y + 60 })
    expect(h.intentsOf('select')).toEqual([])
    h.move({ x: ghost.rect.x + 300, y: ghost.rect.y + 60 }); h.move({ x: ghost.rect.x + 400, y: ghost.rect.y + 160 })
    expect(h.mode).toBe('pressing')
    h.up({ x: ghost.rect.x + 400, y: ghost.rect.y + 160 })
    expect(h.intents).toEqual([])
    expect(h.sim.selectionIds).toEqual(['b'])
  })

  it('reaches a ghost with the keyboard and chooses it with Enter', () => {
    const h = view(contested)
    const ghost = h.scene().cards.find((c) => c.role === 'ghost')!
    h.press('End')
    expect(h.focused).toBe(ghost.key)                                    // the ghost is the last card in reading order
    h.mark()
    h.press('Enter')
    expect(h.intents).toEqual([{ kind: 'choose-placement', file: h.sim.refOf('a'), candidateId: 'theirs' }])
  })

  it('still chooses it when the shell has echoed the focus: it hears the file, and the canvas keeps the ghost it had, so Enter is a choice and not an open', () => {
    const h = view(contested, { echoFocus: true })
    const ghost = h.scene().cards.find((c) => c.role === 'ghost')!
    h.press('End')
    expect(h.focused).toBe(ghost.key)                                    // after the shell's echo, which named the real file
    h.mark()
    h.press('Enter')
    expect(h.intents).toEqual([{ kind: 'choose-placement', file: h.sim.refOf('a'), candidateId: 'theirs' }])
    expect(h.intentsOf('open')).toEqual([])
  })

  it('choosing is not undoable: the journal holds it as a barrier and says why', () => {
    const h = view(contested)
    const ghost = h.scene().cards.find((c) => c.role === 'ghost')!
    h.down({ kind: 'card', key: ghost.key }, { x: ghost.rect.x + 70, y: ghost.rect.y + 60 }); h.up({ x: ghost.rect.x + 70, y: ghost.rect.y + 60 })
    h.press('z', MOD)
    expect(h.sim.messages.at(-1)).toBe('Can\'t undo: Position kept settles a contested position.')
  })

  it('is a verb of arranging: without place a ghost can be seen and not chosen', () => {
    const h = view((sim) => { contested(sim); sim.capabilities = capsExcept('place') })
    const ghost = h.scene().cards.find((c) => c.role === 'ghost')!
    h.down({ kind: 'card', key: ghost.key }, { x: ghost.rect.x + 70, y: ghost.rect.y + 60 }); h.up({ x: ghost.rect.x + 70, y: ghost.rect.y + 60 })
    expect(h.intents).toEqual([])
  })
})

describe('Menu', () => {
  it('a right-click on an unselected card selects it, then asks for its menu at the pointer', () => {
    const h = view(undefined, { viewport: { x: 100, y: 50, w: 1024, h: 768 } })
    const at = h.at('a')
    h.contextMenu({ kind: 'card', key: h.keyOf('a') }, at)
    expect(h.intents).toEqual([
      { kind: 'select', files: [h.sim.refOf('a')] },
      { kind: 'menu', files: [h.sim.refOf('a')], clientX: at.x + 100, clientY: at.y + 50, at: toScene(h.camera, at) },
    ])
    expect(h.state.mode).toMatchObject({ kind: 'menu', files: [h.keyOf('a')] })
    expect(h.effectsOf('openMenu')).toEqual([{ kind: 'openMenu', anchor: at, files: [h.keyOf('a')] }])
  })

  it('a right-click on a member of a selection keeps the selection', () => {
    const h = view()
    h.click('a'); h.click('b', { mods: MOD }); h.mark()
    h.contextMenu({ kind: 'card', key: h.keyOf('b') }, h.at('b'))
    expect(h.intents.map((i) => i.kind)).toEqual(['menu'])
    expect(ids(h.intentsOf('menu')[0]!.files)).toEqual(['a', 'b'])
  })

  it('a right-click on empty space clears the selection and asks for the background menu, with the scene point', () => {
    const h = view()
    h.camera = { x: -30, y: -20, zoom: 2 }
    h.click('a'); h.mark()
    h.contextMenu({ kind: 'background' }, { x: 600, y: 500 })
    expect(h.intents).toEqual([{ kind: 'select', files: [] }, { kind: 'menu', files: [], clientX: 600, clientY: 500, at: { x: 330, y: 270 } }])
  })

  it('the menu key and Shift+F10 open the menu of the focused card, at the card', () => {
    const h = view()
    h.click('c'); h.mark()
    h.press('ContextMenu')
    h.send({ type: 'menu-closed' })
    h.press('F10', SHIFT)
    const menus = h.intentsOf('menu')
    expect(menus).toHaveLength(2)
    expect(ids(menus[0]!.files)).toEqual(['c'])
    expect(menus[0]!.clientX).toBe(h.at('c').x)
    expect(menus[0]!.clientY).toBe(h.at('c').y)
  })

  it('a long press on a card is the item menu', () => {
    const h = view()
    h.down({ kind: 'card', key: h.keyOf('d') }, h.at('d'), { pointerType: 'touch' })
    h.send({ type: 'longpress', pointerId: 1 })
    expect(h.intents.map((i) => i.kind)).toEqual(['select', 'menu'])
    h.up(h.at('d'))
    expect(h.mode).toBe('menu')
    h.send({ type: 'menu-closed' })
    expect(h.mode).toBe('idle')
  })

  it('a pointer press elsewhere closes the menu and goes on to act', () => {
    const h = view()
    h.contextMenu({ kind: 'card', key: h.keyOf('a') }, h.at('a'))
    h.click('b')
    expect(h.sim.selectionIds).toEqual(['b'])
    expect(h.mode).toBe('idle')
  })
})

describe('Pan and zoom', () => {
  it('the wheel pans; Ctrl or Cmd with the wheel zooms about the pointer, clamped to [0.5, 2]', () => {
    const h = view()
    h.send({ type: 'wheel', at: { x: 100, y: 100 }, deltaX: 40, deltaY: 100, mods: mods() })
    expect(h.camera).toEqual({ x: -40, y: -100, zoom: 1 })
    h.camera = { x: 0, y: 0, zoom: 1 }
    const under = toScene(h.camera, { x: 400, y: 300 })
    h.send({ type: 'wheel', at: { x: 400, y: 300 }, deltaX: 0, deltaY: -100, mods: MOD })
    expect(h.camera.zoom).toBeCloseTo(1.1, 12)
    const now = toViewport(h.camera, under)
    expect(now.x).toBeCloseTo(400, 9); expect(now.y).toBeCloseTo(300, 9)
    for (let i = 0; i < 30; i++) h.send({ type: 'wheel', at: { x: 400, y: 300 }, deltaX: 0, deltaY: -100, mods: CTRL })
    expect(h.camera.zoom).toBe(2)
    for (let i = 0; i < 60; i++) h.send({ type: 'wheel', at: { x: 400, y: 300 }, deltaX: 0, deltaY: 100, mods: MOD })
    expect(h.camera.zoom).toBe(0.5)
    expect(h.intents).toEqual([])
    expect(h.last.handled).toBe(true)
  })

  it('Space and drag pans; releasing Space after a pan does not toggle the focused card', () => {
    const h = view()
    h.click('a'); h.mark()
    h.key(' ')
    h.down({ kind: 'background' }, h.empty())
    expect(h.state.mode).toMatchObject({ kind: 'panning', via: 'space' })
    h.move({ x: 950, y: 740 })
    expect(h.camera).toEqual({ x: 50, y: 40, zoom: 1 })
    h.up({ x: 950, y: 740 })
    h.send({ type: 'keyup', key: ' ', mods: mods() })
    expect(h.intents).toEqual([])
    expect(h.sim.selectionIds).toEqual(['a'])
  })

  it('middle-drag pans at any zoom, one pixel of pointer for one pixel of content', () => {
    const h = view()
    h.camera = { x: 10, y: 10, zoom: 2 }
    h.down({ kind: 'card', key: h.keyOf('a') }, h.at('a'), { button: 1 })
    expect(h.state.mode).toMatchObject({ kind: 'panning', via: 'middle' })
    const before = toViewport(h.camera, { x: 16, y: 16 })
    h.move({ x: h.at('a').x + 30, y: h.at('a').y - 20 })
    const after = toViewport(h.camera, { x: 16, y: 16 })
    expect([after.x - before.x, after.y - before.y]).toEqual([30, -20])
    h.up({ x: h.at('a').x + 30, y: h.at('a').y - 20 })
    expect(h.intents).toEqual([])
  })

  it('two fingers pan and pinch together: the content under the fingers stays under them', () => {
    const h = view()
    h.down({ kind: 'background' }, { x: 300, y: 300 }, { pointerId: 1, pointerType: 'touch' })
    h.down({ kind: 'background' }, { x: 500, y: 300 }, { pointerId: 2, pointerType: 'touch' })
    expect(h.mode).toBe('pinching')
    const under = toScene(h.camera, { x: 400, y: 300 })
    h.move({ x: 700, y: 300 }, { pointerId: 2 })
    expect(h.camera.zoom).toBe(2)
    const now = toViewport(h.camera, under)
    expect(now.x).toBeCloseTo(500, 9); expect(now.y).toBeCloseTo(300, 9)
    h.up({ x: 700, y: 300 }, { pointerId: 2 }); h.up({ x: 300, y: 300 }, { pointerId: 1 })
    expect(h.mode).toBe('idle')
    expect(h.intents).toEqual([])
  })

  it('Cmd-0 resets the view to the content, never past zoom 1; Cmd-plus and Cmd-minus zoom about the centre', () => {
    const h = view()
    h.camera = { x: -500, y: 300, zoom: 0.7 }
    h.press('0', MOD)
    expect(h.camera).toEqual({ x: 264, y: 224, zoom: 1 })
    h.press('=', MOD)
    expect(h.camera.zoom).toBe(1.25)
    const centre = toScene({ x: 264, y: 224, zoom: 1 }, { x: 512, y: 384 })
    const back = toViewport(h.camera, centre)
    expect(back.x).toBeCloseTo(512, 9); expect(back.y).toBeCloseTo(384, 9)
    h.press('-', MOD); h.press('-', MOD)
    expect(h.camera.zoom).toBeCloseTo(0.8, 12)
    h.press('+', MOD)
    expect(h.camera.zoom).toBeCloseTo(1, 12)
    expect(h.intents).toEqual([])
  })

  it('the controls\' commands do the same, and an empty folder resets to the origin', () => {
    const h = view()
    h.send({ type: 'command', command: 'zoom-in' })
    expect(h.camera.zoom).toBe(1.25)
    h.send({ type: 'command', command: 'zoom-out' })
    expect(h.camera.zoom).toBe(1)
    h.send({ type: 'command', command: 'reset-view' })
    expect(h.camera).toEqual({ x: 264, y: 224, zoom: 1 })
    const empty = new Harness()
    empty.camera = { x: 99, y: 99, zoom: 1.5 }
    empty.send({ type: 'command', command: 'reset-view' })
    expect(empty.camera).toEqual({ x: 0, y: 0, zoom: 1 })
  })

  it('fits a big folder at the minimum zoom, not below it', () => {
    const h = view((sim) => { sim.addFile('far', { x: 9000, y: 9000 }) })
    h.send({ type: 'command', command: 'reset-view' })
    expect(h.camera.zoom).toBe(0.5)
  })
})
