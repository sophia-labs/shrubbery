import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseNT, type Triple } from '@shrubbery/nucleus'
import { describe, expect, it } from 'vitest'
import {
  checkManifestProjection,
  manifestFromTriples,
  manifestToNt,
  manifestToProjectionRecords,
  manifestToTriples,
  parseCapabilityManifest,
} from '../src/manifest.js'

const gardenManifestPath = fileURLToPath(
  new URL('../../../docs/acceptance/garden-capability-manifest.json', import.meta.url),
)

describe('Domain Kit capability-manifest codec', () => {
  it('round-trips the real 80-claim Garden acceptance manifest through deterministic RDF', async () => {
    const source = JSON.parse(await readFile(gardenManifestPath, 'utf8'))
    const manifest = parseCapabilityManifest(source)
    const first = manifestToNt(manifest)
    const second = manifestToNt(manifest)
    const recovered = manifestFromTriples(parseNT(first))

    expect(manifest.capabilities).toHaveLength(80)
    expect(manifest.journeys).toHaveLength(38)
    expect(recovered).toEqual(manifest)
    expect(second).toBe(first)
    expect(first).toContain('<http://sophia.ai/domain#declaresEvidence>')

    const records = manifestToProjectionRecords(manifest)
    expect(records.filter((record) => record.kind === 'CapabilityClaim')).toHaveLength(80)
    expect(records.filter((record) => record.kind === 'Journey')).toHaveLength(38)
    expect(records[0]).toMatchObject({
      kind: 'DomainManifest',
      localId: 'urn:sophia:domain:shrubbery-garden-fidelity:manifest',
      contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it('checks graph currency while ignoring unrelated graph data', async () => {
    const manifest = parseCapabilityManifest(JSON.parse(await readFile(gardenManifestPath, 'utf8')))
    const projection = manifestToTriples(manifest)
    const unrelated: Triple = { s: 'urn:unrelated', p: 'urn:predicate', o: { type: 'literal', value: 'kept' } }
    expect(checkManifestProjection(manifest, [...projection, unrelated])).toMatchObject({ ok: true, missing: [], stale: [] })

    const stale: Triple = {
      s: projection[0].s,
      p: 'http://sophia.ai/domain#staleField',
      o: { type: 'literal', value: 'old' },
    }
    const check = checkManifestProjection(manifest, [...projection.slice(1), stale])
    expect(check.ok).toBe(false)
    expect(check.missing).toHaveLength(1)
    expect(check.stale).toHaveLength(1)
  })

  it('refuses dangling journey references before projection', async () => {
    const source = JSON.parse(await readFile(gardenManifestPath, 'utf8'))
    source.capabilities[0].journeys = ['ACC-J-does-not-exist']
    expect(() => parseCapabilityManifest(source)).toThrow(/references unknown id/)
  })
})
