import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { dynamicCellProxy } from '../../scripts/vite-cell-proxy.js'
import { cloud2ServiceProxy } from '../../scripts/vite-cloud2-service-proxy.js'
import { seeleCompileRoute } from './scripts/seele-compile-route.js'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * The organism is a PLAIN Vite app (no framework). It boots the real render host
 * + chrome components against real RDF. The workspace packages are consumed as
 * source (their `exports` point at `.ts`), so Vite transpiles them on the fly —
 * no pre-build step. The `?raw` import of the committed `.nt` seed (exported by
 * @shrubbery/nucleus) is handled natively by Vite.
 *
 * DEV PROXY (iteration 2 — gardend live-read):
 * When `pnpm gardend:dev` is running it writes .gardend-loopback.json with the
 * cell's random port + bearer token. Server-side middleware re-reads and
 * validates it for every request/WS upgrade, then proxies same-origin /cell/*
 * → the gardend loopback, injecting
 * `Authorization: Bearer <token>` on each forwarded request. This keeps the
 * random port + token OUT of browser JS — the browser only ever calls
 * same-origin /cell/mcp. The loopback already emits permissive CORS, so the
 * proxy's job is purely (1) hide port+token, (2) inject auth, (3) same-origin.
 * A gardend restart does not require a Vite restart. While the manifest or
 * target is unavailable, /cell returns a bounded structured 503—never fake
 * data and never an opaque proxy 500.
 *
 * SEELE COMPILE ROUTE (W7.1/W7.2a/W7.2b): `POST /seele/compile` shells to a
 * real `nature` binary (env NATURE_BIN, default the sibling nature/ checkout)
 * and relays its JSON compile-report verbatim. Dev-only by design (D17/F11):
 * this plugin — and the route it mounts — do not survive `vite build`.
 */

const LOOPBACK_FILE = process.env.GARDEND_LOOPBACK_MANIFEST
  ? resolve(process.env.GARDEND_LOOPBACK_MANIFEST)
  : resolve(__dir, '.gardend-loopback.json')

const cloud2ProxyValues = {
  gatewayBaseUrl: process.env.CLOUD2_GATEWAY_BASE_URL?.trim() ?? '',
  serviceTokenFile: process.env.CLOUD2_SERVICE_TOKEN_FILE?.trim() ?? '',
  onBehalfOf: process.env.CLOUD2_ON_BEHALF_OF?.trim() ?? '',
}
const cloud2ProxyEnabled = Object.values(cloud2ProxyValues).some(Boolean)
if (cloud2ProxyEnabled && Object.values(cloud2ProxyValues).some(value => !value)) {
  throw new Error(
    'CLOUD2_GATEWAY_BASE_URL, CLOUD2_SERVICE_TOKEN_FILE, and CLOUD2_ON_BEHALF_OF must be set together.',
  )
}

export default defineConfig({
  root: '.',
  plugins: [
    dynamicCellProxy({ manifestPath: LOOPBACK_FILE, websocket: true }),
    ...(cloud2ProxyEnabled ? [cloud2ServiceProxy({ ...cloud2ProxyValues, websocket: true })] : []),
    seeleCompileRoute(),
  ],
  optimizeDeps: {
    // The browser entry point resolves web_bg.wasm relative to its own module.
    // Prebundling rewrites that module into .vite/deps without copying the
    // sibling WASM, leaving Oxigraph's exported Store present but uninitialized.
    exclude: ['oxigraph'],
  },
  server: {
    port: 5180,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Multi-page build: the playground root (`index.html`) plus the RETIRED
      // Observatory page (`observatory.html`), which is now a tiny STATIC
      // redirect to `/?graph=observatory` — the Observatory renders inside the
      // normal Organism workspace whenever the active graph's :ux:config
      // declares a dashboard center (sh-layout-dashboard). The entry stays in
      // the production build ONLY so old /observatory.html links keep working;
      // it loads no module script. Every other page in this directory (the
      // *-harness.html proof pages) is dev-server-only, reached by direct URL,
      // deliberately NOT part of the production build.
      input: {
        main: resolve(__dir, 'index.html'),
        observatory: resolve(__dir, 'observatory.html'),
      },
    },
  },
})
