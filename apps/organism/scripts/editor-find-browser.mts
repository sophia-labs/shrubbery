/**
 * editor-find-browser.mts — does find-in-document bring you to each match?
 *
 * REPORTED: find highlighted the matches but did not take you to them.
 *
 * THE CAUSE. The search commands called `tr.scrollIntoView()`, and
 * ProseMirror only scrolls to the selection when the DOM selection is inside
 * the editor (prosemirror-view scrollToSelection). While you type in the find
 * bar, it is in the find bar's input, so nothing scrolled. The kernel's search
 * plugin now scrolls the current match into view itself.
 *
 * The run, in the real app against a real gardend, on a document long enough
 * to scroll (80 paragraphs, "needle" in paragraphs 5, 40 and 75, plus one
 * inside a FOLDED block near the end):
 *   Mod+F, type "needle"      -> match 1 of 4 is on screen
 *   Enter, Enter              -> matches 2 and 3 are on screen
 *   Enter                     -> match 4, inside the folded block, is on screen
 *                                (its fold was opened)
 *   Shift+Enter               -> back to match 3, on screen
 *
 *   SHRUBBERY_BROWSER_ENGINE=webkit pnpm -C apps/organism run test:editor-find
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
const port = Number(process.env.SHRUBBERY_FIND_PORT ?? 5298)
const engineName = process.env.SHRUBBERY_BROWSER_ENGINE ?? 'chromium'
if (engineName !== 'chromium' && engineName !== 'webkit') {
  throw new Error('SHRUBBERY_BROWSER_ENGINE must be chromium or webkit')
}
const engine = engineName === 'webkit' ? webkit : chromium
const GRAPH_ID = 'editor-find-probe'
const DOC_ID = 'find-doc'

const paragraphs: string[] = []
for (let i = 1; i <= 80; i++) {
  const needle = i === 5 || i === 40 || i === 75 ? ' with a needle in it' : ''
  paragraphs.push(`<p>Paragraph ${i}${needle}, and enough words after it to make a real line of text.</p>`)
}
paragraphs.push('<p data-collapsed="true">FOLDED parent paragraph</p>')
paragraphs.push('<p data-indent="1">A hidden child with the last needle.</p>')
paragraphs.push('<p>The closing paragraph.</p>')
const CONTENT = paragraphs.join('')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`editor-find-browser assertion failed: ${message}`)
}

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null

async function openDoc(page: Page): Promise<void> {
  await page.goto(`http://127.0.0.1:${port}/g/${GRAPH_ID}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.organismMode === 'local-cell', undefined, { timeout: 60_000 })
  await page.waitForFunction(
    () => !!document.querySelector('mn-sidebar-panel')?.shadowRoot?.querySelector('[data-file-pane-body]'),
    undefined,
    { timeout: 60_000 },
  )
  await page.evaluate((id) => {
    const panel = document.querySelector('mn-sidebar-panel') as HTMLElement | null
    const row = panel?.shadowRoot?.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null
    row?.click()
  }, DOC_ID)
  await page.waitForFunction(() => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    return (host?.shadowRoot?.querySelectorAll('.editor-mount [contenteditable="true"] > p').length ?? 0) >= 80
  }, undefined, { timeout: 60_000 })
  await page.waitForTimeout(1000)
}

interface MatchView {
  readonly count: number
  readonly currentText: string
  readonly top: number
  readonly bottom: number
  readonly viewportHeight: number
  readonly visible: boolean
}

function currentMatch(page: Page): Promise<MatchView | null> {
  return page.evaluate(() => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    const root = host?.shadowRoot
    const current = root?.querySelector('.search-match-current') as HTMLElement | null
    if (!current) return null
    const rect = current.getBoundingClientRect()
    const block = current.closest('p')
    return {
      count: root?.querySelectorAll('.search-match').length ?? 0,
      currentText: (block?.textContent ?? '').slice(0, 40),
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      viewportHeight: window.innerHeight,
      visible: rect.height > 0 ? rect.top >= 0 && rect.bottom <= window.innerHeight : false,
    }
  })
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
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'find probe' })
  await mcp.toolsCall('create_document', { graphId: GRAPH_ID, documentId: DOC_ID, title: DOC_ID })
  await mcp.toolsCall('write_document', { graphId: GRAPH_ID, documentId: DOC_ID, content: CONTENT })
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } })
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)))
  await openDoc(page)

  // Put the caret at the top, then open find and type.
  const first = await page.evaluate(() => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    const p = host?.shadowRoot?.querySelector('.editor-mount [contenteditable="true"] > p') as HTMLElement | null
    const rect = p?.getBoundingClientRect()
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
  })
  assert(first, 'the first paragraph is on screen')
  await page.mouse.click(first.x, first.y)
  await page.keyboard.press(`${mod}+f`)
  // Type only once the find input has focus: the toolbar moves focus there
  // after its own render, and earlier keystrokes would go elsewhere.
  await page.waitForFunction(() => {
    const host = document.querySelector('sh-editor-host') as HTMLElement | null
    const toolbar = host?.shadowRoot?.querySelector('mn-editor-toolbar') as HTMLElement | null
    const active = toolbar?.shadowRoot?.activeElement
    return active instanceof HTMLInputElement
  }, undefined, { timeout: 10_000 }).catch(async () => {
    const chain = await page.evaluate(() => {
      const out: string[] = []
      let root: Document | ShadowRoot | null = document
      while (root) {
        const el: Element | null = root.activeElement
        if (!el) break
        out.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}`)
        root = (el as HTMLElement).shadowRoot
      }
      const host = document.querySelector('sh-editor-host') as HTMLElement | null
      const toolbar = host?.shadowRoot?.querySelector('mn-editor-toolbar') as HTMLElement | null
      return { chain: out, inputs: toolbar?.shadowRoot?.querySelectorAll('input').length ?? -1, toolbar: !!toolbar }
    })
    throw new Error(`find input never focused: ${JSON.stringify(chain)}`)
  })
  await page.keyboard.type('needle', { delay: 40 })
  await page.waitForTimeout(500)

  const steps: Array<{ step: string; match: MatchView | null }> = []
  const record = async (step: string): Promise<MatchView | null> => {
    const match = await currentMatch(page)
    steps.push({ step, match })
    return match
  }
  const expectOnScreen = (match: MatchView | null, text: string, step: string): void => {
    assert(match, `${step}: there is a current match`)
    assert(match.currentText.includes(text), `${step}: the current match is in "${text}" (got "${match.currentText}")`)
    assert(match.visible, `${step}: the current match is on screen (top ${match.top}, bottom ${match.bottom}, viewport ${match.viewportHeight})`)
  }

  try {
    const typedState = await page.evaluate(() => {
      const host = document.querySelector('sh-editor-host') as HTMLElement | null
      const toolbar = host?.shadowRoot?.querySelector('mn-editor-toolbar') as HTMLElement | null
      const input = toolbar?.shadowRoot?.querySelector('input') as HTMLInputElement | null
      const firstBlock = host?.shadowRoot?.querySelector('.editor-mount [contenteditable="true"] > p')
      return {
        searchInput: input?.value ?? null,
        matches: host?.shadowRoot?.querySelectorAll('.search-match').length ?? 0,
        firstBlock: (firstBlock?.textContent ?? '').slice(0, 50),
        scrollY: window.scrollY,
      }
    })
    console.log('typed state', JSON.stringify(typedState))
    const m1 = await record('typed')
    assert(m1?.count === 4, `four matches, including the folded one (${m1?.count})`)
    expectOnScreen(m1, 'Paragraph 5 ', 'typed')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    expectOnScreen(await record('enter 1'), 'Paragraph 40 ', 'enter 1')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    expectOnScreen(await record('enter 2'), 'Paragraph 75 ', 'enter 2')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    expectOnScreen(await record('enter 3 (folded)'), 'A hidden child', 'enter 3 (folded)')
    await page.keyboard.press('Shift+Enter')
    await page.waitForTimeout(500)
    expectOnScreen(await record('shift+enter'), 'Paragraph 75 ', 'shift+enter')
  } finally {
    console.log(JSON.stringify({ engine: engineName, steps, pageErrors }, null, 2))
  }
  console.log('\nFind brings each match on screen, including one inside a folded block.')
} finally {
  await browser?.close()
  await server?.close()
  await cell?.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
}
