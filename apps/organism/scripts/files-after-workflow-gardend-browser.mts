/**
 * Files after a workflow, in a real Chromium against a real gardend (no mocks).
 *
 * A workflow plan in the main pane is hidden, never closed, while a document is open, and the Files route yields to it. Every way
 * into Files (a folder click in the sidebar, the Files action of the tree's header, a file revealed) must therefore close the plan:
 * before, the pane opened and was told to leave in the same render, so the click did nothing and the canvas was gone for good.
 *
 *   node --import tsx scripts/files-after-workflow-gardend-browser.mts        (exit 1 on any failed check)
 */
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { createGraphAndSeedUxConfig, resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const graphId = 'files-after-workflow-proof'
const port = Number(process.env.FILES_AFTER_WORKFLOW_PORT ?? 5254)
const shots = process.env.SHOTS_DIR
if (shots) mkdirSync(shots, { recursive: true })
const require_ = createRequire(import.meta.url)
const seedPath = resolve(dirname(require_.resolve('@shrubbery/nucleus')), 'workspace/__generated__/garden-default.ux.nt')

let failed = 0
const check = (name: string, ok: boolean, detail?: unknown): void => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`)
}

let cell: GardendCell | null = null
let server: ViteDevServer | null = null
let browser: Browser | null = null
let loopbackPath: string | null = null
const previousLoopbackManifest = process.env.GARDEND_LOOPBACK_MANIFEST
const pageErrors: string[] = []

try {
  const binary = resolveGardendBin()
  if (!existsSync(binary)) throw new Error(`no gardend at ${binary}`)
  cell = await spawnGardend({ bin: binary, readyTimeoutMs: 30_000 })
  loopbackPath = join(cell.profileDir, 'vite-loopback.json')
  process.env.GARDEND_LOOPBACK_MANIFEST = loopbackPath
  await createGraphAndSeedUxConfig(cell, graphId, readFileSync(seedPath, 'utf8'))
  const mcp = new LoopbackMcpClient({ mcpUrl: cell.mcpUrl, healthUrl: `${cell.apiUrl}/health`, token: cell.token, origin: 'http://127.0.0.1' })
  await mcp.toolsCall('create_folder', { graphId, folderId: 'fld-kitchen', name: 'Kitchen', section: 'documents' })
  await mcp.toolsCall('create_document', { graphId, documentId: 'doc-plan', title: 'Plan', parentId: 'fld-kitchen' })
  await mcp.toolsCall('write_document', { graphId, documentId: 'doc-plan', content: 'a plan' })
  await mcp.toolsCall('workflow_plan_create', { graphId, title: 'Soup, step by step' })
  writeFileSync(loopbackPath, JSON.stringify({ apiUrl: cell.apiUrl, mcpUrl: cell.mcpUrl, token: cell.token, port: cell.manifest.port, graphId }, null, 2))

  server = await createServer({ root: appDir, configFile: resolve(appDir, 'vite.config.ts'), server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, logLevel: 'warn' })
  await server.listen()
  browser = await chromium.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
  const page: Page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  page.on('pageerror', error => pageErrors.push(error.message))
  if (process.env.DEBUG_CONSOLE) page.on('console', m => console.log('  [page]', m.text().slice(0, 200)))
  const shot = async (name: string) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`) }) }
  const row = (label: string) => page.locator('mn-sidebar-panel [role=treeitem]', { hasText: label }).first()
  const canvasCards = () => page.locator('mn-files-canvas .card').count()
  const filesOpen = async (): Promise<boolean> => {
    try { await page.waitForSelector('mn-files-canvas', { timeout: 6000 }); return true } catch { return false }
  }
  const workflowOpen = async (): Promise<boolean> => (await page.locator('text=WHAT KEEPS IT FROM RUNNING, text=Nothing here yet').count()) > 0
    || (await page.getByText('Soup, step by step').count()) > 1

  await page.goto(`http://127.0.0.1:${port}/?source=cell&graph=${encodeURIComponent(graphId)}`, { waitUntil: 'domcontentloaded' })
  await row('Soup, step by step').waitFor({ state: 'visible', timeout: 60_000 })
  await row('Kitchen').waitFor({ state: 'visible', timeout: 30_000 })

  // 1. A workflow is open; a folder click opens Files.
  await row('Soup, step by step').click()
  await page.waitForTimeout(1500)
  check('a workflow is open (no Files canvas yet)', (await page.locator('mn-files-canvas').count()) === 0 && await workflowOpen())
  await shot('1-workflow')
  await row('Kitchen').click()
  check('a folder click while a workflow is open opens the Files canvas', await filesOpen())
  check('the canvas shows the folder\'s document', (await page.locator('mn-files-canvas .card', { hasText: 'Plan' }).count()) === 1, await canvasCards())
  await shot('2-folder-after-workflow')

  // 2. The workflow is behind a document: open a document, then a folder (the plan reappears when the document closes).
  await row('Soup, step by step').click()
  await page.waitForTimeout(1200)
  await row('Plan').click().catch(async () => { await row('Kitchen').click(); await row('Plan').click() })
  await page.waitForTimeout(1500)
  check('a document is open, the Files canvas is gone', (await page.locator('mn-files-canvas').count()) === 0)
  await row('Kitchen').click()
  check('a folder click from a document, after a workflow, opens the canvas', await filesOpen())
  await shot('3-folder-after-doc-after-workflow')

  // 3. The Files action of the tree's header, from a workflow (a fresh load: the person's other routes are not in play).
  await page.goto(`http://127.0.0.1:${port}/?source=cell&graph=${encodeURIComponent(graphId)}`, { waitUntil: 'domcontentloaded' })
  await row('Soup, step by step').waitFor({ state: 'visible', timeout: 60_000 })
  await row('Soup, step by step').click()
  await page.waitForTimeout(1500)
  await row('Soup, step by step').hover()
  await page.locator('mn-sidebar-panel button.section-action[data-action-id="open-files"]').first().click()
  check('the Files action opens the canvas from a workflow', await filesOpen())
  await shot('4-section-action-after-workflow')

  // 4. The same action from a plain start (no workflow anywhere): it is a way in on its own.
  await page.goto(`http://127.0.0.1:${port}/?source=cell&graph=${encodeURIComponent(graphId)}`, { waitUntil: 'domcontentloaded' })
  await row('Kitchen').waitFor({ state: 'visible', timeout: 60_000 })
  check('a fresh load shows no Files canvas', (await page.locator('mn-files-canvas').count()) === 0)
  await page.locator('mn-sidebar-panel button.section-action[data-action-id="open-files"]').first().click()
  check('the Files action opens the canvas from a plain start', await filesOpen())

  check('no page errors', pageErrors.length === 0, pageErrors)
} catch (error) {
  failed++
  console.log(`FAIL ${(error as Error).stack ?? error}`)
} finally {
  await browser?.close().catch(() => undefined)
  await server?.close().catch(() => undefined)
  if (loopbackPath && existsSync(loopbackPath)) unlinkSync(loopbackPath)
  if (previousLoopbackManifest === undefined) delete process.env.GARDEND_LOOPBACK_MANIFEST
  else process.env.GARDEND_LOOPBACK_MANIFEST = previousLoopbackManifest
  await cell?.kill().catch(() => undefined)
}
process.exit(failed ? 1 : 0)
