/**
 * seeding-html-round-trip.test.ts — the browser acceptance script's
 * PRECONDITION, proven in the fast lane so a failure there is unambiguous.
 *
 * `scripts/seele-workbench-gardend-browser.mts` loads the constitution into a
 * real, live, CRDT-backed editor through the host's own public
 * `LiveEditorHandle.restoreHtml()` — which is `editor.commands.setContent(html)`
 * verbatim. That is the real insertion path a real paste or a real document
 * import takes; it is not a test hook. But it only carries the compile source
 * faithfully if `<pre><code class="language-seele">` round-trips to a
 * `codeBlock` whose `language` attribute is `seele` and whose text is
 * byte-identical to what went in — including blank lines, indentation, and
 * characters that must survive HTML escaping.
 *
 * So: assert it here, against the REAL kernel editor and the REAL projection.
 * If the browser script ever reports "no seele fence", this file says whether
 * the seeding path or the live room is at fault.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createKernelEditor, type Editor } from '@shrubbery/editor-kernel'
import { projectSeeleSource } from '@shrubbery/runtime'
import { seeleFenceHtml } from '../src/seed-html.js'

let editors: Editor[] = []
afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors = []
  document.body.replaceChildren()
})

function mount(): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = createKernelEditor(element, { profile: 'document' })
  editors.push(editor)
  return editor
}

describe('the browser script’s seeding HTML', () => {
  const PROVOCATIVE = 'a: 1\n\nb: "x & <y> \'z\'"\nc: |\n  multi\n  line\nd: [1, 2]\n'

  it('round-trips to exactly one seele fence, byte-exact, through the real editor', () => {
    const editor = mount()
    editor.commands.setContent(seeleFenceHtml('circle-1', 'The constitution of the first circle.', PROVOCATIVE))
    const projection = projectSeeleSource(editor.getJSON())
    expect(projection.source).toBe(PROVOCATIVE)
    expect(projection.region.blockId).toMatch(/^block-/)
  })

  it('keeps the surrounding prose OUT of the projected source', () => {
    const editor = mount()
    editor.commands.setContent(seeleFenceHtml('circle-1', 'apiVersion: not-really-yaml', PROVOCATIVE))
    const projection = projectSeeleSource(editor.getJSON())
    expect(projection.source).toBe(PROVOCATIVE)
    expect(projection.source).not.toContain('not-really-yaml')
  })

  it('tags the fence `seele`, not the ambient default', () => {
    const editor = mount()
    editor.commands.setContent(seeleFenceHtml('t', 'p', 'x: 1\n'))
    const json = editor.getJSON() as { content?: Array<{ type?: string; attrs?: Record<string, unknown> }> }
    const fence = json.content?.find(node => node.type === 'codeBlock')
    expect(fence?.attrs?.language).toBe('seele')
  })
})
