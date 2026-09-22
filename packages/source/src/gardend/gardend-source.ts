/**
 * gardend-source.ts — GardendLocalSource: the 'gardend-local' TripleSource
 * over the unified McpClient (design §2.5).
 *
 * HOISTED from apps/organism/src/cell/gardend-contract.ts (LoopbackRestClient
 * read path) @ b2f408e — organism's copy is frozen under active swarm
 * ownership; @shrubbery/source is the sole external adapter-consumption
 * convention. Organism's migration is a named follow-up slice.
 *
 * Folded contribution (atelier's R3): the generic `dump(graphId,
 * sourceGraphIri)` primitive (the hosted shape,
 * hosted-gateway-contract.ts:89-108) expressed on the loopback path —
 * `read(graphIri)` is generic over sibling named graphs of the bound graph
 * (`:ux:config`, `:ux:control`, …), subsuming both organism's `dumpUxConfig`
 * and atelier's `:ux:control` read.
 *
 * Read recipe:
 *   read(graphIri)  = tools/call rdf_dump { graphId, format:
 *                     'application/n-triples', sourceGraphIri: graphIri }
 *                     → parseNT → TripleRead carrying the native nt body.
 *                     tripleCount is ALWAYS the parsed length — never the
 *                     envelope's quadCount, which counts response-set
 *                     machinery, not the graph (organism's verified finding).
 *   select(sparql)  = tools/call sparql_query { graphId, query } → {rows}
 *                     → parseTerm → typed SourceTerm bindings.
 *
 * liveness 'poll': reads are live; change detection is the host's re-read
 * loop (gardend exposes no RDF named-graph change feed — see the nucleus
 * SOURCE_LIVENESS doctrine).
 *
 * Error taxonomy (invariant 5 — detail carries the upstream message
 * VERBATIM, never rewritten):
 *   connect failure (cell down/killed)      → 'unavailable'
 *   HTTP 401                                → 'unauthorized'
 *   HTTP 403                                → 'forbidden'
 *   HTTP 404                                → 'not-found'
 *   HTTP 5xx                                → 'unavailable'
 *   MCP JSON-RPC error / envelope surprises → 'protocol'
 *
 * Browser-safe: the McpClient's guarded-dynamic node:http split is the only
 * environment fork, and it never enters a browser bundle.
 */

import {
  TripleSourceError,
  parseNT,
  type SelectResult,
  type SourceTerm,
  type Triple,
  type TripleRead,
  type TripleSource,
  type TripleSourceDescription,
} from '@shrubbery/nucleus'
import { McpClient, McpError, type McpTransportConfig } from '../transport/mcp-client.js'
import { parseTerm } from '../transport/parse-term.js'
import { DEFAULT_SUGGESTED_POLL_MS } from '../poll.js'

/** The loopback coordinates a gardend-local source needs — structurally the
 *  cell's loopback.json manifest (camelCase keys). Node callers get the full
 *  manifest from `@shrubbery/source/node` (readLoopbackManifest/spawnGardend);
 *  this type stays structural so the browser-safe barrel never imports it. */
export interface GardendManifestCoordinates {
  readonly mcpUrl: string
  readonly token?: string
}

export interface GardendLocalSourceOptions {
  /** Absolute MCP URL (Node: http://127.0.0.1:<port>/mcp) or the browser's
   *  same-origin '/cell/mcp'. Either this or `manifest` is required. */
  readonly mcpUrl?: string
  /** Loopback manifest coordinates (mcpUrl + token). `mcpUrl`/`token` given
   *  explicitly win over the manifest's. */
  readonly manifest?: GardendManifestCoordinates
  /** Bearer token. Omit in the browser (the /cell proxy injects it). */
  readonly token?: string
  /** The graph the source is bound to (rdf_dump/sparql_query graphId).
   *  read(graphIri) may still address any sibling NAMED graph of it. */
  readonly graphId: string
  /** Origin header for Node callers (loopback also accepts absent Origin). */
  readonly origin?: string
  /** For hosts that poll: the recommended re-read interval. */
  readonly suggestedPollMs?: number
  /** Transport overrides, passed through to the unified McpClient. */
  readonly fetch?: typeof fetch
  readonly transport?: McpTransportConfig['transport']
}

/** Credential-free display endpoint: strip any userinfo from an absolute URL
 *  (tokens ride in the Authorization header, never here — belt & braces). */
function redactedEndpoint(mcpUrl: string): string {
  try {
    const u = new URL(mcpUrl)
    u.username = ''
    u.password = ''
    return u.toString()
  } catch {
    return mcpUrl // relative ('/cell/mcp') — nothing to redact
  }
}

/** Map an McpClient failure onto the TripleSource taxonomy. The upstream
 *  message rides in `detail` verbatim. */
function mapMcpFailure(e: unknown, op: string): TripleSourceError {
  if (e instanceof TripleSourceError) return e
  if (e instanceof McpError) {
    // The client throws HTTP-shaped McpErrors as `MCP HTTP <status> …` with
    // the status in `code`; JSON-RPC tool errors carry the (negative) RPC code.
    const httpStatus =
      typeof e.code === 'number' && e.code >= 100 && e.code < 600 && e.message.startsWith('MCP HTTP')
        ? e.code
        : undefined
    if (httpStatus === 401) {
      return new TripleSourceError('unauthorized', `gardend-local ${op}: ${e.message}`, {
        status: httpStatus,
        detail: e.message,
        cause: e,
      })
    }
    if (httpStatus === 403) {
      return new TripleSourceError('forbidden', `gardend-local ${op}: ${e.message}`, {
        status: httpStatus,
        detail: e.message,
        cause: e,
      })
    }
    if (httpStatus === 404) {
      return new TripleSourceError('not-found', `gardend-local ${op}: ${e.message}`, {
        status: httpStatus,
        detail: e.message,
        cause: e,
      })
    }
    if (httpStatus !== undefined && httpStatus >= 500) {
      return new TripleSourceError('unavailable', `gardend-local ${op}: ${e.message}`, {
        status: httpStatus,
        detail: e.message,
        cause: e,
      })
    }
    // JSON-RPC tool errors and any other MCP-shaped surprise: the store
    // answered, but not in the contracted shape → 'protocol', verbatim.
    return new TripleSourceError('protocol', `gardend-local ${op}: ${e.message}`, {
      status: httpStatus,
      detail: e.message,
      cause: e,
    })
  }
  if (e instanceof SyntaxError) {
    // The cell answered with a non-JSON body (reverse proxy page, truncation…).
    return new TripleSourceError('protocol', `gardend-local ${op}: ${e.message}`, {
      detail: e.message,
      cause: e,
    })
  }
  // No parseable answer at all: connect refused/reset, DNS, socket teardown —
  // the cell is unreachable. The connect error's message rides verbatim.
  const message = e instanceof Error ? e.message : String(e)
  return new TripleSourceError('unavailable', `gardend-local ${op}: ${message}`, {
    detail: message,
    cause: e,
  })
}

/**
 * Build the 'gardend-local' TripleSource bound to one graph of one cell.
 * Construction is offline-safe (no network until the first read/select).
 */
export function createGardendLocalSource(opts: GardendLocalSourceOptions): TripleSource {
  const mcpUrl = opts.mcpUrl ?? opts.manifest?.mcpUrl
  if (!mcpUrl) {
    throw new TripleSourceError(
      'protocol',
      "createGardendLocalSource: no MCP endpoint — pass 'mcpUrl' or a loopback 'manifest'",
    )
  }
  if (!opts.graphId) {
    throw new TripleSourceError('protocol', "createGardendLocalSource: 'graphId' is required")
  }
  const token = opts.token ?? opts.manifest?.token
  const client = new McpClient({
    mcpUrl,
    ...(token !== undefined ? { token } : {}),
    ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    ...(opts.transport !== undefined ? { transport: opts.transport } : {}),
  })
  const graphId = opts.graphId

  const description: TripleSourceDescription = {
    kind: 'gardend-local',
    liveness: 'poll',
    sparql: true,
    endpoint: redactedEndpoint(mcpUrl),
    // MED-1: a 'poll' adapter ALWAYS declares an interval — the caller's
    // explicit override wins, else the one named default (poll.ts, owner:
    // @shrubbery/source) — so a host never silently degrades to a single read.
    suggestedPollMs: opts.suggestedPollMs ?? DEFAULT_SUGGESTED_POLL_MS,
  }

  const read = async (graphIri: string): Promise<TripleRead> => {
    let payload: unknown
    try {
      payload = await client.callTool('rdf_dump', {
        graphId,
        format: 'application/n-triples',
        sourceGraphIri: graphIri,
      })
    } catch (e) {
      throw mapMcpFailure(e, `rdf_dump <${graphIri}>`)
    }
    const readAt = Date.now() // read completion FROM the authoritative store
    if (payload === null || typeof payload !== 'object') {
      throw new TripleSourceError(
        'protocol',
        `gardend-local rdf_dump <${graphIri}>: expected an envelope object, got ${JSON.stringify(payload)?.slice(0, 300) ?? typeof payload}`,
      )
    }
    const data = (payload as { data?: unknown }).data
    if (typeof data !== 'string') {
      throw new TripleSourceError(
        'protocol',
        `gardend-local rdf_dump <${graphIri}>: envelope carries no string 'data' body ` +
          `(got ${JSON.stringify(payload).slice(0, 300)})`,
      )
    }
    let triples: Triple[]
    try {
      triples = parseNT(data)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      throw new TripleSourceError(
        'protocol',
        `gardend-local rdf_dump <${graphIri}>: body is not parseable N-Triples: ${message}`,
        { detail: message, cause: e },
      )
    }
    return {
      graphIri,
      readAt,
      // Authoritative count = the parsed length. NEVER the envelope quadCount
      // (it counts response-set machinery, not the graph).
      tripleCount: triples.length,
      triples,
      nt: data,
    }
  }

  const select = async (sparql: string): Promise<SelectResult> => {
    let payload: unknown
    try {
      payload = await client.callTool('sparql_query', { graphId, query: sparql })
    } catch (e) {
      throw mapMcpFailure(e, 'sparql_query')
    }
    const readAt = Date.now()
    const rowsRaw = payload === null || typeof payload !== 'object' ? undefined : (payload as { rows?: unknown }).rows
    if (!Array.isArray(rowsRaw)) {
      throw new TripleSourceError(
        'protocol',
        `gardend-local sparql_query: envelope carries no 'rows' array ` +
          `(got ${JSON.stringify(payload)?.slice(0, 300) ?? typeof payload}) — ` +
          'select() is contracted for SELECT queries',
      )
    }
    const rows: Array<Record<string, SourceTerm>> = rowsRaw.map((raw, i) => {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new TripleSourceError(
          'protocol',
          `gardend-local sparql_query: row ${i} is not a var→term record: ${JSON.stringify(raw)?.slice(0, 200)}`,
        )
      }
      const parsed: Record<string, SourceTerm> = {}
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v !== 'string') {
          throw new TripleSourceError(
            'protocol',
            `gardend-local sparql_query: row ${i} var '${k}' is not a term string: ${JSON.stringify(v)?.slice(0, 200)}`,
          )
        }
        parsed[k] = parseTerm(v)
      }
      return parsed
    })
    return { rows, readAt }
  }

  return {
    description,
    read,
    select,
    // subscribe: honestly absent (liveness 'poll' — no RDF push feed on gardend)
    close: () => Promise.resolve(), // per-request HTTP; nothing owned; idempotent
  }
}
