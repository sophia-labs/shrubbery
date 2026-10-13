/**
 * Real Chromium + real gardend + real SPA: how the Tabula `senderos` graph
 * READS (design/senderos-polish-20260925).
 *
 * Seeds a local gardend with a senderos copy exactly as the W1 seed plan does
 * (plans/2026-09-23-tabula-w1: vocab + shapes → :vocab:tabula, the generated
 * claims seed → :derived:claims, figure rows → :derived:data-f1…f5, the eight
 * `create_document_once` payloads), opens the documents in the SPA without a
 * keystroke, and records:
 *   - screenshots of each reading surface at desktop and phone width, light
 *     and dark (query blocks, tables, the census chart, math, mermaid, the
 *     unsupported-content placeholder, the hover chrome);
 *   - per query block: status, error text, visualization, caption;
 *   - whether OPENING changed any stored query-block attribute (read must
 *     never write).
 *
 * Env:
 *   GARDEN_BIN            gardend binary (real; no mock)
 *   SENDEROS_W1_DIR       the W1 payload directory (vocab, seed, 15-figure-data, 16-documents)
 *   SENDEROS_OUT          output directory (screenshots + report.json)
 *   SENDEROS_LABEL        filename prefix, e.g. `before` / `after` (default `run`)
 *   SENDEROS_DATA_FIX     optional JSON: { "<document_id>": { "<data-block-id>": { attr: value } } }
 *                         applied to the payloads before seeding — for previewing a
 *                         PROPOSED stored-data change; the report records it.
 *   SENDEROS_THEMES       comma list, default `light,dark`
 *   SENDEROS_MODE         `mobile`: phone viewports in a TOUCH browser context
 *                         (isMobile + hasTouch: `(pointer: coarse)` and
 *                         `(hover: none)` match, as on a real phone), with
 *                         per-viewport measurements and the figure checks
 *                         (the ⋯ bar, scroll edges, full screen fit/zoom).
 *   SENDEROS_TOUCH=0      mobile mode without touch emulation (the 09-25 pass).
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Browser, chromium, type Locator, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import * as Y from 'yjs'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'
import {
  createGraphAndSeedUxConfig,
  type GardendCell,
  resolveGardendBin,
  spawnGardend,
} from '../src/cell/spawn-gardend.js'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const w1 = process.env.SENDEROS_W1_DIR
if (!w1 || !existsSync(w1)) throw new Error('SENDEROS_W1_DIR must point at the W1 payload directory')
const outDir = process.env.SENDEROS_OUT ?? resolve(appDir, '.senderos-reading')
const label = process.env.SENDEROS_LABEL ?? 'run'
const dataFixPath = process.env.SENDEROS_DATA_FIX
const themes = (process.env.SENDEROS_THEMES ?? 'light,dark').split(',').filter(Boolean)
const graphId = 'senderos'
const port = Number(process.env.SHRUBBERY_SENDEROS_PORT ?? 5237)
const require_ = createRequire(import.meta.url)
const seedPath = resolve(dirname(require_.resolve('@shrubbery/nucleus')), 'workspace/__generated__/garden-default.ux.nt')

const NG = (suffix: string): string => `urn:mnemosyne:local:graph:senderos:${suffix}`
const RDF_LOADS: ReadonlyArray<readonly [string, string]> = [
  ['10-tabula-vocab.ttl', NG('vocab:tabula')],
  ['11-tabula-shapes.ttl', NG('vocab:tabula')],
  ['12-senderos-seed.ttl', NG('derived:claims')],
  ...['f1', 'f2', 'f3', 'f4', 'f5'].map(f => [`15-figure-data/${f}.ttl`, NG(`derived:data-${f}`)] as const),
]
const DOCS = [
  'senderos-readme', 'senderos-s1-work-holonomy', 'senderos-s2-gesture-compiler',
  'senderos-s3-protected-transport', 'senderos-s4-instrument-ledger', 'senderos-s5-extension-e3',
  'senderos-s6-what-failed', 'senderos-s7-open-questions',
]
/** What to photograph, per document. */
const SHOTS: Record<string, ReadonlyArray<{ name: string; selector: string; nth?: number }>> = {
  'senderos-readme': [
    { name: 'ladder', selector: '.query-block', nth: 0 },
    { name: 'census', selector: '.query-block', nth: 1 },
    { name: 'weakest', selector: '.query-block', nth: 2 },
    { name: 'legend', selector: '.unsupported-block', nth: 0 },
    { name: 'mermaid', selector: '.mermaid-code-block-wrapper', nth: 0 },
  ],
  'senderos-s1-work-holonomy': [
    { name: 'math', selector: '.math-block', nth: 0 },
    { name: 'mermaid', selector: '.mermaid-code-block-wrapper', nth: 0 },
    { name: 'evidence-list', selector: '.unsupported-block', nth: 0 },
  ],
  'senderos-s5-extension-e3': [
    { name: 'fig-f4', selector: '.query-block', nth: 0 },
    { name: 'fig-f2', selector: '.query-block', nth: 4 },
  ],
  'senderos-s6-what-failed': [
    { name: 'failed-table', selector: '.query-block', nth: 0 },
  ],
}
/**
 * SENDEROS_MODE=mobile: phone widths 360/390/430 plus landscape; each shot is
 * what the reader SEES (the viewport with the element scrolled to the top of
 * the editor), and each viewport is measured (overflow, gutter, label size…).
 */
const mobile = process.env.SENDEROS_MODE === 'mobile'
const VIEWPORTS: ReadonlyArray<{ name: string; width: number; height: number }> = mobile
  ? [
      { name: 'phone360', width: 360, height: 780 },
      { name: 'phone390', width: 390, height: 844 },
      { name: 'phone430', width: 430, height: 932 },
      { name: 'landscape', width: 844, height: 390 },
    ]
  : [
      { name: 'desktop', width: 1440, height: 920 },
      { name: 'phone', width: 390, height: 844 },
    ]
/** Mobile: viewport shots with the element scrolled to the top of the editor. */
const MOBILE_SHOTS: Record<string, ReadonlyArray<{ name: string; selector: string; nth?: number }>> = {
  'senderos-readme': [
    { name: 'top', selector: 'h1', nth: 0 },
    { name: 'legend', selector: 'h2', nth: 0 },
    { name: 'ladder', selector: '.query-block', nth: 0 },
    { name: 'census', selector: '.query-block', nth: 1 },
    { name: 'weakest', selector: '.query-block', nth: 2 },
    { name: 'mermaid', selector: '.mermaid-code-block-wrapper', nth: 0 },
  ],
  'senderos-s1-work-holonomy': [
    { name: 'math', selector: '.math-block', nth: 0 },
    { name: 'math2', selector: '.math-block', nth: 1 },
    { name: 'mermaid', selector: '.mermaid-code-block-wrapper', nth: 0 },
    { name: 'evidence', selector: 'h3, h2', nth: 1 },
  ],
  'senderos-s5-extension-e3': [
    { name: 'fig-f4', selector: '.query-block', nth: 0 },
    { name: 'fig-f5', selector: '.query-block', nth: 1 },
    { name: 'fig-f2', selector: '.query-block', nth: 4 },
  ],
  'senderos-s6-what-failed': [
    { name: 'failed-table', selector: '.query-block', nth: 0 },
  ],
}

async function viewportShot(page: Page, locator: Locator, file: string): Promise<string> {
  try {
    await locator.evaluate((el) => {
      let scroller: HTMLElement | null = el.parentElement
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) {
        scroller = scroller.parentElement
      }
      if (!scroller) return
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      scroller.scrollTop += top - 12
    })
    await page.locator('mn-top-bar, .organism-mobile-top, header').first().hover({ timeout: 2_000 }).catch(() => undefined)
    await page.waitForTimeout(450)
    await page.screenshot({ path: file, animations: 'disabled' })
    return file
  } catch (error) {
    return `ERROR ${String(error).split('\n')[0]}`
  }
}

/** What a phone reader would notice, measured. */
async function mobileMetrics(page: Page): Promise<Json> {
  return page.evaluate(() => {
    const root = document.querySelector('sh-editor-host')?.shadowRoot
    const pm = root?.querySelector<HTMLElement>('.ProseMirror')
    const vw = window.innerWidth
    if (!pm) return { error: 'no editor' }
    const round = (n: number) => Math.round(n * 10) / 10
    const firstPara = pm.querySelector<HTMLElement>(':scope > p')
    const textLeft = firstPara
      ? firstPara.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(firstPara).paddingLeft)
      : null
    const overflowing = [...pm.querySelectorAll<HTMLElement>(':scope > *, .math-rendered, .query-block, svg, table')]
      .filter(el => el.getClientRects().length > 0)
      .map(el => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => (r.right > vw + 1 || r.left < -1) && !el.closest('.math-rendered[data-math-overflow], .mermaid-preview, .query-block-output'))
      .map(({ el, r }) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} [${round(r.left)}–${round(r.right)}]`)
    const math = [...pm.querySelectorAll<HTMLElement>('.math-block .math-rendered')].map(el => ({
      clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, fontSize: el.style.fontSize || null,
      scrolls: el.hasAttribute('data-math-overflow'),
      left: round(el.getBoundingClientRect().left), right: round(el.getBoundingClientRect().right),
    }))
    const inlineMathOverflow = [...pm.querySelectorAll<HTMLElement>('.math-inline')]
      .filter(el => el.getBoundingClientRect().right > vw + 1).length
    const mermaid = [...pm.querySelectorAll<SVGSVGElement>('.mermaid-preview svg')].map((svg) => {
      const box = svg.viewBox.baseVal
      const scale = box.width ? svg.getBoundingClientRect().width / box.width : 1
      const label = svg.querySelector('text')
      const font = label ? Number.parseFloat(getComputedStyle(label).fontSize) : 0
      return { renderedWidth: round(svg.getBoundingClientRect().width), viewBoxWidth: round(box.width), effectiveLabelPx: round(font * scale), headerVisible: getComputedStyle(svg.closest('.mermaid-code-block-wrapper')!.querySelector('.mermaid-code-block-header')!).visibility !== 'hidden' }
    })
    const charts = [...pm.querySelectorAll<HTMLElement>('.query-block-host-vega')].map((host) => {
      const svg = host.querySelector('svg')
      return { hostWidth: round(host.clientWidth), chartWidth: svg ? round(svg.getBoundingClientRect().width) : 0 }
    })
    const tables = [...pm.querySelectorAll<HTMLElement>('.query-block-host-table')].map(t => ({
      layout: getComputedStyle(t.querySelector('tr') ?? t).display, rows: t.querySelectorAll('tbody tr').length,
      firstRowHeight: round(t.querySelector('tbody tr')?.getBoundingClientRect().height ?? 0),
    }))
    const affordances = [...pm.querySelectorAll<HTMLElement>('.query-block-affordance, .mermaid-affordance')]
      .filter(el => getComputedStyle(el).display !== 'none')
      .map(el => `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`)
    const handles = [...pm.querySelectorAll<HTMLElement>('.outliner-node-button')].slice(0, 1)
      .map(el => `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`)
    const overlaps = (a: DOMRect, b: DOMRect): boolean =>
      a.width > 0 && b.width > 0 && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
    // Follow-ups (2026-09-26): where the ⋯ sits, whether it covers a diagram
    // node, whether a sideways-scrolling figure says so.
    const figures = [...pm.querySelectorAll<HTMLElement>('.mermaid-code-block-wrapper')].map((wrapper) => {
      const preview = wrapper.querySelector<HTMLElement>('.mermaid-preview')!
      const affordance = wrapper.querySelector<HTMLElement>('.mermaid-affordance')
      const shown = affordance && getComputedStyle(affordance).display !== 'none' && affordance.getClientRects().length > 0
      const a = shown ? affordance!.getBoundingClientRect() : null
      const nodes = [...preview.querySelectorAll<SVGGElement>('svg g.node, svg .node')]
        .map(n => n.getBoundingClientRect())
        .filter(r => r.right > preview.getBoundingClientRect().left && r.left < preview.getBoundingClientRect().right)
      const hint = wrapper.querySelector<HTMLElement>('.mermaid-scroll-hint')
      const style = getComputedStyle(preview)
      return {
        scrolls: preview.scrollWidth > preview.clientWidth + 1,
        scrollEdges: preview.getAttribute('data-scroll-edges'),
        fade: (style.maskImage || (style as unknown as Record<string, string>).webkitMaskImage || 'none') !== 'none',
        hint: hint && getComputedStyle(hint).visibility !== 'hidden' && hint.getClientRects().length > 0 ? hint.textContent : null,
        affordance: a ? `${Math.round(a.width)}x${Math.round(a.height)}` : null,
        affordanceAboveFigure: a ? a.bottom <= preview.getBoundingClientRect().top + 8.5 : null,
        affordanceOverNode: a ? nodes.some(r => overlaps(a, r)) : null,
      }
    })
    const queryAffordances = [...pm.querySelectorAll<HTMLElement>('.query-block')].slice(0, 3).map((block) => {
      const affordance = block.querySelector<HTMLElement>('.query-block-affordance')
      if (!affordance || getComputedStyle(affordance).display === 'none' || !affordance.getClientRects().length) return null
      const a = affordance.getBoundingClientRect()
      const title = block.querySelector<HTMLElement>('.query-block-title')?.getBoundingClientRect()
      const output = block.querySelector<HTMLElement>('.query-block-output')?.getBoundingClientRect()
      return {
        size: `${Math.round(a.width)}x${Math.round(a.height)}`,
        // In the bar above: the tap target may reach 6px into the title's line box, never beside its text.
        aboveTitle: title && title.width ? a.bottom <= title.top + 6.5 : null,
        besideTitle: title && title.width ? a.top < title.bottom - 6.5 && a.bottom > title.top + 6.5 : false,
        overOutput: output ? overlaps(a, output) : false,
      }
    })
    const host = document.querySelector('sh-editor-host')
    const mathNode = pm.querySelector<HTMLElement>('.math-node')
    const styles = {
      pointerCoarse: matchMedia('(pointer: coarse)').matches,
      hoverNone: matchMedia('(hover: none)').matches,
      headMathCss: !!document.head.querySelector('[data-mn-math-css]'),
      shadowAdoptedSheets: host?.shadowRoot?.adoptedStyleSheets?.length ?? 0,
      // MATH_CSS says .math-node { cursor: pointer }; it only applies if the sheet reaches the shadow root.
      mathNodeCursor: mathNode ? getComputedStyle(mathNode).cursor : null,
    }
    return {
      viewport: vw,
      textStartsAt: textLeft === null ? null : round(textLeft),
      textStartShare: textLeft === null ? null : round((textLeft / vw) * 100),
      overflowing, math, inlineMathOverflow, mermaid, charts, tables, affordances, bulletHandle: handles,
      figures, queryAffordances, styles,
      listItems: pm.querySelectorAll(':scope > li').length,
    }
  })
}

type Json = Record<string, unknown>

function applyDataFix(doc: Json, fix: Record<string, Json> | undefined): number {
  if (!fix) return 0
  let applied = 0
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { attrs?: Json; content?: unknown[] }
    const id = n.attrs?.['data-block-id']
    if (typeof id === 'string' && fix[id]) {
      Object.assign(n.attrs as Json, fix[id])
      applied += 1
    }
    for (const child of n.content ?? []) walk(child)
  }
  walk(doc)
  return applied
}

/** Every queryBlock's attributes in the stored Y.Doc, keyed by data-block-id. */
function queryBlockAttrs(update: Uint8Array): Record<string, Json> {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, update)
    const out: Record<string, Json> = {}
    for (const child of doc.getXmlFragment('content').toArray()) {
      if (child instanceof Y.XmlElement && child.nodeName === 'queryBlock') {
        const attrs = child.getAttributes() as Json
        out[String(attrs['data-block-id'] ?? `#${Object.keys(out).length}`)] = attrs
      }
    }
    return out
  } finally {
    doc.destroy()
  }
}

async function openDocument(page: Page, id: string): Promise<void> {
  const row = page.locator(`mn-sidebar-panel [data-node-id="${id}"]`)
  // The workspace tree can miss its first load on a cold vite (seen in the touch
  // context): one reload, then the same wait again.
  await row.waitFor({ state: 'visible', timeout: 45_000 })
    .catch(async () => {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await row.waitFor({ state: 'visible', timeout: 60_000 })
    })
  // After a phone viewport the sidebar can come back with the row under the top
  // bar; a real click first, a DOM click on the row if something covers it.
  await row.click({ timeout: 10_000 }).catch(() => row.dispatchEvent('click'))
  await page.waitForFunction((docId) => {
    const host = document.querySelector('sh-editor-host')
    const body = host?.shadowRoot?.querySelector('.ProseMirror')
    return host?.getAttribute('data-document-activation') === 'live'
      && (host?.getAttribute('document-id') === docId || (body?.textContent?.length ?? 0) > 0)
  }, id, { timeout: 30_000 })
}

/** Wait until every query block has run and every chart has settled. */
async function settleQueryBlocks(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const root = document.querySelector('sh-editor-host')?.shadowRoot
    const blocks = [...(root?.querySelectorAll<HTMLElement>('.query-block') ?? [])]
    return blocks.every((b) => {
      const status = b.dataset.status
      if (status !== 'done' && status !== 'error') return false
      const charts = [...b.querySelectorAll<HTMLElement>('[data-visualization-status]')]
      return charts.every(c => c.dataset.visualizationStatus !== 'rendering')
    })
  }, undefined, { timeout: 45_000 }).catch(() => undefined)
  await page.waitForTimeout(600)
}

async function queryBlockReport(page: Page): Promise<Json[]> {
  return page.evaluate(() => {
    const root = document.querySelector('sh-editor-host')?.shadowRoot
    return [...(root?.querySelectorAll<HTMLElement>('.query-block') ?? [])].map((b) => {
      const text = (sel: string): string | null => b.querySelector(sel)?.textContent?.trim() || null
      return {
        blockId: b.getAttribute('data-block-id'),
        status: b.dataset.status ?? null,
        stance: b.dataset.stance ?? null,
        visualization: b.querySelector<HTMLElement>('[data-visualization-mode]')?.dataset.visualizationMode ?? null,
        chartStatus: b.querySelector<HTMLElement>('[data-visualization-status]')?.dataset.visualizationStatus ?? null,
        title: text('.query-block-title'),
        caption: text('.query-block-caption'),
        meta: text('.query-block-host-meta'),
        error: text('.query-block-host-error') ?? text('.query-block-host-vega-error'),
        rows: b.querySelectorAll('tbody tr').length,
        svgMarks: b.querySelectorAll('svg .mark-rect path, svg .mark-symbol path, svg .mark-line path').length,
        visibleNativeControls: [...b.querySelectorAll<HTMLElement>('select, textarea, input, button')]
          .filter(el => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden'
            && Number(getComputedStyle(el).opacity) > 0.05).length,
      }
    })
  })
}

async function shot(locator: Locator, file: string): Promise<string | null> {
  const page = locator.page()
  const viewport = page.viewportSize()
  try {
    // The editor scrolls inside its own container, which clips a tall element:
    // grow the window's height (never its width) until the element fits.
    const height = await locator.evaluate(el => el.getBoundingClientRect().height).catch(() => 0)
    if (viewport && height + 260 > viewport.height) {
      await page.setViewportSize({ width: viewport.width, height: Math.ceil(height + 320) })
      await page.waitForTimeout(400)
    }
    await locator.scrollIntoViewIfNeeded({ timeout: 5_000 })
    // Rest the pointer on the top bar so no block is hovered (the read face).
    if (!file.endsWith('-hover.png')) await page.locator('mn-top-bar').first().hover({ timeout: 3_000 }).catch(() => undefined)
    await page.waitForTimeout(250)
    await locator.screenshot({ path: file, timeout: 10_000, animations: 'disabled' })
    return file
  } catch (error) {
    return `ERROR ${String(error).split('\n')[0]}`
  } finally {
    if (viewport) await page.setViewportSize(viewport)
  }
}

async function setTheme(page: Page, theme: string): Promise<void> {
  const current = await page.evaluate(() => document.documentElement.dataset.theme ?? 'light')
  if (current === theme) return
  // In a touch (isMobile) context at desktop width the app toolbar can overlap the
  // top bar's buttons; fall back to a DOM click on the button itself.
  const toggle = page.locator('mn-top-bar button[aria-label="Toggle theme"]').first()
  await toggle.click({ timeout: 10_000 }).catch(() => toggle.dispatchEvent('click'))
  await page.waitForFunction(t => document.documentElement.dataset.theme === t, theme, { timeout: 10_000 })
  await page.waitForTimeout(400)
}

/** Tap where touch is emulated, click otherwise. */
async function press(page: Page, locator: Locator, touch: boolean): Promise<void> {
  if (touch) await locator.tap({ timeout: 5_000 })
  else await locator.click({ timeout: 5_000 })
}

type Zoom = { mode: string | null; zoom: number; canvas: { width: number; height: number }; stage: { width: number; height: number }; fits: boolean; natural: number | null }
async function readZoom(page: Page): Promise<Zoom | null> {
  return page.evaluate(() => {
    const overlay = document.querySelector<HTMLElement>('.mermaid-fullscreen')
    if (!overlay) return null
    const canvas = overlay.querySelector<HTMLElement>('.mermaid-fullscreen-canvas') ?? overlay.querySelector<HTMLElement>('svg')
    const stage = overlay.querySelector<HTMLElement>('.mermaid-fullscreen-stage')!
    const c = canvas!.getBoundingClientRect()
    const st = stage.getBoundingClientRect()
    const svg = overlay.querySelector<SVGSVGElement>('svg')
    return {
      mode: overlay.dataset.zoomMode ?? null,
      zoom: Number(overlay.dataset.zoom ?? 1),
      canvas: { width: Math.round(c.width), height: Math.round(c.height) },
      stage: { width: Math.round(st.width), height: Math.round(st.height) },
      fits: c.width <= st.width + 1 && c.height <= st.height + 1,
      natural: svg?.viewBox?.baseVal?.width ? Math.round(svg.viewBox.baseVal.width) : null,
    }
  })
}

/**
 * The diagram follow-ups, exercised the way a reader would: open the chrome
 * with the ⋯ (above the figure), scroll the figure, open it full screen (fit),
 * double-tap to 1:1 and back, pinch to zoom (two real touch points via CDP).
 */
async function figureChecks(page: Page, prefix: string, where: Json, touch: boolean): Promise<Json[]> {
  const out: Json[] = []
  const figure = page.locator('sh-editor-host .mermaid-code-block-wrapper').first()
  const preview = figure.locator('.mermaid-preview')
  await viewportShot(page, figure, `${prefix}-mermaid-read.png`)
  const affordance = figure.locator('.mermaid-affordance')
  if (await affordance.isVisible().catch(() => false)) {
    await press(page, affordance, touch).catch(() => undefined)
    await page.waitForTimeout(300)
    const chrome = await figure.evaluate((wrapper) => {
      const header = wrapper.querySelector<HTMLElement>('.mermaid-code-block-header')!
      const h = header.getBoundingClientRect()
      const svg = wrapper.querySelector('.mermaid-preview svg')?.getBoundingClientRect()
      return {
        open: wrapper.hasAttribute('data-chrome-open'),
        headerVisible: getComputedStyle(header).visibility !== 'hidden' && getComputedStyle(header).display !== 'none' && h.height > 0,
        headerOverFigure: !!svg && h.bottom > svg.top + 0.5 && h.top < svg.bottom,
        // The card clips (overflow: hidden) but can still be scrolled: it must not be.
        wrapperScrollLeft: wrapper.scrollLeft,
      }
    })
    out.push({ ...where, what: 'mermaid-chrome-open', ...chrome, file: await viewportShot(page, figure, `${prefix}-mermaid-chrome-open.png`) })
    await press(page, affordance, touch).catch(() => undefined)
    await page.waitForTimeout(200)
  } else {
    out.push({ ...where, what: 'mermaid-chrome-open', affordanceVisible: false })
  }
  // Scrolled to the far side: the fade moves to the start.
  const edges = await preview.evaluate((el) => {
    const before = el.getAttribute('data-scroll-edges')
    el.scrollLeft = el.scrollWidth
    return before
  })
  await page.waitForTimeout(250)
  out.push({
    ...where, what: 'mermaid-scrolled', edgesAtStart: edges,
    edgesAtEnd: await preview.evaluate(el => el.getAttribute('data-scroll-edges')),
    file: await viewportShot(page, figure, `${prefix}-mermaid-scrolled.png`),
  })
  await preview.evaluate((el) => { el.scrollLeft = 0 })
  // Full screen.
  await press(page, preview, touch).catch(() => undefined)
  await page.waitForTimeout(500)
  const opened = await readZoom(page)
  await page.screenshot({ path: `${prefix}-mermaid-fullscreen.png` })
  out.push({ ...where, what: 'mermaid-fullscreen', zoom: opened, file: `${prefix}-mermaid-fullscreen.png` })
  if (opened) {
    const stage = page.locator('.mermaid-fullscreen-stage')
    const box = (await stage.boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + Math.min(box.height / 2, 200)
    if (touch) {
      await page.touchscreen.tap(cx, cy)
      await page.waitForTimeout(60)
      await page.touchscreen.tap(cx, cy)
    } else {
      await page.mouse.dblclick(cx, cy)
    }
    await page.waitForTimeout(400)
    const actual = await readZoom(page)
    await page.screenshot({ path: `${prefix}-mermaid-fullscreen-1to1.png` })
    out.push({ ...where, what: 'mermaid-fullscreen-double-tap', zoom: actual, file: `${prefix}-mermaid-fullscreen-1to1.png` })
    if (touch) {
      await page.touchscreen.tap(cx, cy)
      await page.waitForTimeout(60)
      await page.touchscreen.tap(cx, cy)
      await page.waitForTimeout(400)
      const back = await readZoom(page)
      // Pinch out: two real touch points moving apart.
      const cdp = await page.context().newCDPSession(page)
      const points = (d: number) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(40) })
      for (let d = 50; d <= 120; d += 10) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(d) })
        await page.waitForTimeout(16)
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(300)
      const pinched = await readZoom(page)
      const pageZoom = await page.evaluate(() => window.visualViewport?.scale ?? 1)
      await page.screenshot({ path: `${prefix}-mermaid-fullscreen-pinched.png` })
      out.push({ ...where, what: 'mermaid-fullscreen-pinch', backToFit: back, zoom: pinched, pageZoom, file: `${prefix}-mermaid-fullscreen-pinched.png` })
      await cdp.detach().catch(() => undefined)
    }
  }
  await page.locator('.mermaid-fullscreen-close').click({ timeout: 3_000 }).catch(() => undefined)
  await page.keyboard.press('Escape').catch(() => undefined)
  await page.evaluate(() => document.querySelectorAll('.mermaid-fullscreen').forEach(el => el.remove()))
  return out
}

let cell: GardendCell | null = null
let server: ViteDevServer | null = null
let browser: Browser | null = null
let loopbackPath: string | null = null
const pageErrors: string[] = []
const consoleLines: string[] = []

mkdirSync(outDir, { recursive: true })
try {
  const binary = resolveGardendBin()
  if (!existsSync(binary)) throw new Error(`gardend not found at ${binary}`)
  cell = await spawnGardend({ bin: binary, readyTimeoutMs: 60_000 })
  loopbackPath = join(cell.profileDir, 'vite-loopback.json')
  process.env.GARDEND_LOOPBACK_MANIFEST = loopbackPath
  await createGraphAndSeedUxConfig(cell, graphId, readFileSync(seedPath, 'utf8'), 'senderos (local copy)')
  const mcp = new LoopbackMcpClient({
    mcpUrl: cell.mcpUrl, healthUrl: `${cell.apiUrl}/health`, token: cell.token, origin: 'http://127.0.0.1',
  })

  const loads: Json[] = []
  for (const [file, target] of RDF_LOADS) {
    const data = readFileSync(join(w1, file), 'utf8')
    await mcp.toolsCall('rdf_load', { graphId, data, format: 'turtle', targetGraphIri: target })
    loads.push({ file, target, bytes: data.length })
  }
  const counts = await mcp.toolsCall('sparql_query', {
    graphId,
    query: 'SELECT ?g (COUNT(*) AS ?n) WHERE { GRAPH ?g { ?s ?p ?o } FILTER(STRSTARTS(STR(?g), "urn:mnemosyne:local:graph:senderos:")) } GROUP BY ?g ORDER BY ?g',
  })

  const dataFix = dataFixPath ? JSON.parse(readFileSync(dataFixPath, 'utf8')) as Record<string, Record<string, Json>> : undefined
  const seeded: Json[] = []
  const beforeAttrs: Record<string, Record<string, Json>> = {}
  for (const [index, id] of DOCS.entries()) {
    const payload = JSON.parse(readFileSync(join(w1, '16-documents', `${id}.json`), 'utf8')) as Json
    const tiptap = (typeof payload.tiptapJson === 'string' ? JSON.parse(payload.tiptapJson) : payload.tiptapJson) as Json
    const fixed = applyDataFix(tiptap, dataFix?.[id])
    const { incarnation } = await mcp.workspaceSnapshot(graphId)
    await mcp.toolsCall('create_document_once', {
      graph_id: graphId, document_id: id, title: payload.title, order: index,
      tiptapJson: tiptap, graph_incarnation: incarnation,
    })
    beforeAttrs[id] = queryBlockAttrs(await mcp.documentUpdate(graphId, id))
    seeded.push({ id, title: payload.title, dataFixApplied: fixed })
  }

  // Diagnostics: SENDEROS_SPARQL_PROBE=<file.rq> runs that SELECT through the cell's MCP and exits.
  if (process.env.SENDEROS_SPARQL_PROBE) {
    const probe = readFileSync(process.env.SENDEROS_SPARQL_PROBE, 'utf8')
    console.log(JSON.stringify(await mcp.toolsCall('sparql_query', { graphId, query: probe }).catch(e => String(e)), null, 2).slice(0, 6000))
    // No browser or vite server exists yet at this point: only the cell to stop.
    await cell?.kill().catch(() => undefined)
    process.exit(0)
  }
  writeFileSync(loopbackPath, JSON.stringify({
    apiUrl: cell.apiUrl, mcpUrl: cell.mcpUrl, token: cell.token, port: cell.manifest.port, graphId,
  }, null, 2))
  server = await createServer({
    root: appDir,
    configFile: resolve(appDir, 'vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
    logLevel: 'warn',
  })
  await server.listen()
  browser = await chromium.launch({ headless: process.env.SHRUBBERY_HEADED !== '1' })
  const touch = mobile && process.env.SENDEROS_TOUCH !== '0'
  const context = await browser.newContext({
    viewport: { width: 1440, height: 920 }, deviceScaleFactor: 2,
    // A phone: coarse pointer, no hover, touch events.
    ...(touch ? { isMobile: true, hasTouch: true } : {}),
  })
  // tsx keeps function names with an `__name` helper that page.evaluate bodies cannot see.
  await context.addInitScript('globalThis.__name = (fn) => fn')
  const page = await context.newPage()
  page.on('pageerror', e => pageErrors.push(e.stack ?? e.message))
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleLines.push(`${m.type()}: ${m.text()}`) })
  await page.goto(`http://127.0.0.1:${port}/?source=cell&graph=${encodeURIComponent(graphId)}`, { waitUntil: 'domcontentloaded' })

  // Diagnostics: SENDEROS_PROBE=<file.js> evaluates that expression in the page after
  // opening the readme, prints the result, and skips the screenshot pass.
  if (process.env.SENDEROS_PROBE) {
    await openDocument(page, process.env.SENDEROS_PROBE_DOC ?? 'senderos-readme')
    await settleQueryBlocks(page)
    const [pw, ph] = (process.env.SENDEROS_PROBE_VIEWPORT ?? '').split('x').map(Number)
    if (pw && ph) {
      await page.setViewportSize({ width: pw, height: ph })
      await page.waitForTimeout(1500)
    }
    if (process.env.SENDEROS_PROBE_PRE) await page.evaluate(readFileSync(process.env.SENDEROS_PROBE_PRE, 'utf8'))
    if (process.env.SENDEROS_PROBE_CLICK) {
      await page.locator(`sh-editor-host ${process.env.SENDEROS_PROBE_CLICK}`).first().click()
      await page.waitForTimeout(400)
    }
    const probe = readFileSync(process.env.SENDEROS_PROBE, 'utf8')
    console.log(JSON.stringify(await page.evaluate(probe), null, 2))
    await browser?.close().catch(() => undefined)
    await server?.close().catch(() => undefined)
    await cell?.kill().catch(() => undefined)
    process.exit(0)
  }
  const screens: Json[] = []
  const metrics: Json[] = []
  const blocks: Record<string, Json[]> = {}
  for (const theme of themes) {
    await page.setViewportSize({ width: 1440, height: 920 })
    await setTheme(page, theme)
    for (const id of Object.keys(SHOTS)) {
      await page.setViewportSize({ width: 1440, height: 920 })
      await openDocument(page, id)
      await settleQueryBlocks(page)
      if (theme === themes[0]) blocks[id] = await queryBlockReport(page)
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.waitForTimeout(700)
        await settleQueryBlocks(page)
        const prefix = join(outDir, `${label}-${theme}-${viewport.name}-${id.replace('senderos-', '')}`)
        const editor = page.locator('sh-editor-host .ProseMirror').first()
        await editor.evaluate(el => {
          let n: HTMLElement | null = el as HTMLElement
          while (n && n.scrollHeight <= n.clientHeight + 1) n = n.parentElement
          if (n) n.scrollTop = 0
        }).catch(() => undefined)
        if (mobile) {
          metrics.push({ theme, viewport: viewport.name, doc: id, ...(await mobileMetrics(page)) })
          for (const s of MOBILE_SHOTS[id] ?? []) {
            const locator = page.locator(`sh-editor-host .ProseMirror ${s.selector}`).nth(s.nth ?? 0)
            screens.push({ theme, viewport: viewport.name, doc: id, what: s.name, file: await viewportShot(page, locator, `${prefix}-${s.name}.png`) })
          }
          if (id === 'senderos-readme' && viewport.name === 'phone390') {
            const ladder = page.locator('sh-editor-host .query-block').nth(0)
            await viewportShot(page, ladder, `${prefix}-ladder-scrolled.png`)
            const tapError = await ladder.locator('.query-block-affordance').tap({ timeout: 5_000 })
              .then(() => null)
              .catch(async () => ladder.locator('.query-block-affordance').click({ timeout: 5_000 }).then(() => 'tap unsupported; clicked').catch(e => String(e).split('\n')[0]))
            await page.waitForTimeout(300)
            const chromeOpen = await ladder.evaluate(el => el.hasAttribute('data-chrome-open'))
            screens.push({ theme, viewport: viewport.name, doc: id, what: 'ladder-chrome-open', tapError, chromeOpen, file: await viewportShot(page, ladder, `${prefix}-ladder-chrome-open.png`) })
            // Close it the way a reader would: a tap outside the block.
            await page.locator('sh-editor-host .ProseMirror > h2').first().tap({ timeout: 3_000 })
              .catch(() => page.locator('sh-editor-host .ProseMirror > h2').first().click({ timeout: 3_000 })).catch(() => undefined)
            const closedByOutsideTap = await ladder.evaluate(el => !el.hasAttribute('data-chrome-open'))
            screens.push({ theme, viewport: viewport.name, doc: id, what: 'ladder-chrome-closed-by-outside-tap', closedByOutsideTap, file: null })
            await ladder.evaluate(() => {
              const active = (document.querySelector('sh-editor-host')?.shadowRoot?.activeElement ?? document.activeElement) as HTMLElement | null
              active?.blur()
            })
          }
          if (id === 'senderos-s1-work-holonomy' && (viewport.name === 'phone390' || viewport.name === 'landscape')) {
            screens.push(...await figureChecks(page, prefix, { theme, viewport: viewport.name, doc: id }, touch))
          }
          continue
        }
        await page.screenshot({ path: `${prefix}-page.png` })
        screens.push({ theme, viewport: viewport.name, doc: id, what: 'page', file: `${prefix}-page.png` })
        for (const s of SHOTS[id]) {
          const locator = page.locator(`sh-editor-host ${s.selector}`).nth(s.nth ?? 0)
          const file = await shot(locator, `${prefix}-${s.name}.png`)
          screens.push({ theme, viewport: viewport.name, doc: id, what: s.name, file })
        }
        if (id === 'senderos-readme' && viewport.name === 'desktop') {
          const ladder = page.locator('sh-editor-host .query-block').nth(0)
          await ladder.scrollIntoViewIfNeeded()
          await ladder.hover()
          await page.waitForTimeout(400)
          screens.push({ theme, viewport: viewport.name, doc: id, what: 'ladder-hover', file: await shot(ladder, `${prefix}-ladder-hover.png`) })
          const census = page.locator('sh-editor-host .query-block').nth(1)
          await census.hover()
          await page.waitForTimeout(400)
          screens.push({ theme, viewport: viewport.name, doc: id, what: 'census-hover', file: await shot(census, `${prefix}-census-hover.png`) })
          await page.mouse.move(2, 2)
          await page.waitForTimeout(300)
        }
      }
    }
  }

  // Read must never write: every stored query-block attribute is unchanged after all the opens.
  const drift: Json[] = []
  for (const id of DOCS) {
    const after = queryBlockAttrs(await mcp.documentUpdate(graphId, id))
    for (const [blockId, attrs] of Object.entries(beforeAttrs[id] ?? {})) {
      for (const key of new Set([...Object.keys(attrs), ...Object.keys(after[blockId] ?? {})])) {
        if (JSON.stringify(attrs[key]) !== JSON.stringify(after[blockId]?.[key])) {
          drift.push({ doc: id, blockId, key, before: attrs[key], after: after[blockId]?.[key] })
        }
      }
    }
  }

  const report = {
    label, binary, graphId, w1, dataFix: dataFixPath ?? null, loads, namedGraphCounts: counts, seeded,
    queryBlocks: blocks, openWroteQueryBlockAttrs: drift, screens, metrics, pageErrors,
    consoleSample: consoleLines.slice(0, 40),
  }
  writeFileSync(join(outDir, `${label}-report.json`), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ label, queryBlocks: blocks, drift, pageErrors: pageErrors.length, screens: screens.length }, null, 2))
} finally {
  await browser?.close().catch(() => undefined)
  await server?.close().catch(() => undefined)
  if (loopbackPath && existsSync(loopbackPath)) unlinkSync(loopbackPath)
  await cell?.kill().catch(() => undefined)
}
