/**
 * mn-bottom-bar — the CHROME bottom-bar shell (backend-free).
 *
 * STRUCTURE lifted from garden/frontend/src/components/layout/mn-bottom-bar.ts
 * (READ-ONLY source). What garden's bottom bar is: a 3-column grid
 *   left-section(panel toggles + item count) |
 *   center-section(doc stats / selection / block-type) |
 *   right-section(presence + sync + cloud-pill + panel toggles).
 *
 * What was DROPPED in the lift (this is what makes it backend-free):
 *   - EVERY store import: sessionStore, filesystemStore, globalStatusStore,
 *     documentStore. None are read; no zustand subscription, no presence feed.
 *   - the LIVE counts/stats: item count (filesystemStore), word/char/reading
 *     stats + selection + created/modified dates (documentStore/filesystemStore),
 *     connected-user presence avatars + sync health (documentStore /
 *     globalStatusStore). Those are the data-bearing areas — here they are INERT
 *     slots (`<slot name="left-status">`, `"center-status"`, `"right-status">`).
 *     With no binding they render EMPTY; we do NOT fake "0 items" / "0 words" /
 *     a fake presence stack / a green "synced" dot.
 *   - the connection + presence popovers (documentStore/globalStatusStore) — not
 *     lifted (they render live service state).
 *   - the block-type dropdown + export (documentStore actions) — not lifted.
 *   - <mn-cloud-mode-pill> (reads runtimeConfig) — not lifted.
 *
 * What was KEPT as REAL chrome (no backend coupling — pure DOM + events):
 *   - the LEFT panel-mode toggles (Files / Graph): a controlled segmented
 *     control. `leftPanelMode` is a PROPERTY; clicking emits `mn-left-mode-change`
 *     (detail.mode) and mutates no store.
 *   - the RIGHT panel toggles (Sophia / Comments / Wires / Graph): controlled toggles.
 *     `panel` is a PROPERTY (the selected surface); clicking emits
 *     `mn-panel-toggle` and the shell applies the legacy select-or-close grammar.
 *     (detail.panel) and mutates no store.
 *
 * This is a REAL @customElement, not a stub-that-pretends: the grid + the toggle
 * chrome work; the three data areas are inert, clearly-labeled slots rather than
 * faked data.
 *
 * SKIN-AWARE (iteration 3b): mirrors the ambient [data-skin] / [data-theme] onto
 * its own host (SkinAware mixin — pure DOM, no backend) so its shadow CSS lights
 * up `:host([data-skin=emporium])` and consumes the skin density / radius /
 * label-display role tokens. Under Emporium the floor is tighter (24px row
 * height), square-shouldered, icon-only (toggle CAPTIONS hidden via
 * --mn-label-display — the label text stays in the DOM for a11y, only its display
 * is toggled), with the stronger Emporium frame rules; Garden keeps its rounded,
 * captioned fern floor. Accent / surface / font colors flow in via the inherited
 * --mn-* custom properties — no per-skin color code here.
 *
 * Dependencies: lit ONLY. The skin contract with @shrubbery/tokens is the
 * ATTRIBUTE + CSS-var NAMES, never a module import. grep-verified by the island
 * test.
 *
 * PRESENCE INSPECTOR (wave1 review r1 WRONG fix): the per-person live-session
 * popover is the REAL, separately-tagged `<mn-presence-inspector>` element
 * (`mn-presence-inspector.ts`), not a second, private copy of its template/
 * CSS. This is the elevation `mn-presence-inspector.ts`'s own header
 * describes actually completing: this file used to keep a byte-identical
 * private `_renderPresenceInspector` alongside the hoisted element, so a
 * future edit to the inspector's markup/behavior could drift between the two
 * — `layout/faces/presence-inspector-face.ts` is not the only consumer of
 * the hoisted element anymore; THIS shell is too.
 */

import { LitElement, css, html, nothing } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import './mn-presence-inspector.js'
import './mn-badge.js'

/** The left-rail content modes the chrome toggle offers. */
export type ChromeLeftPanelMode = 'files' | 'graph' | 'outline'

/** The right-rail panels the chrome toggle offers. */
export type ChromePanelId = 'chat' | 'comments' | 'wires' | 'graph'
export type ChromePanelMode = ChromePanelId | 'none'

export interface ChromeDocumentStats {
  readonly words: number
  readonly characters: number
  readonly selectedCharacters?: number
  readonly blockType?: string | null
  readonly readingTimeMinutes?: number
}

export interface ChromePresencePerson {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly type?: 'human' | 'agent'
  readonly sessionCount?: number
  readonly deviceCount?: number
  readonly isSelf?: boolean
  readonly clientIds?: readonly string[]
  readonly sessions?: readonly ChromePresenceSession[]
}

export interface ChromePresenceSession {
  readonly awarenessClientId?: string
  readonly clientId: string
  readonly deviceId?: string | null
  readonly connectionEpoch?: number
  readonly hasCursor?: boolean
  readonly isLocal?: boolean
}

export interface ChromePresenceOpenDetail {
  readonly person: ChromePresencePerson
}

export interface ChromePresenceFollowDetail {
  readonly person: ChromePresencePerson
  readonly session: ChromePresenceSession
  readonly following: boolean
}

export interface ChromePresenceSelfUpdateDetail {
  readonly person: ChromePresencePerson
  readonly name?: string
  readonly color?: string
}

export type ChromeSyncState =
  | 'idle'
  | 'connecting'
  | 'synced'
  | 'reconnecting'
  | 'disconnected'
  | 'error'
export type ChromeRuntimeMode = 'local' | 'hosted'

/**
 * The bottom-bar mirror badges (master spec §3 Slice 4, WS2 §5.2; copy deck
 * §7.2). One kind per row of the copy deck's table — `contested`/`pending`/
 * `parked` carry a count; `unknown`/`needs-repair` never do (there is no
 * verified copy to count against).
 */
export type ChromeSourceBadgeKind = 'contested' | 'pending' | 'parked' | 'unknown' | 'needs-repair'

export interface ChromeSourceBadge {
  readonly kind: ChromeSourceBadgeKind
  /** Leading glyph, rendered separately from `label` (◆ ↑ ⏸ — ⚠). */
  readonly glyph: string
  /** Visible text WITHOUT the glyph, e.g. "3 contested" or "local copy unknown". */
  readonly label: string
  /** The longer sentence a screen reader announces for this badge. */
  readonly accessibleName: string
  /** A short supplementary tooltip (native `title`). */
  readonly hint: string
}

/**
 * `sourceStatusModel()` (apps/organism `source-status.ts`) produces this
 * from the honest mirror state (master §2.1/§2.17). No `0 contested` badge —
 * EMPTY is a first-class success state — so an all-clear mirror publishes
 * `{ badges: [] }`, distinct from `sourceStatus === null` (never bound).
 */
export interface ChromeSourceStatus {
  readonly badges: readonly ChromeSourceBadge[]
}

/** The badge kinds that actually open a destination surface (build bundle
 *  review finding 4, 2026-07-31) — `pending`/`unknown`/`needs-repair` stay
 *  ambient-only, no route exists for them yet. */
export type ChromeSourceBadgeActivatableKind = 'contested' | 'parked'

/** `mn-source-badge-activate`'s detail. Controlled component discipline:
 *  this element only reports WHICH badge was activated; the shell decides
 *  what "open the contested list" / "open parked work" means. */
export interface ChromeSourceBadgeActivateDetail {
  readonly kind: ChromeSourceBadgeActivatableKind
}

/** Tone per badge kind. `contested` is deliberately absent — it reads the
 *  stance annunciator tokens directly via `::part(badge)` (master §2.12),
 *  not one of `mn-badge`'s Garden-core states. */
const SOURCE_BADGE_TONE: Readonly<Record<Exclude<ChromeSourceBadgeKind, 'contested'>, 'active' | 'warning' | 'neutral'>> = {
  pending: 'active',
  parked: 'warning',
  unknown: 'neutral',
  'needs-repair': 'warning',
}

@customElement('mn-bottom-bar')
export class MnBottomBar extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: grid;
      grid-template-columns: var(--mn-left-panel-width, 240px) 1fr var(--mn-right-panel-width, 320px);
      align-items: center;
      height: var(--mn-bottom-bar-height, 26px);
      min-height: var(--mn-bottom-bar-height, 26px);
      flex: 0 0 var(--mn-bottom-bar-height, 26px);
      overflow: visible;
      background: var(--mn-bottom-bar-bg, #fafafa);
      border-top: 1px solid var(--mn-bottom-bar-border, #e5e7eb);
      font-size: var(--mn-text-2xs, 11px);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      color: var(--mn-bottom-bar-text-muted, #6b7280);
      user-select: none;
      position: relative;
      box-sizing: border-box;
      box-shadow: 0 -1px 5px rgba(30, 45, 36, 0.045);
      z-index: 2;
    }

    /* Collapsed states — driven by reflected boolean attrs (chrome-only). */
    :host([left-collapsed]) {
      grid-template-columns: 0 1fr var(--mn-right-panel-width, 320px);
    }
    :host([right-collapsed]) {
      grid-template-columns: var(--mn-left-panel-width, 240px) 1fr min-content;
    }
    :host([left-collapsed][right-collapsed]) {
      grid-template-columns: 0 1fr min-content;
    }

    /* ── LEFT section ── */
    .left-section {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 6px);
      padding: 0 var(--mn-space-3, 8px);
      height: 100%;
      border-right: 1px solid var(--mn-bottom-bar-border, #e5e7eb);
      overflow: hidden;
    }
    :host([left-collapsed]) .left-section {
      display: none;
    }

    /* ── CENTER section (inert data slot) ── */
    .center-section {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 var(--mn-space-4, 12px);
      height: 100%;
      gap: var(--mn-space-2, 6px);
      overflow: hidden;
      min-width: 0;
    }

    /* ── RIGHT section ── */
    .right-section {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--mn-space-2, 6px);
      padding: 0 var(--mn-space-3, 8px);
      height: 100%;
      border-left: 1px solid var(--mn-bottom-bar-border, #e5e7eb);
    }
    .status-group {
      display: inline-flex;
      min-width: 0;
      align-items: center;
      gap: var(--mn-space-2, 6px);
      white-space: nowrap;
    }
    /* Mirror group (master §3 Slice 4): durable facts about your own work —
       ANNOUNCED (role="status", aria-live="polite", set as attrs in markup). */
    .mirror-group {
      gap: var(--mn-space-1-5, 5px);
    }
    /* Live group: presence + hocuspocus sync + runtime pill — these FLAP, so
       they stay aria-live="off" (set in markup); never announced. */
    .live-group {
      gap: var(--mn-space-2, 6px);
    }
    .source-badge {
      font-variant-numeric: tabular-nums;
    }
    /* The contested badge alone reads the stance annunciator tokens
       directly (master §2.12) rather than one of mn-badge's Garden-core
       states — its wine is a floor-state signal, not a generic severity. */
    .source-badge[data-source-badge='contested']::part(badge) {
      color: var(--mn-stance-contested-ink, #880134);
      border-color: var(--mn-stance-contested-edge, #e8c6d2);
      background: var(--mn-stance-contested-wash, #fbf1f4);
    }
    /* right-collapsed: badges render GLYPH-ONLY (label cleared in the render
       branch below) so their measured width stays constant regardless of
       the count's digit length — the right column is min-content (below),
       so a 3-count badge growing to a 130-count badge would otherwise
       reflow the centre column; tabular numerals equalise per-digit width,
       not total width. */
    :host([right-collapsed]) .source-badge {
      min-width: 0;
    }
    .status-value {
      color: var(--mn-bottom-bar-text, #374151);
      font-variant-numeric: tabular-nums;
    }
    .status-divider {
      color: var(--mn-color-border-strong, #d1d5db);
    }
    .export-btn {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      border: none;
      background: transparent;
      padding: 0;
      color: var(--mn-bottom-bar-text, #374151);
      font: inherit;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
    }
    .export-btn:hover {
      color: var(--mn-color-text-accent, #3d7f5f);
      text-decoration: underline;
    }
    .presence-stack {
      display: inline-flex;
      flex-direction: row-reverse;
      padding-left: 5px;
    }
    .presence-avatar {
      display: inline-grid;
      position: relative;
      width: 18px;
      height: 18px;
      padding: 0;
      margin-left: -5px;
      place-items: center;
      border: 1px solid var(--mn-bottom-bar-bg, #fafafa);
      border-radius: 999px;
      background: var(--presence-color, #64748b);
      color: #fff;
      font-size: 9px;
      font-weight: 750;
      font-family: inherit;
      text-transform: uppercase;
      cursor: pointer;
    }
    .presence-avatar:focus-visible {
      outline: 2px solid var(--mn-color-focus, #2563eb);
      outline-offset: 1px;
      z-index: 2;
    }
    .presence-avatar[data-actor-type='agent'] {
      background: var(--mn-color-primary-100, #dbeafe);
      color: var(--mn-color-primary-700, #1d4ed8);
      border-style: double;
    }
    .presence-avatar[aria-expanded='true'] {
      z-index: 3;
      box-shadow: 0 0 0 2px var(--mn-bottom-bar-bg, #fafafa), 0 0 0 3px var(--presence-color, #64748b);
    }
    .presence-count {
      position: absolute;
      right: -5px;
      bottom: -4px;
      display: grid;
      min-width: 10px;
      height: 10px;
      padding: 0 2px;
      place-items: center;
      border: 1px solid var(--mn-bottom-bar-bg, #fafafa);
      border-radius: 999px;
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-bottom-bar-text, #374151);
      font-size: 7px;
      line-height: 1;
      text-transform: none;
    }
    .sync-state {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--mn-bottom-bar-text, #374151);
    }
    .sync-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--mn-color-text-muted, #94a3b8);
    }
    .sync-state[data-state='synced'] .sync-dot { background: var(--mn-color-success, #16a34a); }
    .sync-state[data-state='connecting'] .sync-dot,
    .sync-state[data-state='reconnecting'] .sync-dot { background: var(--mn-color-warning, #d97706); }
    .sync-state[data-state='error'] .sync-dot { background: var(--mn-color-danger, #dc2626); }
    .runtime-pill {
      padding: 1px 5px;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: 999px;
      color: var(--mn-bottom-bar-text, #374151);
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .presence-overflow-trigger {
      display: grid;
      position: relative;
      width: 22px;
      height: 18px;
      margin-left: 2px;
      padding: 0;
      place-items: center;
      border: 1px solid var(--mn-color-border-default, #cbd5e1);
      border-radius: 999px;
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-secondary, #475569);
      font: inherit;
      font-size: 9px;
      font-weight: 750;
      cursor: pointer;
    }
    .presence-overflow-menu {
      position: absolute;
      right: var(--mn-space-3, 8px);
      bottom: calc(100% + 7px);
      z-index: 999;
      display: grid;
      width: min(250px, calc(100vw - 16px));
      max-height: min(360px, calc(100vh - 48px));
      overflow: auto;
      padding: 5px;
      border: 1px solid var(--mn-color-border-default, #d1d5db);
      border-radius: var(--mn-radius-surface, 8px);
      background: var(--mn-color-surface-raised, #fff);
      box-shadow: var(--mn-shadow-lg, 0 12px 30px rgba(15, 23, 42, 0.2));
    }
    .presence-overflow-person {
      display: grid;
      grid-template-columns: 14px minmax(0, 1fr) auto;
      align-items: center;
      gap: 7px;
      min-height: 30px;
      padding: 4px 6px;
      border: 0;
      border-radius: var(--mn-radius-control, 4px);
      background: transparent;
      color: var(--mn-color-text-primary, #111827);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .presence-overflow-person:hover,
    .presence-overflow-person:focus-visible {
      background: var(--mn-color-surface-hover, #f1f5f9);
      outline: none;
    }
    .presence-overflow-person small {
      color: var(--mn-color-text-muted, #64748b);
      font-size: 9px;
    }
    .presence-overflow-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--presence-color, #64748b);
    }
    :host([right-collapsed]) .right-section {
      border-left: none;
      padding-right: var(--mn-space-4, 12px);
    }

    /* ── Panel toggles (real controlled chrome) ── */
    .panel-toggles {
      display: flex;
      align-items: center;
      gap: 0;
      background: var(--mn-color-surface-sunken, #f3f4f6);
      border: 1px solid var(--mn-color-border-subtle, transparent);
      /* Surface radius role: Garden rounded, Emporium square. */
      border-radius: var(--mn-radius-surface, 4px);
      padding: 2px;
    }
    .toggle-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      /* Density role: clamp the toggle height to the skin control height minus
         the 2px padding wells above/below, so it tightens with the skin
         (Garden 30px → 24px chip; Emporium 24px → 18px chip). */
      height: calc(var(--mn-control-height, 22px) - 6px);
      padding: 0 10px;
      border: none;
      /* Control radius role: Garden rounded, Emporium square (0). */
      border-radius: var(--mn-radius-control, 2px);
      background: transparent;
      color: var(--mn-bottom-bar-text-muted, #6b7280);
      font-size: var(--mn-text-2xs, 11px);
      font-family: inherit;
      font-weight: 500;
      cursor: pointer;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease),
        box-shadow var(--mn-transition-fast, 120ms ease);
      text-transform: uppercase;
      letter-spacing: var(--mn-tracking-label, 0.04em);
    }
    .toggle-btn:hover {
      color: var(--mn-bottom-bar-text, #111);
      background: var(--mn-color-surface-hover, transparent);
    }
    .toggle-btn.active {
      color: var(--mn-color-text-primary, #111);
      background: var(--mn-color-surface-raised, #fff);
      box-shadow: var(--mn-shadow-xs, 0 1px 2px rgba(0, 0, 0, 0.08));
    }
    .toggle-btn:focus-visible {
      outline: none;
      box-shadow: var(--mn-focus-ring, 0 0 0 2px currentColor);
    }
    /* The toggle CAPTION — kept in the DOM for a11y / textContent, its DISPLAY
       follows the skin label flag: 'inline' (Garden) | 'none' (Emporium). In
       icon-only mode the button collapses to its icon glyph. */
    .toggle-btn .toggle-label {
      display: var(--mn-label-display, inline);
    }
    .toggle-btn .toggle-icon {
      display: none;
      font-size: 12px;
      line-height: 1;
    }

    /* ── EMPORIUM skin (sophia structure) overrides ──────────────────────────
       Host carries data-skin=emporium (mirrored by SkinAware). Tightens the
       floor to the row-height density, swaps the section dividers for the
       stronger Emporium rule, and surfaces the icon glyph in icon-only mode. */
    :host([data-skin='emporium']) {
      height: var(--mn-row-height, 24px);
      border-top: var(--mn-chrome-rule, 2px solid var(--mn-color-border-strong, #e5e7eb));
    }
    :host([data-skin='emporium']) .left-section {
      border-right: var(--mn-rule-line, 1px solid var(--mn-color-border-default, #e5e7eb));
    }
    :host([data-skin='emporium']) .right-section {
      border-left: var(--mn-rule-line, 1px solid var(--mn-color-border-default, #e5e7eb));
    }
    :host([data-skin='emporium']) .toggle-btn .toggle-icon {
      display: inline;
    }

    :host([data-skin='98']) {
      border-top: 0;
      box-shadow:
        inset 0 2px 0 var(--mn-98-highlight, #fff),
        inset 0 3px 0 var(--mn-98-light, #dfdfdf);
    }
    :host([data-skin='98']) .left-section {
      border-right: 2px groove var(--mn-98-face, #c0c0c0);
    }
    :host([data-skin='98']) .right-section {
      border-left: 2px groove var(--mn-98-face, #c0c0c0);
    }
    :host([data-skin='98']) .panel-toggles {
      padding: 3px;
      border: 0;
      border-radius: 0;
      background: var(--mn-98-face, #c0c0c0);
      box-shadow: var(--mn-98-sunken);
    }
    :host([data-skin='98']) .toggle-btn {
      color: var(--mn-color-text-primary, #000);
    }
    :host([data-skin='98']) .toggle-btn:hover,
    :host([data-skin='98']) .toggle-btn.active {
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='98']) .toggle-btn:active,
    :host([data-skin='98']) .toggle-btn.active:active {
      box-shadow: var(--mn-98-sunken);
      transform: translate(1px, 1px);
    }
    :host([data-skin='98']) .runtime-pill {
      border: 0;
      border-radius: 0;
      box-shadow: var(--mn-98-sunken);
    }

    :host([data-skin='glass']) {
      border-top: 1px solid var(--mn-bottom-bar-border);
      box-shadow: var(--mn-shadow-chrome);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) .left-section,
    :host([data-skin='glass']) .right-section {
      border-color: var(--mn-color-border-default);
    }
    :host([data-skin='glass']) .panel-toggles,
    :host([data-skin='glass']) .toggle-btn,
    :host([data-skin='glass']) .runtime-pill {
      border: var(--mn-control-border);
      background: var(--mn-control-background);
      box-shadow: var(--mn-control-shadow);
    }
    :host([data-skin='glass']) .toggle-btn:hover,
    :host([data-skin='glass']) .toggle-btn.active {
      background: var(--mn-control-background-hover);
    }
    :host([data-skin='glass']) .toggle-btn:active,
    :host([data-skin='glass']) .toggle-btn.active:active {
      background: var(--mn-control-background-active);
      box-shadow: var(--mn-control-shadow-active);
    }
  `

  /** Reflect collapse state so the grid CSS selectors fire. Chrome-only props. */
  @property({ type: Boolean, reflect: true, attribute: 'left-collapsed' }) leftCollapsed = false
  @property({ type: Boolean, reflect: true, attribute: 'right-collapsed' }) rightCollapsed = false

  /** Active left-rail content mode — CONTROLLED prop (not read from a store). */
  @property({ type: String, attribute: 'left-panel-mode' }) leftPanelMode: ChromeLeftPanelMode = 'files'

  /** The SELECTED right-rail panel — CONTROLLED prop (not read from a store). */
  @property({ type: String }) panel: ChromePanelMode | undefined

  /**
   * Compatibility input for older embedders. The last entry is projected to
   * the scalar selection; multiple active buttons are no longer possible.
   */
  @property({ type: Array }) panels: ChromePanelId[] = ['chat']

  /** Live data projections supplied by the shell; null keeps the legacy slot. */
  @property({ attribute: false }) itemCount: number | null = null
  @property({ attribute: false }) documentStats: ChromeDocumentStats | null = null
  /** Whether the shell can export the currently open document right now. */
  @property({ type: Boolean, attribute: 'document-export-available' }) documentExportAvailable = false
  @property({ attribute: false }) presence: readonly ChromePresencePerson[] = []
  @property({ type: String, attribute: 'sync-state' }) syncState: ChromeSyncState = 'idle'
  @property({ type: String, attribute: 'runtime-mode' }) runtimeMode: ChromeRuntimeMode | null = null
  /** The honest mirror state's bottom-bar projection (master §3 Slice 4).
   *  `null` = never bound (the legacy inert slot survives); non-null with an
   *  empty `badges` array = bound and genuinely all-clear (renders nothing,
   *  which is different from never having been bound at all). */
  @property({ attribute: false }) sourceStatus: ChromeSourceStatus | null = null
  /** Controlled interaction state; the shell owns all mutations and effects. */
  @property({ attribute: false }) openPresenceId: string | null = null
  @property({ attribute: false }) followedPresenceClientId: string | null = null
  @property({ type: Boolean }) selfPresenceEditable = false
  @property({ attribute: false }) presenceColors: readonly string[] = []
  @property({ type: Boolean }) presenceOverflowOpen = false

  private _emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }

  private _setLeftMode(mode: ChromeLeftPanelMode): void {
    if (this.leftPanelMode === mode) return
    this._emit('mn-left-mode-change', { mode })
  }

  private _togglePanel(panel: ChromePanelId): void {
    this._emit('mn-panel-toggle', { panel })
  }

  private get _selectedPanel(): ChromePanelMode {
    if (this.panel !== undefined) return this.panel
    return this.panels.length > 0 ? this.panels[this.panels.length - 1] : 'none'
  }

  private _presenceInitial(person: ChromePresencePerson): string {
    if (person.type === 'agent') return '✦'
    return person.name.trim().slice(0, 1) || '?'
  }

  private _presenceLabel(person: ChromePresencePerson): string {
    const self = person.isSelf ? ' (you)' : ''
    const sessions = (person.sessionCount ?? 1) > 1
      ? ` · ${person.sessionCount} tabs`
      : ''
    const actor = person.type === 'agent' ? ' · Agent' : ''
    return `${person.name}${self}${actor}${sessions}`
  }

  /** One `<mn-badge>` per mirror badge. `right-collapsed` clears the VISIBLE
   *  label (glyph-only) so the badge's measured width is constant regardless
   *  of the count's digit length (see the `:host([right-collapsed])` CSS
   *  rule's own comment) — the count still reaches assistive tech via
   *  `aria-label`, and a sighted user via `hint`'s native title on hover.
   *
   *  `contested`/`parked` alone are `interactive` (a real `<button>`,
   *  keyboard-reachable) and emit `mn-source-badge-activate` (build bundle
   *  review finding 4, 2026-07-31) — controlled: this element reports only
   *  WHICH kind was activated, never navigates or mutates anything itself.
   *  `pending`/`unknown`/`needs-repair` stay plain, non-interactive spans;
   *  no destination surface exists for them. */
  private _renderSourceBadge(badge: ChromeSourceBadge) {
    const tone = badge.kind === 'contested' ? 'neutral' : SOURCE_BADGE_TONE[badge.kind]
    const activatable = badge.kind === 'contested' || badge.kind === 'parked'
    return html`<mn-badge
      class="source-badge"
      part="source-badge"
      data-source-badge=${badge.kind}
      state=${tone}
      glyph=${badge.glyph}
      label=${this.rightCollapsed ? '' : badge.label}
      .hint=${badge.hint}
      aria-label=${badge.accessibleName}
      ?interactive=${activatable}
      @click=${() => {
        if (activatable) {
          this._emit('mn-source-badge-activate', { kind: badge.kind } satisfies ChromeSourceBadgeActivateDetail)
        }
      }}
    ></mn-badge>`
  }

  private _renderMirrorGroup() {
    const badges = this.sourceStatus?.badges ?? []
    return html`<span
      class="status-group mirror-group"
      part="mirror-group"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Local source state"
      data-mirror-status
    >${badges.map(badge => this._renderSourceBadge(badge))}</span>`
  }

  private _renderPresenceOverflow(people: readonly ChromePresencePerson[]) {
    return html`<section class="presence-overflow-menu" role="menu" aria-label="More people present">
      ${people.map(person => html`<button
        type="button"
        role="menuitem"
        class="presence-overflow-person"
        data-overflow-presence-id=${person.id}
        @click=${() => this._emit('mn-presence-open', { person } satisfies ChromePresenceOpenDetail)}
      ><span class="presence-overflow-dot" style=${`--presence-color:${person.color}`}></span>
        <span>${person.name}</span>
        <small>${person.type === 'agent' ? 'Agent' : (person.isSelf ? 'You' : 'Human')}</small>
      </button>`)}
    </section>`
  }

  private _syncLabel(): string {
    if (this.syncState === 'synced') return 'Connected'
    if (this.syncState === 'connecting') return 'Connecting'
    if (this.syncState === 'reconnecting') return 'Reconnecting'
    if (this.syncState === 'disconnected') return 'Disconnected'
    if (this.syncState === 'error') return 'Sync error'
    return 'Offline'
  }

  /**
   * Mounts the REAL, separately-tagged `<mn-presence-inspector>` — not a
   * private re-render of its markup (see this file's own header). Its own
   * `<section>` already emits `mn-presence-close` on Escape and
   * `mn-presence-follow`/`mn-presence-self-update` on the real user
   * intents; every one is `composed: true`, so it crosses this shadow
   * boundary unchanged — this shell never re-emits or re-handles any of
   * them.
   */
  private _renderPresenceInspector(person: ChromePresencePerson) {
    return html`<mn-presence-inspector
      .person=${person}
      .followedPresenceClientId=${this.followedPresenceClientId}
      .selfPresenceEditable=${this.selfPresenceEditable}
      .presenceColors=${this.presenceColors}
      .showClose=${true}
    ></mn-presence-inspector>`
  }

  render() {
    const visiblePresence = this.presence.slice(0, 4)
    const overflowPresence = this.presence.slice(4)
    const inspectedPerson = this.openPresenceId
      ? this.presence.find(person => person.id === this.openPresenceId) ?? null
      : null
    return html`
      <div class="left-section" part="left-section">
        <div class="panel-toggles" role="group" aria-label="Left panel mode">
          <button
            class="toggle-btn ${this.leftPanelMode === 'files' ? 'active' : ''}"
            aria-pressed=${this.leftPanelMode === 'files' ? 'true' : 'false'}
            @click=${() => this._setLeftMode('files')}
            aria-label="Files"
            title="Files"
          ><span class="toggle-icon" aria-hidden="true">🗂</span><span class="toggle-label">Files</span></button>
          <button
            class="toggle-btn ${this.leftPanelMode === 'graph' ? 'active' : ''}"
            aria-pressed=${this.leftPanelMode === 'graph' ? 'true' : 'false'}
            @click=${() => this._setLeftMode('graph')}
            aria-label="Graph"
            title="Graph"
          ><span class="toggle-icon" aria-hidden="true">◈</span><span class="toggle-label">Graph</span></button>
          <button
            class="toggle-btn ${this.leftPanelMode === 'outline' ? 'active' : ''}"
            aria-pressed=${this.leftPanelMode === 'outline' ? 'true' : 'false'}
            @click=${() => this._setLeftMode('outline')}
            aria-label="Outline"
            title="Outline"
          ><span class="toggle-icon" aria-hidden="true">☰</span><span class="toggle-label">Outline</span></button>
        </div>
        <!--
          INERT left-status slot. Garden shows a live item count here (sourced
          from the filesystem). Empty unless a shell binds a count in — never a
          faked "0 items".
        -->
        ${this.itemCount == null
          ? html`<slot name="left-status" data-inert-slot="left-status"></slot>`
          : html`<span class="status-value" data-item-count>${this.itemCount} ${this.itemCount === 1 ? 'item' : 'items'}</span>`}
      </div>

      <!--
        INERT center-status slot. Garden shows live document stats here (word /
        char counts, selection, dates, block-type, export) sourced from the open
        document. Empty unless a shell binds real stats in — never faked.
      -->
      <div class="center-section" part="center-section">
        ${this.documentStats == null
          ? html`<slot name="center-status" data-inert-slot="center-status"></slot>`
          : html`<span class="status-group" data-document-stats>
              <span class="status-value">${this.documentStats.words} ${this.documentStats.words === 1 ? 'word' : 'words'}</span>
              <span class="status-divider" aria-hidden="true">·</span>
              <span class="status-value">${this.documentStats.characters} chars</span>
              ${this.documentStats.readingTimeMinutes != null
                ? html`<span class="status-divider" aria-hidden="true">·</span><span class="status-value">${this.documentStats.readingTimeMinutes < 1 ? '<1 min' : `${this.documentStats.readingTimeMinutes} min`} read</span>`
                : nothing}
              ${(this.documentStats.selectedCharacters ?? 0) > 0
                ? html`<span class="status-divider" aria-hidden="true">·</span><span class="status-value">${this.documentStats.selectedCharacters} selected</span>`
                : nothing}
              ${this.documentStats.blockType
                ? html`<span class="status-divider" aria-hidden="true">·</span><span class="status-value">${this.documentStats.blockType}</span>`
                : nothing}
              ${this.documentExportAvailable
                ? html`<span class="status-divider" aria-hidden="true">·</span><button
                    type="button"
                    class="export-btn"
                    title="Export document"
                    aria-label="Export document"
                    @click=${() => this._emit('mn-document-export')}
                  ><span aria-hidden="true">⬇</span> Export</button>`
                : nothing}
            </span>`}
      </div>

      <div class="right-section" part="right-section">
        <!--
          Two independent truths, two ARIA groups (master §3 Slice 4):
            - MIRROR (this device's honest local-source state — contested /
              pending / parked / unknown / needs-repair) is role="status"
              aria-live="polite" aria-atomic="true": durable facts about
              your own work deserve announcement.
            - LIVE (presence + hocuspocus sync + runtime pill) is
              aria-live="off": presence and WS sync FLAP and would spam a
              screen reader on every reconnect.
          The INERT right-status slot survives only when NEITHER is bound —
          sourceStatus === null (never bound; distinct from bound-and-
          empty) AND no live truth is bound either. Rendered as THREE FLAT
          sibling expressions (not one nested inside another) — a nested
          html-tagged template whose OWN static parts are all-whitespace
          silently fails to commit its children when it is itself the value
          of an outer ChildPart (verified empirically against this Lit
          version).
        -->
        ${this.sourceStatus === null && this.presence.length === 0 && this.syncState === 'idle' && this.runtimeMode == null
          ? html`<slot name="right-status" data-inert-slot="right-status"></slot>`
          : nothing}
        ${this.sourceStatus !== null ? this._renderMirrorGroup() : nothing}
        ${this.presence.length > 0 || this.syncState !== 'idle' || this.runtimeMode != null
          ? html`<span class="status-group live-group" part="live-group" aria-live="off" aria-label="Live session" data-live-status>
              ${this.presence.length > 0
                ? html`<span class="presence-stack" aria-label=${`${this.presence.length} present`}>
                    ${visiblePresence.map((person) => html`<button
                      type="button"
                      class="presence-avatar"
                      style=${`--presence-color:${person.color}`}
                      title=${this._presenceLabel(person)}
                      aria-label=${`Open presence for ${this._presenceLabel(person)}`}
                      aria-haspopup="dialog"
                      aria-expanded=${this.openPresenceId === person.id ? 'true' : 'false'}
                      data-presence-id=${person.id}
                      data-session-count=${person.sessionCount ?? 1}
                      data-actor-type=${person.type ?? 'human'}
                      @click=${() => this._emit('mn-presence-open', { person } satisfies ChromePresenceOpenDetail)}
                    >${this._presenceInitial(person)}${(person.sessionCount ?? 1) > 1
                      ? html`<span class="presence-count" aria-hidden="true">${person.sessionCount}</span>`
                      : nothing}</button>`)}
                    ${overflowPresence.length > 0 ? html`<button
                      type="button"
                      class="presence-overflow-trigger"
                      data-presence-overflow
                      aria-label=${`Show ${overflowPresence.length} more present`}
                      aria-haspopup="menu"
                      aria-expanded=${this.presenceOverflowOpen ? 'true' : 'false'}
                      @click=${() => this._emit('mn-presence-overflow-toggle', {
                        open: !this.presenceOverflowOpen,
                      })}
                    >+${overflowPresence.length}</button>` : nothing}
                  </span>`
                : nothing}
              <span class="sync-state" data-state=${this.syncState} title=${this._syncLabel()}>
                <span class="sync-dot" aria-hidden="true"></span><span>${this._syncLabel()}</span>
              </span>
              ${this.runtimeMode ? html`<span class="runtime-pill">${this.runtimeMode}</span>` : nothing}
            </span>`
          : nothing}
        <div class="panel-toggles" role="group" aria-label="Right panels">
          <button
            class="toggle-btn ${this._selectedPanel === 'chat' ? 'active' : ''}"
            aria-pressed=${this._selectedPanel === 'chat' ? 'true' : 'false'}
            @click=${() => this._togglePanel('chat')}
            aria-label="Toggle Sophia panel"
            title="Toggle Sophia panel"
          ><span class="toggle-icon" aria-hidden="true">✦</span><span class="toggle-label">Sophia</span></button>
          <button
            class="toggle-btn ${this._selectedPanel === 'comments' ? 'active' : ''}"
            aria-pressed=${this._selectedPanel === 'comments' ? 'true' : 'false'}
            @click=${() => this._togglePanel('comments')}
            aria-label="Toggle comments panel"
            title="Toggle comments panel"
          ><span class="toggle-icon" aria-hidden="true">💬</span><span class="toggle-label">Comments</span></button>
          <button
            class="toggle-btn ${this._selectedPanel === 'wires' ? 'active' : ''}"
            aria-pressed=${this._selectedPanel === 'wires' ? 'true' : 'false'}
            @click=${() => this._togglePanel('wires')}
            aria-label="Toggle wires panel"
            title="Toggle wires panel"
          ><span class="toggle-icon" aria-hidden="true">🔌</span><span class="toggle-label">Wires</span></button>
          <button
            class="toggle-btn ${this._selectedPanel === 'graph' ? 'active' : ''}"
            aria-pressed=${this._selectedPanel === 'graph' ? 'true' : 'false'}
            @click=${() => this._togglePanel('graph')}
            aria-label="Toggle graph panel"
            title="Toggle graph panel"
          ><span class="toggle-icon" aria-hidden="true">◈</span><span class="toggle-label">Graph</span></button>
        </div>
        ${this.presenceOverflowOpen && overflowPresence.length > 0
          ? this._renderPresenceOverflow(overflowPresence)
          : nothing}
        ${inspectedPerson ? this._renderPresenceInspector(inspectedPerson) : nothing}
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-bottom-bar': MnBottomBar
  }
}
