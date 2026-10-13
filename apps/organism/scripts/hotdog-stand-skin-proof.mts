/**
 * Visual proof for the Hotdog Stand skin — the real organism (home, a document, the launcher, a floating
 * menu and toast, Settings → Appearance), light and "After Hours" dark, each next to skin-98.
 *
 * Second pass (2026-10-03), what it witnesses beyond the palette:
 *   - the page is the faithful red Window with white ink, INSET on the yellow desk at every width
 *     (gutters measured at five viewports), carrying a specimen document (heading, links, quote, code,
 *     table, outliner children) with no ink left over;
 *   - the chat bar is the Inactive Title Bar, the sidebar lists are Window on Window Text, silver stays
 *     on toolbars, status bar, buttons and scrollbars, and the shadow-DOM controls are bevelled
 *     (computed style, not CSS text);
 *   - the AA exception, measured from what is drawn: every visible text run against its effective
 *     background — below 4.5:1 only on Window red and never below 3:1 in light, nowhere in dark or under
 *     prefers-contrast: more; skin-98 audited beside it as the control;
 *   - the skin picker, exercised in the real organism with real key presses and clicks: keyboard,
 *     mouse, Escape, a bogus event, persistence across a reload; on a phone (where the bar has always
 *     folded its skin control) the Settings → Appearance drop-down reaches the skin; between 601 and
 *     768px the mobile shell's mirrored header shows the picker and its choice reaches the shell; and
 *     the picker open in all six skins, light and dark (a contact sheet each);
 *   - the chat composer with a draft in it (the live send button, in the accent), audited too;
 *   - the leak audit: every drawn colour is a value of the skin's own roles, black or white; the one
 *     exception it names is the graph view's fixed #2a3328 canvas, which paints the same in every skin.
 * It also renders the palette (the 21 Windows slots, from the live cascade) and writes the resolved
 * colours and their WCAG ratios, measured from the browser, to contrast.json. Exit code 1 if anything
 * above fails.
 *
 *   HDS_SKIN_OUT=/path node --import tsx scripts/hotdog-stand-skin-proof.mts
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { HOTDOG_STAND_CONTROL_INI, HOTDOG_STAND_PALETTE } from '@shrubbery/tokens'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.HDS_SKIN_OUT ?? '/private/tmp/hotdog-stand-skin'
const SKIN = 'hotdog-stand'

type Theme = 'light' | 'dark'

async function frames(page: Page): Promise<void> {
  await page.waitForTimeout(260)
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
}

async function setSkin(page: Page, skin: string | null, theme: Theme): Promise<void> {
  await page.evaluate(([s, t]) => {
    for (const el of [document.documentElement, document.body, document.querySelector<HTMLElement>('#harness-root'), document.querySelector<HTMLElement>('#settings-harness-root')]) {
      if (!el) continue
      if (s) el.dataset.skin = s
      else el.removeAttribute('data-skin')
      el.dataset.theme = t
    }
    for (const bar of document.querySelectorAll<HTMLElement & { activeSkin?: string; isDark?: boolean }>('mn-top-bar, mn-app-bar')) {
      bar.activeSkin = s ?? 'garden'
      bar.isDark = t === 'dark'
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

const TEXT = ['text-primary', 'text-secondary', 'text-tertiary', 'text-muted', 'text-quiet', 'text-title', 'text-accent', 'text-accent-strong', 'text-link', 'text-link-hover', 'text-danger', 'text-warning', 'text-success']
const SURFACES = ['surface-canvas', 'surface-base', 'surface-editor', 'surface-panel', 'surface-chrome', 'surface-raised', 'surface-elevated', 'surface-overlay', 'surface-subtle', 'surface-warm', 'surface-sunken', 'surface-accent', 'surface-accent-strong']
const PAIRS: Array<[string, string]> = [
  ['top-bar-text', 'top-bar-bg'], ['top-bar-text-muted', 'top-bar-bg'],
  ['bottom-bar-text', 'bottom-bar-bg'], ['bottom-bar-text-muted', 'bottom-bar-bg'],
  ['color-text-on-accent', 'color-accent'], ['color-text-on-accent', 'color-accent-hover'], ['color-text-on-accent', 'color-accent-active'],
  ['color-on-danger', 'color-action-danger'], ['color-on-warning', 'color-action-warning'],
  ['color-text-danger', 'color-danger-surface'], ['color-warning', 'color-warning-surface'],
  ['color-success', 'color-success-surface'], ['color-info', 'color-info-surface'],
]

async function resolvedColours(page: Page): Promise<Record<string, string>> {
  const names = [...TEXT.map(n => `color-${n}`), ...SURFACES.map(n => `color-${n}`), ...PAIRS.flat()]
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
  const canvas = parse(c['color-surface-canvas'])
  const solid = (n: string, host: Rgba = canvas) => over(parse(c[n]), host)
  const rows: Array<{ fg: string; bg: string; ratio: number; aa: boolean }> = []
  for (const t of TEXT) for (const s of SURFACES) {
    const bg = solid(`color-${s}`)
    const r = ratio(solid(`color-${t}`, bg), bg)
    rows.push({ fg: `color-${t}`, bg: `color-${s}`, ratio: r, aa: r >= 4.5 })
  }
  for (const [fg, bgName] of PAIRS) {
    const bg = solid(bgName)
    const r = ratio(solid(fg, bg), bg)
    rows.push({ fg, bg: bgName, ratio: r, aa: r >= 4.5 })
  }
  return rows
}

/** The palette, rendered from the live cascade: slots → hex (as the browser resolves them) and the INI value. */
async function paletteSheet(page: Page, theme: Theme, iniLine: string, label: string, path: string): Promise<void> {
  const slots = [
    ['desktop', 'Desktop'], ['workspace', 'Application Workspace'], ['window', 'Window'], ['window-text', 'Window Text'],
    ['menu', 'Menu Bar'], ['menu-text', 'Menu Text'], ['caption', 'Active Title Bar'], ['caption-inactive', 'Inactive Title Bar'],
    ['caption-text', 'Title Bar Text'], ['border-active', 'Active Border'], ['border-inactive', 'Inactive Border'], ['frame', 'Window Frame'],
    ['scrollbar', 'Scroll Bars'], ['face', 'Button Face'], ['shadow', 'Button Shadow'], ['button-text', 'Button Text'],
    ['gray-text', 'Gray Text'], ['highlight', 'Highlight'], ['highlight-text', 'Highlighted Text'], ['caption-text-inactive', 'Inactive Title Bar Text'],
    ['light', 'Button Highlight'],
  ] as const
  const values = iniLine.split('=')[1].split(',')
  await setSkin(page, SKIN, theme)
  await page.evaluate(([list, ini, heading, vals]) => {
    document.getElementById('hds-palette')?.remove()
    const cs = getComputedStyle(document.documentElement)
    const hex = (name: string) => {
      const probe = document.createElement('i')
      probe.style.color = cs.getPropertyValue(name)
      document.body.append(probe)
      const m = getComputedStyle(probe).color.match(/\d+/g)!.map(Number)
      probe.remove()
      return `#${m.slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('')}`
    }
    const root = document.createElement('div')
    root.id = 'hds-palette'
    root.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;padding:28px 36px;box-sizing:border-box;font:13px/1.35 ui-monospace,Menlo,monospace;'
      + 'background:var(--mn-color-surface-canvas);color:var(--mn-color-text-primary)'
    const rows = (list as readonly (readonly [string, string])[]).map(([suffix, name], i) => {
      const value = hex(`--mn-hds-${suffix}`)
      const ink = (v: string) => { const n = parseInt(v.slice(1), 16); const l = ((n >> 16) * 0.2126 + ((n >> 8) & 255) * 0.7152 + (n & 255) * 0.0722); return l > 140 ? '#000' : '#fff' }
      return `<div style="display:grid;grid-template-columns:34px 190px 70px 78px 1fr;align-items:center;gap:10px;padding:3px 0">`
        + `<span>${i + 1}</span><span style="font-family:var(--mn-font-chrome)">${name}</span>`
        + `<span>${(vals as string[])[i]}</span><span>${value}</span>`
        + `<span style="display:block;height:22px;background:${value};border:1px solid var(--mn-color-border-strong);color:${ink(value)};padding:2px 8px;box-sizing:border-box">--mn-hds-${suffix}</span></div>`
    }).join('')
    root.innerHTML = `<div style="max-width:880px;margin:0 auto;padding:18px 22px;background:var(--mn-color-surface-base);border:2px solid var(--mn-color-border-strong);box-shadow:4px 4px 0 var(--mn-color-border-strong)">`
      + `<div style="font:700 15px var(--mn-font-chrome)">${heading}</div>`
      + `<div style="margin:8px 0 14px;word-break:break-all;color:var(--mn-color-text-secondary)">${ini}</div>${rows}</div>`
    document.body.append(root)
  }, [slots, iniLine, label, values] as const)
  await frames(page)
  await page.screenshot({ path })
  await page.evaluate(() => document.getElementById('hds-palette')?.remove())
}

/**
 * Leak audit: walk the rendered UI (piercing open shadow roots) and report every drawn colour — text,
 * fill, drawn borders, outlines, svg paint — that is not in the skin's own vocabulary: the value of
 * one of the roles the skin file declares, a literal inside one, or black/white/transparent. This is
 * "nothing falls through to another skin", measured on pixels' worth of computed style, not on CSS text.
 */
async function leakAudit(page: Page, roleNames: string[]): Promise<Array<{ colour: string; count: number; where: string[] }>> {
  return page.evaluate((roles) => {
    const cs = getComputedStyle(document.documentElement)
    const norm = (c: string) => {
      const m = c.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[, /]+([\d.]+))?\)/)
      return m ? [Math.round(Number(m[1])), Math.round(Number(m[2])), Math.round(Number(m[3])), m[4] === undefined ? 1 : Number(m[4])] as const : null
    }
    const probe = document.createElement('i')
    document.body.append(probe)
    const known = new Set<string>()
    const add = (value: string) => {
      probe.style.color = ''
      probe.style.color = value
      const n = norm(getComputedStyle(probe).color)
      if (n) known.add(n.slice(0, 3).join(','))
    }
    for (const r of roles) {
      const v = cs.getPropertyValue(r).trim()
      if (!v) continue
      add(v)
      for (const m of v.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|color-mix\([^)]*\)/gi)) add(m[0])
    }
    for (const v of ['#000', '#fff', 'transparent']) add(v)
    probe.remove()
    const props = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'fill', 'stroke', 'textDecorationColor'] as const
    const offenders = new Map<string, { count: number; where: string[] }>()
    const seen = new WeakSet<object>()
    const visit = (root: Document | ShadowRoot, path: string) => {
      for (const el of root.querySelectorAll('*')) {
        if (seen.has(el)) continue
        seen.add(el)
        if (el.shadowRoot) visit(el.shadowRoot, `${path}>${el.localName}`)
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        const style = getComputedStyle(el) as unknown as Record<string, string>
        for (const p of props) {
          const v = style[p]
          const n = typeof v === 'string' ? norm(v) : null
          if (!n || n[3] === 0) continue
          if (p.startsWith('border') && (style[p.replace('Color', 'Style')] === 'none' || parseFloat(style[p.replace('Color', 'Width')]) === 0)) continue
          if (p === 'outlineColor' && (style.outlineStyle === 'none' || parseFloat(style.outlineWidth) === 0)) continue
          if ((p === 'fill' || p === 'stroke') && !(el instanceof SVGElement)) continue
          if (p === 'textDecorationColor' && style.textDecorationLine === 'none') continue
          if (known.has(n.slice(0, 3).join(','))) continue
          const key = `${p}: rgb(${n.slice(0, 3).join(',')})${n[3] < 1 ? ` alpha ${n[3]}` : ''}`
          const entry = offenders.get(key) ?? { count: 0, where: [] }
          entry.count++
          if (entry.where.length < 3) entry.where.push(`${path}>${el.localName}${typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : ''}`)
          offenders.set(key, entry)
        }
      }
    }
    visit(document, 'doc')
    return [...offenders].map(([colour, v]) => ({ colour, ...v })).sort((a, b) => b.count - a.count)
  }, roleNames)
}


/**
 * The graph view paints a fixed #2a3328 canvas (mn-graph-panel.ts `.body`, mn-graph-three.ts GARDEN_BACKGROUND) in EVERY skin,
 * on purpose: it is a data view, not chrome. It is not Hotdog Stand's to repaint (the brief: no other skin's code), so the audit
 * names it and sets it apart instead of counting it as a leak; anything else off-vocabulary is a failure.
 */
type Leak = { colour: string; count: number; where: string[] }
const GRAPH_CANVAS = { colour: 'backgroundColor: rgb(42,51,40)', where: 'doc>sh-graph-host>mn-graph-panel>div.body' } as const
const skinIndependentCanvas: Record<string, Leak[]> = {}

async function leakAuditSplit(page: Page, key: string): Promise<Leak[]> {
  const all = await leakAudit(page, SKIN_ROLES)
  const canvas = all.filter(l => l.colour === GRAPH_CANVAS.colour && l.where.every(w => w === GRAPH_CANVAS.where))
  if (canvas.length) skinIndependentCanvas[key] = canvas
  const leaks = all.filter(l => !canvas.includes(l))
  for (const l of leaks) failures.push(`leak audit ${key}: ${l.colour} x${l.count} at ${l.where.join(' | ')}`)
  return leaks
}

// ── The page's contents: a specimen document with every kind of ink the red Window must carry ──────────

const SPECIMEN = (() => {
  const t = (text: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>) => ({ type: 'text', text, ...(marks ? { marks } : {}) })
  const para = (id: string, content: unknown[], indent = 0) => ({ type: 'paragraph', attrs: { indent, collapsed: false, 'data-block-id': id }, content })
  const head = (id: string, level: number, text: string) => ({ type: 'heading', attrs: { level, indent: 0, collapsed: false, 'data-block-id': id }, content: [t(text)] })
  return {
    type: 'doc',
    content: [
      head('s-h1', 1, 'Hotdog Stand specimen'),
      para('s-p1', [t('Body text, with '), t('bold', [{ type: 'bold' }]), t(', '), t('italic', [{ type: 'italic' }]), t(', '), t('inline code', [{ type: 'code' }]),
        t(', a '), t('link to the INI', [{ type: 'link', attrs: { href: 'https://example.com/control.ini' } }]), t(' and '), t('a highlight', [{ type: 'highlight' }]), t('.')]),
      head('s-h2', 2, 'A second-level heading'),
      para('s-p2', [t('Outliner children are paragraphs with an indent:')]),
      para('s-p3', [t('first child, one level in')], 1),
      para('s-p4', [t('grandchild, two levels in, with '), t('a link', [{ type: 'link', attrs: { href: 'https://example.com/x' } }])], 2),
      head('s-h3', 3, 'A third-level heading'),
      { type: 'blockquote', content: [para('s-q', [t('A quotation: Windows 3.1 shipped a colour scheme called Hotdog Stand.')])] },
      { type: 'codeBlock', attrs: { language: null }, content: [t('Hotdog Stand=FFFF,FFFF,FF,FFFFFF,FFFFFF,0,0,FF,FFFFFF,FF,FF,0,C0C0C0,C0C0C0,808080,0,808080,0,FFFFFF,FFFFFF,FFFFFF')] },
      { type: 'table', content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [para('th1', [t('Slot')])] },
          { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [para('th2', [t('Colour')])] }] },
        { type: 'tableRow', content: [
          { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [para('td1', [t('Window')])] },
          { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [para('td2', [t('red')])] }] },
      ] },
      para('s-p5', [t('A closing paragraph, secondary in tone but not in colour: the scheme has one Window Text.')]),
    ],
  }
})()

/** Replace the open document's content (client-side only: the in-memory cell, no write to anything real). */
async function loadSpecimen(page: Page): Promise<void> {
  const result = await page.evaluate((doc) => {
    const host = document.querySelector('sh-editor-host') as (HTMLElement & { _editor?: { commands: { setContent(content: unknown, emitUpdate?: boolean): boolean } } }) | null
    if (!host?._editor) return 'the editor is not mounted'
    try { host._editor.commands.setContent(doc, false); return 'ok' } catch (e) { return `setContent failed: ${(e as Error).message}` }
  }, SPECIMEN)
  if (result !== 'ok') throw new Error(`specimen: ${result}`)
  await frames(page)
}

// ── Contrast, measured from what is drawn: every visible text node against its effective background ───────

interface AuditRow { fg: string; bg: string; ratio: number; count: number; sample: string[]; where: string }
interface TextAudit { total: number; skipped: { hidden: number; gradient: number; disabled: number }; minRatio: number; below45: AuditRow[]; surfaces: Array<{ bg: string; count: number; minRatio: number }> }

/**
 * Walk the rendered UI (piercing open shadow roots), take every visible text node and every input's
 * placeholder, and measure its colour against the composited background it actually sits on — walking
 * up through shadow boundaries until an opaque layer. Hidden, zero-size and disabled things are
 * skipped (and counted); a gradient or image behind the text is counted, not guessed at.
 */
async function textAudit(page: Page): Promise<TextAudit> {
  return page.evaluate(() => {
    type RGBA = [number, number, number, number]
    const parse = (css: string): RGBA | null => {
      let m = css.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[, /]+([\d.]+))?\)/)
      if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]
      m = css.match(/color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)/)
      if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] === undefined ? 1 : Number(m[4])]
      return null
    }
    const lum = ([r, g, b]: RGBA): number => {
      const l = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
      return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b)
    }
    const over = (f: RGBA, b: RGBA): RGBA => [f[0] * f[3] + b[0] * (1 - f[3]), f[1] * f[3] + b[1] * (1 - f[3]), f[2] * f[3] + b[2] * (1 - f[3]), 1]
    const ratio = (a: RGBA, b: RGBA): number => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
    const parentOf = (n: Node): Element | null => {
      const p = (n as Element).parentElement
      if (p) return p
      const root = n.getRootNode()
      return root instanceof ShadowRoot ? root.host : null
    }
    const skipped = { hidden: 0, gradient: 0, disabled: 0 }
    const isDisabled = (el: Element): boolean => {
      for (let n: Element | null = el; n; n = parentOf(n)) {
        if ((n as HTMLButtonElement).disabled === true || n.getAttribute('aria-disabled') === 'true') return true
      }
      return false
    }
    const effectiveBg = (el: Element): RGBA | 'gradient' => {
      const layers: RGBA[] = []
      for (let n: Element | null = el; n; n = parentOf(n)) {
        const cs = getComputedStyle(n)
        if (cs.backgroundImage !== 'none') return 'gradient'
        const bg = parse(cs.backgroundColor)
        if (bg && bg[3] > 0) { layers.push(bg); if (bg[3] === 1) break }
      }
      let base: RGBA = [255, 255, 255, 1]
      for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base)
      return base
    }
    const opacityOf = (el: Element): number => {
      let o = 1
      for (let n: Element | null = el; n; n = parentOf(n)) o *= Number(getComputedStyle(n).opacity)
      return o
    }
    const targets: Array<{ el: Element; fg: string; label: string }> = []
    const walk = (root: Document | ShadowRoot): void => {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
      for (let n: Node | null = tw.nextNode(); n; n = tw.nextNode()) {
        if (n.nodeType === 1) {
          const el = n as Element
          if (el.shadowRoot) walk(el.shadowRoot)
          if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.placeholder && !el.value) {
            targets.push({ el, fg: getComputedStyle(el, '::placeholder').color, label: `placeholder:${el.placeholder}` })
          }
        } else if (n.nodeType === 3 && (n.textContent ?? '').trim()) {
          const el = n.parentElement
          if (!el || el.closest('svg, style, script, option, noscript')) continue
          targets.push({ el, fg: getComputedStyle(el).color, label: (n.textContent ?? '').trim().slice(0, 40) })
        }
      }
    }
    walk(document)
    const groups = new Map<string, AuditRow>()
    const bySurface = new Map<string, { count: number; minRatio: number }>()
    let total = 0
    let minRatio = Infinity
    const nameOf = (el: Element): string => {
      const parts: string[] = []
      for (let n: Element | null = el, i = 0; n && i < 4; n = parentOf(n), i++) parts.unshift(`${n.localName}${typeof n.className === 'string' && n.className ? `.${n.className.split(' ')[0]}` : ''}`)
      return parts.join('>')
    }
    for (const { el, fg: fgCss, label } of targets) {
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || style.display === 'none' || opacityOf(el) === 0) { skipped.hidden++; continue }
      if (isDisabled(el)) { skipped.disabled++; continue }
      const bg = effectiveBg(el)
      if (bg === 'gradient') { skipped.gradient++; continue }
      const fg = parse(fgCss)
      if (!fg || fg[3] === 0) continue
      const op = opacityOf(el)
      const painted = over([fg[0], fg[1], fg[2], fg[3] * op], bg)
      const r = Math.round(ratio(painted, bg) * 100) / 100
      total++
      minRatio = Math.min(minRatio, r)
      const bgKey = `rgb(${bg.slice(0, 3).map(Math.round).join(', ')})`
      const surface = bySurface.get(bgKey) ?? { count: 0, minRatio: Infinity }
      surface.count++
      surface.minRatio = Math.min(surface.minRatio, r)
      bySurface.set(bgKey, surface)
      if (r >= 4.5) continue
      const fgKey = `rgb(${painted.slice(0, 3).map(Math.round).join(', ')})`
      const key = `${fgKey}|${bgKey}|${r}`
      const row = groups.get(key) ?? { fg: fgKey, bg: bgKey, ratio: r, count: 0, sample: [], where: nameOf(el) }
      row.count++
      if (row.sample.length < 4) row.sample.push(label)
      groups.set(key, row)
    }
    return {
      total,
      skipped,
      minRatio: Math.round(minRatio * 100) / 100,
      below45: [...groups.values()].sort((a, b) => a.ratio - b.ratio),
      surfaces: [...bySurface].map(([bg, v]) => ({ bg, count: v.count, minRatio: v.minRatio })).sort((a, b) => a.minRatio - b.minRatio),
    }
  })
}

/** The exception is exactly Window red: below 4.5 only on it, never below the 3:1 floor, and nowhere at all after hours or under more contrast. */
function judgeAudit(audit: TextAudit, exception: 'window-red' | 'none'): { ok: boolean; exempt: number; violations: AuditRow[] } {
  const exempt = audit.below45.filter(r => exception === 'window-red' && r.bg === 'rgb(255, 0, 0)' && r.ratio >= 3)
  const violations = audit.below45.filter(r => !exempt.includes(r))
  return { ok: violations.length === 0, exempt: exempt.reduce((n, r) => n + r.count, 0), violations }
}

// ── Probes: computed style of the things the second pass set out to change ───────────────────────────────

interface Probe { name: string; expect: string; got: string; ok: boolean }

async function probes(page: Page, theme: Theme): Promise<Probe[]> {
  const dark = theme === 'dark'
  const window = dark ? 'rgb(128, 0, 0)' : 'rgb(255, 0, 0)'
  const got = await page.evaluate(() => {
    const deep = (selector: string, root: Document | ShadowRoot = document): Element[] => {
      const out: Element[] = [...root.querySelectorAll(selector)]
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...deep(selector, el.shadowRoot))
      return out
    }
    const css = (el: Element | undefined, ...props: string[]): Record<string, string> => {
      if (!el) return Object.fromEntries(props.map(p => [p, 'MISSING']))
      const s = getComputedStyle(el) as unknown as Record<string, string>
      return Object.fromEntries(props.map(p => [p, s[p]]))
    }
    const rect = (el: Element | undefined) => el ? el.getBoundingClientRect() : null
    const button = deep('mn-button').map(b => b.shadowRoot?.querySelector('button')).find(b => b && rect(b)!.width > 0) ?? undefined
    const mount = document.querySelector('sh-editor-host')?.shadowRoot?.querySelector('.editor-mount') ?? undefined
    const page = mount?.querySelector('.ProseMirror') ?? undefined
    const h1 = page?.querySelector('h1') ?? undefined
    const chat = deep('sh-chat-panel')[0]
    const superbar = chat?.querySelector('.super-bar') ?? chat?.shadowRoot?.querySelector('.super-bar') ?? undefined
    const send = chat?.querySelector('.send-button') ?? chat?.shadowRoot?.querySelector('.send-button') ?? undefined
    const sidebar = deep('mn-sidebar-panel')[0]
    const body = sidebar?.shadowRoot?.querySelector('.section-body') ?? undefined
    const active = sidebar?.shadowRoot?.querySelector('.tree-row.active') ?? undefined
    const header = sidebar?.shadowRoot?.querySelector('.section-header') ?? undefined
    const bottom = deep('mn-bottom-bar')[0]
    return {
      button: css(button, 'borderRadius', 'boxShadow'),
      mount: css(mount, 'backgroundColor'),
      page: css(page, 'backgroundColor', 'color'),
      h1: css(h1, 'color'),
      superbar: css(superbar, 'backgroundColor', 'color'),
      send: css(send, 'borderRadius'),
      body: css(body, 'backgroundColor', 'color'),
      active: css(active, 'backgroundColor', 'color'),
      header: css(header, 'backgroundColor', 'boxShadow'),
      bottom: css(bottom, 'backgroundColor'),
    }
  })
  const rows: Probe[] = []
  const eq = (name: string, expected: string, actual: string) => rows.push({ name, expect: expected, got: actual, ok: actual === expected })
  const has = (name: string, needle: string, actual: string) => rows.push({ name, expect: `contains ${needle}`, got: actual, ok: actual.includes(needle) })
  // the page: a Window — Window Text on Window — on the Application Workspace desk
  eq('page surface is the Window', window, got.page.backgroundColor)
  eq('page ink is Window Text', 'rgb(255, 255, 255)', got.page.color)
  eq('the page heading is Window Text too (no black heading over white paragraphs)', 'rgb(255, 255, 255)', got.h1.color)
  eq('the desk is the Application Workspace', dark ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 0)', got.mount.backgroundColor)
  // the chat bar: the Inactive Title Bar with its text
  eq('chat bar is the Inactive Title Bar', window, got.superbar.backgroundColor)
  eq('chat bar text is Inactive Title Bar Text', 'rgb(255, 255, 255)', got.superbar.color)
  eq('the chat send button is square', '0px', got.send.borderRadius)
  // the sidebar lists: Window on Window Text, selection Highlight on Highlighted Text
  eq('a sidebar list is the Window', window, got.body.backgroundColor)
  eq('a sidebar list\'s ink is Window Text', 'rgb(255, 255, 255)', got.body.color)
  eq('the active row is black', 'rgb(0, 0, 0)', got.active.backgroundColor)
  eq('the active row\'s text is white', 'rgb(255, 255, 255)', got.active.color)
  // silver stays where 3.1 kept it
  eq('the status bar is Button Face', dark ? 'rgb(32, 32, 32)' : 'rgb(192, 192, 192)', got.bottom.backgroundColor)
  eq('a section header is Button Face (a raised button)', dark ? 'rgb(32, 32, 32)' : 'rgb(192, 192, 192)', got.header.backgroundColor)
  // bevels reached the shadow-DOM controls through the shared list
  eq('a button is square', '0px', got.button.borderRadius)
  has('a button is framed in the Window Frame, then bevelled', dark ? 'rgb(255, 255, 255) 0px 0px 0px 1px' : 'rgb(0, 0, 0) 0px 0px 0px 1px', got.button.boxShadow)
  return rows
}

// ── The desk shows around the page at every width ────────────────────────────────────────────────────

interface InsetRow { viewport: string; present: boolean; left?: number; right?: number; top?: number; bottom?: number; ok: boolean }

async function insetAt(page: Page, width: number, height: number): Promise<InsetRow> {
  await page.setViewportSize({ width, height })
  await frames(page)
  const m = await page.evaluate(() => {
    const mount = document.querySelector('sh-editor-host')?.shadowRoot?.querySelector('.editor-mount') as HTMLElement | null
    const pm = mount?.querySelector('.ProseMirror') as HTMLElement | null
    if (!mount || !pm) return null
    const a = mount.getBoundingClientRect()
    const first = pm.getBoundingClientRect()
    const top = first.top - a.top
    mount.scrollTop = mount.scrollHeight
    const last = pm.getBoundingClientRect()
    return { left: first.left - a.left, right: a.right - first.right, top: Math.round(top * 10) / 10, bottom: Math.round((a.bottom - last.bottom) * 10) / 10 }
  })
  if (!m) return { viewport: `${width}x${height}`, present: false, ok: false }
  const round = (n: number) => Math.round(n * 10) / 10
  // Wide: the desk is 16px at the sides and the top and 24px at the foot. Phone (760px and below): 8px at the sides and the
  // top and 16px at the foot (the frame's offset shadow). Either way the yellow shows on all four sides.
  const [side, foot] = width <= 760 ? [7.5, 15.5] : [15.5, 23.5]
  return { viewport: `${width}x${height}`, present: true, left: round(m.left), right: round(m.right), top: m.top, bottom: m.bottom, ok: m.left >= side && m.right >= side && m.top >= side && m.bottom >= foot }
}

// ── The picker, exercised in the real organism: keyboard, mouse, Escape, a bogus event, a reload ────────

async function pickerFlows(browser: Browser, base: string, out: string): Promise<Record<string, unknown>> {
  const steps: Array<{ step: string; ok: boolean; detail?: unknown }> = []
  const note = (step: string, ok: boolean, detail?: unknown) => { steps.push({ step, ok, ...(detail === undefined ? {} : { detail }) }) }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await page.addInitScript('globalThis.__name = (f) => f')
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 200)))
  const boot = async (): Promise<void> => {
    await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => (document.querySelector('#status')?.textContent ?? '').includes('parsed') && !!document.querySelector('mn-top-bar'))
    await frames(page)
  }
  const state = () => page.evaluate(() => {
    let active: Element | null = document.activeElement
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
    const picker = document.querySelector('mn-top-bar')?.shadowRoot?.querySelector('mn-skin-picker') as (HTMLElement & { value?: string }) | null
    const trigger = picker?.shadowRoot?.querySelector('mn-dropdown-button')?.shadowRoot?.querySelector('.trigger')
    const stored = (() => { try { return (JSON.parse(localStorage.getItem('shrubbery.organism.settings.v1') ?? '{}') as { skin?: string }).skin ?? null } catch { return null } })()
    return {
      skin: document.documentElement.dataset.skin ?? null,
      stored,
      pickerValue: picker?.value ?? null,
      triggerName: trigger?.getAttribute('aria-label') ?? null,
      debugSelect: (document.getElementById('skin-select') as HTMLSelectElement | null)?.value ?? null,
      focusIsTrigger: !!active && active.classList.contains('trigger'),
    }
  })
  const trigger = page.locator('mn-top-bar mn-skin-picker button.trigger')
  const items = page.locator('mn-top-bar mn-skin-picker [data-menu-item-id]')
  const clip = { x: 1000, y: 0, width: 440, height: 330 }
  try {
    await boot()
    let s = await state()
    note('boots in Garden (no skin attribute, nothing stored)', s.skin === null && s.stored === null, s)

    // 1. keyboard only
    await trigger.focus()
    await page.keyboard.press('ArrowDown')
    await frames(page)
    const ids = await items.evaluateAll(els => els.map(e => (e as HTMLElement).dataset.menuItemId))
    const labels = await items.evaluateAll(els => els.map(e => e.querySelector('.item-label')?.textContent))
    note('ArrowDown opens the list of every skin, by label, Hotdog Stand last', ids.join() === 'garden,emporium,98,glass,mithras,hotdog-stand' && labels[labels.length - 1] === 'Hotdog Stand', { ids, labels })
    const firstFocused = await page.evaluate(() => {
      const items = document.querySelector('mn-top-bar')?.shadowRoot?.querySelector('mn-skin-picker')?.shadowRoot?.querySelector('mn-dropdown-button')?.shadowRoot?.querySelectorAll('[data-menu-item-id]')
      return items ? [...items].findIndex(i => i.classList.contains('focused')) : -1
    })
    note('the first skin takes the keyboard focus', firstFocused === 0, { index: firstFocused })
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown')
    await frames(page)
    await page.screenshot({ path: `${out}/picker-keyboard-hotdog-stand-focused.png`, clip })
    await page.keyboard.press('Enter')
    await frames(page)
    s = await state()
    note('Enter chooses Hotdog Stand: the root skin, the stored preference, the picker and the debug select all follow', s.skin === 'hotdog-stand' && s.stored === 'hotdog-stand' && s.pickerValue === 'hotdog-stand' && s.debugSelect === 'hotdog-stand', s)
    note('the trigger names the skin that is on, and focus returns to it', s.triggerName === 'Visual style: Hotdog Stand' && s.focusIsTrigger, s)
    await page.screenshot({ path: `${out}/organism-hotdog-stand-chosen-by-keyboard.png` })

    // 2. it persists: a reload comes back in Hotdog Stand
    await boot()
    s = await state()
    note('after a reload the skin is still Hotdog Stand (persisted like the old control)', s.skin === 'hotdog-stand' && s.stored === 'hotdog-stand' && s.pickerValue === 'hotdog-stand', s)
    await page.screenshot({ path: `${out}/organism-hotdog-stand-persisted-after-reload.png` })

    // 3. mouse: open, choose 98
    await trigger.click()
    await frames(page)
    await page.screenshot({ path: `${out}/picker-mouse-open-hotdog-stand.png`, clip })
    await page.locator('mn-top-bar mn-skin-picker [data-menu-item-id="98"]').click()
    await frames(page)
    s = await state()
    note('a click on 98 chooses 98 (root, storage, picker)', s.skin === '98' && s.stored === '98' && s.pickerValue === '98', s)

    // 4. Escape closes without choosing
    await trigger.focus()
    await page.keyboard.press('ArrowDown')
    await frames(page)
    await page.keyboard.press('Escape')
    await frames(page)
    const open = await page.evaluate(() => (document.querySelector('mn-top-bar')?.shadowRoot?.querySelector('mn-skin-picker')?.shadowRoot?.querySelector('mn-dropdown-button') as (HTMLElement & { open?: boolean }) | null)?.open ?? null)
    s = await state()
    note('Escape closes the list, chooses nothing, and returns focus to the trigger', open === false && s.skin === '98' && s.focusIsTrigger, { open, ...s })

    // 5. an event naming no skin changes nothing
    await page.evaluate(() => document.querySelector('mn-top-bar')!.dispatchEvent(new CustomEvent('mn-skin-select', { detail: { skin: 'no-such-skin' }, bubbles: true, composed: true })))
    await frames(page)
    s = await state()
    note('a mn-skin-select naming no skin is ignored', s.skin === '98' && s.stored === '98', s)

    // 6. back to Garden: an explicit choice removes the attribute (and stores it)
    await trigger.click()
    await page.locator('mn-top-bar mn-skin-picker [data-menu-item-id="garden"]').click()
    await frames(page)
    s = await state()
    note('Garden is a choice too: no skin attribute, stored as garden', s.skin === null && s.stored === 'garden', s)

    // 7. the phone: the mirrored mobile header carries the picker, and what it chooses reaches the shell
    await page.setViewportSize({ width: 390, height: 844 })
    await frames(page)
    // The bar has always folded its skin control at 600px and below (the header keeps the app tile, the
    // title, theme and settings; fbd7a82 hid the old toggle the same way), so a phone never had a cycling
    // button to replace. The phone's own way to a skin is Settings → Appearance, whose Skin control is
    // already a drop-down: prove the bar still folds it, and that the drop-down reaches Hotdog Stand.
    const folded = await page.evaluate(() => {
      const picker = document.querySelector('mn-top-bar')?.shadowRoot?.querySelector('mn-skin-picker') as HTMLElement | null
      return picker ? { display: getComputedStyle(picker).display, width: picker.getBoundingClientRect().width } : null
    })
    note('on a phone the bar folds the picker exactly as it folded the old toggle (the header keeps app, title, theme, settings)', folded?.display === 'none' && folded.width === 0, folded)
    await page.goto(`${base}/settings-browser-harness.html`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => {
      const h = (window as unknown as { __settingsHarness?: { state: { ready?: boolean; error?: string | null } } }).__settingsHarness?.state
      return h?.ready === true || Boolean(h?.error)
    }, undefined, { timeout: 60_000 })
    const phoneSettings = page.locator('mn-settings-page')
    await phoneSettings.waitFor({ state: 'visible' })
    await phoneSettings.locator('[data-section-id="appearance"]').click()
    await frames(page)
    const phoneOptions = await page.evaluate(() => {
      const root = document.querySelector('mn-settings-page')?.shadowRoot
      const select = Array.from(root?.querySelectorAll('select') ?? []).find(sel => Array.from(sel.options).some(o => o.value === 'hotdog-stand'))
      return select ? Array.from(select.options).map(o => o.value) : null
    })
    note('on a phone, Settings → Appearance offers every skin in a drop-down, Hotdog Stand last', phoneOptions?.join() === 'garden,emporium,98,glass,mithras,hotdog-stand', phoneOptions)
    await phoneSettings.getByLabel('Skin', { exact: true }).selectOption('hotdog-stand')
    await page.waitForFunction(() => document.documentElement.dataset.skin === 'hotdog-stand')
    await frames(page)
    s = await state()
    await page.screenshot({ path: `${out}/settings-hotdog-stand-phone.png` })
    note('on a phone, the Skin drop-down chooses Hotdog Stand: the root and the stored preference follow', s.skin === 'hotdog-stand' && s.stored === 'hotdog-stand', s)
    note('no page errors through the whole flow', errors.length === 0, errors)
  } finally {
    await context.close()
  }
  return { ok: steps.every(s => s.ok), steps }
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

const skinCss = await readFile(resolve(appDir, '../../packages/tokens/css/skin-hotdog-stand.css'), 'utf8')
const SKIN_ROLES = [...new Set([...skinCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]))]

const app = await serve(appDir)
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const cdp = await page.context().newCDPSession(page)
await page.addInitScript('globalThis.__name = (f) => f')
const report: Record<string, unknown> = {
  skin: SKIN,
  iniLine: HOTDOG_STAND_CONTROL_INI,
  palette: HOTDOG_STAND_PALETTE,
}
const skins = ['98', SKIN] as const
const CLIPS: Record<string, { x: number; y: number; width: number; height: number }> = {
  toolbar: { x: 0, y: 0, width: 760, height: 130 },
  chat: { x: 1080, y: 40, width: 360, height: 860 },
  'chat-typed': { x: 1080, y: 40, width: 360, height: 860 },
  sidebar: { x: 0, y: 40, width: 320, height: 520 },
  picker: { x: 1000, y: 0, width: 440, height: 330 },
}
const audits: Record<string, { audit: TextAudit; verdict: ReturnType<typeof judgeAudit> }> = {}
const failures: string[] = []

async function audit(key: string, skin: string, theme: Theme, moreContrast = false): Promise<void> {
  const result = await textAudit(page)
  // The exception exists only on Hotdog Stand's light Window surfaces; 98 is the control (reported, not judged).
  const exception = skin === SKIN && theme === 'light' && !moreContrast ? 'window-red' : 'none'
  const verdict = judgeAudit(result, exception)
  audits[key] = { audit: result, verdict }
  if (skin === SKIN && !verdict.ok) failures.push(`text audit ${key}: ${verdict.violations.length} text colour pair(s) below 4.5:1 outside the named exception`)
}

async function typeInComposer(page: Page, text: string): Promise<void> {
  await page.locator('sh-chat-panel hoja-editor .ProseMirror').first().click()
  await page.keyboard.type(text)
  await frames(page)
}

async function clearComposer(page: Page): Promise<void> {
  await page.locator('sh-chat-panel button.clear-button').click()
  await frames(page)
}

async function openPicker(): Promise<void> {
  await page.locator('mn-top-bar mn-skin-picker button.trigger').click()
  await frames(page)
}

// The picker is shared chrome: it has to read in every skin, light and dark, not only in the two this proof compares.
const ALL_SKINS = ['garden', 'emporium', '98', 'glass', 'mithras', SKIN] as const
async function pickerInEverySkin(out: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    for (const skin of ALL_SKINS) {
      await setSkin(page, skin === 'garden' ? null : skin, theme)
      await openPicker()
      await page.screenshot({ path: `${out}/picker-all-${theme}-${skin}.png`, clip: CLIPS.picker })
      await page.keyboard.press('Escape')
      await frames(page)
    }
  }
}

try {
  await mkdir(out, { recursive: true })

  // ── The real organism (the in-memory harness), per skin × theme ──
  await page.goto(`http://127.0.0.1:${app.port}/browser-harness.html`, { waitUntil: 'commit' })
  await page.waitForFunction(() => {
    const s = (window as unknown as { __organism?: { state: { ready?: boolean; error?: string | null } } }).__organism?.state
    return s?.ready === true || Boolean(s?.error)
  }, undefined, { timeout: 60_000 })

  for (const theme of ['light', 'dark'] as const) {
    for (const skin of skins) {
      await setSkin(page, skin, theme)
      await page.screenshot({ path: `${out}/${skin}-${theme}-home.png` })
      await audit(`${skin}/${theme}/home`, skin, theme)
    }
  }
  await page.locator('.app-container mn-home-view [data-document-id="architecture"] button.open').click()
  await page.waitForFunction(() => (window as unknown as { __organism?: { state: { activeDocumentId?: string } } }).__organism?.state.activeDocumentId === 'architecture')

  for (const theme of ['light', 'dark'] as const) {
    for (const skin of skins) {
      await setSkin(page, skin, theme)
      await page.screenshot({ path: `${out}/${skin}-${theme}-document.png` })
      for (const state of ['toolbar', 'chat', 'sidebar'] as const) await page.screenshot({ path: `${out}/${skin}-${theme}-${state}.png`, clip: CLIPS[state] })
      await openPicker()
      await page.screenshot({ path: `${out}/${skin}-${theme}-picker.png`, clip: CLIPS.picker })
      await audit(`${skin}/${theme}/picker-open`, skin, theme)
      await page.keyboard.press('Escape')
      await frames(page)
      // The composer with a draft in it: the send button is live (the accent) and the clear button shows.
      await typeInComposer(page, 'Two hotdogs, mustard')
      await page.screenshot({ path: `${out}/${skin}-${theme}-chat-typed.png`, clip: CLIPS.chat })
      await audit(`${skin}/${theme}/chat-typed`, skin, theme)
      await clearComposer(page)
    }
  }

  // Wide viewport: the Application Workspace desk shows around the page on every side.
  await page.setViewportSize({ width: 1920, height: 1080 })
  await frames(page)
  for (const theme of ['light', 'dark'] as const) {
    for (const skin of skins) {
      await setSkin(page, skin, theme)
      await page.screenshot({ path: `${out}/${skin}-${theme}-document-wide.png` })
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await frames(page)

  for (const theme of ['light', 'dark'] as const) {
    for (const skin of skins) {
      await setSkin(page, skin, theme)
      await page.locator('mn-top-bar .app-picker').click()
      await frames(page)
      await page.screenshot({ path: `${out}/${skin}-${theme}-app-picker.png` })
      await page.keyboard.press('Escape')
      await frames(page)
      await openOverlays(page)
      await page.screenshot({ path: `${out}/${skin}-${theme}-overlays.png` })
      await audit(`${skin}/${theme}/overlays`, skin, theme)
      await closeOverlays(page)
    }
  }

  // ── The page, carrying every kind of ink: the specimen document ──
  await loadSpecimen(page)
  report.probes = {}
  for (const theme of ['light', 'dark'] as const) {
    for (const skin of skins) {
      await setSkin(page, skin, theme)
      await page.screenshot({ path: `${out}/${skin}-${theme}-document-specimen.png` })
      await audit(`${skin}/${theme}/document-specimen`, skin, theme)
      if (skin === SKIN) {
        const rows = await probes(page, theme)
        ;(report.probes as Record<string, Probe[]>)[theme] = rows
        for (const r of rows.filter(r => !r.ok)) failures.push(`probe (${theme}) ${r.name}: expected ${r.expect}, got ${r.got}`)
      }
    }
  }

  // ── The desk shows around the page at every width ──
  report.inset = {} as Record<string, InsetRow[]>
  for (const theme of ['light', 'dark'] as const) {
    await setSkin(page, SKIN, theme)
    const rows: InsetRow[] = []
    for (const [w, h] of [[1920, 1080], [1440, 900], [1024, 768], [768, 1024], [390, 844]] as const) {
      const row = await insetAt(page, w, h)
      rows.push(row)
      await page.screenshot({ path: `${out}/${SKIN}-${theme}-inset-${w}.png` })
      if (!row.ok) failures.push(`inset ${theme} ${row.viewport}: ${JSON.stringify(row)}`)
    }
    ;(report.inset as Record<string, InsetRow[]>)[theme] = rows
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await frames(page)

  // ── Live-cascade colours and their ratios, for Hotdog Stand (chrome roles, 4.5:1 every one) ──
  await setSkin(page, SKIN, 'light')
  const light = await resolvedColours(page)
  report.light = { colours: light, contrast: contrastTable(light) }
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-contrast', value: 'more' }] })
  await frames(page)
  const more = await resolvedColours(page)
  report.moreContrastLight = { colours: more, contrast: contrastTable(more) }
  await page.screenshot({ path: `${out}/${SKIN}-light-document-more-contrast.png` })
  await audit(`${SKIN}/light-more-contrast/document-specimen`, SKIN, 'light', true)
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })
  await setSkin(page, SKIN, 'dark')
  const dark = await resolvedColours(page)
  report.dark = { colours: dark, contrast: contrastTable(dark) }

  // ── Leak audit: the document, the launcher's overlays and the settings route, both themes ──
  const leaks: Record<string, unknown> = {}
  for (const theme of ['light', 'dark'] as const) {
    await setSkin(page, SKIN, theme)
    leaks[`document/${theme}`] = await leakAuditSplit(page, `document/${theme}`)
    await openOverlays(page)
    leaks[`overlays/${theme}`] = await leakAuditSplit(page, `overlays/${theme}`)
    await closeOverlays(page)
  }
  report.leakAudit = leaks

  // ── The palette, rendered from the live cascade ──
  const darkIni = (await readFile(resolve(appDir, '../../packages/tokens/css/skin-hotdog-stand.css'), 'utf8'))
    .match(/^[\s*]*(Hotdog Stand After Hours=[0-9A-F,]+)\s*$/m)![1]
  await paletteSheet(page, 'light', HOTDOG_STAND_CONTROL_INI, 'Hotdog Stand — the Windows 3.1 CONTROL.INI [color schemes] entry, decoded (light)', `${out}/palette-light.png`)
  await paletteSheet(page, 'dark', darkIni, 'Hotdog Stand After Hours — the authored dark scheme, same 21 slots (dark)', `${out}/palette-dark.png`)

  // ── Settings → Appearance: Hotdog Stand is offered, selectable, and persisted as chosen ──
  await page.goto(`http://127.0.0.1:${app.port}/settings-browser-harness.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const s = (window as unknown as { __settingsHarness?: { state: { ready?: boolean; error?: string | null } } }).__settingsHarness?.state
    return s?.ready === true || Boolean(s?.error)
  }, undefined, { timeout: 60_000 })
  const settings = page.locator('mn-settings-page')
  await settings.waitFor({ state: 'visible' })
  await setSkin(page, SKIN, 'light')
  await settings.locator('[data-section-id="appearance"]').click()
  await frames(page)
  report.settingsSkinOptions = await page.evaluate(() => {
    const root = document.querySelector('mn-settings-page')?.shadowRoot
    const select = Array.from(root?.querySelectorAll('select') ?? []).find(s => Array.from(s.options).some(o => o.value === 'hotdog-stand'))
    return select ? Array.from(select.options).map(o => `${o.value}:${o.textContent?.trim()}`) : null
  })
  // The real control, the real code path: choose it in the Skin select, then read the root and storage.
  await settings.getByLabel('Skin', { exact: true }).selectOption(SKIN)
  await page.waitForFunction((id) => document.documentElement.dataset.skin === id, SKIN)
  await frames(page)
  report.settingsSelection = await page.evaluate(() => ({
    rootSkin: document.documentElement.dataset.skin ?? null,
    bodySkin: document.body.dataset.skin ?? null,
    persisted: (() => { try { return (JSON.parse(localStorage.getItem('shrubbery.organism.settings.v1') ?? '{}') as { skin?: string }).skin ?? null } catch { return null } })(),
  }))
  await page.screenshot({ path: `${out}/settings-${SKIN}-selected-via-the-skin-select.png` })
  for (const theme of ['light', 'dark'] as const) {
    for (const skin of skins) {
      await setSkin(page, skin, theme)
      await settings.locator('[data-section-id="appearance"]').click()
      await frames(page)
      await page.screenshot({ path: `${out}/settings-${skin}-${theme}-appearance.png` })
      await audit(`${skin}/${theme}/settings`, skin, theme)
      if (skin === SKIN) (report.leakAudit as Record<string, unknown>)[`settings/${theme}`] = await leakAuditSplit(page, `settings/${theme}`)
    }
  }

  // ── The picker, exercised in the real organism: keyboard, mouse, Escape, a bogus event, a reload, a phone ──
  report.picker = await pickerFlows(browser, `http://127.0.0.1:${app.port}`, out)
  if (!(report.picker as { ok: boolean }).ok) {
    for (const s of (report.picker as { steps: Array<{ step: string; ok: boolean }> }).steps.filter(s => !s.ok)) failures.push(`picker: ${s.step}`)
  }

  // ── The mobile shell's mirrored header: between 601 and 768px it is on screen with the picker still unfolded ──
  // (below 601px the bar folds the control, as it always did). The choice must reach the shell through the mirror.
  const mobileHeaderRows: Array<{ width: number; afterHotdogStand: unknown; afterNinetyEight: unknown; ok: boolean }> = []
  for (const width of [700, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`http://127.0.0.1:${app.port}/browser-harness.html`, { waitUntil: 'commit' })
    await page.waitForFunction(() => {
      const s = (window as unknown as { __organism?: { state: { ready?: boolean; error?: string | null } } }).__organism?.state
      return s?.ready === true || Boolean(s?.error)
    }, undefined, { timeout: 60_000 })
    const visibleBar = page.locator('mn-top-bar >> visible=true').first()
    const choose = async (id: string) => {
      await visibleBar.locator('mn-skin-picker button.trigger').click()
      await visibleBar.locator(`mn-skin-picker [data-menu-item-id="${id}"]`).click()
      await frames(page)
      return page.evaluate(() => ({
        root: document.documentElement.dataset.skin ?? null,
        state: (window as unknown as { __organism?: { state: { skin?: string } } }).__organism?.state.skin ?? null,
      }))
    }
    const first = await choose(SKIN)
    await page.screenshot({ path: `${out}/mobile-header-picker-${width}.png` })
    const second = await choose('98')
    const ok = first.root === SKIN && first.state === SKIN && second.root === '98' && second.state === '98'
    mobileHeaderRows.push({ width, afterHotdogStand: first, afterNinetyEight: second, ok })
    if (!ok) failures.push(`mobile header picker at ${width}px did not reach the shell: ${JSON.stringify({ first, second })}`)
  }
  report.mobileHeaderPicker = mobileHeaderRows
  await page.setViewportSize({ width: 1440, height: 900 })

  // ── The picker in all six skins, on the document page (a contact sheet per theme, below) ──
  await page.goto(`http://127.0.0.1:${app.port}/browser-harness.html`, { waitUntil: 'commit' })
  await page.waitForFunction(() => {
    const s = (window as unknown as { __organism?: { state: { ready?: boolean; error?: string | null } } }).__organism?.state
    return s?.ready === true || Boolean(s?.error)
  }, undefined, { timeout: 60_000 })
  await page.locator('.app-container mn-home-view [data-document-id="architecture"] button.open').click()
  await page.waitForFunction(() => (window as unknown as { __organism?: { state: { activeDocumentId?: string } } }).__organism?.state.activeDocumentId === 'architecture')
  await pickerInEverySkin(out)

  // ── Side by side: 98 | Hotdog Stand ──
  const img = async (f: string) => `data:image/png;base64,${(await readFile(`${out}/${f}`)).toString('base64')}`
  const states = ['home', 'document', 'document-specimen', 'document-wide', 'toolbar', 'chat', 'chat-typed', 'sidebar', 'picker', 'app-picker', 'overlays', 'settings-appearance'] as const
  const nativeWidth = (state: string) => state === 'document-wide' ? 1920 : CLIPS[state]?.width ?? 1440
  const compare = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  for (const theme of ['light', 'dark'] as const) {
    for (const state of states) {
      const file = (skin: string) => state === 'settings-appearance' ? `settings-${skin}-${theme}-appearance.png` : `${skin}-${theme}-${state}.png`
      await compare.setViewportSize({ width: nativeWidth(state) * 2 + 12, height: 100 }) // fullPage then sizes the image to its content
      await compare.setContent(`<style>body{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#777;font:12px system-ui}figure{margin:0;background:#fff}figcaption{padding:6px 8px;background:#222;color:#fff}img{display:block}</style>
        <figure><figcaption>98 · ${theme}</figcaption><img src="${await img(file('98'))}"></figure>
        <figure><figcaption>Hotdog Stand · ${theme}</figcaption><img src="${await img(file(SKIN))}"></figure>`)
      await compare.waitForTimeout(150)
      await compare.screenshot({ path: `${out}/compare-${state}-${theme}.png`, fullPage: true })
    }
  }

  for (const theme of ['light', 'dark'] as const) {
    const cells = await Promise.all(ALL_SKINS.map(async skin => `<figure><figcaption>${skin} · ${theme}</figcaption><img src="${await img(`picker-all-${theme}-${skin}.png`)}"></figure>`))
    await compare.setViewportSize({ width: 440 * 3 + 24, height: 100 })
    await compare.setContent(`<style>body{margin:0;display:grid;grid-template-columns:repeat(3,440px);gap:12px;background:#777;font:12px system-ui}figure{margin:0;background:#fff}figcaption{padding:6px 8px;background:#222;color:#fff}img{display:block}</style>${cells.join('')}`)
    await compare.waitForTimeout(150)
    await compare.screenshot({ path: `${out}/picker-all-skins-${theme}.png`, fullPage: true })
  }

  report.textAudit = Object.fromEntries(Object.entries(audits).map(([k, v]) => [k, {
    total: v.audit.total,
    skipped: v.audit.skipped,
    minRatio: v.audit.minRatio,
    belowAA: v.audit.below45.reduce((n, r) => n + r.count, 0),
    exemptWindowException: v.verdict.exempt,
    outsideException: v.verdict.violations.reduce((n, r) => n + r.count, 0),
    surfaces: v.audit.surfaces,
    pairsBelow45: v.audit.below45,
  }]))
  report.skinIndependentCanvas = skinIndependentCanvas
  report.failures = failures
  await writeFile(`${out}/contrast.json`, JSON.stringify(report, null, 2))
  const failing = (['light', 'moreContrastLight', 'dark'] as const)
    .map(k => [k, (report[k] as { contrast: Array<{ aa: boolean }> }).contrast.filter(r => !r.aa).length] as const)
  console.log(`hotdog-stand proof written to ${out}; chrome-role AA failures (light, more-contrast, dark): ${failing.map(f => f[1]).join(', ')}`)
  console.log(`settings skin options: ${JSON.stringify(report.settingsSkinOptions)}`)
  console.log(`settings selection: ${JSON.stringify(report.settingsSelection)}`)
  console.log(`skin-independent canvas (the graph view's #2a3328, the same in every skin; named, not counted): ${Object.keys(skinIndependentCanvas).join(', ') || 'none seen'}`)
  for (const [k, v] of Object.entries(leaks)) console.log(`leak audit ${k}: ${(v as unknown[]).length} distinct off-vocabulary colours${(v as Array<{ colour: string; count: number }>).length ? ` — ${(v as Array<{ colour: string; count: number }>).slice(0, 4).map(x => `${x.colour} ×${x.count}`).join('; ')}` : ''}`)
  for (const [k, v] of Object.entries(audits)) console.log(`text audit ${k.padEnd(46)} ${String(v.audit.total).padStart(4)} text runs · min ${String(v.audit.minRatio).padStart(5)}:1 · below 4.5: ${v.audit.below45.reduce((n, r) => n + r.count, 0)} (${v.verdict.exempt} under the Window exception, ${v.verdict.violations.reduce((n, r) => n + r.count, 0)} outside it)`)
  for (const theme of ['light', 'dark'] as const) console.log(`probes ${theme}: ${(report.probes as Record<string, Probe[]>)[theme].filter(r => r.ok).length}/${(report.probes as Record<string, Probe[]>)[theme].length} ok`)
  for (const theme of ['light', 'dark'] as const) console.log(`inset ${theme}: ${(report.inset as Record<string, InsetRow[]>)[theme].map(r => `${r.viewport} ${r.present ? `L${r.left} R${r.right} T${r.top} B${r.bottom}` : 'no editor'}`).join(' | ')}`)
  console.log(`picker flows: ${(report.picker as { steps: Array<{ ok: boolean }> }).steps.filter(s => s.ok).length}/${(report.picker as { steps: unknown[] }).steps.length} steps ok`)
  console.log(`mobile header picker (700px, 768px): ${mobileHeaderRows.map(r => `${r.width}px ${r.ok ? 'reaches the shell' : 'DID NOT'}`).join(' | ')}`)
  if (failures.length) {
    console.log(`\n${failures.length} FAILURE(S):`)
    for (const f of failures) console.log(`  - ${f}`)
    process.exitCode = 1
  }
} finally {
  await browser.close()
  await app.server.close()
}
