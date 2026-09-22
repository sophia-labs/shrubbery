import type {
  SidebarNode,
  SidebarNodeDropDetail,
  SidebarSection,
} from '@shrubbery/runtime'

export interface SidebarDropMutation {
  readonly source: SidebarNode
  readonly parentId: string | null
  readonly order: number | null
}

interface LocatedSidebarNode {
  readonly node: SidebarNode
  readonly siblings: readonly SidebarNode[]
  readonly sectionId: string
}

function locateNode(
  sections: readonly SidebarSection[],
  id: string,
): LocatedSidebarNode | null {
  const visit = (
    siblings: readonly SidebarNode[],
    sectionId: string,
  ): LocatedSidebarNode | null => {
    for (const node of siblings) {
      if (node.id === id) return { node, siblings, sectionId }
      const nested = node.children?.length ? visit(node.children, sectionId) : null
      if (nested) return nested
    }
    return null
  }

  for (const section of sections) {
    const located = visit(section.nodes ?? [], section.id)
    if (located) return located
  }
  return null
}

function containsNode(node: SidebarNode, candidateId: string): boolean {
  return (node.children ?? []).some(child =>
    child.id === candidateId || containsNode(child, candidateId),
  )
}

function finiteOrder(node: SidebarNode | undefined): number | null {
  return typeof node?.order === 'number' && Number.isFinite(node.order) ? node.order : null
}

/**
 * Resolve an untrusted presentation intent against the current authoritative
 * tree projection. This keeps ancestry/section validation and fractional order
 * math out of the component and prevents stale drag payloads from being
 * applied after a refresh.
 */
export function resolveSidebarDrop(
  sections: readonly SidebarSection[],
  detail: SidebarNodeDropDetail,
): SidebarDropMutation | null {
  const sourceLocation = locateNode(sections, detail.sourceId)
  const targetLocation = locateNode(sections, detail.targetId)
  if (!sourceLocation || !targetLocation) return null

  const source = sourceLocation.node
  const target = targetLocation.node
  if (source.id === target.id) return null
  if (source.kind !== 'document' && source.kind !== 'folder') return null
  if (target.kind === 'tag' || sourceLocation.sectionId !== targetLocation.sectionId) return null
  if (source.kind === 'folder' && containsNode(source, target.id)) return null

  if (detail.position === 'inside') {
    if (target.kind !== 'folder') return null
    return { source, parentId: target.id, order: null }
  }

  // Remove the source before finding the target's neighbors. Otherwise moving
  // an adjacent row can accidentally use its old order as one interpolation
  // endpoint and produce a no-op or a value on the wrong side of the target.
  const siblings = targetLocation.siblings.filter(node => node.id !== source.id)
  const targetIndex = siblings.findIndex(node => node.id === target.id)
  const targetOrder = finiteOrder(target)
  if (targetIndex < 0) return null

  let order: number | null = null
  if (targetOrder !== null && detail.position === 'before') {
    const previousOrder = finiteOrder(siblings[targetIndex - 1])
    order = previousOrder !== null && previousOrder < targetOrder
      ? (previousOrder + targetOrder) / 2
      : targetOrder - 1_000
  } else if (targetOrder !== null && detail.position === 'after') {
    const nextOrder = finiteOrder(siblings[targetIndex + 1])
    order = nextOrder !== null && nextOrder > targetOrder
      ? (targetOrder + nextOrder) / 2
      : targetOrder + 1_000
  }

  return {
    source,
    parentId: target.parentId ?? null,
    order,
  }
}
