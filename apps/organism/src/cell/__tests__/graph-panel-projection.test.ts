// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import type { GraphPanelEdge, GraphPanelNode, SidebarNode, SidebarSection, WireBundle } from '@shrubbery/runtime'
import {
  addGraphPanelDocumentNode,
  addGraphPanelEdge,
  graphPanelNodeIdForSidebarNode,
  projectDocumentGraph,
  projectSidebarNodeToGraphPanel,
  pushNodeHistory,
  upsertGraphPanelNode,
} from '../graph-panel-projection.js'

function block(markup: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = markup
  return host.firstElementChild as HTMLElement
}

afterEach(() => { document.body.innerHTML = '' })

describe('projectDocumentGraph', () => {
  it('projects real editor DOM order, flat-list depth, footnotes, and root flow', () => {
    const projection = projectDocumentGraph({
      graphId: 'g',
      documentId: 'doc',
      blocks: [
        block('<h2 data-block-id="h">A heading</h2>'),
        block('<p data-block-id="p">A paragraph <span class="footnote-ref" data-footnote-content="Source note"></span></p>'),
        block('<li data-block-id="l1" data-list-type="bullet" data-indent="0">First</li>'),
        block('<li data-block-id="l2" data-list-type="task" data-indent="1" data-checked="true">Nested</li>'),
      ],
    })

    expect(projection.nodes.map((node) => [node.id, node.kind])).toEqual([
      ['h', 'heading'],
      ['p', 'paragraph'],
      ['p:footnote:0', 'footnote'],
      ['l1', 'bullet'],
      ['l2', 'task'],
    ])
    expect(projection.nodes.find((node) => node.id === 'l2')).toMatchObject({
      parentId: 'l1',
      depth: 1,
      checked: true,
    })
    expect(projection.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'h', to: 'p', predicate: 'precedes' }),
      expect.objectContaining({ from: 'p', to: 'p:footnote:0', predicate: 'contains' }),
      expect.objectContaining({ from: 'l1', to: 'l2', predicate: 'contains' }),
    ]))
  })

  it('keeps same-document block wires internal and projects cross-document endpoints as portals', () => {
    const wires: WireBundle = {
      wiredBlockIds: ['a', 'b'],
      outgoingWires: [{
        id: 'internal',
        predicate: 'http://mnemosyne.ai/vocab#supports',
        predicateLabel: 'supports',
        otherDocumentId: 'doc',
        otherGraphId: 'g',
        localBlockId: 'a',
        otherBlockId: 'b',
        bidirectional: false,
      }, {
        id: 'external',
        predicate: 'http://mnemosyne.ai/vocab#relatedTo',
        predicateLabel: 'related to',
        otherDocumentId: 'other',
        otherGraphId: 'g2',
        localBlockId: 'b',
        otherTitle: 'Other document',
        otherSnippet: 'A remembered passage',
        bidirectional: true,
      }],
      incomingWires: [],
    }
    const projection = projectDocumentGraph({
      graphId: 'g',
      documentId: 'doc',
      blocks: [
        block('<p data-block-id="a">Alpha</p>'),
        block('<p data-block-id="b">Beta</p>'),
      ],
      wires,
    })

    expect(projection.nodes.some((node) => node.id.includes('internal') && node.kind === 'portal')).toBe(false)
    expect(projection.edges).toContainEqual(expect.objectContaining({
      id: 'wire:outgoing:internal',
      from: 'a',
      to: 'b',
      predicateLabel: 'supports',
    }))
    expect(projection.nodes).toContainEqual(expect.objectContaining({
      id: 'portal:outgoing:external',
      kind: 'portal',
      parentId: 'b',
      documentId: 'other',
      graphId: 'g2',
      snippet: 'A remembered passage',
    }))
    expect(projection.edges).toContainEqual(expect.objectContaining({
      from: 'b',
      to: 'portal:outgoing:external',
      bidirectional: true,
    }))
  })
})

describe('workspace graph projection', () => {
  const section: SidebarSection = { id: 'documents', label: 'Documents' }

  it('ids sidebar nodes by kind and treats the active graph as local documents', () => {
    const artifact: SidebarNode = { id: 'a1', label: 'Art', kind: 'artifact' }
    const folder: SidebarNode = { id: 'f1', label: 'Fold', kind: 'folder' }
    const tag: SidebarNode = { id: 'tag:idea', label: 'idea', kind: 'tag' }
    const doc: SidebarNode = { id: 'd1', label: 'Doc' }
    expect(graphPanelNodeIdForSidebarNode(section, artifact, 'g')).toBe('artifact:a1')
    expect(graphPanelNodeIdForSidebarNode(section, folder, 'g')).toBe('folder:documents:f1')
    expect(graphPanelNodeIdForSidebarNode(section, tag, 'g')).toBe('tag:idea')
    // A plain (documentish) node in the active graph gets the local doc id.
    expect(graphPanelNodeIdForSidebarNode(section, doc, 'g')).toBe('doc:d1')
  })

  it('projects a sidebar subtree into contained nodes/edges and recurses children', () => {
    const tree: SidebarNode = {
      id: 'f1',
      label: 'Folder',
      kind: 'folder',
      children: [
        { id: 'd1', label: 'Child doc', readOnly: true },
      ],
    }
    const nodes = new Map<string, GraphPanelNode>()
    const edges: GraphPanelEdge[] = []
    const seen = new Set<string>()
    projectSidebarNodeToGraphPanel(section, tree, 'graph:g', nodes, edges, seen, 'g')

    expect([...nodes.keys()]).toEqual(['folder:documents:f1', 'doc:d1'])
    // read-only documents downgrade to the read-only-document kind
    expect(nodes.get('doc:d1')).toMatchObject({ kind: 'read-only-document', documentId: 'd1', readOnly: true })
    expect(edges).toContainEqual(expect.objectContaining({ from: 'graph:g', to: 'folder:documents:f1', predicate: 'contains' }))
    expect(edges).toContainEqual(expect.objectContaining({ from: 'folder:documents:f1', to: 'doc:d1', predicate: 'contains' }))
  })

  it('anchors local document nodes to the root but leaves cross-graph nodes unrooted', () => {
    const nodes = new Map<string, GraphPanelNode>()
    const edges: GraphPanelEdge[] = []
    const seen = new Set<string>()
    const local = addGraphPanelDocumentNode(nodes, edges, seen, 'graph:g', 'g', 'd1', 'g', 'Open')
    const remote = addGraphPanelDocumentNode(nodes, edges, seen, 'graph:g', 'other', 'd2', 'g', 'Elsewhere')

    expect(local).toBe('doc:d1')
    expect(remote).toBe('doc:other:d2')
    expect(nodes.get('doc:d1')).toMatchObject({ section: 'documents' })
    expect(nodes.get('doc:other:d2')).toMatchObject({ section: null })
    // only the local document is contained by the workspace root
    expect(edges).toContainEqual(expect.objectContaining({ from: 'graph:g', to: 'doc:d1' }))
    expect(edges.some((edge) => edge.to === 'doc:other:d2')).toBe(false)
  })

  it('upsert keeps the first-seen field values and merges sparse later projections', () => {
    const nodes = new Map<string, GraphPanelNode>()
    upsertGraphPanelNode(nodes, { id: 'n', label: 'First', kind: 'document', documentId: 'd1' })
    upsertGraphPanelNode(nodes, { id: 'n', label: 'Second', kind: 'document', note: 'added' })
    expect(nodes.get('n')).toMatchObject({ label: 'First', documentId: 'd1', note: 'added' })
  })

  it('addGraphPanelEdge skips self-loops, empty endpoints, and duplicates', () => {
    const edges: GraphPanelEdge[] = []
    const seen = new Set<string>()
    addGraphPanelEdge(edges, seen, { from: 'a', to: 'a', predicate: 'contains' })
    addGraphPanelEdge(edges, seen, { from: '', to: 'b', predicate: 'contains' })
    addGraphPanelEdge(edges, seen, { from: 'a', to: 'b', predicate: 'contains' })
    addGraphPanelEdge(edges, seen, { from: 'a', to: 'b', predicate: 'contains' })
    expect(edges).toHaveLength(1)
  })
})

describe('pushNodeHistory', () => {
  it('appends to the tip and advances the cursor', () => {
    expect(pushNodeHistory([], -1, 'a')).toEqual({ history: ['a'], index: 0 })
    expect(pushNodeHistory(['a'], 0, 'b')).toEqual({ history: ['a', 'b'], index: 1 })
  })

  it('is a no-op when re-selecting the current tip', () => {
    const state = pushNodeHistory(['a', 'b'], 1, 'b')
    expect(state).toEqual({ history: ['a', 'b'], index: 1 })
  })

  it('drops forward entries when selecting from behind the tip (no redo into a diverged branch)', () => {
    expect(pushNodeHistory(['a', 'b', 'c'], 0, 'x')).toEqual({ history: ['a', 'x'], index: 1 })
  })
})
