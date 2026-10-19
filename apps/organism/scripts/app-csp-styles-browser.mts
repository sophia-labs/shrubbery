/**
 * app-csp-styles-browser.mts — do runtime stylesheets apply under the desktop
 * app's Content Security Policy?
 *
 * REPORTED: a click-and-drag selection in the desktop app scrolled the window
 * down into "the mobile app", which seemed to live below the regular one. The
 * Inspector showed the inactive mobile shell (data-active="false") laid out
 * and visible. Its stylesheet, which hides it, never applied.
 *
 * THE CAUSE. The packaged app serves a CSP whose style-src carries a nonce
 * (Tauri adds it). With a nonce present, the browser ignores 'unsafe-inline'
 * for <style> ELEMENTS, so every <style> created at runtime is refused. The dev
 * server, Storybook and every other harness send no CSP, so none of them could
 * see it. Runtime styles are now adopted as constructable stylesheets
 * (adoptStyleSheet in @shrubbery/nucleus), which style-src does not govern.
 *
 * This harness reproduces the app's conditions. It serves the page with the
 * app's style policy and gives the one inline <style> in index.html a nonce,
 * as Tauri does. Then it checks that the mobile shell is hidden at desktop
 * width, and it lists every stylesheet the browser refused.
 *
 *   SHRUBBERY_BROWSER_ENGINE=webkit pnpm -C apps/organism run test:app-csp-styles
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { chromium, webkit } from 'playwright'
import { createServer } from 'vite'
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopbackPath = resolve(appDir, '.gardend-loopback.json')
const port = Number(process.env.SHRUBBERY_CSP_PORT ?? 5296)
const engineName = process.env.SHRUBBERY_BROWSER_ENGINE ?? 'webkit'
if (engineName !== 'chromium' && engineName !== 'webkit') {
  throw new Error('SHRUBBERY_BROWSER_ENGINE must be chromium or webkit')
}
const engine = engineName === 'webkit' ? webkit : chromium
const GRAPH_ID = 'app-csp-probe'
const NONCE = 'harness-nonce'
// The style part of garden/src-tauri/tauri.conf.json's policy, plus the nonce
// Tauri adds. Scripts and connections stay open: this harness tests styles.
const CSP = `style-src 'self' 'unsafe-inline' 'nonce-${NONCE}' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'`

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`app-csp-styles-browser assertion failed: ${message}`)
}

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof createServer>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null

try {
  const bin = resolveGardendBin()
  assert(existsSync(bin), `real gardend binary at ${bin}`)
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000 })
  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'csp probe' })
  writeFileSync(loopbackPath, JSON.stringify({
    apiUrl: cell.apiUrl,
    mcpUrl: cell.mcpUrl,
    token: cell.token,
    port: cell.manifest.port,
    graphId: GRAPH_ID,
  }, null, 2))
  server = await createServer({
    root: appDir,
    configFile: resolve(appDir, 'vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
    logLevel: 'warn',
  })
  await server.listen()
  browser = await engine.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
  const page = await browser.newPage({ viewport: { width: 1512, height: 944 } })

  const refused: string[] = []
  page.on('console', message => {
    const text = message.text()
    if (/stylesheet|style-src|inline style/i.test(text)) refused.push(text.slice(0, 160))
  })
  // Serve the app's HTML the way the packaged app does: CSP header, nonce on
  // the inline <style>.
  await page.route(`http://127.0.0.1:${port}/g/**`, async route => {
    if (route.request().resourceType() !== 'document') return route.continue()
    const response = await route.fetch()
    const html = (await response.text()).replace(/<style>/g, `<style nonce="${NONCE}">`)
    await route.fulfill({
      response,
      body: html,
      headers: { ...response.headers(), 'content-security-policy': CSP },
    })
  })

  await page.goto(`http://127.0.0.1:${port}/g/${GRAPH_ID}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.organismMode === 'local-cell', undefined, { timeout: 60_000 })
  await page.waitForFunction(() => !!document.querySelector('.organism-mobile-shell'), undefined, { timeout: 60_000 })
  await page.waitForTimeout(1000)

  const shell = await page.evaluate(() => {
    const element = document.querySelector('.organism-mobile-shell') as HTMLElement | null
    return element
      ? { active: element.dataset.active, display: getComputedStyle(element).display, height: element.getBoundingClientRect().height }
      : null
  })
  const runtimeStyleElements = await page.evaluate(() =>
    Array.from(document.querySelectorAll('head style:not([nonce])')).map(style =>
      style.id || style.getAttribute('data-vite-dev-id') || (style.textContent ?? '').slice(0, 40)))

  console.log(JSON.stringify({ engine: engineName, shell, runtimeStyleElements, refused }, null, 2))

  assert(shell, 'the mobile shell exists')
  assert(shell.active === 'false', `the mobile shell is inactive at desktop width (data-active=${shell.active})`)
  assert(
    shell.display === 'none',
    `the inactive mobile shell is hidden (display: ${shell.display}); its stylesheet was refused under the app's CSP`,
  )
  console.log('\nUnder the app\'s CSP, the inactive mobile shell stays hidden.')
} finally {
  await browser?.close()
  await server?.close()
  await cell?.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
}
