/**
 * mn-ovillo-tract — a vocal tract made of an Ariadne World, after Neil Thapen's
 * Pink Trombone (2017): the ovillo site's tract (site/tract at 80c4325, ovillo
 * main: the tract as a true mus_ariadne World) as a Class C three.js element.
 *
 * Its bones are kept as they are (tract-engine.js is the page's program, ported
 * line for line, and tract-worklet.js is verbatim): the organ in three.js, the
 * cross-section inset, the orbs, the consonants, the touch constrictions, the
 * presets, light mode (`?lite=1`, a coarser World update schedule), TV mode
 * (`?tv=1`, with `window.ovilloTV(key)` for an Android TV wrapper) and
 * `?mute=1` as a hard lock; its honest readouts (the books, the DSP load); and
 * its about text, word for word. What changed is the frame around it: Sophia's
 * cards, type, buttons and sliders instead of the page's own chrome.
 *
 * Quiet until START: before it, a silent World on the main thread drives the
 * pictures (the throat is already breathing) and nothing sounds; START makes the
 * AudioContext and the worklet's World takes over. Leaving the page closes it.
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { fetchWasmBytes } from '@shrubbery/runtime/wasm'
import { mountTract, type TractHandle } from './tract-engine.js'

const WORKLET_URL = new URL('./tract-worklet.js', import.meta.url)

@customElement('mn-ovillo-tract')
export class MnOvilloTract extends LitElement {
  static styles = css`
    :host {
      display: block;
      color: var(--mn-color-text-primary, #1f2a24);
      font-family: var(--mn-font-sans, system-ui, sans-serif);
      --flesh: #e86f86;
      --stage: #120a0c;
    }
    * { box-sizing: border-box; }
    .tract { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 14px; align-items: start; }
    @media (max-width: 900px) { .tract { grid-template-columns: minmax(0, 1fr); } }
    .stage { position: relative; height: min(72vh, 680px); min-height: 360px; border-radius: var(--mn-radius-surface, 10px);
      overflow: hidden; touch-action: none; background: var(--stage); border: 1px solid var(--mn-color-border-subtle, #e5e7eb); }
    @media (max-width: 900px) { .stage { height: 62vh; min-height: 340px; } }
    #gl { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    .hud { position: absolute; left: 12px; top: 10px; right: 12px; display: flex; flex-wrap: wrap; gap: 6px; pointer-events: none; }
    .hud span { font-family: var(--mn-font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; font-size: 0.75rem;
      padding: 2px 9px; border-radius: 999px; background: rgba(18, 10, 12, 0.6); color: #e9d5d9; }
    .hud b { color: #fff; font-weight: 600; }
    .muted-flag { color: #ffcf8a !important; }
    .modes { position: absolute; right: 10px; bottom: 10px; display: inline-flex; gap: 2px; padding: 2px; border-radius: 999px;
      background: rgba(18, 10, 12, 0.6); }
    .modes button { border: 0; background: transparent; color: #f3dfe2; font: inherit; font-size: 0.75rem; padding: 6px 12px; border-radius: 999px; cursor: pointer; }
    .modes button[aria-pressed='true'] { background: var(--mn-color-surface-base, #fff); color: var(--mn-color-text-primary, #1f2a24); }
    .hint { position: absolute; left: 12px; bottom: 14px; color: #c4a4aa; font-size: 0.75rem; pointer-events: none; max-width: 52%; }
    .legend { position: absolute; left: 0; right: 0; bottom: 0; padding: 6px 16px; font-size: 0.8125rem; color: #f3dfe2;
      background: rgba(13, 7, 9, 0.72); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
    .cover { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
      background: radial-gradient(ellipse at center, rgba(18, 10, 12, 0.1), rgba(18, 10, 12, 0.7)); }
    .cover[hidden] { display: none; }
    #start { font: inherit; font-size: 1rem; font-weight: 600; padding: 12px 28px; border-radius: 999px; border: 0; cursor: pointer;
      background: var(--mn-color-accent, #326f4c); color: var(--mn-color-on-accent, #fff); box-shadow: 0 2px 10px rgb(0 0 0 / 0.3); }
    #start:disabled { opacity: 0.6; }
    .cover .sub { color: #e9d5d9; font-size: 0.8125rem; max-width: 280px; text-align: center; }
    .panel-toggle { position: absolute; top: 10px; right: 10px; font: inherit; font-size: 0.75rem; padding: 5px 12px; border-radius: 999px;
      border: 0; background: rgba(18, 10, 12, 0.6); color: #f3dfe2; cursor: pointer; }
    .panel { display: grid; gap: 12px; min-width: 0; }
    .card { background: var(--mn-color-surface-raised, var(--mn-color-surface-base, #fff)); border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      border-radius: var(--mn-radius-surface, 10px); padding: 12px 14px; min-width: 0; }
    h3 { margin: 0 0 8px; font-family: var(--mn-font-display, Georgia, serif); font-weight: 500; font-size: 0.9375rem; }
    #section2d { width: 100%; height: 150px; display: block; border-radius: var(--mn-radius-md, 8px); touch-action: none; cursor: grab; }
    #strobe { width: 100%; height: 64px; display: block; border-radius: var(--mn-radius-md, 8px); background: #0f080a; }
    .presets { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .presets button { font: inherit; font-size: 0.8125rem; padding: 5px 11px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--mn-color-border-default, #d1d5db); background: var(--mn-color-surface-base, #fff); color: inherit; }
    .presets button[aria-pressed='true'] { background: var(--mn-color-accent, #326f4c); border-color: var(--mn-color-accent, #326f4c); color: var(--mn-color-on-accent, #fff); }
    button:focus-visible, input:focus-visible, canvas:focus-visible { outline: 2px solid var(--mn-color-border-focus, var(--mn-color-focus, #2563eb)); outline-offset: 2px; }
    .sliders { display: grid; grid-template-columns: 6em minmax(0, 1fr) 5.2em; gap: 4px 8px; align-items: center; font-size: 0.8125rem; }
    .sliders label { color: var(--mn-color-text-secondary, #4b5563); }
    .sliders output { text-align: right; font-family: var(--mn-font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; font-size: 0.75rem; }
    input[type='range'] { width: 100%; accent-color: var(--mn-color-accent, #326f4c); margin: 0; min-height: 26px; }
    .readout { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; font-size: 0.8125rem; font-variant-numeric: tabular-nums; }
    .readout span:nth-child(odd) { color: var(--mn-color-text-secondary, #4b5563); }
    .readout span:nth-child(even) { text-align: right; font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: 0.75rem; }
    .readout .ok { color: var(--mn-color-text-success, #166534); }
    .readout .warn { color: var(--mn-color-text-warning, #92400e); }
    .about { grid-column: 1 / -1; max-width: 76ch; font-family: var(--mn-font-prose, Georgia, serif); line-height: 1.55; font-size: 0.9375rem; }
    .about h2 { font-family: var(--mn-font-display, Georgia, serif); font-weight: 500; font-size: 1.0625rem; margin: 18px 0 6px; }
    .about ul { padding-left: 20px; margin: 4px 0; }
    .about li { margin: 4px 0; }
    .about code { font-family: var(--mn-font-mono, ui-monospace, monospace); font-size: 0.8125em; }
    .error { color: var(--mn-color-text-danger, #b91c1c); font-size: 0.875rem; }
    /* TV mode (?tv=1): the organ alone, the legend for the remote, the controls behind a toggle. */
    :host(.tv) .tract { grid-template-columns: minmax(0, 1fr); }
    :host(.tv) .stage { height: calc(100dvh - 120px); }
    :host(.tv) .panel, :host(.tv) .about, :host(.tv) .hint { display: none; }
    :host(.tv.panel-open) .tract { grid-template-columns: minmax(0, 1fr) 360px; }
    :host(.tv.panel-open) .panel { display: grid; max-height: calc(100dvh - 120px); overflow-y: auto; }
    :host(.tv) .modes { bottom: 38px; }
  `

  /** The tract World's module (ovillo-tract-world), same-origin. */
  @property({ type: String }) wasm = ''

  @state() private error = ''

  private handle: TractHandle | null = null
  private mounting = false

  /** The running tract (tests and the browser check read it; the page's own `window.__tract`). */
  get tract(): TractHandle | null {
    return this.handle
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.handle?.dispose()
    this.handle = null
    this.mounting = false
  }

  connectedCallback(): void {
    super.connectedCallback()
    if (this.hasUpdated) void this.mount()
  }

  protected firstUpdated(): void {
    void this.mount()
  }

  private async mount(): Promise<void> {
    if (this.handle || this.mounting || !this.wasm || !this.shadowRoot) return
    this.mounting = true
    try {
      const wasm = this.wasm
      this.handle = await mountTract(this.shadowRoot, { host: this, workletUrl: WORKLET_URL, loadWasm: () => fetchWasmBytes(wasm) })
      this.dataset.tract = this.handle ? 'ready' : ''
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.mounting = false
    }
  }

  render() {
    return html`<div class="tract">
      <section class="stage" id="stage" aria-label="Vocal tract, three-dimensional view">
        <canvas id="gl"></canvas>
        <div class="hud" aria-live="off">
          <span>F0 <b id="h-f0">–</b></span>
          <span>lung <b id="h-lung">–</b></span>
          <span>DSP <b id="h-dsp">–</b></span>
          <span>books <b id="h-books">–</b></span>
          <span id="h-muted" class="muted-flag" hidden>muted</span>
        </div>
        <div class="hint" id="hint">drag the tongue · drag elsewhere to turn</div>
        <div class="modes" role="group" aria-label="Pointer mode">
          <button id="m-drag" aria-pressed="true">Drag</button>
          <button id="m-touch" aria-pressed="false">Touch</button>
          <button id="m-shoot" aria-pressed="false">Shoot orbs</button>
        </div>
        <button id="panel-toggle" class="panel-toggle" aria-expanded="false" hidden>Controls</button>
        <div class="legend" id="legend" hidden>← → tongue · ↑ ↓ height · OK start / next · 1–9 presets · SPACE orb · M mute</div>
        <div class="cover" id="cover">
          <button id="start">Start</button>
          <div class="sub">sound starts quiet. the throat is already breathing.</div>
        </div>
      </section>
      <section class="panel" aria-label="Controls">
        <div class="card">
          <h3>Cross-section · drag the tongue · touch to constrict</h3>
          <canvas id="section2d" aria-label="Tract cross-section; drag the tongue handle, touch anywhere forward of the velum to constrict"></canvas>
          <div class="presets" role="group" aria-label="Presets">
            <button data-preset="0">aaa</button>
            <button data-preset="1">eee</button>
            <button data-preset="2">ooo</button>
            <button data-gesture="0">mama…</button>
            <button data-gesture="1">a-i-u-a</button>
            <button data-preset="3">rest</button>
          </div>
          <div class="presets" role="group" aria-label="Consonants">
            <button data-gesture="2">sss</button>
            <button data-gesture="3">shh</button>
            <button data-gesture="4">fff</button>
            <button data-gesture="5">zzz</button>
            <button data-gesture="6">vvv</button>
            <button data-gesture="7">pa</button>
            <button data-gesture="8">ta</button>
            <button data-gesture="9">ka</button>
            <button data-gesture="10">papapa…</button>
          </div>
        </div>
        <div class="card">
          <h3>The player's controls</h3>
          <div class="sliders">
            <label for="s-breath">breath</label><input id="s-breath" type="range" min="0" max="1" step="0.01" value="0.55"><output id="o-breath"></output>
            <label for="s-pitch">tension</label><input id="s-pitch" type="range" min="60" max="420" step="1" value="120"><output id="o-pitch"></output>
            <label for="s-tense">press</label><input id="s-tense" type="range" min="0" max="1" step="0.01" value="0.6"><output id="o-tense"></output>
            <label for="s-lips">lips</label><input id="s-lips" type="range" min="0" max="1" step="0.01" value="0.6"><output id="o-lips"></output>
            <label for="s-velum">velum</label><input id="s-velum" type="range" min="0" max="1" step="0.01" value="0.35"><output id="o-velum"></output>
            <label for="s-asp">breathy</label><input id="s-asp" type="range" min="0" max="1" step="0.01" value="0.15"><output id="o-asp"></output>
            <label for="s-vib">vibrato</label><input id="s-vib" type="range" min="0" max="1" step="0.01" value="0"><output id="o-vib"></output>
            <label for="s-vibrate">vib rate</label><input id="s-vibrate" type="range" min="3" max="8" step="0.1" value="5.5"><output id="o-vibrate"></output>
            <label for="s-wobble">wobble</label><input id="s-wobble" type="range" min="0" max="1" step="0.01" value="0.3"><output id="o-wobble"></output>
            <label for="s-master">master</label><input id="s-master" type="range" min="0" max="1" step="0.01" value="0.12"><output id="o-master"></output>
          </div>
        </div>
        <div class="card">
          <h3>Folds · the last measured cycle</h3>
          <canvas id="strobe" aria-label="Fold half-gap over the last measured cycle"></canvas>
        </div>
        <div class="card">
          <h3>The books (joules, since start)</h3>
          <div class="readout" id="readout"></div>
        </div>
      </section>
      ${this.error ? html`<p class="error" role="alert">The tract could not start: ${this.error}</p>` : nothing}
      <section class="about">
        <h2>What this is</h2>
        <p>A vocal tract made of an Ariadne World, after Neil Thapen's <i>Pink Trombone</i> (2017), written independently. Nothing here plays a recording or a stored glottal pulse: lung pressure pushes air through two folds, the folds start to flap on their own, and the flapping air rings in a tube shaped by your tongue, lips and velum. Every joule is on the books: what the breathing muscles and the orbs put in, what moving the walls cost, what was lost to the walls, the jet and the folds, and what left through the lips and nostrils. The residual is printed above.</p>
        <h2>Physical (one Ariadne World)</h2>
        <ul>
          <li>The tract is one body of a <code>mus_ariadne::World</code>, the same runtime the Ariadne guitar plays in, with one ledger. Its configuration is a point in fourteen dimensions: tongue index, tongue diameter, lips, velum, and the place and degree of five constrictions.</li>
          <li>At every configuration the World computes the body's 24 lowest modes from the shape of the air: an oral tube of 44 compressible sections and a nasal branch of 31, joined by inertive air columns (a discretized Webster horn, the lips and nostrils opening to the room). Moving the shape holds the air's excess volume and momentum fixed and re-projects them onto the new modes; the energy that changes is booked as control work, and what the 24 modes cannot hold is booked as disposal.</li>
          <li>The glottis self-oscillates: a fold mass on a tension spring with collision, pushed by the air in the slit, fed by a finite lung reservoir the breathing muscles refill. Its jet enters the first section with exactly the work it does there. Pitch is the fold tension; the World decides the actual F0.</li>
          <li>Air beyond linear acoustics: the narrowest column carries a jet that loses its dynamic pressure (a free jet), and a turbulent force a few columns downstream returns a share of that loss as sound (0.4% at Mach 0.1, growing as Mach³, switched on by Reynolds number), paid out of the jet's loss. A column whose area falls below GARGANTA's 0.025 cm² floor follows it down to a seal; closure is a configuration like any other, so pressure builds behind a stop from the lungs and the release spends it.</li>
          <li>Touch the cross-section to place constrictions; vibrato and wobble retune the fold, booked; an orb knocks the air where it lands, its energy booked as source work.</li>
        </ul>
        <h2>Approximated, and why</h2>
        <ul>
          <li>Wall loss and radiation are diagonal in the modes (exact only for uniform loss). Once the air flows they act on momentum and pressure respectively so a stop's pressure does not leak; a steady flow is then over-charged by the frequency-independent wall loss, and the booked radiation also drains static pressure that real radiation would not.</li>
          <li>One jet (the narrowest column), quasi-steady, with no pressure recovery; turbulence is white noise shaped only by the tract; there is no glottal aspiration noise (the aspiration control is accepted and does nothing yet); an orb does not dent the wall.</li>
          <li>The shape is moved in steps (every 32 samples while it travels, every 128 in light mode), not continuously; the steps cost a few dB above 6 kHz during fast gestures. Light mode is the same World, moved less often.</li>
          <li>One fold mass with a lumped mucosal delay. The air's work on the folds is booked to the lungs. Vowel presets are a fit in this World to GARGANTA's rung-1 vowel bodies (design profiles, not measurements); /u/ needs a small velopharyngeal opening.</li>
          <li>The pictures: geometry follows the World every frame (areas, fold gap, wall pressure). The idle sway of the camera, the sheen and the orb splashes are decoration.</li>
        </ul>
        <p>Source: <code>ovillo/crates/ovillo-tract-world</code> (the World tract, its C ABI, tests and receipts) on <code>mus-rs/crates/mus-ariadne</code>; the C ABI is that of <code>ovillo-tract-wasm</code>, so either engine runs this page. three.js r170 comes from npm (the release the page vendored, MIT).</p>
      </section>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-ovillo-tract': MnOvilloTract
  }
}
