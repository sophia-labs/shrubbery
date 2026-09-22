/**
 * S3 BASE organism proof — the standard TipTap/ProseMirror foundation:
 * StarterKit (codeBlock/lists OFF, undoRedo RE-ENABLED, heading [1,2,3],
 * link.openOnClick:false) + standalone bare CodeBlock (THE FATAL FIX) +
 * TextAlign/TextStyle/FontFamily/FontSize/Highlight/Table-set/Placeholder.
 *
 * NO mocks: a REAL @tiptap/pm Schema (Tier-A) and a REAL TipTap Editor with
 * REAL commands (Tier-B), under happy-dom. Errors surface verbatim.
 *
 * The load-bearing proofs:
 *   - getSchema(kernelExtensions()) builds WITH ListItem present (the
 *     codeBlock-class bug is DEAD — ListItem's content expr referent codeBlock
 *     now resolves to the standalone bare CodeBlock).
 *   - undo ROUND-TRIP works (history is ours; undoRedo was RE-ENABLED).
 *   - insertTable yields a real table node (the table set is wired).
 *   - lists are OFF (StarterKit bulletList/orderedList disabled).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { Schema } from '@tiptap/pm/model'
import { baseExtensions } from '../base'
import { kernelExtensions, createKernelEditor } from '../index'

interface JsonTextNode {
  text?: string
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
}

describe('S3 base — Tier-A real ProseMirror Schema', () => {
  it('getSchema(baseExtensions()) does NOT throw and builds a real Schema', () => {
    let schema: Schema | undefined
    expect(() => {
      schema = getSchema(baseExtensions())
    }).not.toThrow()
    expect(schema).toBeInstanceOf(Schema)
  })

  it('getSchema(kernelExtensions()) builds WITH ListItem present — the codeBlock-class bug is DEAD', () => {
    let schema: Schema | undefined
    expect(() => {
      schema = getSchema(kernelExtensions())
    }).not.toThrow()
    // ListItem is in the roster AND its content-expr referent codeBlock resolves.
    expect(schema!.nodes.listItem).toBeDefined()
    expect(schema!.nodes.codeBlock).toBeDefined()
    expect(schema!.nodes.listItem.spec.content).toBe(
      '(paragraph | heading | codeBlock | blockquote)+',
    )
  })

  it('base schema exposes table-set / highlight / codeBlock', () => {
    const schema = getSchema(baseExtensions())
    expect(schema.nodes.table).toBeDefined()
    expect(schema.nodes.tableRow).toBeDefined()
    expect(schema.nodes.tableHeader).toBeDefined()
    expect(schema.nodes.tableCell).toBeDefined()
    expect(schema.nodes.codeBlock).toBeDefined()
    // highlight is a MARK.
    expect(schema.marks.highlight).toBeDefined()
  })

  it('base schema has NO bulletList / orderedList (StarterKit lists disabled)', () => {
    const schema = getSchema(baseExtensions())
    expect(schema.nodes.bulletList).toBeUndefined()
    expect(schema.nodes.orderedList).toBeUndefined()
    // StarterKit's listItem is also off (the flat Outliner ListItem replaces it,
    // but that's an S2 custom — base alone has no listItem either).
    expect(schema.nodes.listItem).toBeUndefined()
  })

  it('heading is constrained to levels [1,2,3]', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: baseExtensions(),
    })
    const headingExt = editor.extensionManager.extensions.find((e) => e.name === 'heading')!
    expect((headingExt.options as { levels: number[] }).levels).toEqual([1, 2, 3])
    editor.destroy()
  })
})

describe('S3 base — Tier-B real editor behavior', () => {
  let editors: Editor[] = []
  afterEach(() => {
    for (const e of editors) e.destroy()
    editors = []
  })

  function mount() {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = new Editor({ element, extensions: baseExtensions() })
    editors.push(editor)
    return editor
  }

  it('typing via focus(end)+insertContent lands real text in the doc', () => {
    const editor = mount()
    editor.commands.setContent('<p>El </p>')
    editor.commands.focus('end')
    editor.commands.insertContent('Aleph')
    expect(editor.getText()).toContain('Aleph')
  })

  it('TextAlign is configured for Garden paragraph and heading nodes', () => {
    const editor = mount()
    editor.commands.setContent('<p>Centered paragraph</p>')
    expect(editor.commands.setTextAlign('center')).toBe(true)
    expect(editor.getJSON().content?.[0]?.attrs?.textAlign).toBe('center')

    editor.commands.setContent('<h2>Centered heading</h2>')
    expect(editor.commands.setTextAlign('right')).toBe(true)
    expect(editor.getJSON().content?.[0]?.attrs?.textAlign).toBe('right')
  })

  it('FontFamily and FontSize commands apply Garden textStyle attrs', () => {
    const editor = mount()
    editor.commands.setContent('<p>alpha beta</p>')
    editor.commands.setTextSelection({ from: 1, to: 6 })

    expect(editor.commands.setFontFamily("'Literata', serif")).toBe(true)
    expect(editor.commands.setFontSize('20px')).toBe(true)
    const textNodes = editor.getJSON().content?.[0]?.content as JsonTextNode[] | undefined
    const text = textNodes?.find((node) => node.text === 'alpha')
    const textStyle = text?.marks?.find((mark) => mark.type === 'textStyle')
    expect(textStyle?.attrs?.fontFamily).toBe("'Literata', serif")
    expect(textStyle?.attrs?.fontSize).toBe('20px')

    expect(editor.commands.unsetFontFamily()).toBe(true)
    expect(editor.commands.unsetFontSize()).toBe(true)
  })

  it('undo ROUND-TRIP proves history is ON (undoRedo RE-ENABLED)', () => {
    const editor = mount()
    // Seed the doc (one history boundary), then make a user edit.
    editor.commands.setContent('<p>El Aleph</p>')
    editor.commands.focus('end')
    editor.commands.insertContent(' eternal')
    const afterEdit = editor.getText()
    expect(afterEdit).toContain('El Aleph eternal')

    // The REAL history command — present ONLY because undoRedo is enabled.
    // (With undoRedo OFF, editor.commands.undo would not exist as a usable
    // command and this would be a no-op returning false.) ProseMirror coalesces
    // consecutive typing into one undo group, so the single undo reverts the
    // whole edit batch — proving history is LIVE and tracking the mutation.
    const undid = editor.commands.undo()
    expect(undid).toBe(true)
    expect(editor.getText()).not.toBe(afterEdit) // state actually moved back

    // Redo restores it exactly — a true round-trip across the history stack.
    const redid = editor.commands.redo()
    expect(redid).toBe(true)
    expect(editor.getText()).toBe(afterEdit)
  })

  it('COLLAB MODE drops the kernel history (undoRedo:false) so the host owns it', () => {
    // The history-ownership handoff, proven at the kernel boundary. With
    // collaborative:true the kernel OMITS StarterKit's undo/redo so a
    // host-injected Collaboration extension is the SOLE history owner. We prove
    // the OMISSION the inverse of the round-trip above: the undo/redo COMMANDS
    // are not even registered (dropping the extension unregisters its commands),
    // so a real edit cannot be reverted by the kernel's own history.
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = new Editor({ element, extensions: baseExtensions({ collaborative: true }) })
    editors.push(editor)

    editor.commands.setContent('<p>El Aleph</p>')
    editor.commands.focus('end')
    editor.commands.insertContent(' eternal')
    const afterEdit = editor.getText()
    expect(afterEdit).toContain('El Aleph eternal')

    // The kernel's history is GONE — the undo/redo commands are unregistered.
    // (In default mode editor.commands.undo IS a function; here it is undefined,
    // the strongest possible proof the undo-redo extension was dropped, not just
    // disabled.) The host's Collaboration extension will (re)provide undo/redo
    // backed by yjs's UndoManager.
    expect(typeof editor.commands.undo).toBe('undefined')
    expect(typeof editor.commands.redo).toBe('undefined')
    expect(editor.getText()).toBe(afterEdit) // nothing can move the state back here

    // And the undo-redo extension is absent from the manager (proves OMISSION,
    // not just a disabled command). StarterKit registers it under name 'undoRedo'.
    const names = editor.extensionManager.extensions.map((e) => e.name)
    expect(names).not.toContain('undoRedo')

    // CRITICAL: collab mode loses ONLY history — the rest of the roster is intact.
    expect(editor.schema.nodes.codeBlock).toBeDefined()
    expect(editor.schema.nodes.table).toBeDefined()
    expect(editor.schema.marks.highlight).toBeDefined()
  })

  it('default (collaborative omitted) KEEPS the kernel history — back-compat', () => {
    // The default path is byte-identical to today: undoRedo ON. (The undo
    // ROUND-TRIP test above already proves the behavior; this asserts the
    // extension is PRESENT, the mirror of the collab-mode absence assertion.)
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = new Editor({ element, extensions: baseExtensions() })
    editors.push(editor)
    const names = editor.extensionManager.extensions.map((e) => e.name)
    expect(names).toContain('undoRedo')
  })

  it('insertTable yields a real table node in the doc', () => {
    const editor = mount()
    editor.commands.setContent('<p></p>')
    editor.commands.focus('end')
    const ok = editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
    expect(ok).toBe(true)
    const json = editor.getJSON()
    const types = (json.content ?? []).map((n) => n.type)
    expect(types).toContain('table')
  })

  it('createKernelEditor mounts a REAL editor whose schema carries the base + ListItem', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = createKernelEditor(element)
    editors.push(editor)
    expect(editor.schema.nodes.table).toBeDefined()
    expect(editor.schema.nodes.codeBlock).toBeDefined()
    expect(editor.schema.nodes.listItem).toBeDefined()
    expect(element.querySelector('.ProseMirror')).not.toBeNull()
  })
})
