/**
 * project.ts — NODE-SIDE: the aigua field-recording library → `aig:` triples.
 *
 * THE MINT STAGE of the shrubbery pipeline ("Emporium mints the triples → a cell
 * stores them → the interpreter consumes them → the renderers project them to a
 * target"), standing in for the Emporium: here the minter is a projection of a
 * real analysis manifest (`instrument.json`) plus a real directory walk.
 *
 * SHELL-SIDE BY CONSTRUCTION. This module imports `node:fs` and therefore can
 * never be pulled into the browser bundle — which is the point. The library
 * packages never touch a filesystem; the app shell reads disk here, projects it
 * to RDF, and serves the N-Triples over the read seam. The browser sees triples,
 * not files.
 *
 * NO INVENTED DATA. Every literal below is either read verbatim out of
 * `instrument.json` / a sidecar index, or is a fact about the file itself
 * (relative path, byte size, media type). Nothing is described, summarised, or
 * captioned by this code. Absent files are absent triples, never placeholders —
 * and a missing library root is a thrown error, never an empty graph.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { compareTriples } from '@shrubbery/nucleus'
import { audioRankOf, isAudioPath, mediaTypeOf } from '../shell/media-types.js'
import {
  CLASS,
  I,
  L,
  Lbool,
  Ldec,
  Lint,
  P,
  RDFS_COMMENT,
  RDFS_LABEL,
  RDF_TYPE,
  bedIri,
  figureIri,
  libraryIri,
  mediaIri,
  recordingIri,
  renderIri,
  sampleIri,
  t,
  techniqueIri,
  voiceIri,
  type Triple,
} from './vocab.js'

/** Thrown when the library root is not a readable aigua directory. Refusing to
 *  project beats projecting an empty graph that would render as a plausible,
 *  silently-wrong "library with no voices". */
export class LibraryRootError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LibraryRootError'
  }
}

const isAudio = isAudioPath
const rankOf = audioRankOf

/** Read a directory, or `[]` when it does not exist (an absent optional subdir
 *  is a real state of this library: `render/` fills up over time). */
function safeList(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

/** Emit the `aig:Media` node for one real file. Returns its IRI, or null when
 *  the file is missing/unreadable (a dangling manifest entry projects nothing
 *  rather than a media node that cannot be played). */
function emitMedia(out: Triple[], root: string, relPath: string): string | null {
  const type = mediaTypeOf(relPath)
  if (type === null) return null
  let size: number
  try {
    size = statSync(join(root, relPath)).size
  } catch {
    return null
  }
  const M = mediaIri(relPath)
  out.push(
    t(M, RDF_TYPE, I(CLASS.Media)),
    t(M, P.path, L(relPath)),
    t(M, P.mediaType, L(type)),
    t(M, P.byteSize, Lint(size)),
    t(M, P.isAudio, Lbool(isAudio(relPath))),
    // Playback preference, stated rather than implied: a triple SET has no
    // order, so leaving "lossless first" to the serializer's sort would make
    // the player's choice an accident of IRI collation.
    t(M, P.mediaRank, Lint(rankOf(relPath))),
  )
  return M
}

/** Attach every real media file in `relPaths` to `subject` via `aig:media`. */
function attachMedia(out: Triple[], root: string, subject: string, relPaths: readonly string[]): number {
  let n = 0
  for (const rel of [...relPaths].sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b))) {
    const M = emitMedia(out, root, rel)
    if (M === null) continue
    out.push(t(subject, P.media, I(M)))
    n++
  }
  return n
}

// ── The instrument manifest, as it is actually shaped on disk ────────────────

interface RawSample {
  file: string
  event?: number
  t0?: number
  dur_s?: number
  f0_hz?: number
  note?: string
  midi?: number
  cents?: number
  shape?: string
  span_st?: number
  sweep_st?: number
  centroid?: number
  f_hi?: number
  am_rate?: number
  rms_db?: number
  f0_conf?: number
}
interface RawVoice {
  family?: string
  cluster?: number
  population?: number
  f0_median?: number
  notes_at_hand?: string[]
  samples?: RawSample[]
}
interface RawBed {
  file: string
  t0?: number
  dur_s?: number
  desc?: string
}
interface Instrument {
  source?: string
  sr?: number
  bandwidth_note?: string
  voices?: Record<string, RawVoice>
  noise?: Record<string, RawBed>
  shifting?: Record<string, string>
}

/** One cue in a render's sidecar index (`<render>_index.json`). */
interface RawCue {
  t?: number
  name?: string
  desc?: string
}

// ── The projection ───────────────────────────────────────────────────────────

/** Optional numeric predicate — emitted only when the manifest actually carries
 *  the measurement. A missing measurement is a missing triple. */
function num(out: Triple[], s: string, p: string, v: number | undefined, int = false): void {
  if (typeof v !== 'number' || !Number.isFinite(v)) return
  out.push(t(s, p, int ? Lint(v) : Ldec(v)))
}
function str(out: Triple[], s: string, p: string, v: string | undefined): void {
  if (typeof v !== 'string' || v === '') return
  out.push(t(s, p, L(v)))
}

/**
 * Project the aigua library rooted at `root` into a canonical, sorted triple
 * list. Throws LibraryRootError when `instrument.json` is not readable there.
 */
export function projectLibrary(root: string): Triple[] {
  let manifest: Instrument
  const manifestPath = join(root, 'instrument.json')
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Instrument
  } catch (e) {
    throw new LibraryRootError(
      `AVIARY: cannot read the instrument manifest at ${manifestPath} — ` +
        `${e instanceof Error ? e.message : String(e)}. ` +
        'Point AIGUA_DIR at the aigua field-recording directory. ' +
        'Refusing to project an empty library (an empty graph would render as a real, wrong one).',
    )
  }

  const out: Triple[] = []
  const LIB = libraryIri()
  out.push(t(LIB, RDF_TYPE, I(CLASS.Library)), t(LIB, RDFS_LABEL, L('aigua')))
  str(out, LIB, P.sourceRecording, manifest.source)
  num(out, LIB, P.sampleRate, manifest.sr, true)
  str(out, LIB, P.bandwidthNote, manifest.bandwidth_note)

  /** sample id → IRI, so a render's cue can point at the sample it plays. */
  const sampleByName = new Map<string, string>()

  // ── Voices + their samples ─────────────────────────────────────────────────
  const voices = manifest.voices ?? {}
  Object.keys(voices)
    .sort()
    .forEach((name) => {
      const v = voices[name]
      const V = voiceIri(name)
      out.push(t(LIB, P.hasVoice, I(V)), t(V, RDF_TYPE, I(CLASS.Voice)), t(V, RDFS_LABEL, L(name)))
      str(out, V, P.family, v.family)
      num(out, V, P.cluster, v.cluster, true)
      num(out, V, P.population, v.population, true)
      num(out, V, P.f0Median, v.f0_median)
      for (const n of v.notes_at_hand ?? []) out.push(t(V, P.noteAtHand, L(n)))

      ;(v.samples ?? []).forEach((s, idx) => {
        const id = basename(s.file, extname(s.file))
        const S = sampleIri(id)
        sampleByName.set(id, S)
        out.push(
          t(V, P.hasSample, I(S)),
          t(S, RDF_TYPE, I(CLASS.Sample)),
          t(S, RDFS_LABEL, L(id)),
          t(S, P.inVoice, I(V)),
          t(S, P.atIndex, Lint(idx)),
        )
        attachMedia(out, root, S, [s.file])
        num(out, S, P.event, s.event, true)
        num(out, S, P.t0, s.t0)
        num(out, S, P.durationSeconds, s.dur_s)
        num(out, S, P.f0Hz, s.f0_hz)
        str(out, S, P.note, s.note)
        num(out, S, P.midi, s.midi, true)
        num(out, S, P.cents, s.cents)
        str(out, S, P.shape, s.shape)
        num(out, S, P.spanSemitones, s.span_st)
        num(out, S, P.sweepSemitones, s.sweep_st)
        num(out, S, P.centroidHz, s.centroid)
        num(out, S, P.fHiHz, s.f_hi)
        num(out, S, P.amRateHz, s.am_rate)
        num(out, S, P.rmsDb, s.rms_db)
        num(out, S, P.f0Confidence, s.f0_conf)
      })
    })

  // ── Noise beds ─────────────────────────────────────────────────────────────
  const noise = manifest.noise ?? {}
  Object.keys(noise)
    .sort()
    .forEach((name) => {
      const b = noise[name]
      const B = bedIri(name)
      out.push(t(LIB, P.hasBed, I(B)), t(B, RDF_TYPE, I(CLASS.Bed)), t(B, RDFS_LABEL, L(name)))
      str(out, B, RDFS_COMMENT, b.desc)
      num(out, B, P.t0, b.t0)
      num(out, B, P.durationSeconds, b.dur_s)
      attachMedia(out, root, B, [b.file])
    })

  // ── Shifting techniques (the manifest's own prose, verbatim) ───────────────
  const shifting = manifest.shifting ?? {}
  Object.keys(shifting)
    .sort()
    .forEach((name) => {
      const K = techniqueIri(name)
      out.push(
        t(LIB, P.hasTechnique, I(K)),
        t(K, RDF_TYPE, I(CLASS.Technique)),
        t(K, RDFS_LABEL, L(name)),
        t(K, RDFS_COMMENT, L(shifting[name])),
      )
    })

  // ── Source recording + band splits (root-level audio) ──────────────────────
  const rootFiles = safeList(root)
  for (const f of rootFiles) {
    if (!isAudio(f)) continue
    const name = basename(f, extname(f))
    const R = recordingIri(name)
    out.push(t(LIB, P.hasRecording, I(R)), t(R, RDF_TYPE, I(CLASS.Recording)), t(R, RDFS_LABEL, L(name)))
    attachMedia(out, root, R, [f])
  }

  // ── Analysis figures (root-level images) ───────────────────────────────────
  for (const f of rootFiles) {
    if (mediaTypeOf(f) === null || isAudio(f)) continue
    const name = basename(f, extname(f))
    const F = figureIri(name)
    out.push(t(LIB, P.hasFigure, I(F)), t(F, RDF_TYPE, I(CLASS.Figure)), t(F, RDFS_LABEL, L(name)))
    attachMedia(out, root, F, [f])
  }

  // ── Rendered pieces — ENUMERATED, never hardcoded: render/ grows over time ─
  const renderFiles = safeList(join(root, 'render'))
  /** logical render name → every encoding of it found on disk. */
  const renderMedia = new Map<string, string[]>()
  for (const f of renderFiles) {
    if (!isAudio(f)) continue
    const name = basename(f, extname(f))
    const list = renderMedia.get(name) ?? []
    list.push(`render/${f}`)
    renderMedia.set(name, list)
  }
  for (const name of [...renderMedia.keys()].sort()) {
    const R = renderIri(name)
    out.push(t(LIB, P.hasRender, I(R)), t(R, RDF_TYPE, I(CLASS.Render)), t(R, RDFS_LABEL, L(name)))
    attachMedia(out, root, R, renderMedia.get(name)!)

    // A render's own analysis image, when one was produced next to it. The
    // match is EXACT (`<render>.png` or `<render>_analysis.png`, the naming the
    // pipeline's analyze step emits) — a prefix match would attach
    // `aigua_chorale_analysis.png` to the render called `aigua`.
    const figureNames = new Set([name, `${name}_analysis`])
    for (const f of renderFiles) {
      if (mediaTypeOf(f) === null || isAudio(f)) continue
      const fig = basename(f, extname(f))
      if (!figureNames.has(fig)) continue
      const F = figureIri(fig)
      out.push(t(R, P.hasFigure, I(F)), t(F, RDF_TYPE, I(CLASS.Figure)), t(F, RDFS_LABEL, L(fig)))
      attachMedia(out, root, F, [`render/${f}`])
    }

    // Cue sidecar (`<render>_index.json`) — real timestamps into the render.
    const sidecar = `${name}_index.json`
    if (!renderFiles.includes(sidecar)) continue
    let cues: RawCue[]
    try {
      cues = JSON.parse(readFileSync(join(root, 'render', sidecar), 'utf8')) as RawCue[]
    } catch {
      continue
    }
    if (!Array.isArray(cues)) continue
    cues.forEach((c, idx) => {
      if (typeof c.t !== 'number' || !Number.isFinite(c.t)) return
      const C = `${R}:cue:${idx}`
      out.push(
        t(R, P.hasCue, I(C)),
        t(C, RDF_TYPE, I(CLASS.Cue)),
        t(C, P.atIndex, Lint(idx)),
        t(C, P.t0, Ldec(c.t)),
      )
      str(out, C, RDFS_LABEL, c.name)
      str(out, C, RDFS_COMMENT, c.desc)
      const target = c.name !== undefined ? sampleByName.get(c.name) : undefined
      if (target) out.push(t(C, P.cueSample, I(target)))
    })
  }

  return out.sort(compareTriples)
}
