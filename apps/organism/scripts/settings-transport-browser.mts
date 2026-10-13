/**
 * Real Chromium preflight over two isolated loopback origins. The real Settings
 * controllers render into the real route; only the backend bytes are synthetic.
 * No Playwright response interception or disabled web security. --baseline
 * serves exact deployed bca consumer sources without editing the shared tree.
 * pnpm --dir apps/organism exec tsx scripts/settings-transport-browser.mts --out ABS_NEW_DIR [--baseline]
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { createServer as createHttpServer, type Server } from 'node:http'
import { createServer as createPortReservation } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = resolve(appDir, '../..')
const revision = 'bca34950711fbbc09a01c6fe31950e9e594e9462'
const args = process.argv.slice(2)
const baseline = args.includes('--baseline')
const outIndex = args.indexOf('--out')
const output = outIndex >= 0 ? args[outIndex + 1] : ''
if (!output || !isAbsolute(output) || args.some((arg, i) => arg !== '--baseline' && arg !== '--out' && i !== outIndex + 1)) throw new Error('Use --out ABSOLUTE_NEW_DIRECTORY [--baseline]')
mkdirSync(output, { recursive: false })
const temp = mkdtempSync(join(tmpdir(), 'shrubbery-settings-transport-'))
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const consumerPaths = ['local-ai-settings.ts', 'settings-operations.ts', 'rest-helpers.ts', 'document-transfer.ts', 'original-file-controller.ts', 'excalidraw-cell-service.ts', 'image-generation-flow.ts', 'zotero-source.ts'].map(path => `apps/organism/src/cell/${path}`)
const sourcePaths = baseline ? consumerPaths : [...consumerPaths, 'apps/organism/src/cell/cell-auth-headers.ts']
const sources = new Map(sourcePaths.map(path => [resolve(repoDir, path), baseline
  ? execFileSync('git', ['-C', repoDir, 'show', `${revision}:${path}`], { encoding: 'utf8' })
  : readFileSync(resolve(repoDir, path), 'utf8')]))
const sourceHashes = () => sourcePaths.map(path => ({ path, sha256: sha256(baseline ? sources.get(resolve(repoDir, path))! : readFileSync(resolve(repoDir, path), 'utf8')) }))
const fixturePaths = ['settings-transport-harness.html', 'src/harness/settings-transport-main.ts', 'scripts/settings-transport-browser.mts']
const fixtureHashes = () => fixturePaths.map(path => ({ path: `apps/organism/${path}`, sha256: sha256(readFileSync(resolve(appDir, path), 'utf8')) }))
const dependencyHashes = () => ['apps/organism/src/cell/settings-service.ts', 'apps/organism/src/cell/app-routes.ts', 'packages/components/src/mn-settings-page.ts'].map(path => ({ path, sha256: sha256(readFileSync(resolve(repoDir, path), 'utf8')) }))
const graphId = 'settings-transport-fixture'
// Copied verbatim as header names from independent real app-origin OPTIONS,
// 2026-09-06/07, corroborated by Sirin e1e8a7e gateway/src/routes.rs:520-565.
// This deliberately does not accept x-user-id at the hosted origin.
const gatewayAllowedHeaders = ['authorization', 'content-type', 'idempotency-key', 'prefer']
type ApiCall = { method: string; path: string; mode: 'local' | 'hosted'; requestedHeaders: string[]; headerNames: string[]; syntheticBearer: boolean; userId: string | null }
type Projection = { sections: Array<{ id: string; notes?: string[]; metrics?: Array<{ id: string; value: string }> }>; historyStatus: string; historyError: string }
type Case = { mode: string; pass: boolean; preflightObserved: boolean; preflightHeadersCorrect: boolean; modelReached: boolean; historyReached: boolean; outgoingIdentityCorrect: boolean; visibleModel: string; visibleIndex: string; visibleNotes: string; snapshot: Projection; apiCalls: ApiCall[]; failedRequests: unknown[]; pageErrors: string[]; consoleErrors: string[]; screenshot: string }
const calls: ApiCall[] = []
const receipt: Record<string, unknown> = {
  author: '/root/surface_atlas (maintained shrubbery-settings)', kind: 'two-origin-synthetic-api-real-settings-chromium', baseline,
  startedAt: new Date().toISOString(), baseRevision: revision,
  sourceBinding: baseline ? 'exact bca consumer modules + explicitly hashed current fixture/dependencies' : 'working-tree consumer modules + explicitly hashed current fixture/dependencies',
  sourcesBefore: sourceHashes(), fixturesBefore: fixtureHashes(),
  dependenciesBefore: dependencyHashes(),
  gatewayAllowedHeaders, backend: 'synthetic JSON; no live graph/provider/job/auth session',
  cases: [], externalRequestsBlocked: 0, mutationRequests: 0, browserClosed: false, apiClosed: false, serverClosed: false,
}
let browser: Browser | undefined, server: ViteDevServer | undefined, api: Server | undefined
let forbidden = 0, mutations = 0
let apiOrigin = ''
try {
  const port = await new Promise<number>((accept, reject) => {
    const reservation = createPortReservation()
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', () => {
      const address = reservation.address()
      if (!address || typeof address === 'string') { reservation.close(); reject(new Error('No loopback port')); return }
      reservation.close(error => error ? reject(error) : accept(address.port))
    })
  })
  server = await createServer({
    root: appDir, configFile: false, envDir: temp, cacheDir: join(temp, 'cache'),
    plugins: [
      ...(baseline ? [{ name: 'settings-base-snapshot', enforce: 'pre' as const, load(id: string) { return sources.get(id.split('?')[0]!) } }] : []),
      { name: 'settings-loopback-network-fence', configureServer(vite) {
        vite.middlewares.use((_req, res, next) => {
          // HTTP CSP fences the fixture without enabling CDP/Playwright request
          // interception, which can suppress Chromium's native CORS preflights.
          res.setHeader('Content-Security-Policy', `default-src 'self'; connect-src 'self' ${apiOrigin}; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'`)
          next()
        })
      } },
    ],
    optimizeDeps: { entries: ['settings-transport-harness.html'] },
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false, fs: { allow: [repoDir] } }, logLevel: 'error',
  })
  await server.listen()
  const origin = `http://127.0.0.1:${port}`
  api = createHttpServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const mode = url.pathname.startsWith('/local/') ? 'local' : 'hosted'
    const method = req.method ?? 'GET'
    const requestedHeaders = String(req.headers['access-control-request-headers'] ?? '').split(',').map(name => name.trim().toLowerCase()).filter(Boolean)
    const user = req.headers['x-user-id']
    calls.push({ method, path: url.pathname + url.search, mode, requestedHeaders, headerNames: Object.keys(req.headers).sort(), syntheticBearer: req.headers.authorization === 'Bearer synthetic-settings-token', userId: user === 'synthetic-settings-user' ? user : user ? 'UNEXPECTED' : null })
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', [...gatewayAllowedHeaders, ...(mode === 'local' ? ['x-user-id'] : [])].join(','))
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
    res.setHeader('Vary', 'Origin,Access-Control-Request-Method,Access-Control-Request-Headers')
    res.setHeader('Cache-Control', 'no-store')
    if (method === 'OPTIONS') { res.writeHead(200); res.end(); return }
    if (method !== 'GET') { mutations++; res.writeHead(405); res.end('This fixture never mutates'); return }
    if (req.headers.authorization !== 'Bearer synthetic-settings-token' || (mode === 'local' && user !== 'synthetic-settings-user') || (mode === 'hosted' && user)) { res.writeHead(401); res.end('Wrong synthetic identity contract'); return }
    let result: unknown
    if (url.pathname.endsWith('/api/semantic/model/status')) result = {
      providerId: mode === 'hosted' ? 'remote-embeddings-pool' : 'fastembed',
      modelId: mode === 'hosted' ? 'BAAI/bge-small-en-v1.5' : 'fastembed/bge-small-en-v1.5',
      displayName: 'BGE Small (synthetic fixture)', dimensions: 384, runtimeAvailable: true,
      prepared: true, loaded: true, setupRequired: false, effectiveBatchSize: 4,
    }
    else if (url.pathname.endsWith(`/api/semantic/index/status/${graphId}`)) result = { graphId, exists: true, compatible: true, compatibilityReason: null, documentCount: 3, blockCount: 17, staleDocumentCount: 0, indexedAt: '2026-09-07T00:00:00Z' }
    else if (url.pathname.endsWith('/restore-points')) result = { restorePoints: [], nextCursor: null, totalCount: 0 }
    else if (mode === 'local' && url.pathname.endsWith('/api/semantic/models')) result = [{ modelId: 'fastembed/bge-small-en-v1.5', displayName: 'BGE Small (synthetic fixture)', selected: true, effectiveBatchSize: 4 }]
    else if (mode === 'local' && url.pathname.endsWith('/api/artifacts/ingestion/approaches')) result = []
    else if (mode === 'local' && url.pathname.endsWith('/api/artifacts/ingestion/docling/status')) result = { supported: false, available: false, reason: 'Not part of this transport fixture' }
    else if (mode === 'local' && url.pathname.endsWith('/api/artifacts/ingestion/pdf/pipeline')) result = { engines: [], preferenceOptions: [] }
    else { res.writeHead(404); res.end('Unexpected synthetic endpoint'); return }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result))
  })
  await new Promise<void>((accept, reject) => { api!.once('error', reject); api!.listen(0, '127.0.0.1', accept) })
  const address = api.address()
  if (!address || typeof address === 'string') throw new Error('No API address')
  apiOrigin = `http://127.0.0.1:${address.port}`
  receipt.origins = { page: origin, api: apiOrigin, distinct: origin !== apiOrigin }
  receipt.networkFence = 'HTTP Content-Security-Policy; no Playwright request interception, response mocking, or disabled web security'
  browser = await chromium.launch({ headless: true })
  receipt.engine = browser.version()
  for (const mode of ['hosted', 'local'] as const) {
    const start = calls.length
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' })
    try {
      const page = await context.newPage()
      const pageErrors: string[] = [], consoleErrors: string[] = []
      const failedRequests: Array<{ url: string; method: string; error: string | null }> = []
      page.on('pageerror', error => pageErrors.push(error.message))
      page.on('request', request => { if (!['data:', 'blob:'].includes(new URL(request.url()).protocol) && ![origin, apiOrigin].includes(new URL(request.url()).origin)) forbidden++ })
      page.on('console', message => { if (message.type() === 'error' && consoleErrors.length < 20) consoleErrors.push(message.text()) })
      page.on('requestfailed', request => failedRequests.push({ url: request.url(), method: request.method(), error: request.failure()?.errorText ?? null }))
      const prefix = mode === 'local' ? `/local/${graphId}` : `/o/user%3Asynthetic-settings-user/g/${graphId}`
      const params = new URLSearchParams({ mode, api: `${apiOrigin}${prefix}` })
      await page.goto(`${origin}/settings-transport-harness.html?${params}`, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForSelector('body[data-settings-transport-ready="true"]', { timeout: 20000 })
      const snapshot = await page.evaluate(() => (window as unknown as { __settingsTransportSnapshot: Projection }).__settingsTransportSnapshot)
      const selectedCalls = calls.slice(start)
      const gets = selectedCalls.filter(call => call.method === 'GET')
      const modelReached = gets.some(call => call.path.endsWith('/api/semantic/model/status'))
      const historyReached = gets.some(call => call.path.includes('/restore-points'))
      const preflightObserved = selectedCalls.some(call => call.method === 'OPTIONS')
      const preflightHeadersCorrect = selectedCalls.filter(call => call.method === 'OPTIONS').every(call =>
        JSON.stringify(call.requestedHeaders) === JSON.stringify(mode === 'local' ? ['authorization', 'x-user-id'] : ['authorization']))
      const outgoingIdentityCorrect = gets.length > 0 && gets.every(call => call.syntheticBearer && call.userId === (mode === 'local' ? 'synthetic-settings-user' : null))
      const embeddings = snapshot.sections.find(section => section.id === 'local-ai')
      const renderedModel = embeddings?.metrics?.find(metric => metric.id === 'semantic-model-status')?.value === 'BGE Small (synthetic fixture)'
      const renderedIndex = embeddings?.metrics?.find(metric => metric.id === 'semantic-index-status')?.value === '17 blocks'
      const modelRow = page.locator('mn-settings-page [data-metric-id="semantic-model-status"]')
      const indexRow = page.locator('mn-settings-page [data-metric-id="semantic-index-status"]')
      const visibleModel = await modelRow.isVisible() ? await modelRow.innerText() : ''
      const visibleIndex = await indexRow.isVisible() ? await indexRow.innerText() : ''
      const notes = page.locator('mn-settings-page details.local-ai-diagnostics')
      if (await notes.count()) await notes.locator('summary').click()
      const visibleNotes = await notes.count() ? await notes.innerText() : ''
      const screenshot = `${mode}-1280x720.png`
      await page.screenshot({ path: join(output, screenshot), fullPage: true })
      const pass = preflightObserved && preflightHeadersCorrect && modelReached && historyReached && outgoingIdentityCorrect && renderedModel && renderedIndex && visibleModel.includes('BGE Small (synthetic fixture)') && visibleIndex.includes('17 blocks') && !visibleNotes.includes('Failed to fetch') && snapshot.historyStatus === 'ready' && !snapshot.historyError && pageErrors.length === 0 && failedRequests.length === 0 && consoleErrors.length === 0
      ;(receipt.cases as Case[]).push({ mode, pass: Boolean(pass), preflightObserved, preflightHeadersCorrect, modelReached, historyReached, outgoingIdentityCorrect, visibleModel, visibleIndex, visibleNotes, snapshot, apiCalls: selectedCalls, failedRequests, pageErrors, consoleErrors, screenshot })
    } finally { await context.close() }
  }
  receipt.pass = forbidden === 0 && mutations === 0 && (receipt.cases as Case[]).every(item => item.pass)
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error)
  receipt.pass = false
} finally {
  if (browser) { await browser.close(); receipt.browserClosed = true }
  if (api) { await new Promise<void>((accept, reject) => api!.close(error => error ? reject(error) : accept())); receipt.apiClosed = true }
  if (server) { await server.close(); receipt.serverClosed = true }
  receipt.sourcesAfter = sourceHashes(); receipt.fixturesAfter = fixtureHashes()
  receipt.dependenciesAfter = dependencyHashes()
  receipt.sourceStable = JSON.stringify(receipt.sourcesBefore) === JSON.stringify(receipt.sourcesAfter) && JSON.stringify(receipt.fixturesBefore) === JSON.stringify(receipt.fixturesAfter) && JSON.stringify(receipt.dependenciesBefore) === JSON.stringify(receipt.dependenciesAfter)
  receipt.externalRequestsBlocked = forbidden; receipt.mutationRequests = mutations
  receipt.pass = receipt.pass === true && receipt.sourceStable === true
  rmSync(temp, { recursive: true, force: true })
  receipt.finishedAt = new Date().toISOString()
  writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
}
console.log(JSON.stringify({ output, baseline, pass: receipt.pass, sourceStable: receipt.sourceStable, cases: (receipt.cases as Case[]).map(item => ({ mode: item.mode, pass: item.pass, preflightObserved: item.preflightObserved, modelReached: item.modelReached, historyReached: item.historyReached, outgoingIdentityCorrect: item.outgoingIdentityCorrect, historyStatus: item.snapshot.historyStatus, failedRequests: item.failedRequests.length })), error: receipt.error, browserClosed: receipt.browserClosed, apiClosed: receipt.apiClosed, serverClosed: receipt.serverClosed }, null, 2))
process.exitCode = receipt.pass ? 0 : 1
