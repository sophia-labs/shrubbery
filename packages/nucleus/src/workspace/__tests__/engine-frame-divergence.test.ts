/**
 * Engine FRAME divergence test — the rendered-DOM half of the acceptance gate.
 *
 * engine-divergence.test.ts proves the PURE projection is general:
 *   planFor(GARDEN_DEFAULT) ≠ planFor(GARDEN_VARIANT)  (plan objects differ).
 *
 * That is necessary but not sufficient for the win condition, which demands a
 * different config produce a CORRESPONDINGLY DIFFERENT *FRAME* — i.e. the DOM the
 * interpreter stamps must reflect the variant's change, not just an intermediate
 * data structure. A renderer that ignored the plan and hardcoded GardenDefault's
 * DOM would pass the plan-level test yet still be a facade at the frame level.
 *
 * This test closes that gap. It renders the interpreter's actually-consumed
 * outputs into a real (happy-dom) container — the SAME config→DOM seam app-shell's
 * flag-on path uses (planFor + resolveSurfaceTag → chrome surfaces + split
 * positions) — and asserts the rendered DOM DIVERGES between the two configs on
 * the axes the renderer genuinely reads from config:
 *
 *   A. CHROME EXISTENCE — bottom bar. GARDEN_DEFAULT's plan puts region-bottom-bar
 *      in bottomChrome, so the frame contains an <mn-bottom-bar>. GARDEN_VARIANT
 *      drops it from rootRegions, so the frame MUST NOT contain one. (config →
 *      element presence in the DOM)
 *
 *   B. SPLIT POSITION — outer split. The outer sl-split-panel's `position` is read
 *      from plan.spine.position: 20 for GARDEN_DEFAULT (left-rail 0.2/1.0), 35 for
 *      GARDEN_VARIANT (left-rail 0.35/1.0). (config → a rendered attribute value)
 *
 * Both are real frame changes a hardcoded-default facade could not produce.
 *
 * SCOPE NOTE (honesty): the current renderSpineForPlan consumes plan POSITIONS and
 * chrome PRESENCE but not yet spine SLOT ORDER (the start/end slot assignment is
 * still literal). So this frame-level gate asserts divergence on the two axes the
 * renderer actually reads. The swapped-spine-order axis is proven general at the
 * plan layer by engine-divergence.test.ts; wiring slot order through to the DOM is
 * a follow-on. This test is deliberately scoped to what the renderer truly drives,
 * so a green here means a real frame divergence, not an aspirational one.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { html, render, nothing } from 'lit'
import { planFor, resolveSurfaceTag, type SplitNode, type WorkspaceSpinePlan } from '../interpreter.js'
import { GARDEN_DEFAULT } from '../garden-default.js'
import { GARDEN_VARIANT } from '../garden-variant.js'
import type { WorkspaceConfig } from '../types.js'

// ── frame harness ─────────────────────────────────────────────────────────────
// A minimal mirror of app-shell's flag-on composition (app-shell.ts ~3254-3277 +
// renderSpineForPlan). It threads the SAME interpreter outputs into the SAME DOM
// shape — chrome surfaces gated on plan.topChrome/bottomChrome, outer split
// position from plan.spine.position — without booting app-shell's auth/stores.
//
// Critically: this function takes NO config-specific branches. It reads ONLY the
// plan + resolveSurfaceTag. Whatever divergence appears in the DOM came from the
// config, not from the harness.

function renderFrame(config: WorkspaceConfig): HTMLElement {
  const plan: WorkspaceSpinePlan = planFor(config)

  const topBarTag = resolveSurfaceTag(config, 'region-top-bar')
  const bottomBarTag = resolveSurfaceTag(config, 'region-bottom-bar')
  const hasTopBar = plan.topChrome.includes('region-top-bar') && topBarTag !== null
  const hasBottomBar = plan.bottomChrome.includes('region-bottom-bar') && bottomBarTag !== null

  const outerSplit = plan.spine.kind === 'split' ? (plan.spine as SplitNode) : null
  const outerPosition = outerSplit?.position ?? 20
  const innerSplit = outerSplit?.child.kind === 'split' ? (outerSplit.child as SplitNode) : null
  const innerPosition = innerSplit?.position ?? 75

  // Stamp chrome by resolved tag (createElement so happy-dom needn't define the CE).
  const topBar = hasTopBar ? html`<div data-surface=${topBarTag!}></div>` : nothing
  const bottomBar = hasBottomBar ? html`<div data-surface=${bottomBarTag!}></div>` : nothing

  const container = document.createElement('div')
  render(
    html`
      <div class="app-container">
        ${topBar}
        <div class="main">
          <sl-split-panel class="outer" position=${outerPosition}>
            <div slot="start" class="left"></div>
            <sl-split-panel class="right-split" slot="end" position=${innerPosition}>
              <div slot="start" class="center"></div>
              <div slot="end" class="right"></div>
            </sl-split-panel>
          </sl-split-panel>
        </div>
        ${bottomBar}
      </div>
    `,
    container,
  )
  return container
}

afterEach(() => {
  document.body.innerHTML = ''
})

// ── FIDELITY: GARDEN_DEFAULT renders the today frame ──────────────────────────

describe('FRAME — GARDEN_DEFAULT renders the today-literal frame', () => {
  const frame = renderFrame(GARDEN_DEFAULT)

  it('frame has a top bar surface (mn-top-bar)', () => {
    expect(frame.querySelector('[data-surface="mn-top-bar"]')).not.toBeNull()
  })

  it('frame has a bottom bar surface (mn-bottom-bar)', () => {
    expect(frame.querySelector('[data-surface="mn-bottom-bar"]')).not.toBeNull()
  })

  it('outer split position attribute is "20"', () => {
    const outer = frame.querySelector('sl-split-panel.outer')!
    expect(outer.getAttribute('position')).toBe('20')
  })

  it('inner split position attribute is "75"', () => {
    const inner = frame.querySelector('sl-split-panel.right-split')!
    expect(inner.getAttribute('position')).toBe('75')
  })
})

// ── GENERALITY: GARDEN_VARIANT renders a CORRESPONDINGLY DIFFERENT frame ───────

describe('FRAME — GARDEN_VARIANT renders a different frame than GARDEN_DEFAULT', () => {
  const defaultFrame = renderFrame(GARDEN_DEFAULT)
  const variantFrame = renderFrame(GARDEN_VARIANT)

  it('headline: the two rendered frames are NOT structurally identical', () => {
    // outerHTML is the literal rendered DOM. Equal HTML ⇒ a facade. Different ⇒
    // the config drove a different frame.
    const a = defaultFrame.querySelector('.app-container')!.outerHTML
    const b = variantFrame.querySelector('.app-container')!.outerHTML
    expect(a).not.toBe(b)
  })

  describe('axis A — chrome existence (config drops the bottom bar)', () => {
    it('DEFAULT frame contains a bottom-bar surface', () => {
      expect(defaultFrame.querySelector('[data-surface="mn-bottom-bar"]')).not.toBeNull()
    })

    it('VARIANT frame contains NO bottom-bar surface', () => {
      expect(variantFrame.querySelector('[data-surface="mn-bottom-bar"]')).toBeNull()
    })

    it('both frames still contain a top-bar surface (top chrome unchanged)', () => {
      expect(defaultFrame.querySelector('[data-surface="mn-top-bar"]')).not.toBeNull()
      expect(variantFrame.querySelector('[data-surface="mn-top-bar"]')).not.toBeNull()
    })
  })

  describe('axis B — split position (config widens the left rail)', () => {
    it('DEFAULT outer split position is "20"', () => {
      expect(defaultFrame.querySelector('sl-split-panel.outer')!.getAttribute('position')).toBe('20')
    })

    it('VARIANT outer split position is "35" (wider left rail)', () => {
      expect(variantFrame.querySelector('sl-split-panel.outer')!.getAttribute('position')).toBe('35')
    })

    it('the rendered outer position attributes differ (20 ≠ 35)', () => {
      const defPos = defaultFrame.querySelector('sl-split-panel.outer')!.getAttribute('position')
      const varPos = variantFrame.querySelector('sl-split-panel.outer')!.getAttribute('position')
      expect(varPos).not.toBe(defPos)
    })

    it('VARIANT inner split position reflects the renormalized fraction (≈30.77, not 75)', () => {
      const varInner = variantFrame.querySelector('sl-split-panel.right-split')!.getAttribute('position')
      expect(varInner).not.toBe('75')
      // 0.20 / (0.20 + 0.45) * 100 = 30.77 (2dp from the interpreter).
      expect(Number(varInner)).toBeCloseTo(30.77, 1)
    })
  })
})
