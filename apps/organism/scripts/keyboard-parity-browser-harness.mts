/**
 * Real Chromium + real gardend proof for FID-007's bounded keyboard slice.
 *
 * Proves production Organism routing, not the in-memory harness:
 *   Mod+Alt+N -> real create dialog -> create_document -> opened editor
 *   F2        -> real rename dialog -> rename_document -> backend title
 *   F6        -> navigation -> main -> complementary; Shift+F6 reverses
 * It also proves the global document shortcuts do not fire from dialog inputs.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer as createNetServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer as createViteServer, type ProxyOptions, type ViteDevServer } from 'vite'
import {
  createGraphAndSeedUxConfig,
  resolveGardendBin,
  spawnGardend,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient, mcpText } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const graphId = `keyboard-parity-${randomUUID()}`
const createdTitle = `Keyboard Created ${randomUUID().slice(0, 8)}`
const renamedTitle = `Keyboard Renamed ${randomUUID().slice(0, 8)}`
const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const require_ = createRequire(import.meta.url)
const nucleusEntry = require_.resolve('@shrubbery/nucleus')
const seedPath = resolve(dirname(nucleusEntry), 'workspace/__generated__/garden-default.ux.nt')
const seedNt = readFileSync(seedPath, 'utf8')

function workspaceProjectionGraphIri(id: string): string {
  return `urn:mnemosyne:local:graph:${id}:projection:workspace`
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`keyboard-parity-browser assertion failed: ${message}`)
}

async function freePort(): Promise<number> {
  const socket = createNetServer()
  await new Promise<void>((resolveListen, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', resolveListen)
  })
  const address = socket.address()
  assert(address && typeof address === 'object', 'could not reserve a Vite port')
  const port = address.port
  await new Promise<void>((resolveClose, reject) => {
    socket.close(error => error ? reject(error) : resolveClose())
  })
  return port
}

function liveCellProxy(cell: GardendCell): Record<string, ProxyOptions> {
  return {
    '/cell': {
      target: cell.apiUrl,
      changeOrigin: true,
      ws: true,
      rewrite: path => path.replace(/^\/cell/, ''),
      configure(proxy) {
        proxy.on('proxyReq', request => request.setHeader('Authorization', `Bearer ${cell.token}`))
        proxy.on('proxyReqWs', (request: { setHeader(name: string, value: string): void }) => {
          request.setHeader('Authorization', `Bearer ${cell.token}`)
          request.setHeader('Origin', 'http://127.0.0.1')
        })
      },
    },
  }
}

function chromeExecutable(): string | undefined {
  const explicit = process.env.SHRUBBERY_CHROME_EXECUTABLE
    ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  if (explicit) {
    assert(existsSync(explicit), `configured Chrome executable does not exist: ${explicit}`)
    return explicit
  }
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
    : process.platform === 'linux'
      ? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
      : []
  return candidates.find(candidate => existsSync(candidate))
}

async function waitForLiveHome(page: Page): Promise<void> {
  await page.waitForFunction((expectedGraphId) => {
    const graphInput = document.querySelector<HTMLInputElement>('#cell-graph-id')
    const status = document.querySelector<HTMLElement>('#status')
    return document.body.dataset.organismMode === 'local-cell'
      && graphInput?.value === expectedGraphId
      && status?.classList.contains('ok') === true
      && status.textContent?.includes('LIVE cell read') === true
      && document.querySelector('mn-home-view') !== null
  }, graphId, { timeout: 60_000 })
}

async function dialogTitle(page: Page): Promise<string> {
  return page.locator('mn-input-dialog[open] .title').textContent().then(value => value?.trim() ?? '')
}

async function focusedLandmark(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const active = document.activeElement
    const regions = Array.from(document.querySelectorAll<HTMLElement>(
      '#host [role="navigation"], #host [role="main"], #host [role="complementary"]',
    ))
    return regions.find(region => region === active || (active !== null && region.contains(active)))
      ?.getAttribute('role') ?? null
  })
}

async function backendTitle(mcp: LoopbackMcpClient, documentId: string): Promise<string> {
  const subject = `urn:mnemosyne:local:document:${documentId}`
  const query = [
    'PREFIX dcterms: <http://purl.org/dc/terms/>',
    'PREFIX doc: <http://mnemosyne.dev/doc#>',
    'SELECT (COALESCE(?dctitle, ?doctitle) AS ?title)',
    `WHERE { GRAPH <${workspaceProjectionGraphIri(graphId)}> {`,
    `  <${subject}> a doc:TipTapDocument .`,
    `  OPTIONAL { <${subject}> dcterms:title ?dctitle }`,
    `  OPTIONAL { <${subject}> doc:title ?doctitle }`,
    '} }',
  ].join('\n')
  const result = JSON.parse(mcpText(await mcp.toolsCall('sparql_query', { graphId, query }))) as {
    rows?: Array<{ title?: string }>
  }
  const raw = result.rows?.[0]?.title ?? ''
  return raw.startsWith('"') ? JSON.parse(raw) as string : raw
}

const binary = resolveGardendBin()
assert(existsSync(binary), `gardend binary not found at ${binary} (set GARDEN_BIN to override)`)

let cell: GardendCell | null = null
let vite: ViteDevServer | null = null
let browser: Browser | null = null
let page: Page | null = null
const pageErrors: string[] = []
const consoleErrors: string[] = []

try {
  cell = await spawnGardend()
  await createGraphAndSeedUxConfig(cell, graphId, seedNt, 'Keyboard Parity Browser Regression')
  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })

  const port = Number(process.env.SHRUBBERY_KEYBOARD_BROWSER_PORT ?? await freePort())
  vite = await createViteServer({
    root: appDir,
    configFile: false,
    server: {
      host: '127.0.0.1', port, strictPort: true, hmr: false,
      proxy: liveCellProxy(cell),
    },
    logLevel: 'warn',
  })
  await vite.listen()

  const executablePath = chromeExecutable()
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }))
  await page.goto(`http://127.0.0.1:${port}/?source=cell&graph=${encodeURIComponent(graphId)}`, {
    waitUntil: 'commit',
  })
  await waitForLiveHome(page)

  // Registry-driven create: the strong chord must open the real shell dialog.
  await page.keyboard.press(`${primaryModifier}+Alt+KeyN`)
  await page.locator('mn-input-dialog[open]').waitFor({ state: 'attached' })
  assert(await dialogTitle(page) === 'New Document', 'Mod+Alt+N did not open New Document')
  const input = page.locator('mn-input-dialog[open] input')
  await input.fill(createdTitle)
  await page.keyboard.press(`${primaryModifier}+Alt+KeyN`)
  assert(await dialogTitle(page) === 'New Document', 'create shortcut stacked/replaced an active input dialog')
  assert(await input.inputValue() === createdTitle, 'create shortcut mutated active dialog input')
  await input.press('Enter')
  await page.waitForFunction((expectedTitle) => {
    const status = document.querySelector<HTMLElement>('#status')
    const docId = document.querySelector<HTMLInputElement>('#cell-doc-id')?.value
    return Boolean(docId) && status?.textContent?.includes(`created document "${expectedTitle}"`) === true
  }, createdTitle, { timeout: 30_000 })
  const documentId = await page.locator('#cell-doc-id').inputValue()
  assert(documentId.length > 0, 'created document id was not selected')

  // Production layout must expose the three landmarks the Garden F6 algorithm uses.
  const roles = await page.locator('#host').evaluate((host) => {
    const candidates = Array.from(host.querySelectorAll<HTMLElement>(
      '[role="navigation"], [role="main"], [role="complementary"]',
    ))
    return candidates
      .filter(candidate => !candidates.some(other => other !== candidate && other.contains(candidate)))
      .map(node => node.getAttribute('role'))
  })
  assert(JSON.stringify(roles) === JSON.stringify(['navigation', 'main', 'complementary']), `landmark order drifted: ${roles}`)

  await page.locator('#cell-doc-id').focus()
  await page.keyboard.press('F6')
  assert(await focusedLandmark(page) === 'navigation', 'first F6 did not focus navigation')
  await page.keyboard.press('F6')
  assert(await focusedLandmark(page) === 'main', 'second F6 did not focus main')
  await page.keyboard.press('F6')
  assert(await focusedLandmark(page) === 'complementary', 'third F6 did not focus complementary')
  await page.keyboard.press('Shift+F6')
  assert(await focusedLandmark(page) === 'main', 'Shift+F6 did not reverse to main')

  // Registry-driven rename always targets the open document.
  await page.keyboard.press('F2')
  await page.locator('mn-input-dialog[open]').waitFor({ state: 'attached' })
  assert(await dialogTitle(page) === 'Rename Document', 'F2 did not open Rename Document')
  await input.fill('input-safety-sentinel')
  await input.press('F2')
  assert(await input.inputValue() === 'input-safety-sentinel', 'F2 re-fired from the dialog text input')
  await input.fill(renamedTitle)
  await input.press('Enter')
  await page.waitForFunction((expectedTitle) =>
    document.querySelector<HTMLElement>('#status')?.textContent?.includes(`-> "${expectedTitle}"`) === true,
  renamedTitle, { timeout: 30_000 })
  assert(await backendTitle(mcp, documentId) === renamedTitle, 'rename did not reach gardend projection state')

  assert(pageErrors.length === 0, `page errors:\n${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors:\n${consoleErrors.join('\n')}`)
  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: 'chromium',
    backend: 'real-gardend',
    graphId,
    documentId,
    createdTitle,
    renamedTitle,
    registryCreate: true,
    registryRename: true,
    inputSafety: true,
    landmarkCycle: ['navigation', 'main', 'complementary', 'main'],
  }, null, 2)}\n`)
} catch (error) {
  const status = page && !page.isClosed()
    ? await page.locator('#status').textContent().catch(() => null)
    : null
  throw new Error([
    error instanceof Error ? error.stack ?? error.message : String(error),
    status ? `Organism status: ${status}` : '',
    pageErrors.length ? `Page errors: ${pageErrors.join('\n')}` : '',
    consoleErrors.length ? `Console errors: ${consoleErrors.join('\n')}` : '',
  ].filter(Boolean).join('\n\n'))
} finally {
  await page?.close().catch(() => undefined)
  await browser?.close().catch(() => undefined)
  await vite?.close().catch(() => undefined)
  await cell?.kill().catch(() => undefined)
}

process.exit(0)
