import { describe, expect, it } from 'vitest'
import { DEFAULT_WIRE_PREDICATE_URI, MNEMO_NS } from '@shrubbery/nucleus'
import {
  buildSceneLink,
  buildSceneLinkRecord,
  linkSceneElement,
  parseSceneLink,
  refreshSceneLinkTitles,
  sceneLinkRecordFromElement,
  sceneLinkTargetFromElement,
  unlinkSceneElement,
} from '../excalidraw-scene-links.js'
import {
  predicateForArrowLabel,
  projectSceneGraph,
  summarizeSceneProjection,
} from '../excalidraw-scene-projection.js'
import {
  applySceneWireHydration,
  missingSceneWireCandidates,
  missingSceneWireHydrations,
  sceneWireProvenanceFields,
  upsertSceneArrowPredicate,
} from '../excalidraw-scene-wires.js'

const supports = `${MNEMO_NS}supports`

function linkedRectangle(id: string, documentId: string, title: string, x: number) {
  return {
    id,
    type: 'rectangle',
    x,
    y: 20,
    width: 160,
    height: 80,
    link: buildSceneLink('document', 'graph-a', documentId),
    customData: { mnemosyne: buildSceneLinkRecord('document', 'graph-a', documentId, title) },
  }
}

function projectedScene() {
  return projectSceneGraph([
    linkedRectangle('shape-a', 'doc-a', 'Document A', 10),
    linkedRectangle('shape-b', 'doc-b', 'Document B', 330),
    {
      id: 'arrow-a',
      type: 'arrow',
      x: 170,
      y: 60,
      width: 160,
      height: 0,
      startBinding: { elementId: 'shape-a' },
      endBinding: { elementId: 'shape-b' },
      customData: { mnemosyneArrow: { predicate: supports } },
    },
  ], {
    graphId: 'graph-a',
    artifactId: 'scene-a',
    resolveLinkedNode: (target) => ({ exists: true, title: target.id === 'doc-a' ? 'Document A' : 'Document B' }),
  })
}

describe('Excalidraw scene links', () => {
  it('round-trips encoded graph/node ids and rejects malformed foreign links', () => {
    const link = buildSceneLink('document', 'graph with spaces', 'doc/with/slash')
    expect(link).toBe('mnemosyne://document/graph%20with%20spaces/doc%2Fwith%2Fslash')
    expect(parseSceneLink(link)).toEqual({ kind: 'document', graphId: 'graph with spaces', id: 'doc/with/slash' })
    expect(parseSceneLink('https://example.test/doc')).toBeNull()
    expect(parseSceneLink('mnemosyne://folder/g/id')).toBeNull()
    expect(parseSceneLink('mnemosyne://document/%E0%A4%A/id')).toBeNull()
  })

  it('links and unlinks one element while preserving unrelated custom data', () => {
    const elements = [{ id: 'a', type: 'rectangle', customData: { color: 'violet' } }, { id: 'b', type: 'ellipse' }]
    const linked = linkSceneElement(elements, 'a', buildSceneLinkRecord('artifact', 'graph-a', 'image-a', 'Image A'))
    expect(sceneLinkRecordFromElement(linked[0])).toEqual({
      kind: 'artifact', graphId: 'graph-a', id: 'image-a', title: 'Image A',
    })
    expect(sceneLinkTargetFromElement(linked[0])).toEqual({ kind: 'artifact', graphId: 'graph-a', id: 'image-a' })
    expect((linked[0].customData as Record<string, unknown>).color).toBe('violet')
    const unlinked = unlinkSceneElement(linked, 'a')
    expect(unlinked[0]).toMatchObject({ link: null, customData: { color: 'violet' } })
    expect(sceneLinkRecordFromElement(unlinked[0])).toBeNull()
  })

  it('refreshes canonical metadata and bound labels while reporting missing nodes', () => {
    const linked = linkSceneElement(
      [{ id: 'shape-a', type: 'rectangle' }, { id: 'label-a', type: 'text', containerId: 'shape-a', text: 'Old title' }],
      'shape-a',
      buildSceneLinkRecord('document', 'graph-a', 'doc-a', 'Old title'),
    )
    const refreshed = refreshSceneLinkTitles(linked, () => ({ exists: true, title: 'New title' }))
    expect(refreshed).toMatchObject({ updated: 1, missing: 0 })
    expect(sceneLinkRecordFromElement(refreshed.elements[0])?.title).toBe('New title')
    expect(refreshed.elements[1]).toMatchObject({ text: 'New title', originalText: 'New title' })
    expect(refreshSceneLinkTitles(linked, () => ({ exists: false }))).toMatchObject({ updated: 0, missing: 1 })
  })
})

describe('Excalidraw scene projection', () => {
  it('projects linked anchors and bound arrows into a deterministic semantic wire', () => {
    const projection = projectedScene()
    expect(projection.anchors).toHaveLength(2)
    expect(projection.arrows).toHaveLength(1)
    expect(projection.wireCandidates).toEqual([
      expect.objectContaining({
        sceneElementId: 'arrow-a',
        source: expect.objectContaining({ id: 'doc-a', wireDocumentId: 'doc-a' }),
        target: expect.objectContaining({ id: 'doc-b', wireDocumentId: 'doc-b' }),
        predicate: supports,
      }),
    ])
    expect(projection.diagnostics).toEqual([])
    expect(projection.wireCandidates[0].stableKey).toContain('arrow-a|document:graph-a:doc-a')
  })

  it('maps labels to known predicates and falls back to relatedTo', () => {
    expect(predicateForArrowLabel('supports')).toBe(supports)
    expect(predicateForArrowLabel('SUPPORTS!')).toBe(supports)
    expect(predicateForArrowLabel('unknown relation')).toBe(DEFAULT_WIRE_PREDICATE_URI)
    expect(predicateForArrowLabel(null)).toBe(DEFAULT_WIRE_PREDICATE_URI)
  })

  it('diagnoses malformed/missing links and unsupported artifact endpoints', () => {
    const projection = projectSceneGraph([
      { id: 'bad', type: 'rectangle', link: 'mnemosyne://document/broken' },
      {
        ...linkedRectangle('artifact', 'doc-a', 'Artifact', 0),
        link: buildSceneLink('artifact', 'graph-a', 'artifact-a'),
        customData: { mnemosyne: buildSceneLinkRecord('artifact', 'graph-a', 'artifact-a', 'Artifact') },
      },
      linkedRectangle('doc', 'doc-b', 'Doc B', 300),
      { id: 'arrow', type: 'arrow', startBinding: { elementId: 'artifact' }, endBinding: { elementId: 'doc' } },
    ], {
      graphId: 'graph-a',
      artifactId: 'scene-a',
      resolveLinkedNode: (target) => target.kind === 'artifact'
        ? { exists: true, title: 'Artifact', wireDocumentId: null }
        : { exists: false },
    })
    expect(projection.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'malformed-link',
      'link-target-missing',
      'wire-unsupported-endpoint',
    ]))
    expect(projection.wireCandidates).toEqual([])
  })

  it('emits a searchable, persistable compact summary', () => {
    const summary = summarizeSceneProjection(projectedScene(), new Date('2026-07-10T12:00:00Z'))
    expect(summary).toMatchObject({
      schemaVersion: 1,
      graphId: 'graph-a',
      artifactId: 'scene-a',
      projectedAt: '2026-07-10T12:00:00.000Z',
      counts: { anchors: 2, arrows: 1, wireCandidates: 1, diagnostics: 0 },
    })
    expect(summary.searchText).toContain('Anchor: Document A (document:doc-a)')
    expect(summary.searchText).toContain('Wire: doc-a supports doc-b')
  })
})

describe('Excalidraw scene wires', () => {
  it('deduplicates graph wires by normalized source/target/predicate signature', () => {
    const candidate = projectedScene().wireCandidates[0]
    expect(missingSceneWireCandidates([candidate], [])).toEqual([candidate])
    expect(missingSceneWireCandidates([candidate], [{
      source_document_id: 'doc-a',
      target_graph_id: 'graph-a',
      target_document_id: 'doc-b',
      predicate: supports,
    }])).toEqual([])
    expect(sceneWireProvenanceFields(candidate, { sceneGraphId: 'graph-a', sceneArtifactId: 'scene-a' })).toEqual({
      sceneGraphId: 'graph-a',
      sceneArtifactId: 'scene-a',
      sceneElementId: 'arrow-a',
      sceneSourceElementId: 'shape-a',
      sceneTargetElementId: 'shape-b',
      sceneStableKey: candidate.stableKey,
    })
  })

  it('hydrates a persisted scene wire into an arrow/label and updates bound anchors', () => {
    const baseElements = [
      linkedRectangle('shape-a', 'doc-a', 'Document A', 10),
      linkedRectangle('shape-b', 'doc-b', 'Document B', 330),
    ]
    const projection = projectSceneGraph(baseElements, {
      graphId: 'graph-a',
      artifactId: 'scene-a',
      resolveLinkedNode: (target) => ({ exists: true, title: target.id, wireDocumentId: target.id }),
    })
    const wires = [{
      id: 'wire-1',
      sourceDocumentId: 'doc-a',
      targetGraphId: 'graph-a',
      targetDocumentId: 'doc-b',
      predicate: supports,
      sceneGraphId: 'graph-a',
      sceneArtifactId: 'scene-a',
      sceneSourceElementId: 'shape-a',
      sceneTargetElementId: 'shape-b',
      sceneStableKey: 'stable-wire-1',
    }]
    const candidates = missingSceneWireHydrations(projection, wires, {
      sceneGraphId: 'graph-a', sceneArtifactId: 'scene-a',
    })
    expect(candidates).toHaveLength(1)
    const result = applySceneWireHydration(baseElements, projection, wires, {
      sceneGraphId: 'graph-a', sceneArtifactId: 'scene-a',
    })
    expect(result.hydrated).toHaveLength(1)
    const arrow = result.elements.find((item) => item.type === 'arrow')
    const label = result.elements.find((item) => item.type === 'text')
    expect(arrow).toMatchObject({
      id: candidates[0].arrowElementId,
      startBinding: { elementId: 'shape-a' },
      endBinding: { elementId: 'shape-b' },
      customData: { mnemosyneWire: { wireId: 'wire-1', predicate: supports } },
    })
    expect(label).toMatchObject({ text: 'supports', containerId: candidates[0].arrowElementId })
    expect(result.elements.find((item) => item.id === 'shape-a')?.boundElements).toContainEqual({
      id: candidates[0].arrowElementId, type: 'arrow',
    })
  })

  it('updates an arrow predicate and creates its bound text label when absent', () => {
    const elements = upsertSceneArrowPredicate([
      { id: 'arrow-a', type: 'arrow', x: 10, y: 20, width: 100, height: 0, points: [[0, 0], [100, 0]] },
    ], 'arrow-a', supports)
    expect(elements).toHaveLength(2)
    expect(elements[0]).toMatchObject({
      customData: { mnemosyneArrow: { predicate: supports, label: 'supports' } },
      boundElements: [expect.objectContaining({ type: 'text' })],
    })
    expect(elements[1]).toMatchObject({ type: 'text', text: 'supports', containerId: 'arrow-a' })
  })
})
