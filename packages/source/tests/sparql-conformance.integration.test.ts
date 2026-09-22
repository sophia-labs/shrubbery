/**
 * sparql-conformance.integration.test.ts — the generic 'sparql-http' adapter
 * (U6) against the FULL conformance suite on a REAL third-party engine: the
 * oxigraph WASM Store behind a REAL node:http SPARQL 1.1 Protocol server.
 * NO MOCKS: real engine, real HTTP, real seed bytes.
 *
 * Proves (U6 acceptance):
 *   - conformance green vs the oxigraph-engine-backed protocol server;
 *   - codec parity: the canonical seed loaded into a named graph reads back
 *     TERM-FOR-TERM equal to the fossil parse of the same bytes;
 *   - an EMPTY named graph resolves 0 — a successful read, never a fallback;
 *   - standard bnode bindings are accepted: select() returns TYPED bnode
 *     SourceTerms; read() carries subject bnodes lexically ('_:label') and
 *     REFUSES object bnodes with an honest 'protocol' error naming select()
 *     (the nucleus Triple model deliberately excludes blank-node objects);
 *   - purity: the adapter source contains no gardend/gateway/MCP references
 *     (the greppable zero-Sophia-isms check);
 *   - taxonomy over real HTTP: wrong path → 'not-found'; dead server →
 *     'unavailable' with the verbatim connect error; engine query refusal
 *     (HTTP 400) → 'protocol'; an ASK answer through select() → 'protocol';
 *   - caller headers ride every protocol request (pass-through observer over
 *     the REAL fetch — the request still hits the real server);
 *   - sourceFromBoot wires adapter 'sparql' end-to-end;
 *   - env-gated second run against PLANTER_SPARQL_URL ctx.skips honestly
 *     when unset.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { namedNode } from 'oxigraph'
import { TripleSourceError, compareTriples, parseNT } from '@shrubbery/nucleus'
import { sourceFromBoot, sparqlSource, type SparqlSourceDescription } from '../src/index.js'
import {
  startSparqlProtocolServer,
  type SparqlProtocolServer,
} from '../src/conformance/sparql-protocol-server.js'
import { runTripleSourceConformance } from '../src/conformance/suite.js'

const require = createRequire(import.meta.url)
const SEED_BODY = readFileSync(
  require.resolve('@shrubbery/nucleus/seed/garden-default.ux.nt'),
  'utf8',
)
const SEED_TRIPLE_COUNT = parseNT(SEED_BODY).length

// Deliberately NEUTRAL graph IRIs — nothing Mnemosyne-shaped: the adapter is
// generic over any named graph in any conformant store.
const SITE_IRI = 'urn:example:planter:site'
const EMPTY_IRI = 'urn:example:planter:never-written'
const BNODE_SUBJECT_IRI = 'urn:example:planter:bnode-subjects'
const BNODE_OBJECT_IRI = 'urn:example:planter:bnode-objects'
const XSD_INT = 'http://www.w3.org/2001/XMLSchema#integer'

const NT = 'application/n-triples'

let server: SparqlProtocolServer

beforeAll(async () => {
  server = await startSparqlProtocolServer()
  // The REAL canonical GARDEN_DEFAULT seed bytes, loaded by the REAL engine.
  server.store.load(SEED_BODY, { format: NT, to_graph_name: namedNode(SITE_IRI) })
  // Blank-node fixtures: one graph with bnode SUBJECTS only, one with a
  // bnode OBJECT (third-party stores legitimately hold both).
  server.store.load(
    [
      '_:actor <urn:example:vocab:role> "narrator" .',
      `_:actor <urn:example:vocab:age> "3"^^<${XSD_INT}> .`,
      '',
    ].join('\n'),
    { format: NT, to_graph_name: namedNode(BNODE_SUBJECT_IRI) },
  )
  server.store.load('<urn:example:doc:1> <urn:example:vocab:author> _:someone .\n', {
    format: NT,
    to_graph_name: namedNode(BNODE_OBJECT_IRI),
  })
})

afterAll(async () => {
  await server.close()
})

// ── FULL conformance: real engine, real HTTP, the canonical seed ─────────────

runTripleSourceConformance(
  `sparql-http (REAL oxigraph engine behind REAL HTTP, ${SEED_TRIPLE_COUNT}-triple seed)`,
  () => sparqlSource({ endpoint: server.url, graphIri: SITE_IRI }),
  {
    graphIri: SITE_IRI,
    expectedTripleCount: SEED_TRIPLE_COUNT,
    emptyGraphIri: EMPTY_IRI,
    // The engine refuses a malformed query (HTTP 400, message verbatim) →
    // the adapter's 'protocol' code.
    induceFailure: s => s.select!('THIS IS NOT SPARQL'),
    // MED-4: the REAL oxigraph 0.5.9 parser's own refusal text for this exact
    // malformed query, pinned against the package.json-pinned engine version
    // (deterministic — no live network, no version drift within this repo).
    expectedErrorDetailFragment: 'expected CONSTRUCT',
  },
)

// ── Adapter-specific proofs on the same real server ─────────────────────────

describe('REAL INTEGRATION — sparql-http specifics', () => {
  it('codec parity: SELECT-spo reassembly ≡ the fossil parse of the same bytes (term-for-term)', async () => {
    const source = sparqlSource({ endpoint: server.url })
    const read = await source.read(SITE_IRI)
    expect(read.tripleCount).toBe(SEED_TRIPLE_COUNT)
    const viaProtocol = [...read.triples!].sort(compareTriples)
    const viaFossilParse = [...parseNT(SEED_BODY)].sort(compareTriples)
    expect(viaProtocol).toEqual(viaFossilParse)
    await source.close()
  })

  it('an EMPTY named graph resolves 0 — successful read, never a fallback', async () => {
    const source = sparqlSource({ endpoint: server.url })
    const read = await source.read(EMPTY_IRI)
    expect(read.graphIri).toBe(EMPTY_IRI)
    expect(read.tripleCount).toBe(0)
    expect(read.triples).toEqual([])
    await source.close()
  })

  it('select() returns TYPED bnode SourceTerms (subject and object positions)', async () => {
    const source = sparqlSource({ endpoint: server.url })
    const subjects = await source.select!(
      `SELECT ?s ?o WHERE { GRAPH <${BNODE_SUBJECT_IRI}> { ?s <urn:example:vocab:role> ?o } }`,
    )
    expect(subjects.rows.length).toBe(1)
    expect(subjects.rows[0].s.type).toBe('bnode')
    expect(subjects.rows[0].s.value.length).toBeGreaterThan(0)
    expect(subjects.rows[0].o).toEqual({ type: 'literal', value: 'narrator' })

    const objects = await source.select!(
      `SELECT ?author WHERE { GRAPH <${BNODE_OBJECT_IRI}> { <urn:example:doc:1> <urn:example:vocab:author> ?author } }`,
    )
    expect(objects.rows.length).toBe(1)
    expect(objects.rows[0].author.type).toBe('bnode')
    await source.close()
  })

  it("read() accepts SUBJECT bnodes in their lexical '_:' form, typed literals intact", async () => {
    const source = sparqlSource({ endpoint: server.url })
    const read = await source.read(BNODE_SUBJECT_IRI)
    expect(read.tripleCount).toBe(2)
    for (const t of read.triples!) expect(t.s.startsWith('_:')).toBe(true)
    // One shared blank node → one shared label across the result set.
    expect(new Set(read.triples!.map(t => t.s)).size).toBe(1)
    const age = read.triples!.find(t => t.p === 'urn:example:vocab:age')
    expect(age?.o).toEqual({ type: 'literal', value: '3', datatype: XSD_INT })
    await source.close()
  })

  it("read() REFUSES OBJECT bnodes honestly ('protocol', naming select())", async () => {
    const source = sparqlSource({ endpoint: server.url })
    let thrown: unknown
    try {
      await source.read(BNODE_OBJECT_IRI)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TripleSourceError)
    const err = thrown as TripleSourceError
    expect(err.code).toBe('protocol')
    expect(err.message).toMatch(/blank node/)
    expect(err.message).toMatch(/select\(\)/)
    await source.close()
  })

  it('purity: the adapter source contains no gardend/gateway/MCP references (greppable)', () => {
    const adapterSource = readFileSync(
      new URL('../src/sparql/sparql-source.ts', import.meta.url),
      'utf8',
    )
    expect(adapterSource).not.toMatch(/gardend/i)
    expect(adapterSource).not.toMatch(/gateway/i)
    expect(adapterSource).not.toMatch(/mcp/i)
  })

  it('description testifies honestly and is credential-free (headers never surface)', () => {
    const source = sparqlSource({
      endpoint: server.url,
      graphIri: SITE_IRI,
      headers: { authorization: 'Bearer super-secret-credential' },
      suggestedPollMs: 7000,
    })
    expect(source.description).toEqual({
      kind: 'sparql-http',
      liveness: 'poll',
      sparql: true,
      endpoint: server.url,
      graphIri: SITE_IRI,
      suggestedPollMs: 7000,
    })
    expect(JSON.stringify(source.description)).not.toContain('super-secret-credential')
  })

  it('caller headers ride the wire (pass-through observer over the REAL fetch)', async () => {
    const seen: Array<Record<string, string>> = []
    const observing: typeof fetch = (input, init) => {
      seen.push({ ...((init?.headers ?? {}) as Record<string, string>) })
      return fetch(input, init)
    }
    const source = sparqlSource({
      endpoint: server.url,
      headers: { authorization: 'Bearer riding-token' },
      fetch: observing,
    })
    const read = await source.read(SITE_IRI) // the request really hits the server
    expect(read.tripleCount).toBe(SEED_TRIPLE_COUNT)
    expect(seen.length).toBe(1)
    expect(seen[0].authorization).toBe('Bearer riding-token')
    expect(seen[0].accept).toBe('application/sparql-results+json')
    expect(seen[0]['content-type']).toBe('application/sparql-query')
    await source.close()
  })

  it("a wrong endpoint path → 'not-found' with the server's message verbatim", async () => {
    const source = sparqlSource({ endpoint: server.url.replace('/sparql', '/nowhere') })
    let thrown: unknown
    try {
      await source.read(SITE_IRI)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TripleSourceError)
    const err = thrown as TripleSourceError
    expect(err.code).toBe('not-found')
    expect(err.status).toBe(404)
    expect(err.detail).toMatch(/no SPARQL endpoint/)
    await source.close()
  })

  it("a DEAD server → 'unavailable' with the verbatim connect error", async () => {
    const victim = await startSparqlProtocolServer()
    const source = sparqlSource({ endpoint: victim.url })
    await victim.close()
    let thrown: unknown
    try {
      await source.read(SITE_IRI)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TripleSourceError)
    const err = thrown as TripleSourceError
    expect(err.code).toBe('unavailable')
    expect(err.detail).toMatch(/ECONNREFUSED|ECONNRESET|socket|connect|fetch failed/i)
    await source.close()
  })

  it("an ASK answer through select() → 'protocol' (contracted for SELECT)", async () => {
    const source = sparqlSource({ endpoint: server.url })
    let thrown: unknown
    try {
      await source.select!(`ASK { GRAPH <${SITE_IRI}> { ?s ?p ?o } }`)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(TripleSourceError)
    expect((thrown as TripleSourceError).code).toBe('protocol')
    await source.close()
  })

  it("sourceFromBoot wires adapter 'sparql' end-to-end against the real server", async () => {
    const source = await sourceFromBoot({
      endpoint: server.url,
      graph: 'planter-site',
      auth: { mode: 'none' },
      adapter: 'sparql',
      configGraphIri: SITE_IRI,
      pollMs: 9000,
    })
    expect(source.description.kind).toBe('sparql-http')
    expect((source.description as SparqlSourceDescription).graphIri).toBe(SITE_IRI)
    expect(source.description.suggestedPollMs).toBe(9000)
    const read = await source.read(SITE_IRI)
    expect(read.tripleCount).toBe(SEED_TRIPLE_COUNT)
    await source.close()
  })
})

// ── Env-gated second run: any EXTERNAL SPARQL 1.1 Protocol endpoint ─────────

describe('env-gated external endpoint (PLANTER_SPARQL_URL)', () => {
  const externalUrl = process.env.PLANTER_SPARQL_URL

  it('a generic SELECT passes through against the external store', async ctx => {
    if (!externalUrl) {
      ctx.skip() // honest skip: no external endpoint configured
      return
    }
    const source = sparqlSource({ endpoint: externalUrl })
    const res = await source.select!('SELECT * WHERE { ?s ?p ?o } LIMIT 1')
    expect(Array.isArray(res.rows)).toBe(true)
    expect(Number.isInteger(res.readAt)).toBe(true)
    await source.close()
  })

  it('reads PLANTER_SPARQL_GRAPH_IRI self-consistently (COUNT cross-check) when provided', async ctx => {
    const graphIri = process.env.PLANTER_SPARQL_GRAPH_IRI
    if (!externalUrl || !graphIri) {
      ctx.skip() // honest skip: endpoint and/or graph IRI not configured
      return
    }
    const source = sparqlSource({ endpoint: externalUrl })
    const read = await source.read(graphIri)
    expect(read.tripleCount).toBe(read.triples!.length)
    const res = await source.select!(
      `SELECT (COUNT(*) AS ?n) WHERE { GRAPH <${graphIri}> { ?s ?p ?o } }`,
    )
    expect(Number(res.rows[0].n.value)).toBe(read.tripleCount)
    await source.close()
  })
})
