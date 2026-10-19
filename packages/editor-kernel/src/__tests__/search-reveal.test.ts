import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { kernelExtensions } from '../index'
import { searchPluginKey } from '../extensions/search'

const editors: Editor[] = []
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy() })

function mount(): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: kernelExtensions({}) })
  editors.push(editor)
  editor.commands.setContent(
    '<p data-collapsed="true">folded parent</p>'
    + '<p data-indent="1">hidden needle one</p>'
    + '<p>visible needle two</p>'
    + '<p>visible needle three</p>',
  )
  return editor
}

const currentText = (editor: Editor): string =>
  editor.view.dom.querySelector('.search-match-current')?.closest('p')?.textContent ?? ''

const collapsed = (editor: Editor): boolean => editor.state.doc.firstChild?.attrs.collapsed === true

const revealSeq = (editor: Editor): number =>
  (searchPluginKey.getState(editor.state) as { revealSeq: number }).revealSeq

describe('search reveal', () => {
  it('while typing, marks the first match outside any fold and edits nothing', () => {
    const editor = mount()
    const before = JSON.stringify(editor.getJSON())
    editor.commands.setSearchTerm('needle')
    expect((searchPluginKey.getState(editor.state) as { results: unknown[] }).results).toHaveLength(3)
    expect(currentText(editor)).toBe('visible needle two')
    expect(collapsed(editor)).toBe(true)
    expect(JSON.stringify(editor.getJSON())).toBe(before)
  })

  it('moving to a match inside a fold opens the fold', () => {
    const editor = mount()
    editor.commands.setSearchTerm('needle')
    editor.commands.nextSearchResult() // three
    editor.commands.nextSearchResult() // wraps to one, inside the fold
    expect(currentText(editor)).toBe('hidden needle one')
    expect(collapsed(editor)).toBe(false)
  })

  it('asks the view to reveal on every move, not on unrelated edits', () => {
    const editor = mount()
    editor.commands.setSearchTerm('needle')
    const afterTyping = revealSeq(editor)
    editor.commands.nextSearchResult()
    expect(revealSeq(editor)).toBe(afterTyping + 1)
    editor.commands.prevSearchResult()
    expect(revealSeq(editor)).toBe(afterTyping + 2)
    editor.commands.setTextSelection(3)
    editor.commands.insertContent('x')
    expect(revealSeq(editor)).toBe(afterTyping + 2)
  })
})
