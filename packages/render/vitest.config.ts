import { defineConfig } from 'vitest/config'

/**
 * @shrubbery/render unit tests.
 *
 * The render core is PURE (Lit-free, DOM-free): turtle/JSON-LD/markdown are all
 * string transforms over Triple[] + a resource model. So this runs in the plain
 * node environment — no happy-dom needed. jsonld is a pure transform dep.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**'],
  },
})
