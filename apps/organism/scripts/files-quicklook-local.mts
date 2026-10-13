/**
 * A local view of the Files reader: the suites' CONTRACT-files v1 server seeded with one file of each kind (the browser
 * script's fixtures) plus real PDFs, and the Files harness on a Vite dev server. Stays up until killed.
 *
 *   PDF_DIR=/path/to/pdfs node --import tsx scripts/files-quicklook-local.mts     (port: FILES_QUICKLOOK_LOCAL_PORT, 5248)
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { startFilesContractServer } from '../src/cell/__tests__/support/files-contract-server.js'
import { quicklookFixtures } from './files-quicklook-fixtures.mjs'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.FILES_QUICKLOOK_LOCAL_PORT ?? 5248)
const pdfDir = process.env.PDF_DIR ?? ''
const pdfs = (process.env.PDFS ?? '').split(',').map(s => s.trim()).filter(Boolean)

const cell = await startFilesContractServer({ graphIncarnation: 'inc-quicklook-local' })
const files = quicklookFixtures(`http://127.0.0.1:${port}/__remote`)
if (pdfDir) {
  const names = pdfs.length ? pdfs : readdirSync(pdfDir).filter(n => n.toLowerCase().endsWith('.pdf')).slice(0, 3)
  for (const name of names) files.push({ name, type: 'application/pdf', bytes: new Uint8Array(readFileSync(join(pdfDir, name))) })
}
for (const f of files) {
  const form = new FormData(); form.set('file', new File([new Uint8Array(f.bytes)], f.name, { type: f.type }))
  const r = await fetch(`${cell.base}/artifacts/${cell.graphId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${cell.token}` }, body: form })
  if (!r.ok) throw new Error(`seed ${f.name}: ${r.status} ${await r.text()}`)
}
const server = await createServer({ root: appDir, configFile: resolve(appDir, 'vite.config.ts'), logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/files-cell': { target: cell.base, changeOrigin: true, rewrite: p => p.replace(/^\/files-cell/, '') } } } })
await server.listen()
console.log(`Files reader local view (${files.length} files):`)
console.log(`  http://127.0.0.1:${port}/files-rudiments-browser-harness.html?cell=/files-cell&token=${cell.token}&graph=${cell.graphId}`)
