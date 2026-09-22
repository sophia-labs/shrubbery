/**
 * TipTap BlockId Extension — ported VERBATIM from garden
 * (frontend/src/lib/tiptap-block-id.ts), severing its ONE coupling.
 *
 * Assigns stable `data-block-id` attributes to block-level nodes.
 * Required for RDF bridge compatibility with native TipTap collaboration.
 *
 * The RDF bridge needs stable block IDs to:
 * - Track block identity across edits
 * - Map Y.js content to RDF triples
 * - Support references between blocks
 *
 * This extension:
 * 1. Adds `data-block-id` as a global attribute to specified block types
 * 2. Auto-assigns IDs to blocks that don't have them (via ProseMirror plugin)
 * 3. Preserves IDs through edits and collaboration
 *
 * COUPLING SEVERED (the only one): garden imported
 *   `import { featureFlags } from '../config/feature-flags.js'`
 * and the BLOCK_TYPES list appended `'queryBlock'` iff
 * `featureFlags.queryBlocksEnabled` (tiptap-block-id.ts:38). QueryBlock now
 * ships in the kernel, so kernelExtensions includes it in enabledNodeTypes.
 *
 * ACCURATE MODEL: BlockId adds NO node. It adds `data-block-id` as a GLOBAL
 * ATTRIBUTE over a BLOCK_TYPES target list (a `types` array on
 * addGlobalAttributes). @tiptap/core's schema build filters global attrs to
 * MATCHING registered node names, so a `types` entry naming an ABSENT node is
 * silently ignored — it never throws (this is Class-B per the preflight). That
 * is why the deferred 'queryBlock' / 'mathBlock' are safe to NAME but we still
 * gate them behind KernelOptions.enabledNodeTypes for hygiene + host opt-in.
 *
 * The featureFlags ternary is replaced by `options.enabledNodeTypes` (the
 * KernelOptions seam, default []): any opt-in node names the host passes are
 * appended to the standard BLOCK_TYPES base.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * Standard block types that should receive data-block-id attributes — the
 * always-on base (garden's BLOCK_TYPES minus the feature-gated 'queryBlock',
 * now host-opt-in via enabledNodeTypes).
 *
 * Note: bulletList, orderedList, taskList, taskItem are removed.
 * Lists now use flat listItem nodes with listType attribute.
 */
const BASE_BLOCK_TYPES = [
  'paragraph',
  'heading',
  'listItem', // Flat list item with listType attribute (bullet/ordered/task)
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'image',
  'mathBlock',
  // Table CELLS are wireable blocks (each cell is its own block per the
  // shrubbery wire model). The table itself is the outliner container; the
  // wire source is the cell, not the table.
  'tableCell',
  'tableHeader',
] as const

export interface BlockIdOptions {
  /**
   * Block types to add data-block-id attributes to.
   * Defaults to the standard BLOCK_TYPES base + any host-enabled opt-in types.
   */
  types: readonly string[]
  /**
   * Host opt-in node names appended to the standard base (the severed
   * featureFlags seam). E.g. ['queryBlock'] once QueryBlock is wired, or
   * ['queryBlock'] once QueryBlock is wired. Default [] — naming an absent node
   * is a harmless no-op (Class-B), but this keeps the literal list honest.
   */
  enabledNodeTypes: readonly string[]
}

/**
 * Generate a unique block ID.
 * Uses crypto.randomUUID() for uniqueness, truncated for readability.
 */
function generateBlockId(): string {
  return `block-${crypto.randomUUID().slice(0, 8)}`
}

export const BlockId = Extension.create<BlockIdOptions>({
  name: 'blockId',

  addOptions() {
    return {
      enabledNodeTypes: [],
      // `types` defaults to the base; if the host configures only
      // enabledNodeTypes, we fold them in here too. (When the host overrides
      // `types` directly, that wins verbatim — same contract as garden.)
      types: BASE_BLOCK_TYPES,
    }
  },

  addGlobalAttributes() {
    // Fold host opt-in node types into the effective target list. (If the host
    // overrode `types` directly we still honor it; otherwise base + opt-in.)
    const baseTypes =
      this.options.types === BASE_BLOCK_TYPES
        ? [...BASE_BLOCK_TYPES, ...this.options.enabledNodeTypes]
        : this.options.types
    // De-dupe defensively.
    const effectiveTypes = Array.from(new Set(baseTypes as string[]))

    return [
      {
        types: effectiveTypes,
        attributes: {
          'data-block-id': {
            default: null,
            parseHTML: (element) => element.getAttribute('data-block-id'),
            renderHTML: (attributes) => {
              if (!attributes['data-block-id']) return {}
              return { 'data-block-id': attributes['data-block-id'] }
            },
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    // Mirror addGlobalAttributes' effective target resolution so the plugin and
    // the schema agree on which node types carry IDs.
    const baseTypes =
      this.options.types === BASE_BLOCK_TYPES
        ? [...BASE_BLOCK_TYPES, ...this.options.enabledNodeTypes]
        : this.options.types
    const types = Array.from(new Set(baseTypes as string[]))

    return [
      new Plugin({
        key: new PluginKey('blockId'),

        /**
         * Append transaction to auto-assign block IDs.
         *
         * Runs after every transaction to assign unique IDs to blocks that:
         * - Are missing IDs (new blocks from user or collaborators)
         * - Have duplicate IDs (corrupted Y.js state, copy-paste, etc.)
         *
         * Note: We check on ALL transactions (not just docChanged) to catch
         * the Y.js initial sync which may load content with duplicate IDs.
         */
        appendTransaction: (_transactions, _oldState, newState) => {
          const { tr } = newState
          let modified = false

          // Track seen IDs to detect duplicates
          const seenIds = new Set<string>()
          // Collect blocks that need new IDs (missing or duplicate)
          const blocksNeedingIds: { pos: number; node: import('@tiptap/pm/model').Node }[] = []

          newState.doc.descendants((node, pos) => {
            // Skip non-block nodes
            if (!node.isBlock) return

            // Skip node types we don't care about
            if (!types.includes(node.type.name)) return

            const existingId = node.attrs['data-block-id']

            // Need a new ID if: no ID, or duplicate ID
            if (!existingId || seenIds.has(existingId)) {
              blocksNeedingIds.push({ pos, node })
            } else {
              seenIds.add(existingId)
            }
          })

          // Early exit if no duplicates found
          if (blocksNeedingIds.length === 0) return null

          // Assign new IDs to blocks that need them
          for (const { pos, node } of blocksNeedingIds) {
            let newId = generateBlockId()
            // Ensure the new ID is also unique (very unlikely to collide, but be safe)
            while (seenIds.has(newId)) {
              newId = generateBlockId()
            }
            seenIds.add(newId)

            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              'data-block-id': newId,
            })
            modified = true
          }

          return modified ? tr : null
        },
      }),
    ]
  },
})

export default BlockId
