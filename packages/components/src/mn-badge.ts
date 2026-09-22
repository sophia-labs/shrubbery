/**
 * mn-badge — Garden-compatible, GENERAL, skin-aware, token-driven badge
 * primitive (optionally a clickable pill that emits a request event).
 *
 * LIFTED from garden's PURE presentation primitive
 *   emporium-port/frontend/src/components/wf/wf-primitives.ts → `wf-integrity-badge`
 * (READ-ONLY source). What was GENERALIZED in the lift:
 *
 *   - DROPPED the workflow INTEGRITY vocabulary. wf-integrity-badge hard-coded a
 *     four-value `IntegrityState` (unanchored/verifying/verified/mismatch), the
 *     sha-anchoring labels ("do not run — content drifted", "sha {…}"), and a
 *     `wf-verify-request` event — all of which are wf: pack consumer concerns. The
 *     badge here carries no integrity semantics: the CALLER supplies the label
 *     (slot/`label`) and chooses the `state` tone.
 *   - REPLACED the hardcoded terracotta mismatch color (#b3401f literal in the
 *     source) with the danger ROLE TOKEN (--mn-color-danger-500), and the
 *     verified green with the success token. Filetype backgrounds also route
 *     through Garden's --mn-color-filetype-* roles, with CSS fallbacks for hosts
 *     that have not installed those tokens yet.
 *   - KEPT the pure presentation shape: a small rounded pill with a leading
 *     glyph + label, an optional `spin` animation (the old "verifying…" ring) and
 *     a one-shot `settle` pop, an `interactive` mode that renders a real <button>
 *     and emits `mn-badge-action`. All geometry routes through the skin role
 *     tokens; the verify-settle / ring-sweep keyframes are preserved as general
 *     motion.
 *
 * SKIN-AWARE via the SkinAware mixin (square shoulders + uppercase under
 * Emporium; rounded + sentence case under Garden). Colors flow through inherited
 * --mn-* tokens — no per-skin color code.
 *
 * Dependencies: lit ONLY. No stores, no wf-model, no backend (island-guarded).
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { classMap } from 'lit/directives/class-map.js'
import { SkinAware } from './skin-aware.js'

/** The semantic state a badge presents (routes to skin role tokens). */
export type MnBadgeState = 'neutral' | 'active' | 'success' | 'warning' | 'danger'
export type MnBadgeVariant =
  | 'default'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'filetype'
export type MnBadgeSize = 'sm' | 'md' | 'lg'
export type MnBadgeFiletype = 'pdf' | 'epub' | 'docx' | 'html' | 'md' | 'txt'

export type BadgeVariant = MnBadgeVariant
export type BadgeSize = MnBadgeSize
export type FiletypeKey = MnBadgeFiletype

@customElement('mn-badge')
export class MnBadge extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      gap: 5px;
      height: 20px;
      padding: 0 var(--mn-space-1-5, 6px);
      border: 1px solid transparent;
      border-radius: var(--mn-radius-default, var(--mn-radius-sm, 4px));
      font-family: var(--mn-type-label-family, var(--mn-font-chrome, system-ui, sans-serif));
      font-size: var(--mn-type-label-size, var(--mn-text-xs, 11px));
      font-weight: var(--mn-type-label-weight, var(--mn-font-weight-medium, 550));
      line-height: var(--mn-type-label-leading, 1);
      color: var(--mn-color-text-muted, #9ca3af);
      background: var(--mn-color-surface-hover, #f3f4f6);
      white-space: nowrap;
      letter-spacing: var(--mn-type-label-tracking, var(--mn-tracking-label, 0));
      text-transform: var(--mn-badge-text-transform, uppercase);
    }
    :host([pill]) .badge {
      border-radius: var(--mn-radius-full, 9999px);
    }
    .size-sm {
      height: 16px;
      padding: 0 var(--mn-space-1, 4px);
      font-size: var(--mn-type-micro-size, var(--mn-text-2xs, 10px));
    }
    .size-md {
      height: 20px;
      padding: 0 var(--mn-space-1-5, 6px);
    }
    .size-lg {
      height: 24px;
      padding: 0 var(--mn-space-2, 8px);
      font-size: var(--mn-type-ui-xs-size, var(--mn-text-xs, 12px));
    }
    /* When interactive, the badge IS a button (clickable, focusable). */
    button.badge {
      cursor: pointer;
      transition: color 0.2s ease, border-color 0.2s ease, background 0.2s ease;
    }
    button.badge:focus-visible {
      outline: 2px solid var(--mn-color-border-focus, var(--mn-color-accent));
      outline-offset: 1px;
    }
    .glyph {
      width: 12px;
      text-align: center;
      line-height: 1;
    }
    /* An empty glyph span (no glyph set) takes no space. */
    .glyph:empty {
      display: none;
    }

    /* spin (the old "verifying…" ring) — a general indeterminate motion. */
    .spin .glyph {
      animation: mn-badge-spin 0.8s linear infinite;
    }
    @keyframes mn-badge-spin {
      to {
        transform: rotate(360deg);
      }
    }
    /* one-shot settle pop (the old verify-settle) — general arrival motion. */
    .settle {
      animation: mn-badge-settle 0.45s ease;
    }
    @keyframes mn-badge-settle {
      0% {
        transform: scale(0.92);
      }
      55% {
        transform: scale(1.06);
      }
      100% {
        transform: scale(1);
      }
    }

    /* Garden core variants. */
    .badge.variant-default {
      color: var(--mn-color-text-secondary, #4b5563);
      border-color: var(--mn-color-border-default, #d1d5db);
      background: var(--mn-color-surface-hover, #f3f4f6);
    }
    .badge.variant-primary {
      color: var(--mn-color-text-on-accent, #fff);
      border-color: var(--mn-color-accent, #2563eb);
      background: var(--mn-color-accent, #2563eb);
    }
    .badge.variant-success {
      color: var(--mn-color-success-strong, #2b6549);
      border-color: var(--mn-color-success-border, var(--mn-color-success, #469c70));
      background: var(--mn-color-success-surface, transparent);
    }
    .badge.variant-warning {
      color: var(--mn-color-warning-strong, #b45309);
      border-color: var(--mn-color-warning-border, var(--mn-color-warning, #d97706));
      background: var(--mn-color-warning-surface, transparent);
    }
    .badge.variant-danger {
      color: var(--mn-color-danger-strong, var(--mn-color-danger, #be123c));
      border-color: var(--mn-color-danger-border, var(--mn-color-danger, #be123c));
      background: var(--mn-color-danger-surface, color-mix(in srgb, var(--mn-color-danger, #be123c) 10%, transparent));
    }
    .badge.variant-info {
      color: var(--mn-color-info-strong, var(--mn-color-text-accent, #2563eb));
      border-color: var(--mn-color-info-border, var(--mn-color-border-accent, #2563eb));
      background: var(--mn-color-info-surface, var(--mn-color-surface-accent, transparent));
    }
    .badge.variant-filetype {
      color: var(--mn-color-filetype-text, #fff);
      border-color: transparent;
      background: var(--mn-color-filetype-default, var(--mn-color-text-tertiary, #6b7280));
    }
    .badge.variant-filetype.filetype-pdf {
      background: var(--mn-color-filetype-pdf, #cc0000);
    }
    .badge.variant-filetype.filetype-epub {
      background: var(--mn-color-filetype-epub, #9933cc);
    }
    .badge.variant-filetype.filetype-docx {
      background: var(--mn-color-filetype-docx, #0066cc);
    }
    .badge.variant-filetype.filetype-html {
      background: var(--mn-color-filetype-html, #ff6600);
    }
    .badge.variant-filetype.filetype-md {
      background: var(--mn-color-filetype-md, #00aa00);
    }
    .badge.variant-filetype.filetype-txt {
      background: var(--mn-color-filetype-txt, #666666);
    }
    :host([outline]) .badge,
    .badge.outline {
      background: transparent;
    }

    /* Shrubbery semantic state tones — each routes to a skin role token. */
    .badge.active {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      border-color: var(--mn-color-border-accent, var(--mn-color-accent));
      background: var(--mn-color-surface-accent, transparent);
    }
    .badge.success {
      color: var(--mn-color-success-strong, #2b6549);
      border-color: var(--mn-color-success-border, var(--mn-color-success, #469c70));
      background: var(--mn-color-success-surface, transparent);
    }
    .badge.warning {
      color: var(--mn-color-warning-strong, #b45309);
      border-color: var(--mn-color-warning-border, var(--mn-color-warning, #d97706));
      background: var(--mn-color-warning-surface, transparent);
    }
    /* danger = the old terracotta mismatch, now a token (figure-ground emphasis). */
    .badge.danger {
      color: var(--mn-color-danger, #be123c);
      border-color: var(--mn-color-danger, #be123c);
      background: var(--mn-color-danger-surface, color-mix(in srgb, var(--mn-color-danger, #be123c) 10%, transparent));
      font-weight: 600;
    }

    /* ── EMPORIUM skin: square shoulders + uppercase (sophia structure) ─────── */
    :host([data-skin='emporium']) .badge {
      border-radius: var(--mn-radius-surface, 4px);
      text-transform: uppercase;
    }
  `

  /** The semantic state (routes to skin role tokens). */
  @property({ type: String, reflect: true }) state: MnBadgeState = 'neutral'
  /** Garden visual variant. */
  @property({ type: String, reflect: true }) variant: MnBadgeVariant = 'default'
  /** Garden badge size. */
  @property({ type: String, reflect: true }) size: MnBadgeSize = 'md'
  /** Garden pill shape. */
  @property({ type: Boolean, reflect: true }) pill = false
  /** Garden outline style. */
  @property({ type: Boolean, reflect: true }) outline = false
  /** Filetype key for `variant="filetype"`. */
  @property({ type: String }) filetype?: MnBadgeFiletype | string
  /** Leading glyph character (e.g. ✓ ⚠ ○ ◌). */
  @property({ type: String }) glyph = ''
  /** Badge label text (a slot may override). */
  @property({ type: String }) label = ''
  /** Native title hint. */
  @property({ type: String }) hint = ''
  /** Render as a clickable <button> that emits `mn-badge-action`. */
  @property({ type: Boolean }) interactive = false
  /** Spin the glyph (an indeterminate / in-progress signal). */
  @property({ type: Boolean }) spin = false
  /** Play the one-shot settle pop (an arrival / just-changed signal). */
  @property({ type: Boolean }) settle = false

  private _emit(): void {
    this.dispatchEvent(new CustomEvent('mn-badge-action', { bubbles: true, composed: true }))
  }

  render() {
    const isFiletype = this.variant === 'filetype'
    const cls = {
      badge: true,
      [`size-${this.size}`]: true,
      [`variant-${this.variant}`]: !isFiletype,
      'variant-filetype': isFiletype,
      [`filetype-${this.filetype}`]: isFiletype && !!this.filetype,
      [this.state]: this.state !== 'neutral',
      outline: this.outline,
      spin: this.spin,
      settle: this.settle,
    }
    // glyph is ALWAYS a span (empty when unset) to avoid a `nothing` part
    // adjacent to the <slot> — happy-dom mis-parses that and drops the slot
    // fallback. The empty span collapses via .glyph:empty.
    const inner = html`<span class="glyph" part="glyph" aria-hidden="true">${this.glyph}</span><slot
        >${this.label}</slot
      >`
    if (this.interactive) {
      return html`
        <button class=${classMap(cls)} part="badge" title=${this.hint || nothing} @click=${this._emit}>
          ${inner}
        </button>
      `
    }
    return html`
      <span class=${classMap(cls)} part="badge" title=${this.hint || nothing}>${inner}</span>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-badge': MnBadge
  }
}
