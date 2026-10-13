// @vitest-environment node
/**
 * Snapping in Excalidraw's engine runs on a process-global cache that must be primed when a drag starts and cleared when it
 * ends, however it ends. The port says so (`prepareDrag`, `releaseDrag`). The reducer is pure, so it does not do it: it asks
 * for it with effects, and the host runs them (`runEngineEffects`). These tests hold the pair to the port's rule, against an
 * engine that really has that constraint (`primedSnapEngine`: unprimed, it snaps to nothing), and hold the reducer to its purity:
 * evaluating it touches nothing, so the same state, event and context give the same step, whatever was evaluated in between.
 */
import { describe, expect, it } from 'vitest'
import { houseEngine } from '../engine-house.js'
import { NO_MODS, reduce, runEngineEffects, type CanvasEffect, type CanvasEvent } from '../interaction.js'
import { ALL_CAPS } from './support/fixtures.js'
import { Harness, MOD } from './support/harness.js'
import { primedSnapEngine } from './support/primed-engine.js'
import { ShellSim } from './support/shell-sim.js'

function view(engine = primedSnapEngine(), configure?: (sim: ShellSim) => void) {
  const sim = new ShellSim()
  sim.capabilities = ALL_CAPS
  sim.addFile('a', { x: 16, y: 16 }); sim.addFile('b', { x: 176, y: 16 }); sim.addFile('c', { x: 336, y: 16 })
  sim.addFile('F', { folder: true, label: 'Datasheets', x: 16, y: 176 }); sim.addFile('d', { x: 176, y: 176 })
  configure?.(sim)
  return { h: new Harness({ sim, engine }), engine }
}
const near = (h: Harness) => ({ x: h.at('a').x + 13, y: h.at('a').y + 220 })      // a's right edge lands 3px short of b's left edge

describe('the engine is primed before the first snap, and released however a drag ends: the reducer asks, the host runs', () => {
  it('primes at the press of a card that can drag, so the first snap of the drag is primed; unprimed, the engine snaps to nothing', () => {
    const { h, engine } = view()
    const scene = h.scene()                                       // as it was before the drop moved anything
    h.down({ kind: 'card', key: h.keyOf('a') }, h.at('a'))
    expect(h.effectsOf('prepareDrag')).toEqual([{ kind: 'prepareDrag', files: [h.keyOf('a')] }])
    expect(engine.calls).toEqual(['prepare:1'])                   // the host ran it before the next event, so the first move is primed
    expect(engine.isPrimed()).toBe(true)
    const from = h.at('a'), to = near(h)
    for (let i = 1; i <= 6; i++) h.move({ x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 })
    expect(engine.calls).toEqual(['prepare:1'])
    expect(h.dragMode().snapped.guides.length).toBeGreaterThan(0)
    h.up(to)
    expect(engine.calls).toEqual(['prepare:1', 'release'])
    expect(engine.isPrimed()).toBe(false)

    // The same engine, asked without a drag having been opened, snaps to nothing: the constraint is real.
    const bare = primedSnapEngine()
    expect(bare.snap(scene, [h.keyOf('a')], { x: 13, y: 220 }, { threshold: 6 }).guides).toEqual([])
    expect(houseEngine.snap(scene, [h.keyOf('a')], { x: 13, y: 220 }, { threshold: 6 }).guides.length).toBeGreaterThan(0)
  })

  it('primes with the whole moving set, once, whatever the number of frames', () => {
    const { h, engine } = view()
    h.click('a'); h.click('b', { mods: MOD })
    engine.calls.length = 0
    h.drag('a', near(h), { steps: 12, release: false })
    expect(engine.calls).toEqual(['prepare:2'])
    h.up(near(h))
    expect(engine.calls).toEqual(['prepare:2', 'release'])
  })

  const endings: [string, (h: Harness) => void][] = [
    ['a drop on a folder', (h) => h.up(h.at('F', true))],
    ['a drop on empty space', (h) => h.up(h.empty(700, 500))],
    ['a drop where it began', (h) => h.up(h.at('a'))],
    ['a drop outside the canvas', (h) => h.up({ x: -90, y: 200 })],
    ['a pointercancel', (h) => { h.cancel() }],
    ['Escape', (h) => { h.key('Escape') }],
    ['losing focus', (h) => { h.send({ type: 'blur' }) }],
    ['a scope change', (h) => { h.epoch = 'another-folder'; h.move(h.empty()) }],
    ['destroy', (h) => { h.send({ type: 'destroy' }) }],
    ['a second finger', (h) => { h.down({ kind: 'background' }, h.empty(600, 600), { pointerId: 2, pointerType: 'touch' }) }],
    ['the dragged card being removed behind the canvas', (h) => { h.sim.files.get(h.keyOf('a'))!.removed = true; h.move(h.empty(710, 510)) }],
    ['the dragged card being locked by a contest', (h) => { h.sim.placementStates = { [h.keyOf('a')]: 'contested' }; h.move(h.empty(710, 510)) }],
  ]
  for (const [name, end] of endings) {
    it(`releases on ${name}, once, and leaves nothing primed`, () => {
      const { h, engine } = view()
      if (name === 'a second finger') {
        h.down({ kind: 'card', key: h.keyOf('a') }, h.at('a'), { pointerId: 1, pointerType: 'touch' })
        h.move({ x: h.at('a').x + 80, y: h.at('a').y + 80 }, { pointerId: 1 }); h.move({ x: h.at('a').x + 160, y: h.at('a').y + 160 }, { pointerId: 1 })
      } else h.drag('a', h.empty(700, 500), { release: false })
      expect(engine.isPrimed()).toBe(true)
      end(h)
      expect(engine.calls.filter((c) => c === 'release')).toHaveLength(1)
      expect(engine.calls.filter((c) => c.startsWith('prepare'))).toHaveLength(1)
      expect(engine.isPrimed()).toBe(false)
      expect(h.mode === 'dragging').toBe(false)
    })
  }

  it('re-primes with what is left when a contest takes one card out of a drag, and releases at the end', () => {
    const { h, engine } = view()
    h.click('a'); h.click('b', { mods: MOD })
    engine.calls.length = 0
    h.drag('a', h.empty(700, 500), { release: false })
    h.sim.placementStates = { [h.keyOf('a')]: 'pending' }
    h.move(h.empty(710, 510))
    expect(engine.calls).toEqual(['prepare:2', 'prepare:1'])
    expect(engine.isPrimed()).toBe(true)
    h.up(h.empty(710, 510))
    expect(engine.calls).toEqual(['prepare:2', 'prepare:1', 'release'])
  })

  it('primes again when the set that moves is not the one the press primed for: a card was locked between the press and the first move', () => {
    const { h, engine } = view()
    h.click('a'); h.click('b', { mods: MOD })
    engine.calls.length = 0
    h.down({ kind: 'card', key: h.keyOf('a') }, h.at('a'))               // primed for a and b
    h.sim.placementStates = { [h.keyOf('b')]: 'pending' }                 // b is pending elsewhere now
    h.move({ x: h.at('a').x + 20, y: h.at('a').y + 20 })
    expect(h.dragMode().files).toEqual([h.keyOf('a')])
    expect(engine.calls).toEqual(['prepare:2', 'prepare:1'])
    h.up(h.empty(700, 500))
    expect(engine.calls).toEqual(['prepare:2', 'prepare:1', 'release'])
  })

  it('a click is a press that could have been a drag: primed at the press, released at the release, nothing left primed', () => {
    const { h, engine } = view()
    h.click('a')
    expect(engine.calls).toEqual(['prepare:1', 'release'])
    expect(engine.isPrimed()).toBe(false)
    h.doubleClick('b')
    expect(engine.calls).toEqual(['prepare:1', 'release', 'prepare:1', 'release', 'prepare:1', 'release'])
  })

  it('a press that cannot drag primes nothing: the background, a connector handle, a ghost, a locked card, a card toggled out of the selection', () => {
    const { h, engine } = view(primedSnapEngine(), (sim) => {
      sim.contests = [{ file: sim.refOf('c'), candidates: [
        { id: 'mine', x: 336, y: 16, origin: 'this-tab', label: 'this tab', at: 1 }, { id: 'theirs', x: 700, y: 400, origin: 'other', label: 'other tab', at: 2 }] }]
      sim.placementStates = { [sim.keyOf('d')]: 'pending' }
    })
    const ghost = h.scene().cards.find((c) => c.role === 'ghost')!
    h.marquee({ x: 5, y: 600 }, { x: 330, y: 700 })
    h.clickBackground()
    h.down({ kind: 'handle', key: h.keyOf('a') }, h.at('a')); h.up(h.at('a'))
    h.down({ kind: 'card', key: ghost.key }, h.at('a')); h.up(h.at('a'))
    h.click('d')                                                       // locked: pending elsewhere
    expect(engine.calls).toEqual([])
    h.click('a'); engine.calls.length = 0
    h.click('a', { mods: MOD })                                        // Cmd-click toggles a out of the selection: it is not dragged
    expect(engine.calls).toEqual([])
  })

  it('never primes for a pan, and a menu opened by a long press lets go of what the press primed', () => {
    const { h, engine } = view()
    h.down({ kind: 'background' }, h.empty(), { button: 1 }); h.move({ x: h.empty().x - 40, y: h.empty().y }); h.up({ x: h.empty().x - 40, y: h.empty().y })
    expect(engine.calls).toEqual([])
    h.down({ kind: 'card', key: h.keyOf('b') }, h.at('b'), { pointerType: 'touch' })
    expect(engine.calls).toEqual(['prepare:1'])
    h.send({ type: 'longpress', pointerId: 1 })
    expect(h.mode).toBe('menu')
    expect(engine.calls).toEqual(['prepare:1', 'release'])
    expect(engine.isPrimed()).toBe(false)
  })

  it('brackets each of two drags in turn', () => {
    const { h, engine } = view()
    h.drag('a', h.empty(700, 500)); h.drag('b', h.empty(600, 400))
    expect(engine.calls).toEqual(['prepare:1', 'release', 'prepare:1', 'release'])
  })

  it('an engine without the lifecycle is left alone: the reducer does not need it', () => {
    const h = new Harness({ sim: (() => { const sim = new ShellSim(); sim.addFile('a', { x: 16, y: 16 }); sim.addFile('b', { x: 176, y: 16 }); return sim })(), engine: houseEngine })
    h.drag('a', { x: 300, y: 300 })
    expect(h.intentsOf('place')).toHaveLength(1)
  })

  it('disposes the engine once, when the canvas is destroyed, after releasing what a drag held', () => {
    const { h, engine } = view()
    h.drag('a', h.empty(700, 500), { release: false })
    h.send({ type: 'destroy' })
    expect(engine.calls).toEqual(['prepare:1', 'release', 'dispose'])
    h.send({ type: 'destroy' })
    expect(engine.calls).toEqual(['prepare:1', 'release', 'dispose'])        // a dead canvas answers nothing
  })
})

describe('the reducer is pure: evaluating it changes nothing, the engine included', () => {
  const dragging = () => {
    const { h, engine } = view()
    h.drag('a', near(h), { release: false })
    return { h, engine }
  }
  const move = (h: Harness): CanvasEvent => ({ type: 'pointermove', pointerId: 1, at: near(h), mods: NO_MODS, t: 9000 })
  const cancellations = (h: Harness): CanvasEvent[] => [
    { type: 'pointercancel', pointerId: 1 }, { type: 'pointerup', pointerId: 1, at: h.at('F', true), mods: NO_MODS, t: 9100 },
    { type: 'keydown', key: 'Escape', mods: NO_MODS }, { type: 'blur' }, { type: 'destroy' },
  ]

  it('calls nothing of the engine lifecycle, whatever it is asked: the effects are for the host to run', () => {
    const { h, engine } = dragging()
    const calls = [...engine.calls]
    for (const event of [move(h), ...cancellations(h)]) h.evaluate(event)
    reduce(h.state, move(h), { ...h.ctx(), epoch: 'another-folder' })      // an epoch change cancels the drag too
    expect(engine.calls).toEqual(calls)
    expect(engine.isPrimed()).toBe(true)
  })

  it('asks the host for the lifecycle with effects: a release however the drag would end, a dispose on destroy', () => {
    const { h } = dragging()
    const asked = (event: CanvasEvent) => h.evaluate(event).effects
      .map((e: CanvasEffect) => e.kind).filter((k) => k === 'releaseDrag' || k === 'disposeEngine' || k === 'prepareDrag')
    expect(asked(move(h))).toEqual([])
    for (const event of cancellations(h).slice(0, 4)) expect(asked(event), event.type).toEqual(['releaseDrag'])
    expect(asked({ type: 'destroy' })).toEqual(['releaseDrag', 'disposeEngine'])
  })

  it('gives the same step for the same state, event and context, again and again, and after a cancellation was evaluated in between', () => {
    // The examiner's sequence: a primed drag, a pointermove evaluated, a cancellation evaluated, the same pointermove replayed.
    const { h } = dragging()
    const event = move(h)
    const first = h.evaluate(event)
    expect(first.state.mode.kind).toBe('dragging')
    expect(first.state.mode.kind === 'dragging' && first.state.mode.snapped.guides.length).toBeGreaterThan(0)
    for (const cancel of cancellations(h)) {
      h.evaluate(cancel)
      expect(h.evaluate(event), `after evaluating ${cancel.type}`).toEqual(first)
    }
    expect(h.evaluate(event)).toEqual(first)
  })

  it('asks for the re-priming too, when a contest takes a card out of a drag: an effect, with nothing called', () => {
    const { h, engine } = view()
    h.click('a'); h.click('b', { mods: MOD })
    engine.calls.length = 0
    h.drag('a', h.empty(700, 500), { release: false })
    h.sim.placementStates = { [h.keyOf('a')]: 'pending' }
    const calls = [...engine.calls]
    const step = h.evaluate({ type: 'pointermove', pointerId: 1, at: h.empty(710, 510), mods: NO_MODS, t: 9000 })
    expect(engine.calls).toEqual(calls)
    expect(step.effects.filter((e) => e.kind === 'prepareDrag')).toEqual([{ kind: 'prepareDrag', files: [h.keyOf('b')] }])
  })

  it('leaves the engine to the host: it is released when the host runs the cancellation\'s effects, and not before', () => {
    const { h, engine } = dragging()
    const step = h.evaluate({ type: 'pointercancel', pointerId: 1 })
    expect(engine.isPrimed()).toBe(true)
    runEngineEffects(step.effects, engine, h.scene())
    expect(engine.isPrimed()).toBe(false)
  })
})

describe('runEngineEffects: the engine half of the host', () => {
  const scene = view().h.scene()
  it('runs prepare, release and dispose against the engine it is given, in order, and ignores every other effect', () => {
    const engine = primedSnapEngine()
    const key = [...scene.byKey.keys()][0]!
    runEngineEffects([{ kind: 'focusHeader' }, { kind: 'prepareDrag', files: [key] }, { kind: 'capturePointer', pointerId: 1 }, { kind: 'releaseDrag' }, { kind: 'disposeEngine' }], engine, scene)
    expect(engine.calls).toEqual(['prepare:1', 'release', 'dispose'])
  })
  it('leaves an engine without the lifecycle alone', () => {
    expect(() => runEngineEffects([{ kind: 'prepareDrag', files: [] }, { kind: 'releaseDrag' }, { kind: 'disposeEngine' }], houseEngine, scene)).not.toThrow()
  })
})
