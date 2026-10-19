/**
 * editor-arrow-across-blocks-browser.mts — can the caret cross a block boundary
 * with the arrow keys?
 *
 * REPORTED: "you can't click left on keyboard at the start of a block to go to
 * the previous block".
 *
 * SUSPECT. `block-dnd.ts` inserts a drag handle into EVERY block, as a widget at
 * `block.pos + 1` — inside the block, before its first character — and the
 * handle is `contenteditable="false"`. `margin-gloss.ts` does the same on wired
 * blocks. A non-editable inline element at offset 0 is a known caret trap: the
 * browser's native Left arrow runs into it and stops, instead of moving into
 * the previous block.
 *
 * This measures the four boundary moves a writer makes and reports which
 * paragraph holds the caret after each one. The paragraph is read from the
 * DOM selection, not from ProseMirror, because the bug is the browser's.
 *
 *   pnpm -C apps/organism run test:editor-arrow-across-blocks
 *   SHRUBBERY_BROWSER_ENGINE=webkit pnpm -C apps/organism run test:editor-arrow-across-blocks
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
const port = Number(process.env.SHRUBBERY_ARROW_PORT ?? 5277)
const engineName = process.env.SHRUBBERY_BROWSER_ENGINE ?? 'chromium'
if (engineName !== 'chromium' && engineName !== 'webkit') {
  throw new Error('SHRUBBERY_BROWSER_ENGINE must be chromium or webkit')
}
const engine = engineName === 'webkit' ? webkit : chromium
const GRAPH_ID = 'editor-arrow-probe'
const DOC_ID = 'arrow-doc'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`editor-arrow-across-blocks-browser assertion failed: ${message}`)
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
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'arrow probe' })
  await mcp.toolsCall('create_document', { graphId: GRAPH_ID, documentId: DOC_ID, title: 'Arrow probe' })
  await mcp.toolsCall('write_document', {
    graphId: GRAPH_ID,
    documentId: DOC_ID,
    content: '<p>ALPHA first paragraph.</p><p>BRAVO second paragraph.</p><p>CHARLIE third paragraph.</p>',
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
    const paragraphs = host?.shadowRoot?.querySelectorAll('.editor-mount [contenteditable="true"] > p') ?? []
    return paragraphs.length >= 3
  }, undefined, { timeout: 60_000 })
  await page.waitForTimeout(1000)

  // Which paragraph the caret is in, read from the live DOM selection. The
  // editor is inside a shadow root, so the selection comes from the root when
  // the engine offers it there and from the document otherwise.
  // THE MEASURE THAT CANNOT BE RETARGETED: type a marker where the caret is,
  // see which paragraph received it, delete it. Selection APIs read from outside
  // a shadow root lie in WebKit (anchor = the host, offset 1, on every press);
  // a character landing in a paragraph is what the writer experiences, in any
  // engine.
  const caret = async (): Promise<{ block: string; offset: number; handles: number }> => {
    await page.keyboard.type('§')
    const found = await page.evaluate(() => {
      const host = document.querySelector('sh-editor-host') as HTMLElement | null
      const root = host?.shadowRoot ?? null
      const paragraphs = Array.from(root?.querySelectorAll('.editor-mount [contenteditable="true"] > p') ?? [])
      const hit = paragraphs.find(p => (p.textContent ?? '').includes('§'))
      const text = hit?.textContent ?? ''
      return {
        block: text.replace(/[^A-Z]/g, '').slice(0, 7) || '(none)',
        offset: text.indexOf('§'),
        handles: root?.querySelectorAll('.block-drag-handle').length ?? 0,
      }
    })
    await page.keyboard.press('Backspace')
    return found
  }
  // Put the caret at the very start of BRAVO: click in its text, then Home.
  const bravo = await page.evaluate(() => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    const paragraph = host?.shadowRoot?.querySelectorAll('.editor-mount [contenteditable="true"] > p')[1] as HTMLElement | undefined
    const rect = paragraph?.getBoundingClientRect()
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
  })
  assert(bravo, 'the second paragraph is on screen')

  // Line start / end. WebKit on macOS follows Mac text bindings, where Home and
  // End scroll the document and Cmd+Left / Cmd+Right move to the line edges. An
  // earlier run pressed Home there, started from the END of BRAVO, and reported
  // that Left "stayed in BRAVO" — correct behaviour, measured from the wrong place.
  const macBindings = engineName === 'webkit' ? process.platform === 'darwin' : false
  const LINE_START = macBindings ? 'Meta+ArrowLeft' : 'Home'
  const LINE_END = macBindings ? 'Meta+ArrowRight' : 'End'

  const results: Record<string, unknown> = {}

  await page.mouse.click(bravo!.x, bravo!.y)
  await page.keyboard.press(LINE_START)
  results.atStartOfBravo = await caret()
  await page.keyboard.press('ArrowLeft')
  results.afterOneLeft = await caret()
  await page.keyboard.press('ArrowLeft')
  results.afterTwoLefts = await caret()

  await page.mouse.click(bravo!.x, bravo!.y)
  await page.keyboard.press(LINE_END)
  results.atEndOfBravo = await caret()
  await page.keyboard.press('ArrowRight')
  results.afterOneRight = await caret()

  await page.mouse.click(bravo!.x, bravo!.y)
  await page.keyboard.press(LINE_START)
  await page.keyboard.press('ArrowUp')
  results.upFromStartOfBravo = await caret()

  console.log(`${engineName}:`, JSON.stringify(results, null, 2))

  const one = results.afterOneLeft as { block: string }
  const right = results.afterOneRight as { block: string }
  const up = results.upFromStartOfBravo as { block: string }
  const failures: string[] = []
  if (one.block !== 'ALPHA') failures.push(`one Left from the start of BRAVO landed in ${one.block}, not ALPHA`)
  if (right.block !== 'CHARLIE') failures.push(`one Right from the end of BRAVO landed in ${right.block}, not CHARLIE`)
  if (up.block !== 'ALPHA') failures.push(`Up from the start of BRAVO landed in ${up.block}, not ALPHA`)
  // THE DANGEROUS HALF. Before the fix, WebKit left the caret inside the drag
  // handle, and the Backspace this harness sends to remove its marker JOINED
  // ALPHA into BRAVO. Three blocks in, three blocks out, or a keypress in the
  // wrong place destroyed a paragraph boundary.
  const merged = Object.entries(results).filter(([, value]) => (value as { handles: number }).handles !== 3)
  if (merged.length > 0) failures.push(`a block boundary was destroyed during: ${merged.map(([name]) => name).join(', ')}`)
  assert(failures.length === 0, failures.join('; '))
  console.log('\nThe caret crosses block boundaries in both directions with one keypress.')
} finally {
  await browser?.close()
  await server?.close()
  await cell?.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
}
