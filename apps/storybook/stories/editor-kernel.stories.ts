/**
 * Editor Kernel — the LIVE pure-TipTap organism.
 *
 * This story mounts a REAL @shrubbery/editor-kernel Editor (createKernelEditor →
 * `new Editor(...)` over the full v1 roster) into an imperative HTMLElement host.
 * We use the imperative-host idiom (see workspace.stories.ts) because a Lit
 * html`` template cannot HOST a TipTap Editor — TipTap mounts ProseMirror into a
 * real, persistent DOM element it owns; returning a live `<div>` from render()
 * hands Storybook that exact element, with the editor already attached.
 *
 * NO MOCKS: the editor is the real kernel editor; `play()` drives the REAL
 * editor commands (focus + insertContent) to type the word "Borges" into the
 * live document, then asserts the live `editor.getText()` reflects it. Errors
 * surface verbatim. The WikiLink picker stays pure — the host wires a real DOM
 * listener for CustomEvent('open-wikilink-picker'); never a backend import.
 */
import type { Meta, StoryObj } from '@storybook/web-components'

import {
  createKernelEditor,
  type Editor,
  type KernelOptions,
  type WikiLinkAttrs,
} from '@shrubbery/editor-kernel'

const meta: Meta = {
  title: 'Editor/Kernel',
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj

/**
 * Mount a REAL kernel Editor into an imperative host element and return that
 * element (the live editor is attached to it). The host also wires a real
 * listener for the pure WikiLink picker event — proving the picker seam stays a
 * DOM CustomEvent, not a backend import.
 *
 * The created Editor is stashed on the host (`__editor`) so `play()` can reach
 * the SAME live instance render() created.
 */
function mountKernelEditor(opts: KernelOptions = {}): HTMLElement & { __editor?: Editor } {
  const host = document.createElement('div') as HTMLElement & { __editor?: Editor }
  host.style.height = '100vh'
  host.style.display = 'flex'
  host.style.flexDirection = 'column'
  host.style.padding = '24px'
  host.style.boxSizing = 'border-box'
  host.style.background = 'var(--mn-color-surface-base, #fff)'
  host.style.color = 'var(--mn-color-text-primary, #111)'
  host.style.fontFamily = 'var(--mn-font-chrome, system-ui, sans-serif)'

  // The element TipTap actually mounts ProseMirror into.
  const mount = document.createElement('div')
  mount.setAttribute('data-editor-kernel-mount', '')
  mount.style.flex = '1'
  mount.style.overflow = 'auto'
  mount.style.outline = 'none'
  host.appendChild(mount)

  // Pure WikiLink picker seam: a REAL DOM listener (host-wired callback land),
  // never a backend import. Mod-Shift-k inside the editor dispatches this.
  document.addEventListener('open-wikilink-picker', () => {
    /* host would open its own picker UI here */
  })

  host.__editor = createKernelEditor(mount, opts)
  return host
}

/**
 * The live kernel editor. `play()` types "Borges" into the REAL editor and
 * asserts the live document reflects it — the organism is probeable.
 */
export const LiveEditor: Story = {
  render: () => mountKernelEditor(),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    // canvasElement is the host we returned from render() (or its container) — the
    // live editor instance is stashed on whichever node carries __editor.
    const host = (
      (canvasElement as { __editor?: Editor }).__editor
        ? canvasElement
        : canvasElement.querySelector<HTMLElement>('[data-editor-kernel-mount]')?.parentElement ??
          canvasElement
    ) as HTMLElement & { __editor?: Editor }

    const editor = host.__editor
    if (!editor) throw new Error('LiveEditor.play: no live kernel Editor found on the host')

    // Drive the REAL editor: focus, then type "Borges" into the live document.
    editor.chain().focus().insertContent('Borges').run()

    const text = editor.getText()
    if (!text.includes('Borges')) {
      throw new Error(`LiveEditor.play: expected live editor text to contain "Borges", got: ${text}`)
    }
  },
}

/**
 * Same live editor, but with the host-wired WikiLink callbacks (pure seams).
 * Demonstrates KernelOptions are real callbacks the host supplies — never a
 * backend import.
 */
export const WithWikiLinkSeams: Story = {
  render: () => {
    const clicked: WikiLinkAttrs[] = []
    return mountKernelEditor({
      onWikiLinkClick: (attrs) => clicked.push(attrs),
      onWikiLinkDelete: () => {},
    })
  },
}
