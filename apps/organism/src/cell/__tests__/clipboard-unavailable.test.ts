/**
 * Copy actions on a plain-HTTP page say why they cannot copy (NO MOCKS: the real settings
 * action and the real ops-health route, on a page whose navigator has no clipboard).
 *
 * `navigator.clipboard` exists only in secure contexts (HTTPS, localhost). On the warehouse
 * LAN (http://mithras-data.local:8100) it is absent; a copy button must neither fail silently
 * nor throw where nothing catches it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import type { MnOpsHealthPage } from '@shrubbery/components'
import { mountOrganismAppRoute } from '../app-routes.js'
import { createShellContext } from '../shell-context.js'
import { settingsAction } from '../shell-features.js'

const UNAVAILABLE = /only over HTTPS or on localhost/

describe('copy actions with no clipboard (a plain-HTTP page)', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  })
  afterEach(() => {
    delete (navigator as { clipboard?: unknown }).clipboard
  })

  it('Settings › Copy API URL rejects with the reason and the URL, for the settings page to show', async () => {
    expect(navigator.clipboard).toBeUndefined()
    const context = createShellContext({
      host: document.body,
      graphId: 'atelier',
      documentId: null,
      app: 'garden',
      source: 'CELL_LIVE',
      deploymentMode: 'playground',
      contract: null,
      location: new URL('http://mithras-data.local:8100/'),
      rerender: () => undefined,
    })
    const copying = settingsAction(context, { sectionId: 'account', actionId: 'copy-api-url' } as never, 'http://mithras-data.local:8100/cell', '')
    await expect(copying).rejects.toThrow(UNAVAILABLE)
    await expect(copying).rejects.toThrow('http://mithras-data.local:8100/cell')
  })

  it('Ops Health › Copy JSON shows the reason on the page', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const mount = mountOrganismAppRoute(host, {
      location: new URL('http://mithras-data.local:8100/ops-health'),
      clipboard: navigator.clipboard ?? null,
    })
    await mount!.ready
    const page = host.querySelector('mn-ops-health-page') as MnOpsHealthPage
    await page.updateComplete
    page.dispatchEvent(new CustomEvent('mn-ops-health-copy-json', {
      detail: { snapshot: { overall_status: 'ok', generated_at: '2026-10-07T00:00:00Z' } },
      bubbles: true,
      composed: true,
    }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(page.error).toMatch(UNAVAILABLE)
    mount!.destroy()
    host.remove()
  })
})
