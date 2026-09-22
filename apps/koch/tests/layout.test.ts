import { describe, expect, it } from 'vitest'
import { KOCH_FACE_CATALOGUE } from '../src/faces.js'
import { KOCH_FACE_IDS } from '../src/face-ids.js'
import {
  buildDefaultKochLayout,
  kochLayoutQuery,
  layoutPersistUpdate,
  upgradeDefaultKochLayout,
  validateKochLayout,
} from '../src/layout.js'
import { courseIri, learnerIri } from '../src/vocabulary.js'

describe('Koch Resource × Face surface', () => {
  it('is a data-only, user-scoped reflow grid over a sealed face set', () => {
    const document = buildDefaultKochLayout('koch-test', '2026-07-20T00:00:00.000Z', 'user-1')
    expect(document.scope).toBe('user')
    expect(document.graphId).toBe('koch-test')
    const root = document.nodes[document.rootNodeId]
    expect(root?.kind).toBe('grid')
    if (root?.kind !== 'grid' || root.children.kind !== 'fixed') throw new Error('expected fixed grid')
    expect(root.children.cells.map((cell) => cell.descriptor.faceId)).toEqual([
      KOCH_FACE_IDS.practice,
      KOCH_FACE_IDS.curriculum,
      KOCH_FACE_IDS.progress,
    ])
    expect(root.children.cells[0]?.span).toBe(2)
    expect(root.children.cells[0]?.descriptor.resource).toEqual({
      kind: 'iri',
      iri: learnerIri('koch-test', 'user-1'),
    })
    expect(root.children.cells[1]?.descriptor.resource).toEqual({
      kind: 'iri',
      iri: courseIri('koch-test'),
    })
    expect(root.children.cells[2]?.descriptor.resource).toEqual({
      kind: 'iri',
      iri: learnerIri('koch-test', 'user-1'),
    })
    expect(JSON.stringify(document)).not.toMatch(/onClick|function|callback/i)
    expect(validateKochLayout(document).ok).toBe(true)
    for (const cell of root.children.cells) {
      const face = KOCH_FACE_CATALOGUE.find((candidate) => candidate.faceId === cell.descriptor.faceId)
      expect(face, `missing face registration for ${cell.descriptor.faceId}`).toBeDefined()
      expect(
        face?.accepts(cell.descriptor.resource),
        `${cell.descriptor.faceId} rejected its default Meaningful Object resource`,
      ).toBe(true)
    }
  })

  it('rejects an unregistered face and persists layoutJson only in ux config', () => {
    const document = buildDefaultKochLayout('koch-test')
    const root = document.nodes[document.rootNodeId]
    if (root?.kind !== 'grid' || root.children.kind !== 'fixed') throw new Error('expected fixed grid')
    const invalid = structuredClone(document)
    const invalidRoot = invalid.nodes[invalid.rootNodeId]
    if (invalidRoot?.kind !== 'grid' || invalidRoot.children.kind !== 'fixed') throw new Error('expected fixed grid')
    ;(invalidRoot.children.cells[0].descriptor as { faceId: string }).faceId = 'arbitrary.executable-face'
    expect(validateKochLayout(invalid).ok).toBe(false)

    const update = layoutPersistUpdate('koch-test', document, 'user-1')
    expect(update).toContain('urn:mnemosyne:local:graph:koch-test:ux:config')
    expect(update).toContain('http://mnemosyne.dev/ux#layoutJson')
    expect(update).toContain(':surface:koch-practice:user:user-1>')
    expect(kochLayoutQuery('koch-test', 'user-1')).toContain('LIMIT 2')
  })

  it('upgrades only the exact v1 seed and preserves graph-authored variations', () => {
    const seed = JSON.parse(JSON.stringify(buildDefaultKochLayout('koch-test'))) as any
    seed.layoutId = 'koch-practice-surface-v1'
    seed.scope = 'workspace'
    seed.nodes[seed.rootNodeId].minCellWidth = 360
    delete seed.nodes[seed.rootNodeId].children.cells[0].span

    const upgraded = upgradeDefaultKochLayout(seed, 'koch-test', '2026-07-20T01:00:00.000Z')
    expect(upgraded.upgraded).toBe(true)
    expect(upgraded.document.layoutId).toBe('koch-practice-surface-v3')
    expect(upgraded.document.scope).toBe('user')
    const upgradedRoot = upgraded.document.nodes[upgraded.document.rootNodeId]
    expect(upgradedRoot?.kind === 'grid' && upgradedRoot.children.kind === 'fixed'
      ? upgradedRoot.children.cells[0]?.span
      : undefined).toBe(2)

    seed.nodes[seed.rootNodeId].gridRevision = 1
    expect(upgradeDefaultKochLayout(seed, 'koch-test').upgraded).toBe(false)
  })
})
