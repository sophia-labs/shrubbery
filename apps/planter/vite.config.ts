import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dynamicCellProxy } from '../../scripts/vite-cell-proxy.js'
import { benchCell } from './vite-bench-cell.js'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * PLANTER — the generic curl-able host's browser mount (design §3.3). A plain
 * Vite app: `@shrubbery/source`'s `sourceFromBoot` is the ONLY adapter
 * factory, consumed identically by this SPA and by `src/server.ts`.
 *
 * DEV PROXY: this config CONSUMES `scripts/vite-cell-proxy.ts`'s
 * `dynamicCellProxy` (never edits it, per the campaign's NO-TOUCH list) so the
 * browser only ever calls same-origin `/cell/*` — the real bearer token is
 * injected server-side and never reaches browser JS. Two sources for the
 * cell's loopback coordinates (first wins, mirrors apps/rhizome exactly):
 *   1. `.gardend-loopback.json` next to this file (the standard organism
 *      recipe: `pnpm gardend:dev` in a sibling app, or the Chromium gate's
 *      spawned cell writing here via `GARDEND_LOOPBACK_MANIFEST`).
 *   2. env `GARDEND_PORT`/`GARDEND_TOKEN` (+ optional `GARDEND_HOST`) — the
 *      bench cell — so `GARDEND_PORT=7090 GARDEND_TOKEN=bench-token
 *      pnpm -C apps/planter dev` points straight at an already-running cell.
 *
 * MED-6 (no guessed coordinates): `benchCell()` is a FALLBACK, not a second
 * set of defaults — it only resolves when the caller EXPLICITLY set
 * `GARDEND_PORT` and `GARDEND_TOKEN`. When the manifest is missing/invalid
 * AND neither env var is set, `dynamicCellProxy` itself surfaces its honest
 * structured 503 (`loopback_manifest_missing`/`_invalid`) — never a hardcoded
 * `127.0.0.1:7090` + `bench-token` guess masquerading as a real endpoint.
 *
 * The default `public/planter.config.json` boots the SPA with
 * `{endpoint: '/cell', adapter: 'gardend-local', auth: {mode: 'none'}}` —
 * exactly this proxy's same-origin mount, so `pnpm dev` + a seeded cell is a
 * zero-config local loop. Port 5186 (rhizome uses 5185, atelier/emporium 5181,
 * organism 5180) so none of the dev cells/proxies collide.
 */

const LOOPBACK_FILE = process.env.GARDEND_LOOPBACK_MANIFEST
  ? resolve(process.env.GARDEND_LOOPBACK_MANIFEST)
  : resolve(__dir, '.gardend-loopback.json')

export default defineConfig({
  root: '.',
  plugins: [dynamicCellProxy({ manifestPath: LOOPBACK_FILE, fallback: benchCell })],
  server: {
    port: 5186,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
