// @vitest-environment happy-dom
/**
 * rest-helpers.test.ts — the cell REST/fetch helpers extracted from main.ts,
 * driven against a REAL node:http server serving real bytes with real headers
 * (mirroring media-face.test.ts) — no vi.mock/vi.fn/vi.stubGlobal, no faked
 * Response/Blob. The load-bearing assertions are the URL/header shapes and the
 * verbatim error surfacing (the gardend error body, never a silent fallback).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { CellContract } from '../session-store.js'
import {
  cellRequestHeaders,
  fetchArtifactBlob,
  graphCellUrl,
  normalizeArtifactRevision,
  normalizeDocumentSnapshot,
  uploadImageForEditor,
} from '../rest-helpers.js'

interface CapturedRequest {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string | undefined>
  readonly body: Buffer
}
interface QueuedResponse {
  readonly status?: number
  readonly body?: string
}

// The real cell answers each request from the head of this queue; every request
// is captured so the URL/header/method shape can be asserted against the wire.
const captured: CapturedRequest[] = []
let queue: QueuedResponse[] = []
let server: Server
let baseUrl = ''
let originalUrl = ''

function enqueue(...responses: QueuedResponse[]): void {
  queue.push(...responses)
}

// happy-dom points the document at the live cell's origin for the duration of
// this file so the fetches are SAME-ORIGIN: its fetch strips the Authorization
// header from cross-origin requests, and the singleFork window is shared with
// sibling files, so the original URL is captured and restored in afterAll.
interface HappyDomControl {
  readonly happyDOM?: { setURL(url: string): void }
  readonly location: { href: string }
}
function happyDom(): HappyDomControl {
  return globalThis.window as unknown as HappyDomControl
}

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk as Buffer))
    req.on('end', () => {
      captured.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers as Record<string, string | undefined>,
        body: Buffer.concat(chunks),
      })
      const next = queue.shift()
      // An empty queue is a test bug, not a fallback — answer 500 loudly.
      res.statusCode = next?.status ?? (next ? 200 : 500)
      res.setHeader('Content-Type', 'application/json')
      res.end(next ? next.body ?? '' : 'no queued response')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`
  originalUrl = happyDom().location.href
  happyDom().happyDOM?.setURL(`${baseUrl}/`)
})

afterAll(async () => {
  if (originalUrl) happyDom().happyDOM?.setURL(originalUrl)
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

afterEach(() => {
  queue = []
  captured.length = 0
})

// The contract's honest minimal surface: the helpers read only runtime.graphBaseUrl
// and auth.{userId,token}. A string base drives the pure-URL/header assertions;
// pointing base at the live server drives the real round-trips.
function contractStub(opts: { base?: string; userId?: string; token?: string } = {}): CellContract {
  const base = opts.base ?? 'https://cell.test'
  return {
    runtime: { graphBaseUrl: (graphId: string) => `${base}/g/${graphId}` },
    auth: { userId: () => opts.userId ?? 'user-1', token: () => opts.token },
  } as unknown as CellContract
}

function liveContract(opts: { userId?: string; token?: string } = {}): CellContract {
  return contractStub({ base: baseUrl, ...opts })
}

describe('graphCellUrl', () => {
  it('joins the graph base URL with the path, trimming/normalizing slashes', () => {
    const contract = contractStub({ base: 'https://cell.test/' })
    // graphBaseUrl(g) → https://cell.test//g/g1 → trailing slashes trimmed, path forced to a leading slash
    expect(graphCellUrl(contractStub(), 'g1', 'health')).toBe('https://cell.test/g/g1/health')
    expect(graphCellUrl(contractStub(), 'g1', '/health')).toBe('https://cell.test/g/g1/health')
    expect(graphCellUrl(contract, 'g1', '/x').endsWith('/g/g1/x')).toBe(true)
  })
})

describe('cellRequestHeaders', () => {
  it('always sends X-User-ID and adds a bearer token only when present', () => {
    expect(cellRequestHeaders(contractStub({ userId: 'u9' }))).toEqual({ 'X-User-ID': 'u9' })
    expect(cellRequestHeaders(contractStub({ userId: 'u9', token: 'tok' }))).toEqual({
      'X-User-ID': 'u9',
      Authorization: 'Bearer tok',
    })
  })
})

describe('normalizeArtifactRevision', () => {
  it('resolves the revision id across snake/camel/id spellings and coerces size', () => {
    expect(normalizeArtifactRevision({ revisionId: 'r1', size_bytes: '42', label: '  ' })).toMatchObject({
      revisionId: 'r1',
      sizeBytes: 42,
      label: null,
    })
    expect(normalizeArtifactRevision({ id: 'r2', file_name: 'a.png' })).toMatchObject({ revisionId: 'r2', filename: 'a.png' })
  })

  it('returns null when no revision id is present', () => {
    expect(normalizeArtifactRevision({ label: 'x' })).toBeNull()
  })
})

describe('normalizeDocumentSnapshot', () => {
  it('requires id and createdAt and falls back to the given graph/document ids', () => {
    expect(normalizeDocumentSnapshot({ snapshot_id: 's1', created_at: 't', chars_added: 3 }, 'g', 'd')).toMatchObject({
      id: 's1',
      graphId: 'g',
      documentId: 'd',
      charsAdded: 3,
      isManual: false,
    })
    expect(normalizeDocumentSnapshot({ snapshotId: 's2' }, 'g', 'd')).toBeNull()
    expect(normalizeDocumentSnapshot({ snapshot_id: 's3' }, 'g', 'd')).toBeNull()
  })
})

describe('fetch round-trips against a real cell', () => {
  it('surfaces the verbatim error body from fetchArtifactBlob, never a fallback', async () => {
    enqueue({ status: 500, body: 'gardend exploded' })
    await expect(fetchArtifactBlob(liveContract(), 'g1', 'a1')).rejects.toThrow('gardend exploded')
    expect(captured[0]?.url).toBe('/g/g1/artifacts/g1/a1/download')
  })

  it('uploadImageForEditor POSTs multipart with auth and resolves a relative src to an absolute url', async () => {
    enqueue({ body: JSON.stringify({ src: '/artifacts/g1/img.png' }) })
    const file = new File([new Uint8Array([1, 2, 3])], 'Sketch.png', { type: 'image/png' })
    const result = await uploadImageForEditor(liveContract({ token: 'tok' }), 'g1', file)

    expect(captured[0]?.url).toBe('/g/g1/artifacts/g1/images/upload')
    expect(captured[0]?.method).toBe('POST')
    expect(captured[0]?.headers.authorization).toBe('Bearer tok')
    expect(captured[0]?.headers['x-user-id']).toBe('user-1')
    expect(result).toEqual({ src: `${baseUrl}/g/g1/artifacts/g1/img.png`, alt: 'Sketch', size: 'large' })
  })

  it('uploadImageForEditor rejects when the response omits src', async () => {
    enqueue({ body: JSON.stringify({ src: '   ' }) })
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' })
    await expect(uploadImageForEditor(liveContract(), 'g1', file)).rejects.toThrow('did not include src')
  })
})
