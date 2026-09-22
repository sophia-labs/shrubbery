/**
 * JSON-LD face — REAL tests via the standard `jsonld` lib (no mock):
 *   - the compacted JSON-LD EXPANDS to valid RDF (jsonld.toRDF),
 *   - it ROUND-TRIPS to the exact same triple set the turtle face uses
 *     (the no-drift guarantee: one triple production, two RDF faces),
 *   - the shared @context is carried + compacts the vocab to readable terms,
 *   - the body is the rendered face with the same Link set (parity).
 */

import { describe, it, expect } from 'vitest'
import jsonld from 'jsonld'
import {
  compareTriples,
  triplesToNT,
  parseNT,
  type Triple,
} from '@shrubbery/nucleus'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import {
  renderJson,
  toCompactJsonLd,
  resourceToTriples,
  type RenderCtx,
  type Resource,
} from '../index.js'

const ctx: RenderCtx = { baseUrl: 'http://localhost:8787', selfPath: '/catalog', upPath: null }

const CATALOG: Resource = {
  kind: 'catalog',
  id: 'catalog',
  title: 'Shrubbery Catalog',
  summary: 'The catalog.',
  components: [
    { tag: 'mn-top-bar', persistence: 'stamp', manifested: false, built: true, face: 'built-chrome', blurb: 'Top bar.' },
    { tag: 'mn-graph-panel', persistence: 'stamp', manifested: true, built: true, face: 'manifest-panel', blurb: 'Controlled SVG graph panel.' },
  ],
}

function canon(ts: readonly Triple[]): string {
  return triplesToNT([...ts].sort(compareTriples))
}

/** Expand a compacted JSON-LD object back to its triple set (via jsonld.toRDF). */
async function expandToTriples(compacted: Record<string, unknown>): Promise<Triple[]> {
  const nquads = (await jsonld.toRDF(compacted, { format: 'application/n-quads' })) as unknown as string
  return parseNT(nquads)
}

describe('json face — compacted JSON-LD, round-trips via jsonld', () => {
  it('compacted JSON-LD expands to the EXACT same RDF as the resource triples (catalog)', async () => {
    const compacted = await toCompactJsonLd(CATALOG)
    const back = await expandToTriples(compacted)
    expect(canon(back)).toBe(canon(resourceToTriples(CATALOG)))
  })

  it('compacted JSON-LD round-trips the REAL GARDEN_DEFAULT workspace (typed literals)', async () => {
    const ws: Resource = { kind: 'workspace', config: GARDEN_DEFAULT }
    const compacted = await toCompactJsonLd(ws)
    const back = await expandToTriples(compacted)
    expect(canon(back)).toBe(canon(resourceToTriples(ws)))
  })

  it('carries the shared @context and compacts vocab to readable terms', async () => {
    const compacted = (await toCompactJsonLd(CATALOG)) as Record<string, unknown>
    const context = compacted['@context'] as Record<string, unknown>
    expect(context).toBeDefined()
    expect(context.comp).toBe('http://sophia.ai/component#')
    expect(context.cat).toBe('http://sophia.ai/catalog#')
    // The compacted graph uses the term names from the @context, not raw IRIs.
    const graph = compacted['@graph'] as Array<Record<string, unknown>>
    const cat = graph.find((n) => n['@id'] === 'cat:catalog')!
    expect(cat['@type']).toBe('cat:Catalog')
    expect(cat).toHaveProperty('entries') // cat:hasEntry → `entries`
    expect(cat).toHaveProperty('summary')
    const comp = graph.find((n) => n['@id'] === 'comp:mn-top-bar')!
    expect(comp['@type']).toBe('comp:Component')
    expect(comp).toHaveProperty('persistence')
    expect(comp).toHaveProperty('blurb')
  })

  it('renderJson returns application/ld+json with parseable body + in-body _links', async () => {
    const out = await renderJson(CATALOG, ctx)
    expect(out.contentType).toContain('application/ld+json')
    const parsed = JSON.parse(out.body) as Record<string, unknown>
    expect(parsed['@context']).toBeDefined()
    expect(Array.isArray(parsed._links)).toBe(true)
    // _links carries the SAME hrefs as the RenderedResource.links (parity surface).
    const linkHrefs = (parsed._links as Array<{ href: string }>).map((l) => l.href).sort()
    expect(linkHrefs).toEqual(out.links.map((l) => l.href).sort())
  })

  it('the _links block is NOT part of the RDF graph (drops on expansion)', async () => {
    // _links has no @context term → jsonld ignores it; the expanded RDF is clean.
    const out = await renderJson(CATALOG, ctx)
    const parsed = JSON.parse(out.body) as Record<string, unknown>
    const back = await expandToTriples(parsed)
    expect(canon(back)).toBe(canon(resourceToTriples(CATALOG)))
  })
})
