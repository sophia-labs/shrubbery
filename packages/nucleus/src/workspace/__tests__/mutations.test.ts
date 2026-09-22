/**
 * mutations unit tests — the pure structural verbs.
 *
 * Each verb returns a NEW deep-frozen config; the input is never mutated.
 * The headline (relocateRegion) is cross-checked against BOTH planFor (the
 * projection differs) AND validateConfig (the result is a valid, acyclic spine).
 */

import { describe, it, expect } from 'vitest'
import { resize, toggleBar, relocateRegion } from '../mutations.js'
import { validateConfig } from '../validate.js'
import { planFor, type SplitNode, type WorkspaceSpinePlan } from '../interpreter.js'
import { GARDEN_DEFAULT } from '../garden-default.js'

/** Collect the spine region ids in walk order. */
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

describe('mutations — immutability + freezing', () => {
  it('every verb returns a deep-frozen config', () => {
    const r = resize(GARDEN_DEFAULT, 'region-left-rail', 0.3)
    const t = toggleBar(GARDEN_DEFAULT, 'region-bottom-bar', false)
    const m = relocateRegion(GARDEN_DEFAULT, 'region-right-rail', 'region-left-rail')
    for (const cfg of [r, t, m]) {
      expect(Object.isFrozen(cfg)).toBe(true)
      expect(Object.isFrozen(cfg.regions)).toBe(true)
      for (const id of Object.keys(cfg.regions)) {
        expect(Object.isFrozen(cfg.regions[id])).toBe(true)
      }
    }
  })

  it('does NOT mutate the input config', () => {
    const before = JSON.stringify(GARDEN_DEFAULT)
    resize(GARDEN_DEFAULT, 'region-left-rail', 0.99)
    toggleBar(GARDEN_DEFAULT, 'region-bottom-bar', false)
    relocateRegion(GARDEN_DEFAULT, 'region-right-rail', 'region-left-rail')
    expect(JSON.stringify(GARDEN_DEFAULT)).toBe(before)
  })
})

describe('mutations — resize', () => {
  it('sets the sizeFraction of the target region', () => {
    const next = resize(GARDEN_DEFAULT, 'region-left-rail', 0.3)
    expect(next.regions['region-left-rail'].sizeFraction).toBe(0.3)
    // Other regions unchanged.
    expect(next.regions['region-center'].sizeFraction).toBe(
      GARDEN_DEFAULT.regions['region-center'].sizeFraction,
    )
  })

  it('changes the planFor outer split position', () => {
    // left-rail 0.2 / 1.0 = 20  →  0.3 / (0.3+0.6+0.2 ... renormalized) differs
    const before = (planFor(GARDEN_DEFAULT).spine as SplitNode).position
    const next = resize(GARDEN_DEFAULT, 'region-left-rail', 0.4)
    const after = (planFor(next).spine as SplitNode).position
    expect(after).not.toBeCloseTo(before, 1)
  })

  it('a valid resize keeps validateConfig green', () => {
    const next = resize(GARDEN_DEFAULT, 'region-center', 0.5)
    expect(validateConfig(next)).toEqual({ ok: true })
  })

  it('a 0 resize is rejected by validateConfig (I6) — resize does not clamp', () => {
    const next = resize(GARDEN_DEFAULT, 'region-center', 0)
    const v = validateConfig(next)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.error).toMatch(/I6/)
  })
})

describe('mutations — toggleBar', () => {
  it('removes a chrome bar from rootRegions and the region map', () => {
    const next = toggleBar(GARDEN_DEFAULT, 'region-bottom-bar', false)
    expect(next.regions['region-bottom-bar']).toBeUndefined()
    expect(next.rootRegions).not.toContain('region-bottom-bar')
    // Spine roots survive.
    expect(next.rootRegions).toContain('region-top-bar')
    expect(next.rootRegions).toContain('region-left-rail')
  })

  it('dropping the bottom bar keeps a valid config + empties bottomChrome', () => {
    const next = toggleBar(GARDEN_DEFAULT, 'region-bottom-bar', false)
    expect(validateConfig(next)).toEqual({ ok: true })
    expect(planFor(next).bottomChrome).toEqual([])
    // Top chrome unaffected.
    expect(planFor(next).topChrome).toEqual(['region-top-bar'])
  })

  it('re-deriving rootRegions keeps order asc, then id asc', () => {
    const next = toggleBar(GARDEN_DEFAULT, 'region-bottom-bar', false)
    // top-bar order=0, left-rail order=1.
    expect(next.rootRegions).toEqual(['region-top-bar', 'region-left-rail'])
  })

  it('present=true on an existing bar is a no-op-shaped valid config', () => {
    const next = toggleBar(GARDEN_DEFAULT, 'region-bottom-bar', true)
    expect(next.regions['region-bottom-bar']).toBeDefined()
    expect(next.rootRegions).toContain('region-bottom-bar')
    expect(validateConfig(next)).toEqual({ ok: true })
  })
})

describe('mutations — relocateRegion (THE headline)', () => {
  it('produces a VALID, ACYCLIC, DIFFERENT spine that planFor projects differently', () => {
    // Default spine: left-rail → center → right-rail.
    // Relocate right-rail to be left-rail's direct child:
    //   left-rail → right-rail → center
    const next = relocateRegion(GARDEN_DEFAULT, 'region-right-rail', 'region-left-rail')

    // VALID — passes the commit gate.
    expect(validateConfig(next)).toEqual({ ok: true })

    // DIFFERENT — the spine order changed.
    const beforeIds = spineRegionIds(planFor(GARDEN_DEFAULT))
    const afterIds = spineRegionIds(planFor(next))
    expect(beforeIds).toEqual(['region-left-rail', 'region-center', 'region-right-rail'])
    expect(afterIds).toEqual(['region-left-rail', 'region-right-rail', 'region-center'])
    expect(afterIds).not.toEqual(beforeIds)

    // ACYCLIC — planFor returns and the projection differs.
    expect(planFor(next)).not.toEqual(planFor(GARDEN_DEFAULT))
  })

  it('splices the relocated region out of its old parent chain (chain stays connected)', () => {
    // Relocate center under right-rail:
    //   default: left-rail → center → right-rail
    //   after:   left-rail → right-rail → center (right-rail adopts center)
    const next = relocateRegion(GARDEN_DEFAULT, 'region-center', 'region-right-rail')
    expect(validateConfig(next)).toEqual({ ok: true })
    // left-rail's child was center; after splice it points at center's former
    // child (right-rail).
    expect(next.regions['region-left-rail'].childRegion).toBe('region-right-rail')
    expect(next.regions['region-right-rail'].childRegion).toBe('region-center')
    expect(next.regions['region-center'].childRegion).toBeNull()
    expect(spineRegionIds(planFor(next))).toEqual([
      'region-left-rail',
      'region-right-rail',
      'region-center',
    ])
  })

  it('re-derives rootRegions (relocated region never becomes a stray root)', () => {
    const next = relocateRegion(GARDEN_DEFAULT, 'region-right-rail', 'region-left-rail')
    // right-rail is still a child (of left-rail now), so not a root.
    expect(next.rootRegions).not.toContain('region-right-rail')
    expect(next.rootRegions).not.toContain('region-center')
    // The same three roots remain (chrome + spine head).
    expect([...next.rootRegions].sort()).toEqual(
      ['region-bottom-bar', 'region-left-rail', 'region-top-bar'].sort(),
    )
  })

  it('no-op guard: relocating to self returns a valid unchanged-shape config', () => {
    const next = relocateRegion(GARDEN_DEFAULT, 'region-center', 'region-center')
    expect(validateConfig(next)).toEqual({ ok: true })
    expect(spineRegionIds(planFor(next))).toEqual(spineRegionIds(planFor(GARDEN_DEFAULT)))
  })

  it('no-op guard: relocating to existing child (2-cycle) is avoided', () => {
    // left-rail's child is already center; relocating center under left-rail is a no-op.
    const next = relocateRegion(GARDEN_DEFAULT, 'region-center', 'region-left-rail')
    expect(validateConfig(next)).toEqual({ ok: true })
    expect(spineRegionIds(planFor(next))).toEqual(spineRegionIds(planFor(GARDEN_DEFAULT)))
  })

  it('no-op guard: absent regionId returns a valid config', () => {
    const next = relocateRegion(GARDEN_DEFAULT, 'region-ghost', 'region-left-rail')
    expect(validateConfig(next)).toEqual({ ok: true })
    expect(spineRegionIds(planFor(next))).toEqual(spineRegionIds(planFor(GARDEN_DEFAULT)))
  })
})
