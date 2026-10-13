// @vitest-environment node
/** Native Response/ReadableStream, synthetic fetch and public inline bytes.
 * This drives the production decoder, not an HTTP or native/server witness.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { fetchArtifactText } from '../rest-helpers.js'
import { ARTIFACT_TEXT_MAX_BYTES, ArtifactTextReadError } from '../artifact-live-preview.js'
import type { CellContract } from '../session-store.js'

const contract = {
  runtime: { mode: () => 'hosted', graphBaseUrl: () => 'https://fixture.invalid/g/g/' },
  auth: { token: () => 'synthetic-test-token', userId: () => 'synthetic-user' },
} as unknown as CellContract
function body(text = '<p>café 🌱</p>') {
  return { graphId: 'g', graphIncarnation: 'inc-1', artifactId: 'a', filename: 'a.html', mimeType: 'text/html', text,
    sizeBytes: new TextEncoder().encode(text).length, contentHashSha256: createHash('sha256').update(text).digest('hex') }
}
function respond(value: unknown, status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch); return fetch
}
async function invalid(value: unknown) {
  respond(value)
  await expect(fetchArtifactText(contract, 'g', 'a')).rejects.toMatchObject({ invalidate: true })
}
afterEach(() => vi.unstubAllGlobals())

describe('authoritative bounded HTML decoder', () => {
  it.each(['', '<p>café 🌱</p>'])('accepts exact SHA and UTF-8 bytes including empty content: %j', async text => {
    const value = body(text), fetch = respond(value), abort = new AbortController()
    expect(await fetchArtifactText(contract, 'g', 'a', abort.signal)).toEqual(value)
    expect(fetch).toHaveBeenCalledWith('https://fixture.invalid/g/g/artifacts/g/a/text', {
      cache: 'no-store', signal: abort.signal, headers: { Authorization: 'Bearer synthetic-test-token' },
    })
  })

  it('accepts a MIME parameter and case variation, without guessing HTML from a filename', async () => {
    const valid = { ...body(), mimeType: ' Text/HTML; charset=utf-8 ' }; respond(valid)
    expect(await fetchArtifactText(contract, 'g', 'a')).toEqual(valid)
    await invalid({ ...body(), filename: 'looks-like.html', mimeType: 'text/plain' })
  })

  it.each([
    ['graph', { graphId: 'other' }], ['artifact', { artifactId: 'other' }],
    ['missing incarnation', { graphIncarnation: '' }], ['blank incarnation', { graphIncarnation: '  ' }],
    ['non-string incarnation', { graphIncarnation: 4 }], ['non-string text', { text: null }],
    ['filename', { filename: 4 }], ['binary MIME', { mimeType: 'application/octet-stream' }],
    ['short hash', { contentHashSha256: 'ab' }], ['wrong hash', { contentHashSha256: '0'.repeat(64) }],
    ['string size', { sizeBytes: '19' }], ['wrong size', { sizeBytes: 0 }],
  ])('refuses invalid %s and invalidates old preview', async (_name, patch) => invalid({ ...body(), ...patch }))

  it('counts UTF-8 bytes rather than UTF-16 code units', async () => {
    const value = body('🌱'); expect(value.sizeBytes).toBe(4)
    await invalid({ ...value, sizeBytes: value.text.length })
  })

  it.each(['\ud800', '\udfff', '<p>\ud800</p>'])('rejects lone UTF-16 surrogate text even when replacement-byte SHA matches', async text => {
    // Both TextEncoder and Node hashing repair lone surrogates to U+FFFD.
    // Such a hash is not evidence that the supplied JSON text was valid UTF-8.
    await invalid(body(text))
  })

  it.each(['text/html; charset=utf-16', 'text/html; charset=iso-8859-1', 'text/html; charset=utf-8; charset=utf-16'])('rejects conflicting MIME charset %s', async mimeType => {
    await invalid({ ...body(), mimeType })
  })

  it('accepts the exact 2 MiB content limit and rejects one byte over', async () => {
    const exact = body('a'.repeat(ARTIFACT_TEXT_MAX_BYTES)); respond(exact)
    expect((await fetchArtifactText(contract, 'g', 'a')).sizeBytes).toBe(ARTIFACT_TEXT_MAX_BYTES)
    await invalid(body('a'.repeat(ARTIFACT_TEXT_MAX_BYTES + 1)))
  })

  it.each([{ value: null }, { value: [] }, { value: 4 }, { value: 'not an object' }])('rejects malformed envelope $value', async ({ value }) => invalid(value))

  it('rejects malformed JSON, malformed wire UTF-8, and a missing response body', async () => {
    for (const response of [new Response('{bad'), new Response(new Uint8Array([0xff, 0xfe])), new Response(null)]) {
      vi.stubGlobal('fetch', vi.fn(async () => response))
      await expect(fetchArtifactText(contract, 'g', 'a')).rejects.toMatchObject({ invalidate: true })
    }
  })

  it('bounds raw wire bytes before JSON parsing and cancels the reader', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(ARTIFACT_TEXT_MAX_BYTES * 6 + 8193)) }, cancel,
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    await expect(fetchArtifactText(contract, 'g', 'a')).rejects.toMatchObject({ invalidate: true, message: expect.stringMatching(/exceeds/) })
    expect(cancel).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false)
  })

  it.each([401, 403, 404, 410])('HTTP %s invalidates protected/deleted preview', async status => {
    respond({}, status)
    await expect(fetchArtifactText(contract, 'g', 'a')).rejects.toMatchObject({ invalidate: true, message: expect.stringContaining(String(status)) })
  })

  it.each([429, 500, 503])('HTTP %s is a retryable transport error, not an empty artifact', async status => {
    respond({}, status)
    await expect(fetchArtifactText(contract, 'g', 'a')).rejects.toMatchObject({ invalidate: false })
  })

  it('propagates network rejection without falsely classifying it as content invalidation', async () => {
    const failure = new TypeError('offline'); vi.stubGlobal('fetch', vi.fn(async () => { throw failure }))
    await expect(fetchArtifactText(contract, 'g', 'a')).rejects.toBe(failure)
    expect(failure).not.toBeInstanceOf(ArtifactTextReadError)
  })
})
