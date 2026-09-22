/**
 * Regression tests for Garden PR #4's list-item content-preservation fixes.
 *
 * NO mocks: these mount a real TipTap Editor with the Shrubbery kernel roster.
 * The data-loss failures were concrete writing-surface bugs:
 * - Enter-splitting a list item must move the trailing ProseMirror fragment, not
 *   flatten it through textBetween().
 * - Toggling a list item off must unwrap every child block, not only firstChild.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Editor, Node } from '@tiptap/core'
import { kernelExtensions } from '../index'

/** A minimal inline atom standing in for wikilink / tag chip / inline math. */
const Atom = Node.create({
  name: 'atom',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return { label: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'span[data-atom]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, 'data-atom': '' }, HTMLAttributes.label ?? '']
  },
})

const editors: Editor[] = []

afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
  document.body.innerHTML = ''
})

function mount(): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: [Atom, ...kernelExtensions()] })
  editors.push(editor)
  return editor
}

function pressEnter(editor: Editor): boolean {
  let handled = false
  editor.view.someProp('handleKeyDown', (fn) => {
    handled = fn(editor.view, new KeyboardEvent('keydown', { key: 'Enter' })) || handled
    return handled
  })
  return handled
}

/** Position just after the Nth character of the first paragraph's text run. */
function caretAfterChars(editor: Editor, n: number): void {
  let paragraphStart = -1
  editor.state.doc.descendants((node, pos) => {
    if (paragraphStart === -1 && node.type.name === 'paragraph') paragraphStart = pos + 1
  })
  if (paragraphStart === -1) throw new Error('paragraph not found')
  editor.commands.setTextSelection(paragraphStart + n)
}

describe('list item Enter-split preserves inline content', () => {
  it('keeps marks on moved text', () => {
    const editor = mount()
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'listItem',
          attrs: { listType: 'bullet' },
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'foo ' },
                { type: 'text', marks: [{ type: 'bold' }], text: 'bar' },
              ],
            },
          ],
        },
      ],
    })

    caretAfterChars(editor, 4)
    expect(pressEnter(editor)).toBe(true)

    const items = ((editor.getJSON().content ?? []) as Array<{ type: string; content?: any[] }>)
      .filter((node) => node.type === 'listItem')
    expect(items).toHaveLength(2)
    expect(items[0].content?.[0]?.content?.[0]?.text).toBe('foo ')
    const moved = items[1].content?.[0]?.content?.[0]
    expect(moved?.text).toBe('bar')
    expect(moved?.marks?.some((mark: { type: string }) => mark.type === 'bold')).toBe(true)
  })

  it('keeps an inline atom after the cursor', () => {
    const editor = mount()
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'listItem',
          attrs: { listType: 'bullet' },
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'hi ' },
                { type: 'atom', attrs: { label: 'X' } },
                { type: 'text', text: ' end' },
              ],
            },
          ],
        },
      ],
    })

    caretAfterChars(editor, 3)
    expect(pressEnter(editor)).toBe(true)

    const items = ((editor.getJSON().content ?? []) as Array<{ type: string; content?: any[] }>)
      .filter((node) => node.type === 'listItem')
    expect(items).toHaveLength(2)
    const movedTypes = (items[1].content?.[0]?.content ?? []).map((node: { type: string }) => node.type)
    expect(movedTypes).toContain('atom')
    expect(movedTypes).toContain('text')
  })

  it('inserts the new sibling after a collapsed parent subtree', () => {
    const editor = mount()
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'listItem',
          attrs: { listType: 'bullet', indent: 0, collapsed: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Parent' }] }],
        },
        {
          type: 'listItem',
          attrs: { listType: 'bullet', indent: 1 },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hidden child' }] }],
        },
      ],
    })

    caretAfterChars(editor, 'Parent'.length)
    expect(pressEnter(editor)).toBe(true)

    const items = ((editor.getJSON().content ?? []) as Array<{ type: string; attrs?: Record<string, unknown>; content?: any[] }>)
      .filter((node) => node.type === 'listItem')
    expect(items).toHaveLength(3)
    expect(items.map((item) => item.content?.[0]?.content?.[0]?.text ?? '')).toEqual([
      'Parent',
      'Hidden child',
      '',
    ])
    expect(items.map((item) => item.attrs?.indent ?? 0)).toEqual([0, 1, 0])
  })
})

describe('list item unwrap preserves all child blocks', () => {
  it('toggling a bullet item off keeps paragraph plus code block', () => {
    const editor = mount()
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'listItem',
          attrs: { listType: 'bullet' },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'lead' }] },
            { type: 'codeBlock', content: [{ type: 'text', text: 'code()' }] },
          ],
        },
      ],
    })

    caretAfterChars(editor, 1)
    expect(editor.commands.toggleBulletItem()).toBe(true)

    const top = ((editor.getJSON().content ?? []) as Array<{ type: string }>).map((node) => node.type)
    expect(top.slice(0, 2)).toEqual(['paragraph', 'codeBlock'])
    const code = (editor.getJSON().content ?? []).find((node: { type: string }) => node.type === 'codeBlock') as
      | { content?: Array<{ text?: string }> }
      | undefined
    expect(code?.content?.[0]?.text).toBe('code()')
  })

  it('toggling a task item off keeps paragraph plus blockquote', () => {
    const editor = mount()
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'listItem',
          attrs: { listType: 'task', checked: false },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'todo' }] },
            {
              type: 'blockquote',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'note' }] }],
            },
          ],
        },
      ],
    })

    caretAfterChars(editor, 1)
    expect(editor.commands.toggleTaskItem()).toBe(true)

    const top = ((editor.getJSON().content ?? []) as Array<{ type: string }>).map((node) => node.type)
    expect(top.slice(0, 2)).toEqual(['paragraph', 'blockquote'])
  })
})
