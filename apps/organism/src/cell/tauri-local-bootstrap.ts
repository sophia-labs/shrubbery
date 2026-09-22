/**
 * Native Garden bootstrap for the Shrubbery organism.
 *
 * Shrubbery remains the UI authority. Garden's Tauri shell contributes only
 * the per-run loopback coordinates exposed by `get_loopback_manifest`; from
 * that point onward the existing gardend contract owns MCP, REST, and CRDT.
 */

import SEED_NT from '@shrubbery/nucleus/seed/garden-default.ux.nt?raw'
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

export function isTauriHost(root: object = globalThis): boolean {
  return '__TAURI_INTERNALS__' in root
}

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

  let catalog = await contract.restConcrete.graphs()
  let graphId = selectTauriGraphId(
    catalog.graphs,
    options.requestedGraphId,
    options.storedGraphId,
  )
  if (!graphId) {
    graphId = 'garden'
    await contract.mcp.toolsCall('create_graph', {
      graph_id: graphId,
      title: 'Garden',
    })
    catalog = await contract.restConcrete.graphs()
    if (!catalog.graphs.some(graph => graph.graph_id === graphId)) {
      throw new Error('Garden native graph creation completed without cataloging the graph')
    }
  }

  const seededUxConfig = await ensureUxConfig(contract, graphId)
  return { contract, graphId, seededUxConfig }
}
