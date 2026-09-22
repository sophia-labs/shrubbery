import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dynamicCellProxy } from '../../scripts/vite-cell-proxy.js'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * The atelier is a PLAIN Vite app (no framework). It boots the real render host
 * against the minimal one-text-panel :ux:config read LIVE from a real gardend
 * cell. The workspace packages are consumed as source (their `exports` point at
 * `.ts`), so Vite transpiles them on the fly — no pre-build step.
 *
 * DEV PROXY (W0 — gardend live-read):
 * When `pnpm gardend:dev` is running it writes .gardend-loopback.json with the
 * cell's random port + bearer token. Server middleware re-reads it for each
 * request and proxies same-origin /cell/* → the gardend loopback, injecting
 * `Authorization: Bearer <token>` on each forwarded request. This keeps the
 * random port + token OUT of browser JS — the browser only ever calls
 * same-origin /cell/mcp. A cell restart needs no Vite restart; transient
 * manifest or target gaps are explicit retryable 503s, never faked data.
 *
 * Port 5181 (the organism uses 5180) so the two dev cells/proxies don't collide.
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
