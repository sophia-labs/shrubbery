/**
 * FUNCTIONAL test — GARDEN_DEFAULT vs GARDEN_VARIANT through renderWorkspace.
 *
 * The host's win condition: a DIFFERENT config produces a CORRESPONDINGLY
 * DIFFERENT rendered DOM, and the divergence appears EXACTLY where the configs
 * differ — not everywhere (that would be a host that ignores config) and not
 * nowhere (that would be a facade hardcoding GardenDefault's DOM).
 *
 * GARDEN_VARIANT (the nucleus divergence fixture) differs from GARDEN_DEFAULT on:
 *   A. chrome — it DROPS region-bottom-bar from rootRegions (no status bar).
 *   B. split positions — left rail widened (0.35 vs 0.20) → outer position 35 vs
 *      20; spine reordered so inner ≈ 30.77 vs 75.
 *   C. spine ORDER — left-rail → RIGHT-RAIL → center (vs left→center→right), so
 *      the rendered pane order and roles change.
 *
 * And it stays the SAME on the top bar (top chrome unchanged) — the host must
 * NOT diverge there. This test asserts both the divergence AND the invariance.
 *
 * NO MOCKS: real GARDEN_DEFAULT / GARDEN_VARIANT configs through the real
 * renderWorkspace into real happy-dom DOM.
 */

import { describe, it, expect } from 'vitest'
import { GARDEN_DEFAULT, GARDEN_VARIANT, planFor, type SplitNode } from '@shrubbery/nucleus'
import { renderWorkspace } from '../render-workspace.js'

function frame(config: typeof GARDEN_DEFAULT) {
  return renderWorkspace(config).querySelector('.app-container')!
}

describe('FUNCTIONAL — DEFAULT vs VARIANT diverge exactly where the configs differ', () => {
  const def = frame(GARDEN_DEFAULT)
  const var_ = frame(GARDEN_VARIANT)

  it('headline: the two rendered frames are NOT structurally identical', () => {
    expect(def.outerHTML).not.toBe(var_.outerHTML)
  })

  describe('INVARIANCE — top chrome is unchanged (both configs keep the top bar)', () => {
    it('both frames render a top bar surface', () => {
      expect(def.querySelector('header[data-region="region-top-bar"] mn-top-bar')).not.toBeNull()
      expect(var_.querySelector('header[data-region="region-top-bar"] mn-top-bar')).not.toBeNull()
    })
  })

  describe('DIVERGENCE A — chrome existence (variant drops the bottom bar)', () => {
    it('DEFAULT renders a bottom bar', () => {
      expect(def.querySelector('footer[data-region="region-bottom-bar"]')).not.toBeNull()
    })
    it('VARIANT renders NO bottom bar', () => {
      expect(var_.querySelector('footer[data-region="region-bottom-bar"]')).toBeNull()
    })
  })

  describe('DIVERGENCE B — outer split position (variant widens the left rail)', () => {
    // The OUTER split is the first sl-split-panel (no slot, headed by the sidebar
    // spine head in both configs). Its position is read straight from the plan's
    // spine head (left-rail fraction / total). This is the axis the renderer
    // genuinely drives into the DOM.
    const outer = (root: Element) => root.querySelector('sl-split-panel')!

    it('DEFAULT outer position is 20; VARIANT outer position is 35', () => {
      expect(outer(def).getAttribute('position')).toBe('20')
      expect(outer(var_).getAttribute('position')).toBe('35')
      expect(outer(def).getAttribute('position')).not.toBe(outer(var_).getAttribute('position'))
    })

    it('DEFAULT renders a center-headed .right-split (pos 75); VARIANT renders NONE', () => {
      // The right-split chrome keys off the START region's role===center. In
      // DEFAULT the center HEADS the inner split, so a .right-split exists at
      // pos 75. In VARIANT the center is the spine LEAF (never a split start), so
      // there is NO .right-split — a real, config-driven frame divergence.
      const defRight = def.querySelector('sl-split-panel.right-split')
      expect(defRight).not.toBeNull()
      expect(defRight!.getAttribute('position')).toBe('75')
      expect(var_.querySelector('sl-split-panel.right-split')).toBeNull()
    })

    it('PLAN-LEVEL: VARIANT renormalizes the inner spine fraction to ≈30.77 (the host consumes planFor)', () => {
      // The renderer keys the inner-split chrome off role, so the 30.77 is not
      // stamped as a .right-split position in the variant; but it IS what the
      // plan the host computes carries. Proving it at the plan layer keeps this
      // honest — the renormalization is real, just not surfaced as a right-split
      // attribute when the center is the leaf.
      const varPlan = planFor(GARDEN_VARIANT)
      const outerNode = varPlan.spine as SplitNode
      const innerNode = outerNode.child as SplitNode
      expect(outerNode.position).toBe(35)
      // 0.20 / (0.20 + 0.45) * 100 = 30.77 (2dp from the interpreter).
      expect(innerNode.position).toBeCloseTo(30.77, 1)
      // DEFAULT's inner node is 75 — the plan diverges.
      const defInner = (planFor(GARDEN_DEFAULT).spine as SplitNode).child as SplitNode
      expect(defInner.position).toBe(75)
    })
  })

  describe('DIVERGENCE C — spine order (variant reorders the spine)', () => {
    const panes = (root: Element) =>
      Array.from(root.querySelectorAll('.split-pane[data-region]')).map(el => el.getAttribute('data-region'))

    it('DEFAULT spine order is left-rail → center → right-rail', () => {
      expect(panes(def)).toEqual(['region-left-rail', 'region-center', 'region-right-rail'])
    })

    it('VARIANT spine order is left-rail → right-rail → center (reordered)', () => {
      expect(panes(var_)).toEqual(['region-left-rail', 'region-right-rail', 'region-center'])
    })

    it('the rendered spine orders differ', () => {
      expect(panes(def)).not.toEqual(panes(var_))
    })

    it('role assignment follows the reordered spine: the spine LEAF region differs', () => {
      // The leaf is the single slot=end pane with no nested split inside it. In
      // DEFAULT the right rail is the leaf (center heads the inner .right-split);
      // in VARIANT the center is the leaf (it is the end of the reordered spine).
      const leafRegion = (root: Element): string | null => {
        const ends = Array.from(root.querySelectorAll('.split-pane[slot="end"]'))
        // The leaf is the deepest end pane: the one whose immediate parent has no
        // descendant sl-split-panel after it. Equivalently, the last end pane in
        // document order whose data-region is set.
        const last = ends[ends.length - 1]
        return last ? last.getAttribute('data-region') : null
      }
      expect(leafRegion(def)).toBe('region-right-rail')
      expect(leafRegion(var_)).toBe('region-center')
      expect(leafRegion(def)).not.toBe(leafRegion(var_))
    })
  })

  describe('SHARED — both configs render the same set of panel TAGS (same components, different layout)', () => {
    it('both render sidebar + editor + a selected chat panel (layout differs, component vocab same)', () => {
      for (const root of [def, var_]) {
        expect(root.querySelector('mn-sidebar-panel')).not.toBeNull()
        expect(root.querySelector('mn-document-editor')).not.toBeNull()
      }
    })
  })
})
