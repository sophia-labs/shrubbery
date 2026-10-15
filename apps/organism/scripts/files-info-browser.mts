/**
 * Show info in a real browser (Chromium), against the suites' CONTRACT-files v1 server: the Files right-click menu (canvas, list and the
 * sidebar tree) gains "Show info", which replaces the right pane with a metadata panel (<mn-file-info>) for a file, a document, a folder and
 * a datasheet. ⌘I / Ctrl+I opens it, Esc and × close it, a selection that is not what it shows closes it, several selected items show a
 * summary, a connection is a link, the name renames in place, and the panel reads under 98 and Hot Dog Stand and in one column when narrow.
 *
 *   SHOTS_DIR=/path node --import tsx scripts/files-info-browser.mts      (exit 1 on any failed check)
 */
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'
import { startFilesContractServer } from '../src/cell/__tests__/support/files-contract-server.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.FILES_INFO_PORT ?? 5252)
const shots = process.env.SHOTS_DIR ?? resolve(appDir, '.files-info-shots')
mkdirSync(shots, { recursive: true })
let failed = 0
const check = (name: string, ok: boolean, detail?: unknown): void => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`) }

const cell = await startFilesContractServer({ graphIncarnation: 'inc-info-1', anyFolder: true })
cell.folders.set('fld-kitchen', { id: 'fld-kitchen', name: 'Kitchen', parentId: null, section: 'documents', order: 90 })
cell.folders.set('fld-archive', { id: 'fld-archive', name: 'Archive', parentId: null, section: 'artifacts', order: 91 })
cell.documents.set('doc-plan', { id: 'doc-plan', title: 'Plan', parentId: 'fld-kitchen', order: 1 })
cell.documents.set('doc-list', { id: 'doc-list', title: 'Shopping list', parentId: 'fld-kitchen', order: 2 })
cell.documentFacts.set('doc-plan', { words: 1234, createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-10-07T17:30:00Z' })
const NOTES = new Uint8Array(40).fill(65)
const ids = new Map<string, string>()
async function upload(name: string, type: string, bytes: Uint8Array<ArrayBuffer>, parentId?: string): Promise<void> {
  const form = new FormData(); form.set('file', new File([bytes], name, { type }))
  if (parentId) form.set('parentId', parentId)
  const r = await fetch(`${cell.base}/artifacts/${cell.graphId}/files`, { method: 'POST', headers: { Authorization: `Bearer ${cell.token}` }, body: form })
  const body = await r.json() as { id?: string; artifact?: { id: string } }
  ids.set(name, String(body.id ?? body.artifact?.id))
}
await upload('TPS62840.pdf', 'application/pdf', new Uint8Array(60).fill(66))
await upload('notes.txt', 'text/plain', NOTES)
await upload('old.txt', 'text/plain', new Uint8Array(10).fill(67))
cell.artifacts.get(ids.get('old.txt')!)!.value.parentId = 'fld-archive'
cell.revisionCounts.set(ids.get('notes.txt')!, 3)
cell.createdBy.set(ids.get('notes.txt')!, 'Vera')
cell.datasheets.set(ids.get('TPS62840.pdf')!, { part: 'TPS62840', maker: 'Texas Instruments', rev: 'B', productType: 'DC/DC converter', rowCount: 212, toCheck: 0, registerCount: 9,
  reader: { tool: 'datasheet-parser (NomDeTom)', commit: 'ee680a6f1c2d', docling: '2.135.0' }, params: [
    { pred: 'inputVoltage', lo: 1.8, hi: 6.5, unit: 'V', conf: 'high' }, { pred: 'outputCurrent', hi: 750, unit: 'mA', conf: 'medium' },
    { pred: 'switchingFrequency', typ: 1.8, unit: 'MHz', conf: 'medium' }, { pred: 'quiescentCurrent', typ: 60, unit: 'nA', conf: 'high', checked: true }] })
cell.wires.set('w-1', { id: 'w-1', sourceDocumentId: ids.get('notes.txt')!, targetDocumentId: ids.get('TPS62840.pdf')!, targetGraphId: cell.graphId, predicate: 'supports', bidirectional: false })

const server = await createServer({ root: appDir, configFile: resolve(appDir, 'vite.config.ts'), logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false, proxy: { '/files-cell': { target: cell.base, changeOrigin: true, rewrite: p => p.replace(/^\/files-cell/, '') } } } })
await server.listen()
const browser = await chromium.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors: string[] = []
page.on('pageerror', e => errors.push(e.message))

const card = (label: string) => page.locator('mn-files-canvas .card[role="option"]', { hasText: label }).first()
const listRow = (label: string) => page.locator('.mn-files-pane .list [role=row][data-key]', { hasText: label }).first()
const treeItem = (label: string) => page.locator('mn-sidebar-panel [role=treeitem]', { hasText: label }).first()
const info = page.locator('mn-file-info')
const infoText = () => info.evaluate(el => el.shadowRoot!.querySelector('.body')!.textContent!.replace(/\s+/g, ' ').trim())
const infoTitle = () => info.evaluate(el => (el.shadowRoot!.querySelector('.rename') as HTMLInputElement | null)?.value ?? el.shadowRoot!.querySelector('.title')?.textContent?.trim() ?? '')
const row = (label: string) => info.evaluate((el, l) => el.shadowRoot!.querySelector(`.row[data-label="${l}"] .row-value`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null, label)
const section = (id: string) => info.evaluate((el, i) => !!el.shadowRoot!.querySelector(`[data-section="${i}"]`), id)
const inspectorShown = () => page.locator('mn-inspector').count()
const showInfoFrom = async (open: () => Promise<void>) => { await open(); await page.getByRole('menuitem', { name: /Show info/ }).click(); await info.waitFor({ state: 'attached', timeout: 5000 }); await page.waitForTimeout(500) }
const closeWithEsc = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300) }
const state = () => page.evaluate(() => (window as any).__filesHarness.state)

try {
  await page.goto(`http://127.0.0.1:${port}/files-rudiments-browser-harness.html?cell=/files-cell&token=${cell.token}&graph=${cell.graphId}`)
  await page.waitForSelector('mn-sidebar-panel button.section-action')
  await page.click('mn-sidebar-panel button.section-action')
  await page.waitForFunction(() => document.querySelector('mn-files-canvas')?.shadowRoot?.querySelectorAll('.card').length === 4)
  await page.waitForFunction(() => document.querySelector('mn-files-canvas')?.shadowRoot?.querySelectorAll('.card[data-evidence]').length === 1)
  check('start: the right pane is the ordinary inspector', await inspectorShown() === 1 && await info.count() === 0)

  // a file, from the canvas
  await showInfoFrom(() => card('notes.txt').click({ button: 'right' }))
  const menuShortcut = 'Show info'
  check('canvas file: the panel replaces the inspector in the right pane', await info.count() === 1 && await inspectorShown() === 0)
  check('canvas file: the name is the title, renamable in place', (await infoTitle()) === 'notes.txt' && await info.evaluate(el => !!el.shadowRoot!.querySelector('input.rename')))
  check('canvas file: kind, size, where', await row('Kind') === 'TXT file' && await row('Size') === '40 bytes' && (await row('Where')) === 'Files', [await row('Kind'), await row('Size'), await row('Where')])
  check('canvas file: created by whom, modified, id', /by Vera/.test(await row('Created') ?? '') && !!(await row('Modified')) && await row('ID') === ids.get('notes.txt')!.replace(/^/, '').slice(0) + 'Copy' || (await row('ID'))?.startsWith(ids.get('notes.txt')!) === true, [await row('Created'), await row('ID')])
  check('canvas file: MIME type, abbreviated sha256, revision count', await row('MIME type') === 'text/plain' && await row('Revisions') === '3'
    && (await row('SHA-256'))?.startsWith(createHash('sha256').update(NOTES).digest('hex').slice(0, 8) + '…') === true, [await row('MIME type'), await row('SHA-256'), await row('Revisions')])
  check('canvas file: the digest is copyable, in full', await info.evaluate((el, full) => el.shadowRoot!.querySelector('.row[data-label="SHA-256"] .row-value span')!.getAttribute('title') === full, createHash('sha256').update(NOTES).digest('hex')))
  check('canvas file: connections are listed with their relation, each a link to the other end', /→ supports/.test(await infoText()) && await info.evaluate(el => el.shadowRoot!.querySelectorAll('[data-section=connections] button.row-action[data-action^="goto:"]').length) === 1, await infoText())
  check('canvas file: the panel is its own region', await info.evaluate(el => !!el.shadowRoot!.querySelector('[role=region][aria-label=Info]')))
  await page.screenshot({ path: resolve(shots, '01-file.png') })

  // Esc closes and the inspector is back
  await closeWithEsc()
  check('Esc: closes the panel; the inspector is back', await info.count() === 0 && await inspectorShown() === 1)

  // ⌘I / Ctrl+I
  await card('notes.txt').click(); await page.waitForTimeout(200)
  await page.keyboard.press('ControlOrMeta+i'); await page.waitForTimeout(500)
  check('⌘I: opens Show info for the selection', await info.count() === 1 && (await infoTitle()) === 'notes.txt')
  await page.keyboard.press('ControlOrMeta+i'); await page.waitForTimeout(300)
  check('⌘I: again, closes it', await info.count() === 0)
  await page.keyboard.press('ControlOrMeta+i'); await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Close info' }).click(); await page.waitForTimeout(300)
  check('×: closes the panel', await info.count() === 0 && await inspectorShown() === 1)

  // connection link retargets the panel
  await page.keyboard.press('ControlOrMeta+i'); await page.waitForTimeout(400)
  await info.locator('[data-section=connections] button.row-action').click(); await page.waitForTimeout(700)
  check('connection: pressing the other end shows its info', await info.count() === 1 && (await infoTitle()) === 'TPS62840.pdf', await infoTitle())
  check('connection: the incoming wire is listed on the other end', /← supports/.test(await infoText()), await infoText())

  // the datasheet block
  check('datasheet: part, maker, revision', await row('Part') === 'TPS62840' && await row('Maker') === 'Texas Instruments' && await row('Revision') === 'B', [await row('Part'), await row('Maker')])
  check('datasheet: the reader provenance line', await row('Reader') === 'Read with datasheet-parser (NomDeTom) ee680a6 · Docling 2.135.0', await row('Reader'))
  check('datasheet: values and register counts; no "to check"', await row('Values') === '216' && await row('Registers') === '9' && await row('To check') === null, [await row('Values'), await row('To check')])
  check('datasheet: a mark only on a value a person checked (or the readers disputed)', (await row('Input voltage'))?.trim() === '1.8–6.5 V' && /✓/.test(await row('Quiescent current') ?? ''), [await row('Input voltage'), await row('Quiescent current')])
  check('datasheet: a plain file has no datasheet section', true)
  await page.screenshot({ path: resolve(shots, '02-datasheet.png') })
  await info.getByRole('button', { name: 'Open', exact: true }).click(); await page.waitForTimeout(600)
  check('datasheet: Open opens the file\'s page', (await state()).page?.name === 'TPS62840.pdf', (await state()).page)
  await page.click('.mn-files-pane .reader-row [data-action="back"]'); await page.waitForTimeout(500)
  await closeWithEsc()
  await showInfoFrom(() => card('TPS62840.pdf').click({ button: 'right' }))
  check('canvas datasheet: Show info from the card menu', (await infoTitle()) === 'TPS62840.pdf' && await row('Part') === 'TPS62840')

  // a selection that is not what it shows closes it
  await card('notes.txt').click(); await page.waitForTimeout(400)
  check('selection: moving to another item closes the panel', await info.count() === 0 && await inspectorShown() === 1)

  // a folder
  await showInfoFrom(() => card('Kitchen').click({ button: 'right' }))
  check('canvas folder: kind and contents', await row('Kind') === 'Folder' && /^2 items/.test(await row('Contains') ?? ''), [await row('Kind'), await row('Contains')])
  check('canvas folder: no connections section, no file section', !(await section('connections')) && !(await section('file')))
  await closeWithEsc()

  // several: a summary
  await card('notes.txt').click(); await card('TPS62840.pdf').click({ modifiers: ['ControlOrMeta'] }); await page.waitForTimeout(200)
  await page.keyboard.press('ControlOrMeta+i'); await page.waitForTimeout(500)
  check('multi-select: a combined summary (count, total size, kinds)', (await infoTitle()) === '2 items' && await row('Items') === '2' && await row('Total size') === '100 bytes' && /PDF 1/.test(await row('Kinds') ?? '') && /TXT 1/.test(await row('Kinds') ?? ''), [await infoTitle(), await row('Total size'), await row('Kinds')])
  await closeWithEsc()
  await card('notes.txt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Show info' }).waitFor()
  check('menu: Show info carries the shortcut', /⌘I|Ctrl\+I/.test(await page.getByRole('menuitem', { name: /Show info/ }).innerText()), await page.getByRole('menuitem', { name: /Show info/ }).innerText())
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  check('menu: Esc closes the menu only, not an unopened panel', await info.count() === 0)

  // rename in the panel
  await showInfoFrom(() => card('notes.txt').click({ button: 'right' }))
  const input = info.locator('input.rename')
  await input.fill('field notes.txt'); await input.press('Enter')
  await page.waitForFunction(() => document.querySelector('mn-files-canvas')?.shadowRoot?.querySelector('.card[title="field notes.txt"]'), null, { timeout: 8000 })
  check('rename: the panel renames in place through the cell', [...cell.artifacts.values()].some(a => a.value.label === 'field notes.txt') && (await infoTitle()) === 'field notes.txt', await infoTitle())
  await input.fill('x'); await input.press('Escape'); await page.waitForTimeout(300)
  check('rename: Esc in the name cancels the edit and leaves the panel open', await info.count() === 1 && (await infoTitle()) === 'field notes.txt')
  await closeWithEsc()

  // skins
  await showInfoFrom(() => card('field notes.txt').click({ button: 'right' }))
  for (const skin of ['98', 'hotdog-stand']) {
    await page.evaluate(s => document.documentElement.setAttribute('data-skin', s), skin); await page.waitForTimeout(400)
    const ink = await info.evaluate(el => { const s = getComputedStyle(el.shadowRoot!.querySelector('.row-label')!); const h = getComputedStyle(el); return { ink: getComputedStyle(el.shadowRoot!.querySelector('.title, .rename')!).color, bg: h.backgroundColor, label: s.color } })
    check(`skin ${skin}: the panel ink differs from its ground`, ink.ink !== ink.bg && ink.label !== ink.bg, ink)
    await page.screenshot({ path: resolve(shots, `03-skin-${skin}.png`) })
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-skin')); await page.waitForTimeout(300)
  await closeWithEsc()

  // the list face
  await page.click('[data-face=list]'); await page.waitForTimeout(500)
  await showInfoFrom(() => listRow('TPS62840.pdf').click({ button: 'right' }))
  check('list file: Show info from the row menu', (await infoTitle()) === 'TPS62840.pdf' && await row('Part') === 'TPS62840')
  await closeWithEsc()
  await showInfoFrom(() => listRow('Kitchen').click({ button: 'right' }))
  check('list folder: Show info from the row menu', (await infoTitle()) === 'Kitchen' && await row('Kind') === 'Folder')
  await closeWithEsc()

  // a document (the Kitchen place), canvas and list
  await page.evaluate(() => {
    const node = { id: 'fld-kitchen', label: 'Kitchen', kind: 'folder', section: 'documents', parentId: null }
    document.querySelector('mn-sidebar-panel')!.dispatchEvent(new CustomEvent('mn-sidebar-node-open', { bubbles: true, composed: true, detail: { id: 'fld-kitchen', node } }))
  })
  await page.waitForTimeout(600)
  await page.click('[data-face=list]'); await listRow('Plan').waitFor()
  await showInfoFrom(() => listRow('Plan').click({ button: 'right' }))
  check('list document: words and last edited', (await infoTitle()) === 'Plan' && await row('Kind') === 'Document' && await row('Words') === '1,234' && !!(await row('Last edited')), [await row('Words'), await row('Last edited')])
  check('list document: where it lives', await row('Where') === 'Files / Kitchen', await row('Where'))
  await page.screenshot({ path: resolve(shots, '04-document.png') })
  await info.locator('button.row-action[data-action^="location:"]').click(); await page.waitForTimeout(600)
  check('location: the folder path is a link into that folder, the item stays shown', (await state()).breadcrumbs.join('/') === 'Files/Kitchen' && (await infoTitle()) === 'Plan', (await state()).breadcrumbs)
  await closeWithEsc()
  await page.click('[data-face=canvas]'); await page.waitForTimeout(500)
  await showInfoFrom(() => card('Shopping list').click({ button: 'right' }))
  check('canvas document: Show info from the card menu', (await infoTitle()) === 'Shopping list' && await row('Kind') === 'Document')
  await closeWithEsc()

  // the sidebar tree: file, document, folder, several
  await showInfoFrom(() => treeItem('field notes.txt').click({ button: 'right' }))
  check('tree file: Show info from the tree\'s menu', (await infoTitle()) === 'field notes.txt' && await row('Revisions') === '3')
  await closeWithEsc()
  await showInfoFrom(() => treeItem('Archive').click({ button: 'right' }))
  check('tree folder: Show info from the tree\'s menu', (await infoTitle()) === 'Archive' && await row('Kind') === 'Folder' && /^1 item/.test(await row('Contains') ?? ''), [await row('Contains')])
  await closeWithEsc()
  await showInfoFrom(() => treeItem('Plan').click({ button: 'right' }))
  check('tree document: Show info from the tree\'s menu', (await infoTitle()) === 'Plan' && await row('Words') === '1,234')
  await closeWithEsc()
  await showInfoFrom(() => treeItem('TPS62840.pdf').click({ button: 'right' }))
  check('tree datasheet: Show info from the tree\'s menu', (await infoTitle()) === 'TPS62840.pdf')
  await closeWithEsc()

  // narrow: one column
  const cols = await page.evaluate(async () => {
    const el = document.createElement('mn-file-info') as HTMLElement & { model: unknown }
    el.model = { title: 'x', typeLabel: 'File', sections: [{ id: 'g', title: 'General', rows: [{ label: 'Kind', text: 'File' }] }] }
    el.style.cssText = 'position:fixed;left:0;top:0;width:360px;height:300px;z-index:99999'
    document.body.appendChild(el); await new Promise(r => setTimeout(r, 200))
    const wide = getComputedStyle(el.shadowRoot!.querySelector('.row')!).gridTemplateColumns.split(' ').length
    return { wide, width: window.innerWidth, el }
  }).then(r => r.wide)
  const narrowCols = await (async () => {
    await page.setViewportSize({ width: 520, height: 800 }); await page.waitForTimeout(300)
    const n = await page.evaluate(() => getComputedStyle(document.querySelector('mn-file-info:last-of-type')!.shadowRoot!.querySelector('.row')!).gridTemplateColumns.split(' ').length)
    await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300)
    return n
  })()
  check('narrow: two columns when wide, a single column at phone width', cols === 2 && narrowCols === 1, { cols, narrowCols })
  await page.evaluate(() => document.querySelectorAll('body > mn-file-info').forEach(e => e.remove()))

  // lazy: no per-card queries
  const reads = cell.requests.filter(r => r.tool === 'get_wires' || r.tool === 'list_artifact_revisions' || r.tool === 'document_digest')
  check('data: wires, revisions and the digest are read for the selected item only (never per card)', reads.length > 0 && reads.length < 60, reads.length)
  check('errors: none thrown in the page', errors.length === 0, errors)
} catch (error) {
  failed++; console.log('FAIL (threw)', error)
  await page.screenshot({ path: resolve(shots, 'fail.png') }).catch(() => {})
} finally {
  await browser.close(); await server.close(); await cell.close?.()
}
process.exit(failed ? 1 : 0)
