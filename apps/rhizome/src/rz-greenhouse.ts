/**
 * rz-greenhouse — THE GREENHOUSE surface (the cultivation knobs).
 *
 * The fourth RHIZOME surface: where the agent's cognition is TUNED. A CONTROLLED Lit
 * element (the same discipline as rz-bouquet / rz-observatory): the shell (main.ts)
 * reads live via greenhouse-world (the knobs + meters) + entity-resolution (the ghost
 * clusters), sets the props, and this element composes the pure greenhouse-views over
 * them. It emits intents the shell fulfils:
 *   - `rz-merge`   detail:{ recIris } — a MERGE-GHOST [merge] was activated (the REAL
 *                  entity-resolution write → re-read → the meter collapses 3→1).
 *   - `rz-unmerge` detail:{ recIris } — the reverse (DELETE the sameSubjectAs edges).
 *
 * THE ERGONOMICS LIVE HERE (the CSS makes the Bouquet's human-factors checklist
 * pixels — the SAME P-vocabulary so the surfaces read as one family):
 *   P0  the marquee miss-meter is the LARGEST + BRIGHTEST + most-whitespace element,
 *       alone in an accent (or DANGER) band; it wins the blur/squint test.
 *   P1/P2  each knob FAMILY is a tinted enclosed common-region zone in a STABLE order.
 *   P3  overview → details — knobs are one-line gists; axes/laws/why expand on demand.
 *   P5/P6  demotion + the host's staged transition on an as-of change.
 *   P7  clean = quiet (a green tick), full weight only on a FLAGGING meter.
 *
 * Danger uses the DANGER ROLE TOKENS (--mn-color-danger / -surface / -border), never
 * hex. Glyphs are lucide icon() (never emoji). It owns NO data path — no fetch, no
 * SPARQL; the merge is done by the shell via the data layer (the one write site).
 *
 * happy-dom gotcha (verified, see rz-observatory): each nested view is wrapped in its
 * OWN host `<div>` so the `${…}` is the sole child of an element.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { iconStyles } from '@shrubbery/components'
import '@shrubbery/components'
import type { GreenhouseResource } from '@shrubbery/render'
import { greenhouseView, type GhostCluster } from './greenhouse-views.js'

@customElement('rz-greenhouse')
export class RzGreenhouse extends LitElement {
  /** The live GREENHOUSE resource (the knobs + meters at the lens). */
  @property({ attribute: false }) greenhouse: GreenhouseResource | null = null
  /** The detected near-duplicate ghost clusters (the EntRes merge affordances). */
  @property({ attribute: false }) ghosts: readonly GhostCluster[] = []
  /** The cross-surface as-of lens (ISO date), or null = now. */
  @property({ type: String }) asof: string | null = null
  /** Whether a read/write is in flight. */
  @property({ type: Boolean }) loading = false
  /** A live read error to surface verbatim (NO faked fallback). */
  @property({ type: String }) error = ''

  static styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      color: var(--mn-color-text-primary, #111);
      background: var(--mn-color-surface-base, #fff);
    }
    .wrap {
      padding: 16px 24px 56px;
      max-width: 1040px;
      margin: 0 auto;
    }
    code {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 0.9em;
    }
    .gh-muted {
      color: var(--mn-color-text-muted, #9ca3af);
    }

    /* ── The header — a QUIET eyebrow, NOT a second focal point (A1/P0). ───────── */
    .gh-header {
      margin-bottom: 16px;
    }
    .gh-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 2px;
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    .gh-eyebrow .mn-icon {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    .gh-title {
      font-size: var(--mn-text-sm, 13px);
      font-weight: 400;
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .gh-lens {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-sm, 13px);
      margin: 2px 0;
    }

    /* ════════════════════════════════════════════════════════════════════════
       P0 — THE MARQUEE MISS-METER. The single dominant element: largest type,
       highest contrast, the most whitespace, top of order, alone in its band. A
       FLAGGING meter wears the DANGER role tokens (carmine surface + border); a
       clean one demotes to the accent band (P7).
       ════════════════════════════════════════════════════════════════════════ */
    .gh-marquee {
      margin: 0 0 28px;
      padding: 18px 22px;
      border-radius: var(--mn-radius-surface, 4px);
      border: var(--mn-rule-frame, 1px solid var(--mn-color-border-strong, #ccc));
      border-left: 4px solid var(--mn-color-border-accent, var(--mn-color-accent));
      background: var(--mn-color-surface-accent, var(--mn-color-surface-raised, #fff));
    }
    /* P0/A3 — the DANGER state is REDUNDANT: surface + border + the verdict glyph +
       the offender copy, never colour alone. The carmine semantic set, NOT hex. */
    .gh-marquee-danger {
      border-color: var(--mn-color-danger-border, var(--mn-color-danger, #fecaca));
      border-left-color: var(--mn-color-danger, #be123c);
      background: var(--mn-color-danger-surface, color-mix(in srgb, var(--mn-color-danger, #be123c) 8%, transparent));
    }
    .gh-marquee-eyebrow {
      display: flex;
      align-items: center;
      gap: 8px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 600;
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    .gh-marquee-danger .gh-marquee-eyebrow {
      color: var(--mn-color-danger, #991b1b);
    }
    .gh-marquee-glyph,
    .gh-marquee-star {
      display: inline-flex;
    }
    .gh-marquee-star {
      font-size: var(--mn-text-sm, 13px);
    }
    .gh-marquee-name {
      flex: 1;
      font-size: var(--mn-text-2xs, 10px);
    }
    .gh-marquee-family {
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .gh-marquee-effect {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 12px 0 8px;
    }
    /* THE VERDICT — the single largest string in the view (P0). Blur the page → only
       "UNDER-SUPERSEDING" / "clean" survives. */
    .gh-marquee-verdict {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: var(--mn-text-xl, 20px);
      font-weight: 600;
    }
    .gh-marquee-verdict.danger {
      color: var(--mn-color-danger, #991b1b);
    }
    .gh-marquee-verdict.ok {
      color: var(--mn-color-success, #15803d);
    }
    /* THE OFFENDERS — the verbatim culprits a RED meter names (the proof). */
    .gh-marquee-offenders {
      list-style: none;
      margin: 4px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .gh-offender {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-sm, 13px);
      color: var(--mn-color-danger, #991b1b);
      font-weight: 500;
    }
    .gh-marquee-clean {
      margin: 4px 0 0;
      color: var(--mn-color-success, #15803d);
      font-size: var(--mn-text-sm, 13px);
    }
    .gh-marquee-meterline {
      margin: 8px 0 0;
      font-size: var(--mn-text-sm, 13px);
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .gh-marquee-more {
      margin-top: 12px;
    }

    /* ── THE VU METER — composed from token-driven cells (no mn-meter component). ── */
    .gh-vu {
      display: inline-flex;
      gap: 2px;
      align-items: center;
    }
    .gh-vu-cell {
      width: 8px;
      height: 16px;
      border-radius: 1px;
      background: var(--mn-color-surface-sunken, rgba(0, 0, 0, 0.06));
      border: 1px solid var(--mn-color-border-subtle, #eee);
    }
    .gh-vu-cell.on {
      background: var(--mn-color-accent, #6366f1);
      border-color: var(--mn-color-border-accent, var(--mn-color-accent));
    }
    .gh-vu-danger .gh-vu-cell.on {
      background: var(--mn-color-danger, #be123c);
      border-color: var(--mn-color-danger-border, var(--mn-color-danger));
    }
    .gh-vu-ok .gh-vu-cell.on {
      background: var(--mn-color-success, #16a34a);
    }

    /* ════════════════════════════════════════════════════════════════════════
       P1/P2 — THE FAMILIES: tinted enclosed common-region zones in a stable order.
       Each reads as one block by enclosure + a family glyph + a heading + tone.
       ════════════════════════════════════════════════════════════════════════ */
    .gh-families {
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .gh-family {
      padding: 14px 16px;
      background: var(--mn-color-surface-sunken, rgba(0, 0, 0, 0.03));
      border-radius: var(--mn-radius-surface, 4px);
      border-left: 2px solid var(--mn-color-border-default, #e5e7eb);
    }
    .gh-family-judgment {
      border-left-color: var(--mn-color-border-accent, var(--mn-color-accent));
    }
    .gh-family-head {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 0 0 10px;
      font-size: var(--mn-text-sm, 13px);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .gh-family-head .mn-icon {
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .gh-family-knobs {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* ── ONE KNOB row (the lower register, P0). ───────────────────────────────── */
    .gh-knob {
      padding: 8px 0;
      border-top: var(--mn-rule-hair, 1px solid var(--mn-color-border-subtle, #f3f4f6));
    }
    .gh-knob:first-child {
      border-top: none;
    }
    .gh-knob-head {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .gh-knob-glyph {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      display: inline-flex;
    }
    .gh-knob-title {
      flex: 1;
      font-size: var(--mn-text-sm, 13px);
      font-weight: 600;
      color: var(--mn-color-text-primary, #111);
    }
    .gh-knob-body {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-top: 4px;
      flex-wrap: wrap;
    }
    .gh-knob-value {
      font-size: var(--mn-text-sm, 13px);
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .gh-knob-meter {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .gh-knob-meter-val {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: var(--mn-text-xs, 12px);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
    }
    .gh-knob-meter.ok .gh-knob-meter-val {
      color: var(--mn-color-success, #15803d);
    }
    .gh-knob-meter.danger .gh-knob-meter-val {
      color: var(--mn-color-danger, #991b1b);
    }
    /* NOT-YET-MEASURED — a quiet muted state, NOT a confident green tick (P7). */
    .gh-knob-meter.unmeasured .gh-knob-meter-val {
      color: var(--mn-color-text-muted, #9ca3af);
      font-style: italic;
    }
    .gh-knob-more,
    .gh-marquee-more {
      margin-top: 6px;
    }

    /* ── The WRITE-MODE badge (P7 — quiet, never alarm weight). ───────────────── */
    .gh-write {
      font-size: var(--mn-text-2xs, 10px);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-radius: 999px;
      padding: 1px 7px;
      border: 1px solid var(--mn-color-border-subtle, #eee);
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .gh-write-live {
      color: var(--mn-color-success, #15803d);
      border-color: var(--mn-color-success, #16a34a);
    }
    .gh-write-staged {
      color: var(--mn-color-text-muted, #9ca3af);
    }

    /* ── Axes, choices, laws, provenance — the quiet on-demand layers (P3/P4). ─── */
    .gh-axes,
    .gh-laws,
    .gh-ghosts {
      list-style: none;
      margin: 6px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .gh-axis,
    .gh-law {
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
      font-size: var(--mn-text-xs, 12px);
    }
    .gh-axis-key,
    .gh-law-kind {
      min-width: 16ch;
      color: var(--mn-color-text-secondary, #4b5563);
      font-weight: 500;
    }
    .gh-axis-choices {
      display: inline-flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    .gh-axis-choice {
      padding: 0 6px;
      border-radius: var(--mn-radius-control, 4px);
      border: 1px solid var(--mn-color-border-subtle, #eee);
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-2xs, 10px);
    }
    .gh-axis-choice.active {
      background: var(--mn-color-surface-accent, #eef2ff);
      border-color: var(--mn-color-border-accent, var(--mn-color-accent));
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      font-weight: 600;
    }
    .gh-axis-locked .gh-axis-key {
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .gh-axis-lock {
      color: var(--mn-color-warning, #d97706);
      display: inline-flex;
    }
    .gh-axis-note,
    .gh-law-detail {
      color: var(--mn-color-text-muted, #9ca3af);
      font-style: italic;
      flex: 1;
      min-width: 12ch;
    }
    .gh-law-rule {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .gh-law-more,
    .gh-knob-more,
    .gh-marquee-more,
    .gh-law-more {
      display: inline;
    }
    .gh-more-summary {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      list-style: none;
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-2xs, 10px);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .gh-more-summary::-webkit-details-marker {
      display: none;
    }
    .gh-more-summary:hover {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    .gh-prov,
    .gh-choices {
      margin: 6px 0 0;
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #9ca3af);
    }

    /* ════════════════════════════════════════════════════════════════════════
       THE ENTITY-RESOLUTION control (§4b, the LIVE one) — the merge affordances.
       ════════════════════════════════════════════════════════════════════════ */
    .gh-entres-meter {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 6px 0;
      flex-wrap: wrap;
    }
    .gh-knob-label {
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-secondary, #4b5563);
      font-weight: 500;
    }
    .gh-ghost {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      font-size: var(--mn-text-sm, 13px);
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .gh-ghost-glyph {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      display: inline-flex;
    }
    .gh-ghost-text {
      flex: 1;
      min-width: 16ch;
    }
    .gh-ghost-merged .gh-ghost-text {
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .gh-merge-btn {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border: 1px solid var(--mn-color-border-accent, var(--mn-color-accent));
      border-radius: var(--mn-radius-control, 4px);
      background: var(--mn-color-surface-accent, #eef2ff);
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      font-family: inherit;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
    }
    .gh-merge-btn:hover {
      background: var(--mn-color-accent, #6366f1);
      color: var(--mn-color-surface-base, #fff);
    }
    .gh-unmerge-btn {
      border-color: var(--mn-color-border-default, #e5e7eb);
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .gh-unmerge-btn:hover {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent));
      background: transparent;
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    .gh-ghosts-empty {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 4px 0;
      color: var(--mn-color-success, #15803d);
      font-size: var(--mn-text-xs, 12px);
    }

    /* ── Status (loading / error) — error via DANGER ROLE TOKENS (skin-aware). ── */
    .status {
      padding: 10px 12px;
      border-radius: var(--mn-radius-surface, 6px);
      font-size: var(--mn-text-sm, 13px);
      margin: 12px 0;
    }
    .status.err {
      background: var(--mn-color-danger-surface, color-mix(in srgb, var(--mn-color-danger, #be123c) 10%, transparent));
      color: var(--mn-color-danger, #991b1b);
      border: 1px solid var(--mn-color-danger-border, var(--mn-color-danger, #fecaca));
      white-space: pre-wrap;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
    }
    .status.loading {
      color: var(--mn-color-text-muted, #9ca3af);
    }
    ${unsafeCSS(iconStyles)}
  `

  /** A MERGE-GHOST [merge] was activated → the REAL entity-resolution write. */
  private _merge(c: GhostCluster): void {
    this.dispatchEvent(
      new CustomEvent('rz-merge', { detail: { recIris: c.recIris }, bubbles: true, composed: true }),
    )
  }

  /** The reverse — DELETE the sameSubjectAs edges of a merged cluster. */
  private _unmerge(c: GhostCluster): void {
    this.dispatchEvent(
      new CustomEvent('rz-unmerge', { detail: { recIris: c.recIris }, bubbles: true, composed: true }),
    )
  }

  private bodyTemplate(): TemplateResult | typeof nothing {
    if (this.greenhouse) {
      return html`<div class="view-host greenhouse-host">
        ${greenhouseView(
          this.greenhouse,
          this.ghosts,
          (c) => this._merge(c),
          (c) => this._unmerge(c),
        )}
      </div>`
    }
    if (!this.error && !this.loading) {
      return html`<div class="status loading" data-greenhouse-empty>no climate read yet</div>`
    }
    return nothing
  }

  render(): TemplateResult {
    const loading = this.loading
      ? html`<div class="status loading">reading the climate…</div>`
      : nothing
    const error = this.error
      ? html`<div class="status err">read error (NO fallback — the real error):
${this.error}</div>`
      : nothing
    return html`
      <div class="wrap">
        <div class="status-host">${loading}</div>
        <div class="status-host">${error}</div>
        <div class="body-host">${this.bodyTemplate()}</div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rz-greenhouse': RzGreenhouse
  }
}
