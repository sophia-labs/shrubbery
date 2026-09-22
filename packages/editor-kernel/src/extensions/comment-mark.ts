/**
 * TipTap CommentMark Extension
 *
 * Provides inline comment marks that highlight text and reference external comment data.
 * Unlike footnotes (self-contained nodes), comments are marks that wrap text ranges
 * and store an ID referencing externally stored comment content.
 *
 * Usage:
 *   editor.commands.setComment({ commentId: 'c-123' })
 *   editor.commands.unsetComment()
 *
 * Renders as: highlighted text with comment indicator
 *
 * Architecture:
 * - Mark stores only `commentId` (data-comment-id attribute)
 * - Comment content (text, author, date) stored in external state (Y.Map or store)
 * - This decouples the document structure from comment metadata
 *
 * PROVENANCE: ported VERBATIM from garden-convergence
 * frontend/src/lib/tiptap-comment.ts. This file already depends ONLY on
 * @tiptap/core (no yjs / store / fetcher / UI coupling) — nothing severed.
 */

import { Mark, mergeAttributes } from '@tiptap/core'

export interface CommentOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentMark: {
      /**
       * Set a comment mark on the current selection
       */
      setComment: (options: { commentId: string }) => ReturnType
      /**
       * Remove comment mark from the current selection
       */
      unsetComment: () => ReturnType
      /**
       * Toggle comment mark on the current selection
       */
      toggleComment: (options: { commentId: string }) => ReturnType
    }
  }
}

export const CommentMark = Mark.create<CommentOptions>({
  name: 'commentMark',

  // Don't persist across Enter key (new paragraphs shouldn't inherit comment)
  keepOnSplit: false,

  // Allow comment marks to coexist with other marks (bold, italic, etc.)
  inclusive: false,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      // The comment ID links to external comment data
      // MCP backend reads/writes as data-comment-id
      // TipTap internal state uses commentId
      commentId: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-comment-id') ||
          element.getAttribute('commentId'),
        renderHTML: (attributes) => {
          if (!attributes.commentId) return {}
          return {
            'data-comment-id': attributes.commentId,
          }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        // Frontend renders as span[data-comment-id]
        tag: 'span[data-comment-id]',
      },
      {
        // Backend/MCP may send as <commentMark> element
        tag: 'commentMark',
        getAttrs: (element: HTMLElement) => ({
          commentId: element.getAttribute('data-comment-id') || '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        {
          class: 'comment-mark',
        }
      ),
      0, // Content placeholder - marks wrap their content
    ]
  },

  addCommands() {
    return {
      setComment:
        (options) =>
        ({ commands }) => {
          return commands.setMark(this.name, options)
        },
      unsetComment:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },
      toggleComment:
        (options) =>
        ({ commands }) => {
          return commands.toggleMark(this.name, options)
        },
    }
  },

})

/**
 * CSS styles for comments - include in your component styles
 *
 * Comments use a warm yellow highlight (Google Docs style) to distinguish
 * from the purple/violet highlight mark.
 */
export const commentStyles = `
  /* Comment highlight base styles */
  .comment-mark {
    background-color: var(--mn-color-comment-bg);
    border-bottom: 2px solid var(--mn-color-comment-border);
    cursor: pointer;
    transition: background-color 0.15s ease;
    border-radius: 2px;
    padding: 0 1px;
  }

  .comment-mark:hover {
    background-color: var(--mn-color-comment-bg-hover);
  }

  /* Active/selected comment */
  .comment-mark.active,
  .comment-mark[data-active="true"] {
    background-color: var(--mn-color-comment-bg-active);
    border-bottom-color: var(--mn-color-comment-border-active);
  }

  /* Comment indicator icon (optional - can be added via ::after) */
  .comment-mark::after {
    content: '';
    /* Uncomment to show comment icon
    content: '💬';
    font-size: 0.7em;
    vertical-align: super;
    margin-left: 2px;
    opacity: 0.6;
    */
  }
`

export default CommentMark
