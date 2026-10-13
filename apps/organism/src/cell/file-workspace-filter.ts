import type { FileWorkspaceProjection } from './file-workspace.js'

/** Search changes the action scope as well as the visible card projection. */
export function filterFileWorkspace(view: FileWorkspaceProjection, query: string): FileWorkspaceProjection {
  if (!query) return view
  const nodes = view.nodes.filter(node => node.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const visible = new Set(nodes.map(node => node.id))
  return { ...view, nodes, selection: view.selection.filter(id => visible.has(id)) }
}
