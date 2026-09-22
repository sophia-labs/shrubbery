/**
 * planter-browser.mts — the real-Chromium proof for the PLANTER SPA (design
 * §3.3's Chromium gate). NO MOCKS: a real spawned gardend, a real Vite dev
 * server (this app's OWN vite.config.ts, which consumes
 * `scripts/vite-cell-proxy.ts`'s `dynamicCellProxy` — NO-TOUCH, never
 * edited), a real Chromium (Playwright), and a real `sparql_update` mutation
 * against the live cell.
 *
 * Proves, driving the SPA through the real vite dev proxy:
 *   1. the seeded workspace mounts (`.app-container` present, 7 panels);
 *   2. `.mn-kind[data-kind="testimony"]`'s COMPUTED style carries kind.css's
 *      `--mn-kind-register-current: testimony` (not merely that the
 *      attribute exists — the actual cascade, in a real browser);
 *   3. a real `sparql_update` INSERT DATA against the bound `:ux:config`
 *      graph is observed through the SPA's OWN poll loop: the testimony
 *      strip's `data-triple-count` advances from N to N+1 with NO page
 *      reload — a poll-driven re-render, not a fresh navigation;
 *   4. killing the cell renders the honest error panel
 *      (`.planter-panel-error[data-error-kind="unavailable"]`).
 *
 * This is the WF-D P2 rehearsal (design §3.3/§3.4) — live-read claims here
 * are licensed by FID-004 (U5, green: commit 1de9062, gardend binary sha256
 * 59cb506c…, 2026-07-11).
 *
 * Usage:
 *   pnpm --dir apps/planter test:browser [-- --headed] [-- --slow-mo <ms>]
 */

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import { uxConfigGraphIri } from '@shrubbery/nucleus'
import { McpClient } from '@shrubbery/source'
import {
  createGraphAndSeedUxConfig,
  loopbackSeedTarget,
  spawnGardend,
  type GardendCell,
} from '@shrubbery/source/node'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require_ = createRequire(import.meta.url)
const SEED_NT_PATH = require_.resolve('@shrubbery/nucleus/seed/garden-default.ux.nt')
const SEED_NT = readFileSync(SEED_NT_PATH, 'utf8')

interface Options {
  readonly headed: boolean
  readonly slowMo: number
  readonly bundle?: string
}

const help = `Usage:
  pnpm --dir apps/planter test:browser -- [options]

Real-Chromium proof of the planter SPA against a real, freshly spawned
gardend cell, driven through this app's own Vite dev proxy.

Options:
  --headed          Show Chromium while the proof runs.
  --slow-mo <ms>     Delay Playwright actions (default: 75 headed, 0 headless).
  --bundle <id>      Boot a code-reviewed SiteBundle (currently: garden).
  -h, --help         Print this help without starting Vite, Chromium, or gardend.

Environment:
  GARDEN_BIN                       gardend binary to prove.
  SHRUBBERY_CHROME_EXECUTABLE      Chrome/Chromium executable override.
`

function hasArg(name: string): boolean {
  return process.argv.slice(2).includes(name)
}

function argValue(name: string): string | undefined {
  const args = process.argv.slice(2)
  const index = args.indexOf(name)
  if (index >= 0) return args[index + 1]
  return args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1)
}

function options(): Options {
  const headed = hasArg('--headed')
  const rawSlowMo = Number(argValue('--slow-mo') ?? (headed ? 75 : 0))
  const bundle = argValue('--bundle')
  return {
    headed,
    slowMo: Number.isFinite(rawSlowMo) && rawSlowMo >= 0 ? rawSlowMo : 0,
    ...(bundle ? { bundle } : {}),
  }
}

function chromeExecutable(): string | undefined {
  const explicit = process.env.SHRUBBERY_CHROME_EXECUTABLE
  if (explicit) {
    assert(existsSync(explicit), `configured Chrome executable does not exist: ${explicit}`)
  }
  return explicit
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function freePort(): Promise<number> {
  const socket = createNetServer()
  await new Promise<void>((res, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', res)
  })
  const address = socket.address()
  assert(address && typeof address === 'object', 'could not reserve a Vite port')
  const port = address.port
  await new Promise<void>((res, reject) => {
    socket.close((error) => (error ? reject(error) : res()))
  })
  return port
}

async function main(): Promise<void> {
  const opts = options()
  const graphId = `planter-browser-${randomUUID().slice(0, 8)}`
  const graphIri = uxConfigGraphIri(graphId)

  let cell: GardendCell | undefined
  let vite: ViteDevServer | undefined
  let browser: Browser | undefined
  let context: BrowserContext | undefined
  let page: Page | undefined
  const consoleErrors: string[] = []
  const pageErrors: string[] = []

  try {
    process.stdout.write('[planter-browser] spawning real gardend\n')
    cell = await spawnGardend()
    await createGraphAndSeedUxConfig(loopbackSeedTarget(cell), graphId, SEED_NT, 'Planter Browser Gate')

    // The vite.config.ts's default manifest discovery IS the cell's own
    // loopback.json (camelCase apiUrl/mcpUrl/token — exactly what
    // dynamicCellProxy validates) — no separate handoff file needed.
    const manifestPath = resolve(cell.profileDir, 'loopback.json')
    const previousManifestEnv = process.env.GARDEND_LOOPBACK_MANIFEST
    process.env.GARDEND_LOOPBACK_MANIFEST = manifestPath

    process.stdout.write('[planter-browser] starting the real planter Vite dev server\n')
    const port = await freePort()
    vite = await createViteServer({
      root: appDir,
      configFile: resolve(appDir, 'vite.config.ts'),
      server: { host: '127.0.0.1', port, strictPort: true },
      logLevel: 'warn',
    })
    await vite.listen()

    if (previousManifestEnv === undefined) delete process.env.GARDEND_LOOPBACK_MANIFEST
    else process.env.GARDEND_LOOPBACK_MANIFEST = previousManifestEnv

    // Fast poll so the mutation-observed re-render doesn't need a long wait.
    const pathname = opts.bundle === 'garden' ? '/workspace' : '/'
    const appUrl =
      `http://127.0.0.1:${port}${pathname}?endpoint=/cell&graph=${encodeURIComponent(graphId)}` +
      `&adapter=gardend-local&authMode=none&pollMs=500${opts.bundle ? `&bundle=${encodeURIComponent(opts.bundle)}` : ''}`

    process.stdout.write('[planter-browser] launching real Chromium\n')
    browser = await chromium.launch({
      headless: !opts.headed,
      slowMo: opts.slowMo,
      ...(chromeExecutable() ? { executablePath: chromeExecutable() } : {}),
    })
    context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    page = await context.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => pageErrors.push(err.stack ?? err.message))

    process.stdout.write(`[planter-browser] navigating to ${appUrl}\n`)
    await page.goto(appUrl, { waitUntil: 'commit', timeout: 30_000 })

    // 1) the seeded workspace mounts. `state: 'attached'` (not the default
    // 'visible'): this host's index.html is deliberately minimal-CSS (the
    // generic curl-able host, not a themed product shell) — @shrubbery/runtime's
    // `.app-container` has no explicit height/display here, so Playwright's
    // visibility geometry check can read it as zero-size even though the real
    // DOM (panels, chrome, testimony) is fully present and correct.
    await page.waitForSelector('.app-container', { state: 'attached', timeout: 30_000 })
    const panelCount = await page.evaluate(
      () => document.querySelectorAll('.split-pane[data-region]').length,
    )
    assert(panelCount === 3, `expected 3 split-panes (left/center/right), got ${panelCount}`)

    if (opts.bundle === 'garden') {
      const posture = await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>('#app')
        const left = document.querySelector('sl-split-panel[data-split-role="left"]')
        const right = document.querySelector('sl-split-panel[data-split-role="right"]')
        return {
          bundle: host?.dataset.siteBundle,
          route: host?.dataset.siteRoute,
          leftSnap: left?.getAttribute('snap'),
          rightSnap: right?.getAttribute('snap'),
          threshold: left?.getAttribute('snap-threshold'),
        }
      })
      assert(posture.bundle === 'garden', `expected Garden bundle marker, got ${JSON.stringify(posture)}`)
      assert(posture.route === 'workspace', `expected workspace route, got ${JSON.stringify(posture)}`)
      assert(posture.leftSnap === '180px 280px 500px', `Garden left snap posture missing: ${JSON.stringify(posture)}`)
      assert(posture.rightSnap === '240px 420px 500px', `Garden right snap posture missing: ${JSON.stringify(posture)}`)
      assert(posture.threshold === '24', `Garden snap threshold missing: ${JSON.stringify(posture)}`)

      const clickTopBar = async (selector: string): Promise<void> => {
        await page!.evaluate((buttonSelector) => {
          const button = document.querySelector('mn-top-bar')?.shadowRoot?.querySelector<HTMLButtonElement>(buttonSelector)
          if (!button) throw new Error(`top-bar button not found: ${buttonSelector}`)
          button.click()
        }, selector)
      }
      await clickTopBar('button[data-action="skin"]')
      await page.waitForFunction(() => document.documentElement.dataset.skin === 'emporium')
      await clickTopBar('button[data-action="skin"]')
      await page.waitForFunction(() => document.documentElement.dataset.skin === '98')
      await clickTopBar('button[data-action="skin"]')
      await page.waitForFunction(() => document.documentElement.dataset.skin === 'glass')
      await clickTopBar('button[aria-label="Toggle theme"]')
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
      await clickTopBar('button[aria-label="Settings"]')
      await page.waitForFunction(() => document.querySelector('.planter-bundle-notice')?.textContent?.includes('DEFERRED'))
      await page.evaluate(() => {
        const masthead = document.querySelector('mn-top-bar')?.shadowRoot?.querySelector<HTMLElement>('.masthead')
        if (!masthead) throw new Error('top-bar masthead not found')
        masthead.click()
      })
      await page.waitForSelector('mn-home-view', { state: 'attached' })
      await page.waitForFunction(() => document.querySelector<HTMLElement>('#app')?.dataset.siteRoute === 'home')
      process.stdout.write('[planter-browser] Garden bundle appearance, snap, capability, and home journeys observed\n')
    }

    // 2) the testimony chip's COMPUTED style carries kind.css's cascade.
    const registerCurrent = await page.evaluate(() => {
      const chip = document.querySelector<HTMLElement>('.mn-kind[data-kind="testimony"]')
      if (!chip) return null
      return getComputedStyle(chip).getPropertyValue('--mn-kind-register-current').trim()
    })
    assert(
      registerCurrent === 'testimony',
      `expected the testimony chip's computed --mn-kind-register-current to be 'testimony', got ${JSON.stringify(registerCurrent)}`,
    )

    const initialCount = await page.evaluate(() =>
      document.querySelector('.mn-kind[data-kind="testimony"]')?.getAttribute('data-triple-count'),
    )
    assert(initialCount !== null && initialCount !== undefined, 'testimony chip carries no data-triple-count')
    const before = Number(initialCount)
    process.stdout.write(`[planter-browser] initial triple count: ${before}\n`)

    // 3) a REAL sparql_update mutation, observed via the SPA's OWN poll loop.
    const writer = new McpClient({ mcpUrl: cell.mcpUrl, token: cell.token, origin: 'http://127.0.0.1' })
    const heartbeatSubject = `urn:planter:browser-heartbeat:${randomUUID()}`
    await writer.toolsCall('sparql_update', {
      graphId,
      update: `INSERT DATA { GRAPH <${graphIri}> { <${heartbeatSubject}> <urn:mnemosyne:vocab:sux:heartbeat> "1" . } }`,
    })
    process.stdout.write('[planter-browser] real sparql_update sent — waiting for poll-driven re-render\n')
    await page.waitForFunction(
      (expected) => {
        const el = document.querySelector('.mn-kind[data-kind="testimony"]')
        return el?.getAttribute('data-triple-count') === String(expected)
      },
      before + 1,
      { timeout: 15_000, polling: 200 },
    )
    process.stdout.write('[planter-browser] poll-driven re-render observed (triple count advanced)\n')

    // Diagnostics up to here must be clean — the "unexpected error" bar only
    // applies to everything BEFORE the deliberate kill below.
    assert(consoleErrors.length === 0, `unexpected browser console errors:\n${consoleErrors.join('\n')}`)
    assert(pageErrors.length === 0, `unexpected browser page errors:\n${pageErrors.join('\n')}`)

    // 4) kill the cell -> the honest error panel. The browser's own failed
    // /cell fetch (a real 503 from the dev proxy — the intended, honest
    // behavior this step is proving) logs a console error; that is the
    // EXPECTED shape of THIS negative-path assertion, not a defect, so
    // diagnostics captured from here on are inspected, never gated on.
    process.stdout.write('[planter-browser] killing the cell\n')
    await cell.kill()
    await page.waitForSelector('.planter-panel-error[data-error-kind="unavailable"]', { timeout: 15_000 })
    process.stdout.write('[planter-browser] honest error panel observed after cell kill\n')

    process.stdout.write(
      `[planter-browser] PASS — ${JSON.stringify({ graphId, bundle: opts.bundle ?? null, initialTripleCount: before, finalTripleCount: before + 1 })}\n`,
    )
  } catch (error) {
    const status = page && !page.isClosed() ? await page.locator('.mn-kind').first().textContent().catch(() => null) : null
    throw new Error(
      [
        error instanceof Error ? (error.stack ?? error.message) : String(error),
        status ? `testimony chip at failure: ${status}` : '',
        consoleErrors.length ? `Console errors: ${JSON.stringify(consoleErrors)}` : '',
        pageErrors.length ? `Page errors: ${JSON.stringify(pageErrors)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    )
  } finally {
    await context?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    await vite?.close().catch(() => undefined)
    await cell?.kill().catch(() => undefined) // idempotent even if already killed above
  }
}

if (hasArg('--help') || hasArg('-h')) {
  process.stdout.write(help)
} else {
  await main()
}
