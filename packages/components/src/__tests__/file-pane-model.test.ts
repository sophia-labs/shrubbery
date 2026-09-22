import { describe, expect, it } from 'vitest'
import {
  deriveFilePaneColumns,
  filterFilePaneNodes,
  groupFilePaneSections,
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
