import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  mountQueryBlockVega,
  parseVegaLiteSpec,
  transformBindingsToVegaValues,
  setVegaThemeScopeOverrides,
  resolveVegaThemeOverride,
  vegaTermPrimitive,
  buildVegaTheme,
  CATEGORICAL_PALETTE,
  type QueryBlockVegaEmbed,
  type QueryBlockResult,
} from '../../index.js'
import { fragmentNodeId } from '../../layout/fragment-splice.js'

const bindings: QueryBlockResult = {
  queryKind: 'select',
  resultKind: 'bindings',
  columns: ['label', 'score', 'active', 'when', 'missing'],
  rows: [
    {
      label: { type: 'uri', value: 'urn:ada' },
      score: {
        type: 'literal',
        value: '42.5',
        datatype: 'http://www.w3.org/2001/XMLSchema#decimal',
      },
      active: { type: 'literal', value: 'true' },
      when: {
        type: 'literal',
        value: '2026-07-10',
        datatype: 'http://www.w3.org/2001/XMLSchema#date',
      },
    },
  ],
  durationMs: 3,
  raw: {},
}

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.removeAttribute('data-theme')
})

function makeContainer(): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ width: 500, height: 200, x: 0, y: 0, top: 0, right: 500, bottom: 200, left: 0 }),
  })
  return container
}

describe('QueryBlock Vega-Lite data contract', () => {
  it('coerces RDF bindings into Vega primitive values without losing dates or IRIs', () => {
    expect(transformBindingsToVegaValues(bindings)).toEqual([
      {
        label: 'urn:ada',
        score: 42.5,
        active: true,
        when: '2026-07-10',
        missing: null,
      },
    ])
  })

  it('distinguishes an empty spec from malformed and non-object JSON', () => {
    expect(parseVegaLiteSpec('  ')).toBeNull()
    expect(() => parseVegaLiteSpec('{ bad json')).toThrow(/Invalid Vega-Lite spec/)
    expect(() => parseVegaLiteSpec('[]')).toThrow(/root value must be a JSON object/)
  })

  it('injects query rows, applies the house theme, mounts lazily, and finalizes once', async () => {
    const container = makeContainer()
    const finalize = vi.fn()
    const receivedSpecs: Array<Record<string, unknown>> = []
    const embed: QueryBlockVegaEmbed = vi.fn(async (target, spec, options) => {
      receivedSpecs.push(spec)
      expect(target).toBe(container)
      // `disableDefaultStyle` hands tooltip styling entirely to
      // `ensureVegaTooltipStyles`'s own injected sheet — see the assertion
      // on `document.getElementById` below.
      expect(options).toEqual({ actions: false, renderer: 'svg', tooltip: { disableDefaultStyle: true } })
      return { view: { finalize } }
    })
    const loadEmbed = vi.fn(async () => embed)

    expect(loadEmbed).not.toHaveBeenCalled()
    const cleanup = await mountQueryBlockVega({
      container,
      result: bindings,
      vegaLiteSpec: JSON.stringify({
        mark: 'bar',
        encoding: { x: { field: 'score', type: 'quantitative' } },
        config: { background: '#abc' },
      }),
      loadEmbed,
    })

    expect(loadEmbed).toHaveBeenCalledTimes(1)
    const receivedSpec = receivedSpecs[0]
    expect(receivedSpec).toMatchObject({
      $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
      width: 460,
      padding: 12,
      autosize: { type: 'fit', contains: 'padding' },
      data: { values: transformBindingsToVegaValues(bindings) },
    })
    const config = receivedSpec.config as Record<string, unknown>
    // FLIPPED (re-judge round 2): the authored `config.background` is a chart
    // color LAW surface — it is STRIPPED (house surface wins) and the strip is
    // surfaced as a visible note, never silently honored or silently dropped.
    expect(config.background).toBe(buildVegaTheme('light').background)
    const lawNote = container.querySelector('[data-vega-law-warning]')
    expect(lawNote).not.toBeNull()
    expect(lawNote?.textContent).toContain('background')
    expect(config.axis).toBeDefined()
    // The validated categorical palette, fixed order, light mode (no
    // [data-theme=dark] on the document in this test) — never the old
    // hardcoded ink-and-parchment 10-hex array.
    expect((config.range as Record<string, unknown>).category).toEqual(
      CATEGORICAL_PALETTE.map((slot) => slot.light),
    )
    // The tooltip stylesheet is real CSS (not spec JSON) injected once,
    // idempotently, into the document — see ensureVegaTooltipStyles.
    const tooltipStyle = document.getElementById('sh-vega-tooltip-style')
    expect(tooltipStyle).not.toBeNull()
    expect(tooltipStyle?.textContent).toMatch(/var\(--mn-color-surface-elevated/)
    cleanup()
    cleanup()
    expect(finalize).toHaveBeenCalledTimes(1)
  })

  it('selects the dark theme from document data-theme — a deliberate selection, not an automatic flip', async () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    const container = makeContainer()
    const receivedSpecs: Array<Record<string, unknown>> = []
    const embed: QueryBlockVegaEmbed = vi.fn(async (_target, spec) => {
      receivedSpecs.push(spec)
      return { view: { finalize() {} } }
    })

    await mountQueryBlockVega({
      container,
      result: bindings,
      vegaLiteSpec: JSON.stringify({ mark: 'bar', encoding: {} }),
      loadEmbed: async () => embed,
    })

    const config = receivedSpecs[0].config as Record<string, unknown>
    expect(config.background).toBe(buildVegaTheme('dark').background) // the validated dark surface
    expect((config.range as Record<string, unknown>).category).toEqual(
      CATEGORICAL_PALETTE.map((slot) => slot.dark),
    )
    expect(config).toEqual(buildVegaTheme('dark'))
  })

  it('theme-as-data: an EXPLICIT caller-resolved override merges over the house default, and a per-chart authored config merges over that', async () => {
    const container = makeContainer()
    const receivedSpecs: Array<Record<string, unknown>> = []
    const embed: QueryBlockVegaEmbed = vi.fn(async (_target, spec) => {
      receivedSpecs.push(spec)
      return { view: { finalize() {} } }
    })

    await mountQueryBlockVega({
      container,
      result: bindings,
      vegaLiteSpec: JSON.stringify({
        mark: 'bar',
        encoding: {},
        config: { axis: { labelColor: '#00ff00' } },
      }),
      // Explicit — this module holds no ambient theme state; the caller that
      // knows the chart's surface resolves and passes the override.
      themeOverride: { axis: { gridColor: '#ff00ff' } },
      loadEmbed: async () => embed,
    })

    const config = receivedSpecs[0].config as Record<string, unknown>
    const axis = config.axis as Record<string, unknown>
    // The graph override's gridColor survives...
    expect(axis.gridColor).toBe('#ff00ff')
    // ...the per-chart authored config's labelColor wins over both the
    // house default AND the graph override (closest layer wins)...
    expect(axis.labelColor).toBe('#00ff00')
    // ...and every OTHER axis default neither layer touched is still present
    // — a one-level-deep merge, not a full top-level replace.
    const houseAxis = buildVegaTheme('light').axis as Record<string, unknown>
    expect(axis.titleColor).toBe(houseAxis.titleColor)
  })

  it('without a themeOverride the pure house theme applies — no ambient state can leak one in', async () => {
    const container = makeContainer()
    const receivedSpecs: Array<Record<string, unknown>> = []
    const embed: QueryBlockVegaEmbed = vi.fn(async (_target, spec) => {
      receivedSpecs.push(spec)
      return { view: { finalize() {} } }
    })
    // A scope registered SOMEWHERE in the document (as a leaking global once
    // would have been) must not affect a mount that passes no override.
    const unrelatedScope = document.createElement('div')
    document.body.appendChild(unrelatedScope)
    setVegaThemeScopeOverrides(unrelatedScope, new Map([['region-x', { axis: { gridColor: '#ff00ff' } }]]))
    try {
      await mountQueryBlockVega({
        container,
        result: bindings,
        vegaLiteSpec: JSON.stringify({ mark: 'bar', encoding: {} }),
        loadEmbed: async () => embed,
      })
      expect(receivedSpecs[0].config).toEqual(buildVegaTheme('light'))
    } finally {
      setVegaThemeScopeOverrides(unrelatedScope, null)
      unrelatedScope.remove()
    }
  })

  it('strips spec-level authored mark colors and color-channel ranges — lawful rendered chart + a surfaced note, never a rejection', async () => {
    const container = makeContainer()
    const receivedSpecs: Array<Record<string, unknown>> = []
    const embed: QueryBlockVegaEmbed = vi.fn(async (_target, spec) => {
      receivedSpecs.push(spec)
      return { view: { finalize() {} } }
    })

    await mountQueryBlockVega({
      container,
      result: bindings,
      vegaLiteSpec: JSON.stringify({
        mark: { type: 'bar', color: '#123456' },
        encoding: {
          x: { field: 'score', type: 'quantitative' },
          color: { field: 'label', type: 'nominal', scale: { range: ['#111111', '#222222'] } },
        },
      }),
      loadEmbed: async () => embed,
    })

    const spec = receivedSpecs[0]
    const mark = spec.mark as Record<string, unknown>
    expect(mark.type).toBe('bar')
    expect(mark.color).toBeUndefined()
    const encoding = spec.encoding as Record<string, Record<string, unknown>>
    expect((encoding.color.scale as Record<string, unknown> | undefined)?.range).toBeUndefined()
    const note = container.querySelector('[data-vega-law-warning]')
    expect(note).not.toBeNull()
    // The chart still rendered — strip, never reject.
    expect(embed).toHaveBeenCalledTimes(1)
  })

  it('AUTHORED scale.range always strips — even validated-palette values — while the trusted pinnedColorScale option lands post-sanitize', async () => {
    const container = makeContainer()
    const receivedSpecs: Array<Record<string, unknown>> = []
    const embed: QueryBlockVegaEmbed = vi.fn(async (_target, spec) => {
      receivedSpecs.push(spec)
      return { view: { finalize() {} } }
    })
    const palette = CATEGORICAL_PALETTE.map((slot) => slot.light)

    await mountQueryBlockVega({
      container,
      result: bindings,
      vegaLiteSpec: JSON.stringify({
        mark: 'bar',
        encoding: {
          color: {
            field: 'label',
            type: 'nominal',
            // An authored range of REAL palette hexes — provenance, not value,
            // decides: this is authored data, so it strips with a note.
            scale: { domain: ['urn:ada'], range: [palette[0]] },
          },
        },
      }),
      // The house face's persistent-slot pinning — legitimately SPARSE
      // (a returning slot-4 entity keeps slot 4) — rides the trusted option.
      pinnedColorScale: { domain: ['urn:ada'], range: [palette[4]] },
      loadEmbed: async () => embed,
    })

    const encoding = receivedSpecs[0].encoding as Record<string, Record<string, unknown>>
    expect((encoding.color.scale as Record<string, unknown>).range).toEqual([palette[4]])
    expect(container.querySelector('[data-vega-law-warning]')?.textContent).toContain('scale.range')
  })
  it('non-finite xsd numerics keep their LEXICAL identity — INF/NaN never become identity-poison NaN', () => {
    const double = 'http://www.w3.org/2001/XMLSchema#double'
    expect(vegaTermPrimitive({ type: 'literal', value: 'INF', datatype: double })).toBe('INF')
    expect(vegaTermPrimitive({ type: 'literal', value: '-INF', datatype: double })).toBe('-INF')
    expect(vegaTermPrimitive({ type: 'literal', value: 'NaN', datatype: double })).toBe('NaN')
    expect(vegaTermPrimitive({ type: 'literal', value: '42.5', datatype: double })).toBe(42.5)
  })

  it('per-region theme scoping stays isolated when a region id itself contains a colon', () => {
    const scopeRoot = document.createElement('div')
    document.body.appendChild(scopeRoot)
    const wrapPlain = document.createElement('div')
    wrapPlain.setAttribute('data-layout-node-id', fragmentNodeId('a', 'b:root'))
    const chartPlain = document.createElement('div')
    wrapPlain.appendChild(chartPlain)
    const wrapColon = document.createElement('div')
    wrapColon.setAttribute('data-layout-node-id', fragmentNodeId('a:b', 'root'))
    const chartColon = document.createElement('div')
    wrapColon.appendChild(chartColon)
    scopeRoot.append(wrapPlain, wrapColon)

    // The two composite ids can never collide — the encoding is injective.
    expect(fragmentNodeId('a', 'b:root')).not.toBe(fragmentNodeId('a:b', 'root'))

    const themeA = { axis: { gridColor: '#ff00ff' } }
    const themeAB = { axis: { gridColor: '#00ff00' } }
    setVegaThemeScopeOverrides(scopeRoot, new Map([['a', themeA], ['a:b', themeAB]]))
    try {
      expect(resolveVegaThemeOverride(chartPlain)).toEqual(themeA)
      expect(resolveVegaThemeOverride(chartColon)).toEqual(themeAB)
    } finally {
      setVegaThemeScopeOverrides(scopeRoot, null)
      scopeRoot.remove()
    }
  })

  it('preserves authored data.values, including an intentionally empty dataset', async () => {
    const container = document.createElement('div')
    const embed = vi.fn<QueryBlockVegaEmbed>(async (_target, spec) => {
      expect(spec.data).toEqual({ values: [] })
      return { view: { finalize() {} } }
    })

    await mountQueryBlockVega({
      container,
      result: bindings,
      vegaLiteSpec: JSON.stringify({ mark: 'point', data: { values: [] } }),
      loadEmbed: async () => embed,
    })
    expect(embed).toHaveBeenCalledTimes(1)
  })

  it('renders the empty-spec hint without loading the heavy Vega runtime', async () => {
    const container = document.createElement('div')
    const loadEmbed = vi.fn()
    await mountQueryBlockVega({
      container,
      result: bindings,
      vegaLiteSpec: '',
      loadEmbed,
    })
    expect(loadEmbed).not.toHaveBeenCalled()
    expect(container.querySelector('.query-block-host-vega-hint')?.textContent).toMatch(
      /Add a Vega-Lite spec/,
    )
  })
})
describe('scoped theme overrides (setVegaThemeScopeOverrides / resolveVegaThemeOverride)', () => {
  const THEME_A = { axis: { gridColor: '#ff00ff' } }
  const THEME_B = { legend: { orient: 'top' } }

  /** scope root > frag wrapper(regionId) > … > chart start element. */
  function scopedTree(regionId: string): { scope: HTMLDivElement; start: HTMLElement } {
    const scope = document.createElement('div')
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-layout-node-id', fragmentNodeId(regionId, 'chart-leaf'))
    const start = document.createElement('div')
    wrapper.appendChild(start)
    scope.appendChild(wrapper)
    document.body.appendChild(scope)
    return { scope, start }
  }

  it('PER-REGION isolation: two regions under one scope root each resolve their OWN theme, never each other\'s', () => {
    const scope = document.createElement('div')
    const wrapperA = document.createElement('div')
    wrapperA.setAttribute('data-layout-node-id', fragmentNodeId('region-a', 'chart'))
    const wrapperB = document.createElement('div')
    wrapperB.setAttribute('data-layout-node-id', fragmentNodeId('region-b', 'chart'))
    scope.append(wrapperA, wrapperB)
    document.body.appendChild(scope)
    setVegaThemeScopeOverrides(scope, new Map<string, Record<string, unknown>>([
      ['region-a', THEME_A],
      ['region-b', THEME_B],
    ]))
    try {
      expect(resolveVegaThemeOverride(wrapperA)).toEqual(THEME_A)
      expect(resolveVegaThemeOverride(wrapperB)).toEqual(THEME_B)
    } finally {
      setVegaThemeScopeOverrides(scope, null)
      scope.remove()
    }
  })

  it('PER-SURFACE isolation: the same region id under a DIFFERENT scope root resolves that root\'s theme (or none)', () => {
    const a = scopedTree('region-center')
    const b = scopedTree('region-center')
    setVegaThemeScopeOverrides(a.scope, new Map([['region-center', THEME_A]]))
    try {
      expect(resolveVegaThemeOverride(a.start)).toEqual(THEME_A)
      // Surface B registered nothing — a parallel surface never inherits A's theme.
      expect(resolveVegaThemeOverride(b.start)).toBeNull()
      setVegaThemeScopeOverrides(b.scope, new Map([['region-center', THEME_B]]))
      expect(resolveVegaThemeOverride(b.start)).toEqual(THEME_B)
      expect(resolveVegaThemeOverride(a.start)).toEqual(THEME_A) // untouched
    } finally {
      setVegaThemeScopeOverrides(a.scope, null)
      setVegaThemeScopeOverrides(b.scope, null)
      a.scope.remove()
      b.scope.remove()
    }
  })

  it('RESET: re-registering with null/empty clears the scope — the next resolution finds nothing', () => {
    const { scope, start } = scopedTree('region-center')
    setVegaThemeScopeOverrides(scope, new Map([['region-center', THEME_A]]))
    try {
      expect(resolveVegaThemeOverride(start)).toEqual(THEME_A)
      setVegaThemeScopeOverrides(scope, null)
      expect(resolveVegaThemeOverride(start)).toBeNull()
      setVegaThemeScopeOverrides(scope, new Map([['region-center', THEME_A]]))
      setVegaThemeScopeOverrides(scope, new Map())
      expect(resolveVegaThemeOverride(start)).toBeNull()
    } finally {
      setVegaThemeScopeOverrides(scope, null)
      scope.remove()
    }
  })

  it('crosses shadow boundaries: a chart inside a shadow root resolves the scope of its HOST\'s composed tree', () => {
    const { scope, start } = scopedTree('region-center')
    const host = document.createElement('div')
    start.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const inner = document.createElement('div')
    shadow.appendChild(inner)
    setVegaThemeScopeOverrides(scope, new Map([['region-center', THEME_A]]))
    try {
      expect(resolveVegaThemeOverride(inner)).toEqual(THEME_A)
    } finally {
      setVegaThemeScopeOverrides(scope, null)
      scope.remove()
    }
  })

  it('a chart OUTSIDE any fragment region resolves null even under a registered scope (spine node ids do not name regions)', () => {
    const scope = document.createElement('div')
    const spineWrapper = document.createElement('div')
    spineWrapper.setAttribute('data-layout-node-id', 'workspace-center-home')
    const start = document.createElement('div')
    spineWrapper.appendChild(start)
    scope.appendChild(spineWrapper)
    document.body.appendChild(scope)
    setVegaThemeScopeOverrides(scope, new Map([['region-center', THEME_A]]))
    try {
      expect(resolveVegaThemeOverride(start)).toBeNull()
    } finally {
      setVegaThemeScopeOverrides(scope, null)
      scope.remove()
    }
  })

  it('no scope registered anywhere: resolves null (detached elements included)', () => {
    expect(resolveVegaThemeOverride(document.createElement('div'))).toBeNull()
    expect(resolveVegaThemeOverride(null)).toBeNull()
    expect(resolveVegaThemeOverride(undefined)).toBeNull()
  })
})
