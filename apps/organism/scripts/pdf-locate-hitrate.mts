/**
 * How many of a datasheet's claims the viewer can box, from the PDF's own text (src/cell/pdf-reader/pdf-locate.ts), over real corpus
 * PDFs and the real `datasheet_facts` captured for them from production.
 *
 *   FACTS_DIR=/dir/with/by-<pdf name>.json PDF_DIR=/corpus/datasheets node --import tsx scripts/pdf-locate-hitrate.mts [--misses]
 *
 * Each `by-<name>.pdf.json` is a verbatim `datasheet_facts` tool result (the MCP envelope) whose edition's sha256 is that PDF's.
 * "Hit" is a claim given a box; "not located" is listed honestly. Values-bearing claims are those that state at least one number.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readDatasheetFacts } from '../src/cell/files-kinds/datasheet-reader.js'
import { linesOf, locateAll } from '../src/cell/pdf-reader/pdf-locate.js'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const factsDir = process.env.FACTS_DIR!
const pdfDir = process.env.PDF_DIR ?? '/path/to/private-evidence/2026-10-08-datasheets/corpus/datasheets'
const showMisses = process.argv.includes('--misses')
let totalClaims = 0, totalHit = 0, totalNum = 0, totalNumHit = 0
for (const file of readdirSync(factsDir).filter(f => f.startsWith('by-')).sort()) {
  const name = file.slice(3, -5)
  const envelope = JSON.parse(readFileSync(join(factsDir, file), 'utf8')) as { result: { content: { text: string }[] } }
  const raw = JSON.parse(envelope.result.content[0]!.text) as Record<string, unknown>
  const artifact = (raw.editions as { artifact: string }[])[0]!.artifact
  const reading = readDatasheetFacts(raw, artifact)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(pdfDir, name))), useWorkerFetch: false, disableFontFace: true, verbosity: 0 }).promise
  const cache = new Map<number, ReturnType<typeof linesOf>>()
  const lines = async (pageNo: number) => {
    if (!cache.has(pageNo)) {
      const content = await (await doc.getPage(pageNo)).getTextContent()
      cache.set(pageNo, linesOf(content.items.filter(i => 'str' in i) as never))
    }
    return cache.get(pageNo)!
  }
  const found = await locateAll(reading.rows.map(r => ({ id: r.id, label: r.label, symbol: r.symbol, numbers: r.numbers, page: r.page, alt: r.readingPages })), lines)
  let hit = 0, num = 0, numHit = 0
  const misses: string[] = []
  for (const r of reading.rows) {
    const at = found.get(r.id)
    if (at) hit++
    if (r.numbers.length) { num++; if (at) numHit++ }
    if (at && process.argv.includes('--hits')) console.log(`   hit p${at.page}${at.page !== r.page ? ` (claim says p${r.page})` : ''} ${r.label} [${r.symbol}] ${r.value}  =>  ${at.text.slice(0, 110)}`)
    if (!at) misses.push(`p${r.page} ${r.label} [${r.symbol}] ${r.value || '(no value)'}`)
  }
  const n = reading.rows.length
  totalClaims += n; totalHit += hit; totalNum += num; totalNumHit += numHit
  console.log(`${name.padEnd(46)} claims ${String(n).padStart(3)}  located ${String(hit).padStart(3)} (${n ? Math.round(100 * hit / n) : 0}%)  with numbers ${String(num).padStart(3)}  located ${String(numHit).padStart(3)} (${num ? Math.round(100 * numHit / num) : 0}%)`)
  if (showMisses) for (const m of misses) console.log('     miss', m)
}
console.log(`TOTAL claims ${totalClaims}  located ${totalHit} (${Math.round(100 * totalHit / totalClaims)}%)  claims with numbers ${totalNum}  located ${totalNumHit} (${Math.round(100 * totalNumHit / totalNum)}%)`)
