import type { Editor } from '@tiptap/core'
import { getSchema } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createKernelEditor,
  filterSlashCommands,
  kernelExtensions,
  normalizeObjectEmbedAttrs,
  type ObjectEmbedRenderer,
  type ObjectEmbedRenderRequest,
  objectEmbedText,
} from '../index'

const editors: Editor[] = []

afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
  document.body.innerHTML = ''
})

function mount(opts: Parameters<typeof createKernelEditor>[1] = {}): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = createKernelEditor(element, opts)
  editors.push(editor)
  return editor
}

function embeds(editor: Editor): { node: PmNode; pos: number }[] {
  const found: { node: PmNode; pos: number }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'objectEmbed') found.push({ node, pos })
    return node.type.name !== 'objectEmbed'
  })
  return found
}

// The §4 embed contract, exactly as an agent sends it through insert_blocks.
const MEIER = {
  iri: 'urn:sophia:wf:doc-sleepers:run:mh3x9a1#item-7',
  graphId: 'freud-dreams',
  slot: 'card' as const,
  label: 'Meier',
  classLabel: 'Dream report',
}

describe('objectEmbed: the schema', () => {
  it('is a draggable block atom with the contract attrs and a block id', () => {
    const schema = getSchema(kernelExtensions({ collaborative: true }))
    const spec = schema.nodes.objectEmbed!.spec
    expect(spec).toMatchObject({ group: 'block', atom: true, draggable: true })
    expect(Object.keys(spec.attrs ?? {}).sort()).toEqual(['classLabel', 'data-block-id', 'graphId', 'iri', 'label', 'slot'])
  })
})

describe('objectEmbed: the round trip', () => {
  it('stores the contract JSON as sent, mints a block id, and reads it back in a second editor', () => {
    const editor = mount()
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before.' }] }, { type: 'objectEmbed', attrs: MEIER }] })
    const [embed] = embeds(editor)
    expect(embed?.node.attrs).toMatchObject(MEIER)
    expect(embed?.node.attrs['data-block-id']).toMatch(/^block-[0-9a-f]{8}$/)
    const json = editor.getJSON()
    const stored = json.content?.find((n) => n.type === 'objectEmbed')
    expect(stored).toEqual({ type: 'objectEmbed', attrs: { ...MEIER, 'data-block-id': embed!.node.attrs['data-block-id'] } })

    const second = mount()
    second.commands.setContent(json)
    expect(embeds(second)[0]?.node.attrs).toEqual(embed!.node.attrs)
  })

  it('round-trips through clipboard HTML, the graph optional', () => {
    const editor = mount()
    editor.commands.setContent({ type: 'doc', content: [{ type: 'objectEmbed', attrs: { ...MEIER, graphId: null } }] })
    const html = editor.getHTML()
    expect(html).toContain('<object-embed')
    expect(html).toContain('data-block-embed')
    const second = mount()
    second.commands.setContent(html)
    expect(embeds(second)[0]?.node.attrs).toMatchObject({ ...MEIER, graphId: null })
  })

  it('keeps a slot the contract allows and reads any other as the card', () => {
    expect(normalizeObjectEmbedAttrs({ iri: 'urn:x', slot: 'pane' }).slot).toBe('pane')
    expect(normalizeObjectEmbedAttrs({ iri: 'urn:x', slot: 'poster' }).slot).toBe('card')
    expect(normalizeObjectEmbedAttrs({ iri: ' urn:x ', graphId: '' })).toEqual({ iri: 'urn:x', graphId: null, slot: 'card', label: '', classLabel: '' })
  })

  it('insertObjectEmbed refuses an embed that points nowhere', () => {
    const editor = mount()
    expect(editor.commands.insertObjectEmbed({ iri: '' })).toBe(false)
    expect(embeds(editor)).toHaveLength(0)
    expect(editor.commands.insertObjectEmbed(MEIER)).toBe(true)
    expect(embeds(editor)).toHaveLength(1)
  })

  it('reads as one line of plain text: the class and the title', () => {
    expect(objectEmbedText(normalizeObjectEmbedAttrs(MEIER))).toBe('⧉ Dream report — Meier')
    const editor = mount()
    editor.commands.setContent({ type: 'doc', content: [{ type: 'objectEmbed', attrs: MEIER }] })
    expect(editor.getText()).toContain('⧉ Dream report — Meier')
  })
})

describe('objectEmbed: the host renderer seam', () => {
  it('hands the face the attrs, the block id and the graph, updates it in place, and destroys it with the node', () => {
    const requests: ObjectEmbedRenderRequest[] = []
    let destroyed = 0
    const renderer: ObjectEmbedRenderer = (target, request) => {
      requests.push(request)
      target.textContent = `FACE:${request.attrs.label}`
      return {
        update(next) {
          requests.push(next)
          target.textContent = `FACE:${next.attrs.label}`
        },
        destroy() {
          destroyed += 1
        },
      }
    }
    const editor = mount({ renderObjectEmbed: renderer, getGraphId: () => 'freud-dreams' })
    editor.commands.setContent({ type: 'doc', content: [{ type: 'objectEmbed', attrs: MEIER }] })
    const dom = document.querySelector('.object-embed') as HTMLElement
    expect(dom.textContent).toBe('FACE:Meier')
    expect(dom.hasAttribute('data-block-embed')).toBe(true)
    const last = requests.at(-1)!
    expect(last.graphId).toBe('freud-dreams')
    expect(last.attrs).toEqual({ ...MEIER, slot: 'card' })
    expect(last.blockId).toMatch(/^block-/)

    const { node, pos } = embeds(editor)[0]!
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, label: 'Meier (1758)' }))
    expect(document.querySelector('.object-embed')!.textContent).toBe('FACE:Meier (1758)')

    const before = destroyed
    requests.at(-1)!.deleteNode()
    expect(embeds(editor)).toHaveLength(0)
    expect(destroyed).toBe(before + 1)
  })

  it('without a host face, draws its snapshot and says it is one', () => {
    const editor = mount()
    editor.commands.setContent({ type: 'doc', content: [{ type: 'objectEmbed', attrs: MEIER }] })
    const dom = document.querySelector('.object-embed')!
    expect(dom.querySelector('.object-embed-fallback-class')?.textContent).toBe('Dream report')
    expect(dom.querySelector('.object-embed-fallback-label')?.textContent).toBe('Meier')
    expect(dom.querySelector('.object-embed-fallback-note')?.textContent).toBe('as it was when it was embedded')
  })
})

describe('the /object slash command', () => {
  it('is offered, and found by "object" and by "embed"', () => {
    expect(filterSlashCommands('object').map((c) => c.id)).toContain('object')
    expect(filterSlashCommands('embed').map((c) => c.id)).toContain('object')
  })
})
