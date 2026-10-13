/**
 * Visual proof for the Mithras skin: Garden (home, a document, the app picker,
 * floating menu + toast, Settings → Appearance) wearing Mithras Flow's tokens,
 * next to Flow's OWN UI (the real vendored Flow app through apps/flow's island
 * harness — the same build shape mithras.local serves, no GT fonts shipped).
 * Also proves the light-only pin (data-theme=dark requested → still light),
 * reduced-transparency and more-contrast, and writes the resolved colours and
 * their WCAG ratios, measured from the live cascade, to contrast.json.
 *
 *   MITHRAS_SKIN_OUT=/path node --import tsx scripts/mithras-skin-proof.mts
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const flowDir = resolve(appDir, '../flow')
const out = process.env.MITHRAS_SKIN_OUT ?? '/private/tmp/mithras-skin'

async function frames(page: Page): Promise<void> {
  await page.waitForTimeout(260)
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

async function setSkin(page: Page, skin: string | null, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(([s, t]) => {
    for (const el of [document.documentElement, document.body, document.querySelector<HTMLElement>('#harness-root'), document.querySelector<HTMLElement>('#settings-harness-root')]) {
      if (!el) continue
      if (s) el.dataset.skin = s
      else el.removeAttribute('data-skin')
      el.dataset.theme = t
    }
    for (const bar of document.querySelectorAll<HTMLElement & { activeSkin?: string; isDark?: boolean }>('mn-top-bar, mn-app-bar')) {
      bar.activeSkin = s ?? 'garden'
      bar.isDark = t === 'dark' && s !== 'mithras'
    }
  }, [skin, theme] as const)
  await frames(page)
}

async function openOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    let menu = document.querySelector('mn-context-menu') as (HTMLElement & {
      items: unknown[]; show(p: { x: number; y: number }, a?: string): void
    }) | null
    if (!menu) {
      menu = document.createElement('mn-context-menu') as NonNullable<typeof menu>
      document.body.append(menu)
    }
    menu.items = [
      { type: 'header', content: 'Document' },
      { id: 'rename', label: 'Rename…', icon: 'pencil', shortcut: 'F2' },
      { id: 'dup', label: 'Duplicate', icon: 'copy' },
      { id: 'move', label: 'Move to folder…', icon: 'folder' },
      { type: 'divider' },
      { id: 'export', label: 'Export', icon: 'download', shortcut: '⌘E' },
      { id: 'delete', label: 'Delete', icon: 'trash', variant: 'danger' },
    ]
    const editor = document.querySelector('sh-editor-host')?.getBoundingClientRect()
    menu.show({ x: (editor?.left ?? 400) + 140, y: (editor?.top ?? 120) + 110 }, 'top-left')
    const toast = document.createElement('mn-toast') as unknown as HTMLElement & Record<string, unknown> & { show(): void }
    toast.type = 'success'
    toast.position = 'bottom-right'
    toast.message = 'Saved to the garden'
    toast.description = 'architecture · synced just now'
    toast.duration = 0
    toast.autoShow = false
    toast.closable = true
    toast.id = 'proof-toast'
    document.body.append(toast)
    toast.show()
  })
  await frames(page)
}

async function closeOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    const menu = document.querySelector('mn-context-menu') as HTMLElement & { hide?: () => void; open: boolean }
    menu.hide?.(); menu.open = false
    document.getElementById('proof-toast')?.remove()
  })
  await frames(page)
}

// ── Contrast, measured from the live cascade ────────────────────────────────

const TEXT = ['text-primary', 'text-secondary', 'text-tertiary', 'text-muted', 'text-quiet', 'text-accent', 'text-link', 'text-danger', 'text-warning', 'text-success']
const SURFACES = ['surface-base', 'surface-editor', 'surface-panel', 'surface-subtle', 'surface-sunken', 'surface-accent', 'surface-accent-strong', 'material-popover-bg']
const PAIRS: Array<[string, string]> = [
  ['top-bar-text', 'top-bar-bg'], ['top-bar-text-muted', 'top-bar-bg'],
  ['bottom-bar-text', 'bottom-bar-bg'], ['bottom-bar-text-muted', 'bottom-bar-bg'],
  ['color-text-on-accent', 'color-accent'], ['color-text-on-accent', 'color-accent-hover'],
  ['color-on-danger', 'color-action-danger'], ['color-text-danger', 'color-danger-surface'],
]

async function resolvedColours(page: Page): Promise<Record<string, string>> {
  const names = [
    ...TEXT.map(n => `color-${n}`),
    ...SURFACES.map(n => n.startsWith('material') ? n : `color-${n}`),
    ...PAIRS.flat(),
  ]
  return page.evaluate((list) => {
    const probe = document.createElement('div')
    document.body.append(probe)
    const outMap: Record<string, string> = {}
    for (const n of list) {
      probe.style.backgroundColor = `var(--mn-${n})`
      outMap[n] = getComputedStyle(probe).backgroundColor
    }
    probe.remove()
    return outMap
  }, [...new Set(names)])
}

type Rgba = [number, number, number, number]
function parse(css: string): Rgba {
  let m = css.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]
  m = css.match(/color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)/)
  if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] === undefined ? 1 : Number(m[4])]
  throw new Error(`unparsed colour ${css}`)
}
const over = (f: Rgba, b: Rgba): Rgba => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3])).concat(1) as Rgba
function lum([r, g, b]: Rgba): number {
  const l = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b)
}
function ratio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}
function contrastTable(c: Record<string, string>) {
  const paper: Rgba = [255, 255, 255, 1]
  const solid = (n: string) => over(parse(c[n]), paper)
  const rows: Array<{ fg: string; bg: string; ratio: number; aa: boolean }> = []
  for (const t of TEXT) for (const s of SURFACES) {
    const bg = s.startsWith('material') ? s : `color-${s}`
    const r = ratio(solid(`color-${t}`), solid(bg))
    rows.push({ fg: `color-${t}`, bg, ratio: r, aa: r >= 4.5 })
  }
  for (const [fg, bg] of PAIRS) {
    const r = ratio(solid(fg), solid(bg))
    rows.push({ fg, bg, ratio: r, aa: r >= 4.5 })
  }
  return rows
}

// ─────────────────────────────────────────────────────────────────────────────

async function serve(root: string): Promise<{ server: ViteDevServer; port: number }> {
  const server = await createServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, hmr: false },
    logLevel: 'warn',
  })
  await server.listen()
  const address = server.httpServer?.address()
  return { server, port: typeof address === 'object' && address ? address.port : 0 }
}

const garden = await serve(appDir)
const flow = await serve(flowDir)
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const cdp = await page.context().newCDPSession(page)
await page.addInitScript('globalThis.__name = (f) => f')
const report: Record<string, unknown> = {}
try {
  await mkdir(out, { recursive: true })

  // ── Flow's own UI (the real vendored app, as mithras.local builds it) ──
  await page.goto(`http://127.0.0.1:${flow.port}/flow-harness.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.flowHarnessReady === 'true' || Boolean(document.body.dataset.flowHarnessError), undefined, { timeout: 60_000 })
  await page.waitForFunction(() => Boolean(document.querySelector('sh-flow-page .db-pill')?.textContent?.includes('saved locally')), undefined, { timeout: 60_000 })
  const addSystem = page.locator('sh-flow-page .toolbar button', { hasText: '+ system' })
  for (let i = 0; i < 3; i++) {
    await addSystem.click()
    await frames(page)
  }
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${out}/flow-light.png` })
  await page.screenshot({ path: `${out}/flow-light-toolbar.png`, clip: { x: 0, y: 0, width: 1440, height: 96 } })
  report.flowToolbarFont = await page.evaluate(() => {
    const t = document.querySelector('sh-flow-page .toolbar')
    return t ? getComputedStyle(t).fontFamily : null
  })

  // ── Garden in the Mithras skin ──
  await page.goto(`http://127.0.0.1:${garden.port}/browser-harness.html`, { waitUntil: 'commit' })
  await page.waitForFunction(() => {
    const s = (window as unknown as { __organism?: { state: { ready?: boolean; error?: string | null } } }).__organism?.state
    return s?.ready === true || Boolean(s?.error)
  }, undefined, { timeout: 60_000 })
  await setSkin(page, null, 'light')
  await page.screenshot({ path: `${out}/garden-default-skin-home.png` })
  await setSkin(page, 'mithras', 'light')
  await page.screenshot({ path: `${out}/garden-mithras-light-home.png` })
  await page.locator('.app-container mn-home-view [data-document-id="architecture"] button.open').click()
  await page.waitForFunction(() => (window as unknown as { __organism?: { state: { activeDocumentId?: string } } }).__organism?.state.activeDocumentId === 'architecture')
  await setSkin(page, 'mithras', 'light')
  await page.screenshot({ path: `${out}/garden-mithras-light-document.png` })
  await page.screenshot({ path: `${out}/garden-mithras-light-toolbar.png`, clip: { x: 0, y: 0, width: 1440, height: 96 } })
  if (await page.locator('mn-top-bar [data-app-action="home"]').count()) {
    await page.locator('mn-top-bar [data-app-action="home"]').focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await frames(page)
    await page.screenshot({ path: `${out}/garden-mithras-light-toolbar-focus.png`, clip: { x: 0, y: 0, width: 760, height: 64 } })
  }
  await page.locator('mn-top-bar .app-picker').click()
  await frames(page)
  await page.screenshot({ path: `${out}/garden-mithras-light-app-picker.png` })
  await page.keyboard.press('Escape')
  await frames(page)
  await openOverlays(page)
  await page.screenshot({ path: `${out}/garden-mithras-light-overlays.png` })
  const light = await resolvedColours(page)
  report.light = { colours: light, contrast: contrastTable(light) }
  for (const [label, features] of [
    ['reduced-transparency', [{ name: 'prefers-reduced-transparency', value: 'reduce' }]],
    ['more-contrast', [{ name: 'prefers-contrast', value: 'more' }]],
  ] as const) {
    await cdp.send('Emulation.setEmulatedMedia', { features: [...features] })
    await frames(page)
    await page.screenshot({ path: `${out}/garden-mithras-light-overlays-${label}.png` })
    const c = await resolvedColours(page)
    report[label] = { colours: c, contrast: contrastTable(c) }
    await cdp.send('Emulation.setEmulatedMedia', { features: [] })
  }
  await closeOverlays(page)
  // Light-only pin: even a raw data-theme=dark stamp (bypassing the applier)
  // must leave the Mithras roles light.
  await setSkin(page, 'mithras', 'dark')
  await page.screenshot({ path: `${out}/garden-mithras-dark-requested-stays-light.png` })
  const pinned = await resolvedColours(page)
  report.darkRequestedPinned = Object.keys(light).every(k => light[k] === pinned[k])

  // ── Settings → Appearance ──
  await page.goto(`http://127.0.0.1:${garden.port}/settings-browser-harness.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const s = (window as unknown as { __settingsHarness?: { state: { ready?: boolean; error?: string | null } } }).__settingsHarness?.state
    return s?.ready === true || Boolean(s?.error)
  }, undefined, { timeout: 60_000 })
  const settings = page.locator('mn-settings-page')
  await settings.waitFor({ state: 'visible' })
  await setSkin(page, 'mithras', 'light')
  await settings.locator('[data-section-id="appearance"]').click()
  await frames(page)
  await page.screenshot({ path: `${out}/settings-mithras-light-appearance.png` })
  report.settingsSkinOptions = await page.evaluate(() => {
    const root = document.querySelector('mn-settings-page')?.shadowRoot
    const select = Array.from(root?.querySelectorAll('select') ?? []).find(s => Array.from(s.options).some(o => o.value === 'mithras'))
    return select ? Array.from(select.options).map(o => `${o.value}:${o.textContent?.trim()}`) : null
  })

  // ── Side by side: Garden (Mithras) | Flow ──
  const img = async (f: string) => `data:image/png;base64,${(await readFile(`${out}/${f}`)).toString('base64')}`
  const pairs: Array<[string, string, string]> = [
    ['compare-document-vs-flow.png', 'garden-mithras-light-document.png', 'flow-light.png'],
    ['compare-toolbar-vs-flow.png', 'garden-mithras-light-toolbar.png', 'flow-light-toolbar.png'],
    ['compare-app-picker-vs-flow.png', 'garden-mithras-light-app-picker.png', 'flow-light.png'],
  ]
  const compare = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  for (const [name, left, right] of pairs) {
    await compare.setContent(`<style>body{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#d9d9d9;font:12px system-ui}figure{margin:0;background:#fff}figcaption{padding:6px 8px;text-transform:uppercase;letter-spacing:.05em}img{width:100%;display:block}</style>
      <figure><figcaption>Garden · Mithras skin</figcaption><img src="${await img(left)}"></figure>
      <figure><figcaption>Mithras Flow · its own UI</figcaption><img src="${await img(right)}"></figure>`)
    await compare.waitForTimeout(200)
    await compare.screenshot({ path: `${out}/${name}`, fullPage: true })
  }

  await writeFile(`${out}/contrast.json`, JSON.stringify(report, null, 2))
  const failing = (report.light as { contrast: Array<{ aa: boolean }> }).contrast.filter(r => !r.aa)
  console.log(`mithras proof written to ${out}; light AA failures: ${failing.length}; dark-requested pinned: ${report.darkRequestedPinned}`)
} finally {
  await browser.close()
  await garden.server.close()
  await flow.server.close()
}
