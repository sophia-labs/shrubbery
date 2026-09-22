/**
 * S4 BlockId organism proof — ported VERBATIM from garden, ONE coupling severed:
 * garden's `featureFlags.queryBlocksEnabled` ternary (which conditionally added
 * 'queryBlock' to the data-block-id target list) is replaced by the
 * KernelOptions.enabledNodeTypes seam (default []).
 *
 * ACCURATE MODEL (per preflight): BlockId adds NO node — it adds `data-block-id`
 * as a GLOBAL ATTRIBUTE over a BLOCK_TYPES target list, and auto-assigns IDs via
 * an appendTransaction plugin. So we prove (Tier-B) a real edit makes the plugin
 * stamp a STRING blockId onto paragraphs, and (Tier-A) the schema builds with the
 * default roster AND with an opt-in deferred type passed through enabledNodeTypes.
 *
 * NO mocks: a REAL @tiptap/pm Schema + a REAL TipTap Editor under happy-dom.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { Schema } from '@tiptap/pm/model'
import { kernelExtensions, createKernelEditor } from '../index'

describe('S4 BlockId — Tier-A real ProseMirror Schema', () => {
  it('getSchema(kernelExtensions()) (default) does NOT throw and builds', () => {
    let schema: Schema | undefined
    expect(() => {
      schema = getSchema(kernelExtensions())
    }).not.toThrow()
    expect(schema).toBeInstanceOf(Schema)
  })

  it('default schema: data-block-id global attr lands on the base block types', () => {
    const schema = getSchema(kernelExtensions())
    // BlockId targets paragraph/heading/listItem/blockquote/codeBlock/
    // horizontalRule/image/mathBlock/tableCell/tableHeader — global attr
    // filtered to MATCHING registered nodes.
    expect(Object.keys(schema.nodes.paragraph.spec.attrs ?? {})).toContain('data-block-id')
    expect(Object.keys(schema.nodes.heading.spec.attrs ?? {})).toContain('data-block-id')
    expect(Object.keys(schema.nodes.listItem.spec.attrs ?? {})).toContain('data-block-id')
    expect(Object.keys(schema.nodes.codeBlock.spec.attrs ?? {})).toContain('data-block-id')
    // Table cells are wireable blocks; the table itself is the container.
    expect(Object.keys(schema.nodes.tableCell.spec.attrs ?? {})).toContain('data-block-id')
    expect(Object.keys(schema.nodes.tableHeader.spec.attrs ?? {})).toContain('data-block-id')
    expect(Object.keys(schema.nodes.table.spec.attrs ?? {})).not.toContain('data-block-id')
  })

  it('kernelExtensions ships queryBlock with data-block-id targeting', () => {
    let schema: Schema | undefined
    expect(() => {
      schema = getSchema(kernelExtensions())
    }).not.toThrow()
    expect(schema).toBeInstanceOf(Schema)
    expect(schema!.nodes.queryBlock).toBeDefined()
    expect(Object.keys(schema!.nodes.queryBlock.spec.attrs ?? {})).toContain('data-block-id')
    expect(Object.keys(schema!.nodes.paragraph.spec.attrs ?? {})).toContain('data-block-id')
  })

  it('blockId extension is present in the roster by its REAL .name', () => {
    const element = document.createElement('div')
    const editor = new Editor({ element, extensions: kernelExtensions() })
    const ext = editor.extensionManager.extensions.find((e) => e.name === 'blockId')
    expect(ext).toBeDefined()
    editor.destroy()
  })
})

describe('S4 BlockId — Tier-B real editor behavior', () => {
  let editors: Editor[] = []
  afterEach(() => {
    for (const e of editors) e.destroy()
    editors = []
  })

  function mount(opts = {}) {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const editor = createKernelEditor(element, opts)
    editors.push(editor)
    return editor
  }

  it('a real edit makes the plugin stamp a STRING blockId attr on paragraphs', () => {
    const editor = mount()
    // The appendTransaction plugin assigns IDs to blocks missing them. Setting
    // content + one real edit drives a transaction through the plugin.
    editor.commands.setContent('<p>Borges</p><p>Bioy</p>')
    editor.commands.focus('end')
    editor.commands.insertContent(' Casares')

    const ids: unknown[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'paragraph') {
        ids.push(node.attrs['data-block-id'])
      }
    })
    expect(ids.length).toBeGreaterThanOrEqual(2)
    for (const id of ids) {
      expect(typeof id).toBe('string')
      expect(id as string).toMatch(/^block-[0-9a-f]{8}$/)
    }
  })

  it('the stamped ids round-trip into rendered HTML as data-block-id', () => {
    const editor = mount()
    editor.commands.setContent('<p>Tlön</p>')
    editor.commands.focus('end')
    editor.commands.insertContent('!')
    const html = editor.getHTML()
    expect(html).toMatch(/data-block-id="block-[0-9a-f]{8}"/)
  })

  it("opt-in editor with enabledNodeTypes still stamps the base block types", () => {
    const editor = mount({ enabledNodeTypes: ['queryBlock'] })
    editor.commands.setContent('<p>x</p>')
    editor.commands.focus('end')
    editor.commands.insertContent('y')
    let pid: unknown = undefined
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'paragraph') pid = node.attrs['data-block-id']
    })
    expect(typeof pid).toBe('string')
  })
})
