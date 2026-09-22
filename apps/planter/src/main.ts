/**
 * main.ts — the PLANTER SPA (design §3.3): the generic browser host.
 *
 * Boot resolution priority (dev ergonomics → CDN deployment → build-time
 * default), the FIRST source that resolves wins WHOLE (never a partial merge
 * across tiers — a half-specified tier is a real config error, not a
 * fall-through):
 *
 *   1. URL query params    — ?endpoint=&graph=&adapter=&authMode=&token=…
 *   2. /planter.config.json — same-origin fetch (the CDN deployment carries a
 *                             config next to the bundle; `public/planter.config.json`
 *                             is the local-dev default: gardend-local over the
 *                             vite dev proxy's same-origin '/cell' mount).
 *   3. VITE_PLANTER_* build-time env vars — Vite only exposes `import.meta.env`
 *      entries under the `VITE_` prefix to client code; this is the honest
 *      browser-side reading of the design's "env vars … for the server" line,
 *      which the (Node) `apps/planter/src/server.ts` entry point reads via
 *      `process.env.PLANTER_*` directly (its own minimal boot, not this one).
 *
 * Both runnables (server.ts, this SPA) share `sourceFromBoot` (`@shrubbery/source`)
 * — the ONE adapter factory. `server.ts` classifies each discrete HTTP
 * request through `./read-status.ts`'s `classifyRead` directly (it has no
 * persistent connection to keep alive between requests); this SPA instead
 * binds ONE long-lived `SourceConfigStore` (`createConfigStore`,
 * `@shrubbery/source`) over its one `TripleSource` — design §3.3's
 * `sourceFromBoot → createConfigStore → startPoll` — and reconstructs the
 * SAME `read-status.ts` taxonomy (`toReadStatus` below) from the store's
 * `SourceState` snapshots, so the empty/error/malformed conditions stay
 * byte-identical between the two host shapes even though the store folds
 * them into a leaner `{status, errorKind}` envelope internally.
 *
 * Flow once a `TripleSource` is bound: `createConfigStore` → `store.refresh()`
 * (the first read) → `store.startPoll()` (a no-op on a 'static' source; a
 * documented throw if a non-static adapter has no resolvable interval — see
 * `apps/planter/public/planter.config.json`'s `pollMs`) → on every settled
 * state: `toReadStatus` → on 'ok': `renderWorkspace` (`@shrubbery/runtime`,
 * imported AS-IS — zero edits to NO-TOUCH runtime files; `renderWorkspace`
 * itself runs nucleus `planFor` internally) → on 'empty'/'malformed'/failed
 * kinds: an honest panel, `data-kind="state"` stamped (§4's `applyKind`). A
 * persistent status strip (`./status-strip.ts`) shows the capture-age chip on
 * every settled read — the first end-to-end consumer of kind.css.
 *
 * NO FALLBACK CONFIG ANYWHERE: every branch renders either a real
 * `WorkspaceConfig` or the verbatim upstream/parse error.
 */

import '@shrubbery/tokens/tokens.css'
import {
  selectRightPanel,
  type RightPanelMode,
  type TripleSource,
  TripleSourceError,
  triplesOf,
} from '@shrubbery/nucleus'
import { type RenderWorkspaceOptions, renderWorkspace, type WorkspacePanelRepositionDetail } from '@shrubbery/runtime'
import {
  featureFor,
  routeFor,
  type SiteBundle,
  type SiteRoute,
  siteBundleFor,
} from '@shrubbery/site'
import {
  BootConfigError,
  bootGraphIri,
  createConfigStore,
  type PlanterBootConfig,
  type SourceErrorKind,
  type SourceState,
  sourceFromBoot,
} from '@shrubbery/source'
import {
  applyEditorMaterial,
  applyKind,
  applySkinTheme,
  type EditorMaterial,
  type Theme,
  type VisualIdentitySkin,
} from '@shrubbery/tokens'
import {
  authFromParts,
  parseAdapterField,
  parseBundleField,
  parseOwnerField,
  parseReadPathField,
} from './boot-fields.js'
import type {
  EmptyStatus,
  FailedKind,
  FailedStatus,
  MalformedStatus,
  OkStatus,
  ReadStatus,
} from './read-status.js'
import { createStatusStrip } from './status-strip.js'
import { type Testimony, testimonyFor } from './testimony.js'

// ── Boot resolution ──────────────────────────────────────────────────────────

export interface ResolveBootConfigOptions {
  /** `window.location.search`, injectable for tests. */
  readonly search?: string
  /** Defaults to `fetch('/planter.config.json')`; injectable for tests. */
  readonly fetchConfig?: () => Promise<Response>
  /** Defaults to `import.meta.env`; injectable for tests. */
  readonly env?: Readonly<Record<string, string | undefined>>
}

/**
 * Tier 1 — URL query params. Absence of BOTH `endpoint` and `graph` is
 * "this tier has nothing to say" (→ null, try the next tier); presence of
 * ONLY one is a real typo the user made (→ throw, naming the missing one) —
 * never a silent fall-through past a half-specified override.
 */
export function bootConfigFromParams(search: string): PlanterBootConfig | null {
  const params = new URLSearchParams(search)
  const endpoint = params.get('endpoint')
  const graph = params.get('graph')
  if (endpoint === null && graph === null) return null
  if (endpoint === null || graph === null) {
    throw new BootConfigError(
      "URL boot params: 'endpoint' and 'graph' must both be present (only one was given)",
    )
  }
  const auth = authFromParts(
    params.get('authMode'),
    params.get('token'),
    params.get('region'),
    params.get('clientId'),
    params.get('userPoolId'),
    'URL boot params',
  )
  const adapter = parseAdapterField(params.get('adapter'), 'URL boot params')
  const pollMsRaw = params.get('pollMs')
  const configGraphIri = params.get('configGraphIri')
  const readPath = parseReadPathField(params.get('readPath'), 'URL boot params')
  const bundle = parseBundleField(params.get('bundle'), 'URL boot params')
  const owner = parseOwnerField(params.get('owner'), 'URL boot params')
  return {
    endpoint,
    graph,
    ...(owner !== undefined ? { owner } : {}),
    auth,
    ...(adapter !== undefined ? { adapter } : {}),
    ...(pollMsRaw ? { pollMs: Number(pollMsRaw) } : {}),
    ...(configGraphIri ? { configGraphIri } : {}),
    ...(readPath !== undefined ? { readPath } : {}),
    ...(bundle !== undefined ? { bundle } : {}),
  }
}

/** Tier 2 — `/planter.config.json`'s parsed JSON body. Malformed shape is a
 *  real config error (thrown), never silently skipped to tier 3 — only a
 *  network-level absence (404 / fetch failure) falls through (see
 *  `resolveBootConfig`). */
export function bootConfigFromJson(raw: unknown): PlanterBootConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BootConfigError('planter.config.json: not a JSON object')
  }
  const obj = raw as Record<string, unknown>
  const endpoint = obj.endpoint
  const graph = obj.graph
  if (typeof endpoint !== 'string' || typeof graph !== 'string') {
    throw new BootConfigError("planter.config.json: 'endpoint' and 'graph' are required string fields")
  }
  // HIGH-1: `auth` must be an object when present — a malformed value (a
  // string, a number, an array) must NEVER silently coerce to `mode: 'none'`
  // (an AUTHENTICATION DOWNGRADE); refuse, naming the field and the
  // offending value verbatim.
  if (obj.auth !== undefined && (obj.auth === null || typeof obj.auth !== 'object' || Array.isArray(obj.auth))) {
    throw new BootConfigError(
      `planter.config.json: 'auth' must be an object (got ${JSON.stringify(obj.auth)}) — ` +
        'a malformed auth value is never inferred as \'none\' (that would be an authentication downgrade)',
    )
  }
  const authRaw = (obj.auth ?? { mode: 'none' }) as Record<string, unknown>
  if (authRaw.mode !== undefined && typeof authRaw.mode !== 'string') {
    throw new BootConfigError(
      `planter.config.json: 'auth.mode' must be a string (got ${JSON.stringify(authRaw.mode)})`,
    )
  }
  const auth = authFromParts(
    typeof authRaw.mode === 'string' ? authRaw.mode : null,
    typeof authRaw.token === 'string' ? authRaw.token : null,
    typeof authRaw.region === 'string' ? authRaw.region : null,
    typeof authRaw.clientId === 'string' ? authRaw.clientId : null,
    typeof authRaw.userPoolId === 'string' ? authRaw.userPoolId : null,
    'planter.config.json',
  )
  const adapter = parseAdapterField(obj.adapter, 'planter.config.json')
  const readPath = parseReadPathField(obj.readPath, 'planter.config.json')
  const bundle = parseBundleField(obj.bundle, 'planter.config.json')
  const owner = parseOwnerField(obj.owner, 'planter.config.json')
  return {
    endpoint,
    graph,
    ...(owner !== undefined ? { owner } : {}),
    auth,
    ...(adapter !== undefined ? { adapter } : {}),
    ...(typeof obj.pollMs === 'number' ? { pollMs: obj.pollMs } : {}),
    ...(typeof obj.configGraphIri === 'string' ? { configGraphIri: obj.configGraphIri } : {}),
    ...(readPath !== undefined ? { readPath } : {}),
    ...(bundle !== undefined ? { bundle } : {}),
  }
}

/** Tier 3 — build-time `VITE_PLANTER_*` env vars. Same absent-both/only-one
 *  discipline as tier 1. */
export function bootConfigFromEnv(env: Readonly<Record<string, string | undefined>>): PlanterBootConfig | null {
  const endpoint = env.VITE_PLANTER_ENDPOINT
  const graph = env.VITE_PLANTER_GRAPH
  if (!endpoint && !graph) return null
  if (!endpoint || !graph) {
    throw new BootConfigError(
      "env boot vars: VITE_PLANTER_ENDPOINT and VITE_PLANTER_GRAPH must both be present (only one was given)",
    )
  }
  const auth = authFromParts(
    env.VITE_PLANTER_AUTH_MODE ?? null,
    env.VITE_PLANTER_AUTH_TOKEN ?? null,
    env.VITE_PLANTER_AUTH_REGION ?? null,
    env.VITE_PLANTER_AUTH_CLIENT_ID ?? null,
    env.VITE_PLANTER_AUTH_USER_POOL_ID ?? null,
    'env boot vars',
  )
  const adapter = parseAdapterField(env.VITE_PLANTER_ADAPTER, 'env boot vars')
  const readPath = parseReadPathField(env.VITE_PLANTER_READ_PATH, 'env boot vars')
  const bundle = parseBundleField(env.VITE_PLANTER_BUNDLE, 'env boot vars')
  const owner = parseOwnerField(env.VITE_PLANTER_OWNER, 'env boot vars')
  const pollMsRaw = env.VITE_PLANTER_POLL_MS
  return {
    endpoint,
    graph,
    ...(owner !== undefined ? { owner } : {}),
    auth,
    ...(adapter !== undefined ? { adapter } : {}),
    ...(pollMsRaw ? { pollMs: Number(pollMsRaw) } : {}),
    ...(env.VITE_PLANTER_CONFIG_GRAPH_IRI ? { configGraphIri: env.VITE_PLANTER_CONFIG_GRAPH_IRI } : {}),
    ...(readPath !== undefined ? { readPath } : {}),
    ...(bundle !== undefined ? { bundle } : {}),
  }
}

/** Resolve the boot config through all three tiers. Throws `BootConfigError`
 *  naming what is missing when NONE resolve — no fallback config anywhere. */
export async function resolveBootConfig(opts: ResolveBootConfigOptions = {}): Promise<PlanterBootConfig> {
  const search = opts.search ?? (typeof window !== 'undefined' ? window.location.search : '')
  const fromParams = bootConfigFromParams(search)
  if (fromParams) return fromParams

  const fetchConfig = opts.fetchConfig ?? (() => fetch('/planter.config.json'))
  let res: Response | undefined
  try {
    res = await fetchConfig()
  } catch {
    res = undefined // network-level absence — try the next tier.
  }
  if (res && res.ok) {
    const json: unknown = await res.json()
    return bootConfigFromJson(json)
  }

  const env = opts.env ?? (import.meta.env as unknown as Record<string, string | undefined>)
  const fromEnv = bootConfigFromEnv(env)
  if (fromEnv) return fromEnv

  throw new BootConfigError(
    'resolveBootConfig: no boot config resolvable — supply ?endpoint=&graph= URL params, ' +
      'a same-origin planter.config.json, or VITE_PLANTER_ENDPOINT/VITE_PLANTER_GRAPH env vars.',
  )
}

// ── Panels (empty / malformed / failed) — kind-stamped, verbatim testimony ──

function panel(kind: 'state', className: string): HTMLElement {
  const el = document.createElement('div')
  el.className = `planter-panel ${className}`
  applyKind({ kind, target: el })
  return el
}

/** The EMPTY panel: names the graph and the exact, runnable seed command —
 *  never a fabricated GARDEN_DEFAULT stand-in config (design §3.1's table). */
function renderEmptyPanel(host: HTMLElement, status: EmptyStatus, graphId: string): void {
  const el = panel('state', 'planter-panel-empty')
  const h = document.createElement('h2')
  h.textContent = 'Workspace — empty'
  const p = document.createElement('p')
  p.textContent = `No triples in <${status.read.graphIri}> yet.`
  const hint = document.createElement('p')
  hint.textContent = '0 triples — seed with:'
  const cmd = document.createElement('pre')
  cmd.className = 'planter-seed-command'
  cmd.textContent = `pnpm --dir apps/planter seed -- --graph ${graphId} --profile-dir <dir>`
  el.append(h, p, hint, cmd)
  host.replaceChildren(el)
}

function renderMalformedPanel(host: HTMLElement, status: MalformedStatus, graphIri: string): void {
  const el = panel('state', 'planter-panel-malformed')
  const h = document.createElement('h2')
  h.textContent = 'Error — malformed config'
  const p = document.createElement('p')
  p.textContent = `${status.triples.length} triples read from <${graphIri}>, but they do not parse as a workspace config:`
  const pre = document.createElement('pre')
  pre.textContent = status.error.message
  el.append(h, p, pre)
  host.replaceChildren(el)
}

/** unauthorized / forbidden / not-found / unavailable — verbatim upstream
 *  message + which auth arm, plus a retry affordance for 'unavailable'. */
function renderFailedPanel(host: HTMLElement, status: FailedStatus, config: PlanterBootConfig, refresh: () => void): void {
  const el = panel('state', `planter-panel-error planter-panel-${status.kind}`)
  el.dataset.errorKind = status.kind
  const h = document.createElement('h2')
  h.textContent = `Error — ${status.kind}`
  const p = document.createElement('p')
  p.textContent = status.error.message
  el.append(h, p)
  if (status.error.detail) {
    const pre = document.createElement('pre')
    pre.textContent = status.error.detail
    el.append(pre)
  }
  const authLine = document.createElement('p')
  authLine.className = 'planter-auth-note'
  authLine.textContent = `auth mode: ${config.auth.mode}`
  el.append(authLine)
  if (status.kind === 'unavailable') {
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.className = 'planter-retry'
    retry.textContent = 'Retry'
    retry.addEventListener('click', refresh)
    el.append(retry)
  }
  host.replaceChildren(el)
}

// ── Mount ────────────────────────────────────────────────────────────────────

export interface PlanterMount {
  readonly source: TripleSource
  /** One read → one re-render (also what the poll loop calls). */
  refresh(): Promise<void>
  /** Stop polling and release the bound source. Idempotent. */
  stop(): void
  /** The last classified read (for tests/inspection). */
  status(): ReadStatus | null
  /** Active declarative product bundle state; null for the unbundled generic host. */
  bundleState(): SiteBundleState | null
}

export interface SiteBundleState {
  readonly bundle: SiteBundle
  readonly route: SiteRoute
  readonly skin: VisualIdentitySkin
  readonly theme: Theme
  readonly editorMaterial: EditorMaterial
  readonly leftWidth: number
  readonly rightWidth: number
  readonly leftCollapsed: boolean
  readonly leftExpanded: boolean
  readonly rightCollapsed: boolean
  readonly rightPanel: RightPanelMode
}

export function initialSiteBundleState(bundle: SiteBundle, pathname: string): SiteBundleState {
  return {
    bundle,
    route: routeFor(bundle, pathname),
    skin: bundle.appearance.defaultSkin,
    theme: bundle.appearance.defaultTheme,
    editorMaterial: bundle.appearance.defaultEditorMaterial,
    leftWidth: bundle.panels.left.default,
    rightWidth: bundle.panels.right.default,
    leftCollapsed: false,
    leftExpanded: false,
    rightCollapsed: false,
    rightPanel: 'chat',
  }
}

function nextValue<T>(values: readonly T[], current: T): T {
  if (values.length === 0) throw new Error('site bundle declares an empty appearance axis')
  const index = values.indexOf(current)
  return values[(index < 0 ? 0 : index + 1) % values.length]
}

function applyBundleAppearance(state: SiteBundleState): void {
  applySkinTheme({ skin: state.skin, theme: state.theme })
  applyEditorMaterial({ material: state.editorMaterial })
}

/** Fold a `SourceConfigStore`'s `errorKind` into the shared `FailedKind`
 *  taxonomy (design §3.1). 'protocol' (the store answered, but not in the
 *  contracted shape) folds into 'unavailable' — the exact same fold
 *  `read-status.ts`'s `classifyErrorCode` applies for the server path. A
 *  `null` errorKind is the store's documented cover for the (contract-
 *  violating) case of a non-`TripleSourceError` thrown by an adapter — there
 *  is no real code to report, so it folds the same way rather than inventing
 *  a sixth bucket the design never asked for. */
function failedKindFor(errorKind: SourceErrorKind | null): FailedKind {
  switch (errorKind) {
    case 'unauthorized':
      return 'unauthorized'
    case 'forbidden':
      return 'forbidden'
    case 'not-found':
      return 'not-found'
    case 'unavailable':
    case 'protocol':
    case 'parse':
    case null:
      return 'unavailable'
  }
}

/**
 * Reconstruct the shared `read-status.ts` `ReadStatus` shape from one
 * `SourceConfigStore` snapshot. `createConfigStore` (packages/source, outside
 * this unit's file list) folds the same conditions into a leaner
 * `{status, errorKind}` envelope; this never re-reads or re-fetches anything
 * — `triplesOf` is a pure re-derivation over the SAME retained `TripleRead`
 * the store already produced. Returns `null` for 'idle'/'loading' (no
 * settled read yet — the caller keeps showing the previous settled status). */
function toReadStatus(state: SourceState): ReadStatus | null {
  if (state.status === 'ready' && state.read && state.config) {
    const ok: OkStatus = { kind: 'ok', read: state.read, triples: triplesOf(state.read), config: state.config }
    return ok
  }
  if (state.status === 'empty' && state.read) {
    const empty: EmptyStatus = { kind: 'empty', read: state.read }
    return empty
  }
  if (state.status === 'error') {
    if (state.errorKind === 'parse' && state.read) {
      const malformed: MalformedStatus = {
        kind: 'malformed',
        read: state.read,
        triples: triplesOf(state.read),
        error: new Error(state.error ?? 'malformed config'),
      }
      return malformed
    }
    const kind = failedKindFor(state.errorKind)
    const failed: FailedStatus = {
      kind,
      error: new TripleSourceError(kind, state.error ?? 'unknown error'),
    }
    return failed
  }
  return null
}

/**
 * MED-1: resolve the strip's poll-interval confession — pure and exported so
 * it is directly unit-testable independent of a live `TripleSource`. The
 * boot `pollMs` / adapter `suggestedPollMs` are both fixed for a source's
 * lifetime. `'poll' liveness with NO resolvable interval` (a third-party
 * adapter that declares 'poll' but supplies no `suggestedPollMs`, paired
 * with a boot config naming no `pollMs`) resolves `'none'` — the confession
 * the design requires rather than silently behaving like a single read.
 * `'static'` (and the reserved `'push'`) carry no poll concept at all, so
 * the option is `undefined` (omitted from the strip entirely).
 */
export function resolvePollOption(
  description: Pick<TripleSource['description'], 'liveness' | 'suggestedPollMs'>,
  config: Pick<PlanterBootConfig, 'pollMs'>,
): number | 'none' | undefined {
  if (description.liveness !== 'poll') return undefined
  const interval = config.pollMs ?? description.suggestedPollMs
  return interval ?? 'none'
}

/**
 * Mount the SPA into `container`: build the source, bind a `SourceConfigStore`
 * over it, do the first read, start the poll loop (a documented no-op on a
 * 'static' source), and render on every settled read. Returns handles for the
 * caller (auto-boot below, or a test) to drive `refresh()` directly (e.g.
 * after killing the cell) and `stop()` on teardown.
 */
export async function mountPlanter(container: HTMLElement, config: PlanterBootConfig): Promise<PlanterMount> {
  const bundle = config.bundle ? siteBundleFor(config.bundle) : null
  if (bundle) {
    // npm installation is the code-vetting gate. The bundle selects tags by
    // data; the host loads the one installed component-library package, never
    // graph-sourced JavaScript or a parallel app shell.
    await import('@shrubbery/components')
  }
  const source = await sourceFromBoot(config)
  const graphIri = bootGraphIri(config)
  const description = source.description

  let bundleState = bundle
    ? initialSiteBundleState(bundle, typeof window !== 'undefined' ? window.location.pathname : '/')
    : null
  if (bundleState) applyBundleAppearance(bundleState)

  container.replaceChildren()
  if (bundle) container.dataset.siteBundle = bundle.id
  else delete container.dataset.siteBundle
  const strip = createStatusStrip()
  const notice = document.createElement('div')
  notice.className = 'planter-bundle-notice'
  notice.hidden = true
  notice.setAttribute('role', 'status')
  const body = document.createElement('div')
  body.className = 'planter-body'
  container.append(strip.element, notice, body)

  const store = createConfigStore(source, graphIri, { pollMs: config.pollMs })

  const interval = config.pollMs ?? description.suggestedPollMs
  const pollOption = resolvePollOption(description, config)

  let lastGood: Testimony | undefined
  let current: ReadStatus | null = null

  const showFeatureNotice = (featureId: string): void => {
    if (!bundleState) return
    const feature = featureFor(bundleState.bundle, featureId)
    notice.hidden = false
    notice.dataset.feature = featureId
    notice.textContent = feature
      ? `${feature.state.toUpperCase()}: ${feature.note}${feature.laterContract ? ` Later contract: ${feature.laterContract}.` : ''}`
      : `No '${featureId}' capability is declared by ${bundleState.bundle.title}.`
  }

  const updateBundle = (patch: Partial<Omit<SiteBundleState, 'bundle'>>): void => {
    if (!bundleState) return
    bundleState = { ...bundleState, ...patch }
    applyBundleAppearance(bundleState)
    renderCurrent()
  }

  const navigateBundle = (pathname: string, push = true): void => {
    if (!bundleState) return
    const route = routeFor(bundleState.bundle, pathname)
    bundleState = { ...bundleState, route }
    container.dataset.siteRoute = route.id
    if (push && typeof window !== 'undefined' && window.location.pathname !== route.path) {
      window.history.pushState({}, '', `${route.path}${window.location.search}`)
    }
    renderCurrent()
  }

  const bundleRenderOptions = (status: OkStatus): RenderWorkspaceOptions => {
    if (!bundleState) return {}
    const state = bundleState
    const onReposition = (detail: WorkspacePanelRepositionDetail): void => {
      updateBundle(detail.role === 'left' ? { leftWidth: detail.width } : { rightWidth: detail.width })
    }
    return {
      app: state.route.app,
      leftCollapsed: state.leftCollapsed,
      rightCollapsed: state.rightCollapsed,
      panelLayout: {
        leftWidth: state.leftWidth,
        rightWidth: state.rightWidth,
        leftExpanded: state.leftExpanded,
        leftSnap: state.bundle.panels.left.snap,
        rightSnap: state.bundle.panels.right.snap,
        snapThreshold: state.bundle.panels.snapThreshold,
        onReposition,
        onLeftExpandedChange: (expanded) => updateBundle({
          leftExpanded: expanded,
          leftCollapsed: false,
          ...(expanded ? { rightCollapsed: true } : {}),
        }),
        onLeftCollapsedChange: (collapsed) => updateBundle({ leftCollapsed: collapsed, leftExpanded: false }),
        onRightCollapsedChange: (collapsed) => updateBundle({ rightCollapsed: collapsed, ...(collapsed ? {} : { leftExpanded: false }) }),
      },
      chrome: {
        activeApp: state.route.app,
        activeSkin: state.skin,
        isDark: state.theme === 'dark',
        rightPanel: state.rightPanel,
        runtimeMode: description.kind === 'hosted-gateway' ? 'hosted' : 'local',
        breadcrumbs: [
          { id: config.graph, label: status.config.label, kind: 'graph' },
          { id: state.route.id, label: state.route.label, kind: 'view', current: true },
        ],
      },
      home: state.route.view === 'home'
        ? {
            status: 'ready',
            graphId: config.graph,
            graphTitle: status.config.label,
            pinned: [],
            newlyCreated: [],
            recent: [],
          }
        : null,
    }
  }

  function renderCurrent(): void {
    const status = current
    if (!status) return
    if (bundleState) container.dataset.siteRoute = bundleState.route.id
    if (status.kind === 'ok') {
      renderWorkspace(status.config, { container: body, ...bundleRenderOptions(status) })
    } else if (status.kind === 'empty') {
      renderEmptyPanel(body, status, config.graph)
    } else if (status.kind === 'malformed') {
      renderMalformedPanel(body, status, graphIri)
    } else {
      renderFailedPanel(body, status, config, () => void store.refresh())
    }
  }

  const onBundleEvent = (event: Event): void => {
    if (!bundleState) return
    switch (event.type) {
      case 'mn-skin-toggle':
        updateBundle({ skin: nextValue(bundleState.bundle.appearance.skins, bundleState.skin) })
        break
      case 'mn-theme-toggle':
        updateBundle({ theme: nextValue(bundleState.bundle.appearance.themes, bundleState.theme) })
        break
      case 'mn-navigate-home': {
        const home = bundleState.bundle.routes.find((route) => route.view === 'home')
        if (home) navigateBundle(home.path)
        break
      }
      case 'mn-settings-toggle':
        showFeatureNotice('settings')
        break
      case 'mn-panel-toggle': {
        const panel = (event as CustomEvent<{ panel?: string }>).detail?.panel
        const allowed = ['chat', 'comments', 'wires', 'inspector', 'graph'] as const
        if (!allowed.includes(panel as (typeof allowed)[number])) break
        const typed = panel as (typeof allowed)[number]
        const rightPanel = selectRightPanel(bundleState.rightPanel, typed)
        updateBundle({ rightPanel, rightCollapsed: rightPanel === 'none' })
        break
      }
    }
  }

  const bundleEvents = ['mn-skin-toggle', 'mn-theme-toggle', 'mn-navigate-home', 'mn-settings-toggle', 'mn-panel-toggle']
  if (bundleState) {
    for (const type of bundleEvents) container.addEventListener(type, onBundleEvent)
  }
  const onPopState = (): void => {
    if (bundleState && typeof window !== 'undefined') navigateBundle(window.location.pathname, false)
  }
  if (bundleState && typeof window !== 'undefined') window.addEventListener('popstate', onPopState)

  store.subscribe((state) => {
    if (state.status === 'idle' || state.status === 'loading') return
    const status = toReadStatus(state)
    if (status === null) return
    current = status

    if ((state.status === 'ready' || state.status === 'empty') && state.read) {
      lastGood = testimonyFor(state.read, description)
    }
    // MED-2: the FailedStatus kinds (unauthorized/forbidden/not-found/
    // unavailable) carry NO TripleRead of their own — `lastGood` here is a
    // RETAINED prior read, never the current state, so it is labeled STALE.
    // 'ok'/'empty'/'malformed' all carry (or ARE) the current read.
    const stale = status.kind !== 'ok' && status.kind !== 'empty' && status.kind !== 'malformed'
    strip.update(lastGood, { stale, ...(pollOption !== undefined ? { pollMs: pollOption } : {}) })

    renderCurrent()
  })

  await store.refresh()
  if (description.liveness === 'poll' && interval !== undefined) {
    store.startPoll(interval)
  }

  const stop = (): void => {
    for (const type of bundleEvents) container.removeEventListener(type, onBundleEvent)
    if (typeof window !== 'undefined') window.removeEventListener('popstate', onPopState)
    store.stopPoll()
    void source.close()
  }

  return {
    source,
    refresh: () => store.refresh(),
    stop,
    status: () => current,
    bundleState: () => bundleState,
  }
}

// ── Auto-boot (the Vite entry point) ────────────────────────────────────────
//
// Guarded on the real `#app` mount existing — a happy-dom test importing this
// module for its exported functions (no `#app` in its synthetic document)
// triggers no side effect beyond this no-op check.

if (typeof document !== 'undefined') {
  const container = document.getElementById('app')
  if (container) {
    resolveBootConfig()
      .then((config) => mountPlanter(container, config))
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        container.replaceChildren()
        const el = document.createElement('div')
        el.className = 'planter-panel planter-panel-boot-error'
        const h = document.createElement('h2')
        h.textContent = 'Boot failed'
        const pre = document.createElement('pre')
        pre.textContent = message
        el.append(h, pre)
        container.append(el)
        // eslint-disable-next-line no-console
        console.error(`[planter] boot failed: ${message}`)
      })
  }
}
