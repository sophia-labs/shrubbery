/** Hosted boot selection, kept separate from authentication and graph effects. */
import { graphRefOwner, localGraphKey, ownerPrincipal } from '@shrubbery/source/graph-ref'
import type { GatewayGraphInfo } from './gateway-transport.js'
import { gardenGraphLocation } from './garden-home-route.js'
import { selectHostedGraphId } from './deployment-config.js'

export type HostedEntry =
  /** `owner` is present only for another account's graph (and only when the caller named itself, see `self`). */
  | { readonly kind: 'graph'; readonly graphId: string; readonly owner?: string }
  | { readonly kind: 'home'; readonly location: URL }

export interface HostedEntryOptions {
  readonly location: Pick<Location, 'href'> | URL
  /** The last selection: a graph's local key (`localGraphKey`), the bare id for the account's own graphs. */
  readonly storedGraphId?: string
  /**
   * The signed-in account. With it, a graph is chosen by owner AND id: `?owner=user:<sub>` names another
   * account's graph, an id alone prefers the account's own graph, and the entry carries the owner of a graph
   * that is not the account's. Without it, ids alone (the older single-owner behaviour).
   */
  readonly self?: string
  /** Must reject failed/invalid reads; an empty list is a successful catalog. */
  readonly loadGraphs: () => Promise<readonly GatewayGraphInfo[]>
}

function requestedOwner(url: URL): string | null {
  const owner = url.searchParams.get('owner')?.trim()
  return owner ? ownerPrincipal(owner) : null
}

/** The one graph a link names: by owner when it says one, else the account's own, else the only owner of the id. */
function pickRequested(
  graphId: string,
  owner: string | null,
  graphs: readonly GatewayGraphInfo[],
  self: string,
): GatewayGraphInfo {
  const matching = graphs.filter(graph => graph.graphId === graphId)
  if (owner) {
    const named = matching.find(graph => ownerPrincipal(graph.owner ?? self) === owner)
    if (!named) throw new Error(`Graph "${graphId}" is not available to this account.`)
    return named
  }
  const own = matching.find(graph => graphRefOwner(graph.owner, self) === null)
  if (own) return own
  if (matching.length === 1) return matching[0]!
  if (matching.length === 0) throw new Error(`Graph "${graphId}" is not available to this account.`)
  throw new Error(`More than one person shares a graph called "${graphId}" with you. Open it from Home.`)
}

function initialGraph(
  url: URL,
  graphs: readonly GatewayGraphInfo[],
  storedGraphId: string,
  self: string | undefined,
): GatewayGraphInfo | { readonly graphId: string } | null {
  const graphLocation = gardenGraphLocation(url)
  if (self !== undefined) {
    const requested = graphLocation?.graphId
      ?? (url.searchParams.get('graph_id') ?? url.searchParams.get('graph') ?? '').trim()
    if (requested) return pickRequested(requested, requestedOwner(url), graphs, self)
    if (url.pathname.split('/').filter(Boolean)[0] === 'g') {
      throw new Error('Garden graph path requires a valid graph id')
    }
    const stored = storedGraphId
      ? graphs.find(graph => localGraphKey({ owner: graphRefOwner(graph.owner, self), graphId: graph.graphId }, self) === storedGraphId)
      : undefined
    if (stored) return stored
    return graphs.find(graph => graph.role !== 'viewer' && graph.cellState === 'running')
      ?? graphs.find(graph => graph.role !== 'viewer')
      ?? graphs.find(graph => graph.cellState === 'running')
      ?? graphs[0]
      ?? null
  }
  if (graphLocation) {
    if (!graphs.some(graph => graph.graphId === graphLocation.graphId)) {
      throw new Error(`Graph "${graphLocation.graphId}" is not available to this account.`)
    }
    return { graphId: graphLocation.graphId }
  }
  if (url.pathname.split('/').filter(Boolean)[0] === 'g') {
    throw new Error('Garden graph path requires a valid graph id')
  }
  const byId = (graphId: string | null | undefined) => graphId ? { graphId } : null
  if (url.searchParams.has('graph') || url.searchParams.has('graph_id')) {
    return byId(selectHostedGraphId(url, graphs))
  }
  if (storedGraphId && graphs.some(graph => graph.graphId === storedGraphId)) return { graphId: storedGraphId }
  return byId(graphs.find(graph => graph.role !== 'viewer' && graph.cellState === 'running')?.graphId
    ?? graphs.find(graph => graph.role !== 'viewer')?.graphId
    ?? selectHostedGraphId(url, graphs))
}

/** Called only after the hosted shell has authenticated the current session. */
export async function resolveHostedEntry(options: HostedEntryOptions): Promise<HostedEntry> {
  const url = options.location instanceof URL ? options.location : new URL(options.location.href)
  const graphs = await options.loadGraphs()
  const graph = initialGraph(url, graphs, options.storedGraphId ?? '', options.self)
  // Only an undirected root entry may become account Home. A failed read must
  // reject above; a requested route/graph/document must not silently disappear.
  // Empty is not evidence of a new user and does not authorize graph creation.
  // Graphs shared with everyone signed in (or through a viewer link) appear in
  // every catalog as Viewer. They are not the account's own workspaces, so an
  // undirected root with nothing else lands on Home (which lists them under
  // Shared with me) rather than auto-opening someone else's graph. A Viewer
  // graph asked for by path, ?graph= or the last session opens, read-only.
  const undirectedRoot = url.pathname === '/' && !url.search && !url.hash
  if (undirectedRoot && !graphs.some(row => row.role !== 'viewer')) {
    return { kind: 'home', location: new URL('/home', url.origin) }
  }
  if (!graph) throw new Error('No Garden graphs are available to this account.')
  const owner = options.self !== undefined && 'owner' in graph ? graphRefOwner(graph.owner, options.self) : null
  return { kind: 'graph', graphId: graph.graphId, ...(owner ? { owner } : {}) }
}
