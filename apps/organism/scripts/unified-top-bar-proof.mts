/**
 * Visual + geometric proof for the unified Sophia top bar (2026-09-23):
 * Garden, Choreograph (the in-organism app AND the standalone /choreograph
 * route) and Hoja, each at 1440px and 390px, light and dark, plus the open
 * picker and the header under every skin. Each shot is paired with a check
 * that the bar's controls sit inside the bar (no overflow at 390px) and that
 * the picker lists the same apps in the same order with the current app
 * checked. Writes PNGs + checks.json to UNIFIED_TOP_BAR_OUT.
 *
 *   UNIFIED_TOP_BAR_OUT=/path node --import tsx scripts/unified-top-bar-proof.mts
 *
 * Harness only (fixtures, local servers); touches no hosted service.
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { createServer, type Plugin } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hojaDir = resolve(appDir, '../hoja')
const out = process.env.UNIFIED_TOP_BAR_OUT ?? '/private/tmp/unified-top-bar'
// Local builds open suite apps only per opt-in (features.ts): open both.
process.env.VITE_SHRUBBERY_FEATURES ||= 'hoja-v2,choreograph'

type Theme = 'light' | 'dark'
interface Check {
  shot: string
  bars: number
  rows: string[]
  checked: string[]
  toolbar: string[]
  controls: string[]
  overflow: number
  barHeight: number
}
const checks: Check[] = []

async function frames(page: Page): Promise<void> {
  await page.waitForTimeout(220)
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

/** The one visible Sophia bar (the mobile header's mirror on phones). */
const VISIBLE_BAR = `(() => [...document.querySelectorAll('mn-top-bar'), ...[...document.querySelectorAll('hoja-app')].flatMap(h => [...h.shadowRoot.querySelectorAll('mn-top-bar')])]
  .find(bar => { const r = bar.getBoundingClientRect(); return r.width > 0 && r.height > 0 }))()`

async function setAppearance(page: Page, theme: Theme, skin = 'garden'): Promise<void> {
  await page.evaluate(([t, s]) => {
    for (const el of [document.documentElement, document.body, document.querySelector<HTMLElement>('#harness-root')]) {
      if (!el) continue
      if (s === 'garden') el.removeAttribute('data-skin')
      else el.dataset.skin = s
      el.dataset.theme = t
    }
    const bars = [...document.querySelectorAll('mn-top-bar'),
      ...[...document.querySelectorAll('hoja-app')].flatMap(h => [...h.shadowRoot!.querySelectorAll('mn-top-bar')])]
    for (const bar of bars as (HTMLElement & { activeSkin?: string; isDark?: boolean })[]) {
      bar.activeSkin = s
      bar.isDark = t === 'dark'
    }
  }, [theme, skin] as const)
  await frames(page)
}

async function check(page: Page, shot: string): Promise<Check> {
  const result = await page.evaluate((expr) => {
    const bars = [...document.querySelectorAll('mn-top-bar'),
      ...[...document.querySelectorAll('hoja-app')].flatMap(h => [...h.shadowRoot!.querySelectorAll('mn-top-bar')])]
    // biome-ignore lint/security/noGlobalEval: an operator proof evaluates its own selector expression inside the page
    const bar = (0, eval)(expr) as HTMLElement | undefined
    if (!bar) return { bars: bars.length, rows: [], checked: [], toolbar: [], controls: [], overflow: -1, barHeight: 0 }
    const root = bar.shadowRoot!
    const box = bar.getBoundingClientRect()
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const parts = [...root.querySelectorAll<HTMLElement>('.app-picker, .app-toolbar button, .actions > *')]
      .filter(visible)
    const slotted = [...bar.children].filter(visible)
    const overflow = [...parts, ...slotted]
      .map(el => el.getBoundingClientRect())
      .filter(r => r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.right > window.innerWidth + 0.5).length
    return {
      bars: bars.length,
      rows: [...root.querySelectorAll<HTMLElement>('.app-switcher-btn')].map(r => r.dataset.appId ?? ''),
      checked: [...root.querySelectorAll<HTMLElement>('.app-switcher-btn[aria-checked="true"]')].map(r => r.dataset.appId ?? ''),
      toolbar: [...root.querySelectorAll<HTMLElement>('.app-toolbar button')].map(b => b.dataset.appAction ?? ''),
      controls: [...root.querySelectorAll<HTMLElement>('.actions > .action-btn')].filter(visible).map(b => b.dataset.action ?? b.className),
      overflow,
      barHeight: Math.round(box.height),
    }
  }, VISIBLE_BAR)
  const entry = { shot, ...result }
  checks.push(entry)
  if (entry.overflow !== 0) throw new Error(`${shot}: bar controls overflow (${entry.overflow})`)
  return entry
}

async function shoot(page: Page, name: string, width: number, withLauncher = true): Promise<void> {
  await page.screenshot({ path: `${out}/${name}.png` })
  await page.screenshot({ path: `${out}/${name}-bar.png`, clip: { x: 0, y: 0, width, height: width > 600 ? 64 : 84 } })
  await check(page, name)
  if (!withLauncher) return
  await page.evaluate((expr) => {
    // biome-ignore lint/security/noGlobalEval: an operator proof evaluates its own selector expression inside the page
    const bar = (0, eval)(expr) as HTMLElement
    bar.shadowRoot!.querySelector<HTMLButtonElement>('.app-picker')!.click()
  }, VISIBLE_BAR)
  await frames(page)
  await page.screenshot({ path: `${out}/${name}-picker.png`, clip: { x: 0, y: 0, width: Math.min(width, 760), height: 360 } })
  await page.keyboard.press('Escape')
  await frames(page)
}

async function harness(page: Page, port: number, app: 'garden' | 'choreograph'): Promise<void> {
  await page.goto(`http://127.0.0.1:${port}/browser-harness.html${app === 'choreograph' ? '?app=choreograph' : ''}`, { waitUntil: 'commit' })
  await page.waitForFunction(() => {
    const s = (window as unknown as { __organism?: { state: { ready?: boolean; error?: string | null } } }).__organism?.state
    return s?.ready === true || Boolean(s?.error)
  }, undefined, { timeout: 90_000 })
  await frames(page)
}

class HojaSeeds {
  private readonly seeds = [
    { id: 'first-light', title: 'First light', markdown: '# First light\n\nA small thought about the morning.', modified_ms: Date.now() },
    { id: 'field-notes', title: 'Field notes', markdown: '# Field notes\n\nThe best ideas begin as fragments.', modified_ms: Date.now() - 86_400_000 },
  ]
  plugin(): Plugin {
    return {
      name: 'unified-top-bar-hoja-seeds',
      configureServer: server => {
        server.middlewares.use('/api/seeds', (req, res) => {
          const id = decodeURIComponent((req.url ?? '/').replace(/^\//, '').split('?')[0] ?? '')
          res.setHeader('content-type', 'application/json')
          if (!id) {
            res.end(JSON.stringify({ seeds: this.seeds.map(({ markdown, ...rest }) => ({ ...rest, snippet: markdown.split('\n').at(-1) })) }))
            return
          }
          const seed = this.seeds.find(item => item.id === id)
          res.end(JSON.stringify(seed ? { id: seed.id, title: seed.title, markdown: seed.markdown } : { error: 'missing' }))
        })
      },
    }
  }
}

const organism = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, hmr: false },
  logLevel: 'warn',
})
await organism.listen()
const organismAddress = organism.httpServer?.address()
const port = typeof organismAddress === 'object' && organismAddress ? organismAddress.port : 0
const hoja = await createServer({
  root: hojaDir,
  configFile: false,
  plugins: [new HojaSeeds().plugin()],
  server: { host: '127.0.0.1', port: 0, hmr: false },
  logLevel: 'warn',
})
await hoja.listen()
const hojaAddress = hoja.httpServer?.address()
const hojaPort = typeof hojaAddress === 'object' && hojaAddress ? hojaAddress.port : 0

const browser = await chromium.launch({ headless: true })
try {
  await mkdir(out, { recursive: true })
  for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    const size = width > 600 ? 'desktop' : '390'
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
    await page.addInitScript('globalThis.__name = (f) => f')

    // Garden and Choreograph inside the organism (the deterministic harness).
    for (const app of ['garden', 'choreograph'] as const) {
      await harness(page, port, app)
      for (const theme of ['light', 'dark'] as const) {
        await setAppearance(page, theme)
        await shoot(page, `${app}-${size}-${theme}`, width)
      }
    }

    // The standalone /choreograph route (production entry, local playground).
    await page.goto(`http://127.0.0.1:${port}/choreograph?graph=browser-harness`, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-organism-route="choreograph"] mn-top-bar').waitFor({ state: 'attached', timeout: 90_000 })
    await frames(page)
    for (const theme of ['light', 'dark'] as const) {
      await setAppearance(page, theme)
      await shoot(page, `choreograph-route-${size}-${theme}`, width)
    }

    // Hoja, standalone, over its own Soil-shaped seed API.
    await page.goto(`http://127.0.0.1:${hojaPort}/`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /First light/ }).first().waitFor({ timeout: 60_000 })
    await frames(page)
    for (const theme of ['light', 'dark'] as const) {
      // Hoja owns its theme: drive it through the shared bar's own button.
      const dark = await page.evaluate(() => document.documentElement.dataset.theme === 'dark')
      if (dark !== (theme === 'dark')) {
        await page.evaluate((expr) => {
          // biome-ignore lint/security/noGlobalEval: an operator proof evaluates its own selector expression inside the page
          ((0, eval)(expr) as HTMLElement).shadowRoot!.querySelector<HTMLButtonElement>('[data-action="theme"]')!.click()
        }, VISIBLE_BAR)
        await frames(page)
      }
      await shoot(page, `hoja-${size}-${theme}`, width)
    }
    await page.close()
  }

  // Every skin, one header each (Garden desktop, launcher open).
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  await page.addInitScript('globalThis.__name = (f) => f')
  await harness(page, port, 'choreograph')
  for (const skin of ['garden', 'mithras', '98', 'glass', 'emporium'] as const) {
    await setAppearance(page, 'light', skin)
    await shoot(page, `skin-${skin}-choreograph`, 1440)
  }
  await setAppearance(page, 'dark', 'glass')
  await shoot(page, 'skin-glass-dark-choreograph', 1440)
  await page.close()

  await writeFile(`${out}/checks.json`, JSON.stringify(checks, null, 2))
  console.log(`unified top bar proof: ${checks.length} shots, 0 overflow → ${out}`)
} finally {
  await browser.close()
  await organism.close()
  await hoja.close()
}
