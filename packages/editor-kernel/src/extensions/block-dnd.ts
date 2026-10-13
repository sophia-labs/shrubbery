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

/**
 * The element to resolve a document position from.
 *
 * NOT just closest([data-block-id]), and the difference is a real bug this
 * fixes. A TABLE carries no block id — only its cells do, deliberately ("the
 * wire source is the cell, not the table", block-id.ts) — so nothing in the
 * chain above a table's drag handle has one:
 *
 *     handle in : tbody < table < div.tableWrapper < div.tiptap
 *     closest   : NULL
 *
 * With a null hit, dragstart bails and sourcePos is never set, so the table
 * cannot be picked up at all. Verified through the real handler
 * (block-dnd-table-target.test.ts): buggy, sourcePos stays null; fixed, it is
 * the table's own position.
 *
 * A CORRECTION, because the first version of this comment was confidently
 * wrong and a wrong explanation is worse than none. It claimed the null also
 * stopped dragover from calling preventDefault(), and that the browser
 * therefore refused to deliver the drop. It does not: prosemirror-view merges
 * its own editHandlers.dragover into the same dispatch table, and that one
 * calls preventDefault() unconditionally whenever no plugin handler claims the
 * event (prosemirror-view/dist/index.js, initInput). The drop was always
 * delivered. What actually went wrong downstream is that OUR drop handler bails
 * on the null sourcePos, so the event falls through to ProseMirror's generic
 * slice-insert instead of the outliner-aware applyDrop — a different failure
 * reached by a different path, which happens to look identical from a chair.
 * Anyone optimising this later should know the browser was never the obstacle.
 *
 * The fallback is the nearest element that is a direct child of the editor
 * root: the top-level block wrapper whatever the node type — a paragraph, or a
 * .tableWrapper — which is exactly what .before(1) below resolves to a
 * top-level position. Nothing about the drop math changes; only the search for
 * a starting element stops assuming every block carries an id.
 *
 * WHEN THE FALLBACK FIRES is a coincidence between two lists that are
 * maintained separately, and worth knowing before adding a node type: `table`
 * is in OUTLINER_NODE_TYPES (outliner-tree.ts) but deliberately absent from
 * BASE_BLOCK_TYPES (block-id.ts). Every other block type appears in both and is
 * caught by the first branch. Add a draggable type to the first list without
 * the second and it will quietly start depending on this geometric path rather
 * than failing loudly as a missing id.
 *
 * One element genuinely does sit as a direct child of the root: ProseMirror's
 * gapcursor widget, which StarterKit leaves enabled on the document profile.
 * The walk can return it. That resolves safely rather than corrupting anything
 * — ResolvedPos.before special-cases a depth+1 resolve by returning the
 * position unchanged, which in this flat schema is the start of the following
 * block — and at the end of the document blockIndexAtPos returns -1 and the
 * drag fails closed exactly as it did before.
 */
function dragAnchorElement(view: EditorView, target: EventTarget | null): HTMLElement | null {
  const el = target as HTMLElement | null
  const identified = el?.closest?.('[data-block-id]') as HTMLElement | null
  if (identified) return identified
  const root = view.dom as HTMLElement
  let node: HTMLElement | null = el
  while (node && node !== root) {
    if (node.parentElement === root) return node
    node = node.parentElement
  }
  return null
}

function blockAtEvent(
  view: EditorView,
  event: { target: EventTarget | null },
): { dom: HTMLElement; pos: number } | null {
  const positional = (event.target as HTMLElement | null)?.closest?.('[data-outliner-pos]') as HTMLElement | null
  if (positional) {
    const pos = Number(positional.dataset.outlinerPos)
    const dom = view.nodeDOM(pos)
    if (Number.isInteger(pos) && dom instanceof HTMLElement) return { dom, pos }
  }
  const el = dragAnchorElement(view, event.target)
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
              if (!view.editable) { event.preventDefault(); return false }
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
