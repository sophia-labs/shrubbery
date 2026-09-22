/**
 * edge-overlay test — the PURE `config.edges → MnRelation[]` overlay projection.
 *
 * NO MOCKS: the projection is a pure function driven by REAL inputs — the REAL
 * GARDEN_DEFAULT edge list and hand-written `SelectedObject` values (real objects,
 * not vi.fn). It asserts the overlay renders the SAME edge set the interpreter
 * installs behavior from (the "one model, two consumers" split), that face IRIs
 * become human endpoints, and that a live selection annotates its source edge.
 */

import { describe, it, expect } from 'vitest'
import { GARDEN_DEFAULT, type SelectedObject } from '@shrubbery/nucleus'
import { faceLabel, activeSourceFace, configEdgesToRelations } from './edge-overlay.js'

describe('faceLabel', () => {
  it('strips the face: id-space prefix and title-cases the remainder', () => {
    expect(faceLabel('face:comments')).toBe('Comments')
    expect(faceLabel('face:inspector')).toBe('Inspector')
  })

  it('falls back to the raw value when there is no face: prefix or remainder', () => {
    expect(faceLabel('editor')).toBe('Editor')
    expect(faceLabel('face:')).toBe('face:')
  })
})

describe('activeSourceFace', () => {
  it('recovers the source face from the selection discriminant', () => {
    const comment: SelectedObject = { kind: 'comment', commentId: 'c1' }
    const block: SelectedObject = { kind: 'block', graphId: 'g', documentId: 'd', blockId: 'b' }
    const folder: SelectedObject = { kind: 'folder', graphId: 'g', folderId: 'f', label: 'F', parentId: null, section: 'documents' }
    expect(activeSourceFace(comment)).toBe('face:comments')
    expect(activeSourceFace(block)).toBe('face:graph')
    // A folder pick flows from the sidebar face (the sidebar folder drivesSelection edge).
    expect(activeSourceFace(folder)).toBe('face:sidebar')
  })

  it('lights no edge for a cleared or unmapped selection', () => {
    expect(activeSourceFace(null)).toBeNull()
    expect(activeSourceFace({ kind: 'artifact', artifactId: 'a' } as SelectedObject)).toBeNull()
  })
})

describe('configEdgesToRelations', () => {
  it('projects the REAL GARDEN_DEFAULT edges into labelled directed relations', () => {
    // The overlay and the interpreter read the SAME config.edges — this is the
    // diagram half of that single source.
    expect(configEdgesToRelations(GARDEN_DEFAULT.edges)).toEqual([
      { from: 'Comments', to: 'Inspector', predicate: 'drivesSelection', kind: 'predicate' },
      { from: 'Graph', to: 'Editor', predicate: 'reveals', kind: 'predicate' },
      { from: 'Comments', to: 'Editor', predicate: 'reveals', kind: 'predicate' },
      { from: 'Graph', to: 'Editor', predicate: 'navigatesTo', kind: 'predicate' },
      { from: 'Sidebar', to: 'Editor', predicate: 'navigatesTo', kind: 'predicate' },
      { from: 'Sidebar', to: 'Inspector', predicate: 'drivesSelection', kind: 'predicate' },
    ])
  })

  it('projects undefined edges to an empty list (the overlay shows its own empty state)', () => {
    expect(configEdgesToRelations(undefined)).toEqual([])
  })

  it('annotates every edge whose source face produced the live selection', () => {
    // A comment pick fired through the comments face — both comments-sourced edges
    // (→inspector, →editor) light; the graph/sidebar edges stay un-annotated.
    const relations = configEdgesToRelations(GARDEN_DEFAULT.edges, { kind: 'comment', commentId: 'c1' })
    expect(relations.map((r) => r.note)).toEqual([
      'last selection fired through this edge',
      undefined,
      'last selection fired through this edge',
      undefined,
      undefined,
      undefined,
    ])
  })

  it('a folder pick annotates the sidebar-sourced edges (drivesSelection currency only)', () => {
    // A sidebar folder pick publishes a SelectedFolder → face:sidebar. Both
    // sidebar-sourced edges light. The sidebar→editor navigatesTo edge lights too
    // because activeSourceFace keys on the SOURCE face, not the predicate — the
    // overlay shows which face the last selection came through, not which behavior.
    const folder: SelectedObject = {
      kind: 'folder', graphId: 'g', folderId: 'f', label: 'F', parentId: null, section: 'documents',
    }
    const relations = configEdgesToRelations(GARDEN_DEFAULT.edges, folder)
    expect(relations.map((r) => r.note)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      'last selection fired through this edge',
      'last selection fired through this edge',
    ])
  })

  it('leaves the diagram un-annotated when the selection maps to no source edge', () => {
    const relations = configEdgesToRelations(GARDEN_DEFAULT.edges, null)
    expect(relations.every((r) => r.note === undefined)).toBe(true)
  })
})
