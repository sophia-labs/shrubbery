import { defineConfig } from 'vitest/config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default defineConfig({
  test: {
    globals: true,
    // The render host stamps Lit templates into the DOM, so the tests need a
    // real DOM. happy-dom matches nucleus + garden/frontend's vitest environment.
    environment: 'happy-dom',
    execArgv: [`--localstorage-file=${join(tmpdir(), 'vitest-runtime-localstorage.json')}`],
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**'],
    // hoja-document-face.integration.test.ts spawns a real gardend binary and
    // does real WebSocket round-trips (mirrors apps/organism's own vitest
    // config tuning for its real-cell integration suites) — everything else
    // in this package finishes well under the default 5s ceiling regardless.
    testTimeout: 40000,
    hookTimeout: 60000,
  },
})
