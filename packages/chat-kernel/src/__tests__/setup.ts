/**
 * Vitest setup for the @shrubbery/chat-kernel tests.
 *
 * Mirrors runtime/nucleus/editor-kernel's setup: clear the DOM after each test
 * (the kernel mounts a REAL Lit <sh-chat-panel> into the document during
 * functional tests). The litIssuedWarnings dedup idiom is apt here — the kernel
 * DOES use Lit.
 */
import { afterEach } from 'vitest'

;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings ??= new Set()
;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings!.add('dev-mode')

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})
