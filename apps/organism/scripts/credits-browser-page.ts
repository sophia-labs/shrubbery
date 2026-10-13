/**
 * The page behind `credits-browser-harness.mts`: the credits release's two halves, mounted the way the
 * shell mounts them, over a scripted gateway on the other side of a real socket.
 *
 *   scene=chat      The REAL `<sh-chat-host>` over the REAL hosted chat service, given the SAME `credits`
 *                   grant `main.ts` gives it (the balance line, "Add credits", the credits notice), with the
 *                   SAME `connectChatCredits` listening for its event and the SAME Settings overlay the gear
 *                   opens, over the REAL settings route, the REAL `HostedBilling` and a real gateway.
 *   scene=settings  The REAL Settings route on Billing (Add credits, Credit history, the notice, a Stripe
 *                   return when `checkout=success|cancel` is asked for), full page.
 *   skin=<id>       The visual style the page starts in (Garden unless named). The skin picker in the Settings
 *                   route's bar, and the Skin drop-down in Settings, Appearance, are the REAL ones; what
 *                   this page adds is the shell's end of them, which it has to play because the shell is
 *                   not here: it hears `mn-skin-select` (the bar's picker) and the Skin setting (the drop-down)
 *                   and applies the skin the way `main.ts` does (`applySkinTheme`, then every bar told).
 *
 * Nothing here stands in for the code under test. The only hand-written things are the two ports a
 * browser owns: "leave for Stripe" is recorded instead of followed (the harness plays the return
 * itself), and the gateway's answers, which come from the harness's own socket. The token is a
 * placeholder: the gateway asks nobody who they are.
 */
import '@shrubbery/tokens/tokens.css'
import '@shrubbery/components'
import { html, render } from 'lit'
import { applySkinTheme, effectiveTheme, isVisualIdentitySkin, type VisualIdentitySkin } from '@shrubbery/tokens'
import { makeHostedChatService, mountChatHost, type ChatHostCredits } from '@shrubbery/runtime'
import { ensureActiveChatSession } from '../src/cell/active-chat-session.js'
import { mountOrganismAppRoute } from '../src/cell/app-routes.js'
import { connectChatCredits } from '../src/cell/chat-credits.js'
import { createCreditsNoticeSource } from '../src/cell/credits-notice.js'
import { HostedBilling } from '../src/cell/hosted-billing.js'
import { createSettingsOverlayTransition } from '../src/cell/settings-overlay-transition.js'
import { createDefaultSettingsService } from '../src/cell/settings-service.js'

declare global {
  interface Window {
    __credits?: {
      ready: boolean
      error?: string
      sessionId?: string
      /** Where the browser would have gone to pay. Recorded, never followed. */
      stripe: string[]
      /** Where the Settings route asked to scrub the URL to after a Stripe return. */
      replaced: string[]
      /** How many times the Settings route was asked to close. */
      closed: number
      /** The visual style that is applied now. */
      skin: string
      /** Every skin the chrome's picker said it was choosing (`mn-skin-select`), in order, as it said it. */
      skinEvents: string[]
    }
  }
}

const params = new URL(location.href).searchParams
const scene = params.get('scene') ?? 'chat'
const gateway = (params.get('gateway') ?? '').replace(/\/+$/, '')
const graph = params.get('graph') ?? 'atelier-20261003'
const user = params.get('user') ?? 'harness-user'
const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
const skinParam = params.get('skin')
let currentSkin: VisualIdentitySkin = isVisualIdentitySkin(skinParam) ? skinParam : 'garden'
const topup = params.get('topup')
const checkout = params.get('checkout')
const poll = (params.get('poll') ?? '200:30').split(':').map(Number)

window.__credits = { ready: false, stripe: [], replaced: [], closed: 0, skin: currentSkin, skinEvents: [] }

/** Tell every Sophia top bar which skin and theme are on (the shell's `reflectChromeState`). */
function reflectChrome(): void {
  for (const bar of document.querySelectorAll<HTMLElement & { isDark?: boolean; activeSkin?: string }>('mn-top-bar')) {
    // A light-only skin (Mithras) renders light whatever the preference says.
    bar.isDark = effectiveTheme(currentSkin, theme) === 'dark'
    bar.activeSkin = currentSkin
  }
}

/** Stamp the skin and theme on the page and on the chrome (the shell's `applyCurrent`). */
function applyCurrent(): void {
  for (const target of [document.documentElement, document.body]) applySkinTheme({ skin: currentSkin, theme, target })
  window.__credits!.skin = currentSkin
  reflectChrome()
}
applyCurrent()

/** The chrome's picker speaks with ONE composed event; the shell applies what it names, and ignores a name that is no skin. */
document.addEventListener('mn-skin-select', event => {
  const chosen = (event as CustomEvent<{ skin?: unknown }>).detail?.skin
  window.__credits!.skinEvents.push(String(chosen))
  if (!isVisualIdentitySkin(chosen)) return
  currentSkin = chosen
  applyCurrent()
})

const auth = { userId: () => user, token: () => 'harness-token' }
// The notice, the fee and the gate's mode are what the gateway says on the balance (Vera, 2026-10-03): nothing
// about them is configured here.
const billing = new HostedBilling(
  auth,
  gateway,
  undefined,
  url => { window.__credits!.stripe.push(url) },
)
const settingsService = createDefaultSettingsService({
  runtimeMode: 'hosted',
  billing,
  userName: user,
  // The Skin drop-down in Settings, Appearance (the phone's way to a skin) reports its choice here; the shell
  // applies it, and so does this page.
  onPreferenceChange: detail => {
    if (detail.settingId !== 'skin' || !('value' in detail) || !isVisualIdentitySkin(detail.value)) return
    currentSkin = detail.value
    applyCurrent()
  },
})

/** The Settings route, mounted the way the shell mounts it (`organismAppRouteOptions` in main.ts). */
function mountSettings(routeHost: HTMLElement, location: URL, onClose: () => void) {
  const mount = mountOrganismAppRoute(routeHost, {
    location,
    settingsService,
    onClose: () => { window.__credits!.closed += 1; onClose() },
    replaceUrl: next => { window.__credits!.replaced.push(`${next.pathname}${next.search}`) },
    checkoutPlanPoll: { intervalMs: poll[0] || 200, attempts: poll[1] || 30 },
  })
  // A route's bar shows the live skin too: the shell reflects the chrome once the route is mounted and again once it is ready.
  reflectChrome()
  void mount?.ready.then(reflectChrome)
  return mount
}

async function mountChatScene(): Promise<void> {
  if (!gateway) throw new Error('no ?gateway= given')
  const service = makeHostedChatService({
    gatewayBaseUrl: gateway,
    graphBaseUrl: (id: string) => `${gateway}/g/${encodeURIComponent(id)}`,
    graphId: () => graph,
    userId: () => user,
    token: () => 'harness-token',
    storage: window.localStorage,
  })
  const sessionId = await ensureActiveChatSession(service, { title: 'organism-chat', graphId: graph })

  // What main.ts hands the chat host for a hosted account.
  const credits: ChatHostCredits = {
    showBalance: true,
    canAddCredits: true,
    notice: createCreditsNoticeSource({ userId: () => user }),
  }
  const surface = document.getElementById('surface')!
  const rail = document.getElementById('rail')!
  render(html`${mountChatHost(service, sessionId, { presentation: 'rail', credits }) as never}`, rail)

  // And the shell's end of the seam: the same overlay the gear opens, the same listener.
  const overlay = createSettingsOverlayTransition({
    host: surface,
    history: window.history,
    mount: (routeHost, location, onClose) => mountSettings(routeHost, location, onClose),
  })
  connectChatCredits({
    host: surface,
    currentUrl: () => new URL(window.location.href),
    graphId: () => graph,
    open: (target, focusReturn) => overlay.open(target, { focusReturn }),
    assign: path => { window.location.assign(path) },
  })
  window.__credits = { ...window.__credits!, ready: true, sessionId }
}

async function mountSettingsScene(): Promise<void> {
  const root = document.getElementById('settings-root')!
  document.getElementById('surface')!.hidden = true
  root.hidden = false
  const location = new URL('/settings', window.location.href)
  location.searchParams.set('settings', 'billing')
  if (topup) location.searchParams.set('topup', topup)
  if (checkout) location.searchParams.set('checkout', checkout)
  const mount = mountSettings(root, location, () => undefined)
  if (!mount) throw new Error('Settings route did not mount')
  await mount.ready
  window.__credits = { ...window.__credits!, ready: true }
}

;(scene === 'settings' ? mountSettingsScene() : mountChatScene()).catch(error => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const failure = document.getElementById('settings-failure')!
  failure.hidden = false
  failure.textContent = message
  window.__credits = { ...window.__credits!, ready: true, error: message }
})
