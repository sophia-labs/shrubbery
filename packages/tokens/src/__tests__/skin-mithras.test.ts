/**
 * REAL test of the Mithras skin — NO MOCKS. Reads the shipped CSS and Flow's
 * own vendored stylesheet from disk.
 *
 *   1. css/flow-tokens.css is exactly what the generator makes from Flow's
 *      vendored styles.css today (the drift fence);
 *   2. skin-mithras.css maps Flow's values onto the --mn-* roles and types no
 *      Flow value of its own;
 *   3. the light-only pin is complete (every role theme-dark sets is restated)
 *      and the applier stamps light for this skin;
 *   4. every text role meets WCAG AA (4.5:1) on every surface it can sit on.
 */
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MITHRAS_FLOW_PALETTE,
  MITHRAS_FONT_SANS,
  SKIN_APPLICATIONS,
  VISUAL_IDENTITY_SKINS,
  applySkinTheme,
  effectiveTheme,
  type AttrTarget,
} from '../index.js'
import { extractFlowTokens, flowTokenSource, renderFlowTokensCss } from '../flow-tokens.js'

const here = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(here, '../../../..')
// This repository carries no apps/flow/ (a vendored app that is not redistributable): the two tests that read Flow's vendored
// stylesheet skip there and run wherever the vendor drop is present.
const FLOW_VENDORED = existsSync(resolve(REPO, 'apps/flow/vendor/flow/src/styles.css'))
const CSS_DIR = resolve(here, '../../css')
const read = (f: string) => readFileSync(resolve(CSS_DIR, f), 'utf8')

type Block = Record<string, string>

/** Declarations of one selector, ignoring @media blocks (asserted separately). */
function blockOf(css: string, selector: string, media: string | null = null): Block {
  let clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  if (media) {
    const start = clean.indexOf(`@media ${media}`)
    if (start < 0) return {}
    const open = clean.indexOf('{', start)
    let depth = 1
    let i = open + 1
    for (; i < clean.length && depth > 0; i++) {
      if (clean[i] === '{') depth++
      else if (clean[i] === '}') depth--
    }
    clean = clean.slice(open + 1, i - 1)
  } else {
    clean = clean.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
  }
  const out: Block = {}
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(clean)) !== null) {
    const selectors = m[1].split(',').map(s => s.trim())
    if (!selectors.includes(selector)) continue
    const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g
    let d: RegExpExecArray | null
    while ((d = declRe.exec(m[2])) !== null) out[d[1]] = d[2].trim().replace(/\s+/g, ' ')
  }
  return out
}

const flowRoot = blockOf(read('flow-tokens.css'), ':root')
const semanticRoot = blockOf(read('semantic.css'), ':root')
const refRoot = blockOf(read('reference.css'), ':root')
const LIGHT = '[data-skin="mithras"]'
const DARK = '[data-theme="dark"][data-skin="mithras"]'
const light = blockOf(read('skin-mithras.css'), LIGHT)
const dark = blockOf(read('skin-mithras.css'), DARK)

// ── A small resolver for hex colours, var() chains and color-mix(in srgb) ────

type Rgba = [number, number, number, number]

function hex(value: string): Rgba | null {
  const m = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1]
}

function lookup(name: string, block: Block): string | undefined {
  return block[name] ?? flowRoot[name] ?? refRoot[name] ?? semanticRoot[name]
}

function expand(raw: string, block: Block, depth = 0): string {
  if (depth > 10) throw new Error(`var() chain too deep: ${raw}`)
  return raw.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name: string) => {
    const v = lookup(name, block)
    if (v === undefined) throw new Error(`unresolved ${name}`)
    return expand(v, block, depth + 1)
  })
}

function colour(raw: string, block: Block): Rgba {
  const v = expand(raw, block).trim()
  if (v === 'transparent') return [0, 0, 0, 0]
  const h = hex(v)
  if (h) return h
  const mix = v.match(/^color-mix\(in srgb,\s*(#[0-9a-f]+)\s+(?:calc\(\s*(\d+)\s*\*\s*)?(\d+)%\)?\s*,\s*(#[0-9a-f]+|transparent)\s*\)$/i)
  if (mix) {
    const a = hex(mix[1])!
    const pct = (mix[2] ? Number(mix[2]) : 1) * Number(mix[3]) / 100
    const b: Rgba = mix[4] === 'transparent' ? [a[0], a[1], a[2], 0] : hex(mix[4])!
    // srgb mix with premultiplied alpha, as CSS Color 5 specifies.
    const alpha = a[3] * pct + b[3] * (1 - pct)
    const ch = (i: number) => alpha === 0 ? 0 : (a[i] * a[3] * pct + b[i] * b[3] * (1 - pct)) / alpha
    return [ch(0), ch(1), ch(2), alpha]
  }
  throw new Error(`not a resolvable colour: ${raw} → ${v}`)
}

function over(fg: Rgba, bg: Rgba): Rgba {
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

export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ─────────────────────────────────────────────────────────────────────────────

describe('@shrubbery/tokens — Mithras skin: Flow values have one source', () => {
  it.skipIf(!FLOW_VENDORED)('flow-tokens.css is exactly what the generator makes from Flow\'s vendored styles.css', () => {
    const { stylesCss, provenance } = flowTokenSource(
      path => readFileSync(resolve(REPO, path), 'utf8'),
      text => createHash('sha256').update(text).digest('hex'),
    )
    expect(read('flow-tokens.css')).toBe(renderFlowTokensCss(stylesCss, provenance))
    // The vendored stylesheet is itself byte-pinned (apps/flow VENDOR.md).
    expect(provenance.sha256).toBe('c537db49f8a3e1699876995577414dbc6645ebe8e72cce8a5e2880eacaffac23')
  })

  it('the exported palette constants agree with the generated file', () => {
    expect(flowRoot['--mn-ref-flow-ink']).toBe(MITHRAS_FLOW_PALETTE.ink)
    expect(flowRoot['--mn-ref-flow-ink-soft']).toBe(MITHRAS_FLOW_PALETTE.inkSoft)
    expect(flowRoot['--mn-ref-flow-ink-faint']).toBe(MITHRAS_FLOW_PALETTE.inkFaint)
    expect(flowRoot['--mn-ref-flow-line']).toBe(MITHRAS_FLOW_PALETTE.line)
    expect(flowRoot['--mn-ref-flow-paper']).toBe(MITHRAS_FLOW_PALETTE.paper)
    expect(flowRoot['--mn-ref-flow-paper-dim']).toBe(MITHRAS_FLOW_PALETTE.paperDim)
    expect(flowRoot['--mn-ref-flow-warn']).toBe(MITHRAS_FLOW_PALETTE.warn)
    expect(flowRoot['--mn-ref-flow-font']).toBe(MITHRAS_FONT_SANS)
  })

  it.skipIf(!FLOW_VENDORED)('never ships the GT faces (licence unresolved) — only Flow\'s fallback stack', () => {
    const tokens = extractFlowTokens(readFileSync(resolve(REPO, 'apps/flow/vendor/flow/src/styles.css'), 'utf8'))
    expect(tokens.font).not.toMatch(/GT /)
    expect(tokens['font-display']).not.toMatch(/GT /)
    expect(read('skin-mithras.css').replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/GT (Eesti|Pantheon)|woff2/)
  })

  it('the skin types no Flow palette value of its own — it reads --mn-ref-flow-*', () => {
    const body = read('skin-mithras.css').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const value of Object.values(MITHRAS_FLOW_PALETTE)) {
      expect(body.toLowerCase(), `literal ${value}`).not.toMatch(new RegExp(`${value}(?![0-9a-f])`, 'i'))
    }
  })
})

describe('@shrubbery/tokens — Mithras skin: role mapping', () => {
  it('is a selectable visual identity stamped as [data-skin=mithras]', () => {
    expect(VISUAL_IDENTITY_SKINS).toContain('mithras')
    expect(SKIN_APPLICATIONS.mithras.appliesAttribute).toBe('[data-skin=mithras]')
  })

  it('paper surfaces, ink text/accent, hairline borders — Flow\'s whiteboard', () => {
    const c = (role: string) => colour(light[role], light)
    expect(c('--mn-color-surface-base')).toEqual(hex('#fff'))
    expect(c('--mn-color-surface-editor')).toEqual(hex('#fff'))
    expect(c('--mn-color-surface-panel')).toEqual(hex('#fafafa'))
    expect(c('--mn-color-text-primary')).toEqual(hex('#111'))
    expect(c('--mn-color-text-secondary')).toEqual(hex('#555'))
    expect(c('--mn-color-accent')).toEqual(hex('#111'))
    expect(c('--mn-color-text-on-accent')).toEqual(hex('#fff'))
    expect(c('--mn-color-border-default')).toEqual(hex('#d9d9d9'))
    expect(c('--mn-color-border-focus')).toEqual(hex('#111'))
    expect(c('--mn-color-danger')).toEqual(hex('#b91c1c'))
    expect(c('--mn-top-bar-bg')).toEqual(hex('#fff'))
    expect(c('--mn-top-bar-border')).toEqual(hex('#d9d9d9'))
    expect(light['--mn-color-accent-ch']).toBe('17 17 17')
  })

  it('Flow\'s type: fallback stack for chrome, prose and display; 300 body, 500 emphasis', () => {
    for (const role of ['--mn-font-chrome', '--mn-font-prose', '--mn-font-display', '--mn-font-sans']) {
      expect(expand(light[role], light), role).toBe(MITHRAS_FONT_SANS)
    }
    expect(expand(light['--mn-font-weight-normal'], light)).toBe('300')
    expect(expand(light['--mn-font-weight-semibold'], light)).toBe('500')
  })

  it('square geometry and Flow\'s one hard shadow; solid floating material', () => {
    for (const r of ['--mn-radius-control', '--mn-radius-surface', '--mn-radius-md', '--mn-radius-xl']) {
      expect(light[r], r).toBe('0')
    }
    expect(expand(light['--mn-shadow-popover'], light)).toBe('2px 2px 0 rgb(0 0 0 / 12%)')
    expect(expand(light['--mn-material-popover-shadow'], light)).toBe('2px 2px 0 rgb(0 0 0 / 12%)')
    expect(colour(light['--mn-material-popover-bg'], light)).toEqual(hex('#fff'))
    expect(light['--mn-material-popover-filter']).toBe('none')
    expect(light['--mn-window-backdrop-filter']).toBe('none')
    expect(light['--mn-shadow-card']).toBe('none')
  })

  it('focus is Flow\'s 2px ink ring, offset 2px by paper', () => {
    expect(expand(light['--mn-focus-ring'], light)).toBe('0 0 0 2px #fff, 0 0 0 calc(2px + 2px) #111')
  })
})

describe('@shrubbery/tokens — Mithras skin: light-only (Flow has no dark mode)', () => {
  it('restates every role theme-dark.css sets, under the dark selector', () => {
    const themeDark = blockOf(read('theme-dark.css'), '[data-theme="dark"]')
    const missing = Object.keys(themeDark).filter(role => dark[role] === undefined)
    expect(missing).toEqual([])
    expect(dark).toEqual(light)
  })

  it('the applier stamps light for mithras whatever theme is requested', () => {
    const attrs = new Map<string, string>()
    const target: AttrTarget = {
      setAttribute: (n, v) => { attrs.set(n, v) },
      removeAttribute: n => { attrs.delete(n) },
    }
    applySkinTheme({ skin: 'mithras', theme: 'dark', target })
    expect(attrs.get('data-skin')).toBe('mithras')
    expect(attrs.get('data-theme')).toBe('light')
    expect(effectiveTheme('mithras', 'dark')).toBe('light')
    expect(effectiveTheme('garden', 'dark')).toBe('dark')
    applySkinTheme({ skin: 'garden', theme: 'dark', target })
    expect(attrs.get('data-theme')).toBe('dark')
  })
})

// ── WCAG AA ──────────────────────────────────────────────────────────────────

const TEXT_ROLES = [
  '--mn-color-text-primary', '--mn-color-text-secondary', '--mn-color-text-tertiary',
  '--mn-color-text-muted', '--mn-color-text-quiet', '--mn-color-text-accent',
  '--mn-color-text-link', '--mn-color-text-danger', '--mn-color-text-warning',
  '--mn-color-text-success',
]
const SURFACES = [
  '--mn-color-surface-base', '--mn-color-surface-panel', '--mn-color-surface-subtle',
  '--mn-color-surface-sunken', '--mn-color-surface-accent', '--mn-color-surface-accent-strong',
]
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--mn-top-bar-text', '--mn-top-bar-bg'],
  ['--mn-top-bar-text-muted', '--mn-top-bar-bg'],
  ['--mn-bottom-bar-text', '--mn-bottom-bar-bg'],
  ['--mn-bottom-bar-text-muted', '--mn-bottom-bar-bg'],
  ['--mn-color-text-on-accent', '--mn-color-accent'],
  ['--mn-color-text-on-accent', '--mn-color-accent-hover'],
  ['--mn-color-on-danger', '--mn-color-action-danger'],
  ['--mn-color-on-warning', '--mn-color-action-warning'],
  ['--mn-color-text-danger', '--mn-color-danger-surface'],
  ['--mn-color-warning', '--mn-color-warning-surface'],
  ['--mn-color-success', '--mn-color-success-surface'],
]

/** Every ratio, for the proof report. */
export function mithrasContrastTable(block: Block = light): Array<{ fg: string; bg: string; ratio: number }> {
  const paper = colour('var(--mn-ref-flow-paper)', block)
  const solid = (role: string) => over(colour(block[role], block), paper)
  const rows: Array<{ fg: string; bg: string; ratio: number }> = []
  for (const fg of TEXT_ROLES) for (const bg of SURFACES) rows.push({ fg, bg, ratio: contrast(solid(fg), solid(bg)) })
  for (const [fg, bg] of PAIRS) rows.push({ fg, bg, ratio: contrast(solid(fg), solid(bg)) })
  return rows
}

describe('@shrubbery/tokens — Mithras skin: WCAG AA text contrast', () => {
  it('every text role clears 4.5:1 on every Mithras surface and bar', () => {
    const failing = mithrasContrastTable().filter(r => r.ratio < 4.5).map(r => `${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)}`)
    expect(failing).toEqual([])
  })

  it('more-contrast mode lifts the grey roles to ink-soft or ink', () => {
    const more = { ...light, ...blockOf(read('skin-mithras.css'), LIGHT, '(prefers-contrast: more)') }
    expect(colour(more['--mn-color-text-tertiary'], more)).toEqual(hex('#555'))
    expect(colour(more['--mn-color-text-secondary'], more)).toEqual(hex('#111'))
    expect(colour(more['--mn-color-border-strong'], more)).toEqual(hex('#111'))
    // AAA (7:1) for every grey text role on the reading surfaces (paper, panel).
    const failing = mithrasContrastTable(more)
      .filter(r => /surface-(base|panel)$/.test(r.bg) && r.fg.includes('text-') && !/danger|warning|success/.test(r.fg))
      .filter(r => r.ratio < 7)
    expect(failing.map(r => `${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)}`)).toEqual([])
    expect(mithrasContrastTable(more).filter(r => r.ratio < 4.5)).toEqual([])
  })

  it('reduced transparency turns the interaction washes solid', () => {
    const rt = blockOf(read('skin-mithras.css'), LIGHT, '(prefers-reduced-transparency: reduce)')
    for (const role of ['--mn-color-surface-hover', '--mn-color-interactive-hover', '--mn-color-interactive-selected']) {
      expect(colour(rt[role], { ...light, ...rt })[3], role).toBe(1)
    }
  })
})
