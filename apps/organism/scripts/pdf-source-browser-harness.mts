/**
 * Local PDF parser → real TipTap/Y.Doc → original renderer witness.
 * The HTTP server serves synthetic original bytes, NOT a Garden persistence
 * adapter. No personal browser profile, cloud call, or native acceptance.
 */
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { createServer, type Plugin } from 'vite'
import { pdfBytes } from '../src/cell/__tests__/pdf-test-fixtures.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// A worktree can borrow installed dependencies through symlinks. Permit the
// resolved package workspace, without hardcoding a developer's machine path.
const dependencyRoot = realpathSync(resolve(appDir, 'node_modules/vite')).split(`${sep}node_modules${sep}`)[0]!
const port = 5399
const output = mkdtempSync(resolve(tmpdir(), 'demi-pdf-source-browser-'))
const bytes = pdfBytes([
  [
    { x: 55, y: 730, size: 22, text: 'A garden of source passages' },
    { x: 55, y: 675, text: 'Each text passage remembers the page from which it grew.' },
    { x: 55, y: 650, text: 'A reader can return to the original without losing their place.' },
  ],
  [
    { size: 20, matrix: [0, 1, -1, 0, 105, 90], text: 'The turned page' },
    { size: 12, matrix: [0, 1, -1, 0, 150, 90], text: 'This passage lives on a cropped and rotated page.' },
    { size: 12, matrix: [0, 1, -1, 0, 178, 90], text: 'Its position stays attached to the original PDF bytes.' },
  ],
], [
  { mediaBox: [0, 0, 612, 792] },
  { mediaBox: [0, 0, 612, 792], cropBox: [25, 40, 600, 770], rotation: 90, userUnit: 2 },
])
const entryId = '/pdf-source-proof-entry.ts'
const resolvedEntry = '\0virtual:pdf-source-proof-entry.ts'
const entry = String.raw`
import '@shrubbery/tokens/tokens.css'
import '@shrubbery/components'
import '@shrubbery/runtime'
import { applySkinTheme } from '@shrubbery/tokens'
import { InProcessCrdtBackend } from '@shrubbery/runtime/harness/in-process-crdt-backend'
import { parsePdfFastTextDocument } from '/src/cell/pdf-layout-parser.ts'
import { OrganismOriginalFileController } from '/src/cell/original-file-controller.ts'

applySkinTheme({ skin: 'garden', theme: 'light' })
const backend = new InProcessCrdtBackend()
const provider = backend.open({ kind: 'doc', graphId: 'g', docId: 'source-proof' })
const state = { centerMode: 'document', graphId: 'g', documentId: 'source-proof', status: 'ready', error: null, provider }
const binding = { get: () => state, subscribe: () => () => undefined }
const host = document.createElement('sh-editor-host')
host.layoutMode = 'contained'
host.binding = binding
document.querySelector('main').append(host)
const controller = new OrganismOriginalFileController({ requestRender: () => { host.originalFileView = controller.snapshot() } })
const contract = {
  auth: { token: () => null, userId: () => 'local-fixture', isAuthenticated: () => true, whenReady: async () => undefined, onChange: () => () => undefined },
  runtime: { mode: () => 'hosted', isGateway: () => false, graphBaseUrl: () => location.origin },
}
controller.setScope(contract, 'g', 'source-proof', { originalFilename: 'source-proof.pdf', mimeType: 'application/pdf', fileType: 'pdf' })
host.originalFileView = controller.snapshot()
document.addEventListener('mn-editor-original-view-toggle', () => { void controller.toggle(host.getPdfSourceLocation()) })
document.addEventListener('mn-original-viewer-page-select', event => {
  if (event.detail.graphId === 'g' && event.detail.documentId === 'source-proof') void controller.selectPage(event.detail.pageNumber)
})
const originalBytes = new Uint8Array(await (await fetch('/fixture.pdf')).arrayBuffer())
const parsed = await parsePdfFastTextDocument({ bytes: originalBytes, fallbackTitle: 'Source proof' })
await provider.whenRenderable
await host.updateComplete
while (!host.liveEditor) await new Promise(resolve => requestAnimationFrame(resolve))
let count = 0
const blocks = []
function identify(node) {
  if (node.type && node.type !== 'text' && node.type !== 'doc') {
    node.attrs = { ...node.attrs, 'data-block-id': 'fixture-' + count++ }
    if (node.attrs['data-pdf-anchor']) blocks.push({ id: node.attrs['data-block-id'], page: Number(node.attrs['data-source-page']) })
  }
  node.content?.forEach(identify)
}
identify(parsed.tiptapJson)
// Test setup uses the actual editor commands; the viewer and all gestures use
// production interfaces. This does not replace or mock document persistence.
host._editor.commands.setContent(parsed.tiptapJson)
const editorIdentity = host.liveEditor
Object.defineProperty(window, '__pdfProof', { value: {
  get snapshot() { return { view: controller.snapshot(), location: host.getPdfSourceLocation(), sameEditor: host.liveEditor === editorIdentity, blocks, warnings: parsed.warnings } },
  get documentJson() { return host._editor.getJSON() },
} })
window.addEventListener('beforeunload', () => { controller.destroy(); backend.destroyAll() }, { once: true })
`
const htmlSource = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PDF source witness</title>
<style>*{box-sizing:border-box}html,body{height:100%;width:100%;margin:0;overflow:hidden}body{display:grid;grid-template-rows:48px minmax(0,1fr);font:14px system-ui;background:#f3f1eb;color:#25382e}header{display:flex;align-items:center;padding:0 16px;border-bottom:1px solid #c4cbbf;gap:12px}header span{font-size:12px;color:#5e6c61}main{position:relative;min-width:0;min-height:0}sh-editor-host{width:100%;height:100%}</style></head>
<body><header><strong>PDF source witness</strong><span>Isolated local fixture</span></header><main></main><script type="module" src="${entryId}"></script></body></html>`
const requests: string[] = []
const plugin: Plugin = {
  name: 'pdf-source-proof',
  resolveId: id => id === entryId ? resolvedEntry : null,
  load: id => id === resolvedEntry ? entry : null,
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
      if (path === '/fixture.pdf' || path.endsWith('/download-original')) {
        requests.push(path); res.setHeader('Content-Type', 'application/pdf'); res.end(bytes); return
      }
      if (path === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(htmlSource); return }
      next()
    })
  },
}
const server = await createServer({ root: appDir, configFile: false, plugins: [plugin],
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false,
    fs: { allow: [resolve(appDir, '../..'), dependencyRoot] } }, logLevel: 'warn' })
let browser: Browser | null = null
const errors: string[] = []
const observations: unknown[] = []
const deadline = setTimeout(() => { void browser?.close(); void server.close() }, 120_000)
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync'] })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(20_000)
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' || ['blob:', 'data:'].includes(url.protocol) ? route.continue() : route.abort()
  })
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`) })
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean((window as any).__pdfProof))
  const state = () => page.evaluate(() => (window as any).__pdfProof.snapshot)
  const checkAspectRatio = async () => {
    const geometry = await page.locator('mn-original-viewer .pdf-image').evaluate(async element => {
      const image = element as HTMLImageElement
      await image.decode()
      const rect = image.getBoundingClientRect()
      return { width: rect.width, height: rect.height, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight }
    })
    if (Math.abs((geometry.width - 2) / (geometry.height - 2) - geometry.naturalWidth / geometry.naturalHeight) > 0.01) {
      throw new Error('PDF raster aspect ratio was distorted: ' + JSON.stringify(geometry))
    }
    observations.push({ kind: 'raster-aspect-ratio', geometry })
  }
  const initial = await state()
  // This actual parser → editor value can also feed the native queue witness.
  // Its original bytes are the same synthetic bytes served by this harness.
  writeFileSync(resolve(output, 'native-input.json'), JSON.stringify({
    scope: 'synthetic actual PDF.js extraction and real editor JSON; no native persistence yet',
    originalBase64: Buffer.from(bytes).toString('base64'),
    tiptapJson: await page.evaluate(() => (window as any).__pdfProof.documentJson),
  }, null, 2) + '\n')
  if (!initial.blocks.some((b: any) => b.page === 2)) throw new Error('Parser produced no mapped second-page block')
  for (const pageNumber of [1, 2]) {
    const block = initial.blocks.find((b: any) => b.page === pageNumber)
    await page.locator(`sh-editor-host .ProseMirror [data-block-id="${block.id}"]`).click()
    await page.locator('mn-editor-toolbar [data-original-view-toggle]:visible').click()
    await page.waitForFunction(() => (window as any).__pdfProof.snapshot.view.status === 'ready')
    const current = await state()
    if (current.view.pdfPageNumber !== pageNumber || current.view.pdfSourceMapping.status !== 'mapped') throw new Error('Source navigation disagreed: ' + JSON.stringify(current))
    await page.locator('mn-original-viewer .pdf-image').waitFor({ state: 'visible' })
    await checkAspectRatio()
    if (!current.view.pdfPages[0].rectangles.length) throw new Error('No source rectangles rendered')
    observations.push({ kind: 'mapped', pageNumber, view: current.view, sameEditor: current.sameEditor })
    await page.screenshot({ path: resolve(output, `desktop-page-${pageNumber}.png`) })
    if (pageNumber === 2) {
      await page.setViewportSize({ width: 390, height: 844 })
      await checkAspectRatio()
      await page.screenshot({ path: resolve(output, 'mobile-page-2.png') })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      if (overflow) throw new Error('Mobile outer document overflows horizontally')
      await page.getByRole('button', { name: 'Previous PDF page', exact: true }).click()
      await page.waitForFunction(() => (window as any).__pdfProof.snapshot.view.status === 'ready' && (window as any).__pdfProof.snapshot.view.pdfPageNumber === 1)
      await page.getByRole('combobox', { name: 'Go to source region page' }).selectOption('2')
      await page.waitForFunction(() => (window as any).__pdfProof.snapshot.view.status === 'ready' && (window as any).__pdfProof.snapshot.view.pdfPageNumber === 2)
      await page.setViewportSize({ width: 1280, height: 900 })
    }
    await page.locator('mn-editor-toolbar [data-original-view-toggle]:visible').click()
    const returned = await state()
    if (!returned.sameEditor || returned.location.blockId !== block.id) throw new Error('Toggle lost editor identity or passage selection')
  }
  const second = initial.blocks.find((b: any) => b.page === 2)
  await page.locator(`sh-editor-host .ProseMirror [data-block-id="${second.id}"]`).click()
  await page.keyboard.type('Edited ')
  await page.locator('mn-editor-toolbar [data-original-view-toggle]:visible').click()
  await page.waitForFunction(() => (window as any).__pdfProof.snapshot.view.status === 'ready')
  const edited = await state()
  if (edited.view.pdfSourceMapping.status !== 'edited') throw new Error('Changed text not labelled edited')
  await page.screenshot({ path: resolve(output, 'desktop-edited.png') })
  observations.push({ kind: 'edited', mapping: edited.view.pdfSourceMapping })
  if (errors.length) throw new Error(errors.join('\n'))
  writeFileSync(resolve(output, 'receipt.json'), JSON.stringify({ status: 'passed', scope: 'synthetic loopback HTTP, actual PDF.js and TipTap/Y.Doc; no Garden persistence', requests, observations, errors }, null, 2) + '\n')
  console.log(JSON.stringify({ status: 'passed', output, requests: requests.length, observations: observations.length }))
} catch (error) {
  writeFileSync(resolve(output, 'receipt.json'), JSON.stringify({ status: 'failed', error: String(error), requests, observations, errors }, null, 2) + '\n')
  console.error(JSON.stringify({ status: 'failed', output, errors }))
  throw error
} finally {
  clearTimeout(deadline)
  await browser?.close()
  await server.close()
}
