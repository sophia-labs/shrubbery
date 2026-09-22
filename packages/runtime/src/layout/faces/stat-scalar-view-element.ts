/**
 * stat-scalar-view-element.ts — `<sh-stat-scalar-view>`, the real big-number
 * card body for the `stat.scalar` face (Wave 2 / Lane B spec
 * `plans/surface-wave2-laneb-slice-20260716.md` §4: "renders first binding of
 * first row as a big-number card + label").
 *
 * Deliberately dumb: this element renders ONLY already-formatted display
 * strings (`value`/`label`/`unit`) and already-derived display data
 * (`delta`/`series`) — all query execution, term formatting, and delta/series
 * derivation live in stat-scalar-face.ts, mirroring the split `sh-sparql-
 * table-view` already draws between "the face runs the real service and
 * formats terms" and "the element paints already-typed strings".
 *
 * Aesthetic-overhaul pass (builder B3 — faces as designed objects): the
 * hero-figure/label/delta-chip/sparkline contract from the dataviz skill's
 * "Figures — when the form is a number" section, expressed ONLY through
 * `--mn-*` tokens. Color tokens carry NO raw-hex fallbacks — tokens.css is
 * always loaded in-product (and every harness page imports it), so a
 * fallback hex would only ever paint in a broken build, silently hiding the
 * breakage. The card surface consumes the shared card chrome hooks
 * (`--mn-color-surface-raised` / `--mn-radius-surface` / `--mn-shadow-card`
 * — in Observatory the instrument glow), and the hero numeral wears the
 * global `--mn-font-numeral` + the Observatory numeral-ink hook (with the
 * skin-neutral title ink as its cascade fallback).
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'

export type StatScalarViewStatus = 'loading' | 'ready' | 'no-data' | 'error'

/** Sign of the change vs the compared period — 'flat' is genuinely zero, not "no data" (that's `delta === null`). */
export type StatDeltaDirection = 'up' | 'down' | 'flat'

/**
 * A RESERVED status tone, never a categorical series color (dataviz
 * non-negotiable: "status colors are reserved — never reused as series
 * colors"). 'neutral' is the flat/no-opinion case and deliberately does NOT
 * draw from the reserved good/bad pair.
 */
export type StatDeltaTone = 'good' | 'bad' | 'neutral'

export interface StatDeltaView {
  /** Already-signed, already-formatted display text ("+12", "-3.4%", "0"). */
  readonly text: string
  readonly direction: StatDeltaDirection
  readonly tone: StatDeltaTone
}

const SPARKLINE_VIEWBOX_W = 100
const SPARKLINE_VIEWBOX_H = 100
const SPARKLINE_Y_PAD = 14

interface SparklineGeometry {
  readonly linePoints: string
  readonly dotLeftPct: number
  readonly dotTopPct: number
}

/** Pure — exported for unit testing. `series` must have >= 2 finite points; the CALLER (render) gates the < 2 case. */
export function computeSparklineGeometry(series: readonly number[]): SparklineGeometry {
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  const usableH = SPARKLINE_VIEWBOX_H - SPARKLINE_Y_PAD * 2
  const stepX = SPARKLINE_VIEWBOX_W / (series.length - 1)
  const points = series.map((value, index) => {
    const x = index * stepX
    const y = SPARKLINE_Y_PAD + (1 - (value - min) / span) * usableH
    return { x, y }
  })
  const last = points[points.length - 1]
  return {
    linePoints: points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '),
    dotLeftPct: last.x,
    dotTopPct: last.y,
  }
}

@customElement('sh-stat-scalar-view')
export class ShStatScalarView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      width: 100%;
      height: 100%;
      overflow: hidden;
      box-sizing: border-box;
      padding: var(--mn-space-2, 8px);
      background: var(--mn-color-surface-base);
      color: var(--mn-color-text-primary);
      font: var(--mn-text-sm, 13px) / 1.5 var(--mn-font-chrome, system-ui, sans-serif);
    }
    .stage {
      display: flex;
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
    }
    /* A real CARD surface — the shared card chrome hooks, so in Observatory
       this tile reads as a lit instrument (surface-raised ink step +
       accent-lit hairline + --mn-shadow-card = the instrument glow) and in
       every light skin as the ordinary raised card. */
    .card {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      justify-content: center;
      gap: var(--mn-space-1-5, 6px);
      padding: var(--mn-space-4, 16px);
      min-width: 0;
      background: var(--mn-color-surface-raised);
      border: 1px solid var(--mn-color-border-subtle);
      border-radius: var(--mn-radius-surface, 8px);
      box-shadow: var(--mn-shadow-card);
    }
    /* Small-caps muted label — the eyebrow above the hero numeral. */
    .label {
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      font-variant-caps: all-small-caps;
      letter-spacing: var(--mn-tracking-label, 0.05em);
      color: var(--mn-color-text-muted);
    }
    /* Hero numeral row — the value and its unit set visibly apart. */
    .value-row {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: var(--mn-space-1, 4px);
      min-width: 0;
    }
    .value {
      /* On the published scale (the old 34-pixel magic value sat between
         --mn-text-3xl and -4xl for no articulable reason; 3xl keeps the hero
         dominant over the sm chrome while landing on a real step). */
      font-size: var(--mn-text-3xl, 1.875rem);
      font-weight: 650;
      line-height: 1.05;
      letter-spacing: -0.01em;
      /* The global numeral voice (JetBrains Mono via --mn-font-numeral) +
         the Observatory numeral-ink hook: in the Observatory room the hero
         figure sits at the brightest ink step; elsewhere the token is unset
         and the skin-neutral title ink applies. */
      font-family: var(--mn-font-numeral, var(--mn-font-mono, ui-monospace, monospace));
      color: var(--mn-observatory-numeral-ink, var(--mn-color-text-title, inherit));
      /* Hero figures read as counted quantities — lining tabular figures so
         every digit sits on the baseline at a fixed width (dataviz brief:
         "hero numeral (tabular lining figures, large)"). */
      font-variant-numeric: tabular-nums lining-nums;
      overflow-wrap: anywhere;
    }
    /* A query that matched NOTHING. The hero slot confesses the absence in tertiary
       ink at chrome size and chrome face — never a fabricated "0" wearing hero
       weight and the numeral voice. */
    .value[data-absent='true'] {
      font-size: var(--mn-text-sm, 13px);
      font-weight: 500;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-style: italic;
      color: var(--mn-color-text-tertiary);
    }
    .unit {
      font-size: var(--mn-text-sm, 13px);
      font-weight: 500;
      color: var(--mn-color-text-secondary);
      white-space: nowrap;
    }
    /* Delta chip — direction + a RESERVED status tone + an icon, so identity
       never rides on color alone (dataviz non-negotiable). */
    .delta {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      gap: var(--mn-space-1, 4px);
      padding: var(--mn-space-0-5, 2px) var(--mn-space-2, 8px);
      border-radius: var(--mn-radius-full, 9999px);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .delta[data-tone='good'] {
      color: var(--mn-color-success-strong);
      background: var(--mn-color-success-surface);
    }
    .delta[data-tone='bad'] {
      color: var(--mn-color-danger-strong);
      background: var(--mn-color-danger-surface);
    }
    .delta[data-tone='neutral'] {
      color: var(--mn-color-text-tertiary);
      background: var(--mn-color-surface-sunken);
    }
    .delta-arrow {
      width: 10px;
      height: 10px;
      flex: 0 0 auto;
      fill: currentColor;
    }
    /* Sparkline — one metric's own trend, never a categorical series: the
       accent hue (single identity), not a palette slot. Two-pixel line via
       vector-effect so it stays 2px regardless of the box's aspect ratio;
       no axes, no gridlines, per the brief. */
    .sparkline {
      position: relative;
      width: 100%;
      height: 22px;
      margin-top: var(--mn-space-0-5, 2px);
    }
    .sparkline svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .sparkline polyline {
      fill: none;
      stroke: var(--mn-color-accent);
      stroke-width: 2px;
      stroke-linecap: round;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }
    .sparkline-dot {
      position: absolute;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--mn-color-accent);
      /* A 2px ring in the CARD's own surface keeps the end-dot legible where
         it meets the line (marks-and-anatomy.md's "surface ring"). */
      box-shadow: 0 0 0 2px var(--mn-color-surface-raised);
      transform: translate(-50%, -50%);
    }
    .state {
      display: grid;
      flex: 1 1 auto;
      place-content: center;
      padding: var(--mn-space-4, 16px);
      color: var(--mn-color-text-tertiary);
      text-align: center;
    }
    .state[data-tone='danger'] {
      color: var(--mn-color-danger-strong);
    }
  `

  @property({ type: String }) status: StatScalarViewStatus = 'loading'
  @property({ type: String }) error = ''
  @property({ type: String }) label = ''
  @property({ type: String }) value = ''
  @property({ type: String }) unit = ''
  @property({ attribute: false }) delta: StatDeltaView | null = null
  @property({ attribute: false }) series: readonly number[] = []

  private _state(message: string, tone: 'neutral' | 'danger' = 'neutral'): TemplateResult {
    return html`<div class="state" data-tone=${tone}>${message}</div>`
  }

  // Each direction is its OWN complete, static <svg>...</svg> block (never a
  // dynamic child marker nested inside a shared static <svg> wrapper): some
  // DOM implementations mis-parse a lit-html child-part comment marker
  // placed directly inside foreign (SVG) content, silently dropping the
  // marker and misrouting the value into a sibling text part. Interpolating
  // the WHOLE icon as one value sidesteps that entirely.
  private _deltaIcon(direction: StatDeltaDirection): TemplateResult {
    if (direction === 'up') {
      return html`<svg class="delta-arrow" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1 L9 8 L1 8 Z"></path></svg>`
    }
    if (direction === 'down') {
      return html`<svg class="delta-arrow" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 9 L1 2 L9 2 Z"></path></svg>`
    }
    return html`<svg class="delta-arrow" viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="4.25" width="8" height="1.5" rx="0.75"></rect></svg>`
  }

  private _delta(): TemplateResult | typeof nothing {
    const delta = this.delta
    if (!delta) return nothing
    return html`
      <span class="delta" data-direction=${delta.direction} data-tone=${delta.tone}>
        ${this._deltaIcon(delta.direction)}
        <span class="delta-text">${delta.text}</span>
      </span>
    `
  }

  private _sparkline(): TemplateResult | typeof nothing {
    // Render ONLY when the data genuinely offers a series (brief: "render if
    // the face's data offers a series") — a single point has no trend to draw.
    if (this.series.length < 2) return nothing
    const geometry = computeSparklineGeometry(this.series)
    return html`
      <div class="sparkline" aria-hidden="true">
        <svg viewBox="0 0 ${SPARKLINE_VIEWBOX_W} ${SPARKLINE_VIEWBOX_H}" preserveAspectRatio="none">
          <polyline points=${geometry.linePoints} />
        </svg>
        <span class="sparkline-dot" style="left:${geometry.dotLeftPct}%; top:${geometry.dotTopPct}%"></span>
      </div>
    `
  }

  private _body(): TemplateResult {
    if (this.status === 'loading') return this._state('Loading…')
    if (this.status === 'error') return this._state(this.error || 'This stat could not be loaded.', 'danger')
    if (this.status === 'no-data') {
      // Absence keeps the CARD (so the label survives) — never the _state
      // box, and never delta/sparkline, even if those were set before the
      // status flipped (applyResult clears every derived slot first).
      return html`
        <div class="card">
          <div class="label">${this.label}</div>
          <div class="value-row"><span class="value" data-absent="true">No data</span></div>
        </div>
      `
    }
    return html`
      <div class="card">
        <div class="label">${this.label}</div>
        <div class="value-row">
          <span class="value">${this.value}</span>
          ${this.unit ? html`<span class="unit">${this.unit}</span>` : nothing}
        </div>
        ${this._delta()}
        ${this._sparkline()}
      </div>
    `
  }

  render(): TemplateResult {
    return html`<div class="stage" role="status" aria-label=${this.label || 'Stat'}>${this._body()}</div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-stat-scalar-view': ShStatScalarView
  }
}
