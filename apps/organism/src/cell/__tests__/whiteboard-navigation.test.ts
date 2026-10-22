import { artifactLink, documentLink, objectLink, type WbBacklink } from '@shrubbery/runtime'
import { describe, expect, it } from 'vitest'
import { projectShellWireBundle } from '../public-shell.js'
import {
  openingOfBacklink,
  predicateSeedFromLabel,
  readAppliedWires,
  routeWhiteboardLink,
  surfaceForDocumentKind,
  usedInWithBoards,
  wireBoardProvenance,
  wireEndOf,
} from '../whiteboard-navigation.js'

// The v2 fixture's world: graph `wb-graph`, board `wb-board`, a text document and a typed object.
const GRAPH = 'wb-graph'
const WOLF_MAN = 'urn:mnemosyne:local:graph:wb-graph:dream:wolf-man'

describe('whiteboard navigation', () => {
  it('a_link_to_a_board_opens_the_board', () => {
    // The link says only "a document"; the document's kind decides the surface.
    const route = routeWhiteboardLink(GRAPH, documentLink(GRAPH, 'wb-board'))
    expect(route).toEqual({ kind: 'document', graphId: GRAPH, documentId: 'wb-board' })
    expect(surfaceForDocumentKind('whiteboard')).toBe('board')
    // Every door a board can come through names the same surface: a backlink row, by its kind or by the sidebar's.
    const row: WbBacklink = { kind: 'board-card', sourceDocumentId: 'wb-board', sourceKind: 'whiteboard', sourceBlockId: 'crd0000000000000000001' }
    expect(openingOfBacklink(row)).toEqual({ documentId: 'wb-board', blockId: null, surface: 'board' })
    const unlabelled: WbBacklink = { kind: 'link', sourceDocumentId: 'wb-board' }
    expect(openingOfBacklink(unlabelled, (id) => (id === 'wb-board' ? 'whiteboard' : undefined)).surface).toBe('board')
  })

  it('a_document_link_routes_by_document_kind', () => {
    expect(surfaceForDocumentKind('whiteboard')).toBe('board')
    expect(surfaceForDocumentKind(undefined)).toBe('editor')
    expect(surfaceForDocumentKind(null)).toBe('editor')
    expect(surfaceForDocumentKind('daily-note')).toBe('editor')
    expect(surfaceForDocumentKind('workflow')).toBe('editor')
    // A text document keeps its block: the editor focuses it.
    const row: WbBacklink = { kind: 'embed', sourceDocumentId: 'doc-traumdeutung', sourceKind: 'document', sourceBlockId: 'blk-7' }
    expect(openingOfBacklink(row)).toEqual({ documentId: 'doc-traumdeutung', blockId: 'blk-7', surface: 'editor' })
    // The same link in another graph keeps its graph.
    expect(routeWhiteboardLink(GRAPH, documentLink('elsewhere', 'doc-x'))).toEqual({ kind: 'document', graphId: 'elsewhere', documentId: 'doc-x' })
  })

  it('an_object_link_opens_the_object_page', () => {
    expect(routeWhiteboardLink(GRAPH, objectLink(GRAPH, WOLF_MAN))).toEqual({ kind: 'object', graphId: GRAPH, iri: WOLF_MAN })
    // A bare IRI (a link from before mnemosyne:// links) is an object of this graph.
    expect(routeWhiteboardLink(GRAPH, WOLF_MAN)).toEqual({ kind: 'object', graphId: GRAPH, iri: WOLF_MAN })
  })

  it('an_artifact_link_opens_the_artifact', () => {
    expect(routeWhiteboardLink(GRAPH, artifactLink(GRAPH, 'art-scan-1'))).toEqual({ kind: 'artifact', graphId: GRAPH, artifactId: 'art-scan-1' })
  })

  it('a_web_address_is_left_to_the_canvas', () => {
    expect(routeWhiteboardLink(GRAPH, 'https://example.org/dreams')).toEqual({ kind: 'web', href: 'https://example.org/dreams' })
    expect(routeWhiteboardLink(GRAPH, 'mailto:freud@example.org')).toEqual({ kind: 'web', href: 'mailto:freud@example.org' })
    // A mnemosyne link that names nothing is not a web address and not a target.
    expect(routeWhiteboardLink(GRAPH, 'mnemosyne://document/wb-graph')).toEqual({ kind: 'none' })
    expect(routeWhiteboardLink(GRAPH, '')).toEqual({ kind: 'none' })
  })

  it('"Used in" lists the boards that hold an object next to the documents that embed it', () => {
    const rows: WbBacklink[] = [
      { kind: 'embed', sourceDocumentId: 'doc-notes', sourceKind: 'document' },
      { kind: 'board-card', sourceDocumentId: 'wb-board', sourceTitle: 'Dream-work board', sourceKind: 'whiteboard' },
      { kind: 'board-connection', sourceDocumentId: 'wb-board', sourceKind: 'whiteboard' },
      { kind: 'board-link', sourceDocumentId: 'wb-two', sourceKind: 'whiteboard' },
    ]
    const used = usedInWithBoards([{ documentId: 'doc-notes', title: 'Notes' }], rows, (id) => (id === 'wb-two' ? 'Second board' : undefined))
    expect(used.map((usage) => [usage.documentId, usage.title])).toEqual([
      ['doc-notes', 'Notes'],
      ['wb-board', 'Dream-work board'],
      ['wb-two', 'Second board'],
    ])
  })

  it('the object page lists a document wired to the object once', () => {
    const rows: WbBacklink[] = [
      { kind: 'wire', sourceDocumentId: 'doc-notes', predicate: 'supports', wireId: 'wire-wb-0001' },
      { kind: 'wire', sourceDocumentId: 'doc-other', predicate: 'supports', wireId: 'wire-wb-0002' },
      { kind: 'link', sourceDocumentId: 'doc-link' },
    ]
    const used = usedInWithBoards([{ documentId: 'doc-notes', title: 'Notes' }], rows, (id) => (id === 'doc-other' ? 'Other' : undefined))
    expect(used.map((usage) => [usage.documentId, usage.title])).toEqual([['doc-notes', 'Notes'], ['doc-other', 'Other']])
  })

  it('reads what whiteboard_apply made, and the cell\'s own words when it refused', () => {
    const wire = { arrowId: 'arw0000000000000000002', wireId: 'wire-wb-0001', predicate: 'supports' }
    const bare = readAppliedWires({ created: [], wires: [wire] })
    expect(bare).toEqual({ wires: [wire], error: null })
    const wrapped = readAppliedWires({ content: [{ type: 'text', text: JSON.stringify({ wires: [wire] }) }] })
    expect(wrapped.wires).toEqual([wire])
    const refused = readAppliedWires({ isError: true, content: [{ type: 'text', text: 'wire: that arrow is not bound at both ends' }] })
    expect(refused).toEqual({ wires: [], error: 'wire: that arrow is not bound at both ends' })
  })

  it('a_wire_with_an_iri_end_reads_as_an_object_and_a_board_provenance', () => {
    const wires = projectShellWireBundle({
      outgoing_wires: [
        {
          id: 'wire-wb-0001',
          predicate: 'supports',
          predicate_label: 'supports',
          other_document_id: '',
          other_iri: WOLF_MAN,
          other_graph_id: GRAPH,
          other_title: 'The Wolf Man dream',
          local_block_id: null,
          scene_document_id: 'wb-board',
          scene_element_id: 'arw0000000000000000002',
        },
        // A wire naming neither a document nor an object names nothing.
        { id: 'wire-empty', predicate_label: 'related', other_document_id: '' },
        {
          id: 'wire-plain',
          predicate_label: 'cites',
          other_document_id: 'urn:mnemosyne:user:u1:graph:g:doc:doc-notes',
          other_title: 'Notes',
        },
      ],
      incoming_wires: [],
    })

    expect(wires.outgoing.map((wire) => wire.id)).toEqual(['wire-wb-0001', 'wire-plain'])
    const [object, plain] = wires.outgoing
    expect(object).toMatchObject({
      otherDocumentId: '',
      otherIri: WOLF_MAN,
      otherTitle: 'The Wolf Man dream',
      sceneDocumentId: 'wb-board',
      sceneElementId: 'arw0000000000000000002',
    })
    // The object's IRI is kept whole, never read as an entity id.
    expect(wireEndOf(object!)).toEqual({ kind: 'object', iri: WOLF_MAN, label: 'The Wolf Man dream' })
    expect(wireBoardProvenance(object!, (id) => (id === 'wb-board' ? 'Dream-work board' : undefined)))
      .toEqual({ boardId: 'wb-board', boardTitle: 'Dream-work board', label: 'from board Dream-work board' })
    // A document end is as it always was, and drawn on no board.
    expect(plain).toMatchObject({ otherDocumentId: 'doc-notes', otherIri: null, sceneDocumentId: null })
    expect(wireEndOf(plain!)).toEqual({ kind: 'document', documentId: 'doc-notes', blockId: null, label: 'Notes' })
    expect(wireBoardProvenance(plain!, () => 'x')).toBeNull()
    // An object with no title is named by the tail of its IRI.
    expect(wireEndOf({ otherDocumentId: '', otherIri: WOLF_MAN })).toEqual({ kind: 'object', iri: WOLF_MAN, label: 'wolf-man' })
  })

  it('seeds the predicate menu only from a label that is already a valid predicate name', () => {
    expect(predicateSeedFromLabel('supports')).toBe('supports')
    expect(predicateSeedFromLabel('  condenses_into ')).toBe('condenses_into')
    // prose is not a predicate: "condenses into" would reach gardend as an unprojectable IRI
    expect(predicateSeedFromLabel('condenses into')).toBeNull()
    expect(predicateSeedFromLabel('a/b')).toBeNull()
    expect(predicateSeedFromLabel('')).toBeNull()
    expect(predicateSeedFromLabel(undefined)).toBeNull()
  })
})
