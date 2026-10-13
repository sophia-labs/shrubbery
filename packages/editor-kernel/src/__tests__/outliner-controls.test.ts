import { afterEach, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { kernelExtensions } from '../index'

let editor: Editor
afterEach(() => editor?.destroy())
function fixture() {
  editor = new Editor({ extensions: kernelExtensions(), content: '<p data-block-id="parent">Parent</p><p data-block-id="child" data-indent="1">Child</p><p data-block-id="next">Next</p>' })
  return editor
}
it('moves a hidden descendant caret to its visible parent when folding', () => {
  const e = fixture()
  e.commands.setTextSelection(10)
  e.view.dom.querySelector<HTMLButtonElement>('.outliner-fold-button')!.click()
  expect(e.state.selection.$from.parent.attrs['data-block-id']).toBe('parent')
  expect(e.state.selection.$from.parentOffset).toBe(6)
})
it('resolves retained controls by block identity after content is inserted above', () => {
  const e = fixture()
  const fold = e.view.dom.querySelector<HTMLButtonElement>('.outliner-fold-button')!
  e.commands.insertContentAt(0, '<p data-block-id="intro">Introduction</p>')
  fold.click()
  const parent = e.getJSON().content!.find(node => node.attrs?.['data-block-id'] === 'parent')!
  expect(parent.attrs?.collapsed).toBe(true)
  expect(e.getJSON().content![0].attrs?.collapsed).toBe(false)
})
it('exposes one named action target per block and explicit fold state only for parents', () => {
  const e = fixture()
  expect(e.view.dom.querySelectorAll('.outliner-control')).toHaveLength(3)
  expect(e.view.dom.querySelectorAll('.outliner-fold-button')).toHaveLength(1)
  expect(e.view.dom.querySelectorAll('.outliner-node-button[aria-haspopup="menu"]')).toHaveLength(3)
})
