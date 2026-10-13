import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSchema } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
  createCodeBlockNodeView,
  createKernelEditor,
  fitMermaidSvg,
  isMermaidLanguage,
  openMermaidFullscreen,
  kernelExtensions,
  mermaidSourceRenderKey,
  type MermaidRenderHost,
  adoptEditorStyles,
  FIGURE_ZOOM_MAX,
  type FigureZoom,
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

describe('Mermaid figure — faces by stance (senderos mobile pass, 2026-09-25)', () => {
  const host: MermaidRenderHost = {
    render(_source, target) {
      target.innerHTML = '<svg viewBox="0 0 660 300"><text style="font-size:16px">UH-01 · exact numerics</text></svg>'
      return true
    },
  }

  it('reads as the figure (read face), marked as an embed, with a 44px options affordance', () => {
    const view = createCodeBlockNodeView(codeNode('graph TD; A-->B', 'mermaid'), { mermaid: host, renderDelayMs: 0 })
    const wrapper = view.dom as HTMLElement
    expect(wrapper.dataset.faceStance).toBe('read')
    expect(wrapper.dataset.blockEmbed).toBe('')
    const affordance = wrapper.querySelector<HTMLButtonElement>('.mermaid-affordance')!
    expect(affordance.getAttribute('aria-label')).toBe('Diagram options')
    affordance.click()
    expect(wrapper.hasAttribute('data-chrome-open')).toBe(true)
    expect(affordance.getAttribute('aria-expanded')).toBe('true')
    affordance.click()
    expect(wrapper.hasAttribute('data-chrome-open')).toBe(false)
  })

  it('opening the source turns the figure into its draft face', () => {
    const view = createCodeBlockNodeView(codeNode('graph TD; A-->B', 'mermaid'), { mermaid: host, renderDelayMs: 0 })
    const wrapper = view.dom as HTMLElement
    wrapper.querySelector<HTMLButtonElement>('.mermaid-source-toggle')!.click()
    expect(wrapper.dataset.faceStance).toBe('draft')
  })

  it('never scales labels below 11px: the diagram gets a legible minimum width', () => {
    const preview = document.createElement('div')
    document.body.appendChild(preview)
    preview.innerHTML = '<svg viewBox="0 0 660 300"><text style="font-size:16px">x</text></svg>'
    expect(fitMermaidSvg(preview)).toBe(Math.ceil(660 * (11 / 16)))
    expect(preview.querySelector('svg')!.style.minWidth).toBe(`${Math.ceil(660 * (11 / 16))}px`)
  })

  it('the ⋯ lives in a bar above the figure, never inside it', () => {
    const view = createCodeBlockNodeView(codeNode('graph TD; A-->B', 'mermaid'), { mermaid: host, renderDelayMs: 0 })
    const wrapper = view.dom as HTMLElement
    const children = Array.from(wrapper.children) as HTMLElement[]
    const bar = children.find(el => el.classList.contains('mermaid-figure-bar'))!
    const preview = children.find(el => el.classList.contains('mermaid-preview'))!
    expect(bar.querySelector('.mermaid-affordance')).not.toBeNull()
    expect(preview.querySelector('.mermaid-affordance')).toBeNull()
    expect(Array.from(wrapper.children).indexOf(bar)).toBeLessThan(Array.from(wrapper.children).indexOf(preview))
  })

  it('full screen: above the app, zooms fit ⇄ 1:1, closes on Escape', () => {
    const preview = document.createElement('div')
    document.body.appendChild(preview)
    preview.innerHTML = '<svg viewBox="0 0 660 300"><text>x</text></svg>'
    const overlay = openMermaidFullscreen(preview) as HTMLElement & { figureZoom: FigureZoom }
    expect(overlay.parentElement).toBe(document.body)
    const zoom = overlay.figureZoom
    expect(zoom.mode).toBe('fit')
    expect(overlay.dataset.zoomMode).toBe('fit')
    const canvas = overlay.querySelector<HTMLElement>('.mermaid-fullscreen-canvas')!
    expect(canvas.style.width).toBe(`${Math.round(660 * zoom.fitScale)}px`)
    zoom.zoomTo(2)
    expect(zoom.mode).toBe('free')
    expect(overlay.dataset.zoomMode).toBe('free')
    expect(canvas.style.width).toBe('1320px')
    expect(canvas.style.height).toBe('600px')
    zoom.zoomTo(100)
    expect(zoom.scale).toBe(FIGURE_ZOOM_MAX)
    zoom.toggle()
    expect(zoom.mode).toBe('fit')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.querySelector('.mermaid-fullscreen')).toBeNull()
  })
})

describe('editor stylesheets reach the shadow root (2026-09-26)', () => {
  it('adopts a kernel sheet into the shadow root the node renders in, once, before the host sheets', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = host.attachShadow({ mode: 'open' })
    const node = document.createElement('div')
    root.appendChild(node)
    expect(adoptEditorStyles(node, 'test-sheet', '.x{color:red}')).toBe(true)
    expect(adoptEditorStyles(node, 'test-sheet', '.x{color:red}')).toBe(true)
    const adopted = (root as ShadowRoot & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets
    const inRoot = root.querySelectorAll('style[data-editor-style="test-sheet"]').length
    // Constructable sheets where the DOM has them, a <style> in the root otherwise — never document.head.
    expect((adopted?.length ?? 0) + inRoot).toBe(1)
    expect(document.head.querySelector('[data-editor-style="test-sheet"]')).toBeNull()
  })

  it('does nothing until the node is connected', () => {
    expect(adoptEditorStyles(document.createElement('div'), 'detached', '.y{}')).toBe(false)
  })
})
