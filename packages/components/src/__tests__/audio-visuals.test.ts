/**
 * The visualizers' pure data, on REAL render data: the Ovillo fixture's peaks
 * and energy traces (apps/ovillo/fixture, computed from the Ariadne renders of
 * 2026-10-20) and the receipts' ledgers. No mocks: every number below is read
 * from those files or computed from them here.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bodyKindOf,
  energyAt,
  energyLevel,
  energyPolylines,
  formatQuantity,
  ledgerBalance,
  parseEnergyTrace,
  parsePeaks,
  peakBins,
  peaksDuration,
  spectrumBands,
  touchedStrings,
  touchesBetween,
  MnMediaDataError,
} from '../audio-visuals.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(here, '../../../../apps/ovillo/fixture/site')
const json = (rel: string): unknown => JSON.parse(readFileSync(resolve(FIXTURE, rel), 'utf8'))

describe('peaks', () => {
  const raw = json('media/hilo-de-luz.peaks.json') as { sr: number; samplesPerPeak: number; peaks: number[] }
  const peaks = parsePeaks(raw)

  it('reads the render peaks and knows the seconds they cover', () => {
    expect(peaks.sr).toBe(48000)
    expect(peaks.samplesPerPeak).toBe(480)
    // Hilo de luz is 53.09 s; the peaks cover it to the last 10 ms block.
    expect(peaksDuration(peaks)).toBeCloseTo(53.1, 1)
  })

  it('bins min/max pairs normalized by the loudest sample', () => {
    const bins = peakBins(peaks, 240)
    expect(bins.length).toBe(480)
    let top = 0
    for (let i = 0; i < 240; i++) {
      expect(bins[2 * i]).toBeLessThanOrEqual(bins[2 * i + 1])
      top = Math.max(top, Math.abs(bins[2 * i]), Math.abs(bins[2 * i + 1]))
    }
    expect(top).toBeCloseTo(1, 5)
  })

  it('refuses a file that is not peaks, saying why', () => {
    expect(() => parsePeaks({ sr: 48000, samplesPerPeak: 480, peaks: [0.1] })).toThrow(MnMediaDataError)
    expect(() => parsePeaks({ peaks: [] })).toThrow(/sr/)
  })
})

describe('energy trace (the compact shape the Ovillo graph carries)', () => {
  const raw = json('media/hilo-de-luz.energy.json') as {
    hopSeconds: number
    channels: string[]
    frames: number[][]
    touches: Array<{ t: number; string: number }>
  }
  const trace = parseEnergyTrace(raw)

  it('reads strings, box and room as raw energy, because the file says so', () => {
    expect(trace.bodies.map((b) => b.id)).toEqual(['strings', 'box', 'room'])
    expect(trace.bodies.map((b) => b.label)).toEqual(['Strings', 'Box', 'Room'])
    expect(trace.unit).toBe('J')
    expect(trace.unitInferred).toBe(false)
    expect(trace.hopSeconds).toBe(0.01)
    expect(trace.durationSeconds).toBeCloseTo(raw.frames.length * 0.01, 6)
  })

  it('turns each hop into 10·log10 E, exactly', () => {
    const i = 1200
    for (let c = 0; c < 3; c++) {
      expect(trace.bodies[c].db[i]).toBeCloseTo(10 * Math.log10(raw.frames[i][c]), 4)
    }
  })

  it('reads a level between hops linearly, and the floor outside the trace', () => {
    const t = 12.345
    const i = Math.floor(t / 0.01)
    const f = t / 0.01 - i
    const expected = trace.bodies[0].db[i] * (1 - f) + trace.bodies[0].db[i + 1] * f
    expect(energyAt(trace, t)[0]).toBeCloseTo(expected, 4)
    expect(energyAt(trace, -1)).toEqual([trace.loDb, trace.loDb, trace.loDb])
    expect(energyAt(trace, trace.durationSeconds + 5)[2]).toBe(trace.loDb)
  })

  it('keeps a 60 dB display window above which almost nothing rises', () => {
    expect(trace.hiDb - trace.loDb).toBe(60)
    const all = trace.bodies.flatMap((b) => [...b.db])
    const above = all.filter((v) => v > trace.hiDb).length
    expect(above / all.length).toBeLessThan(0.005)
    expect(energyLevel(trace, trace.hiDb + 10)).toBe(1)
    expect(energyLevel(trace, trace.loDb - 10)).toBe(0)
  })

  it('the strings hold more energy than the room, as a guitar does', () => {
    const mean = (b: Float32Array): number => b.reduce((s, v) => s + v, 0) / b.length
    expect(mean(trace.bodies[0].db)).toBeGreaterThan(mean(trace.bodies[2].db))
  })

  it('carries every touch, sorted, with its string', () => {
    expect(trace.touches.length).toBe(raw.touches.length)
    for (let i = 1; i < trace.touches.length; i++) expect(trace.touches[i].t).toBeGreaterThanOrEqual(trace.touches[i - 1].t)
    expect(touchedStrings(trace)).toEqual([6, 5, 4, 3, 2, 1])
    const between = touchesBetween(trace, 0.4, 1.0)
    expect(between.every((t) => t.t > 0.4 && t.t <= 1.0)).toBe(true)
    expect(between.length).toBe(raw.touches.filter((t) => t.t > 0.4 && t.t <= 1.0).length)
  })

  it('draws one polyline per body across the whole width', () => {
    const lines = energyPolylines(trace, 1000, 100, 500)
    expect(lines).toHaveLength(3)
    for (const pts of lines) {
      const xy = pts.split(' ').map((p) => p.split(',').map(Number))
      expect(xy).toHaveLength(500)
      expect(xy[0][0]).toBeLessThan(5)
      expect(xy[xy.length - 1][0]).toBeGreaterThan(995)
      for (const [, y] of xy) expect(y).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('energy trace of two Worlds (Gigante y juguete)', () => {
  const raw = json('media/gigante-y-juguete.energy.json') as { worlds: Array<{ world: string; frames: number[][] }>; frames: number[][] }
  const trace = parseEnergyTrace(raw)

  it('names both Worlds and shows their sum', () => {
    expect(trace.worlds).toEqual(['jj', 'gg'])
    const i = 2000
    const sum = raw.worlds.reduce((s, w) => s + (w.frames[i]?.[0] ?? 0), 0)
    // The top-level frames are the builder's sum to 4 significant figures.
    expect(raw.frames[i][0]).toBeCloseTo(sum, 12)
    expect(trace.bodies[0].db[i]).toBeCloseTo(10 * Math.log10(raw.frames[i][0]), 4)
  })

  it('touches name their World', () => {
    expect(new Set(trace.touches.map((t) => t.world))).toEqual(new Set(['jj', 'gg']))
  })
})

describe('energy trace in the engine’s own shape', () => {
  // The compact file of one World, put back into the engine's per-body channels
  // (string/1..6 each a sixth, box/0..2 each a third): the reader must sum them back.
  const compact = json('media/hilo-de-luz.energy.json') as { frames: number[][]; touches: Array<{ t: number; string: number; kind: string }> }
  const engine = {
    schema: 'mus.ariadne.energy-trace.v1',
    worlds: [{
      instrument: 'gt',
      hopSeconds: 0.01,
      startSeconds: 0,
      channels: ['string/6', 'string/5', 'string/4', 'string/3', 'string/2', 'string/1', 'box/0', 'box/1', 'box/2', 'room'],
      frames: compact.frames.map(([s, b, r]) => [...Array(6).fill(s / 6), ...Array(3).fill(b / 3), r]),
      touches: compact.touches.map((t) => ({ seconds: t.t, string: t.string, kind: t.kind })),
    }],
  }
  const trace = parseEnergyTrace(engine)

  it('sums channels by body kind and keeps the touches', () => {
    expect(bodyKindOf('string/6')).toBe('strings')
    expect(bodyKindOf('box/2')).toBe('box')
    expect(trace.bodies.map((b) => b.id)).toEqual(['strings', 'box', 'room'])
    expect(trace.bodies[1].db[800]).toBeCloseTo(10 * Math.log10(compact.frames[800][1]), 3)
    expect(trace.touches).toHaveLength(compact.touches.length)
    expect(trace.worlds).toEqual(['gt'])
  })

  it('a trace in decibels is read as decibels; one that does not say is inferred and says so', () => {
    const db = { hopSeconds: 0.01, channels: ['strings'], units: 'dB re 1 J', frames: [[-80], [-70]], touches: [] }
    expect(parseEnergyTrace(db).unit).toBe('dB')
    expect(parseEnergyTrace(db).bodies[0].db[1]).toBe(-70)
    const silent = { hopSeconds: 0.01, channels: ['strings'], frames: [[-80], [-70]] }
    expect(parseEnergyTrace(silent)).toMatchObject({ unit: 'dB', unitInferred: true })
    expect(() => parseEnergyTrace({ frames: [] })).toThrow(MnMediaDataError)
  })
})

describe('spectrum bands', () => {
  it('folds a real sine into the band that holds it', () => {
    // An FFT of a 1 kHz sine at 48 kHz, 2048 points: compute the bins (no analyser needed).
    const n = 2048
    const sr = 48000
    const mags = new Float32Array(n / 2)
    for (let k = 0; k < n / 2; k++) {
      let re = 0
      let im = 0
      for (let i = 0; i < n; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
        const x = Math.sin((2 * Math.PI * 1000 * i) / sr) * w
        re += x * Math.cos((2 * Math.PI * k * i) / n)
        im -= x * Math.sin((2 * Math.PI * k * i) / n)
      }
      mags[k] = Math.hypot(re, im)
    }
    const top = Math.max(...mags)
    const bytes = Uint8Array.from(mags, (m) => Math.round((m / top) * 255))
    const bands = spectrumBands(bytes, sr, n, 40)
    const loudest = bands.indexOf(Math.max(...bands))
    const f0 = 40 * Math.exp((Math.log(16000 / 40) * loudest) / 40)
    const f1 = 40 * Math.exp((Math.log(16000 / 40) * (loudest + 1)) / 40)
    expect(f0).toBeLessThanOrEqual(1000 + sr / n)
    expect(f1).toBeGreaterThanOrEqual(1000 - sr / n)
    expect(bands[loudest]).toBe(1)
    expect(bands[0]).toBeLessThan(0.05)
  })
})

describe('the ledger, with units', () => {
  const receipt = json('receipts/hilo-de-luz.json') as { ariadneWorlds: Array<Record<string, number>> }
  const w = receipt.ariadneWorlds[0]
  const ledger = {
    world: 'gt',
    sourceWork: w.sourceWork,
    controlWork: w.controlWork,
    internalLoss: w.internalLoss,
    radiation: w.radiation,
    closureResidual: w.cumulativeClosureResidual,
  }

  it('formats joules with an SI prefix and keeps the stated number', () => {
    const q = formatQuantity(w.sourceWork, 'J')!
    expect(q.text).toBe('443.6 nJ')
    expect(q.exact).toBe(`${w.sourceWork.toExponential()} J`)
    expect(formatQuantity(w.cumulativeClosureResidual, 'J')!.unit).toBe('aJ')
    expect(formatQuantity(0, 'J')!.text).toBe('0 J')
    expect(formatQuantity(undefined)).toBeNull()
  })

  it('computes where the work went from the stated parts', () => {
    const b = ledgerBalance(ledger)!
    expect(b.workIn).toBeCloseTo(w.sourceWork + w.controlWork, 20)
    expect(b.shares.internalLoss + b.shares.radiation + b.shares.difference).toBeCloseTo(1, 12)
    // A guitar body turns almost all of the work into internal loss; little is radiated.
    expect(b.shares.internalLoss).toBeGreaterThan(0.9)
    expect(b.shares.radiation).toBeLessThan(0.05)
    expect(b.residualRatio!).toBeLessThan(1e-6)
    expect(ledgerBalance({ world: 'gt', sourceWork: 1 })).toBeNull()
  })
})
