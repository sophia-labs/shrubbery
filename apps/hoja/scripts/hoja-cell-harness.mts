#!/usr/bin/env node
/**
 * Hoja over a REAL gardend cell, in real browsers (QA 2026-09-23 battery).
 *
 *   GARDEND_BIN=…/gardend pnpm --filter @shrubbery/hoja-app test:cell-browser
 *
 * The app is served by Vite from this checkout's index.html with the entry
 * swapped for tests/support/cell-harness-entry.ts (real HojaApp + CellStore).
 * The proxy at /__cell/mcp only adds the loopback token; it can also hold,
 * fail, or delay calls on request, which is how the races in the QA report
 * are made deterministic. Every check prints PASS/FAIL; any FAIL exits 1.
 * HOJA_EVIDENCE_DIR + HOJA_EVIDENCE_LABEL collect screenshots and a JSON log.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Browser, type BrowserContext, chromium, firefox, type Page, webkit } from 'playwright'
import { createServer, type Plugin } from 'vite'
import { gardendBinary, LocalCell, paragraphs } from '../tests/support/local-cell.ts'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const evidenceDir = process.env.HOJA_EVIDENCE_DIR?.trim() || ''
const label = process.env.HOJA_EVIDENCE_LABEL?.trim() || 'run'
const only = new Set((process.env.HOJA_CHECKS ?? '').split(',').map(item => item.trim()).filter(Boolean))
const graphId = 'hoja-harness'

interface Result { readonly check: string, readonly pass: boolean, readonly detail: unknown }
const results: Result[] = []

function record(check: string, pass: boolean, detail: unknown): void {
  results.push({ check, pass, detail })
  process.stdout.write(`[hoja-cell] ${pass ? 'PASS' : 'FAIL'} ${check} ${JSON.stringify(detail)}\n`)
}

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  if (!evidenceDir) return
  await page.screenshot({ path: join(evidenceDir, `${label}-${name}.png`), fullPage }).catch(() => undefined)
}

class Faults {
  holdWrites = false
  failWrites = 0
  delayReadsExcept: { id: string, ms: number, count: number } | null = null
  writes: Array<{ at: number, documentId: unknown, expectedRevision: unknown }> = []
  private held: Array<() => void> = []

  release(): void {
    this.holdWrites = false
    for (const resume of this.held.splice(0)) resume()
  }

  async waitHeld(count = 1, timeoutMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (this.held.length < count) {
      if (Date.now() > deadline) return false
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    return true
  }

  hold(): Promise<void> {
    return new Promise(resolve => this.held.push(resolve))
  }
}

function proxy(cell: LocalCell, faults: Faults): Plugin {
  const indexHtml = readFile(join(appRoot, 'index.html'), 'utf8')
  return {
    name: 'hoja-cell-proxy',
    configureServer(server) {
      server.middlewares.use(async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
        const url = new URL(request.url ?? '/', 'http://harness')
        try {
          if (url.pathname === '/__cell.html') {
            const html = (await indexHtml).replace('./src/main.ts', '/tests/support/cell-harness-entry.ts')
            response.setHeader('content-type', 'text/html')
            response.end(await server.transformIndexHtml(url.pathname + url.search, html))
            return
          }
          if (url.pathname === '/__cell/graphs') {
            response.setHeader('content-type', 'application/json')
            response.end(JSON.stringify([{ graphId, title: 'Hoja harness', role: 'editor', cellState: 'running' }]))
            return
          }
          if (url.pathname !== '/__cell/mcp') return next()
          const chunks: Buffer[] = []
          for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          const body = Buffer.concat(chunks).toString('utf8')
          const rpc = JSON.parse(body) as { params?: { name?: string, arguments?: Record<string, unknown> } }
          const tool = rpc.params?.name
          const args = rpc.params?.arguments ?? {}
          if (tool === 'write_document') {
            faults.writes.push({ at: Date.now(), documentId: args.documentId, expectedRevision: args.expectedRevision })
            if (faults.failWrites > 0) {
              faults.failWrites -= 1
              response.statusCode = 503
              response.end('injected outage')
              return
            }
            if (faults.holdWrites) await faults.hold()
          }
          const delay = faults.delayReadsExcept
          if (tool === 'read_document' && delay && delay.count > 0 && args.documentId !== delay.id) {
            delay.count -= 1
            await new Promise(resolve => setTimeout(resolve, delay.ms))
          }
          const upstream = await fetch(cell.manifest.mcpUrl, { method: 'POST', headers: cell.headers(), body })
          response.statusCode = upstream.status
          response.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json')
          response.end(await upstream.text())
        } catch (error) {
          response.statusCode = 500
          response.end(String(error))
        }
      })
    },
  }
}

const LONG = Array.from({ length: 160 }, (_, index) => `Paragraph ${index + 1}: the long document keeps going so the page has to scroll well past the fold.`)
const LIST_DOC = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Lists and nesting' }] },
    { type: 'listItem', attrs: { listType: 'ordered', indent: 0 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First step' }] }] },
    { type: 'listItem', attrs: { listType: 'ordered', indent: 0 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second step' }] }] },
    { type: 'listItem', attrs: { listType: 'bullet', indent: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested detail' }] }] },
    { type: 'listItem', attrs: { listType: 'bullet', indent: 2 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Deeper detail' }] }] },
    { type: 'listItem', attrs: { listType: 'task', indent: 0, checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A task to do' }] }] },
    { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: `const line = "${'a very long code line that must not be clipped '.repeat(4)}"` }] },
  ],
}

async function seed(cell: LocalCell): Promise<void> {
  const write = (documentId: string, title: string, tiptapJson: unknown) =>
    cell.call('write_document', { graphId, documentId, title, tiptapJson, awaitDurable: true })
  await cell.call('create_document', { graphId, documentId: 'empty-doc', title: 'Empty doc' })
  await write('animals', 'Animals', paragraphs('Animals', 'A quiet zebra grazes by the river.'))
  await write('lists', 'Lists and nesting', LIST_DOC)
  await write('long', 'Long scroll test', paragraphs('Long scroll test', ...LONG))
  await write('concurrent', 'Concurrent edit target', paragraphs('Concurrent edit target', 'Line two from seed.'))
  await write('beta', 'Beta note', paragraphs('Beta note', 'Beta body.'))
  await write('alpha', 'Alpha note', paragraphs('Alpha note', 'Alpha body.'))
}

async function openApp(context: BrowserContext, base: string, query = ''): Promise<Page> {
  const page = await context.newPage()
  // tsx keeps function names with an __name helper that page.evaluate lacks.
  await page.addInitScript('window.__name = (fn) => fn')
  page.on('pageerror', error => process.stderr.write(`[hoja-cell page error] ${error.message}\n`))
  await page.goto(`${base}/__cell.html${query}`, { waitUntil: 'domcontentloaded' })
  await page.locator('hoja-app .row').first().waitFor({ timeout: 30_000 })
  return page
}

async function openRow(page: Page, title: RegExp, text: string): Promise<void> {
  await page.locator('hoja-app .row').filter({ hasText: title }).first().click()
  await page.locator('hoja-editor .ProseMirror').filter({ hasText: text }).waitFor({ timeout: 20_000 })
}

async function editorText(page: Page): Promise<string> {
  return (await page.locator('hoja-editor .ProseMirror').first().textContent({ timeout: 5_000 }).catch(() => '')) ?? ''
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, stepMs = 150): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate().catch(() => false)) return true
    if (Date.now() > deadline) return false
    await new Promise(resolve => setTimeout(resolve, stepMs))
  }
}

function want(name: string): boolean {
  return only.size === 0 || only.has(name)
}

async function checkWheel(browserName: string, browser: Browser, base: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  try {
    const page = await openApp(context, base)
    await openRow(page, /Long scroll test/, 'Paragraph 3:')
    const box = await page.locator('hoja-editor .ProseMirror p').nth(4).boundingBox()
    if (!box) throw new Error('no paragraph box')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    for (let step = 0; step < 5; step += 1) {
      await page.mouse.wheel(0, 300)
      await page.waitForTimeout(120)
    }
    await page.waitForTimeout(400)
    const scrolled = await page.evaluate(() => {
      const main = document.querySelector('hoja-app')?.shadowRoot?.querySelector('main')
      return Math.max(main?.scrollTop ?? 0, document.scrollingElement?.scrollTop ?? 0)
    })
    await shot(page, `scroll-${browserName}`)
    record(`wheel-scroll-over-text/${browserName}`, scrolled >= 600, { scrolled })
  } finally {
    await context.close()
  }
}

async function checkNewLeaf(browser: Browser, base: string, cell: LocalCell): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  try {
    const page = await openApp(context, base)
    await openRow(page, /Alpha note/, 'Alpha body.')
    const before = await cell.documentIds(graphId)
    await page.locator('hoja-app mn-top-bar [data-app-action="new-note"]').click()
    await page.locator('hoja-app mn-top-bar [data-app-action="new-note"]').click()
    await page.waitForTimeout(1500)
    const afterClicks = await cell.documentIds(graphId)
    record('new-leaf/no-orphan-per-click', afterClicks.length === before.length, { before: before.length, afterClicks: afterClicks.length })
    const focusedEmpty = await page.evaluate(() => {
      const editor = document.querySelector('hoja-app')?.shadowRoot?.querySelector('hoja-editor .ProseMirror')
      return { text: editor?.textContent ?? null, focused: editor ? editor.matches(':focus') || editor.contains(editor.ownerDocument.activeElement) || editor === document.querySelector('hoja-app')?.shadowRoot?.activeElement : false }
    })
    record('new-leaf/opens-empty-focused-editor', focusedEmpty.text === '' && focusedEmpty.focused, focusedEmpty)
    await page.keyboard.type('Fresh thought')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Typed without clicking')
    await page.locator('hoja-app .save-state[data-state="saved"]').waitFor({ timeout: 20_000 }).catch(() => undefined)
    await page.waitForTimeout(500)
    await shot(page, 'new-leaf')
    const alpha = await cell.markdown(graphId, 'alpha')
    const created = (await cell.documentIds(graphId)).filter(id => !before.includes(id))
    const createdBody = created.length === 1 ? await cell.markdown(graphId, created[0]!) : ''
    record('new-leaf/keystrokes-land-in-new-leaf', !alpha.includes('Fresh thought') && created.length === 1 && createdBody.includes('Typed without clicking'), {
      alphaTouched: alpha.includes('Fresh thought'), created, createdBody,
    })
    await page.locator('hoja-app .row').filter({ hasText: /Empty doc/ }).first().click()
    await page.locator('hoja-app .editor-bar-title').filter({ hasText: /Empty doc/ }).waitFor({ timeout: 15_000 }).catch(() => undefined)
    await page.waitForTimeout(300)
    const error = await page.locator('hoja-app .load-error').count()
    const title = await page.locator('hoja-app .editor-bar-title').textContent()
    record('empty-doc/opens', error === 0 && /Empty doc|New leaf/.test(title ?? ''), { error, title })
  } finally {
    await context.close()
  }
}

async function checkConcurrency(browser: Browser, base: string, cell: LocalCell, faults: Faults): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  try {
    const page = await openApp(context, base, '?pollMs=1000')
    await openRow(page, /Concurrent edit target/, 'Line two from seed.')
    await cell.call('write_document', {
      graphId, documentId: 'concurrent', title: 'Concurrent edit target',
      tiptapJson: paragraphs('Concurrent edit target', 'Line two from seed.', 'Line three FROM MCP.'), awaitDurable: true,
    })
    const live = await waitFor(async () => (await editorText(page)).includes('Line three FROM MCP.'), 15_000)
    record('concurrency/open-doc-refreshes', live, { editor: (await editorText(page)).slice(0, 120) })

    faults.holdWrites = true
    await page.locator('hoja-editor .ProseMirror p').last().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' +browser')
    const held = await faults.waitHeld(1, 10_000)
    await cell.call('write_document', {
      graphId, documentId: 'concurrent', title: 'Concurrent edit target',
      tiptapJson: paragraphs('Concurrent edit target', 'Line two from seed.', 'Line three FROM MCP.', 'Line four FROM AGENT.'), awaitDurable: true,
    })
    faults.release()
    const conflictShown = await waitFor(async () => (await page.locator('hoja-app [data-testid="conflict"]').count()) > 0, 10_000)
    await shot(page, 'conflict')
    const cellBody = await cell.markdown(graphId, 'concurrent')
    record('concurrency/stale-save-refused', held && conflictShown && cellBody.includes('Line four FROM AGENT.'), {
      held, conflictShown, agentLineSurvived: cellBody.includes('Line four FROM AGENT.'),
    })
    if (conflictShown) {
      await page.locator('hoja-app [data-testid="conflict-reload"]').click()
      const reloaded = await waitFor(async () => (await editorText(page)).includes('Line four FROM AGENT.'), 10_000)
      record('concurrency/load-latest', reloaded, { editor: (await editorText(page)).slice(-80) })
    }
  } finally {
    faults.release()
    await context.close()
  }
}

async function checkRaceAndUnload(browser: Browser, base: string, cell: LocalCell, faults: Faults): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  try {
    faults.delayReadsExcept = { id: 'beta', ms: 2000, count: 2 }
    const page = await openApp(context, base)
    await page.locator('hoja-app .row').filter({ hasText: /Beta note/ }).first().click()
    await page.waitForTimeout(4500)
    const text = await editorText(page)
    record('race/click-during-auto-open-wins', text.includes('Beta body.'), { editor: text.slice(0, 60) })
    faults.delayReadsExcept = null

    await openRow(page, /Beta note/, 'Beta body.')
    await page.locator('hoja-editor .ProseMirror p').last().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' quick-before-reload')
    page.on('dialog', dialog => { void dialog.accept() })
    await page.reload({ waitUntil: 'domcontentloaded' })
    const persisted = await waitFor(async () => (await cell.markdown(graphId, 'beta')).includes('quick-before-reload'), 8_000)
    record('unload/edit-within-debounce-persists', persisted, { beta: (await cell.markdown(graphId, 'beta')).slice(-60) })

    await page.locator('hoja-app .row').first().waitFor({ timeout: 30_000 })
    await openRow(page, /Beta note/, 'Beta body.')
    faults.failWrites = 2
    await page.locator('hoja-editor .ProseMirror p').last().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' after-outage')
    const failed = await waitFor(async () => (await page.locator('hoja-app .save-state[data-state="error"]').count()) > 0, 10_000)
    await shot(page, 'save-failed')
    const recovered = await waitFor(async () => (await cell.markdown(graphId, 'beta')).includes('after-outage'), 20_000)
    await page.locator('hoja-app .save-state[data-state="saved"]').waitFor({ timeout: 10_000 }).catch(() => undefined)
    const state = await page.locator('hoja-app .save-state').getAttribute('data-state')
    record('save/retries-after-outage', failed && recovered && state === 'saved', { failed, recovered, state })
  } finally {
    faults.delayReadsExcept = null
    faults.failWrites = 0
    await context.close()
  }
}

async function checkChrome(browser: Browser, base: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  try {
    const page = await openApp(context, base)
    const times = await page.locator('hoja-app .row-time').allTextContents()
    record('list/dates-are-real', times.length > 0 && times.every(time => !/^Dec 31$/.test(time.trim())), { times: times.slice(0, 4) })

    await page.locator('hoja-app input[type="search"]').fill('zebra')
    const found = await waitFor(async () => (await page.locator('hoja-app .row').filter({ hasText: /Animals/ }).count()) > 0, 6_000)
    record('search/matches-body-text', found, { rows: await page.locator('hoja-app .row-title').allTextContents() })
    await page.locator('hoja-app input[type="search"]').fill('')

    await openRow(page, /Lists and nesting/, 'First step')
    if (process.env.HOJA_DUMP) {
      await writeFile(process.env.HOJA_DUMP, await page.evaluate(() =>
        document.querySelector('hoja-app')?.shadowRoot?.querySelector('hoja-editor')?.outerHTML ?? ''))
    }
    const lists = await page.evaluate(() => {
      const root = document.querySelector('hoja-app')?.shadowRoot?.querySelector('hoja-editor .ProseMirror')
      const items = [...(root?.querySelectorAll(':scope > li') ?? [])] as HTMLElement[]
      const textLeft = (item: HTMLElement) => {
        const range = document.createRange()
        const paragraph = item.querySelector('p')
        if (!paragraph) return -1
        range.selectNodeContents(paragraph)
        return range.getBoundingClientRect().left
      }
      const number = items[0]?.querySelector('.list-item-number') as HTMLElement | null
      const task = items.find(item => item.dataset.listType === 'task')
      const checkbox = task?.querySelector('input')?.getBoundingClientRect()
      const taskText = task?.querySelector('p')?.getBoundingClientRect()
      const pre = root?.querySelector('pre') as HTMLElement | null
      return {
        numberWidth: number?.getBoundingClientRect().width ?? 0,
        numberContent: number ? getComputedStyle(number, '::before').content : null,
        lefts: items.slice(1, 4).map(textLeft),
        taskSameLine: checkbox && taskText ? Math.abs(checkbox.top + checkbox.height / 2 - (taskText.top + taskText.height / 2)) < 12 : false,
        preOverflowX: pre ? getComputedStyle(pre).overflowX : null,
        preFits: pre ? pre.getBoundingClientRect().right <= (root!.getBoundingClientRect().right + 1) : false,
        preScrolls: pre ? pre.scrollWidth > pre.clientWidth : false,
      }
    })
    await page.mouse.move(5, 795)
    await page.locator('hoja-app input[type="search"]').focus()
    await page.waitForTimeout(250)
    const quiet = await page.evaluate(() => {
      const controls = [...(document.querySelector('hoja-app')?.shadowRoot?.querySelectorAll('hoja-editor .ProseMirror > p .outliner-control') ?? [])]
      return controls.map(control => getComputedStyle(control).opacity)
    })
    record('prose/outliner-handles-quiet-until-hover', quiet.length > 0 && quiet.every(value => value === '0'), { quiet })
    await shot(page, 'lists')
    const [second, nested, deeper] = lists.lefts
    record('lists/ordered-numbers', lists.numberWidth > 4 && /counter/.test(String(lists.numberContent)), lists)
    record('lists/nesting-visible', nested! > second! + 10 && deeper! > nested! + 10, { lefts: lists.lefts })
    record('lists/task-checkbox-inline', lists.taskSameLine, {})
    record('code/long-lines-scroll', (lists.preOverflowX === 'auto' || lists.preOverflowX === 'scroll') && lists.preFits && lists.preScrolls, lists)

    await page.locator('hoja-app summary[aria-label="Appearance controls"]').click()
    const theme = page.locator('hoja-app select[aria-label="Theme"]')
    const box = await theme.boundingBox()
    const hit = box ? await page.evaluate(({ x, y }) => {
      let node: Element | null = document.elementFromPoint(x, y)
      while (node?.shadowRoot) {
        const inner = node.shadowRoot.elementFromPoint(x, y)
        if (!inner || inner === node) break
        node = inner
      }
      return node ? `${node.tagName}.${node.className}${node.getAttribute('aria-label') ? `[${node.getAttribute('aria-label')}]` : ''}` : null
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 }) : null
    await shot(page, 'appearance')
    record('appearance/theme-reachable-with-note-open', /SELECT.*\[Theme\]/.test(hit ?? ''), { hit })
    await theme.selectOption('dark')
    await page.waitForTimeout(300)
    const dark = await page.evaluate(() => {
      const host = document.querySelector('hoja-app')!
      const topBar = host.shadowRoot!.querySelector('mn-top-bar') as HTMLElement
      // New leaf lives in the shared suite bar's app toolbar (unified top bar).
      const newLeaf = topBar.shadowRoot!.querySelector('[data-app-action="new-note"]') as HTMLElement
      const parse = (value: string) => (value.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number)
      const lum = ([r, g, b]: number[]) => {
        const channel = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
        return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!)
      }
      const barBg = getComputedStyle(topBar).getPropertyValue('--mn-top-bar-bg').trim()
      const firstStop = barBg.match(/#[0-9a-f]{6}/i)?.[0] ?? ''
      const barLum = firstStop ? lum([1, 3, 5].map(index => parseInt(firstStop.slice(index, index + 2), 16))) : 1
      const fg = lum(parse(getComputedStyle(newLeaf).color))
      const ownBg = getComputedStyle(newLeaf).backgroundColor
      const transparent = ownBg === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(ownBg)
      const bg = transparent ? barLum : lum(parse(ownBg))
      return { contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05), barBg, barLum }
    })
    await page.keyboard.press('Escape')
    await shot(page, 'dark')
    record('dark/top-bar-is-dark', dark.barLum < 0.2, dark)
    record('dark/new-button-contrast', dark.contrast >= 4.5, dark)
  } finally {
    await context.close()
  }
}

async function checkMobile(browserName: string, browser: Browser, base: string): Promise<void> {
  const device = { isMobile: browserName !== 'firefox', hasTouch: true, deviceScaleFactor: 3 }
  for (const [posture, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]] as const) {
    const context = await browser.newContext({ ...device, viewport })
    try {
      const page = await openApp(context, base)
      await shot(page, `mobile-${posture}-${browserName}-list`)
      await page.locator('hoja-app .row').filter({ hasText: /Long scroll test/ }).first().click()
      await page.locator('hoja-editor .ProseMirror').filter({ hasText: 'Paragraph 3:' }).waitFor({ timeout: 20_000 })
      await page.waitForTimeout(300)
      const layout = await page.evaluate(() => {
        const host = document.querySelector('hoja-app')!.shadowRoot!
        const first = host.querySelector('hoja-editor .ProseMirror > *') as HTMLElement
        const aside = host.querySelector('aside') as HTMLElement
        const range = document.createRange()
        range.selectNodeContents(first)
        const text = range.getBoundingClientRect()
        return {
          firstLineTop: Math.round(text.top),
          textWidthRatio: Math.round((text.width / innerWidth) * 100) / 100,
          asideVisible: aside.getBoundingClientRect().width > 0 && getComputedStyle(aside).display !== 'none',
          documentScrolls: (document.scrollingElement?.scrollHeight ?? 0) > innerHeight + 100,
        }
      })
      await shot(page, `mobile-${posture}-${browserName}-editor`)
      const topLimit = posture === 'portrait' ? 190 : 150
      record(`mobile/${posture}/${browserName}/first-line-near-top`, layout.firstLineTop <= topLimit, layout)
      record(`mobile/${posture}/${browserName}/single-pane`, !layout.asideVisible, layout)
      record(`mobile/${posture}/${browserName}/document-scrolls`, layout.documentScrolls, layout)
      if (posture === 'portrait') {
        await page.goBack({ waitUntil: 'commit', timeout: 5_000 }).catch(() => null)
        await page.waitForTimeout(500)
        const after = await page.evaluate(() => ({
          url: location.pathname,
          listVisible: (() => {
            const aside = document.querySelector('hoja-app')?.shadowRoot?.querySelector('aside') as HTMLElement | null
            return Boolean(aside && getComputedStyle(aside).display !== 'none')
          })(),
        })).catch(() => ({ url: 'left-hoja', listVisible: false }))
        record(`mobile/back-closes-editor/${browserName}`, after.url.endsWith('__cell.html') && after.listVisible, after)
      }
    } finally {
      await context.close()
    }
  }
}

async function main(): Promise<void> {
  const binary = gardendBinary()
  if (!binary) throw new Error('set GARDEND_BIN to a gardend binary (e.g. a garden checkout’s src-tauri/target/debug/examples/gardend)')
  if (evidenceDir) await mkdir(evidenceDir, { recursive: true })
  const cell = await LocalCell.start(binary)
  const faults = new Faults()
  const server = await createServer({
    root: appRoot,
    configFile: false,
    logLevel: 'error',
    plugins: [proxy(cell, faults)],
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  const browsers: Browser[] = []
  try {
    await cell.createGraph(graphId, 'Hoja harness')
    await seed(cell)
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Vite did not expose a TCP port')
    const base = `http://127.0.0.1:${address.port}`
    const engines = { chromium, webkit, firefox } as const
    for (const [name, engine] of Object.entries(engines)) {
      const browser = await engine.launch({ headless: process.env.HEADED !== '1' })
      browsers.push(browser)
      const guarded = async (check: string, run: () => Promise<void>) => {
        if (!want(check)) return
        try { await run() } catch (error) { record(`${check}/${name}/crashed`, false, { error: String(error).slice(0, 300) }) }
      }
      await guarded('wheel', () => checkWheel(name, browser, base))
      if (name !== 'firefox') await guarded('mobile', () => checkMobile(name, browser, base))
      if (name !== 'chromium') continue
      await guarded('new', () => checkNewLeaf(browser, base, cell))
      await guarded('concurrency', () => checkConcurrency(browser, base, cell, faults))
      await guarded('race', () => checkRaceAndUnload(browser, base, cell, faults))
      await guarded('chrome', () => checkChrome(browser, base))
    }
  } finally {
    for (const browser of browsers) await browser.close().catch(() => undefined)
    await server.close()
    await cell.stop()
  }
  if (evidenceDir) await writeFile(join(evidenceDir, `${label}-results.json`), `${JSON.stringify(results, null, 2)}\n`)
  const failed = results.filter(result => !result.pass)
  process.stdout.write(`[hoja-cell] ${results.length - failed.length}/${results.length} checks passed\n`)
  if (failed.length) process.exitCode = 1
}

await main()
