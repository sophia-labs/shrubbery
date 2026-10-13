/**
 * A local view of the PDF reader: the suites' CONTRACT-files v1 server seeded with real corpus datasheets (their production
 * `datasheet_facts` answers served verbatim), and the Files harness on a Vite dev server. Stays up until killed.
 *
 *   node --import tsx scripts/files-reader-local.mts      (port: FILES_READER_PORT, 5250)
 *   http://127.0.0.1:5250/files-rudiments-browser-harness.html?cell=/files-cell&token=test-bearer&graph=files-graph
 *   deep link: add  #evidence=ds-cf72dfd0ac69eec6-params-vin
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { startFilesContractServer } from '../src/cell/__tests__/support/files-contract-server.js'
import { seedDatasheetLibrary } from '../src/cell/__tests__/support/datasheet-library-seed.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.FILES_READER_PORT ?? 5250)
const cell = await startFilesContractServer({ graphIncarnation: 'inc-reader-local', anyFolder: true })
await seedDatasheetLibrary(cell)
const server = await createServer({ root: appDir, configFile: resolve(appDir, 'vite.config.ts'), logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/files-cell': { target: cell.base, changeOrigin: true, rewrite: p => p.replace(/^\/files-cell/, '') } } } })
await server.listen()
console.log('PDF reader local view:')
console.log(`  http://127.0.0.1:${port}/files-rudiments-browser-harness.html?cell=/files-cell&token=${cell.token}&graph=${cell.graphId}`)
console.log(`  deep link: ...&graph=${cell.graphId}#evidence=ds-cf72dfd0ac69eec6-params-vin`)
