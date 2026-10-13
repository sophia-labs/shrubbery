/**
 * REAL test of the Hotdog Stand skin — NO MOCKS. Reads the shipped CSS from
 * disk and resolves the real cascade (reference → semantic → component →
 * theme-dark → skin light → skin dark) with a small, honest CSS reader.
 *
 * Hotdog Stand is the Windows 3.1 colour scheme of that name (the garish red /
 * yellow / black / white one). Five things are asserted:
 *
 *   1. GROUND TRUTH — the palette is the 21-slot entry from the real Windows 3.1
 *      CONTROL.INI [color schemes] section, decoded here by an independent
 *      decoder and cross-checked against the slot-by-slot RGB table a person read
 *      off the Windows Color dialog. The skin's header comment quotes the INI line
 *      and this test checks the quote against the CSS, so the prose cannot drift
 *      from the code.
 *   2. REGISTRATION — it is a selectable visual identity, stamped by the one
 *      applier, last in the global cycle.
 *   3. COMPLETENESS — no semantic role is left to fall through to another skin:
 *      every role any other skin defines is defined here, in both themes.
 *   4. PERIOD DISCIPLINE — no invented colour: every colour is one of the 20
 *      static colours Windows reserves in its system palette (16 VGA + 4), one of
 *      the named neutral steps skin-98 already uses, or a colour-mix of those.
 *      Flat: no gradients, no blur.
 *   5. LEGIBILITY — WCAG AA (4.5:1) for every text role on every chrome surface
 *      it can sit on, in both themes. ONE named exception, ruled by Vera on
 *      2026-10-03: Window-coloured surfaces — the editor page, the sidebar lists,
 *      the chat bar — carry the scheme's own pair, Window Text on Window (white on
 *      red, 4.00:1), with an asserted 3:1 floor. The exception is closed (the set
 *      of red surfaces is pinned), absent in dark (white on maroon, 10.95:1) and
 *      void under prefers-contrast: more (Window turns maroon). prefers-contrast:
 *      more also lifts every grey ink to ink; reduced transparency makes every
 *      wash solid.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HOTDOG_STAND_CONTROL_INI,
  HOTDOG_STAND_PALETTE,
  SKIN_APPLICATIONS,
  SKIN_LABELS,
  VISUAL_IDENTITY_SKINS,
  applySkinTheme,
  effectiveTheme,
  isSkin,
  isVisualIdentitySkin,
  nextVisualIdentitySkin,
  type AttrTarget,
} from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const CSS_DIR = resolve(here, '../../css')
const SKIN = 'hotdog-stand'
const FILE = `skin-${SKIN}.css`
const LIGHT = `[data-skin="${SKIN}"]`
const DARK = `[data-theme="dark"][data-skin="${SKIN}"]`

const read = (f: string) => readFileSync(resolve(CSS_DIR, f), 'utf8')
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

// ── A small CSS reader: declarations of one selector, optionally inside @media ──

type Block = Record<string, string>

function mediaBody(clean: string, media: string): string {
  const out: string[] = []
  let from = 0
  for (;;) {
    const start = clean.indexOf(`@media ${media}`, from)
    if (start < 0) break
    const open = clean.indexOf('{', start)
    let depth = 1
    let i = open + 1
    for (; i < clean.length && depth > 0; i++) {
      if (clean[i] === '{') depth++
      else if (clean[i] === '}') depth--
    }
    out.push(clean.slice(open + 1, i - 1))
    from = i
  }
  return out.join('\n')
}

function withoutMedia(clean: string): string {
  let out = clean
  for (;;) {
    const start = out.indexOf('@media')
    if (start < 0) return out
    const open = out.indexOf('{', start)
    let depth = 1
    let i = open + 1
    for (; i < out.length && depth > 0; i++) {
      if (out[i] === '{') depth++
      else if (out[i] === '}') depth--
    }
    out = out.slice(0, start) + out.slice(i)
  }
}

function blockOf(css: string, selector: string, media: string | null = null): Block {
  const clean = strip(css)
  const scope = media ? mediaBody(clean, media) : withoutMedia(clean)
  const out: Block = {}
  for (const m of scope.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map(s => s.trim())
    if (!selectors.includes(selector)) continue
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim().replace(/\s+/g, ' ')
  }
  return out
}

function allBlocks(css: string): Map<string, Block> {
  const out = new Map<string, Block>()
  const clean = withoutMedia(strip(css))
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls: Block = {}
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls[d[1]] = d[2].trim().replace(/\s+/g, ' ')
    for (const sel of m[1].split(',').map(s => s.trim())) out.set(sel, { ...(out.get(sel) ?? {}), ...decls })
  }
  return out
}

// ── The cascade, in the order tokens.css imports it ────────────────────────────

const ROOT_FILES = ['reference.css', 'flow-tokens.css', 'semantic.css', 'component.css', 'z-layers.css', 'editor-material.css']
const roots = (): Block =>
  Object.assign({}, ...ROOT_FILES.map(f => blockOf(read(f), ':root')))
const themeDark = (): Block => blockOf(read('theme-dark.css'), '[data-theme="dark"]')

const skinFile = (): string => read(FILE)
const light = (): Block => blockOf(skinFile(), LIGHT)
const dark = (): Block => blockOf(skinFile(), DARK)
/** The continuous (default) editor material: no [data-editor-material] on the root. */
const sheet = (): Block => blockOf(skinFile(), `${LIGHT}:not([data-editor-material])`)
const sheetDark = (): Block => blockOf(skinFile(), `${DARK}:not([data-editor-material])`)

/** What the browser computes on <html data-skin=… data-theme=…> (continuous editor material). */
function cascade(theme: 'light' | 'dark', moreContrast = false, reducedTransparency = false): Block {
  const l = light()
  const base: Block = { ...roots(), ...(theme === 'dark' ? themeDark() : {}), ...l, ...sheet() }
  if (moreContrast) {
    Object.assign(base, blockOf(skinFile(), LIGHT, '(prefers-contrast: more)'))
    Object.assign(base, blockOf(skinFile(), `${LIGHT}:not([data-editor-material])`, '(prefers-contrast: more)'))
  }
  if (reducedTransparency) Object.assign(base, blockOf(skinFile(), LIGHT, '(prefers-reduced-transparency: reduce)'))
  if (theme === 'dark') {
    // The dark composition (0,2,0) outranks the light block and the light media blocks (0,1,0).
    Object.assign(base, dark(), sheetDark())
    if (moreContrast) Object.assign(base, blockOf(skinFile(), DARK, '(prefers-contrast: more)'))
    if (reducedTransparency) Object.assign(base, blockOf(skinFile(), DARK, '(prefers-reduced-transparency: reduce)'))
  }
  return base
}

// ── A resolver for hex, rgb(a), var() chains and color-mix(in srgb) ────────────

type Rgba = [number, number, number, number]

function expand(raw: string, scope: Block, depth = 0): string {
  if (depth > 12) throw new Error(`var() chain too deep: ${raw}`)
  return raw.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name: string, fallback?: string) => {
    const v = scope[name]
    if (v === undefined) {
      if (fallback !== undefined) return expand(fallback.trim(), scope, depth + 1)
      throw new Error(`unresolved ${name}`)
    }
    return expand(v, scope, depth + 1)
  })
}

function hexRgba(value: string): Rgba | null {
  const m = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1]
}

function splitTop(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = '' } else cur += ch
  }
  parts.push(cur.trim())
  return parts
}

function colour(raw: string, scope: Block): Rgba {
  const v = expand(raw, scope).trim()
  if (v === 'transparent') return [0, 0, 0, 0]
  const h = hexRgba(v)
  if (h) return h
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])]
  const mix = v.match(/^color-mix\(\s*in srgb\s*,\s*(.+)\)$/i)
  if (mix) {
    const [a, b] = splitTop(mix[1])
    const stop = (s: string): { c: Rgba; p: number | null } => {
      const m = s.match(/^(.*?)(?:\s+([\d.]+)%)?$/)!
      return { c: colour(m[1], scope), p: m[2] === undefined ? null : Number(m[2]) / 100 }
    }
    const A = stop(a)
    const B = stop(b)
    const pa = A.p ?? (B.p === null ? 0.5 : 1 - B.p)
    const pb = B.p ?? 1 - pa
    const alpha = A.c[3] * pa + B.c[3] * pb
    const ch = (i: number) => alpha === 0 ? 0 : (A.c[i] * A.c[3] * pa + B.c[i] * B.c[3] * pb) / alpha
    return [ch(0), ch(1), ch(2), alpha]
  }
  throw new Error(`not a resolvable colour: ${raw} → ${v}`)
}

const over = (fg: Rgba, bg: Rgba): Rgba => {
  const a = fg[3]
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const toHex = ([r, g, b]: Rgba): string =>
  `#${[r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('')}`

/** Resolve a role to #rrggbb through the real cascade. */
const hexOf = (theme: 'light' | 'dark', role: string): string => {
  const scope = cascade(theme)
  return toHex(colour(`var(${role})`, scope))
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. GROUND TRUTH — Windows 3.1 CONTROL.INI [color schemes] "Hotdog Stand"
// ═════════════════════════════════════════════════════════════════════════════

/** The line exactly as a stock Windows 3.1x CONTROL.INI carries it (see the round README for sources). */
const INI_LINE = 'Hotdog Stand=FFFF,FFFF,FF,FFFFFF,FFFFFF,0,0,FF,FFFFFF,FF,FF,0,C0C0C0,C0C0C0,808080,0,808080,0,FFFFFF,FFFFFF,FFFFFF'

/**
 * The 21 slots in CONTROL.INI order (= the WIN.INI [colors] key order):
 * [CSS suffix, label in the Windows Color dialog, WIN.INI key, camelCase key in HOTDOG_STAND_PALETTE].
 */
const SLOTS = [
  ['desktop', 'Desktop', 'Background', 'desktop'],
  ['workspace', 'Application Workspace', 'AppWorkspace', 'workspace'],
  ['window', 'Window', 'Window', 'window'],
  ['window-text', 'Window Text', 'WindowText', 'windowText'],
  ['menu', 'Menu Bar', 'Menu', 'menu'],
  ['menu-text', 'Menu Text', 'MenuText', 'menuText'],
  ['caption', 'Active Title Bar', 'ActiveTitle', 'caption'],
  ['caption-inactive', 'Inactive Title Bar', 'InactiveTitle', 'captionInactive'],
  ['caption-text', 'Title Bar Text', 'TitleText', 'captionText'],
  ['border-active', 'Active Border', 'ActiveBorder', 'borderActive'],
  ['border-inactive', 'Inactive Border', 'InactiveBorder', 'borderInactive'],
  ['frame', 'Window Frame', 'WindowFrame', 'frame'],
  ['scrollbar', 'Scroll Bars', 'Scrollbar', 'scrollbar'],
  ['face', 'Button Face', 'ButtonFace', 'face'],
  ['shadow', 'Button Shadow', 'ButtonShadow', 'shadow'],
  ['button-text', 'Button Text', 'ButtonText', 'buttonText'],
  ['gray-text', 'Gray Text', 'GrayText', 'grayText'],
  ['highlight', 'Highlighted (Hilight)', 'Hilight', 'highlight'],
  ['highlight-text', 'Highlighted Text', 'HilightText', 'highlightText'],
  ['caption-text-inactive', 'Inactive Title Bar Text', 'InactiveTitleText', 'captionTextInactive'],
  ['light', 'Button Highlight', 'ButtonHilight', 'light'],
] as const

/**
 * An INDEPENDENT source for the same scheme: the table of Hotdog Stand's
 * screen elements as the Windows Color dialog shows them (R.G.B), posted by
 * "SuperBlit" in the Coding Horror thread "A Tribute to the Windows 3.1 'Hot Dog
 * Stand' Color Scheme", comment 51, 2008-03-23. Keyed by the dialog's labels.
 */
const COLOR_DIALOG: Readonly<Record<string, readonly [number, number, number]>> = {
  'Desktop': [255, 255, 0],
  'Application Workspace': [255, 255, 0],
  'Window': [255, 0, 0],
  'Window Text': [255, 255, 255],
  'Menu Bar': [255, 255, 255],
  'Menu Text': [0, 0, 0],
  'Active Title Bar': [0, 0, 0],
  'Inactive Title Bar': [255, 0, 0],
  'Title Bar Text': [255, 255, 255],
  'Inactive Title Bar Text': [255, 255, 255],
  'Active Border': [255, 0, 0],
  'Inactive Border': [255, 0, 0],
  'Window Frame': [0, 0, 0],
  'Scroll Bars': [192, 192, 192],
  'Button Face': [192, 192, 192],
  'Button Shadow': [128, 128, 128],
  'Button Text': [0, 0, 0],
  'Button Highlight': [255, 255, 255],
  'Gray Text': [128, 128, 128],
  'Highlighted (Hilight)': [0, 0, 0],
  'Highlighted Text': [255, 255, 255],
}

/** COLORREF 0x00BBGGRR printed in hex without leading zeros → #rrggbb. */
function decodeColorref(value: string): string {
  const n = parseInt(value, 16)
  const r = n & 0xff
  const g = (n >> 8) & 0xff
  const b = (n >> 16) & 0xff
  return `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`
}

function decodeIni(line: string): string[] {
  const values = line.split('=')[1].split(',')
  expect(values).toHaveLength(21)
  return values.map(decodeColorref)
}

describe('@shrubbery/tokens — Hotdog Stand: ground truth (Windows 3.1 CONTROL.INI)', () => {
  it('keeps the INI line verbatim in the TS constant and in the skin header, and they agree', () => {
    expect(HOTDOG_STAND_CONTROL_INI).toBe(INI_LINE)
    const header = skinFile().match(/^[\s*]*(Hotdog Stand=[0-9A-F,]+)\s*$/m)?.[1]
    expect(header, 'the skin header quotes the INI line on a line of its own').toBe(INI_LINE)
  })

  it('decodes all 21 slots to exactly what the Windows Color dialog shows (independent source)', () => {
    const decoded = decodeIni(INI_LINE)
    SLOTS.forEach(([, label], i) => {
      const [r, g, b] = COLOR_DIALOG[label]
      const hex = `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`
      expect(decoded[i], `${label} (slot ${i + 1})`).toBe(hex)
    })
  })

  it('the scheme has exactly six distinct colours — yellow, red, white, black, silver, grey', () => {
    expect([...new Set(decodeIni(INI_LINE))].sort()).toEqual(
      ['#000000', '#808080', '#c0c0c0', '#ff0000', '#ffff00', '#ffffff'].sort(),
    )
  })

  it('HOTDOG_STAND_PALETTE is the decoded scheme, slot for slot', () => {
    const decoded = decodeIni(INI_LINE)
    SLOTS.forEach(([, , , key], i) => {
      expect((HOTDOG_STAND_PALETTE as Record<string, string>)[key]?.toLowerCase(), key).toBe(decoded[i])
    })
    expect(Object.keys(HOTDOG_STAND_PALETTE)).toHaveLength(21)
  })

  it('the CSS names the 21 slots as --mn-hds-* and they are exactly the decoded scheme (light)', () => {
    const decoded = decodeIni(INI_LINE)
    const block = light()
    SLOTS.forEach(([suffix], i) => {
      expect(block[`--mn-hds-${suffix}`]?.toLowerCase(), `--mn-hds-${suffix}`).toBe(decoded[i])
    })
  })

  it('the dark composition is its own authored 21-slot scheme, quoted in the header and decoded exactly', () => {
    const header = skinFile().match(/^[\s*]*(Hotdog Stand After Hours=[0-9A-F,]+)\s*$/m)?.[1]
    expect(header, 'the skin header quotes the authored dark scheme line').toBeDefined()
    const decoded = decodeIni(header!)
    const block = dark()
    SLOTS.forEach(([suffix], i) => {
      expect(block[`--mn-hds-${suffix}`]?.toLowerCase(), `dark --mn-hds-${suffix}`).toBe(decoded[i])
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. REGISTRATION
// ═════════════════════════════════════════════════════════════════════════════

describe('@shrubbery/tokens — Hotdog Stand: registration', () => {
  it('is a first-class skin stamped as [data-skin=hotdog-stand]', () => {
    expect(isSkin(SKIN)).toBe(true)
    expect(SKIN_APPLICATIONS['hotdog-stand'].appliesAttribute).toBe('[data-skin=hotdog-stand]')
    expect(SKIN_APPLICATIONS['hotdog-stand'].attr).toBe('data-skin')
    expect(SKIN_APPLICATIONS['hotdog-stand'].value).toBe(SKIN)
    expect(SKIN_LABELS['hotdog-stand']).toBe('Hotdog Stand')
  })

  it('is a selectable visual identity, last in the global cycle (Mithras → Hotdog Stand → Garden)', () => {
    expect(isVisualIdentitySkin(SKIN)).toBe(true)
    expect(VISUAL_IDENTITY_SKINS.at(-1)).toBe(SKIN)
    expect(nextVisualIdentitySkin('mithras')).toBe(SKIN)
    expect(nextVisualIdentitySkin(SKIN)).toBe('garden')
  })

  it('tokens.css imports it, after skin-mithras.css', () => {
    const entry = read('tokens.css')
    expect(entry).toContain(`@import './${FILE}';`)
    expect(entry.indexOf(FILE)).toBeGreaterThan(entry.indexOf('skin-mithras.css'))
  })

  it('the applier stamps it, and — unlike Mithras — it has a real dark register', () => {
    const attrs = new Map<string, string>()
    const target: AttrTarget = {
      setAttribute: (n, v) => { attrs.set(n, v) },
      removeAttribute: n => { attrs.delete(n) },
    }
    applySkinTheme({ skin: 'hotdog-stand', theme: 'dark', target })
    expect(attrs.get('data-skin')).toBe(SKIN)
    expect(attrs.get('data-theme')).toBe('dark')
    expect(effectiveTheme('hotdog-stand', 'dark')).toBe('dark')
    applySkinTheme({ skin: 'hotdog-stand', theme: 'light', target })
    expect(attrs.get('data-theme')).toBe('light')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. COMPLETENESS — nothing falls through to another skin by accident
// ═════════════════════════════════════════════════════════════════════════════

/** Vocabulary that belongs to one skin alone (its own prefix), not a semantic role. */
const PRIVATE = /^--(mn-)?(98|glass|emporium|research|greenhouse|observatory|mithras|hds|hotdog-stand)-/

/**
 * Roles that are not this skin's to state:
 *  - another skin's own feature — Greenhouse lights its stance annunciator through three
 *    roles that stance.css owns;
 *  - global by contract — semantic.css/theme-dark.css carry the validated dataviz swatches
 *    and the contested-stance triple for EVERY skin ("GLOBAL, skin-independent"). Light-only
 *    Mithras pins them because theme-dark would otherwise bleed in; a dark-capable skin
 *    inherits both themes' values, which is the contract.
 */
const NOT_THIS_SKINS_TO_STATE = /^--mn-(stance-annunciator-|stance-contested-|chart-)/
const OTHER_SKINS_OWN_FEATURE = { has: (role: string) => NOT_THIS_SKINS_TO_STATE.test(role) }

function otherSkinRoles(which: 'light' | 'dark'): Set<string> {
  const roles = new Set<string>()
  for (const file of readdirSync(CSS_DIR).filter(f => /^skin-.+\.css$/.test(f) && f !== FILE)) {
    const name = file.slice('skin-'.length, -'.css'.length)
    const blocks = allBlocks(read(file))
    for (const [selector, decls] of blocks) {
      const isLight = selector === `[data-skin="${name}"]` || selector === `[data-design="${name}"]`
      const isDark = selector === `[data-theme="dark"][data-skin="${name}"]`
      if ((which === 'light' && !isLight) || (which === 'dark' && !isDark)) continue
      for (const role of Object.keys(decls)) {
        if (!PRIVATE.test(role) && !OTHER_SKINS_OWN_FEATURE.has(role)) roles.add(role)
      }
    }
  }
  return roles
}

describe('@shrubbery/tokens — Hotdog Stand: complete role mapping', () => {
  it('light defines every role any other skin defines (nothing falls through to Garden)', () => {
    const l = light()
    const missing = [...otherSkinRoles('light')].filter(r => l[r] === undefined).sort()
    expect(missing).toEqual([])
  })

  it('dark answers every role theme-dark.css or another skin\'s dark composition sets', () => {
    const l = light()
    const d = dark()
    const wanted = new Set<string>(
      [...Object.keys(themeDark()), ...otherSkinRoles('dark')].filter(r => !PRIVATE.test(r) && !OTHER_SKINS_OWN_FEATURE.has(r)),
    )
    // The light block outranks theme-dark.css at equal specificity (it is imported later), so a
    // role this skin defines never falls through to Garden's dark value. What must hold is the
    // converse: no light-theme colour LEAKS into dark. A role the dark block does not restate
    // must either respond to the theme through the 21 slots (--mn-hds-* are redefined in dark —
    // including a slot the dark scheme keeps the same colour for, like Inactive Title Bar Text,
    // white in both: that is authored, not leaked) or carry no colour at all.
    const defined = [...wanted].filter(r => l[r] === undefined && d[r] === undefined).sort()
    expect(defined, 'defined in neither block').toEqual([])
    const lightScope = cascade('light')
    const darkScope = cascade('dark')
    const colourBearing = /#[0-9a-f]{3,8}\b|rgba?\(|color-mix\(/i
    const redefinedInDark = new Set(Object.keys(d).filter(name => /^--mn-hds-/.test(name)))
    const touchesRedefinedSlot = (value: string, depth = 0): boolean => {
      if (depth > 12) return false
      return [...value.matchAll(/var\(\s*(--[\w-]+)/g)].some(([, name]) =>
        redefinedInDark.has(name) || (!/^--mn-hds-/.test(name) && darkScope[name] !== undefined && touchesRedefinedSlot(darkScope[name], depth + 1)))
    }
    const leaks = [...wanted].filter(r => {
      if (d[r] !== undefined || l[r] === undefined) return false
      const inLight = expand(l[r], lightScope)
      const inDark = expand(l[r], darkScope)
      return inLight === inDark && colourBearing.test(inDark) && !touchesRedefinedSlot(l[r])
    }).sort()
    expect(leaks, 'light colours that would show through in dark').toEqual([])
  })

  it('every var() the skin writes resolves, in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const scope = cascade(theme)
      const own = theme === 'light' ? light() : { ...light(), ...dark() }
      const broken: string[] = []
      for (const [role, value] of Object.entries(own)) {
        try { expand(value, scope) } catch (e) { broken.push(`${role}: ${(e as Error).message}`) }
      }
      expect(broken, theme).toEqual([])
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. PERIOD DISCIPLINE — no invented colour, nothing that Windows 3.1 could not draw
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The 20 static colours Windows reserves in its system palette: the 16 VGA colours
 * plus four more (Microsoft Learn, "Default Palette"; values tabulated by
 * CompuPhase, "The Microsoft Windows Palette Manager").
 */
const STATIC_20 = [
  '#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0', '#c0dcc0', '#a6caf0',
  '#fffbf0', '#a0a0a4', '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
]

/** The named neutral ink / face steps — the very steps skin-98 uses, so nothing here is new. */
const NEUTRAL_STEPS = ['#202020', '#282828', '#303030', '#383838', '#444444', '#606060', '#d8d8d8', '#e0e0e0', '#f0f0f0']

const ALLOWED = new Set([...STATIC_20, ...NEUTRAL_STEPS])

const NAMED_COLOURS = /\b(white|black|red|blue|green|yellow|gr[ae]y|silver|maroon|navy|olive|purple|teal|aqua|fuchsia|lime|orange|pink|brown|cyan|magenta|gold|beige|ivory|tan)\b/i

describe('@shrubbery/tokens — Hotdog Stand: period discipline', () => {
  it('every colour literal is a static Windows colour, a named neutral step, or black/white alpha', () => {
    const css = strip(skinFile())
    const stray: string[] = []
    for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const hex = m[0].toLowerCase()
      const full = hex.length === 4 ? `#${hex.slice(1).split('').map(c => c + c).join('')}` : hex
      if (!ALLOWED.has(full)) stray.push(m[0])
    }
    for (const m of css.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/gi)) {
      const hex = `#${[m[1], m[2], m[3]].map(c => Number(c).toString(16).padStart(2, '0')).join('')}`
      if (!ALLOWED.has(hex)) stray.push(m[0])
    }
    expect([...new Set(stray)]).toEqual([])
  })

  it('every hex is declared once, as a named palette entry — roles reference names and never retype a colour', () => {
    const css = strip(skinFile())
    const palette = new RegExp(`^--mn-hds-(${SLOTS.map(s => s[0]).join('|')}|sys-[a-z]+|n-\\d+)$`)
    const retyped: string[] = []
    for (const m of css.matchAll(/(--[\w-]+|[a-z-]+)\s*:\s*([^;{}]+);/g)) {
      if (/#[0-9a-f]{3,8}\b/i.test(m[2]) && !palette.test(m[1])) retyped.push(`${m[1]}: ${m[2].trim()}`)
    }
    expect(retyped).toEqual([])
  })

  it('uses no colour keyword — every colour is spelled as a value that can be audited', () => {
    const decls = strip(skinFile()).match(/(?:--[\w-]+|color|background|border[\w-]*|outline[\w-]*|box-shadow)\s*:[^;{}]*;/g) ?? []
    const named = decls.filter(d => NAMED_COLOURS.test(d.replace(/--mn-[\w-]+/g, '')))
    expect(named).toEqual([])
  })

  it('is flat: no gradients, no blur, no frosted backdrops in either theme', () => {
    const css = strip(skinFile())
    expect(css).not.toMatch(/gradient\(/)
    expect(css).not.toMatch(/\bblur\(/)
    expect(css).not.toMatch(/backdrop-filter\s*:(?!\s*none)/)
    const isShadowRole = (r: string) =>
      /^--mn-(shadow-|material-(popover-shadow|lift|specular)|hds-(raised|sunken)|focus-ring$|chat-control-shadow|control-shadow|editor-sheet-shadow)/.test(r)
    for (const theme of ['light', 'dark'] as const) {
      const scope = cascade(theme)
      for (const role of Object.keys({ ...(theme === 'light' ? light() : dark()), ...(theme === 'light' ? sheet() : sheetDark()) }).filter(isShadowRole)) {
        const value = expand(scope[role], scope)
        if (value === 'none') continue
        for (const piece of splitTop(value)) {
          // x y blur [spread] colour — blur must be 0: Windows 3.1 had no soft shadows.
          const nums = piece.replace(/^inset\s+/, '').match(/^(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?/)
          expect(nums, `${theme} ${role}: ${piece}`).not.toBeNull()
          expect(Number(nums![3]), `${theme} ${role} blur: ${piece}`).toBe(0)
        }
      }
    }
  })

  it('square geometry: every radius role is none, in the scale and in the roles', () => {
    const l = light()
    for (const role of ['--mn-radius-control', '--mn-radius-surface', '--mn-radius-sm', '--mn-radius-default',
      '--mn-radius-md', '--mn-radius-lg', '--mn-radius-xl', '--mn-radius-2xl', '--mn-radius-popover']) {
      expect(expand(l[role] ?? 'MISSING', cascade('light')), role).toBe('0')
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// The faithful mapping: each Windows slot lands on the role it names
// ═════════════════════════════════════════════════════════════════════════════

describe('@shrubbery/tokens — Hotdog Stand: the faithful mapping (slot → role)', () => {
  const palette = (suffix: string) => decodeIni(INI_LINE)[SLOTS.findIndex(s => s[0] === suffix)]
  const role = (name: string) => hexOf('light', name)

  it('the room is the Desktop; the work sits on Button Face; menus are the Menu colour', () => {
    expect(role('--mn-color-surface-canvas')).toBe(palette('desktop'))
    for (const r of ['base', 'panel', 'chrome', 'raised', 'overlay']) {
      expect(role(`--mn-color-surface-${r}`), r).toBe(palette('face'))
    }
    expect(role('--mn-color-surface-elevated')).toBe(palette('menu'))
  })

  it('the masthead is the Active Title Bar with Title Bar Text; the footer is Button Face', () => {
    expect(role('--mn-top-bar-bg')).toBe(palette('caption'))
    expect(role('--mn-top-bar-text')).toBe(palette('caption-text'))
    expect(role('--mn-bottom-bar-bg')).toBe(palette('face'))
    expect(role('--mn-bottom-bar-text')).toBe(palette('button-text'))
  })

  it('ink is Button Text, frames are the Window Frame, selection is Highlight on Highlighted Text', () => {
    expect(role('--mn-color-text-primary')).toBe(palette('button-text'))
    expect(role('--mn-color-border-default')).toBe(palette('frame'))
    expect(role('--mn-color-border-strong')).toBe(palette('frame'))
    expect(role('--mn-color-accent')).toBe(palette('highlight'))
    expect(role('--mn-color-text-on-accent')).toBe(palette('highlight-text'))
    expect(role('--mn-color-border-accent')).toBe(palette('border-active'))
  })

  it('light: the document is a Window — Window Text on Window — inset on the Application Workspace desk', () => {
    const scope = cascade('light')
    expect(role('--mn-editor-sheet-surface')).toBe(palette('window'))
    for (const ink of ['ink', 'title', 'secondary', 'tertiary']) {
      expect(role(`--mn-editor-sheet-${ink}`), ink).toBe(palette('window-text'))
    }
    expect(role('--mn-editor-canvas-surface')).toBe(palette('workspace'))
    // The semantic editor surface (center panes, loaders, dialogs) stays Menu white: the red lives in the page's own role.
    expect(role('--mn-color-surface-editor')).toBe(palette('menu'))
    // The thick Active Border (red on red: the slab), the Window Frame ring and a hard shadow.
    expect(expand(scope['--mn-editor-sheet-border'], scope)).toBe(`4px solid ${palette('border-active')}`)
    expect(expand(scope['--mn-editor-sheet-shadow'], scope)).toContain(`0 0 0 1px ${palette('frame')}`)
  })

  it('the desk shows around the page at every width: a fixed gutter on every side, whatever the container', () => {
    for (const theme of ['light', 'dark'] as const) {
      const scope = cascade(theme)
      const width = expand(scope['--mn-editor-sheet-width'], scope)
      const margin = expand(scope['--mn-editor-sheet-margin'], scope)
      const minHeight = expand(scope['--mn-editor-sheet-min-height'], scope)
      const w = width.match(/^min\(calc\(100% - (\d+)px\), (\d+)px\)$/)
      const m = margin.match(/^(\d+)px auto (\d+)px$/)
      const h = minHeight.match(/^calc\(100% - (\d+)px\)$/)
      expect(w, `${theme} width ${width}`).not.toBeNull()
      expect(m, `${theme} margin ${margin}`).not.toBeNull()
      expect(h, `${theme} min-height ${minHeight}`).not.toBeNull()
      const gutter = Number(m![1])
      expect(gutter, 'a visible gutter').toBeGreaterThanOrEqual(12)
      // Both sides are the gutter, the page never reaches the container's edge, and it never forces a scrollbar for a short document.
      expect(Number(w![1])).toBe(gutter * 2)
      expect(Number(h![1])).toBe(gutter + Number(m![2]))
    }
  })

  it('the chat bar is the Inactive Title Bar; the sidebar lists are Window on Window Text; silver stays where 3.1 kept it', () => {
    expect(role('--mn-chat-superbar-bg')).toBe(palette('caption-inactive'))
    expect(role('--mn-chat-superbar-text')).toBe(palette('caption-text-inactive'))
    expect(role('--mn-chat-superbar-text-muted')).toBe(palette('caption-text-inactive'))
    expect(role('--mn-list-surface')).toBe(palette('window'))
    expect(role('--mn-list-ink')).toBe(palette('window-text'))
    expect(role('--mn-list-selected-surface')).toBe(palette('highlight'))
    expect(role('--mn-list-selected-ink')).toBe(palette('highlight-text'))
    // Silver (Button Face): toolbars and panels, the status bar, buttons and controls; Scroll Bars for the scrollbars.
    for (const r of ['--mn-color-surface-base', '--mn-color-surface-panel', '--mn-color-surface-chrome', '--mn-bottom-bar-bg',
      '--mn-control-background', '--mn-chat-header-bg', '--mn-chat-control-bg', '--mn-layout-tab-strip-bg']) {
      expect(role(r), r).toBe(palette('face'))
    }
    expect(role('--mn-scrollbar-track')).toBe(palette('scrollbar'))
    expect(role('--mn-color-surface-canvas')).toBe(palette('desktop'))
  })

  it('the page belongs to the continuous material only — paper and classic-word keep their own page', () => {
    const SHEET_LIGHT = ['--mn-editor-sheet-accent', '--mn-editor-sheet-border', '--mn-editor-sheet-hover', '--mn-editor-sheet-ink',
      '--mn-editor-sheet-link', '--mn-editor-sheet-link-hover', '--mn-editor-sheet-margin', '--mn-editor-sheet-min-height',
      '--mn-editor-sheet-on-accent', '--mn-editor-sheet-raised', '--mn-editor-sheet-rule', '--mn-editor-sheet-secondary', '--mn-editor-sheet-shadow',
      '--mn-editor-sheet-sunken', '--mn-editor-sheet-surface', '--mn-editor-sheet-tertiary', '--mn-editor-sheet-title',
      '--mn-editor-sheet-wash', '--mn-editor-sheet-width']
    expect(Object.keys(sheet()).sort()).toEqual(SHEET_LIGHT)
    // After hours restates only what differs: the hierarchy of inks and the boxes inside the page.
    expect(Object.keys(sheetDark()).sort()).toEqual(
      ['--mn-editor-sheet-accent', '--mn-editor-sheet-hover', '--mn-editor-sheet-ink', '--mn-editor-sheet-link', '--mn-editor-sheet-raised',
        '--mn-editor-sheet-rule', '--mn-editor-sheet-secondary', '--mn-editor-sheet-shadow', '--mn-editor-sheet-sunken',
        '--mn-editor-sheet-tertiary', '--mn-editor-sheet-title', '--mn-editor-sheet-wash'])
    // The plain skin blocks never touch the sheet roles the physical-page materials set.
    for (const block of [light(), dark()]) {
      for (const owned of SHEET_LIGHT) expect(block[owned], owned).toBeUndefined()
    }
  })

  it('dark: the Window returns — the same red hue darkened to maroon — carrying Window Text', () => {
    const dkPalette = (suffix: string) => dark()[`--mn-hds-${suffix}`]
    expect(hexOf('dark', '--mn-color-surface-editor')).toBe(dkPalette('window'))
    expect(dkPalette('window')).toBe('#800000')
    const scope = cascade('dark')
    expect(toHex(colour('var(--mn-editor-sheet-ink)', scope))).toBe(dkPalette('window-text'))
    expect(toHex(colour('var(--mn-editor-sheet-title)', scope))).toBe(dkPalette('window-text'))
    // …and Windows 3.1's own LCD Reversed - Dark scheme has exactly that Window under white Window Text.
  })

  it('the faithful slots reach the roles by reference, never by retyping a hex', () => {
    const used = new Set<string>()
    for (const value of [...Object.values(light()), ...Object.values(dark()), ...Object.values(sheet()), ...Object.values(sheetDark())]) {
      for (const m of value.matchAll(/var\((--mn-hds-[\w-]+)\)/g)) used.add(m[1])
    }
    // Slots with a one-to-one Shrubbery role. (Inactive Border, Menu Text and Gray Text are named
    // in the palette for components that want them; Shrubbery has no inactive-window border role.)
    for (const suffix of ['desktop', 'workspace', 'window', 'window-text', 'menu', 'caption', 'caption-inactive', 'caption-text',
      'caption-text-inactive', 'border-active', 'frame', 'scrollbar', 'face', 'shadow', 'button-text', 'highlight', 'highlight-text', 'light']) {
      expect(used.has(`--mn-hds-${suffix}`), `--mn-hds-${suffix} feeds a role`).toBe(true)
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. LEGIBILITY — WCAG AA
// ═════════════════════════════════════════════════════════════════════════════

const TEXT_ROLES = [
  '--mn-color-text-primary', '--mn-color-text-secondary', '--mn-color-text-tertiary',
  '--mn-color-text-muted', '--mn-color-text-quiet', '--mn-color-text-title',
  '--mn-color-text-accent', '--mn-color-text-accent-strong',
  '--mn-color-text-link', '--mn-color-text-link-hover',
  '--mn-color-text-danger', '--mn-color-text-warning', '--mn-color-text-success',
  // The hook the chat's balance chip, the sidebar panel and the modes badge read for warning ink. No other skin
  // names it, so without an answer here they are drawn in a literal brown (3.9:1 on silver, 2.3:1 after hours).
  '--mn-color-warning-text',
]

/** Every neutral surface text can sit on — the editor page included. */
const SURFACES = [
  '--mn-color-surface-canvas', '--mn-color-surface-base', '--mn-color-surface-editor', '--mn-color-surface-panel', '--mn-color-surface-chrome',
  '--mn-color-surface-raised', '--mn-color-surface-elevated', '--mn-color-surface-overlay', '--mn-color-surface-subtle',
  '--mn-color-surface-warm', '--mn-color-surface-sunken', '--mn-color-surface-accent', '--mn-color-surface-accent-strong',
]

const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--mn-top-bar-text', '--mn-top-bar-bg'],
  ['--mn-top-bar-text-muted', '--mn-top-bar-bg'],
  ['--mn-bottom-bar-text', '--mn-bottom-bar-bg'],
  ['--mn-bottom-bar-text-muted', '--mn-bottom-bar-bg'],
  ['--mn-color-text-on-accent', '--mn-color-accent'],
  ['--mn-color-text-on-accent', '--mn-color-accent-hover'],
  ['--mn-color-text-on-accent', '--mn-color-accent-active'],
  ['--mn-color-on-danger', '--mn-color-action-danger'],
  ['--mn-color-on-warning', '--mn-color-action-warning'],
  ['--mn-color-text-danger', '--mn-color-danger-surface'],
  ['--mn-color-danger', '--mn-color-danger-surface'],
  ['--mn-color-warning', '--mn-color-warning-surface'],
  ['--mn-color-success', '--mn-color-success-surface'],
  ['--mn-color-info', '--mn-color-info-surface'],
  ['--mn-color-text-on-accent', '--mn-chat-user-bg'],
]

/** Interaction washes lie over a surface; the ink must still clear AA through them. */
const WASHES = [
  '--mn-color-surface-hover', '--mn-color-surface-active', '--mn-color-interactive-hover',
  '--mn-color-interactive-active', '--mn-color-interactive-selected',
]
const WASH_HOSTS = ['--mn-color-surface-base', '--mn-color-surface-panel', '--mn-color-surface-sunken', '--mn-color-surface-elevated']

function table(theme: 'light' | 'dark', moreContrast = false): Array<{ fg: string; bg: string; ratio: number }> {
  const scope = cascade(theme, moreContrast)
  const canvas = colour('var(--mn-color-surface-canvas)', scope)
  const solid = (role: string, host: Rgba = canvas) => over(colour(`var(${role})`, scope), host)
  const rows: Array<{ fg: string; bg: string; ratio: number }> = []
  for (const fg of TEXT_ROLES) for (const bg of SURFACES) rows.push({ fg, bg, ratio: contrast(solid(fg, solid(bg)), solid(bg)) })
  for (const [fg, bg] of PAIRS) rows.push({ fg, bg, ratio: contrast(solid(fg, solid(bg)), solid(bg)) })
  for (const host of WASH_HOSTS) {
    for (const wash of WASHES) {
      const under = solid(host)
      const washed = over(colour(`var(${wash})`, scope), under)
      rows.push({ fg: '--mn-color-text-primary', bg: `${wash} over ${host}`, ratio: contrast(solid('--mn-color-text-primary', washed), washed) })
    }
  }
  return rows
}

const fmt = (rows: Array<{ fg: string; bg: string; ratio: number }>) => rows.map(r => `${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)}`)

describe('@shrubbery/tokens — Hotdog Stand: WCAG AA', () => {
  it('light: every text role clears 4.5:1 on every neutral surface, bar, status pair and wash', () => {
    expect(fmt(table('light').filter(r => r.ratio < 4.5))).toEqual([])
  })

  it('dark: every text role clears 4.5:1 on every neutral surface, bar, status pair and wash', () => {
    expect(fmt(table('dark').filter(r => r.ratio < 4.5))).toEqual([])
  })

  it('UI boundaries and the focus ring clear 3:1 against the surfaces they enclose, in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const scope = cascade(theme)
      const solid = (role: string) => over(colour(`var(${role})`, scope), colour('var(--mn-color-surface-canvas)', scope))
      const failing: string[] = []
      for (const border of ['--mn-color-border-default', '--mn-color-border-strong', '--mn-color-border-focus']) {
        for (const host of ['--mn-color-surface-base', '--mn-color-surface-panel', '--mn-color-surface-sunken']) {
          const ratio = contrast(solid(border), solid(host))
          if (ratio < 3) failing.push(`${theme} ${border} on ${host}: ${ratio.toFixed(2)}`)
        }
      }
      expect(failing).toEqual([])
    }
  })

  it('light: prefers-contrast: more lifts every grey text role to ink — AAA on the reading surfaces', () => {
    const scope = cascade('light', true)
    const failing: string[] = []
    for (const bg of ['--mn-color-surface-base', '--mn-color-surface-panel', '--mn-color-surface-editor', '--mn-color-surface-sunken']) {
      for (const fg of ['--mn-color-text-secondary', '--mn-color-text-tertiary', '--mn-color-text-muted', '--mn-color-text-quiet']) {
        const ratio = contrast(colour(`var(${fg})`, scope), colour(`var(${bg})`, scope))
        if (ratio < 7) failing.push(`${fg} on ${bg}: ${ratio.toFixed(2)}`)
      }
    }
    expect(failing).toEqual([])
  })

  it('reduced transparency turns every interaction wash solid, in both themes, and the ink clears AA through them', () => {
    for (const theme of ['light', 'dark'] as const) {
      const scope = cascade(theme, false, true)
      for (const role of ['--mn-color-surface-hover', '--mn-color-surface-active', '--mn-color-interactive-hover',
        '--mn-color-interactive-active', '--mn-color-interactive-selected']) {
        const wash = colour(`var(${role})`, scope)
        expect(wash[3], `${theme} ${role} is solid`).toBe(1)
        expect(contrast(colour('var(--mn-color-text-primary)', scope), wash), `${theme} ${role}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('the accent differs from every other skin\'s accent (storybook\'s test-runner requires a distinct --mn-color-accent per skin)', () => {
    // The runner compares the COMPUTED custom-property text on the same element across skins,
    // so resolve each skin's accent through its own cascade (roots + its block), as a browser would.
    const accents = new Map<string, string>()
    const base = roots()
    accents.set('garden', expand(base['--mn-color-accent'], base).toLowerCase())
    for (const f of readdirSync(CSS_DIR).filter(x => /^skin-.+\.css$/.test(x) && x !== FILE)) {
      const name = f.slice(5, -4)
      if (name === 'garden') continue
      // A skin file may also declare bespoke tokens at :root (Emporium's --emporium-accent does).
      const scope: Block = { ...base, ...blockOf(read(f), ':root'), ...blockOf(read(f), `[data-skin="${name}"]`) }
      accents.set(name, expand(scope['--mn-color-accent'], scope).toLowerCase())
    }
    const mine = {
      light: expand(cascade('light')['--mn-color-accent'], cascade('light')).toLowerCase(),
      dark: expand(cascade('dark')['--mn-color-accent'], cascade('dark')).toLowerCase(),
    }
    for (const [theme, value] of Object.entries(mine)) {
      const clash = [...accents].filter(([, v]) => v === value).map(([k]) => k)
      expect(clash, `${theme} accent ${value}`).toEqual([])
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// The ONE named AA exception: Window-coloured surfaces
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Vera's ruling (2026-10-03): the scheme's own pair — Window Text on Window, white on red, 4.00:1 — stays on
 * the Window-coloured surfaces, with an asserted 3:1 floor (large text and UI components clear AA at 3:1; body
 * text does not at 4.00, and that is the cost, taken knowingly). Every chrome surface keeps 4.5:1 — the tables
 * above. The exception is named (these three surfaces and the inks that sit on them), floored, pinned, closed
 * (no other surface may be red), absent in dark (white on maroon is 10.95:1) and void under prefers-contrast: more.
 */
const WINDOW_EXCEPTION = {
  floor: 3,
  surfaces: {
    '--mn-editor-sheet-surface': ['--mn-editor-sheet-ink', '--mn-editor-sheet-title', '--mn-editor-sheet-secondary',
      '--mn-editor-sheet-tertiary', '--mn-editor-sheet-link', '--mn-editor-sheet-link-hover', '--mn-editor-sheet-accent'],
    '--mn-list-surface': ['--mn-list-ink'],
    '--mn-chat-superbar-bg': ['--mn-chat-superbar-text', '--mn-chat-superbar-text-muted'],
  } as Record<string, string[]>,
}

function exceptionRows(theme: 'light' | 'dark', moreContrast = false): Array<{ ink: string; surface: string; ratio: number }> {
  const scope = cascade(theme, moreContrast)
  const rows: Array<{ ink: string; surface: string; ratio: number }> = []
  for (const [surface, inks] of Object.entries(WINDOW_EXCEPTION.surfaces)) {
    const bg = colour(`var(${surface})`, scope)
    expect(bg[3], `${surface} is an opaque surface`).toBe(1)
    for (const ink of inks) rows.push({ ink, surface, ratio: contrast(over(colour(`var(${ink})`, scope), bg), bg) })
  }
  return rows
}

describe('@shrubbery/tokens — Hotdog Stand: the Window exception (named, floored, pinned, closed)', () => {
  it('light: every ink on a Window-coloured surface holds the 3:1 floor', () => {
    expect(exceptionRows('light').filter(r => r.ratio < WINDOW_EXCEPTION.floor).map(r => `${r.ink} on ${r.surface}: ${r.ratio.toFixed(2)}`)).toEqual([])
  })

  it('light: the scheme\'s own pair is what the exception is for — Window Text on Window measures exactly 4.00:1', () => {
    const scope = cascade('light')
    const ratio = contrast(colour('var(--mn-hds-window-text)', scope), colour('var(--mn-hds-window)', scope))
    expect(ratio.toFixed(2)).toBe('4.00')
    for (const row of exceptionRows('light').filter(r => ['--mn-editor-sheet-ink', '--mn-editor-sheet-title', '--mn-list-ink',
      '--mn-chat-superbar-text', '--mn-chat-superbar-text-muted'].includes(r.ink))) {
      expect(row.ratio.toFixed(2), `${row.ink} on ${row.surface}`).toBe('4.00')
    }
  })

  it('the exception is closed: exactly the three named surfaces are Window red in light — a new red surface cannot sneak in', () => {
    const scope = cascade('light')
    const own = { ...light(), ...sheet() }
    const SURFACE_ROLE = /^--mn-(color-surface-|editor-sheet-surface$|list-surface$|[\w-]*-bg$)/
    const reds = Object.keys(own).filter(name => SURFACE_ROLE.test(name)).filter((name) => {
      try {
        const c = colour(`var(${name})`, scope)
        return c[3] === 1 && toHex(c) === '#ff0000'
      } catch {
        return false
      }
    }).sort()
    expect(reds).toEqual(Object.keys(WINDOW_EXCEPTION.surfaces).sort())
  })

  it('chrome never borrows it: no neutral surface or chrome bar is Window red, and chrome text keeps 4.5:1 (the tables above)', () => {
    for (const bg of [...SURFACES, '--mn-top-bar-bg', '--mn-bottom-bar-bg', '--mn-chat-header-bg', '--mn-chat-transcript-bg', '--mn-chat-assistant-bg',
      '--mn-control-background', '--mn-layout-tab-strip-bg']) {
      expect(hexOf('light', bg), bg).not.toBe('#ff0000')
    }
  })

  it('dark: the same surfaces are the maroon Window and need no exception — every ink clears 4.5:1', () => {
    const scope = cascade('dark')
    for (const surface of Object.keys(WINDOW_EXCEPTION.surfaces)) expect(toHex(colour(`var(${surface})`, scope)), surface).toBe('#800000')
    expect(exceptionRows('dark').filter(r => r.ratio < 4.5).map(r => `${r.ink} on ${r.surface}: ${r.ratio.toFixed(2)}`)).toEqual([])
  })

  it('prefers-contrast: more voids the exception: Window and the Inactive Title Bar turn maroon, every ink clears 4.5:1', () => {
    const scope = cascade('light', true)
    expect(toHex(colour('var(--mn-hds-window)', scope))).toBe('#800000')
    expect(toHex(colour('var(--mn-hds-caption-inactive)', scope))).toBe('#800000')
    expect(exceptionRows('light', true).filter(r => r.ratio < 4.5).map(r => `${r.ink} on ${r.surface}: ${r.ratio.toFixed(2)}`)).toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// The bevel vocabulary the shared 98 component blocks read
// ═════════════════════════════════════════════════════════════════════════════

describe('@shrubbery/tokens — Hotdog Stand: the bevel vocabulary the shared component blocks read', () => {
  // The components' 98 blocks (admitted to this skin) read these --mn-98-* names; the skin answers each
  // from its own slots so the blocks need no knowledge of the scheme.
  const TOKENS = ['face', 'highlight', 'light', 'shadow', 'dark', 'caption', 'selection', 'selection-text', 'settings-bg', 'raised', 'sunken']
  const palette = (suffix: string) => decodeIni(INI_LINE)[SLOTS.findIndex(s => s[0] === suffix)]

  it('is defined in light, every name; after hours it follows through the redefined slots', () => {
    for (const t of TOKENS) expect(light()[`--mn-98-${t}`], `--mn-98-${t}`).toBeDefined()
    for (const t of TOKENS) expect(dark()[`--mn-98-${t}`], `dark restates nothing of --mn-98-${t}: the slots carry it`).toBeUndefined()
  })

  it('names the Windows slots: Button Face, Button Highlight, Button Shadow, Window Frame, Highlight on Highlighted Text', () => {
    const at = (theme: 'light' | 'dark', t: string) => toHex(colour(`var(--mn-98-${t})`, cascade(theme)))
    expect(at('light', 'face')).toBe(palette('face'))
    expect(at('light', 'highlight')).toBe(palette('light'))
    expect(at('light', 'shadow')).toBe(palette('shadow'))
    expect(at('light', 'dark')).toBe(palette('frame'))
    expect(at('light', 'caption')).toBe(palette('caption'))
    expect(at('light', 'selection')).toBe(palette('highlight'))
    expect(at('light', 'selection-text')).toBe(palette('highlight-text'))
    // After hours: Highlight is yellow, so its text is black — the one place a hard-coded #fff would fail.
    expect(at('dark', 'selection')).toBe('#ffff00')
    expect(at('dark', 'selection-text')).toBe('#000000')
  })

  it('raised and sunken are framed bevels: the Window Frame ring, then highlight and shadow, hard-edged', () => {
    for (const t of ['raised', 'sunken']) {
      const v = expand(cascade('light')[`--mn-98-${t}`], cascade('light'))
      expect(v, t).toContain(`0 0 0 1px ${palette('frame')}`)
      expect(v, t).not.toMatch(/blur|rgba|gradient/)
      for (const shadow of v.split(/,(?![^()]*\))/)) expect(shadow.trim().split(/\s+/).filter(x => /^-?\d+px$/.test(x)).length, shadow).toBeLessThanOrEqual(3)
    }
  })
})
