/**
 * emporium-shell-noinfra.test.ts — the shell's product behaviors, NO INFRA, NO MOCKS.
 *
 * Boots the REAL shell (bootShell) against a REAL EmporiumStore whose transport is
 * fed by an in-process `fetch` that serves the VERBATIM captured cell responses
 * (tests/fixtures/emporium-snapshot — a real capture, not a stub) — the same
 * `fetch` injection seam the browser build uses. This exercises the whole
 * shell-side path (fetch → EmporiumClient → mapPack → rail/catalogue/detail views
 * → DOM) with no gardend. It pins: the live catalogue renders, the rail lists the
 * real packs, navigation switches the content view + grows the breadcrumb + marks
 * the active rail row, the LIST|GRAPH toggle is shell-owned reversible state, and a
 * search query filters the catalogue. The `*.integration.test.ts` siblings pin the
 * SAME behaviors over a spawned live cell; this pins them in the no-infra CI lane.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createEmporiumStore, type EmporiumStore } from '@shrubbery/source/emporium'
import type { VocabSummary } from '@shrubbery/render'
import type { MnAppBar } from '@shrubbery/components'
import { bootShell, type EmporiumShell, type ShellElements } from '../src/shell.js'
import { createRouter } from '../src/router.js'

const SNAP = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/emporium-snapshot')
const readSnap = (file: string): string => readFileSync(join(SNAP, file), 'utf8')
const catalogue = JSON.parse(readSnap('vocabs.json')).vocabularies as VocabSummary[]

/**
 * A REAL in-process cell server (no mock framework): it maps the /emporium routes
 * to the verbatim captured bodies exactly as the live cell would — including
 * resolving the `latest` version alias to the concrete captured version. Passed
 * through the transport's SUPPORTED `fetch` seam, so the store/client run their
 * real code against real committed data.
 */
const fixtureFetch: typeof fetch = async (input) => {
  const href =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
  const path = new URL(href).pathname
  if (path.endsWith('/emporium/vocabs')) return new Response(readSnap('vocabs.json'), { status: 200 })
  const m = /\/emporium\/vocab\/([^/]+)\/([^/]+)$/.exec(path)
  if (m) {
    const name = decodeURIComponent(m[1])
    const summary = catalogue.find((v) => v.name === name)
    if (!summary) return new Response('unknown pack', { status: 404 })
    // The real cell resolves `latest`; do the same against the captured version.
    const version = m[2] === 'latest' ? summary.version : decodeURIComponent(m[2])
    try {
      return new Response(readSnap(`vocab.${name}.${version}.json`), { status: 200 })
    } catch {
      return new Response('unknown version', { status: 404 })
    }
  }
  return new Response('unknown route', { status: 404 })
}

const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms))

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

/** The live app-bar element (the shell rebuilds it each render); typed for prop reads. */
const bar = (m: ShellElements): MnAppBar => m.appBarMount.querySelector('mn-app-bar') as MnAppBar

describe('NO-INFRA — Emporium shell from the captured-real registry', () => {
  let shell: EmporiumShell
  let store: EmporiumStore
  let mounts: ShellElements

  beforeAll(async () => {
    window.location.hash = ''
    mounts = buildMounts()
    store = createEmporiumStore({
      transport: { baseUrl: 'http://emporium.test', transport: 'fetch', fetch: fixtureFetch },
    })
    const router = createRouter(window)
    shell = bootShell(mounts, { store, router, skin: 'emporium', theme: 'light' })
    await store.refresh()
    await tick()
  })

  afterAll(() => {
    shell?.destroy()
  })

  it('renders the live catalogue: the rail lists the real packs + the bar is the Emporium masthead', () => {
    expect(store.getState().status).toBe('ready')
    // The packs rail lists exactly the captured packs, by name.
    const rows = mounts.railMount.querySelectorAll('button.rail__row[data-pack]')
    expect(rows.length).toBe(catalogue.length)
    expect(mounts.railMount.querySelector('button.rail__row[data-pack="workflow"]')).not.toBeNull()
    expect(
      mounts.railMount.querySelector('button.rail__row[data-pack="sophia-memory-core"]'),
    ).not.toBeNull()
    // The content area shows one catalogue card per pack.
    expect(mounts.contentMount.querySelectorAll('mn-card.vocab-card[data-vocab]').length).toBe(
      catalogue.length,
    )
    // The designed product bar: masthead "Emporium", a "live" badge, the root crumb.
    expect(bar(mounts).brand).toBe('Emporium')
    expect(bar(mounts).badge).toBe('live')
    expect(bar(mounts).crumbs?.map((c) => c.label)).toEqual(['Emporium'])
  })

  it('navigating to a pack switches the content view, grows the breadcrumb, marks the rail row active', async () => {
    shell.router.navigate({ kind: 'pack', pack: 'workflow' })
    await tick()
    // The content area swaps to that pack's detail view.
    expect(mounts.contentMount.querySelector('.vocab-pack[data-vocab="workflow"]')).not.toBeNull()
    expect(mounts.contentMount.querySelector('mn-card.vocab-card[data-vocab]')).toBeNull()
    // The breadcrumb trail grows Emporium → workflow (route-derived).
    expect(bar(mounts).crumbs?.map((c) => c.label)).toEqual(['Emporium', 'workflow'])
    // The active pack's rail row carries aria-current.
    const active = mounts.railMount.querySelector('button.rail__row[data-pack="workflow"]')!
    expect(active.getAttribute('aria-current')).toBe('true')
    expect(
      mounts.railMount
        .querySelector('button.rail__row[data-pack="sophia-memory-core"]')!
        .getAttribute('aria-current'),
    ).not.toBe('true')
  })

  it('the LIST|GRAPH relationships toggle is shell-owned, reversible state', async () => {
    shell.router.navigate({ kind: 'pack', pack: 'workflow' })
    await tick()
    const section = () => mounts.contentMount.querySelector('mn-card[data-section="relationships"]')!
    // Defaults to the edge LIST.
    expect(section().getAttribute('data-rel-view')).toBe('list')
    expect(mounts.contentMount.querySelector('mn-graph')).toBeNull()

    // Flip to GRAPH (a real button click the shell listens to).
    ;(mounts.contentMount.querySelector('[data-rel-view-btn="graph"]') as HTMLButtonElement).click()
    await tick()
    expect(section().getAttribute('data-rel-view')).toBe('graph')
    expect(mounts.contentMount.querySelector('mn-graph')).not.toBeNull()

    // Flip back to LIST — the toggle is reversible.
    ;(mounts.contentMount.querySelector('[data-rel-view-btn="list"]') as HTMLButtonElement).click()
    await tick()
    expect(section().getAttribute('data-rel-view')).toBe('list')
    expect(mounts.contentMount.querySelector('mn-graph')).toBeNull()
  })

  it('a search query filters the catalogue to the matching packs (honest count)', async () => {
    shell.router.navigate({ kind: 'catalogue' })
    await tick()
    // Drive the bar's search event (the real seam the mn-app-bar emits).
    bar(mounts).dispatchEvent(new CustomEvent('mn-search', { detail: { query: 'workflow' } }))
    await tick()
    expect(shell.query()).toBe('workflow')
    // Only the matching pack card remains; the filter banner reports the honest count.
    const cards = mounts.contentMount.querySelectorAll('mn-card.vocab-card[data-vocab]')
    expect(cards.length).toBe(1)
    expect(cards[0].getAttribute('data-vocab')).toBe('workflow')
    const banner = mounts.contentMount.querySelector('.content-filter')!
    expect(banner.textContent).toContain('workflow')
    expect(banner.textContent).toContain(`1 of ${catalogue.length}`)
  })
})
