/**
 * model.ts — PURE: `aig:` triples → the AVIARY library model.
 *
 * The mirror image of project.ts, and the app's own little `parseTriplesToConfig`:
 * a total function from a triple list to a typed, ordered, frozen-ish view model.
 * No fetch, no fs, no DOM, no Lit — so it is testable against a real projection
 * with nothing running (tests/library-projection.test.ts does exactly that).
 *
 * ABSENCE IS ABSENCE. Every measurement is optional here because it is optional
 * in the graph; a missing value stays `undefined` and the UI renders an explicit
 * dash, never a zero. A subject that carries no `aig:media` yields a resource
 * with an empty media list — inert and labeled, not hidden.
 */

import type { Term, Triple } from '@shrubbery/nucleus'
import { P, RDFS_COMMENT, RDFS_LABEL, RDF_TYPE, CLASS, libraryIri } from './vocab.js'

// ── The model ────────────────────────────────────────────────────────────────

export interface MediaRef {
  readonly iri: string
  /** Path RELATIVE to the library root — the shell turns this into a URL. */
  readonly path: string
  readonly mediaType: string
  readonly byteSize: number | undefined
  readonly isAudio: boolean
  /** Playback preference among encodings of one artifact — lower wins. */
  readonly rank: number
}

export interface Sample {
  readonly iri: string
  readonly id: string
  readonly voice: string
  readonly index: number
  readonly media: readonly MediaRef[]
  readonly event: number | undefined
  readonly t0: number | undefined
  readonly durationSeconds: number | undefined
  readonly f0Hz: number | undefined
  readonly note: string | undefined
  readonly midi: number | undefined
  readonly cents: number | undefined
  readonly shape: string | undefined
  readonly spanSemitones: number | undefined
  readonly sweepSemitones: number | undefined
  readonly centroidHz: number | undefined
  readonly fHiHz: number | undefined
  readonly amRateHz: number | undefined
  readonly rmsDb: number | undefined
  readonly f0Confidence: number | undefined
}

export interface Voice {
  readonly iri: string
  readonly name: string
  readonly family: string | undefined
  readonly cluster: number | undefined
  /** Events of this cluster in the WHOLE recording — usually > samples.length. */
  readonly population: number | undefined
  readonly f0Median: number | undefined
  readonly notesAtHand: readonly string[]
  readonly samples: readonly Sample[]
}

export interface Bed {
  readonly iri: string
  readonly name: string
  readonly comment: string | undefined
  readonly t0: number | undefined
  readonly durationSeconds: number | undefined
  readonly media: readonly MediaRef[]
}

export interface Figure {
  readonly iri: string
  readonly name: string
  readonly media: readonly MediaRef[]
}

export interface Cue {
  readonly index: number
  readonly t0: number
  readonly label: string | undefined
  readonly comment: string | undefined
  readonly sampleIri: string | undefined
}

export interface RenderPiece {
  readonly iri: string
  readonly name: string
  readonly media: readonly MediaRef[]
  readonly figures: readonly Figure[]
  readonly cues: readonly Cue[]
}

export interface Recording {
  readonly iri: string
  readonly name: string
  readonly media: readonly MediaRef[]
}

export interface Technique {
  readonly iri: string
  readonly name: string
  readonly comment: string | undefined
}

export interface Library {
  readonly iri: string
  readonly source: string | undefined
  readonly sampleRate: number | undefined
  readonly bandwidthNote: string | undefined
  readonly voices: readonly Voice[]
  readonly beds: readonly Bed[]
  readonly recordings: readonly Recording[]
  readonly renders: readonly RenderPiece[]
  readonly figures: readonly Figure[]
  readonly techniques: readonly Technique[]
  /** Every sample, keyed by IRI — the player resolves a cue target through this. */
  readonly samplesByIri: ReadonlyMap<string, Sample>
}

/** Thrown when a triple set carries no `aig:Library` node. The DISTINCT
 *  "this graph is not an aigua library" signal (mirrors nucleus's
 *  NoWorkspaceNodeError): a shell may explain it, but must never paper over it. */
export class NoLibraryNodeError extends Error {
  constructor() {
    super('parseLibrary: no aig:Library node found')
    this.name = 'NoLibraryNodeError'
  }
}

// ── The parse ────────────────────────────────────────────────────────────────

type Index = Map<string, Map<string, Term[]>>

function indexBySubject(triples: readonly Triple[]): Index {
  const bySubject: Index = new Map()
  for (const tr of triples) {
    let preds = bySubject.get(tr.s)
    if (!preds) {
      preds = new Map()
      bySubject.set(tr.s, preds)
    }
    const arr = preds.get(tr.p)
    if (arr) arr.push(tr.o)
    else preds.set(tr.p, [tr.o])
  }
  return bySubject
}

const litOf = (ix: Index, s: string, p: string): string | undefined => {
  const term = ix.get(s)?.get(p)?.[0]
  return term && term.type === 'literal' ? term.value : undefined
}
const litsOf = (ix: Index, s: string, p: string): string[] =>
  (ix.get(s)?.get(p) ?? []).flatMap((term) => (term.type === 'literal' ? [term.value] : []))
const numOf = (ix: Index, s: string, p: string): number | undefined => {
  const raw = litOf(ix, s, p)
  if (raw === undefined) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}
const boolOf = (ix: Index, s: string, p: string): boolean => litOf(ix, s, p) === 'true'
const irisOf = (ix: Index, s: string, p: string): string[] =>
  (ix.get(s)?.get(p) ?? []).flatMap((term) => (term.type === 'iri' ? [term.value] : []))
const iriOf = (ix: Index, s: string, p: string): string | undefined => irisOf(ix, s, p)[0]

/** A subject's media, ordered by the graph's OWN `aig:mediaRank` — never by
 *  the order the triples happened to sort into. */
function mediaOf(ix: Index, s: string): MediaRef[] {
  return irisOf(ix, s, P.media)
    .map((iri) => ({
      iri,
      path: litOf(ix, iri, P.path) ?? '',
      mediaType: litOf(ix, iri, P.mediaType) ?? '',
      byteSize: numOf(ix, iri, P.byteSize),
      isAudio: boolOf(ix, iri, P.isAudio),
      rank: numOf(ix, iri, P.mediaRank) ?? Number.MAX_SAFE_INTEGER,
    }))
    .filter((m) => m.path !== '')
    .sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path))
}

function labelOf(ix: Index, s: string): string {
  return litOf(ix, s, RDFS_LABEL) ?? s
}

function figureOf(ix: Index, iri: string): Figure {
  return { iri, name: labelOf(ix, iri), media: mediaOf(ix, iri) }
}

/** Sort by `aig:atIndex` when both carry one, else by label — the projection is
 *  already deterministic, so this only re-establishes authored order after the
 *  set→list crossing. */
const byIndex =
  (ix: Index) =>
  (a: string, b: string): number => {
    const ai = numOf(ix, a, P.atIndex)
    const bi = numOf(ix, b, P.atIndex)
    if (ai !== undefined && bi !== undefined && ai !== bi) return ai - bi
    return labelOf(ix, a).localeCompare(labelOf(ix, b))
  }

/**
 * Parse an `aig:` triple list into the library model. Throws NoLibraryNodeError
 * when the graph carries no Library node (the typed ABSENT signal).
 */
export function parseLibrary(triples: readonly Triple[]): Library {
  const ix = indexBySubject(triples)

  // Find the Library node by rdf:type, falling back to the canonical IRI only
  // when that exact subject is actually present.
  let LIB: string | undefined
  for (const [s, preds] of ix) {
    const rt = preds.get(RDF_TYPE)?.[0]
    if (rt && rt.type === 'iri' && rt.value === CLASS.Library) {
      LIB = s
      break
    }
  }
  if (LIB === undefined && ix.has(libraryIri())) LIB = libraryIri()
  if (LIB === undefined) throw new NoLibraryNodeError()

  const sort = byIndex(ix)
  const samplesByIri = new Map<string, Sample>()

  const voices: Voice[] = irisOf(ix, LIB, P.hasVoice)
    .sort(sort)
    .map((V) => {
      const samples: Sample[] = irisOf(ix, V, P.hasSample)
        .sort(sort)
        .map((S) => {
          const sample: Sample = {
            iri: S,
            id: labelOf(ix, S),
            voice: labelOf(ix, V),
            index: numOf(ix, S, P.atIndex) ?? 0,
            media: mediaOf(ix, S),
            event: numOf(ix, S, P.event),
            t0: numOf(ix, S, P.t0),
            durationSeconds: numOf(ix, S, P.durationSeconds),
            f0Hz: numOf(ix, S, P.f0Hz),
            note: litOf(ix, S, P.note),
            midi: numOf(ix, S, P.midi),
            cents: numOf(ix, S, P.cents),
            shape: litOf(ix, S, P.shape),
            spanSemitones: numOf(ix, S, P.spanSemitones),
            sweepSemitones: numOf(ix, S, P.sweepSemitones),
            centroidHz: numOf(ix, S, P.centroidHz),
            fHiHz: numOf(ix, S, P.fHiHz),
            amRateHz: numOf(ix, S, P.amRateHz),
            rmsDb: numOf(ix, S, P.rmsDb),
            f0Confidence: numOf(ix, S, P.f0Confidence),
          }
          samplesByIri.set(S, sample)
          return sample
        })
      return {
        iri: V,
        name: labelOf(ix, V),
        family: litOf(ix, V, P.family),
        cluster: numOf(ix, V, P.cluster),
        population: numOf(ix, V, P.population),
        f0Median: numOf(ix, V, P.f0Median),
        notesAtHand: litsOf(ix, V, P.noteAtHand),
        samples,
      }
    })
    // Voices read low-to-high; f0Median is the honest ordering key.
    .sort((a, b) => (a.f0Median ?? 0) - (b.f0Median ?? 0) || a.name.localeCompare(b.name))

  const beds: Bed[] = irisOf(ix, LIB, P.hasBed)
    .sort(sort)
    .map((B) => ({
      iri: B,
      name: labelOf(ix, B),
      comment: litOf(ix, B, RDFS_COMMENT),
      t0: numOf(ix, B, P.t0),
      durationSeconds: numOf(ix, B, P.durationSeconds),
      media: mediaOf(ix, B),
    }))

  const recordings: Recording[] = irisOf(ix, LIB, P.hasRecording)
    .sort(sort)
    .map((R) => ({ iri: R, name: labelOf(ix, R), media: mediaOf(ix, R) }))

  const renders: RenderPiece[] = irisOf(ix, LIB, P.hasRender)
    .sort(sort)
    .map((R) => ({
      iri: R,
      name: labelOf(ix, R),
      media: mediaOf(ix, R),
      figures: irisOf(ix, R, P.hasFigure).sort(sort).map((F) => figureOf(ix, F)),
      cues: irisOf(ix, R, P.hasCue)
        .map((C) => ({
          index: numOf(ix, C, P.atIndex) ?? 0,
          t0: numOf(ix, C, P.t0) ?? 0,
          label: litOf(ix, C, RDFS_LABEL),
          comment: litOf(ix, C, RDFS_COMMENT),
          sampleIri: iriOf(ix, C, P.cueSample),
        }))
        .sort((a, b) => a.index - b.index),
    }))

  const figures: Figure[] = irisOf(ix, LIB, P.hasFigure).sort(sort).map((F) => figureOf(ix, F))

  const techniques: Technique[] = irisOf(ix, LIB, P.hasTechnique)
    .sort(sort)
    .map((K) => ({ iri: K, name: labelOf(ix, K), comment: litOf(ix, K, RDFS_COMMENT) }))

  return {
    iri: LIB,
    source: litOf(ix, LIB, P.sourceRecording),
    sampleRate: numOf(ix, LIB, P.sampleRate),
    bandwidthNote: litOf(ix, LIB, P.bandwidthNote),
    voices,
    beds,
    recordings,
    renders,
    figures,
    techniques,
    samplesByIri,
  }
}

/** Total sample count across every voice — the header's headline number. */
export function sampleCount(library: Library): number {
  return library.voices.reduce((n, v) => n + v.samples.length, 0)
}

/** The encoding a player should prefer — the lowest-ranked audio media the
 *  graph carries (`mediaOf` has already applied `aig:mediaRank`). Undefined
 *  when the resource has no audio at all, which callers must render as an
 *  unplayable row rather than a dead play button. */
export function playableOf(media: readonly MediaRef[]): MediaRef | undefined {
  return media.find((m) => m.isAudio)
}
