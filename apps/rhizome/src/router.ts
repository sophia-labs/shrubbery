/**
 * router.ts — a tiny hash-router whose grammar MIRRORS the live curl URL grammar
 * the conneg server already serves (server.ts): /plot, /plot/{rootId}, plus the
 * sibling Walk family /walk, /walk/{runId}. The cross-surface lens (?asof) and
 * the Walk's turn cursor (?turn) ride as query params, exactly as the curl faces
 * carry them. SHELL-side, backend-free, no dependency on lit or the data layer —
 * it only parses/serializes the location hash + notifies subscribers.
 *
 * We use the HASH (#/plot/...) rather than the path so the dev server +
 * `vite preview` + a static deploy all work without server rewrites — the route
 * lives entirely client-side. The PATH shape still mirrors the curl faces
 * exactly, so a rail click maps 1:1 to a curl-able resource (HATEOAS parity).
 *
 * NO MOCK: the route is pure UI state. The shell reads the LIVE memory world and
 * resolves the route's {rootId}/{runId} against the real data; an unknown subject
 * or run is surfaced honestly by the shell (never a faked view).
 */

/** The four live surfaces (Plot, Bouquet, Walk, Greenhouse). Ledger is 'soon'. */
export type Surface = 'plot' | 'bouquet' | 'walk' | 'greenhouse'

/** The parsed route — a discriminated location in the Rhizome IA. */
export type Route =
  /** THE PLOT grid (optionally as-of a date). */
  | { readonly kind: 'plot'; readonly asof: string | null }
  /** ONE subject-bed (the structural lineage drill-down), optionally as-of a date. */
  | { readonly kind: 'plot-subject'; readonly rootId: string; readonly asof: string | null }
  /** THE BOUQUET index (the readable beliefs), optionally as-of a date. */
  | { readonly kind: 'bouquet'; readonly asof: string | null }
  /** ONE belief's constellation (the bloom), optionally as-of a date. */
  | { readonly kind: 'bouquet-subject'; readonly rootId: string; readonly asof: string | null }
  /** THE WALK index (the agentic-run traces), optionally as-of a date. */
  | { readonly kind: 'walk'; readonly asof: string | null }
  /** ONE run's walk, optionally positioned at a turn cursor + as-of a date. */
  | {
      readonly kind: 'walk-run'
      readonly runId: string
      readonly turn: number | null
      readonly asof: string | null
    }
  /** THE GREENHOUSE (the cultivation knobs), optionally as-of a date. */
  | { readonly kind: 'greenhouse'; readonly asof: string | null }
  /** ONE knob (/tune/{knob}), optionally as-of a date (the knob-history lens). */
  | { readonly kind: 'tune-knob'; readonly knobId: string; readonly asof: string | null }

/** Map a parsed Route to the surface it lives on (drives the rail highlight). */
export function surfaceOf(route: Route): Surface {
  if (route.kind === 'walk' || route.kind === 'walk-run') return 'walk'
  if (route.kind === 'bouquet' || route.kind === 'bouquet-subject') return 'bouquet'
  if (route.kind === 'greenhouse' || route.kind === 'tune-knob') return 'greenhouse'
  return 'plot'
}

/** Split a hash into its path segments + a query map (both decoded). */
function splitHash(hash: string): { segs: string[]; query: URLSearchParams } {
  const raw = hash.replace(/^#/, '')
  const qIdx = raw.indexOf('?')
  const pathPart = qIdx >= 0 ? raw.slice(0, qIdx) : raw
  const queryPart = qIdx >= 0 ? raw.slice(qIdx + 1) : ''
  const segs = pathPart
    .replace(/^\/+/, '')
    .split('/')
    .filter((s) => s.length > 0)
    .map(decodeURIComponent)
  return { segs, query: new URLSearchParams(queryPart) }
}

/** Parse a location hash (e.g. '#/plot/abc?asof=2023-05-25') into a Route. */
export function parseRoute(hash: string): Route {
  const { segs, query } = splitHash(hash)
  const asof = query.get('asof') || null
  const root = segs[0]

  if (root === 'walk') {
    const runId = segs[1]
    if (!runId) return { kind: 'walk', asof }
    const turnRaw = query.get('turn')
    const turn = turnRaw !== null && turnRaw !== '' && Number.isFinite(Number(turnRaw)) ? Number(turnRaw) : null
    return { kind: 'walk-run', runId, turn, asof }
  }

  if (root === 'bouquet') {
    const rootId = segs[1]
    return rootId ? { kind: 'bouquet-subject', rootId, asof } : { kind: 'bouquet', asof }
  }

  // THE GREENHOUSE — the hash grammar MIRRORS the curl faces (/tune, /tune/{knob}).
  if (root === 'tune' || root === 'greenhouse') {
    const knobId = segs[1]
    return knobId ? { kind: 'tune-knob', knobId, asof } : { kind: 'greenhouse', asof }
  }

  // Default + 'plot' both resolve to the Plot family (tolerate a bare '#').
  const rootId = segs[0] === 'plot' ? segs[1] : undefined
  if (rootId) return { kind: 'plot-subject', rootId, asof }
  return { kind: 'plot', asof }
}

/** Serialize a Route to its location-hash string (mirrors the curl path grammar). */
export function routeToHash(route: Route): string {
  const qs = (params: Record<string, string | null>): string => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== '') sp.set(k, v)
    }
    const s = sp.toString()
    return s ? `?${s}` : ''
  }
  switch (route.kind) {
    case 'plot':
      return `#/plot${qs({ asof: route.asof })}`
    case 'plot-subject':
      return `#/plot/${encodeURIComponent(route.rootId)}${qs({ asof: route.asof })}`
    case 'bouquet':
      return `#/bouquet${qs({ asof: route.asof })}`
    case 'bouquet-subject':
      return `#/bouquet/${encodeURIComponent(route.rootId)}${qs({ asof: route.asof })}`
    case 'walk':
      return `#/walk${qs({ asof: route.asof })}`
    case 'walk-run':
      return `#/walk/${encodeURIComponent(route.runId)}${qs({
        turn: route.turn === null ? null : String(route.turn),
        asof: route.asof,
      })}`
    case 'greenhouse':
      return `#/tune${qs({ asof: route.asof })}`
    case 'tune-knob':
      return `#/tune/${encodeURIComponent(route.knobId)}${qs({ asof: route.asof })}`
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
