/**
 * Pure ObjectEmbed schema + host renderer seam (typed objects architecture D8.3 and §4 "Embed block",
 * `plans/2026-10-20-typed-objects/README.md`): one typed object, embedded in prose by reference.
 *
 *   {"type":"objectEmbed","attrs":{"data-block-id","iri","graphId","slot","label","classLabel"}}
 *
 * The node is the durable reference: the object's IRI, the graph it lives in (absent: this one), the slot it is drawn
 * in ("card"), and two snapshots, `label` (its title) and `classLabel`, kept for a reader that cannot resolve it. The
 * object itself is never copied into the document; gardend projects `<block> mdoc:embeds <iri>` beside the literal
 * attrs, so "documents that embed X" is a plain join.
 *
 * Like `QueryBlock`, the kernel keeps only the schema; the face (the runtime's `<sh-injerto>` around
 * `<sh-object-view slot="card">`) is a host callback that owns its own mount and dispose. With no host renderer the
 * node draws its snapshot, truthfully marked as one. `data-block-embed` keeps the outliner's guide line off it.
 */

import { mergeAttributes, Node, type NodeViewRendererProps } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'

export const OBJECT_EMBED_NODE = 'objectEmbed'

/** The slots gardend's contract allows (`objectEmbed`, contract 2); absent or anything else reads as `card`. */
export type ObjectEmbedSlot = 'inline' | 'card' | 'pane'
export const OBJECT_EMBED_SLOTS: readonly ObjectEmbedSlot[] = ['inline', 'card', 'pane']

export interface ObjectEmbedAttrs {
  /** The embedded object's absolute IRI. */
  readonly iri: string
  /** The graph it lives in; null: the document's own graph. */
  readonly graphId: string | null
  readonly slot: ObjectEmbedSlot
  /** Its title when it was embedded (a snapshot). */
  readonly label: string
  /** Its class label when it was embedded (a snapshot). */
  readonly classLabel: string
}

export interface ObjectEmbedRenderRequest {
  readonly attrs: ObjectEmbedAttrs
  /** The block's id (`data-block-id`), once the BlockId extension has minted it. */
  readonly blockId: string | null
  readonly editable: boolean
  /** The graph the editor is in, read at render time (the embed's own `graphId` wins when set). */
  readonly graphId: string | null
  deleteNode(): void
}

export interface ObjectEmbedRenderHandle {
  update?(request: ObjectEmbedRenderRequest): void
  destroy(): void
}

/** Mounts the object's face into `target`; owns its mount and its dispose (`destroy`). */
export type ObjectEmbedRenderer = (
  target: HTMLElement,
  request: ObjectEmbedRenderRequest,
) => ObjectEmbedRenderHandle | void

/** Chooses an object to embed (the `/object` slash command); null when the person chose none. */
export type ObjectEmbedPicker = () => Promise<Partial<ObjectEmbedAttrs> | null>

export interface ObjectEmbedOptions {
  readonly HTMLAttributes: Record<string, unknown>
  readonly renderObjectEmbed?: ObjectEmbedRenderer
  readonly getGraphId?: () => string | null | undefined
  readonly pickObjectEmbed?: ObjectEmbedPicker
}

export const DEFAULT_OBJECT_EMBED_ATTRS: ObjectEmbedAttrs = {
  iri: '',
  graphId: null,
  slot: 'card',
  label: '',
  classLabel: '',
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    objectEmbed: {
      insertObjectEmbed: (attrs: Partial<ObjectEmbedAttrs> & { readonly iri: string }) => ReturnType
    }
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function normalizeObjectEmbedAttrs(attrs: Record<string, unknown>): ObjectEmbedAttrs {
  const graphId = text(attrs.graphId).trim()
  const slot = OBJECT_EMBED_SLOTS.includes(attrs.slot as ObjectEmbedSlot) ? (attrs.slot as ObjectEmbedSlot) : 'card'
  return {
    iri: text(attrs.iri).trim(),
    graphId: graphId || null,
    slot,
    label: text(attrs.label),
    classLabel: text(attrs.classLabel),
  }
}

/** The node's text, for plain-text copy and for readers without the face: `⧉ Dream report — Meier`. */
export function objectEmbedText(attrs: ObjectEmbedAttrs): string {
  const what = [attrs.classLabel, attrs.label].filter(Boolean).join(' — ')
  return `⧉ ${what || attrs.iri || 'an object'}`
}

function fallbackRender(target: HTMLElement, request: ObjectEmbedRenderRequest): void {
  const doc = target.ownerDocument
  const chip = doc.createElement('span')
  chip.className = 'object-embed-fallback-class'
  chip.textContent = request.attrs.classLabel || 'Object'
  const label = doc.createElement('span')
  label.className = 'object-embed-fallback-label'
  label.textContent = request.attrs.label || request.attrs.iri
  const note = doc.createElement('span')
  note.className = 'object-embed-fallback-note'
  note.textContent = 'as it was when it was embedded'
  target.replaceChildren(chip, label, note)
}

function createObjectEmbedNodeView(options: ObjectEmbedOptions) {
  return ({ node: initialNode, getPos, editor }: NodeViewRendererProps) => {
    let node = initialNode
    let handle: ObjectEmbedRenderHandle | void
    const dom = editor.view.dom.ownerDocument.createElement('div')
    dom.className = 'object-embed'
    dom.dataset.objectEmbed = ''
    // An embed: the outliner's guide line stops at it.
    dom.dataset.blockEmbed = ''
    dom.contentEditable = 'false'

    const syncDom = (): void => {
      const blockId = node.attrs['data-block-id']
      if (blockId) dom.setAttribute('data-block-id', String(blockId))
      else dom.removeAttribute('data-block-id')
      dom.dataset.iri = normalizeObjectEmbedAttrs(node.attrs as Record<string, unknown>).iri
    }

    const makeRequest = (): ObjectEmbedRenderRequest => {
      const blockId = node.attrs['data-block-id']
      return {
        attrs: normalizeObjectEmbedAttrs(node.attrs as Record<string, unknown>),
        blockId: typeof blockId === 'string' && blockId ? blockId : null,
        editable: editor.isEditable,
        graphId: options.getGraphId?.()?.trim() || null,
        deleteNode() {
          const pos = typeof getPos === 'function' ? getPos() : null
          if (!editor.isEditable || typeof pos !== 'number') return
          editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
        },
      }
    }

    syncDom()
    const first = makeRequest()
    if (options.renderObjectEmbed) handle = options.renderObjectEmbed(dom, first)
    else fallbackRender(dom, first)

    return {
      dom,
      stopEvent: () => true,
      ignoreMutation: () => true,
      update(updatedNode: PmNode): boolean {
        if (updatedNode.type !== node.type) return false
        node = updatedNode
        syncDom()
        const request = makeRequest()
        if (handle?.update) {
          handle.update(request)
        } else if (options.renderObjectEmbed) {
          handle?.destroy()
          dom.replaceChildren()
          handle = options.renderObjectEmbed(dom, request)
        } else {
          fallbackRender(dom, request)
        }
        return true
      },
      destroy() {
        handle?.destroy()
      },
    }
  }
}

export const ObjectEmbed = Node.create<ObjectEmbedOptions>({
  name: OBJECT_EMBED_NODE,

  addOptions() {
    return {
      HTMLAttributes: {},
      renderObjectEmbed: undefined,
      getGraphId: undefined,
      pickObjectEmbed: undefined,
    }
  },

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      iri: {
        default: DEFAULT_OBJECT_EMBED_ATTRS.iri,
        parseHTML: (element: HTMLElement) => element.getAttribute('iri') ?? element.getAttribute('data-iri') ?? '',
      },
      graphId: {
        default: DEFAULT_OBJECT_EMBED_ATTRS.graphId,
        parseHTML: (element: HTMLElement) => element.getAttribute('graphId') || element.getAttribute('data-graph-id') || null,
        renderHTML: (attrs: { graphId?: string | null }) => (attrs.graphId ? { graphId: attrs.graphId } : {}),
      },
      slot: {
        default: DEFAULT_OBJECT_EMBED_ATTRS.slot,
        // inline, card or pane, as the contract allows; anything else reads back as the card.
        parseHTML: (element: HTMLElement) => {
          const slot = element.getAttribute('slot')
          return OBJECT_EMBED_SLOTS.includes(slot as ObjectEmbedSlot) ? slot : 'card'
        },
      },
      label: {
        default: DEFAULT_OBJECT_EMBED_ATTRS.label,
        parseHTML: (element: HTMLElement) => element.getAttribute('label') ?? element.getAttribute('data-label') ?? '',
      },
      classLabel: {
        default: DEFAULT_OBJECT_EMBED_ATTRS.classLabel,
        parseHTML: (element: HTMLElement) => element.getAttribute('classLabel') ?? element.getAttribute('data-class-label') ?? '',
      },
    }
  },

  parseHTML() {
    return [{ tag: 'object-embed' }, { tag: 'div[data-object-embed]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'object-embed',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-object-embed': '',
        'data-block-embed': '',
      }),
    ]
  },

  renderText({ node }) {
    return objectEmbedText(normalizeObjectEmbedAttrs(node.attrs as Record<string, unknown>))
  },

  addNodeView() {
    return createObjectEmbedNodeView(this.options)
  },

  addCommands() {
    return {
      insertObjectEmbed:
        (attrs) =>
        ({ commands }) => {
          const normalized = normalizeObjectEmbedAttrs({ ...DEFAULT_OBJECT_EMBED_ATTRS, ...attrs })
          if (!normalized.iri) return false
          return commands.insertContent({ type: this.name, attrs: normalized })
        },
    }
  },
})

export default ObjectEmbed
