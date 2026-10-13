/**
 * Canonical-only local acceptance examiner. Producer schema transcribed from
 * Sirin control_mcp::manage_access/tool_result and graph_meta::AccessGrant,
 * independently of the consumer parser. No cloud account or actual grant.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = resolve(appDir, '../..')
const artifactDir = process.env.SHRUBBERY_ACCESS_ARTIFACT_DIR ? resolve(process.env.SHRUBBERY_ACCESS_ARTIFACT_DIR) : await mkdtemp(join(tmpdir(), 'shrubbery-access-'))
await mkdir(artifactDir, { recursive: true })
const port = Number(process.env.SHRUBBERY_ACCESS_BROWSER_PORT ?? '0')
const selected = process.env.SHRUBBERY_ACCESS_SCENARIOS?.split(',')
const framing = process.env.SHRUBBERY_ACCESS_FRAMING ?? 'bare'
if (framing !== 'bare' && framing !== 'app') throw new Error('UnknownAccessFraming')
const renderer = process.env.SHRUBBERY_ACCESS_RENDERER ?? 'legacy'
if (renderer !== 'legacy' && renderer !== 'surface') throw new Error('UnknownAccessRenderer')
const checkGeometry = process.env.SHRUBBERY_ACCESS_GEOMETRY === '1'
const prefix = '/access-harness/gateway'
const owner = 'user:owner-a'
const member = 'user:editor-a'
const newMember = 'user:viewer-new'
type Grant = { graph: { owner: string; graphId: string }; generation: number; principal: string; role: 'viewer' | 'editor'; grantedBy: string; grantedAtMs: number }
type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: Record<string, unknown> } }
type RequestReceipt = { method: string; path: string; authenticated: boolean; receivedAt: string; respondedAt?: string; body?: unknown; status?: number; response?: unknown }
type Scenario = 'healthy' | 'empty' | 'loading' | 'missing' | 'denied' | 'missing-result' | 'tool-error' | 'malformed-row' | 'wrong-graph' | 'wrong-id' | 'grant-missing-result' | 'revoke-false' | 'stale-after-grant'
const directory = [
  { owner, graphId: 'graph-a', title: 'Research Garden A', role: 'owner', cellState: 'running' },
  { owner, graphId: 'graph-b', title: 'Research Garden B', role: 'owner', cellState: 'running' },
  { owner: 'user:other-owner', graphId: 'graph-shared', title: 'Shared Garden', role: 'viewer', cellState: 'running' },
]
const grant = (graphId: string, principal = member, role: Grant['role'] = 'editor'): Grant => ({ graph: { owner, graphId }, generation: 1, principal, role, grantedBy: owner, grantedAtMs: 1788678000000 })
let scenario: Scenario = 'healthy'
let requests: RequestReceipt[] = []
let records = new Map<string, Map<string, Grant>>()
let releaseList: (() => void) | null = null
let delayedList: Promise<void> | null = null
// The callback is assigned inside scenario setup. Keep the cleanup call in a
// function so TypeScript does not narrow the top-level initial null to never.
function releasePendingList(): void { releaseList?.() }
function reset(next: Scenario): void {
  releaseList?.(); releaseList = null; delayedList = null; scenario = next; requests = []
  records = new Map(['graph-a', 'graph-b'].map(id => [id, new Map(next === 'empty' ? [] : [[member, grant(id)]])]))
  if (next === 'loading') delayedList = new Promise(resolve => { releaseList = resolve })
}
function json(response: ServerResponse, receipt: RequestReceipt, value: unknown, status = 200): void {
  receipt.status = status; receipt.response = value
  receipt.respondedAt = new Date().toISOString()
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}
const result = (id: unknown, value: unknown) => ({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false } })
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })
async function producer(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url ?? '/', 'http://fixture.invalid').pathname
  const receipt: RequestReceipt = { method: req.method ?? 'GET', path, authenticated: req.headers.authorization === 'Bearer synthetic-access-owner-id-token', receivedAt: new Date().toISOString() }
  requests.push(receipt)
  if (!receipt.authenticated) return json(res, receipt, { error: 'unauthorized: synthetic test credential required' }, 401)
  if (path === `${prefix}/graphs` && req.method === 'GET') return json(res, receipt, directory)
  // Retired REST access administration is deliberately never accepted.
  if (path !== `${prefix}/control/mcp` || req.method !== 'POST') return json(res, receipt, { error: 'not found: route' }, 404)
  const chunks: Buffer[] = []
  for await (const part of req) chunks.push(Buffer.from(part))
  let body: Rpc
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Rpc }
  catch { return json(res, receipt, { error: 'malformed JSON' }, 400) }
  receipt.body = body
  const id = body.id
  if (!req.headers['content-type']?.includes('application/json') || (typeof id !== 'number' && typeof id !== 'string')) return json(res, receipt, rpcError(id, -32600, 'fixture requires JSON content type and request id'))
  if (body.jsonrpc !== '2.0' || body.method !== 'tools/call' || body.params?.name !== 'manage_access') return json(res, receipt, rpcError(id, -32601, 'unknown control tool'))
  const args = body.params.arguments ?? {}
  const graphId = args.graphId
  const action = args.action
  if (typeof args.owner !== 'string' || typeof graphId !== 'string' || typeof action !== 'string') return json(res, receipt, rpcError(id, -32602, 'owner, graphId, and action must be strings'))
  const expected = directory.find(item => item.graphId === graphId)
  if (!expected || args.owner !== expected.owner || expected.owner !== owner) return json(res, receipt, rpcError(id, action === 'list' ? -32004 : -32003, action === 'list' ? 'graph not found' : 'forbidden: actor is not graph owner'))
  const allowed = action === 'list' ? ['owner', 'graphId', 'action'] : action === 'grant' ? ['owner', 'graphId', 'action', 'principal', 'role'] : ['owner', 'graphId', 'action', 'principal']
  // Stricter than dispatcher on unknown fields: catch invented email/name writes.
  if (Object.keys(args).some(key => !allowed.includes(key))) return json(res, receipt, rpcError(id, -32602, 'fixture forbids invented access arguments'))
  const graph = records.get(graphId)!
  if (action === 'list') {
    if (delayedList && graphId === 'graph-a') await delayedList
    if (scenario === 'missing') return json(res, receipt, rpcError(id, -32004, 'graph not found'))
    if (scenario === 'denied') return json(res, receipt, rpcError(id, -32003, 'control tool requires an interactive credential until connector grants exist (D1)'))
    if (scenario === 'missing-result') return json(res, receipt, { jsonrpc: '2.0', id })
    if (scenario === 'tool-error') return json(res, receipt, { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'synthetic tool failure' }], isError: true } })
    if (scenario === 'malformed-row') return json(res, receipt, result(id, [{ ...grant(graphId), grantedAtMs: 'yesterday' }]))
    if (scenario === 'wrong-graph') return json(res, receipt, result(id, [{ ...grant(graphId), graph: { owner: 'user:wrong-owner', graphId } }]))
    if (scenario === 'wrong-id') return json(res, receipt, result('unrelated-request-id', [...graph.values()]))
    if (scenario === 'stale-after-grant' && graph.has(newMember)) return json(res, receipt, result(id, [grant(graphId)]))
    return json(res, receipt, result(id, [...graph.values()]))
  }
  if (typeof args.principal !== 'string' || !/^user:[A-Za-z0-9_-]+$/u.test(args.principal)) return json(res, receipt, rpcError(id, -32602, 'principal must be a typed user principal'))
  if (args.principal === owner) return json(res, receipt, rpcError(id, -32009, 'canonical owner authority is not represented by an ACL row'))
  if (args.principal === 'user:denied-user') return json(res, receipt, rpcError(id, -32003, 'forbidden: actor is not graph owner'))
  if (action === 'grant') {
    if (args.role !== 'viewer' && args.role !== 'editor') return json(res, receipt, rpcError(id, -32602, 'role must be viewer or editor'))
    if (scenario === 'grant-missing-result') return json(res, receipt, { jsonrpc: '2.0', id })
    const row = grant(graphId, args.principal, args.role)
    graph.set(args.principal, row)
    return json(res, receipt, result(id, row))
  }
  if (action === 'revoke') {
    if (scenario === 'revoke-false') return json(res, receipt, result(id, { revoked: false }))
    graph.delete(args.principal)
    return json(res, receipt, result(id, { revoked: true }))
  }
  return json(res, receipt, rpcError(id, -32602, 'unsupported access action'))
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`[hosted-access-browser] ${message}`) }
const safeError = (error: unknown): string => error instanceof Error ? error.stack ?? error.message : String(error)
const mutations = () => requests.filter(item => ['grant', 'revoke'].includes((item.body as Rpc)?.params?.arguments?.action as string))
const sourcePaths = [
  'apps/organism/src/harness/access-main.ts', 'apps/organism/scripts/hosted-access-browser-harness.mts',
  'apps/organism/src/cell/gateway-transport.ts', 'apps/organism/src/cell/access-grant-controller.ts',
  'apps/organism/src/cell/shell-features.ts', 'packages/source/src/gateway/control-access.ts',
  'packages/components/src/mn-access-manager.ts', 'packages/components/src/mn-bottom-bar.ts',
  'packages/runtime/src/render-workspace.ts',
  'apps/organism/index.html',
  'apps/organism/src/main.ts',
]
async function hashes(): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash('sha256').update(await readFile(resolve(repoDir, path))).digest('hex')])))
}
const receipt: Record<string, any> = {
  startedAt: new Date().toISOString(), scope: 'loopback Chromium; real hosted UI chain; independently synthetic canonical producer; no live auth/grants', artifactDir,
  networkScope: 'actual loopback HTTP; app dev proxies excluded; non-origin browser-context HTTP and all WebSockets blocked; service workers blocked',
  cacheAndTimingScope: 'fresh nonpersistent context per scenario; routing disables HTTP cache; shared Vite module cache; panelOpenThroughAssertionsMs includes assertions/actions, not a product rendering benchmark',
  framing: { mode: framing, renderer, geometryAssertions: checkGeometry, meaning: 'bare harness or exact index styles+shell scaffold; independently choose legacy or main.ts-matching surface renderer; neither executes main.ts or certifies deployed/native app' },
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim(), sourceHashesBefore: await hashes(), tests: [],
  cleanup: { contextsCreated: 0, contextsClosed: 0, browserClosed: false, serverClosed: false },
}
let server: ViteDevServer | undefined
let browser: Browser | undefined
let context: BrowserContext | undefined
let page: Page | undefined
let origin = ''
let caseIndex = 0
let failed = false
async function capture(label: string): Promise<void> {
  if (!page || page.isClosed()) return
  const stem = `${String(caseIndex).padStart(2, '0')}-${label}`
  await page.screenshot({ path: join(artifactDir, `${stem}.png`), fullPage: true })
  await writeFile(join(artifactDir, `${stem}.aria.txt`), await page.locator('body').ariaSnapshot())
}
const component = () => page!.locator('mn-access-manager')
const panel = () => component().getByRole('dialog', { name: 'Workspace access', exact: true })
async function openPanel(): Promise<void> {
  if (!await panel().isVisible()) await component().getByRole('button', { name: 'Manage workspace access', exact: true }).click()
  await panel().waitFor({ state: 'visible' })
}
async function loadedMember(principal = member): Promise<void> { await component().locator(`[data-user-id="${principal}"]`).waitFor({ state: 'visible' }) }
async function noFakeEmpty(): Promise<void> {
  const count = (await component().locator('.toolbar').innerText()).trim()
  assert(!/^0\s+(?:(?:shared\s+)?members?|access grants?)\b/iu.test(count), `unobserved member list is misleadingly counted: ${count}`)
  assert(!/No access grants were returned/iu.test(await panel().innerText()), 'failure is rendered as an empty grant list')
  const input = component().locator('input[name="access-user-id"]')
  // A blank form alone disables Add even when authority gating is broken.
  // Assert the field itself is disabled to discriminate actual readiness.
  if (await input.count()) assert(await input.isDisabled(), 'unobserved membership leaves the owner form editable')
}
async function waitError(): Promise<void> {
  await component().getByRole('alert').first().waitFor({ state: 'visible' })
  assert(await component().locator('.notice').count() === 0, 'refusal must not show an acceptance notice')
}
async function add(principal: string, role = 'viewer'): Promise<void> {
  await component().locator('input[name="access-user-id"]').fill(principal)
  await component().locator('select[name="access-role"]').selectOption(role)
  await component().getByRole('button', { name: 'Add member', exact: true }).click()
}
async function run(name: string, mode: Scenario, check: () => Promise<void>): Promise<void> {
  if (selected && !selected.includes(name)) return
  caseIndex += 1; reset(mode)
  const observed: Record<string, any> = { name, scenario: mode, startedAt: new Date().toISOString(), assertionsPassed: false, blockedExternal: [], blockedWebSockets: [], pageErrors: [], consoleErrors: [] }
  receipt.tests.push(observed)
  try {
    context = await browser!.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
    receipt.cleanup.contextsCreated += 1
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.origin === origin) await route.continue()
      else { observed.blockedExternal.push({ protocol: url.protocol, host: url.host, path: url.pathname }); await route.abort('blockedbyclient') }
    })
    await context.routeWebSocket('**/*', socket => {
      const url = new URL(socket.url())
      const blocked = { protocol: url.protocol, host: url.host, path: url.pathname, kind: 'websocket' }
      observed.blockedWebSockets.push(blocked)
      // Vite's client can still attempt local HMR with server.hmr=false. Keep
      // that blocked attempt, but do not misreport it as external traffic.
      if (url.host !== new URL(origin).host) observed.blockedExternal.push(blocked)
      socket.close()
    })
    page = await context.newPage(); page.setDefaultTimeout(8000)
    page.on('pageerror', error => observed.pageErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') observed.consoleErrors.push(message.text()) })
    await page.goto(`${origin}/access-browser-harness.html?framing=${framing}&renderer=${renderer}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForFunction(() => window.__accessHarness?.state.ready || window.__accessHarness?.state.error)
    const state = await page.evaluate(() => window.__accessHarness!.state)
    assert(!state.error, `fixture bootstrap error: ${state.error}`)
    assert(state.framing === framing && state.renderer === renderer, 'requested framing/renderer did not reach fixture')
    const openedAt = performance.now()
    await openPanel(); await check()
    observed.panelOpenThroughAssertionsMs = Math.round(performance.now() - openedAt)
    assert(observed.pageErrors.length === 0, `uncaught page errors: ${observed.pageErrors.join('; ')}`)
    assert(observed.blockedExternal.length === 0, 'unexpected external network was attempted and blocked')
    observed.assertionsPassed = true; await capture(`${name}-pass`)
  } catch (error) {
    failed = true; observed.error = safeError(error)
    try { await capture(`${name}-failure`) } catch (captureError) { observed.captureError = safeError(captureError) }
  } finally {
    releaseList?.()
    observed.requests = JSON.parse(JSON.stringify(requests))
    observed.retainedFixtureGrants = [...records].map(([graphId, grants]) => ({ graphId, grants: [...grants.values()] }))
    observed.finishedAt = new Date().toISOString()
    if (context) { await context.close(); receipt.cleanup.contextsClosed += 1; context = undefined; page = undefined }
    await writeFile(join(artifactDir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
    console.log(JSON.stringify({ name, pass: observed.assertionsPassed, error: observed.error, artifactDir }))
  }
}
try {
  // Deliberately no app dev-proxy config or its native/hosted credential readers.
  server = await createServer({
    root: appDir, configFile: false, logLevel: 'warn', optimizeDeps: { exclude: ['oxigraph'] },
    server: { host: '127.0.0.1', port, strictPort: port > 0, hmr: false },
    plugins: [{ name: 'independent-canonical-access-producer', configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(prefix)) return next()
        void producer(req, res).catch(error => { res.statusCode = 500; res.end(JSON.stringify({ error: safeError(error) })) })
      })
    } }],
  })
  await server.listen()
  const address = server.httpServer?.address()
  assert(address && typeof address !== 'string', 'loopback server did not expose an address')
  origin = `http://127.0.0.1:${address.port}`; receipt.origin = origin
  browser = await chromium.launch({ headless: true, timeout: 30000, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync'] })
  receipt.engine = { name: 'Chromium', version: browser.version(), viewport: { width: 1280, height: 900 } }
  await run('canonical-list', 'healthy', async () => {
    await loadedMember()
    assert(await component().locator(`[data-user-id="${owner}"]`).count() === 0, 'owner authority must not be invented as an ACL row')
    const request = requests.find(item => (item.body as Rpc)?.params?.arguments?.action === 'list')
    assert(request?.path === `${prefix}/control/mcp`, 'list did not use canonical control MCP')
    assert((request.body as Rpc).params?.arguments?.owner === owner, 'list lost selected graph owner')
    assert(await component().locator('input[name="access-user-id"]').isEnabled(), 'directory owner hint must permit management without an owner ACL row')
    if (checkGeometry) {
      const app = await page!.locator('.app-container').boundingBox()
      // Both runtime branches own .main; data-surface-main exists only when
      // the optional recursive surface renderer is selected.
      const main = await page!.locator('.app-container > .main').boundingBox()
      const footer = await page!.getByRole('contentinfo').boundingBox()
      const dialog = await panel().boundingBox()
      const viewport = page!.viewportSize()!
      assert(app && main && footer && dialog, 'framing geometry is missing a rendered region')
      const intersects = Math.min(footer.x + footer.width, dialog.x + dialog.width) > Math.max(footer.x, dialog.x)
        && Math.min(footer.y + footer.height, dialog.y + dialog.height) > Math.max(footer.y, dialog.y)
      receipt.tests.at(-1).geometry = { viewport, app, main, footer, dialog, footerIntersectsDialog: intersects }
      if (framing === 'app') {
        assert(Math.abs(app.height - viewport.height) < 2, 'source app frame does not occupy viewport height')
        assert(main.y + main.height <= footer.y + 1, 'footer overlays the source-framed main region')
        assert(Math.abs(footer.y + footer.height - viewport.height) < 2, 'footer is not allocated at viewport bottom')
        assert(!intersects, 'footer crosses access dialog with exact app framing')
      } else {
        assert(app.height < viewport.height - 100 && intersects, 'bare-frame negative control no longer reproduces the short workspace overlap')
      }
    }
  })
  await run('canonical-crud-and-cancel', 'healthy', async () => {
    await loadedMember()
    assert(await component().locator('input[name="access-email"],input[name="access-display-name"]').count() === 0, 'canonical direct grants must not promise email/name metadata writes')
    await add('user:denied-user'); await waitError()
    assert(!records.get('graph-a')!.has('user:denied-user'), 'denied grant changed fixture state')
    assert(await component().getByRole('button', { name: 'Add member', exact: true }).isDisabled(), 'failed change permits another mutation before refresh')
    await component().getByRole('button', { name: 'Retry', exact: true }).click(); await loadedMember()
    await add(newMember); await loadedMember(newMember)
    await component().getByRole('status').filter({ hasText: `Added ${newMember}` }).waitFor({ state: 'visible' })
    await component().getByRole('combobox', { name: `Role for ${newMember}`, exact: true }).selectOption('editor')
    await component().getByRole('status').filter({ hasText: `Updated ${newMember} to editor` }).waitFor({ state: 'visible' })
    assert(records.get('graph-a')!.get(newMember)?.role === 'editor', 'role change missing from canonical store')
    await component().getByRole('button', { name: `Remove ${newMember}`, exact: true }).click()
    const confirm = page!.getByRole('alertdialog', { name: `Remove ${newMember}?`, exact: true })
    await confirm.waitFor({ state: 'visible' })
    const beforeCancel = mutations().length
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click(); await confirm.waitFor({ state: 'detached' })
    assert(mutations().length === beforeCancel && records.get('graph-a')!.has(newMember), 'cancel submitted a mutation')
    await openPanel(); await loadedMember(newMember)
    await component().getByRole('button', { name: `Remove ${newMember}`, exact: true }).click()
    await confirm.getByRole('button', { name: 'Remove member', exact: true }).click(); await confirm.waitFor({ state: 'detached' })
    await openPanel()
    await component().getByRole('status').filter({ hasText: `Removed ${newMember}` }).waitFor({ state: 'visible' })
    assert(!records.get('graph-a')!.has(newMember), 'accepted revoke missing from fixture state')
    assert(await component().locator(`[data-user-id="${newMember}"]`).count() === 0, 'revoked member retained in rendered list')
    const calls = mutations().map(item => (item.body as Rpc).params!.arguments!)
    assert(calls.length === 4 && calls.filter(call => call.action === 'grant').length === 3 && calls.filter(call => call.action === 'revoke').length === 1, 'unexpected mutation count')
    assert(calls.every(call => call.owner === owner && call.graphId === 'graph-a'), 'mutation scope differs from selected owner/graph')
  })
  await run('loading-not-empty', 'loading', async () => {
    await component().getByRole('status').filter({ hasText: 'Loading members' }).waitFor({ state: 'visible' })
    await noFakeEmpty(); await capture('loading-before-release'); releaseList!(); await loadedMember()
  })
  for (const mode of ['missing', 'denied', 'missing-result', 'tool-error', 'malformed-row', 'wrong-graph', 'wrong-id'] as const) {
    await run(`${mode}-not-empty`, mode, async () => {
      await waitError(); await noFakeEmpty()
      assert(await component().locator('[data-user-id]').count() === 0, 'refused/malformed list leaked a member row')
      assert(mutations().length === 0, 'list refusal caused an access mutation')
      assert(await component().getByRole('button', { name: 'Add member', exact: true }).isDisabled(), 'unobserved member list permits mutation')
      assert(await component().getByRole('button', { name: 'Retry', exact: true }).isEnabled(), 'settled refusal has no actionable retry')
    })
  }
  await run('one-retry-reopen-and-explicit-refresh', 'missing', async () => {
    await waitError(); await noFakeEmpty(); await capture('before-one-retry')
    scenario = 'healthy'
    await component().getByRole('button', { name: 'Retry', exact: true }).click(); await loadedMember()
    const settledCalls = requests.length
    await component().getByRole('button', { name: 'Close workspace access', exact: true }).click(); await openPanel(); await loadedMember()
    assert(requests.length === settledCalls, 'reopening an already settled panel unexpectedly refetched')
    await component().getByRole('button', { name: 'Refresh workspace access', exact: true }).click()
    // This component is nested in the top-bar shadow tree. Playwright's
    // locator traverses it; document.querySelector does not.
    await component().locator('button[aria-label="Refresh workspace access"]:not([disabled])').waitFor({ state: 'visible' })
    assert(requests.length === settledCalls + 1, 'one explicit refresh did not make exactly one request')
  })
  await run('empty-is-observed-not-ownerless', 'empty', async () => {
    await component().getByText('No access grants were returned.', { exact: true }).waitFor({ state: 'visible' })
    assert(await component().locator('input[name="access-user-id"]').isEnabled(), 'empty ACL incorrectly removes directory owner authority')
    assert(await component().getByRole('alert').count() === 0, 'valid empty list was refused')
  })
  await run('grant-missing-result-is-not-success', 'grant-missing-result', async () => {
    await loadedMember(); await add(newMember); await waitError()
    assert(!records.get('graph-a')!.has(newMember), 'fixture unexpectedly applied malformed grant')
    assert(await component().locator(`[data-user-id="${newMember}"]`).count() === 0, 'missing grant result became visible membership')
  })
  await run('revoke-false-is-not-success', 'revoke-false', async () => {
    await loadedMember(); await component().getByRole('button', { name: `Remove ${member}`, exact: true }).click()
    const confirm = page!.getByRole('alertdialog', { name: `Remove ${member}?`, exact: true })
    await confirm.getByRole('button', { name: 'Remove member', exact: true }).click(); await confirm.waitFor({ state: 'detached' })
    await openPanel(); await waitError()
    assert(records.get('graph-a')!.has(member), 'fixture unexpectedly applied false revoke'); await loadedMember()
  })
  await run('accepted-grant-stale-list-is-unconfirmed', 'stale-after-grant', async () => {
    await loadedMember(); await add(newMember); await waitError()
    assert(records.get('graph-a')!.has(newMember), 'synthetic grant was not actually accepted')
    assert(await component().locator(`[data-user-id="${newMember}"]`).count() === 0, 'old list was fabricated into confirmed membership')
    assert((await component().getByRole('alert').innerText()).toLowerCase().includes('accepted'), 'uncertainty discarded the successful mutation acknowledgement')
    assert(await component().getByRole('button', { name: 'Add member', exact: true }).isDisabled(), 'unconfirmed projection permits another change')
    assert(await component().locator('input[name="access-user-id"]').isDisabled(), 'unconfirmed grant leaves the form editable')
    await capture('accepted-but-not-yet-confirmed')
    scenario = 'healthy'
    await component().getByRole('button', { name: 'Retry', exact: true }).click(); await loadedMember(newMember)
    assert(mutations().length === 1, 'refresh retried the already accepted grant')
  })
  await run('stale-confirmation-does-not-mutate-new-graph', 'healthy', async () => {
    await loadedMember(); await component().getByRole('button', { name: `Remove ${member}`, exact: true }).click()
    const confirm = page!.getByRole('alertdialog', { name: `Remove ${member}?`, exact: true })
    await confirm.waitFor({ state: 'visible' }); await capture('graph-a-confirmation')
    await page!.getByRole('combobox', { name: 'Fixture workspace', exact: true }).selectOption('graph-b')
    await confirm.getByRole('button', { name: 'Remove member', exact: true }).click(); await confirm.waitFor({ state: 'detached' })
    await openPanel(); await loadedMember()
    assert(mutations().length === 0, 'graph-A confirmation mutated current graph B')
    assert(records.get('graph-a')!.has(member) && records.get('graph-b')!.has(member), 'stale confirmation removed a fixture member')
    assert((await panel().innerText()).includes('Research Garden B'), 'new graph is not visibly selected')
  })
  await run('shared-owner-is-not-caller', 'healthy', async () => {
    await loadedMember(); await page!.getByRole('combobox', { name: 'Fixture workspace', exact: true }).selectOption('graph-shared')
    await openPanel(); await waitError(); await noFakeEmpty()
    const last = requests.filter(item => (item.body as Rpc)?.params?.arguments?.action === 'list').at(-1)
    assert((last?.body as Rpc)?.params?.arguments?.owner === 'user:other-owner', 'shared graph owner was inferred from caller')
    assert(await component().locator('input[name="access-user-id"]').count() === 0, 'viewer can manage owner-only access')
  })
  assert(receipt.tests.length > 0, 'scenario selection ran no checks')
} catch (error) { failed = true; receipt.fatalError = safeError(error) }
finally {
  releasePendingList()
  if (context) { try { await context.close(); receipt.cleanup.contextsClosed += 1 } catch (error) { receipt.cleanup.contextError = safeError(error); failed = true } }
  if (browser) { try { await browser.close(); receipt.cleanup.browserClosed = !browser.isConnected() } catch (error) { receipt.cleanup.browserError = safeError(error); failed = true } }
  if (server) { try { await server.close(); receipt.cleanup.serverClosed = true } catch (error) { receipt.cleanup.serverError = safeError(error); failed = true } }
  receipt.finishedAt = new Date().toISOString(); receipt.sourceHashesAfter = await hashes()
  receipt.sourceStable = JSON.stringify(receipt.sourceHashesBefore) === JSON.stringify(receipt.sourceHashesAfter)
  if (!receipt.sourceStable) failed = true
  receipt.pass = !failed
  await writeFile(join(artifactDir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(JSON.stringify({ pass: receipt.pass, tests: receipt.tests.map((test: any) => ({ name: test.name, pass: test.assertionsPassed })), cleanup: receipt.cleanup, sourceStable: receipt.sourceStable, artifactDir }))
}
process.exitCode = failed ? 1 : 0
