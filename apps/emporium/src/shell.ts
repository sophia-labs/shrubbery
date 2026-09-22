/**
 * shell.ts — the EMPORIUM product shell: the live, designed product the dedicated
 * app boots. It wires together (all REAL, all shell-side):
 *   - the richer GENERAL product bar (@shrubbery/components mn-app-bar): masthead
 *     "Emporium" + a vocab SEARCH/FILTER + a route-derived BREADCRUMB trail +
 *     the theme/skin actions;
 *   - the packs RAIL (rail-view) — the sidebar of live vocab packs (the IA's
 *     primary nav);
 *   - a CONTENT AREA rendering this app's own catalogue / pack-detail views
 *     (./vocab-views.js, moved here in U10 — apps/emporium is its only consumer)
 *     — the catalogue filtered by the search query, a pack drilled into, a class
 *     deep-linked. The pack RELATIONSHIPS section carries a LIST/GRAPH toggle
 *     (mn-relations ↔ the iter-6b layered class GRAPH mn-graph); the shell owns
 *     that toggle state;
 *   - NAV STATE via the hash-router (router.ts), whose grammar mirrors the live
 *     curl URL grammar (/emporium, /emporium/{pack}, /emporium/{pack}/{class}).
 *
 * The live read is SHELL-SIDE (the EmporiumStore, hoisted to @shrubbery/source's
 * './emporium' subpath — U10, design §5) over the same-origin /cell Vite proxy —
 * the bearer/port never reach browser JS.
 * NO MOCK / NO FAKED FALLBACK: a read error is surfaced verbatim in the content
 * area; an unknown pack/class in the route is an honest "not found", never faked.
 *
 * This module is the ONLY place that owns mutable UI state (the route, the search
 * query, the active skin/theme). The views it calls are pure (vocab-views,
 * rail-view) — handed finished data, emitting navigation via callbacks.
 */

import { render as litRender, html, nothing, type TemplateResult } from 'lit'

// The chrome + general primitives (upgrade seam).
import '@shrubbery/components'
import type { MnCrumb } from '@shrubbery/components'

// Skin/theme applier (the sole programmatic stamp of [data-skin]/[data-theme]).
import {
  applySkinTheme,
  nextVisualIdentitySkin,
  type Skin,
  type Theme,
} from '@shrubbery/tokens'

// SHARED shell-side live read (the hoisted @shrubbery/source/emporium
// transport/store convention — U10, design §5) + this app's own pack-detail/
// catalogue views (vocab-views.ts, apps/emporium's only consumer).
import {
  createEmporiumStore,
  type EmporiumStore,
  type EmporiumStoreState,
} from '@shrubbery/source/emporium'
import {
  renderVocabCatalogue,
  renderVocabPack,
  type RelationshipsView,
} from './vocab-views.js'

// EMPORIUM-app-specific views (the packs rail) + the nav state.
import { renderPacksRail } from './rail-view.js'
import { createRouter, type Route, type Router } from './router.js'

/** DOM handles the shell drives (the designed frame lives in index.html). */
export interface ShellElements {
  readonly appBarMount: HTMLElement
  readonly railMount: HTMLElement
  readonly contentMount: HTMLElement
  readonly statusMount: HTMLElement
}

/** Options for booting the shell. */
export interface ShellOptions {
  /** Base URL of the cell's REST routes. Browser default: the /cell Vite proxy. */
  readonly cellBaseUrl?: string
  /** Initial skin (default: emporium — this is the Emporium product). */
  readonly skin?: Skin
  /** Initial theme (default: light). */
  readonly theme?: Theme
  /** Inject a router (tests pass one bound to a controlled window). */
  readonly router?: Router
  /** Inject a store (tests pass one over a Node transport against a real cell). */
  readonly store?: EmporiumStore
  /** Auto-refresh the store on boot (default true; tests may refresh manually). */
  readonly autoRefresh?: boolean
}

/** The booted shell handle (for teardown + manual control in tests). */
export interface EmporiumShell {
  readonly router: Router
  readonly store: EmporiumStore
  /** The current search-filter query (controlled). */
  query(): string
  /** Force a re-render of the whole shell from current state. */
  rerender(): void
  /** Tear down subscriptions. */
  destroy(): void
}

/**
 * Boot the Emporium shell against the given DOM mounts. Returns a handle. The
 * shell subscribes to BOTH the store (live read) and the router (nav state) and
 * re-renders on either change. Defaults to the EMPORIUM skin (the product's
 * identity); a shell consumer may flip it via the bar's skin toggle.
 */
export function bootShell(els: ShellElements, opts: ShellOptions = {}): EmporiumShell {
  let skin: Skin = opts.skin ?? 'emporium'
  let theme: Theme = opts.theme ?? 'light'
  let query = ''
  // The RELATIONSHIPS section's LIST/GRAPH face (the shell owns this UI state; the
  // pack-detail view stays pure). Defaults to the edge LIST; the in-section toggle
  // flips it to the layered class GRAPH (mn-graph).
  let relationshipsView: RelationshipsView = 'list'

  // Apply the product's default identity up front (stamps <html>).
  applySkinTheme({ skin, theme })

  const router = opts.router ?? createRouter()
  const store =
    opts.store ??
    createEmporiumStore({ transport: { baseUrl: opts.cellBaseUrl ?? '/cell' } })

  let route: Route = router.current()
  let state: EmporiumStoreState = store.getState()

  const ok = (msg: string): void => {
    els.statusMount.className = 'status ok'
    els.statusMount.textContent = msg
  }
  const err = (msg: string): void => {
    els.statusMount.className = 'status err'
    els.statusMount.textContent = msg
  }

  // ── Breadcrumb trail derived from the route (Emporium → {pack} → {class}) ────
  function crumbsFor(r: Route): MnCrumb[] {
    const crumbs: MnCrumb[] = [{ label: 'Emporium', id: 'catalogue' }]
    if (r.kind === 'pack' || r.kind === 'class') {
      crumbs.push({ label: r.pack, id: `pack:${r.pack}` })
    }
    if (r.kind === 'class') {
      crumbs.push({ label: r.cls }) // current location: no id ⇒ non-interactive
    }
    return crumbs
  }

  // ── The top bar (mn-app-bar) ─────────────────────────────────────────────────
  function renderAppBar(): void {
    const bar = document.createElement('mn-app-bar')
    bar.brand = 'Emporium'
    bar.badge = state.status === 'ready' ? 'live' : state.status
    bar.glyph = '⬡'
    bar.query = query
    bar.searchPlaceholder = 'Search vocabularies…'
    bar.crumbs = crumbsFor(route)
    bar.isDark = theme === 'dark'
    bar.activeSkin = skin

    bar.addEventListener('mn-navigate-home', () => router.navigate({ kind: 'catalogue' }))
    bar.addEventListener('mn-search', (e) => {
      query = (e as CustomEvent<{ query: string }>).detail.query
      // A search at a deeper route returns to the (filtered) catalogue.
      if (route.kind !== 'catalogue' && query) router.navigate({ kind: 'catalogue' })
      else rerenderAll()
    })
    bar.addEventListener('mn-crumb', (e) => {
      const id = (e as CustomEvent<{ id?: string }>).detail.id
      if (!id) return
      if (id === 'catalogue') router.navigate({ kind: 'catalogue' })
      else if (id.startsWith('pack:')) router.navigate({ kind: 'pack', pack: id.slice(5) })
    })
    bar.addEventListener('mn-theme-toggle', () => {
      theme = theme === 'dark' ? 'light' : 'dark'
      applySkinTheme({ skin, theme })
      rerenderAll()
    })
    bar.addEventListener('mn-skin-toggle', () => {
      skin = nextVisualIdentitySkin(skin)
      applySkinTheme({ skin, theme })
      rerenderAll()
    })

    els.appBarMount.replaceChildren(bar)
  }

  // ── The packs rail (live sidebar) ────────────────────────────────────────────
  function renderRail(): void {
    const read = state.read
    const vocabs = read?.vocabs ?? []
    const activePack =
      route.kind === 'pack' || route.kind === 'class' ? route.pack : undefined
    litRender(
      renderPacksRail(vocabs, {
        activePack,
        classCounts: read?.classCounts,
        onHome: () => router.navigate({ kind: 'catalogue' }),
        onSelect: (name) => router.navigate({ kind: 'pack', pack: name }),
      }),
      els.railMount,
    )
  }

  // ── The content area (catalogue / pack-detail / class-detail) ────────────────
  function renderContent(): void {
    // Capture the route into a const so TS narrowing survives the closures /
    // intervening calls below (the outer `route` is a mutable let).
    const r: Route = route
    if (state.status === 'loading' && !state.read) {
      litRender(
        html`<div class="content-state" data-state="loading">
          <span class="content-state__glyph spin" aria-hidden="true">◌</span>
          <p class="content-state__title">Reading the live registry…</p>
          <p class="content-state__hint">
            Fetching the <code>/emporium</code> vocabulary catalogue from the cell. The pack IS the
            catalog — these rows are read live, never faked.
          </p>
        </div>`,
        els.contentMount,
      )
      ok('reading the live /emporium catalogue…')
      return
    }
    if (state.status === 'error' && !state.read) {
      litRender(renderErrorState(state.error), els.contentMount)
      err(`live /emporium read error (NO fallback):\n${state.error}`)
      return
    }
    const read = state.read
    if (!read) {
      litRender(
        html`<div class="content-state" data-state="idle">
          <span class="content-state__glyph" aria-hidden="true">⬡</span>
          <p class="content-state__title">Idle</p>
          <p class="content-state__hint">No read yet — the catalogue will appear once the cell responds.</p>
        </div>`,
        els.contentMount,
      )
      return
    }

    if (r.kind === 'pack' || r.kind === 'class') {
      const pack = read.packs[r.pack]
      if (!pack) {
        litRender(renderNotFound(`pack "${r.pack}"`), els.contentMount)
        err(`pack "${r.pack}" not in the live catalogue (no faked data).`)
        return
      }
      litRender(
        renderVocabPack(pack, {
          onBack: () => router.navigate({ kind: 'catalogue' }),
          relationshipsView,
          onRelationshipsView: (view) => {
            relationshipsView = view
            rerenderAll()
          },
          onClassSelect: (cls) => router.navigate({ kind: 'class', pack: r.pack, cls }),
        }),
        els.contentMount,
      )
      // Deep-link to a class: scroll its card into view after paint (honest if absent).
      if (r.kind === 'class') {
        const targetCls = r.cls
        const cls = pack.classes.find((c) => c.name === targetCls)
        if (!cls) {
          ok(`pack "${pack.name}" v${pack.version} · class "${targetCls}" not declared (showing the pack).`)
        } else {
          requestAnimationFrame(() => {
            const card = els.contentMount.querySelector(`mn-card[data-class="${CSS.escape(targetCls)}"]`)
            card?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          })
          ok(`pack "${pack.name}" v${pack.version} → class "${targetCls}"`)
        }
      } else {
        ok(`pack "${pack.name}" v${pack.version} · ${pack.classes.length} classes`)
      }
      // wire class-card activation → deep-link route (delegated, set once per render).
      wireClassDeepLinks(pack.name)
      return
    }

    // Catalogue (optionally filtered by the search query).
    const q = query.trim().toLowerCase()
    const shown = q
      ? read.vocabs.filter(
          (v) =>
            v.name.toLowerCase().includes(q) ||
            v.title.toLowerCase().includes(q) ||
            v.namespace.toLowerCase().includes(q),
        )
      : read.vocabs
    // NOTE: a wrapping element is REQUIRED — two adjacent bindings
    // (${maybe-filter}${catalogue}) where the first can be `nothing` do not
    // expand the nested catalogue template under happy-dom's lit. Wrapping both in
    // a parent <div> makes the nested template render reliably (verified).
    litRender(
      html`<div class="catalogue-frame">
        ${q
          ? html`<div class="content-filter">
              Filtered by <strong>${query}</strong> — ${shown.length} of ${read.vocabs.length}
              ${read.vocabs.length === 1 ? 'pack' : 'packs'}.
            </div>`
          : nothing}
        ${renderVocabCatalogue(shown, {
          classCounts: read.classCounts,
          onOpen: (name) => router.navigate({ kind: 'pack', pack: name }),
        })}
      </div>`,
      els.contentMount,
    )
    // The catalogue view is not a pack view ⇒ clear any class deep-link handler.
    els.contentMount.onclick = null
    const when = new Date(read.readAt).toLocaleTimeString()
    ok(`LIVE /emporium read @ ${when} · ${read.vocabs.length} vocabularies`)
  }

  /** Delegate class-card activation in the pack view to a class deep-link route. */
  function wireClassDeepLinks(pack: string): void {
    // The pack-detail view's class cards are non-interactive by default; we add a
    // capture listener on the content mount that maps a card click to a route.
    els.contentMount.onclick = (e) => {
      const target = e.target as HTMLElement
      const card = target.closest('mn-card.vocab-class') as HTMLElement | null
      if (!card) return
      const cls = card.getAttribute('data-class')
      if (cls) router.navigate({ kind: 'class', pack, cls })
    }
  }

  function renderErrorState(message: string | null): TemplateResult {
    return html`
      <div class="content-state content-state--error" data-state="error">
        <span class="content-state__glyph" aria-hidden="true">⚠</span>
        <p class="content-state__title">Live /emporium read failed.</p>
        <pre class="content-state__detail">${message ?? '(unknown error)'}</pre>
        <p class="content-state__hint">
          Is a current cell running? Start one with <code>pnpm gardend:dev</code>. The release
          build serves /emporium; the debug build is stale. The shell shows the REAL error — no
          faked catalogue.
        </p>
      </div>
    `
  }

  function renderNotFound(what: string): TemplateResult {
    return html`
      <div class="content-state content-state--error" data-state="not-found">
        <span class="content-state__glyph" aria-hidden="true">⌀</span>
        <p class="content-state__title">${what} is not in the live catalogue.</p>
        <p class="content-state__hint">No faked data — pick a pack from the rail.</p>
      </div>
    `
  }

  // ── Compose: re-render the whole shell from current state ─────────────────────
  function rerenderAll(): void {
    renderAppBar()
    renderRail()
    renderContent()
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────────
  const unsubStore = store.subscribe((s) => {
    state = s
    rerenderAll()
  })
  const unsubRoute = router.subscribe((r) => {
    route = r
    // Leaving the catalogue clears the search filter implicitly? No — keep the
    // query so back-to-catalogue restores the filtered view (a designed product
    // remembers the filter). But clear when navigating into a pack via the rail.
    rerenderAll()
  })

  if (opts.autoRefresh ?? true) void store.refresh()

  return {
    router,
    store,
    query: () => query,
    rerender: rerenderAll,
    destroy() {
      unsubStore()
      unsubRoute()
      els.contentMount.onclick = null
    },
  }
}
