/**
 * rz-shell — the RHIZOME content HOST: ONE integrated shell that SWITCHES
 * surfaces inside the content region by STATE (never a page swap).
 *
 * The website-as-RDF frame (renderWorkspace + rhizome-config) stamps `<rz-shell>`
 * into the single resizable spine head (region-observatory → panel-observatory).
 * This module upgrades that inert tag in place (the upgrade seam). The shell is
 * THIN: it owns the cross-surface chrome + the surface switch, and DELEGATES each
 * surface's render to its own element:
 *   - surface='plot' → `<rz-observatory>` (UNCHANGED) — fed the Plot props
 *     (plot/chains/openSubject/asof/loading/error). Its intents (rz-open/rz-back)
 *     bubble through this host to the app shell (main.ts), which re-fetches.
 *   - surface='walk' → `<rz-walk>` (the phase-2 stub) — fed runId/turn.
 *
 * THE SCRUBBER is a CROSS-SURFACE LENS (the ?asof temporal lens persists across
 * surfaces), so it is LIFTED here — rendered ONCE by the shell, above the body,
 * not by rz-observatory (which no longer renders it). Picking a lens emits
 * `rz-asof` up to the app shell exactly as before.
 *
 * Controlled: main.ts sets `surface` + `asof` + the Plot props + loading/error;
 * the shell re-renders. It owns NO data path — no fetch, no SPARQL, no router.
 *
 * happy-dom gotcha (verified, see rz-observatory): each switched surface is
 * wrapped in its OWN host `<div>` so the `${…}` is the sole child of an element,
 * never a trailing bare child-binding (which happy-dom's lit drops when nested).
 */

import { LitElement, css, html, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import './rz-observatory.js'
import './rz-walk.js'
import './rz-bouquet.js'
import './rz-greenhouse.js'
import type {
  BouquetResource,
  GreenhouseResource,
  MemoryRecord,
  PlotResource,
  SubjectResource,
  WalkIndexResource,
  WalkResource,
} from '@shrubbery/render'
import { scrubberView } from './dom-views.js'
import type { GhostCluster } from './greenhouse-views.js'
import type { Surface } from './router.js'
import type { RzObservatory } from './rz-observatory.js'
import type { RzWalk } from './rz-walk.js'
import type { RzBouquet } from './rz-bouquet.js'
import type { RzGreenhouse } from './rz-greenhouse.js'

@customElement('rz-shell')
export class RzShell extends LitElement {
  /** The active surface (Plot | Walk). Controlled by the app shell. */
  @property({ type: String }) surface: Surface = 'plot'
  /** The cross-surface as-of lens (ISO date), or null = now. */
  @property({ type: String }) asof: string | null = null
  /** Whether a read is in flight (Plot data layer). */
  @property({ type: Boolean }) loading = false
  /** A live read error to surface verbatim (NO faked fallback). */
  @property({ type: String }) error = ''

  // ── Plot surface props (passed straight through to <rz-observatory>) ──────────
  @property({ attribute: false }) plot: PlotResource | null = null
  @property({ attribute: false }) chains: ReadonlyMap<string, readonly MemoryRecord[]> = new Map()
  @property({ attribute: false }) openSubject: SubjectResource | null = null
  /**
   * The REVERSE cross-link map (bed rootId → the run that minted its head). The app
   * shell builds it once from the Walk index; the shell hands it to the Plot surface
   * so a bed can offer "open the Walk" (the rz-open-run intent bubbles through).
   */
  @property({ attribute: false }) mintedBy: ReadonlyMap<string, string> = new Map()

  // ── Bouquet surface props (passed through to <rz-bouquet>) ────────────────────
  /** The opened belief's BOUQUET resource — set when a bloom is open. */
  @property({ attribute: false }) bouquet: BouquetResource | null = null
  /** The opened belief's root id (null = the bouquet index → the Plot grid). */
  @property({ type: String }) bouquetRoot: string | null = null

  // ── Walk surface props (passed through to <rz-walk>) ──────────────────────────
  @property({ type: String }) runId: string | null = null
  @property({ type: Number }) turn: number | null = null
  /** The WALK INDEX (the run list) — set when no run is open. */
  @property({ attribute: false }) walkIndex: WalkIndexResource | null = null
  /** The opened run's WALK resource — set when a run is open. */
  @property({ attribute: false }) walk: WalkResource | null = null

  // ── Greenhouse surface props (passed through to <rz-greenhouse>) ───────────────
  /** The live GREENHOUSE resource (the knobs + meters at the lens). */
  @property({ attribute: false }) greenhouse: GreenhouseResource | null = null
  /** The entity-resolution near-duplicate ghost clusters (the merge affordances). */
  @property({ attribute: false }) ghosts: readonly GhostCluster[] = []

  static styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      color: var(--mn-color-text-primary, #111);
      background: var(--mn-color-surface-base, #fff);
    }
    .shell-wrap {
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }
    .surface-host {
      flex: 1;
      min-height: 0;
    }

    /* ── The shared scrubber (lifted from rz-observatory) ── */
    .scrubber {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 10px 20px 12px;
      border-bottom: 1px solid var(--mn-color-border-subtle, #eee);
    }
    .scrubber-label {
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: 11px;
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .scrubber-date {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      padding: 3px 6px;
      border: 1px solid var(--mn-color-border-default, #e5e7eb);
      border-radius: var(--mn-radius-control, 4px);
      background: var(--mn-color-surface-base, #fff);
      color: inherit;
    }
    .scrubber-lens {
      cursor: pointer;
      padding: 3px 10px;
      border: 1px solid var(--mn-color-border-default, #e5e7eb);
      border-radius: var(--mn-radius-control, 4px);
      background: transparent;
      color: inherit;
      font-size: 12px;
    }
    .scrubber-lens:hover {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent));
    }
    .scrubber-lens.active {
      background: var(--mn-color-surface-accent, #eef2ff);
      border-color: var(--mn-color-border-accent, var(--mn-color-accent));
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      font-weight: 600;
    }
  `

  /** Picking a lens emits `rz-asof` up to the app shell (which re-fetches). */
  private _emitAsof(asof: string | null): void {
    this.dispatchEvent(
      new CustomEvent('rz-asof', { detail: { asof }, bubbles: true, composed: true }),
    )
  }

  /**
   * The active surface body — switched by STATE. Each surface is wrapped in its
   * OWN host `<div>` (the happy-dom child-binding gotcha) so the nested element is
   * never a trailing bare binding. The Plot surface delegates to <rz-observatory>
   * (unchanged); its rz-open/rz-back intents bubble through this host (composed)
   * to the app shell — the shell adds NO handlers, it just lets them pass.
   */
  private bodyTemplate(): TemplateResult {
    if (this.surface === 'walk') {
      return html`<div class="surface-host walk-host">
        <rz-walk
          .runId=${this.runId}
          .turn=${this.turn}
          .index=${this.walkIndex}
          .walk=${this.walk}
          .loading=${this.loading}
          .error=${this.error}
        ></rz-walk>
      </div>`
    }
    if (this.surface === 'greenhouse') {
      return html`<div class="surface-host greenhouse-host">
        <rz-greenhouse
          .greenhouse=${this.greenhouse}
          .ghosts=${this.ghosts}
          .asof=${this.asof}
          .loading=${this.loading}
          .error=${this.error}
        ></rz-greenhouse>
      </div>`
    }
    if (this.surface === 'bouquet') {
      // A belief is OPEN → the constellation reader (rz-bouquet). At the index level
      // (no bouquetRoot) the readable beliefs are the SAME Plot grid — opening a bed
      // there bubbles rz-open, which the app shell routes to a bouquet-subject (so the
      // Plot bed drill-down DEEP-LINKS into the Bouquet, no island).
      if (this.bouquetRoot) {
        return html`<div class="surface-host bouquet-host">
          <rz-bouquet
            .rootId=${this.bouquetRoot}
            .bouquet=${this.bouquet}
            .asof=${this.asof}
            .loading=${this.loading}
            .error=${this.error}
          ></rz-bouquet>
        </div>`
      }
      return html`<div class="surface-host bouquet-index-host">
        <rz-observatory
          .plot=${this.plot}
          .chains=${this.chains}
          .openSubject=${null}
          .mintedBy=${this.mintedBy}
          .asof=${this.asof}
          .loading=${this.loading}
          .error=${this.error}
        ></rz-observatory>
      </div>`
    }
    return html`<div class="surface-host plot-host">
      <rz-observatory
        .plot=${this.plot}
        .chains=${this.chains}
        .openSubject=${this.openSubject}
        .mintedBy=${this.mintedBy}
        .ghosts=${this.ghosts}
        .asof=${this.asof}
        .loading=${this.loading}
        .error=${this.error}
      ></rz-observatory>
    </div>`
  }

  render(): TemplateResult {
    return html`
      <div class="shell-wrap" data-shell data-surface=${this.surface}>
        <div class="scrubber-host">${scrubberView(this.asof, (asof) => this._emitAsof(asof))}</div>
        ${this.bodyTemplate()}
      </div>
    `
  }
}

// Keep the surface element types referenced (the upgrade seam imports them).
export type { RzObservatory, RzWalk, RzBouquet, RzGreenhouse }

declare global {
  interface HTMLElementTagNameMap {
    'rz-shell': RzShell
  }
}
