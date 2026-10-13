/**
 * The Files rudiments witnessed in a real browser (Chromium), against a server that speaks CONTRACT-files v1.
 *
 * WHAT RUNS. The real Files modules composed as the real shell composes them (src/harness/files-rudiments-main.ts:
 * FilesDiscovery, FilesShell, the left tree's Files section and its Open Files action, the inspector, renderWorkspace on
 * the Surface path, <mn-files-canvas>, <mn-original-viewer> with pdf.js), served by vite, talking real HTTP through the
 * dev server's proxy to the suites' contract server (src/cell/__tests__/support/files-contract-server.ts). No gardend can
 * run on this laptop (no local cargo builds); the lead's witness against a real cell is the judge at integration.
 *
 * WHAT IT WITNESSES (Vera's decisions of 2026-10-05):
 *   gating     a cell that does not advertise Files: the section stays "Artifacts", no Open Files action, no pane;
 *   open       the Files section's Open Files action opens the pane on the canvas face, with no connector and no
 *              Connect verb anywhere;
 *   upload     any file from the Upload button (a PDF, a PNG, a zip), and by dropping a file on the canvas;
 *              a file of 50 MiB + 1 byte dropped is refused in the status line and never sent;
 *   open file  the PDF in the original-page viewer (a rendered page image), the PNG as a picture, the zip downloaded
 *              under its name;
 *   edit       New folder named in place; rename in place on the canvas (F2); Move to… from the card's menu; Delete
 *              to the trash and Undo from the status line;
 *   prefs      the List face chosen, saved, and still the face after a reload; rename in place in the List face;
 *   reader     a viewer sees the files with a note and no Upload.
 *
 *   SHOTS_DIR=/path node --import tsx scripts/files-rudiments-browser.mts      (exit 1 on any failed check)
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { startFilesContractServer } from '../src/cell/__tests__/support/files-contract-server.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.FILES_BROWSER_PORT ?? 5231)
const shots = process.env.SHOTS_DIR ?? resolve(appDir, '.files-rudiments-shots')
mkdirSync(shots, { recursive: true })

const results: { name: string; ok: boolean; detail?: string }[] = []
function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, ...(detail ? { detail } : {}) })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` :: ${detail}`}`)
}

function minimalPdf(text: string): Buffer {
  const content = `BT /F1 28 Tf 40 110 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 220] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const filesCell = await startFilesContractServer({ graphIncarnation: 'inc-browser-1' })
const oldCell = await startFilesContractServer({ advertise: false })
const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  server: {
    host: '127.0.0.1', port, strictPort: true, hmr: false,
    proxy: {
      '/files-cell': { target: filesCell.base, changeOrigin: true, rewrite: path => path.replace(/^\/files-cell/, '') },
      '/old-cell': { target: oldCell.base, changeOrigin: true, rewrite: path => path.replace(/^\/old-cell/, '') },
    },
  },
  logLevel: 'warn',
})
await server.listen()

const browser = await chromium.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const page = await context.newPage()
const pageErrors: string[] = []
page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))

interface HarnessState {
  ready?: boolean; error?: string; discovery?: string; visible?: boolean; open?: boolean; face?: string | null
  breadcrumbs?: string[]; banner?: string | null
  status?: { text: string; message: string; undoLabel: string | null; tone?: string } | null
  preview?: { kind: string; status: string; name: string; error: string } | null
  rows?: { label: string; selected: boolean; naming: unknown }[]
}
const state = (p: Page) => p.evaluate(() => (window as unknown as { __filesHarness?: { state: HarnessState } }).__filesHarness?.state ?? {})
async function until(p: Page, what: string, predicate: (s: HarnessState) => boolean, timeout = 8000): Promise<HarnessState> {
  const start = Date.now()
  let last: HarnessState = {}
  while (Date.now() - start < timeout) {
    last = await state(p)
    if (predicate(last)) return last
    await p.waitForTimeout(50)
  }
  throw new Error(`timed out waiting for ${what}; last state ${JSON.stringify(last)}`)
}
async function waitFor(what: string, predicate: () => boolean, timeout = 8000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (predicate()) return; await new Promise(r => setTimeout(r, 50)) }
  throw new Error(`timed out waiting for ${what}`)
}
const card = (p: Page, label: string) => p.locator('mn-files-canvas .card[role="option"]', { hasText: label }).first()
const shot = (p: Page, name: string) => p.screenshot({ path: resolve(shots, `${name}.png`) })
const url = (query: string) => `http://127.0.0.1:${port}/files-rudiments-browser-harness.html?${query}`

async function dropFiles(p: Page, files: { name: string; type: string; size: number }[], at: { x: number; y: number }): Promise<void> {
  await p.evaluate(({ files, at }) => {
    const canvas = document.querySelector('mn-files-canvas')!
    const plane = canvas.shadowRoot!.querySelector('.plane')!
    const transfer = new DataTransfer()
    for (const f of files) transfer.items.add(new File([new Uint8Array(f.size)], f.name, { type: f.type }))
    const init = { bubbles: true, composed: true, cancelable: true, clientX: at.x, clientY: at.y, dataTransfer: transfer }
    plane.dispatchEvent(new DragEvent('dragenter', init))
    plane.dispatchEvent(new DragEvent('dragover', init))
    plane.dispatchEvent(new DragEvent('drop', init))
  }, { files, at })
}

try {
  // ── gating: a cell older than the contract ─────────────────────────────────────────────────────────────────────────
  await page.goto(url('cell=/old-cell'), { waitUntil: 'domcontentloaded' })
  const old = await until(page, 'old cell discovery', s => s.ready === true && s.discovery !== 'loading')
  await page.waitForSelector('mn-sidebar-panel')
  const oldLabel = await page.locator('mn-sidebar-panel [data-section-id="tree"] .section-header').innerText()
  check('gating: an older cell hides Files (no advert, section stays the plain tree, no action, no pane)',
    old.discovery === 'absent' && old.visible === false && /Workspace/i.test(oldLabel)
      && await page.locator('mn-sidebar-panel button.section-action').count() === 0 && await page.locator('section.mn-files-pane').count() === 0,
    JSON.stringify({ old, oldLabel }))
  // Besides the harness's own listing read (the sidebar), the shell asked one thing: the capabilities.
  check('gating: the older cell was asked once and never probed', oldCell.requests.filter(r => r.path !== '/navigation/files-graph').map(r => r.path).join(',') === '/api/capabilities',
    oldCell.requests.map(r => `${r.method} ${r.path}`).join(', '))

  // ── open ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  await page.goto(url('cell=/files-cell'), { waitUntil: 'domcontentloaded' })
  await until(page, 'files discovery', s => s.discovery === 'ready')
  const action = page.locator('mn-sidebar-panel button.section-action')
  check('open: the one tree carries Open Files', await action.getAttribute('aria-label') === 'Open Files'
    && /^workspace/i.test((await page.locator('mn-sidebar-panel [data-section-id="tree"] .section-header').innerText()).trim()))
  await action.click()
  const opened = await until(page, 'the pane open', s => s.open === true)
  await page.waitForSelector('mn-files-canvas')
  check('open: the pane opens on the canvas face at the top of Files', opened.face === 'canvas' && opened.breadcrumbs?.join('/') === 'Files',
    JSON.stringify(opened))

  // ── upload: button ─────────────────────────────────────────────────────────────────────────────────────────────────
  check('upload: the button says the limit', (await page.locator('.mn-files-pane button[data-action="upload"]').getAttribute('title')) === 'Upload files (up to 50 MB each)')
  await page.locator('.mn-files-pane > header input[type="file"]').setInputFiles([
    { name: 'report.pdf', mimeType: 'application/pdf', buffer: minimalPdf('Files rudiments') },
    { name: 'cat.png', mimeType: 'image/png', buffer: PNG },
    { name: 'notes.zip', mimeType: 'application/zip', buffer: Buffer.from('PK\u0003\u0004 not really a zip') },
  ])
  const uploaded = await until(page, 'three uploads', s => s.status?.message === 'Uploaded 3 files.')
  await page.waitForFunction(() => document.querySelector('mn-files-canvas')?.shadowRoot?.querySelectorAll('.card[data-role="real"]').length === 3)
  check('upload: any type from the button, no parsing (three multipart POSTs, the bytes stored as sent)',
    filesCell.artifacts.size === 3 && filesCell.requests.filter(r => r.method === 'POST' && r.path.endsWith('/files')).length === 3
      && !filesCell.requests.some(r => /\/upload$|\/import$|\/convert$/.test(r.path)) && uploaded.status?.undoLabel === 'Undo',
    JSON.stringify(uploaded.status))
  await shot(page, '01-canvas-three-files')

  // ── upload: drop, and the 50 MB refusal ───────────────────────────────────────────────────────────────────────────
  const box = (await page.locator('mn-files-canvas').boundingBox())!
  const empty = { x: box.x + box.width - 80, y: box.y + box.height - 120 }
  const postsBefore = filesCell.requests.filter(r => r.method === 'POST' && r.path.endsWith('/files')).length
  await dropFiles(page, [{ name: 'huge.bin', type: 'application/octet-stream', size: 52_428_801 }], empty)
  const refused = await until(page, 'the refusal', s => (s.status?.message ?? '').includes('huge.bin'))
  check('upload: 50 MiB + 1 byte dropped is refused in the status line, never sent',
    refused.status?.message === '“huge.bin” is 50.0 MB, over the 50 MB limit for one file. It was not uploaded.' && refused.status?.tone === 'error'
      && filesCell.requests.filter(r => r.method === 'POST' && r.path.endsWith('/files')).length === postsBefore,
    JSON.stringify(refused.status))
  await shot(page, '02-refusal-over-50mb')
  await dropFiles(page, [{ name: 'dropped.txt', type: 'text/plain', size: 12 }], empty)
  await until(page, 'the drop upload', s => s.status?.message === 'Uploaded “dropped.txt”.')
  check('upload: a file dropped on the canvas is uploaded into the viewed folder',
    [...filesCell.artifacts.values()].some(a => a.value.label === 'dropped.txt' && a.value.parentId === null))

  // ── open a file by its type ────────────────────────────────────────────────────────────────────────────────────────
  await card(page, 'report.pdf').dblclick()
  const pdf = await until(page, 'the PDF page', s => s.preview?.kind === 'pdf' && s.preview.status !== 'loading', 15000)
  const pageCanvas = page.locator('mn-pdf-reader .pdfViewer .page canvas').first()
  await pageCanvas.waitFor({ state: 'visible', timeout: 15000 })
  const naturalWidth = await pageCanvas.evaluate(c => (c as HTMLCanvasElement).width)
  check('open: the PDF in the reader (pdf.js viewer), a rendered page', pdf.preview?.status === 'ready' && naturalWidth > 0,
    JSON.stringify({ pdf: pdf.preview, naturalWidth }))
  await shot(page, '03-pdf-original-viewer')
  await page.locator('.mn-files-pane button[data-action="back"]').click()
  await until(page, 'back from the PDF', s => s.preview === null)

  await card(page, 'cat.png').dblclick()
  await until(page, 'the image', s => s.preview?.kind === 'image' && s.preview.status === 'ready')
  const picture = page.locator('.mn-files-pane .picture img')
  await picture.waitFor({ state: 'visible' })
  check('open: the image previewed from a blob: URL', (await picture.getAttribute('src'))?.startsWith('blob:') === true
    && await picture.evaluate(img => (img as HTMLImageElement).naturalWidth) > 0)
  await shot(page, '04-image-preview')
  await page.locator('.mn-files-pane button[data-action="back"]').click()
  await until(page, 'back from the image', s => s.preview === null)

  const fired: string[] = []
  const onDownload = (d: { suggestedFilename(): string }) => fired.push(d.suggestedFilename())
  page.on('download', onDownload)
  await card(page, 'notes.zip').dblclick()
  await until(page, 'the file page', s => s.preview?.kind === 'file' && s.preview.status === 'ready')
  await page.waitForTimeout(300)
  check('open: anything else opens its file page, nothing downloaded', fired.length === 0, fired.join(', '))
  const downloading = page.waitForEvent('download')
  await page.locator('.mn-files-pane [data-viewer="file"] button[data-action="download"]').click()
  const download = await downloading
  check('open: the file page\'s Download saves it under its own name', download.suggestedFilename() === 'notes.zip', download.suggestedFilename())
  page.off('download', onDownload)
  await page.locator('.mn-files-pane button[data-action="back"]').click()
  await until(page, 'back from the file page', s => s.preview === null)

  // ── edit ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  await page.locator('.mn-files-pane button[data-action="new-folder"]').click()
  const draftName = page.locator('mn-files-canvas input.name')
  await draftName.waitFor({ state: 'visible' })
  await draftName.fill('Docs')
  await draftName.press('Enter')
  await waitFor('the folder', () => [...filesCell.folders.values()].some(f => f.name === 'Docs' && f.section === 'artifacts'))
  const docs = [...filesCell.folders.values()].find(f => f.name === 'Docs')!
  check('edit: New folder named in place, created in the artifacts section', docs.section === 'artifacts')

  await card(page, 'notes.zip').click()
  await page.keyboard.press('F2')
  const nameInput = page.locator('mn-files-canvas input.name')
  await nameInput.waitFor({ state: 'visible' })
  await nameInput.fill('archive.zip')
  await nameInput.press('Enter')
  await waitFor('the rename', () => [...filesCell.artifacts.values()].some(a => a.value.label === 'archive.zip'))
  const renamed = await until(page, 'the rename message', s => s.status?.message === 'Renamed “notes.zip” to “archive.zip”.')
  check('edit: rename in place on the canvas (F2), a PATCH, announced with Undo', renamed.status?.undoLabel === 'Undo'
    && filesCell.requests.some(r => r.method === 'PATCH'))

  await card(page, 'archive.zip').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move to…' }).click()
  await page.getByRole('menuitem', { name: 'Docs' }).click()
  await waitFor('the move', () => [...filesCell.artifacts.values()].some(a => a.value.label === 'archive.zip' && a.value.parentId === docs.id))
  check('edit: Move to… from the card\'s menu puts the file in the folder', true)

  await card(page, 'cat.png').click()
  await page.keyboard.press('Delete')
  const trashed = await until(page, 'the trash message', s => s.status?.message === 'Moved “cat.png” to the trash.')
  check('edit: Delete moves to the trash (recoverable), announced with Undo', trashed.status?.undoLabel === 'Undo'
    && [...filesCell.trash.values()].some(t => t.value.label === 'cat.png'))
  await page.locator('.mn-files-pane footer button[data-action="undo"]').click()
  await waitFor('the restore', () => [...filesCell.artifacts.values()].some(a => a.value.label === 'cat.png'))
  check('edit: Undo from the status line brings it back', filesCell.trash.size === 0)
  // Connections shipped in wave 4 (witnessed by files-canvas-browser): a card has its handle, but nothing is drawn until two are connected.
  check('canvas: no connector is drawn before anything is connected',
    await page.locator('mn-files-canvas .connector, mn-files-canvas svg.connectors').count() === 0)
  await shot(page, '05-canvas-after-edits')

  // ── preferences ───────────────────────────────────────────────────────────────────────────────────────────────────
  await page.locator('.mn-files-pane .seg button[data-face="list"]').click()
  await until(page, 'the list face', s => s.face === 'list')
  await waitFor('the face saved', () => filesCell.requests.some(r => r.tool === 'source_push'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await until(page, 'files discovery after reload', s => s.discovery === 'ready')
  await page.locator('mn-sidebar-panel button.section-action').click()
  const afterReload = await until(page, 'the saved face', s => s.open === true && s.face === 'list')
  check('prefs: the List face is saved and is still the face after a reload', afterReload.face === 'list'
    && !filesCell.requests.some(r => r.tool === 'source_pull'))
  await page.locator('.mn-files-pane .list [role="row"][data-key]', { hasText: 'report.pdf' }).click()
  await page.keyboard.press('F2')
  const rowInput = page.locator('.mn-files-pane .list input.rename')
  await rowInput.waitFor({ state: 'visible' })
  await rowInput.fill('spec.pdf')
  await rowInput.press('Enter')
  await waitFor('the list rename', () => [...filesCell.artifacts.values()].some(a => a.value.label === 'spec.pdf'))
  check('prefs: rename in place in the List face', true)
  await shot(page, '06-list-face')

  // ── a reader ─────────────────────────────────────────────────────────────────────────────────────────────────────
  await page.goto(url('cell=/files-cell&writable=0'), { waitUntil: 'domcontentloaded' })
  await until(page, 'files discovery (reader)', s => s.discovery === 'ready')
  await page.locator('mn-sidebar-panel button.section-action').click()
  const reader = await until(page, 'the reader pane', s => s.open === true)
  check('reader: sees the files with a note, no Upload, no New folder', reader.banner === 'You can view these files. Only editors can change them.'
    && await page.locator('.mn-files-pane button[data-action="upload"]').count() === 0
    && await page.locator('.mn-files-pane button[data-action="new-folder"]').count() === 0, JSON.stringify(reader.banner))
  await shot(page, '07-reader')

  // ── phones (Vera, 2026-10-06 12:15): Files hidden at the shell's phone breakpoint, 600 px and under ─────────────
  const docsId = [...filesCell.folders.values()].find(f => f.name === 'Docs')?.id ?? ''
  const phone = await context.newPage()
  phone.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
  await phone.setViewportSize({ width: 390, height: 844 })
  await phone.goto(url('cell=/files-cell'), { waitUntil: 'domcontentloaded' })
  const onPhone = await until(phone, 'files discovery (phone)', s => s.discovery === 'ready')
  await phone.waitForSelector('mn-sidebar-panel', { state: 'attached' })
  const phoneLabel = (await phone.locator('mn-sidebar-panel [data-section-id="tree"] .section-header').textContent())?.trim() ?? ''
  check('phone 390: no Files (the tree stays the plain tree, no Open Files action, no pane)', onPhone.visible === false
    && /workspace/i.test(phoneLabel) && await phone.locator('mn-sidebar-panel button.section-action').count() === 0
    && await phone.locator('section.mn-files-pane').count() === 0, JSON.stringify({ visible: onPhone.visible, phoneLabel }))
  // A tap on a Files folder in the tree (the way in on wider screens) opens no pane.
  await phone.evaluate(id => {
    document.querySelector('mn-sidebar-panel')!.dispatchEvent(new CustomEvent('mn-sidebar-node-open', { bubbles: true, composed: true,
      detail: { id, node: { id, label: 'Docs', kind: 'folder', section: 'artifacts', parentId: null } } }))
  }, docsId)
  await phone.waitForTimeout(200)
  check('phone 390: a Files folder tapped in the tree opens no pane', (await state(phone)).open === false
    && await phone.locator('section.mn-files-pane').count() === 0)
  await shot(phone, '08-phone-390-no-files')
  await phone.close()

  // An open pane when the window narrows to a phone: the pane goes, and it does not come back by itself.
  await page.goto(url('cell=/files-cell'), { waitUntil: 'domcontentloaded' })
  await until(page, 'files discovery (narrowing)', s => s.discovery === 'ready')
  await page.locator('mn-sidebar-panel button.section-action').click()
  await until(page, 'the pane open before narrowing', s => s.open === true)
  await page.setViewportSize({ width: 390, height: 844 })
  const narrowed = await until(page, 'the pane closed at 390', s => s.open === false)
  check('phone 390: an open pane closes when the window narrows, and no broken pane remains', narrowed.visible === false
    && await page.locator('section.mn-files-pane').count() === 0)
  await shot(page, '09-narrowed-to-390')
  await page.setViewportSize({ width: 1440, height: 900 })
  const widened = await until(page, 'Files offered again at 1440', s => s.visible === true)
  check('phone 390: widening offers Files again without reopening it by itself', widened.open === false
    && await page.locator('mn-sidebar-panel button.section-action').count() === 1)
} catch (error) {
  check('scenario completed', false, error instanceof Error ? error.message : String(error))
  await shot(page, '99-failure').catch(() => {})
} finally {
  check('no page errors', pageErrors.length === 0, pageErrors.join('\n'))
  await browser.close()
  await server.close()
  await filesCell.close()
  await oldCell.close()
}

const failed = results.filter(r => !r.ok)
console.log(`${results.length} checks, ${failed.length} failed; shots in ${shots}`)
process.exit(failed.length ? 1 : 0)
