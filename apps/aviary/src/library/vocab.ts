/**
 * vocab.ts — the `aig:` field-recording vocabulary.
 *
 * AVIARY's domain ontology, sitting BESIDE `sux:` (the frontend ontology) rather
 * than inside it: `sux:` says how a workspace is laid out, `aig:` says what a
 * sample library IS. Both are plain RDF over the SAME nucleus Triple model, both
 * travel through the SAME `TripleSource` read seam, and neither knows about the
 * other — the shell is the only place they meet.
 *
 * PURE + BROWSER-SAFE: term constructors and IRI minters only. No fs, no fetch,
 * no DOM. The Node-side projector (project.ts) and the browser-side model parser
 * (model.ts) both import from here, which is what keeps the two ends of the wire
 * spelling every predicate identically.
 */

import { I, L, Lbool, Ldec, Lint, type Term, type Triple } from '@shrubbery/nucleus'

// ── Namespaces ───────────────────────────────────────────────────────────────

export const NS = {
  /** The AVIARY field-recording vocabulary (mirrors sux:'s http://sophia.ai/ux# shape). */
  aig: 'http://sophia.ai/aigua#',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
} as const

export const RDF_TYPE = `${NS.rdf}type`
export const RDFS_LABEL = `${NS.rdfs}label`
export const RDFS_COMMENT = `${NS.rdfs}comment`

/** An `aig:` predicate/class IRI for a local term. */
export const aig = (local: string): string => `${NS.aig}${local}`

// ── Named graph ──────────────────────────────────────────────────────────────

/**
 * The domain graph the library lives in. A URN, not a URL: the graph is a name,
 * and WHICH store answers for it is the `TripleSource` binding's business, never
 * the vocabulary's.
 */
export const LIBRARY_GRAPH_IRI = 'urn:aigua:graph:library'

/**
 * The graph id whose `:ux:config` slot carries AVIARY's layout. Fed through
 * nucleus's own `uxConfigGraphIri()` by the caller so the layout graph name
 * follows the canonical `urn:mnemosyne:local:graph:{id}:ux:config` convention
 * rather than inventing a parallel one.
 */
export const AVIARY_GRAPH_ID = 'aviary'

// ── Subject IRI minters ──────────────────────────────────────────────────────

export const libraryIri = (): string => 'urn:aigua:library'
export const voiceIri = (name: string): string => `urn:aigua:voice:${name}`
export const sampleIri = (id: string): string => `urn:aigua:sample:${id}`
export const bedIri = (name: string): string => `urn:aigua:bed:${name}`
export const recordingIri = (name: string): string => `urn:aigua:recording:${name}`
export const renderIri = (name: string): string => `urn:aigua:render:${name}`
export const figureIri = (name: string): string => `urn:aigua:figure:${name}`
export const techniqueIri = (name: string): string => `urn:aigua:technique:${name}`
/** A media resource, named by its path RELATIVE to the library root. */
export const mediaIri = (relPath: string): string => `urn:aigua:media:${relPath}`

// ── Classes ──────────────────────────────────────────────────────────────────

export const CLASS = {
  Library: aig('Library'),
  Voice: aig('Voice'),
  Sample: aig('Sample'),
  Bed: aig('Bed'),
  Recording: aig('Recording'),
  Render: aig('Render'),
  Figure: aig('Figure'),
  Technique: aig('Technique'),
  Cue: aig('Cue'),
  Media: aig('Media'),
} as const

// ── Predicates ───────────────────────────────────────────────────────────────

export const P = {
  // structure
  hasVoice: aig('hasVoice'),
  hasSample: aig('hasSample'),
  hasBed: aig('hasBed'),
  hasRecording: aig('hasRecording'),
  hasRender: aig('hasRender'),
  hasFigure: aig('hasFigure'),
  hasTechnique: aig('hasTechnique'),
  hasCue: aig('hasCue'),
  cueSample: aig('cueSample'),
  inVoice: aig('inVoice'),
  media: aig('media'),
  atIndex: aig('atIndex'),

  // library
  sourceRecording: aig('sourceRecording'),
  sampleRate: aig('sampleRate'),
  bandwidthNote: aig('bandwidthNote'),

  // voice
  family: aig('family'),
  cluster: aig('cluster'),
  population: aig('population'),
  f0Median: aig('f0Median'),
  noteAtHand: aig('noteAtHand'),

  // sample measurements (verbatim from the analysis pipeline)
  event: aig('event'),
  t0: aig('t0'),
  durationSeconds: aig('durationSeconds'),
  f0Hz: aig('f0Hz'),
  note: aig('note'),
  midi: aig('midi'),
  cents: aig('cents'),
  shape: aig('shape'),
  spanSemitones: aig('spanSemitones'),
  sweepSemitones: aig('sweepSemitones'),
  centroidHz: aig('centroidHz'),
  fHiHz: aig('fHiHz'),
  amRateHz: aig('amRateHz'),
  rmsDb: aig('rmsDb'),
  f0Confidence: aig('f0Confidence'),

  // media resources
  path: aig('path'),
  mediaType: aig('mediaType'),
  byteSize: aig('byteSize'),
  isAudio: aig('isAudio'),
  /** Playback preference among several encodings of one artifact — lower wins.
   *  An EXPLICIT fact because RDF has no statement order: without it, the
   *  consumer would silently inherit whatever order the triples sorted into. */
  mediaRank: aig('mediaRank'),
} as const

// ── Tiny triple-builder sugar (shared by the projector) ──────────────────────

export const t = (s: string, p: string, o: Term): Triple => ({ s, p, o })
export { I, L, Lbool, Ldec, Lint }
export type { Term, Triple }
