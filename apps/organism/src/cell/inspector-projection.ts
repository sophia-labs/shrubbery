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
  WireBundle,
  WireSummary,
  WorkspaceComment,
  WorkspaceInspectorAction,
  WorkspaceInspectorModel,
  WorkspaceInspectorRelationGroup,
  WorkspaceInspectorRelationItem,
  WorkspaceInspectorRelations,
} from '@shrubbery/runtime'

export interface InspectorProjectionInput {
  readonly selection: SelectedObject | null
  readonly graphId: string | null
  readonly graphTitle?: string | null
  readonly activeDocumentId: string | null
  readonly activeDocumentTitle?: string | null
  readonly wireBundle?: WireBundle | null
  readonly comments?: readonly WorkspaceComment[]
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

function relationItemFromWire(wire: WireSummary, direction: 'outgoing' | 'incoming'): WorkspaceInspectorRelationItem {
  const arrow = direction === 'outgoing' ? '->' : '<-'
  return {
    id: wire.id,
    primary: `${wire.predicateLabel} ${arrow} ${wire.otherTitle || wire.otherDocumentId}`,
    secondary: wire.bidirectional ? 'bidirectional' : wire.otherSnippet || wire.localSnippet,
    icon: 'git-branch',
  }
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
      items: outgoing.map((wire) => relationItemFromWire(wire, 'outgoing')),
    },
    {
      key: 'backlinks',
      label: 'Backlinks',
      icon: 'corner-up-right',
      items: incoming.map((wire) => relationItemFromWire(wire, 'incoming')),
    },
    {
      key: 'comments',
      label: 'Comments',
      icon: 'message-square',
      items: comments.map(commentRelation),
    },
  ]
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
        icon: 'file-text',
        title: documentTitle(input, documentId),
        typeLabel: 'Document',
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
        title: wire ? `${wire.predicateLabel} -> ${wire.otherTitle || wire.otherDocumentId}` : 'Wire',
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
