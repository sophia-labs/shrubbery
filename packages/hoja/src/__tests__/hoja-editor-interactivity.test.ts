/**
 * Whether the editor can be edited is not an edit (NO MOCKS: a real `<hoja-editor>`
 * over the real TipTap kernel in a real happy-dom document).
 *
 * Defect guarded (F-step-zero D1, seen live on garden.sophia-labs.com): a chat
 * host sent a message, cleared the controlled `value` and disabled the composer in
 * ONE update. Hoja applied the interactivity change first, TipTap's `setEditable`
 * emitted an `update` for it (its default), and `handleEditorUpdate` read the
 * editor while it still held the sent text, saw that it differed from the new
 * controlled value and reported it to the host as if the person had typed it. The
 * host restored the draft and the composer showed the sent message again; the next
 * message the person typed was glued to it.
 */
import type { Editor } from '@shrubbery/editor-kernel'
import { describe, expect, it } from 'vitest'

import { HojaEditor } from '../hoja-editor.js'
import type { HojaComposerDetail } from '../types.js'

void HojaEditor

type HojaInternals = { editor: Editor | null }

function editorOf(element: HojaEditor): Editor {
  const editor = (element as unknown as HojaInternals).editor
  if (!editor) throw new Error('Hoja editor did not mount')
  return editor
}

async function settle(element: HojaEditor): Promise<void> {
  await element.updateComplete
  await Promise.resolve()
  await element.updateComplete
}

async function mount(configure?: (element: HojaEditor) => void): Promise<HojaEditor> {
  const element = document.createElement('hoja-editor') as HojaEditor
  configure?.(element)
  document.body.appendChild(element)
  await settle(element)
  return element
}

function proseText(element: HojaEditor): string {
  return element.querySelector('.ProseMirror')?.textContent ?? ''
}

/** A person typing: one real ProseMirror transaction through the editor's own view. */
function typeText(editor: Editor, text: string): void {
  const { from, to } = editor.state.selection
  editor.view.dispatch(editor.state.tr.insertText(text, from, to))
}

describe('<hoja-editor> interactivity is not an edit', () => {
  it('does not hand the sent text back when the host clears the value and disables the composer in one update', async () => {
    const changes: HojaComposerDetail[] = []
    const element = await mount(hoja => {
      hoja.value = 'Reply with one sentence.'
      hoja.onChange = detail => changes.push(detail)
    })
    expect(proseText(element)).toBe('Reply with one sentence.')

    // What a chat panel does the instant a message is sent.
    element.value = ''
    element.disabled = true
    await settle(element)

    expect(changes).toEqual([])
    expect(proseText(element)).toBe('')
    expect(editorOf(element).isEditable).toBe(false)
  })

  it('stays empty and silent when the host then re-enables the composer', async () => {
    const changes: HojaComposerDetail[] = []
    const element = await mount(hoja => {
      hoja.value = 'A sent message.'
      hoja.onChange = detail => changes.push(detail)
    })
    element.value = ''
    element.disabled = true
    await settle(element)
    element.disabled = false
    await settle(element)

    expect(changes).toEqual([])
    expect(proseText(element)).toBe('')
    expect(editorOf(element).isEditable).toBe(true)
  })

  it('does not report a read-only toggle as an edit either', async () => {
    const changes: HojaComposerDetail[] = []
    const element = await mount(hoja => {
      hoja.value = 'Held for a moment.'
      hoja.onChange = detail => changes.push(detail)
    })
    element.value = 'Replaced by the host.'
    element.readOnly = true
    await settle(element)

    expect(changes).toEqual([])
    expect(proseText(element)).toBe('Replaced by the host.')
    expect(editorOf(element).isEditable).toBe(false)
    element.readOnly = false
    await settle(element)
    expect(changes).toEqual([])
    expect(editorOf(element).isEditable).toBe(true)
  })

  it('follows the properties: editable exactly when neither disabled nor read-only', async () => {
    const element = await mount()
    expect(editorOf(element).isEditable).toBe(true)
    element.disabled = true
    await settle(element)
    expect(editorOf(element).isEditable).toBe(false)
    element.disabled = false
    element.readOnly = true
    await settle(element)
    expect(editorOf(element).isEditable).toBe(false)
    element.readOnly = false
    await settle(element)
    expect(editorOf(element).isEditable).toBe(true)
  })

  it('still reports what the person really types', async () => {
    const changes: HojaComposerDetail[] = []
    const element = await mount(hoja => {
      hoja.onChange = detail => changes.push(detail)
    })
    typeText(editorOf(element), 'hello')
    expect(changes.map(change => change.value)).toEqual(['hello'])
    expect(changes[0].isEmpty).toBe(false)
  })
})
