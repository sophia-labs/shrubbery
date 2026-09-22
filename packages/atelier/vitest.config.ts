import { defineConfig } from 'vitest/config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default defineConfig({
  test: {
    globals: true,
    // mn-vtuber is a real custom element (WebGL canvas + CSS fallback avatar)
    // rendered into the DOM, so the tests need a real DOM. happy-dom matches
    // nucleus + runtime + components + garden.
    environment: 'happy-dom',
    execArgv: [`--localstorage-file=${join(tmpdir(), 'vitest-atelier-vtuber-localstorage.json')}`],
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**'],
  },
})
