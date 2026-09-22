import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RestClient } from '@shrubbery/nucleus'
import type { QueryBlockAttrs, QueryBlockRenderRequest } from '@shrubbery/editor-kernel'
import {
  buildQueryBlockVegaSpec,
  generateAutoQueryBlockVegaSpec,
  inferQueryBlockQueryKind,
  makeQueryBlockRenderer,
  makeQueryBlockService,
  profileQueryBlockResult,
  type QueryBlockResult,
  type QueryBlockService,
} from '../query-block-service.js'
import type { QueryBlockVegaEmbed, QueryBlockVegaEmbedLoader } from '../query-block-vega.js'

class MemoryRestClient implements RestClient {
  readonly queries: Array<{ graphId: string; sparql: string }> = []
  constructor(private readonly payload: unknown) {}
  async graphs(): Promise<unknown> {
    return []
  }
  async query(graphId: string, sparql: string): Promise<unknown> {
    this.queries.push({ graphId, sparql })
    return this.payload
  }
  async update(): Promise<void> {
    throw new Error('not used')
  }
}

const attrs: QueryBlockAttrs = {
  comment: '',
  query: 'SELECT ?name ?score WHERE { ?s ?p ?o }',
  displayMode: 'auto',
  visualization: 'table',
  maxRows: 100,
  vegaLiteSpec: '',
  collapsed: false,
}

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

describe('makeQueryBlockService', () => {
  it('executes a real RestClient read and normalizes cell-serialized terms', async () => {
    const rest = new MemoryRestClient({
      resultType: 'solutions',
      variables: ['person', 'age'],
      rows: [
        { person: '<urn:person:ada>', age: '"36"^^<http://www.w3.org/2001/XMLSchema#integer>' },
        { person: '<urn:person:grace>', age: '"40"^^<http://www.w3.org/2001/XMLSchema#integer>' },
      ],
    })
    const result = await makeQueryBlockService(rest).run('graph-a', attrs.query, 1)
    expect(rest.queries).toEqual([{ graphId: 'graph-a', sparql: attrs.query }])
    expect(result).toMatchObject({
      queryKind: 'select',
      resultKind: 'bindings',
      columns: ['person', 'age'],
    })
    if (result.resultKind !== 'bindings') throw new Error('expected bindings')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].person).toEqual({ type: 'uri', value: 'urn:person:ada' })
    expect(result.rows[0].age).toMatchObject({ type: 'literal', value: '36' })
  })

  it.each([
    ['null', null],
    ['empty object', {}],
    ['error envelope', { error: 'internal error' }],
  ])(
    'throws on a malformed SELECT response (%s) instead of silently normalizing it into an empty-but-successful bindings result',
    async (_label, payload) => {
      const rest = new MemoryRestClient(payload)
      await expect(makeQueryBlockService(rest).run('graph-a', attrs.query, 1)).rejects.toThrow(
        /not a recognized bindings envelope/,
      )
    },
  )

  it('still treats an explicit empty rows/bindings array as a real zero-row result, not malformed', async () => {
    const explicitEmptyRows = await makeQueryBlockService(new MemoryRestClient({ rows: [] })).run(
      'graph-a',
      attrs.query,
      1,
    )
    expect(explicitEmptyRows).toMatchObject({ resultKind: 'bindings', rows: [] })

    const explicitEmptyBindings = await makeQueryBlockService(
      new MemoryRestClient({ results: { bindings: [] } }),
    ).run('graph-a', attrs.query, 1)
    expect(explicitEmptyBindings).toMatchObject({ resultKind: 'bindings', rows: [] })

    const explicitEmptyArray = await makeQueryBlockService(new MemoryRestClient([])).run(
      'graph-a',
      attrs.query,
      1,
    )
    expect(explicitEmptyArray).toMatchObject({ resultKind: 'bindings', rows: [] })
  })

  it('accepts declarations but rejects every SPARQL update form before transport', async () => {
    expect(inferQueryBlockQueryKind('PREFIX ex: <urn:>\nSELECT * WHERE { ?s ?p ?o }')).toBe(
      'select',
    )
    const rest = new MemoryRestClient({})
    await expect(
      makeQueryBlockService(rest).run('graph-a', 'DELETE WHERE { ?s ?p ?o }'),
    ).rejects.toThrow(/Only read-only/)
    expect(rest.queries).toEqual([])
  })

  it('normalizes ASK and serialized CONSTRUCT results', async () => {
    const ask = await makeQueryBlockService(new MemoryRestClient({ boolean: true })).run(
      'g',
      'ASK { ?s ?p ?o }',
    )
    expect(ask).toMatchObject({ resultKind: 'ask', boolean: true })

    const construct = await makeQueryBlockService(
      new MemoryRestClient({ data: '<urn:s> <urn:p> <urn:o> .', mediaType: 'application/n-quads' }),
    ).run('g', 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }')
    expect(construct).toMatchObject({
      resultKind: 'serialized',
      value: '<urn:s> <urn:p> <urn:o> .',
    })
  })

  it('profiles chartable bindings and generates editable Garden-style Vega specs', () => {
    const result: QueryBlockResult = {
      queryKind: 'select',
      resultKind: 'bindings',
      columns: ['day', 'score', 'team'],
      rows: [
        {
          day: { type: 'literal', value: '2026-07-09', datatype: 'http://www.w3.org/2001/XMLSchema#date' },
          score: { type: 'literal', value: '4', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
          team: { type: 'literal', value: 'Fern' },
        },
        {
          day: { type: 'literal', value: '2026-07-10', datatype: 'http://www.w3.org/2001/XMLSchema#date' },
          score: { type: 'literal', value: '7', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
          team: { type: 'literal', value: 'Moss' },
        },
      ],
      durationMs: 1,
      raw: {},
    }
    expect(profileQueryBlockResult(result).columns.map(column => column.valueKind)).toEqual([
      'date', 'number', 'literal',
    ])
    expect(JSON.parse(generateAutoQueryBlockVegaSpec(result) ?? '{}')).toMatchObject({
      mark: { type: 'line' },
      encoding: { x: { field: 'day', type: 'temporal' }, y: { field: 'score' } },
    })
    expect(JSON.parse(buildQueryBlockVegaSpec(result, {
      mark: 'bar',
      x: 'team',
      y: 'score',
      color: 'team',
      aggregate: 'sum',
      sort: 'descending',
      stack: 'normalize',
      facet: 'day',
    }) ?? '{}')).toMatchObject({
      mark: { type: 'bar', cornerRadiusEnd: 4 },
      encoding: {
        x: { field: 'team', sort: '-y' },
        y: { field: 'score', aggregate: 'sum', stack: 'normalize' },
        color: { field: 'team' },
        column: { field: 'day', type: 'temporal' },
      },
    })
  })
})

describe('makeQueryBlockRenderer', () => {
  function mount(
    result: QueryBlockResult,
    initial: QueryBlockAttrs = attrs,
    loadVegaEmbed?: QueryBlockVegaEmbedLoader,
  ) {
    const calls: Array<{ graphId: string; sparql: string; maxRows?: number }> = []
    const service: QueryBlockService = {
      async run(graphId, sparql, maxRows) {
        calls.push({ graphId, sparql, maxRows })
        return result
      },
    }
    const updates: Array<Partial<QueryBlockAttrs>> = []
    const target = document.createElement('div')
    document.body.appendChild(target)
    const request: QueryBlockRenderRequest = {
      attrs: initial,
      editable: true,
      graphId: 'graph-a',
      updateAttrs: (patch) => updates.push(patch),
      deleteNode() {},
    }
    const handle = makeQueryBlockRenderer(service, { loadVegaEmbed })(target, request)
    return { calls, updates, target, request, handle }
  }

  it('auto-runs and renders binding rows as a table', async () => {
    const result: QueryBlockResult = {
      queryKind: 'select',
      resultKind: 'bindings',
      columns: ['name', 'score'],
      rows: [{ name: { type: 'literal', value: 'Ada' }, score: { type: 'literal', value: '10' } }],
      durationMs: 4,
      raw: {},
    }
    const mounted = mount(result)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mounted.calls).toEqual([{ graphId: 'graph-a', sparql: attrs.query, maxRows: 100 }])
    expect(mounted.target.querySelector('table')?.textContent).toContain('Ada')
    expect(mounted.target.dataset.status).toBe('done')
  })

  it('editor QueryBlock charts remount on a root data-theme/data-skin flip, and destroy() disconnects the observer', async () => {
    const result: QueryBlockResult = {
      queryKind: 'select',
      resultKind: 'bindings',
      columns: ['name', 'score'],
      rows: [
        { name: { type: 'literal', value: 'Ada' }, score: { type: 'literal', value: '10' } },
        { name: { type: 'literal', value: 'Grace' }, score: { type: 'literal', value: '12' } },
      ],
      durationMs: 2,
      raw: {},
    }
    let embeds = 0
    const embed: QueryBlockVegaEmbed = async (container, spec) => {
      embeds += 1
      container.dataset.mark = String((spec.mark as { type?: string }).type ?? spec.mark)
      return { view: { finalize() {} } }
    }
    const mounted = mount(result, attrs, async () => embed)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const baseline = embeds
    expect(baseline).toBeGreaterThan(0)

    // A root theme flip must re-bake the chart (its colors are mount-baked).
    document.documentElement.setAttribute('data-theme', 'dark')
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(embeds).toBeGreaterThan(baseline)

    // After destroy, further flips are silence — the observer is disconnected.
    const settled = embeds
    const handle = mounted.handle
    if (!handle) throw new Error('renderer returned no handle')
    handle.destroy()
    document.documentElement.setAttribute('data-skin', 'observatory')
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(embeds).toBe(settled)
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-skin')
  })

  it('auto-recommends Vega, persists the generated spec, and rebuilds it from visual controls', async () => {
    const result: QueryBlockResult = {
      queryKind: 'select',
      resultKind: 'bindings',
      columns: ['name', 'score'],
      rows: [
        { name: { type: 'literal', value: 'Ada' }, score: { type: 'literal', value: '10' } },
        { name: { type: 'literal', value: 'Grace' }, score: { type: 'literal', value: '12' } },
      ],
      durationMs: 2,
      raw: {},
    }
    const embed: QueryBlockVegaEmbed = async (container, spec) => {
      container.dataset.mark = String((spec.mark as { type?: string }).type ?? spec.mark)
      return { view: { finalize() {} } }
    }
    const mounted = mount(result, attrs, async () => embed)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const generated = mounted.updates.find(update => update.visualization === 'vega')
    expect(generated?.vegaLiteSpec).toContain('"type": "bar"')
    expect(mounted.target.querySelector<HTMLDivElement>('.query-block-host-vega-builder')?.hidden).toBe(false)
    expect(mounted.target.querySelector('[data-visualization-status="done"]')).not.toBeNull()

    const mark = mounted.target.querySelector<HTMLSelectElement>('[data-vega-field="mark"]')!
    const x = mounted.target.querySelector<HTMLSelectElement>('[data-vega-field="x"]')!
    const y = mounted.target.querySelector<HTMLSelectElement>('[data-vega-field="y"]')!
    mark.value = 'line'
    x.value = 'name'
    y.value = 'score'
    mark.dispatchEvent(new Event('change', { bubbles: true }))
    const authored = mounted.updates.at(-1)
    expect(authored).toMatchObject({ displayMode: 'manual', visualization: 'vega' })
    expect(JSON.parse(String(authored?.vegaLiteSpec))).toMatchObject({
      mark: { type: 'line' },
      encoding: { x: { field: 'name' }, y: { field: 'score' } },
    })

    const toggle = mounted.target.querySelector<HTMLButtonElement>('.query-block-host-vega-json-toggle')!
    toggle.click()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(mounted.target.querySelector<HTMLTextAreaElement>('.query-block-host-vega-spec')?.hidden).toBe(false)
  })

  it('renders a real Vega host and the network visualization without backend imports in the kernel', async () => {
    const bindings: QueryBlockResult = {
      queryKind: 'select',
      resultKind: 'bindings',
      columns: ['label', 'value'],
      rows: [
        { label: { type: 'literal', value: 'A' }, value: { type: 'literal', value: '2' } },
        { label: { type: 'literal', value: 'B' }, value: { type: 'literal', value: '4' } },
      ],
      durationMs: 1,
      raw: {},
    }
    const embed: QueryBlockVegaEmbed = async (container, spec) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.dataset.vegaChart = ''
      svg.textContent = JSON.stringify(spec.data)
      container.appendChild(svg)
      return { view: { finalize() {} } }
    }
    const bars = mount(
      bindings,
      {
        ...attrs,
        displayMode: 'manual',
        visualization: 'vega',
        vegaLiteSpec: JSON.stringify({
          mark: 'bar',
          encoding: {
            x: { field: 'label', type: 'nominal' },
            y: { field: 'value', type: 'quantitative' },
          },
        }),
      },
      async () => embed,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(bars.target.querySelector('svg[data-vega-chart]')?.textContent).toContain('"value":2')
    expect(bars.target.querySelector('[data-visualization-status="done"]')).not.toBeNull()

    const triples: QueryBlockResult = {
      queryKind: 'select',
      resultKind: 'bindings',
      columns: ['s', 'p', 'o'],
      rows: [{
        s: { type: 'uri', value: 'urn:s' },
        p: { type: 'uri', value: 'urn:p' },
        o: { type: 'uri', value: 'urn:o' },
      }],
      durationMs: 1,
      raw: {},
    }
    const network = mount(triples, {
      ...attrs,
      displayMode: 'manual',
      visualization: 'network',
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(network.target.querySelector('.query-block-host-network')).not.toBeNull()
    expect(network.target.querySelectorAll('line')).toHaveLength(1)
  })

  it('shows authored Vega errors instead of silently substituting a fake chart', async () => {
    const result: QueryBlockResult = {
      queryKind: 'select',
      resultKind: 'bindings',
      columns: ['value'],
      rows: [{ value: { type: 'literal', value: '2' } }],
      durationMs: 1,
      raw: {},
    }
    const loadEmbed = vi.fn()
    const mounted = mount(result, {
      ...attrs,
      displayMode: 'manual',
      visualization: 'vega',
      vegaLiteSpec: '{ definitely not json',
    }, loadEmbed)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(loadEmbed).not.toHaveBeenCalled()
    expect(mounted.target.querySelector('[role="alert"]')?.textContent).toMatch(
      /Invalid Vega-Lite spec/,
    )
    expect(mounted.target.querySelector('[data-visualization-status="error"]')).not.toBeNull()
  })

  it('finalizes stale and destroyed Vega views while keeping only the newest result active', async () => {
    const result: QueryBlockResult = {
      queryKind: 'select',
      resultKind: 'bindings',
      columns: ['value'],
      rows: [{ value: { type: 'literal', value: '2' } }],
      durationMs: 1,
      raw: {},
    }
    const resolvers: Array<(value: { view: { finalize(): void } }) => void> = []
    const finalizers = [vi.fn(), vi.fn()]
    const embed: QueryBlockVegaEmbed = async (container, spec) => {
      container.dataset.mark = String(spec.mark)
      return new Promise((resolve) => resolvers.push(resolve))
    }
    const initial = {
      ...attrs,
      displayMode: 'manual' as const,
      visualization: 'vega' as const,
      vegaLiteSpec: JSON.stringify({ mark: 'bar' }),
    }
    const mounted = mount(result, initial, async () => embed)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(resolvers).toHaveLength(1)

    mounted.handle?.update?.({
      ...mounted.request,
      attrs: { ...initial, vegaLiteSpec: JSON.stringify({ mark: 'line' }) },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(resolvers).toHaveLength(2)

    resolvers[1]({ view: { finalize: finalizers[1] } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    resolvers[0]({ view: { finalize: finalizers[0] } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(finalizers[0]).toHaveBeenCalledTimes(1)
    expect(finalizers[1]).not.toHaveBeenCalled()
    expect(mounted.target.querySelector('.query-block-host-vega')?.getAttribute('data-mark')).toBe(
      'line',
    )

    mounted.handle?.destroy?.()
    expect(finalizers[1]).toHaveBeenCalledTimes(1)
    expect(mounted.target.childElementCount).toBe(0)
  })

  it('unescapes NT-quoted literals in ONE pass — escaped-backslash sequences survive', async () => {
    // Wire form of the lexical value {"a":"x\ny"} — the JSON TEXT contains
    // backslash+n (2 chars), so NT doubles the backslash: \\n on the wire.
    // The old sequential .replace() unescape turned that into backslash+LF,
    // which JSON.parse rejects ("Bad escaped character") — observed live on
    // ux:layoutJson with embedded SPARQL query strings.
    const wire = String.raw`"{\"a\":\"x\\ny\"}"`
    const rest = {
      async query() {
        return { resultType: 'solutions', variables: ['j'], rows: [{ j: wire }] }
      },
    } as unknown as RestClient
    const service = makeQueryBlockService(rest)
    const result = await service.run('g', 'SELECT ?j WHERE {}', 5)
    if (result.resultKind !== 'bindings') throw new Error('expected bindings')
    const term = result.rows[0].j
    expect(term.type).toBe('literal')
    // The unescaped lexical value keeps JSON's OWN backslash-n escape intact…
    expect(term.value).toBe('{"a":"x\\ny"}')
    // …so JSON.parse then applies JSON semantics: backslash-n ⇒ a newline.
    expect(JSON.parse(term.value)).toEqual({ a: 'x\ny' })
  })
})
