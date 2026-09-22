import { defineConfig } from 'vitest/config'

/**
 * The workbench's fast lane. These tests exercise the REAL builder, the REAL
 * nucleus validator/solver, the REAL editor kernel and (in the compile-seam
 * test) the REAL `nature` binary through the REAL Vite dev-server route — but
 * they do not spawn a cell or a browser. That is the browser script's job
 * (`scripts/seele-workbench-gardend-browser.mts`), which is the acceptance
 * organism for this app.
 *
 * happy-dom, single-fork, idempotent `customElements.define` shim: the same
 * shape `apps/organism` already uses, for the same reason (several Lit-
 * importing files sharing one registry).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 40000,
    hookTimeout: 60000,
    fileParallelism: false,
    poolOptions: { forks: { singleFork: true } },
  },
})
