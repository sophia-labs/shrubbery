import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { kernelExtensions, setValueMarks, setValueMarksOpen, valueMarksKey, type ValueMark } from '../index'

const editors: Editor[] = []
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy() })

function mount(): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: kernelExtensions({}) })
  editors.push(editor)
  editor.commands.setContent(
    '<p data-block-id="rated">A sentence the reader flagged.</p>'
    + '<p data-block-id="plain">A sentence nobody valued.</p>'
    + '<blockquote data-block-id="quote"><p data-block-id="quote-inner">Quoted.</p></blockquote>',
  )
  return editor
}

const SIGNAL_ZERO = '<svg data-glyph="signal-zero"></svg>'
const rowFor = (editor: Editor, blockId: string): HTMLElement | null =>
  editor.view.dom.querySelector(`[data-value-marks-for="${blockId}"]`)

describe('ValueMarks', () => {
  it('draws a row on every top-level block, inside the block, without touching the text', () => {
    const editor = mount()
    const flagged: ValueMark = {
      signalSvg: '<svg data-glyph="signal-high"></svg>',
      flagCount: 2,
      flagSvg: '<svg data-glyph="flag"></svg>',
      valenceSvg: '<svg data-glyph="sunrise"></svg>',
    }
    setValueMarks(editor.view, new Map([['rated', flagged]]), SIGNAL_ZERO)

    const rated = rowFor(editor, 'rated')!
    expect(rated.closest('[data-block-id]')?.getAttribute('data-block-id')).toBe('rated')
    expect(rated.getAttribute('contenteditable')).toBe('false')
    expect(rated.querySelector('.value-marks-signal [data-glyph="signal-high"]')).not.toBeNull()
    // Very important: the flag twice. Her valence, once.
    expect(rated.querySelectorAll('.value-marks-flag [data-glyph="flag"]')).toHaveLength(2)
    expect(rated.querySelector('.value-marks-valence [data-glyph="sunrise"]')).not.toBeNull()

    // Unvalued blocks still get a row, so they can be valued.
    const plain = rowFor(editor, 'plain')!
    expect(plain.querySelector('[data-glyph="signal-zero"]')).not.toBeNull()
    expect(plain.querySelector('.value-marks-flag, .value-marks-valence')).toBeNull()

    // A quote is one row, for the quote; its paragraph gets none.
    expect(rowFor(editor, 'quote')).not.toBeNull()
    expect(rowFor(editor, 'quote-inner')).toBeNull()

    // The document text is unchanged: the rows are decorations, not content.
    expect(editor.getText()).toContain('A sentence the reader flagged.')
    expect(editor.getText()).not.toContain('signal')
  })

  it('marks the block whose controls are open, and clears it', () => {
    const editor = mount()
    setValueMarks(editor.view, new Map(), SIGNAL_ZERO)
    setValueMarksOpen(editor.view, 'plain')
    const plain = editor.view.dom.querySelector('[data-block-id="plain"]')!
    expect(plain.getAttribute('data-value-open')).toBe('true')
    setValueMarksOpen(editor.view, null)
    expect(editor.view.dom.querySelector('[data-block-id="plain"]')!.hasAttribute('data-value-open')).toBe(false)
  })

  it('redraws a row when its marks change, and draws nothing with no marks and no default', () => {
    const editor = mount()
    setValueMarks(editor.view, new Map([['rated', { signalSvg: SIGNAL_ZERO }]]), SIGNAL_ZERO)
    expect(rowFor(editor, 'rated')!.querySelector('.value-marks-flag')).toBeNull()
    setValueMarks(editor.view, new Map([['rated', { signalSvg: SIGNAL_ZERO, flagCount: 1, flagSvg: '<svg></svg>' }]]), SIGNAL_ZERO)
    expect(rowFor(editor, 'rated')!.querySelectorAll('.value-marks-flag svg')).toHaveLength(1)
    setValueMarks(editor.view, new Map(), '')
    expect(editor.view.dom.querySelector('.value-marks')).toBeNull()
  })

  it('gives every block type but calendar events a row: atoms by an anchor before them, table cells in their corner', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = new Editor({ element, extensions: kernelExtensions({}) })
    editors.push(editor)
    const para = (id: string, text: string) => ({ type: 'paragraph', attrs: { 'data-block-id': id }, content: [{ type: 'text', text }] })
    const cell = (type: string, id: string, paraId: string, text: string) => ({ type, attrs: { 'data-block-id': id }, content: [para(paraId, text)] })
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, 'data-block-id': 'head' }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'listItem', attrs: { 'data-block-id': 'item' }, content: [para('item-inner', 'An item.')] },
        { type: 'codeBlock', attrs: { 'data-block-id': 'code' }, content: [{ type: 'text', text: 'x = 1' }] },
        { type: 'image', attrs: { 'data-block-id': 'img', src: 'https://example.invalid/a.png' } },
        { type: 'calendarEvent', attrs: { id: 'event', title: 'Lunch', start: '2026-10-16T12:00:00' } },
        { type: 'mathBlock', attrs: { 'data-block-id': 'math', latex: 'x^2' } },
        { type: 'horizontalRule', attrs: { 'data-block-id': 'rule' } },
        { type: 'table', content: [
          { type: 'tableRow', content: [cell('tableHeader', 'h1', 'h1-p', 'Name'), cell('tableHeader', 'h2', 'h2-p', 'Kind')] },
          { type: 'tableRow', content: [cell('tableCell', 'c1', 'c1-p', 'Rose'), cell('tableCell', 'c2', 'c2-p', 'Shrub')] },
        ] },
        para('after', 'After the table.'),
      ],
    })
    setValueMarks(editor.view, new Map([['img', { signalSvg: SIGNAL_ZERO, flagCount: 1, flagSvg: '<svg data-glyph="flag"></svg>' }]]), SIGNAL_ZERO)

    // Text blocks and list items hold their row; the list item's paragraph does not get one.
    for (const id of ['head', 'item', 'code', 'after']) {
      expect(rowFor(editor, id)?.closest('[data-block-id]')?.getAttribute('data-block-id'), id).toBe(id)
    }
    expect(rowFor(editor, 'item-inner')).toBeNull()

    // Atoms: the row hangs from a zero-height anchor right before the atom.
    for (const id of ['img', 'math', 'rule']) {
      const anchor = rowFor(editor, id)?.parentElement
      expect(anchor?.classList.contains('value-marks-anchor'), id).toBe(true)
      let atomPos = -1
      editor.state.doc.forEach((node, offset) => {
        if ((node.attrs['data-block-id'] ?? node.attrs['id']) === id) atomPos = offset
      })
      expect(anchor!.nextElementSibling, id).toBe(editor.view.nodeDOM(atomPos))
    }
    expect(rowFor(editor, 'img')!.querySelector('[data-glyph="flag"]')).not.toBeNull()
    // Calendar events are not rated until the event system is rethought.
    expect(rowFor(editor, 'event')).toBeNull()

    // Tables: one row per cell, for the cell's paragraph (the graph's block), inside the cell.
    for (const id of ['h1-p', 'h2-p', 'c1-p', 'c2-p']) {
      const row = rowFor(editor, id)
      expect(row?.classList.contains('value-marks--cell'), id).toBe(true)
      expect(row!.parentElement!.matches('td, th'), id).toBe(true)
    }
    expect(rowFor(editor, 'c1')).toBeNull()

    // Opening an atom or a cell marks that node.
    setValueMarksOpen(editor.view, 'img')
    expect(editor.view.dom.querySelector('[data-value-open]')?.getAttribute('data-block-id')).toBe('img')
    setValueMarksOpen(editor.view, 'c2-p')
    expect(editor.view.dom.querySelector('[data-value-open]')?.matches('td')).toBe(true)

    // Rows are decorations: the document's text is untouched.
    expect(editor.getText()).toContain('Rose')
    expect(editor.getText()).not.toContain('signal')
  })

  it('follows the text as it is typed, and gives a new block its row', () => {
    const editor = mount()
    setValueMarks(editor.view, new Map(), SIGNAL_ZERO)
    const before = editor.state.plugins.find(p => p.spec.key === valueMarksKey)!.getState(editor.state).set

    // Typing maps the rows: each stays in its own block, later blocks included.
    editor.commands.insertContentAt(1, 'Typed first. ')
    const after = editor.state.plugins.find(p => p.spec.key === valueMarksKey)!.getState(editor.state).set
    expect(after).not.toBe(before)
    for (const id of ['rated', 'plain', 'quote']) {
      expect(rowFor(editor, id)?.closest('[data-block-id]')?.getAttribute('data-block-id'), id).toBe(id)
    }

    // A new block changes which blocks carry rows, so the rows are rebuilt.
    editor.commands.insertContentAt(editor.state.doc.content.size, '<p data-block-id="fresh">New.</p>')
    expect(rowFor(editor, 'fresh')?.closest('[data-block-id]')?.getAttribute('data-block-id')).toBe('fresh')
  })
})
