/**
 * The web editor must never destroy stored content it cannot render.
 *
 * Regression for the senderos evidence-list loss (2026-09-23; demi round
 * 2026-09-25-editor-list-loss): an agent wrote `bulletList > listItem >
 * paragraph` through MCP, and merely OPENING the document in the SPA deleted
 * every such list from the shared Y.Doc, because the collaborative binding
 * deletes any Y element that `schema.node(...)` rejects.
 *
 * These tests bind the REAL collaborative editor (kernel roster + Collaboration
 * + the patched @tiptap/y-tiptap) to a REAL Y.Doc. The first fixture is the
 * exact bytes a real gardend (garden main 481b015) stored for a
 * `write_document {tiptapJson}` carrying a nested bulletList; the rest are the
 * other shapes an MCP writer can store, built with yjs directly.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { COLLAB_FIELD, createLiveCollabEditor } from '../live-editor.js'

const here = dirname(fileURLToPath(import.meta.url))
const editors: Editor[] = []

afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
  document.body.innerHTML = ''
})

function mount(doc: Y.Doc): Editor {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = createLiveCollabEditor({ element, doc })
  editors.push(editor)
  return editor
}

const settle = () => new Promise(resolve => setTimeout(resolve, 30))

function fragment(doc: Y.Doc): Y.XmlFragment {
  return doc.getXmlFragment(COLLAB_FIELD)
}

function para(id: string, text: string, format?: Record<string, unknown>): Y.XmlElement {
  const p = new Y.XmlElement('paragraph')
  p.setAttribute('data-block-id', id)
  const t = new Y.XmlText()
  p.insert(0, [t])
  t.insert(0, text, format)
  return p
}

function listItem(text: string): Y.XmlElement {
  const li = new Y.XmlElement('listItem')
  const p = new Y.XmlElement('paragraph')
  const t = new Y.XmlText()
  p.insert(0, [t])
  t.insert(0, text)
  li.insert(0, [p])
  return li
}

function docWith(...blocks: Array<Y.XmlElement | Y.XmlText>): Y.Doc {
  const doc = new Y.Doc()
  fragment(doc).insert(0, [para('anchor', 'Anchor paragraph stays.'), ...blocks])
  return doc
}

function container(name: string, id: string, ...children: Y.XmlElement[]): Y.XmlElement {
  const el = new Y.XmlElement(name)
  el.setAttribute('data-block-id', id)
  el.insert(0, children)
  return el
}

describe('collaborative editor preserves content its schema cannot render', () => {
  it('opening a real gardend-written nested bulletList leaves the stored list intact', async () => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, new Uint8Array(readFileSync(join(here, 'fixtures/gardend-481b015-nested-bulletlist.ydoc.bin'))))
    const before = fragment(doc).toString()
    expect(before).toContain('<bulletlist')
    expect(before).toContain('BULLET-A')

    mount(doc)
    await settle()

    expect(fragment(doc).toString()).toContain('<bulletlist')
    expect(fragment(doc).toString()).toContain('BULLET-A')
    expect(fragment(doc).toString()).toContain('BULLET-B')
  })

  it.each([
    ['bulletList', () => container('bulletList', 'b1', listItem('BULLET-TEXT'))],
    ['orderedList', () => container('orderedList', 'o1', listItem('ORDERED-TEXT'))],
    ['taskList', () => container('taskList', 't1', container('taskItem', 'ti', listItem('TASK-TEXT')))],
    ['an unknown custom block', () => container('callout', 'c1', para('cp', 'CALLOUT-TEXT'))],
    ['a known block with invalid children', () => {
      const p = para('pi', 'INLINE-IMG-HOST ')
      const img = new Y.XmlElement('image')
      img.setAttribute('src', 'https://example.org/x.png')
      p.insert(1, [img])
      return p
    }],
  ])('opening a document holding %s deletes nothing and renders a placeholder', async (_label, make) => {
    const doc = docWith(make())
    const before = fragment(doc).toString()

    const editor = mount(doc)
    await settle()

    expect(fragment(doc).toString()).toBe(before)
    const json = editor.getJSON()
    expect(json.content?.some(n => n.type === 'unsupportedBlock')).toBe(true)
  })

  it('text carrying an unknown mark survives open and survives editing its own paragraph', async () => {
    const doc = docWith(para('pm', 'SUPER', { superscript: {} }))
    const editor = mount(doc)
    await settle()
    expect(fragment(doc).toString()).toContain('SUPER')

    // Type into the very paragraph that holds the unknown mark.
    let end = 0
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.attrs['data-block-id'] === 'pm') end = pos + node.nodeSize - 1
    })
    editor.commands.insertContentAt(end, ' tail')
    await settle()

    const stored = fragment(doc).toString()
    expect(stored).toContain('SUPER')
    expect(stored).toContain('<superscript>SUPER</superscript>')
    expect(stored).toContain(' tail')
  })

  it('editing elsewhere in the document leaves the unknown block untouched', async () => {
    const doc = docWith(container('bulletList', 'b2', listItem('KEEP-ME')))
    const editor = mount(doc)
    await settle()
    editor.commands.insertContentAt(1, 'Edited ')
    await settle()
    const stored = fragment(doc).toString()
    expect(stored).toContain('Edited Anchor')
    expect(stored).toContain('<bulletlist data-block-id="b2"><listitem><paragraph>KEEP-ME</paragraph></listitem></bulletlist>')
  })

  it('a bare top-level text node does not crash the editor or get deleted', async () => {
    const t = new Y.XmlText()
    const doc = docWith(t)
    t.insert(0, 'BARE-TOP-TEXT')
    const before = fragment(doc).toString()
    expect(() => mount(doc)).not.toThrow()
    await settle()
    expect(fragment(doc).toString()).toBe(before)
  })

  it('a remote change inside the unknown block is kept and re-rendered', async () => {
    const list = container('bulletList', 'b3', listItem('FIRST'))
    const doc = docWith(list)
    const editor = mount(doc)
    await settle()
    list.insert(1, [listItem('SECOND-FROM-AGENT')])
    await settle()
    expect(fragment(doc).toString()).toContain('SECOND-FROM-AGENT')
    const placeholder = editor.getJSON().content?.find(n => n.type === 'unsupportedBlock')
    expect(placeholder?.attrs?.text).toContain('SECOND-FROM-AGENT')
  })

  it('the placeholder keeps the original line structure: one line per item, ordered and nested lists marked', async () => {
    const nested = listItem('PARENT')
    nested.insert(1, [container('bulletList', 'inner', listItem('CHILD'))])
    const doc = docWith(
      container('bulletList', 'b6', listItem('ONE'), listItem('TWO'), nested),
      container('orderedList', 'b7', listItem('FIRST'), listItem('SECOND')),
    )
    const editor = mount(doc)
    await settle()
    const placeholders = editor.getJSON().content?.filter(n => n.type === 'unsupportedBlock') ?? []
    expect(placeholders.map(p => p.attrs?.text)).toEqual([
      '• ONE\n• TWO\n• PARENT\n  • CHILD',
      '1. FIRST\n2. SECOND',
    ])
    // Rendered: one line per item, a quiet humanized label, marked as an embed.
    const block = editor.view.dom.querySelector<HTMLElement>('.unsupported-block')!
    expect(block.dataset.blockEmbed).toBe('')
    expect(block.querySelector('.unsupported-block-label')?.textContent).toBe('bullet list')
    expect([...block.querySelectorAll('.unsupported-block-line')].map(l => l.textContent))
      .toEqual(['• ONE', '• TWO', '• PARENT', '• CHILD'])
    expect(block.querySelectorAll('.unsupported-block-line')[3]?.getAttribute('style')?.replace(/\s/g, '')).toContain('--unsupported-indent:1')
    // Display only: storage is untouched.
    expect(fragment(doc).toString()).toContain('<listitem><paragraph>CHILD</paragraph></listitem>')
  })

  it('the user can still delete the placeholder on purpose', async () => {
    const doc = docWith(container('bulletList', 'b4', listItem('DELETE-ME')))
    const editor = mount(doc)
    await settle()
    let from = -1
    let to = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'unsupportedBlock') { from = pos; to = pos + node.nodeSize }
    })
    expect(from).toBeGreaterThan(-1)
    editor.commands.deleteRange({ from, to })
    await settle()
    expect(fragment(doc).toString()).not.toContain('DELETE-ME')
  })

  it('a placeholder moved by ProseMirror (cut, then paste) writes back the original, not itself', async () => {
    const doc = docWith(container('bulletList', 'b5', listItem('MOVE-ME-A'), listItem('MOVE-ME-B')))
    const editor = mount(doc)
    await settle()
    let from = -1
    let json: Record<string, unknown> | null = null
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'unsupportedBlock') { from = pos; json = node.toJSON() as Record<string, unknown> }
    })
    // Cut and paste in one transaction: delete the placeholder, re-insert its
    // JSON before the anchor paragraph.
    editor.chain().deleteRange({ from, to: from + 1 }).insertContentAt(0, json!).run()
    await settle()
    const stored = fragment(doc).toString()
    expect(stored.indexOf('<bulletlist')).toBe(0)
    expect(stored).toContain('<bulletlist data-block-id="b5"><listitem><paragraph>MOVE-ME-A</paragraph></listitem><listitem><paragraph>MOVE-ME-B</paragraph></listitem></bulletlist>')
    expect(stored).not.toContain('unsupportedblock')
  })

  it('an unknown list nested inside a flat listItem is kept', async () => {
    const outer = new Y.XmlElement('listItem')
    outer.setAttribute('data-block-id', 'l1')
    outer.setAttribute('listType', 'bullet')
    const p = new Y.XmlElement('paragraph')
    const t = new Y.XmlText()
    p.insert(0, [t])
    t.insert(0, 'OUTER')
    outer.insert(0, [p, container('bulletList', 'nested', listItem('INNER-NESTED'))])
    const doc = docWith(outer)
    mount(doc)
    await settle()
    expect(fragment(doc).toString()).toContain('INNER-NESTED')
  })
})
