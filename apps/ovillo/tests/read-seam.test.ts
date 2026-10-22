// @vitest-environment node
//
// Node, not happy-dom: these suites drive real loopback HTTP servers (happy-dom's
// fetch would apply browser CORS to them, for reasons unrelated to the seam).

/**
 * The read seam, three ways, all REAL:
 *   1. the nt-http adapter behind the REAL site middleware on a REAL loopback
 *      server, put through the repo's own `@shrubbery/source/conformance` kit,
 *      then read into the model and the layouts (the fixture's :ux:config);
 *      the media route serves Range requests (206), as seeking needs;
 *   2. the SELECT path (graph-read.ts) against a REAL SPARQL engine: oxigraph
 *      behind the reference SPARQL 1.1 Protocol server, the fixture loaded into
 *      the `user:rdf` named graph, read in small pages and compared triple for
 *      triple with the file;
 *   3. a REAL public-mode gardend, as a visitor (no credential), when one is
 *      running at OVILLO_GARDEND_URL (default http://127.0.0.1:7792); skipped,
 *      and saying so, when none is.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compareTriples, parseNT, type Triple } from '@shrubbery/nucleus'
import { runTripleSourceConformance } from '@shrubbery/source/conformance'
import { startSparqlProtocolServer, type SparqlProtocolServer } from '@shrubbery/source/conformance/sparql-server'
import { sparqlSource } from '@shrubbery/source'
import { ntHttpSource } from '../src/nt-http-source.js'
import { createOvilloSource, sourceConfig } from '../src/source.js'
import { readGraph, pagedTriplesQuery } from '../src/graph-read.js'
import { loadOvilloLayouts, defaultOvilloLayouts } from '../src/layout.js'
import { parseOvillo } from '../src/model.js'
import { FIXTURE_DIR, ovilloSiteMiddleware, resolveOvilloSite } from '../src/shell/site-middleware.js'
import { OVILLO_DATA_GRAPH, OVILLO_UX_GRAPH } from '../src/vocab.js'

const FIXTURE_NT = readFileSync(join(FIXTURE_DIR, 'ovillo.nt'), 'utf8')
const FIXTURE_TRIPLES = parseNT(FIXTURE_NT)
const sorted = (ts: readonly Triple[]): Triple[] => [...ts].sort(compareTriples)
const XSD = 'http://www.w3.org/2001/XMLSchema#'
/** A store may write a number in its own canonical form ("-1.0" → "-1"): compare numbers as numbers. */
const canonical = (ts: readonly Triple[]): string[] =>
  ts.map((t) => {
    const o = t.o
    const numeric = o.type === 'literal' && (o.datatype === `${XSD}double` || o.datatype === `${XSD}integer` || o.datatype === `${XSD}decimal`)
    return JSON.stringify([t.s, t.p, o.type, numeric ? Number(o.value) : o.value, o.type === 'literal' ? o.datatype ?? '' : ''])
  }).sort()

let server: Server
let base = ''

beforeAll(async () => {
  const middleware = ovilloSiteMiddleware(resolveOvilloSite({}))
  server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end('not a route') }))
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()))
})

const graphs = (): Record<string, string> => ({
  [OVILLO_DATA_GRAPH]: `${base}/graph/ovillo.nt`,
  [OVILLO_UX_GRAPH]: `${base}/graph/ux-config.nt`,
})

runTripleSourceConformance(
  'nt-http (Ovillo: the REAL site middleware over the fixture, behind REAL loopback HTTP)',
  () => ntHttpSource({ graphs: graphs(), endpoint: base }),
  {
    graphIri: OVILLO_DATA_GRAPH,
    expectedTripleCount: FIXTURE_TRIPLES.length,
    induceFailure: (source) => source.read('urn:ovillo:not-a-graph-this-source-serves'),
  },
)

describe('nt-http → the model and the layouts', () => {
  it('reads the whole fixture in one read, and the model from it', async () => {
    const source = ntHttpSource({ graphs: graphs() })
    const read = await readGraph(source, OVILLO_DATA_GRAPH)
    expect(read.testimony).toMatchObject({ via: 'read', pages: 1, tripleCount: FIXTURE_TRIPLES.length })
    expect(sorted(read.triples)).toEqual(sorted(FIXTURE_TRIPLES))
    expect(parseOvillo(read.triples).pieces).toHaveLength(3)
    await source.close()
  })

  it('every route’s layout comes from the graph’s :ux:config', async () => {
    const source = ntHttpSource({ graphs: graphs() })
    const layouts = await loadOvilloLayouts(source)
    expect(Object.values(layouts.sources)).toEqual(['graph', 'graph', 'graph', 'graph', 'graph'])
    expect(layouts.docs).toEqual(defaultOvilloLayouts())
    expect(layouts.missing).toBeNull()
    await source.close()
  })

  it('a site with no :ux:config falls back to the built-in layouts, and says why', async () => {
    const source = ntHttpSource({ graphs: { ...graphs(), [OVILLO_UX_GRAPH]: `${base}/graph/no-such.nt` } })
    const layouts = await loadOvilloLayouts(source)
    expect(Object.values(layouts.sources).every((s) => s === 'built-in')).toBe(true)
    expect(layouts.missing).toMatch(/404/)
    await source.close()
  })

  it('serves the mp3 with Range (206), and refuses to leave the site', async () => {
    const full = readFileSync(join(FIXTURE_DIR, 'site/media/gigante-y-juguete.mp3'))
    const r = await fetch(`${base}/media/gigante-y-juguete.mp3`, { headers: { Range: 'bytes=100-199' } })
    expect(r.status).toBe(206)
    expect(r.headers.get('content-range')).toBe(`bytes 100-199/${full.length}`)
    expect(Buffer.from(await r.arrayBuffer()).equals(full.subarray(100, 200))).toBe(true)
    expect((await fetch(`${base}/media/%2e%2e/%2e%2e/package.json`)).status).not.toBe(200)
    expect((await fetch(`${base}/media/hilo-de-luz.energy.json`)).headers.get('content-type')).toMatch(/application\/json/)
  })

  it('the page’s own source config picks nt by default, gardend when asked', () => {
    expect(sourceConfig('', undefined)).toMatchObject({ kind: 'nt', ntUrl: 'graph/ovillo.nt', uxUrl: 'graph/ux-config.nt' })
    expect(sourceConfig('?source=gardend&mcp=/x/mcp', undefined)).toMatchObject({ kind: 'gardend', mcpUrl: '/x/mcp', graphId: 'ovillo' })
    expect(sourceConfig('', 'gardend').kind).toBe('gardend')
  })
})

describe('the SELECT path against a real SPARQL engine (oxigraph)', () => {
  let sparql: SparqlProtocolServer
  beforeAll(async () => {
    sparql = await startSparqlProtocolServer()
    // N-Triples lines are SPARQL triples: the engine loads the files' own bytes into the two named graphs.
    sparql.store.update(`INSERT DATA { GRAPH <${OVILLO_DATA_GRAPH}> { ${FIXTURE_NT} } }`)
    sparql.store.update(`INSERT DATA { GRAPH <${OVILLO_UX_GRAPH}> { ${readFileSync(join(FIXTURE_DIR, 'ux-config.nt'), 'utf8')} } }`)
  })
  afterAll(async () => {
    await sparql.close()
  })

  it('reads the graph in ordered pages, triple for triple', async () => {
    const source = sparqlSource({ endpoint: sparql.url })
    const read = await readGraph(source, OVILLO_DATA_GRAPH, { pageSize: 40 })
    expect(read.testimony.via).toBe('select')
    expect(read.testimony.pages).toBe(Math.ceil((FIXTURE_TRIPLES.length + 1) / 40))
    expect(read.testimony.skipped).toBe(0)
    expect(canonical(read.triples)).toEqual(canonical(FIXTURE_TRIPLES))
    // The model is the same whichever way the triples came.
    expect(parseOvillo(read.triples)).toEqual(parseOvillo(FIXTURE_TRIPLES))
    const layouts = await loadOvilloLayouts(source)
    expect(layouts.docs).toEqual(defaultOvilloLayouts())
    await source.close()
  })

  it('refuses to build a query around an unsafe graph IRI', () => {
    expect(() => pagedTriplesQuery('urn:x> } DROP ALL #', 10, 0)).toThrow(/unsafe graph IRI/)
  })
})

const GARDEND = process.env.OVILLO_GARDEND_URL ?? 'http://127.0.0.1:7792'
let gardendUp = false
try {
  gardendUp = (await fetch(`${GARDEND}/health`, { signal: AbortSignal.timeout(1500) })).ok
} catch {
  gardendUp = false
}

describe('a real public-mode gardend, as a visitor', () => {
  it.skipIf(!gardendUp)(`reads the ovillo graph over sparql_query in pages, with no credential (${GARDEND})`, async () => {
    const source = createOvilloSource({ ...sourceConfig('?source=gardend', undefined), mcpUrl: `${GARDEND}/mcp` })
    expect(source.description).toMatchObject({ kind: 'gardend-local', sparql: true })
    const read = await readGraph(source, OVILLO_DATA_GRAPH)
    expect(read.testimony.via).toBe('select')
    expect(read.testimony.tripleCount).toBeGreaterThan(0)
    const graph = parseOvillo(read.triples)
    expect(graph.pieces.length).toBeGreaterThan(0)
    for (const p of graph.pieces) expect(p.render?.audio, p.slug).toBeTruthy()
    // With OVILLO_OUT naming the graph this gardend serves, the SELECT read is the built graph's, model for model
    // (the stores write numbers in their own lexical forms, so triples are compared through the codec; score
    // texts, tabs and all, must come back byte for byte).
    const out = process.env.OVILLO_OUT
    if (out && existsSync(join(out, 'ovillo.nt'))) {
      const built = parseOvillo(parseNT(readFileSync(join(out, 'ovillo.nt'), 'utf8')))
      expect(graph).toEqual(built)
    }
    // A visitor may not dump: the dump is refused, which is why the app SELECTs.
    await expect(source.read(OVILLO_DATA_GRAPH)).rejects.toMatchObject({ name: 'TripleSourceError' })
    const layouts = await loadOvilloLayouts(source)
    expect(layouts.docs.home.layoutId).toBe('ovillo-home-v1')
    await source.close()
  })
  it.skipIf(gardendUp)(`no gardend answers at ${GARDEND}: the visitor read is not exercised in this run`, () => {
    expect(gardendUp).toBe(false)
  })
})
