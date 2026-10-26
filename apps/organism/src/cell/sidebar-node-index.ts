/**
 * id -> node over a sidebar tree, rebuilt only when the sections array is replaced.
 *
 * The sidebar tree is immutable (every refresh assigns a new array), so the array's identity is the
 * cache key. Lookup used to walk every section's whole tree (~1,300 documents) on each call, from 48
 * call sites, some of them per row. The first node with an id in depth-first order wins, exactly as
 * the walk did.
 */
interface IndexedNode {
  readonly id: string
  readonly children?: readonly IndexedNode[]
}
interface IndexedSection<N extends IndexedNode> {
  readonly nodes?: readonly N[]
}

export interface SidebarNodeIndex<N extends IndexedNode> {
  find(sections: readonly IndexedSection<N>[], id: string): N | null
  /** How many times the index was rebuilt (for tests and the bench). */
  readonly builds: number
}

export function createSidebarNodeIndex<N extends IndexedNode>(): SidebarNodeIndex<N> {
  let builtFor: readonly IndexedSection<N>[] | null = null
  let index: ReadonlyMap<string, N> = new Map()
  let builds = 0
  return {
    find(sections, id) {
      if (builtFor !== sections) {
        const next = new Map<string, N>()
        const visit = (entries: readonly N[]): void => {
          for (const node of entries) {
            if (!next.has(node.id)) next.set(node.id, node)
            if (node.children?.length) visit(node.children as readonly N[])
          }
        }
        for (const section of sections) visit(section.nodes ?? [])
        index = next
        builtFor = sections
        builds += 1
      }
      return index.get(id) ?? null
    },
    get builds() { return builds },
  }
}
