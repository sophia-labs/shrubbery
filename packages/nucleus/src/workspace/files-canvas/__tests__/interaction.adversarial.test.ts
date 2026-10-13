// @vitest-environment node
/**
 * The adversarial set the Eyewright ran on the prototype (pointercancel mid-drag, scope change
 * mid-gesture, a remote delete of the card being named, an OS drop during naming, keyboard during a
 * drag, a contest arriving during a drag of the contested card, two-pointer gestures interrupted), and
 * a fuzz suite that throws a few thousand random events at the reducer and checks the invariants of
 * the laws after every one.
 */
import { describe, expect, it } from 'vitest'
import { fileKey, type FileCanvasCapabilities, type FileCanvasIntent } from '../../folder-view-contract.js'
import { ALL_CAPS } from './support/fixtures.js'
import { primedSnapEngine } from './support/primed-engine.js'
import { ALT, Harness, MOD, SHIFT, mods, type StepInfo } from './support/harness.js'
import { forSeeds, type Rng } from './support/lcg.js'
import { ShellSim } from './support/shell-sim.js'
import type { CanvasEngine } from '../engine-port.js'
import { NO_MODS, reduce, type CanvasEvent } from '../interaction.js'

function view(configure?: (sim: ShellSim) => void, engine?: CanvasEngine): Harness {
  const sim = new ShellSim()
  sim.addFile('a', { x: 16, y: 16 })
  sim.addFile('b', { x: 176, y: 16 })
  sim.addFile('c', { x: 336, y: 16 })
  sim.addFile('F', { folder: true, label: 'Datasheets', x: 16, y: 176 })
  sim.addFile('d', { x: 176, y: 176 })
  configure?.(sim)
  return new Harness({ sim, engine })
}
const consequential = (intents: readonly FileCanvasIntent[]) => intents.filter((i) => i.kind !== 'select')

describe('adversarial sequences', () => {
  it('a pointercancel ends every kind of gesture without effect', () => {
    const gestures: [string, (h: Harness) => void][] = [
      ['press', (h) => { h.down({ kind: 'card', key: h.keyOf('a') }, h.at('a')) }],
      ['drag', (h) => { h.drag('a', h.empty(700, 500), { release: false }) }],
      ['marquee', (h) => { h.marquee({ x: 5, y: 600 }, { x: 330, y: 700 }, { release: false }) }],
      ['pan', (h) => { h.down({ kind: 'background' }, h.empty(), { button: 1 }); h.move({ x: 800, y: 650 }) }],
      ['connect', (h) => { h.down({ kind: 'handle', key: h.keyOf('a') }, h.at('a')); h.move(h.at('b')) }],
    ]
    for (const [name, start] of gestures) {
      const h = view()
      start(h); h.mark()
      h.cancel()
      expect(h.mode, name).toBe('idle')
      expect(consequential(h.intents), name).toEqual([])
      h.up(h.empty(700, 500))
      expect(h.intents, `${name}: the release after the cancel`).toEqual([])
      expect(h.effectsOf('releasePointer').length, name).toBeGreaterThanOrEqual(1)
    }
  })

  it('a remote delete of the card being named ends the edit quietly, and the commit that follows says nothing', () => {
    const h = view()
    h.click('a'); h.press('F2'); h.type('Renamed.pdf'); h.mark()
    h.sim.files.get(h.keyOf('a'))!.removed = true
    h.send({ type: 'sync' })
    expect(h.state.naming).toBeNull()
    h.commit(); h.escapeInput()
    expect(h.intents).toEqual([])
  })

  it('a remote delete of a draft ends its edit too', () => {
    const h = view()
    h.send({ type: 'command', command: 'new-folder' }); h.send({ type: 'sync' }); h.type('Quotes'); h.mark()
    h.sim.drafts = []; h.sim.naming = null
    h.commit()
    expect(h.intents).toEqual([])
    expect(h.state.naming).toBeNull()
  })

  it('a remote delete of the card being dragged cancels the drag, and the release writes nothing', () => {
    const h = view()
    h.drag('a', h.empty(700, 500), { release: false }); h.mark()
    h.sim.files.get(h.keyOf('a'))!.removed = true
    h.move(h.empty(710, 510))
    expect(h.mode).toBe('idle')
    expect(h.effectsOf('endDrag')).toEqual([{ kind: 'endDrag', outcome: 'cancelled' }])
    h.up(h.empty(710, 510))
    expect(h.intents).toEqual([])
  })

  it('an OS drop during naming is one add, and the name edit survives it', () => {
    const h = view()
    h.click('a'); h.press('F2'); h.type('Half a nam'); h.mark()
    h.hoverFiles(h.empty()); h.drop(h.empty(700, 500), ['datasheet.pdf'])
    expect(h.intents.map((i) => i.kind)).toEqual(['add'])
    expect(h.state.naming).toMatchObject({ text: 'Half a nam', submitted: false })
    h.type('Half a name.pdf'); h.commit()
    expect(h.intentsOf('rename')).toEqual([{ kind: 'rename', file: h.sim.refOf('a'), name: 'Half a name.pdf' }])
  })

  it('the keyboard during a drag is ignored, except Escape, which cancels it', () => {
    const h = view()
    h.click('b')
    h.drag('a', h.empty(700, 500), { release: false }); h.mark()
    for (const [key, m] of [['Delete', NO_MODS], ['Backspace', NO_MODS], ['F2', NO_MODS], ['Enter', NO_MODS], ['Enter', ALT], ['a', MOD], ['x', MOD], ['v', MOD], ['z', MOD],
      ['ArrowRight', NO_MODS], ['ArrowRight', ALT], ['Home', NO_MODS], [' ', NO_MODS], ['n', mods({ meta: true, shift: true })], ['0', MOD], ['ContextMenu', NO_MODS]] as const) {
      const step = h.key(key, m)
      expect(step.intents, `${key}`).toEqual([])
      expect(step.handled, `${key}`).toBe(false)
      expect(h.mode, `${key}`).toBe('dragging')
    }
    h.send({ type: 'keyup', key: ' ', mods: NO_MODS })
    h.key('Escape')
    expect(h.mode).toBe('idle')
    expect(h.intents).toEqual([])
    expect(h.effectsOf('endDrag')).toEqual([{ kind: 'endDrag', outcome: 'cancelled' }])
  })

  it('a contest arriving during a drag of the contested card takes it out of the drag; nothing is written for it', () => {
    const h = view()
    h.drag('a', h.empty(700, 500), { release: false }); h.mark()
    h.sim.contests = [{ file: h.sim.refOf('a'), candidates: [
      { id: 'mine', x: 16, y: 16, origin: 'this-tab', label: 'this tab', at: 1 }, { id: 'theirs', x: 500, y: 300, origin: 'other', label: 'other tab', at: 2 }] }]
    h.sim.placementStates = { [h.keyOf('a')]: 'contested' }
    h.move(h.empty(710, 510))
    expect(h.mode).toBe('idle')
    h.up(h.empty(710, 510))
    expect(h.intents).toEqual([])
    expect(h.sim.placementOf('a')).toEqual({ x: 16, y: 16 })
  })

  it('a contest on one card of a dragged selection leaves the others dragging', () => {
    const h = view()
    h.click('a'); h.click('b', { mods: MOD })
    h.drag('a', h.empty(700, 500), { release: false }); h.mark()
    h.sim.placementStates = { [h.keyOf('a')]: 'pending' }
    h.move(h.empty(710, 510))
    expect(h.dragMode().files).toEqual([h.keyOf('b')])
    h.up(h.empty(710, 510))
    expect(h.intentsOf('place')[0]!.placements.map((p) => p.file.id)).toEqual(['b'])
  })

  it('a second finger during a touch drag cancels the drag into a pinch, and nothing is written when the fingers lift in either order', () => {
    for (const order of [[1, 2], [2, 1]]) {
      const h = view()
      h.down({ kind: 'card', key: h.keyOf('a') }, h.at('a'), { pointerId: 1, pointerType: 'touch' })
      h.move({ x: h.at('a').x + 80, y: h.at('a').y + 80 }, { pointerId: 1 }); h.move({ x: h.at('a').x + 160, y: h.at('a').y + 160 }, { pointerId: 1 })
      expect(h.mode).toBe('dragging')
      h.mark()
      h.down({ kind: 'background' }, h.empty(600, 600), { pointerId: 2, pointerType: 'touch' })
      expect(h.mode).toBe('pinching')
      expect(h.effectsOf('endDrag')).toEqual([{ kind: 'endDrag', outcome: 'cancelled' }])
      h.move({ x: 650, y: 650 }, { pointerId: 2 })
      for (const id of order) h.up({ x: 300, y: 300 }, { pointerId: id })
      expect(h.mode).toBe('idle')
      expect(h.intents).toEqual([])
      expect(h.sim.placementOf('a')).toEqual({ x: 16, y: 16 })
    }
  })

  it('a three-finger touch, or a finger lifting early, never leaves a gesture behind', () => {
    const h = view()
    h.down({ kind: 'background' }, { x: 300, y: 300 }, { pointerId: 1, pointerType: 'touch' })
    h.down({ kind: 'background' }, { x: 500, y: 300 }, { pointerId: 2, pointerType: 'touch' })
    h.down({ kind: 'background' }, { x: 400, y: 500 }, { pointerId: 3, pointerType: 'touch' })
    h.up({ x: 300, y: 300 }, { pointerId: 1 })
    h.move({ x: 520, y: 310 }, { pointerId: 2 })
    h.cancel(2); h.cancel(3)
    expect(h.mode).toBe('idle')
    expect(h.state.pointers).toEqual([])
    expect(h.intents).toEqual([])
  })

  it('ignores pointer events of a pointer it is not tracking, and a press on a card that is not in the scene', () => {
    const h = view()
    h.down({ kind: 'card', key: h.keyOf('a') }, h.at('a'), { pointerId: 1 })
    h.move(h.empty(700, 500), { pointerId: 9 }); h.up(h.empty(700, 500), { pointerId: 9 })
    expect(h.mode).toBe('pressing')
    h.up(h.at('a'), { pointerId: 1 })
    h.mark()
    const forged = h.down({ kind: 'card', key: fileKey({ ...h.sim.refOf('a'), id: 'forged' }) }, h.at('b'))
    expect(forged.handled).toBe(false)
    expect(h.mode).toBe('idle')
    h.up(h.at('b'))
    h.send({ type: 'handle-activate', key: 'forged' })
    expect(h.intents).toEqual([])
    expect(h.mode).toBe('idle')
  })

  it('a second mouse button during a gesture does not start another, and a right-button press starts nothing itself', () => {
    const h = view()
    h.down({ kind: 'card', key: h.keyOf('a') }, h.at('a'), { button: 2 })
    expect(h.mode).toBe('idle')
    h.drag('b', h.empty(700, 500), { release: false })
    h.down({ kind: 'card', key: h.keyOf('c') }, h.at('c'), { pointerId: 2 })
    expect(h.dragMode().files).toEqual([h.keyOf('b')])
    h.up(h.empty(700, 500))
    expect(h.intentsOf('place')[0]!.placements.map((p) => p.file.id)).toEqual(['b'])
  })

  it('losing focus ends a drag and a held Space', () => {
    const h = view()
    h.key(' ')
    h.drag('a', h.empty(700, 500), { release: false }); h.mark()
    h.send({ type: 'blur' })
    expect(h.mode).toBe('idle')
    expect(h.state.space).toEqual({ down: false, panned: false })
    expect(h.intents).toEqual([])
    h.send({ type: 'keyup', key: ' ', mods: NO_MODS })
    expect(h.intents).toEqual([])
  })

  it('a ghost chosen after its contest has been settled elsewhere says nothing', () => {
    const h = view((sim) => {
      sim.contests = [{ file: sim.refOf('a'), candidates: [
        { id: 'mine', x: 16, y: 16, origin: 'this-tab', label: 'this tab', at: 1 }, { id: 'theirs', x: 700, y: 400, origin: 'other', label: 'other tab', at: 2 }] }]
    })
    const ghost = h.scene().cards.find((c) => c.role === 'ghost')!
    const at = { x: ghost.rect.x + 50, y: ghost.rect.y + 50 }
    h.down({ kind: 'card', key: ghost.key }, at)
    h.sim.contests = []
    h.up(at)
    expect(h.intents).toEqual([])
  })

  it('a relation picked after one of its cards has gone connects nothing', () => {
    const h = view()
    h.down({ kind: 'handle', key: h.keyOf('a') }, h.at('a')); h.move(h.at('b')); h.up(h.at('b'))
    expect(h.mode).toBe('picking')
    h.sim.files.get(h.keyOf('b'))!.removed = true
    h.send({ type: 'relation-picked', relation: 'rel:explains' })
    expect(h.intents).toEqual([])
    expect(h.mode).toBe('idle')
  })

  it('does not throw on an empty scene, whatever it is asked', () => {
    const h = new Harness()
    for (const key of ['ArrowRight', 'Home', 'End', 'Enter', 'F2', 'Delete', ' ', 'Escape', 'ContextMenu']) h.press(key)
    h.press('a', MOD); h.press('v', MOD); h.press('x', MOD); h.press('z', MOD); h.press('0', MOD)
    for (const command of ['tidy', 'reset-view', 'zoom-in', 'zoom-out', 'new-folder'] as const) h.send({ type: 'command', command })
    h.clickBackground(); h.marquee({ x: 0, y: 0 }, { x: 300, y: 300 }); h.drop(h.empty())
    // Nothing to select, move, remove or arrange; what is left is Undo (the shell's to refuse), a draft asked for and committed, and the drop.
    const kinds = h.intents.map((i) => i.kind)
    expect(kinds).toContain('new-folder')
    expect(kinds).toContain('add')
    for (const absent of ['place', 'move', 'remove', 'rename', 'open', 'connect', 'choose-placement']) expect(kinds).not.toContain(absent)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Fuzz: random events, invariants after each.
// ---------------------------------------------------------------------------------------------------------------

const KEYS: [string, ReturnType<typeof mods>][] = [
  ['ArrowUp', NO_MODS], ['ArrowDown', NO_MODS], ['ArrowLeft', NO_MODS], ['ArrowRight', NO_MODS], ['ArrowRight', SHIFT], ['ArrowLeft', SHIFT], ['Home', NO_MODS], ['End', NO_MODS],
  ['Enter', NO_MODS], ['Enter', ALT], [' ', NO_MODS], ['Escape', NO_MODS], ['F2', NO_MODS], ['Delete', NO_MODS], ['Backspace', NO_MODS], ['a', MOD], ['x', MOD], ['v', MOD],
  ['z', MOD], ['Z', mods({ meta: true, shift: true })], ['n', mods({ meta: true, shift: true })], ['0', MOD], ['=', MOD], ['-', MOD], ['ContextMenu', NO_MODS], ['F10', SHIFT],
  ['ArrowRight', ALT], ['ArrowDown', mods({ alt: true, shift: true })], ['Tab', NO_MODS], ['q', NO_MODS],
]

function randomPoint(h: Harness, rng: Rng): { x: number; y: number } {
  const cards = h.scene().cards
  if (cards.length && rng.chance(0.6)) {
    const c = rng.pick(cards)
    return { x: (c.rect.x + rng.range(0, c.rect.w) + h.camera.x) * h.camera.zoom, y: (c.rect.y + rng.range(0, c.rect.h) + h.camera.y) * h.camera.zoom }
  }
  return { x: rng.range(-50, 1100), y: rng.range(-50, 800) }
}

function randomTarget(h: Harness, rng: Rng) {
  const cards = h.scene().cards
  const r = rng.next()
  if (cards.length && r < 0.5) return { kind: 'card' as const, key: rng.pick(cards).key }
  if (cards.length && r < 0.6) return { kind: 'label' as const, key: rng.pick(cards).key }
  if (cards.length && r < 0.7) return { kind: 'handle' as const, key: rng.pick(cards).key }
  if (r < 0.75) return { kind: 'card' as const, key: 'forged-key' }
  return { kind: 'background' as const }
}

function randomEvent(h: Harness, rng: Rng): CanvasEvent {
  const m = rng.chance(0.15) ? rng.pick([SHIFT, MOD, ALT]) : NO_MODS
  const pointerId = rng.chance(0.85) ? 1 : rng.pick([2, 3])
  h.clock += rng.range(5, 700)
  const t = h.clock
  switch (rng.int(30)) {
    case 0: case 1: case 2: case 3: return { type: 'pointerdown', pointerId, at: randomPoint(h, rng), button: rng.chance(0.9) ? 0 : rng.pick([1, 2]), mods: m, target: randomTarget(h, rng), t, pointerType: rng.chance(0.2) ? 'touch' : undefined }
    case 4: case 5: case 6: case 7: case 8: return { type: 'pointermove', pointerId, at: randomPoint(h, rng), mods: m, t, external: rng.chance(0.1) ? { folder: h.sim.refOf('F', true) } : undefined }
    case 9: case 10: case 11: return { type: 'pointerup', pointerId, at: randomPoint(h, rng), mods: m, t, external: rng.chance(0.1) ? { folder: rng.chance(0.5) ? null : h.sim.refOf('F', true) } : undefined }
    case 12: return { type: 'pointercancel', pointerId }
    case 13: return { type: 'longpress', pointerId }
    case 14: return { type: 'wheel', at: randomPoint(h, rng), deltaX: rng.range(-50, 50), deltaY: rng.range(-200, 200), mods: rng.chance(0.4) ? MOD : NO_MODS }
    case 15: case 16: case 17: case 18: { const [key, km] = rng.pick(KEYS); return { type: 'keydown', key, mods: km, repeat: rng.chance(0.1) } }
    case 19: { const [key, km] = rng.pick(KEYS); return { type: 'keyup', key, mods: km } }
    case 20: return { type: 'contextmenu', at: randomPoint(h, rng), target: randomTarget(h, rng), mods: NO_MODS }
    case 21: return rng.chance(0.5) ? { type: 'dragover', at: randomPoint(h, rng) } : { type: 'dragleave' }
    case 22: return { type: 'drop', at: randomPoint(h, rng), files: [new File(['x'], `${rng.pick(['one', 'two', 'three'])}.pdf`)] }
    case 23: return { type: 'name-input', text: rng.pick(['', 'x', 'Quotes', 'b.pdf', '  ']) }
    case 24: return rng.chance(0.6) ? { type: 'name-commit', text: rng.chance(0.5) ? rng.pick(['Quotes', '', 'b.pdf']) : undefined } : { type: 'name-cancel' }
    case 25: return rng.chance(0.5) ? { type: 'handle-activate', key: rng.pick(h.scene().cards.concat([{ key: 'forged' } as never])).key } : { type: 'relation-picked', relation: 'rel:explains' }
    case 26: return rng.pick([{ type: 'relation-cancelled' }, { type: 'menu-closed' }, { type: 'blur' }, { type: 'sync' }] as CanvasEvent[])
    case 27: return { type: 'command', command: rng.pick(['tidy', 'reset-view', 'zoom-in', 'zoom-out', 'new-folder'] as const) }
    default: return { type: 'sync' }
  }
}

/** Whole gestures, with a raw event sometimes dropped into the middle of one: depth for the fuzz, and interruptions. */
function macro(h: Harness, rng: Rng): void {
  const cards = h.scene().cards
  const interrupt = () => { if (rng.chance(0.12)) h.send(randomEvent(h, rng)) }
  const real = cards.filter((c) => c.role === 'real')
  const pick = () => (real.length ? rng.pick(real) : null)
  const centre = (key: string) => {
    const c = h.scene().byKey.get(key)
    return c ? { x: (c.rect.x + c.rect.w / 2 + h.camera.x) * h.camera.zoom, y: (c.rect.y + c.rect.h / 2 + h.camera.y) * h.camera.zoom } : randomPoint(h, rng)
  }
  const a = pick(), b = pick()
  switch (rng.int(9)) {
    case 0: if (a) { h.send({ type: 'keydown', key: 'F2', mods: NO_MODS }); interrupt(); h.send({ type: 'name-input', text: rng.pick(['Quote.pdf', 'b.pdf', '', 'Notes']) }); interrupt(); h.send({ type: 'name-commit' }) } break
    case 1: if (a && b) { h.down({ kind: 'handle', key: a.key }, centre(a.key)); h.move(centre(a.key)); interrupt(); h.move({ x: centre(a.key).x + 30, y: centre(a.key).y }); h.move(centre(b.key)); interrupt(); h.up(centre(b.key)); interrupt(); h.send({ type: 'relation-picked', relation: 'rel:explains' }) } break
    case 2: if (a) { h.down({ kind: 'card', key: a.key }, centre(a.key)); interrupt(); h.move(randomPoint(h, rng)); h.move(randomPoint(h, rng)); interrupt(); h.up(randomPoint(h, rng)) } break
    case 3: if (a && b) { h.down({ kind: 'card', key: a.key }, centre(a.key)); h.move({ x: centre(a.key).x + 20, y: centre(a.key).y + 20 }); h.move(centre(b.key)); interrupt(); h.up(centre(b.key)) } break
    case 4: h.send({ type: 'command', command: 'new-folder' }); h.send({ type: 'sync' }); interrupt(); h.send({ type: 'name-input', text: rng.pick(['Quotes', '', 'b.pdf']) }); h.send({ type: 'name-commit' }); break
    case 5: { const ghost = cards.find((c) => c.role === 'ghost'); if (ghost) { const at = centre(ghost.key); h.down({ kind: 'card', key: ghost.key }, at); h.up(at) } } break
    case 6: if (a) { const at = centre(a.key); h.down({ kind: 'card', key: a.key }, at); h.up(at); h.clock += rng.pick([100, 800, 3000]); h.down({ kind: rng.pick(['card', 'label'] as const), key: a.key }, at); h.up(at) } break
    case 7: h.down({ kind: 'background' }, randomPoint(h, rng)); h.move(randomPoint(h, rng)); h.move(randomPoint(h, rng)); interrupt(); h.up(randomPoint(h, rng), { mods: rng.chance(0.3) ? SHIFT : NO_MODS }); break
    default: if (a) { h.send({ type: 'handle-activate', key: a.key }); h.send({ type: 'keydown', key: rng.pick(['ArrowRight', 'ArrowDown', 'ArrowLeft']), mods: NO_MODS }); interrupt(); h.send({ type: 'keydown', key: rng.pick(['Enter', 'Escape']), mods: NO_MODS }); h.send({ type: 'relation-picked', relation: 'rel:supports' }) }
  }
}

function disturbShell(h: Harness, rng: Rng): void {
  const sim = h.sim
  const pick = [...sim.files.values()].filter((f) => !f.removed && f.parent === sim.viewed)
  switch (rng.int(6)) {
    case 0: if (pick.length > 2) rng.pick(pick).removed = true; break
    case 1: if (pick.length) { const f = rng.pick(pick); sim.placementStates = { ...sim.placementStates, [fileKey(f.ref)]: rng.pick(['pending', 'contested', 'applied', 'rejected'] as const) } } break
    case 2: sim.placementStates = {}; break
    case 3: if (pick.length) {
      const f = rng.pick(pick)
      sim.contests = [{ file: f.ref, candidates: [{ id: 'm', x: 40, y: 40, origin: 'this-tab', label: 'this tab', at: 1 }, { id: 'o', x: 500, y: 300, origin: 'other', label: 'other tab', at: 2 }] }]
    } break
    case 4: sim.contests = []; break
    default: for (const f of sim.files.values()) f.removed = false
  }
}

/** A bare assertion: the fuzz suite makes tens of thousands of them, and `expect` is the slow way to say "true". */
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

describe('fuzz: random events, the invariants of the laws after every one', () => {
  const needs: Partial<Record<FileCanvasIntent['kind'], keyof FileCanvasCapabilities>> = {
    place: 'place', move: 'move', rename: 'rename', create: 'create', 'new-folder': 'create', add: 'add', remove: 'remove', connect: 'connect', 'choose-placement': 'place',
  }
  const FRESH = new Set(['pointerdown', 'keydown', 'command', 'drop', 'contextmenu', 'wheel', 'dragover', 'handle-activate'])

  function check(info: StepInfo, caps: FileCanvasCapabilities, afterEpochChange: boolean, dead: boolean): void {
    const { event, before, ctx, step } = info
    const label = `${event.type}${'key' in event ? ` ${event.key}` : ''}`
    if (dead) { assert(step.intents.length === 0 && step.effects.length === 0, `${label}: the canvas acted after destroy`); return }
    // Law 7: a gesture that began before a scope change has no intents afterwards.
    if (afterEpochChange && !FRESH.has(event.type)) assert(step.intents.length === 0, `${label} after a scope change emitted ${step.intents.map((i) => i.kind)}`)
    const scene = ctx.scene
    const real = (key: string) => scene.byKey.get(key)?.role === 'real'
    const locked = (key: string) => scene.byKey.get(key)?.locked === true
    const kinds = step.intents.map((i) => i.kind)
    // Law 1: one gesture is a move or a place, never both.
    assert(!(kinds.includes('move') && kinds.includes('place')), `${label}: move and place together`)
    for (const intent of step.intents) {
      const need = needs[intent.kind]
      if (need) assert(caps[need], `${label}: ${intent.kind} without ${need}`)
      if (intent.kind === 'open' && intent.beside) assert(caps.openBeside, `${label}: open beside`)
      switch (intent.kind) {
        case 'rename': case 'create':
          // Law 2: never without a name edit that was already open (or that the shell had just opened).
          assert(before.naming !== null || ctx.naming !== null, `${label}: ${intent.kind} without naming`)
          break
        case 'name-cancel':
          assert(before.naming !== null || ctx.naming !== null, `${label}: name-cancel without naming`)
          break
        case 'select': {
          // Law 4: only a change.
          const now = new Set(intent.files.map(fileKey)), was = new Set(ctx.selection)
          assert(!(now.size === was.size && [...now].every((k) => was.has(k))), `${label}: select without a change`)
          for (const f of intent.files) assert(real(fileKey(f)), `${label}: select of a card that is not a real card`)
          break
        }
        case 'place': {
          // Law 5: only cards that can be dragged, once each.
          const seen = new Set<string>()
          for (const p of intent.placements) {
            const key = fileKey(p.file)
            assert(real(key) && !locked(key), `${label}: place of ${p.file.id}`)
            assert(!(seen.has(key)), `${label}: place twice`)
            seen.add(key)
            assert(Number.isInteger(p.x) && Number.isInteger(p.y), `${label}: non-integer placement`)
            assert(p.coordinateSpace === 'folder-canvas', `${label}: a placement outside folder-canvas`)
          }
          assert(intent.placements.length > 0, `${label}: an empty place`)
          break
        }
        case 'move':
          assert(intent.files.length > 0, `${label}: a move of nothing`)
          if (event.type === 'pointerup') for (const f of intent.files) assert(real(fileKey(f)) && !locked(fileKey(f)), `${label}: move of ${f.id}`)
          assert(!(intent.files.some((f) => intent.folder && fileKey(f) === fileKey(intent.folder))), `${label}: a folder into itself`)
          assert(event.type === 'pointerup' || event.type === 'keydown', `${label}: move from ${event.type}`)
          break
        case 'add': assert(event.type === 'drop', `${label}: add from ${event.type}`); break
        case 'remove': assert(event.type === 'keydown' && ['Delete', 'Backspace'].includes(event.key), `${label}: remove`); break
        case 'undo': case 'redo': assert(event.type === 'keydown', `${label}: ${intent.kind}`); break
        case 'connect': assert(event.type === 'relation-picked', `${label}: connect from ${event.type}`); break
        case 'new-folder': assert(event.type === 'command' || event.type === 'keydown', `${label}: new-folder`); break
        case 'choose-placement': assert(event.type === 'pointerup' || event.type === 'keydown', `${label}: choose`); break
        case 'open': assert(event.type === 'pointerup' || event.type === 'keydown', `${label}: open from ${event.type}`); break
        case 'menu': assert(['contextmenu', 'longpress', 'keydown'].includes(event.type), `${label}: menu from ${event.type}`); break
        default: break
      }
    }
    // Law 5, standing: a drag never holds a card that cannot be dragged.
    const mode = step.state.mode
    if (mode.kind === 'dragging') {
      assert(mode.files.length > 0, `${label}: a drag of nothing`)
      for (const key of mode.files) assert(real(key) && !locked(key), `${label}: dragging ${key}`)
    }
    if (mode.kind === 'connecting' || mode.kind === 'picking') assert(real(mode.source), `${label}: connecting from a missing card`)
    if (step.state.naming && step.state.naming.target.kind === 'file') assert(real(step.state.naming.target.key), `${label}: naming a missing card`)
    assert(step.state.pointers.length <= 3, `${label}: more pointers than fingers`)
  }

  const coverage = { intents: new Map<string, number>(), modes: new Map<string, number>(), effects: new Map<string, number>() }
  const tally = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1)

  for (const [name, caps] of [['everything allowed', ALL_CAPS], ['read-only', { ...ALL_CAPS, place: false, move: false, rename: false, create: false, add: false, remove: false, connect: false } as FileCanvasCapabilities],
    ['no moving or arranging', { ...ALL_CAPS, place: false, move: false } as FileCanvasCapabilities]] as const) {
    it(`holds the laws over random events: ${name}`, { timeout: 120000 }, () => {
      forSeeds(name === 'everything allowed' ? 36 : 14, (rng) => {
        const h = view((sim) => { sim.capabilities = caps })
        let afterEpochChange = false
        let dead = false
        h.observers.push((info) => {
          // Only the first event after a scope change is held to "no intents"; what follows may be a gesture of the new scope.
          const stale = afterEpochChange
          afterEpochChange = false
          check(info, caps, stale, dead)
          if (name !== 'everything allowed') return
          for (const i of info.step.intents) tally(coverage.intents, i.kind)
          for (const e of info.step.effects) tally(coverage.effects, e.kind)
          tally(coverage.modes, info.step.state.mode.kind)
          if (info.step.state.naming) tally(coverage.modes, `naming:${info.step.state.naming.origin}`)
        })
        for (let i = 0; i < 260; i++) {
          if (rng.chance(0.04)) disturbShell(h, rng)
          if (rng.chance(0.012)) { h.epoch = `epoch-${i}`; afterEpochChange = true }
          if (rng.chance(0.4)) { macro(h, rng); afterEpochChange = false; continue }
          const event = randomEvent(h, rng)
          h.send(event)
          afterEpochChange = false
          if (rng.chance(0.0015)) { h.send({ type: 'destroy' }); dead = true }
        }
      })
    })
  }

  it('keeps an engine that must be primed primed exactly while a drag could start or is in flight, whatever happens to the press or the drag', { timeout: 120000 }, () => {
    forSeeds(24, (rng) => {
      const engine = primedSnapEngine()
      const h = view((sim) => { sim.capabilities = ALL_CAPS }, engine)
      // After the host has run the step's effects: primed while a drag is in flight, or while a press that could become one is down.
      h.afterEffects.push((info) => {
        const mode = info.step.state.mode
        const held = mode.kind === 'dragging' || (mode.kind === 'pressing' && mode.primed !== null)
        assert(engine.isPrimed() === held, `${info.event.type}: primed=${engine.isPrimed()} while ${mode.kind}`)
      })
      for (let i = 0; i < 260; i++) {
        if (rng.chance(0.04)) disturbShell(h, rng)
        if (rng.chance(0.012)) h.epoch = `epoch-${i}`
        if (rng.chance(0.4)) { macro(h, rng); continue }
        h.send(randomEvent(h, rng))
        if (rng.chance(0.0015)) h.send({ type: 'destroy' })
      }
      // However it went, nothing is left primed once no drag is in flight, and every prepare was answered by a release.
      const mode = h.state.mode
      if (mode.kind !== 'dragging' && !(mode.kind === 'pressing' && mode.primed !== null)) assert(!engine.isPrimed(), 'primed at rest')
      const prepares = engine.calls.filter((c) => c.startsWith('prepare')).length
      const releases = engine.calls.filter((c) => c === 'release').length
      assert(releases >= 1 || prepares === 0, 'a drag was primed and never released')
    })
  })

  it('replays every step it takes: the same state, event and context give the same step, even after cancellations were evaluated in between', { timeout: 180000 }, () => {
    // Evaluating `reduce` touches nothing, the primed engine included: its effects are for the host to run. Each step is evaluated again before
    // its effects run (the engine is as the reducer first saw it), with a cancellation of every kind evaluated in between.
    const probes: CanvasEvent[] = [{ type: 'pointercancel', pointerId: 1 }, { type: 'keydown', key: 'Escape', mods: NO_MODS }, { type: 'blur' }, { type: 'destroy' }]
    let drags = 0
    forSeeds(24, (rng) => {
      const engine = primedSnapEngine()
      const h = view((sim) => { sim.capabilities = ALL_CAPS }, engine)
      h.observers.push(({ event, before, ctx, step }) => {
        if (step.state.mode.kind === 'dragging') drags++
        const calls = engine.calls.length
        expect(reduce(before, event, ctx), `${event.type}: evaluated again`).toEqual(step)
        for (const probe of probes) reduce(before, probe, ctx)
        expect(reduce(before, event, ctx), `${event.type}: evaluated again after the cancellations`).toEqual(step)
        expect(engine.calls.length, `${event.type}: evaluating called the engine lifecycle`).toBe(calls)
      })
      for (let i = 0; i < 200; i++) {
        if (rng.chance(0.04)) disturbShell(h, rng)
        if (rng.chance(0.012)) h.epoch = `epoch-${i}`
        if (rng.chance(0.4)) { macro(h, rng); continue }
        h.send(randomEvent(h, rng))
      }
    })
    expect(drags, 'the fuzz dragged, with a primed engine, so the replay had hidden state to disturb').toBeGreaterThan(100)
  })

  it('reaches every kind of intent, mode and effect the laws are about, so a pass means something', () => {
    // Runs after the three suites above (tests in a file run in order): the tallies are theirs.
    const need = (map: Map<string, number>, keys: string[], what: string) => {
      const missing = keys.filter((k) => !map.has(k))
      assert(missing.length === 0, `the fuzz never produced ${what}: ${missing.join(', ')}`)
    }
    need(coverage.intents, ['select', 'open', 'menu', 'rename', 'name-cancel', 'place', 'move', 'new-folder', 'create', 'add', 'remove', 'connect', 'undo', 'redo'], 'the intents')
    need(coverage.modes, ['pressing', 'marquee', 'dragging', 'panning', 'pinching', 'connecting', 'picking', 'menu', 'osdrag', 'naming:local', 'naming:shell'], 'the modes')
    need(coverage.effects, ['capturePointer', 'releasePointer', 'focusCard', 'focusInput', 'focusHeader', 'openMenu', 'openRelationPicker', 'endDrag', 'prepareDrag', 'releaseDrag'], 'the effects')
    expect(coverage.intents.get('place') ?? 0).toBeGreaterThan(20)
    expect(coverage.intents.get('move') ?? 0).toBeGreaterThan(5)
  })
})
