import type { FileEvidence } from './files-evidence.js'

/**
 * Folder presentation contract, to be bound to Meaningful Objects by the shell.
 * This is neither a filesystem nor a serialized Excalidraw scene. No authority
 * implementation is implied by declaring these ports.
 */
export interface FolderViewScope {
  readonly ownerId: string
  readonly graphId: string
  readonly graphIncarnation: string
  readonly folderId: string | null
  readonly viewId: string
  /** Personal preference is a domain scope, not an ACL grant. */
  readonly audience: { readonly kind: 'shared' } | { readonly kind: 'personal'; readonly userId: string }
}

export interface WorkspaceFileRef {
  readonly ownerId: string
  readonly graphId: string
  readonly graphIncarnation: string
  readonly kind: 'folder' | 'document' | 'artifact'
  readonly id: string
}

/** Class-level current-state objects; use the source ledger's opaque causal versions. */
export interface FolderViewRecord {
  readonly schemaVersion: 1
  readonly scope: FolderViewScope
  readonly presentation: 'canvas' | 'list'
  readonly sort: 'manual' | 'name' | 'type' | 'modified'
  readonly direction: 'asc' | 'desc'
  readonly iconSize: 'small' | 'medium' | 'large'
  readonly snapToGrid: boolean
}

/** One object per placed file prevents an unrelated drag from replacing the whole folder. */
export interface FilePlacementRecord {
  readonly schemaVersion: 1
  readonly scope: FolderViewScope
  readonly file: WorkspaceFileRef
  readonly coordinateSpace: 'folder-canvas'
  readonly x: number
  readonly y: number
}

export interface FolderViewRead<T> {
  readonly record: T | null
  readonly baseVersion: string
  readonly conflictId: string | null
}

export type FolderViewWriteResult =
  | { readonly status: 'applied'; readonly operationId: string; readonly version: string }
  | { readonly status: 'pending'; readonly operationId: string }
  | { readonly status: 'contested'; readonly operationId: string; readonly conflictId: string }
  | { readonly status: 'rejected'; readonly operationId: string; readonly reason: string }

export interface FolderViewWrite<T> {
  /** Reuse this for delivery retry; never mint a fresh id to hide an ambiguous outcome. */
  readonly operationId: string
  readonly baseVersion: string
  readonly record: T
}

export interface FolderViewPort {
  readView(scope: FolderViewScope): Promise<FolderViewRead<FolderViewRecord>>
  readPlacements(scope: FolderViewScope): Promise<readonly FolderViewRead<FilePlacementRecord>[]>
  writeView(write: FolderViewWrite<FolderViewRecord>): Promise<FolderViewWriteResult>
  writePlacement(write: FolderViewWrite<FilePlacementRecord>): Promise<FolderViewWriteResult>
}

// A scope is immutable, and a projection of a few hundred placements hands the same scope object to every one of
// them: its key is computed once per object.
const scopeKeys = new WeakMap<FolderViewScope, string>()

export function folderViewKey(scope: FolderViewScope): string {
  const known = scopeKeys.get(scope)
  if (known !== undefined) return known
  if ((scope.folderId !== null && !scope.folderId.trim()) || (scope.audience.kind === 'personal' && !scope.audience.userId.trim())) {
    throw new Error('Folder view requires a complete identity')
  }
  const parts = [scope.ownerId, scope.graphId, scope.graphIncarnation,
    scope.folderId === null ? 'root' : `folder:${scope.folderId}`, scope.viewId,
    scope.audience.kind === 'shared' ? 'shared' : `personal:${scope.audience.userId}`]
  if (parts.some(part => !part.trim())) throw new Error('Folder view requires a complete identity')
  const key = parts.map(encodeURIComponent).join('/')
  scopeKeys.set(scope, key)
  return key
}

export function filePlacementKey(record: FilePlacementRecord): string {
  const { scope, file } = record
  if (file.ownerId !== scope.ownerId || file.graphId !== scope.graphId || file.graphIncarnation !== scope.graphIncarnation) {
    throw new Error('A placement must refer to the same workspace incarnation')
  }
  if (!file.id.trim() || !Number.isFinite(record.x) || !Number.isFinite(record.y) || record.coordinateSpace !== 'folder-canvas') {
    throw new Error('Invalid folder-canvas placement')
  }
  return `${folderViewKey(scope)}/${file.kind}/${encodeURIComponent(file.id)}`
}

// ---------------------------------------------------------------------------
// Files canvas contract, version 2 (additive).
//
// The canvas consumes a projection (`FileCanvasInput`) and emits typed intents
// (`FileCanvasIntent`); it holds no store, no port and no callback that mutates.
// Everything below `FileCanvasSession` of version 1 is optional for inputs and a
// new member of the intent union, so a shell written against version 1 keeps
// compiling and simply never sees (or ignores) the new kinds.
// ---------------------------------------------------------------------------

/**
 * Identity of one file inside one workspace incarnation: the JSON of
 * `[ownerId, graphId, graphIncarnation, kind, id]`. Stable across projections;
 * the one spelling every layer (scene, reducer, shell) uses as a map key.
 */
export type FileKey = string

const fileKeys = new WeakMap<WorkspaceFileRef, FileKey>()

export function fileKey(file: WorkspaceFileRef): FileKey {
  const known = fileKeys.get(file)
  if (known !== undefined) return known
  const key = JSON.stringify([file.ownerId, file.graphId, file.graphIncarnation, file.kind, file.id])
  fileKeys.set(file, key)
  return key
}

/** Ephemeral renderer state. Camera, selection and open editors do not write shared preferences. */
export interface FileCanvasSession {
  readonly selected: readonly WorkspaceFileRef[]
  /** `viewport = (scene + {x, y}) * zoom`: Excalidraw's convention, host-owned and echoed to the shell. */
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number }
  /** Kept for compatibility; `naming` supersedes it. */
  readonly editingName: WorkspaceFileRef | null
  /** Keyboard focus: separate from selection, visible only from the keyboard. */
  readonly focused?: WorkspaceFileRef | null
  /**
   * A name edit the shell asks the canvas to show in place (a new-folder draft, or a rename
   * the shell started). `error` keeps the input mounted after a failed commit.
   */
  readonly naming?: FileCanvasNaming | null
  /** Files marked by Cut (dimmed until pasted or cancelled); survives navigation, so the shell holds it. */
  readonly cut?: readonly WorkspaceFileRef[]
}

export interface FileCanvasNaming {
  readonly target: WorkspaceFileRef | { readonly draftId: string }
  readonly initial: string
  readonly error: string | null
}

/** What the host reports back to the shell about the session it owns (camera and focus are not intents). */
export interface FileCanvasSessionPatch {
  readonly camera?: { readonly x: number; readonly y: number; readonly zoom: number }
  readonly focused?: WorkspaceFileRef | null
  readonly cut?: readonly WorkspaceFileRef[]
}

/**
 * One flag per verb. A verb that is absent here is absent from the menu the host builds and
 * bound to no key (Law 6); there is no "disabled" rendering of a verb that cannot work.
 */
export interface FileCanvasCapabilities {
  readonly place: boolean
  readonly move: boolean
  readonly rename: boolean
  readonly create: boolean
  readonly add: boolean
  readonly remove: boolean
  readonly connect: boolean
  readonly openBeside: boolean
}

export const NO_FILE_CANVAS_CAPABILITIES: FileCanvasCapabilities = Object.freeze({
  place: false, move: false, rename: false, create: false, add: false, remove: false, connect: false, openBeside: false,
})

/**
 * `capabilities` wins when present. Otherwise the deprecated all-or-nothing `canEdit` stands for the
 * verbs version 1 knew (place, move, rename): shells ignore intent kinds they do not know, so a verb
 * they cannot honour must not be offered.
 */
export function resolveCapabilities(input: {
  readonly capabilities?: FileCanvasCapabilities
  readonly canEdit?: boolean
}): FileCanvasCapabilities {
  if (input.capabilities) return input.capabilities
  return input.canEdit === true
    ? { ...NO_FILE_CANVAS_CAPABILITIES, place: true, move: true, rename: true }
    : NO_FILE_CANVAS_CAPABILITIES
}

export interface FileCanvasNode {
  readonly file: WorkspaceFileRef
  readonly label: string
  /** A short type caption for the glyph and the accessible name ('PDF', 'PNG'); display only, never an identity. */
  readonly type?: string
  /** What the reader found in a datasheet (plans/2026-10-08-datasheets-in-sophia.md §3); absent for any other file, which then renders as before. */
  readonly evidence?: FileEvidence
}

/** Version 1 display projection of a semantic relation. Superseded by `FileCanvasConnection`. */
export interface FileCanvasWire {
  readonly id: string
  readonly source: WorkspaceFileRef
  readonly target: WorkspaceFileRef
  readonly label: string
}

/** A relation between two files; endpoints are files, never pixels. Replaces `FileCanvasWire`. */
export interface FileCanvasConnection {
  readonly id: string
  readonly source: WorkspaceFileRef
  readonly target: WorkspaceFileRef
  readonly relation: string
  readonly label: string
  readonly state: 'proposed' | 'disputed' | 'endorsed'
  readonly attribution: string | null
}

/** One candidate position of a file whose placement is contested. */
export interface PlacementCandidate {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly origin: 'this-tab' | 'other'
  /** Display label of the origin ("other tab"), never a coordinate. */
  readonly label: string
  /** Epoch milliseconds the candidate was written. */
  readonly at: number
}

export interface PlacementContest {
  readonly file: WorkspaceFileRef
  readonly candidates: readonly PlacementCandidate[]
}

/** A folder being named before it exists: the pending card the input sits on. */
export interface FileCanvasDraft {
  readonly draftId: string
  readonly kind: 'folder'
  readonly label: string
  readonly placement: { readonly x: number; readonly y: number }
}

export type FileCanvasPlacementState = 'applied' | 'pending' | 'contested' | 'rejected'

export interface FileCanvasRelation {
  readonly uri: string
  readonly label: string
}

export interface FileCanvasView {
  readonly iconSize: 'small' | 'medium' | 'large'
  readonly snapToGrid: boolean
}

/** The canvas input: one folder's projection, with the verbs the shell can honour. */
export interface FileCanvasInput {
  readonly scope: FolderViewScope
  readonly nodes: readonly FileCanvasNode[]
  readonly placements: readonly FilePlacementRecord[]
  readonly session: FileCanvasSession
  /** Per-verb capabilities. Absent: derived from the deprecated `canEdit` by `resolveCapabilities`. */
  readonly capabilities?: FileCanvasCapabilities
  /** @deprecated all-or-nothing alias of `capabilities`; kept so version 1 shells compile unchanged. */
  readonly canEdit?: boolean
  /** Opaque source-head signature, including changes with identical coordinates. */
  readonly authorityVersion?: string
  readonly view?: FileCanvasView
  readonly contests?: readonly PlacementContest[]
  /** Keyed by `fileKey`. `pending` and `contested` lock that one card; nothing else is frozen. */
  readonly placementStates?: Readonly<Record<FileKey, FileCanvasPlacementState>>
  readonly drafts?: readonly FileCanvasDraft[]
  readonly connections?: readonly FileCanvasConnection[]
  /** @deprecated version 1 wires; used only when `connections` is absent. */
  readonly wires?: readonly FileCanvasWire[]
  /** The relation picker's vocabulary. */
  readonly relations?: readonly FileCanvasRelation[]
  /** The layer toggle: false hides every connector. */
  readonly connectionsVisible?: boolean
}

/**
 * Only named file intentions may cross the canvas boundary. Version 2 adds members; it changes none.
 * Shells ignore the kinds they do not know.
 */
export type FileCanvasIntent =
  | { readonly kind: 'select'; readonly files: readonly WorkspaceFileRef[] }
  | { readonly kind: 'open'; readonly file: WorkspaceFileRef; readonly beside?: boolean }
  | { readonly kind: 'menu'; readonly files: readonly WorkspaceFileRef[]; readonly clientX: number; readonly clientY: number
      /** Scene point under the pointer: where a background menu's "New folder" belongs. */
      readonly at?: { readonly x: number; readonly y: number } }
  | { readonly kind: 'rename'; readonly file: WorkspaceFileRef; readonly name: string }
  /** Escape in a name edit, or a commit that changed nothing. */
  | { readonly kind: 'name-cancel' }
  /** `previous` is where the same files stood (an auto-slotted card at its slot), in the same order, so a shell can undo the placement. */
  | { readonly kind: 'place'; readonly placements: readonly FilePlacementRecord[]; readonly previous?: readonly FilePlacementRecord[] }
  | { readonly kind: 'move'; readonly files: readonly WorkspaceFileRef[]; readonly folder: WorkspaceFileRef | null }
  /** The canvas asks the shell for a folder draft at a free slot (the shell answers with `drafts` + `session.naming`). */
  | { readonly kind: 'new-folder'; readonly placement: { readonly x: number; readonly y: number } }
  | { readonly kind: 'create'; readonly objectKind: 'folder'; readonly parent: WorkspaceFileRef | null; readonly name: string
      readonly placement: { readonly x: number; readonly y: number }; readonly draftId: string }
  /** An OS drop. `files` is a DOM `FileList` in the browser; any array-like of `File` in node. */
  | { readonly kind: 'add'; readonly files: ArrayLike<File>; readonly folder: WorkspaceFileRef | null
      readonly placement?: { readonly x: number; readonly y: number } }
  | { readonly kind: 'remove'; readonly files: readonly WorkspaceFileRef[] }
  | { readonly kind: 'connect'; readonly source: WorkspaceFileRef; readonly target: WorkspaceFileRef
      readonly relation: string; readonly label?: string }
  | { readonly kind: 'disconnect'; readonly connectionId: string }
  /**
   * Settle a contested position by choosing one candidate. The deliberate exception to "every change has an inverse": it settles a
   * contest between positions that were each somebody's decision, so the shell's journal keeps it as a barrier and Undo says so
   * instead of reaching past it (see `files-canvas/journal.ts`).
   */
  | { readonly kind: 'choose-placement'; readonly file: WorkspaceFileRef; readonly candidateId: string }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }

// PDF-user-space geometry belongs to PdfSourceAnchorV1. It is never inferred
// from folder-canvas positions, Excalidraw zoom, DOM rectangles or file-card size.
