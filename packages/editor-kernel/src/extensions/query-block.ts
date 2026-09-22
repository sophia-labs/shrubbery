/**
 * Pure QueryBlock schema + host renderer seam.
 *
 * Garden's original node view reaches directly into filesystemStore and the
 * graph API. Shrubbery keeps the durable document node in the kernel and hands
 * its visual/execution face to a host callback, exactly like the math renderer.
 */

import { Node, mergeAttributes, type NodeViewRendererProps } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'

export const QUERY_BLOCK_VISUALIZATIONS = [
  'table',
  'stat',
  'triples',
  'vega',
  'network',
  'json',
] as const

export type QueryBlockVisualization = (typeof QUERY_BLOCK_VISUALIZATIONS)[number]
export type QueryBlockDisplayMode = 'auto' | 'manual' | 'agent'

export interface QueryBlockAttrs {
  readonly comment: string
  readonly query: string
  readonly displayMode: QueryBlockDisplayMode
  readonly visualization: QueryBlockVisualization
  readonly maxRows: number
  readonly vegaLiteSpec: string
  readonly collapsed: boolean
}

export interface QueryBlockRenderRequest {
  readonly attrs: QueryBlockAttrs
  readonly editable: boolean
  readonly graphId: string | null
  updateAttrs(patch: Partial<QueryBlockAttrs>): void
  deleteNode(): void
}

export interface QueryBlockRenderHandle {
  update?(request: QueryBlockRenderRequest): void
  destroy(): void
}

export type QueryBlockRenderer = (
  target: HTMLElement,
  request: QueryBlockRenderRequest,
) => QueryBlockRenderHandle | void

export interface QueryBlockOptions {
  readonly HTMLAttributes: Record<string, unknown>
  readonly renderQueryBlock?: QueryBlockRenderer
  readonly getGraphId?: () => string | null | undefined
}

const DEFAULT_QUERY = `SELECT ?s ?p ?o WHERE {
  ?s ?p ?o .
}
LIMIT 25`

export const DEFAULT_QUERY_BLOCK_ATTRS: QueryBlockAttrs = {
  comment: '',
  query: DEFAULT_QUERY,
  displayMode: 'auto',
  visualization: 'table',
  maxRows: 100,
  vegaLiteSpec: '',
  collapsed: false,
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    queryBlock: {
      insertQueryBlock: (attrs?: Partial<QueryBlockAttrs>) => ReturnType
    }
  }
}

export function normalizeQueryBlockAttrs(attrs: Record<string, unknown>): QueryBlockAttrs {
  const displayMode: QueryBlockDisplayMode =
    attrs.displayMode === 'manual' || attrs.displayMode === 'agent'
      ? attrs.displayMode
      : 'auto'
  const requestedVisualization = attrs.visualization === 'bar' ? 'vega' : attrs.visualization
  const visualization = QUERY_BLOCK_VISUALIZATIONS.includes(
    requestedVisualization as QueryBlockVisualization,
  )
    ? (requestedVisualization as QueryBlockVisualization)
    : DEFAULT_QUERY_BLOCK_ATTRS.visualization
  const rows = Number(attrs.maxRows)
  return {
    comment:
      typeof attrs.comment === 'string' ? attrs.comment : DEFAULT_QUERY_BLOCK_ATTRS.comment,
    query: typeof attrs.query === 'string' ? attrs.query : DEFAULT_QUERY_BLOCK_ATTRS.query,
    displayMode,
    visualization,
    maxRows: Number.isFinite(rows)
      ? Math.max(1, Math.min(500, Math.trunc(rows)))
      : DEFAULT_QUERY_BLOCK_ATTRS.maxRows,
    vegaLiteSpec:
      typeof attrs.vegaLiteSpec === 'string'
        ? attrs.vegaLiteSpec
        : DEFAULT_QUERY_BLOCK_ATTRS.vegaLiteSpec,
    collapsed: attrs.collapsed === true || attrs.collapsed === 'true',
  }
}

function fallbackRender(target: HTMLElement, request: QueryBlockRenderRequest): void {
  const title = target.ownerDocument.createElement('div')
  title.className = 'query-block-fallback-label'
  title.textContent = request.attrs.comment || 'SPARQL query'
  const query = target.ownerDocument.createElement('pre')
  query.className = 'query-block-fallback-query'
  query.textContent = request.attrs.query
  target.replaceChildren(title, query)
  target.dataset.visualization = request.attrs.visualization
  target.dataset.collapsed = String(request.attrs.collapsed)
}

function createQueryBlockNodeView(options: QueryBlockOptions) {
  return ({ node: initialNode, getPos, editor }: NodeViewRendererProps) => {
    let node = initialNode
    let handle: QueryBlockRenderHandle | void
    const dom = editor.view.dom.ownerDocument.createElement('div')
    dom.className = 'query-block'
    dom.dataset.queryBlock = ''
    dom.contentEditable = 'false'

    const makeRequest = (): QueryBlockRenderRequest => ({
      attrs: normalizeQueryBlockAttrs(node.attrs as Record<string, unknown>),
      editable: editor.isEditable,
      graphId: options.getGraphId?.()?.trim() || null,
      updateAttrs(patch) {
        const pos = typeof getPos === 'function' ? getPos() : null
        if (!editor.isEditable || typeof pos !== 'number') return
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            ...patch,
          }),
        )
      },
      deleteNode() {
        const pos = typeof getPos === 'function' ? getPos() : null
        if (!editor.isEditable || typeof pos !== 'number') return
        editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
      },
    })

    const mount = (): void => {
      const request = makeRequest()
      if (options.renderQueryBlock) {
        handle = options.renderQueryBlock(dom, request)
      } else {
        fallbackRender(dom, request)
      }
    }

    mount()
    return {
      dom,
      stopEvent: () => true,
      ignoreMutation: () => true,
      update(updatedNode: PmNode): boolean {
        if (updatedNode.type !== node.type) return false
        node = updatedNode
        const request = makeRequest()
        if (handle?.update) {
          handle.update(request)
        } else if (options.renderQueryBlock) {
          handle?.destroy()
          dom.replaceChildren()
          handle = options.renderQueryBlock(dom, request)
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

export const QueryBlock = Node.create<QueryBlockOptions>({
  name: 'queryBlock',

  addOptions() {
    return {
      HTMLAttributes: {},
      renderQueryBlock: undefined,
      getGraphId: undefined,
    }
  },

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      comment: {
        default: DEFAULT_QUERY_BLOCK_ATTRS.comment,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('comment') ??
          element.getAttribute('data-comment') ??
          DEFAULT_QUERY_BLOCK_ATTRS.comment,
      },
      query: {
        default: DEFAULT_QUERY_BLOCK_ATTRS.query,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('query') ??
          element.getAttribute('data-query') ??
          DEFAULT_QUERY_BLOCK_ATTRS.query,
      },
      displayMode: {
        default: DEFAULT_QUERY_BLOCK_ATTRS.displayMode,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('displayMode') ??
          element.getAttribute('data-display-mode') ??
          DEFAULT_QUERY_BLOCK_ATTRS.displayMode,
      },
      visualization: {
        default: DEFAULT_QUERY_BLOCK_ATTRS.visualization,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('visualization') ??
          element.getAttribute('data-visualization') ??
          DEFAULT_QUERY_BLOCK_ATTRS.visualization,
      },
      maxRows: {
        default: DEFAULT_QUERY_BLOCK_ATTRS.maxRows,
        parseHTML: (element: HTMLElement) =>
          normalizeQueryBlockAttrs({
            maxRows:
              element.getAttribute('maxRows') ?? element.getAttribute('data-max-rows'),
          }).maxRows,
      },
      vegaLiteSpec: {
        default: DEFAULT_QUERY_BLOCK_ATTRS.vegaLiteSpec,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('vegaLiteSpec') ??
          element.getAttribute('data-vega-lite-spec') ??
          DEFAULT_QUERY_BLOCK_ATTRS.vegaLiteSpec,
      },
      collapsed: {
        default: DEFAULT_QUERY_BLOCK_ATTRS.collapsed,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('collapsed') === 'true' ||
          element.getAttribute('data-collapsed') === 'true',
        renderHTML: (attrs: QueryBlockAttrs) =>
          attrs.collapsed ? { collapsed: 'true' } : {},
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'query-block' },
      { tag: 'queryBlock' },
      { tag: 'div[data-query-block]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'query-block',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-query-block': '',
      }),
    ]
  },

  addNodeView() {
    return createQueryBlockNodeView(this.options)
  },

  addCommands() {
    return {
      insertQueryBlock:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { ...DEFAULT_QUERY_BLOCK_ATTRS, ...attrs },
          }),
    }
  },
})

export default QueryBlock
