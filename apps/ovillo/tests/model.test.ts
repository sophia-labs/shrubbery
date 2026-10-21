/**
 * The `ovl:` codec on REAL graphs: the app's fixture (three Ariadne pieces from
 * the renders of 2026-10-20), cross-checked field by field against the files it
 * was built from; and, when OVILLO_OUT names a graph builder's out/ directory,
 * the real `ovillo` graph too.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseNT } from '@shrubbery/nucleus'
import { NoPiecesError, parseOvillo } from '../src/model.js'
import { FIXTURE_DIR } from '../src/shell/site-middleware.js'
import { tracksFor } from '../src/tracks.js'
import { resolveMediaUrl } from '../src/media.js'

const fixtureNt = readFileSync(join(FIXTURE_DIR, 'ovillo.nt'), 'utf8')
const site = (rel: string): string => readFileSync(join(FIXTURE_DIR, 'site', rel), 'utf8')
const graph = parseOvillo(parseNT(fixtureNt))

describe('the fixture graph', () => {
  it('is three pieces in one stated playlist, and says it is a fixture', () => {
    expect(graph.tripleCount).toBe(parseNT(fixtureNt).length)
    expect(graph.pieces.map((p) => p.slug)).toEqual(['hilo-de-luz', 'gigante-y-juguete', 'agua-mansa'])
    expect(graph.playlists).toHaveLength(1)
    expect(graph.playlists[0]).toMatchObject({ title: 'Fixture: three Ariadne pieces', derived: false })
    expect(graph.playlists[0].items.map((p) => p.position)).toEqual([1, 2, 3])
    expect(graph.fixture).toBe(true)
  })

  it('a piece carries what the graph states, and nothing it does not', () => {
    const hilo = graph.bySlug.get('hilo-de-luz')!
    expect(hilo).toMatchObject({ title: 'Hilo de luz', group: 'today', tags: ['pretty'], engine: 'steel-string world · DADGAD' })
    expect(hilo.note).toMatch(/^A lullaby in 3\/4 for three hands/)
    expect(hilo.instruments).toHaveLength(1)
    expect(hilo.instruments[0]).toMatchObject({ kind: 'steel-string', anatomy: 'steel-string-v0', tuning: 'D2 A2 D3 G3 A3 D4' })
    const r = hilo.render!
    expect(r.audio).toBe('https://ovillo.sophia-labs.com/media/hilo-de-luz.mp3')
    expect(r.energyTrace).toBe('https://ovillo.sophia-labs.com/media/hilo-de-luz.energy.json')
    expect(r.durationSeconds).toBeCloseTo(53.0909, 3)
    expect(r.created).toBe('2026-10-20')
    // The builder did not know the source revision, so the graph does not state one.
    expect(r.sourceRevision).toBeUndefined()
    expect(r.bench).toBeNull()
  })

  it('the score text is the score file, byte for byte', () => {
    expect(graph.bySlug.get('hilo-de-luz')!.score!.text).toBe(site('scores/hilo-de-luz.mus'))
    expect(graph.bySlug.get('agua-mansa')!.score).toMatchObject({ format: 'ovillo-score-json', text: site('scores/agua-mansa.json') })
  })

  it('every ledger equals its receipt, one per World', () => {
    for (const slug of ['hilo-de-luz', 'gigante-y-juguete']) {
      const receipt = JSON.parse(site(`receipts/${slug}.json`)) as { renderDigest: string; ariadneWorlds: Array<Record<string, number | string>> }
      const r = graph.bySlug.get(slug)!.render!
      expect(r.renderDigest).toBe(receipt.renderDigest)
      expect(r.ledgers.map((l) => l.world).sort()).toEqual(receipt.ariadneWorlds.map((w) => String(w.instrument)).sort())
      for (const w of receipt.ariadneWorlds) {
        const l = r.ledgers.find((x) => x.world === w.instrument)!
        expect(l.sourceWork).toBe(w.sourceWork)
        expect(l.controlWork).toBe(w.controlWork)
        expect(l.internalLoss).toBe(w.internalLoss)
        expect(l.radiation).toBe(w.radiation)
        expect(l.closureResidual).toBe(w.cumulativeClosureResidual)
        expect(l.maxFrameResidual).toBe(w.maximumFrameResidual)
        expect(l.plucks).toBe(w.plucks)
      }
    }
    expect(graph.bySlug.get('gigante-y-juguete')!.render!.ledgers).toHaveLength(2)
  })

  it('a bench piece has its bench run and no ledger, receipt or trace', () => {
    const r = graph.bySlug.get('agua-mansa')!.render!
    expect(r.ledgers).toEqual([])
    expect(r.receipt).toBeUndefined()
    expect(r.energyTrace).toBeUndefined()
    expect(r.bench).toMatchObject({ pattern: 'score', pickup: 'neck', safetyLimitedFrames: 0, closureResidual: 1.3e-18 })
    expect(JSON.parse(r.bench!.patch!)).toMatchObject({ name: 'glass', sustain: 1 })
  })

  it('tracks resolve the canonical URLs to this origin', () => {
    const { tracks, unplayable } = tracksFor(graph.pieces)
    expect(unplayable).toBe(0)
    expect(tracks.map((t) => t.src)).toEqual(['/media/hilo-de-luz.mp3', '/media/gigante-y-juguete.mp3', '/media/agua-mansa.mp3'])
    expect(tracks[0]).toMatchObject({ peaksUrl: '/media/hilo-de-luz.peaks.json', energyUrl: '/media/hilo-de-luz.energy.json', href: '#/piece/hilo-de-luz' })
    expect(tracks[2].energyUrl).toBeUndefined()
    expect(resolveMediaUrl('media/x.mp3', { mediaBase: '/ovillo' })).toBe('/ovillo/media/x.mp3')
    expect(resolveMediaUrl('https://elsewhere.example/x.mp3')).toBe('https://elsewhere.example/x.mp3')
    expect(resolveMediaUrl('https://ovillo.sophia-labs.com/media/x.mp3', { mediaBase: 'https://cdn.example' })).toBe('https://cdn.example/media/x.mp3')
  })

  it('a graph with no pieces is refused, not shown empty', () => {
    expect(() => parseOvillo(parseNT('<urn:a> <urn:b> "c" .\n'))).toThrow(NoPiecesError)
  })
})

const out = process.env.OVILLO_OUT
describe.skipIf(!out || !existsSync(join(out ?? '', 'ovillo.nt')))('the graph builder’s ovillo graph (OVILLO_OUT)', () => {
  it('parses: every piece in a playlist, every render with audio, the derived "All pieces" last', () => {
    const real = parseOvillo(parseNT(readFileSync(join(out!, 'ovillo.nt'), 'utf8')))
    expect(real.fixture).toBe(false)
    expect(real.pieces.length).toBeGreaterThan(3)
    expect(real.playlists.at(-1)).toMatchObject({ title: 'All pieces', derived: true })
    expect(real.playlists.at(-1)!.items).toHaveLength(real.pieces.length)
    for (const p of real.pieces) expect(p.render?.audio, p.slug).toMatch(/^https:\/\/ovillo\.sophia-labs\.com\/media\//)
    const withTrace = real.pieces.filter((p) => p.render?.energyTrace)
    expect(withTrace.length).toBeGreaterThan(0)
    for (const p of withTrace) expect(p.render!.ledgers.length, p.slug).toBeGreaterThan(0)
  })
})
