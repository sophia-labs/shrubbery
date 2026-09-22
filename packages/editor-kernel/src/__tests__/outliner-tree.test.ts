import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import { kernelExtensions } from '../index'
import { foldButtonState, innerTextEnd } from '../extensions/outliner'
import {
  blockHasChildren,
  blockIdOf,
  blockIndexAtPos,
  blockIndexById,
  computeOutlinerDecorations,
  expandSelectionRange,
  findChildren,
  findNextSiblingIndex,
  findParentIndex,
  findPreviousSiblingIndex,
  getAncestorsByBlockId,
  getChildBlocks,
  getHeadingOutline,
  getHiddenIndexSet,
  getOutlinerBlocks,
  getSelectionRootIndices,
  getSubtreeRange,
  getSubtreeRangeById,
  nextVisibleIndex,
  planDrop,
  planMoveDown,
  planMoveUp,
  prevVisibleIndex,
  topLevelBlockStartPos,
} from '../outliner-tree'

const schema = getSchema(kernelExtensions()) as Schema

interface BlockSpec {
  indent?: number
  collapsed?: boolean
  type?: 'paragraph' | 'listItem' | 'heading'
  level?: number
  text?: string
  id?: string | null
}

function block(spec: BlockSpec = {}): ProseMirrorNode {
  const {
    indent = 0,
    collapsed = false,
    type = 'paragraph',
    level = 1,
    text = 'x',
    id = null,
  } = spec
  const attrs = { indent, collapsed, 'data-block-id': id }

  if (type === 'listItem') {
    return schema.node(
      'listItem',
      { ...attrs, listType: 'bullet', checked: false },
      schema.node('paragraph', null, schema.text(text)),
    )
  }

  if (type === 'heading') {
    return schema.node('heading', { ...attrs, level }, schema.text(text))
  }

  return schema.node('paragraph', attrs, schema.text(text))
}

function doc(...specs: Array<BlockSpec | number>): ProseMirrorNode {
  return schema.node(
    'doc',
    null,
    specs.map((spec) => (typeof spec === 'number' ? block({ indent: spec }) : block(spec))),
  )
}

describe('outliner-tree block collection', () => {
  it('collects direct document children with indents and skips listItem content', () => {
    const blocks = getOutlinerBlocks(
      doc({ type: 'listItem', indent: 0 }, { type: 'listItem', indent: 1 }, { indent: 0 }),
    )

    expect(blocks.map((b) => b.indent)).toEqual([0, 1, 0])
    expect(blocks.map((b) => b.node.type.name)).toEqual(['listItem', 'listItem', 'paragraph'])
    expect(blocks[0].end).toBe(blocks[1].pos)
    expect(blocks[1].end).toBe(blocks[2].pos)
  })
})

describe('getHeadingOutline', () => {
  it('collects headings in document order with level, text, and stable id, skipping non-headings', () => {
    const d = doc(
      { type: 'heading', level: 1, text: 'Intro', id: 'h1' },
      { type: 'paragraph', text: 'body text' },
      { type: 'heading', level: 2, text: 'Details', id: 'h2' },
      { type: 'listItem', text: 'a list item' },
      { type: 'heading', level: 3, text: 'Sub-detail', id: 'h3' },
    )

    expect(getHeadingOutline(d)).toEqual([
      { id: 'h1', level: 1, text: 'Intro' },
      { id: 'h2', level: 2, text: 'Details' },
      { id: 'h3', level: 3, text: 'Sub-detail' },
    ])
  })

  it('skips headings that have no stable block id yet', () => {
    const d = doc(
      { type: 'heading', level: 1, text: 'No id', id: null },
      { type: 'heading', level: 1, text: 'Has id', id: 'h1' },
    )

    expect(getHeadingOutline(d)).toEqual([{ id: 'h1', level: 1, text: 'Has id' }])
  })

  it('returns an empty outline for a document with no headings', () => {
    const d = doc({ type: 'paragraph', text: 'just text' })
    expect(getHeadingOutline(d)).toEqual([])
  })

  it('skips a heading hidden behind a collapsed ancestor', () => {
    const d = doc(
      { type: 'heading', level: 1, text: 'Visible', id: 'h1' },
      { type: 'paragraph', text: 'parent', collapsed: true, id: 'p1' },
      { indent: 1, type: 'heading', level: 2, text: 'Hidden', id: 'h2' },
      { type: 'heading', level: 1, text: 'Also visible', id: 'h3' },
    )

    expect(getHeadingOutline(d)).toEqual([
      { id: 'h1', level: 1, text: 'Visible' },
      { id: 'h3', level: 1, text: 'Also visible' },
    ])
  })

  it('skips headings outside the zoomed-into subtree when zoomRootIndex is supplied', () => {
    const d = doc(
      { type: 'heading', level: 1, text: 'Outside', id: 'h1' },
      { type: 'paragraph', text: 'root', id: 'root' },
      { indent: 1, type: 'heading', level: 2, text: 'Inside', id: 'h2' },
    )

    expect(getHeadingOutline(d, 1)).toEqual([{ id: 'h2', level: 2, text: 'Inside' }])
  })
})

describe('outliner-tree subtree and family lookups', () => {
  it('computes subtree ranges, child blocks, siblings, and parents from flat indents', () => {
    const d = doc(0, 1, 2, 1, 0)
    const blocks = getOutlinerBlocks(d)

    expect(blocks.map((_, i) => blockHasChildren(blocks, i))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ])

    const root = getSubtreeRange(blocks, 0)
    expect([root.startIndex, root.endIndex, root.from, root.to]).toEqual([
      0,
      3,
      blocks[0].pos,
      blocks[3].end,
    ])
    expect(getSubtreeRange(blocks, 1).endIndex).toBe(2)
    expect(getSubtreeRange(blocks, 4).endIndex).toBe(4)

    expect(getChildBlocks(blocks, 0).map((b) => b.indent)).toEqual([1, 2, 1])
    expect(findChildren(d, blocks[0].pos, 0).map((b) => b.pos)).toEqual([
      blocks[1].pos,
      blocks[2].pos,
      blocks[3].pos,
    ])

    expect(findPreviousSiblingIndex(blocks, 3)).toBe(1)
    expect(findNextSiblingIndex(blocks, 1)).toBe(3)
    expect(findParentIndex(blocks, 2)).toBe(1)
    expect(findParentIndex(blocks, 0)).toBe(-1)
  })
})

describe('outliner-tree collapse visibility', () => {
  it('marks collapsed parents, hides descendants, and ignores stale childless collapse flags', () => {
    const blocks = getOutlinerBlocks(
      doc({ indent: 0, collapsed: true }, { indent: 1 }, { indent: 2 }, { indent: 0 }),
    )
    const decorations = computeOutlinerDecorations(blocks)

    const kindsByIndex = blocks.map((b) =>
      decorations.filter((decoration) => decoration.from === b.pos).map((decoration) => decoration.kind).sort(),
    )

    expect(kindsByIndex).toEqual([['collapsed', 'has-children'], ['hidden'], ['hidden'], []])
    expect(decorations.find((d) => d.from === blocks[0].pos && d.kind === 'collapsed')?.count).toBe(2)

    const stale = computeOutlinerDecorations(
      getOutlinerBlocks(doc({ indent: 0, collapsed: true }, { indent: 0 })),
    )
    expect(stale).toEqual([])
  })

  it('derives hidden index sets for collapse and zoom-aware visible navigation', () => {
    const blocks = getOutlinerBlocks(
      doc(
        { indent: 0 },
        { indent: 1 },
        { indent: 2, collapsed: true },
        { indent: 3 },
        { indent: 2 },
        { indent: 0 },
      ),
    )

    const hidden = getHiddenIndexSet(blocks, 1)

    expect([...hidden].sort()).toEqual([0, 3, 5])
    expect(nextVisibleIndex(blocks, hidden, 1)).toBe(2)
    expect(nextVisibleIndex(blocks, hidden, 2)).toBe(4)
    expect(nextVisibleIndex(blocks, hidden, 4)).toBe(-1)
    expect(prevVisibleIndex(blocks, hidden, 4)).toBe(2)
  })
})

describe('outliner fold affordance helpers', () => {
  it('anchors collapsed-count pills at the inline-content end', () => {
    const d = doc({ type: 'paragraph', text: 'hello' }, { type: 'listItem', text: 'item' })
    const blocks = getOutlinerBlocks(d)

    expect(innerTextEnd(d, blocks[0].pos)).toBe(blocks[0].end - 1)

    const listAnchor = innerTextEnd(d, blocks[1].pos)
    const listItem = d.nodeAt(blocks[1].pos)
    const innerParagraph = listItem?.child(0)
    expect(listAnchor).toBeLessThan(blocks[1].end - 1)
    expect(listAnchor).toBe(blocks[1].pos + 1 + (innerParagraph?.nodeSize ?? 0) - 1)
  })

  it('derives focusable fold-button state for expanded, collapsed, and childless blocks', () => {
    const expanded = getOutlinerBlocks(doc({ indent: 0 }, { indent: 1 }))
    expect(foldButtonState(expanded, 0)).toEqual({
      hasChildren: true,
      expanded: true,
      label: 'Collapse block',
    })

    const collapsed = getOutlinerBlocks(doc({ indent: 0, collapsed: true }, { indent: 1 }))
    expect(foldButtonState(collapsed, 0)).toEqual({
      hasChildren: true,
      expanded: false,
      label: 'Expand block',
    })

    const childless = getOutlinerBlocks(doc({ indent: 0, collapsed: true }, { indent: 0 }))
    expect(foldButtonState(childless, 0)).toEqual({
      hasChildren: false,
      expanded: true,
      label: 'Collapse block',
    })
  })
})

describe('outliner-tree stable id helpers', () => {
  it('finds blocks, subtree ranges, and ancestor chains by data-block-id', () => {
    const blocks = getOutlinerBlocks(
      doc({ id: 'block-a' }, { id: 'block-b', indent: 1 }, { id: 'block-c', indent: 2 }, { id: 'block-d' }),
    )

    expect(blockIdOf(blocks[0].node)).toBe('block-a')
    expect(blockIndexById(blocks, 'block-c')).toBe(2)
    expect(blockIndexById(blocks, 'block-missing')).toBe(-1)
    expect(getSubtreeRangeById(blocks, 'block-a')).toEqual(getSubtreeRange(blocks, 0))
    expect(getSubtreeRangeById(blocks, 'block-missing')).toBeNull()
    expect(getAncestorsByBlockId(blocks, 'block-c').map((ancestor) => ancestor.blockId)).toEqual([
      'block-a',
      'block-b',
    ])
    expect(getAncestorsByBlockId(blocks, 'block-a')).toEqual([])
  })

  it('treats indent gaps as still having the nearest shallower parent', () => {
    const blocks = getOutlinerBlocks(doc({ id: 'block-a' }, { id: 'block-c', indent: 2 }))

    expect(getAncestorsByBlockId(blocks, 'block-c').map((ancestor) => ancestor.blockId)).toEqual([
      'block-a',
    ])
  })
})

describe('outliner-tree selection and position helpers', () => {
  it('expands selections to complete subtrees and identifies root blocks', () => {
    const blocks = getOutlinerBlocks(doc(0, 1, 2, 1, 0))

    expect([expandSelectionRange(blocks, 0, 0).startIndex, expandSelectionRange(blocks, 0, 0).endIndex]).toEqual([
      0,
      3,
    ])
    expect([expandSelectionRange(blocks, 4, 0).startIndex, expandSelectionRange(blocks, 4, 0).endIndex]).toEqual([
      0,
      4,
    ])
    expect(getSelectionRootIndices(blocks, 0, 4)).toEqual([0, 4])
    expect(getSelectionRootIndices(blocks, 1, 3)).toEqual([1, 3])
  })

  it('maps document positions back to top-level block starts and indices', () => {
    const d = doc({ text: 'A' }, { text: 'B' }, { text: 'C' })
    const blocks = getOutlinerBlocks(d)

    expect(topLevelBlockStartPos(d, blocks[1].pos + 1)).toBe(blocks[1].pos)
    expect(blockIndexAtPos(blocks, blocks[2].pos + 1)).toBe(2)
    expect(blockIndexAtPos(blocks, 9999)).toBe(-1)
  })
})

describe('outliner-tree move and drop plans', () => {
  it('plans sibling subtree swaps for move up/down', () => {
    const blocks = getOutlinerBlocks(doc(0, 1, 2, 1))
    const up = planMoveUp(blocks, 3)

    expect(up).not.toBeNull()
    expect(up!.source.startIndex).toBe(3)
    expect(up!.target.startIndex).toBe(1)
    expect(up!.target.endIndex).toBe(2)
    expect(up!.direction).toBe('up')

    expect(planMoveUp(blocks, 1)).toBeNull()
    expect(planMoveDown(blocks, 3)).toBeNull()

    const down = planMoveDown(getOutlinerBlocks(doc(0, 0)), 0)
    expect(down?.direction).toBe('down')
    expect(down?.target.startIndex).toBe(1)
  })

  it('rejects invalid drops and computes indent deltas for valid reparenting', () => {
    const blocks = getOutlinerBlocks(doc(0, 1, 2, 0))

    expect(planDrop(blocks, 0, 0, 'after')).toBeNull()
    expect(planDrop(blocks, 0, 2, 'child')).toBeNull()
    expect(planDrop(blocks, 3, 1, 'child')?.indentDelta).toBe(2)
    expect(planDrop(blocks, 3, 1, 'after')?.indentDelta).toBe(1)

    const deep = getOutlinerBlocks(doc({ indent: 6 }, { indent: 0 }))
    expect(planDrop(deep, 1, 0, 'child')).toBeNull()
  })
})
