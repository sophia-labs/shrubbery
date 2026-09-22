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

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})
