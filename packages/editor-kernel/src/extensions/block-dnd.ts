/**
 * TipTap block drag/drop extension.
 *
 * Drag/drop validity and indent math are delegated to the pure outliner-tree
 * planner. This module owns the ProseMirror transaction and DOM event wiring.
 */

import { Extension } from '@tiptap/core'
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import {
  MAX_INDENT,
  blockIndexAtPos,
  blockIndexById,
  getOutlinerBlocks,
  getSubtreeRange,
  planDrop,
  type OutlinerBlock,
  type DropMode,
} from '../outliner-tree'
import { getZoomedBlockId } from './outliner-zoom'

const clampIndent = (value: number): number => Math.max(0, Math.min(MAX_INDENT, value))

/**
 * While subtree zoom is active, the focused root reads as the view header and
 * drag/drop targets are restricted to its visible descendants.
 */
export function isDropTargetAllowedUnderZoom(
  blocks: OutlinerBlock[],
  targetIndex: number,
  zoomedBlockId: string | null,
): boolean {
  if (!zoomedBlockId) return true
  const rootIndex = blockIndexById(blocks, zoomedBlockId)
  if (rootIndex === -1) return true

  const { startIndex, endIndex } = getSubtreeRange(blocks, rootIndex)
  return targetIndex > rootIndex && targetIndex >= startIndex && targetIndex <= endIndex
}

/**
 * Build the transaction that performs a block drop. The source subtree is
 * removed and reinserted relative to the target in one transaction, with block
 * IDs and node content preserved.
 */
export function applyDrop(
  state: EditorState,
  sourcePos: number,
  targetPos: number,
  mode: DropMode,
): Transaction | null {
  const blocks = getOutlinerBlocks(state.doc)
  const sourceIndex = blockIndexAtPos(blocks, sourcePos)
  const targetIndex = blockIndexAtPos(blocks, targetPos)
  if (sourceIndex === -1 || targetIndex === -1) return null

  if (!isDropTargetAllowedUnderZoom(blocks, targetIndex, getZoomedBlockId(state))) return null

  const plan = planDrop(blocks, sourceIndex, targetIndex, mode)
  if (!plan) return null

  const sliceContent = state.doc.slice(plan.source.from, plan.source.to).content
  const shifted: ProseMirrorNode[] = []

  sliceContent.forEach((node) => {
    const indent = clampIndent(((node.attrs.indent as number) || 0) + plan.indentDelta)
    shifted.push(
      node.type.create(
        {
          ...node.attrs,
          indent,
        },
        node.content,
        node.marks,
      ),
    )
  })

  const tr = state.tr
  tr.delete(plan.source.from, plan.source.to)

  const mappedTargetPos = tr.mapping.map(targetPos, 1)
  const after = getOutlinerBlocks(tr.doc)
  const mappedTargetIndex = blockIndexAtPos(after, mappedTargetPos)
  if (mappedTargetIndex === -1) return null

  const target = after[mappedTargetIndex]
  let insertPos: number

  if (plan.mode === 'before') {
    insertPos = target.pos
  } else if (plan.mode === 'child') {
    insertPos = target.end
  } else {
    const targetIndent = target.indent
    insertPos = target.end
    for (let i = mappedTargetIndex + 1; i < after.length; i++) {
      if (after[i].indent <= targetIndent) break
      insertPos = after[i].end
    }
  }

  tr.insert(insertPos, Fragment.fromArray(shifted))
  return tr
}

interface DndState {
  sourcePos: number | null
  indicator: { pos: number; end: number; mode: DropMode } | null
}

const EMPTY_DND_STATE: DndState = { sourcePos: null, indicator: null }

export const blockDndKey = new PluginKey<DndState>('blockDnd')

function blockAtEvent(
  view: EditorView,
  event: { target: EventTarget | null },
): { dom: HTMLElement; pos: number } | null {
  const el = (event.target as HTMLElement | null)?.closest?.('[data-block-id]') as HTMLElement | null
  if (!el) return null

  try {
    const pos = view.posAtDOM(el, 0)
    const blockPos = view.state.doc.resolve(pos).before(1)
    const nodeDom = view.nodeDOM(blockPos)
    const blockDom =
      nodeDom instanceof HTMLElement
        ? nodeDom
        : nodeDom?.parentElement instanceof HTMLElement
          ? nodeDom.parentElement
          : el

    return { dom: blockDom, pos: blockPos }
  } catch {
    return null
  }
}

export function dropModeFromGeometry(
  rect: { top: number; height: number; left: number },
  clientX: number,
  clientY: number,
  childThresholdPx = 28,
): DropMode {
  const relativeY = (clientY - rect.top) / rect.height
  if (relativeY < 0.25) return 'before'
  if (relativeY > 0.75) return 'after'
  return clientX - rect.left > childThresholdPx ? 'child' : 'after'
}

export const BlockDnd = Extension.create({
  name: 'blockDnd',

  addProseMirrorPlugins() {
    return [
      new Plugin<DndState>({
        key: blockDndKey,
        state: {
          init: () => EMPTY_DND_STATE,
          apply(tr, previous) {
            const next = tr.getMeta(blockDndKey) as DndState | undefined
            return next ?? previous
          },
        },
        props: {
          decorations(state) {
            const blocks = getOutlinerBlocks(state.doc)
            const dndState = blockDndKey.getState(state)
            const decorations: Decoration[] = []

            for (const block of blocks) {
              const id = (block.node.attrs['data-block-id'] as string) || String(block.pos)
              decorations.push(
                Decoration.widget(
                  block.pos + 1,
                  () => {
                    const handle = document.createElement('span')
                    handle.className = 'block-drag-handle'
                    handle.setAttribute('draggable', 'true')
                    handle.setAttribute('contenteditable', 'false')
                    handle.setAttribute('aria-label', 'Drag to move block')
                    handle.title = 'Drag to move'
                    return handle
                  },
                  { side: -1, key: `block-drag-handle-${id}`, ignoreSelection: true },
                ),
              )
            }

            if (dndState?.sourcePos != null) {
              const index = blockIndexAtPos(blocks, dndState.sourcePos)
              if (index !== -1) {
                decorations.push(Decoration.node(blocks[index].pos, blocks[index].end, { class: 'block-dragging' }))
              }
            }

            if (dndState?.indicator) {
              decorations.push(
                Decoration.widget(
                  dndState.indicator.pos + 1,
                  () => {
                    const indicator = document.createElement('span')
                    indicator.className = 'block-drop-indicator'
                    indicator.setAttribute('data-mode', dndState.indicator!.mode)
                    indicator.setAttribute('contenteditable', 'false')
                    return indicator
                  },
                  {
                    side: -1,
                    key: `block-drop-indicator-${dndState.indicator.pos}-${dndState.indicator.mode}`,
                    ignoreSelection: true,
                  },
                ),
              )
            }

            return DecorationSet.create(state.doc, decorations)
          },
          handleDOMEvents: {
            dragstart: (view, event) => {
              if (!view.editable) return false
              if (!(event.target as HTMLElement | null)?.closest?.('.block-drag-handle')) return false

              const hit = blockAtEvent(view, event)
              if (!hit) return false

              event.dataTransfer?.setData('text/plain', '')
              if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'

              view.dispatch(view.state.tr.setMeta(blockDndKey, { sourcePos: hit.pos, indicator: null }))
              return false
            },
            dragover: (view, event) => {
              const dndState = blockDndKey.getState(view.state)
              if (dndState?.sourcePos == null) return false

              const hit = blockAtEvent(view, event)
              if (!hit) return false

              event.preventDefault()

              const mode = dropModeFromGeometry(hit.dom.getBoundingClientRect(), event.clientX, event.clientY)
              const blocks = getOutlinerBlocks(view.state.doc)
              const index = blockIndexAtPos(blocks, hit.pos)
              if (index === -1) return false

              if (!isDropTargetAllowedUnderZoom(blocks, index, getZoomedBlockId(view.state))) {
                if (dndState.indicator) {
                  view.dispatch(
                    view.state.tr.setMeta(blockDndKey, {
                      sourcePos: dndState.sourcePos,
                      indicator: null,
                    }),
                  )
                }
                return true
              }

              const indicator = { pos: blocks[index].pos, end: blocks[index].end, mode }
              const current = dndState.indicator
              if (current && current.pos === indicator.pos && current.mode === indicator.mode) return true

              view.dispatch(view.state.tr.setMeta(blockDndKey, { sourcePos: dndState.sourcePos, indicator }))
              return true
            },
            drop: (view, event) => {
              const dndState = blockDndKey.getState(view.state)
              if (dndState?.sourcePos == null) return false

              const hit = blockAtEvent(view, event)
              if (!hit) {
                view.dispatch(view.state.tr.setMeta(blockDndKey, EMPTY_DND_STATE))
                return false
              }

              event.preventDefault()

              const mode = dropModeFromGeometry(hit.dom.getBoundingClientRect(), event.clientX, event.clientY)
              const tr = applyDrop(view.state, dndState.sourcePos, hit.pos, mode)
              if (tr) {
                tr.setMeta(blockDndKey, EMPTY_DND_STATE)
                view.dispatch(tr)
              } else {
                view.dispatch(view.state.tr.setMeta(blockDndKey, EMPTY_DND_STATE))
              }
              return true
            },
            dragend: (view) => {
              if (blockDndKey.getState(view.state)?.sourcePos != null) {
                view.dispatch(view.state.tr.setMeta(blockDndKey, EMPTY_DND_STATE))
              }
              return false
            },
          },
        },
      }),
    ]
  },
})

export default BlockDnd
