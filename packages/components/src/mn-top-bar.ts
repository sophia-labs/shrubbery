/**
 * mn-top-bar — the CHROME top-bar shell (backend-free).
 *
 * STRUCTURE lifted from garden/frontend/src/components/layout/mn-top-bar.ts
 * (READ-ONLY source). What garden's top bar is: a flex row of
 *   masthead(brand) → app-switcher → breadcrumbs(nav) → actions(buttons).
 *
 * What was DROPPED in the lift (this is what makes it backend-free):
 *   - EVERY store/controller import: sessionStore, filesystemStore, billingStore,
 *     apiCacheStore, ApiClient, ThemeController, nativeBridge, runtimeConfig.
 *     None are read; the component holds no zustand subscription and no token.
 *   - the breadcrumb DATA (workspace name, document title, sync state) — those
 *     come from sessionStore/filesystemStore in garden. Here the breadcrumb area
 *     is an INERT slot (`<slot name="breadcrumbs">`): a shell that has a live
 *     session binds real crumbs into it; with no binding it renders EMPTY. We do
 *     NOT fabricate "Select Workspace" / a fake doc title.
 *   - the share panel / members / directory search (all REST + apiCacheStore)
 *     — out of scope for chrome; not lifted. Quick Clip is present only as the
 *     backend-free controlled mn-quick-clip surface; the shell still owns all
 *     fetching, auth, progress, errors, and refresh behavior.
 *   - the rename/delete/create dialogs (sessionStore actions) — not lifted.
 *   - the native title-bar drag guard (Tauri-only) — not lifted.
 *
 * What was KEPT as REAL chrome (no backend coupling — pure DOM + events):
 *   - the app picker (current app tile + name) opening an Office-style app
 *     launcher, and to its right the contextual app toolbar, whose buttons are
 *     declared per app in app-toolbar.ts (Garden: Home → `mn-navigate-home`).
 *   - the app-switcher (Garden / Choreograph toggle): a controlled tab strip.
 *     `activeApp` is a PROPERTY a shell sets; clicking a tab emits
 *     `mn-app-change` (detail.app) and does NOT mutate any store.
 *   - the action buttons (theme / skin / settings): chrome that emits composed
 *     events (`mn-theme-toggle`, `mn-skin-select`, `mn-settings-toggle`); their
 *     pressed state is driven by PROPERTIES, never read from a theme store.
 *
 * This is a REAL @customElement, not a stub-that-pretends: it renders the chrome
 * shell with working interactions, and leaves the one data-bearing area (the
 * breadcrumb trail) as an inert, clearly-labeled slot rather than faking data.
 *
 * SKIN-AWARE (iteration 3b): the component mirrors the ambient [data-skin] /
 * [data-theme] onto its own host (via the SkinAware mixin — pure DOM, no
 * backend) so its shadow CSS can light up `:host([data-skin=emporium])` rules
 * and consume the skin's density / radius / label-display role tokens. Under
 * Emporium the chrome becomes 24px-tight, square-shouldered, and icon-only
 * (labels hidden via --mn-label-display); under Garden it stays the comfortable
 * rounded fern chrome. The accent / font / surface colors flow in for free
 * through the inherited --mn-* custom properties (no per-skin color code here).
 *
 * Dependencies: lit ONLY (+ nucleus contract TYPES are import-type-able but this
 * component needs none of them). The skin contract with @shrubbery/tokens is the
 * ATTRIBUTE + CSS-var NAMES, never a module import. grep-verified by the island
 * test — NO stores, NO auth, NO tauri, NO @shrubbery/runtime.
 */

import { LitElement, css, html, nothing, unsafeCSS } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { BEVELLED } from './bevelled-skins.js'
import { icon, iconStyles } from './icons.js'
import { CHROME_PICKER_SKINS, type ChromeSkinId } from './chrome-skin.js'
import './mn-skin-picker.js'
import { hidePopover, isPopoverOpen, positionPopover, showPopover } from './popover.js'
import { appToolbarActions, type AppToolbarAction } from './app-toolbar.js'
import { orderSophiaApps, sophiaApp, sophiaAppAccessibleName } from './sophia-suite.js'
import './mn-workspace-selector.js'
import './mn-quick-clip.js'
import './mn-access-manager.js'
import type { MnWorkspaceSelectorStatus, MnWorkspaceSummary } from './mn-workspace-selector.js'
import type { MnWorkspaceActionCapability } from './mn-workspace-selector-model.js'
import type { MnQuickClipStatus } from './mn-quick-clip.js'
import type { MnAccessManagerModel } from './mn-access-manager.js'

const WORKSPACE_CREATE_ENABLED: MnWorkspaceActionCapability = Object.freeze({ available: true })
const WORKSPACE_CREATE_ABSENT: MnWorkspaceActionCapability = Object.freeze({ available: false })

/**
 * An app id (the gen-2 dim-app dimension). OPEN — any string a workspace
 * config declares via `appRootRegions`, not a closed union. Slice 10: the
 * switcher used to hardcode exactly `'garden' | 'choreograph'`; it now renders
 * whatever `apps` tabs the shell supplies (config-derived), so this alias is
 * documentation, not a constraint the component enforces.
 */
export type ChromeAppId = string

/**
 * One tab the app switcher renders — the shell computes this list from the
 * active workspace config's declared apps (`deriveAppTabs`, nucleus
 * interpreter); `mn-top-bar` itself holds no app list and mints no ids.
 */
export interface ChromeAppTab {
  readonly id: ChromeAppId
  readonly label: string
  /** An icons.ts glyph name. Absent ⇒ no icon, label-only tab. */
  readonly icon?: string
  /** One line for the app launcher. Absent ⇒ a known app's default, else none. */
  readonly description?: string
  /** Release stage tag ('experimental', …). Absent ⇒ a known app's catalogue stage, else none. */
  readonly stage?: string
}

/**
 * One app the launcher opens by NAVIGATING (a different page: the standalone
 * Hoja app, the Choreograph route, Garden from outside the organism) rather
 * than by an in-shell `mn-app-change`. The shell builds `href` so the target
 * lands in the same workspace (`sophiaAppHref`, `?graph=`).
 */
export interface ChromeAppLink extends ChromeAppTab {
  readonly href: string
}

/** The built-in right-side controls a shell may show (see `controls`). */
export type ChromeControl = 'appearance' | 'quick-clip' | 'access' | 'theme' | 'skin' | 'settings'

/** One launcher row: an in-shell tab (event) or a link (navigation). */
type LauncherEntry =
  | { readonly kind: 'tab'; readonly app: ChromeAppTab }
  | { readonly kind: 'link'; readonly app: ChromeAppLink }

export type { ChromeSkinId } from './chrome-skin.js'

export interface ChromeBreadcrumb {
  readonly id: string
  readonly label: string
  readonly kind?: 'graph' | 'document' | 'artifact' | 'view'
  readonly current?: boolean
  readonly disabled?: boolean
}

export interface ChromeBreadcrumbOpenDetail {
  readonly breadcrumb: ChromeBreadcrumb
}

export interface ChromeBreadcrumbMenuOpenDetail {
  readonly breadcrumb: ChromeBreadcrumb
  readonly x: number
  readonly y: number
}

@customElement('mn-top-bar')
export class MnTopBar extends SkinAware(LitElement) {
  static styles = css`
    /* Shadow DOM does NOT inherit garden's global icon stylesheet, so the inline
       <svg> icons need this rule locally to follow text color (stroke:
       currentColor) instead of rendering black/invisible. */
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      align-items: center;
      height: var(--mn-top-bar-height, 40px);
      min-height: var(--mn-top-bar-height, 40px);
      flex: 0 0 var(--mn-top-bar-height, 40px);
      padding: 0 var(--mn-space-5, 16px);
      background: var(--mn-top-bar-bg, #fff);
      border-bottom: 1px solid var(--mn-top-bar-border, #e5e7eb);
      gap: var(--mn-space-5, 16px);
      box-sizing: border-box;
      box-shadow: var(--mn-shadow-chrome, 0 1px 4px rgba(0, 0, 0, 0.05));
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      position: relative;
      z-index: 2;
    }

    /* ── Contextual app toolbar ─────────────────────────────────────────────
       Icon-only buttons declared per app in app-toolbar.ts. A hairline rule
       separates them from the picker; they share the action buttons' size,
       radius, hover and focus treatment so the bar reads as one instrument. */
    .app-toolbar {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
      padding-left: var(--mn-space-2, 8px);
      margin-left: calc(var(--mn-space-2, 8px) * -1);
      border-left: 1px solid var(--mn-top-bar-border, rgba(0, 0, 0, 0.12));
    }
    .app-toolbar[hidden] { display: none; }
    .toolbar-btn:disabled { opacity: 0.45; cursor: default; }
    .toolbar-btn:disabled:hover { background: transparent; color: var(--mn-top-bar-text-muted, #6b7280); }

    /* ── Current app (the Office-style picker trigger) ── */
    .app-title {
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }
    .app-picker {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 32px;
      padding: 0 8px 0 5px;
      border: 1px solid transparent;
      border-radius: var(--mn-radius-lg, 8px);
      background: transparent;
      color: var(--mn-top-bar-text, #111);
      font: inherit;
      cursor: pointer;
      transition: background var(--mn-transition-fast, 120ms ease), border-color var(--mn-transition-fast, 120ms ease);
    }
    .app-picker:disabled {
      cursor: default;
    }
    .app-picker:hover:not(:disabled),
    .app-picker[aria-expanded='true'] {
      background: var(--mn-color-surface-hover, rgba(0, 0, 0, 0.05));
      border-color: var(--mn-top-bar-border, rgba(0, 0, 0, 0.1));
    }
    .masthead-name {
      font-family: var(--mn-font-display, var(--mn-font-serif, Georgia, serif));
      font-size: var(--mn-text-md, 16px);
      font-weight: 600;
      letter-spacing: -0.005em;
      line-height: 1;
      color: var(--mn-top-bar-text, #111);
      white-space: nowrap;
    }
    .masthead-badge {
      padding: 2px 5px;
      border: 1px solid var(--mn-top-bar-border, rgba(0, 0, 0, 0.12));
      border-radius: var(--mn-radius-full, 9999px);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.07em;
      line-height: 1;
      text-transform: uppercase;
      color: var(--mn-top-bar-text-muted, #4b5563);
    }
    .masthead-badge[hidden],
    .app-picker-caret[hidden] { display: none; }
    .app-picker-caret {
      display: inline-flex;
      color: var(--mn-top-bar-text-muted, #4b5563);
    }

    /* App tiles: one colour-coded glyph square per app (Office's launcher
       grammar). Tile colours are brand constants from component.css. */
    .app-tile {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: var(--mn-app-tile-default, var(--mn-color-accent, #376d57));
      color: #fff;
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.10);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: 12px;
      font-weight: 700;
    }
    .app-tile[data-app-id='garden'] { background: var(--mn-app-tile-garden, var(--mn-app-tile-default)); }
    .app-tile[data-app-id='choreograph'] { background: var(--mn-app-tile-choreograph, var(--mn-app-tile-default)); }
    .app-tile[data-app-id='hoja'] { background: var(--mn-app-tile-hoja, var(--mn-app-tile-garden, var(--mn-app-tile-default))); }
    .app-tile[data-app-id='grapevine'] { background: var(--mn-app-tile-grapevine, var(--mn-app-tile-default)); }
    .app-tile[data-app-id='flow'] { background: var(--mn-app-tile-flow, var(--mn-app-tile-default)); }
    .app-tile[data-app-id='ovillo'] { background: var(--mn-app-tile-ovillo, var(--mn-app-tile-default)); }

    /* ── Floating panel: the app launcher ────────────────────────────────────
       Native top layer (popover="auto": light dismiss + Escape for free), so
       no ancestor transform/filter/overflow can clip it. This is the ONLY
       glass in the header: Garden's --mn-material-popover-* material. */
    .app-switcher {
      position: fixed;
      inset: auto;
      margin: 0;
      box-sizing: border-box;
      padding: 8px;
      border: 1px solid var(--mn-material-popover-edge, var(--mn-color-border-default, #d1d5db));
      border-radius: var(--mn-radius-popover, 16px);
      background: var(--mn-material-popover-bg, var(--mn-color-surface-raised, #fff));
      color: var(--mn-color-text-primary, #111827);
      box-shadow: var(--mn-material-popover-shadow, var(--mn-shadow-lg, 0 18px 40px rgba(15, 23, 42, 0.16)));
      backdrop-filter: var(--mn-material-popover-filter, var(--mn-window-backdrop-filter, none));
      -webkit-backdrop-filter: var(--mn-material-popover-filter, var(--mn-window-backdrop-filter, none));
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      opacity: 1;
      transform: none;
      transform-origin: top left;
      transition:
        opacity var(--mn-transition-fast, 120ms ease),
        transform var(--mn-transition-fast, 120ms ease),
        display var(--mn-transition-fast, 120ms ease) allow-discrete,
        overlay var(--mn-transition-fast, 120ms ease) allow-discrete;
    }
    .app-switcher:not(:popover-open):not([popover-open]),
    .app-switcher[hidden] {
      display: none;
    }
    @starting-style {
      .app-switcher:popover-open {
        opacity: 0;
        transform: translateY(-4px) scale(0.98);
      }
    }
    .app-switcher { width: 332px; }

    .panel-caption {
      padding: 6px 8px 8px;
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: 11px;
      font-weight: 650;
      letter-spacing: var(--mn-tracking-label, 0.05em);
      text-transform: uppercase;
      color: var(--mn-material-popover-text-muted, var(--mn-color-text-muted, #4b5563));
    }
    .app-grid {
      display: grid;
      gap: 2px;
    }
    .app-switcher-btn {
      display: grid;
      grid-template-columns: 36px 1fr auto;
      align-items: center;
      column-gap: 12px;
      /* A launcher row may be an <a> (an app link): border-box keeps width + padding inside the panel. */
      box-sizing: border-box;
      width: 100%;
      padding: 8px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--mn-color-text-primary, #111);
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: background var(--mn-transition-fast, 120ms ease);
      text-decoration: none;
    }
    .app-switcher-btn .app-tile {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      font-size: 16px;
    }
    .app-switcher-btn:hover,
    .app-switcher-btn:focus-visible {
      outline: none;
      background: var(--mn-color-interactive-hover, rgba(0, 0, 0, 0.05));
    }
    .app-switcher-btn--active {
      background: var(--mn-color-interactive-selected, rgba(0, 0, 0, 0.08));
      cursor: default;
    }
    .switcher-text {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    .switcher-label {
      font-family: var(--mn-font-display, var(--mn-font-serif, Georgia, serif));
      font-size: 14px;
      font-weight: 650;
      line-height: 1.15;
    }
    /* Release stage tag beside an app's name (sophia-suite SophiaAppStage).
       Tokens only, so it follows light, dark and every skin; inline, so it
       wraps with the label at phone width instead of widening the row. */
    .switcher-name {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 3px 6px;
      min-width: 0;
    }
    .app-stage {
      display: inline-block;
      padding: 2px 6px;
      border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
      border-radius: var(--mn-radius-full, 9999px);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.07em;
      line-height: 1;
      text-transform: uppercase;
      white-space: nowrap;
      color: var(--mn-material-popover-text-muted, var(--mn-color-text-secondary, #4b5563));
    }
    .switcher-description {
      /* Skin label flag: icon-only skins (emporium) drop the one-liners. */
      display: var(--mn-label-display, inline);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-size: 12px;
      line-height: 1.3;
      color: var(--mn-material-popover-text-muted, var(--mn-color-text-secondary, #4b5563));
    }
    .switcher-check {
      display: inline-flex;
      color: var(--mn-color-text-accent, #376d57);
      visibility: hidden;
    }
    .app-switcher-btn--active .switcher-check { visibility: visible; }

    /* ── Breadcrumbs (INERT data slot) ── */
    .breadcrumbs {
      display: flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      flex: 1;
      min-width: 0;
      font-family: var(--mn-font-utility, system-ui, sans-serif);
    }
    /* When nothing is slotted, the area is genuinely empty (no faked crumbs). */
    .breadcrumbs::slotted(*) {
      min-width: 0;
    }
    .breadcrumb-list {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      overflow: hidden;
    }
    .breadcrumb {
      max-width: min(28ch, 32vw);
      overflow: hidden;
      padding: 2px 4px;
      border: 0;
      border-radius: var(--mn-radius-control, 4px);
      background: transparent;
      color: var(--mn-top-bar-text-muted, #6b7280);
      cursor: pointer;
      font: inherit;
      font-size: var(--mn-text-xs, 12px);
      transition:
        background var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .breadcrumb:hover:not(:disabled) {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-top-bar-text, #111);
    }
    .breadcrumb[aria-current='page'] {
      color: var(--mn-top-bar-text, #111);
      cursor: default;
      font-weight: 650;
    }
    .breadcrumb--menu[aria-current='page'] {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      cursor: pointer;
    }
    .breadcrumb-menu-caret {
      display: inline-flex;
      color: var(--mn-top-bar-text-muted, #9ca3af);
    }
    .breadcrumb--menu:hover .breadcrumb-menu-caret,
    .breadcrumb--menu:focus-visible .breadcrumb-menu-caret {
      color: var(--mn-top-bar-text, #111);
    }
    .breadcrumb-separator {
      flex: 0 0 auto;
      color: var(--mn-top-bar-text-muted, #9ca3af);
    }

    /* ── Right actions ── */
    .actions {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 6px);
      flex-shrink: 0;
    }
    .actions .action-btn[hidden] { display: none; }
    .action-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      /* Density role: a control is --mn-control-height square. Garden 28px,
         Emporium tight 24px. (Was a fixed 32px before skinning.) */
      width: var(--mn-control-height, 32px);
      height: var(--mn-control-height, 32px);
      /* WebKit's default button padding on macOS is uneven (2px top, 3px
         bottom), which set every icon half a pixel high. */
      padding: 0;
      border: none;
      /* Control radius role: Garden rounded, Emporium square. */
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-top-bar-text-muted, #6b7280);
      cursor: pointer;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease),
        box-shadow var(--mn-transition-fast, 120ms ease);
      font-size: 16px;
    }
    .appearance-btn {
      white-space: nowrap;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: 13px;
      font-weight: 600;
      letter-spacing: -0.04em;
    }
    .action-btn:hover {
      background: var(--mn-color-surface-accent, #f3f4f6);
      color: var(--mn-top-bar-text, #111);
    }
    .action-btn.active {
      background: var(--mn-color-surface-accent-strong, #eef2ff);
      color: var(--mn-color-text-accent-strong, #4338ca);
      box-shadow: inset 0 0 0 1px var(--mn-color-border-subtle, transparent);
    }
    .app-picker:focus-visible,
    .app-switcher-btn:focus-visible,
    .breadcrumb:focus-visible,
    .action-btn:focus-visible {
      outline: none;
      box-shadow: var(--mn-focus-ring, 0 0 0 2px currentColor);
    }

    /* ── EMPORIUM skin (sophia structure) overrides ──────────────────────────
       The host carries data-skin=emporium (mirrored from the ambient root by the
       SkinAware mixin), so these light up portably (no :host-context needed). The
       density / radius / label flags already flow through the role tokens above;
       these add the STRUCTURAL bits a token alone can't express. */
    :host([data-skin='emporium']) {
      /* Region boundary = the stronger Emporium frame rule (Albers figure-ground)
         rather than Garden's soft 2px parchment border. */
      border-bottom: var(--mn-chrome-rule, 1px solid var(--mn-color-border-strong, #e5e7eb));
    }
    /* Icon-only: swap the brand serif name for the compact glyph already shown,
       and surface the per-tab icon glyph in place of the hidden caption. */
    :host([data-skin='emporium']) .masthead-name {
      font-family: var(--mn-font-chrome, inherit);
      letter-spacing: var(--mn-tracking-label, 0.05em);
      text-transform: uppercase;
      font-size: var(--mn-text-sm, 13px);
    }
    :host([data-skin='emporium']) .app-switcher {
      border-radius: var(--mn-radius-surface, 4px);
    }
    :host([data-skin='emporium']) :is(.app-switcher-btn, .app-switcher-btn .app-tile) {
      border-radius: var(--mn-radius-control, 3px);
    }

    /* ── 98 skin structural overrides ───────────────────────────────
       The caption bar remains the host background. Controls inside it become
       discrete silver widgets with period-correct raised/sunken bevels. */
    :host(${BEVELLED}) {
      padding-inline: 6px;
      gap: 8px;
      border: 2px solid var(--mn-98-face, #c0c0c0);
      border-bottom-color: var(--mn-98-dark, #000);
    }
    :host(${BEVELLED}) .app-picker {
      border-radius: 0;
    }
    :host(${BEVELLED}) .app-toolbar {
      border-left-color: var(--mn-98-dark, #000);
    }
    :host(${BEVELLED}) .app-picker:hover:not(:disabled),
    :host(${BEVELLED}) .app-picker[aria-expanded='true'] {
      background: transparent;
      border-color: transparent;
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='98']) .app-switcher {
      border: 0;
      border-radius: 0;
      padding: 3px;
      background: var(--mn-98-face, #c0c0c0);
      box-shadow: var(--mn-98-raised), 2px 2px 0 rgba(0, 0, 0, 0.45);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
    :host(${BEVELLED}) :is(.app-switcher-btn, .app-switcher-btn .app-tile) {
      border-radius: 0;
    }
    :host(${BEVELLED}) .app-switcher-btn:hover,
    :host(${BEVELLED}) .app-switcher-btn:focus-visible {
      background: var(--mn-98-selection, #000080);
      color: var(--mn-98-selection-text, #fff);
    }
    :host(${BEVELLED}) .app-switcher-btn:hover :is(.switcher-description, .switcher-check),
    :host(${BEVELLED}) .app-switcher-btn:focus-visible :is(.switcher-description, .switcher-check) {
      color: var(--mn-98-selection-text, #fff);
    }
    :host(${BEVELLED}) .masthead-name {
      font-size: 13px;
      font-weight: 750;
      letter-spacing: 0;
      text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.55);
    }
    :host(${BEVELLED}) .masthead-badge {
      border-color: currentColor;
      color: var(--mn-top-bar-text, #fff);
      letter-spacing: 0;
    }
    :host(${BEVELLED}) .app-picker-caret {
      color: var(--mn-top-bar-text, #fff);
    }
    :host(${BEVELLED}) .app-switcher-btn--active {
      box-shadow: var(--mn-98-sunken);
    }
    :host(${BEVELLED}) .breadcrumb:hover:not(:disabled) {
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-raised);
    }
    :host(${BEVELLED}) .action-btn {
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-raised);
    }
    :host(${BEVELLED}) .action-btn:hover {
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
    }
    :host(${BEVELLED}) .action-btn:active,
    :host(${BEVELLED}) .action-btn.active {
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-sunken);
      transform: translate(1px, 1px);
    }

    /* Glass chrome keeps the existing information architecture and replaces
       only its material: polished translucent bars and luminous controls. */
    :host([data-skin='glass']) {
      border: 1px solid var(--mn-top-bar-border);
      border-top-color: rgba(255, 255, 255, 0.82);
      border-radius: 0 0 var(--mn-radius-surface) var(--mn-radius-surface);
      box-shadow: var(--mn-shadow-chrome);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) .app-picker {
      text-shadow: 0 1px 0 rgba(255, 255, 255, 0.62);
    }
    :host([data-skin='glass']) .action-btn {
      border: var(--mn-control-border);
      background: var(--mn-control-background);
      box-shadow: var(--mn-control-shadow);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) .breadcrumb:hover:not(:disabled),
    :host([data-skin='glass']) .action-btn:hover {
      background: var(--mn-control-background-hover);
    }
    :host([data-skin='glass']) .action-btn:active,
    :host([data-skin='glass']) .action-btn.active {
      background: var(--mn-control-background-active);
      box-shadow: var(--mn-control-shadow-active);
    }

    /* ── Phone widths ─────────────────────────────────────────────────────
       One bar at every width, in every app: at 600px and below the bar keeps
       the picker (tile + name), the app toolbar and theme + settings, and
       folds the rest so nothing overflows a 390px screen. The breadcrumb
       region is the only flexible part; it shrinks first. */
    @media (max-width: 600px) {
      :host {
        padding: 0 var(--mn-top-bar-compact-padding, 8px);
        gap: 6px;
      }
      :host(${BEVELLED}) { padding-inline: 4px; gap: 4px; }
      .app-picker { gap: 6px; padding: 0 4px 0 3px; }
      .masthead-name { font-size: 15px; }
      .app-toolbar { padding-left: 4px; margin-left: 0; }
      .actions { gap: 2px; }
      .appearance-btn,
      .skin-action { display: none; }
      .breadcrumb { max-width: 40vw; }
      .app-switcher { width: min(332px, calc(100vw - 16px)); }
    }
    /* Phone portrait: the picker is the app's tile + caret (the name stays
       its accessible label and heads the launcher), leaving the breadcrumb
       region room for the workspace / document title. */
    @media (max-width: 480px) {
      .masthead-name,
      .masthead-badge { display: none; }
    }
  `

  /**
   * The active app id — a CONTROLLED property a shell sets (gen-2 dim-app). NOT
   * read from sessionStore; the component is a pure function of this prop.
   * May legitimately match NO entry in `apps` (a stale/programmatic app the
   * active config doesn't declare) — the switcher then simply shows no tab as
   * active, rather than guessing. See `apps` and the confess-absence render
   * host (`render-workspace.ts`), which is what actually explains that state.
   */
  @property({ type: String, attribute: 'active-app' }) activeApp: ChromeAppId = 'garden'

  /**
   * The apps to render as tabs, IN ORDER — config-derived (Slice 10,
   * `06-observatory-app-dimension-defect.md` D1). Empty (the default) HIDES
   * the switcher entirely (zero pixels, out of tab order, `hidden` reflected):
   * a route with no workspace config (auth, settings, …) has nothing to
   * switch between, and a dead/disabled tab would be a worse answer than
   * confessing there is no switcher here. This replaced a hardcoded
   * two-button Garden/Choreograph strip — `mn-top-bar` itself now holds no
   * app list and mints no ids; it only ever renders what it's given.
   *
   * The switcher's wrapping `<div>` is ALWAYS in the template (never a
   * conditionally-included ChildPart) and toggles via `?hidden=`, not DOM
   * presence — this is deliberate, not stylistic. This exact template
   * position (a ChildPart sibling of the masthead) miscompiles under this
   * project's pinned lit-html/happy-dom versions when it is EVER bound an
   * empty value (`nothing`, `[]`, even an empty `html\`\``, unconditionally
   * or not): a later, unrelated attribute binding
   * (`.app-actions`'s `data-active-skin`) is committed a stale directive
   * result and throws `unsafeHTML() can only be used in child bindings` on
   * the very first render — reproduced down to a bare `${[]}` at this exact
   * spot with no other change. Filed nowhere upstream yet; worked around
   * here by keeping this ChildPart's shape constant and moving the
   * emptiness into an attribute instead.
   */
  @property({ attribute: false }) apps: readonly ChromeAppTab[] = []

  /**
   * The CURRENT APP's title when no `apps` are configured (a route with no
   * workspace config). With apps, the title is the active app's label.
   */
  @property({ type: String }) brand = 'Garden'

  /** The suite name that captions the app launcher ("Sophia apps"). */
  @property({ type: String, attribute: 'suite-name' }) suiteName = 'Sophia'

  /**
   * Override for the contextual toolbar. Null (the default) reads the active
   * app's declared set from the registry in app-toolbar.ts; an array replaces
   * it (a shell or story with its own set).
   */
  @property({ attribute: false }) toolbarActions: readonly AppToolbarAction[] | null = null

  /** Standalone apps may supply their own actions in the slot. */
  @property({ type: Boolean, attribute: 'custom-actions-only' }) customActionsOnly = false

  /**
   * Suite route for the standalone Hoja app, separate from graph-local app
   * tabs. Sugar for an `appLinks` Hoja entry; kept for existing shells.
   */
  @property({ type: String }) hojaHref = ''

  /**
   * Apps the launcher opens by navigation (see ChromeAppLink). Merged with
   * `apps` into ONE list in the suite's canonical order (sophia-suite.ts); an
   * in-shell tab wins over a link with the same id.
   */
  @property({ attribute: false }) appLinks: readonly ChromeAppLink[] = []

  /**
   * Which built-in right-side controls render. Null (the default) = all of
   * them, unless `customActionsOnly` is set (then none). An app that owns only
   * some of them (Hoja: its own theme, no skins) lists exactly those.
   */
  @property({ attribute: false }) controls: readonly ChromeControl[] | null = null

  /**
   * The masthead brand glyph — a configurable ICON NAME (see icons.ts), default a
   * real sprout icon (the fern brand) instead of an emoji. A shell may set any
   * registered icon name (e.g. 'hexagon', 'leaf', 'diamond').
   */
  @property({ type: String }) glyph = 'sprout'

  /** Optional badge beside the app title (e.g. 'staging'). Empty — the default — renders nothing. */
  @property({ type: String }) badge = ''

  /** Dark-mode pressed state — a CONTROLLED prop, never read from a theme store. */
  @property({ type: Boolean, attribute: 'is-dark' }) isDark = false

  /** Current visual identity — a CONTROLLED prop, never read from a store. */
  @property({ type: String, attribute: 'active-skin' }) activeSkin: ChromeSkinId = 'garden'

  /** The skins the picker offers, in order; a shell with its own set passes it once. */
  @property({ attribute: false }) skins: readonly ChromeSkinId[] = CHROME_PICKER_SKINS

  /** Live graph/document path supplied by the shell. Empty preserves the slot seam. */
  @property({ attribute: false }) breadcrumbs: readonly ChromeBreadcrumb[] = []

  /** Null preserves the original inert breadcrumb-only seam. An array enables tenancy UI. */
  @property({ attribute: false }) workspaces: readonly MnWorkspaceSummary[] | null = null

  @property({ type: String }) workspaceStatus: MnWorkspaceSelectorStatus = 'idle'
  @property({ type: String }) workspaceError = ''
  @property({ type: String }) activeWorkspaceId = ''
  @property({ type: String }) workspaceBusyId = ''
  /** False leaves "New Workspace" out of the selector (a person who may not create graphs). */
  @property({ type: Boolean, attribute: 'workspace-create-available' }) workspaceCreateAvailable = true

  /** Controlled Quick Clip visibility/status; absent graph means no trigger. */
  @property({ type: Boolean }) quickClipAvailable = false
  @property({ type: String }) quickClipStatus: MnQuickClipStatus = 'idle'
  @property({ type: String }) quickClipError = ''

  /** Hosted gateway member grants. Null means this deployment has no access surface. */
  @property({ attribute: false }) access: MnAccessManagerModel | null = null

  @state() private _appsOpen = false
  /** Was the launcher open when the pointer went down on its trigger? (light
      dismiss closes it on pointerdown; the click that follows must not reopen it.) */
  private _openAtPointerDown = false

  private _launcher(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('.app-switcher')
  }

  private _picker(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('.app-picker')
  }

  private _notePointer(): void {
    const panel = this._launcher()
    this._openAtPointerDown = panel ? isPopoverOpen(panel) : false
  }

  private _toggleLauncher(): void {
    const panel = this._launcher()
    const trigger = this._picker()
    if (!panel || !trigger) return
    const wasOpen = this._openAtPointerDown || isPopoverOpen(panel)
    this._openAtPointerDown = false
    if (wasOpen) {
      this._closeLauncher()
      return
    }
    showPopover(panel)
    positionPopover(trigger, panel, { placement: 'bottom-start', gap: 8 })
    this._appsOpen = true
    const first = panel.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')
    first?.focus({ preventScroll: true })
  }

  private _closeLauncher(restoreFocus = false): void {
    const panel = this._launcher()
    if (panel && isPopoverOpen(panel)) hidePopover(panel)
    this._appsOpen = false
    if (restoreFocus) this._picker()?.focus({ preventScroll: true })
  }

  /** Native light dismiss / Escape close the launcher without our help; mirror it. */
  private _onToggle(event: Event): void {
    const open = (event as Event & { newState?: string }).newState === 'open'
    this._appsOpen = open
    if (!open) {
      // A native close must also clear the attribute fallback, or
      // isPopoverOpen() keeps reporting a closed launcher as open and the next
      // picker click "closes" it instead of opening it.
      this._launcher()?.removeAttribute('popover-open')
      const active = this.shadowRoot?.activeElement
      if (active && this._launcher()?.contains(active)) this._picker()?.focus({ preventScroll: true })
    }
  }

  /** Left/Right/Home/End move between toolbar buttons (Tab leaves the group). */
  private _onToolbarKeydown(event: KeyboardEvent): void {
    const bar = event.currentTarget as HTMLElement
    const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
    if (buttons.length < 2) return
    const index = buttons.indexOf(this.shadowRoot?.activeElement as HTMLButtonElement)
    let next = -1
    if (event.key === 'ArrowRight') next = (index + 1) % buttons.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = buttons.length - 1
    if (next < 0) return
    event.preventDefault()
    buttons[next].focus()
  }

  /** The launcher rows: tabs + links (+ the Hoja sugar), one per id, in suite order. */
  launcherEntries(): readonly LauncherEntry[] {
    const tabs = this.apps.map(app => ({ kind: 'tab', app }) as const)
    const seen = new Set(this.apps.map(app => app.id))
    const links: LauncherEntry[] = []
    const allLinks: ChromeAppLink[] = [...this.appLinks]
    if (this.hojaHref && !allLinks.some(link => link.id === 'hoja')) {
      allLinks.push({ id: 'hoja', label: 'Hoja', icon: 'leaf', href: this.hojaHref })
    }
    for (const link of allLinks) {
      if (!link.href || seen.has(link.id)) continue
      seen.add(link.id)
      links.push({ kind: 'link', app: link })
    }
    return orderSophiaApps([...tabs, ...links].map(entry => ({ id: entry.app.id, entry }))).map(item => item.entry)
  }

  private _showControl(control: ChromeControl): boolean {
    if (this.controls) return this.controls.includes(control)
    return !this.customActionsOnly
  }

  /** The toolbar for the active app: the override, else the registry entry. */
  private _toolbar(): readonly AppToolbarAction[] {
    return this.toolbarActions ?? appToolbarActions(this.activeApp)
  }

  /** Arrow-key roving focus inside a menu panel (Tab and Escape stay native). */
  private _onMenuKeydown(event: KeyboardEvent): void {
    const panel = event.currentTarget as HTMLElement
    const items = Array.from(panel.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])'))
    if (items.length === 0) return
    const index = items.indexOf(this.shadowRoot?.activeElement as HTMLElement)
    let next = -1
    if (event.key === 'ArrowDown') next = (index + 1) % items.length
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    if (next < 0) return
    event.preventDefault()
    items[next].focus()
  }

  private _emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }

  private _selectApp(app: ChromeAppId): void {
    this._closeLauncher(true)
    if (this.activeApp === app) return
    this._emit('mn-app-change', { app })
  }

  private _openBreadcrumb(breadcrumb: ChromeBreadcrumb, event: MouseEvent): void {
    if (breadcrumb.disabled) return
    // The current crumb has nowhere to navigate to (you're already there) —
    // that click was previously just a no-op. For a document crumb, open a
    // document-actions menu instead, giving the top bar a per-document menu
    // at all (there wasn't one anywhere before this).
    if (breadcrumb.current) {
      if (breadcrumb.kind !== 'document') return
      const target = event.currentTarget as HTMLElement
      const rect = target.getBoundingClientRect()
      this._emit('mn-breadcrumb-menu-open', {
        breadcrumb,
        x: rect.left,
        y: rect.bottom,
      } satisfies ChromeBreadcrumbMenuOpenDetail)
      return
    }
    this._emit('mn-breadcrumb-open', { breadcrumb } satisfies ChromeBreadcrumbOpenDetail)
  }

  private _renderLauncherEntry(entry: LauncherEntry) {
    const app = entry.app
    const active = this.activeApp === app.id
    const identity = sophiaApp(app.id)
    const glyph = app.icon ?? (identity.description ? identity.icon : undefined)
    const tile = glyph
      ? html`<span class="app-tile switcher-icon" data-app-id=${app.id} aria-hidden="true">${icon(glyph, { size: 18 })}</span>`
      : html`<span class="app-tile" data-app-id=${app.id} aria-hidden="true">${app.label.slice(0, 1)}</span>`
    const description = app.description ?? identity.description
    const stage = app.stage ?? identity.stage ?? ''
    const accessibleName = `${sophiaAppAccessibleName(app.label, stage)} app`
    const stageTag = stage ? html`<span class="app-stage" data-stage=${stage} aria-hidden="true">${stage}</span>` : nothing
    // The row markup is written out in each branch (not shared through one
    // nested template that OPENS with a part): under the pinned lit-html +
    // happy-dom pair such a template commits its values one part off.
    if (entry.kind === 'link' && !active) {
      return html`<a
        class="app-switcher-btn"
        role="menuitemradio"
        aria-checked="false"
        aria-label=${accessibleName}
        data-app-id=${app.id}
        data-app-link=""
        href=${entry.app.href}
        @click=${() => this._closeLauncher()}
      >${tile}<span class="switcher-text"><span class="switcher-name"><span class="switcher-label">${app.label}</span>${stageTag}</span><span class="switcher-description">${description}</span></span><span class="switcher-check" aria-hidden="true">${icon('check', { size: 16 })}</span></a>`
    }
    return html`<button
      type="button"
      class="app-switcher-btn ${active ? 'app-switcher-btn--active' : ''}"
      role="menuitemradio"
      aria-checked=${active ? 'true' : 'false'}
      aria-label=${accessibleName}
      data-app-id=${app.id}
      @click=${() => this._selectApp(app.id)}
    >${tile}<span class="switcher-text"><span class="switcher-name"><span class="switcher-label">${app.label}</span>${stageTag}</span><span class="switcher-description">${description}</span></span><span class="switcher-check" aria-hidden="true">${icon('check', { size: 16 })}</span></button>`
  }

  render() {
    const entries = this.launcherEntries()
    const activeTab = entries.find(entry => entry.app.id === this.activeApp)?.app
    const appLabel = activeTab?.label ?? this.brand
    const appGlyph = activeTab
      ? activeTab.icon ?? (sophiaApp(activeTab.id).description ? sophiaApp(activeTab.id).icon : this.glyph)
      : this.glyph
    const canPick = entries.length > 0
    const toolbar = this._toolbar()
    const visibleBreadcrumbs = this.workspaces === null
      ? this.breadcrumbs
      : this.breadcrumbs.filter(breadcrumb => breadcrumb.kind !== 'graph')
    return html`
      <div class="app-title" part="app-title">
        <button
          type="button"
          class="app-picker"
          part="app-picker"
          ?disabled=${!canPick}
          aria-haspopup="menu"
          aria-expanded=${this._appsOpen ? 'true' : 'false'}
          aria-controls="app-launcher"
          aria-label=${canPick ? `${appLabel}. Switch app` : appLabel}
          @pointerdown=${() => this._notePointer()}
          @click=${() => this._toggleLauncher()}
        >
          <span class="app-tile masthead-icon" data-app-id=${activeTab?.id ?? this.activeApp} aria-hidden="true">${icon(appGlyph, { size: 14 })}</span>
          <span class="masthead-name">${appLabel}</span>
          <span class="masthead-badge" ?hidden=${!this.badge}>${this.badge}</span>
          <span class="app-picker-caret" aria-hidden="true" ?hidden=${!canPick}>${icon('chevron-down', { size: 12 })}</span>
        </button>
      </div>

      <!-- Contextual toolbar: the active app's declared set (app-toolbar.ts).
           Always in the template and hidden when empty, for the same ChildPart
           reason the launcher is (see the note on \`apps\`). -->
      <div
        class="app-toolbar"
        part="app-toolbar"
        role="toolbar"
        aria-label=${`${appLabel} tools`}
        ?hidden=${toolbar.length === 0}
        @keydown=${this._onToolbarKeydown}
      >
        ${toolbar.map(action => html`<button
          type="button"
          class="action-btn toolbar-btn"
          data-app-action=${action.id}
          aria-label=${action.label}
          title=${action.label}
          ?disabled=${Boolean(action.disabled)}
          @click=${() => { if (!action.disabled) this._emit(action.event, action.detail) }}
        >${icon(action.icon)}</button>`)}
      </div>

      <div
        class="app-switcher"
        id="app-launcher"
        part="app-switcher"
        popover="auto"
        role="menu"
        aria-label="Switch app"
        ?hidden=${entries.length === 0}
        @toggle=${(event: Event) => this._onToggle(event)}
        @keydown=${this._onMenuKeydown}
      >
        <div class="panel-caption" role="presentation">${this.suiteName} apps</div>
        <div class="app-grid" role="presentation">
        ${entries.map(entry => this._renderLauncherEntry(entry))}
        </div>
      </div>

      <!--
        INERT breadcrumb slot. In garden this renders live workspace + document
        crumbs sourced from the session. Here it is an empty slot — a shell with
        a live session binds crumbs in; with no binding it stays empty (no faked
        "Select Workspace" / fake doc title).
      -->
      <nav
        class="breadcrumbs"
        part="breadcrumbs"
        aria-label="Breadcrumb"
        data-inert-slot=${this.breadcrumbs.length === 0 ? 'breadcrumbs' : nothing}
      >
        ${this.workspaces !== null ? html`<mn-workspace-selector
          .workspaces=${this.workspaces}
          .status=${this.workspaceStatus}
          .error=${this.workspaceError}
          .activeGraphId=${this.activeWorkspaceId}
          .busyGraphId=${this.workspaceBusyId}
          .createCapability=${this.workspaceCreateAvailable ? WORKSPACE_CREATE_ENABLED : WORKSPACE_CREATE_ABSENT}
        ></mn-workspace-selector>` : nothing}
        ${visibleBreadcrumbs.length > 0
          ? html`<div class="breadcrumb-list">
              ${visibleBreadcrumbs.map((breadcrumb) => {
                const isCurrentDocument = Boolean(breadcrumb.current) && breadcrumb.kind === 'document'
                return html`<button
                  type="button"
                  class="breadcrumb ${isCurrentDocument ? 'breadcrumb--menu' : ''}"
                  data-breadcrumb-id="${breadcrumb.id}"
                  data-kind="${breadcrumb.kind ?? 'view'}"
                  aria-current="${breadcrumb.current ? 'page' : 'false'}"
                  aria-haspopup=${isCurrentDocument ? 'menu' : nothing}
                  title=${isCurrentDocument ? `${breadcrumb.label} — document actions` : nothing}
                  ?disabled=${Boolean(breadcrumb.disabled)}
                  @click=${(event: MouseEvent) => this._openBreadcrumb(breadcrumb, event)}
                >${breadcrumb.label}${isCurrentDocument
                  ? html`<span class="breadcrumb-menu-caret" aria-hidden="true">${icon('chevron-down', { size: 12 })}</span>`
                  : nothing}</button>`
              })}
            </div>`
          : this.workspaces === null ? html`<slot name="breadcrumbs"></slot>` : nothing}
      </nav>

      <div class="actions" part="actions">
        <button
          class="action-btn appearance-btn"
          ?hidden=${!this._showControl('appearance')}
          title="Appearance menu"
          aria-label="Appearance menu"
          aria-haspopup="menu"
          @click=${(event: MouseEvent) => {
            const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
            this.dispatchEvent(new CustomEvent('mn-appearance-menu', { detail: { x: box.left, y: box.bottom + 4 }, bubbles: true, composed: true }))
          }}
        >{ }</button>
        ${this.quickClipAvailable && this._showControl('quick-clip') ? html`<mn-quick-clip
          .status=${this.quickClipStatus}
          .error=${this.quickClipError}
        ></mn-quick-clip>` : nothing}
        ${this.access && this._showControl('access') ? html`<mn-access-manager .model=${this.access}></mn-access-manager>` : nothing}
        <button
          class="action-btn theme-action ${this.isDark ? 'active' : ''}"
          data-action="theme"
          ?hidden=${!this._showControl('theme')}
          aria-label="Toggle theme"
          aria-pressed=${this.isDark ? 'true' : 'false'}
          @click=${() => this._emit('mn-theme-toggle')}
        >
          ${icon(this.isDark ? 'moon' : 'sun')}
        </button>
        <mn-skin-picker
          class="skin-action"
          ?hidden=${!this._showControl('skin')}
          data-action="skin"
          .value=${this.activeSkin}
          .skins=${this.skins}
        ></mn-skin-picker>
        <button
          class="action-btn settings-action"
          data-action="settings"
          ?hidden=${!this._showControl('settings')}
          aria-label="Settings"
          @click=${() => this._emit('mn-settings-toggle')}
        >
          ${icon('settings')}
        </button>
        <!-- A shell may slot extra actions (search, share, feedback) here. -->
        <slot name="actions">${nothing}</slot>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-top-bar': MnTopBar
  }
}
