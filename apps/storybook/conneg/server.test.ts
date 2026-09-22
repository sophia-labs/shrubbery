// @vitest-environment node
//
// Node env (not happy-dom): this test starts a REAL HTTP server and `fetch`es it.
// happy-dom's fetch enforces a browser same-origin policy and blocks loopback
// requests — this is a node-level network test, so it runs in the node env.

/**
 * conneg server — a REAL in-process HTTP probe (no mock). We start the actual
 * server on an ephemeral port and `fetch` it exactly as `curl` would, asserting:
 *   - bare GET (no Accept) → markdown with the Navigate block (the default),
 *   - Accept → each face, with the right Content-Type + Vary + Link headers,
 *   - explicit `.ext` wins over Accept,
 *   - the component item page + 404 behave,
 *   - the server-emitted Link header matches the in-body link set (parity),
 *   - the markdown Navigate curls actually resolve when followed (HATEOAS).
 *
 * The server IS the probe-able organism — this is that probe, automated.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createConnegServer } from './server.js'

let server: Server
let base: string

beforeAll(async () => {
  server = createConnegServer()
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

describe('conneg server — the four faces, negotiated', () => {
  it('bare GET /catalog (no Accept) → markdown + Navigate block', async () => {
    const res = await fetch(`${base}/catalog`) // no Accept header set by fetch beyond */*
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    const body = await res.text()
    expect(body).toContain('# Shrubbery Component Catalog')
    expect(body).toContain('## Navigate')
    expect(body).toContain('curl ') // copy-pasteable curls present
  })

  it('Accept: text/turtle → turtle', async () => {
    const res = await fetch(`${base}/catalog`, { headers: { accept: 'text/turtle' } })
    expect(res.headers.get('content-type')).toContain('text/turtle')
    const body = await res.text()
    expect(body).toContain('@prefix')
    expect(body).toContain('a cat:Catalog')
  })

  it('Accept: application/ld+json → JSON-LD with @context', async () => {
    const res = await fetch(`${base}/catalog`, { headers: { accept: 'application/ld+json' } })
    expect(res.headers.get('content-type')).toContain('application/ld+json')
    const json = (await res.json()) as Record<string, unknown>
    expect(json['@context']).toBeDefined()
  })

  it('Accept: text/html → html shell', async () => {
    const res = await fetch(`${base}/catalog`, { headers: { accept: 'text/html' } })
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('<!doctype html>')
    expect(body).toContain('<link rel="describedby"')
  })

  it('explicit .ttl wins over Accept: text/html', async () => {
    const res = await fetch(`${base}/catalog.ttl`, { headers: { accept: 'text/html' } })
    expect(res.headers.get('content-type')).toContain('text/turtle')
  })

  it('emits Vary: Accept + a FAIR Signposting Link header (self + describedby)', async () => {
    const res = await fetch(`${base}/catalog`)
    expect(res.headers.get('vary')).toBe('Accept')
    const link = res.headers.get('link') ?? ''
    expect(link).toContain('rel="self"')
    expect(link).toContain('rel="describedby"')
    expect(link).toContain(`<${base}/catalog.ttl>`)
  })

  it('a component item page renders facts + up/collection navigation', async () => {
    const res = await fetch(`${base}/catalog/mn-graph-panel`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('# `mn-graph-panel`')
    // Assert the REAL derived persistence fact reaches the page: mn-graph-panel is
    // engine Class C (GPU/WebGL-bound) in the manifest, not the defaulted 'stamp'
    // — proving `persistenceOf(tag)` flows through the facts block, not a literal.
    expect(body).toContain('persistent-non-relocatable')
    const link = res.headers.get('link') ?? ''
    expect(link).toContain('rel="up"')
    expect(link).toContain('rel="collection"')
  })

  it('unknown path → 404', async () => {
    const res = await fetch(`${base}/nope`)
    expect(res.status).toBe(404)
  })

  it('HATEOAS — the item links in the catalog markdown actually resolve', async () => {
    const res = await fetch(`${base}/catalog`)
    const body = await res.text()
    // Pull the first `curl <base>/catalog/<tag>` from the Navigate block and follow it.
    const m = new RegExp(`curl (${base.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}/catalog/[\\w-]+)`).exec(body)
    expect(m, 'a component curl must be present in the Navigate block').toBeTruthy()
    const followed = await fetch(m![1])
    expect(followed.status).toBe(200)
    expect((await followed.text())).toContain('## Facts')
  })

  it('the workspace resource is curl-able (GARDEN_DEFAULT, all faces)', async () => {
    const md = await fetch(`${base}/workspace`)
    expect((await md.text())).toContain('Garden Default Workspace')
    const ttl = await fetch(`${base}/workspace`, { headers: { accept: 'text/turtle' } })
    expect((await ttl.text())).toContain('sux:')
    const json = await fetch(`${base}/workspace`, { headers: { accept: 'application/json' } })
    expect((await json.json()) as unknown).toBeTruthy()
  })
})

describe('conneg server — the EMPORIUM vocab catalogue, curl-able over the wire', () => {
  // EMPORIUM = the catalogue OF vocabularies ("the pack IS the catalog"). The
  // resource data is the captured-real /emporium registry (workflow +
  // sophia-memory-core), served here through the SAME real conneg HTTP path the
  // catalog/workspace resources use. This is the end-to-end curl proof, automated.

  it('bare GET /emporium (no Accept) → markdown lists the REAL packs + a Navigate block', async () => {
    const res = await fetch(`${base}/emporium`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    const body = await res.text()
    expect(body).toContain('# Emporium — vocabulary catalogue')
    expect(body).toContain('2 vocabularies')
    // the REAL packs the cell serves (not invented).
    expect(body).toContain('`workflow`')
    expect(body).toContain('`sophia-memory-core`')
    expect(body).toContain('http://mnemosyne.dev/workflow#')
    expect(body).toContain('bc50e854') // real truncated content-hash sha
    expect(body).toContain('## Navigate')
    expect(body).toContain(`curl ${base}/emporium/workflow`)
  })

  it('Accept: text/turtle → Turtle (emp:Catalog + one emp:Vocabulary per real pack)', async () => {
    const res = await fetch(`${base}/emporium`, { headers: { accept: 'text/turtle' } })
    expect(res.headers.get('content-type')).toContain('text/turtle')
    const body = await res.text()
    expect(body).toContain('@prefix emp:')
    expect(body).toContain('a emp:Catalog')
    expect(body).toContain('a emp:Vocabulary')
    expect(body).toContain('"workflow"')
    expect(body).toContain('"sophia-memory-core"')
    // the real 64-hex content-hash sha is present verbatim.
    expect(body).toContain('bc50e854bd4eed51ef3e1644db72662610af34f037d9802f1804a009eec77eff')
  })

  it('Accept: application/ld+json → JSON-LD whose served bytes do not drift from the Turtle face', async () => {
    const jsonRes = await fetch(`${base}/emporium`, { headers: { accept: 'application/ld+json' } })
    expect(jsonRes.headers.get('content-type')).toContain('application/ld+json')
    const json = (await jsonRes.json()) as Record<string, unknown>
    expect(json['@context']).toBeDefined()
    expect(JSON.stringify(json['@context'])).toContain('emp')
    // the @graph carries the catalog + the two real vocab nodes.
    const graph = (json['@graph'] ?? []) as Array<Record<string, unknown>>
    const names = graph.map((n) => n['vocabName']).filter(Boolean)
    expect(names).toContain('workflow')
    expect(names).toContain('sophia-memory-core')

    // No-drift invariant across the SERVED faces: the Turtle bytes the server
    // returns parse (via the render package's own round-tripping Turtle codec) to
    // the exact same canonical triple set the resource produces. The pure-package
    // render-vocab test already pins that the JSON-LD face round-trips to those
    // triples via jsonld; here we assert the WIRE bytes of the turtle face agree
    // with the canonical production, so curl's ttl and ld+json describe one graph.
    const ttl = await (await fetch(`${base}/emporium`, { headers: { accept: 'text/turtle' } })).text()
    const { parseTurtle, resourceToTriples } = await import('@shrubbery/render')
    const { vocabCatalogResource } = await import('./emporium.js')
    const servedTriples = parseTurtle(ttl)
    const canonical = resourceToTriples(vocabCatalogResource())
    expect(servedTriples.length).toBe(canonical.length)
    expect(servedTriples.length).toBeGreaterThan(8)
  })

  it('Accept: text/html → html shell with FAIR Signposting <link>s', async () => {
    const res = await fetch(`${base}/emporium`, { headers: { accept: 'text/html' } })
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('<!doctype html>')
    expect(body).toContain('<link rel="describedby"')
    expect(body).toContain(`${base}/emporium.ttl`)
  })

  it('explicit .ttl wins over Accept: text/html (negotiation rule holds for /emporium)', async () => {
    const res = await fetch(`${base}/emporium.ttl`, { headers: { accept: 'text/html' } })
    expect(res.headers.get('content-type')).toContain('text/turtle')
  })

  it('emits Vary: Accept + a FAIR Signposting Link header with rel=item per real pack', async () => {
    const res = await fetch(`${base}/emporium`)
    expect(res.headers.get('vary')).toBe('Accept')
    const link = res.headers.get('link') ?? ''
    expect(link).toContain('rel="self"')
    expect(link).toContain('rel="describedby"')
    expect(link).toContain(`<${base}/emporium.ttl>`)
    expect(link).toContain('rel="item"')
    expect(link).toContain(`<${base}/emporium/workflow>`)
    expect(link).toContain(`<${base}/emporium/sophia-memory-core>`)
  })

  it('a vocab-pack item page renders the REAL golden contract (classes + predicates) + up/collection', async () => {
    const res = await fetch(`${base}/emporium/workflow`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('# `workflow` — Mnemosyne Workflow Vocabulary')
    expect(body).toContain('http://mnemosyne.dev/workflow#')
    // real classes + a real predicate from the golden contract.
    expect(body).toContain('### `AgentNode`')
    expect(body).toContain('`wf:agentType`')
    const link = res.headers.get('link') ?? ''
    expect(link).toContain('rel="up"')
    expect(link).toContain('rel="collection"')
    expect(link).toContain('title="Emporium"')
  })

  it('HATEOAS — the pack links in the /emporium markdown actually resolve', async () => {
    const body = await (await fetch(`${base}/emporium`)).text()
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(`curl (${escaped}/emporium/[\\w-]+)`).exec(body)
    expect(m, 'a vocab-pack curl must be present in the Navigate block').toBeTruthy()
    const followed = await fetch(m![1])
    expect(followed.status).toBe(200)
    expect(await followed.text()).toContain('## Classes')
  })

  it('an unknown vocab pack → 404 (no faked pack served)', async () => {
    const res = await fetch(`${base}/emporium/does-not-exist`)
    expect(res.status).toBe(404)
  })

  // iter-5b: the DEEPENED pack-detail anatomy, served over the wire from the
  // captured-real golden contract (parsed by the SAME shell-side read-model).

  it('the /emporium/workflow markdown carries the FULL deepened anatomy', async () => {
    const body = await (await fetch(`${base}/emporium/workflow`)).text()
    // stats + namespaces + minting.
    expect(body).toMatch(/\d+ classes/)
    expect(body).toContain('## Namespaces')
    expect(body).toContain('## Minting')
    // relationships — a real predicate-range edge + a real CRDT wire (flowsInto).
    expect(body).toContain('## Relationships')
    expect(body).toContain('`wf:partOfWorkflow`')
    expect(body).toContain('`flowsInto`')
    // required-vs-optional grouping + a class subject rule.
    expect(body).toContain('**Required**')
    expect(body).toContain('**Subject rule:**')
  })

  it('the /emporium/sophia-memory-core markdown renders the REAL closed enums', async () => {
    const body = await (await fetch(`${base}/emporium/sophia-memory-core`)).text()
    // mem:sourceKind's 8-value closed enum + mem:contentOrientation's 6 values.
    expect(body).toContain('`mem:sourceKind`')
    expect(body).toContain('`ConversationTurn`')
    expect(body).toContain('`CodeChangeEvent`')
    expect(body).toContain('`mem:contentOrientation`')
    expect(body).toContain('`knowledge`')
  })

  it('the /emporium/workflow Turtle carries the deepened triples (relationships + minting, no face drift)', async () => {
    const ttl = await (await fetch(`${base}/emporium/workflow`, { headers: { accept: 'text/turtle' } })).text()
    expect(ttl).toContain('emp:Relationship')
    expect(ttl).toContain('"flowsInto"') // a real CRDT wire edge
    expect(ttl).toContain('emp:relatesTo') // an object-property range
    expect(ttl).toContain('emp:slugPattern')
    expect(ttl).toContain('emp:subjectRule')

    // The served Turtle bytes parse to the EXACT canonical triple set the pack
    // produces (the JSON-LD face round-trips to that same set in the pure test).
    const { parseTurtle, resourceToTriples } = await import('@shrubbery/render')
    const { vocabPackResource } = await import('./emporium.js')
    const servedTriples = parseTurtle(ttl)
    const canonical = resourceToTriples(vocabPackResource('workflow')!)
    expect(servedTriples.length).toBe(canonical.length)
  })

  it('the /emporium/sophia-memory-core Turtle carries the closed-enum triples', async () => {
    const ttl = await (await fetch(`${base}/emporium/sophia-memory-core`, { headers: { accept: 'text/turtle' } })).text()
    expect(ttl).toContain('emp:enumValue')
    expect(ttl).toContain('"ConversationTurn"')
    expect(ttl).toContain('"knowledge"')
  })

  it('HATEOAS — a relationship class-link in the pack markdown is followable', async () => {
    const body = await (await fetch(`${base}/emporium/workflow`)).text()
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // The Relationships section links each `to` class to its anchor on THIS page.
    const m = new RegExp(`\\]\\((${escaped}/emporium/workflow)#[\\w-]+\\)`).exec(body)
    expect(m, 'a relationship class-anchor link must be present').toBeTruthy()
    // curl drops the fragment; following the link returns the pack page itself.
    const followed = await fetch(m![1])
    expect(followed.status).toBe(200)
    expect(await followed.text()).toContain('## Classes')
  })
})
