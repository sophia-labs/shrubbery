/**
 * sparql-source.ts — the generic 'sparql-http' TripleSource: pure SPARQL 1.1
 * Protocol (design §2.8), ZERO Sophia-isms. Everything this adapter speaks is
 * standards-only: one query-endpoint URL, `application/sparql-query` request
 * bodies, `application/sparql-results+json` responses. Any conformant store —
 * Oxigraph, Fuseki, GraphDB, Virtuoso, … — is a valid peer; the in-repo
 * conformance target is conformance/sparql-protocol-server.ts (a REAL HTTP
 * server over the REAL oxigraph WASM engine), plus an env-gated run against
 * any external endpoint (PLANTER_SPARQL_URL).
 *
 * Read recipe:
 *   read(graphIri) = POST `SELECT ?s ?p ?o WHERE { GRAPH <graphIri> { ?s ?p ?o } }`
 *                    accepting standard sparql-results+json bindings —
 *                    including 'bnode' — reassembled via parse-term into the
 *                    nucleus Triple model. tripleCount is ALWAYS the
 *                    reassembled length.
 *   select(sparql) = the caller's query passed through VERBATIM; rows are
 *                    typed SourceTerm bindings. Blank nodes arrive typed here
 *                    — select() is the bnode-faithful surface.
 *
 * Blank nodes vs the nucleus Triple model (which deliberately excludes them):
 *   - SUBJECT bnodes are accepted and carried in their standard lexical form
 *     ('_:label') — Triple.s is structurally a string carrier;
 *   - OBJECT bnodes cannot be represented as a nucleus Term without lying
 *     about their type, so read() REFUSES them with an honest 'protocol'
 *     error naming select() as the bnode-faithful path.
 *
 * liveness 'poll': the SPARQL 1.1 Protocol has no change feed; change
 * detection is the host's re-read loop.
 *
 * Error taxonomy (invariant 5 — upstream detail rides VERBATIM, never
 * rewritten):
 *   fetch/connect failure → 'unavailable';   HTTP 401 → 'unauthorized';
 *   403 → 'forbidden';   404 → 'not-found';  5xx → 'unavailable';
 *   any other non-2xx (e.g. a 400 query-parse refusal) or a body outside the
 *   contracted shape → 'protocol'.
 *
 * Browser-safe: global fetch only — no node builtins, no store-specific
 * clients, no vendor headers beyond what the caller passes in.
 */

import {
  TripleSourceError,
  type SelectResult,
  type SourceTerm,
  type Triple,
  type TripleRead,
  type TripleSource,
  type TripleSourceDescription,
} from '@shrubbery/nucleus'
import { parseTerm } from '../transport/parse-term.js'
import { DEFAULT_SUGGESTED_POLL_MS } from '../poll.js'

const RESULTS_JSON = 'application/sparql-results+json'
const QUERY_MEDIA = 'application/sparql-query'

export interface SparqlSourceOptions {
  /** The SPARQL 1.1 Protocol QUERY endpoint URL (e.g. http://host/sparql). */
  readonly endpoint: string
  /** The named graph a boot-configured host will read — recorded on the
   *  description for testimony display only; read(graphIri) stays per-call. */
  readonly graphIri?: string
  /** Extra request headers (e.g. { authorization: 'Bearer …' }). Sent on
   *  every protocol request; NEVER surfaced on the description. */
  readonly headers?: Readonly<Record<string, string>>
  /** For hosts that poll: the recommended re-read interval. */
  readonly suggestedPollMs?: number
  /** Injectable fetch (tests, custom agents). Default: global fetch. */
  readonly fetch?: typeof fetch
}

/** Adapter-specific display extension of the core description (nucleus
 *  doctrine: such fields live in the adapter package, never in nucleus). */
export interface SparqlSourceDescription extends TripleSourceDescription {
  readonly kind: 'sparql-http'
  /** The bound host graph, when the boot config named one. Display only. */
  readonly graphIri?: string
}

/** Credential-free display endpoint: strip any userinfo from an absolute URL
 *  (credentials ride in headers, never here — belt & braces). */
function redactedEndpoint(endpoint: string): string {
  try {
    const u = new URL(endpoint)
    u.username = ''
    u.password = ''
    return u.toString()
  } catch {
    return endpoint // relative — nothing to redact
  }
}

/** A standard sparql-results+json term object. */
interface SparqlJsonTerm {
  readonly type: string
  readonly value: string
  readonly datatype?: string
  readonly 'xml:lang'?: string
}

function isJsonTerm(v: unknown): v is SparqlJsonTerm {
  return (
    v !== null &&
    typeof v === 'object' &&
    typeof (v as { type?: unknown }).type === 'string' &&
    typeof (v as { value?: unknown }).value === 'string'
  )
}

/** N-Triples escaping for a literal lexical form (mirror of the nucleus
 *  termToNT escaping, which parse-term reverses). */
function escapeLexical(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

/**
 * One standard JSON binding term → SourceTerm. 'uri' and 'literal' are
 * reassembled via parse-term (the shared term codec); 'bnode' is mapped HERE
 * — the JSON-bindings path is where blank nodes arrive typed (parse-term's
 * own header defers exactly this mapping to this adapter). Language tags have
 * no slot on the nucleus literal: the lexical value is preserved, the tag is
 * dropped (documented model subset).
 */
function bindingToSourceTerm(raw: unknown, op: string, where: string): SourceTerm {
  if (!isJsonTerm(raw)) {
    throw new TripleSourceError(
      'protocol',
      `sparql-http ${op}: ${where} is not a sparql-results+json term object: ` +
        `${JSON.stringify(raw)?.slice(0, 200) ?? typeof raw}`,
    )
  }
  switch (raw.type) {
    case 'uri':
      return parseTerm(`<${raw.value}>`)
    case 'literal':
    case 'typed-literal': {
      // 'typed-literal' is the legacy alias some stores still emit.
      const dt = raw.datatype
      return parseTerm(
        dt !== undefined ? `"${escapeLexical(raw.value)}"^^<${dt}>` : `"${escapeLexical(raw.value)}"`,
      )
    }
    case 'bnode':
      return { type: 'bnode', value: raw.value }
    default:
      throw new TripleSourceError(
        'protocol',
        `sparql-http ${op}: unsupported sparql-results+json term type '${raw.type}' in ${where}`,
      )
  }
}

/**
 * Build the generic 'sparql-http' TripleSource bound to one SPARQL 1.1
 * Protocol query endpoint. Construction is offline-safe (no network until the
 * first read/select).
 */
export function sparqlSource(opts: SparqlSourceOptions): TripleSource {
  if (!opts.endpoint) {
    throw new TripleSourceError(
      'protocol',
      "sparqlSource: 'endpoint' (the SPARQL 1.1 Protocol query URL) is required",
    )
  }
  const endpoint = opts.endpoint
  const fetchImpl: typeof fetch = opts.fetch ?? ((input, init) => fetch(input, init))

  const description: SparqlSourceDescription = {
    kind: 'sparql-http',
    liveness: 'poll',
    sparql: true,
    endpoint: redactedEndpoint(endpoint),
    ...(opts.graphIri !== undefined ? { graphIri: opts.graphIri } : {}),
    // MED-1: always declare an interval — explicit override, else the one
    // named default (poll.ts, owner: @shrubbery/source).
    suggestedPollMs: opts.suggestedPollMs ?? DEFAULT_SUGGESTED_POLL_MS,
  }

  /** POST one query; return the parsed JSON body. Taxonomy per header. */
  const runQuery = async (query: string, op: string): Promise<unknown> => {
    let res: Response
    try {
      res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { ...(opts.headers ?? {}), 'content-type': QUERY_MEDIA, accept: RESULTS_JSON },
        body: query,
      })
    } catch (e) {
      // No answer at all: connect refused/reset, DNS, socket teardown.
      const message = e instanceof Error ? e.message : String(e)
      throw new TripleSourceError('unavailable', `sparql-http ${op}: ${message}`, {
        detail: message,
        cause: e,
      })
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 500)
      const code =
        res.status === 401
          ? 'unauthorized'
          : res.status === 403
            ? 'forbidden'
            : res.status === 404
              ? 'not-found'
              : res.status >= 500
                ? 'unavailable'
                : 'protocol' // 400-shaped: the store refused the query, verbatim below
      throw new TripleSourceError(
        code,
        `sparql-http ${op}: HTTP ${res.status}${body ? ` — ${body}` : ''}`,
        { status: res.status, ...(body ? { detail: body } : {}) },
      )
    }
    try {
      return await res.json()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      throw new TripleSourceError(
        'protocol',
        `sparql-http ${op}: response body is not JSON: ${message}`,
        { detail: message, cause: e },
      )
    }
  }

  /** Extract `results.bindings` or refuse: this surface is contracted for
   *  SELECT results (an ASK/graph answer is a 'protocol' refusal, verbatim). */
  const bindingsOf = (payload: unknown, op: string): readonly unknown[] => {
    const results =
      payload === null || typeof payload !== 'object'
        ? undefined
        : (payload as { results?: unknown }).results
    const bindings =
      results === null || typeof results !== 'object'
        ? undefined
        : (results as { bindings?: unknown }).bindings
    if (!Array.isArray(bindings)) {
      throw new TripleSourceError(
        'protocol',
        `sparql-http ${op}: response carries no results.bindings array ` +
          `(got ${JSON.stringify(payload)?.slice(0, 300) ?? typeof payload}) — ` +
          'this surface is contracted for SELECT results',
      )
    }
    return bindings
  }

  const rowRecord = (raw: unknown, op: string, i: number): Record<string, unknown> => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TripleSourceError(
        'protocol',
        `sparql-http ${op}: row ${i} is not a var→term record: ${JSON.stringify(raw)?.slice(0, 200)}`,
      )
    }
    return raw as Record<string, unknown>
  }

  const read = async (graphIri: string): Promise<TripleRead> => {
    if (graphIri.includes('>') || /\s/.test(graphIri)) {
      throw new TripleSourceError(
        'protocol',
        `sparql-http read: graph IRI ${JSON.stringify(graphIri)} cannot be embedded in a SPARQL IRI token`,
      )
    }
    const op = `read <${graphIri}>`
    const payload = await runQuery(`SELECT ?s ?p ?o WHERE { GRAPH <${graphIri}> { ?s ?p ?o } }`, op)
    const readAt = Date.now() // read completion FROM the authoritative store
    const triples: Triple[] = bindingsOf(payload, op).map((rawRow, i) => {
      const row = rowRecord(rawRow, op, i)
      const s = bindingToSourceTerm(row.s, op, `row ${i} ?s`)
      const p = bindingToSourceTerm(row.p, op, `row ${i} ?p`)
      const o = bindingToSourceTerm(row.o, op, `row ${i} ?o`)
      if (p.type !== 'iri') {
        throw new TripleSourceError(
          'protocol',
          `sparql-http ${op}: row ${i} predicate is not an IRI (type '${p.type}')`,
        )
      }
      if (s.type === 'literal') {
        throw new TripleSourceError(
          'protocol',
          `sparql-http ${op}: row ${i} subject is a literal — not an RDF graph`,
        )
      }
      if (o.type === 'bnode') {
        throw new TripleSourceError(
          'protocol',
          `sparql-http ${op}: row ${i} object is a blank node (_:${o.value}) — the nucleus ` +
            'Triple model deliberately excludes blank-node objects; bnode-faithful access ' +
            'is available via select()',
        )
      }
      // Subject bnodes ride in their standard lexical form: Triple.s is a
      // string carrier, and '_:label' is lossless.
      return { s: s.type === 'bnode' ? `_:${s.value}` : s.value, p: p.value, o }
    })
    return { graphIri, readAt, tripleCount: triples.length, triples }
  }

  const select = async (sparql: string): Promise<SelectResult> => {
    const payload = await runQuery(sparql, 'select')
    const readAt = Date.now()
    const rows = bindingsOf(payload, 'select').map((rawRow, i) => {
      const row = rowRecord(rawRow, 'select', i)
      const parsed: Record<string, SourceTerm> = {}
      for (const [k, v] of Object.entries(row)) {
        parsed[k] = bindingToSourceTerm(v, 'select', `row ${i} var '${k}'`)
      }
      return parsed
    })
    return { rows, readAt }
  }

  return {
    description,
    read,
    select,
    // subscribe: honestly absent (liveness 'poll' — the protocol has no push feed)
    close: () => Promise.resolve(), // per-request HTTP; nothing owned; idempotent
  }
}
