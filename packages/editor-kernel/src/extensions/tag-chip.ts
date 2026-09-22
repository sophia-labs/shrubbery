/**
 * TipTap inline atom for a tag chip.
 *
 * Garden renders this through a Lit node view. Shrubbery keeps the kernel pure:
 * no Lit import, no store, no navigation. The node renders a plain inline atom
 * and surfaces clicks through an optional host callback.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'

export interface TagChipAttrs {
  name: string
  date?: string | null
}

export type TagChipClickHandler = (attrs: TagChipAttrs) => void

export interface TagChipOptions {
  HTMLAttributes: Record<string, unknown>
  onTagClick?: TagChipClickHandler
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tagChip: {
      insertTagChip: (attrs: TagChipAttrs) => ReturnType
    }
  }
}

/** Read existing data-tags JSON-array from block attrs. */
export function parseBlockTags(rawAttr: unknown): string[] {
  if (typeof rawAttr !== 'string') return []
  try {
    const parsed = JSON.parse(rawAttr)
    if (Array.isArray(parsed)) {
      return parsed.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)
    }
  } catch {
    // fall through
  }
  return []
}

/** Read existing data-tag-expirations JSON-object from block attrs. */
export function parseBlockExpirations(rawAttr: unknown): Record<string, string> {
  if (typeof rawAttr !== 'string') return {}
  try {
    const parsed = JSON.parse(rawAttr)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') out[key.toLowerCase()] = value
      }
      return out
    }
  } catch {
    // fall through
  }
  return {}
}

function normalizeTagName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^#/, '').toLowerCase() : ''
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function pushUnique(values: string[], value: string): void {
  if (value && !values.includes(value)) values.push(value)
}

/**
 * Walk a block node's content, collecting (name, date) pairs from tagChip atoms.
 * Multiple chips with the same name and different dates: the last date wins.
 */
export function collectChipsFromBlock(blockNode: ProseMirrorNode): {
  tags: string[]
  expirations: Record<string, string>
} {
  const tags: string[] = []
  const expirations: Record<string, string> = {}
  blockNode.descendants((child) => {
    if (child.type.name !== 'tagChip') return
    const name = normalizeTagName(child.attrs.name)
    const date = normalizeDate(child.attrs.date)
    if (!name) return
    pushUnique(tags, name)
    if (date) expirations[name] = date
  })
  return { tags, expirations }
}

const tagChipSyncKey = new PluginKey('tagChipSync')

function blockIdentity(node: ProseMirrorNode, index: number): string {
  const id = node.attrs['data-block-id']
  return typeof id === 'string' && id.length > 0 ? `id:${id}` : `index:${index}`
}

function oldChipNamesByBlock(state: EditorState): Map<string, Set<string>> {
  const byBlock = new Map<string, Set<string>>()
  state.doc.forEach((node, _offset, index) => {
    if (!node.isBlock) return
    byBlock.set(blockIdentity(node, index), new Set(collectChipsFromBlock(node).tags))
  })
  return byBlock
}

export const TagChip = Node.create<TagChipOptions>({
  name: 'tagChip',

  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      HTMLAttributes: {},
      onTagClick: undefined,
    }
  },

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('name') ?? element.getAttribute('data-name') ?? '',
        renderHTML: (attrs: TagChipAttrs) => {
          const name = normalizeTagName(attrs.name)
          return name ? { 'data-name': name } : {}
        },
      },
      date: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('date') ?? element.getAttribute('data-date') ?? null,
        renderHTML: (attrs: TagChipAttrs) => {
          const date = normalizeDate(attrs.date)
          return date ? { 'data-date': date } : {}
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-tag-chip]' }, { tag: 'mn-tag-chip' }]
  },

  renderHTML({ HTMLAttributes }) {
    const name = normalizeTagName(HTMLAttributes['data-name'] ?? HTMLAttributes.name)
    const date = normalizeDate(HTMLAttributes['data-date'] ?? HTMLAttributes.date)
    const label = date ? `#${name}:${date}` : `#${name}`
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'tag-chip',
        'data-tag-chip': '',
        role: 'button',
        tabindex: '0',
      }),
      label,
    ]
  },

  addCommands() {
    return {
      insertTagChip:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              name: normalizeTagName(attrs.name),
              date: normalizeDate(attrs.date),
            },
          }),
    }
  },

  addProseMirrorPlugins() {
    const extension = this
    return [
      new Plugin({
        key: tagChipSyncKey,

        props: {
          handleDOMEvents: {
            click: (view, event) => {
              const target = (event.target as HTMLElement | null)?.closest?.(
                '[data-tag-chip]',
              ) as HTMLElement | null
              if (!target || !view.dom.contains(target)) return false
              const name = normalizeTagName(target.getAttribute('data-name'))
              if (!name) return false
              event.preventDefault()
              event.stopPropagation()
              extension.options.onTagClick?.({
                name,
                date: normalizeDate(target.getAttribute('data-date')),
              })
              return true
            },
          },
        },

        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((transaction) => transaction.docChanged)) return null

          const previousChipNames = oldChipNamesByBlock(oldState)
          let tr = newState.tr
          let modified = false

          newState.doc.forEach((node, pos, index) => {
            if (!node.isBlock) return

            const { tags, expirations } = collectChipsFromBlock(node)
            const chipNames = new Set(tags)
            const existingTags = parseBlockTags(node.attrs['data-tags'])
            const existingExp = parseBlockExpirations(node.attrs['data-tag-expirations'])
            const oldChipNames = previousChipNames.get(blockIdentity(node, index)) ?? new Set()

            const finalTags: string[] = []
            const finalExp: Record<string, string> = {}

            for (const tag of tags) {
              pushUnique(finalTags, tag)
              if (expirations[tag]) finalExp[tag] = expirations[tag]
            }

            for (const tag of existingTags) {
              if (chipNames.has(tag)) continue
              if (oldChipNames.has(tag)) continue
              pushUnique(finalTags, tag)
              if (existingExp[tag]) finalExp[tag] = existingExp[tag]
            }

            const finalTagsJson = finalTags.length > 0 ? JSON.stringify(finalTags) : null
            const finalExpJson =
              Object.keys(finalExp).length > 0 ? JSON.stringify(finalExp) : null

            if (
              (node.attrs['data-tags'] || null) === finalTagsJson &&
              (node.attrs['data-tag-expirations'] || null) === finalExpJson
            ) {
              return
            }

            tr = tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              'data-tags': finalTagsJson,
              'data-tag-expirations': finalExpJson,
            })
            modified = true
          })

          return modified ? tr : null
        },
      }),
    ]
  },
})

export const tagChipStyles = `
  .tag-chip {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 0 0.35em;
    background: var(--mn-color-surface-accent);
    color: var(--mn-color-text-accent);
    font-size: 0.9em;
    line-height: 1.5;
    cursor: pointer;
    white-space: nowrap;
  }

  .tag-chip.ProseMirror-selectednode {
    outline: 2px solid var(--mn-color-border-accent);
    outline-offset: 1px;
  }
`

export default TagChip
