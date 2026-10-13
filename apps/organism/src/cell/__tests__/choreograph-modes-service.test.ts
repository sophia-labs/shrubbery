/**
 * ChoreographModesService against a real SPARQL engine: every read and write
 * the surface issues runs on Oxigraph, and the stored triples are asserted in
 * the exact shape Choreograph's enforcement reads.
 */
import { describe, expect, it } from 'vitest'
import { ChoreographModesService } from '../choreograph-modes-service.js'
import { OxigraphMcpCell } from './choreograph-modes-cell.js'

const G = 'urn:mnemosyne:local:graph:graph-a:user:rdf'
const AGT = 'http://mnemosyne.dev/agent#'
const LABEL = '<http://www.w3.org/2000/01/rdf-schema#label>'

function seedAgents(cell: OxigraphMcpCell): void {
  cell.store.update(`INSERT DATA {
    GRAPH <urn:mnemosyne:local:graph:graph-a:agents> {
      <urn:sophia:agent:scout> a <${AGT}Agent> ; ${LABEL} "Scout" .
      <urn:sophia:agent:quill> a <${AGT}Agent> .
    }
  }`)
}

describe('ChoreographModesService — real SPARQL round trips', () => {
  it('reads the live catalogue with effect classes and families from tools/list _meta', async () => {
    const service = new ChoreographModesService(new OxigraphMcpCell(), 'graph-a')
    const tools = await service.catalogue()
    const byName = new Map(tools.map(tool => [tool.name, tool]))
    expect(byName.get('read_document')).toMatchObject({ effect: 'read', family: 'documents' })
    expect(byName.get('sparql_query')).toMatchObject({ effect: 'read', family: 'rdf' })
    expect(byName.get('rdf_dump')).toMatchObject({ effect: 'read' })
    expect(byName.get('semantic_search')).toMatchObject({ effect: 'read', family: 'search' })
    expect(byName.get('query_graph')).toMatchObject({ effect: 'read' })
    expect(byName.get('sparql_update')).toMatchObject({ effect: 'write' })
    expect(byName.get('delete')).toMatchObject({ effect: 'write' })
    expect(byName.get('remember')).toMatchObject({ effect: 'write', family: 'memory' })
  })

  it('saves a mode as exactly the contract triples, escaping the label, and reads it back', async () => {
    const cell = new OxigraphMcpCell()
    const service = new ChoreographModesService(cell, 'graph-a')
    await service.saveMode({
      slug: 'researcher',
      label: 'Researcher "deep"\\ line\nnext',
      access: 'read',
      allowsTools: ['search_documents', 'read_document', 'write_document'],
      graphScopes: ['sophia-cluster'],
      requiresApproval: ['write_document'],
    })
    const m = '<urn:sophia:mode:researcher>'
    expect(cell.triples(G)).toEqual([
      `${m} <${AGT}access> "read"`,
      `${m} <${AGT}allowsTool> "read_document"`,
      `${m} <${AGT}allowsTool> "search_documents"`,
      `${m} <${AGT}allowsTool> "write_document"`,
      `${m} <${AGT}graphScope> <urn:graph:sophia-cluster>`,
      `${m} <${AGT}requiresApproval> "write_document"`,
      `${m} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${AGT}Mode>`,
      `${m} ${LABEL} "Researcher \\"deep\\"\\\\ line\\nnext"`,
    ])
    const { modes } = await service.load()
    expect(modes).toEqual([{
      iri: 'urn:sophia:mode:researcher',
      slug: 'researcher',
      label: 'Researcher "deep"\\ line\nnext',
      access: 'read',
      allowsTools: ['read_document', 'search_documents', 'write_document'],
      graphScopes: ['sophia-cluster'],
      requiresApproval: ['write_document'],
      imageTransform: null,
    }])
    // Every read went through GRAPH-wrapped SPARQL.
    for (const call of cell.calls.filter(c => c.name === 'sparql_query')) {
      expect(String(call.args.query)).toContain('GRAPH ?g')
    }
  })

  it('re-saving replaces the mode but preserves an existing agt:imageTransform', async () => {
    const cell = new OxigraphMcpCell()
    cell.store.update(`INSERT DATA { GRAPH <${G}> {
      <urn:sophia:mode:editor> a <${AGT}Mode> ; ${LABEL} "Editor" ; <${AGT}access> "write" ;
        <${AGT}allowsTool> "write_document", "delete" ; <${AGT}imageTransform> "ink wash, \\"quill\\"" .
    } }`)
    const service = new ChoreographModesService(cell, 'graph-a')
    await service.saveMode({
      slug: 'editor', label: 'Editor', access: 'write',
      allowsTools: ['write_document'], graphScopes: [], requiresApproval: [],
    })
    const { modes } = await service.load()
    expect(modes[0]).toMatchObject({
      access: 'write', allowsTools: ['write_document'], imageTransform: 'ink wash, "quill"',
    })
  })

  it('rejects tools absent from the live catalogue at save time and writes nothing', async () => {
    const cell = new OxigraphMcpCell()
    const service = new ChoreographModesService(cell, 'graph-a')
    await expect(service.saveMode({
      slug: 'ghost', label: 'Ghost', access: 'read',
      allowsTools: ['read_document', 'summon_*'], graphScopes: [], requiresApproval: [],
    })).rejects.toThrow(/summon_\*/)
    expect(cell.triples(G)).toEqual([])
    expect(cell.calls.some(call => call.name === 'sparql_update')).toBe(false)
  })

  it('lists agents from any named graph and assigns default + allowed modes in the user graph', async () => {
    const cell = new OxigraphMcpCell()
    seedAgents(cell)
    const service = new ChoreographModesService(cell, 'graph-a')
    for (const slug of ['reader', 'editor']) {
      await service.saveMode({ slug, label: slug, access: 'read', allowsTools: ['read_document'], graphScopes: [], requiresApproval: [] })
    }
    await service.saveAgentModes('urn:sophia:agent:scout', 'urn:sophia:mode:reader', ['urn:sophia:mode:reader', 'urn:sophia:mode:editor'])
    // A second save replaces only the assignment triples.
    await service.saveAgentModes('urn:sophia:agent:scout', 'urn:sophia:mode:editor', ['urn:sophia:mode:editor'])
    const { agents } = await service.load()
    expect(agents).toEqual([
      { iri: 'urn:sophia:agent:quill', agentId: 'quill', label: null, defaultMode: null, mayUseModes: [] },
      { iri: 'urn:sophia:agent:scout', agentId: 'scout', label: 'Scout', defaultMode: 'urn:sophia:mode:editor', mayUseModes: ['urn:sophia:mode:editor'] },
    ])
    expect(cell.triples(G).filter(t => t.startsWith('<urn:sophia:agent:scout>'))).toEqual([
      `<urn:sophia:agent:scout> <${AGT}defaultMode> <urn:sophia:mode:editor>`,
      `<urn:sophia:agent:scout> <${AGT}mayUseMode> <urn:sophia:mode:editor>`,
    ])
    // The agent's own typing (another named graph) is untouched.
    expect(cell.triples('urn:mnemosyne:local:graph:graph-a:agents')).toHaveLength(3)
    await expect(service.saveAgentModes('urn:sophia:agent:scout', 'urn:sophia:mode:reader', ['urn:sophia:mode:editor']))
      .rejects.toThrow(/default mode must be one of the allowed/)
  })

  it('deleting a mode removes it and every agent reference to it', async () => {
    const cell = new OxigraphMcpCell()
    seedAgents(cell)
    const service = new ChoreographModesService(cell, 'graph-a')
    for (const slug of ['reader', 'editor']) {
      await service.saveMode({ slug, label: slug, access: 'read', allowsTools: ['read_document'], graphScopes: [], requiresApproval: [] })
    }
    await service.saveAgentModes('urn:sophia:agent:scout', 'urn:sophia:mode:reader', ['urn:sophia:mode:reader', 'urn:sophia:mode:editor'])
    await service.deleteMode('urn:sophia:mode:reader')
    const { modes, agents } = await service.load()
    expect(modes.map(mode => mode.slug)).toEqual(['editor'])
    expect(agents.find(agent => agent.agentId === 'scout')).toMatchObject({
      defaultMode: null, mayUseModes: ['urn:sophia:mode:editor'],
    })
    expect(cell.triples(G).some(t => t.includes('urn:sophia:mode:reader'))).toBe(false)
  })

  it('pages reads with explicit LIMIT/OFFSET and refuses a truncated answer', async () => {
    const cell = new OxigraphMcpCell()
    const service = new ChoreographModesService(cell, 'graph-a', { pageSize: 2 })
    for (const slug of ['a', 'b', 'c']) {
      await service.saveMode({ slug, label: slug.toUpperCase(), access: 'write', allowsTools: ['read_document', 'remember'], graphScopes: [], requiresApproval: [] })
    }
    const { modes } = await service.load()
    expect(modes.map(mode => [mode.slug, mode.allowsTools.length])).toEqual([['a', 2], ['b', 2], ['c', 2]])
    const modeQueries = cell.calls.filter(call => call.name === 'sparql_query' && String(call.args.query).includes('agt:Mode'))
    expect(modeQueries.length).toBeGreaterThan(5)
    expect(String(modeQueries[1]!.args.query)).toMatch(/LIMIT 2 OFFSET 2$/)

    cell.warning = 'result truncated at 1 rows (GARDEN_SPARQL_MAX_ROWS); add LIMIT/OFFSET paging to see the rest'
    await expect(service.load()).rejects.toThrow(/truncated/)
  })

  it('ignores mode triples outside the user named graph (the graph enforcement reads)', async () => {
    const cell = new OxigraphMcpCell()
    cell.store.update(`INSERT DATA { GRAPH <urn:elsewhere> {
      <urn:sophia:mode:stray> a <${AGT}Mode> ; ${LABEL} "Stray" ; <${AGT}access> "write" .
    } }`)
    const { modes } = await new ChoreographModesService(cell, 'graph-a').load()
    expect(modes).toEqual([])
  })

  it('refuses IRIs that could break out of the update', async () => {
    const service = new ChoreographModesService(new OxigraphMcpCell(), 'graph-a')
    await expect(service.deleteMode('urn:sophia:mode:x> } } ; DROP ALL ; #')).rejects.toThrow(/unsafe IRI/)
    await expect(service.saveAgentModes('urn:sophia:agent:a b', null, [])).rejects.toThrow(/unsafe IRI/)
    expect(() => new ChoreographModesService(new OxigraphMcpCell(), 'bad graph')).toThrow(/Invalid graph id/)
  })
})
