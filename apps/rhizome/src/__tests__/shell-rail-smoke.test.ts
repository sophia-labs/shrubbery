/**
 * shell-rail-smoke.test.ts — THE INTEGRATED SHELL render smoke (happy-dom).
 *
 * Guards the refactor to ONE integrated shell with a LEFT RAIL. NO MOCK: it drives
 * the REAL render path the browser shell (main.ts) uses, against REAL components +
 * REAL Plot data from the live cell, and inspects the REAL (shadow) DOM:
 *
 *   (1) FRAME — `renderWorkspace(RHIZOME)` stamps the LEFT RAIL region
 *       (region-rail → <rz-rail>) AND the content host region
 *       (region-observatory → <rz-shell>), both upgrading in place.
 *   (2) PLOT SURFACE — an <rz-shell> with surface='plot' + real Plot props renders
 *       the beds (the bloomed 25:50 head is present), and the cross-surface
 *       scrubber is rendered ONCE by the shell.
 *   (3) SURFACE SWITCH — flipping surface='walk' swaps the body to <rz-walk>: the
 *       plot grid (the beds) is GONE; with a walk index fed in, the run list shows.
 *
 * Block (1) needs NO cell (pure DOM frame). Blocks (2)/(3) read the REAL cell and
 * self-SKIP (NO-MOCK, not faked) when it is unreachable.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import '@shrubbery/components'
import '../rz-rail.js'
import '../rz-shell.js'
import { renderWorkspace } from '@shrubbery/runtime'
import { RHIZOME } from '../rhizome-config.js'
import { GardenClient } from '../garden-client.js'
import { MemoryWorld } from '../memory-world.js'
import type { MemoryRecord } from '@shrubbery/render'
import { deepHtml } from '../render-dom.js'
import type { RzShell } from '../rz-shell.js'

/** Settle an element + its (lifted) descendants over several passes. */
async function flush(el: HTMLElement): Promise<void> {
  for (let pass = 0; pass < 5; pass++) {
    const els = [el, ...Array.from(el.querySelectorAll('*'))] as Array<
      HTMLElement & { updateComplete?: Promise<unknown> }
    >
    let any = false
    for (const e of els) {
      if (e.updateComplete) {
        any = true
        await e.updateComplete
      }
    }
    if (!any) break
  }
}

describe('INTEGRATED SHELL — frame stamps the left rail + the content host', () => {
  it('renderWorkspace(RHIZOME) stamps region-rail(rz-rail) + region-observatory(rz-shell)', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    renderWorkspace(RHIZOME, { container: host })

    // The top bar chrome is still present (the brand bar).
    expect(host.querySelector('header[data-region="region-top-bar"] mn-app-bar')).not.toBeNull()

    // The LEFT RAIL is a chrome rail pane inside .main, to the left of the spine.
    const railPane = host.querySelector('.rail-pane[data-region="region-rail"]')
    expect(railPane, 'the left-rail chrome pane must render inside .main').not.toBeNull()
    expect(railPane!.querySelector('rz-rail'), 'region-rail stamps <rz-rail>').not.toBeNull()

    // The single resizable spine head stamps the content host <rz-shell>.
    const spinePane = host.querySelector('.split-pane[data-region="region-observatory"]')
    expect(spinePane, 'the observatory spine head must render').not.toBeNull()
    expect(spinePane!.querySelector('rz-shell'), 'region-observatory stamps <rz-shell>').not.toBeNull()

    // The OLD direct rz-observatory stamping is gone (it now lives inside rz-shell).
    expect(host.querySelector('.split-pane[data-region="region-observatory"] > rz-observatory')).toBeNull()

    document.body.removeChild(host)
  })
})

// ── The populated shell over the REAL cell (NO-MOCK, self-skips if down) ────────
const GRAPH = process.env.RHIZOME_GRAPH ?? '6a1eabeb-agentic'
const client = new GardenClient()
const world = new MemoryWorld(client, GRAPH)
let cellUp = false
beforeAll(async () => {
  cellUp = await client.health()
})

describe('INTEGRATED SHELL — surface switching (Plot ↔ Walk) over the live cell', () => {
  it('surface=plot renders the beds (25:50 bloomed); surface=walk swaps to the rz-walk stub', async (ctx) => {
    if (!cellUp) {
      console.warn(`[shell-rail-smoke] cell at ${client.base} is down — skipping (NO MOCK).`)
      ctx.skip(`[shell-rail-smoke] cell at ${client.base} is down (NO MOCK).`)
    }

    // Live read (now): the resolved plot + each bed's full chain (the soil).
    const plot = await world.plot(null)
    const chains = new Map<string, readonly MemoryRecord[]>()
    for (const s of plot.subjects) {
      const sub = await world.subject(s.rootId, null)
      if (sub) chains.set(s.rootId, sub.records)
    }
    expect(plot.subjects.some((s) => s.headContent.includes('25:50'))).toBe(true)

    // Build the REAL content host, feed it the REAL Plot props, surface=plot.
    const shell = document.createElement('rz-shell') as RzShell
    shell.surface = 'plot'
    shell.asof = null
    shell.plot = plot
    shell.chains = chains
    shell.openSubject = null
    document.body.appendChild(shell)
    await flush(shell)

    const plotHtml = deepHtml(shell)
    // The Plot surface rendered the beds: the 25:50 head BLOOMS, and the plot grid
    // (the bed section) is present.
    expect(plotHtml).toContain('25:50')
    expect(plotHtml, 'the 25:50 head must render in a bloom-content').toMatch(
      /class="bloom-content"[^>]*>[^<]*25:50/,
    )
    expect(plotHtml, 'the plot bed section must be present').toMatch(/data-plot/)
    // The cross-surface scrubber is rendered ONCE by the shell.
    const scrubbers = plotHtml.match(/data-scrubber/g) ?? []
    expect(scrubbers.length, 'exactly one scrubber (lifted into the shell)').toBe(1)

    // SWITCH to the Walk surface (with a walk index fed in): the body swaps to
    // <rz-walk>'s run list; the plot grid is GONE.
    shell.surface = 'walk'
    shell.walkIndex = {
      kind: 'walk-index',
      id: 'walk',
      title: 'The Walk — agentic-run traces',
      summary: 'the runs',
      runs: [
        {
          id: '1781976018654',
          question: 'What was my personal best time in the charity 5K run?',
          gold: '25:50',
          turnCount: 12,
          supersessionCount: 2,
          finalAnswer: 'Your personal best 5K time was 25:50.',
          supersededRoots: ['3c3734609b68'],
        },
      ],
    }
    await flush(shell)
    const walkHtml = deepHtml(shell)
    expect(walkHtml, 'the walk run list must be present').toMatch(/data-walk-index/)
    expect(walkHtml, 'the run row must render').toMatch(/data-run="1781976018654"/)
    expect(walkHtml, 'the plot grid must be GONE on the walk surface').not.toMatch(/data-plot/)

    document.body.removeChild(shell)
  }, 30_000)

  it('the REVERSE cross-link: a minted bed shows "open the Walk" + emits rz-open-run', async (ctx) => {
    if (!cellUp) {
      console.warn(`[shell-rail-smoke] cell at ${client.base} is down — skipping (NO MOCK).`)
      ctx.skip(`[shell-rail-smoke] cell at ${client.base} is down (NO MOCK).`)
    }
    const plot = await world.plot(null)
    const chains = new Map<string, readonly MemoryRecord[]>()
    for (const s of plot.subjects) {
      const sub = await world.subject(s.rootId, null)
      if (sub) chains.set(s.rootId, sub.records)
    }
    // The reverse join: the 5K bed (rootId 3c3734609b68 — the OLD record the
    // supersession run wrote over) → the run that minted it. Build it the way the app
    // shell does (from the run's supersededRoots). Pick a real bed the cell returned.
    const RUN = '1781976018654'
    const MINTED_BED = '3c3734609b68'
    const mintedBed = plot.subjects.find((s) => s.rootId === MINTED_BED)
    if (!mintedBed) {
      ctx.skip(`[shell-rail-smoke] bed ${MINTED_BED} not in this cell — skipped (NO MOCK).`)
      return
    }
    const mintedBy = new Map<string, string>([[MINTED_BED, RUN]])

    const shell = document.createElement('rz-shell') as RzShell
    shell.surface = 'plot'
    shell.asof = null
    shell.plot = plot
    shell.chains = chains
    shell.mintedBy = mintedBy
    shell.openSubject = null
    document.body.appendChild(shell)
    await flush(shell)

    const plotHtml = deepHtml(shell)
    // The affordance rendered for the minted bed only.
    expect(plotHtml, 'the minted bed must show "open the Walk"').toMatch(/data-open-run="1781976018654"/)
    expect(plotHtml).toContain('minted by run')

    // Clicking it emits rz-open-run (the in-shell navigation intent the app routes).
    let openedRun: string | null = null
    shell.addEventListener('rz-open-run', (e) => {
      openedRun = (e as CustomEvent<{ runId: string }>).detail.runId
    })
    const obs = shell.shadowRoot?.querySelector('rz-observatory') as HTMLElement | null
    const btn = obs?.shadowRoot?.querySelector('[data-open-run]') as HTMLButtonElement | null
    expect(btn, 'the open-the-Walk button must be in the rendered DOM').not.toBeNull()
    btn!.click()
    expect(openedRun, 'clicking the affordance emits rz-open-run with the run id').toBe(RUN)

    document.body.removeChild(shell)
  }, 30_000)
})
