/**
 * whiteboard-layout-browser.mts — "Lay out" on a real board, in the real app, against a real gardend
 * (plans/2026-10-30-elk-layout/DESIGN.md).
 *
 * The run:
 *   1. Sophia draws a scrambled Freud dream-work sketch through `whiteboard_apply`: seven shapes, seven arrows (one
 *      labelled), a group (box + note) and a frame round the three mechanisms.
 *   2. Two browsers open the board. In the first, the shapes are selected and the selection bar's "Lay out" is
 *      clicked: ELK runs in its Worker (a request for the worker module is seen).
 *   3. The layout: shapes moved, every arrow between laid-out shapes ELK's route, right angles marked elbow, bound with
 *      `{mode: "orbit", fixedPoint}` at the shapes' outlines; the frame holds its children; the group kept its shape.
 *   4. Undo restores the board in one step; redo lays it out again.
 *   5. A shape dragged with the mouse: its elbow arrows stay attached and right-angled (Excalidraw re-routes them).
 *   6. The second browser shows the same positions; a reload shows them; gardend's `whiteboard_read` has them.
 *   7. Alt+Shift+L with nothing selected lays out the whole board.
 *   Zero requests leave 127.0.0.1; no page errors.
 *
 *   SHRUBBERY_BROWSER_ENGINE=webkit pnpm -C apps/organism run test:whiteboard-layout
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
const port = Number(process.env.SHRUBBERY_WBLAYOUT_PORT ?? 5301)
const engineName = process.env.SHRUBBERY_BROWSER_ENGINE ?? 'chromium'
if (engineName !== 'chromium' && engineName !== 'webkit') {
  throw new Error('SHRUBBERY_BROWSER_ENGINE must be chromium or webkit')
}
const engine = engineName === 'webkit' ? webkit : chromium
const GRAPH_ID = 'wb-layout-probe'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`whiteboard-layout-browser assertion failed: ${message}`)
}

interface El {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  isDeleted?: boolean
  containerId?: string | null
  frameId?: string | null
  groupIds?: string[]
  points?: number[][]
  elbowed?: boolean
  startBinding?: { elementId: string; mode?: string; fixedPoint?: number[] } | null
  endBinding?: { elementId: string; mode?: string; fixedPoint?: number[] } | null
  version: number
}

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null

const rowSelector = (id: string) => `mn-sidebar-panel [data-node-id="${id}"]`

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

async function waitForBoard(page: Page): Promise<void> {
  await page.locator('sh-whiteboard canvas.interactive').first().waitFor({ timeout: 90_000 })
  await page.waitForTimeout(1500)
}

function sceneOf(page: Page): Promise<El[]> {
  return page.evaluate(`(() => { ${FIND_BOARD}
    const board = findBoard(document)
    return board && board.api ? JSON.parse(JSON.stringify(board.api.getSceneElements())) : []
  })()`) as Promise<El[]>
}

function select(page: Page, ids: readonly string[]): Promise<unknown> {
  return page.evaluate(`(() => { ${FIND_BOARD}
    const board = findBoard(document)
    board.api.updateScene({ appState: { selectedElementIds: Object.fromEntries(${JSON.stringify(ids)}.map((id) => [id, true])) } })
  })()`)
}

function viewportOf(page: Page): Promise<{ scrollX: number; scrollY: number; zoom: number }> {
  return page.evaluate(`(() => { ${FIND_BOARD}
    const s = findBoard(document).api.getAppState()
    return { scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value }
  })()`) as Promise<{ scrollX: number; scrollY: number; zoom: number }>
}

async function openBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`http://127.0.0.1:${port}/g/${GRAPH_ID}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.organismMode === 'local-cell', undefined, { timeout: 60_000 })
  await page.locator(rowSelector(boardId)).first().waitFor({ timeout: 60_000 })
  await page.locator(rowSelector(boardId)).first().click()
  await waitForBoard(page)
}

const rect = (e: El) => {
  if (e.points && (e.type === 'arrow' || e.type === 'line' || e.type === 'freedraw')) {
    const xs = [0, ...e.points.map((p) => p[0]!)]
    const ys = [0, ...e.points.map((p) => p[1]!)]
    return { x: e.x + Math.min(...xs), y: e.y + Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
  }
  return { x: e.x, y: e.y, w: e.width, h: e.height }
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol
/** Is (x, y) on or just outside the box's outline? Excalidraw keeps its own gap after a drag. */
function onOutline(r: { x: number; y: number; w: number; h: number }, x: number, y: number, tol: number): boolean {
  const inside = x >= r.x - tol && x <= r.x + r.w + tol && y >= r.y - tol && y <= r.y + r.h + tol
  return inside && (near(x, r.x, tol) || near(x, r.x + r.w, tol) || near(y, r.y, tol) || near(y, r.y + r.h, tol))
}
const absolute = (a: El) => (a.points ?? []).map(([px, py]) => [a.x + px!, a.y + py!] as const)
const rightAngled = (pts: ReadonlyArray<readonly [number, number]>) => pts.every((p, i) => i === 0 || near(p[0], pts[i - 1]![0], 0.5) || near(p[1], pts[i - 1]![1], 0.5))

try {
  const bin = resolveGardendBin()
  assert(existsSync(bin), `real gardend binary at ${bin}`)
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000 })
  const mcp = new LoopbackMcpClient({ mcpUrl: cell.mcpUrl, healthUrl: `${cell.apiUrl}/health`, token: cell.token, origin: 'http://127.0.0.1' })
  const payload = (result: unknown): Record<string, unknown> => {
    const r = result as { structuredContent?: Record<string, unknown>; content?: Array<{ text?: string }> }
    if (r.structuredContent) return r.structuredContent
    try { return JSON.parse(r.content?.[0]?.text ?? '{}') as Record<string, unknown> } catch { return {} }
  }
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'whiteboard layout probe' })
  const made = payload(await mcp.toolsCall('whiteboard_create', { graphId: GRAPH_ID, title: 'The dream-work' }))
  const boardId = String(made.documentId ?? '')
  assert(boardId, 'whiteboard_create returned a documentId')
  // 1. A scrambled sketch, drawn the way Sophia draws: shapes anywhere, arrows glued to them.
  const drawn = payload(await mcp.toolsCall('whiteboard_apply', {
    graphId: GRAPH_ID,
    documentId: boardId,
    rationale: 'a scrambled dream-work sketch for the layout probe',
    moves: [
      { op: 'add', ref: 'latent', shape: 'box', text: 'latent thoughts', at: { x: 40, y: 420 }, color: 'blue' },
      { op: 'add', ref: 'work', shape: 'box', text: 'the dream-work', at: { x: 720, y: 60 }, color: 'violet' },
      { op: 'add', ref: 'cond', shape: 'note', text: 'condensation', at: { x: 100, y: 60 } },
      { op: 'add', ref: 'disp', shape: 'note', text: 'displacement', at: { x: 420, y: 520 } },
      { op: 'add', ref: 'repr', shape: 'diamond', text: 'representability', at: { x: 920, y: 460 }, color: 'green' },
      { op: 'add', ref: 'manifest', shape: 'box', text: 'manifest content', at: { x: 320, y: 260 }, color: 'red' },
      { op: 'add', ref: 'remembered', shape: 'text', text: '(what is remembered)', at: { x: 320, y: 340 } },
      { op: 'connect', ref: 'a1', from: 'latent', to: 'work', label: 'worked by' },
      { op: 'connect', ref: 'a2', from: 'work', to: 'cond' },
      { op: 'connect', ref: 'a3', from: 'work', to: 'disp' },
      { op: 'connect', ref: 'a4', from: 'work', to: 'repr' },
      { op: 'connect', ref: 'a5', from: 'cond', to: 'manifest' },
      { op: 'connect', ref: 'a6', from: 'disp', to: 'manifest' },
      { op: 'connect', ref: 'a7', from: 'repr', to: 'manifest' },
      { op: 'group', ids: ['manifest', 'remembered'] },
      { op: 'group', ids: ['cond', 'disp', 'repr'], frame: 'Mechanisms' },
    ],
  }))
  const created = (drawn.created ?? {}) as Record<string, string>
  for (const ref of ['latent', 'work', 'cond', 'disp', 'repr', 'manifest', 'remembered', 'a1', 'a7']) assert(created[ref], `whiteboard_apply created ${ref}`)

  writeFileSync(loopbackPath, JSON.stringify({ apiUrl: cell.apiUrl, mcpUrl: cell.mcpUrl, token: cell.token, port: cell.manifest.port, graphId: GRAPH_ID }, null, 2))
  server = await createServer({ root: appDir, configFile: resolve(appDir, 'vite.config.ts'), server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, logLevel: 'warn' })
  await server.listen()
  browser = await engine.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
  const contextA = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const contextB = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await contextA.newPage()
  const other = await contextB.newPage()
  const pageErrors: string[] = []
  const offOrigin: string[] = []
  const workerRequests: string[] = []
  for (const p of [page, other]) {
    p.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 200)))
    p.on('request', (request) => {
      const url = request.url()
      if (!/^(https?:\/\/(127\.0\.0\.1|localhost)[:/]|data:|blob:)/.test(url)) offOrigin.push(url)
      if (/elk[._-]?worker/i.test(url)) workerRequests.push(url)
    })
  }
  const report: Record<string, unknown> = { engine: engineName }

  try {
    await openBoard(page, boardId)
    await openBoard(other, boardId)
    const before = await sceneOf(page)
    const shapeIds = before.filter((e) => !e.isDeleted && e.type !== 'arrow' && !(e.type === 'text' && e.containerId)).map((e) => e.id)
    assert(shapeIds.length >= 8, `the sketch has its shapes and the frame (${shapeIds.length})`)

    // 2. Select them all and click the bar's "Lay out".
    await select(page, shapeIds)
    const button = page.locator('sh-whiteboard .selbar button[data-action="layout"]').first()
    await button.waitFor({ timeout: 10_000 })
    await button.click()
    await page.waitForFunction(`(() => { ${FIND_BOARD}
      const board = findBoard(document)
      if (!board || !board.api) return false
      const els = board.api.getSceneElements()
      return els.some((e) => e.type === 'arrow' && e.elbowed && e.points && e.points.length >= 3)
    })()`, undefined, { timeout: 30_000 })
    await page.waitForTimeout(800)
    const laid = await sceneOf(page)
    const byId = new Map(laid.map((e) => [e.id, e]))
    const beforeById = new Map(before.map((e) => [e.id, e]))
    report.worker = workerRequests.slice(0, 3)
    assert(workerRequests.length > 0, 'ELK ran in its Worker (a request for the worker module was made)')

    // 3. The layout.
    const movedShapes = shapeIds.filter((id) => byId.get(id)!.x !== beforeById.get(id)!.x || byId.get(id)!.y !== beforeById.get(id)!.y)
    assert(movedShapes.length >= 4, `the layout moved shapes (${movedShapes.length})`)
    const arrows = laid.filter((e) => e.type === 'arrow' && !e.isDeleted)
    const elbows = arrows.filter((a) => a.elbowed)
    report.arrows = arrows.map((a) => ({ id: a.id, elbowed: a.elbowed, points: a.points?.length, start: a.startBinding, end: a.endBinding }))
    assert(elbows.length >= 4, `most arrows became elbows (${elbows.length} of ${arrows.length})`)
    for (const a of elbows) {
      const pts = absolute(a)
      assert(rightAngled(pts), `${a.id} has right angles`)
      for (const [key, end] of [['startBinding', pts[0]!], ['endBinding', pts[pts.length - 1]!]] as const) {
        const binding = a[key]
        assert(binding && binding.mode === 'orbit' && Array.isArray(binding.fixedPoint), `${a.id} ${key} is an orbit binding with a fixed point`)
        assert(onOutline(rect(byId.get(binding.elementId)!), end[0], end[1], 8), `${a.id} ${key} ends on ${binding.elementId}'s outline`)
      }
    }
    const frame = laid.find((e) => e.type === 'frame' && !e.isDeleted)!
    for (const id of [created.cond!, created.disp!, created.repr!]) {
      const r = rect(byId.get(id)!)
      const f = rect(frame)
      assert(r.x >= f.x - 0.5 && r.y >= f.y - 0.5 && r.x + r.w <= f.x + f.w + 0.5 && r.y + r.h <= f.y + f.h + 0.5, `the frame holds ${id}`)
    }
    const offset = (m: Map<string, El>) => [m.get(created.remembered!)!.x - m.get(created.manifest!)!.x, m.get(created.remembered!)!.y - m.get(created.manifest!)!.y]
    assert(near(offset(byId)[0]!, offset(beforeById)[0]!, 0.01) && near(offset(byId)[1]!, offset(beforeById)[1]!, 0.01), 'the group kept its shape')

    // 4. One undo step back, then forward again.
    const canvas = page.locator('sh-whiteboard canvas.interactive').first()
    const corner = async () => { const b = await canvas.boundingBox(); return { x: 12, y: Math.max(12, (b?.height ?? 40) - 12) } }
    await canvas.click({ position: await corner() })
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${mod}+z`)
    await page.waitForTimeout(600)
    const undone = new Map((await sceneOf(page)).map((e) => [e.id, e]))
    assert(shapeIds.every((id) => near(undone.get(id)!.x, beforeById.get(id)!.x, 0.01) && near(undone.get(id)!.y, beforeById.get(id)!.y, 0.01)), 'one undo restores every shape')
    await page.keyboard.press(`${mod}+Shift+z`)
    await page.waitForTimeout(600)
    const redone = new Map((await sceneOf(page)).map((e) => [e.id, e]))
    assert(shapeIds.every((id) => near(redone.get(id)!.x, byId.get(id)!.x, 0.01)), 'redo lays it out again')

    // 5. Drag the dream-work box with the mouse: its elbow arrows stay attached and right-angled.
    const work = redone.get(created.work!)!
    const view = await viewportOf(page)
    const box = await canvas.boundingBox()
    assert(box, 'the canvas has a box')
    const at = { x: box.x + (work.x + work.width / 2 + view.scrollX) * view.zoom, y: box.y + (work.y + work.height / 2 + view.scrollY) * view.zoom }
    await select(page, [])
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x + 40, at.y + 90, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(800)
    const dragged = new Map((await sceneOf(page)).map((e) => [e.id, e]))
    const workAfter = dragged.get(created.work!)!
    assert(!near(workAfter.y, work.y, 1), 'the dream-work box moved')
    for (const a of [...dragged.values()].filter((e) => e.type === 'arrow' && !e.isDeleted && (e.startBinding?.elementId === created.work || e.endBinding?.elementId === created.work))) {
      const pts = absolute(a)
      const end = a.startBinding?.elementId === created.work ? pts[0]! : pts[pts.length - 1]!
      assert(onOutline(rect(workAfter), end[0], end[1], 12), `${a.id} still meets the moved box`)
      if (a.elbowed) assert(rightAngled(pts), `${a.id} is still right-angled after the drag`)
    }
    await page.waitForTimeout(1500)
    const final = new Map((await sceneOf(page)).map((e) => [e.id, e]))

    // 6. The second browser, a reload, and gardend all have it.
    const sameAs = (m: Map<string, El>, label: string) => {
      for (const id of shapeIds) assert(near(m.get(id)!.x, final.get(id)!.x, 0.01) && near(m.get(id)!.y, final.get(id)!.y, 0.01), `${label}: ${id} where the first browser has it`)
    }
    await other.waitForTimeout(1500)
    sameAs(new Map((await sceneOf(other)).map((e) => [e.id, e])), 'the second browser')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.body.dataset.organismMode === 'local-cell', undefined, { timeout: 60_000 })
    await waitForBoard(page)
    sameAs(new Map((await sceneOf(page)).map((e) => [e.id, e])), 'after a reload')
    const read = payload(await mcp.toolsCall('whiteboard_read', { graphId: GRAPH_ID, documentId: boardId, format: 'elements' }))
    sameAs(new Map(((read.elements ?? []) as El[]).map((e) => [e.id, e])), "gardend's whiteboard_read")

    // 7. Alt+Shift+L with nothing selected lays out the whole board.
    await page.evaluate(`(() => { ${FIND_BOARD}
      const board = findBoard(document)
      if (!board || !board.api) return false
      const els = board.api.getSceneElements()
      const box = els.find((e) => e.id === ${JSON.stringify(created.latent)})
      board.api.updateScene({ elements: els.map((e) => e.id === box.id ? { ...e, x: e.x + 900, y: e.y + 700, version: e.version + 1, versionNonce: e.versionNonce + 1 } : e), appState: { selectedElementIds: {} } })
    })()`)
    await page.waitForTimeout(400)
    const scattered = (await sceneOf(page)).find((e) => e.id === created.latent)!
    await canvas.click({ position: await corner() })
    await page.keyboard.press('Alt+Shift+KeyL')
    await page.waitForTimeout(2500)
    const whole = (await sceneOf(page)).find((e) => e.id === created.latent)!
    assert(!near(whole.x, scattered.x, 1) || !near(whole.y, scattered.y, 1), 'Alt+Shift+L laid the whole board out')

    report.offOrigin = offOrigin
    report.pageErrors = pageErrors
    assert(offOrigin.length === 0, `no request left 127.0.0.1: ${offOrigin.slice(0, 5).join(' | ')}`)
    assert(pageErrors.length === 0, `no page errors: ${pageErrors.join(' | ')}`)
  } catch (error) {
    report.pageErrors = pageErrors
    report.offOrigin = offOrigin
    report.worker = workerRequests.slice(0, 3)
    throw error
  } finally {
    console.log(JSON.stringify(report, null, 2))
  }
  console.log('\nLay out arranged the board with ELK in a Worker, routed its arrows at right angles, undid in one step, kept arrows attached through a drag, and reached the second browser, a reload and gardend.')
} finally {
  await browser?.close()
  await server?.close()
  await cell?.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
}
