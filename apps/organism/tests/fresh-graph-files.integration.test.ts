/**
 * REAL INTEGRATION — a graph just created lists its (empty) Files through the source mirror.
 *
 * gardend's source_pull carries a never-written workspace as zero bytes. The offline overlay
 * used to apply them as a Yjs update and threw "Unexpected end of array", so Files on a new
 * graph (a first self-host, a New Workspace) showed "Could not load files".
 */
import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGardendContract } from '../src/cell/gardend-contract.js'
import { loadSidebarSections } from '../src/cell/sidebar-documents.js'
import { resolveGardendBin, spawnGardend, type GardendCell } from '../src/cell/spawn-gardend.js'

const GARDEN_BIN = resolveGardendBin()

describe('REAL INTEGRATION — Files on a new graph', () => {
  let cell: GardendCell

  beforeAll(async () => {
    if (!existsSync(GARDEN_BIN)) {
      throw new Error(`gardend binary not found at ${GARDEN_BIN}. This test REQUIRES the real binary (set GARDEN_BIN).`)
    }
    cell = await spawnGardend({ readyTimeoutMs: 60_000 })
  })
  afterAll(async () => { await cell?.kill() })

  it('mirrors the new graph and lists its sections without a decode error', async () => {
    const contract = createGardendContract({
      transport: { mcpUrl: cell.mcpUrl, healthUrl: `${cell.apiUrl}/health`, token: cell.token, origin: 'http://127.0.0.1' },
    })
    await contract.mcp.toolsCall('create_graph', { graph_id: 'fresh', title: 'Fresh' })
    await contract.sourceMirror.sync('fresh')
    const sections = await loadSidebarSections(contract.rest, 'fresh', null, new Set())
    expect(sections.length).toBeGreaterThan(0)
  })
})
