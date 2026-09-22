/**
 * Real-browser completion gate for Shrubbery's visual system.
 *
 * Functional journeys live in browser-harness.mts and settings-browser-harness.mts.
 * This harness owns the orthogonal artist-phase contract: every shipped skin in
 * both themes, resolved semantic surfaces, AA text contrast, visible focus,
 * reduced motion, settled chat/editor chrome, and responsive overflow.
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requestedPort = Number(process.env.SHRUBBERY_ART_DIRECTION_BROWSER_PORT ?? 0)
const artifactDir = process.env.SHRUBBERY_ART_DIRECTION_ARTIFACT_DIR
  ?? '/private/tmp/shrubbery-art-direction-matrix'
const skins = ['garden', 'emporium', '98', 'glass', 'research', 'greenhouse'] as const
const themes = ['light', 'dark'] as const
// The adaptive interaction system (mobile branch, commit 9a781ac) collapses the
// three-pane desktop workspace into the single-pane mobile shell at and below
// 1024px (ADAPTIVE_BREAKPOINT = '(max-width: 1024px)'). The "difficult band"
// where all three panes still exist but the chrome must compress is therefore
// the narrow-desktop range JUST ABOVE 1024px — sweep those edges, not the old
// pre-adaptive 769–1024 band (which is now honest mobile and has no 3-pane
// chrome to audit).
const intermediateWorkspaceWidths = [1_040, 1_088, 1_152, 1_216, 1_280, 1_360, 1_440, 1_536] as const

type Skin = (typeof skins)[number]
type Theme = (typeof themes)[number]

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`art-direction-browser-harness assertion failed: ${message}`)
}

interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

function parseRgb(value: string): Rgb {
  const match = /^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(value)
  if (!match) throw new Error(`Cannot parse browser color ${JSON.stringify(value)}`)
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  }
}

function composite(foreground: Rgb, background: Rgb): Rgb {
  const alpha = foreground.a + background.a * (1 - foreground.a)
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha,
  }
}

function luminance(color: Rgb): number {
  const channel = (value: number): number => {
    const normalized = value / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

function contrast(foreground: string, background: string): number {
  const bg = parseRgb(background)
  const fg = composite(parseRgb(foreground), bg)
  const bright = Math.max(luminance(fg), luminance(bg))
  const dark = Math.min(luminance(fg), luminance(bg))
  return (bright + 0.05) / (dark + 0.05)
}

async function applyAppearance(page: Page, skin: Skin, theme: Theme): Promise<void> {
  await page.evaluate(({ skin: nextSkin, theme: nextTheme }) => {
    const root = document.documentElement
    if (nextSkin === 'garden') root.removeAttribute('data-skin')
    else root.dataset.skin = nextSkin
    root.dataset.theme = nextTheme
    if (nextSkin === 'garden') document.body.removeAttribute('data-skin')
    else document.body.dataset.skin = nextSkin
    document.body.dataset.theme = nextTheme
    for (const host of [
      document.querySelector<HTMLElement>('#harness-root'),
      document.querySelector<HTMLElement>('#settings-harness-root'),
    ]) {
      if (!host) continue
      if (nextSkin === 'garden') host.removeAttribute('data-skin')
      else host.dataset.skin = nextSkin
      host.dataset.theme = nextTheme
    }
    for (const bar of document.querySelectorAll<HTMLElement & { activeSkin?: string }>('mn-top-bar, mn-app-bar')) {
      bar.activeSkin = nextSkin
    }
  }, { skin, theme })
  await page.waitForTimeout(240)
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
}

async function waitForWorkspace(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const state = (window as unknown as {
      __organism?: { state: { ready?: boolean; error?: string | null } }
    }).__organism?.state
    return state?.ready === true || Boolean(state?.error)
  }, undefined, { timeout: 60_000 })
  const error = await page.evaluate(() => window.__organism?.state.error ?? null)
  assert(error == null, `workspace boot error: ${String(error)}`)
}

async function waitForSettings(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const state = (window as unknown as {
      __settingsHarness?: { state: { ready?: boolean; error?: string | null } }
    }).__settingsHarness?.state
    return state?.ready === true || Boolean(state?.error)
  }, undefined, { timeout: 60_000 })
  const error = await page.evaluate(() => window.__settingsHarness?.state.error ?? null)
  assert(error == null, `settings boot error: ${String(error)}`)
}

interface AppearanceSnapshot {
  readonly colors: Record<string, string>
  readonly topBarHeight: number
  readonly bottomBarHeight: number
  readonly scrollWidth: number
  readonly clientWidth: number
  readonly focusOutline: string
  readonly focusShadow: string
  readonly mirroredSkin: string | null
  readonly mirroredTheme: string | null
  readonly controlledSkin: string | null
  readonly skinActionLabel: string | null
  readonly chatComposerBackground: string
}

async function appearanceSnapshot(page: Page): Promise<AppearanceSnapshot> {
  // Land keyboard focus on the theme control the way a real user would, so the
  // :focus-visible ring (mn-top-bar's deliberate keyboard-only focus treatment)
  // actually fires. A bare programmatic .focus() is not keyboard modality and
  // Chromium refuses :focus-visible for it. So we script-focus the control, then
  // round-trip through the keyboard (Tab away, Shift+Tab back) to re-enter it
  // via genuine keyboard navigation — which does resolve to :focus-visible.
  await page.evaluate(() => {
    const top = document.querySelector('mn-top-bar')
    const themeButton = top?.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="Toggle theme"]')
    themeButton?.focus()
  })
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  return page.evaluate(() => {
    const requests: Array<[string, string, 'color' | 'backgroundColor']> = [
      ['canvas', '--mn-color-surface-canvas', 'backgroundColor'],
      ['base', '--mn-color-surface-base', 'backgroundColor'],
      ['editor', '--mn-color-surface-editor', 'backgroundColor'],
      ['panel', '--mn-color-surface-panel', 'backgroundColor'],
      ['chrome', '--mn-color-surface-chrome', 'backgroundColor'],
      ['primary', '--mn-color-text-primary', 'color'],
      ['secondary', '--mn-color-text-secondary', 'color'],
      ['quiet', '--mn-color-text-quiet', 'color'],
      ['title', '--mn-color-text-title', 'color'],
      ['accentStrong', '--mn-color-text-accent-strong', 'color'],
      ['onAccent', '--mn-color-text-on-accent', 'color'],
      ['accent', '--mn-color-accent', 'backgroundColor'],
    ]
    const colors: Record<string, string> = {}
    for (const [name, variable, property] of requests) {
      const probe = document.createElement('span')
      probe.style.position = 'fixed'
      probe.style.opacity = '0'
      probe.style.pointerEvents = 'none'
      if (property === 'color') probe.style.color = `var(${variable})`
      else probe.style.backgroundColor = `var(${variable})`
      document.body.appendChild(probe)
      colors[name] = getComputedStyle(probe)[property]
      probe.remove()
    }
    const top = document.querySelector<HTMLElement>('mn-top-bar')
    const bottom = document.querySelector<HTMLElement>('mn-bottom-bar')
    const themeButton = top?.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="Toggle theme"]')
    const skinButton = top?.shadowRoot?.querySelector<HTMLButtonElement>('button[data-action="skin"]')
    if (!top || !bottom || !themeButton || !skinButton) throw new Error('workspace chrome is incomplete')
    // Focus was already driven onto this control via real keyboard navigation
    // (see appearanceSnapshot) so it matches :focus-visible; just read it.
    const focus = getComputedStyle(themeButton)
    const chatPanel = document.querySelector('sh-chat-host')?.shadowRoot
      ?.querySelector<HTMLElement>('sh-chat-panel')
    const composer = chatPanel?.querySelector<HTMLElement>('hoja-editor .ProseMirror[aria-label^="Message "]')
      ?? chatPanel?.shadowRoot?.querySelector<HTMLElement>('hoja-editor .ProseMirror[aria-label^="Message "]')
    if (!composer) throw new Error('chat composer is unavailable')
    return {
      colors,
      topBarHeight: top.getBoundingClientRect().height,
      bottomBarHeight: bottom.getBoundingClientRect().height,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      focusOutline: `${focus.outlineStyle} ${focus.outlineWidth}`,
      focusShadow: focus.boxShadow,
      mirroredSkin: top.getAttribute('data-skin'),
      mirroredTheme: top.getAttribute('data-theme'),
      controlledSkin: skinButton.dataset.activeSkin ?? null,
      skinActionLabel: skinButton.getAttribute('aria-label'),
      chatComposerBackground: getComputedStyle(composer).backgroundColor,
    }
  })
}

async function auditChatMaterialCorners(page: Page, skin: '98' | 'glass', artifacts: string): Promise<void> {
  const panel = page.locator('sh-chat-host sh-chat-panel')
  assert(await panel.getAttribute('data-skin') === skin, `${skin} chat panel did not mirror the ambient skin`)

  // The deterministic browser harness intentionally boots without a configured
  // LLM backend, so the host has no model catalogue to inject. Supply a tiny
  // catalogue directly to the REAL panel before driving its real picker; this
  // keeps the visual audit backend-independent without fabricating picker DOM.
  await panel.evaluate(async (element) => {
    const chat = element as HTMLElement & {
      models: Array<{ id: string; label: string }>
      currentModel: string
      updateComplete: Promise<unknown>
    }
    if (chat.models.length === 0) {
      chat.models = [
        { id: 'anthropic/claude-sonnet', label: 'Claude Sonnet' },
        { id: 'openai/gpt-5', label: 'GPT-5' },
      ]
      chat.currentModel = 'anthropic/claude-sonnet'
      await chat.updateComplete
    }
  })

  const trigger = panel.locator('.model-selector-trigger')
  await trigger.click()
  const picker = panel.locator('.model-picker')
  await picker.waitFor({ state: 'visible' })
  const pickerMaterial = await picker.evaluate((element) => {
    const style = getComputedStyle(element)
    const provider = element.querySelector<HTMLElement>('.model-picker-provider')
    const model = element.querySelector<HTMLElement>('.model-picker-model')
    const modelPane = element.querySelector<HTMLElement>('.model-picker-models')
    return {
      background: style.backgroundColor,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      backdropFilter: style.backdropFilter,
      providerColor: provider ? getComputedStyle(provider).color : '',
      providerOpacity: provider ? getComputedStyle(provider).opacity : '',
      modelColor: model ? getComputedStyle(model).color : '',
      modelOpacity: model ? getComputedStyle(model).opacity : '',
      modelBackground: modelPane ? getComputedStyle(modelPane).backgroundColor : '',
    }
  })
  assert(pickerMaterial.background !== 'rgba(0, 0, 0, 0)', `${skin} model picker stayed transparent`)
  assert(pickerMaterial.boxShadow !== 'none', `${skin} model picker lost material depth`)
  assert(pickerMaterial.providerOpacity === '1', `${skin} model-provider text is faded`)
  assert(pickerMaterial.modelOpacity === '1', `${skin} model-option text is faded`)
  assert(
    contrast(pickerMaterial.providerColor, pickerMaterial.background) >= 4.5,
    `${skin} model-provider text is not AA against its material`,
  )
  assert(
    contrast(pickerMaterial.modelColor, pickerMaterial.modelBackground) >= 4.5,
    `${skin} model-option text is not AA against its material`,
  )
  if (skin === '98') {
    assert(pickerMaterial.borderRadius === '0px', `98 model picker retained ${pickerMaterial.borderRadius} rounding`)
  } else {
    assert(pickerMaterial.borderRadius !== '0px', 'Glass model picker lost its rounded frame')
    assert(pickerMaterial.backdropFilter !== 'none', 'Glass model picker is not frosted')
  }
  await page.screenshot({ path: `${artifacts}/workspace-${skin}-light-model-picker.png`, fullPage: false })
  await trigger.click()
  await picker.waitFor({ state: 'detached' })

  await panel.locator('.super-bar-identity').click()
  const drawer = page.locator('sh-chat-host [data-chat-history-drawer]')
  await drawer.waitFor({ state: 'visible' })
  const drawerMaterial = await drawer.evaluate((element) => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, boxShadow: style.boxShadow, backdropFilter: style.backdropFilter }
  })
  assert(drawerMaterial.background !== 'rgba(0, 0, 0, 0)', `${skin} history drawer stayed transparent`)
  assert(drawerMaterial.boxShadow !== 'none', `${skin} history drawer lost material depth`)
  if (skin === 'glass') assert(drawerMaterial.backdropFilter !== 'none', 'Glass history drawer is not frosted')
  await page.screenshot({ path: `${artifacts}/workspace-${skin}-light-chat-history.png`, fullPage: false })
  await page.locator('sh-chat-host [aria-label="Close chat history"]').click()
  await drawer.waitFor({ state: 'detached' })
}

function assertAppearance(snapshot: AppearanceSnapshot, skin: Skin, theme: Theme): number {
  const label = `${skin}/${theme}`
  assert(snapshot.colors.canvas !== snapshot.colors.editor, `${label} collapsed canvas and editor surfaces`)
  assert(snapshot.colors.panel !== snapshot.colors.editor, `${label} collapsed panel and editor surfaces`)
  assert(snapshot.colors.chrome !== snapshot.colors.canvas, `${label} collapsed chrome and canvas surfaces`)
  assert(Math.abs(snapshot.topBarHeight - 40) <= 0.5, `${label} top bar is ${snapshot.topBarHeight}px`)
  assert(Math.abs(snapshot.bottomBarHeight - 30) <= 0.5, `${label} bottom bar is ${snapshot.bottomBarHeight}px`)
  assert(snapshot.scrollWidth <= snapshot.clientWidth, `${label} has horizontal document overflow`)
  assert(
    snapshot.focusOutline !== 'none 0px' || snapshot.focusShadow !== 'none',
    `${label} theme control has no visible focus treatment`,
  )
  assert(
    snapshot.mirroredTheme === theme,
    `${label} top bar did not mirror theme (got ${String(snapshot.mirroredTheme)})`,
  )
  if (skin === 'garden') assert(snapshot.mirroredSkin == null, `${label} should use the attribute-free Garden default`)
  else assert(snapshot.mirroredSkin === skin, `${label} top bar did not mirror skin`)
  assert(snapshot.controlledSkin === skin, `${label} skin control reflected ${String(snapshot.controlledSkin)}`)
  if (skin === '98') {
    assert(snapshot.skinActionLabel?.includes('98'), `${label} skin control lost its 98 accessible name`)
  }
  if (skin === 'glass') {
    assert(snapshot.skinActionLabel?.includes('Glass'), `${label} skin control lost its Glass accessible name`)
  }
  if (theme === 'dark') {
    assert(
      snapshot.chatComposerBackground !== 'rgb(255, 255, 255)'
        && snapshot.chatComposerBackground !== 'rgb(255, 253, 248)',
      `${label} chat composer remained a light-theme surface`,
    )
  }

  const ratios = [
    ['primary', contrast(snapshot.colors.primary, snapshot.colors.base)],
    ['secondary', contrast(snapshot.colors.secondary, snapshot.colors.base)],
    ['quiet', contrast(snapshot.colors.quiet, snapshot.colors.base)],
    ['title', contrast(snapshot.colors.title, snapshot.colors.base)],
    ['accentStrong', contrast(snapshot.colors.accentStrong, snapshot.colors.base)],
    ['onAccent', contrast(snapshot.colors.onAccent, snapshot.colors.accent)],
  ] as const
  for (const [role, ratio] of ratios) {
    assert(ratio >= 4.5, `${label} ${role} contrast is ${ratio.toFixed(2)}:1`)
  }
  return Math.min(...ratios.map(([, ratio]) => ratio))
}

const server = await createServer({
  root: appDir,
  configFile: resolve(appDir, 'vite.config.ts'),
  server: {
    host: '127.0.0.1',
    port: requestedPort,
    strictPort: requestedPort !== 0,
    hmr: false,
  },
  logLevel: 'warn',
})
await server.listen()
const address = server.httpServer?.address()
const port = typeof address === 'object' && address ? address.port : requestedPort
if (!port) throw new Error('Art-direction harness could not resolve its Vite port')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const pageErrors: string[] = []
const consoleErrors: string[] = []
page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

try {
  await mkdir(artifactDir, { recursive: true })
  await page.goto(`http://127.0.0.1:${port}/browser-harness.html`, { waitUntil: 'commit' })
  await waitForWorkspace(page)
  await page.locator('.app-container mn-home-view [data-document-id="architecture"] button.open').click()
  await page.waitForFunction(() => window.__organism?.state.activeDocumentId === 'architecture')
  await page.locator('sh-chat-host sh-chat-panel hoja-editor .ProseMirror[aria-label^="Message "]')
    .waitFor({ state: 'visible' })

  let minimumContrast = Number.POSITIVE_INFINITY
  for (const skin of skins) {
    for (const theme of themes) {
      await applyAppearance(page, skin, theme)
      const snapshot = await appearanceSnapshot(page)
      minimumContrast = Math.min(minimumContrast, assertAppearance(snapshot, skin, theme))
      await page.screenshot({
        path: `${artifactDir}/workspace-${skin}-${theme}.png`,
        fullPage: false,
      })
      if (theme === 'light' && (skin === '98' || skin === 'glass')) {
        await auditChatMaterialCorners(page, skin, artifactDir)
      }
    }
  }

  // The desktop/mobile endpoints alone miss the difficult band where all three
  // panes still exist but the editor toolbar and breadcrumb chrome must compress.
  // Under the adaptive system this band is the narrow-desktop range just above
  // the 1024px breakpoint (see intermediateWorkspaceWidths); sweep those edges in
  // a real layout engine and confirm each still resolves to the three-pane
  // desktop shell (mobile === false) with intact, non-colliding chrome.
  await applyAppearance(page, 'garden', 'light')
  for (const width of intermediateWorkspaceWidths) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForFunction(() => window.__organism?.state.mobile === false)
    await page.evaluate(() => new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
    const geometry = await page.evaluate(() => {
      const topBar = document.querySelector<HTMLElement>('mn-top-bar')
      const top = topBar?.getBoundingClientRect()
      const bottom = document.querySelector<HTMLElement>('mn-bottom-bar')?.getBoundingClientRect()
      const editorHost = document.querySelector<HTMLElement>('sh-editor-host')
      const editor = editorHost?.getBoundingClientRect()
      if (!topBar || !top || !bottom || !editor) throw new Error('responsive workspace frame is incomplete')
      const editorToolbar = editorHost?.shadowRoot?.querySelector('mn-editor-toolbar')
      const editorToolbarShell = editorToolbar?.shadowRoot
        ?.querySelector<HTMLElement>('.toolbar-scroll-shell')
      const editorToolbarEnd = editorToolbar?.shadowRoot
        ?.querySelector<HTMLElement>('[data-toolbar-scroll="end"]')
      const chromeGroups = ['.masthead', '.app-switcher', '.breadcrumbs', '.actions']
        .map(selector => topBar.shadowRoot?.querySelector<HTMLElement>(selector)?.getBoundingClientRect())
      const chromeGroupsOrdered = chromeGroups.every((rect, index) => {
        if (!rect) return false
        const next = chromeGroups[index + 1]
        return !next || rect.right <= next.left + 1
      })
      const visibleEditorWidth = Math.max(
        0,
        Math.min(editor.right, innerWidth) - Math.max(editor.left, 0),
      )
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        topLeft: top.left,
        topRight: top.right,
        bottomLeft: bottom.left,
        bottomRight: bottom.right,
        topScrollWidth: topBar.scrollWidth,
        topClientWidth: topBar.clientWidth,
        chromeGroupsOrdered,
        headerChildCount: topBar.parentElement?.childElementCount ?? 0,
        editorToolbarOverflows: editorToolbarShell?.dataset.overflow,
        editorToolbarEndDisplay: editorToolbarEnd ? getComputedStyle(editorToolbarEnd).display : 'none',
        visibleEditorWidth,
        editorHeight: editor.height,
      }
    })
    assert(geometry.scrollWidth <= geometry.clientWidth, `${width}px workspace has horizontal overflow`)
    assert(
      geometry.topLeft >= -1
        && geometry.bottomLeft >= -1
        && geometry.topRight <= width + 1
        && geometry.bottomRight <= width + 1,
      `${width}px workspace chrome escaped the viewport`,
    )
    assert(
      geometry.topScrollWidth <= geometry.topClientWidth
        && geometry.chromeGroupsOrdered
        && geometry.headerChildCount === 1,
      `${width}px top-bar chrome collided or retained an out-of-band overlay`,
    )
    assert(
      geometry.editorToolbarOverflows !== 'true' || geometry.editorToolbarEndDisplay === 'flex',
      `${width}px editor toolbar clips commands without a visible edge control`,
    )
    if (width === 1_040) {
      // At the narrowest surviving three-pane desktop width the editor pane is
      // still wide enough that the toolbar fits without clipping: it must NOT be
      // in overflow and the scroll edge-control must stay hidden. (Genuine
      // toolbar overflow + its edge affordance is exercised directly in the
      // editor-material harness, where the editor is deliberately narrowed.)
      assert(
        geometry.editorToolbarOverflows === 'false' && geometry.editorToolbarEndDisplay === 'none',
        `1040px narrow-desktop toolbar should fit un-clipped (overflow=${String(geometry.editorToolbarOverflows)}, edge=${geometry.editorToolbarEndDisplay})`,
      )
    }
    assert(
      geometry.visibleEditorWidth >= 120 && geometry.editorHeight >= 400,
      `${width}px workspace collapsed its live editor to ${geometry.visibleEditorWidth}×${geometry.editorHeight}`,
    )
    if (width === 1_040 || width === 1_216 || width === 1_440) {
      await page.screenshot({ path: `${artifactDir}/workspace-${width}px.png`, fullPage: false })
    }
  }

  await page.setViewportSize({ width: 1600, height: 1000 })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reducedMotion = await page.evaluate(() => ({
    matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    token: getComputedStyle(document.documentElement).getPropertyValue('--mn-transition-fast').trim(),
  }))
  assert(reducedMotion.matches, 'browser did not enter reduced-motion media mode')
  assert(
    /^0(?:ms|s)\s/.test(reducedMotion.token),
    `reduced motion resolved to ${JSON.stringify(reducedMotion.token)}`,
  )
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const explicitReducedMotion = await page.evaluate(() => {
    document.documentElement.setAttribute('data-reduced-motion', '')
    const token = getComputedStyle(document.documentElement)
      .getPropertyValue('--mn-transition-fast').trim()
    document.documentElement.removeAttribute('data-reduced-motion')
    return token
  })
  assert(
    /^0(?:ms|s)\s/.test(explicitReducedMotion),
    `explicit reduced-motion preference resolved to ${JSON.stringify(explicitReducedMotion)}`,
  )

  await page.goto(`http://127.0.0.1:${port}/settings-browser-harness.html`, {
    waitUntil: 'domcontentloaded',
  })
  await waitForSettings(page)
  const settings = page.locator('mn-settings-page')
  await settings.getByRole('button', { name: 'Local AI', exact: true }).click()
  for (const skin of skins) {
    for (const theme of themes) {
      await applyAppearance(page, skin, theme)
      // Same keyboard-driven focus as appearanceSnapshot: the settings nav ring
      // is :focus-visible too, so script-focus the nav item then round-trip
      // through the keyboard (Tab away, Shift+Tab back) to re-enter it via real
      // keyboard navigation, which is what makes :focus-visible match.
      await settings.evaluate((element) => {
        const nav = element.shadowRoot?.querySelector<HTMLButtonElement>('.nav-item')
        nav?.focus()
      })
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      const geometry = await settings.evaluate((element) => {
        const root = element.shadowRoot
        const frame = root?.querySelector<HTMLElement>('.root')
        const nav = root?.querySelector<HTMLButtonElement>('.nav-item')
        if (!frame || !nav) throw new Error('settings visual frame is incomplete')
        // Focus already driven onto this nav item via real keyboard navigation
        // above so it matches :focus-visible; just read it.
        const focus = getComputedStyle(nav)
        return {
          width: frame.getBoundingClientRect().width,
          height: frame.getBoundingClientRect().height,
          overflow: frame.scrollWidth > frame.clientWidth,
          focusOutline: `${focus.outlineStyle} ${focus.outlineWidth}`,
          focusShadow: focus.boxShadow,
        }
      })
      assert(geometry.width >= 1000 && geometry.height >= 900, `${skin}/${theme} settings did not fill its route`)
      assert(!geometry.overflow, `${skin}/${theme} settings has horizontal overflow`)
      assert(
        geometry.focusOutline !== 'none 0px' || geometry.focusShadow !== 'none',
        `${skin}/${theme} settings navigation has no visible focus`,
      )
      await page.screenshot({
        path: `${artifactDir}/settings-${skin}-${theme}.png`,
        fullPage: false,
      })
    }
  }

  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`http://127.0.0.1:${port}/browser-harness.html`, { waitUntil: 'commit' })
  await waitForWorkspace(page)
  await page.locator('.app-container mn-home-view [data-document-id="architecture"] button.open').click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => window.__organism?.state.mobile === true
    && window.__organism.state.activeDocumentId === 'architecture')
  const mobile = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    tabs: document.querySelector('.organism-mobile-shell')?.querySelector('mn-mobile-tabs')
      ?.shadowRoot?.querySelectorAll('button').length ?? 0,
  }))
  assert(mobile.scrollWidth <= mobile.clientWidth, 'mobile workspace has horizontal overflow')
  assert(mobile.tabs === 3, `mobile workspace exposed ${mobile.tabs} tabs instead of three`)
  await page.screenshot({ path: `${artifactDir}/workspace-mobile.png`, fullPage: false })

  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('\n')}`)
  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: 'chromium',
    workspaceAppearances: skins.length * themes.length,
    settingsAppearances: skins.length * themes.length,
    chatMaterialCornerAudits: 2,
    intermediateWorkspaceWidths: intermediateWorkspaceWidths.length,
    minimumContrast: Number(minimumContrast.toFixed(2)),
    visibleFocus: true,
    reducedMotion: true,
    mobileOverflow: false,
    artifactDir,
  }, null, 2)}\n`)
} finally {
  await page.close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  await server.close()
}
