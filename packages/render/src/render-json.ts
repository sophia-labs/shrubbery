/**
 * render-json.ts — the `json` face = COMPACTED JSON-LD (the ratified amendment).
 *
 * The json face is NOT ad-hoc JSON: it is compacted JSON-LD built from the SAME
 * triples the turtle face uses (resourceToTriples), via the standard `jsonld`
 * library: triples → N-Quads (nucleus triplesToNT, a subset of N-Quads) →
 * jsonld.fromRDF → jsonld.compact against the SHARED_CONTEXT defined once in
 * context.ts. So:
 *   - the json face expands back to the exact same RDF (round-trip via jsonld),
 *   - turtle and json never disagree (one triple production), and
 *   - consumers get stable term names from the one up-front @context.
 *
 * jsonld is a PURE transform dep — no DOM, no network (we never resolve remote
 * contexts; the @context is inlined).
 */

import jsonld from 'jsonld'
import { triplesToNT } from '@shrubbery/nucleus'
import { resourceToTriples } from './resource-triples.js'
import { linksFor } from './links.js'
import { SHARED_CONTEXT } from './context.js'
import { CONTENT_TYPE, type RenderCtx, type RenderedResource, type Resource } from './target.js'

/**
 * Build the compacted JSON-LD object for a resource (no link injection) — exposed
 * for tests that want to expand/round-trip the pure JSON-LD without the
 * presentation `_links` block.
 */
export async function toCompactJsonLd(resource: Resource): Promise<Record<string, unknown>> {
  const triples = resourceToTriples(resource)
  const nquads = triplesToNT(triples) + (triples.length ? '\n' : '')
  // N-Triples is the no-graph subset of N-Quads — jsonld parses it directly.
  // We keep `useNativeTypes` OFF: it yields the cleanest COMPACTED form (nice
  // term names like `count`/`built`, plain string values rather than verbose
  // {@type,@value} objects). The xsd: datatypes are NOT lost — the @context's
  // `@type` coercions re-attach them on expansion, so the JSON-LD round-trips to
  // the EXACT same RDF (the test pins this). Native-number/boolean output is a
  // worse tradeoff for a "browsable beautifully" face (it verbose-expands every
  // string), so the readable face wins here.
  const dataset = await jsonld.fromRDF(nquads, { format: 'application/n-quads' })
  const compacted = await jsonld.compact(dataset, SHARED_CONTEXT as jsonld.ContextDefinition)
  return compacted as unknown as Record<string, unknown>
}

export async function renderJson(resource: Resource, ctx: RenderCtx): Promise<RenderedResource> {
  const compacted = await toCompactJsonLd(resource)
  const links = linksFor(resource, 'json', ctx)

  // Carry the FAIR link set in-body too (parity), under a non-RDF `_links` key so
  // it does not pollute the JSON-LD graph (it has no @context term → jsonld drops
  // it on expansion; the data stays clean RDF, the navigation stays present).
  const withLinks = {
    ...compacted,
    _links: links.map((l) => ({ rel: l.rel, href: l.href, type: l.type, ...(l.title ? { title: l.title } : {}) })),
  }

  return {
    body: JSON.stringify(withLinks, null, 2),
    contentType: CONTENT_TYPE.json,
    links,
  }
}
