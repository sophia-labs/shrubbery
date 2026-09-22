import { describe, expect, it } from 'vitest'
import { Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { moveBlock, setCollapsedAll } from '../extensions/outliner'

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

function para(text: string, indent = 0, blockId?: string): ProseMirrorNode {
  return schema.node(
    'paragraph',
    { indent, collapsed: false, 'data-block-id': blockId ?? null },
    schema.text(text),
  )
}

function makeState(blocks: ProseMirrorNode[]): EditorState {
  return EditorState.create({ schema, doc: schema.node('doc', null, blocks) })
}

function selectBlock(state: EditorState, label: string): EditorState {
  let pos = -1
  state.doc.descendants((node, p) => {
    if (node.type.name === 'paragraph' && node.textContent === label) pos = p + 1
  })
  if (pos === -1) throw new Error(`block not found: ${label}`)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

function run(state: EditorState, direction: 'up' | 'down'): EditorState {
  let next = state
  const ok = moveBlock(
    state,
    state.tr,
    (tr) => {
      next = state.apply(tr)
    },
    direction,
  )
  expect(ok).toBe(true)
  return next
}

function order(state: EditorState): Array<[string, number]> {
  const out: Array<[string, number]> = []
  state.doc.forEach((node) => out.push([node.textContent, node.attrs.indent as number]))
  return out
}

describe('moveBlock', () => {
  it('moves a leaf block up past its previous sibling', () => {
    let state = makeState([para('A'), para('B')])
    state = selectBlock(state, 'B')
    state = run(state, 'up')
    expect(order(state)).toEqual([
      ['B', 0],
      ['A', 0],
    ])
  })

  it('carries the whole subtree when moving up past a sibling subtree', () => {
    let state = makeState([para('A'), para('B', 1), para('C', 2), para('D', 1)])
    state = selectBlock(state, 'D')
    state = run(state, 'up')
    expect(order(state)).toEqual([
      ['A', 0],
      ['D', 1],
      ['B', 1],
      ['C', 2],
    ])
  })

  it('moves a parent and its subtree down past the next sibling', () => {
    let state = makeState([para('A'), para('B', 1), para('C')])
    state = selectBlock(state, 'A')
    state = run(state, 'down')
    expect(order(state)).toEqual([
      ['C', 0],
      ['A', 0],
      ['B', 1],
    ])
  })

  it('keeps the caret on the moved block', () => {
    let state = makeState([para('A'), para('B')])
    state = selectBlock(state, 'B')
    state = run(state, 'up')
    const caretBlock = state.doc.nodeAt(state.selection.from - 1)
    expect(caretBlock?.textContent).toBe('B')
  })

  it('returns false at a sibling-group boundary', () => {
    let state = makeState([para('A'), para('B')])
    state = selectBlock(state, 'A')
    const ok = moveBlock(state, state.tr, () => {}, 'up')
    expect(ok).toBe(false)
  })

  it('preserves every block id through a move', () => {
    let state = makeState([
      para('A', 0, 'block-a'),
      para('B', 1, 'block-b'),
      para('C', 2, 'block-c'),
      para('D', 1, 'block-d'),
    ])
    state = selectBlock(state, 'D')
    state = run(state, 'up')

    const ids: string[] = []
    state.doc.descendants((node) => {
      if (node.type.name === 'paragraph') ids.push(node.attrs['data-block-id'] as string)
    })

    expect(ids).toEqual(['block-a', 'block-d', 'block-b', 'block-c'])
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
  })
})

describe('setCollapsedAll', () => {
  function collapsedFlags(state: EditorState): Array<[string, boolean]> {
    const out: Array<[string, boolean]> = []
    state.doc.forEach((node) => out.push([node.textContent, !!node.attrs.collapsed]))
    return out
  }

  it('collapses only blocks that have children', () => {
    let state = makeState([para('A'), para('B', 1), para('C')])
    const ok = setCollapsedAll(
      state,
      state.tr,
      (tr) => {
        state = state.apply(tr)
      },
      true,
    )
    expect(ok).toBe(true)
    expect(collapsedFlags(state)).toEqual([
      ['A', true],
      ['B', false],
      ['C', false],
    ])
  })

  it('expands every collapsed block', () => {
    let state = makeState([para('A'), para('B', 1)])
    setCollapsedAll(
      state,
      state.tr,
      (tr) => {
        state = state.apply(tr)
      },
      true,
    )
    expect(collapsedFlags(state)[0]).toEqual(['A', true])

    const ok = setCollapsedAll(
      state,
      state.tr,
      (tr) => {
        state = state.apply(tr)
      },
      false,
    )
    expect(ok).toBe(true)
    expect(collapsedFlags(state)).toEqual([
      ['A', false],
      ['B', false],
    ])
  })

  it('is a no-op when nothing would change', () => {
    const state = makeState([para('A'), para('B')])
    expect(setCollapsedAll(state, state.tr, () => {}, true)).toBe(false)
  })
})
