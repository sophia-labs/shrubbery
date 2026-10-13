// @vitest-environment node
/** Eyewright independent consumer examination. Production helper execution,
 * synthetic transport and native Response only; no mounted main or native HTTP.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { restoreArtifactTextRevision } from '../rest-helpers.js'
import type { ArtifactTextSnapshot } from '../artifact-live-preview.js'
import type { CellContract } from '../session-store.js'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const captured: ArtifactTextSnapshot = Object.freeze({ graphId: 'confirmed-graph', graphIncarnation: 'confirmed-life',
  artifactId: 'confirmed-artifact', filename: 'a.html', mimeType: 'text/html', text: '<p>confirmed</p>',
  sizeBytes: 16, contentHashSha256: sha('<p>confirmed</p>') })
const contract = { runtime: { mode: () => 'hosted', graphBaseUrl: (graph: string) => `https://synthetic.invalid/g/${graph}` },
  auth: { token: () => 'fixture-token', userId: () => 'not-an-authority-header' } } as unknown as CellContract
const committed = { status: 'committed', artifactId: captured.artifactId, graphIncarnation: captured.graphIncarnation,
  operationId: 'stable-op', contentHashSha256: sha('<p>restored</p>'), refreshPending: false,
  revisionId: 'text-native-revision', noop: false, replayed: false }
function response(value: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(value)))
  vi.stubGlobal('fetch', fetch); return fetch
}
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
afterEach(() => { expect(vi.getTimerCount()).toBe(0); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('independent guarded restore consumer', () => {
  it('uses the confirmed immutable snapshot, not a later read or legacy endpoint', async () => {
    const fetch = response(committed)
    await restoreArtifactTextRevision(contract, captured, 'confirmed-revision', 'stable-op')
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://synthetic.invalid/g/confirmed-graph/artifacts/confirmed-graph/confirmed-artifact/text/restore')
    expect(JSON.parse(options.body as string)).toEqual({ graphIncarnation: 'confirmed-life',
      expectedContentSha256: captured.contentHashSha256, operationId: 'stable-op', revisionId: 'confirmed-revision' })
    expect(options.headers).toEqual({ Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' })
  })

  it('accepts a native completed no-op/replay without inventing another POST', async () => {
    const fetch = response({ ...committed, noop: true, replayed: true, revisionId: null, contentHashSha256: captured.contentHashSha256 })
    await restoreArtifactTextRevision(contract, captured, 'same-bytes-revision', 'stable-op')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    { value: null }, { value: [] }, { value: 'committed' }, { value: 1 },
    { value: { ...committed, refreshPending: null } }, { value: { ...committed, refreshPending: 0 } },
    { value: { ...committed, contentHashSha256: 'A'.repeat(64) } },
    { value: { ...committed, operationId: 'other-op' } },
  ])('refuses a malformed or uncertain native receipt $value', async ({ value }) => {
    const fetch = response(value)
    await expect(restoreArtifactTextRevision(contract, captured, 'r', 'stable-op')).rejects.toThrow('Operation: stable-op')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retains operation identity on a truncated JSON body, with no retry', async () => {
    const fetch = vi.fn(async () => new Response('{"status":"committed"'))
    vi.stubGlobal('fetch', fetch)
    await expect(restoreArtifactTextRevision(contract, captured, 'r', 'stable-op')).rejects.toThrow('outcome is uncertain')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not mistake transport error wording for a verified helper error', async () => {
    const failure = new Error('Text restore transport adapter disconnected')
    const fetch = vi.fn(async () => { throw failure }); vi.stubGlobal('fetch', fetch)
    await expect(restoreArtifactTextRevision(contract, captured, 'r', 'stable-op')).rejects.toThrow('Operation: stable-op')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('also bounds waiting for the response body and never starts a second write', async () => {
    const fetch = vi.fn(async (_url, options: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { options.signal?.addEventListener('abort', () => controller.error(new Error('body aborted')), { once: true }) },
      })
      return new Response(stream)
    })
    vi.stubGlobal('fetch', fetch)
    const rejected = expect(restoreArtifactTextRevision(contract, captured, 'r', 'stable-op')).rejects.toThrow('Operation: stable-op')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejected; expect(fetch).toHaveBeenCalledTimes(1)
  })
})
