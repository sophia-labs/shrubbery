/**
 * sh-guest-island.ts — S1 item 5: a light-DOM Lit host element that gives a
 * foreign guest app (React or Web Components) a real element to own.
 *
 * `createRenderRoot(): this` (light DOM) is load-bearing, the same reason
 * `chat-panel.ts:546-580` and `hoja-editor.ts:494-497` give: a shadow root
 * would defeat the guest's own `:root` palette, its full-height rule, and
 * (for a React guest) React's own event delegation assumptions the way it
 * defeats hoja's ProseMirror selection. contracts/shrubbery.md §1's EF-9
 * extension names the concrete hazard for Mithras Flow specifically:
 * "styles.css:27 puts the whole whiteboard palette ... on :root;
 * styles.css:51-53 gives html, body, #root height 100%, which has no
 * analogue in a shadow tree, so the canvas mounts at zero height."
 *
 * Two `cssStrategy` values, deliberately different mechanisms:
 *
 *   - `'shadow'` reproduces the Excalidraw nesting
 *     (`excalidraw-runtime.ts:449-462,675-682`, the one real precedent for
 *     hosting a foreign React app in this repo): a CHILD div (not this
 *     element itself — `sh-guest-island` already committed its own render
 *     root to light DOM) gets `attachShadow({mode:'open'})`, and the guest's
 *     stylesheet is injected INSIDE that shadow root with `:root` rewritten
 *     to the scope class — the shadow boundary already isolates every OTHER
 *     selector from the rest of the page, so nothing else needs rewriting.
 *   - `'light-scoped'` puts the mount point directly in the light DOM (no
 *     shadow boundary at all) and injects the guest's sheet into the TOP
 *     document once per faceId, fully scoped by `scopeCss` (every selector
 *     prefixed under the scope class; `:root`/`html`/`body` rewritten TO the
 *     scope class) — because there is no shadow boundary to lean on, the
 *     mount point itself carries that same scope class so the rewritten
 *     selectors match something real.
 *
 * `data-css-sha256` records the guest's OWN precomputed checksum
 * (`GuestAppModule.styles.sha256`, FLOW-PIXEL-1/2) verbatim — this module
 * never computes a checksum itself, it only carries the one the guest module
 * already ships.
 */
import { LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { GuestAppModule } from './guest-app.js'
import { scopeCss } from './scope-css.js'

export type GuestCssStrategy = 'light-scoped' | 'shadow'

const MOUNT_STYLE = 'position:relative;display:block;width:100%;height:100%;min-width:0;min-height:0;'

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'guest'
}

/** The class a `faceId`'s light-scoped/shadow-scoped CSS is rewritten under — deterministic from `faceId` alone, no registry lookup. */
export function guestScopeClass(faceId: string): string {
  return `sh-guest-${slugify(faceId)}`
}

// Module-scoped: `light-scoped` mode shares ONE injected `<style>` per
// faceId across every mounted instance of that face (chat-panel.ts's own
// "created once, shared across instances" dedup shape) — a second board
// using the same faceId must not double-inject the same sheet.
const injectedLightScopeFaceIds = new Set<string>()

function injectLightScopedStyleOnce(faceId: string, css: string): void {
  if (injectedLightScopeFaceIds.has(faceId)) return
  if (typeof document === 'undefined' || !document.head) return
  const style = document.createElement('style')
  style.dataset.guestFaceStyle = faceId
  style.textContent = scopeCss(css, `.${guestScopeClass(faceId)}`)
  document.head.appendChild(style)
  injectedLightScopeFaceIds.add(faceId)
}

/** Test-only escape hatch: forget a faceId's injected style so a suite can re-observe injection. Never called by production code. */
export function resetGuestLightScopeInjectionsForTests(): void {
  injectedLightScopeFaceIds.clear()
  document.head?.querySelectorAll('style[data-guest-face-style]').forEach((node) => {
    node.remove()
  })
}

@customElement('sh-guest-island')
export class ShGuestIsland extends LitElement {
  @property({ attribute: false }) cssStrategy: GuestCssStrategy = 'light-scoped'
  @property({ type: String }) faceId = ''
  @property({ attribute: false }) guestStyles: GuestAppModule['styles'] = undefined

  private mountElement: HTMLElement | null = null

  /** Light DOM: the guest measures real layout and owns its own subtree — see this file's header. */
  createRenderRoot(): this {
    return this
  }

  /**
   * Lazily creates (idempotent) and returns the element the guest owns
   * entirely. Wires CSS per `cssStrategy` on first call, using whatever
   * `faceId`/`guestStyles`/`cssStrategy` are set to at that moment —
   * `defineGuestFace` sets every property immediately after
   * `document.createElement('sh-guest-island')`, before ever calling this.
   */
  mountPoint(): HTMLElement {
    if (this.mountElement) return this.mountElement
    if (this.guestStyles?.sha256) this.dataset.cssSha256 = this.guestStyles.sha256

    if (this.cssStrategy === 'shadow') {
      const shadowHost = document.createElement('div')
      shadowHost.className = 'sh-guest-island__shadow-host'
      shadowHost.style.cssText = MOUNT_STYLE
      this.appendChild(shadowHost)
      const shadow = shadowHost.attachShadow({ mode: 'open' })
      const scopeClass = guestScopeClass(this.faceId)
      if (this.guestStyles?.css) {
        const style = document.createElement('style')
        // `:root` matches nothing inside a shadow tree — bind it to the scope
        // class instead, the Excalidraw precedent verbatim
        // (`installRuntimeStyle`: `cssText.replace(/:root\b/g, '.excalidraw')`).
        style.textContent = this.guestStyles.css.replace(/:root\b/g, `.${scopeClass}`)
        shadow.appendChild(style)
      }
      const inner = document.createElement('div')
      inner.className = scopeClass
      inner.style.cssText = MOUNT_STYLE
      shadow.appendChild(inner)
      this.mountElement = inner
      return inner
    }

    // light-scoped: no shadow boundary — the mount point lives in the
    // ordinary light DOM, and the guest's sheet is scoped and shared.
    if (this.guestStyles?.css) injectLightScopedStyleOnce(this.faceId, this.guestStyles.css)
    const mount = document.createElement('div')
    mount.className = `sh-guest-island__mount ${guestScopeClass(this.faceId)}`
    mount.style.cssText = MOUNT_STYLE
    this.appendChild(mount)
    this.mountElement = mount
    return mount
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-guest-island': ShGuestIsland
  }
}
