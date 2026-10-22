/**
 * routes.ts — the app's pages, kept in the URL hash (a static host serves one file).
 *
 *   #/                 the gallery (home)
 *   #/piece/<slug>     a piece: player, energy traces, ledger, World, receipt, score
 *   #/bench            the live bench (mn-ovillo-bench mounts here)
 *   #/tract            the vocal tract (mn-ovillo-tract mounts here)
 *   #/score/<slug>     the score editor (Hoja's MUS mode mounts here)
 */

import type { OvilloRouteName } from './layout.js'

export type OvilloRoute =
  | { readonly name: 'home' }
  | { readonly name: 'piece'; readonly slug: string }
  | { readonly name: 'bench' }
  | { readonly name: 'tract' }
  | { readonly name: 'score'; readonly slug: string }

const SLUG = /^[a-z0-9][a-z0-9-]*$/

export function parseRoute(hash: string): OvilloRoute {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map((p) => decodeURIComponent(p))
  const [head, slug] = parts
  if (head === 'piece' && slug && SLUG.test(slug)) return { name: 'piece', slug }
  if (head === 'score' && slug && SLUG.test(slug)) return { name: 'score', slug }
  if (head === 'bench') return { name: 'bench' }
  if (head === 'tract') return { name: 'tract' }
  return { name: 'home' }
}

export function routeHash(route: OvilloRoute): string {
  switch (route.name) {
    case 'home':
      return '#/'
    case 'piece':
      return `#/piece/${encodeURIComponent(route.slug)}`
    case 'score':
      return `#/score/${encodeURIComponent(route.slug)}`
    default:
      return `#/${route.name}`
  }
}

export function routeLayoutName(route: OvilloRoute): OvilloRouteName {
  return route.name
}
