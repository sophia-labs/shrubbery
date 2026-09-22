/**
 * observatory-shell-smoke.test.ts — THE RHIZOME SHELL render smoke (happy-dom).
 *
 * Guards the SHARED icon port (which touched @shrubbery/components, used by both
 * emporium AND rhizome) end-to-end through THE RHIZOME observatory shell. NO MOCK:
 * it drives the REAL render path the browser shell (main.ts) uses —
 * `renderWorkspace(RHIZOME)` stamps + upgrades the REAL <mn-app-bar>, then the
 * shell brands it ('Rhizome'), exactly as main.ts does — and inspects the REAL
 * shadow DOM. It asserts the icon port landed in the shell chrome:
 *
 *   (a) the top bar renders <svg> icons for the theme / skin / settings actions,
 *   (b) NO emoji codepoint survives in the rendered shell output,
 *   (c) the brand text is "Rhizome" (the shell brand), NOT the bar default "App".
 *
 * The chrome assertions need NO cell (pure DOM). A SECOND block renders the
 * POPULATED <rz-observatory> over the SAME render-dom path against the REAL cell,
 * self-skipping (NO-MOCK, not faked) when the cell is unreachable.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import '../rz-observatory.js'
import { renderWorkspace } from '@shrubbery/runtime'
import { RHIZOME } from '../rhizome-config.js'
import { GardenClient } from '../garden-client.js'
import { MemoryWorld } from '../memory-world.js'
import type { MemoryRecord } from '@shrubbery/render'
import { renderPlotDomString } from '../render-dom.js'

// The emoji literals the chrome bars carried BEFORE the icon port (must all be gone).
const EMOJI = ['☀️', '🌙', '👁', '⚙', '🌱', '⧉', '⌕', '✕', '◆', '🪟']

/** Deep text inside an (open) shadow root — emoji would surface here as text. */
function shadowText(root: ShadowRoot): string {
  return root.textContent ?? ''
}

/** The top bar's action button identified by its aria-label prefix. */
function actionBtn(root: ShadowRoot, label: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll('.action-btn')).find(
    (el) => el.getAttribute('aria-label')?.startsWith(label),
  ) as HTMLButtonElement | undefined
}

describe('RHIZOME shell smoke — top bar icons, no emoji, brand "Rhizome"', () => {
  it('stamps mn-app-bar, brands it "Rhizome", renders svg actions, no emoji', async () => {
    // Drive the SAME render path main.ts uses: render the workspace frame into a
    // mounted host (Lit elements settle only when connected) and lift the bar.
    const host = document.createElement('div')
    document.body.appendChild(host)
    renderWorkspace(RHIZOME, { container: host })

    // The top bar is mn-app-bar (RHIZOME config region-top-bar renderedByComponent).
    const bar = host.querySelector('mn-app-bar') as
      | (HTMLElement & {
          brand?: string
          glyph?: string
          badge?: string
          updateComplete?: Promise<unknown>
        })
      | null
    expect(bar, 'renderWorkspace must stamp + upgrade an <mn-app-bar>').toBeTruthy()

    // BRAND it exactly as the shell (main.ts) does.
    bar!.brand = 'Rhizome'
    bar!.glyph = 'sprout'
    bar!.badge = 'observatory'
    await bar!.updateComplete

    const root = bar!.shadowRoot!

    // (a) the theme / skin / settings actions each render an inline <svg>.
    expect(actionBtn(root, 'Toggle theme')?.querySelector('svg')).toBeTruthy()
    expect(actionBtn(root, 'Visual style')?.querySelector('svg')).toBeTruthy()
    expect(actionBtn(root, 'Settings')?.querySelector('svg')).toBeTruthy()
    // The masthead brand glyph (sprout) is an svg too, not an emoji.
    expect(root.querySelector('.masthead-glyph svg')).toBeTruthy()
    // ≥ 4 icons total (theme, skin, settings, masthead) — search adds a 5th.
    expect(root.querySelectorAll('svg').length).toBeGreaterThanOrEqual(4)

    // (b) NO emoji codepoint survives anywhere in the rendered shell.
    const text = shadowText(root)
    for (const e of EMOJI) {
      expect(text.includes(e), `emoji ${e} should be gone from the shell chrome`).toBe(false)
    }

    // (c) the brand text is "Rhizome" (the shell brand), not the bar default "App".
    const name = root.querySelector('.masthead-name')?.textContent?.trim()
    expect(name, 'masthead must read the shell brand').toBe('Rhizome')
    expect(name).not.toBe('App')

    document.body.removeChild(host)
  })
})

// ── The POPULATED observatory over the REAL cell (NO-MOCK, self-skips if down) ──
const GRAPH = process.env.RHIZOME_GRAPH ?? '6a1eabeb-agentic'
const client = new GardenClient() // node-http, 127.0.0.1:7090, bench-token
const world = new MemoryWorld(client, GRAPH)
let cellUp = false
beforeAll(async () => {
  cellUp = await client.health()
})

describe('RHIZOME shell smoke — populated observatory (live cell)', () => {
  it('renders THE PLOT through the shell render path with no emoji in the chrome', async (ctx) => {
    if (!cellUp) {
      console.warn(`[shell-smoke] cell at ${client.base} is down — skipping (NO MOCK).`)
      ctx.skip(`[shell-smoke] cell at ${client.base} is down (NO MOCK).`)
    }
    const plot = await world.plot(null)
    const chains = new Map<string, readonly MemoryRecord[]>()
    for (const s of plot.subjects) {
      const sub = await world.subject(s.rootId, null)
      if (sub) chains.set(s.rootId, sub.records)
    }
    const html = await renderPlotDomString(plot, chains)
    // The observatory body rendered real content (a bloomed head) …
    expect(html).toMatch(/class="bloom-content"/)
    // … and carries no emoji codepoint in the deep HTML.
    for (const e of EMOJI) {
      expect(html.includes(e), `emoji ${e} should be gone from the observatory`).toBe(false)
    }
  }, 30_000)
})
