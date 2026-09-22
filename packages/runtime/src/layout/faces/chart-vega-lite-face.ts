/**
 * chart-vega-lite-face.ts — the `chart.vega-lite` face (Wave 2 / Lane B spec
 * `plans/surface-wave2-laneb-slice-20260716.md` §4).
 *
 * Wraps the SAME PRODUCTION `QueryBlockService` + `mountQueryBlockVega`
 * (real `vega-embed`) `sparql.bindings-table`/QueryBlock already use — no new
 * chart library, no query-execution logic of its own. The closed params
 * schema (`mark`/`xField`/`yField`/`seriesField?`/`title?`/`refreshSeconds?`)
 * IS the v1 spec surface: this face GENERATES the actual Vega-Lite
 * mark/encoding JSON from those params plus the real query result's own
 * column-value-kind profile (`profileQueryBlockResult`, already shipped by
 * query-block-service.ts) — there is no open JSON param an agent could smuggle
 * an arbitrary spec through (spec-as-data, closed by construction).
 *
 * Resource shape mirrors `stat.scalar`: the resource adapter
 * (`query-handle-resource-adapter.ts`) hands back a retained reactive store.
 * `mount()` observes any warm snapshot, requests a refresh through the
 * Surface activation queue, then owns its own poll cadence.
 */
import type { ViewDescriptor } from '@shrubbery/nucleus/layout'
import type { StoreState } from '@shrubbery/nucleus'
import {
  profileQueryBlockResult,
  type QueryBlockResult,
  type QueryBlockResultProfile,
  type QueryBlockRow,
  type QueryBlockService,
} from '../../editor-services/query-block-service.js'
// Side-effect import: registers the <sh-vega-chart-view> custom element.
import './vega-chart-view-element.js'
import type { ShVegaChartView } from './vega-chart-view-element.js'
import { vegaTermPrimitive, type QueryBlockVegaEmbedLoader } from '../../editor-services/query-block-vega.js'
import {
  assignCategoricalScale,
  createCategoricalSlotAssignment,
  observeVegaThemeFlips,
  resolveVegaThemeMode,
  type VegaCategoricalScale,
  type VegaSeriesValue,
} from '../../editor-services/vega-theme.js'
import {
  closedParamsSchema,
  type DerivedResourceAdapter,
  type FaceRegistration,
  type FaceView,
  type LeafConstraints,
} from '../types.js'
import { createQueryHandleResourceAdapter, isQueryLocator, type QueryHandle } from './query-handle-resource-adapter.js'
import type { QueryTextResolver } from '../named-query-registry.js'
import { observeSurfaceResourceStore } from '../resource-store.js'

export const CHART_VEGA_LITE_FACE_ID = 'chart.vega-lite'
const CHART_VEGA_LITE_ADAPTER_ID = 'chart.vega-lite.query-handle'

export type ChartVegaLiteMark = 'line' | 'bar' | 'area' | 'point'

export interface ChartVegaLiteParams {
  readonly mark: ChartVegaLiteMark
  readonly xField: string
  readonly yField: string
  readonly seriesField?: string
  readonly title?: string
  readonly refreshSeconds?: number
}

/** Thin wrapper over the shared query-handle adapter, under this face's own adapter id. */
export function createChartVegaLiteResourceAdapter(service: QueryBlockService, resolver: QueryTextResolver): DerivedResourceAdapter<QueryHandle> {
  return createQueryHandleResourceAdapter(CHART_VEGA_LITE_ADAPTER_ID, service, resolver)
}

/** Pure — exported for unit testing. Mirrors `query-block-service.ts`'s own (unexported) `vegaType` mapping. */
export function chartFieldType(profile: QueryBlockResultProfile, field: string): 'quantitative' | 'temporal' | 'nominal' {
  const column = profile.columns.find((candidate) => candidate.name === field)
  if (!column) return 'nominal'
  if (column.valueKind === 'number') return 'quantitative'
  if (column.valueKind === 'date') return 'temporal'
  return 'nominal'
}

/**
 * Distinct real `seriesField` values from the real result rows, in FIRST-
 * APPEARANCE (row) order — the arrival order `assignCategoricalScale`'s
 * slot assignment is keyed on. Each term goes through `vegaTermPrimitive` —
 * the SAME canonicalization `transformBindingsToVegaValues` applies to the
 * chart's own data rows — so a numeric/temporal/boolean series value here is
 * the EXACT primitive Vega's `datum[...]` will hold (collecting the lexical
 * `term.value` string instead would make every numeric series miss the
 * pinned domain and fold to "Other"). Never fabricates a value for a
 * missing/empty binding.
 */
export function distinctSeriesValues(rows: readonly QueryBlockRow[], seriesField: string): readonly VegaSeriesValue[] {
  const seen = new Set<VegaSeriesValue>()
  for (const row of rows) {
    const term = row[seriesField]
    if (term?.value) seen.add(vegaTermPrimitive(term))
  }
  return Array.from(seen)
}

/**
 * Pure — exported for unit testing. GENERATES the Vega-Lite mark/encoding
 * spec from the closed params + the real result's column profile. No `data`
 * key is ever written here — `mountQueryBlockVega` injects the real bindings
 * (`transformBindingsToVegaValues`) itself when a spec's `data.values` is
 * absent, exactly as the production QueryBlock renderer relies on.
 *
 * `categorical`, when `params.seriesField` is set, is the REAL fixed-order
 * color assignment for this result's actual distinct series values
 * (`distinctSeriesValues` + `assignCategoricalScale` — see `applyResult` in
 * `createChartVegaLiteFace`'s `mount()`). Pinning `encoding.color.scale` to
 * an explicit `domain`/`range` (rather than leaving it to Vega-Lite's own
 * default ordinal scale) is what keeps "color follows the entity, never
 * cycled" true once a series has more distinct values than validated palette
 * slots — Vega-Lite's default scale WOULD silently wrap the palette back to
 * slot 1 for the 6th value otherwise. When `categorical.folded` is true, a
 * `calculate` transform relabels every row whose `seriesField` value falls
 * outside the kept slots to the literal string `"Other"` — vega expression
 * `indexof` against the JSON-inlined kept-domain array, so the SAME rewrite
 * applies whichever encoding channel reads `seriesField`.
 */
export function buildChartVegaLiteSpec(
  params: ChartVegaLiteParams,
  profile: QueryBlockResultProfile,
  categorical: VegaCategoricalScale | null = null,
): Record<string, unknown> {
  const encoding: Record<string, unknown> = {
    x: { field: params.xField, type: chartFieldType(profile, params.xField) },
    y: { field: params.yField, type: chartFieldType(profile, params.yField) },
  }
  const spec: Record<string, unknown> = { mark: { type: params.mark, tooltip: true }, encoding }
  if (params.seriesField) {
    const colorEncoding: Record<string, unknown> = {
      field: params.seriesField,
      // Series identity is ALWAYS nominal on the color channel, whatever the
      // column's own value kind: a numeric/temporal series field encoded as
      // quantitative/temporal color would get a continuous ramp — a
      // magnitude reading — where the chart laws demand fixed per-entity
      // hues, and would clash with the categorical string domain pinned
      // below. (x/y keep the profiled type; only color identity is coerced.)
      type: 'nominal',
    }
    if (categorical) {
      // The pinned domain/range do NOT ride the spec: they travel as the
      // trusted pinnedColorScale mount option (provenance — see
      // mountQueryBlockVega), applied after the authored-spec sanitizer.
      if (categorical.folded) {
        const keptDomain = categorical.domain.slice(0, -1)
        const field = JSON.stringify(params.seriesField)
        spec.transform = [
          {
            calculate: `indexof(${JSON.stringify(keptDomain)}, datum[${field}]) >= 0 ? datum[${field}] : 'Other'`,
            as: params.seriesField,
          },
        ]
      }
    }
    encoding.color = colorEncoding
  }
  if (params.title) spec.title = params.title
  return spec
}

/** Which of `params`' field references are NOT among the real result's own columns — an honest error surface, never a silently-empty chart. */
function missingFields(params: ChartVegaLiteParams, profile: QueryBlockResultProfile): readonly string[] {
  const known = new Set(profile.columns.map((column) => column.name))
  const requested = [params.xField, params.yField, ...(params.seriesField ? [params.seriesField] : [])]
  return requested.filter((field) => !known.has(field))
}

function chartVegaLiteConstraints(): LeafConstraints {
  return { minWidth: 240, minHeight: 180, overflow: 'clip' }
}

function chartVegaLiteParams(descriptor: ViewDescriptor): ChartVegaLiteParams {
  // paramsSchema already validated shape/types (mark/xField/yField required)
  // before mount() is ever called — mirrors sparql-bindings-table-face.ts's
  // own `displayMaxRows` cast idiom.
  return (descriptor.params ?? {}) as unknown as ChartVegaLiteParams
}

/**
 * The `chart.vega-lite` `FaceRegistration`. `mount()` installs the shell and
 * observes the retained store before awaiting its first queued refresh.
 * When `refreshSeconds` is positive it owns a real `setInterval` poll that
 * refreshes the SAME store, regenerates the spec against the fresh result,
 * and hands both to the view. Absent or `<= 0` means load-once.
 */
export interface ChartVegaLiteFaceOptions {
  /** Test seam — threaded to `<sh-vega-chart-view>.loadVegaEmbed` (mirrors `QueryBlockRendererOptions.loadVegaEmbed`). Production leaves this unset. */
  readonly loadVegaEmbed?: QueryBlockVegaEmbedLoader
}

export function createChartVegaLiteFace(options: ChartVegaLiteFaceOptions = {}): FaceRegistration {
  return {
    faceId: CHART_VEGA_LITE_FACE_ID,
    // A generated chart over a cheap-to-recompute result — nothing local
    // worth protecting across a relocate (same classification as sparql.bindings-table).
    persistence: 'stamp',
    resourceAdapterId: CHART_VEGA_LITE_ADAPTER_ID,
    accepts: isQueryLocator,
    paramsSchema: closedParamsSchema({
      mark: { type: 'enum', values: ['line', 'bar', 'area', 'point'] },
      xField: { type: 'string' },
      yField: { type: 'string' },
      seriesField: { type: 'string', optional: true },
      title: { type: 'string', optional: true },
      refreshSeconds: { type: 'number', optional: true },
    }),
    constraints: chartVegaLiteConstraints,
    async mount(context) {
      const { target, descriptor, lease } = context
      const params = chartVegaLiteParams(descriptor)
      const store = lease.value as QueryHandle

      const view = document.createElement('sh-vega-chart-view') as ShVegaChartView
      view.tabIndex = 0
      view.status = 'loading'
      if (options.loadVegaEmbed) view.loadVegaEmbed = options.loadVegaEmbed
      target.replaceChildren(view)

      let disposed = false
      let timer: ReturnType<typeof setInterval> | null = null
      // Per-MOUNT slot memory: a series value that claimed a palette slot on
      // an earlier poll keeps that slot for the life of this mount, whatever
      // membership changes later polls bring (see assignCategoricalScale's
      // own stability contract).
      const slotAssignment = createCategoricalSlotAssignment()
      // The most recent applied result — what a theme/skin flip regenerates
      // the spec from (the pinned categorical RANGE is mode-baked into the
      // spec, so a mode change needs a real spec rebuild, not just the view
      // element's own config remount).
      let lastResult: QueryBlockResult | null = null

      const applyResult = (result: QueryBlockResult): void => {
        if (result.resultKind !== 'bindings') {
          // CONSTRUCT/DESCRIBE/ASK is not chartable — an honest error, not a
          // fabricated empty chart (mirrors sparql.bindings-table's own
          // resultKind guard).
          view.status = 'error'
          view.error = `chart.vega-lite requires a SELECT query result (got a ${result.resultKind} result)`
          return
        }
        if (result.rows.length === 0) {
          view.status = 'empty'
          return
        }
        const profile = profileQueryBlockResult(result)
        const missing = missingFields(params, profile)
        if (missing.length > 0) {
          view.status = 'error'
          view.error = `chart.vega-lite: field(s) not present in the query result columns (${result.columns.join(', ')}): ${missing.join(', ')}`
          return
        }
        // Fixed-order categorical color assignment over the REAL distinct
        // series values (never Vega-Lite's own default ordinal scale, which
        // would silently cycle the palette once distinct values exceed the
        // validated slot count) — only computed when a seriesField is
        // actually encoded.
        const categorical = params.seriesField
          ? assignCategoricalScale(
              distinctSeriesValues(result.rows, params.seriesField),
              resolveVegaThemeMode(target),
              slotAssignment,
            )
          : null
        lastResult = result
        view.result = result
        view.pinnedColorScale = categorical
          ? { domain: categorical.domain, range: categorical.range }
          : null
        view.vegaLiteSpec = JSON.stringify(buildChartVegaLiteSpec(params, profile, categorical))
        view.status = 'ready'
      }

      const applyState = (state: StoreState<QueryBlockResult>): void => {
        if (disposed) return
        view.dataset.resourceState = state.status
        if (state.read !== null) {
          applyResult(state.read)
          if (state.status === 'ready') delete view.dataset.resourceStale
          else view.dataset.resourceStale = 'true'
          return
        }
        delete view.dataset.resourceStale
        if (state.status === 'error') {
          view.status = 'error'
          view.error = state.error ?? 'Unable to load this resource.'
        } else {
          view.status = 'loading'
        }
      }
      const unsubscribe = observeSurfaceResourceStore(store, applyState)

      const runOnce = async (): Promise<void> => {
        if (disposed) return
        await store.refresh()
      }

      await runOnce()

      // Re-theme on a root data-theme/data-skin flip: the spec's pinned
      // categorical range (and the mode passed to assignCategoricalScale)
      // are baked per mode, so the FACE regenerates the spec from the last
      // real result — slot assignment persists, only the mode-selected hex
      // per slot changes. (<sh-vega-chart-view> independently re-bakes its
      // CONFIG on the same signal — the shared `observeVegaThemeFlips`
      // machinery — and the two coalesce via its _renderId.)
      const disposeThemeFlip = observeVegaThemeFlips(target.ownerDocument, () => {
        if (!disposed && lastResult) applyResult(lastResult)
      })

      const refreshSeconds = params.refreshSeconds
      if (typeof refreshSeconds === 'number' && refreshSeconds > 0) {
        timer = setInterval(() => void runOnce(), Math.max(1, refreshSeconds) * 1000)
      }

      const faceView: FaceView = {
        focus(_request) {
          view.focus()
          return true
        },
        blur() {
          view.blur()
        },
        resize() {
          // <sh-vega-chart-view>'s :host fills 100%/100% via CSS; the
          // interpreter already sized `target`. MUST NOT write layout state
          // (design §3.2) — no-op (mirrors the production QueryBlock host's
          // own vega embed, which likewise does not re-embed on resize).
        },
        serialize(): ViewDescriptor {
          return descriptor
        },
        dispose() {
          if (disposed) return
          disposed = true
          if (timer !== null) clearInterval(timer)
          unsubscribe()
          disposeThemeFlip()
          view.remove()
        },
      }
      return faceView
    },
  }
}
