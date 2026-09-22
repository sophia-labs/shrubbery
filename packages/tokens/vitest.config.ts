import { defineConfig } from 'vitest/config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The tokens tests are REAL — they parse the emitted tokens.css with a real CSS
 * tokenizer-ish reader (no mock token bag) and, where a DOM is needed, mount the
 * CSS in happy-dom and read getComputedStyle. happy-dom matches the rest of the
 * workspace.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    execArgv: [`--localstorage-file=${join(tmpdir(), 'vitest-tokens-localstorage.json')}`],
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**'],
  },
})
