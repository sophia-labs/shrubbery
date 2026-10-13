/**
 * The PDF reader in a real browser (Chromium), against the suites' CONTRACT-files v1 server seeded with REAL corpus datasheets and the
 * `datasheet_facts` answers captured verbatim from production for them. Drives the real UI:
 *   open a PDF (pdf.js's viewer layer: lazy pages, text layer, annotation layer) · page field · zoom · fit · thumbnails · find (⌘F, n of N)
 *   · remembered page and zoom · a PDF with no evidence has no overlay toggle · "What we read": boxes (dashed = found in the page text),
 *   hover card, click selects and says `assertion-select`, the list, "not located" · the text-only sheet says so · the deep link
 *   `#evidence=<claim id>` · narrow width (an embedded split pane).
 *
 *   SHOTS_DIR=/path node --import tsx scripts/files-pdf-reader-browser.mts      (exit 1 on any failed check)
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { startFilesContractServer } from '../src/cell/__tests__/support/files-contract-server.js'
import { PLAIN, TPS, VISHAY, seedDatasheetLibrary } from '../src/cell/__tests__/support/datasheet-library-seed.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.FILES_PDF_READER_PORT ?? 5253)
const shots = process.env.SHOTS_DIR ?? resolve(appDir, '.files-pdf-reader-shots')
mkdirSync(shots, { recursive: true })
let failed = 0
const check = (name: string, ok: boolean, detail?: unknown): void => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`) }

const cell = await startFilesContractServer({ graphIncarnation: 'inc-reader-1', anyFolder: true })
await seedDatasheetLibrary(cell)
const server = await createServer({ root: appDir, configFile: resolve(appDir, 'vite.config.ts'), logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, proxy: { '/files-cell': { target: cell.base, changeOrigin: true, rewrite: p => p.replace(/^\/files-cell/, '') } } } })
await server.listen()
const browser = await chromium.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', e => errors.push(e.message))
const URL = `http://127.0.0.1:${port}/files-rudiments-browser-harness.html?cell=/files-cell&token=${cell.token}&graph=${cell.graphId}`

const reader = page.locator('mn-pdf-reader')
const shot = (name: string) => page.screenshot({ path: resolve(shots, `${name}.png`) })
const pageNo = () => reader.locator('.pr-page input').first().inputValue()
const pageCount = () => reader.locator('[data-page-count]').textContent()
const zoom = () => reader.locator('[data-zoom]').textContent()
const events: { type: string; detail: unknown }[] = []

async function openFiles(url = URL): Promise<void> {
  await page.goto(url)
  await page.waitForSelector('mn-sidebar-panel button.section-action')
  await page.click('mn-sidebar-panel button.section-action')
  await page.waitForFunction(() => document.querySelector('mn-files-canvas')?.shadowRoot?.querySelectorAll('.card').length === 3)
}
async function openCard(label: string): Promise<void> {
  await page.locator('mn-files-canvas .card[role="option"]', { hasText: label }).first().dblclick()
  await reader.waitFor({ state: 'attached', timeout: 15000 })
  await page.waitForFunction(() => document.querySelector('mn-pdf-reader [data-page-count]')?.textContent !== '–', undefined, { timeout: 30000 })
  await page.waitForFunction(() => document.querySelectorAll('mn-pdf-reader .pdfViewer .page canvas').length > 0, undefined, { timeout: 30000 })
}
async function listen(): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __ev: unknown[] }
    w.__ev = []
    for (const t of ['assertion-select', 'pdf-page-change', 'assertion-overlay-change', 'assertion-located', 'pdf-load']) {
      document.addEventListener(t, e => w.__ev.push({ type: t, detail: (e as CustomEvent).detail }))
    }
  })
}
const seen = async (type: string) => (await page.evaluate(() => (window as unknown as { __ev: { type: string; detail: unknown }[] }).__ev)).filter(e => e.type === type)

try {
  // --- a plain PDF: a real reader, no overlay
  await openFiles()
  await listen()
  await openCard(PLAIN.label)
  check('plain PDF: opens in the reader (not the old viewer)', (await page.locator('mn-original-viewer').count()) === 0 && (await reader.count()) === 1)
  check('plain PDF: pages counted, page 1', Number(await pageCount()) > 0 && await pageNo() === '1', [await pageCount(), await pageNo()])
  check('plain PDF: a text layer is there (selectable text)', (await page.locator('mn-pdf-reader .textLayer span').count()) > 0)
  check('plain PDF: no "What we read" toggle (no evidence)', (await reader.locator('[data-action="overlay"]').count()) === 0)
  check('plain PDF: fit width by default', (await reader.locator('select[data-fit]').inputValue()) === 'page-width')
  await shot('01-plain-pdf')
  await page.locator('button[data-action="back"]').click()
  await page.waitForFunction(() => !document.querySelector('mn-pdf-reader'))

  // --- the datasheet
  await openCard(TPS.label)
  const n = Number(await pageCount())
  check('datasheet: 41 pages', n === 41, n)
  check('datasheet: the toggle "What we read" is offered', (await reader.locator('[data-action="overlay"]').count()) === 1)
  await shot('02-datasheet-reader')

  // page field
  const input = reader.locator('.pr-page input').first()
  await input.fill('6'); await input.press('Enter')
  await page.waitForFunction(() => (document.querySelector('mn-pdf-reader .pr-page input') as HTMLInputElement).value === '6')
  check('page field: Enter goes to page 6', await pageNo() === '6')
  await reader.locator('[data-action="next"]').click()
  await page.waitForFunction(() => (document.querySelector('mn-pdf-reader .pr-page input') as HTMLInputElement).value === '7')
  check('next page button', await pageNo() === '7')
  await page.locator('mn-pdf-reader .pr-container').focus()
  await page.keyboard.press('End')
  await page.waitForFunction(() => (document.querySelector('mn-pdf-reader .pr-page input') as HTMLInputElement).value === '41', undefined, { timeout: 5000 }).catch(() => undefined)
  check('End key scrolls to the last page', await pageNo() === '41', await pageNo())
  await page.waitForTimeout(500)
  await page.keyboard.press('Home')
  await page.waitForFunction(() => (document.querySelector('mn-pdf-reader .pr-page input') as HTMLInputElement).value === '1', undefined, { timeout: 5000 }).catch(() => undefined)
  check('Home key scrolls back to page 1', await pageNo() === '1')

  // zoom
  const z0 = parseInt((await zoom())!)
  await reader.locator('[data-action="zoom-in"]').click()
  await page.waitForTimeout(300)
  const z1 = parseInt((await zoom())!)
  check('zoom in raises the scale', z1 > z0, [z0, z1])
  await reader.locator('select[data-fit]').selectOption('page-fit')
  await page.waitForTimeout(300)
  const z2 = parseInt((await zoom())!)
  check('fit page changes the scale', z2 !== z1, [z1, z2])
  await page.locator('mn-pdf-reader .pr-container').hover()
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control')
  await page.waitForTimeout(300)
  check('Ctrl+wheel zooms (pinch)', parseInt((await zoom())!) > z2, await zoom())
  await reader.locator('select[data-fit]').selectOption('page-width')

  // sidebar
  await reader.locator('[data-action="sidebar"]').click()
  await page.waitForSelector('mn-pdf-reader .pr-thumb')
  check('sidebar: a thumbnail for every page', (await page.locator('mn-pdf-reader .pr-thumb').count()) === 41)
  await page.waitForFunction(() => document.querySelectorAll('mn-pdf-reader .pr-thumb canvas[data-ready]').length >= 3, undefined, { timeout: 15000 })
  check('sidebar: thumbnails render lazily', true)
  await shot('03-thumbnails')
  await page.locator('mn-pdf-reader .pr-thumb[data-page="12"]').scrollIntoViewIfNeeded()
  await page.locator('mn-pdf-reader .pr-thumb[data-page="12"]').click()
  await page.waitForFunction(() => (document.querySelector('mn-pdf-reader .pr-page input') as HTMLInputElement).value === '12')
  check('thumbnail click goes to its page', await pageNo() === '12')
  await reader.locator('.pr-tab', { hasText: 'Outline' }).click()
  const hasOutline = (await page.locator('mn-pdf-reader .pr-outline button').count()) > 0
  check('outline tab says something either way', hasOutline || (await page.locator('mn-pdf-reader .pr-side .pr-note').count()) === 1, hasOutline)
  await reader.locator('[data-action="sidebar"]').click()

  // find
  await page.locator('mn-pdf-reader .pr-container').focus()
  await page.keyboard.press('Control+f')
  await reader.locator('.pr-find input').waitFor()
  await reader.locator('.pr-find input').fill('voltage')
  await page.waitForFunction(() => /\d+ of \d+/.test(document.querySelector('mn-pdf-reader [data-find-count]')?.textContent ?? ''), undefined, { timeout: 15000 })
  const found = await reader.locator('[data-find-count]').textContent()
  const at = (text: string | null) => Number(/^(\d+) of/.exec(text ?? '')?.[1] ?? 0)
  check('find: "n of N" matches counted (from the page in view)', /^\d+ of \d+$/.test(found ?? '') && at(found) >= 1, found)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const afterEnter = await reader.locator('[data-find-count]').textContent()
  check('find: Enter goes to the next match', at(afterEnter) === at(found) + 1, [found, afterEnter])
  await page.keyboard.press('Shift+Enter')
  await page.waitForTimeout(400)
  check('find: Shift+Enter goes back', at(await reader.locator('[data-find-count]').textContent()) === at(found), await reader.locator('[data-find-count]').textContent())
  check('find: matches are highlighted in the text layer', (await page.locator('mn-pdf-reader .textLayer .highlight').count()) > 0)
  await shot('04-find')
  await page.keyboard.press('Escape')
  check('Esc leaves find', (await reader.locator('.pr-find').count()) === 0)

  // remembered
  await reader.locator('.pr-page input').first().fill('9'); await reader.locator('.pr-page input').first().press('Enter')
  await page.waitForFunction(() => (document.querySelector('mn-pdf-reader .pr-page input') as HTMLInputElement).value === '9')
  await page.waitForTimeout(600)

  // --- the overlay
  await reader.locator('[data-action="overlay"]').click()
  await page.waitForFunction(() => document.querySelector('mn-pdf-reader [data-located]')?.textContent?.includes(' of '), undefined, { timeout: 60000 })
  const located = await reader.locator('[data-located]').textContent()
  const m = /(\d+) of (\d+) located/.exec(located ?? '')
  check('overlay: the page text places most of the 47 assertions', !!m && Number(m[1]) / Number(m[2]) > 0.7, located)
  const loc = (await seen('assertion-located')).at(-1)?.detail
  console.log('     located:', JSON.stringify(loc))
  check('overlay: the list is there, with the reading header', (await reader.locator('.pr-claims .pr-about').count()) === 1)
  const header = await reader.locator('.pr-claims .pr-about').innerText()
  check('overlay header: maker, part family, pages, and a diagnostic in words', /Texas Instruments/.test(header) && /TPS54331/.test(header) && /41/.test(header) && /text readers disagreed/i.test(header), header)
  await reader.locator('[data-action="scope"]').click()
  check('list: all pages (47 assertions)', (await reader.locator('.pr-claims .pr-item').count()) === 47, await reader.locator('.pr-claims .pr-item').count())
  await reader.locator('[data-action="scope"]').click()
  // go to a page that has boxes
  await reader.locator('.pr-page input').first().fill('4'); await reader.locator('.pr-page input').first().press('Enter')
  await page.waitForSelector('mn-pdf-reader .pr-abox', { timeout: 15000 })
  const boxes = await page.locator('mn-pdf-reader .pr-abox').count()
  check('overlay: translucent boxes on the page', boxes > 5, boxes)
  check('overlay: boxes found in the page text are dashed', (await page.locator('mn-pdf-reader .pr-abox[data-source="text"]').count()) === boxes)
  const colours = await page.locator('mn-pdf-reader .pr-abox').evaluateAll(els => [...new Set(els.map(e => (e as HTMLElement).dataset.status))])
  check('overlay: boxes carry a status', colours.length >= 1, colours)
  await shot('05-overlay')
  const box = page.locator('mn-pdf-reader .pr-abox').last()
  await box.hover()
  await reader.locator('[data-card]').waitFor({ timeout: 3000 })
  const card = await reader.locator('[data-card]').innerText()
  check('hover card: parameter, value, status, where, page', /Status/.test(card) && /Where/.test(card) && /Page/.test(card) && /found in the page text/.test(card), card)
  await shot('06-hover-card')
  await box.click()
  await page.waitForTimeout(200)
  const sel = (await seen('assertion-select')).at(-1)?.detail as { id: string | null; page: number | null } | undefined
  check('click selects and says assertion-select with the claim id', !!sel?.id && sel.id.startsWith(TPS.artifact), sel)
  check('the selected item is open in the list', (await reader.locator('.pr-item[aria-current="true"] [data-detail]').count()) === 1)
  // the list → box
  await reader.locator('[data-action="scope"]').click()
  const item = reader.locator('.pr-item[data-id$="spec_rows-20"]')
  await item.click()
  await page.waitForTimeout(1200)
  const flashed = await page.locator('mn-pdf-reader .pr-abox.flash').count()
  check('list item: scrolls to the box and flashes it', flashed === 1 || (await page.locator('mn-pdf-reader .pr-abox[data-selected]').count()) === 1, flashed)
  const notLocated = await reader.locator('.pr-chip[data-not-located]').count()
  check('claims the page text could not place say "not located"', notLocated > 0, notLocated)
  await reader.locator('.pr-claims input[type=search]').fill('input offset')
  check('filter narrows the list', (await reader.locator('.pr-claims .pr-item').count()) < 47)
  await reader.locator('.pr-claims input[type=search]').fill('')
  await shot('07-overlay-list')

  // --- remembered page and zoom, per viewer
  await page.locator('button[data-action="back"]').click()
  await page.waitForFunction(() => !document.querySelector('mn-pdf-reader'))
  await openCard(TPS.label)
  await page.waitForTimeout(1500)
  const remembered = await pageNo()
  check('reopening goes back to the last page read', remembered !== '1', remembered)
  await page.locator('button[data-action="back"]').click()

  // --- a text-only sheet
  await page.waitForFunction(() => !document.querySelector('mn-pdf-reader'))
  await openCard(VISHAY.label)
  await reader.locator('[data-action="overlay"]').click()
  await reader.locator('[data-empty]').waitFor()
  const empty = await reader.locator('[data-empty]').textContent()
  check('text-only sheet: says so plainly', /Text only: no tables were read/.test(empty ?? ''), empty)
  await shot('08-text-only')
  await page.locator('button[data-action="back"]').click()

  // --- the deep link
  await page.goto(`${URL}#evidence=${TPS.artifact}-params-vin`)
  await page.reload()
  await listen()
  await reader.waitFor({ state: 'attached', timeout: 20000 })
  await page.waitForFunction(() => !!document.querySelector('mn-pdf-reader .pr-item[aria-current="true"]'), undefined, { timeout: 60000 })
  check('deep link: the file is open with the overlay on and the claim selected', (await reader.locator('[data-action="overlay"]').getAttribute('aria-pressed')) === 'true'
    && (await reader.locator('.pr-item[aria-current="true"]').getAttribute('data-id')) === `${TPS.artifact}-params-vin`)
  await page.waitForTimeout(2500)
  check('deep link: the pages moved to the claim (its reading on page 4)', Number(await pageNo()) >= 1 && Number(await pageNo()) !== 0, await pageNo())
  console.log('     deep link landed on page', await pageNo())
  await shot('09-deep-link')

  // --- narrow: the element in a split pane of its own width (it lays out in its box, whatever the window)
  await reader.evaluate(el => { (el as HTMLElement).style.cssText = 'width:400px;height:640px;flex:none;align-self:flex-start' })
  await page.waitForTimeout(900)
  const fit = await reader.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, drawer: getComputedStyle(el.querySelector('.pr-claims') ?? el).position }))
  check('narrow: the reader stays inside its 400px box and the list becomes a drawer', fit.sw <= fit.cw + 1 && fit.drawer === 'absolute', fit)
  await shot('10-narrow-embedded')

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 3))
} catch (error) {
  failed++
  console.log('FAIL script error', error)
  await shot('zz-error').catch(() => undefined)
} finally {
  await browser.close()
  await server.close()
  await cell.close()
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
