/**
 * The Files reader's viewers witnessed in a real browser (Chromium) at 1440x900, against the suites' CONTRACT-files v1
 * server: one file of each kind opens on its page in the right viewer, rendered by Hoja where Hoja renders it; nothing is
 * downloaded until Download is pressed; nothing from a file runs or fetches (an HTML script, an SVG script, a remote
 * image); the 200,000-row CSV scrolls in a grid whose DOM stays bounded, sorts, moves a cell cursor and copies.
 *
 *   node --import tsx scripts/files-quicklook-browser.mts      (exit 1 on any failed check; SHOTS_DIR for screenshots)
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { startFilesContractServer } from '../src/cell/__tests__/support/files-contract-server.js'
import { quicklookFixtures } from './files-quicklook-fixtures.mjs'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.FILES_QUICKLOOK_PORT ?? 5249)
const shots = process.env.SHOTS_DIR ?? resolve(appDir, '.files-quicklook-shots')
mkdirSync(shots, { recursive: true })
const remote = `http://127.0.0.1:${port}/__remote`

const results: { name: string; ok: boolean }[] = []
function check(name: string, ok: boolean, detail?: unknown): void {
  results.push({ name, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`)
}

const cell = await startFilesContractServer({ graphIncarnation: 'inc-quicklook-1' })
for (const f of quicklookFixtures(remote)) {
  const form = new FormData(); form.set('file', new File([new Uint8Array(f.bytes)], f.name, { type: f.type }))
  const r = await fetch(`${cell.base}/artifacts/${cell.graphId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${cell.token}` }, body: form })
  if (!r.ok) throw new Error(`seed ${f.name}: ${r.status} ${await r.text()}`)
}
const server = await createServer({ root: appDir, configFile: resolve(appDir, 'vite.config.ts'), logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, proxy: { '/files-cell': { target: cell.base, changeOrigin: true, rewrite: p => p.replace(/^\/files-cell/, '') } } } })
await server.listen()
const browser = await chromium.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
await context.addInitScript('window.__name = (f) => f')
const page = await context.newPage()
const errors: string[] = []
const remoteHits: string[] = []
const downloads: string[] = []
page.on('pageerror', e => errors.push(e.stack ?? e.message))
page.on('request', r => { if (r.url().startsWith(remote)) remoteHits.push(r.url()) })
page.on('download', d => downloads.push(d.suggestedFilename()))

interface Preview { kind: string; status: string; name: string; error: string; label: string | null; variant: string | null; source: boolean | null }
interface Harness { discovery?: string; open?: boolean; face?: string | null; preview?: Preview | null }
const state = (p: Page) => p.evaluate(() => (window as unknown as { __filesHarness?: { state: Harness } }).__filesHarness?.state ?? {}) as Promise<Harness>
async function until(p: Page, what: string, ok: (s: Harness) => boolean, timeout = 20000): Promise<Harness> {
  const t = Date.now(); let last: Harness = {}
  while (Date.now() - t < timeout) { last = await state(p); if (ok(last)) return last; await p.waitForTimeout(50) }
  throw new Error(`timed out: ${what}; ${JSON.stringify(last)}`)
}
const row = (label: string) => page.locator('.mn-files-pane .list [role="row"][data-key]', { hasText: label })
async function open(label: string): Promise<Preview> {
  await row(label).first().dblclick()
  const s = await until(page, `${label} ready`, h => h.preview?.name === label && h.preview.status !== 'loading')
  return s.preview!
}
async function back(): Promise<void> {
  await page.locator('.mn-files-pane button[data-action="back"]').click()
  await until(page, 'back', s => s.preview === null)
}
const reader = () => page.locator('.mn-files-pane hoja-reader')
const ran = () => page.evaluate(() => ({ ran: (window as unknown as { __quicklookRan?: boolean }).__quicklookRan ?? null, body: document.body.dataset.ran ?? null }))
const shot = (name: string) => page.screenshot({ path: resolve(shots, `${name}.png`) })

try {
  await page.goto(`http://127.0.0.1:${port}/files-rudiments-browser-harness.html?cell=/files-cell&token=${cell.token}&graph=${cell.graphId}&engine=house`)
  await until(page, 'discovery', s => s.discovery === 'ready')
  await page.evaluate(() => (window as unknown as { __openFiles: () => void }).__openFiles())
  await until(page, 'pane open', s => s.open === true)
  await page.locator('.mn-files-pane .seg button[data-face="list"]').click()
  await until(page, 'list face', s => s.face === 'list')

  // ── Markdown ─────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const p = await open('Reading list.md')
    await reader().locator('.ProseMirror h1').waitFor()
    const m = await reader().evaluate(el => ({
      h1: el.querySelector('h1')?.textContent, rows: el.querySelectorAll('table tr').length, items: el.querySelectorAll('ul > li').length,
      quote: !!el.querySelector('blockquote'), code: el.querySelectorAll('pre .hljs-keyword, pre .hljs-type, pre .hljs-number').length,
      link: [...el.querySelectorAll('a')].map(a => [a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')]),
      remoteImg: [...el.querySelectorAll('img:not(.ProseMirror-separator)')].filter(i => (i.getAttribute('src') ?? '').includes('__remote')).length,
      placeholder: el.querySelector('.hoja-reader-image-load')?.textContent ?? '', editable: el.querySelector('.ProseMirror')?.getAttribute('contenteditable'),
      width: Math.round(el.querySelector('.ProseMirror')!.getBoundingClientRect().width) }))
    check('markdown: the Markdown viewer (Hoja, prose)', p.kind === 'reader' && p.label === 'Markdown' && p.variant === 'prose', p)
    check('markdown: heading, a 4-row table, a list, a quote, a coloured code block', m.h1 === 'Reading list' && m.rows === 4 && m.items === 2 && m.quote && m.code > 0, m)
    check('markdown: the link opens in a new tab with rel=noopener', m.link.length === 1 && m.link[0]![0] === 'https://www.gutenberg.org' && m.link[0]![1] === '_blank' && /noopener/.test(m.link[0]![2] ?? ''), m.link)
    check('markdown: the remote image is a placeholder, not fetched', m.remoteImg === 0 && /127\.0\.0\.1/.test(m.placeholder) && remoteHits.length === 0, { m, remoteHits })
    check('markdown: read-only', m.editable === 'false', m.editable)
    check('markdown: the page is at least 600px wide at 1440', m.width >= 600, m.width)
    await shot('01-markdown')
    await back()
  }

  // ── Code ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const p = await open('shelf.ts')
    await reader().locator('pre .hljs-keyword').first().waitFor()
    const m = await reader().evaluate(el => ({ keywords: el.querySelectorAll('.hljs-keyword').length, lines: el.querySelector('.hoja-line-numbers')?.textContent?.split('\n').length,
      text: el.querySelector('pre code')?.textContent ?? '' }))
    check('code: TypeScript (stored as video/mp2t) in the code viewer', p.kind === 'reader' && p.label === 'TypeScript' && p.variant === 'code', p)
    check('code: syntax colour and line numbers', m.keywords > 3 && m.lines === 10, m)
    check('code: the label is in the reader row', (await page.locator('.mn-files-pane [data-kind-label]').textContent()) === 'TypeScript')
    await shot('02-code')
    await back()
  }

  // ── JSON ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const p = await open('library.json')
    await reader().locator('pre .hljs-attr').first().waitFor()
    const text = await reader().locator('pre code').evaluate(el => el.textContent ?? '')
    check('json: pretty-printed and coloured', p.label === 'JSON' && text.includes('"library": "Babel"') && text.includes('\n  "shelves": ['), text.slice(0, 80))
    await back()
  }

  // ── CSV (quoted) ─────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const p = await open('people.csv')
    await reader().locator('.hoja-data-table .dt-row').first().waitFor()
    const m = await reader().evaluate(el => ({
      head: [...el.querySelectorAll('.dt-head .dt-label')].map(c => c.textContent),
      first: [...el.querySelectorAll('.dt-row[data-index="0"] .dt-cell[data-col]')].map(c => c.textContent),
      numeric: el.querySelector('.dt-head .dt-cell[data-col="3"]')?.classList.contains('num'),
      foot: el.querySelector('.dt-foot')?.textContent }))
    check('csv: a data table (Hoja dataTable node)', p.kind === 'reader' && p.label === 'CSV' && p.variant === 'table', p)
    check('csv: the header row and a quoted field with a comma', JSON.stringify(m.head) === '["name","city","note","amount"]' && m.first[0] === 'Borges, Jorge Luis', m)
    check('csv: a quoted field with doubled quotes and a line break parses right', m.first[2] === 'wrote "Ficciones"\nand more', m.first)
    check('csv: the number column is right-aligned; the footer counts rows', m.numeric === true && /3 rows · 4 columns/.test(m.foot ?? ''), m)
    await back()
  }

  // ── CSV (200,000 rows) ───────────────────────────────────────────────────────────────────────────────────────────
  {
    const t0 = Date.now()
    const p = await open('big.csv')
    const viewport = reader().locator('.dt-viewport')
    await reader().locator('.dt-row').first().waitFor()
    const openMs = Date.now() - t0
    const rowsInDom = () => reader().evaluate(el => el.querySelectorAll('.dt-row').length)
    const foot = await reader().locator('.dt-counts').textContent()
    check(`big csv: opens as a table (${openMs} ms) and counts 200,000 rows`, p.variant === 'table' && /200,000 rows · 5 columns/.test(foot ?? ''), foot)
    const before = await rowsInDom()
    check(`big csv: the DOM holds only the rows in sight (${before})`, before > 10 && before < 120, before)
    // Scroll through: a few wheel steps, then to the end.
    const box = (await viewport.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const frames: number[] = []
    for (let i = 0; i < 20; i++) { const s = Date.now(); await page.mouse.wheel(0, 2400); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(null)))); frames.push(Date.now() - s) }
    await viewport.evaluate(el => { el.scrollTop = el.scrollHeight })
    await page.waitForTimeout(250)
    const end = await reader().evaluate(el => ({ rows: el.querySelectorAll('.dt-row').length,
      last: [...el.querySelectorAll('.dt-row')].map(r => r.querySelector('.dt-gutter')?.textContent).includes('200,000'),
      lastId: [...el.querySelectorAll('.dt-row')].map(r => r.querySelector('.dt-cell[data-col="0"]')?.textContent).includes('200000') }))
    check(`big csv: scrolls to the last row, DOM still bounded (${end.rows}; wheel steps ${Math.max(...frames)} ms worst)`, end.last && end.lastId && end.rows < 120, end)
    await shot('03-big-csv-end')
    // Sort by id, descending (two clicks): the first row is the last id.
    await viewport.evaluate(el => { el.scrollTop = 0 })
    const idHeader = reader().locator('.dt-head .dt-cell[data-col="0"]')
    const s0 = Date.now()
    await idHeader.click(); await idHeader.click()
    await page.waitForTimeout(100)
    const sorted = await reader().evaluate(el => ({ first: el.querySelector('.dt-row[data-index="0"] .dt-cell[data-col="0"]')?.textContent,
      sort: el.querySelector('.dt-head .dt-cell[data-col="0"]')?.getAttribute('aria-sort') }))
    check(`big csv: click-to-sort, numbers descending (${Date.now() - s0} ms)`, sorted.first === '200000' && sorted.sort === 'descending', sorted)
    // Text sort on city, ascending.
    await reader().locator('.dt-head .dt-cell[data-col="2"]').click()
    const city = await reader().evaluate(el => el.querySelector('.dt-row[data-index="0"] .dt-cell[data-col="2"]')?.textContent)
    check('big csv: text sort ascending', city === 'Buenos Aires', city)
    // Keyboard: a cell, arrows, End, PgDn, Ctrl+End; copy the cursor's cell.
    await reader().locator('.dt-row[data-index="0"] .dt-cell[data-col="1"]').click()
    const where = () => reader().locator('.dt-where').textContent()
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight')
    const w1 = await where()
    await page.keyboard.press('End')
    const w2 = await where()
    await page.keyboard.press('PageDown')
    const w3 = await where()
    await page.keyboard.press('Control+End')
    const w4 = await where()
    check('big csv: arrow keys move a cell cursor; End, PgDn, Ctrl+End', w1 === 'C2' && w2 === 'E2' && /^E\d+$/.test(w3 ?? '') && Number(w3!.slice(1)) > 10 && w4 === 'E200,000', [w1, w2, w3, w4])
    await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Shift+ArrowUp')
    await page.keyboard.press('Control+c')
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    check('big csv: Shift extends a selection; Ctrl+C copies it as TSV', clip.split('\n').length === 2 && clip.split('\n').every(l => l.split('\t').length === 2), clip)
    // Drag-resize the first column.
    const grip = reader().locator('.dt-head .dt-cell[data-col="1"] .dt-resize')
    const g = (await grip.boundingBox())!
    const w0 = await reader().locator('.dt-head .dt-cell[data-col="1"]').evaluate(e => e.getBoundingClientRect().width)
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down(); await page.mouse.move(g.x + 80, g.y + g.height / 2, { steps: 5 }); await page.mouse.up()
    const wNow = await reader().locator('.dt-head .dt-cell[data-col="1"]').evaluate(e => e.getBoundingClientRect().width)
    check('big csv: a column resizes by dragging its edge', wNow > w0 + 60, { w0, wNow })
    await shot('04-big-csv-sorted')
    await back()
  }

  // ── HTML (a script that must not run) ────────────────────────────────────────────────────────────────────────────
  {
    const p = await open('Field notes.html')
    await reader().locator('.ProseMirror h1').waitFor()
    await page.waitForTimeout(300)
    const m = await reader().evaluate(el => ({ h1: el.querySelector('h1')?.textContent, scripts: el.querySelectorAll('script, iframe, style, object').length,
      links: [...el.querySelectorAll('a')].map(a => [a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')]),
      handlers: [...el.querySelectorAll('*')].filter(e => [...e.attributes].some(a => a.name.startsWith('on'))).length,
      table: el.querySelectorAll('td').length, items: el.querySelectorAll('li').length, img: [...el.querySelectorAll('img:not(.ProseMirror-separator)')].map(i => i.getAttribute('src')),
      placeholder: el.querySelectorAll('.hoja-reader-image-load').length }))
    check('html: Hoja renders it through the schema (prose), with a Source switch', p.label === 'HTML' && p.variant === 'prose' && p.source === false, p)
    check('html: heading, list, table kept', m.h1 === 'Field notes' && m.items === 2 && m.table === 2, m)
    check('html: no script, iframe, style or event handler survives', m.scripts === 0 && m.handlers === 0, m)
    check('html: only the safe link survives, in a new tab with rel=noopener', m.links.length === 1 && m.links[0]![0] === 'https://example.com/notes' && m.links[0]![1] === '_blank' && /noopener/.test(m.links[0]![2] ?? ''), m.links)
    check('html: the script did not run; nothing remote was fetched', JSON.stringify(await ran()) === '{"ran":null,"body":null}' && remoteHits.length === 0 && m.img.length === 0 && m.placeholder === 1, { ran: await ran(), remoteHits, img: m.img, placeholder: m.placeholder })
    await shot('05-html')
    await page.locator('.mn-files-pane button[data-action="source"]').click()
    const src = await until(page, 'source', s => s.preview?.source === true && s.preview.status === 'ready')
    await reader().locator('pre code').waitFor()
    const code = await reader().locator('pre code').evaluate(el => el.textContent ?? '')
    check('html: Source shows the code (still nothing runs)', src.preview?.variant === 'code' && code.includes('<script>window.__quicklookRan = true') && (await ran()).ran === null, src.preview)
    await back()
  }

  // ── SVG, audio ───────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const p = await open('logo.svg')
    const img = page.locator('.mn-files-pane [data-viewer="svg"] img')
    await img.waitFor()
    await page.waitForFunction(() => ((document.querySelector('.mn-files-pane [data-viewer="svg"] img') as HTMLImageElement | null)?.naturalWidth ?? 0) > 0)
    const m = await img.evaluate(i => ({ src: i.getAttribute('src'), w: (i as HTMLImageElement).naturalWidth, inline: !!document.querySelector('.mn-files-pane svg rect') }))
    check('svg: drawn as an <img> from a blob: URL, never inlined; its script did not run', p.kind === 'media' && m.src?.startsWith('blob:') === true && m.w === 240 && !m.inline && (await ran()).ran === null, m)
    await back()
  }
  {
    const p = await open('tone.wav')
    const audio = page.locator('.mn-files-pane audio')
    await audio.waitFor()
    await page.waitForFunction(() => ((document.querySelector('.mn-files-pane audio') as HTMLAudioElement | null)?.readyState ?? 0) >= 1)
    const d = await audio.evaluate(a => ({ src: a.getAttribute('src'), duration: (a as HTMLAudioElement).duration, controls: (a as HTMLAudioElement).controls }))
    check('audio: a native <audio> from a blob: URL that the browser can play', p.kind === 'media' && d.src?.startsWith('blob:') === true && d.controls && Math.abs(d.duration - 0.6) < 0.05, d)
    await back()
  }

  // ── DOCX, XLSX ───────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const p = await open('Letter to Lucy.docx')
    await reader().locator('.ProseMirror h1').waitFor()
    const m = await reader().evaluate(el => ({ h1: el.querySelector('h1')?.textContent, strong: el.querySelector('strong')?.textContent, cells: [...el.querySelectorAll('td')].map(c => c.textContent) }))
    check('docx: mammoth (lazy) → the reader schema: heading, bold, table', p.label === 'Word document' && m.h1 === 'Letter to Lucy' && m.strong === 'blooming' && m.cells.includes('Jasmine'), m)
    await shot('06-docx')
    await back()
  }
  {
    const p = await open('Budget 2026.xlsx')
    await reader().locator('.hoja-data-table .dt-row').first().waitFor()
    const head = () => reader().evaluate(el => [...el.querySelectorAll('.dt-head .dt-label')].map(c => c.textContent))
    const tabs = await reader().evaluate(el => [...el.querySelectorAll('.dt-tabs [role="tab"]')].map(t => [t.textContent, t.getAttribute('aria-selected')]))
    const first = await head()
    await reader().locator('.dt-tabs [role="tab"]', { hasText: 'Income' }).click()
    const second = await head()
    const salary = await reader().evaluate(el => el.querySelector('.dt-row[data-index="0"] .dt-cell[data-col="1"]')?.textContent)
    check('xlsx: SheetJS (lazy) → a data table with sheet tabs', p.label === 'Spreadsheet' && p.variant === 'table'
      && JSON.stringify(tabs) === '[["Expenses","true"],["Income","false"]]' && JSON.stringify(first) === '["Month","Rent","Food"]', { tabs, first })
    check('xlsx: the second tab switches the sheet', JSON.stringify(second) === '["Source","Amount"]' && salary === '5200', { second, salary })
    await shot('07-xlsx')
    await back()
  }

  // ── No viewer: the file page; a binary misnamed .txt; a log ──────────────────────────────────────────────────────
  {
    const p = await open('notes.zip')
    await page.locator('.mn-files-pane [data-viewer="file"] h2').waitFor()
    const m = await page.evaluate(() => ({ kind: document.querySelector('[data-field="kind"]')?.textContent, size: document.querySelector('[data-field="size"]')?.textContent,
      modified: document.querySelector('[data-field="modified"]')?.textContent, downloads: document.querySelectorAll('.mn-files-pane button[data-action="download"]').length }))
    check('zip: its file page (kind, size, modified) with one Download button', p.kind === 'file' && m.kind === 'ZIP archive' && !!m.size && !!m.modified && m.downloads === 1, m)
    check('no file downloaded on open (all thirteen opened so far)', downloads.length === 0, downloads)
    await shot('08-file-page')
    const downloading = page.waitForEvent('download')
    await page.locator('.mn-files-pane [data-viewer="file"] button[data-action="download"]').click()
    check('zip: Download downloads it, on the click', (await downloading).suggestedFilename() === 'notes.zip')
    await back()
  }
  {
    const p = await open('disguised.txt')
    check('a binary misnamed .txt opens its file page', p.kind === 'file', p)
    await back()
    const log = await open('server.log')
    await reader().locator('.hoja-line-numbers').waitFor()
    check('a log: plain text in Hoja, monospace with line numbers', log.kind === 'reader' && log.label === 'Plain text' && log.variant === 'code'
      && (await reader().locator('.hoja-line-numbers').evaluate(e => e.textContent?.split('\n').length)) === 40, log)
    await back()
  }
  check('no download fired except the one Download press', downloads.length === 1, downloads)
  check('nothing remote was fetched by any file', remoteHits.length === 0, remoteHits)
} catch (error) {
  check('scenario completed', false, error instanceof Error ? error.message : String(error))
} finally {
  check('no page errors', errors.length === 0, errors)
  await browser.close(); await server.close(); await cell.close()
}
const failed = results.filter(r => !r.ok)
console.log(`${results.length} checks, ${failed.length} failed; shots in ${shots}`)
process.exit(failed.length ? 1 : 0)
