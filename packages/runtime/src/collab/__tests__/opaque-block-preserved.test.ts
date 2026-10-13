/**
 * gardend's block contract (garden feat/block-contract-normaliser, c60f057)
 * stores content it does not know as an `opaqueBlock` atom:
 *   { originalType, originalJson (verbatim), text, contractVersion, data-block-id }
 * The web editor must render it (type + text, source on request) and never
 * rewrite it — not on open, not when the text around it is edited, not when it
 * is cut and pasted elsewhere in the document.
 *
 * A REAL collaborative editor (kernel roster + Collaboration + the patched
 * @tiptap/y-tiptap) bound to a REAL Y.Doc; cut/paste goes through
 * ProseMirror's own clipboard serializer and paste parser.
 */
import type { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { COLLAB_FIELD, createLiveCollabEditor } from '../live-editor.js'

const editors: Editor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
  document.body.innerHTML = ''
})

const settle = () => new Promise(resolve => setTimeout(resolve, 30))
const fragment = (doc: Y.Doc): Y.XmlFragment => doc.getXmlFragment(COLLAB_FIELD)

function mount(doc: Y.Doc): Editor {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = createLiveCollabEditor({ element, doc })
  editors.push(editor)
  return editor
}

function para(id: string, text: string): Y.XmlElement {
  const p = new Y.XmlElement('paragraph')
  p.setAttribute('data-block-id', id)
  const t = new Y.XmlText()
  p.insert(0, [t])
  t.insert(0, text)
  return p
}

// The exact JSON a writer sent for an unknown `callout` — kept byte for byte
// (odd spacing and key order included) by gardend's normaliser.
const ORIGINAL_JSON = '{"type":"callout","attrs":{"tone":"warn", "icon":"⚠"},"content":[{"type":"paragraph","content":[{"type":"text","text":"CALLOUT-TEXT survives"}]}]}'

function opaque(): Y.XmlElement {
  const el = new Y.XmlElement('opaqueBlock')
  el.setAttribute('originalType', 'callout')
  el.setAttribute('originalJson', ORIGINAL_JSON)
  el.setAttribute('text', 'CALLOUT-TEXT survives')
  el.setAttribute('contractVersion', 1 as unknown as string)
  el.setAttribute('data-block-id', 'opaque-1')
  return el
}

function opaqueAttrs(doc: Y.Doc): Record<string, unknown>[] {
  return fragment(doc).toArray()
    .filter((c): c is Y.XmlElement => c instanceof Y.XmlElement && c.nodeName === 'opaqueBlock')
    .map(c => c.getAttributes())
}

function docWithOpaque(): Y.Doc {
  const doc = new Y.Doc()
  fragment(doc).insert(0, [para('p1', 'First paragraph.'), opaque(), para('p2', 'Second paragraph.'), para('p3', 'Third paragraph.')])
  return doc
}

describe('opaqueBlock (gardend block contract v1)', () => {
  it('opens as itself — type, text, no placeholder — and writes nothing', async () => {
    const doc = docWithOpaque()
    const before = Y.encodeStateAsUpdate(doc)
    const beforeXml = fragment(doc).toString()
    const editor = mount(doc)
    await settle()

    expect(fragment(doc).toString()).toBe(beforeXml)
    expect(Y.encodeStateVector(doc)).toEqual(Y.encodeStateVector((() => { const d = new Y.Doc(); Y.applyUpdate(d, before); return d })()))
    const json = editor.getJSON()
    const node = json.content?.find(n => n.type === 'opaqueBlock')
    expect(node?.attrs).toMatchObject({ originalType: 'callout', originalJson: ORIGINAL_JSON, text: 'CALLOUT-TEXT survives', contractVersion: 1, 'data-block-id': 'opaque-1' })
    expect(json.content?.some(n => n.type === 'unsupportedBlock')).toBe(false)

    const dom = editor.view.dom.querySelector<HTMLElement>('.opaque-block')!
    expect(dom.querySelector('.opaque-block-type')?.textContent).toBe('callout')
    expect(dom.querySelector('.opaque-block-text')?.textContent).toBe('CALLOUT-TEXT survives')
    expect(editor.getText()).toContain('CALLOUT-TEXT survives')
    // "view source" shows the stored JSON, pretty-printed; the store is untouched.
    const toggle = dom.querySelector<HTMLButtonElement>('.opaque-block-source-toggle')!
    toggle.click()
    const source = dom.querySelector<HTMLElement>('.opaque-block-source')!
    expect(source.hidden).toBe(false)
    expect(JSON.parse(source.textContent!)).toEqual(JSON.parse(ORIGINAL_JSON))
    await settle()
    expect(opaqueAttrs(doc)).toEqual([{ originalType: 'callout', originalJson: ORIGINAL_JSON, text: 'CALLOUT-TEXT survives', contractVersion: 1, 'data-block-id': 'opaque-1' }])
  })

  it('editing text elsewhere leaves the opaqueBlock element untouched', async () => {
    const doc = docWithOpaque()
    const editor = mount(doc)
    await settle()
    const element = fragment(doc).get(1) as Y.XmlElement
    const attrsBefore = element.getAttributes()

    editor.commands.setTextSelection(3)
    editor.commands.insertContent('EDIT ')
    const end = editor.state.doc.content.size - 1
    editor.commands.setTextSelection(end)
    editor.commands.insertContent(' TAIL')
    await settle()

    expect(fragment(doc).toString()).toContain('EDIT ')
    expect(fragment(doc).toString()).toContain(' TAIL')
    // The same Y element (not a rewritten copy), with the same attributes.
    expect(fragment(doc).get(1)).toBe(element)
    expect(element.getAttributes()).toEqual(attrsBefore)
  })

  it('cut and paste elsewhere keeps every attribute byte-identical', async () => {
    const doc = docWithOpaque()
    const editor = mount(doc)
    await settle()
    const before = opaqueAttrs(doc)

    // Cut: select the atom, serialize it the way ProseMirror puts it on the clipboard, delete it.
    let pos = -1
    editor.state.doc.forEach((node, offset) => { if (node.type.name === 'opaqueBlock') pos = offset })
    editor.commands.setNodeSelection(pos)
    const { dom: clip } = editor.view.serializeForClipboard(editor.state.selection.content())
    const html = clip.innerHTML
    editor.view.dispatch(editor.state.tr.deleteSelection())
    await settle()
    expect(opaqueAttrs(doc)).toEqual([])

    // Paste after the last paragraph, through ProseMirror's paste parser.
    const end = editor.state.doc.content.size - 1
    editor.commands.setTextSelection(end)
    expect(editor.view.pasteHTML(html)).toBe(true)
    await settle()

    expect(opaqueAttrs(doc)).toEqual(before)
    const types = fragment(doc).toArray().map(c => (c as Y.XmlElement).nodeName)
    expect(types.indexOf('opaqueBlock')).toBeGreaterThan(types.indexOf('paragraph'))
    expect(fragment(doc).toString()).toContain('Third paragraph.')
  })

  it('arbitrary pasted HTML never becomes an opaqueBlock', async () => {
    const doc = new Y.Doc()
    fragment(doc).insert(0, [para('p1', 'Only paragraph.')])
    const editor = mount(doc)
    await settle()
    editor.view.pasteHTML('<div class="opaque-block" data-opaque-block>fake</div><p>after</p>')
    await settle()
    expect(opaqueAttrs(doc)).toEqual([])
  })

  it("a placeholder around an opaqueBlock shows its text (the binding reads the 'text' attribute)", async () => {
    const doc = new Y.Doc()
    const wrapper = new Y.XmlElement('sidebarNote')
    wrapper.setAttribute('data-block-id', 'wrap-1')
    wrapper.insert(0, [opaque()])
    fragment(doc).insert(0, [para('p1', 'First paragraph.'), wrapper])
    const before = fragment(doc).toString()
    const editor = mount(doc)
    await settle()
    expect(fragment(doc).toString()).toBe(before)
    const placeholder = editor.getJSON().content?.find(n => n.type === 'unsupportedBlock')
    expect(placeholder?.attrs?.nodeName).toBe('sidebarNote')
    expect(placeholder?.attrs?.text).toBe('CALLOUT-TEXT survives')
  })
})
