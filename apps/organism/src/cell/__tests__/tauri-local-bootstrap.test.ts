import { describe, expect, it } from 'vitest'
import {
  isTauriHost,
  selectTauriGraphId,
  transportFromTauriManifest,
} from '../tauri-local-bootstrap.js'
import type { GraphCatalogEntry } from '../gardend-contract.js'

function graph(graphId: string, updatedAt: string, status = 'active'): GraphCatalogEntry {
  return {
    graph_uri: `urn:mnemosyne:local:graph:${graphId}`,
    graph_id: graphId,
    title: graphId,
    description: null,
    status,
    created_at: updatedAt,
    updated_at: updatedAt,
    triple_count: null,
    last_query_at: null,
    last_update_at: null,
    role: 'owner',
    owner_user_id: 'local',
  }
}

describe('Tauri-local Shrubbery bootstrap', () => {
  it('detects only the native host marker', () => {
    expect(isTauriHost({})).toBe(false)
    expect(isTauriHost({ __TAURI_INTERNALS__: {} })).toBe(true)
  })

  it('maps the per-run manifest to the existing authenticated cell transport', () => {
    expect(transportFromTauriManifest({
      apiUrl: 'http://127.0.0.1:43123/',
      mcpUrl: 'http://127.0.0.1:43123/mcp',
      token: 'session-secret',
    })).toEqual({
      mcpUrl: 'http://127.0.0.1:43123/mcp',
      healthUrl: 'http://127.0.0.1:43123/health',
      token: 'session-secret',
      transport: 'fetch',
    })
  })

  it('honors explicit and stored graphs, then selects the newest active graph', () => {
    const graphs = [
      graph('older', '2026-07-10T12:00:00Z'),
      graph('newer', '2026-07-13T12:00:00Z'),
      graph('deleted', '2026-07-14T12:00:00Z', 'deleted'),
    ]
    expect(selectTauriGraphId(graphs, 'older', 'newer')).toBe('older')
    expect(selectTauriGraphId(graphs, 'missing', 'older')).toBe('older')
    expect(selectTauriGraphId(graphs, null, null)).toBe('newer')
    expect(selectTauriGraphId([graphs[2]], null, null)).toBeNull()
  })
})
