/**
 * whiteboard-drop-persist-browser.mts — does what you put on a board survive leaving it?
 *
 * REPORTED (2026-10-22): "the document i dragged on to the whiteboard doesn't persist once i leave the whiteboard and
 * come back".
 *
 * THE CAUSE. The board's binding sends a change to the room 80 ms after the canvas reports it. Leaving the board ran
 * `closeWhiteboard()`, which released the room lease FIRST: the last release destroys the room's provider. The shell
 * then re-rendered, `<sh-whiteboard>` unmounted, and the binding's `destroy()` flushed the pending change into a doc
 * whose provider was already gone. The change never reached gardend, and coming back showed the server's older board.
 * The fix flushes every open board before the lease is released.
 *
 * The run, in the real app against a real gardend:
 *   1. an ordinary rectangle, drawn with the mouse, then leave and return              -> still there (the baseline)
 *   2. a card dragged from the sidebar with a real drag, then leave after a pause       -> still there
 *   3. a second card dropped with a DragEvent carrying `application/x-shrubbery-sidebar-node`, and the sidebar row
 *      for another document clicked IN THE SAME TASK (so the leave beats the 80 ms flush on any machine)
 *                                                                                       -> still there
 *   After each: the canvas has it, a reload has it, and gardend's `whiteboard_read` lists it.
 *
 *   SHRUBBERY_BROWSER_ENGINE=webkit pnpm -C apps/organism run test:whiteboard-drop-persist
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
const port = Number(process.env.SHRUBBERY_WBDROP_PORT ?? 5299)
const engineName = process.env.SHRUBBERY_BROWSER_ENGINE ?? 'chromium'
if (engineName !== 'chromium' && engineName !== 'webkit') {
  throw new Error('SHRUBBERY_BROWSER_ENGINE must be chromium or webkit')
}
const engine = engineName === 'webkit' ? webkit : chromium
const GRAPH_ID = 'wb-drop-persist-probe'
const DOC_A = 'drop-doc-a'
const DOC_B = 'drop-doc-b'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`whiteboard-drop-persist-browser assertion failed: ${message}`)
}

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null

/** The sidebar row for `id`, in the shell's shadow tree. */
const rowSelector = (id: string) => `mn-sidebar-panel [data-node-id="${id}"]`

async function waitForBoard(page: Page): Promise<void> {
  await page.locator('sh-whiteboard canvas.interactive').first().waitFor({ timeout: 90_000 })
  await page.waitForTimeout(1500)
}

/** Scene elements on the canvas, by type (deleted ones left out). */
/** Evaluated in the page as source text: the test runner's transpiler would otherwise inject helpers the page lacks. */
const FIND_BOARD = `const findBoard = (root) => {
  const direct = root.querySelector('sh-whiteboard')
  if (direct) return direct
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const inner = el.shadowRoot ? findBoard(el.shadowRoot) : null
    if (inner) return inner
  }
  return null
}`

function sceneTypes(page: Page): Promise<string[]> {
  return page.evaluate(`(() => { ${FIND_BOARD}
    const board = findBoard(document)
    return board && board.api ? board.api.getSceneElements().map((e) => e.type).sort() : []
  })()`) as Promise<string[]>
}

async function openBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`http://127.0.0.1:${port}/g/${GRAPH_ID}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.organismMode === 'local-cell', undefined, { timeout: 60_000 })
  await page.locator(rowSelector(boardId)).first().waitFor({ timeout: 60_000 })
  await page.locator(rowSelector(boardId)).first().click()
  await waitForBoard(page)
}

async function leaveAndReturn(page: Page, boardId: string): Promise<void> {
  await page.locator(rowSelector(DOC_B)).first().click()
  await page.waitForTimeout(1500)
  await page.locator(rowSelector(boardId)).first().click()
  await waitForBoard(page)
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
  const payload = (result: unknown): Record<string, unknown> => {
    const r = result as { structuredContent?: Record<string, unknown>; content?: Array<{ text?: string }> }
    if (r.structuredContent) return r.structuredContent
    try { return JSON.parse(r.content?.[0]?.text ?? '{}') as Record<string, unknown> } catch { return {} }
  }
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'whiteboard drop probe' })
  await mcp.toolsCall('create_document', { graphId: GRAPH_ID, documentId: DOC_A, title: 'Dropped document' })
  await mcp.toolsCall('write_document', { graphId: GRAPH_ID, documentId: DOC_A, content: '<p>Something to put on a board.</p>' })
  await mcp.toolsCall('create_document', { graphId: GRAPH_ID, documentId: DOC_B, title: 'Somewhere else' })
  await mcp.toolsCall('write_document', { graphId: GRAPH_ID, documentId: DOC_B, content: '<p>Leave the board for here.</p>' })
  const made = payload(await mcp.toolsCall('whiteboard_create', { graphId: GRAPH_ID, title: 'Drop board' }))
  const boardId = String(made.documentId ?? '')
  assert(boardId, 'whiteboard_create returned a documentId')

  const serverTypes = async (): Promise<string[]> => {
    const read = payload(await mcp.toolsCall('whiteboard_read', { graphId: GRAPH_ID, documentId: boardId, format: 'elements' }))
    const elements = (read.elements ?? []) as Array<{ type: string; isDeleted?: boolean }>
    return elements.filter((e) => !e.isDeleted).map((e) => e.type).sort()
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 200)))
  const steps: Record<string, unknown>[] = []

  const check = async (step: string, expected: string[]): Promise<void> => {
    const canvas = await sceneTypes(page)
    const stored = await serverTypes()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.body.dataset.organismMode === 'local-cell', undefined, { timeout: 60_000 })
    await waitForBoard(page)
    const reloaded = await sceneTypes(page)
    steps.push({ step, expected, canvas, stored, reloaded })
    assert(JSON.stringify(canvas) === JSON.stringify(expected), `${step}: after leaving and returning the canvas has ${expected.join(', ')}; it has ${canvas.join(', ') || 'nothing'}`)
    assert(JSON.stringify(stored) === JSON.stringify(expected), `${step}: gardend's elements are ${expected.join(', ')}; they are ${stored.join(', ') || 'empty'}`)
    assert(JSON.stringify(reloaded) === JSON.stringify(expected), `${step}: after a reload the canvas has ${expected.join(', ')}; it has ${reloaded.join(', ') || 'nothing'}`)
  }

  try {
    await openBoard(page, boardId)

    // 1. An ordinary rectangle, drawn with the mouse.
    await page.locator('sh-whiteboard [data-testid="toolbar-rectangle"]').first().click()
    const canvasBox = await page.locator('sh-whiteboard canvas.interactive').first().boundingBox()
    assert(canvasBox, 'the canvas has a box')
    await page.mouse.move(canvasBox.x + 300, canvasBox.y + 300)
    await page.mouse.down()
    await page.mouse.move(canvasBox.x + 420, canvasBox.y + 380, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    await leaveAndReturn(page, boardId)
    await check('rectangle', ['rectangle'])

    // 2. A card dragged from the sidebar with a real drag.
    await page.locator(rowSelector(DOC_A)).first().dragTo(page.locator('sh-whiteboard canvas.interactive').first(), { targetPosition: { x: 500, y: 450 } })
    await page.waitForTimeout(1000)
    await leaveAndReturn(page, boardId)
    await check('real drag', ['embeddable', 'rectangle'])

    // 3. A DragEvent drop, and the sidebar click in the same task: the leave cannot lose the race to the 80 ms flush.
    await page.locator(rowSelector(DOC_A)).first().waitFor()
    await page.evaluate(`(() => { ${FIND_BOARD}
      const board = findBoard(document)
      const stage = board.shadowRoot.querySelector('.stage')
      const rect = stage.getBoundingClientRect()
      const data = new DataTransfer()
      data.setData('application/x-shrubbery-sidebar-node', JSON.stringify({ id: ${JSON.stringify(DOC_A)}, kind: 'document' }))
      data.setData('text/plain', ${JSON.stringify(DOC_A)})
      const at = { clientX: rect.left + rect.width * 0.2, clientY: rect.top + rect.height * 0.7, bubbles: true, cancelable: true, composed: true, dataTransfer: data }
      stage.dispatchEvent(new DragEvent('dragover', at))
      stage.dispatchEvent(new DragEvent('drop', at))
      document.querySelector('mn-sidebar-panel').shadowRoot.querySelector('[data-node-id="${DOC_B}"]').click()
    })()`)
    await page.waitForTimeout(1500)
    await page.locator(rowSelector(boardId)).first().click()
    await waitForBoard(page)
    await check('dropped, then left at once', ['embeddable', 'embeddable', 'rectangle'])
    assert(pageErrors.length === 0, `no page errors: ${pageErrors.join(' | ')}`)
  } finally {
    console.log(JSON.stringify({ engine: engineName, steps, pageErrors }, null, 2))
  }
  console.log('\nA rectangle and cards dropped on a board are still there after leaving it, in the canvas, after a reload and in gardend.')
} finally {
  await browser?.close()
  await server?.close()
  await cell?.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
}
