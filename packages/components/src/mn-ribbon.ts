/**
 * mn-ribbon — a GENERAL, skin-aware, token-driven segmented ribbon (a progress /
 * phase / step strip).
 *
 * LIFTED from garden's PURE presentation primitive
 *   emporium-port/frontend/src/components/wf/wf-primitives.ts → `wf-phase-ribbon`
 * (READ-ONLY source). What was GENERALIZED in the lift:
 *
 *   - DROPPED the workflow `WfPhase` type dependency. The source typed its input
 *     as `WfPhase[]` (order/title/description from garden's wf-model) and emitted
 *     `wf-phase-select`. The ribbon here takes a general `MnRibbonSegment[]`
 *     ({ label, title?, value? }) and emits `mn-ribbon-select` — no wf: coupling.
 *   - REBOUND the segment tints from garden's --mn-color-primary-* ramp (NOT a
 *     skin role token) to the SKIN accent ramp role tokens
 *     (--mn-color-accent / surface-accent / border-accent / accent-strong) so the
 *     ramp recolors per skin for FREE — no hardcoded color.
 *   - KEPT the pure shape: a flex row of tinted segments interpolated across the
 *     accent ramp, an `active` highlight, optional labels under each segment,
 *     hover lift. Geometry routes through the skin role tokens (square + tighter
 *     under Emporium).
 *
 * SKIN-AWARE via the SkinAware mixin (square segments under Emporium).
 *
 * Dependencies: lit ONLY. No stores, no wf-model, no backend (island-guarded).
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'

/** One segment of the ribbon. `value` is what `mn-ribbon-select` reports. */
export interface MnRibbonSegment {
  /** Short caption shown under the segment when `showLabels`. */
  readonly label: string
  /** Hover title (a longer description). */
  readonly title?: string
  /** Opaque value reported on select (defaults to the 1-based index). */
  readonly value?: string | number
}

@customElement('mn-ribbon')
export class MnRibbon extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: block;
    }
    .ribbon {
      display: flex;
      gap: 2px;
      height: 8px;
    }
    .segment {
      flex: 1;
      border-radius: 2px;
      border: none;
      padding: 0;
      cursor: pointer;
      transition: filter 0.15s ease, transform 0.15s ease;
    }
    .segment:hover {
      filter: brightness(0.92);
      transform: scaleY(1.25);
    }
    .segment:focus-visible {
      outline: 1px solid var(--mn-color-border-focus, var(--mn-color-accent));
      outline-offset: 2px;
    }
    .segment.active {
      outline: 1px solid var(--mn-color-accent-active, var(--mn-color-accent));
      outline-offset: 1px;
    }
    .labels {
      display: flex;
      gap: 2px;
      margin-top: 3px;
    }
    .labels span {
      flex: 1;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: 10px;
      color: var(--mn-color-text-muted, #9ca3af);
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      letter-spacing: var(--mn-tracking-label, 0);
    }

    /* ── EMPORIUM skin: square segments + uppercase labels (sophia structure) ── */
    :host([data-skin='emporium']) .segment {
      border-radius: 0;
    }
    :host([data-skin='emporium']) .labels span {
      text-transform: uppercase;
    }
  `

  /** The segments to render. */
  @property({ attribute: false }) segments: MnRibbonSegment[] = []
  /** 1-based index of the highlighted segment (0 = none). */
  @property({ type: Number }) active = 0
  /** Show the per-segment label row under the ribbon. */
  @property({ type: Boolean }) showLabels = false

  /**
   * Interpolate a segment's fill across the skin ACCENT ramp role tokens (light →
   * strong). These are skin role tokens, so the ramp recolors per skin for free.
   */
  private tint(i: number, n: number): string {
    const stops = [
      'var(--mn-color-surface-accent, var(--mn-color-accent))',
      'var(--mn-color-border-accent, var(--mn-color-accent))',
      'var(--mn-color-accent)',
      'var(--mn-color-accent-active, var(--mn-color-accent))',
    ]
    if (n <= 1) return stops[2]
    const idx = Math.min(stops.length - 1, Math.round((i / (n - 1)) * (stops.length - 1)))
    return stops[idx]
  }

  private _select(seg: MnRibbonSegment, order: number): void {
    this.dispatchEvent(
      new CustomEvent('mn-ribbon-select', {
        detail: { order, value: seg.value ?? order, label: seg.label },
        bubbles: true,
        composed: true,
      }),
    )
  }

  render() {
    const n = this.segments.length
    if (!n) return nothing
    // NB: a single wrapping element. Two adjacent template parts at the shadow
    // root (the .map() then the showLabels conditional) get mis-parsed by
    // happy-dom (the conditional serializes to a literal `<?>`); wrapping both in
    // one <div> gives Lit a stable parent and renders correctly in both engines.
    return html`
      <div part="root">
        <div class="ribbon" part="ribbon" role="list">
          ${this.segments.map((seg, i) => {
            const order = i + 1
            return html`
              <button
                class=${classMap({ segment: true, active: this.active === order })}
                part="segment"
                role="listitem"
                style="background:${this.tint(i, n)}"
                title=${seg.title ? `${seg.label} — ${seg.title}` : seg.label}
                aria-label=${seg.label}
                @click=${() => this._select(seg, order)}
              ></button>
            `
          })}
        </div>
        ${this.showLabels
          ? html`<div class="labels" part="labels">
              ${this.segments.map((s) => html`<span>${s.label}</span>`)}
            </div>`
          : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-ribbon': MnRibbon
  }
}
