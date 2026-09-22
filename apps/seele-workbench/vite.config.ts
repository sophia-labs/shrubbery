import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dynamicCellProxy } from '../../scripts/vite-cell-proxy.js'
import { seeleCompileRoute } from '@shrubbery/organism/scripts/seele-compile-route'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * The SEELe workbench vessel (ratification D17: a special Vite shrubbery app
 * over a LOCAL gardend, Tauri packaging later — not hosted, not wasm).
 *
 * Two server-side seams, both same-origin, both dev-server-only by design:
 *
 *   `/cell/*`       → `dynamicCellProxy`, CONSUMED from the shared
 *                     `scripts/vite-cell-proxy.ts` (never forked). It reads
 *                     `.gardend-loopback.json` next to this file for the local
 *                     cell's random port + bearer token and injects the
 *                     `Authorization` header server-side, so neither ever
 *                     reaches browser JS. While the manifest or the target is
 *                     unavailable it returns a bounded structured 503 — never
 *                     fake data.
 *
 *   `/seele/compile` → `seeleCompileRoute`, CONSUMED from `@shrubbery/organism`
 *                     (stage 4 built and tested it there; it is imported
 *                     through that package's declared `exports` map rather
 *                     than copied, so there is exactly one implementation and
 *                     one test suite for it). It shells to the real `nature`
 *                     binary — `NATURE_BIN`, default the sibling
 *                     `nature/target/debug/nature` — and relays the JSON
 *                     compile report verbatim.
 *
 * Neither survives `vite build`: a static bundle has no server (F11). That is
 * the honest consequence of D17, not an omission — the vessel's next step is a
 * Tauri host that owns both seams natively, not a CDN.
 */

const LOOPBACK_FILE = process.env.GARDEND_LOOPBACK_MANIFEST
  ? resolve(process.env.GARDEND_LOOPBACK_MANIFEST)
  : resolve(__dir, '.gardend-loopback.json')

export default defineConfig({
  root: '.',
  plugins: [dynamicCellProxy({ manifestPath: LOOPBACK_FILE, websocket: true }), seeleCompileRoute()],
  optimizeDeps: {
    // Oxigraph's browser entry resolves `web_bg.wasm` relative to its own
    // module; prebundling rewrites that module into `.vite/deps` without
    // copying the sibling WASM. Same exclusion, same reason, as the organism.
    exclude: ['oxigraph'],
  },
  server: {
    port: 5182,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
