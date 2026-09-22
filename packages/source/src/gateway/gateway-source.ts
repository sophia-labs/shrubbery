/**
 * gateway-source.ts — HostedGatewaySource: the 'hosted-gateway' TripleSource
 * over the platform-next gateway (design §2.7). The Viewer read path.
 *
 * Verified gateway facts (gateway-auth scout, platform-next authz.rs):
 * GET/HEAD/OPTIONS on /g/{id} need Viewer; POST is Viewer-eligible only on
 * the exact allowlist including /api/sparql/query (authz.rs:37); POST
 * /g/{id}/mcp uniformly requires Editor today (the SEAM comment at
 * authz.rs:68-72); anonymous gets /health + signed image URLs only and
 * never spawns cells.
 *
 * createHostedGatewaySource({ endpoint, owner, graph, auth, readPath = 'sparql',
 * cellQueryRoute? }):
 *
 *   - readPath 'sparql' — THE DEFAULT (least-privilege ruling): POST
 *     {graphBaseUrl}{cellQueryRoute} with a synchronous SELECT-spo query,
 *     body { graphId, query }. gardend's loopback_rdf_routes.rs serves this
 *     route directly (NOT the /graphs/query job-envelope pattern) and
 *     answers with { resultType, variables, rows: Record<string,string>[],
 *     quadCount, ... } — the SAME term-string row shape sparql_query/rdf_dump
 *     produce over MCP, so rows are reassembled via the shared parseRow.
 *     cellQueryRoute defaults '/api/sparql/query' (verified only on the
 *     GATEWAY allowlist, not the cell side — the integration test probes and
 *     pins which route the current gardend actually serves). A caller may
 *     override cellQueryRoute to name a different cell route (e.g.
 *     '/api/graphs/query', the documented fallback name) — NOTE that route
 *     answers a different job-envelope shape and is not parsed by this
 *     adapter; naming it here without job-polling support surfaces as an
 *     honest 'protocol' error, never a silent misparse.
 *   - readPath 'mcp' — explicit opt-in: rdf_dump/sparql_query via
 *     POST {graphBaseUrl}/mcp (GatewayTransport.toolsCall). Richest read
 *     (native nt, true named-graph dump) but costs Editor today. For
 *     authoring/operator deployments that knowingly hold an Editor
 *     credential.
 *
 * Every deployment shape defaults 'sparql'; escalation to 'mcp' is always an
 * explicit boot-config act. describe() returns the package-level
 * HostedGatewaySourceDescription carrying readPath, so every face states
 * which trust path produced its bytes.
 *
 * Error taxonomy (invariant 5 — upstream detail rides VERBATIM):
 *   GatewayHttpError 401 → 'unauthorized'; 403 → 'forbidden';
 *   404 → 'not-found' (gateway leaks no existence to non-members);
 *   5xx → 'unavailable'; other 4xx (e.g. a 400 query refusal) → 'protocol'.
 *   GatewayMcpError (JSON-RPC tool error) → 'protocol'.
 *   VERIFIED REAL-GARDEND FACT (gateway-conformance.integration.test.ts): the
 *   two readPaths genuinely disagree on a malformed-SPARQL failure. The
 *   cell's own /api/sparql/query route (loopback_rdf_routes.rs) maps a
 *   parse failure to AppErrorKind::Rdf → HTTP 500 (folding "bad query" into
 *   "internal error"), which this taxonomy's 5xx rule — applied faithfully —
 *   surfaces as 'unavailable', NOT 'protocol'. readPath 'mcp' answers the
 *   same malformed query with a genuine JSON-RPC tool error → 'protocol' as
 *   expected. This is a real gardend REST-route quirk, not an adapter
 *   misclassification; ledgered here rather than special-cased, since
 *   special-casing status 500 would require inspecting response BODIES to
 *   guess intent — exactly the kind of guess this taxonomy refuses to make.
 *   A connect-level failure (no response at all — TypeError from fetch:
 *   ECONNREFUSED/DNS/reset) → 'unavailable'. Any OTHER thrown Error is one
 *   GatewayTransport already raised after reading a response it could not
 *   make sense of (invalid JSON, non-JSON-RPC envelope, no rows array) →
 *   'protocol', its message verbatim.
 *
 * Browser-safe: GatewayTransport/CognitoAuthSession are fetch(+localStorage)
 * only.
 */

import type { AuthProvider } from '@shrubbery/nucleus'
import {
  parseNT,
  type SelectResult,
  type SourceTerm,
  type Triple,
  type TripleRead,
  type TripleSource,
  type TripleSourceDescription,
  TripleSourceError,
} from '@shrubbery/nucleus'
import { DEFAULT_SUGGESTED_POLL_MS } from '../poll.js'
import { parseRow } from '../transport/parse-term.js'
import {
  GatewayHttpError,
  GatewayMcpError,
  type GatewayMcpResult,
  GatewayTransport,
  gatewayMcpText,
} from './gateway-transport.js'

export type HostedGatewayReadPath = 'sparql' | 'mcp'

/** Adapter-specific display extension of the core description (nucleus
 *  doctrine: such fields live in the adapter package, never in nucleus) —
 *  the ONE place a face learns which trust path produced these bytes. */
export interface HostedGatewaySourceDescription extends TripleSourceDescription {
  readonly kind: 'hosted-gateway'
  /** Exact graph owner used in every canonical gateway route, when bound. */
  readonly owner?: string
  readonly readPath: HostedGatewayReadPath
}

export interface HostedGatewaySourceOptions {
  /** Gateway root, e.g. https://api.canary.sophia-labs.com. */
  readonly endpoint: string
  /** The graphId this source is bound to (gateway /g/{graph} routes). */
  readonly graph: string
  /** Exact typed graph owner. Planter requires this; omission exists only for
   * low-level rolling-deploy compatibility with the legacy `/g/{graph}` alias. */
  readonly owner?: string
  /** The R8 AuthProvider (createAuthProvider(config.auth)). Token is read
   *  afresh per request; no token → an honest anonymous request. */
  readonly auth: AuthProvider
  /** DEFAULT 'sparql' — the least-privilege Viewer path (design §2.7). */
  readonly readPath?: HostedGatewayReadPath
  /** 'sparql' readPath only. Default '/api/sparql/query' — verified against
   *  the gateway allowlist; the current gardend build serves it directly
   *  (loopback_rdf_routes.rs). Must be cell-root-relative ('/...'). */
  readonly cellQueryRoute?: string
  /** For hosts that poll: the recommended re-read interval. */
  readonly suggestedPollMs?: number
  /** Injectable fetch (tests, custom agents). Default: global fetch. */
  readonly fetch?: typeof fetch
}

const DEFAULT_CELL_QUERY_ROUTE = '/api/sparql/query'

/** Map a GatewayTransport failure onto the TripleSource taxonomy. The
 *  upstream detail rides in `detail` verbatim. */
function mapGatewayFailure(e: unknown, op: string): TripleSourceError {
  if (e instanceof TripleSourceError) return e
  if (e instanceof GatewayHttpError) {
    const code =
      e.status === 401
        ? 'unauthorized'
        : e.status === 403
          ? 'forbidden'
          : e.status === 404
            ? 'not-found'
            : e.status >= 500
              ? 'unavailable'
              : 'protocol' // other 4xx: the gateway/cell refused the request, verbatim below
    return new TripleSourceError(code, `hosted-gateway ${op}: ${e.message}`, {
      status: e.status,
      detail: e.responseBody,
      cause: e,
    })
  }
  if (e instanceof GatewayMcpError) {
    return new TripleSourceError('protocol', `hosted-gateway ${op}: ${e.message}`, {
      detail: JSON.stringify({ tool: e.tool, code: e.code, data: e.data }),
      cause: e,
    })
  }
  // TypeError from fetch itself (ECONNREFUSED/DNS/reset — no response was
  // ever read) is the ONLY other failure shape GatewayTransport lets through
  // unwrapped; every other plain Error it throws (invalid JSON, a
  // non-JSON-RPC envelope, a missing result/error) already read a response
  // it could not make contracted sense of.
  if (e instanceof TypeError) {
    return new TripleSourceError('unavailable', `hosted-gateway ${op}: ${e.message}`, {
      detail: e.message,
      cause: e,
    })
  }
  const message = e instanceof Error ? e.message : String(e)
  return new TripleSourceError('protocol', `hosted-gateway ${op}: ${message}`, {
    detail: message,
    cause: e,
  })
}

/** Reject a graph IRI that cannot be embedded in a SPARQL IRI token. */
function assertEmbeddable(graphIri: string, op: string): void {
  if (graphIri.includes('>') || /\s/.test(graphIri)) {
    throw new TripleSourceError(
      'protocol',
      `hosted-gateway ${op}: graph IRI ${JSON.stringify(graphIri)} cannot be embedded in a SPARQL IRI token`,
    )
  }
}

/** `{ rows: Record<string,string>[] }` — the shape BOTH the cell's
 *  /api/sparql/query REST route and MCP sparql_query/rdf_load answer with
 *  (SparqlQueryResult camelCase; the MCP tool envelope). */
function rowsOf(payload: unknown, op: string): readonly unknown[] {
  const rows = payload === null || typeof payload !== 'object' ? undefined : (payload as { rows?: unknown }).rows
  if (!Array.isArray(rows)) {
    throw new TripleSourceError(
      'protocol',
      `hosted-gateway ${op}: response carries no 'rows' array ` +
        `(got ${JSON.stringify(payload)?.slice(0, 300) ?? typeof payload})`,
    )
  }
  return rows
}

function rowRecord(raw: unknown, op: string, i: number): Record<string, string> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TripleSourceError(
      'protocol',
      `hosted-gateway ${op}: row ${i} is not a var→term record: ${JSON.stringify(raw)?.slice(0, 200)}`,
    )
  }
  const record: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      throw new TripleSourceError(
        'protocol',
        `hosted-gateway ${op}: row ${i} var '${k}' is not a term string: ${JSON.stringify(v)?.slice(0, 200)}`,
      )
    }
    record[k] = v
  }
  return record
}

/** Reassemble SELECT-spo rows (var→term-string, ALREADY validated) into the
 *  nucleus Triple model — the same recipe gardend-local/sparql-http use. */
function tripleFromRow(parsed: Record<string, SourceTerm>, op: string, i: number): Triple {
  const s = parsed.s
  const p = parsed.p
  const o = parsed.o
  if (s === undefined || p === undefined || o === undefined) {
    throw new TripleSourceError(
      'protocol',
      `hosted-gateway ${op}: row ${i} is missing a ?s/?p/?o binding`,
    )
  }
  if (p.type !== 'iri') {
    throw new TripleSourceError(
      'protocol',
      `hosted-gateway ${op}: row ${i} predicate is not an IRI (type '${p.type}')`,
    )
  }
  if (s.type === 'literal') {
    throw new TripleSourceError(
      'protocol',
      `hosted-gateway ${op}: row ${i} subject is a literal — not an RDF graph`,
    )
  }
  if (o.type === 'bnode') {
    // Reachable only defensively: parseRow's term-string path never emits
    // 'bnode' (bare `_:x` tokens land in its lenient bare-literal branch —
    // see parse-term.ts's header). Kept for the same reason sparql-http
    // keeps it: an honest refusal beats a silently wrong Term cast.
    throw new TripleSourceError(
      'protocol',
      `hosted-gateway ${op}: row ${i} object is a blank node (_:${o.value}) — the nucleus ` +
        'Triple model deliberately excludes blank-node objects',
    )
  }
  return { s: s.type === 'bnode' ? `_:${s.value}` : s.value, p: p.value, o }
}

/** Extract a tools/call payload, structuredContent-first (mirrors the
 *  unified McpClient's callTool — GatewayTransport is a separate client but
 *  the same recipe applies to its GatewayMcpResult). */
function mcpPayload(result: GatewayMcpResult, op: string): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent
  const text = gatewayMcpText(result)
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new TripleSourceError(
      'protocol',
      `hosted-gateway ${op}: MCP content is not parseable JSON: ${message}`,
      { detail: message, cause: e },
    )
  }
}

/**
 * Build the 'hosted-gateway' TripleSource bound to one graph behind the
 * platform-next gateway. Construction is offline-safe (no network until the
 * first read/select) except for GatewayTransport's own synchronous base-URL
 * validation.
 */
export function createHostedGatewaySource(opts: HostedGatewaySourceOptions): TripleSource {
  if (!opts.graph || opts.graph !== opts.graph.trim()) {
    throw new TripleSourceError(
      'protocol',
      "createHostedGatewaySource: 'graph' must be non-empty and have no surrounding whitespace",
    )
  }
  const readPath: HostedGatewayReadPath = opts.readPath ?? 'sparql'
  if (readPath !== 'sparql' && readPath !== 'mcp') {
    throw new TripleSourceError(
      'protocol',
      `createHostedGatewaySource: readPath must be 'sparql' or 'mcp' (got '${String(readPath)}')`,
    )
  }
  const cellQueryRoute = opts.cellQueryRoute ?? DEFAULT_CELL_QUERY_ROUTE
  if (!cellQueryRoute.startsWith('/')) {
    throw new TripleSourceError(
      'protocol',
      `createHostedGatewaySource: cellQueryRoute must be cell-root-relative (got '${cellQueryRoute}')`,
    )
  }
  const graph = opts.graph
  const gateway = new GatewayTransport({
    gatewayBaseUrl: opts.endpoint,
    auth: opts.auth,
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
  })
  if (opts.owner !== undefined) gateway.bindGraphOwner(graph, opts.owner)

  const description: HostedGatewaySourceDescription = {
    kind: 'hosted-gateway',
    ...(opts.owner !== undefined ? { owner: opts.owner } : {}),
    liveness: 'poll',
    sparql: true,
    endpoint: gateway.graphBaseUrl(graph),
    readPath,
    // MED-1: always declare an interval — explicit override, else the one
    // named default (poll.ts, owner: @shrubbery/source).
    suggestedPollMs: opts.suggestedPollMs ?? DEFAULT_SUGGESTED_POLL_MS,
  }

  // ── readPath 'sparql': POST {graphBaseUrl}{cellQueryRoute} ────────────────

  const runCellQuery = async (query: string, op: string): Promise<unknown> => {
    try {
      return await gateway.cellJson(graph, 'POST', cellQueryRoute, { graphId: graph, query })
    } catch (e) {
      throw mapGatewayFailure(e, op)
    }
  }

  const readViaSparqlRoute = async (graphIri: string): Promise<TripleRead> => {
    const op = `read <${graphIri}> via ${cellQueryRoute}`
    const payload = await runCellQuery(
      `SELECT ?s ?p ?o WHERE { GRAPH <${graphIri}> { ?s ?p ?o } }`,
      op,
    )
    const readAt = Date.now()
    const triples = rowsOf(payload, op).map((raw, i) => {
      const parsed = parseRow(rowRecord(raw, op, i))
      return tripleFromRow(parsed, op, i)
    })
    return { graphIri, readAt, tripleCount: triples.length, triples }
  }

  const selectViaSparqlRoute = async (sparql: string): Promise<SelectResult> => {
    const payload = await runCellQuery(sparql, 'select')
    const readAt = Date.now()
    const rows = rowsOf(payload, 'select').map((raw, i) => parseRow(rowRecord(raw, 'select', i)))
    return { rows, readAt }
  }

  // ── readPath 'mcp': POST {graphBaseUrl}/mcp (rdf_dump / sparql_query) ─────

  const readViaMcp = async (graphIri: string): Promise<TripleRead> => {
    const op = `rdf_dump <${graphIri}> via MCP`
    let result: GatewayMcpResult
    try {
      result = await gateway.toolsCall(graph, 'rdf_dump', {
        graphId: graph,
        format: 'application/n-triples',
        sourceGraphIri: graphIri,
      })
    } catch (e) {
      throw mapGatewayFailure(e, op)
    }
    const readAt = Date.now()
    const payload = mcpPayload(result, op)
    if (payload === null || typeof payload !== 'object') {
      throw new TripleSourceError(
        'protocol',
        `hosted-gateway ${op}: expected an envelope object, got ${JSON.stringify(payload)?.slice(0, 300) ?? typeof payload}`,
      )
    }
    const data = (payload as { data?: unknown }).data
    if (typeof data !== 'string') {
      throw new TripleSourceError(
        'protocol',
        `hosted-gateway ${op}: envelope carries no string 'data' body (got ${JSON.stringify(payload).slice(0, 300)})`,
      )
    }
    let triples: Triple[]
    try {
      triples = parseNT(data)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      throw new TripleSourceError(
        'protocol',
        `hosted-gateway ${op}: body is not parseable N-Triples: ${message}`,
        { detail: message, cause: e },
      )
    }
    return {
      graphIri,
      readAt,
      // Authoritative count = the parsed length. NEVER the envelope quadCount.
      tripleCount: triples.length,
      triples,
      nt: data,
    }
  }

  const selectViaMcp = async (sparql: string): Promise<SelectResult> => {
    let result: GatewayMcpResult
    try {
      result = await gateway.toolsCall(graph, 'sparql_query', { graphId: graph, query: sparql })
    } catch (e) {
      throw mapGatewayFailure(e, 'sparql_query via MCP')
    }
    const readAt = Date.now()
    const payload = mcpPayload(result, 'sparql_query via MCP')
    const rows = rowsOf(payload, 'sparql_query via MCP').map((raw, i) =>
      parseRow(rowRecord(raw, 'sparql_query via MCP', i)),
    )
    return { rows, readAt }
  }

  // ── The one TripleSource surface, dispatched on the bound readPath ────────

  const read = async (graphIri: string): Promise<TripleRead> => {
    assertEmbeddable(graphIri, 'read')
    return readPath === 'sparql' ? readViaSparqlRoute(graphIri) : readViaMcp(graphIri)
  }

  const select = async (sparql: string): Promise<SelectResult> =>
    readPath === 'sparql' ? selectViaSparqlRoute(sparql) : selectViaMcp(sparql)

  return {
    description,
    read,
    select,
    // subscribe: honestly absent (liveness 'poll' — no RDF push feed via
    // either gateway read path today).
    close: () => Promise.resolve(), // per-request HTTP; nothing owned; idempotent
  }
}
