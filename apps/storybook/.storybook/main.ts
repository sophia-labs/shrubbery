import type { StorybookConfig } from '@storybook/web-components-vite'

/**
 * Shrubbery Storybook — web-components (Lit) + Vite.
 *
 * Renders the REAL chrome components (@shrubbery/components) under the REAL
 * design tokens (@shrubbery/tokens). Stories source from REAL config
 * (GARDEN_DEFAULT / GARDEN_VARIANT) — no hand-written mock arg bags. The
 * workspace packages are consumed as source (their `exports` point at .ts), so
 * Vite transpiles them on the fly, same as the organism.
 */
const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.ts'],
  addons: ['@storybook/addon-essentials'],
  framework: {
    name: '@storybook/web-components-vite',
    options: {},
  },
  core: { disableTelemetry: true },
  // Hoja's MUS mode stories load Ovillo's mus-wasm (a build artifact of that repository) from /mus/.
  staticDirs: process.env.MUS_WASM_DIR ? [{ from: process.env.MUS_WASM_DIR, to: '/mus' }] : [],
}

export default config
