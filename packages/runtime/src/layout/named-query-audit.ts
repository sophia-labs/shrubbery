import type { LayoutDocument, ResourceLocator } from '@shrubbery/nucleus/layout'
import { isNamedQueryRef } from './named-query-registry.js'

export interface RawQueryLocatorSite {
  readonly nodeId: string
  readonly site: 'leaf' | 'grid-cell' | 'grid-collection'
  readonly cellId: string | null
  readonly faceId: string
  readonly queryId: string
}

function addIfRaw(
  sites: RawQueryLocatorSite[],
  nodeId: string,
  site: RawQueryLocatorSite['site'],
  cellId: string | null,
  faceId: string,
  resource: ResourceLocator,
): void {
  if (resource.kind === 'query' && !isNamedQueryRef(resource.queryId)) {
    sites.push({ nodeId, site, cellId, faceId, queryId: resource.queryId })
  }
}

export function findRawQueryLocators(doc: LayoutDocument): readonly RawQueryLocatorSite[] {
  const sites: RawQueryLocatorSite[] = []
  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    switch (node.kind) {
      case 'split':
        continue
      case 'tabs':
        continue
      case 'leaf':
        addIfRaw(sites, nodeId, 'leaf', null, node.descriptor.faceId, node.descriptor.resource)
        continue
      case 'grid':
        if (node.children.kind === 'fixed') {
          for (const cell of node.children.cells) {
            addIfRaw(sites, nodeId, 'grid-cell', cell.id, cell.descriptor.faceId, cell.descriptor.resource)
          }
        } else {
          addIfRaw(sites, nodeId, 'grid-collection', null, node.children.itemFaceId, node.children.collection)
        }
        continue
      default: {
        const forged: never = node
        void forged
      }
    }
  }
  return Object.freeze(sites)
}
