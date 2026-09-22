/**
 * Vitest setup for the @shrubbery/editor-kernel tests.
 *
 * Mirrors runtime/nucleus's setup: clear the DOM after each test (a REAL TipTap
 * Editor mounts ProseMirror into the document during functional tests). No Lit
 * here — the kernel is pure TipTap/ProseMirror — but we keep the litIssuedWarnings
 * dedup idiom harmlessly in case a transitive dep probes it.
 */
import { afterEach } from 'vitest'

;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings ??= new Set()
;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings!.add('dev-mode')

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})
