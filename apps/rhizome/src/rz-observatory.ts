/**
 * rz-observatory — the RHIZOME observatory surface (the `dom` face host).
 *
 * A CONTROLLED Lit element: the shell (main.ts) reads the live cell, sets the
 * resource props (`plot` / `chains` / `openSubject`), and re-renders. The element
 * owns NO data path — it composes the pure dom-views (plotView / bouquetView /
 * scrubberView) over the @shrubbery/render resource shapes, and emits intents the
 * shell fulfils by re-fetching:
 *   - `rz-asof`  detail:{ asof: string|null } — the SCRUBBER picked a lens.
 *   - `rz-open`  detail:{ rootId: string }    — a bed card was opened (the bouquet).
 *   - `rz-back`                               — return from the bouquet to the plot.
 *
 * THE ERGONOMICS LIVE HERE (the CSS is where the Bouquet's human-factors checklist
 * becomes pixels — this surface is held to the constellation reader's bar, the SAME
 * P-vocabulary so the two read as one family):
 *   P0  ONE dominant focal point per view — each bed's `.bloom-content` is the
 *       largest + brightest + most-whitespace datum (it wins the bed's blur/squint
 *       test); the soil, the lineage, and the cross-link are a lower register.
 *   P1/P2  Gestalt grouping by KIND via common-region zones (the soil is a sunken
 *       well + an accent rail) in a STABLE skeleton, redundant (zone + glyph + tone),
 *       never colour alone; rule-WEIGHT (hair → line → frame) separates groups, not
 *       heavy boxes (P7: no chartjunk).
 *   P3/P4  the lineage graph + the deep soil are quiet <details> reveals (overview at
 *       rest, detail on demand); the "why" is a muted, smaller, adjacent layer.
 *   P5  supersession = fade (opacity) + strike + position-below-by-recency + date —
 *       value-contrast carries alive→dead, redundantly.
 *   P6  OBJECT CONSTANCY on the as-of change — ONE subtle staged transition replays
 *       the blooms on a lens change (`_arrived`), honouring prefers-reduced-motion.
 *   P7  ABSENT content is a quiet one-liner (the empty soil), never a full-weight
 *       empty zone; whitespace + value-contrast over boxes/rules.
 *
 * Danger/error uses the DANGER ROLE TOKENS (NOT hardcoded hex) so it tracks the
 * Emporium dark-purple skin. All glyphs are lucide icon() (never emoji); all colour
 * / space / radius / type via --mn-* tokens.
 *
 * It is registered as a side effect (the upgrade seam) — importing this module
 * upgrades the inert `<rz-observatory>` the render host stamps for the config's
 * observatory region.
 *
 * Dependencies: lit + @shrubbery/components (the primitives the views compose) +
 * the pure dom-views. No fetch, no SPARQL.
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { iconStyles } from '@shrubbery/components'
import '@shrubbery/components'
import type { MemoryRecord, PlotResource, SubjectResource } from '@shrubbery/render'
import { bouquetView, plotView } from './dom-views.js'
import type { GhostCluster } from './greenhouse-views.js'

@customElement('rz-observatory')
export class RzObservatory extends LitElement {
  /** The live PLOT resource (one lens). Null until the shell's first read lands. */
  @property({ attribute: false }) plot: PlotResource | null = null
  /** Per-bed full record chains (the soil layer), keyed by rootId. */
  @property({ attribute: false }) chains: ReadonlyMap<string, readonly MemoryRecord[]> = new Map()
  /** The opened subject (the bouquet view), or null = the plot grid. */
  @property({ attribute: false }) openSubject: SubjectResource | null = null
  /**
   * The REVERSE cross-link map: bed rootId → the agentic run that minted its head.
   * The shell builds it from the Walk index (the runs' supersession edges) so each
   * bed can offer "open the Walk" — navigating IN-SHELL to that run. Empty = no
   * minting run known for any bed (e.g. the Walk index hasn't loaded) → no affordance.
   */
  @property({ attribute: false }) mintedBy: ReadonlyMap<string, string> = new Map()
  /**
   * The entity-resolution near-duplicate ghost clusters — the MERGE-GHOST affordance
   * on the Plot (greenhouse-design §4b #3): "these N look like one (user·5K-PB)". The
   * shell detects them (entity-resolution.detectDuplicates) and hands them in; the
   * [merge] button re-emits rz-merge (the REAL write). Empty → no ghost banner.
   */
  @property({ attribute: false }) ghosts: readonly GhostCluster[] = []
  /** The current as-of lens (ISO date), or null = now. */
  @property({ type: String }) asof: string | null = null
  /** A live read error to surface verbatim (NO faked fallback). */
  @property({ type: String }) error = ''
  /** Whether a read is in flight. */
  @property({ type: Boolean }) loading = false

  /**
   * One-shot arrival flag (P6, object constancy). Set true for ~0.9s whenever the
   * PLOT LENS changes (a new as-of recompute that may move every bed's head) so the
   * blooms play a single staged rise-into-focus pop, then clears — the user TRACKS
   * what changed instead of the grid silently swapping. Reduced-motion users get an
   * instant swap (the keyframe is gated on the media query). `@state` → reactive.
   */
  @state() private _arrived = false
  /** The lens the LAST render resolved at — to detect an as-of change (the beat). */
  private _lastAsof: string | null | undefined = undefined
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

    /* ════════════════════════════════════════════════════════════════════════
       P0/P4 — THE HEADER is a QUIET orienting band, NOT a second focal point. The
       title used to be an h1 (--mn-text-lg/600) that competed with the per-bed
       blooms; it is now a modest muted eyebrow + a lens/summary layer beside it
       (the Bouquet's restraint: the focal data — the blooms — win the blur test).
       ════════════════════════════════════════════════════════════════════════ */
    .plot-eyebrow,
    .bouquet-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 2px;
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    .plot-eyebrow .mn-icon,
    .bouquet-eyebrow .mn-icon {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    /* P0 — the title is held to the Bouquet's restraint: NO element above text-sm in
       the header, so the 20px blooms win the blur test cleanly. It is a quiet muted
       label (text-sm, NO 600 weight, secondary tone), not the bold full-contrast
       header that competed with the per-bed heads (the Bouquet deliberately cut its
       own --mn-text-lg/600 h1 for exactly this reason). */
    .plot-title,
    .bouquet-title {
      font-size: var(--mn-text-sm, 13px);
      font-weight: 400;
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .plot-lens,
    .bouquet-lens,
    .plot-summary {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-sm, 13px);
      margin: 2px 0;
    }
    .plot-summary {
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .plot-header,
    .bouquet-header {
      margin-bottom: 14px;
    }

    /* ── THE MERGE-GHOST banner (§4b #3): the entity-resolution call rendered ON the
       Plot. P7: a quiet thin accent banner at rest, NOT an alarm — full weight only
       because it is a genuine, actionable fragmentation. The [merge] button fires the
       REAL write (rz-merge bubbles to the shell → the data layer). ──────────────── */
    .plot-ghosts {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 4px 0 10px;
    }
    .plot-ghost {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 6px 12px;
      border-radius: var(--mn-radius-surface, 4px);
      border-left: 2px solid var(--mn-color-border-accent, var(--mn-color-accent));
      background: var(--mn-color-surface-accent, #eef2ff);
      font-size: var(--mn-text-sm, 13px);
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .plot-ghost-merged {
      background: var(--mn-color-surface-sunken, rgba(0, 0, 0, 0.03));
      border-left-color: var(--mn-color-border-default, #e5e7eb);
    }
    .plot-ghost-glyph {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      display: inline-flex;
    }
    .plot-ghost-text {
      flex: 1;
      min-width: 16ch;
    }
    .plot-ghost-btn {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border: 1px solid var(--mn-color-border-accent, var(--mn-color-accent));
      border-radius: var(--mn-radius-control, 4px);
      background: var(--mn-color-surface-base, #fff);
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      font-family: inherit;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
    }
    .plot-ghost-btn:hover {
      background: var(--mn-color-accent, #6366f1);
      color: var(--mn-color-surface-base, #fff);
    }
    .plot-ghost-unmerge {
      border-color: var(--mn-color-border-default, #e5e7eb);
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .plot-ghost-unmerge:hover {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent));
      background: transparent;
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }

    /* ── The plot bed grid (P2: a stable skeleton across reads). ──────────────── */
    .beds {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
      margin-top: 12px;
    }
    /* P0/P4: the bed eyebrow is a QUIET orienting band ABOVE the bloom — a kind
       glyph + the topic + the kind badge, all a register BELOW the focal head
       (uppercase, muted, smaller) so it never competes with the answer. */
    .bed-head {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .bed-glyph {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      display: inline-flex;
    }
    .bed-topic {
      flex: 1;
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--mn-color-text-secondary, #4b5563);
    }

    /* ════════════════════════════════════════════════════════════════════════
       P0 — THE BLOOM: the resolved current head, the SINGLE FOCAL datum of each
       bed. Stepped to --mn-text-xl so it clears the (quieted) chrome + the 13px
       secondary register by a wide margin — blur the card → only this survives.
       Tint + weight + whitespace do the focal work (Tufte layering), no heavy box.
       ════════════════════════════════════════════════════════════════════════ */
    .bloom {
      padding: 6px 0 10px;
    }
    .bloom-content {
      font-size: var(--mn-text-xl, 20px);
      font-weight: 600;
      line-height: 1.3;
      color: var(--mn-color-text-primary, #111);
    }
    /* P7 — an ABSENT head demotes to a quiet muted one-liner (not a full element
       spending focal weight on nothing); honesty rides in the copy, not the size. */
    .bloom-content.empty {
      font-size: var(--mn-text-sm, 13px);
      color: var(--mn-color-text-muted, #9ca3af);
      font-weight: 400;
      font-style: italic;
    }
    /* P4/P7 — the meta is a quiet adjacent layer: a date + a hover-title short-id
       (the same restraint as the soil rows), NOT a chip row competing with the head. */
    .bloom-meta {
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .bloom-date {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .bloom-id {
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-2xs, 10px);
    }

    /* P6 — OBJECT CONSTANCY: on a lens change the blooms RISE into focus (one staged
       pop). The 'arrived' class is on the .plot-host wrapper (set ~0.9s on a change);
       each .bloom-content is the descendant that animates, staggered subtly so the
       grid reads as a coordinated recompute, not a flicker. */
    .arrived .bloom-content {
      animation: bloom-rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    @keyframes bloom-rise {
      0% {
        transform: translateY(6px) scale(0.99);
        opacity: 0.5;
      }
      100% {
        transform: translateY(0) scale(1);
        opacity: 1;
      }
    }
    /* P6 — the soil settles in AFTER the bloom rises (the demoted answer is seen
       landing in the soil), at the at-rest demoted value, not full opacity. */
    .arrived .soil-row {
      animation: soil-land 0.45s ease both;
      animation-delay: calc(0.2s + var(--soil-age, 0) * 0.06s);
    }
    @keyframes soil-land {
      0% {
        transform: translateY(-4px);
        opacity: 0;
      }
      100% {
        transform: translateY(0);
        opacity: 0.62;
      }
    }
    /* A6 / accessibility: reduced-motion users get an instant swap (no motion). */
    @media (prefers-reduced-motion: reduce) {
      .arrived .bloom-content,
      .arrived .soil-row {
        animation: none;
      }
    }

    /* ── P3 — THE LINEAGE GRAPH folds behind details (overview at rest, the layered
       DAG on demand) so the bloom keeps the focal whitespace. ─────────────────── */
    .bed-graph-fold {
      margin: 6px 0 2px;
    }
    .bed-fold-summary {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      list-style: none;
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-2xs, 10px);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .bed-fold-summary::-webkit-details-marker {
      display: none;
    }
    .bed-fold-summary:hover {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    .bed-graph {
      margin: 8px 0 0;
    }

    /* ── THE CROSS-LINK — "minted by run …" (the reverse Plot→Walk affordance). P7:
       a QUIET secondary affordance (a hairline outline, not a filled pill competing
       with the bloom); it LOOKS actionable (icon + hover) but stays a register down. */
    .bed-minted {
      margin: 6px 0 2px;
    }
    .bed-walk-link {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px;
      border: var(--mn-rule-line, 1px solid var(--mn-color-border-subtle, #eee));
      border-radius: var(--mn-radius-control, 4px);
      background: transparent;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-2xs, 10px);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      transition: border-color 0.15s ease, color 0.15s ease;
    }
    .bed-walk-link:hover {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent));
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    .bed-walk-link code {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 1.05em;
      text-transform: none;
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }

    /* ════════════════════════════════════════════════════════════════════════
       P1/P5 — THE SOIL: superseded predecessors in a COMMON-REGION zone (a sunken
       well + an accent rail), demoting REDUNDANTLY (fade + strike + position-below
       + date). Value-contrast carries alive→dead, so the demotion reads in
       grayscale / for colourblind users. Never hidden (the "accumulating" rule).
       ════════════════════════════════════════════════════════════════════════ */
    .soil {
      width: 100%;
      margin-top: 6px;
    }
    .soil-stack {
      display: flex;
      flex-direction: column;
      gap: 5px;
      padding: 8px 10px;
      background: var(--mn-color-surface-sunken, rgba(0, 0, 0, 0.03));
      border-radius: var(--mn-radius-surface, 4px);
      border-left: 2px solid var(--mn-color-border-default, #e5e7eb);
    }
    .soil-rows {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .soil-empty {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-xs, 12px);
      font-style: italic;
    }
    /* The soil caption — a quiet eyebrow naming the common-region (P4). */
    .soil-cap {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 2px;
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-2xs, 10px);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .soil-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      /* D1: position-below MEANS recency — --soil-age (0 = newest) steps each older
         record right along a visible age axis, so the as-of scrubber slides a record
         along position-on-a-scale. */
      padding-left: calc(var(--soil-age, 0) * 6px);
      /* Value-contrast carries alive→dead (the key channel); strike + position add
         the redundant cues so it reads in grayscale / for colourblind users. */
      opacity: 0.62;
      font-size: var(--mn-text-sm, 13px);
      transition: opacity 0.15s ease;
    }
    .soil-row:hover {
      opacity: 0.85;
    }
    .soil-date {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #9ca3af);
      white-space: nowrap;
    }
    .soil-content {
      flex: 1;
      min-width: 12ch;
      color: var(--mn-color-text-secondary, #6b7280);
    }

    /* ════════════════════════════════════════════════════════════════════════
       THE BOUQUET (the in-observatory index drill-down) — the focal flower over a
       common-region lineage. The SAME register system as THE PLOT (one family).
       ════════════════════════════════════════════════════════════════════════ */
    /* P0 — the focal flower, alone in its band, the single dominant element. */
    .flower-focus {
      margin: 0 0 22px;
    }
    .flower-head::part(card) {
      border: var(--mn-rule-frame, 1px solid var(--mn-color-border-strong, #ccc));
      border-left: 3px solid var(--mn-color-border-accent, var(--mn-color-accent));
      border-radius: var(--mn-radius-surface, 4px);
      background: var(--mn-color-surface-accent, var(--mn-color-surface-raised, #fff));
    }
    .flower-head::part(body) {
      padding: 16px 18px;
    }
    .flower-head-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .flower-glyph {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      display: inline-flex;
    }
    .flower-eyebrow {
      flex: 1;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 600;
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    /* THE ANSWER — the single largest, highest-contrast string in the bouquet. */
    .flower-content {
      font-size: var(--mn-text-xl, 20px);
      font-weight: 600;
      line-height: 1.3;
      color: var(--mn-color-text-primary, #111);
      margin: 6px 0 0;
    }
    .flower-meta {
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .flower-date {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .flower-id {
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-2xs, 10px);
    }
    /* P6 — the focal flower rises on a lens change (same beat as the plot blooms). */
    .arrived .flower-head::part(card) {
      animation: bloom-rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    @media (prefers-reduced-motion: reduce) {
      .arrived .flower-head::part(card) {
        animation: none;
      }
    }

    /* P1/P5 — THE LINEAGE: a common-region zone (sunken well + accent rail) of
       struck predecessors below the head; the one explicit line is the supersession
       sequence, folded behind details (P3). */
    .flower-lineage {
      padding: 12px 14px;
      background: var(--mn-color-surface-sunken, rgba(0, 0, 0, 0.03));
      border-radius: var(--mn-radius-surface, 4px);
      border-left: 2px solid var(--mn-color-border-accent, var(--mn-color-accent));
    }
    .flower-arm-head {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 0 0 8px;
      font-size: var(--mn-text-sm, 13px);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .flower-arm-head .mn-icon {
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .flower-arm-count {
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 600;
      color: var(--mn-color-text-muted, #9ca3af);
      border: 1px solid var(--mn-color-border-subtle, #eee);
      border-radius: var(--mn-radius-control, 4px);
      padding: 0 6px;
      letter-spacing: 0;
    }
    .flower-pred-list {
      position: relative;
      list-style: none;
      margin: 6px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    /* The supersession rail — ONE line down the lineage (Gestalt connectedness, the
       most expensive cue, spent on the one true sequence). */
    .flower-pred-list::before {
      content: '';
      position: absolute;
      left: 3px;
      top: 6px;
      bottom: 6px;
      width: 0;
      border-left: 1.5px solid var(--mn-color-border-accent, var(--mn-color-accent));
      opacity: 0.5;
    }
    .flower-pred {
      position: relative;
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
      /* D1: position-below means recency (the --soil-age step). */
      padding-left: calc(14px + var(--soil-age, 0) * 6px);
      /* Redundant demotion: fade + strike (in the markup) + position + date. */
      opacity: 0.62;
      font-size: var(--mn-text-sm, 13px);
      transition: opacity 0.15s ease;
    }
    .flower-pred:hover {
      opacity: 0.85;
    }
    .flower-pred-glyph {
      color: var(--mn-color-text-muted, #9ca3af);
      display: inline-flex;
    }
    .flower-pred-date {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #9ca3af);
      white-space: nowrap;
    }
    .flower-pred-content {
      flex: 1;
      min-width: 12ch;
      color: var(--mn-color-text-secondary, #6b7280);
    }
    .flower-pred-id {
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-2xs, 10px);
    }
    .flower-lineage-graph {
      margin-top: 10px;
    }
    .flower-fold-summary {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      list-style: none;
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-2xs, 10px);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .flower-fold-summary::-webkit-details-marker {
      display: none;
    }
    .flower-fold-summary:hover {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    /* P7 — a single-record bed demotes to a quiet one-liner, never a faked star. */
    .flower-single {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      margin: 4px 0 0;
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-sm, 13px);
      font-style: italic;
    }
    .flower-single .mn-icon {
      color: var(--mn-color-text-muted, #9ca3af);
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
   * Detect an as-of LENS change (a new plot recomputed for a different date) and arm
   * the one-shot arrival pop (P6, object constancy). On the FIRST plot we do NOT pop
   * (there is nothing to transition FROM); on a subsequent lens change we set
   * `_arrived` true for ~0.9s then clear it, so the blooms rise once per change and
   * never on an unrelated re-render.
   */
  protected willUpdate(changed: PropertyValues): void {
    if (!changed.has('asof') && !changed.has('plot')) return
    if (!this.plot) return
    const lens = this.plot.asOf ?? null
    if (this._lastAsof === undefined) {
      // First landed plot — establish the baseline, no transition.
      this._lastAsof = lens
      return
    }
    if (lens !== this._lastAsof) {
      this._lastAsof = lens
      this._arrived = true
      if (this._arrivedTimer) clearTimeout(this._arrivedTimer)
      this._arrivedTimer = setTimeout(() => {
        this._arrived = false
        this._arrivedTimer = null
      }, 900)
    }
  }

  /** After each render, wire the bed cards' open intent (mn-card-activate bubbles). */
  protected updated(_changed: PropertyValues): void {
    // mn-card-activate bubbles + is composed; we catch it at the host level.
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    if (this._arrivedTimer) {
      clearTimeout(this._arrivedTimer)
      this._arrivedTimer = null
    }
  }

  private _onCardActivate(e: Event): void {
    const target = e.composedPath().find(
      (n) => n instanceof HTMLElement && n.hasAttribute('data-bed'),
    ) as HTMLElement | undefined
    const rootId = target?.getAttribute('data-bed')
    if (rootId) {
      this.dispatchEvent(
        new CustomEvent('rz-open', { detail: { rootId }, bubbles: true, composed: true }),
      )
    }
  }

  /**
   * THE REVERSE CROSS-LINK — a bed's "minted by run" affordance opens that run's
   * Walk IN-SHELL. The dom-view's button calls this callback (and stops the click
   * from also activating the card → opening the bouquet); we re-emit it as the
   * surface-level `rz-open-run` intent the app shell already routes.
   */
  private _openRun(runId: string): void {
    this.dispatchEvent(
      new CustomEvent('rz-open-run', { detail: { runId }, bubbles: true, composed: true }),
    )
  }

  /** A MERGE-GHOST [merge] on the Plot → the REAL entity-resolution write (the shell). */
  private _merge(c: GhostCluster): void {
    this.dispatchEvent(
      new CustomEvent('rz-merge', { detail: { recIris: c.recIris }, bubbles: true, composed: true }),
    )
  }

  private _unmerge(c: GhostCluster): void {
    this.dispatchEvent(
      new CustomEvent('rz-unmerge', { detail: { recIris: c.recIris }, bubbles: true, composed: true }),
    )
  }

  private _back(): void {
    this.dispatchEvent(new CustomEvent('rz-back', { bubbles: true, composed: true }))
  }

  /**
   * The main body — the BOUQUET when a subject is open, else THE PLOT, else a
   * status line. Computed as a flat dispatch (NOT a nested ternary in the template).
   *
   * IMPORTANT (happy-dom gotcha, verified): a nested TemplateResult interpolated as
   * the TRAILING child-binding of a returned template (e.g. `<button>…</button>${
   * bouquetView(...)}`) is DROPPED when that template is itself nested into the
   * component's render. The fix used here + at every call site below is to wrap each
   * nested view (plotView/bouquetView) in its OWN host element so the `${…}` is the
   * sole child of an element, never a trailing bare binding. (Same family as the
   * mn-graph svg-fragment gotcha.)
   */
  private bodyTemplate(): TemplateResult | typeof nothing {
    if (this.openSubject) {
      return html`
        <button class="back-btn" @click=${() => this._back()}>← back to the plot</button>
        <div class="view-host bouquet-host">${bouquetView(this.openSubject)}</div>
      `
    }
    if (this.plot)
      return html`<div class="view-host plot-host ${this._arrived ? 'arrived' : ''}">
        ${plotView(
          this.plot,
          this.chains,
          this.mintedBy,
          (runId) => this._openRun(runId),
          this.ghosts,
          (c) => this._merge(c),
          (c) => this._unmerge(c),
        )}
      </div>`
    if (!this.error && !this.loading) return html`<div class="status loading">no plot yet</div>`
    return nothing
  }

  render() {
    const loading = this.loading
      ? html`<div class="status loading">reading the live cell…</div>`
      : nothing
    const error = this.error
      ? html`<div class="status err">live-read error (NO fallback — the real error):
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
    'rz-observatory': RzObservatory
  }
}
