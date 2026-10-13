/**
 * The shell's answer to the chat's "Add credits" (`sh-chat-add-credits`).
 *
 * The chat does not sell credits. Its refusal banner and its balance line raise one event and
 * say what the person needs to know; the shell takes the person to Settings, Billing with the
 * amount that covers the need already armed. These tests hold that answer: the URL it builds,
 * the event it listens for, and the whole trip through the REAL Settings overlay, the REAL
 * settings route, the REAL HostedBilling and a real loopback gateway (no fakes: the only
 * hand-written things are the two ports a browser owns, "open in place" and "navigate").
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import { CHAT_ADD_CREDITS_EVENT, type ChatAddCreditsDetail } from '@shrubbery/runtime'
import { detectOrganismAppRoute, mountOrganismAppRoute } from '../app-routes.js'
import { topUpPreselectFromUrl } from '../add-credits.js'
import { billingSettingsUrl, connectChatCredits } from '../chat-credits.js'
import { HostedBilling } from '../hosted-billing.js'
import { createDefaultSettingsService } from '../settings-service.js'
import { createSettingsOverlayTransition } from '../settings-overlay-transition.js'
import { BillingGateway } from './support/billing-gateway.js'

const WORKSPACE = new URL('https://garden.test/?graph=atelier')

const refusal = (balanceMicroUsd: number | null, requiredMicroUsd: number | null): ChatAddCreditsDetail =>
  ({ source: 'refusal', balanceMicroUsd, requiredMicroUsd })

describe('where "Add credits" goes', () => {
  it('is Settings, Billing, on the amount that covers a refusal, and it keeps the way back', () => {
    const target = billingSettingsUrl(WORKSPACE, 'atelier', refusal(3_800, 6_168))

    expect(target.pathname).toBe('/settings')
    expect(detectOrganismAppRoute(target)).toEqual({ kind: 'settings', sectionId: 'billing' })
    expect(topUpPreselectFromUrl(target)).toBe(10)
    // The same URL the gear builds for this workspace, so the person comes back to it: the cell
    // graph Settings must keep, and where to return to.
    expect(target.searchParams.get('source')).toBe('cell')
    expect(target.searchParams.get('graph')).toBe('atelier')
    expect(target.searchParams.get('returnTo')).toBe('/?graph=atelier')
  })

  it('arms the smallest preset that covers the shortfall, not just the default', () => {
    expect(topUpPreselectFromUrl(billingSettingsUrl(WORKSPACE, 'atelier', refusal(0, 23_000_000)))).toBe(25)
    expect(topUpPreselectFromUrl(billingSettingsUrl(WORKSPACE, 'atelier', refusal(1_000_000, 44_000_000)))).toBe(50)
  })

  it('says $10 when nothing is known, and never more than the most one top-up may be', () => {
    expect(topUpPreselectFromUrl(billingSettingsUrl(WORKSPACE, 'atelier', refusal(null, null)))).toBe(10)
    expect(topUpPreselectFromUrl(billingSettingsUrl(WORKSPACE, 'atelier', { source: 'balance-line', balanceMicroUsd: 0, requiredMicroUsd: 6_168 }))).toBe(10)
    expect(topUpPreselectFromUrl(billingSettingsUrl(WORKSPACE, 'atelier', refusal(0, 900_000_000)))).toBe(200)
  })

  it('arms nothing for "Details" on the credits notice: looking is not buying', () => {
    const target = billingSettingsUrl(WORKSPACE, 'atelier', { source: 'notice', balanceMicroUsd: null, requiredMicroUsd: null })
    expect(detectOrganismAppRoute(target)).toEqual({ kind: 'settings', sectionId: 'billing' })
    expect(target.searchParams.has('topup')).toBe(false)
    expect(topUpPreselectFromUrl(target)).toBeNull()
  })

  it('is still Billing for a shell with no cell graph, and for a person who is already in Settings', () => {
    const noGraph = billingSettingsUrl(new URL('https://garden.test/'), null, refusal(null, null))
    expect(detectOrganismAppRoute(noGraph)).toEqual({ kind: 'settings', sectionId: 'billing' })
    expect(noGraph.searchParams.has('graph')).toBe(false)

    const inSettings = billingSettingsUrl(
      new URL('https://garden.test/settings?settings=account&returnTo=%2F%3Fgraph%3Datelier'),
      'atelier',
      refusal(null, null),
    )
    expect(detectOrganismAppRoute(inSettings)).toEqual({ kind: 'settings', sectionId: 'billing' })
    expect(inSettings.searchParams.get('returnTo')).toBe('/?graph=atelier')
  })
})

describe('the shell listens for the chat’s event', () => {
  const heard: Array<{ target: URL; focusReturn: HTMLElement | null }> = []
  const assigned: string[] = []
  let shell: HTMLElement
  let host: HTMLElement
  let opensInPlace = true

  beforeEach(() => {
    heard.length = 0
    assigned.length = 0
    opensInPlace = true
    shell = document.createElement('div')
    host = document.createElement('sh-chat-host')
    shell.appendChild(host)
    document.body.appendChild(shell)
  })
  afterEach(() => document.body.replaceChildren())

  const connect = () => connectChatCredits({
    host: shell,
    currentUrl: () => WORKSPACE,
    graphId: () => 'atelier',
    open: (target, focusReturn) => {
      if (opensInPlace) heard.push({ target, focusReturn })
      return opensInPlace
    },
    assign: path => { assigned.push(path) },
  })
  const raise = (detail: ChatAddCreditsDetail | null): void => {
    host.dispatchEvent(new CustomEvent(CHAT_ADD_CREDITS_EVENT, { detail, bubbles: true, composed: true }))
  }

  it('answers it by opening Billing in place, on the suggested amount, returning focus to where it was asked', () => {
    connect()
    raise(refusal(0, 23_000_000))

    expect(heard).toHaveLength(1)
    expect(detectOrganismAppRoute(heard[0].target)).toEqual({ kind: 'settings', sectionId: 'billing' })
    expect(topUpPreselectFromUrl(heard[0].target)).toBe(25)
    expect(heard[0].focusReturn).toBe(host)
    expect(assigned).toEqual([])
  })

  it('navigates when it cannot open in place, never leaving the person on a button that goes nowhere', () => {
    connect()
    opensInPlace = false
    raise(refusal(3_800, 6_168))

    expect(assigned).toHaveLength(1)
    const url = new URL(assigned[0], 'https://garden.test')
    expect(url.pathname).toBe('/settings')
    expect(url.searchParams.get('settings')).toBe('billing')
    expect(url.searchParams.get('topup')).toBe('10')
    expect(url.searchParams.get('graph')).toBe('atelier')
  })

  it('opens Billing plain for an event that says nothing: asking to add credits is never wrong', () => {
    connect()
    raise(null)
    expect(heard).toHaveLength(1)
    expect(detectOrganismAppRoute(heard[0].target)).toEqual({ kind: 'settings', sectionId: 'billing' })
    expect(topUpPreselectFromUrl(heard[0].target)).toBe(10)
  })

  it('stops listening when the shell lets go', () => {
    const disconnect = connect()
    disconnect()
    raise(refusal(0, 23_000_000))
    expect(heard).toEqual([])
    expect(assigned).toEqual([])
  })
})

describe('the whole trip, through the real Settings overlay', () => {
  const gateway = new BillingGateway()
  beforeAll(async () => { await gateway.start() })
  afterAll(async () => { await gateway.stop() })
  beforeEach(() => { gateway.reset() })
  afterEach(() => document.body.replaceChildren())

  async function until(check: () => boolean, timeoutMs = 4_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!check()) {
      if (Date.now() > deadline) throw new Error('condition not reached')
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }

  it('opens Billing over the live workspace with the amount armed and the workspace left alive underneath', async () => {
    const workspace = document.createElement('main')
    const chat = document.createElement('sh-chat-host')
    const draft = document.createElement('textarea')
    draft.value = 'a message the refusal kept'
    workspace.append(chat, draft)
    const surface = document.createElement('div')
    surface.append(workspace)
    document.body.append(surface)

    const billing = new HostedBilling({ userId: () => 'alice', token: () => 'id-token' }, gateway.base, undefined, undefined, { storage: null })
    const settingsService = createDefaultSettingsService({ runtimeMode: 'hosted', billing })
    const overlay = createSettingsOverlayTransition({
      host: surface,
      history: window.history,
      mount: (routeHost, location, onClose) => mountOrganismAppRoute(routeHost, { location, settingsService, onClose }),
    })
    const disconnect = connectChatCredits({
      host: surface,
      currentUrl: () => new URL(window.location.href),
      graphId: () => 'atelier',
      open: (target, focusReturn) => overlay.open(target, { focusReturn }),
      assign: path => { throw new Error(`should have opened in place, not navigated to ${path}`) },
    })

    chat.dispatchEvent(new CustomEvent(CHAT_ADD_CREDITS_EVENT, {
      detail: refusal(0, 23_000_000), bubbles: true, composed: true,
    }))

    await until(() => document.querySelector('mn-add-credits')?.shadowRoot?.querySelector('[data-amount="25"]') != null)
    expect(overlay.isOpen).toBe(true)
    const panel = document.querySelector('mn-add-credits')!.shadowRoot!
    expect(panel.querySelector('[data-amount="25"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(panel.querySelector('[data-amount="10"]')!.getAttribute('aria-pressed')).toBe('false')
    expect(panel.querySelector<HTMLButtonElement>('[data-add-credits-submit]')!.textContent!.trim()).toBe('Add $25 in credits')
    // The chat and the words the person had kept are still in the page, only inert.
    expect(surface.contains(chat)).toBe(true)
    expect(draft.value).toBe('a message the refusal kept')
    expect(surface.inert).toBe(true)

    // Let what Billing asked of the gateway finish before the server goes away with the test.
    await until(() => ['balance', 'subscription', 'usage', 'credits/history'].every(path => gateway.paths().includes(`GET /billing/${path}`)))
    await new Promise(resolve => setTimeout(resolve, 100))

    disconnect()
    overlay.destroy()
  })
})
