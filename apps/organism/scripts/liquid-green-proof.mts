/**
 * Visual proof for the Garden "liquid green" refresh: the Garden default skin in
 * light + dark, with a floating command menu and a toast over the document, plus
 * reduced-transparency and more-contrast emulation. Writes PNGs + a JSON of
 * resolved colours (for the contrast table) to LIQUID_GREEN_OUT.
 *
 *   LIQUID_GREEN_OUT=/path node --import tsx scripts/liquid-green-proof.mts
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.LIQUID_GREEN_OUT ?? '/private/tmp/liquid-green'

async function frames(page: Page): Promise<void> {
  await page.waitForTimeout(260)
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(t => {
    for (const el of [document.documentElement, document.body, document.querySelector<HTMLElement>('#harness-root'), document.querySelector<HTMLElement>('#settings-harness-root')]) {
      if (!el) continue
      el.removeAttribute('data-skin')
      el.dataset.theme = t
    }
    for (const bar of document.querySelectorAll<HTMLElement & { activeSkin?: string; isDark?: boolean }>('mn-top-bar, mn-app-bar')) {
      bar.activeSkin = 'garden'
      bar.isDark = t === 'dark'
    }
  }, theme)
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
    toast.position = 'top-right'
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

/** Resolve the colours the contrast table needs, straight from the cascade. */
async function sample(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const probe = document.createElement('div')
    document.body.append(probe)
    const read = (prop: string, v: string): string => {
      probe.style.setProperty(prop, v)
      const value = getComputedStyle(probe).getPropertyValue(prop)
      probe.style.removeProperty(prop)
      return value
    }
    const roles: Record<string, string> = {}
    const colours = [
      'text-primary', 'text-secondary', 'text-tertiary', 'text-muted', 'text-quiet', 'text-accent',
      'text-accent-strong', 'text-on-accent', 'text-title', 'accent', 'accent-hover', 'accent-active',
      'surface-base', 'surface-editor', 'surface-panel', 'surface-chrome', 'surface-raised', 'surface-canvas',
      'surface-accent', 'border-focus', 'focus', 'accent-strong', 'text-danger',
    ]
    for (const c of colours) roles[c] = read('color', `var(--mn-color-${c})`)
    for (const t of ['top-bar-text', 'top-bar-text-muted', 'bottom-bar-text', 'bottom-bar-text-muted']) {
      roles[t] = read('color', `var(--mn-${t})`)
    }
    roles['top-bar-bg'] = read('background-image', 'var(--mn-top-bar-bg)') + ' | ' + read('background-color', 'var(--mn-top-bar-bg)')
    roles['bottom-bar-bg'] = read('background-color', 'var(--mn-bottom-bar-bg)')
    roles['material-chrome'] = read('background-color', 'var(--mn-material-chrome-bg)')
    roles['material-popover'] = read('background-color', 'var(--mn-material-popover-bg)')
    roles['material-filter'] = read('backdrop-filter', 'var(--mn-material-popover-filter)')
    const menu = document.querySelector('mn-context-menu')?.shadowRoot?.querySelector('.menu, [role="menu"]')
    if (menu) {
      const cs = getComputedStyle(menu)
      roles['menu.computed.bg'] = cs.backgroundColor
      roles['menu.computed.filter'] = cs.backdropFilter
    }
    probe.remove()
    return roles
  })
}

const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, hmr: false },
  logLevel: 'warn',
})
await server.listen()
const address = server.httpServer?.address()
const port = typeof address === 'object' && address ? address.port : 0
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const cdp = await page.context().newCDPSession(page)
// tsx keeps function names via an injected __name helper; give the page one.
await page.addInitScript('globalThis.__name = (f) => f')
const samples: Record<string, Record<string, string>> = {}
try {
  await mkdir(out, { recursive: true })
  await page.goto(`http://127.0.0.1:${port}/browser-harness.html`, { waitUntil: 'commit' })
  await page.waitForFunction(() => {
    const s = (window as unknown as { __organism?: { state: { ready?: boolean; error?: string | null } } }).__organism?.state
    return s?.ready === true || Boolean(s?.error)
  }, undefined, { timeout: 60_000 })
  await page.locator('.app-container mn-home-view [data-document-id="architecture"] button.open').click()
  await page.waitForFunction(() => (window as unknown as { __organism?: { state: { activeDocumentId?: string } } }).__organism?.state.activeDocumentId === 'architecture')
  await frames(page)

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: `${out}/garden-${theme}.png` })
    await page.screenshot({ path: `${out}/header-${theme}.png`, clip: { x: 0, y: 0, width: 1440, height: 64 } })
    if (await page.locator('mn-top-bar [data-app-action="home"]').count()) {
      // Keyboard focus on the Home toolbar button, to show the focus ring.
      await page.locator('mn-top-bar [data-app-action="home"]').focus()
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      await frames(page)
      await page.screenshot({ path: `${out}/header-${theme}-toolbar-focus.png`, clip: { x: 0, y: 0, width: 760, height: 64 } })
      await page.locator('mn-top-bar .app-picker').click()
      await frames(page)
      await page.screenshot({ path: `${out}/header-${theme}-app-launcher.png`, clip: { x: 0, y: 0, width: 760, height: 360 } })
      await page.keyboard.press('Escape')
      await frames(page)
    }
    await openOverlays(page)
    await page.screenshot({ path: `${out}/garden-${theme}-overlays.png` })
    samples[theme] = await sample(page)
    for (const [label, features] of [
      ['reduced-transparency', [{ name: 'prefers-reduced-transparency', value: 'reduce' }]],
      ['more-contrast', [{ name: 'prefers-contrast', value: 'more' }]],
    ] as const) {
      await cdp.send('Emulation.setEmulatedMedia', { features: [...features] })
      await frames(page)
      await page.screenshot({ path: `${out}/garden-${theme}-overlays-${label}.png` })
      samples[`${theme}/${label}`] = await sample(page)
      await cdp.send('Emulation.setEmulatedMedia', { features: [] })
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-reduced-transparency', ''))
    await frames(page)
    samples[`${theme}/setting-reduced-transparency`] = await sample(page)
    if (samples[`${theme}/setting-reduced-transparency`]?.['menu.computed.filter'] !== 'none') {
      throw new Error(`${theme} manual reduce-transparency setting left the menu backdrop active`)
    }
    await page.screenshot({ path: `${out}/garden-${theme}-overlays-setting-reduced-transparency.png` })
    await page.evaluate(() => document.documentElement.removeAttribute('data-reduced-transparency'))
    await closeOverlays(page)
  }
  // The header is shared by every skin: prove the other identities still hold.
  for (const skin of ['emporium', '98', 'glass'] as const) {
    await page.evaluate(s => {
      for (const el of [document.documentElement, document.body, document.querySelector<HTMLElement>('#harness-root')]) {
        if (!el) continue
        el.dataset.skin = s
        el.dataset.theme = 'light'
      }
      for (const bar of document.querySelectorAll<HTMLElement & { activeSkin?: string }>('mn-top-bar, mn-app-bar')) bar.activeSkin = s
    }, skin)
    await frames(page)
    await page.locator('mn-top-bar .app-picker').click()
    await frames(page)
    await page.screenshot({ path: `${out}/header-skin-${skin}-app-launcher.png`, clip: { x: 0, y: 0, width: 760, height: 360 } })
    await page.keyboard.press('Escape')
    await frames(page)
  }
  await writeFile(`${out}/resolved-colors.json`, JSON.stringify(samples, null, 2))

  // ── Settings: the deterministic settings harness, Garden light + dark ──
  await page.goto(`http://127.0.0.1:${port}/settings-browser-harness.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const s = (window as unknown as { __settingsHarness?: { state: { ready?: boolean; error?: string | null } } }).__settingsHarness?.state
    return s?.ready === true || Boolean(s?.error)
  }, undefined, { timeout: 60_000 })
  const settings = page.locator('mn-settings-page')
  await settings.waitFor({ state: 'visible' })
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    for (const section of ['appearance', 'imports', 'local-ai', 'api-mcp']) {
      await settings.locator(`[data-section-id="${section}"]`).click()
      await frames(page)
      await page.screenshot({ path: `${out}/settings-${theme}-${section}.png` })
    }
  }
  for (const [label, features] of [
    ['reduced-transparency', [{ name: 'prefers-reduced-transparency', value: 'reduce' }]],
    ['more-contrast', [{ name: 'prefers-contrast', value: 'more' }]],
  ] as const) {
    await cdp.send('Emulation.setEmulatedMedia', { features: [...features] })
    await frames(page)
    await page.screenshot({ path: `${out}/settings-dark-api-mcp-${label}.png` })
    await cdp.send('Emulation.setEmulatedMedia', { features: [] })
  }
  console.log(`liquid-green proof written to ${out}`)
} finally {
  await browser.close()
  await server.close()
}
