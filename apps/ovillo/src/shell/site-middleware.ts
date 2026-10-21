/**
 * site-middleware.ts — NODE-SIDE: serve an Ovillo site's files to the app.
 *
 * The app reads the same paths wherever it runs; this serves them in dev, in
 * `vite preview`, in the CSP-checked static server (scripts/serve.mts), and to
 * the read-seam test:
 *
 *   GET /graph/ovillo.nt        the user:rdf N-Triples (the graph builder's out/ovillo.nt, or the fixture's)
 *   GET /graph/ux-config.nt     the :ux:config layouts, when the site has them (else 404, and the app uses its own)
 *   GET /media/… /scores/… /receipts/… /llms.txt   the site's files, with HTTP Range (seeking needs 206)
 *
 * Which site: `OVILLO_OUT=<graph builder out dir>` (`ovillo.nt` + `site/`), or
 * `OVILLO_NT` + `OVILLO_SITE` separately; by default the app's fixture. Nothing
 * is copied into this repo from there and nothing there is written.
 *
 *   GET /wasm/<module>.wasm     the engines, from the paths OVILLO_MUS_WASM, OVILLO_BENCH_WASM, OVILLO_TRACT_WASM
 *                               name (the ovillo repo builds them; they are never vendored here)
 */

/** The wasm modules the app loads, by published name, and the env variable that names each one's file. */
export const OVILLO_WASM: Readonly<Record<string, string>> = {
  'mus_wasm.wasm': 'OVILLO_MUS_WASM',
  'ovillo_web.wasm': 'OVILLO_BENCH_WASM',
  'tract.wasm': 'OVILLO_TRACT_WASM',
}

/** Published name → file, for the modules the environment names (and that exist). */
export function resolveOvilloWasm(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, key] of Object.entries(OVILLO_WASM)) {
    const file = env[key]
    if (file && existsSync(file)) out[name] = resolve(file)
  }
  return out
}

import { createReadStream, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const FIXTURE_DIR = join(APP_DIR, 'fixture')

export interface OvilloSite {
  readonly label: 'fixture' | 'graph builder out' | 'env'
  readonly graphNt: string
  readonly uxNt: string | null
  readonly siteDir: string
}

export function resolveOvilloSite(env: NodeJS.ProcessEnv = process.env): OvilloSite {
  if (env.OVILLO_OUT) {
    const out = resolve(env.OVILLO_OUT)
    const ux = join(out, 'ux-config.nt')
    return { label: 'graph builder out', graphNt: join(out, 'ovillo.nt'), uxNt: existsSync(ux) ? ux : null, siteDir: join(out, 'site') }
  }
  if (env.OVILLO_NT && env.OVILLO_SITE) {
    return { label: 'env', graphNt: resolve(env.OVILLO_NT), uxNt: env.OVILLO_UX ? resolve(env.OVILLO_UX) : null, siteDir: resolve(env.OVILLO_SITE) }
  }
  return { label: 'fixture', graphNt: join(FIXTURE_DIR, 'ovillo.nt'), uxNt: join(FIXTURE_DIR, 'ux-config.nt'), siteDir: join(FIXTURE_DIR, 'site') }
}

const TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.json': 'application/json; charset=utf-8',
  '.mus': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.nt': 'application/n-triples; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.wasm': 'application/wasm',
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(body)
}

/** Serve one file, with a single HTTP Range when asked (audio seeking needs 206). */
export function serveFile(req: IncomingMessage, res: ServerResponse, absPath: string, contentType?: string): void {
  let size: number
  try {
    const st = statSync(absPath)
    if (!st.isFile()) throw new Error('not a file')
    size = st.size
  } catch {
    sendText(res, 404, `ovillo: no such file: ${req.url ?? ''}`)
    return
  }
  res.setHeader('Content-Type', contentType ?? TYPES[extname(absPath)] ?? 'application/octet-stream')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'no-cache')
  const match = typeof req.headers.range === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range.trim()) : null
  if (match) {
    let start = match[1] !== '' ? Number(match[1]) : 0
    let end = match[2] !== '' ? Number(match[2]) : size - 1
    if (match[1] === '' && match[2] !== '') {
      start = Math.max(0, size - Number(match[2]))
      end = size - 1
    }
    if (start > end || start >= size) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${size}`)
      res.end()
      return
    }
    end = Math.min(end, size - 1)
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Content-Length', String(end - start + 1))
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(absPath, { start, end }).pipe(res)
    return
  }
  res.statusCode = 200
  res.setHeader('Content-Length', String(size))
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(absPath).pipe(res)
}

/** A path inside `root`, or null if the request would leave it. */
function inside(root: string, rel: string): string | null {
  const abs = normalize(join(root, rel))
  return abs === root || abs.startsWith(root + sep) ? abs : null
}

export type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void

export function ovilloSiteMiddleware(site: OvilloSite, wasm: Readonly<Record<string, string>> = {}): Middleware {
  const siteRoot = resolve(site.siteDir)
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://ovillo.invalid').pathname)
    if (path === '/graph/ovillo.nt') return serveFile(req, res, site.graphNt)
    if (path === '/graph/ux-config.nt') {
      if (!site.uxNt) return sendText(res, 404, 'ovillo: this site has no :ux:config layout graph')
      return serveFile(req, res, site.uxNt)
    }
    const module = /^\/wasm\/([a-z0-9_]+\.wasm)$/.exec(path)?.[1]
    if (module) {
      const file = wasm[module]
      // Not named here: a built bundle may carry it in its own wasm/ (the next handler serves that).
      if (!file) return next()
      return serveFile(req, res, file, 'application/wasm')
    }
    if (/^\/(media|scores|receipts)\//.test(path) || path === '/llms.txt') {
      const abs = inside(siteRoot, path.slice(1))
      if (!abs) return sendText(res, 403, 'ovillo: outside the site')
      return serveFile(req, res, abs)
    }
    next()
  }
}
