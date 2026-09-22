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
  readonly status?: string | null
  readonly ingestedDocumentId?: string | null
}

export interface FilePaneSection {
  readonly id: string
  readonly label: string
  readonly icon?: string
  readonly nodes?: readonly FilePaneNode[]
  readonly count?: number | null
  readonly collapsed?: boolean
  readonly emptyLabel?: string
}

export interface FilePaneSort {
  readonly criterion: FilePaneSortCriterion
  readonly direction: FilePaneSortDirection
  readonly foldersFirst?: boolean
}

export interface FilePaneGrouping {
  readonly separateArtifacts: boolean
  readonly showFolders: boolean
}

export const DEFAULT_FILE_PANE_SORT: FilePaneSort = Object.freeze({
  criterion: 'manual',
  direction: 'asc',
  foldersFirst: true,
})

export const DEFAULT_FILE_PANE_GROUPING: FilePaneGrouping = Object.freeze({
  separateArtifacts: true,
  showFolders: true,
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
