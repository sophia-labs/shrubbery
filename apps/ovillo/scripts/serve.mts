/**
 * Serve the BUILT app (dist/) beside an Ovillo site under the deployment's CSP:
 * own-origin scripts only (no inline script), 'wasm-unsafe-eval', blob: workers,
 * inline styles. Every response carries the header, so a console clean here is
 * a console clean there.
 *
 *   pnpm --filter @shrubbery/ovillo build
 *   pnpm --filter @shrubbery/ovillo serve -- --port 4180            # the fixture
 *   OVILLO_OUT=<graph builder out> pnpm --filter @shrubbery/ovillo serve
 *   pnpm --filter @shrubbery/ovillo serve -- --gardend http://127.0.0.1:7792   # proxy /mcp (?source=gardend)
 */
import { createServer, request as httpRequest } from 'node:http'
import { existsSync, statSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ovilloSiteMiddleware, resolveOvilloSite, resolveOvilloWasm, serveFile } from '../src/shell/site-middleware.js'

export const OVILLO_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ')

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const appDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dist = resolve(arg('dist', join(appDir, 'dist')))
const port = Number(arg('port', '4180'))
const gardend = arg('gardend', '')
const site = resolveOvilloSite()
const siteMiddleware = ovilloSiteMiddleware(site, resolveOvilloWasm())

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`no built app at ${dist}: run the build first`)
  process.exit(1)
}

const server = createServer((req, res) => {
  res.setHeader('Content-Security-Policy', OVILLO_CSP)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://ovillo.invalid').pathname)
  if (gardend && path === '/mcp') {
    const target = new URL('/mcp', gardend)
    const upstream = httpRequest(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    })
    upstream.on('error', (e) => {
      res.statusCode = 502
      res.end(`ovillo serve: /mcp → ${gardend} failed: ${e.message}`)
    })
    req.pipe(upstream)
    return
  }
  siteMiddleware(req, res, () => {
    const rel = path === '/' ? 'index.html' : path.slice(1)
    const abs = normalize(join(dist, rel))
    if (!(abs === dist || abs.startsWith(dist + sep)) || !existsSync(abs) || !statSync(abs).isFile()) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('not found')
      return
    }
    serveFile(req, res, abs, abs.endsWith('.html') ? 'text/html; charset=utf-8' : abs.endsWith('.js') ? 'text/javascript; charset=utf-8' : abs.endsWith('.css') ? 'text/css; charset=utf-8' : abs.endsWith('.woff2') ? 'font/woff2' : undefined)
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`ovillo (built, CSP) on http://127.0.0.1:${port}/ · site: ${site.label} (${site.graphNt})${gardend ? ` · /mcp → ${gardend}` : ''}`)
})
