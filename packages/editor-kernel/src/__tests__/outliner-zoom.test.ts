import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { DecorationSet } from '@tiptap/pm/view'
import { getOutlinerBlocks } from '../outliner-tree'
import {
  applyZoomCurrent,
  applyZoomInto,
  applyZoomOut,
  applyZoomToParent,
  createZoomPlugin,
  getZoomedBlockId,
  isZoomActive,
  zoomKey,
  zoomParentId,
  zoomTargetIdAtSelection,
} from '../extensions/outliner-zoom'

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
    listItem: {
      group: 'block',
      content: 'paragraph+',
      attrs: {
        indent: { default: 0 },
        collapsed: { default: false },
        'data-block-id': { default: null },
        listType: { default: 'bullet' },
        checked: { default: false },
      },
      toDOM: () => ['li', 0],
    },
    text: { group: 'inline' },
  },
})

interface BlockSpec {
  text: string
  indent?: number
  collapsed?: boolean
  id?: string | null
  type?: 'paragraph' | 'listItem'
}

function paragraph(text: string, attrs: Record<string, unknown> | null = null): ProseMirrorNode {
  return schema.node('paragraph', attrs, schema.text(text))
}

function block(spec: BlockSpec): ProseMirrorNode {
  const attrs = {
    indent: spec.indent ?? 0,
    collapsed: spec.collapsed ?? false,
    'data-block-id': spec.id ?? null,
  }

  if (spec.type === 'listItem') {
    return schema.node(
      'listItem',
      { ...attrs, listType: 'bullet', checked: false },
      paragraph(spec.text),
    )
  }

  return paragraph(spec.text, attrs)
}

function makeState(specs: BlockSpec[]): EditorState {
  return EditorState.create({
    schema,
    doc: schema.node('doc', null, specs.map(block)),
    plugins: [createZoomPlugin()],
  })
}

function apply(state: EditorState, tr: ReturnType<typeof applyZoomInto>): EditorState {
  expect(tr).not.toBe(false)
  return state.apply(tr as Exclude<typeof tr, false>)
}

function caretIn(state: EditorState, label: string): EditorState {
  let pos = -1
  state.doc.descendants((node, nodePos) => {
    if (node.type.name === 'paragraph' && node.textContent === label) {
      pos = nodePos + 1
      return false
    }
    return true
  })
  if (pos === -1) throw new Error(`block not found: ${label}`)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

function zoomClassesByIndex(state: EditorState): string[][] {
  const plugin = zoomKey.get(state)
  const decorations = plugin?.props.decorations?.call(plugin, state) as DecorationSet | undefined
  const allDecorations =
    decorations?.find() as
      | Array<{
          from: number
          type: { attrs?: { class?: string } }
        }>
      | undefined
  const blocks = getOutlinerBlocks(state.doc)

  return blocks.map((outlinerBlock) =>
    (allDecorations ?? [])
      .filter((decoration) => decoration.from === outlinerBlock.pos)
      .map((decoration) => decoration.type.attrs?.class)
      .filter((className): className is string => typeof className === 'string')
      .sort(),
  )
}

describe('outliner zoom state', () => {
  it('zooms into a stable block id and clears back out', () => {
    let state = makeState([
      { text: 'A', id: 'block-a' },
      { text: 'B', indent: 1, id: 'block-b' },
      { text: 'C', id: 'block-c' },
    ])

    expect(isZoomActive(state)).toBe(false)
    state = apply(state, applyZoomInto(state, 'block-a'))
    expect(getZoomedBlockId(state)).toBe('block-a')
    expect(isZoomActive(state)).toBe(true)

    state = apply(state, applyZoomOut(state))
    expect(getZoomedBlockId(state)).toBeNull()
    expect(isZoomActive(state)).toBe(false)
  })

  it('zooms into the current top-level outliner block', () => {
    let state = makeState([
      { text: 'A', id: 'block-a' },
      { text: 'B', indent: 1, id: 'block-b' },
    ])

    state = caretIn(state, 'B')
    expect(zoomTargetIdAtSelection(state)).toBe('block-b')

    state = apply(state, applyZoomCurrent(state))
    expect(getZoomedBlockId(state)).toBe('block-b')
  })

  it('targets a direct list item when the caret is inside its paragraph', () => {
    let state = makeState([{ text: 'Task', id: 'block-task', type: 'listItem' }])

    state = caretIn(state, 'Task')

    expect(zoomTargetIdAtSelection(state)).toBe('block-task')
  })

  it('rejects missing ids, empty ids, and re-zooming the active block', () => {
    let state = makeState([{ text: 'A', id: 'block-a' }])

    expect(applyZoomInto(state, '')).toBe(false)
    expect(applyZoomInto(state, 'block-missing')).toBe(false)

    state = apply(state, applyZoomInto(state, 'block-a'))

    expect(applyZoomInto(state, 'block-a')).toBe(false)
  })

  it('treats zoomOut as a no-op when not zoomed', () => {
    const state = makeState([{ text: 'A', id: 'block-a' }])

    expect(applyZoomOut(state)).toBe(false)
  })
})

describe('outliner zoom decorations', () => {
  it('hides every block outside the focused subtree and marks the root', () => {
    let state = makeState([
      { text: 'A', id: 'block-a' },
      { text: 'B', indent: 1, id: 'block-b' },
      { text: 'C', indent: 2, id: 'block-c' },
      { text: 'D', indent: 1, id: 'block-d' },
      { text: 'E', id: 'block-e' },
    ])

    state = apply(state, applyZoomInto(state, 'block-b'))

    expect(zoomClassesByIndex(state)).toEqual([
      ['outliner-zoom-hidden'],
      ['outliner-zoom-root'],
      [],
      ['outliner-zoom-hidden'],
      ['outliner-zoom-hidden'],
    ])
  })

  it('removes zoom decorations when zoom clears', () => {
    let state = makeState([
      { text: 'A', id: 'block-a' },
      { text: 'B', indent: 1, id: 'block-b' },
    ])

    state = apply(state, applyZoomInto(state, 'block-a'))
    expect(zoomClassesByIndex(state).flat()).not.toEqual([])

    state = apply(state, applyZoomOut(state))
    expect(zoomClassesByIndex(state).flat()).toEqual([])
  })

  it('renders unfocused when the zoomed root no longer exists', () => {
    let state = makeState([
      { text: 'A', id: 'block-a' },
      { text: 'B', id: 'block-b' },
    ])

    state = apply(state, applyZoomInto(state, 'block-b'))
    const blocks = getOutlinerBlocks(state.doc)
    state = state.apply(state.tr.delete(blocks[1].pos, blocks[1].end))

    expect(getZoomedBlockId(state)).toBe('block-b')
    expect(zoomClassesByIndex(state).flat()).toEqual([])
  })

  it('leaves collapsed descendants inside the focused subtree to the outliner plugin', () => {
    let state = makeState([
      { text: 'A', id: 'block-a' },
      { text: 'B', indent: 1, collapsed: true, id: 'block-b' },
      { text: 'C', indent: 2, id: 'block-c' },
    ])

    state = apply(state, applyZoomInto(state, 'block-b'))

    expect(zoomClassesByIndex(state)).toEqual([
      ['outliner-zoom-hidden'],
      ['outliner-zoom-root'],
      [],
    ])
  })
})

describe('outliner zoom parent navigation', () => {
  it('zooms out one ancestor at a time by stable id', () => {
    let state = makeState([
      { text: 'A', id: 'block-a' },
      { text: 'B', indent: 1, id: 'block-b' },
      { text: 'C', indent: 2, id: 'block-c' },
    ])

    state = apply(state, applyZoomInto(state, 'block-c'))
    expect(zoomParentId(state)).toBe('block-b')

    state = apply(state, applyZoomToParent(state))
    expect(getZoomedBlockId(state)).toBe('block-b')
    expect(zoomParentId(state)).toBe('block-a')

    state = apply(state, applyZoomToParent(state))
    expect(getZoomedBlockId(state)).toBe('block-a')

    state = apply(state, applyZoomToParent(state))
    expect(getZoomedBlockId(state)).toBeNull()
  })
})
