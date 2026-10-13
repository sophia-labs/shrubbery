/**
 * The Files shell in a real browser (Chromium), against the suites' CONTRACT-files v1 server: the keyboard path to the
 * first file (at most 10 Tab stops, top bar excluded), one header, one count, one Add, the shared empty folder in both
 * faces, and a drop on the tree's top ("Files") moving a file out of a folder. One tree (plans/2026-10-08-one-tree.md): documents
 * in the pane beside files, the kind filter in the tree's toolbar, Open Folder opening the place, open by kind with the way back
 * keeping the place, and the one Trash (Restore, Delete forever with its confirm, a document's degrade on a cell that cannot yet).
 *
 *   SHOTS_DIR=/path node --import tsx scripts/files-shell-browser.mts      (exit 1 on any failed check)
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { startFilesContractServer } from '../src/cell/__tests__/support/files-contract-server.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.FILES_SHELL_PORT ?? 5243)
const shots = process.env.SHOTS_DIR ?? resolve(appDir, '.files-shell-shots')
mkdirSync(shots, { recursive: true })
let failed = 0
const check = (name: string, ok: boolean, detail?: unknown): void => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`) }

const cell = await startFilesContractServer({ graphIncarnation: 'inc-shell-1' })
// A native (documents-born) folder holding two documents: what Vera right-clicked when "Open Folder" showed nothing.
cell.folders.set('fld-native', { id: 'fld-native', name: 'Kitchen', parentId: null, section: 'documents', order: 90 })
cell.documents.set('doc-plan', { id: 'doc-plan', title: 'Plan', parentId: 'fld-native', order: 1 })
cell.documents.set('doc-list', { id: 'doc-list', title: 'Shopping list', parentId: 'fld-native', order: 2 })
for (const name of ['alpha.txt', 'beta.txt', 'gamma.txt', 'delta.txt']) {
  const form = new FormData(); form.set('file', new File([new Uint8Array(40).fill(65)], name, { type: 'text/plain' }))
  await fetch(`${cell.base}/artifacts/${cell.graphId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${cell.token}` }, body: form })
}
const server = await createServer({ root: appDir, configFile: resolve(appDir, 'vite.config.ts'), logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, proxy: { '/files-cell': { target: cell.base, changeOrigin: true, rewrite: p => p.replace(/^\/files-cell/, '') } } } })
await server.listen()
const browser = await chromium.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors: string[] = []
page.on('pageerror', e => errors.push(e.message))

const cards = (p: Page) => p.evaluate(() => Object.fromEntries([...document.querySelector('mn-files-canvas')!.shadowRoot!.querySelectorAll('.card')].map(c => {
  const r = c.getBoundingClientRect(); return [c.getAttribute('title')!, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }] })))
const centre = (c: { x: number; y: number; w: number; h: number }) => ({ x: c.x + c.w / 2, y: c.y + c.h / 2 })
async function drag(p: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(to.x, to.y, { steps: 14 }); await p.mouse.up(); await p.waitForTimeout(500)
}
/** The leaf element holding focus, through every shadow root, described. */
const focusLeaf = (p: Page) => p.evaluate(() => {
  let e: Element | null = document.activeElement; let leaf: Element | null = e
  while (e) { leaf = e; e = (e as any).shadowRoot?.activeElement ?? null }
  let canvas = false
  for (let n: Node | null = leaf; n; n = (n as ShadowRoot).host ?? n.parentNode) if ((n as Element).localName === 'mn-files-canvas') canvas = true
  const W = window as any; W.__ids ??= new WeakMap(); W.__n ??= 0
  if (!W.__ids.has(leaf)) W.__ids.set(leaf, ++W.__n)
  return { id: W.__ids.get(leaf) as number, canvas, role: leaf?.getAttribute('role') ?? leaf?.localName ?? '' }
})

try {
  await page.goto(`http://127.0.0.1:${port}/files-rudiments-browser-harness.html?cell=/files-cell&token=${cell.token}&graph=${cell.graphId}`)
  await page.waitForSelector('mn-sidebar-panel button.section-action')
  await page.click('mn-sidebar-panel button.section-action')
  await page.waitForFunction(() => document.querySelector('mn-files-canvas')?.shadowRoot?.querySelectorAll('.card').length === 5)

  // the keyboard path: from the top bar's last control to the first file
  await page.evaluate(() => { const bar = document.querySelector('mn-top-bar')!.shadowRoot!; [...bar.querySelectorAll<HTMLElement>('button')].at(-1)!.focus() })
  const seen = new Set<number>(); let stops = 0; let landed = false
  for (let i = 0; i < 40 && !landed; i++) {
    await page.keyboard.press('Tab'); stops++
    const f = await focusLeaf(page)
    if (seen.has(f.id)) break
    seen.add(f.id)
    landed = f.canvas && ['option', 'listbox'].includes(f.role)
  }
  check('keyboard: Tab reaches the first file in at most 10 stops (top bar excluded)', landed && stops <= 10, { stops, landed })
  console.log(`     tab stops from the top bar's last control to the first file: ${stops}`)
  check('keyboard: the pane header is one stop', await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.mn-files-pane > header button, .mn-files-pane > header select, .mn-files-pane > header input:not([type=file])')].filter(e => e.tabIndex === 0).length) === 1)
  check('keyboard: the tree row menus are out of the Tab order', await page.evaluate(() => [...document.querySelector('mn-sidebar-panel')!.shadowRoot!.querySelectorAll<HTMLElement>('.node-menu')].every(e => e.tabIndex === -1)))
  check('keyboard: the tree is one stop', await page.evaluate(() => [...document.querySelector('mn-sidebar-panel')!.shadowRoot!.querySelectorAll<HTMLElement>('[role=treeitem]')].filter(e => e.tabIndex === 0).length) === 1)

  // one header, one count, one Add
  const header = await page.evaluate(() => {
    const pane = document.querySelector('.mn-files-pane')!
    return { height: Math.round(pane.querySelector('header')!.getBoundingClientRect().height), crumbs: pane.querySelectorAll('nav[aria-label="Folder path"]').length,
      uploads: pane.querySelectorAll('[data-action=upload]').length, statuses: pane.querySelectorAll('[role=status]').length,
      saved: (document.body.innerText.match(/Saved in this browser/g) ?? []).length }
  })
  check('header: at most 72px above the first file', header.height <= 72, header)
  check('header: one breadcrumb, one Add, one status line', header.crumbs === 1 && header.uploads === 1 && header.statuses === 1, header)
  check('header: "Saved in this browser" appears at most once', header.saved <= 1, header)
  await page.screenshot({ path: resolve(shots, '01-canvas.png') })

  // an empty folder says the same thing in both faces
  await page.click('.mn-files-pane button:has-text("New folder")'); await page.waitForTimeout(200)
  await page.keyboard.type('Pictures'); await page.keyboard.press('Enter'); await page.waitForTimeout(700)
  let now = await cards(page)
  await drag(page, centre(now['alpha.txt']!), centre(now['Pictures']!))
  await page.mouse.dblclick(...Object.values(centre((await cards(page))['Pictures']!)) as [number, number]); await page.waitForTimeout(600)
  now = await cards(page)
  check('folder: Pictures opens with the file that was dropped on it', !!now['alpha.txt'], Object.keys(now))

  // a drop on the tree's top moves the file out of the folder
  const top = await page.evaluate(() => { const r = document.querySelector('mn-sidebar-panel')!.shadowRoot!.querySelector('[data-section-id="tree"] .section-header')!.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await page.mouse.move(centre(now['alpha.txt']!).x, centre(now['alpha.txt']!).y); await page.mouse.down(); await page.mouse.move(top.x, top.y, { steps: 14 })
  const hint = await page.locator('mn-files-canvas').evaluate(el => el.shadowRoot!.querySelector('.hint')?.textContent ?? '')
  await page.mouse.up(); await page.waitForTimeout(800)
  check('tree top: the hint names Files', /Move into Files/.test(hint), hint)
  check('tree top: the folder is empty once the file went to the top', await page.evaluate(() => document.querySelector('mn-files-canvas')!.shadowRoot!.querySelectorAll('.card').length) === 0)
  check('empty folder (canvas): one empty state, no second Upload', await page.evaluate(() => document.querySelector('mn-files-canvas')!.shadowRoot!.querySelectorAll('[data-empty]').length === 1 && document.querySelector('mn-files-canvas')!.shadowRoot!.querySelectorAll('[data-empty] button').length === 0))
  await page.click('[data-face=list]'); await page.waitForTimeout(500)
  check('empty folder (list): the same state, and exactly one Upload in the pane', await page.evaluate(() => document.querySelectorAll('.mn-files-pane [data-empty]').length === 1 && document.querySelectorAll('.mn-files-pane [data-action=upload], .mn-files-pane [data-empty] button').length === 1))
  await page.screenshot({ path: resolve(shots, '02-empty-list.png') })
  await page.click('nav[aria-label="Folder path"] button:has-text("Files")'); await page.waitForTimeout(600)
  check('tree top: the file is back in Files', Object.keys(await cards(page)).includes('alpha.txt'), Object.keys(await cards(page)))

  // ── one tree ──────────────────────────────────────────────────────────────────────────────────────────────────────
  await page.goto(`http://127.0.0.1:${port}/files-rudiments-browser-harness.html?cell=/files-cell&token=${cell.token}&graph=${cell.graphId}`)
  await page.waitForSelector('mn-sidebar-panel button.section-action')
  const state = () => page.evaluate(() => (window as any).__filesHarness.state)
  const treeText = () => page.evaluate(() => (document.querySelector('mn-sidebar-panel')!.shadowRoot!.querySelector('[data-section-id="tree"]') as HTMLElement).innerText)
  const filter = page.locator('mn-sidebar-panel .kind-select')

  // the kind filter: one control in the existing toolbar; All shows both kinds, Documents only documents, Files only files
  check('filter: the tree has one kind filter, All by default', await filter.count() === 1 && await filter.inputValue() === 'all')
  let text = await treeText()
  check('filter All: documents and files side by side in one tree', /Plan/.test(text) && /Shopping list/.test(text) && /alpha\.txt/.test(text), text)
  await filter.selectOption('documents'); await page.waitForTimeout(300)
  text = await treeText()
  check('filter Documents: documents and their folder, no files', /Plan/.test(text) && /Kitchen/.test(text) && !/alpha\.txt/.test(text), text)
  await filter.selectOption('files'); await page.waitForTimeout(300)
  text = await treeText()
  check('filter Files: files, no documents', /alpha\.txt/.test(text) && !/Plan/.test(text) && !/Shopping list/.test(text), text)
  await filter.selectOption('all'); await page.waitForTimeout(300)

  // Open Folder on the native folder opens the place, with its documents (the bug that started this)
  await page.evaluate(() => {
    const node = { id: 'fld-native', label: 'Kitchen', kind: 'folder', section: 'documents', parentId: null }
    document.querySelector('mn-sidebar-panel')!.dispatchEvent(new CustomEvent('mn-sidebar-node-open', { bubbles: true, composed: true, detail: { id: 'fld-native', node } }))
  })
  await page.waitForFunction(() => document.querySelector('mn-files-canvas')?.shadowRoot?.querySelectorAll('.card').length === 2)
  now = await cards(page)
  check('open folder: a native folder opens the place with its two documents as cards', !!now['Plan'] && !!now['Shopping list'] && Object.keys(now).length === 2, Object.keys(now))
  check('open folder: the cards are documents (a document face, not a file glyph)', await page.locator('mn-files-canvas .card[data-card-key*="document"] mn-file-glyph[kind="document"]').count() === 2)
  await page.screenshot({ path: resolve(shots, '03-native-folder-place.png') })

  // open by kind: open one; the way back keeps the face, the folder and the selection
  await page.mouse.dblclick(centre(now['Plan']!).x, centre(now['Plan']!).y); await page.waitForTimeout(400)
  check('open document: the editor takes the center and the way back names the place', (await state()).openedDocument === 'doc-plan'
    && await page.locator('[data-place-back]').innerText() === '← Back to Kitchen')
  await page.screenshot({ path: resolve(shots, '04-document-opened-back-chip.png') })
  await page.click('[data-place-back]'); await page.waitForTimeout(500)
  now = await cards(page)
  const back = await state()
  check('back from a document: the same place, the same face, the opened document still selected',
    back.open === true && back.face === 'canvas' && back.breadcrumbs.join('/') === 'Files/Kitchen' && !!now['Plan']
      && back.rows.filter((r: any) => r.selected).map((r: any) => r.label).join() === 'Plan', JSON.stringify(back))
  await page.click('nav[aria-label="Folder path"] button:has-text("Files")'); await page.waitForTimeout(500)
  now = await cards(page)
  await page.mouse.dblclick(centre(now['gamma.txt']!).x, centre(now['gamma.txt']!).y); await page.waitForTimeout(500)
  check('open file: a file opens in the reader page (Back, the name, Download)', (await state()).preview?.name === 'gamma.txt'
    && await page.locator('.mn-files-pane .reader-row [data-action="back"]').count() === 1)
  await page.click('.mn-files-pane .reader-row [data-action="back"]'); await page.waitForTimeout(400)
  const afterFile = await state()
  check('back from a file: the place again with the selection kept', afterFile.preview === null && afterFile.rows.filter((r: any) => r.selected).map((r: any) => r.label).join() === 'gamma.txt', JSON.stringify(afterFile.rows))

  // a document is rename-able and trash-able in the place; this cell cannot trash a document yet, so it says so and removes nothing
  await page.evaluate(() => document.querySelector('nav[aria-label="Folder path"]'))
  await page.evaluate(() => {
    const node = { id: 'fld-native', label: 'Kitchen', kind: 'folder', section: 'documents', parentId: null }
    document.querySelector('mn-sidebar-panel')!.dispatchEvent(new CustomEvent('mn-sidebar-node-open', { bubbles: true, composed: true, detail: { id: 'fld-native', node } }))
  })
  await page.waitForFunction(() => document.querySelector('mn-files-canvas')?.shadowRoot?.querySelectorAll('.card').length === 2)
  now = await cards(page)
  await page.mouse.click(centre(now['Plan']!).x, centre(now['Plan']!).y); await page.waitForTimeout(200)
  await page.keyboard.press('F2'); await page.waitForTimeout(200)
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('Kitchen plan'); await page.keyboard.press('Enter'); await page.waitForTimeout(700)
  check('rename: a document is renamed in the place, through the cell\'s document tool', cell.documents.get('doc-plan')?.title === 'Kitchen plan', [...cell.documents.values()])
  await page.keyboard.press('Delete'); await page.waitForTimeout(500)
  const refused = await state()
  check('trash: a document on a cell without document trash is refused in a sentence and stays', cell.documents.has('doc-plan')
    && /can't go to the trash yet/.test(refused.status?.message ?? '') && refused.status?.message.includes('nothing was removed'), refused.status)
  await page.click('nav[aria-label="Folder path"] button:has-text("Files")'); await page.waitForTimeout(500)
  now = await cards(page)
  // moving a file into the native folder: a cell still fenced says so before anything is sent
  const posts = cell.requests.length
  await drag(page, centre(now['alpha.txt']!), centre(now['Kitchen']!)); await page.waitForTimeout(500)
  const fenced = await state()
  check('move: a file into a native folder is refused in a sentence by a cell that still has the fence',
    /can't go into “Kitchen” yet/.test(fenced.status?.message ?? '') && [...cell.artifacts.values()].find(a => a.value.label === 'alpha.txt')?.value.parentId === null
      && !cell.requests.slice(posts).some(r => r.method === 'PATCH'), fenced.status)

  // the one Trash: a file to the trash, then the Trash view lists it; Restore brings it back; Delete forever asks first
  now = await cards(page)
  await page.mouse.click(centre(now['beta.txt']!).x, centre(now['beta.txt']!).y); await page.waitForTimeout(200)
  await page.keyboard.press('Delete'); await page.waitForTimeout(600)
  await page.click('.mn-files-pane [data-action="trash"]'); await page.waitForTimeout(600)
  let trash = (await state()).trash
  check('trash: the one Trash view lists what was deleted, with Restore and Delete forever', trash?.items.map((i: any) => i.label).join() === 'beta.txt' && trash.canPurge === true
    && await page.locator('.mn-files-pane [data-trash] [data-action="restore"]').count() === 1 && await page.locator('.mn-files-pane [data-trash] [data-action="purge"]').count() === 1, JSON.stringify(trash))
  await page.screenshot({ path: resolve(shots, '05-trash.png') })
  await page.click('.mn-files-pane [data-trash] [data-action="purge"]'); await page.waitForTimeout(300)
  trash = (await state()).trash
  check('trash: Delete forever asks first and nothing is deleted until it is confirmed', !!trash.items[0].confirm && cell.trash.size === 1, JSON.stringify(trash))
  await page.click('.mn-files-pane [data-trash] [data-action="cancel-purge"]'); await page.waitForTimeout(200)
  await page.click('.mn-files-pane [data-trash] [data-action="restore"]'); await page.waitForTimeout(700)
  check('trash: Restore puts it back, and the Trash is empty', cell.trash.size === 0 && [...cell.artifacts.values()].some(a => a.value.label === 'beta.txt') && (await state()).trash.items.length === 0)
  await page.click('.mn-files-pane [data-trash] ~ * [data-action="back"], .mn-files-pane header [data-action="back"]'); await page.waitForTimeout(300)
  check('trash: Back returns to the place', (await state()).trash === null)
  check('errors: none thrown in the page', errors.length === 0, errors)

} catch (error) {
  failed++; console.log('FAIL (threw)', error)
} finally {
  await browser.close(); await server.close(); await cell.close?.()
}
process.exit(failed ? 1 : 0)
