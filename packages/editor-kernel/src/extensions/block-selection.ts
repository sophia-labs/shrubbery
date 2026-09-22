/**
 * TipTap block selection extension.
 *
 * Adds a Logseq-style whole-block selection mode on top of the flat outliner
 * model. The active selection is stored as an anchor/head pair of outliner
 * block start positions; the operated range is expanded on demand so selecting
 * a parent also includes its complete subtree.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import {
  MAX_INDENT,
  blockIndexAtPos,
  blockIndexById,
  expandSelectionRange,
  findParentIndex,
  getHiddenIndexSet,
  getOutlinerBlocks,
  getSelectionRootIndices,
  nextVisibleIndex,
  prevVisibleIndex,
  topLevelBlockStartPos,
} from '../outliner-tree'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockSelection: {
      selectCurrentBlock: () => ReturnType
      clearBlockSelection: () => ReturnType
      extendBlockSelection: (direction: 'up' | 'down') => ReturnType
      selectAllBlocks: () => ReturnType
      selectParentBlock: () => ReturnType
      deleteBlockSelection: () => ReturnType
      indentBlockSelection: () => ReturnType
      outdentBlockSelection: () => ReturnType
    }
  }
}

export interface BlockSelectionState {
  anchor: number | null
  head: number | null
}

export type BlockSelectionOverlayGate = (state: EditorState) => boolean
export type BlockSelectionZoomRootResolver = (state: EditorState) => string | null

export interface BlockSelectionOptions {
  /**
   * Host-local Escape gate for suggestion menus or other transient overlays.
   * The pure kernel defaults to no overlay being open.
   */
  isOverlayOpen?: BlockSelectionOverlayGate
  /**
   * Optional host-local zoom seam. When supplied, Shift+Arrow extension cannot
   * leave that zoom root's visible subtree.
   */
  getZoomedBlockId?: BlockSelectionZoomRootResolver
}

const EMPTY: BlockSelectionState = { anchor: null, head: null }

export const blockSelectionKey = new PluginKey<BlockSelectionState>('blockSelection')

export function isBlockSelectionActive(state: EditorState): boolean {
  const value = blockSelectionKey.getState(state)
  return !!value && value.anchor !== null && value.head !== null
}

export function isEditorOverlayOpen(
  state: EditorState,
  overlayGate?: BlockSelectionOverlayGate,
): boolean {
  return overlayGate?.(state) === true
}

export function setSelectionMeta(tr: Transaction, value: BlockSelectionState): Transaction {
  return tr.setMeta(blockSelectionKey, value)
}

/**
 * Compute the selection state for a gutter/handle click. Shift-click extends
 * from the existing anchor when there is one.
 */
export function selectionMetaForClick(
  state: EditorState,
  blockPos: number,
  shiftKey: boolean,
): BlockSelectionState {
  const current = blockSelectionKey.getState(state)
  if (shiftKey && current?.anchor !== null && current?.anchor !== undefined) {
    return { anchor: current.anchor, head: blockPos }
  }
  return { anchor: blockPos, head: blockPos }
}

export function topLevelBlockStart(state: EditorState, pos: number): number | null {
  return topLevelBlockStartPos(state.doc, pos)
}

function resolveIndices(
  state: EditorState,
): {
  blocks: ReturnType<typeof getOutlinerBlocks>
  anchorIdx: number
  headIdx: number
} | null {
  const value = blockSelectionKey.getState(state)
  if (!value || value.anchor === null || value.head === null) return null

  const blocks = getOutlinerBlocks(state.doc)
  const anchorIdx = blockIndexAtPos(blocks, value.anchor)
  const headIdx = blockIndexAtPos(blocks, value.head)
  if (anchorIdx === -1 || headIdx === -1) return null

  return { blocks, anchorIdx, headIdx }
}

function hiddenSetForExtend(
  state: EditorState,
  blocks: ReturnType<typeof getOutlinerBlocks>,
  options?: Pick<BlockSelectionOptions, 'getZoomedBlockId'>,
): Set<number> {
  const zoomedBlockId = options?.getZoomedBlockId?.(state)
  const zoomRootIndex =
    typeof zoomedBlockId === 'string' ? blockIndexById(blocks, zoomedBlockId) : undefined
  return getHiddenIndexSet(blocks, zoomRootIndex)
}

export function applySelectCurrentBlock(state: EditorState): Transaction | false {
  const pos = topLevelBlockStart(state, state.selection.from)
  if (pos === null) return false
  return setSelectionMeta(state.tr, { anchor: pos, head: pos })
}

export function applyClear(state: EditorState): Transaction | false {
  if (!isBlockSelectionActive(state)) return false
  return setSelectionMeta(state.tr, EMPTY)
}

export function applySelectAll(state: EditorState): Transaction | false {
  const blocks = getOutlinerBlocks(state.doc)
  if (blocks.length === 0) return false
  return setSelectionMeta(state.tr, {
    anchor: blocks[0].pos,
    head: blocks[blocks.length - 1].pos,
  })
}

export function applySelectParent(state: EditorState): Transaction | null | false {
  const blocks = getOutlinerBlocks(state.doc)
  let anchorIdx: number
  const resolved = resolveIndices(state)

  if (resolved) {
    anchorIdx = resolved.anchorIdx
  } else {
    const pos = topLevelBlockStart(state, state.selection.from)
    if (pos === null) return false
    anchorIdx = blockIndexAtPos(blocks, pos)
    if (anchorIdx === -1) return false
  }

  const parentIdx = findParentIndex(blocks, anchorIdx)
  if (parentIdx === -1) return null
  return setSelectionMeta(state.tr, { anchor: blocks[parentIdx].pos, head: blocks[parentIdx].pos })
}

export function applyExtend(
  state: EditorState,
  direction: 'up' | 'down',
  options?: Pick<BlockSelectionOptions, 'getZoomedBlockId'>,
): Transaction | null | false {
  const resolved = resolveIndices(state)
  if (!resolved) return false

  const { blocks, anchorIdx, headIdx } = resolved
  const hidden = hiddenSetForExtend(state, blocks, options)
  const newHead =
    direction === 'down'
      ? nextVisibleIndex(blocks, hidden, headIdx)
      : prevVisibleIndex(blocks, hidden, headIdx)

  if (newHead === -1) return null
  return setSelectionMeta(state.tr, { anchor: blocks[anchorIdx].pos, head: blocks[newHead].pos })
}

export function applyDeleteSelection(state: EditorState): Transaction | false {
  const resolved = resolveIndices(state)
  if (!resolved) return false

  const { blocks, anchorIdx, headIdx } = resolved
  const range = expandSelectionRange(blocks, anchorIdx, headIdx)
  const tr = state.tr.delete(range.from, range.to)
  const landing = Math.min(range.from, tr.doc.content.size)

  tr.setSelection(TextSelection.near(tr.doc.resolve(landing)))
  setSelectionMeta(tr, EMPTY)
  return tr
}

export function applyReindent(state: EditorState, delta: 1 | -1): Transaction | null | false {
  const resolved = resolveIndices(state)
  if (!resolved) return false

  const { blocks, anchorIdx, headIdx } = resolved
  const range = expandSelectionRange(blocks, anchorIdx, headIdx)
  const roots = getSelectionRootIndices(blocks, range.startIndex, range.endIndex)
  if (roots.length === 0) return null

  if (delta < 0 && roots.some((index) => blocks[index].indent <= 0)) return null
  if (delta > 0) {
    for (let i = range.startIndex; i <= range.endIndex; i++) {
      if (blocks[i].indent >= MAX_INDENT) return null
    }
  }

  const tr = state.tr
  for (let i = range.startIndex; i <= range.endIndex; i++) {
    const block = blocks[i]
    tr.setNodeMarkup(block.pos, null, { ...block.node.attrs, indent: block.indent + delta })
  }

  setSelectionMeta(tr, { anchor: blocks[anchorIdx].pos, head: blocks[headIdx].pos })
  return tr
}

export function createBlockSelectionPlugin(): Plugin<BlockSelectionState> {
  return new Plugin<BlockSelectionState>({
    key: blockSelectionKey,
    state: {
      init: () => EMPTY,
      apply(tr, previous) {
        const meta = tr.getMeta(blockSelectionKey) as BlockSelectionState | undefined
        if (meta) return meta
        if (previous.anchor === null || previous.head === null) return previous
        if (tr.docChanged) return EMPTY
        return previous
      },
    },
    props: {
      handleDOMEvents: {
        click: (view: EditorView, event: MouseEvent) => {
          const handle = (event.target as HTMLElement | null)?.closest?.('.block-drag-handle')
          if (!handle) return false

          const blockElement = handle.closest('[data-block-id]') as HTMLElement | null
          if (!blockElement) return false

          try {
            const inside = view.posAtDOM(blockElement, 0)
            const blockPos = view.state.doc.resolve(inside).before(1)
            const meta = selectionMetaForClick(view.state, blockPos, event.shiftKey)
            view.dispatch(setSelectionMeta(view.state.tr, meta))
            event.preventDefault()
            return true
          } catch {
            return false
          }
        },
      },
      decorations(state) {
        const value = blockSelectionKey.getState(state)
        if (!value || value.anchor === null || value.head === null) return DecorationSet.empty

        const blocks = getOutlinerBlocks(state.doc)
        const anchorIdx = blockIndexAtPos(blocks, value.anchor)
        const headIdx = blockIndexAtPos(blocks, value.head)
        if (anchorIdx === -1 || headIdx === -1) return DecorationSet.empty

        const range = expandSelectionRange(blocks, anchorIdx, headIdx)
        const decorations: Decoration[] = []
        for (let i = range.startIndex; i <= range.endIndex; i++) {
          decorations.push(Decoration.node(blocks[i].pos, blocks[i].end, { class: 'block-selected' }))
        }
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}

function runApply(
  result: Transaction | null | false,
  dispatch: ((tr: Transaction) => void) | undefined,
): boolean {
  if (result === false) return false
  if (result && dispatch) dispatch(result)
  return true
}

export const BlockSelection = Extension.create<BlockSelectionOptions>({
  name: 'blockSelection',
  priority: 1000,

  addOptions() {
    return {
      isOverlayOpen: undefined,
      getZoomedBlockId: undefined,
    }
  },

  addCommands() {
    const options = this.options
    return {
      selectCurrentBlock:
        () =>
        ({ state, dispatch }) =>
          runApply(applySelectCurrentBlock(state), dispatch),
      clearBlockSelection:
        () =>
        ({ state, dispatch }) =>
          runApply(applyClear(state), dispatch),
      extendBlockSelection:
        (direction: 'up' | 'down') =>
        ({ state, dispatch }) =>
          runApply(applyExtend(state, direction, options), dispatch),
      selectAllBlocks:
        () =>
        ({ state, dispatch }) =>
          runApply(applySelectAll(state), dispatch),
      selectParentBlock:
        () =>
        ({ state, dispatch }) =>
          runApply(applySelectParent(state), dispatch),
      deleteBlockSelection:
        () =>
        ({ state, dispatch }) =>
          runApply(applyDeleteSelection(state), dispatch),
      indentBlockSelection:
        () =>
        ({ state, dispatch }) =>
          runApply(applyReindent(state, +1), dispatch),
      outdentBlockSelection:
        () =>
        ({ state, dispatch }) =>
          runApply(applyReindent(state, -1), dispatch),
    }
  },

  addKeyboardShortcuts() {
    const options = this.options
    return {
      Escape: ({ editor }) => {
        if (isBlockSelectionActive(editor.state)) return editor.commands.clearBlockSelection()
        if (isEditorOverlayOpen(editor.state, options.isOverlayOpen)) return false
        return editor.commands.selectCurrentBlock()
      },
      'Shift-ArrowUp': ({ editor }) =>
        isBlockSelectionActive(editor.state) ? editor.commands.extendBlockSelection('up') : false,
      'Shift-ArrowDown': ({ editor }) =>
        isBlockSelectionActive(editor.state) ? editor.commands.extendBlockSelection('down') : false,
      'Mod-a': ({ editor }) =>
        isBlockSelectionActive(editor.state) ? editor.commands.selectAllBlocks() : false,
      Backspace: ({ editor }) =>
        isBlockSelectionActive(editor.state) ? editor.commands.deleteBlockSelection() : false,
      Delete: ({ editor }) =>
        isBlockSelectionActive(editor.state) ? editor.commands.deleteBlockSelection() : false,
      Tab: ({ editor }) =>
        isBlockSelectionActive(editor.state) ? editor.commands.indentBlockSelection() : false,
      'Shift-Tab': ({ editor }) =>
        isBlockSelectionActive(editor.state) ? editor.commands.outdentBlockSelection() : false,
      ArrowUp: ({ editor }) => clearOnCaretMove(editor),
      ArrowDown: ({ editor }) => clearOnCaretMove(editor),
      ArrowLeft: ({ editor }) => clearOnCaretMove(editor),
      ArrowRight: ({ editor }) => clearOnCaretMove(editor),
    }
  },

  addProseMirrorPlugins() {
    return [createBlockSelectionPlugin()]
  },
})

function clearOnCaretMove(editor: {
  state: EditorState
  commands: { clearBlockSelection: () => boolean }
}): boolean {
  if (!isBlockSelectionActive(editor.state)) return false
  editor.commands.clearBlockSelection()
  return false
}

export default BlockSelection
