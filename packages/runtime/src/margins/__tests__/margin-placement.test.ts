import { describe, expect, it } from 'vitest'
import { MARGIN_GEOMETRY, placeMarginBoxes, planMarginColumns, type MarginPlacementInput } from '../margin-placement.js'

const base = (entries: MarginPlacementInput['entries'], anchors: Record<string, number>): MarginPlacementInput => ({
  center: { x: 0, y: 0, width: 600, height: 1000 },
  anchors: new Map(Object.entries(anchors).map(([k, top]) => [k, { top, height: 40 }])),
  entries,
  columnWidth: { inner: 200, outer: 240, apparatus: 160 },
  gutter: 24,
  gap: 8,
})

describe('placeMarginBoxes — the margin-note rule', () => {
  it('sits an entry beside its anchor when nothing collides', () => {
    const r = placeMarginBoxes(base([{ id: 'r1', column: 'inner', anchorBlockIds: ['b2'], height: 60 }], { b1: 0, b2: 300 }))
    expect(r.entries[0]).toMatchObject({ id: 'r1', x: -224, y: 300, displacement: 0, anchorBlockId: 'b2' })
  })

  it('pushes a colliding entry down, never up, and records the displacement', () => {
    const r = placeMarginBoxes(base([
      { id: 't1', column: 'outer', anchorBlockIds: ['b1'], height: 200 },
      { id: 't2', column: 'outer', anchorBlockIds: ['b2'], height: 50 },
    ], { b1: 100, b2: 150 }))
    const t2 = r.entries.find(e => e.id === 't2')!
    expect(t2.y).toBe(100 + 200 + 8)
    expect(t2.displacement).toBe(308 - 150)
    expect(t2.y).toBeGreaterThanOrEqual(150)
  })

  it('orders by anchor, not by input order', () => {
    const r = placeMarginBoxes(base([
      { id: 'late', column: 'outer', anchorBlockIds: ['b9'], height: 40 },
      { id: 'early', column: 'outer', anchorBlockIds: ['b1'], height: 40 },
    ], { b1: 10, b9: 900 }))
    const ids = r.entries.filter(e => e.column === 'outer').map(e => e.id)
    expect(ids).toEqual(['early', 'late'])
  })

  it('uses the earliest measured anchor of a multi-anchor entry', () => {
    const r = placeMarginBoxes(base([{ id: 'x', column: 'inner', anchorBlockIds: ['b5', 'b2', 'missing'], height: 40 }], { b2: 200, b5: 500 }))
    expect(r.entries[0]).toMatchObject({ anchorBlockId: 'b2', y: 200 })
  })

  it('keeps the three columns fixed: inner left, outer right, apparatus outermost', () => {
    const r = placeMarginBoxes(base([
      { id: 'i', column: 'inner', anchorBlockIds: ['b1'], height: 40 },
      { id: 'o', column: 'outer', anchorBlockIds: ['b1'], height: 40 },
      { id: 'a', column: 'apparatus', anchorBlockIds: ['b1'], height: 40 },
    ], { b1: 0 }))
    const x = Object.fromEntries(r.entries.map(e => [e.id, e.x]))
    expect(x.i).toBeLessThan(0)
    expect(x.o).toBe(624)
    expect(x.a).toBe(624 + 240 + 24)
  })

  it('parks an entry whose anchor was not measured at the column foot, without an edge — never fabricates a position', () => {
    const r = placeMarginBoxes(base([
      { id: 'anchored', column: 'outer', anchorBlockIds: ['b1'], height: 40 },
      { id: 'orphan', column: 'outer', anchorBlockIds: ['gone'], height: 40 },
    ], { b1: 50 }))
    const orphan = r.entries.find(e => e.id === 'orphan')!
    expect(orphan.anchorBlockId).toBeNull()
    expect(orphan.y).toBe(50 + 40 + 8)
    expect(r.edges.map(e => e.entryId)).toEqual(['anchored'])
  })

  it('draws edges from the facing edge of the center to the near edge of the entry', () => {
    const r = placeMarginBoxes(base([
      { id: 'i', column: 'inner', anchorBlockIds: ['b1'], height: 40 },
      { id: 'o', column: 'outer', anchorBlockIds: ['b1'], height: 40 },
    ], { b1: 100 }))
    const inner = r.edges.find(e => e.entryId === 'i')!
    const outer = r.edges.find(e => e.entryId === 'o')!
    expect(inner.from.x).toBe(0)
    expect(inner.to.x).toBe(-224 + 200)
    expect(outer.from.x).toBe(600)
    expect(outer.to.x).toBe(624)
  })

  it('grows the page bounds to the lowest entry', () => {
    const r = placeMarginBoxes(base([{ id: 't', column: 'outer', anchorBlockIds: ['b1'], height: 400 }], { b1: 900 }))
    expect(r.bounds.height).toBe(1300)
  })
})

describe('planMarginColumns — how many margins the pane has room for', () => {
  const g = MARGIN_GEOMETRY
  const side = (w: number) => w + g.gutter
  const allThree = g.sheetMin + side(g.columnWidth.inner) + g.edge + side(g.columnWidth.outer) + side(g.columnWidth.apparatus) + g.edge

  it('lays out all three columns when the pane is wide enough', () => {
    const plan = planMarginColumns(allThree)
    expect(plan.visible).toEqual(['inner', 'outer', 'apparatus'])
    expect(plan.home).toEqual({ inner: 'inner', outer: 'outer', apparatus: 'apparatus' })
    expect(plan.insetStart).toBe(side(g.columnWidth.inner) + g.edge)
    expect(plan.insetEnd).toBe(side(g.columnWidth.outer) + side(g.columnWidth.apparatus) + g.edge)
  })

  it('folds the apparatus into the outer margin first', () => {
    const plan = planMarginColumns(allThree - 1)
    expect(plan.visible).toEqual(['inner', 'outer'])
    expect(plan.home.apparatus).toBe('outer')
    expect(plan.insetEnd).toBe(side(g.columnWidth.outer) + g.edge)
  })

  it('keeps one right-hand margin (where Garden already puts wire notes) for a middling pane', () => {
    const plan = planMarginColumns(g.sheetMin + side(g.columnWidth.outer) + g.edge)
    expect(plan.visible).toEqual(['outer'])
    expect(plan.home).toEqual({ inner: 'outer', outer: 'outer', apparatus: 'outer' })
    expect(plan.insetStart).toBe(0)
  })

  it('folds everything into inline disclosure when no margin fits beside a readable sheet, keeping only a marker gutter', () => {
    const plan = planMarginColumns(g.sheetMin + side(g.columnWidth.outer) + g.edge - 1)
    expect(plan.visible).toEqual([])
    expect(plan.home).toEqual({ inner: null, outer: null, apparatus: null })
    expect(plan.insetStart).toBe(0)
    expect(plan.insetEnd).toBe(g.markerGutter)
  })
})
