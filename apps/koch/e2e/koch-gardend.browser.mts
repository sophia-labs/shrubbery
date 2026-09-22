/** Real Chromium + real disposable Gardend journey for the Koch golden path. */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import { createGardendLocalSource, McpClient } from '@shrubbery/source'
import { spawnGardend, type GardendCell } from '@shrubbery/source/node'
import { KOCH, kochProjectionGraphIri } from '../src/vocabulary.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`koch-browser assertion failed: ${message}`)
}

async function freePort(): Promise<number> {
  const socket = createNetServer()
  await new Promise<void>((accept, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', accept)
  })
  const address = socket.address()
  assert(address && typeof address === 'object', 'could not reserve a Vite port')
  await new Promise<void>((accept, reject) => socket.close(error => error ? reject(error) : accept()))
  return address.port
}

function chromeExecutable(): string | undefined {
  const configured = process.env.SHRUBBERY_CHROME_EXECUTABLE
    ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  if (configured) assert(existsSync(configured), `configured Chromium does not exist: ${configured}`)
  return configured
}

async function clickMnButton(page: Page, selector: string, label?: string): Promise<void> {
  const locator = label ? page.locator(selector).filter({ hasText: label }).first() : page.locator(selector).first()
  await locator.waitFor({ state: 'attached', timeout: 15_000 })
  await locator.evaluate((element: HTMLElement) => {
    // The Lit listener is attached to the host. Clicking the host keeps this
    // journey valid even when the shared component is still awaiting its own
    // first shadow render after a face replacement.
    element.click()
  })
}

async function main(): Promise<void> {
  const graphId = `morse-e2e-${randomUUID().slice(0, 8)}`
  let cell: GardendCell | undefined
  let vite: ViteDevServer | undefined
  let browser: Browser | undefined
  let context: BrowserContext | undefined
  let page: Page | undefined
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  try {
    process.stdout.write('[koch-browser] spawning real Gardend\n')
    cell = await spawnGardend()
    const mcp = new McpClient({ mcpUrl: cell.mcpUrl, token: cell.token, origin: 'http://127.0.0.1' })
    await mcp.callTool('create_graph', { graph_id: graphId, title: 'Morse E2E' })
    const source = createGardendLocalSource({ mcpUrl: cell.mcpUrl, token: cell.token, origin: 'http://127.0.0.1', graphId })

    const previousManifest = process.env.GARDEND_LOOPBACK_MANIFEST
    process.env.GARDEND_LOOPBACK_MANIFEST = resolve(cell.profileDir, 'loopback.json')
    const port = await freePort()
    vite = await createViteServer({
      root: appDir,
      configFile: resolve(appDir, 'vite.config.ts'),
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
      logLevel: 'warn',
    })
    await vite.listen()
    if (previousManifest === undefined) delete process.env.GARDEND_LOOPBACK_MANIFEST
    else process.env.GARDEND_LOOPBACK_MANIFEST = previousManifest

    browser = await chromium.launch({
      headless: true,
      ...(chromeExecutable() ? { executablePath: chromeExecutable() } : {}),
    })
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    page = await context.newPage()
    page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    await page.goto(`http://127.0.0.1:${port}/?graph=${graphId}&actor=morse-e2e&name=Morse%20E2E`, { waitUntil: 'commit', timeout: 30_000 })
    await page.waitForFunction(() => (document.querySelector('koch-app') as unknown as { backend?: string } | null)?.backend === 'online', undefined, { timeout: 60_000 })
    await page.waitForSelector('.koch-practice', { timeout: 30_000 })

    const curriculum = await source.select!(
      `SELECT (COUNT(?course) AS ?count) WHERE { GRAPH <${kochProjectionGraphIri(graphId)}> { ?course a <${KOCH.KochCourse}> . } }`,
    )
    assert(curriculum.rows[0]?.count?.value === '1', `expected one seeded KochCourse, got ${JSON.stringify(curriculum.rows)}`)

    await page.locator('.koch-practice .segmented button').filter({ hasText: /^10$/ }).click()
    await clickMnButton(page, '.koch-practice mn-button[data-primary-run]')
    await page.waitForFunction(() => Boolean((document.querySelector('koch-app') as unknown as { prompt?: unknown } | null)?.prompt))
    const expected = await page.evaluate(() => (document.querySelector('koch-app') as unknown as { prompt: { plain: string } }).prompt.plain)
    await page.locator('.koch-practice hoja-editor').evaluate((editor, copy) => {
      editor.dispatchEvent(new CustomEvent('hoja-change', { bubbles: true, composed: true, detail: { value: copy } }))
    }, expected)
    await clickMnButton(page, '.koch-practice .copy-actions mn-button', 'Check copy')
    await page.waitForFunction(() => (document.querySelector('koch-app') as unknown as { phase?: string } | null)?.phase === 'review', undefined, { timeout: 30_000 })
    const review = await page.locator('.koch-practice .review-card').innerText()
    assert(review.includes('Run recorded in Garden'), `run was not durably recorded: ${review}`)
    assert(review.includes('10 of 10 correct'), `unexpected review score: ${review}`)

    const sessions = await source.select!(
      `SELECT (COUNT(?session) AS ?count) WHERE { GRAPH <${kochProjectionGraphIri(graphId)}> { ?session a <${KOCH.PracticeSession}> . } }`,
    )
    const attempts = await source.select!(
      `SELECT (COUNT(?attempt) AS ?count) WHERE { GRAPH <${kochProjectionGraphIri(graphId)}> { ?attempt a <${KOCH.CopyAttempt}> . } }`,
    )
    assert(sessions.rows[0]?.count?.value === '1', `expected one filed session, got ${JSON.stringify(sessions.rows)}`)
    assert(attempts.rows[0]?.count?.value === '10', `expected ten filed attempts, got ${JSON.stringify(attempts.rows)}`)
    assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
    assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('\n')}`)
    process.stdout.write(`[koch-browser] PASS — ${JSON.stringify({ graphId, sessions: 1, attempts: 10 })}\n`)
  } catch (error) {
    throw new Error([
      error instanceof Error ? error.stack ?? error.message : String(error),
      consoleErrors.length ? `console errors: ${JSON.stringify(consoleErrors)}` : '',
      pageErrors.length ? `page errors: ${JSON.stringify(pageErrors)}` : '',
    ].filter(Boolean).join('\n\n'))
  } finally {
    await context?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    await vite?.close().catch(() => undefined)
    await cell?.kill().catch(() => undefined)
  }
}

await main()
