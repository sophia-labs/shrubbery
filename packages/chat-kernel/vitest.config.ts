import { defineConfig } from 'vitest/config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default defineConfig({
  test: {
    globals: true,
    // The kernel will mount a REAL Lit <sh-chat-panel> into the DOM and run
    // marked + DOMPurify against real DOM. happy-dom matches runtime + nucleus +
    // garden/frontend's vitest environment.
    environment: 'happy-dom',
    execArgv: [`--localstorage-file=${join(tmpdir(), 'vitest-chat-kernel-localstorage.json')}`],
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**'],
  },
})
