/**
 * gateway-conformance.integration.test.ts — the 'hosted-gateway' adapter (U7)
 * against the FULL conformance suite, in BOTH readPaths, on a REAL spawned
 * gardend cell behind a tiny local HTTP path-rewriter.
 *
 * NO MOCKS, but an honest scope disclaimer (same shape as the organism
 * precedent, apps/organism/tests/hosted-gateway-contract.integration.test.ts):
 * the path-rewriter stands in ONLY for the gateway's already-tested
 * `/o/{owner}/g/{id}`
 * prefix-stripping + cell-token swap (real MCP/REST payloads always come
 * from a real gardend, never faked), PLUS — one step further than the
 * organism precedent — a few SYNTHETIC status-code branches (401 wrong
 * bearer, 403 a designated "forbidden" graphId, 404 a designated "missing"
 * graphId) standing in for the gateway's own already-VERIFIED authz.rs
 * semantics (gateway-auth scout: Viewer/Editor role checks, 404-not-403 for
 * non-members). These are status-code stand-ins only — never a fabricated
 * protocol PAYLOAD; every 200-path response is the real gardend's own bytes.
 * This intentionally does NOT claim to prove Cognito token VALIDATION, ACLs,
 * ALB WebSocket behavior, or Kubernetes cell orchestration — those require a
 * real gateway (the env-gated P2.5 run below, or a docker-desktop run per
 * docs/planter/adapters.md).
 *
 * Proves (U7 acceptance):
 *   - conformance green in BOTH readPath modes ('sparql' default, 'mcp'
 *     explicit opt-in) against the same real gardend cell;
 *   - both modes return TERM-IDENTICAL triple sets on the same seeded graph;
 *   - the cell-route probe: the default cellQueryRoute '/api/sparql/query'
 *     is the one the current gardend build actually serves (verified
 *     end-to-end via loopback_rdf_routes.rs — NOT the /graphs/query job
 *     pattern);
 *   - dev-auth arm exercised (StaticAuth, both directly and via
 *     sourceFromBoot);
 *   - cognito arm: CognitoAuthSession construction + whenReady gating +
 *     honest-401 classification — NO cloud credentials, NO network call to
 *     Cognito itself (construction is offline-safe; whenReady only touches
 *     storage, and none is supplied here);
 *   - auth 'none' → 'unauthorized' with the verbatim gateway body;
 *   - 403/404 taxonomy mapping over the synthetic ACL/membership stand-in;
 *   - malformed SPARQL → 'protocol' in both readPaths;
 *   - a dead endpoint → 'unavailable' with the verbatim connect error;
 *   - default readPath is 'sparql' — asserted directly;
 *   - env-gated P2.5 run (PLANTER_GATEWAY_URL + a dev token against a local
 *     docker-desktop gateway) ctx.skips honestly when the env is absent.
 *
 * No claim of cloud-proven anywhere in this file.
 */

import { readFileSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { compareTriples, parseNT, TripleSourceError, uxConfigGraphIri } from '@shrubbery/nucleus'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runTripleSourceConformance } from '../src/conformance/suite.js'
import {
  AnonymousAuth,
  CognitoAuthSession,
  createHostedGatewaySource,
  type HostedGatewaySourceDescription,
  StaticAuth,
  sourceFromBoot,
} from '../src/index.js'
import {
  createGraphAndSeedUxConfig,
  type GardendCell,
  loopbackSeedTarget,
  spawnGardend,
} from '../src/node/index.js'

const require = createRequire(import.meta.url)
const SEED_BODY = readFileSync(
  require.resolve('@shrubbery/nucleus/seed/garden-default.ux.nt'),
  'utf8',
)
const SEED_TRIPLE_COUNT = parseNT(SEED_BODY).length

const SEEDED_GRAPH = 'planter-gateway-conformance'
const SEEDED_IRI = uxConfigGraphIri(SEEDED_GRAPH)
// An addressable sibling NAMED graph nothing ever wrote to — same-source
// EMPTY proof (existing gardend-conformance precedent).
const NEVER_WRITTEN_IRI = SEEDED_IRI.replace(/:ux:config$/, ':ux:gateway-never-written')

const USER_TOKEN = 'gateway-it-user-token'
const OWNER = 'agent:planter-conformance'
const FORBIDDEN_GRAPH = 'planter-gateway-forbidden'
const MISSING_GRAPH = 'planter-gateway-missing'

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { body += chunk })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

/** Forward one JSON POST to a REAL upstream URL over node:http (the
 *  organism-proven recipe — never fetch against the loopback here). */
function forwardJson(
  targetUrl: string,
  bearer: string,
  body: string,
  origin?: string,
): Promise<{ status: number; body: string; contentType: string }> {
  const target = new URL(targetUrl)
  return new Promise((resolve, reject) => {
    const upstream = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
          ...(origin !== undefined ? { Origin: origin } : {}),
        },
      },
      response => {
        let responseBody = ''
        response.setEncoding('utf8')
        response.on('data', chunk => { responseBody += chunk })
        response.on('end', () => resolve({
          status: response.statusCode ?? 500,
          body: responseBody,
          contentType: String(response.headers['content-type'] ?? 'application/json'),
        }))
      },
    )
    upstream.on('error', reject)
    upstream.end(body)
  })
}

let cell: GardendCell
let shim: Server
let shimBaseUrl: string
const seenRequests: Array<{ method: string; path: string }> = []

beforeAll(async () => {
  cell = await spawnGardend()
  await createGraphAndSeedUxConfig(loopbackSeedTarget(cell), SEEDED_GRAPH, SEED_BODY, 'Planter Gateway Conformance')

  shim = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      seenRequests.push({ method: req.method ?? '', path: url.pathname })

      const m = /^\/o\/([^/]+)\/g\/([^/]+)(\/.*)$/.exec(url.pathname)
      if (!m) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `unexpected shim route ${req.method} ${url.pathname}` }))
        return
      }
      const [, encodedOwner, graphId, rest] = m
      const bearer = req.headers.authorization

      if (decodeURIComponent(encodedOwner) !== OWNER) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'wrong exact graph owner' }))
        return
      }

      // Synthetic ACL/membership stand-in for the gateway's own already-
      // VERIFIED authz.rs semantics (gateway-auth scout) — status codes
      // only, never a fabricated protocol payload.
      if (bearer !== `Bearer ${USER_TOKEN}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'missing or wrong test bearer' }))
        return
      }
      if (graphId === FORBIDDEN_GRAPH) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'viewer role does not permit this graph' }))
        return
      }
      if (graphId === MISSING_GRAPH) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'no such graph (gateway leaks no existence)' }))
        return
      }

      const body = await readRequestBody(req)
      let forwarded: { status: number; body: string; contentType: string }
      if (rest === '/api/sparql/query') {
        forwarded = await forwardJson(`${cell.apiUrl}/api/sparql/query`, cell.token, body)
      } else if (rest === '/mcp') {
        forwarded = await forwardJson(cell.mcpUrl, cell.token, body, 'http://127.0.0.1')
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `unexpected shim cell route ${req.method} ${rest}` }))
        return
      }
      res.writeHead(forwarded.status, { 'Content-Type': forwarded.contentType })
      res.end(forwarded.body)
    })().catch(error => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    shim.once('error', reject)
    shim.listen(0, '127.0.0.1', resolve)
  })
  const address = shim.address() as AddressInfo
  shimBaseUrl = `http://127.0.0.1:${address.port}`
}, 60_000)

afterAll(async () => {
  if (shim) await new Promise<void>(resolve => shim.close(() => resolve()))
  if (cell) await cell.kill()
})

function sparqlPathSource() {
  return createHostedGatewaySource({
    endpoint: shimBaseUrl,
    graph: SEEDED_GRAPH,
    owner: OWNER,
    auth: new StaticAuth(USER_TOKEN),
    readPath: 'sparql',
    suggestedPollMs: 5000,
  })
}

function mcpPathSource() {
  return createHostedGatewaySource({
    endpoint: shimBaseUrl,
    graph: SEEDED_GRAPH,
    owner: OWNER,
    auth: new StaticAuth(USER_TOKEN),
    readPath: 'mcp',
    suggestedPollMs: 5000,
  })
}

// ── FULL conformance: BOTH readPaths, canonical seeded graph ─────────────────

runTripleSourceConformance("hosted-gateway readPath='sparql' (REAL gardend behind local path-rewriter)", sparqlPathSource, {
  graphIri: SEEDED_IRI,
  expectedTripleCount: SEED_TRIPLE_COUNT,
  emptyGraphIri: NEVER_WRITTEN_IRI,
  induceFailure: s => s.select!('THIS IS NOT SPARQL'),
})

runTripleSourceConformance("hosted-gateway readPath='mcp' (REAL gardend behind local path-rewriter)", mcpPathSource, {
  graphIri: SEEDED_IRI,
  expectedTripleCount: SEED_TRIPLE_COUNT,
  emptyGraphIri: NEVER_WRITTEN_IRI,
  induceFailure: s => s.select!('THIS IS NOT SPARQL'),
})

// ── Adapter-specific proofs on the same real cell ────────────────────────────

describe('REAL INTEGRATION — hosted-gateway specifics', () => {
  it('default readPath is \'sparql\' (asserted directly, per design §2.7)', () => {
    const source = createHostedGatewaySource({
      endpoint: shimBaseUrl,
      graph: SEEDED_GRAPH,
      owner: OWNER,
      auth: new StaticAuth(USER_TOKEN),
    })
    expect((source.description as HostedGatewaySourceDescription).readPath).toBe('sparql')
  })

  it("the cell-route probe: cellQueryRoute default '/api/sparql/query' is the route the current gardend build serves", async () => {
    const source = sparqlPathSource()
    const read = await source.read(SEEDED_IRI)
    expect(read.tripleCount).toBe(SEED_TRIPLE_COUNT)
    expect(seenRequests.some(r =>
      r.method === 'POST'
      && r.path === `/o/${encodeURIComponent(OWNER)}/g/${SEEDED_GRAPH}/api/sparql/query`,
    )).toBe(true)
    await source.close()
  })

  it('both readPaths return TERM-IDENTICAL triple sets on the same seeded graph', async () => {
    const sparqlSourceInst = sparqlPathSource()
    const mcpSourceInst = mcpPathSource()
    const [viaSparql, viaMcp] = await Promise.all([
      sparqlSourceInst.read(SEEDED_IRI),
      mcpSourceInst.read(SEEDED_IRI),
    ])
    expect(viaSparql.tripleCount).toBe(SEED_TRIPLE_COUNT)
    expect(viaMcp.tripleCount).toBe(SEED_TRIPLE_COUNT)
    const sortedSparql = [...viaSparql.triples!].sort(compareTriples)
    const sortedMcp = [...viaMcp.triples!].sort(compareTriples)
    expect(sortedSparql).toEqual(sortedMcp)
    await sparqlSourceInst.close()
    await mcpSourceInst.close()
  })

  it("description testifies honestly: kind/liveness/sparql/readPath/endpoint, token-free", async () => {
    const source = sparqlPathSource()
    expect(source.description).toMatchObject({
      kind: 'hosted-gateway',
      liveness: 'poll',
      sparql: true,
      owner: OWNER,
      readPath: 'sparql',
      endpoint: `${shimBaseUrl}/o/${encodeURIComponent(OWNER)}/g/${SEEDED_GRAPH}`,
      suggestedPollMs: 5000,
    })
    expect(JSON.stringify(source.description)).not.toContain(USER_TOKEN)
    await source.close()
  })

  it("sourceFromBoot wires 'hosted-gateway' end-to-end (dev-auth arm, readPath default)", async () => {
    const source = await sourceFromBoot({
      endpoint: shimBaseUrl,
      graph: SEEDED_GRAPH,
      owner: OWNER,
      auth: { mode: 'dev', token: USER_TOKEN },
      adapter: 'hosted-gateway',
    })
    expect((source.description as HostedGatewaySourceDescription).readPath).toBe('sparql')
    const read = await source.read(SEEDED_IRI)
    expect(read.tripleCount).toBe(SEED_TRIPLE_COUNT)
    await source.close()
  })

  it("sourceFromBoot infers 'hosted-gateway' from auth.mode 'cognito' (rule 2)", async () => {
    const source = await sourceFromBoot({
      endpoint: shimBaseUrl,
      graph: SEEDED_GRAPH,
      owner: OWNER,
      auth: { mode: 'cognito', region: 'us-west-1', clientId: 'test-client' },
    })
    expect(source.description.kind).toBe('hosted-gateway')
    await source.close()
  })

  it("cognito arm: construction + whenReady gating + honest-401 (NO cloud creds, NO network to Cognito)", async () => {
    // storage: null — offline-safe by construction; whenReady() only ever
    // touches storage (there is none), so this never dials Cognito itself.
    const session = new CognitoAuthSession({
      config: { region: 'us-west-1', clientId: 'test-client' },
      storage: null,
    })
    expect(session.token()).toBeUndefined()
    expect(session.isAuthenticated()).toBe(false)
    await session.whenReady() // gates the first connect — must resolve without any network I/O
    expect(session.snapshot().status).toBe('anonymous')

    const source = createHostedGatewaySource({
      endpoint: shimBaseUrl,
      graph: SEEDED_GRAPH,
      owner: OWNER,
      auth: session,
      readPath: 'sparql',
    })
    let thrown: unknown
    try {
      await source.read(SEEDED_IRI)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TripleSourceError)
    const err = thrown as TripleSourceError
    expect(err.code).toBe('unauthorized')
    expect(err.detail).toContain('missing or wrong test bearer') // shim's body, verbatim
    await source.close()
  })

  it("auth 'none' (AnonymousAuth) → 'unauthorized' with the verbatim body", async () => {
    const source = createHostedGatewaySource({
      endpoint: shimBaseUrl,
      graph: SEEDED_GRAPH,
      owner: OWNER,
      auth: new AnonymousAuth(),
    })
    let thrown: unknown
    try {
      await source.read(SEEDED_IRI)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TripleSourceError)
    expect((thrown as TripleSourceError).code).toBe('unauthorized')
    expect((thrown as TripleSourceError).detail).toContain('missing or wrong test bearer')
    await source.close()
  })

  it("a 403-shaped graph → 'forbidden'", async () => {
    const source = createHostedGatewaySource({
      endpoint: shimBaseUrl,
      graph: FORBIDDEN_GRAPH,
      owner: OWNER,
      auth: new StaticAuth(USER_TOKEN),
    })
    let thrown: unknown
    try {
      await source.read(uxConfigGraphIri(FORBIDDEN_GRAPH))
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TripleSourceError)
    expect((thrown as TripleSourceError).code).toBe('forbidden')
    await source.close()
  })

  it("a 404-shaped graph → 'not-found' (gateway leaks no existence)", async () => {
    const source = createHostedGatewaySource({
      endpoint: shimBaseUrl,
      graph: MISSING_GRAPH,
      owner: OWNER,
      auth: new StaticAuth(USER_TOKEN),
    })
    let thrown: unknown
    try {
      await source.read(uxConfigGraphIri(MISSING_GRAPH))
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TripleSourceError)
    expect((thrown as TripleSourceError).code).toBe('not-found')
    await source.close()
  })

  it("malformed SPARQL → a taxonomy-coded TripleSourceError in BOTH readPaths, verbatim upstream detail (never rewritten)", async () => {
    // The two readPaths genuinely differ here — a REAL gardend fact, not an
    // adapter choice: the cell's REST route (loopback_rdf_routes.rs) maps a
    // SPARQL parse failure to AppErrorKind::Rdf → HTTP 500 (folding "bad
    // query" into "internal error"), which the design's OWN GatewayHttpError
    // taxonomy (5xx → 'unavailable') maps faithfully — this is the design's
    // stated rule applied honestly, not a misclassification. The MCP tool
    // path answers with a genuine JSON-RPC tool error instead → 'protocol'.
    const viaSparql = sparqlPathSource()
    let sparqlThrown: unknown
    try {
      await viaSparql.select!('DEFINITELY NOT SPARQL')
    } catch (e) {
      sparqlThrown = e
    }
    expect(sparqlThrown).toBeInstanceOf(TripleSourceError)
    expect((sparqlThrown as TripleSourceError).code).toBe('unavailable')
    expect((sparqlThrown as TripleSourceError).detail).toContain('parse SPARQL query')
    await viaSparql.close()

    const viaMcp = mcpPathSource()
    let mcpThrown: unknown
    try {
      await viaMcp.select!('DEFINITELY NOT SPARQL')
    } catch (e) {
      mcpThrown = e
    }
    expect(mcpThrown).toBeInstanceOf(TripleSourceError)
    expect((mcpThrown as TripleSourceError).code).toBe('protocol')
    await viaMcp.close()
  })

  it("a DEAD endpoint → 'unavailable' with the verbatim connect error", async () => {
    const source = createHostedGatewaySource({
      endpoint: 'http://127.0.0.1:1', // nothing listens on privileged port 1
      graph: SEEDED_GRAPH,
      owner: OWNER,
      auth: new StaticAuth(USER_TOKEN),
    })
    let thrown: unknown
    try {
      await source.read(SEEDED_IRI)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TripleSourceError)
    const err = thrown as TripleSourceError
    expect(err.code).toBe('unavailable')
    expect(err.detail).toMatch(/ECONNREFUSED|connect|fetch failed/i)
    await source.close()
  })

  it("createHostedGatewaySource refuses a cellQueryRoute that is not cell-root-relative", () => {
    expect(() =>
      createHostedGatewaySource({
        endpoint: shimBaseUrl,
        graph: SEEDED_GRAPH,
        owner: OWNER,
        auth: new StaticAuth(USER_TOKEN),
        cellQueryRoute: 'api/sparql/query', // missing leading '/'
      }),
    ).toThrow(/cell-root-relative/)
  })
})

// ── ENV-GATED — real platform-next gateway (P2.5), skips honestly ──────────

describe('ENV-GATED — real platform-next gateway (P2.5, docker-desktop)', () => {
  const GATEWAY_URL = process.env.PLANTER_GATEWAY_URL
  const GATEWAY_TOKEN = process.env.PLANTER_GATEWAY_TOKEN ?? 'pn-dev-token'
  const GATEWAY_GRAPH = process.env.PLANTER_GATEWAY_GRAPH
  const GATEWAY_OWNER = process.env.PLANTER_GATEWAY_OWNER

  it('reads through a REAL platform-next gateway when URL + exact owner/graph are set', async ctx => {
    if (!GATEWAY_URL || !GATEWAY_GRAPH || !GATEWAY_OWNER) {
      ctx.skip() // no local docker-desktop gateway configured — never faked (design §2.7 proof tiers)
      return
    }
    const source = await sourceFromBoot({
      endpoint: GATEWAY_URL,
      graph: GATEWAY_GRAPH,
      owner: GATEWAY_OWNER,
      auth: { mode: 'dev', token: GATEWAY_TOKEN },
      adapter: 'hosted-gateway',
    })
    const read = await source.read(uxConfigGraphIri(GATEWAY_GRAPH))
    expect(Number.isInteger(read.tripleCount)).toBe(true)
    await source.close()
  })
})
