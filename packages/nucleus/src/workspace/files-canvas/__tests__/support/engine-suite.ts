/**
 * The engine port suite: one body of tests, run against whichever engine it is handed.
 *
 * `engine-house.test.ts` runs it against the house implementation. An engine-backed implementation
 * (Excalidraw's geometry, if the spike admits it) must pass the same suite, and `compareEngines`
 * holds it to the house on the functions where the two must agree exactly. Nothing here knows how
 * an engine is built; it only calls the port.
 */
import { describe, expect, it } from 'vitest'
import { CANVAS_ENGINE_FUNCTIONS, type CanvasEngine, type SceneCard, type SceneSnapshot, type Side, type SnapGuide } from '../../engine-port.js'
import {
  ZOOM_MIN, rectBottom, rectCenter, rectContainsPoint, rectContainsRect, rectRight, rectsIntersect, revealRect, segmentHitsRect, slotIndexAt, slotRect,
  toViewport, type Pt, type Rect,
} from '../../geometry.js'
import { labelBox } from '../../engine-route.js'
import { CARD_GAP, CARD_METRICS, buildScene, moveCards } from '../../scene.js'
import { connection, emptySession, file, folder, inputOf, keyOf, sceneOf, type Spec } from './fixtures.js'
import { forSeeds, lcg, type Rng } from './lcg.js'
import { crossesGlyph, mustRecompute, rerouteContractFaults } from './reroute-contract.js'
import { connectionsFor, latticeSpecs, pileSpecs, randomScene, scatterSpecs } from './scenes.js'

const M = CARD_METRICS.medium
const PAD = 8
const sorted = <T>(items: readonly T[]) => [...items].sort()

/** The same cards in a different array order: positions, not the array, must decide everything. */
export function permuted(scene: SceneSnapshot, rng: Rng): SceneSnapshot {
  const cards = rng.shuffle(scene.cards)
  return { ...scene, cards, byKey: new Map(cards.map((c) => [c.key, c])) }
}

export function onEdge(rect: Rect, side: Side, p: Pt): boolean {
  const within = (v: number, lo: number, hi: number) => v >= lo - 1e-9 && v <= hi + 1e-9
  switch (side) {
    case 'right': return p.x === rectRight(rect) && within(p.y, rect.y, rectBottom(rect))
    case 'left': return p.x === rect.x && within(p.y, rect.y, rectBottom(rect))
    case 'top': return p.y === rect.y && within(p.x, rect.x, rectRight(rect))
    default: return p.y === rectBottom(rect) && within(p.x, rect.x, rectRight(rect))
  }
}

export function onPath(points: readonly Pt[], p: Pt): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!
    const within = (v: number, x: number, y: number) => v >= Math.min(x, y) - 1e-9 && v <= Math.max(x, y) + 1e-9
    if (a.x === b.x && Math.abs(p.x - a.x) < 1e-9 && within(p.y, a.y, b.y)) return true
    if (a.y === b.y && Math.abs(p.y - a.y) < 1e-9 && within(p.x, a.x, b.x)) return true
  }
  return false
}

const bends = (points: readonly Pt[]): number => Math.max(0, points.length - 2)
const lines = (lo: number, size: number): number[] => [lo, lo + size / 2, lo + size]

export function engineSuite(name: string, engine: CanvasEngine): void {
  describe(`engine port: ${name}`, () => {
    it('implements all eleven functions of the port', () => {
      for (const fn of CANVAS_ENGINE_FUNCTIONS) expect(typeof engine[fn], fn).toBe('function')
    })

    describe('bounds', () => {
      it('is null for an empty scene and the card itself for one card', () => {
        expect(engine.bounds(sceneOf([]))).toBeNull()
        expect(engine.bounds(sceneOf([{ id: 'a', x: 40, y: 30 }]))).toEqual({ x: 40, y: 30, w: M.w, h: M.h })
      })
      it('holds every card and is tight on all four sides', () => {
        forSeeds(20, (rng) => {
          const scene = randomScene(rng.chance(0.5) ? scatterSpecs(rng, 14, 1200, 900) : pileSpecs(rng, 14, 1200, 900))
          const b = engine.bounds(scene)!
          for (const card of scene.cards) expect(rectContainsRect(b, card.rect)).toBe(true)
          expect(b.x).toBe(Math.min(...scene.cards.map((c) => c.rect.x)))
          expect(b.y).toBe(Math.min(...scene.cards.map((c) => c.rect.y)))
          expect(rectRight(b)).toBe(Math.max(...scene.cards.map((c) => rectRight(c.rect))))
          expect(rectBottom(b)).toBe(Math.max(...scene.cards.map((c) => rectBottom(c.rect))))
        })
      })
      it('counts ghost and draft cards: fit-camera must show them', () => {
        const scene = buildScene({ ...inputOf([{ id: 'a', x: 16, y: 16 }]), drafts: [{ draftId: 'd', kind: 'folder', label: 'Untitled folder', placement: { x: 900, y: 700 } }] }).scene
        expect(rectRight(engine.bounds(scene)!)).toBe(900 + M.w)
      })
    })

    describe('hitRect', () => {
      const scene = sceneOf([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 300, y: 0 }, { id: 'c', x: 0, y: 300 }])
      const [a, b] = ['a', 'b'].map((id) => keyOf(file(id)))
      it('intersect takes any overlap; contain needs the whole card', () => {
        const part = { x: 100, y: 50, w: 100, h: 40 }
        expect(engine.hitRect(scene, part, 'intersect')).toEqual([a])
        expect(engine.hitRect(scene, part, 'contain')).toEqual([])
        const whole = { x: -10, y: -10, w: 200, h: 200 }
        expect(engine.hitRect(scene, whole, 'contain')).toEqual([a])
        expect(engine.hitRect(scene, { x: -10, y: -10, w: 800, h: 200 }, 'contain')).toEqual([a, b])
      })
      it('does not count a rect that only touches an edge, and finds nothing far away', () => {
        expect(engine.hitRect(scene, { x: M.w, y: 0, w: 50, h: 50 }, 'intersect')).toEqual([])
        expect(engine.hitRect(scene, { x: 5000, y: 5000, w: 10, h: 10 }, 'intersect')).toEqual([])
      })
      it('keeps contain within intersect, in z-order, agreeing with the definition', () => {
        forSeeds(25, (rng) => {
          const s = randomScene(pileSpecs(rng, 16, 1000, 800))
          const r = { x: rng.range(-50, 900), y: rng.range(-50, 700), w: rng.range(1, 600), h: rng.range(1, 500) }
          const inter = engine.hitRect(s, r, 'intersect')
          const contain = engine.hitRect(s, r, 'contain')
          expect(contain.every((k) => inter.includes(k))).toBe(true)
          expect(inter).toEqual(s.cards.filter((c) => rectsIntersect(r, c.rect)).map((c) => c.key))
          expect(contain).toEqual(s.cards.filter((c) => rectContainsRect(r, c.rect)).map((c) => c.key))
        })
      })
    })

    describe('readingOrder', () => {
      it('is rows then columns, even when cards are a few pixels off the lattice', () => {
        forSeeds(10, (rng) => {
          const specs = latticeSpecs(rng, 4, 3)
          const scene = randomScene(specs)
          const expected = specs.map((s) => keyOf(s.folder ? folder(s.id) : file(s.id)))
          expect(engine.readingOrder(scene)).toEqual(expected)
        })
      })
      it('is a permutation of the keys and does not depend on the array order of the cards', () => {
        forSeeds(20, (rng) => {
          const scene = randomScene(rng.chance(0.5) ? scatterSpecs(rng, 12, 1000, 800) : pileSpecs(rng, 12, 800, 600))
          const order = engine.readingOrder(scene)
          expect(sorted(order)).toEqual(sorted(scene.cards.map((c) => c.key)))
          expect(engine.readingOrder(permuted(scene, rng))).toEqual(order)
        })
      })
    })

    describe('spatialNeighbor', () => {
      const grid = sceneOf(Array.from({ length: 9 }, (_, i) => ({ id: `g${i}`, x: 16 + (i % 3) * 160, y: 16 + Math.floor(i / 3) * 144 })))
      const k = (i: number) => keyOf(file(`g${i}`))
      it('moves to the adjacent card in each direction', () => {
        expect(engine.spatialNeighbor(grid, k(4), 'up')).toBe(k(1))
        expect(engine.spatialNeighbor(grid, k(4), 'down')).toBe(k(7))
        expect(engine.spatialNeighbor(grid, k(4), 'left')).toBe(k(3))
        expect(engine.spatialNeighbor(grid, k(4), 'right')).toBe(k(5))
      })
      it('falls back to reading order at the edges and stops at the ends', () => {
        expect(engine.spatialNeighbor(grid, k(2), 'right')).toBe(k(3))
        expect(engine.spatialNeighbor(grid, k(3), 'left')).toBe(k(2))
        expect(engine.spatialNeighbor(grid, k(0), 'left')).toBeNull()
        expect(engine.spatialNeighbor(grid, k(0), 'up')).toBeNull()
        expect(engine.spatialNeighbor(grid, k(8), 'down')).toBeNull()
        expect(engine.spatialNeighbor(grid, k(8), 'right')).toBeNull()
      })
      it('has nowhere to go from an unknown key or a lone card', () => {
        expect(engine.spatialNeighbor(grid, 'nope', 'right')).toBeNull()
        expect(engine.spatialNeighbor(sceneOf([{ id: 'only', x: 0, y: 0 }]), keyOf(file('only')), 'right')).toBeNull()
      })
      it('picks the nearest card in the 90-degree cone whenever one exists, and never itself', () => {
        forSeeds(25, (rng) => {
          const scene = randomScene(scatterSpecs(rng, 14, 1100, 900))
          for (const card of scene.cards) for (const dir of ['up', 'down', 'left', 'right'] as const) {
            const got = engine.spatialNeighbor(scene, card.key, dir)
            expect(got).not.toBe(card.key)
            const c = rectCenter(card.rect)
            const cone = scene.cards.filter((o) => {
              if (o.key === card.key) return false
              const p = rectCenter(o.rect)
              const dx = p.x - c.x, dy = p.y - c.y
              const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy
              return along > 0 && Math.abs(dir === 'left' || dir === 'right' ? dy : dx) <= along
            })
            if (cone.length) {
              const dist = (o: SceneCard) => Math.hypot(rectCenter(o.rect).x - c.x, rectCenter(o.rect).y - c.y)
              expect(dist(scene.byKey.get(got!)!)).toBeCloseTo(Math.min(...cone.map(dist)), 9)
            }
          }
        })
      })
    })

    describe('snap', () => {
      const scene = sceneOf([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 300, y: 0 }])
      const b = keyOf(file('b'))
      it('aligns an edge or centre within the threshold, per axis, and reports the guide', () => {
        const r = engine.snap(scene, [b], { x: -155, y: 3 }, { threshold: 6 })
        expect(r.delta).toEqual({ x: -156, y: 0 })
        expect(r.guides.some((g) => g.axis === 'x' && g.at === M.w)).toBe(true)
        expect(r.guides.some((g) => g.axis === 'y' && g.at === 0)).toBe(true)
      })
      it('leaves the delta alone, with no guides, when nothing is within the threshold', () => {
        expect(engine.snap(scene, [b], { x: -80, y: 37 }, { threshold: 6 })).toEqual({ delta: { x: -80, y: 37 }, guides: [] })
      })
      it('never snaps a moving card to itself or to another moving card', () => {
        // b and c share a top edge with each other (y = 37) but not with a: both moving, so only a can attract, and it is too far.
        const three = sceneOf([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 300, y: 37 }, { id: 'c', x: 600, y: 37 }])
        const keys = [keyOf(file('b')), keyOf(file('c'))]
        expect(engine.snap(three, keys, { x: 0, y: 0 }, { threshold: 6 })).toEqual({ delta: { x: 0, y: 0 }, guides: [] })
      })
      it('snaps to the grid, not to guides, when the folder snaps to the grid', () => {
        const g = sceneOf([{ id: 'a', x: 3, y: 5 }, { id: 'b', x: 300, y: 0 }], { view: { iconSize: 'medium', snapToGrid: true } })
        expect(g.grid).toBe(8)
        const r = engine.snap(g, [keyOf(file('a'))], { x: 20, y: 7 }, { threshold: 6 })
        expect(r.guides).toEqual([])
        expect((3 + r.delta.x) % 8).toBe(0)
        expect((5 + r.delta.y) % 8).toBe(0)
      })
      it('is the identity for an empty moving set, and idempotent', () => {
        expect(engine.snap(scene, [], { x: 9, y: 9 }, { threshold: 6 })).toEqual({ delta: { x: 9, y: 9 }, guides: [] })
        forSeeds(20, (rng) => {
          const s = randomScene(scatterSpecs(rng, 10, 1000, 800))
          const moving = rng.shuffle(s.cards).slice(0, 1 + rng.int(3)).map((c) => c.key)
          const raw = { x: rng.range(-60, 60), y: rng.range(-60, 60) }
          const once = engine.snap(s, moving, raw, { threshold: 6 })
          expect(engine.snap(s, moving, once.delta, { threshold: 6 }).delta).toEqual(once.delta)
        })
      })
      it('moves the delta by at most the threshold per axis, with axis-aligned guides that lie on real edges', () => {
        forSeeds(40, (rng) => {
          const s = randomScene(scatterSpecs(rng, 12, 1100, 900))
          const threshold = rng.pick([2, 6, 12])
          const moving = rng.shuffle(s.cards).slice(0, 1 + rng.int(3))
          const raw = { x: rng.range(-80, 80), y: rng.range(-80, 80) }
          const r = engine.snap(s, moving.map((c) => c.key), raw, { threshold })
          expect(Math.abs(r.delta.x - raw.x)).toBeLessThanOrEqual(threshold + 1e-9)
          expect(Math.abs(r.delta.y - raw.y)).toBeLessThanOrEqual(threshold + 1e-9)
          const movingSet = new Set(moving.map((c) => c.key))
          const x0 = Math.min(...moving.map((c) => c.rect.x)) + r.delta.x, x1 = Math.max(...moving.map((c) => rectRight(c.rect))) + r.delta.x
          const y0 = Math.min(...moving.map((c) => c.rect.y)) + r.delta.y, y1 = Math.max(...moving.map((c) => rectBottom(c.rect))) + r.delta.y
          for (const g of r.guides) {
            expect(['x', 'y']).toContain(g.axis)
            expect(g.from).toBeLessThanOrEqual(g.to)
            const mine = g.axis === 'x' ? lines(x0, x1 - x0) : lines(y0, y1 - y0)
            expect(mine.some((v) => Math.abs(v - g.at) < 1e-9)).toBe(true)
            expect(s.cards.some((c) => !movingSet.has(c.key) &&
              (g.axis === 'x' ? lines(c.rect.x, c.rect.w) : lines(c.rect.y, c.rect.h)).some((v) => Math.abs(v - g.at) < 1e-9))).toBe(true)
          }
        })
      })
    })

    describe('dropTarget', () => {
      const scene = sceneOf([
        { id: 'F', folder: true, x: 0, y: 0 }, { id: 'G', x: 200, y: 0 }, { id: 'H', folder: true, x: 100, y: 50 },
      ])
      const F = keyOf(folder('F')), G = keyOf(file('G')), H = keyOf(folder('H'))
      it('names the folder under the point, the topmost where folders overlap', () => {
        expect(engine.dropTarget(scene, [G], { x: 20, y: 20 })).toBe(F)
        expect(engine.dropTarget(scene, [G], { x: 120, y: 60 })).toBe(H)
      })
      it('never names a moving card, a file, or empty space', () => {
        expect(engine.dropTarget(scene, [H], { x: 120, y: 60 })).toBe(F)
        expect(engine.dropTarget(scene, [F, H], { x: 120, y: 60 })).toBeNull()
        expect(engine.dropTarget(scene, [F], { x: 220, y: 20 })).toBeNull()
        expect(engine.dropTarget(scene, [G], { x: 900, y: 900 })).toBeNull()
      })
      it('ignores ghosts and drafts', () => {
        const withGhost = buildScene({
          ...inputOf([{ id: 'F', folder: true, x: 0, y: 0 }]),
          contests: [{ file: folder('F'), candidates: [
            { id: 'one', x: 0, y: 0, origin: 'this-tab', label: 'this tab', at: 1 }, { id: 'two', x: 500, y: 0, origin: 'other', label: 'other tab', at: 2 }] }],
          drafts: [{ draftId: 'd', kind: 'folder', label: 'Untitled folder', placement: { x: 900, y: 0 } }],
        }).scene
        expect(engine.dropTarget(withGhost, [], { x: 520, y: 20 })).toBeNull()
        expect(engine.dropTarget(withGhost, [], { x: 920, y: 20 })).toBeNull()
        expect(engine.dropTarget(withGhost, [], { x: 20, y: 20 })).toBe(keyOf(folder('F')))
      })
      it('returns a real folder containing the point, not moving, topmost among those', () => {
        forSeeds(30, (rng) => {
          const s = randomScene(pileSpecs(rng, 14, 900, 700))
          const moving = rng.shuffle(s.cards).slice(0, rng.int(4)).map((c) => c.key)
          const at = { x: rng.range(0, 900), y: rng.range(0, 700) }
          const expected = [...s.cards].reverse().find((c) => c.role === 'real' && c.kind === 'folder' && !moving.includes(c.key) && rectContainsPoint(c.rect, at))
          expect(engine.dropTarget(s, moving, at)).toBe(expected?.key ?? null)
        })
      })
    })

    describe('route', () => {
      const pair = (a: Spec, b: Spec, extra: Spec[] = []) => sceneOf([a, b, ...extra], { connections: [connection('c', file(a.id), file(b.id))] })
      it('runs a straight line between aligned neighbours, with the label at its midpoint', () => {
        const scene = pair({ id: 'a', x: 16, y: 16 }, { id: 'b', x: 176, y: 16 })
        const p = engine.route(scene, { pad: PAD }).get('c')!
        expect(p.points).toEqual([{ x: 160, y: 80 }, { x: 176, y: 80 }])
        expect(p.start.side).toBe('right'); expect(p.end.side).toBe('left')
        expect(p.labelAnchor).toEqual({ x: 168, y: 80 })
      })
      it('bends at most twice between neighbours that are not aligned', () => {
        const scene = pair({ id: 'a', x: 16, y: 16 }, { id: 'b', x: 176, y: 100 })
        const p = engine.route(scene, { pad: PAD }).get('c')!
        expect(bends(p.points)).toBe(2)
        expect(p.points.every((q, i) => i === 0 || q.x === p.points[i - 1]!.x || q.y === p.points[i - 1]!.y)).toBe(true)
      })
      it('leaves from the sides that face the other card', () => {
        const up = engine.route(pair({ id: 'a', x: 16, y: 400 }, { id: 'b', x: 16, y: 16 }), { pad: PAD }).get('c')!
        expect([up.start.side, up.end.side]).toEqual(['top', 'bottom'])
        const left = engine.route(pair({ id: 'a', x: 400, y: 16 }, { id: 'b', x: 16, y: 16 }), { pad: PAD }).get('c')!
        expect([left.start.side, left.end.side]).toEqual(['left', 'right'])
      })
      it('goes round a card whose glyph is in the way instead of through it', () => {
        const scene = pair({ id: 'a', x: 16, y: 16 }, { id: 'b', x: 496, y: 16 }, [{ id: 'blocker', x: 256, y: 16 }])
        const p = engine.route(scene, { pad: PAD }).get('c')!
        for (const card of scene.cards) for (let i = 0; i + 1 < p.points.length; i++) {
          expect(segmentHitsRect(p.points[i]!, p.points[i + 1]!, card.glyph), `segment ${i} crosses ${card.label}`).toBe(false)
        }
        expect(p.points.length).toBeGreaterThan(2)
      })
      it('omits a connector whose endpoint is not in the scene', () => {
        const scene = sceneOf([{ id: 'a', x: 16, y: 16 }], { connections: [connection('c', file('a'), file('gone'))] })
        expect(engine.route(scene, { pad: PAD }).size).toBe(0)
      })
      it('spreads parallel connectors and keeps their labels apart', () => {
        const scene = sceneOf([{ id: 'a', x: 16, y: 16 }, { id: 'b', x: 336, y: 16 }], {
          connections: [connection('1', file('a'), file('b'), 'explains'), connection('2', file('a'), file('b'), 'qualifies'),
            connection('3', file('b'), file('a'), 'contradicts')],
        })
        const paths = [...engine.route(scene, { pad: PAD }).values()]
        expect(paths).toHaveLength(3)
        const anchors = new Set(paths.map((p) => `${p.labelAnchor.x},${p.labelAnchor.y}`))
        expect(anchors.size).toBe(3)
        const boxes = paths.map((p) => labelBox(scene.connectors.find((c) => c.id === p.id)!.label, p.labelAnchor)!)
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(rectsIntersect(boxes[i]!, boxes[j]!)).toBe(false)
        const starts = new Set(paths.map((p) => `${p.start.at.x},${p.start.at.y}`))
        expect(starts.size).toBeGreaterThan(1)
      })
      it('keeps the labels of stacked parallel connectors apart: when their lines are closer than a label is tall, the labels slide along them', () => {
        // Small cards are 88 tall, so four relations between one pair leave 17.6 px between lines: a label is 18 tall.
        const scene = sceneOf([{ id: 'a', x: 16, y: 16 }, { id: 'b', x: 416, y: 16 }], {
          view: { iconSize: 'small', snapToGrid: false },
          connections: ['1', '2', '3', '4'].map((n) => connection(n, file('a'), file('b'), 'explains')),
        })
        const paths = engine.route(scene, { pad: PAD })
        const boxes = scene.connectors.map((c) => labelBox(c.label, paths.get(c.id)!.labelAnchor)!)
        const overlapping: string[] = []
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (rectsIntersect(boxes[i]!, boxes[j]!)) overlapping.push(`${i + 1}/${j + 1}`)
        expect(overlapping).toEqual([])
        for (const c of scene.connectors) expect(onPath(paths.get(c.id)!.points, paths.get(c.id)!.labelAnchor)).toBe(true)
      })
      it('attaches to the edges it names, orthogonally, with the label on the path, for any arrangement', () => {
        forSeeds(30, (rng) => {
          const specs = rng.pick([() => latticeSpecs(rng, 5, 4), () => scatterSpecs(rng, 16, 1400, 1000), () => pileSpecs(rng, 14, 900, 700)])()
          const scene = randomScene(specs, connectionsFor(rng, specs, 18))
          const paths = engine.route(scene, { pad: PAD })
          expect(paths.size).toBe(scene.connectors.length)
          const faults: string[] = []
          for (const c of scene.connectors) {
            const p = paths.get(c.id)!
            if (p.points.length < 2) faults.push(`${c.id}: fewer than two points`)
            for (let i = 1; i < p.points.length; i++) {
              if (p.points[i]!.x !== p.points[i - 1]!.x && p.points[i]!.y !== p.points[i - 1]!.y) faults.push(`${c.id}: segment ${i} is diagonal`)
            }
            if (JSON.stringify(p.start.at) !== JSON.stringify(p.points[0])) faults.push(`${c.id}: start.at is not the first point`)
            if (JSON.stringify(p.end.at) !== JSON.stringify(p.points[p.points.length - 1])) faults.push(`${c.id}: end.at is not the last point`)
            if (!onEdge(scene.byKey.get(c.from)!.rect, p.start.side, p.start.at)) faults.push(`${c.id}: start is not on the ${p.start.side} edge`)
            if (!onEdge(scene.byKey.get(c.to)!.rect, p.end.side, p.end.at)) faults.push(`${c.id}: end is not on the ${p.end.side} edge`)
            if (!onPath(p.points, p.labelAnchor)) faults.push(`${c.id}: label anchor is off the path`)
          }
          expect(faults).toEqual([])
        })
      })
      it('crosses no glyph box when the cards do not overlap (lattice and scattered layouts)', () => {
        forSeeds(40, (rng) => {
          const specs = rng.chance(0.5) ? latticeSpecs(rng, 6, 5) : scatterSpecs(rng, 20, 1500, 1100)
          const scene = randomScene(specs, connectionsFor(rng, specs, 24))
          const paths = engine.route(scene, { pad: PAD })
          const crossings: string[] = []
          for (const c of scene.connectors) {
            const p = paths.get(c.id)!
            for (const card of scene.cards) for (let i = 0; i + 1 < p.points.length; i++) {
              if (segmentHitsRect(p.points[i]!, p.points[i + 1]!, card.glyph)) crossings.push(`${c.id} segment ${i} crosses ${card.label}`)
            }
          }
          expect(crossings).toEqual([])
        })
      })
      it('never leaves labels more tangled than the plain midpoints would', () => {
        // A label rides its own line, so two connectors in a one-gap lane cannot always be told apart:
        // de-collision must only ever reduce the overlaps, never add any.
        const overlapCount = (boxes: Rect[]) => {
          let n = 0
          for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (rectsIntersect(boxes[i]!, boxes[j]!)) n++
          return n
        }
        forSeeds(40, (rng) => {
          const specs = latticeSpecs(rng, 5, 4)
          const scene = randomScene(specs, connectionsFor(rng, specs, 14))
          const paths = engine.route(scene, { pad: PAD })
          const chosen = scene.connectors.map((c) => labelBox(c.label, paths.get(c.id)!.labelAnchor)!)
          const plain = scene.connectors.map((c) => {
            const pts = paths.get(c.id)!.points
            let best = 0
            for (let i = 1; i + 1 < pts.length; i++) {
              const len = (k: number) => Math.abs(pts[k + 1]!.x - pts[k]!.x) + Math.abs(pts[k + 1]!.y - pts[k]!.y)
              if (len(i) > len(best)) best = i
            }
            return labelBox(c.label, { x: (pts[best]!.x + pts[best + 1]!.x) / 2, y: (pts[best]!.y + pts[best + 1]!.y) / 2 })!
          })
          expect(overlapCount(chosen)).toBeLessThanOrEqual(overlapCount(plain))
        })
      })
      it('is deterministic and does not depend on the order connectors are listed in', () => {
        forSeeds(15, (rng) => {
          const specs = latticeSpecs(rng, 5, 4)
          const connections = connectionsFor(rng, specs, 12)!
          const a = engine.route(randomScene(specs, connections), { pad: PAD })
          const b = engine.route(randomScene(specs, connections), { pad: PAD })
          const c = engine.route(randomScene(specs, rng.shuffle(connections)), { pad: PAD })
          for (const id of a.keys()) { expect(b.get(id)).toEqual(a.get(id)); expect(c.get(id)).toEqual(a.get(id)) }
        })
      })
    })

    describe('reroute: what moving cards changes', () => {
      const pads = { pad: PAD }
      const overlapping = (scene: SceneSnapshot) => scene.cards.some((c, i) => scene.cards.some((o, j) => j > i && rectsIntersect(c.rect, o.rect)))

      it('with nothing moved returns every route as it was, object for object', () => {
        forSeeds(10, (rng) => {
          const specs = latticeSpecs(rng, 5, 4)
          const scene = randomScene(specs, connectionsFor(rng, specs, 12))
          const before = engine.route(scene, pads)
          const after = engine.reroute(scene, new Set(), before, pads)
          expect(after.size).toBe(before.size)
          for (const [id, path] of before) expect(after.get(id)).toBe(path)
        })
      })

      it('keeps what it did not need to touch, object for object, and keeps every connector attached to the card it follows', () => {
        forSeeds(40, (rng) => {
          const specs = rng.chance(0.5) ? latticeSpecs(rng, 5, 4) : scatterSpecs(rng, 16, 1400, 1000)
          const scene = randomScene(specs, connectionsFor(rng, specs, 16))
          const before = engine.route(scene, pads)
          const moved = new Set(rng.shuffle(scene.cards).slice(0, 1 + rng.int(4)).map((c) => c.key))
          const after = moveCards(scene, [...moved], { x: Math.round(rng.range(-250, 250)), y: Math.round(rng.range(-250, 250)) })
          const next = engine.reroute(after, moved, before, pads)
          expect(next.size).toBe(after.connectors.length)
          // A connector is recomputed when it touches a moved card, or touches a card that such a connector touches.
          const touched = after.connectors.filter((c) => moved.has(c.from) || moved.has(c.to))
          const reach = new Set(touched.flatMap((c) => [c.from, c.to]))
          const faults: string[] = []
          const clean = !overlapping(after)
          const movedGlyphs = [...moved].map((k) => after.byKey.get(k)!.glyph)
          for (const c of after.connectors) {
            const path = next.get(c.id)!
            // Left alone unless it touches a moved card, or a moved card has come to rest in its way.
            const was = before.get(c.id)!
            const inTheWay = movedGlyphs.some((g) => was.points.some((p, i) => i > 0 && segmentHitsRect(was.points[i - 1]!, p, g)))
            if (!reach.has(c.from) && !reach.has(c.to) && !inTheWay && path !== was) faults.push(`${c.id}: an untouched route was replaced`)
            if (!onEdge(after.byKey.get(c.from)!.rect, path.start.side, path.start.at)) faults.push(`${c.id}: the start left its card`)
            if (!onEdge(after.byKey.get(c.to)!.rect, path.end.side, path.end.at)) faults.push(`${c.id}: the end left its card`)
            for (let i = 1; i < path.points.length; i++) {
              if (path.points[i]!.x !== path.points[i - 1]!.x && path.points[i]!.y !== path.points[i - 1]!.y) faults.push(`${c.id}: a diagonal segment`)
            }
            if (!onPath(path.points, path.labelAnchor)) faults.push(`${c.id}: label off the path`)
            if (clean) {
              for (const card of after.cards) for (let i = 0; i + 1 < path.points.length; i++) {
                if (segmentHitsRect(path.points[i]!, path.points[i + 1]!, card.glyph)) faults.push(`${c.id}: crosses ${card.label}`)
              }
            }
          }
          expect(faults).toEqual([])
        })
      })

      describe('a recomputed connector is the route a full route gives it, with a valid label (the port contract)', () => {
        const reproducer = () => {
          // The examiner's case: B -> D goes round C; C is then moved down out of the way, and C -> A is recomputed around the label B -> D kept.
          const scene = sceneOf([{ id: 'A', x: 14, y: 16 }, { id: 'B', folder: true, x: 19, y: 305 }, { id: 'C', x: 173, y: 308 }, { id: 'D', x: 494, y: 305 }], {
            connections: [connection('c1', folder('B'), file('D'), 'is a superseded draft of'), connection('c6', file('C'), file('A'), 'contradicts')],
          })
          const before = engine.route(scene, pads)
          const moved = new Set([keyOf(file('C'))])
          const after = moveCards(scene, [...moved], { x: 0, y: 300 })
          return { scene, before, moved, after, next: engine.reroute(after, moved, before, pads), full: engine.route(after, pads) }
        }

        it('holds for the examiner\'s reproducer: complete values, a kept connector kept whole, a recomputed label that is valid', () => {
          const { before, moved, after, next, full } = reproducer()
          expect(rerouteContractFaults(after, moved, before, next, full)).toEqual([])
          expect(next.get('c1')).toBe(before.get('c1'))
          const { labelAnchor: got, ...recomputed } = next.get('c6')!
          const { labelAnchor: want, ...fromScratch } = full.get('c6')!
          expect(recomputed).toEqual(fromScratch)
          // Where the anchor goes is the engine's to decide, but it is a point of the route.
          expect(onPath(next.get('c6')!.points, got)).toBe(true)
          expect(onPath(full.get('c6')!.points, want)).toBe(true)
        })

        it('starts again from the elbow a route a moved card has come to rest on: when the elbow is clear again, it is the route', () => {
          // x -> y goes round z. z moves down until it stands in that detour, and no longer in the straight line between x and y.
          const scene = sceneOf([{ id: 'x', x: 16, y: 16 }, { id: 'y', x: 656, y: 16 }, { id: 'z', x: 336, y: 16 }], {
            connections: [connection('c', file('x'), file('y'), 'explains')],
          })
          const before = engine.route(scene, pads)
          expect(before.get('c')!.points.length, 'the scene: c goes round z').toBeGreaterThan(2)
          const moved = new Set([keyOf(file('z'))])
          const after = moveCards(scene, [...moved], { x: 0, y: 60 })
          const full = engine.route(after, pads)
          expect(crossesGlyph(before.get('c')!.points, after.byKey.get(keyOf(file('z')))!.glyph), 'the scene: z now stands in the old detour').toBe(true)
          expect(bends(full.get('c')!.points), 'the scene: the elbow is clear again, so a full route is straight').toBe(0)
          const next = engine.reroute(after, moved, before, pads)
          expect(next.get('c')!.points).toEqual(full.get('c')!.points)
          expect(rerouteContractFaults(after, moved, before, next, full)).toEqual([])
        })

        it('holds for every connector a move touches or blocks, for any arrangement and any move', () => {
          let touched = 0, blocked = 0
          forSeeds(60, (rng) => {
            const specs = rng.pick([() => latticeSpecs(rng, 5, 4), () => scatterSpecs(rng, 16, 1400, 1000), () => pileSpecs(rng, 14, 900, 700)])()
            const scene = randomScene(specs, connectionsFor(rng, specs, 16))
            const before = engine.route(scene, pads)
            const moved = new Set(rng.shuffle(scene.cards).slice(0, 1 + rng.int(4)).map((c) => c.key))
            const after = moveCards(scene, [...moved], { x: Math.round(rng.range(-250, 250)), y: Math.round(rng.range(-250, 250)) })
            const next = engine.reroute(after, moved, before, pads)
            const full = engine.route(after, pads)
            const must = mustRecompute(after, moved, before)
            touched += must.touched.size; blocked += must.blocked.size
            expect(rerouteContractFaults(after, moved, before, next, full)).toEqual([])
          })
          // The property is not vacuous: moves in these arrangements touch connectors, and block some.
          expect(touched).toBeGreaterThan(100)
          expect(blocked).toBeGreaterThan(5)
        })
      })

      it('computes a connector it has never seen and forgets one whose card is gone', () => {
        const scene = sceneOf([{ id: 'a', x: 16, y: 16 }, { id: 'b', x: 336, y: 16 }, { id: 'c', x: 656, y: 16 }],
          { connections: [connection('ab', file('a'), file('b')), connection('bc', file('b'), file('c'))] })
        const before = engine.route(scene, pads)
        const without = new Map([...before].filter(([id]) => id === 'ab'))
        const next = engine.reroute(scene, new Set(), without, pads)
        expect([...next.keys()].sort()).toEqual(['ab', 'bc'])
        expect(next.get('ab')).toBe(before.get('ab'))
        const gone = sceneOf([{ id: 'a', x: 16, y: 16 }, { id: 'b', x: 336, y: 16 }], { connections: [connection('ab', file('a'), file('b')), connection('bc', file('b'), file('c'))] })
        expect([...engine.reroute(gone, new Set(), before, pads).keys()]).toEqual(['ab'])
      })
    })

    describe('answers for the snapshot it is given, not for the last one it saw (hit tests after a move)', () => {
      const home = sceneOf([{ id: 'F', folder: true, x: 0, y: 0 }, { id: 'G', x: 300, y: 0 }])
      const F = keyOf(folder('F')), G = keyOf(file('G'))
      const away = moveCards(home, [F], { x: 700, y: 400 })
      const back = moveCards(away, [F], { x: -700, y: -400 })           // home again, but a new snapshot
      const point = { x: 60, y: 60 }, probe = { x: 50, y: 50, w: 20, h: 20 }
      const ask = (s: SceneSnapshot) => [engine.dropTarget(s, [G], point), engine.hitRect(s, probe, 'intersect').includes(F)]

      it('finds a card where it is now, whatever the same point said a moment ago', () => {
        for (let round = 0; round < 3; round++) {
          expect(ask(home)).toEqual([F, true]); expect(ask(home)).toEqual([F, true])
          expect(ask(away)).toEqual([null, false]); expect(ask(away)).toEqual([null, false])
          expect(ask(back)).toEqual([F, true])
        }
        for (const s of [home, away, back, away, home, back, back, away]) expect(ask(s)).toEqual(s === away ? [null, false] : [F, true])
      })

      it('finds the card at its new place too, and the old place is empty', () => {
        expect(engine.dropTarget(away, [G], { x: 760, y: 460 })).toBe(F)
        expect(engine.dropTarget(away, [G], point)).toBeNull()
        expect(engine.dropTarget(home, [G], { x: 760, y: 460 })).toBeNull()
      })

      it('snaps to where the other cards are now, and routes to where the cards are now', () => {
        const base = sceneOf([{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 300, y: 37 }], { connections: [connection('ab', file('A'), file('B'))] })
        const B = keyOf(file('B'))
        const A = keyOf(file('A'))
        const aside = moveCards(base, [A], { x: 600, y: 0 })                 // A's right edge is no longer where B can reach it
        const aside2 = moveCards(aside, [A], { x: -600, y: 0 })               // and back, as a new snapshot
        const guides = (s: SceneSnapshot) => engine.snap(s, [B], { x: -155, y: 0 }, { threshold: 6 }).guides.filter((g) => g.axis === 'x').length
        for (let round = 0; round < 2; round++) {
          expect(guides(base)).toBeGreaterThan(0)
          expect(guides(aside)).toBe(0)
          expect(guides(aside2)).toBeGreaterThan(0)
        }
        const lowered = moveCards(base, [A], { x: 0, y: 400 })
        const lowered2 = moveCards(lowered, [A], { x: 0, y: -400 })
        const startAt = (s: SceneSnapshot) => engine.route(s, { pad: PAD }).get('ab')!.start.at
        const a0 = startAt(base), a1 = startAt(lowered), a2 = startAt(lowered2)
        expect(a1.y).toBeGreaterThan(a0.y + 300)
        expect(a2).toEqual(a0)
      })
    })

    if (engine.prepareDrag && engine.releaseDrag) {
      describe('the drag lifecycle', () => {
        const scene = sceneOf([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 300, y: 3 }])
        const b = keyOf(file('b'))
        it('is idempotent, and snapping says the same primed or not (an engine primes for the call when nobody did)', () => {
          const bare = engine.snap(scene, [b], { x: -155, y: 0 }, { threshold: 6 })
          engine.prepareDrag!(scene, [b]); engine.prepareDrag!(scene, [b])
          const primed = engine.snap(scene, [b], { x: -155, y: 0 }, { threshold: 6 })
          engine.releaseDrag!(); engine.releaseDrag!()
          expect(primed).toEqual(bare)
          expect(engine.snap(scene, [b], { x: -155, y: 0 }, { threshold: 6 })).toEqual(bare)
        })
        it('forgets a drag when it is released: a later snap is for the snapshot it is given', () => {
          engine.prepareDrag!(scene, [b])
          engine.releaseDrag!()
          const other = moveCards(scene, [keyOf(file('a'))], { x: 600, y: 0 })
          expect(engine.snap(other, [b], { x: -155, y: 0 }, { threshold: 6 }).guides.filter((g) => g.axis === 'x')).toEqual([])
        })
      })
    }

    describe('tidy', () => {
      const opts = { origin: { x: CARD_GAP, y: CARD_GAP }, gap: CARD_GAP }
      it('lays the cards out row-major in their current reading order', () => {
        const scene = sceneOf([{ id: 'a', x: 700, y: 20 }, { id: 'b', x: 20, y: 20 }, { id: 'c', x: 400, y: 20 }, { id: 'd', x: 50, y: 400 }])
        const t = engine.tidy(scene, { ...opts, columns: 3 })
        const at = (id: string) => t.get(keyOf(file(id)))
        expect(at('b')).toEqual({ x: 16, y: 16 })
        expect(at('c')).toEqual({ x: 16 + 160, y: 16 })
        expect(at('a')).toEqual({ x: 16 + 320, y: 16 })
        expect(at('d')).toEqual({ x: 16, y: 16 + 144 })
      })
      it('defaults to a roughly square block and handles an empty scene', () => {
        const nine = sceneOf(Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, x: i * 200, y: 0 })))
        const xs = new Set([...engine.tidy(nine, opts).values()].map((p) => p.x))
        expect(xs.size).toBe(3)
        expect(engine.tidy(sceneOf([]), opts).size).toBe(0)
      })
      it('produces no overlaps, and is deterministic, permutation-stable and idempotent', () => {
        forSeeds(25, (rng) => {
          const specs = rng.chance(0.5) ? scatterSpecs(rng, 14, 1400, 1000) : pileSpecs(rng, 14, 900, 700)
          const scene = randomScene(specs)
          const t = engine.tidy(scene, { ...opts, columns: 4 })
          expect(t.size).toBe(scene.cards.length)
          const rects = [...t.values()].map((p) => ({ x: p.x, y: p.y, w: M.w, h: M.h }))
          for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(rectsIntersect(rects[i]!, rects[j]!)).toBe(false)
          expect([...engine.tidy(scene, { ...opts, columns: 4 })]).toEqual([...t])
          expect(new Map(engine.tidy(permuted(scene, rng), { ...opts, columns: 4 }))).toEqual(new Map(t))
          const moved = randomScene(specs.map((s) => ({ ...s, x: t.get(keyOf(s.folder ? folder(s.id) : file(s.id)))!.x, y: t.get(keyOf(s.folder ? folder(s.id) : file(s.id)))!.y })))
          expect(new Map(engine.tidy(moved, { ...opts, columns: 4 }))).toEqual(new Map(t))
        })
      })
      it('leaves locked cards, ghosts and drafts where they are and tiles around them', () => {
        const scene = buildScene({
          ...inputOf([{ id: 'a', x: 16, y: 16 }, { id: 'b', x: 500, y: 16 }, { id: 'locked', x: 176, y: 16 }]),
          placementStates: { [keyOf(file('locked'))]: 'pending' },
          drafts: [{ draftId: 'd', kind: 'folder', label: 'Untitled folder', placement: { x: 336, y: 16 } }],
        }).scene
        const t = engine.tidy(scene, { ...opts, columns: 4 })
        expect(t.has(keyOf(file('locked')))).toBe(false)
        expect([...t.keys()].every((k) => scene.byKey.get(k)!.role === 'real')).toBe(true)
        const fixed = scene.cards.filter((c) => c.key === keyOf(file('locked')) || c.role === 'draft').map((c) => c.rect)
        for (const p of t.values()) for (const f of fixed) expect(rectsIntersect({ x: p.x, y: p.y, w: M.w, h: M.h }, f)).toBe(false)
      })
    })

    describe('nextFreeSlot', () => {
      it('starts at the first slot and follows reading order', () => {
        expect(engine.nextFreeSlot(sceneOf([]), null, CARD_GAP)).toEqual({ x: 16, y: 16 })
        expect(engine.nextFreeSlot(sceneOf([{ id: 'a', x: 16, y: 16 }]), null, CARD_GAP)).toEqual({ x: 176, y: 16 })
      })
      it('wraps after the lattice width, and reuses a hole left by a card that went away', () => {
        const row = [0, 1, 2, 3].map((i) => ({ id: `r${i}`, x: 16 + i * 160, y: 16 }))
        expect(engine.nextFreeSlot(sceneOf(row), null, CARD_GAP)).toEqual({ x: 16, y: 160 })
        expect(engine.nextFreeSlot(sceneOf(row.filter((r) => r.id !== 'r1')), null, CARD_GAP)).toEqual({ x: 176, y: 16 })
      })
      it('starts looking at `near` when given one', () => {
        const scene = sceneOf([{ id: 'a', x: 16, y: 16 }])
        const near = { x: 20, y: 400 }
        const slot = engine.nextFreeSlot(scene, near, CARD_GAP)
        expect(slot).toEqual({ x: 16, y: 16 + 2 * 144 })
      })
      it('never overlaps a card, is the first free slot, and is monotone as the folder fills', () => {
        forSeeds(30, (rng) => {
          const specs = rng.pick([() => scatterSpecs(rng, 10, 900, 700), () => pileSpecs(rng, 10, 900, 700), () => latticeSpecs(rng, 3, 3)])()
          const added: Spec[] = []
          let previous = -1
          for (let i = 0; i < 6; i++) {
            const scene = randomScene([...specs, ...added])
            const lattice = { size: scene.cardSize, gap: CARD_GAP, columns: scene.slotColumns }
            const slot = engine.nextFreeSlot(scene, null, CARD_GAP)
            const rect = { x: slot.x, y: slot.y, w: M.w, h: M.h }
            expect(scene.cards.some((c) => rectsIntersect(rect, c.rect))).toBe(false)
            const index = slotIndexAt(lattice, slot)
            expect(slotRect(lattice, index)).toEqual(rect)
            for (let j = 0; j < index; j++) expect(scene.cards.some((c) => rectsIntersect(slotRect(lattice, j), c.rect)), `slot ${j} was free`).toBe(true)
            expect(index).toBeGreaterThanOrEqual(previous)
            previous = index
            added.push({ id: `added${i}`, x: slot.x, y: slot.y })
          }
        })
      })
    })

    describe('nextFreeSlot with a region: where a person is looking', () => {
      const px = M.w + CARD_GAP, py = M.h + CARD_GAP
      const cell = (col: number, row: number): Rect => ({ x: CARD_GAP + col * px, y: CARD_GAP + row * py, w: M.w, h: M.h })
      const free = (scene: SceneSnapshot, rect: Rect) => !scene.cards.some((c) => rectsIntersect(rect, c.rect))
      /** The pan `revealRect` would make to show `rect` in full in a view that is `region` (no margin): what "the least pan" means. */
      const panOf = (region: Rect, rect: Rect): number => {
        const from = { x: -region.x, y: -region.y, zoom: 1 }
        const to = revealRect(from, { w: region.w, h: region.h }, rect, 0)
        return Math.hypot(to.x - from.x, to.y - from.y)
      }
      /** Brute force over every cell of the grid, by definition: the first free cell wholly inside, else the free cell with the least pan. */
      function expected(scene: SceneSnapshot, region: Rect): { at: Pt; inside: boolean } {
        const c0 = Math.floor((region.x - CARD_GAP) / px) - 1, c1 = Math.ceil((region.x + region.w - CARD_GAP) / px) + 1
        const r0 = Math.floor((region.y - CARD_GAP) / py) - 1, r1 = Math.ceil((region.y + region.h - CARD_GAP) / py) + 1
        for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
          const rect = cell(col, row)
          if (rectContainsRect(region, rect) && free(scene, rect)) return { at: { x: rect.x, y: rect.y }, inside: true }
        }
        const reach = 2600
        // Never above or left of both the lattice's first cell and the view's first row and column.
        const rowMin = Math.min(0, Math.ceil((region.y - CARD_GAP) / py)), colMin = Math.min(0, Math.ceil((region.x - CARD_GAP) / px))
        let best: { rect: Rect; pan: number } | null = null
        for (let row = Math.max(rowMin, r0 - Math.ceil(reach / py)); row <= r1 + Math.ceil(reach / py); row++) for (let col = Math.max(colMin, c0 - Math.ceil(reach / px)); col <= c1 + Math.ceil(reach / px); col++) {
          const rect = cell(col, row)
          if (!free(scene, rect)) continue
          const pan = panOf(region, rect)
          if (!best || pan < best.pan) best = { rect, pan }
        }
        return { at: { x: best!.rect.x, y: best!.rect.y }, inside: false }
      }

      it('puts a card where the pane looks when the lattice does not reach there: the first free cell of its own grid wholly in view', () => {
        const scene = sceneOf([{ id: 'a', x: 16, y: 16 }, { id: 'b', x: 176, y: 16 }, { id: 'c', x: 336, y: 16 }])
        expect(engine.nextFreeSlot(scene, null, CARD_GAP, { x: 1000, y: 0, w: 1024, h: 768 })).toEqual({ x: 1136, y: 16 })
        expect(engine.nextFreeSlot(scene, null, CARD_GAP, { x: 0, y: 0, w: 1024, h: 768 })).toEqual({ x: 496, y: 16 })
        expect(engine.nextFreeSlot(scene, null, CARD_GAP, { x: -600, y: -500, w: 500, h: 400 })).toEqual({ x: -464, y: -416 })
      })

      it('keeps the lattice\'s phase and pitch, so a card put there lines up with the ones the lattice laid out', () => {
        const scene = sceneOf([])
        const at = engine.nextFreeSlot(scene, null, CARD_GAP, { x: 3000, y: 2000, w: 800, h: 600 })
        expect((at.x - CARD_GAP) % px).toBe(0)
        expect((at.y - CARD_GAP) % py).toBe(0)
        const lattice = { size: scene.cardSize, gap: CARD_GAP, columns: scene.slotColumns }
        expect(slotRect(lattice, slotIndexAt(lattice, { x: 20, y: 20 }))).toEqual({ x: CARD_GAP, y: CARD_GAP, w: M.w, h: M.h })
      })

      it('takes the free cell that needs the least pan when every cell in view is taken, the earlier in reading order on a tie', () => {
        // Cards fill every cell wholly in the region (columns 7 to 11, rows 0 to 4). Column 6 starts 24 left of it.
        const specs: Spec[] = []
        for (let row = 0; row <= 4; row++) for (let col = 7; col <= 11; col++) specs.push({ id: `g${row}-${col}`, x: 16 + col * 160, y: 16 + row * 144 })
        const scene = sceneOf(specs)
        expect(engine.nextFreeSlot(scene, null, CARD_GAP, { x: 1000, y: 0, w: 1024, h: 768 })).toEqual({ x: 976, y: 16 })
        // Without column 6 free: columns 12 (56) and the row below (96); then 12 wins.
        const walled = sceneOf([...specs, ...[0, 1, 2, 3, 4].map((row) => ({ id: `w${row}`, x: 16 + 6 * 160, y: 16 + row * 144 }))])
        expect(engine.nextFreeSlot(walled, null, CARD_GAP, { x: 1000, y: 0, w: 1024, h: 768 })).toEqual({ x: 1936, y: 16 })
      })

      it('does not put a card above everything when the view is full: the cell above the first row is as near as the one below, and is not taken', () => {
        // The pane shows rows 0 to 2 of columns 0 to 6, all taken. Row 3 starts at the pane's bottom edge (128 of pan); row -1 would need
        // 128 too, and comes first in reading order, but the lattice never reaches above its first row.
        const specs: Spec[] = []
        for (let row = 0; row <= 2; row++) for (let col = 0; col <= 6; col++) specs.push({ id: `g${row}-${col}`, x: 16 + col * 160, y: 16 + row * 144 })
        expect(engine.nextFreeSlot(sceneOf(specs), null, CARD_GAP, { x: 0, y: 0, w: 1024, h: 448 })).toEqual({ x: 16, y: 448 })
      })

      it('does not put a card left of everything either: a cell left of the first column is nearer (144) than the next column (150), and is not taken', () => {
        // The pane shows columns 0 and 1 of rows 0 and 1, and row 2 is taken too, so the cheapest cells would be column -1 or column 2.
        const specs: Spec[] = []
        for (let row = 0; row <= 2; row++) for (let col = 0; col <= 1; col++) specs.push({ id: `g${row}-${col}`, x: 16 + col * 160, y: 16 + row * 144 })
        expect(engine.nextFreeSlot(sceneOf(specs), null, CARD_GAP, { x: 0, y: 0, w: 330, h: 300 })).toEqual({ x: 336, y: 16 })
      })

      it('always finds one: a region smaller than a card, a region in a sea of cards, a region at negative coordinates', () => {
        const sea = sceneOf(Array.from({ length: 80 }, (_, i) => ({ id: `s${i}`, x: 16 + (i % 10) * 160, y: 16 + Math.floor(i / 10) * 144 })))
        for (const region of [{ x: 20, y: 20, w: 100, h: 90 }, { x: 300, y: 300, w: 400, h: 300 }, { x: -900, y: -900, w: 300, h: 300 }]) {
          const at = engine.nextFreeSlot(sea, null, CARD_GAP, region)
          expect(free(sea, { x: at.x, y: at.y, w: M.w, h: M.h }), JSON.stringify(region)).toBe(true)
        }
      })

      it('agrees with a brute force over the grid, for any arrangement and any region', () => {
        let insideCount = 0, panCount = 0
        forSeeds(80, (rng) => {
          const specs = rng.pick([() => scatterSpecs(rng, 12, 1600, 1000), () => pileSpecs(rng, 14, 900, 700), () => latticeSpecs(rng, 7, 6, { jitter: 0 })])()
          const scene = randomScene(specs)
          const region = { x: Math.round(rng.range(-600, 2200)), y: Math.round(rng.range(-400, 1400)), w: Math.round(rng.range(90, 1400)), h: Math.round(rng.range(80, 1000)) }
          const want = expected(scene, region)
          if (want.inside) insideCount++; else panCount++
          expect(engine.nextFreeSlot(scene, null, CARD_GAP, region), JSON.stringify(region)).toEqual(want.at)
        })
        // Both branches are exercised.
        expect(insideCount).toBeGreaterThan(10)
        expect(panCount).toBeGreaterThan(5)
      })

      it('is what it was without a region', () => {
        forSeeds(20, (rng) => {
          const scene = randomScene(scatterSpecs(rng, 10, 900, 700))
          const near = rng.chance(0.5) ? null : { x: Math.round(rng.range(0, 800)), y: Math.round(rng.range(0, 800)) }
          expect(engine.nextFreeSlot(scene, near, CARD_GAP, undefined)).toEqual(engine.nextFreeSlot(scene, near, CARD_GAP))
        })
      })
    })

    describe('fitCamera', () => {
      const viewport = { w: 800, h: 600 }
      it('fits the content with the inset and centres it', () => {
        const cam = engine.fitCamera({ x: 100, y: 50, w: 1000, h: 500 }, viewport, 24, 1)
        expect(cam.zoom).toBeCloseTo(752 / 1000, 12)
        const c = toViewport(cam, { x: 600, y: 300 })
        expect(c.x).toBeCloseTo(400, 9); expect(c.y).toBeCloseTo(300, 9)
      })
      it('never zooms past zoomMax: a folder of three files is not a wall of posters', () => {
        expect(engine.fitCamera({ x: 0, y: 0, w: 300, h: 140 }, viewport, 24, 1).zoom).toBe(1)
        expect(engine.fitCamera({ x: 0, y: 0, w: 300, h: 140 }, viewport, 24, 2).zoom).toBeCloseTo(Math.min(2, 752 / 300), 12)
      })
      it('keeps the bounds inside the viewport with the inset whenever the zoom range allows it', () => {
        forSeeds(40, (rng) => {
          const b = { x: rng.range(-500, 500), y: rng.range(-500, 500), w: rng.range(20, 3000), h: rng.range(20, 2000) }
          const vp = { w: rng.range(300, 1800), h: rng.range(300, 1200) }
          const inset = rng.pick([0, 12, 24])
          const zoomMax = rng.pick([1, 2])
          const cam = engine.fitCamera(b, vp, inset, zoomMax)
          expect(cam.zoom).toBeLessThanOrEqual(zoomMax)
          expect(cam.zoom).toBeGreaterThanOrEqual(ZOOM_MIN)
          const tl = toViewport(cam, { x: b.x, y: b.y }), br = toViewport(cam, { x: b.x + b.w, y: b.y + b.h })
          const center = toViewport(cam, { x: b.x + b.w / 2, y: b.y + b.h / 2 })
          expect(center.x).toBeCloseTo(vp.w / 2, 6); expect(center.y).toBeCloseTo(vp.h / 2, 6)
          const exact = Math.min(zoomMax, (vp.w - 2 * inset) / b.w, (vp.h - 2 * inset) / b.h)
          if (exact >= ZOOM_MIN) {
            expect(tl.x).toBeGreaterThanOrEqual(inset - 1e-6); expect(tl.y).toBeGreaterThanOrEqual(inset - 1e-6)
            expect(br.x).toBeLessThanOrEqual(vp.w - inset + 1e-6); expect(br.y).toBeLessThanOrEqual(vp.h - inset + 1e-6)
          }
        })
      })
    })
  })
}

// ---------------------------------------------------------------------------
// The differential harness: hold one engine to another on the functions where they must agree.
// ---------------------------------------------------------------------------

export interface Divergence { readonly fn: string; readonly scene: number; readonly detail: string }

const sameGuide = (a: SnapGuide, b: SnapGuide) => a.axis === b.axis && Math.abs(a.at - b.at) < 1e-9

/** A private copy of a snapshot: its own card objects, rects and glyphs, so it can be patched in place without touching the original. */
export function cloneScene(scene: SceneSnapshot): SceneSnapshot {
  const cards = scene.cards.map((card) => ({ ...card, rect: { ...card.rect }, glyph: { ...card.glyph } }))
  return { ...scene, cards, byKey: new Map(cards.map((card) => [card.key, card])) }
}

/** Move cards of a snapshot where they stand: the snapshot is the same object afterwards. (Snapshots are immutable by contract; this is the breach.) */
export function patchInPlace(scene: SceneSnapshot, keys: readonly string[], delta: Pt): void {
  for (const key of keys) {
    const card = scene.byKey.get(key)
    if (!card) continue
    for (const box of [card.rect, card.glyph] as { x: number; y: number }[]) { box.x += delta.x; box.y += delta.y }
  }
}

/**
 * `bounds`, `hitRect`, `dropTarget` and `readingOrder` must agree exactly. `snap` need only agree in
 * one direction: every guide the candidate finds within the threshold, the reference finds too (the
 * reference may find more, and a candidate that finds fewer is a coverage gap, not a divergence).
 * `route`, `tidy`, `nextFreeSlot`, `spatialNeighbor` and `fitCamera` are held by the properties in
 * `engineSuite`, not by equality.
 */
export function compareEngines(reference: CanvasEngine, candidate: CanvasEngine, scenes: readonly SceneSnapshot[], seed = 7): Divergence[] {
  const out: Divergence[] = []
  const rng = lcg(seed)
  const report = (fn: string, scene: number, detail: string) => out.push({ fn, scene, detail })
  scenes.forEach((scene, i) => {
    if (JSON.stringify(reference.bounds(scene)) !== JSON.stringify(candidate.bounds(scene))) report('bounds', i, 'bounds differ')
    if (JSON.stringify(reference.readingOrder(scene)) !== JSON.stringify(candidate.readingOrder(scene))) report('readingOrder', i, 'order differs')
    // Probes: random ones, and the ones a defect would hide from: every card, and every place two cards overlap.
    const rects: Rect[] = []
    const points: Pt[] = []
    for (let k = 0; k < 12; k++) {
      rects.push({ x: rng.range(-100, 1000), y: rng.range(-100, 800), w: rng.range(1, 700), h: rng.range(1, 600) })
      points.push({ x: rng.range(0, 1000), y: rng.range(0, 800) })
    }
    for (const card of scene.cards) {
      const r = card.rect
      rects.push(r, { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 }, { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 })
      points.push(rectCenter(r), { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h })
      for (const other of scene.cards) {
        if (other === card || !rectsIntersect(r, other.rect)) continue
        const x0 = Math.max(r.x, other.rect.x), y0 = Math.max(r.y, other.rect.y)
        const x1 = Math.min(r.x + r.w, other.rect.x + other.rect.w), y1 = Math.min(r.y + r.h, other.rect.y + other.rect.h)
        points.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 })
        rects.push({ x: Math.min(r.x, other.rect.x), y: Math.min(r.y, other.rect.y), w: r.w + other.rect.w, h: r.h + other.rect.h })
      }
    }
    for (const r of rects) for (const mode of ['intersect', 'contain'] as const) {
      if (JSON.stringify(reference.hitRect(scene, r, mode)) !== JSON.stringify(candidate.hitRect(scene, r, mode))) report('hitRect', i, `${mode} differs for ${JSON.stringify(r)}`)
    }
    for (const at of points) {
      const under = reference.dropTarget(scene, [], at)
      for (const moving of [[], under ? [under] : [], rng.shuffle(scene.cards).slice(0, 2).map((c) => c.key)]) {
        if (reference.dropTarget(scene, moving, at) !== candidate.dropTarget(scene, moving, at)) report('dropTarget', i, `differs at ${JSON.stringify(at)} moving ${moving.length}`)
      }
    }
    // Hit tests after a move: the same points, asked of a scene and of the scene after cards moved, and of the scene again, in
    // an order that revisits snapshots. An implementation that trusts a cache across in-place mutation answers for the wrong one.
    if (scene.cards.length > 1) {
      const subset = rng.shuffle(scene.cards).slice(0, 1 + rng.int(3)).map((c) => c.key)
      const v1 = moveCards(scene, subset, { x: Math.round(rng.range(-400, 400)), y: Math.round(rng.range(-400, 400)) })
      const v2 = moveCards(v1, rng.shuffle(v1.cards).slice(0, 2).map((c) => c.key), { x: Math.round(rng.range(-300, 300)), y: Math.round(rng.range(-300, 300)) })
      const v3 = moveCards(v2, subset, { x: Math.round(rng.range(-100, 100)), y: Math.round(rng.range(-100, 100)) })
      const variants = [scene, v1, v2, v3]
      const visits = [0, 0, 1, 1, 2, 0, 3, 3, 1, 0, 2, 2, 3]
      for (const at of points.slice(0, 18)) {
        const probe = { x: at.x - 8, y: at.y - 8, w: 16, h: 16 }
        for (const v of visits) {
          const s = variants[v]!
          if (reference.dropTarget(s, [], at) !== candidate.dropTarget(s, [], at)) report('dropTarget', i, `after a move: differs at ${JSON.stringify(at)} on variant ${v}`)
          if (JSON.stringify(reference.hitRect(s, probe, 'intersect')) !== JSON.stringify(candidate.hitRect(s, probe, 'intersect'))) report('hitRect', i, `after a move: differs near ${JSON.stringify(at)} on variant ${v}`)
        }
      }
    }
    // In place: the same snapshot object, its cards moved where they stand and asked again between patches, with no replacement
    // snapshot to tell an engine anything changed. A snapshot is immutable by contract, but an engine that keeps an answer for the one
    // it saw (keyed on the object, or on the question) must not hand it out for what the snapshot says now (port rule 2).
    if (scene.cards.length > 1) {
      const live = cloneScene(scene)
      const keys = live.cards.map((c) => c.key)
      const some = () => rng.shuffle(keys).slice(0, 1 + rng.int(3))
      const asked = (phase: string) => {
        if (JSON.stringify(reference.bounds(live)) !== JSON.stringify(candidate.bounds(live))) report('bounds', i, `in place: bounds differ ${phase}`)
        if (JSON.stringify(reference.readingOrder(live)) !== JSON.stringify(candidate.readingOrder(live))) report('readingOrder', i, `in place: order differs ${phase}`)
        for (const at of points.slice(0, 18)) {
          const probe = { x: at.x - 8, y: at.y - 8, w: 16, h: 16 }
          if (reference.dropTarget(live, [], at) !== candidate.dropTarget(live, [], at)) report('dropTarget', i, `in place: differs at ${JSON.stringify(at)} ${phase}`)
          if (JSON.stringify(reference.hitRect(live, probe, 'intersect')) !== JSON.stringify(candidate.hitRect(live, probe, 'intersect'))) report('hitRect', i, `in place: differs near ${JSON.stringify(at)} ${phase}`)
        }
      }
      asked('before any patch')
      asked('before any patch, again')
      const first = some(), step = { x: Math.round(rng.range(-400, 400)), y: Math.round(rng.range(-400, 400)) }
      patchInPlace(live, first, step); asked('after a patch')
      patchInPlace(live, first, { x: -step.x, y: -step.y }); asked('after the patch is undone')
      patchInPlace(live, some(), { x: Math.round(rng.range(-300, 300)), y: Math.round(rng.range(-300, 300)) }); asked('after another patch')
    }
    for (let k = 0; k < 12 && scene.cards.length; k++) {
      const moving = rng.shuffle(scene.cards).slice(0, 1 + rng.int(3)).map((c) => c.key)
      const delta = { x: rng.range(-60, 60), y: rng.range(-60, 60) }
      const threshold = rng.pick([4, 6, 10])
      const want = reference.snap(scene, moving, delta, { threshold }).guides
      const got = candidate.snap(scene, moving, delta, { threshold }).guides
      for (const g of got) if (!want.some((w) => sameGuide(w, g))) report('snap', i, `candidate guide ${g.axis}@${g.at} is unknown to the reference`)
    }
  })
  return out
}

/** A corpus the differential suite runs over: arranged, scattered and piled folders, with and without a grid. */
export function differentialCorpus(): SceneSnapshot[] {
  const corpus: SceneSnapshot[] = []
  forSeeds(6, (rng) => {
    corpus.push(randomScene(latticeSpecs(rng, 5, 4)))
    corpus.push(randomScene(scatterSpecs(rng, 14, 1100, 800)))
    corpus.push(randomScene(pileSpecs(rng, 14, 900, 700)))
    corpus.push(randomScene(pileSpecs(rng, 12, 700, 500, { folders: 0.8 })))
    corpus.push(buildScene({ ...inputOf(scatterSpecs(rng, 10, 1100, 800)), view: { iconSize: 'small', snapToGrid: true }, session: emptySession }).scene)
    // Connected folders: an engine that draws a connector as an element of its own (Excalidraw's bound arrows) answers its hit tests and
    // bounds over more than the cards, and a defect that only shows with connectors in the scene is invisible to a corpus without any.
    const lattice = latticeSpecs(rng, 5, 4), scattered = scatterSpecs(rng, 14, 1100, 800), piled = pileSpecs(rng, 12, 700, 500, { folders: 0.5 })
    corpus.push(randomScene(lattice, connectionsFor(rng, lattice, 14)))
    corpus.push(randomScene(scattered, connectionsFor(rng, scattered, 12)))
    corpus.push(randomScene(piled, connectionsFor(rng, piled, 10)))
  })
  return corpus
}

export function differentialSuite(name: string, reference: CanvasEngine, candidate: CanvasEngine): void {
  describe(`engine differential: ${name}`, () => {
    it('agrees with the reference on bounds, hitRect, dropTarget and readingOrder, and finds no guide the reference does not', () => {
      expect(compareEngines(reference, candidate, differentialCorpus())).toEqual([])
    })
  })
}

