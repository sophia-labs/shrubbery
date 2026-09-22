import { describe, expect, it } from 'vitest'

import type { SidebarNodeDropDetail, SidebarSection } from '@shrubbery/runtime'
import { resolveSidebarDrop } from '../sidebar-drop.js'

const sections: readonly SidebarSection[] = [
  {
    id: 'documents',
    label: 'Documents',
    nodes: [
      { id: 'first', label: 'First', kind: 'document', section: 'documents', order: 10 },
      {
        id: 'folder',
        label: 'Folder',
        kind: 'folder',
        section: 'documents',
        order: 20,
        children: [
          { id: 'child', label: 'Child', kind: 'document', section: 'documents', parentId: 'folder', order: 2 },
        ],
      },
      { id: 'last', label: 'Last', kind: 'document', section: 'documents', order: 40 },
    ],
  },
  {
    id: 'artifacts',
    label: 'Artifacts',
    nodes: [
      { id: 'artifact', label: 'Artifact', kind: 'artifact', section: 'artifacts', order: 1 },
    ],
  },
]

function detail(
  sourceId: string,
  targetId: string,
  position: SidebarNodeDropDetail['position'],
): SidebarNodeDropDetail {
  // The resolver deliberately ignores these payload copies and resolves both
  // IDs against the current projection, so stale/spoofed values cannot win.
  const stale = { id: 'stale', label: 'Stale', kind: 'document' as const }
  return { sourceId, source: stale, targetId, target: stale, position }
}

describe('resolveSidebarDrop', () => {
  it('interpolates between actual neighbors for relative reorder', () => {
    expect(resolveSidebarDrop(sections, detail('last', 'first', 'after'))).toEqual({
      source: sections[0].nodes![2],
      parentId: null,
      order: 15,
    })
  })

  it('uses a wide edge order and ignores the source as a neighbor', () => {
    expect(resolveSidebarDrop(sections, detail('first', 'folder', 'after'))).toEqual({
      source: sections[0].nodes![0],
      parentId: null,
      order: 30,
    })
    expect(resolveSidebarDrop(sections, detail('last', 'first', 'before'))?.order).toBe(-990)
  })

  it('moves inside a folder without inventing an order', () => {
    expect(resolveSidebarDrop(sections, detail('last', 'folder', 'inside'))).toEqual({
      source: sections[0].nodes![2],
      parentId: 'folder',
      order: null,
    })
  })

  it('rejects descendant, cross-section, stale, and invalid inside drops', () => {
    expect(resolveSidebarDrop(sections, detail('folder', 'child', 'inside'))).toBeNull()
    expect(resolveSidebarDrop(sections, detail('first', 'artifact', 'before'))).toBeNull()
    expect(resolveSidebarDrop(sections, detail('missing', 'first', 'before'))).toBeNull()
    expect(resolveSidebarDrop(sections, detail('first', 'last', 'inside'))).toBeNull()
  })
})
