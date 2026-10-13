// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { restoreArtifactTextRevision } from '../rest-helpers.js'
import type { CellContract } from '../session-store.js'
import type { ArtifactTextSnapshot } from '../artifact-live-preview.js'

const contract = { runtime: { mode: () => 'hosted', graphBaseUrl: () => 'https://fixture.invalid/g/g/' },
  auth: { token: () => 'synthetic-token', userId: () => 'synthetic-user' } } as unknown as CellContract
const snapshot: ArtifactTextSnapshot = { graphId: 'g', graphIncarnation: 'life-1', artifactId: 'a',
  filename: 'a.html', mimeType: 'text/html', text: '', sizeBytes: 0, contentHashSha256: 'a'.repeat(64) }
const receipt = { status: 'committed', artifactId: 'a', graphIncarnation: 'life-1', operationId: 'restore-1',
  contentHashSha256: 'b'.repeat(64), refreshPending: false }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('guarded HTML history restore', () => {
  it('sends the captured current identity to the text route and verifies its receipt', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(receipt)))
    vi.stubGlobal('fetch', fetch)
    await restoreArtifactTextRevision(contract, snapshot, 'old-revision', 'restore-1')
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://fixture.invalid/g/g/artifacts/g/a/text/restore')
    expect(options).toMatchObject({ method: 'POST', cache: 'no-store',
      headers: { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' } })
    expect(JSON.parse(options.body as string)).toEqual({ graphIncarnation: 'life-1',
      expectedContentSha256: 'a'.repeat(64), revisionId: 'old-revision', operationId: 'restore-1' })
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([401, 403, 404, 409, 500, 503])('never falls back or automatically repeats HTTP %s', async status => {
    const fetch = vi.fn(async () => new Response('{}', { status })); vi.stubGlobal('fetch', fetch)
    await expect(restoreArtifactTextRevision(contract, snapshot, 'r', 'restore-1')).rejects.toThrow(`HTTP ${status}`)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([{ artifactId: 'other' }, { graphIncarnation: 'other' }, { operationId: 'other' },
    { status: 'pending' }, { refreshPending: true }, { contentHashSha256: 'invalid' }])('refuses an unmatched or incomplete receipt %j', async patch => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...receipt, ...patch }))))
    await expect(restoreArtifactTextRevision(contract, snapshot, 'r', 'restore-1')).rejects.toThrow('unverified receipt')
  })

  it('keeps the operation identity in an uncertain network outcome without retry', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('offline') }); vi.stubGlobal('fetch', fetch)
    await expect(restoreArtifactTextRevision(contract, snapshot, 'r', 'restore-1')).rejects.toThrow('Operation: restore-1')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('refuses a missing current identity without making any request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    await expect(restoreArtifactTextRevision(contract, { ...snapshot, graphIncarnation: '' }, 'r', 'restore-1')).rejects.toThrow('verified current artifact identity')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('aborts a stalled transport and reports uncertainty', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn((_url, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })); vi.stubGlobal('fetch', fetch)
    const result = expect(restoreArtifactTextRevision(contract, snapshot, 'r', 'restore-1')).rejects.toThrow('outcome is uncertain')
    await vi.advanceTimersByTimeAsync(15_000)
    await result
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
