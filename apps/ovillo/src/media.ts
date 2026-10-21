/**
 * media.ts — from the URLs the graph names to the URLs this page fetches.
 *
 * The graph names its files canonically (`https://ovillo.sophia-labs.com/media/x.mp3`)
 * or relative to the site (`media/x.mp3`). The page fetches them from wherever
 * the site is served: on ovillo.sophia-labs.com, in a local public-mode gardend,
 * or under the dev server. A canonical URL therefore becomes a path under
 * `mediaBase` (by default this origin's root), so every file is same-origin:
 * the CSP's `'self'` covers it and the Web Audio tap can hear it. Any other
 * absolute URL is left exactly as the graph states it.
 */

import { SITE_ORIGIN } from './vocab.js'

export interface MediaResolution {
  /** Where the site's files are served; '' = this origin's root. */
  readonly mediaBase?: string
  /** The canonical origin the graph's URLs use. */
  readonly canonicalOrigin?: string
}

export function resolveMediaUrl(url: string | undefined, opts: MediaResolution = {}): string | undefined {
  if (!url) return undefined
  const canonical = (opts.canonicalOrigin ?? SITE_ORIGIN).replace(/\/$/, '')
  const base = (opts.mediaBase ?? '').replace(/\/$/, '')
  if (url === canonical || url.startsWith(`${canonical}/`)) return `${base}${url.slice(canonical.length) || '/'}`
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url
  if (url.startsWith('/')) return `${base}${url}`
  return `${base}/${url}`
}
