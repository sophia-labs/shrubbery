/**
 * value-gutter-zone-browser.mts — does the value gutter's hover zone stay off
 * the text?
 *
 * REPORTED: "value gutter hover zone needs to be further right. it blocks right
 * side of typing line".
 *
 * `_salienceHitForEvent` opens the gutter when the pointer is within 24px of a
 * block's RIGHT edge, measured inside the block. Blocks carry 8px of right
 * padding. So on any line that runs to the edge, 16px of the hover zone lies
 * over text, and the popover opens at the pointer, on top of that text.
 *
 * Measured here on a paragraph long enough to wrap, so its lines reach the
 * right edge:
 *
 *   1. how far the text reaches, against where the hover zone begins;
 *   2. hovering ON the last characters of a full line must NOT open the gutter;
 *   3. hovering in the zone MUST open it (the fix must not just delete it);
 *   4. the opened popover must not cover the text column.
 *
 *   pnpm -C apps/organism run test:value-gutter-zone
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopbackPath = resolve(appDir, '.gardend-loopback.json')
const port = Number(process.env.SHRUBBERY_GUTTER_ZONE_PORT ?? 5285)
const engineName = process.env.SHRUBBERY_BROWSER_ENGINE ?? 'chromium'
if (engineName !== 'chromium' && engineName !== 'webkit') {
  throw new Error('SHRUBBERY_BROWSER_ENGINE must be chromium or webkit')
}
const engine = engineName === 'webkit' ? webkit : chromium
const GRAPH_ID = 'value-gutter-zone-probe'
const DOC_ID = 'zone-doc'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`value-gutter-zone-browser assertion failed: ${message}`)
}

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null

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
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'gutter zone probe' })
  await mcp.toolsCall('create_document', { graphId: GRAPH_ID, documentId: DOC_ID, title: 'Gutter zone probe' })
  const long = 'Every line of this paragraph runs all the way to the right edge of the text column, '
    .repeat(6)
  await mcp.toolsCall('write_document', {
    graphId: GRAPH_ID,
    documentId: DOC_ID,
    content: `<p>${long}</p><p>A short second paragraph.</p>`,
  })

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
  page.on('pageerror', error => console.error(`[pageerror] ${error.message}`))
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

  const geometry = await page.evaluate(() => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    const paragraph = host?.shadowRoot?.querySelector('.editor-mount [contenteditable="true"] > p') as HTMLElement | null
    if (!paragraph) return null
    const block = paragraph.getBoundingClientRect()
    // The text's real right edge: the widest line box of the paragraph's text.
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const lines = Array.from(range.getClientRects()).filter(r => r.width > 40)
    const textRight = Math.max(...lines.map(r => r.right))
    // A line in the middle of the paragraph, well clear of the first and last.
    const middle = lines[Math.floor(lines.length / 2)]!
    // Where text CAN reach, not where it happened to: the content box's right
    // edge. Lines wrap raggedly, so the widest line of any one fixture may stop
    // well short of it — an earlier run measured a 24px gap by chance of where
    // words broke and passed for that reason alone.
    const contentRight = block.right - parseFloat(getComputedStyle(paragraph).paddingRight || '0')
    return {
      blockRight: Math.round(block.right),
      textRight: Math.round(Math.max(textRight, contentRight)),
      raggedTextRight: Math.round(textRight),
      lineY: Math.round(middle.top + middle.height / 2),
      lineCount: lines.length,
    }
  })
  assert(geometry, 'the long paragraph rendered')
  assert(geometry!.lineCount >= 3, `the paragraph wraps, so its lines reach the edge: ${geometry!.lineCount} lines`)
  console.log(`${engineName} geometry:`, JSON.stringify(geometry))

  const gutterOpen = (): Promise<{ open: boolean; left: number | null }> => page.evaluate(() => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    const gutter = host?.shadowRoot?.querySelector('.salience-gutter') as HTMLElement | null
    return { open: !!gutter, left: gutter ? Math.round(gutter.getBoundingClientRect().left) : null }
  })

  // (2) On the last characters of a full line.
  await page.mouse.move(geometry!.textRight - 4, geometry!.lineY)
  await page.waitForTimeout(500)
  const onText = await gutterOpen()
  console.log('hover on the last characters of a line:', JSON.stringify(onText))

  await page.mouse.move(700, 900)
  await page.waitForTimeout(600)

  // (3) In the zone: the strip just past the block's right edge, in the editor
  // sheet's right padding, where there is never any text.
  const zoneX = geometry!.blockRight + 12
  await page.mouse.move(zoneX, geometry!.lineY)
  await page.waitForTimeout(500)
  const inZone = await gutterOpen()
  console.log(`hover in the zone (x=${zoneX}):`, JSON.stringify(inZone))

  const failures: string[] = []
  if (onText.open) failures.push('hovering the last characters of a line opened the value gutter over the text')
  if (!inZone.open) failures.push(`hovering the zone at x=${zoneX} did not open the value gutter`)
  if (inZone.open ? (inZone.left ?? 0) < geometry!.textRight : false) {
    failures.push(`the opened gutter covers the text column: its left edge ${inZone.left} is inside text reaching ${geometry!.textRight}`)
  }
  assert(failures.length === 0, failures.join('; '))
  console.log('\nThe value gutter opens beside the text, never on it.')
} finally {
  await browser?.close()
  await server?.close()
  await cell?.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
}
