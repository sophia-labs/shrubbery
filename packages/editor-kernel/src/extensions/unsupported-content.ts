/**
 * Unsupported content — the editor's promise never to destroy what it cannot
 * render.
 *
 * WHY: the collaborative binding (@tiptap/y-tiptap, a y-prosemirror fork)
 * builds each ProseMirror node from the shared Y.Doc with
 * `schema.node(name, attrs, children)`. When that throws — an element name the
 * schema does not know (`bulletList`, `taskList`, `callout`, …), a known node
 * whose children violate its content expression (an `image` inside a
 * `paragraph`), or a text run carrying an unknown mark (`subscript`, `kbd`) —
 * upstream DELETES the Y item and the deletion syncs to the cell. Merely opening
 * a document written by an agent through MCP therefore erased content
 * (senderos, 2026-09-23: 21 evidence lists; investigated 2026-09-25).
 *
 * THE FIX has two halves:
 *   1. patches/@tiptap__y-tiptap@3.0.5.patch — instead of deleting, the binding
 *      asks the schema for these two types and renders a placeholder mapped to
 *      the ORIGINAL Y element, so the untouched Y element is never rewritten.
 *      A placeholder that ProseMirror re-creates (moved, copied) is written back
 *      as a clone of the original element, never as `unsupportedBlock`.
 *   2. The node + mark below. They are opt-in by presence: the patched binding
 *      only preserves when the schema defines them; without them it keeps the
 *      upstream behaviour.
 *
 * The placeholder is a read-only atom that shows what it holds (the element
 * name and its text) so a reader still sees the content. The user can delete
 * it deliberately; nothing else writes it.
 */

import { Mark, mergeAttributes, Node } from '@tiptap/core'

/** Node name the patched y-tiptap binding looks up for unrenderable elements. */
export const UNSUPPORTED_BLOCK_NODE = 'unsupportedBlock'
/** Mark name the patched y-tiptap binding looks up for unknown text formats. */
export const UNSUPPORTED_MARK = 'unsupportedMark'

/** `bulletList` → `bullet list`, `#text` → `text`: the placeholder's quiet label. */
export function humanizeNodeName(name: string): string {
  const words = name.replace(/^#/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim()
  return words ? words.toLowerCase() : 'content'
}

/**
 * The placeholder text keeps the original's line structure (the patched
 * binding writes one line per block child, list items marked `•`, `1.`, `☐`,
 * nested items indented by two spaces). One span per line, so a list reads
 * one item per line with a hanging indent.
 */
export function unsupportedTextLines(text: string): Array<[string, Record<string, string>, string]> {
  return text.split('\n').filter(line => line.trim().length > 0).map((line) => {
    const indent = line.length - line.trimStart().length
    const body = line.trimStart()
    const attrs: Record<string, string> = { class: 'unsupported-block-line' }
    if (indent > 0) attrs.style = `--unsupported-indent:${Math.floor(indent / 2)}`
    if (/^(?:•|☐|☑|\d+\.)\s/.test(body)) attrs['data-item'] = ''
    return ['span', attrs, body]
  })
}

export const UnsupportedBlock = Node.create({
  name: UNSUPPORTED_BLOCK_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  // Never produced by parsing pasted HTML: only the binding creates it.
  parseHTML: () => [],

  addAttributes() {
    return {
      // The original element name (e.g. `bulletList`).
      nodeName: { default: '', rendered: false },
      // Plain text of the original element, for display only.
      text: { default: '', rendered: false },
      // Binding-private identity token linking this placeholder to the
      // original Y element; lets the binding treat re-created placeholders as
      // the same element instead of rewriting them.
      yToken: { default: null, rendered: false },
    }
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-unsupported-node': node.attrs.nodeName,
        // An embed: the outliner's guide line stops at it.
        'data-block-embed': '',
        class: 'unsupported-block',
        contenteditable: 'false',
        title: `This ${node.attrs.nodeName} block cannot be edited here yet. It is kept unchanged.`,
      }),
      ['span', { class: 'unsupported-block-label' }, humanizeNodeName(String(node.attrs.nodeName ?? ''))],
      ['span', { class: 'unsupported-block-text' }, ...unsupportedTextLines(String(node.attrs.text ?? ''))],
    ]
  },

  renderText({ node }) {
    return node.attrs.text
  },
})

export const UnsupportedMark = Mark.create({
  name: UNSUPPORTED_MARK,
  // Several unknown formats may overlap on one run.
  excludes: '',
  inclusive: false,
  parseHTML: () => [],

  addAttributes() {
    return {
      // The original Y text attribute key and value, written back verbatim.
      name: { default: '', rendered: false },
      value: { default: null, rendered: false },
    }
  },

  renderHTML({ mark }) {
    return ['span', { 'data-unsupported-mark': mark.attrs.name }, 0]
  },
})

// ── opaqueBlock (gardend block contract v1, 2026-09-26) ─────────────────────
//
// gardend's block contract (garden feat/block-contract-normaliser, c60f057)
// stores a node it does not know as
//   { type: 'opaqueBlock', attrs: { originalType, originalJson, text,
//                                   contractVersion, data-block-id } }
// with `originalJson` the node's exact JSON, byte for byte. This node renders
// it — the type as a chip, the text, and the source on request — and never
// rewrites any of it. It is an atom with no children: the text lives in the
// `text` attribute (the binding's plain-text fallback reads it too).

/** Node name of the stored form gardend's block contract gives unknown content. */
export const OPAQUE_BLOCK_NODE = 'opaqueBlock'

/** `originalJson`, pretty-printed for reading; the stored string is never changed. */
export function prettyOriginalJson(originalJson: string): string {
  try {
    return JSON.stringify(JSON.parse(originalJson), null, 2)
  } catch {
    return originalJson
  }
}

type OpaqueAttrs = { originalType: string; originalJson: string; text: string; contractVersion: unknown }

function opaqueAttrs(attrs: Record<string, unknown>): OpaqueAttrs {
  return {
    originalType: String(attrs.originalType ?? ''),
    originalJson: String(attrs.originalJson ?? ''),
    text: String(attrs.text ?? ''),
    contractVersion: attrs.contractVersion ?? null,
  }
}

export const OpaqueBlock = Node.create({
  name: OPAQUE_BLOCK_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      // The unknown node's type (e.g. `callout`).
      originalType: { default: '', rendered: false },
      // Its exact JSON serialization, kept byte-exact. NEVER rewritten here.
      originalJson: { default: '', rendered: false },
      // Plain text, for display.
      text: { default: '', rendered: false },
      // The contract version that wrapped it (a number in the store).
      contractVersion: { default: null, rendered: false },
    }
  },

  // Only its OWN serialization parses back (cut/paste and drag inside the
  // editor round-trip through clipboard HTML); arbitrary pasted HTML never
  // becomes an opaqueBlock. The four attributes travel as one JSON value so
  // their types (contractVersion is a number) come back exactly.
  parseHTML() {
    return [{
      tag: 'div[data-opaque-block][data-opaque-attrs]',
      priority: 60,
      getAttrs: (element) => {
        try {
          const parsed = JSON.parse((element as HTMLElement).getAttribute('data-opaque-attrs') ?? '')
          return parsed && typeof parsed === 'object' ? opaqueAttrs(parsed as Record<string, unknown>) : false
        } catch {
          return false
        }
      },
    }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = opaqueAttrs(node.attrs)
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'opaque-block',
        'data-opaque-block': '',
        'data-opaque-type': attrs.originalType,
        'data-opaque-attrs': JSON.stringify(attrs),
        'data-block-embed': '',
        contenteditable: 'false',
      }),
      ['span', { class: 'opaque-block-type' }, attrs.originalType || 'block'],
      ['span', { class: 'opaque-block-text' }, ...unsupportedTextLines(attrs.text)],
    ]
  },

  renderText({ node }) {
    return String(node.attrs.text ?? '')
  },

  addNodeView() {
    return ({ node: initial, HTMLAttributes }) => {
      let node = initial
      const dom = document.createElement('div')
      dom.className = 'opaque-block'
      dom.setAttribute('data-opaque-block', '')
      dom.setAttribute('data-block-embed', '')
      dom.contentEditable = 'false'
      const head = document.createElement('div')
      head.className = 'opaque-block-head'
      const chip = document.createElement('span')
      chip.className = 'opaque-block-type'
      const note = document.createElement('span')
      note.className = 'opaque-block-note'
      note.textContent = 'kept as stored, read-only here'
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'opaque-block-source-toggle'
      toggle.textContent = 'view source'
      toggle.setAttribute('aria-expanded', 'false')
      head.append(chip, note, toggle)
      const text = document.createElement('div')
      text.className = 'opaque-block-text'
      const source = document.createElement('pre')
      source.className = 'opaque-block-source'
      source.hidden = true
      dom.append(head, text, source)

      const render = (): void => {
        const attrs = opaqueAttrs(node.attrs)
        const blockId = node.attrs['data-block-id'] ?? HTMLAttributes['data-block-id']
        if (blockId) dom.setAttribute('data-block-id', String(blockId))
        else dom.removeAttribute('data-block-id')
        dom.setAttribute('data-opaque-type', attrs.originalType)
        dom.title = `A ${attrs.originalType || 'block'} block this editor cannot edit. It is kept exactly as stored.`
        chip.textContent = attrs.originalType || 'block'
        text.replaceChildren(...unsupportedTextLines(attrs.text).map(([tag, lineAttrs, body]) => {
          const line = document.createElement(tag)
          for (const [key, value] of Object.entries(lineAttrs)) line.setAttribute(key, value)
          line.textContent = body
          return line
        }))
        text.hidden = text.childElementCount === 0
        if (!source.hidden) source.textContent = prettyOriginalJson(attrs.originalJson)
      }
      toggle.addEventListener('mousedown', event => event.preventDefault())
      toggle.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const open = source.hidden
        if (open) source.textContent = prettyOriginalJson(opaqueAttrs(node.attrs).originalJson)
        source.hidden = !open
        toggle.setAttribute('aria-expanded', String(open))
        toggle.textContent = open ? 'hide source' : 'view source'
      })
      render()
      return {
        dom,
        update(next) {
          if (next.type !== node.type) return false
          node = next
          render()
          return true
        },
        // Showing the source changes only this view's DOM, never the document.
        ignoreMutation: () => true,
        stopEvent: event => event.target instanceof globalThis.Node && (toggle === event.target || toggle.contains(event.target) || source.contains(event.target)),
      }
    }
  },
})
