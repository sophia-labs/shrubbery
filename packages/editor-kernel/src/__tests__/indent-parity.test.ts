/**
 * Indentation parity proof for Garden's ACTIVE editor roster.
 *
 * Garden still has a legacy `tiptap-indent.ts` file, but document-editor.ts
 * never imports/registers it. `Outliner` is the sole live Tab/Shift-Tab owner
 * and deliberately covers more of Garden's flat block model. These tests keep
 * Shrubbery aligned with that active behavior without registering two
 * extensions with the same command/shortcut names.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createKernelEditor } from '../index'

const editors: ReturnType<typeof createKernelEditor>[] = []

afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors.length = 0
})

function mount(html: string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = createKernelEditor(element)
  editors.push(editor)
  editor.commands.setContent(html)
  editor.commands.focus('start')
  return { editor, element }
}

function press(element: HTMLElement, key: 'Tab', shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  element.querySelector<HTMLElement>('.ProseMirror')!.dispatchEvent(event)
  return event
}

describe('active Garden indentation parity — Outliner is the sole owner', () => {
  it('registers Outliner, never the unused legacy Indent extension', () => {
    const { editor } = mount('<p>alpha</p>')
    const names = editor.extensionManager.extensions.map((extension) => extension.name)
    expect(names.filter((name) => name === 'outliner')).toHaveLength(1)
    expect(names).not.toContain('indent')
  })

  it('Tab/Shift-Tab mutate a paragraph data-indent through the real keymap', () => {
    const { editor, element } = mount('<p>alpha</p>')
    const tab = press(element, 'Tab')
    expect(tab.defaultPrevented).toBe(true)
    expect(editor.getJSON().content?.[0]?.attrs?.indent).toBe(1)
    expect(element.querySelector('p')?.getAttribute('data-indent')).toBe('1')

    const shiftTab = press(element, 'Tab', true)
    expect(shiftTab.defaultPrevented).toBe(true)
    expect(editor.getJSON().content?.[0]?.attrs?.indent).toBe(0)
    expect(element.querySelector('p')?.hasAttribute('data-indent')).toBe(false)
  })

  it('applies the same active semantics to headings and enforces Garden max level 6', () => {
    const { editor, element } = mount('<h2>alpha</h2>')
    for (let index = 0; index < 8; index += 1) press(element, 'Tab')
    expect(editor.getJSON().content?.[0]?.attrs?.indent).toBe(6)
    expect(element.querySelector('h2')?.getAttribute('data-indent')).toBe('6')

    for (let index = 0; index < 8; index += 1) press(element, 'Tab', true)
    expect(editor.getJSON().content?.[0]?.attrs?.indent).toBe(0)
  })

  it('yields Tab inside code blocks so CodeBlock can own literal indentation', () => {
    const { editor, element } = mount('<pre><code class="language-ts">alpha</code></pre>')
    const event = press(element, 'Tab')
    expect(event.defaultPrevented).toBe(false)
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'codeBlock', attrs: { language: 'ts' } })
  })

  it('keeps Outliner hierarchy richer than the dead legacy extension (list + child cascade)', () => {
    const { editor } = mount('<p data-block-id="a">parent</p><p data-block-id="b" data-indent="1">child</p>')
    editor.commands.setTextSelection(1)
    expect(editor.commands.increaseIndent()).toBe(true)
    expect(editor.getJSON().content?.map((node) => node.attrs?.indent)).toEqual([1, 2])
    expect(editor.commands.decreaseIndent()).toBe(true)
    expect(editor.getJSON().content?.map((node) => node.attrs?.indent)).toEqual([0, 1])
  })
})
