import type { GatewayGraphInfo, GatewayMcpResult } from '@shrubbery/source/gateway'
import { describe, expect, it, vi } from 'vitest'
import { CellStore, type CellStoreGateway, selectCellGraphId } from '../src/cell-store.js'
import { SoilStore } from '../src/seed-store.js'

describe('SoilStore', () => {
  it('preserves the existing local seed API contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ seeds: [{ id: 'a', title: 'A', snippet: '', modified_ms: 1 }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'a', title: 'A', markdown: '# A\n' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'b' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, title: 'A', snippet: 'body', modified_ms: 2 }))
    const store = new SoilStore({ baseUrl: 'http://127.0.0.1:7777/', fetch: fetchImpl })

    await expect(store.list()).resolves.toHaveLength(1)
    await expect(store.read('a')).resolves.toMatchObject({ markdown: '# A\n' })
    await expect(store.create()).resolves.toEqual({ id: 'b' })
    await expect(store.save('a', { markdown: '# A\nbody', json: { type: 'doc' } }))
      .resolves.toMatchObject({ ok: true })

    expect(fetchImpl.mock.calls.map(call => [String(call[0]), call[1]?.method])).toEqual([
      ['http://127.0.0.1:7777/api/seeds', 'GET'],
      ['http://127.0.0.1:7777/api/seeds/a', 'GET'],
      ['http://127.0.0.1:7777/api/seeds', 'POST'],
      ['http://127.0.0.1:7777/api/seeds/a', 'POST'],
    ])
    expect(JSON.parse(String(fetchImpl.mock.calls[3]?.[1]?.body))).toEqual({ type: 'doc' })
  })
})

// List, paging, workspace switching, read/create/save: tests/cell-store.cell.test.ts
// runs them against a real gardend cell.
describe('CellStore', () => {
  it('keeps viewer graphs readable but refuses app mutations before MCP', async () => {
    let toolCalls = 0
    const gateway: CellStoreGateway = {
      async graphs() { return [graph('read-only', 'viewer')] },
      async toolsCall(_graphId, tool) {
        toolCalls++
        return tool === 'list_documents' ? result([]) : result({})
      },
    }
    const store = new CellStore({ gateway, storage: null })
    await expect(store.list()).resolves.toEqual([])
    await expect(store.create()).rejects.toThrow(/read-only/i)
    expect(toolCalls).toBe(1)
  })
})

describe('selectCellGraphId', () => {
  const graphs = [graph('viewer-live', 'viewer'), graph('editor-stopped', 'editor', 'stopped'), graph('editor-live', 'editor')]

  it('gives URL selection precedence and otherwise prefers a running editable graph', () => {
    expect(selectCellGraphId({ graphs, location: new URL('https://canary.test/hoja/?graph=viewer-live') }))
      .toBe('viewer-live')
    expect(selectCellGraphId({ graphs })).toBe('editor-live')
  })

  it('fails loudly when a requested graph is outside the authenticated graph list', () => {
    expect(() => selectCellGraphId({ graphs, requestedGraphId: 'other' })).toThrow(/not available/i)
  })
})

function graph(
  graphId: string,
  role: GatewayGraphInfo['role'],
  cellState: GatewayGraphInfo['cellState'] = 'running',
): GatewayGraphInfo {
  return { graphId, title: graphId, role, cellState }
}

function result(value: unknown): GatewayMcpResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}
