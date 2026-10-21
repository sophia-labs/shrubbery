// @vitest-environment happy-dom
// @vitest-environment-options {"url": "http://127.0.0.1:47931/"}
//
// The page's origin is the loopback server below, so every read is same-origin,
// as it is in the browser.

/**
 * The whole shell, REAL end to end: `ovillo-app` reads the fixture graph through
 * its nt-http adapter from the REAL site middleware, lays the pages out with the
 * REAL LayoutInterpreter from the fixture's :ux:config, and drives the REAL
 * player engine (happy-dom's audio element: it cannot decode, so nothing
 * sounds, but every state change is real).
 */
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import '@shrubbery/components/top-bar'
import '@shrubbery/components/audio'
import '../src/ovillo-app.js'
// The score editor's module is loaded on demand in the page; happy-dom does not upgrade an element that is already
// in a shadow root when its definition arrives later (browsers do: the CDP check covers that path), so load it first.
import '../src/ov-score-workbench.js'
import '../src/bench/mn-ovillo-bench.js'
import type { OvilloApp } from '../src/ovillo-app.js'
import { FIXTURE_DIR, ovilloSiteMiddleware, resolveOvilloSite } from '../src/shell/site-middleware.js'

const PORT = 47931
let server: Server
let app: OvilloApp

const until = async <T>(probe: () => T | null | undefined | false, what: string, ms = 8000): Promise<T> => {
  const start = Date.now()
  for (;;) {
    const v = probe()
    if (v) return v
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}
const root = (): ShadowRoot => app.shadowRoot!
const face = (name: string): HTMLElement | null => root().querySelector<HTMLElement>(`[data-face="${name}"]`)
const go = async (hash: string): Promise<void> => {
  location.hash = hash
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  await app.updateComplete
}

beforeAll(async () => {
  const middleware = ovilloSiteMiddleware(resolveOvilloSite({}))
  server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end('not a route') }))
  await new Promise<void>((done) => server.listen(PORT, '127.0.0.1', done))
  app = document.createElement('ovillo-app') as OvilloApp
  document.body.appendChild(app)
})

afterAll(async () => {
  app?.remove()
  await new Promise<void>((done) => server.close(() => done()))
})

describe('ovillo-app on the fixture', () => {
  it('reads the graph and lays out the gallery from the graph’s layout', async () => {
    const gallery = await until(() => face('gallery'), 'the gallery face')
    const player = gallery.querySelector('mn-audio-player')!
    await (player as unknown as { updateComplete: Promise<unknown> }).updateComplete
    const rows = [...player.shadowRoot!.querySelectorAll('.row .t b')].map((b) => b.textContent)
    expect(rows).toEqual(['Hilo de luz', 'Gigante y juguete', 'Agua mansa'])
    expect(gallery.querySelector('.pl[aria-pressed="true"]')!.textContent).toContain('Fixture: three Ariadne pieces')
    const footer = root().querySelector('footer')!.textContent!
    expect(footer).toContain('157 triples')
    expect(footer).toContain('layout graph')
    expect(footer).toContain('FIXTURE')
    expect(face('about')!.querySelector('.fixture')!.textContent).toContain('fixture')
  })

  it('the card beside the player follows the track, with its ledger', async () => {
    const now = await until(() => face('now'), 'the now face')
    expect(now.querySelector('h2')!.textContent).toBe('Hilo de luz')
    const player = face('gallery')!.querySelector('mn-audio-player')!
    ;(player.shadowRoot!.querySelectorAll('.row')[1] as HTMLElement).click()
    await until(() => face('now')?.querySelector('h2')?.textContent === 'Gigante y juguete', 'the card to follow the track')
    const ledger = face('now')!.querySelector('mn-energy-ledger')!
    await (ledger as unknown as { updateComplete: Promise<unknown> }).updateComplete
    // The graph gives ledgers no order; the model lists them by IRI.
    expect([...ledger.shadowRoot!.querySelectorAll('.world')].map((w) => (w as HTMLElement).dataset.world)).toEqual(['gg', 'jj'])
    expect(app.engine.get().track?.iri).toBe('https://ovillo.sophia-labs.com/id/piece/gigante-y-juguete')
  })

  it('a piece page: player, traces, ledger, World, receipt and score', async () => {
    await go('#/piece/gigante-y-juguete')
    await until(() => face('piece-score'), 'the piece faces')
    for (const f of ['piece-player', 'piece-trace', 'piece-ledger', 'piece-world', 'piece-receipt', 'piece-score']) expect(face(f), f).not.toBeNull()
    expect(face('piece-player')!.querySelector('h1')!.textContent).toBe('Gigante y juguete')
    expect(face('piece-score')!.querySelector('pre.score')!.textContent).toBe(readFileSync(join(FIXTURE_DIR, 'site/scores/gigante-y-juguete.mus'), 'utf8'))
    const trace = face('piece-trace')!.querySelector('ov-energy-trace')!
    await until(() => trace.shadowRoot?.querySelectorAll('polyline').length === 3, 'the energy trace to load and draw')
    expect(trace.shadowRoot!.querySelector('.note')!.textContent).toContain('2 Worlds (jj, gg)')
    const receipt = face('piece-receipt')!.textContent!
    expect(receipt).toContain('mus-engine/0.2.0-wf8')
    await until(() => face('piece-receipt')!.textContent!.includes('Receipt schema'), 'the receipt file')
    expect(face('piece-world')!.querySelectorAll('[data-instrument]').length).toBe(2)
    expect(document.title).toBe('Gigante y juguete · Ovillo')
  })

  it('a bench piece says what it has instead of a ledger', async () => {
    await go('#/piece/agua-mansa')
    await until(() => face('piece-ledger')?.textContent?.includes('Closure residual'), 'the bench ledger face')
    expect(face('piece-trace')!.textContent).toContain('states no energy trace')
    expect(face('piece-world')!.querySelector('[data-bench]')!.textContent).toContain('glass')
  })

  it('the bench mounts, quiet; the tract is still a mount point', async () => {
    await go('#/tract')
    const tract = await until(() => face('mount-tract'), 'the tract mount')
    expect(tract.dataset.mounted).toBe('false')
    expect(tract.textContent).toContain('<mn-ovillo-tract>')
    await go('#/bench')
    const bench = await until(() => face('mount-bench'), 'the bench mount')
    expect(bench.dataset.mounted).toBe('true')
    const el = bench.querySelector('mn-ovillo-bench') as (HTMLElement & { audioState: string; scores: unknown[]; wasm: string }) | null
    expect(el).not.toBeNull()
    expect(el!.audioState).toBe('off')
    expect(el!.wasm).toBe('http://127.0.0.1:47931/wasm/ovillo_web.wasm')
    // The graph's bench scores go to the bench to play.
    expect(el!.scores.map((sc) => (sc as { title: string }).title)).toEqual(['Agua mansa'])
  })

  it('the score editor: Hoja’s MUS mode for a MUS score, and says how long a render takes', async () => {
    await go('#/score/hilo-de-luz')
    const editor = await until(() => face('mount-score'), 'the score editor mount')
    expect(editor.dataset.mount).toBe('hoja-mus')
    expect(editor.dataset.format).toBe('mus')
    const bench = await until(() => editor.querySelector('ov-score-workbench')?.querySelector('hoja-mus-editor'), 'the workbench', 20000)
    expect(bench).not.toBeNull()
    expect(editor.textContent).toContain('about a minute for a 30-second piece')
    expect(editor.querySelector('[data-excerpt="2"]')).not.toBeNull()
  })

  it('a bench score stays read-only', async () => {
    await go('#/score/agua-mansa')
    const editor = await until(() => face('mount-score')?.dataset.mount === 'read-only' ? face('mount-score') : null, 'the read-only score')
    expect(editor.querySelector('ov-score-workbench')).toBeNull()
    expect(editor.querySelector('pre.score')!.textContent).toBe(readFileSync(join(FIXTURE_DIR, 'site/scores/agua-mansa.json'), 'utf8'))
    expect(editor.textContent).toContain('the bench plays it live')
  })

  it('an unknown piece is said plainly', async () => {
    await go('#/piece/no-such-piece')
    await until(() => root().querySelector('.boot[role="alert"]'), 'the not-found notice')
    expect(root().querySelector('.boot')!.textContent).toContain('no piece named “no-such-piece”')
    await go('#/')
    await until(() => face('gallery'), 'the gallery again')
  })
})
