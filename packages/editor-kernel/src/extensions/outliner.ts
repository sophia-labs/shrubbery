/**
 * TipTap Outliner Extension
 *
 * Provides full outliner functionality:
 * - Hierarchical indentation (Tab/Shift+Tab)
 * - When indenting a block, its children move with it
 * - Collapse/expand blocks to hide/show children
 * - Move a block and its subtree up/down among siblings
 *
 * "Children" are defined as: all subsequent blocks with indent > parent's indent,
 * until we hit a block with indent <= parent's indent.
 *
 * Keyboard shortcuts:
 * - Tab: Increase indent (with children)
 * - Shift+Tab: Decrease indent (with children)
 * - Cmd/Ctrl+.: Toggle collapse
 * - Cmd/Ctrl+ArrowUp / Cmd/Ctrl+ArrowDown: collapse / expand the current block
 * - Alt+Shift+ArrowUp / Alt+Shift+ArrowDown: move the current block subtree
 */

import { Extension } from '@tiptap/core'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, Selection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  MAX_INDENT,
  OUTLINER_NODE_TYPES,
  blockHasChildren,
  computeOutlinerDecorations,
  findChildren,
  getIndent,
  getOutlinerBlocks,
  isCollapsed,
  planMoveDown,
  planMoveUp,
  type OutlinerBlock,
} from '../outliner-tree'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    outliner: {
      increaseIndent: () => ReturnType
      decreaseIndent: () => ReturnType
      toggleCollapse: () => ReturnType
      toggleCollapseAt: (pos: number) => ReturnType
      expandBlock: () => ReturnType
      collapseBlock: () => ReturnType
      collapseAll: () => ReturnType
      expandAll: () => ReturnType
      moveBlockUp: () => ReturnType
      moveBlockDown: () => ReturnType
    }
  }
}

const outlinerPluginKey = new PluginKey('outliner')

/**
 * Position just inside the closing token of a block's innermost textblock.
 *
 * For a plain paragraph/heading this is `blockStart + nodeSize - 1`. For a
 * container block such as a `listItem`, it descends into the last child so the
 * collapsed-count pill anchors inside the inner paragraph rather than below the
 * list item.
 */
export function innerTextEnd(doc: ProseMirrorNode, blockStart: number): number {
  let node = doc.nodeAt(blockStart)
  if (!node) return blockStart
  let start = blockStart
  while (!node.isTextblock && node.childCount > 0) {
    const lastChild = node.child(node.childCount - 1)
    let offset = 1
    for (let i = 0; i < node.childCount - 1; i++) offset += node.child(i).nodeSize
    start += offset
    node = lastChild
  }
  return start + node.nodeSize - 1
}

/**
 * Accessible state for a block's focusable fold control.
 */
export interface FoldButtonState {
  hasChildren: boolean
  expanded: boolean
  label: string
}

export function foldButtonState(blocks: OutlinerBlock[], index: number): FoldButtonState {
  const hasChildren = blockHasChildren(blocks, index)
  const expanded = !(hasChildren && isCollapsed(blocks[index].node))
  return {
    hasChildren,
    expanded,
    label: expanded ? 'Collapse block' : 'Expand block',
  }
}

/**
 * Find the outliner block containing the selection.
 * Walks up the tree to find a direct child of the document.
 * This handles cases where the cursor is inside a paragraph within a listItem.
 *
 * Returns { depth, node } or null if no outliner block found.
 */
function findOutlinerBlockAtSelection(
  $from: { depth: number; node: (depth: number) => ProseMirrorNode }
): { depth: number; node: ProseMirrorNode } | null {
  let targetDepth = $from.depth
  let node = $from.node(targetDepth)

  // Walk up until we find a node whose parent is the doc
  while (targetDepth > 1) {
    const parent = $from.node(targetDepth - 1)
    if (parent.type.name === 'doc') {
      break
    }
    targetDepth--
    node = $from.node(targetDepth)
  }

  if (!OUTLINER_NODE_TYPES.includes(node.type.name)) {
    return null
  }

  return { depth: targetDepth, node }
}

/**
 * Get all top-level outliner blocks that overlap with a position range.
 * Used for multi-block selection operations (Tab/Shift+Tab on a range selection).
 * Unlike findOutlinerBlockAtSelection, this returns ALL blocks in the range,
 * not just the one at the cursor.
 */
function getTopLevelBlocksInRange(
  doc: ProseMirrorNode,
  from: number,
  to: number
): Array<{ pos: number; node: ProseMirrorNode }> {
  const blocks: Array<{ pos: number; node: ProseMirrorNode }> = []
  doc.nodesBetween(from, to, (node, pos, parent) => {
    if (parent === doc && OUTLINER_NODE_TYPES.includes(node.type.name)) {
      blocks.push({ pos, node })
      return false // Don't descend into this node's children
    }
    return true
  })
  return blocks
}

export const Outliner = Extension.create({
  name: 'outliner',

  addGlobalAttributes() {
    return [
      {
        types: OUTLINER_NODE_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => {
              const indent = element.getAttribute('data-indent')
              return indent ? parseInt(indent, 10) : 0
            },
            renderHTML: (attributes) => {
              const indent = attributes.indent as number
              if (!indent || indent <= 0) return {}
              return { 'data-indent': indent }
            },
          },
          collapsed: {
            default: false,
            parseHTML: (element) => element.getAttribute('data-collapsed') === 'true',
            renderHTML: (attributes) => {
              if (!attributes.collapsed) return {}
              return { 'data-collapsed': 'true' }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      increaseIndent:
        () =>
        ({ tr, state, dispatch }) => {
          const { $from, $to, empty } = state.selection

          if (!empty) {
            // Multi-block selection: indent each selected block individually.
            // No child cascade — the user selected exactly what they want indented.
            const blocks = getTopLevelBlocksInRange(state.doc, $from.pos, $to.pos)
            if (blocks.length === 0) return false

            let changed = false
            for (const { pos, node } of blocks) {
              const currentIndent = getIndent(node)
              if (currentIndent < MAX_INDENT) {
                if (dispatch) {
                  tr.setNodeMarkup(pos, null, {
                    ...node.attrs,
                    indent: currentIndent + 1,
                  })
                }
                changed = true
              }
            }

            if (changed && dispatch) dispatch(tr)
            return changed
          }

          // Cursor (empty selection): cascade — parent block moves with its children
          const target = findOutlinerBlockAtSelection($from)
          if (!target) return false

          const { depth: targetDepth, node } = target
          const currentIndent = getIndent(node)
          if (currentIndent >= MAX_INDENT) {
            return false
          }

          if (dispatch) {
            const parentPos = $from.before(targetDepth)
            const children = findChildren(state.doc, parentPos, currentIndent)

            // Update parent
            tr.setNodeMarkup(parentPos, null, {
              ...node.attrs,
              indent: currentIndent + 1,
            })

            // Update children - iterate in reverse to maintain positions
            for (let i = children.length - 1; i >= 0; i--) {
              const child = children[i]
              const childIndent = getIndent(child.node)

              if (childIndent < MAX_INDENT) {
                tr.setNodeMarkup(child.pos, null, {
                  ...child.node.attrs,
                  indent: childIndent + 1,
                })
              }
            }

            dispatch(tr)
          }

          return true
        },

      decreaseIndent:
        () =>
        ({ tr, state, dispatch }) => {
          const { $from, $to, empty } = state.selection

          if (!empty) {
            // Multi-block selection: dedent each selected block individually.
            // No child cascade — the user selected exactly what they want dedented.
            const blocks = getTopLevelBlocksInRange(state.doc, $from.pos, $to.pos)
            if (blocks.length === 0) return false

            let changed = false
            for (const { pos, node } of blocks) {
              const currentIndent = getIndent(node)
              if (currentIndent > 0) {
                if (dispatch) {
                  tr.setNodeMarkup(pos, null, {
                    ...node.attrs,
                    indent: currentIndent - 1,
                  })
                }
                changed = true
              }
            }

            if (changed && dispatch) dispatch(tr)
            return changed
          }

          // Cursor (empty selection): cascade — parent block moves with its children
          const target = findOutlinerBlockAtSelection($from)
          if (!target) return false

          const { depth: targetDepth, node } = target
          const currentIndent = getIndent(node)
          if (currentIndent <= 0) {
            return false
          }

          if (dispatch) {
            const parentPos = $from.before(targetDepth)
            const children = findChildren(state.doc, parentPos, currentIndent)

            // Update parent
            tr.setNodeMarkup(parentPos, null, {
              ...node.attrs,
              indent: currentIndent - 1,
            })

            // Update children - iterate in reverse to maintain positions
            for (let i = children.length - 1; i >= 0; i--) {
              const child = children[i]
              const childIndent = getIndent(child.node)

              if (childIndent > 0) {
                tr.setNodeMarkup(child.pos, null, {
                  ...child.node.attrs,
                  indent: childIndent - 1,
                })
              }
            }

            dispatch(tr)
          }

          return true
        },

      toggleCollapse:
        () =>
        ({ tr, state, dispatch }) => {
          const { $from } = state.selection
          const target = findOutlinerBlockAtSelection($from)
          if (!target) return false

          const { depth: targetDepth, node } = target
          const parentPos = $from.before(targetDepth)
          const currentIndent = getIndent(node)
          const children = findChildren(state.doc, parentPos, currentIndent)

          // Only allow collapse if there are children
          if (children.length === 0) {
            return false
          }

          if (dispatch) {
            const newCollapsed = !isCollapsed(node)

            tr.setNodeMarkup(parentPos, null, {
              ...node.attrs,
              collapsed: newCollapsed,
            })

            dispatch(tr)
          }

          return true
        },

      toggleCollapseAt:
        (pos: number) =>
        ({ tr, state, dispatch }) => {
          const node = state.doc.nodeAt(pos)
          if (!node || !OUTLINER_NODE_TYPES.includes(node.type.name)) return false

          const blocks = getOutlinerBlocks(state.doc)
          const index = blocks.findIndex((block) => block.pos === pos)
          if (index === -1 || !blockHasChildren(blocks, index)) return false

          if (dispatch) {
            tr.setNodeMarkup(pos, null, {
              ...node.attrs,
              collapsed: !isCollapsed(node),
            })
            dispatch(tr)
          }

          return true
        },

      expandBlock:
        () =>
        ({ tr, state, dispatch }) => {
          const { $from } = state.selection
          const target = findOutlinerBlockAtSelection($from)
          if (!target) return false

          const { depth: targetDepth, node } = target
          if (!isCollapsed(node)) {
            return false
          }

          if (dispatch) {
            const parentPos = $from.before(targetDepth)
            tr.setNodeMarkup(parentPos, null, {
              ...node.attrs,
              collapsed: false,
            })
            dispatch(tr)
          }

          return true
        },

      collapseBlock:
        () =>
        ({ tr, state, dispatch }) => {
          const { $from } = state.selection
          const target = findOutlinerBlockAtSelection($from)
          if (!target) return false

          const { depth: targetDepth, node } = target
          const parentPos = $from.before(targetDepth)
          const currentIndent = getIndent(node)
          const children = findChildren(state.doc, parentPos, currentIndent)

          // Only allow collapse if there are children
          if (children.length === 0) {
            return false
          }

          if (isCollapsed(node)) {
            return false
          }

          if (dispatch) {
            tr.setNodeMarkup(parentPos, null, {
              ...node.attrs,
              collapsed: true,
            })
            dispatch(tr)
          }

          return true
        },

      collapseAll:
        () =>
        ({ tr, state, dispatch }) =>
          setCollapsedAll(state, tr, dispatch, true),

      expandAll:
        () =>
        ({ tr, state, dispatch }) =>
          setCollapsedAll(state, tr, dispatch, false),

      moveBlockUp:
        () =>
        ({ tr, state, dispatch }) =>
          moveBlock(state, tr, dispatch, 'up'),

      moveBlockDown:
        () =>
        ({ tr, state, dispatch }) =>
          moveBlock(state, tr, dispatch, 'down'),
    }
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (editor.isActive('codeBlock') || editor.isActive('table')) {
          return false
        }
        return editor.commands.increaseIndent()
      },
      'Shift-Tab': ({ editor }) => {
        if (editor.isActive('codeBlock') || editor.isActive('table')) {
          return false
        }
        return editor.commands.decreaseIndent()
      },
      'Mod-.': ({ editor }) => editor.commands.toggleCollapse(),
      'Mod-ArrowUp': ({ editor }) => editor.commands.collapseBlock(),
      'Mod-ArrowDown': ({ editor }) => editor.commands.expandBlock(),
      'Alt-Shift-ArrowUp': ({ editor }) => editor.commands.moveBlockUp(),
      'Alt-Shift-ArrowDown': ({ editor }) => editor.commands.moveBlockDown(),
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: outlinerPluginKey,
        props: {
          decorations: (state) => {
            const { doc } = state
            const blocks = getOutlinerBlocks(doc)
            const decorations: Decoration[] = []

            for (const decoration of computeOutlinerDecorations(blocks)) {
              decorations.push(
                Decoration.node(decoration.from, decoration.to, {
                  class: `outliner-${decoration.kind}`,
                }),
              )

              if (decoration.kind === 'has-children') {
                const index = blocks.findIndex((block) => block.pos === decoration.from)
                if (index !== -1) {
                  const blockPos = decoration.from
                  const { expanded, label } = foldButtonState(blocks, index)
                  decorations.push(
                    Decoration.widget(
                      decoration.from + 1,
                      (view) => {
                        const button = document.createElement('button')
                        button.type = 'button'
                        button.className = 'outliner-fold-button'
                        button.setAttribute('contenteditable', 'false')
                        button.setAttribute('aria-expanded', String(expanded))
                        button.setAttribute('aria-label', label)
                        button.title = label
                        button.addEventListener('mousedown', (event) => event.preventDefault())
                        const activate = (fromKeyboard: boolean) => {
                          if (!toggleFoldAt(view, blockPos)) return
                          if (fromKeyboard) refocusFoldButtonAt(view, blockPos)
                        }
                        button.addEventListener('keydown', (event) => {
                          if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
                          event.preventDefault()
                          event.stopPropagation()
                          activate(true)
                        })
                        button.addEventListener('click', (event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          activate(event.detail === 0)
                        })
                        return button
                      },
                      { side: -1, key: `fold-${blockPos}-${expanded}`, ignoreSelection: true },
                    ),
                  )
                }
              }

              if (decoration.kind === 'collapsed' && decoration.count && decoration.count > 0) {
                const count = decoration.count
                decorations.push(
                  Decoration.widget(
                    innerTextEnd(doc, decoration.from),
                    () => {
                      const pill = document.createElement('span')
                      pill.className = 'outliner-collapsed-count'
                      pill.setAttribute('contenteditable', 'false')
                      pill.textContent = String(count)
                      pill.title = `${count} hidden ${count === 1 ? 'block' : 'blocks'}`
                      return pill
                    },
                    { side: 1, key: `cc-${decoration.from}-${count}`, ignoreSelection: true },
                  ),
                )
              }
            }

            return DecorationSet.create(doc, decorations)
          },
        },
      }),
    ]
  },
})

function toggleFoldAt(view: { state: EditorState; dispatch: (tr: Transaction) => void }, pos: number): boolean {
  const { state } = view
  const node = state.doc.nodeAt(pos)
  if (!node || !OUTLINER_NODE_TYPES.includes(node.type.name)) return false

  const blocks = getOutlinerBlocks(state.doc)
  const index = blocks.findIndex((block) => block.pos === pos)
  if (index === -1 || !blockHasChildren(blocks, index)) return false

  view.dispatch(
    state.tr.setNodeMarkup(pos, null, {
      ...node.attrs,
      collapsed: !isCollapsed(node),
    }),
  )
  return true
}

function refocusFoldButtonAt(view: { nodeDOM: (pos: number) => Node | null }, pos: number): void {
  const dom = view.nodeDOM(pos)
  const root = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null)
  root?.querySelector<HTMLElement>('.outliner-fold-button')?.focus()
}

/**
 * Collapse or expand every block at once. Collapse only marks blocks that
 * actually have children; expand clears the flag everywhere.
 */
export function setCollapsedAll(
  state: EditorState,
  tr: Transaction,
  dispatch: ((tr: Transaction) => void) | undefined,
  collapsed: boolean,
): boolean {
  const blocks = getOutlinerBlocks(state.doc)
  let changed = false
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const eligible = collapsed ? blockHasChildren(blocks, i) : true
    if (!eligible) continue
    if (isCollapsed(block.node) === collapsed) continue
    if (dispatch) tr.setNodeMarkup(block.pos, null, { ...block.node.attrs, collapsed })
    changed = true
  }
  if (changed && dispatch) dispatch(tr)
  return changed
}

/**
 * Move the current block together with its subtree, swapping it with the
 * adjacent sibling subtree. Block IDs and attrs are preserved because this moves
 * existing slices instead of rebuilding nodes.
 */
export function moveBlock(
  state: EditorState,
  tr: Transaction,
  dispatch: ((tr: Transaction) => void) | undefined,
  direction: 'up' | 'down',
): boolean {
  const { $from } = state.selection
  const target = findOutlinerBlockAtSelection($from)
  if (!target) return false

  const parentPos = $from.before(target.depth)
  const blocks = getOutlinerBlocks(state.doc)
  const index = blocks.findIndex((block) => block.pos === parentPos)
  if (index === -1) return false

  const plan = direction === 'up' ? planMoveUp(blocks, index) : planMoveDown(blocks, index)
  if (!plan) return false

  if (dispatch) {
    const { source, target: sibling } = plan
    const sourceSlice = state.doc.slice(source.from, source.to)
    const siblingSlice = state.doc.slice(sibling.from, sibling.to)

    if (direction === 'up') {
      tr.replaceWith(sibling.from, source.to, sourceSlice.content.append(siblingSlice.content))
      const delta = sibling.from - source.from
      tr.setSelection(Selection.near(tr.doc.resolve($from.pos + delta)))
    } else {
      tr.replaceWith(source.from, sibling.to, siblingSlice.content.append(sourceSlice.content))
      const delta = sibling.to - source.to
      tr.setSelection(Selection.near(tr.doc.resolve($from.pos + delta)))
    }

    dispatch(tr)
  }

  return true
}
