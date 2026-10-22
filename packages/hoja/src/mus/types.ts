/**
 * What the MUS engine (Ovillo's `mus-wasm`, the browser build of `mus check` / `mus render`) says about a score, as the
 * browser receives it. Field names are the engine's own JSON (`ovillo.mus-wasm.check.v1`, `mus.audio.render-receipt.v1`,
 * `mus.ariadne.energy-trace.v1`), restated once here; the only producer of these values is the engine.
 */

/** Where a diagnostic sits in the score text: UTF-16 offsets (what a JS string and ProseMirror count), 1-based line. */
export interface MusSpan {
  readonly from: number
  readonly to: number
  readonly line: number
}

export type MusAnchor =
  | { readonly kind: 'event'; readonly bar: number; readonly track: string; readonly tokenIndex: number; readonly token: string }
  | { readonly kind: 'instrument'; readonly abbrev: string }
  | { readonly kind: 'header'; readonly key: string }
  | { readonly kind: 'score' }

export interface MusDiagnostic {
  readonly severity: 'error' | 'warning' | 'info'
  /** `tab-position-disagrees`, `not-ariadne`, `tab-reach`, ... (the engine's codes). */
  readonly code: string
  readonly message: string
  readonly anchor: MusAnchor
  readonly span?: MusSpan
}

export interface MusHandSummary {
  readonly abbrev: string
  readonly pos: number
  readonly pick: number
  readonly palmMute: number
}

/** One instrument played on an Ariadne World, as the checker read it. */
export interface MusWorldSummary {
  readonly abbrev: string
  readonly anatomy: string
  /** Open courses, string 1 (highest) first. */
  readonly strings: readonly string[]
  readonly capo: number
  readonly hands: readonly MusHandSummary[]
}

/** `ovillo.mus-wasm.check.v1`. `clean` means the browser will render it. */
export interface MusCheckReport {
  readonly schema: string
  readonly producer: string
  readonly engineVersion: string
  readonly clean: boolean
  readonly sourceDigest: string
  readonly score: { readonly title: string; readonly bars: number | null; readonly durationSeconds: number | null }
  readonly worlds: readonly MusWorldSummary[]
  readonly diagnostics: readonly MusDiagnostic[]
}

/** One World's entry in the render receipt: what it is, what touched it, and its ledger (the World's energy units). */
export interface MusWorldReceipt {
  readonly instrument: string
  readonly anatomy: string
  readonly planDigest: string
  readonly listenerDigest: string
  readonly bodies: readonly string[]
  readonly plucks: number
  readonly hammerOns: number
  readonly pullOffs: number
  readonly slides: number
  readonly simulatedSeconds: number
  readonly strings: readonly { readonly string: number; readonly open: string; readonly hand: string | null; readonly pos: number; readonly pick: number; readonly palmMute: number }[]
  readonly sourceWork: number
  readonly controlWork: number
  readonly internalLoss: number
  readonly radiation: number
  readonly cumulativeClosureResidual: number
  readonly maximumFrameResidual: number
}

/** `mus.audio.render-receipt.v1`, as `mus render --json` prints it. */
export interface MusRenderReceipt {
  readonly schema: string
  readonly renderDigest: string
  readonly sourceDigest: string
  readonly engineVersion: string
  readonly peakDbfs: number
  readonly rmsDbfs: number
  readonly wallSeconds: number
  readonly eventCount: number
  readonly voiceCount: number
  readonly durationSeconds: number
  readonly perTrackEvents: Readonly<Record<string, number>>
  readonly badTokens: readonly string[]
  readonly warnings: readonly string[]
  readonly ariadneWorlds?: readonly MusWorldReceipt[]
}

/** `mus.ariadne.energy-trace.v1`: stored energy per body (and the room) every hop, and every touch. */
export interface MusEnergyTrace {
  readonly schema: string
  readonly worlds: readonly {
    readonly instrument: string
    readonly hopSeconds: number
    readonly startSeconds: number
    readonly channels: readonly string[]
    readonly frames: readonly (readonly number[])[]
    readonly touches: readonly { readonly seconds: number; readonly string: number; readonly fret: number; readonly kind: string; readonly hand: string; readonly db: number }[]
    readonly [key: string]: unknown
  }[]
}

/** A finished render: audio (48 kHz stereo), the WAV `renderDigest` digests, the receipt and the energy trace. */
export interface MusTake {
  readonly source: string
  readonly sampleRate: number
  readonly frames: number
  readonly left: Float32Array
  readonly right: Float32Array
  /** The PCM_24 WAV the receipt's `renderDigest` is the SHA-256 of. */
  readonly wav: Uint8Array
  readonly receipt: MusRenderReceipt
  readonly energy: MusEnergyTrace
}

export interface MusRenderProgress {
  /** World samples simulated, of `total`. */
  readonly done: number
  readonly total: number
  readonly fraction: number
  readonly elapsedSeconds: number
}

/** The engine seam: check and render, nothing else. Implemented by `@shrubbery/runtime/mus` (the wasm in a Worker). */
export interface MusEngine {
  check(source: string, options?: { readonly signal?: AbortSignal }): Promise<MusCheckReport>
  render(source: string, options?: { readonly signal?: AbortSignal; readonly onProgress?: (progress: MusRenderProgress) => void }): Promise<MusTake>
}

/** A render that did not start because the score does not check clean (`report` says why). */
export class MusRenderRefusedError extends Error {
  constructor(readonly report: MusCheckReport) {
    const errors = report.diagnostics.filter(d => d.severity === 'error')
    super(`the score does not check clean: ${errors.map(d => d.message).join('; ') || 'refused'}`)
    this.name = 'MusRenderRefused'
  }
}
