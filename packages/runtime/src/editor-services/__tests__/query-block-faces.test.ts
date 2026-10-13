/**
 * The query block's faces by stance, and value faces through the query path —
 * over a REAL Oxigraph store (the engine gardend embeds) loaded with the real
 * Tabula ladder (fixtures/tabula-rungs.ttl, verbatim from the W1 vocab) and a
 * few senderos-shaped claims in their own named graph.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { QueryBlockAttrs, QueryBlockRenderRequest } from '@shrubbery/editor-kernel'
import { namedNode, Store } from 'oxigraph'
import { afterEach, describe, expect, it } from 'vitest'
import { makeOxigraphRestClient } from '../../__tests__/named-graph-store.js'
import { trunkSegments } from '../../outliner-gutter.js'
import {
  formatQueryBlockAge,
  queryBlockCountUnit,
  isRetryableQueryError,
  makeQueryBlockRenderer,
  makeQueryBlockService,
  queryBlockCaption,
  type QueryBlockResult,
  type QueryBlockService,
} from '../query-block-service.js'
import { applyValueFacesToVegaSpec, type QueryBlockVegaEmbed, titleTruncatedLabels } from '../query-block-vega.js'
import { makeValueDictionarySource } from '../value-face-view.js'
import { valueToneColor } from '../vega-theme.js'

const here = dirname(fileURLToPath(import.meta.url))
const CLAIM = 'https://sophia-labs.ai/ontology/claim#'
const VOCAB_G = 'urn:mnemosyne:local:graph:senderos:vocab:tabula'
const CLAIMS_G = 'urn:mnemosyne:local:graph:senderos:derived:claims'
const LONG = 'The registered E3 three-predictor (Tau0, Kroute, chi) sparse censored-AFT emergence-time law is falsified: frozen after 90 fit / 29 selection conditions and operated on the untouched holdout, it misses by orders of magnitude.'

function senderosStore(): Store {
  const store = new Store()
  store.load(readFileSync(join(here, 'fixtures/tabula-rungs.ttl'), 'utf8'), {
    format: 'text/turtle',
    to_graph_name: namedNode(VOCAB_G),
  })
  store.load(`@prefix claim: <${CLAIM}> .
    <urn:c:ex01> a claim:Claim ; claim:shortId "EX-01" ; claim:rung claim:Falsified ; claim:statement "${LONG}" .
    <urn:c:ex02> a claim:Claim ; claim:shortId "EX-02" ; claim:rung claim:HeldOutConfirmed ; claim:statement "A sharp boundary passes a locked gate." .
    <urn:c:gc01> a claim:Claim ; claim:shortId "GC-01" ; claim:rung claim:ExactNumerics ; claim:statement "Compiles every target." .
    <urn:c:gc02> a claim:Claim ; claim:shortId "GC-02" ; claim:rung claim:ExactNumerics ; claim:statement "Closed control word." .`, {
    format: 'text/turtle',
    to_graph_name: namedNode(CLAIMS_G),
  })
  return store
}

const LADDER_QUERY = `PREFIX claim: <${CLAIM}>
SELECT ?id ?rung ?statement WHERE { GRAPH <${CLAIMS_G}> { ?c a claim:Claim ; claim:shortId ?id ; claim:rung ?rung ; claim:statement ?statement } } ORDER BY ?id`
const CENSUS_QUERY = `PREFIX claim: <${CLAIM}>
SELECT ?rung (COUNT(?c) AS ?claims) WHERE { GRAPH <${CLAIMS_G}> { ?c a claim:Claim ; claim:rung ?rung } } GROUP BY ?rung`

function attrs(patch: Partial<QueryBlockAttrs> = {}): QueryBlockAttrs {
  return {
    comment: 'All claims with their current rung',
    query: LADDER_QUERY,
    displayMode: 'manual',
    visualization: 'table',
    maxRows: 100,
    vegaLiteSpec: '',
    collapsed: false,
    ...patch,
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await new Promise(resolve => setTimeout(resolve, 0))
}

afterEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  document.documentElement.removeAttribute('data-theme')
})

function mount(options: {
  service?: QueryBlockService
  attrs?: QueryBlockAttrs
  stance?: 'read' | 'draft' | 'review'
  editable?: boolean
  inShadow?: boolean
  loadVegaEmbed?: () => Promise<QueryBlockVegaEmbed>
} = {}) {
  const store = senderosStore()
  const service = options.service ?? makeQueryBlockService(makeOxigraphRestClient(store))
  const valueDictionary = makeValueDictionarySource(async (graphId, sparql) => {
    const result = await service.run(graphId, sparql, 500)
    return result.resultKind === 'bindings' ? result.rows : []
  })
  const updates: Array<Partial<QueryBlockAttrs>> = []
  const target = document.createElement('div')
  target.className = 'query-block'
  let root: ParentNode = document.body
  if (options.inShadow) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    root = host.attachShadow({ mode: 'open' })
  }
  root.appendChild(target)
  const request: QueryBlockRenderRequest = {
    attrs: options.attrs ?? attrs(),
    editable: options.editable ?? true,
    graphId: 'senderos',
    updateAttrs: patch => updates.push(patch),
    deleteNode() {},
  }
  const handle = makeQueryBlockRenderer(service, {
    valueDictionary,
    stance: () => options.stance ?? 'read',
    loadVegaEmbed: options.loadVegaEmbed,
  })(target, request)
  return { target, updates, handle, root, service }
}

describe('query block — read face', () => {
  it('rests as title + result + caption; chrome exists but only as the draft face; opening writes nothing', async () => {
    const { target, updates } = mount()
    await settle()
    expect(target.dataset.faceStance).toBe('read')
    expect(target.querySelector('.query-block-title')?.textContent).toBe('All claims with their current rung')
    expect(target.querySelector('.query-block-caption')?.textContent).toBe('4 claims · just now')
    // The timing lives in the draft chrome, not in the read face.
    const chrome = target.querySelector<HTMLElement>('.query-block-chrome')!
    expect(chrome.getAttribute('role')).toBe('toolbar')
    expect(chrome.querySelector('.query-block-host-meta')?.textContent).toMatch(/^SELECT · \d+ ms$/)
    expect(target.querySelector<HTMLElement>('.query-block-editor')?.hidden).toBe(true)
    expect(updates).toEqual([])
  })

  it('renders rungs through value faces: chips with vocabulary labels and the chart palette tone', async () => {
    const { target } = mount()
    await settle()
    const chips = [...target.querySelectorAll<HTMLElement>('td .value-chip')]
    expect(chips.map(c => c.textContent)).toEqual(['falsified', 'held-out confirmed', 'exact numerics', 'exact numerics'])
    expect(chips[0].dataset.tone).toBe('danger')
    expect(chips[1].style.getPropertyValue('--value-tone')).toBe(valueToneColor({ kind: 'order', index: 4, count: 6 }, 'light'))
    expect(chips[1].title).toContain(`${CLAIM}HeldOutConfirmed`)
  })

  it('shapes columns: ids never wrap, rungs are chip columns, statements are full text clamped and expand on click', async () => {
    const { target } = mount()
    await settle()
    const heads = [...target.querySelectorAll<HTMLElement>('th')].map(th => th.dataset.columnShape)
    expect(heads).toEqual(['token', 'chip', 'prose'])
    const statement = target.querySelector<HTMLElement>('tbody tr td:nth-child(3)')!
    // The whole statement is in the cell — the clamp is CSS, never a cut.
    expect(statement.textContent).toBe(LONG)
    expect(statement.hasAttribute('data-clamp')).toBe(true)
    statement.click()
    expect(statement.hasAttribute('data-expanded')).toBe(true)
    statement.click()
    expect(statement.hasAttribute('data-expanded')).toBe(false)
  })

  it('styles the root it renders in: a shadow root gets the stylesheet (document.head never reaches the editor)', async () => {
    const { root } = mount({ inShadow: true })
    await settle()
    expect((root as ShadowRoot).querySelector('style[data-shrubbery-query-block-style]')?.textContent).toContain('.query-block-chrome')
    expect(document.head.querySelector('style[data-shrubbery-query-block-style]')).toBeNull()
  })
})

describe('query block — draft face (hover chrome) and review face', () => {
  it('"Query" pins the draft face with the title and SPARQL editors; every function is still there', async () => {
    const { target, updates } = mount()
    await settle()
    const chrome = target.querySelector<HTMLElement>('.query-block-chrome')!
    const labels = [...chrome.querySelectorAll('button')].filter(b => !b.hidden).map(b => b.getAttribute('aria-label') ?? b.textContent)
    expect(labels).toEqual(['Edit query', 'Run', 'Collapse', 'Delete'])
    expect(chrome.querySelector('select[aria-label="Visualization"]')).not.toBeNull()
    expect(chrome.querySelector('input[aria-label="Row limit"]')).not.toBeNull()
    chrome.querySelector<HTMLButtonElement>('.query-block-edit-query')!.click()
    expect(target.dataset.faceStance).toBe('draft')
    const editor = target.querySelector<HTMLElement>('.query-block-editor')!
    expect(editor.hidden).toBe(false)
    expect(editor.querySelector<HTMLTextAreaElement>('.query-block-host-query')?.value).toBe(LADDER_QUERY)
    const title = editor.querySelector<HTMLInputElement>('.query-block-host-comment')!
    title.value = 'Claims by rung'
    title.dispatchEvent(new Event('blur'))
    expect(updates).toEqual([{ comment: 'Claims by rung' }])
    expect(target.querySelector('.query-block-title')?.textContent).toBe('Claims by rung')
  })

  it('the touch affordance opens the chrome; leaving the block closes it', async () => {
    const { target } = mount()
    await settle()
    const affordance = target.querySelector<HTMLButtonElement>('.query-block-affordance')!
    expect(affordance.getAttribute('aria-label')).toBe('Query block options')
    // It sits in the bar ABOVE the title (2026-09-26), like the diagram's ⋯.
    expect(affordance.parentElement?.className).toBe('query-block-bar')
    expect(target.firstElementChild).toBe(affordance.parentElement)
    affordance.click()
    expect(target.hasAttribute('data-chrome-open')).toBe(true)
    expect(affordance.getAttribute('aria-expanded')).toBe('true')
    // A tap inside the block keeps it open; a tap elsewhere closes it.
    target.querySelector('.query-block-title')!.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }))
    expect(target.hasAttribute('data-chrome-open')).toBe(true)
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }))
    expect(target.hasAttribute('data-chrome-open')).toBe(false)
  })

  it('review shows the query source (read-only) and the timing in the caption', async () => {
    const { target } = mount({ stance: 'review' })
    await settle()
    expect(target.dataset.faceStance).toBe('review')
    const editor = target.querySelector<HTMLElement>('.query-block-editor')!
    expect(editor.hidden).toBe(false)
    expect(editor.querySelector<HTMLTextAreaElement>('.query-block-host-query')?.readOnly).toBe(true)
    expect(target.querySelector('.query-block-caption')?.textContent).toMatch(/^4 claims · just now · SELECT in \d+ ms$/)
    // review renders values in their review face: label · stored notation
    expect(target.querySelector('td .value-chip[data-tone^=order-4]')?.textContent).toBe('held-out confirmed · replicated')
  })

  it('the encoding editor sits behind "Edit chart"', async () => {
    const embed: QueryBlockVegaEmbed = async () => ({ view: { finalize() {} } })
    const { target } = mount({
      attrs: attrs({ query: CENSUS_QUERY, visualization: 'vega', vegaLiteSpec: '{"mark":"bar","encoding":{"y":{"field":"rung"},"x":{"field":"claims","type":"quantitative"}}}' }),
      loadVegaEmbed: async () => embed,
    })
    await settle()
    const editChart = target.querySelector<HTMLButtonElement>('.query-block-edit-chart')!
    const builder = target.querySelector<HTMLElement>('.query-block-host-vega-builder')!
    expect(editChart.hidden).toBe(false)
    expect(builder.hidden).toBe(true)
    editChart.click()
    expect(builder.hidden).toBe(false)
    expect(target.dataset.faceStance).toBe('draft')
  })

  it('a read the transport marks retryable is retried, not shown as a failed block', async () => {
    let calls = 0
    const real = makeQueryBlockService(makeOxigraphRestClient(senderosStore()))
    const service: QueryBlockService = {
      async run(graphId, sparql, maxRows) {
        if (sparql === LADDER_QUERY) calls += 1
        if (sparql === LADDER_QUERY && calls === 1) {
          throw new Error('MCP HTTP 503 for sparql_query: {"error":"cell_proxy_unavailable","retryable":true}')
        }
        return real.run(graphId, sparql, maxRows)
      },
    }
    const { target } = mount({ service })
    await new Promise(resolve => setTimeout(resolve, 900))
    await settle()
    expect(calls).toBe(2)
    expect(target.dataset.status).toBe('done')
    expect(isRetryableQueryError(new Error('HTTP 400 bad query'))).toBe(false)
  })
})

describe('value faces in charts', () => {
  it('a rung field gets its labels, the full ladder as domain, and the chip palette on color', async () => {
    const service = makeQueryBlockService(makeOxigraphRestClient(senderosStore()))
    const result = await service.run('senderos', CENSUS_QUERY)
    const dictionary = await makeValueDictionarySource(async (g, q) => {
      const r = await service.run(g, q, 500)
      return r.resultKind === 'bindings' ? r.rows : []
    }).load('senderos')
    const spec: Record<string, unknown> = {
      encoding: { y: { field: 'rung', type: 'nominal' }, x: { field: 'claims', type: 'quantitative' } },
      layer: [{ mark: 'bar', encoding: { color: { field: 'rung', type: 'nominal' } } }, { mark: 'text' }],
    }
    const { labels, hints } = applyValueFacesToVegaSpec(spec, result as QueryBlockResult, dictionary, 'dark')
    const ladder = ['replicated (independent)', 'reproduced (independent)', 'proved (Lean)', 'exact numerics', 'held-out confirmed', 'post-hoc', 'not established', 'falsified']
    expect((spec.encoding as { y: { scale: { domain: string[] } } }).y.scale.domain).toEqual(ladder)
    const color = ((spec.layer as Array<{ encoding?: { color?: { scale?: { domain: string[]; range: string[] } } } }>)[0].encoding!.color!.scale)!
    expect(color.domain).toEqual(ladder)
    expect(color.range[3]).toBe(valueToneColor({ kind: 'order', index: 3, count: 6 }, 'dark'))
    expect(color.range[7]).toBe(valueToneColor({ kind: 'named', name: 'danger' }, 'dark'))
    expect(labels.get('rung')?.get(`${CLAIM}HeldOutConfirmed`)).toBe('held-out confirmed')
    expect(hints).toEqual([])
  })

  it('an authored sort array is kept, and the draft face is told', async () => {
    const service = makeQueryBlockService(makeOxigraphRestClient(senderosStore()))
    const result = await service.run('senderos', CENSUS_QUERY)
    const dictionary = await makeValueDictionarySource(async (g, q) => {
      const r = await service.run(g, q, 500)
      return r.resultKind === 'bindings' ? r.rows : []
    }).load('senderos')
    const spec: Record<string, unknown> = { encoding: { x: { field: 'rung', sort: ['falsified'] } } }
    const { hints } = applyValueFacesToVegaSpec(spec, result as QueryBlockResult, dictionary, 'light')
    expect((spec.encoding as { x: Record<string, unknown> }).x.scale).toBeUndefined()
    expect(hints).toEqual(['x: an authored sort is pinned over the rung order'])
  })
})

describe('captions and the outliner guide', () => {
  it('the caption says what came back and when', () => {
    const now = Date.parse('2026-09-25T20:00:00Z')
    const result: QueryBlockResult = { queryKind: 'select', resultKind: 'bindings', columns: ['a'], rows: [{}, {}], totalRowCount: 7, durationMs: 3, raw: {} }
    expect(queryBlockCaption(result, now - 3 * 60_000, now)).toBe('2 of 7 rows · 3 min. ago')
    expect(formatQueryBlockAge(now - 10_000, now)).toBe('just now')
  })

  it('counts the meaningful unit when the query names it: a rung census is "25 claims", a claim list "4 claims"', async () => {
    const service = makeQueryBlockService(makeOxigraphRestClient(senderosStore()))
    const census = await service.run('senderos', CENSUS_QUERY)
    expect(queryBlockCountUnit(CENSUS_QUERY, census)).toEqual({ count: 4, unit: 'claims' })
    const byClass = CENSUS_QUERY.replace('AS ?claims', 'AS ?n').replace('?claims', '?n')
    expect(queryBlockCountUnit(byClass, await service.run('senderos', byClass))).toEqual({ count: 4, unit: 'claims' })
    const ladder = await service.run('senderos', LADDER_QUERY)
    expect(queryBlockCaption(ladder, Date.now(), undefined, LADDER_QUERY)).toBe('4 claims · just now')
    // No class, no count: rows.
    const plain = `PREFIX claim: <${CLAIM}>\nSELECT ?id WHERE { GRAPH <${CLAIMS_G}> { ?c claim:shortId ?id } }`
    expect(queryBlockCaption(await service.run('senderos', plain), Date.now(), undefined, plain)).toBe('4 rows · just now')
  })

  it('a label Vega truncated gets its full value as a tooltip', () => {
    const host = document.createElement('div')
    host.innerHTML = '<svg><text>replicated (indep…</text><text>post-hoc</text></svg>'
    const titled = titleTruncatedLabels(host, { data: { values: [{ rung: 'replicated (independent)' }, { rung: 'post-hoc' }] } })
    expect(titled).toBe(1)
    expect(host.querySelector('text title')?.textContent).toBe('replicated (independent)')
  })

  it('table cells carry their column label for the narrow card layout, and empty cells say so', async () => {
    const { target } = mount()
    await settle()
    const cells = [...target.querySelectorAll<HTMLElement>('tbody tr:first-child td')]
    expect(cells.map(cell => cell.dataset.label)).toEqual(['id', 'rung', 'statement'])
    expect(cells.some(cell => cell.hasAttribute('data-empty'))).toBe(false)
  })

  it('the ⋯ affordance toggles the chrome open and closed', async () => {
    const { target } = mount()
    await settle()
    const affordance = target.querySelector<HTMLButtonElement>('.query-block-affordance')!
    affordance.click()
    expect(target.hasAttribute('data-chrome-open')).toBe(true)
    affordance.click()
    expect(target.hasAttribute('data-chrome-open')).toBe(false)
  })

  it('the guide stops at embeds and resumes below them', () => {
    expect(trunkSegments(0, 100, [{ top: 20, bottom: 40 }, { top: 60, bottom: 70 }])).toEqual([[0, 20], [40, 60], [70, 100]])
    expect(trunkSegments(10, 50, [{ top: 0, bottom: 15 }, { top: 45, bottom: 90 }])).toEqual([[15, 45]])
    expect(trunkSegments(0, 10, [])).toEqual([[0, 10]])
  })
})
