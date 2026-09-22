import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createKernelEditor, type KernelOptions } from '../index'
import {
  CLOSE_WIKILINK_PICKER_EVENT,
  OPEN_WIKILINK_PICKER_EVENT,
  type OpenWikiLinkPickerDetail,
} from '../extensions/wikilink-autocomplete'

const editors: Editor[] = []

afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
  document.body.innerHTML = ''
})

function mount(options: KernelOptions = {}): Editor {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const editor = createKernelEditor(el, options)
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

describe('wikilink autocomplete pure event source', () => {
  it('opens the host picker from typed [[query and reports the trigger replacement range', () => {
    const editor = mount()
    const opens: OpenWikiLinkPickerDetail[] = []
    let closes = 0
    const onOpen = (event: Event): void => {
      opens.push((event as CustomEvent<OpenWikiLinkPickerDetail>).detail)
    }
    const onClose = (): void => {
      closes += 1
    }

    document.addEventListener(OPEN_WIKILINK_PICKER_EVENT, onOpen)
    document.addEventListener(CLOSE_WIKILINK_PICKER_EVENT, onClose)
    try {
      editor.commands.setContent('<p></p>')
      editor.commands.focus()
      typeText(editor, 'See [[arch')

      expect(editor.getText()).toBe('See [[arch')
      expect(opens.at(-1)).toEqual({
        query: 'arch',
        matchedText: '[[arch',
        range: { from: 5, to: 11 },
      })

      typeText(editor, ']')
      expect(closes).toBeGreaterThan(0)
    } finally {
      document.removeEventListener(OPEN_WIKILINK_PICKER_EVENT, onOpen)
      document.removeEventListener(CLOSE_WIKILINK_PICKER_EVENT, onClose)
    }
  })

  it('uses instance callbacks without leaking typed-trigger events to the document', () => {
    const opens: OpenWikiLinkPickerDetail[] = []
    let closes = 0
    let leakedOpens = 0
    let leakedCloses = 0
    const editor = mount({
      onWikiLinkAutocompleteOpen: detail => opens.push(detail),
      onWikiLinkAutocompleteClose: () => {
        closes += 1
      },
    })
    const onLeakedOpen = (): void => {
      leakedOpens += 1
    }
    const onLeakedClose = (): void => {
      leakedCloses += 1
    }
    document.addEventListener(OPEN_WIKILINK_PICKER_EVENT, onLeakedOpen)
    document.addEventListener(CLOSE_WIKILINK_PICKER_EVENT, onLeakedClose)
    try {
      editor.commands.setContent('<p></p>')
      editor.commands.focus()
      typeText(editor, 'Ask [[Funes')

      expect(opens.at(-1)).toEqual({
        query: 'Funes',
        matchedText: '[[Funes',
        range: { from: 5, to: 12 },
      })
      typeText(editor, ']')
      expect(closes).toBe(1)
      expect(leakedOpens).toBe(0)
      expect(leakedCloses).toBe(0)
    } finally {
      document.removeEventListener(OPEN_WIKILINK_PICKER_EVENT, onLeakedOpen)
      document.removeEventListener(CLOSE_WIKILINK_PICKER_EVENT, onLeakedClose)
    }
  })

  it('reconciles the active query after deletion and closes it after caret movement', () => {
    const opens: OpenWikiLinkPickerDetail[] = []
    let closes = 0
    const editor = mount({
      onWikiLinkAutocompleteOpen: detail => opens.push(detail),
      onWikiLinkAutocompleteClose: () => {
        closes += 1
      },
    })
    editor.commands.setContent('<p></p>')
    editor.commands.focus()
    typeText(editor, 'See [[arch')

    const caret = editor.state.selection.from
    editor.view.dispatch(editor.state.tr.delete(caret - 1, caret))
    expect(opens.at(-1)).toEqual({
      query: 'arc',
      matchedText: '[[arc',
      range: { from: 5, to: 10 },
    })

    editor.commands.setTextSelection(2)
    expect(closes).toBe(1)
  })

  it('composer profile is a minimal safe roster and suppresses legacy picker events', () => {
    let leakedOpens = 0
    let leakedCloses = 0
    const onLeakedOpen = (): void => {
      leakedOpens += 1
    }
    const onLeakedClose = (): void => {
      leakedCloses += 1
    }
    document.addEventListener(OPEN_WIKILINK_PICKER_EVENT, onLeakedOpen)
    document.addEventListener(CLOSE_WIKILINK_PICKER_EVENT, onLeakedClose)
    try {
      const editor = mount({ profile: 'composer' })
      const names = editor.extensionManager.extensions.map(extension => extension.name)

      expect(names).toEqual(expect.arrayContaining([
        'doc',
        'paragraph',
        'text',
        'hardBreak',
        'bold',
        'italic',
        'code',
        'link',
        'wikilink',
        'wikilinkAutocomplete',
      ]))
      expect(names).not.toEqual(expect.arrayContaining([
        'heading',
        'table',
        'slashCommand',
        'citation',
        'tagAutocomplete',
        'wireShortcuts',
      ]))

      editor.commands.setContent('<p></p>')
      editor.commands.focus()
      typeText(editor, '[[safe]')
      expect(leakedOpens).toBe(0)
      expect(leakedCloses).toBe(0)
    } finally {
      document.removeEventListener(OPEN_WIKILINK_PICKER_EVENT, onLeakedOpen)
      document.removeEventListener(CLOSE_WIKILINK_PICKER_EVENT, onLeakedClose)
    }
  })
})
