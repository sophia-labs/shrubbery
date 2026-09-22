/**
 * Garden's copyable code-block NodeView, with Mermaid rendering severed behind
 * a host seam so the editor kernel remains free of renderer/theme packages.
 *
 * The durable `codeBlock` schema and commands still come from TipTap's
 * CodeBlock extension. This extension replaces only its view:
 *
 * - every code block gets a copy button;
 * - `language="mermaid"` gets Garden's source/preview card and explicit render
 *   lifecycle;
 * - the host owns Mermaid loading, SVG validation, caching and theme changes.
 */
import { CodeBlock, type CodeBlockOptions } from '@tiptap/extension-code-block'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'

export type MermaidRenderCurrentCheck = () => boolean
export type MermaidRenderOutcome = void | boolean

/** Host-owned renderer. The kernel never imports Mermaid or a theme store. */
export interface MermaidRenderHost {
  render(
    source: string,
    preview: HTMLElement,
    isCurrent: MermaidRenderCurrentCheck,
  ): MermaidRenderOutcome | Promise<MermaidRenderOutcome>
  /** Notify mounted views when renderer inputs (notably theme tokens) change. */
  subscribe?(listener: () => void): () => void
}

export type ClipboardWriter = (text: string) => void | Promise<void>

type EditorLike = {
  state?: { selection?: { from: number; to: number } }
  isFocused?: boolean
  on?: (event: string, handler: () => void) => unknown
  off?: (event: string, handler: () => void) => unknown
}

export interface CodeBlockNodeViewOptions {
  mermaid?: MermaidRenderHost
  writeClipboard?: ClipboardWriter
  renderDelayMs?: number
  getPos?: () => number | undefined
  editor?: EditorLike
  /** Deterministic selection seam used by focused NodeView tests. */
  isSourceSelected?: () => boolean
}

export interface CopyableCodeBlockOptions extends CodeBlockOptions {
  mermaid?: MermaidRenderHost
  writeClipboard?: ClipboardWriter
  renderDelayMs: number
}

export function isMermaidLanguage(language: unknown): boolean {
  return typeof language === 'string' && language.trim().toLowerCase() === 'mermaid'
}

export function mermaidSourceRenderKey(source: string): string {
  return source.replace(/\r\n?/g, '\n').trim()
}

function replacePreviewMessage(
  preview: HTMLElement,
  className: string,
  message: string,
): void {
  const messageElement = document.createElement('div')
  messageElement.className = className
  messageElement.textContent = message
  preview.replaceChildren(messageElement)
}

function showRenderFailure(preview: HTMLElement, error?: unknown): void {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : typeof error === 'string' && error.trim()
        ? error
        : 'Unable to render Mermaid diagram.'
  replacePreviewMessage(preview, 'mermaid-error', message)
  preview.removeAttribute('aria-busy')
}

function syncBlockId(wrapper: HTMLElement, node: ProseMirrorNode): void {
  const blockId = node.attrs?.['data-block-id']
  if (typeof blockId === 'string' && blockId) {
    wrapper.setAttribute('data-block-id', blockId)
  } else {
    wrapper.removeAttribute('data-block-id')
  }
}

function syncLanguageClass(code: HTMLElement, node: ProseMirrorNode): void {
  const language = node.attrs?.language
  code.className = typeof language === 'string' && language ? `language-${language}` : ''
}

function browserClipboardWriter(text: string): Promise<void> | void {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  const writeText = clipboard?.writeText
  if (!writeText) return Promise.reject(new Error('Clipboard API unavailable'))
  return writeText.call(clipboard, text)
}

function createCopyButton(
  getText: () => string,
  writer: ClipboardWriter,
  label = 'Copy',
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'code-copy-btn'
  button.setAttribute('contenteditable', 'false')
  button.setAttribute('aria-label', 'Copy code')
  button.title = 'Copy code'
  button.textContent = label
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()

    Promise.resolve(writer(getText()))
      .then(() => {
        button.textContent = 'Copied'
        button.classList.add('copied')
        setTimeout(() => {
          button.textContent = label
          button.classList.remove('copied')
        }, 2_000)
      })
      .catch(() => {
        // Clipboard rejection is intentionally non-destructive: source remains editable.
      })
  })
  return button
}

function createButton(
  className: string,
  label: string,
  title: string,
  onClick: (event: MouseEvent) => void,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.setAttribute('contenteditable', 'false')
  button.title = title
  button.textContent = label
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick(event)
  })
  return button
}

function createPlainCodeBlockNodeView(
  initialNode: ProseMirrorNode,
  writer: ClipboardWriter,
): NodeView {
  let currentNode = initialNode
  const wrapper = document.createElement('div')
  wrapper.className = 'code-block-wrapper'
  syncBlockId(wrapper, currentNode)

  const pre = document.createElement('pre')
  const code = document.createElement('code')
  syncLanguageClass(code, currentNode)
  pre.appendChild(code)

  const copyButton = createCopyButton(() => code.textContent ?? '', writer)
  wrapper.append(pre, copyButton)

  return {
    dom: wrapper,
    contentDOM: code,
    update(node: ProseMirrorNode) {
      if (node.type !== currentNode.type || isMermaidLanguage(node.attrs?.language)) return false
      currentNode = node
      syncBlockId(wrapper, currentNode)
      syncLanguageClass(code, currentNode)
      return true
    },
    ignoreMutation(mutation) {
      if (mutation.type === 'selection') return false
      const target = mutation.target
      // NodeView-owned class/attribute changes must not make ProseMirror rebuild it.
      if (target === wrapper) return true
      return target === copyButton || copyButton.contains(target)
    },
    stopEvent(event) {
      const target = event.target
      return target instanceof Node && (target === copyButton || copyButton.contains(target))
    },
  }
}

function createMermaidCodeBlockNodeView(
  initialNode: ProseMirrorNode,
  options: CodeBlockNodeViewOptions,
  writer: ClipboardWriter,
): NodeView {
  let currentNode = initialNode
  let renderToken = 0
  let renderTimer: ReturnType<typeof setTimeout> | null = null
  let destroyed = false
  let currentSource = initialNode.textContent
  let currentRenderKey = mermaidSourceRenderKey(currentSource)
  let renderedRenderKey: string | null = null
  let renderDirty = false
  let sourceOpen = false

  const wrapper = document.createElement('div')
  wrapper.className = 'code-block-wrapper mermaid-code-block-wrapper'
  syncBlockId(wrapper, currentNode)

  const header = document.createElement('div')
  header.className = 'mermaid-code-block-header'
  header.setAttribute('contenteditable', 'false')

  const title = document.createElement('span')
  title.className = 'mermaid-code-block-title'
  title.textContent = 'Mermaid'

  const preview = document.createElement('div')
  preview.className = 'mermaid-preview'
  preview.setAttribute('contenteditable', 'false')
  preview.setAttribute('aria-live', 'polite')

  const pre = document.createElement('pre')
  pre.className = 'mermaid-source'
  const code = document.createElement('code')
  syncLanguageClass(code, currentNode)
  pre.appendChild(code)

  const sourceIsActive = (): boolean => {
    if (options.isSourceSelected) return options.isSourceSelected()
    if (!options.getPos || !options.editor?.state?.selection) return false
    const pos = options.getPos()
    if (typeof pos !== 'number') return false

    const { from, to } = options.editor.state.selection
    const contentStart = pos + 1
    const contentEnd = pos + Math.max(1, currentNode.nodeSize - 1)
    return from >= contentStart && to <= contentEnd
  }

  const previewMatchesRenderKey = (renderKey: string): boolean => {
    if (renderedRenderKey === renderKey) return true
    if (preview.dataset.mermaidRenderKey !== renderKey) return false
    return preview.querySelector('svg') !== null || preview.querySelector('.mermaid-empty') !== null
  }

  let sourceToggle!: HTMLButtonElement
  let renderButton!: HTMLButtonElement

  const applySourceVisibility = () => {
    const caretInside = options.editor?.isFocused !== false && sourceIsActive()
    const hasError = preview.querySelector('.mermaid-error') !== null
    const isEmpty = !mermaidSourceRenderKey(currentSource)
    const open = sourceOpen || caretInside || renderDirty || hasError || isEmpty
    wrapper.classList.toggle('mermaid-source-collapsed', !open)
    sourceToggle.classList.toggle('is-open', open)
    sourceToggle.setAttribute('aria-expanded', open ? 'true' : 'false')
  }

  const setRenderDirty = (dirty: boolean) => {
    renderDirty = dirty
    wrapper.classList.toggle('mermaid-code-block-wrapper-editing', dirty)
    renderButton.classList.toggle('is-dirty', dirty)
    if (dirty) preview.removeAttribute('aria-busy')
    applySourceVisibility()
  }

  const clearRenderTimer = () => {
    if (renderTimer === null) return
    clearTimeout(renderTimer)
    renderTimer = null
  }

  const invalidateRender = () => {
    renderToken += 1
    clearRenderTimer()
  }

  const renderSource = (source: string, delayMs = options.renderDelayMs ?? 250) => {
    const renderKey = mermaidSourceRenderKey(source)
    renderToken += 1
    const token = renderToken
    clearRenderTimer()

    if (previewMatchesRenderKey(renderKey)) {
      setRenderDirty(false)
      preview.removeAttribute('aria-busy')
      return
    }

    setRenderDirty(false)

    const recordOutcome = (outcome: MermaidRenderOutcome) => {
      if (destroyed || token !== renderToken) return
      if (outcome === false) {
        applySourceVisibility()
        return
      }
      renderedRenderKey = renderKey
      setRenderDirty(false)
    }

    const fail = (error?: unknown) => {
      if (destroyed || token !== renderToken) return
      showRenderFailure(preview, error)
      setRenderDirty(false)
    }

    const run = () => {
      renderTimer = null
      if (!options.mermaid) {
        fail('Mermaid rendering is unavailable in this host.')
        return
      }
      try {
        const outcome = options.mermaid.render(
          source,
          preview,
          () => !destroyed && token === renderToken,
        )
        if (outcome && typeof (outcome as Promise<unknown>).then === 'function') {
          void Promise.resolve(outcome).then(recordOutcome).catch(fail)
        } else {
          recordOutcome(outcome as MermaidRenderOutcome)
        }
      } catch (error) {
        fail(error)
      }
    }

    if (delayMs <= 0) run()
    else renderTimer = setTimeout(run, delayMs)
  }

  const flushIfInactive = () => {
    if (destroyed || !renderDirty) return
    if (options.editor?.isFocused !== false && sourceIsActive()) return
    renderSource(currentSource, 0)
  }

  const onSelectionOrFocusChange = () => {
    if (destroyed) return
    flushIfInactive()
    applySourceVisibility()
  }

  const rerenderForHostChange = () => {
    if (destroyed) return
    renderedRenderKey = null
    delete preview.dataset.mermaidRenderKey
    if (options.editor?.isFocused !== false && sourceIsActive()) {
      setRenderDirty(true)
      return
    }
    renderSource(currentSource, 0)
  }

  renderButton = createButton(
    'code-copy-btn mermaid-render-btn',
    'Render',
    'Render diagram',
    () => renderSource(currentSource, 0),
  )
  renderButton.setAttribute('aria-label', 'Render Mermaid diagram')
  sourceToggle = createButton(
    'code-copy-btn mermaid-source-toggle',
    'Source',
    'Show or hide Mermaid source',
    () => {
      sourceOpen = !sourceOpen
      applySourceVisibility()
    },
  )
  sourceToggle.setAttribute('aria-label', 'Show or hide Mermaid source')
  const copyButton = createCopyButton(() => code.textContent ?? '', writer)
  const actions = document.createElement('div')
  actions.className = 'mermaid-code-block-actions'
  actions.append(sourceToggle, renderButton, copyButton)

  header.append(title, actions)
  wrapper.append(header, preview, pre)

  options.editor?.on?.('selectionUpdate', onSelectionOrFocusChange)
  options.editor?.on?.('blur', onSelectionOrFocusChange)
  options.editor?.on?.('focus', onSelectionOrFocusChange)
  const unsubscribe = options.mermaid?.subscribe?.(rerenderForHostChange)
  renderSource(currentSource, 0)

  return {
    dom: wrapper,
    contentDOM: code,
    update(node: ProseMirrorNode) {
      if (node.type !== currentNode.type || !isMermaidLanguage(node.attrs?.language)) return false
      currentNode = node
      syncBlockId(wrapper, currentNode)
      syncLanguageClass(code, currentNode)
      const nextSource = currentNode.textContent
      const nextRenderKey = mermaidSourceRenderKey(nextSource)
      if (nextRenderKey !== currentRenderKey) {
        currentSource = nextSource
        currentRenderKey = nextRenderKey
        if (sourceIsActive()) {
          invalidateRender()
          setRenderDirty(!previewMatchesRenderKey(nextRenderKey))
        } else {
          renderSource(nextSource)
        }
      } else {
        currentSource = nextSource
      }
      return true
    },
    ignoreMutation(mutation) {
      if (mutation.type === 'selection') return false
      const target = mutation.target
      if (target === code || code.contains(target)) return false
      if (target === wrapper) return true
      return target === preview || preview.contains(target) || target === header || header.contains(target)
    },
    stopEvent(event) {
      const target = event.target
      if (!(target instanceof Node)) return false
      if (target === code || code.contains(target)) return false
      return target === preview || preview.contains(target) || target === header || header.contains(target)
    },
    destroy() {
      destroyed = true
      invalidateRender()
      unsubscribe?.()
      options.editor?.off?.('selectionUpdate', onSelectionOrFocusChange)
      options.editor?.off?.('blur', onSelectionOrFocusChange)
      options.editor?.off?.('focus', onSelectionOrFocusChange)
    },
  }
}

export function createCodeBlockNodeView(
  initialNode: ProseMirrorNode,
  options: CodeBlockNodeViewOptions = {},
): NodeView {
  const writer = options.writeClipboard ?? browserClipboardWriter
  if (isMermaidLanguage(initialNode.attrs?.language)) {
    return createMermaidCodeBlockNodeView(initialNode, options, writer)
  }
  return createPlainCodeBlockNodeView(initialNode, writer)
}

export const CopyableCodeBlock = CodeBlock.extend<CopyableCodeBlockOptions>({
  addOptions() {
    return {
      ...(this.parent?.() ?? {}),
      mermaid: undefined,
      writeClipboard: undefined,
      renderDelayMs: 250,
    } as CopyableCodeBlockOptions
  },

  addNodeView() {
    return ({ node, getPos, editor }) =>
      createCodeBlockNodeView(node, {
        mermaid: this.options.mermaid,
        writeClipboard: this.options.writeClipboard,
        renderDelayMs: this.options.renderDelayMs,
        getPos: typeof getPos === 'function' ? getPos : undefined,
        // TipTap's Editor overloads are stricter than this tiny structural seam.
        editor: editor as unknown as EditorLike,
      })
  },
})

export default CopyableCodeBlock
