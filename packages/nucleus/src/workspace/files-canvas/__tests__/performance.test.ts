// @vitest-environment node
import { houseEngine } from '../engine-house.js'
import { performanceSuite } from './support/performance-suite.js'

// The house engine's routing and snapping are stand-ins for Excalidraw's (see ENGINE_OWNERSHIP): these are
// the numbers the engine-backed implementation will be held to when it lands.
performanceSuite('house', houseEngine)

// The house router is the stand-in; these are the numbers it actually keeps, held to the letter (no slack) on top of the
// shared budgets, so a regression in it is seen before the engine-backed one lands. They are the fastest of many runs, with
// headroom on an idle laptop; set FILES_CANVAS_PERF_SLACK to stretch the shared budgets, never these.
import { describe, expect, it } from 'vitest'
import { buildScene } from '../scene.js'
import { measure, stressInput } from './support/performance-suite.js'

describe('performance of the house stand-in, to the letter', () => {
  const { input } = stressInput()
  const scene = buildScene(input).scene
  it('routes all 300 connectors over 506 cards in under 8 ms: the bar the design set for an engine-backed router', { timeout: 60000 }, () => {
    expect(measure('route, to the letter', 8, 40, () => { houseEngine.route(scene, { pad: 8 }) }).normalized).toBeLessThan(8)
  })
  it('projects the stress folder in well under a frame', { timeout: 60000 }, () => {
    expect(measure('buildScene, to the letter', 8, 60, () => { buildScene(input) }).normalized).toBeLessThan(8)
  })
})

// A budget is only evidence if work was done. These run the scenarios' validators against engines that answer wrongly, to show
// that each of them can fail, and that no question is left unchecked: an engine that answers nothing fails every one of them
// that is about the engine.
import type { CanvasEngine } from '../engine-port.js'
import { naiveEngine } from './support/naive-engine.js'
import { answerOf, performanceScenarios, stressScene } from './support/performance-suite.js'

describe('the performance scenarios validate what they time', () => {
  const stress = stressScene()
  const ids = performanceScenarios(houseEngine, houseEngine, stress).map((s) => s.id)
  const failing = (engine: CanvasEngine) => performanceScenarios(engine, houseEngine, stress).filter((s) => {
    try { answerOf(s); return false } catch { return true }
  }).map((s) => s.id)

  it('accepts the house engine in every scenario', () => {
    expect(failing(houseEngine)).toEqual([])
  })

  it('fails an engine that answers every question with nothing, in every scenario that is about the engine', () => {
    expect(failing(naiveEngine)).toEqual(ids.filter((id) => id !== 'build'))
  })

  const wrong: [string, Partial<CanvasEngine>, string[]][] = [
    // The examiner's engine: the suite of 31b04ef passed all eleven of its bodies against it.
    ['the examiner\'s engine: reroute and tidy empty, neighbour and drop target null, free slot at the origin',
      { reroute: () => new Map(), tidy: () => new Map(), spatialNeighbor: () => null, dropTarget: () => null, nextFreeSlot: () => ({ x: 0, y: 0 }) },
      ['drag-light', 'drag-hubs', 'keyboard', 'tidy', 'free-slot', 'free-slot-region']],
    ['a hit-test that answers every card', { hitRect: (s) => s.cards.map((c) => c.key) }, ['marquee-engine', 'marquee-reducer']],
    ['a hit-test that answers only the first card it finds', { hitRect: (s, r, m) => houseEngine.hitRect(s, r, m).slice(0, 1) }, ['marquee-engine', 'marquee-reducer']],
    ['a snap that never finds a guide', { snap: (_s, _m, d) => ({ delta: d, guides: [] }) }, ['drag-light', 'drag-hubs', 'drag-reducer']],
    ['a snap that lands far from where it was asked', { snap: (s, m, d, o) => ({ ...houseEngine.snap(s, m, d, o), delta: { x: d.x + 50, y: d.y } }) }, ['drag-light', 'drag-hubs', 'drag-reducer']],
    ['a drop target that is always empty', { dropTarget: () => null }, ['drag-light', 'drag-hubs']],
    ['a reroute that returns the old routes untouched', { reroute: (_s, _m, previous) => previous }, ['drag-light', 'drag-hubs']],
    ['a route that draws one point', { route: (s) => new Map(s.connectors.map((c) => [c.id, { id: c.id, points: [{ x: 0, y: 0 }], start: { side: 'right' as const, at: { x: 0, y: 0 } }, end: { side: 'left' as const, at: { x: 0, y: 0 } }, labelAnchor: { x: 0, y: 0 } }])) }, ['route-full']],
    ['a reading order that is reversed', { readingOrder: (s) => [...houseEngine.readingOrder(s)].reverse() }, ['keyboard']],
    ['a neighbour that is the card itself', { spatialNeighbor: (_s, from) => from }, ['keyboard']],
    ['a tidy that puts every card on one spot', { tidy: (s) => new Map(s.cards.map((c) => [c.key, { x: 16, y: 16 }])) }, ['tidy']],
    ['a free slot that is the first cell, taken or not', { nextFreeSlot: () => ({ x: 16, y: 16 }) }, ['free-slot', 'free-slot-region']],
    ['a free slot that ignores the region', { nextFreeSlot: (s, near, gap) => houseEngine.nextFreeSlot(s, near, gap) }, ['free-slot-region']],
  ]
  for (const [name, over, must] of wrong) {
    it(`fails ${name}`, () => {
      const found = failing({ ...houseEngine, ...over })
      for (const id of must) expect(found, id).toContain(id)
    })
  }
})
