/**
 * value-gutter-renew-browser.mts — does the value gutter's renew button move a
 * block's clock, and only its clock?
 *
 * ASKED FOR: a button that says "this still matters" by renewing a block's
 * freshness (lastValuatedAt) without changing the reader's rating, which is one
 * replaceable slot. The cell route is POST /salience/{graph}/blocks/renew
 * (garden 7afad36). It refuses a block with no value and a block rated 0.
 *
 * The run, in the real app against a real gardend (the binary must include
 * 7afad36; point GARDEN_BIN at it):
 *   1. an unvalued block: the renew button is disabled and says to rate first;
 *   2. rate a block (importance 3) through the gutter;
 *   3. renew it: lastValuatedAt moves forward, and the rating is unchanged;
 *   4. rate it 0 ("let go"): renew is disabled and says why.
 *
 *   GARDEN_BIN=<gardend with 7afad36> SHRUBBERY_BROWSER_ENGINE=webkit \
 *     pnpm -C apps/organism run test:value-gutter-renew
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { chromium, webkit, type Page } from 'playwright'
import { createServer } from 'vite'
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopbackPath = resolve(appDir, '.gardend-loopback.json')
const port = Number(process.env.SHRUBBERY_GUTTER_RENEW_PORT ?? 5299)
const engineName = process.env.SHRUBBERY_BROWSER_ENGINE ?? 'chromium'
if (engineName !== 'chromium' && engineName !== 'webkit') {
  throw new Error('SHRUBBERY_BROWSER_ENGINE must be chromium or webkit')
}
const engine = engineName === 'webkit' ? webkit : chromium
const GRAPH_ID = 'value-gutter-renew-probe'
const DOC_ID = 'renew-doc'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`value-gutter-renew-browser assertion failed: ${message}`)
}

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null

interface RestScore {
  readonly blockId: string
  readonly userImportance: number | null
  readonly lastValuatedAt: string | null
}

interface RenewButton {
  readonly disabled: boolean
  readonly title: string
}

/** Open the gutter beside paragraph `index` by hovering its zone. */
async function openGutter(page: Page, index: number): Promise<void> {
  await page.mouse.move(700, 900)
  await page.waitForTimeout(500)
  const point = await page.evaluate((i) => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    const paragraph = host?.shadowRoot?.querySelectorAll('.editor-mount [contenteditable="true"] > p')[i] as HTMLElement | undefined
    const rect = paragraph?.getBoundingClientRect()
    return rect ? { x: rect.right + 12, y: rect.top + rect.height / 2 } : null
  }, index)
  assert(point, `paragraph ${index} is on screen`)
  await page.mouse.move(point.x, point.y)
  await page.waitForFunction(
    () => !!(document.querySelector('sh-editor-host') as HTMLElement | null)?.shadowRoot?.querySelector('.salience-gutter'),
    undefined,
    { timeout: 5_000 },
  )
}

function renewButton(page: Page): Promise<RenewButton | null> {
  return page.evaluate(() => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    const button = host?.shadowRoot?.querySelector('.salience-gutter [data-salience-renew]') as HTMLButtonElement | null
    return button ? { disabled: button.disabled, title: button.title } : null
  })
}

/** Click a gutter button: 1 is importance, 'renew' is renew. */
async function clickGutter(page: Page, which: 'importance' | 'renew'): Promise<void> {
  await page.evaluate((target) => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    const gutter = host?.shadowRoot?.querySelector('.salience-gutter')
    const button = target === 'renew'
      ? gutter?.querySelector('[data-salience-renew]')
      : gutter?.querySelectorAll('.salience-gutter-icon')[1]
    ;(button as HTMLButtonElement | null)?.click()
  }, which)
  await page.waitForTimeout(700)
}

try {
  const bin = resolveGardendBin()
  assert(existsSync(bin), `real gardend binary at ${bin}`)
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000 })
  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'gutter renew probe' })
  await mcp.toolsCall('create_document', { graphId: GRAPH_ID, documentId: DOC_ID, title: 'Gutter renew probe' })
  await mcp.toolsCall('write_document', {
    graphId: GRAPH_ID,
    documentId: DOC_ID,
    content: '<p>The block the reader rates, renews, and then lets go.</p><p>A block nobody has valued.</p>',
  })
  const scores = async (): Promise<RestScore[]> => {
    const raw = await mcp.getJson<{ blocks?: RestScore[] }>(
      `/salience/${GRAPH_ID}/blocks/values?document_id=${DOC_ID}&limit=100`,
    )
    return raw.blocks ?? []
  }

  writeFileSync(loopbackPath, JSON.stringify({
    apiUrl: cell.apiUrl,
    mcpUrl: cell.mcpUrl,
    token: cell.token,
    port: cell.manifest.port,
    graphId: GRAPH_ID,
  }, null, 2))
  server = await createServer({
    root: appDir,
    configFile: resolve(appDir, 'vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
    logLevel: 'warn',
  })
  await server.listen()

  browser = await engine.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
  const page = await browser.newPage({ viewport: { width: 1512, height: 944 } })
  const errors: string[] = []
  // The revised gutter is Appearance > Value markers beside the text, off by default.
  await page.addInitScript(() => {
    localStorage.setItem('shrubbery.organism.settings.v1', JSON.stringify({ valueGutter: true }))
  })
  page.on('pageerror', error => errors.push(error.message.slice(0, 200)))
  page.on('console', message => {
    if (/salience (renew|rate) error/.test(message.text())) errors.push(message.text().slice(0, 300))
  })
  await page.goto(`http://127.0.0.1:${port}/g/${GRAPH_ID}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.organismMode === 'local-cell', undefined, { timeout: 60_000 })
  await page.waitForFunction(
    () => !!document.querySelector('mn-sidebar-panel')?.shadowRoot?.querySelector('[data-file-pane-body]'),
    undefined,
    { timeout: 60_000 },
  )
  await page.evaluate((documentId) => {
    const panel = document.querySelector('mn-sidebar-panel') as HTMLElement | null
    const row = panel?.shadowRoot?.querySelector(`[data-node-id="${documentId}"]`) as HTMLElement | null
    row?.click()
  }, DOC_ID)
  await page.waitForFunction(() => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    return (host?.shadowRoot?.querySelectorAll('.editor-mount [contenteditable="true"] > p').length ?? 0) >= 2
  }, undefined, { timeout: 60_000 })
  await page.waitForTimeout(1200)
  const log: Record<string, unknown> = { engine: engineName }

  // 1. Unvalued: disabled, says to rate first.
  await openGutter(page, 1)
  const unvalued = await renewButton(page)
  log.unvalued = unvalued
  assert(unvalued, 'the gutter has a renew button')
  assert(unvalued.disabled, 'renew is disabled on an unvalued block')
  assert(/rate this block first/i.test(unvalued.title), `the unvalued tooltip says to rate first (${unvalued.title})`)

  // 2. Rate importance 3.
  await openGutter(page, 0)
  await clickGutter(page, 'importance')
  const rated = (await scores()).find(score => score.userImportance === 3)
  log.rated = rated
  assert(rated?.lastValuatedAt, `rating stamped the clock (${JSON.stringify(rated)})`)
  const ratedButton = await renewButton(page)
  assert(ratedButton ? !ratedButton.disabled : false, `renew is enabled on a rated block (${JSON.stringify(ratedButton)})`)

  // 3. Renew: the clock moves, the rating does not.
  await page.waitForTimeout(50)
  await clickGutter(page, 'renew')
  const renewed = (await scores()).find(score => score.blockId === rated.blockId)
  log.renewed = renewed
  assert(renewed, 'the block is still scored after renewing')
  assert(Number(renewed.lastValuatedAt) > Number(rated.lastValuatedAt), `renew moved the clock (${rated.lastValuatedAt} -> ${renewed.lastValuatedAt})`)
  assert(renewed.userImportance === 3, `renew left the rating alone (${renewed.userImportance})`)

  // 4. Let go (3 -> 5 -> 0): renew disabled, says why.
  await clickGutter(page, 'importance')
  await clickGutter(page, 'importance')
  const letGo = (await scores()).find(score => score.blockId === rated.blockId)
  assert(letGo?.userImportance === 0, `the block is rated 0 (${letGo?.userImportance})`)
  const letGoButton = await renewButton(page)
  log.letGo = letGoButton
  assert(letGoButton?.disabled, 'renew is disabled on a block rated 0')
  assert(/let go/i.test(letGoButton?.title ?? ''), `the let-go tooltip says why (${letGoButton?.title})`)

  assert(errors.length === 0, `no page or salience errors: ${errors.join(' | ')}`)
  console.log(JSON.stringify(log, null, 2))
  console.log('\nRenew moves only the clock, and refuses what the cell refuses.')
} finally {
  await browser?.close()
  await server?.close()
  await cell?.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
}
