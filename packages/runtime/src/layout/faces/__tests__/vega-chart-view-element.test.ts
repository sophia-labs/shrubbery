/**
 * vega-chart-view-element.test.ts — `<sh-vega-chart-view>`'s own mount
 * lifecycle proofs: the SCOPED graph-theme resolution at mount time (the
 * element resolves its own region's `ux:vegaTheme` through the composed tree
 * and threads it EXPLICITLY into `mountQueryBlockVega` — no ambient module
 * state), and the light/dark re-theme reaction. Uses the element's own
 * `loadVegaEmbed` test seam (the same seam `QueryBlockRendererOptions`
 * documents) — the embed double records the exact spec the element mounted;
 * everything else (element, resolution walk, house theme merge) is the real
 * production code.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { QueryBlockResult } from '../../../editor-services/query-block-service.js'
import {
  setVegaThemeScopeOverrides,
  type QueryBlockVegaEmbed,
} from '../../../editor-services/query-block-vega.js'
import { buildVegaTheme } from '../../../editor-services/vega-theme.js'
import { fragmentNodeId } from '../../fragment-splice.js'
import '../vega-chart-view-element.js'
import type { ShVegaChartView } from '../vega-chart-view-element.js'

const RESULT: QueryBlockResult = {
  queryKind: 'select',
  resultKind: 'bindings',
  columns: ['n'],
  rows: [{ n: { type: 'literal', value: '1', datatype: 'http://www.w3.org/2001/XMLSchema#integer' } }],
  durationMs: 1,
  raw: {},
}

const SPEC = JSON.stringify({ mark: 'bar', encoding: { x: { field: 'n', type: 'quantitative' } } })

interface EmbedRecorder {
  readonly specs: Array<Record<string, unknown>>
  /** Resolves when at least `count` embeds have landed. */
  whenEmbedded(count: number): Promise<void>
}

function recordingEmbed(): { embed: QueryBlockVegaEmbed; recorder: EmbedRecorder } {
  const specs: Array<Record<string, unknown>> = []
  let notify: (() => void) | null = null
  const embed: QueryBlockVegaEmbed = async (_target, spec) => {
    specs.push(spec)
    notify?.()
    return { view: { finalize() {} } }
  }
  const recorder: EmbedRecorder = {
    specs,
    whenEmbedded(count) {
      if (specs.length >= count) return Promise.resolve()
      return new Promise((resolve) => {
        notify = () => {
          if (specs.length >= count) {
            notify = null
            resolve()
          }
        }
      })
    },
  }
  return { embed, recorder }
}

/** scope root > interpreter-shaped frag wrapper > <sh-vega-chart-view>, ready to mount. */
function mountScopedChart(regionId: string): {
  scope: HTMLDivElement
  view: ShVegaChartView
  recorder: EmbedRecorder
} {
  const scope = document.createElement('div')
  const wrapper = document.createElement('div')
  wrapper.setAttribute('data-layout-node-id', fragmentNodeId(regionId, 'chart-leaf'))
  scope.appendChild(wrapper)
  document.body.appendChild(scope)
  const view = document.createElement('sh-vega-chart-view') as ShVegaChartView
  const { embed, recorder } = recordingEmbed()
  view.loadVegaEmbed = async () => embed
  wrapper.appendChild(view)
  view.result = RESULT
  view.vegaLiteSpec = SPEC
  view.status = 'ready'
  return { scope, view, recorder }
}

afterEach(() => {
  document.body.replaceChildren()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-skin')
})

describe('<sh-vega-chart-view> — scoped theme resolution at mount', () => {
  it('resolves its OWN region\'s ux:vegaTheme through the composed tree and threads it into the mounted config', async () => {
    const { scope, recorder } = mountScopedChart('region-center')
    setVegaThemeScopeOverrides(scope, new Map([['region-center', { axis: { gridColor: '#ff00ff' } }]]))
    try {
      await recorder.whenEmbedded(1)
      const config = recorder.specs[0].config as Record<string, unknown>
      const axis = config.axis as Record<string, unknown>
      expect(axis.gridColor).toBe('#ff00ff') // the region's override…
      const houseAxis = buildVegaTheme('light').axis as Record<string, unknown>
      expect(axis.labelColor).toBe(houseAxis.labelColor) // …merged OVER the house theme, not replacing it
    } finally {
      setVegaThemeScopeOverrides(scope, null)
    }
  })

  it('a chart whose region has NO registered theme mounts the pure house theme — another region\'s theme never leaks in', async () => {
    const { scope, recorder } = mountScopedChart('region-center')
    // A DIFFERENT region's theme is registered on the same scope root.
    setVegaThemeScopeOverrides(scope, new Map([['region-other', { axis: { gridColor: '#ff00ff' } }]]))
    try {
      await recorder.whenEmbedded(1)
      expect(recorder.specs[0].config).toEqual(buildVegaTheme('light'))
    } finally {
      setVegaThemeScopeOverrides(scope, null)
    }
  })
})
describe('<sh-vega-chart-view> — theme-change reactivity', () => {
  it('REMOUNTS the chart when the root data-theme flips — the baked spec colors follow the room', async () => {
    const { recorder } = mountScopedChart('region-center')
    await recorder.whenEmbedded(1)
    expect((recorder.specs[0].config as Record<string, unknown>).background).toBe(
      buildVegaTheme('light').background,
    )

    document.documentElement.setAttribute('data-theme', 'dark')
    await recorder.whenEmbedded(2)
    expect((recorder.specs[1].config as Record<string, unknown>).background).toBe(
      buildVegaTheme('dark').background,
    )
  })

  it('REMOUNTS when the root data-skin flips to a dark-baseline skin (observatory) with data-theme untouched', async () => {
    const { recorder } = mountScopedChart('region-center')
    await recorder.whenEmbedded(1)
    expect((recorder.specs[0].config as Record<string, unknown>).background).toBe(
      buildVegaTheme('light').background,
    )

    document.documentElement.setAttribute('data-skin', 'observatory')
    await recorder.whenEmbedded(2)
    expect((recorder.specs[1].config as Record<string, unknown>).background).toBe(
      buildVegaTheme('dark').background,
    )
  })

  it('a DISCONNECTED chart stops observing — no remount after removal', async () => {
    const { scope, view, recorder } = mountScopedChart('region-center')
    await recorder.whenEmbedded(1)
    view.remove()
    scope.remove()
    document.documentElement.setAttribute('data-theme', 'dark')
    // Give any (wrong) observer callback a real chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(recorder.specs).toHaveLength(1)
  })
})
