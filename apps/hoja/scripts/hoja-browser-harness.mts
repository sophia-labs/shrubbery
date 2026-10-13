#!/usr/bin/env node

import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer, type Plugin } from 'vite'

async function main(): Promise<void> {
  const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  const artifactDir = process.env.HOJA_BROWSER_ARTIFACT_DIR?.trim()
    || join(tmpdir(), 'hoja-browser-artifacts')
  const fixture = new SeedFixture()
  // Soil (local) mode keys suite gates on the build's opt-ins, like Garden's
  // local builds: this harness exercises the Choreograph entry, so opt in.
  process.env.VITE_SHRUBBERY_FEATURES ||= 'hoja-v2,choreograph'
  const server = await createServer({
    root: appRoot,
    configFile: false,
    logLevel: 'error',
    plugins: [fixture.plugin()],
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    await mkdir(artifactDir, { recursive: true })
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Vite did not expose a TCP port')
    const appUrl = `http://127.0.0.1:${address.port}`

    browser = await chromium.launch({ headless: process.env.HEADED !== '1' })
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 } })
    page.on('console', message => {
      if (message.type() === 'error') process.stderr.write(`[hoja-browser console] ${message.text()}\n`)
    })
    await page.goto(appUrl, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'New leaf' }).waitFor()
    await page.screenshot({ path: join(artifactDir, '01-initial.png'), fullPage: true })

    await page.getByRole('button', { name: 'New leaf' }).click()
    const editor = page.locator('hoja-editor .ProseMirror')
    await editor.waitFor()
    await editor.fill('Browser leaf\n\nPersisted through the real Hoja editor.')
    await page.locator('.save-state[data-state="saved"]').waitFor({ timeout: 10_000 })
    if (fixture.saveCount !== 1) throw new Error(`expected one autosave, observed ${fixture.saveCount}`)
    await page.screenshot({ path: join(artifactDir, '02-autosaved.png'), fullPage: true })

    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Browser leaf/ }).waitFor()
    await expectEditorText(page, 'Browser leaf')
    await page.screenshot({ path: join(artifactDir, '03-reloaded.png'), fullPage: true })

    await page.getByRole('button', { name: /Welcome leaf/ }).click()
    await expectEditorText(page, 'Welcome leaf')
    await page.getByRole('button', { name: /Browser leaf/ }).click()
    await expectEditorText(page, 'Persisted through the real Hoja editor.')
    await page.screenshot({ path: join(artifactDir, '04-reopened.png'), fullPage: true })

    // The outline affordance must change structure, survive autosave, and reload.
    await page.locator('hoja-editor .ProseMirror .outliner-node-button').first().click()
    await page.getByRole('menuitem', { name: 'Indent' }).click()
    await page.locator('.save-state[data-state="saved"]').waitFor({ timeout: 10_000 })
    const indented = await page.locator('hoja-editor').evaluate(element =>
      (element as HTMLElement & { getJSON(): { content?: Array<{ attrs?: { indent?: number } }> } }).getJSON().content?.[0]?.attrs?.indent,
    )
    if (indented !== 1) throw new Error(`outline indent did not apply: ${indented}`)
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Browser leaf/ }).click()
    const restoredIndent = await page.locator('hoja-editor').evaluate(element =>
      (element as HTMLElement & { getJSON(): { content?: Array<{ attrs?: { indent?: number } }> } }).getJSON().content?.[0]?.attrs?.indent,
    )
    if (restoredIndent !== 1) throw new Error(`outline indent was lost on reload: ${restoredIndent}`)

    // Search results come from the active store and insertion navigates to the target.
    await page.getByRole('button', { name: 'Link a document' }).click()
    await page.getByRole('option', { name: /Welcome leaf/ }).waitFor({ timeout: 10_000 })
    await page.getByRole('option', { name: /Welcome leaf/ }).click()
    await page.locator('.save-state[data-state="saved"]').waitFor({ timeout: 10_000 })
    await page.locator('hoja-editor .wikilink').filter({ hasText: 'Welcome leaf' }).click()
    await expectEditorText(page, 'A durable starting note.')

    fixture.failNextSave = true
    await editor.fill('A note that must survive a failed save.')
    await page.locator('.save-state[data-state="error"]').waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: /Browser leaf/ }).click()
    await expectEditorText(page, 'Browser leaf')
    await page.getByRole('button', { name: /A note that must survive/ }).click()
    await expectEditorText(page, 'A note that must survive a failed save.')

    // The shared suite launcher remains reachable in both desktop and mobile
    // editor postures. Leaving an edited page must flush the pending save.
    for (const targetApp of ['garden', 'choreograph'] as const) {
      const navPage = await browser.newPage({ viewport: targetApp === 'choreograph'
        ? { width: 390, height: 844 } : { width: 1180, height: 820 } })
      await navPage.route('http://127.0.0.1:5191/**', route => route.fulfill({
        contentType: 'text/html', body: '<!doctype html><title>Suite destination</title>',
      }))
      await navPage.goto(appUrl, { waitUntil: 'networkidle' })
      if (targetApp === 'choreograph') {
        const list = await navPage.locator('hoja-app aside').evaluate(element => element.getBoundingClientRect().toJSON())
        const barBottom = await navPage.locator('hoja-app mn-top-bar').evaluate(element => element.getBoundingClientRect().bottom)
        if (list.top < barBottom || list.bottom > 845) throw new Error(`mobile Hoja list escaped the viewport: ${JSON.stringify(list)}`)
        // One bar, no overflow: every control of the shared bar fits a 390px phone.
        const overflow = await navPage.locator('hoja-app mn-top-bar').evaluate(element => {
          const bar = element.getBoundingClientRect()
          return [...element.shadowRoot!.querySelectorAll<HTMLElement>('.app-picker, .app-toolbar button, .actions > :not([hidden])')]
            .map(node => node.getBoundingClientRect())
            .filter(box => box.width > 0 && (box.left < bar.left - 0.5 || box.right > bar.right + 0.5)).length
        })
        if (overflow) throw new Error(`mobile Hoja top bar overflows by ${overflow} control(s)`)
        await navPage.screenshot({ path: join(artifactDir, '05-mobile-list.png') })
      }
      await navPage.getByRole('button', { name: /Browser leaf/ }).click()
      if (targetApp === 'choreograph') {
        await navPage.locator('hoja-app main').waitFor({ state: 'visible' })
        const main = await navPage.locator('hoja-app main').evaluate(element => element.getBoundingClientRect().toJSON())
        const barBottom = await navPage.locator('hoja-app mn-top-bar').evaluate(element => element.getBoundingClientRect().bottom)
        if (main.top < barBottom || main.bottom > 845) throw new Error(`mobile Hoja editor escaped the viewport: ${JSON.stringify(main)}`)
        const before = fixture.saveCount
        await navPage.locator('hoja-editor .ProseMirror').fill('Saved while switching apps.')
        await navPage.locator('mn-top-bar .app-picker').click()
        await navPage.locator('mn-top-bar .app-switcher').evaluate(async panel => {
          await Promise.all(panel.getAnimations().map(animation => animation.finished.catch(() => undefined)))
        })
        await waitForAppPicker(navPage)
        await navPage.screenshot({ path: join(artifactDir, '05-mobile-app-picker.png') })
        await navPage.locator('mn-top-bar [role="menuitemradio"][data-app-id="choreograph"]').click()
        await navPage.waitForURL(url => url.host === '127.0.0.1:5191')
        if (fixture.saveCount !== before + 1) throw new Error('pending Hoja edit was not saved before app navigation')
      } else {
        await navPage.locator('mn-top-bar .app-picker').click()
        await navPage.locator('mn-top-bar .app-switcher').evaluate(async panel => {
          await Promise.all(panel.getAnimations().map(animation => animation.finished.catch(() => undefined)))
        })
        await waitForAppPicker(navPage)
        await navPage.screenshot({ path: join(artifactDir, '05-desktop-app-picker.png') })
        await navPage.locator('mn-top-bar [role="menuitemradio"][data-app-id="garden"]').click()
        await navPage.waitForURL(url => url.host === '127.0.0.1:5191')
      }
      const destination = new URL(navPage.url())
      if (destination.searchParams.get('app') !== (targetApp === 'choreograph' ? 'choreograph' : null)) {
        throw new Error(`${targetApp} launcher used the wrong route: ${destination.href}`)
      }
      await navPage.close()
    }

    process.stdout.write(`[hoja-browser] PASS ${JSON.stringify({
      created: fixture.createdIds,
      saveCount: fixture.saveCount,
      restoredIndent,
      artifactDir,
    })}\n`)
  } finally {
    await browser?.close()
    await server.close()
  }
}

async function expectEditorText(page: import('playwright').Page, text: string): Promise<void> {
  await page.locator('hoja-editor .ProseMirror').filter({ hasText: text }).waitFor({ timeout: 10_000 })
}

async function waitForAppPicker(page: import('playwright').Page): Promise<void> {
  await page.waitForFunction(() => {
    const hoja = document.querySelector('hoja-app')
    const panel = hoja?.shadowRoot?.querySelector('mn-top-bar')?.shadowRoot?.querySelector<HTMLElement>('.app-switcher')
    return panel?.matches(':popover-open') && getComputedStyle(panel).opacity === '1'
      && panel.getBoundingClientRect().height > 0
  })
}

interface FixtureSeed {
  id: string
  title: string
  markdown: string
  modified_ms: number
  json?: unknown
}

class SeedFixture {
  readonly createdIds: string[] = []
  saveCount = 0
  failNextSave = false
  private clock = 1
  private readonly seeds = new Map<string, FixtureSeed>([
    ['welcome-leaf', {
      id: 'welcome-leaf',
      title: 'Welcome leaf',
      markdown: '# Welcome leaf\n\nA durable starting note.',
      modified_ms: 1,
    }],
  ])

  constructor(demo = false) {
    if (!demo) return
    this.seeds.clear()
    this.clock = Date.now()
    for (const [index, seed] of [
      { id: 'first-light', title: 'First light', markdown: '# First light\n\nA small thought about the morning, the open window, and what to keep close today.' },
      { id: 'field-notes', title: 'Field notes', markdown: '# Field notes\n\nThe best ideas usually begin as fragments. Give them a place to land.' },
      { id: 'weekend-garden', title: 'Weekend garden', markdown: '# Weekend garden\n\nRepot the rosemary. Read by the window. Call a friend.' },
      { id: 'welcome-leaf', title: 'Welcome to Hoja', markdown: '# Welcome to Hoja\n\nEach leaf is a quiet page. Write a thought, leave it here, and return when it grows.' },
    ].entries()) {
      this.seeds.set(seed.id, { ...seed, modified_ms: this.clock - index * 86_400_000 })
    }
  }

  plugin(): Plugin {
    return {
      name: 'hoja-browser-seed-contract',
      configureServer: server => {
        server.middlewares.use('/api/seeds', async (request, response) => {
          try {
            await this.handle(request, response)
          } catch (error) {
            response.statusCode = 500
            response.setHeader('content-type', 'application/json')
            response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
          }
        })
      },
    }
  }

  private async handle(
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    const method = request.method ?? 'GET'
    const suffix = (request.url ?? '/').replace(/^\/+/, '')
    if (method === 'GET' && suffix === '') {
      return json(response, 200, {
        seeds: [...this.seeds.values()]
          .sort((left, right) => right.modified_ms - left.modified_ms)
          .map(seed => ({
            id: seed.id,
            title: seed.title,
            snippet: seed.markdown.split(/\n+/).slice(1).join(' ').trim(),
            modified_ms: seed.modified_ms,
          })),
      })
    }
    if (method === 'POST' && suffix === '') {
      const id = `browser-leaf-${this.createdIds.length + 1}`
      this.createdIds.push(id)
      this.seeds.set(id, { id, title: 'New leaf', markdown: '', modified_ms: ++this.clock })
      return json(response, 200, { id })
    }
    const id = decodeURIComponent(suffix)
    const seed = this.seeds.get(id)
    if (!seed) return json(response, 404, { error: 'missing seed' })
    if (method === 'GET') return json(response, 200, seed)
    if (method === 'POST') {
      if (this.failNextSave) {
        this.failNextSave = false
        throw new Error('injected save failure')
      }
      const document = await requestJson(request)
      const markdown = renderTipTap(document)
      const title = markdown.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').trim() || 'New leaf'
      this.seeds.set(id, { id, title, markdown, json: document, modified_ms: ++this.clock })
      this.saveCount += 1
      return json(response, 200, {
        ok: true,
        title,
        snippet: markdown.split(/\n+/).slice(1).join(' ').trim(),
        modified_ms: this.clock,
      })
    }
    json(response, 405, { error: 'method not allowed' })
  }
}

function renderTipTap(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('save body is not TipTap JSON')
  const node = value as { type?: unknown, attrs?: { level?: unknown }, text?: unknown, content?: unknown[] }
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : ''
  if (node.type === 'hardBreak') return '\n'
  const content = Array.isArray(node.content) ? node.content.map(renderTipTap) : []
  if (node.type === 'heading') {
    const level = typeof node.attrs?.level === 'number' ? Math.min(6, Math.max(1, node.attrs.level)) : 1
    return `${'#'.repeat(level)} ${content.join('')}`
  }
  if (node.type === 'paragraph') return content.join('')
  if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'doc') {
    return content.filter(Boolean).join('\n\n')
  }
  if (node.type === 'listItem') return `- ${content.filter(Boolean).join('\n  ')}`
  return content.join('')
}

async function requestJson(request: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function json(response: import('node:http').ServerResponse, status: number, value: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(value))
}

if (process.env.HOJA_PREVIEW === '1') {
  const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  const fixture = new SeedFixture(true)
  const server = await createServer({
    root: appRoot,
    configFile: false,
    logLevel: 'warn',
    plugins: [fixture.plugin()],
    server: { host: '127.0.0.1', port: 5190, strictPort: true },
  })
  await server.listen()
  process.stdout.write('[hoja-preview] http://127.0.0.1:5190/ (local seed fixture)\n')
} else {
  await main()
}
