/**
 * vega-theme.test.ts — direct coverage for the chart grammar module:
 * `buildVegaTheme`, the sequential/diverging ramp derivation, status colors,
 * `assignCategoricalScale`'s fixed-order/fold-to-Other behavior,
 * `mergeVegaTheme`'s one-level-deep-object / whole-array-replace semantics,
 * `isValidVegaThemeOverride`'s structural gate, `resolveVegaThemeMode`'s
 * selection (not live-flip) off `data-theme`, and `ensureVegaTooltipStyles`'s
 * idempotent real-CSS injection. `chart-vega-lite-face.test.ts` and
 * `query-block-vega.test.ts` cover these again through their own callers'
 * lens; this file is the module's own direct proof.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  OBSERVATORY_CHART_CATEGORICAL,
  OBSERVATORY_CHART_DIVERGING,
  OBSERVATORY_CHART_SEQUENTIAL_AZURE,
  OBSERVATORY_CHART_STATUS,
} from '@shrubbery/tokens'
import {
  CATEGORICAL_PALETTE,
  CHART_SURFACE,
  DARK_BASELINE_SKINS,
  MAX_CATEGORICAL_SERIES,
  VEGA_THEME_LAW_GUARDED_KEYS,
  VEGA_THEME_OVERRIDE_KEYS,
  assignCategoricalScale,
  createCategoricalSlotAssignment,
  buildVegaTheme,
  divergingRange,
  QUERY_BLOCK_VEGA_CONFIG,
  ensureVegaTooltipStyles,
  isValidVegaThemeOverride,
  validateVegaThemeOverride,
  mergeVegaTheme,
  resolveVegaThemeMode,
  sequentialRange,
  statusColor,
  observeVegaThemeFlips,
  sanitizeAuthoredVegaConfig,
  sanitizeAuthoredVegaSpecColors,
} from '../vega-theme.js'

afterEach(() => {
  document.getElementById('sh-vega-tooltip-style')?.remove()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-skin')
  document.documentElement.style.removeProperty('--mn-font-chrome')
  document.documentElement.style.removeProperty('--mn-font-mono')
})

describe('CATEGORICAL_PALETTE', () => {
  it('is the validated 5-slot palette, fixed order — never reordered by any function in this module', () => {
    expect(CATEGORICAL_PALETTE.map((slot) => slot.name)).toEqual([
      'azure',
      'terracotta',
      'violet',
      'chartreuse',
      'magenta',
    ])
    expect(MAX_CATEGORICAL_SERIES).toBe(5)
  })

  it('AGREES byte-for-byte with @shrubbery/tokens\' published palette constants — one validated palette, two layers, zero drift', () => {
    for (const slot of CATEGORICAL_PALETTE) {
      const published = OBSERVATORY_CHART_CATEGORICAL[slot.name as keyof typeof OBSERVATORY_CHART_CATEGORICAL]
      expect(published).toBeDefined()
      expect({ light: slot.light, dark: slot.dark }).toEqual(published)
    }
  })
})

describe('buildVegaTheme', () => {
  it('exports a STATICALLY-TYPED config — QUERY_BLOCK_VEGA_CONFIG.axis.labelColor type-checks with no cast (the base contract, restored)', () => {
    // These lines are the proof: they compile. A Record<string, unknown>
    // export would fail tsc on every one of them.
    const labelColor: string = QUERY_BLOCK_VEGA_CONFIG.axis.labelColor
    const categoryRange: string[] = QUERY_BLOCK_VEGA_CONFIG.range.category
    const barRadius: number = QUERY_BLOCK_VEGA_CONFIG.bar.cornerRadiusEnd
    expect(labelColor).toBe(buildVegaTheme('light').axis.labelColor)
    expect(categoryRange).toEqual(CATEGORICAL_PALETTE.map((slot) => slot.light))
    expect(barRadius).toBe(4)
  })


  it('light mode: the validated categorical range, in fixed order, and a slot-1 default mark color', () => {
    const theme = buildVegaTheme('light')
    expect((theme.range as Record<string, unknown>).category).toEqual(CATEGORICAL_PALETTE.map((s) => s.light))
    expect((theme.mark as Record<string, unknown>).color).toBe(CATEGORICAL_PALETTE[0].light)
    expect(theme.background).toBe(CHART_SURFACE.light) // the validated light surface, not 'transparent'
  })

  it('dark mode: a SELECTED independent step set, not a lightness-inverted flip of light mode', () => {
    const theme = buildVegaTheme('dark')
    expect((theme.range as Record<string, unknown>).category).toEqual(CATEGORICAL_PALETTE.map((s) => s.dark))
    expect(theme.background).toBe(CHART_SURFACE.dark)
    // Dark categorical hex values are genuinely different strings than light's — not derived by a formula from them.
    const lightHexes = new Set(CATEGORICAL_PALETTE.map((s) => s.light))
    for (const slot of CATEGORICAL_PALETTE) expect(lightHexes.has(slot.dark)).toBe(false)
  })

  it('mark specs: 4px rounded bar end, 2px lines with round joins, >=8px filled points with a surface-color ring, ~10% area wash', () => {
    const theme = buildVegaTheme('light')
    expect(theme.bar).toMatchObject({ cornerRadiusEnd: 4 })
    expect(theme.line).toMatchObject({ strokeWidth: 2, strokeCap: 'round', strokeJoin: 'round' })
    const point = theme.point as Record<string, unknown>
    expect(point.filled).toBe(true)
    expect(point.size as number).toBeGreaterThanOrEqual(50) // size=80 -> diameter ~10.1px, well over the 8px floor
    expect(point.stroke).toBe(CHART_SURFACE.light) // the surface color, for the 2px ring
    expect(theme.area).toEqual({ opacity: 0.1 })
  })

  it('every top-level key it sets is either graph-overridable (VEGA_THEME_OVERRIDE_KEYS) or an explicitly law-guarded color surface — nothing unaccounted for', () => {
    const theme = buildVegaTheme('light')
    for (const key of Object.keys(theme)) {
      const overridable = (VEGA_THEME_OVERRIDE_KEYS as readonly string[]).includes(key)
      const guarded = (VEGA_THEME_LAW_GUARDED_KEYS as readonly string[]).includes(key)
      expect(overridable || guarded).toBe(true)
      expect(overridable && guarded).toBe(false)
    }
    // The two color-law surfaces are exactly the ones deliberately excluded.
    expect([...VEGA_THEME_LAW_GUARDED_KEYS].sort()).toEqual(['background', 'range'])
  })
})

describe('buildVegaTheme — chart typography follows the room voice', () => {
  const MONO = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace"

  it('reads the COMPUTED --mn-font-chrome off the document root — Observatory\'s mono console voice reaches the axes/legend/title', () => {
    // The same indirection the skin CSS uses: --mn-font-chrome -> var(--mn-font-mono).
    document.documentElement.style.setProperty('--mn-font-mono', MONO)
    document.documentElement.style.setProperty('--mn-font-chrome', 'var(--mn-font-mono)')
    const theme = buildVegaTheme('dark', document)
    expect(theme.font).toBe(MONO)
    expect(theme.axis.labelFont).toBe(MONO)
    expect(theme.axis.titleFont).toBe(MONO)
    expect(theme.legend.labelFont).toBe(MONO)
    expect(theme.title.font).toBe(MONO)
    expect(theme.title.subtitleFont).toBe(MONO)
  })

  it('falls back to the sans stack when no token cascade is reachable (no hint, no token set)', () => {
    const theme = buildVegaTheme('light')
    expect(theme.font).toContain('Source Sans 3')
    expect(theme.axis.labelFont).toBe(theme.font)
  })
})

describe('sequentialRange / divergingRange', () => {
  it('sequential: dark mode re-anchors by reversing the light-mode steps, never inventing a second ramp — endpoints agree with the published token ramp', () => {
    const light = sequentialRange('light')
    const dark = sequentialRange('dark')
    expect(dark).toEqual([...light].reverse())
    expect(light[0]).toBe(OBSERVATORY_CHART_SEQUENTIAL_AZURE[100]) // lightest published step
    expect(light[light.length - 1]).toBe(OBSERVATORY_CHART_SEQUENTIAL_AZURE[700]) // darkest published step
  })

  it('diverging: independently-validated light/dark step sets, both centered on the published NEUTRAL midpoints (parchment-100 / ink-300), never a hue', () => {
    const light = divergingRange('light')
    const dark = divergingRange('dark')
    expect(light).toHaveLength(7)
    expect(dark).toHaveLength(7)
    expect(light[3]).toBe(OBSERVATORY_CHART_DIVERGING.light.mid) // = --mn-ref-parchment-100
    expect(dark[3]).toBe(OBSERVATORY_CHART_DIVERGING.dark.mid) // = --mn-ref-ink-300
  })
})

describe('statusColor', () => {
  it('is reserved and independent of the categorical palette hexes', () => {
    const categoricalHexes = new Set([
      ...CATEGORICAL_PALETTE.map((s) => s.light),
      ...CATEGORICAL_PALETTE.map((s) => s.dark),
    ])
    for (const mode of ['light', 'dark'] as const) {
      for (const tone of ['good', 'warning', 'serious', 'critical'] as const) {
        expect(categoricalHexes.has(statusColor(tone, mode))).toBe(false)
      }
    }
  })

  it('agrees per tone/mode with @shrubbery/tokens\' published status quad (incl. the --mn-color-success/--mn-color-danger dark copies)', () => {
    for (const mode of ['light', 'dark'] as const) {
      for (const tone of ['good', 'warning', 'serious', 'critical'] as const) {
        expect(statusColor(tone, mode)).toBe(OBSERVATORY_CHART_STATUS[mode][tone])
      }
    }
  })
})

describe('assignCategoricalScale', () => {
  it('assigns slots by FIRST APPEARANCE in the data, never by name rank', () => {
    const scale = assignCategoricalScale(['zebra', 'apple', 'mango'], 'light')
    expect(scale.domain).toEqual(['zebra', 'apple', 'mango'])
    expect(scale.range).toEqual([CATEGORICAL_PALETTE[0].light, CATEGORICAL_PALETTE[1].light, CATEGORICAL_PALETTE[2].light])
    expect(scale.folded).toBe(false)
  })

  it('MEMBERSHIP-CHANGE STABILITY: adding a lexically-earlier entity on a later poll never re-colors an entity already on screen', () => {
    const assignment = createCategoricalSlotAssignment()
    const first = assignCategoricalScale(['mango'], 'light', assignment)
    expect(first.domain).toEqual(['mango'])
    expect(first.range).toEqual([CATEGORICAL_PALETTE[0].light]) // mango = azure

    // 'apple' sorts BEFORE 'mango' — under the old name-rank scheme it would
    // have stolen slot 1 and shifted mango to slot 2. It must not.
    const second = assignCategoricalScale(['apple', 'mango'], 'light', assignment)
    const mangoColor = second.range[second.domain.indexOf('mango')]
    const appleColor = second.range[second.domain.indexOf('apple')]
    expect(mangoColor).toBe(CATEGORICAL_PALETTE[0].light) // mango KEEPS azure
    expect(appleColor).toBe(CATEGORICAL_PALETTE[1].light) // the newcomer takes the NEXT slot
  })

  it('a persistent assignment makes later-poll row order irrelevant — the entity keeps its first-claimed slot', () => {
    const assignment = createCategoricalSlotAssignment()
    const first = assignCategoricalScale(['a', 'b'], 'light', assignment)
    const shuffled = assignCategoricalScale(['b', 'a'], 'light', assignment)
    expect(shuffled.domain).toEqual(first.domain)
    expect(shuffled.range).toEqual(first.range)
  })

  it('an entity that disappears and returns keeps its slot; its slot is never reclaimed by a newcomer', () => {
    const assignment = createCategoricalSlotAssignment()
    assignCategoricalScale(['a', 'b', 'c', 'd', 'e'], 'light', assignment) // all 5 slots claimed
    const laterPoll = assignCategoricalScale(['f', 'a'], 'light', assignment)
    // 'f' arrived after every slot was claimed — it folds, even though only
    // two values are currently visible (slots are per-entity, not per-census).
    expect(laterPoll.folded).toBe(true)
    expect(laterPoll.domain).toEqual(['a', 'Other'])
    expect(laterPoll.range[0]).toBe(CATEGORICAL_PALETTE[0].light) // 'a' still wears its original slot
    const returning = assignCategoricalScale(['e'], 'light', assignment)
    expect(returning.range).toEqual([CATEGORICAL_PALETTE[4].light]) // 'e' returns to ITS slot, not slot 1
  })

  it('numeric/boolean series values keep their canonical primitive identity in the domain', () => {
    const scale = assignCategoricalScale([2026, 2027, true], 'light')
    expect(scale.domain).toEqual([2026, 2027, true])
  })

  it('dedupes repeated values', () => {
    const scale = assignCategoricalScale(['a', 'a', 'a', 'b'], 'light')
    expect(scale.domain).toEqual(['a', 'b'])
  })

  it('folds the tail beyond MAX_CATEGORICAL_SERIES into a single "Other", colored with the theme text-secondary gray — never a 6th hue, never a status color', () => {
    const scale = assignCategoricalScale(['a', 'b', 'c', 'd', 'e', 'f'], 'light')
    expect(scale.folded).toBe(true)
    expect(scale.domain).toEqual(['a', 'b', 'c', 'd', 'e', 'Other'])
    expect(scale.range).toHaveLength(6)
    expect(scale.range.slice(0, 5)).toEqual(CATEGORICAL_PALETTE.map((s) => s.light))
    const otherColor = scale.range[5]
    expect(CATEGORICAL_PALETTE.map((s) => s.light)).not.toContain(otherColor)
    const statusHexes = (['good', 'warning', 'serious', 'critical'] as const).flatMap((tone) => [
      statusColor(tone, 'light'),
      statusColor(tone, 'dark'),
    ])
    expect(statusHexes).not.toContain(otherColor) // not a status color either
  })

  it('exactly MAX_CATEGORICAL_SERIES distinct values does NOT fold', () => {
    const scale = assignCategoricalScale(['a', 'b', 'c', 'd', 'e'], 'light')
    expect(scale.folded).toBe(false)
    expect(scale.domain).toHaveLength(5)
  })
})

describe('mergeVegaTheme', () => {
  it('merges nested plain objects one level deep — override keeps base keys it does not touch', () => {
    const base = { axis: { labelColor: 'base-label', titleColor: 'base-title' }, mark: { color: 'base-mark' } }
    const merged = mergeVegaTheme(base, { axis: { labelColor: 'override-label' } })
    expect(merged.axis).toEqual({ labelColor: 'override-label', titleColor: 'base-title' })
    expect(merged.mark).toEqual({ color: 'base-mark' }) // untouched key survives verbatim
  })

  it('replaces arrays wholesale — never partially mixes a graph author\'s array with the base array', () => {
    // A style array (axis.gridDash), NOT a palette: palette arrays (range.*)
    // never reach this merge — validateVegaThemeOverride rejects them first.
    const base = { axis: { gridDash: [1, 1, 1] } }
    const merged = mergeVegaTheme(base, { axis: { gridDash: [4, 2] } })
    expect(merged.axis).toEqual({ gridDash: [4, 2] })
  })

  it('replaces primitives wholesale', () => {
    const merged = mergeVegaTheme({ background: '#fff' }, { background: '#000' })
    expect(merged.background).toBe('#000')
  })

  it('is pure — never mutates either input', () => {
    const base = { axis: { labelColor: 'a' } }
    const override = { axis: { labelColor: 'b' } }
    mergeVegaTheme(base, override)
    expect(base).toEqual({ axis: { labelColor: 'a' } })
    expect(override).toEqual({ axis: { labelColor: 'b' } })
  })

  it('adds a brand-new top-level key the base never had', () => {
    const merged = mergeVegaTheme({}, { background: '#000' })
    expect(merged.background).toBe('#000')
  })
})

describe('validateVegaThemeOverride / isValidVegaThemeOverride', () => {
  it('accepts law-safe STYLE overrides: typography, sizes, padding, axis/grid/legend style', () => {
    expect(
      isValidVegaThemeOverride({
        font: 'serif',
        axis: { gridColor: 'rgba(64, 61, 56, 0.05)', labelFontSize: 12, labelPadding: 6 },
        legend: { orient: 'top', labelFontSize: 12 },
        title: { fontSize: 14, fontWeight: 700 },
        bar: { discreteBandSize: 18, cornerRadiusEnd: 2 },
        line: { strokeWidth: 3 },
        point: { size: 100 },
      }),
    ).toBe(true)
    expect(isValidVegaThemeOverride({})).toBe(true)
  })

  it('REJECTS palette ranges — the chart color law is not a theming surface', () => {
    const verdict = validateVegaThemeOverride({ range: { category: ['#111', '#222'] } })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.reason).toContain('color-law')
    expect(verdict.reason).toContain('range')
  })

  it('REJECTS the chart background — the surface every palette step was validated against', () => {
    const verdict = validateVegaThemeOverride({ background: '#000000' })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.reason).toContain('background')
  })

  it('REJECTS mark colors under every mark-bearing key — a mark color IS a palette assignment', () => {
    for (const candidate of [
      { mark: { color: '#ff00ff' } },
      { bar: { fill: '#ff00ff' } },
      { line: { stroke: '#ff00ff' } },
      { point: { fill: '#ff00ff' } },
      { area: { color: '#ff00ff' } },
      { view: { stroke: '#ff00ff' } },
    ]) {
      const verdict = validateVegaThemeOverride(candidate)
      expect(verdict.ok).toBe(false)
      if (verdict.ok) throw new Error('unreachable')
      expect(verdict.reason).toContain('mark color')
    }
    // …while the same keys' SIZE/SHAPE properties stay overridable.
    expect(isValidVegaThemeOverride({ mark: { tooltip: false }, bar: { cornerRadiusEnd: 0 } })).toBe(true)
  })

  it('rejects an unknown top-level key — a likely typo, not silently dropped — with the key list in the reason', () => {
    const verdict = validateVegaThemeOverride({ axsi: {} })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.reason).toContain("unknown theme key 'axsi'")
  })

  it('rejects non-plain-object candidates', () => {
    expect(isValidVegaThemeOverride(null)).toBe(false)
    expect(isValidVegaThemeOverride(['axis'])).toBe(false)
    expect(isValidVegaThemeOverride('axis')).toBe(false)
    expect(isValidVegaThemeOverride(42)).toBe(false)
  })
})

describe('resolveVegaThemeMode', () => {
  it('defaults to light when data-theme is absent — the same default packages/tokens/css/semantic.css assumes with no [data-theme] qualifier', () => {
    expect(resolveVegaThemeMode(document)).toBe('light')
    expect(resolveVegaThemeMode(document.createElement('div'))).toBe('light') // detached element: still has an ownerDocument
    expect(resolveVegaThemeMode(null)).toBe('light')
    expect(resolveVegaThemeMode()).toBe('light')
  })

  it('selects dark ONLY when [data-theme=dark] is actually stamped — a deliberate selection, not an automatic OS-preference flip', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    expect(resolveVegaThemeMode(document)).toBe('dark')
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(resolveVegaThemeMode(el)).toBe('dark')
    el.remove()
  })

  it('any other data-theme value falls back to light (never crashes on an unrecognized value)', () => {
    document.documentElement.setAttribute('data-theme', 'sepia')
    expect(resolveVegaThemeMode(document)).toBe('light')
  })

  it('DARK-BASELINE SKIN: [data-skin=observatory] selects dark even with data-theme absent — the room has no daylight register', () => {
    document.documentElement.setAttribute('data-skin', 'observatory')
    expect(resolveVegaThemeMode(document)).toBe('dark')
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(resolveVegaThemeMode(el)).toBe('dark')
    el.remove()
  })

  it('DARK-BASELINE SKIN: observatory + data-theme=light is STILL dark — skin-observatory.css has no light composition to select', () => {
    document.documentElement.setAttribute('data-skin', 'observatory')
    document.documentElement.setAttribute('data-theme', 'light')
    expect(resolveVegaThemeMode(document)).toBe('dark')
  })

  it('DARK-BASELINE SKIN: observatory + data-theme=dark (true night) is dark', () => {
    document.documentElement.setAttribute('data-skin', 'observatory')
    document.documentElement.setAttribute('data-theme', 'dark')
    expect(resolveVegaThemeMode(document)).toBe('dark')
  })

  it('light-baseline skins stay light without an explicit data-theme=dark', () => {
    for (const skin of ['emporium', '98', 'glass', 'research', 'greenhouse']) {
      document.documentElement.setAttribute('data-skin', skin)
      expect(resolveVegaThemeMode(document)).toBe('light')
    }
    expect(DARK_BASELINE_SKINS.has('observatory')).toBe(true)
  })
})

describe('ensureVegaTooltipStyles', () => {
  it('injects a real stylesheet, once, using var(--mn-color-*) references (real cascading CSS, not baked spec JSON)', () => {
    expect(document.getElementById('sh-vega-tooltip-style')).toBeNull()
    ensureVegaTooltipStyles(document)
    const style = document.getElementById('sh-vega-tooltip-style')
    expect(style).not.toBeNull()
    expect(style?.tagName).toBe('STYLE')
    expect(style?.textContent).toContain('#vg-tooltip-element')
    expect(style?.textContent).toContain('var(--mn-color-surface-elevated')
    expect(style?.textContent).toContain('font-variant-numeric: tabular-nums')
  })

  it('is idempotent — a second call never appends a second <style>', () => {
    ensureVegaTooltipStyles(document)
    ensureVegaTooltipStyles(document)
    expect(document.querySelectorAll('#sh-vega-tooltip-style')).toHaveLength(1)
  })
})

describe('observeVegaThemeFlips', () => {
  it('fires on root data-theme and data-skin flips, and dispose disconnects for good', async () => {
    let flips = 0
    const dispose = observeVegaThemeFlips(document, () => {
      flips += 1
    })
    document.documentElement.setAttribute('data-theme', 'dark')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(flips).toBe(1)
    document.documentElement.setAttribute('data-skin', 'observatory')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(flips).toBe(2)
    dispose()
    document.documentElement.setAttribute('data-theme', 'light')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(flips).toBe(2)
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-skin')
  })
})

describe('re-judge r3 — the exact-range escape and the closed color doors', () => {
  const light = CATEGORICAL_PALETTE.map((slot) => slot.light)

  it('strips palette-VALUED authored colors on non-range surfaces — a validated hue is not an exemption', () => {
    const { sanitized, violations } = sanitizeAuthoredVegaSpecColors({
      background: light[0],
      mark: { type: 'bar', color: light[1] },
      encoding: { color: { field: 'k', type: 'nominal', value: light[2] } },
    })
    expect(sanitized.background).toBeUndefined()
    expect((sanitized.mark as Record<string, unknown>).color).toBeUndefined()
    const colorDef = (sanitized.encoding as Record<string, Record<string, unknown>>).color
    expect(colorDef.value).toBeUndefined()
    expect(violations).toContain('background')
  })

  it('closes the nested doors: view fills, conditional values, composite-mark parts, config.color, style sub-marks', () => {
    const spec = sanitizeAuthoredVegaSpecColors({
      view: { fill: '#123456', stroke: '#654321' },
      encoding: {
        color: {
          field: 'k',
          type: 'nominal',
          condition: [{ test: 'datum.x > 1', value: '#ff0000' }],
        },
      },
    })
    expect((spec.sanitized.view as Record<string, unknown>).fill).toBeUndefined()
    const cond = (spec.sanitized.encoding as Record<string, Record<string, unknown>>).color
      .condition as Array<Record<string, unknown>>
    expect(cond[0].value).toBeUndefined()
    expect(cond[0].test).toBe('datum.x > 1')

    const config = sanitizeAuthoredVegaConfig({
      color: '#ff0000',
      boxplot: { box: { fill: '#00ff00' }, median: { stroke: '#0000ff' } },
      style: { hero: { point: { fill: '#abcdef' } } },
    })
    expect(config.sanitized.color).toBeUndefined()
    const boxplot = config.sanitized.boxplot as Record<string, Record<string, unknown>>
    expect(boxplot.box.fill).toBeUndefined()
    expect(boxplot.median.stroke).toBeUndefined()
    const hero = (config.sanitized.style as Record<string, Record<string, Record<string, unknown>>>).hero
    expect(hero.point.fill).toBeUndefined()
    expect(config.violations).toEqual(
      expect.arrayContaining(['config.color', 'config.boxplot.box.fill', 'config.style.hero.point.fill']),
    )
  })
})
