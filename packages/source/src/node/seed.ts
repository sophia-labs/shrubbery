/**
 * seed.ts — NODE-ONLY seeding helpers over the unified McpClient.
 *
 * Split out of apps/organism/src/cell/spawn-gardend.ts @ b2f408e (design
 * §2.1: "seed split out; gateway seeding variant") — organism's copy is
 * frozen under active swarm ownership.
 *
 * The proven tool-call shapes, verbatim:
 *   - create_graph takes SNAKE_CASE args: { graph_id, title }
 *   - rdf_load takes CAMELCASE args + targetGraphIri:
 *     { graphId, data, format: 'application/n-triples', targetGraphIri }
 *
 * Seeding is a WRITE: on the gateway it correctly costs Editor
 * (POST /g/{id}/mcp uniformly requires Editor today — design §2.7).
 *
 * Two target variants, both plain McpTransportConfig coordinates:
 *   - loopbackSeedTarget(cell|manifest): the cell's own /mcp with its
 *     loopback bearer (Node origin mirrors neem-rs: http://127.0.0.1).
 *   - gatewaySeedTarget(endpoint, graphId, token): the gateway's
 *     /g/{graphId}/mcp with an Editor credential.
 */

import { readFile } from 'node:fs/promises'
import { parseNT, uxConfigGraphIri } from '@shrubbery/nucleus'
import { McpClient } from '../transport/mcp-client.js'

/** Where a seed write goes: MCP endpoint + credential (+ optional Origin). */
export interface SeedTarget {
  readonly mcpUrl: string
  readonly token?: string
  readonly origin?: string
}

/** Loopback variant: seed via a cell's own /mcp (GardendCell and
 *  LoopbackManifest both carry these fields structurally). */
export function loopbackSeedTarget(cell: { mcpUrl: string; token: string }): SeedTarget {
  return { mcpUrl: cell.mcpUrl, token: cell.token, origin: 'http://127.0.0.1' }
}

/** Gateway variant: seed via POST {endpoint}/g/{graphId}/mcp (Editor token). */
export function gatewaySeedTarget(endpoint: string, graphId: string, token: string): SeedTarget {
  const base = endpoint.replace(/\/$/, '')
  return { mcpUrl: `${base}/g/${encodeURIComponent(graphId)}/mcp`, token }
}

function clientFor(target: SeedTarget): McpClient {
  return new McpClient({
    mcpUrl: target.mcpUrl,
    ...(target.token !== undefined ? { token: target.token } : {}),
    ...(target.origin !== undefined ? { origin: target.origin } : {}),
  })
}

/**
 * Create the graph (RDF ops require an existing graph) and seed the real
 * N-Triples body into its :ux:config NAMED graph. Returns the named-graph
 * IRI seeded. Errors surface verbatim (McpError) — never swallowed.
 */
export async function createGraphAndSeedUxConfig(
  target: SeedTarget,
  graphId: string,
  ntBody: string,
  title = 'Shrubbery Planter Cell',
): Promise<string> {
  const mcp = clientFor(target)
  // create_graph uses snake_case args.
  await mcp.toolsCall('create_graph', { graph_id: graphId, title })
  // rdf_load uses camelCase + targetGraphIri; seed into the :ux:config graph.
  const targetGraphIri = uxConfigGraphIri(graphId)
  await mcp.toolsCall('rdf_load', {
    graphId,
    data: ntBody,
    format: 'application/n-triples',
    targetGraphIri,
  })
  return targetGraphIri
}

export interface SeedFromFileOptions {
  /** The graph the load addresses (rdf_load graphId). Must already exist. */
  readonly graphId: string
  /** Path of the N-Triples file to load. */
  readonly filePath: string
  /** Target NAMED graph; default uxConfigGraphIri(graphId). */
  readonly targetGraphIri?: string
}

/**
 * Seed a named graph from an .nt file on disk, against EITHER variant
 * (loopbackSeedTarget or gatewaySeedTarget — the target carries the
 * difference; the tool-call shape is identical through the one McpClient).
 *
 * The graph must already exist (create it via createGraphAndSeedUxConfig or
 * the gateway's own graph-creation flow). Returns the target IRI and the
 * PARSED triple count of the body actually loaded (honest count — parseNT of
 * the same bytes, never a transport envelope's counter). A malformed body
 * fails the parse BEFORE any write reaches the store.
 */
export async function seedGraphFromNtFile(
  target: SeedTarget,
  opts: SeedFromFileOptions,
): Promise<{ targetGraphIri: string; tripleCount: number }> {
  const body = await readFile(opts.filePath, 'utf8')
  const tripleCount = parseNT(body).length // parse-first: refuse garbage before writing
  const targetGraphIri = opts.targetGraphIri ?? uxConfigGraphIri(opts.graphId)
  const mcp = clientFor(target)
  await mcp.toolsCall('rdf_load', {
    graphId: opts.graphId,
    data: body,
    format: 'application/n-triples',
    targetGraphIri,
  })
  return { targetGraphIri, tripleCount }
}
