/**
 * A local view of Show info: the suites' CONTRACT-files v1 server seeded with a real datasheet PDF (with the importer's light records), a
 * text file, a document, a folder and a connection between two items, and the Files harness on a Vite dev server. Stays up until killed.
 *
 *   PDF_DIR=/path/to/datasheets node --import tsx scripts/files-info-local.mts     (port: FILES_INFO_LOCAL_PORT, 5249)
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { startFilesContractServer } from '../src/cell/__tests__/support/files-contract-server.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.FILES_INFO_LOCAL_PORT ?? 5249)
const pdfDir = process.env.PDF_DIR ?? '/path/to/private-evidence/2026-10-08-datasheets/corpus/datasheets'
const PDF = process.env.PDF ?? 'bosch-bme280-datasheet.pdf'

const cell = await startFilesContractServer({ graphIncarnation: 'inc-info-local', anyFolder: true })
cell.folders.set('fld-kitchen', { id: 'fld-kitchen', name: 'Kitchen', parentId: null, section: 'documents', order: 90 })
cell.folders.set('fld-sensors', { id: 'fld-sensors', name: 'Sensors', parentId: null, section: 'artifacts', order: 91 })
cell.documents.set('doc-plan', { id: 'doc-plan', title: 'Weather station plan', parentId: 'fld-kitchen', order: 1 })
cell.documentFacts.set('doc-plan', { words: 1234, createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-10-07T17:30:00Z' })
const ids = new Map<string, string>()
async function upload(name: string, type: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const form = new FormData(); form.set('file', new File([bytes], name, { type }))
  const r = await fetch(`${cell.base}/artifacts/${cell.graphId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${cell.token}` }, body: form })
  const body = await r.json() as { id?: string; artifact?: { id: string } }
  ids.set(name, String(body.id ?? body.artifact?.id))
}
await upload(PDF, 'application/pdf', new Uint8Array(readFileSync(join(pdfDir, PDF))))
await upload('Field notes.txt', 'text/plain', new TextEncoder().encode('Calibrated against the roof thermometer on Tuesday.\n') as Uint8Array<ArrayBuffer>)
cell.artifacts.get(ids.get('Field notes.txt')!)!.value.parentId = 'fld-sensors'
cell.revisionCounts.set(ids.get('Field notes.txt')!, 4)
cell.createdBy.set(ids.get('Field notes.txt')!, 'Vera')
cell.datasheets.set(ids.get(PDF)!, { part: 'BME280', maker: 'Bosch Sensortec', rev: '1.24', productType: 'sensor', rowCount: 318, toCheck: 2, registerCount: 41,
  reader: { tool: 'datasheet-parser (NomDeTom)', commit: 'ee680a6f1c2d', docling: '2.135.0' }, params: [
    { pred: 'supplyVoltage', lo: 1.71, hi: 3.6, unit: 'V', conf: 'high' }, { pred: 'accuracy', typ: 1, unit: '°C', conf: 'medium', checked: true },
    { pred: 'range', lo: 300, hi: 1100, unit: 'hPa', conf: 'contested', diag: 'readers_disagree' }] })
cell.wires.set('w-1', { id: 'w-1', sourceDocumentId: ids.get('Field notes.txt')!, targetDocumentId: ids.get(PDF)!, targetGraphId: cell.graphId, predicate: 'supports', bidirectional: false })
cell.wires.set('w-2', { id: 'w-2', sourceDocumentId: 'doc-plan', targetDocumentId: ids.get(PDF)!, targetGraphId: cell.graphId, predicate: 'requires', bidirectional: false })

const server = await createServer({ root: appDir, configFile: resolve(appDir, 'vite.config.ts'), logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/files-cell': { target: cell.base, changeOrigin: true, rewrite: p => p.replace(/^\/files-cell/, '') } } } })
await server.listen()
console.log('Show info local view:')
console.log(`  http://127.0.0.1:${port}/files-rudiments-browser-harness.html?cell=/files-cell&token=${cell.token}&graph=${cell.graphId}`)
