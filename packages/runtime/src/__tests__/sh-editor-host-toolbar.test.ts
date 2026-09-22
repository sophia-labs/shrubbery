import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'lit'
import '../../../components/src/mn-editor-toolbar.js'
import '../../../components/src/mn-input-dialog.js'
import type { MnDropdownButton } from '../../../components/src/mn-dropdown-button.js'
import { mountEditorHost } from '../mount.js'
import {
  NULL_EDITOR_HOST_STATE,
  type EditorHostBinding,
  type EditorHostState,
} from '../editor-host-binding.js'
import type { ShEditorHost } from '../editor-host.js'
import type { EditorCommentInsertedDetail, EditorOriginalFileView } from '../editor-host.js'
import {
  WIRE_DOCUMENT_REQUEST_EVENT,
  type DocumentWireRequestDetail,
} from '../wire-events.js'
import { InProcessCrdtBackend } from './in-process-crdt-backend.js'

interface SettableBinding extends EditorHostBinding {
  set(next: EditorHostState): void
}

interface JsonNode {
  type?: string
  attrs?: Record<string, unknown>
  text?: string
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
  content?: JsonNode[]
}

interface TestEditor {
  commands: {
    setContent(html: string): boolean
    insertContent(content: string): boolean
    setTextSelection(range: { from: number; to: number }): boolean
  }
  getText(): string
  getJSON(): JsonNode
}

function makeBinding(initial: EditorHostState = NULL_EDITOR_HOST_STATE): SettableBinding {
  let value = initial
  const subs = new Set<(v: EditorHostState) => void>()
  return {
    get: () => value,
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    set(next) {
      value = next
      for (const cb of subs) cb(value)
    },
  }
}

function connectedContainer(): HTMLElement {
  const c = document.createElement('div')
  document.body.appendChild(c)
  return c
}

const hostEl = (c: HTMLElement) => c.querySelector('#mn-editor-host') as ShEditorHost | null

async function settle(h: ShEditorHost): Promise<void> {
  await h.updateComplete
  await Promise.resolve()
  await Promise.resolve()
  await h.updateComplete
}

let backends: InProcessCrdtBackend[] = []

afterEach(() => {
  for (const be of backends) be.destroyAll()
  backends = []
  document.body.replaceChildren()
})

function backend(): InProcessCrdtBackend {
  const be = new InProcessCrdtBackend()
  backends.push(be)
  return be
}

async function mountLiveHost(options: NonNullable<Parameters<typeof mountEditorHost>[2]> = {}): Promise<ShEditorHost> {
  const provider = backend().open({ kind: 'doc', graphId: 'g-toolbar', docId: 'd-toolbar' })
  const binding = makeBinding({
    centerMode: 'document',
    graphId: 'g-toolbar',
    documentId: 'd-toolbar',
    status: 'ready',
    error: null,
    provider,
  })
  const container = connectedContainer()
  render(mountEditorHost(binding, null, options), container)
  const h = hostEl(container)!
  await settle(h)
  expect(h.liveEditor).not.toBeNull()
  return h
}

function realEditor(h: ShEditorHost): TestEditor {
  return (h as unknown as { _editor: TestEditor })._editor
}

async function toolbarRoot(h: ShEditorHost): Promise<ShadowRoot> {
  const toolbar = h.shadowRoot!.querySelector('mn-editor-toolbar') as
    | (HTMLElement & { updateComplete?: Promise<unknown> })
    | null
  expect(toolbar).not.toBeNull()
  await toolbar!.updateComplete
  return toolbar!.shadowRoot!
}

async function shadowButton(control: Element | null): Promise<HTMLButtonElement> {
  expect(control).not.toBeNull()
  const el = control as HTMLElement & { updateComplete?: Promise<unknown> }
  await el.updateComplete
  const button = el.shadowRoot?.querySelector('button') as HTMLButtonElement | null
  expect(button).not.toBeNull()
  return button!
}

function firstTextMarks(h: ShEditorHost): string[] {
  const text = realEditor(h).getJSON().content?.[0]?.content?.find((node) => node.text)
  return text?.marks?.map((mark) => mark.type ?? '') ?? []
}

function firstTextMarkAttrs(h: ShEditorHost, type: string): Record<string, unknown> | null {
  const text = realEditor(h).getJSON().content?.[0]?.content?.find((node) => node.text)
  return text?.marks?.find((mark) => mark.type === type)?.attrs ?? null
}

function hasNodeType(node: JsonNode | undefined, type: string): boolean {
  if (!node) return false
  if (node.type === type) return true
  return (node.content ?? []).some((child) => hasNodeType(child, type))
}

function documentBlocks(h: ShEditorHost): JsonNode[] {
  return realEditor(h).getJSON().content ?? []
}

function blockTexts(h: ShEditorHost): string[] {
  return documentBlocks(h).map((node) => node.content?.find((child) => child.text)?.text ?? '')
}

function blockById(h: ShEditorHost, blockId: string): JsonNode | undefined {
  return documentBlocks(h).find((node) => node.attrs?.['data-block-id'] === blockId)
}

function originalView(active: boolean): EditorOriginalFileView {
  return {
    available: true,
    active,
    status: active ? 'ready' : 'idle',
    graphId: 'g-toolbar',
    documentId: 'd-toolbar',
    title: 'Original notes',
    filename: 'notes.txt',
    fileType: 'txt',
    mimeType: 'text/plain',
    src: '',
    srcdoc: '',
    text: active ? 'Original source text.' : '',
    error: '',
    selectedChapterId: '',
    downloadable: active,
    externalOpenable: active,
    chapters: [],
    annotations: [],
    annotationSupport: 'unavailable',
  }
}

async function activeInputDialog(h: ShEditorHost): Promise<HTMLElement & { updateComplete?: Promise<unknown> }> {
  await Promise.resolve()
  await Promise.resolve()
  await h.updateComplete
  await h.updateComplete
  const dialog = h.shadowRoot!.querySelector('mn-input-dialog') as
    | (HTMLElement & { updateComplete?: Promise<unknown> })
    | null
  expect(dialog).not.toBeNull()
  await dialog!.updateComplete
  expect((dialog as unknown as { open?: boolean }).open).toBe(true)
  return dialog!
}

async function confirmInputDialog(h: ShEditorHost, value: string): Promise<void> {
  const dialog = await activeInputDialog(h)
  const input = dialog.shadowRoot!.querySelector<HTMLInputElement>('.input')
  expect(input).not.toBeNull()
  input!.value = value
  input!.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  dialog.shadowRoot!.querySelector<HTMLButtonElement>('.confirm-button')!.click()
  await Promise.resolve()
  await h.updateComplete
}

describe('sh-editor-host formatting toolbar', () => {
  it('does not present a temporary interaction lock as imported-document authority', async () => {
    const h = await mountLiveHost()
    const proseMirror = h.shadowRoot!.querySelector('.ProseMirror')

    h.liveEditor!.setEditable(false)
    await settle(h)

    expect(proseMirror?.getAttribute('contenteditable')).toBe('false')
    expect(h.hasAttribute('data-document-read-only')).toBe(true)
    expect((await toolbarRoot(h)).querySelector('[data-read-only-badge]')).toBeNull()
  })

  it('enforces read-only content without remounting and restores editing after authority changes', async () => {
    const h = await mountLiveHost({ documentAccess: { readOnly: true } })
    const editorHandle = h.liveEditor
    const editorMount = h.shadowRoot!.querySelector('.editor-mount')
    const proseMirror = h.shadowRoot!.querySelector('.ProseMirror')
    expect(editorHandle).not.toBeNull()
    expect(proseMirror?.getAttribute('contenteditable')).toBe('false')
    expect(h.hasAttribute('data-document-read-only')).toBe(true)
    expect((await toolbarRoot(h)).querySelector('[data-read-only-badge]')).not.toBeNull()

    h.documentAccess = { readOnly: false }
    await settle(h)
    expect(h.liveEditor).toBe(editorHandle)
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(editorMount)
    expect(h.shadowRoot!.querySelector('.ProseMirror')).toBe(proseMirror)
    expect(proseMirror?.getAttribute('contenteditable')).toBe('true')
    expect(h.hasAttribute('data-document-read-only')).toBe(false)
  })

  it('swaps to the controlled original reader without remounting the keyed CRDT editor', async () => {
    const h = await mountLiveHost()
    const editorHandle = h.liveEditor
    const editorMount = h.shadowRoot!.querySelector('.editor-mount')
    const proseMirror = h.shadowRoot!.querySelector('.ProseMirror')
    expect(editorHandle).not.toBeNull()
    expect(proseMirror).not.toBeNull()

    h.originalFileView = originalView(true)
    await settle(h)
    expect(h.liveEditor).toBe(editorHandle)
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(editorMount)
    expect(h.shadowRoot!.querySelector('.ProseMirror')).toBe(proseMirror)
    expect(editorMount?.hasAttribute('hidden')).toBe(true)
    expect(editorMount?.hasAttribute('inert')).toBe(true)
    expect(h.shadowRoot!.querySelector('mn-original-viewer')).not.toBeNull()
    expect((await toolbarRoot(h)).querySelector('[data-original-annotation-unavailable]')).not.toBeNull()

    h.originalFileView = originalView(false)
    await settle(h)
    expect(h.liveEditor).toBe(editorHandle)
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(editorMount)
    expect(h.shadowRoot!.querySelector('.ProseMirror')).toBe(proseMirror)
    expect(editorMount?.hasAttribute('hidden')).toBe(false)
    expect(h.shadowRoot!.querySelector('mn-original-viewer')).toBeNull()
  })

  it('preserves the editor mount and applies inline marks through real commands', async () => {
    const h = await mountLiveHost()
    const editor = realEditor(h)
    expect(editor.commands.setContent('<p>alpha beta</p>')).toBe(true)
    expect(editor.commands.setTextSelection({ from: 1, to: 6 })).toBe(true)
    const mount = h.shadowRoot!.querySelector('.editor-mount')
    const root = await toolbarRoot(h)
    const toolbar = root.querySelector('mn-toolbar')
    const bold = root.querySelector('[data-format-command="bold"]')
    const boldButton = await shadowButton(bold)

    expect(toolbar).not.toBeNull()
    await (toolbar as HTMLElement & { updateComplete?: Promise<unknown> }).updateComplete
    expect(toolbar?.getAttribute('role')).toBe('toolbar')
    expect(toolbar?.getAttribute('aria-label')).toBe('Editor formatting')
    expect(root.querySelectorAll('mn-toolbar-group')).toHaveLength(5)
    expect(root.querySelectorAll('mn-toolbar mn-icon-button')).toHaveLength(21)
    expect(root.querySelectorAll('mn-button')).toHaveLength(1)

    const down = new MouseEvent('mousedown', { bubbles: true, composed: true, cancelable: true })
    expect(boldButton.dispatchEvent(down)).toBe(false)
    boldButton.click()
    await h.updateComplete

    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
    expect(firstTextMarks(h)).toContain('bold')
    const updatedBoldButton = await shadowButton(
      (await toolbarRoot(h)).querySelector('[data-format-command="bold"]'),
    )
    expect(updatedBoldButton.getAttribute('aria-pressed')).toBe('true')
  })

  it('clears formatting back to a plain paragraph through the explicit Garden control', async () => {
    const h = await mountLiveHost()
    const editor = realEditor(h)
    expect(editor.commands.setContent('<h2><strong>Line</strong></h2>')).toBe(true)
    expect(editor.commands.setTextSelection({ from: 1, to: 5 })).toBe(true)
    const mount = h.shadowRoot!.querySelector('.editor-mount')

    const clearButton = await shadowButton(
      (await toolbarRoot(h)).querySelector('[data-clear-formatting-command]'),
    )
    clearButton.click()
    await h.updateComplete

    const first = editor.getJSON().content?.[0]
    expect(first?.type).toBe('paragraph')
    expect(firstTextMarks(h)).not.toContain('bold')
    expect(
      ((await toolbarRoot(h)).querySelector('[data-block-select]') as MnDropdownButton).selectedId,
    ).toBe('paragraph')
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
  })

  it('marks selected text with a real comment id from toolbar and Mod-Shift-.', async () => {
    const h = await mountLiveHost()
    const editor = realEditor(h)
    expect(editor.commands.setContent('<p>alpha beta gamma</p>')).toBe(true)
    expect(editor.commands.setTextSelection({ from: 1, to: 6 })).toBe(true)
    const mount = h.shadowRoot!.querySelector('.editor-mount')
    const inserted: EditorCommentInsertedDetail[] = []
    h.addEventListener('mn-editor-comment-inserted', (event) => {
      inserted.push((event as CustomEvent<EditorCommentInsertedDetail>).detail)
    })
    h.commentInserter = (request) => {
      expect(request.selectedText).toBe('alpha')
      return { commentId: 'comment-toolbar' }
    }

    const commentButton = await shadowButton((await toolbarRoot(h)).querySelector('[data-comment-command]'))
    commentButton.click()
    await Promise.resolve()
    await h.updateComplete
    expect(JSON.stringify(editor.getJSON())).toContain('"type":"commentMark"')
    expect(JSON.stringify(editor.getJSON())).toContain('comment-toolbar')
    expect(inserted[0]).toMatchObject({
      commentId: 'comment-toolbar',
      selectedText: 'alpha',
    })

    expect(editor.commands.setTextSelection({ from: 7, to: 11 })).toBe(true)
    h.commentInserter = () => 'comment-shortcut'
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '.',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    await Promise.resolve()
    await h.updateComplete
    expect(JSON.stringify(editor.getJSON())).toContain('comment-shortcut')
    const toolbarMark = h.shadowRoot!.querySelector(
      '.comment-mark[data-comment-id="comment-toolbar"]',
    ) as HTMLElement | null
    expect(toolbarMark).not.toBeNull()
    expect(h.liveEditor?.setActiveComment('comment-toolbar', { scroll: false })).toBe(true)
    expect(toolbarMark?.getAttribute('data-active')).toBe('true')
    expect(h.liveEditor?.setActiveComment(null)).toBe(true)
    expect(toolbarMark?.hasAttribute('data-active')).toBe(false)
    expect(h.liveEditor?.removeComment('comment-toolbar')).toBe(true)
    expect(JSON.stringify(editor.getJSON())).not.toContain('comment-toolbar')
    expect(JSON.stringify(editor.getJSON())).toContain('comment-shortcut')
    expect(h.liveEditor?.removeComment('missing-comment')).toBe(false)
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
  })

  it('opens the shipped wikilink picker event from the toolbar without remounting', async () => {
    const h = await mountLiveHost()
    const editor = realEditor(h)
    expect(editor.commands.setContent('<p>alpha beta</p>')).toBe(true)
    expect(editor.commands.setTextSelection({ from: 1, to: 6 })).toBe(true)
    const mount = h.shadowRoot!.querySelector('.editor-mount')
    const opened: Event[] = []
    const onOpen = (event: Event): void => {
      opened.push(event)
    }

    document.addEventListener('open-wikilink-picker', onOpen)
    try {
      const linkButton = await shadowButton((await toolbarRoot(h)).querySelector('[data-wikilink-command]'))
      linkButton.click()
      await h.updateComplete
    } finally {
      document.removeEventListener('open-wikilink-picker', onOpen)
    }

    expect(opened).toHaveLength(1)
    expect(opened[0]).toBeInstanceOf(CustomEvent)
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
  })

  it('opens the citation picker event from the toolbar without remounting', async () => {
    const h = await mountLiveHost()
    const editor = realEditor(h)
    expect(editor.commands.setContent('<p>alpha beta</p>')).toBe(true)
    const mount = h.shadowRoot!.querySelector('.editor-mount')
    const opened: Event[] = []
    const onOpen = (event: Event): void => {
      opened.push(event)
    }

    document.addEventListener('open-citation-picker', onOpen)
    try {
      const citationButton = await shadowButton((await toolbarRoot(h)).querySelector('[data-citation-command]'))
      citationButton.click()
      await h.updateComplete
    } finally {
      document.removeEventListener('open-citation-picker', onOpen)
    }

    expect(opened).toHaveLength(1)
    expect(opened[0]).toBeInstanceOf(CustomEvent)
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
  })

  it('emits the shell-owned shortcuts dialog request from the toolbar without remounting', async () => {
    const h = await mountLiveHost()
    const mount = h.shadowRoot!.querySelector('.editor-mount')
    const opened: Event[] = []
    h.addEventListener('mn-open-shortcuts', event => {
      opened.push(event)
    })

    const shortcutsButton = await shadowButton((await toolbarRoot(h)).querySelector('[data-shortcuts-open]'))
    shortcutsButton.click()
    await h.updateComplete

    expect(opened).toHaveLength(1)
    expect(opened[0]).toBeInstanceOf(CustomEvent)
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
  })

  it('opens the shipped document wire picker event from the toolbar with modifiers', async () => {
    const h = await mountLiveHost()
    const editor = realEditor(h)
    expect(editor.commands.setContent('<p>alpha beta</p>')).toBe(true)
    expect(editor.commands.setTextSelection({ from: 1, to: 6 })).toBe(true)
    const mount = h.shadowRoot!.querySelector('.editor-mount')
    const details: DocumentWireRequestDetail[] = []
    const onWireRequest = (event: Event): void => {
      details.push((event as CustomEvent<DocumentWireRequestDetail>).detail)
    }

    document.addEventListener(WIRE_DOCUMENT_REQUEST_EVENT, onWireRequest)
    try {
      const wireButton = await shadowButton(
        (await toolbarRoot(h)).querySelector('[data-document-wire-command]'),
      )
      wireButton.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          composed: true,
          shiftKey: true,
          altKey: true,
          metaKey: true,
        }),
      )
      await h.updateComplete
    } finally {
      document.removeEventListener(WIRE_DOCUMENT_REQUEST_EVENT, onWireRequest)
    }

    expect(details).toEqual([
      {
        shiftKey: true,
        altKey: true,
        metaKey: true,
        ctrlKey: false,
      },
    ])
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
  })

  it('drives collab-backed undo and redo from the toolbar without remounting', async () => {
    const h = await mountLiveHost()
    const editor = realEditor(h)
    const mount = h.shadowRoot!.querySelector('.editor-mount')

    expect(editor.commands.insertContent('Funes el memorioso')).toBe(true)
    expect(editor.getText()).toContain('Funes el memorioso')

    const undoButton = await shadowButton((await toolbarRoot(h)).querySelector('[data-history-command="undo"]'))
    undoButton.click()
    await h.updateComplete
    expect(editor.getText()).not.toContain('Funes el memorioso')

    const redoButton = await shadowButton((await toolbarRoot(h)).querySelector('[data-history-command="redo"]'))
    redoButton.click()
    await h.updateComplete
    expect(editor.getText()).toContain('Funes el memorioso')
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
  })

  it('exposes a public restoreHtml handle for shell-owned document history restore', async () => {
    const h = await mountLiveHost()
    const editor = realEditor(h)
    const mount = h.shadowRoot!.querySelector('.editor-mount')

    expect(editor.commands.setContent('<p>before restore</p>')).toBe(true)
    expect(editor.getText()).toContain('before restore')
    expect(h.liveEditor?.restoreHtml('<h2>Restored heading</h2><p>Restored body</p>')).toBe(true)
    await h.updateComplete

    expect(editor.getText()).toContain('Restored heading')
    expect(editor.getText()).toContain('Restored body')
    expect(editor.getText()).not.toContain('before restore')
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
  })

  it('emits a document-level version-history intent from the toolbar', async () => {
    const h = await mountLiveHost()
    const details: Array<{ graphId?: string; documentId?: string }> = []
    const onHistory = (event: Event) => {
      details.push((event as CustomEvent<{ graphId?: string; documentId?: string }>).detail)
    }
    document.addEventListener('mn-editor-history-open', onHistory)
    try {
      const historyButton = await shadowButton((await toolbarRoot(h)).querySelector('[data-version-history-open]'))
      historyButton.click()
      await h.updateComplete
    } finally {
      document.removeEventListener('mn-editor-history-open', onHistory)
    }

    expect(details).toEqual([{ graphId: 'g-toolbar', documentId: 'd-toolbar' }])
  })

  it('inserts real footnote nodes through the toolbar and Mod-Shift-F host shortcut', async () => {
    const h = await mountLiveHost()
    const editor = realEditor(h)
    const mount = h.shadowRoot!.querySelector('.editor-mount')
    let nextFootnote = 'Toolbar note'
    h.footnoteInserter = () => nextFootnote

    const footnoteButton = await shadowButton((await toolbarRoot(h)).querySelector('[data-footnote-command]'))
    footnoteButton.click()
    await Promise.resolve()
    await h.updateComplete
    expect(JSON.stringify(editor.getJSON())).toContain('"type":"footnote"')
    expect(JSON.stringify(editor.getJSON())).toContain('Toolbar note')

    nextFootnote = 'Shortcut note'
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    await Promise.resolve()
    await h.updateComplete
    expect(JSON.stringify(editor.getJSON())).toContain('Shortcut note')
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
  })

  it('inserts a real image node through the runtime-owned toolbar acquisition seam', async () => {
    const h = await mountLiveHost()
    const editor = realEditor(h)
    const mount = h.shadowRoot!.querySelector('.editor-mount')
    h.imageInserter = () => ({
      src: 'https://example.test/image.png',
      alt: 'Shrubbery diagram',
      title: 'A real inserted image',
      size: 'medium',
    })

    const imageButton = await shadowButton((await toolbarRoot(h)).querySelector('[data-image-command]'))
    imageButton.click()
    await Promise.resolve()
    await h.updateComplete

    const json = editor.getJSON()
    expect(JSON.stringify(json)).toContain('"type":"image"')
    expect(JSON.stringify(json)).toContain('https://example.test/image.png')
    expect(JSON.stringify(json)).toContain('Shrubbery diagram')
    expect(JSON.stringify(json)).toContain('"size":"medium"')
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
  })

  it('threads the image acquisition seam through the editor host mount', async () => {
    const h = await mountLiveHost({
      imageInserter: () => ({
        src: 'https://example.test/mounted-image.png',
        alt: 'Mounted image',
      }),
    })
    const editor = realEditor(h)
    const mount = h.shadowRoot!.querySelector('.editor-mount')

    const imageButton = await shadowButton((await toolbarRoot(h)).querySelector('[data-image-command]'))
    imageButton.click()
    await Promise.resolve()
    await h.updateComplete

    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"type":"image"')
    expect(json).toContain('https://example.test/mounted-image.png')
    expect(json).toContain('Mounted image')
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
  })

  it('shows the Garden image resize control and cycles the real image node size', async () => {
    const h = await mountLiveHost({
      imageInserter: () => ({
        src: 'https://example.test/resize.png',
        alt: 'Resizable image',
        size: 'large',
      }),
    })
    const editor = realEditor(h)
    const mount = h.shadowRoot!.querySelector('.editor-mount')

    const imageButton = await shadowButton((await toolbarRoot(h)).querySelector('[data-image-command]'))
    imageButton.click()
    await Promise.resolve()
    await h.updateComplete

    const imageBlock = h.shadowRoot!.querySelector('.editor-mount .ProseMirror .image-block') as HTMLElement | null
    expect(imageBlock).not.toBeNull()
    expect(imageBlock!.getAttribute('data-size')).toBe('large')
    expect(imageBlock!.getAttribute('data-block-id')).toMatch(/^block-/)

    imageBlock!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true }))

    const resize = h.shadowRoot!.querySelector('.image-resize-button') as HTMLButtonElement | null
    expect(resize).not.toBeNull()
    expect(resize!.textContent).toContain('100%')
    resize!.click()
    await Promise.resolve()
    await h.updateComplete

    const json = JSON.stringify(editor.getJSON())
    expect(json).toContain('"size":"small"')
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
  })

  it('feeds wireBundle margin gloss data into the pure kernel without remounting', async () => {
    const h = await mountLiveHost()
    const editor = realEditor(h)
    const mount = h.shadowRoot!.querySelector('.editor-mount')

    expect(editor.commands.setContent('<p data-block-id="block-wired">Wired block</p>')).toBe(true)
    h.wireBundle = {
      outgoingWires: [
        {
          id: 'wire-gloss',
          predicate: 'http://mnemosyne.ai/vocab#supports',
          predicateLabel: 'supports',
          otherDocumentId: 'doc-target',
          otherGraphId: 'g-toolbar',
          otherBlockId: 'block-target',
          localBlockId: 'block-wired',
          otherTitle: 'Target Doc',
          otherSnippet: 'Target snippet',
          bidirectional: false,
        },
      ],
      incomingWires: [],
      wiredBlockIds: ['block-wired'],
    }
    await settle(h)

    const widget = h.shadowRoot!.querySelector(
      '.editor-mount .ProseMirror .mg-widget',
    ) as HTMLElement | null
    expect(widget).not.toBeNull()
    expect(widget?.querySelector('.mg-predicate')?.textContent).toContain('supports')
    expect(widget?.querySelector('.mg-target')?.textContent).toBe('Target Doc')
    expect(widget?.querySelector('.mg-snippet')?.textContent).toBe('Target snippet')
    const wiredBlock = h.shadowRoot!.querySelector('[data-block-id="block-wired"]')
    expect(wiredBlock?.getAttribute('data-block-wired')).toBe('')
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
  })

  it('uses themed input dialogs instead of window.prompt for default footnote and image insertion', async () => {
    const h = await mountLiveHost()
    const editor = realEditor(h)
    const mount = h.shadowRoot!.querySelector('.editor-mount')
    const view = h.ownerDocument.defaultView!
    const originalPrompt = view.prompt
    let promptCalls = 0
    view.prompt = (() => {
      promptCalls += 1
      return null
    }) as typeof view.prompt

    try {
      const footnoteButton = await shadowButton((await toolbarRoot(h)).querySelector('[data-footnote-command]'))
      footnoteButton.click()
      let dialog = await activeInputDialog(h)
      expect(dialog.shadowRoot!.querySelector('.title')?.textContent).toBe('Insert Footnote')
      await confirmInputDialog(h, 'Dialog footnote')
      expect(JSON.stringify(editor.getJSON())).toContain('"type":"footnote"')
      expect(JSON.stringify(editor.getJSON())).toContain('Dialog footnote')

      const imageButton = await shadowButton((await toolbarRoot(h)).querySelector('[data-image-command]'))
      imageButton.click()
      dialog = await activeInputDialog(h)
      expect(dialog.shadowRoot!.querySelector('.title')?.textContent).toBe('Insert Image')
      await confirmInputDialog(h, 'https://example.test/dialog.png')
      dialog = await activeInputDialog(h)
      expect(dialog.shadowRoot!.querySelector('.title')?.textContent).toBe('Image Alt Text')
      await confirmInputDialog(h, 'Dialog image')

      const json = JSON.stringify(editor.getJSON())
      expect(json).toContain('"type":"image"')
      expect(json).toContain('https://example.test/dialog.png')
      expect(json).toContain('Dialog image')
      expect(promptCalls).toBe(0)
      expect((h.shadowRoot!.querySelector('mn-input-dialog') as unknown as { open?: boolean }).open).toBe(false)
      expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
    } finally {
      view.prompt = originalPrompt
    }
  })

  it('drives type, block, alignment, and table commands without remounting', async () => {
    const h = await mountLiveHost()
    const editor = realEditor(h)
    expect(editor.commands.setContent('<p>Line</p>')).toBe(true)
    expect(editor.commands.setTextSelection({ from: 1, to: 5 })).toBe(true)
    const mount = h.shadowRoot!.querySelector('.editor-mount')
    const root = await toolbarRoot(h)

    const noModifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }
    const fontFamily = root.querySelector('[data-font-family-select]') as MnDropdownButton
    fontFamily.dispatchEvent(new CustomEvent('mn-select', {
      bubbles: true,
      composed: true,
      detail: {
        id: "'Literata Variable', 'Literata', serif",
        item: { id: "'Literata Variable', 'Literata', serif", label: 'Literata' },
        modifiers: noModifiers,
      },
    }))
    await h.updateComplete
    const fontSize = (await toolbarRoot(h)).querySelector('[data-font-size-select]') as MnDropdownButton
    fontSize.dispatchEvent(new CustomEvent('mn-select', {
      bubbles: true,
      composed: true,
      detail: { id: '20px', item: { id: '20px', label: 'M' }, modifiers: noModifiers },
    }))
    await h.updateComplete
    expect(firstTextMarkAttrs(h, 'textStyle')).toMatchObject({
      fontFamily: "'Literata Variable', 'Literata', serif",
      fontSize: '20px',
    })
    expect(
      ((await toolbarRoot(h)).querySelector('[data-font-family-select]') as MnDropdownButton).selectedId,
    ).toBe("'Literata Variable', 'Literata', serif")
    expect(
      ((await toolbarRoot(h)).querySelector('[data-font-size-select]') as MnDropdownButton).selectedId,
    ).toBe('20px')

    const centerButton = await shadowButton(root.querySelector('[data-align-command="center"]'))
    centerButton.click()
    await h.updateComplete
    expect(realEditor(h).getJSON().content?.[0]?.attrs?.textAlign).toBe('center')
    const updatedCenterButton = await shadowButton(
      (await toolbarRoot(h)).querySelector('[data-align-command="center"]'),
    )
    expect(updatedCenterButton.getAttribute('aria-pressed')).toBe('true')

    const blockSelect = (await toolbarRoot(h)).querySelector('[data-block-select]') as MnDropdownButton
    blockSelect.dispatchEvent(new CustomEvent('mn-select', {
      bubbles: true,
      composed: true,
      detail: { id: 'heading2', item: { id: 'heading2', label: 'Heading 2' }, modifiers: noModifiers },
    }))
    await h.updateComplete
    const first = realEditor(h).getJSON().content?.[0]
    expect(first?.type).toBe('heading')
    expect(first?.attrs?.level).toBe(2)
    expect(
      ((await toolbarRoot(h)).querySelector('[data-block-select]') as MnDropdownButton).selectedId,
    ).toBe('heading2')

    const tableButton = await shadowButton((await toolbarRoot(h)).querySelector('[data-table-command]'))
    tableButton.click()
    await h.updateComplete
    expect(hasNodeType(realEditor(h).getJSON(), 'table')).toBe(true)
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
  })

  it('runs Garden slash block commands through the public live editor handle', async () => {
    const h = await mountLiveHost()
    const editor = realEditor(h)
    expect(editor.commands.setContent('<p>/h2</p>')).toBe(true)
    expect(editor.commands.setTextSelection({ from: 4, to: 4 })).toBe(true)

    await expect(h.liveEditor!.runSlashCommandAt({ from: 1, to: 4 }, 'heading2')).resolves.toBe(true)

    const first = realEditor(h).getJSON().content?.[0]
    expect(first?.type).toBe('heading')
    expect(first?.attrs?.level).toBe(2)
    expect(first?.content).toBeUndefined()
  })

  it('inserts a live queryBlock through the slash command handle', async () => {
    const h = await mountLiveHost()
    const editor = realEditor(h)
    expect(editor.commands.setContent('<p>/query</p>')).toBe(true)
    expect(editor.commands.setTextSelection({ from: 7, to: 7 })).toBe(true)

    await expect(
      h.liveEditor!.runSlashCommandAt({ from: 1, to: 7 }, 'queryBlock'),
    ).resolves.toBe(true)

    expect(realEditor(h).getJSON().content?.[0]?.type).toBe('queryBlock')
    expect(realEditor(h).getJSON().content?.[0]?.attrs?.['data-block-id']).toMatch(
      /^block-[0-9a-f]{8}$/,
    )
  })

  it('surfaces Garden PR outliner commands through the public runOutlinerCommand handle without remounting', async () => {
    // These commands no longer have toolbar buttons (moved to the left-sidebar
    // outline panel, packages/components/src/mn-document-outline.ts) — driven
    // here through the same public LiveEditorHandle.runOutlinerCommand() that
    // panel uses, rather than clickToolbarButton.
    const h = await mountLiveHost()
    const editor = realEditor(h)
    const mount = h.shadowRoot!.querySelector('.editor-mount')

    expect(
      editor.commands.setContent(
        '<p data-block-id="block-a">A</p><p data-block-id="block-b" data-indent="1">B</p><p data-block-id="block-c">C</p>',
      ),
    ).toBe(true)
    expect(editor.commands.setTextSelection({ from: 1, to: 1 })).toBe(true)

    h.liveEditor?.runOutlinerCommand('toggleCollapse')
    await h.updateComplete
    expect(blockById(h, 'block-a')?.attrs?.collapsed).toBe(true)

    h.liveEditor?.runOutlinerCommand('expandAll')
    await h.updateComplete
    expect(blockById(h, 'block-a')?.attrs?.collapsed).toBe(false)

    h.liveEditor?.runOutlinerCommand('collapseAll')
    await h.updateComplete
    expect(blockById(h, 'block-a')?.attrs?.collapsed).toBe(true)

    h.liveEditor?.runOutlinerCommand('expandAll')
    await h.updateComplete
    expect(editor.commands.setTextSelection({ from: 1, to: 1 })).toBe(true)
    h.liveEditor?.runOutlinerCommand('moveDown')
    await h.updateComplete
    expect(blockTexts(h)).toEqual(['C', 'A', 'B'])

    h.liveEditor?.runOutlinerCommand('moveUp')
    await h.updateComplete
    expect(blockTexts(h)).toEqual(['A', 'B', 'C'])

    expect(
      editor.commands.setContent(
        '<p data-block-id="block-a">A</p><p data-block-id="block-b" data-indent="1">B</p><p data-block-id="block-c">C</p>',
      ),
    ).toBe(true)
    expect(editor.commands.setTextSelection({ from: 4, to: 4 })).toBe(true)
    h.liveEditor?.runOutlinerCommand('selectParent')
    await h.updateComplete
    expect(h.shadowRoot!.querySelectorAll('.ProseMirror .block-selected')).toHaveLength(2)
    h.liveEditor?.runOutlinerCommand('selectAll')
    await h.updateComplete
    expect(h.shadowRoot!.querySelectorAll('.ProseMirror .block-selected')).toHaveLength(3)

    expect(editor.commands.setTextSelection({ from: 1, to: 1 })).toBe(true)
    h.liveEditor?.runOutlinerCommand('zoomIn')
    await h.updateComplete
    expect(h.liveEditor?.getZoomSnapshot().blockId).toBe('block-a')
    h.liveEditor?.runOutlinerCommand('zoomOut')
    await h.updateComplete
    expect(h.liveEditor?.getZoomSnapshot().blockId).toBeNull()

    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
  })
})
