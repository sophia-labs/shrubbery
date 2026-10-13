/**
 * Reading code: syntax colour and line numbers as ProseMirror decorations over ordinary `codeBlock` nodes.
 *
 * The kernel stays free of grammars: the HOST supplies `highlight(code, language)` (the Files reader lazy-loads one), and
 * this plugin turns its ranges into inline decorations (`class="hljs-keyword"` …). Line numbers are one widget at the
 * start of each block: a column of numbers the stylesheet places in the gutter, never part of the text (copying the code
 * copies the code).
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface CodeHighlightRange {
  /** Offsets into the block's text. */
  readonly from: number
  readonly to: number
  readonly className: string
}

export type CodeHighlighter = (code: string, language: string | null) => readonly CodeHighlightRange[] | null

export interface CodeViewOptions {
  highlight: CodeHighlighter | null
  lineNumbers: boolean
  /** Blocks longer than this are shown without colour (default 512 KB of text). */
  maxHighlightChars: number
}

export const codeViewKey = new PluginKey<DecorationSet>('hojaCodeView')

function lineCount(text: string): number {
  let n = 1
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++
  // A trailing newline does not open a line the reader sees.
  return text.endsWith('\n') && n > 1 ? n - 1 : n
}

function gutter(lines: number): HTMLElement {
  const el = document.createElement('span')
  el.className = 'hoja-line-numbers'
  el.setAttribute('aria-hidden', 'true')
  el.setAttribute('contenteditable', 'false')
  el.style.setProperty('--hoja-ln-digits', String(String(lines).length))
  const out: string[] = new Array(lines)
  for (let i = 0; i < lines; i++) out[i] = String(i + 1)
  el.textContent = out.join('\n')
  return el
}

function decorate(doc: ProseMirrorNode, options: CodeViewOptions): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true
    const text = node.textContent
    const start = pos + 1
    if (options.lineNumbers) {
      const lines = lineCount(text)
      decorations.push(Decoration.widget(start, () => gutter(lines), { side: -1, key: `ln-${lines}`, ignoreSelection: true }))
    }
    if (options.highlight && text.length <= options.maxHighlightChars) {
      const language = typeof node.attrs.language === 'string' && node.attrs.language ? node.attrs.language : null
      let ranges: readonly CodeHighlightRange[] | null = null
      try { ranges = options.highlight(text, language) } catch { ranges = null }
      for (const r of ranges ?? []) {
        if (r.to > r.from && r.from >= 0 && r.to <= text.length) decorations.push(Decoration.inline(start + r.from, start + r.to, { class: r.className }))
      }
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

export const CodeView = Extension.create<CodeViewOptions>({
  name: 'hojaCodeView',

  addOptions() {
    return { highlight: null, lineNumbers: false, maxHighlightChars: 512 * 1024 }
  },

  addProseMirrorPlugins() {
    const options = this.options
    return [new Plugin<DecorationSet>({
      key: codeViewKey,
      state: {
        init: (_, state) => decorate(state.doc, options),
        apply: (tr, set) => (tr.docChanged ? decorate(tr.doc, options) : set.map(tr.mapping, tr.doc)),
      },
      props: { decorations: state => codeViewKey.getState(state) },
    })]
  },
})
