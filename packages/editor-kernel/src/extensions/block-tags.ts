/**
 * TipTap BlockTags Extension
 *
 * Registers tag attrs on block-level nodes so categorical tags and scheduled
 * expirations survive editor round-trips instead of being silently stripped
 * on first user edit.
 *
 * The attribute is a JSON-encoded array of lowercase tag strings, e.g.
 * `data-tags='["decision","pragma"]'`. Tags are written by the MCP write
 * tools and the platform RDF materializer reads them as `doc:hasTag`
 * triples. Chip rendering + autocomplete is a separate extension.
 */

import { Extension } from '@tiptap/core'

/**
 * Block types that carry data-tags. Mirrors the BlockId extension's list.
 */
const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'listItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'image',
  'mathBlock',
] as const

export interface BlockTagsOptions {
  /**
   * Block types to register data-tags on.
   */
  types: readonly string[]
}

export const BlockTags = Extension.create<BlockTagsOptions>({
  name: 'blockTags',

  addOptions() {
    return {
      types: BLOCK_TYPES,
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types as string[],
        attributes: {
          'data-tags': {
            default: null,
            parseHTML: (element) => element.getAttribute('data-tags'),
            renderHTML: (attributes) => {
              const raw = attributes['data-tags']
              if (!raw) return {}
              return { 'data-tags': raw }
            },
          },
          'data-tag-expirations': {
            default: null,
            parseHTML: (element) => element.getAttribute('data-tag-expirations'),
            renderHTML: (attributes) => {
              const raw = attributes['data-tag-expirations']
              if (!raw) return {}
              return { 'data-tag-expirations': raw }
            },
          },
        },
      },
    ]
  },
})

export default BlockTags
