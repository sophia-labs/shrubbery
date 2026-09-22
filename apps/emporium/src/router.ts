/**
 * router.ts — a tiny hash-router whose grammar MIRRORS the live curl URL grammar
 * the cell already serves (iter-4/5): /emporium, /emporium/{pack},
 * /emporium/{pack}/{class}. SHELL-side, backend-free, no dependency on lit or the
 * store — it only parses/serializes the location hash + notifies subscribers.
 *
 * We use the HASH (#/emporium/...) rather than the path so the dev server +
 * `vite preview` + a static S3 deploy all work without server rewrites — the
 * route lives entirely client-side. The PATH shape still mirrors the curl faces
 * exactly, so a crumb / rail click maps 1:1 to a curl-able resource.
 *
 * NO MOCK: the route is pure UI state. The shell reads the LIVE catalogue and
 * resolves the route's {pack}/{class} against the real data; an unknown
 * pack/class is surfaced honestly by the shell (never a faked view).
 */

/** The parsed route — a discriminated location in the Emporium IA. */
export type Route =
  | { readonly kind: 'catalogue' }
  | { readonly kind: 'pack'; readonly pack: string }
  | { readonly kind: 'class'; readonly pack: string; readonly cls: string }

/** Parse a location hash (e.g. '#/emporium/workflow/AgentNode') into a Route. */
export function parseRoute(hash: string): Route {
  // Strip a leading '#', then normalize to segments after 'emporium'.
  const raw = hash.replace(/^#/, '').replace(/^\/+/, '')
  const segs = raw.split('/').filter((s) => s.length > 0).map(decodeURIComponent)
  // segs[0] is the 'emporium' root (tolerate its absence → catalogue).
  if (segs.length === 0 || segs[0] !== 'emporium') return { kind: 'catalogue' }
  const pack = segs[1]
  const cls = segs[2]
  if (!pack) return { kind: 'catalogue' }
  if (!cls) return { kind: 'pack', pack }
  return { kind: 'class', pack, cls }
}

/** Serialize a Route to its location-hash string (mirrors the curl path grammar). */
export function routeToHash(route: Route): string {
  switch (route.kind) {
    case 'catalogue':
      return '#/emporium'
    case 'pack':
      return `#/emporium/${encodeURIComponent(route.pack)}`
    case 'class':
      return `#/emporium/${encodeURIComponent(route.pack)}/${encodeURIComponent(route.cls)}`
  }
}

/**
 * The minimal window surface the router touches — a hash-bearing location + the
 * hashchange listener. Typed structurally (not the full DOM `Window`) so a test
 * can pass `window`, a fresh happy-dom `Window`, or any compatible host.
 */
export interface RouterWindow {
  readonly location: { hash: string }
  addEventListener(type: 'hashchange', listener: () => void): void
}

/** A live router: current route + navigate + subscribe to hashchange. */
export interface Router {
  current(): Route
  /** Push a new route (updates location.hash → fires the subscriber). */
  navigate(route: Route): void
  /** Subscribe to route changes; returns an unsubscribe fn. Fires immediately. */
  subscribe(cb: (route: Route) => void): () => void
}

/** Build a hash-router bound to a window (defaults to globalThis.window). */
export function createRouter(win: RouterWindow = window): Router {
  const subs = new Set<(r: Route) => void>()
  const emit = (): void => {
    const r = parseRoute(win.location.hash)
    for (const cb of subs) cb(r)
  }
  win.addEventListener('hashchange', emit)
  return {
    current: () => parseRoute(win.location.hash),
    navigate(route) {
      const next = routeToHash(route)
      if (win.location.hash === next) {
        // Same hash ⇒ no hashchange event; notify directly so the view refreshes.
        emit()
      } else {
        win.location.hash = next
      }
    },
    subscribe(cb) {
      subs.add(cb)
      cb(parseRoute(win.location.hash)) // fire current immediately
      return () => subs.delete(cb)
    },
  }
}
