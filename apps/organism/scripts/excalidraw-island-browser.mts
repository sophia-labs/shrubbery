/**
 * The drawing island in a real browser, on the one Excalidraw version of the repo (0.18.0-4ce38fb): the runtime's real
 * `mountExcalidrawRuntime`, the real editor in Chromium, a drawing made with the pointer, saved through the runtime's save callback,
 * and loaded again into a fresh island. Not the app, not a graph: the artifact callbacks hold the bytes in memory.
 *
 *   pnpm --filter @shrubbery/organism exec tsx scripts/excalidraw-island-browser.mts
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { createServer, type Plugin } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeDir = resolve(appDir, '../../packages/runtime')
const dependencyRoot = realpathSync(resolve(appDir, 'node_modules/vite')).split(`${sep}node_modules${sep}`)[0]!
const output = mkdtempSync(resolve(tmpdir(), 'excalidraw-island-'))
const port = 5417

const entryId = '/island-entry.ts', resolvedEntry = '\0island-entry.ts'
const entry = String.raw`
import { mountExcalidrawRuntime } from '/src/excalidraw/excalidraw-runtime.ts'
let saved = null
const mount = (host) => {
  Object.assign(host, { graphId: 'g', artifactId: 'drawing', status: 'idle', error: '', saveStatus: 'idle', projectionStatus: 'idle', syncStatus: 'idle',
    hydrateStatus: 'idle', liveMessage: '', nodeLinkPickerOpen: false, projection: null, diagnostics: [], selectedElement: null, wireSummary: null })
  return mountExcalidrawRuntime(host, {
    scope: { graphId: 'g', artifactId: 'drawing' },
    artifacts: {
      load: async () => saved,
      save: async (request) => { saved = request.json },
    },
  })
}
window.__island = {
  hosts: [],
  open() {
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0'
    document.body.replaceChildren(host)
    const handle = mount(host)
    this.hosts.push(host)
    window.__handle = handle
    return handle.ready.then(() => 'ready')
  },
  elements: () => window.__handle.api.getSceneElements().map((e) => ({ type: e.type, w: Math.round(e.width), h: Math.round(e.height), deleted: e.isDeleted })),
  save: () => window.__handle.save().then(() => saved && JSON.parse(saved).elements.length),
  close: () => { window.__handle.destroy() },
  saved: () => saved && JSON.parse(saved).source,
}
`
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Excalidraw island witness</title><style>html,body{margin:0;height:100%}</style></head><body><script type="module" src="${entryId}"></script></body></html>`
const plugin: Plugin = {
  name: 'island-proof',
  resolveId: (id) => (id === entryId ? resolvedEntry : null),
  load: (id) => (id === resolvedEntry ? entry : null),
  configureServer(server) { server.middlewares.use((req, res, next) => { if (new URL(req.url ?? '/', 'http://x').pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return } next() }) },
}
const server = await createServer({ root: runtimeDir, configFile: false, plugins: [plugin], server: { host: '127.0.0.1', port, strictPort: true, hmr: false, fs: { allow: [resolve(appDir, '../..'), dependencyRoot] } }, logLevel: 'warn', resolve: { dedupe: ['react', 'react-dom'] }, optimizeDeps: { include: ['react', 'react-dom/client', '@excalidraw/excalidraw'] } })
let browser: Browser | null = null
const errors: string[] = []
const deadline = setTimeout(() => { void browser?.close(); void server.close() }, 150_000)
const observations: Record<string, unknown> = {}
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  page.setDefaultTimeout(30_000)
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => (window as any).__island)
  observations.ready = await page.evaluate(() => (window as any).__island.open())
  const canvas = page.locator('.excalidraw').first()
  await canvas.waitFor()
  const box = (await page.locator('canvas.interactive').first().boundingBox())!
  observations.canvas = { w: Math.round(box.width), h: Math.round(box.height) }
  await page.screenshot({ path: resolve(output, '1-empty.png') })

  // Pointer input: pick the rectangle tool by key, drag one out; then an ellipse.
  await page.mouse.click(box.x + 400, box.y + 300)
  await page.keyboard.press('r')
  await page.mouse.move(box.x + 300, box.y + 250); await page.mouse.down(); await page.mouse.move(box.x + 450, box.y + 330, { steps: 8 }); await page.mouse.up()
  await page.keyboard.press('o')
  await page.mouse.move(box.x + 520, box.y + 260); await page.mouse.down(); await page.mouse.move(box.x + 640, box.y + 360, { steps: 8 }); await page.mouse.up()
  const drawn = await page.evaluate(() => (window as any).__island.elements())
  observations.drawn = drawn
  if (!drawn.some((e: any) => e.type === 'rectangle' && e.w > 100) || !drawn.some((e: any) => e.type === 'ellipse')) throw new Error(`pointer input did not draw: ${JSON.stringify(drawn)}`)
  await page.screenshot({ path: resolve(output, '2-drawn.png') })

  // Save, destroy the island, mount a fresh one: the drawing is back.
  observations.savedElements = await page.evaluate(() => (window as any).__island.save())
  observations.savedSource = await page.evaluate(() => (window as any).__island.saved())
  await page.evaluate(() => (window as any).__island.close())
  await page.evaluate(() => (window as any).__island.open())
  await page.locator('.excalidraw').first().waitFor()
  const back = await page.evaluate(() => (window as any).__island.elements())
  observations.reloaded = back
  if (JSON.stringify(back.map((e: any) => [e.type, e.w, e.h])) !== JSON.stringify(drawn.map((e: any) => [e.type, e.w, e.h]))) throw new Error('the reloaded drawing is not the drawn one')
  await page.screenshot({ path: resolve(output, '3-reloaded.png') })
  // The Tab order inside the editor is the editor's; what we assert here is that the island took input and kept it.
  if (errors.length) throw new Error(errors.join('\n'))
  writeFileSync(resolve(output, 'receipt.json'), JSON.stringify({ status: 'passed', observations }, null, 2) + '\n')
  console.log(JSON.stringify({ status: 'passed', output, observations }))
} catch (error) {
  writeFileSync(resolve(output, 'receipt.json'), JSON.stringify({ status: 'failed', error: String(error), observations, errors }, null, 2) + '\n')
  console.error(JSON.stringify({ status: 'failed', output, error: String(error), observations, errors }))
  process.exitCode = 1
} finally {
  clearTimeout(deadline); await browser?.close(); await server.close()
}
