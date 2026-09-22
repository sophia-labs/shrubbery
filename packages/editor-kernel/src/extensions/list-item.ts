/**
 * TipTap Flat List Item Extension
 *
 * A custom list item node that exists at the document root level (not nested
 * inside bulletList/orderedList containers). This enables the Outliner model
 * where hierarchy is expressed via data-indent attributes, not DOM nesting.
 *
 * Attributes:
 * - listType: 'bullet' | 'ordered' | 'task' - determines visual rendering
 * - indent: 0-6 - hierarchy level (managed by Outliner extension)
 * - checked: boolean - for task items
 *
 * Visual rendering is handled by CSS based on these attributes.
 * Tab/Shift-Tab indentation is handled by the Outliner extension.
 */

import { InputRule, Node, mergeAttributes } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Selection } from '@tiptap/pm/state'
import type { NodeView as PMNodeView } from '@tiptap/pm/view'
import { getOutlinerBlocks, getSubtreeRange, isCollapsed } from '../outliner-tree'

export interface ListItemOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    listItem: {
      /**
       * Toggle a bullet list item
       */
      toggleBulletItem: () => ReturnType
      /**
       * Toggle an ordered list item
       */
      toggleOrderedItem: () => ReturnType
      /**
       * Toggle a task item
       */
      toggleTaskItem: () => ReturnType
      /**
       * Set the list type of current item
       */
      setListType: (listType: 'bullet' | 'ordered' | 'task') => ReturnType
      /**
       * Toggle the checked state of a task item
       */
      toggleChecked: () => ReturnType
    }
  }
}

export const ListItem = Node.create<ListItemOptions>({
  name: 'listItem',

  group: 'block',

  // Rich content: paragraphs, headings, code blocks, blockquotes
  // Explicitly excludes listItem to prevent structural nesting
  // (nesting is via indent attribute, not DOM structure)
  content: '(paragraph | heading | codeBlock | blockquote)+',

  // Keeps node identity when content changes
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      listType: {
        default: 'bullet',
        parseHTML: (element) => {
          // Check data attribute first
          const dataType = element.getAttribute('data-list-type')
          if (dataType) return dataType

          // Infer from parent for legacy nested lists
          const parent = element.parentElement
          if (parent?.tagName === 'OL') return 'ordered'
          if (parent?.getAttribute('data-type') === 'taskList') return 'task'
          return 'bullet'
        },
        renderHTML: (attributes) => ({
          'data-list-type': attributes.listType,
        }),
      },
      indent: {
        default: 0,
        parseHTML: (element) => {
          const indent = element.getAttribute('data-indent')
          return indent ? parseInt(indent, 10) : 0
        },
        renderHTML: (attributes) => {
          if (!attributes.indent || attributes.indent <= 0) return {}
          return { 'data-indent': attributes.indent }
        },
      },
      checked: {
        default: false,
        parseHTML: (element) => {
          return element.getAttribute('data-checked') === 'true'
        },
        renderHTML: (attributes) => {
          if (!attributes.checked) return {}
          return { 'data-checked': 'true' }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'li',
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)

    // For task items, render with checkbox
    if (node.attrs.listType === 'task') {
      return [
        'li',
        attrs,
        [
          'label',
          { contenteditable: 'false' },
          [
            'input',
            {
              type: 'checkbox',
              checked: node.attrs.checked ? 'checked' : null,
            },
          ],
        ],
        ['div', { class: 'list-item-content' }, 0],
      ]
    }

    // For bullet/ordered items, content is direct child
    return ['li', attrs, 0]
  },

  addCommands() {
    return {
      toggleBulletItem:
        () =>
        ({ commands, state, tr }) => {
          const { $from, $to, empty } = state.selection

          if (!empty) {
            // Multi-block selection: collect all paragraphs and listItems in range.
            // Headings are skipped — they don't become list items.
            const blocks: Array<{ pos: number; node: ProseMirrorNode }> = []
            state.doc.nodesBetween($from.pos, $to.pos, (node, pos, parent) => {
              if (parent === state.doc && (
                node.type.name === 'paragraph' || node.type.name === 'listItem'
              )) {
                blocks.push({ pos, node })
                return false
              }
              return true
            })
            if (blocks.length === 0) return false

            // If ALL selected blocks are already bullet items → unwrap all.
            // Otherwise → convert all to bullet (switching type or wrapping paragraph).
            const allBullet = blocks.every(
              b => b.node.type.name === 'listItem' && b.node.attrs.listType === 'bullet'
            )

            // Process in reverse order so structural changes (replaceWith) don't
            // shift positions of blocks earlier in the document.
            for (let i = blocks.length - 1; i >= 0; i--) {
              const { pos, node } = blocks[i]
              if (allBullet) {
                // Unwrap to ALL child blocks (paragraph + any code block /
                // blockquote / heading), not just the first, so multi-block
                // content is not lost.
                if (node.content.size > 0) tr.replaceWith(pos, pos + node.nodeSize, node.content)
              } else if (node.type.name === 'listItem') {
                // Already a list item — just switch the type
                tr.setNodeMarkup(pos, null, { ...node.attrs, listType: 'bullet' })
              } else {
                // Wrap paragraph in a bullet listItem
                const listItemNode = state.schema.nodes.listItem.create(
                  { listType: 'bullet', indent: 0 },
                  node
                )
                tr.replaceWith(pos, pos + node.nodeSize, listItemNode)
              }
            }
            return true
          }

          // Single cursor: existing single-block behavior
          for (let depth = $from.depth; depth >= 1; depth--) {
            const node = $from.node(depth)
            const parentNode = depth > 1 ? $from.node(depth - 1) : state.doc

            if (node.type.name === 'listItem') {
              if (node.attrs.listType === 'bullet') {
                const listItemPos = $from.before(depth)
                const listItemNode = state.doc.nodeAt(listItemPos)
                if (listItemNode && listItemNode.content.size > 0) {
                  // Unwrap to ALL child blocks, preserving multi-block content.
                  tr.replaceWith(listItemPos, listItemPos + listItemNode.nodeSize, listItemNode.content)
                  tr.setSelection(Selection.near(tr.doc.resolve(listItemPos + 1)))
                  return true
                }
                return false
              }
              return commands.updateAttributes('listItem', { listType: 'bullet' })
            }

            if (node.type.name === 'paragraph' && parentNode.type.name === 'doc') {
              const paragraphPos = $from.before(depth)
              const listItemNode = state.schema.nodes.listItem.create(
                { listType: 'bullet', indent: 0 },
                node
              )
              tr.replaceWith(paragraphPos, paragraphPos + node.nodeSize, listItemNode)
              tr.setSelection(Selection.near(tr.doc.resolve(paragraphPos + 2)))
              return true
            }
          }

          return false
        },

      toggleOrderedItem:
        () =>
        ({ commands, state, tr }) => {
          const { $from, $to, empty } = state.selection

          if (!empty) {
            const blocks: Array<{ pos: number; node: ProseMirrorNode }> = []
            state.doc.nodesBetween($from.pos, $to.pos, (node, pos, parent) => {
              if (parent === state.doc && (
                node.type.name === 'paragraph' || node.type.name === 'listItem'
              )) {
                blocks.push({ pos, node })
                return false
              }
              return true
            })
            if (blocks.length === 0) return false

            const allOrdered = blocks.every(
              b => b.node.type.name === 'listItem' && b.node.attrs.listType === 'ordered'
            )

            for (let i = blocks.length - 1; i >= 0; i--) {
              const { pos, node } = blocks[i]
              if (allOrdered) {
                // Unwrap to ALL child blocks, preserving multi-block content.
                if (node.content.size > 0) tr.replaceWith(pos, pos + node.nodeSize, node.content)
              } else if (node.type.name === 'listItem') {
                tr.setNodeMarkup(pos, null, { ...node.attrs, listType: 'ordered' })
              } else {
                const listItemNode = state.schema.nodes.listItem.create(
                  { listType: 'ordered', indent: 0 },
                  node
                )
                tr.replaceWith(pos, pos + node.nodeSize, listItemNode)
              }
            }
            return true
          }

          // Single cursor: existing single-block behavior
          for (let depth = $from.depth; depth >= 1; depth--) {
            const node = $from.node(depth)
            const parentNode = depth > 1 ? $from.node(depth - 1) : state.doc

            if (node.type.name === 'listItem') {
              if (node.attrs.listType === 'ordered') {
                const listItemPos = $from.before(depth)
                const listItemNode = state.doc.nodeAt(listItemPos)
                if (listItemNode && listItemNode.content.size > 0) {
                  // Unwrap to ALL child blocks, preserving multi-block content.
                  tr.replaceWith(listItemPos, listItemPos + listItemNode.nodeSize, listItemNode.content)
                  tr.setSelection(Selection.near(tr.doc.resolve(listItemPos + 1)))
                  return true
                }
                return false
              }
              return commands.updateAttributes('listItem', { listType: 'ordered' })
            }

            if (node.type.name === 'paragraph' && parentNode.type.name === 'doc') {
              const paragraphPos = $from.before(depth)
              const listItemNode = state.schema.nodes.listItem.create(
                { listType: 'ordered', indent: 0 },
                node
              )
              tr.replaceWith(paragraphPos, paragraphPos + node.nodeSize, listItemNode)
              tr.setSelection(Selection.near(tr.doc.resolve(paragraphPos + 2)))
              return true
            }
          }

          return false
        },

      toggleTaskItem:
        () =>
        ({ commands, state, tr }) => {
          const { $from, $to, empty } = state.selection

          if (!empty) {
            const blocks: Array<{ pos: number; node: ProseMirrorNode }> = []
            state.doc.nodesBetween($from.pos, $to.pos, (node, pos, parent) => {
              if (parent === state.doc && (
                node.type.name === 'paragraph' || node.type.name === 'listItem'
              )) {
                blocks.push({ pos, node })
                return false
              }
              return true
            })
            if (blocks.length === 0) return false

            const allTask = blocks.every(
              b => b.node.type.name === 'listItem' && b.node.attrs.listType === 'task'
            )

            for (let i = blocks.length - 1; i >= 0; i--) {
              const { pos, node } = blocks[i]
              if (allTask) {
                // Unwrap to ALL child blocks, preserving multi-block content.
                if (node.content.size > 0) tr.replaceWith(pos, pos + node.nodeSize, node.content)
              } else if (node.type.name === 'listItem') {
                tr.setNodeMarkup(pos, null, { ...node.attrs, listType: 'task', checked: false })
              } else {
                const listItemNode = state.schema.nodes.listItem.create(
                  { listType: 'task', indent: 0, checked: false },
                  node
                )
                tr.replaceWith(pos, pos + node.nodeSize, listItemNode)
              }
            }
            return true
          }

          // Single cursor: existing single-block behavior
          for (let depth = $from.depth; depth >= 1; depth--) {
            const node = $from.node(depth)
            const parentNode = depth > 1 ? $from.node(depth - 1) : state.doc

            if (node.type.name === 'listItem') {
              if (node.attrs.listType === 'task') {
                const listItemPos = $from.before(depth)
                const listItemNode = state.doc.nodeAt(listItemPos)
                if (listItemNode && listItemNode.content.size > 0) {
                  // Unwrap to ALL child blocks, preserving multi-block content.
                  tr.replaceWith(listItemPos, listItemPos + listItemNode.nodeSize, listItemNode.content)
                  tr.setSelection(Selection.near(tr.doc.resolve(listItemPos + 1)))
                  return true
                }
                return false
              }
              return commands.updateAttributes('listItem', { listType: 'task', checked: false })
            }

            if (node.type.name === 'paragraph' && parentNode.type.name === 'doc') {
              const paragraphPos = $from.before(depth)
              const listItemNode = state.schema.nodes.listItem.create(
                { listType: 'task', indent: 0, checked: false },
                node
              )
              tr.replaceWith(paragraphPos, paragraphPos + node.nodeSize, listItemNode)
              tr.setSelection(Selection.near(tr.doc.resolve(paragraphPos + 2)))
              return true
            }
          }

          return false
        },

      setListType:
        (listType) =>
        ({ commands }) => {
          return commands.updateAttributes('listItem', { listType })
        },

      toggleChecked:
        () =>
        ({ commands, state }) => {
          const { $from } = state.selection
          const node = $from.node($from.depth)

          if (node.type.name === 'listItem' && node.attrs.listType === 'task') {
            return commands.updateAttributes('listItem', { checked: !node.attrs.checked })
          }

          return false
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      // Enter: Create new list item with same type and indent
      Enter: ({ editor }) => {
        if (!editor.isActive('listItem')) {
          return false
        }

        const { state } = editor
        const { $from, $to: _$to } = state.selection

        // Find the listItem
        let listItemDepth = -1
        for (let d = $from.depth; d >= 1; d--) {
          if ($from.node(d).type.name === 'listItem') {
            listItemDepth = d
            break
          }
        }
        if (listItemDepth === -1) return false

        const listItem = $from.node(listItemDepth)
        const { listType, indent } = listItem.attrs

        // If list item is empty, convert to paragraph
        if (listItem.textContent.trim() === '') {
          // Use the appropriate toggle based on current type
          if (listType === 'bullet') return editor.commands.toggleBulletItem()
          if (listType === 'ordered') return editor.commands.toggleOrderedItem()
          if (listType === 'task') return editor.commands.toggleTaskItem()
          return false
        }

        // Get content after cursor to move to new list item
        const listItemEnd = $from.after(listItemDepth)

        // Find the paragraph within the list item
        let paragraphDepth = -1
        for (let d = $from.depth; d > listItemDepth; d--) {
          if ($from.node(d).type.name === 'paragraph') {
            paragraphDepth = d
            break
          }
        }
        if (paragraphDepth === -1) return false

        const paragraphEnd = $from.end(paragraphDepth)

        // Capture the inline content after the cursor as a FRAGMENT (not text),
        // so marks and inline atoms are carried into the new list item rather
        // than flattened to plain text or dropped.
        const paragraphStartPos = $from.start(paragraphDepth)
        const fragmentAfter = $from.node(paragraphDepth).content.cut($from.pos - paragraphStartPos)

        // Build transaction
        const tr = state.tr

        // Delete the content after the cursor in the current paragraph; it moves
        // to the new list item.
        if ($from.pos < paragraphEnd) {
          tr.delete($from.pos, paragraphEnd)
        }

        // Create new list item carrying the preserved fragment.
        const newParagraph = state.schema.nodes.paragraph.create(
          null,
          fragmentAfter.size > 0 ? fragmentAfter : null
        )
        const newListItem = state.schema.nodes.listItem.create(
          { listType, indent, checked: false },
          newParagraph
        )

        // Insert after current list item (position adjusted for deletion)
        const deleteLength = paragraphEnd - $from.pos
        let insertPos = listItemEnd - deleteLength

        // If the item is collapsed, its descendants are hidden from layout. A
        // new same-indent sibling must land after the whole hidden subtree.
        if (isCollapsed(listItem)) {
          const listItemPos = $from.before(listItemDepth)
          const blocks = getOutlinerBlocks(state.doc)
          const index = blocks.findIndex((block) => block.pos === listItemPos)
          if (index !== -1) {
            const { to } = getSubtreeRange(blocks, index)
            if (to > listItemEnd) insertPos = to - deleteLength
          }
        }
        tr.insert(insertPos, newListItem)

        // Move cursor to start of new list item's paragraph
        const newCursorPos = insertPos + 2 // +1 listItem open, +1 paragraph open
        tr.setSelection(Selection.near(tr.doc.resolve(newCursorPos)))

        editor.view.dispatch(tr)
        return true
      },

      // Shift+Enter: Insert soft line break (hard break) within the list item
      'Shift-Enter': ({ editor }) => {
        // Check if we're in a listItem
        if (!editor.isActive('listItem')) {
          return false
        }
        // Insert a hard break instead of splitting the block
        return editor.commands.setHardBreak()
      },

      // Backspace: handle list item unwrap AND joining paragraph into list item above
      Backspace: ({ editor }) => {
        const { state } = editor
        const { $from, empty } = state.selection

        if (!empty) return false

        // Case 1: Cursor at start of a paragraph that follows a listItem
        // (backspacing INTO a list item from below)
        for (let depth = $from.depth; depth >= 1; depth--) {
          const node = $from.node(depth)
          const parent = depth > 1 ? $from.node(depth - 1) : state.doc

          if (node.type.name === 'paragraph' && parent.type.name === 'doc') {
            // Check if we're at the very start of this paragraph
            const paragraphStart = $from.before(depth)
            if ($from.pos !== paragraphStart + 1) continue // Not at start

            // Check if previous sibling is a listItem
            const $paragraphStart = state.doc.resolve(paragraphStart)
            if ($paragraphStart.nodeBefore?.type.name === 'listItem') {
              const listItem = $paragraphStart.nodeBefore
              const listItemPos = paragraphStart - listItem.nodeSize
              const paragraphContent = node.content

              // Append paragraph content to listItem's last child (paragraph)
              const listItemLastChild = listItem.lastChild
              if (listItemLastChild && listItemLastChild.type.name === 'paragraph') {
                const tr = state.tr
                const lastParaEndPos = listItemPos + listItem.nodeSize - 2 // Position at end of text in last para

                // Delete the paragraph we're in
                tr.delete(paragraphStart, paragraphStart + node.nodeSize)

                // Append content to end of listItem's last paragraph
                if (paragraphContent.size > 0) {
                  tr.insert(lastParaEndPos, paragraphContent)
                }

                // Set cursor at join point
                tr.setSelection(Selection.near(tr.doc.resolve(lastParaEndPos)))

                editor.view.dispatch(tr)
                return true
              }
            }
            break
          }
        }

        // Case 2: Cursor inside a listItem at start - unwrap or decrease indent
        let listItemDepth = -1
        for (let d = $from.depth; d >= 1; d--) {
          if ($from.node(d).type.name === 'listItem') {
            listItemDepth = d
            break
          }
        }

        if (listItemDepth === -1) return false

        const listItem = $from.node(listItemDepth)
        const indent = listItem.attrs.indent || 0

        // Check if cursor is at start of content
        const listItemStart = $from.before(listItemDepth)
        const contentStart = listItemStart + 1 // After the listItem opening
        const paragraphStart = contentStart + 1 // After the paragraph opening
        const isAtStart = $from.pos === paragraphStart

        if (!isAtStart) return false

        // If indented, decrease indent first
        if (indent > 0) {
          return editor.commands.decreaseIndent()
        }

        // At indent 0: if the listItem is empty, delete it and join cursor with
        // the previous block instead of converting it to an empty paragraph.
        // Without this, Enter → Backspace on an empty listItem produces a phantom
        // blank paragraph (<p></p>) that looks like whitespace but has no content.
        if (listItem.textContent === '') {
          const $listItemStart = state.doc.resolve(listItemStart)
          if ($listItemStart.nodeBefore) {
            const tr = state.tr
            tr.delete(listItemStart, listItemStart + listItem.nodeSize)
            tr.setSelection(Selection.near(tr.doc.resolve(listItemStart - 1), -1))
            editor.view.dispatch(tr)
            return true
          }
        }

        // At indent 0, convert to paragraph - use toggle command to unwrap
        return editor.commands.toggleBulletItem() ||
               editor.commands.toggleOrderedItem() ||
               editor.commands.toggleTaskItem()
      },
    }
  },

  addInputRules() {
    /**
     * Shared handler: wraps a paragraph in a listItem with the given attrs.
     * setNodeMarkup doesn't work here because listItem expects block children
     * (paragraph/heading/etc.), not inline text. We must wrap the paragraph
     * inside a new listItem — same approach as the toggle commands.
     */
    const wrapInListItem = (
      state: { doc: any; schema: any; selection: any },
      range: { from: number; to: number },
      attrs: Record<string, unknown>,
      listItemType: typeof this.type,
    ) => {
      const { tr } = state as any
      const $from = state.doc.resolve(range.from)

      if ($from.parent.type.name !== 'paragraph') return null
      if ($from.parentOffset !== 0) return null

      const paragraph = $from.parent
      const triggerLength = range.to - range.from
      const remainingContent = paragraph.content.cut(triggerLength)

      // Build: listItem > paragraph(remaining content)
      const newParagraph = state.schema.nodes.paragraph.create(null, remainingContent.size > 0 ? remainingContent : undefined)
      const listItemNode = listItemType.create(attrs, newParagraph)

      const paragraphPos = $from.before()
      tr.replaceWith(paragraphPos, paragraphPos + paragraph.nodeSize, listItemNode)

      // Place cursor inside the inner paragraph (pos + 2 = past listItem open + paragraph open)
      tr.setSelection(Selection.near(tr.doc.resolve(paragraphPos + 2)))

      return tr
    }

    return [
      // Bullet list: "- " or "* " at start of line
      new InputRule({
        find: /^[-*]\s$/,
        handler: ({ state, range }) => {
          return wrapInListItem(state, range, { listType: 'bullet', indent: 0 }, this.type)
        },
      }),

      // Ordered list: "1. " at start of line (any number works)
      new InputRule({
        find: /^(\d+)\.\s$/,
        handler: ({ state, range }) => {
          return wrapInListItem(state, range, { listType: 'ordered', indent: 0 }, this.type)
        },
      }),

      // Task list (unchecked): "[ ] " at start of line
      new InputRule({
        find: /^\[\s?\]\s$/,
        handler: ({ state, range }) => {
          return wrapInListItem(state, range, { listType: 'task', indent: 0, checked: false }, this.type)
        },
      }),

      // Task list (checked): "[x] " or "[X] " at start of line
      new InputRule({
        find: /^\[[xX]\]\s$/,
        handler: ({ state, range }) => {
          return wrapInListItem(state, range, { listType: 'task', indent: 0, checked: true }, this.type)
        },
      }),
    ]
  },

  // Handle checkbox clicks for task items
  addNodeView() {
    return ({ node, getPos, editor }) => {
      if (node.attrs.listType === 'ordered') {
        const dom = document.createElement('li')
        dom.setAttribute('data-list-type', 'ordered')
        if (node.attrs['data-block-id']) {
          dom.setAttribute('data-block-id', node.attrs['data-block-id'])
        }
        if (node.attrs.indent) {
          dom.setAttribute('data-indent', String(node.attrs.indent))
        }

        const numberSpan = document.createElement('span')
        numberSpan.className = 'list-item-number'
        numberSpan.contentEditable = 'false'
        dom.appendChild(numberSpan)

        const contentDOM = document.createElement('div')
        contentDOM.classList.add('list-item-content')
        dom.appendChild(contentDOM)

        return {
          dom,
          contentDOM,
          update: (updatedNode) => {
            if (updatedNode.type.name !== 'listItem') return false
            if (updatedNode.attrs.listType !== 'ordered') return false

            if (updatedNode.attrs['data-block-id']) {
              dom.setAttribute('data-block-id', updatedNode.attrs['data-block-id'])
            }
            if (updatedNode.attrs.indent) {
              dom.setAttribute('data-indent', String(updatedNode.attrs.indent))
            } else {
              dom.removeAttribute('data-indent')
            }
            return true
          },
        }
      }

      if (node.attrs.listType !== 'task') {
        // Returning an empty object signals ProseMirror to use default rendering
        // for bullet items. Casting is required because PMNodeView mandates `dom`,
        // but ProseMirror's node-view resolution accepts {} as "no custom view".
        // Do NOT change to null — tiptap resolves null differently from {}.
        return {} as PMNodeView
      }

      const dom = document.createElement('li')
      dom.setAttribute('data-list-type', 'task')
      if (node.attrs['data-block-id']) {
        dom.setAttribute('data-block-id', node.attrs['data-block-id'])
      }
      if (node.attrs.indent) {
        dom.setAttribute('data-indent', String(node.attrs.indent))
      }
      if (node.attrs.checked) {
        dom.setAttribute('data-checked', 'true')
      }

      const label = document.createElement('label')
      label.contentEditable = 'false'

      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = node.attrs.checked
      checkbox.addEventListener('change', () => {
        const pos = getPos()
        if (typeof pos === 'number') {
          editor.chain()
            .focus()
            .command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                checked: checkbox.checked,
              })
              return true
            })
            .run()
        }
      })

      label.appendChild(checkbox)
      dom.appendChild(label)

      const contentDOM = document.createElement('div')
      contentDOM.classList.add('list-item-content')
      dom.appendChild(contentDOM)

      return {
        dom,
        contentDOM,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'listItem') return false
          if (updatedNode.attrs.listType !== 'task') return false

          checkbox.checked = updatedNode.attrs.checked
          if (updatedNode.attrs.checked) {
            dom.setAttribute('data-checked', 'true')
          } else {
            dom.removeAttribute('data-checked')
          }
          if (updatedNode.attrs.indent) {
            dom.setAttribute('data-indent', String(updatedNode.attrs.indent))
          } else {
            dom.removeAttribute('data-indent')
          }

          return true
        },
      }
    }
  },
})

export default ListItem
