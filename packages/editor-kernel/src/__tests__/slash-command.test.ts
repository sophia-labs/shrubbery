import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { AllSelection } from '@tiptap/pm/state'
import { createKernelEditor, filterSlashCommands } from '../index'
import {
  CLOSE_SLASH_COMMAND_EVENT,
  OPEN_SLASH_COMMAND_EVENT,
  type OpenSlashCommandDetail,
} from '../extensions/slash-command'

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

describe('slash command pure event source', () => {
  it('opens the host menu from typed /query and reports the trigger replacement range', () => {
    const editor = mount()
    const opens: OpenSlashCommandDetail[] = []
    let closes = 0
    const onOpen = (event: Event): void => {
      opens.push((event as CustomEvent<OpenSlashCommandDetail>).detail)
    }
    const onClose = (): void => {
      closes += 1
    }

    document.addEventListener(OPEN_SLASH_COMMAND_EVENT, onOpen)
    document.addEventListener(CLOSE_SLASH_COMMAND_EVENT, onClose)
    try {
      editor.commands.setContent('<p></p>')
      editor.commands.focus()
      typeText(editor, 'Type /hea')

      expect(editor.getText()).toBe('Type /hea')
      expect(opens.at(-1)).toEqual({
        query: 'hea',
        matchedText: '/hea',
        range: { from: 6, to: 10 },
      })

      typeText(editor, ' ')
      expect(closes).toBeGreaterThan(0)
    } finally {
      document.removeEventListener(OPEN_SLASH_COMMAND_EVENT, onOpen)
      document.removeEventListener(CLOSE_SLASH_COMMAND_EVENT, onClose)
    }
  })

  it('maps the first collaborative keystroke from an empty-document AllSelection', () => {
    const editor = mount()
    const opens: OpenSlashCommandDetail[] = []
    const onOpen = (event: Event): void => {
      opens.push((event as CustomEvent<OpenSlashCommandDetail>).detail)
    }

    document.addEventListener(OPEN_SLASH_COMMAND_EVENT, onOpen)
    try {
      editor.commands.setContent('<p></p>')
      editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)))
      typeText(editor, '/')

      expect(editor.getText()).toBe('/')
      expect(opens).toEqual([
        {
          query: '',
          matchedText: '/',
          range: { from: 1, to: 2 },
        },
      ])
    } finally {
      document.removeEventListener(OPEN_SLASH_COMMAND_EVENT, onOpen)
    }
  })

  it('marks math as available now that the math kernel extension ships', () => {
    const [item, ...rest] = filterSlashCommands('math')
    expect(rest).toEqual([])
    expect(item?.id).toBe('math')
    expect(item?.unavailable).toBeUndefined()
  })

  it('marks queryBlock available now that the pure schema + host renderer seam ship', () => {
    const [item, ...rest] = filterSlashCommands('query')
    expect(rest).toEqual([])
    expect(item?.id).toBe('queryBlock')
    expect(item?.unavailable).toBeUndefined()
  })
})
