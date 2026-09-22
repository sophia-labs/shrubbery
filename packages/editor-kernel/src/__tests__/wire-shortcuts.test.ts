/**
 * Tests for the wire-shortcuts kernel extension.
 *
 * The extension binds Mod-; to a pure document-level event dispatch that
 * carries the source block id. Host wiring (graphId, documentId, picker
 * positioning, re-fire as mn-block-wire-request) lives in the runtime
 * editor-host and is covered separately there.
 *
 * Testing technique mirrors `pure-batch.test.ts` for WikiLink Mod-Shift-k:
 * happy-dom does NOT faithfully dispatch ProseMirror's w3c-keyname keymap
 * from a synthetic OS keydown, so we reach the LIVE extension and invoke
 * its REAL keyboard shortcut callback. The shortcut function under test
 * and the DOM CustomEvent it fires are 100% real.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createKernelEditor } from '../index'
import {
  EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT,
  EDITOR_KEYBOARD_WIRE_REQUEST_EVENT,
  type EditorKeyboardWireMenuRequestDetail,
  type EditorKeyboardWireRequestDetail,
  wireSourceBlockIdAtSelection,
} from '../extensions/wire-shortcuts'

const editors: Editor[] = []

afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

function mount(): Editor {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const editor = createKernelEditor(el)
  editors.push(editor)
  return editor
}

function getShortcuts(
  editor: Editor,
): Record<string, (p: { editor: Editor }) => boolean> {
  const ext = editor.extensionManager.extensions.find((e) => e.name === 'wireShortcuts')
  if (!ext) throw new Error('wireShortcuts extension not present in roster')
  return (
    ext.config as {
      addKeyboardShortcuts: (this: unknown) => Record<string, (p: { editor: Editor }) => boolean>
    }
  ).addKeyboardShortcuts.call({
    editor,
    name: 'wireShortcuts',
    options: (ext as unknown as { options: unknown }).options,
    storage: (ext as unknown as { storage: unknown }).storage,
  })
}

function captureEvents(): {
  events: CustomEvent<EditorKeyboardWireRequestDetail>[]
  details: EditorKeyboardWireRequestDetail[]
  uninstall: () => void
} {
  const events: CustomEvent<EditorKeyboardWireRequestDetail>[] = []
  const details: EditorKeyboardWireRequestDetail[] = []
  const onRequest = (event: Event): void => {
    const e = event as CustomEvent<EditorKeyboardWireRequestDetail>
    events.push(e)
    details.push(e.detail)
  }
  document.addEventListener(EDITOR_KEYBOARD_WIRE_REQUEST_EVENT, onRequest)
  return {
    events,
    details,
    uninstall: () => document.removeEventListener(EDITOR_KEYBOARD_WIRE_REQUEST_EVENT, onRequest),
  }
}

describe('Mod-; keyboard shortcut', () => {
  it('dispatches mn-editor-keyboard-wire-request with the cursor block id', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-alpha">alpha</p>')
    editor.commands.focus('end')
    const shortcuts = getShortcuts(editor)

    const captured = captureEvents()
    try {
      const ret = shortcuts['Mod-;']({ editor })
      expect(ret).toBe(true)
      expect(captured.details).toEqual([
        { blockId: 'block-alpha', shiftKey: false },
      ])
    } finally {
      captured.uninstall()
    }
  })

  it('uses the block the cursor is in, even when the document has many blocks', () => {
    const editor = mount()
    editor.commands.setContent(
      '<p data-block-id="block-alpha">alpha</p>' +
        '<p data-block-id="block-beta">beta</p>' +
        '<p data-block-id="block-gamma">gamma</p>',
    )
    // Place the selection inside the second block (after 'b' of 'beta').
    const doc = editor.state.doc
    const secondBlockStart = doc.firstChild!.nodeSize + 1
    editor.commands.setTextSelection(secondBlockStart + 2)
    const shortcuts = getShortcuts(editor)

    const captured = captureEvents()
    try {
      shortcuts['Mod-;']({ editor })
      expect(captured.details).toEqual([
        { blockId: 'block-beta', shiftKey: false },
      ])
    } finally {
      captured.uninstall()
    }
  })

  it('the dispatched event bubbles and is composed (escapes shadow roots)', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-x">x</p>')
    editor.commands.focus('end')
    const shortcuts = getShortcuts(editor)

    const captured = captureEvents()
    try {
      shortcuts['Mod-;']({ editor })
      expect(captured.events).toHaveLength(1)
      expect(captured.events[0]?.bubbles).toBe(true)
      expect(captured.events[0]?.composed).toBe(true)
    } finally {
      captured.uninstall()
    }
  })

  it('returns false (does NOT swallow the key) when no source block id can be resolved', () => {
    const editor = mount()
    editor.commands.clearContent()
    const shortcuts = getShortcuts(editor)

    // Drive the selection into a position that has no block id at all.
    // In practice this happens transiently (during paste / rapid resets);
    // we simulate by calling the resolver after clearing.
    const blockId = wireSourceBlockIdAtSelection(editor.state)

    const captured = captureEvents()
    try {
      const ret = shortcuts['Mod-;']({ editor })
      if (blockId === null) {
        expect(ret).toBe(false)
        expect(captured.details).toEqual([])
      } else {
        // happy-dom + the auto-id plugin may have given the empty paragraph
        // a block id immediately; in that case the happy path fires once.
        expect(ret).toBe(true)
        expect(captured.details).toHaveLength(1)
      }
    } finally {
      captured.uninstall()
    }
  })

  it('Mod-Shift-; dispatches mn-editor-keyboard-wire-menu-request with the cursor block id', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-source">source</p>')
    editor.commands.focus('end')
    const shortcuts = getShortcuts(editor)

    const events: CustomEvent<EditorKeyboardWireMenuRequestDetail>[] = []
    const details: EditorKeyboardWireMenuRequestDetail[] = []
    const onMenuRequest = (event: Event): void => {
      const e = event as CustomEvent<EditorKeyboardWireMenuRequestDetail>
      events.push(e)
      details.push(e.detail)
    }
    document.addEventListener(EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT, onMenuRequest)
    try {
      const ret = shortcuts['Mod-Shift-;']({ editor })
      expect(ret).toBe(true)
      expect(details).toEqual([{ blockId: 'block-source' }])
      expect(events[0]?.bubbles).toBe(true)
      expect(events[0]?.composed).toBe(true)
    } finally {
      document.removeEventListener(EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT, onMenuRequest)
    }
  })

  it('Mod-Shift-; returns false when no source block id can be resolved', () => {
    const editor = mount()
    editor.commands.clearContent()
    const shortcuts = getShortcuts(editor)
    const blockId = wireSourceBlockIdAtSelection(editor.state)

    const events: CustomEvent<EditorKeyboardWireMenuRequestDetail>[] = []
    const onMenuRequest = (event: Event): void => {
      events.push(event as CustomEvent<EditorKeyboardWireMenuRequestDetail>)
    }
    document.addEventListener(EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT, onMenuRequest)
    try {
      const ret = shortcuts['Mod-Shift-;']({ editor })
      if (blockId === null) {
        expect(ret).toBe(false)
        expect(events).toEqual([])
      } else {
        expect(ret).toBe(true)
        expect(events).toHaveLength(1)
      }
    } finally {
      document.removeEventListener(EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT, onMenuRequest)
    }
  })

  it('Mod-Shift-; from inside a tableCell dispatches the cell block id (not the table)', () => {
    const editor = mount()
    editor.commands.setContent('<p></p>')
    editor.commands.focus('end')
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })

    let cellPos = -1
    let cellId: string | null = null
    editor.state.doc.descendants((node, pos) => {
      if (cellId !== null) return false
      if (node.type.name === 'tableCell') {
        cellPos = pos
        const id = node.attrs['data-block-id']
        if (typeof id === 'string' && id.length > 0) cellId = id
        return false
      }
      return true
    })
    if (!cellId) throw new Error('no tableCell with auto-assigned block id')

    editor.commands.setTextSelection(cellPos + 2)
    const shortcuts = getShortcuts(editor)
    const details: EditorKeyboardWireMenuRequestDetail[] = []
    const onMenuRequest = (event: Event): void => {
      details.push((event as CustomEvent<EditorKeyboardWireMenuRequestDetail>).detail)
    }
    document.addEventListener(EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT, onMenuRequest)
    try {
      shortcuts['Mod-Shift-;']({ editor })
      expect(details).toEqual([{ blockId: cellId }])
    } finally {
      document.removeEventListener(EDITOR_KEYBOARD_WIRE_MENU_REQUEST_EVENT, onMenuRequest)
    }
  })

  it('Mod-; from inside a tableCell dispatches the cell block id (not the table)', () => {
    const editor = mount()
    editor.commands.setContent('<p></p>')
    editor.commands.focus('end')
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })

    // Find the first tableCell (body row, not header) and its document pos.
    let cellPos = -1
    let cellId: string | null = null
    editor.state.doc.descendants((node, pos) => {
      if (cellId !== null) return false
      if (node.type.name === 'tableCell') {
        cellPos = pos
        const id = node.attrs['data-block-id']
        if (typeof id === 'string' && id.length > 0) cellId = id
        return false
      }
      return true
    })
    if (!cellId) throw new Error('no tableCell with auto-assigned block id')

    // Move the cursor into the cell (cellPos + 2 lands inside the cell's
    // inner paragraph in the standard table schema).
    editor.commands.setTextSelection(cellPos + 2)
    const shortcuts = getShortcuts(editor)

    const captured = captureEvents()
    try {
      const ret = shortcuts['Mod-;']({ editor })
      expect(ret).toBe(true)
      expect(captured.details).toEqual([
        { blockId: cellId, shiftKey: false },
      ])
    } finally {
      captured.uninstall()
    }
  })

  it('Mod-; from inside a tableHeader dispatches the header cell block id', () => {
    const editor = mount()
    editor.commands.setContent('<p></p>')
    editor.commands.focus('end')
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })

    let headerPos = -1
    let headerId: string | null = null
    editor.state.doc.descendants((node, pos) => {
      if (headerId !== null) return false
      if (node.type.name === 'tableHeader') {
        headerPos = pos
        const id = node.attrs['data-block-id']
        if (typeof id === 'string' && id.length > 0) headerId = id
        return false
      }
      return true
    })
    if (!headerId) throw new Error('no tableHeader with auto-assigned block id')

    editor.commands.setTextSelection(headerPos + 2)
    const shortcuts = getShortcuts(editor)

    const captured = captureEvents()
    try {
      shortcuts['Mod-;']({ editor })
      expect(captured.details).toEqual([
        { blockId: headerId, shiftKey: false },
      ])
    } finally {
      captured.uninstall()
    }
  })
})

describe('wireSourceBlockIdAtSelection', () => {
  it('returns the block id at the cursor for a single-block doc', () => {
    const editor = mount()
    editor.commands.setContent('<p data-block-id="block-only">only</p>')
    editor.commands.focus('end')
    expect(wireSourceBlockIdAtSelection(editor.state)).toBe('block-only')
  })

  it('returns the block id of the second block when the cursor is in the second block', () => {
    const editor = mount()
    editor.commands.setContent(
      '<p data-block-id="block-one">one</p><p data-block-id="block-two">two</p>',
    )
    const doc = editor.state.doc
    const secondBlockStart = doc.firstChild!.nodeSize + 1
    editor.commands.setTextSelection(secondBlockStart + 1)
    expect(wireSourceBlockIdAtSelection(editor.state)).toBe('block-two')
  })

  it('prefers the containing table cell over the table when the cursor is in a cell', () => {
    const editor = mount()
    editor.commands.setContent('<p></p>')
    editor.commands.focus('end')
    editor.commands.insertTable({ rows: 1, cols: 1, withHeaderRow: false })

    let cellPos = -1
    let cellId: string | null = null
    editor.state.doc.descendants((node, pos) => {
      if (cellId !== null) return false
      if (node.type.name === 'tableCell') {
        cellPos = pos
        const id = node.attrs['data-block-id']
        if (typeof id === 'string' && id.length > 0) cellId = id
        return false
      }
      return true
    })
    if (!cellId) throw new Error('no tableCell with auto-assigned block id')

    editor.commands.setTextSelection(cellPos + 2)
    expect(wireSourceBlockIdAtSelection(editor.state)).toBe(cellId)
  })
})
