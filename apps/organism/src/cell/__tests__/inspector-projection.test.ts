import { describe, expect, it } from 'vitest'
import type { SelectedObject } from '@shrubbery/nucleus'
import type { WireBundle, WorkspaceComment } from '@shrubbery/runtime'
import {
  activeDocumentSelection,
  backlinkRowId,
  projectInspectorActions,
  projectInspectorModel,
} from '../inspector-projection.js'

const wireBundle: WireBundle = {
  outgoingWires: [
    {
      id: 'wire-out',
      predicate: 'http://mnemosyne.ai/vocab#supports',
      predicateLabel: 'supports',
      otherDocumentId: 'doc-target',
      otherGraphId: 'graph-a',
      otherTitle: 'Target document',
      localBlockId: 'block-a',
      bidirectional: false,
    },
  ],
  incomingWires: [
    {
      id: 'wire-in',
      predicate: 'http://mnemosyne.ai/vocab#references',
      predicateLabel: 'references',
      otherDocumentId: 'doc-source',
      otherGraphId: 'graph-a',
      otherTitle: 'Source document',
      localBlockId: 'block-a',
      bidirectional: true,
    },
  ],
  wiredBlockIds: ['block-a'],
}

const comments: readonly WorkspaceComment[] = [
  {
    id: 'comment-a',
    author: 'Vera',
    text: 'Needs a citation',
    quotedText: 'claim',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    resolved: false,
    blockId: 'block-a',
    documentPosition: 4,
  },
  {
    id: 'comment-b',
    author: 'Shrubbery',
    text: 'Resolved note',
    createdAt: 1700000000001,
    updatedAt: 1700000000001,
    resolved: true,
    blockId: 'block-b',
  },
]

describe('organism inspector projection', () => {
  it('projects the active document identity and loaded wire/comment relations', () => {
    const model = projectInspectorModel({
      selection: activeDocumentSelection('graph-a', 'doc-a'),
      graphId: 'graph-a',
      activeDocumentId: 'doc-a',
      activeDocumentTitle: 'Garden parity plan',
      wireBundle,
      comments,
    })

    expect(model?.identity).toMatchObject({
      kind: 'document',
      title: 'Garden parity plan',
      typeLabel: 'Document',
    })
    expect(model?.relations?.scope).toBe('active')
    expect(model?.relations?.groups?.map((group) => [group.key, group.items.length])).toEqual([
      ['wires', 1],
      ['backlinks', 1],
      ['comments', 2],
    ])
  })

  it('rolls block-level wires (a [[ link typed in a block) up into the document backlinks', () => {
    const blockWire = (id: string, localBlockId: string) => ({
      id,
      predicate: 'http://mnemosyne.ai/vocab#references',
      predicateLabel: 'references',
      otherDocumentId: `doc-${id}`,
      otherGraphId: 'graph-a',
      otherTitle: `Source ${id}`,
      localBlockId,
      bidirectional: false,
    })
    const bundle: WireBundle = {
      outgoingWires: [],
      incomingWires: [blockWire('in-1', 'block-a'), blockWire('in-2', 'block-b')],
      wiredBlockIds: ['block-a', 'block-b'],
    }
    const base = { graphId: 'graph-a', activeDocumentId: 'doc-a', wireBundle: bundle }
    const document = projectInspectorModel({ ...base, selection: activeDocumentSelection('graph-a', 'doc-a') })
    const backlinks = document?.relations?.groups?.find((group) => group.key === 'backlinks')
    expect(backlinks?.items.map((item) => item.id)).toEqual(['in-1', 'in-2'])
    const block = projectInspectorModel({
      ...base,
      selection: { kind: 'block', graphId: 'graph-a', documentId: 'doc-a', blockId: 'block-b' },
    })
    expect(block?.relations?.groups?.find((group) => group.key === 'backlinks')?.items.map((item) => item.id)).toEqual(['in-2'])
  })

  it('filters active block relations to the selected block', () => {
    const selection: SelectedObject = {
      kind: 'block',
      graphId: 'graph-a',
      documentId: 'doc-a',
      blockId: 'block-a',
    }
    const model = projectInspectorModel({
      selection,
      graphId: 'graph-a',
      activeDocumentId: 'doc-a',
      activeDocumentTitle: 'Garden parity plan',
      wireBundle,
      comments,
    })

    expect(model?.identity.title).toBe('Block in Garden parity plan')
    expect(model?.relations?.groups?.map((group) => [group.key, group.items.map((item) => item.id)])).toEqual([
      ['wires', ['wire-out']],
      ['backlinks', ['wire-in']],
      ['comments', ['comment-a']],
    ])
  })

  it('projects comment identity and comment actions from loaded Y.Map metadata', () => {
    const selection: SelectedObject = {
      kind: 'comment',
      graphId: 'graph-a',
      documentId: 'doc-a',
      commentId: 'comment-a',
      blockId: 'block-a',
    }
    const input = {
      selection,
      graphId: 'graph-a',
      activeDocumentId: 'doc-a',
      activeDocumentTitle: 'Garden parity plan',
      wireBundle,
      comments,
    }

    expect(projectInspectorModel(input)?.identity).toMatchObject({
      kind: 'comment',
      title: 'Needs a citation',
      typeLabel: 'Comment by Vera',
    })
    expect(projectInspectorActions(input).map((action) => {
      if ('id' in action) return action.id
      return action.type === 'header' ? action.content : 'divider'
    })).toEqual([
      'Comment',
      'comment.resolve',
      'comment.delete',
    ])
  })

  it('marks relations inactive when the selected object is outside the loaded document', () => {
    const model = projectInspectorModel({
      selection: {
        kind: 'document',
        graphId: 'graph-a',
        documentId: 'doc-other',
      },
      graphId: 'graph-a',
      activeDocumentId: 'doc-a',
      activeDocumentTitle: 'Garden parity plan',
      wireBundle,
      comments,
    })

    expect(model?.identity.title).toBe('doc-other')
    expect(model?.relations).toEqual({ scope: 'inactive', groups: [] })
  })

  it('projects folder and artifact selections as first-class inspector identities', () => {
    const folder = projectInspectorModel({
      selection: {
        kind: 'folder',
        graphId: 'graph-a',
        folderId: 'folder-a',
        label: 'Research',
      },
      graphId: 'graph-a',
      activeDocumentId: null,
    })
    expect(folder?.identity).toMatchObject({
      kind: 'folder',
      icon: 'folder',
      title: 'Research',
      typeLabel: 'Folder',
    })

    const artifact = projectInspectorModel({
      selection: {
        kind: 'artifact',
        graphId: 'graph-a',
        artifactId: 'artifact-a',
        label: 'Sketch.png',
        mimeType: 'image/png',
        status: 'ready',
      },
      graphId: 'graph-a',
      activeDocumentId: null,
    })
    expect(artifact?.identity).toMatchObject({
      kind: 'artifact',
      icon: 'diamond',
      title: 'Sketch.png',
      typeLabel: 'Artifact',
    })
    expect(artifact?.identity.chips?.map((chip) => [chip.label, chip.value])).toContainEqual(['MIME', 'image/png'])
  })
})

describe('the inspector for a board', () => {
  const rows = [
    { kind: 'wire' as const, sourceDocumentId: 'doc-notes', sourceTitle: 'Notes on dreams', sourceKind: 'document', predicate: 'supports', wireId: 'wire-1' },
    { kind: 'board-card' as const, sourceDocumentId: 'wb-board', sourceTitle: 'Dream-work board', sourceKind: 'whiteboard', sourceBlockId: 'crd0000000000000000001' },
  ]

  it('the_inspector_lists_linked_from_for_a_board', () => {
    const model = projectInspectorModel({
      selection: activeDocumentSelection('wb-graph', 'wb-other'),
      graphId: 'wb-graph',
      activeDocumentId: 'wb-other',
      activeDocumentTitle: 'Another board',
      activeDocumentKind: 'whiteboard',
      backlinks: rows,
    })

    expect(model?.identity).toMatchObject({ kind: 'document', title: 'Another board', typeLabel: 'Whiteboard' })
    const linkedFrom = model?.relations?.groups?.find((group) => group.key === 'linked-from')
    expect(linkedFrom?.label).toBe('Linked from')
    // Boards first, then the rest, each with a kind a person can read and an id the shell can find the row by.
    expect(linkedFrom?.items.map((item) => [item.primary, item.secondary])).toEqual([
      ['Dream-work board', 'Card on a board'],
      ['Notes on dreams', 'Wire - supports'],
    ])
    expect(linkedFrom?.items.map((item) => item.id)).toEqual(rows.slice().reverse().map(backlinkRowId))
    // A text document without backlinks has no such group.
    const plain = projectInspectorModel({ selection: activeDocumentSelection('wb-graph', 'doc-a'), graphId: 'wb-graph', activeDocumentId: 'doc-a' })
    expect(plain?.relations?.groups?.some((group) => group.key === 'linked-from')).toBe(false)
  })

  it('names the board a wire was drawn on, and an object end as an object', () => {
    const bundle: WireBundle = {
      outgoingWires: [{
        id: 'wire-wb-0001', predicate: 'supports', predicateLabel: 'supports', otherDocumentId: '', otherGraphId: 'wb-graph',
        otherTitle: 'The Wolf Man dream', bidirectional: false,
        otherIri: 'urn:mnemosyne:local:graph:wb-graph:dream:wolf-man', sceneDocumentId: 'wb-board',
      } as WireBundle['outgoingWires'][number]],
      incomingWires: [],
      wiredBlockIds: [],
    }
    const model = projectInspectorModel({
      selection: activeDocumentSelection('wb-graph', 'doc-traumdeutung'),
      graphId: 'wb-graph',
      activeDocumentId: 'doc-traumdeutung',
      wireBundle: bundle,
      titleOf: (id) => (id === 'wb-board' ? 'Dream-work board' : undefined),
    })
    const wires = model?.relations?.groups?.find((group) => group.key === 'wires')
    expect(wires?.items[0]).toMatchObject({ primary: 'supports -> The Wolf Man dream', icon: 'diamond' })
    expect(wires?.items[0]?.secondary).toContain('from board Dream-work board')
    const drawnOn = model?.relations?.groups?.find((group) => group.key === 'drawn-on')
    expect(drawnOn?.items.map((item) => [item.id, item.primary])).toEqual([['board:wb-board', 'Dream-work board']])
  })
})
