import { describe, expect, it } from 'vitest'
import { workspaceProjectionGraphIri } from '@shrubbery/runtime'
import { BROWSER_HARNESS_SEED } from './fixture.js'
import { InMemoryCellContract } from './in-memory-cell-contract.js'

const GRAPH_ID = BROWSER_HARNESS_SEED.graphId
const WORKSPACE_GRAPH = workspaceProjectionGraphIri(GRAPH_ID)

describe('InMemoryCellContract', () => {
  it('punishes GRAPH-less reads and returns cell-shaped document rows when scoped', async () => {
    const contract = new InMemoryCellContract(BROWSER_HARNESS_SEED)
    await expect(contract.rest.query(
      GRAPH_ID,
      'SELECT ?doc WHERE { ?doc a <http://mnemosyne.dev/doc#TipTapDocument> }',
    )).rejects.toThrow(`GRAPH <${WORKSPACE_GRAPH}>`)

    const result = await contract.rest.query(
      GRAPH_ID,
      [
        'PREFIX doc: <http://mnemosyne.dev/doc#>',
        'SELECT ?doc (COALESCE(?title, "Untitled") AS ?label)',
        `WHERE { GRAPH <${WORKSPACE_GRAPH}> {`,
        '  ?doc a doc:TipTapDocument .',
        '} }',
      ].join('\n'),
    ) as { rows: Array<Record<string, string>> }

    expect(result.rows.map((row) => row.label)).toEqual([
      '"Architecture"',
      '"Research Notes"',
      '"Delivery Plan"',
      '"Dream Journal"',
    ])
    expect(contract.snapshot().queryCount).toBe(1)
    contract.destroy()
  })

  it('answers the production block-query family from the deterministic fixture', async () => {
    const contract = new InMemoryCellContract(BROWSER_HARNESS_SEED)
    const result = await contract.rest.query(
      GRAPH_ID,
      [
        'PREFIX doc: <http://mnemosyne.dev/doc#>',
        'SELECT DISTINCT ?block ?blockId ?text ?type ?level ?order ?siblingOrder',
        `WHERE { GRAPH <${WORKSPACE_GRAPH}> {`,
        '  BIND(<urn:mnemosyne:local:document:research-notes> AS ?docUri)',
        '  ?block a ?type .',
        '} }',
      ].join('\n'),
    ) as { rows: Array<Record<string, string>> }

    expect(result.rows).toHaveLength(3)
    expect(result.rows[0]).toMatchObject({
      blockId: '"research-title"',
      text: '"Research Notes"',
      type: '<http://mnemosyne.dev/doc#Heading>',
    })
    contract.destroy()
  })

  it('materializes deterministic wire writes behind the contract and deletes them', async () => {
    const contract = new InMemoryCellContract(BROWSER_HARNESS_SEED)
    const created = await contract.wire.create(GRAPH_ID, {
      sourceDocumentId: 'architecture',
      targetDocumentId: 'research-notes',
      predicate: 'http://mnemosyne.ai/vocab#references',
    })

    expect(created.wireId).toBe('harness-wire-1')
    expect(contract.snapshot().wires).toEqual([
      expect.objectContaining({
        graphId: GRAPH_ID,
        wireId: 'harness-wire-1',
        sourceDocumentId: 'architecture',
        targetDocumentId: 'research-notes',
      }),
    ])

    await contract.wire.delete(GRAPH_ID, created.wireId)
    expect(contract.snapshot().wires).toEqual([])
    contract.destroy()
  })

  it('serves original fixture bytes only through the authenticated graph-scoped route', async () => {
    const contract = new InMemoryCellContract(BROWSER_HARNESS_SEED)
    const url = `${contract.runtime.graphBaseUrl(GRAPH_ID)}/artifacts/${GRAPH_ID}/documents/architecture/download-original?inline=true`
    const denied = await contract.fetch(url)
    expect(denied.status).toBe(401)

    const response = await contract.fetch(url, {
      headers: {
        Authorization: `Bearer ${contract.auth.token()}`,
        'X-User-ID': contract.auth.userId(),
      },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/markdown')
    expect(response.headers.get('content-disposition')).toContain('architecture-source.md')
    expect(await response.text()).toContain('authenticated original-file fixture')
    expect(contract.snapshot()).toMatchObject({
      originalFetchCount: 2,
      authenticatedOriginalFetchCount: 1,
    })
    contract.destroy()
  })
})
