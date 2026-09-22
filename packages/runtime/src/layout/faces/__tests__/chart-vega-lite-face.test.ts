/**
 * chart-vega-lite-face.test.ts — the resource-adapter shape proof (mirrors
 * sparql-bindings-table-face.test.ts's own scope) plus pure `chartFieldType`/
 * `buildChartVegaLiteSpec` unit coverage — the spec-as-data generation this
 * face exists to prove (Wave 2 / Lane B spec §4: "the closed mini-schema IS
 * the spec surface — no open JSON param"). A real query against a real
 * gardend cell is exercised in chart-vega-lite-face.integration.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { createAsyncStore } from '@shrubbery/nucleus'
import type {
  QueryBlockResult,
  QueryBlockResultProfile,
  QueryBlockRow,
  QueryBlockService,
} from '../../../editor-services/query-block-service.js'
import { transformBindingsToVegaValues } from '../../../editor-services/query-block-vega.js'
import { CATEGORICAL_PALETTE, assignCategoricalScale } from '../../../editor-services/vega-theme.js'
import {
  buildChartVegaLiteSpec,
  chartFieldType,
  distinctSeriesValues,
  CHART_VEGA_LITE_FACE_ID,
  createChartVegaLiteFace,
  createChartVegaLiteResourceAdapter,
  type ChartVegaLiteParams,
} from '../chart-vega-lite-face.js'
import { createRawTextQueryResolver } from '../../named-query-registry.js'

const unusedService: QueryBlockService = {
  async run() {
    throw new Error('chart-vega-lite-face.test.ts: run() should never be invoked by this suite')
  },
}

describe('chart.vega-lite — resource adapter shape', () => {
  it('has the expected face id and adapter id', () => {
    expect(CHART_VEGA_LITE_FACE_ID).toBe('chart.vega-lite')
    const adapter = createChartVegaLiteResourceAdapter(unusedService, createRawTextQueryResolver())
    expect(adapter.adapterId).toBe('chart.vega-lite.query-handle')
    expect(adapter.shape).toBe('derived')
  })

  it('accepts only query locators', () => {
    const adapter = createChartVegaLiteResourceAdapter(unusedService, createRawTextQueryResolver())
    expect(adapter.accepts({ kind: 'query', graphId: 'g', queryId: 'SELECT ?x ?y WHERE { ?s ?x ?y }' })).toBe(true)
    expect(adapter.accepts({ kind: 'iri', iri: 'urn:x' })).toBe(false)
  })

  it('carries a DIFFERENT adapterId than stat.scalar\'s adapter (no cross-face collision)', () => {
    const chartAdapter = createChartVegaLiteResourceAdapter(unusedService, createRawTextQueryResolver())
    expect(chartAdapter.adapterId).not.toBe('stat.scalar.query-handle')
  })
})

const profile: QueryBlockResultProfile = {
  rowCount: 3,
  columns: [
    { name: 'windowStart', valueKind: 'date', nonNullCount: 3, distinctCount: 3 },
    { name: 'value', valueKind: 'number', nonNullCount: 3, distinctCount: 3 },
    { name: 'kind', valueKind: 'literal', nonNullCount: 3, distinctCount: 2 },
  ],
}

describe('chart.vega-lite — chartFieldType (pure)', () => {
  it('maps number columns to quantitative', () => {
    expect(chartFieldType(profile, 'value')).toBe('quantitative')
  })
  it('maps date columns to temporal', () => {
    expect(chartFieldType(profile, 'windowStart')).toBe('temporal')
  })
  it('maps everything else to nominal', () => {
    expect(chartFieldType(profile, 'kind')).toBe('nominal')
  })
  it('falls back to nominal for a field absent from the profile — never throws', () => {
    expect(chartFieldType(profile, 'unknownField')).toBe('nominal')
  })
})

describe('chart.vega-lite — buildChartVegaLiteSpec (pure, spec-as-data)', () => {
  const baseParams: ChartVegaLiteParams = { mark: 'bar', xField: 'windowStart', yField: 'value' }

  it('generates mark + x/y encoding from the closed params and the real result profile', () => {
    const spec = buildChartVegaLiteSpec(baseParams, profile)
    expect(spec.mark).toEqual({ type: 'bar', tooltip: true })
    expect(spec.encoding).toEqual({
      x: { field: 'windowStart', type: 'temporal' },
      y: { field: 'value', type: 'quantitative' },
    })
  })

  it('adds a color encoding only when seriesField is present', () => {
    const withSeries = buildChartVegaLiteSpec({ ...baseParams, seriesField: 'kind' }, profile)
    expect((withSeries.encoding as Record<string, unknown>).color).toEqual({ field: 'kind', type: 'nominal' })

    const withoutSeries = buildChartVegaLiteSpec(baseParams, profile)
    expect((withoutSeries.encoding as Record<string, unknown>).color).toBeUndefined()
  })

  it('a NUMERIC series field is still nominal on the color channel — identity, never a continuous magnitude ramp', () => {
    // 'value' profiles as number → chartFieldType says quantitative for x/y…
    expect(chartFieldType(profile, 'value')).toBe('quantitative')
    // …but as the color channel it is series IDENTITY, so it must be nominal
    // (a quantitative color would clash with the pinned categorical scale).
    const spec = buildChartVegaLiteSpec({ ...baseParams, seriesField: 'value' }, profile)
    expect((spec.encoding as Record<string, unknown>).color).toEqual({ field: 'value', type: 'nominal' })
  })

  it('adds a title only when supplied', () => {
    expect(buildChartVegaLiteSpec(baseParams, profile).title).toBeUndefined()
    expect(buildChartVegaLiteSpec({ ...baseParams, title: '72h activity' }, profile).title).toBe('72h activity')
  })

  it('never writes a `data` key — the real bindings are injected downstream by mountQueryBlockVega, not fabricated here', () => {
    const spec = buildChartVegaLiteSpec(baseParams, profile)
    expect('data' in spec).toBe(false)
  })

  it('every declared mark kind produces a valid mark.type', () => {
    for (const mark of ['line', 'bar', 'area', 'point'] as const) {
      const spec = buildChartVegaLiteSpec({ ...baseParams, mark }, profile)
      expect((spec.mark as Record<string, unknown>).type).toBe(mark)
    }
  })

  it('pins color.scale to an explicit domain/range when a categorical assignment is supplied — never left to Vega-Lite\'s own default (cycling) ordinal scale', () => {
    const categorical = assignCategoricalScale(['east', 'west'], 'light')
    const spec = buildChartVegaLiteSpec({ ...baseParams, seriesField: 'kind' }, profile, categorical)
    const color = (spec.encoding as Record<string, unknown>).color as Record<string, unknown>
    // Provenance (re-judge r4): the pinning no longer rides the spec — the
    // face forwards it as the trusted pinnedColorScale mount option, so an
    // authored-spec sanitizer can strip EVERY authored range without
    // touching house assignments (which may be legitimately sparse).
    expect(color.scale).toBeUndefined()
    expect('transform' in spec).toBe(false) // no fold needed — only 2 of 5 slots used
  })

  it('a folded categorical assignment adds a calculate transform that relabels the tail to "Other"', () => {
    const categorical = assignCategoricalScale(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'light')
    expect(categorical.folded).toBe(true)
    const spec = buildChartVegaLiteSpec({ ...baseParams, seriesField: 'kind' }, profile, categorical)
    const transform = spec.transform as ReadonlyArray<Record<string, unknown>>
    expect(transform).toHaveLength(1)
    expect(transform[0].as).toBe('kind')
    expect(transform[0].calculate).toContain('datum["kind"]')
    expect(transform[0].calculate).toContain("'Other'")
    // The transform expression embeds only the KEPT domain (not the literal
    // 'Other' entry) as the indexof haystack.
    expect(transform[0].calculate).not.toContain('"Other"')
  })

  it('with no categorical assignment (no seriesField, or seriesField without a computed scale), the color encoding carries no scale override', () => {
    const spec = buildChartVegaLiteSpec(baseParams, profile, null)
    expect((spec.encoding as Record<string, unknown>).color).toBeUndefined()

    const withSeriesNoScale = buildChartVegaLiteSpec({ ...baseParams, seriesField: 'kind' }, profile, null)
    const color = (withSeriesNoScale.encoding as Record<string, unknown>).color as Record<string, unknown>
    expect(color.scale).toBeUndefined()
  })
})

describe('chart.vega-lite — distinctSeriesValues (pure)', () => {
  function row(kind: string): QueryBlockRow {
    return { kind: { type: 'literal', value: kind } }
  }

  it('collects deduped, real (non-empty) distinct values off the named field, in first-appearance order', () => {
    const rows: QueryBlockRow[] = [row('b'), row('a'), row('b'), { kind: { type: 'literal', value: '' } }, {}]
    expect(distinctSeriesValues(rows, 'kind')).toEqual(['b', 'a'])
  })

  it('never fabricates a value for a missing binding', () => {
    expect(distinctSeriesValues([{}], 'kind')).toEqual([])
  })

  it('canonicalizes numeric series terms to the SAME primitive the Vega datum rows carry — so they land in the pinned domain instead of folding to "Other"', () => {
    const rows: QueryBlockRow[] = [
      { year: { type: 'literal', value: '2026', datatype: 'http://www.w3.org/2001/XMLSchema#integer' } },
      { year: { type: 'literal', value: '2027', datatype: 'http://www.w3.org/2001/XMLSchema#integer' } },
      { year: { type: 'literal', value: '2026', datatype: 'http://www.w3.org/2001/XMLSchema#integer' } },
    ]
    const values = distinctSeriesValues(rows, 'year')
    expect(values).toEqual([2026, 2027]) // numbers, never the lexical strings '2026'/'2027'
    // …and the values are EXACTLY what transformBindingsToVegaValues puts in
    // the datum rows, so scale.domain / the fold haystack always match.
    const result: QueryBlockResult = {
      queryKind: 'select',
      resultKind: 'bindings',
      columns: ['year'],
      rows,
      durationMs: 0,
      raw: {},
    }
    const datumValues = transformBindingsToVegaValues(result).map((datum) => datum.year)
    expect(new Set(datumValues)).toEqual(new Set(values))
  })

  it('non-finite numeric series values (xsd INF/NaN) keep lexical identity through domain AND datum — never folding to "Other"', () => {
    const double = 'http://www.w3.org/2001/XMLSchema#double'
    const rows: QueryBlockRow[] = [
      { rate: { type: 'literal', value: 'INF', datatype: double } },
      { rate: { type: 'literal', value: 'NaN', datatype: double } },
      { rate: { type: 'literal', value: '42.5', datatype: double } },
    ]
    const values = distinctSeriesValues(rows, 'rate')
    expect(values).toEqual(['INF', 'NaN', 42.5])
    const result: QueryBlockResult = {
      queryKind: 'select',
      resultKind: 'bindings',
      columns: ['rate'],
      rows,
      durationMs: 0,
      raw: {},
    }
    const datumValues = transformBindingsToVegaValues(result).map((datum) => datum.rate)
    // Set-equality is the whole point: domain entries and datum values are the
    // SAME primitives (NaN-the-number appears in neither — 'NaN' the string does).
    expect(new Set(datumValues)).toEqual(new Set(values))
  })

  it('a numeric series survives the ENTIRE identity pipeline: domain includes the numbers, fold haystack embeds the numbers', () => {
    const rows: QueryBlockRow[] = [2020, 2021, 2022, 2023, 2024, 2025].map((year) => ({
      year: { type: 'literal', value: String(year), datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
    }))
    const categorical = assignCategoricalScale(distinctSeriesValues(rows, 'year'), 'light')
    expect(categorical.folded).toBe(true) // 6 distinct > 5 slots
    expect(categorical.domain).toEqual([2020, 2021, 2022, 2023, 2024, 'Other'])
    const numericProfile: QueryBlockResultProfile = {
      rowCount: rows.length,
      columns: [{ name: 'year', valueKind: 'number', nonNullCount: rows.length, distinctCount: 6 }],
    }
    const spec = buildChartVegaLiteSpec(
      { mark: 'bar', xField: 'year', yField: 'year', seriesField: 'year' },
      numericProfile,
      categorical,
    )
    const transform = spec.transform as ReadonlyArray<Record<string, unknown>>
    // The indexof haystack embeds the NUMBERS (JSON [2020,…]), matching the
    // numeric datum — a string haystack would fold every row to 'Other'.
    expect(transform[0].calculate).toContain('[2020,2021,2022,2023,2024]')
    const color = (spec.encoding as Record<string, unknown>).color as Record<string, unknown>
    // Provenance model: the spec carries no scale — the assignment itself
    // holds the numeric domain, and rides the trusted mount option.
    expect(color.scale).toBeUndefined()
    expect(categorical.domain.slice(0, -1)).toEqual([2020, 2021, 2022, 2023, 2024])
  })
})
describe('chart.vega-lite — mounted face re-themes on a root data-theme flip (real mount, embed seam only)', () => {
  function seriesResult(): QueryBlockResult {
    const rows: QueryBlockRow[] = [
      {
        x: { type: 'literal', value: '1', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
        y: { type: 'literal', value: '10', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
        kind: { type: 'literal', value: 'alpha' },
      },
      {
        x: { type: 'literal', value: '2', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
        y: { type: 'literal', value: '20', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
        kind: { type: 'literal', value: 'beta' },
      },
    ]
    return {
      queryKind: 'select',
      resultKind: 'bindings',
      columns: ['x', 'y', 'kind'],
      rows,
      durationMs: 1,
      raw: {},
    }
  }

  it('regenerates the mode-baked categorical RANGE (same slots, dark hexes) and stops reacting after dispose()', async () => {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-skin')
    const specs: Array<Record<string, unknown>> = []
    let notify: (() => void) | null = null
    const whenEmbedded = (count: number): Promise<void> =>
      specs.length >= count
        ? Promise.resolve()
        : new Promise((resolve) => {
            notify = () => {
              if (specs.length >= count) {
                notify = null
                resolve()
              }
            }
          })
    const registration = createChartVegaLiteFace({
      loadVegaEmbed: async () => async (_target: HTMLElement, spec: Record<string, unknown>) => {
        specs.push(spec)
        notify?.()
        return { view: { finalize() {} } }
      },
    })
    const target = document.createElement('div')
    document.body.appendChild(target)
    const descriptor = {
      schemaVersion: 1,
      faceId: CHART_VEGA_LITE_FACE_ID,
      resource: { kind: 'query', graphId: 'g', queryId: 'SELECT ?x ?y ?kind WHERE { }' },
      params: { mark: 'bar', xField: 'x', yField: 'y', seriesField: 'kind' },
    } as const
    const lease = {
      key: 'k',
      shape: 'derived' as const,
      value: createAsyncStore(async () => seriesResult()),
      released: false,
      release() {},
    }
    const view = await registration.mount({
      target,
      descriptor: descriptor as never,
      lease,
      constraints: { minWidth: 240, minHeight: 180, overflow: 'clip' },
    })
    try {
      await whenEmbedded(1)
      const lightColor = ((specs[0].encoding as Record<string, unknown>).color as Record<string, unknown>)
      expect((lightColor.scale as Record<string, unknown>).range).toEqual([
        CATEGORICAL_PALETTE[0].light,
        CATEGORICAL_PALETTE[1].light,
      ])

      const countBeforeFlip = specs.length
      document.documentElement.setAttribute('data-theme', 'dark')
      await whenEmbedded(countBeforeFlip + 1)
      // Let the coalescing (face spec write + element observer) settle fully.
      await new Promise((resolve) => setTimeout(resolve, 20))
      const last = specs[specs.length - 1]
      const darkColor = (last.encoding as Record<string, unknown>).color as Record<string, unknown>
      // SAME slot per entity — only the mode-selected hex per slot changed.
      expect((darkColor.scale as Record<string, unknown>).range).toEqual([
        CATEGORICAL_PALETTE[0].dark,
        CATEGORICAL_PALETTE[1].dark,
      ])
      expect((darkColor.scale as Record<string, unknown>).domain).toEqual(['alpha', 'beta'])
      expect((last.config as Record<string, unknown>).background).toBe('#191c18')

      // After dispose, further flips must not re-run applyResult.
      await view.dispose('closed')
      const settled = specs.length
      document.documentElement.setAttribute('data-theme', 'light')
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(specs.length).toBe(settled)
    } finally {
      target.remove()
      document.documentElement.removeAttribute('data-theme')
    }
  })
})
