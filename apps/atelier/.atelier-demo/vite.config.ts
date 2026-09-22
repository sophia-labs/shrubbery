import { resolve } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ProxyOptions, ViteDevServer } from 'vite'
import type { MirrorRequestBody, MirrorResponseBody } from './mirror-handler.js'

// Rooted at apps/atelier so vite resolves the workspace @shrubbery/* deps through
// this app's real node_modules links. Serves ONLY this workstream's committed VRM
// fixtures. Same-origin /cell/* is proxied to the running gardend cell (port+token
// read server-side from .gardend-loopback.json, never exposed to browser JS) — the
// exact pattern the real apps/atelier app uses. No cell → /cell is unproxied and the
// demo reports the honest live-read error (never faked).
const app = resolve(__dirname, '..')
const workspace = resolve(app, '../..')
const LOOPBACK = resolve(app, '.gardend-loopback.json')
const FIXTURES_DIR = resolve(workspace, 'packages/atelier/fixtures/vrm')
const MIRROR_HANDLER = resolve(__dirname, 'mirror-handler.ts')

interface LoopbackManifest {
  apiUrl?: string
  token?: string
}

function readLoopbackManifest(): LoopbackManifest | undefined {
  if (!existsSync(LOOPBACK)) return undefined
  try {
    return JSON.parse(readFileSync(LOOPBACK, 'utf8')) as LoopbackManifest
  } catch {
    return undefined
  }
}

function cellProxy(): Record<string, ProxyOptions> | undefined {
  const m = readLoopbackManifest()
  if (!m?.apiUrl) return undefined
  return {
    '/cell': {
      target: m.apiUrl,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/cell/, ''),
      configure(proxy) {
        proxy.on('proxyReq', (req) => { if (m.token) req.setHeader('Authorization', `Bearer ${m.token}`) })
      },
    },
  }
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    let data = ''
    req.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')))
    req.on('end', () => resolveBody(data))
    req.on('error', rejectBody)
  })
}

/**
 * The mirror route — S3 made VISIBLE. POSTs here run the REAL headless-render
 * (renderAndArchive, via mirror-handler.ts's runMirror) server-side in this
 * Node process (renderPortrait spawns playwright+vite — Node-only, never
 * browser-reachable) against the SAME gardend cell the /cell proxy above
 * talks to, using the SAME apiUrl + bearer recipe read from
 * .gardend-loopback.json. Body (all optional):
 * { appearance?, expression?, cameraFrame?, fixture? }.
 *
 * mirror-handler.ts is loaded via `server.ssrLoadModule` — NOT a plain
 * top-level `import` in THIS file — because vite's own config file is loaded
 * through a minimal Node-native ESM path that can't resolve workspace
 * packages leaning on bundler-style extensionless imports (confirmed
 * empirically: a direct `import` of @shrubbery/nucleus here crashes config
 * load with ERR_MODULE_NOT_FOUND on nucleus's own internals). ssrLoadModule
 * routes the handler through vite's normal dev-server resolve pipeline
 * instead, exactly like the browser side already gets.
 */
function mirrorRoutePlugin(): Plugin {
  return {
    name: 'atelier-mirror-route',
    configureServer(server) {
      server.middlewares.use('/mirror', (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
        if (req.method !== 'POST') { next(); return }
        void handleMirror(server, req, res)
      })
    },
  }
}

async function handleMirror(server: ViteDevServer, req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('content-type', 'application/json')
  try {
    const manifest = readLoopbackManifest()
    if (!manifest?.apiUrl || !manifest.token) {
      throw new Error('no gardend cell running (.gardend-loopback.json missing) — start one with: pnpm gardend:dev')
    }
    const bodyText = await readRequestBody(req)
    const body = (bodyText ? JSON.parse(bodyText) : {}) as MirrorRequestBody

    const { runMirror } = await server.ssrLoadModule(MIRROR_HANDLER) as { runMirror: (
      loopback: { apiUrl: string; token: string },
      body: MirrorRequestBody,
      fixturesDir: string,
    ) => Promise<MirrorResponseBody> }

    const result = await runMirror({ apiUrl: manifest.apiUrl, token: manifest.token }, body, FIXTURES_DIR)

    res.statusCode = 200
    res.end(JSON.stringify(result))
  } catch (err) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: (err as Error).message }))
  }
}

export default {
  root: app,
  optimizeDeps: { entries: [resolve(__dirname, 'index.html')] },
  server: { fs: { allow: [workspace] }, proxy: cellProxy() },
  plugins: [mirrorRoutePlugin()],
}
