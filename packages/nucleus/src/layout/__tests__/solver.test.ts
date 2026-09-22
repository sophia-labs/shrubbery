/**
 * solver unit tests — recursive sizing (design §6.1) with exact expected
 * numbers, infeasibility handling (§6.2), directional-neighbor selection
 * (§6.1/§8), and the soft preferredAspectRatio/maxWidth/maxHeight
 * preferences (design §9.2 Phase 1 diff-review r1 — previously absent).
 *
 * `solveLayout` calls in THIS file go through a local shim that injects
 * `TEST_VALIDATE_OPTIONS` (fixtures.ts) by default — see fixtures.ts's header.
 */
import { describe, expect, it } from 'vitest'
import type { LayoutDocument, LayoutNode } from '../types.js'
import type { LeafConstraintsMap, SolveOptions, SolveResult } from '../solver.js'
import { findDirectionalNeighbor, solveLayout as solveLayoutRaw } from '../solver.js'
import {
  GRID_INELIGIBLE_FACE_ID,
  TEST_VALIDATE_OPTIONS,
  leafAndGridDoc,
  makeDescriptor,
  makeGridCell,
  singleGridDoc,
  singleLeafDoc,
  twoLeafDoc,
} from './fixtures.js'

function solveLayout(
  doc: LayoutDocument,
  leafConstraints: LeafConstraintsMap,
  containerWidth: number,
  containerHeight: number,
  options?: SolveOptions,
): SolveResult {
  return solveLayoutRaw(doc, leafConstraints, containerWidth, containerHeight, {
    ...TEST_VALIDATE_OPTIONS,
    ...options,
  })
}

describe('solveLayout — invalid documents never build a plan (LAY-012)', () => {
  it('returns ok:false with diagnostics for an invalid document, without throwing', () => {
    const doc = singleLeafDoc('root')
    const broken: LayoutDocument = { ...doc, rootNodeId: 'does-not-exist' }
    let result: ReturnType<typeof solveLayout> | undefined
    expect(() => {
      result = solveLayout(broken, {}, 800, 600)
    }).not.toThrow()
    expect(result!.ok).toBe(false)
    if (!result!.ok) expect(result!.diagnostics.length).toBeGreaterThan(0)
  })
})

describe('solveLayout — recursive sizing, exact numbers', () => {
  it('allocates a horizontal split by ratio with a 1px divider (design §6.1 formula)', () => {
    const { doc, splitId, leafAId, leafBId } = twoLeafDoc()
    const result = solveLayout(doc, {}, 1001, 500)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.root.id).toBe(splitId)
    if (result.plan.root.kind !== 'split') throw new Error('expected split')
    expect(result.plan.root.start.id).toBe(leafAId)
    expect(result.plan.root.start.allocation).toEqual({ x: 0, y: 0, width: 500, height: 500 })
    expect(result.plan.root.end.id).toBe(leafBId)
    expect(result.plan.root.end.allocation).toEqual({ x: 501, y: 0, width: 500, height: 500 })
    expect(result.plan.root.constrained).toBe(false)
    expect(result.diagnostics).toEqual([])
  })

  it('computes nested bottom-up minimums and exactly fits a zero-slack container', () => {
    // root(horizontal): leafA(min 100x50)  |  inner(vertical): leafB(min 80x60) / leafC(min 90x70)
    const nodes: Record<string, LayoutNode> = {
      root: { kind: 'split', id: 'root', axis: 'horizontal', startNodeId: 'leafA', endNodeId: 'inner', startBasisPoints: 5000 },
      leafA: { kind: 'leaf', id: 'leafA', descriptor: makeDescriptor('a', 'urn:a'), descriptorRevision: 0 },
      inner: { kind: 'split', id: 'inner', axis: 'vertical', startNodeId: 'leafB', endNodeId: 'leafC', startBasisPoints: 5000 },
      leafB: { kind: 'leaf', id: 'leafB', descriptor: makeDescriptor('b', 'urn:b'), descriptorRevision: 0 },
      leafC: { kind: 'leaf', id: 'leafC', descriptor: makeDescriptor('c', 'urn:c'), descriptorRevision: 0 },
    }
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'nested',
      scope: 'session',
      graphId: null,
      rootNodeId: 'root',
      nodes,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    const constraints: LeafConstraintsMap = {
      leafA: { minWidth: 100, minHeight: 50 },
      leafB: { minWidth: 80, minHeight: 60 },
      leafC: { minWidth: 90, minHeight: 70 },
    }
    // Required min: inner = {minWidth: max(80,90)=90, minHeight: 60+1+70=131}
    //               root  = {minWidth: 100+1+90=191, minHeight: max(50,131)=131}
    const result = solveLayout(doc, constraints, 191, 131)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diagnostics).toEqual([])
    if (result.plan.root.kind !== 'split') throw new Error('expected split')
    expect(result.plan.root.constrained).toBe(false)
    expect(result.plan.root.start.allocation).toEqual({ x: 0, y: 0, width: 100, height: 131 })
    const inner = result.plan.root.end
    expect(inner.id).toBe('inner')
    expect(inner.allocation).toEqual({ x: 101, y: 0, width: 90, height: 131 })
    if (inner.kind !== 'split') throw new Error('expected split')
    expect(inner.start.allocation).toEqual({ x: 101, y: 0, width: 90, height: 60 })
    expect(inner.end.allocation).toEqual({ x: 101, y: 61, width: 90, height: 70 })
  })

  it('infeasible containers allocate a deterministic proportional floor and mark constrained', () => {
    const { doc, leafAId, leafBId } = twoLeafDoc()
    const constraints: LeafConstraintsMap = {
      [leafAId]: { minWidth: 600, minHeight: 10 },
      [leafBId]: { minWidth: 600, minHeight: 10 },
    }
    // available = 100 - 1(divider) = 99; totalMin = 1200; start = round(99*600/1200) = 50
    const result = solveLayout(doc, constraints, 100, 50)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    if (result.plan.root.kind !== 'split') throw new Error('expected split')
    expect(result.plan.root.constrained).toBe(true)
    expect(result.plan.root.start.allocation.width).toBe(50)
    expect(result.plan.root.end.allocation.width).toBe(49)
    expect(result.plan.root.start.constrained).toBe(true)
    expect(result.plan.root.end.constrained).toBe(true)
    const codes = result.diagnostics.map((d) => d.code)
    expect(codes).toEqual(['LAYGEO_LEAF_CONSTRAINED', 'LAYGEO_LEAF_CONSTRAINED'])
    // content-free: diagnostics carry only ids/numbers, never resource content.
    for (const d of result.diagnostics) {
      expect(JSON.stringify(d)).not.toMatch(/urn:test/)
    }
  })

  it('a generously-sized single leaf is never constrained and fills the container', () => {
    const doc = singleLeafDoc('root')
    const result = solveLayout(doc, { root: { minWidth: 10, minHeight: 10 } }, 400, 300)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.root).toEqual({
      kind: 'leaf',
      id: 'root',
      allocation: { x: 0, y: 0, width: 400, height: 300 },
      constrained: false,
    })
  })
})

// ── grid/collection node — opaque box, ONE allocation, NO interior solving
// (Wave 2 x Lane B, design plans/surface-wave2-laneb-slice-20260716.md §2.3) ─

describe('solveLayout — grid node: opaque box, min-constraints from minCellWidth + a fixed floor height', () => {
  it('a single root grid presents as ONE opaque allocation, filling the container when generously sized', () => {
    const doc = singleGridDoc('grid-root') // minCellWidth: 200
    const result = solveLayout(doc, {}, 400, 300)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.root).toEqual({
      kind: 'grid',
      id: 'grid-root',
      allocation: { x: 0, y: 0, width: 400, height: 300 },
      constrained: false,
    })
    expect(result.diagnostics).toEqual([])
  })

  it('leafConstraints entries are IGNORED for a grid — its minimum comes ENTIRELY from its own minCellWidth + the floor height', () => {
    const doc = singleGridDoc('grid-root') // minCellWidth: 200
    // A caller-supplied constraint that would make ANY leaf constrained at
    // this container size is irrelevant here — grids do not consult
    // `leafConstraints` at all (design §2.3).
    const result = solveLayout(doc, { 'grid-root': { minWidth: 9999, minHeight: 9999 } }, 400, 300)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.root.constrained).toBe(false)
    expect(result.plan.root.allocation).toEqual({ x: 0, y: 0, width: 400, height: 300 })
  })

  it('a grid allocated below minCellWidth / the floor height is marked constrained, with a LAYGEO_GRID_CONSTRAINED diagnostic', () => {
    const doc = singleGridDoc('grid-root') // minCellWidth: 200
    const result = solveLayout(doc, {}, 100, 50)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.root).toEqual({
      kind: 'grid',
      id: 'grid-root',
      allocation: { x: 0, y: 0, width: 100, height: 50 },
      constrained: true,
    })
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'LAYGEO_GRID_CONSTRAINED',
        details: expect.objectContaining({ minWidth: 200, minHeight: 120, allocatedWidth: 100, allocatedHeight: 50 }),
      }),
    ])
  })

  it('a mixed leaf+grid split: nested minimums include the grid floor height on the cross axis', () => {
    // root(horizontal): leafA(minWidth 50, minHeight 50)  |  gridB(minCellWidth 150, floor height 120)
    const nodes: Record<string, LayoutNode> = {
      root: { kind: 'split', id: 'root', axis: 'horizontal', startNodeId: 'leafA', endNodeId: 'gridB', startBasisPoints: 5000 },
      leafA: { kind: 'leaf', id: 'leafA', descriptor: makeDescriptor('a', 'urn:a'), descriptorRevision: 0 },
      gridB: { kind: 'grid', id: 'gridB', flow: 'reflow', minCellWidth: 150, children: { kind: 'fixed', cells: [] }, gridRevision: 0 },
    }
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'mixed',
      scope: 'session',
      graphId: null,
      rootNodeId: 'root',
      nodes,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    // Required min: root = {minWidth: 50+1+150=201, minHeight: max(50,120)=120}
    const result = solveLayout(doc, { leafA: { minWidth: 50, minHeight: 50 } }, 201, 120)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diagnostics).toEqual([])
    if (result.plan.root.kind !== 'split') throw new Error('expected split')
    expect(result.plan.root.constrained).toBe(false)
    expect(result.plan.root.start.allocation).toEqual({ x: 0, y: 0, width: 50, height: 120 })
    expect(result.plan.root.end.kind).toBe('grid')
    expect(result.plan.root.end.allocation).toEqual({ x: 51, y: 0, width: 150, height: 120 })
    expect(result.plan.root.end.constrained).toBe(false)
  })

  it("a constrained grid propagates its own constrained flag up into the ancestor split's constrained flag", () => {
    const nodes: Record<string, LayoutNode> = {
      root: { kind: 'split', id: 'root', axis: 'horizontal', startNodeId: 'leafA', endNodeId: 'gridB', startBasisPoints: 5000 },
      leafA: { kind: 'leaf', id: 'leafA', descriptor: makeDescriptor('a', 'urn:a'), descriptorRevision: 0 },
      gridB: { kind: 'grid', id: 'gridB', flow: 'reflow', minCellWidth: 150, children: { kind: 'fixed', cells: [] }, gridRevision: 0 },
    }
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'mixed-constrained',
      scope: 'session',
      graphId: null,
      rootNodeId: 'root',
      nodes,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    // Container far below combined min (201) forces the infeasibility branch.
    const result = solveLayout(doc, { leafA: { minWidth: 50, minHeight: 10 } }, 100, 50)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    if (result.plan.root.kind !== 'split') throw new Error('expected split')
    expect(result.plan.root.constrained).toBe(true)
    expect(result.plan.root.start.constrained).toBe(true)
    expect(result.plan.root.end.constrained).toBe(true)
    const codes = result.diagnostics.map((d) => d.code).sort()
    expect(codes).toEqual(['LAYGEO_GRID_CONSTRAINED', 'LAYGEO_LEAF_CONSTRAINED'])
  })

  it('an invalid grid document (cell face fails the persistence rule) is rejected before any plan is built (LAY-012)', () => {
    const doc = singleGridDoc('grid-root', [makeGridCell('a', GRID_INELIGIBLE_FACE_ID)])
    let result: SolveResult | undefined
    expect(() => {
      result = solveLayout(doc, {}, 400, 300)
    }).not.toThrow()
    expect(result!.ok).toBe(false)
    if (result!.ok) return
    expect(result!.diagnostics.some((d) => d.code === 'LAY003_CELL_FACE_NOT_GRID_ELIGIBLE')).toBe(true)
  })
})

describe('findDirectionalNeighbor — a grid is a focusable terminal, exactly like a leaf', () => {
  it('navigates leaf -> grid and back, both occupying one rectangle each', () => {
    const { doc, leafId, gridId } = leafAndGridDoc() // horizontal split: leaf (start) | grid (end)
    const result = solveLayout(doc, {}, 800, 600, { dividerThickness: 0 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(findDirectionalNeighbor(result.plan, leafId, 'right')).toBe(gridId)
    expect(findDirectionalNeighbor(result.plan, gridId, 'left')).toBe(leafId)
  })
})

/** Build a 2x2 leaf grid with a zero-thickness divider for exact rectangle math. */
function buildGrid(): {
  readonly doc: LayoutDocument
  readonly topLeft: string
  readonly bottomLeft: string
  readonly topRight: string
  readonly bottomRight: string
} {
  const nodes: Record<string, LayoutNode> = {
    root: { kind: 'split', id: 'root', axis: 'horizontal', startNodeId: 'left', endNodeId: 'right', startBasisPoints: 5000 },
    left: { kind: 'split', id: 'left', axis: 'vertical', startNodeId: 'topLeft', endNodeId: 'bottomLeft', startBasisPoints: 5000 },
    right: { kind: 'split', id: 'right', axis: 'vertical', startNodeId: 'topRight', endNodeId: 'bottomRight', startBasisPoints: 5000 },
    topLeft: { kind: 'leaf', id: 'topLeft', descriptor: makeDescriptor('a', 'urn:tl'), descriptorRevision: 0 },
    bottomLeft: { kind: 'leaf', id: 'bottomLeft', descriptor: makeDescriptor('a', 'urn:bl'), descriptorRevision: 0 },
    topRight: { kind: 'leaf', id: 'topRight', descriptor: makeDescriptor('a', 'urn:tr'), descriptorRevision: 0 },
    bottomRight: { kind: 'leaf', id: 'bottomRight', descriptor: makeDescriptor('a', 'urn:br'), descriptorRevision: 0 },
  }
  const doc: LayoutDocument = {
    schemaVersion: 1,
    layoutId: 'grid',
    scope: 'session',
    graphId: null,
    rootNodeId: 'root',
    nodes,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  }
  return { doc, topLeft: 'topLeft', bottomLeft: 'bottomLeft', topRight: 'topRight', bottomRight: 'bottomRight' }
}

describe('findDirectionalNeighbor — solved-rectangle navigation (design §6.1/§8)', () => {
  it('picks the neighbor with greatest orthogonal overlap in the requested half-plane', () => {
    const { doc, topLeft, bottomLeft, topRight, bottomRight } = buildGrid()
    const result = solveLayout(doc, {}, 800, 600, { dividerThickness: 0 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(findDirectionalNeighbor(result.plan, topLeft, 'right')).toBe(topRight)
    expect(findDirectionalNeighbor(result.plan, topLeft, 'down')).toBe(bottomLeft)
    expect(findDirectionalNeighbor(result.plan, bottomRight, 'left')).toBe(bottomLeft)
    expect(findDirectionalNeighbor(result.plan, bottomRight, 'up')).toBe(topRight)
  })

  it('returns null when nothing lies in the requested half-plane', () => {
    const { doc, topLeft } = buildGrid()
    const result = solveLayout(doc, {}, 800, 600, { dividerThickness: 0 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(findDirectionalNeighbor(result.plan, topLeft, 'up')).toBeNull()
  })

  it('returns null for an unknown fromLeafId', () => {
    const { doc } = buildGrid()
    const result = solveLayout(doc, {}, 800, 600, { dividerThickness: 0 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(findDirectionalNeighbor(result.plan, 'ghost', 'right')).toBeNull()
  })
})

describe('solveLayout — soft preferences: preferredAspectRatio / maxWidth / maxHeight (design §6.1/§6.2, §9.2 Phase 1 r1)', () => {
  it('flags a leaf allocated above its soft maxWidth, without shrinking any sibling to enforce it', () => {
    const { doc, splitId, leafAId, leafBId } = twoLeafDoc()
    const constraints: LeafConstraintsMap = { [leafAId]: { minWidth: 0, minHeight: 0, maxWidth: 100 } }
    const result = solveLayout(doc, constraints, 1001, 500)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The ratio-driven allocation (50/50 of 1000px minus a 1px divider) still
    // gives leafA 500px — the solver does NOT shrink it to respect maxWidth.
    if (result.plan.root.kind !== 'split') throw new Error('expected split')
    expect(result.plan.root.id).toBe(splitId)
    expect(result.plan.root.start.allocation.width).toBe(500)
    const codes = result.diagnostics.map((d) => d.code)
    expect(codes).toContain('LAYGEO_LEAF_EXCEEDS_MAX')
    // diagnostic.nodeId is TOKENIZED (Builder P1 hardening finding 3) — a
    // single-diagnostic-of-this-code lookup is the stable way to find it here.
    const diagnostic = result.diagnostics.find((d) => d.code === 'LAYGEO_LEAF_EXCEEDS_MAX')
    expect(diagnostic?.details).toMatchObject({ axis: 'width', maxWidth: 100 })
    void leafBId
  })

  it('flags a leaf allocated above its soft maxHeight', () => {
    const doc = singleLeafDoc('root')
    const result = solveLayout(doc, { root: { minWidth: 0, minHeight: 0, maxHeight: 50 } }, 200, 300)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const codes = result.diagnostics.map((d) => d.code)
    expect(codes).toContain('LAYGEO_LEAF_EXCEEDS_MAX')
    const diagnostic = result.diagnostics.find((d) => d.code === 'LAYGEO_LEAF_EXCEEDS_MAX')
    expect(diagnostic?.details).toMatchObject({ axis: 'height', maxHeight: 50 })
  })

  it('does NOT flag a leaf within its maxWidth/maxHeight', () => {
    const doc = singleLeafDoc('root')
    const result = solveLayout(doc, { root: { minWidth: 0, minHeight: 0, maxWidth: 1000, maxHeight: 1000 } }, 200, 300)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diagnostics).toEqual([])
  })

  it('flags a leaf whose allocated aspect ratio misses its soft preferredAspectRatio beyond tolerance', () => {
    const doc = singleLeafDoc('root')
    // Allocation will be exactly 200x100 (aspect 2.0); prefer a 1:1 square.
    const result = solveLayout(doc, { root: { minWidth: 0, minHeight: 0, preferredAspectRatio: 1 } }, 200, 100)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const diagnostic = result.diagnostics.find((d) => d.code === 'LAYGEO_LEAF_ASPECT_MISMATCH')
    expect(diagnostic).toBeDefined()
    expect(diagnostic?.details).toMatchObject({ preferredAspectRatio: 1, actualAspectRatio: 2 })
  })

  it('does NOT flag a leaf whose allocated aspect ratio matches its soft preference within tolerance', () => {
    const doc = singleLeafDoc('root')
    const result = solveLayout(doc, { root: { minWidth: 0, minHeight: 0, preferredAspectRatio: 2 } }, 200, 100)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diagnostics).toEqual([])
  })

  it('the aspect-ratio check never divides by zero / produces NaN for a zero-height allocation', () => {
    const { doc, leafAId } = twoLeafDoc()
    const constraints: LeafConstraintsMap = { [leafAId]: { minWidth: 0, minHeight: 0, preferredAspectRatio: 1 } }
    let result: SolveResult | undefined
    expect(() => {
      result = solveLayout(doc, constraints, 800, 0)
    }).not.toThrow()
    expect(result!.ok).toBe(true)
    if (!result!.ok) return
    for (const d of result!.diagnostics) {
      if (d.code === 'LAYGEO_LEAF_ASPECT_MISMATCH') {
        expect(Number.isFinite(d.details?.actualAspectRatio)).toBe(true)
      }
    }
  })

  it('extreme-but-individually-finite container dimensions that overflow the DERIVED aspect ratio to Infinity are rejected as infeasible, never returned as ok:true with a non-finite number (Builder P1 hardening finding 3)', () => {
    // Each of containerWidth/containerHeight is individually finite
    // (`Number.isFinite` is true for both) and passes `validateSolveInputs`'s
    // per-input check — but dividing one by the other overflows past the
    // representable double range to `Infinity`, which used to be embedded
    // straight into an `ok:true` LAYGEO_LEAF_ASPECT_MISMATCH diagnostic
    // (`JSON.stringify(Infinity)` is `"null"`, silently hiding the overflow).
    const doc = singleLeafDoc('root')
    const constraints: LeafConstraintsMap = { root: { minWidth: 0, minHeight: 0, preferredAspectRatio: 1 } }
    let result: SolveResult | undefined
    expect(() => {
      result = solveLayout(doc, constraints, Number.MAX_VALUE, Number.MIN_VALUE)
    }).not.toThrow()
    expect(result!.ok).toBe(false)
    if (result!.ok) return
    expect(result!.diagnostics.some((d) => d.code === 'LAYGEO_NON_FINITE_GEOMETRY')).toBe(true)
    // No diagnostic anywhere in the result carries a non-finite numeric
    // value — every numeric solver result must be finite, full stop.
    for (const d of result!.diagnostics) {
      for (const value of Object.values(d.details ?? {})) {
        if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true)
      }
    }
  })

  it('an extreme preferredAspectRatio against a normal container also never yields a non-finite relative-error diagnostic value (Builder P1 hardening finding 3)', () => {
    const doc = singleLeafDoc('root')
    // A finite but astronomically large preferredAspectRatio: the relative-
    // error division (`|actual - preferred| / preferred`) can itself
    // collapse toward non-finite/degenerate arithmetic at the extremes.
    const constraints: LeafConstraintsMap = {
      root: { minWidth: 0, minHeight: 0, preferredAspectRatio: Number.MAX_VALUE },
    }
    let result: SolveResult | undefined
    expect(() => {
      result = solveLayout(doc, constraints, 800, 600)
    }).not.toThrow()
    expect(result!.ok).toBe(true)
    if (!result!.ok) return
    for (const d of result!.diagnostics) {
      for (const value of Object.values(d.details ?? {})) {
        if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true)
      }
    }
  })

  it('soft-preference diagnostics never leak resource content — content-free (design §3.3 item 10)', () => {
    const doc = singleLeafDoc('root', 'test.face')
    const result = solveLayout(doc, { root: { minWidth: 0, minHeight: 0, maxWidth: 1, maxHeight: 1, preferredAspectRatio: 100 } }, 400, 300)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const d of result.diagnostics) {
      expect(JSON.stringify(d)).not.toMatch(/urn:test/)
    }
  })
})

describe('solveLayout — prototype-colliding leaf ids and own-property constraint lookup (design §9.2 Phase 1 r2)', () => {
  it('a leaf id shaped like an Object.prototype member ("toString") against an EMPTY constraints map is treated as having NO constraints (0x0), not as inherited constraint data', () => {
    const doc = singleLeafDoc('toString', 'test.face')
    // Previously: `leafConstraints['toString']` resolved via the prototype
    // chain to `Object.prototype.toString` (a function) — truthy, so
    // `c.minWidth` read `undefined`, and `Math.max(0, undefined)` is `NaN`,
    // silently marking geometry constrained with no diagnostic explaining
    // why. `Object.hasOwn`-guarded lookup means an EMPTY constraints object
    // now correctly yields the documented default (0-minimum, unconstrained).
    const result = solveLayout(doc, {}, 400, 300)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.root).toEqual({
      kind: 'leaf',
      id: 'toString',
      allocation: { x: 0, y: 0, width: 400, height: 300 },
      constrained: false,
    })
    expect(result.diagnostics).toEqual([])
  })

  it.each(['constructor', 'hasOwnProperty', 'valueOf', '__proto__'])(
    'a leaf id "%s" against an empty constraints map never produces NaN/Infinity allocations or an unexplained constrained flag',
    (protoKey) => {
      const doc = singleLeafDoc(protoKey, 'test.face')
      const result = solveLayout(doc, {}, 400, 300)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      if (result.plan.root.kind !== 'leaf') throw new Error('expected a leaf')
      expect(Number.isFinite(result.plan.root.allocation.width)).toBe(true)
      expect(Number.isFinite(result.plan.root.allocation.height)).toBe(true)
      expect(result.plan.root.constrained).toBe(false)
    },
  )

  it('an own constraint entry for a prototype-colliding leaf id ("toString") is honored correctly — own-property lookup does not ALSO reject legitimate own keys of that name', () => {
    const doc = singleLeafDoc('toString', 'test.face')
    const result = solveLayout(doc, { toString: { minWidth: 500, minHeight: 500 } }, 400, 300)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    if (result.plan.root.kind !== 'leaf') throw new Error('expected a leaf')
    expect(result.plan.root.constrained).toBe(true)
    const codes = result.diagnostics.map((d) => d.code)
    expect(codes).toContain('LAYGEO_LEAF_CONSTRAINED')
  })
})

describe('solveLayout — non-finite container/divider/constraint inputs are rejected with diagnostics, never solved into NaN/Infinity geometry (design §9.2 Phase 1 r2)', () => {
  it.each([
    ['NaN width', Number.NaN, 300],
    ['Infinity width', Number.POSITIVE_INFINITY, 300],
    ['negative width', -100, 300],
    ['NaN height', 400, Number.NaN],
    ['Infinity height', 400, Number.POSITIVE_INFINITY],
    ['negative height', 400, -100],
  ])('rejects a %s container without ever producing a plan', (_label, width, height) => {
    const doc = singleLeafDoc('root')
    const result = solveLayout(doc, {}, width, height)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics.every((d) => d.code === 'LAYGEO_INVALID_CONTAINER')).toBe(true)
  })

  it('rejects a non-finite dividerThickness option', () => {
    const doc = singleLeafDoc('root')
    const result = solveLayout(doc, {}, 400, 300, { dividerThickness: Number.NaN })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.some((d) => d.code === 'LAYGEO_INVALID_CONTAINER')).toBe(true)
  })

  it.each([
    ['NaN minWidth', { minWidth: Number.NaN, minHeight: 0 }],
    ['Infinity minWidth', { minWidth: Number.POSITIVE_INFINITY, minHeight: 0 }],
    ['negative minHeight', { minWidth: 0, minHeight: -5 }],
    ['NaN maxWidth', { minWidth: 0, minHeight: 0, maxWidth: Number.NaN }],
    ['zero preferredAspectRatio', { minWidth: 0, minHeight: 0, preferredAspectRatio: 0 }],
    ['negative preferredAspectRatio', { minWidth: 0, minHeight: 0, preferredAspectRatio: -1 }],
  ])('rejects a leaf constraint entry with %s', (_label, constraint) => {
    const doc = singleLeafDoc('root')
    const result = solveLayout(doc, { root: constraint as LeafConstraintsMap[string] }, 400, 300)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.every((d) => d.code === 'LAYGEO_INVALID_CONSTRAINTS')).toBe(true)
  })

  it('rejects a constraint entry carrying an unrecognized extra field', () => {
    const doc = singleLeafDoc('root')
    const result = solveLayout(doc, { root: { minWidth: 0, minHeight: 0, sneaky: true } as unknown as LeafConstraintsMap[string] }, 400, 300)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.some((d) => d.code === 'LAYGEO_INVALID_CONSTRAINTS')).toBe(true)
  })

  it('a forged non-finite container never throws, even combined with a forged constraints map', () => {
    const doc = singleLeafDoc('root')
    let result: SolveResult | undefined
    expect(() => {
      result = solveLayout(doc, { root: { minWidth: Number.NaN, minHeight: Number.NaN } }, Number.NaN, Number.POSITIVE_INFINITY)
    }).not.toThrow()
    expect(result!.ok).toBe(false)
  })
})

describe('solveLayout — overflow-safe allocation math: a finite-but-astronomical minWidth/minHeight never solves into NaN/Infinity geometry with ok:true (Builder P1 hardening finding 4)', () => {
  /** True iff every number reachable from `value` (recursively) is finite. */
  function everyNumberIsFinite(value: unknown): boolean {
    if (typeof value === 'number') return Number.isFinite(value)
    if (Array.isArray(value)) return value.every(everyNumberIsFinite)
    if (value !== null && typeof value === 'object') {
      return Object.values(value).every(everyNumberIsFinite)
    }
    return true
  }

  it('two sibling leaves each with minWidth = Number.MAX_VALUE overflow the split\'s combined minimum — rejected as infeasible, never NaN', () => {
    const { doc, splitId, leafAId, leafBId } = twoLeafDoc()
    const constraints: LeafConstraintsMap = {
      [leafAId]: { minWidth: Number.MAX_VALUE, minHeight: 0 },
      [leafBId]: { minWidth: Number.MAX_VALUE, minHeight: 0 },
    }
    // Every individual constraint value IS finite (Number.isFinite(Number.MAX_VALUE)
    // === true) and non-negative, so validateSolveInputs's own per-field check
    // passes it through — the overflow only appears once computeMinSizes SUMS
    // the two sides across the split.
    let result: SolveResult | undefined
    expect(() => {
      result = solveLayout(doc, constraints, 800, 600)
    }).not.toThrow()
    expect(result!.ok).toBe(false)
    if (result!.ok) return
    expect(result!.diagnostics.length).toBeGreaterThan(0)
    expect(result!.diagnostics.every((d) => d.code === 'LAYGEO_NON_FINITE_GEOMETRY')).toBe(true)
    void splitId
  })

  it('three levels of nested splits, each combining two Number.MAX_VALUE/2-ish minima, still never yields NaN/Infinity — rejected, not silently solved', () => {
    // leafA/leafB each get a huge-but-not-immediately-overflowing minWidth;
    // nested splits combine them repeatedly, so the overflow shows up a few
    // levels up rather than at the very first split — proving the full-tree
    // scan (not just a root-level check) catches it.
    const big = Number.MAX_VALUE / 3
    const nodes: Record<string, LayoutNode> = {
      top: { kind: 'split', id: 'top', axis: 'horizontal', startNodeId: 'mid1', endNodeId: 'mid2', startBasisPoints: 5000 },
      mid1: { kind: 'split', id: 'mid1', axis: 'horizontal', startNodeId: 'leafA', endNodeId: 'leafB', startBasisPoints: 5000 },
      mid2: { kind: 'split', id: 'mid2', axis: 'horizontal', startNodeId: 'leafC', endNodeId: 'leafD', startBasisPoints: 5000 },
      leafA: { kind: 'leaf', id: 'leafA', descriptor: makeDescriptor('a', 'urn:a'), descriptorRevision: 0 },
      leafB: { kind: 'leaf', id: 'leafB', descriptor: makeDescriptor('b', 'urn:b'), descriptorRevision: 0 },
      leafC: { kind: 'leaf', id: 'leafC', descriptor: makeDescriptor('c', 'urn:c'), descriptorRevision: 0 },
      leafD: { kind: 'leaf', id: 'leafD', descriptor: makeDescriptor('a', 'urn:d'), descriptorRevision: 0 },
    }
    const doc: LayoutDocument = {
      schemaVersion: 1,
      layoutId: 'overflow-nested',
      scope: 'session',
      graphId: null,
      rootNodeId: 'top',
      nodes,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
    const constraints: LeafConstraintsMap = {
      leafA: { minWidth: big, minHeight: 0 },
      leafB: { minWidth: big, minHeight: 0 },
      leafC: { minWidth: big, minHeight: 0 },
      leafD: { minWidth: big, minHeight: 0 },
    }
    let result: SolveResult | undefined
    expect(() => {
      result = solveLayout(doc, constraints, 1000, 800)
    }).not.toThrow()
    expect(result!.ok).toBe(false)
    if (result!.ok) return
    expect(result!.diagnostics.every((d) => d.code === 'LAYGEO_NON_FINITE_GEOMETRY')).toBe(true)
  })

  it('a single leaf with an astronomical minWidth (no summation partner) stays a NORMAL, finite, ok:true "constrained" result — the fix does not over-reject a merely-huge value', () => {
    const doc = singleLeafDoc('root')
    const result = solveLayout(doc, { root: { minWidth: Number.MAX_VALUE, minHeight: 0 } }, 800, 600)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(everyNumberIsFinite(result.plan)).toBe(true)
    expect(result.diagnostics.some((d) => d.code === 'LAYGEO_LEAF_CONSTRAINED')).toBe(true)
  })

  it('every number in the plan and diagnostics is finite for a battery of extreme-but-legal constraint magnitudes (never NaN/Infinity, whichever way it resolves)', () => {
    const magnitudes = [0, 1, 1000, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE / 2, Number.MAX_VALUE]
    for (const minWidth of magnitudes) {
      for (const minHeight of magnitudes) {
        const { doc, leafAId, leafBId } = twoLeafDoc()
        const constraints: LeafConstraintsMap = {
          [leafAId]: { minWidth, minHeight },
          [leafBId]: { minWidth: 0, minHeight: 0 },
        }
        let result: SolveResult | undefined
        expect(() => {
          result = solveLayout(doc, constraints, 800, 600)
        }).not.toThrow()
        if (result!.ok) {
          expect(everyNumberIsFinite(result!.plan)).toBe(true)
        }
        expect(everyNumberIsFinite(result!.diagnostics)).toBe(true)
      }
    }
  })
})
