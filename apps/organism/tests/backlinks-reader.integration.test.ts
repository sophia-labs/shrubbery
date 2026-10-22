/**
 * REAL INTEGRATION — the backlinks reader against a REAL gardend (a fresh temp profile, never anyone's garden):
 * two documents, a wire from one to the other, and `get_backlinks` read back through the reader. Skipped when no
 * gardend binary is available (set GARDEN_BIN), so a checkout without one still runs the rest of the suite.
 */
import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeBacklinksReader } from '../src/cell/backlinks-reader.js'
import { LoopbackMcpClient } from '../src/cell/loopback-mcp.js'
import { type GardendCell, resolveGardendBin, spawnGardend } from '../src/cell/spawn-gardend.js'

const GRAPH_ID = 'backlinks-it'
const GARDEN_BIN = resolveGardendBin()

describe.skipIf(!existsSync(GARDEN_BIN))('REAL INTEGRATION — backlinks read from a live gardend', () => {
  let cell: GardendCell
  let mcp: LoopbackMcpClient
  let source = ''
  let target = ''

  beforeAll(async () => {
    cell = await spawnGardend()
    mcp = new LoopbackMcpClient({ mcpUrl: cell.mcpUrl, healthUrl: `${cell.apiUrl}/health`, token: cell.token, origin: 'http://127.0.0.1' })
    await mcp.toolsCall('create_graph', { graph_id: GRAPH_ID, title: 'Backlinks' })
    const idOf = (made: unknown): string => {
      const record = made as Record<string, unknown>
      return String(record.documentId ?? record.document_id ?? record.id)
    }
    source = idOf(await mcp.callTool('create_document', { graphId: GRAPH_ID, title: 'Notes on dreams' }))
    target = idOf(await mcp.callTool('create_document', { graphId: GRAPH_ID, title: 'The Interpretation of Dreams' }))
    await mcp.callTool('create_wires', {
      graphId: GRAPH_ID,
      wires: [{ wireId: 'wire-bl-1', sourceDocumentId: source, targetDocumentId: target, targetGraphId: GRAPH_ID, predicate: 'supports', bidirectional: false }],
    })
  }, 60000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  it('a document that wires to another is listed as linking to it, by get_backlinks', async () => {
    const reader = makeBacklinksReader({ callTool: (name, args) => mcp.callTool(name, args) })
    const rows = await reader.read({ graphId: GRAPH_ID, documentId: target })
    const wire = rows.find((row) => row.kind === 'wire' && row.sourceDocumentId === source)
    expect(wire).toBeDefined()
    expect(wire?.wireId).toBe('wire-bl-1')
  })

  it('nothing links to the source, and an object nobody holds has no backlinks', async () => {
    const reader = makeBacklinksReader({ callTool: (name, args) => mcp.callTool(name, args) })
    expect((await reader.read({ graphId: GRAPH_ID, documentId: source })).filter((row) => row.kind === 'wire')).toEqual([])
    expect(await reader.read({ graphId: GRAPH_ID, iri: 'urn:mnemosyne:local:graph:backlinks-it:dream:nobody' })).toEqual([])
  })
})
