// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'

import { createGreenhouseService, readGreenhouseConfig } from '../greenhouse-service.js'
import { createGreenhouseStore } from '../greenhouse-store.js'
import '../greenhouse-app.js'
import type { GreenhouseApp } from '../greenhouse-app.js'

;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings ??= new Set()
;(globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings!.add('dev-mode')

afterEach(() => {
  document.body.replaceChildren()
  document.head.replaceChildren()
})

function mountedApp(baseUrl: string): GreenhouseApp {
  const config = readGreenhouseConfig(`?baseUrl=${encodeURIComponent(baseUrl)}&pollMs=1000`)
  const app = document.createElement('greenhouse-app') as GreenhouseApp
  app.config = config
  app.service = createGreenhouseService(config)
  app.store = createGreenhouseStore(config, app.service)
  document.body.append(app)
  return app
}

async function waitForText(app: GreenhouseApp, text: string): Promise<void> {
  const expected = text.toLowerCase()
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await app.updateComplete
    if (app.shadowRoot?.textContent?.toLowerCase().includes(expected)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for mounted greenhouse text: ${text}`)
}

describe('GreenhouseApp mounted element', () => {
  it('renders the designed dark stack against an unreachable live base URL', async () => {
    const app = mountedApp('http://127.0.0.1:1')

    await waitForText(app, 'nothing is verified')

    // The dark stack repeats the smoke script's own honest sentence and names the relighting command.
    expect(app.shadowRoot?.textContent?.toLowerCase()).toContain('stack dark — nothing is verified')
    expect(app.shadowRoot?.textContent).toContain('pnpm --dir apps/greenhouse stack:start')
    expect(app.shadowRoot?.textContent).toContain('127.0.0.1:1')
  })

  it('the palette has zero standing pixels and raises on ⌘O over a dimmed surface', async () => {
    const app = mountedApp('http://127.0.0.1:1')
    await waitForText(app, 'nothing is verified')

    // Zero standing pixels: nothing of the palette renders while it is closed.
    expect(app.shadowRoot?.querySelector('.gh-palette-overlay')).toBeNull()
    expect(app.shadowRoot?.querySelector('.shell')?.classList.contains('dimmed')).toBe(false)
    // The topbar keeps the one quiet hook hint.
    expect(app.shadowRoot?.textContent).toContain('⌘O')

    // ⌘O raises the palette; the surface under it is dimmed.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', metaKey: true }))
    await app.updateComplete
    const palette = app.shadowRoot?.querySelector('.gh-palette-overlay')
    expect(palette).not.toBeNull()
    expect(app.shadowRoot?.querySelector('.shell')?.classList.contains('dimmed')).toBe(true)
    // Its rows are the query, and the hint bar names the gestures.
    expect(app.shadowRoot?.querySelector('.gh-query-input')).not.toBeNull()
    expect(app.shadowRoot?.querySelector('.gh-hintbar')?.textContent).toContain('hook')

    // esc closes it and returns to zero standing pixels.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await app.updateComplete
    expect(app.shadowRoot?.querySelector('.gh-palette-overlay')).toBeNull()
    expect(app.shadowRoot?.querySelector('.shell')?.classList.contains('dimmed')).toBe(false)
  })
})
