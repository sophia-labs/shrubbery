// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  IDENTITY_CAMERA, ZOOM_MAX, ZOOM_MIN, clampZoom, createSlotOccupancy, fitCamera, freeCellFor, latticeCell, panByViewport, panToReveal, rectContainsPoint,
  rectContainsRect, rectFromPoints, rectUnion, rectsIntersect, revealRect, segmentHitsRect, slotIndexAt, slotRect, toScene, toViewport, zoomAbout, type Camera,
} from '../geometry.js'
import { forSeeds } from './support/lcg.js'

describe('camera: viewport = (scene + {x, y}) * zoom', () => {
  it('converts both ways, and the two conversions are inverses', () => {
    const cam: Camera = { x: -40, y: 25, zoom: 1.5 }
    expect(toViewport(cam, { x: 100, y: 100 })).toEqual({ x: 90, y: 187.5 })
    expect(toScene(cam, { x: 90, y: 187.5 })).toEqual({ x: 100, y: 100 })
    forSeeds(30, (rng) => {
      const c = { x: rng.range(-500, 500), y: rng.range(-500, 500), zoom: rng.range(ZOOM_MIN, ZOOM_MAX) }
      const p = { x: rng.range(-1000, 1000), y: rng.range(-1000, 1000) }
      const back = toScene(c, toViewport(c, p))
      expect(back.x).toBeCloseTo(p.x, 9); expect(back.y).toBeCloseTo(p.y, 9)
    })
  })

  it('pans so the content follows the pointer', () => {
    forSeeds(20, (rng) => {
      const c = { x: rng.range(-300, 300), y: rng.range(-300, 300), zoom: rng.range(ZOOM_MIN, ZOOM_MAX) }
      const p = { x: rng.range(0, 500), y: rng.range(0, 500) }
      const dv = { x: rng.range(-80, 80), y: rng.range(-80, 80) }
      const before = toViewport(c, p), after = toViewport(panByViewport(c, dv), p)
      expect(after.x - before.x).toBeCloseTo(dv.x, 9); expect(after.y - before.y).toBeCloseTo(dv.y, 9)
    })
  })

  it('zooms about a point: the scene point under the pointer stays under it', () => {
    forSeeds(30, (rng) => {
      const c = { x: rng.range(-300, 300), y: rng.range(-300, 300), zoom: rng.range(0.6, 1.8) }
      const at = { x: rng.range(0, 800), y: rng.range(0, 600) }
      const under = toScene(c, at)
      const z = zoomAbout(c, at, rng.range(0.7, 1.4))
      const now = toViewport(z, under)
      expect(now.x).toBeCloseTo(at.x, 9); expect(now.y).toBeCloseTo(at.y, 9)
    })
  })

  it('clamps zoom to [0.5, 2] and returns the same camera at the limit', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN); expect(clampZoom(9)).toBe(ZOOM_MAX); expect(clampZoom(Number.NaN)).toBe(1)
    const atMax = { x: 3, y: 4, zoom: ZOOM_MAX }
    expect(zoomAbout(atMax, { x: 10, y: 10 }, 1.5)).toBe(atMax)
    expect(zoomAbout(IDENTITY_CAMERA, { x: 0, y: 0 }, 0.01).zoom).toBe(ZOOM_MIN)
  })
})

describe('fit and reveal', () => {
  it('fits and centres, never past zoomMax', () => {
    const cam = fitCamera({ x: 0, y: 0, w: 200, h: 100 }, { w: 1000, h: 800 }, 24, 1)
    expect(cam.zoom).toBe(1)
    expect(toViewport(cam, { x: 100, y: 50 })).toEqual({ x: 500, y: 400 })
  })

  it('reveals the least that shows a rect, leaves a visible rect alone, and aligns a rect too big to fit', () => {
    const vp = { w: 800, h: 600 }
    const cam = { x: 0, y: 0, zoom: 1 }
    expect(revealRect(cam, vp, { x: 100, y: 100, w: 144, h: 128 }, 16)).toBe(cam)
    const right = revealRect(cam, vp, { x: 900, y: 100, w: 144, h: 128 }, 16)
    expect(toViewport(right, { x: 1044, y: 0 }).x).toBe(800 - 16)
    const left = revealRect(cam, vp, { x: -300, y: 100, w: 144, h: 128 }, 16)
    expect(toViewport(left, { x: -300, y: 0 }).x).toBe(16)
    const huge = revealRect(cam, vp, { x: 50, y: 50, w: 5000, h: 5000 }, 16)
    expect(toViewport(huge, { x: 50, y: 50 })).toEqual({ x: 16, y: 16 })
    expect(revealRect({ x: 0, y: 0, zoom: 2 }, vp, { x: 100, y: 0, w: 100, h: 100 }, 16).zoom).toBe(2)
  })
})

describe('rects', () => {
  it('treats touching rects as not intersecting, and containment as inclusive', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 }
    expect(rectsIntersect(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false)
    expect(rectsIntersect(a, { x: 9.99, y: 0, w: 10, h: 10 })).toBe(true)
    expect(rectContainsRect(a, a)).toBe(true)
    expect(rectContainsRect(a, { x: 1, y: 1, w: 10, h: 1 })).toBe(false)
  })
  it('contains a point on the near edges but not on the far ones, so adjacent rects never share a point', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 }
    expect(rectContainsPoint(a, { x: 0, y: 0 })).toBe(true)
    expect(rectContainsPoint(a, { x: 10, y: 5 })).toBe(false)
    expect(rectContainsPoint(a, { x: 5, y: 10 })).toBe(false)
  })
  it('unions and builds from two corners either way round', () => {
    expect(rectUnion([])).toBeNull()
    expect(rectUnion([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: -5, w: 5, h: 5 }])).toEqual({ x: 0, y: -5, w: 25, h: 15 })
    expect(rectFromPoints({ x: 9, y: 2 }, { x: 3, y: 8 })).toEqual({ x: 3, y: 2, w: 6, h: 6 })
  })
})

describe('segmentHitsRect: through the interior only', () => {
  const r = { x: 10, y: 10, w: 20, h: 20 }
  it('hits when it crosses, starts inside, or cuts a corner', () => {
    expect(segmentHitsRect({ x: 0, y: 20 }, { x: 40, y: 20 }, r)).toBe(true)
    expect(segmentHitsRect({ x: 20, y: 0 }, { x: 20, y: 40 }, r)).toBe(true)
    expect(segmentHitsRect({ x: 15, y: 15 }, { x: 100, y: 15 }, r)).toBe(true)
    expect(segmentHitsRect({ x: 0, y: 12 }, { x: 12, y: 0 }, r)).toBe(false)
    expect(segmentHitsRect({ x: 0, y: 25 }, { x: 25, y: 0 }, r)).toBe(true)
    expect(segmentHitsRect({ x: 0, y: 0 }, { x: 40, y: 40 }, r)).toBe(true)
  })
  it('does not hit when it misses, ends at the boundary, or runs along it', () => {
    expect(segmentHitsRect({ x: 0, y: 5 }, { x: 40, y: 5 }, r)).toBe(false)
    expect(segmentHitsRect({ x: 0, y: 20 }, { x: 10, y: 20 }, r)).toBe(false)
    expect(segmentHitsRect({ x: 0, y: 10 }, { x: 40, y: 10 }, r)).toBe(false)
    expect(segmentHitsRect({ x: 10, y: 0 }, { x: 10, y: 40 }, r)).toBe(false)
    expect(segmentHitsRect({ x: 0, y: 0 }, { x: 0, y: 0 }, r)).toBe(false)
  })
})

describe('the slot lattice', () => {
  const lattice = { size: { w: 144, h: 128 }, gap: 16, columns: 4 }
  it('numbers slots in reading order from (gap, gap)', () => {
    expect(slotRect(lattice, 0)).toEqual({ x: 16, y: 16, w: 144, h: 128 })
    expect(slotRect(lattice, 3)).toEqual({ x: 16 + 3 * 160, y: 16, w: 144, h: 128 })
    expect(slotRect(lattice, 4)).toEqual({ x: 16, y: 16 + 144, w: 144, h: 128 })
  })
  it('finds the slot whose cell holds a point, clamping to the lattice', () => {
    expect(slotIndexAt(lattice, null)).toBe(0)
    expect(slotIndexAt(lattice, { x: -50, y: -50 })).toBe(0)
    expect(slotIndexAt(lattice, { x: 20, y: 400 })).toBe(8)
    expect(slotIndexAt(lattice, { x: 9000, y: 20 })).toBe(3)
    for (let i = 0; i < 20; i++) expect(slotIndexAt(lattice, { x: slotRect(lattice, i).x + 5, y: slotRect(lattice, i).y + 5 })).toBe(i)
  })
  it('marks the slots a rect overlaps, and only those', () => {
    const occ = createSlotOccupancy(lattice, [{ x: 100, y: 16, w: 144, h: 128 }])
    expect([0, 1, 2, 3].map((i) => occ.isTaken(i))).toEqual([true, true, false, false])
    expect(occ.firstFree(0)).toBe(2)
    expect(createSlotOccupancy(lattice, [{ x: -500, y: -500, w: 10, h: 10 }]).isTaken(0)).toBe(false)
    occ.add({ x: 16, y: 16, w: 144, h: 128 })
    expect(occ.isRectFree({ x: 400, y: 16, w: 10, h: 10 })).toBe(true)
    expect(occ.isRectFree({ x: 200, y: 16, w: 10, h: 10 })).toBe(false)
  })
})

describe('the lattice\'s grid beyond its columns', () => {
  const lattice = { size: { w: 144, h: 128 }, gap: 16, columns: 4 }
  it('has the lattice\'s own cells where it has them, and the same phase and pitch where it has not', () => {
    for (let i = 0; i < 12; i++) expect(latticeCell(lattice, i % 4, Math.floor(i / 4))).toEqual(slotRect(lattice, i))
    expect(latticeCell(lattice, 7, 0)).toEqual({ x: 16 + 7 * 160, y: 16, w: 144, h: 128 })
    expect(latticeCell(lattice, -2, -1)).toEqual({ x: 16 - 320, y: 16 - 144, w: 144, h: 128 })
  })

  it('measures the pan that shows a cell in full: nothing inside, the overhang beside, the hypotenuse at a corner', () => {
    const region = { x: 100, y: 100, w: 500, h: 400 }
    expect(panToReveal(region, { x: 100, y: 100, w: 144, h: 128 })).toBe(0)
    expect(panToReveal(region, { x: 456, y: 372, w: 144, h: 128 })).toBe(0)                  // exactly inside, edges touching
    expect(panToReveal(region, { x: 80, y: 200, w: 144, h: 128 })).toBe(20)                  // 20 left of the region
    expect(panToReveal(region, { x: 500, y: 200, w: 144, h: 128 })).toBe(44)                 // 44 past its right edge
    expect(panToReveal(region, { x: 500, y: 450, w: 144, h: 128 })).toBeCloseTo(Math.hypot(44, 78), 12)
    expect(panToReveal({ x: 0, y: 0, w: 100, h: 90 }, { x: 30, y: 10, w: 144, h: 128 })).toBeCloseTo(Math.hypot(30, 10), 12)   // larger than the region: top-left corners line up
  })

  it('takes the first free cell wholly in the region, in reading order, whatever the lattice\'s columns', () => {
    const region = { x: 1000, y: 0, w: 1024, h: 768 }
    expect(freeCellFor(lattice, region, [])).toEqual({ x: 1136, y: 16, w: 144, h: 128 })
    expect(freeCellFor(lattice, region, [{ x: 1136, y: 16, w: 144, h: 128 }])).toEqual({ x: 1296, y: 16, w: 144, h: 128 })
    // A rect that only touches a cell's edge does not take it.
    expect(freeCellFor(lattice, region, [{ x: 1136 - 50, y: 16, w: 50, h: 128 }])).toEqual({ x: 1136, y: 16, w: 144, h: 128 })
    expect(freeCellFor(lattice, region, [{ x: 1136 - 50, y: 16, w: 51, h: 128 }])).toEqual({ x: 1296, y: 16, w: 144, h: 128 })
  })

  it('falls back to the free cell that needs the least pan, and reading order breaks a tie', () => {
    const region = { x: 0, y: 0, w: 340, h: 300 }                 // two columns and two rows fit: columns 0 and 1, rows 0 and 1
    const all = [0, 1].flatMap((row) => [0, 1].map((col) => latticeCell(lattice, col, row)))
    // Column 2 starts at 336 and ends at 480: 140 past the edge; row 2 starts at 304 and ends at 432: 132 past it. Row 2 is nearer.
    expect(freeCellFor(lattice, region, all)).toEqual(latticeCell(lattice, 0, 2))
    // Take that row too, and the next nearest is column 2 of row 0 (140), before row 2's other cells and column 2 of row 1.
    expect(freeCellFor(lattice, region, [...all, latticeCell(lattice, 0, 2), latticeCell(lattice, 1, 2)])).toEqual(latticeCell(lattice, 2, 0))
  })

  it('always finds a free cell: a region smaller than a card, and one among cards for thousands of units', () => {
    const wall = Array.from({ length: 60 }, (_, i) => latticeCell(lattice, i % 10, Math.floor(i / 10)))
    for (const region of [{ x: 0, y: 0, w: 50, h: 50 }, { x: 200, y: 200, w: 300, h: 300 }, { x: -5000, y: -5000, w: 1, h: 1 }]) {
      const cell = freeCellFor(lattice, region, wall)
      expect(wall.some((w) => rectsIntersect(w, cell))).toBe(false)
    }
  })
})

