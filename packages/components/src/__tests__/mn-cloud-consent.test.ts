/**
 * REAL component tests - Garden cloud/consent surfaces lifted as controlled UI.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-consent-banner.js'
import '../mn-cloud-mode-pill.js'
import '../mn-cloud-mode-panel.js'
import type { MnConsentBanner, MnConsentChoiceDetail } from '../mn-consent-banner.js'
import type { MnCloudModePanel, MnCloudModeActionDetail } from '../mn-cloud-mode-panel.js'
import type { MnCloudModePill, MnCloudModePillOpenDetail } from '../mn-cloud-mode-pill.js'

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mountConsent(setup?: (el: MnConsentBanner) => void): Promise<MnConsentBanner> {
  const el = document.createElement('mn-consent-banner') as MnConsentBanner
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountPill(setup?: (el: MnCloudModePill) => void): Promise<MnCloudModePill> {
  const el = document.createElement('mn-cloud-mode-pill') as MnCloudModePill
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

async function mountPanel(setup?: (el: MnCloudModePanel) => void): Promise<MnCloudModePanel> {
  const el = document.createElement('mn-cloud-mode-panel') as MnCloudModePanel
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-consent-banner / mn-cloud-mode-pill / mn-cloud-mode-panel', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('registers the Garden cloud and consent tags', () => {
    expect(customElements.get('mn-consent-banner')).toBeDefined()
    expect(customElements.get('mn-cloud-mode-pill')).toBeDefined()
    expect(customElements.get('mn-cloud-mode-panel')).toBeDefined()
  })

  it('mn-consent-banner renders only while pending and emits accept/decline intents', async () => {
    const el = await mountConsent(node => {
      node.privacyHref = '/privacy-policy'
    })
    const choices: MnConsentChoiceDetail[] = []
    const accepted: MnConsentChoiceDetail[] = []
    const declined: MnConsentChoiceDetail[] = []
    el.addEventListener('mn-consent-choice', event => {
      choices.push((event as CustomEvent<MnConsentChoiceDetail>).detail)
    })
    el.addEventListener('mn-consent-accept', event => {
      accepted.push((event as CustomEvent<MnConsentChoiceDetail>).detail)
    })
    el.addEventListener('mn-consent-decline', event => {
      declined.push((event as CustomEvent<MnConsentChoiceDetail>).detail)
    })

    expect(sr(el).querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Analytics consent')
    expect(sr(el).querySelector('a')?.getAttribute('href')).toBe('/privacy-policy')

    ;(sr(el).querySelector('.primary') as HTMLButtonElement).click()
    ;(sr(el).querySelector('.secondary') as HTMLButtonElement).click()

    expect(choices).toEqual([{ choice: 'accepted' }, { choice: 'declined' }])
    expect(accepted).toEqual([{ choice: 'accepted' }])
    expect(declined).toEqual([{ choice: 'declined' }])

    el.consentState = 'accepted'
    await el.updateComplete
    expect(sr(el).querySelector('[role="dialog"]')).toBeNull()
  })

  it('mn-cloud-mode-pill maps hosted status to label, class, and open intent', async () => {
    const el = await mountPill(node => {
      node.mode = 'hosted'
      node.status = 'stale'
    })
    const opens: MnCloudModePillOpenDetail[] = []
    el.addEventListener('mn-cloud-mode-open', event => {
      opens.push((event as CustomEvent<MnCloudModePillOpenDetail>).detail)
    })

    const button = sr(el).querySelector('button')!
    expect(button.className).toBe('stale')
    expect(button.textContent).toContain('Reconnecting')
    expect(button.getAttribute('aria-label')).toBe('Mode: Reconnecting')
    expect(button.getAttribute('title')).toBe('Sophia Cloud - click to manage')

    button.click()
    expect(opens).toEqual([{ mode: 'hosted', status: 'stale' }])

    el.mode = 'local'
    await el.updateComplete
    expect(sr(el).querySelector('button')?.className).toBe('local')
    expect(sr(el).querySelector('button')?.textContent).toContain('Local')
  })

  it('mn-cloud-mode-panel renders local mode and emits connect and close intents', async () => {
    const el = await mountPanel(node => {
      node.open = true
      node.mode = 'local'
      node.os = 'mac'
    })
    const connects: MnCloudModeActionDetail[] = []
    const closes: MnCloudModeActionDetail[] = []
    el.addEventListener('mn-connect', event => {
      connects.push((event as CustomEvent<MnCloudModeActionDetail>).detail)
    })
    el.addEventListener('mn-close', event => {
      closes.push((event as CustomEvent<MnCloudModeActionDetail>).detail)
    })

    expect(sr(el).querySelector('[role="dialog"]')?.textContent).toContain('Running locally on this Mac')
    ;(sr(el).querySelector('.primary') as HTMLButtonElement).click()
    ;(sr(el).querySelector('.close') as HTMLButtonElement).click()

    expect(connects).toEqual([{ action: 'connect', mode: 'local', signInState: 'signed-out' }])
    expect(closes).toEqual([{ action: 'close', mode: 'local', signInState: 'signed-out' }])
  })

  it('mn-cloud-mode-panel renders hosted account state and emits local/sign-out aliases', async () => {
    const expiresAt = Date.now() + 90 * 60_000
    const el = await mountPanel(node => {
      node.open = true
      node.mode = 'hosted'
      node.signInState = 'connected'
      node.userEmail = 'vera@example.com'
      node.expiresAt = expiresAt
    })
    const switchLocal: MnCloudModeActionDetail[] = []
    const signOuts: MnCloudModeActionDetail[] = []
    el.addEventListener('mn-cloud-mode-switch-local', event => {
      switchLocal.push((event as CustomEvent<MnCloudModeActionDetail>).detail)
    })
    el.addEventListener('mn-cloud-mode-sign-out', event => {
      signOuts.push((event as CustomEvent<MnCloudModeActionDetail>).detail)
    })

    const text = sr(el).querySelector('[role="dialog"]')!.textContent!
    expect(text).toContain('Sophia Cloud')
    expect(text).toContain('Connected')
    expect(text).toContain('vera@example.com')
    expect(text).toContain('Token expires in')

    ;(sr(el).querySelector('.danger') as HTMLButtonElement).click()
    ;(sr(el).querySelector('.ghost') as HTMLButtonElement).click()

    expect(switchLocal).toEqual([{ action: 'switch-local', mode: 'hosted', signInState: 'connected' }])
    expect(signOuts).toEqual([{ action: 'sign-out', mode: 'hosted', signInState: 'connected' }])
  })
})
