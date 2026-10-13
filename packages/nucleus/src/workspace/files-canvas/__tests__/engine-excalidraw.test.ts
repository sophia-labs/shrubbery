// @vitest-environment node
import { hitElementItself, mutateElement, newElement } from '@excalidraw/element'
import { pointFrom } from '@excalidraw/math'
import { afterAll, describe, expect, it } from 'vitest'
import { createExcalidrawEngine } from '../engine-excalidraw.js'
import { houseEngine } from '../engine-house.js'
import { rectCenter } from '../geometry.js'
import { moveCards } from '../scene.js'
import { SnapCache } from '../vendor/excalidraw/snapping.js'
import { cloneScene, differentialCorpus, differentialSuite, engineSuite, patchInPlace } from './support/engine-suite.js'
import { file, folder, keyOf, sceneOf } from './support/fixtures.js'
import { measure, performanceSuite, stressScene } from './support/performance-suite.js'

// The port's contract, to the letter, on Excalidraw's engine: with its route cache, and without (a route made fresh every time).
const engine = createExcalidrawEngine()
const cold = createExcalidrawEngine({ routeCache: false })
afterAll(() => { engine.dispose?.(); cold.dispose?.() })

engineSuite('excalidraw', engine)
engineSuite('excalidraw, no route cache', cold)
// And held to the house where the two must agree exactly.
differentialSuite('house vs excalidraw', houseEngine, engine)
// The numbers of section 15.1, on routes made from nothing every time (the cache would answer a repeated scene from memory).
performanceSuite('excalidraw, no route cache', cold)

describe('excalidraw engine: the stale hit memo of 0.18.0-4ce38fb', () => {
  // hitElementItself keeps a one-entry memo of the last (point, element), and validates it by comparing the cached element with itself,
  // so after an in-place mutation the same point asked again gets the answer from before the move.
  const home = sceneOf([{ id: 'F', folder: true, x: 0, y: 0 }, { id: 'G', x: 300, y: 0 }])
  const F = keyOf(folder('F'))
  const inside = rectCenter(home.byKey.get(F)!.rect)
  const moveAway = (s: typeof home) => patchInPlace(s, [F], { x: 700, y: 400 })

  it('is in the pinned package: the raw call answers from before the move (the witness; if this fails, the memo is gone and defeatHitMemo can go)', () => {
    const map = new Map()
    const el = newElement({ type: 'rectangle', id: 'r', x: 0, y: 0, width: 100, height: 80, backgroundColor: '#fff', fillStyle: 'solid', strokeWidth: 0 } as Parameters<typeof newElement>[0])
    map.set('r', el)
    const ask = () => hitElementItself({ point: pointFrom<never>(50, 40), element: el, threshold: 0.01, elementsMap: map as never })
    expect(ask()).toBe(true)
    mutateElement(el, map as never, { x: 700, y: 400 })
    expect(ask(), 'the same point, the element moved away: a memo answers true').toBe(true)
    // A different point asked of another element, inside its bounds, forgets it: the defeat.
    const other = newElement({ type: 'rectangle', id: 'p', x: 0, y: 0, width: 4, height: 4, backgroundColor: '#fff', fillStyle: 'solid', strokeWidth: 0 } as Parameters<typeof newElement>[0])
    hitElementItself({ point: pointFrom<never>(1, 1), element: other, threshold: 0.01, elementsMap: new Map([['p', other]]) as never })
    expect(ask()).toBe(false)
  })

  it('does not reach the engine: the same snapshot, patched where it stands, asked at the same point', () => {
    const e = createExcalidrawEngine()
    const live = cloneScene(home)
    for (let round = 0; round < 3; round++) {
      expect(e.dropTarget(live, [], inside)).toBe(F)
      expect(e.dropTarget(live, [], inside)).toBe(F)
      moveAway(live)
      expect(e.dropTarget(live, [], inside), 'asked again after the card was moved away in place').toBeNull()
      patchInPlace(live, [F], { x: -700, y: -400 })
    }
    e.dispose?.()
  })

  it('does not reach the engine through a replacement snapshot either', () => {
    const e = createExcalidrawEngine()
    const away = moveCards(home, [F], { x: 700, y: 400 })
    for (let round = 0; round < 3; round++) {
      expect(e.dropTarget(home, [], inside)).toBe(F)
      expect(e.dropTarget(away, [], inside)).toBeNull()
    }
    e.dispose?.()
  })

  it('is the hazard this defends against: an engine told to keep the memo answers from before the move (the red witness)', () => {
    const unsafe = createExcalidrawEngine({ unsafeKeepHitMemo: true })
    const live = cloneScene(home)
    expect(unsafe.dropTarget(live, [], inside)).toBe(F)
    moveAway(live)
    expect(unsafe.dropTarget(live, [], inside), 'the memo says the card is still there').toBe(F)
    unsafe.dispose?.()
  })
})

describe('excalidraw engine: the snap cache is the realm\'s, and the engine says whose it holds', () => {
  const scene = sceneOf([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 300, y: 3 }])
  const b = keyOf(file('b'))
  const raw = { x: -155, y: 0 }

  it('is primed by prepareDrag and destroyed by releaseDrag, and by dispose', () => {
    const e = createExcalidrawEngine()
    expect(e.holdsSnapCache()).toBe(false)
    e.prepareDrag!(scene, [b])
    expect(e.holdsSnapCache()).toBe(true)
    expect(SnapCache.getReferenceSnapPoints()?.length).toBeGreaterThan(0)
    e.releaseDrag!()
    expect(e.holdsSnapCache()).toBe(false)
    expect(SnapCache.getReferenceSnapPoints()).toBeNull()
    e.prepareDrag!(scene, [b])
    e.dispose!()
    expect(SnapCache.getReferenceSnapPoints()).toBeNull()
  })

  it('does not snap to a stale drag: another engine primed the cache for another set, and this one primes again for the call', () => {
    const one = createExcalidrawEngine(), two = createExcalidrawEngine()
    const a = keyOf(file('a'))
    one.prepareDrag!(scene, [b])
    const alone = one.snap(scene, [b], raw, { threshold: 6 })
    expect(alone.guides.length).toBeGreaterThan(0)
    two.prepareDrag!(scene, [a])                  // the realm's one cache is now two's, primed for moving `a`
    expect(one.holdsSnapCache()).toBe(false)
    expect(one.snap(scene, [b], raw, { threshold: 6 })).toEqual(alone)
    expect(one.holdsSnapCache(), 'one took it back for the call').toBe(true)
    two.releaseDrag!()                            // two does not hold it: this must not destroy one's
    expect(one.holdsSnapCache()).toBe(true)
    expect(SnapCache.getReferenceSnapPoints()).not.toBeNull()
    one.dispose!(); two.dispose!()
  })

  it('snaps to where the cards are now when the snapshot is patched in place under a primed cache', () => {
    const e = createExcalidrawEngine()
    const live = cloneScene(scene)
    e.prepareDrag!(live, [b])
    expect(e.snap(live, [b], raw, { threshold: 6 }).guides.some((g) => g.axis === 'x')).toBe(true)
    patchInPlace(live, [keyOf(file('a'))], { x: 600, y: 0 })
    expect(e.snap(live, [b], raw, { threshold: 6 }).guides.filter((g) => g.axis === 'x')).toEqual([])
    e.dispose!()
  })
})

describe('excalidraw engine: its own edges', () => {
  it('uses Excalidraw\'s route for connectors on the differential corpus, and says how often it did not', () => {
    const e = createExcalidrawEngine({ routeCache: false })
    let routes = 0
    for (const scene of differentialCorpus()) routes += e.route(scene, { pad: 8 }).size
    expect(routes).toBeGreaterThan(100)
    expect(e.stats.fallbacks, 'routes that were not usable').toBe(0)
    // Looping round a near neighbour is Excalidraw's habit under 40 units of clearance; it is replaced, and it is the minority.
    expect(e.stats.simplified).toBeLessThan(routes / 2)
    e.dispose?.()
  })

  it('keeps no scene of its own across a dispose: the next snapshot is translated from nothing', () => {
    const e = createExcalidrawEngine()
    const scene = differentialCorpus()[0]!
    const before = e.bounds(scene)
    e.dispose?.()
    expect(e.bounds(scene)).toEqual(before)
  })

  // A drag on the stress folder with the route cache warm for the arrows a move only touches: every frame moves the cards somewhere new,
  // so the cards' own arrows are routed fresh and the neighbours' are remembered. This is the interactive path of section 15.1.
  it('drags 10 cards with a connector or two each in a frame, the route cache warm and every frame new', { timeout: 60000 }, () => {
    const { scene } = stressScene()
    const e = createExcalidrawEngine()
    const pads = { pad: 8 }
    const previous = e.route(scene, pads)
    const degree = new Map<string, number>()
    for (const c of scene.connectors) { degree.set(c.from, (degree.get(c.from) ?? 0) + 1); degree.set(c.to, (degree.get(c.to) ?? 0) + 1) }
    const light = scene.cards.filter((c) => (degree.get(c.key) ?? 0) >= 1 && (degree.get(c.key) ?? 0) <= 2).slice(40, 50).map((c) => c.key)
    const movedSet = new Set(light)
    let i = 0
    const m = measure('warm drag', 6, 100, () => {
      const moved = moveCards(scene, light, { x: 5 + (i++ % 97) * 0.37, y: 7 })
      return { moved, next: e.reroute(moved, movedSet, previous, pads) }
    })
    expect(m.last.next.size).toBe(scene.connectors.length)
    expect(m.normalized).toBeLessThan(6 * 2)
    e.dispose?.()
  })
})

describe('the default engine', () => {
  it('is the Excalidraw-backed one, loaded on first use', async () => {
    const { loadDefaultEngine } = await import('../engine-default.js')
    const loaded = await loadDefaultEngine()
    expect(loaded.kind).toBe('excalidraw')
    expect(loaded.reason).toBeNull()
    expect(loaded.engine).not.toBe(houseEngine)
    const scene = differentialCorpus()[0]!
    expect(loaded.engine.bounds(scene)).toEqual(houseEngine.bounds(scene))
    loaded.engine.dispose?.()
  })

  it('is the house engine, with the reason, when the Excalidraw one cannot be loaded', async () => {
    const { loadDefaultEngine } = await import('../engine-default.js')
    const loaded = await loadDefaultEngine(() => Promise.reject(new Error('chunk 404')))
    expect(loaded).toEqual({ engine: houseEngine, kind: 'house', reason: 'chunk 404' })
  })
})
