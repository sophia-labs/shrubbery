import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createKernelEditor } from '../index'
import type { MathRenderer } from '../extensions/math'

const editors: Editor[] = []

afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

function mount(opts: Parameters<typeof createKernelEditor>[1] = {}): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = createKernelEditor(element, opts)
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

function findFirstNodeByName(editor: Editor, name: string): { node: ReturnType<Editor['state']['doc']['nodeAt']>, pos: number } | null {
  let found: { node: ReturnType<Editor['state']['doc']['nodeAt']>, pos: number } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === name) {
      found = { node, pos }
      return false
    }
    return true
  })
  return found
}

describe('insertInlineMath command', () => {
  it('inserts a mathInline atom with the given src', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-a">before </p>')
    editor.commands.focus('end')

    expect(editor.commands.insertInlineMath('E = mc^2')).toBe(true)

    const inline = findFirstNodeByName(editor, 'mathInline')
    expect(inline).not.toBeNull()
    expect(inline?.node?.attrs.src).toBe('E = mc^2')
  })

  it('renders mathInline as <span data-math-inline="…">', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-a"></p>')
    editor.commands.focus('end')
    editor.commands.insertInlineMath('\\alpha')

    expect(editor.getHTML()).toContain('data-math-inline="\\alpha"')
  })
})

describe('insertBlockMath command', () => {
  it('inserts a mathBlock atom with the given src', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-a">x</p>')
    editor.commands.focus('end')

    expect(editor.commands.insertBlockMath('\\int_0^1 x \\, dx')).toBe(true)

    const block = findFirstNodeByName(editor, 'mathBlock')
    expect(block).not.toBeNull()
    expect(block?.node?.attrs.src).toBe('\\int_0^1 x \\, dx')
  })

  it('renders mathBlock as <div data-math-block="…">', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-a">y</p>')
    editor.commands.focus('end')
    editor.commands.insertBlockMath('\\sum_i x_i')

    expect(editor.getHTML()).toContain('data-math-block="\\sum_i x_i"')
  })

  it('accepts empty src — slash /math inserts an empty mathBlock for the user to fill', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-a"></p>')
    editor.commands.focus('end')

    expect(editor.commands.insertBlockMath('')).toBe(true)

    const block = findFirstNodeByName(editor, 'mathBlock')
    expect(block).not.toBeNull()
    expect(block?.node?.attrs.src).toBe('')
  })
})

describe('$$…$$ inline input rule', () => {
  it('typing $$E=mc^2$$ collapses the surrounding text into a mathInline', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-a">before </p>')
    editor.commands.focus('end')
    typeText(editor, '$$E=mc^2$$')

    const inline = findFirstNodeByName(editor, 'mathInline')
    expect(inline).not.toBeNull()
    expect(inline?.node?.attrs.src).toBe('E=mc^2')
    expect(editor.getHTML()).not.toContain('$$E=mc^2$$')
  })

  it('does not match a single $ pair', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-a"></p>')
    editor.commands.focus('end')
    typeText(editor, '$x$')

    expect(findFirstNodeByName(editor, 'mathInline')).toBeNull()
    expect(editor.getText()).toContain('$x$')
  })

  it('does not match an empty $$$$', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-a"></p>')
    editor.commands.focus('end')
    typeText(editor, '$$$$')

    expect(findFirstNodeByName(editor, 'mathInline')).toBeNull()
  })
})

describe('HTML round-trip', () => {
  it('parseHTML restores mathInline from <span data-math-inline="…">', () => {
    const editor = mount()
    editor.commands.setContent(
      '<p data-block-id="block-a">prefix <span data-math-inline="\\sigma">σ</span> suffix</p>',
    )

    const inline = findFirstNodeByName(editor, 'mathInline')
    expect(inline?.node?.attrs.src).toBe('\\sigma')
  })

  it('parseHTML restores mathBlock from <div data-math-block="…">', () => {
    const editor = mount()
    editor.commands.setContent('<div data-math-block="\\pi^2"></div>')

    const block = findFirstNodeByName(editor, 'mathBlock')
    expect(block?.node?.attrs.src).toBe('\\pi^2')
  })

  it('round-trips inline math through getHTML then setContent', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-a"></p>')
    editor.commands.focus('end')
    editor.commands.insertInlineMath('\\theta')
    const first = editor.getHTML()

    const editor2 = mount()
    editor2.commands.setContent(first)
    const inline = findFirstNodeByName(editor2, 'mathInline')
    expect(inline?.node?.attrs.src).toBe('\\theta')
  })
})

describe('renderMath callback (KaTeX-seam)', () => {
  it('default renderer paints the trimmed src as plain text into the rendered span', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-a"></p>')
    editor.commands.focus('end')
    editor.commands.insertInlineMath('  x + y  ')

    const rendered = document.querySelector('.math-node .math-rendered')
    expect(rendered?.textContent).toBe('x + y')
  })

  it('host-supplied renderMath is invoked with the target element and src', async () => {
    const calls: Array<{ target: HTMLElement; src: string; displayMode: boolean }> = []
    const renderMath: MathRenderer = (target, request) => {
      calls.push({ target, src: request.src, displayMode: request.displayMode })
      target.textContent = `KaTeX(${request.src})`
    }
    const editor = mount({ renderMath })
    editor.commands.setContent('<p data-block-id="block-a"></p>')
    editor.commands.focus('end')
    editor.commands.insertInlineMath('\\beta')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.src).toBe('\\beta')
    expect(calls[0]?.displayMode).toBe(false)
    expect(document.querySelector('.math-node .math-rendered')?.textContent).toBe('KaTeX(\\beta)')
  })

  it('marks the node with data-math-error if a renderer Promise rejects', async () => {
    const renderMath: MathRenderer = async () => {
      throw new Error('katex blew up')
    }
    const editor = mount({ renderMath })
    editor.commands.setContent('<p data-block-id="block-a"></p>')
    editor.commands.focus('end')
    editor.commands.insertInlineMath('\\bad')

    await new Promise((r) => setTimeout(r, 0))

    const node = document.querySelector('.math-node')
    expect(node?.hasAttribute('data-math-error')).toBe(true)
  })
})

describe('NodeView edit-on-click', () => {
  it('clicking a mathInline opens an edit bar with the current src', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-a"></p>')
    editor.commands.focus('end')
    editor.commands.insertInlineMath('\\delta')

    const node = document.querySelector('.math-node') as HTMLElement | null
    expect(node).not.toBeNull()
    node?.click()

    const input = document.querySelector('.math-edit-bar input') as HTMLInputElement | null
    expect(input).not.toBeNull()
    expect(input?.value).toBe('\\delta')
  })

  it('pressing Enter in the edit bar applies the new src and removes the bar', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-a"></p>')
    editor.commands.focus('end')
    editor.commands.insertInlineMath('\\delta')

    const node = document.querySelector('.math-node') as HTMLElement | null
    node?.click()

    const input = document.querySelector('.math-edit-bar input') as HTMLInputElement | null
    if (!input) throw new Error('edit bar input missing')
    input.value = '\\gamma'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(findFirstNodeByName(editor, 'mathInline')?.node?.attrs.src).toBe('\\gamma')
    expect(document.querySelector('.math-edit-bar')).toBeNull()
  })

  it('pressing Escape closes the edit bar without applying changes', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-a"></p>')
    editor.commands.focus('end')
    editor.commands.insertInlineMath('\\delta')

    const node = document.querySelector('.math-node') as HTMLElement | null
    node?.click()

    const input = document.querySelector('.math-edit-bar input') as HTMLInputElement | null
    if (!input) throw new Error('edit bar input missing')
    input.value = '\\omega'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(findFirstNodeByName(editor, 'mathInline')?.node?.attrs.src).toBe('\\delta')
    expect(document.querySelector('.math-edit-bar')).toBeNull()
  })

  it('pressing Escape does NOT commit even if a synthetic blur fires (removal-from-DOM race)', () => {
    // In real browsers, removing a focused input synthetically fires `blur`.
    // The blur handler on the edit bar calls `apply()`, which would commit
    // the typed value Escape was meant to cancel. Regression test: simulate
    // the synthetic blur after Escape and assert the node's src is unchanged.
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-a"></p>')
    editor.commands.focus('end')
    editor.commands.insertInlineMath('\\delta')

    const node = document.querySelector('.math-node') as HTMLElement | null
    node?.click()

    const input = document.querySelector('.math-edit-bar input') as HTMLInputElement | null
    if (!input) throw new Error('edit bar input missing')
    input.focus()
    input.value = '\\omega'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    // Simulate the browser's synthetic blur on a now-detached input. This is
    // the event ordering that surfaced the bug; pre-fix it would commit
    // `\\omega` here.
    input.dispatchEvent(new Event('blur'))

    expect(findFirstNodeByName(editor, 'mathInline')?.node?.attrs.src).toBe('\\delta')
    expect(document.querySelector('.math-edit-bar')).toBeNull()
  })
})
