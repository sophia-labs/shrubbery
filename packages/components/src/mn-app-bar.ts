/**
 * mn-app-bar — a RICHER, GENERAL product top bar (backend-free, skin-aware).
 *
 * WHY a new component (not just mn-top-bar):
 * ──────────────────────────────────────────
 * mn-top-bar lifted garden's CHROME shell (masthead + app-switcher + inert
 * breadcrumb slot + theme/skin/settings actions) — the LAYOUT bar a workspace
 * render-host stamps. mn-app-bar lifts MORE of garden's real top bar STRUCTURE
 * (READ-ONLY garden/frontend/src/components/layout/mn-top-bar.ts) — specifically
 * the two data-bearing regions garden's bar has that the chrome bar deliberately
 * dropped:
 *   - a SEARCH / FILTER input (garden's directory/database search field), and
 *   - a real BREADCRUMB TRAIL (garden's workspace → document crumb row),
 * generalized into a CONTROLLED, customizable, skin-aware product bar. It is the
 * bar a DEDICATED app shell (apps/emporium — the 4th shell) drives, where the
 * masthead, search placeholder, breadcrumbs, and nav are all the SHELL's data.
 *
 * GENERALIZED — not a port of garden's app-specific bits:
 *   - NO store/controller/auth/tauri import (same island discipline as the chrome
 *     bars; grep-verified by the components island test).
 *   - the breadcrumb DATA is a CONTROLLED `.crumbs` PROPERTY the shell sets (an
 *     array of {label, id?}); garden sources these from sessionStore — here the
 *     shell owns them. With no crumbs the trail renders EMPTY (never faked).
 *   - the search is a CONTROLLED input: `.query` is the value, typing emits
 *     `mn-search` (detail.query) + Enter emits `mn-search-submit`; the bar holds
 *     no list, does no fetch, keeps no debounce timer tied to any API.
 *   - the masthead label/badge/glyph are PROPS (Emporium sets brand="Emporium").
 *   - nav + extra actions are SLOTS (`nav`, `actions`) the shell fills.
 *
 * SKIN-AWARE: via the SkinAware mixin it mirrors the ambient [data-skin] /
 * [data-theme] onto its host, so `:host([data-skin=emporium])` shadow rules light
 * up (square shoulders, tight density, uppercase tracked masthead) and the accent
 * / font / surface colors flow in through the inherited --mn-* role tokens. Under
 * Garden it is the comfortable rounded fern bar; under Emporium the tight purple
 * Swiss bar. NO per-skin color code lives here — only the structural skin bits a
 * token alone cannot express.
 *
 * Dependencies: lit ONLY (+ the SkinAware mixin, which is DOM-only). NO stores,
 * NO auth, NO tauri, NO @shrubbery/runtime, NO @shrubbery/render.
 */

import { LitElement, css, html, nothing, unsafeCSS, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { icon, iconStyles, hasIcon } from './icons.js'
import { chromeSkinMeta, type ChromeSkinId } from './chrome-skin.js'

/**
 * One breadcrumb in the trail. `id` is the SHELL's opaque handle (a route key, a
 * pack name…) echoed back in the `mn-crumb` event so the shell can navigate; the
 * last crumb is the current location (rendered as plain, non-interactive text).
 */
export interface MnCrumb {
  /** The visible crumb label (e.g. 'Emporium', a pack name, a class name). */
  readonly label: string
  /** The shell's opaque handle for this crumb (echoed in mn-crumb.detail.id). */
  readonly id?: string
}

@customElement('mn-app-bar')
export class MnAppBar extends SkinAware(LitElement) {
  static styles = css`
    /* Shadow DOM does NOT inherit garden's global icon stylesheet, so the inline
       <svg> icons need this rule locally to follow text color (stroke:
       currentColor) instead of rendering black/invisible. */
    ${unsafeCSS(iconStyles)}

    :host {
      display: flex;
      align-items: center;
      height: var(--mn-app-bar-height, var(--mn-top-bar-height, 52px));
      padding: 0 var(--mn-space-5, 16px);
      background: var(--mn-top-bar-bg, #fff);
      border-bottom: 2px solid var(--mn-top-bar-border, #e5e7eb);
      gap: var(--mn-space-5, 16px);
      box-sizing: border-box;
      font-family: var(--mn-font-chrome, system-ui, sans-serif);
      color: var(--mn-top-bar-text, #111);
    }

    /* ── Masthead / brand (static chrome, click → mn-navigate-home) ── */
    .masthead {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      flex-shrink: 0;
      cursor: pointer;
      border-radius: var(--mn-radius-control, 6px);
      padding: 4px 8px 4px 0;
      transition: background 0.15s;
    }
    .masthead:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
    }
    .masthead-glyph {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      font-size: 20px;
      line-height: 1;
      color: var(--mn-color-accent, var(--mn-top-bar-text, #111));
    }
    .masthead-text {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      line-height: 1.1;
    }
    .masthead-name {
      font-family: var(--mn-font-display, var(--mn-font-serif, Georgia, serif));
      font-size: var(--mn-text-lg, 18px);
      font-weight: 700;
      letter-spacing: 0.01em;
      color: var(--mn-top-bar-text, #111);
    }
    .masthead-badge {
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--mn-color-text-accent, #6366f1);
      margin-top: 1px;
    }

    /* ── Search / filter (controlled input) ── */
    .search {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: 0 1 280px;
      min-width: 0;
      height: var(--mn-control-height, 32px);
      padding: 0 10px;
      background: var(--mn-color-surface-sunken, #f3f4f6);
      border: 1px solid var(--mn-color-border-default, #e5e7eb);
      border-radius: var(--mn-radius-control, 6px);
      transition: border-color 0.12s, background 0.12s;
    }
    .search:focus-within {
      border-color: var(--mn-color-border-focus, var(--mn-color-accent, #6366f1));
      background: var(--mn-color-surface-raised, #fff);
    }
    .search-glyph {
      flex-shrink: 0;
      font-size: 13px;
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .search-input {
      flex: 1;
      min-width: 0;
      border: none;
      outline: none;
      background: transparent;
      font: inherit;
      font-size: var(--mn-text-sm, 13px);
      color: var(--mn-color-text-primary, #111);
    }
    .search-input::placeholder {
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .search-clear {
      flex-shrink: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      line-height: 1;
      color: var(--mn-color-text-muted, #9ca3af);
      padding: 0 2px;
    }
    .search-clear:hover {
      color: var(--mn-color-text-secondary, #374151);
    }

    /* ── Breadcrumb trail (controlled data + an optional slot) ── */
    .breadcrumbs {
      display: flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }
    .crumb-item {
      display: inline-flex;
      align-items: center;
      gap: var(--mn-space-1, 4px);
      min-width: 0;
    }
    .crumb {
      display: inline-flex;
      align-items: center;
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--mn-text-sm, 13px);
      border: none;
      background: transparent;
      font: inherit;
      padding: 2px 4px;
      border-radius: var(--mn-radius-control, 4px);
      color: var(--mn-color-text-secondary, #4b5563);
    }
    button.crumb {
      cursor: pointer;
    }
    button.crumb:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-color-text-primary, #111);
    }
    .crumb--current {
      color: var(--mn-color-text-primary, #111);
      font-weight: 600;
    }
    .crumb-sep {
      flex-shrink: 0;
      color: var(--mn-color-text-muted, #9ca3af);
      font-size: 12px;
      user-select: none;
    }

    /* ── Nav (shell-slotted) ── */
    .nav {
      display: flex;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      flex-shrink: 0;
    }

    /* ── Right actions (theme / skin / settings + slot) ── */
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
      width: var(--mn-control-height, 32px);
      height: var(--mn-control-height, 32px);
      border: none;
      border-radius: var(--mn-radius-control, 6px);
      background: transparent;
      color: var(--mn-top-bar-text-muted, #6b7280);
      cursor: pointer;
      transition: all 0.15s;
      font-size: 16px;
    }
    .action-btn:hover {
      background: var(--mn-color-surface-hover, #f3f4f6);
      color: var(--mn-top-bar-text, #111);
    }
    .action-btn.active {
      background: var(--mn-color-surface-accent, #eef2ff);
      color: var(--mn-color-text-accent-strong, #4338ca);
    }

    /* ── EMPORIUM skin structural overrides (sophia structure) ───────────────
       The host carries data-skin=emporium (mirrored by SkinAware), so these light
       up portably. Density / radius flow through the role tokens above; these add
       the structural bits a token alone can't express. */
    :host([data-skin='emporium']) {
      border-bottom: var(--mn-chrome-rule, 1px solid var(--mn-color-border-strong, #e5e7eb));
    }
    :host([data-skin='emporium']) .masthead-name {
      font-family: var(--mn-font-display, inherit);
      letter-spacing: var(--mn-tracking-label, 0.06em);
      text-transform: uppercase;
      font-size: var(--mn-text-md, 16px);
    }
    :host([data-skin='emporium']) .search {
      border-radius: var(--mn-radius-none, 0);
    }

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
    :host([data-skin='98']) .search {
      border: 0;
      border-radius: 0;
      background: var(--mn-color-surface-sunken, #fff);
      color: var(--mn-color-text-primary, #000);
      box-shadow: var(--mn-98-sunken);
    }
    :host([data-skin='98']) .crumb:hover {
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
    :host([data-skin='glass']) .search {
      border: var(--mn-control-border);
      background: var(--mn-color-surface-sunken);
      box-shadow: var(--mn-control-shadow-active);
    }
    :host([data-skin='glass']) .action-btn {
      border: var(--mn-control-border);
      background: var(--mn-control-background);
      box-shadow: var(--mn-control-shadow);
    }
    :host([data-skin='glass']) .crumb:hover,
    :host([data-skin='glass']) .action-btn:hover {
      background: var(--mn-control-background-hover);
    }
    :host([data-skin='glass']) .action-btn:active,
    :host([data-skin='glass']) .action-btn.active {
      background: var(--mn-control-background-active);
      box-shadow: var(--mn-control-shadow-active);
    }
  `

  /** The masthead brand label. Default 'App'; a shell sets 'Emporium'. */
  @property({ type: String }) brand = 'App'

  /** The masthead badge (e.g. 'live', 'alpha'). */
  @property({ type: String }) badge = ''

  /**
   * The masthead glyph. Prefer a registered ICON NAME (see icons.ts) — it renders
   * as an inline lucide SVG. Default 'diamond' (a real icon, was the '◆' emoji).
   * For backward-compat a non-icon string still renders as literal text (so a
   * shell that sets a custom char/emoji keeps working).
   */
  @property({ type: String }) glyph = 'diamond'

  /** The search input value — CONTROLLED by the shell (never self-mutated). */
  @property({ type: String }) query = ''

  /** The search input placeholder. */
  @property({ type: String }) searchPlaceholder = 'Search…'

  /** When false, the search region is omitted entirely (some shells have no search). */
  @property({ type: Boolean, attribute: 'show-search' }) showSearch = true

  /** The breadcrumb trail — a CONTROLLED array the shell sets. Empty ⇒ no trail. */
  @property({ attribute: false }) crumbs: readonly MnCrumb[] = []

  /** Dark-mode pressed state — CONTROLLED, never read from a theme store. */
  @property({ type: Boolean, attribute: 'is-dark' }) isDark = false

  /** Current visual identity — CONTROLLED, never read from a store. */
  @property({ type: String, attribute: 'active-skin' }) activeSkin: ChromeSkinId = 'garden'

  /** When false, the built-in theme/skin/settings actions are omitted (slot only). */
  @property({ type: Boolean, attribute: 'show-actions' }) showActions = true

  private _emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }))
  }

  private _onSearchInput(e: Event): void {
    // CONTROLLED: emit the new value; the shell decides whether to set `.query`.
    const value = (e.target as HTMLInputElement).value
    this._emit('mn-search', { query: value })
  }

  private _onSearchKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      this._emit('mn-search-submit', { query: (e.target as HTMLInputElement).value })
    } else if (e.key === 'Escape') {
      this._emit('mn-search', { query: '' })
    }
  }

  private _onCrumb(crumb: MnCrumb): void {
    this._emit('mn-crumb', { id: crumb.id, label: crumb.label })
  }

  /** One crumb's element (current = plain span, earlier interactive = button). */
  private _crumbEl(c: MnCrumb, isCurrent: boolean): TemplateResult {
    if (isCurrent || c.id === undefined) {
      return html`<span
        class="crumb crumb--current"
        aria-current=${isCurrent ? 'page' : nothing}
        >${c.label}</span
      >`
    }
    return html`<button class="crumb" @click=${() => this._onCrumb(c)}>${c.label}</button>`
  }

  render() {
    const skinMeta = chromeSkinMeta(this.activeSkin)
    const skinActionLabel = `Visual style: ${skinMeta.label}. Switch visual style`
    const last = this.crumbs.length - 1
    return html`
      <div class="masthead" part="masthead" @click=${() => this._emit('mn-navigate-home')}>
        <span class="masthead-glyph" aria-hidden="true"
          >${hasIcon(this.glyph) ? icon(this.glyph, { size: 20 }) : this.glyph}</span
        >
        <div class="masthead-text">
          <span class="masthead-name">${this.brand}</span>
          ${this.badge ? html`<span class="masthead-badge">${this.badge}</span>` : nothing}
        </div>
      </div>

      ${this.showSearch
        ? html`<div class="search" part="search">
            <span class="search-glyph" aria-hidden="true">${icon('search', { size: 14 })}</span>
            <input
              class="search-input"
              type="text"
              .value=${this.query}
              placeholder=${this.searchPlaceholder}
              aria-label=${this.searchPlaceholder}
              spellcheck="false"
              @input=${this._onSearchInput}
              @keydown=${this._onSearchKeydown}
            />
            ${this.query
              ? html`<button
                  class="search-clear"
                  aria-label="Clear search"
                  @click=${() => this._emit('mn-search', { query: '' })}
                >
                  ${icon('x', { size: 13 })}
                </button>`
              : nothing}
          </div>`
        : nothing}

      <nav class="breadcrumbs" part="breadcrumbs" aria-label="Breadcrumb">
        ${this.crumbs.map(
          (c, i) => html`<span class="crumb-item"
            >${i > 0 ? html`<span class="crumb-sep" aria-hidden="true">/</span>` : nothing}${this._crumbEl(c, i === last)}</span
          >`,
        )}
        <slot name="breadcrumbs"></slot>
      </nav>

      <div class="actions" part="actions">
        <slot name="nav"></slot>
        ${this.showActions
          ? html`<button
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
              </button>`
          : nothing}
        <slot name="actions">${nothing}</slot>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-app-bar': MnAppBar
  }
}
