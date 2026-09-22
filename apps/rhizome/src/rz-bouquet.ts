/**
 * rz-bouquet — THE BOUQUET surface (the READ-side constellation reader).
 *
 * The counterpart to rz-walk (the write-side): opening a belief blooms its
 * constellation of annotated stars (the answer + why + resolved conflicts +
 * standing dispositions + entity links + gotchas + evidence + the retrieval
 * reasoning). A CONTROLLED Lit element (the same discipline as rz-walk /
 * rz-observatory): the shell (main.ts) reads live via world.bouquet() and sets the
 * resource prop; this element composes the pure bouquet-views over the
 * @shrubbery/render BouquetResource and emits intents the shell fulfils:
 *   - `rz-open`  detail:{ rootId } — an entity-link star was activated (drill into
 *                the sibling belief's bloom — the cross-surface drill-down).
 *   - `rz-back`                    — return from a bloom to the bouquet index.
 *
 * THE ERGONOMICS LIVE HERE (the CSS is where the human-factors checklist becomes
 * pixels). This must be the most sophisticated/pleasant of the three surfaces:
 *   P0  one dominant focal point — `.bq-head` is the LARGEST + BRIGHTEST + most
 *       whitespace (the head wins the blur/squint test); every other arm is a
 *       visibly lower, denser register.
 *   P1/P2  Gestalt grouping by KIND via common-region arms in a STABLE skeleton,
 *       redundant (zone + glyph + tone), never colour alone; the emporium
 *       rule-WEIGHT system (hair → line → frame) separates groups instead of heavy
 *       boxes (A2: no chartjunk).
 *   P3/P4  the "why" + the deep predecessors + the evidence corpus are quiet
 *       <details> reveals (overview at rest, detail on demand); the why layer is
 *       muted, smaller, beside its claim.
 *   P5  supersession = fade (opacity) + strike + position-below-by-recency, with a
 *       lineage rail — value-contrast carries alive/dead, redundantly.
 *   P6  object constancy on the as-of change — ONE staged ~1s arrival pop on the new
 *       head (`_arrived`), honouring prefers-reduced-motion (instant fallback).
 *   P6b  long lineages fold older predecessors behind "+N earlier".
 *
 * It owns NO data path — no fetch, no SPARQL. Registered as a side effect (the
 * upgrade seam) so the shell can swap it into the body region. When nothing is
 * loaded it shows an honest status (NO faked bloom). Danger/error uses the DANGER
 * ROLE TOKENS (not hardcoded hex) so it tracks the Emporium dark-purple theme.
 *
 * happy-dom gotcha (verified, see rz-observatory): each nested view is wrapped in
 * its OWN host `<div>` so the `${…}` is the sole child of an element, never a
 * trailing bare child-binding (which happy-dom's lit drops when nested).
 */

import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { iconStyles } from '@shrubbery/components'
import '@shrubbery/components'
import type { BouquetResource, MemoryRecord } from '@shrubbery/render'
import { bouquetView } from './bouquet-views.js'

@customElement('rz-bouquet')
export class RzBouquet extends LitElement {
  /** The opened belief (a bed root id), or null = the bouquet index (handled upstream). */
  @property({ type: String }) rootId: string | null = null
  /** The cross-surface as-of lens (ISO date), or null = now. */
  @property({ type: String }) asof: string | null = null

  /** The opened belief's BOUQUET resource, set by the shell when a bloom is open. */
  @property({ attribute: false }) bouquet: BouquetResource | null = null
  /** Whether a read is in flight. */
  @property({ type: Boolean }) loading = false
  /** A live read error to surface verbatim (NO faked fallback). */
  @property({ type: String }) error = ''

  /**
   * One-shot arrival flag (P6, object constancy). Set true for ~1s whenever the head
   * CHANGES (a new bloom or an as-of recompute) so the focal star plays the staged
   * rise-into-focus pop, then clears. Reduced-motion users get an instant swap (the
   * keyframe is gated on the media query in CSS). `@state` → reactive, not an attr.
   */
  @state() private _arrived = false
  /**
   * The OUTGOING head record (P6, the demote half of object constancy). On a head
   * change we keep the previous head for the ~1s arrival window and render it as a
   * transient ghost in the top lineage slot — it visibly fades+shrinks+slides DOWN
   * into the lineage (where the old answer went), staged BEFORE the new head rises.
   * `@state` → reactive; cleared when the arrival timer fires.
   */
  @state() private _outgoingHead: MemoryRecord | null = null
  /** The head id of the LAST rendered bloom — to detect a head change (the as-of beat). */
  private _lastHead: string | null = null
  /** The previous bloom's full head record — captured so we can ghost it on change. */
  private _prevHeadRecord: MemoryRecord | null = null
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
      padding: 16px 24px 56px;
      max-width: 1040px;
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
      font-family: inherit;
      font-size: var(--mn-text-xs, 12px);
      margin-bottom: 16px;
    }
    .back-btn:hover {
      border-color: var(--mn-color-border-accent, var(--mn-color-accent));
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }

    /* ── The header — a QUIET eyebrow, NOT a second focal point (A1/P0). The page
       title used to be an --mn-text-lg(18px)/600 h1 that competed with the head (two
       ~bold ~18-20px strings at the top broke the blur/squint test). It is now folded
       INTO the head card's eyebrow band; what remains here is the lens + blurb as a
       muted orientation line. Blur the page → only .bq-head-content survives. ──────── */
    .bouquet-header {
      margin-bottom: 14px;
    }
    .bouquet-lens {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-sm, 13px);
      margin: 2px 0;
    }
    .bouquet-blurb {
      color: var(--mn-color-text-muted, #9ca3af);
      font-style: italic;
      font-size: var(--mn-text-sm, 13px);
      margin: 2px 0 0;
    }

    /* ════════════════════════════════════════════════════════════════════════
       P0 — THE FOCAL STAR. The single dominant element: largest type, highest
       contrast, the most whitespace, top of order. Blur the page → only this
       survives. An accent frame (the emporium rule-frame weight) + a tinted band.
       ════════════════════════════════════════════════════════════════════════ */
    .bq-focus {
      margin: 0 0 28px;
    }
    .bq-head {
      /* The strongest frame in the view — the accent border-frame, generous body. */
      --bq-head-accent: var(--mn-color-border-accent, var(--mn-color-accent));
    }
    /* Pleasantness — the focal emphasis comes from TINT + WEIGHT + WHITESPACE
       (Tufte layering / Albers figure-ground), not a heavyweight 2px box that reads
       as chartjunk under the square Emporium skin (--mn-radius-control:0). The card
       wears the emporium rule-FRAME weight (the strongest of hair→line→frame) plus a
       subtle accent band + a 3px accent edge that ties it to the lineage rail. */
    .bq-head::part(card) {
      border: var(--mn-rule-frame, 1px solid var(--mn-color-border-strong, #ccc));
      border-left: 3px solid var(--bq-head-accent);
      border-radius: var(--mn-radius-surface, 4px);
      background: var(--mn-color-surface-accent, var(--mn-color-surface-raised, #fff));
    }
    .bq-head::part(body) {
      padding: 18px 20px;
    }
    .bq-head-banner {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .bq-head-glyph {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      display: inline-flex;
    }
    .bq-head-eyebrow {
      flex: 1;
      display: inline-flex;
      align-items: baseline;
      gap: 8px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 600;
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    /* The page title, folded INTO the head's eyebrow band as a quiet, muted, lower-
       case suffix — it orients (which belief) without competing with the answer (A1).
       It is a single muted register below the accent eyebrow, never a second headline. */
    .bq-head-title {
      text-transform: none;
      letter-spacing: 0;
      font-weight: 500;
      font-size: var(--mn-text-xs, 12px);
      color: var(--mn-color-text-secondary, #4b5563);
    }
    /* THE ANSWER — the single largest, highest-contrast string in the view. Stepped
       to --mn-text-2xl(24px) so it clears the (now-quieted) chrome + the 13px
       secondary register by a wide margin: it alone survives the blur test (P0). */
    .bq-head-content {
      font-size: var(--mn-text-2xl, 24px);
      font-weight: 600;
      line-height: 1.3;
      color: var(--mn-color-text-primary, #111);
      margin: 6px 0 0;
    }
    .bq-head-meta {
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
    }
    /* The head id — demoted from a full chip to the same quiet hover-title <code>
       idiom the predecessor short-ids use (P4/A7): the full IRI on hover, a muted
       short-id at rest, so it does not read as a third chip competing in the band. */
    .bq-head-id {
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-2xs, 10px);
    }

    /* P6 — object constancy: the new head RISES into focus (a single staged pop).
       The 'arrived' class is on the .view-host wrapper (rz-bouquet sets it for ~1s
       on a head change); the focal card is the descendant that animates. */
    .arrived .bq-head::part(card) {
      animation: bq-rise 0.9s cubic-bezier(0.22, 1, 0.36, 1);
    }
    @keyframes bq-rise {
      0% {
        transform: translateY(10px) scale(0.985);
        opacity: 0.55;
      }
      60% {
        transform: translateY(0) scale(1.004);
        opacity: 1;
      }
      100% {
        transform: translateY(0) scale(1);
        opacity: 1;
      }
    }
    /* P6 — the DEMOTE half: the outgoing head ghosts in the top lineage slot and
       slides DOWN+shrinks+fades into the lineage, staged so it reads BEFORE the new
       head rises (demote-then-promote, ~1s total). It is a transient row rz-bouquet
       injects only during the arrival window. */
    .bq-pred-ghost {
      animation: bq-demote 0.95s cubic-bezier(0.4, 0, 0.2, 1) both;
      transform-origin: left top;
    }
    @keyframes bq-demote {
      0% {
        transform: translateY(-22px) scale(1.04);
        opacity: 0.95;
      }
      55% {
        transform: translateY(-4px) scale(0.99);
        opacity: 0.72;
      }
      100% {
        transform: translateY(0) scale(1);
        opacity: 0.6;
      }
    }

    /* P6 / D4 — the SUPERSEDE BEAT: a predecessor landing in the lineage is the
       conceptual climax of the as-of change, so on the arrival window the struck rows
       play a short staged fade-in (the demoted answer is SEEN landing in the soil),
       matching the narrated-change principle. Staggered ~70ms/step via --bq-age so the
       eye reads them settling in recency order, AFTER the head rises. The ghost keeps
       its own bq-demote slide and is excluded (it animates the other direction). */
    .arrived .bq-pred:not(.bq-pred-ghost) {
      animation: bq-pred-land 0.5s ease both;
      animation-delay: calc(0.35s + var(--bq-age, 0) * 0.07s);
    }
    @keyframes bq-pred-land {
      0% {
        transform: translateY(-5px);
        opacity: 0;
      }
      100% {
        transform: translateY(0);
        /* land at the at-rest demoted value, not full opacity (P5 alive→dead). */
        opacity: 0.6;
      }
    }

    /* A6 / accessibility: reduced-motion users get an instant swap (no motion). */
    @media (prefers-reduced-motion: reduce) {
      .arrived .bq-head::part(card) {
        animation: none;
      }
      .bq-pred-ghost {
        animation: none;
      }
      .arrived .bq-pred:not(.bq-pred-ghost) {
        animation: none;
      }
    }

    /* ════════════════════════════════════════════════════════════════════════
       The lower register — the secondary arms. Visibly quieter than the head:
       smaller, denser, separated by WHITESPACE + the emporium rule weights, not
       boxes (A2). Each arm is a stable common-region zone (P1/P2).
       ════════════════════════════════════════════════════════════════════════ */
    .constellation {
      display: flex;
      flex-direction: column;
      gap: 22px;
    }
    /* P1 — COMMON REGION (the strongest classic grouping cue): each arm is a faint
       enclosed zone (a sunken well + a tone-keyed accent rail), so kinds segment
       preattentively — a constellation of regions, not a stack of lists. The rail
       reuses the wk-turn-supersede accent-left idiom the surfaces already share.
       Default rail = muted; specific arms re-tone it (gotcha → warning, below). */
    .bq-arm {
      --bq-arm-tone: var(--mn-color-border-default, #e5e7eb);
      padding: 14px 16px;
      background: var(--mn-color-surface-sunken, rgba(0, 0, 0, 0.03));
      border-radius: var(--mn-radius-surface, 4px);
      border-left: 2px solid var(--bq-arm-tone);
    }
    /* The lineage arm — the one true sequence — earns the accent rail. */
    .bq-arm-lineage {
      --bq-arm-tone: var(--mn-color-border-accent, var(--mn-color-accent));
    }
    .bq-arm-head {
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
    .bq-arm-head .mn-icon {
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .bq-arm-count {
      font-size: var(--mn-text-2xs, 10px);
      font-weight: 600;
      color: var(--mn-color-text-muted, #9ca3af);
      border: 1px solid var(--mn-color-border-subtle, #eee);
      border-radius: var(--mn-radius-control, 4px);
      padding: 0 6px;
      letter-spacing: 0;
    }

    .bq-empty {
      color: var(--mn-color-text-muted, #9ca3af);
      font-style: italic;
      font-size: var(--mn-text-sm, 13px);
      margin: 4px 0 0;
      line-height: 1.5;
      max-width: 70ch;
    }

    /* ── A4 — ABSENCE carries EXISTENCE weight, not content weight. An arm with zero
       items does NOT spend a full common-region zone (sunken well + padding + rail)
       on one italic line — that is salience on nothing. Instead it collapses to a
       single muted one-line stub OUTSIDE the well: just the kind glyph + a terse
       handle ("No entity links"), at --mn-text-xs muted. The full honest sentence
       (why it's empty) rides behind the title= hover, so honesty stays without
       spending preattentive weight at rest. ─────────────────────────────────────── */
    .bq-arm-absent {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 2px 0;
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-xs, 12px);
    }
    .bq-arm-absent .mn-icon {
      color: var(--mn-color-text-muted, #9ca3af);
      flex: 0 0 auto;
    }
    .bq-arm-absent-label {
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 600;
    }
    .bq-arm-absent-note {
      color: var(--mn-color-text-muted, #9ca3af);
    }

    /* ── P5 — THE LINEAGE: struck predecessors, faded + struck + below by recency,
       on ONE continuous connecting rail anchored to the head (Gestalt connectedness:
       the most expensive cue, spent visibly on the one true sequence). ─────────── */
    .bq-pred-list {
      position: relative;
      list-style: none;
      margin: 6px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 7px;
    }
    /* The supersession rail — ONE line down the lineage, IN-ARM. It used to claim a
       hardcoded top:-14px "reach up" to the head card, but the head sits in a separate
       .bq-focus block (margin 0 0 28px) + the arm's own 14px padding, so the rail
       floated in the gap and never touched the card — it promised a connection it did
       not render. It now begins at the first predecessor tick and runs down the chain;
       the lineage arm's accent rail (border-left) carries the tie to the focal band. */
    .bq-pred-list::before {
      content: '';
      position: absolute;
      left: 3px;
      top: 7px;
      bottom: 7px;
      width: 0;
      border-left: 1.5px solid var(--mn-color-border-accent, var(--mn-color-accent));
      opacity: 0.5;
    }
    .bq-pred-list-folded {
      margin-top: 7px;
    }
    .bq-pred {
      position: relative;
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
      /* D1: position MEANS recency — the --bq-age var (0 = newest) steps each older
         record right along a visible age axis (6px/step), so the as-of scrubber slides
         a record along position-on-a-scale. The rail/glyph follow via the same offset. */
      padding-left: calc(16px + var(--bq-age, 0) * 6px);
      /* Value-contrast carries alive→dead (the key channel); strike + position add
         the redundant cues so it reads in grayscale / for colourblind users (A3). */
      opacity: 0.6;
      font-size: var(--mn-text-sm, 13px);
      transition: opacity 0.15s ease;
    }
    .bq-pred:hover {
      opacity: 0.85;
    }
    /* Each predecessor is a NODE on the rail — a small tick where the row meets it. */
    .bq-pred-rail {
      position: absolute;
      left: 0;
      top: 7px;
      width: 7px;
      height: 0;
      border-top: 1.5px solid var(--mn-color-border-accent, var(--mn-color-accent));
      opacity: 0.5;
    }
    .bq-pred-glyph {
      color: var(--mn-color-text-muted, #9ca3af);
      display: inline-flex;
    }
    .bq-pred-date {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #9ca3af);
      white-space: nowrap;
    }
    .bq-pred-content {
      color: var(--mn-color-text-secondary, #6b7280);
      flex: 1;
      min-width: 12ch;
    }
    .bq-pred-id {
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-2xs, 10px);
    }
    .bq-pred-fold {
      padding-left: 14px;
      list-style: none;
    }
    .bq-lineage-graph {
      margin-top: 12px;
    }
    /* The inline (open) caption for short chains — the quiet label the fold-summary
       carried, now a static eyebrow above the visible connecting line. */
    .bq-lineage-cap {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin: 0 0 6px;
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-2xs, 10px);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    /* ── The grouped LIST arms (dispositions, gotchas). ──────────────────────── */
    .bq-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .bq-disp,
    .bq-gotcha {
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.45;
    }
    .bq-disp-glyph {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      display: inline-flex;
    }
    .bq-disp-content {
      flex: 1;
      min-width: 12ch;
      /* P0: the secondary register sits a value-step BELOW the head — only the head
         holds text-primary, so it wins the blur test on VALUE, not just SIZE. */
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .bq-disp-id {
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-2xs, 10px);
    }
    /* Gotchas live in the WARNING region (the rail recolors — redundant with the
       alert glyph + the heading), so the zone reads danger preattentively (P1/A3). */
    .bq-arm-gotcha {
      --bq-arm-tone: var(--mn-color-warning-border, var(--mn-color-warning));
    }
    .bq-gotcha-glyph {
      color: var(--mn-color-warning, #d97706);
      display: inline-flex;
    }
    .bq-gotcha-content {
      flex: 1;
      min-width: 12ch;
      /* P0: secondary register (the warning glyph + zone carry the alert, not value). */
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .bq-star-note {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: var(--mn-text-2xs, 10px);
      font-style: italic;
    }

    /* ── P7 — ENTITY LINKS: actionable affordances, secondary register. ──────── */
    .bq-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 12px;
    }
    .bq-entity {
      cursor: pointer;
    }
    .bq-entity::part(card) {
      border-radius: var(--mn-radius-surface, 8px);
    }
    .bq-star-head {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .bq-star-glyph {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      display: inline-flex;
    }
    .bq-star-why {
      flex: 1;
      font-weight: 600;
      font-size: var(--mn-text-xs, 12px);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .bq-entity-go {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
      display: inline-flex;
      opacity: 0.6;
      transition: transform 0.15s ease, opacity 0.15s ease;
    }
    .bq-entity:hover .bq-entity-go {
      opacity: 1;
      transform: translateX(2px);
    }
    .bq-entity-content {
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.45;
      margin: 4px 0 8px;
      /* P0: secondary register — entity-link bodies stay below the head's value. */
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .bq-entity-foot {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    /* ── P7 — EVIDENCE: the quietest layer; a verbatim floor, expandable. ────── */
    .bq-quotes {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 10px;
    }
    .bq-evidence {
      margin: 0;
      padding: 8px 12px;
      border-left: 2px solid var(--mn-color-border-default, #e5e7eb);
      background: var(--mn-color-surface-sunken, #f9fafb);
      font-size: var(--mn-text-sm, 13px);
      line-height: 1.5;
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .bq-evidence-glyph {
      color: var(--mn-color-text-muted, #9ca3af);
      margin-right: 4px;
      display: inline;
    }
    .bq-evidence-src {
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-2xs, 10px);
      margin-top: 5px;
    }
    .bq-evidence-fold > summary {
      list-style: none;
      cursor: pointer;
    }
    .bq-evidence-fold > summary::-webkit-details-marker {
      display: none;
    }

    /* ── P3/P4 — THE "WHY" LAYER: quiet, integrated, on demand. ──────────────── */
    .bq-why {
      margin-top: 8px;
    }
    .bq-why-summary {
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
    .bq-why-summary::-webkit-details-marker {
      display: none;
    }
    .bq-why-summary:hover {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }
    .bq-why-q {
      display: inline-flex;
    }
    .bq-why-body {
      margin: 6px 0 0;
      padding-left: 16px;
      font-size: var(--mn-text-xs, 12px);
      line-height: 1.5;
      color: var(--mn-color-text-secondary, #4b5563);
      max-width: 72ch;
    }
    .bq-why-note {
      color: var(--mn-color-text-muted, #9ca3af);
      font-style: italic;
    }

    /* Folds (the "+N earlier" + the lineage line). */
    .bq-fold-summary {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      list-style: none;
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: var(--mn-text-xs, 12px);
    }
    .bq-fold-summary::-webkit-details-marker {
      display: none;
    }
    .bq-fold-summary:hover {
      color: var(--mn-color-text-accent, var(--mn-color-accent));
    }

    /* ── The read reasoning — a quiet expandable footer. ─────────────────────── */
    .bq-retrieval {
      margin-top: 28px;
      padding-top: 14px;
      border-top: var(--mn-rule-line, 1px solid var(--mn-color-border-subtle, #eee));
    }
    .bq-retrieval-summary {
      cursor: pointer;
      list-style: none;
      margin-bottom: 0;
    }
    .bq-retrieval-summary::-webkit-details-marker {
      display: none;
    }
    .bq-rv-list {
      list-style: none;
      padding: 0;
      margin: 10px 0 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .bq-rv-row {
      display: flex;
      gap: 10px;
      font-size: var(--mn-text-sm, 13px);
    }
    .bq-rv-key {
      flex: 0 0 auto;
      min-width: 120px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: var(--mn-text-2xs, 10px);
      color: var(--mn-color-text-muted, #9ca3af);
      padding-top: 1px;
    }
    .bq-rv-val {
      flex: 1;
      color: var(--mn-color-text-secondary, #4b5563);
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

  /** An entity-link star was activated → drill into the sibling belief's bloom. */
  private _open(rootId: string): void {
    this.dispatchEvent(
      new CustomEvent('rz-open', { detail: { rootId }, bubbles: true, composed: true }),
    )
  }

  private _back(): void {
    this.dispatchEvent(new CustomEvent('rz-back', { bubbles: true, composed: true }))
  }

  /**
   * Detect a HEAD change (a new bloom, or an as-of recompute that moves the head)
   * and arm the one-shot arrival pop (P6). We compare the resolved head id; when it
   * differs, set `_arrived` true for ~1s then clear it — so the focal star rises
   * into focus exactly once per change, never on an unrelated re-render.
   */
  protected willUpdate(changed: PropertyValues): void {
    if (!changed.has('bouquet')) return
    const head = this.bouquet?.currentHead.localId ?? null
    if (head && head !== this._lastHead) {
      // P6 — demote-then-promote: if a PRIOR head was on screen and it differs from
      // the incoming one, ghost it in the top lineage slot for the arrival window so
      // the old answer visibly slides DOWN into the lineage (object constancy: you
      // see WHERE the old answer went, not just the new one appearing).
      const prior = this._prevHeadRecord
      this._outgoingHead = prior && prior.localId !== head ? prior : null
      this._lastHead = head
      this._prevHeadRecord = this.bouquet?.currentHead ?? null
      this._arrived = true
      if (this._arrivedTimer) clearTimeout(this._arrivedTimer)
      this._arrivedTimer = setTimeout(() => {
        this._arrived = false
        this._outgoingHead = null
        this._arrivedTimer = null
      }, 1000)
    } else if (!head) {
      this._lastHead = null
      this._prevHeadRecord = null
      this._outgoingHead = null
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
   * The active body — the BLOOM when a bouquet is loaded, else a status line. The
   * nested view is wrapped in its OWN host `<div>` (the happy-dom trailing-binding
   * gotcha — see rz-observatory). The `arrived` class on the host carries the P6
   * staged-pop into the focal star (the keyframe targets `.bq-head.arrived`).
   */
  private bodyTemplate(): TemplateResult | typeof nothing {
    if (this.bouquet) {
      return html`
        <button class="back-btn" @click=${() => this._back()}>← back to the beliefs</button>
        <div class="view-host bouquet-host ${this._arrived ? 'arrived' : ''}">
          ${bouquetView(this.bouquet, (rootId) => this._open(rootId), this._outgoingHead)}
        </div>
      `
    }
    if (!this.error && !this.loading) {
      return html`<div class="status loading" data-bouquet-empty>no belief opened yet</div>`
    }
    return nothing
  }

  render(): TemplateResult {
    const loading = this.loading
      ? html`<div class="status loading">reading the constellation…</div>`
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
    'rz-bouquet': RzBouquet
  }
}
