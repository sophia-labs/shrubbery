/**
 * mn-chip — a GENERAL, skin-aware, token-driven inline chip.
 *
 * LIFTED from garden's PURE presentation primitive
 *   emporium-port/frontend/src/components/wf/wf-primitives.ts → `wf-chip`
 * (READ-ONLY source). What was GENERALIZED in the lift (so it serves Emporium AND
 * beyond, not a workflow one-off):
 *
 *   - DROPPED the workflow vocabulary. wf-chip carried a fixed `variant` set
 *     (tokens/duration/agents/model/state/cached/generic) and imported
 *     `modelGlyph()` from garden's wf-model to derive a model-tier glyph. That is
 *     a CONSUMER concern of the wf: pack, not a general primitive — so the
 *     model-id derivation, the per-variant taxonomy, and the wf-model import are
 *     all gone. None of garden's wf-* viz shells are ported (Vera's rule).
 *   - REPLACED the variant-specific color rules with ONE orthogonal `tone` prop
 *     (neutral | accent | success | warning | danger | muted). Tone routes to the
 *     skin's role tokens — so a chip recolors per skin for FREE (fern in Garden,
 *     purple in Emporium) with NO hardcoded color anywhere. The wf-chip's
 *     hardcoded "terracotta reserved for failure" is now `tone="danger"` →
 *     `--mn-color-danger-500`.
 *   - KEPT the pure presentation shape: a rounded pill, optional leading glyph,
 *     a label, an optional `dashed` outline (the old `cached`/replay look), a
 *     `title` hint. All geometry routes through the skin role tokens
 *     (--mn-radius-full / --mn-radius-control, the density), so the chip is
 *     square + tight under Emporium and rounded + comfortable under Garden.
 *
 * SKIN-AWARE: uses the SkinAware mixin (pure DOM) so :host([data-skin=emporium])
 * can apply the square-shoulder structural rule and the chip consumes the skin's
 * radius / font role tokens. Colors flow in through inherited --mn-* custom
 * properties — there is NO per-skin color code here.
 *
 * Dependencies: lit ONLY. No stores, no wf-model, no backend (island-guarded).
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'

/** The orthogonal semantic tone a chip carries (routes to skin role tokens). */
export type MnTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'muted'

@customElement('mn-chip')
export class MnChip extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: inline-flex;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 8px;
      /* Skin radius role: Garden full pill, Emporium square (the radius-control
         under Emporium is 0; full collapses to the surface rounding). */
      border-radius: var(--mn-radius-full, 9999px);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #374151);
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      font-size: var(--mn-text-xs, 11px);
      line-height: 18px;
      white-space: nowrap;
      letter-spacing: var(--mn-tracking-label, 0);
    }
    .glyph {
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: 10px;
      line-height: 1;
    }
    /* An empty glyph span (no glyph set) takes no space and adds no gap. */
    .glyph:empty {
      display: none;
    }

    /* ── Tone — each routes to a skin role token, recolors per skin for free ── */
    .chip.tone-accent {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      border-color: var(--mn-color-border-accent, var(--mn-color-accent));
    }
    .chip.tone-accent .glyph {
      color: var(--mn-color-accent);
    }
    .chip.tone-success {
      color: var(--mn-color-success-strong, #2b6549);
      border-color: var(--mn-color-success-border, var(--mn-color-success, #469c70));
    }
    .chip.tone-success .glyph {
      color: var(--mn-color-success, #469c70);
    }
    .chip.tone-warning {
      color: var(--mn-color-warning-strong, #b45309);
      border-color: var(--mn-color-warning-border, var(--mn-color-warning, #d97706));
    }
    .chip.tone-warning .glyph {
      color: var(--mn-color-warning, #d97706);
    }
    /* danger = the old wf-chip "terracotta reserved for failure", now a token. */
    .chip.tone-danger {
      color: var(--mn-color-danger, #be123c);
      border-color: var(--mn-color-danger, #be123c);
    }
    .chip.tone-danger .glyph {
      color: var(--mn-color-danger, #be123c);
    }
    .chip.tone-muted {
      color: var(--mn-color-text-muted, #9ca3af);
      background: transparent;
    }

    /* Dashed outline — the old cached/replay look, generalized. */
    .chip.dashed {
      border-style: dashed;
      background: transparent;
    }

    /* ── EMPORIUM skin: square shoulders (sophia structure) ─────────────────
       The host mirrors the ambient skin (SkinAware); under Emporium a chip is
       square like every other control. The color is already purple via the
       inherited role tokens — only the SHAPE needs a structural rule. */
    :host([data-skin='emporium']) .chip {
      border-radius: var(--mn-radius-surface, 4px);
      text-transform: uppercase;
    }
  `

  /** Optional leading glyph (a small character / icon). */
  @property({ type: String }) glyph = ''
  /** The chip label text. */
  @property({ type: String }) label = ''
  /** The semantic tone (routes to skin role tokens). */
  @property({ type: String }) tone: MnTone = 'neutral'
  /** Dashed outline + transparent fill (e.g. an inactive / replay chip). */
  @property({ type: Boolean }) dashed = false
  /** Native title hint shown on hover. */
  @property({ type: String }) hint = ''

  render() {
    const classes: Record<string, boolean> = {
      chip: true,
      [`tone-${this.tone}`]: this.tone !== 'neutral',
      dashed: this.dashed,
    }
    // NB: glyph is ALWAYS a span (empty when unset) — avoids a `nothing` part
    // sitting directly before the <slot>, which happy-dom mis-parses (it corrupts
    // the adjacent slot's fallback content). Same reasoning as mn-ribbon's wrap.
    return html`
      <span class=${classMap(classes)} part="chip" title=${this.hint || nothing}>
        <span class="glyph" part="glyph" aria-hidden="true">${this.glyph}</span><slot>${this.label}</slot>
      </span>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-chip': MnChip
  }
}
