/**
 * Vitest setup for the nucleus engine tests.
 *
 * Minimal port of garden/frontend's src/__tests__/setup.ts — only the parts the
 * pure engine tests actually need:
 *   - suppress Lit's dev-mode console.warn (frame-divergence imports Lit)
 *   - clear the DOM after each test (frame-divergence renders into document)
 */
import { afterEach } from 'vitest'

// Suppress Lit's "dev mode" console.warn via its documented dedup mechanism.
;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings ??= new Set()
;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings!.add('dev-mode')

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})
