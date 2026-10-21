/**
 * Idempotent `customElements.define` shim + Lit dev-warning suppression.
 * Mirrors apps/emporium/tests/setup.ts — several test files import Lit
 * elements into the SAME single-fork happy-dom registry, and the second
 * definition of a tag would otherwise throw.
 */

;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings ??= new Set()
;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings!.add('dev-mode')

const ce = globalThis.customElements
if (ce && typeof ce.define === 'function') {
  const original = ce.define.bind(ce)
  ce.define = function define(
    name: string,
    ctor: CustomElementConstructor,
    options?: ElementDefinitionOptions,
  ): void {
    if (ce.get(name)) return // already registered by a prior test file — no-op.
    original(name, ctor, options)
  }
}
