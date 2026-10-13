// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { CanvasEngine } from '../engine-port.js'
import { houseEngine } from '../engine-house.js'
import { cloneScene, compareEngines, differentialCorpus, patchInPlace, permuted } from './support/engine-suite.js'
import { lcg } from './support/lcg.js'

/**
 * The differential harness is only evidence if it can fail. These tests break the house engine on
 * purpose, one function at a time, and require the harness to name the function; and they require it
 * to accept the one deviation the design allows (finding fewer snap guides than the reference).
 */
const corpus = differentialCorpus()
const broken = (over: Partial<CanvasEngine>): CanvasEngine => ({ ...houseEngine, ...over })

describe('the differential harness', () => {
  it('finds nothing between the house engine and itself', () => {
    expect(compareEngines(houseEngine, houseEngine, corpus)).toEqual([])
  })

  it('has a corpus worth the name: arranged, scattered, piled, connected and grid-snapping folders', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(40)
    expect(corpus.some((s) => s.grid !== null)).toBe(true)
    expect(new Set(corpus.map((s) => s.cardSize.w)).size).toBeGreaterThanOrEqual(2)
    const connected = corpus.filter((s) => s.connectors.length > 0)
    expect(connected.length).toBeGreaterThanOrEqual(15)
    expect(connected.every((s) => s.connectors.length >= 8)).toBe(true)
    // Connected folders of each arrangement: cards on a lattice, scattered, and piled on one another.
    expect(connected.some((s) => s.cards.some((c, i) => s.cards.some((o, j) => j > i && c.rect.x < o.rect.x + o.rect.w && o.rect.x < c.rect.x + c.rect.w && c.rect.y < o.rect.y + o.rect.h && o.rect.y < c.rect.y + c.rect.h)))).toBe(true)
  })

  const defects: [string, string, Partial<CanvasEngine>][] = [
    ['bounds', 'bounds that lose a pixel', { bounds: (s) => { const b = houseEngine.bounds(s); return b && { ...b, w: b.w - 1 } } }],
    ['hitRect', 'a hit-test that drops the first hit', { hitRect: (s, r, m) => houseEngine.hitRect(s, r, m).slice(1) }],
    ['hitRect', 'a hit-test that ignores the mode', { hitRect: (s, r) => houseEngine.hitRect(s, r, 'intersect') }],
    ['dropTarget', 'a drop target that picks the bottommost folder', { dropTarget: (s, moving, at) => {
      const flipped = { ...s, cards: [...s.cards].reverse() }
      return houseEngine.dropTarget(flipped, moving, at)
    } }],
    ['readingOrder', 'a reading order that is reversed', { readingOrder: (s) => [...houseEngine.readingOrder(s)].reverse() }],
    ['readingOrder', 'a reading order that follows the array, not the positions', { readingOrder: (s) => s.cards.map((c) => c.key) }],
    ['snap', 'a snap that invents a guide', { snap: (s, m, d, o) => ({ ...houseEngine.snap(s, m, d, o), guides: [{ axis: 'x', at: 123456.5, from: 0, to: 1 }] }) }],
  ]
  for (const [fn, name, over] of defects) {
    it(`names ${fn} for ${name}`, () => {
      const found = compareEngines(houseEngine, broken(over), corpus)
      expect(found.length).toBeGreaterThan(0)
      expect(new Set(found.map((d) => d.fn))).toEqual(new Set([fn]))
    })
  }

  it('accepts a candidate that finds fewer snap guides than the reference: a coverage gap, not a divergence', () => {
    expect(compareEngines(houseEngine, broken({ snap: (_scene, _moving, delta) => ({ delta, guides: [] }) }), corpus)).toEqual([])
  })

  it('catches a hit test that trusts a cache across a move: the same point on a moved scene gets the old answer', () => {
    // The hazard the spike found in the engine itself (hitElementItself's one-entry memo): an answer remembered per point, valid for
    // no scene in particular. A real implementation of it, so the harness is shown to fail on the thing it is there to catch.
    const stale = (): CanvasEngine => {
      const drops = new Map<string, string | null>(), hits = new Map<string, readonly string[]>()
      return broken({
        dropTarget: (s, moving, at) => {
          const key = `${at.x},${at.y}|${moving.join()}`
          if (!drops.has(key)) drops.set(key, houseEngine.dropTarget(s, moving, at))
          return drops.get(key)!
        },
        hitRect: (s, r, mode) => {
          const key = `${JSON.stringify(r)}|${mode}`
          if (!hits.has(key)) hits.set(key, houseEngine.hitRect(s, r, mode))
          return hits.get(key)!
        },
      })
    }
    const found = compareEngines(houseEngine, stale(), corpus)
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((d) => d.fn === 'hitRect' || d.fn === 'dropTarget')).toBe(true)
    expect(found.some((d) => d.detail.startsWith('after a move'))).toBe(true)
  })

  // The examiner's counterexample to the corpus: a hit-cache defect that only shows when the scene has connectors, run over a corpus
  // that had none, found nothing, and then handed out the old hit after a connected card moved.
  it('catches a stale hit that only shows in connected scenes', () => {
    const connectedOnly = (): CanvasEngine => {
      const drops = new Map<string, string | null>(), hits = new Map<string, readonly string[]>()
      return broken({
        dropTarget: (s, moving, at) => {
          if (!s.connectors.length) return houseEngine.dropTarget(s, moving, at)
          const key = `${at.x},${at.y}|${moving.join()}`
          if (!drops.has(key)) drops.set(key, houseEngine.dropTarget(s, moving, at))
          return drops.get(key)!
        },
        hitRect: (s, r, mode) => {
          if (!s.connectors.length) return houseEngine.hitRect(s, r, mode)
          const key = `${JSON.stringify(r)}|${mode}`
          if (!hits.has(key)) hits.set(key, houseEngine.hitRect(s, r, mode))
          return hits.get(key)!
        },
      })
    }
    const found = compareEngines(houseEngine, connectedOnly(), corpus)
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((d) => d.fn === 'hitRect' || d.fn === 'dropTarget')).toBe(true)
    // It is invisible without the connected scenes.
    expect(compareEngines(houseEngine, connectedOnly(), corpus.filter((s) => s.connectors.length === 0))).toEqual([])
  })

  // The in-place probe has no replacement snapshot to tell an engine anything changed: the same object, its cards patched where they stand.
  describe('in place', () => {
    const keyedOnTheSnapshot = (): CanvasEngine => {
      // An answer kept per snapshot object (port rule 2 allows a translation cached on the identity, but not an answer that outlives
      // the geometry it was for), for every question that depends on where the cards are.
      const bounds = new WeakMap<object, ReturnType<typeof houseEngine.bounds>>()
      const order = new WeakMap<object, readonly string[]>()
      const drops = new WeakMap<object, Map<string, string | null>>(), hits = new WeakMap<object, Map<string, readonly string[]>>()
      const per = <V>(m: WeakMap<object, Map<string, V>>, s: object): Map<string, V> => {
        const inner = m.get(s) ?? new Map<string, V>()
        m.set(s, inner)
        return inner
      }
      return broken({
        bounds: (s) => { if (!bounds.has(s)) bounds.set(s, houseEngine.bounds(s)); return bounds.get(s)! },
        readingOrder: (s) => { if (!order.has(s)) order.set(s, houseEngine.readingOrder(s)); return order.get(s)! },
        dropTarget: (s, moving, at) => {
          const memo = per(drops, s), key = `${at.x},${at.y}|${moving.join()}`
          if (!memo.has(key)) memo.set(key, houseEngine.dropTarget(s, moving, at))
          return memo.get(key)!
        },
        hitRect: (s, r, mode) => {
          const memo = per(hits, s), key = `${JSON.stringify(r)}|${mode}`
          if (!memo.has(key)) memo.set(key, houseEngine.hitRect(s, r, mode))
          return memo.get(key)!
        },
      })
    }

    it('catches an engine that keeps its answers per snapshot object when the snapshot is patched where it stands', () => {
      const found = compareEngines(houseEngine, keyedOnTheSnapshot(), corpus)
      expect(found.length).toBeGreaterThan(0)
      // The replacement-snapshot probes cannot see it: an answer per object is right for every new object. Only the in-place ones do.
      expect(found.every((d) => d.detail.startsWith('in place'))).toBe(true)
      expect(new Set(found.map((d) => d.fn))).toEqual(new Set(['bounds', 'readingOrder', 'dropTarget', 'hitRect']))
    })

    it('patches a private copy: the corpus is left as it was, and the copy is the same object after the patch', () => {
      const scene = corpus[0]!
      const before = JSON.stringify(scene.cards.map((c) => c.rect))
      const live = cloneScene(scene)
      const key = live.cards[0]!.key
      const was = live.byKey.get(key)!.rect.x
      patchInPlace(live, [key], { x: 5, y: 0 })
      expect(live.byKey.get(key)!.rect.x).toBe(was + 5)
      expect(live.cards[0]!.glyph.x).toBe(scene.cards[0]!.glyph.x + 5)
      expect(JSON.stringify(scene.cards.map((c) => c.rect))).toBe(before)
    })
  })

  it('does not hold route, reroute, tidy, nextFreeSlot, spatialNeighbor or fitCamera to equality: the suite holds them to properties', () => {
    const lax = broken({ nextFreeSlot: () => ({ x: 1, y: 1 }), tidy: () => new Map(), spatialNeighbor: () => null, route: () => new Map(), reroute: () => new Map() })
    expect(compareEngines(houseEngine, lax, corpus)).toEqual([])
  })

  it('does not depend on the array order of the reference scene either', () => {
    const rng = lcg(5)
    expect(compareEngines(houseEngine, houseEngine, corpus.map((s) => permuted(s, rng)))).toEqual([])
  })
})
