import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  blockIdOf,
  blockIndexById,
  findParentIndex,
  getOutlinerBlocks,
  getSubtreeRange,
  topLevelBlockStartPos,
} from '../outliner-tree'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    outlinerZoom: {
      zoomIntoBlock: (blockId: string) => ReturnType
      zoomIntoCurrent: () => ReturnType
      zoomToAncestor: (blockId: string) => ReturnType
      zoomOut: () => ReturnType
    }
  }
}

export interface ZoomState {
  /** Stable `data-block-id` of the focused subtree root. */
  blockId: string | null
}

const EMPTY_ZOOM: ZoomState = { blockId: null }

export const zoomKey = new PluginKey<ZoomState>('outlinerZoom')

export function getZoomedBlockId(state: EditorState): string | null {
  return zoomKey.getState(state)?.blockId ?? null
}

export function isZoomActive(state: EditorState): boolean {
  return getZoomedBlockId(state) !== null
}

export function setZoomMeta(tr: Transaction, value: ZoomState): Transaction {
  return tr.setMeta(zoomKey, value)
}

export function zoomTargetIdAtSelection(state: EditorState): string | null {
  const pos = topLevelBlockStartPos(state.doc, state.selection.from)
  if (pos === null) return null
  const node = state.doc.nodeAt(pos)
  return node ? blockIdOf(node) : null
}

export function applyZoomInto(state: EditorState, blockId: string): Transaction | false {
  if (!blockId) return false
  const blocks = getOutlinerBlocks(state.doc)
  if (blockIndexById(blocks, blockId) === -1) return false
  if (getZoomedBlockId(state) === blockId) return false
  return setZoomMeta(state.tr, { blockId })
}

export function applyZoomCurrent(state: EditorState): Transaction | false {
  const blockId = zoomTargetIdAtSelection(state)
  return blockId ? applyZoomInto(state, blockId) : false
}

export function applyZoomOut(state: EditorState): Transaction | false {
  if (!isZoomActive(state)) return false
  return setZoomMeta(state.tr, EMPTY_ZOOM)
}

export function zoomParentId(state: EditorState): string | null {
  const blockId = getZoomedBlockId(state)
  if (!blockId) return null

  const blocks = getOutlinerBlocks(state.doc)
  const index = blockIndexById(blocks, blockId)
  if (index === -1) return null

  const parentIndex = findParentIndex(blocks, index)
  return parentIndex === -1 ? null : blockIdOf(blocks[parentIndex].node)
}

export function applyZoomToParent(state: EditorState): Transaction | false {
  const parentId = zoomParentId(state)
  return parentId ? applyZoomInto(state, parentId) : applyZoomOut(state)
}

export function createZoomPlugin(): Plugin<ZoomState> {
  return new Plugin<ZoomState>({
    key: zoomKey,
    state: {
      init: () => EMPTY_ZOOM,
      apply(tr, prev) {
        const meta = tr.getMeta(zoomKey) as ZoomState | undefined
        return meta ?? prev
      },
    },
    props: {
      decorations(state) {
        const blockId = zoomKey.getState(state)?.blockId
        if (!blockId) return DecorationSet.empty

        const blocks = getOutlinerBlocks(state.doc)
        const rootIndex = blockIndexById(blocks, blockId)
        if (rootIndex === -1) return DecorationSet.empty

        const { startIndex, endIndex } = getSubtreeRange(blocks, rootIndex)
        const decorations: Decoration[] = []

        for (let i = 0; i < blocks.length; i++) {
          if (i < startIndex || i > endIndex) {
            decorations.push(
              Decoration.node(blocks[i].pos, blocks[i].end, {
                class: 'outliner-zoom-hidden',
              }),
            )
          }
        }

        const root = blocks[rootIndex]
        decorations.push(
          Decoration.node(root.pos, root.end, {
            class: 'outliner-zoom-root',
          }),
        )

        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}

export const OutlinerZoom = Extension.create({
  name: 'outlinerZoom',

  addCommands() {
    return {
      zoomIntoBlock:
        (blockId: string) =>
        ({ state, dispatch }) => {
          const tr = applyZoomInto(state, blockId)
          if (tr === false) return false
          if (dispatch) dispatch(tr)
          return true
        },

      zoomIntoCurrent:
        () =>
        ({ state, dispatch }) => {
          const tr = applyZoomCurrent(state)
          if (tr === false) return false
          if (dispatch) dispatch(tr)
          return true
        },

      zoomToAncestor:
        (blockId: string) =>
        ({ state, dispatch }) => {
          const tr = applyZoomInto(state, blockId)
          if (tr === false) return false
          if (dispatch) dispatch(tr)
          return true
        },

      zoomOut:
        () =>
        ({ state, dispatch }) => {
          const tr = applyZoomOut(state)
          if (tr === false) return false
          if (dispatch) dispatch(tr)
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-ArrowRight': ({ editor }) => editor.commands.zoomIntoCurrent(),
      'Mod-Shift-ArrowLeft': ({ editor }) => {
        const tr = applyZoomToParent(editor.state)
        if (tr === false) return false
        editor.view.dispatch(tr)
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [createZoomPlugin()]
  },
})

export default OutlinerZoom
