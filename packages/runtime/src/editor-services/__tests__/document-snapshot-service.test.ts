/**
 * document-snapshot-service.test.ts — REAL request-construction/response-
 * parsing proof against a fake `fetch` (network-free; the real-network proof
 * against a real gardend cell is `doc-history-face.integration.test.ts` +
 * `apps/organism/scripts/layout-workbench-gardend-browser.mts`). Every
 * assertion below drives the ACTUAL `createDocumentSnapshotService` return
 * value — no method is reimplemented/stubbed here, only the transport's
 * `fetch` call is captured.
 */
import { describe, expect, it } from 'vitest'
import { createDocumentSnapshotService, type DocumentSnapshotTransport } from '../document-snapshot-service.js'

interface RecordedCall {
  readonly url: string
  readonly init?: RequestInit
}

function fakeTransport(): DocumentSnapshotTransport {
  return {
    resolveBaseUrl: (graphId) => `/cell/api/${graphId}`,
    headers: () => ({ 'X-User-ID': 'u1' }),
  }
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function textResponse(body: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => { throw new Error('not json') },
    text: async () => body,
  } as unknown as Response
}

describe('createDocumentSnapshotService — real request construction', () => {
  it('list() calls the exact production route with limit + count, and normalizes snake_case entries', async () => {
    const calls: RecordedCall[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.endsWith('/count')) return jsonResponse({ count: 7 })
      return jsonResponse({
        snapshots: [
          { snapshot_id: 's1', created_at: '2026-07-01T00:00:00.000Z', is_manual: true, chars_added: 3 },
          { snapshotId: 's2', createdAt: '2026-07-02T00:00:00.000Z' },
          { created_at: '2026-07-03T00:00:00.000Z' }, // no id — dropped
        ],
      })
    }) as typeof fetch

    const service = createDocumentSnapshotService(fakeTransport(), fetchImpl)
    const result = await service.list('g1', 'd1', 50)

    expect(calls[0]!.url).toBe('/cell/api/g1/v1/documents/g1/d1/snapshots?limit=50')
    expect(calls[1]!.url).toBe('/cell/api/g1/v1/documents/g1/d1/snapshots/count')
    expect(result.totalCount).toBe(7)
    expect(result.snapshots).toHaveLength(2)
    expect(result.snapshots[0]).toMatchObject({ id: 's1', isManual: true, charsAdded: 3, graphId: 'g1', documentId: 'd1' })
    expect(result.snapshots[1]).toMatchObject({ id: 's2', isManual: false })
  })

  it('list() coerces a real-cell bare epoch-millis created_at STRING to a number, but leaves an ISO-8601 string alone (real-cell finding — see document-snapshot-service.ts\'s normalizeCreatedAt)', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.endsWith('/count')) return jsonResponse({ count: 2 })
      return jsonResponse({
        snapshots: [
          { snapshot_id: 's1', created_at: '1784303881647' },
          { snapshot_id: 's2', created_at: '2026-07-01T00:00:00.000Z' },
        ],
      })
    }) as typeof fetch
    const service = createDocumentSnapshotService(fakeTransport(), fetchImpl)
    const result = await service.list('g1', 'd1')
    expect(result.snapshots[0]!.createdAt).toBe(1784303881647)
    expect(typeof result.snapshots[0]!.createdAt).toBe('number')
    expect(result.snapshots[1]!.createdAt).toBe('2026-07-01T00:00:00.000Z')
  })

  it('list() falls back to snapshots.length when the count route fails', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.endsWith('/count')) return jsonResponse({}, false, 500)
      return jsonResponse({ snapshots: [{ snapshot_id: 's1', created_at: '2026-07-01T00:00:00.000Z' }] })
    }) as typeof fetch
    const service = createDocumentSnapshotService(fakeTransport(), fetchImpl)
    const result = await service.list('g1', 'd1')
    expect(result.totalCount).toBe(1)
  })

  it('list() clamps a caller-supplied limit into [1, 500]', async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      calls.push(url)
      if (url.endsWith('/count')) return jsonResponse({ count: 0 })
      return jsonResponse({ snapshots: [] })
    }) as typeof fetch
    const service = createDocumentSnapshotService(fakeTransport(), fetchImpl)
    await service.list('g1', 'd1', 5000)
    expect(calls[0]).toContain('limit=500')
    await service.list('g1', 'd1', 0)
    expect(calls[2]).toContain('limit=1')
  })

  it('readText()/readHtml() GET the exact snapshot text/html routes', async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      calls.push(url)
      return textResponse('hello world')
    }) as typeof fetch
    const service = createDocumentSnapshotService(fakeTransport(), fetchImpl)
    expect(await service.readText('g1', 'd1', 'snap 1')).toBe('hello world')
    expect(calls[0]).toBe('/cell/api/g1/v1/documents/g1/d1/snapshots/snap%201/text')
    expect(await service.readHtml('g1', 'd1', 'snap-2')).toBe('hello world')
    expect(calls[1]).toBe('/cell/api/g1/v1/documents/g1/d1/snapshots/snap-2/html')
  })

  it('save() POSTs an empty body and returns the created snapshot id', async () => {
    const calls: RecordedCall[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return jsonResponse({ snapshot_id: 'new-snap' })
    }) as typeof fetch
    const service = createDocumentSnapshotService(fakeTransport(), fetchImpl)
    const id = await service.save('g1', 'd1')
    expect(id).toBe('new-snap')
    expect(calls[0]!.url).toBe('/cell/api/g1/v1/documents/g1/d1/snapshots')
    expect(calls[0]!.init?.method).toBe('POST')
    expect(calls[0]!.init?.body).toBe('{}')
  })

  it('bookmark() POSTs /{id}/copy with the label', async () => {
    const calls: RecordedCall[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return jsonResponse({ snapshot_id: 'copy-1' })
    }) as typeof fetch
    const service = createDocumentSnapshotService(fakeTransport(), fetchImpl)
    await service.bookmark('g1', 'd1', 'snap-1', 'Before rewrite')
    expect(calls[0]!.url).toBe('/cell/api/g1/v1/documents/g1/d1/snapshots/snap-1/copy')
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ label: 'Before rewrite' })
  })

  it('remove() DELETEs the exact snapshot route', async () => {
    const calls: RecordedCall[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return jsonResponse({})
    }) as typeof fetch
    const service = createDocumentSnapshotService(fakeTransport(), fetchImpl)
    await service.remove('g1', 'd1', 'snap-1')
    expect(calls[0]!.url).toBe('/cell/api/g1/v1/documents/g1/d1/snapshots/snap-1')
    expect(calls[0]!.init?.method).toBe('DELETE')
  })

  it('every request carries the transport headers()', async () => {
    const calls: RecordedCall[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return jsonResponse({})
    }) as typeof fetch
    const service = createDocumentSnapshotService(fakeTransport(), fetchImpl)
    await service.remove('g1', 'd1', 'snap-1')
    expect((calls[0]!.init?.headers as Record<string, string>)['X-User-ID']).toBe('u1')
  })

  it('surfaces a non-ok response as a real thrown Error, never a fabricated success', async () => {
    const fetchImpl = (async () => textResponse('boom', false, 503)) as typeof fetch
    const service = createDocumentSnapshotService(fakeTransport(), fetchImpl)
    await expect(service.readText('g1', 'd1', 'snap-1')).rejects.toThrow('boom')
  })
})
