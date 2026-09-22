/**
 * REAL integration coverage for the graph-catalog branch of GardendContract.
 * A fresh headless cell is the response-shape oracle; no mocked MCP payloads.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { createGardendContract, type GardendContract } from '../src/cell/gardend-contract.js'
import {
  resolveGardendBin,
  spawnGardend,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'

const GRAPH_ID = 'shrubbery-contract-catalog-it'
const GARDEN_BIN = resolveGardendBin()

describe('REAL INTEGRATION — gardend graph catalog through the contract', () => {
  let cell: GardendCell
  let contract: GardendContract

  beforeAll(async () => {
    if (!existsSync(GARDEN_BIN)) {
      throw new Error(
        `gardend binary not found at ${GARDEN_BIN}. This test requires the real binary; set GARDEN_BIN to override.`,
      )
    }
    cell = await spawnGardend()
    contract = createGardendContract({
      transport: {
        mcpUrl: cell.mcpUrl,
        healthUrl: `${cell.apiUrl}/health`,
        token: cell.token,
        origin: 'http://127.0.0.1',
      },
    })
    await contract.mcp.toolsCall('create_graph', {
      graph_id: GRAPH_ID,
      title: 'Shrubbery Contract Catalog',
    })
  }, 40000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  it('lists the graph in the cell\'s hosted-compatible structured catalog', async () => {
    const catalog = await contract.restConcrete.graphs()
    expect(catalog.count).toBe(catalog.graphs.length)

    const graph = catalog.graphs.find(entry => entry.graph_id === GRAPH_ID)
    expect(graph).toMatchObject({
      graph_id: GRAPH_ID,
      graph_uri: `urn:mnemosyne:local:graph:${GRAPH_ID}`,
      title: 'Shrubbery Contract Catalog',
      status: 'active',
      role: 'owner',
    })
    expect(graph?.owner_user_id).toBeTruthy()
    expect(graph?.granted_at).toBe(graph?.created_at)
  })
})
