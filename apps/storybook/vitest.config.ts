import { defineConfig } from 'vitest/config'

/**
 * The Storybook app's CATALOG-COHERENCE tests (iteration 3c) + the conneg
 * (curl-hypermedia) tests (curl-spike B0).
 *
 * These are NOT Storybook's own visual tests (those run in a real browser via
 * @storybook/test-runner / Playwright). They are pure-logic assertions that the
 * two catalog faces stay coherent: every manifested component (from the
 * component-library MANIFEST) has a catalog entry AND a generated story; and that
 * the conneg server/build render the real resources to the four curl-able faces.
 * They run in happy-dom because the catalog model touches `customElements`
 * (isBuilt) once the @shrubbery/components side-effect import upgrades the chrome.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['catalog/**/*.test.ts', 'conneg/**/*.test.ts'],
    exclude: ['node_modules/**', 'storybook-static/**', 'conneg-static/**'],
  },
})
