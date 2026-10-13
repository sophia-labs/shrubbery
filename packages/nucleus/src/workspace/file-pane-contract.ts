/**
 * Plain, backend-free contract for Garden's adaptive file pane.
 *
 * Nucleus owns the vocabulary so the Lit component, render host, and app shell
 * cannot drift into parallel near-copies. Model derivation and rendering live in
 * higher packages; persistence and effects remain shell-owned.
 */

export type FilePaneNodeKind = 'folder' | 'document' | 'artifact' | 'tag'
/** Semantic tone for `FilePaneNode.badge`, when the badge is source-derived
 *  (master spec §3 Slice 4). Independent of `badge`'s literal text — a
 *  structural mirror of `@shrubbery/components`' `MnBadgeState`, kept here
 *  rather than imported so nucleus stays free of a components dependency. */
export type FilePaneBadgeTone = 'neutral' | 'active' | 'success' | 'warning' | 'danger'
/**
 * The document-plane source truth one document node carries, when any
 * (master spec §3 Slice 4, §5 "Wayfinding"). Document-plane truths ONLY —
 * Law I merges documents, so a document is never "contested"; only
 * "pending" (an unsent local write) or "parked" (a Law VI fence) apply.
 */
export type FilePaneSourceState = 'pending' | 'parked'
export type FilePanePresentation = 'tree' | 'columns'
export type FilePaneResolvedPresentation = FilePanePresentation | 'search-results'
export type FilePaneSortCriterion =
  | 'manual'
  | 'alphabetical'
  | 'created'
  | 'last-accessed'
  | 'connectivity'
export type FilePaneSortDirection = 'asc' | 'desc'
export type FilePaneStatus = 'idle' | 'loading' | 'ready' | 'reconnecting' | 'disconnected' | 'error'
export type FilePaneDropPosition = 'before' | 'inside' | 'after'
export type FilePaneOperationAction =
  | 'open-document'
  | 'switch-workspace'
  | 'create-workspace'
  | 'create-document'
  | 'create-folder'
  | 'rename'
  | 'delete'
  | 'move'
  | 'refresh'
export type FilePaneOperationState = 'pending' | 'success' | 'terminal-error' | 'indeterminate'
export type FilePaneAction =
  | 'new-document'
  | 'upload'
  | 'new-folder'
  | 'refresh'
  | 'node-menu'
  | 'rename'
  | 'move'
  | 'delete'

export interface FilePaneNode {
  readonly id: string
  readonly label: string
  readonly kind?: FilePaneNodeKind
  readonly icon?: string
  readonly parentId?: string | null
  readonly section?: 'documents' | 'artifacts' | string | null
  readonly order?: number | null
  readonly createdAt?: number
  readonly lastAccessedAt?: number
  readonly connectivity?: number
  readonly children?: readonly FilePaneNode[]
  readonly expanded?: boolean
  readonly selected?: boolean
  readonly active?: boolean
  readonly disabled?: boolean
  readonly readOnly?: boolean
  readonly sourceFile?: {
    readonly storageKey?: string | null
    readonly originalFilename?: string | null
    readonly mimeType?: string | null
    readonly sizeBytes?: number | null
    readonly fileType?: string | null
  } | null
  readonly badge?: string | null
  /** Styling tone for `badge`, when it is source-derived (master §3 Slice 4). */
  readonly badgeTone?: FilePaneBadgeTone | null
  /** The document-plane source truth this node carries, when any. */
  readonly sourceState?: FilePaneSourceState | null
  readonly count?: number | null
  readonly mimeType?: string | null
  readonly fileType?: string | null
  /**
   * The node's LIFECYCLE state (`FILE_PANE_LIFECYCLES`), one word. Never copy:
   * not "Saved in this browser", not "Sample metadata". Persistence belongs to
   * the pane's status line, provenance to the margin. A quiet node ('ready', or
   * no status) draws nothing; read it through `filePaneLifecycle`, which is the
   * one place that decides what is worth drawing.
   */
  readonly status?: string | null
  readonly ingestedDocumentId?: string | null
}

/** The lifecycle states a file node can be in. `ready` is the quiet default. */
export const FILE_PANE_LIFECYCLES = ['ready', 'uploading', 'processing', 'unavailable', 'error'] as const
export type FilePaneLifecycle = (typeof FILE_PANE_LIFECYCLES)[number]

/**
 * The lifecycle state a node asks to be drawn with, or null for the quiet
 * default. A ready node is quiet. So is a status that is not a lifecycle word:
 * a lifecycle state is ONE token, and a sentence is copy that a producer put in
 * the wrong field (review G1: six file rows once read "SAVED IN THIS BROWSER"
 * and nothing else). An unfamiliar single word still passes through, so a new
 * lifecycle word from a producer is shown rather than lost.
 */
export function filePaneLifecycle(node: Pick<FilePaneNode, 'status'>): string | null {
  const status = node.status?.trim()
  if (!status || /\s/.test(status)) return null
  const word = status.toLowerCase()
  return word === 'ready' || word === 'idle' ? null : status
}

/** One action a section may carry beside its header (the Files section's "Open Files"). The host decides what it does. */
export interface FilePaneSectionAction {
  readonly id: string
  readonly label: string
  readonly icon?: string
}

export interface FilePaneSection {
  readonly id: string
  readonly label: string
  readonly icon?: string
  readonly nodes?: readonly FilePaneNode[]
  readonly count?: number | null
  readonly collapsed?: boolean
  readonly emptyLabel?: string
  /** Optional; drawn as its own button beside the header and emitted as `mn-sidebar-section-action`. */
  readonly action?: FilePaneSectionAction
}

export interface FilePaneSort {
  readonly criterion: FilePaneSortCriterion
  readonly direction: FilePaneSortDirection
  readonly foldersFirst?: boolean
}

/** One tree, one kind filter: everything in the place, only documents, or only files (uploaded artifacts). */
export type FilePaneKindFilter = 'all' | 'documents' | 'files'

export interface FilePaneGrouping {
  readonly separateArtifacts: boolean
  readonly showFolders: boolean
  /** Absent means 'all'. */
  readonly kind?: FilePaneKindFilter
}

export const DEFAULT_FILE_PANE_SORT: FilePaneSort = Object.freeze({
  criterion: 'manual',
  direction: 'asc',
  foldersFirst: true,
})

export const DEFAULT_FILE_PANE_GROUPING: FilePaneGrouping = Object.freeze({
  separateArtifacts: true,
  showFolders: true,
  kind: 'all',
})

export interface FilePaneCapabilities {
  readonly createDocument?: boolean
  readonly upload?: boolean
  readonly createFolder?: boolean
  readonly refresh?: boolean
  readonly sort?: boolean
  readonly group?: boolean
  readonly multiSelect?: boolean
  readonly dragDrop?: boolean
  readonly contextMenu?: boolean
}

export interface FilePaneStorage {
  readonly usedBytes: number
  readonly limitBytes: number
  readonly label?: string
}

/**
 * Host-controlled truth for one file-pane operation. `id` is a client
 * correlation id unless the host explicitly maps it to a backend id.
 */
export interface FilePaneOperationFeedback {
  readonly id: string
  readonly action: FilePaneOperationAction
  readonly state: FilePaneOperationState
  readonly nodeId?: string
  readonly graphId?: string
  readonly label?: string
  readonly message?: string
  readonly retryable?: boolean
  /** True only while checking authoritative state after an ambiguous outcome. */
  readonly reconciling?: boolean
}

export interface FilePaneNodeDetail {
  readonly id: string
  readonly node: FilePaneNode
}

export interface FilePaneNodeDropDetail {
  readonly sourceId: string
  readonly source: FilePaneNode
  readonly targetId: string
  readonly target: FilePaneNode
  readonly position: FilePaneDropPosition
}

export interface FilePaneActionDetail {
  readonly action: FilePaneAction
  readonly nodeId?: string
  readonly node?: FilePaneNode
  readonly nodeIds?: readonly string[]
  readonly nodes?: readonly FilePaneNode[]
  readonly clientX?: number
  readonly clientY?: number
  /**
   * A user-edited label proposed by a direct-manipulation surface. The host
   * remains responsible for validating and committing it through Garden.
   */
  readonly proposedLabel?: string
}

export interface FilePaneSelectionDetail {
  readonly ids: readonly string[]
  readonly nodes: readonly FilePaneNode[]
  readonly anchorId: string | null
}

export interface FilePaneSortChangeDetail {
  readonly sort: FilePaneSort
}

export interface FilePaneGroupingChangeDetail {
  readonly grouping: FilePaneGrouping
}

export interface FilePaneColumnPathChangeDetail {
  readonly sectionId: string
  readonly folderIds: readonly string[]
}
