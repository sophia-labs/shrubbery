/** Pure DOM/read-model projection for the controlled document graph scene. */

import type {
  GraphPanelEdge,
  GraphPanelNode,
  SidebarNode,
  SidebarSection,
  WireBundle,
  WireSummary,
} from '@shrubbery/runtime'

export interface DocumentGraphProjection {
  readonly nodes: readonly GraphPanelNode[]
  readonly edges: readonly GraphPanelEdge[]
}

export interface DocumentGraphProjectionInput {
  readonly graphId: string
  readonly documentId: string
  readonly documentTitle?: string | null
  readonly blocks: readonly HTMLElement[]
  readonly wires?: WireBundle | null
}

function blockKind(element: HTMLElement): GraphPanelNode['kind'] {
  const tag = element.tagName.toLowerCase()
  const listType = element.dataset.listType
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (tag === 'li' && listType === 'ordered') return 'ordered'
  if (tag === 'li' && listType === 'task') return 'task'
  if (tag === 'li') return 'bullet'
  if (tag === 'blockquote') return 'blockquote'
  if (tag === 'pre') return 'code'
  if (tag === 'hr') return 'horizontal-rule'
  if (tag === 'td' || tag === 'th') return 'table'
  if (tag === 'query-block' || element.hasAttribute('data-query-block') || element.matches('.query-block')) return 'query'
  if (element.matches('.image-block') || element.querySelector(':scope > img')) return 'image'
  if (element.matches('.math-block') || element.hasAttribute('data-math-block')) return 'math'
  if (tag === 'p') return 'paragraph'
  return 'unknown'
}

function normalizedText(element: HTMLElement): string {
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return `[${blockKind(element)?.replaceAll('-', ' ') ?? 'block'}]`
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}

function boundedDepth(element: HTMLElement): number {
  const value = Number.parseInt(element.dataset.indent ?? '0', 10)
  return Number.isFinite(value) ? Math.max(0, Math.min(6, value)) : 0
}

function checkedState(element: HTMLElement): boolean | null {
  if (element.dataset.listType !== 'task') return null
  return element.dataset.checked === 'true' || element.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked === true
}

function portalId(wire: WireSummary, direction: 'outgoing' | 'incoming'): string {
  return `portal:${direction}:${wire.id}`
}

function wireEdge(
  wire: WireSummary,
  direction: 'outgoing' | 'incoming',
  from: string,
  to: string,
): GraphPanelEdge {
  return {
    id: `wire:${direction}:${wire.id}`,
    from,
    to,
    predicate: wire.predicate,
    predicateLabel: wire.predicateLabel,
    kind: 'wire',
    note: wire.localSnippet ?? wire.otherSnippet,
    bidirectional: wire.bidirectional,
  }
}

/**
 * Project the live editor's rendered block order and current wire bundle into
 * Garden's document-helix vocabulary. No editor/store/backend authority leaks
 * into the renderer; absent endpoints become explicit portal nodes.
 */
export function projectDocumentGraph(input: DocumentGraphProjectionInput): DocumentGraphProjection {
  const nodes: GraphPanelNode[] = []
  const edges: GraphPanelEdge[] = []
  const blockIds = new Set<string>()
  const parentAtDepth = new Map<number, string>()
  let previousRootId: string | null = null

  for (const element of input.blocks) {
    const blockId = element.dataset.blockId?.trim()
    if (!blockId || blockIds.has(blockId)) continue
    blockIds.add(blockId)
    const depth = boundedDepth(element)
    let parentId: string | null = null
    for (let candidate = depth - 1; candidate >= 0; candidate -= 1) {
      const ancestor = parentAtDepth.get(candidate)
      if (ancestor) {
        parentId = ancestor
        break
      }
    }
    for (const knownDepth of [...parentAtDepth.keys()]) {
      if (knownDepth > depth) parentAtDepth.delete(knownDepth)
    }
    parentAtDepth.set(depth, blockId)

    const node: GraphPanelNode = {
      id: blockId,
      label: normalizedText(element),
      kind: blockKind(element),
      graphId: input.graphId,
      documentId: input.documentId,
      blockId,
      parentId,
      order: nodes.length,
      depth,
      checked: checkedState(element),
    }
    nodes.push(node)
    if (parentId) {
      edges.push({
        id: `structure:${parentId}:${blockId}`,
        from: parentId,
        to: blockId,
        predicate: 'contains',
        kind: 'predicate',
      })
    } else {
      if (previousRootId) {
        edges.push({
          id: `flow:${previousRootId}:${blockId}`,
          from: previousRootId,
          to: blockId,
          predicate: 'precedes',
          kind: 'predicate',
        })
      }
      previousRootId = blockId
    }

    element.querySelectorAll<HTMLElement>('.footnote-ref').forEach((footnote, footnoteIndex) => {
      const footnoteId = `${blockId}:footnote:${footnoteIndex}`
      const content = footnote.dataset.footnoteContent
        ?? footnote.getAttribute('data-footnote-content')
        ?? 'Footnote'
      nodes.push({
        id: footnoteId,
        label: content.length > 60 ? `${content.slice(0, 59)}…` : content,
        kind: 'footnote',
        graphId: input.graphId,
        documentId: input.documentId,
        parentId: blockId,
        order: nodes.length,
        depth: depth + 1,
      })
      edges.push({
        id: `structure:${blockId}:${footnoteId}`,
        from: blockId,
        to: footnoteId,
        predicate: 'contains',
        kind: 'predicate',
      })
    })
  }

  const fallbackBlockId = nodes.find((node) => node.blockId)?.id ?? null
  const addWire = (wire: WireSummary, direction: 'outgoing' | 'incoming'): void => {
    const localId = wire.localBlockId && blockIds.has(wire.localBlockId)
      ? wire.localBlockId
      : fallbackBlockId
    if (!localId) return
    const internal = wire.otherGraphId === input.graphId &&
      wire.otherDocumentId === input.documentId &&
      !!wire.otherBlockId &&
      blockIds.has(wire.otherBlockId)
    if (internal) {
      const otherId = wire.otherBlockId!
      edges.push(direction === 'outgoing'
        ? wireEdge(wire, direction, localId, otherId)
        : wireEdge(wire, direction, otherId, localId))
      return
    }

    const id = portalId(wire, direction)
    nodes.push({
      id,
      label: wire.otherTitle || wire.otherDocumentId,
      note: `${wire.predicateLabel} ${wire.bidirectional ? '↔' : direction === 'outgoing' ? '→' : '←'}`,
      kind: 'portal',
      graphId: wire.otherGraphId || input.graphId,
      documentId: wire.otherDocumentId,
      blockId: wire.otherBlockId ?? null,
      parentId: localId,
      order: nodes.length,
      depth: 0,
      snippet: wire.otherSnippet ?? null,
      readOnly: true,
    })
    edges.push(direction === 'outgoing'
      ? wireEdge(wire, direction, localId, id)
      : wireEdge(wire, direction, id, localId))
  }

  for (const wire of input.wires?.outgoingWires ?? []) addWire(wire, 'outgoing')
  for (const wire of input.wires?.incomingWires ?? []) addWire(wire, 'incoming')

  return { nodes, edges }
}

// ── Workspace-graph projection (sidebar tree → graph-panel node/edge set) ─────
// These build the WORKSPACE view (sections/folders/documents/wires), distinct
// from projectDocumentGraph's single-document helix above. The active graph id
// is passed explicitly (never read from shell module state) so the projection
// stays pure and testable: `graphId === currentGraphId` decides local-vs-remote
// node ids and which edges anchor to the workspace root.

export function graphPanelDocumentNodeId(graphId: string, documentId: string, currentGraphId: string): string {
  return graphId === currentGraphId ? `doc:${documentId}` : `doc:${graphId}:${documentId}`
}

export function graphPanelNodeIdForSidebarNode(section: SidebarSection, node: SidebarNode, currentGraphId: string): string {
  if (node.kind === 'artifact') return `artifact:${node.id}`
  if (node.kind === 'folder') return `folder:${node.section ?? section.id}:${node.id}`
  if (node.kind === 'tag') return `tag:${node.label || node.id.replace(/^tag:/, '')}`
  return graphPanelDocumentNodeId(currentGraphId, node.id, currentGraphId)
}

/**
 * Merge a projected node into the accumulator, letting the FIRST-seen node win
 * per field (an already-present value is never overwritten by a later, sparser
 * projection of the same id).
 */
export function upsertGraphPanelNode(nodes: Map<string, GraphPanelNode>, node: GraphPanelNode): void {
  const existing = nodes.get(node.id)
  if (!existing) {
    nodes.set(node.id, node)
    return
  }
  nodes.set(node.id, {
    ...node,
    ...existing,
    label: existing.label ?? node.label,
    note: existing.note ?? node.note,
    graphId: existing.graphId ?? node.graphId,
    documentId: existing.documentId ?? node.documentId,
    artifactId: existing.artifactId ?? node.artifactId,
    folderId: existing.folderId ?? node.folderId,
    tagName: existing.tagName ?? node.tagName,
    section: existing.section ?? node.section,
    parentId: existing.parentId ?? node.parentId,
    mimeType: existing.mimeType ?? node.mimeType,
    fileType: existing.fileType ?? node.fileType,
    status: existing.status ?? node.status,
    ingestedDocumentId: existing.ingestedDocumentId ?? node.ingestedDocumentId,
    readOnly: existing.readOnly ?? node.readOnly,
  })
}

/** Append an edge, skipping self-loops, empty endpoints, and dedupe collisions. */
export function addGraphPanelEdge(
  edges: GraphPanelEdge[],
  seen: Set<string>,
  edge: GraphPanelEdge,
): void {
  if (!edge.from || !edge.to || edge.from === edge.to) return
  const key = `${edge.kind ?? 'predicate'}|${edge.from}|${edge.to}|${edge.predicate}`
  if (seen.has(key)) return
  seen.add(key)
  edges.push(edge)
}

export function projectSidebarNodeToGraphPanel(
  section: SidebarSection,
  node: SidebarNode,
  parentGraphNodeId: string,
  nodes: Map<string, GraphPanelNode>,
  edges: GraphPanelEdge[],
  seenEdges: Set<string>,
  currentGraphId: string,
): void {
  const sectionId = node.section ?? section.id
  const graphNodeId = graphPanelNodeIdForSidebarNode(section, node, currentGraphId)
  const sourceKind = node.kind ?? 'document'
  const kind = sourceKind === 'document' && node.readOnly ? 'read-only-document' : sourceKind
  upsertGraphPanelNode(nodes, {
    id: graphNodeId,
    label: node.label,
    note: node.badge ?? node.status ?? undefined,
    kind,
    graphId: currentGraphId,
    documentId: kind === 'document' || kind === 'read-only-document' ? node.id : null,
    artifactId: kind === 'artifact' ? node.id : null,
    folderId: kind === 'folder' ? node.id : null,
    tagName: kind === 'tag' ? node.label || node.id.replace(/^tag:/, '') : null,
    section: sectionId,
    parentId: node.parentId ?? null,
    mimeType: node.mimeType ?? null,
    fileType: node.fileType ?? null,
    status: node.status ?? null,
    ingestedDocumentId: node.ingestedDocumentId ?? null,
    readOnly: node.readOnly ?? false,
  })
  addGraphPanelEdge(edges, seenEdges, {
    from: parentGraphNodeId,
    to: graphNodeId,
    predicate: 'contains',
    kind: 'predicate',
  })
  for (const child of node.children ?? []) {
    projectSidebarNodeToGraphPanel(section, child, graphNodeId, nodes, edges, seenEdges, currentGraphId)
  }
}

export function addGraphPanelDocumentNode(
  nodes: Map<string, GraphPanelNode>,
  edges: GraphPanelEdge[],
  seenEdges: Set<string>,
  rootNodeId: string,
  graphId: string,
  documentId: string,
  currentGraphId: string,
  label?: string | null,
  note?: string | null,
): string {
  const nodeId = graphPanelDocumentNodeId(graphId, documentId, currentGraphId)
  upsertGraphPanelNode(nodes, {
    id: nodeId,
    label: label || documentId,
    note: note || undefined,
    kind: 'document',
    graphId,
    documentId,
    section: graphId === currentGraphId ? 'documents' : null,
  })
  if (graphId === currentGraphId) {
    addGraphPanelEdge(edges, seenEdges, {
      from: rootNodeId,
      to: nodeId,
      predicate: 'contains',
      kind: 'predicate',
    })
  }
  return nodeId
}

// ── Node-history navigation ───────────────────────────────────────────────────
// The graph panel keeps a linear block-selection history with a cursor, exactly
// like browser back/forward: selecting past the cursor drops any forward
// entries (you can't redo into a branch you just diverged from). Pure transform
// over (history, index) — the shell owns the mutable cells and applies the
// result.

export interface NodeHistoryState {
  readonly history: readonly string[]
  readonly index: number
}

/**
 * Push a block id onto the selection history at the current cursor. A repeat of
 * the currently-selected id is a no-op; otherwise forward entries past the
 * cursor are dropped and the cursor advances to the new tip.
 */
export function pushNodeHistory(history: readonly string[], index: number, blockId: string): NodeHistoryState {
  if (history[index] === blockId) return { history, index }
  const next = [...history.slice(0, index + 1), blockId]
  return { history: next, index: next.length - 1 }
}
