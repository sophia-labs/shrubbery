/** A view of existing FilePaneSections, not another filesystem authority. */
import { filePaneLifecycle, type FilePaneNode, type FilePaneSection, type MenuItemEntry } from '@shrubbery/nucleus'
import type { WorkspaceInspectorModel } from '@shrubbery/runtime'

export function fileKey(node: FilePaneNode): string { return `${node.kind ?? 'document'}:${node.id}` }

export interface FileWorkspaceEntry {
  readonly key: string
  readonly node: FilePaneNode
  readonly parentKey: string | null
}

export interface FileWorkspaceProjection {
  readonly entries: ReadonlyMap<string, FileWorkspaceEntry>
  readonly sections: readonly FilePaneSection[]
  readonly folderId: string | null
  readonly nodes: readonly FilePaneNode[]
  readonly selection: readonly string[]
  readonly breadcrumbs: readonly { id: string | null; label: string }[]
}

export function projectFileWorkspace(
  sections: readonly FilePaneSection[], folderId: string | null, selectedIds: readonly string[],
): FileWorkspaceProjection {
  const entries = new Map<string, FileWorkspaceEntry>()
  function project(nodes: readonly FilePaneNode[], parentKey: string | null): FilePaneNode[] {
    return nodes.filter(n => n.kind !== 'tag').flatMap(node => {
      const key = fileKey(node)
      if (entries.has(key)) return [] // A malformed repeated reference must not recurse forever.
      entries.set(key, { key, node, parentKey })
      return [{ ...node, id: key, parentId: parentKey, selected: false, active: false,
        children: project(node.children ?? [], key) }]
    })
  }
  const tree = sections.filter(s => s.id === 'tree' || s.id === 'documents' || s.id === 'artifacts')
    .map(s => ({ ...s, nodes: project(s.nodes ?? [], null) }))
  const folder = folderId ? entries.get(folderId) : null
  const current = folder?.node.kind === 'folder' ? folderId : null
  const children = new Map<string, FilePaneNode>()
  const visit = (nodes: readonly FilePaneNode[]) => {
    for (const node of nodes) { children.set(node.id, node); visit(node.children ?? []) }
  }
  tree.forEach(s => visit(s.nodes))
  const nodes = current ? children.get(current)?.children ?? [] : tree.flatMap(s => s.nodes)
  const breadcrumbs: { id: string | null; label: string }[] = []
  let at = current
  while (at) {
    const entry = entries.get(at)!
    breadcrumbs.unshift({ id: at, label: entry.node.label })
    at = entry.parentKey
  }
  breadcrumbs.unshift({ id: null, label: 'Files' })
  return { entries, sections: tree, folderId: current, nodes,
    selection: [...new Set(selectedIds)].filter(id => entries.has(id)), breadcrumbs }
}

/** Stable, deduplicated file membership, including the descendants of selected folders. */
export function fileActionScope(view: FileWorkspaceProjection, ids: readonly string[]): FileWorkspaceEntry[] {
  const scope = new Set(ids)
  let changed = true
  while (changed) {
    changed = false
    for (const entry of view.entries.values()) {
      if (entry.parentKey && scope.has(entry.parentKey) && !scope.has(entry.key)) {
        scope.add(entry.key); changed = true
      }
    }
  }
  return [...view.entries.values()].filter(e => scope.has(e.key) && e.node.kind !== 'folder')
}

export function fileWorkspaceActions(view: FileWorkspaceProjection, writable: boolean): readonly MenuItemEntry[] {
  const ids = view.selection
  const scope = fileActionScope(view, ids.length ? ids : view.folderId ? [view.folderId] : view.nodes.map(n => n.id))
  return [
    { id: 'open', label: 'Open', icon: 'external-link', disabled: ids.length !== 1 },
    { id: 'rename', label: 'Rename…', icon: 'pencil', disabled: !writable || ids.length !== 1 },
    { id: 'move', label: 'Move to folder…', icon: 'folder', disabled: !writable || !ids.length },
    { id: 'new-folder', label: 'New folder…', icon: 'folder', disabled: !writable },
    // Deliberately disabled until a real Choreograph job can be started and observed.
    { id: 'read', label: `Read thoroughly${scope.length > 1 ? ` · ${scope.length} files` : ''}`, icon: 'book-open', disabled: true },
    { id: 'voice', label: 'Give a voice', icon: 'message-circle', disabled: true },
  ]
}

export function fileWorkspaceInspector(view: FileWorkspaceProjection): WorkspaceInspectorModel {
  const selected = view.selection.map(id => view.entries.get(id)!)
  const one = selected.length === 1 ? selected[0] : !selected.length && view.folderId ? view.entries.get(view.folderId) : null
  const ids = view.selection.length ? view.selection : view.folderId ? [view.folderId] : view.nodes.map(n => n.id)
  const scope = fileActionScope(view, ids)
  const knownSizes = scope.map(e => e.node.sourceFile?.sizeBytes).filter((n): n is number => typeof n === 'number')
  const bytes = knownSizes.reduce((a, b) => a + b, 0)
  const size = knownSizes.length ? `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(bytes / 1024)} KB${knownSizes.length < scope.length ? ' known' : ''}` : 'Not available'
  const entry = one?.node
  const path = one ? (() => {
    const parts: string[] = []
    let at = one.parentKey
    while (at) { const parent = view.entries.get(at)!; parts.unshift(parent.node.label); at = parent.parentKey }
    return ['Files', ...parts].join(' / ')
  })() : view.breadcrumbs.map(c => c.label).join(' / ')
  return { identity: {
    kind: entry?.kind ?? 'files', icon: entry?.kind === 'folder' || !selected.length ? 'folder' : 'file-text',
    title: entry?.label ?? (selected.length ? `${selected.length} items selected` : 'Files'),
    typeLabel: entry?.kind === 'folder' ? 'Folder' : entry ? entry.sourceFile?.mimeType === 'application/pdf' ? 'PDF document' : entry.kind ?? 'File' : 'Folder contents',
    chips: [
      { label: 'Location', value: path },
      { label: 'Contains', value: `${scope.length} ${scope.length === 1 ? 'file' : 'files'}${entry?.kind === 'folder' ? ' · including subfolders' : ''}` },
      { label: 'Size', value: size },
      ...(entry?.sourceFile?.originalFilename ? [{ label: 'Original name', value: entry.sourceFile.originalFilename }] : []),
      // Lifecycle only: a ready file has nothing to report, and a sentence is not a state (see filePaneLifecycle).
      ...(entry && filePaneLifecycle(entry) ? [{ label: 'Status', value: filePaneLifecycle(entry)! }] : []),
    ],
  }, relations: { scope: 'none', groups: [] } }
}

/** Remove redundant children when moving an ancestor and its contents together. */
export function fileMoveRoots(view: FileWorkspaceProjection, ids: readonly string[]): FileWorkspaceEntry[] {
  const selected = new Set(ids)
  return ids.map(id => view.entries.get(id)).filter((entry): entry is FileWorkspaceEntry => {
    if (!entry) return false
    let parent = entry.parentKey
    while (parent) { if (selected.has(parent)) return false; parent = view.entries.get(parent)?.parentKey ?? null }
    return true
  })
}

export function validateFileMove(view: FileWorkspaceProjection, ids: readonly string[], destination: string | null): void {
  if (!ids.length || ids.some(id => !view.entries.has(id))) throw new Error('The selection has changed. Select the files again.')
  if (destination && view.entries.get(destination)?.node.kind !== 'folder') throw new Error('That folder is no longer available.')
  for (const entry of fileMoveRoots(view, ids)) {
    let parent = destination
    while (parent) {
      if (parent === entry.key) throw new Error('A folder cannot be moved inside itself.')
      parent = view.entries.get(parent)?.parentKey ?? null
    }
  }
}
