import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dynamicCellProxy } from '../../scripts/vite-cell-proxy.js'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * The EMPORIUM app is a DEDICATED, plain Vite product shell (no framework). It
 * boots the shrubbery library (@shrubbery/{components,tokens,render}) + the
 * shell-side live /emporium read (@shrubbery/source's './emporium' subpath) against a REAL
 * gardend cell — no backend in the library, no mock.
 *
 * DEV PROXY — shared with apps/organism:
 * When `pnpm gardend:dev` is running it writes .gardend-loopback.json with the
 * cell's random port + bearer token. Server middleware re-reads it for each
 * request and proxies same-origin /cell/* → the gardend loopback, injecting
 * `Authorization: Bearer <token>` on each forwarded request. This keeps the
 * random port + token OUT of browser JS — the browser only ever calls
 * same-origin /cell (e.g. /cell/emporium/vocabs). The loopback emits permissive
 * CORS; the proxy's job is purely (1) hide port+token, (2) inject auth,
 * (3) same-origin. A cell restart needs no Vite restart; transient manifest or
 * target gaps are explicit retryable 503s, never faked data.
 */

const LOOPBACK_FILE = process.env.GARDEND_LOOPBACK_MANIFEST
  ? resolve(process.env.GARDEND_LOOPBACK_MANIFEST)
  : resolve(__dir, '.gardend-loopback.json')

export default defineConfig({
  root: '.',
  plugins: [dynamicCellProxy({ manifestPath: LOOPBACK_FILE })],
  server: {
    port: 5181,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
