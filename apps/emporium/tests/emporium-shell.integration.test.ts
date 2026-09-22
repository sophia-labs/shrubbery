/**
 * REAL INTEGRATION TEST — the EMPORIUM product shell, end to end, NO MOCKS.
 *
 * This is the iteration-6a acceptance: the DEDICATED app shell reads the LIVE
 * /emporium registry and renders a DESIGNED product — a top bar (mn-app-bar) + a
 * packs RAIL + a content area + breadcrumbs + nav state — against a REAL gardend
 * cell. It:
 *   1. spawns a REAL current-release gardend (serves /emporium; the debug build is
 *      stale) via the SHARED spawn helper,
 *   2. boots the shell (shell.ts) with a Node-transport store (over the real cell)
 *      + a hash-router bound to this test's window,
 *   3. asserts the LIVE catalogue renders: the packs RAIL lists the two real packs
 *      (workflow + sophia-memory-core), the top bar masthead is "Emporium" with the
 *      "Emporium" breadcrumb, and the content area shows one mn-card per pack,
 *   4. NAVIGATES to a pack (rail click → route change) and asserts the content area
 *      switches to that pack's DETAIL view (real classes) + the breadcrumb trail
 *      grows to Emporium → {pack}, with the rail row marked active.
 *
 * The cell is killed + its temp profile removed on teardown. No stubbed HTTP and no
 * fake /emporium payload anywhere — "the pack IS the catalog", read live.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'

import { spawnGardend, resolveGardendBin, type GardendCell } from '@shrubbery/source/node'
import { createEmporiumStore } from '@shrubbery/source/emporium'
import { bootShell, type EmporiumShell, type ShellElements } from '../src/shell.js'
import { createRouter } from '../src/router.js'

const GARDEN_BIN = resolveGardendBin()
const BIN_PRESENT = existsSync(GARDEN_BIN)

/** Build the four shell DOM mounts inside the shared (happy-dom) document. */
function buildMounts(): ShellElements {
  const make = (id: string): HTMLElement => {
    const el = document.createElement('div')
    el.id = id
    document.body.appendChild(el)
    return el
  }
  return {
    appBarMount: make('app-bar'),
    railMount: make('rail'),
    contentMount: make('content'),
    statusMount: make('status'),
  }
}

/** Drain the microtask/observer queue + let the store's async refresh settle. */
const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('REAL INTEGRATION — Emporium product shell from a current cell', () => {
  let cell: GardendCell
  let shell: EmporiumShell
  let mounts: ShellElements

  beforeAll(async () => {
    if (!BIN_PRESENT) {
      throw new Error(
        `gardend binary not found at ${GARDEN_BIN}. This test REQUIRES the real ` +
          `release binary (it serves /emporium; the debug build is stale). Set GARDEN_BIN.`,
      )
    }
    cell = await spawnGardend()

    // Fresh hash so the router starts at the catalogue.
    window.location.hash = ''
    mounts = buildMounts()

    // Node-transport store over the REAL cell (the browser path uses /cell; here we
    // hit the cell's REST routes directly with the bearer, same as the catalogue
    // integration test). The router is bound to this test's window.
    const store = createEmporiumStore({
      transport: { baseUrl: cell.apiUrl, token: cell.token, origin: 'http://127.0.0.1' },
    })
    const router = createRouter(window)

    shell = bootShell(mounts, { store, router, skin: 'emporium', theme: 'light' })

    // Wait for the live read to settle + the shell to render.
    await store.refresh()
    await tick()
  }, 40000)

  afterAll(async () => {
    shell?.destroy()
    if (cell) await cell.kill()
  })

  it('stamps the EMPORIUM skin on <html> (the product default identity)', () => {
    expect(document.documentElement.getAttribute('data-skin')).toBe('emporium')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('uses the shared Sophia → 98 → Glass → Garden → Sophia identity cycle', async () => {
    const toggle = (): void => {
      const bar = mounts.appBarMount.querySelector('mn-app-bar') as HTMLElement
      const button = bar.shadowRoot?.querySelector<HTMLButtonElement>('button[data-action="skin"]')
      expect(button).toBeTruthy()
      button!.click()
    }

    toggle()
    await tick()
    expect(document.documentElement.dataset.skin).toBe('98')
    toggle()
    await tick()
    expect(document.documentElement.dataset.skin).toBe('glass')
    toggle()
    await tick()
    expect(document.documentElement.hasAttribute('data-skin')).toBe(false)
    toggle()
    await tick()
    expect(document.documentElement.dataset.skin).toBe('emporium')
  })

  it('renders the top bar as a designed product bar: masthead "Emporium" + Emporium crumb', () => {
    const bar = mounts.appBarMount.querySelector('mn-app-bar')!
    expect(bar, 'mn-app-bar mounted').not.toBeNull()
    const sr = (bar as HTMLElement).shadowRoot!
    expect(sr.querySelector('.masthead-name')?.textContent?.trim()).toBe('Emporium')
    // Live read settled ⇒ the badge reads 'live' (honest provenance, not faked).
    expect(sr.querySelector('.masthead-badge')?.textContent?.trim()).toBe('live')
    // At the catalogue the trail is just the Emporium root crumb.
    const crumbs = sr.querySelectorAll('.crumb')
    expect(crumbs.length).toBe(1)
    expect(crumbs[0].textContent?.trim()).toBe('Emporium')
  })

  it('renders the packs RAIL with the two real live packs', () => {
    const rows = mounts.railMount.querySelectorAll('.rail__row')
    const names = Array.from(rows).map((r) => r.getAttribute('data-pack'))
    expect(names).toEqual(expect.arrayContaining(['workflow', 'sophia-memory-core']))
    // The rail header shows the live pack count.
    expect(mounts.railMount.querySelector('.rail__head-title')?.textContent).toContain(
      'Vocabulary Packs',
    )
    // Each row surfaces a live version chip + a sha badge (real facts, never faked).
    const wfRow = mounts.railMount.querySelector('.rail__row[data-pack="workflow"]')!
    expect(wfRow.querySelector('mn-chip[tone="accent"]')).not.toBeNull()
    expect(wfRow.querySelector('mn-badge')).not.toBeNull()
  })

  it('renders the catalogue content with one mn-card per live pack', () => {
    const cards = mounts.contentMount.querySelectorAll('mn-card.vocab-card')
    expect(cards.length).toBeGreaterThanOrEqual(2)
    expect(mounts.contentMount.querySelector('mn-card[data-vocab="workflow"]')).not.toBeNull()
    expect(
      mounts.contentMount.querySelector('mn-card[data-vocab="sophia-memory-core"]'),
    ).not.toBeNull()
  })

  it('NAVIGATES rail → pack: content switches to the real pack DETAIL view', async () => {
    // Activate the workflow rail row (a real click → router.navigate).
    const wfRow = mounts.railMount.querySelector(
      '.rail__row[data-pack="workflow"]',
    ) as HTMLButtonElement
    wfRow.click()
    await tick()

    // Route reflected in the hash (mirrors the curl URL grammar).
    expect(window.location.hash).toBe('#/emporium/workflow')
    expect(shell.router.current()).toEqual({ kind: 'pack', pack: 'workflow' })

    // The content area is now the pack-detail view (real classes), not the catalogue.
    expect(mounts.contentMount.querySelector('mn-card.vocab-card')).toBeNull()
    expect(mounts.contentMount.querySelector('.vocab-pack__name')?.textContent).toBe('workflow')
    const classCards = mounts.contentMount.querySelectorAll('mn-card.vocab-class')
    expect(classCards.length).toBeGreaterThan(0)
    // AgentNode is a real workflow class (verified live in earlier iterations).
    expect(mounts.contentMount.querySelector('mn-card[data-class="AgentNode"]')).not.toBeNull()

    // The breadcrumb trail grew to Emporium → workflow.
    const sr = (mounts.appBarMount.querySelector('mn-app-bar') as HTMLElement).shadowRoot!
    const crumbs = Array.from(sr.querySelectorAll('.crumb')).map((c) => c.textContent?.trim())
    expect(crumbs).toEqual(['Emporium', 'workflow'])

    // The rail marks the active pack.
    expect(wfRow.getAttribute('aria-current')).toBe('true')
    expect(wfRow.classList.contains('rail__row--active')).toBe(true)
  })

  it('breadcrumb → catalogue: clicking the Emporium crumb returns to the catalogue', async () => {
    const sr = (mounts.appBarMount.querySelector('mn-app-bar') as HTMLElement).shadowRoot!
    const rootCrumb = sr.querySelector('.crumb') as HTMLButtonElement // first crumb = Emporium (interactive)
    expect(rootCrumb.tagName.toLowerCase()).toBe('button')
    rootCrumb.click()
    await tick()

    expect(shell.router.current()).toEqual({ kind: 'catalogue' })
    expect(window.location.hash).toBe('#/emporium')
    // Catalogue cards are back; the pack-detail view is gone.
    expect(mounts.contentMount.querySelector('mn-card.vocab-card')).not.toBeNull()
    expect(mounts.contentMount.querySelector('.vocab-pack__name')).toBeNull()
  })

  it('class deep-link route: /emporium/{pack}/{class} resolves the real class in the pack view', async () => {
    shell.router.navigate({ kind: 'class', pack: 'workflow', cls: 'AgentNode' })
    await tick()
    expect(window.location.hash).toBe('#/emporium/workflow/AgentNode')
    // The pack-detail view is shown and the deep-linked class card is present.
    expect(mounts.contentMount.querySelector('.vocab-pack__name')?.textContent).toBe('workflow')
    expect(mounts.contentMount.querySelector('mn-card[data-class="AgentNode"]')).not.toBeNull()
    // The trail is Emporium → workflow → AgentNode (current).
    const sr = (mounts.appBarMount.querySelector('mn-app-bar') as HTMLElement).shadowRoot!
    const crumbs = Array.from(sr.querySelectorAll('.crumb')).map((c) => c.textContent?.trim())
    expect(crumbs).toEqual(['Emporium', 'workflow', 'AgentNode'])
  })

  it('search filter narrows the catalogue to matching live packs (no faked rows)', async () => {
    // Back to the catalogue, then type a query that matches only memory-core.
    shell.router.navigate({ kind: 'catalogue' })
    await tick()
    const bar = mounts.appBarMount.querySelector('mn-app-bar') as HTMLElement
    const input = bar.shadowRoot!.querySelector('.search-input') as HTMLInputElement
    input.value = 'memory'
    input.dispatchEvent(new Event('input'))
    await tick()

    const cards = mounts.contentMount.querySelectorAll('mn-card.vocab-card')
    const names = Array.from(cards).map((c) => c.getAttribute('data-vocab'))
    expect(names).toContain('sophia-memory-core')
    expect(names).not.toContain('workflow')
    // The filter strip honestly reports the narrowing.
    expect(mounts.contentMount.querySelector('.content-filter')?.textContent).toContain('memory')
  })
})
