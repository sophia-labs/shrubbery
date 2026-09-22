import type { Meta, StoryObj } from '@storybook/web-components'
import type { QueryBlockAttrs, QueryBlockRenderRequest } from '@shrubbery/editor-kernel'
import {
  makeQueryBlockRenderer,
  type QueryBlockResult,
  type QueryBlockService,
} from '@shrubbery/runtime'

const meta: Meta = {
  title: 'Editor/QueryBlockVega',
  tags: ['query-block-vega'],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj

const result: QueryBlockResult = {
  queryKind: 'select',
  resultKind: 'bindings',
  columns: ['person', 'score'],
  rows: [
    {
      person: { type: 'literal', value: 'Ada' },
      score: {
        type: 'literal',
        value: '36',
        datatype: 'http://www.w3.org/2001/XMLSchema#integer',
      },
    },
    {
      person: { type: 'literal', value: 'Grace' },
      score: {
        type: 'literal',
        value: '40',
        datatype: 'http://www.w3.org/2001/XMLSchema#integer',
      },
    },
  ],
  durationMs: 4,
  raw: {},
}

const initialSpec = JSON.stringify(
  {
    title: 'Garden contributors',
    mark: { type: 'bar', tooltip: true },
    encoding: {
      x: { field: 'person', type: 'nominal' },
      y: { field: 'score', type: 'quantitative' },
    },
    height: 260,
  },
  null,
  2,
)

function mountQueryBlock(overrides: Partial<QueryBlockAttrs> = {}): HTMLElement {
  const root = document.createElement('section')
  root.style.maxWidth = '760px'
  root.style.margin = '24px auto'

  let attrs: QueryBlockAttrs = {
    comment: 'Real Vega-Lite, backed by cell-shaped SPARQL bindings',
    query: 'SELECT ?person ?score WHERE { ?person <urn:score> ?score }',
    displayMode: 'manual',
    visualization: 'vega',
    maxRows: 100,
    vegaLiteSpec: initialSpec,
    collapsed: false,
    ...overrides,
  }
  const service: QueryBlockService = { run: async () => result }
  let handle: ReturnType<ReturnType<typeof makeQueryBlockRenderer>>
  const request = (): QueryBlockRenderRequest => ({
    attrs,
    editable: true,
    graphId: 'storybook-graph',
    updateAttrs(patch) {
      attrs = { ...attrs, ...patch }
      handle?.update?.(request())
    },
    deleteNode() {},
  })
  handle = makeQueryBlockRenderer(service)(root, request())
  return root
}

async function waitFor(
  predicate: () => Element | null,
  description: string,
  timeoutMs = 8_000,
): Promise<Element> {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    const match = predicate()
    if (match) return match
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`QueryBlockVega.play: timed out waiting for ${description}`)
}

export const RealVegaLiteLifecycle: Story = {
  render: () => mountQueryBlock(),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const firstSvg = await waitFor(
      () => canvasElement.querySelector('.query-block-host-vega svg'),
      'the initial real Vega SVG',
    )
    if (!firstSvg.textContent?.includes('Ada') || !firstSvg.textContent.includes('Grace')) {
      throw new Error('QueryBlockVega.play: the injected SPARQL rows did not reach Vega labels')
    }
    if (!firstSvg.textContent.includes('Garden contributors')) {
      throw new Error('QueryBlockVega.play: the authored Vega title was not rendered')
    }

    const textarea = canvasElement.querySelector<HTMLTextAreaElement>(
      '.query-block-host-vega-spec',
    )
    if (!textarea) throw new Error('QueryBlockVega.play: the persisted spec editor is missing')
    canvasElement.querySelector<HTMLButtonElement>('.query-block-host-vega-json-toggle')?.click()
    textarea.value = JSON.stringify({
      title: 'Updated live chart',
      mark: { type: 'line', point: true },
      encoding: {
        x: { field: 'person', type: 'ordinal' },
        y: { field: 'score', type: 'quantitative' },
      },
      height: 260,
    })
    textarea.dispatchEvent(new Event('blur'))

    const nextSvg = await waitFor(
      () => {
        const svg = canvasElement.querySelector('.query-block-host-vega svg')
        return svg && svg !== firstSvg && svg.textContent?.includes('Updated live chart') ? svg : null
      },
      'the replacement Vega SVG after editing the persisted spec',
    )
    if (!nextSvg.textContent?.includes('Ada') || !nextSvg.textContent.includes('Grace')) {
      throw new Error('QueryBlockVega.play: data injection was lost after the spec lifecycle update')
    }
  },
}

export const InvalidSpecIsVisible: Story = {
  render: () => mountQueryBlock(),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await waitFor(
      () => canvasElement.querySelector('.query-block-host-vega svg'),
      'the initial real Vega SVG',
    )
    const textarea = canvasElement.querySelector<HTMLTextAreaElement>(
      '.query-block-host-vega-spec',
    )
    if (!textarea) throw new Error('QueryBlockVega.play: the persisted spec editor is missing')
    canvasElement.querySelector<HTMLButtonElement>('.query-block-host-vega-json-toggle')?.click()
    textarea.value = '{ invalid chart json'
    textarea.dispatchEvent(new Event('blur'))
    const alert = await waitFor(
      () => canvasElement.querySelector('.query-block-host-vega-error[role="alert"]'),
      'the honest invalid-spec error',
    )
    if (!alert.textContent?.includes('Invalid Vega-Lite spec')) {
      throw new Error(`QueryBlockVega.play: unexpected error copy: ${alert.textContent ?? ''}`)
    }
  },
}

export const AutoRecommendationAndVisualBuilder: Story = {
  render: () => mountQueryBlock({
    displayMode: 'auto',
    visualization: 'table',
    vegaLiteSpec: '',
  }),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const firstSvg = await waitFor(
      () => canvasElement.querySelector('.query-block-host-vega svg'),
      'the automatically recommended Vega SVG',
    )
    const builder = canvasElement.querySelector<HTMLDivElement>('.query-block-host-vega-builder')
    if (!builder || builder.hidden) {
      throw new Error('QueryBlockVega.play: the visual authoring controls are not visible')
    }
    const x = builder.querySelector<HTMLSelectElement>('[data-vega-field="x"]')
    const y = builder.querySelector<HTMLSelectElement>('[data-vega-field="y"]')
    const mark = builder.querySelector<HTMLSelectElement>('[data-vega-field="mark"]')
    if (!x || !y || !mark || x.value !== 'score' || y.value !== 'person' || mark.value !== 'bar') {
      throw new Error(`QueryBlockVega.play: auto builder mismatch (${x?.value}/${y?.value}/${mark?.value})`)
    }

    mark.value = 'line'
    mark.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(
      () => {
        const svg = canvasElement.querySelector('.query-block-host-vega svg')
        return svg && svg !== firstSvg ? svg : null
      },
      'the replacement SVG produced by a visual mark edit',
    )
    const toggle = builder.querySelector<HTMLButtonElement>('.query-block-host-vega-json-toggle')
    toggle?.click()
    const textarea = canvasElement.querySelector<HTMLTextAreaElement>('.query-block-host-vega-spec')
    if (!textarea || textarea.hidden || !textarea.value.includes('"type": "line"')) {
      throw new Error('QueryBlockVega.play: visual edit did not persist into the raw spec')
    }
  },
}
