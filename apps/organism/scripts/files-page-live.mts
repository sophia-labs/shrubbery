/**
 * The Files harness against a running cell (Vera's local gardend by default), for looking at file pages with real data. Opened read-only
 * (`writable=0`): nothing is written. The cell's bearer is not given to this server at all: append it to the printed address as a
 * fragment (`#key=<bearer>`), which the browser keeps to itself; this script never prints or logs it.
 *
 *   CELL=http://127.0.0.1:7674 GRAPH=datasheet-library node --import tsx scripts/files-page-live.mts   (port: FILES_PAGE_PORT, 5251)
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.FILES_PAGE_PORT ?? 5251)
const cell = process.env.CELL ?? 'http://127.0.0.1:7674'
const graph = process.env.GRAPH ?? 'datasheet-library'
const server = await createServer({ root: appDir, configFile: resolve(appDir, 'vite.config.ts'), logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/files-cell': { target: cell, changeOrigin: true, rewrite: p => p.replace(/^\/files-cell/, '') } } } })
await server.listen()
console.log(`http://127.0.0.1:${port}/files-rudiments-browser-harness.html?cell=/files-cell&graph=${encodeURIComponent(graph)}&writable=0   (append #key=<bearer>)`)
