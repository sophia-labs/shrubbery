/**
 * hosted-viewer-rest-client.ts — Viewer-eligible `RestClient` over the hosted
 * gateway's cell-scoped `/api/sparql/query` REST route (POST
 * `{gatewayBaseUrl}/o/{owner}/g/{graphId}/api/sparql/query`), NOT MCP.
 *
 * platform-next's authz allowlist admits POST `/api/sparql/query` for Viewer
 * role; POST `/mcp` (`HostedGatewayRestClient`'s `sparql_query` tools/call in
 * `hosted-gateway-contract.ts`) requires Editor uniformly today — the same
 * verified gateway-auth fact `@shrubbery/source`'s `gateway-source.ts` header
 * documents for its own 'sparql' readPath default. The observatory dashboard
 * is a read-only surface: every account with Viewer access to a graph should
 * be able to open it, so this client deliberately never reaches `/mcp`.
 *
 * Implements the SAME narrow `@shrubbery/nucleus` `RestClient` contract as
 * `HostedGatewayRestClient` so it plugs into the SAME production
 * `makeQueryBlockService` every other query-backed face/document adapter
 * uses (`layout-workbench-main.ts`'s own `rest = new LoopbackRestClient(mcp);
 * queryService = makeQueryBlockService(rest)` pattern, mirrored here with a
 * gateway-HTTP `rest` instead of the local `/cell` proxy one) — the adapter
 * seam is unchanged, only the transport underneath differs. `.graphs()` and
 * `.update()` are not needed by a read-only dashboard bound to one graph;
 * both throw a clear error if ever reached rather than silently no-op.
 *
 * Deliberately a small STANDALONE class, not an addition to the existing
 * `GatewayTransport` (that file backs the shell's MCP-based mutation
 * adapters and is shared/frozen production surface) — reuses its exported
 * `gatewayGraphBaseUrl`/`GatewayHttpError` helpers rather than duplicating
 * URL construction or error shape.
 */
import type { AuthProvider, RestClient } from '@shrubbery/nucleus/contract'
import { gatewayGraphBaseUrl, GatewayHttpError } from './gateway-transport.js'

export interface HostedViewerRestClientOptions {
  /** Gateway root, e.g. https://api.canary.sophia-labs.com. */
  readonly gatewayBaseUrl: string
  /** Cognito-backed AuthProvider (CognitoAuthSession satisfies this). Token is read afresh per request. */
  readonly auth: AuthProvider
  /** Typed immutable owner of the graph selected from `GET /graphs`. */
  readonly owner: string
  /** Browser fetch by default; injectable for tests. */
  readonly fetch?: typeof fetch
  /**
   * Cell-root-relative REST route. Default `/api/sparql/query` — the
   * Viewer-eligible route the current gardend build serves directly
   * (`loopback_rdf_routes.rs`), same default `@shrubbery/source`'s
   * `createHostedGatewaySource` pins for its own 'sparql' readPath.
   */
  readonly cellQueryRoute?: string
}

const DEFAULT_CELL_QUERY_ROUTE = '/api/sparql/query'

/**
 * Read-only, Viewer-eligible `RestClient`: `.query()` POSTs the cell's own
 * `/api/sparql/query` REST route with a bearer token; `.graphs()`/`.update()`
 * are unsupported (the observatory dashboard never lists graphs or writes).
 */
export class HostedViewerRestClient implements RestClient {
  private readonly fetchImpl: typeof fetch
  private readonly cellQueryRoute: string

  constructor(private readonly options: HostedViewerRestClientOptions) {
    const fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') throw new Error('HostedViewerRestClient requires fetch')
    this.fetchImpl = fetchImpl.bind(globalThis) as typeof fetch
    this.cellQueryRoute = options.cellQueryRoute ?? DEFAULT_CELL_QUERY_ROUTE
    if (!this.cellQueryRoute.startsWith('/')) {
      throw new Error(`HostedViewerRestClient: cellQueryRoute must be cell-root-relative (got '${this.cellQueryRoute}')`)
    }
  }

  async graphs(): Promise<unknown> {
    throw new Error(
      'HostedViewerRestClient.graphs() is unsupported — the observatory dashboard is bound to one graph and never lists the catalog',
    )
  }

  async update(_graphId: string, _sparql: string): Promise<void> {
    throw new Error(
      'HostedViewerRestClient.update() is unsupported — the observatory dashboard is a read-only Viewer-eligible surface',
    )
  }

  async query(graphId: string, sparql: string): Promise<unknown> {
    const id = graphId.trim()
    if (!id) throw new Error('HostedViewerRestClient.query(): graphId is required')
    const url = `${gatewayGraphBaseUrl(this.options.gatewayBaseUrl, id, this.options.owner)}${this.cellQueryRoute}`

    await this.options.auth.whenReady()
    const token = this.options.auth.token()
    if (!token) throw new Error(`HostedViewerRestClient.query(): authentication token is unavailable for ${url}`)

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ graphId: id, query: sparql }),
      cache: 'no-store',
    })
    const responseBody = await response.text()
    if (!response.ok) throw new GatewayHttpError('POST', url, response.status, responseBody)
    if (!responseBody) return null
    try {
      return JSON.parse(responseBody) as unknown
    } catch (error) {
      throw new Error(
        `HostedViewerRestClient.query(): gateway POST ${url} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

export function createHostedViewerRestClient(options: HostedViewerRestClientOptions): HostedViewerRestClient {
  return new HostedViewerRestClient(options)
}
