import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { aiguaPlugin } from './src/shell/aigua-plugin.js'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * AVIARY is a plain Vite shell (no framework). The workspace packages are
 * consumed as source (their `exports` point at `.ts`), so Vite transpiles them
 * on the fly — no pre-build step.
 *
 * THE LIBRARY ROOT IS A SIBLING REPO, and it is NEVER copied into this one.
 * `aiguaPlugin` reads it in place, server-side, and exposes exactly three
 * same-origin routes: the two graph projections and a Range-capable `/media`.
 * The browser therefore never learns the absolute path, and nothing under
 * `mus/aigua` is written, moved, or duplicated.
 *
 * Override the location with AIGUA_DIR when the sibling checkout lives
 * elsewhere; the default is the repo-relative `../../../mus/aigua`.
 *
 * Port 5187 — 5180/5181 (organism, emporium+atelier), 5182, 5184, 5185, 5186
 * are taken by the other shells.
 */

export const AIGUA_DIR = process.env.AIGUA_DIR
  ? resolve(process.env.AIGUA_DIR)
  : resolve(__dir, '../../../mus/aigua')

export default defineConfig({
  root: '.',
  plugins: [aiguaPlugin({ root: AIGUA_DIR })],
  server: {
    port: 5187,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
