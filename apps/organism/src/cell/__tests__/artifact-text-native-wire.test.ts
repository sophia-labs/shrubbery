// @vitest-environment node
/** Actual native service output consumed by the production decoder through a
 * synthetic Response. This closes the JSON seam, not a signed HTTP journey.
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchArtifactText } from '../rest-helpers.js'
import type { CellContract } from '../session-store.js'
import type { ArtifactTextSnapshot } from '../artifact-live-preview.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/artifact-text-native-8fa0318.json', import.meta.url), 'utf8')) as {
  nativeSource: string; snapshots: ArtifactTextSnapshot[]
}
const contract = { runtime: { mode: () => 'hosted', graphBaseUrl: () => 'https://fixture.invalid/g/html-native' },
  auth: { token: () => 'synthetic-token', userId: () => 'synthetic-user' } } as unknown as CellContract
afterEach(() => vi.unstubAllGlobals())

describe('native 8fa0318 → frontend exact text wire', () => {
  it.each(fixture.snapshots)('accepts actual $artifactId bytes and identity', async snapshot => {
    expect(fixture.nativeSource).toBe('8fa0318e64e4ddd5a86c42ef985ee8810ab3ca1c')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(snapshot))))
    expect(await fetchArtifactText(contract, snapshot.graphId, snapshot.artifactId)).toEqual(snapshot)
  })
})
