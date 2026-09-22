/**
 * Pure read-model helpers for the controlled Garden file pane.
 *
 * The OG frontend changes topology when its left pane reaches the expanded
 * posture: the compact outline becomes a Finder-style Miller-column browser.
 * These helpers preserve that behavior without importing Garden stores into
 * the component. Every function consumes and returns plain projected data.
 */

import type {
  FilePaneGrouping,
  FilePaneNode,
  FilePaneSection,
  FilePaneSort,
  FilePaneSortCriterion,
} from '@shrubbery/nucleus'
import {
  DEFAULT_FILE_PANE_GROUPING,
  DEFAULT_FILE_PANE_SORT,
} from '@shrubbery/nucleus'

export {
  DEFAULT_FILE_PANE_GROUPING,
  DEFAULT_FILE_PANE_SORT,
} from '@shrubbery/nucleus'

export type {
  FilePaneGrouping,
  FilePaneNode,
  FilePaneNodeKind,
  FilePanePresentation,
  FilePaneResolvedPresentation,
  FilePaneSection,
  FilePaneSort,
  FilePaneSortCriterion,
  FilePaneSortDirection,
  FilePaneStatus,
} from '@shrubbery/nucleus'

export interface FilePaneColumn {
  readonly id: string
  readonly sectionId: string
  readonly parentId: string | null
  readonly parentLabel: string
  readonly nodes: readonly FilePaneNode[]
}

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function compareOptionalNumber(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return left - right
}

function criterionValue(node: FilePaneNode, criterion: FilePaneSortCriterion): number | null {
  switch (criterion) {
    case 'created': return finite(node.createdAt)
    case 'last-accessed': return finite(node.lastAccessedAt)
    case 'connectivity': return finite(node.connectivity)
    case 'manual': return finite(node.order)
    case 'alphabetical': return null
  }
}

export function sortFilePaneNodes(
  nodes: readonly FilePaneNode[],
  sort: FilePaneSort = DEFAULT_FILE_PANE_SORT,
): FilePaneNode[] {
  const direction = sort.direction === 'desc' ? -1 : 1
  const foldersFirst = sort.foldersFirst !== false
  return nodes
    .map(node => ({
      ...node,
      ...(node.children ? { children: sortFilePaneNodes(node.children, sort) } : {}),
    }))
    .sort((left, right) => {
      if (foldersFirst) {
        const folderDelta = Number(right.kind === 'folder') - Number(left.kind === 'folder')
        if (folderDelta !== 0) return folderDelta
      }
      if (sort.criterion === 'alphabetical') {
        const text = compareText(left.label, right.label)
        if (text !== 0) return text * direction
      } else {
        const numeric = compareOptionalNumber(
          criterionValue(left, sort.criterion),
          criterionValue(right, sort.criterion),
        )
        if (numeric !== 0) return numeric * direction
      }
      const label = compareText(left.label, right.label)
      return label !== 0 ? label : left.id.localeCompare(right.id)
    })
}

export function filterFilePaneNodes(nodes: readonly FilePaneNode[], normalizedQuery: string): FilePaneNode[] {
  if (!normalizedQuery) return [...nodes]
  const out: FilePaneNode[] = []
  for (const node of nodes) {
    const children = filterFilePaneNodes(node.children ?? [], normalizedQuery)
    const searchable = [node.label, node.badge, node.fileType, node.mimeType]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLocaleLowerCase()
    if (searchable.includes(normalizedQuery) || children.length > 0) {
      out.push({ ...node, children, expanded: children.length > 0 || node.expanded })
    }
  }
  return out
}

export function flattenFilePaneLeaves(nodes: readonly FilePaneNode[]): FilePaneNode[] {
  const leaves: FilePaneNode[] = []
  const visit = (items: readonly FilePaneNode[]): void => {
    for (const node of items) {
      if (node.kind === 'folder') visit(node.children ?? [])
      else leaves.push({ ...node, children: undefined, parentId: null })
    }
  }
  visit(nodes)
  return leaves
}

function cloneSection(section: FilePaneSection, nodes: readonly FilePaneNode[]): FilePaneSection {
  return { ...section, nodes }
}

/** Apply OG's separate-artifacts/show-folders controls to plain sections. */
export function groupFilePaneSections(
  sections: readonly FilePaneSection[],
  grouping: FilePaneGrouping = DEFAULT_FILE_PANE_GROUPING,
): FilePaneSection[] {
  const source = sections.map(section => cloneSection(
    section,
    grouping.showFolders ? [...(section.nodes ?? [])] : flattenFilePaneLeaves(section.nodes ?? []),
  ))
  if (grouping.separateArtifacts) return source

  const documents = source.find(section => section.id === 'documents')
  const artifacts = source.find(section => section.id === 'artifacts')
  if (!artifacts) return source
  const merged: FilePaneSection = {
    ...(documents ?? { id: 'documents', label: 'Documents', icon: 'file-text' }),
    nodes: [...(documents?.nodes ?? []), ...(artifacts.nodes ?? [])],
    count: (documents?.count ?? 0) + (artifacts.count ?? 0),
  }
  return [
    merged,
    ...source.filter(section => section.id !== 'documents' && section.id !== 'artifacts'),
  ]
}

export function findFilePaneNode(
  nodes: readonly FilePaneNode[],
  nodeId: string,
): FilePaneNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) return node
    const nested = findFilePaneNode(node.children ?? [], nodeId)
    if (nested) return nested
  }
  return null
}

/**
 * Derive Miller columns from a host-owned folder path. Invalid/stale path
 * suffixes are ignored, so a backend refresh cannot strand the browser.
 */
export function deriveFilePaneColumns(
  section: FilePaneSection,
  folderPath: readonly string[],
  sort: FilePaneSort = DEFAULT_FILE_PANE_SORT,
): FilePaneColumn[] {
  const columns: FilePaneColumn[] = []
  let nodes = sortFilePaneNodes(section.nodes ?? [], sort)
  let parentId: string | null = null
  let parentLabel = section.label
  columns.push({ id: `${section.id}:root`, sectionId: section.id, parentId, parentLabel, nodes })

  for (const folderId of folderPath) {
    const folder = nodes.find(node => node.id === folderId && node.kind === 'folder')
    if (!folder) break
    nodes = sortFilePaneNodes(folder.children ?? [], sort)
    parentId = folder.id
    parentLabel = folder.label
    columns.push({ id: `${section.id}:${folder.id}`, sectionId: section.id, parentId, parentLabel, nodes })
  }
  return columns
}

export function validFilePanePath(
  section: FilePaneSection,
  folderPath: readonly string[],
): string[] {
  const valid: string[] = []
  let nodes = section.nodes ?? []
  for (const folderId of folderPath) {
    const folder = nodes.find(node => node.id === folderId && node.kind === 'folder')
    if (!folder) break
    valid.push(folder.id)
    nodes = folder.children ?? []
  }
  return valid
}
