// @vitest-environment happy-dom
// @vitest-environment-options {"url": "http://127.0.0.1:47932/"}
//
// The page's origin is the loopback server below, so every read is same-origin, as it is in the browser.

/**
 * A piece whose score is a note list (`ovillo-notes-tsv`): the trombone v1 World, played by a Rust example. REAL
 * data only: the graph builder's `ovillo` graph (OVILLO_OUT=<ovillo>/site/graph/out, built with the trombone), its
 * note list, receipt, measurement and energy trace, read through the REAL site middleware by the REAL shell in
 * happy-dom. Skipped when OVILLO_OUT names no graph with the trombone in it (the app's fixture has no such piece).
 */
import { createServer, type Server } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseNT } from '@shrubbery/nucleus'
import '@shrubbery/components/top-bar'
import '@shrubbery/components/audio'
import '../src/ovillo-app.js'
import type { OvilloApp } from '../src/ovillo-app.js'
import { parseOvillo } from '../src/model.js'
import { NOTES_TSV, fxNames, noteName, pairNotes, parseNotesAnalysis, parseNotesTsv } from '../src/notes.js'
import { ovilloSiteMiddleware, resolveOvilloSite } from '../src/shell/site-middleware.js'

const OUT = process.env.OVILLO_OUT ?? ''
const SLUG = 'trombone-solo'
const has = !!OUT && existsSync(join(OUT, 'ovillo.nt')) && existsSync(join(OUT, 'site', 'scores', `${SLUG}.tsv`))
const file = (rel: string): string => readFileSync(join(OUT, 'site', rel), 'utf8')

describe.skipIf(!has)('a note-list piece on the real graph (OVILLO_OUT): the trombone v1', () => {
  const graph = has ? parseOvillo(parseNT(readFileSync(join(OUT, 'ovillo.nt'), 'utf8'))) : null
  const piece = graph?.bySlug.get(SLUG)
  const receipt = has ? (JSON.parse(file(`receipts/${SLUG}.json`)) as { notes: number; planDigest: string; renderWallSeconds: number; ledger: Record<string, number> }) : null
  const analysis = has ? parseNotesAnalysis(JSON.parse(file(`receipts/${SLUG}.analysis.json`))) : null

  it('the graph states the note list, the receipt and the measurement, and not what the receipt lacks', () => {
    expect(piece).toBeDefined()
    expect(piece!.score).toMatchObject({ format: NOTES_TSV, text: file(`scores/${SLUG}.tsv`), generator: 'ovillo/crates/ovillo-dsp/examples/trombone_nd_solo.rs' })
    expect(piece!.score!.repoPath).toBeUndefined()
    expect(piece!.instruments.map((i) => i.kind)).toEqual(['trombone'])
    const r = piece!.render!
    expect(r.receipt).toBe(`https://ovillo.sophia-labs.com/receipts/${SLUG}.json`)
    expect(r.analysis).toBe(`https://ovillo.sophia-labs.com/receipts/${SLUG}.analysis.json`)
    expect(r.renderDigest).toBeUndefined()
    expect(r.engineVersion).toBeUndefined()
    expect(r.eventCount).toBe(receipt!.notes)
    expect(r.ledgers).toHaveLength(1)
    const l = r.ledgers[0]
    expect(l).toMatchObject({
      world: 'trombone',
      planDigest: receipt!.planDigest,
      sourceWork: receipt!.ledger.sourceWork,
      controlWork: receipt!.ledger.controlWork,
      internalLoss: receipt!.ledger.internalLoss,
      radiation: receipt!.ledger.radiation,
      closureResidual: receipt!.ledger.cumulativeClosureResidual,
      maxFrameResidual: receipt!.ledger.maximumFrameResidual,
      initialEnergy: receipt!.ledger.initialEnergy,
      finalEnergy: receipt!.ledger.finalEnergy,
      sampleFrames: receipt!.ledger.sampleFrames,
    })
    for (const k of ['plucks', 'hammerOns', 'pullOffs', 'slides'] as const) expect(l[k], k).toBeUndefined()
  })

  it('the note list reads as written, and pairs with its measurement note for note', () => {
    const notes = parseNotesTsv(piece!.score!.text!)
    expect(notes).toHaveLength(receipt!.notes)
    const raw = file(`scores/${SLUG}.tsv`).trim().split('\n').slice(1).map((l) => l.split('\t'))
    notes.forEach((n, i) => {
      expect(n.startS).toBe(Number(raw[i][0]))
      expect(n.midi).toBe(Number(raw[i][2]))
      expect(n.partial).toBe(Number(raw[i][3]))
      expect(n.art).toBe(raw[i][6])
    })
    expect(noteName(notes[0].midi)).toBe('C4')
    // the rip is on the high C (fx 52 = rip, swell, vibrato), the last note scoops, falls and fades (71)
    const rip = notes.find((n) => fxNames(n.fx).includes('rip'))!
    expect(noteName(rip.midi)).toBe('C5')
    expect(fxNames(notes.at(-1)!.fx)).toEqual(['scoop', 'fall', 'vibrato', 'diminuendo'])
    const rows = pairNotes(notes, analysis)
    expect(rows.every((r) => r.measured !== null)).toBe(true)
    expect(rows.filter((r) => r.measured!.sounded_partial === r.written.partial)).toHaveLength(analysis!.summary.sounded_intended_partial!)
    expect(() => parseNotesTsv('start_s\tmidi\n0\t60\n')).toThrow(/end_s/)
  })
})

describe.skipIf(!has)('ovillo-app on the real graph: the trombone’s piece page (OVILLO_OUT)', () => {
  const PORT = 47932
  let server: Server
  let app: OvilloApp
  const until = async <T>(probe: () => T | null | undefined | false, what: string, ms = 10000): Promise<T> => {
    const start = Date.now()
    for (;;) {
      const v = probe()
      if (v) return v
      if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`)
      await new Promise((r) => setTimeout(r, 25))
    }
  }
  const face = (name: string): HTMLElement | null => app.shadowRoot!.querySelector<HTMLElement>(`[data-face="${name}"]`)
  const go = async (hash: string): Promise<void> => {
    location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await app.updateComplete
  }

  beforeAll(async () => {
    const middleware = ovilloSiteMiddleware(resolveOvilloSite({ OVILLO_OUT: OUT }))
    server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end('not a route') }))
    await new Promise<void>((done) => server.listen(PORT, '127.0.0.1', done))
    app = document.createElement('ovillo-app') as OvilloApp
    document.body.appendChild(app)
    await until(() => face('gallery'), 'the gallery', 20000)
  })

  afterAll(async () => {
    app?.remove()
    await new Promise<void>((done) => server.close(() => done()))
  })

  it('shows the note list as a table with the measurement, the receipt’s own figures and what it does not state', async () => {
    await go(`#/piece/${SLUG}`)
    const score = await until(() => face('piece-score')?.querySelector('.notes[role="table"]') ? face('piece-score') : null, 'the note table')
    const n = (JSON.parse(file(`receipts/${SLUG}.json`)) as { notes: number }).notes
    expect(score.querySelector('.notes[role="table"]')!.getAttribute('data-rows')).toBe(String(n))
    expect(score.querySelectorAll('.body [role="row"]')).toHaveLength(n)
    expect(score.querySelector('pre.score')).toBeNull()
    expect(score.textContent).toContain('trombone_nd_solo.rs')
    expect(score.textContent).toContain('not in the repository')
    expect(score.querySelector('a.link')).toBeNull() // no score editor link: there is nothing to edit
    await until(() => score.querySelector('[data-measured]'), 'the measurement')
    expect(score.querySelector('[data-measured]')!.textContent!.replace(/\s+/g, ' ')).toContain(`${n} of ${n} notes sound the partial they were placed on`)
    expect(score.querySelectorAll('[role="cell"][data-same="true"]')).toHaveLength(n)

    const receipt = await until(() => face('piece-receipt')?.querySelector('[data-example-receipt]') ? face('piece-receipt') : null, 'the receipt file')
    const text = receipt.textContent!.replace(/\s+/g, ' ')
    expect(text).toContain('ovillo.trombone-nd-render.v1')
    expect(text).toMatch(/Engine\s*— \(not in this receipt\)/)
    expect(text).toMatch(/Render digest\s*— \(not in this receipt\)/)
    expect(text).toContain(`Notes played${n}`)
    expect(text).toContain('Lip retunes')
    expect(text).toContain('measurement (JSON)')

    const ledger = face('piece-ledger')!
    expect(ledger.querySelector('mn-energy-ledger')).not.toBeNull()
    expect(ledger.querySelector('[data-stored="trombone"]')!.textContent!.replace(/\s+/g, ' ')).toMatch(/held 15 J before its first frame/)

    const trace = face('piece-trace')!.querySelector('ov-energy-trace')!
    await until(() => trace.shadowRoot?.querySelectorAll('polyline').length === 2, 'the energy trace (air, lips)')
    expect([...trace.shadowRoot!.querySelectorAll('polyline')].map((p) => p.getAttribute('data-body'))).toEqual(['air', 'lips'])
    expect(face('piece-trace')!.querySelector('[data-units]')!.textContent).toContain('lungs')
    expect(face('piece-world')!.textContent).toContain('ovillo-trombone-nd-v1')
  })

  it('the score editor says there is no MUS score to edit, and shows the list read-only', async () => {
    await go(`#/score/${SLUG}`)
    const editor = await until(() => face('mount-score')?.dataset.mount === 'read-only' ? face('mount-score') : null, 'the read-only note list')
    expect(editor.dataset.format).toBe(NOTES_TSV)
    expect(editor.textContent).toContain('played by a program, from this note list')
    expect(editor.querySelector('pre.score')!.textContent).toBe(file(`scores/${SLUG}.tsv`))
    await go('#/')
  })
})
