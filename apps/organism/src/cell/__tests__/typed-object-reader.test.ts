/**
 * The organism's typed-object reader and the run's typing, over the D5-shaped fixtures in a REAL Oxigraph store (the
 * engine a gardend cell embeds), answering `sparql_query` in the cell's row shape. `emporium_vocab` answers in two
 * ways: as today's gardend does (no `classCatalog`: the reader falls back to the generic model), and with the
 * fixture vocabulary in the §4 shape gardend is adding (the reader switches on, with no change). The real-cell half
 * is `tests/typed-object-reader.integration.test.ts`.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { typedObjectModel } from '@shrubbery/nucleus/object-faces'
import { namedNode, Store, type Term } from 'oxigraph'
import { describe, expect, it } from 'vitest'
import { loadGraphPlanResults, loadGraphPlanRunTyping } from '../graph-plan.js'
import { makeTypedObjectReader, type McpToolPort } from '../typed-object-reader.js'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/runtime/src/object-view/__tests__/fixtures')
const RUN = 'urn:sophia:wf:doc-sleepers:run:mh3x9a1'
const TYPED = `${RUN}#item-7`
const UNFIT = `${RUN}#item-9`
const DREAM_REPORT = 'urn:sophia:type:freud-dreams:workspace#DreamReport'

function fixtureStore(extra = ''): Store {
  const store = new Store()
  for (const name of ['run-record.ttl', 'run-typed-item.ttl', 'run-unfit-item.ttl', 'run-untyped-item.ttl', 'beings.ttl']) {
    const text = readFileSync(join(FIXTURES, name), 'utf8')
    store.load(text, { format: 'text/turtle', to_graph_name: namedNode(/^# graph: (\S+)/.exec(text)![1]!) })
  }
  if (extra) store.load(extra, { format: 'application/trig' })
  return store
}

function rows(store: Store, query: string): { rows: Record<string, string>[] } {
  return {
    rows: (store.query(query) as Map<string, Term>[]).map((solution) => Object.fromEntries([...solution].map(([k, v]) => [k, v.toString()]))),
  }
}

const VOCAB = JSON.parse(readFileSync(join(FIXTURES, 'freud-dreams-workspace.vocab.json'), 'utf8')) as Record<string, unknown>

/** The cell's tools over the store; `catalogue` decides whether emporium_vocab serves the graph's domain vocabulary. */
function port(store: Store, catalogue: boolean, calls: string[] = []): McpToolPort {
  return {
    async callTool(name, args) {
      calls.push(name === 'emporium_vocab' ? `emporium_vocab ${String(args.name ?? '(list)')}` : name)
      if (name === 'sparql_query') return { structuredContent: rows(store, String(args.query)) }
      if (name === 'emporium_vocab') {
        const builtIns = [{ name: 'workflow', version: '1', namespace: 'http://mnemosyne.dev/workflow#' }]
        if (!args.name) return { structuredContent: { vocabularies: catalogue ? [...builtIns, { name: 'workspace', version: '1', namespace: VOCAB.namespace }] : builtIns } }
        if (catalogue && args.name === 'workspace') return { structuredContent: VOCAB }
        return { structuredContent: { name: args.name, version: '1', contract: {} } }
      }
      throw new Error(`unexpected tool ${name}`)
    },
  }
}

describe('the reader, before gardend serves classCatalog', () => {
  it('reads the object and draws it generically: the class IRI in words, every triple a field', async () => {
    const reader = makeTypedObjectReader(port(fixtureStore(), false))
    const read = await reader.read('freud-dreams', TYPED)
    expect(read).not.toBeNull()
    expect(read!.contract).toBeNull()
    const model = typedObjectModel(read!)
    expect(model).toMatchObject({ classLabel: 'Dream report', title: 'Meier', typed: false })
    expect(model.testimony.by?.label).toBe('Experiment clerk')
  })

  it('says null for an object the graph holds nothing about', async () => {
    const reader = makeTypedObjectReader(port(fixtureStore(), false))
    expect(await reader.read('freud-dreams', `${RUN}#item-404`)).toBeNull()
  })
})

describe('the reader, once emporium_vocab serves classCatalog', () => {
  it('finds the class by the vocabulary whose namespace prefixes it, and reads it with its nested class', async () => {
    const reader = makeTypedObjectReader(port(fixtureStore(), true))
    const read = await reader.read('freud-dreams', TYPED)
    expect(read!.contract?.iri).toBe(DREAM_REPORT)
    expect(read!.catalog.map((e) => e.name)).toEqual(['DreamReport', 'Stimulus'])
    const model = typedObjectModel(read!)
    expect(model.typed).toBe(true)
    expect(model.fields.find((f) => f.key === 'stimulus')?.objects?.[0]?.classLabel).toBe('Stimulus')
  })

  it('caches per graph: a redraw does not ask the cell again, a list is asked once, forget() asks again', async () => {
    const calls: string[] = []
    let clock = 0
    const reader = makeTypedObjectReader(port(fixtureStore(), true, calls), { now: () => clock })
    await reader.read('freud-dreams', TYPED)
    await reader.read('freud-dreams', TYPED)
    await reader.read('freud-dreams', UNFIT)
    expect(calls.filter((c) => c === 'sparql_query')).toHaveLength(2)
    expect(calls.filter((c) => c === 'emporium_vocab (list)')).toHaveLength(1)
    clock += 20_000
    await reader.read('freud-dreams', TYPED)
    expect(calls.filter((c) => c === 'sparql_query')).toHaveLength(3)
    reader.forget('freud-dreams')
    await reader.read('freud-dreams', TYPED)
    expect(calls.filter((c) => c === 'emporium_vocab (list)')).toHaveLength(2)
  })

  it('a gardend that refuses emporium_vocab still draws objects, generically', async () => {
    const store = fixtureStore()
    const refusing: McpToolPort = {
      async callTool(name, args) {
        if (name === 'emporium_vocab') throw new Error('tool not found: emporium_vocab')
        return { structuredContent: rows(store, String(args.query)) }
      },
    }
    const read = await makeTypedObjectReader(refusing).read('freud-dreams', TYPED)
    expect(read?.contract).toBeNull()
    expect(typedObjectModel(read!).title).toBe('Meier')
  })

  it('/object finds the typed objects of the graph by class and title, never a nested value on its own', async () => {
    const reader = makeTypedObjectReader(port(fixtureStore(), true))
    expect(await reader.search('freud-dreams')).toEqual([{ iri: TYPED, classIri: DREAM_REPORT, classLabel: 'Dream report', title: 'Meier' }])
  })
})

describe('where an object is used', () => {
  it('lists the documents whose blocks embed it (mdoc:embeds, as gardend projects an objectEmbed)', async () => {
    const projection = `
      @prefix mdoc: <http://mnemosyne.dev/doc#> .
      @prefix mnemo: <https://mnemosyne.local/ns#> .
      <urn:mnemosyne:local:graph:freud-dreams:projection:workspace> {
        <urn:mnemosyne:local:graph:freud-dreams:document:doc-notes#block-1a2b3c4d> a mdoc:ObjectEmbed ;
          mnemo:documentId "doc-notes" ; mdoc:nodeId "block-1a2b3c4d" ;
          mdoc:iri "${TYPED}" ; mdoc:embeds <${TYPED}> .
      }`
    const reader = makeTypedObjectReader(port(fixtureStore(projection), true))
    expect(await reader.usedIn('freud-dreams', TYPED)).toEqual([{ documentId: 'doc-notes', blockId: 'block-1a2b3c4d' }])
    expect(await reader.usedIn('freud-dreams', UNFIT)).toEqual([])
  })

  it('also finds a block projected with its attrs as literals only, as gardend 0.1.4 projects a browser-written embed', async () => {
    // Exactly what gardend 0.1.4 wrote for an objectEmbed the editor inserted (seen live on 2026-10-20).
    const literalsOnly = `
      @prefix mdoc: <http://mnemosyne.dev/doc#> .
      @prefix mnemo: <https://mnemosyne.local/ns#> .
      <urn:mnemosyne:local:graph:freud-dreams:projection:workspace> {
        <urn:mnemosyne:local:document:doc-70e8#block-block-e53442b1> a mdoc:ObjectEmbed ;
          mnemo:documentId "doc-70e8" ; mdoc:nodeId "block-e53442b1" ; mdoc:iri "${TYPED}" ;
          mdoc:graphId "freud-dreams" ; mdoc:label "Meier" ; mdoc:classLabel "Dream report" ; mdoc:slot "card" .
      }`
    const reader = makeTypedObjectReader(port(fixtureStore(literalsOnly), true))
    expect(await reader.usedIn('freud-dreams', TYPED)).toEqual([{ documentId: 'doc-70e8', blockId: 'block-e53442b1' }])
  })
})

describe("the run's typing", () => {
  it("reads the items' IRIs, the typed triples, the sittings that never fit, and the beings each step cast", async () => {
    const store = fixtureStore()
    const reader = { query: async (_graphId: string, sparql: string) => ({ structuredContent: rows(store, sparql) }) }
    const results = await loadGraphPlanResults(reader, 'freud-dreams', RUN)
    expect(results.items.map((i) => i.iri).sort()).toEqual([`${RUN}#item-2`, TYPED, UNFIT].sort())
    const typing = await loadGraphPlanRunTyping(reader, 'freud-dreams', RUN)
    expect(typing.triples.some((t) => t.p === 'http://mnemosyne.dev/workflow#json')).toBe(false)
    expect(typing.triples.some((t) => t.s === `${TYPED}/stimulus`)).toBe(true)
    expect(typing.triples.find((t) => t.s === 'urn:sophia:agent:agent-62517a586738e5e9')?.o.value).toBe('Experiment clerk')
    expect(typing.unfitSittings).toEqual([
      { step: 'urn:sophia:wf:doc-sleepers#clerk', sitting: 'Experiment clerk #4', violations: ['the answer was not a list of dream reports'] },
    ])
    expect([...typing.castAgents]).toEqual([['urn:sophia:wf:doc-sleepers#clerk', 'urn:sophia:agent:agent-62517a586738e5e9']])
    // An item of the run, modelled from the run's own triples and its JSON, is the same object the reader reads.
    const typedItem = results.items.find((i) => i.iri === TYPED)!
    const fromRun = typedObjectModel({ iri: TYPED, triples: typing.triples, json: typedItem.value })
    expect(fromRun).toMatchObject({ title: 'Meier', testimony: { sitting: 'Experiment clerk #3', run: { id: 'mh3x9a1' } } })
  })
})
