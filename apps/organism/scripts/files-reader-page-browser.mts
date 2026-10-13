/**
 * The reader as a page (design §12.2, review P0.5 and P1.13) witnessed in a real browser (Chromium) at 1440x900,
 * 1024x768 and 390x844, over the Files rudiments harness and the suites' CONTRACT-files v1 server.
 *
 *   node --import tsx scripts/files-reader-page-browser.mts      (exit 1 on any failed check; SHOTS_DIR for screenshots)
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { startFilesContractServer } from '../src/cell/__tests__/support/files-contract-server.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.FILES_READER_PORT ?? 5233)
const shots = process.env.SHOTS_DIR ?? resolve(appDir, '.files-reader-shots')
mkdirSync(shots, { recursive: true })

const results: { name: string; ok: boolean }[] = []
function check(name: string, ok: boolean, detail?: unknown): void {
  results.push({ name, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`)
}

function pdf(pages: number): Buffer {
  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>']
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`)
  objects.push(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`)
  const fontId = 3 + pages * 2
  for (let i = 0; i < pages; i++) {
    const content = `BT /F1 28 Tf 72 700 Td (Field notes, page ${i + 1}) Tj ET`
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`)
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const cell = await startFilesContractServer({ graphIncarnation: 'inc-reader-1' })
for (const [name, type, body] of [['Field notes.pdf', 'application/pdf', pdf(3)], ['Reading list.md', 'text/markdown', Buffer.from('# Reading list\n\n- Borges\n')]] as const) {
  const form = new FormData(); form.set('file', new File([new Uint8Array(body)], name, { type }))
  const r = await fetch(`${cell.base}/artifacts/${cell.graphId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${cell.token}` }, body: form })
  if (!r.ok) throw new Error(`seed ${name}: ${r.status}`)
}
const server = await createServer({ root: appDir, configFile: resolve(appDir, 'vite.config.ts'),
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, proxy: { '/files-cell': { target: cell.base, changeOrigin: true, rewrite: p => p.replace(/^\/files-cell/, '') } } }, logLevel: 'warn' })
await server.listen()
const browser = await chromium.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
const url = `http://127.0.0.1:${port}/files-rudiments-browser-harness.html?cell=/files-cell&token=${cell.token}&graph=${cell.graphId}&forcePane=1`
const errors: string[] = []

interface Harness { open?: boolean; face?: string | null; preview?: { kind: string; status: string } | null; rows?: { label: string; selected: boolean }[] }
const state = (p: Page) => p.evaluate(() => (window as unknown as { __filesHarness?: { state: Harness } }).__filesHarness?.state ?? {}) as Promise<Harness>
async function until(p: Page, what: string, ok: (s: Harness) => boolean, timeout = 15000): Promise<Harness> {
  const t = Date.now(); let last: Harness = {}
  while (Date.now() - t < timeout) { last = await state(p); if (ok(last)) return last; await p.waitForTimeout(50) }
  throw new Error(`timed out: ${what}; ${JSON.stringify(last)}`)
}

/** Opens the PDF from the tree-less route: Open Files, then the list face row, so the same steps work at every width. */
async function openPane(p: Page, width: number): Promise<void> {
  await until(p, 'discovery', s => s !== undefined && (s as { discovery?: string }).discovery === 'ready')
  await p.evaluate(() => (window as unknown as { __openFiles: () => void }).__openFiles())
}

const sizes = [{ width: 1440, height: 900, minPage: 600 }, { width: 1024, height: 768, minPage: 440 }, { width: 390, height: 844, minPage: 0 }]
try {
  for (const size of sizes) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height } })
    const page = await context.newPage(); await page.addInitScript('window.__name = (f) => f')
    page.on('pageerror', e => errors.push(e.stack ?? e.message))
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await openPane(page, size.width)
    await until(page, 'pane open', s => s.open === true)
    // The List face is how a phone-sized pane starts; use it everywhere so the steps are the same. Select the markdown
    // file first: Back must restore the selection.
    await page.locator('.mn-files-pane .seg button[data-face="list"]').click()
    await until(page, 'list face', s => s.face === 'list')
    const row = (label: string) => page.locator('.mn-files-pane .list [role="row"][data-key]', { hasText: label })
    await row('Reading list.md').click()
    await row('Field notes.pdf').click()
    await until(page, 'selection', s => !!s.rows?.find(r => r.label === 'Field notes.pdf' && r.selected))
    await row('Field notes.pdf').press('Enter')
    await until(page, 'pdf ready', s => s.preview?.kind === 'pdf' && s.preview.status === 'ready')
    const img = page.locator('mn-pdf-reader .pdfViewer .page canvas').first()
    await img.waitFor({ state: 'visible', timeout: 20000 })
    const m = await page.evaluate(() => {
      const pane = document.querySelector('.mn-files-pane') as HTMLElement
      const vis = (el: Element | null) => !!el && (el as HTMLElement).getBoundingClientRect().height > 0
      const image = pane.querySelector('mn-pdf-reader .pdfViewer .page') as HTMLElement
      // The pane's header, the reader (its own toolbar and the pages) and the footer: no second bar around the reader.
      const bands = [...pane.querySelectorAll(':scope > header, :scope > .center, :scope > footer, :scope .opened > .bar')].filter(vis).length
      const asides = pane.querySelectorAll('aside').length
      const header = pane.querySelector(':scope > header') as HTMLElement
      const bar = header.getBoundingClientRect()
      const rows = new Set([...header.querySelectorAll('button, input, .title')].filter(vis).map(e => { const r = (e as HTMLElement).getBoundingClientRect(); return Math.round((r.top + r.height / 2) / 12) }))
      return { page: Math.round(image.getBoundingClientRect().width), bands, asides, headerRows: rows.size, headerH: Math.round(bar.height), paneW: Math.round(pane.getBoundingClientRect().width),
        downloads: [...pane.querySelectorAll('button')].filter(b => vis(b) && /download/i.test(b.getAttribute('aria-label') ?? b.textContent ?? '')).length,
        scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth }
    })
    console.log(`${size.width}x${size.height}`, JSON.stringify(m))
    const tag = `${size.width}x${size.height}`
    await page.screenshot({ path: resolve(shots, `reader-${tag}.png`) })
    if (size.minPage) check(`${tag}: the page is at least ${size.minPage}px wide (${m.page})`, m.page >= size.minPage, m)
    check(`${tag}: at most three vertical regions (${m.bands})`, m.bands <= 3, m)
    check(`${tag}: no inner aside`, m.asides === 0, m)
    check(`${tag}: one Download`, m.downloads === 1, m)
    check(`${tag}: one toolbar row`, m.headerRows === 1, m)
    check(`${tag}: no horizontal page scroll`, m.scrollX <= 0, m)
    if (size.width === 390) check('390x844: the page is a single column at full width', m.page >= m.paneW - 40, m)

    // Reload works: it asks the cell for the file again.
    const before = cell.requests.length
    await page.locator('.mn-files-pane [data-action="reload"]').click()
    await page.waitForFunction(() => document.querySelector('mn-pdf-reader .pdfViewer .page canvas'), undefined, { timeout: 20000 })
    check(`${tag}: Reload reads the file again`, cell.requests.length > before)

    // Back restores the face and the selection.
    await page.locator('.mn-files-pane [data-action="back"]').click()
    const back = await until(page, 'back', s => s.preview === null)
    check(`${tag}: Back restores the List face and the selection`, back.face === 'list' && !!back.rows?.find(r => r.label === 'Field notes.pdf' && r.selected), back)
    await context.close()
  }

  // Back restores the canvas camera: pan the canvas, open a file, go back.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage(); await page.addInitScript('window.__name = (f) => f')
    page.on('pageerror', e => errors.push(e.stack ?? e.message))
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await openPane(page, 1440)
    await until(page, 'pane open', s => s.open === true)
    await page.locator('.mn-files-pane .seg button[data-face="canvas"]').click()
    await until(page, 'canvas face', s => s.face === 'canvas')
    await page.locator('mn-files-canvas .card[role="option"]', { hasText: 'Field notes.pdf' }).waitFor()
    const camera = () => page.evaluate(() => {
      const plane = document.querySelector('mn-files-canvas')!.shadowRoot!.querySelector('.scene') as HTMLElement
      return getComputedStyle(plane).transform
    })
    const box = (await page.locator('mn-files-canvas').boundingBox())!
    await page.mouse.move(box.x + box.width - 60, box.y + box.height - 60)
    await page.mouse.wheel(0, 30)
    await page.waitForTimeout(300)
    const panned = await camera()
    check('1440x900: the canvas camera moved before the file opened', panned !== 'none' && panned !== 'matrix(1, 0, 0, 1, 0, 0)', panned)
    await page.locator('mn-files-canvas .card[role="option"]', { hasText: 'Field notes.pdf' }).click({ force: true })
    await page.keyboard.press('Enter')
    await until(page, 'pdf ready', s => s.preview?.kind === 'pdf' && s.preview.status === 'ready')
    await page.locator('.mn-files-pane [data-action="back"]').click()
    await until(page, 'back', s => s.preview === null)
    await page.waitForSelector('mn-files-canvas')
    await page.waitForTimeout(300)
    const restored = await camera()
    check('1440x900: Back restores the canvas face, the camera and the selection',
      restored === panned && (await page.locator('mn-files-canvas .card[role="option"][aria-selected="true"]', { hasText: 'Field notes.pdf' }).count()) === 1, { panned, restored })
    await context.close()
  }
} catch (error) {
  check('scenario completed', false, error instanceof Error ? error.message : String(error))
} finally {
  check('no page errors', errors.length === 0, errors)
  await browser.close(); await server.close(); await cell.close()
}
const failed = results.filter(r => !r.ok)
console.log(`${results.length} checks, ${failed.length} failed; shots in ${shots}`)
process.exit(failed.length ? 1 : 0)
