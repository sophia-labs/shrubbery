import { describe, expect, it } from 'vitest'
import {
  deriveFilePaneColumns,
  filterFilePaneNodes,
  groupFilePaneSections,
  kindFilterNodes,
  sortFilePaneNodes,
  validFilePanePath,
  type FilePaneSection,
} from '../file-pane-model.js'

const sections: readonly FilePaneSection[] = [
  {
    id: 'documents',
    label: 'Documents',
    nodes: [
      {
        id: 'folder-research',
        label: 'Research',
        kind: 'folder',
        order: 2,
        children: [
          { id: 'doc-zeta', label: 'Zeta', kind: 'document', createdAt: 30, connectivity: 2 },
          { id: 'doc-alpha', label: 'Alpha', kind: 'document', createdAt: 10, connectivity: 8 },
        ],
      },
      { id: 'doc-root', label: 'Root note', kind: 'document', order: 1, createdAt: 20 },
    ],
  },
  {
    id: 'artifacts',
    label: 'Artifacts',
    nodes: [{ id: 'artifact-map', label: 'Map', kind: 'artifact', createdAt: 5 }],
  },
]

describe('controlled file-pane read model', () => {
  it('sorts recursively without mutating the host projection', () => {
    const sourceNodes = sections[0].nodes!
    const sorted = sortFilePaneNodes(sourceNodes, {
      criterion: 'alphabetical',
      direction: 'asc',
      foldersFirst: true,
    })
    expect(sorted.map(node => node.id)).toEqual(['folder-research', 'doc-root'])
    expect(sorted[0].children?.map(node => node.id)).toEqual(['doc-alpha', 'doc-zeta'])
    expect(sourceNodes[0].children?.map(node => node.id)).toEqual(['doc-zeta', 'doc-alpha'])
  })

  it('derives only valid Miller columns and drops stale path suffixes', () => {
    const documentSection = sections[0]
    expect(validFilePanePath(documentSection, ['folder-research', 'missing'])).toEqual(['folder-research'])
    const columns = deriveFilePaneColumns(documentSection, ['folder-research', 'missing'])
    expect(columns.map(column => column.parentId)).toEqual([null, 'folder-research'])
    expect(columns[1].nodes.map(node => node.id)).toEqual(['doc-alpha', 'doc-zeta'])
  })

  it('supports merged/flat grouping and ancestor-preserving search as separate projections', () => {
    const merged = groupFilePaneSections(sections, { separateArtifacts: false, showFolders: false })
    expect(merged.map(section => section.id)).toEqual(['documents'])
    expect(merged[0].nodes?.map(node => node.id)).toEqual([
      'doc-zeta',
      'doc-alpha',
      'doc-root',
      'artifact-map',
    ])
    expect(filterFilePaneNodes(sections[0].nodes ?? [], 'alpha')).toMatchObject([
      { id: 'folder-research', expanded: true, children: [{ id: 'doc-alpha' }] },
    ])
  })
})

describe('the kind filter of the one tree', () => {
  const tree: FilePaneSection[] = [{ id: 'tree', label: 'Workspace', nodes: [
    { id: 'f-mixed', label: 'Mixed', kind: 'folder', children: [
      { id: 'd1', label: 'Notes', kind: 'document' }, { id: 'a1', label: 'Scan.pdf', kind: 'artifact' } ] },
    { id: 'f-docs', label: 'Only docs', kind: 'folder', children: [{ id: 'd2', label: 'Essay', kind: 'document' }] },
    { id: 'f-empty', label: 'Empty', kind: 'folder', children: [] },
    { id: 'a2', label: 'Photo.png', kind: 'artifact' },
    { id: 'd3', label: 'Loose', kind: 'document' },
  ] }]
  const ids = (nodes: readonly { id: string; children?: readonly unknown[] }[]): string[] => nodes.flatMap(n => [n.id, ...ids((n.children ?? []) as never)])

  it('All shows everything', () => {
    expect(ids(kindFilterNodes(tree[0]!.nodes!, 'all'))).toEqual(ids(tree[0]!.nodes!))
  })

  it('Documents keeps documents and the folders that hold some (or were empty), nothing of files', () => {
    expect(ids(kindFilterNodes(tree[0]!.nodes!, 'documents'))).toEqual(['f-mixed', 'd1', 'f-docs', 'd2', 'f-empty', 'd3'])
  })

  it('Files keeps files and the folders that hold some (or were empty), nothing of documents', () => {
    expect(ids(kindFilterNodes(tree[0]!.nodes!, 'files'))).toEqual(['f-mixed', 'a1', 'f-empty', 'a2'])
  })

  it('applies through groupFilePaneSections, which is where the panel gets it', () => {
    const out = groupFilePaneSections(tree, { separateArtifacts: true, showFolders: true, kind: 'files' })
    expect(ids(out[0]!.nodes!)).toEqual(['f-mixed', 'a1', 'f-empty', 'a2'])
  })
})
