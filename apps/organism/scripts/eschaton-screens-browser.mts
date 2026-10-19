/**
 * eschaton-screens-browser.mts — screenshots of the merged PR features in the real app against a real gardend:
 * #5 the three-step wire flow, #6 the value gutter with the Appearance setting on (and off), #7 zen mode and zen in a split.
 * Not a gate: it writes PNGs to SCREENS_DIR and prints what it saw.
 *   GARDEN_BIN=<gardend> SCREENS_DIR=<dir> SHRUBBERY_BROWSER_ENGINE=webkit pnpm -C apps/organism exec tsx scripts/eschaton-screens-browser.mts
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { chromium, webkit, type Page } from 'playwright'
import { createServer } from 'vite'
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopbackPath = resolve(appDir, '.gardend-loopback.json')
const port = Number(process.env.SHRUBBERY_SCREENS_PORT ?? 5311)
const engineName = process.env.SHRUBBERY_BROWSER_ENGINE ?? 'webkit'
const engine = engineName === 'webkit' ? webkit : chromium
const outDir = process.env.SCREENS_DIR ?? resolve(appDir, 'screens')
mkdirSync(outDir, { recursive: true })
const GRAPH_ID = 'eschaton-screens'
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
const seen: Record<string, unknown> = { engine: engineName }

async function openDoc(page: Page, id: string, paragraphs = 1): Promise<void> {
  await page.evaluate((documentId) => {
    const panel = document.querySelector('mn-sidebar-panel') as HTMLElement | null
    ;(panel?.shadowRoot?.querySelector(`[data-node-id="${documentId}"]`) as HTMLElement | null)?.click()
  }, id)
  await page.waitForFunction((n) => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    return (host?.shadowRoot?.querySelectorAll('.editor-mount [contenteditable="true"] > p').length ?? 0) >= n
  }, paragraphs, { timeout: 60_000 })
  await page.waitForTimeout(1000)
}

async function boot(settings: Record<string, unknown>) {
  const page = await browser!.newPage({ viewport: { width: 1512, height: 944 } })
  await page.addInitScript((s) => {
    localStorage.setItem('shrubbery.organism.settings.v1', JSON.stringify(s))
  }, settings)
  await page.goto(`http://127.0.0.1:${port}/g/${GRAPH_ID}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.organismMode === 'local-cell', undefined, { timeout: 60_000 })
  await page.waitForFunction(
    () => !!document.querySelector('mn-sidebar-panel')?.shadowRoot?.querySelector('[data-file-pane-body]'),
    undefined, { timeout: 60_000 })
  return page
}

async function clickParagraph(page: Page, index: number): Promise<void> {
  const point = await page.evaluate((i) => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    const p = host?.shadowRoot?.querySelectorAll('.editor-mount [contenteditable="true"] > p')[i] as HTMLElement | undefined
    const r = p?.getBoundingClientRect()
    return r ? { x: r.left + 150, y: r.top + r.height / 2 } : null
  }, index)
  if (!point) throw new Error('no paragraph')
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(500)
}

async function hoverParagraph(page: Page, index: number): Promise<void> {
  await page.mouse.move(700, 900)
  await page.waitForTimeout(400)
  const point = await page.evaluate((i) => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    const p = host?.shadowRoot?.querySelectorAll('.editor-mount [contenteditable="true"] > p')[i] as HTMLElement | undefined
    const r = p?.getBoundingClientRect()
    return r ? { x: r.right + 12, y: r.top + r.height / 2, left: r.left + 20 } : null
  }, index)
  if (!point) throw new Error('no paragraph')
  await page.mouse.move(point.x, point.y)
  await page.waitForTimeout(800)
}

try {
  const bin = resolveGardendBin()
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000 })
  const mcp = new LoopbackMcpClient({ mcpUrl: cell.mcpUrl, healthUrl: `${cell.apiUrl}/health`, token: cell.token, origin: 'http://127.0.0.1' })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'eschaton screens' })
  for (const [id, title, body] of [
    ['notes', 'Field notes', '<p>Information is alive.</p><p>A reader who rates a block says it still matters.</p><p>Wires start at the block they are typed in.</p>'],
    ['essay', 'Essay', '<p>Because the page is a living thing, the essay begins here.</p><p>The second paragraph is the one that points elsewhere.</p>'],
    ['other', 'Another page', '<p>A page in the other half of the split.</p>'],
  ] as const) {
    await mcp.toolsCall('create_document', { graphId: GRAPH_ID, documentId: id, title })
    await mcp.toolsCall('write_document', { graphId: GRAPH_ID, documentId: id, content: body })
  }
  writeFileSync(loopbackPath, JSON.stringify({ apiUrl: cell.apiUrl, mcpUrl: cell.mcpUrl, token: cell.token, port: cell.manifest.port, graphId: GRAPH_ID }, null, 2))
  server = await createServer({ root: appDir, configFile: resolve(appDir, 'vite.config.ts'), server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, logLevel: 'warn' })
  await server.listen()
  browser = await engine.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })

  // #6 setting OFF (default): today's gutter
  {
    const page = await boot({})
    await openDoc(page, 'notes', 3)
    await hoverParagraph(page, 1)
    seen.gutterOffRenewButton = await page.evaluate(() => !!(document.querySelector('sh-editor-host') as HTMLElement | null)?.shadowRoot?.querySelector('[data-salience-renew]'))
    await page.screenshot({ path: `${outDir}/6-gutter-default-off-${engineName}.png` })
    await page.close()
  }
  // #6 setting ON
  {
    const page = await boot({ valueGutter: true })
    await openDoc(page, 'notes', 3)
    await page.screenshot({ path: `${outDir}/6-gutter-on-resting-${engineName}.png` })
    await hoverParagraph(page, 1)
    seen.gutterOnRenewButton = await page.evaluate(() => !!(document.querySelector('sh-editor-host') as HTMLElement | null)?.shadowRoot?.querySelector('[data-salience-renew]'))
    await page.screenshot({ path: `${outDir}/6-gutter-on-hover-${engineName}.png` })
    await page.close()
  }
  // #5 the three-step wire flow
  {
    const page = await boot({})
    await openDoc(page, 'essay', 2)
    await clickParagraph(page, 1)
    await page.keyboard.press(`${mod}+;`)
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${outDir}/5-wire-step1-document-${engineName}.png` })
    await page.keyboard.type('Field')
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${outDir}/5-wire-step1-typed-${engineName}.png` })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1800)
    await page.screenshot({ path: `${outDir}/5-wire-step2-block-${engineName}.png` })
        await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${outDir}/5-wire-step3-predicate-${engineName}.png` })
    await page.close()
  }
  // #7 zen, and zen in a split
  {
    const page = await boot({})
    await openDoc(page, 'essay', 2)
    await clickParagraph(page, 0)
    await page.screenshot({ path: `${outDir}/7-before-zen-${engineName}.png` })
    await page.keyboard.press(`${mod}+\\`)
    await page.waitForTimeout(900)
    seen.zenAttr = await page.evaluate(() => document.documentElement.dataset.zen ?? document.body.dataset.zen ?? null)
    await page.screenshot({ path: `${outDir}/7-zen-${engineName}.png` })
    await page.keyboard.press(`${mod}+\\`)
    await page.waitForTimeout(600)
    seen.splitDispatched = await page.evaluate(() => {
      const sw = document.querySelector('mn-document-switcher')
      if (!sw) return false
      sw.dispatchEvent(new CustomEvent('mn-document-switcher-open-document-split', { detail: { graphId: 'eschaton-screens', documentId: 'other' } }))
      return true
    })
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${outDir}/7-split-${engineName}.png` })
    await page.keyboard.press(`${mod}+\\`)
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${outDir}/7-zen-in-split-${engineName}.png` })
    await page.close()
  }
  console.log(JSON.stringify(seen, null, 2))
} finally {
  await browser?.close()
  await server?.close()
  await cell?.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
}
