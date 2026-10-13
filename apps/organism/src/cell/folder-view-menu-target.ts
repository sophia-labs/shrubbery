import { folderViewKey, type FolderViewScope, type WorkspaceFileRef } from '@shrubbery/nucleus'

/** A retained menu has no authority to open a reused ID after its scope changes. */
export function resolveFilesMenuTarget(target: { readonly scope: FolderViewScope; readonly file: WorkspaceFileRef },
  activeScope: FolderViewScope, visibleFiles: readonly WorkspaceFileRef[]): WorkspaceFileRef | null {
  try {
    if (folderViewKey(target.scope) !== folderViewKey(activeScope)) return null
  } catch { return null }
  const file = target.file
  if (file.ownerId !== activeScope.ownerId || file.graphId !== activeScope.graphId || file.graphIncarnation !== activeScope.graphIncarnation) return null
  return visibleFiles.find(current => current.ownerId === file.ownerId && current.graphId === file.graphId &&
    current.graphIncarnation === file.graphIncarnation && current.kind === file.kind && current.id === file.id) ?? null
}
