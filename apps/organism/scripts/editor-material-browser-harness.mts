/**
 * Real-browser contract for the three-state editor-material preference.
 *
 * The journey starts at the actual Settings route, persists the preference,
 * navigates to the deterministic workspace in the same browser context, and
 * inspects real Chromium layout/paint. It proves the restrained paper posture,
 * then switches to full classic-word skeuomorphism and verifies its functional
 * toolbar, pasteboard, rulers, editable room, dark-theme independence, and
 * narrow-screen continuous fallback before returning to continuous mode.
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { PNG } from 'pngjs'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requestedPort = Number(process.env.SHRUBBERY_EDITOR_MATERIAL_BROWSER_PORT ?? 0)
const artifactDir = process.env.SHRUBBERY_ARTIFACT_DIR ?? '/private/tmp'

await mkdir(artifactDir, { recursive: true })

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`editor-material-browser-harness assertion failed: ${message}`)
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

async function appendThroughPointerCaret(page: Page, expectedHeading: string, suffix: string): Promise<void> {
  // Shell navigation commits before the provider-gated editor swap. Wait on
  // the live body, not only activeDocumentId, so this proof never types into
  // the outgoing room during that legitimate handoff window.
  await page.waitForFunction((heading) => document.querySelector('sh-editor-host')?.shadowRoot
    ?.querySelector<HTMLElement>('.ProseMirror h1')?.textContent === heading, expectedHeading)
  const before = await page.locator('sh-editor-host').evaluate((host) => {
    const editor = host.shadowRoot?.querySelector<HTMLElement>('.ProseMirror')
    const heading = editor?.querySelector<HTMLElement>('h1')
    const paragraphs = editor ? Array.from(editor.querySelectorAll<HTMLElement>(':scope > p')) : []
    const paragraph = paragraphs.at(-1)
    if (!editor || !heading || !paragraph) throw new Error('pointer-caret proof nodes are missing')
    return { heading: heading.textContent ?? '', paragraph: paragraph.textContent ?? '' }
  })

  const clickPoint = await page.locator('sh-editor-host').evaluate((host) => {
    const editor = host.shadowRoot?.querySelector<HTMLElement>('.ProseMirror')
    const paragraphs = editor ? Array.from(editor.querySelectorAll<HTMLElement>(':scope > p')) : []
    const paragraph = paragraphs.at(-1)
    if (!paragraph) throw new Error('pointer-caret paragraph disappeared')
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
    let lastText: Text | null = null
    let next = walker.nextNode()
    while (next) {
      if ((next.textContent ?? '').length > 0 && !next.parentElement?.closest('[contenteditable="false"]')) {
        lastText = next as Text
      }
      next = walker.nextNode()
    }
    if (!lastText || !lastText.textContent) throw new Error('pointer-caret paragraph has no text')
    const range = document.createRange()
    range.setStart(lastText, lastText.textContent.length - 1)
    range.setEnd(lastText, lastText.textContent.length)
    const rects = Array.from(range.getClientRects())
    const rect = rects.at(-1)
    if (!rect) throw new Error('pointer-caret final glyph has no layout rectangle')
    return { x: rect.right - 0.5, y: rect.top + (rect.height / 2) }
  })
  await page.mouse.click(clickPoint.x, clickPoint.y)
  await page.keyboard.type(suffix)
  try {
    await page.waitForFunction(({ heading, paragraphText, appended }) => {
      const editor = document.querySelector('sh-editor-host')?.shadowRoot
        ?.querySelector<HTMLElement>('.ProseMirror')
      const currentHeading = editor?.querySelector<HTMLElement>('h1')?.textContent ?? ''
      const paragraphs = editor ? Array.from(editor.querySelectorAll<HTMLElement>(':scope > p')) : []
      const currentParagraph = paragraphs.at(-1)?.textContent ?? ''
      return currentHeading === heading && currentParagraph === `${paragraphText}${appended}`
    }, { heading: before.heading, paragraphText: before.paragraph, appended: suffix })
  } catch (error) {
    const observed = await page.locator('sh-editor-host').evaluate((host) => {
      const editor = host.shadowRoot?.querySelector<HTMLElement>('.ProseMirror')
      const paragraphs = editor ? Array.from(editor.querySelectorAll<HTMLElement>(':scope > p')) : []
      const rawEditor = (host as HTMLElement & {
        _editor?: { state?: { selection?: { toJSON?: () => unknown } } }
      })._editor
      return {
        heading: editor?.querySelector<HTMLElement>('h1')?.textContent ?? '',
        paragraph: paragraphs.at(-1)?.textContent ?? '',
        selection: rawEditor?.state?.selection?.toJSON?.() ?? null,
      }
    })
    throw new Error(
      `pointer-caret settle failed: expected ${JSON.stringify({
        heading: before.heading,
        paragraph: `${before.paragraph}${suffix}`,
      })}, observed ${JSON.stringify(observed)}; ${String(error)}`,
    )
  }

  const after = await page.locator('sh-editor-host').evaluate((host) => {
    const editor = host.shadowRoot?.querySelector<HTMLElement>('.ProseMirror')
    const heading = editor?.querySelector<HTMLElement>('h1')
    const paragraphs = editor ? Array.from(editor.querySelectorAll<HTMLElement>(':scope > p')) : []
    return {
      heading: heading?.textContent ?? '',
      paragraph: paragraphs.at(-1)?.textContent ?? '',
    }
  })
  assert(after.heading === before.heading, `pointer edit changed the heading to ${JSON.stringify(after.heading)}`)
  assert(
    after.paragraph === `${before.paragraph}${suffix}`,
    `pointer edit landed outside the clicked paragraph: ${JSON.stringify(after.paragraph)}`,
  )
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
if (!port) throw new Error('Editor-material browser harness could not resolve its Vite port')

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1800, height: 1100 } })
const page = await context.newPage()
const pageErrors: string[] = []
const consoleErrors: string[] = []
page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

try {
  await page.goto(`http://127.0.0.1:${port}/settings-browser-harness.html`, {
    waitUntil: 'domcontentloaded',
  })
  await waitForSettings(page)
  const settings = page.locator('mn-settings-page')
  await settings.getByRole('button', { name: 'Appearance', exact: true }).click()
  const materialSelect = settings.getByLabel('Editor canvas', { exact: true })
  assert(await materialSelect.inputValue() === 'continuous', 'editor material should default to continuous')
  await materialSelect.selectOption('paper')
  await page.waitForFunction(() => document.documentElement.dataset.editorMaterial === 'paper')
  assert(await materialSelect.inputValue() === 'paper', 'Settings did not select the paper posture')
  const persistedOn = await page.evaluate(() => {
    const value = window.localStorage.getItem('shrubbery.organism.settings.v1')
    return value ? JSON.parse(value).editorMaterial : null
  })
  assert(persistedOn === 'paper', 'paper preference was not persisted')

  await page.goto(`http://127.0.0.1:${port}/browser-harness.html`, { waitUntil: 'commit' })
  await waitForWorkspace(page)
  const home = page.locator('.app-container mn-home-view')
  await home.locator('[data-document-id="architecture"] button.open').click()
  await page.waitForFunction(() => window.__organism?.state.activeDocumentId === 'architecture')
  const desktop = await page.locator('sh-editor-host').evaluate((host) => {
    const root = host.shadowRoot
    const mount = root?.querySelector<HTMLElement>('.editor-mount')
    const editor = root?.querySelector<HTMLElement>('.ProseMirror')
    if (!mount || !editor) throw new Error('live editor material nodes are missing')
    const mountRect = mount.getBoundingClientRect()
    const editorRect = editor.getBoundingClientRect()
    const editorStyle = getComputedStyle(editor)
    const rulerStyle = getComputedStyle(mount, '::before')
    return {
      rootMaterial: document.documentElement.dataset.editorMaterial,
      hostMaterial: host.getAttribute('editor-material'),
      mountWidth: mountRect.width,
      editorWidth: editorRect.width,
      editorHeight: editorRect.height,
      editorTopInset: editorRect.top - mountRect.top,
      background: editorStyle.backgroundColor,
      color: editorStyle.color,
      borderTopWidth: editorStyle.borderTopWidth,
      boxShadow: editorStyle.boxShadow,
      rulerDisplay: rulerStyle.display,
      rulerHeight: rulerStyle.height,
    }
  })
  assert(desktop.rootMaterial === 'paper' && desktop.hostMaterial === 'paper', 'paper state did not cross the shadow boundary')
  assert(Math.abs(desktop.editorWidth - 816) <= 1, `paper width is ${desktop.editorWidth}px, expected 816px`)
  assert(desktop.editorHeight >= 1056, 'paper sheet lost its minimum page height')
  assert(desktop.editorTopInset >= 55, 'paper sheet lost the ruler plus print-like top offset')
  assert(desktop.background === 'rgb(255, 253, 248)', 'paper sheet is not cream')
  assert(desktop.color === 'rgb(41, 39, 35)', 'paper sheet did not establish dark physical ink')
  assert(desktop.borderTopWidth === '1px' && desktop.boxShadow !== 'none', 'paper edge/depth is absent')
  assert(desktop.rulerDisplay === 'block' && desktop.rulerHeight === '24px', 'classic ruler is absent')

  await page.screenshot({ path: `${artifactDir}/shrubbery-art-paper-light.png`, fullPage: false })

  // The page is orthogonal to skin: Emporium recolors the room and page
  // affordances purple without allowing Garden's green canvas to leak through.
  const skinButton = page.locator('mn-top-bar button[data-action="skin"]')
  await skinButton.click()
  await page.waitForFunction(() => document.documentElement.dataset.skin === 'emporium'
    && window.__organism?.state.skin === 'emporium')
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  await page.waitForFunction(() => {
    const heading = document.querySelector('sh-editor-host')?.shadowRoot
      ?.querySelector<HTMLElement>('.ProseMirror h1')
    return heading && getComputedStyle(heading, '::before').backgroundColor === 'rgb(76, 29, 149)'
  })
  const emporium = await page.locator('sh-editor-host').evaluate((host) => {
    const mount = host.shadowRoot?.querySelector<HTMLElement>('.editor-mount')
    const editor = host.shadowRoot?.querySelector<HTMLElement>('.ProseMirror')
    const heading = editor?.querySelector<HTMLElement>('h1')
    if (!mount || !editor || !heading) throw new Error('Emporium editor material nodes are missing')
    return {
      mountBackground: getComputedStyle(mount).backgroundColor,
      editorBackground: getComputedStyle(editor).backgroundColor,
      markerBackground: getComputedStyle(heading, '::before').backgroundColor,
    }
  })
  assert(emporium.mountBackground === 'rgb(242, 240, 248)', 'Emporium canvas leaked Garden material')
  assert(emporium.editorBackground === 'rgb(255, 253, 248)', 'Emporium recolored the physical page')
  assert(
    emporium.markerBackground === 'rgb(76, 29, 149)',
    `Emporium paper affordances did not turn purple: ${emporium.markerBackground}`,
  )
  await page.screenshot({ path: `${artifactDir}/shrubbery-art-paper-emporium.png`, fullPage: false })

  // The same global control advances through 98 and Glass before Garden.
  await skinButton.click()
  await page.waitForFunction(() => document.documentElement.dataset.skin === '98'
    && window.__organism?.state.skin === '98')
  await page.waitForFunction(() => {
    const heading = document.querySelector('sh-editor-host')?.shadowRoot
      ?.querySelector<HTMLElement>('.ProseMirror h1')
    return heading && getComputedStyle(heading, '::before').backgroundColor === 'rgb(0, 0, 128)'
  })
  await page.screenshot({ path: `${artifactDir}/shrubbery-art-paper-98.png`, fullPage: false })

  await skinButton.click()
  await page.waitForFunction(() => document.documentElement.dataset.skin === 'glass'
    && window.__organism?.state.skin === 'glass')
  await page.waitForFunction(() => {
    const heading = document.querySelector('sh-editor-host')?.shadowRoot
      ?.querySelector<HTMLElement>('.ProseMirror h1')
    return heading && getComputedStyle(heading, '::before').backgroundColor === 'rgb(22, 140, 184)'
  })
  await page.screenshot({ path: `${artifactDir}/shrubbery-art-paper-glass.png`, fullPage: false })

  await skinButton.click()
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-skin')
    && window.__organism?.state.skin === 'garden')

  await page.locator('mn-top-bar button[aria-label="Toggle theme"]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark'
    && window.__organism?.state.theme === 'dark')
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  const dark = await page.locator('sh-editor-host').evaluate((host) => {
    const mount = host.shadowRoot?.querySelector<HTMLElement>('.editor-mount')
    const editor = host.shadowRoot?.querySelector<HTMLElement>('.ProseMirror')
    const heading = editor?.querySelector<HTMLElement>('h1')
    const paragraph = editor?.querySelector<HTMLElement>('p')
    if (!mount || !editor || !heading || !paragraph) throw new Error('dark editor material nodes are missing')
    return {
      mountBackground: getComputedStyle(mount).backgroundColor,
      editorBackground: getComputedStyle(editor).backgroundColor,
      editorColor: getComputedStyle(editor).color,
      headingColor: getComputedStyle(heading).color,
      paragraphColor: getComputedStyle(paragraph).color,
      text: editor.textContent,
    }
  })
  assert(dark.editorBackground === 'rgb(255, 253, 248)', 'dark theme recolored the physical page')
  assert(dark.editorColor === 'rgb(41, 39, 35)', 'dark theme recolored physical-page ink')
  assert(dark.headingColor === 'rgb(17, 17, 15)', 'dark theme recolored the paper heading')
  assert(dark.paragraphColor === 'rgb(41, 39, 35)', 'dark theme recolored paper body text')
  assert(dark.text?.includes('Architecture') && dark.text.includes('Y.Doc room'), 'paper content vanished during theme change')
  assert(dark.mountBackground !== dark.editorBackground, 'dark workspace and physical page collapsed into one surface')
  await page.screenshot({ path: `${artifactDir}/shrubbery-art-paper-dark.png`, fullPage: false })

  // Material mode must remain presentation-only. Exercise the real editable
  // ProseMirror/Y.Doc room, then switch back through the ordinary sidebar path.
  await page.locator('mn-sidebar-panel [data-node-id="research-notes"]').click()
  await page.waitForFunction(() => window.__organism?.state.activeDocumentId === 'research-notes')
  await appendThroughPointerCaret(page, 'Research Notes', ' Classic paper mode remains editable.')
  assert(
    await page.locator('sh-editor-host').getAttribute('editor-material') === 'paper',
    'editing discarded the paper presentation state',
  )
  await page.locator('mn-sidebar-panel [data-node-id="architecture"]').click()
  await page.waitForFunction(() => window.__organism?.state.activeDocumentId === 'architecture')

  // The restrained paper posture stays available, but classic Word is a
  // separate material rather than an ever-growing pile of paper overrides.
  await page.goto(`http://127.0.0.1:${port}/settings-browser-harness.html`, {
    waitUntil: 'domcontentloaded',
  })
  await waitForSettings(page)
  const classicSettings = page.locator('mn-settings-page')
  await classicSettings.getByRole('button', { name: 'Appearance', exact: true }).click()
  const classicSelect = classicSettings.getByLabel('Editor canvas', { exact: true })
  assert(await classicSelect.inputValue() === 'paper', 'paper posture did not survive route reload')
  await classicSelect.selectOption('classic-word')
  await page.waitForFunction(() => document.documentElement.dataset.editorMaterial === 'classic-word')
  assert(await classicSelect.inputValue() === 'classic-word', 'Settings did not select classic Word')
  const persistedClassic = await page.evaluate(() => {
    const value = window.localStorage.getItem('shrubbery.organism.settings.v1')
    return value ? JSON.parse(value).editorMaterial : null
  })
  assert(persistedClassic === 'classic-word', 'classic Word preference was not persisted')
  await page.screenshot({ path: `${artifactDir}/shrubbery-art-classic-word-setting.png`, fullPage: false })

  await page.goto(`http://127.0.0.1:${port}/browser-harness.html`, { waitUntil: 'commit' })
  await waitForWorkspace(page)
  await page.locator('.app-container mn-home-view [data-document-id="research-notes"] button.open').click()
  await page.waitForFunction(() => window.__organism?.state.activeDocumentId === 'research-notes')
  if (await page.evaluate(() => document.documentElement.dataset.theme === 'dark')) {
    await page.locator('mn-top-bar button[aria-label="Toggle theme"]').click()
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  }
  const classic = await page.locator('sh-editor-host').evaluate((host) => {
    const root = host.shadowRoot
    const mount = root?.querySelector<HTMLElement>('.editor-mount')
    const editor = root?.querySelector<HTMLElement>('.ProseMirror')
    const toolbar = root?.querySelector<HTMLElement>('mn-editor-toolbar')
    if (!mount || !editor || !toolbar) throw new Error('classic Word editor nodes are missing')
    const mountRect = mount.getBoundingClientRect()
    const editorRect = editor.getBoundingClientRect()
    const editorStyle = getComputedStyle(editor)
    const horizontalRuler = getComputedStyle(mount, '::before')
    const verticalRuler = getComputedStyle(mount, '::after')
    const toolbarStyle = getComputedStyle(toolbar)
    const toolbarRoot = toolbar.shadowRoot
    const toolbarShell = toolbarRoot?.querySelector<HTMLElement>('.toolbar-scroll-shell')
    const toolbarScroller = toolbarRoot?.querySelector<HTMLElement>('.toolbar-scroll-shell > mn-toolbar')
    const toolbarScrollEnd = toolbarRoot?.querySelector<HTMLElement>('[data-toolbar-scroll="end"]')
    return {
      rootMaterial: document.documentElement.dataset.editorMaterial,
      hostMaterial: host.getAttribute('editor-material'),
      mountBackground: getComputedStyle(mount).backgroundColor,
      editorWidth: editorRect.width,
      editorHeight: editorRect.height,
      editorTopInset: editorRect.top - mountRect.top,
      editorBackground: editorStyle.backgroundColor,
      editorPaddingLeft: editorStyle.paddingLeft,
      editorRadius: editorStyle.borderRadius,
      horizontalRulerDisplay: horizontalRuler.display,
      horizontalRulerContent: horizontalRuler.content,
      verticalRulerDisplay: verticalRuler.display,
      verticalRulerWidth: verticalRuler.width,
      verticalRulerHeight: verticalRuler.height,
      toolbarBackground: toolbarStyle.backgroundColor,
      toolbarShadow: toolbarStyle.boxShadow,
      toolbarOverflows: toolbarShell?.dataset.overflow,
      toolbarAtStart: toolbarShell?.dataset.atStart,
      toolbarAtEnd: toolbarShell?.dataset.atEnd,
      toolbarClientWidth: toolbarScroller?.clientWidth ?? 0,
      toolbarScrollWidth: toolbarScroller?.scrollWidth ?? 0,
      toolbarScrollControlDisplay: toolbarScrollEnd ? getComputedStyle(toolbarScrollEnd).display : 'none',
    }
  })
  assert(
    classic.rootMaterial === 'classic-word' && classic.hostMaterial === 'classic-word',
    'classic Word state did not cross the shadow boundary',
  )
  assert(classic.mountBackground === 'rgb(156, 161, 169)', 'classic pasteboard is not cool gray')
  assert(Math.abs(classic.editorWidth - 816) <= 1, `classic page width is ${classic.editorWidth}px, expected 816px`)
  assert(classic.editorHeight >= 1056, 'classic page lost Letter-height geometry')
  assert(classic.editorTopInset >= 55, 'classic page lost the ruler plus desktop inset')
  assert(classic.editorBackground === 'rgb(255, 255, 255)', 'classic page is not white')
  assert(classic.editorPaddingLeft === '96px', 'classic page lost its one-inch left margin')
  assert(classic.editorRadius === '0px', 'classic page grew modern rounded corners')
  assert(
    classic.horizontalRulerDisplay === 'block' && classic.horizontalRulerContent.includes('1'),
    'numbered horizontal ruler is absent',
  )
  assert(
    classic.verticalRulerDisplay === 'block'
      && classic.verticalRulerWidth === '24px'
      && classic.verticalRulerHeight === '1056px',
    'vertical ruler is absent or malformed',
  )
  assert(classic.toolbarBackground === 'rgb(221, 223, 227)', 'functional toolbar did not adopt classic chrome')
  assert(classic.toolbarShadow !== 'none', 'classic toolbar lost its raised accent edge')
  assert(
    classic.toolbarOverflows === 'true'
      && classic.toolbarAtStart === 'true'
      && classic.toolbarAtEnd === 'false'
      && classic.toolbarScrollWidth > classic.toolbarClientWidth,
    'intermediate-width toolbar overflow was not measured honestly',
  )
  assert(classic.toolbarScrollControlDisplay === 'flex', 'toolbar overflow has no visible edge affordance')

  const scrollToolbarRight = page.getByRole('button', { name: 'Scroll toolbar right' })
  const scrollToolbarLeft = page.getByRole('button', { name: 'Scroll toolbar left' })
  assert(await scrollToolbarRight.isEnabled(), 'right toolbar edge control starts disabled')
  assert(!(await scrollToolbarLeft.isEnabled()), 'left toolbar edge control starts enabled at the first command')
  let toolbarScrollClicks = 0
  while (toolbarScrollClicks < 64) {
    const before = await page.locator('sh-editor-host').evaluate((host) => {
      const root = host.shadowRoot?.querySelector('mn-editor-toolbar')?.shadowRoot
      const scroller = root?.querySelector<HTMLElement>('.toolbar-scroll-shell > mn-toolbar')
      const maxScroll = scroller ? Math.max(0, scroller.scrollWidth - scroller.clientWidth) : 0
      return {
        geometryAtEnd: Boolean(scroller && scroller.scrollLeft >= maxScroll - 1),
        scrollLeft: scroller?.scrollLeft ?? 0,
      }
    })
    if (before.geometryAtEnd) break
    // Font/layout settlement can increase the scroll range just after a smooth
    // scroll disabled the edge control. Wait for either the new geometry to be
    // terminal or the control to re-enable; never click a transiently disabled
    // button and never call that transient state success.
    if (!(await scrollToolbarRight.isEnabled())) {
      await page.waitForFunction(() => {
        const root = document.querySelector('sh-editor-host')?.shadowRoot
          ?.querySelector('mn-editor-toolbar')?.shadowRoot
        const scroller = root?.querySelector<HTMLElement>('.toolbar-scroll-shell > mn-toolbar')
        const end = root?.querySelector<HTMLElement>('[data-toolbar-scroll="end"]')
        if (!scroller || !end) return false
        const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
        return scroller.scrollLeft >= maxScroll - 1 || !end.hasAttribute('disabled')
      }, undefined, { timeout: 5_000 })
      continue
    }
    await scrollToolbarRight.click()
    toolbarScrollClicks += 1
    let lastScrollLeft = before.scrollLeft
    let stableSamples = 0
    let toolbarScrollSettled = false
    let after = { scrollLeft: before.scrollLeft, maxScroll: 0 }
    for (let sample = 0; sample < 100; sample += 1) {
      await page.waitForTimeout(50)
      after = await page.locator('sh-editor-host').evaluate((host) => {
        const root = host.shadowRoot?.querySelector('mn-editor-toolbar')?.shadowRoot
        const scroller = root?.querySelector<HTMLElement>('.toolbar-scroll-shell > mn-toolbar')
        if (!scroller) throw new Error('toolbar scroller disappeared after edge-control click')
        return {
          scrollLeft: scroller.scrollLeft,
          maxScroll: Math.max(0, scroller.scrollWidth - scroller.clientWidth),
        }
      })
      if (after.scrollLeft >= after.maxScroll - 1) {
        toolbarScrollSettled = true
        break
      }
      if (after.scrollLeft > before.scrollLeft + 1) {
        stableSamples = Math.abs(after.scrollLeft - lastScrollLeft) < 0.25
          ? stableSamples + 1
          : 0
        if (stableSamples >= 3) {
          toolbarScrollSettled = true
          break
        }
      }
      lastScrollLeft = after.scrollLeft
    }
    assert(
      toolbarScrollSettled,
      `toolbar did not settle after scrolling: previous=${before.scrollLeft}, `
        + `current=${after.scrollLeft}, max=${after.maxScroll}`,
    )
  }
  await page.waitForFunction(() => {
    const root = document.querySelector('sh-editor-host')?.shadowRoot
      ?.querySelector('mn-editor-toolbar')?.shadowRoot
    const scroller = root?.querySelector<HTMLElement>('.toolbar-scroll-shell > mn-toolbar')
    if (!scroller) return false
    return scroller.scrollLeft >= Math.max(0, scroller.scrollWidth - scroller.clientWidth) - 1
  }, undefined, { timeout: 10_000 })
  const toolbarEndState = await page.locator('sh-editor-host').evaluate((host) => {
    const toolbar = host.shadowRoot?.querySelector('mn-editor-toolbar')
    const root = toolbar?.shadowRoot
    const shell = root?.querySelector<HTMLElement>('.toolbar-scroll-shell')
    const scroller = root?.querySelector<HTMLElement>('.toolbar-scroll-shell > mn-toolbar')
    const finalControl = root?.querySelector<HTMLElement>('[data-search-open]')
    const scrollerRect = scroller?.getBoundingClientRect()
    const finalRect = finalControl?.getBoundingClientRect()
    return {
      atEnd: shell?.dataset.atEnd,
      scrollLeft: scroller?.scrollLeft ?? 0,
      geometryAtEnd: Boolean(
        scroller
        && scroller.scrollLeft >= Math.max(0, scroller.scrollWidth - scroller.clientWidth) - 1
      ),
      finalControlVisible: Boolean(
        scrollerRect
        && finalRect
        && finalRect.left >= scrollerRect.left - 1
        && finalRect.right <= scrollerRect.right + 1
      ),
    }
  })
  assert(
    toolbarEndState.atEnd === 'true'
      && toolbarEndState.geometryAtEnd
      && toolbarEndState.scrollLeft > 0,
    'toolbar edge control did not reach the final command group',
  )
  assert(toolbarEndState.finalControlVisible, 'final toolbar commands remain clipped after scrolling')
  assert(await scrollToolbarLeft.isEnabled(), 'left toolbar edge control did not enable after scrolling')

  const classicSkinAccents = {
    garden: 'rgb(55, 109, 87)',
    emporium: 'rgb(76, 29, 149)',
    '98': 'rgb(0, 0, 128)',
    glass: 'rgb(22, 140, 184)',
    research: 'rgb(88, 111, 147)',
    greenhouse: 'rgb(47, 125, 95)',
  } as const
  for (const [skin, expectedAccent] of Object.entries(classicSkinAccents)) {
    await page.evaluate((nextSkin) => {
      if (nextSkin === 'garden') {
        document.documentElement.removeAttribute('data-skin')
        document.body.removeAttribute('data-skin')
      } else {
        document.documentElement.dataset.skin = nextSkin
        document.body.dataset.skin = nextSkin
      }
    }, skin)
    await page.evaluate(() => new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
    await page.waitForFunction((accent) => {
      const heading = document.querySelector('sh-editor-host')?.shadowRoot
        ?.querySelector<HTMLElement>('.ProseMirror h1')
      return heading && getComputedStyle(heading, '::before').backgroundColor === accent
    }, expectedAccent)
    const skinMaterial = await page.locator('sh-editor-host').evaluate((host) => {
      const mount = host.shadowRoot?.querySelector<HTMLElement>('.editor-mount')
      const editor = host.shadowRoot?.querySelector<HTMLElement>('.ProseMirror')
      const heading = editor?.querySelector<HTMLElement>('h1')
      if (!mount || !editor || !heading) throw new Error('classic skin material nodes are missing')
      return {
        pasteboard: getComputedStyle(mount).backgroundColor,
        page: getComputedStyle(editor).backgroundColor,
        accent: getComputedStyle(heading, '::before').backgroundColor,
      }
    })
    assert(skinMaterial.pasteboard === 'rgb(156, 161, 169)', `${skin} recolored the classic pasteboard`)
    assert(skinMaterial.page === 'rgb(255, 255, 255)', `${skin} recolored the classic page`)
    assert(
      skinMaterial.accent === expectedAccent,
      `${skin} did not retain its classic-page accent (${skinMaterial.accent})`,
    )
  }
  await page.evaluate(() => {
    document.documentElement.removeAttribute('data-skin')
    document.body.removeAttribute('data-skin')
  })
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  await page.screenshot({ path: `${artifactDir}/shrubbery-art-classic-word.png`, fullPage: false })

  await page.locator('mn-top-bar button[aria-label="Toggle theme"]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark'
    && document.querySelector('sh-editor-host')?.shadowRoot
      ?.querySelector('mn-editor-toolbar')?.getAttribute('data-theme') === 'dark')
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  const classicDark = await page.locator('sh-editor-host').evaluate((host) => {
    const mount = host.shadowRoot?.querySelector<HTMLElement>('.editor-mount')
    const editor = host.shadowRoot?.querySelector<HTMLElement>('.ProseMirror')
    const toolbar = host.shadowRoot?.querySelector<HTMLElement>('mn-editor-toolbar')
    if (!mount || !editor || !toolbar) throw new Error('dark classic Word nodes are missing')
    return {
      mountBackground: getComputedStyle(mount).backgroundColor,
      editorBackground: getComputedStyle(editor).backgroundColor,
      editorColor: getComputedStyle(editor).color,
      toolbarBackground: getComputedStyle(toolbar).backgroundColor,
    }
  })
  assert(classicDark.mountBackground === 'rgb(156, 161, 169)', 'dark theme recolored the classic pasteboard')
  assert(classicDark.editorBackground === 'rgb(255, 255, 255)', 'dark theme recolored the classic page')
  assert(classicDark.editorColor === 'rgb(32, 33, 36)', 'dark theme recolored classic page ink')
  assert(classicDark.toolbarBackground === 'rgb(221, 223, 227)', 'dark theme recolored classic toolbar chrome')
  const paintedClassicPage = PNG.sync.read(
    await page.locator('sh-editor-host .ProseMirror').screenshot(),
  )
  const paintedPageIndex = (
    (Math.min(paintedClassicPage.height - 1, 700) * paintedClassicPage.width)
    + Math.floor(paintedClassicPage.width / 2)
  ) * 4
  const paintedPagePixel = {
    red: paintedClassicPage.data[paintedPageIndex],
    green: paintedClassicPage.data[paintedPageIndex + 1],
    blue: paintedClassicPage.data[paintedPageIndex + 2],
    alpha: paintedClassicPage.data[paintedPageIndex + 3],
  }
  assert(
    paintedPagePixel.red >= 248
      && paintedPagePixel.green >= 248
      && paintedPagePixel.blue >= 248
      && paintedPagePixel.alpha === 255,
    `Chromium repainted the computed-white classic page: ${JSON.stringify(paintedPagePixel)}`,
  )
  await page.screenshot({ path: `${artifactDir}/shrubbery-art-classic-word-dark.png`, fullPage: false })

  // Presentation-only still means live editing. Exercise the real ProseMirror
  // room under the classic toolbar rather than accepting a screenshot as proof.
  await appendThroughPointerCaret(page, 'Research Notes', ' Classic Word mode remains a live shared document.')
  assert(
    await page.locator('sh-editor-host').getAttribute('editor-material') === 'classic-word',
    'classic editing discarded the presentation state',
  )

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => window.__organism?.state.mobile === true)
  const mobile = await page.locator('sh-editor-host').evaluate((host) => {
    const mount = host.shadowRoot?.querySelector<HTMLElement>('.editor-mount')
    const editor = host.shadowRoot?.querySelector<HTMLElement>('.ProseMirror')
    if (!mount || !editor) throw new Error('mobile editor material nodes are missing')
    const mountRect = mount.getBoundingClientRect()
    const editorRect = editor.getBoundingClientRect()
    const editorStyle = getComputedStyle(editor)
    return {
      mountWidth: mountRect.width,
      editorWidth: editorRect.width,
      marginLeft: editorStyle.marginLeft,
      boxShadow: editorStyle.boxShadow,
      rulerDisplay: getComputedStyle(mount, '::before').display,
    }
  })
  assert(Math.abs(mobile.mountWidth - mobile.editorWidth) <= 1, 'mobile classic mode did not return to full-width editing')
  assert(mobile.marginLeft === '0px' && mobile.boxShadow === 'none', 'mobile retained desktop page furniture')
  assert(mobile.rulerDisplay === 'none', 'mobile retained the desktop ruler')
  await page.screenshot({ path: `${artifactDir}/shrubbery-art-classic-word-mobile.png`, fullPage: false })

  await page.goto(`http://127.0.0.1:${port}/settings-browser-harness.html`, {
    waitUntil: 'domcontentloaded',
  })
  await waitForSettings(page)
  const restoredSettings = page.locator('mn-settings-page')
  await restoredSettings.getByRole('button', { name: 'Appearance', exact: true }).click()
  const restoredSelect = restoredSettings.getByLabel('Editor canvas', { exact: true })
  assert(await restoredSelect.inputValue() === 'classic-word', 'Settings did not restore classic Word mode')
  await restoredSelect.selectOption('continuous')
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-editor-material'))
  const persistedOff = await page.evaluate(() => {
    const value = window.localStorage.getItem('shrubbery.organism.settings.v1')
    return value ? JSON.parse(value).editorMaterial : null
  })
  assert(persistedOff === 'continuous', 'returning to continuous mode was not persisted')

  // The caret repair is a shadow-boundary behavior, not a material override.
  // Re-prove the default continuous canvas after cycling through both paper modes.
  await page.setViewportSize({ width: 1800, height: 1100 })
  await page.goto(`http://127.0.0.1:${port}/browser-harness.html`, { waitUntil: 'commit' })
  await waitForWorkspace(page)
  await page.locator('.app-container mn-home-view [data-document-id="research-notes"] button.open').click()
  await page.waitForFunction(() => window.__organism?.state.activeDocumentId === 'research-notes')
  await appendThroughPointerCaret(page, 'Research Notes', ' Continuous mode targets the clicked paragraph.')
  assert(
    await page.locator('sh-editor-host').getAttribute('editor-material') == null,
    'continuous editing unexpectedly retained a material attribute',
  )

  assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
  assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('\n')}`)
  process.stdout.write(`${JSON.stringify({
    ok: true,
    browser: 'chromium',
    settingsPersistence: true,
    desktopPaperGeometry: true,
    ruler: true,
    emporiumMaterialRoles: true,
    ninetyEightMaterialRoles: true,
    glassMaterialRoles: true,
    darkChromeLightPage: true,
    darkClassicPaintIsWhite: true,
    classicWordPasteboard: true,
    classicWordRulers: true,
    classicWordFunctionalToolbar: true,
    intermediateToolbarOverflow: true,
    classicWordAllSkins: true,
    editorBehaviorLive: true,
    shadowDomPointerCaret: true,
    mobileContinuousFallback: true,
    screenshots: [
      `${artifactDir}/shrubbery-art-paper-light.png`,
      `${artifactDir}/shrubbery-art-paper-emporium.png`,
      `${artifactDir}/shrubbery-art-paper-98.png`,
      `${artifactDir}/shrubbery-art-paper-glass.png`,
      `${artifactDir}/shrubbery-art-paper-dark.png`,
      `${artifactDir}/shrubbery-art-classic-word-setting.png`,
      `${artifactDir}/shrubbery-art-classic-word.png`,
      `${artifactDir}/shrubbery-art-classic-word-dark.png`,
      `${artifactDir}/shrubbery-art-classic-word-mobile.png`,
    ],
  }, null, 2)}\n`)
} finally {
  await context.close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  await server.close()
}
