/**
 * TipTap inline atom for a Zotero/source citation chip.
 *
 * The kernel owns only the document shape and host callback. Navigation and
 * source materialization remain shell responsibilities.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface CitationAttrs {
  /** Zotero-source artifact id in the graph, e.g. "zot-ABCD1234". */
  artifactId: string
  /** Zotero item key, used by the shell to resolve source detail. */
  zoteroKey: string
  /** Short formatted citation text displayed inside the chip. */
  citation: string
}

export type CitationClickHandler = (attrs: CitationAttrs) => void

export const OPEN_CITATION_PICKER_EVENT = 'open-citation-picker'

export interface CitationOptions {
  HTMLAttributes: Record<string, unknown>
  onCitationClick?: CitationClickHandler
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (attrs: CitationAttrs) => ReturnType
    }
  }
}

export function citationChipLabel(citation: string): string {
  const trimmed = citation.trim()
  if (!trimmed) return 'source'
  const yearEnd = trimmed.indexOf('). ')
  if (yearEnd > 0 && yearEnd <= 60) return trimmed.slice(0, yearEnd + 1)
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const Citation = Node.create<CitationOptions>({
  name: 'citation',

  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      HTMLAttributes: {},
      onCitationClick: undefined,
    }
  },

  addAttributes() {
    return {
      artifactId: {
        default: '',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-artifact-id') ?? element.getAttribute('artifactId') ?? '',
        renderHTML: (attrs: CitationAttrs) =>
          clean(attrs.artifactId) ? { 'data-artifact-id': clean(attrs.artifactId) } : {},
      },
      zoteroKey: {
        default: '',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-zotero-key') ?? element.getAttribute('zoteroKey') ?? '',
        renderHTML: (attrs: CitationAttrs) =>
          clean(attrs.zoteroKey) ? { 'data-zotero-key': clean(attrs.zoteroKey) } : {},
      },
      citation: {
        default: '',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-citation') ?? element.getAttribute('citation') ?? '',
        renderHTML: (attrs: CitationAttrs) =>
          clean(attrs.citation) ? { 'data-citation': clean(attrs.citation) } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-citation-chip]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'mn-citation-chip',
        'data-citation-chip': '',
        role: 'button',
        tabindex: '0',
        title: clean(HTMLAttributes['data-citation']) || 'source',
      }),
      citationChipLabel(clean(HTMLAttributes['data-citation'])),
    ]
  },

  addCommands() {
    return {
      insertCitation:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              artifactId: clean(attrs.artifactId),
              zoteroKey: clean(attrs.zoteroKey),
              citation: clean(attrs.citation),
            },
          }),
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-c': () => {
        document.dispatchEvent(new CustomEvent(OPEN_CITATION_PICKER_EVENT))
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const extension = this
    return [
      new Plugin({
        key: new PluginKey('citationInteraction'),
        props: {
          handleDOMEvents: {
            click: (view, event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
              const target = (event.target as HTMLElement | null)?.closest?.(
                '[data-citation-chip]',
              ) as HTMLElement | null
              if (!target || !view.dom.contains(target)) return false
              event.preventDefault()
              event.stopPropagation()
              extension.options.onCitationClick?.({
                artifactId: clean(target.getAttribute('data-artifact-id')),
                zoteroKey: clean(target.getAttribute('data-zotero-key')),
                citation: clean(target.getAttribute('data-citation')),
              })
              return true
            },
          },
        },
      }),
    ]
  },
})

export default Citation
