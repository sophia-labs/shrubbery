/**
 * Words offered to the composer are followed by the person's own (NO MOCKS: a real `<hoja-editor>` over the real
 * TipTap kernel in a real happy-dom document).
 *
 * Defect guarded (10-19, seen on a local stack): the Reader's "Ask Sophia about this passage" put the quoted passage in
 * the chat composer and focused it with the caret at the very start, so the question a person typed landed above the
 * quote, glued to its first line ("…here?From \"The Interpretation of Dreams\"…").
 */
import type { Editor } from '@shrubbery/editor-kernel'
import { describe, expect, it } from 'vitest'

import { HojaEditor } from '../hoja-editor.js'
import type { HojaComposerDetail } from '../types.js'

void HojaEditor

function editorOf(element: HojaEditor): Editor {
  const editor = (element as unknown as { editor: Editor | null }).editor
  if (!editor) throw new Error('Hoja editor did not mount')
  return editor
}

async function settle(element: HojaEditor): Promise<void> {
  await element.updateComplete
  await Promise.resolve()
  await element.updateComplete
}

async function mountWith(value: string, changes: HojaComposerDetail[]): Promise<HojaEditor> {
  const element = document.createElement('hoja-editor') as HojaEditor
  element.value = value
  element.onChange = detail => changes.push(detail)
  document.body.replaceChildren(element)
  await settle(element)
  return element
}

/** A person typing at the caret: one real transaction through the editor's own view. */
function typeText(editor: Editor, text: string): void {
  const { from, to } = editor.state.selection
  editor.view.dispatch(editor.state.tr.insertText(text, from, to))
}

describe('<hoja-editor> focusEnd', () => {
  it('puts the caret after a quoted passage, so a question follows the quote on a line of its own', async () => {
    const changes: HojaComposerDetail[] = []
    const element = await mountWith('From "The Interpretation of Dreams", INTRODUCTORY REMARKS:\n\n> In attempting a discussion\n\n', changes)

    element.focusEnd()
    typeText(editorOf(element), 'What is he claiming?')

    const blocks = (editorOf(element).getJSON().content ?? []).map(block => JSON.stringify(block))
    expect(blocks.at(-1)).toContain('What is he claiming?')
    expect(blocks.at(-1)).not.toContain('In attempting')
    expect(blocks[0]).not.toContain('What is he claiming?')
    expect(changes.at(-1)?.value).toMatch(/> In attempting a discussion\n+What is he claiming\?$/)
  })

  it('continues an offered line in place ("About the chapter …: ")', async () => {
    const changes: HojaComposerDetail[] = []
    const element = await mountWith('About the chapter IV Distortion of "The Interpretation of Dreams": ', changes)

    element.focusEnd()
    typeText(editorOf(element), 'what is distorted?')

    expect(editorOf(element).getJSON().content?.length).toBe(1)
    expect(changes.at(-1)?.value).toBe('About the chapter IV Distortion of "The Interpretation of Dreams": what is distorted?')
  })
})
