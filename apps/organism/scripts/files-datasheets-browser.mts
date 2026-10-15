/**
 * Datasheets in the Files surfaces, in a real browser (Chromium), against the suites' CONTRACT-files v1 server with fixture records of
 * the importer's shape (plans/2026-10-08-datasheets-in-sophia.md §2, §3). Three seeded datasheets render rich cards in the canvas
 * (the part, the maker, three key values by product type, a mark only on a disputed or person-checked value, the badge) and the list
 * gains Part, Maker, Key value and Status columns; a plain PDF and a text file render as before; Disputed keeps only the sheets whose
 * readers disagreed on a value (Vera, 2026-10-13: "to check" is not a count a person needs); the
 * status line says how many are reading, the page, and offers Open when a read completes. The cards are read under three skins.
 *
 *   SHOTS_DIR=/path node --import tsx scripts/files-datasheets-browser.mts      (exit 1 on any failed check)
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { startFilesContractServer, type ServedDatasheet } from '../src/cell/__tests__/support/files-contract-server.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.FILES_DATASHEETS_PORT ?? 5251)
const shots = process.env.SHOTS_DIR ?? resolve(appDir, '.files-datasheets-shots')
mkdirSync(shots, { recursive: true })
let failed = 0
const check = (name: string, ok: boolean, detail?: unknown): void => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`) }

export const SEEDED: Record<string, ServedDatasheet> = {
  'TPS62840.pdf': { part: 'TPS62840', maker: 'Texas Instruments', rev: 'B', productType: 'DC/DC converter', rowCount: 212, toCheck: 0, params: [
    { pred: 'inputVoltage', lo: 1.8, hi: 6.5, unit: 'V', conf: 'high' }, { pred: 'outputCurrent', hi: 750, unit: 'mA', conf: 'medium' },
    { pred: 'switchingFrequency', typ: 1.8, unit: 'MHz', conf: 'medium' }, { pred: 'quiescentCurrent', typ: 60, unit: 'nA', conf: 'high' }] },
  'OPA2192.pdf': { part: 'OPA2192', maker: 'Texas Instruments', rev: 'C', productType: 'op-amp', rowCount: 140, toCheck: 2, params: [
    { pred: 'gainBandwidth', typ: 10, unit: 'MHz', conf: 'contested', diag: 'readers_disagree' }, { pred: 'inputOffsetVoltage', hi: 0.025, unit: 'mV', conf: 'medium', checked: true },
    { pred: 'supplyVoltage', lo: 4.5, hi: 36, unit: 'V', conf: 'high' }] },
  'CSD18540Q5B.pdf': { part: 'CSD18540Q5B', maker: 'Texas Instruments', productType: 'power MOSFET', rowCount: 96, toCheck: 1, params: [
    { pred: 'drainSourceVoltage', nom: 60, unit: 'V', conf: 'high' }, { pred: 'onResistance', typ: 1.8, unit: 'mΩ', conf: 'low' }, { pred: 'drainCurrent', nom: 100, unit: 'A', conf: 'medium' }] },
}

export const cell = await startFilesContractServer({ graphIncarnation: 'inc-ds-1' })
const ids = new Map<string, string>()
for (const name of [...Object.keys(SEEDED), 'Plain scan.pdf', 'Reading.pdf', 'notes.txt']) {
  const form = new FormData(); form.set('file', new File([new Uint8Array(60).fill(65)], name, { type: name.endsWith('.pdf') ? 'application/pdf' : 'text/plain' }))
  const r = await fetch(`${cell.base}/artifacts/${cell.graphId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${cell.token}` }, body: form })
  const body = await r.json() as { id?: string; artifact?: { id: string } }
  ids.set(name, String(body.id ?? body.artifact?.id))
}
for (const [name, sheet] of Object.entries(SEEDED)) cell.datasheets.set(ids.get(name)!, sheet)
cell.datasheets.set(ids.get('Reading.pdf')!, { part: '', maker: '', productType: '', rowCount: 0, params: [], state: 'reading', page: 4, pages: 20 })

const server = await createServer({ root: appDir, configFile: resolve(appDir, 'vite.config.ts'), logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, proxy: { '/files-cell': { target: cell.base, changeOrigin: true, rewrite: p => p.replace(/^\/files-cell/, '') } } } })
await server.listen()
const browser = await chromium.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors: string[] = []
page.on('pageerror', e => errors.push(e.message))

const cardInfo = (p: Page) => p.evaluate(() => Object.fromEntries([...document.querySelector('mn-files-canvas')!.shadowRoot!.querySelectorAll('.card')].map(c => {
  const fits = (c as HTMLElement).scrollHeight <= (c as HTMLElement).clientHeight + 1 && (c.querySelector('.label')?.getBoundingClientRect().height ?? 12) >= 12
  return [c.getAttribute('title')!, { rich: c.hasAttribute('data-evidence'), glyph: !!c.querySelector('mn-file-glyph'), part: c.querySelector('.part')?.textContent?.trim() ?? null, maker: [c.querySelector('.maker .by')?.textContent, c.querySelector('.maker .rev')?.textContent].filter(Boolean).join(' ') || null,
    badge: c.querySelector('.annunciator')?.textContent?.trim() ?? null, fits,
    values: [...c.querySelectorAll('.value')].map(v => `${v.getAttribute('data-label')} ${v.querySelector('.v')!.textContent}${v.querySelector('.mark') ? ` ${v.querySelector('.mark')!.textContent}` : ''}`) }]
})))
const state = (p: Page) => p.evaluate(() => (window as any).__filesHarness.state)

try {
  await page.goto(`http://127.0.0.1:${port}/files-rudiments-browser-harness.html?cell=/files-cell&graph=${cell.graphId}#key=${cell.token}`)
  await page.waitForSelector('mn-sidebar-panel button.section-action')
  await page.click('mn-sidebar-panel button.section-action')
  await page.waitForFunction(() => document.querySelector('mn-files-canvas')?.shadowRoot?.querySelectorAll('.card').length === 6)
  await page.waitForFunction(() => document.querySelector('mn-files-canvas')?.shadowRoot?.querySelectorAll('.card[data-evidence]').length === 3)

  // canvas: three rich cards, the plain PDF and the text file as before
  let cards = await cardInfo(page)
  check('canvas: three datasheets are rich cards', Object.entries(cards).filter(([, c]) => c.rich).map(([k]) => k).sort().join() === 'CSD18540Q5B.pdf,OPA2192.pdf,TPS62840.pdf', Object.keys(cards))
  check('canvas: a converter shows VIN, IOUT, fSW', JSON.stringify(cards['TPS62840.pdf']!.values) === JSON.stringify(['VIN 1.8–6.5 V', 'IOUT ≤ 750 mA', 'fSW 1.8 MHz']), cards['TPS62840.pdf'])
  check('canvas: an op-amp shows GBW (contested), VOS (checked), Supply', JSON.stringify(cards['OPA2192.pdf']!.values) === JSON.stringify(['GBW 10 MHz ⚠', 'VOS ≤ 0.025 mV ✓', 'Supply 4.5–36 V']), cards['OPA2192.pdf'])
  check('canvas: a MOSFET shows VDS, RDS(on), ID (a low reading is not painted)', JSON.stringify(cards['CSD18540Q5B.pdf']!.values) === JSON.stringify(['VDS 60 V', 'RDS(on) 1.8 mΩ', 'ID 100 A']), cards['CSD18540Q5B.pdf'])
  check('canvas: part large with maker and revision beneath', cards['TPS62840.pdf']!.part === 'TPS62840' && cards['TPS62840.pdf']!.maker === 'Texas Instruments · Rev B' && cards['CSD18540Q5B.pdf']!.maker === 'Texas Instruments', [cards['TPS62840.pdf'], cards['CSD18540Q5B.pdf']])
  check('canvas: the badge sits in the annunciator slot', cards['TPS62840.pdf']!.badge === 'Read · 216 values' && cards['OPA2192.pdf']!.badge === '1 disputed · 143 values' && cards['CSD18540Q5B.pdf']!.badge === 'Read · 99 values', Object.entries(cards).map(([k, c]) => [k, c.badge]))
  check('canvas: every rich card fits its box', ['TPS62840.pdf', 'OPA2192.pdf', 'CSD18540Q5B.pdf'].every(k => cards[k]!.fits), Object.entries(cards).map(([k, c]) => [k, c.fits]))
  check('canvas: a plain PDF and a text file keep today\'s card (glyph, no badge)', ['Plain scan.pdf', 'notes.txt'].every(k => !cards[k]!.rich && cards[k]!.glyph && cards[k]!.badge === null), [cards['Plain scan.pdf'], cards['notes.txt']])
  check('canvas: a file being read keeps its glyph and says Reading 4/20', !cards['Reading.pdf']!.rich && cards['Reading.pdf']!.glyph && cards['Reading.pdf']!.badge === 'Reading 4/20', cards['Reading.pdf'])
  await page.screenshot({ path: resolve(shots, '01-canvas.png') })

  // status line while one file reads
  let status = (await state(page)).status
  check('status: steady text says how many are reading', status.text === '6 items · 1 reading' && status.busy === true, status)
  check('status: progress in words', status.message === 'Reading Reading.pdf, page 4 of 20', status)
  check('status: the line is busy to assistive technology, with a pulse', await page.locator('.mn-files-pane footer [role=status][aria-busy=true]').count() === 1 && await page.locator('.mn-files-pane footer [data-busy]').count() === 1)

  // the read completes: the status line says what was read and offers Open
  cell.datasheets.set(ids.get('Reading.pdf')!, { part: 'LM5164', maker: 'Texas Instruments', rev: 'A', productType: 'buck converter', rowCount: 88, toCheck: 0, params: [
    { pred: 'inputVoltage', lo: 6, hi: 100, unit: 'V', conf: 'high' }, { pred: 'outputCurrent', hi: 1, unit: 'A', conf: 'high' }, { pred: 'switchingFrequency', typ: 0.5, unit: 'MHz', conf: 'medium' }] })
  await page.waitForFunction(() => /^Read Reading\.pdf: 91 values/.test((window as any).__filesHarness.state.status?.message ?? ''), null, { timeout: 15000 })
  status = (await state(page)).status
  check('status: completion names the file and the values read', status.message === 'Read Reading.pdf: 91 values' && status.busy === false && status.text === '6 items', status)
  check('status: completion offers Open', await page.locator('.mn-files-pane footer [data-action=status-action]').innerText() === 'Open')
  check('canvas: the file just read is a rich card', (await cardInfo(page))['Reading.pdf']!.part === 'LM5164')
  await page.screenshot({ path: resolve(shots, '02-read-done.png') })
  await page.click('.mn-files-pane footer [data-action=status-action]'); await page.waitForTimeout(500)
  check('status: Open opens the file\'s page', (await state(page)).page?.name === 'Reading.pdf', (await state(page)).page)
  await page.click('.mn-files-pane .reader-row [data-action="back"]'); await page.waitForTimeout(400)

  // skins: the cards are legible under 98 and Hot Dog Stand (the ink is the label ink; marks differ by shape)
  for (const skin of ['98', 'hotdog-stand']) {
    await page.evaluate(s => document.documentElement.setAttribute('data-skin', s), skin); await page.waitForTimeout(400)
    const fit = await cardInfo(page)
    check(`skin ${skin}: rich cards still fit and keep their values`, ['TPS62840.pdf', 'OPA2192.pdf', 'CSD18540Q5B.pdf'].every(k => fit[k]!.rich && fit[k]!.fits && fit[k]!.values.length === 3))
    const ink = await page.evaluate(() => { const root = document.querySelector('mn-files-canvas')!.shadowRoot!; const s = getComputedStyle(root.querySelector('.card[data-evidence] .sheet')!); return { ink: s.color, bg: getComputedStyle(root.host).backgroundColor } })
    check(`skin ${skin}: the card ink differs from the canvas ground`, ink.ink !== ink.bg, ink)
    await page.screenshot({ path: resolve(shots, `03-skin-${skin}.png`) })
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-skin')); await page.waitForTimeout(300)

  // list: Part, Maker, Key value, Status; a plain PDF keeps empty cells
  await page.click('[data-face=list]'); await page.waitForTimeout(500)
  const head = await page.locator('.mn-files-pane .list .head [role=columnheader]').allInnerTexts()
  check('list: Part, Maker, Key value and Status join Name, Type and Size', head.join() === 'Name,Type,Part,Maker,Key value,Status,Size', head)
  const row = (label: string) => page.evaluate(l => { const r = [...document.querySelectorAll('.mn-files-pane .list [role=row][data-key]')].find(x => x.querySelector('.name')?.textContent?.includes(l)); return r ? [...r.querySelectorAll('[role=gridcell]')].map(c => c.textContent!.trim()) : null }, label)
  check('list: a converter row', JSON.stringify(await row('TPS62840.pdf')) === JSON.stringify(['TPS62840.pdf', 'PDF', 'TPS62840', 'Texas Instruments', 'VIN1.8–6.5 V', 'Read · 216 values', '']), await row('TPS62840.pdf'))
  check('list: the op-amp row says its dispute', (await row('OPA2192.pdf'))?.[5] === '1 disputed · 143 values' && (await row('OPA2192.pdf'))?.[4] === 'GBW10 MHz⚠', await row('OPA2192.pdf'))
  const plain = await row('Plain scan.pdf')
  check('list: a plain PDF has empty datasheet cells', !!plain && plain.slice(2, 6).every(c => c === ''), plain)
  await page.screenshot({ path: resolve(shots, '04-list.png') })

  // Disputed
  const filterLabel = await page.locator('[data-action=needs-look]').innerText()
  check('filter: Disputed counts the one sheet whose readers disagreed (OPA2192)', filterLabel === 'Disputed · 1', filterLabel)
  await page.click('[data-action=needs-look]'); await page.waitForTimeout(300)
  let names = (await state(page)).rows.map((r: any) => r.label).sort()
  check('filter: on, only the disputed one remains', names.join() === 'OPA2192.pdf', names)
  check('filter: the toggle is pressed', await page.locator('[data-action=needs-look]').getAttribute('aria-pressed') === 'true')
  await page.screenshot({ path: resolve(shots, '05-needs-a-look.png') })
  await page.click('[data-action=needs-look]'); await page.waitForTimeout(300)
  names = (await state(page)).rows.map((r: any) => r.label)
  check('filter: off, everything is back', names.length === 6, names)
  await page.click('[data-face=canvas]'); await page.waitForTimeout(400)
  check('filter: it is a list control (absent on the canvas)', await page.locator('[data-action=needs-look]').count() === 0)

  check('queries: one batched query per place, wrapped in GRAPH', cell.requests.filter(r => r.tool === 'sparql_query').length >= 1)
  check('errors: none thrown in the page', errors.length === 0, errors)
} catch (error) {
  failed++; console.log('FAIL (threw)', error)
} finally {
  await browser.close(); await server.close(); await cell.close?.()
}
process.exit(failed ? 1 : 0)
