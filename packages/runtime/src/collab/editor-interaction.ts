/** Small view/selection adapters for the host's block and formatting controls. */
import type { Editor } from '@tiptap/core'
import { getOutlinerBlocks, getSubtreeRange, planMoveUp, planMoveDown, MAX_INDENT } from '@shrubbery/editor-kernel'

export function editorBlockContext(value: unknown, id: string, pos?: number | null) {
  const blocks = getOutlinerBlocks((value as Editor).state.doc)
  const index = blocks.findIndex(block => id ? block.node.attrs['data-block-id'] === id : block.pos === pos)
  if (index < 0) return null
  const block = blocks[index]
  const range = getSubtreeRange(blocks, index)
  return {
    type: block.node.type.name === 'heading' ? `Heading ${block.node.attrs.level}` : block.node.type.name === 'listItem' ? `${block.node.attrs.listType} item` : block.node.type.name,
    level: block.indent + 1,
    children: range.endIndex - range.startIndex,
    up: !!planMoveUp(blocks, index), down: !!planMoveDown(blocks, index),
    indent: block.indent < MAX_INDENT, outdent: block.indent > 0,
  }
}

export function placeCaretInBlock(value: unknown, pos: number): void {
  const editor = value as Editor
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return
  if (editor.state.selection.from > pos && editor.state.selection.to < pos + node.nodeSize) return
  let first: number | null = null
  editor.state.doc.nodesBetween(pos, pos + node.nodeSize, (child, at) => {
    if (first !== null) return false
    if (child.isTextblock) { first = at + 1; return false }
    return true
  })
  if (first !== null) editor.commands.setTextSelection(first)
  else editor.commands.setNodeSelection(pos)
}

/** A toolbar borrows focus, never the identity of the editor's selection. */
export function captureEditorSelection(value: unknown): { restore(): boolean; destroy(): void } {
  const editor = value as Editor
  let bookmark = editor.state.selection.getBookmark()
  let alive = true
  let valid = true
  const ids = new Set<string>()
  const endpoint = (pos: number) => {
    const resolved = editor.state.doc.resolve(pos)
    for (let depth = resolved.depth; depth > 0; depth--) {
      const node = resolved.node(depth)
      const id = node.attrs['data-block-id'] as string | undefined
      if (id) return { id, start: resolved.before(depth), size: node.nodeSize, pos }
    }
    return null
  }
  const textSelection = editor.state.selection.toJSON().type === 'text'
  const nodeSelection = editor.state.selection.toJSON().type === 'node'
  const selectedNodeId = nodeSelection ? editor.state.doc.nodeAt(editor.state.selection.from)?.attrs['data-block-id'] as string | undefined : undefined
  let selectedNodePos = editor.state.selection.from
  const anchor = textSelection ? endpoint(editor.state.selection.anchor) : null
  const head = textSelection ? endpoint(editor.state.selection.head) : null
  editor.state.doc.nodesBetween(editor.state.selection.from, editor.state.selection.to, (node) => {
    if (node.attrs['data-block-id']) ids.add(node.attrs['data-block-id'])
  })
  const map = ({ transaction }: { transaction: Editor['state']['tr'] }) => {
    bookmark = bookmark.map(transaction.mapping)
    if (!transaction.docChanged) return
    if (nodeSelection && !selectedNodeId) valid = false
    const blocks = new Map<string, { pos: number; size: number }>()
    transaction.doc.descendants((node, pos) => {
      if (node.attrs['data-block-id']) blocks.set(node.attrs['data-block-id'], { pos, size: node.nodeSize })
    })
    if ([...ids].some(id => !blocks.has(id))) valid = false
    if (selectedNodeId) {
      const selected = blocks.get(selectedNodeId)
      if (selected) selectedNodePos = selected.pos
      else valid = false
    }
    for (const point of [anchor, head]) {
      if (!point) continue
      const block = blocks.get(point.id)
      if (!block) { valid = false; continue }
      const replaced = transaction.mapping.mapResult(point.start, 1).deleted &&
        transaction.mapping.mapResult(point.start + point.size, -1).deleted
      const mapped = transaction.mapping.map(point.pos)
      const offset = replaced || mapped <= block.pos || mapped >= block.pos + block.size
        ? point.pos - point.start : mapped - block.pos
      point.pos = block.pos + Math.max(1, Math.min(block.size - 1, offset))
      point.start = block.pos
      point.size = block.size
    }
  }
  editor.on('transaction', map)
  const destroy = () => {
    if (!alive) return
    alive = false
    editor.off('transaction', map)
  }
  return {
    destroy,
    restore() {
      if (!alive || editor.isDestroyed) return false
      destroy()
      if (!valid) return false
      const remaining = new Set<string>()
      editor.state.doc.descendants(node => {
        if (node.attrs['data-block-id']) remaining.add(node.attrs['data-block-id'])
      })
      // A deleted target must never silently become the adjacent block.
      if ([...ids].some(id => !remaining.has(id))) return false
      if (anchor && head) editor.commands.setTextSelection({ from: anchor.pos, to: head.pos })
      else if (selectedNodeId) editor.commands.setNodeSelection(selectedNodePos)
      else editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc)))
      return true
    },
  }
}
