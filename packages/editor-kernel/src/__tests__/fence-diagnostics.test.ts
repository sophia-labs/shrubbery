/**
 * A checker's verdict drawn into the one fence it is about: spans underlined, a note at the line's end, stale marks
 * dimmed while the text moves on, and a verdict for other text never drawn. A REAL TipTap editor on the document roster.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createKernelEditor, createFenceDiagnostics, findFences, type Editor, type CodeHighlighter } from '../index'

const editors: Editor[] = []
afterEach(() => { for (const e of editors) e.destroy(); editors.length = 0 })

const SCORE = '# tempo: 96\nbar 1: gt.v=C4e@2:3 Re Rh.\n'

function mount(score = SCORE, highlight: CodeHighlighter | null = null) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const { extension, port } = createFenceDiagnostics({ language: 'mus' })
  const editor = createKernelEditor(element, { extraExtensions: [extension], codeHighlight: highlight })
  editors.push(editor)
  editor.commands.setContent({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'A wrong fret.' }] },
      { type: 'codeBlock', attrs: { language: 'mus' }, content: [{ type: 'text', text: score }] },
    ],
  })
  return { editor, port, element }
}

function fenceStart(editor: Editor): number {
  return findFences(editor.state.doc, 'mus')[0]!.start
}

describe('fence diagnostics', () => {
  it('underlines the span and writes a note at the end of its line', () => {
    const { editor, port, element } = mount()
    const from = SCORE.indexOf('C4e@2:3')
    port.set({ source: SCORE, diagnostics: [{ from, to: from + 7, severity: 'error', code: 'tab-position-disagrees', message: 'string 2 at fret 3 sounds D4, not C4' }] })
    const [range] = port.ranges()
    expect(range).toBeDefined()
    expect(editor.state.doc.textBetween(range!.from, range!.to)).toBe('C4e@2:3')
    expect(range!.className).toContain('hoja-diag--error')
    const mark = element.querySelector('.hoja-diag--error') as HTMLElement
    expect(mark.textContent).toBe('C4e@2:3')
    expect(mark.title).toContain('sounds D4')
    const note = element.querySelector('.hoja-diag-note') as HTMLElement
    expect(note.textContent).toBe('string 2 at fret 3 sounds D4, not C4')
    expect(note.getAttribute('contenteditable')).toBe('false')
    // The note is a widget, not text: the fence's text is still the score.
    expect(findFences(editor.state.doc, 'mus')[0]!.text).toBe(SCORE)
  })

  it('a verdict for other text is not drawn, and an edit marks the drawn one stale', () => {
    const { editor, port, element } = mount()
    port.set({ source: SCORE.replace('C4', 'D4'), diagnostics: [{ from: 0, to: 3, severity: 'error', message: 'x' }] })
    expect(port.ranges()).toEqual([])
    expect(port.stale()).toBe(true)

    const from = SCORE.indexOf('C4e@2:3')
    port.set({ source: SCORE, diagnostics: [{ from, to: from + 7, severity: 'error', message: 'wrong fret' }] })
    expect(port.stale()).toBe(false)
    // Type the fix inside the token (fret 3 to 1): the mark moves with the text and is stale until the next verdict.
    const at = fenceStart(editor) + from + 6
    editor.view.dispatch(editor.state.tr.insertText('1', at, at + 1))
    expect(port.stale()).toBe(true)
    expect(element.querySelector('.hoja-diag--stale')).not.toBeNull()
    const fixed = findFences(editor.state.doc, 'mus')[0]!.text
    expect(fixed).toContain('C4e@2:1')
    port.set({ source: fixed, diagnostics: [] })
    expect(port.ranges()).toEqual([])
    expect(element.querySelector('.hoja-diag-note')).toBeNull()
    expect(port.stale()).toBe(false)
  })

  it('several diagnostics on a line share one note, errors first', () => {
    const { port, element } = mount()
    const a = SCORE.indexOf('C4e@2:3')
    const b = SCORE.indexOf('Rh.')
    port.set({ source: SCORE, diagnostics: [
      { from: b, to: b + 3, severity: 'warning', message: 'a stretch' },
      { from: a, to: a + 7, severity: 'error', message: 'wrong fret' },
    ] })
    const notes = element.querySelectorAll('.hoja-diag-note')
    expect(notes.length).toBe(1)
    expect(notes[0]!.textContent).toBe('wrong fret (+1 more)')
    expect(notes[0]!.className).toContain('hoja-diag-note--error')
  })

  it('a host highlighter colours code blocks while editing', () => {
    const highlight: CodeHighlighter = (code, language) => (language === 'mus' ? [{ from: 0, to: code.indexOf(':'), className: 'hljs-meta' }] : null)
    const { element } = mount(SCORE, highlight)
    const meta = element.querySelector('.hljs-meta') as HTMLElement
    expect(meta.textContent).toBe('# tempo')
  })

  it('a verdict handed over before the editor mounts is drawn once it does', async () => {
    const { extension, port } = createFenceDiagnostics({ language: 'mus' })
    const from = SCORE.indexOf('C4e@2:3')
    port.set({ source: SCORE, diagnostics: [{ from, to: from + 7, severity: 'error', message: 'wrong fret' }] })
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = createKernelEditor(element, { extraExtensions: [extension] })
    editors.push(editor)
    await Promise.resolve()
    expect(port.ranges()).toEqual([])
    expect(port.stale()).toBe(true)
    editor.commands.setContent({ type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'mus' }, content: [{ type: 'text', text: SCORE }] }] })
    expect(port.ranges().length).toBe(1)
    expect(port.stale()).toBe(false)
  })
})
