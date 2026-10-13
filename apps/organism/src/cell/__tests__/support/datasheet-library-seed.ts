/**
 * A small datasheet library for the PDF reader's local view and browser script: REAL corpus PDFs, uploaded under the artifact ids
 * they have in production, with the importer's light records (for the card) and the verbatim `datasheet_facts` answers captured from
 * production for them (fixtures/datasheet-facts). Nothing here is invented except the light-record summary of a sheet.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FilesContractServer } from './files-contract-server.js'

const here = dirname(fileURLToPath(import.meta.url))
export const FACTS_DIR = resolve(here, '../fixtures/datasheet-facts')
export const CORPUS_DIR = process.env.PDF_DIR ?? '/path/to/private-evidence/2026-10-08-datasheets/corpus/datasheets'

export const TPS = { file: 'ti-tps54331-datasheet.pdf', artifact: 'ds-cf72dfd0ac69eec6', label: 'TPS54331.pdf' }
export const VISHAY = { file: 'vishay-si2302cds-datasheet.pdf', artifact: 'ds-728a4847478dc4de', label: 'SI2302CDS.pdf' }
export const PLAIN = { file: 'jst-ph-connector.pdf', artifact: 'plain-jst', label: 'JST connector.pdf' }

async function upload(cell: FilesContractServer, id: string, label: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const form = new FormData()
  form.set('file', new File([bytes], label, { type: 'application/pdf' }))
  form.set('artifactId', id)
  const r = await fetch(`${cell.base}/artifacts/${cell.graphId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${cell.token}` }, body: form })
  if (!r.ok) throw new Error(`upload ${label}: ${r.status} ${await r.text()}`)
}

export async function seedDatasheetLibrary(cell: FilesContractServer): Promise<void> {
  const pdf = (file: string) => new Uint8Array(readFileSync(join(CORPUS_DIR, file)))
  await upload(cell, TPS.artifact, TPS.label, pdf(TPS.file))
  await upload(cell, VISHAY.artifact, VISHAY.label, pdf(VISHAY.file))
  await upload(cell, PLAIN.artifact, PLAIN.label, pdf(PLAIN.file))
  cell.datasheetFacts.set(TPS.artifact, JSON.parse(readFileSync(join(FACTS_DIR, `${TPS.file}.json`), 'utf8')))
  cell.datasheetFacts.set(VISHAY.artifact, JSON.parse(readFileSync(join(FACTS_DIR, `${VISHAY.file}.json`), 'utf8')))
  cell.datasheets.set(TPS.artifact, { part: 'TPS54331', maker: 'Texas Instruments', productType: 'DC/DC converter', rowCount: 47, toCheck: 6,
    reader: { tool: 'datasheet-parser (NomDeTom)', commit: 'ee680a6f1c2d', docling: '2.135.0' }, params: [
      { pred: 'inputVoltage', hi: 28, unit: 'V', conf: 'low', diag: 'disagreement' }, { pred: 'outputCurrent', hi: 3, unit: 'A', conf: 'medium' },
      { pred: 'switchingFrequency', typ: 570, unit: 'kHz', conf: 'medium' }] })
  cell.datasheets.set(VISHAY.artifact, { part: 'SI2302CDS', maker: 'Vishay', productType: 'MOSFET', rowCount: 0, textOnly: true, params: [] })
}
