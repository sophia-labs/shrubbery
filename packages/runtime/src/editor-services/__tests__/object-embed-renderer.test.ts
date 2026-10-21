/**
 * A document holding an `objectEmbed` shows the live object: a REAL kernel editor with the runtime's embed face, the
 * object read through the typed-object seam over the D5 fixtures in a real Oxigraph store.
 */
import { createKernelEditor } from '@shrubbery/editor-kernel'
import type { Editor, JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { makeObjectEmbedRenderer } from '../object-embed-renderer.js'
import type { ShInjerto } from '../../object-view/injerto-element.js'
import type { ShObjectView } from '../../object-view/object-view-element.js'
import { fixtureTypedObjectService, loadFixtures, TYPED_ITEM, UNFIT_ITEM } from '../../object-view/__tests__/typed-fixture-store.js'

const store = loadFixtures()
const editors: Editor[] = []

afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
  document.body.replaceChildren()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

async function mountDoc(content: JSONContent[], reads: string[] = []) {
  const element = document.createElement('div')
  document.body.append(element)
  const service = fixtureTypedObjectService(store)
  const counted = { read: (g: string, iri: string) => { reads.push(iri); return service.read(g, iri) } }
  const editor = createKernelEditor(element, { renderObjectEmbed: makeObjectEmbedRenderer(counted), getGraphId: () => 'freud-dreams' })
  editors.push(editor)
  editor.commands.setContent({ type: 'doc', content })
  await settle()
  const frames = [...element.querySelectorAll('sh-injerto')] as ShInjerto[]
  for (const frame of frames) await frame.updateComplete
  return { editor, element, frames }
}

const embed = (iri: string, label = 'Meier'): JSONContent => ({ type: 'objectEmbed', attrs: { iri, slot: 'card', label, classLabel: 'Dream report' } })

describe('the objectEmbed face in a live editor', () => {
  it('mounts an injerto that reads the object live and draws it as a card', async () => {
    const { frames } = await mountDoc([{ type: 'paragraph', content: [{ type: 'text', text: 'Meier, in my notes:' }] }, embed(TYPED_ITEM)])
    expect(frames).toHaveLength(1)
    const frame = frames[0]!
    expect(frame.status).toBe('ready')
    expect(frame.graphId).toBe('freud-dreams')
    expect(frame.shadowRoot!.querySelector('.flag')!.textContent).toBe('Dream report · run testimony')
    const view = frame.shadowRoot!.querySelector('sh-object-view') as ShObjectView
    await view.updateComplete
    expect(view.model?.title).toBe('Meier')
    expect(view.shadowRoot!.querySelector('blockquote.quote')!.textContent).toBe('he awoke and felt a straw sticking between his toes')
  })

  it('an unfit object is drawn unfit; an object the graph does not hold is honestly absent, with its snapshot', async () => {
    const { frames } = await mountDoc([embed(UNFIT_ITEM, 'the rolling of thunder'), embed(`${TYPED_ITEM}-gone`, 'A report that was deleted')])
    expect(frames.map((f) => f.status)).toEqual(['ready', 'absent'])
    expect(frames[0]!.shadowRoot!.querySelector('.frame')!.getAttribute('data-stance')).toBe('unfit')
    const absent = frames[1]!.shadowRoot!.textContent!.replace(/\s+/g, ' ')
    expect(absent).toContain('Not in this graph')
    expect(absent).toContain('A report that was deleted')
  })

  it('re-reads only when the object changes, not on every redraw, and stops reading when the node goes', async () => {
    const reads: string[] = []
    const { editor } = await mountDoc([embed(TYPED_ITEM)], reads)
    expect(reads).toEqual([TYPED_ITEM])
    let pos = -1
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === 'objectEmbed') pos = at
    })
    const node = editor.state.doc.nodeAt(pos)!
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, label: 'Meier, renamed' }))
    await settle()
    expect(reads).toEqual([TYPED_ITEM])
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, iri: UNFIT_ITEM }))
    await settle()
    expect(reads).toEqual([TYPED_ITEM, UNFIT_ITEM])
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(document.querySelectorAll('sh-injerto')).toHaveLength(0)
  })
})
