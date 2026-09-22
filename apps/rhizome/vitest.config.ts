import { defineConfig } from 'vitest/config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * RHIZOME app tests run in happy-dom: the DOM faces (plotView / bouquetView)
 * stamp Lit templates + the COMPONENT_LIBRARY custom elements into a real DOM,
 * and the render-smoke renders the live PLOT into a container and reads the HTML
 * (the renderDomString idiom: renderWorkspace(...).outerHTML).
 *
 * The render smoke (render-smoke.test.ts) hits the REAL cell — it is gated on the
 * cell being up (it self-skips with a clear message if /health is unreachable),
 * honoring the NO-MOCK rule without making CI depend on a live cell.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    execArgv: [`--localstorage-file=${join(tmpdir(), 'vitest-rhizome-localstorage.json')}`],
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**'],
    // Several smokes hit the SAME live cell and MUTATE a shared resource (the
    // entity-resolution `:entity-links` sidecar in 6a1eabeb-world): the entres
    // round-trip writes/deletes edges, and the greenhouse smoke cleans them in its
    // beforeAll so the marquee reads the fragmentation. Running files in parallel
    // races those mutations on one cell (a merge gets clobbered mid-assert). Run the
    // files SEQUENTIALLY so each owns the cell state for its lifetime (the smokes are
    // fast + self-cleaning; this keeps NO-MOCK honest without flakiness).
    fileParallelism: false,
  },
})
