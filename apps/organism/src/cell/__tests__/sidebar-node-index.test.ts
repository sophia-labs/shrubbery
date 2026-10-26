import { describe, expect, it } from 'vitest'
import type { SidebarNode, SidebarSection } from '@shrubbery/runtime'
import { createSidebarNodeIndex } from '../sidebar-node-index.js'

function tree(): SidebarSection[] {
  return [
    { id: 'tree', label: 'Workspace', nodes: [
      { id: 'f', label: 'Folder', kind: 'folder', children: [
        { id: 'a', label: 'A', kind: 'document' },
        { id: 'dup', label: 'inner dup', kind: 'document' },
      ] },
      { id: 'b', label: 'B', kind: 'document' },
      { id: 'dup', label: 'outer dup', kind: 'document' },
    ] },
    { id: 'tags', label: 'Tags', nodes: [{ id: 'tag:x', label: 'x', kind: 'tag' }] },
  ] as SidebarSection[]
}

describe('createSidebarNodeIndex', () => {
  it('finds nested nodes and returns null for unknown ids', () => {
    const index = createSidebarNodeIndex<SidebarNode>()
    const sections = tree()
    expect(index.find(sections, 'a')?.label).toBe('A')
    expect(index.find(sections, 'tag:x')?.label).toBe('x')
    expect(index.find(sections, 'nope')).toBeNull()
  })

  it('returns the first match in depth-first order, like the walk it replaces', () => {
    const index = createSidebarNodeIndex<SidebarNode>()
    expect(index.find(tree(), 'dup')?.label).toBe('inner dup')
  })

  it('builds once per sections array, however many lookups, and again when the array is replaced', () => {
    const index = createSidebarNodeIndex<SidebarNode>()
    const first = tree()
    for (let i = 0; i < 500; i += 1) index.find(first, i % 2 ? 'a' : 'b')
    expect(index.builds).toBe(1)
    const second = tree()
    ;(second[0] as unknown as { nodes: SidebarNode[] }).nodes = [{ id: 'only', label: 'Only', kind: 'document' } as SidebarNode]
    expect(index.find(second, 'a')).toBeNull()
    expect(index.find(second, 'only')?.label).toBe('Only')
    expect(index.builds).toBe(2)
  })
})
