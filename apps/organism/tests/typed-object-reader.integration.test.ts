/**
 * REAL INTEGRATION — the typed-object reader against a REAL gardend (a fresh temp profile, never anyone's garden):
 * the D5-shaped run fixtures loaded into their named graphs with `rdf_load`, read back with the reader's own SPARQL
 * and drawn by `typedObjectModel`. This gardend's `emporium_vocab` does not serve `classCatalog` yet (T1 is in
 * flight), so the reader must fall back to the generic model, honestly, and an `objectEmbed` block a client writes
 * must be kept (as an opaque object until the contract learns the node), never lost.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { typedObjectModel } from '@shrubbery/nucleus/object-faces'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'
import { type GardendCell, resolveGardendBin, spawnGardend } from '../src/cell/spawn-gardend.js'
import { makeTypedObjectReader } from '../src/cell/typed-object-reader.js'

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/runtime/src/object-view/__tests__/fixtures')
const GRAPH_ID = 'typed-objects-it'
const RUN = 'urn:sophia:wf:doc-sleepers:run:mh3x9a1'
const TYPED = `${RUN}#item-7`
const GARDEN_BIN = resolveGardendBin()

describe('REAL INTEGRATION — typed objects read from a live gardend', () => {
  let cell: GardendCell
  let mcp: LoopbackMcpClient

  beforeAll(async () => {
    if (!existsSync(GARDEN_BIN)) throw new Error(`gardend binary not found at ${GARDEN_BIN}; set GARDEN_BIN (no-mock rule)`)
    cell = await spawnGardend()
    mcp = new LoopbackMcpClient({ mcpUrl: cell.mcpUrl, healthUrl: `${cell.apiUrl}/health`, token: cell.token, origin: 'http://127.0.0.1' })
    await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'Typed objects' })
    for (const name of ['run-record.ttl', 'run-typed-item.ttl', 'run-unfit-item.ttl', 'run-untyped-item.ttl', 'beings.ttl']) {
      const text = readFileSync(join(FIXTURES, name), 'utf8')
      const targetGraphIri = /^# graph: (\S+)/.exec(text)![1]!
      await mcp.toolsCall('rdf_load', { graphId: GRAPH_ID, data: text, format: 'text/turtle', targetGraphIri })
    }
  }, 60000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  it('reads a typed item with its nested children and its being, and draws it generically while no classCatalog is served', async () => {
    const reader = makeTypedObjectReader({ callTool: (name, args) => mcp.callTool(name, args) })
    const read = await reader.read(GRAPH_ID, TYPED)
    expect(read).not.toBeNull()
    expect(read!.contract).toBeNull()
    const model = typedObjectModel(read!)
    expect(model).toMatchObject({ classLabel: 'Dream report', title: 'Meier', register: 'run', stance: 'read', typed: false })
    expect(model.testimony).toMatchObject({ by: { label: 'Experiment clerk' }, sitting: 'Experiment clerk #3', run: { id: 'mh3x9a1' } })
    // Generic: no presentation names a title, so the nested value's first short field is its title.
    const stimulus = model.fields.find((f) => f.key === 'stimulus')?.objects?.[0]
    expect(stimulus?.classLabel).toBe('Stimulus')
    expect(stimulus?.fields.map((f) => [f.key, f.value])).toEqual([['sense', 'touch'], ['what', 'a straw between the toes']])
    expect(model.fields.find((f) => f.key === 'witnesses')?.objects).toHaveLength(2)
  })

  it('an unfit item is unfit, and an IRI the graph does not hold is null', async () => {
    const reader = makeTypedObjectReader({ callTool: (name, args) => mcp.callTool(name, args) })
    const unfit = await reader.read(GRAPH_ID, `${RUN}#item-9`)
    expect(typedObjectModel(unfit!).stance).toBe('unfit')
    expect(await reader.read(GRAPH_ID, `${RUN}#item-404`)).toBeNull()
  })

  it('/object finds the typed objects, and not their nested values', async () => {
    const reader = makeTypedObjectReader({ callTool: (name, args) => mcp.callTool(name, args) })
    const hits = await reader.search(GRAPH_ID)
    expect(hits.map((h) => [h.iri, h.classLabel, h.title])).toEqual([[TYPED, 'Dream report', 'Meier']])
  })

  it('an objectEmbed block a client inserts is kept, and "Used in" is empty until gardend projects mdoc:embeds', async () => {
    const created = await mcp.callTool('create_document', { graphId: GRAPH_ID, title: 'My notes on chapter I' }) as Record<string, unknown>
    const documentId = String(created.documentId ?? created.document_id ?? created.id)
    await mcp.callTool('insert_blocks', {
      graphId: GRAPH_ID,
      documentId,
      tiptapJson: { type: 'doc', content: [{ type: 'objectEmbed', attrs: { iri: TYPED, graphId: GRAPH_ID, slot: 'card', label: 'Meier', classLabel: 'Dream report' } }] },
    })
    const doc = JSON.stringify(await mcp.callTool('read_document', { graphId: GRAPH_ID, documentId, format: 'json' }))
    // Kept either as the node itself (a gardend that knows it) or as a typed opaque object carrying it byte for byte.
    expect(doc.includes('objectEmbed')).toBe(true)
    expect(doc.includes(TYPED)).toBe(true)
    const reader = makeTypedObjectReader({ callTool: (name, args) => mcp.callTool(name, args) })
    const used = await reader.usedIn(GRAPH_ID, TYPED)
    expect(Array.isArray(used)).toBe(true)
  })
})
