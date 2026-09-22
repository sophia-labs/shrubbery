import { defineConfig, type Plugin } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dynamicCellProxy, type CellProxyEndpoint } from '../../scripts/vite-cell-proxy.js'
import { TraceWorld } from './src/trace-world.js'

const __dir = dirname(fileURLToPath(import.meta.url))

/**
 * The RHIZOME app — a plain Vite shell that renders a live gardend cell's
 * :projection:memory as THE PLOT / THE BOUQUET / THE SCRUBBER (the `dom` face of
 * slice-1's memory world). NO mock — the browser reads the real cell.
 *
 * DEV PROXY: the browser only ever calls same-origin /cell. We proxy /cell/* → the
 * gardend loopback, injecting `Authorization: Bearer <token>` server-side so the
 * token never reaches browser JS. Two sources for the cell coordinates (first wins):
 *   1) a .gardend-loopback.json next to this file (the standard organism recipe).
 *   2) env GARDEND_HOST/PORT/TOKEN (the bench cell: 127.0.0.1:7090 / bench-token) —
 *      so `GARDEND_PORT=7090 GARDEND_TOKEN=bench-token pnpm -C apps/rhizome dev`
 *      points straight at the already-running observatory cell.
 * Resolution happens per request, so replacing the manifest switches a live
 * Vite process to the restarted cell without exposing either bearer.
 */

const LOOPBACK_FILE = process.env.GARDEND_LOOPBACK_MANIFEST
  ? resolve(process.env.GARDEND_LOOPBACK_MANIFEST)
  : resolve(__dir, '.gardend-loopback.json')

function benchCell(): CellProxyEndpoint {
  const host = process.env.GARDEND_HOST ?? '127.0.0.1'
  const port = process.env.GARDEND_PORT ?? '7090'
  const token = process.env.GARDEND_TOKEN ?? 'bench-token'
  return { apiUrl: `http://${host}:${port}`, token }
}

/**
 * The WALK trace middleware — the browser SPA can't read files, so we read the
 * runs dir SERVER-SIDE and serve the parsed JSON same-origin (mirroring the /cell
 * proxy idea). The SPA's walk data fetches /traces (the index) + /traces/{runId}
 * (one parsed run, optionally ?turn=N). The reader is the SAME TraceWorld the
 * conneg server + the smoke use — one data path, two callers.
 *
 * NOTE: this is a DEV middleware. A static-build Walk (vite preview / S3) has no
 * Node to read the files — it would need the conneg server (server.ts) as a
 * backend, exactly like the /cell proxy's static-build limitation.
 */
function tracesMiddleware(): Plugin {
  const world = new TraceWorld()
  return {
    name: 'rhizome-traces',
    configureServer(server) {
      server.middlewares.use('/traces', (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const seg = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean)
        const send = (status: number, body: unknown): void => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(body))
        }
        // /traces → the index; /traces/{runId} (+ ?turn=N) → one parsed run.
        const promise =
          seg.length === 0
            ? world.walk()
            : world.trace(
                decodeURIComponent(seg[0]),
                url.searchParams.has('turn') ? Number(url.searchParams.get('turn')) : null,
              )
        promise
          .then((data) => {
            if (data === null) send(404, { error: `no run ${seg[0]}` })
            else send(200, data)
          })
          .catch((err: unknown) => {
            send(500, { error: err instanceof Error ? err.message : String(err) })
          })
        void next // handled
      })
    },
  }
}

export default defineConfig({
  root: '.',
  plugins: [
    dynamicCellProxy({ manifestPath: LOOPBACK_FILE, fallback: benchCell }),
    tracesMiddleware(),
  ],
  server: {
    port: 5185,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
