/**
 * production-mpa-smoke.browser.test.ts — grid-laneb hosted-dashboard review (commit
 * 5e34694) SUSPECT finding 8: neither new test the commit's own log claimed
 * ("typecheck clean; pnpm --filter organism build emits dist/observatory.html")
 * actually builds the production bundle and loads it. `app-shell-assets.test.ts`
 * only starts a DEV server (`vite`'s `createServer`); nothing previously built
 * BOTH multi-page entries (`index.html` + `observatory.html`, `vite.config.ts`'s
 * own `rollupOptions.input`) through Rollup's real shared-chunk extraction and
 * then actually LOADED them.
 *
 * This test does both, for real:
 *   1. A REAL `vite build()` (the exact `vite.config.ts` this app ships) to a
 *      scratch `outDir` — never the tracked `dist/`.
 *   2. A REAL `vite preview()` static server over that `outDir`.
 *   3. A REAL Chromium page (Playwright, already a devDependency — the same
 *      engine every `scripts/*-browser-harness.mts` proof in this app uses)
 *      loads EACH built HTML entry and fails on any uncaught page error,
 *      console error, or failed asset/module request — the exact failure
 *      mode a broken shared chunk or an entry-specific runtime bug produces
 *      AFTER minification, which `tsc --noEmit` and a dev-server fetch can't
 *      catch (dev serves untransformed ESM straight from source; only a real
 *      build exercises Rollup's chunk graph). The `.browser.test.ts` suffix
 *      keeps this proof in CI's browser lane rather than its source lane.
 *
 * No live backend is reached: this repo has no `.env`/`VITE_GATEWAY_BASE_URL`
 * checked in, so `index.html` boots against the bundled `GARDEN_DEFAULT`
 * literal (the `#source-select`'s own default), no `/cell` fetch.
 *
 * `observatory.html` is now the RETIRED standalone page: a tiny STATIC
 * redirect to `/?graph=observatory` (the Observatory renders inside the normal
 * Organism workspace when a graph's :ux:config declares a dashboard center —
 * see seeds/observatory-workspace.ux.nt). This test asserts the redirect
 * genuinely lands on the main entry with the `?graph=` param preserved, so old
 * links keep working off a REAL production build.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build, preview, type PreviewServer } from 'vite'
import { chromium, type Browser } from 'playwright'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The REAL committed Observatory seed (bundle audit finding 13 proof below) —
// the same file `observatory-workspace-seed.test.ts` parses through the same
// production path, and the exact config the live cluster verification in
// `06-observatory-app-dimension-defect.md` read back: zero `appRootRegions`.
const OBSERVATORY_SEED_NT = readFileSync(
  resolve(appDir, 'seeds/observatory-workspace.ux.nt'),
  'utf-8',
)

describe('production MPA build — both Vite entries load cleanly off a real build', () => {
  let outDir: string
  let server: PreviewServer
  let browser: Browser
  let baseUrl: string

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'organism-mpa-build-'))

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
      preview: { host: '127.0.0.1', port: 0 },
    })
    const address = server.httpServer.address()
    if (!address || typeof address === 'string') throw new Error('vite preview did not bind a TCP port')
    baseUrl = `http://127.0.0.1:${address.port}`

    browser = await chromium.launch({ headless: true })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
    if (outDir) rmSync(outDir, { recursive: true, force: true })
  })

  it.each([
    ['/index.html', 'the main app entry'],
  ])('%s (%s) loads with no page errors, no console errors, and no failed asset/module requests', async (path) => {
    const page = await browser.newPage()
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('requestfailed', (request) => {
      failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'unknown failure'}`)
    })

    let response
    try {
      response = await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle', timeout: 30_000 })
    } finally {
      await page.close()
    }

    expect(response?.ok(), `HTTP response for ${path}`).toBe(true)
    expect(pageErrors, `pageerror events on ${path}`).toEqual([])
    expect(failedRequests, `failed asset/module requests on ${path}`).toEqual([])
    expect(consoleErrors, `console.error calls on ${path}`).toEqual([])
  }, 30_000)

  it('/observatory.html (the retired standalone page) redirects to the main entry, preserving ?graph=', async () => {
    const page = await browser.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    try {
      const response = await page.goto(`${baseUrl}/observatory.html?graph=alt-cell`, {
        waitUntil: 'networkidle',
        timeout: 30_000,
      })
      expect(response?.ok(), 'HTTP response for /observatory.html').toBe(true)
      // The client-side redirect must land on the ROOT entry with the graph
      // param carried over — this is what keeps every old dashboard link alive.
      await page.waitForURL(`${baseUrl}/?graph=alt-cell`, { timeout: 10_000 })
      expect(pageErrors, 'pageerror events across the redirect').toEqual([])
    } finally {
      await page.close()
    }
  }, 30_000)

  it('/observatory.html without params defaults the redirect to ?graph=observatory', async () => {
    const page = await browser.newPage()
    try {
      await page.goto(`${baseUrl}/observatory.html`, { waitUntil: 'networkidle', timeout: 30_000 })
      await page.waitForURL(`${baseUrl}/?graph=observatory`, { timeout: 10_000 })
    } finally {
      await page.close()
    }
  }, 30_000)

  // Bundle audit finding 13 (2026-07-31): Slice 10 built config-derived app
  // tabs + real `currentApp` shell state but left the legacy hidden
  // `#app-select` harness control in place as a second writer. Resolved by
  // retiring it outright (see `currentApp`'s doc comment, main.ts). This is
  // the real, no-mock, end-to-end proof: a real production build, a real
  // Chromium page, real clicks on the real `mn-top-bar`, and — for the
  // confess-absence half — a real "stale `currentApp`" scenario
  // (`06-observatory-app-dimension-defect.md` D2b's own example) produced
  // entirely through legitimate UI, reparsing into the REAL committed
  // Observatory seed while `currentApp` is still `'choreograph'` from a prior
  // real click. No test hook, no synthetic state injection.
  it('finding 13 — #app-select is retired; the real app-switcher drives a declared app AND confesses absence for a stale one', async () => {
    const page = await browser.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    try {
      await page.goto(`${baseUrl}/index.html?debug=1`, { waitUntil: 'networkidle', timeout: 30_000 })

      // Retirement proof — the legacy debug control is gone from the DOM
      // entirely, not merely demoted to a second writer. Must FAIL against
      // the pre-fix code, where the element is present (hidden, not absent).
      expect(await page.locator('#app-select').count(), '#app-select must not exist').toBe(0)

      // The bundled default (GARDEN_DEFAULT) DOES declare
      // appRootRegions.choreograph — a real click on the real, config-derived
      // tab (Playwright's locators pierce mn-top-bar's shadow root) switches
      // the live app with #app-select gone from the wiring entirely.
      const choreoTab = page.getByRole('tab', { name: 'Choreograph app' })
      expect(await choreoTab.count(), 'Choreograph tab offered by GARDEN_DEFAULT').toBe(1)
      await choreoTab.click()
      await page.locator('wf-studio-shell').waitFor({ state: 'attached', timeout: 10_000 })
      expect(await choreoTab.getAttribute('aria-selected')).toBe('true')

      // Reparse into the REAL committed Observatory seed — which declares NO
      // choreograph branch — while currentApp is still 'choreograph' from the
      // click above: the exact "stale currentApp in the shell" case D2b names
      // as the reason the render-host guard exists above and beyond the
      // switcher only ever offering declared apps.
      await page.selectOption('#source-select', 'SEED_NT')
      await page.fill('#seed-editor', OBSERVATORY_SEED_NT)
      await page.click('#reparse-btn')

      // Confess-absence — never the default spine.
      const absent = page.locator('[data-workspace-renderer="app-absent"]')
      await absent.waitFor({ state: 'attached', timeout: 10_000 })
      expect(await absent.count()).toBe(1)
      expect(await absent.getAttribute('data-missing-app')).toBe('choreograph')
      expect(await page.locator('mn-empty-state .title').textContent()).toContain('choreograph')
      expect(await page.locator('mn-empty-state .description').textContent()).toContain('choreograph')
      expect(await page.locator('wf-studio-shell').count()).toBe(0)

      // The switcher itself is honest too — it now offers exactly the one app
      // this config actually declares (config-derived, never a hardcoded
      // pair), and using it recovers a real render.
      expect(await page.getByRole('tab', { name: 'Choreograph app' }).count()).toBe(0)
      const gardenTab = page.getByRole('tab', { name: 'Garden app' })
      expect(await gardenTab.count()).toBe(1)
      await gardenTab.click()
      await absent.waitFor({ state: 'detached', timeout: 10_000 })
      expect(await absent.count()).toBe(0)

      expect(pageErrors, 'pageerror events across the whole scenario').toEqual([])
    } finally {
      await page.close()
    }
  }, 30_000)
})
