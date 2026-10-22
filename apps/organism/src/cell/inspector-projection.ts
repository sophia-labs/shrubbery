/**
 * inspector-projection.ts — shell-side pure projection for the right rail.
 *
 * Garden's inspector derives its model from the selected-object bus plus the
 * already-loaded active document data. This keeps the same no-extra-fetch rule:
 * if the selected object is not in the active document, relations are marked
 * inactive instead of faking a read.
 */

import type { SelectedObject } from '@shrubbery/nucleus'
import type {
  WbBacklink,
  WbBacklinkKind,
  WireBundle,
  WireSummary,
  WorkspaceComment,
  WorkspaceInspectorAction,
  WorkspaceInspectorModel,
  WorkspaceInspectorRelationGroup,
  WorkspaceInspectorRelationItem,
  WorkspaceInspectorRelations,
} from '@shrubbery/runtime'
import { type WireBoardFields, wireBoardProvenance, wireEndOf } from './whiteboard-navigation.js'

export interface InspectorProjectionInput {
  readonly selection: SelectedObject | null
  readonly graphId: string | null
  readonly graphTitle?: string | null
  readonly activeDocumentId: string | null
  readonly activeDocumentTitle?: string | null
  readonly wireBundle?: WireBundle | null
  readonly comments?: readonly WorkspaceComment[]
  /** The active document's `documentKind` (a board is `whiteboard`), so the inspector can name it. */
  readonly activeDocumentKind?: string | null
  /** The sidebar title of a document, for "from board {title}" on a wire. */
  readonly titleOf?: (documentId: string) => string | undefined
  /** Who links to the active document (`get_backlinks`), already read; the inspector lists them as "Linked from". */
  readonly backlinks?: readonly WbBacklink[]
}

const LINKED_FROM_ORDER: readonly WbBacklinkKind[] = [
  'board-link', 'board-card', 'board-connection', 'wire', 'embed', 'wikilink', 'link',
]

const LINKED_FROM_LABEL: Readonly<Record<WbBacklinkKind, string>> = {
  'board-link': 'Link on a board',
  'board-card': 'Card on a board',
  'board-connection': 'Arrow on a board',
  wire: 'Wire',
  embed: 'Embed',
  wikilink: 'Wikilink',
  link: 'Link',
}

/** The id an inspector row carries, so the shell can find the backlink a click means. */
export function backlinkRowId(row: WbBacklink): string {
  return [row.kind, row.sourceDocumentId, row.sourceBlockId ?? '', row.wireId ?? '', row.viaConnection ?? ''].join('|')
}

function linkedFromItem(row: WbBacklink): WorkspaceInspectorRelationItem {
  const isBoard = row.sourceKind === 'whiteboard'
  return {
    id: backlinkRowId(row),
    primary: row.sourceTitle || row.sourceDocumentId,
    secondary: [LINKED_FROM_LABEL[row.kind], row.predicate].filter(Boolean).join(' - '),
    icon: isBoard ? 'pencil' : 'corner-up-right',
  }
}

/** "Linked from": the rows grouped by kind (boards first), each opening its source. `null` when nothing links here. */
function linkedFromGroup(backlinks: readonly WbBacklink[] | undefined): WorkspaceInspectorRelationGroup | null {
  if (!backlinks?.length) return null
  const rank = (row: WbBacklink): number => LINKED_FROM_ORDER.indexOf(row.kind)
  const sorted = [...backlinks].sort((a, b) => rank(a) - rank(b))
  return { key: 'linked-from', label: 'Linked from', icon: 'corner-up-right', items: sorted.map(linkedFromItem) }
}

function valueOf(selection: SelectedObject, key: string): string | undefined {
  const value = selection[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function truncate(value: string, max: number): string {
  const text = value.trim()
  return text.length > max ? `${text.slice(0, max - 3)}...` : text
}

function documentTitle(input: InspectorProjectionInput, documentId: string): string {
  return documentId === input.activeDocumentId
    ? input.activeDocumentTitle || documentId
    : documentId
}

function allWires(bundle: WireBundle | null | undefined): readonly WireSummary[] {
  return bundle ? [...bundle.outgoingWires, ...bundle.incomingWires] : []
}

/** A bundle wire as the cell now sends it: the document ends of `WireSummary`, plus an object end and a board. */
type BoardAwareWire = WireSummary & WireBoardFields

function relationItemFromWire(wire: BoardAwareWire, direction: 'outgoing' | 'incoming', boardTitle?: (id: string) => string | undefined): WorkspaceInspectorRelationItem {
  const arrow = direction === 'outgoing' ? '->' : '<-'
  const end = wireEndOf(wire)
  const board = wireBoardProvenance(wire, (id) => boardTitle?.(id))
  return {
    id: wire.id,
    primary: `${wire.predicateLabel} ${arrow} ${end.label}`,
    secondary: [
      wire.bidirectional ? 'bidirectional' : wire.otherSnippet || wire.localSnippet,
      end.kind === 'object' ? 'object' : undefined,
      board?.label,
    ].filter(Boolean).join(' - ') || undefined,
    icon: end.kind === 'object' ? 'diamond' : 'git-branch',
  }
}

/** The boards this document's wires were drawn on (other than the document itself): each opens its board. */
function drawnOnGroup(wires: readonly BoardAwareWire[], input: InspectorProjectionInput): WorkspaceInspectorRelationGroup | null {
  const seen = new Set<string>()
  const items: WorkspaceInspectorRelationItem[] = []
  for (const wire of wires) {
    const board = wireBoardProvenance(wire, (id) => input.titleOf?.(id))
    if (!board || board.boardId === input.activeDocumentId || seen.has(board.boardId)) continue
    seen.add(board.boardId)
    items.push({ id: `board:${board.boardId}`, primary: board.boardTitle, secondary: 'Wires drawn on this board', icon: 'pencil' })
  }
  return items.length ? { key: 'drawn-on', label: 'Drawn on', icon: 'pencil', items } : null
}

function commentRelation(comment: WorkspaceComment): WorkspaceInspectorRelationItem {
  return {
    id: comment.id,
    primary: truncate(comment.text || '(empty comment)', 80),
    secondary: [comment.author, comment.resolved ? 'resolved' : 'open'].filter(Boolean).join(' - '),
    icon: 'message-square',
  }
}

function activeDocumentRelations(input: InspectorProjectionInput, blockId?: string | null): WorkspaceInspectorRelations {
  const bundle = input.wireBundle
  const outgoing = (bundle?.outgoingWires ?? []).filter((wire) => blockId ? wire.localBlockId === blockId : true)
  const incoming = (bundle?.incomingWires ?? []).filter((wire) => blockId ? wire.localBlockId === blockId : true)
  const comments = (input.comments ?? []).filter((comment) => blockId ? comment.blockId === blockId : true)
  const groups: WorkspaceInspectorRelationGroup[] = [
    {
      key: 'wires',
      label: 'Wires',
      icon: 'git-branch',
      items: outgoing.map((wire) => relationItemFromWire(wire, 'outgoing', input.titleOf)),
    },
    {
      key: 'backlinks',
      label: 'Backlinks',
      icon: 'corner-up-right',
      items: incoming.map((wire) => relationItemFromWire(wire, 'incoming', input.titleOf)),
    },
    {
      key: 'comments',
      label: 'Comments',
      icon: 'message-square',
      items: comments.map(commentRelation),
    },
  ]
  // A block's backlinks are asked of the block; the document-wide read is shown on the document itself.
  const linkedFrom = blockId ? null : linkedFromGroup(input.backlinks)
  if (linkedFrom) groups.push(linkedFrom)
  const drawnOn = blockId ? null : drawnOnGroup([...outgoing, ...incoming], input)
  if (drawnOn) groups.push(drawnOn)
  return { scope: 'active', groups }
}

function selectedDocumentId(selection: SelectedObject | null): string | null {
  if (!selection) return null
  if (selection.kind === 'document' || selection.kind === 'block' || selection.kind === 'comment') {
    return valueOf(selection, 'documentId') ?? null
  }
  return null
}

export function projectInspectorModel(input: InspectorProjectionInput): WorkspaceInspectorModel | null {
  const selection = input.selection
  if (!selection) return null

  if (selection.kind === 'document') {
    const documentId = valueOf(selection, 'documentId') ?? input.activeDocumentId ?? 'unknown-document'
    const active = documentId === input.activeDocumentId
    return {
      identity: {
        kind: 'document',
        icon: active && input.activeDocumentKind === 'whiteboard' ? 'pencil' : 'file-text',
        title: documentTitle(input, documentId),
        typeLabel: active && input.activeDocumentKind === 'whiteboard' ? 'Whiteboard' : 'Document',
        chips: [
          { label: 'Graph', value: valueOf(selection, 'graphId') ?? input.graphId ?? '', mono: true },
          { label: 'Document', value: documentId, mono: true },
        ],
      },
      relations: active ? activeDocumentRelations(input) : { scope: 'inactive', groups: [] },
    }
  }

  if (selection.kind === 'comment') {
    const commentId = valueOf(selection, 'commentId') ?? 'unknown-comment'
    const comment = (input.comments ?? []).find((item) => item.id === commentId)
    const documentId = valueOf(selection, 'documentId') ?? input.activeDocumentId ?? 'unknown-document'
    const active = documentId === input.activeDocumentId
    return {
      identity: {
        kind: 'comment',
        icon: 'message-square',
        title: truncate(comment?.text || 'Comment', 60),
        typeLabel: comment?.author ? `Comment by ${comment.author}` : 'Comment',
        chips: [
          { label: 'Graph', value: valueOf(selection, 'graphId') ?? input.graphId ?? '', mono: true },
          { label: 'Document', value: documentId, mono: true },
          { label: 'Comment', value: commentId, mono: true },
          ...(comment ? [{ label: 'Status', value: comment.resolved ? 'resolved' : 'open' }] : []),
        ],
      },
      relations: active ? activeDocumentRelations(input, comment?.blockId ?? null) : { scope: 'inactive', groups: [] },
    }
  }

  if (selection.kind === 'block') {
    const documentId = valueOf(selection, 'documentId') ?? input.activeDocumentId ?? 'unknown-document'
    const blockId = valueOf(selection, 'blockId') ?? 'unknown-block'
    const active = documentId === input.activeDocumentId
    return {
      identity: {
        kind: 'block',
        icon: 'hash',
        title: `Block in ${documentTitle(input, documentId)}`,
        typeLabel: 'Block',
        chips: [
          { label: 'Graph', value: valueOf(selection, 'graphId') ?? input.graphId ?? '', mono: true },
          { label: 'Document', value: documentId, mono: true },
          { label: 'Block', value: blockId, mono: true },
        ],
      },
      relations: active ? activeDocumentRelations(input, blockId) : { scope: 'inactive', groups: [] },
    }
  }

  if (selection.kind === 'wire') {
    const wireId = valueOf(selection, 'wireId') ?? 'unknown-wire'
    const wire = allWires(input.wireBundle).find((item) => item.id === wireId)
    return {
      identity: {
        kind: 'wire',
        icon: 'git-branch',
        title: wire ? `${wire.predicateLabel} -> ${wireEndOf(wire).label}` : 'Wire',
        typeLabel: 'Wire',
        chips: [
          { label: 'Graph', value: valueOf(selection, 'graphId') ?? input.graphId ?? '', mono: true },
          { label: 'Wire', value: wireId, mono: true },
          ...(wire?.bidirectional ? [{ label: 'Direction', value: 'bidirectional' }] : []),
        ],
      },
      relations: { scope: 'none', groups: [] },
    }
  }

  if (selection.kind === 'graph') {
    const graphId = valueOf(selection, 'graphId') ?? input.graphId ?? 'unknown-graph'
    return {
      identity: {
        kind: 'graph',
        icon: 'database',
        title: input.graphTitle || graphId,
        typeLabel: 'Workspace',
        chips: [{ label: 'Graph', value: graphId, mono: true }],
      },
      relations: { scope: 'none', groups: [] },
    }
  }

  if (selection.kind === 'folder') {
    const graphId = valueOf(selection, 'graphId') ?? input.graphId ?? 'unknown-graph'
    const folderId = valueOf(selection, 'folderId') ?? 'unknown-folder'
    return {
      identity: {
        kind: 'folder',
        icon: 'folder',
        title: valueOf(selection, 'label') ?? folderId,
        typeLabel: 'Folder',
        chips: [
          { label: 'Graph', value: graphId, mono: true },
          { label: 'Folder', value: folderId, mono: true },
        ],
      },
      relations: { scope: 'none', groups: [] },
    }
  }

  if (selection.kind === 'artifact') {
    const graphId = valueOf(selection, 'graphId') ?? input.graphId ?? 'unknown-graph'
    const artifactId = valueOf(selection, 'artifactId') ?? 'unknown-artifact'
    const mimeType = valueOf(selection, 'mimeType')
    const status = valueOf(selection, 'status')
    const ingestedDocumentId = valueOf(selection, 'ingestedDocumentId')
    return {
      identity: {
        kind: 'artifact',
        icon: 'diamond',
        title: valueOf(selection, 'label') ?? artifactId,
        typeLabel: 'Artifact',
        chips: [
          { label: 'Graph', value: graphId, mono: true },
          { label: 'Artifact', value: artifactId, mono: true },
          ...(mimeType ? [{ label: 'MIME', value: mimeType }] : []),
          ...(status ? [{ label: 'Status', value: status }] : []),
          ...(ingestedDocumentId ? [{ label: 'Ingested doc', value: ingestedDocumentId, mono: true }] : []),
        ],
      },
      relations: { scope: 'none', groups: [] },
    }
  }

  const graphId = valueOf(selection, 'graphId') ?? input.graphId ?? 'unknown-graph'
  return {
    identity: {
      kind: selection.kind,
      icon: 'info',
      title: selection.kind,
      typeLabel: 'Object',
      chips: [{ label: 'Graph', value: graphId, mono: true }],
    },
    relations: { scope: 'none', groups: [] },
  }
}

export function projectInspectorActions(input: InspectorProjectionInput): readonly WorkspaceInspectorAction[] {
  const selection = input.selection
  if (!selection || selection.kind !== 'comment') return []
  const commentId = valueOf(selection, 'commentId')
  const comment = commentId ? (input.comments ?? []).find((item) => item.id === commentId) : null
  if (!comment) return []
  return [
    { type: 'header', content: 'Comment' },
    {
      id: 'comment.resolve',
      label: comment.resolved ? 'Reopen comment' : 'Resolve comment',
      icon: comment.resolved ? 'undo' : 'check',
    },
    {
      id: 'comment.delete',
      label: 'Delete comment',
      icon: 'trash',
      variant: 'danger',
    },
  ]
}

export function activeDocumentSelection(
  graphId: string | null,
  documentId: string | null,
): SelectedObject | null {
  return graphId && documentId ? { kind: 'document', graphId, documentId } : null
}

export function selectionDocumentId(selection: SelectedObject | null): string | null {
  return selectedDocumentId(selection)
}
