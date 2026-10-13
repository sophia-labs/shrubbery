import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { kernelExtensions } from '@shrubbery/editor-kernel'
import { captureEditorSelection } from '../collab/editor-interaction.js'

let editor: Editor
afterEach(() => editor?.destroy())
function fixture() {
  editor = new Editor({ extensions: kernelExtensions(), content: '<p data-block-id="first">First</p><p data-block-id="target">Target text</p><p data-block-id="last">Last</p>' })
  editor.commands.setTextSelection({ from: 9, to: 14 })
  return editor
}
describe('toolbar selection lease', () => {
  it('restores the original range after focus changes the editor selection', () => {
    const e = fixture()
    const lease = captureEditorSelection(e)
    e.commands.setTextSelection(1)
    expect(lease.restore()).toBe(true)
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe('arget')
  })
  it('maps the saved range through a concurrent insertion before it', () => {
    const e = fixture()
    const lease = captureEditorSelection(e)
    e.view.dispatch(e.state.tr.insertText('New ', 1))
    e.commands.setTextSelection(1)
    expect(lease.restore()).toBe(true)
    expect(e.state.selection.from).toBe(13)
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe('arget')
  })
  it('refuses to substitute a neighbor when the target was deleted', () => {
    const e = fixture()
    const lease = captureEditorSelection(e)
    e.view.dispatch(e.state.tr.delete(7, 20))
    expect(lease.restore()).toBe(false)
  })
  it('follows the selected block identity through a subtree move', () => {
    const e = fixture()
    const lease = captureEditorSelection(e)
    e.commands.moveBlockDown()
    expect(lease.restore()).toBe(true)
    expect(e.state.selection.$from.parent.attrs['data-block-id']).toBe('target')
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe('arget')
  })
  it('releases a cancelled lease without moving the current selection', () => {
    const e = fixture()
    const lease = captureEditorSelection(e)
    lease.destroy()
    e.commands.setTextSelection(1)
    expect(lease.restore()).toBe(false)
    expect(e.state.selection.from).toBe(1)
  })
  it('maps edits inside the same block rather than preserving stale offsets', () => {
    const e = fixture()
    const lease = captureEditorSelection(e)
    e.view.dispatch(e.state.tr.insertText('New ', 8))
    expect(lease.restore()).toBe(true)
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe('arget')
  })
  it('collapses a deleted range inside its surviving block', () => {
    const e = fixture()
    const lease = captureEditorSelection(e)
    e.view.dispatch(e.state.tr.delete(9, 14))
    expect(lease.restore()).toBe(true)
    expect(e.state.selection.empty).toBe(true)
    expect(e.state.selection.$from.parent.attrs['data-block-id']).toBe('target')
  })
})
