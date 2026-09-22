/**
 * TipTap WikiLink Extension
 *
 * Provides Roam/Obsidian-style [[wiki-links]] for inline document references.
 * Links can target entire documents or specific blocks within documents.
 *
 * Usage:
 *   editor.commands.insertWikiLink({
 *     targetDocId: 'doc-123',
 *     label: 'My Document',
 *     wireId: 'wire-abc',
 *   })
 *
 * Renders as: [[My Document]] or [[My Document > Block preview...]]
 *
 * Features:
 * - Inline atomic node (can't place cursor inside)
 * - Click navigates to target document/block
 * - Hover shows preview tooltip
 * - Stores wireId for automatic cleanup on deletion
 */

import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { OPEN_WIKILINK_PICKER_EVENT } from './wikilink-autocomplete'

export interface WikiLinkOptions {
  HTMLAttributes: Record<string, unknown>
  /** Host-owned explicit picker intent (Mod/Ctrl-Shift-K). */
  onOpenPicker?: () => void
  /**
   * Preserve the historical ownerDocument CustomEvent when no callback is
   * supplied. Composer profiles disable this; direct/document use stays true.
   */
  emitLegacyPickerEvents: boolean
  /** Called when a wikilink is clicked */
  onWikiLinkClick?: (attrs: WikiLinkAttrs) => void
  /** Called when a wikilink is deleted */
  onWikiLinkDelete?: (attrs: WikiLinkAttrs) => void
}

export interface WikiLinkAttrs {
  /** Target document ID (required) */
  targetDocId: string
  /** Optional target block ID for block-level links */
  targetBlockId?: string | null
  /** Target graph ID (default: current graph) */
  targetGraphId?: string | null
  /** Display label (document title) */
  label: string
  /** Block text preview for block-level links (~50 chars) */
  blockPreview?: string | null
  /** Wire ID for cleanup on deletion */
  wireId?: string | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikilink: {
      /**
       * Insert a wikilink at the current cursor position
       */
      insertWikiLink: (attrs: WikiLinkAttrs) => ReturnType
    }
  }
}

export const WikiLink = Node.create<WikiLinkOptions>({
  name: 'wikilink',

  addOptions() {
    return {
      HTMLAttributes: {},
      onOpenPicker: undefined,
      emitLegacyPickerEvents: true,
      onWikiLinkClick: undefined,
      onWikiLinkDelete: undefined,
    }
  },

  // Inline node that acts as a single unit
  group: 'inline',
  inline: true,
  atom: true, // Can't place cursor inside

  addAttributes() {
    return {
      targetDocId: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-target-doc-id') ||
          element.getAttribute('targetDocId') ||
          null,
        renderHTML: (attributes) => ({
          'data-target-doc-id': attributes.targetDocId,
        }),
      },
      targetBlockId: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-target-block-id') ||
          element.getAttribute('targetBlockId') ||
          null,
        renderHTML: (attributes) =>
          attributes.targetBlockId
            ? { 'data-target-block-id': attributes.targetBlockId }
            : {},
      },
      targetGraphId: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-target-graph-id') ||
          element.getAttribute('targetGraphId') ||
          null,
        renderHTML: (attributes) =>
          attributes.targetGraphId
            ? { 'data-target-graph-id': attributes.targetGraphId }
            : {},
      },
      label: {
        default: 'Untitled',
        parseHTML: (element) =>
          element.getAttribute('data-label') ||
          element.getAttribute('label') ||
          element.textContent?.replace(/^\[\[|\]\]$/g, '') ||
          'Untitled',
        renderHTML: (attributes) => ({
          'data-label': attributes.label,
        }),
      },
      blockPreview: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-block-preview') ||
          element.getAttribute('blockPreview') ||
          null,
        renderHTML: (attributes) =>
          attributes.blockPreview
            ? { 'data-block-preview': attributes.blockPreview }
            : {},
      },
      wireId: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-wire-id') ||
          element.getAttribute('wireId') ||
          null,
        renderHTML: (attributes) =>
          attributes.wireId ? { 'data-wire-id': attributes.wireId } : {},
      },
    }
  },

  parseHTML() {
    return [
      {
        // Frontend renders as span.wikilink
        tag: 'span.wikilink',
      },
      {
        // Backend/MCP sends as <wikilink> element
        tag: 'wikilink',
        getAttrs: (element: HTMLElement) => ({
          targetDocId: element.getAttribute('data-target-doc-id'),
          targetBlockId: element.getAttribute('data-target-block-id'),
          targetGraphId: element.getAttribute('data-target-graph-id'),
          label: element.getAttribute('data-label') || element.textContent,
          blockPreview: element.getAttribute('data-block-preview'),
          wireId: element.getAttribute('data-wire-id'),
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const label = HTMLAttributes['data-label'] || 'Untitled'
    const blockPreview = HTMLAttributes['data-block-preview']
    const hasBlock = !!HTMLAttributes['data-target-block-id']

    // Format: [[Doc]] or [[>>Block preview...]]
    let displayText = `[[${label}]]`
    if (hasBlock && blockPreview) {
      const truncatedPreview =
        blockPreview.length > 30 ? blockPreview.slice(0, 30) + '...' : blockPreview
      displayText = `[[>>${truncatedPreview}]]`
    }

    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: `wikilink ${hasBlock ? 'wikilink-block' : ''}`,
        tabindex: '0',
        role: 'link',
      }),
      displayText,
    ]
  },

  /** Canonical plain-text form used by getText/clipboard/chat serialization. */
  renderText({ node }) {
    const label = String(node.attrs.label ?? 'Untitled')
    return `[[${label}]]`
  },

  addCommands() {
    return {
      insertWikiLink:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              targetDocId: attrs.targetDocId,
              targetBlockId: attrs.targetBlockId || null,
              targetGraphId: attrs.targetGraphId || null,
              label: attrs.label,
              blockPreview: attrs.blockPreview || null,
              wireId: attrs.wireId || null,
            },
          })
        },
    }
  },

  // Add keyboard handling
  addKeyboardShortcuts() {
    return {
      // Cmd/Ctrl + Shift + K to insert wikilink (opens picker)
      'Mod-Shift-k': () => {
        if (this.options.onOpenPicker) {
          this.options.onOpenPicker()
        } else if (this.options.emitLegacyPickerEvents) {
          // Backward-compatible document-editor seam, scoped to this editor's
          // owner document rather than the ambient global document.
          this.editor.view.dom.ownerDocument.dispatchEvent(
            new CustomEvent(OPEN_WIKILINK_PICKER_EVENT),
          )
        }
        return true
      },
    }
  },

  // Plugin to handle click navigation and hover tooltips
  addProseMirrorPlugins() {
    const extension = this

    return [
      new Plugin({
        key: new PluginKey('wikilinkInteraction'),
        props: {
          handleDOMEvents: {
            // Handle clicks on wikilinks
            click: (_view, event) => {
              const target = event.target as HTMLElement
              if (target.classList.contains('wikilink')) {
                event.preventDefault()
                event.stopPropagation()

                const attrs: WikiLinkAttrs = {
                  targetDocId: target.getAttribute('data-target-doc-id') || '',
                  targetBlockId: target.getAttribute('data-target-block-id'),
                  targetGraphId: target.getAttribute('data-target-graph-id'),
                  label: target.getAttribute('data-label') || '',
                  blockPreview: target.getAttribute('data-block-preview'),
                  wireId: target.getAttribute('data-wire-id'),
                }

                extension.options.onWikiLinkClick?.(attrs)
                return true
              }
              return false
            },

            // Show tooltip on hover
            mouseover: (_view, event) => {
              const target = event.target as HTMLElement
              if (target.classList.contains('wikilink')) {
                const label = target.getAttribute('data-label') || 'Untitled'
                const blockPreview = target.getAttribute('data-block-preview')
                const tooltip = blockPreview
                  ? `${label}\n\n${blockPreview}`
                  : `Open: ${label}`
                target.setAttribute('title', tooltip)
              }
              return false
            },
          },
        },
      }),
    ]
  },
})

/**
 * CSS styles for wikilinks - include in your component styles
 */
export const wikilinkStyles = `
  .wikilink {
    color: var(--mn-color-text-accent);
    text-decoration: underline;
    text-decoration-style: dotted;
    text-decoration-color: var(--mn-color-text-accent);
    cursor: pointer;
    border-radius: 2px;
    padding: 0 2px;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .wikilink:hover {
    background: var(--mn-color-surface-accent);
    text-decoration-style: solid;
    text-decoration-color: var(--mn-color-text-accent);
  }

  .wikilink:focus {
    outline: 2px solid var(--mn-color-border-focus);
    outline-offset: 1px;
  }

  /* Block-level wikilink styling */
  .wikilink-block {
    font-style: italic;
  }

  /* Selection state */
  .wikilink.ProseMirror-selectednode {
    background: var(--mn-color-surface-accent);
    outline: 2px solid var(--mn-color-border-accent);
  }
`

export default WikiLink
