/**
 * Native Garden bootstrap for the Shrubbery organism.
 *
 * Shrubbery remains the UI authority. Garden's Tauri shell contributes only
 * the per-run loopback coordinates exposed by `get_loopback_manifest`; from
 * that point onward the existing gardend contract owns MCP, REST, and CRDT.
 */

import SEED_NT from '@shrubbery/nucleus/seed/garden-default.ux.nt?raw'
import { isTauriHost } from './native-host.js'
import { uxConfigGraphIri } from '@shrubbery/nucleus'
import {
  createGardendContract,
  type GardendContract,
  type GraphCatalogEntry,
} from './gardend-contract.js'
import type { LoopbackTransport } from './loopback-mcp.js'

export interface TauriLoopbackManifest {
  readonly apiUrl: string
  readonly mcpUrl: string
  readonly token: string
}

export interface TauriLocalBootstrap {
  readonly contract: GardendContract
  readonly graphId: string
  readonly seededUxConfig: boolean
}

type TauriInvoke = <T>(command: string) => Promise<T>

export { isTauriHost }

export function transportFromTauriManifest(
  manifest: TauriLoopbackManifest,
): LoopbackTransport {
  const apiRoot = manifest.apiUrl.replace(/\/+$/, '')
  return {
    mcpUrl: manifest.mcpUrl,
    healthUrl: `${apiRoot}/health`,
    token: manifest.token,
    transport: 'fetch',
  }
}

/**
 * Pick a stable local graph without inventing a second workspace registry.
 * Explicit URL selection wins, then the last native selection, then the most
 * recently updated active graph.
 */
export function selectTauriGraphId(
  graphs: readonly GraphCatalogEntry[],
  requested: string | null | undefined,
  stored: string | null | undefined,
): string | null {
  const active = graphs.filter(graph => graph.status === 'active')
  const has = (candidate: string | null | undefined): candidate is string =>
    Boolean(candidate && active.some(graph => graph.graph_id === candidate))
  if (has(requested)) return requested
  if (has(stored)) return stored
  return [...active]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
    ?.graph_id ?? null
}

async function ensureUxConfig(
  contract: GardendContract,
  graphId: string,
): Promise<boolean> {
  const existing = await contract.restConcrete.dumpUxConfig(graphId)
  if ((existing.data ?? '').trim() !== '') return false
  await contract.mcp.toolsCall('rdf_load', {
    graphId,
    data: SEED_NT,
    format: 'application/n-triples',
    targetGraphIri: uxConfigGraphIri(graphId),
  })
  return true
}

/**
 * Choose the graph a local cell opens on (URL, then the stored choice, then
 * the most recently updated), creating a first `garden` graph in an empty
 * profile, and seed the Shrubbery UX config when the graph has none. Shared by
 * every shell that owns a whole gardend: the desktop app and a self-host.
 *
 * `tolerateRefusal` (a self-host): a person whose grant may not create graphs
 * or load RDF still opens the workspace. A refused seed leaves the graph
 * without a stored layout, and the shell shows its built-in default one.
 */
export async function openLocalCellGraph(
  contract: GardendContract,
  options: {
    readonly requestedGraphId?: string | null
    readonly storedGraphId?: string | null
    readonly tolerateRefusal?: (error: unknown) => boolean
  } = {},
): Promise<{ readonly graphId: string; readonly seededUxConfig: boolean; readonly refused: boolean }> {
  let catalog = await contract.restConcrete.graphs()
  let graphId = selectTauriGraphId(
    catalog.graphs,
    options.requestedGraphId,
    options.storedGraphId,
  )
  if (!graphId) {
    graphId = 'garden'
    try {
      await contract.mcp.toolsCall('create_graph', {
        graph_id: graphId,
        title: 'Garden',
      })
    } catch (error) {
      if (!options.tolerateRefusal?.(error)) throw error
      throw new Error('This Sophia has no workspace yet, and only its owner can make one. Ask them to open it first.')
    }
    catalog = await contract.restConcrete.graphs()
    if (!catalog.graphs.some(graph => graph.graph_id === graphId)) {
      throw new Error('Garden graph creation completed without cataloging the graph')
    }
  }

  try {
    const seededUxConfig = await ensureUxConfig(contract, graphId)
    return { graphId, seededUxConfig, refused: false }
  } catch (error) {
    if (!options.tolerateRefusal?.(error)) throw error
    return { graphId, seededUxConfig: false, refused: true }
  }
}

async function resolveHealthyContract(
  invoke: TauriInvoke,
  userId: string,
): Promise<{ contract: GardendContract; manifest: TauriLoopbackManifest }> {
  let lastError: unknown = new Error('Garden native loopback has not started')
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const manifest = await invoke<TauriLoopbackManifest>('get_loopback_manifest')
      const contract = createGardendContract({
        transport: transportFromTauriManifest(manifest),
        userId,
      })
      if (await contract.mcp.health()) return { contract, manifest }
      lastError = new Error(`Garden native loopback is not healthy at ${manifest.apiUrl}`)
    } catch (error) {
      lastError = error
    }
    const delayMs = Math.min(100 * (2 ** attempt), 1_000)
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
  throw lastError
}

/**
 * Resolve Garden's native loopback and return the normal live-cell contract.
 * Returns null in an ordinary browser so the existing hosted/dev boot paths
 * remain unchanged.
 */
export async function bootstrapTauriLocalCell(options: {
  readonly requestedGraphId?: string | null
  readonly storedGraphId?: string | null
  readonly userId?: string
} = {}): Promise<TauriLocalBootstrap | null> {
  if (!isTauriHost()) return null

  const { invoke } = await import('@tauri-apps/api/core')
  // setup_core exposes the API only after replaying the durable CRDT prefix.
  // The WebView can reach its first module tick slightly earlier, and an old
  // profile may still contain the previous run's stale manifest. Require both
  // a fresh invocation and a live health response before selecting a graph.
  const { contract } = await resolveHealthyContract(
    invoke as TauriInvoke,
    options.userId ?? 'garden-native',
  )

  const { graphId, seededUxConfig } = await openLocalCellGraph(contract, {
    requestedGraphId: options.requestedGraphId,
    storedGraphId: options.storedGraphId,
  })
  return { contract, graphId, seededUxConfig }
}
