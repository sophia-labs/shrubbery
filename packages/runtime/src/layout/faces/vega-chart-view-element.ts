/**
 * vega-chart-view-element.ts — `<sh-vega-chart-view>`, the real Vega-Lite
 * chart body for the `chart.vega-lite` face (Wave 2 / Lane B spec
 * `plans/surface-wave2-laneb-slice-20260716.md` §4).
 *
 * Wraps the SAME PRODUCTION `mountQueryBlockVega` the QueryBlock host
 * renderer uses (`../../editor-services/query-block-vega.js` — real
 * `vega-embed`, Garden's ink-and-parchment config defaults, real
 * `transformBindingsToVegaValues` binding-to-values conversion). This
 * element owns vega-embed's own async, imperative mount/cleanup lifecycle
 * (`updated()` re-mounts on a `result`/`vegaLiteSpec` change;
 * `disconnectedCallback()` finalizes the live Vega `View`) so the FACE
 * (chart-vega-lite-face.ts) only ever sets plain, already-computed
 * properties — mirroring the split every other face/view-element pair in
 * this directory draws.
 *
 * The `.chart-host` div is a STABLE node across re-renders (lit-html keeps a
 * static-position element identity across renders of the same template
 * shape), so vega-embed's own DOM inside it is never touched by Lit's own
 * diffing — the same "hand an external library a real, persistent container"
 * pattern `mountQueryBlockVega`'s existing production caller already uses
 * (query-block-service.ts's plain `<div class="query-block-host-vega">`).
 */
import { LitElement, css, html, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import {
  mountQueryBlockVega,
  resolveVegaThemeOverride,
  type QueryBlockVegaEmbedLoader,
} from '../../editor-services/query-block-vega.js'
import { observeVegaThemeFlips } from '../../editor-services/vega-theme.js'
import type { QueryBlockResult } from '../../editor-services/query-block-service.js'

export type VegaChartViewStatus = 'loading' | 'ready' | 'empty' | 'error'

@customElement('sh-vega-chart-view')
export class ShVegaChartView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--mn-color-surface-base);
      color: var(--mn-color-text-primary);
      font: var(--mn-text-sm, 13px) / 1.5 var(--mn-font-chrome, system-ui, sans-serif);
    }
    .stage {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
    }
    .chart-host {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      padding: var(--mn-space-2, 8px);
      box-sizing: border-box;
    }
    /* Tabular lining figures for every number Vega-Lite renders (axis ticks,
       tooltip values, direct labels) — real CSS on the real SVG <text> nodes
       vega-embed's SVG renderer produces; Vega-Lite's own config schema has
       no font-variant-numeric knob, so this is the correct place for it
       rather than fighting the spec. Scoped to .chart-host so it never
       leaks onto chrome text outside the chart. */
    .chart-host :is(text, tspan) {
      font-variant-numeric: tabular-nums;
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

  @property({ type: String }) status: VegaChartViewStatus = 'loading'
  @property({ type: String }) error = ''
  /** `attribute:false` — a real `QueryBlockResult` object, never serialized to/from an HTML attribute. */
  @property({ attribute: false }) result: QueryBlockResult | null = null
  @property({ type: String }) vegaLiteSpec = ''

  /** TRUSTED house categorical pinning from the face — forwarded verbatim to mountQueryBlockVega (never authored data). */
  @property({ attribute: false }) pinnedColorScale: {
    readonly domain: readonly unknown[]
    readonly range: readonly string[]
  } | null = null
  /** Test seam — mirrors `QueryBlockRendererOptions.loadVegaEmbed`'s own doc comment. Production leaves this unset. */
  loadVegaEmbed?: QueryBlockVegaEmbedLoader

  private _cleanup: (() => void) | null = null
  private _renderId = 0
  private _themeFlipDispose: (() => void) | null = null

  private _clearChart(): void {
    this._renderId += 1 // invalidate any in-flight mount
    this._cleanup?.()
    this._cleanup = null
  }

  protected updated(changed: Map<string | number | symbol, unknown>): void {
    if (this.status !== 'ready' || !this.result) {
      this._clearChart()
      return
    }
    if (!changed.has('status') && !changed.has('result') && !changed.has('vegaLiteSpec') && !changed.has('pinnedColorScale')) return
    this._mountChart()
  }

  /**
   * Mount (or re-mount) the current result/spec into the stable `.chart-host`
   * node. Shared by the ordinary property-change path (`updated`) and the
   * root theme/skin observer below — both bake the CURRENT root attributes
   * into the spec, so whichever fired last wins via `_renderId` supersession.
   */
  private _mountChart(): void {
    if (this.status !== 'ready' || !this.result) return
    const host = this.renderRoot.querySelector<HTMLDivElement>('.chart-host')
    if (!host) return
    const result = this.result
    const spec = this.vegaLiteSpec
    const renderId = ++this._renderId
    this._cleanup?.()
    this._cleanup = null
    // Resolved fresh on EVERY mount (not cached at connect): the governing
    // scope is the composed-tree position at mount time, so a poll/remount
    // after the shell re-registered its per-region themes picks up the
    // current ones — and a chart outside any fragment region gets null (the
    // pure house theme), never some other surface's override.
    const themeOverride = resolveVegaThemeOverride(this)
    void mountQueryBlockVega({ container: host, result, vegaLiteSpec: spec, themeOverride, pinnedColorScale: this.pinnedColorScale, loadEmbed: this.loadVegaEmbed })
      .then((cleanup) => {
        if (renderId !== this._renderId) {
          cleanup() // a newer mount (or a teardown) already superseded this one
          return
        }
        this._cleanup = cleanup
      })
      .catch((cause: unknown) => {
        if (renderId !== this._renderId) return
        this.status = 'error'
        this.error = cause instanceof Error ? cause.message : String(cause)
      })
  }

  connectedCallback(): void {
    super.connectedCallback()
    // Vega bakes every color into the spec at mount time (vega-theme.ts's
    // own header), so a chart CANNOT follow a data-theme/data-skin flip via
    // the CSS cascade the way its Lit-styled chrome does. Observe the SAME
    // root attributes the token CSS keys on and re-mount — the spec re-bakes
    // against the new mode (`observeVegaThemeFlips` watches the exact
    // attributes `resolveVegaThemeMode` reads). The face layer additionally
    // regenerates mode-dependent SPEC content (the pinned categorical range)
    // on the same signal; its property write and this remount coalesce
    // through `_renderId`.
    this._themeFlipDispose = observeVegaThemeFlips(this.ownerDocument, () => this._mountChart())
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this._themeFlipDispose?.()
    this._themeFlipDispose = null
    this._clearChart()
  }

  private _state(message: string, tone: 'neutral' | 'danger' = 'neutral'): TemplateResult {
    return html`<div class="state" data-tone=${tone}>${message}</div>`
  }

  private _body(): TemplateResult {
    if (this.status === 'loading') return this._state('Loading…')
    if (this.status === 'error') return this._state(this.error || 'This chart could not be rendered.', 'danger')
    if (this.status === 'empty') return this._state('No rows.')
    return html`<div class="chart-host"></div>`
  }

  render(): TemplateResult {
    return html`<div class="stage" role="img" aria-label="Chart">${this._body()}</div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-vega-chart-view': ShVegaChartView
  }
}
