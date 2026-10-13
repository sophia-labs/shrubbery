import { defineConfig } from 'vitest/config'

/**
 * AVIARY's tests are SHELL-SIDE and run against real inputs:
 *   - the projection/model round-trip reads the REAL aigua directory;
 *   - the read-seam test drives the REAL middleware behind a REAL node:http
 *     server through the REAL `ntHttpSource` (no stubbed fetch, no fixture);
 *   - the browser test builds the app with Vite and drives real Chromium.
 *
 * happy-dom matches the other shells' env so the Lit elements can be rendered
 * in the source lane. The browser suite carries the `.browser.test.ts` infix so
 * the root `test:source` script excludes it and `test:browser-suites` owns it.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 60000,
    hookTimeout: 180000,
    fileParallelism: false,
    poolOptions: { forks: { singleFork: true } },
  },
})
