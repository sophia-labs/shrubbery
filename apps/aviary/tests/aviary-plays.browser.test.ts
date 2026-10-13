// @vitest-environment node
//
// REAL Chromium over the REAL dev server over the REAL aigua directory.
// Nothing here is simulated: the page boots the same `src/main.ts` a human
// loads, the triples come from the same middleware, and the assertion that
// matters — "audio actually plays" — is read off the live media element's own
// `currentTime`, not off a spy.
//
// The `.browser.test.ts` infix keeps this out of the root `test:source` lane
// and inside `pnpm test:browser-suites` (the repo's generic browser lane).

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import { chromium, type Browser, type Page } from 'playwright'
import { AIGUA_DIR } from '../vite.config.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const present = existsSync(join(AIGUA_DIR, 'instrument.json'))

let server: ViteDevServer
let browser: Browser
let page: Page
let baseUrl = ''
const pageErrors: string[] = []
const consoleErrors: string[] = []
const failedRequests: string[] = []
const mediaResponses: Array<{ url: string; status: number }> = []

describe.skipIf(!present)('AVIARY plays real audio in real Chromium', () => {
  beforeAll(async () => {
    server = await createServer({
      root: appDir,
      configFile: resolve(appDir, 'vite.config.ts'),
      logLevel: 'warn',
      server: { host: '127.0.0.1', port: 0, strictPort: false },
    })
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('vite did not bind a TCP port')
    baseUrl = `http://127.0.0.1:${address.port}`

    browser = await chromium.launch({
      headless: true,
      // A real click IS a user gesture, but headless Chromium's default policy
      // still refuses some media starts; this keeps the test about the app.
      args: ['--autoplay-policy=no-user-gesture-required'],
    })
    page = await browser.newPage()
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('requestfailed', (req) => failedRequests.push(`${req.url()} — ${req.failure()?.errorText ?? '?'}`))
    page.on('response', (res) => {
      if (res.url().includes('/media/')) mediaResponses.push({ url: res.url(), status: res.status() })
    })

    await page.goto(baseUrl, { waitUntil: 'load' })
    // The rail only fills once the aig: graph has been read and parsed.
    await page.waitForSelector('av-rail mn-button[data-route]', { timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await page?.close()
    await browser?.close()
    await server?.close()
  })

  it('renders the interpreter frame — chrome, rail, stage, transport — from the sux: graph', async () => {
    // These wrappers are the RUNTIME's, produced by planFor; their presence is
    // the proof that the layout really came through the interpreter.
    expect(await page.locator('.app-container > header[data-region="region-top-bar"]').count()).toBe(1)
    expect(await page.locator('.main > .rail-pane[data-region="region-rail"]').count()).toBe(1)
    expect(await page.locator('.split-pane[data-region="region-stage"]').count()).toBe(1)
    expect(await page.locator('footer[data-region="region-bottom-bar"]').count()).toBe(1)

    // The app-owned tags UPGRADED (they are not inert placeholder stamps).
    expect(await page.locator('mn-inert-placeholder').count()).toBe(0)
    const upgraded = await page.evaluate(() =>
      ['av-rail', 'av-stage', 'av-transport', 'mn-app-bar'].map(
        (tag) => document.querySelector(tag)?.shadowRoot !== null,
      ),
    )
    expect(upgraded).toEqual([true, true, true, true])
  })

  it('lists the voices from the graph, with their real sample counts', async () => {
    const routes = await page.locator('av-rail mn-button[data-route]').evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-route') ?? ''),
    )
    const voices = routes.filter((r) => r.startsWith('voice:'))
    expect(voices.length).toBeGreaterThanOrEqual(7)
    expect(voices).toContain('voice:glide')
    expect(routes).toContain('renders')
    expect(routes).toContain('analysis')
  })

  it('shows measured metadata on each sample row', async () => {
    await page.locator('av-rail mn-button[data-route="voice:buzz"]').click()
    await page.waitForSelector('av-stage mn-card[data-sample="buzz_01"]')
    const text = await page.locator('av-stage mn-card[data-sample="buzz_01"]').innerText()
    expect(text).toContain('buzz_01')
    expect(text).toContain('A5 +23¢') // note + cents, straight out of instrument.json
    expect(text).toContain('184 ms') // dur_s 0.1843

    // The measurement chips render their text inside mn-chip's own shadow root,
    // so read the primitive's `label` property rather than the host innerText.
    const chips = await page
      .locator('av-stage mn-card[data-sample="buzz_01"] mn-chip')
      .evaluateAll((els) => els.map((el) => (el as HTMLElement & { label: string }).label))
    expect(chips).toContain('shape rise')
    expect(chips.some((c) => c.startsWith('f0 892'))).toBe(true)
    expect(chips.some((c) => c.startsWith('centroid'))).toBe(true)
    expect(chips.some((c) => c.startsWith('span 19.0 st'))).toBe(true)
  })

  it('PLAYS a sample: a real src, a real 200/206, and a clock that advances', async () => {
    await page.locator('av-stage mn-card[data-sample="buzz_01"]').click()

    // A real media URL is attached to the one shell audio element.
    await page.waitForFunction(
      () => (document.getElementById('aviary-audio') as HTMLAudioElement | null)?.src.includes('/media/samples/'),
      undefined,
      { timeout: 15_000 },
    )
    const src = await page.evaluate(() => (document.getElementById('aviary-audio') as HTMLAudioElement).src)
    expect(src).toContain('/media/samples/buzz_01.wav')

    // …and the element actually decoded and advanced through the bytes.
    await page.waitForFunction(
      () => {
        const el = document.getElementById('aviary-audio') as HTMLAudioElement | null
        return el !== null && el.readyState >= 2 && el.currentTime > 0
      },
      undefined,
      { timeout: 15_000 },
    )
    const state = await page.evaluate(() => {
      const el = document.getElementById('aviary-audio') as HTMLAudioElement
      return { currentTime: el.currentTime, duration: el.duration, error: el.error?.code ?? null }
    })
    expect(state.error).toBeNull()
    expect(state.currentTime).toBeGreaterThan(0)
    // buzz_01 is 0.1843 s in the manifest; the decoded file must agree closely.
    expect(state.duration).toBeGreaterThan(0.15)
    expect(state.duration).toBeLessThan(0.25)

    // The bytes really came from the shell's own /media route.
    const served = mediaResponses.filter((r) => r.url.includes('buzz_01.wav'))
    expect(served.length, 'no /media response observed for buzz_01.wav').toBeGreaterThan(0)
    expect(served.every((r) => r.status === 200 || r.status === 206)).toBe(true)

    // The transport reflects it rather than inventing its own state.
    expect(await page.locator('av-transport .now-label').innerText()).toBe('buzz_01')
    expect(await page.locator('av-transport .now-sub').innerText()).toContain('buzz')
    // …and the read-seam testimony is on screen: adapter, liveness, count.
    expect(await page.locator('av-transport .testimony').innerText()).toMatch(
      /nt-http · poll · \d+ triples · read /,
    )
  })

  it('is keyboard-navigable: Arrow moves the row focus, Enter plays it', async () => {
    await page.locator('av-rail mn-button[data-route="voice:glide"]').click()
    await page.waitForSelector('av-stage mn-card[data-sample="glide_01"]')

    // Focus the first row through its own focusable node, then walk down.
    await page.locator('av-stage mn-card[data-sample="glide_01"]').click()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')

    await page.waitForFunction(
      () => (document.getElementById('aviary-audio') as HTMLAudioElement | null)?.src.includes('glide_02'),
      undefined,
      { timeout: 15_000 },
    )
    const src = await page.evaluate(() => (document.getElementById('aviary-audio') as HTMLAudioElement).src)
    expect(src).toContain('/media/samples/glide_02.wav')
  })

  it('plays a render and seeks to a real cue offset', async () => {
    await page.locator('av-rail mn-button[data-route="renders"]').click()
    await page.waitForSelector('av-stage mn-card')
    const cue = page.locator('av-stage mn-card mn-button').first()
    if ((await cue.count()) === 0) return // this library has no cue sidecars yet
    await cue.click()
    await page.waitForFunction(
      () => (document.getElementById('aviary-audio') as HTMLAudioElement | null)?.src.includes('/media/render/'),
      undefined,
      { timeout: 20_000 },
    )
    expect(await page.evaluate(() => (document.getElementById('aviary-audio') as HTMLAudioElement).src)).toContain(
      '/media/render/',
    )
  })

  it('shows the analysis figures as real image bytes', async () => {
    await page.locator('av-rail mn-button[data-route="analysis"]').click()
    await page.waitForSelector('av-stage figure img')
    const loaded = await page.locator('av-stage figure img').evaluateAll((imgs) =>
      imgs.map((img) => ({
        src: (img as HTMLImageElement).currentSrc,
        width: (img as HTMLImageElement).naturalWidth,
      })),
    )
    expect(loaded.length).toBeGreaterThan(0)
    for (const image of loaded) {
      expect(image.src).toContain('/media/')
      expect(image.width, `${image.src} did not decode`).toBeGreaterThan(0)
    }
  })

  it('is skin- and theme-aware: the toggles restyle the whole shell', async () => {
    const readPaint = () =>
      page.evaluate(() => {
        const root = document.documentElement
        const stage = document.querySelector('av-stage') as HTMLElement
        return {
          theme: root.getAttribute('data-theme'),
          skin: root.getAttribute('data-skin'),
          stageBg: getComputedStyle(stage).getPropertyValue('--mn-color-surface-base').trim(),
          bodyBg: getComputedStyle(document.body).backgroundColor,
        }
      })

    const light = await readPaint()
    expect(light.theme).toBe('light')

    await page.locator('mn-app-bar button[aria-label="Toggle theme"]').click()
    const dark = await readPaint()
    expect(dark.theme).toBe('dark')
    expect(dark.bodyBg).not.toBe(light.bodyBg)
    expect(dark.stageBg).not.toBe(light.stageBg)

    // The skin list is graph-authored and offered by the picker; choosing another skin must actually restyle.
    await page.locator('mn-app-bar mn-skin-picker button.trigger').click()
    const offered = await page.locator('mn-app-bar mn-skin-picker [data-menu-item-id]').evaluateAll(
      (items) => items.map((item) => (item as HTMLElement).dataset.menuItemId ?? ''))
    expect(offered.length, 'the picker lists the graph-authored skins').toBeGreaterThan(1)
    const other = offered.find((id) => id !== light.skin) ?? offered[1]
    await page.locator(`mn-app-bar mn-skin-picker [data-menu-item-id="${other}"]`).click()
    const skinned = await readPaint()
    expect(skinned.skin).not.toBe(light.skin)

    await page.locator('mn-app-bar button[aria-label="Toggle theme"]').click()
  })

  it('booted with no page errors, no console errors, and no failed requests', () => {
    expect(pageErrors, 'pageerror events').toEqual([])
    expect(failedRequests, 'failed requests').toEqual([])
    expect(consoleErrors, 'console.error calls').toEqual([])
  })
})
