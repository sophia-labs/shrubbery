/**
 * Real Chromium + real gardend proof for FID-004 cold projection.
 *
 * After isolated graph/config fixture setup, every user-feature mutation in the
 * journey goes through the production UI. It proves that a burst of TipTap/Yjs
 * WebSocket updates automatically materializes into gardend's cold document,
 * block, history, search, and RDF projections without a browser-side crdt.flush
 * request. It then reopens the document without creating another revision and
 * restarts gardend on the retained profile while one live Vite server rotates
 * its dynamic HTTP/document-WebSocket proxy to the new manifest.
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { createServer as createNetServer } from 'node:net'
import { basename, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import {
  createGraphAndSeedUxConfig,
  resolveGardendBin,
  spawnGardend,
  type GardendCell,
  type LoopbackManifest,
} from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient, mcpText } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = resolve(appDir, '../..')
const require_ = createRequire(import.meta.url)
const nucleusEntry = require_.resolve('@shrubbery/nucleus')
const seedPath = resolve(dirname(nucleusEntry), 'workspace/__generated__/garden-default.ux.nt')
const seedNt = readFileSync(seedPath, 'utf8')

interface Options {
  readonly headed: boolean
  readonly keepOpen: boolean
  readonly slowMo: number
  readonly port: number
}

const help = `Usage:
  pnpm --filter @shrubbery/organism test:fid004-browser -- [options]

Creates an isolated graph/config fixture, then runs a fresh-profile,
real-Chromium FID-004 proof whose user-feature mutations are production-UI-only.
The proof uses two successive real gardend processes while keeping one Vite
proxy alive.

Options:
  --headed             Show Chromium while the proof runs.
  --keep-open          Keep the green headed browser open until Enter is pressed.
  --slow-mo <ms>       Delay Playwright actions (default: 75 headed, 0 headless).
  --port <port>        Bind the private proof Vite server to this port (default: free port).
  -h, --help           Print this help without starting Vite, Chromium, or gardend.

Environment:
  GARDEN_BIN                         gardend binary to prove.
  GARDEN_REPO_DIR                    Garden source-context repo when GARDEN_BIN is
                                     copied outside its worktree (the binary hash,
                                     not this repo HEAD, identifies the artifact).
  SHRUBBERY_CHROME_EXECUTABLE        Chrome/Chromium executable override.
  SHRUBBERY_FID004_HEADED=1          Equivalent to --headed.
  SHRUBBERY_FID004_KEEP_OPEN=1       Equivalent to --keep-open.
  SHRUBBERY_FID004_SLOW_MO=<ms>      Equivalent to --slow-mo.
  SHRUBBERY_FID004_PORT=<port>       Equivalent to --port.
`

function hasArg(name: string): boolean {
  return process.argv.slice(2).includes(name)
}

function argValue(name: string): string | undefined {
  const args = process.argv.slice(2)
  const index = args.indexOf(name)
  if (index >= 0) return args[index + 1]
  return args.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1)
}

function options(): Options {
  const headed = hasArg('--headed') || process.env.SHRUBBERY_FID004_HEADED === '1'
  const rawSlowMo = Number(argValue('--slow-mo') ?? process.env.SHRUBBERY_FID004_SLOW_MO ?? (headed ? 75 : 0))
  const rawPort = Number(argValue('--port') ?? process.env.SHRUBBERY_FID004_PORT ?? 0)
  return {
    headed,
    keepOpen: hasArg('--keep-open') || process.env.SHRUBBERY_FID004_KEEP_OPEN === '1',
    slowMo: Number.isFinite(rawSlowMo) && rawSlowMo >= 0 ? rawSlowMo : 0,
    port: Number.isInteger(rawPort) && rawPort >= 0 ? rawPort : 0,
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`fid004-cold-projection-browser assertion failed: ${message}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

interface GitSourceSnapshot {
  readonly repo: string
  readonly head: string
  readonly trackedStatus: string
  readonly trackedDiffSha256: string
  readonly trackedDirty: boolean
}

function gitRepo(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  }).trim()
}

function gitSourceSnapshot(cwd: string): GitSourceSnapshot {
  const repo = gitRepo(cwd)
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
  const trackedStatus = execFileSync(
    'git',
    ['status', '--short', '--untracked-files=no'],
    { cwd: repo, encoding: 'utf8' },
  ).trim()
  const trackedDiff = execFileSync(
    'git',
    ['diff', 'HEAD', '--binary', '--no-ext-diff'],
    { cwd: repo, maxBuffer: 16 * 1024 * 1024 },
  )
  return {
    repo,
    head,
    trackedStatus,
    trackedDiffSha256: createHash('sha256').update(trackedDiff).digest('hex'),
    trackedDirty: trackedStatus.length > 0,
  }
}

function assertGitSourceUnchanged(label: string, expected: GitSourceSnapshot): void {
  const actual = gitSourceSnapshot(expected.repo)
  assert(actual.head === expected.head, `${label} HEAD changed during the proof: ${expected.head} -> ${actual.head}`)
  assert(
    actual.trackedStatus === expected.trackedStatus,
    `${label} tracked status changed during the proof: ${JSON.stringify(expected.trackedStatus)} -> ${JSON.stringify(actual.trackedStatus)}`,
  )
  assert(
    actual.trackedDiffSha256 === expected.trackedDiffSha256,
    `${label} tracked diff changed during the proof: ${expected.trackedDiffSha256} -> ${actual.trackedDiffSha256}`,
  )
}

function gardenSourceRepo(binary: string): string {
  const explicit = process.env.GARDEN_REPO_DIR?.trim()
  const cwd = explicit || dirname(binary)
  try {
    return gitRepo(cwd)
  } catch {
    throw new Error(
      `could not resolve Garden source context from ${cwd}; set GARDEN_REPO_DIR to the repo associated with GARDEN_BIN`,
    )
  }
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

interface CellEndpoint {
  readonly pid: number
  readonly profileDir: string
  readonly apiUrl: string
  readonly mcpUrl: string
  readonly token: string
  readonly manifest: LoopbackManifest
}

interface RestartedCell extends CellEndpoint {
  readonly child: ChildProcess
  stop(): Promise<void>
}

function mcpClient(cell: CellEndpoint): LoopbackMcpClient {
  return new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
}

async function mcpJson<T>(
  mcp: LoopbackMcpClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const text = mcpText(await mcp.toolsCall(name, args))
  return JSON.parse(text) as T
}

async function waitFor<T>(
  load: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T | undefined
  let lastError: string | undefined
  while (Date.now() < deadline) {
    try {
      last = await load()
      lastError = undefined
      if (predicate(last)) return last
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await sleep(150)
  }
  throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(last)}; lastError=${lastError ?? 'none'}`)
}

async function waitForStable<T>(
  load: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  stableMs: number,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let stableSince: number | null = null
  let last: T | undefined
  let lastError: string | undefined
  while (Date.now() < deadline) {
    try {
      last = await load()
      lastError = undefined
      if (predicate(last)) {
        stableSince ??= Date.now()
        if (Date.now() - stableSince >= stableMs) return last
      } else {
        stableSince = null
      }
    } catch (error) {
      stableSince = null
      lastError = error instanceof Error ? error.message : String(error)
    }
    await sleep(100)
  }
  throw new Error(
    `timed out waiting for stable ${label} (${stableMs}ms); last=${JSON.stringify(last)}; lastError=${lastError ?? 'none'}`,
  )
}

async function restJson<T>(cell: CellEndpoint, path: string): Promise<T> {
  const url = new URL(path, `${cell.apiUrl}/`)
  return await new Promise<T>((resolveResponse, reject) => {
    const request = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${cell.token}`, Origin: 'http://127.0.0.1' },
    }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        const status = response.statusCode ?? 0
        if (status < 200 || status >= 300) {
          reject(new Error(`GET ${url.pathname} returned ${status}: ${body.slice(0, 500)}`))
          return
        }
        try {
          resolveResponse(JSON.parse(body) as T)
        } catch (error) {
          reject(new Error(`GET ${url.pathname} returned invalid JSON: ${String(error)}`))
        }
      })
    })
    request.setTimeout(5_000, () => request.destroy(new Error(`GET ${url.pathname} timed out`)))
    request.once('error', reject)
    request.end()
  })
}

function writeLoopbackHandoff(path: string, cell: CellEndpoint, graphId: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify({
    apiUrl: cell.apiUrl,
    mcpUrl: cell.mcpUrl,
    token: cell.token,
    port: cell.manifest.port,
    graphId,
  }))
  renameSync(temporary, path)
}

async function stopSpawnedGardendWithoutRemovingProfile(cell: GardendCell): Promise<void> {
  try {
    process.kill(cell.pid, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    return
  }
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      process.kill(cell.pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
      throw error
    }
    await sleep(100)
  }
  process.kill(cell.pid, 'SIGKILL')
  throw new Error(`gardend ${cell.pid} did not stop after SIGTERM`)
}

async function startGardendOnProfile(
  bin: string,
  profileDir: string,
  generation: number,
): Promise<RestartedCell> {
  const token = `fid004-${generation}-${randomUUID().replace(/-/g, '')}`
  const child = spawn(bin, [], {
    // Preserve the same fresh-profile isolation as the first generation. Any
    // process-relative runtime cache must remain disposable with the proof.
    cwd: profileDir,
    env: {
      ...process.env,
      GARDEN_PROFILE_DIR: profileDir,
      GARDEN_LOOPBACK_HOST: '127.0.0.1',
      GARDEN_LOOPBACK_PORT: '0',
      GARDEN_LOOPBACK_TOKEN: token,
      RUST_LOG: process.env.RUST_LOG ?? 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null
  child.stdout?.on('data', chunk => { stdout += String(chunk) })
  child.stderr?.on('data', chunk => { stderr += String(chunk) })
  child.on('exit', (code, signal) => { exited = { code, signal } })

  const manifestPath = join(profileDir, 'loopback.json')
  const deadline = Date.now() + 30_000
  let manifest: LoopbackManifest | null = null
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`gardend generation ${generation} exited before readiness: ${JSON.stringify(exited)}\n${stderr.slice(-2000)}`)
    }
    if (existsSync(manifestPath)) {
      try {
        const candidate = JSON.parse(readFileSync(manifestPath, 'utf8')) as LoopbackManifest
        if (candidate.token === token && candidate.apiUrl && candidate.mcpUrl) {
          const healthy = await fetch(`${candidate.apiUrl.replace(/\/$/, '')}/health`).catch(() => null)
          if (healthy?.ok) {
            manifest = candidate
            break
          }
        }
      } catch {
        // Manifest replacement is atomic, but tolerate a partially observed file.
      }
    }
    await sleep(100)
  }
  if (!manifest) {
    child.kill('SIGKILL')
    throw new Error(`gardend generation ${generation} did not become healthy\nstdout=${stdout.slice(-1000)}\nstderr=${stderr.slice(-2000)}`)
  }

  const endpoint: RestartedCell = {
    child,
    pid: child.pid!,
    profileDir,
    manifest,
    apiUrl: manifest.apiUrl.replace(/\/$/, ''),
    mcpUrl: manifest.mcpUrl,
    token: manifest.token,
    async stop(): Promise<void> {
      if (exited) return
      child.kill('SIGTERM')
      const stopDeadline = Date.now() + 10_000
      while (!exited && Date.now() < stopDeadline) await sleep(100)
      if (!exited) child.kill('SIGKILL')
    },
  }
  return endpoint
}

interface ConsoleEvent {
  readonly label: string
  readonly type: string
  readonly text: string
}

interface NetworkEvent {
  readonly label: string
  readonly method: string
  readonly url: string
  readonly postData: string | null
}

interface Diagnostics {
  readonly console: ConsoleEvent[]
  readonly pageErrors: string[]
  readonly httpErrors: string[]
  readonly requestFailures: string[]
  readonly websocketErrors: string[]
  readonly websockets: Array<{ readonly label: string; readonly url: string }>
  readonly requests: NetworkEvent[]
}

function newDiagnostics(): Diagnostics {
  return {
    console: [],
    pageErrors: [],
    httpErrors: [],
    requestFailures: [],
    websocketErrors: [],
    websockets: [],
    requests: [],
  }
}

async function newCapturedPage(
  browser: Browser,
  label: string,
  diagnostics: Diagnostics,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.on('console', message => {
    const event = { label, type: message.type(), text: message.text() }
    diagnostics.console.push(event)
    if (event.type === 'error' || event.type === 'assert') {
      process.stderr.write(`[FID-004][${label}][console:${event.type}] ${event.text}\n`)
    }
  })
  page.on('pageerror', error => {
    const detail = `${label}: ${error.stack ?? error.message}`
    diagnostics.pageErrors.push(detail)
    process.stderr.write(`[FID-004][${label}][pageerror] ${error.message}\n`)
  })
  page.on('request', request => diagnostics.requests.push({
    label,
    method: request.method(),
    url: request.url(),
    postData: request.postData(),
  }))
  page.on('response', response => {
    if (response.status() >= 400) {
      const detail = `${label}: HTTP ${response.status()} ${response.url()}`
      diagnostics.httpErrors.push(detail)
      process.stderr.write(`[FID-004][${label}][response] HTTP ${response.status()} ${response.url()}\n`)
    }
  })
  page.on('requestfailed', request => {
    const detail = `${label}: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'unknown failure'}`
    diagnostics.requestFailures.push(detail)
    process.stderr.write(`[FID-004][${label}][requestfailed] ${detail}\n`)
  })
  page.on('websocket', socket => {
    diagnostics.websockets.push({ label, url: socket.url() })
    socket.on('socketerror', error => {
      const detail = `${label}: ${socket.url()} ${error}`
      diagnostics.websocketErrors.push(detail)
      process.stderr.write(`[FID-004][${label}][websocket] ${detail}\n`)
    })
  })
  return { context, page }
}

async function waitForLiveHome(page: Page, graphId: string): Promise<void> {
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

async function waitForEditor(page: Page, expectedText?: string): Promise<void> {
  const editor = page.locator('sh-editor-host .ProseMirror')
  await editor.waitFor({ state: 'visible', timeout: 30_000 })
  if (expectedText !== undefined) {
    await page.waitForFunction(text => {
      const root = document.querySelector('sh-editor-host')?.shadowRoot
      return root?.querySelector('.ProseMirror')?.textContent?.includes(String(text)) === true
    }, expectedText, { timeout: 30_000 })
  }
}

async function openDocumentByTitle(page: Page, title: string): Promise<string> {
  const row = page.locator('mn-sidebar-panel .tree-row', { hasText: title }).first()
  await row.waitFor({ state: 'visible', timeout: 30_000 })
  const documentId = await row.getAttribute('data-node-id')
  assert(documentId, `sidebar row for ${title} has no document id`)
  await row.click()
  await waitForEditor(page)
  return documentId
}

function workspaceProjectionGraphIri(graphId: string): string {
  return `urn:mnemosyne:local:graph:${graphId}:projection:workspace`
}

function jsonIncludes(value: unknown, text: string): boolean {
  return JSON.stringify(value).includes(text)
}

function decodedSparqlCell(value: string | undefined): string {
  if (!value) return ''
  if (value.startsWith('"')) {
    try { return JSON.parse(value) as string } catch { return value }
  }
  return value
}

interface DocumentRecord {
  readonly documentId?: string
  readonly document_id?: string
  readonly title: string
  readonly revision: number
  readonly body: string
  readonly blocks: readonly unknown[]
  readonly rdfTripleCount?: number
  readonly rdf_triple_count?: number
}

interface TimingResponse {
  readonly count: number
  readonly traces: readonly Record<string, unknown>[]
}

function assertCleanDiagnostics(diagnostics: Diagnostics): void {
  const hardConsole = diagnostics.console.filter(event => event.type === 'error' || event.type === 'assert')
  const unexpectedWarnings = diagnostics.console.filter(event => {
    if (event.type !== 'warning' && event.type !== 'warn') return false
    return !event.text.includes('Lit is in dev mode')
  })
  assert(hardConsole.length === 0, `console errors: ${JSON.stringify(hardConsole)}`)
  assert(unexpectedWarnings.length === 0, `unexpected console warnings: ${JSON.stringify(unexpectedWarnings)}`)
  assert(diagnostics.pageErrors.length === 0, `page errors: ${diagnostics.pageErrors.join('\n')}`)
  assert(diagnostics.httpErrors.length === 0, `HTTP errors: ${diagnostics.httpErrors.join('\n')}`)
  assert(diagnostics.requestFailures.length === 0, `request failures: ${diagnostics.requestFailures.join('\n')}`)
  assert(diagnostics.websocketErrors.length === 0, `WebSocket errors: ${diagnostics.websocketErrors.join('\n')}`)
}

async function main(): Promise<void> {
  const opts = options()
  assert(!opts.keepOpen || opts.headed, '--keep-open requires --headed')
  const binary = resolve(resolveGardendBin())
  assert(existsSync(binary), `gardend binary not found at ${binary} (set GARDEN_BIN to override)`)
  const binarySha256 = sha256(binary)
  const harnessPath = fileURLToPath(import.meta.url)
  const harnessSha256 = sha256(harnessPath)
  const shrubberySource = gitSourceSnapshot(repoDir)
  const gardenSource = gitSourceSnapshot(gardenSourceRepo(binary))

  const graphId = `fid004-browser-${randomUUID()}`
  const createdTitle = `FID-004 Draft ${randomUUID().slice(0, 8)}`
  const renamedTitle = `FID-004 Cold Record ${randomUUID().slice(0, 8)}`
  const token = `coldproof${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const editorText = `Garden automatic cold projection sentinel ${token}.`
  const diagnostics = newDiagnostics()
  const previousManifestEnv = process.env.GARDEND_LOOPBACK_MANIFEST

  let firstCell: GardendCell | null = null
  let firstCellRunning = false
  let secondCell: RestartedCell | null = null
  let vite: ViteDevServer | null = null
  let browser: Browser | null = null
  let firstContext: BrowserContext | null = null
  let secondContext: BrowserContext | null = null
  let activePage: Page | null = null
  let loopbackHandoff: string | null = null
  let documentId = ''

  try {
    process.stdout.write('[FID-004] starting fresh real gardend profile\n')
    firstCell = await spawnGardend({ bin: binary, readyTimeoutMs: 30_000 })
    firstCellRunning = true
    const handoffPath = join(firstCell.profileDir, `.fid004-vite-handoff-${randomUUID()}.json`)
    loopbackHandoff = handoffPath
    process.env.GARDEND_LOOPBACK_MANIFEST = handoffPath
    await createGraphAndSeedUxConfig(firstCell, graphId, seedNt, 'FID-004 Browser Cold Projection')
    writeLoopbackHandoff(handoffPath, firstCell, graphId)

    const port = opts.port || await freePort()
    vite = await createViteServer({
      root: appDir,
      configFile: resolve(appDir, 'vite.config.ts'),
      server: { host: '127.0.0.1', port, strictPort: true },
      logLevel: 'warn',
    })
    await vite.listen()
    const address = vite.httpServer?.address()
    assert(address && typeof address === 'object', 'Vite did not expose a TCP address')
    const appUrl = `http://127.0.0.1:${address.port}/?source=cell&graph=${encodeURIComponent(graphId)}`

    const executablePath = chromeExecutable()
    browser = await chromium.launch({
      headless: !opts.headed,
      slowMo: opts.slowMo,
      ...(executablePath ? { executablePath } : {}),
    })
    const first = await newCapturedPage(browser, 'generation-1', diagnostics)
    firstContext = first.context
    activePage = first.page

    process.stdout.write('[FID-004] creating, opening, and renaming through the production UI\n')
    await first.page.goto(appUrl, { waitUntil: 'commit', timeout: 60_000 })
    await waitForLiveHome(first.page, graphId)
    await first.page.locator('mn-home-view button.new-document').click()
    const createInput = first.page.locator('mn-input-dialog[open] input.input')
    await createInput.waitFor({ state: 'visible' })
    await createInput.fill(createdTitle)
    await first.page.locator('mn-input-dialog[open] button.confirm-button').click()
    await first.page.waitForFunction((title) => {
      const status = document.querySelector<HTMLElement>('#status')
      return Boolean(document.querySelector<HTMLInputElement>('#cell-doc-id')?.value)
        && status?.textContent?.includes(`created document "${String(title)}"`) === true
    }, createdTitle, { timeout: 30_000 })
    documentId = await first.page.locator('#cell-doc-id').inputValue()
    assert(documentId.length > 0, 'new UI document did not expose an id')
    await waitForEditor(first.page)

    const createdRow = first.page.locator('mn-sidebar-panel .tree-row', { hasText: createdTitle }).first()
    await createdRow.click()
    await first.page.keyboard.press('F2')
    const renameInput = first.page.locator('mn-input-dialog[open] input.input')
    await renameInput.waitFor({ state: 'visible' })
    await renameInput.fill(renamedTitle)
    await renameInput.press('Enter')
    await first.page.waitForFunction((title) =>
      document.querySelector<HTMLElement>('#status')?.textContent?.includes(`-> "${String(title)}"`) === true,
    renamedTitle, { timeout: 30_000 })
    await first.page.locator('mn-sidebar-panel .tree-row', { hasText: renamedTitle }).first()
      .waitFor({ state: 'visible', timeout: 30_000 })

    const firstEndpoint: CellEndpoint = firstCell
    const firstMcp = mcpClient(firstEndpoint)
    // Opening a brand-new empty room may create its own initial cold snapshot.
    // Require exact 1/1 state to remain unchanged for longer than gardend's
    // 600ms document debounce before clearing traces and starting the burst.
    const preEditState = await waitForStable(
      async () => {
        const [record, history] = await Promise.all([
          restJson<DocumentRecord>(
            firstEndpoint,
            `/api/graphs/${encodeURIComponent(graphId)}/documents/${encodeURIComponent(documentId)}`,
          ),
          mcpJson<Record<string, unknown>>(firstMcp, 'get_document_history', {
            graphId, documentId, limit: 20,
          }),
        ])
        return {
          record,
          snapshotCount: Number(history.snapshotCount ?? history.snapshot_count ?? 0),
        }
      },
      value => value.record.revision === 1 && value.snapshotCount === 1,
      'pre-edit cold document revision/history 1/1',
      900,
    )
    const preEditRecord = preEditState.record
    const preEditSnapshotCount = preEditState.snapshotCount
    await restJson<TimingResponse>(firstEndpoint, '/api/local/crdt-timings?limit=200&clear=true')

    process.stdout.write('[FID-004] typing a real TipTap/Yjs burst; waiting only for automatic server debounce\n')
    const editor = first.page.locator('sh-editor-host .ProseMirror')
    await editor.click()
    await first.page.keyboard.type(editorText, { delay: 8 })
    await waitForEditor(first.page, token)

    const readDocument = await waitFor(
      () => mcpJson<Record<string, unknown>>(firstMcp, 'read_document', {
        graphId, documentId, format: 'markdown',
      }),
      value => jsonIncludes(value, token) && value.title === renamedTitle,
      'automatic cold read_document projection',
    )
    const coldRecord = await restJson<DocumentRecord>(
      firstEndpoint,
      `/api/graphs/${encodeURIComponent(graphId)}/documents/${encodeURIComponent(documentId)}`,
    )
    assert(coldRecord.revision === preEditRecord.revision + 1, `typed burst changed revision ${preEditRecord.revision} -> ${coldRecord.revision}, expected exactly +1`)
    assert(coldRecord.revision === 2, `fresh-profile typed revision is ${coldRecord.revision}, expected 2`)
    assert(coldRecord.title === renamedTitle, `cold document title is ${coldRecord.title}, expected ${renamedTitle}`)
    assert(coldRecord.body.includes(token), 'cold document body does not contain the browser sentinel')
    assert(coldRecord.blocks.length > 0, 'cold document has no projected blocks')
    assert((coldRecord.rdfTripleCount ?? coldRecord.rdf_triple_count ?? 0) > 0, 'cold document has no RDF projection')

    const readBlocks = await mcpJson<Record<string, unknown>>(firstMcp, 'read_blocks', {
      graphId, documentId, format: 'text', includeIds: true,
    })
    assert(jsonIncludes(readBlocks, token), 'read_blocks does not contain the browser sentinel')
    const queryBlocks = await mcpJson<Record<string, unknown>>(firstMcp, 'query_blocks', {
      graphId, documentId, textContains: token,
    })
    assert(Number(queryBlocks.totalMatches ?? queryBlocks.total_matches ?? 0) >= 1, 'query_blocks did not match the browser sentinel')
    assert(jsonIncludes(queryBlocks, token), 'query_blocks result omitted the browser sentinel')
    const digest = await mcpJson<Record<string, unknown>>(firstMcp, 'document_digest', {
      graphId, documentId, topValued: 0,
    })
    const digestMetadata = digest.metadata as Record<string, unknown> | undefined
    const digestSize = digest.size as Record<string, unknown> | undefined
    assert(digestMetadata?.title === renamedTitle, 'document_digest title disagrees with the cold record')
    assert(Number(digestSize?.blockCount ?? digestSize?.block_count ?? 0) === coldRecord.blocks.length, 'document_digest block count disagrees with the cold record')
    assert(Number(digestSize?.characterCount ?? digestSize?.character_count ?? 0) >= editorText.length, 'document_digest character count is stale')

    const history = await mcpJson<Record<string, unknown>>(firstMcp, 'get_document_history', {
      graphId, documentId, limit: 20,
    })
    const snapshotCount = Number(history.snapshotCount ?? history.snapshot_count ?? 0)
    assert(snapshotCount === preEditSnapshotCount + 1, `typed burst changed history ${preEditSnapshotCount} -> ${snapshotCount}, expected exactly +1`)
    assert(snapshotCount === 2, `fresh-profile typed history is ${snapshotCount}, expected 2 snapshots`)
    assert(jsonIncludes(history, 'charsAdded') || jsonIncludes(history, 'chars_added'), 'history omitted change counts')

    const lexicalSearch = await mcpJson<Record<string, unknown>>(firstMcp, 'search_blocks', {
      graphId, query: token, mode: 'lexical', caseSensitive: false, docFilter: documentId,
    })
    assert(Number(lexicalSearch.total ?? 0) >= 1, 'lexical search did not find the browser sentinel')
    assert(jsonIncludes(lexicalSearch, token), 'lexical search result omitted the browser sentinel')
    const documentSearch = await mcpJson<Record<string, unknown>>(firstMcp, 'search_documents', {
      graphId, query: renamedTitle, mode: 'exact', limit: 10,
    })
    assert(Number(documentSearch.total ?? 0) === 1, 'cold document search did not find the workspace rename')
    assert(jsonIncludes(documentSearch, documentId), 'cold document search returned a different document')

    const workspace = await mcpJson<Record<string, unknown>>(firstMcp, 'get_workspace', { graphId })
    assert(jsonIncludes(workspace, renamedTitle), 'cold workspace record does not contain the rename')
    const workspacePath = join(firstCell.profileDir, 'graphs', graphId, 'ydocs', 'workspace', 'workspace.json')
    assert(existsSync(workspacePath), 'cold workspace snapshot was not written')
    assert(readFileSync(workspacePath, 'utf8').includes(renamedTitle), 'workspace.json does not contain the rename')
    const ydocPath = join(firstCell.profileDir, 'graphs', graphId, 'ydocs', 'documents', documentId, 'update-v1.bin')
    assert(existsSync(ydocPath) && statSync(ydocPath).size > 0, 'durable document Y.Doc state is absent')

    const subject = `urn:mnemosyne:local:document:${documentId}`
    const titleQuery = [
      'PREFIX dcterms: <http://purl.org/dc/terms/>',
      'PREFIX doc: <http://mnemosyne.dev/doc#>',
      'SELECT (COALESCE(?dctitle, ?doctitle) AS ?title)',
      `WHERE { GRAPH <${workspaceProjectionGraphIri(graphId)}> {`,
      `  <${subject}> a doc:TipTapDocument .`,
      `  OPTIONAL { <${subject}> dcterms:title ?dctitle }`,
      `  OPTIONAL { <${subject}> doc:title ?doctitle }`,
      '} }',
    ].join('\n')
    const titleRdf = await mcpJson<{ rows?: Array<{ title?: string }> }>(firstMcp, 'sparql_query', {
      graphId, query: titleQuery,
    })
    assert(decodedSparqlCell(titleRdf.rows?.[0]?.title) === renamedTitle, 'workspace RDF title disagrees with the cold record')
    const contentQuery = `SELECT ?g ?s ?p ?value WHERE { GRAPH ?g { ?s ?p ?value . FILTER(CONTAINS(STR(?value), "${token}")) } }`
    const contentRdf = await mcpJson<Record<string, unknown>>(firstMcp, 'sparql_query', {
      graphId, query: contentQuery,
    })
    assert(jsonIncludes(contentRdf, token), 'SPARQL did not find the browser sentinel')

    const automaticTraces = await waitFor(
      () => restJson<TimingResponse>(firstEndpoint, `/api/local/crdt-timings?limit=20&kind=crdt.flush&documentId=${encodeURIComponent(documentId)}`),
      value => value.count === 1 && value.traces[0]?.ok === true,
      'one successful automatic document flush trace',
    )
    assert(automaticTraces.count === 1, `browser edit produced ${automaticTraces.count} document flush traces`)
    const explicitBrowserFlushes = diagnostics.requests.filter(request =>
      request.url.includes('/flush') || request.postData?.includes('crdt.flush') === true,
    )
    assert(explicitBrowserFlushes.length === 0, `browser sent an explicit flush: ${JSON.stringify(explicitBrowserFlushes)}`)

    process.stdout.write('[FID-004] waiting past another debounce and reopening without another revision\n')
    await sleep(1_400)
    await first.page.reload({ waitUntil: 'commit', timeout: 60_000 })
    await waitForLiveHome(first.page, graphId)
    const reopenedId = await openDocumentByTitle(first.page, renamedTitle)
    assert(reopenedId === documentId, 'reopen selected a different document')
    await waitForEditor(first.page, token)
    await sleep(900)

    const settledRecord = await restJson<DocumentRecord>(
      firstEndpoint,
      `/api/graphs/${encodeURIComponent(graphId)}/documents/${encodeURIComponent(documentId)}`,
    )
    const settledHistory = await mcpJson<Record<string, unknown>>(firstMcp, 'get_document_history', {
      graphId, documentId, limit: 20,
    })
    const settledTraces = await restJson<TimingResponse>(
      firstEndpoint,
      `/api/local/crdt-timings?limit=20&kind=crdt.flush&documentId=${encodeURIComponent(documentId)}`,
    )
    assert(settledRecord.revision === coldRecord.revision, `settled/reopened revision changed ${coldRecord.revision} -> ${settledRecord.revision}`)
    assert(Number(settledHistory.snapshotCount ?? settledHistory.snapshot_count ?? 0) === snapshotCount, 'settled/reopened history added a snapshot')
    assert(settledTraces.count === automaticTraces.count, 'settled/reopened room scheduled a redundant document flush')
    assert(diagnostics.requests.every(request => request.postData?.includes('crdt.flush') !== true), 'reopen sent an explicit browser crdt.flush request')

    process.stdout.write('[FID-004] restarting gardend on the retained profile; keeping Vite alive\n')
    await firstContext.close()
    firstContext = null
    activePage = null
    await stopSpawnedGardendWithoutRemovingProfile(firstCell)
    firstCellRunning = false
    assert(sha256(binary) === binarySha256, 'gardend binary changed between generation 1 and generation 2')
    secondCell = await startGardendOnProfile(binary, firstCell.profileDir, 2)
    assert(secondCell.token !== firstCell.token, 'gardend restart reused the loopback bearer')
    writeLoopbackHandoff(handoffPath, secondCell, graphId)

    const proxyHealth = await fetch(`http://127.0.0.1:${address.port}/cell/health`)
    assert(proxyHealth.ok, `live Vite proxy did not rotate to restarted gardend: ${proxyHealth.status}`)
    const secondMcp = mcpClient(secondCell)
    const coldAfterRestart = await mcpJson<Record<string, unknown>>(secondMcp, 'read_document', {
      graphId, documentId, format: 'markdown',
    })
    assert(jsonIncludes(coldAfterRestart, token), 'retained-profile cold read lost the browser content')
    assert(coldAfterRestart.title === renamedTitle, 'retained-profile cold read lost the renamed title')
    const searchAfterRestart = await mcpJson<Record<string, unknown>>(secondMcp, 'search_blocks', {
      graphId, query: token, mode: 'lexical', docFilter: documentId,
    })
    assert(Number(searchAfterRestart.total ?? 0) >= 1, 'retained-profile lexical search lost the browser content')
    const titleRdfAfterRestart = await mcpJson<{ rows?: Array<{ title?: string }> }>(secondMcp, 'sparql_query', {
      graphId, query: titleQuery,
    })
    assert(
      decodedSparqlCell(titleRdfAfterRestart.rows?.[0]?.title) === renamedTitle,
      'retained-profile workspace RDF lost the renamed title',
    )
    const contentRdfAfterRestart = await mcpJson<Record<string, unknown>>(secondMcp, 'sparql_query', {
      graphId, query: contentQuery,
    })
    assert(jsonIncludes(contentRdfAfterRestart, token), 'retained-profile document RDF lost the browser sentinel')

    process.stdout.write('[FID-004] opening retained content in a fresh Chromium context through rotated HTTP+WS proxy\n')
    const second = await newCapturedPage(browser, 'generation-2', diagnostics)
    secondContext = second.context
    activePage = second.page
    await second.page.goto(appUrl, { waitUntil: 'commit', timeout: 60_000 })
    await waitForLiveHome(second.page, graphId)
    const restartId = await openDocumentByTitle(second.page, renamedTitle)
    assert(restartId === documentId, 'fresh Chromium opened a different retained document')
    // The production editor host does not mount until the document provider's
    // whenSynced promise resolves, so visible retained text proves WS sync—not
    // merely that Chromium constructed a WebSocket object.
    await waitForEditor(second.page, token)
    assert(await second.page.locator('mn-sidebar-panel .tree-row', { hasText: renamedTitle }).count() >= 1, 'fresh Chromium lost the renamed title')
    await sleep(900)

    const restartedDocumentWebSockets = diagnostics.websockets.filter(socket =>
      socket.label === 'generation-2' && socket.url.includes('/cell/hocuspocus/docs/'),
    )
    assert(restartedDocumentWebSockets.length >= 1, 'fresh Chromium did not sync a document WebSocket through the rotated proxy')

    const hydratedRecord = await restJson<DocumentRecord>(
      secondCell,
      `/api/graphs/${encodeURIComponent(graphId)}/documents/${encodeURIComponent(documentId)}`,
    )
    const hydratedHistory = await mcpJson<Record<string, unknown>>(secondMcp, 'get_document_history', {
      graphId, documentId, limit: 20,
    })
    const hydratedSnapshotCount = Number(hydratedHistory.snapshotCount ?? hydratedHistory.snapshot_count ?? 0)
    const hydratedTraces = await restJson<TimingResponse>(
      secondCell,
      `/api/local/crdt-timings?limit=20&kind=crdt.flush&documentId=${encodeURIComponent(documentId)}`,
    )
    assert(
      hydratedRecord.revision === 2 && hydratedSnapshotCount === 2,
      `restart hydration did not retain exact 2/2 cold state: revision=${hydratedRecord.revision}; history=${hydratedSnapshotCount}; document flush traces=${hydratedTraces.count}`,
    )
    assert(hydratedRecord.title === renamedTitle && hydratedRecord.body.includes(token), 'restart hydration changed cold title/content')

    const finalExplicitBrowserFlushes = diagnostics.requests.filter(request =>
      request.url.includes('/flush') || request.postData?.includes('crdt.flush') === true,
    )
    assert(finalExplicitBrowserFlushes.length === 0, 'fresh Chromium sent an explicit flush request')
    assertCleanDiagnostics(diagnostics)

    if (opts.keepOpen) {
      const prompt = createInterface({ input: process.stdin, output: process.stdout })
      await prompt.question('[FID-004] proof is green; browser is being kept open. Press Enter to close. ')
      prompt.close()
    }

    assert(sha256(binary) === binarySha256, 'gardend binary changed before proof completion')
    assert(sha256(harnessPath) === harnessSha256, 'FID-004 harness changed during the proof')
    assertGitSourceUnchanged('Shrubbery source', shrubberySource)
    assertGitSourceUnchanged('Garden source context', gardenSource)

    const expectedWarnings = diagnostics.console.filter(event =>
      event.type === 'warning' || event.type === 'warn',
    )
    process.stdout.write(`${JSON.stringify({
      ok: true,
      claim: 'FID-004 automatic cold projection and retained-profile restart',
      provenance: {
        shrubberySource: {
          head: shrubberySource.head,
          trackedDirty: shrubberySource.trackedDirty,
          trackedStatus: shrubberySource.trackedStatus.split('\n').filter(Boolean),
          trackedDiffSha256: shrubberySource.trackedDiffSha256,
        },
        gardenSourceContext: {
          head: gardenSource.head,
          trackedDirty: gardenSource.trackedDirty,
          trackedStatus: gardenSource.trackedStatus.split('\n').filter(Boolean),
          trackedDiffSha256: gardenSource.trackedDiffSha256,
          relationship: 'context only; the gardend binary does not embed a verifiable source commit',
        },
        gardendBinary: {
          path: binary,
          sha256: binarySha256,
          unchangedAcrossGenerations: true,
        },
        harnessSha256,
      },
      browser: executablePath ? basename(executablePath) : 'playwright-chromium',
      headed: opts.headed,
      graphId,
      documentId,
      preEditRevision: preEditRecord.revision,
      coldRevision: coldRecord.revision,
      preEditHistorySnapshots: preEditSnapshotCount,
      coldHistorySnapshots: snapshotCount,
      automaticDocumentFlushes: automaticTraces.count,
      browserExplicitFlushRequests: 0,
      mutationProvenance: {
        fixtureSetup: ['MCP create_graph', 'MCP rdf_load UX config'],
        userFeatureMutationsAfterSetup: ['production UI create', 'production UI rename', 'production UI TipTap typing'],
        harnessCallsAfterSetup: 'product-state reads plus one diagnostics-only trace reset; no direct product mutation or explicit flush',
      },
      projections: [
        'REST document record',
        'MCP read_document',
        'MCP read_blocks',
        'MCP query_blocks',
        'MCP document_digest',
        'MCP get_document_history',
        'MCP lexical search',
        'MCP document search',
        'workspace RDF',
        'document RDF',
      ],
      restartProjections: [
        'REST document record',
        'MCP read_document',
        'MCP get_document_history',
        'MCP lexical search',
        'workspace RDF',
        'document RDF',
      ],
      reopenedWithoutRevision: true,
      retainedProfileRestart: true,
      restartHydrationWithoutRevision: hydratedRecord.revision === coldRecord.revision,
      restartHydrationDocumentFlushes: hydratedTraces.count,
      freshChromiumAfterRestart: true,
      dynamicProxy: {
        viteStarts: 1,
        gardendGenerations: 2,
        httpRotatedAfterRestart: true,
        productionDocumentWebSocketRotatedAfterRestart: true,
        restartedDocumentWebSockets: restartedDocumentWebSockets.map(socket => socket.url),
      },
      diagnostics: {
        pageErrors: 0,
        httpErrors: 0,
        requestFailures: 0,
        websocketErrors: 0,
        expectedWarnings: expectedWarnings.map(event => event.text),
      },
      ydocBytes: statSync(ydocPath).size,
      typedSentinelSha256: createHash('sha256').update(editorText).digest('hex'),
    }, null, 2)}\n`)
  } catch (error) {
    const status = activePage && !activePage.isClosed()
      ? await activePage.locator('#status').textContent().catch(() => null)
      : null
    throw new Error([
      error instanceof Error ? error.stack ?? error.message : String(error),
      status ? `Organism status: ${status}` : '',
      diagnostics.console.length ? `Console: ${JSON.stringify(diagnostics.console)}` : '',
      diagnostics.pageErrors.length ? `Page errors: ${diagnostics.pageErrors.join('\n')}` : '',
      diagnostics.httpErrors.length ? `HTTP errors: ${diagnostics.httpErrors.join('\n')}` : '',
      diagnostics.requestFailures.length ? `Request failures: ${diagnostics.requestFailures.join('\n')}` : '',
      diagnostics.websocketErrors.length ? `WebSocket errors: ${diagnostics.websocketErrors.join('\n')}` : '',
    ].filter(Boolean).join('\n\n'))
  } finally {
    await secondContext?.close().catch(() => undefined)
    await firstContext?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    await vite?.close().catch(() => undefined)
    await secondCell?.stop().catch(() => undefined)
    if (firstCell) {
      if (firstCellRunning) await firstCell.kill().catch(() => undefined)
      else await firstCell.kill().catch(() => undefined)
    }
    try {
      if (loopbackHandoff && existsSync(loopbackHandoff)) unlinkSync(loopbackHandoff)
    } catch {
      // The handoff contains only an expired disposable token.
    }
    if (previousManifestEnv === undefined) delete process.env.GARDEND_LOOPBACK_MANIFEST
    else process.env.GARDEND_LOOPBACK_MANIFEST = previousManifestEnv
  }
}

if (hasArg('--help') || hasArg('-h')) {
  process.stdout.write(help)
} else {
  await main()
}
