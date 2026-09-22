import { defineConfig } from 'vitest/config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The emporium app's tests are SHELL-SIDE integration tests. The live-read test
 * spawns a REAL gardend (via the @shrubbery/source/node spawn helper) and
 * renders the live catalogue into a real DOM (happy-dom). It spawns the real
 * binary + does network round-trips, so it runs single-threaded with a generous
 * timeout (no parallel cells fighting over rocksdb locks) — same recipe as
 * apps/organism's vitest config.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    execArgv: [`--localstorage-file=${join(tmpdir(), 'vitest-emporium-localstorage.json')}`],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 40000,
    hookTimeout: 60000,
    // One cell at a time — fresh-profile spawns must not race for ports/locks.
    fileParallelism: false,
    poolOptions: { forks: { singleFork: true } },
  },
})
