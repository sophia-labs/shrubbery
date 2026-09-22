/**
 * fragment-face-set-closure.test.ts — WS1 §9 S3, master spec §3 Slice 2.
 * `card.object`, `compute.cell`, and `agent.session-family` are members of the closed fragment face
 * catalogue: `fragmentFaceIds()` names them, the validation registry accepts a real
 * `card.object` descriptor and rejects one with a non-object `subjectIri`,
 * and the closed-params discipline (§6.7 — `closedParamsSchema`, never
 * `sealedOpenFaceParamsSchema`) is unaffected.
 */
import { describe, expect, it } from 'vitest'
import { createFragmentFaceRegistry, fragmentFaceIds } from '../fragment-face-set.js'
import { listSealedOpenFaceParamsUsages } from '../types.js'

describe('fragmentFaceIds — the closed fragment face catalogue', () => {
  it('contains exactly the ten expected ids, including compute.cell and agent.session-family', () => {
    expect(new Set(fragmentFaceIds())).toEqual(
      new Set([
        'stat.scalar',
        'chart.vega-lite',
        'card.subject',
        'sparql.bindings-table',
        'sophia.home',
        'obs.evidence-chain',
        'card.object',
        'obs.filmstrip',
        'compute.cell',
        'agent.session-family',
      ]),
    )
  })
})

describe('createFragmentFaceRegistry — validates real card.object descriptors', () => {
  it('accepts a card.object descriptor addressing a real object URN', () => {
    const registry = createFragmentFaceRegistry()
    const verdict = registry.validate({
      schemaVersion: 1,
      faceId: 'card.object',
      resource: { kind: 'graph', graphId: 'g1', subjectIri: 'urn:sophia:object:koch-morse:Bookmark:abc' },
    })
    expect(verdict.ok).toBe(true)
  })

  it('accepts the empty-selection card.object descriptor (no subjectIri)', () => {
    const registry = createFragmentFaceRegistry()
    const verdict = registry.validate({
      schemaVersion: 1,
      faceId: 'card.object',
      resource: { kind: 'graph', graphId: 'g1' },
    })
    expect(verdict.ok).toBe(true)
  })

  it('rejects a card.object descriptor whose subjectIri is NOT an object URN', () => {
    const registry = createFragmentFaceRegistry()
    const verdict = registry.validate({
      schemaVersion: 1,
      faceId: 'card.object',
      resource: { kind: 'graph', graphId: 'g1', subjectIri: 'urn:mnemosyne:local:graph:g1:projection:bookmark:bookmark:abc' },
    })
    expect(verdict.ok).toBe(false)
  })
})

describe('closed-params discipline — card.object uses closedParamsSchema, never the open escape hatch', () => {
  it('listSealedOpenFaceParamsUsages() stays at length 0 after registering the fragment face set', () => {
    createFragmentFaceRegistry()
    expect(listSealedOpenFaceParamsUsages()).toHaveLength(0)
  })
})
