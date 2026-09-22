import { defineConfig } from 'vitest/config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default defineConfig({
  test: {
    globals: true,
    // The frame-divergence engine test renders Lit templates into the DOM, so it
    // needs a DOM. happy-dom matches garden/frontend's vitest environment.
    environment: 'happy-dom',
    execArgv: [`--localstorage-file=${join(tmpdir(), 'vitest-localstorage.json')}`],
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**'],
  },
})
