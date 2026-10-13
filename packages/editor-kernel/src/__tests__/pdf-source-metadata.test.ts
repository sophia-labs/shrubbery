import { describe, it, expect } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { kernelExtensions } from '../index.js'

describe('PDF source anchor raw editor carrier', () => {
  it('declares the attribute on every supported source block without interpreting it', () => {
    const schema = getSchema(kernelExtensions())
    for (const name of ['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'horizontalRule', 'image', 'mathBlock', 'table', 'tableRow', 'tableHeader', 'tableCell'])
      expect(schema.nodes[name]!.spec.attrs).toHaveProperty('data-pdf-anchor')
  })
  for (const raw of ['', ' { "version":2,"future":"<& retained" } ', '{malformed', '{"version":1,"unknown":true}']) {
    it('preserves raw unsupported/invalid bytes through actual editor JSON and HTML: ' + raw, () => {
      const editor = new Editor({ element: document.createElement('div'), extensions: kernelExtensions(),
        content: { type: 'doc', content: [{ type: 'paragraph', attrs: { 'data-pdf-anchor': raw }, content: [{ type: 'text', text: 'Source text' }] }] } })
      let restored: Editor | undefined
      try {
        expect(editor.getJSON().content![0]!.attrs!['data-pdf-anchor']).toBe(raw)
        const html = editor.getHTML()
        restored = new Editor({ element: document.createElement('div'), extensions: kernelExtensions(), content: html })
        expect(restored.getJSON().content![0]!.attrs!['data-pdf-anchor']).toBe(raw)
        restored.commands.insertContentAt(1, 'Edited ')
        expect(restored.getJSON().content![0]!.attrs!['data-pdf-anchor']).toBe(raw)
      } finally { restored?.destroy(); editor.destroy() }
    })
  }
})
