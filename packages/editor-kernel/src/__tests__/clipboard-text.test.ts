import { afterEach, describe, expect, it } from 'vitest'
import type { Editor } from '@tiptap/core'
import { createKernelEditor } from '../index'

const editors: Editor[] = []
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy() })

describe('copying blocks as plain text', () => {
  it('puts one newline between blocks, not a blank line', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = createKernelEditor(element)
    editors.push(editor)
    editor.commands.setContent('<p>alpha</p><p>beta</p><p>gamma</p>')
    // TipTap's serializer reads the editor's selection, not the slice it is
    // handed, so select as Cmd+A would.
    editor.commands.selectAll()

    const { doc } = editor.state
    const text = editor.view.someProp(
      'clipboardTextSerializer',
      serialize => serialize.call(editor.view, doc.slice(0, doc.content.size), editor.view),
    )

    expect(text).toBe('alpha\nbeta\ngamma')
  })
})
