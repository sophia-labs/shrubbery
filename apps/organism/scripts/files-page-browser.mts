/**
 * A file's page in a real browser (Chromium), against the suites' CONTRACT-files v1 server seeded with real corpus PDFs, the real
 * `datasheet_facts` answers and the real editions of Vera's library (Vera, 2026-10-13: "the raw PDF should be a collapsed section on a
 * sophia-standard info display with the stuff we extracted, your notes on it, etc.").
 *
 *   the place holds the sheets, not the readers' texts beside them · a card says "Read · N values", and "· N disputed" only when it is
 *   opening a sheet opens its page: the part, key values, what we extracted; the PDF folded and not downloaded
 *   a page link unfolds the source, turns to the page and draws that one value's box (the overlay stays off)
 *   your notes are made at the first keystroke, saved, and there when you come back
 *   at 390 px the page fits its width
 *
 *   PDF_DIR=/path SHOTS_DIR=/path node --import tsx scripts/files-page-browser.mts      (exit 1 on any failed check)
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { startFilesContractServer } from '../src/cell/__tests__/support/files-contract-server.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtures = resolve(appDir, 'src/cell/__tests__/fixtures')
const port = Number(process.env.FILES_PAGE_PORT ?? 5253)
const pdfDir = process.env.PDF_DIR ?? '/path/to/private-evidence/2026-10-08-datasheets/corpus/datasheets'
const shots = process.env.SHOTS_DIR ?? resolve(appDir, '.files-page-shots')
mkdirSync(shots, { recursive: true })
let failed = 0
const check = (name: string, ok: boolean, detail?: unknown): void => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`) }
const json = (path: string) => JSON.parse(readFileSync(join(fixtures, path), 'utf8')) as Record<string, unknown>

const OPA = 'ds-ede0a2dfc224c765'
const TPS = 'ds-cf72dfd0ac69eec6'
const cell = await startFilesContractServer({ graphIncarnation: 'inc-page-1', anyFolder: true })
cell.folders.set('ds-datasheets', { id: 'ds-datasheets', name: 'Datasheets', parentId: null, section: 'artifacts', order: 1 })
async function upload(name: string, id: string, type: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const form = new FormData()
  form.set('file', new File([bytes], name, { type })); form.set('artifactId', id); form.set('parentId', 'ds-datasheets')
  const r = await fetch(`${cell.base}/artifacts/${cell.graphId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${cell.token}` }, body: form })
  if (!r.ok) throw new Error(`upload ${name}: ${r.status}`)
}
const pdf = (file: string) => new Uint8Array(readFileSync(join(pdfDir, file)))
await upload('ti-opa2134_DS.pdf', OPA, 'application/pdf', pdf('ti-opa2134-datasheet.pdf'))
await upload('ti-opa2134_DS.text.txt', `${OPA}-text`, 'text/plain', new TextEncoder().encode('=== PAGE 1 ===\nOPA134, OPA2134, OPA4134 High-Performance Audio Operational Amplifiers\n') as Uint8Array<ArrayBuffer>)
await upload('ti-tps54331_DS.pdf', TPS, 'application/pdf', pdf('ti-tps54331-datasheet.pdf'))
await upload('ti-tps54331_DS.text.txt', `${TPS}-text`, 'text/plain', new TextEncoder().encode('=== PAGE 1 ===\nTPS54331\n') as Uint8Array<ArrayBuffer>)
cell.datasheetFacts.set(OPA, json('datasheet-facts/ti-opa2134_DS.pdf.json'))
cell.datasheetFacts.set(TPS, json('datasheet-facts/ti-tps54331-datasheet.pdf.json'))
cell.pageRows.set('editions', json('datasheet-page/datasheet-library-editions.json').rows as Record<string, string>[])
cell.datasheets.set(OPA, { part: 'OPA134', maker: '', productType: 'unknown', rowCount: 82, fileName: 'ti-opa2134_DS.pdf', families: ['OPA2134', 'OPA134', 'OPA4134'],
  reader: { tool: 'datasheet-parser', commit: 'ee680a6', docling: '2.135.0' }, params: [{ pred: 'gainBandwidth', typ: 8, unit: 'MHz', conf: 'medium' },
    { pred: 'supplyVoltage', lo: 5, hi: 36, typ: 30, unit: 'V', conf: 'medium' }] })
cell.datasheets.set(TPS, { part: 'TPS54331', maker: 'Texas Instruments', productType: 'converter', rowCount: 44, fileName: 'ti-tps54331_DS.pdf', families: ['TPS54331'],
  params: [{ pred: 'vin', hi: 28, unit: 'V', conf: 'contested', diag: 'disagreement: "prose=?–28 vs roc=3.5–28"' }, { pred: 'iout', hi: 3, unit: 'A', conf: 'medium' },
    { pred: 'fsw', hi: 570, unit: 'kHz', conf: 'high' }] })

const server = await createServer({ root: appDir, configFile: resolve(appDir, 'vite.config.ts'), logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, proxy: { '/files-cell': { target: cell.base, changeOrigin: true, rewrite: p => p.replace(/^\/files-cell/, '') } } } })
await server.listen()
const browser = await chromium.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
const errors: string[] = []
const url = (extra = '') => `http://127.0.0.1:${port}/files-rudiments-browser-harness.html?cell=/files-cell&graph=${cell.graphId}${extra}#key=${cell.token}`
const downloads = (id: string) => cell.requests.filter(r => r.path.startsWith(`/artifacts/${cell.graphId}/${id}/download`)).length

async function openPlace(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__filesHarness?.state?.visible === true, undefined, { timeout: 30000 })
  await page.evaluate(() => (window as any).__openFiles())
  const folder = page.locator('mn-files-canvas .card[role="option"]', { hasText: 'Datasheets' }).first()
  await folder.waitFor({ timeout: 30000 })
  await folder.dblclick()
  await page.waitForFunction(() => document.querySelector('mn-files-canvas')?.shadowRoot?.querySelectorAll('.card[data-evidence]').length === 2, undefined, { timeout: 30000 })
}
const card = (page: Page, text: string) => page.locator('mn-files-canvas .card[role="option"]', { hasText: text }).first()
const sectionOpen = (page: Page, id: string) => page.locator(`.fpage [data-section="${id}"]`).evaluate(el => el.hasAttribute('data-open'))

try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(url())
  await openPlace(page)
  const cards = await page.evaluate(() => [...document.querySelector('mn-files-canvas')!.shadowRoot!.querySelectorAll('.card[role="option"]')].map(c => ({
    part: c.querySelector('.part')?.textContent ?? '', badge: c.querySelector('.annunciator')?.textContent ?? '', marks: c.querySelectorAll('.mark').length })))
  check('the place holds the two sheets, not their readers\' texts', cards.length === 2, cards)
  check('cards: the part from the file and the family; "Read · N values", and the dispute only where there is one', JSON.stringify(cards.map(c => [c.part, c.badge]).sort())
    === JSON.stringify([['OPA2134', 'Read · 84 values'], ['TPS54331', '1 disputed · 47 values']]), cards)
  check('cards: no mark on a value the readers agreed on; one on the disputed value', cards.find(c => c.part === 'OPA2134')?.marks === 0 && cards.find(c => c.part === 'TPS54331')?.marks === 1, cards)
  await page.screenshot({ path: resolve(shots, '01-place.png') })

  await card(page, 'OPA2134').dblclick()
  await page.waitForSelector('.fpage h1')
  await page.waitForFunction(() => document.querySelectorAll('.fpage .fp-spec [data-row]').length > 0, undefined, { timeout: 15000 })
  check('the page names the part and its family', await page.locator('.fpage h1').textContent() === 'OPA2134'
    && (await page.locator('.fpage .fp-chips li').allTextContents()).join(',') === 'OPA134,OPA2134,OPA4134')
  check('the maker and the document: from the file name, said so on hover', (await page.locator('.fpage .fp-lines span').allTextContents()).join(' | ') === 'Texas Instruments | Datasheet | 35 pages'
    && await page.locator('.fpage .fp-lines span').first().getAttribute('title') === 'Maker from the file name')
  check('sections in order; the PDF folded and not downloaded', JSON.stringify(await page.locator('.fpage .fp-sec').evaluateAll(els => els.map(e => e.getAttribute('data-section'))))
    === JSON.stringify(['key-values', 'notes', 'extracted', 'source', 'reading', 'about', 'connections']) && !(await sectionOpen(page, 'source'))
    && await page.locator('mn-pdf-reader').count() === 0 && downloads(OPA) === 0, { downloads: downloads(OPA) })
  const keyValues = await page.locator('.fpage .fp-values li').evaluateAll(els => els.map(e => (e.querySelector('.vl')?.textContent ?? '') + ' = ' + (e.querySelector('.vv')?.textContent ?? '').replace(/\s+/g, ' ').trim()))
  check('key values in plain words, each with its page', keyValues[0] === 'Gain bandwidthGBW = 8 MHz typ' && keyValues.length >= 3
    && await page.locator('.fpage .fp-values .fp-plink').count() === keyValues.length, keyValues)
  const thd = await page.locator('.fpage .fp-spec [data-row]', { hasText: 'Total harmonic distortion' }).first().locator('.ty').textContent()
  check('what we extracted: THD+N keeps its precision (0.00008, not 0)', thd === '0.00008', thd)
  check('what we extracted: no table heading reads as a value', await page.locator('.fpage .fp-spec [data-row]', { hasText: 'AUDIO PERFORMANCE' }).count() === 0
    && (await page.locator('.fpage .fp-spec .sub').allTextContents()).includes('Audio performance'))
  check('no symbol carried down onto the next parameter', (await page.locator('.fpage .fp-spec [data-row]', { hasText: 'Intermodulation distortion' }).first().locator('.sym').textContent()) === '')
  await page.screenshot({ path: resolve(shots, '02-page.png') })

  await page.locator('.fpage .fp-filter input').fill('noise density')
  await page.waitForTimeout(200)
  check('the filter keeps every word typed', await page.locator('.fpage .fp-spec [data-row]').count() === 2, await page.locator('.fpage .fp-spec [data-row]').count())
  await page.locator('.fpage .fp-filter input').fill('')

  // A page link: the source unfolds, turns to the page, draws that one box.
  await page.locator('.fpage .fp-values li').first().locator('.fp-plink').click()
  await page.waitForSelector('mn-pdf-reader .pr-abox', { timeout: 30000 })
  await page.waitForTimeout(1500)
  const boxes = await page.locator('mn-pdf-reader .pr-abox').evaluateAll(els => els.map(e => e.getAttribute('data-id')))
  check('a page link unfolds the source and draws only that value\'s box', boxes.length === 1 && boxes[0] === `${OPA}-key-gainBandwidth` && await sectionOpen(page, 'source'), boxes)
  check('the overlay stays off ("What we read" not pressed)', await page.locator('mn-pdf-reader').evaluate(el => !el.hasAttribute('overlay'))
    && await page.locator('mn-pdf-reader [data-action="overlay"]').getAttribute('aria-pressed') === 'false')
  const pageNo = await page.locator('mn-pdf-reader').evaluate(el => (el.querySelector('.pr-page input') as HTMLInputElement | null)?.value ?? (el as any).pageNo)
  check('the reader turned to the value\'s page (p. 7)', String(pageNo) === '7', pageNo)
  await page.screenshot({ path: resolve(shots, '03-page-link.png') })

  // Your notes.
  await page.locator('.fpage [data-section="notes"] .ProseMirror').click()
  await page.keyboard.type('Used it in the headphone amp; runs warm at ±18 V.')
  await page.waitForFunction(() => document.querySelector('.fpage [data-section="notes"] .fp-notes-status')?.textContent === 'Saved', undefined, { timeout: 10000 })
  const notes = cell.documents.get(`notes-${OPA}`)
  check('notes: made at the first keystroke, beside the file, wired to it', notes?.parentId === 'ds-datasheets' && notes.title === 'Notes on ti-opa2134_DS.pdf'
    && [...cell.wires.values()].some(w => w.sourceDocumentId === `notes-${OPA}` && w.targetDocumentId === OPA && w.predicate === 'annotates'), notes)
  check('notes: what was typed is what is stored', JSON.stringify(cell.documentBodies.get(`notes-${OPA}`)?.tiptapJson ?? '').includes('runs warm at ±18 V.'))
  await page.locator('.fpage [data-section="notes"]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(shots, '04-notes.png') })
  await page.locator('[data-action="back"]').click()
  await page.waitForTimeout(300)
  check('the notes are not a peer of the file in the place', (await page.evaluate(() => document.querySelector('mn-files-canvas')!.shadowRoot!.querySelectorAll('.card[role="option"]').length)) === 2)
  await card(page, 'OPA2134').dblclick()
  await page.waitForFunction(() => document.querySelector('.fpage [data-section="notes"] .ProseMirror')?.textContent?.includes('runs warm'), undefined, { timeout: 15000 })
  check('notes: there when you come back', true)

  // About this reading reaches the reader's text.
  await page.locator('.fpage [data-section="reading"] h2 button').click()
  await page.locator('.fpage [data-section="reading"] [data-action^="open:artifact:"]').click()
  await page.waitForFunction(() => document.querySelector('.fpage h1')?.textContent === 'ti-opa2134_DS.text.txt', undefined, { timeout: 15000 })
  await page.waitForSelector('.fpage [data-section="source"] hoja-reader', { timeout: 15000 })
  check('the reader\'s text opens as its own page, its contents open', await sectionOpen(page, 'source'))
  await page.locator('[data-action="back"]').click()
  await page.waitForFunction(() => document.querySelector('.fpage h1')?.textContent === 'OPA2134', undefined, { timeout: 15000 })
  check('Back returns to the sheet', true)
  await page.locator('[data-action="back"]').click()

  // A disputed key value, quietly.
  await card(page, 'TPS54331').dblclick()
  await page.waitForFunction(() => document.querySelector('.fpage h1')?.textContent === 'TPS54331', undefined, { timeout: 15000 })
  await page.waitForSelector('.fpage .fp-values li')
  const disputed = await page.locator('.fpage .fp-values [data-disputed]').evaluateAll(els => els.map(e => e.getAttribute('title')))
  check('a disputed value is marked "disputed", with why on hover; nothing else is marked', disputed.length === 1 && /^The readers disagree/.test(disputed[0] ?? ''), disputed)
  await page.screenshot({ path: resolve(shots, '05-disputed.png') })

  // A phone width (the harness shows the pane there for this witness; the shell hides Files on phones).
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage()
  phone.on('pageerror', e => errors.push(e.message))
  await phone.goto(url('&forcePane=1'))
  await openPlace(phone)
  await card(phone, 'OPA2134').dblclick()
  await phone.waitForFunction(() => document.querySelectorAll('.fpage .fp-spec [data-row]').length > 0, undefined, { timeout: 15000 })
  const fits = await phone.evaluate(() => {
    const p = document.querySelector('.fpage') as HTMLElement
    return { doc: document.documentElement.scrollWidth <= window.innerWidth + 1, page: p.scrollWidth <= p.clientWidth + 1, w: p.scrollWidth, c: p.clientWidth }
  })
  check('390 px: the page fits its width (no sideways scroll)', fits.doc && fits.page, fits)
  await phone.screenshot({ path: resolve(shots, '06-phone-top.png') })
  await phone.locator('.fpage').evaluate(el => { el.scrollTop = 900 })
  await phone.waitForTimeout(300)
  await phone.screenshot({ path: resolve(shots, '07-phone-table.png') })
} finally {
  check('no page errors', errors.length === 0, errors.slice(0, 5))
  await browser.close()
  await server.close()
  await cell.close()
}
console.log(failed ? `${failed} failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
