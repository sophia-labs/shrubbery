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

    process.stdout.write(`[hoja-browser] PASS ${JSON.stringify({
      created: fixture.createdIds,
      saveCount: fixture.saveCount,
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

interface FixtureSeed {
  id: string
  title: string
  markdown: string
  modified_ms: number
}

class SeedFixture {
  readonly createdIds: string[] = []
  saveCount = 0
  private clock = 1
  private readonly seeds = new Map<string, FixtureSeed>([
    ['welcome-leaf', {
      id: 'welcome-leaf',
      title: 'Welcome leaf',
      markdown: '# Welcome leaf\n\nA durable starting note.',
      modified_ms: 1,
    }],
  ])

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
      const document = await requestJson(request)
      const markdown = renderTipTap(document)
      const title = markdown.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').trim() || 'New leaf'
      this.seeds.set(id, { id, title, markdown, modified_ms: ++this.clock })
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

await main()
