import { afterEach, describe, expect, it } from 'vitest'
import { Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { createKernelEditor } from '../index'
import {
  applyDrop,
  blockDndKey,
  dropModeFromGeometry,
  isDropTargetAllowedUnderZoom,
} from '../extensions/block-dnd'
import { applyZoomInto, createZoomPlugin } from '../extensions/outliner-zoom'
import { getOutlinerBlocks, planDrop, type DropMode } from '../outliner-tree'

const blockAttrs = {
  indent: { default: 0 },
  collapsed: { default: false },
  'data-block-id': { default: null },
}

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: blockAttrs,
      toDOM: () => ['p', 0],
    },
    listItem: {
      group: 'block',
      content: '(paragraph | codeBlock)+',
      attrs: {
        ...blockAttrs,
        listType: { default: 'bullet' },
        checked: { default: false },
      },
      toDOM: () => ['li', 0],
    },
    codeBlock: {
      group: 'block',
      content: 'text*',
      code: true,
      toDOM: () => ['pre', ['code', 0]],
    },
    text: { group: 'inline' },
  },
})

const mountedEditors: ReturnType<typeof createKernelEditor>[] = []

afterEach(() => {
  while (mountedEditors.length) mountedEditors.pop()?.destroy()
  document.body.innerHTML = ''
})

function paragraph(text: string, indent = 0, blockId?: string): ProseMirrorNode {
  return schema.node(
    'paragraph',
    { indent, collapsed: false, 'data-block-id': blockId ?? null },
    schema.text(text),
  )
}

function codeBlock(text: string): ProseMirrorNode {
  return schema.node('codeBlock', null, schema.text(text))
}

function listItem(
  text: string,
  indent = 0,
  blockId?: string,
  extraContent: ProseMirrorNode[] = [],
): ProseMirrorNode {
  return schema.node(
    'listItem',
    {
      indent,
      collapsed: false,
      'data-block-id': blockId ?? null,
      listType: 'task',
      checked: true,
    },
    [paragraph(text), ...extraContent],
  )
}

function makeState(blocks: ProseMirrorNode[], plugins: Parameters<typeof EditorState.create>[0]['plugins'] = []): EditorState {
  return EditorState.create({ schema, doc: schema.node('doc', null, blocks), plugins })
}

function labelOf(node: ProseMirrorNode): string {
  return node.type.name === 'listItem' ? node.child(0).textContent : node.textContent
}

function posOf(state: EditorState, label: string): number {
  const block = getOutlinerBlocks(state.doc).find((candidate) => labelOf(candidate.node) === label)
  if (!block) throw new Error(`block not found: ${label}`)
  return block.pos
}

function drop(state: EditorState, source: string, target: string, mode: DropMode): EditorState {
  const tr = applyDrop(state, posOf(state, source), posOf(state, target), mode)
  if (!tr) throw new Error('drop returned null')
  return state.apply(tr)
}

function order(state: EditorState): Array<[string, number, string]> {
  const out: Array<[string, number, string]> = []
  state.doc.forEach((node) => {
    out.push([labelOf(node), node.attrs.indent as number, node.type.name])
  })
  return out
}

function mountKernelEditor(): ReturnType<typeof createKernelEditor> {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = createKernelEditor(element)
  mountedEditors.push(editor)
  return editor
}

describe('dropModeFromGeometry', () => {
  const rect = { top: 100, height: 40, left: 0 }

  it('maps the top and bottom quarters to before and after', () => {
    expect(dropModeFromGeometry(rect, 50, 105)).toBe('before')
    expect(dropModeFromGeometry(rect, 50, 135)).toBe('after')
  })

  it('maps the middle band to child only when the pointer is indented right', () => {
    expect(dropModeFromGeometry(rect, 60, 120)).toBe('child')
    expect(dropModeFromGeometry(rect, 10, 120)).toBe('after')
  })
})

describe('planDrop validity and indent math', () => {
  const blocks = getOutlinerBlocks(
    makeState([paragraph('A'), paragraph('B', 1), paragraph('C', 2), paragraph('D')]).doc,
  )

  it('rejects dropping a block into itself or its own descendant', () => {
    expect(planDrop(blocks, 0, 0, 'after')).toBeNull()
    expect(planDrop(blocks, 0, 2, 'child')).toBeNull()
  })

  it('computes the uniform indent delta for child and sibling drops', () => {
    expect(planDrop(blocks, 3, 1, 'child')?.indentDelta).toBe(2)
    expect(planDrop(blocks, 3, 1, 'after')?.indentDelta).toBe(1)
  })

  it('rejects drops that would exceed the maximum indent', () => {
    const deep = getOutlinerBlocks(makeState([paragraph('X', 6), paragraph('Y')]).doc)
    expect(planDrop(deep, 1, 0, 'child')).toBeNull()
  })
})

describe('zoom-aware drop guard', () => {
  it('allows only descendants of the zoomed root as targets', () => {
    const blocks = getOutlinerBlocks(
      makeState([
        paragraph('A', 0, 'block-a'),
        paragraph('B', 1, 'block-b'),
        paragraph('C', 1, 'block-c'),
        paragraph('D', 0, 'block-d'),
      ]).doc,
    )

    expect(isDropTargetAllowedUnderZoom(blocks, 0, 'block-a')).toBe(false)
    expect(isDropTargetAllowedUnderZoom(blocks, 1, 'block-a')).toBe(true)
    expect(isDropTargetAllowedUnderZoom(blocks, 2, 'block-a')).toBe(true)
    expect(isDropTargetAllowedUnderZoom(blocks, 3, 'block-a')).toBe(false)
    expect(isDropTargetAllowedUnderZoom(blocks, 3, null)).toBe(true)
    expect(isDropTargetAllowedUnderZoom(blocks, 3, 'block-missing')).toBe(true)
  })
})

describe('applyDrop', () => {
  it('drops a block as the first child of the target', () => {
    let state = makeState([paragraph('A'), paragraph('B', 1), paragraph('C', 2), paragraph('D')])
    state = drop(state, 'D', 'A', 'child')

    expect(order(state)).toEqual([
      ['A', 0, 'paragraph'],
      ['D', 1, 'paragraph'],
      ['B', 1, 'paragraph'],
      ['C', 2, 'paragraph'],
    ])
  })

  it('drops a subtree after a sibling and shifts descendant indents', () => {
    let state = makeState([paragraph('A'), paragraph('B', 1), paragraph('C', 2), paragraph('D')])
    state = drop(state, 'B', 'D', 'after')

    expect(order(state)).toEqual([
      ['A', 0, 'paragraph'],
      ['D', 0, 'paragraph'],
      ['B', 0, 'paragraph'],
      ['C', 1, 'paragraph'],
    ])
  })

  it('drops before a target using the target sibling indent', () => {
    let state = makeState([paragraph('A'), paragraph('B', 1), paragraph('C', 2), paragraph('D')])
    state = drop(state, 'D', 'B', 'before')

    expect(order(state)).toEqual([
      ['A', 0, 'paragraph'],
      ['D', 1, 'paragraph'],
      ['B', 1, 'paragraph'],
      ['C', 2, 'paragraph'],
    ])
  })

  it('preserves block ids through a drop', () => {
    let state = makeState([
      paragraph('A', 0, 'block-a'),
      paragraph('B', 1, 'block-b'),
      paragraph('C', 2, 'block-c'),
      paragraph('D', 0, 'block-d'),
    ])

    state = drop(state, 'B', 'D', 'after')

    const ids: string[] = []
    state.doc.descendants((node) => {
      if (node.type.name === 'paragraph') ids.push(node.attrs['data-block-id'] as string)
    })

    expect(ids).toEqual(['block-a', 'block-d', 'block-b', 'block-c'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('preserves list-item attrs and nested block content while moving a subtree', () => {
    let state = makeState([
      paragraph('A'),
      listItem('Task', 1, 'block-task', [codeBlock('code()')]),
      paragraph('Child', 2, 'block-child'),
      paragraph('D'),
    ])

    state = drop(state, 'Task', 'D', 'after')

    expect(order(state)).toEqual([
      ['A', 0, 'paragraph'],
      ['D', 0, 'paragraph'],
      ['Task', 0, 'listItem'],
      ['Child', 1, 'paragraph'],
    ])

    const moved = state.doc.child(2)
    expect(moved.type.name).toBe('listItem')
    expect(moved.attrs['data-block-id']).toBe('block-task')
    expect(moved.attrs.listType).toBe('task')
    expect(moved.attrs.checked).toBe(true)
    expect(moved.childCount).toBe(2)
    expect(moved.child(0).textContent).toBe('Task')
    expect(moved.child(1).type.name).toBe('codeBlock')
    expect(moved.child(1).textContent).toBe('code()')
  })

  it('returns null for an invalid drop into the source subtree', () => {
    const state = makeState([paragraph('A'), paragraph('B', 1), paragraph('C', 2), paragraph('D')])
    expect(applyDrop(state, posOf(state, 'A'), posOf(state, 'C'), 'child')).toBeNull()
  })

  it('rejects a drop target outside the active zoom subtree', () => {
    let state = makeState(
      [
        paragraph('A', 0, 'block-a'),
        paragraph('B', 1, 'block-b'),
        paragraph('C', 1, 'block-c'),
        paragraph('D', 0, 'block-d'),
      ],
      [createZoomPlugin()],
    )
    const zoom = applyZoomInto(state, 'block-a')
    if (zoom === false) throw new Error('zoom setup failed')
    state = state.apply(zoom)

    expect(applyDrop(state, posOf(state, 'B'), posOf(state, 'D'), 'after')).toBeNull()

    const allowed = applyDrop(state, posOf(state, 'B'), posOf(state, 'C'), 'after')
    expect(allowed).not.toBeNull()
  })
})

describe('BlockDnd DOM affordances from Garden PR #4', () => {
  it('renders accessible noneditable drag handles for outliner blocks', () => {
    const editor = mountKernelEditor()
    editor.commands.setContent('<p data-block-id="block-a">A</p><p data-block-id="block-b">B</p>')

    const handles = Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.block-drag-handle'))

    expect(handles).toHaveLength(2)
    expect(handles[0].getAttribute('draggable')).toBe('true')
    expect(handles[0].getAttribute('contenteditable')).toBe('false')
    expect(handles[0].getAttribute('aria-label')).toBe('Drag to move block')
  })

  it('renders the drop indicator as a dedicated widget, not a block pseudo-element', () => {
    const editor = mountKernelEditor()
    editor.commands.setContent('<p data-block-id="block-a">A</p><p data-block-id="block-b">B</p>')
    const blocks = getOutlinerBlocks(editor.state.doc)
    const source = blocks.find((block) => block.node.textContent === 'A')
    const target = blocks.find((block) => block.node.textContent === 'B')
    if (!source || !target) throw new Error('test blocks did not render')

    editor.view.dispatch(
      editor.state.tr.setMeta(blockDndKey, {
        sourcePos: source.pos,
        indicator: { pos: target.pos, end: target.end, mode: 'after' },
      }),
    )

    const indicators = Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.block-drop-indicator'))

    expect(indicators).toHaveLength(1)
    expect(indicators[0].getAttribute('data-mode')).toBe('after')
    expect(indicators[0].getAttribute('contenteditable')).toBe('false')
  })
})
