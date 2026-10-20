/**
 * COLOUR-FORMULA CONFORMANCE (review P0.1 / Appendix B, design §9). NO MOCKS:
 * it reads the shipped token CSS, substitutes every definition of every custom
 * property a colour function reads, and checks the result is valid CSS colour
 * syntax.
 *
 * The defect. The accent channels are SPACE-separated triples
 * (`--mn-color-accent-ch: 74 136 96`). `rgba(var(--mn-color-accent-ch), 0.12)`
 * therefore expands to `rgba(74 136 96, 0.12)`, which mixes the modern and the
 * legacy syntax and is invalid. A custom property accepts any token stream, so
 * nothing complains at parse time; the failure appears only where the value is
 * used (`background: var(--mn-color-interactive-selected)`), which becomes
 * invalid at computed-value time and falls back to `transparent`. Result in
 * Garden, research and greenhouse: the selection and hover washes did not exist.
 * The fix is mechanical: `rgb(var(--x-ch) / a)`, the form `--mn-focus-ring`
 * already used. Only 98, Glass and Mithras (literal colours) resolved correctly.
 *
 * (The real-engine confirmation, getComputedStyle in Chromium across the skin ×
 * theme matrix, is the browser witness in the round's wave0/ directory; a unit
 * test cannot replace the engine, so this one checks the syntax the engine
 * would reject.)
 */
import { describe, expect, it } from 'vitest'
import { effectiveTokens, layerDeclarations, paintedColour, resolveToken, SKIN_THEME_MATRIX } from './token-cascade.js'
import { componentSources, legacyChannelCalls } from './token-reference-scan.js'

const declarations = layerDeclarations()
const definitions = new Map<string, string[]>()
for (const d of declarations) definitions.set(d.name, [...(definitions.get(d.name) ?? []), d.value])

/** Index of the paren that closes the `(` at `open`. */
function closing(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return i
  }
  return -1
}

const MAX_ALTERNATIVES = 500

/** Every way `text` can read once its `var()`s are replaced by their definitions (or fallbacks). */
function expand(text: string, depth = 0): string[] {
  const at = text.indexOf('var(')
  if (at < 0 || depth > 8) return [text]
  const end = closing(text, at + 3)
  if (end < 0) return [text]
  const inner = text.slice(at + 4, end)
  const comma = inner.indexOf(',')
  const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
  const fallback = comma < 0 ? null : inner.slice(comma + 1).trim()
  const replacements = definitions.get(name)?.flatMap(value => expand(value, depth + 1))
    ?? (fallback === null ? [`var(${name})`] : expand(fallback, depth + 1))
  const rest = expand(text.slice(end + 1), depth + 1)
  const out: string[] = []
  for (const replacement of replacements) {
    for (const tail of rest) {
      out.push(text.slice(0, at) + replacement + tail)
      if (out.length >= MAX_ALTERNATIVES) return out
    }
  }
  return out
}

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`
const CHANNEL = `(?:${NUMBER}%?)`
/** rgb()/rgba() in the legacy form (commas throughout) or the modern form (spaces, `/ alpha`). */
const LEGACY = new RegExp(`^rgba?\\(\\s*${CHANNEL}\\s*,\\s*${CHANNEL}\\s*,\\s*${CHANNEL}\\s*(?:,\\s*${CHANNEL}\\s*)?\\)$`, 'i')
const MODERN = new RegExp(`^rgba?\\(\\s*${CHANNEL}\\s+${CHANNEL}\\s+${CHANNEL}\\s*(?:/\\s*${CHANNEL}\\s*)?\\)$`, 'i')
const isValidRgb = (call: string) => LEGACY.test(call) || MODERN.test(call)

/** The rgb()/rgba() calls in a raw value that read a custom property. */
function colourCallsReadingProperties(value: string): string[] {
  const calls: string[] = []
  for (const start of value.matchAll(/rgba?\(/gi)) {
    const open = start.index! + start[0].length - 1
    const end = closing(value, open)
    if (end > 0) {
      const call = value.slice(start.index!, end + 1)
      if (call.includes('var(')) calls.push(call)
    }
  }
  return calls
}

describe('colour formulas: the channel triples', () => {
  it('are space-separated triples wherever they are defined (the invariant the formula rule rests on)', () => {
    const channels = declarations.filter(d => d.name.endsWith('-ch'))
    expect(channels.length).toBeGreaterThan(10)
    const notTriples = channels.flatMap(d => expand(d.value).map(value => ({ d, value })))
      .filter(({ value }) => !/^\d{1,3} \d{1,3} \d{1,3}$/.test(value.trim()))
    expect(notTriples.map(({ d, value }) => `${d.file}:${d.line} ${d.name}: ${value}`)).toEqual([])
  })
})

describe('colour formulas: every rgb()/rgba() built from a custom property is valid CSS', () => {
  it('in every definition of every property it reads', () => {
    const invalid: string[] = []
    for (const d of declarations) {
      for (const call of colourCallsReadingProperties(d.value)) {
        const bad = expand(call).filter(resolved => !isValidRgb(resolved))
        if (bad.length) {
          invalid.push(`${d.file.split('/').pop()}:${d.line} ${d.name} [${d.selector}]  ${call}  →  ${bad[0]}` +
            (bad.length > 1 ? `  (+${bad.length - 1} more definitions of the channel)` : ''))
        }
      }
    }
    expect(invalid).toEqual([])
  })

  it('is checked by a validator that accepts the repaired forms and rejects the defect', () => {
    expect(isValidRgb('rgb(74 136 96 / 0.12)')).toBe(true)
    expect(isValidRgb('rgba(74, 136, 96, 0.12)')).toBe(true)
    expect(isValidRgb('rgb(74 136 96)')).toBe(true)
    expect(isValidRgb('rgba(74 136 96, 0.12)')).toBe(false)
    expect(isValidRgb('rgb(74, 136, 96 / 0.12)')).toBe(false)
    expect(isValidRgb('rgba(var(--x-ch), 0.12)')).toBe(false)
  })
})

/**
 * The repair is mechanical, not a redesign: every wash keeps the alpha it was
 * written with. (Keyed by file, selector and name because research and
 * greenhouse state the same role twice, light and dark, with different alphas.)
 */
const DARK = '[data-theme="dark"]'
const INTENDED_ALPHA: ReadonlyArray<readonly [file: string, selector: string, name: string, alpha: number]> = [
  ['semantic.css', ':root', '--mn-color-interactive-hover', 0.08],
  ['semantic.css', ':root', '--mn-color-interactive-active', 0.15],
  ['semantic.css', ':root', '--mn-color-interactive-selected', 0.12],
  ['semantic.css', ':root', '--mn-shadow-primary', 0.16],
  ['theme-dark.css', DARK, '--mn-shadow-primary', 0.18],
  ['skin-research.css', '[data-skin="research"]', '--mn-color-surface-sunken', 0.055],
  ['skin-research.css', '[data-skin="research"]', '--mn-color-surface-hover', 0.075],
  ['skin-research.css', '[data-skin="research"]', '--mn-color-surface-active', 0.12],
  ['skin-research.css', '[data-skin="research"]', '--mn-color-surface-accent-subtle', 0.08],
  ['skin-research.css', `${DARK}[data-skin="research"]`, '--mn-color-surface-accent', 0.14],
  ['skin-research.css', `${DARK}[data-skin="research"]`, '--mn-color-surface-hover', 0.07],
  ['skin-research.css', `${DARK}[data-skin="research"]`, '--mn-color-surface-active', 0.12],
  ['skin-research.css', `${DARK}[data-skin="research"]`, '--mn-color-surface-accent-subtle', 0.08],
  ['skin-research.css', `${DARK}[data-skin="research"]`, '--mn-color-surface-accent-strong', 0.2],
  ['skin-greenhouse.css', '[data-skin="greenhouse"]', '--mn-color-surface-hover', 0.07],
  ['skin-greenhouse.css', '[data-skin="greenhouse"]', '--mn-color-surface-active', 0.12],
  ['skin-greenhouse.css', '[data-skin="greenhouse"]', '--mn-color-surface-accent-subtle', 0.08],
  ['skin-greenhouse.css', `${DARK}[data-skin="greenhouse"]`, '--mn-color-surface-accent', 0.14],
  ['skin-greenhouse.css', `${DARK}[data-skin="greenhouse"]`, '--mn-color-surface-hover', 0.08],
  ['skin-greenhouse.css', `${DARK}[data-skin="greenhouse"]`, '--mn-color-surface-active', 0.14],
  ['skin-greenhouse.css', `${DARK}[data-skin="greenhouse"]`, '--mn-color-surface-accent-subtle', 0.09],
  ['skin-greenhouse.css', `${DARK}[data-skin="greenhouse"]`, '--mn-color-surface-accent-strong', 0.2],
  // The Sophia skin's redesign (2026-10-20) set its dark selected wash at 14% of the blue-400 channel.
  ['skin-emporium.css', `${DARK}[data-skin="emporium"], ${DARK}[data-design="emporium"]`, '--mn-color-surface-accent', 0.14],
]

/**
 * The alpha of the last rgb()/rgba() call in a value, in any of its forms:
 * modern (`rgb(r g b / a)`, `rgb(var(--x-ch) / a)`), legacy (`rgba(r, g, b, a)`)
 * and the broken legacy-with-channel form (`rgba(var(--x-ch), a)`) the repair
 * replaces, so the same assertion reads before and after.
 */
function alphaOfLastColourCall(value: string): number | null {
  const last = [...value.matchAll(/rgba?\(/gi)].at(-1)
  if (!last) return null
  const end = closing(value, last.index! + last[0].length - 1)
  const inside = value.slice(last.index! + last[0].length, end)
  const slash = inside.match(/\/\s*([\d.]+)\s*$/)
  if (slash) return Number(slash[1])
  const parts = inside.split(',')
  if (inside.includes('var(')) return parts.length === 2 ? Number(parts[1]) : null
  return parts.length === 4 ? Number(parts[3]) : null
}

describe('colour formulas: the repair keeps every intended alpha', () => {
  for (const [file, selector, name, alpha] of INTENDED_ALPHA) {
    it(`${file} ${selector} ${name} stays at ${alpha}`, () => {
      const found = declarations.filter(d => d.file.endsWith(`/${file}`) && d.selector === selector && d.name === name)
      expect(found, `${name} must be declared once under ${selector}`).toHaveLength(1)
      expect(alphaOfLastColourCall(found[0]!.value)).toBe(alpha)
    })
  }
})

describe('colour formulas: no skin or theme declares the selection fill transparent', () => {
  it('gives --mn-color-interactive-selected a non-zero alpha wherever it is declared', () => {
    // Only the cascade the browser always applies: a declaration inside a conditional at-rule (`@media`,
    // `@supports`) is a preference-specific override, and the cascade helper skips those for the same reason.
    // (The Hotdog Stand skin's reduced-transparency block makes the selection a SOLID palette colour,
    // `var(--mn-hds-workspace)`: opaque by design, and it carries no alpha to read.)
    const selected = declarations.filter(d => d.name === '--mn-color-interactive-selected' && !d.conditional)
    expect(selected.length).toBeGreaterThanOrEqual(5)
    for (const d of selected) {
      const mix = d.value.match(/color-mix\(.*?\s(\d+(?:\.\d+)?)%,\s*(?:transparent|var\([^)]*\))\)/)
      const alpha = mix ? Number(mix[1]) / 100 : alphaOfLastColourCall(d.value)
      expect(alpha, `${d.file}:${d.line} ${d.value}`).not.toBeNull()
      expect(alpha!, `${d.file}:${d.line} ${d.value}`).toBeGreaterThan(0)
    }
  })
})

/**
 * The same promise, stated per skin and theme with the cascade the browser
 * applies: what the selection and hover washes resolve to on the root element.
 * (Chromium confirms the computed values in the round's browser witness.)
 */
const WASHES = [
  '--mn-color-interactive-hover', '--mn-color-interactive-active', '--mn-color-interactive-selected',
  '--mn-color-surface-hover', '--mn-color-surface-active',
  '--mn-color-surface-accent', '--mn-color-surface-accent-subtle', '--mn-color-surface-accent-strong',
] as const

describe('colour formulas: every wash paints, in every skin and theme the review probed', () => {
  for (const root of SKIN_THEME_MATRIX) {
    it(`${root.skin} ${root.theme}: hover, active, selected and the accent surfaces are visible colours`, () => {
      const tokens = effectiveTokens(root)
      const report = WASHES.map(name => {
        const resolved = resolveToken(tokens, name)
        const painted = paintedColour(resolved)
        return { name, resolved, visible: painted !== null && painted[3] > 0 }
      })
      expect(report.filter(entry => !entry.visible).map(entry => `${entry.name} = ${entry.resolved}`)).toEqual([])
    })
  }
})

/**
 * The same defect outside the token layer. The editor's paper material
 * (`editor-host.ts`) re-declared two washes as
 * `rgba(var(--mn-editor-paper-accent-ch, 55 109 87), 0.11)`: the fallback is a
 * space-separated triple too, so the call was invalid and the paper's pressed
 * and accent-subtle washes never painted. Any shipped stylesheet may repeat the
 * mistake, so this reads every one.
 */
describe('colour formulas: no shipped stylesheet spends a channel triple the legacy way', () => {
  it('has the scanner it relies on: it finds the legacy form, and only the legacy form', () => {
    const found = legacyChannelCalls([
      'a { color: rgba(var(--x-ch), 0.1); }',
      'b { color: rgba(var(--x-ch, 55 109 87), .11); }',
      'c { color: rgb(var(--x-ch) / 0.1); }',
      'd { color: rgba(var(--r), var(--g), var(--b), 0.5); }',
      'e { color: rgba(10, 20, 30, 0.5); }',
      '/* f { color: rgba(var(--commented-ch), 1); } */',
    ].join('\n'))
    expect(found.map(hit => [hit.line, hit.call])).toEqual([
      [1, 'rgba(var(--x-ch), 0.1)'],
      [2, 'rgba(var(--x-ch, 55 109 87), .11)'],
    ])
  })

  it('in any package or app source', () => {
    const offenders = [...componentSources()].flatMap(([file, source]) =>
      legacyChannelCalls(source).map(hit => `${file}:${hit.line}  ${hit.call}`))
    expect(offenders).toEqual([])
  })
})
