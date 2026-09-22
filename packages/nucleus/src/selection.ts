/**
 * Structural selection model shared by command predicates.
 *
 * Shrubbery does not yet have Garden's full selected-object bus; this keeps the
 * command registry stable while allowing app shells to pass richer objects.
 */

export interface SelectedDocument {
  readonly kind: 'document'
  readonly graphId: string
  readonly documentId: string
  readonly [key: string]: unknown
}

export interface SelectedBlock {
  readonly kind: 'block'
  readonly graphId: string
  readonly documentId: string
  readonly blockId: string
  readonly [key: string]: unknown
}

export interface SelectedGraph {
  readonly kind: 'graph'
  readonly graphId: string
  readonly [key: string]: unknown
}

export interface SelectedWire {
  readonly kind: 'wire'
  readonly graphId: string
  readonly wireId: string
  readonly [key: string]: unknown
}

export interface SelectedComment {
  readonly kind: 'comment'
  readonly graphId?: string
  readonly commentId: string
  readonly [key: string]: unknown
}

export interface SelectedFolder {
  readonly kind: 'folder'
  readonly graphId: string
  readonly folderId: string
  readonly [key: string]: unknown
}

export interface SelectedArtifact {
  readonly kind: 'artifact'
  readonly graphId: string
  readonly artifactId: string
  readonly [key: string]: unknown
}

export interface SelectedUnknown {
  readonly kind: string
  readonly [key: string]: unknown
}

export type SelectedObject =
  | SelectedDocument
  | SelectedBlock
  | SelectedGraph
  | SelectedWire
  | SelectedComment
  | SelectedFolder
  | SelectedArtifact
  | SelectedUnknown

/**
 * The address a `navigatesTo` edge opens as the active surface — distinct from a
 * `SelectedObject`. A selection is currency that flows over the bus (what is
 * PICKED); a `NavResource` is a COMMAND to swap which document the editor mounts
 * (what is OPENED), so it never touches the selection bus. Mirrors the shell's
 * OpenDocumentDetail (the OPEN_DOCUMENT navigation seam): a document is addressed
 * by its graph + document ids, with an optional block to focus once open.
 *
 * Lives here (selection-adjacent, pure) so BOTH the runtime edge-interpreter and
 * the organism shell import the one type — the interpreter's `FacePort.navigate`
 * consumes it, the shell's `face:editor.navigate` forwards it to openDocumentFromShell.
 */
export interface NavResource {
  readonly graphId: string
  readonly documentId: string
  readonly blockId?: string
}
