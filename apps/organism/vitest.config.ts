import { defineConfig } from 'vitest/config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The organism's tests are SHELL-SIDE integration tests. The gardend live-read
 * test spawns a REAL gardend (node:child_process) and renders the live config
 * into a real DOM (happy-dom), so this matches the runtime package's env.
 *
 * The integration test spawns a 173MB binary and does network round-trips, so
 * we run it single-threaded with a generous timeout (no parallel cells fighting
 * over rocksdb locks).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    // Idempotent customElements.define shim — lets multiple Lit-importing test
    // files coexist in single-fork's shared happy-dom registry. See tests/setup.ts.
    setupFiles: ['./tests/setup.ts'],
    execArgv: [`--localstorage-file=${join(tmpdir(), 'vitest-organism-localstorage.json')}`],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 40000,
    hookTimeout: 60000,
    // One cell at a time — fresh-profile spawns must not race for ports/locks.
    fileParallelism: false,
    poolOptions: { forks: { singleFork: true } },
  },
})
