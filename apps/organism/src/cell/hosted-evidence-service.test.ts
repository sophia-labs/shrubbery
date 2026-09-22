import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createHostedEvidenceService } from './hosted-evidence-service.js'

describe('hosted evidence service', () => {
  it('uses the canonical owner-scoped gateway route and verifies the returned digest', async () => {
    const bytes = new TextEncoder().encode('private screenshot bytes')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const requested = { url: '', authorization: '' }
    const service = createHostedEvidenceService({
      gatewayBaseUrl: 'https://api.canary.sophia-labs.com/',
      graphBaseUrl: graphId =>
        `https://api.canary.sophia-labs.com/o/user%3Ahoja-owner/g/${encodeURIComponent(graphId)}`,
      token: () => 'id-token',
      fetch: (async (input, init) => {
        requested.url = String(input)
        requested.authorization = new Headers(init?.headers).get('authorization') ?? ''
        return new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } })
      }) as typeof fetch,
    })
    const blob = await service.read('obs-hoja-local', 'run-1', {
      uri: `s3://private-evidence/run-1/scenario-1/beat-1/camoufox/screenshot-${digest}.png`,
      sha256: digest,
      bytes: bytes.byteLength,
      mediaType: 'image/png',
    })
    expect(blob.size).toBe(bytes.byteLength)
    expect(requested.authorization).toBe('Bearer id-token')
    const url = new URL(requested.url)
    expect(url.pathname).toBe('/o/user%3Ahoja-owner/g/obs-hoja-local/workflows/runs/run-1/evidence')
    expect(url.searchParams.get('sha256')).toBe(digest)
    expect(url.searchParams.get('bytes')).toBe(String(bytes.byteLength))
  })

  it('refuses an owner resolver that would send the bearer to another origin', async () => {
    const service = createHostedEvidenceService({
      gatewayBaseUrl: 'https://api.canary.sophia-labs.com',
      graphBaseUrl: () => 'https://attacker.example/g/observatory',
      token: () => 'id-token',
      fetch: (async () => { throw new Error('must not fetch') }) as typeof fetch,
    })
    await expect(service.read('observatory', 'run-1', {
      uri: 's3://private-evidence/run-1/manifest.json',
      sha256: 'a'.repeat(64),
    })).rejects.toThrow(/configured gateway origin/)
  })

  it('never attempts a request without an authenticated token', async () => {
    const service = createHostedEvidenceService({
      gatewayBaseUrl: 'https://api.canary.sophia-labs.com',
      token: () => undefined,
      fetch: (async () => { throw new Error('must not fetch') }) as typeof fetch,
    })
    await expect(service.read('observatory', 'run-1', {
      uri: 's3://private-evidence/run-1/manifest.json',
      sha256: 'a'.repeat(64),
    })).rejects.toThrow(/authenticated hosted session/)
  })
})
