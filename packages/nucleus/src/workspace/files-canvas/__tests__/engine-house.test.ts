// @vitest-environment node
import { naiveEngine } from './support/naive-engine.js'
import { houseEngine } from '../engine-house.js'
import { describe, expect, it } from 'vitest'
import { labelCandidates } from '../engine-route.js'
import { moveCards } from '../scene.js'
import type { ConnectorPath } from '../engine-port.js'
import { connection, file, keyOf, sceneOf } from './support/fixtures.js'
import { rerouteContractFaults } from './support/reroute-contract.js'
import { differentialSuite, engineSuite } from './support/engine-suite.js'
import { forSeeds } from './support/lcg.js'
import { connectionsFor, latticeSpecs, randomScene, scatterSpecs } from './support/scenes.js'

// `FILES_CANVAS_ENGINE=naive` points the suite at an engine that answers nothing: the red witness.
const red = process.env.FILES_CANVAS_ENGINE === 'naive'
engineSuite(red ? 'naive (red witness)' : 'house', red ? naiveEngine : houseEngine)
// The house against itself is the baseline of the differential harness every other engine must pass.
differentialSuite('house vs house', houseEngine, red ? naiveEngine : houseEngine)

// The port's reroute contract is held by the oracle in `support/reroute-contract.ts`, which the engine suite runs over random moves. These
// tests show the oracle can fail: each hands it an answer corrupted in one way the contract forbids.
describe('the reroute contract oracle catches what it says it catches', () => {
  const pads = { pad: 8 }
  // Small cards are 88 tall, so four relations between one pair leave lines closer together than a label is tall: the labels have to slide.
  const parallel = () => {
    const scene = sceneOf([{ id: 'a', x: 16, y: 16 }, { id: 'b', x: 416, y: 16 }], {
      view: { iconSize: 'small', snapToGrid: false },
      connections: ['1', '2', '3', '4'].map((n) => connection(n, file('a'), file('b'), 'explains')),
    })
    const before = houseEngine.route(scene, pads)
    const moved = new Set([keyOf(file('a'))])
    const after = moveCards(scene, [...moved], { x: 0, y: 40 })
    return { before, moved, after, next: new Map(houseEngine.reroute(after, moved, before, pads)), full: houseEngine.route(after, pads) }
  }
  const faultsOf = (corrupt: (next: Map<string, ConnectorPath>, ctx: ReturnType<typeof parallel>) => void) => {
    const ctx = parallel()
    corrupt(ctx.next, ctx)
    return rerouteContractFaults(ctx.after, ctx.moved, ctx.before, ctx.next, ctx.full)
  }

  it('finds nothing wrong with the house answer', () => {
    expect(faultsOf(() => {})).toEqual([])
  })
  it('finds a recomputed connector kept as it was', () => {
    expect(faultsOf((next, { before }) => next.set('1', before.get('1')!))).toEqual(['1: touched by a move but kept as it was',
      '1: touched by a move, and its route is not the one a full route gives it'])
  })
  it('finds a route that is not the full route\'s', () => {
    expect(faultsOf((next) => { const p = next.get('2')!; next.set('2', { ...p, end: { ...p.end, side: 'top' } }) }))
      .toEqual(['2: touched by a move, and its route is not the one a full route gives it'])
  })
  it('finds a label outside its route\'s label region', () => {
    expect(faultsOf((next) => next.set('3', { ...next.get('3')!, labelAnchor: { x: -50, y: -50 } }))).toEqual(['3: the label is outside its route\'s label region'])
  })
  it('finds a label put on another label when its route had a better place', () => {
    // The last label placed, put at the first place a label tries (the midpoint of its longest segment), where the label of the line above it already is.
    expect(faultsOf((next) => next.set('4', { ...next.get('4')!, labelAnchor: labelCandidates(next.get('4')!.points)[0]! }))).toEqual(
      ['4: the label sits on another label although its route has a better place for it'])
  })
  it('finds a connector missing from the answer', () => {
    expect(faultsOf((next) => next.delete('3'))).toEqual(['3: missing from the result'])
  })
})

// A house policy, not a port rule (an engine-backed router binds each arrow at a point of its own choosing): where several
// connectors leave or enter one side of one card, they do not share an attachment point.
describe('house engine: parallel connectors are spread along the edge they share', () => {
  it('gives every connector an attachment point of its own on a shared side', () => {
    forSeeds(40, (rng) => {
      const specs = rng.chance(0.5) ? latticeSpecs(rng, 4, 3) : scatterSpecs(rng, 10, 1100, 800)
      const scene = randomScene(specs, connectionsFor(rng, specs, 24))
      const paths = houseEngine.route(scene, { pad: 8 })
      const seen = new Map<string, string>()
      const clashes: string[] = []
      for (const c of scene.connectors) {
        const p = paths.get(c.id)!
        for (const [card, end] of [[c.from, p.start], [c.to, p.end]] as const) {
          const key = `${card}|${end.side}|${end.at.x},${end.at.y}`
          if (seen.has(key)) clashes.push(`${seen.get(key)} and ${c.id} meet at one point of ${end.side}`)
          seen.set(key, c.id)
        }
      }
      expect(clashes).toEqual([])
    })
  })
  it('spreads three relations between one pair to a quarter, a half and three quarters of the edge', () => {
    const scene = sceneOf([{ id: 'a', x: 16, y: 16 }, { id: 'b', x: 336, y: 16 }], {
      connections: ['1', '2', '3'].map((n) => connection(n, file('a'), file('b'))),
    })
    const paths = houseEngine.route(scene, { pad: 8 })
    expect([...paths.values()].map((p) => p.start.at.y).sort((x, y) => x - y)).toEqual([16 + 32, 16 + 64, 16 + 96])
  })
})
