/**
 * Screenshots of file pages from a running harness (scripts/files-page-live.mts), for looking at real data: a folder, a file's page, its
 * table, a page link into the source. Reads only (the harness is opened read-only).
 *
 *   URL=<harness url, without the key> KEY_FILE=~/sophia/selfhost-key.json SHOTS_DIR=/path FILE=ti-opa2134_DS.pdf FOLDER=Datasheets \
 *     node --import tsx scripts/files-page-shots.mts
 *
 * The bearer is read from KEY_FILE (a JSON file with `key`) and handed to the page only in the URL fragment; it is never printed.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const url = (process.env.URL ?? '').split('#')[0]!
const key = process.env.KEY_FILE ? String((JSON.parse(readFileSync(process.env.KEY_FILE, 'utf8')) as { key?: string }).key ?? '') : ''
const shots = process.env.SHOTS_DIR ?? '.files-page-shots'
const file = process.env.FILE ?? 'ti-opa2134_DS.pdf'
const folder = process.env.FOLDER ?? 'Datasheets'
const width = Number(process.env.WIDTH ?? 1440)
const height = Number(process.env.HEIGHT ?? 900)
const tag = process.env.TAG ?? `${width}`
mkdirSync(shots, { recursive: true })
const browser = await chromium.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: Number(process.env.DPR ?? 1) })).newPage()
const errors: string[] = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(`${url}${width < 760 ? '&forcePane=1' : ''}${key ? `#key=${encodeURIComponent(key)}` : ''}`)
await page.waitForFunction(() => (window as any).__filesHarness?.state?.visible === true, undefined, { timeout: 30000 })
await page.evaluate(() => (window as any).__openFiles())
await page.waitForSelector('.mn-files-pane', { timeout: 30000 })
// Into the folder, as a list.
const crumbOrCard = page.locator('mn-files-canvas .card[role="option"]', { hasText: folder }).first()
await crumbOrCard.waitFor({ timeout: 30000 })
await crumbOrCard.dblclick()
await page.waitForTimeout(2500)
await page.screenshot({ path: `${shots}/folder-canvas-${tag}.png` })
const listButton = page.locator('.mn-files-pane [data-face="list"]')
if (await listButton.count()) { await listButton.click(); await page.waitForTimeout(1500); await page.screenshot({ path: `${shots}/folder-list-${tag}.png` }) }
const listRow = page.locator('.mn-files-pane .list [role=row][data-key]', { hasText: file }).first()
if (await listRow.count()) await listRow.dblclick()
else await page.locator('mn-files-canvas .card[role="option"]', { hasText: file }).first().dblclick()
await page.waitForSelector('.mn-files-pane .fpage', { timeout: 20000 })
await page.waitForTimeout(3000)
await page.screenshot({ path: `${shots}/page-top-${tag}.png` })
await page.screenshot({ path: `${shots}/page-full-${tag}.png`, fullPage: false })
const scroller = page.locator('.mn-files-pane .fpage')
const total = await scroller.evaluate(el => el.scrollHeight)
console.log('page scroll height', total)
await scroller.evaluate(el => { el.scrollTop = 700 })
await page.waitForTimeout(500)
await page.screenshot({ path: `${shots}/page-table-${tag}.png` })
// A page link: the source unfolds at that value.
const link = page.locator('.mn-files-pane .fp-values .fp-plink').first()
if (await link.count()) {
  await scroller.evaluate(el => { el.scrollTop = 0 })
  await link.click()
  await page.waitForTimeout(6000)
  await page.screenshot({ path: `${shots}/page-source-${tag}.png` })
}
const text = await page.locator('.mn-files-pane .fpage').innerText()
console.log(text.slice(0, 3000))
console.log('errors', errors.slice(0, 10))
await browser.close()
