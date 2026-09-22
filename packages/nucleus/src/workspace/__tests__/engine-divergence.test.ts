/**
 * Engine divergence test — THE ACCEPTANCE GATE for increment 2.
 *
 * Tests two clauses (both required):
 *
 * 1. FIDELITY — planFor(GARDEN_DEFAULT) equals the today-literal structure:
 *    outer position = 20, inner position = 75, spine = left→center→right,
 *    chrome = [region-top-bar (top), region-bottom-bar (bottom)].
 *    A hardcoded-facade renderer that ignores config would pass this alone —
 *    that's why GENERALITY is required.
 *
 * 2. GENERALITY — planFor(GARDEN_VARIANT) differs from planFor(GARDEN_DEFAULT)
 *    on every axis the variant was designed to diverge on:
 *    - outer position: 35 not 20 (wider left rail)
 *    - inner start: region-right-rail not region-center (swapped spine)
 *    - inner position: ≈30.77 not 75 (different renormalization)
 *    - bottom chrome: empty (bottom-bar dropped)
 *    - right-rail docksPanel[0]: panel-inspector not panel-chat (swapped order)
 *
 *    A facade that hardcodes GardenDefault's structure fails every one of these.
 *    The headline: planFor(DEFAULT) ≠ planFor(VARIANT).
 *
 * This is a pure unit test — no DOM, no Lit, no stores, no custom elements.
 * The plan function is a total pure function; the test is fully deterministic.
 */

import { describe, it, expect } from 'vitest'
import { planFor, type SplitNode, type WorkspaceSpinePlan } from '../interpreter.js'
import { GARDEN_DEFAULT } from '../garden-default.js'
import { GARDEN_VARIANT } from '../garden-variant.js'

// ── helpers ──────────────────────────────────────────────────────────────────

/** Assert the plan walks to completion with no cycles (every regionId visited at most once). */
function assertAcyclic(plan: WorkspaceSpinePlan) {
  const seen = new Set<string>()
  function walk(node: WorkspaceSpinePlan['spine']) {
    expect(seen.has(node.regionId)).toBe(false)
    seen.add(node.regionId)
    if (node.kind === 'split') walk(node.child)
  }
  walk(plan.spine)
}

/** Collect all regionIds in a spine walk (in visit order). */
function spineRegionIds(plan: WorkspaceSpinePlan): string[] {
  const ids: string[] = []
  let node: WorkspaceSpinePlan['spine'] = plan.spine
  while (true) {
    ids.push(node.regionId)
    if (node.kind === 'leaf') break
    node = (node as SplitNode).child
  }
  return ids
}

// ── FIDELITY tests ────────────────────────────────────────────────────────────

describe('planFor — FIDELITY (GARDEN_DEFAULT matches today-literal structure)', () => {
  const plan = planFor(GARDEN_DEFAULT)

  it('spine head is region-left-rail', () => {
    expect(plan.spineHeadId).toBe('region-left-rail')
    expect(plan.spine.regionId).toBe('region-left-rail')
  })

  it('outer split position is 20 (left-rail 0.2 / total 1.0)', () => {
    expect(plan.spine.kind).toBe('split')
    expect((plan.spine as SplitNode).position).toBeCloseTo(20, 1)
  })

  it('inner split (center) start is region-center', () => {
    const outerSplit = plan.spine as SplitNode
    expect(outerSplit.child.kind).toBe('split')
    expect(outerSplit.child.regionId).toBe('region-center')
  })

  it('inner split position is 75 (center 0.6 / (center 0.6 + right 0.2))', () => {
    const innerSplit = (plan.spine as SplitNode).child as SplitNode
    expect(innerSplit.position).toBeCloseTo(75, 1)
  })

  it('inner split end leaf is region-right-rail', () => {
    const innerSplit = (plan.spine as SplitNode).child as SplitNode
    expect(innerSplit.child.kind).toBe('leaf')
    expect(innerSplit.child.regionId).toBe('region-right-rail')
  })

  it('spine visits regions in order: left-rail → center → right-rail', () => {
    expect(spineRegionIds(plan)).toEqual(['region-left-rail', 'region-center', 'region-right-rail'])
  })

  it('top chrome is [region-top-bar]', () => {
    expect(plan.topChrome).toEqual(['region-top-bar'])
  })

  it('bottom chrome is [region-bottom-bar]', () => {
    expect(plan.bottomChrome).toEqual(['region-bottom-bar'])
  })

  it('walk terminates and visits each region at most once (acyclic)', () => {
    assertAcyclic(plan)
  })

  it('right-rail docksPanel[0] is panel-chat (id-sorted default order)', () => {
    expect(GARDEN_DEFAULT.regions['region-right-rail'].docksPanel[0]).toBe('panel-chat')
  })
})

// ── GENERALITY tests ──────────────────────────────────────────────────────────

describe('planFor — GENERALITY (GARDEN_VARIANT differs from GARDEN_DEFAULT on all three axes)', () => {
  const defaultPlan = planFor(GARDEN_DEFAULT)
  const variantPlan = planFor(GARDEN_VARIANT)

  it('headline: planFor(VARIANT) does not equal planFor(DEFAULT)', () => {
    expect(variantPlan).not.toEqual(defaultPlan)
  })

  describe('axis 1 — split-tree: reordered spine + widened left rail', () => {
    it('variant outer position is 35 (left-rail 0.35 / total 1.0)', () => {
      expect(variantPlan.spine.kind).toBe('split')
      expect((variantPlan.spine as SplitNode).position).toBeCloseTo(35, 1)
    })

    it('variant outer position differs from default (35 ≠ 20)', () => {
      const defPos = (defaultPlan.spine as SplitNode).position
      const varPos = (variantPlan.spine as SplitNode).position
      expect(varPos).not.toBeCloseTo(defPos, 1)
    })

    it('variant inner start slot is region-right-rail (swapped — default is region-center)', () => {
      const outerSplit = variantPlan.spine as SplitNode
      expect(outerSplit.child.regionId).toBe('region-right-rail')
    })

    it('variant inner position is ≈30.77 (right 0.20 / (right 0.20 + center 0.45))', () => {
      const innerSplit = (variantPlan.spine as SplitNode).child as SplitNode
      // 0.20 / (0.20 + 0.45) * 100 = 0.20 / 0.65 * 100 ≈ 30.769...
      expect(innerSplit.position).toBeCloseTo(30.77, 1)
    })

    it('variant inner position differs from default (≈30.77 ≠ 75)', () => {
      const defInner = ((defaultPlan.spine as SplitNode).child as SplitNode).position
      const varInner = ((variantPlan.spine as SplitNode).child as SplitNode).position
      expect(varInner).not.toBeCloseTo(defInner, 1)
    })

    it('variant inner end leaf is region-center (default is region-right-rail)', () => {
      const innerSplit = (variantPlan.spine as SplitNode).child as SplitNode
      expect(innerSplit.child.kind).toBe('leaf')
      expect(innerSplit.child.regionId).toBe('region-center')
    })

    it('variant spine visits regions in order: left-rail → right-rail → center', () => {
      expect(spineRegionIds(variantPlan)).toEqual(['region-left-rail', 'region-right-rail', 'region-center'])
    })

    it('variant spine order differs from default', () => {
      expect(spineRegionIds(variantPlan)).not.toEqual(spineRegionIds(defaultPlan))
    })
  })

  describe('axis 2 — chrome divergence: bottom bar dropped', () => {
    it('variant top chrome is still [region-top-bar]', () => {
      expect(variantPlan.topChrome).toEqual(['region-top-bar'])
    })

    it('variant bottom chrome is empty (no bottom bar)', () => {
      expect(variantPlan.bottomChrome).toEqual([])
    })

    it('variant bottom chrome differs from default ([] ≠ [region-bottom-bar])', () => {
      expect(variantPlan.bottomChrome).not.toEqual(defaultPlan.bottomChrome)
    })
  })

  describe('axis 3 — docked-panel order: inspector before chat', () => {
    it('variant right-rail docksPanel[0] is panel-inspector (not panel-chat)', () => {
      expect(GARDEN_VARIANT.regions['region-right-rail'].docksPanel[0]).toBe('panel-inspector')
    })

    it('variant docksPanel[0] differs from default', () => {
      const defFirst = GARDEN_DEFAULT.regions['region-right-rail'].docksPanel[0]
      const varFirst = GARDEN_VARIANT.regions['region-right-rail'].docksPanel[0]
      expect(varFirst).not.toBe(defFirst)
    })
  })

  it('variant walk terminates and visits each region at most once (acyclic)', () => {
    assertAcyclic(variantPlan)
  })
})
