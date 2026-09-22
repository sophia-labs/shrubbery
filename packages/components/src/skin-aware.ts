/**
 * skin-aware — a backend-free Lit mixin that makes a chrome component reflect
 * the AMBIENT skin + theme into its own host as observable attributes.
 *
 * WHY this exists
 * ───────────────
 * The @shrubbery/tokens system applies skin/theme by stamping attributes on a
 * root element: [data-skin=emporium] / [data-theme=dark] (the sux
 * ConfigValue.appliesAttribute pattern; see @shrubbery/tokens applySkinTheme).
 * Those root attributes drive CSS custom properties (--mn-row-height,
 * --mn-radius-control, --mn-label-display, the accent ramp, …) which our chrome
 * already consumes through the cascade with fallbacks.
 *
 * But two things are NOT expressible purely through inherited custom properties:
 *   1. STRUCTURAL skin choices — e.g. Emporium's icon-only labels hide the chrome
 *      label TEXT (the app-switcher / panel-toggle captions), and square shoulders
 *      apply to controls. A shadow-DOM component cannot select on an ancestor's
 *      attribute reliably & portably (`:host-context()` is unsupported in Firefox
 *      and not computable by happy-dom). The robust, portable hook is
 *      `:host([data-skin=emporium])` — which requires the attribute to be ON THE
 *      HOST, not an ancestor.
 *   2. A DOM-OBSERVABLE difference the real component tests can assert WITHOUT a
 *      paint engine (happy-dom does not resolve var()/cascade). Reflecting the
 *      ambient skin/theme onto the host gives the test a concrete, real-DOM
 *      signal that the chrome rendered differently per skin.
 *
 * So this mixin: on connect (and whenever an ancestor / the root changes its
 * data-skin / data-theme), it READS the nearest ancestor [data-skin]/[data-theme]
 * (falling back to <html>) and MIRRORS it onto the host's own data-skin /
 * data-theme attributes, then requests an update so `:host([data-skin=…])` and
 * `:host([data-theme=…])` shadow rules light up.
 *
 * BACKEND-FREE: it touches ONLY the DOM (ancestor attribute reads + a
 * MutationObserver). No store, no auth, no tauri, no @shrubbery/runtime, no token
 * code import — the contract with @shrubbery/tokens is purely the ATTRIBUTE NAMES
 * + CSS var names, never a module import. (Verified by the island test.)
 */

import type { LitElement } from 'lit'

type Constructor<T> = new (...args: any[]) => T

/** The ambient design dimensions a chrome component mirrors onto its host. */
export interface SkinAwareHost {
  /** The resolved ambient skin (e.g. 'emporium'), or '' when none/default Garden. */
  readonly resolvedSkin: string
  /** The resolved ambient theme (e.g. 'dark'), or '' when none/default light. */
  readonly resolvedTheme: string
}

/**
 * Read the nearest ANCESTOR's attribute, falling back to <html>, else ''.
 *
 * Crucially this starts from the parent, NOT the element itself: the element
 * REFLECTS the resolved value onto its own attribute, so reading from self would
 * read back our own copy and mask a later ancestor change (a feedback loop). We
 * walk parentElement → … so the wrapping [data-skin] region (or, ultimately,
 * <html>) is the source of truth.
 */
function readAmbient(el: Element, attr: string): string {
  let cur: Element | null = el.parentElement
  while (cur) {
    const v = cur.getAttribute(attr)
    if (v != null && v !== '') return v
    cur = cur.parentElement
  }
  const root = el.ownerDocument?.documentElement
  if (root && root !== el) {
    const v = root.getAttribute(attr)
    if (v != null && v !== '') return v
  }
  return ''
}

/**
 * Mixin: makes `Base` mirror ambient [data-skin]/[data-theme] onto its host.
 *
 * The resolver reads ANCESTORS only (it starts from parentElement, never self),
 * so a previously reflected value on the host never masks an ancestor change —
 * that is what avoids a feedback loop.
 */
export function SkinAware<TBase extends Constructor<LitElement>>(Base: TBase) {
  class SkinAwareElement extends Base implements SkinAwareHost {
    private _skin = ''
    private _theme = ''
    private _rootObserver?: MutationObserver

    get resolvedSkin(): string {
      return this._skin
    }
    get resolvedTheme(): string {
      return this._theme
    }

    connectedCallback(): void {
      super.connectedCallback()
      this._syncAmbient()
      // Re-sync whenever the document root flips skin/theme (the common path:
      // applySkinTheme() stamps <html>). We observe attribute mutations on the
      // root element; a wrapping region change is picked up on the next sync too.
      const root = this.ownerDocument?.documentElement
      if (root && typeof MutationObserver !== 'undefined') {
        this._rootObserver = new MutationObserver(() => this._syncAmbient())
        this._rootObserver.observe(root, {
          attributes: true,
          attributeFilter: ['data-skin', 'data-design', 'data-theme'],
        })
      }
    }

    disconnectedCallback(): void {
      this._rootObserver?.disconnect()
      this._rootObserver = undefined
      super.disconnectedCallback()
    }

    /** Read ambient skin/theme and mirror onto the host (idempotent). */
    private _syncAmbient(): void {
      // Accept the [data-design=emporium] alias garden uses for the two-host
      // cloud pattern — it resolves to the same skin.
      const skin = readAmbient(this, 'data-skin') || readAmbient(this, 'data-design')
      const theme = readAmbient(this, 'data-theme')
      let changed = false
      if (skin !== this._skin) {
        this._skin = skin
        if (skin) this.setAttribute('data-skin', skin)
        else this.removeAttribute('data-skin')
        changed = true
      }
      if (theme !== this._theme) {
        this._theme = theme
        if (theme) this.setAttribute('data-theme', theme)
        else this.removeAttribute('data-theme')
        changed = true
      }
      if (changed) this.requestUpdate()
    }
  }
  return SkinAwareElement as TBase & Constructor<SkinAwareHost>
}
