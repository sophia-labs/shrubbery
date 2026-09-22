/**
 * negotiate.ts — THE content-negotiation rule (the one that survives, D12/R5).
 *
 * Hoisted from the two app-local copies (apps/rhizome + apps/storybook/conneg,
 * both retired) so exactly one negotiate exists. It MIRRORS the CloudFront
 * viewer-request function we will deploy later — pure (string in, decision out)
 * so the same logic runs in every dev server AND can be transcribed verbatim
 * into a `cloudfront-js-2.0` function.
 *
 * THE RULE (one URL grammar, four faces):
 *   1. An explicit `.ext` in the LAST path segment ALWAYS wins
 *      (`/catalog/mn-top-bar.ttl` pins turtle on `/catalog/mn-top-bar`).
 *   2. Otherwise look at `Accept`:
 *        text/html             → dom      — browsers
 *        application/ld+json   → json
 *        application/json      → json
 *        text/turtle           → turtle
 *        text/markdown         → hypertext
 *        (anything else / star / missing) → markdown — the DEFAULT
 *   3. The default is MARKDOWN — the whole point: a bare `curl` gets a
 *      beautiful, navigable page, never a machine-only blob.
 *
 * The query string (e.g. `?asof=…`, the temporal lens) is split off here and
 * returned separately, so it never breaks routing but stays available to the
 * data layer. `?asof` is RESERVED in the grammar.
 *
 * Network-free, DOM-free: `URLSearchParams` is a language-level global.
 */

import type { RenderTarget } from './target.js'

const EXT_TO_TARGET: Record<string, RenderTarget> = {
  md: 'hypertext',
  markdown: 'hypertext',
  ttl: 'turtle',
  json: 'json',
  jsonld: 'json',
  html: 'dom',
}

/**
 * The unified negotiation decision — the superset of the two retired app-local
 * shapes (rhizome's `query` + storybook's `pinned`), so both consumers migrate
 * mechanically.
 */
export interface NegotiationResult {
  /** The bare resource path (extension + query stripped), e.g. '/plot/3c373460'. */
  readonly path: string
  /** The chosen face. */
  readonly target: RenderTarget
  /** Parsed query params (e.g. { asof: '2023-05-25' }). */
  readonly query: URLSearchParams
  /** True if an explicit `.ext` pinned the face (it wins over Accept). */
  readonly pinned: boolean
}

/** Map an Accept header to a target (default = markdown). Order: most specific. */
export function targetFromAccept(accept: string | undefined): RenderTarget {
  if (!accept) return 'hypertext'
  const a = accept.toLowerCase()
  // Browsers send text/html first → SPA/html. Honor explicit machine types.
  if (a.includes('text/html')) return 'dom'
  if (a.includes('application/ld+json')) return 'json'
  if (a.includes('application/json')) return 'json'
  if (a.includes('text/turtle')) return 'turtle'
  if (a.includes('text/markdown')) return 'hypertext'
  // text/plain, */*, missing, anything else → the markdown default.
  return 'hypertext'
}

/**
 * Negotiate a raw request URL + Accept into `{ path, target, query, pinned }`.
 *
 * Splits the query string off first, collapses a trailing slash (but keeps the
 * root '/'), then splits a trailing `.ext` off the LAST path segment. An
 * explicit ext wins; otherwise Accept decides; the default is markdown.
 */
export function negotiate(rawUrl: string, accept: string | undefined): NegotiationResult {
  const qIdx = rawUrl.indexOf('?')
  const query = new URLSearchParams(qIdx >= 0 ? rawUrl.slice(qIdx + 1) : '')
  let p = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl
  if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '')

  const lastSlash = p.lastIndexOf('/')
  const seg = p.slice(lastSlash + 1)
  const dot = seg.lastIndexOf('.')
  if (dot > 0) {
    const ext = seg.slice(dot + 1).toLowerCase()
    const pinnedTarget = EXT_TO_TARGET[ext]
    if (pinnedTarget) {
      const base = p.slice(0, lastSlash + 1) + seg.slice(0, dot)
      return { path: base, target: pinnedTarget, query, pinned: true }
    }
  }
  return { path: p, target: targetFromAccept(accept), query, pinned: false }
}
