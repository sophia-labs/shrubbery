/**
 * render-resource.ts — the dispatcher: renderResource(resource, target, ctx).
 *
 * `target` is a PARAMETER. The resource model is target-agnostic (the same
 * Resource feeds all faces); this picks the face. Lit DOM remains delegated to
 * @shrubbery/runtime; the pure package only emits DOM strings for render-layer
 * value carriers that have no Lit dependency.
 *
 * Note: the json face is async (jsonld.fromRDF/compact are async), so the unified
 * entry point is async. `renderTextSync` is available for the two synchronous
 * faces (turtle/hypertext) when an async boundary is unwanted.
 *
 * Pure: no DOM, no network.
 */

import { renderTurtle } from './render-turtle.js'
import { renderJson } from './render-json.js'
import { renderHypertext } from './render-hypertext.js'
import { renderDom } from './render-dom.js'
import type { RenderCtx, RenderTarget, RenderedResource, Resource, TextTarget } from './target.js'

/**
 * Render a resource to a given target face.
 */
export async function renderResource(
  resource: Resource,
  target: RenderTarget,
  ctx: RenderCtx,
): Promise<RenderedResource> {
  switch (target) {
    case 'turtle':
      return renderTurtle(resource, ctx)
    case 'hypertext':
      return renderHypertext(resource, ctx)
    case 'json':
      return renderJson(resource, ctx)
    case 'dom':
      return renderDom(resource, ctx)
  }
}

/** Render a SYNCHRONOUS face (turtle/hypertext) — no async jsonld boundary. */
export function renderTextSync(
  resource: Resource,
  target: Exclude<TextTarget, 'json'>,
  ctx: RenderCtx,
): RenderedResource {
  return target === 'turtle' ? renderTurtle(resource, ctx) : renderHypertext(resource, ctx)
}
