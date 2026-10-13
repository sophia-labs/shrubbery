/**
 * Local-only layout gate for the real footer. No gardend, proxy, auth or native host.
 * --baseline serves the exact base-revision component through Vite, without editing
 * the shared worktree. All other dependencies stay at this worktree's explicit state.
 * pnpm --dir apps/organism exec tsx scripts/footer-layout-browser.mts --out ABS_NEW_DIR [--baseline]
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer as createPortReservation } from 'node:net'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = resolve(appDir, '../..')
const componentPath = 'packages/components/src/mn-bottom-bar.ts'
const componentFile = resolve(repoDir, componentPath)
const revision = '7a4cc1c0fc8fa83c7047dcaf431e4f0b2bcea6ca'
const args = process.argv.slice(2)
const baseline = args.includes('--baseline')
const outIndex = args.indexOf('--out')
const output = outIndex >= 0 ? args[outIndex + 1] : ''
if (!output || !isAbsolute(output) || args.some((arg, i) => arg !== '--baseline' && arg !== '--out' && i !== outIndex + 1)) throw new Error('Use --out ABSOLUTE_NEW_DIRECTORY [--baseline]')
mkdirSync(output, { recursive: false })
const temp = mkdtempSync(join(tmpdir(), 'shrubbery-footer-vite-'))
const componentSource = baseline
  ? execFileSync('git', ['-C', repoDir, 'show', `${revision}:${componentPath}`], { encoding: 'utf8' })
  : readFileSync(componentFile, 'utf8')
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const scenarios = [
  { id: 'resident-1280', width: 1280, height: 720, params: {} },
  { id: 'resident-1280-right320', width: 1280, height: 720, params: { rightWidth: '320px' } },
  { id: 'long-1280', width: 1280, height: 720, params: { labels: 'long', stats: '1' } },
  { id: 'long-1024', width: 1024, height: 720, params: { labels: 'long', stats: '1' } },
  { id: 'long-768', width: 768, height: 720, params: { labels: 'long', stats: '1' } },
  { id: 'long-480', width: 480, height: 720, params: { labels: 'long', stats: '1' } },
  { id: 'long-320', width: 320, height: 720, params: { labels: 'long', stats: '1' } },
  { id: 'collapsed-768', width: 768, height: 720, params: { labels: 'long', stats: '1', rightCollapsed: '1', leftCollapsed: '1' } },
  { id: 'dark-768', width: 768, height: 720, params: { labels: 'long', stats: '1', theme: 'dark' } },
  { id: 'emporium-768', width: 768, height: 720, params: { labels: 'long', stats: '1', skin: 'emporium' } },
]
const receipt: Record<string, unknown> = {
  author: '/root/surface_atlas (Margin Keeper)', mode: 'synthetic-component-chromium', baseline,
  startedAt: new Date().toISOString(), componentPath, componentSha256: sha256(componentSource),
  baseRevision: revision, sourceBinding: baseline ? 'exact git component + current local dependencies' : 'working-tree component + current local dependencies',
  harnessFiles: ['footer-layout-harness.html', 'src/harness/footer-layout-harness-main.ts', 'scripts/footer-layout-browser.mts'].map(path => ({ path: `apps/organism/${path}`, sha256: sha256(readFileSync(resolve(appDir, path), 'utf8')) })),
  browserClosed: false, serverClosed: false, cases: [], externalRequestsBlocked: 0,
}
let browser: Browser | undefined, server: ViteDevServer | undefined
let forbidden = 0
try {
  // Vite 5 treats port: 0 as its default5173. Ask the OS for an unused
  // loopback port explicitly; strictPort refuses any intervening collision.
  const port = await new Promise<number>((accept, reject) => {
    const reservation = createPortReservation()
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', () => {
      const address = reservation.address()
      if (!address || typeof address === 'string') { reservation.close(); reject(new Error('No local port reservation')); return }
      reservation.close(error => error ? reject(error) : accept(address.port))
    })
  })
  server = await createServer({
    root: appDir, configFile: false, envDir: temp, cacheDir: join(temp, 'cache'),
    plugins: baseline ? [{ name: 'footer-base-snapshot', enforce: 'pre', load(id) { if (id.split('?')[0] === componentFile) return componentSource } }] : [],
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false, fs: { allow: [repoDir] } },
    logLevel: 'error',
  })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('No local fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch({ headless: true })
  receipt.engine = browser.version()
  for (const scenario of scenarios) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, serviceWorkers: 'block' })
    try {
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin === origin) return route.continue()
        forbidden++; return route.abort('blockedbyclient')
      })
      const page = await context.newPage()
      const pageErrors: string[] = []
      page.on('pageerror', error => pageErrors.push(error.message))
      const params = new URLSearchParams(scenario.params as Record<string, string>)
      await page.goto(`${origin}/footer-layout-harness.html?${params}`, { waitUntil: 'networkidle', timeout: 20000 })
      await page.waitForSelector('body[data-footer-layout-ready="true"]', { timeout: 15000 })
      // Geometry runs in the Vite-compiled fixture, avoiding tsx's Node-only
      // nested-function naming helper inside a serialized browser callback.
      const layout = await page.evaluate(() => (window as unknown as { __footerLayout: { measure(): { overlap: string[]; outside: string[]; viewportOverflow: boolean; mainHeight: number; syncText: string; rightControlCount: number; leftControlCount: number; mirrorAnnouncement: string; liveAnnouncement: string } } }).__footerLayout.measure())
      const events: Array<{ name: string; detail: Record<string, string> | null }> = []
      let collapsedWidths: number[] | null = null
      if (!layout.overlap.length && !layout.outside.length && !layout.viewportOverflow) {
        for (const name of ['Toggle Sophia panel', 'Toggle comments panel', 'Toggle wires panel', 'Toggle graph panel']) await page.getByRole('button', { name, exact: true }).click({ timeout: 2000 })
        await page.getByRole('button', { name: 'Toggle graph panel', exact: true }).focus()
        await page.keyboard.press('Enter')
        if (!scenario.params.leftCollapsed) {
          await page.getByRole('button', { name: 'Graph', exact: true }).click({ timeout: 2000 })
          await page.getByRole('button', { name: 'Outline', exact: true }).click({ timeout: 2000 })
        }
        if (scenario.params.stats) await page.getByRole('button', { name: 'Export document', exact: true }).click({ timeout: 2000 })
        if (scenario.params.labels === 'long') {
          await page.locator('mn-badge[data-source-badge="contested"]').getByRole('button').click({ timeout: 2000 })
          await page.locator('mn-badge[data-source-badge="parked"]').getByRole('button').click({ timeout: 2000 })
        }
        if (scenario.params.rightCollapsed) {
          collapsedWidths = []
          for (const count of [3, 130]) collapsedWidths.push(await page.evaluate(count => (window as unknown as { __footerLayout: { contestedWidth(count: number): Promise<number> } }).__footerLayout.contestedWidth(count), count))
        }
        events.push(...await page.evaluate(() => (window as unknown as { __footerLayoutEvents: typeof events }).__footerLayoutEvents))
      }
      const screenshot = `${scenario.id}.png`
      await page.screenshot({ path: join(output, screenshot), fullPage: true })
      const controlsPass = JSON.stringify(events.filter(e => e.name === 'mn-panel-toggle').map(e => e.detail?.panel)) === JSON.stringify(['chat', 'comments', 'wires', 'graph', 'graph'])
        && (scenario.params.leftCollapsed || JSON.stringify(events.filter(e => e.name === 'mn-left-mode-change').map(e => e.detail?.mode)) === JSON.stringify(['graph', 'outline']))
        && (!scenario.params.stats || events.some(e => e.name === 'mn-document-export'))
        && (scenario.params.labels !== 'long' || JSON.stringify(events.filter(e => e.name === 'mn-source-badge-activate').map(e => e.detail?.kind)) === JSON.stringify(['contested', 'parked']))
      const pass = layout.overlap.length === 0 && layout.outside.length === 0 && !layout.viewportOverflow && layout.mainHeight > 0 && layout.syncText === 'Connected' && layout.rightControlCount === 4 && layout.leftControlCount === (scenario.params.leftCollapsed ? 0 : 3) && layout.mirrorAnnouncement === 'polite' && layout.liveAnnouncement === 'off' && controlsPass && (!collapsedWidths || Math.abs(collapsedWidths[0] - collapsedWidths[1]) <= 0.5) && pageErrors.length === 0
      ;(receipt.cases as unknown[]).push({ ...scenario, pass: Boolean(pass), layout, events, collapsedWidths, pageErrors, screenshot })
    } finally { await context.close() }
  }
  receipt.externalRequestsBlocked = forbidden
  receipt.pass = forbidden === 0 && (receipt.cases as Array<{ pass: boolean }>).every(c => c.pass)
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error)
  receipt.pass = false
} finally {
  if (browser) { await browser.close(); receipt.browserClosed = true }
  if (server) { await server.close(); receipt.serverClosed = true }
  rmSync(temp, { recursive: true, force: true })
  receipt.finishedAt = new Date().toISOString()
  writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
}
console.log(JSON.stringify({ output, pass: receipt.pass, baseline, cases: (receipt.cases as Array<{ id: string; pass: boolean; layout: { overlap: string[]; outside: string[] } }>).map(c => ({ id: c.id, pass: c.pass, overlap: c.layout.overlap, outside: c.layout.outside })), error: receipt.error, browserClosed: receipt.browserClosed, serverClosed: receipt.serverClosed }, null, 2))
process.exitCode = receipt.pass ? 0 : 1
