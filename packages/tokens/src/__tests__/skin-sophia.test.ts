/**
 * REAL test of the Sophia skin ([data-skin=emporium], labelled "Sophia") — NO
 * MOCKS. It resolves the shipped token CSS through the root-element cascade
 * (token-cascade.ts) exactly as the browser would for <html data-skin=emporium
 * data-theme=…>, then measures what the skin paints.
 *
 *   1. the primary is Sophia Blue, #00356B, in the CSS and in the TS constants;
 *   2. nothing the skin paints is purple any more;
 *   3. WCAG AA: every text role on every surface it can sit on (washes
 *      composited), ink on every fill, and the non-text marks at 3:1, in light
 *      AND dark;
 *   4. dark is designed, not inherited: every colour the light block sets is
 *      restated for dark, and every role theme-dark.css sets is answered.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMPORIUM_ACCENT, SKIN_LABELS, SOPHIA_BLUE, SOPHIA_BLUE_RAMP } from '../index.js'
import {
  compositeOver, contrast, effectiveTokens, layerDeclarations, paintedColour, type Rgba,
  type RootAttributes, resolveToken,
} from './token-cascade.js'
import { REPO_ROOT, stripComments, TOKEN_CSS_DIR } from './token-reference-scan.js'

type Theme = 'light' | 'dark'
const root = (theme: Theme): RootAttributes => ({ skin: 'emporium', theme })
const WHITE: Rgba = [255, 255, 255, 1]

function colour(theme: Theme, name: string): Rgba {
  const resolved = resolveToken(effectiveTokens(root(theme)), name)
  const painted = paintedColour(resolved)
  if (!painted) throw new Error(`${theme} ${name} is not a readable colour: ${resolved}`)
  return painted
}

const hex = (c: Rgba) => `#${c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`

/** Opaque surfaces, and translucent ones composited over what they sit on. */
function surfaces(theme: Theme): Record<string, Rgba> {
  const solid = (name: string, under: Rgba = WHITE) => compositeOver(colour(theme, name), under)
  const base = solid('--mn-color-surface-base')
  const panel = solid('--mn-color-surface-panel')
  return {
    canvas: solid('--mn-color-surface-canvas'),
    panel,
    chrome: solid('--mn-color-surface-chrome'),
    base,
    editor: solid('--mn-color-surface-editor'),
    subtle: solid('--mn-color-surface-subtle'),
    sunken: solid('--mn-color-surface-sunken'),
    raised: solid('--mn-color-surface-raised'),
    elevated: solid('--mn-color-surface-elevated'),
    overlay: solid('--mn-color-surface-overlay'),
    warm: solid('--mn-color-surface-warm', base),
    'hover (on the panel)': solid('--mn-color-surface-hover', panel),
    'active (on the panel)': solid('--mn-color-surface-active', panel),
    'accent (on the panel)': solid('--mn-color-surface-accent', panel),
    'accent-strong, the selected row (on the panel)': solid('--mn-color-surface-accent-strong', panel),
    'interactive-selected (on the base)': solid('--mn-color-interactive-selected', base),
  }
}

const TEXT_ROLES = [
  '--mn-color-text-title', '--mn-color-text-primary', '--mn-color-text-secondary', '--mn-color-text-tertiary',
  '--mn-color-text-muted', '--mn-color-text-quiet', '--mn-color-text-accent', '--mn-color-text-accent-strong',
  '--mn-color-text-link', '--mn-color-text-link-hover', '--mn-color-text-danger', '--mn-color-text-warning',
  '--mn-color-text-success',
] as const

/** Ink on its own fill or band: [ink, ground, ground painted over]. */
const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ['--mn-color-text-on-accent', '--mn-color-accent', '--mn-color-surface-base'],
  ['--mn-color-text-on-accent', '--mn-color-accent-hover', '--mn-color-surface-base'],
  ['--mn-color-text-on-accent', '--mn-color-accent-active', '--mn-color-surface-base'],
  ['--mn-color-on-danger', '--mn-color-action-danger', '--mn-color-surface-base'],
  ['--mn-color-on-warning', '--mn-color-action-warning', '--mn-color-surface-base'],
  ['--mn-top-bar-text', '--mn-top-bar-bg', '--mn-color-surface-base'],
  ['--mn-top-bar-text-muted', '--mn-top-bar-bg', '--mn-color-surface-base'],
  ['--mn-bottom-bar-text', '--mn-bottom-bar-bg', '--mn-color-surface-base'],
  ['--mn-bottom-bar-text-muted', '--mn-bottom-bar-bg', '--mn-color-surface-base'],
  ['--mn-color-danger', '--mn-color-danger-surface', '--mn-color-surface-base'],
  ['--mn-color-warning', '--mn-color-warning-surface', '--mn-color-surface-base'],
  ['--mn-color-success', '--mn-color-success-surface', '--mn-color-surface-base'],
  ['--mn-color-info', '--mn-color-info-surface', '--mn-color-surface-base'],
  ['--mn-color-text-primary', '--mn-color-danger-surface', '--mn-color-surface-base'],
  ['--mn-color-text-primary', '--mn-color-warning-surface', '--mn-color-surface-base'],
  ['--mn-color-text-primary', '--mn-color-success-surface', '--mn-color-surface-base'],
]

/** Non-text marks (WCAG 1.4.11): [mark, ground] at 3:1. */
const MARKS: ReadonlyArray<readonly [string, string]> = [
  ['--mn-color-accent', '--mn-color-surface-base'],
  ['--mn-color-accent', '--mn-color-surface-panel'],
  ['--mn-color-accent', '--mn-color-surface-raised'],
  ['--mn-focus-ring-color', '--mn-color-surface-base'],
  ['--mn-focus-ring-color', '--mn-color-surface-panel'],
  ['--mn-focus-ring-color', '--mn-color-surface-elevated'],
  ['--mn-color-border-focus', '--mn-color-surface-raised'],
  ['--mn-color-border-accent', '--mn-color-surface-panel'],
  ['--mn-color-danger', '--mn-color-surface-base'],
  ['--mn-color-warning', '--mn-color-surface-base'],
  ['--mn-color-success', '--mn-color-surface-base'],
]

interface ContrastRow { readonly theme: Theme; readonly fg: string; readonly bg: string; readonly ratio: number; readonly floor: number }

/** Every measured pair, for the report and for the assertions below. */
function sophiaContrastTable(theme: Theme): ContrastRow[] {
  const rows: ContrastRow[] = []
  const grounds = surfaces(theme)
  for (const fg of TEXT_ROLES) {
    for (const [bg, ground] of Object.entries(grounds)) {
      rows.push({ theme, fg, bg, ratio: contrast(compositeOver(colour(theme, fg), ground), ground), floor: 4.5 })
    }
  }
  for (const [fg, bg, under] of PAIRS) {
    const ground = compositeOver(colour(theme, bg), compositeOver(colour(theme, under), WHITE))
    rows.push({ theme, fg, bg, ratio: contrast(compositeOver(colour(theme, fg), ground), ground), floor: 4.5 })
  }
  for (const [mark, bg] of MARKS) {
    const ground = compositeOver(colour(theme, bg), WHITE)
    rows.push({ theme, fg: mark, bg, ratio: contrast(compositeOver(colour(theme, mark), ground), ground), floor: 3 })
  }
  return rows
}

const failures = (theme: Theme) => sophiaContrastTable(theme)
  .filter(row => row.ratio < row.floor)
  .map(row => `${row.fg} on ${row.bg}: ${row.ratio.toFixed(2)} < ${row.floor}`)

describe('Sophia skin: the primary is Sophia Blue', () => {
  it('is the skin the picker labels "Sophia"', () => {
    expect(SKIN_LABELS.emporium).toBe('Sophia')
  })

  it('pins Sophia Blue to #00356B (sRGB 0, 53, 107), step 800 of its ramp', () => {
    expect(SOPHIA_BLUE).toBe('#00356B')
    expect(paintedColour(SOPHIA_BLUE)).toEqual([0, 53, 107, 1])
    expect(SOPHIA_BLUE_RAMP[800]).toBe(SOPHIA_BLUE)
    expect(SOPHIA_BLUE_RAMP[950].toLowerCase()).toBe('#0c2340')
    expect(EMPORIUM_ACCENT.accent).toBe(SOPHIA_BLUE)
  })

  it('light: the accent, accent text, the selected-row rule, the masthead names and the paper accent all paint #00356B', () => {
    for (const role of ['--mn-color-accent', '--mn-color-text-accent', '--mn-color-border-accent', '--mn-top-bar-text', '--mn-editor-paper-accent']) {
      expect(hex(colour('light', role)), role).toBe('#00356b')
    }
  })

  it('dark: the accent is a lighter tint of the same hue, and the masthead the deepest shade', () => {
    expect(hex(colour('dark', '--mn-color-accent'))).toBe(SOPHIA_BLUE_RAMP[300])
    expect(hex(colour('dark', '--mn-top-bar-bg'))).toBe(SOPHIA_BLUE_RAMP[950].toLowerCase())
    // the tint keeps the hue: OKLCH hue within 3° of Sophia Blue's
    expect(Math.abs(oklchHue(colour('dark', '--mn-color-accent')) - oklchHue(paintedColour(SOPHIA_BLUE)!))).toBeLessThan(3)
  })
})

/** OKLCH hue (degrees) and chroma of an opaque colour. */
function oklch([r, g, b]: Rgba): { hue: number; chroma: number } {
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { hue: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360, chroma: Math.hypot(a, bb) }
}
const oklchHue = (c: Rgba) => oklch(c).hue

describe('Sophia skin: nothing it paints is purple', () => {
  const SKIN_FILE = join(REPO_ROOT, TOKEN_CSS_DIR, 'skin-emporium.css')
  const declared = layerDeclarations().filter(d => d.file.endsWith('/skin-emporium.css'))

  it('reads no purple reference token', () => {
    expect(stripComments(readFileSync(SKIN_FILE, 'utf8'))).not.toMatch(/--mn-ref-purple-/)
  })

  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: every colour role it sets sits outside the violet hues (OKLCH 280°-340°) once chroma shows`, () => {
      const purple: string[] = []
      for (const name of new Set(declared.map(d => d.name))) {
        const painted = paintedColour(resolveToken(effectiveTokens(root(theme)), name))
        if (!painted || painted[3] === 0) continue
        const { hue, chroma } = oklch(compositeOver(painted, WHITE))
        if (chroma > 0.02 && hue >= 280 && hue <= 340) purple.push(`${name} ${hue.toFixed(0)}°`)
      }
      expect(purple).toEqual([])
    })
  }
})

describe('Sophia skin: WCAG AA contrast, light and dark', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: every text role clears 4.5:1 on every surface, ink clears 4.5:1 on every fill, marks clear 3:1`, () => {
      expect(failures(theme)).toEqual([])
    })

    it(`${theme}: body ink is comfortable, not merely legal (primary ≥ 12:1, secondary ≥ 6.5:1 on the reading surfaces)`, () => {
      const rows = sophiaContrastTable(theme).filter(r => ['base', 'editor', 'panel'].includes(r.bg))
      const at = (fg: string) => Math.min(...rows.filter(r => r.fg === fg).map(r => r.ratio))
      expect(at('--mn-color-text-primary')).toBeGreaterThanOrEqual(12)
      expect(at('--mn-color-text-secondary')).toBeGreaterThanOrEqual(6.5)
    })
  }

  it('measures with a meter that fails a pair below the floor (the Garden fern-500 masthead muted ink read 3.4:1)', () => {
    expect(contrast(paintedColour('#4a8860')!, paintedColour('#dbecde')!)).toBeLessThan(4.5)
    expect(contrast(paintedColour('#00356b')!, WHITE)).toBeGreaterThan(12)
  })
})

describe('Sophia skin: dark is a design of its own, not an inheritance', () => {
  const DARK = '[data-theme="dark"][data-skin="emporium"], [data-theme="dark"][data-design="emporium"]'
  const LIGHT = '[data-skin="emporium"], [data-design="emporium"]'
  const skinDecls = layerDeclarations().filter(d => d.file.endsWith('/skin-emporium.css') && !d.conditional)
  const lightNames = new Set(skinDecls.filter(d => d.selector === LIGHT).map(d => d.name))
  const darkNames = new Set(skinDecls.filter(d => d.selector === DARK).map(d => d.name))
  /** Roles that are theme-invariant on purpose. */
  const INVARIANT = /^--mn-(editor-paper-|font-|radius-|row-height|control-height|label-display|texture-display|tracking-|focus-ring$|material-(popover-(tint|solid|bg|filter|shadow)|specular|lift)$|shadow-card$)/

  it('restates for dark every colour the light block sets (a light value would otherwise show through)', () => {
    const missing = [...lightNames].filter(name => !INVARIANT.test(name) && !darkNames.has(name)).sort()
    expect(missing).toEqual([])
  })

  it('answers every role theme-dark.css sets, except the global dataviz and contested-stance roles', () => {
    const themeDark = layerDeclarations().filter(d => d.file.endsWith('/theme-dark.css') && d.selector === '[data-theme="dark"]')
    const GLOBAL = /^--mn-(chart-|stance-contested-|color-interactive-hover$|shadow-primary$)/
    const unanswered = [...new Set(themeDark.map(d => d.name))]
      .filter(name => !GLOBAL.test(name) && !darkNames.has(name) && !lightNames.has(name)).sort()
    expect(unanswered).toEqual([])
  })

  it('climbs with elevation: canvas < panel < base < editor < raised < elevated < overlay in lightness', () => {
    const order = ['canvas', 'panel', 'base', 'editor', 'raised', 'elevated', 'overlay'] as const
    const s = surfaces('dark')
    const lum = (c: Rgba) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    for (let i = 1; i < order.length; i++) {
      expect(lum(s[order[i]!]!), `${order[i]} above ${order[i - 1]}`).toBeGreaterThanOrEqual(lum(s[order[i - 1]!]!))
    }
  })
})
