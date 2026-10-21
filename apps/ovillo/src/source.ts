/**
 * source.ts — which TripleSource the page reads the `ovillo` graph through.
 *
 * Two servings, one codec (model.ts):
 *   'nt'       the graph as built N-Triples files on the same origin
 *              (`graph/ovillo.nt` for user:rdf, `graph/ux-config.nt` for the
 *              layout), read by the app's nt-http adapter. The dev server serves
 *              the fixture or a graph builder's out/ there.
 *   'gardend'  a public-mode gardend on the same origin: `/mcp`, `sparql_query`
 *              over graph `ovillo`, read with paged SELECTs (visitors may not
 *              rdf_dump). `@shrubbery/source`'s gardend-local adapter.
 *
 * The page chooses with `?source=nt|gardend` (and `?nt=`, `?ux=`, `?mcp=` to
 * move the files or the endpoint); the build's default is `VITE_OVILLO_SOURCE`,
 * else 'nt'. The choice is shown in the footer's testimony.
 */

import type { TripleSource } from '@shrubbery/nucleus'
import { createGardendLocalSource } from '@shrubbery/source/gardend'
import { ntHttpSource } from './nt-http-source.js'
import { OVILLO_DATA_GRAPH, OVILLO_GRAPH_ID, OVILLO_UX_GRAPH } from './vocab.js'

export type OvilloSourceKind = 'nt' | 'gardend'

export interface OvilloSourceConfig {
  readonly kind: OvilloSourceKind
  readonly ntUrl: string
  readonly uxUrl: string
  readonly mcpUrl: string
  readonly graphId: string
}

export function sourceConfig(search: string, buildDefault: string | undefined): OvilloSourceConfig {
  const params = new URLSearchParams(search)
  const asked = params.get('source') ?? buildDefault ?? 'nt'
  const kind: OvilloSourceKind = asked === 'gardend' ? 'gardend' : 'nt'
  return {
    kind,
    ntUrl: params.get('nt') ?? 'graph/ovillo.nt',
    uxUrl: params.get('ux') ?? 'graph/ux-config.nt',
    mcpUrl: params.get('mcp') ?? '/mcp',
    graphId: OVILLO_GRAPH_ID,
  }
}

export function createOvilloSource(config: OvilloSourceConfig, fetchImpl?: typeof fetch): TripleSource {
  if (config.kind === 'gardend') {
    return createGardendLocalSource({ mcpUrl: config.mcpUrl, graphId: config.graphId, ...(fetchImpl ? { fetch: fetchImpl } : {}) })
  }
  return ntHttpSource({
    graphs: { [OVILLO_DATA_GRAPH]: config.ntUrl, [OVILLO_UX_GRAPH]: config.uxUrl },
    endpoint: config.ntUrl,
    ...(fetchImpl ? { fetchImpl } : {}),
  })
}
