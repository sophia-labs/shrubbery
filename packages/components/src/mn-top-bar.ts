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
 *   - the masthead brand (a static label; click emits `mn-navigate-home`).
 *   - the app-switcher (Garden / Choreograph toggle): a controlled tab strip.
 *     `activeApp` is a PROPERTY a shell sets; clicking a tab emits
 *     `mn-app-change` (detail.app) and does NOT mutate any store.
 *   - the action buttons (theme / skin / settings): chrome that emits composed
 *     events (`mn-theme-toggle`, `mn-skin-toggle`, `mn-settings-toggle`); their
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
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles } from './icons.js'
import { chromeSkinMeta, type ChromeSkinId } from './chrome-skin.js'
import './mn-workspace-selector.js'
import './mn-quick-clip.js'
import './mn-access-manager.js'
import type { MnWorkspaceSelectorStatus, MnWorkspaceSummary } from './mn-workspace-selector.js'
import type { MnQuickClipStatus } from './mn-quick-clip.js'
import type { MnAccessManagerModel } from './mn-access-manager.js'

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
}
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

    /* ── Masthead / brand (static chrome) ── */
    .masthead {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 6px);
      flex-shrink: 0;
      cursor: pointer;
      border-radius: var(--mn-radius-sm, 4px);
      padding: 2px 6px 2px 0;
      transition: background var(--mn-transition-fast, 120ms ease);
    }
    .masthead:hover {
      background: var(--mn-color-surface-accent, #f3f4f6);
    }
    .masthead-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      color: var(--mn-top-bar-text, #111);
      font-size: 18px;
    }
    .masthead-name-group {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      line-height: 1;
    }
    .masthead-name {
      font-family: var(--mn-font-display, var(--mn-font-serif, Georgia, serif));
      font-size: var(--mn-text-md, 15px);
      font-weight: 600;
      letter-spacing: -0.005em;
      color: var(--mn-top-bar-text, #111);
    }
    .masthead-badge {
      font-size: 9px;
      font-weight: 500;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--mn-color-text-accent, #6366f1);
      margin-top: 1px;
    }

    /* ── App switcher (controlled tab strip) ── */
    .app-switcher {
      display: flex;
      align-items: center;
      gap: 2px;
      background: var(--mn-color-surface-sunken, #f3f4f6);
      border: 1px solid var(--mn-color-border-subtle, #e5e7eb);
      /* Skin radius role: Garden rounded (8px surface), Emporium square (4px). */
      border-radius: var(--mn-radius-surface, 6px);
      padding: 2px;
      flex-shrink: 0;
      box-shadow: inset 0 1px 1px rgba(20, 35, 26, 0.035);
    }
    .app-switcher-btn {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      /* Control radius role: Garden rounded, Emporium square (0). */
      border-radius: var(--mn-radius-control, 4px);
      border: none;
      background: transparent;
      color: var(--mn-color-text-muted, #6b7280);
      font-size: var(--mn-text-xs, 12px);
      font-family: var(--mn-font-utility, system-ui, sans-serif);
      font-weight: 600;
      cursor: pointer;
      transition:
        background var(--mn-transition-fast, 120ms ease),
        color var(--mn-transition-fast, 120ms ease),
        box-shadow var(--mn-transition-fast, 120ms ease);
      white-space: nowrap;
    }
    /* The tab CAPTION — an icon-only skin (Emporium) hides this text and the
       button collapses to its icon glyph. --mn-label-display is the skin flag:
       'inline' (Garden) | 'none' (Emporium). */
    .app-switcher-btn .switcher-label {
      display: var(--mn-label-display, inline);
    }
    .app-switcher-btn .switcher-icon {
      display: none;
      font-size: 14px;
      line-height: 1;
    }
    .app-switcher-btn:hover:not(.app-switcher-btn--active) {
      color: var(--mn-color-text-secondary, #374151);
    }
    .app-switcher-btn--active {
      background: var(--mn-color-surface-raised, #fff);
      color: var(--mn-color-text-primary, #111);
      box-shadow: var(--mn-shadow-xs, 0 1px 2px rgba(0, 0, 0, 0.08));
      cursor: default;
    }

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
    .action-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      /* Density role: a control is --mn-control-height square. Garden 28px,
         Emporium tight 24px. (Was a fixed 32px before skinning.) */
      width: var(--mn-control-height, 32px);
      height: var(--mn-control-height, 32px);
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
    .action-btn:hover {
      background: var(--mn-color-surface-accent, #f3f4f6);
      color: var(--mn-top-bar-text, #111);
    }
    .action-btn.active {
      background: var(--mn-color-surface-accent-strong, #eef2ff);
      color: var(--mn-color-text-accent-strong, #4338ca);
      box-shadow: inset 0 0 0 1px var(--mn-color-border-subtle, transparent);
    }
    .masthead:focus-visible,
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
    :host([data-skin='emporium']) .app-switcher-btn .switcher-icon {
      display: inline;
    }

    /* ── 98 skin structural overrides ───────────────────────────────
       The caption bar remains the host background. Controls inside it become
       discrete silver widgets with period-correct raised/sunken bevels. */
    :host([data-skin='98']) {
      padding-inline: 6px;
      gap: 8px;
      border: 2px solid var(--mn-98-face, #c0c0c0);
      border-bottom-color: var(--mn-98-dark, #000);
    }
    :host([data-skin='98']) .masthead {
      padding: 1px 5px 1px 0;
      border-radius: 0;
    }
    :host([data-skin='98']) .masthead:hover {
      background: transparent;
    }
    :host([data-skin='98']) .masthead-name {
      font-size: 13px;
      font-weight: 750;
      letter-spacing: 0;
      text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.55);
    }
    :host([data-skin='98']) .masthead-badge {
      color: var(--mn-top-bar-text, #fff);
      letter-spacing: 0;
    }
    :host([data-skin='98']) .app-switcher {
      gap: 3px;
      padding: 3px;
      border: 0;
      border-radius: 0;
      background: var(--mn-98-face, #c0c0c0);
      box-shadow: var(--mn-98-sunken);
    }
    :host([data-skin='98']) .app-switcher-btn {
      min-height: 22px;
      padding: 2px 8px;
      border-radius: 0;
      color: var(--mn-color-text-primary, #000);
    }
    :host([data-skin='98']) .app-switcher-btn--active {
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='98']) .breadcrumb:hover:not(:disabled) {
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='98']) .action-btn {
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-raised);
    }
    :host([data-skin='98']) .action-btn:hover {
      background: var(--mn-98-face, #c0c0c0);
      color: var(--mn-color-text-primary, #000);
    }
    :host([data-skin='98']) .action-btn:active,
    :host([data-skin='98']) .action-btn.active {
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
    :host([data-skin='glass']) .masthead {
      text-shadow: 0 1px 0 rgba(255, 255, 255, 0.62);
    }
    :host([data-skin='glass']) .app-switcher,
    :host([data-skin='glass']) .action-btn {
      border: var(--mn-control-border);
      background: var(--mn-control-background);
      box-shadow: var(--mn-control-shadow);
      backdrop-filter: var(--mn-window-backdrop-filter);
    }
    :host([data-skin='glass']) .app-switcher-btn:hover,
    :host([data-skin='glass']) .breadcrumb:hover:not(:disabled),
    :host([data-skin='glass']) .action-btn:hover {
      background: var(--mn-control-background-hover);
    }
    :host([data-skin='glass']) .app-switcher-btn--active,
    :host([data-skin='glass']) .action-btn:active,
    :host([data-skin='glass']) .action-btn.active {
      background: var(--mn-control-background-active);
      box-shadow: var(--mn-control-shadow-active);
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

  /** The brand label (chrome only). Default 'Garden'; a shell may override. */
  @property({ type: String }) brand = 'Garden'

  /**
   * The masthead brand glyph — a configurable ICON NAME (see icons.ts), default a
   * real sprout icon (the fern brand) instead of an emoji. A shell may set any
   * registered icon name (e.g. 'hexagon', 'leaf', 'diamond').
   */
  @property({ type: String }) glyph = 'sprout'

  /** The brand badge (e.g. 'beta' / 'staging'). Chrome only. */
  @property({ type: String }) badge = 'beta'

  /** Dark-mode pressed state — a CONTROLLED prop, never read from a theme store. */
  @property({ type: Boolean, attribute: 'is-dark' }) isDark = false

  /** Current visual identity — a CONTROLLED prop, never read from a store. */
  @property({ type: String, attribute: 'active-skin' }) activeSkin: ChromeSkinId = 'garden'

  /** Live graph/document path supplied by the shell. Empty preserves the slot seam. */
  @property({ attribute: false }) breadcrumbs: readonly ChromeBreadcrumb[] = []

  /** Null preserves the original inert breadcrumb-only seam. An array enables tenancy UI. */
  @property({ attribute: false }) workspaces: readonly MnWorkspaceSummary[] | null = null

  @property({ type: String }) workspaceStatus: MnWorkspaceSelectorStatus = 'idle'
  @property({ type: String }) workspaceError = ''
  @property({ type: String }) activeWorkspaceId = ''
  @property({ type: String }) workspaceBusyId = ''

  /** Controlled Quick Clip visibility/status; absent graph means no trigger. */
  @property({ type: Boolean }) quickClipAvailable = false
  @property({ type: String }) quickClipStatus: MnQuickClipStatus = 'idle'
  @property({ type: String }) quickClipError = ''

  /** Hosted gateway member grants. Null means this deployment has no access surface. */
  @property({ attribute: false }) access: MnAccessManagerModel | null = null

  private _emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }

  private _selectApp(app: ChromeAppId): void {
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

  render() {
    const skinMeta = chromeSkinMeta(this.activeSkin)
    const skinActionLabel = `Visual style: ${skinMeta.label}. Switch visual style`
    const visibleBreadcrumbs = this.workspaces === null
      ? this.breadcrumbs
      : this.breadcrumbs.filter(breadcrumb => breadcrumb.kind !== 'graph')
    return html`
      <div class="masthead" part="masthead" @click=${() => this._emit('mn-navigate-home')}>
        <span class="masthead-icon" aria-hidden="true">${icon(this.glyph, { size: 18 })}</span>
        <div class="masthead-name-group">
          <span class="masthead-name">${this.brand}</span>
          <span class="masthead-badge">${this.badge}</span>
        </div>
      </div>

      <div
        class="app-switcher"
        part="app-switcher"
        role="tablist"
        aria-label="Switch app"
        ?hidden=${this.apps.length === 0}
      >
        ${this.apps.map(
          (tab) => html`<button
            class="app-switcher-btn ${this.activeApp === tab.id ? 'app-switcher-btn--active' : ''}"
            role="tab"
            aria-selected=${this.activeApp === tab.id ? 'true' : 'false'}
            aria-label="${tab.label} app"
            @click=${() => this._selectApp(tab.id)}
          >
            ${tab.icon
              ? html`<span class="switcher-icon" aria-hidden="true">${icon(tab.icon, { size: 14 })}</span>`
              : nothing}
            <span class="switcher-label">${tab.label}</span>
          </button>`,
        )}
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
        ${this.quickClipAvailable ? html`<mn-quick-clip
          .status=${this.quickClipStatus}
          .error=${this.quickClipError}
        ></mn-quick-clip>` : nothing}
        ${this.access ? html`<mn-access-manager .model=${this.access}></mn-access-manager>` : nothing}
        <button
          class="action-btn ${this.isDark ? 'active' : ''}"
          aria-label="Toggle theme"
          aria-pressed=${this.isDark ? 'true' : 'false'}
          @click=${() => this._emit('mn-theme-toggle')}
        >
          ${icon(this.isDark ? 'moon' : 'sun')}
        </button>
        <button
          class="action-btn skin-action"
          data-action="skin"
          data-active-skin=${this.activeSkin}
          aria-label=${skinActionLabel}
          title=${skinActionLabel}
          @click=${() => this._emit('mn-skin-toggle')}
        >
          ${icon(skinMeta.icon)}
        </button>
        <button
          class="action-btn"
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
