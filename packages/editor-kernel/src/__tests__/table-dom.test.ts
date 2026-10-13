/**
 * table-dom.test.ts — the SHAPE a table actually renders as, pinned.
 *
 * TipTap's Table extension mounts every table inside a
 * `<div class="tableWrapper">`. That one fact decides whether the editor's
 * table CSS runs at all, and it is invisible from the schema, from
 * `getJSON()`, and from `getHTML()` — all three report a `table` node with no
 * wrapper anywhere in sight. It shows up only in the VIEW's DOM.
 *
 * The wrapper is UNCONDITIONAL. It is not a consequence of `resizable: true`
 * (base.ts:140), which is the natural guess and is wrong: built both ways and
 * compared, the wrapper and the <colgroup> are identical either way. So this
 * test stays meaningful even if column resizing is ever turned off.
 *
 * Which is how `.ProseMirror > table { position: relative }` sat in
 * `editor-host.ts` matching nothing, and how cloud-1 shipped the same dead
 * selector (`document-editor.ts:1922`). A rule that targets nothing looks
 * exactly like a rule that works, in a diff and in a passing test alike.
 *
 * So this asserts the negative as well as the positive: the wrapper exists AND
 * the table is not a child of the editable root. If a TipTap bump ever drops
 * the wrapper (or `resizable` is turned off), the table CSS silently stops
 * applying — and this test fails first, naming the reason.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { kernelExtensions } from '../index'

const editors: Editor[] = []
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy() })

function mountWithTable(): HTMLElement {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: kernelExtensions({}) })
  editors.push(editor)
  editor.commands.setContent('<p>before</p>')
  editor.commands.focus('end')
  editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
  return editor.view.dom as HTMLElement
}

describe('table DOM shape — what the editor CSS has to target', () => {
  it('wraps the table in .tableWrapper, so <table> is NOT a child of .ProseMirror', () => {
    const dom = mountWithTable()
    expect(dom.querySelector('.tableWrapper')).not.toBeNull()

    // Walk `children` rather than querying `:scope > …`. happy-dom does not
    // support `:scope`, and returns null for BOTH halves of this check — which
    // would have let the negative assertion below pass for the wrong reason,
    // proving nothing while looking green. `children` is a plain DOM property
    // with no selector engine underneath it.
    const childTags = Array.from(dom.children).map(child => child.tagName.toLowerCase())
    expect(childTags).toContain('div')
    expect(Array.from(dom.children).some(child => child.classList.contains('tableWrapper'))).toBe(true)
    // The load-bearing half: `editor-host.ts` styles `> .tableWrapper` and not
    // `> table` precisely because no table appears at this level.
    expect(childTags).not.toContain('table')
  })

  it('renders real th and td cells, each holding a paragraph', () => {
    const dom = mountWithTable()
    // withHeaderRow: true — the header row is th, the body row td. Both get
    // borders and padding from the same rule; only th is tinted.
    expect(dom.querySelectorAll('.tableWrapper th')).toHaveLength(2)
    expect(dom.querySelectorAll('.tableWrapper td')).toHaveLength(2)
    // Cell paragraphs are why the CSS zeroes `th > p`/`td > p` margins.
    expect(dom.querySelector('.tableWrapper th > p')).not.toBeNull()
    expect(dom.querySelector('.tableWrapper td > p')).not.toBeNull()
  })
})
