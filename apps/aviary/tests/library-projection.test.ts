/**
 * The MINT → PARSE round trip, against the REAL aigua directory.
 *
 * No fixture, no snapshot of a projection: the test reads `instrument.json` and
 * the sample/render directories itself and asserts that whatever came out of
 * `projectLibrary` → `triplesToNT` → `parseNT` → `parseLibrary` agrees with the
 * manifest term for term. If the library on disk changes, this test tracks it —
 * which is the point of a no-mocks suite over live content.
 *
 * The whole suite SKIPS honestly (never passes vacuously) when the sibling
 * aigua checkout is not present.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseNT, triplesToNT } from '@shrubbery/nucleus'
import { projectLibrary } from '../src/library/project.js'
import { NoLibraryNodeError, parseLibrary, sampleCount } from '../src/library/model.js'
import { AIGUA_DIR } from '../vite.config.js'

const present = existsSync(join(AIGUA_DIR, 'instrument.json'))

interface RawManifest {
  source?: string
  sr?: number
  voices?: Record<
    string,
    {
      family?: string
      population?: number
      f0_median?: number
      notes_at_hand?: string[]
      samples?: Array<Record<string, unknown>>
    }
  >
  noise?: Record<string, { file: string }>
}

describe.skipIf(!present)('aig: projection ↔ model, over the real aigua library', () => {
  const manifest = present
    ? (JSON.parse(readFileSync(join(AIGUA_DIR, 'instrument.json'), 'utf8')) as RawManifest)
    : ({} as RawManifest)
  const triples = present ? projectLibrary(AIGUA_DIR) : []
  // The wire form is what the browser actually receives, so parse THAT back.
  const library = present ? parseLibrary(parseNT(triplesToNT(triples))) : null

  it('survives the N-Triples wire form term for term', () => {
    expect(parseNT(triplesToNT(triples))).toEqual(triples)
  })

  it('carries every voice the manifest declares, with its measured family', () => {
    const names = Object.keys(manifest.voices ?? {}).sort()
    expect([...library!.voices].map((v) => v.name).sort()).toEqual(names)
    for (const voice of library!.voices) {
      expect(voice.family).toBe(manifest.voices![voice.name].family)
      expect(voice.population).toBe(manifest.voices![voice.name].population)
      expect(voice.f0Median).toBe(manifest.voices![voice.name].f0_median)
      expect([...voice.notesAtHand].sort()).toEqual([...(manifest.voices![voice.name].notes_at_hand ?? [])].sort())
    }
  })

  it('carries every sample, with its measurements unrounded', () => {
    const declared = Object.values(manifest.voices ?? {}).reduce((n, v) => n + (v.samples?.length ?? 0), 0)
    expect(sampleCount(library!)).toBe(declared)

    for (const voice of library!.voices) {
      const raw = manifest.voices![voice.name].samples ?? []
      voice.samples.forEach((sample, i) => {
        const source = raw[i]
        expect(sample.f0Hz).toBe(source.f0_hz)
        expect(sample.note).toBe(source.note)
        expect(sample.cents).toBe(source.cents)
        expect(sample.durationSeconds).toBe(source.dur_s)
        expect(sample.shape).toBe(source.shape)
        expect(sample.centroidHz).toBe(source.centroid)
        expect(sample.midi).toBe(source.midi)
        expect(sample.rmsDb).toBe(source.rms_db)
      })
    }
  })

  it('gives every sample a real audio file that exists on disk', () => {
    for (const voice of library!.voices) {
      for (const sample of voice.samples) {
        const audio = sample.media.filter((m) => m.isAudio)
        expect(audio.length, `${sample.id} has no audio media`).toBeGreaterThan(0)
        for (const media of audio) {
          expect(existsSync(join(AIGUA_DIR, media.path)), `${media.path} missing`).toBe(true)
          expect(media.byteSize).toBeGreaterThan(0)
        }
      }
    }
  })

  it('ENUMERATES render/ rather than hardcoding it, and links its cue sidecars', () => {
    // The directory grows over time; the projection must simply reflect it.
    expect(library!.renders.length).toBeGreaterThan(0)
    for (const piece of library!.renders) {
      expect(piece.media.some((m) => m.isAudio)).toBe(true)
      for (const cue of piece.cues) {
        expect(Number.isFinite(cue.t0)).toBe(true)
        // A cue naming a known sample must resolve to that sample's IRI.
        if (cue.label !== undefined && library!.samplesByIri.has(`urn:aigua:sample:${cue.label}`)) {
          expect(cue.sampleIri).toBe(`urn:aigua:sample:${cue.label}`)
        }
      }
    }
  })

  it('carries the noise beds and the source recording', () => {
    expect(library!.beds.map((b) => b.name).sort()).toEqual(Object.keys(manifest.noise ?? {}).sort())
    expect(library!.recordings.length).toBeGreaterThan(0)
    expect(library!.source).toBe(manifest.source)
    expect(library!.sampleRate).toBe(manifest.sr)
  })

  it('carries the analysis figures with real image bytes', () => {
    expect(library!.figures.length).toBeGreaterThan(0)
    for (const figure of library!.figures) {
      const image = figure.media.find((m) => !m.isAudio)
      expect(image, `${figure.name} has no image media`).toBeDefined()
      expect(existsSync(join(AIGUA_DIR, image!.path))).toBe(true)
    }
  })

  it('refuses a graph with no aig:Library node instead of inventing one', () => {
    expect(() => parseLibrary([])).toThrow(NoLibraryNodeError)
  })
})
