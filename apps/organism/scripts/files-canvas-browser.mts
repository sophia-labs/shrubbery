/**
 * The Files card plane witnessed in a real browser (Chromium), against the suites' CONTRACT-files v1 server: arrange and
 * its undo, marquee, move into a folder by dragging onto it and onto the tree, create where you look, zoom, keyboard.
 *
 *   SHOTS_DIR=/path node --import tsx scripts/files-canvas-browser.mts      (exit 1 on any failed check)
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { startFilesContractServer } from '../src/cell/__tests__/support/files-contract-server.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.FILES_CANVAS_PORT ?? 5242)
const shots = process.env.SHOTS_DIR ?? resolve(appDir, '.files-canvas-shots')
mkdirSync(shots, { recursive: true })
let failed = 0
const check = (name: string, ok: boolean, detail?: unknown): void => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`) }

const cell = await startFilesContractServer({ graphIncarnation: 'inc-canvas-1' })
for (const [name, type] of [['alpha.txt', 'text/plain'], ['beta.txt', 'text/plain'], ['gamma.txt', 'text/plain'], ['delta.txt', 'text/plain']] as const) {
  const form = new FormData(); form.set('file', new File([new Uint8Array(40).fill(65)], name, { type }))
  await fetch(`${cell.base}/artifacts/${cell.graphId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${cell.token}` }, body: form })
}
const server = await createServer({ root: appDir, configFile: resolve(appDir, 'vite.config.ts'), logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, proxy: { '/files-cell': { target: cell.base, changeOrigin: true, rewrite: p => p.replace(/^\/files-cell/, '') } } } })
await server.listen()
const browser = await chromium.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript('window.__name = (f) => f')       // tsx's keepNames wraps inner arrows that page.evaluate ships over
const page = await context.newPage()
const errors: string[] = []
page.on('pageerror', e => errors.push(e.message))

const cards = (p: Page) => p.evaluate(() => Object.fromEntries([...document.querySelector('mn-files-canvas')!.shadowRoot!.querySelectorAll('.card')].map(c => {
  const r = c.getBoundingClientRect(); return [c.getAttribute('title')!, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), sel: c.getAttribute('aria-selected') === 'true' }] })))
const status = (p: Page) => p.evaluate(() => (window as any).__filesHarness.state.status as { text: string; message: string; undoLabel: string | null })
const centre = (c: { x: number; y: number; w: number; h: number }) => ({ x: c.x + c.w / 2, y: c.y + c.h / 2 })
async function drag(p: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 10): Promise<void> {
  await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(to.x, to.y, { steps }); await p.mouse.up(); await p.waitForTimeout(400)
}

try {
  await page.goto(`http://127.0.0.1:${port}/files-rudiments-browser-harness.html?cell=/files-cell&token=${cell.token}&graph=${cell.graphId}`)
  await page.waitForSelector('mn-sidebar-panel button.section-action')
  await page.click('mn-sidebar-panel button.section-action')
  await page.waitForFunction(() => document.querySelector('mn-files-canvas')?.shadowRoot?.querySelectorAll('.card').length === 4)
  const start = await cards(page)

  // arrange, announced once, undone and redone
  await drag(page, centre(start['alpha.txt']!), { x: 700, y: 500 })
  let now = await cards(page)
  check('arrange: the card lands where it was dropped', Math.abs(centre(now['alpha.txt']!).x - 700) < 20 && Math.abs(centre(now['alpha.txt']!).y - 500) < 20, now['alpha.txt'])
  check('arrange: announced once with Undo', (await status(page)).message === 'Moved 1 item.' && (await status(page)).undoLabel === 'Undo', await status(page))
  check('arrange: keyboard focus stays on the card after the drop', await page.evaluate(() => document.querySelector('mn-files-canvas')!.shadowRoot!.activeElement?.classList.contains('card') === true))
  await page.keyboard.press('Control+z'); await page.waitForTimeout(500)
  now = await cards(page)
  check('arrange: Ctrl+Z puts the card back', now['alpha.txt']!.x === start['alpha.txt']!.x && now['alpha.txt']!.y === start['alpha.txt']!.y, [now['alpha.txt'], start['alpha.txt'], await status(page)])
  await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(500)
  now = await cards(page)
  check('arrange: Ctrl+Shift+Z does it again', Math.abs(centre(now['alpha.txt']!).x - 700) < 20, now['alpha.txt'])
  await page.locator('mn-files-canvas').evaluate(el => el.shadowRoot!.querySelector<HTMLElement>('.card')!.focus())
  await page.screenshot({ path: resolve(shots, '01-arranged.png') })

  // marquee
  await page.mouse.move(1050, 650); await page.mouse.down(); await page.mouse.move(300, 100, { steps: 8 }); await page.mouse.up()
  now = await cards(page)
  check('marquee: sweeping across the cards selects them all', Object.values(now).every(c => c.sel), now)
  await page.mouse.click(1000, 700); await page.waitForTimeout(100)
  check('marquee: a click on the ground clears it', Object.values(await cards(page)).every(c => !c.sel))

  // create where you look
  await page.click('.mn-files-pane button:has-text("New folder")'); await page.waitForTimeout(200)
  await page.keyboard.type('Pictures'); await page.keyboard.press('Enter'); await page.waitForTimeout(700)
  now = await cards(page)
  check('create: New folder is named in place and lands in view', !!now['Pictures'] && now['Pictures']!.x >= 290 && now['Pictures']!.y >= 90, now['Pictures'])
  check('create: announced once', (await status(page)).message === 'Created “Pictures”.', await status(page))

  // drop onto a folder card
  await drag(page, centre(now['beta.txt']!), centre(now['Pictures']!), 14)
  now = await cards(page)
  check('move: dropping on a folder card moves the file into it', !now['beta.txt'] && !!now['Pictures'], Object.keys(now))

  // drop onto the tree row
  const row = await page.evaluate(() => { const r = document.querySelector('mn-sidebar-panel')!.shadowRoot!.querySelector('[data-kind="folder"]')!.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await page.mouse.move(centre(now['gamma.txt']!).x, centre(now['gamma.txt']!).y); await page.mouse.down(); await page.mouse.move(row.x, row.y, { steps: 14 })
  const hint = await page.locator('mn-files-canvas').evaluate(el => el.shadowRoot!.querySelector('.hint')?.textContent ?? '')
  await page.screenshot({ path: resolve(shots, '02-tree-drop.png') })
  await page.mouse.up(); await page.waitForTimeout(600)
  now = await cards(page)
  check('tree bridge: the hint names the folder under the pointer', /Move into Pictures/.test(hint), hint)
  check('tree bridge: dropping on a tree folder row moves the file into it', !now['gamma.txt'] && !!now['delta.txt'], Object.keys(now))

  // zoom and the keyboard
  const before = (await cards(page))['delta.txt']!
  await page.locator('mn-files-canvas').evaluate(el => el.shadowRoot!.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!.click()); await page.waitForTimeout(200)
  const zoomed = (await cards(page))['delta.txt']!
  check('zoom: the + control scales the cards', zoomed.w > before.w, { before, zoomed })
  // --- wave 3: Tidy up, connectors, the picker, the layer toggle, contested ghosts in a real second tab ---------------------
  for (const name of ['epsilon.txt', 'zeta.txt', 'eta.txt', 'theta.txt']) {
    const form = new FormData(); form.set('file', new File([new Uint8Array(40).fill(66)], name, { type: 'text/plain' }))
    await fetch(`${cell.base}/artifacts/${cell.graphId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${cell.token}` }, body: form })
  }
  const url = `http://127.0.0.1:${port}/files-rudiments-browser-harness.html?cell=/files-cell&token=${cell.token}&graph=${cell.graphId}`
  const open = async (p: Page, want: number): Promise<void> => {
    await p.goto(url)
    await p.waitForSelector('mn-sidebar-panel button.section-action')
    await p.click('mn-sidebar-panel button.section-action')
    await p.waitForFunction(n => (document.querySelector('mn-files-canvas')?.shadowRoot?.querySelectorAll('.card:not([data-role="ghost"])').length ?? 0) >= n, want)
    await p.waitForTimeout(500)
  }
  await open(page, 7)
  const canvas = page.locator('mn-files-canvas')

  // Tidy up: one click lays every card out on a grid, announced once, undone by one Undo
  await page.click('mn-files-canvas >> button[aria-label="Tidy up"]'); await page.waitForTimeout(800)
  let grid = await cards(page)
  const xs = new Set(Object.values(grid).map(c => c.x)), ys = new Set(Object.values(grid).map(c => c.y))
  check('tidy: the cards sit on a grid (few distinct columns and rows)', xs.size <= 8 && ys.size <= Math.ceil(Object.keys(grid).length / Math.max(1, xs.size)) + 1 && ys.size < Object.keys(grid).length, { xs: [...xs], ys: [...ys] })
  check('tidy: announced once with Undo', /^Moved \d+ items?\.$/.test((await status(page)).message) && (await status(page)).undoLabel === 'Undo', await status(page))
  await page.screenshot({ path: resolve(shots, '03-tidied.png') })

  // drag-to-connect: handle of the first card of the first row to the third, picker, Supports
  const order = Object.entries(grid).sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x).map(([name]) => name).filter(name => name !== 'Pictures')   // a folder has no wire identity
  const handlePoint = async (name: string) => canvas.evaluate((el, n) => { const c = [...el.shadowRoot!.querySelectorAll<HTMLElement>('.card')].find(x => x.title === n)!; const r = c.querySelector('.handle')!.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, name)
  const connect = async (from: string, to: string, relation: string): Promise<void> => {
    const g = await cards(page)
    const h = await handlePoint(from)
    await page.mouse.move(h.x, h.y); await page.mouse.down(); await page.mouse.move(centre(g[to]!).x, centre(g[to]!).y, { steps: 12 })
    if (relation === 'supports') await page.screenshot({ path: resolve(shots, '04-connecting.png') })
    await page.mouse.up(); await page.waitForSelector('mn-files-canvas >> .picker')
    if (relation.startsWith('other:')) {
      await page.click('mn-files-canvas >> .picker button[data-relation="other"]'); await page.keyboard.type(relation.slice(6)); await page.keyboard.press('Enter')
    } else await page.click(`mn-files-canvas >> .picker button[data-relation="${relation}"]`)
    await page.waitForTimeout(300)
  }
  const wires = () => canvas.evaluate(el => [...el.shadowRoot!.querySelectorAll('.connector')].length)
  await connect(order[0]!, order[2]!, 'supports')
  check('connect: dragging from the handle to another card and choosing a relation draws a labelled connector', (await wires()) === 1
    && (await canvas.evaluate(el => el.shadowRoot!.querySelector('.conn-label')?.textContent?.trim())) === 'supports')
  check('connect: announced once with Undo', /^Connected/.test((await status(page)).message) && (await status(page)).undoLabel === 'Undo', await status(page))
  await connect(order[0]!, order[3]!, 'qualifies')
  await connect(order[1]!, order[3]!, 'other:Annotates')
  const stored = [...cell.wires.values()]
  check('connect: each connection is a wire of the graph, between artifact ids, with the relation as its predicate',
    stored.length === 3 && stored.every(w => cell.artifacts.has(w.sourceDocumentId) && cell.artifacts.has(w.targetDocumentId))
    && stored.map(w => w.predicate).sort().join() === 'annotates,qualifies,supports', stored)
  check('connect: "Other…" takes a free label', await canvas.evaluate(el => [...el.shadowRoot!.querySelectorAll('.conn-label')].some(l => l.textContent?.trim().toLowerCase() === 'annotates')))

  const geometry = () => canvas.evaluate(el => {
    const root = el.shadowRoot!
    const glyphs = [...root.querySelectorAll('.card[data-role="real"]')].map(g => g.getBoundingClientRect())
    const crossings: string[] = []
    for (const line of root.querySelectorAll<SVGPathElement>('.connector .line')) {
      const m = line.getScreenCTM()!, total = line.getTotalLength()
      for (let at = 0; at <= total; at += 2) {
        const p = line.getPointAtLength(at), x = p.x * m.a + m.e, y = p.y * m.d + m.f
        if (glyphs.some(r => x > r.left + 2 && x < r.right - 2 && y > r.top + 2 && y < r.bottom - 2)) { crossings.push(line.parentElement!.getAttribute('data-connection-id')!); break }
      }
    }
    const labels = [...root.querySelectorAll('.conn-label')].map(l => ({ id: l.getAttribute('data-connection-id')!, r: l.getBoundingClientRect() }))
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const stacked = labels.flatMap((a, i) => labels.slice(i + 1).filter(b => hit(a.r, b.r)).map(b => `${a.id}/${b.id}`))
    const content = [...root.querySelectorAll('.card[data-role="real"] mn-file-glyph, .card[data-role="real"] .label')].map(g => g.getBoundingClientRect())
    const onGlyph = labels.filter(l => content.some(g => hit(l.r, g))).map(l => l.id)
    return { crossings, stacked, onGlyph, labels: labels.length }
  })
  let geo = await geometry()
  check('connectors: no wire crosses a card, glyph or name (a card sits between the first and third)', geo.crossings.length === 0, geo)
  check('connectors: adjacent labels are legible (none overlap each other, a glyph or a card name)', geo.stacked.length === 0 && geo.onGlyph.length === 0 && geo.labels === 3, geo)
  await page.screenshot({ path: resolve(shots, '05-connectors.png') })

  // a wire follows its card through a drag, and still crosses nothing
  const g2 = await cards(page)
  await drag(page, centre(g2[order[1]!]!), { x: centre(g2[order[1]!]!).x + 20, y: centre(g2[order[1]!]!).y + 170 }, 12)
  geo = await geometry()
  check('connectors: after a card is dragged the wires still cross no glyph and labels stay clear', geo.crossings.length === 0 && geo.stacked.length === 0 && geo.onGlyph.length === 0, geo)

  // the layer toggle
  await page.click('mn-files-canvas >> button[aria-label="Connections"]'); await page.waitForTimeout(150)
  check('layer: Links hides every connector and label', (await wires()) === 0 && (await canvas.evaluate(el => el.shadowRoot!.querySelectorAll('.conn-label').length)) === 0)
  await page.click('mn-files-canvas >> button[aria-label="Connections"]'); await page.waitForTimeout(150)
  check('layer: and shows them again', (await wires()) === 3)

  // disconnect: select by the label, Delete, Undo
  await page.click('mn-files-canvas >> .conn-label >> nth=0')
  await page.keyboard.press('Delete'); await page.waitForTimeout(300)
  check('disconnect: selecting a connector and pressing Delete removes it, and the wire', (await wires()) === 2 && cell.wires.size === 2, [await wires(), cell.wires.size])
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300)
  check('disconnect: Ctrl+Z puts it back', (await wires()) === 3 && cell.wires.size === 3, [await wires(), cell.wires.size])
  await page.reload(); await page.waitForSelector('mn-sidebar-panel button.section-action'); await page.click('mn-sidebar-panel button.section-action')
  await page.waitForFunction(() => (document.querySelector('mn-files-canvas')?.shadowRoot?.querySelectorAll('.connector').length ?? 0) === 3)
  check('connections persist across a reload (read back from the graph\'s wires)', true)

  // a contest, witnessed in a real second tab
  const tab2 = await page.context().newPage()
  tab2.on('pageerror', e => errors.push(e.message))
  await open(tab2, 7)
  const target = 'theta.txt'
  const c1 = (await cards(page))[target]!
  await drag(page, centre(c1), { x: centre(c1).x + 60, y: centre(c1).y + 260 }, 12)       // tab 1 writes first
  const c2 = (await cards(tab2))[target]!
  await drag(tab2, centre(c2), { x: centre(c2).x + 220, y: centre(c2).y + 120 }, 12)       // tab 2 writes from the base it read
  await tab2.waitForTimeout(1200)
  const ghosts = await tab2.locator('mn-files-canvas').evaluate(el => [...el.shadowRoot!.querySelectorAll('.card[data-role="ghost"]')].map(g => ({ label: g.getAttribute('aria-label'), note: g.querySelector('.annunciator')?.textContent })))
  check('contest: the second tab shows a labelled ghost for the position proposed in the other tab', ghosts.length === 1 && /other tab/.test(ghosts[0]?.note ?? ''), ghosts)
  check('contest: no raw coordinates anywhere on the ghost', ghosts.every(g => !/\bx\s*[:=]|\by\s*[:=]|\d{3,}\s*,\s*\d{3,}/.test(`${g.label} ${g.note}`)), ghosts)
  await tab2.screenshot({ path: resolve(shots, '06-contest-tab2.png') })
  // other cards stay draggable while one is contested
  const o = (await cards(tab2))[order.find(n => n !== target)!]!
  await drag(tab2, centre(o), { x: centre(o).x + 30, y: centre(o).y + 90 }, 10)
  const o2 = (await cards(tab2))[order.find(n => n !== target)!]!
  check('contest: every other card stays draggable', Math.abs(o2.y - o.y - 90) < 12, [o, o2])
  const ghostPos = await tab2.locator('mn-files-canvas').evaluate(el => { const r = el.shadowRoot!.querySelector('.card[data-role="ghost"]')!.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await tab2.mouse.click(ghostPos.x, ghostPos.y); await tab2.waitForTimeout(1500)
  const settled = (await cards(tab2))[target]!
  check('contest: clicking the ghost keeps its position and the ghost goes away',
    (await tab2.locator('mn-files-canvas').evaluate(el => el.shadowRoot!.querySelectorAll('.card[data-role="ghost"]').length)) === 0
    && Math.abs(centre(settled).x - ghostPos.x) < 12 && Math.abs(centre(settled).y - ghostPos.y) < 12, { settled, ghostPos })
  await open(page, 7)
  const final = (await cards(page))[target]!
  check('contest: the first tab, reloaded, sees the settled position', Math.abs(final.x - settled.x) < 12 && Math.abs(final.y - settled.y) < 12, { final, settled })
  check('errors: none thrown in the page', errors.length === 0, errors)
} catch (error) {
  failed++; console.log('FAIL (threw)', error)
} finally {
  await browser.close(); await server.close(); await cell.close?.()
}
process.exit(failed ? 1 : 0)
