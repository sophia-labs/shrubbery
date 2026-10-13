/** Hosted boot selection, kept separate from authentication and graph effects. */
import type { GatewayGraphInfo } from './gateway-transport.js'
import { gardenGraphLocation } from './garden-home-route.js'
import { selectHostedGraphId } from './deployment-config.js'

export type HostedEntry =
  | { readonly kind: 'graph'; readonly graphId: string }
  | { readonly kind: 'home'; readonly location: URL }

export interface HostedEntryOptions {
  readonly location: Pick<Location, 'href'> | URL
  readonly storedGraphId?: string
  /** Must reject failed/invalid reads; an empty list is a successful catalog. */
  readonly loadGraphs: () => Promise<readonly GatewayGraphInfo[]>
}

function initialGraphId(
  url: URL,
  graphs: readonly GatewayGraphInfo[],
  storedGraphId: string,
): string | null {
  const graphLocation = gardenGraphLocation(url)
  if (graphLocation) {
    if (!graphs.some(graph => graph.graphId === graphLocation.graphId)) {
      throw new Error(`Graph "${graphLocation.graphId}" is not available to this account.`)
    }
    return graphLocation.graphId
  }
  if (url.pathname.split('/').filter(Boolean)[0] === 'g') {
    throw new Error('Garden graph path requires a valid graph id')
  }
  if (url.searchParams.has('graph') || url.searchParams.has('graph_id')) {
    return selectHostedGraphId(url, graphs)
  }
  if (storedGraphId && graphs.some(graph => graph.graphId === storedGraphId)) return storedGraphId
  return graphs.find(graph => graph.role !== 'viewer' && graph.cellState === 'running')?.graphId
    ?? graphs.find(graph => graph.role !== 'viewer')?.graphId
    ?? selectHostedGraphId(url, graphs)
}

/** Called only after the hosted shell has authenticated the current session. */
export async function resolveHostedEntry(options: HostedEntryOptions): Promise<HostedEntry> {
  const url = options.location instanceof URL ? options.location : new URL(options.location.href)
  const graphs = await options.loadGraphs()
  const graphId = initialGraphId(url, graphs, options.storedGraphId ?? '')
  // Only an undirected root entry may become account Home. A failed read must
  // reject above; a requested route/graph/document must not silently disappear.
  // Empty is not evidence of a new user and does not authorize graph creation.
  // Graphs shared with everyone signed in (or through a viewer link) appear in
  // every catalog as Viewer. They are not the account's own workspaces, so an
  // undirected root with nothing else still lands on Home rather than
  // auto-opening a read-only graph the browser app cannot yet host.
  const undirectedRoot = url.pathname === '/' && !url.search && !url.hash
  if (undirectedRoot && !graphs.some(graph => graph.role !== 'viewer')) {
    return { kind: 'home', location: new URL('/home', url.origin) }
  }
  if (!graphId) throw new Error('No Garden graphs are available to this account.')
  const graph = graphs.find(item => item.graphId === graphId)
  if (graph?.role === 'viewer') {
    throw new Error(
      `Graph "${graphId}" is viewer-only; the current gateway MCP route requires Editor for workspace reads.`,
    )
  }
  return { kind: 'graph', graphId }
}
