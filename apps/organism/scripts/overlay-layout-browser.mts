/**
 * Share/resize stacking regression. Uses the real hosted-access consumers,
 * exact index.html framing and the production surface/controlled resize API.
 * Synthetic loopback directory/grants only; no main.ts, cell or real session.
 * pnpm --dir apps/organism exec tsx scripts/overlay-layout-browser.mts --out ABS_NEW_DIR [--baseline]
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer as reservePort } from 'node:net'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = resolve(appDir, '../..')
const baseRevision = 'bca34950711fbbc09a01c6fe31950e9e594e9462'
const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const output = outIndex >= 0 ? args[outIndex + 1] : ''
const baseline = args.includes('--baseline')
if (!output || !isAbsolute(output) || args.some((arg, i) => arg !== '--out' && arg !== '--baseline' && i !== outIndex + 1)) throw new Error('Use --out ABS_NEW_DIRECTORY [--baseline]')
await mkdir(output, { recursive: false })
const temp = await mkdtemp(join(tmpdir(), 'shrubbery-overlay-vite-'))
const indexPath = resolve(appDir, 'index.html')
const indexSource = baseline
  ? execFileSync('git', ['show', `${baseRevision}:apps/organism/index.html`], { cwd: repoDir, encoding: 'utf8' })
  : await readFile(indexPath, 'utf8')
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const sourcePaths = [
  'apps/organism/index.html', 'apps/organism/overlay-layout-harness.html',
  'apps/organism/src/harness/overlay-layout-harness-main.ts', 'apps/organism/scripts/overlay-layout-browser.mts',
  'apps/organism/src/cell/gateway-transport.ts', 'apps/organism/src/cell/gardend-contract.ts',
  'apps/organism/src/cell/shell-features.ts', 'apps/organism/src/cell/access-grant-controller.ts',
  'packages/components/src/mn-top-bar.ts', 'packages/components/src/mn-access-manager.ts',
  'packages/components/src/mn-confirmation-dialog.ts', 'packages/runtime/src/render-workspace.ts',
  'packages/runtime/src/layout/surface-host.ts', 'packages/runtime/src/layout/workspace-surface-element.ts',
]
async function hashes(): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, sha(await readFile(resolve(repoDir, path), 'utf8'))])))
}
const receipt: Record<string, any> = {
  author: '/root/demi_shrubbery', scope: 'local Chromium actual layout; synthetic canonical directory/grants; no deployed/native/editor-session claim',
  startedAt: new Date().toISOString(), baseRevision, baseline, servedIndexSha256: sha(indexSource),
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim(),
  worktreeStatusBefore: execFileSync('git', ['status', '--short'], { cwd: repoDir, encoding: 'utf8' }),
  sourceHashesBefore: await hashes(), cases: [],
  cleanup: { contextsCreated: 0, contextsClosed: 0, browserClosed: false, serverClosed: false },
  networkBoundary: 'same-origin loopback HTTP only; all WebSockets and service workers blocked; grant/revoke never accepted',
}
const owner = 'user:owner-a', member = 'user:member-a'
let withMember = false
let requests: Array<{ method: string; path: string; action?: string; status: number }> = []
let server: ViteDevServer | undefined, browser: Browser | undefined
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function hitAt(page: Page, x: number, y: number) {
  return page.evaluate(point => {
    let hit = document.elementFromPoint(point.x, point.y)
    while (hit?.shadowRoot) {
      const next = hit.shadowRoot.elementFromPoint(point.x, point.y)
      if (!next || next === hit) break
      hit = next
    }
    return { tag: hit?.tagName ?? null, role: hit?.getAttribute('role') ?? null,
      name: hit?.getAttribute('name') ?? null, label: hit?.getAttribute('aria-label') ?? null,
      divider: hit?.closest('[data-layout-divider]')?.getAttribute('data-layout-divider') ?? null,
      access: Boolean(hit?.getRootNode() instanceof ShadowRoot && (hit.getRootNode() as ShadowRoot).host.tagName === 'MN-ACCESS-MANAGER'),
      confirmation: Boolean(hit?.getRootNode() instanceof ShadowRoot && (hit.getRootNode() as ShadowRoot).host.tagName === 'MN-CONFIRMATION-DIALOG') }
  }, { x, y })
}
try {
  const port = await new Promise<number>((accept, reject) => {
    const reservation = reservePort()
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', () => {
      const address = reservation.address()
      if (!address || typeof address === 'string') { reservation.close(); reject(new Error('No fixture port')); return }
      reservation.close(error => error ? reject(error) : accept(address.port))
    })
  })
  server = await createServer({
    root: appDir, configFile: false, envDir: temp, cacheDir: join(temp, 'cache'), logLevel: 'error',
    optimizeDeps: { entries: ['overlay-layout-harness.html'], exclude: ['oxigraph'] },
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false, fs: { allow: [repoDir] } },
    plugins: [{
      name: 'share-overlay-exact-source-fixture', enforce: 'pre',
      load(id) { if (baseline && id.split('?')[0] === indexPath && id.includes('?raw')) return `export default ${JSON.stringify(indexSource)}` },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          const path = new URL(req.url ?? '/', 'http://fixture.invalid').pathname
          if (!path.startsWith('/access-harness/gateway/')) return next()
          void (async () => {
            const entry: typeof requests[number] = { method: req.method ?? 'GET', path, status: 200 }
            requests.push(entry)
            const send = (value: unknown, status = 200) => { entry.status = status; res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
            if (req.headers.authorization !== 'Bearer synthetic-access-owner-id-token') return send({ error: 'Synthetic credential required' }, 401)
            if (path === '/access-harness/gateway/graphs' && req.method === 'GET') return send([
              { owner, graphId: 'graph-a', title: 'Layout fixture Garden', role: 'owner', cellState: 'running' },
            ])
            if (path !== '/access-harness/gateway/control/mcp' || req.method !== 'POST') return send({ error: 'not found: route' }, 404)
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(Buffer.from(chunk))
            const call = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            entry.action = call.params?.arguments?.action
            const named = call.params?.arguments
            if (call.jsonrpc !== '2.0' || call.method !== 'tools/call' || call.params?.name !== 'manage_access'
              || named?.owner !== owner || named?.graphId !== 'graph-a' || entry.action !== 'list') {
              return send({ jsonrpc: '2.0', id: call.id, error: { code: -32003, message: 'Fixture is list-only; mutations are refused' } })
            }
            const grants = withMember ? [{ graph: { owner, graphId: 'graph-a' }, generation: 1, principal: member,
              role: 'editor', grantedBy: owner, grantedAtMs: 1788739200000 }] : []
            send({ jsonrpc: '2.0', id: call.id, result: { structuredContent: grants, content: [{ type: 'text', text: JSON.stringify(grants) }], isError: false } })
          })().catch(error => { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(error) })) })
        })
      },
    }],
  })
  await server.listen()
  const origin = `http://127.0.0.1:${port}`
  receipt.origin = origin
  browser = await chromium.launch({ headless: true, timeout: 30000, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync'] })
  receipt.engine = browser.version()
  for (const height of [720, 900]) for (const members of [false, true]) {
    withMember = members; requests = []
    const id = `${height}-${members ? 'member' : 'empty'}`
    const observed: Record<string, any> = { id, viewport: { width: 1280, height }, members, checks: {}, pageErrors: [], blockedExternal: [], blockedWebSockets: [] }
    receipt.cases.push(observed)
    let context: BrowserContext | undefined
    try {
      context = await browser.newContext({ viewport: observed.viewport, serviceWorkers: 'block' })
      receipt.cleanup.contextsCreated++
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin === origin) return route.continue()
        observed.blockedExternal.push(route.request().url()); return route.abort('blockedbyclient')
      })
      await context.routeWebSocket('**/*', socket => { observed.blockedWebSockets.push(socket.url()); socket.close() })
      const page = await context.newPage()
      page.setDefaultTimeout(8000)
      page.on('pageerror', error => observed.pageErrors.push(error.message))
      await page.goto(`${origin}/overlay-layout-harness.html`, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForFunction(() => window.__overlayLayout?.state.ready || window.__overlayLayout?.state.error)
      const state = await page.evaluate(() => window.__overlayLayout.state)
      assert(state.ready && !state.error, 'Actual fixture did not reach the requested frame/renderer')
      assert(await page.locator('.app-container[data-workspace-renderer="surface"]').count() === 1, 'Expected the actual surface renderer')
      const access = page.locator('mn-access-manager')
      const trigger = access.getByRole('button', { name: 'Manage workspace access', exact: true })
      const panel = access.getByRole('dialog', { name: 'Workspace access', exact: true })
      const input = access.locator('input[name="access-user-id"]')
      await trigger.click(); await panel.waitFor({ state: 'visible' })
      if (members) await access.locator(`[data-user-id="${member}"]`).waitFor({ state: 'visible' })
      else await access.getByText('No access grants were returned.', { exact: true }).waitFor({ state: 'visible' })
      const separator = page.getByRole('separator', { name: 'Resize right panel', exact: true })
      const dividerBox = await separator.boundingBox(), inputBox = await input.boundingBox(), panelBox = await panel.boundingBox()
      assert(dividerBox && inputBox && panelBox, 'Required real layout is absent')
      const x = dividerBox.x + dividerBox.width / 2, y = inputBox.y + inputBox.height / 2
      assert(x > inputBox.x && x < inputBox.x + inputBox.width && y > dividerBox.y && y < dividerBox.y + dividerBox.height, 'Fixture must reproduce actual input/divider geometric overlap')
      observed.layout = { dividerBox, inputBox, panelBox, intersection: { x, y },
        main: await page.locator('.app-container > .main').evaluate(el => ({ position: getComputedStyle(el).position, isolation: getComputedStyle(el).isolation })) }
      observed.inputHit = await hitAt(page, x, y)
      observed.checks.inputHitBelongsToShare = observed.inputHit.name === 'access-user-id' && observed.inputHit.access && !observed.inputHit.divider
      observed.panelHits = []
      for (const hitY of [panelBox.y + 20, y, panelBox.y + panelBox.height - 20]) observed.panelHits.push(await hitAt(page, x, hitY))
      observed.checks.panelPaintOwnsSplitIntersection = observed.panelHits.every((hit: any) => hit.access && !hit.divider)
      await page.screenshot({ path: join(output, `${id}-overlap.png`), fullPage: true })
      await writeFile(join(output, `${id}-overlap.aria.txt`), await page.locator('body').ariaSnapshot(), { flag: 'wx' })

      await page.mouse.click(x, y)
      observed.checks.pointerFocusesFormWithoutClosing = await panel.isVisible() && await input.evaluate(el => el.getRootNode() instanceof ShadowRoot && (el.getRootNode() as ShadowRoot).activeElement === el)
      if (await panel.isVisible()) await access.getByRole('button', { name: 'Close workspace access', exact: true }).click()
      // Real surface handlers still own keyboard and pointer resize outside
      // the closed overlay; this does not certify shell persistence to disk.
      observed.resize = []
      for (const label of ['Resize sidebar', 'Resize right panel']) {
        const handle = page.getByRole('separator', { name: label, exact: true })
        const before = Number(await handle.getAttribute('aria-valuenow'))
        await handle.focus(); await handle.press('ArrowRight')
        const after = Number(await handle.getAttribute('aria-valuenow'))
        observed.resize.push({ label, source: 'keyboard', before, after })
      }
      const dragHandle = page.getByRole('separator', { name: 'Resize right panel', exact: true })
      const dragBox = await dragHandle.boundingBox()
      assert(dragBox, 'Resize handle disappeared')
      const beforeDrag = Number(await dragHandle.getAttribute('aria-valuenow'))
      await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height - 50)
      await page.mouse.down(); await page.mouse.move(dragBox.x + dragBox.width / 2 + 25, dragBox.y + dragBox.height - 50, { steps: 4 }); await page.mouse.up()
      const afterDrag = Number(await dragHandle.getAttribute('aria-valuenow'))
      observed.resize.push({ label: 'Resize right panel', source: 'pointer', before: beforeDrag, after: afterDrag })
      observed.checks.resizeStillChangesRatio = observed.resize.every((change: any) => Number.isFinite(change.before) && Number.isFinite(change.after) && change.before !== change.after)
      observed.resizeConsumer = await page.evaluate(() => window.__overlayLayout.state)
      observed.checks.resizeReachesControlledHost = observed.resizeConsumer.resizeEvents.length >= 3
        && observed.resizeConsumer.leftWidth !== 280 && observed.resizeConsumer.rightWidth !== 420
      await trigger.click(); await panel.waitFor({ state: 'visible' })
      await input.fill('user:local-layout-only'); await input.press('Escape')
      observed.checks.escapeClosesShare = !await panel.isVisible() && await trigger.getAttribute('aria-expanded') === 'false'
      if (members) {
        await trigger.click(); await panel.waitFor({ state: 'visible' })
        await access.getByRole('button', { name: `Remove ${member}`, exact: true }).click()
        const confirmation = page.getByRole('alertdialog', { name: `Remove ${member}?`, exact: true })
        await confirmation.waitFor({ state: 'visible' })
        const confirmHost = page.locator('mn-confirmation-dialog')
        const cancelBox = await confirmation.getByRole('button', { name: 'Cancel', exact: true }).boundingBox()
        assert(cancelBox, 'Confirmation cancel is absent')
        observed.confirmationHit = await hitAt(page, cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2)
        observed.confirmationHeaderHit = await hitAt(page, 100, 20)
        observed.checks.confirmationIsBodyPortal = await confirmHost.evaluate(el => el.parentElement === document.body && !el.closest('.main'))
        observed.checks.confirmationOwnsPointerAboveChrome = observed.confirmationHit.confirmation && observed.confirmationHeaderHit.confirmation
        await page.screenshot({ path: join(output, `${id}-confirmation.png`), fullPage: true })
        await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click(); await confirmation.waitFor({ state: 'detached' })
        observed.checks.cancelReturnsWithoutMutation = !requests.some(item => item.action && item.action !== 'list')
      }
      observed.checks.noUncaughtPageErrors = observed.pageErrors.length === 0
      observed.checks.noExternalRequests = observed.blockedExternal.length === 0
      observed.checks.noAccessMutations = !requests.some(item => item.action && item.action !== 'list')
      observed.pass = Object.values(observed.checks).every(Boolean)
    } catch (error) { observed.error = error instanceof Error ? error.stack ?? error.message : String(error); observed.pass = false }
    finally {
      observed.requests = [...requests]
      if (context) { await context.close(); receipt.cleanup.contextsClosed++ }
      console.log(JSON.stringify({ id, pass: observed.pass, checks: observed.checks, error: observed.error }))
    }
  }
  receipt.sourceHashesAfter = await hashes()
  receipt.sourceStable = JSON.stringify(receipt.sourceHashesBefore) === JSON.stringify(receipt.sourceHashesAfter)
  receipt.pass = receipt.sourceStable && receipt.cases.length === 4 && receipt.cases.every((item: any) => item.pass)
} catch (error) { receipt.error = error instanceof Error ? error.stack ?? error.message : String(error); receipt.pass = false }
finally {
  if (browser) { await browser.close(); receipt.cleanup.browserClosed = true }
  if (server) { await server.close(); receipt.cleanup.serverClosed = true }
  receipt.tempCacheRetained = temp
  receipt.finishedAt = new Date().toISOString()
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
}
console.log(JSON.stringify({ output, pass: receipt.pass, sourceStable: receipt.sourceStable, cleanup: receipt.cleanup, error: receipt.error }))
process.exitCode = receipt.pass ? 0 : 1
