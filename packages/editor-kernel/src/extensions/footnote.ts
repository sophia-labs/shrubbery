/**
 * TipTap Footnote Extension
 *
 * Inline atom node for scholarly footnote references. The content is stored in
 * the node attrs, so this extension stays pure: no stores, no dialogs, no
 * backend service. Hosts own acquisition/editing UI and call insertFootnote.
 */

import { InputRule, Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface FootnoteOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      /** Insert a footnote at the current cursor position. */
      insertFootnote: (options: { content: string }) => ReturnType
    }
  }
}

export const Footnote = Node.create<FootnoteOptions>({
  name: 'footnote',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      content: {
        default: '',
        parseHTML: (element) =>
          element.getAttribute('data-footnote-content') ||
          element.getAttribute('content') ||
          '',
        renderHTML: (attributes) => ({
          'data-footnote-content': attributes.content,
        }),
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'span[data-footnote]' },
      {
        tag: 'footnote',
        getAttrs: (element: HTMLElement) => ({
          content: element.getAttribute('data-footnote-content') || '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-footnote': '',
        class: 'footnote-ref',
        tabindex: '0',
        role: 'doc-noteref',
      }),
    ]
  },

  addCommands() {
    return {
      insertFootnote:
        (options) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { content: options.content },
          }),
    }
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\[\^([^\]]+)\]$/,
        handler: ({ state, range, match }) => {
          const content = match[1]
          if (!content) return
          const { tr } = state
          tr.delete(range.from, range.to)
          tr.insert(range.from, this.type.create({ content }))
        },
      }),
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('footnoteTooltip'),
        props: {
          handleDOMEvents: {
            mouseover: (_view, event) => {
              const target = event.target as HTMLElement
              if (target.classList.contains('footnote-ref')) {
                const content = target.getAttribute('data-footnote-content')
                if (content) target.setAttribute('title', content)
              }
              return false
            },
          },
        },
      }),
    ]
  },
})

export default Footnote
