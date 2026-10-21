import { defineConfig, type Plugin } from 'vite'
import { ovilloSiteMiddleware, resolveOvilloSite } from './src/shell/site-middleware.js'

/**
 * OVILLO is a plain Vite shell over workspace packages consumed as source.
 *
 * Dev and preview serve the site's files beside the app (src/shell/site-middleware.ts):
 * the fixture by default, or a graph builder's out/ with OVILLO_OUT=<dir>. With
 * OVILLO_GARDEND=<url> the dev server also proxies `/mcp` to a public-mode gardend,
 * so `?source=gardend` reads the graph over SPARQL as a visitor would.
 *
 * The build is static and CSP-clean (own-origin scripts only, no inline script,
 * no data: URIs): `assetsInlineLimit: 0`, and index.html carries no script but
 * the module entry. Port 5191 (5180–5190 are the other shells).
 */

const site = resolveOvilloSite()

function ovilloSite(): Plugin {
  const middleware = ovilloSiteMiddleware(site)
  return {
    name: 'ovillo-site',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

const gardend = process.env.OVILLO_GARDEND
const proxy = gardend ? { '/mcp': { target: gardend, changeOrigin: true } } : undefined

export default defineConfig({
  root: '.',
  base: './',
  plugins: [ovilloSite()],
  server: { port: 5191, ...(proxy ? { proxy } : {}) },
  preview: { port: 5192, ...(proxy ? { proxy } : {}) },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'es2022',
  },
})
