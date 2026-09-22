/**
 * Vitest setup for the organism's SHELL-SIDE integration tests.
 *
 * These tests run single-fork + non-parallel (vitest.config.ts) so that the
 * spawned gardend cells don't race for ports / rocksdb locks. A consequence of
 * single-fork is that happy-dom's CustomElementRegistry is a SHARED singleton
 * across test files, while vitest re-evaluates the module graph per file — so the
 * second file that (transitively) imports @shrubbery/components re-runs the Lit
 * `@customElement(...)` registrations against an already-populated registry and
 * happy-dom throws `the name "mn-top-bar" has already been used`.
 *
 * Fix: make `customElements.define` IDEMPOTENT for the test run — a redefine of
 * an already-registered tag is a no-op (the first definition wins; it is the same
 * class either way). This is a TEST shim only; it does not touch the shipped
 * library (the components stay island-clean) and it is the standard way to let
 * multiple Lit-importing test files coexist in one registry. It also suppresses
 * Lit's dev-mode warning, mirroring the other packages' setup files.
 */

// Suppress Lit's "dev mode" console.warn via its documented dedup mechanism.
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
