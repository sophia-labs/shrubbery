/**
 * render-turtle.ts — the `turtle` face (rel=describedby).
 *
 * Near-free: the resource's Triple[] already exists (resourceToTriples, which for
 * a workspace REUSES nucleus serializeConfigToTriples), and turtle.ts pretty-
 * prints + round-trips it. We prepend the AltLinks as Turtle comments so the
 * turtle face ALSO carries the navigable sibling set (parity: same links as every
 * other face), readable by a human curling the .ttl.
 *
 * Pure: no DOM, no network.
 */

import { triplesToTurtle } from './turtle.js'
import { resourceToTriples } from './resource-triples.js'
import { linksFor } from './links.js'
import { CONTENT_TYPE, type RenderCtx, type RenderedResource, type Resource } from './target.js'

export function renderTurtle(resource: Resource, ctx: RenderCtx): RenderedResource {
  const triples = resourceToTriples(resource)
  const links = linksFor(resource, 'turtle', ctx)

  // The same links every face carries, as a Turtle comment header (FAIR Link set
  // in a human-readable form for the .ttl reader; the conneg server also emits
  // them as real HTTP Link headers).
  const linkComments = links.map((l) => `# link: <${l.href}> rel=${l.rel} type=${l.type}`).join('\n')

  const body = `${linkComments}\n\n${triplesToTurtle(triples)}`
  return { body, contentType: CONTENT_TYPE.turtle, links }
}
