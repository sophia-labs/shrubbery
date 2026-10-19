/**
 * app-csp-built-browser.mts — does the BUILT app run under the desktop app's exact Content Security Policy?
 *
 * app-csp-styles-browser.mts checks the style half on the dev server. The dev server cannot run under the
 * app's script-src ('self' 'wasm-unsafe-eval'), so this harness serves the production bundle (vite build, then
 * vite preview with the cell proxy) and gives its HTML the whole policy that ships in the packaged app: the
 * `app.security.csp` string of gardend's src-tauri/tauri.conf.json, read from the file itself, never retyped.
 * Tauri adds to that policy at build time (a nonce on style-src, hashes of inline scripts on script-src) and tags
 * the inline <style> elements; this harness does the same to the HTML it serves.
 *
 * With a real gardend behind the proxy, it checks that the app boots to its local cell, that the inactive mobile
 * shell stays hidden (its stylesheet was once refused), and that the browser reported no policy violation for
 * scripts, styles, connections or workers.
 *
 * The policy file: GARDEND_TAURI_CONF, else ../gardend/src-tauri/tauri.conf.json (or ../garden/...) beside this
 * checkout, else the one on gardend's main branch on GitHub.
 *
 *   SHRUBBERY_BROWSER_ENGINE=webkit pnpm -C apps/organism run test:app-csp-built
 */
import { createHash, randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { chromium, webkit } from 'playwright'
import { build, preview } from 'vite'
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loopbackPath = resolve(appDir, '.gardend-loopback.json')
const port = Number(process.env.SHRUBBERY_CSP_BUILT_PORT ?? 5297)
const engineName = process.env.SHRUBBERY_BROWSER_ENGINE ?? 'webkit'
if (engineName !== 'chromium' && engineName !== 'webkit') {
  throw new Error('SHRUBBERY_BROWSER_ENGINE must be chromium or webkit')
}
const engine = engineName === 'webkit' ? webkit : chromium
const GRAPH_ID = 'app-csp-built-probe'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`app-csp-built-browser assertion failed: ${message}`)
}

/** The app's policy, from gardend's tauri.conf.json. */
async function readAppPolicy(): Promise<string> {
  const candidates = [
    process.env.GARDEND_TAURI_CONF,
    resolve(appDir, '../../../gardend/src-tauri/tauri.conf.json'),
    resolve(appDir, '../../../garden/src-tauri/tauri.conf.json'),
  ].filter((p): p is string => Boolean(p))
  let text: string | null = null
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      text = readFileSync(candidate, 'utf8')
      break
    }
  }
  if (text === null) {
    const response = await fetch('https://raw.githubusercontent.com/sophia-labs/gardend/main/src-tauri/tauri.conf.json')
    assert(response.ok, `tauri.conf.json from gardend main (HTTP ${response.status}); set GARDEND_TAURI_CONF to a copy`)
    text = await response.text()
  }
  const conf = JSON.parse(text) as { app?: { security?: { csp?: unknown } } }
  const csp = conf.app?.security?.csp
  assert(typeof csp === 'string' && csp.includes('script-src'), 'tauri.conf.json carries app.security.csp as one string')
  return csp
}

/** What Tauri does to the policy and the HTML at build time: nonce for styles, hashes for inline scripts. */
function applyTauriInjection(policy: string, html: string, nonce: string): { policy: string; html: string } {
  const hashes: string[] = []
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    if (match[1].trim()) hashes.push(`'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`)
  }
  const withDirective = (source: string, name: string, extra: string[]): string =>
    source.replace(new RegExp(`(${name}\\s[^;]*)`), `$1 ${extra.join(' ')}`.trimEnd())
  let out = withDirective(policy, 'style-src', [`'nonce-${nonce}'`])
  if (hashes.length > 0) out = withDirective(out, 'script-src', hashes)
  return { policy: out, html: html.replace(/<style(?=[\s>])/g, `<style nonce="${nonce}"`) }
}

let cell: GardendCell | null = null
let server: Awaited<ReturnType<typeof preview>> | null = null
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
const outDir = mkdtempSync(resolve(tmpdir(), 'shrubbery-csp-built.'))

try {
  const policy = await readAppPolicy()
  const bin = resolveGardendBin()
  assert(existsSync(bin), `real gardend binary at ${bin}`)
  cell = await spawnGardend({ bin, readyTimeoutMs: 30_000 })
  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl,
    healthUrl: `${cell.apiUrl}/health`,
    token: cell.token,
    origin: 'http://127.0.0.1',
  })
  await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'csp built probe' })
  writeFileSync(loopbackPath, JSON.stringify({
    apiUrl: cell.apiUrl,
    mcpUrl: cell.mcpUrl,
    token: cell.token,
    port: cell.manifest.port,
    graphId: GRAPH_ID,
  }, null, 2))

  await build({
    root: appDir,
    configFile: resolve(appDir, 'vite.config.ts'),
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true },
  })
  server = await preview({
    root: appDir,
    configFile: resolve(appDir, 'vite.config.ts'),
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', port, strictPort: true },
  })

  browser = await engine.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
  const page = await browser.newPage({ viewport: { width: 1512, height: 944 } })
  const nonce = randomBytes(12).toString('base64')
  const violations: string[] = []
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', event => {
      const holder = window as unknown as { __cspViolations?: string[] }
      holder.__cspViolations = holder.__cspViolations ?? []
      const log = holder.__cspViolations
      log.push(`${event.effectiveDirective} ${event.blockedURI || event.sample || ''}`.slice(0, 200))
    })
  })
  page.on('console', message => {
    const text = message.text()
    if (/Refused to|violat(es|ion)|Content Security Policy/i.test(text)) violations.push(text.slice(0, 200))
  })
  let appliedPolicy = policy
  await page.route(`http://127.0.0.1:${port}/g/**`, async route => {
    if (route.request().resourceType() !== 'document') return route.continue()
    const response = await route.fetch()
    const injected = applyTauriInjection(policy, await response.text(), nonce)
    appliedPolicy = injected.policy
    await route.fulfill({
      response,
      body: injected.html,
      headers: { ...response.headers(), 'content-security-policy': injected.policy },
    })
  })

  await page.goto(`http://127.0.0.1:${port}/g/${GRAPH_ID}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.organismMode === 'local-cell', undefined, { timeout: 60_000 })
  await page.waitForFunction(() => !!document.querySelector('.organism-mobile-shell'), undefined, { timeout: 60_000 })
  await page.waitForTimeout(1500)

  const shell = await page.evaluate(() => {
    const element = document.querySelector('.organism-mobile-shell') as HTMLElement | null
    return element
      ? { active: element.dataset.active, display: getComputedStyle(element).display }
      : null
  })
  const reported = await page.evaluate(() => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [])
  const blocking = reported.filter(entry => /^(script-src|style-src|connect-src|worker-src|default-src)/.test(entry))

  console.log(JSON.stringify({ engine: engineName, policy: appliedPolicy, shell, reported, consoleRefusals: violations }, null, 2))

  assert(shell, 'the mobile shell exists')
  assert(shell.active === 'false' && shell.display === 'none', `the inactive mobile shell stays hidden (${JSON.stringify(shell)})`)
  assert(blocking.length === 0, `the browser reported policy violations under the app's CSP: ${blocking.join(' | ')}`)
  console.log('\nThe built app boots and stays inside the desktop app\'s policy.')
} finally {
  await browser?.close()
  await server?.close()
  await cell?.kill()
  if (existsSync(loopbackPath)) unlinkSync(loopbackPath)
  rmSync(outDir, { recursive: true, force: true })
}
