import { defineConfig } from 'vitest/config'

/**
 * OVILLO's tests run on real inputs: the fixture graph and its files (and, when
 * one is running, a real public-mode gardend), read through the real adapters
 * and the real middleware behind a real loopback HTTP server. happy-dom for the
 * elements; the read-seam suites pin themselves to node.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
})
