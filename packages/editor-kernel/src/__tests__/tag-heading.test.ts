/**
 * Garden PR #4 regression: `#` means heading first, tag only once a name starts.
 *
 * Shrubbery ports Garden's monolithic TagSuggestion as a split seam: the kernel
 * emits pure host events and runtime owns lookup/dropdown commit. The pure gate
 * keeps that host popup from stealing bare heading input, and the real kernel
 * editor proves current TagRecognition does not interfere with StarterKit
 * heading rules.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createKernelEditor } from '../index'
import {
  CORE_TAGS,
  filterTagSuggestions,
  isValidTagQuery,
  mergeTagSources,
  shouldShowTagSuggestion,
} from '../tag-suggestions'
import {
  CLOSE_TAG_PICKER_EVENT,
  OPEN_TAG_PICKER_EVENT,
  type OpenTagPickerDetail,
} from '../extensions/tag-autocomplete'

const editors: Editor[] = []

afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
  document.body.innerHTML = ''
})

function mount(): Editor {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const editor = createKernelEditor(el)
  editors.push(editor)
  return editor
}

function typeText(editor: Editor, text: string): void {
  for (const char of text) {
    const { from, to } = editor.state.selection
    let handled = false
    editor.view.someProp('handleTextInput', (handler) => {
      handled =
        handler(editor.view, from, to, char, () => {
          const tr = editor.state.tr.insertText(char, from, to)
          editor.view.dispatch(tr)
          return tr
        }) || handled
      return handled
    })
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to))
  }
}

function firstBlock(editor: Editor) {
  const block = editor.state.doc.firstChild
  if (!block) throw new Error('first block not found')
  return block
}

describe('tag suggestion pure helpers', () => {
  it('suppresses bare heading territory and opens only after a tag-name character', () => {
    expect(shouldShowTagSuggestion('#')).toBe(false)
    expect(shouldShowTagSuggestion('##')).toBe(false)
    expect(shouldShowTagSuggestion('###')).toBe(false)
    expect(shouldShowTagSuggestion('# ')).toBe(false)
    expect(shouldShowTagSuggestion('#!')).toBe(false)
    expect(shouldShowTagSuggestion('#t')).toBe(true)
    expect(shouldShowTagSuggestion('#todo')).toBe(true)
  })

  it('validates, filters, and merges tag suggestion data without host state', () => {
    expect(isValidTagQuery('todo_2')).toBe(true)
    expect(isValidTagQuery('todo:7d')).toBe(false)
    expect(filterTagSuggestions(CORE_TAGS, 'do').map((tag) => tag.name)).toEqual(['todo'])
    expect(filterTagSuggestions(CORE_TAGS, 'ent').map((tag) => tag.name)).toEqual(['event'])

    expect(
      mergeTagSources(CORE_TAGS, [
        { name: 'pragma', description: 'Custom pragma copy.', isCore: false },
        { name: 'shrubbery', description: 'Port work.', isCore: false },
      ]).filter((tag) => tag.name === 'pragma' || tag.name === 'shrubbery'),
    ).toEqual([
      { name: 'pragma', description: 'Custom pragma copy.', isCore: true },
      { name: 'shrubbery', description: 'Port work.', isCore: false },
    ])
  })
})

describe('# heading entry with current kernel tag recognition active', () => {
  it('"# " creates a level-1 heading and keeps typing in that heading', () => {
    const editor = mount()
    editor.commands.setContent('<p></p>')
    editor.commands.focus()

    typeText(editor, '# ')
    expect(firstBlock(editor).type.name).toBe('heading')
    expect(firstBlock(editor).attrs.level).toBe(1)

    typeText(editor, 'Title')
    expect(firstBlock(editor).type.name).toBe('heading')
    expect(firstBlock(editor).textContent).toBe('Title')
  })

  it('"## " and "### " create heading levels 2 and 3', () => {
    let editor = mount()
    editor.commands.setContent('<p></p>')
    editor.commands.focus()
    typeText(editor, '## ')
    expect(firstBlock(editor).type.name).toBe('heading')
    expect(firstBlock(editor).attrs.level).toBe(2)

    editor = mount()
    editor.commands.setContent('<p></p>')
    editor.commands.focus()
    typeText(editor, '### ')
    expect(firstBlock(editor).type.name).toBe('heading')
    expect(firstBlock(editor).attrs.level).toBe(3)
  })

  it('"#name" stays paragraph text until the tag flow commits', () => {
    const editor = mount()
    editor.commands.setContent('<p></p>')
    editor.commands.focus()

    typeText(editor, '#todo')

    expect(firstBlock(editor).type.name).toBe('paragraph')
    expect(firstBlock(editor).textContent).toBe('#todo')
  })

  it('dispatches host-owned tag picker events only after the tag name starts', () => {
    const editor = mount()
    const opens: OpenTagPickerDetail[] = []
    let closes = 0
    const onOpen = (event: Event): void => {
      opens.push((event as CustomEvent<OpenTagPickerDetail>).detail)
    }
    const onClose = (): void => {
      closes += 1
    }
    document.addEventListener(OPEN_TAG_PICKER_EVENT, onOpen)
    document.addEventListener(CLOSE_TAG_PICKER_EVENT, onClose)
    try {
      editor.commands.setContent('<p></p>')
      editor.commands.focus()

      typeText(editor, '#')
      expect(opens).toEqual([])
      expect(closes).toBe(1)

      typeText(editor, 't')
      expect(opens).toEqual([
        {
          query: 't',
          matchedText: '#t',
          range: { from: 1, to: 3 },
        },
      ])

      typeText(editor, 'o')
      expect(opens.at(-1)).toEqual({
        query: 'to',
        matchedText: '#to',
        range: { from: 1, to: 4 },
      })
    } finally {
      document.removeEventListener(OPEN_TAG_PICKER_EVENT, onOpen)
      document.removeEventListener(CLOSE_TAG_PICKER_EVENT, onClose)
    }
  })
})
