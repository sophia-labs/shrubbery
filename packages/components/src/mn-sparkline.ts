/**
 * mn-sparkline — a GENERAL, skin-aware, token-driven inline sparkline.
 *
 * LIFTED from garden's PURE presentation primitive
 *   emporium-port/frontend/src/components/wf/wf-primitives.ts → `wf-sparkline`
 * (READ-ONLY source). What was GENERALIZED in the lift:
 *
 *   - The source already hardcoded the stroke to --mn-color-primary-500 /
 *     primary-600 (garden's accent ramp). Those are NOT skin role tokens — under
 *     Emporium they would NOT recolor. So the stroke is rebound to the SKIN role
 *     token --mn-color-accent (with a `tone` prop to pick success/warning/danger),
 *     so the sparkline recolors per skin for FREE (fern in Garden, purple in
 *     Emporium) with NO hardcoded color.
 *   - Otherwise the pure math is kept verbatim: a polyline normalized into the
 *     [min,max] band with a dot on the last point; < 2 finite points renders
 *     nothing (no faked baseline). It carries no wf: vocabulary at all — it is a
 *     general number-series glyph.
 *
 * SKIN-AWARE via the SkinAware mixin so a future structural skin rule has the
 * host attribute hook; the recolor itself is purely token-driven.
 *
 * Dependencies: lit ONLY. No stores, no backend (island-guarded).
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'

/** The tone the sparkline stroke takes (routes to a skin role token). */
export type MnSparklineTone = 'accent' | 'success' | 'warning' | 'danger' | 'muted'

const TONE_VAR: Record<MnSparklineTone, string> = {
  accent: 'var(--mn-color-accent, #4a8b6f)',
  success: 'var(--mn-color-success, #469c70)',
  warning: 'var(--mn-color-warning, #d97706)',
  danger: 'var(--mn-color-danger, #be123c)',
  muted: 'var(--mn-color-text-muted, #9ca3af)',
}

@customElement('mn-sparkline')
export class MnSparkline extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
    }
    svg {
      display: block;
    }
  `

  /** The number series to plot. */
  @property({ attribute: false }) values: number[] = []
  /** SVG width in px. */
  @property({ type: Number }) width = 72
  /** SVG height in px. */
  @property({ type: Number }) height = 18
  /** Accessible label / hover hint. */
  @property({ type: String }) hint = ''
  /** Stroke tone (routes to a skin role token). */
  @property({ type: String }) tone: MnSparklineTone = 'accent'

  render() {
    const vals = this.values.filter((v) => Number.isFinite(v))
    if (vals.length < 2) return nothing
    const w = this.width
    const h = this.height
    const max = Math.max(...vals)
    const min = Math.min(...vals)
    const span = max - min || 1
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * (w - 2) + 1
      const y = h - 2 - ((v - min) / span) * (h - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    const last = pts[pts.length - 1].split(',')
    const stroke = TONE_VAR[this.tone]
    // The SVG children are rendered DIRECTLY in the html template (not via Lit's
    // `svg` fragment tag). garden's wf-sparkline used the `svg` tag for strict
    // SVG-namespacing, but happy-dom (this package's test engine) silently DROPS
    // a nested Lit `svg` fragment — verified. Authoring the polyline/circle in
    // the html template renders + is queryable in BOTH happy-dom and real
    // browsers (the parent <svg> carries the visual namespace), so the real-DOM
    // tests can assert the plot. No content is faked; the geometry is identical.
    return html`<svg
      width=${w}
      height=${h}
      viewBox="0 0 ${w} ${h}"
      role="img"
      part="svg"
      aria-label=${this.hint || 'number-series sparkline'}
    >
      <title>${this.hint}</title>
      <polyline
        points=${pts.join(' ')}
        fill="none"
        stroke=${stroke}
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      ></polyline>
      <circle cx=${last[0]} cy=${last[1]} r="2" fill=${stroke}></circle>
    </svg>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-sparkline': MnSparkline
  }
}
