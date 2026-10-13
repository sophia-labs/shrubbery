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
import { adoptEditorStylesWhenConnected, watchScrollEdges } from '../editor-styles'
import { openMermaidFullscreen } from './mermaid-fullscreen'

export { openMermaidFullscreen, FIGURE_ZOOM_MAX, type FigureZoom, type FigureZoomMode } from './mermaid-fullscreen'

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
  // The language, said where a reader can label the block (the Files reader's code view).
  const wrapper = code.closest('.code-block-wrapper') as HTMLElement | null
  if (wrapper) {
    if (typeof language === 'string' && language) wrapper.dataset.language = language
    else delete wrapper.dataset.language
  }
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
  pre.appendChild(code)
  wrapper.appendChild(pre)
  syncLanguageClass(code, currentNode)

  // The block's own text: decorations (a reader's line numbers) live in the DOM but are not the code.
  const copyButton = createCopyButton(() => currentNode.textContent, writer)
  wrapper.append(copyButton)

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

/** The smallest label size (CSS px) a scaled-down diagram may reach before it scrolls instead. */
export const MERMAID_MIN_LABEL_PX = 11

/**
 * Fit a rendered diagram to its column without shrinking labels below
 * MERMAID_MIN_LABEL_PX: the SVG scales with the column (max-width 100%) but
 * never narrower than the width at which its labels stay legible; past that
 * the preview scrolls. Returns the min-width applied (0 when none).
 */
export function fitMermaidSvg(preview: HTMLElement): number {
  const svg = preview.querySelector('svg')
  if (!svg) return 0
  const box = svg.viewBox?.baseVal
  const width = box && box.width > 0 ? box.width : 0
  if (!width) return 0
  const label = svg.querySelector('text')
  const view = preview.ownerDocument.defaultView
  const fontPx = label && view ? Number.parseFloat(view.getComputedStyle(label).fontSize) || 16 : 16
  const minWidth = Math.ceil(width * Math.min(1, MERMAID_MIN_LABEL_PX / fontPx))
  svg.style.minWidth = `${minWidth}px`
  return minWidth
}

/** Narrow or touch: a tap on a read-face diagram opens it full-screen. */
function prefersFullscreenFigures(doc: Document): boolean {
  const view = doc.defaultView
  if (!view?.matchMedia) return false
  return view.matchMedia(FIGURE_TOUCH_MEDIA).matches
}

/**
 * Where a figure reads as a phone figure: narrow, or a touch screen (a phone
 * in landscape is 844px wide but still a phone). Keep in step with the
 * `@media` in MERMAID_FIGURE_CSS below and the host's phone gutter.
 */
export const FIGURE_TOUCH_MEDIA = '(max-width: 760px), (hover: none), (pointer: coarse)'

/**
 * The figure's own stylesheet (adopted into the editor's root — see
 * editor-styles.ts): the slim bar ABOVE the diagram that carries the ⋯
 * options toggle and the scroll hint (the edge fade is SCROLL_EDGE_CSS). The ⋯ used
 * to sit inside the figure's top-right corner, over a node (2026-09-26).
 * Theme and layout of the card itself stay with the host.
 */
export const MERMAID_FIGURE_CSS = `
.mermaid-code-block-wrapper > .mermaid-figure-bar { display: none; }
@media ${FIGURE_TOUCH_MEDIA} {
  .mermaid-code-block-wrapper[data-face-stance='read'] > .mermaid-figure-bar {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-height: 32px;
    padding: 0;
  }
}
.mermaid-figure-bar > .mermaid-affordance {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin: -6px 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--mn-color-text-tertiary, #697386);
  font: 600 18px/1 var(--mn-font-chrome, system-ui, sans-serif);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.mermaid-figure-bar > .mermaid-affordance:focus-visible {
  outline: 2px solid var(--mn-color-border-focus, #4d8768);
  outline-offset: -4px;
}
.mermaid-code-block-wrapper[data-chrome-open] > .mermaid-figure-bar > .mermaid-affordance {
  color: var(--mn-color-text-accent, #3d7f5f);
}
.mermaid-figure-bar > .mermaid-scroll-hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--mn-color-text-tertiary, #697386);
  font: 400 var(--mn-text-2xs, 0.72rem)/1.3 var(--mn-font-chrome, system-ui, sans-serif);
  letter-spacing: 0.01em;
  visibility: hidden;
}
.mermaid-code-block-wrapper[data-figure-overflow] > .mermaid-figure-bar > .mermaid-scroll-hint { visibility: visible; }
`

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
  // A figure: the outliner's guide line stops at it.
  wrapper.dataset.blockEmbed = ''
  // Faces by stance, like the query block: read = the figure; draft = the
  // source/render/copy chrome (hover, focus, the ⋯ affordance, or an open source).
  wrapper.dataset.faceStance = 'read'
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
    wrapper.dataset.faceStance = open ? 'draft' : 'read'
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
      fitMermaidSvg(preview)
      // A new SVG: watch its width too, and say which sides now overflow.
      watchScrollEdges(preview, showScrollEdges)
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
  const affordance = document.createElement('button')
  affordance.type = 'button'
  affordance.className = 'mermaid-affordance'
  affordance.textContent = '⋯'
  affordance.setAttribute('aria-label', 'Diagram options')
  affordance.setAttribute('aria-expanded', 'false')
  affordance.setAttribute('contenteditable', 'false')
  // Toggles on pointerdown (a tap's release can be re-targeted by the editor);
  // keyboard activation arrives as a click with detail 0.
  const toggleChrome = (): void => {
    const open = !wrapper.hasAttribute('data-chrome-open')
    wrapper.toggleAttribute('data-chrome-open', open)
    affordance.setAttribute('aria-expanded', String(open))
  }
  affordance.addEventListener('mousedown', event => event.preventDefault())
  affordance.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    toggleChrome()
  })
  affordance.addEventListener('click', (event) => {
    if (event.detail === 0) toggleChrome()
  })
  preview.addEventListener('click', () => {
    if (wrapper.dataset.faceStance !== 'read' || !prefersFullscreenFigures(preview.ownerDocument)) return
    openMermaidFullscreen(preview)
  })
  // The slim bar above the figure (phones and touch screens): the scroll
  // hint on the left, the ⋯ on the right — never over the diagram.
  const figureBar = document.createElement('div')
  figureBar.className = 'mermaid-figure-bar'
  figureBar.setAttribute('contenteditable', 'false')
  const scrollHint = document.createElement('span')
  scrollHint.className = 'mermaid-scroll-hint'
  scrollHint.setAttribute('aria-hidden', 'true')
  figureBar.append(scrollHint, affordance)
  const showScrollEdges = (edges: string): void => {
    if (edges) wrapper.dataset.figureOverflow = edges
    else delete wrapper.dataset.figureOverflow
    const tap = prefersFullscreenFigures(preview.ownerDocument) ? ' · tap to enlarge' : ''
    scrollHint.textContent = edges === 'start' ? `← scroll${tap}` : edges === 'end' ? `scroll →${tap}` : edges ? `← scroll →${tap}` : ''
  }
  watchScrollEdges(preview, showScrollEdges)
  adoptEditorStylesWhenConnected(wrapper, 'mn-mermaid-figure', MERMAID_FIGURE_CSS)
  wrapper.append(figureBar, header, preview, pre)

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
        || target === figureBar || figureBar.contains(target)
    },
    stopEvent(event) {
      const target = event.target
      if (!(target instanceof Node)) return false
      if (target === code || code.contains(target)) return false
      return target === preview || preview.contains(target) || target === header || header.contains(target)
        || target === figureBar || figureBar.contains(target)
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
