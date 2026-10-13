/**
 * The reader roster: file-borne HTML through the schema (an allowlist by construction), code decorations, and the
 * dataTable node's pure parts (sort, number detection). A REAL TipTap editor, read-only.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  createReaderEditor,
  readerDocumentFromHtml,
  readerLinkAllowed,
  registerDataTable,
  releaseDataTable,
  dataTableModel,
  detectNumericColumns,
  sortOrder,
  looksNumeric,
  columnLetter,
  imageSourceKind,
  type Editor,
} from '../index'

const editors: Editor[] = []
afterEach(() => { for (const e of editors) e.destroy(); editors.length = 0 })

function reader(content: Parameters<typeof createReaderEditor>[1], opts: Parameters<typeof createReaderEditor>[2] = {}): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = createReaderEditor(element, content, opts)
  editors.push(editor)
  return editor
}

describe('file-borne HTML through the reader schema', () => {
  it('keeps headings, lists, tables, code and safe links; drops script, style, iframe, event handlers and unsafe links', () => {
    const editor = reader(null)
    const doc = readerDocumentFromHtml(editor.schema, `
      <h2 onclick="alert(1)">Title</h2><style>p{color:red}</style><script type="text/plain">window.__ran = true</script>
      <ul><li>one</li><li>two</li></ul>
      <table><tr><th>a</th></tr><tr><td>1</td></tr></table>
      <pre><code class="language-ts">const x = 1</code></pre>
      <p><a href="https://example.com/x">safe</a> <a href="javascript:alert(1)">bad</a> <a href="/relative">rel</a></p>
      <iframe title="frame"></iframe><object title="object"></object>`)
    const json = JSON.stringify(doc)
    expect(json).not.toContain('window.__ran')
    expect(json).not.toContain('color:red')
    expect(json).not.toContain('iframe')
    expect(json).not.toContain('onclick')
    expect(json).not.toContain('javascript:')
    expect(json).toContain('"type":"heading"')
    expect(json).toContain('"type":"bulletList"')
    expect(json).toContain('"type":"table"')
    expect(json).toContain('"language":"ts"')
    expect(json).toContain('https://example.com/x')
    expect(json).not.toContain('/relative')
    editor.commands.setContent(doc)
    const links = [...editor.view.dom.querySelectorAll('a')]
    expect(links.map(a => [a.getAttribute('target'), a.getAttribute('rel')])).toEqual([['_blank', 'noopener noreferrer nofollow']])
    // That a script inside the file never RUNS is a browser fact (DOMParser documents have scripting disabled; happy-dom
    // does not honour it): the Files quick-look browser script witnesses it in Chromium.
  })

  it('an image from the web is a placeholder until clicked; a data: image is drawn; anything else is not included', () => {
    expect([imageSourceKind('https://a.example/p.png'), imageSourceKind('data:image/png;base64,AA=='), imageSourceKind('p.png'),
      imageSourceKind('javascript:alert(1)')]).toEqual(['remote', 'inline', 'absent', 'absent'])
    const editor = reader(null)
    editor.commands.setContent(readerDocumentFromHtml(editor.schema, '<p><img src="https://a.example/p.png" alt="plan"><img src="data:image/png;base64,AA=="></p>'))
    const dom = editor.view.dom
    expect(dom.querySelectorAll('img').length).toBe(1)
    const load = dom.querySelector<HTMLButtonElement>('.hoja-reader-image-load')!
    expect(load.textContent).toContain('a.example')
    load.click()
    expect([...dom.querySelectorAll('img')].map(i => i.getAttribute('src'))).toContain('https://a.example/p.png')
  })

  it('only absolute web and mail links are allowed', () => {
    expect(['https://x.y', 'http://x.y', 'mailto:a@b.c', 'javascript:x', '/a', '#b', 'data:text/html,x'].map(readerLinkAllowed))
      .toEqual([true, true, true, false, false, false, false])
  })
})

describe('code in the reader', () => {
  it('colours ranges from the host highlighter and puts a line-number column outside the text', () => {
    const editor = reader({ type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'let a\nlet b\n' }] }] },
      { lineNumbers: true, highlight: code => [{ from: 0, to: 3, className: 'hljs-keyword' }, { from: code.indexOf('let b'), to: code.indexOf('let b') + 3, className: 'hljs-keyword' }] })
    const dom = editor.view.dom
    expect([...dom.querySelectorAll('.hljs-keyword')].map(e => e.textContent)).toEqual(['let', 'let'])
    expect(dom.querySelector('.hoja-line-numbers')!.textContent).toBe('1\n2')
    expect(editor.state.doc.textContent).toBe('let a\nlet b\n')
    expect(dom.querySelector<HTMLElement>('.code-block-wrapper')!.dataset.language).toBe('js')
    expect(editor.isEditable).toBe(false)
  })
})

describe('the dataTable node', () => {
  const sheet = { name: 's', columns: ['name', 'n'], rows: [['b', '10'], ['a', '9'], ['', '1,200'], ['c', '']] }

  it('lives in the side store; the document holds only a reference', () => {
    const ref = registerDataTable({ sheets: [sheet] })
    const editor = reader({ type: 'doc', content: [{ type: 'dataTable', attrs: { ref } }] })
    expect(JSON.stringify(editor.getJSON()).length).toBeLessThan(200)
    expect(editor.view.dom.querySelector('.hoja-data-table [role="grid"]')!.getAttribute('aria-rowcount')).toBe('5')
    releaseDataTable(ref)
    expect(dataTableModel(ref)).toBeNull()
  })

  it('detects number columns and sorts them as numbers, empty cells last, stable', () => {
    expect(detectNumericColumns(sheet, 2)).toEqual([false, true])
    expect([...sortOrder(sheet, 1, 'asc', true)]).toEqual([1, 0, 2, 3])
    expect([...sortOrder(sheet, 1, 'desc', true)]).toEqual([2, 0, 1, 3])
    expect([...sortOrder(sheet, 0, 'asc', false)]).toEqual([1, 0, 3, 2])
    expect(['1,234.5', '-3e4', '12%', '$40', 'abc', '1-2', ''].map(looksNumeric)).toEqual([true, true, true, true, false, false, false])
    expect([0, 25, 26, 701].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'ZZ'])
  })
})
