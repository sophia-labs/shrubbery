/**
 * Vitest setup for the @shrubbery/components chrome-component tests.
 *
 * Mirrors nucleus + runtime: suppress Lit's dev-mode console.warn (the
 * components import Lit) and clear the DOM after each test (each test mounts a
 * real custom element into the document).
 */
import { afterEach } from 'vitest'

// Suppress Lit's "dev mode" console.warn via its documented dedup mechanism.
;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings ??= new Set()
;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings!.add('dev-mode')

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})
