/**
 * Vitest setup for the emporium app's SHELL-SIDE integration tests.
 *
 * These tests run single-fork + non-parallel (vitest.config.ts) so the spawned
 * gardend cells don't race for ports / rocksdb locks. A consequence of single-fork
 * is that happy-dom's CustomElementRegistry is a SHARED singleton across test
 * files, while vitest re-evaluates the module graph per file — so a second file
 * that (transitively) imports @shrubbery/components re-runs the Lit
 * `@customElement(...)` registrations against an already-populated registry and
 * happy-dom throws `the name "mn-top-bar" has already been used`.
 *
 * Fix: make `customElements.define` IDEMPOTENT for the test run — a redefine of an
 * already-registered tag is a no-op (the first definition wins; same class either
 * way). TEST shim only; it does not touch the shipped library (the components stay
 * island-clean). Mirrors apps/organism/tests/setup.ts verbatim.
 */

;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings ??= new Set()
;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings!.add('dev-mode')

const ce = globalThis.customElements
if (ce && typeof ce.define === 'function') {
  const original = ce.define.bind(ce)
  ce.define = function define(name: string, ctor: CustomElementConstructor, options?: ElementDefinitionOptions): void {
    if (ce.get(name)) return // already registered (a prior test file) — no-op.
    original(name, ctor, options)
  }
}
