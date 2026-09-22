import type { TestRunnerConfig } from '@storybook/test-runner'

type Page = import('playwright').Page

/**
 * Storybook test-runner config (iteration 3c) — the REAL-BROWSER test surface.
 *
 * @storybook/test-runner drives a REAL Chromium (Playwright) against a running
 * Storybook: it visits every story, fails on render errors / console errors, and
 * runs these hooks per story. This is the real-browser guard the brief asks for
 * — no happy-dom shim, an actual layout + paint engine.
 *
 * The smoke (minimum, per the brief): render the CHROME stories in a real browser
 * across every shipped skin and assert the skin actually takes — i.e. the skin/theme
 * toolbar globals (= the RDF ConfigDimensions) re-skin the live components. We do
 * this by stamping the skin attribute on the preview <html> (exactly what the
 * preview decorator + the sux ConfigValue.appliesAttribute do) and asserting:
 *   1. the skin-aware chrome MIRRORS the ambient skin onto its own host (the 3b
 *      SkinAware contract — DOM-observable, no paint needed), AND
 *   2. the resolved --mn-color-accent token DIFFERS across the shipped skins
 *      (the cascade actually re-skinned — a real computed-style assertion that
 *      only a real browser can make).
 *
 * Stories without chrome (tokens swatches, the workspace placeholders) still get
 * the default test-runner pass (renders without error); the skin assertions only
 * run where an mn-top-bar is present.
 *
 * Two chrome shapes, two honest checks:
 *   - ROOT-DRIVEN chrome (TopBar / TopAndBottom / catalog): the bar inherits the
 *     skin from the preview <html>. We flip the root skin and assert the bar
 *     re-skins (mirrors the attr + changes accent).
 *   - LOCALLY-SKINNED chrome (SkinContrast): each bar sits inside its OWN
 *     [data-skin] section by design (nearest-ancestor wins, NOT the root). We
 *     assert the two side-by-side bars already differ — the story's whole point.
 */

const SKINS = ['garden', 'emporium', '98', 'glass', 'research', 'greenhouse'] as const
const THEMES = ['light', 'dark'] as const

/**
 * Secondary surfaces that historically inherited Platform's global token bag.
 * Their real rendered elements—not merely token swatches—must stay legible in
 * every orthogonal skin/theme combination.
 */
const CRITICAL_APPEARANCE_PROBES: Readonly<Record<string, readonly {
  readonly surface: string
  readonly text: string
  readonly label: string
}[]>> = {
  'catalog-components--mn-artifact-view': [
    { surface: 'mn-artifact-view .header', text: 'mn-artifact-view .title', label: 'artifact header' },
  ],
  'catalog-components--mn-original-viewer': [
    { surface: 'mn-original-viewer .toolbar', text: 'mn-original-viewer .title', label: 'original-file toolbar' },
  ],
  'catalog-components--wf-studio-shell': [
    { surface: 'wf-studio-shell .chrome', text: 'wf-studio-shell .title', label: 'Studio chrome' },
  ],
  'catalog-components--wf-choreograph-view': [
    { surface: 'wf-choreograph-view .head', text: 'wf-choreograph-view .title', label: 'run-history chrome' },
  ],
  'catalog-components--mn-graph-panel': [
    { surface: 'mn-graph-panel .header', text: 'mn-graph-panel .title', label: 'graph header' },
  ],
  'catalog-components--mn-settings-page': [
    { surface: 'mn-settings-page .header', text: 'mn-settings-page .brand-title', label: 'settings masthead' },
    { surface: 'mn-settings-page .sidebar', text: 'mn-settings-page .nav-item[data-active="true"]', label: 'settings active section' },
  ],
  'chat-organism--real-round-trip': [
    { surface: 'sh-chat-host sh-chat-panel .message.assistant .message-bubble', text: 'sh-chat-host sh-chat-panel .message.assistant .message-content', label: 'chat assistant message' },
    { surface: 'sh-chat-host sh-chat-panel .composer', text: 'sh-chat-host sh-chat-panel .composer-textarea', label: 'chat composer' },
  ],
}

async function renderedContrast(page: Page, selector: string): Promise<{
  readonly ratio: number
  readonly color: string
  readonly background: string
  readonly fontFamily: string
}> {
  const locator = page.locator(selector).first()
  if (await locator.count() === 0) throw new Error(`missing contrast probe ${selector}`)
  return locator.evaluate((element) => {
    type Rgba = readonly [number, number, number, number]
    const parse = (value: string): Rgba => {
      const match = value.match(/rgba?\(([-.\d]+)[,\s]+([-.\d]+)[,\s]+([-.\d]+)(?:\s*[,/]\s*([-.\d]+))?\)/i)
      if (!match) return [0, 0, 0, 0]
      return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] == null ? 1 : Number(match[4])]
    }
    const over = (front: Rgba, back: Rgba): Rgba => {
      const alpha = front[3] + (back[3] * (1 - front[3]))
      if (alpha <= 0) return [0, 0, 0, 0]
      return [
        ((front[0] * front[3]) + (back[0] * back[3] * (1 - front[3]))) / alpha,
        ((front[1] * front[3]) + (back[1] * back[3] * (1 - front[3]))) / alpha,
        ((front[2] * front[3]) + (back[2] * back[3] * (1 - front[3]))) / alpha,
        alpha,
      ]
    }
    const parentAcrossShadow = (node: Element): Element | null => {
      if (node.parentElement) return node.parentElement
      const root = node.getRootNode()
      return root instanceof ShadowRoot ? root.host : null
    }
    let background: Rgba = [0, 0, 0, 0]
    let cursor: Element | null = element
    while (cursor) {
      background = over(background, parse(getComputedStyle(cursor).backgroundColor))
      if (background[3] >= 0.995) break
      cursor = parentAcrossShadow(cursor)
    }
    if (background[3] < 0.995) background = over(background, [255, 255, 255, 1])
    const style = getComputedStyle(element)
    const text = over(parse(style.color), background)
    const linear = (channel: number): number => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    const luminance = (value: Rgba): number => (
      (0.2126 * linear(value[0])) + (0.7152 * linear(value[1])) + (0.0722 * linear(value[2]))
    )
    const foregroundLuminance = luminance(text)
    const backgroundLuminance = luminance(background)
    return {
      ratio: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
      color: style.color,
      background: `rgba(${background.map((value, index) => index < 3 ? Math.round(value) : value.toFixed(3)).join(', ')})`,
      fontFamily: style.fontFamily,
    }
  })
}

async function checkCriticalAppearanceMatrix(page: Page): Promise<void> {
  const storyId = new URL(page.url()).searchParams.get('id') ?? ''
  const probes = CRITICAL_APPEARANCE_PROBES[storyId]
  if (!probes) return

  for (const skin of SKINS) {
    for (const theme of THEMES) {
      await page.evaluate(({ nextSkin, nextTheme }) => {
        const root = document.documentElement
        if (nextSkin === 'garden') root.removeAttribute('data-skin')
        else root.setAttribute('data-skin', nextSkin)
        root.setAttribute('data-theme', nextTheme)
      }, { nextSkin: skin, nextTheme: theme })
      // Component materials intentionally cross-fade on theme changes. Sample
      // after the longest shipped 180ms transition so contrast is measured at
      // the settled appearance, not halfway between light and dark paint.
      await page.waitForTimeout(240)

      for (const probe of probes) {
        const surface = page.locator(probe.surface).first()
        const text = page.locator(probe.text).first()
        if (await surface.count() === 0 || await text.count() === 0) {
          throw new Error(`${storyId}: missing ${probe.label} probe in ${skin}/${theme}`)
        }
        const [surfaceBox, textBox, contrast] = await Promise.all([
          surface.boundingBox(),
          text.boundingBox(),
          renderedContrast(page, probe.text),
        ])
        if (!surfaceBox || !textBox || surfaceBox.width <= 0 || textBox.height <= 0) {
          throw new Error(`${storyId}: ${probe.label} has no browser layout in ${skin}/${theme}`)
        }
        if (contrast.ratio < 4.5) {
          throw new Error(
            `${storyId}: ${probe.label} contrast ${contrast.ratio.toFixed(2)} in ${skin}/${theme}; `
            + `color=${contrast.color} background=${contrast.background}`,
          )
        }
      }

      const horizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      if (horizontalOverflow > 1) {
        throw new Error(`${storyId}: ${horizontalOverflow}px horizontal overflow in ${skin}/${theme}`)
      }
    }
  }

  if (storyId === 'catalog-components--mn-artifact-view') {
    const fontAudit = await page.evaluate(async () => {
      await document.fonts.ready
      const families = Array.from(document.fonts).map(face => face.family.replace(/^['"]|['"]$/g, ''))
      const remoteRequests = performance.getEntriesByType('resource')
        .map(entry => entry.name)
        .filter(name => /fonts\.(?:googleapis|gstatic)\.com/i.test(name))
      return { families, remoteRequests }
    })
    for (const family of [
      'Literata Variable',
      'Source Sans 3 Variable',
      'JetBrains Mono Variable',
      'Inter Variable',
      'Public Sans Variable',
    ]) {
      if (!fontAudit.families.includes(family)) {
        throw new Error(`repository-owned font face ${family} is absent from the real browser FontFaceSet`)
      }
    }
    if (fontAudit.remoteRequests.length > 0) {
      throw new Error(`core typography made remote font requests: ${JSON.stringify(fontAudit.remoteRequests)}`)
    }
  }

  await page.evaluate(() => {
    document.documentElement.removeAttribute('data-skin')
    document.documentElement.setAttribute('data-theme', 'light')
  })
}

/** Read the live --mn-color-accent resolved on an element (real computed style). */
async function accentOf(page: Page, selector: string): Promise<string> {
  return page.evaluate(sel => {
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el) return ''
    return getComputedStyle(el).getPropertyValue('--mn-color-accent').trim()
  }, selector)
}

/**
 * Real-browser check for the GENERAL primitives (iter-4a). When a story renders an
 * mn-chip (the catalog Index + the per-entry primitive stories do), flip the root
 * skin and assert the chip (a) MIRRORS the ambient skin onto its host (the
 * SkinAware contract) and (b) its resolved --mn-color-accent DIFFERS Garden vs
 * Emporium — i.e. the lifted primitives are genuinely skin-aware in a real engine,
 * not just in happy-dom. (The chip's accent tone consumes --mn-color-accent.)
 */
async function checkPrimitiveReskins(page: Page): Promise<void> {
  const hasChip = await page.evaluate(() => !!document.querySelector('mn-chip'))
  if (!hasChip) return
  const accents: Record<string, string> = {}
  for (const skin of SKINS) {
    await page.evaluate((s) => {
      const root = document.documentElement
      if (s === 'garden') root.removeAttribute('data-skin')
      else root.setAttribute('data-skin', s)
    }, skin)
    await page.waitForTimeout(50)
    if (skin !== 'garden') {
      const mirrored = await page.evaluate(
        () => (document.querySelector('mn-chip') as HTMLElement | null)?.getAttribute('data-skin'),
      )
      if (mirrored !== skin) {
        throw new Error(`mn-chip did not mirror the ${skin} skin (got data-skin=${mirrored})`)
      }
    }
    accents[skin] = await accentOf(page, 'mn-chip')
  }
  const values = Object.values(accents).filter(Boolean)
  if (values.length !== SKINS.length || new Set(values).size !== SKINS.length) {
    throw new Error(
      `mn-chip --mn-color-accent did not re-skin across all skins (${JSON.stringify(accents)})`,
    )
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-skin'))
}

async function checkEditorHostUndoKeystroke(page: Page): Promise<void> {
  const storyId = new URL(page.url()).searchParams.get('id') ?? ''
  if (!storyId.endsWith('--undo-keystroke-audit')) return

  await page.waitForSelector('#mn-editor-host')
  await page.waitForFunction(() => {
    const host = document.querySelector('#mn-editor-host') as {
      liveEditor?: { getText(): string } | null
      shadowRoot?: ShadowRoot | null
    } | null
    return !!host?.liveEditor && !!host.shadowRoot?.querySelector('.ProseMirror')
  })

  const clickPoint = await page.evaluate(() => {
    const host = document.querySelector('#mn-editor-host') as {
      shadowRoot?: ShadowRoot | null
    } | null
    const editor = host?.shadowRoot?.querySelector<HTMLElement>('.ProseMirror')
    if (!editor) throw new Error('UndoKeystrokeAudit: missing .ProseMirror editor surface')
    const rect = editor.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error(`UndoKeystrokeAudit: editor has no real browser layout (${rect.width}x${rect.height})`)
    }
    return {
      x: rect.left + Math.min(24, Math.max(8, rect.width / 2)),
      y: rect.top + Math.min(24, Math.max(8, rect.height / 2)),
    }
  })

  await page.mouse.click(clickPoint.x, clickPoint.y)
  await page.keyboard.type('BrowserUndo')
  await page.waitForFunction(() => {
    const host = document.querySelector('#mn-editor-host') as {
      liveEditor?: { getText(): string } | null
    } | null
    return host?.liveEditor?.getText().includes('BrowserUndo') === true
  })

  const insertedText = await page.evaluate(() => {
    const host = document.querySelector('#mn-editor-host') as {
      liveEditor?: { getText(): string } | null
    } | null
    return host?.liveEditor?.getText() ?? ''
  })
  const shortcut = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z'
  await page.keyboard.press(shortcut)

  await page
    .waitForFunction(() => {
      const host = document.querySelector('#mn-editor-host') as {
        liveEditor?: { getText(): string } | null
      } | null
      return host?.liveEditor?.getText().includes('BrowserUndo') === false
    })
    .catch(async (cause) => {
      const currentText = await page.evaluate(() => {
        const host = document.querySelector('#mn-editor-host') as {
          liveEditor?: { getText(): string } | null
        } | null
        return host?.liveEditor?.getText() ?? ''
      })
      throw new Error(
        `UndoKeystrokeAudit: ${shortcut} did not undo the physical keyboard insert; before=${JSON.stringify(insertedText)} after=${JSON.stringify(currentText)}`,
        { cause },
      )
    })
}

const config: TestRunnerConfig = {
  async postVisit(page) {
    // Primitive skin-reskin check (runs wherever an mn-chip is present).
    await checkPrimitiveReskins(page)
    await checkEditorHostUndoKeystroke(page)
    await checkCriticalAppearanceMatrix(page)

    // The story renders inside the preview iframe; `page` is scoped to it.
    const hasChrome = await page.evaluate(() => !!document.querySelector('mn-top-bar'))
    if (!hasChrome) return

    // Is the chrome locally skinned (wrapped in its own [data-skin] host)? Then
    // the root flip won't reach it (nearest-ancestor wins) — assert the two
    // side-by-side, oppositely-skinned bars differ instead.
    const localBars = await page.evaluate(() =>
      Array.from(document.querySelectorAll('body [data-skin] mn-top-bar')).length,
    )

    if (localBars >= 2) {
      // SkinContrast shape: two bars, each under its own [data-skin].
      const gardenAccent = await accentOf(page, '[data-skin="garden"] mn-top-bar')
      const emporiumAccent = await accentOf(page, '[data-skin="emporium"] mn-top-bar')
      // Each bar must also mirror its ambient skin onto its host.
      const emporiumMirrored = await page.evaluate(
        () =>
          (document.querySelector('[data-skin="emporium"] mn-top-bar') as HTMLElement | null)?.getAttribute(
            'data-skin',
          ),
      )
      if (emporiumMirrored !== 'emporium') {
        throw new Error(
          `SkinContrast: Emporium-section bar did not mirror its skin (got data-skin=${emporiumMirrored})`,
        )
      }
      if (!gardenAccent || !emporiumAccent || gardenAccent === emporiumAccent) {
        throw new Error(
          `SkinContrast: side-by-side bars share an accent — skins not distinct (garden=${gardenAccent}, emporium=${emporiumAccent})`,
        )
      }
      return
    }

    // Root-driven shape: flip the root skin and assert the bar re-skins.
    const accents: Record<string, string> = {}
    for (const skin of SKINS) {
      // Stamp the skin on <html> — the SAME hook the preview decorator / sux
      // ConfigValue.appliesAttribute use. 'garden' = default (attribute removed).
      await page.evaluate(s => {
        const root = document.documentElement
        if (s === 'garden') root.removeAttribute('data-skin')
        else root.setAttribute('data-skin', s)
      }, skin)

      // Let the MutationObserver-driven SkinAware mixin + CSS cascade settle.
      await page.waitForTimeout(50)

      if (skin !== 'garden') {
        const mirrored = await page.evaluate(
          () => (document.querySelector('mn-top-bar') as HTMLElement | null)?.getAttribute('data-skin'),
        )
        if (mirrored !== skin) {
          throw new Error(
            `${skin} skin not mirrored onto mn-top-bar host (got data-skin=${mirrored})`,
          )
        }
      }
      accents[skin] = await accentOf(page, 'mn-top-bar')
    }

    const values = Object.values(accents).filter(Boolean)
    if (values.length !== SKINS.length) {
      throw new Error(`Failed to read --mn-color-accent for all skins: ${JSON.stringify(accents)}`)
    }
    if (new Set(values).size !== SKINS.length) {
      throw new Error(
        `Skin switch did not change --mn-color-accent across all skins (${JSON.stringify(accents)})`,
      )
    }

    // Restore the default skin so we don't bleed state into the next story.
    await page.evaluate(() => document.documentElement.removeAttribute('data-skin'))
  },
}

export default config
