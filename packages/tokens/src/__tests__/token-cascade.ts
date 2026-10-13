/**
 * A small, honest cascade over the shipped token CSS, for the unit tier. It
 * answers one question: for the root element wearing `data-skin` / `data-theme`,
 * which declaration wins each custom property, and what does the value read
 * once its `var()`s are substituted? NO MOCKS: the input is the real CSS.
 *
 * It models only what the token layer uses: `:root`, `html:root`, and attribute
 * selectors on the root element (`[data-theme="dark"]`, `[data-skin="98"]`,
 * their compounds, and comma lists). Selectors that need another element, a
 * state, a stance or a kind never apply to the bare root, so they are skipped,
 * and so is everything inside a conditional at-rule (`@media`, `@supports`):
 * no preference or capability is assumed.
 * Ties break by specificity, then file order (the `@import` order of
 * `tokens.css`), then source order, exactly as the browser does.
 *
 * It is not a browser. The round's Chromium witness (computed styles across the
 * skin × theme matrix) is the arbiter; this lets the unit tests state, per
 * combination, what the CSS says.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SKIN_APPLICATIONS, effectiveTheme, type Skin } from '../index.js'
import { REPO_ROOT, stripComments, tokenLayerFiles } from './token-reference-scan.js'

export interface Declaration {
  readonly file: string
  readonly selector: string
  readonly name: string
  readonly value: string
  readonly line: number
  /** Position in cascade order across the whole layer. */
  readonly order: number
  /** Declared inside a conditional at-rule (`@media`, `@supports`, `@container`). */
  readonly conditional: boolean
}

/** The `[start, end)` spans of the conditional at-rule blocks in a stylesheet. */
function conditionalSpans(text: string): Array<readonly [number, number]> {
  const spans: Array<readonly [number, number]> = []
  for (const rule of text.matchAll(/@(?:media|supports|container)\b[^{]*\{/g)) {
    let depth = 0
    for (let i = rule.index! + rule[0].length - 1; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}' && --depth === 0) { spans.push([rule.index!, i + 1]); break }
    }
  }
  return spans
}

let layerCache: { root: string; declarations: Declaration[] } | null = null

/**
 * Every custom-property declaration in the token layer, in cascade order. Parsed
 * once per root: the CSS does not change while a test run does, and a lookup per
 * assertion would otherwise re-read and re-parse twenty files each time.
 */
export function layerDeclarations(root = REPO_ROOT): Declaration[] {
  if (layerCache?.root === root) return layerCache.declarations
  const out: Declaration[] = []
  for (const file of tokenLayerFiles(root)) {
    const text = stripComments(readFileSync(join(root, file), 'utf8'))
    const spans = conditionalSpans(text)
    for (const block of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = block[1]!.trim().replace(/\s+/g, ' ')
      const bodyStart = block.index! + block[0].indexOf('{') + 1
      for (const decl of block[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        const at = bodyStart + decl.index!
        out.push({ file, selector, name: decl[1]!, value: decl[2]!.trim().replace(/\s+/g, ' '),
          line: text.slice(0, at).split('\n').length, order: out.length,
          conditional: spans.some(([from, to]) => at >= from && at < to) })
      }
    }
  }
  layerCache = { root, declarations: out }
  return out
}

export interface RootAttributes {
  /** `garden` is the default skin and stamps NO attribute (the sux dim-skin rule). */
  readonly skin: string
  readonly theme: 'light' | 'dark'
}

type Specificity = readonly [classes: number, elements: number]

/** Specificity of one compound selector on the root, or null when it cannot match the bare root. */
function matchRoot(compound: string, root: RootAttributes): Specificity | null {
  const s = compound.trim()
  if (!s) return null
  const attributes = [...s.matchAll(/\[([\w-]+)\s*=\s*["']?([^"'\]]*)["']?\s*\]/g)]
  const rest = s.replace(/\[[^\]]*\]/g, '')
  if (!['', ':root', 'html', 'html:root'].includes(rest)) return null
  const stamped: Record<string, string | undefined> = {
    'data-theme': root.theme,
    'data-skin': root.skin === 'garden' ? undefined : root.skin,
  }
  for (const [, name, value] of attributes) {
    if (stamped[name!] !== value) return null
  }
  const pseudo = rest.includes(':root') ? 1 : 0
  return [attributes.length + pseudo, rest.startsWith('html') ? 1 : 0]
}

function beats(a: Specificity, b: Specificity): boolean {
  return a[0] !== b[0] ? a[0] > b[0] : a[1] >= b[1]
}

const effectiveCache = new Map<string, Map<string, string>>()

/** The winning raw value of every custom property on the root. Cached per skin and theme for the shipped layer. */
export function effectiveTokens(root: RootAttributes, declarations?: Declaration[]): Map<string, string> {
  const key = `${root.skin}/${root.theme}`
  if (!declarations) {
    const hit = effectiveCache.get(key)
    if (hit) return hit
  }
  const computed = computeEffective(root, declarations ?? layerDeclarations())
  if (!declarations) effectiveCache.set(key, computed)
  return computed
}

function computeEffective(root: RootAttributes, declarations: Declaration[]): Map<string, string> {
  const won = new Map<string, { value: string; specificity: Specificity }>()
  for (const d of declarations) {
    if (d.conditional) continue
    const specificity = d.selector.split(',').map(part => matchRoot(part, root))
      .reduce<Specificity | null>((best, next) => next && (!best || beats(next, best)) ? next : best, null)
    if (!specificity) continue
    const current = won.get(d.name)
    if (!current || beats(specificity, current.specificity)) won.set(d.name, { value: d.value, specificity })
  }
  return new Map([...won].map(([name, { value }]) => [name, value]))
}

function closing(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return i
  }
  return -1
}

/** The value of `name` with every `var()` substituted from `tokens`; a missing name with no fallback stays `var(--x)`. */
export function resolveToken(tokens: ReadonlyMap<string, string>, name: string): string {
  return substitute(tokens, tokens.get(name) ?? `var(${name})`, 0)
}

function substitute(tokens: ReadonlyMap<string, string>, text: string, depth: number): string {
  const at = text.indexOf('var(')
  if (at < 0 || depth > 12) return text
  const end = closing(text, at + 3)
  if (end < 0) return text
  const inner = text.slice(at + 4, end)
  const comma = inner.indexOf(',')
  const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
  const fallback = comma < 0 ? null : inner.slice(comma + 1).trim()
  const value = tokens.get(name) ?? (fallback ?? `var(${name})`)
  return text.slice(0, at) + substitute(tokens, value, depth + 1) + substitute(tokens, text.slice(end + 1), depth + 1)
}

export type Rgba = readonly [r: number, g: number, b: number, alpha: number]

/**
 * The colour a fully resolved value paints, for the literal forms the token
 * layer resolves to: hex, rgb()/rgba() in either syntax, `transparent`, and
 * two-colour `color-mix(in srgb, …)` (Mithras). Returns null for anything it
 * cannot read, which a test treats as a failure to be explained, never as a pass.
 * An invalid value, such as `rgba(74 136 96, 0.12)`, is null on purpose.
 */
export function paintedColour(resolved: string): Rgba | null {
  // `calc(2 * 6%)` appears in a Mithras percentage; evaluate that one form.
  const value = resolved.trim().toLowerCase()
    .replace(/calc\(\s*([\d.]+)\s*\*\s*([\d.]+)%\s*\)/g, (_, a: string, b: string) => `${Number(a) * Number(b)}%`)
  if (value === 'transparent') return [0, 0, 0, 0]
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/)
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map(c => c + c).join('') : hex[1]!
    const n = (i: number) => parseInt(digits.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), digits.length === 8 ? n(6) / 255 : 1]
  }
  const modern = value.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*(?:\/\s*([\d.]+)\s*)?\)$/)
  if (modern) return [Number(modern[1]), Number(modern[2]), Number(modern[3]), modern[4] === undefined ? 1 : Number(modern[4])]
  const legacy = value.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (legacy) return [Number(legacy[1]), Number(legacy[2]), Number(legacy[3]), legacy[4] === undefined ? 1 : Number(legacy[4])]
  const mix = value.match(/^color-mix\(\s*in srgb\s*,\s*(.+?)\s*,\s*(.+?)\s*\)$/)
  if (mix) return mixColours(mix[1]!, mix[2]!)
  return null
}

/** `color-mix(in srgb, A p%, B q%)` for two colours; a missing percentage takes the remainder (default 50). */
function mixColours(first: string, second: string): Rgba | null {
  const part = (text: string) => {
    const match = text.match(/^(.*?)(?:\s+(\d+(?:\.\d+)?)%)?$/)
    const colour = match ? paintedColour(match[1]!) : null
    return colour ? { colour, percent: match![2] === undefined ? null : Number(match![2]) } : null
  }
  const a = part(first), b = part(second)
  if (!a || !b) return null
  const pa = a.percent ?? (b.percent === null ? 50 : 100 - b.percent)
  const pb = b.percent ?? 100 - pa
  const total = pa + pb
  if (total <= 0) return null
  const wa = pa / total, wb = pb / total
  const alpha = a.colour[3] * wa + b.colour[3] * wb
  // Premultiplied mixing: a transparent partner contributes no colour, only less alpha.
  const channel = (i: 0 | 1 | 2) => alpha === 0 ? 0 : (a.colour[i] * a.colour[3] * wa + b.colour[i] * b.colour[3] * wb) / alpha
  return [Math.round(channel(0)), Math.round(channel(1)), Math.round(channel(2)), alpha * (total / 100 > 1 ? 1 : total / 100)]
}

/** `top` painted over `under`: the opaque result. A translucent surface is judged by what it lets through. */
export function compositeOver(top: Rgba, under: Rgba): Rgba {
  const alpha = top[3] + under[3] * (1 - top[3])
  const channel = (i: 0 | 1 | 2) => (alpha === 0 ? 0 : (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / alpha)
  return [channel(0), channel(1), channel(2), alpha]
}

/** WCAG relative luminance of an opaque colour. */
function luminance([r, g, b]: Rgba): number {
  const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio between two opaque colours. */
export function contrast(foreground: Rgba, background: Rgba): number {
  const [hi, lo] = [luminance(foreground), luminance(background)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** The ten skin/theme combinations the review probed, plus Garden light, the default. */
export const SKIN_THEME_MATRIX: readonly RootAttributes[] = [
  { skin: 'garden', theme: 'light' }, { skin: 'garden', theme: 'dark' },
  { skin: '98', theme: 'light' }, { skin: '98', theme: 'dark' },
  { skin: 'emporium', theme: 'light' }, { skin: 'emporium', theme: 'dark' },
  { skin: 'research', theme: 'light' }, { skin: 'observatory', theme: 'dark' },
  { skin: 'glass', theme: 'light' }, { skin: 'mithras', theme: 'light' },
  { skin: 'greenhouse', theme: 'light' },
]

/**
 * Every skin and theme the app can actually apply: each skin in both themes,
 * except a skin with one register only (Mithras is light-only; the applier
 * stamps the fixed theme, see `effectiveTheme`).
 */
export const ALL_SKIN_THEMES: readonly RootAttributes[] = (Object.keys(SKIN_APPLICATIONS) as Skin[])
  .flatMap(skin => (['light', 'dark'] as const)
    .filter(theme => effectiveTheme(skin, theme) === theme)
    .map(theme => ({ skin, theme })))
