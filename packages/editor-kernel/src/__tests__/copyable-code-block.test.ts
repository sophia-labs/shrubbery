import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
  createCodeBlockNodeView,
  createKernelEditor,
  isMermaidLanguage,
  kernelExtensions,
  mermaidSourceRenderKey,
  type MermaidRenderHost,
} from '../index'

const editors: ReturnType<typeof createKernelEditor>[] = []
const CODE_SCHEMA = getSchema(kernelExtensions())

afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors.length = 0
  vi.useRealTimers()
})

function mount(options: Parameters<typeof createKernelEditor>[1] = {}) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = createKernelEditor(element, options)
  editors.push(editor)
  return { editor, element }
}

function codeNode(source: string, language: string | null = null, blockId = 'block-code') {
  return CODE_SCHEMA.nodes.codeBlock.create(
    { language, 'data-block-id': blockId },
    source ? CODE_SCHEMA.text(source) : undefined,
  )
}

function updateNodeView(
  view: ReturnType<typeof createCodeBlockNodeView>,
  node: ProseMirrorNode,
): boolean {
  return (view.update as unknown as (next: ProseMirrorNode) => boolean)(node)
}

describe('CopyableCodeBlock — durable CodeBlock parity', () => {
  it('keeps TipTap codeBlock schema/commands while replacing only its NodeView', () => {
    const { editor } = mount()
    expect(editor.schema.nodes.codeBlock.spec.code).toBe(true)
    expect(editor.commands.setCodeBlock).toBeTypeOf('function')
    expect(editor.commands.toggleCodeBlock).toBeTypeOf('function')
    expect(editor.extensionManager.extensions.filter((extension) => extension.name === 'codeBlock')).toHaveLength(1)

    editor.commands.setContent('<p>const answer = 42</p>')
    editor.commands.selectAll()
    expect(editor.commands.setCodeBlock({ language: 'ts' })).toBe(true)
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'codeBlock',
      attrs: { language: 'ts' },
    })
  })

  it('round-trips language and block id through the real editor DOM', () => {
    const { editor, element } = mount()
    editor.commands.setContent({
      type: 'doc',
      content: [{
        type: 'codeBlock',
        attrs: { language: 'typescript', 'data-block-id': 'block-ts' },
        content: [{ type: 'text', text: 'let x = 1' }],
      }],
    })

    const wrapper = element.querySelector('.code-block-wrapper')
    expect(wrapper?.getAttribute('data-block-id')).toBe('block-ts')
    expect(wrapper?.querySelector('code')?.className).toBe('language-typescript')
    expect(wrapper?.querySelector('code')?.textContent).toBe('let x = 1')
    expect(editor.getHTML()).toContain('language-typescript')
  })

  it('copies the current editable source through the injected clipboard seam', async () => {
    const writeClipboard = vi.fn<(text: string) => Promise<void>>().mockResolvedValue()
    const { editor, element } = mount({ writeClipboard })
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'mutable()' }] }],
    })

    const button = element.querySelector<HTMLButtonElement>('.code-copy-btn')!
    button.click()
    await Promise.resolve()
    expect(writeClipboard).toHaveBeenCalledWith('mutable()')
    expect(button.textContent).toBe('Copied')
    expect(button.classList.contains('copied')).toBe(true)
  })

  it('keeps source mutations ProseMirror-owned and chrome mutations NodeView-owned', () => {
    const view = createCodeBlockNodeView(codeNode('alpha', 'ts'))
    const code = view.contentDOM as HTMLElement
    const button = (view.dom as HTMLElement).querySelector('button')!
    expect(view.ignoreMutation?.({ type: 'selection' } as unknown as MutationRecord)).toBe(false)
    expect(view.ignoreMutation?.({ type: 'characterData', target: code } as unknown as MutationRecord)).toBe(false)
    expect(view.ignoreMutation?.({ type: 'attributes', target: button } as unknown as MutationRecord)).toBe(true)
    expect(view.ignoreMutation?.({ type: 'attributes', target: view.dom } as unknown as MutationRecord)).toBe(true)
    expect(updateNodeView(view, codeNode('beta', 'mermaid'))).toBe(false)
  })
})

describe('CopyableCodeBlock — Mermaid lifecycle seam', () => {
  it('normalizes only the exact Mermaid language and stable source keys', () => {
    expect(isMermaidLanguage(' Mermaid ')).toBe(true)
    expect(isMermaidLanguage('mermaid-js')).toBe(false)
    expect(isMermaidLanguage(null)).toBe(false)
    expect(mermaidSourceRenderKey('  graph TD\r\n  A-->B  ')).toBe('graph TD\n  A-->B')
  })

  it('renders through the host, collapses clean source, and exposes accessible actions', () => {
    const render = vi.fn<MermaidRenderHost['render']>((source, preview) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('data-source', source)
      preview.replaceChildren(svg)
      preview.dataset.mermaidRenderKey = mermaidSourceRenderKey(source)
      return true
    })
    const { editor, element } = mount({ mermaid: { render }, mermaidRenderDelayMs: 0 })
    editor.commands.setContent({
      type: 'doc',
      content: [{
        type: 'codeBlock',
        attrs: { language: 'mermaid' },
        content: [{ type: 'text', text: 'graph TD; A-->B' }],
      }],
    })

    const wrapper = element.querySelector('.mermaid-code-block-wrapper')!
    expect(render).toHaveBeenLastCalledWith(
      'graph TD; A-->B',
      expect.any(HTMLElement),
      expect.any(Function),
    )
    expect(wrapper.querySelector('svg')?.getAttribute('data-source')).toBe('graph TD; A-->B')
    expect(wrapper.classList.contains('mermaid-source-collapsed')).toBe(true)
    expect(wrapper.querySelector('.mermaid-source-toggle')?.getAttribute('aria-expanded')).toBe('false')
    expect(wrapper.querySelector('[aria-label="Render Mermaid diagram"]')).not.toBeNull()

    ;(wrapper.querySelector('.mermaid-source-toggle') as HTMLButtonElement).click()
    expect(wrapper.classList.contains('mermaid-source-collapsed')).toBe(false)
    editor.destroy()
    editors.splice(editors.indexOf(editor), 1)
  })

  it('shows an honest source-open error when the host has no renderer', () => {
    const view = createCodeBlockNodeView(codeNode('graph TD; A-->B', 'mermaid'), {
      renderDelayMs: 0,
      isSourceSelected: () => false,
    })
    const wrapper = view.dom as HTMLElement
    expect(wrapper.querySelector('.mermaid-error')?.textContent).toContain('unavailable')
    expect(wrapper.classList.contains('mermaid-source-collapsed')).toBe(false)
    view.destroy?.()
  })

  it('defers source edits while selected, then flushes immediately on blur', () => {
    let selected = false
    const handlers = new Map<string, () => void>()
    const render = vi.fn<MermaidRenderHost['render']>((source, preview) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      preview.replaceChildren(svg)
      preview.dataset.mermaidRenderKey = mermaidSourceRenderKey(source)
      return true
    })
    const editor = {
      isFocused: true,
      on: (event: string, handler: () => void) => handlers.set(event, handler),
      off: (event: string) => handlers.delete(event),
    }
    const view = createCodeBlockNodeView(codeNode('graph TD; A-->B', 'mermaid'), {
      mermaid: { render },
      renderDelayMs: 0,
      editor,
      isSourceSelected: () => selected,
    })
    expect(render).toHaveBeenCalledTimes(1)

    selected = true
    expect(updateNodeView(view, codeNode('graph TD; A-->C', 'mermaid'))).toBe(true)
    expect(render).toHaveBeenCalledTimes(1)
    expect((view.dom as HTMLElement).classList.contains('mermaid-code-block-wrapper-editing')).toBe(true)

    editor.isFocused = false
    handlers.get('blur')?.()
    expect(render).toHaveBeenCalledTimes(2)
    expect(render).toHaveBeenLastCalledWith('graph TD; A-->C', expect.any(HTMLElement), expect.any(Function))
    view.destroy?.()
  })

  it('invalidates a superseded render and unsubscribes theme notifications on destroy', async () => {
    let resolveFirst!: (value: boolean) => void
    let notify!: () => void
    const unsubscribe = vi.fn()
    const currentChecks: Array<() => boolean> = []
    const host: MermaidRenderHost = {
      render: vi.fn((_source, _preview, isCurrent) => {
        currentChecks.push(isCurrent)
        return new Promise<boolean>((resolve) => { resolveFirst = resolve })
      }),
      subscribe(listener) {
        notify = listener
        return unsubscribe
      },
    }
    const view = createCodeBlockNodeView(codeNode('graph TD; A-->B', 'mermaid'), {
      mermaid: host,
      renderDelayMs: 0,
      isSourceSelected: () => false,
    })
    expect(currentChecks[0]()).toBe(true)
    notify()
    expect(currentChecks[0]()).toBe(false)
    expect(host.render).toHaveBeenCalledTimes(2)

    view.destroy?.()
    expect(currentChecks[1]()).toBe(false)
    expect(unsubscribe).toHaveBeenCalledOnce()
    resolveFirst(true)
    await Promise.resolve()
  })
})
