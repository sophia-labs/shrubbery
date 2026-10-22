/**
 * ov-energy-trace — a piece's energy traces at full size, for the piece page.
 *
 * The same data as the player's Energy screen (the World's stored energy by
 * body, every 10 ms, and the touches), drawn as a chart with its axes: seconds
 * along, 10·log10 E up in dB re one of the World's own energy units (the
 * receipt's joules, not calibrated against an instrument), a 60 dB window. A
 * playhead follows the shared engine while it plays this piece; a click asks
 * the shell to play from there (`ov-trace-seek`).
 *
 * App-owned (Aviary's av-* pattern): it draws what the shell hands it.
 */

import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { unsafeHTML } from 'lit/directives/unsafe-html.js'
import { energyPolylines, formatClock, type AudioPlayer, type MnEnergyTrace } from '@shrubbery/components/audio'

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

function tickStep(duration: number): number {
  if (duration <= 20) return 2
  if (duration <= 60) return 5
  if (duration <= 150) return 10
  return 30
}

@customElement('ov-energy-trace')
export class OvEnergyTrace extends LitElement {
  static styles = css`
    :host {
      display: block;
      color: var(--mn-color-text-primary, #1f2a24);
      font-family: var(--mn-font-sans, system-ui, sans-serif);
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
      align-items: center;
      margin: 0 0 10px;
      font-size: 0.8125rem;
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .legend .key {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--mn-color-text-primary, #1f2a24);
    }
    .legend .key::before {
      content: '';
      width: 14px;
      height: 3px;
      border-radius: 2px;
      background: var(--c);
    }
    .legend .unit {
      margin-left: auto;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 0.75rem;
    }
    .plot {
      position: relative;
      height: 220px;
      margin-left: 38px;
      cursor: pointer;
    }
    .plot svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .plot polyline {
      fill: none;
      stroke-width: 1.4;
      vector-effect: non-scaling-stroke;
      stroke-linejoin: round;
    }
    .plot .grid {
      stroke: var(--mn-color-border-subtle, #e5e7eb);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
    .ylab {
      position: absolute;
      left: -38px;
      width: 32px;
      transform: translateY(-50%);
      text-align: right;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 0.6875rem;
      color: var(--mn-color-text-muted, #6b7280);
    }
    .head {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 1px;
      background: var(--mn-color-text-primary, #1f2a24);
      opacity: 0.55;
      pointer-events: none;
      left: 0;
    }
    .touches {
      position: relative;
      height: 10px;
      margin: 6px 0 0 38px;
    }
    .touches i {
      position: absolute;
      top: 0;
      width: 1px;
      height: 10px;
      background: var(--mn-color-text-muted, #6b7280);
      opacity: 0.7;
    }
    .touches i[data-world-index='1'] {
      background: var(--mn-chart-categorical-4, #6f7d16);
    }
    .xaxis {
      position: relative;
      height: 16px;
      margin: 2px 0 0 38px;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 0.6875rem;
      color: var(--mn-color-text-muted, #6b7280);
    }
    .xaxis span {
      position: absolute;
      transform: translateX(-50%);
    }
    .note {
      margin: 8px 0 0;
      font-size: 0.8125rem;
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .empty {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: 0.875rem;
    }
  `

  @property({ attribute: false }) trace: MnEnergyTrace | null = null
  @property({ type: String }) error = ''
  @property({ attribute: false }) engine: AudioPlayer | null = null
  @property({ type: String, attribute: 'track-id' }) trackId = ''

  private raf = 0
  private unsubscribe: (() => void) | null = null
  private svgCache: { trace: MnEnergyTrace; svg: string } | null = null

  connectedCallback(): void {
    super.connectedCallback()
    this.subscribe()
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('engine')) this.subscribe()
    this.paint()
  }

  private subscribe(): void {
    this.unsubscribe?.()
    this.unsubscribe = this.engine?.subscribe((s) => {
      if (s.status === 'playing' && s.track?.iri === this.trackId) this.loop()
      else this.paint()
    }) ?? null
  }

  private loop(): void {
    if (this.raf || typeof requestAnimationFrame === 'undefined') return
    const step = (): void => {
      this.raf = 0
      this.paint()
      const s = this.engine?.get()
      if (this.isConnected && s?.status === 'playing' && s.track?.iri === this.trackId) this.raf = requestAnimationFrame(step)
    }
    this.raf = requestAnimationFrame(step)
  }

  /** The playhead, from the engine's element clock when it holds this piece. */
  private paint(): void {
    const head = this.renderRoot.querySelector<HTMLElement>('.head')
    if (!head || !this.trace) return
    const s = this.engine?.get()
    const mine = s?.track?.iri === this.trackId
    const t = mine ? this.engine!.element.currentTime || s!.currentTime : 0
    head.hidden = !mine
    head.style.left = `${Math.min(100, Math.max(0, (t / this.trace.durationSeconds) * 100)).toFixed(3)}%`
    head.dataset.seconds = t.toFixed(2)
  }

  private chartSvg(trace: MnEnergyTrace): string {
    if (this.svgCache?.trace === trace) return this.svgCache.svg
    const lines = energyPolylines(trace, 1000, 100, 1200)
    const grid = [0, 10, 20, 30, 40, 50, 60].map((d) => (d / 60) * 100)
    const svg =
      `<svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label="${esc(`Stored energy by body over ${formatClock(trace.durationSeconds)}`)}">` +
      grid.map((y) => `<line class="grid" x1="0" x2="1000" y1="${y}" y2="${y}"></line>`).join('') +
      lines.map((pts, i) => `<polyline points="${pts}" style="stroke: var(--mn-chart-categorical-${(i % 5) + 1})" data-body="${esc(trace.bodies[i].id)}"></polyline>`).join('') +
      `</svg>`
    this.svgCache = { trace, svg }
    return svg
  }

  private onClick(event: MouseEvent): void {
    if (!this.trace) return
    const r = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const f = r.width > 0 ? Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)) : 0
    this.dispatchEvent(new CustomEvent('ov-trace-seek', { detail: { seconds: f * this.trace.durationSeconds }, bubbles: true, composed: true }))
  }

  render() {
    const trace = this.trace
    if (!trace) {
      return html`<p class="empty" data-state=${this.error ? 'error' : 'loading'}>${this.error ? `The energy trace could not be read: ${this.error}` : 'Reading the energy trace…'}</p>`
    }
    const step = tickStep(trace.durationSeconds)
    const ticks: number[] = []
    for (let t = 0; t <= trace.durationSeconds + 1e-6; t += step) ticks.push(t)
    const worlds = trace.worlds
    return html`<div class="chart">
      <div class="legend">
        ${trace.bodies.map((b, i) => html`<span class="key" style=${`--c: var(--mn-chart-categorical-${(i % 5) + 1})`}>${b.label}</span>`)}
        <span class="unit" title="The receipt calls the World's energy unit a joule; it is not calibrated against a measured instrument.">10·log₁₀ E · dB re the World's energy unit${trace.unitInferred ? ' · unit inferred' : ''}</span>
      </div>
      <div class="plot" @click=${this.onClick}>
        ${unsafeHTML(this.chartSvg(trace))}
        ${[0, 20, 40, 60].map((d) => html`<span class="ylab" style=${`top: ${(d / 60) * 100}%`}>${String(Math.round(trace.hiDb - d)).replace('-', '−')}</span>`)}
        <div class="head" hidden></div>
      </div>
      <div class="touches" aria-label=${`${trace.touches.length} touches`}>
        ${trace.touches.map((t) => html`<i style=${`left: ${((t.t / trace.durationSeconds) * 100).toFixed(3)}%`} data-world-index=${String(Math.max(0, worlds.indexOf(t.world ?? '')))}></i>`)}
      </div>
      <div class="xaxis" aria-hidden="true">
        ${ticks.map((t) => html`<span style=${`left: ${((t / trace.durationSeconds) * 100).toFixed(3)}%`}>${formatClock(t)}</span>`)}
      </div>
      <p class="note">${`${trace.touches.length} touches${worlds.length > 1 ? ` across ${worlds.length} Worlds (${worlds.join(', ')}), summed by body` : ''}. Each body's stored energy every ${Math.round(trace.hopSeconds * 1000)} ms, from the render's energy trace.`}</p>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ov-energy-trace': OvEnergyTrace
  }
}
