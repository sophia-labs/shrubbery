/**
 * Vitest setup for the @shrubbery/runtime render-host tests.
 *
 * Mirrors nucleus's setup: suppress Lit's dev-mode console.warn (the host
 * imports Lit) and clear the DOM after each test (the host renders into the
 * document during integration/functional tests).
 */
import { afterEach } from 'vitest'

// Suppress Lit's "dev mode" console.warn via its documented dedup mechanism.
;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings ??= new Set()
;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings!.add('dev-mode')

// happy-dom 15 walks an unrelated focused shadow tree all the way to Document
// and dereferences its nonexistent .host. Browsers return null for that case.
// Keep its normal focus implementation and correct only the disjoint-root case;
// real focus/selection acceptance runs independently in Chromium.
const activeElement = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, 'activeElement')!
Object.defineProperty(ShadowRoot.prototype, 'activeElement', {
  ...activeElement,
  get(this: ShadowRoot) {
    const active = this.ownerDocument.activeElement
    if (active && !this.host.contains(active) && !active.contains(this.host)) return null
    return activeElement.get!.call(this)
  },
})

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})
