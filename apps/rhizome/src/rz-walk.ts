/**
 * rz-walk — THE WALK surface (the turn-by-turn agentic-session view).
 *
 * The Walk renders the agentic-run TRACES (JSONL files at lme-bench/out/runs/
 * agentic-*.trace.jsonl) as a navigable ribbon of turns — the ONE divergence from
 * the Plot's SPARQL data layer (the Walk's source is FILES, served same-origin by
 * the vite /traces middleware; main.ts reads them via TraceClient).
 *
 * A CONTROLLED Lit element (the same discipline as rz-observatory / rz-bouquet):
 * the shell (main.ts) fetches the trace and sets the resource props (`index` = the
 * run list, or `walk` = one run); the element composes the pure walk-views
 * (walkIndexView / walkView) over the @shrubbery/render WALK shapes and emits
 * intents the shell fulfils by re-fetching + navigating:
 *   - `rz-open-run` detail:{ runId } — a run card was activated (open its ribbon).
 *   - `rz-turn`     detail:{ turn }  — a turn was selected (the ?turn lens).
 *   - `rz-back`                      — return from a run to the run list.
 *
 * THE ERGONOMICS LIVE HERE (the CSS is where the BOUQUET's human-factors checklist
 * becomes pixels — this surface is held to the constellation reader's bar, the SAME
 * P-vocabulary so the three surfaces read as one family; the exemplar is
 * rz-bouquet.ts / bouquet-views.ts):
 *   P0  ONE dominant focal point — per turn `.wk-reasoning` (the think) is the
 *       largest + highest-contrast + most-whitespace datum (it wins the turn's
 *       blur/squint test); the phase eyebrow + the verbose args/results are a
 *       visibly lower register. At the RUN level the FINAL answer is the focal
 *       flower (an accent band), NOT a Q/Gold/Final stack.
 *   P1/P2  Gestalt grouping by PHASE via common-region zones (think / act-observe)
 *       in a STABLE skeleton, redundant (zone + glyph + tone), never colour alone;
 *       rule-WEIGHT separates groups, not heavy boxes (P7: no chartjunk). The one
 *       explicit connecting LINE is spent on the supersession edges (the lineage).
 *   P3/P4  the verbose tool ARGS + the tool RESULT (the raw <pre> walls) are quiet
 *       <details> reveals (overview at rest, detail on demand); the supersede "why"
 *       is a muted adjacent layer.
 *   P5  the SUPERSEDE moment / the run edges demote the OLD record redundantly
 *       (fade + strike + the short-id), the NEW one stays bright.
 *   P6  OBJECT CONSTANCY on the ?turn lens change — ONE subtle staged transition
 *       plays the lensed turn (`_arrived`), honouring prefers-reduced-motion.
 *   P7  ABSENT content (empty reasoning, no tool calls, no edges) is a quiet
 *       one-liner, never a full-weight empty zone.
 *
 * It owns NO data path — no fetch, no FS. Registered as a side effect (the upgrade
 * seam) so the shell can swap it into the body region. When nothing is loaded yet
 * it shows an honest status (NO faked trace). Danger/error uses the DANGER ROLE
 * TOKENS (NOT hardcoded hex) so it tracks the Emporium dark-purple skin; all glyphs
 * are lucide icon() (never emoji); all colour / space / radius / type via --mn-*.
 *
 * happy-dom gotcha (verified, see rz-observatory): each nested view is wrapped in
 * its OWN host `<div>` so the `${…}` is the sole child of an element, never a
 * trailing bare child-binding (which happy-dom's lit drops when nested).
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { icon, iconStyles } from '@shrubbery/components'
import '@shrubbery/components'
import type { WalkIndexResource, WalkResource } from '@shrubbery/render'
import { walkIndexView, walkView } from './walk-views.js'

@customElement('rz-walk')
export class RzWalk extends LitElement {
  /** The opened run (a trace file id), or null = the walk index. */
  @property({ type: String }) runId: string | null = null
  /** The current turn cursor within the run, or null = the whole run. */
  @property({ type: Number }) turn: number | null = null

  /** The WALK INDEX (the run list), set by the shell when no run is open. */
  @property({ attribute: false }) index: WalkIndexResource | null = null
  /** The opened run's WALK resource, set by the shell when a run is open. */
  @property({ attribute: false }) walk: WalkResource | null = null
  /** Whether a trace read is in flight. */
  @property({ type: Boolean }) loading = false
  /** A live read error to surface verbatim (NO faked fallback). */
  @property({ type: String }) error = ''

  /**
   * One-shot arrival flag (P6, object constancy). Set true for ~0.8s whenever the
   * ?turn LENS changes (a new cursor that re-positions the ribbon) so the lensed
   * turn plays a single staged rise-into-focus pop, then clears — the user TRACKS
   * what changed instead of the ribbon silently swapping. Reduced-motion users get
   * an instant swap (the keyframe is gated on the media query). `@state` → reactive.
   */
  @state() private _arrived = false
  /** The cursor the LAST render resolved at — to detect a ?turn change (the beat). */
  private _lastTurn: number | null | undefined = undefined
  private _arrivedTimer: ReturnType<typeof setTimeout> | null = null

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
      padding: 16px 20px 48px;
      max-width: 1100px;
      margin: 0 auto;
    }
    code {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 0.9em;
    }

    .back-btn {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border: 1px solid var(--mn-color-border-default, #e5e7eb);
      border-radius: var(--mn-radius-control, 4px);
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-xs, 12px);
      margin-bottom: 12px;
    }
    .back-btn:hover {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent));
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }

    /* ════════════════════════════════════════════════════════════════════════
       P0/P4 — THE RUN HEADER is a QUIET orienting band, NOT a stack of equal-weight
       rows. The title used to be an h1 + a Q/Gold/Final stack where the gold + the
       question competed with the answer; the header is now a muted eyebrow + the
       question/gold as a low-contrast layer, and the FINAL answer is the focal
       flower below it (blur the run → only .walk-final-content survives).
       ════════════════════════════════════════════════════════════════════════ */
    .walk-header {
      margin-bottom: 14px;
    }
    .walk-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 4px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 600;
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    .walk-eyebrow .mn-icon {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    .walk-q,
    .walk-gold,
    .walk-lens,
    .walk-summary,
    .walk-count {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-sm, 13px);
      margin: 2px 0;
    }
    .walk-summary,
    .walk-count {
      color: var(--mn-color-text-muted, #9ca3af);
    }
    /* The Q/gold keys — a quiet uppercase eyebrow label per row (P4), not a bold
       inline run-in that competed with the question text. */
    .walk-q-key {
      display: inline-block;
      min-width: 3em;
      margin-right: 6px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 600;
      color: var(--mn-color-text-muted, #9ca3af);
    }

    /* ════════════════════════════════════════════════════════════════════════
       P0 — THE FINAL ANSWER: the single dominant RUN-level datum. An accent flower
       (the emporium rule-frame + a tinted band + the accent edge tying it to the
       lineage rail), the largest + highest-contrast string. Blur → only this.
       ════════════════════════════════════════════════════════════════════════ */
    .walk-final-focus {
      margin: 0 0 14px;
    }
    .walk-final-flower {
      padding: 14px 16px;
      border: var(--mn-rule-frame, 1px solid var(--mn-color-border-strong, #ccc));
      border-left: 3px solid var(--mn-color-border-accent, var(--mn-color-accent));
      border-radius: var(--mn-radius-surface, 4px);
      background: var(--mn-color-surface-accent, var(--mn-color-surface-raised, #fff));
    }
    .walk-final-cap {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 4px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 600;
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    .walk-final-cap .mn-icon {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    .walk-final-content {
      font-size: var(--mn-text-xl, 20px);
      font-weight: 600;
      line-height: 1.3;
      color: var(--mn-color-text-primary, #111);
      margin: 0;
    }
    /* P6 — object constancy: the focal flower rises on a ?turn lens change. */
    .arrived .walk-final-flower {
      animation: wk-rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    @keyframes wk-rise {
      0% {
        transform: translateY(6px) scale(0.99);
        opacity: 0.5;
      }
      100% {
        transform: translateY(0) scale(1);
        opacity: 1;
      }
    }

    /* ── P1/P5 — THE RUN-LEVEL SUPERSESSION EDGES: the one true sequence — the
       struck OLD record demotes (fade + strike + short-id), the NEW stays bright,
       on a connecting rail. Folds behind a count handle when there are many (P3);
       an empty edge set is a quiet one-liner (P7), never a full accent zone. ───── */
    .walk-edges {
      margin: 0 0 14px;
      padding: 12px 14px;
      background: var(--mn-color-surface-sunken, rgba(0, 0, 0, 0.03));
      border-radius: var(--mn-radius-surface, 4px);
      border-left: 2px solid var(--mn-color-border-accent, var(--mn-color-accent));
    }
    .walk-edges-fold > summary {
      list-style: none;
      cursor: pointer;
    }
    .walk-edges-fold > summary::-webkit-details-marker {
      display: none;
    }
    .walk-edge-rows {
      position: relative;
      list-style: none;
      margin: 8px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 7px;
    }
    /* The supersession rail — ONE line down the edges (Gestalt connectedness, the
       most expensive cue, spent on the one true sequence). */
    .walk-edge-rows::before {
      content: '';
      position: absolute;
      left: 3px;
      top: 7px;
      bottom: 7px;
      width: 0;
      border-left: 1.5px solid var(--mn-color-border-accent, var(--mn-color-accent));
      opacity: 0.5;
    }
    .walk-edge {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding-left: 16px;
      font-size: var(--mn-text-sm, 13px);
    }
    .walk-edge-rail {
      position: absolute;
      left: 0;
      top: 0.6em;
      width: 7px;
      height: 0;
      border-top: 1.5px solid var(--mn-color-border-accent, var(--mn-color-accent));
      opacity: 0.5;
    }
    /* The NEW record — bright (text-accent), the live end of the edge. */
    .walk-edge-new {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      font-size: var(--mn-text-xs, 12px);
    }
    .walk-edge-arrow {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: var(--mn-text-2xs, 10px);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--mn-color-text-muted, #9ca3af);
    }
    /* The OLD record — demoted REDUNDANTLY (fade + strike + the short-id), so the
       new→old relation reads in grayscale / for colourblind users (P5). */
    .walk-edge-old {
      color: var(--mn-color-text-muted, #9ca3af);
      opacity: 0.7;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
    }
    /* P7 — an absent edge set is a quiet one-liner OUTSIDE any well. */
    .walk-edges-absent {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 14px;
      padding: 2px 0;
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-xs, 12px);
    }
    .walk-edges-absent .mn-icon {
      color: var(--mn-color-text-muted, #9ca3af);
    }

    /* ════════════════════════════════════════════════════════════════════════
       THE RIBBON — one run as a column of turn cards (P2: a stable skeleton).
       ════════════════════════════════════════════════════════════════════════ */
    .ribbon {
      display: flex;
      flex-direction: column;
      gap: 14px;
      margin-top: 14px;
    }
    /* The whole turn card wears the accent rail ONLY when it carries the supersede
       moment (the one true sequence) — otherwise it is a plain card (no chartjunk). */
    .wk-turn-supersede::part(card) {
      border-left: 3px solid var(--mn-color-border-accent, var(--mn-color-accent));
    }
    /* P0/P4 — the turn header is a QUIET eyebrow (phase + index), a register below
       the reasoning; only the supersede badge is bright. */
    .wk-turn-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .wk-turn-eyebrow {
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 600;
      color: var(--mn-color-text-muted, #9ca3af);
    }

    /* ── P1 — COMMON-REGION ZONES: think / act-observe. A quiet zone caption
       (a kind glyph + an uppercase label) names each region; the think zone holds
       the focal reasoning, the act zone holds the folded calls. ──────────────── */
    .wk-zone-cap {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .wk-zone-cap .mn-icon {
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .wk-think {
      margin: 4px 0 14px;
    }
    /* THE REASONING — the FOCAL datum of the turn (P0): the highest-contrast,
       largest body string, the most whitespace — it alone holds text-primary, so it
       wins the turn's blur test on VALUE as well as size. It is only 2px above the
       surrounding text-sm, so a modest weight bump (500) + extra line-height/whitespace
       carry the focal work decisively, the think layer winning each turn's squint
       test rather than tying with the chrome around it. */
    .wk-reasoning {
      margin: 0;
      font-size: var(--mn-text-base, 15px);
      line-height: 1.55;
      font-weight: 500;
      color: var(--mn-color-text-primary, #111);
    }
    .wk-reasoning-empty {
      margin: 0;
      color: var(--mn-color-text-muted, #9ca3af);
      font-style: italic;
      font-size: var(--mn-text-sm, 13px);
    }
    /* The act-observe common-region — a sunken well so the calls group
       preattentively (P1), a register BELOW the reasoning. */
    .wk-act {
      margin: 8px 0 4px;
      padding: 10px 12px;
      background: var(--mn-color-surface-sunken, rgba(0, 0, 0, 0.03));
      border-radius: var(--mn-radius-surface, 4px);
      border-left: 2px solid var(--mn-color-border-default, #e5e7eb);
    }
    .wk-calls {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 4px;
    }
    .wk-call {
      border-left: 2px solid var(--mn-color-border-subtle, #eee);
      padding-left: 10px;
    }
    /* The supersede call earns the accent rail (the one true sequence, P5). */
    .wk-call-supersede {
      border-left-color: var(--mn-color-border-accent, var(--mn-color-accent));
    }
    .wk-call-head {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
      margin-bottom: 2px;
    }
    .wk-call-glyph {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      display: inline-flex;
    }
    .wk-call-name {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      color: var(--mn-color-text-secondary, #4b5563);
    }
    /* P4 — the supersede annotation is a quiet integrated tag beside its claim, not
       a distant legend; the full "why" rides on the title= hover. */
    .wk-call-supersede-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      font-size: var(--mn-text-2xs, 10px);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /* ── P3 — THE FOLDS: the verbose tool ARGS + the tool RESULT (the raw <pre>
       walls) are details-on-demand. At rest the summary is the one-line gist (the
       tool's args/result preview); the wall opens on demand only. ─────────────── */
    .wk-fold {
      margin: 2px 0;
    }
    .wk-fold > summary {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      list-style: none;
      padding: 2px 0;
    }
    .wk-fold > summary::-webkit-details-marker {
      display: none;
    }
    .wk-fold-summary .mn-icon {
      color: var(--mn-color-text-muted, #9ca3af);
      flex: 0 0 auto;
      transition: transform 0.15s ease;
    }
    .wk-fold[open] > summary .mn-icon {
      transform: rotate(90deg);
    }
    .wk-fold-label {
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #9ca3af);
      flex: 0 0 auto;
    }
    /* The one-line peek — a muted mono preview of the folded payload (the gist). */
    .wk-fold-peek {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .wk-args,
    .wk-result-body {
      margin: 4px 0 0;
      padding: 8px 10px;
      border-radius: var(--mn-radius-control, 4px);
      background: var(--mn-color-surface-base, #fff);
      border: 1px solid var(--mn-color-border-subtle, #eee);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 11px;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-x: auto;
    }
    .wk-result {
      margin-top: 4px;
    }
    /* P5/A3 — an ERROR result via the DANGER ROLE TOKENS (skin-aware), redundant
       with the alert glyph + the "error" label, never colour-alone, never raw hex. */
    .wk-result-glyph {
      color: var(--mn-color-danger, #be123c);
      display: inline-flex;
    }
    .wk-result-err .wk-result-body {
      border-color: var(--mn-color-danger-border, var(--mn-color-danger, #fecaca));
      background: var(--mn-color-danger-surface, color-mix(in srgb, var(--mn-color-danger, #be123c) 10%, transparent));
      color: var(--mn-color-danger, #991b1b);
    }
    .wk-no-calls {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-muted, #9ca3af);
      font-style: italic;
      margin: 6px 0;
    }
    .wk-no-calls .mn-icon {
      color: var(--mn-color-text-muted, #9ca3af);
    }

    /* The per-turn usage — the quietest layer, a muted chip row. */
    .wk-usage {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    /* A shared count handle (the run-edges fold + the act count). */
    .wk-count {
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 600;
      color: var(--mn-color-text-muted, #9ca3af);
      border: 1px solid var(--mn-color-border-subtle, #eee);
      border-radius: var(--mn-radius-control, 4px);
      padding: 0 6px;
      letter-spacing: 0;
    }

    /* ── P6: object constancy — the lensed turn rises on a ?turn change (one staged
       pop). The 'arrived' class is on the .walk-host wrapper (rz-walk sets it for
       ~0.8s on a change); the turn card is the descendant that animates. ─────── */
    .arrived .wk-turn::part(card) {
      animation: wk-rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    /* A6 / accessibility: reduced-motion users get an instant swap (no motion). */
    @media (prefers-reduced-motion: reduce) {
      .arrived .walk-final-flower,
      .arrived .wk-turn::part(card) {
        animation: none;
      }
    }

    /* ── The run list (the walk index) — P0: the question is the focal row datum. ── */
    .run-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 14px;
      margin-top: 12px;
    }
    .run-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .run-q {
      font-weight: 600;
      color: var(--mn-color-text-primary, #111);
    }
    .run-final {
      margin: 6px 0;
      font-size: var(--mn-text-sm, 13px);
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .run-meta {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }
    .run-id {
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-2xs, 10px);
    }
    .run-empty {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--mn-color-text-muted, #9ca3af);
      font-style: italic;
      font-size: var(--mn-text-sm, 13px);
    }
    .run-empty .mn-icon {
      color: var(--mn-color-text-muted, #9ca3af);
    }

    /* ── Status (loading / error) — error via DANGER ROLE TOKENS (skin-aware), NOT
       hardcoded hex, so it tracks the Emporium dark-purple theme. ─────────────── */
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

  /**
   * A card was activated. A RUN card (the index, data-run) opens its ribbon
   * (rz-open-run); a TURN card (the ribbon, data-turn) focuses the ?turn lens
   * (rz-turn) — toggling it off when the lens is already on that turn.
   */
  private _onCardActivate(e: Event): void {
    // A click that COMPLETES a text selection (drag-to-copy) also fires the card's
    // activate. Don't toggle the lens then — otherwise highlighting text inside a
    // step collapses it. (Shadow DOM: prefer the renderRoot's selection, which is
    // where the slotted card content lives, and fall back to the window selection.)
    const shadowSel = (
      this.renderRoot as ShadowRoot & { getSelection?: () => Selection | null }
    ).getSelection?.()
    const selText = (shadowSel?.toString() ?? window.getSelection?.()?.toString() ?? '').trim()
    if (selText.length > 0) return

    const path = e.composedPath()
    const runEl = path.find(
      (n) => n instanceof HTMLElement && n.hasAttribute('data-run'),
    ) as HTMLElement | undefined
    const runId = runEl?.getAttribute('data-run')
    if (runId) {
      this.dispatchEvent(
        new CustomEvent('rz-open-run', { detail: { runId }, bubbles: true, composed: true }),
      )
      return
    }
    const turnEl = path.find(
      (n) => n instanceof HTMLElement && n.hasAttribute('data-turn'),
    ) as HTMLElement | undefined
    const turnRaw = turnEl?.getAttribute('data-turn')
    if (turnRaw != null) {
      const t = Number(turnRaw)
      // Toggle: clicking the already-focused turn clears the lens (back to whole run).
      const next = this.turn === t ? null : t
      this.dispatchEvent(
        new CustomEvent('rz-turn', { detail: { turn: next }, bubbles: true, composed: true }),
      )
    }
  }

  private _back(): void {
    this.dispatchEvent(new CustomEvent('rz-back', { bubbles: true, composed: true }))
  }

  /**
   * Detect a ?turn LENS change (a new cursor that re-positions the ribbon) and arm
   * the one-shot arrival pop (P6, object constancy). On the FIRST loaded run we do
   * NOT pop (there is nothing to transition FROM); on a subsequent cursor change we
   * set `_arrived` true for ~0.8s then clear it, so the lensed turn rises once per
   * change and never on an unrelated re-render.
   */
  protected willUpdate(changed: PropertyValues): void {
    if (!changed.has('turn') && !changed.has('walk')) return
    if (!this.walk) return
    const cursor = this.walk.turnCursor ?? this.turn ?? null
    if (this._lastTurn === undefined) {
      // First landed run — establish the baseline, no transition.
      this._lastTurn = cursor
      return
    }
    if (cursor !== this._lastTurn) {
      this._lastTurn = cursor
      this._arrived = true
      if (this._arrivedTimer) clearTimeout(this._arrivedTimer)
      this._arrivedTimer = setTimeout(() => {
        this._arrived = false
        this._arrivedTimer = null
      }, 800)
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    if (this._arrivedTimer) {
      clearTimeout(this._arrivedTimer)
      this._arrivedTimer = null
    }
  }

  /**
   * The active body — the RIBBON when a run is loaded, else the RUN LIST, else a
   * status line. Each nested view is wrapped in its OWN host `<div>` (the happy-dom
   * trailing-binding gotcha — see rz-observatory). The `arrived` class on the host
   * carries the P6 staged-pop into the lensed turn (the keyframe targets the card).
   */
  private bodyTemplate(): TemplateResult | typeof nothing {
    if (this.walk) {
      return html`
        <button class="back-btn" @click=${() => this._back()}>
          ${icon('arrow-left', { size: 13 })}<span>back to the runs</span>
        </button>
        <div class="view-host walk-host ${this._arrived ? 'arrived' : ''}">${walkView(this.walk)}</div>
      `
    }
    if (this.index) return html`<div class="view-host index-host">${walkIndexView(this.index)}</div>`
    if (!this.error && !this.loading) {
      return html`<div class="status loading" data-walk-empty>no run loaded yet</div>`
    }
    return nothing
  }

  render(): TemplateResult {
    const loading = this.loading
      ? html`<div class="status loading">reading the trace files…</div>`
      : nothing
    const error = this.error
      ? html`<div class="status err">trace-read error (NO fallback — the real error):
${this.error}</div>`
      : nothing
    return html`
      <div class="wrap" @mn-card-activate=${(e: Event) => this._onCardActivate(e)}>
        <div class="status-host">${loading}</div>
        <div class="status-host">${error}</div>
        <div class="body-host">${this.bodyTemplate()}</div>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rz-walk': RzWalk
  }
}
