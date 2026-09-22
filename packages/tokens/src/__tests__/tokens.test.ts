/**
 * REAL token test — NO MOCKS.
 *
 * We read the EMITTED CSS files from disk (css/*.css), tokenize their custom-
 * property declarations per selector block, resolve var() chains through the
 * reference ramp, and assert the skin/theme blocks define the expected token
 * VALUES. This is a real parse of the shipped CSS — there is no hand-written
 * mock token bag anywhere. The Emporium accent MUST resolve to purple-400
 * (#9472CE, Vera's iter-4a pick), the chrome font to Diatype, and BOTH must
 * differ from Garden.
 *
 * (The in-browser getComputedStyle confirmation runs later in iteration 3c via
 * Playwright against the real Storybook; happy-dom does not resolve the CSS
 * cascade across attribute selectors, so here we resolve from the source of
 * truth — the CSS text itself — which is the strongest assertion we can make
 * without a real engine.)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PURPLE_RAMP,
  EMPORIUM_ACCENT,
  EMPORIUM_FONT_SANS,
  RESEARCH_ACCENT,
  RESEARCH_FONT_SERIF,
  GREENHOUSE_ACCENT,
  GREENHOUSE_STANCE,
  GREENHOUSE_FONT_SANS,
  CONTESTED_STANCE,
  ROOM_POSTURE_STANCES,
  GARDEN_ACCENT,
  GARDEN_FONT_CHROME,
  OBSERVATORY_ACCENT,
  OBSERVATORY_CHART_CATEGORICAL,
  OBSERVATORY_CHART_SEQUENTIAL_AZURE,
  OBSERVATORY_CHART_DIVERGING,
  OBSERVATORY_CHART_STATUS,
  NINETY_EIGHT_FONT_SANS,
  NINETY_EIGHT_PALETTE,
  GLASS_FONT_SANS,
  GLASS_PALETTE,
  VISUAL_IDENTITY_SKINS,
  SKIN_APPLICATIONS,
  THEME_APPLICATIONS,
  EDITOR_MATERIAL_APPLICATIONS,
  STANCE_APPLICATIONS,
  KIND_APPLICATIONS,
  applyKind,
  applySkinTheme,
  applySkin,
  applyTheme,
  applyEditorMaterial,
  applyStance,
  nextVisualIdentitySkin,
  Z_LAYERS,
  type AttrTarget,
  type DisplayKindRegister,
} from '../index.js'

const CSS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../css')
const read = (f: string) => readFileSync(resolve(CSS_DIR, f), 'utf8')

// ── A tiny, dependency-free CSS custom-property reader ────────────────────────
// Splits a stylesheet into { selector → { --prop: rawValue } } blocks. Good
// enough for our flat token files (no nesting, no media queries inside blocks).
type Block = Record<string, string>
function parseBlocks(css: string): Map<string, Block> {
  // Strip comments first.
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = new Map<string, Block>()
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(clean)) !== null) {
    const selector = m[1].trim()
    const body = m[2]
    const block: Block = out.get(selector) ?? {}
    const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g
    let d: RegExpExecArray | null
    while ((d = declRe.exec(body)) !== null) {
      block[d[1].trim()] = d[2].trim()
    }
    // Multiple selectors can share a body (e.g. emporium + alias) → comma-split.
    for (const sel of selector.split(',').map(s => s.trim())) {
      out.set(sel, { ...(out.get(sel) ?? {}), ...block })
    }
  }
  return out
}

// The reference ramp (Tier 0) — the only place raw hexes live.
const refBlocks = parseBlocks(read('reference.css'))
const refRoot = refBlocks.get(':root') ?? {}

// The semantic + component :root scopes (Tier 1/2 defaults). A skin block that
// references a scale token like var(--mn-radius-none) resolves it from here.
const semanticRoot = parseBlocks(read('semantic.css')).get(':root') ?? {}
const componentRoot = parseBlocks(read('component.css')).get(':root') ?? {}
const baseRoot: Block = { ...refRoot, ...semanticRoot, ...componentRoot }

/** Normalize a resolved leaf value: lowercase bare hex colors, leave others. */
function norm(v: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v.toLowerCase() : v
}

/** Resolve a raw token value through var(--mn-ref-*) one hop (refs are flat). */
function resolveRef(raw: string): string {
  const varMatch = raw.match(/^var\(\s*(--[\w-]+)\s*\)$/)
  if (!varMatch) return norm(raw)
  const target = varMatch[1]
  if (baseRoot[target] !== undefined) return norm(baseRoot[target])
  return norm(raw)
}

/**
 * Resolve a token in a given block, following var() chains within that block,
 * then the semantic/component/reference :root scopes. Bespoke tokens
 * (--emporium-*) and Tier-1 roles are followed within the supplied block first.
 */
function resolveIn(block: Block, raw: string, depth = 0): string {
  if (depth > 8) return norm(raw)
  const single = raw.match(/^var\(\s*(--[\w-]+)\s*\)$/)
  if (single) {
    const target = single[1]
    if (block[target] !== undefined) return resolveIn(block, block[target], depth + 1)
    if (baseRoot[target] !== undefined) return resolveIn(baseRoot, baseRoot[target], depth + 1)
    return norm(raw)
  }
  // Compound value (e.g. "1px solid var(--mn-ref-purple-300)") — substitute each
  // embedded var() in place, then return the expanded string.
  if (raw.includes('var(')) {
    const expanded = raw.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, t: string) => {
      if (block[t] !== undefined) return resolveIn(block, block[t], depth + 1)
      if (baseRoot[t] !== undefined) return resolveIn(baseRoot, baseRoot[t], depth + 1)
      return `var(${t})`
    })
    return expanded
  }
  return norm(raw)
}

describe('@shrubbery/tokens — reference ramp (Tier 0)', () => {
  it('emits the purple ramp with the exact documented hexes', () => {
    for (const [step, hex] of Object.entries(PURPLE_RAMP)) {
      const tok = `--mn-ref-purple-${step}`
      expect(refRoot[tok], `${tok} present`).toBeDefined()
      expect(refRoot[tok].toLowerCase(), `${tok} value`).toBe(hex.toLowerCase())
    }
  })

  it('keeps the fern + cobalt ramps for Garden identity + sophia provenance', () => {
    expect(refRoot['--mn-ref-fern-600']).toBe('#376d57')
    expect(refRoot['--mn-ref-cobalt-500']).toBe('#1a5fa3') // sophia source, unchanged
  })
})

describe('@shrubbery/tokens — repository-owned typography', () => {
  it('loads the offline font entrypoint before every token layer', () => {
    const entry = read('tokens.css')
    expect(entry.indexOf("@import './fonts.css';")).toBeGreaterThanOrEqual(0)
    expect(entry.indexOf("@import './fonts.css';")).toBeLessThan(entry.indexOf("@import './reference.css';"))
  })

  it('declares normal and italic WOFF2 sources for every structural family', () => {
    const fonts = read('fonts.css')
    for (const family of ['literata', 'source-sans-3', 'jetbrains-mono', 'inter', 'public-sans']) {
      expect(fonts).toContain(`@fontsource-variable/${family}/`)
    }
    expect(fonts.match(/italic\.css/g)).toHaveLength(5)
  })

  it('uses the bundled variable family names as the first choice', () => {
    expect(semanticRoot['--mn-font-chrome']).toMatch(/^'Literata Variable'/)
    expect(semanticRoot['--mn-font-sans']).toMatch(/^'Source Sans 3 Variable'/)
    expect(semanticRoot['--mn-font-mono']).toMatch(/^'JetBrains Mono Variable'/)
  })
})

describe('@shrubbery/tokens — Emporium skin (sophia structure, purple accent)', () => {
  const empBlocks = parseBlocks(read('skin-emporium.css'))
  const emp = empBlocks.get('[data-skin="emporium"]') ?? {}
  const empAlias = empBlocks.get('[data-design="emporium"]') ?? {}
  const empDark =
    empBlocks.get('[data-theme="dark"][data-skin="emporium"]') ?? {}
  const empRoot = empBlocks.get(':root') ?? {} // --emporium-* bespoke tokens

  // Merge bespoke + skin block so var(--emporium-*) resolves.
  const empResolveBlock: Block = { ...empRoot, ...emp }

  it('lights up via [data-skin=emporium] (the sux appliesAttribute hook)', () => {
    expect(Object.keys(emp).length).toBeGreaterThan(0)
    expect(SKIN_APPLICATIONS.emporium.appliesAttribute).toBe('[data-skin=emporium]')
  })

  it('[data-design=emporium] alias is byte-identical to [data-skin=emporium]', () => {
    expect(empAlias).toEqual(emp)
  })

  it('accent (primary) resolves to PURPLE-400 #9472CE (Vera iter-4a pick, recolored from cobalt)', () => {
    const accent = resolveIn(empResolveBlock, emp['--mn-color-accent'])
    expect(accent).toBe(EMPORIUM_ACCENT.accent.toLowerCase())
    expect(accent).toBe(PURPLE_RAMP[400].toLowerCase())
    // and explicitly NOT the iter-3 purple-500 proposal anymore.
    expect(accent).not.toBe(PURPLE_RAMP[500].toLowerCase())
  })

  it('accent-strong resolves to PURPLE-700 #4C1D95', () => {
    const strong = resolveIn(empResolveBlock, emp['--mn-color-text-accent-strong'])
    expect(strong).toBe(EMPORIUM_ACCENT.accentStrong.toLowerCase())
  })

  it('rule-strong (border-strong) resolves to PURPLE-300 #B59FE0', () => {
    const ruleStrong = resolveIn(empResolveBlock, emp['--mn-color-border-strong'])
    expect(ruleStrong).toBe(EMPORIUM_ACCENT.ruleStrong.toLowerCase())
  })

  it('accent channel triple is purple-400 (148 114 206) — drives washes', () => {
    expect(emp['--mn-color-accent-ch']).toBe(EMPORIUM_ACCENT.accentChannel)
    expect(emp['--mn-color-accent-ch']).toBe('148 114 206')
  })

  it('chrome + display font is Diatype (sophia typography, verbatim)', () => {
    const chrome = resolveIn(empResolveBlock, emp['--mn-font-chrome'])
    const display = resolveIn(empResolveBlock, emp['--mn-font-display'])
    expect(chrome).toBe(EMPORIUM_FONT_SANS)
    expect(display).toBe(EMPORIUM_FONT_SANS)
  })

  it('keeps the SOPHIA STRUCTURE unchanged: square radius, tight density, icon-only', () => {
    // square / no-radius control (sophia)
    const radiusControl = resolveIn(empResolveBlock, emp['--mn-radius-control'])
    expect(radiusControl === '0' || radiusControl === '0px').toBe(true)
    // tight 24px density (sophia)
    expect(emp['--mn-row-height']).toBe('24px')
    expect(emp['--mn-control-height']).toBe('24px')
    // icon-only labels (sophia)
    expect(emp['--mn-label-display']).toBe('none')
    // no parchment grain (sophia digital-clean)
    expect(emp['--mn-texture-display']).toBe('none')
    // stronger rules: chrome-rule = the frame rule (purple-300)
    const chromeRule = resolveIn(empResolveBlock, emp['--mn-chrome-rule'])
    expect(chromeRule).toContain(PURPLE_RAMP[300].toLowerCase())
  })

  it('top bar is a purple masthead (sophia remapped its masthead)', () => {
    expect(resolveIn(empResolveBlock, emp['--mn-top-bar-bg'])).toBe(
      PURPLE_RAMP[50].toLowerCase(),
    )
    expect(resolveIn(empResolveBlock, emp['--mn-top-bar-text'])).toBe(
      PURPLE_RAMP[700].toLowerCase(),
    )
  })

  it('dark Emporium lightens the accent to purple-300 (contrast on dark bg)', () => {
    // dark block retunes --emporium-accent; resolve through the dark bespoke set.
    const darkBlock: Block = { ...empRoot, ...emp, ...empDark }
    const darkAccent = resolveIn(darkBlock, darkBlock['--emporium-accent'])
    expect(darkAccent).toBe(EMPORIUM_ACCENT.accentDark.toLowerCase())
    // and the dark surface base is the cool dark Swiss (not warm Garden ink #171514)
    expect(empDark['--mn-color-surface-base']).not.toBe('#171514')
  })
})

describe('@shrubbery/tokens — 98 skin (classic desktop identity)', () => {
  const blocks = parseBlocks(read('skin-98.css'))
  const light = blocks.get('[data-skin="98"]') ?? {}
  const dark = blocks.get('[data-theme="dark"][data-skin="98"]') ?? {}

  it('is a first-class appliesAttribute skin with the canonical system colors', () => {
    expect(SKIN_APPLICATIONS['98'].appliesAttribute).toBe('[data-skin=98]')
    expect(light['--mn-98-desktop']).toBe(NINETY_EIGHT_PALETTE.desktop.toLowerCase())
    expect(light['--mn-98-face']).toBe(NINETY_EIGHT_PALETTE.face.toLowerCase())
    expect(light['--mn-98-caption']).toBe(NINETY_EIGHT_PALETTE.caption.toLowerCase())
    expect(light['--mn-98-selection']).toBe(NINETY_EIGHT_PALETTE.selection.toLowerCase())
  })

  it('uses deterministic compact sans chrome, square geometry, and real bevel roles', () => {
    expect(light['--mn-font-chrome']).toBe(NINETY_EIGHT_FONT_SANS)
    expect(resolveIn(light, light['--mn-radius-control'])).toBe('0')
    expect(resolveIn(light, light['--mn-radius-surface'])).toBe('0')
    expect(light['--mn-98-raised']).toContain('inset 1px 1px 0')
    expect(light['--mn-98-sunken']).toContain('inset 1px 1px 0')
    expect(light['--mn-shadow-card']).toBe('var(--mn-98-raised)')
    expect(light['--mn-transition-fast']).toBe('0ms linear')
  })

  it('composes dark mode as High Contrast Black without losing the identity axis', () => {
    expect(dark['--mn-color-surface-canvas']).toBe('#000000')
    expect(dark['--mn-color-surface-base']).toBe('#202020')
    expect(dark['--mn-color-text-primary']).toBe('#ffffff')
    expect(dark['--mn-color-text-on-accent']).toBe('#ffffff')
    expect(dark['--mn-top-bar-text']).toBe('#ffffff')
  })
})

describe('@shrubbery/tokens — Glass skin (luminous translucent identity)', () => {
  const blocks = parseBlocks(read('skin-glass.css'))
  const light = blocks.get('[data-skin="glass"]') ?? {}
  const dark = blocks.get('[data-theme="dark"][data-skin="glass"]') ?? {}

  it('is a first-class appliesAttribute skin with its own sky/teal vocabulary', () => {
    expect(SKIN_APPLICATIONS.glass.appliesAttribute).toBe('[data-skin=glass]')
    expect(light['--mn-glass-sky']).toBe(GLASS_PALETTE.sky.toLowerCase())
    expect(light['--mn-glass-sky-deep']).toBe(GLASS_PALETTE.skyDeep.toLowerCase())
    expect(light['--mn-glass-teal']).toBe(GLASS_PALETTE.teal.toLowerCase())
    expect(light['--mn-font-chrome']).toBe(GLASS_FONT_SANS)
  })

  it('defines real translucent, frosted, polished material roles', () => {
    expect(light['--mn-glass-panel']).toContain('rgba(')
    expect(light['--mn-glass-backdrop']).toContain('blur(18px)')
    expect(light['--mn-glass-raised']).toContain('inset 0 1px 0')
    expect(light['--mn-window-backdrop-filter']).toBe('var(--mn-glass-backdrop)')
    expect(light['--mn-control-background']).toContain('linear-gradient')
    expect(light['--mn-chat-superbar-bg']).toContain('linear-gradient')
  })

  it('composes a smoked dark variant without collapsing into the 98 palette', () => {
    expect(dark['--mn-color-surface-canvas']).toBe('#0c2742')
    expect(dark['--mn-color-text-primary']).toBe('#eefbff')
    expect(dark['--mn-color-accent']).toBe('#46c8de')
    expect(dark['--mn-control-background']).toContain('linear-gradient')
    expect(dark['--mn-color-surface-base']).not.toBe('#202020')
  })
})

describe('@shrubbery/tokens — Garden skin (the default fern identity)', () => {
  const gBlocks = parseBlocks(read('skin-garden.css'))
  const g = gBlocks.get('[data-skin="garden"]') ?? {}

  it('accent resolves to the quiet-archive FERN-600 #376d57', () => {
    expect(resolveRef(g['--mn-color-accent'])).toBe(GARDEN_ACCENT.accent.toLowerCase())
  })

  it('chrome font is Literata serif (the Garden voice)', () => {
    expect(g['--mn-font-chrome']).toBe(GARDEN_FONT_CHROME)
  })

  it('keeps rounded geometry + visible labels (NOT sophia structure)', () => {
    expect(resolveRef(g['--mn-radius-control'])).not.toBe('0')
    expect(g['--mn-label-display']).toBe('inline')
    expect(g['--mn-row-height']).toBe('30px')
    expect(g['--mn-control-height']).toBe('30px')
  })
})

describe('@shrubbery/tokens — Research skin (SRS scholar-desk identity)', () => {
  const rBlocks = parseBlocks(read('skin-research.css'))
  const r = rBlocks.get('[data-skin="research"]') ?? {}
  const rDark =
    rBlocks.get('[data-theme="dark"][data-skin="research"]') ?? {}
  const rRoot = rBlocks.get(':root') ?? {}
  const rResolveBlock: Block = { ...rRoot, ...r }

  it('lights up via [data-skin=research] (the sux appliesAttribute hook)', () => {
    expect(Object.keys(r).length).toBeGreaterThan(0)
    expect(SKIN_APPLICATIONS.research.appliesAttribute).toBe('[data-skin=research]')
  })

  it('accent resolves to the muted SRS research blue', () => {
    const accent = resolveIn(rResolveBlock, r['--mn-color-accent'])
    expect(accent).toBe(RESEARCH_ACCENT.accent.toLowerCase())
    expect(accent).not.toBe(GARDEN_ACCENT.accent.toLowerCase())
    expect(accent).not.toBe(EMPORIUM_ACCENT.accent.toLowerCase())
  })

  it('accent channel triple is the research blue channel', () => {
    expect(resolveIn(rResolveBlock, r['--mn-color-accent-ch'])).toBe(
      RESEARCH_ACCENT.accentChannel,
    )
  })

  it('uses Literata for chrome, prose, and display (SRS prose-forward posture)', () => {
    expect(resolveIn(rResolveBlock, r['--mn-font-chrome'])).toBe(RESEARCH_FONT_SERIF)
    expect(resolveIn(rResolveBlock, r['--mn-font-display'])).toBe(RESEARCH_FONT_SERIF)
    expect(resolveIn(rResolveBlock, r['--mn-font-prose'])).toBe(RESEARCH_FONT_SERIF)
  })

  it('keeps the scholar-desk surfaces, gentle rules, and comfortable density', () => {
    expect(r['--mn-color-surface-base']).toBe('#f6f4ef')
    expect(r['--mn-color-surface-raised']).toBe('#fffdf8')
    expect(r['--mn-radius-surface']).toBe('12px')
    expect(resolveIn(rResolveBlock, r['--mn-radius-control'])).toBe('6px')
    expect(r['--mn-row-height']).toBe('30px')
    expect(r['--mn-control-height']).toBe('30px')
    expect(r['--mn-label-display']).toBe('inline')
    expect(r['--mn-texture-display']).toBe('block')
    expect(resolveIn(rResolveBlock, r['--mn-chrome-rule'])).toBe('1px solid #ded8cc')
  })

  it('exports the soft raised shadows the SRS wireframes used for cards/composer', () => {
    expect(r['--mn-shadow-card']).toContain('0 12px 30px')
    expect(r['--mn-shadow-composer']).toContain('0 8px 24px')
    expect(r['--mn-shadow-composer-focus']).toContain('0 10px 28px')
  })

  it('dark Research lightens the accent and keeps a cool research desk surface', () => {
    const darkBlock: Block = { ...rRoot, ...r, ...rDark }
    const darkAccent = resolveIn(darkBlock, darkBlock['--research-accent'])
    expect(darkAccent).toBe(RESEARCH_ACCENT.accentDark.toLowerCase())
    expect(resolveIn(darkBlock, darkBlock['--mn-color-accent-ch'])).toBe('169 186 216')
    expect(rDark['--mn-color-surface-base']).toBe('#141821')
    expect(rDark['--mn-color-surface-base']).not.toBe('#171514')
  })
})

describe('@shrubbery/tokens — Greenhouse skin (sans Garden research workspace)', () => {
  const ghBlocks = parseBlocks(read('skin-greenhouse.css'))
  const gh = ghBlocks.get('[data-skin="greenhouse"]') ?? {}
  const ghDark =
    ghBlocks.get('[data-theme="dark"][data-skin="greenhouse"]') ?? {}
  const ghRoot = ghBlocks.get(':root') ?? {}
  const ghResolveBlock: Block = { ...ghRoot, ...gh }

  it('lights up via [data-skin=greenhouse] (the sux appliesAttribute hook)', () => {
    expect(Object.keys(gh).length).toBeGreaterThan(0)
    expect(SKIN_APPLICATIONS.greenhouse.appliesAttribute).toBe('[data-skin=greenhouse]')
  })

  it('accent resolves to the greenhouse workspace green', () => {
    const accent = resolveIn(ghResolveBlock, gh['--mn-color-accent'])
    expect(accent).toBe(GREENHOUSE_ACCENT.accent.toLowerCase())
    expect(accent).not.toBe(GARDEN_ACCENT.accent.toLowerCase())
    expect(accent).not.toBe(RESEARCH_ACCENT.accent.toLowerCase())
    expect(accent).not.toBe(EMPORIUM_ACCENT.accent.toLowerCase())
  })

  it('accent channel triple is the greenhouse channel', () => {
    expect(resolveIn(ghResolveBlock, gh['--mn-color-accent-ch'])).toBe(
      GREENHOUSE_ACCENT.accentChannel,
    )
  })

  it('uses sans for chrome, prose, display, and utility roles', () => {
    expect(resolveIn(ghResolveBlock, gh['--mn-font-chrome'])).toBe(GREENHOUSE_FONT_SANS)
    expect(resolveIn(ghResolveBlock, gh['--mn-font-display'])).toBe(GREENHOUSE_FONT_SANS)
    expect(resolveIn(ghResolveBlock, gh['--mn-font-prose'])).toBe(GREENHOUSE_FONT_SANS)
    expect(resolveIn(ghResolveBlock, gh['--mn-font-utility'])).toBe(GREENHOUSE_FONT_SANS)
  })

  it('keeps human-factor targets visible while reducing visual noise', () => {
    expect(gh['--mn-color-surface-base']).toBe('#f4f6f2')
    expect(gh['--mn-color-surface-raised']).toBe('#ffffff')
    expect(resolveIn(ghResolveBlock, gh['--mn-radius-control'])).toBe('6px')
    expect(resolveIn(ghResolveBlock, gh['--mn-radius-surface'])).toBe('8px')
    expect(gh['--mn-row-height']).toBe('30px')
    expect(gh['--mn-control-height']).toBe('32px')
    expect(gh['--mn-label-display']).toBe('inline')
    expect(gh['--mn-texture-display']).toBe('none')
    expect(gh['--mn-tracking-label']).toBe('0')
    expect(resolveIn(ghResolveBlock, gh['--mn-chrome-rule'])).toBe('1px solid #cfdad2')
  })

  it('exports shallow workspace shadows rather than the lifted SRS workbench', () => {
    expect(gh['--mn-shadow-card']).toContain('0 6px 18px')
    expect(gh['--mn-shadow-card']).not.toContain('0 12px 30px')
    expect(gh['--mn-shadow-composer']).toContain('0 6px 18px')
  })

  it('dark Greenhouse lightens the accent and keeps a cool botanical dark surface', () => {
    const darkBlock: Block = { ...ghRoot, ...gh, ...ghDark }
    const darkAccent = resolveIn(darkBlock, darkBlock['--greenhouse-accent'])
    expect(darkAccent).toBe(GREENHOUSE_ACCENT.accentDark.toLowerCase())
    expect(resolveIn(darkBlock, darkBlock['--mn-color-accent-ch'])).toBe('136 201 172')
    expect(ghDark['--mn-color-surface-base']).toBe('#121816')
    expect(ghDark['--mn-color-surface-base']).not.toBe('#171514')
  })

  it('consumes stance registers and exposes floor salience hooks', () => {
    const room = ghBlocks.get('[data-skin="greenhouse"][data-stance="room"]') ?? {}
    const bench = ghBlocks.get('[data-skin="greenhouse"][data-stance="bench"]') ?? {}
    const openFloor = ghBlocks.get('[data-skin="greenhouse"][data-floor-state="open"]') ?? {}
    const heldFloor = ghBlocks.get('[data-skin="greenhouse"][data-floor-state="held"]') ?? {}

    expect(room['--greenhouse-stance-register']).toBe('var(--mn-stance-register-room)')
    expect(bench['--greenhouse-stance-register']).toBe('var(--mn-stance-register-bench)')
    expect(openFloor['--greenhouse-floor-tone']).toBe('var(--mn-color-accent)')
    expect(heldFloor['--greenhouse-floor-tone']).toBe('var(--mn-color-warning)')
  })

  it('lights the annunciator per stance — Room accent, Constitution violet (folio 02)', () => {
    const room = ghBlocks.get('[data-skin="greenhouse"][data-stance="room"]') ?? {}
    const constitution = ghBlocks.get('[data-skin="greenhouse"][data-stance="constitution"]') ?? {}

    // Room wears the accent; the shell's default annunciator hue is the accent too.
    expect(room['--mn-stance-annunciator-ink']).toBe('var(--mn-color-accent)')
    expect(resolveIn(ghResolveBlock, gh['--mn-stance-annunciator-ink'])).toBe(GREENHOUSE_ACCENT.accent.toLowerCase())

    // Constitution wears its own quiet violet — the CSS and the exported constant agree.
    expect(constitution['--mn-stance-annunciator-ink']).toBe(GREENHOUSE_STANCE.constitutionInk)
    expect(constitution['--mn-stance-annunciator-edge']).toBe(GREENHOUSE_STANCE.constitutionEdge)
    expect(constitution['--mn-stance-annunciator-wash']).toBe(GREENHOUSE_STANCE.constitutionWash)
    // The two stance hues are genuinely distinct — the switch reads at a glance.
    expect(GREENHOUSE_STANCE.constitutionInk).not.toBe(GREENHOUSE_ACCENT.accent)
  })
})

describe('@shrubbery/tokens — Observatory skin (night-room dashboard identity)', () => {
  const obBlocks = parseBlocks(read('skin-observatory.css'))
  const ob = obBlocks.get('[data-skin="observatory"]') ?? {}
  const obDark = obBlocks.get('[data-theme="dark"][data-skin="observatory"]') ?? {}
  const obRoot = obBlocks.get(':root') ?? {}
  const obResolveBlock: Block = { ...obRoot, ...ob }

  it('lights up via [data-skin=observatory] (the sux appliesAttribute hook)', () => {
    expect(Object.keys(ob).length).toBeGreaterThan(0)
    expect(SKIN_APPLICATIONS.observatory.appliesAttribute).toBe('[data-skin=observatory]')
  })

  it('is NOT part of the Garden/Sophia/98/Glass visual-identity cycle', () => {
    expect(VISUAL_IDENTITY_SKINS).not.toContain('observatory')
    expect(nextVisualIdentitySkin('observatory')).toBe('garden')
  })

  it('baseline accent resolves to the dark-optimized azure chart swatch (no daylight register)', () => {
    const accent = resolveIn(obResolveBlock, ob['--mn-color-accent'])
    expect(accent).toBe(OBSERVATORY_ACCENT.accent.toLowerCase())
    expect(accent).toBe(OBSERVATORY_CHART_CATEGORICAL.azure.dark.toLowerCase())
    expect(accent).not.toBe(GARDEN_ACCENT.accent.toLowerCase())
    expect(accent).not.toBe(RESEARCH_ACCENT.accent.toLowerCase())
    expect(accent).not.toBe(GREENHOUSE_ACCENT.accent.toLowerCase())
  })

  it('accent channel triple matches the documented Observatory accent', () => {
    expect(resolveIn(obResolveBlock, ob['--mn-color-accent-ch'])).toBe(OBSERVATORY_ACCENT.accentChannel)
  })

  it('is a genuinely dark room even at [data-skin=observatory] alone (no [data-theme=dark] needed)', () => {
    // Baseline surface-base IS the validated dataviz dark surface (ink-50).
    expect(resolveIn(obResolveBlock, ob['--mn-color-surface-base'])).toBe('#191c18')
    expect(resolveIn(obResolveBlock, ob['--mn-color-surface-canvas'])).not.toBe('#fbfaf6')
    // High-contrast numeral ink: text-primary/title sit at the brightest ink steps.
    expect(resolveIn(obResolveBlock, ob['--mn-color-text-title'])).toBe('#f6f7f2')
  })

  it('borders are instrument-lit — the accent channel, not a flat neutral gray', () => {
    expect(ob['--mn-color-border-default']).toContain('var(--observatory-accent-ch)')
    expect(ob['--mn-color-rule']).toContain('var(--observatory-accent-ch)')
  })

  it('exports the instrument glow built only from the accent channel (no new raw hex)', () => {
    expect(ob['--mn-observatory-instrument-glow']).toContain('var(--observatory-accent-ch)')
    expect(ob['--mn-observatory-instrument-glow']).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('uses mono chrome/display/utility — a telemetry-console voice distinct from every other skin', () => {
    expect(resolveIn(obResolveBlock, ob['--mn-font-chrome'])).toBe(semanticRoot['--mn-font-mono'])
    expect(resolveIn(obResolveBlock, ob['--mn-font-display'])).toBe(semanticRoot['--mn-font-mono'])
    expect(resolveIn(obResolveBlock, ob['--mn-font-prose'])).toBe(semanticRoot['--mn-font-sans'])
  })

  it('dark composition ("true night") lightens the accent further and deepens the room', () => {
    const darkBlock: Block = { ...obRoot, ...ob, ...obDark }
    const darkAccent = resolveIn(darkBlock, darkBlock['--observatory-accent'])
    expect(darkAccent).toBe(OBSERVATORY_ACCENT.accentTrueNight.toLowerCase())
    expect(resolveIn(darkBlock, darkBlock['--mn-color-accent-ch'])).toBe(OBSERVATORY_ACCENT.accentTrueNightChannel)
    // Strictly darker canvas than the baseline room, not a flip.
    expect(obDark['--mn-color-surface-canvas']).toBe('#000000')
    expect(resolveIn(obResolveBlock, ob['--mn-color-surface-canvas'])).not.toBe('#000000')
    expect(obDark['--mn-color-text-primary']).toBe('#ffffff')
  })

  it('status quads at baseline already match the dark-appropriate theme-dark.css steps', () => {
    // The room is dark regardless of [data-theme]; danger/warning/success at
    // baseline must already be the SAME literals theme-dark.css documents.
    const darkTheme = parseBlocks(read('theme-dark.css')).get('[data-theme="dark"]') ?? {}
    expect(resolveIn(obResolveBlock, ob['--mn-color-danger'])).toBe(darkTheme['--mn-color-danger'])
    expect(resolveIn(obResolveBlock, ob['--mn-color-success'])).toBe(darkTheme['--mn-color-success'])
  })
})

describe('@shrubbery/tokens — Observatory dataviz chart palette (global, skin-independent)', () => {
  const light = semanticRoot
  const dark = parseBlocks(read('theme-dark.css')).get('[data-theme="dark"]') ?? {}

  it('categorical hues are in FIXED slot order and machine-validated per theme', () => {
    const lightSlots = [1, 2, 3, 4, 5].map(n => resolveIn(light, light[`--mn-chart-categorical-${n}`]))
    const expectedLight = [
      OBSERVATORY_CHART_CATEGORICAL.azure.light,
      OBSERVATORY_CHART_CATEGORICAL.terracotta.light,
      OBSERVATORY_CHART_CATEGORICAL.violet.light,
      OBSERVATORY_CHART_CATEGORICAL.chartreuse.light,
      OBSERVATORY_CHART_CATEGORICAL.magenta.light,
    ].map(h => h.toLowerCase())
    expect(lightSlots).toEqual(expectedLight)

    const darkSlots = [1, 2, 3, 4, 5].map(n => (dark[`--mn-chart-categorical-${n}`] ?? '').toLowerCase())
    const expectedDark = [
      OBSERVATORY_CHART_CATEGORICAL.azure.dark,
      OBSERVATORY_CHART_CATEGORICAL.terracotta.dark,
      OBSERVATORY_CHART_CATEGORICAL.violet.dark,
      OBSERVATORY_CHART_CATEGORICAL.chartreuse.dark,
      OBSERVATORY_CHART_CATEGORICAL.magenta.dark,
    ].map(h => h.toLowerCase())
    expect(darkSlots).toEqual(expectedDark)
  })

  it('a 9th series folds into "Other" — a distinct, muted, non-categorical token', () => {
    expect(light['--mn-chart-categorical-other']).toBe('var(--mn-color-text-muted)')
    const other = resolveIn(light, light['--mn-chart-categorical-other'])
    for (const n of [1, 2, 3, 4, 5]) {
      expect(other).not.toBe(resolveIn(light, light[`--mn-chart-categorical-${n}`]))
    }
  })

  it('sequential ramp is the azure hue, light→dark, theme-invariant', () => {
    for (const step of [100, 200, 300, 400, 500, 600, 700] as const) {
      expect(resolveIn(light, light[`--mn-chart-sequential-${step}`])).toBe(
        OBSERVATORY_CHART_SEQUENTIAL_AZURE[step].toLowerCase(),
      )
    }
    // No dark override exists — the token test file's own convention (theme-
    // dark.css literals win the cascade) means an absent key here IS the
    // "unchanged" contract.
    expect(dark['--mn-chart-sequential-500']).toBeUndefined()
  })

  it('diverging scale (azure cool pole / terracotta warm pole + neutral midpoint) re-validates per theme', () => {
    const roles = ['cool-far', 'cool-mid', 'cool-near', 'mid', 'warm-near', 'warm-mid', 'warm-far'] as const
    const keyOf = (r: (typeof roles)[number]) =>
      (r.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())) as keyof typeof OBSERVATORY_CHART_DIVERGING.light
    for (const role of roles) {
      const key = keyOf(role)
      expect(resolveIn(light, light[`--mn-chart-diverging-${role}`])).toBe(
        OBSERVATORY_CHART_DIVERGING.light[key].toLowerCase(),
      )
      expect((dark[`--mn-chart-diverging-${role}`] ?? '').toLowerCase()).toBe(
        OBSERVATORY_CHART_DIVERGING.dark[key].toLowerCase(),
      )
    }
  })

  it('status quad is RESERVED and matches theme-dark.css semantics where hues overlap', () => {
    expect(resolveIn(light, light['--mn-chart-status-good'])).toBe(OBSERVATORY_CHART_STATUS.light.good.toLowerCase())
    expect(resolveIn(light, light['--mn-chart-status-warning'])).toBe(OBSERVATORY_CHART_STATUS.light.warning.toLowerCase())
    expect(resolveIn(light, light['--mn-chart-status-serious'])).toBe(OBSERVATORY_CHART_STATUS.light.serious.toLowerCase())
    expect(resolveIn(light, light['--mn-chart-status-critical'])).toBe(OBSERVATORY_CHART_STATUS.light.critical.toLowerCase())

    expect((dark['--mn-chart-status-good'] ?? '').toLowerCase()).toBe(OBSERVATORY_CHART_STATUS.dark.good.toLowerCase())
    expect((dark['--mn-chart-status-serious'] ?? '').toLowerCase()).toBe(OBSERVATORY_CHART_STATUS.dark.serious.toLowerCase())
    expect((dark['--mn-chart-status-critical'] ?? '').toLowerCase()).toBe(OBSERVATORY_CHART_STATUS.dark.critical.toLowerCase())
    // good (dark) reuses the exact literal theme-dark.css documents for success.
    expect(dark['--mn-chart-status-good']).toBe(dark['--mn-color-success'])
    expect(dark['--mn-chart-status-serious']).toBe(dark['--mn-color-danger'])

    // Status is a RESERVED 4th vocabulary — never collides with a categorical slot.
    const categoricalLight = [1, 2, 3, 4, 5].map(n => resolveIn(light, light[`--mn-chart-categorical-${n}`]))
    for (const status of ['good', 'warning', 'serious', 'critical']) {
      expect(categoricalLight).not.toContain(resolveIn(light, light[`--mn-chart-status-${status}`]))
    }
  })

  it('chart geometry roles encode the thin-mark / recessive-grid rules as consumable tokens', () => {
    expect(light['--mn-chart-mark-width']).toBe('2px')
    expect(light['--mn-chart-mark-radius']).toBe('4px')
    expect(light['--mn-chart-marker-min']).toBe('8px')
    expect(light['--mn-chart-fill-gap']).toBe('2px')
    expect(light['--mn-chart-axis']).toBe('var(--mn-color-border-default)')
    expect(light['--mn-chart-grid']).toBe('var(--mn-color-border-subtle)')
  })

  it('numerals wear a global tabular-figures token (JetBrains Mono, not skin-scoped)', () => {
    expect(resolveIn(light, light['--mn-font-numeral'])).toBe(semanticRoot['--mn-font-mono'])
  })
})

describe('@shrubbery/tokens — semantic motion roles', () => {
  it('defines the transition family consumed by components', () => {
    expect(semanticRoot['--mn-ease-standard']).toBe('cubic-bezier(0.2, 0, 0, 1)')
    expect(semanticRoot['--mn-ease-emphasized']).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)')
    expect(semanticRoot['--mn-transition-fast']).toBe('110ms var(--mn-ease-standard)')
    expect(semanticRoot['--mn-transition-normal']).toBe('180ms var(--mn-ease-standard)')
    expect(semanticRoot['--mn-transition-slow']).toBe('320ms var(--mn-ease-emphasized)')
  })

  it('lets both the OS media query and explicit preference win the :root cascade', () => {
    const source = read('semantic.css')
    const explicit = parseBlocks(source).get('[data-reduced-motion]') ?? {}
    expect(source).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*html:root\s*\{/)
    expect(explicit['--mn-transition-fast']).toBe('0ms linear')
    expect(explicit['--mn-transition-normal']).toBe('0ms linear')
    expect(explicit['--mn-transition-slow']).toBe('0ms linear')
  })
})

describe('@shrubbery/tokens — mature Garden compatibility vocabulary', () => {
  it('routes legacy surface and ramp names through go-forward semantic roles', () => {
    expect(semanticRoot['--mn-color-panel-bg']).toBe('var(--mn-color-surface-panel)')
    expect(semanticRoot['--mn-color-neutral-100']).toBe('var(--mn-color-surface-subtle)')
    expect(semanticRoot['--mn-color-primary-500']).toBe('var(--mn-color-accent)')
    expect(semanticRoot['--mn-color-primary-600']).toBe('var(--mn-color-accent-hover)')
    expect(semanticRoot['--mn-color-primary-700']).toBe('var(--mn-color-accent-active)')
    expect(semanticRoot['--mn-color-accent-700']).toBe('var(--mn-color-warning-strong)')
    expect(semanticRoot['--mn-color-danger-700']).toBe('var(--mn-color-danger-strong)')
  })

  it('keeps lifted typography and shared panel geometry on the semantic scale', () => {
    expect(semanticRoot['--mn-leading-normal']).toBe('var(--mn-leading-ui)')
    expect(semanticRoot['--mn-leading-relaxed']).toBe('var(--mn-leading-prose)')
    expect(semanticRoot['--mn-editor-line-height']).toBe('var(--mn-leading-prose)')
    expect(semanticRoot['--mn-y-slice-1-height']).toBe('var(--mn-top-bar-height, 46px)')
    expect(semanticRoot['--mn-touch-target-size']).toBe('48px')
    expect(semanticRoot['--mn-mobile-list-row-height']).toBe('56px')
  })
})

describe('@shrubbery/tokens — material hierarchy', () => {
  it('distinguishes room, paper, furniture, controls, and overlays', () => {
    const roles = [
      '--mn-color-surface-canvas',
      '--mn-color-surface-base',
      '--mn-color-surface-editor',
      '--mn-color-surface-panel',
      '--mn-color-surface-chrome',
      '--mn-color-surface-raised',
      '--mn-color-surface-elevated',
      '--mn-color-surface-overlay',
      '--mn-color-surface-sunken',
    ]

    for (const role of roles) expect(semanticRoot[role], `${role} present`).toBeDefined()
    expect(semanticRoot['--mn-color-surface-canvas']).not.toBe(
      semanticRoot['--mn-color-surface-editor'],
    )
    expect(semanticRoot['--mn-color-surface-panel']).not.toBe(
      semanticRoot['--mn-color-surface-raised'],
    )
  })

  it('exports shared depth, atmosphere, and prose rhythm roles', () => {
    expect(semanticRoot['--mn-atmosphere']).toContain('radial-gradient')
    expect(semanticRoot['--mn-shadow-chrome']).toBeDefined()
    expect(semanticRoot['--mn-shadow-card']).toBe('var(--mn-shadow-xs)')
    expect(semanticRoot['--mn-shadow-composer-focus']).toContain('var(--mn-focus-ring)')
    expect(semanticRoot['--mn-leading-prose']).toBe('1.72')
    expect(semanticRoot['--mn-measure-prose']).toBe('72ch')
  })

  it('keeps dark mode layered and charcoal rather than collapsing to black', () => {
    const dark = parseBlocks(read('theme-dark.css')).get('[data-theme="dark"]') ?? {}
    expect(dark['--mn-color-surface-canvas']).not.toBe('#000000')
    expect(dark['--mn-color-surface-base']).not.toBe(dark['--mn-color-surface-canvas'])
    expect(dark['--mn-color-surface-editor']).not.toBe(dark['--mn-color-surface-panel'])
    expect(dark['--mn-color-surface-raised']).not.toBe(dark['--mn-color-surface-sunken'])
    expect(dark['--mn-color-text-primary']).not.toBe('#ffffff')
    expect(dark['--mn-atmosphere']).toContain('radial-gradient')
  })
})

describe('@shrubbery/tokens — editor material axis', () => {
  const materialBlocks = parseBlocks(read('editor-material.css'))
  const defaults = materialBlocks.get(':root') ?? {}
  const paper = materialBlocks.get('[data-editor-material="paper"]') ?? {}
  const classicWord = materialBlocks.get('[data-editor-material="classic-word"]') ?? {}

  it('keeps continuous editing as the attribute-free default', () => {
    expect(EDITOR_MATERIAL_APPLICATIONS.continuous.value).toBeNull()
    expect(EDITOR_MATERIAL_APPLICATIONS.continuous.appliesAttribute).toContain('removeAttribute')
    expect(defaults['--mn-editor-ruler-display']).toBe('none')
  })

  it('registers an honest paper surface without claiming pagination', () => {
    expect(EDITOR_MATERIAL_APPLICATIONS.paper.appliesAttribute).toBe('[data-editor-material=paper]')
    expect(paper['--mn-editor-sheet-width']).toContain('816px')
    expect(paper['--mn-editor-sheet-min-height']).toContain('1056px')
    expect(paper['--mn-editor-sheet-surface']).toBe('#fffdf8')
    expect(paper['--mn-editor-ruler-display']).toBe('block')
  })

  it('registers the deliberately skeuomorphic classic Word presentation separately', () => {
    expect(EDITOR_MATERIAL_APPLICATIONS['classic-word'].appliesAttribute).toBe(
      '[data-editor-material=classic-word]',
    )
    expect(classicWord['--mn-editor-sheet-width']).toContain('816px')
    expect(classicWord['--mn-editor-sheet-padding']).toBe('96px 96px 112px')
    expect(classicWord['--mn-editor-sheet-surface']).toBe('#ffffff')
    expect(classicWord['--mn-editor-canvas-surface']).toBe('#9ca1a9')
    expect(classicWord['--mn-editor-ruler-display']).toBe('block')
    expect(classicWord['--mn-editor-vertical-ruler-display']).toBe('block')
  })

  it('applies and removes the editor material attribute through the canonical applier', () => {
    const attrs = new Map<string, string>()
    const target: AttrTarget = {
      setAttribute: (name, value) => { attrs.set(name, value) },
      removeAttribute: name => { attrs.delete(name) },
    }

    applyEditorMaterial({ material: 'paper', target })
    expect(attrs.get('data-editor-material')).toBe('paper')
    applyEditorMaterial({ material: 'classic-word', target })
    expect(attrs.get('data-editor-material')).toBe('classic-word')
    applyEditorMaterial({ material: 'continuous', target })
    expect(attrs.has('data-editor-material')).toBe(false)
  })

  it.each([
    ['emporium', 'skin-emporium.css', '[data-skin="emporium"]', '[data-theme="dark"][data-skin="emporium"]', '#4c1d95'],
    ['98', 'skin-98.css', '[data-skin="98"]', '[data-theme="dark"][data-skin="98"]', '#000080'],
    ['glass', 'skin-glass.css', '[data-skin="glass"]', '[data-theme="dark"][data-skin="glass"]', '#168cb8'],
    ['research', 'skin-research.css', '[data-skin="research"]', '[data-theme="dark"][data-skin="research"]', '#586f93'],
    ['greenhouse', 'skin-greenhouse.css', '[data-skin="greenhouse"]', '[data-theme="dark"][data-skin="greenhouse"]', '#2f7d5f'],
    ['observatory', 'skin-observatory.css', '[data-skin="observatory"]', '[data-theme="dark"][data-skin="observatory"]', '#028fad'],
  ])('%s maps the complete material hierarchy and its own physical-page accent', (
    _skin,
    file,
    lightSelector,
    darkSelector,
    paperAccent,
  ) => {
    const blocks = parseBlocks(read(file))
    const light = blocks.get(lightSelector) ?? {}
    const dark = blocks.get(darkSelector) ?? {}
    for (const role of [
      '--mn-color-surface-canvas',
      '--mn-color-surface-editor',
      '--mn-color-surface-panel',
      '--mn-color-surface-chrome',
      '--mn-color-surface-elevated',
      '--mn-color-surface-overlay',
      '--mn-color-text-title',
      '--mn-color-text-quiet',
      '--mn-color-backdrop',
      '--mn-atmosphere',
    ]) {
      expect(light[role], `${role} light`).toBeDefined()
      expect(dark[role], `${role} dark`).toBeDefined()
    }
    expect(resolveRef(light['--mn-editor-paper-accent'])).toBe(paperAccent)
  })
})

describe('@shrubbery/tokens — z-layer contract (Tier 1, theme-invariant)', () => {
  const zBlocks = parseBlocks(read('z-layers.css'))
  const z = zBlocks.get(':root') ?? {}

  const ORDER = [
    ['--mn-z-delivery-shell', 'deliveryShell'],
    ['--mn-z-wire-overlay', 'wireOverlay'],
    ['--mn-z-dropdown-backdrop', 'dropdownBackdrop'],
    ['--mn-z-dropdown', 'dropdown'],
    ['--mn-z-popover', 'popover'],
    ['--mn-z-tooltip', 'tooltip'],
    ['--mn-z-modal-backdrop', 'modalBackdrop'],
    ['--mn-z-modal', 'modal'],
    ['--mn-z-overlay', 'overlay'],
    ['--mn-z-toast', 'toast'],
  ] as const

  it('defines all ten tokens with the exact Z_LAYERS values (CSS agrees with the TS constant)', () => {
    for (const [token, key] of ORDER) {
      expect(z[token], `${token} present`).toBeDefined()
      expect(Number(z[token]), `${token} value`).toBe(Z_LAYERS[key])
    }
  })

  it('is strictly ascending in the documented sequence (delivery-shell < … < toast)', () => {
    const values = ORDER.map(([token]) => Number(z[token]))
    for (let i = 1; i < values.length; i++) {
      expect(values[i], `${ORDER[i][0]} > ${ORDER[i - 1][0]}`).toBeGreaterThan(values[i - 1])
    }
  })

  it('tokens.css imports z-layers.css after component.css and before theme-dark.css', () => {
    const entry = read('tokens.css')
    const componentIdx = entry.indexOf("@import './component.css';")
    const zLayersIdx = entry.indexOf("@import './z-layers.css';")
    const themeDarkIdx = entry.indexOf("@import './theme-dark.css';")
    expect(componentIdx).toBeGreaterThanOrEqual(0)
    expect(zLayersIdx).toBeGreaterThanOrEqual(0)
    expect(themeDarkIdx).toBeGreaterThanOrEqual(0)
    expect(zLayersIdx).toBeGreaterThan(componentIdx)
    expect(zLayersIdx).toBeLessThan(themeDarkIdx)
  })

  it('keeps the contract in exactly one file — no --mn-z-* definitions leak into skin/theme CSS', () => {
    const skinAndThemeFiles = [
      'theme-dark.css',
      'editor-material.css',
      'stance.css',
      'kind.css',
      'skin-garden.css',
      'skin-emporium.css',
      'skin-98.css',
      'skin-glass.css',
      'skin-research.css',
      'skin-greenhouse.css',
      'skin-observatory.css',
    ]
    for (const file of skinAndThemeFiles) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '')
      expect(css, `${file} defines no --mn-z-*`).not.toMatch(/--mn-z-[a-z-]*\s*:/)
    }
  })
})

describe('@shrubbery/tokens — stance axis (orthogonal room posture)', () => {
  const stanceBlocks = parseBlocks(read('stance.css'))
  const root = stanceBlocks.get(':root') ?? {}
  const room = stanceBlocks.get('[data-stance="room"]') ?? {}
  const bench = stanceBlocks.get('[data-stance="bench"]') ?? {}
  const constitution = stanceBlocks.get('[data-stance="constitution"]') ?? {}
  const dispatch = stanceBlocks.get('[data-stance="dispatch"]') ?? {}
  const contested = stanceBlocks.get('[data-stance="contested"]') ?? {}

  const semanticBlock = parseBlocks(read('semantic.css')).get(':root') ?? {}
  const darkBlock = parseBlocks(read('theme-dark.css')).get('[data-theme="dark"]') ?? {}
  const semanticResolveBlock: Block = { ...baseRoot, ...semanticBlock }
  const darkResolveBlock: Block = { ...baseRoot, ...semanticBlock, ...darkBlock }

  it('ships as a first-class CSS layer with stance register variables — five one-hot registers', () => {
    expect(root['--mn-stance-register-room']).toBe('0')
    expect(root['--mn-stance-register-contested']).toBe('0')
    expect(room['--mn-stance-register-room']).toBe('1')
    expect(bench['--mn-stance-register-bench']).toBe('1')
    expect(constitution['--mn-stance-register-constitution']).toBe('1')
    expect(dispatch['--mn-stance-register-dispatch']).toBe('1')
    expect(contested['--mn-stance-register-contested']).toBe('1')
    expect(contested['--mn-stance-register-current']).toBe('contested')

    // One-hot invariant over all five registers, for every block including :root.
    const REGISTERS = [
      '--mn-stance-register-room',
      '--mn-stance-register-bench',
      '--mn-stance-register-constitution',
      '--mn-stance-register-dispatch',
      '--mn-stance-register-contested',
    ] as const
    for (const [name, block] of [
      ['room', room], ['bench', bench], ['constitution', constitution],
      ['dispatch', dispatch], ['contested', contested],
    ] as const) {
      const ones = REGISTERS.filter(r => block[r] === '1')
      expect(ones, `${name} block is one-hot`).toEqual([`--mn-stance-register-${name}`])
    }
  })

  it('maps each stance to its appliesAttribute hook, including contested', () => {
    expect(STANCE_APPLICATIONS.room.appliesAttribute).toBe('[data-stance=room]')
    expect(STANCE_APPLICATIONS.bench.appliesAttribute).toBe('[data-stance=bench]')
    expect(STANCE_APPLICATIONS.constitution.appliesAttribute).toBe('[data-stance=constitution]')
    expect(STANCE_APPLICATIONS.dispatch.appliesAttribute).toBe('[data-stance=dispatch]')
    expect(STANCE_APPLICATIONS.contested.appliesAttribute).toBe('[data-stance=contested]')
    expect(STANCE_APPLICATIONS.contested.attr).toBe('data-stance')
    expect(STANCE_APPLICATIONS.contested.value).toBe('contested')
  })

  it('ROOM_POSTURE_STANCES excludes contested', () => {
    expect(ROOM_POSTURE_STANCES).toEqual(['room', 'bench', 'constitution', 'dispatch'])
    expect(ROOM_POSTURE_STANCES).not.toContain('contested')
  })

  it('applyStance({stance:"contested"}) fails to compile (D-8, RoomPostureStance narrowing)', () => {
    // @ts-expect-error — 'contested' is not assignable to RoomPostureStance.
    applyStance({ stance: 'contested' })
  })

  it('[data-stance=contested] re-points all three annunciator vars at the contested semantic triple', () => {
    expect(contested['--mn-stance-annunciator-ink']).toBe('var(--mn-stance-contested-ink)')
    expect(contested['--mn-stance-annunciator-edge']).toBe('var(--mn-stance-contested-edge)')
    expect(contested['--mn-stance-annunciator-wash']).toBe('var(--mn-stance-contested-wash)')
  })

  it('the contested semantic triple resolves to CONTESTED_STANCE in light — the RESERVED wine, reused not re-invented', () => {
    const ink = resolveIn(semanticResolveBlock, semanticBlock['--mn-stance-contested-ink'])
    const edge = resolveIn(semanticResolveBlock, semanticBlock['--mn-stance-contested-edge'])
    const wash = resolveIn(semanticResolveBlock, semanticBlock['--mn-stance-contested-wash'])
    expect(ink).toBe(CONTESTED_STANCE.ink.toLowerCase())
    expect(ink).toBe('#880134') // the RESERVED swatch — exact, unchanged
    expect(edge).toBe(CONTESTED_STANCE.edgeLight.toLowerCase())
    expect(wash).toBe(CONTESTED_STANCE.washLight.toLowerCase())
  })

  it('the contested semantic triple resolves to CONTESTED_STANCE dark counterparts under [data-theme=dark]', () => {
    const ink = resolveIn(darkResolveBlock, darkBlock['--mn-stance-contested-ink'])
    const edge = resolveIn(darkResolveBlock, darkBlock['--mn-stance-contested-edge'])
    const wash = resolveIn(darkResolveBlock, darkBlock['--mn-stance-contested-wash'])
    expect(ink).toBe(CONTESTED_STANCE.inkDark.toLowerCase())
    expect(edge).toBe(CONTESTED_STANCE.edgeDark.toLowerCase())
    expect(wash).toBe(CONTESTED_STANCE.washDark.toLowerCase())
  })

  it('the dark ink resolves via var(--mn-ref-status-critical-ink-dark) — theme-dark.css contains no bare hex for it (§6.6.3 regression)', () => {
    expect(darkBlock['--mn-stance-contested-ink']).toBe('var(--mn-ref-status-critical-ink-dark)')
    // No literal-hex assignment to --mn-stance-contested-ink anywhere in theme-dark.css.
    const rawThemeDark = read('theme-dark.css')
    expect(rawThemeDark).not.toMatch(/--mn-stance-contested-ink:\s*#[0-9a-fA-F]{3,8}\s*;/)
  })
})

describe('@shrubbery/tokens — DisplayKind register axis', () => {
  const kindBlocks = parseBlocks(read('kind.css'))
  const root = kindBlocks.get(':root') ?? {}
  const metric = kindBlocks.get('.mn-kind[data-kind="metric"]') ?? {}
  const reference = kindBlocks.get('.mn-kind[data-kind="reference"]') ?? {}
  const testimony = kindBlocks.get('.mn-kind[data-kind="testimony"]') ?? {}

  it('ships token hooks for kinded render values', () => {
    expect(root['--mn-kind-text']).toBe('var(--mn-color-text-primary)')
    expect(metric['--mn-kind-register-current']).toBe('metric')
    expect(reference['--mn-kind-register-current']).toBe('reference')
    expect(testimony['--mn-kind-register-current']).toBe('testimony')
  })

  it('maps each DisplayKind to its appliesAttribute hook', () => {
    expect(KIND_APPLICATIONS.identity.appliesAttribute).toBe('[data-kind=identity]')
    expect(KIND_APPLICATIONS.state.appliesAttribute).toBe('[data-kind=state]')
    expect(KIND_APPLICATIONS.metric.appliesAttribute).toBe('[data-kind=metric]')
    expect(KIND_APPLICATIONS.prose.appliesAttribute).toBe('[data-kind=prose]')
    expect(KIND_APPLICATIONS.reference.appliesAttribute).toBe('[data-kind=reference]')
    expect(KIND_APPLICATIONS.testimony.appliesAttribute).toBe('[data-kind=testimony]')
    expect(KIND_APPLICATIONS.affordance.appliesAttribute).toBe('[data-kind=affordance]')
  })
})

describe('@shrubbery/tokens — Emporium DIFFERS from Garden (the whole point)', () => {
  const gBlocks = parseBlocks(read('skin-garden.css'))
  const g = gBlocks.get('[data-skin="garden"]') ?? {}
  const empBlocks = parseBlocks(read('skin-emporium.css'))
  const emp = empBlocks.get('[data-skin="emporium"]') ?? {}
  const empRoot = empBlocks.get(':root') ?? {}
  const empResolveBlock: Block = { ...empRoot, ...emp }

  it('accent purple ≠ accent fern', () => {
    const gardenAccent = resolveRef(g['--mn-color-accent'])
    const empAccent = resolveIn(empResolveBlock, emp['--mn-color-accent'])
    expect(empAccent).not.toBe(gardenAccent)
    expect(empAccent).toBe(PURPLE_RAMP[400].toLowerCase())
    expect(gardenAccent).toBe(GARDEN_ACCENT.accent.toLowerCase())
  })

  it('font Diatype ≠ font Literata', () => {
    expect(resolveIn(empResolveBlock, emp['--mn-font-chrome'])).not.toBe(
      g['--mn-font-chrome'],
    )
  })

  it('accent channel purple ≠ accent channel fern', () => {
    expect(emp['--mn-color-accent-ch']).not.toBe(g['--mn-color-accent-ch'])
    expect(emp['--mn-color-accent-ch']).toBe(EMPORIUM_ACCENT.accentChannel)
    expect(g['--mn-color-accent-ch']).toBe(GARDEN_ACCENT.accentChannel)
  })

  it('geometry square ≠ geometry rounded', () => {
    expect(resolveIn(empResolveBlock, emp['--mn-radius-control'])).not.toBe(
      resolveRef(g['--mn-radius-control']),
    )
  })
})

describe('@shrubbery/tokens — the {skin,theme} → root-attribute applier', () => {
  // A real minimal AttrTarget (no DOM mock framework — a plain map of attrs).
  function makeTarget() {
    const attrs = new Map<string, string>()
    const target: AttrTarget = {
      setAttribute: (n, v) => void attrs.set(n, v),
      removeAttribute: n => void attrs.delete(n),
    }
    return { target, attrs }
  }

  it('emporium + light stamps [data-skin=emporium] [data-theme=light]', () => {
    const { target, attrs } = makeTarget()
    applySkinTheme({ skin: 'emporium', theme: 'light', target })
    expect(attrs.get('data-skin')).toBe('emporium')
    expect(attrs.get('data-theme')).toBe('light')
  })

  it('98 + light stamps [data-skin=98] [data-theme=light]', () => {
    const { target, attrs } = makeTarget()
    applySkinTheme({ skin: '98', theme: 'light', target })
    expect(attrs.get('data-skin')).toBe('98')
    expect(attrs.get('data-theme')).toBe('light')
  })

  it('glass + light stamps [data-skin=glass] [data-theme=light]', () => {
    const { target, attrs } = makeTarget()
    applySkinTheme({ skin: 'glass', theme: 'light', target })
    expect(attrs.get('data-skin')).toBe('glass')
    expect(attrs.get('data-theme')).toBe('light')
  })

  it('research + light stamps [data-skin=research] [data-theme=light]', () => {
    const { target, attrs } = makeTarget()
    applySkinTheme({ skin: 'research', theme: 'light', target })
    expect(attrs.get('data-skin')).toBe('research')
    expect(attrs.get('data-theme')).toBe('light')
  })

  it('greenhouse + light stamps [data-skin=greenhouse] [data-theme=light]', () => {
    const { target, attrs } = makeTarget()
    applySkinTheme({ skin: 'greenhouse', theme: 'light', target })
    expect(attrs.get('data-skin')).toBe('greenhouse')
    expect(attrs.get('data-theme')).toBe('light')
  })

  it('observatory + light stamps [data-skin=observatory] [data-theme=light]', () => {
    const { target, attrs } = makeTarget()
    applySkinTheme({ skin: 'observatory', theme: 'light', target })
    expect(attrs.get('data-skin')).toBe('observatory')
    expect(attrs.get('data-theme')).toBe('light')
  })

  it('garden REMOVES data-skin (the "[data-skin] absent" sux default)', () => {
    const { target, attrs } = makeTarget()
    attrs.set('data-skin', 'research') // pretend a prior skin was set
    applySkinTheme({ skin: 'garden', theme: 'dark', target })
    expect(attrs.has('data-skin')).toBe(false) // removeAttribute, per sux value
    expect(attrs.get('data-theme')).toBe('dark')
  })

  it('the map mirrors the sux ConfigValue.appliesAttribute literals', () => {
    expect(SKIN_APPLICATIONS.garden.appliesAttribute).toBe(
      '[data-skin] absent (removeAttribute)',
    )
    expect(SKIN_APPLICATIONS.emporium.appliesAttribute).toBe('[data-skin=emporium]')
    expect(SKIN_APPLICATIONS['98'].appliesAttribute).toBe('[data-skin=98]')
    expect(SKIN_APPLICATIONS.glass.appliesAttribute).toBe('[data-skin=glass]')
    expect(SKIN_APPLICATIONS.research.appliesAttribute).toBe('[data-skin=research]')
    expect(SKIN_APPLICATIONS.greenhouse.appliesAttribute).toBe('[data-skin=greenhouse]')
    expect(SKIN_APPLICATIONS.observatory.appliesAttribute).toBe('[data-skin=observatory]')
    expect(THEME_APPLICATIONS.dark.appliesAttribute).toBe('[data-theme=dark]')
    expect(THEME_APPLICATIONS.light.appliesAttribute).toBe('[data-theme=light]')
    expect(STANCE_APPLICATIONS.room.appliesAttribute).toBe('[data-stance=room]')
  })

  it('returns the applied ConfigValue applications (for logging, not store reads)', () => {
    const { target } = makeTarget()
    const applied = applySkinTheme({ skin: 'emporium', theme: 'dark', target })
    expect(applied.skin.literalValue).toBe('emporium')
    expect(applied.theme.literalValue).toBe('dark')
  })

  it('can update either appearance axis without disturbing the other', () => {
    const { target, attrs } = makeTarget()
    applySkinTheme({ skin: 'emporium', theme: 'dark', target })
    applySkin({ skin: '98', target })
    expect(attrs.get('data-skin')).toBe('98')
    expect(attrs.get('data-theme')).toBe('dark')
    applyTheme({ theme: 'light', target })
    expect(attrs.get('data-skin')).toBe('98')
    expect(attrs.get('data-theme')).toBe('light')
  })

  it('defines one explicit Garden → Sophia → 98 → Glass cycle', () => {
    expect(VISUAL_IDENTITY_SKINS).toEqual(['garden', 'emporium', '98', 'glass'])
    expect(nextVisualIdentitySkin('garden')).toBe('emporium')
    expect(nextVisualIdentitySkin('emporium')).toBe('98')
    expect(nextVisualIdentitySkin('98')).toBe('glass')
    expect(nextVisualIdentitySkin('glass')).toBe('garden')
    expect(nextVisualIdentitySkin('research')).toBe('garden')
  })

  it('stamps [data-stance=room] as the Greenhouse root posture', () => {
    const { target, attrs } = makeTarget()
    const applied = applyStance({ stance: 'room', target })
    expect(attrs.get('data-stance')).toBe('room')
    expect(applied.literalValue).toBe('room')
  })

  it('applyKind stamps data-kind per KIND_APPLICATIONS for every register value', () => {
    const kinds: readonly DisplayKindRegister[] = [
      'identity',
      'state',
      'metric',
      'prose',
      'reference',
      'testimony',
      'affordance',
    ]
    for (const kind of kinds) {
      const { target, attrs } = makeTarget()
      const applied = applyKind({ kind, target })
      expect(attrs.get('data-kind'), kind).toBe(KIND_APPLICATIONS[kind].value)
      expect(attrs.get('data-kind'), kind).toBe(kind)
      expect(applied).toBe(KIND_APPLICATIONS[kind])
    }
  })

  it('applyKind re-stamps (a later kind overwrites an earlier one)', () => {
    const { target, attrs } = makeTarget()
    applyKind({ kind: 'metric', target })
    expect(attrs.get('data-kind')).toBe('metric')
    applyKind({ kind: 'testimony', target })
    expect(attrs.get('data-kind')).toBe('testimony')
  })
})
