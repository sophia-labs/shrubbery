/**
 * Top-level Organism route mounts for Garden shell surfaces.
 *
 * These are shell routes, not component logic. Components stay controlled and
 * backend-free; the Organism shell decides which full-page surface owns the host
 * for URL-level routes such as /settings, /ops-health, standalone chat, and
 * Choreograph (modes).
 */

import { t } from '@shrubbery/nucleus'
import { html, noChange, nothing, render as litRender } from 'lit'
import type {
  MnAuthPage,
  MnAuthMode,
  MnAuthResendVerificationDetail,
  MnAuthSignInDetail,
  MnAuthSignUpDetail,
  MnAuthVerifyEmailDetail,
  MnLandingActionDetail,
  MnLandingName,
  MnLifetimeBannerState,
  MnOpsHealthCopyJsonDetail,
  MnOpsHealthPage,
  MnOpsHealthSnapshot,
  MnSettingsSectionId,
  MnSettingsActionDetail,
  MnSettingsJobActionDetail,
  MnSettingsSecretActionDetail,
  MnSettingsSectionChangeDetail,
  MnSettingsSelectChangeDetail,
  MnSettingsToggleChangeDetail,
} from '@shrubbery/components'
import {
  makeLocalChatService,
  mountChatHost,
  type ChatService,
  type ChatSurfaceActionIntent,
} from '@shrubbery/runtime'
import { bindChoreographModesSurface } from './choreograph-modes-feature.js'
import type {
  OrganismSettingsService,
  OrganismSettingsSnapshot,
} from './settings-service.js'
import {
  mountGardenHomeRoute,
  type OrganismGardenHomeService,
} from './garden-home-route.js'
import type { ReapplyView } from './reapply-controller.js'
import {
  billingPlanSignature,
  checkoutReturnFrom,
  defaultCheckoutStorage,
  hasCheckoutParam,
  pollBalanceAfterCheckout,
  pollPlanAfterCheckout,
  showCheckoutResultToast,
  showCheckoutReturnToast,
  takePendingCheckout,
  withoutCheckoutParam,
  type CheckoutKind,
  type CheckoutReturnState,
  type PendingCheckoutStorage,
} from './checkout-return.js'
import { ACCOUNT_CONFIRMED_MESSAGE } from './cognito-auth-session.js'
import { topUpPreselectFromUrl, type BillingCreditsPort } from './add-credits.js'
import './add-credits-view.js'
import './credit-history-view.js'
import './phanes-control-editor.js'
import './usage-explorer-view.js'
import type { ChoreoModesSurface, ChromeAppLink, ChromeAppTab, ChromeControl } from '@shrubbery/components'

/** The route IS Choreograph: its one in-shell tab; everything else is a link. */
const CHOREOGRAPH_ROUTE_TABS: readonly ChromeAppTab[] = Object.freeze([
  { id: 'choreograph', label: 'Choreograph', icon: 'workflow' },
])
/** No live document here, so no Custom CSS / quick clip / sharing controls. */
const CHOREOGRAPH_ROUTE_CONTROLS: readonly ChromeControl[] = Object.freeze(['theme', 'skin', 'settings'])

export type OrganismAppRouteKind =
  | 'home'
  | 'landing'
  | 'legal'
  | 'auth'
  | 'settings'
  | 'ops-health'
  | 'chat'
  | 'chat-debug'
  | 'choreograph'

export interface HomeAppRoute {
  readonly kind: 'home'
}

export interface LandingAppRoute {
  readonly kind: 'landing'
  readonly landing: MnLandingName
}

export type LegalPage = 'privacy' | 'terms'

export interface LegalAppRoute {
  readonly kind: 'legal'
  readonly page: LegalPage
}

export interface AuthAppRoute {
  readonly kind: 'auth'
  readonly mode: MnAuthMode
  readonly pendingIdentity: string
  readonly deliveryDestination: string
  readonly deliveryMedium: string
  readonly successMessage: string
}

export interface SettingsAppRoute {
  readonly kind: 'settings'
  readonly sectionId: MnSettingsSectionId
}

export interface OpsHealthAppRoute {
  readonly kind: 'ops-health'
}

export interface ChatAppRoute {
  readonly kind: 'chat'
}

export interface ChatDebugAppRoute {
  readonly kind: 'chat-debug'
}

export interface ChoreographAppRoute {
  readonly kind: 'choreograph'
  readonly screen: string
  readonly graphId: string
  readonly runId: string
}

export type OrganismAppRoute =
  | HomeAppRoute
  | LandingAppRoute
  | LegalAppRoute
  | AuthAppRoute
  | SettingsAppRoute
  | OpsHealthAppRoute
  | ChatAppRoute
  | ChatDebugAppRoute
  | ChoreographAppRoute

type AsyncChatAppRoute = ChatAppRoute | ChatDebugAppRoute

export interface MountOrganismAppRouteOptions {
  readonly location?: Pick<Location, 'href' | 'pathname' | 'search' | 'hash'> | URL
  readonly history?: Pick<History, 'back'> | null
  readonly clipboard?: Pick<Clipboard, 'writeText'> | null
  readonly onClose?: (route: OrganismAppRoute) => void
  readonly onAuthSignIn?: (detail: MnAuthSignInDetail, route: AuthAppRoute) => void | Promise<void>
  readonly onAuthSignUp?: (detail: MnAuthSignUpDetail, route: AuthAppRoute) => void | Promise<void>
  readonly onAuthVerifyEmail?: (detail: MnAuthVerifyEmailDetail, route: AuthAppRoute) => void | Promise<void>
  readonly onAuthResendVerification?: (detail: MnAuthResendVerificationDetail, route: AuthAppRoute) => void | Promise<void>
  /** Real shell-owned authentication effects; components remain controlled. */
  readonly authActions?: OrganismAuthActions
  /** Called after a sign-in or email verification completes successfully. */
  readonly onAuthSuccess?: (kind: 'signin' | 'verify', route: AuthAppRoute) => void | Promise<void>
  readonly onLandingAction?: (detail: MnLandingActionDetail, route: LandingAppRoute) => void | Promise<void>
  /** Deployment-owned signup destination; absent hosts retain the component default. */
  readonly gardenAppHref?: string
  readonly onChatSurfaceAction?: (action: ChatSurfaceActionIntent) => void
  /**
   * Host-selected chat transport for standalone/debug routes. Local echo is the
   * development fallback; production passes the hosted Choreograph service.
   */
  readonly chatService?: ChatService | (() => ChatService)
  /** Shell-owned operational snapshot provider. Without one the page remains idle. */
  readonly opsHealthService?: OrganismOpsHealthService
  /** Poll cadence; null disables polling. Garden's production cadence is 15 seconds. */
  readonly opsHealthPollIntervalMs?: number | null
  /**
   * The cell contract the Choreograph modes route reaches MCP through
   * (`rawMcp`, plus `gateway.graphs()` for scope suggestions when hosted).
   */
  readonly choreographContract?: unknown
  /** Graph the modes route edits when the URL names none (`?graph=`). */
  readonly choreographGraphId?: string
  /**
   * The Sophia top bar's cross-app links for the Choreograph route, for the
   * route's graph (Garden back into the same workspace; Hoja when permitted).
   * Absent: the bar still renders, with Garden linking to `/`.
   */
  readonly choreographAppLinks?: (graphId: string) => readonly ChromeAppLink[]
  /** Shell-owned settings state/effects. Components receive only controlled rows. */
  readonly settingsService?: OrganismSettingsService
  /**
   * Replace the current history entry without navigating. The settings route
   * uses it to drop a Stripe `checkout=` return marker so reloads stay quiet.
   */
  readonly replaceUrl?: (url: URL) => void
  /** Re-read budget after `checkout=success`, for the balance (top-up) or the plan (defaults: 4s × 8). */
  readonly checkoutPlanPoll?: { readonly intervalMs: number; readonly attempts: number }
  /**
   * Where the tab left its pre-checkout marker (what was bought, the balance from
   * before). Default: this tab's session storage; `null`: none, so a return falls
   * back to reading the balance for itself.
   */
  readonly checkoutStorage?: PendingCheckoutStorage | null
  /** Account/catalog effects for the global Garden doorway. */
  readonly gardenHomeService?: OrganismGardenHomeService
  /**
   * The fence banner's state and both its intents (master §3 Slice 7, WS3
   * §5.1). `state: null | undefined` renders nothing — an honest absence,
   * not a fabricated "all clear". `onAdopt` is the primary action ("Reload
   * this graph") — the host calls `SourceMirrorRuntime.adoptNewLife`.
   * `onViewParked` is the secondary action ("View parked work"); the
   * parked-work route face it opens does not exist until master §3 Slice 8,
   * so a host that does not yet supply it simply has no secondary handler —
   * the banner itself already suppresses that button at zero parked counts.
   */
  readonly lifetime?: ShellLifetimeBannerOptions
  /**
   * The reapply overlay's real props/handlers (master §3 Slice 9, WS3 §7,
   * §9). `view: null | undefined` renders nothing — `<mn-restore-
   * overlay>`'s own `active` gate, unchanged. The host computes
   * `primaryLabel`/`secondaryLabel` itself (RA-12/RA-12b/RA-13 need the
   * live `graphTitle`, which this shell-routing module does not otherwise
   * carry) and MUST pass `''` for `secondaryLabel` whenever
   * `onSecondary` has no real handler, or the component renders a live
   * but silent second button. `onPrimary` is bound to BOTH
   * `mn-restore-overlay-reload` (succeeded) and `-dismiss` (failed/
   * rolled_back) — the component already routes the correct SEMANTIC
   * meaning through which event it emits per `operationState`; the two
   * outcomes converge on one host action either way (RA-12/RA-13 both
   * navigate the human back into the graph they were looking at).
   */
  readonly reapply?: ShellReapplyOverlayOptions
}

/**
 * Narrow, reusable props for `<mn-lifetime-banner>` (master §3 Slice 7),
 * pulled out of `MountOrganismAppRouteOptions` so a host OTHER than an
 * app-route frame can share the exact same mount contract (bundle audit
 * findings 2/3, 2026-07-31: the ordinary per-graph workspace — which
 * `render-workspace.ts`'s own doc comment deliberately keeps free of any
 * banner/overlay stack — mounts this via `lifetimeBannerTemplate` too, in
 * `main.ts`'s own shell-owned slot flanking `#host`. One contract, one
 * markup, two mount points.
 */
export interface ShellLifetimeBannerOptions {
  readonly state: MnLifetimeBannerState | null
  readonly onAdopt?: () => void
  readonly onViewParked?: () => void
}

/** Narrow, reusable props for `<mn-restore-overlay>` (master §3 Slice 9) —
 *  same sharing rationale as {@link ShellLifetimeBannerOptions} above. */
export interface ShellReapplyOverlayOptions {
  readonly view: ReapplyView | null
  readonly primaryLabel?: string
  readonly secondaryLabel?: string
  readonly onPrimary?: () => void
  readonly onSecondary?: () => void
}

export interface OrganismOpsHealthService {
  load(): Promise<MnOpsHealthSnapshot>
}

export interface OrganismAuthSignUpResult {
  readonly identity?: string
  readonly confirmed: boolean
  readonly deliveryDestination?: string
  readonly deliveryMedium?: string
}

export interface OrganismAuthResendResult {
  readonly deliveryDestination?: string
  readonly deliveryMedium?: string
}

export interface OrganismAuthActions {
  signIn(detail: MnAuthSignInDetail): Promise<void>
  signUp(detail: MnAuthSignUpDetail): Promise<OrganismAuthSignUpResult>
  verifyEmail(detail: MnAuthVerifyEmailDetail): Promise<void>
  resendVerification(detail: MnAuthResendVerificationDetail): Promise<OrganismAuthResendResult>
}

export interface OrganismAppRouteMount {
  readonly route: OrganismAppRoute
  readonly ready: Promise<void>
  destroy(): void
}

function asUrl(locationLike: Pick<Location, 'href'> | URL): URL {
  return locationLike instanceof URL ? locationLike : new URL(locationLike.href)
}

function normalizedPath(url: URL): string {
  const path = url.pathname.replace(/\/+$/, '')
  return path || '/'
}

function cleanHash(hash: string): string {
  const raw = hash.replace(/^#/, '').trim()
  if (!raw || raw.startsWith('/')) return ''
  return raw
}

function settingsSection(url: URL): MnSettingsSectionId {
  return (
    url.searchParams.get('settings')?.trim() ||
    url.searchParams.get('section')?.trim() ||
    cleanHash(url.hash) ||
    'account'
  )
}

function authMode(value: string | null | undefined, path: string): MnAuthMode {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'signup' || normalized === 'sign-up' || path === '/signup' || path === '/sign-up') {
    return 'signup'
  }
  if (
    normalized === 'verify' ||
    normalized === 'verify-email' ||
    path === '/verify' ||
    path === '/verify-email'
  ) {
    return 'verify'
  }
  return 'signin'
}

function authRoute(url: URL): AuthAppRoute {
  const path = normalizedPath(url)
  const mode = authMode(url.searchParams.get('mode') ?? url.searchParams.get('auth'), path)
  const identity = url.searchParams.get('identity')?.trim() || url.searchParams.get('email')?.trim() || ''
  return {
    kind: 'auth',
    mode,
    pendingIdentity: identity,
    deliveryDestination: url.searchParams.get('destination')?.trim() || identity,
    deliveryMedium: url.searchParams.get('delivery')?.trim() || '',
    successMessage: url.searchParams.get('success')?.trim() || '',
  }
}

function landingRoute(url: URL): LandingAppRoute {
  const path = normalizedPath(url)
  const value = url.searchParams.get('landing')?.trim().toLowerCase() || url.searchParams.get('view')?.trim().toLowerCase()
  const landing: MnLandingName = (
    path === '/sophia-labs' ||
    path === '/sophia-labs.html' ||
    path === '/labs' ||
    value === 'sophia' ||
    value === 'sophia-labs'
  )
    ? 'sophia'
    : 'garden'
  return { kind: 'landing', landing }
}

function choreographRoute(url: URL): ChoreographAppRoute {
  const parts = normalizedPath(url).split('/').filter(Boolean)
  const screen = url.searchParams.get('screen')?.trim() || parts[1] || 'home'
  const runId = url.searchParams.get('runId')?.trim() || url.searchParams.get('run')?.trim() || (screen === 'run' ? parts[2] ?? '' : '')
  // `?graph=` is the suite-wide workspace parameter (Garden, Hoja); the older
  // `graphId` / `g` spellings still open the same graph.
  const graphId = url.searchParams.get('graph')?.trim() || url.searchParams.get('graphId')?.trim()
    || url.searchParams.get('g')?.trim() || ''
  return { kind: 'choreograph', screen, graphId, runId }
}

export function detectOrganismAppRoute(
  locationLike: Pick<Location, 'href' | 'pathname' | 'search' | 'hash'> | URL,
): OrganismAppRoute | null {
  const url = asUrl(locationLike)
  const path = normalizedPath(url)
  const view = url.searchParams.get('view')?.trim()

  if (path === '/home' || view === 'home') {
    return { kind: 'home' }
  }

  if (
    path === '/garden' ||
    path === '/garden.html' ||
    path === '/sophia-labs' ||
    path === '/sophia-labs.html' ||
    path === '/labs' ||
    view === 'landing' ||
    view === 'sophia' ||
    view === 'sophia-labs' ||
    view === 'garden'
  ) {
    return landingRoute(url)
  }

  if (path === '/privacy' || path === '/privacy.html' || view === 'privacy') {
    return { kind: 'legal', page: 'privacy' }
  }

  if (path === '/terms' || path === '/terms.html' || view === 'terms') {
    return { kind: 'legal', page: 'terms' }
  }

  if (
    path === '/auth' ||
    path === '/login' ||
    path === '/signin' ||
    path === '/sign-in' ||
    path === '/signup' ||
    path === '/sign-up' ||
    path === '/verify' ||
    path === '/verify-email' ||
    view === 'auth'
  ) {
    return authRoute(url)
  }

  if (path === '/ops-health' || url.hash === '#/ops-health' || view === 'ops-health') {
    return { kind: 'ops-health' }
  }

  if (path === '/settings' || view === 'settings') {
    return { kind: 'settings', sectionId: settingsSection(url) }
  }

  if (url.searchParams.has('chat-standalone') || path === '/chat' || path === '/chat/standalone') {
    return { kind: 'chat' }
  }

  if (path === '/chat-debug' || path === '/chat-debug.html' || path === '/chat/debug' || view === 'chat-debug') {
    return { kind: 'chat-debug' }
  }

  if (path === '/choreograph' || path.startsWith('/choreograph/')) {
    return choreographRoute(url)
  }

  return null
}

function routeBack(route: OrganismAppRoute, options: MountOrganismAppRouteOptions): void {
  if (options.onClose) {
    options.onClose(route)
    return
  }
  options.history?.back()
}

/**
 * Real props/handlers for `<mn-lifetime-banner>` — it is the FIRST wired
 * banner in this stack (`<mn-upgrade-banner>`/`<mn-storage-banner>` are
 * both mounted bare below, master §3 Slice 7, WS3 C4). `undefined`/`state:
 * null` renders nothing (no reserved space) — the component's own gate.
 *
 * EXPORTED (bundle audit findings 2/3) so `main.ts` can mount the identical
 * markup for the ordinary per-graph workspace, which owns no frame of its
 * own to embed this in — see `ShellLifetimeBannerOptions`'s doc comment.
 */
export function lifetimeBannerTemplate(options: ShellLifetimeBannerOptions | undefined): unknown {
  return html`
    <mn-lifetime-banner
      .state=${options?.state ?? null}
      @mn-lifetime-primary=${() => options?.onAdopt?.()}
      @mn-lifetime-secondary=${() => options?.onViewParked?.()}
    ></mn-lifetime-banner>
  `
}

/**
 * Real props/handlers for `<mn-restore-overlay>` (master §3 Slice 9,
 * WS3 §7.2, §6.3, C-D27). Mounted bare through every slice since Garden's
 * own ancestor shipped it (03 §0 row C5) — this is the first wiring.
 *
 * EXPORTED for the same reason as {@link lifetimeBannerTemplate} above.
 */
export function reapplyOverlayTemplate(options: ShellReapplyOverlayOptions | undefined): unknown {
  const view = options?.view ?? null
  return html`
    <mn-restore-overlay
      .active=${view?.active ?? false}
      .operationState=${view?.stage ?? ''}
      .progress=${view?.progress ?? 0}
      .heading=${view?.heading ?? ''}
      .message=${view?.message ?? ''}
      .error=${view?.error ?? ''}
      .primaryLabel=${options?.primaryLabel ?? ''}
      .secondaryLabel=${options?.secondaryLabel ?? ''}
      overlay-id="reapply-overlay"
      @mn-restore-overlay-reload=${() => options?.onPrimary?.()}
      @mn-restore-overlay-dismiss=${() => options?.onPrimary?.()}
      @mn-restore-overlay-secondary=${() => options?.onSecondary?.()}
    ></mn-restore-overlay>
  `
}

function routeFrame(route: OrganismAppRoute, body: unknown, options: MountOrganismAppRouteOptions): unknown {
  if (route.kind === 'home') {
    return html`<div class="organism-route-home" data-organism-route="home">${body}</div>`
  }

  if (route.kind === 'landing') {
    return html`<div class="organism-route-landing" data-organism-route="landing" data-landing=${route.landing}>${body}</div>`
  }

  if (route.kind === 'legal') {
    const title = route.page === 'privacy' ? 'Privacy Policy - Sophia Labs' : 'Terms and Conditions - Sophia Labs'
    return html`
      <div class="organism-route-legal" data-organism-route="legal" data-legal-page=${route.page}>
        <iframe class="legal-frame" title=${title} src=${`/legal/${route.page}.html`}></iframe>
      </div>
    `
  }

  if (route.kind === 'auth') {
    return html`<div class="organism-route-auth" data-organism-route="auth">${body}</div>`
  }

  if (route.kind === 'chat') {
    return html`<div class="organism-route-chat" data-organism-route="chat">${body}</div>`
  }

  if (route.kind === 'chat-debug') {
    return html`
      <div class="organism-route-chat-debug" data-organism-route="chat-debug">
        <div class="chat-debug-page">
          <header class="chat-debug-header">
            <div class="chat-debug-title">Chat Debug Console</div>
            <div class="chat-debug-hint">Full-page view to inspect the live Shrubbery chat host and streaming log state.</div>
            <div class="chat-debug-hint">Tip: scroll the log; when auto-scroll pauses, use the panel's scroll-to-bottom control.</div>
          </header>
          <div class="chat-debug-panel">${body}</div>
        </div>
      </div>
    `
  }

  if (route.kind === 'choreograph') {
    // The same Sophia top bar Garden and Hoja wear: Choreograph checked, its
    // Overview / New mode toolbar, Garden (and Hoja) one click away in the
    // same workspace. The workspace is the route's `?graph=`, else the shell's.
    const graphId = route.graphId || options.choreographGraphId?.trim() || ''
    const appLinks = options.choreographAppLinks?.(graphId)
      ?? [{ id: 'garden', label: 'Garden', icon: 'sprout', href: '/' }]
    return html`
      <div class="app-container organism-route-frame" data-organism-route="choreograph">
        <mn-top-bar
          active-app="choreograph"
          .apps=${CHOREOGRAPH_ROUTE_TABS}
          .appLinks=${appLinks}
          .controls=${CHOREOGRAPH_ROUTE_CONTROLS}
        ></mn-top-bar>
        ${lifetimeBannerTemplate(options.lifetime)}
        <mn-upgrade-banner></mn-upgrade-banner>
        <mn-storage-banner></mn-storage-banner>
        <div class="main route-main">${body}</div>
        ${reapplyOverlayTemplate(options.reapply)}
      </div>
    `
  }

  return html`
    <div class="app-container organism-route-frame" data-organism-route=${route.kind}>
      <mn-top-bar></mn-top-bar>
      ${lifetimeBannerTemplate(options.lifetime)}
      <mn-upgrade-banner></mn-upgrade-banner>
      <mn-storage-banner></mn-storage-banner>
      <div class="main route-main">${body}</div>
      ${reapplyOverlayTemplate(options.reapply)}
    </div>
  `
}

async function copyOpsSnapshot(detail: MnOpsHealthCopyJsonDetail, options: MountOrganismAppRouteOptions): Promise<void> {
  const text = JSON.stringify(detail.snapshot, null, 2)
  // navigator.clipboard exists only in secure contexts (HTTPS, localhost); a plain-HTTP LAN page has none.
  if (!options.clipboard?.writeText) throw new Error('Copying needs the clipboard, which this browser offers only over HTTPS or on localhost.')
  await options.clipboard.writeText(text)
}

async function renderOpsHealthRoute(
  host: HTMLElement,
  route: OpsHealthAppRoute,
  options: MountOrganismAppRouteOptions,
  isActive: () => boolean,
): Promise<() => void> {
  const service = options.opsHealthService
  let requestId = 0
  let timer: ReturnType<typeof setInterval> | null = null

  const refresh = async (): Promise<void> => {
    if (!service) return
    const page = host.querySelector('mn-ops-health-page') as MnOpsHealthPage | null
    if (!page) return
    const currentRequest = ++requestId
    page.status = 'loading'
    page.error = ''
    try {
      const snapshot = await service.load()
      if (!isActive() || currentRequest !== requestId) return
      page.snapshot = snapshot
      page.status = 'ready'
    } catch (error) {
      if (!isActive() || currentRequest !== requestId) return
      page.status = 'error'
      page.error = error instanceof Error ? error.message : String(error)
    }
  }

  litRender(routeFrame(route, html`
    <mn-ops-health-page
      style="width:100%;height:100%;"
      .status=${service ? 'loading' : 'idle'}
      @mn-ops-health-refresh=${() => { void refresh() }}
      @mn-ops-health-back=${() => routeBack(route, options)}
      @mn-ops-health-copy-json=${(event: CustomEvent<MnOpsHealthCopyJsonDetail>) => {
        const page = event.currentTarget as MnOpsHealthPage
        void copyOpsSnapshot(event.detail, options).catch(error => {
          page.error = error instanceof Error ? error.message : String(error)
        })
      }}
    ></mn-ops-health-page>
  `, options), host)

  if (service) {
    await refresh()
    const pollIntervalMs = options.opsHealthPollIntervalMs === undefined
      ? 15_000
      : options.opsHealthPollIntervalMs
    if (pollIntervalMs !== null && pollIntervalMs > 0 && isActive()) {
      timer = setInterval(() => { void refresh() }, pollIntervalMs)
    }
  }

  return () => {
    requestId += 1
    if (timer !== null) clearInterval(timer)
  }
}

async function renderSettingsRoute(
  host: HTMLElement,
  route: SettingsAppRoute,
  options: MountOrganismAppRouteOptions,
  isActive: () => boolean,
  checkout: CheckoutReturnState | null = null,
  topUpPreselect: number | null = null,
): Promise<() => void> {
  const service = options.settingsService
  const credits = service?.billingCredits
  // Bumped when a top-up lands, so the credit history reloads and shows it.
  let creditsVersion = 0
  let requestId = 0
  let activeSection = route.sectionId
  let status: 'loading' | 'ready' | 'error' = service ? 'loading' : 'ready'
  let error = ''
  let snapshot: OrganismSettingsSnapshot = { userName: '', userEmail: '', sections: [] }
  let unsubscribe = (): void => undefined

  const draw = (): void => {
    if (!isActive()) return
    litRender(routeFrame(route, html`
      <mn-settings-page
        style="width:100%;height:100%;"
        .status=${status}
        .error=${error}
        .activeSection=${activeSection}
        .userName=${snapshot.userName}
        .userEmail=${snapshot.userEmail}
        .runtimeMode=${snapshot.runtimeMode ?? ''}
        .userId=${snapshot.account?.userId ?? ''}
        .userUsername=${snapshot.account?.username ?? ''}
        .emailVerified=${snapshot.account?.emailVerified ?? null}
        .sections=${snapshot.sections}
        @mn-settings-section-change=${(event: CustomEvent<MnSettingsSectionChangeDetail>) => {
          if (activeSection === 'api-mcp' && event.detail.sectionId !== 'api-mcp') service?.apiKeyStore?.discardOneTimeSecret()
          activeSection = event.detail.sectionId
          draw()
        }}
        @mn-settings-toggle-change=${(event: CustomEvent<MnSettingsToggleChangeDetail>) => {
          void mutate(() => service?.toggle(event.detail))
        }}
        @mn-settings-select-change=${(event: CustomEvent<MnSettingsSelectChangeDetail>) => {
          void mutate(() => service?.select(event.detail))
        }}
        @mn-settings-secret-action=${(event: CustomEvent<MnSettingsSecretActionDetail>) => {
          void mutate(() => service?.secret(event.detail))
        }}
        @mn-settings-action=${(event: CustomEvent<MnSettingsActionDetail>) => {
          void mutate(() => service?.action(event.detail))
        }}
        @mn-settings-job-action=${(event: CustomEvent<MnSettingsJobActionDetail>) => {
          void mutate(() => service?.job(event.detail))
        }}
        @mn-settings-refresh=${() => { void refresh() }}
        @mn-settings-close=${() => routeBack(route, options)}
      >
        ${activeSection === 'api-mcp' && service?.apiKeyStore ? html`<mn-api-key-manager slot="api-key-manager" .store=${service.apiKeyStore} .gatewayUrl=${service.apiKeyGatewayUrl ?? ''} .listGraphs=${service.apiKeyGraphs}></mn-api-key-manager>` : nothing}
        ${activeSection === 'usage' && service?.usageExplorer ? html`<mn-usage-explorer slot="usage-explorer" .reader=${service.usageExplorer} .feePercent=${credits?.feePercent() ?? null}></mn-usage-explorer>` : nothing}
        ${activeSection === 'billing' && credits ? html`
          <div slot="billing-credits" style="display:grid;gap:var(--mn-space-4,16px)">
            <mn-add-credits .port=${credits} .preselect=${topUpPreselect}></mn-add-credits>
            <mn-credit-history .reader=${credits.history} .refreshKey=${creditsVersion}></mn-credit-history>
          </div>
        ` : nothing}
        ${service?.phanesControl ? html`
          <mn-phanes-control-editor
            slot="phanes-control"
            .api=${service.phanesControl}
          ></mn-phanes-control-editor>
        ` : nothing}
      </mn-settings-page>
    `, options), host)
  }

  const refresh = async (showLoading = true): Promise<void> => {
    if (!service) {
      status = 'ready'
      draw()
      return
    }
    const currentRequest = ++requestId
    if (showLoading) status = 'loading'
    error = ''
    draw()
    try {
      const next = await service.load()
      if (!isActive() || currentRequest !== requestId) return
      snapshot = next
      status = 'ready'
      draw()
    } catch (cause) {
      if (!isActive() || currentRequest !== requestId) return
      status = 'error'
      error = cause instanceof Error ? cause.message : String(cause)
      draw()
    }
  }

  const mutate = async (effect: () => void | Promise<void> | undefined): Promise<void> => {
    if (!service) return
    try {
      await effect()
      await refresh()
    } catch (cause) {
      if (!isActive()) return
      status = 'error'
      error = cause instanceof Error ? cause.message : String(cause)
      draw()
    }
  }

  draw()
  await refresh()
  if (service?.subscribe) {
    let queued = false
    unsubscribe = service.subscribe(() => {
      if (queued || !isActive()) return
      queued = true
      queueMicrotask(() => {
        queued = false
        if (isActive()) void refresh(false)
      })
    })
  }
  const budget = options.checkoutPlanPoll ?? { intervalMs: 4_000, attempts: 8 }

  /** A top-up has landed when the balance is above what it was before the payment. */
  const followTopUp = async (port: BillingCreditsPort, remembered: number | null): Promise<void> => {
    const read = async (): Promise<number | null> => {
      await port.refreshBalance()
      return port.balanceMicroUsd()
    }
    let first: number | null
    try { first = await read() } catch { first = null }
    if (!isActive()) return
    // The tab's own marker knows the balance from before the payment; without one
    // the first read after the return is all there is to compare against.
    const baseline = remembered ?? first
    if (baseline === null) return
    const result = first !== null && first > baseline
      ? 'changed'
      : await pollBalanceAfterCheckout({ read, baseline, isActive, ...budget })
    if (!isActive()) return
    if (result === 'changed') {
      creditsVersion += 1
      draw()
      showCheckoutResultToast(host.ownerDocument, 'credited', port.balanceMicroUsd())
    } else if (result === 'unreadable' && first === null) {
      // Not one read succeeded after the return: nothing is known, and "late" would claim more.
      showCheckoutResultToast(host.ownerDocument, 'unreadable', null)
    } else if (result !== 'stopped' && remembered !== null) {
      // Only a tab that knew the balance from before can say the credit is late. A balance read
      // once after the return and then lost still counts as read: as far as anyone can tell, it had not arrived.
      showCheckoutResultToast(host.ownerDocument, 'late', null)
    }
  }

  if (checkout?.outcome === 'success' && service && isActive()) {
    if (checkout.kind === 'topup') {
      if (credits) void followTopUp(credits, checkout.baselineMicroUsd)
    } else if (billingPlanSignature(snapshot.sections)) {
      // A billing section with a plan is the hosted signal; local runtimes skip.
      const reread = async (): Promise<string> => {
        await service.action({ sectionId: 'billing', actionId: 'refresh-usage' })
        await refresh(false)
        return billingPlanSignature(snapshot.sections)
      }
      void (async () => {
        let baseline: string
        try { baseline = await reread() } catch { return }
        if (!baseline || !isActive()) return
        await pollPlanAfterCheckout({ refresh: reread, baseline, isActive, ...budget })
      })()
    }
  }
  return () => {
    requestId += 1
    unsubscribe()
  }
}

async function renderChatRoute(
  host: HTMLElement,
  route: AsyncChatAppRoute,
  options: MountOrganismAppRouteOptions,
  isActive: () => boolean,
): Promise<void> {
  const configured = options.chatService
  const service: ChatService = typeof configured === 'function'
    ? configured()
    : configured ?? makeLocalChatService()
  const session = await service.createSession({
    title: route.kind === 'chat-debug' ? 'Chat debug console' : 'Standalone chat',
  })
  if (!isActive()) return
  litRender(routeFrame(route, mountChatHost(service, session.id, {
    onSurfaceAction: options.onChatSurfaceAction,
  }), options), host)
}

async function renderChoreographRoute(
  host: HTMLElement,
  route: ChoreographAppRoute,
  options: MountOrganismAppRouteOptions,
  isActive: () => boolean,
): Promise<() => void> {
  if (!isActive()) return () => {}
  litRender(routeFrame(route, html`
    <choreo-modes-surface style="width:100%;height:100%;"></choreo-modes-surface>
  `, options), host)
  const surface = host.querySelector<ChoreoModesSurface>('choreo-modes-surface')
  if (!surface) return () => {}
  const graphId = route.graphId || options.choreographGraphId?.trim() || ''
  return bindChoreographModesSurface(surface, options.choreographContract ?? null, graphId)
}

function renderSyncRoute(
  host: HTMLElement,
  route: Exclude<OrganismAppRoute, AsyncChatAppRoute | OpsHealthAppRoute | HomeAppRoute>,
  options: MountOrganismAppRouteOptions,
): void {
  if (route.kind === 'landing') {
    const page = route.landing === 'sophia'
      ? html`
        <sophia-labs-landing
          style="width:100%;min-height:100%;"
          @mn-landing-action=${(event: CustomEvent<MnLandingActionDetail>) => {
            void options.onLandingAction?.(event.detail, route)
          }}
        ></sophia-labs-landing>
      `
      : html`
        <garden-landing
          style="width:100%;min-height:100%;"
          .appHref=${options.gardenAppHref ?? noChange}
          @mn-landing-action=${(event: CustomEvent<MnLandingActionDetail>) => {
            void options.onLandingAction?.(event.detail, route)
          }}
        ></garden-landing>
      `
    litRender(routeFrame(route, page, options), host)
    return
  }

  if (route.kind === 'legal') {
    litRender(routeFrame(route, nothing, options), host)
    return
  }

  if (route.kind === 'auth') {
    const pageFrom = (event: Event): MnAuthPage => event.currentTarget as MnAuthPage
    const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)
    const userNotConfirmed = (error: unknown): boolean =>
      Boolean(error && typeof error === 'object' && 'isUserNotConfirmed' in error && error.isUserNotConfirmed)
    const alreadyConfirmed = (error: unknown): boolean =>
      Boolean(error && typeof error === 'object' && 'isAlreadyConfirmed' in error && error.isAlreadyConfirmed)

    // What this page's person typed to sign up or sign in, held in memory only until the ONE automatic
    // sign-in it is held for begins (then it is gone, whatever comes of it; see `continueAsConfirmed`), so that
    // an account that turns out to be confirmed can be signed in without asking again. Never stored; also
    // dropped the moment the account is confirmed by the person's own code, or signs in.
    let held: { readonly identities: readonly string[]; readonly password: string } | null = null
    const sameAccount = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

    /**
     * The account is confirmed (Cognito said so in its own words: the trigger failed after the
     * confirmation committed, or the confirmation or the resend found it already done). Say so. When
     * the person was confirming (`attemptSignIn`) and this page still holds the password for the account,
     * sign in; a resend is a request for a new code, not to be signed in, so it only says so and opens
     * the sign-in form. Never claim more than is known: if the sign-in itself says the account is not
     * confirmed, the code form stays and says that.
     */
    const continueAsConfirmed = async (page: MnAuthPage, identity: string, attemptSignIn: boolean): Promise<void> => {
      page.verifyError = ''
      // The held password is SPENT by this one attempt, and gone the moment it begins (Vera, 2026-10-03: not for
      // the page's life): taken out of `held` before anything is awaited, so whatever comes of the sign-in
      // (signed in, refused, "not confirmed" after all) and whatever arrives while it is in flight (a second
      // confirmation, a resend) finds nothing to use. Only the call below still holds it, for as long as it runs.
      const credentials = attemptSignIn && held?.identities.some(known => sameAccount(known, identity)) ? held : null
      held = null
      if (credentials && options.authActions) {
        try {
          await options.authActions.signIn({ identity: credentials.identities[0] ?? identity, password: credentials.password })
          page.verifyStatus = 'success'
          await options.onAuthSuccess?.('signin', route)
          return
        } catch (error) {
          if (userNotConfirmed(error)) {
            page.verifyStatus = 'error'
            page.verifyError = errorMessage(error)
            return
          }
          // Any other refusal of this automatic attempt is not the person's to read: the sign-in
          // form below says what to do.
        }
      }
      page.verifyStatus = 'success'
      page.signInStatus = 'idle'
      page.signInError = ''
      page.successMessage = ACCOUNT_CONFIRMED_MESSAGE
      page.mode = 'signin'
    }

    const signIn = async (event: CustomEvent<MnAuthSignInDetail>): Promise<void> => {
      const page = pageFrom(event)
      page.signInStatus = 'loading'
      page.signInError = ''
      try {
        await options.onAuthSignIn?.(event.detail, route)
        if (!options.authActions) return
        await options.authActions.signIn(event.detail)
        held = null
        page.signInStatus = 'success'
        await options.onAuthSuccess?.('signin', route)
      } catch (error) {
        page.signInStatus = 'error'
        page.signInError = errorMessage(error)
        if (userNotConfirmed(error)) {
          held = { identities: [event.detail.identity], password: event.detail.password }
          page.mode = 'verify'
          page.pendingIdentity = event.detail.identity
        }
      }
    }

    const signUp = async (event: CustomEvent<MnAuthSignUpDetail>): Promise<void> => {
      const page = pageFrom(event)
      page.signUpStatus = 'loading'
      page.signUpError = ''
      try {
        await options.onAuthSignUp?.(event.detail, route)
        if (!options.authActions) return
        const result = await options.authActions.signUp(event.detail)
        page.signUpStatus = 'success'
        page.pendingIdentity = result.identity ?? event.detail.username
        if (result.confirmed) {
          held = null
          page.mode = 'signin'
          page.successMessage = 'Account created. Sign in to continue.'
        } else {
          held = { identities: [page.pendingIdentity, event.detail.email], password: event.detail.password }
          page.mode = 'verify'
          page.deliveryDestination = result.deliveryDestination ?? event.detail.email
          page.deliveryMedium = result.deliveryMedium ?? ''
          page.successMessage = 'Account created. Enter the verification code we sent you.'
        }
      } catch (error) {
        page.signUpStatus = 'error'
        page.signUpError = errorMessage(error)
      }
    }

    const verifyEmail = async (event: CustomEvent<MnAuthVerifyEmailDetail>): Promise<void> => {
      const page = pageFrom(event)
      page.verifyStatus = 'loading'
      page.verifyError = ''
      try {
        await options.onAuthVerifyEmail?.(event.detail, route)
        if (!options.authActions) return
        await options.authActions.verifyEmail(event.detail)
        held = null
        page.verifyStatus = 'success'
        page.mode = 'signin'
        page.successMessage = 'Email verified. Sign in to continue.'
        await options.onAuthSuccess?.('verify', route)
      } catch (error) {
        if (alreadyConfirmed(error)) {
          await continueAsConfirmed(page, event.detail.identity, true)
          return
        }
        page.verifyStatus = 'error'
        page.verifyError = errorMessage(error)
      }
    }

    const resendVerification = async (event: CustomEvent<MnAuthResendVerificationDetail>): Promise<void> => {
      const page = pageFrom(event)
      page.verifyStatus = 'loading'
      page.verifyError = ''
      try {
        await options.onAuthResendVerification?.(event.detail, route)
        if (!options.authActions) return
        const result = await options.authActions.resendVerification(event.detail)
        page.verifyStatus = 'success'
        page.deliveryDestination = result.deliveryDestination ?? page.deliveryDestination
        page.deliveryMedium = result.deliveryMedium ?? page.deliveryMedium
        page.successMessage = 'A new verification code has been sent.'
      } catch (error) {
        if (alreadyConfirmed(error)) {
          await continueAsConfirmed(page, event.detail.identity, false)
          return
        }
        page.verifyStatus = 'error'
        page.verifyError = errorMessage(error)
      }
    }

    litRender(routeFrame(route, html`
      <mn-auth-page
        style="width:100%;min-height:100%;"
        .mode=${route.mode}
        .pendingIdentity=${route.pendingIdentity}
        .deliveryDestination=${route.deliveryDestination}
        .deliveryMedium=${route.deliveryMedium}
        .successMessage=${route.successMessage}
        @mn-auth-sign-in-submit=${(event: CustomEvent<MnAuthSignInDetail>) => { void signIn(event) }}
        @mn-auth-sign-up-submit=${(event: CustomEvent<MnAuthSignUpDetail>) => { void signUp(event) }}
        @mn-auth-verify-email-submit=${(event: CustomEvent<MnAuthVerifyEmailDetail>) => { void verifyEmail(event) }}
        @mn-auth-resend-verification=${(event: CustomEvent<MnAuthResendVerificationDetail>) => { void resendVerification(event) }}
      ></mn-auth-page>
    `, options), host)
    return
  }

  if (route.kind === 'settings') {
    litRender(routeFrame(route, html`
      <mn-settings-page
        style="width:100%;height:100%;"
        .activeSection=${route.sectionId}
        @mn-settings-close=${() => routeBack(route, options)}
      ></mn-settings-page>
    `, options), host)
    return
  }

  litRender(routeFrame(route, html`
    <choreo-modes-surface style="width:100%;height:100%;"></choreo-modes-surface>
  `, options), host)
}

/** Scrub `checkout=` from history first, then report the outcome once. */
function takeCheckoutReturn(url: URL, host: HTMLElement, options: MountOrganismAppRouteOptions): CheckoutReturnState | null {
  if (!hasCheckoutParam(url)) return null
  options.replaceUrl?.(withoutCheckoutParam(url))
  const outcome = checkoutReturnFrom(url)
  if (!outcome) return null
  // What was bought, and the balance from before, come from this tab's own
  // marker; the return is the only reader, and reading consumes it.
  const storage = options.checkoutStorage === undefined ? defaultCheckoutStorage() : options.checkoutStorage
  const pending = takePendingCheckout(storage)
  // Credits are what is on sale; a plan return is one the tab said it started.
  const kind: CheckoutKind = pending?.kind ?? 'topup'
  showCheckoutReturnToast(host.ownerDocument, outcome, kind)
  return {
    outcome,
    kind,
    baselineMicroUsd: outcome === 'success' && kind === 'topup' ? pending?.baselineMicroUsd ?? null : null,
  }
}

export function mountOrganismAppRoute(
  host: HTMLElement,
  options: MountOrganismAppRouteOptions = {},
): OrganismAppRouteMount | null {
  const locationLike = options.location ?? (typeof window !== 'undefined' ? window.location : undefined)
  if (!locationLike) return null

  const route = detectOrganismAppRoute(locationLike)
  if (!route) return null

  let destroyed = false
  let cleanup: (() => void) | null = null
  const checkout = route.kind === 'settings' ? takeCheckoutReturn(asUrl(locationLike), host, options) : null
  const ready = (async () => {
    if (route.kind === 'home') {
      litRender(routeFrame(route, html`<div class="garden-home-route-mount"></div>`, options), host)
      const routeHost = host.querySelector<HTMLElement>('.garden-home-route-mount')
      if (!routeHost) throw new Error('Garden Home route mount was not rendered')
      const service = options.gardenHomeService ?? {
        async load(): Promise<never> {
          throw new Error('Garden Home catalog service is unavailable.')
        },
        openGraph() {},
      }
      const home = mountGardenHomeRoute(routeHost, service)
      cleanup = () => home.destroy()
      await home.ready
      return
    }
    if (route.kind === 'chat' || route.kind === 'chat-debug') {
      litRender(routeFrame(route, html`<mn-loading size="md" text=${t('Starting chat')}></mn-loading>`, options), host)
      await renderChatRoute(host, route, options, () => !destroyed)
      return
    }
    if (route.kind === 'ops-health') {
      const routeCleanup = await renderOpsHealthRoute(host, route, options, () => !destroyed)
      if (destroyed) routeCleanup()
      else cleanup = routeCleanup
      return
    }
    if (route.kind === 'settings' && options.settingsService) {
      const routeCleanup = await renderSettingsRoute(
        host, route, options, () => !destroyed, checkout, topUpPreselectFromUrl(asUrl(locationLike)),
      )
      if (destroyed) routeCleanup()
      else cleanup = routeCleanup
      return
    }
    if (route.kind === 'choreograph') {
      cleanup = await renderChoreographRoute(host, route, options, () => !destroyed)
      return
    }
    renderSyncRoute(host, route, options)
  })()

  return {
    route,
    ready,
    destroy() {
      destroyed = true
      cleanup?.()
      litRender(nothing, host)
      host.replaceChildren()
    },
  }
}
