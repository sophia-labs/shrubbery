import { afterEach, describe, expect, it } from 'vitest'
import { Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { createKernelEditor } from '../index'
import {
  applyDeleteSelection,
  applyExtend,
  applyReindent,
  applySelectAll,
  applySelectCurrentBlock,
  applySelectParent,
  blockSelectionKey,
  createBlockSelectionPlugin,
  isEditorOverlayOpen,
  selectionMetaForClick,
  setSelectionMeta,
} from '../extensions/block-selection'
import { expandSelectionRange, getOutlinerBlocks } from '../outliner-tree'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: {
        indent: { default: 0 },
        collapsed: { default: false },
        'data-block-id': { default: null },
      },
      toDOM: () => ['p', 0],
    },
    text: { group: 'inline' },
  },
})

const mountedEditors: ReturnType<typeof createKernelEditor>[] = []

afterEach(() => {
  while (mountedEditors.length) mountedEditors.pop()?.destroy()
  document.body.innerHTML = ''
})

function para(
  text: string,
  indent = 0,
  collapsed = false,
  blockId: string | null = null,
): ProseMirrorNode {
  return schema.node('paragraph', { indent, collapsed, 'data-block-id': blockId }, schema.text(text))
}

function makeState(blocks: ProseMirrorNode[]): EditorState {
  return EditorState.create({
    schema,
    doc: schema.node('doc', null, blocks),
    plugins: [createBlockSelectionPlugin()],
  })
}

function caretIn(state: EditorState, label: string): EditorState {
  let pos = -1
  state.doc.descendants((node, nodePos) => {
    if (node.type.name === 'paragraph' && node.textContent === label) pos = nodePos + 1
  })
  if (pos === -1) throw new Error(`block not found: ${label}`)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

function selectedLabels(state: EditorState): string[] {
  const value = blockSelectionKey.getState(state)
  if (!value || value.anchor === null || value.head === null) return []

  const blocks = getOutlinerBlocks(state.doc)
  const anchorIdx = blocks.findIndex((block) => value.anchor! >= block.pos && value.anchor! < block.end)
  const headIdx = blocks.findIndex((block) => value.head! >= block.pos && value.head! < block.end)
  if (anchorIdx === -1 || headIdx === -1) return []

  const range = expandSelectionRange(blocks, anchorIdx, headIdx)
  return blocks.slice(range.startIndex, range.endIndex + 1).map((block) => block.node.textContent)
}

function mountKernelEditor(
  opts: Parameters<typeof createKernelEditor>[1] = {},
): ReturnType<typeof createKernelEditor> {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = createKernelEditor(element, opts)
  mountedEditors.push(editor)
  return editor
}

function pressEscape(editor: ReturnType<typeof createKernelEditor>): boolean {
  let handled = false
  editor.view.someProp('handleKeyDown', (fn) => {
    handled = fn(editor.view, new KeyboardEvent('keydown', { key: 'Escape' })) || handled
    return handled
  })
  return handled
}

function order(state: EditorState): Array<[string, number]> {
  const out: Array<[string, number]> = []
  state.doc.forEach((node) => out.push([node.textContent, node.attrs.indent as number]))
  return out
}

describe('block selection state machine', () => {
  it('selects the current block from the caret', () => {
    let state = makeState([para('A'), para('B'), para('C')])
    state = caretIn(state, 'B')
    state = state.apply(applySelectCurrentBlock(state) as never)

    expect(selectedLabels(state)).toEqual(['B'])
  })

  it('extends down and up over visible blocks', () => {
    let state = makeState([para('A'), para('B'), para('C')])
    state = caretIn(state, 'A')
    state = state.apply(applySelectCurrentBlock(state) as never)
    state = state.apply(applyExtend(state, 'down') as never)
    expect(selectedLabels(state)).toEqual(['A', 'B'])

    state = state.apply(applyExtend(state, 'down') as never)
    expect(selectedLabels(state)).toEqual(['A', 'B', 'C'])

    state = state.apply(applyExtend(state, 'up') as never)
    expect(selectedLabels(state)).toEqual(['A', 'B'])
  })

  it('selecting a collapsed parent covers its hidden subtree and skips it when extending', () => {
    let state = makeState([para('A', 0, true), para('B', 1), para('C')])
    state = caretIn(state, 'A')
    state = state.apply(applySelectCurrentBlock(state) as never)

    expect(selectedLabels(state)).toEqual(['A', 'B'])

    state = state.apply(applyExtend(state, 'down') as never)
    expect(selectedLabels(state)).toEqual(['A', 'B', 'C'])
  })

  it('clears block selection when the document changes without block-selection meta', () => {
    let state = makeState([para('A'), para('B')])
    state = caretIn(state, 'A')
    state = state.apply(applySelectCurrentBlock(state) as never)
    expect(blockSelectionKey.getState(state)?.anchor).not.toBeNull()

    state = state.apply(state.tr.insertText('x', 1))

    expect(blockSelectionKey.getState(state)?.anchor).toBeNull()
  })
})

describe('block selection structural operations', () => {
  it('deletes selected subtrees as whole units', () => {
    let state = makeState([para('A'), para('B', 1), para('C')])
    state = caretIn(state, 'A')
    state = state.apply(applySelectCurrentBlock(state) as never)
    state = state.apply(applyDeleteSelection(state) as never)

    expect(order(state)).toEqual([['C', 0]])
  })

  it('indents every selected block while preserving relative hierarchy', () => {
    let state = makeState([para('A'), para('B', 1)])
    state = caretIn(state, 'A')
    state = state.apply(applySelectCurrentBlock(state) as never)
    state = state.apply(applyReindent(state, +1) as never)

    expect(order(state)).toEqual([
      ['A', 1],
      ['B', 2],
    ])
    expect(selectedLabels(state)).toEqual(['A', 'B'])
  })

  it('refuses to outdent when a selection root is already at indent zero', () => {
    let state = makeState([para('A'), para('B', 1)])
    state = caretIn(state, 'A')
    state = state.apply(applySelectCurrentBlock(state) as never)

    expect(applyReindent(state, -1)).toBeNull()
  })

  it('does not act when there is no block selection', () => {
    let state = makeState([para('A')])
    state = caretIn(state, 'A')

    expect(applyExtend(state, 'down')).toBe(false)
    expect(applyDeleteSelection(state)).toBe(false)
    expect(applyReindent(state, +1)).toBe(false)
  })
})

describe('block selection select-all and select-parent', () => {
  it('selects all top-level outliner blocks', () => {
    let state = makeState([para('A'), para('B', 1), para('C')])
    state = state.apply(applySelectAll(state) as never)

    expect(selectedLabels(state)).toEqual(['A', 'B', 'C'])
  })

  it('collapses the selection to the parent block', () => {
    let state = makeState([para('A'), para('B', 1), para('C', 2)])
    state = caretIn(state, 'C')
    state = state.apply(applySelectCurrentBlock(state) as never)
    expect(selectedLabels(state)).toEqual(['C'])

    state = state.apply(applySelectParent(state) as never)
    expect(selectedLabels(state)).toEqual(['B', 'C'])

    state = state.apply(applySelectParent(state) as never)
    expect(selectedLabels(state)).toEqual(['A', 'B', 'C'])
  })

  it('select-parent is a no-op at the top level', () => {
    let state = makeState([para('A'), para('B', 1)])
    state = caretIn(state, 'A')
    state = state.apply(applySelectCurrentBlock(state) as never)

    expect(applySelectParent(state)).toBeNull()
  })

  it('select-parent works from the caret without an active block selection', () => {
    let state = makeState([para('A'), para('B', 1)])
    state = caretIn(state, 'B')
    state = state.apply(applySelectParent(state) as never)

    expect(selectedLabels(state)).toEqual(['A', 'B'])
  })
})

describe('block selection handle-click metadata', () => {
  function blockPos(state: EditorState, label: string): number {
    const block = getOutlinerBlocks(state.doc).find((candidate) => candidate.node.textContent === label)
    if (!block) throw new Error(`block not found: ${label}`)
    return block.pos
  }

  it('plain click anchors on the clicked block', () => {
    const state = makeState([para('A'), para('B'), para('C')])

    expect(selectionMetaForClick(state, blockPos(state, 'B'), false)).toEqual({
      anchor: blockPos(state, 'B'),
      head: blockPos(state, 'B'),
    })
  })

  it('shift-click extends from the existing anchor', () => {
    let state = makeState([para('A'), para('B'), para('C')])
    state = state.apply(
      setSelectionMeta(state.tr, { anchor: blockPos(state, 'A'), head: blockPos(state, 'A') }),
    )

    expect(selectionMetaForClick(state, blockPos(state, 'C'), true)).toEqual({
      anchor: blockPos(state, 'A'),
      head: blockPos(state, 'C'),
    })
  })

  it('shift-click without an existing anchor falls back to a plain anchor', () => {
    const state = makeState([para('A'), para('B')])

    expect(selectionMetaForClick(state, blockPos(state, 'B'), true)).toEqual({
      anchor: blockPos(state, 'B'),
      head: blockPos(state, 'B'),
    })
  })
})

describe('block selection pure integration seams', () => {
  it('reports no editor overlay open without a supplied gate', () => {
    const state = makeState([para('A')])

    expect(isEditorOverlayOpen(state)).toBe(false)
  })

  it('delegates overlay state to the supplied dependency-free gate', () => {
    const state = makeState([para('A')])

    expect(isEditorOverlayOpen(state, () => true)).toBe(true)
  })

  it('threads KernelOptions.isOverlayOpen into Escape handling', () => {
    const gated = mountKernelEditor({ isOverlayOpen: () => true })
    gated.commands.setContent('<p>Alpha</p>')
    gated.commands.setTextSelection(1)

    expect(pressEscape(gated)).toBe(false)
    expect(blockSelectionKey.getState(gated.state)?.anchor).toBeNull()

    const ungated = mountKernelEditor({ isOverlayOpen: () => false })
    ungated.commands.setContent('<p>Beta</p>')
    ungated.commands.setTextSelection(1)

    expect(pressEscape(ungated)).toBe(true)
    expect(blockSelectionKey.getState(ungated.state)?.anchor).not.toBeNull()
  })

  it('keeps Shift+Arrow extension inside a supplied zoom root subtree', () => {
    let state = makeState([
      para('A', 0, false, 'a'),
      para('B', 1, false, 'b'),
      para('C', 1, false, 'c'),
      para('D', 0, false, 'd'),
    ])
    state = caretIn(state, 'B')
    state = state.apply(applySelectCurrentBlock(state) as never)
    state = state.apply(applyExtend(state, 'down', { getZoomedBlockId: () => 'a' }) as never)
    expect(selectedLabels(state)).toEqual(['B', 'C'])

    expect(applyExtend(state, 'down', { getZoomedBlockId: () => 'a' })).toBeNull()
  })
})
