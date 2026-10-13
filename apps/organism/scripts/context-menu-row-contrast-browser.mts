/**
 * A real-browser contrast test for the highlighted row of <mn-context-menu>, in every bevelled skin (98 and Hotdog
 * Stand, from the shared list itself), light and dark.
 *
 * Why it exists. A row's own colour switches to the selection text when it is highlighted, but its shortcut, icon,
 * check and submenu arrow each set a muted grey of their own, so on a Highlight row they kept a grey chosen for a white
 * row: 1.37:1 on 98's navy, 1.8:1 and 1.2:1 on Hotdog Stand's black and yellow. Unit tests read CSS text; this one reads
 * what Chromium paints. For each skin and theme it opens the real menu, walks the highlight down every row with the
 * keyboard, and measures every part of the highlighted row against the row's own background:
 *
 *   label and shortcut (text)             >= 4.5:1   WCAG 1.4.3
 *   icon, check and submenu arrow (glyph) >= 3:1     WCAG 1.4.11
 *
 * and asserts that the row measured really is the highlighted one (its background is not the menu's). Exit code 1 if any
 * part misses its floor. Because the skins come from the shared bevelled list, a skin admitted to that list is put
 * under this test by the admission.
 *
 *   node --import tsx scripts/context-menu-row-contrast-browser.mts
 *   CONTEXT_MENU_OUT=/dir  — also writes one screenshot per skin and theme
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { createServer } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.env.CONTEXT_MENU_OUT ?? ''
const TEXT_FLOOR = 4.5
const GLYPH_FLOOR = 3
const THEMES = ['light', 'dark'] as const

/** Which floor each part of a row answers to. */
const PARTS = [
  { selector: '.item-label', name: 'label', floor: TEXT_FLOOR },
  { selector: '.item-shortcut', name: 'shortcut', floor: TEXT_FLOOR },
  { selector: '.item-icon', name: 'icon', floor: GLYPH_FLOOR },
  { selector: '.item-check', name: 'check', floor: GLYPH_FLOOR },
  { selector: '.submenu-icon', name: 'submenu arrow', floor: GLYPH_FLOOR },
] as const

interface PartReading { row: string; part: string; floor: number; ratio: number; color: string; background: string }
interface RowReading { row: string; highlighted: boolean; parts: PartReading[] }

async function frames(page: Page): Promise<void> {
  await page.waitForTimeout(300)
  await page.evaluate(() => new Promise<void>(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))))
}

/** What the highlighted row paints, read from the live cascade (the parts that exist on this row only). */
async function readHighlightedRow(page: Page): Promise<RowReading> {
  return page.evaluate((parts) => {
    type Rgba = readonly [number, number, number, number]
    const parse = (value: string): Rgba => {
      const m = value.match(/rgba?\(([-.\d]+)[,\s]+([-.\d]+)[,\s]+([-.\d]+)(?:\s*[,/]\s*([-.\d]+))?\)/i)
      return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] == null ? 1 : Number(m[4])] : [0, 0, 0, 0]
    }
    const over = (front: Rgba, back: Rgba): Rgba => {
      const alpha = front[3] + back[3] * (1 - front[3])
      if (alpha <= 0) return [0, 0, 0, 0]
      return [0, 1, 2].map(i => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha).concat(alpha) as unknown as Rgba
    }
    const linear = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    const luminance = (c: Rgba): number => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2])
    const up = (node: Element): Element | null => node.parentElement ?? (node.getRootNode() instanceof ShadowRoot ? (node.getRootNode() as ShadowRoot).host : null)
    const effectiveBackground = (node: Element): Rgba => {
      let background: Rgba = [0, 0, 0, 0]
      for (let cursor: Element | null = node; cursor; cursor = up(cursor)) {
        background = over(background, parse(getComputedStyle(cursor).backgroundColor))
        if (background[3] >= 0.995) break
      }
      return background[3] < 0.995 ? over(background, [255, 255, 255, 1]) : background
    }
    const menu = document.querySelector('mn-context-menu')
    const row = menu?.shadowRoot?.querySelector<HTMLElement>('.menu-item.focused') ?? null
    if (!menu || !row) throw new Error('no highlighted row in the open menu')
    const panel = menu.shadowRoot!.querySelector('.menu')!
    const rowBackground = effectiveBackground(row)
    const readings: Array<{ row: string; part: string; floor: number; ratio: number; color: string; background: string }> = []
    for (const p of parts) {
      const el = row.querySelector<HTMLElement>(p.selector)
      if (!el) continue
      if (p.selector === '.item-check' && !el.querySelector('svg')) continue // an unchecked row draws no check
      const ink = over(parse(getComputedStyle(el).color), rowBackground)
      const a = luminance(ink)
      const b = luminance(rowBackground)
      readings.push({
        row: row.dataset.menuItemId ?? '?',
        part: p.name,
        floor: p.floor,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        color: getComputedStyle(el).color,
        background: `rgb(${rowBackground.slice(0, 3).map(Math.round).join(', ')})`,
      })
    }
    const panelBackground = effectiveBackground(panel)
    const highlighted = rowBackground.slice(0, 3).some((v, i) => Math.abs(v - panelBackground[i]) > 8)
    return { row: row.dataset.menuItemId ?? '?', highlighted, parts: readings }
  }, PARTS.map(p => ({ selector: p.selector, name: p.name, floor: p.floor })))
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
if (!port) throw new Error('context-menu contrast harness could not resolve its Vite port')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 })
await page.addInitScript('globalThis.__name = (f) => f')
const pageErrors: string[] = []
page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)))

const failures: string[] = []
try {
  if (outDir) await mkdir(outDir, { recursive: true })
  await page.goto(`http://127.0.0.1:${port}/context-menu-contrast-harness.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => (window as unknown as { __contextMenuHarness?: { ready: boolean } }).__contextMenuHarness?.ready === true, undefined, { timeout: 60_000 })
  const { skins, items } = await page.evaluate(() => {
    const h = (window as unknown as { __contextMenuHarness: { skins: readonly string[]; items: number } }).__contextMenuHarness
    return { skins: [...h.skins], items: h.items }
  })
  if (skins.length === 0) failures.push('the shared bevelled list is empty: nothing is under test')
  console.log(`context-menu highlighted row, in the skins of the shared bevelled list (${skins.join(', ')}); ${items} rows; floors: text ${TEXT_FLOOR}:1, glyph ${GLYPH_FLOOR}:1`)

  for (const skin of skins) {
    for (const theme of THEMES) {
      await page.evaluate(([s, t]) => {
        const root = document.documentElement
        root.setAttribute('data-skin', s)
        root.setAttribute('data-theme', t)
      }, [skin, theme] as const)
      await page.evaluate(() => (window as unknown as { __contextMenuHarness: { open(): void } }).__contextMenuHarness.open())
      await frames(page)
      const seen: RowReading[] = []
      for (let i = 0; i < items; i++) {
        if (i > 0) {
          await page.keyboard.press('ArrowDown')
          await frames(page)
        }
        const reading = await readHighlightedRow(page)
        seen.push(reading)
        if (i === 0 && outDir) await page.screenshot({ path: `${outDir}/context-menu-${skin}-${theme}.png`, clip: { x: 0, y: 0, width: 420, height: 320 } })
      }
      const ids = seen.map(r => r.row)
      const lowest = new Map<string, PartReading>()
      for (const reading of seen) {
        if (!reading.highlighted) failures.push(`${skin}/${theme}: row ${reading.row} was measured but is not highlighted (its background is the menu's)`)
        for (const part of reading.parts) {
          const prior = lowest.get(part.part)
          if (!prior || part.ratio < prior.ratio) lowest.set(part.part, part)
          if (part.ratio < part.floor) {
            failures.push(`${skin}/${theme}: ${part.part} of the highlighted "${part.row}" row is ${part.ratio.toFixed(2)}:1 (needs ${part.floor}:1); ${part.color} on ${part.background}`)
          }
        }
      }
      console.log(`  ${skin.padEnd(13)} ${theme.padEnd(5)} rows ${ids.join(' > ')}: ${[...lowest.values()].map(p => `${p.part} ${p.ratio.toFixed(2)}`).join(', ')}`)
      await page.evaluate(() => (window as unknown as { __contextMenuHarness: { close(): void } }).__contextMenuHarness.close())
      await frames(page)
    }
  }
  if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join(' | ')}`)
} finally {
  await browser.close()
  await server.close()
}

if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURE(S):`)
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log('\nevery part of the highlighted row clears its floor in every bevelled skin, light and dark')
}
