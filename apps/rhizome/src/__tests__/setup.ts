/**
 * Vitest setup for the RHIZOME app DOM tests. Mirrors @shrubbery/runtime's setup:
 * suppress Lit dev-mode warnings (the views import Lit + the components) and clear
 * the DOM after each test.
 */
import { afterEach } from 'vitest'

;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings ??= new Set()
;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings!.add('dev-mode')

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})
