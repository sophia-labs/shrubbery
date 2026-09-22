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

describe('CellStore', () => {
  it('maps a graph to the SeedStore contract and saves canonical TipTap JSON', async () => {
    const calls: Array<{ graphId: string, tool: string, args: Readonly<Record<string, unknown>> }> = []
    const gateway: CellStoreGateway = {
      async graphs() { return [graph('obs-hoja-1', 'editor')] },
      async toolsCall(graphId, tool, args) {
        calls.push({ graphId, tool, args })
        if (tool === 'list_documents') {
          return result([{
            document_id: 'doc-a',
            title: 'A leaf',
            body: '# A leaf\n\nbody',
            updated_at: '2026-08-01T12:00:00Z',
          }])
        }
        if (tool === 'read_document') {
          return result({ document_id: 'doc-a', title: 'A leaf', content: '# A leaf\n\nbody' })
        }
        if (tool === 'create_document') return result({ documentId: 'doc-new' })
        if (tool === 'write_document') return result({ success: true, title: 'Changed' })
        throw new Error(`unexpected tool ${tool}`)
      },
    }
    const storage = memoryStorage()
    const store = new CellStore({
      gateway,
      graphId: 'obs-hoja-1',
      storage,
      now: () => 1234,
      idFactory: () => 'doc-new',
    })

    await expect(store.list()).resolves.toEqual([{
      id: 'doc-a',
      title: 'A leaf',
      snippet: 'body',
      modified_ms: Date.parse('2026-08-01T12:00:00Z'),
      readOnly: false,
    }])
    await expect(store.read('doc-a')).resolves.toEqual({
      id: 'doc-a', title: 'A leaf', markdown: '# A leaf\n\nbody',
    })
    await expect(store.create()).resolves.toEqual({ id: 'doc-new' })
    const tiptapJson = { type: 'doc', content: [{ type: 'paragraph' }] }
    await expect(store.save('doc-a', { markdown: '# Changed\n\nnew body', json: tiptapJson }))
      .resolves.toEqual({ ok: true, title: 'Changed', snippet: 'new body', modified_ms: 1234 })

    expect(calls.at(-1)).toEqual({
      graphId: 'obs-hoja-1',
      tool: 'write_document',
      args: {
        graphId: 'obs-hoja-1',
        documentId: 'doc-a',
        title: 'Changed',
        tiptapJson,
        awaitDurable: true,
      },
    })
    expect(storage.getItem('shrubbery.hoja.active-graph')).toBe('obs-hoja-1')
  })

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

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
}
