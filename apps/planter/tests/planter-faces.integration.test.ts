// @vitest-environment node
//
// Node env (not happy-dom): this test starts REAL http.Server instances and
// `fetch`es them (the apps/storybook/conneg/server.test.ts precedent) — a
// node-level network test.

/**
 * planter-faces.integration.test.ts — U9 acceptance: the four faces
 * (.md/.ttl/.json/.html) driven from ONE TripleSource, both from the
 * `static-nt` fossil (fast, in-process, byte-pinned) AND from a REAL spawned
 * gardend (live read, EMPTY, killed-cell). NO MOCKS of gardend, the fossil,
 * or the HTTP layer anywhere — PART 1.5 below is the one deliberate
 * exception, and it is not a mock: `protocolSurpriseSource` is a genuine,
 * fully-functional `TripleSource` implementation (a legitimate third-party
 * adapter would look exactly like it) that drives the REAL `handle`/
 * `classifyRead` code path through a REAL spawned `http.Server` — it just
 * returns a `TripleRead` shape none of gardend/sparql/hosted happen to
 * produce, to prove the `triplesOf` "neither carrier present" taxonomy path.
 * Its `Date.now()` testimony is real wall-clock time, not a fabricated
 * stand-in for a store this test never talks to.
 *
 * Proves:
 *   - RFC 8288 Link-set parity across all four faces of the site resource;
 *   - the six X-Shrubbery-* testimony headers present and IDENTICAL across
 *     all four faces (face-invariant by construction) + Last-Modified;
 *   - the turtle face round-trips parseTurtle -> parseTriplesToConfig to the
 *     SAME WorkspaceConfig despite the '#' capture block prefixed to it;
 *   - the md/html footer carries formatTimestamp(readAt);
 *   - bare curl (no Accept) -> markdown (the negotiate default);
 *   - an unseeded graph -> HTTP 200 explicit-empty on every face, Triple-Count 0;
 *   - a killed cell -> 503 (+Retry-After) naming the endpoint, verbatim upstream error;
 *   - /source describes the adapter (kind/liveness/sparql/endpoint) + the last
 *     read testimony, and its markdown carries the site:ContentSource inline
 *     turtle block (registered host testimony);
 *   - ?asof yields the explicit no-temporal-lens line, on every face;
 *   - /health is 200 always and never fakes upstream health (it reports the
 *     real classified status).
 *
 * Live-read acceptance claims are gated on FID-004 (U5, green — commit
 * 1de9062, gardend binary sha256 59cb506c…, 2026-07-11): the same convergence
 * this suite exercises against a fresh spawn/restart is the one FID-004 proved
 * safe to claim.
 */

import { existsSync, readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import {
  epochMsToIso,
  GARDEN_DEFAULT,
  parseNT,
  parseTriplesToConfig,
  type TripleSource,
  uxConfigGraphIri,
  type WorkspaceConfig,
} from '@shrubbery/nucleus'
import { parseTurtle } from '@shrubbery/render'
import { createGardendLocalSource, McpClient, staticNtSource } from '@shrubbery/source'
import {
  createGraphAndSeedUxConfig,
  type GardendCell,
  loopbackSeedTarget,
  resolveGardendBin,
  spawnGardend,
} from '@shrubbery/source/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPlanterServer } from '../src/server.js'

const require = createRequire(import.meta.url)
const SEED_BODY: string = readFileSync(require.resolve('@shrubbery/nucleus/seed/garden-default.ux.nt'), 'utf8')
const SEED_TRIPLE_COUNT = parseNT(SEED_BODY).length

async function listenServer(server: Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

// ── PART 1 — the static-nt fossil source (fast, deterministic, in-process) ──

describe('planter-server — four faces from a static-nt fossil', () => {
  const CAPTURED_AT = Date.parse('2026-07-01T12:00:00Z')
  const GRAPH_ID = 'planter-fossil-fixture'
  const GRAPH_IRI = uxConfigGraphIri(GRAPH_ID)

  let server: Server
  let base: string

  beforeAll(async () => {
    const source = staticNtSource(SEED_BODY, {
      graphIri: GRAPH_IRI,
      capturedAt: CAPTURED_AT,
      source: 'fixture:garden-default.ux.nt',
    })
    server = createPlanterServer({ source, graphId: GRAPH_ID, configGraphIri: GRAPH_IRI })
    base = await listenServer(server)
  })

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('bare GET / (no Accept) -> markdown, the negotiate default', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    const body = await res.text()
    expect(body).toContain('Workspace —')
    // MED-3: a 'static' fossil is CAPTURED, never "read live" (it claims no
    // ongoing connection this source structurally cannot have).
    expect(body).toContain('captured')
    expect(body).toContain('from fixture:garden-default.ux.nt')
    expect(body).toContain('(static fossil)')
  })

  it('/site is the SAME resource as / (canonical alias)', async () => {
    const a = await (await fetch(`${base}/`)).text()
    const b = await (await fetch(`${base}/site`)).text()
    expect(a).toBe(b)
  })

  it('Accept: text/turtle -> the capture comment block + triples, ROUND-TRIPS to GARDEN_DEFAULT', async () => {
    const res = await fetch(`${base}/site`, { headers: { accept: 'text/turtle' } })
    expect(res.headers.get('content-type')).toContain('text/turtle')
    const body = await res.text()
    // MED-3: liveness-aware wording — a fossil is CAPTURED, never "read live".
    expect(body).toContain('# captured')
    expect(body).toContain('from fixture:garden-default.ux.nt')
    expect(body).toContain('(static fossil)')
    expect(body).toContain(`# ${SEED_TRIPLE_COUNT} triples in <${GRAPH_IRI}>`)
    expect(body).toContain('@prefix')

    const triples = parseTurtle(body)
    const config: WorkspaceConfig = parseTriplesToConfig(triples)
    expect(config).toEqual(GARDEN_DEFAULT)
  })

  it('Accept: application/ld+json -> compacted JSON-LD, testimony-free body (headers carry it)', async () => {
    const res = await fetch(`${base}/site`, { headers: { accept: 'application/ld+json' } })
    expect(res.headers.get('content-type')).toContain('application/ld+json')
    const json = (await res.json()) as Record<string, unknown>
    expect(json['@context']).toBeDefined()
    expect(json).not.toHaveProperty('readAt')
  })

  it('Accept: text/html -> the html-shell face, footer + <link> tags present', async () => {
    const res = await fetch(`${base}/site`, { headers: { accept: 'text/html' } })
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('<!doctype html>')
    expect(body).toContain('<link rel="describedby"')
    // MED-3: liveness-aware wording — a fossil is CAPTURED, never "read live".
    expect(body).toContain('captured')
    expect(body).toContain('from fixture:garden-default.ux.nt')
    expect(body).toContain('(static fossil)')
  })

  it('explicit .ttl wins over Accept: text/html', async () => {
    const res = await fetch(`${base}/site.ttl`, { headers: { accept: 'text/html' } })
    expect(res.headers.get('content-type')).toContain('text/turtle')
  })

  it('the six X-Shrubbery-* testimony headers are IDENTICAL across all four faces + Last-Modified', async () => {
    const [md, ttl, json, html] = await Promise.all([
      fetch(`${base}/site.md`),
      fetch(`${base}/site.ttl`),
      fetch(`${base}/site.json`),
      fetch(`${base}/site.html`),
    ])
    const HEADER_NAMES = [
      'x-shrubbery-read-at',
      'x-shrubbery-read-at-iso',
      'x-shrubbery-graph-iri',
      'x-shrubbery-triple-count',
      'x-shrubbery-source',
      'x-shrubbery-liveness',
    ]
    const values = [md, ttl, json, html].map((r) => HEADER_NAMES.map((h) => r.headers.get(h)))
    for (let i = 1; i < values.length; i++) expect(values[i]).toEqual(values[0])

    expect(md.headers.get('x-shrubbery-read-at')).toBe(String(CAPTURED_AT))
    expect(md.headers.get('x-shrubbery-read-at-iso')).toBe(epochMsToIso(CAPTURED_AT))
    expect(md.headers.get('x-shrubbery-graph-iri')).toBe(GRAPH_IRI)
    expect(md.headers.get('x-shrubbery-triple-count')).toBe(String(SEED_TRIPLE_COUNT))
    expect(md.headers.get('x-shrubbery-source')).toBe('static-nt')
    expect(md.headers.get('x-shrubbery-liveness')).toBe('static')
    expect(md.headers.get('last-modified')).toBe(new Date(CAPTURED_AT).toUTCString())
  })

  it('RFC 8288 Link-set parity: self/alternate/describedby present + identical hrefs across faces', async () => {
    const [md, ttl, json, html] = await Promise.all([
      fetch(`${base}/site.md`),
      fetch(`${base}/site.ttl`),
      fetch(`${base}/site.json`),
      fetch(`${base}/site.html`),
    ])
    const parseHrefs = (link: string): string[] =>
      Array.from(link.matchAll(/<([^>]+)>/g)).map((m) => m[1]).sort()
    const sets = [md, ttl, json, html].map((r) => parseHrefs(r.headers.get('link') ?? ''))
    expect(sets[0].length).toBeGreaterThan(0)
    for (let i = 1; i < sets.length; i++) expect(sets[i]).toEqual(sets[0])
    expect(md.headers.get('link')).toContain('rel="describedby"')
    expect(md.headers.get('link')).toContain(`<${base}/site.ttl>`)
  })

  it('?asof yields the explicit no-temporal-lens line on every face', async () => {
    const md = await (await fetch(`${base}/site.md?asof=2023-05-25`)).text()
    expect(md).toContain('temporal lens not available for this source (liveness=static; no history index)')
    const ttl = await (await fetch(`${base}/site.ttl?asof=2023-05-25`)).text()
    expect(ttl).toContain('# asof: temporal lens not available')
    const json = (await (await fetch(`${base}/site.json?asof=2023-05-25`)).json()) as Record<string, unknown>
    expect(json.asof).toContain('temporal lens not available')
  })

  it('/source describes the adapter (kind/liveness/sparql/endpoint) + the last read testimony', async () => {
    const res = await fetch(`${base}/source`, { headers: { accept: 'application/json' } })
    expect(res.status).toBe(200)
    const card = (await res.json()) as {
      description: { kind: string; liveness: string; sparql: boolean; endpoint?: string }
      read: { ok: boolean; tripleCount: number; graphIri: string }
    }
    expect(card.description).toMatchObject({
      kind: 'static-nt',
      liveness: 'static',
      sparql: false,
      endpoint: 'fixture:garden-default.ux.nt',
    })
    expect(card.read).toMatchObject({ ok: true, tripleCount: SEED_TRIPLE_COUNT, graphIri: GRAPH_IRI })
  })

  it("/source's markdown face carries the site:ContentSource inline turtle block", async () => {
    const md = await (await fetch(`${base}/source`)).text()
    expect(md).toContain('site:ContentSource')
    expect(md).toContain('@prefix site: <http://sophia.ai/site#>')
    expect(md).toContain(`site:graphIri <${GRAPH_IRI}>`)
    expect(md).toContain('site:liveness "static"')
  })

  it("/source's turtle face is the RAW site:ContentSource instance (not fenced)", async () => {
    const res = await fetch(`${base}/source`, { headers: { accept: 'text/turtle' } })
    expect(res.headers.get('content-type')).toContain('text/turtle')
    const ttl = await res.text()
    expect(ttl.trim().startsWith('@prefix site:')).toBe(true)
    expect(ttl).toContain('a site:ContentSource')
  })

  it('/health is 200 and reports the REAL classified status, never faked', async () => {
    const res = await fetch(`${base}/health`, { headers: { accept: 'application/json' } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; status: string; tripleCount: number }
    expect(body).toMatchObject({ ok: true, status: 'ok', tripleCount: SEED_TRIPLE_COUNT })
  })

  it('unknown path -> 404', async () => {
    const res = await fetch(`${base}/nope`)
    expect(res.status).toBe(404)
  })
})

// ── PART 1.5 — a real, contract-conforming (in every OTHER respect)
//    TripleSource that violates invariant 2 on purpose ───────────────────────
//
// A genuine implementer of the `TripleSource` interface — same shape any
// third-party adapter would satisfy — whose `read()` legitimately resolves
// (no thrown error, non-empty `tripleCount`) but hands back a `TripleRead`
// carrying NEITHER `triples` NOR `nt`: the "the store answered, but not in
// the contracted shape" surprise `triplesOf` exists to name (nucleus
// triple-source.ts). This is not a stand-in for gardend/sparql/hosted — it IS
// a real TripleSource, driving the real `handle`/`classifyRead` code path
// through a real spawned http.Server; it just proves the classification
// promise (protocol -> 'unavailable' -> 503) for a shape none of the in-tree
// adapters happen to produce today, per the U5/U9 taxonomy design.
function protocolSurpriseSource(): TripleSource {
  return {
    description: { kind: 'test-protocol-surprise', liveness: 'poll', sparql: false },
    async read(iri: string) {
      return { graphIri: iri, readAt: Date.now(), tripleCount: 3 }
    },
    async close() {},
  }
}

describe('planter-server — a TripleRead violating invariant 2 (neither triples nor nt)', () => {
  const GRAPH_ID = 'planter-protocol-surprise'
  const GRAPH_IRI = uxConfigGraphIri(GRAPH_ID)

  it('classifies as unavailable -> 503 (never an uncaught 500)', async () => {
    const source = protocolSurpriseSource()
    const server = createPlanterServer({ source, graphId: GRAPH_ID, configGraphIri: GRAPH_IRI })
    const base = await listenServer(server)
    try {
      const res = await fetch(`${base}/site.md`)
      expect(res.status).toBe(503)
      expect(res.headers.get('retry-after')).toBeTruthy()
      const body = await res.text()
      expect(body).toContain(`carries neither triples nor nt`)
      expect(body).toContain(GRAPH_IRI)
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })
})

// ── PART 2 — a REAL spawned gardend cell (live read, EMPTY, killed-cell) ────

const GARDEN_BIN = resolveGardendBin()
const BIN_PRESENT = existsSync(GARDEN_BIN)
const describeLive = BIN_PRESENT ? describe : describe.skip

describeLive('planter-server — four faces from a REAL gardend-local TripleSource', () => {
  const SEEDED_GRAPH = 'planter-server-it'
  const UNSEEDED_GRAPH = 'planter-server-it-empty'
  const SEEDED_IRI = uxConfigGraphIri(SEEDED_GRAPH)

  let cell: GardendCell

  beforeAll(async () => {
    if (!BIN_PRESENT) {
      throw new Error(`gardend binary not found at ${GARDEN_BIN}. Set GARDEN_BIN to override.`)
    }
    cell = await spawnGardend()
    const target = loopbackSeedTarget(cell)
    await createGraphAndSeedUxConfig(target, SEEDED_GRAPH, SEED_BODY, 'Planter Server IT')
    const mcp = new McpClient({ mcpUrl: cell.mcpUrl, token: cell.token, origin: 'http://127.0.0.1' })
    await mcp.toolsCall('create_graph', { graph_id: UNSEEDED_GRAPH, title: 'Planter Server IT Empty' })
  }, 120_000)

  afterAll(async () => {
    if (cell) await cell.kill()
  })

  it('GET /site reads the SEEDED graph LIVE and parses to GARDEN_DEFAULT', async () => {
    const source = createGardendLocalSource({
      mcpUrl: cell.mcpUrl,
      token: cell.token,
      origin: 'http://127.0.0.1',
      graphId: SEEDED_GRAPH,
    })
    const server = createPlanterServer({ source, graphId: SEEDED_GRAPH })
    const base = await listenServer(server)
    try {
      const res = await fetch(`${base}/site.json`)
      expect(res.status).toBe(200)
      expect(res.headers.get('x-shrubbery-source')).toBe('gardend-local')
      expect(res.headers.get('x-shrubbery-liveness')).toBe('poll')
      expect(res.headers.get('x-shrubbery-triple-count')).toBe(String(SEED_TRIPLE_COUNT))

      const ttl = await (await fetch(`${base}/site.ttl`)).text()
      const config = parseTriplesToConfig(parseTurtle(ttl))
      expect(config).toEqual(GARDEN_DEFAULT)
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
      await source.close()
    }
  })

  it('an unseeded graph -> 200 explicit-empty on every face, Triple-Count 0', async () => {
    const source = createGardendLocalSource({
      mcpUrl: cell.mcpUrl,
      token: cell.token,
      origin: 'http://127.0.0.1',
      graphId: UNSEEDED_GRAPH,
    })
    const server = createPlanterServer({ source, graphId: UNSEEDED_GRAPH })
    const base = await listenServer(server)
    try {
      for (const [path, accept] of [
        ['/site.md', undefined],
        ['/site.ttl', undefined],
        ['/site.json', undefined],
        ['/site.html', undefined],
      ] as const) {
        const res = await fetch(`${base}${path}`, accept ? { headers: { accept } } : undefined)
        expect(res.status, `${path} should be 200 EMPTY`).toBe(200)
        expect(res.headers.get('x-shrubbery-triple-count')).toBe('0')
      }
      const md = await (await fetch(`${base}/site.md`)).text()
      expect(md).toContain('seed with')
      const healthRes = await fetch(`${base}/health`, { headers: { accept: 'application/json' } })
      const health = (await healthRes.json()) as { ok: boolean; tripleCount: number }
      expect(health).toMatchObject({ ok: true, tripleCount: 0 })
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
      await source.close()
    }
  })

  it('a KILLED cell -> 503 (+Retry-After) naming the endpoint, verbatim upstream error', async () => {
    const victim = await spawnGardend()
    const source = createGardendLocalSource({
      mcpUrl: victim.mcpUrl,
      token: victim.token,
      origin: 'http://127.0.0.1',
      graphId: SEEDED_GRAPH,
    })
    const server = createPlanterServer({ source, graphId: SEEDED_GRAPH })
    const base = await listenServer(server)
    await victim.kill()
    try {
      const res = await fetch(`${base}/site.md`)
      expect(res.status).toBe(503)
      expect(res.headers.get('retry-after')).toBeTruthy()
      const body = await res.text()
      expect(body).toContain(`endpoint: ${victim.mcpUrl}`)
      expect(body).toMatch(/ECONNREFUSED|ECONNRESET|socket|connect|fetch failed/i)
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
      await source.close()
    }
  }, 90_000)

  it('a live success THEN a kill -> the 503 still carries the prior read as a stale-labeled capture block', async () => {
    const victim = await spawnGardend()
    const seedTarget = loopbackSeedTarget(victim)
    await createGraphAndSeedUxConfig(seedTarget, SEEDED_GRAPH, SEED_BODY, 'Planter Server IT (stale probe)')
    const source = createGardendLocalSource({
      mcpUrl: victim.mcpUrl,
      token: victim.token,
      origin: 'http://127.0.0.1',
      graphId: SEEDED_GRAPH,
    })
    const server = createPlanterServer({ source, graphId: SEEDED_GRAPH })
    const base = await listenServer(server)
    try {
      // 1) a genuine live success, on THIS server instance, priming its
      //    last-good testimony cache.
      const ok = await fetch(`${base}/site.md`)
      expect(ok.status).toBe(200)
      const okReadAt = ok.headers.get('x-shrubbery-read-at')
      expect(okReadAt).toBeTruthy()

      // 2) kill the cell out from under the SAME server/source, then read again.
      await victim.kill()
      const failedMd = await fetch(`${base}/site.md`)
      expect(failedMd.status).toBe(503)
      expect(failedMd.headers.get('retry-after')).toBeTruthy()
      // the stale testimony headers ride along, carrying the PRIOR read's stamp
      expect(failedMd.headers.get('x-shrubbery-read-at')).toBe(okReadAt)
      expect(failedMd.headers.get('x-shrubbery-triple-count')).toBe(String(SEED_TRIPLE_COUNT))
      const mdBody = await failedMd.text()
      expect(mdBody).toMatch(/STALE/)
      expect(mdBody).toContain(`${SEED_TRIPLE_COUNT} triples in <${SEEDED_IRI}>`)

      const failedJson = await fetch(`${base}/site.json`)
      expect(failedJson.status).toBe(503)
      const jsonBody = (await failedJson.json()) as { lastGood?: { stale: boolean; tripleCount: number } }
      expect(jsonBody.lastGood).toMatchObject({ stale: true, tripleCount: SEED_TRIPLE_COUNT })

      const failedTtl = await fetch(`${base}/site.ttl`)
      expect(await failedTtl.text()).toMatch(/# STALE/)
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
      await source.close()
    }
  }, 90_000)
})
