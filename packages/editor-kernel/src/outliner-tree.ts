/**
 * Outliner tree logic (pure, view-independent)
 *
 * Garden's editor uses a FLAT block model: every outliner block is a direct
 * child of the document, and hierarchy is expressed through the `indent`
 * attribute rather than DOM/ProseMirror nesting. That keeps the schema simple,
 * but it means every "tree" operation (collapse, move subtree, drag, block
 * selection) has to reconstruct the tree from the flat sequence of blocks and
 * their indents.
 *
 * This module is the single source of truth for that reconstruction. It is
 * deliberately free of ProseMirror transactions, TipTap commands, and DOM so it
 * can be unit-tested in isolation and reused by every outliner affordance.
 *
 * The core idea: given the flat list of blocks in document order, a block's
 * "subtree" is itself plus all *subsequent* blocks whose indent is strictly
 * greater, stopping at the first block whose indent is <= the block's own.
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * Block types that participate in the outliner hierarchy. List items (all
 * sub-types: bullet, ordered, task) are included so they cascade like
 * paragraphs.
 */
export const OUTLINER_NODE_TYPES = ['paragraph', 'heading', 'listItem', 'blockquote', 'table']

const MAX_INDENT = 6

export interface OutlinerBlock {
  /** Position of the block's opening token. */
  pos: number
  /** Position just past the block (pos + nodeSize). */
  end: number
  /** Indent level (0-based). */
  indent: number
  node: ProseMirrorNode
}

export type OutlinerDecorationKind = 'has-children' | 'collapsed' | 'hidden'

export interface OutlinerDecoration {
  from: number
  to: number
  kind: OutlinerDecorationKind
  /** For `collapsed` decorations: number of hidden descendants. */
  count?: number
}

export interface SubtreeRange {
  /** Index of the block within the blocks array. */
  startIndex: number
  /** Index of the last block in the subtree (inclusive). */
  endIndex: number
  /** Document position of the subtree start. */
  from: number
  /** Document position just past the subtree end. */
  to: number
}

export function getIndent(node: ProseMirrorNode): number {
  return (node.attrs.indent as number) || 0
}

export function isCollapsed(node: ProseMirrorNode): boolean {
  return !!node.attrs.collapsed
}

/**
 * Stable id of a block: the `data-block-id` attribute the BlockId extension
 * assigns and future drag-handle / wire consumers can key on. Returns null when
 * the block has no id yet.
 */
export function blockIdOf(node: ProseMirrorNode): string | null {
  const id = node.attrs['data-block-id']
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * Collect every outliner block in document order.
 *
 * Only DIRECT children of the document are included: content nested inside a
 * listItem is not part of the outliner hierarchy, so we never descend into list
 * items.
 */
export function getOutlinerBlocks(doc: ProseMirrorNode): OutlinerBlock[] {
  const blocks: OutlinerBlock[] = []

  doc.descendants((node, pos, parent) => {
    if (parent === doc && OUTLINER_NODE_TYPES.includes(node.type.name)) {
      blocks.push({ pos, end: pos + node.nodeSize, indent: getIndent(node), node })
    }
    if (node.type.name === 'listItem') {
      return false
    }
    return true
  })

  return blocks
}

export interface HeadingOutlineEntry {
  id: string
  level: number
  text: string
}

/**
 * The document's headings in document order, as a flat navigable outline.
 * Headings without a stable id yet (not yet assigned by the BlockId
 * extension) are skipped — nothing else in this module treats an
 * unidentified block as addressable either.
 *
 * Headings hidden behind a collapsed ancestor (or, when `zoomRootIndex` is
 * supplied, outside the zoomed-into subtree) are skipped too — the same
 * visibility boundary `getHiddenIndexSet` gives rendering and keyboard nav,
 * so the outline never offers a heading whose click would silently land on
 * a `display: none` target.
 */
export function getHeadingOutline(doc: ProseMirrorNode, zoomRootIndex?: number): HeadingOutlineEntry[] {
  const blocks = getOutlinerBlocks(doc)
  const hidden = getHiddenIndexSet(blocks, zoomRootIndex)
  const entries: HeadingOutlineEntry[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.node.type.name !== 'heading' || hidden.has(i)) continue
    const id = blockIdOf(block.node)
    if (!id) continue
    entries.push({ id, level: Number(block.node.attrs.level) || 1, text: block.node.textContent })
  }
  return entries
}

/**
 * True if the block at `index` has at least one child (the next block is more
 * deeply indented).
 */
export function blockHasChildren(blocks: OutlinerBlock[], index: number): boolean {
  return index >= 0 && index < blocks.length - 1 && blocks[index + 1].indent > blocks[index].indent
}

/**
 * Compute the contiguous range covering the block at `index` plus all of its
 * descendants (the "subtree").
 */
export function getSubtreeRange(blocks: OutlinerBlock[], index: number): SubtreeRange {
  const parentIndent = blocks[index].indent
  let endIndex = index

  for (let i = index + 1; i < blocks.length; i++) {
    if (blocks[i].indent <= parentIndent) break
    endIndex = i
  }

  return {
    startIndex: index,
    endIndex,
    from: blocks[index].pos,
    to: blocks[endIndex].end,
  }
}

/**
 * The descendants of the block at `index` (excludes the block itself).
 */
export function getChildBlocks(blocks: OutlinerBlock[], index: number): OutlinerBlock[] {
  const { startIndex, endIndex } = getSubtreeRange(blocks, index)
  return blocks.slice(startIndex + 1, endIndex + 1)
}

/**
 * Back-compat helper used by the indent cascade: returns the descendant blocks
 * of the block located at `parentPos`.
 */
export function findChildren(
  doc: ProseMirrorNode,
  parentPos: number,
  _parentIndent: number,
): Array<{ pos: number; node: ProseMirrorNode }> {
  const blocks = getOutlinerBlocks(doc)
  const index = blocks.findIndex((b) => b.pos === parentPos)
  if (index === -1) return []
  return getChildBlocks(blocks, index).map((b) => ({ pos: b.pos, node: b.node }))
}

/**
 * Index of the previous sibling of the block at `index`: the closest earlier
 * block at the same indent that is not separated from it by a shallower block.
 */
export function findPreviousSiblingIndex(blocks: OutlinerBlock[], index: number): number {
  const indent = blocks[index].indent
  for (let i = index - 1; i >= 0; i--) {
    if (blocks[i].indent < indent) return -1
    if (blocks[i].indent === indent) return i
  }
  return -1
}

/**
 * Index of the next sibling of the block at `index`: the first block after this
 * block's subtree that sits at the same indent.
 */
export function findNextSiblingIndex(blocks: OutlinerBlock[], index: number): number {
  const indent = blocks[index].indent
  const { endIndex } = getSubtreeRange(blocks, index)
  const next = endIndex + 1
  if (next >= blocks.length) return -1
  if (blocks[next].indent < indent) return -1
  return blocks[next].indent === indent ? next : -1
}

/**
 * Index of the nearest ancestor (parent) of the block at `index`, or -1 for a
 * top-level block.
 */
export function findParentIndex(blocks: OutlinerBlock[], index: number): number {
  const indent = blocks[index].indent
  if (indent <= 0) return -1
  for (let i = index - 1; i >= 0; i--) {
    if (blocks[i].indent < indent) return i
  }
  return -1
}

/**
 * Compute decorations for the whole document in one pass:
 * - `has-children`: a visible block that has descendants
 * - `collapsed`: a visible, collapsed block with descendants
 * - `hidden`: a descendant of a collapsed ancestor
 *
 * A `collapsed` flag only takes effect when the block actually has children, so
 * a stale `collapsed` attribute on a childless block can never swallow the
 * blocks that follow it.
 */
export function computeOutlinerDecorations(blocks: OutlinerBlock[]): OutlinerDecoration[] {
  const decorations: OutlinerDecoration[] = []
  let hiddenUntilIndent: number | null = null

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const hasChildren = blockHasChildren(blocks, i)
    const collapsed = isCollapsed(block.node) && hasChildren

    if (hiddenUntilIndent !== null && block.indent <= hiddenUntilIndent) {
      hiddenUntilIndent = null
    }

    if (hiddenUntilIndent !== null) {
      decorations.push({ from: block.pos, to: block.end, kind: 'hidden' })
    } else {
      if (hasChildren) {
        decorations.push({ from: block.pos, to: block.end, kind: 'has-children' })
      }
      if (collapsed) {
        const count = getSubtreeRange(blocks, i).endIndex - i
        decorations.push({ from: block.pos, to: block.end, kind: 'collapsed', count })
      }
    }

    if (collapsed && hiddenUntilIndent === null) {
      hiddenUntilIndent = block.indent
    }
  }

  return decorations
}

/**
 * The set of block indices that are hidden because an ancestor is collapsed.
 *
 * When `zoomRootIndex` is supplied, every block outside that root's subtree is
 * also hidden, so rendering and keyboard/navigation consumers share one
 * visibility boundary.
 */
export function getHiddenIndexSet(blocks: OutlinerBlock[], zoomRootIndex?: number): Set<number> {
  const hidden = new Set<number>()
  let hiddenUntilIndent: number | null = null

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const collapsed = isCollapsed(block.node) && blockHasChildren(blocks, i)

    if (hiddenUntilIndent !== null && block.indent <= hiddenUntilIndent) {
      hiddenUntilIndent = null
    }
    if (hiddenUntilIndent !== null) hidden.add(i)
    if (collapsed && hiddenUntilIndent === null) hiddenUntilIndent = block.indent
  }

  if (zoomRootIndex !== undefined && zoomRootIndex >= 0 && zoomRootIndex < blocks.length) {
    const { startIndex, endIndex } = getSubtreeRange(blocks, zoomRootIndex)
    for (let i = 0; i < blocks.length; i++) {
      if (i < startIndex || i > endIndex) hidden.add(i)
    }
  }

  return hidden
}

/** Next visible block index strictly after `i`, or -1. */
export function nextVisibleIndex(blocks: OutlinerBlock[], hidden: Set<number>, i: number): number {
  for (let j = i + 1; j < blocks.length; j++) {
    if (!hidden.has(j)) return j
  }
  return -1
}

/** Previous visible block index strictly before `i`, or -1. */
export function prevVisibleIndex(_blocks: OutlinerBlock[], hidden: Set<number>, i: number): number {
  for (let j = i - 1; j >= 0; j--) {
    if (!hidden.has(j)) return j
  }
  return -1
}

export interface SelectionRange {
  startIndex: number
  endIndex: number
  from: number
  to: number
}

/**
 * Expand a raw anchor/head pair into a block-selection range. The range is the
 * inclusive span between the two, then grown so every selected block's complete
 * subtree is included.
 */
export function expandSelectionRange(
  blocks: OutlinerBlock[],
  anchorIndex: number,
  headIndex: number,
): SelectionRange {
  const lo = Math.min(anchorIndex, headIndex)
  const hi = Math.max(anchorIndex, headIndex)
  let endIndex = hi
  for (let i = lo; i <= hi; i++) {
    const e = getSubtreeRange(blocks, i).endIndex
    if (e > endIndex) endIndex = e
  }
  return { startIndex: lo, endIndex, from: blocks[lo].pos, to: blocks[endIndex].end }
}

/**
 * The root blocks of a selection range: those whose parent is not itself in the
 * range. Structural operations act on these roots and let descendants ride
 * along with their root.
 */
export function getSelectionRootIndices(
  blocks: OutlinerBlock[],
  startIndex: number,
  endIndex: number,
): number[] {
  const roots: number[] = []
  for (let i = startIndex; i <= endIndex; i++) {
    if (findParentIndex(blocks, i) < startIndex) roots.push(i)
  }
  return roots
}

/**
 * Resolve the start position of the top-level outliner block that contains
 * `pos`. Returns null when `pos` does not resolve to a top-level block.
 */
export function topLevelBlockStartPos(doc: ProseMirrorNode, pos: number): number | null {
  const $pos = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size))
  if ($pos.depth === 0) {
    return $pos.nodeAfter ? $pos.pos : null
  }
  return $pos.before(1)
}

/** Index of the block whose range contains `pos`, or -1. */
export function blockIndexAtPos(blocks: OutlinerBlock[], pos: number): number {
  for (let i = 0; i < blocks.length; i++) {
    if (pos >= blocks[i].pos && pos < blocks[i].end) return i
  }
  return -1
}

/**
 * Index of the block whose stable id is `blockId`, or -1.
 */
export function blockIndexById(blocks: OutlinerBlock[], blockId: string): number {
  for (let i = 0; i < blocks.length; i++) {
    if (blockIdOf(blocks[i].node) === blockId) return i
  }
  return -1
}

/**
 * The subtree range of the block whose id is `blockId`, or null when no block
 * carries that id.
 */
export function getSubtreeRangeById(blocks: OutlinerBlock[], blockId: string): SubtreeRange | null {
  const index = blockIndexById(blocks, blockId)
  if (index === -1) return null
  return getSubtreeRange(blocks, index)
}

/**
 * The ancestor chain of the block whose id is `blockId`, ordered outermost to
 * innermost and excluding the block itself.
 */
export function getAncestorsByBlockId(
  blocks: OutlinerBlock[],
  blockId: string,
): Array<{ blockId: string | null; indent: number; node: ProseMirrorNode }> {
  const index = blockIndexById(blocks, blockId)
  if (index === -1) return []

  const chain: Array<{ blockId: string | null; indent: number; node: ProseMirrorNode }> = []
  let i = findParentIndex(blocks, index)
  while (i !== -1) {
    const b = blocks[i]
    chain.push({ blockId: blockIdOf(b.node), indent: b.indent, node: b.node })
    i = findParentIndex(blocks, i)
  }
  chain.reverse()
  return chain
}

export interface MovePlan {
  /** Block range being moved. */
  source: SubtreeRange
  /** Block range it swaps with (sibling subtree). */
  target: SubtreeRange
  /** `up` moves source before target; `down` moves source after target. */
  direction: 'up' | 'down'
}

/**
 * Plan a "move block up": swap the block's subtree with its previous sibling's
 * subtree. Returns null when there is no previous sibling.
 */
export function planMoveUp(blocks: OutlinerBlock[], index: number): MovePlan | null {
  const prev = findPreviousSiblingIndex(blocks, index)
  if (prev === -1) return null
  return {
    source: getSubtreeRange(blocks, index),
    target: getSubtreeRange(blocks, prev),
    direction: 'up',
  }
}

/**
 * Plan a "move block down": swap the block's subtree with its next sibling's
 * subtree. Returns null when there is no next sibling.
 */
export function planMoveDown(blocks: OutlinerBlock[], index: number): MovePlan | null {
  const next = findNextSiblingIndex(blocks, index)
  if (next === -1) return null
  return {
    source: getSubtreeRange(blocks, index),
    target: getSubtreeRange(blocks, next),
    direction: 'down',
  }
}

export type DropMode = 'before' | 'after' | 'child'

export interface DropPlan {
  /** The subtree being dragged. */
  source: SubtreeRange
  /** Index of the drop target block (in the pre-move blocks array). */
  targetIndex: number
  /** Indent shift applied uniformly to every block in the source subtree. */
  indentDelta: number
  mode: DropMode
}

/**
 * Plan a drag-drop: move the source block's subtree relative to a target block.
 * - `before` / `after`: source becomes a sibling of the target.
 * - `child`: source becomes the target's first child.
 *
 * Returns null for invalid drops: dropping onto itself, dropping into its own
 * subtree, or shifting any source block outside [0, MAX_INDENT].
 */
export function planDrop(
  blocks: OutlinerBlock[],
  sourceIndex: number,
  targetIndex: number,
  mode: DropMode,
): DropPlan | null {
  if (sourceIndex < 0 || targetIndex < 0) return null
  const source = getSubtreeRange(blocks, sourceIndex)

  if (targetIndex >= source.startIndex && targetIndex <= source.endIndex) return null

  const targetIndent = blocks[targetIndex].indent
  const newRootIndent = mode === 'child' ? targetIndent + 1 : targetIndent
  const indentDelta = newRootIndent - blocks[sourceIndex].indent

  for (let i = source.startIndex; i <= source.endIndex; i++) {
    const next = blocks[i].indent + indentDelta
    if (next < 0 || next > MAX_INDENT) return null
  }

  return { source, targetIndex, indentDelta, mode }
}

export { MAX_INDENT }
